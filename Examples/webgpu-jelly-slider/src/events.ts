import {
  MOUSE_MAX_X,
  MOUSE_MIN_X,
  MOUSE_RANGE_MAX,
  MOUSE_RANGE_MIN,
  MOUSE_SMOOTHING,
  TARGET_MAX,
  TARGET_MIN,
  TARGET_OFFSET,
} from './constants.ts';

export class EventHandler {
  private canvas: HTMLCanvasElement;
  private mouseX = 1.0;
  private targetMouseX = 1.0;
  private isMouseDown = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.setupEventListeners();
  }

  private setupEventListeners() {
    // Mouse events
    this.canvas.addEventListener('mouseup', () => {
      this.isMouseDown = false;
    });

    this.canvas.addEventListener('mouseleave', () => {
      this.isMouseDown = false;
    });

    this.canvas.addEventListener('mousedown', (e) => {
      this.handlePointerDown(e.clientX);
    });

    this.canvas.addEventListener('mousemove', (e) => {
      if (!this.isMouseDown) return;
      this.handlePointerMove(e.clientX);
    });

    // Touch events
    this.canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const touch = e.touches[0];
      this.handlePointerDown(touch.clientX);
    });

    this.canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      if (!this.isMouseDown) return;
      const touch = e.touches[0];
      this.handlePointerMove(touch.clientX);
    });

    this.canvas.addEventListener('touchend', (e) => {
      e.preventDefault();
      this.isMouseDown = false;
    });
  }

  private handlePointerDown(clientX: number) {
    this.isMouseDown = true;
    this.updateTargetMouseX(clientX);
  }

  private handlePointerMove(clientX: number) {
    this.updateTargetMouseX(clientX);
  }

  private updateTargetMouseX(clientX: number) {
    const rect = this.canvas.getBoundingClientRect();
    const normalizedX = (clientX - rect.left) / rect.width;
    const clampedX = Math.max(MOUSE_MIN_X, Math.min(MOUSE_MAX_X, normalizedX));
    this.targetMouseX =
      ((clampedX - MOUSE_RANGE_MIN) / (MOUSE_RANGE_MAX - MOUSE_RANGE_MIN)) *
        (TARGET_MAX - TARGET_MIN) +
      TARGET_OFFSET;
  }

  update() {
    if (this.isMouseDown) {
      this.mouseX += (this.targetMouseX - this.mouseX) * MOUSE_SMOOTHING;
    }
  }

  get currentMouseX() {
    return this.mouseX;
  }

  get isPointerDown() {
    return this.isMouseDown;
  }
}
