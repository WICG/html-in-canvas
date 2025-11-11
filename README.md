# HTML-in-Canvas

We propose new HTML Canvas APIs for rendering HTML content into the canvas for Canvas 2D and WebGL.

## Status

**Authors:** [Philip Rogers](mailto:pdr@google.com), [Stephen Chenney](mailto:schenney@igalia.com), [Chris Harrelson](mailto:chrishtr@google.com), [Khushal Sagar](mailto:khushalsagar@google.com), [Vladimir Levin](mailto:vmpstr@chromium.org), [Fernando Serboncini](mailto:fserb@chromium.org)

**Champions:** [Stephen Chenney](mailto:schenney@igalia.com), [Chris Harrelson](mailto:chrishtr@google.com)

This proposal is a subset of a [previous proposal](placeElement) covering APIs to allow live HTML elements.

## Motivation

There is no web API to easily render complex layouts of text and other content into a `<canvas>`. As a result, `<canvas>`-based content suffers in accessibility, internationalization, performance and quality.

### Use cases

* **Styled, Laid Out Content in Canvas.** There’s a strong need for better styled text support in Canvas. Examples include chart components (legend, axes, etc.), rich content boxes in creative tools, and in-game menus.
* **Accessibility Improvements.** There is currently no guarantee that the canvas fallback content currently used for `<canvas>` accessibility always matches the rendered content, and such fallback content can be hard to generate. With this API, elements drawn into the canvas bitmap will match their corresponding canvas fallback.
* **Composing HTML Elements with Shaders.** A limited set of CSS shaders, such as filter effects, are already available, but there is a desire to use general WebGL shaders with HTML.
* **HTML Rendering in a 3D Context.** 3D aspects of sites and games need to render rich 2D content into surfaces within a 3D scene.

## Proposed solution: `layoutsubtree`, `drawElementImage`, and `fireOnEveryPaint`

* The `layoutsubtree` attribute on a `<canvas>` element opts-in canvas descendants to have layout and participate in hit testing. To aid in rendering, this attribute also causes the direct children of the `<canvas>` to have a stacking context, become a containing block for all descendants, and have paint containment.
* The `CanvasRenderingContext2D.drawElementImage(element, x, y, width, height)` method renders `element` and its subtree into a 2D canvas at offset x and y. `layoutsubtree` must be specified on the `<canvas>`, and the `element` must be a direct child of the `<canvas>`. The current transformation matrix of the canvas is taken into consideration. Transform properties on the element are ignored, but other effects are rendered, with overflowing content (including both layout and ink overflow) being clipped to the element's content box. The optional width/height arguments specify a destination rect in canvas coordinates to which the element will be scaled. If omitted, the element will have the same size and proportion when drawn to the canvas as it would have were it rendered outside the canvas. For WebGL/WebGPU, similar `WebGLRenderingContext.texElementImage2D` and `copyElementImageToTexture` functions are added.
* A `fireOnEveryPaint` option is added to `ResizeObserverOptions`, allowing script to be notified whenever any descendants of a `<canvas>` may render differently, so they can be redrawn. The callback to the resize observer will be called at resize observer timing, which is after DOM style and layout, but before paint.

Once drawn, the resulting canvas image is static. Subsequent changes to the element will not be reflected in the canvas, so the element must be explicitly redrawn if an author wishes to see the changes.

