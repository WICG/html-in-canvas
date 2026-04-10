# HTML-in-Canvas

This is a proposal for using 2D and 3D `<canvas>` to customize the rendering of HTML content.

## Status

This is a living explainer which is continuously updated as we receive feedback.

The APIs described here are implemented behind a flag in Chromium and can be enabled with `chrome://flags/#canvas-draw-element`.

## Motivation

There is no web API to easily render complex layouts of text and other content into a `<canvas>`. As a result, `<canvas>`-based content suffers in accessibility, internationalization, performance, and quality.

### Use cases

* **Styled, Laid Out Content in Canvas.** There’s a strong need for better styled text support in Canvas. Examples include chart components (legend, axes, etc.), rich content boxes in creative tools, and in-game menus.
* **Accessibility Improvements.** There is currently no guarantee that the canvas fallback content used for `<canvas>` accessibility always matches the rendered content, and such fallback content can be hard to generate. With this API, elements drawn into the canvas will match their corresponding canvas fallback.
* **Composing HTML Elements with Effects.** A limited set of CSS effects, such as filters, backdrop-filter, and mix-blend-mode are already available, but there is a desire to use general WebGL shaders with HTML.
* **HTML Rendering in a 3D Context.** 3D aspects of sites and games need to render rich 2D content into surfaces within a 3D scene.
* **Media Export.** There's a need to export HTML content as images or video.

## Proposed solution

The solution introduces three main primitives: an attribute to opt-in canvas elements, methods to draw child elements into the canvas, and an event which fires to handle updates.

### 1. The `layoutsubtree` attribute
The `layoutsubtree` attribute on a `<canvas>` element opts in canvas descendants to layout and participate in hit testing. It causes the direct children of the `<canvas>` to have a stacking context, become a containing block for all descendants, and have paint containment. Canvas element children behave as if they are visible, but their rendering is not visible to the user unless and until they are explicitly drawn into the canvas via a call to `drawElementImage()` (see below).

### 2. `drawElementImage` (and WebGL/WebGPU equivalents)
The `drawElementImage()` method draws a child of the canvas into the canvas, and returns a transform that can be applied to `element.style.transform` to align its DOM location with its drawn location. A snapshot of the rendering of all children of the canvas is recorded just prior to the `paint` event. When called during the `paint` event, `drawElementImage()` will draw the child as it would appear in the current frame. When called outside the `paint` event, the previous frame's snapshot is used. An exception is thrown if `drawElementImage()` is called with a child before an initial snapshot has been recorded.

**Requirements & Constraints:**
* `layoutsubtree` must be specified on the `<canvas>` in the most recent rendering update.
* The `element` must be a direct child of the `<canvas>` in the most recent rendering update.
* The `element` must have generated boxes (i.e., not `display: none`) in the most recent rendering update.
* **Transforms:** The canvas's current transformation matrix is applied when drawing into the canvas. CSS transforms on the source `element` are **ignored** for drawing (but continue to affect hit testing/accessibility, see below).
* **Clipping:** Overflowing content (both layout and ink overflow) is clipped to the element's border box.
* **Sizing:** The optional `width`/`height` arguments specify a destination rect in canvas coordinates. If omitted, the `width`/`height` arguments default to sizing the element so that it has the same on-screen size and proportion in canvas coordinates as it does outside the canvas.

**WebGL/WebGPU Support:**
Similar methods are added for 3D contexts: `WebGLRenderingContext.texElementImage2D` and `copyElementImageToTexture`.

