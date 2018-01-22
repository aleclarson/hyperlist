'use strict'

// Check for valid number.
function isNumber(x) {
  return typeof x == 'number' && !isNaN(x)
}

// Add a class to an element.
const addClass = 'classList' in document.documentElement
  ? (element, className) => {
    element.classList.add(className)
  }
  : (element, className) => {
    const oldClass = element.getAttribute('class') || ''
    element.setAttribute('class', `${oldClass} ${className}`)
  }

/**
 * Creates a HyperList instance that virtually scrolls very large amounts of
 * data effortlessly.
 */
export default class HyperList {
  /**
   * Merge given css style on an element
   * @param {DOMElement} element
   * @param {Object} style
   */
  static mergeStyle (element, style) {
    for (let i in style) {
      if (element.style[i] !== style[i]) {
        element.style[i] = style[i]
      }
    }
  }

  static getMaxBrowserHeight () {
    // Create two elements, the wrapper is `1px` tall and is transparent and
    // positioned at the top of the page. Inside that is an element that gets
    // set to 1 billion pixels. Then reads the max height the browser can
    // calculate.
    const wrapper = document.createElement('div')
    const fixture = document.createElement('div')

    // As said above, these values get set to put the fixture elements into the
    // right visual state.
    HyperList.mergeStyle(wrapper, {position: 'absolute', height: '1px', opacity: 0})
    HyperList.mergeStyle(fixture, {height: '1e7px'})

    // Add the fixture into the wrapper element.
    wrapper.appendChild(fixture)

    // Apply to the page, the values won't kick in unless this is attached.
    document.body.appendChild(wrapper)

    // Get the maximum element height in pixels.
    const maxElementHeight = fixture.offsetHeight

    // Remove the element immediately after reading the value.
    document.body.removeChild(wrapper)

    return maxElementHeight
  }

  constructor (element, config) {
    this._config = {}
    this._lastRepaint = null
    this._maxElementHeight = HyperList.getMaxBrowserHeight()

    if (!element || element.nodeType != 1) {
      throw new Error('HyperList requires a valid DOM Node container')
    }
    this.refresh(element, config)

    // Create internal render loop.
    const render = () => {
      const scrollTop = this._getScrollPosition()
      const lastRepaint = this._lastRepaint

      this._renderAnimationFrame = window.requestAnimationFrame(render)

      if (scrollTop === lastRepaint || !this._scrollHeight) {
        return
      }

      const diff = lastRepaint ? scrollTop - lastRepaint : 0
      if (!lastRepaint || diff < 0 || diff > this._averageHeight) {
        let rendered = this._renderChunk()

        this._lastRepaint = scrollTop

        if (rendered !== false && typeof config.afterRender === 'function') {
          config.afterRender()
        }
      }
    }

    render()
  }

  destroy () {
    window.cancelAnimationFrame(this._renderAnimationFrame)
  }

  refresh (element, newConfig) {
    if (arguments.length == 1) {
      if (!element.nodeType) {
        newConfig = element
        element = null
      }
    }

    let elementChanged = false
    if (element) {
      if (element.nodeType != 1) {
        throw new Error('HyperList requires a valid DOM Node container')
      }
      this._element = element
      elementChanged = true
    }

    const config = this._config
    if (newConfig) {
      Object.assign(config, newConfig)

      // Use document fragments by default.
      if (typeof config.useFragment != 'boolean') {
        config.useFragment = true
      }

      if (typeof config.generate != 'function') {
        throw Error('Missing required `generate` function')
      }
      if (!isNumber(config.itemCount)) {
        throw Error('Missing required `itemCount` number')
      }

      if (newConfig.itemCount != null || newConfig.itemHeight != null) {
        if (isNumber(config.itemHeight)) {
          this._itemHeights = Array(config.itemCount).fill(config.itemHeight)
        } else if (Array.isArray(config.itemHeight)) {
          this._itemHeights = config.itemHeight
        } else {
          throw Error('Missing required `itemHeight` number or array')
        }
      }
    }

    // The element that enforces the scroll height.
    const scroller = this._scroller || document.createElement('div')

    const scrollerHeight = config.itemHeight * config.itemCount
    const maxElementHeight = this._maxElementHeight

    if (scrollerHeight > maxElementHeight) {
      console.warn([
        'HyperList: The maximum element height', maxElementHeight + 'px has',
        'been exceeded; please reduce your item height.'
      ].join(' '))
    }

    // The container element must have a relative position
    // for the rows to be absolutely positioned within.
    const overflow = config.horizontal ? 'overflow-x' : 'overflow-y'
    this._element.style.cssText += `position: relative; ${overflow}: auto;`

    const crossAxis = config.horizontal ? 'height' : 'width'
    const scrollAxis = config.horizontal ? 'width' : 'height'
    scroller.style.cssText += `
      opacity: 0;
      position: absolute;
      ${crossAxis}: 1px;
      ${scrollAxis}: ${scrollerHeight}px;
    `

    // Only append the scroller element once.
    if (elementChanged || !this._scroller) {
      this._element.appendChild(scroller)
      this._scroller = scroller
    }

    // Set the scroller instance.
    this._scrollHeight = this._computeScrollHeight()

    // Reuse the item positions if refreshed, otherwise set to empty array.
    if (!this._itemPositions) {
      this._itemPositions = Array(config.itemCount).fill(0)
    }

    // Each index in the array should represent the position in the DOM.
    this._computePositions(0)

    // Render after refreshing. Force render if we're calling refresh manually.
    if (this._scrollHeight) {
      this._renderChunk(this._lastRepaint !== null)
    }

    if (typeof config.afterRender === 'function') {
      config.afterRender()
    }
  }

