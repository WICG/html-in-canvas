import * as sdf from '@typegpu/sdf';
import tgpu, { common, d, std } from 'typegpu';

import { randf } from '@typegpu/noise';
import { Slider } from './slider.ts';
import { CameraController } from './camera.ts';
import {
  DirectionalLight,
  HitInfo,
  LineInfo,
  ObjectType,
  Ray,
  rayMarchLayout,
  sampleLayout,
  SdfBbox,
} from './dataTypes.ts';
import {
  beerLambert,
  createBackgroundTexture,
  createTextures,
  fresnelSchlick,
  intersectBox,
} from './utils.ts';
import { TAAResolver } from './taa.ts';
import {
  AMBIENT_COLOR,
  AMBIENT_INTENSITY,
  AO_BIAS,
  AO_INTENSITY,
  AO_RADIUS,
  AO_STEPS,
  JELLY_IOR,
  JELLY_SCATTER_STRENGTH,
  LINE_HALF_THICK,
  LINE_RADIUS,
  MAX_DIST,
  MAX_STEPS,
  SPECULAR_INTENSITY,
  SPECULAR_POWER,
  SURF_DIST,
} from './constants.ts';

const root = await tgpu.init({
  device: {
    optionalFeatures: ['timestamp-query'],
  },
});

const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
const canvas = document.querySelector('canvas') as HTMLCanvasElement;
const context = root.configureContext({ canvas, alphaMode: 'premultiplied' });

const NUM_POINTS = 17;

const slider = new Slider(root, d.vec2f(-1, 0), d.vec2f(0.9, 0), NUM_POINTS, -0.03);
const bezierTexture = slider.bezierTexture.createView();
const bezierBbox = slider.bbox;

let qualityScale = 1.0;
let [width, height] = [canvas.width * qualityScale, canvas.height * qualityScale];

let textures = createTextures(root, width, height);
let backgroundTexture = createBackgroundTexture(root, width, height);

const sliderElement = document.getElementById('slider') as HTMLInputElement;
const valueElement = document.getElementById('value') as HTMLDivElement;

const valueRawTexture = root.device.createTexture({
  size: [width, height, 1],
  format: 'rgba8unorm',
  usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
});
const valueTextureView = valueRawTexture.createView();

// Return a number from 0...100 as a string Zero percent...One hundred percent.
function getPercentString(n: number): string {
  if (n === 100) return "One-hundred %";

  const ones: string[] = [
    "Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"
  ];

  const tens: string[] = [
    "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"
  ];

  // Handle 0 through 19
  if (n < 20) {
    return `${ones[n]} %`;
  }

  // Handle 20 through 99
  const tensWord: string = tens[Math.floor(n / 10)];
  const onesWord: string = n % 10 === 0 ? "" : `-${ones[n % 10].toLowerCase()}`;

  return `${tensWord}${onesWord} %`;
}

let targetMouseX = 0.9;
let currentMouseX = 0.9;

sliderElement.addEventListener('input', () => {
  const t = Number(sliderElement.value) / 100.0;
  targetMouseX = t * 1.9 - 1.0;
  valueElement.textContent = getPercentString(Number(sliderElement.value));
  (canvas as any).requestPaint();
});
valueElement.textContent = getPercentString(Number(sliderElement.value));

const filteringSampler = root['~unstable'].createSampler({
  magFilter: 'linear',
  minFilter: 'linear',
});

const camera = new CameraController(
  root,
  d.vec3f(0, 2.7, 1.9),
  d.vec3f(0, 0, 0),
  d.vec3f(0, 1, 0),
  Math.PI / 4,
  width,
  height,
);
const cameraUniform = camera.cameraUniform;

const lightUniform = root.createUniform(DirectionalLight, {
  direction: std.normalize(d.vec3f(0.19, -0.24, 0.75)),
  color: d.vec3f(1, 1, 1),
});

const jellyColorUniform = root.createUniform(d.vec4f, d.vec4f(1.0, 0.45, 0.075, 1.0));
const groundColorUniform = root.createUniform(d.vec3f, d.vec3f(1.0));
const groundTextColorUniform = root.createUniform(d.vec3f, d.vec3f(0.5));

