export interface ViewRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Kamera 2D: (x, y) = titik dunia di tengah layar, zoom = px layar per px dunia. */
export class Camera {
  x = 0;
  y = 0;
  zoom = 1;
  minZoom = 0.15;
  maxZoom = 2.6;
  extent = 800;
  width = 1;
  height = 1;
  vx = 0;
  vy = 0;
  private fly: { fx: number; fy: number; fz: number; tx: number; ty: number; tz: number; t0: number; dur: number } | null = null;

  resize(w: number, h: number): void {
    this.width = Math.max(1, w);
    this.height = Math.max(1, h);
    this.updateLimits();
  }

  setExtent(extent: number): void {
    this.extent = extent;
    this.updateLimits();
  }

  private updateLimits(): void {
    this.minZoom = Math.max(0.08, Math.min(0.6, Math.min(this.width, this.height) / (this.extent * 2.1)));
    this.clamp();
  }

  clamp(): void {
    this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, this.zoom));
    const lim = this.extent;
    this.x = Math.min(lim, Math.max(-lim, this.x));
    this.y = Math.min(lim, Math.max(-lim, this.y));
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return { x: (sx - this.width / 2) / this.zoom + this.x, y: (sy - this.height / 2) / this.zoom + this.y };
  }

  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    return { x: (wx - this.x) * this.zoom + this.width / 2, y: (wy - this.y) * this.zoom + this.height / 2 };
  }

  view(margin = 0): ViewRect {
    const hw = this.width / 2 / this.zoom + margin;
    const hh = this.height / 2 / this.zoom + margin;
    return { x0: this.x - hw, y0: this.y - hh, x1: this.x + hw, y1: this.y + hh };
  }

  panBy(dxScreen: number, dyScreen: number): void {
    this.cancelFly();
    this.x -= dxScreen / this.zoom;
    this.y -= dyScreen / this.zoom;
    this.clamp();
  }

  /** Zoom dengan menjaga titik layar (sx, sy) tetap di bawah jari / kursor. */
  zoomAt(sx: number, sy: number, newZoom: number): void {
    this.cancelFly();
    const before = this.screenToWorld(sx, sy);
    this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, newZoom));
    const after = this.screenToWorld(sx, sy);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
    this.clamp();
  }

  flyTo(x: number, y: number, zoom: number, durationMs = 900): void {
    this.vx = this.vy = 0;
    this.fly = { fx: this.x, fy: this.y, fz: this.zoom, tx: x, ty: y, tz: Math.min(this.maxZoom, Math.max(this.minZoom, zoom)), t0: performance.now(), dur: durationMs };
  }

  get flying(): boolean {
    return this.fly !== null;
  }

  cancelFly(): void {
    this.fly = null;
  }

  /** Update per frame: animasi terbang + inersia geser. */
  update(dt: number, now: number): void {
    if (this.fly) {
      const f = this.fly;
      const p = Math.min(1, (now - f.t0) / f.dur);
      const e = easeInOutCubic(p);
      this.x = f.fx + (f.tx - f.fx) * e;
      this.y = f.fy + (f.ty - f.fy) * e;
      this.zoom = Math.exp(Math.log(f.fz) + (Math.log(f.tz) - Math.log(f.fz)) * e);
      if (p >= 1) this.fly = null;
      this.clamp();
      return;
    }
    if (Math.abs(this.vx) > 1 || Math.abs(this.vy) > 1) {
      this.x -= (this.vx * dt) / this.zoom;
      this.y -= (this.vy * dt) / this.zoom;
      const decay = Math.pow(0.04, dt);
      this.vx *= decay;
      this.vy *= decay;
      this.clamp();
    } else {
      this.vx = this.vy = 0;
    }
  }
}