### 3. The `paint` event
A `paint` event is added to `canvas` elements and fires if the rendering of any canvas children has changed. This event fires just after intersection observer steps have run during [update-the-rendering](https://html.spec.whatwg.org/#update-the-rendering). The event contains a list of the canvas children which have changed. Because CSS transforms on canvas children are ignored for rendering, changing the transform does not cause the `paint` event to fire in the next frame. Canvas drawing commands made in the `paint` event will appear in the current frame, but DOM changes made in the `paint` event will not show up until the subsequent frame.

To support application patterns which update every frame, a new `requestPaint()` function is added which will cause the `paint` event to fire once, even if no children have changed (analagous to `requestAnimationFrame()`).

### 4. `captureElementImage`
To support `OffscreenCanvas` in workers, a snapshot of an element can be captured as an `ElementImage` snapshot using `canvas.captureElementImage(element)`. These objects can be transferred to a worker and drawn to an `OffscreenCanvas`.

### Synchronization

Browser features like hit testing, intersection observer, and accessibility rely on an element's DOM location. To ensure these work, the element's `transform` property should be updated so that the DOM location matches the drawn location.

<details>
<summary>Calculating a CSS transform to match a drawn location</summary>
  The general formula for the CSS transform is:

  <div align="center">$$T_{\text{origin}}^{-1} \cdot S_{\text{css} \to \text{grid}}^{-1} \cdot T_{\text{draw}} \cdot S_{\text{css} \to \text{grid}} \cdot T_{\text{origin}} $$</div>

Where:

* $$T_{\text{draw}}$$: Transform used to draw the element in the canvas grid coordinate system.
  For `drawElementImage`, this is $$CTM \cdot T_{(\text{x}, \text{y})} \cdot S_{(\text{destScale})}$$, where $$CTM$$ is the Current Transformation Matrix, $$T_{(\text{x}, \text{y})}$$ is a translation from the x and y arguments, and $$S_{(\text{destScale})}$$ is a scale from the width and height arguments.
* $$T_{\text{origin}}$$: Translation matrix of the element's computed `transform-origin`.
* $$S_{\text{css} \to \text{grid}}$$: Scaling matrix converting CSS pixels to Canvas Grid pixels.
</details>

To assist with synchronization, `drawElementImage()` returns the CSS transform which can be applied to the element to keep its location synchronized. For 3D contexts, the `getElementTransform(element, drawTransform)` helper method is provided which returns the CSS transform, provided a general transformation matrix.

The transform used to draw the element on the worker thread needs to be synced back to the DOM, and can simply be `postMessage()`'d back to the main thread if the position is static. If the position is dynamic, an alternative is to calculate the position on the main thread and update `element.style.transform` at the same time that the `ElementImage` objects is sent to the worker thread.

### Basic Example

<img width="250" height="38" alt="a screenshot showing a form element with a blinking cursor" src="https://github.com/user-attachments/assets/acbdd231-3259-4819-b57e-32e29c460fc9" />

```html
<canvas id="canvas" style="width: 400px; height: 200px;" layoutsubtree>
  <form id="form_element">
    <label for="name">name:</label>
    <input id="name">
  </form>
</canvas>

<script>
  const ctx = document.getElementById('canvas').getContext('2d');

  canvas.onpaint = () => {
    ctx.reset();
    const transform = ctx.drawElementImage(form_element, 100, 0);
    form_element.style.transform = transform.toString();
  };

  // Size the canvas grid to match the device scale factor to prevent blurriness.
  const observer = new ResizeObserver(([entry]) => {
    canvas.width = entry.devicePixelContentBoxSize[0].inlineSize;
    canvas.height = entry.devicePixelContentBoxSize[0].blockSize;
  });
  observer.observe(canvas, {box: 'device-pixel-content-box'});
</script>
```

### OffscreenCanvas Example

In this example, `OffscreenCanvas` in a worker is used. The `canvas` child form is captured as an `ElementImage` object in the `paint` event and transferred to the worker for painting.

```html
<!DOCTYPE html>
<canvas id="canvas" style="width: 400px; height: 200px;" layoutsubtree>
  <form id="form_element">
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
      if (e.data.elementImage) {
        ctx.reset();
        const transform = ctx.drawElementImage(e.data.elementImage, 100, 0);
        self.postMessage({transform: transform});
      }
    };
  `;

  const worker = new Worker(URL.createObjectURL(new Blob([workerCode])));
  const offscreen = canvas.transferControlToOffscreen();

  worker.postMessage({ canvas: offscreen }, [offscreen]);

  canvas.onpaint = (event) => {
    const elementImage = canvas.captureElementImage(form_element)
    worker.postMessage({ elementImage: elementImage }, [elementImage]);
  };

  // Synchronize the element's CSS transform to match its drawn location.
  worker.onmessage = ({data}) => {
    form_element.style.transform = data.transform.toString();
  };

  // Size the canvas grid to match the device scale factor to prevent blurriness.
  const observer = new ResizeObserver(([entry]) => {
    worker.postMessage({
      width: entry.devicePixelContentBoxSize[0].inlineSize,
      height: entry.devicePixelContentBoxSize[0].blockSize
    });
    canvas.requestPaint();
  });
  observer.observe(canvas, { box: 'device-pixel-content-box' });
</script>
```

### IDL changes

```idl
partial interface HTMLCanvasElement {
  [CEReactions, Reflect] attribute boolean layoutSubtree;

  attribute EventHandler onpaint;

  void requestPaint();

  ElementImage captureElementImage(Element element);
  DOMMatrix getElementTransform((Element or ElementImage) element, DOMMatrix drawTransform);
};

partial interface OffscreenCanvas {
  DOMMatrix getElementTransform((Element or ElementImage) element, DOMMatrix drawTransform);
};

interface mixin CanvasDrawElementImage {
  DOMMatrix drawElementImage((Element or ElementImage) element,
                             unrestricted double dx, unrestricted double dy);

  DOMMatrix drawElementImage((Element or ElementImage) element,
                             unrestricted double dx, unrestricted double dy,
                             unrestricted double dwidth, unrestricted double dheight);

  DOMMatrix drawElementImage((Element or ElementImage) element,
                             unrestricted double sx, unrestricted double sy,
                             unrestricted double swidth, unrestricted double sheight,
                             unrestricted double dx, unrestricted double dy);

  DOMMatrix drawElementImage((Element or ElementImage) element,
                             unrestricted double sx, unrestricted double sy,
                             unrestricted double swidth, unrestricted double sheight,
                             unrestricted double dx, unrestricted double dy,
                             unrestricted double dwidth, unrestricted double dheight);
};

CanvasRenderingContext2D includes CanvasDrawElementImage;
OffscreenCanvasRenderingContext2D includes CanvasDrawElementImage;

partial interface WebGLRenderingContext {
  void texElementImage2D(GLenum target, GLint level, GLint internalformat,
                         GLenum format, GLenum type, (Element or ElementImage) element);
};

partial interface GPUQueue {
  void copyElementImageToTexture((Element or ElementImage) source,
                                 GPUImageCopyTextureTagged destination);
}

[Exposed=Window]
interface PaintEvent : Event {
  constructor(DOMString type, optional PaintEventInit eventInitDict);

  readonly attribute FrozenArray<Element> changedElements;
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
```

## Demos

#### [Live demo](https://wicg.github.io/html-in-canvas/Examples/complex-text.html) ([source](Examples/complex-text.html)) using the `drawElementImage` API to draw rotated complex text.

<img width="640" height="320" alt="screenshot showing rotated, complex text drawn into canvas" src="https://github.com/user-attachments/assets/3ef73e0f-9119-49de-bf84-dfb3a4f5d77c" />

#### [Live demo](https://wicg.github.io/html-in-canvas/Examples/pie-chart.html) ([source](Examples/pie-chart.html)) using the `drawElementImage` API to draw a pie chart with multi-line labels.

<img width="640" height="320" alt="screenshot showing a pie chart" src="https://github.com/user-attachments/assets/887eefa2-ffc0-49d6-914b-987b05ccb45d" />

#### [Live demo](https://wicg.github.io/html-in-canvas/Examples/webgpu-jelly-slider/) ([source](Examples/webgpu-jelly-slider)) using the WebGPU `copyElementImage` API to draw a div under a jelly slider.

<img width="640" height="320" alt="screenshot showing a range slider with a jelly effect" src="https://github.com/user-attachments/assets/86ecb8b8-4d3b-49b0-8aa0-5f2df5674045" />

#### [Live demo](https://wicg.github.io/html-in-canvas/Examples/webGL.html) ([source](Examples/webGL.html)) using the WebGL `texElementImage2D` API to draw HTML onto a 3D cube.

<img width="640" height="320" alt="screenshot showing html content on a 3D cube" src="https://github.com/user-attachments/assets/689fefe3-56d9-4ae9-b386-32a01ebb0117" />

A demo of the same thing using an experimental extension of [three.js](https://threejs.org/) is [here](https://raw.githack.com/mrdoob/three.js/htmltexture/examples/webgl_materials_texture_html.html). Further instructions and context are [here](https://github.com/mrdoob/three.js/pull/31233).

#### [Live demo](https://wicg.github.io/html-in-canvas/Examples/text-input.html) ([source](Examples/text-input.html)) of interactive content in canvas.

<img width="640" height="320" alt="screenshot showing a form drawn into canvas" src="https://github.com/user-attachments/assets/be2d098f-17ae-4982-a0f9-a069e3c2d1d5" />

## Privacy-preserving painting

The `drawElementImage()` method and any other methods that draw element image snapshots, as well as the paint event, must not reveal any security- or privacy-sensitive information that isn't otherwise observable to author code.

Both painting (via canvas pixel readbacks or timing attacks) and invalidation (via `onpaint`) have the potential to leak sensitive information, and this is prevented by excluding sensitive information when painting and invalidating.

Sensitive information includes:
* Cross-origin data in [embedded content](https://html.spec.whatwg.org/#embedded-content-category) (e.g., `<iframe>`, `<img>`), [`<url>`](https://drafts.csswg.org/css-values-4/#url-value) references (e.g., `background-image`, `clip-path`), and [SVG](https://svgwg.org/svg2-draft/single-page.html#types-InterfaceSVGURIReference) (e.g., `<use>`). Note that same-origin iframes would still paint, but cross-origin content in them would not.
* System colors, themes, or preferences.
* Spelling and grammar markers.
* Visited link information.
* Pending form autofill information not otherwise available to JavaScript.
* Subpixel text anti-aliasing.

The following new information is not considered sensitive:
* Search text (find-in-page) and text-fragment (fragment url) markers.
* Scrollbar and form element appearance (these are already detectable in Blink and WebKit through [foreignObject](https://jsfiddle.net/progers/qhawnyeu)).
* Caret blink rate.
* forced-colors (this information is already available to javascript using the `forced-colors` media query and system colors).

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

One option is to do a synchronous Paint step to snapshot the painted output of canvas children. A downside of this approach is that the Paint step may be expensive to run, and may need to be run multiple times. This approach has unique implementation challenges in Gecko, and possibly other engines, due to architectural limitations.

A second option is to not run the Paint step synchronously, but instead record a placeholder representing how an element will appear on the next rendering update (see [design](https://docs.google.com/document/d/1YaHCxYqE4uQc4-UTWo4a5pHt2I2MutlwJtsnj5ljEkM/edit?usp=sharing)). This model can be implemented with 2D canvas by buffering the canvas commands until the next Paint step. When the next Paint step occurs, the placeholders would then be replaced with the actual rendering. Canvas operations such as `getImageData` require synchronous flushing of the canvas command buffer and would need to show blank or stale data for the placeholders. Unfortunately, this approach has a fundamental flaw for WebGL because many APIs require flushing (e.g., `getError()`, see callsites of [WaitForCmd](https://source.chromium.org/chromium/chromium/src/+/main:gpu/command_buffer/client/implementation_base.h;drc=b3eab4fd06ddbeee84b37224f4cc9d78094fc2f7;l=102)), and calling any of these APIs would result in a deadlock or inconsistent rendering. Therefore, we must run the `paint` event at a time where we have the complete painted display list of an element already available.

#### Option B: Fire `paint` immediately after Paint, looping back to 16.2.1 if needed.

See above for the reasons and downsides of looping when there are modifications made during the `paint` event.

The upside of option B as compared with option A is that it does not require partial Paint of canvas children. An additional downside is that even more steps of [update the rendering](https://html.spec.whatwg.org/#update-the-rendering) need to run on each iteration of the loop.

#### Option C: Fire `paint` immediately after Paint.

This is the design approach taken for the API.

This approach only runs `paint` once per frame, similar to the browser's own Paint step. To solve the issue of javascript being able to perform arbitrary modifications, it is important to ensure that before `paint` runs we have locked in the contents of the rendering update, except for one intentional carve-out: the drawn content of the canvas. DOM invalidations that may occur in the `paint` event apply to the subsequent frame, not the current frame.

## Alternatives considered: Supporting threaded effects with worker threads

To support threaded effects, we explored a [design](https://docs.google.com/document/d/1TWe6HP7HMn6y-XnNKppIhgf9FtuXJ6LPgenJJxZDjzg/edit?tab=t.0) where canvas children "snapshots" are sent to a worker thread. In response to threaded scrolling and animations, the worker thread could then render the most up-to-date rendering of the snapshots into OffscreenCanvas. This model requires that javascript can be synchronously called on scroll and animation updates, which is difficult for architectures that perform threaded scroll updates in a restricted process.

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
* [Khushal Sagar](mailto:khushalsagar@chromium.org)
* [Vladimir Levin](mailto:vmpstr@chromium.org)
* [Fernando Serboncini](mailto:fserb@chromium.org)
