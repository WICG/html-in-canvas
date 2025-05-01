# Implementation Details

Here is a summary of the implementation details of this spec in Chromium. Its function is to illustrate some of the potential challenges of a placeElement implementation.

## **Render Canvas Descendants**

The following changes are needed to layout and paint canvas descendants so their image can be used by drawImage/texImage2D/externalTexImage2D:

* Layout for canvas children
  Generally children of replaced elements are ignored by layout. The exception to this has been video elements which use a shadow DOM to render controls: [LayoutMedia::CanHaveChildren](https://source.chromium.org/chromium/chromium/src/+/main:third\_party/blink/renderer/core/layout/layout\_media.h;l=90;drc=5fe1b0cf06707a12a5f48d1828ad173a76ee31ab). If a canvas uses the proposed APIs above, this mode will be supported for canvas as well.

* Privacy preserving rendering.
  Visited links, dictionary spell checking, etc.

* Painting
  The canvas subtree goes through the pre-paint step during the regular lifecycle update as usual (except for update element position below). However the subtree is skipped during paint when preparing the display list forwarded to the compositor.

  Instead an independent paint step is triggered similar to [DataTransfer::NodeImage](https://source.chromium.org/chromium/chromium/src/+/main:third\_party/blink/renderer/core/clipboard/data\_transfer.h;l=155;drc=20135c10f0869fdefb75d990ec84143a649d84c3) to generate a PaintRecord for the element which is appended to the canvas display list (for 2D) or rasterized to a texture (for 3D).

  This step will need to support caching the painted output.

## **Make Elements Interactive/Animated**

This is the set of changes required to make elements rendered onto the canvas interactive and animated.

* Invalidation signal
  placedElements needs to signal to canvas that it needs to redraw itself; drawElements needs to trigger an event to tell JS that the element has been updated.

* Update element position
  From a position perspective, placeElement() is equivalent to drawElement with updateElement() being called with the canvas’ CTM at the time of placeElement(). Both those paths need to update the element’s “final real position”. In Chrome, this was done through a transform paint property node, that is equivalent to what other CSS properties (like transform) generate.

* Update element stacking
  Similar to above, generally hit-testing depends on the order for paint layers to decide which element draws on top. This stacking is generated based on the DOM order \+ styles (z-order) applied to the elements. In Chrome, this is done by modifying the paint layer iteration order based on the stacking for placeElement(), or the zOrder provided by updateElement().

* Forcing main thread animations
  For drawElement interactive mode (used by 3D) all animations and interaction needs to be forced to run on the main thread. This includes the following features:
  * Composited animations like transform, opacity, filter etc.
  * Scrolling
  * Off thread paint worklets
  * Video

  There are already code-paths to run these on the main thread in some cases which can be reused. But some features are only supported in the compositor: animation images, OOPIFs. Animated image can be main thread driven, so support can be added incrementally. OOPIF support is not needed due to privacy restrictions.


* Hit Testing in the compositor
  The compositor gets hit test regions to allow faster interaction without going back to the main thread. For example, regions which have a non-passive touch handler or main thread scrolling regions. This data will need to be added to the canvas’s CC layer for placed elements.

## **Make Canvas2D auto-redraw on placeElement**

For Canvas2D to support “auto redrawing” when its placed element has updated, there were a couple techniques we considered to combine the rendering of placed elements with regular canvas drawing.

Currently each canvas is represented as a single TextureLayer in the compositing stack. The paint commands added to the canvas are serialized directly from the renderer main thread to the GPU process to update the texture referenced by this layer, which composites it with the rest of the Document.

1. Display list with references. Keep canvas drawing commands as a display list and add references to where placeElement rendering should go. At rendering time, build a final display list and render it.

   This is the simplest approach but can be inefficient because canvas needs to persist all commands added to it since the last reset.

2. Layered canvas. When there’s a placeElement call, all previous canvas2D drawings get collapsed into a texture. Canvas manages this list of textures \+ placeElement rendering and composites them in order.

   This is an optimization to the approach above. It allows for re-presenting the canvas with the updated elements without redrawing all the canvas commands.

3. Layered compositing. Similar to layered canvas, but instead of canvas managing the final compositing, it is deferred to the compositor. The canvas is represented as a list of layers to the compositor instead of a single layer.

   This list is made up of TextureLayers (for collapsed commands) and the placedElement’s contents are represented by a list of layers produced by the paint system similar to the regular rendering of web content. The main pro of this approach is threaded rendering/scrolling since placed elements are rendered similar to non-canvas elements.

Note: Both \#1 and \#2 will require main thread invalidation \+ redraw of the canvas using the same signal provided to script. \#3 can use the regular paint invalidation code-path to commit a new display list to the compositor.