const randomUniform = root.createUniform(d.vec2f);
const blurEnabledUniform = root.createUniform(d.u32);

const getRay = (ndc: d.v2f) => {
  'use gpu';
  const clipPos = d.vec4f(ndc.x, ndc.y, -1.0, 1.0);

  const invView = cameraUniform.$.viewInv;
  const invProj = cameraUniform.$.projInv;

  const viewPos = invProj.mul(clipPos);
  const viewPosNormalized = d.vec4f(viewPos.xyz.div(viewPos.w), 1.0);

  const worldPos = invView.mul(viewPosNormalized);

  const rayOrigin = invView.columns[3].xyz;
  const rayDir = std.normalize(worldPos.xyz.sub(rayOrigin));

  return Ray({
    origin: rayOrigin,
    direction: rayDir,
  });
};

const getSliderBbox = () => {
  'use gpu';
  return SdfBbox({
    left: d.f32(bezierBbox[3]),
    right: d.f32(bezierBbox[1]),
    bottom: d.f32(bezierBbox[2]),
    top: d.f32(bezierBbox[0]),
  });
};

const sdInflatedPolyline2D = (p: d.v2f) => {
  'use gpu';
  const bbox = getSliderBbox();

  const uv = d.vec2f(
    (p.x - bbox.left) / (bbox.right - bbox.left),
    (bbox.top - p.y) / (bbox.top - bbox.bottom),
  );
  const clampedUV = std.saturate(uv);

  const sampledColor = std.textureSampleLevel(bezierTexture.$, filteringSampler.$, clampedUV, 0);
  const segUnsigned = sampledColor.x;
  const progress = sampledColor.y;
  const normal = sampledColor.zw;

  return LineInfo({
    t: progress,
    distance: segUnsigned,
    normal: normal,
  });
};

const cap3D = (position: d.v3f) => {
  'use gpu';
  const endCap = slider.endCapUniform.$;
  const secondLastPoint = d.vec2f(endCap.x, endCap.y);
  const lastPoint = d.vec2f(endCap.z, endCap.w);

  const angle = std.atan2(lastPoint.y - secondLastPoint.y, lastPoint.x - secondLastPoint.x);
  const rot = d.mat2x2f(std.cos(angle), -std.sin(angle), std.sin(angle), std.cos(angle));

  let pieP = position.sub(d.vec3f(secondLastPoint, 0));
  pieP = d.vec3f(rot.mul(pieP.xy), pieP.z);
  const hmm = sdf.sdPie(pieP.zx, d.vec2f(1, 0), LINE_HALF_THICK);
  const extrudeEnd = sdf.opExtrudeY(pieP, hmm, 0.001) - LINE_RADIUS;
  return extrudeEnd;
};

const sliderSdf3D = (position: d.v3f) => {
  'use gpu';
  const poly2D = sdInflatedPolyline2D(position.xy);

  let finalDist = d.f32(0.0);
  if (poly2D.t > 0.94) {
    finalDist = cap3D(position);
  } else {
    const body = sdf.opExtrudeZ(position, poly2D.distance, LINE_HALF_THICK) - LINE_RADIUS;
    finalDist = body;
  }

  return LineInfo({
    t: poly2D.t,
    distance: finalDist,
    normal: poly2D.normal,
  });
};

const GroundParams = {
  groundThickness: 0.03,
  groundRoundness: 0.02,
};

const rectangleCutoutDist = (position: d.v2f) => {
  'use gpu';
  const groundRoundness = GroundParams.groundRoundness;

  return sdf.sdRoundedBox2d(
    position,
    d.vec2f(1 + groundRoundness, 0.2 + groundRoundness),
    0.2 + groundRoundness,
  );
};

const getMainSceneDist = (position: d.v3f) => {
  'use gpu';
  const groundThickness = GroundParams.groundThickness;
  const groundRoundness = GroundParams.groundRoundness;

  return sdf.opUnion(
    sdf.sdPlane(position, d.vec3f(0, 1, 0), 0.06),
    sdf.opExtrudeY(position, -rectangleCutoutDist(position.xz), groundThickness - groundRoundness) -
      groundRoundness,
  );
};

