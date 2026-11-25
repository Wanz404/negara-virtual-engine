import type { WorldTheme } from '../../configs/types';
import type { Rect } from '../geometry';
import { drawEmoji, shade } from '../sprites';

type Ctx = CanvasRenderingContext2D;

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function tree(ctx: Ctx, x: number, y: number, s = 1): void {
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.beginPath();
  ctx.ellipse(x + 2, y + 9 * s, 8 * s, 3 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#92400e';
  ctx.fillRect(x - 1.5 * s, y, 3 * s, 9 * s);
  ctx.fillStyle = '#16a34a';
  ctx.beginPath();
  ctx.arc(x, y - 3 * s, 8 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#22c55e';
  ctx.beginPath();
  ctx.arc(x - 2 * s, y - 5 * s, 4 * s, 0, Math.PI * 2);
  ctx.fill();
}

function flag(ctx: Ctx, x: number, y: number, t: number, h = 34): void {
  ctx.fillStyle = '#9ca3af';
  ctx.fillRect(x - 1, y - h, 2, h);
  ctx.beginPath();
  const fw = 18;
  const top = y - h;
  for (let i = 0; i <= fw; i += 2) {
    const wy = Math.sin(t * 5 + i * 0.35) * 2;
    if (i === 0) ctx.moveTo(x + 1 + i, top + wy);
    else ctx.lineTo(x + 1 + i, top + wy);
  }
  for (let i = fw; i >= 0; i -= 2) ctx.lineTo(x + 1 + i, top + 6 + Math.sin(t * 5 + i * 0.35) * 2);
  ctx.closePath();
  ctx.fillStyle = '#dc2626';
  ctx.fill();
  ctx.beginPath();
  for (let i = 0; i <= fw; i += 2) {
    const wy = Math.sin(t * 5 + i * 0.35) * 2;
    if (i === 0) ctx.moveTo(x + 1 + i, top + 6 + wy);
    else ctx.lineTo(x + 1 + i, top + 6 + wy);
  }
  for (let i = fw; i >= 0; i -= 2) ctx.lineTo(x + 1 + i, top + 12 + Math.sin(t * 5 + i * 0.35) * 2);
  ctx.closePath();
  ctx.fillStyle = '#fff';
  ctx.fill();
}

/** Istana Negara: bangunan putih berpilar, atap merah, bendera Merah-Putih berkibar, plakat nama Presiden. */
export function drawPalace(ctx: Ctx, r: Rect, t: number, theme: WorldTheme): void {
  ctx.fillStyle = '#86efac';
  roundRect(ctx, r.x, r.y, r.w, r.h, 10);
  ctx.fill();
  const bx = r.x + r.w * 0.14;
  const bw = r.w * 0.72;
  const by = r.y + r.h * 0.32;
  const bh = r.h * 0.5;
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  ctx.fillRect(bx + 6, by + bh - 2, bw, 8);
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(bx, by, bw, bh);
  ctx.fillStyle = '#e2e8f0';
  ctx.fillRect(bx, by + bh - 6, bw, 6);
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(bx + 8 + (i * (bw - 16)) / 7 - 3, by + 8, 6, bh - 14);
    ctx.fillStyle = '#cbd5e1';
    ctx.fillRect(bx + 8 + (i * (bw - 16)) / 7 + 2, by + 8, 1.5, bh - 14);
  }
  ctx.fillStyle = theme.primary;
  ctx.beginPath();
  ctx.moveTo(bx - 8, by + 2);
  ctx.lineTo(bx + bw / 2, by - r.h * 0.2);
  ctx.lineTo(bx + bw + 8, by + 2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#facc15';
  ctx.beginPath();
  ctx.arc(bx + bw / 2, by - r.h * 0.07, 5, 0, Math.PI * 2);
  ctx.fill();
  // tangga & karpet merah
  ctx.fillStyle = '#b91c1c';
  ctx.fillRect(bx + bw / 2 - 7, by + bh, 14, r.y + r.h - (by + bh) - 2);
  flag(ctx, bx + bw / 2, by - r.h * 0.2 - 2, t, 22);
  tree(ctx, r.x + 14, r.y + r.h - 16);
  tree(ctx, r.x + r.w - 14, r.y + r.h - 16);
}

/** Gedung DPR: kubah kura-kura hijau + animasi "Zzz". */
export function drawParliament(ctx: Ctx, r: Rect, t: number): void {
  ctx.fillStyle = '#bbf7d0';
  roundRect(ctx, r.x, r.y, r.w, r.h, 10);
  ctx.fill();
  const cx = r.x + r.w / 2;
  const base = r.y + r.h * 0.78;
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  ctx.fillRect(r.x + 14, base - 2, r.w - 22, 7);
  ctx.fillStyle = '#f1f5f9';
  ctx.fillRect(r.x + 10, base - r.h * 0.26, r.w - 20, r.h * 0.26);
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(r.x + 16 + (i * (r.w - 36)) / 4, base - r.h * 0.24, 4, r.h * 0.22);
  }
  // kubah kura-kura
  const dy = base - r.h * 0.26;
  ctx.fillStyle = '#15803d';
  ctx.beginPath();
  ctx.ellipse(cx, dy, r.w * 0.36, r.h * 0.3, 0, Math.PI, 0);
  ctx.fill();
  ctx.strokeStyle = '#166534';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - r.w * 0.2, dy);
  ctx.quadraticCurveTo(cx, dy - r.h * 0.42, cx + r.w * 0.2, dy);
  ctx.moveTo(cx, dy);
  ctx.lineTo(cx, dy - r.h * 0.3);
  ctx.stroke();
  // Zzz melayang
  ctx.fillStyle = '#334155';
  for (let i = 0; i < 3; i++) {
    const p = (t * 0.45 + i / 3) % 1;
    ctx.globalAlpha = 1 - p;
    ctx.font = `bold ${9 + i * 3}px sans-serif`;
    ctx.fillText('Z', cx + 12 + p * 18 + i * 3, dy - r.h * 0.3 - p * 26);
  }
  ctx.globalAlpha = 1;
}

