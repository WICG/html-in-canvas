import { d, std, type TgpuRoot } from 'typegpu';
import { BoxIntersection } from './dataTypes.ts';

export const fresnelSchlick = (cosTheta: number, ior1: number, ior2: number) => {
  'use gpu';
  const r0 = std.pow((ior1 - ior2) / (ior1 + ior2), 2.0);
  return r0 + (1.0 - r0) * std.pow(1.0 - cosTheta, 5.0);
};

export const beerLambert = (sigma: d.v3f, dist: number) => {
  'use gpu';
  return std.exp(std.mul(sigma, -dist));
};

export const intersectBox = (
  rayOrigin: d.v3f,
  rayDirection: d.v3f,
  boxMin: d.v3f,
  boxMax: d.v3f,
) => {
  'use gpu';
  const invDir = d.vec3f(1.0).div(rayDirection);

  const t1 = std.sub(boxMin, rayOrigin).mul(invDir);
  const t2 = std.sub(boxMax, rayOrigin).mul(invDir);

  const tMinVec = std.min(t1, t2);
  const tMaxVec = std.max(t1, t2);

  const tMin = std.max(tMinVec.x, tMinVec.y, tMinVec.z);
  const tMax = std.min(tMaxVec.x, tMaxVec.y, tMaxVec.z);

  const result = BoxIntersection();
  result.hit = tMax >= tMin && tMax >= 0.0;
  result.tMin = tMin;
  result.tMax = tMax;

  return result;
};

export function createTextures(root: TgpuRoot, width: number, height: number) {
  return [0, 1].map(() => {
    const texture = root['~unstable']
      .createTexture({
        size: [width, height],
        format: 'rgba8unorm',
      })
      .$usage('storage', 'sampled', 'render');

    return {
      write: texture.createView(d.textureStorage2d('rgba8unorm')),
      sampled: texture.createView(),
    };
  });
}

export function createBackgroundTexture(root: TgpuRoot, width: number, height: number) {
  const texture = root['~unstable']
    .createTexture({
      size: [width, height],
      format: 'rgba16float',
    })
    .$usage('sampled', 'render');

  return {
    sampled: texture.createView(),
  };
}