const sliderApproxDist = (position: d.v3f) => {
  'use gpu';
  const bbox = getSliderBbox();

  const p = position.xy;
  if (p.x < bbox.left || p.x > bbox.right || p.y < bbox.bottom || p.y > bbox.top) {
    return 1e9;
  }

  const poly2D = sdInflatedPolyline2D(p);
  const dist3D = sdf.opExtrudeZ(position, poly2D.distance, LINE_HALF_THICK) - LINE_RADIUS;

  return dist3D;
};

const getSceneDist = (position: d.v3f) => {
  'use gpu';
  const mainScene = getMainSceneDist(position);
  const poly3D = sliderSdf3D(position);

  const hitInfo = HitInfo();

  if (poly3D.distance < mainScene) {
    hitInfo.distance = poly3D.distance;
    hitInfo.objectType = ObjectType.SLIDER;
    hitInfo.t = poly3D.t;
  } else {
    hitInfo.distance = mainScene;
    hitInfo.objectType = ObjectType.BACKGROUND;
  }
  return hitInfo;
};

const getSceneDistForAO = (position: d.v3f) => {
  'use gpu';
  const mainScene = getMainSceneDist(position);
  const sliderApprox = sliderApproxDist(position);
  return std.min(mainScene, sliderApprox);
};

const sdfSlot = tgpu.slot<(pos: d.v3f) => number>();

const getNormalFromSdf = tgpu.fn(
  [d.vec3f, d.f32],
  d.vec3f,
)((position, epsilon) => {
  'use gpu';
  const k = d.vec3f(1, -1, 0);

  const offset1 = k.xyy.mul(epsilon);
  const offset2 = k.yyx.mul(epsilon);
  const offset3 = k.yxy.mul(epsilon);
  const offset4 = k.xxx.mul(epsilon);

  const sample1 = offset1.mul(sdfSlot.$(position.add(offset1)));
  const sample2 = offset2.mul(sdfSlot.$(position.add(offset2)));
  const sample3 = offset3.mul(sdfSlot.$(position.add(offset3)));
  const sample4 = offset4.mul(sdfSlot.$(position.add(offset4)));

  const gradient = sample1.add(sample2).add(sample3).add(sample4);

  return std.normalize(gradient);
});

const getNormalCapSdf = getNormalFromSdf.with(sdfSlot, cap3D);
const getNormalMainSdf = getNormalFromSdf.with(sdfSlot, getMainSceneDist);

const getNormalCap = (pos: d.v3f) => {
  'use gpu';
  return getNormalCapSdf(pos, 0.01);
};

const getNormalMain = (position: d.v3f) => {
  'use gpu';
  if (std.abs(position.z) > 0.22 || std.abs(position.x) > 1.02) {
    return d.vec3f(0, 1, 0);
  }
  return getNormalMainSdf(position, 0.0001);
};

const getSliderNormal = (position: d.v3f, hitInfo: d.Infer<typeof HitInfo>) => {
  'use gpu';
  const poly2D = sdInflatedPolyline2D(position.xy);
  const gradient2D = poly2D.normal;

  const threshold = LINE_HALF_THICK * 0.85;
  const absZ = std.abs(position.z);
  const zDistance = std.max(
    0,
    ((absZ - threshold) * LINE_HALF_THICK) / (LINE_HALF_THICK - threshold),
  );
  const edgeDistance = LINE_RADIUS - poly2D.distance;

  const edgeContrib = 0.9;
  const zContrib = 1.0 - edgeContrib;

  const zDirection = std.sign(position.z);
  const zAxisVector = d.vec3f(0, 0, zDirection);

  const edgeBlendDistance = edgeContrib * LINE_RADIUS + zContrib * LINE_HALF_THICK;

  const blendFactor = std.smoothstep(
    edgeBlendDistance,
    0.0,
    zDistance * zContrib + edgeDistance * edgeContrib,
  );

  const normal2D = d.vec3f(gradient2D.xy, 0);
  const blendedNormal = std.mix(zAxisVector, normal2D, blendFactor * 0.5 + 0.5);

  let normal = std.normalize(blendedNormal);

  if (hitInfo.t > 0.94) {
    const ratio = (hitInfo.t - 0.94) / 0.02;
    const fullNormal = getNormalCap(position);
    normal = std.normalize(std.mix(normal, fullNormal, ratio));
  }

  return normal;
};

