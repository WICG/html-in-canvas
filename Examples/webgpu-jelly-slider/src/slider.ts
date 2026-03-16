import { sdBezier } from '@typegpu/sdf';
import type {
  SampledFlag,
  StorageFlag,
  TgpuBuffer,
  TgpuGuardedComputePipeline,
  TgpuRoot,
  TgpuTexture,
  TgpuUniform,
} from 'typegpu';
import { d, std } from 'typegpu';

const BEZIER_TEXTURE_SIZE = [256, 128] as const;

export class Slider {
  #root: TgpuRoot;
  #pos: d.v2f[];
  #normals: d.v2f[];
  #prev: d.v2f[];
  #invMass: Float32Array;
  #targetX: number;
  #controlPoints: d.v2f[];
  #yOffset: number;
  #computeBezierPipeline: TgpuGuardedComputePipeline;

  pointsBuffer: TgpuBuffer<d.WgslArray<d.Vec2f>> & StorageFlag;
  controlPointsBuffer: TgpuBuffer<d.WgslArray<d.Vec2f>> & StorageFlag;
  normalsBuffer: TgpuBuffer<d.WgslArray<d.Vec2f>> & StorageFlag;
  bezierTexture: TgpuTexture<{
    size: typeof BEZIER_TEXTURE_SIZE;
    format: 'rgba16float';
  }> &
    SampledFlag &
    StorageFlag;
  endCapUniform: TgpuUniform<d.Vec4f>;

  readonly n: number;
  readonly totalLength: number;
  readonly restLen: number;
  readonly baseY: number;
  readonly anchor: d.v2f;
  readonly bbox: [top: number, right: number, bottom: number, left: number];

  // Physics parameters
  iterations = 16;
  substeps = 6;
  damping = 0.01;
  bendingStrength = 0.1;
  archStrength = 2;
  endFlatCount = 1;
  endFlatStiffness = 0.05;
  bendingExponent = 1.2;
  archEdgeDeadzone = 0.01;

