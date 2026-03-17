import tgpu, { d } from 'typegpu';

export const DirectionalLight = d.struct({
  direction: d.vec3f,
  color: d.vec3f,
});

export const ObjectType = {
  SLIDER: 1,
  BACKGROUND: 2,
} as const;

export const HitInfo = d.struct({
  distance: d.f32,
  objectType: d.i32,
  t: d.f32,
});

export const LineInfo = d.struct({
  t: d.f32,
  distance: d.f32,
  normal: d.vec2f,
});

export const BoxIntersection = d.struct({
  hit: d.bool,
  tMin: d.f32,
  tMax: d.f32,
});

export const Ray = d.struct({
  origin: d.vec3f,
  direction: d.vec3f,
});

export const SdfBbox = d.struct({
  left: d.f32,
  right: d.f32,
  bottom: d.f32,
  top: d.f32,
});

export const rayMarchLayout = tgpu.bindGroupLayout({
  backgroundTexture: { texture: d.texture2d(d.f32) },
  valueTexture: { texture: d.texture2d(d.f32) },
});

export const taaResolveLayout = tgpu.bindGroupLayout({
  currentTexture: {
    texture: d.texture2d(),
  },
  historyTexture: {
    texture: d.texture2d(),
  },
  outputTexture: {
    storageTexture: d.textureStorage2d('rgba8unorm', 'write-only'),
  },
});

export const sampleLayout = tgpu.bindGroupLayout({
  currentTexture: {
    texture: d.texture2d(),
  },
});
