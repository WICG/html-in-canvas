import type { TgpuComputePipeline, TgpuRoot, TgpuTextureView } from 'typegpu';
import tgpu, { d, std } from 'typegpu';
import { taaResolveLayout } from './dataTypes.ts';

export const taaResolveFn = tgpu.computeFn({
  workgroupSize: [16, 16],
  in: {
    gid: d.builtin.globalInvocationId,
  },
})(({ gid }) => {
  const currentColor = std.textureLoad(taaResolveLayout.$.currentTexture, d.vec2u(gid.xy), 0);

  const historyColor = std.textureLoad(taaResolveLayout.$.historyTexture, d.vec2u(gid.xy), 0);

  let minColor = d.vec3f(9999.0);
  let maxColor = d.vec3f(-9999.0);

  const dimensions = std.textureDimensions(taaResolveLayout.$.currentTexture);

  for (const x of tgpu.unroll([-1, 0, 1])) {
    for (const y of tgpu.unroll([-1, 0, 1])) {
      const sampleCoord = d.vec2i(gid.xy).add(d.vec2i(x, y));
      const clampedCoord = std.clamp(
        sampleCoord,
        d.vec2i(0, 0),
        d.vec2i(dimensions.xy).sub(d.vec2i(1)),
      );

      const neighborColor = std.textureLoad(taaResolveLayout.$.currentTexture, clampedCoord, 0);

      minColor = std.min(minColor, neighborColor.rgb);
      maxColor = std.max(maxColor, neighborColor.rgb);
    }
  }

  const historyColorClamped = std.clamp(historyColor.rgb, minColor, maxColor);

  const uv = d.vec2f(gid.xy).div(d.vec2f(dimensions.xy));

  const textRegionMinX = d.f32(0.71);
  const textRegionMaxX = d.f32(0.85);
  const textRegionMinY = d.f32(0.47);
  const textRegionMaxY = d.f32(0.55);

  const borderSize = d.f32(0.02);

  const fadeInX = std.smoothstep(textRegionMinX - borderSize, textRegionMinX + borderSize, uv.x);
  const fadeOutX =
    d.f32(1.0) - std.smoothstep(textRegionMaxX - borderSize, textRegionMaxX + borderSize, uv.x);
  const fadeInY = std.smoothstep(textRegionMinY - borderSize, textRegionMinY + borderSize, uv.y);
  const fadeOutY =
    d.f32(1.0) - std.smoothstep(textRegionMaxY - borderSize, textRegionMaxY + borderSize, uv.y);

  const inTextRegion = fadeInX * fadeOutX * fadeInY * fadeOutY;
  const blendFactor = std.mix(d.f32(0.9), d.f32(0.7), inTextRegion);

  const resolvedColor = d.vec4f(std.mix(currentColor.rgb, historyColorClamped, blendFactor), 1.0);

  std.textureStore(taaResolveLayout.$.outputTexture, d.vec2u(gid.x, gid.y), resolvedColor);
});

export function createTaaTextures(root: TgpuRoot, width: number, height: number) {
  return [0, 1].map(() => {
    const texture = root['~unstable']
      .createTexture({
        size: [width, height],
        format: 'rgba8unorm',
      })
      .$usage('storage', 'sampled');

    return {
      write: texture.createView(d.textureStorage2d('rgba8unorm')),
      sampled: texture.createView(),
    };
  });
}

export class TAAResolver {
  #pipeline: TgpuComputePipeline;
  #textures: ReturnType<typeof createTaaTextures>;
  #root: TgpuRoot;
  #width: number;
  #height: number;

  constructor(root: TgpuRoot, width: number, height: number) {
    this.#root = root;
    this.#width = width;
    this.#height = height;

    this.#pipeline = root.createComputePipeline({ compute: taaResolveFn });

    this.#textures = createTaaTextures(root, width, height);
  }

  resolve(
    currentTexture: TgpuTextureView<d.WgslTexture2d<d.F32>>,
    frameCount: number,
    currentFrame: number,
  ) {
    const previousFrame = 1 - currentFrame;

    this.#pipeline
      .with(
        this.#root.createBindGroup(taaResolveLayout, {
          currentTexture,
          historyTexture: frameCount === 1 ? currentTexture : this.#textures[previousFrame].sampled,
          outputTexture: this.#textures[currentFrame].write,
        }),
      )
      .dispatchWorkgroups(Math.ceil(this.#width / 16), Math.ceil(this.#height / 16));

    return this.#textures[currentFrame].sampled;
  }

  resize(width: number, height: number) {
    this.#width = width;
    this.#height = height;
    this.#textures = createTaaTextures(this.#root, width, height);
  }

  getResolvedTexture(frame: number) {
    return this.#textures[frame].sampled;
  }
}
