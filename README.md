# HTML-in-Canvas

This is a proposal for using 2D and 3D `<canvas>` to customize the rendering of HTML content.

## Status

This is a living explainer which is continuously updated as we receive feedback.

The APIs described here are implemented behind a flag in Chromium and can be enabled with [chrome://flags/#canvas-draw-element](chrome://flags/#canvas-draw-element).

## Motivation

There is no web API to easily render complex layouts of text and other content into a `<canvas>`. As a result, `<canvas>`-based content suffers in accessibility, internationalization, performance, and quality.

### Use cases

* **Styled, Laid Out Content in Canvas.** There’s a strong need for better styled text support in Canvas. Examples include chart components (legend, axes, etc.), rich content boxes in creative tools, and in-game menus.
* **Accessibility Improvements.** There is currently no guarantee that the canvas fallback content used for `<canvas>` accessibility always matches the rendered content, and such fallback content can be hard to generate. With this API, elements drawn into the canvas will match their corresponding canvas fallback.
* **Composing HTML Elements with Shaders.** A limited set of CSS shaders, such as filter effects, are already available, but there is a desire to use general WebGL shaders with HTML.
* **HTML Rendering in a 3D Context.** 3D aspects of sites and games need to render rich 2D content into surfaces within a 3D scene.

### Requirements

* **Threaded.** Scrolling and painting should be responsive even with a congested main thread.
* **No frame delay.** It should be possible to paint the element in the same frame as it would be presented to the user when not using HTML-in-Canvas.

## Proposed solution

This proposal introduces a mechanism to render elements into an OffscreenCanvas using a worker. The browser continues to layout and paint the descendants of the canvas, but without showing the output to the user. The three main primitives are an attribute to opt-in canvas elements, methods to draw child elements into the canvas, and events to signal when painting is needed.

### 1. The `layoutsubtree` attribute
The `layoutsubtree` attribute on a `<canvas>` element opts in canvas descendants to have layout and participate in hit testing. It causes the direct children of the `<canvas>` to have a stacking context, become a containing block for all descendants, and have paint containment.

### 2. `drawElementImage` (and WebGL/WebGPU equivalents)
The `drawElementImage()` method renders the DOM element and its subtree into the canvas, and returns a transform that can be applied to `element.style.transform` to align its DOM location with its drawn location.

**Requirements & Constraints:**
* `layoutsubtree` must be specified on the `<canvas>`.
* The `element` must be a direct child of the `<canvas>`.
* The `element` must generate boxes (i.e., not `display: none`).
* **Transforms:** The canvas's current transformation matrix is applied when drawing into the canvas. CSS transforms on the source `element` are **ignored** for drawing (but continue to affect hit testing/accessibility, see below).
* **Clipping:** Overflowing content (both layout and ink overflow) is clipped to the element's border box.
* **Sizing:** The optional `width`/`height` arguments specify a destination rect in canvas coordinates. If omitted, the `width`/`height` arguments default to sizing the element so that it has the same on-screen size and proportion in canvas coordinates as it does outside the canvas.

**WebGL/WebGPU Support:**
Similar methods are added for 3D contexts: `WebGLRenderingContext.texElementImage2D` and `copyElementImageToTexture`.

### 3. `renderelementimages`

A new `renderelementimages` event is introduced for `OffscreenCanvas` in a worker which fires after the canvas element children have been prepared for rendering, giving the worker an opportunity to use this output to update the canvas in the current frame (this is modeled after [CSS paint worklet](https://drafts.css-houdini.org/css-paint-api/)). The rendering of elements is still limited to [privacy-preserving painting](#privacy-preserving-painting).

By default, the `renderelementimages` event is only fired when the painted result of an element changes, to allow for only running the callback when needed (TODO: make it easier to handle removed elements). To support a pattern of updating rendering every frame (e.g., an animating water ripple effect), a new `requestRender()` method is added, which causes `renderelementimages` to be fired on the next frame, even if nothing has changed (similar to a `requestAnimationFrame()` loop).

### Synchronization

Browser features like hit testing, intersection observer, and accessibility rely on an element's DOM location. To ensure these work, the element's `transform` property should be updated so that the DOM location matches the drawn location.

To assist with synchronization, `drawElementImage` returns the CSS transform which can be applied to the element to keep its location synchronized. For 3D contexts, the `getElementTransform(element, draw_transform)` helper method is provided which returns the CSS transform, provided a general transformation matrix.

<details>
<summary>Caculating a CSS transform to match a drawn location</summary>
  The the general formula for the CSS transform is:
  
  <div align="center">$$T_{\text{origin}}^{-1} \cdot S_{\text{css} \to \text{grid}}^{-1} \cdot T_{\text{draw}} \cdot S_{\text{css} \to \text{grid}} \cdot T_{\text{origin}} $$</div>

Where:

* $$T_{\text{draw}}$$: Transform used to draw the element in the canvas grid coordinate system.
  For `drawElementImage`, this is $$CTM \cdot T_{(\text{x}, \text{y})} \cdot S_{(\text{destScale})}$$, where $$CTM$$ is the Current Transformation Matrix, $$T_{(\text{x}, \text{y})}$$ is a translation from the x and y attributes, and $$S_{(\text{destScale})}$$ is a scale from the width and height attributes. 
* $$T_{\text{origin}}$$: Translation matrix of the element's computed `transform-origin`.
* $$S_{\text{css} \to \text{grid}}$$: Scaling matrix converting CSS pixels to Canvas Grid pixels.
</details>

The transform used to draw the element on the worker thread needs to be synced back to the DOM, so a new event (`drawelementimagesync`) is introduced for updating the element's CSS transform to match the transform used for drawing (and a new API is added for WebGL/WebGPU to provide the draw matrix). CSS transform is ignored for drawing, so changing the transform does not cause a subsequent repaint.

Example of the information flow of a frame with changed rendering:

<img width="640" height="158" alt="Diagram showing information flow between Main thread, Worker thread, and Compositor thread for rendering updates." src="https://github.com/user-attachments/assets/d3ac284e-6520-4c15-a1a5-e305ca26c5a8" />

### Basic Example

```html
<!DOCTYPE html>
<canvas id="canvas" style="width: 300px; height: 200px;" layoutsubtree>
  <div id="label">enter your fullname:</div>
  <input id="input">
</canvas>

<script>
  // 1. Setup worker thread.
  const worker = new Worker("worker.js");

  // 2. Transfer control to the worker.
  const offscreen = canvas.transferControlToOffscreen();
  worker.postMessage({ canvas: offscreen }, [offscreen]);

  // 3. Synchronize the element's CSS transform to match its drawn location.
  canvas.ondrawelementimagesync = (event) => {
    event.element.style.transform = event.transform.toString();
  };
</script>
```

```js
// worker.js
onmessage = ({data}) => {
  const ctx = data.canvas.getContext('2d');
  data.canvas.onrenderelementimages = (event) => {
    const changedLabel = event.changedElementImages.find(item => item.id === 'label');
    if (changedLabel) {
      ctx.drawElementImage(changedLabel, 0, 0);
    }
    const changedInput = event.changedElementImages.find(item => item.id === 'input');
    if (changedInput) {
      ctx.drawElementImage(changedInput, 0, 100);
    }
  };
};
```

### IDL changes

```idl
partial interface HTMLCanvasElement {
  attribute boolean layoutsubtree;

  // Fired when element images are drawn. Provides the transform needed to
  // update the element's location to match the drawn location.
  // TODO: decide whether these are coalesced.
  attribute EventHandler ondrawelementimagesync;
};

// Event payload for syncing DOM position (transform).
[Exposed=Window]
interface DrawElementImageSyncEvent : Event {
  constructor(DOMString type, DrawElementImageSyncEventInit eventInitDict);

  readonly attribute Element element;

  // The transform required to align the DOM element with the drawn pixels.
  readonly attribute DOMMatrix transform;
};

dictionary DrawElementImageSyncEventInit : EventInit {
  required Element element;
  required DOMMatrix transform;
};

[Exposed=DedicatedWorker]
interface ElementImage : EventTarget {
  // width and height, in canvas grid coordinates.
  readonly attribute unsigned long width;
  readonly attribute unsigned long height;

  readonly attribute DOMString id;
};

[Exposed=DedicatedWorker]
interface RenderElementImagesEvent : Event {
  constructor(DOMString type, optional RenderElementImagesEventInit eventInitDict);

  // Same timestamp as RequestAnimationFrame.
  readonly attribute DOMHighResTimeStamp time;

  // List of the element images which have changed.
  readonly attribute sequence<ElementImage> changedElementImages;
};

dictionary RenderElementImagesEventInit : EventInit {
  DOMHighResTimeStamp time = 0;
  sequence<ElementImage> changedElementImages = [];
};

partial interface OffscreenCanvas {
  // Triggered automatically when element images have changed, or when the canvas
  // has resized.
  [Exposed=DedicatedWorker] attribute EventHandler onrenderelementimages;

  // Requests that `onrenderelementimages` is called on the next frame, regardless of
  // whether any element images have changed. This supports an optional raf-loop
  // pattern where `onrenderelementimages` is called on every frame.
  [Exposed=DedicatedWorker] void requestRender();

  // List of all element images. Updated just prior to `onrenderelementimages` firing.
  [Exposed=DedicatedWorker] readonly attribute sequence<ElementImage> elementImages;
};

partial interface OffscreenCanvasRenderingContext2D {
  [RaisesException, Exposed=DedicatedWorker]
  void drawElementImage(ElementImage image,
                        unrestricted double x,
                        unrestricted double y);

  [RaisesException, Exposed=DedicatedWorker]
  void drawElementImage(ElementImage image,
                        unrestricted double x,
                        unrestricted double y,
                        unrestricted double width,
                        unrestricted double height);
};
```

## Demos

#### [See here](Examples/complex-text.html) for a demo using the `drawElementImage` API to draw rotated complex text.

<img width="640" height="320" alt="screenshot showing rotated, complex text drawn into canvas" src="https://github.com/user-attachments/assets/3ef73e0f-9119-49de-bf84-dfb3a4f5d77c" />

#### [See here](Examples/webGL.html) for a demo using the WebGL `texElementImage2D` API to draw HTML onto a 3D cube.

<img width="640" height="320" alt="screenshot showing html content on a 3D cube" src="https://github.com/user-attachments/assets/689fefe3-56d9-4ae9-b386-32a01ebb0117" />

A demo of the same thing using an experimental extension of [three.js](https://threejs.org/) is [here](https://raw.githack.com/mrdoob/three.js/htmltexture/examples/webgl_materials_texture_html.html). Further instructions and context are [here](https://github.com/mrdoob/three.js/pull/31233).

#### [See here](Examples/text-input.html) for a demo of interactive content in canvas.

The `fireOnEveryPaint` resize observer option is used to update the canvas as needed. The effect is a fully interactive form in canvas.

<img width="640" height="320" alt="screenshot showing a form drawn into canvas" src="https://github.com/user-attachments/assets/be2d098f-17ae-4982-a0f9-a069e3c2d1d5" />

## Privacy-preserving painting

Both painting (via canvas pixel readbacks or timing attacks) and invalidation (via `fireOnEveryPaint`) have the potential to leak sensitive information, and this is prevented by excluding sensitive information when painting. While an exhaustive list cannot be enumerated, sensitive information includes:
* Cross-origin data in [embedded content](https://html.spec.whatwg.org/#embedded-content-category) (e.g., `<iframe>`, `<img>`), [`<url>`](https://drafts.csswg.org/css-values-4/#url-value) references (e.g., `background-image`, `clip-path`), and [SVG](https://svgwg.org/svg2-draft/single-page.html#types-InterfaceSVGURIReference) (e.g., `<use>`). Note that same-origin iframes would still paint, but cross-origin content in them would not.
* System colors, themes, or preferences.
* Spelling and grammar markers.
* Search text (find-in-page) and text-fragment (fragment url) markers.
* Visited link information.
* Form autofill information not otherwise available to javascript.

SVG's `<foreignObject>` can be combined with data uri images and canvas to access the pixel data of HTML content ([example](https://jsfiddle.net/progers/qhawnyeu)), and implementations currently have mitigations to prevent leaking sensitive content. As an example, an `<input>` with a spelling error is still painted, but any indication of spelling errors, which could expose the user's spelling dictionary, is not painted. Similar mitigations should be used for `drawElementImage`, but need to be expanded to cover additional cases.

## Developer Trial (dev trial) Information
The HTML-in-Canvas features may be enabled with [chrome://flags/#canvas-draw-element](chrome://flags/#canvas-draw-element) in Chrome Canary.

We are most interested in feedback on the following topics:
* What content works, and what fails? Which failure modes are most important to fix?
* How does the feature interact with accessibility features? How can accessibility support be improved?

Please file bugs or design issues [here](https://github.com/WICG/html-in-canvas/issues/new).

## Other documents

* [Security and Privacy Questionnaire](./security-privacy-questionnaire.md)

## Authors

* [Philip Rogers](mailto:pdr@chromium.org)
* [Stephen Chenney](mailto:schenney@igalia.com)
* [Chris Harrelson](mailto:chrishtr@chromium.org)
* [Khushal Sagar](mailto:khushalsagar@chromium.org)
* [Vladimir Levin](mailto:vmpstr@chromium.org)
* [Fernando Serboncini](mailto:fserb@chromium.org)
* [Philip Jägenstedt](mailto:foolip@chromium.org)
