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
* **Composing HTML Elements with Effects.** A limited set of CSS effects, such as filters, backdrop-filter, and mix-blend-mode are already available, but there is a desire to use general WebGL shaders with HTML.
* **HTML Rendering in a 3D Context.** 3D aspects of sites and games need to render rich 2D content into surfaces within a 3D scene.

## Proposed solution

The solution introduces three main primitives: an attribute to opt-in canvas elements, methods to draw child elements into the canvas, and an event which fires to handle updates.

### 1. The `layoutsubtree` attribute
The `layoutsubtree` attribute on a `<canvas>` element opts in canvas descendants to layout and participate in hit testing. It causes the direct children of the `<canvas>` to have a stacking context, become a containing block for all descendants, and have paint containment. Canvas element children behave as if they are visible, but their rendering is not visible to the user unless and until they are explicitly drawn into the canvas via a call to `drawElementImage()` (see below).

### 2. `drawElementImage` (and WebGL/WebGPU equivalents)
The `drawElementImage()` method draws a child of the canvas into the canvas, and returns a transform that can be applied to `element.style.transform` to align its DOM location with its drawn location. The child's rendering is taken from the most recent [updating the rendering](https://html.spec.whatwg.org/#update-the-rendering) step.

**Requirements & Constraints:**
* `layoutsubtree` must be specified on the `<canvas>` in the most recent rendering update.
* The `element` must be a direct child of the `<canvas>` in the most recent rendering update.
* The `element` must have generated boxes (i.e., not `display: none`) in the most recent rendering update.
* **Transforms:** The canvas's current transformation matrix is applied when drawing into the canvas. CSS transforms on the source `element` are **ignored** for drawing (but continue to affect hit testing/accessibility, see below).
* **Clipping:** Overflowing content (both layout and ink overflow) is clipped to the element's border box.
* **Sizing:** The optional `width`/`height` arguments specify a destination rect in canvas coordinates. If omitted, the `width`/`height` arguments default to sizing the element so that it has the same on-screen size and proportion in canvas coordinates as it does outside the canvas.

**WebGL/WebGPU Support:**
Similar methods are added for 3D contexts: `WebGLRenderingContext.texElementImage2D` and `copyElementImageToTexture`.

