## HyperList

This is a simple component that can be dropped into any JavaScript application
and provide a virtual scrolling area that is highly performant and lightweight.
With zero dependencies and well under 300 lines of code sans comments, it is
easy to understand and use.

#### Required Configuration

These properties must be passed to the constructor.

- `itemCount` The number of items in the list.
- `itemHeight` A single value that is the height for every single element in
  the list.
- `generate` A function that is called with the index to render. You return an
  element to render in that position.

#### Optional Configuration

- `width` The container width as a number or string (defaults to `100%`)
- `height` The container height as a number or string (defaults to `100%`)
- `rowClassName` Any custom classes to add to the row.
- `applyPatch` Is called with the container element and the DocumentFragment
  which contains all the items being added. You can implement Virtual DOM
  patching with this hook.
- `afterRender` - Triggered after `applyPatch` has returned.
- `useFragment` - Determines if a fragment is used internally or not, defaults
  to true.