Descendants of a `<canvas>` with `layoutsubtree` are automatically hit testable, and this approach encourages authors to keep their drawn content in sync with the DOM, ensuring accessibility is up-to-date. Although CSS transform on the drawn element is ignored by `drawElementImage`, it is still honored by hit testing, as well as features like accessibility, anchor positioning, and intersection observer. See [Issue#11](https://github.com/WICG/html-in-canvas/issues/11) for an ongoing discussion of accessibility concerns.

Offscreen canvas contexts and detached canvases are not supported because drawing DOM content when the canvas is not in the DOM poses technical challenges. See [Issue#2](https://github.com/WICG/html-in-canvas/issues/2) for further discussion.

```idl
interface CanvasRenderingContext2D {

  ...

  [RaisesException]
  void drawElementImage(Element element, unrestricted double x, unrestricted double y);

  [RaisesException]
  void drawElementImage(Element element, unrestricted double x, unrestricted double y,
                       unrestricted double dwidth, unrestricted double dheight);

```

```idl
interface WebGLRenderingContext {

  ...

  [RaisesException]
    void texElementImage2D(GLenum target, GLint level, GLint internalformat,
                          GLenum format, GLenum type, Element element);

```

## Demos

#### [See here](Examples/complex-text.html) to see an example of how to use the `drawElementImage` API.

<img width="640" height="320" alt="complex-text" src="https://github.com/user-attachments/assets/3ef73e0f-9119-49de-bf84-dfb3a4f5d77c" />

#### [See here](Examples/webGL.html) for an example of how to use the WebGL `texElementImage2D` API to populate a GL texture with HTML content.

<img width="640" height="320" alt="webgl" src="https://github.com/user-attachments/assets/689fefe3-56d9-4ae9-b386-32a01ebb0117" />

A demo of the same thing using an experimental extension of [three.js](https://threejs.org/) is [here](https://raw.githack.com/mrdoob/three.js/htmltexture/examples/webgl_materials_texture_html.html). Further instructions and context are [here](https://github.com/mrdoob/three.js/pull/31233).

#### [See here](Examples/text-input.html) for an example of interactive content in canvas.

The `fireOnEveryPaint` resize observer option is used to update the canvas as needed. The effect is a fully interactive form in canvas.

<img width="640" height="320" alt="text-input" src="https://github.com/user-attachments/assets/be2d098f-17ae-4982-a0f9-a069e3c2d1d5" />

## Privacy-preserving painting

Both painting (via canvas pixel readbacks or timing attacks) and invalidation (via `fireOnEveryPaint`) have the potential to leak sensitive information, and this is prevented by excluding sensitive information when painting. While an exhaustive list cannot be enumerated, sensitive information includes:
* cross-origin data in [embedded content](https://html.spec.whatwg.org/#embedded-content-category) (e.g., `<iframe>`, `<img>`), [`<url>`](https://drafts.csswg.org/css-values-4/#url-value) references (e.g., `background-image`, `clip-path`), and [SVG](https://svgwg.org/svg2-draft/single-page.html#types-InterfaceSVGURIReference) (e.g., `<use>`). Note that same-origin iframes would still paint, but cross-origin content in them would not.
* system colors, themes, or preferences.
* spelling and grammar markers.
* search text (find-in-page) and text-fragment (fragment url) markers.
* visited link information.
* form autofill information not otherwise available to javascript.

SVG's `<foreignObject>` can be combined with data uri images and canvas to access the pixel data of HTML content ([example](https://jsfiddle.net/progers/qhawnyeu)), and implementations currently have mitigations to prevent leaking sensitive content. As an example, an `<input>` with a spelling error is still painted, but any indication of spelling errors, which could expose the user's spelling dictionary, is not painted. Similar mitigations should be used for `drawElementImage`, but need to be expanded to cover additional cases.

## Developer Trial (dev trial) Information
The HTML-in-Canvas features may be enabled by passing the `--enable-blink-features=CanvasDrawElement` to Chrome Canary versions later than 138.0.7175.0.

Notes for dev trial usage:
* The methods were recently renamed: `drawElementImage` was previously `drawElement` and `texElementImage2D` was formerly `texElement2D`. The rename will land shortly in Chrome Canary. The change was made at developers' request to avoid confusion with existing WebGL methods. The old names will continue to work until at least Chrome 145.
* The features are currently under active development and changes to the API may happen at any time, though we make every effort to avoid unnecessary churn.
* Not all personal information (PII) is currently prevented from being painted, so take extreme care to avoid leaking PII in any demos.
* The space of possible HTML content is enormous and only a tiny fraction has been tested with `drawElementImage`.
* Interactive elements (such as links, forms or buttons) can be drawn into the canvas, but are not automatically interactive.

Other known limitations:
* Cross-origin iframes are not rendered

We are most interested in feedback on the following topics:
* What content works, and what fails? Which failure modes are most important to fix?
* Is necessary support missing for some flavors of Canvas rendering contexts?
* How does the feature interact with accessibility features? How can accessibility support be improved?

Please file bugs or design issues [here](https://github.com/WICG/html-in-canvas/issues/new).

## Other documents

* [Security and Privacy Questionnaire](./security-privacy-questionnaire.md)
