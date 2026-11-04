import tgpu, { common, d, std } from "typegpu";

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
canvas.setAttribute("layoutsubtree", "true");

const root = await tgpu.init();
const context = root.configureContext({
  canvas: canvas,
  alphaMode: "premultiplied",
});

const width = canvas.width;
const height = canvas.height;

const sampler = root.createSampler({
  magFilter: "linear",
  minFilter: "linear",
});

const layout = tgpu.bindGroupLayout({
  texture: { texture: d.texture2d(d.f32) },
  sampler: { sampler: "filtering" },
});

const contentTexture = root
  .createTexture({
    size: [width, height],
    format: "rgba8unorm",
  })
  .$usage("sampled", "render");
const contentTextureView = contentTexture.createView(d.texture2d(d.f32));

const bindGroup = root.createBindGroup(layout, {
  texture: contentTextureView,
  sampler: sampler,
});

const color1 = d.vec4f(0.325, 0.343, 0.712, 1);
const color2 = d.vec4f(0.153, 0.522, 0.616, 1);

const pipeline = root.createRenderPipeline({
  vertex: common.fullScreenTriangle,
  fragment: ({ uv }) => {
    "use gpu";
    const gradientRatio = (uv.x + uv.y) / 2;
    const gradient = std.mix(color1, color2, gradientRatio);
    const content = std.textureSample(contentTextureView.$, sampler.$, uv);

    return std.mix(gradient, content, 1 - content.a);
  },
});

const rawContentTexture = root.unwrap(contentTexture);

const contentElement = document.getElementById("content")!;
canvas.onpaint = () => {
  root.device.queue.copyElementImageToTexture(
    { source: contentElement },
    { destination: { texture: rawContentTexture }, width, height },
  );

  const drawTransform = new DOMMatrix().scale(
    width / contentElement.clientWidth,
    height / contentElement.clientHeight,
  );

  const transform = canvas.getElementTransform(contentElement, drawTransform);
  contentElement.style.transform = transform.toString();
};

canvas.requestPaint();

function render() {
  pipeline.with(bindGroup).withColorAttachment({ view: context }).draw(3);
  requestAnimationFrame(render);
}

requestAnimationFrame(render);
