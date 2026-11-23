import type { Camera } from './camera';

const TAP_MOVE_PX = 10;
const TAP_MS = 400;

/**
 * Gestur sentuh & mouse: geser 1 jari (dengan inersia), cubit 2 jari, scroll-wheel zoom, tap.
 * Mengembalikan fungsi untuk melepas listener.
 */
export function attachInput(canvas: HTMLCanvasElement, cam: Camera, onTap: (sx: number, sy: number) => void, onInteract: () => void): () => void {
  const pointers = new Map<number, { x: number; y: number }>();
  let tapStart: { x: number; y: number; t: number } | null = null;
  let moved = false;
  let pinch: { dist: number; zoom: number } | null = null;
  let lastMove: { x: number; y: number; t: number } | null = null;

  const local = (e: PointerEvent | WheelEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const pinchInfo = () => {
    const [a, b] = [...pointers.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  };

  const down = (e: PointerEvent) => {
    canvas.setPointerCapture?.(e.pointerId);
    const p = local(e);
    pointers.set(e.pointerId, p);
    cam.vx = cam.vy = 0;
    cam.cancelFly();
    onInteract();
    if (pointers.size === 1) {
      tapStart = { ...p, t: performance.now() };
      moved = false;
      lastMove = { ...p, t: performance.now() };
    } else if (pointers.size === 2) {
      const info = pinchInfo();
      pinch = { dist: Math.max(10, info.dist), zoom: cam.zoom };
      tapStart = null;
    }
  };

  const move = (e: PointerEvent) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const p = local(e);
    if (pointers.size === 2 && pinch) {
      const before = pinchInfo();
      pointers.set(e.pointerId, p);
      const after = pinchInfo();
      cam.panBy(after.mx - before.mx, after.my - before.my);
      cam.zoomAt(after.mx, after.my, pinch.zoom * (after.dist / pinch.dist));
      return;
    }
    pointers.set(e.pointerId, p);
    const dx = p.x - prev.x;
    const dy = p.y - prev.y;
    if (tapStart && Math.hypot(p.x - tapStart.x, p.y - tapStart.y) > TAP_MOVE_PX) moved = true;
    if (moved) {
      cam.panBy(dx, dy);
      const now = performance.now();
      if (lastMove) {
        const dt = Math.max(1, now - lastMove.t) / 1000;
        cam.vx = cam.vx * 0.3 + ((p.x - lastMove.x) / dt) * 0.7;
        cam.vy = cam.vy * 0.3 + ((p.y - lastMove.y) / dt) * 0.7;
      }
      lastMove = { ...p, t: now };
    }
  };

  const up = (e: PointerEvent) => {
    const p = pointers.get(e.pointerId);
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 1) {
      // sisa satu jari setelah cubit: lanjut geser tanpa memicu tap
      const [rest] = [...pointers.values()];
      lastMove = { ...rest, t: performance.now() };
      tapStart = null;
      moved = true;
      cam.vx = cam.vy = 0;
      return;
    }
    if (p && tapStart && !moved && performance.now() - tapStart.t < TAP_MS) {
      cam.vx = cam.vy = 0;
      onTap(p.x, p.y);
    } else if (lastMove && performance.now() - lastMove.t > 80) {
      cam.vx = cam.vy = 0; // jari berhenti sebelum diangkat → tanpa inersia
    }
    tapStart = null;
  };

  const wheel = (e: WheelEvent) => {
    e.preventDefault();
    onInteract();
    const p = local(e);
    const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
    cam.zoomAt(p.x, p.y, cam.zoom * factor);
  };

  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', wheel, { passive: false });
  return () => {
    canvas.removeEventListener('pointerdown', down);
    canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('pointerup', up);
    canvas.removeEventListener('pointercancel', up);
    canvas.removeEventListener('wheel', wheel);
  };
}