  constructor(root: TgpuRoot, start: d.v2f, end: d.v2f, numPoints: number, yOffset = 0) {
    this.#root = root;
    this.n = Math.max(2, numPoints | 0);
    this.anchor = start;
    this.baseY = start.y;
    this.#targetX = end.x;
    this.#yOffset = yOffset;

    const dx = end.x - start.x;
    const dy = end.y - start.y;
    this.totalLength = Math.hypot(dx, dy);
    this.restLen = this.totalLength / (this.n - 1);

    this.#pos = Array.from({ length: this.n });
    this.#controlPoints = Array.from({ length: this.n - 1 });
    this.#normals = Array.from({ length: this.n });
    this.#prev = Array.from({ length: this.n });
    this.#invMass = new Float32Array(this.n);

    for (let i = 0; i < this.n; i++) {
      const t = i / (this.n - 1);
      const x = start[0] * (1 - t) + end[0] * t;
      const y = start[1] * (1 - t) + end[1] * t + this.#yOffset;
      this.#pos[i] = d.vec2f(x, y);
      this.#prev[i] = d.vec2f(x, y);
      this.#normals[i] = d.vec2f(0, 1);
      this.#invMass[i] = i === 0 || i === this.n - 1 ? 0 : 1;
      if (i < this.n - 1) {
        const t2 = (i + 0.5) / (this.n - 1);
        const cx = start[0] * (1 - t2) + end[0] * t2;
        const cy = start[1] * (1 - t2) + end[1] * t2 + this.#yOffset;
        this.#controlPoints[i] = d.vec2f(cx, cy);
      }
    }

    this.pointsBuffer = this.#root
      .createBuffer(d.arrayOf(d.vec2f, this.n), this.#pos)
      .$usage('storage');

    this.controlPointsBuffer = this.#root
      .createBuffer(d.arrayOf(d.vec2f, this.n - 1), this.#controlPoints)
      .$usage('storage');

    this.normalsBuffer = this.#root
      .createBuffer(d.arrayOf(d.vec2f, this.n), this.#normals)
      .$usage('storage');

    this.bezierTexture = this.#root['~unstable']
      .createTexture({
        size: BEZIER_TEXTURE_SIZE,
        format: 'rgba16float',
      })
      .$usage('sampled', 'storage', 'render');

    this.endCapUniform = this.#root.createUniform(d.vec4f, d.vec4f(0, 0, 0, 0));

    const bezierWriteView = this.bezierTexture.createView(
      d.textureStorage2d('rgba16float', 'write-only'),
    );
    const pointsView = this.pointsBuffer.as('readonly');
    const controlPointsView = this.controlPointsBuffer.as('readonly');

    const padding = 0.01;
    const left = start.x - this.totalLength * padding;
    const right = end.x + this.totalLength * padding * 10;
    const bottom = -0.3;
    const top = 0.65;

    this.bbox = [top, right, bottom, left];

    this.#computeBezierPipeline = this.#root.createGuardedComputePipeline((x, y) => {
      'use gpu';
      const size = std.textureDimensions(bezierWriteView.$);
      const pixelUV = d.vec2f(x, y).add(0.5).div(d.vec2f(size));

      const sliderPos = d.vec2f(
        left + pixelUV.x * (right - left),
        top - pixelUV.y * (top - bottom),
      );

      let minDist = d.f32(1e10);
      let closestSegment = d.i32(0);
      let closestT = d.f32(0);

      const epsilon = d.f32(0.03);
      const xOffset = d.vec2f(epsilon, 0.0);
      const yOffset = d.vec2f(0.0, epsilon);

      let xPlusDist = d.f32(1e10);
      let xMinusDist = d.f32(1e10);
      let yPlusDist = d.f32(1e10);
      let yMinusDist = d.f32(1e10);

      for (let i = 0; i < pointsView.$.length - 1; i++) {
        const A = pointsView.$[i];
        const B = pointsView.$[i + 1];
        const C = controlPointsView.$[i];

        const dist = sdBezier(sliderPos, A, C, B);
        if (dist < minDist) {
          minDist = dist;
          closestSegment = i;

          const AB = B.sub(A);
          const AP = sliderPos.sub(A);
          const ABLength = std.length(AB);

          if (ABLength > 0.0) {
            closestT = std.clamp(std.dot(AP, AB) / (ABLength * ABLength), 0.0, 1.0);
          } else {
            closestT = 0.0;
          }
        }

        xPlusDist = std.min(xPlusDist, sdBezier(sliderPos.add(xOffset), A, C, B));
        xMinusDist = std.min(xMinusDist, sdBezier(sliderPos.sub(xOffset), A, C, B));
        yPlusDist = std.min(yPlusDist, sdBezier(sliderPos.add(yOffset), A, C, B));
        yMinusDist = std.min(yMinusDist, sdBezier(sliderPos.sub(yOffset), A, C, B));
      }

      const overallProgress = (d.f32(closestSegment) + closestT) / d.f32(pointsView.$.length - 1);

      const normalX = (xPlusDist - xMinusDist) / (2.0 * epsilon);
      const normalY = (yPlusDist - yMinusDist) / (2.0 * epsilon);

      std.textureStore(
        bezierWriteView.$,
        d.vec2u(x, y),
        d.vec4f(minDist, overallProgress, normalX, normalY),
      );
    });
  }

  setDragX(x: number) {
    const minX = this.anchor[0] - this.totalLength;
    const maxX = this.anchor[0] + this.totalLength;
    this.#targetX = std.clamp(x, minX, maxX);
  }

  update(dt: number) {
    if (dt <= 0) return;

    const h = dt / this.substeps;
    const damp = std.clamp(this.damping, 0, 0.999);
    const compression = Math.max(
      0,
      1 - Math.abs(this.#targetX - this.anchor[0]) / this.totalLength,
    );

    for (let s = 0; s < this.substeps; s++) {
      this.#integrate(h, damp, compression);
      this.#projectConstraints();
    }

    this.#computeNormals();
    this.#computeControlPoints();
    this.#updateGPUBuffer();
    this.#computeBezierPipeline.dispatchThreads(...BEZIER_TEXTURE_SIZE);
  }

  #integrate(h: number, damp: number, compression: number) {
    for (let i = 0; i < this.n; i++) {
      const px = this.#pos[i].x;
      const py = this.#pos[i].y;

      // Pin endpoints
      if (i === 0) {
        this.#pos[i] = d.vec2f(this.anchor[0], this.anchor[1] + this.#yOffset);
        this.#prev[i] = d.vec2f(this.anchor[0], this.anchor[1] + this.#yOffset);
        continue;
      }
      if (i === this.n - 1) {
        this.#pos[i] = d.vec2f(this.#targetX, 0.08 + this.#yOffset);
        this.#prev[i] = d.vec2f(this.#targetX, 0.08 + this.#yOffset);
        continue;
      }

      // Verlet integration with damping
      const vx = (px - this.#prev[i].x) * (1 - damp);
      const vy = (py - this.#prev[i].y) * (1 - damp);

      // Arch bias in middle section only
      let ay = 0;
      if (compression > 0) {
        const t = i / (this.n - 1);
        const edge = this.archEdgeDeadzone;
        const window = std.smoothstep(edge, 1 - edge, t) * std.smoothstep(edge, 1 - edge, 1 - t);
        const profile = Math.sin(Math.PI * t) * window;
        ay = this.archStrength * profile * compression;
      }

      this.#prev[i] = d.vec2f(px, py);
      this.#pos[i] = d.vec2f(px + vx, py + vy + ay * h * h);

      // Keep above baseline
      if (this.#pos[i].y < this.baseY + this.#yOffset) {
        this.#pos[i] = d.vec2f(this.#pos[i].x, this.baseY + this.#yOffset);
      }
    }
  }

  #projectConstraints() {
    for (let it = 0; it < this.iterations; it++) {
      // Segment length constraints
      for (let i = 0; i < this.n - 1; i++) {
        this.#projectDistance(i, i + 1, this.restLen, 0.1);
      }

      // Bending resistance (stronger at ends)
      for (let i = 1; i < this.n - 1; i++) {
        const t = i / (this.n - 1);
        const distFromCenter = Math.abs(t - 0.5) * 2;
        const strength = distFromCenter ** this.bendingExponent;
        const k = this.bendingStrength * (0.05 + 0.95 * strength);
        this.#projectDistance(i - 1, i + 1, 2 * this.restLen, k);
      }

      // Flatten ends
      if (this.endFlatCount > 0) {
        const count = Math.min(this.endFlatCount, this.n - 2);
        for (let i = 1; i <= count; i++) {
          this.#projectLineY(i, this.baseY + this.#yOffset, this.endFlatStiffness);
        }
        for (let i = this.n - 1 - count; i < this.n - 1; i++) {
          this.#projectLineY(i, this.baseY + this.#yOffset, this.endFlatStiffness);
        }
      }

      // Re-pin endpoints
      this.#pos[0] = d.vec2f(this.anchor[0], this.anchor[1] + this.#yOffset);
      this.#pos[this.n - 1] = d.vec2f(this.#targetX, 0.08 + this.#yOffset);
    }
  }

  #projectDistance(i: number, j: number, rest: number, k: number) {
    const dx = this.#pos[j].x - this.#pos[i].x;
    const dy = this.#pos[j].y - this.#pos[i].y;
    const len = Math.hypot(dx, dy);

    if (len < 1e-8) return;

    const w1 = this.#invMass[i];
    const w2 = this.#invMass[j];
    const wsum = w1 + w2;
    if (wsum <= 0) return;

    const diff = (len - rest) / len;
    const c1 = (w1 / wsum) * k;
    const c2 = (w2 / wsum) * k;

    this.#pos[i] = d.vec2f(this.#pos[i].x + dx * diff * c1, this.#pos[i].y + dy * diff * c1);
    this.#pos[j] = d.vec2f(this.#pos[j].x - dx * diff * c2, this.#pos[j].y - dy * diff * c2);
  }

  #projectLineY(i: number, yTarget: number, k: number) {
    if (i <= 0 || i >= this.n - 1 || this.#invMass[i] <= 0) return;
    this.#pos[i] = d.vec2f(
      this.#pos[i].x,
      this.#pos[i].y + (yTarget - this.#pos[i].y) * std.saturate(k),
    );
  }