const getNormal = (position: d.v3f, hitInfo: d.Infer<typeof HitInfo>) => {
  'use gpu';
  if (hitInfo.objectType === ObjectType.SLIDER && hitInfo.t < 0.96) {
    return getSliderNormal(position, hitInfo);
  }

  return std.select(
    getNormalCap(position),
    getNormalMain(position),
    hitInfo.objectType === ObjectType.BACKGROUND,
  );
};

const sqLength = (a: d.v3f) => {
  'use gpu';
  return std.dot(a, a);
};

const getFakeShadow = (position: d.v3f, lightDir: d.v3f): d.v3f => {
  'use gpu';
  const jellyColor = jellyColorUniform.$;
  const endCapX = slider.endCapUniform.$.x;

  if (position.y < -GroundParams.groundThickness) {
    // Applying darkening under the ground (the shadow cast by the upper ground layer)
    const fadeSharpness = 30;
    const inset = 0.02;
    const cutout = rectangleCutoutDist(position.xz) + inset;
    const edgeDarkening = std.saturate(1 - cutout * fadeSharpness);

    // Applying a slight gradient based on the light direction
    const lightGradient = std.saturate(-position.z * 4 * lightDir.z + 1);

    return d
      .vec3f(1)
      .mul(edgeDarkening)
      .mul(lightGradient * 0.5);
  } else {
    const finalUV = d.vec2f(
      (position.x - position.z * lightDir.x * std.sign(lightDir.z)) * 0.5 + 0.5,
      1 - (-position.z / lightDir.z) * 0.5 - 0.2,
    );
    const data = std.textureSampleLevel(bezierTexture.$, filteringSampler.$, finalUV, 0);

    // Normally it would be just data.y, but there transition is too sudden when the jelly is bunched up.
    // To mitigate this, we transition into a position-based transition.
    const jellySaturation = std.mix(0, data.y, std.saturate(position.x * 1.5 + 1.1));
    const shadowColor = std.mix(d.vec3f(0, 0, 0), jellyColor.rgb, jellySaturation);

    const contrast = 20 * std.saturate(finalUV.y) * (0.8 + endCapX * 0.2);
    const shadowOffset = -0.3;
    const featherSharpness = 10;
    const uvEdgeFeather =
      std.saturate(finalUV.x * featherSharpness) *
      std.saturate((1 - finalUV.x) * featherSharpness) *
      std.saturate((1 - finalUV.y) * featherSharpness) *
      std.saturate(finalUV.y);
    const influence = std.saturate((1 - lightDir.y) * 2) * uvEdgeFeather;
    return std.mix(
      d.vec3f(1),
      std.mix(shadowColor, d.vec3f(1), std.saturate(data.x * contrast + shadowOffset)),
      influence,
    );
  }
};

const calculateAO = (position: d.v3f, normal: d.v3f) => {
  'use gpu';
  let totalOcclusion = d.f32(0.0);
  let sampleWeight = d.f32(1.0);
  const stepDistance = AO_RADIUS / AO_STEPS;

  for (let i = 1; i <= AO_STEPS; i++) {
    const sampleHeight = stepDistance * d.f32(i);
    const samplePosition = position.add(normal.mul(sampleHeight));
    const distanceToSurface = getSceneDistForAO(samplePosition) - AO_BIAS;
    const occlusionContribution = std.max(0.0, sampleHeight - distanceToSurface);
    totalOcclusion += occlusionContribution * sampleWeight;
    sampleWeight *= 0.5;
    if (totalOcclusion > AO_RADIUS / AO_INTENSITY) {
      break;
    }
  }

  const rawAO = 1.0 - (AO_INTENSITY * totalOcclusion) / AO_RADIUS;
  return std.saturate(rawAO);
};

