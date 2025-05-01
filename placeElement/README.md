# placeElement

This proposal covers APIs to allow live HTML elements on Canvas 2D, WebGL and WebGPU.

## Status

**Authors:** [Fernando Serboncini](mailto:fserb@google.com), [Khushal Sagar](mailto:khushalsagar@google.com), [Stephen Chenney](mailto:schenney@igalia.com), Aaron Krajeski, Chris Harrelson

**Champions:** [Fernando Serboncini](mailto:fserb@google.com), [Khushal Sagar](mailto:khushalsagar@google.com)

This proposal is at Stage 0 of the [WHATWG Stages process](https://whatwg.org/stages).

## Motivation

A fundamental capability missing from the web is the ability to complement Canvas with HTML elements. Adding this capability enables Canvas surfaces to benefit from all of the styling, layout and behaviors of HTML, including interactive elements and built-in accessibility.

### Use cases

* **Styled, Laid Out Content in Canvas.** There’s a strong need for better text support on Canvas. Examples include chart components (legend, axes, etc.) and in-game menus. This includes not only visual features but also the possibility of supporting the same level of user interaction as the rest of the web (scrolling, interactions, accessibility, indexability, translate, find-in-page, IME input, spellcheck, autofill, etc).
* **Accessibility Improvements.** There is currently no guarantee that the canvas fallback content currently used for accessibility always matches the rendered content, and such fallback content can be hard to generate. Accessibility information from HTML placed in the canvas would automatically match that content. Additional benefits include accurate tab navigation and better focus rings. These things currently require considerable author effort to implement with primitive text drawing in canvas.
* **Interactive forms.** Access to live interactive forms, links, editable content with the same quality as the web. This will help to close the app gap with Flash.
* **Composing HTML Elements with Shaders.** A limited set of CSS shaders, such as filter effects, are already available, but there is a desire to use general WebGL shaders with HTML.
* **HTML Rendering in a 3D Context.** This enables interactions and fully accessible content in 3D.

In summary, users should be able to read multi-line text in canvas that provides correct i18n, a11y and all other capabilities expected from web content.

### Demo

https://github.com/user-attachments/assets/a99bb40f-0b9f-4773-a0a8-d41fec575705

## Proposal

There are 2 API surfaces to be exposed on this proposal. First, a high level API that brings an Element and its subtree into the 2D Canvas. Second, a broken down version that allows finer control over Javascript and is also available in 3D contexts.

For this explainer, we use the term “live element” to describe an HTML element not only rendered to the screen, but that also responds to events, user interactions, text selection, scrolling, tab order, accessibility.

### **placeElement**

`placeElement` is the high level “do the right thing” API.

```idl
interface mixin CanvasPlaceElements {
  Element placeElement(Element el, double x, double y);
}

CanvasRenderingContext2D includes CanvasPlaceElements;
```

This element must be a direct child of the Canvas element. The children elements of Canvas don’t impact the overall document layout and, before placeElement, are considered fallback content used to provide accessibility information on modern browsers. Once `placeElement` is called, the element becomes alive until the canvas is reset (either by `ctx.reset()` or `canvas.width \= canvas.width`) or until it’s not a child of the canvas anymore.

The element is rendered at a particular position and takes the CTM (current transform matrix) of the canvas into consideration. From a document layout perspective, when `placeElement` is called on an element it becomes part of the document layout (although isolated from the rest of the document), and has CSS applied and executing script. The containing block and other layout context comes from the canvas element itself.

The element gets repainted (together with the canvas) as needed. The call order of `placeElement` implicitly describes which canvas draw commands happen before (below) or after (above) the rendering of the element.

`placeElement()` may taint the canvas. It returns the element placed or null if failed.

It’s also worth noting that this never duplicates the element. If called twice on a single canvas, it simply “replaces” (repositions) the element to a new location \+ CTM and to a new position in the canvas stack.

### Usage example

```html
<!doctype html>
<html>
  <body>
    <canvas id="c">
      <div id="d">hello <a href="https://example.com">world</a>!</div>
    </canvas>
    <script>
      const ctx = document.getElementById("c").getContext("2d");
      ctx.rotate(Math.PI / 4);
      ctx.placeElement(document.getElementById("d"), 10, 10);
    </script>
  </body>
</html>
```

This would add a text “hello [world](https://example.com)\!” to the canvas, with a clickable link and interactable text rotated by 45 degrees.

### **drawElement**

The second API is a limited and deconstructed version of `placeElement`, that allows the same behavior as `placeElement`, but broken down in stages. It requires more work from developers to support live elements, but is also exposed to 3D contexts, which `placeElement` isn’t. This API is also useful for cases where interaction is not required, like drawing better text for images or for screenshotting the page.

```idl
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

When using the drawElement API, the author must complete the rendering loop in Javascript to make the element alive:

* it needs to call the draw function (`drawImage`, `texImage2D`, `GPUImageCopyExternalImageSource`),
* update the element transform (so the browser knows where the element ended up (in relationship to the canvas), and
* respond to a new invalidation event (for redrawing or refocusing within the scene, as needed). In theory, the invalidation event is optional if the user is updating the element on RAF, but it could still be useful if the page wants to respond to a find-in-page event, for example.

In theory, `drawElement` can be used to provide non-accessible text. We still enforce that the element (at drawing time) must be a child of its canvas, but the liveness of the element depends on developers doing the right thing. That said, the current status quo is that it’s impossible for developers to “do the right thing”, i.e., text in 3D contexts \- for example \- is currently always inaccessible. This API would allow developers to do the right thing.

An element already used in `placeElement` can be drawn, but cannot have its transform updated.

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

* [Open Questions](./QUESTIONS.md)
* [Implementation Details on Chromium](./IMPLEMENTATION.md)

## Q&A