  _getRow (i) {
    const config = this._config
    let item = config.generate(i)
    let height = item.height

    if (height !== undefined && isNumber(height)) {
      item = item.element

      // The height isn't the same as predicted, compute positions again
      if (height !== this._itemHeights[i]) {
        this._itemHeights[i] = height
        this._computePositions(i)
        this._scrollHeight = this._computeScrollHeight(i)
      }
    } else {
      height = this._itemHeights[i]
    }

    if (!item || item.nodeType !== 1) {
      throw new Error(`Generator did not return a DOM Node for index: ${i}`)
    }

    addClass(item, config.rowClassName || 'vrow')

    const top = this._itemPositions[i]

    HyperList.mergeStyle(item, {
      position: 'absolute',
      [config.horizontal ? 'left' : 'top']: `${top}px`
    })

    return item
  }

  _getScrollPosition () {
    const config = this._config

    if (typeof config.overrideScrollPosition === 'function') {
      return config.overrideScrollPosition()
    }

    return this._element[config.horizontal ? 'scrollLeft' : 'scrollTop']
  }

  _renderChunk (force) {
    const config = this._config
    const element = this._element
    const scrollTop = this._getScrollPosition()
    const itemCount = config.itemCount

    let from = config.reverse ? this._getReverseFrom(scrollTop) : this._getFrom(scrollTop) - 1

    if (from < 0 || from - this._screenItemsLen < 0) {
      from = 0
    }

    if (!force && this._lastFrom === from) {
      return false
    }

    this._lastFrom = from

    let to = from + this._cachedItemsLen

    if (to > itemCount || to + this._cachedItemsLen > itemCount) {
      to = itemCount
    }

    // Append all the new rows in a document fragment that we will later append
    // to the parent node
    const fragment = config.useFragment ? document.createDocumentFragment() : [
      // Sometimes you'll pass fake elements to this tool and Fragments require
      // real elements.
    ]

    // The element that forces the container to scroll.
    const scroller = this._scroller

    // Keep the scroller in the list of children.
    fragment[config.useFragment ? 'appendChild' : 'push'](scroller)

    for (let i = from; i < to; i++) {
      let row = this._getRow(i)

      fragment[config.useFragment ? 'appendChild' : 'push'](row)
    }

    if (config.applyPatch) {
      return config.applyPatch(element, fragment)
    }

    element.innerHTML = ''
    element.appendChild(fragment)
  }

  _computePositions (from = 1) {
    const config = this._config
    const itemCount = config.itemCount
    const reverse = config.reverse

    if (from < 1 && !reverse) {
      from = 1
    }

    for (let i = from; i < itemCount; i++) {
      if (reverse) {
        if (i === 0) {
          this._itemPositions[0] = this._scrollHeight - this._itemHeights[0]
        } else {
          this._itemPositions[i] = this._itemPositions[i - 1] - this._itemHeights[i]
        }
      } else {
        this._itemPositions[i] = this._itemHeights[i - 1] + this._itemPositions[i - 1]
      }
    }
  }

  _computeScrollHeight () {
    const config = this._config
    const isHoriz = Boolean(config.horizontal)
    const itemCount = config.itemCount
    const scrollHeight = this._itemHeights.reduce((a, b) => a + b, 0)

    HyperList.mergeStyle(this._scroller, {
      opacity: 0,
      position: 'absolute',
      [isHoriz ? 'height' : 'width']: '1px',
      [isHoriz ? 'width' : 'height']: `${scrollHeight}px`
    })

    // Calculate the height median
    const sortedItemHeights = this._itemHeights.slice(0).sort((a, b) => a - b)
    const middle = Math.floor(itemCount / 2)
    const averageHeight = itemCount % 2 === 0
      ? (sortedItemHeights[middle] + sortedItemHeights[middle - 1]) / 2
      : sortedItemHeights[middle]

    const clientProp = isHoriz ? 'clientWidth' : 'clientHeight'
    this._containerSize = this._element[clientProp]
    this._screenItemsLen = Math.ceil(this._containerSize / averageHeight)

    // Cache 3 times the number of items that fit in the container viewport.
    this._cachedItemsLen = Math.max(this._cachedItemsLen || 0, this._screenItemsLen * 3)
    this._averageHeight = averageHeight

    if (config.reverse) {
      window.requestAnimationFrame(() => {
        if (isHoriz) {
          this._element.scrollLeft = scrollHeight
        } else {
          this._element.scrollTop = scrollHeight
        }
      })
    }

    return scrollHeight
  }

  _getFrom (scrollTop) {
    let i = 0

    while (this._itemPositions[i] < scrollTop) {
      i++
    }

    return i
  }

  _getReverseFrom (scrollTop) {
    let i = this._config.itemCount - 1

    while (i > 0 && this._itemPositions[i] < scrollTop + this._containerSize) {
      i--
    }

    return i
  }
}