const calculateLighting = (hitPosition: d.v3f, normal: d.v3f, rayOrigin: d.v3f) => {
  'use gpu';
  const lightDir = std.neg(lightUniform.$.direction);

  const fakeShadow = getFakeShadow(hitPosition, lightDir);
  const diffuse = std.max(std.dot(normal, lightDir), 0.0);

  const viewDir = std.normalize(rayOrigin.sub(hitPosition));
  const reflectDir = std.reflect(std.neg(lightDir), normal);
  const specularFactor = std.max(std.dot(viewDir, reflectDir), 0) ** SPECULAR_POWER;
  const specular = lightUniform.$.color.mul(specularFactor * SPECULAR_INTENSITY);

  const baseColor = d.vec3f(0.9);

  const directionalLight = baseColor.mul(lightUniform.$.color).mul(diffuse).mul(fakeShadow);
  const ambientLight = baseColor.mul(AMBIENT_COLOR).mul(AMBIENT_INTENSITY);

  const finalSpecular = specular.mul(fakeShadow);

  return std.saturate(directionalLight.add(ambientLight).add(finalSpecular));
};

const applyAO = (litColor: d.v3f, hitPosition: d.v3f, normal: d.v3f) => {
  'use gpu';
  const ao = calculateAO(hitPosition, normal);
  const finalColor = litColor.mul(ao);
  return d.vec4f(finalColor, 1.0);
};

const rayMarchNoJelly = (rayOrigin: d.v3f, rayDirection: d.v3f) => {
  'use gpu';
  let distanceFromOrigin = d.f32();
  let hit = d.f32();

  for (let i = 0; i < 6; i++) {
    const p = rayOrigin.add(rayDirection.mul(distanceFromOrigin));
    hit = getMainSceneDist(p);
    distanceFromOrigin += hit;
    if (distanceFromOrigin > MAX_DIST || hit < SURF_DIST * 10) {
      break;
    }
  }

  if (distanceFromOrigin < MAX_DIST) {
    return renderBackground(
      rayOrigin,
      rayDirection,
      distanceFromOrigin,
      std.select(d.f32(), 0.87, blurEnabledUniform.$ === 1),
    ).rgb;
  }
  return d.vec3f();
};

const renderPercentageOnGround = (hitPosition: d.v3f, center: d.v3f) => {
  'use gpu';

  const textWidth = 1.9;
  const textHeight = 0.33;

  if (
    std.abs(hitPosition.x - center.x) > textWidth * 0.5 ||
    std.abs(hitPosition.z - center.z) > textHeight * 0.5
  ) {
    return d.vec4f();
  }

  const localX = hitPosition.x - center.x;
  const localZ = hitPosition.z - center.z;

  const uvX = (localX + textWidth * 0.5) / textWidth;
  const uvZ = (localZ + textHeight * 0.5) / textHeight;

  if (uvX < 0.0 || uvX > 1.0 || uvZ < 0.0 || uvZ > 1.0) {
    return d.vec4f();
  }

  return std.textureSampleLevel(
    rayMarchLayout.$.valueTexture,
    filteringSampler.$,
    d.vec2f(uvX, uvZ),
    0,
  );
};