/** Kompleks Konglomerat: villa, kolam renang, helipad dengan rotor berputar. */
export function drawElite(ctx: Ctx, r: Rect, t: number): void {
  ctx.fillStyle = '#d9f99d';
  roundRect(ctx, r.x, r.y, r.w, r.h, 10);
  ctx.fill();
  // kolam
  ctx.fillStyle = '#38bdf8';
  roundRect(ctx, r.x + 10, r.y + r.h * 0.58, r.w * 0.42, r.h * 0.28, 6);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(r.x + 16, r.y + r.h * 0.68 + Math.sin(t * 2) * 2);
  ctx.lineTo(r.x + r.w * 0.42, r.y + r.h * 0.68 - Math.sin(t * 2) * 2);
  ctx.stroke();
  // villa
  ctx.fillStyle = '#fafaf9';
  ctx.fillRect(r.x + 10, r.y + 14, r.w * 0.5, r.h * 0.38);
  ctx.fillStyle = '#7c3aed';
  ctx.fillRect(r.x + 6, r.y + 10, r.w * 0.5 + 8, 6);
  ctx.fillStyle = '#bae6fd';
  for (let i = 0; i < 3; i++) ctx.fillRect(r.x + 16 + i * 14, r.y + 24, 9, 12);
  // helipad
  const hx = r.x + r.w * 0.76;
  const hy = r.y + r.h * 0.34;
  const hr = Math.min(r.w, r.h) * 0.2;
  ctx.fillStyle = '#374151';
  ctx.beginPath();
  ctx.arc(hx, hy, hr, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#facc15';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${hr}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('H', hx, hy + 1);
  // helikopter + rotor
  ctx.fillStyle = '#ef4444';
  roundRect(ctx, hx - 9, hy - 6, 18, 11, 5);
  ctx.fill();
  ctx.fillRect(hx + 8, hy - 2, 10, 2.5);
  ctx.save();
  ctx.translate(hx, hy - 7);
  ctx.rotate(t * 14);
  ctx.fillStyle = 'rgba(31,41,55,0.75)';
  ctx.fillRect(-hr - 4, -1, hr * 2 + 8, 2);
  ctx.fillRect(-1, -hr - 4, 2, hr * 2 + 8);
  ctx.restore();
  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';
}

/** Warung Madura 24 Jam: atap bergaris merah-kuning + papan "24 JAM" berkedip. */
export function drawShop(ctx: Ctx, r: Rect, t: number): void {
  ctx.fillStyle = '#fde68a';
  roundRect(ctx, r.x, r.y, r.w, r.h, 10);
  ctx.fill();
  const sx = r.x + 10;
  const sw = r.w - 20;
  const sy = r.y + r.h * 0.3;
  const sh = r.h * 0.38;
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  ctx.fillRect(sx + 5, sy + sh - 2, sw, 7);
  ctx.fillStyle = '#f5f5f4';
  ctx.fillRect(sx, sy, sw, sh);
  ctx.fillStyle = '#fef9c3';
  ctx.fillRect(sx + 6, sy + 14, sw - 12, sh - 20);
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b'][i];
    ctx.fillRect(sx + 10 + i * ((sw - 24) / 4), sy + sh - 18, (sw - 30) / 4, 10);
  }
  const stripes = 8;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 ? '#facc15' : '#dc2626';
    ctx.beginPath();
    const x0 = sx - 4 + (i * (sw + 8)) / stripes;
    const x1 = sx - 4 + ((i + 1) * (sw + 8)) / stripes;
    ctx.moveTo(x0, sy - 8);
    ctx.lineTo(x1, sy - 8);
    ctx.lineTo(x1, sy + 8);
    ctx.quadraticCurveTo((x0 + x1) / 2, sy + 13, x0, sy + 8);
    ctx.fill();
  }
  ctx.fillStyle = Math.sin(t * 3) > -0.6 ? '#16a34a' : '#14532d';
  roundRect(ctx, sx + sw / 2 - 18, sy - 26, 36, 14, 4);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 9px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('24 JAM', sx + sw / 2, sy - 16);
  ctx.textAlign = 'start';
  tree(ctx, r.x + 14, r.y + r.h - 14, 0.8);
}

