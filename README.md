 # HTML-in-Canvas

We propose new HTML Canvas APIs for rendering HTML content into the canvas for Canvas 2D and WebGL.

## Status

**Authors:** [Stephen Chenney](mailto:schenney@igalia.com), [Chris Harrelson](mailto:chrishtr@google.com), [Khushal Sagar](mailto:khushalsagar@google.com), [Vladimir Levin](mailto:vmpstr@chromium.org), [Fernando Serboncini](mailto:fserb@chromium.org)

**Champions:** [Stephen Chenney](mailto:schenney@igalia.com), [Chris Harrelson](mailto:chrishtr@google.com)

This proposal is a subset of a [previous proposal](placeElement) covering APIs to allow live HTML elements.

## Motivation

There is no web API to easily render complex layouts of text and other content into a `<canvas>`. As a result, `<canvas>`-based content suffers in accessibilty, internationalization, performance and quality.

### Use cases

* **Styled, Laid Out Content in Canvas.** There’s a strong need for better styled text support in Canvas. Examples include chart components (legend, axes, etc.), rich content boxes in creative tools, and in-game menus.
* **Accessibility Improvements.** There is currently no guarantee that the canvas fallback content currently used for `<canvas>` accessibility always matches the rendered content, and such fallback content can be hard to generate. With this API, elements drawn into the canvas bitmap will match their corresponding canvas fallback.
* **Composing HTML Elements with Shaders.** A limited set of CSS shaders, such as filter effects, are already available, but there is a desire to use general WebGL shaders with HTML.
* **HTML Rendering in a 3D Context.** 3D aspects of sites and games need to render rich 2D content into surfaces within a 3D scene.

## Proposed solution: `layoutsubtree`, `drawElement`, and `texElement2D` 

* the `layoutsubtree` attribute on a `<canvas>` element allows its descendant elements to have layout (*), and causes the direct children of the `<canvas>` to have a stacking context and become a containing block for all descendants. Descendant elements of the `<canvas>` still do not paint or hit-test, and are not discovered by UA algorithms like find-in-page.
* The `CanvasRenderingContext2D.drawElement(element, x, y)` method renders `element` and its subtree into a 2D canvas at offset x and y, so long as `element` is a direct child of the `<canvas>`. It has no effect if `layoutsubtree` is not specified on the `<canvas>`.
* The `WebGLRenderingContext.texElement2D(..., element)` method renders `element` into a WebGL texture. It has no effect if `layoutsubtree` is not specified on the `<canvas>`.

(*) Without `layoutsubtree`, geometry APIs such as `getBoundingClientRect()` on these elements return an empty rect. They do have computed styles, however, and are keyboard-focusable.

`drawElement(element ...)` takes the CTM (current transform matrix) of the canvas into consideration. The image drawn into the canvas is sized to `element`'s border box size; element outsize that bounds (including ink and layout overflow) are clipped. The `drawElement(element, x, y, dwidth, dheight)` variant resizes the image of `element`'s subtree to `dwidth` and `dheight`.

The same element may be drawn multiple times.

Once drawn, the resulting canvas image is static. Subsequent changes to the element will not be reflected in the canvas, so the element must be explicitly redrawn if an author wishes to see the changes.

The descendant elements of the `<canvas>` are considered fallback content used to provide accessibility information.
See [Issue#11](https://github.com/WICG/html-in-canvas/issues/11) for an ongoing discussion of accessibility concerns.

Offscreen canvas contexts and detached canvases are not supported because drawing DOM content when the canvas is not in the DOM poses technical challenges. See [Issue#2](https://github.com/WICG/html-in-canvas/issues/2) for further discussion.

**NOTE**: The current implementation of `drawElement()` and `texElement2D` does not taint the canvas and is not suitable for use outside of local demos. When using this feature in a DevTrial, take steps to avoid leaking private information. See
[Issue#5](https://github.com/WICG/html-in-canvas/issues/5) for discussion of design options for preserving privacy.

```idl
interface CanvasRenderingContext2D {

  ...

  [RaisesException]
  void drawElement(Element element, unrestricted double x, unrestricted double y);

  [RaisesException]
  void drawElement(Element element, unrestricted double x, unrestricted double y,
                   unrestricted double dwidth, unrestricted double dheight);

```

```idl
interface WebGLRenderingContext {

  ...

  [RaisesException]
    void texElement2D(GLenum target, GLint level, GLint internalformat,
                      GLenum format, GLenum type, Element element);

```

## Demos

[See here](Examples/complex-text.html) to see an example of how to use the API. It should render like the following (the blue rectangle indicates the bounds of the `<canvas>`, and the black the element passed to
drawElement):

![image](https://github.com/user-attachments/assets/88d5200b-176c-4102-a4a0-f5893101b295)

[See here](Examples/webGL.html) for an example of how to use the WebGL `texElement2D` API to populate a GL texture with HTML content.
The example should render an animated cube, like in the following shapshot. Note how the border box fills the entire face of the cube.
To adjust that, modify the texture coordinates for rendering the cube and possibly adjust the texture wrap
parameters. Or, wrap the content in a larger `<div>` and draw the `<div>`.

![image](https://github.com/user-attachments/assets/78606b3b-706c-4066-875b-c6245d7ef27f)


## Developer Trial (dev trial) Information
The HTML-in-Canvas features may be enabled by passing the `--enable-blink-features=CanvasDrawElement` to Chrome Canary versions later than 138.0.7175.0.

Notes for dev trial usage:
* The features are currently under active development and changes to the API may happen at any time, though we make every effort to avoid unnecessary churn.
* The canvas is not tainted regardless of the content drawn, so take extreme care to avoid leaking confidential personal information (PII) in any demos.
* The space of possible HTML content is enormous and only a tiny fraction has been tested with `drawElement`.
* Interactive elements (such as links, forms or buttons) can be drawn into the canvas, but are not automatically interactive.

Other known limitations:
* Cross-origin iframes are not rendered
* SVG foreignObject is not yet working

We are most interesting in feedback on the following topics:
* What content works, and what fails? Which failure modes are most important to fix?
* Is necessary support missing for some flavors of Canvas rendering contexts? 
* How does the feature interact with accessibility features? How can accessibility support be improved?

Please file bugs or design issues [here](https://github.com/WICG/html-in-canvas/issues/new).

## Other documents

* [Security and Privacy Questionnaire](./security-privacy-questionnaire.md)
