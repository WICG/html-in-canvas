# HTML-in-Canvas

This is a proposal for using 2D and 3D `<canvas>` to customize the rendering of HTML content.

## Status

This is a living explainer which is continuously updated as we receive feedback.

The APIs described here are implemented behind a flag in Chromium and can be enabled with `chrome://flags/#canvas-draw-element`.

## Motivation

There is no web API to easily render complex layouts of text and other content into a `<canvas>`. As a result, `<canvas>`-based content suffers in accessibility, internationalization, performance, and quality.

### Use cases

* **Styled, Laid Out Content in Canvas.** There’s a strong need for better styled text support in Canvas. Examples include chart components (legend, axes, etc.), rich content boxes in creative tools, and in-game menus.
* **Accessibility Improvements.** Maintaining accessible `<canvas>` experiences requires manually synchronizing auxiliary DOM subtrees with canvas draw calls.
* **Composing HTML Elements with Effects.** A limited set of CSS effects, such as filters, backdrop-filter, and mix-blend-mode are already available, but there is a desire to use general WebGL shaders with HTML.
* **HTML Rendering in a 3D Context.** 3D aspects of sites and games need to render rich 2D content into surfaces within a 3D scene.
* **Media Export.** There's a need to export HTML content as images or video.

## Proposed solution

The solution introduces five primitives to manage canvas layout, drawing capabilities, rendering events for DOM-to-canvas synchronization, and geometry update capabilities for canvas-to-DOM synchronization.

