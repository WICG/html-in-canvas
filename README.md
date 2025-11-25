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

## Proposed solution

The solution introduces three main primitives: an attribute to opt-in canvas elements, methods to draw child elements into the canvas, and an observer to handle updates.

### 1. The `layoutsubtree` attribute
The `layoutsubtree` attribute on a `<canvas>` element opts in canvas descendants to have layout and participate in hit testing. It causes the direct children of the `<canvas>` to have a stacking context, become a containing block for all descendants, and have paint containment.

### 2. `drawElementImage` (and WebGL/WebGPU equivalents)
The `drawElementImage(element)` method renders the DOM `element` and its subtree into the canvas.

**Requirements & Constraints:**
* `layoutsubtree` must be specified on the `<canvas>`.
* The `element` must be a direct child of the `<canvas>`.
* **Transforms:** The canvas's current transformation matrix is applied when drawing into the canvas. CSS transforms on the source `element` are **ignored** for drawing (but still apply to hit testing/accessibility, see below).
* **Clipping:** Overflowing content (both layout and ink overflow) is clipped to the element's border box.
* **Sizing:** The optional `width`/`height` arguments specify a destination rect in canvas coordinates. If omitted, the `width`/`height` arguments default to sizing the element so that it has the same on-screen size and proportion in canvas coordinates as it does outside the canvas.

**WebGL/WebGPU Support:**
Similar methods are added for 3D contexts: `WebGLRenderingContext.texElementImage2D` and `copyElementImageToTexture`.

### 3. `fireOnEveryPaint`
A `fireOnEveryPaint` option is added to `ResizeObserverOptions`. This allows script to be notified whenever descendants of a `<canvas>` may render differently and may need to be re-drawn. The callback runs at Resize Observer timing (after DOM style/layout, but before paint).

### Synchronization
It is essential for hit testing, intersection observer, and accessibility that the DOM position is kept in sync with the position of the drawn image.

To assist with this, `drawElementImage` returns a `DOMMatrix` which can be applied to the DOM element's `transform` style to make the DOM position match the drawn position. There is no explicit current transform matrix in WebGL/WebGPU, so the `getElementTransform(element, draw_transform)` helper method is provided to make it easy to adjust a provided `DOMMatrix` transform so that it can be applied to the element's `transform` style to make the DOM position match the drawn position.

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

  const observer = new ResizeObserver(([entry]) => {
    canvas.width = entry.devicePixelContentBoxSize[0].inlineSize;
    canvas.height = entry.devicePixelContentBoxSize[0].blockSize;

    let transform = ctx.drawElementImage(form_element, 0, 0);
    form_element.style.transform = transform.toString();
  });
  observer.observe(canvas, {box: 'device-pixel-content-box', fireOnEveryPaint: true});
</script>
```

### IDL changes

```idl
interface HTMLCanvasElement {
  attribute boolean layoutSubtree;

  [RaisesException]
  DOMMatrix getElementTransform(Element element, DOMMatrix draw_transform);
}

interface CanvasRenderingContext2D {
  [RaisesException]
  DOMMatrix drawElementImage(Element element, unrestricted double x, unrestricted double y);

  [RaisesException]
  DOMMatrix drawElementImage(Element element, unrestricted double x, unrestricted double y,
                             unrestricted double dwidth, unrestricted double dheight);
};

interface WebGLRenderingContext {
  [RaisesException]
  void texElementImage2D(GLenum target, GLint level, GLint internalformat,
                        GLenum format, GLenum type, Element element);
};

interface GPUQueue {
  [RaisesException]
  void copyElementImageToTexture(Element source, GPUImageCopyTextureTagged destination);
}

dictionary ResizeObserverOptions {
  boolean fireOnEveryPaint = false;
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
