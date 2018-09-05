'use strict'

// TODO: Add option for rendering rows across several frames.

// import {onFrameStart, onFrameRender} from 'framesync'
import isObject from 'is-object'
import $ from 'umbrella'

export default class HyperList {
  constructor(options) {
    if (!isObject(options)) {
      throw TypeError('Expected an options object')
    }

    let {root} = options
    if (options instanceof Element) {
      root = options
      options = {}
    }
    if (!root || root.nodeType != 1) {
      throw TypeError('Expected an element node')
    }

    this._root = root
    this._rows = []
    this._window = null
    this._contentLength = 0

    // The root element must have a relative position
    // for the rows to be absolutely positioned within.
    root.style.cssText += `position: relative; overflow-y: auto;`

    const {renderRow} = options
    if (renderRow != null) {
      if (typeof renderRow != 'function') {
        throw TypeError('`renderRow` must be a function')
      }
      this._renderRow = renderRow
    } else {
      // Assume the rows were added via the `append` method.
      this._renderRow = (i, row) => row.node
    }

    const {rowLength} = options
    if (rowLength != null) {
      if (!isNumber(rowLength)) {
        throw TypeError('`rowLength` must be a number')
      }
      this._rowLength = rowLength
    }

    const {padding} = options
    if (padding != null) {
      if (!isNumber(padding)) {
        throw TypeError('`padding` must be a number')
      }
      this._padding = padding
    } else {
      this._padding = 0
    }
  }

  // Increase the row count without re-rendering.
  expand(count) {
    throw Error('Not yet implemented')
  }

  append(row) {
    if (!isObject(row)) {
      throw TypeError('Expected an object')
    }
    const {node} = row
    if (node && node.nodeType != 1) {
      throw TypeError('Expected an element node')
    }

    if (!isNumber(row.length)) {
      if (this._rowLength) {
        row.length = this._rowLength
      } else {
        throw Error('Must provide a row length')
      }
    }

    const i = this._rows.push(row) - 1
    if (this._window) {
      row.start = this._contentLength
      row.visible = row.start < this._window.end

      node.style.cssText += `
        position: absolute;
        width: 100%;
        top: ${row.start}px;
        ${row.visible ? '' : 'visibility: hidden;'}
      `

      // console.log('Inserting row #' + i + ' => ', row)
      this._root.appendChild(node)
      this._contentLength += row.length
    }
    else if (this._refreshLoop == null) {
      this._refreshOnScroll(true)
    }
  }

  // Update row count and re-render all rows.
  refresh(options = {}) {
    let {rowCount, rowLength, renderRow} = options

    const rows = this._rows
    if (isNumber(rowCount) && rowCount != rows.length) {
      if (rows.length > rowCount) {
        this._removeRows(rowCount, rows.length - 1)
      }
      rows.length = rowCount
    } else {
      rowCount = rows.length
    }

    if (isNumber(rowLength)) {
      this._rowLength = rowLength
    }
    if (typeof renderRow == 'function') {
      this._renderRow = renderRow
    }

    let node
    while (node = this._root.firstChild) {
      this._root.removeChild(node)
    }

    if (rowCount) {
      this._renderRows()
      if (this._refreshLoop == null) {
        this._refreshOnScroll()
      }
    } else {
      $(this._root).off('scroll')
      cancelAnimationFrame(this._refreshLoop)
      this._refreshLoop = null
    }
  }

  _refreshOnScroll(refresh) {
    let scrolled = refresh == true

    // Scroll events trigger a refresh on the next frame.
    $(this._root).on('scroll', function() {
      scrolled = true
    })

    // Refresh (at most) once per frame.
    let eachFrame = () => {
      if (scrolled) {
        scrolled = false
        if (this._window) {
          this._refreshWindow()
        } else {
          this._renderRows()
        }
      }
      this._refreshLoop = requestAnimationFrame(eachFrame)
    }
    this._refreshLoop = requestAnimationFrame(eachFrame)
  }

  // TODO: Add a limit per frame, and a start point.
  _renderRows() {
    const root = this._root
    const rows = this._rows
    const render = this._renderRow

    // The "visible" boundaries.
    const start = root.scrollTop - this._padding
    const end = root.scrollTop + root.clientHeight + this._padding

    let i = -1, len = 0, first = -1, last = -1
    while (++i < rows.length) {
      let row = rows[i]
      if (!row) rows[i] = row = {}

      // The `render` function can choose to reuse cached nodes.
      const node = render(i, row) || null
      if (!node) continue
      if (node != row.node) {
        row.node = node
      }

      // The row length must be set within `render` unless
      // a default length was setup via the `rowLength` option.
      if (!isNumber(row.length)) {
        if (this._rowLength) {
          row.length = this._rowLength
        } else {
          throw Error('Must provide a row length')
        }
      }

      row.start = len
      row.visible = row.start < end && row.start + row.length > start

      if (row.visible) {
        if (first < 0) first = i
        last = i
      }

      node.style.cssText += `
        position: absolute;
        width: 100%;
        top: ${row.start}px;
        ${row.visible ? '' : 'visibility: hidden;'}
      `

      // console.log('Inserting row #' + i + ' => ', row)
      root.appendChild(node)
      len += row.length
    }

    this._contentLength = len
    this._window = {start, end, first, last}
    // console.log('window => ' + JSON.stringify(this._window))
  }