const renderBackground = (
  rayOrigin: d.v3f,
  rayDirection: d.v3f,
  backgroundHitDist: number,
  offset: number,
) => {
  'use gpu';
  const hitPosition = rayOrigin.add(rayDirection.mul(backgroundHitDist));

  const percentageSample = renderPercentageOnGround(
    hitPosition,
    d.vec3f(0, 0, 0),
  );

  let highlights = d.f32();

  const highlightWidth = d.f32(1);
  const highlightHeight = 0.2;
  let offsetX = d.f32();
  let offsetZ = d.f32(0.05);

  const lightDir = lightUniform.$.direction;
  const causticScale = 0.2;
  offsetX -= lightDir.x * causticScale;
  offsetZ += lightDir.z * causticScale;

  const endCapX = slider.endCapUniform.$.x;
  const sliderStretch = (endCapX + 1) * 0.5;

  if (
    std.abs(hitPosition.x + offsetX) < highlightWidth &&
    std.abs(hitPosition.z + offsetZ) < highlightHeight
  ) {
    const uvX_orig = ((hitPosition.x + offsetX + highlightWidth * 2) / highlightWidth) * 0.5;
    const uvZ_orig = ((hitPosition.z + offsetZ + highlightHeight * 2) / highlightHeight) * 0.5;

    const centeredUV = d.vec2f(uvX_orig - 0.5, uvZ_orig - 0.5);
    const finalUV = d.vec2f(centeredUV.x, 1 - (std.abs(centeredUV.y - 0.5) * 2) ** 2 * 0.3);

    const density = std.max(
      0,
      (std.textureSampleLevel(bezierTexture.$, filteringSampler.$, finalUV, 0).x - 0.25) * 8,
    );

    const fadeX = std.smoothstep(0, -0.2, hitPosition.x - endCapX);
    const fadeZ = 1 - (std.abs(centeredUV.y - 0.5) * 2) ** 3;
    const fadeStretch = std.saturate(1 - sliderStretch);
    const edgeFade = std.saturate(fadeX) * std.saturate(fadeZ) * fadeStretch;

    highlights = (density ** 3 * edgeFade * 3 * (1 + lightDir.z)) / 1.5;
  }

  const originYBound = std.saturate(rayOrigin.y + 0.01);
  const posOffset = hitPosition.add(
    d.vec3f(0, 1, 0).mul(offset * (originYBound / (1.0 + originYBound)) * (1 + randf.sample() / 2)),
  );
  const newNormal = getNormalMain(posOffset);

  // Calculate fake bounce lighting
  const jellyColor = jellyColorUniform.$;
  const sqDist = sqLength(hitPosition.sub(d.vec3f(endCapX, 0, 0)));
  const bounceLight = jellyColor.rgb.mul((1 / (sqDist * 15 + 1)) * 0.4);
  const sideBounceLight = jellyColor.rgb
    .mul((1 / (sqDist * 40 + 1)) * 0.3)
    .mul(std.abs(newNormal.z));

  const litColor = calculateLighting(posOffset, newNormal, rayOrigin);
  const backgroundColor = applyAO(groundColorUniform.$.mul(litColor), posOffset, newNormal)
    .add(d.vec4f(bounceLight, 0))
    .add(d.vec4f(sideBounceLight, 0));

  const textColor = groundTextColorUniform.$;

  return d.vec4f(
    std.mix(backgroundColor.rgb, textColor, percentageSample.x).mul(1.0 + highlights),
    1.0,
  );
};