### 3. The `onpaint` event
An `onpaint` event is added to `canvas` and fires if the rendering of any canvas children has changed. This event fires just after intersection observer steps have run during [update-the-rendering](https://html.spec.whatwg.org/#update-the-rendering). The event contains a list of the canvas children which have changed. Because CSS transforms on canvas children are ignored for rendering, changing the transform does not cause `onpaint` to fire in the next frame.

To support application patterns which update every frame, a new `requestPaint()` function is added which will cause `onpaint` to fire once, even if no children have changed (analagous to `requestAnimationFrame()`).

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

To assist with synchronization, `drawElementImage` returns the CSS transform which can be applied to the element to keep it's location synchronized. For 3D contexts, the `getElementTransform(element, draw_transform)` helper method is provided which returns the CSS transform, provided a general transformation matrix.


### Basic Example

<img width="205" height="36" alt="a screenshot showing a form element with a blinking cursor" src="https://github.com/user-attachments/assets/44fb3162-d179-4e0f-bc51-d1161f756513" />

```html
<canvas id="canvas" style="width: 200px; height: 200px;" layoutsubtree>
  <div id="form_element">
    name: <input>
  </div>
</canvas>

<script>
  const ctx = document.getElementById('canvas').getContext('2d');

  canvas.onpaint = () => {
    ctx.reset();
    let transform = ctx.drawElementImage(form_element, 0, 0);
    form_element.style.transform = transform.toString();
  };
</script>
```

### IDL changes

```idl
interface HTMLCanvasElement {
  attribute boolean layoutSubtree;

  attribute EventHandler onpaint;

  void requestPaint();

  DOMMatrix getElementTransform(Element element, DOMMatrix draw_transform);
}

interface CanvasRenderingContext2D {
  DOMMatrix drawElementImage(Element element, unrestricted double x, unrestricted double y);

  DOMMatrix drawElementImage(Element element, unrestricted double x, unrestricted double y,
                             unrestricted double dwidth, unrestricted double dheight);
};

interface WebGLRenderingContext {
  void texElementImage2D(GLenum target, GLint level, GLint internalformat,
                        GLenum format, GLenum type, Element element);
};

interface GPUQueue {
  void copyElementImageToTexture(Element source, GPUImageCopyTextureTagged destination);
}

interface PaintEvent : Event {
  constructor(DOMString type, optional PaintEventInit eventInitDict);

  // Same timestamp as RequestAnimationFrame.
  readonly attribute DOMHighResTimeStamp time;

  readonly attribute FrozenArray<Element> changed;
};

dictionary PaintEventInit : EventInit {
  DOMHighResTimeStamp time = 0;
  sequence<Element> changed = [];
};
```

## Demos

#### [See here](Examples/complex-text.html) for a demo using the `drawElementImage` API to draw rotated complex text.

TODO: Update this example to use the new `onpaint` function.

<img width="640" height="320" alt="screenshot showing rotated, complex text drawn into canvas" src="https://github.com/user-attachments/assets/3ef73e0f-9119-49de-bf84-dfb3a4f5d77c" />

#### [See here](Examples/webGL.html) for a demo using the WebGL `texElementImage2D` API to draw HTML onto a 3D cube.

TODO: Update this example to use the new `onpaint` function.

<img width="640" height="320" alt="screenshot showing html content on a 3D cube" src="https://github.com/user-attachments/assets/689fefe3-56d9-4ae9-b386-32a01ebb0117" />

A demo of the same thing using an experimental extension of [three.js](https://threejs.org/) is [here](https://raw.githack.com/mrdoob/three.js/htmltexture/examples/webgl_materials_texture_html.html). Further instructions and context are [here](https://github.com/mrdoob/three.js/pull/31233).

#### [See here](Examples/text-input.html) for a demo of interactive content in canvas.

TODO: Update this example to use the new `onpaint` function.

<img width="640" height="320" alt="screenshot showing a form drawn into canvas" src="https://github.com/user-attachments/assets/be2d098f-17ae-4982-a0f9-a069e3c2d1d5" />

## Privacy-preserving painting

Both painting (via canvas pixel readbacks or timing attacks) and invalidation (via `onpaint`) have the potential to leak sensitive information, and this is prevented by excluding sensitive information when painting. While an exhaustive list cannot be enumerated, sensitive information includes:
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

## Alternatives considered

* [Threaded design](https://docs.google.com/document/d/1TWe6HP7HMn6y-XnNKppIhgf9FtuXJ6LPgenJJxZDjzg/edit?tab=t.0). To support threaded effects, we explored a model where canvas children "snapshots" are sent to a worker thread. In response to threaded scrolling and animations, the worker thread could then render the most up-to-date rendering of the snapshots into OffscreenCanvas. This model requires that javascript can be synchronously called on scroll and animation updates, which is difficult for architectures that perform threaded scroll updates in a restricted process.

* [Placeholder design](https://docs.google.com/document/d/1YaHCxYqE4uQc4-UTWo4a5pHt2I2MutlwJtsnj5ljEkM/edit?usp=sharing). Some architectures cannot capture an element's rendering outside the main rendering update, so we explored a model where `drawElementImage` records a placeholder representing how an element will look on the next rendering update. When the next rendering update occurs, the placeholders would then be replaced with the actual rendering. This model can be implemented with 2D canvas by buffering the canvas commands until the [updating the rendering](https://html.spec.whatwg.org/#update-the-rendering) step. Canvas operations such as `getImageData` require synchronous flushing of the canvas command buffer and would need to show blank or stale data for the placeholders. This is problematic for WebGL because so many APIs require flushing (e.g., `getError()`).

## Future considerations: auto-updating canvas for threaded effects

To support threaded effects such as scrolling and animations, we are considering a future "auto-updating canvas" mode.

In this model, `drawElementImage` records a placeholder representing the latest rendering. Canvas retains a command buffer which can be automatically re-played following every scroll or animation update. This allows the canvas to re-rasterize with updated placeholders that incorporate threaded scroll and animations, without needing to block on script. This would enable visual effects that stay perfectly in sync with native scrolling or animations within the canvas, independent of the main thread. This design is viable for 2D contexts, and may be viable for WebGPU with some small API additions.

## Other documents

* [Security and Privacy Questionnaire](./security-privacy-questionnaire.md)

## Authors

* [Philip Rogers](mailto:pdr@chromium.org)
* [Stephen Chenney](mailto:schenney@igalia.com)
* [Chris Harrelson](mailto:chrishtr@chromium.org)
* [Khushal Sagar](mailto:khushalsagar@chromium.org)
* [Vladimir Levin](mailto:vmpstr@chromium.org)
* [Fernando Serboncini](mailto:fserb@chromium.org)