  // Do not call this when `this._rows.length == 0`
  _refreshWindow() {
    const win = this._window
    const root = this._root

    // Where the next window begins (in pixels).
    const start = Math.max(0, root.scrollTop - this._padding)

    // Assume the window is unchanged if `start` is unchanged.
    // If that assumption is false, the `_window` should be set to null,
    // or the `_window` should be updated with some other method.
    // Avoid the assumption if the window is empty.
    if (start == win.start && win.first >= 0) return

    // Where the next window ends (in pixels).
    const end = Math.min(this._contentLength,
      root.scrollTop + root.clientHeight + this._padding)

    const rows = this._rows
    let i, row, first = -1, last = -1
    if (start > win.start) {
      // Remove offscreen rows *before* the new window.
      if (win.first >= 0) {
        i = win.first
        let len = win.start
        do {
          const row = rows[i]

          // The first row in the previous window may start before the window starts.
          len += row.length - Math.max(0, win.start - row.start)
          if (len <= start) {
            // console.log('Hiding row #' + i)
            this._hideRow(row)
          } else {
            first = i
            break
          }
        } while (++i <= win.last)
      }

      // Find the first row (if not within the previous window).
      if (first < 0) {
        first = this._findRow(i, start, 1)
        if (rows[first].start + rows[first].length < start) {
          throw Error('Unable to find first row in window')
        }
      }

      // Fast path for knowing when a window is unchanged.
      else if (first == win.first) {
        row = rows[win.last]
        if (row && row.start + row.length > end) {
          return // Definitely no new rows to render.
        }
      }

      // Display any hidden rows.
      last = this._displayRows(first, end, 1)

      // Remove offscreen rows *after* the new window.
      if (last < win.last) {
        i = last
        while (++i <= win.last) {
          const row = rows[i]
          // console.log('Hiding row #' + i)
          this._hideRow(row)
        }
      }
    }
    else {
      // Remove offscreen rows *after* the new window.
      if (win.first >= 0) {
        i = win.last + 1
        let len = win.end
        while (--i >= win.first) {
          const row = rows[i]
          // The last row in the previous window may end after the window ends.
          len -= Math.min(win.end - row.start, row.length)
          if (len < end) {
            last = i
            break
          }
          // console.log('Hiding row #' + i)
          this._hideRow(row)
        }
      }

      // Find the last row (if not within the previous window).
      if (last < 0) {
        last = this._findRow(i, end, -1)
        if (rows[last].start > end) {
          throw Error('Unable to find last row in window')
        }
      }

      // Fast path for knowing when a window is unchanged.
      else if (last == win.last) {
        row = rows[win.first]
        if (row && row.start < end) {
          return // Definitely no new rows to render.
        }
      }

      // Display any hidden rows.
      first = this._displayRows(last, start, -1)

      // Remove offscreen rows *before* the new window.
      if (first > win.first) {
        i = first
        while (--i >= win.first) {
          const row = rows[i]
          // console.log('Hiding row #' + i)
          this._hideRow(row)
        }
      }
    }

    if (first != win.first) {
      console.log('win.first = ' + first)
    }
    if (last != win.last) {
      console.log('win.last = ' + last)
    }

    this._window = {start, end, first, last}
    // console.log(`window => ` + JSON.stringify(this._window))
  }

  // Do not call this when `this._rows.length == 0`
  _findRow(startIndex, endLength, direction) {
    if (startIndex < 0) return 0
    const rows = this._rows
    if (startIndex >= rows.length) {
      return rows.length - 1
    }
    let i = startIndex, len = rows[i].start
    while (true) {
      const row = rows[i += direction]
      if (direction < 0) {
        len -= row.length
        if (len < endLength || i == 0) {
          return i
        }
      } else {
        len += row.length
        if (len > endLength || i == rows.length) {
          return i
        }
      }
    }
  }

  _hideRow(row) {
    row.visible = false
    row.node.cssText += 'visibility: hidden'
    if (row.onHide) row.onHide()
  }

  _displayRows(startIndex, endLength, direction) {
    const rows = this._rows

    let i = startIndex, row = rows[i]
    let len = row.start, endIndex = 0
    if (direction > 0) {
      endIndex = rows.length - 1
    } else {
      len += row.length
    }

    while (true) {
      if (!row.visible) {
        // console.log('Showing row #' + i)
        row.visible = true
        row.node.style.removeProperty('visibility')
        if (row.onDisplay) row.onDisplay()
      }

      len += row.length * direction
      if (direction > 0) {
        if (len >= endLength || i == endIndex) break
      } else {
        if (len <= endLength || i == endIndex) break
      }
      row = rows[i += direction]
    }

    // Return the last visible index.
    return i
  }

  _removeRows(startIndex, endIndex) {
    const root = this._root
    const rows = this._rows

    let i = startIndex, len = 0
    do {
      const row = rows[i]
      root.removeChild(row.node)
      len += row.length
    } while (++i <= endIndex)

    this._contentLength -= len
    rows.splice(startIndex, 1 + endIndex - startIndex)

    // Update the start offsets of any rows after.
    const maxIndex = rows.length - 1
    if (endIndex < maxIndex) {
      while (++i <= maxIndex) {
        rows[i].start -= len
      }
    }

    // Update the window if removing visible rows.
    const win = this._window
    if (win && win.start <= endIndex && win.end >= startIndex) {
      if (win.start >= startIndex) {
        win.start = endIndex + 1
      }
      if (win.end <= endIndex) {
        win.end = startIndex - 1
      }
      if (win.end - win.start < 0) {
        this._window = null
      }
      // console.log(`window => ` + JSON.stringify(this._window))
      this._renderVisible()
    }
  }
}

function isNumber(x) {
  return typeof x == 'number' && !isNaN(x)
}
