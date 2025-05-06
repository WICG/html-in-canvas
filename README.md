# HTML-in-Canvas

This proposal covers new HTML Canvas APIs for rendering HTML content into the canvas on Canvas 2D, WebGL and WebGPU.

## Status

**Authors:** [Stephen Chenney](mailto:schenney@igalia.com), [Chris Harrelson](emaail:chrishtr@google.com), [Khushal Sagar](mailto:khushalsagar@google.com), [Vlad Levin](email:vmpstr@google.com), [Fernando Serboncini](mailto:fserb@chromium.org)

**Champions:** [Stephen Chenney](mailto:schenney@igalia.com), TODO: Who else will be leading?

This proposal is at Stage 0 of the [WHATWG Stages process](https://whatwg.org/stages).

This proposal is a subset of a [previous proposal](placeElement) covering APIs to allow live HTML elements.

## Motivation

A fundamental capability missing from the web is the ability to complement Canvas with HTML elements. Adding this capability enables Canvas surfaces to benefit from the styling and layout of HTML with CSS, including built-in accessibility.

### Use cases

* **Styled, Laid Out Content in Canvas.** There’s a strong need for better text support on Canvas. Examples include chart components (legend, axes, etc.) and in-game menus.
* **Accessibility Improvements.** There is currently no guarantee that the canvas fallback content currently used for accessibility always matches the rendered content, and such fallback content can be hard to generate. Accessibility information from HTML placed in the canvas would automatically match that content.
* **Composing HTML Elements with Shaders.** A limited set of CSS shaders, such as filter effects, are already available, but there is a desire to use general WebGL shaders with HTML.
* **HTML Rendering in a 3D Context.** This enables structured, styled, fully accessible text content in 3D.

In summary, users should be able to read multi-line text in canvas that provides correct i18n, accessibility and all the layout and styling capabilities expected from web content.

### Demo

TODO: This demo needs updating to remove the scrollbars and scrolling, but otherwise is still useful.
https://github.com/user-attachments/assets/a99bb40f-0b9f-4773-a0a8-d41fec575705

## drawElement Proposal

The `drawElement(element)` method renders an Element and its subtree into the 2D Canvas.

This element must be a direct child of the Canvas element. The children elements of Canvas don’t impact the overall document layout and, before `drawElement`, are considered fallback content used to provide accessibility information on modern browsers.

The element is rendered at a particular position and takes the CTM (current transform matrix) of the canvas into consideration. From a document layout perspective, when `drawElement` is called on an element it becomes part of the document layout (although isolated from the rest of the document), and has CSS applied. The containing block and other layout context comes from the canvas element itself.

`drawElement()` will taint the canvas unless the subtree meets certain requirements. TODO(schenney) Expand on what would prevent tainting.

It returns the element placed or null if failed.

It’s also worth noting that this never duplicates the element. If called twice on a single canvas, it simply replicates the element to a new location \+ CTM and to a new position in the canvas stack.

```idl
TODO Update this.

interface mixin CanvasDrawElements {
  undefined updateElement(Element el,
    optional DOMMatrixInit transform = {}, optional long zOrder);
  undefined removeElement(Element el);
}

interface CanvasInvalidationEvent {
  readonly attribute HTMLCanvasElement canvas;
  readonly attribute DOMString reason;
  readonly attribute DOMRect invalidation;
}

// for Canvas 2D
// drawImage
typedef (... or Element) CanvasImageSource;

CanvasRenderingContext2D includes CanvasDrawElements;

// for WebGL
// texImage2D, texSubImage2D
typedef (... or Element) TexImageSource;

WebGLRenderingContext includes CanvasDrawElements;
WebGL2RenderingContext includes CanvasDrawElements;

// for WebGPU
// copyExternalImageToTexture
typedef (... or Element) GPUImageCopyExternalImageSource;

GPUCanvasContext includes CanvasDrawElements;
```

TODO: The following is still relevant in some way, but needs re-writing.

When using the drawElement API, the author must complete the rendering loop in Javascript to make the element alive:

* it needs to call the draw function (`drawImage`, `texImage2D`, `GPUImageCopyExternalImageSource`),
* update the element transform (so the browser knows where the element ended up (in relationship to the canvas), and
* respond to a new invalidation event (for redrawing or refocusing within the scene, as needed). In theory, the invalidation event is optional if the user is updating the element on RAF, but it could still be useful if the page wants to respond to a find-in-page event, for example.

In theory, `drawElement` can be used to provide non-accessible text. We still enforce that the element (at drawing time) must be a child of its canvas, but the liveness of the element depends on developers doing the right thing. That said, the current status quo is that it’s impossible for developers to “do the right thing”, i.e., text in 3D contexts \- for example \- is currently always inaccessible. This API would allow developers to do the right thing.

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

## Other documents

* [Security and Privacy Questionaire](./security-privacy-questionnaire.md)