/** Gerbang kota + pangkalan ojol berjaket hijau. */
export function drawGate(ctx: Ctx, r: Rect, t: number, theme: WorldTheme): void {
  const cx = r.x + r.w / 2;
  ctx.fillStyle = shade(theme.road, 0.25);
  ctx.fillRect(r.x, r.y, r.w, r.h);
  const ph = r.h * 0.62;
  const py = r.y + r.h * 0.2;
  ctx.fillStyle = '#a16207';
  ctx.fillRect(cx - 52, py, 14, ph);
  ctx.fillRect(cx + 38, py, 14, ph);
  ctx.fillStyle = theme.primary;
  ctx.fillRect(cx - 60, py - 14, 120, 16);
  ctx.fillStyle = theme.accent;
  ctx.fillRect(cx - 60, py - 18, 120, 5);
  // motor ojol berjajar
  for (let i = 0; i < 4; i++) {
    const mx = r.x + 16 + i * 18 + (i > 1 ? r.w - 98 : 0);
    const my = r.y + r.h - 18 + Math.sin(t * 2 + i) * 0.6;
    ctx.fillStyle = '#111827';
    ctx.beginPath();
    ctx.arc(mx - 5, my + 5, 3, 0, Math.PI * 2);
    ctx.arc(mx + 5, my + 5, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#16a34a';
    roundRect(ctx, mx - 7, my - 4, 14, 7, 3);
    ctx.fill();
    ctx.fillStyle = '#22c55e';
    ctx.beginPath();
    ctx.arc(mx, my - 7, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Alun-alun: lapangan, air mancur, tugu monumen di tengah, pepohonan. */
export function drawPlaza(ctx: Ctx, r: Rect, t: number, theme: WorldTheme): void {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const R = Math.min(r.w, r.h) / 2;
  ctx.fillStyle = '#4ade80';
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#f5f5f4';
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.72, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#7dd3fc';
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.32, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.18 + Math.sin(t * 2) * 3, 0, Math.PI * 2);
  ctx.stroke();
  // tugu
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath();
  ctx.ellipse(cx + 8, cy + 4, 16, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#e7e5e4';
  ctx.fillRect(cx - 12, cy - 4, 24, 8);
  ctx.beginPath();
  ctx.moveTo(cx - 7, cy - 4);
  ctx.lineTo(cx, cy - R * 0.85);
  ctx.lineTo(cx + 7, cy - 4);
  ctx.closePath();
  ctx.fillStyle = '#f5f5f4';
  ctx.fill();
  ctx.fillStyle = '#d6d3d1';
  ctx.beginPath();
  ctx.moveTo(cx, cy - R * 0.85);
  ctx.lineTo(cx + 7, cy - 4);
  ctx.lineTo(cx + 2, cy - 4);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = theme.accent;
  ctx.beginPath();
  ctx.arc(cx, cy - R * 0.88, 5 + Math.sin(t * 3) * 0.8, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    tree(ctx, cx + Math.cos(a) * R * 0.9, cy + Math.sin(a) * R * 0.9, 0.75);
  }
}

/** Zona Proyek Nasional: crane berayun + pagar proyek + progress, atau perayaan bila semua selesai. */
export function drawProjectSite(ctx: Ctx, r: Rect, t: number, progress: number, emoji: string, allDone: boolean): void {
  ctx.fillStyle = '#e7e5e4';
  roundRect(ctx, r.x, r.y, r.w, r.h, 10);
  ctx.fill();
  if (allDone) {
    drawEmoji(ctx, '🎉', r.x + r.w / 2, r.y + r.h / 2, 56);
    return;
  }
  // fondasi naik sesuai progres
  const fh = Math.max(6, (r.h * 0.55) * progress);
  ctx.fillStyle = '#94a3b8';
  ctx.fillRect(r.x + 14, r.y + r.h - 22 - fh, r.w - 28, fh);
  ctx.strokeStyle = '#64748b';
  ctx.lineWidth = 1;
  for (let y = r.y + r.h - 22 - fh; y < r.y + r.h - 22; y += 10) {
    ctx.beginPath();
    ctx.moveTo(r.x + 14, y);
    ctx.lineTo(r.x + r.w - 14, y);
    ctx.stroke();
  }
  // crane
  const mx = r.x + r.w * 0.78;
  ctx.strokeStyle = '#eab308';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(mx, r.y + r.h - 20);
  ctx.lineTo(mx, r.y + 14);
  ctx.stroke();
  const ang = Math.sin(t * 0.6) * 0.25;
  ctx.save();
  ctx.translate(mx, r.y + 16);
  ctx.rotate(ang);
  ctx.beginPath();
  ctx.moveTo(-r.w * 0.6, 0);
  ctx.lineTo(14, 0);
  ctx.stroke();
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 1;
  const hookX = -r.w * 0.42;
  const hookY = 24 + Math.sin(t * 1.2) * 6;
  ctx.beginPath();
  ctx.moveTo(hookX, 0);
  ctx.lineTo(hookX, hookY);
  ctx.stroke();
  ctx.fillStyle = '#f97316';
  ctx.fillRect(hookX - 6, hookY, 12, 6);
  ctx.restore();
  // pagar proyek
  for (let i = 0; i < 10; i++) {
    ctx.fillStyle = i % 2 ? '#111827' : '#facc15';
    ctx.fillRect(r.x + 6 + (i * (r.w - 12)) / 10, r.y + r.h - 14, (r.w - 12) / 10 + 0.5, 6);
  }
  drawEmoji(ctx, emoji, r.x + 22, r.y + 22, 26);
  // progress bar
  ctx.fillStyle = 'rgba(15,23,42,0.6)';
  roundRect(ctx, r.x + 8, r.y + r.h - 6, r.w - 16, 4, 2);
  ctx.fill();
  ctx.fillStyle = '#22c55e';
  roundRect(ctx, r.x + 8, r.y + r.h - 6, Math.max(2, (r.w - 16) * progress), 4, 2);
  ctx.fill();
}

/** Monumen proyek nasional yang sudah selesai. */
export function drawMonument(ctx: Ctx, r: Rect, emoji: string, t: number): void {
  ctx.fillStyle = '#fef3c7';
  roundRect(ctx, r.x, r.y, r.w, r.h, 10);
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.beginPath();
  ctx.ellipse(r.x + r.w / 2 + 6, r.y + r.h * 0.75, r.w * 0.3, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  drawEmoji(ctx, emoji, r.x + r.w / 2, r.y + r.h * 0.48 + Math.sin(t * 1.5) * 2, Math.min(r.w, r.h) * 0.6);
}

/** Taman kosong (slot pojok sebelum ada monumen). */
export function drawPark(ctx: Ctx, r: Rect): void {
  ctx.fillStyle = '#86efac';
  roundRect(ctx, r.x, r.y, r.w, r.h, 10);
  ctx.fill();
  tree(ctx, r.x + r.w * 0.3, r.y + r.h * 0.35);
  tree(ctx, r.x + r.w * 0.7, r.y + r.h * 0.45);
  tree(ctx, r.x + r.w * 0.45, r.y + r.h * 0.72);
}

/** Rel MRT melingkari jalan lingkar inti + kereta 3 gerbong berjalan. */
export function drawTrainLoop(ctx: Ctx, half: number, t: number, color: string): void {
  ctx.strokeStyle = '#78716c';
  ctx.lineWidth = 6;
  ctx.strokeRect(-half, -half, half * 2, half * 2);
  ctx.strokeStyle = '#d6d3d1';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([3, 5]);
  ctx.strokeRect(-half, -half, half * 2, half * 2);
  ctx.setLineDash([]);
  const per = half * 8;
  const pointAt = (s: number): [number, number, number] => {
    s = ((s % per) + per) % per;
    const side = Math.floor(s / (half * 2));
    const o = s - side * half * 2 - half;
    if (side === 0) return [o, -half, 0];
    if (side === 1) return [half, o, Math.PI / 2];
    if (side === 2) return [-o, half, Math.PI];
    return [-half, -o, -Math.PI / 2];
  };
  const head = t * 70;
  for (let i = 0; i < 3; i++) {
    const [x, y, a] = pointAt(head - i * 26);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.fillStyle = i === 0 ? shade(color, -0.2) : color;
    roundRect(ctx, -11, -6, 22, 12, 4);
    ctx.fill();
    ctx.fillStyle = '#e0f2fe';
    ctx.fillRect(-7, -4, 4, 3);
    ctx.fillRect(-1, -4, 4, 3);
    ctx.fillRect(5, -4, 3, 3);
    ctx.restore();
  }
}

/**
 * Hiasan Pelantikan Gelombang 1 di Alun-Alun Tugu: umbul-umbul merah-putih melingkar, panggung mini
 * dengan spanduk "5.531 WARGA RESMI DILANTIK" + dua bendera. Murni gambar (tidak ada hit-area baru).
 */
export function drawInaugurationDecor(ctx: Ctx, r: Rect, t: number): void {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const R = Math.min(r.w, r.h) / 2;

  // Umbul-umbul segitiga di antara pohon (lingkar luar)
  const ring = R * 0.9;
  for (let i = 0; i < 8; i++) {
    const a0 = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const a1 = ((i + 1) / 8) * Math.PI * 2 + Math.PI / 8;
    const x0 = cx + Math.cos(a0) * ring;
    const y0 = cy + Math.sin(a0) * ring - 10;
    const x1 = cx + Math.cos(a1) * ring;
    const y1 = cy + Math.sin(a1) * ring - 10;
    const sag = 7 + Math.sin(t * 2 + i) * 1.2;
    ctx.strokeStyle = 'rgba(120,53,15,0.55)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo((x0 + x1) / 2, (y0 + y1) / 2 + sag, x1, y1);
    ctx.stroke();
    for (let k = 1; k < 6; k++) {
      const u = k / 6;
      const px = (1 - u) * (1 - u) * x0 + 2 * (1 - u) * u * ((x0 + x1) / 2) + u * u * x1;
      const py = (1 - u) * (1 - u) * y0 + 2 * (1 - u) * u * ((y0 + y1) / 2 + sag) + u * u * y1;
      const sw = Math.sin(t * 4 + i * 2 + k) * 0.8;
      ctx.fillStyle = k % 2 ? '#dc2626' : '#ffffff';
      ctx.beginPath();
      ctx.moveTo(px - 2.6, py);
      ctx.lineTo(px + 2.6, py);
      ctx.lineTo(px + sw, py + 5.5);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Panggung mini + spanduk di depan tugu
  const sw = Math.min(r.w * 0.62, 150);
  const sx = cx - sw / 2;
  const sy = cy + R * 0.36;
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  roundRect(ctx, sx + 3, sy + 3, sw, 22, 4);
  ctx.fill();
  ctx.fillStyle = '#7f1d1d';
  roundRect(ctx, sx, sy + 8, sw, 14, 3);
  ctx.fill();
  ctx.fillStyle = '#b91c1c';
  ctx.fillRect(sx, sy + 8, sw, 3);
  // spanduk emas
  const bh = 13;
  const by = sy - 6;
  const grad = ctx.createLinearGradient(sx, by, sx + sw, by);
  grad.addColorStop(0, '#c8901c');
  grad.addColorStop(0.5, '#fde68a');
  grad.addColorStop(1, '#c8901c');
  ctx.fillStyle = grad;
  roundRect(ctx, sx + 4, by, sw - 8, bh, 3);
  ctx.fill();
  ctx.strokeStyle = '#7c2d12';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.save();
  ctx.fillStyle = '#7c2d12';
  ctx.font = `900 ${Math.max(6, Math.min(8.5, sw / 17))}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('5.531 WARGA RESMI DILANTIK', cx, by + bh / 2 + 0.5, sw - 14);
  ctx.restore();
  // bendera di kedua ujung panggung
  flag(ctx, sx + 2, sy + 10, t, 30);
  flag(ctx, sx + sw - 20, sy + 10, t + 0.6, 30);
  // kilau berkala di spanduk
  const shine = ((t * 0.6) % 1.6) - 0.3;
  if (shine > 0 && shine < 1) {
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    const hx = sx + 4 + shine * (sw - 8);
    ctx.fillRect(hx - 3, by + 1, 6, bh - 2);
  }
}