const rayMarch = (rayOrigin: d.v3f, rayDirection: d.v3f, _uv: d.v2f) => {
  'use gpu';
  let totalSteps = d.u32();

  let backgroundDist = d.f32();
  for (let i = 0; i < MAX_STEPS; i++) {
    const p = rayOrigin.add(rayDirection.mul(backgroundDist));
    const hit = getMainSceneDist(p);
    backgroundDist += hit;
    if (hit < SURF_DIST) {
      break;
    }
  }
  const background = renderBackground(rayOrigin, rayDirection, backgroundDist, d.f32());

  const bbox = getSliderBbox();
  const zDepth = d.f32(0.25);

  const sliderMin = d.vec3f(bbox.left, bbox.bottom, -zDepth);
  const sliderMax = d.vec3f(bbox.right, bbox.top, zDepth);

  const intersection = intersectBox(rayOrigin, rayDirection, sliderMin, sliderMax);

  if (!intersection.hit) {
    return background;
  }

  let distanceFromOrigin = std.max(d.f32(0.0), intersection.tMin);

  for (let i = 0; i < MAX_STEPS; i++) {
    if (totalSteps >= MAX_STEPS) {
      break;
    }

    const currentPosition = rayOrigin.add(rayDirection.mul(distanceFromOrigin));

    const hitInfo = getSceneDist(currentPosition);
    distanceFromOrigin += hitInfo.distance;
    totalSteps++;

    if (hitInfo.distance < SURF_DIST) {
      const hitPosition = rayOrigin.add(rayDirection.mul(distanceFromOrigin));

      if (!(hitInfo.objectType === ObjectType.SLIDER)) {
        break;
      }

      const N = getNormal(hitPosition, hitInfo);
      const I = rayDirection;
      const cosi = std.min(1.0, std.max(0.0, std.dot(std.neg(I), N)));
      const F = fresnelSchlick(cosi, d.f32(1.0), d.f32(JELLY_IOR));

      const reflection = std.saturate(d.vec3f(hitPosition.y + 0.2));

      const eta = 1.0 / JELLY_IOR;
      const k = 1.0 - eta * eta * (1.0 - cosi * cosi);
      let refractedColor = d.vec3f();
      if (k > 0.0) {
        const refrDir = std.normalize(std.add(I.mul(eta), N.mul(eta * cosi - std.sqrt(k))));
        const p = hitPosition.add(refrDir.mul(SURF_DIST * 2.0));
        const exitPos = p.add(refrDir.mul(SURF_DIST * 2.0));

        const env = rayMarchNoJelly(exitPos, refrDir);
        const progress = hitInfo.t;
        const jellyColor = jellyColorUniform.$;

        const scatterTint = jellyColor.rgb.mul(1.5);
        const density = d.f32(20.0);
        const absorb = d.vec3f(1.0).sub(jellyColor.rgb).mul(density);

        const T = beerLambert(absorb.mul(progress ** 2), 0.08);

        const lightDir = std.neg(lightUniform.$.direction);

        const forward = std.max(0.0, std.dot(lightDir, refrDir));
        const scatter = scatterTint.mul(JELLY_SCATTER_STRENGTH * forward * progress ** 3);
        refractedColor = env.mul(T).add(scatter);
      }

      const jelly = std.add(reflection.mul(F), refractedColor.mul(1 - F));

      const finalJelly = std.mix(background.rgb, jelly, jellyColorUniform.$.w);

      return d.vec4f(finalJelly, 1.0);
    }

    if (distanceFromOrigin > backgroundDist) {
      break;
    }
  }

  return background;
};

const raymarchFn = tgpu.fragmentFn({
  in: { uv: d.vec2f },
  out: d.vec4f,
})(({ uv }) => {
  randf.seed2(randomUniform.$.mul(uv));

  const ndc = d.vec2f(uv.x * 2 - 1, -(uv.y * 2 - 1));
  const ray = getRay(ndc);

  const color = rayMarch(ray.origin, ray.direction, uv);
  return d.vec4f(std.tanh(color.rgb.mul(1.3)), 1);
});

const fragmentMain = tgpu.fragmentFn({
  in: { uv: d.vec2f },
  out: d.vec4f,
})((input) => {
  return std.textureSample(sampleLayout.$.currentTexture, filteringSampler.$, input.uv);
});

const rayMarchPipeline = root.createRenderPipeline({
  vertex: common.fullScreenTriangle,
  fragment: raymarchFn,
  targets: { format: 'rgba8unorm' },
});

const renderPipeline = root.createRenderPipeline({
  vertex: common.fullScreenTriangle,
  fragment: fragmentMain,
  targets: { format: presentationFormat },
});

let lastTimeStamp = performance.now();
let frameCount = 0;
const taaResolver = new TAAResolver(root, width, height);

function createBindGroups() {
  return {
    rayMarch: root.createBindGroup(rayMarchLayout, {
      backgroundTexture: backgroundTexture.sampled,
      valueTexture: valueTextureView,
    }),
    render: [0, 1].map((frame) =>
      root.createBindGroup(sampleLayout, {
        currentTexture: taaResolver.getResolvedTexture(frame),
      }),
    ),
  };
}