  #computeNormals() {
    const n = this.n;
    const eps = 1e-6;
    for (let i = 0; i < n; i++) {
      let dx: number;
      let dy: number;

      if (i === 0 && n > 1) {
        dx = this.#pos[1].x - this.#pos[0].x;
        dy = this.#pos[1].y - this.#pos[0].y;
      } else if (i === n - 1 && n > 1) {
        dx = this.#pos[n - 1].x - this.#pos[n - 2].x;
        dy = this.#pos[n - 1].y - this.#pos[n - 2].y;
      } else {
        dx = this.#pos[i + 1].x - this.#pos[i - 1].x;
        dy = this.#pos[i + 1].y - this.#pos[i - 1].y;
      }

      let len = Math.hypot(dx, dy);
      if (len < eps) {
        if (i > 0) {
          dx = this.#pos[i].x - this.#pos[i - 1].x;
          dy = this.#pos[i].y - this.#pos[i - 1].y;
          len = Math.hypot(dx, dy);
        }
        if (len < eps && i < n - 1) {
          dx = this.#pos[i + 1].x - this.#pos[i].x;
          dy = this.#pos[i + 1].y - this.#pos[i].y;
          len = Math.hypot(dx, dy);
        }
        if (len < eps) {
          this.#normals[i] = i > 0 ? this.#normals[i - 1] : d.vec2f(0, 1);
          continue;
        }
      }

      dx /= len;
      dy /= len;
      this.#normals[i] = d.vec2f(-dy, dx);
    }
  }

  #computeControlPoints() {
    for (let i = 0; i < this.n - 1; i++) {
      const A = this.#pos[i];
      const B = this.#pos[i + 1];

      const nA = this.#normals[i];
      const nB = this.#normals[i + 1];

      if (i === 0 || i === this.n - 2) {
        this.#controlPoints[i] = d.vec2f((A.x + B.x) * 0.5, (A.y + B.y) * 0.5);
        continue;
      }

      if (std.dot(nA, nB) > 0.99) {
        // Nearly parallel normals; midpoint fallback prevents explosions.
        // tiny offset opposite to the normal (any of them)
        this.#controlPoints[i] = d.vec2f((A.x + B.x) * 0.5, (A.y + B.y) * 0.5);
        continue;
      }

      const tA = d.vec2f(nA.y, -nA.x);
      const tB = d.vec2f(nB.y, -nB.x);

      // Solve A + t*tA = B - s*tB  ->  t*tA + s*tB = (B - A)
      const dx = B.x - A.x;
      const dy = B.y - A.y;
      const denom = tA.x * tB.y - tA.y * tB.x; // cross(tA, tB)

      if (Math.abs(denom) <= 1e-6) {
        // Nearly parallel tangents; midpoint fallback prevents explosions.
        this.#controlPoints[i] = d.vec2f((A.x + B.x) * 0.5, (A.y + B.y) * 0.5);
        continue;
      }

      // t = cross(B - A, tB) / cross(tA, tB)
      const t = (dx * tB.y - dy * tB.x) / denom;
      const cx = A.x + t * tA.x;
      const cy = A.y + t * tA.y;
      this.#controlPoints[i] = d.vec2f(cx, cy);
    }
  }

  #updateGPUBuffer() {
    this.pointsBuffer.write(this.#pos);
    this.controlPointsBuffer.write(this.#controlPoints);
    this.normalsBuffer.write(this.#normals);

    const len = this.#pos.length;
    const secondLast = this.#pos[len - 2];
    const last = this.#pos[len - 1];
    this.endCapUniform.write(d.vec4f(secondLast.x, secondLast.y, last.x, last.y));
  }
}