### 1. The `layoutsubtree` attribute
The `layoutsubtree` attribute on a `<canvas>` element opts in canvas descendants to layout. The canvas element blockifies immediate descendants and they are laid out with static positioning. In terms of accessibility, canvas descendants work like regular DOM content and respect CSS/HTML primitives like `aria-hidden="true"`, but initially do not have geometry information (for more information, see [Accessibility](#accessibility)). In terms of hit testing, canvas descendants are initially not hit testable.

### 2. The `drawable` attribute
The `drawable` attribute on `<canvas>` descendant elements is required for drawing, and implies `isolation: isolate` as well as being a containing block for all descendants. `drawable` elements can be nested, and a _drawable subtree_ includes a drawable element and its descendants, excluding descendants that are marked as drawable.

### 3. The `paint` event
The `paint` event enables synchronizing the DOM with canvas. A snapshot of the rendering commands of all `drawable` elements, including their drawable subtrees, of the canvas is recorded on every rendering update. The canvas `paint` event fires if an element's snapshot would be drawn differently. This event fires just after intersection observer steps have run during [update-the-rendering](https://html.spec.whatwg.org/#update-the-rendering). The event contains a list of the canvas `drawable` descendants which have changed. Canvas drawing commands made in the `paint` event will appear in the current frame, but DOM changes made in the `paint` event will not show up until the subsequent frame. If there are multiple `<canvas>` elements, the `paint` event fires in _reverse_ tree order which ensures that descendants fire `paint` before ancestors.

To support application patterns which update every frame, a new `requestPaint()` function is added which will cause the `paint` event to fire once during the next rendering opportunity, even if no canvas descendants have changed (analogous to `requestAnimationFrame()`).

### 4. `drawElementImage` (and WebGL: `texElementSubImage2D`, WebGPU: `drawElementImageToTexture`)
The `drawElementImage()` method draws the last snapshot of a `drawable` element, and its drawable subtree, into the 2D canvas, and similar APIs are provided for WebGL and WebGPU to draw into a texture. The rendering starts at the element's border box, before CSS transformations. Similar to the 2D [drawImage](https://html.spec.whatwg.org/multipage/canvas.html#dom-context-2d-drawimage-dev), and similar WebGL/WebGPU APIs, optional source and destination rect parameters can be provided. The source rect parameters can be used to apply outsets to the drawn element, either for clipping or to include ink overflow extending beyond the element's border box. The destination rect parameters can be used to position and scale the drawn element. An exception is thrown if `drawElementImage()` is called with an element without the `drawable` attribute, before an initial snapshot has been recorded, or for elements with other canvas ancestors.

A reference to the most recent snapshot of a `drawable` element can be acquired as an `ElementImage` using `captureElementImage`. These objects can be transferred to a worker and drawn to an `OffscreenCanvas`.

### 5. Synchronizing the DOM and drawing
The `updateElementGeometry` method enables synchronizing the element's canvas drawing with the DOM:
* Hit test order can be set to the top or left unmodified with `preserveHitTestOrder`. The canvas maintains an ordered list of drawable descendants to hit test, and hit testing proceeds straight from the canvas element to each descendant, skipping intervening clips and transforms.
* The DOM position of a `drawable` element can be set with a canvas element transform, which is a DOMMatrix that transforms the element's border-box, before CSS transformations, to the drawn location in the canvas. The canvas element transform is not used for rendering, so changes to it do not cause the `paint` event to fire in the next frame. When the canvas element transform is set, the element's accessibility information is updated to include geometry information (for more information, see [Accessibility](#accessibility)).

The `clearElementGeometry` method clears the above state.

`updateElementGeometry` is automatically run when drawing an element into a 2D context using `drawElementImage`. This behavior can be customized with `DrawElementImageOptions` by passing `{ preserveElementGeometry: true }` to `drawElementImage` to disable automatic geometry updates. 3D contexts must call `updateElementGeometry` because, unlike 2D contexts, the transform from the element's drawn location in a texture to the canvas's CSS coordinates is not available in the canvas API.

On worker threads there is no synchronous access to DOM APIs. When updating element geometry for an `OffscreenCanvas` (note that only `ElementImage` references may be passed from a worker), the updates are added to an internal pending notification queue, and a microtask is queued to batch them. On a worker thread, this microtask asynchronously posts a task to the main thread. Main-thread `OffscreenCanvas` geometry updates are similarly batched via a microtask. When the main-thread updates complete, the elements synchronously apply their geometry changes, and an `elementgeometryupdate` event is fired on the associated `HTMLCanvasElement` with a list of the elements that were updated. If an element no longer exists when the event fires, it is omitted from the list. This batching approach, as opposed to issuing a stand-alone update for each drawing API call, is similar to existing "observer" APIs and ensures that updates are applied atomically without other tasks interleaving.

### Basic Example

<img width="250" height="38" alt="a screenshot showing a form element with a blinking cursor" src="https://github.com/user-attachments/assets/acbdd231-3259-4819-b57e-32e29c460fc9" />

```html
<canvas id="canvas" style="width: 400px; height: 200px;" layoutsubtree>
  <form drawable id="form_element">
    <label for="name">name:</label>
    <input id="name">
  </form>
</canvas>

<script>
  const ctx = document.getElementById('canvas').getContext('2d');

  canvas.onpaint = () => {
    ctx.reset();
    ctx.drawElementImage(form_element, 100, 0);
  };

  // Size the canvas grid to match the device scale factor.
  new ResizeObserver(([entry]) => {
    canvas.width = entry.contentRect.width * devicePixelRatio;
    canvas.height = entry.contentRect.height * devicePixelRatio;
  }).observe(canvas);
</script>
```

### OffscreenCanvas Example

In this example, `OffscreenCanvas` in a worker is used. The `canvas` child form is captured as an `ElementImage` object in the `paint` event and transferred to the worker for painting.

```html
<!DOCTYPE html>
<canvas id="canvas" style="width: 400px; height: 400px;" layoutsubtree>
  <form drawable id="form">
    <label for="name">name:</label>
    <input id="name">
  </form>
</canvas>

<script>
  const workerCode = `
    let ctx;
    self.onmessage = (e) => {
      if (e.data.canvas) {
        ctx = e.data.canvas.getContext('2d');
      }
      if (e.data.width && e.data.height) {
        ctx.canvas.width = e.data.width;
        ctx.canvas.height = e.data.height;
      }
      // Draw and sync.
      if (e.data.form) {
        ctx.reset();
        ctx.drawElementImage(e.data.form, 100, 0);
      }
    };
  `;

  const worker = new Worker(URL.createObjectURL(new Blob([workerCode])));
  const offscreen = canvas.transferControlToOffscreen();

  worker.postMessage({ canvas: offscreen }, [offscreen]);

  canvas.onpaint = () => {
    const formImg = canvas.captureElementImage(form);
    worker.postMessage({ form: formImg }, [ formImg ]);
  };

  // OffscreenCanvas notification of element geometry updates.
  canvas.onelementgeometryupdate = () => {
    // #form's canvas element transform would now be updated. For example,
    // form.getBoundingClientRect() would include an x translation of 100.
  };

  // Size the canvas grid to match the device scale factor.
  new ResizeObserver(([entry]) => {
    worker.postMessage({
      width: entry.contentRect.width * devicePixelRatio,
      height: entry.contentRect.height * devicePixelRatio
    });
    canvas.requestPaint();
  }).observe(canvas);
</script>
```

### IDL changes
```idl
dictionary UpdateElementGeometryOptions {
  // Controls how the canvas's hit testing order stack should be modified. If
  // this is true and the element is already in the canvas's hit testing stack,
  // do nothing. In all other cases, place the element at the top of the
  // canvas's hit testing stack.
  boolean preserveHitTestOrder = false;

  // Sets the element's canvas transform which maps the element's border box,
  // before CSS transforms, to the canvas. If omitted, the pre-existing value
  // of the element's canvas transform is preserved.
  DOMMatrixInit canvasTransform;
};

partial interface HTMLCanvasElement {
  [CEReactions, Reflect] attribute boolean layoutSubtree;

  attribute EventHandler onpaint;

  void requestPaint();

  ElementImage captureElementImage(Element element);

  // Allows manual geometry updates (primarily for WebGL/WebGPU).
  void updateElementGeometry(
      (Element or ElementImage) element,
      optional UpdateElementGeometryOptions options = {});
  void clearElementGeometry((Element or ElementImage) element);

  // Returns the current transform applied to the Element to map its
  // border box, before CSS transforms, to the canvas coordinate space, or
  // an identity DOMMatrix if no transform has been set. Updated
  // with `updateElementGeometry` and cleared with `clearElementGeometry`.
  [NewObject] DOMMatrix getElementTransform(Element element);

  // Fired when the browser completes applying geometry updates originating
  // from an OffscreenCanvas.
  attribute EventHandler onelementgeometryupdate;
};

partial interface OffscreenCanvas {
  // Updates the element's geometry. When called from a worker thread,
  // only `ElementImage` may be passed. Worker-thread updates are
  // batched via a microtask and asynchronously posted to the main
  // thread. Main-thread updates are also batched via a microtask. When
  // the main-thread updates of element geometry complete, an
  // `elementgeometryupdate` event is fired on the associated
  // HTMLCanvasElement.
  void updateElementGeometry(
      (Element or ElementImage) element,
      optional UpdateElementGeometryOptions options = {});

  // Clears the element's geometry and fires `elementgeometryupdate`
  // like `updateElementGeometry`.
  void clearElementGeometry((Element or ElementImage) element);
};

dictionary DrawElementImageOptions {
  // If true, prevents the automatic update of the Element's geometry.
  // If false, automatically updates the Element's geometry by calling
  // `updateElementGeometry` with a `canvasTransform` that maps the element's
  // border-box to the drawn position in the canvas.
  boolean preserveElementGeometry = false;
};

interface mixin CanvasDrawElementImage {
  void drawElementImage(
      (Element or ElementImage) element,
      unrestricted double dx, unrestricted double dy,
      optional DrawElementImageOptions options = {});

  void drawElementImage(
      (Element or ElementImage) element,
      unrestricted double dx, unrestricted double dy,
      unrestricted double dwidth, unrestricted double dheight,
      optional DrawElementImageOptions options = {});

  void drawElementImage(
      (Element or ElementImage) element,
      unrestricted double sx, unrestricted double sy,
      unrestricted double swidth, unrestricted double sheight,
      unrestricted double dx, unrestricted double dy,
      optional DrawElementImageOptions options = {});

  void drawElementImage(
      (Element or ElementImage) element,
      unrestricted double sx, unrestricted double sy,
      unrestricted double swidth, unrestricted double sheight,
      unrestricted double dx, unrestricted double dy,
      unrestricted double dwidth, unrestricted double dheight,
      optional DrawElementImageOptions options = {});
};

CanvasRenderingContext2D includes CanvasDrawElementImage;
OffscreenCanvasRenderingContext2D includes CanvasDrawElementImage;

dictionary WebGLCopyElementImageConfig {
  GLfloat sx;
  GLfloat sy;
  GLfloat swidth;
  GLfloat sheight;
  GLsizei width;
  GLsizei height;
};

partial interface WebGLRenderingContext {
  void texElementSubImage2D(
      GLenum target, GLint level,
      GLint xoffset, GLint yoffset,
      (Element or ElementImage) element,
      optional WebGLCopyElementImageConfig config = {});
};

dictionary GPUDrawElementImageDestination {
  required GPUImageCopyTextureTagged destination;
  GPUIntegerCoordinate width;
  GPUIntegerCoordinate height;
};

dictionary GPUDrawElementImageSource {
  required (Element or ElementImage) source;
  float sourceX;
  float sourceY;
  float sourceWidth;
  float sourceHeight;
};

partial interface GPUQueue {
  void drawElementImageToTexture(
      GPUDrawElementImageSource source,
      GPUDrawElementImageDestination destination);
}

[Exposed=Window]
interface PaintEvent : Event {
  constructor(DOMString type, optional PaintEventInit eventInitDict);

  [SameObject] readonly attribute FrozenArray<Element> changedElements;
};

dictionary PaintEventInit : EventInit {
  sequence<Element> changedElements = [];
};

[Exposed=(Window,Worker), Transferable]
interface ElementImage {
  readonly attribute double width;
  readonly attribute double height;
  undefined close();
};

// OffscreenCanvas element geometry update notifications.
[Exposed=Window]
interface ElementGeometryUpdateEvent : Event {
  constructor(
      DOMString type,
      optional ElementGeometryUpdateEventInit eventInitDict = {});

  [SameObject] readonly attribute FrozenArray<Element> elements;
};

dictionary ElementGeometryUpdateEventInit : EventInit {
  sequence<Element> elements = [];
};
```

## Demos

#### [Live demo](https://wicg.github.io/html-in-canvas/Examples/complex-text.html) ([source](Examples/complex-text.html)) using the `drawElementImage` API to draw rotated complex text.

<img width="640" height="320" alt="screenshot showing rotated, complex text drawn into canvas" src="https://github.com/user-attachments/assets/3ef73e0f-9119-49de-bf84-dfb3a4f5d77c" />

#### [Live demo](https://wicg.github.io/html-in-canvas/Examples/pie-chart.html) ([source](Examples/pie-chart.html)) using the `drawElementImage` API to draw a pie chart with multi-line labels.

<img width="640" height="320" alt="screenshot showing a pie chart" src="https://github.com/user-attachments/assets/887eefa2-ffc0-49d6-914b-987b05ccb45d" />

#### [Live demo](https://wicg.github.io/html-in-canvas/Examples/webgpu-jelly-slider/) ([source](Examples/webgpu-jelly-slider)) using the WebGPU `copyElementImageToTexture` API to draw a div under a jelly slider.

Note: This demo needs to be updated to work with the recent API changes.

<img width="640" height="320" alt="screenshot showing a range slider with a jelly effect" src="https://github.com/user-attachments/assets/86ecb8b8-4d3b-49b0-8aa0-5f2df5674045" />

#### [Live demo](https://wicg.github.io/html-in-canvas/Examples/webGL.html) ([source](Examples/webGL.html)) using the WebGL `texElementImage2D` API to draw HTML onto a 3D cube.

Note: This demo needs to be updated to work with the recent API changes.

<img width="640" height="320" alt="screenshot showing html content on a 3D cube" src="https://github.com/user-attachments/assets/689fefe3-56d9-4ae9-b386-32a01ebb0117" />

A demo of the same thing using an experimental extension of [three.js](https://threejs.org/) is [here](https://raw.githack.com/mrdoob/three.js/htmltexture/examples/webgl_materials_texture_html.html). Further instructions and context are [here](https://github.com/mrdoob/three.js/pull/31233).

#### [Live demo](https://wicg.github.io/html-in-canvas/Examples/nested-sparkles.html) ([source](Examples/nested-sparkles.html)) of nested drawable elements.

<img width="640" height="320" alt="screenshot showing the roses are red poem" src="https://github.com/user-attachments/assets/8a04126d-fc03-4de4-a6b8-965285773aed" />

## Read-back-allowed rendering

The `drawElementImage()` method and any other methods that draw element image snapshots, as well as the paint event, must not reveal any security- or privacy-sensitive information that isn't otherwise observable to author code. This concept is called read-back-allowed rendering because it makes it possible to allow pixel read-back, which is always possible with WebGL and WebGPU.

Both painting (via canvas pixel readbacks or timing attacks) and invalidation (via `onpaint`) have the potential to leak sensitive information, and this is prevented by excluding sensitive information when painting and invalidating.

Sensitive information includes:
* Cross-origin data in [embedded content](https://html.spec.whatwg.org/#embedded-content-category) (e.g., `<iframe>`, `<img>`), [`<url>`](https://drafts.csswg.org/css-values-4/#url-value) references (e.g., `background-image`, `clip-path`), `<canvas>` elements tainted with cross-origin data, and [SVG](https://svgwg.org/svg2-draft/single-page.html#types-InterfaceSVGURIReference) (e.g., `<use>`, `<pattern>`, `<feImage>`). Note that same-origin iframes would still paint, but cross-origin content in them would not.
* System colors, themes, or preferences.
* Spelling and grammar markers.
* Visited link information.
* Pending form autofill information not otherwise available to JavaScript.
* Subpixel text anti-aliasing.
* User preferences for caption and subtitle selection and appearance.
* IME pop-ups and distinctive IME text formatting.

The following new information is not considered sensitive:
* Search text (find-in-page) and text-fragment (fragment url) markers.
* Scrollbar and form element appearance (these are already detectable in Blink and WebKit through [foreignObject](https://jsfiddle.net/progers/qhawnyeu)).
* Caret blink rate.
* forced-colors (this information is already available to javascript using the `forced-colors` media query and system colors).

## Accessibility

Content under a `<canvas>` with `layoutsubtree` is exposed to accessibility in the same way as regular DOM (i.e., present in the accessibility tree unless this is modified with accessibility primitives like `aria-hidden="true"`, `inert`, etc.) with one special case: if a `drawable` element's geometry is not updated (either automatically via `drawElementImage` or explicitly with `updateElementGeometry`), the `drawable` element and its drawable subtree are reported to the accessibility tree without geometry information. This approach ensures that accessibility does not lose the semantic information of content outside a `drawable` subtree, or in a `drawable` subtree but without updated geometry. This allows for assistive technologies to filter out content without geometry information. It is important that the accessibility aspects of unused canvas descendants, such as hidden views or no-longer-drawn content, are considered, and in many cases these should be removed from the DOM or hidden using accessibility primitives like `aria-hidden="true"`.

Note that accessibility indicators such as focus or carets will be rendered with `drawElementImage` (and similar WebGL/WebGPU APIs).

Below is an example where the semantics of a figure, image, and caption are preserved while drawing the image and figure separately:
```html
<canvas id="canvas" layoutsubtree>
  <figure id="figure">
    <img drawable id="image" src="..." alt="image alt text" />
    <figcaption drawable id="caption">A caption</figcaption>
  </figure>
</canvas>
<script>
  canvas.onpaint = () => {
    const ctx = canvas.getContext('2d');
    ctx.reset();
    // Note: Because `preserveElementGeometry` defaults to false, the
    // `drawElementImage` call automatically updates geometry, ensuring
    // the image and caption have geometry information for accessibility.
    ctx.drawElementImage(image, 0, 0);
    ctx.drawElementImage(caption, 0, 200);
  };
</script>
```

## Developer Trial (dev trial) Information

The HTML-in-Canvas features may be enabled with `chrome://flags/#canvas-draw-element` in Chrome Canary.

We are most interested in feedback on the following topics:
* What content works, and what fails? Which failure modes are most important to fix?
* How does the feature interact with accessibility features? How can accessibility support be improved?

Please file bugs or design issues [here](https://github.com/WICG/html-in-canvas/issues/new).

## Alternatives considered: `paint` event timing

A new `paint` event is needed to give developers an opportunity to update their canvas rendering in response to paint changes. This is integrated into [update the rendering](https://html.spec.whatwg.org/#update-the-rendering) so that canvas updates can occur in sync with the DOM.

There are several opportunities in the [update the rendering](https://html.spec.whatwg.org/#update-the-rendering) steps where the `paint` event could fire:

  * 14\. Run animation frame callbacks.

  * 16.2.1\. Recalculate styles and update layout.

  * 16.2.6\. Deliver resize observers, looping back to 16.2.1 if needed.

  * _Option A: Fire `paint` at resize observer timing, looping back to 16.2.1 if needed._

  * 19\. Run the update intersection observations steps.

  * Paint, where the painted output of elements is calculated. This is not an explicitly named step in [update the rendering](https://html.spec.whatwg.org/#update-the-rendering).

  * _Option B: Fire `paint` immediately after Paint, looping back to 16.2.1 if needed._

  * _Option C: Fire `paint` immediately after Paint._

  * Commit / thread handoff, where the painted output is sent to another process. This is not an explicitly named step in [update the rendering](https://html.spec.whatwg.org/#update-the-rendering).

Note that the `paint` event is the new event on canvas introduced in this proposal, and the Paint step is the existing operation that browsers perform to record the painted output of the rendering tree following [paint order](https://drafts.csswg.org/css-position-4/#painting-order).

#### Option A: Fire `paint` at resize observer timing, looping back to 16.2.1 if needed.

Similar to resize observer, a looping approach is needed to handle cases where the paint event performs modifications (including of elements outside the canvas). There is no mechanism for preventing arbitrary javascript from modifying the DOM. Looping will be required for more conditions than those required by ResizeObserver, such as background style changes. A downside of looping is that the user's canvas code may need to run multiple times per frame.

One option is to do a synchronous Paint step to snapshot the painted output of drawable elements. A downside of this approach is that the Paint step may be expensive to run, and may need to be run multiple times. This approach has unique implementation challenges in Gecko, and possibly other engines, due to architectural limitations.

A second option is to not run the Paint step synchronously, but instead record a placeholder representing how an element will appear on the next rendering update (see [design](https://docs.google.com/document/d/1YaHCxYqE4uQc4-UTWo4a5pHt2I2MutlwJtsnj5ljEkM/edit?usp=sharing)). This model can be implemented with 2D canvas by buffering the canvas commands until the next Paint step. When the next Paint step occurs, the placeholders would then be replaced with the actual rendering. Canvas operations such as `getImageData` require synchronous flushing of the canvas command buffer and would need to show blank or stale data for the placeholders. Unfortunately, this approach has a fundamental flaw for WebGL because many APIs require flushing (e.g., `getError()`, see callsites of [WaitForCmd](https://source.chromium.org/chromium/chromium/src/+/main:gpu/command_buffer/client/implementation_base.h;drc=b3eab4fd06ddbeee84b37224f4cc9d78094fc2f7;l=102)), and calling any of these APIs would result in a deadlock or inconsistent rendering. Therefore, we must run the `paint` event at a time where we have the complete painted display list of an element already available.

#### Option B: Fire `paint` immediately after Paint, looping back to 16.2.1 if needed.

See above for the reasons and downsides of looping when there are modifications made during the `paint` event.

The upside of option B as compared with option A is that it does not require partial Paint of drawable elements. An additional downside is that even more steps of [update the rendering](https://html.spec.whatwg.org/#update-the-rendering) need to run on each iteration of the loop.

#### Option C: Fire `paint` immediately after Paint.

This is the design approach taken for the API.

This approach only runs `paint` once per frame, similar to the browser's own Paint step. To solve the issue of javascript being able to perform arbitrary modifications, it is important to ensure that before `paint` runs we have locked in the contents of the rendering update, except for one intentional carve-out: the drawn content of the canvas. DOM invalidations that may occur in the `paint` event apply to the subsequent frame, not the current frame.

## Alternatives considered: Supporting threaded effects with worker threads

To support threaded effects, we explored a [design](https://docs.google.com/document/d/1TWe6HP7HMn6y-XnNKppIhgf9FtuXJ6LPgenJJxZDjzg/edit?tab=t.0) where drawable element "snapshots" are sent to a worker thread. In response to threaded scrolling and animations, the worker thread could then render the most up-to-date rendering of the snapshots into OffscreenCanvas. This model requires that javascript can be synchronously called on scroll and animation updates, which is difficult for architectures that perform threaded scroll updates in a restricted process.

## Future considerations: Supporting threaded effects with an auto-updating canvas

To support threaded effects such as scrolling and animations, we are considering a future "auto-updating canvas" mode.

In this model, `drawElementImage` records a placeholder representing the latest rendering. Canvas retains a command buffer which can be automatically replayed following every scroll or animation update. This allows the canvas to re-rasterize with updated placeholders that incorporate threaded scrolling and animations, without needing to block on script. This would enable visual effects that stay perfectly in sync with native scrolling or animations within the canvas, independent of the main thread. This design is viable for 2D contexts, and may be viable for WebGPU with some small API additions.

## Other documents

* [Security and Privacy Questionnaire](./security-privacy-questionnaire.md)

## Authors

* [Philip Rogers](mailto:pdr@chromium.org)
* [Stephen Chenney](mailto:schenney@igalia.com)
* [Chris Harrelson](mailto:chrishtr@chromium.org)
* [Philip Jägenstedt](mailto:foolip@chromium.org)
* [Stefan Zager](mailto:szager@chromium.org)
* [Khushal Sagar](mailto:khushalsagar@chromium.org)
* [Vladimir Levin](mailto:vmpstr@chromium.org)
* [Fernando Serboncini](mailto:fserb@chromium.org)
