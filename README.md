# HTML-in-Canvas

This proposal covers new HTML Canvas APIs for rendering HTML content into the canvas on Canvas 2D, WebGL and WebGPU.

## Status

**Authors:** [Stephen Chenney](mailto:schenney@igalia.com), [Chris Harrelson](mailto:chrishtr@google.com), [Khushal Sagar](mailto:khushalsagar@google.com), [Vlad Levin](mailto:vmpstr@google.com), [Fernando Serboncini](mailto:fserb@chromium.org)

**Champions:** [Stephen Chenney](mailto:schenney@igalia.com), [Chris Harrelson](mailto:chrishtr@google.com)

This proposal is at Stage 0 of the [WHATWG Stages process](https://whatwg.org/stages).

This proposal is a subset of a [previous proposal](placeElement) covering APIs to allow live HTML elements.

## Motivation

There is no web API to easily render complex layouts of text and other content into a `<canvas>`. As a result, `<canvas>`-based content suffers in accessibilty, internationalization, performance and quality.

### Use cases

* **Styled, Laid Out Content in Canvas.** There’s a strong need for better styled text support in Canvas. Examples include chart components (legend, axes, etc.), rich content boxes in creative tools, and in-game menus.
* **Accessibility Improvements.** There is currently no guarantee that the canvas fallback content currently used for `<canvas>` accessibility always matches the rendered content, and such fallback content can be hard to generate. Accessibility information from HTML placed in the canvas would automatically match that content.
* **Composing HTML Elements with Shaders.** A limited set of CSS shaders, such as filter effects, are already available, but there is a desire to use general WebGL shaders with HTML.
* **HTML Rendering in a 3D Context.** 3D aspects of sites and games need to render rich 2D content into surfaces within a 3D scene.

### Demo

TODO: This demo needs updating to remove the scrollbars and scrolling, but otherwise is still useful.
https://github.com/user-attachments/assets/a99bb40f-0b9f-4773-a0a8-d41fec575705

## Proposed solution: drawElement on CanvasRenderingContext2D, and texElement2D on WebGLRenderingContext; `layoutsubtree` attribute on the <canvas> element

The `CanvasRenderingContext2D.drawElement(element)` method renders an Element and its subtree into the 2D canvas.

This element must be a direct child of the  `<canvas>` element. The `<canvas>` element itself must have the `layoutsubtree` HTML attribute set to `true`, causing the children
to participate in document styling and layout. Direct children of the `<canvas>` establish a stacking context, and a containing block for all descendants. 

When `drawElement(element, x, y, dwidth, dheight)` is called with an `element` the element is rendered at the given position and takes the CTM (current transform matrix)
of the canvas into consideration. The intrinsic size of the element is the border box; content outside the border box will be clipped, including shadows. The `dwidth`
and `dheight` parameters scale the element to fit the given rectangle. They may be omitted to draw the element at its intrinsic size. The same element may be drawn multiple times.

Once drawn, the resulting canvas image is static. Subsequent changes to the element will not be reflected in the canvas, so the element must be explicitly redrawn if an author wishes to see the changes.

The children elements of Canvas are still considered fallback content used to provide accessibility information on modern browsers.
See [Issue#11](https://github.com/WICG/html-in-canvas/issues/11) for an ongoing discussion of accessibility concerns. 

`drawElement()` currently does not taint the canvas. When using this feature in a DevTrial, take steps to avoid leaking private information.
[Issue#11](https://github.com/WICG/html-in-canvas/issues/5) is concerned with future steps for preserving privacy.

```idl
interface CanvasRenderingContext2D {

  ...

  [RaisesException]
  void drawElement(Element element, unrestricted double x, unrestricted double y);

  [RaisesException]
  void drawElement(Element element, unrestricted double x, unrestricted double y,
                   unrestricted double dwidth, unrestricted double dheight);

[TODO: Define a separate mixin and use it in WebGL, WebGP, etc]
```

Usage example:

```html
<!doctype html>
<html>
  <body>
    <canvas id="c" layoutsubtree="true">
      <div id="d">Hello world!</div>
    </canvas>
    <script>
      const ctx = document.getElementById("c").getContext("2d");
      const el = document.getElementById("d");
      ctx.rotate(Math.PI / 4);
      ctx.drawElement(el, 30, 0);
    </script>
  </body>
</html>
```

This renders the text “Hello World!” to the canvas at a 45 degree angle.

## DevTrial Information
The HTML-in-Canvas features may be enabled by passing the `--enable-blink-features=CanvasElementDrawElement` to Chrome Canary versions later than 138.0.7175.0.

Notes for DevTrial usage:
* The features are currently under active development and changes to the API may happen at any time, though we make every effort to avoid churn.
* The canvas is not tainted regardless of the content drawn, so take extreme care to avoid leaking confidential personal information (PII).
* The space of possible HTML content is enormous and only a tiny fraction has been tested with `drawElement`.

We are most interesting in feedback on the following topics:
* What content works, and what fails? Which failure modes are most important to fix?
* Is necessary support missing for some flavors of Canvas rendering contexts?
* How does the feature interact with accessibility features? How can accessibility support be improved?
* Please file bugs at [TODO: link]

## Other documents

* [Security and Privacy Questionnaire](./security-privacy-questionnaire.md)
