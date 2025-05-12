# HTML-in-Canvas

This proposal covers new HTML Canvas APIs for rendering HTML content into the canvas on Canvas 2D, WebGL and WebGPU.

## Status

**Authors:** [Stephen Chenney](mailto:schenney@igalia.com), [Chris Harrelson](mailto:chrishtr@google.com), [Khushal Sagar](mailto:khushalsagar@google.com), [Vlad Levin](mailto:vmpstr@google.com), [Fernando Serboncini](mailto:fserb@chromium.org)

**Champions:** [Stephen Chenney](mailto:schenney@igalia.com), [Chris Harrelson](mailto:chrishtr@google.com)

This proposal is at Stage 0 of the [WHATWG Stages process](https://whatwg.org/stages).

This proposal is a subset of a [previous proposal](placeElement) covering APIs to allow live HTML elements.

## Motivation

A fundamental capability missing from the web is the ability to complement Canvas with HTML elements. Adding this capability enables Canvas surfaces to benefit from the styling and layout of HTML with CSS, including built-in accessibility.

### Use cases

* **Styled, Laid Out Content in Canvas.** There’s a strong need for better styled text support in Canvas. Examples include chart components (legend, axes, etc.) and in-game menus.
* **Accessibility Improvements.** There is currently no guarantee that the canvas fallback content currently used for accessibility always matches the rendered content, and such fallback content can be hard to generate. Accessibility information from HTML placed in the canvas would automatically match that content.
* **Composing HTML Elements with Shaders.** A limited set of CSS shaders, such as filter effects, are already available, but there is a desire to use general WebGL shaders with HTML.
* **HTML Rendering in a 3D Context.** This enables structured, styled, fully accessible text content in 3D.

In summary, users should be able to read multi-line text in canvas that provides correct i18n, accessibility and all the layout and styling capabilities expected from web content.

### Demo

TODO: This demo needs updating to remove the scrollbars and scrolling, but otherwise is still useful.
https://github.com/user-attachments/assets/a99bb40f-0b9f-4773-a0a8-d41fec575705

## drawElement Proposal

The `drawElement(element)` method renders an Element and its subtree into the 2D Canvas.

This element must be a direct child of the Canvas element. The Canvas element itself must have the `layout-subtree` HTML attribute set to `true`, causing the children
to participate in document styling and layout. To avoid unintended impacts on the document outside the canvas, use `contain: layout style` in the style for the children.
The containing block and other layout context comes from the canvas element itself.

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
    <canvas id="c">
      <div id="d">hello <a href="https://example.com">world</a>!</div>
    </canvas>
    <script>
      const ctx = document.getElementById("c").getContext("2d");
      const el = document.getElementById("d");
      ctx.rotate(Math.PI / 4);
      ctx.drawImage(el, 10, 10);
      ctx.updatedElement(el, ctx.getTransform());
    </script>
  </body>
</html>
```

This would render the text “hello [world](https://example.com)\!” to the canvas with an interactable text.

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
