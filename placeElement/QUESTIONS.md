# Open Design Questions

## Privacy-preserving rendering

WebGL/WebGPU requires all rendered content to be privacy preserving, meaning any content for either drawElement or placeElement must be privacy preserving for use in WebGL/WebGPU. See [Issue #5](https://github.com/WICG/canvas-place-element/issues/5).

## Complexity of rendering certain elements

It’s possible that some elements may not be renderable to a texture (2D or 3D). For those cases, we are ready to have an initial disallowed list of elements to simplify implementation by UAs. For those cases, `placeElement()` could return null to indicate this `placeElement` is not supported. [Issue #7](https://github.com/WICG/canvas-place-element/issues/7) was created to develop the disallow list.

## Re-compositing for placeElement

`placeElement` requires the browser to recompose the canvas buffer each time the element changes. This should be equivalent to rendering all commands executed on the canvas with the latest contents for each placed element. If implemented as such, this would be inefficient since the buffer of commands can grow unbounded.

The browser could optimize by squashing sets of commands into buffers at `placeElement` boundaries whenever possible (each `saveLayer` would also need to split up?).

## Hit Testing Data structures

The canvas subtree is laid out based on the DOM/style applied to the elements giving geometric locations as if it was painted as a child of the canvas. However, the element is painted in the location given by placeElement, the transform stack, and so on.

This affects both hit-testing and behaviour of platform APIs (like `IntersectionObserver`) which allows authors to observe the position of these elements. This is the data provided by `CanvasDrawElements::updateElement` API for drawElement mode and done automatically by the browser for `placeElement` mode.

There are also issues with mouseDown and other similar events that should go to the topmost element (or bubbled). What happens when canvas content is drawn over the element? See [Issue #9](https://github.com/WICG/canvas-place-element/issues/9).

## Accessibility

Elements in fallback content which are passed to `placeElement()`
are still exposed to assistive technology APIs,
just like all other canvas fallback content.

If authors wish to use canvas fallback content as a "staging area"
for content which may later be shown to sighted users using `placeElement()`,
they should take care to hide that content from assistive technology. See [Issue #11](https://github.com/WICG/canvas-place-element/issues/11) for discussion on how to address this problem.

## Other issues

1. Should placed elements be direct children of the canvas or any descendant is ok? Might be harder to fake the element’s rendered position in the canvas if there are boxes between the canvas and the element in the tree. Any descendant would also reuire complex testing to see if the content was already placed due to a ancestor.
2. How are non-placed canvas children represented in the layout tree. We likely need to layout the entire subtree (especially if a placed element can be a descendant) and make everything not placed visibility: hidden so they are not painted and inert.
3. Should we force containment (layout or paint) on canvas to ensure the children don’t affect the layout of the rest of the Document?
4. Is it worth providing the invalidation rect (based on element bounds) or will authors always do full redraw?
5. Should draw commands after placeElement block the interaction rect of elements (since they would occlude the element)? Should there be a context state to control this behavior?
6. When painting the elements, which box should be painted? Should it include shadow? If so, how does the developer know what is the full rendered size?
7. If developers want to align placeElements (either by baseline or box), how are they supposed to do it?
8. What happens to placed inline elements?
9. Clarify the timing for when the image is generated when using `drawImage`. Ideally it should be at the end of all script callbacks during [update the rendering](https://html.spec.whatwg.org/\#update-the-rendering) but unclear whether that’s possible for 3D.
10. The author might draw a subset of the element. Should we add a “src rect” to updateElement. This would then define the containing block dimensions for resolving percentages, container queries, etc.
11. Placed elements must be stacking contexts. Do we need any other restriction?
12. Should we force blockifying canvas children?
13. What about viewport-relative CSS units? Should the viewport be the canvas?
14. What is the element's intrinsic size for drawImage etc?
15. Code infrastructure similar to `drawElement` may make it possible to implement the [`element()`](https://developer.mozilla.org/en-US/docs/Web/CSS/element) image source in html (used in background rendering).