(canvas as any).onpaint = () => {
  (root.device.queue as any).copyElementImageToTexture(valueElement, width, height, { texture: valueRawTexture });

  // TODO(pdr): Calculate this correctly using `getElementTransform`. For now,
  // the transform is just hard-coded.
  //const view = camera.view;
  //const proj = camera.proj;
  //const mvp = m.mat4.mul(proj, view, d.mat4x4f());
  //const sliderWidth = sliderElement.clientWidth || (canvas.clientWidth * 0.75);
  const sliderHeight = sliderElement.clientHeight || (canvas.clientHeight * 0.125);
  let x = (canvas.width / devicePixelRatio) / 8;
  let y = (canvas.height / devicePixelRatio) / 2 - (sliderHeight / 2);
  sliderElement.style.transform = `translate(${x}px, ${y}px)`;
  valueElement.style.transform = `translate(${x}px, ${y}px)`;
};
(canvas as any).requestPaint();

let bindGroups = createBindGroups();

let animationFrameHandle: number;
function render(timestamp: number) {
  frameCount++;
  camera.jitter();
  const deltaTime = Math.min((timestamp - lastTimeStamp) * 0.001, 0.1);
  lastTimeStamp = timestamp;

  randomUniform.write(d.vec2f((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2));

  currentMouseX += (targetMouseX - currentMouseX) * 0.08;
  slider.setDragX(currentMouseX);
  slider.update(deltaTime);

  const currentFrame = frameCount % 2;

  rayMarchPipeline
    .withColorAttachment({
      view: textures[currentFrame].sampled,
      loadOp: 'clear',
      storeOp: 'store',
    })
    .with(bindGroups.rayMarch)
    .draw(3);

  taaResolver.resolve(textures[currentFrame].sampled, frameCount, currentFrame);

  renderPipeline
    .withColorAttachment({ view: context })
    .with(bindGroups.render[currentFrame])
    .draw(3);

  animationFrameHandle = requestAnimationFrame(render);
}

function handleResize() {
  [width, height] = [canvas.width * qualityScale, canvas.height * qualityScale];
  camera.updateProjection(Math.PI / 4, width, height);
  textures = createTextures(root, width, height);
  backgroundTexture = createBackgroundTexture(root, width, height);
  taaResolver.resize(width, height);
  frameCount = 0;

  bindGroups = createBindGroups();
}

const resizeObserver = new ResizeObserver(() => {
  handleResize();
});
resizeObserver.observe(canvas);

animationFrameHandle = requestAnimationFrame(render);


const hcMedia = window.matchMedia('(forced-colors: active)');
const darkMedia = window.matchMedia('(prefers-color-scheme: dark)');
const contrastMedia = window.matchMedia('(prefers-contrast: more)');

const parseColor3 = (colorStr: string): d.Infer<typeof d.vec3f> => {
  const match = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (match) {
    return d.vec3f(parseInt(match[1]) / 255, parseInt(match[2]) / 255, parseInt(match[3]) / 255);
  }
  return d.vec3f(1.0);
};

const parseColor4 = (colorStr: string): d.Infer<typeof d.vec4f> => {
  const match = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([0-9.]+))?\)/);
  if (match) {
    const a = match[4] !== undefined ? parseFloat(match[4]) : 1.0;
    return d.vec4f(parseInt(match[1]) / 255, parseInt(match[2]) / 255, parseInt(match[3]) / 255, a);
  }
  return d.vec4f(1.0, 1.0, 1.0, 1.0);
};

const updateColors = () => {
  const style = getComputedStyle(sliderElement);

  jellyColorUniform.write(parseColor4(style.color));
  groundColorUniform.write(parseColor3(style.backgroundColor));
  groundTextColorUniform.write(parseColor3(style.caretColor));
  (canvas as any).requestPaint?.();
};

sliderElement.addEventListener('focus', updateColors);
sliderElement.addEventListener('blur', updateColors);
hcMedia.addEventListener('change', updateColors);
darkMedia.addEventListener('change', updateColors);
contrastMedia.addEventListener('change', updateColors);
updateColors();


export function onCleanup() {
  sliderElement.removeEventListener('focus', updateColors);
  sliderElement.removeEventListener('blur', updateColors);
  hcMedia.removeEventListener('change', updateColors);
  darkMedia.removeEventListener('change', updateColors);
  contrastMedia.removeEventListener('change', updateColors);
  cancelAnimationFrame(animationFrameHandle);
  resizeObserver.disconnect();
  root.destroy();
}
