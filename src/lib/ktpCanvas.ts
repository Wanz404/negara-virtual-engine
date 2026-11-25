/**
 * Export KTP Virtual PNG 1080×1920 (IG Story 9:16) — "Parodi e-KTP Premium × Kartu Koleksi Game".
 *
 * Aturan tata letak: setiap teks digambar lewat fitLine() yang memperkecil font lalu memotong "…"
 * agar TIDAK PERNAH melewati lebar kolomnya. Semua posisi berasal dari grid tetap di bawah.
 */
import { WORLD } from '../configs';
import { ktpPropertyLabel } from './economy';
import { chibiSprite } from '../engine/sprites';
import { findTier, ringName } from './game';
import { formatCitizenNumber, formatCoins } from './format';
import { inaugurationBadge } from './inauguration';
import { barcodeBars, followStatusLabel, ktpPalette, stampSpec, type KtpPalette } from './ktpStyle';
import type { MyCitizen } from '../services/types';

const W = 1080;
const H = 1920;
const SANS = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, "Roboto Mono", monospace';

// ---- Grid (px) ----
const CARD = { x: 60, y: 250, w: 960, h: 1220 };
const BORDER = 16;
const PAD = 52;
const CX = CARD.x + BORDER + PAD; // 128
const CW = CARD.w - 2 * (BORDER + PAD); // 824
const PHOTO = { x: CX, y: 566, w: 300, h: 390 };
const RIGHT_X = PHOTO.x + PHOTO.w + 44; // 472
const RIGHT_W = CX + CW - RIGHT_X; // 480
const GRID_Y = 1030;
const ROW_H = 118;
const COL_W = (CW - 40) / 2;

type G = CanvasRenderingContext2D;

function rr(g: G, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Atur font agar `text` muat `maxW`: kecilkan sampai `min`, lalu potong dengan "…". */
function fitLine(g: G, text: string, maxW: number, size: number, min: number, weight: number, family = SANS): string {
  let s = size;
  g.font = `${weight} ${s}px ${family}`;
  while (g.measureText(text).width > maxW && s > min) {
    s -= 2;
    g.font = `${weight} ${s}px ${family}`;
  }
  let out = text;
  while (g.measureText(out).width > maxW && out.length > 1) out = `${out.slice(0, -2)}…`;
  return out;
}

function drawFit(g: G, text: string, x: number, y: number, maxW: number, size: number, min: number, weight: number, family = SANS): void {
  g.fillText(fitLine(g, text, maxW, size, min, weight, family), x, y);
}

/** Bungkus maks. `maxLines` baris; baris terakhir dipotong "…". Mengembalikan y baris terakhir. */
function wrapLines(g: G, text: string, x: number, y: number, maxW: number, lineH: number, maxLines: number): number {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (g.measureText(test).width > maxW && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  const shown = lines.slice(0, maxLines);
  if (lines.length > maxLines) {
    let last = `${shown[maxLines - 1]} ${lines.slice(maxLines).join(' ')}`;
    while (g.measureText(`${last}…`).width > maxW && last.length > 1) last = last.slice(0, -1);
    shown[maxLines - 1] = `${last.trimEnd()}…`;
  }
  shown.forEach((l, i) => g.fillText(l, x, y + i * lineH));
  return y + (shown.length - 1) * lineH;
}

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Gradasi "pill" yang cukup gelap untuk teks putih (emas pakai versi terang + teks gelap). */
function pillGradient(g: G, p: KtpPalette, x: number, y: number, w: number, h: number): CanvasGradient {
  if (p.group === 'gold') return metalGradient(g, p, x, y, w, h);
  const m = g.createLinearGradient(x, y, x + w, y + h);
  m.addColorStop(0, p.metal[1]);
  m.addColorStop(1, p.metal[3]);
  return m;
}

function metalGradient(g: G, p: KtpPalette, x: number, y: number, w: number, h: number): CanvasGradient {
  const m = g.createLinearGradient(x, y, x + w, y + h);
  m.addColorStop(0, p.metal[0]);
  m.addColorStop(0.35, p.metal[1]);
  m.addColorStop(0.6, p.metal[2]);
  m.addColorStop(1, p.metal[3]);
  return m;
}

// ---------------------------------------------------------------------------

function drawBackground(g: G, p: KtpPalette, rnd: () => number): void {
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, p.bgTop);
  bg.addColorStop(1, p.bgBottom);
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);

  const glow = g.createRadialGradient(W / 2, 760, 60, W / 2, 760, 900);
  glow.addColorStop(0, `${p.glow}66`);
  glow.addColorStop(0.45, `${p.glow}1f`);
  glow.addColorStop(1, `${p.glow}00`);
  g.fillStyle = glow;
  g.fillRect(0, 0, W, H);

  // grid tipis
  g.strokeStyle = 'rgba(255,255,255,0.045)';
  g.lineWidth = 1;
  for (let x = 0; x <= W; x += 54) {
    g.beginPath();
    g.moveTo(x + 0.5, 0);
    g.lineTo(x + 0.5, H);
    g.stroke();
  }
  for (let y = 0; y <= H; y += 54) {
    g.beginPath();
    g.moveTo(0, y + 0.5);
    g.lineTo(W, y + 0.5);
    g.stroke();
  }
  // noise
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = `rgba(255,255,255,${0.02 + rnd() * 0.04})`;
    g.fillRect(rnd() * W, rnd() * H, 1.6, 1.6);
  }
  // kilau diagonal
  g.save();
  g.globalAlpha = 0.08;
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.moveTo(-200, 1500);
  g.lineTo(1300, 300);
  g.lineTo(1300, 420);
  g.lineTo(-200, 1620);
  g.fill();
  g.restore();
}

function drawGuilloche(g: G, p: KtpPalette): void {
  const x0 = CARD.x + BORDER;
  const y0 = CARD.y + BORDER;
  const w = CARD.w - BORDER * 2;
  const h = CARD.h - BORDER * 2;
  g.save();
  rr(g, x0, y0, w, h, 34);
  g.clip();
  g.strokeStyle = p.accent;
  g.lineWidth = 1.1;
  g.globalAlpha = 0.07;
  for (let k = 0; k < 22; k++) {
    g.beginPath();
    for (let x = x0; x <= x0 + w; x += 6) {
      const y = y0 + 140 + k * 48 + Math.sin(x * 0.012 + k * 0.6) * 26 + Math.sin(x * 0.031 + k) * 8;
      if (x === x0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
  // rosette (pola KTP)
  const rx = x0 + w - 170;
  const ry = y0 + h - 360;
  g.globalAlpha = 0.1;
  g.lineWidth = 1;
  for (let j = 0; j < 7; j++) {
    const R = 150 - j * 16;
    g.beginPath();
    for (let a = 0; a <= Math.PI * 2 + 0.01; a += 0.02) {
      const r = R + 9 * Math.sin(14 * a + j * 0.9);
      const x = rx + Math.cos(a) * r;
      const y = ry + Math.sin(a) * r * 0.55;
      if (a === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
  g.restore();
}

function drawChip(g: G, x: number, y: number): void {
  const w = 96;
  const h = 72;
  const grad = g.createLinearGradient(x, y, x + w, y + h);
  grad.addColorStop(0, '#fde68a');
  grad.addColorStop(0.5, '#d4a017');
  grad.addColorStop(1, '#fef3c7');
  g.fillStyle = grad;
  rr(g, x, y, w, h, 12);
  g.fill();
  g.strokeStyle = 'rgba(120,80,10,0.55)';
  g.lineWidth = 2;
  g.stroke();
  g.beginPath();
  g.moveTo(x + w / 3, y);
  g.lineTo(x + w / 3, y + h);
  g.moveTo(x + (2 * w) / 3, y);
  g.lineTo(x + (2 * w) / 3, y + h);
  g.moveTo(x, y + h / 2);
  g.lineTo(x + w / 3, y + h / 2);
  g.moveTo(x + (2 * w) / 3, y + h / 2);
  g.lineTo(x + w, y + h / 2);
  g.stroke();
  rr(g, x + w / 3, y + h * 0.28, w / 3, h * 0.44, 6);
  g.stroke();
}

function drawBarcode(g: G, code: string, x: number, y: number, w: number, h: number): void {
  const bars = barcodeBars(code);
  const total = bars.reduce((s, b) => s + b + 1.2, 0);
  const scale = w / total;
  let cx = x;
  g.fillStyle = '#111827';
  bars.forEach((b, i) => {
    if (i % 2 === 0) g.fillRect(cx, y, b * scale, h);
    cx += (b + 1.2) * scale;
  });
}

/** Stempel tinta bulat transparan dengan tekstur bintik (bukan blok putih). */
function drawStamp(g: G, status: MyCitizen['followStatus'], cx: number, cy: number, r: number): void {
  const spec = stampSpec(status, WORLD.copy.stamps[status === 'recheck_requested' ? 'pending' : status]);
  const size = r * 2 + 20;
  const off = document.createElement('canvas');
  off.width = off.height = size;
  const s = off.getContext('2d')!;
  const o = size / 2;
  s.strokeStyle = spec.ink;
  s.fillStyle = spec.ink;
  s.lineWidth = 7;
  s.beginPath();
  s.arc(o, o, r, 0, Math.PI * 2);
  s.stroke();
  s.lineWidth = 2.5;
  s.beginPath();
  s.arc(o, o, r - 13, 0, Math.PI * 2);
  s.stroke();
  s.beginPath();
  s.arc(o, o, r * 0.5, 0, Math.PI * 2);
  s.stroke();

  const arcText = (text: string, top: boolean) => {
    if (!text) return;
    const radius = r - 34;
    const span = Math.PI * 0.82;
    const fs = Math.max(13, Math.min(24, (radius * span) / (text.length * 0.64)));
    s.font = `900 ${fs}px ${SANS}`;
    s.textAlign = 'center';
    s.textBaseline = 'middle';
    const chars = [...text];
    const step = span / Math.max(1, chars.length - 1);
    chars.forEach((ch, i) => {
      const a = top ? -Math.PI / 2 - span / 2 + i * step : Math.PI / 2 + span / 2 - i * step;
      s.save();
      s.translate(o + Math.cos(a) * radius, o + Math.sin(a) * radius);
      s.rotate(top ? a + Math.PI / 2 : a - Math.PI / 2);
      s.fillText(ch, 0, 0);
      s.restore();
    });
  };
  arcText(spec.top, true);
  arcText(spec.bottom, false);
  s.textAlign = 'center';
  s.textBaseline = 'middle';
  s.font = `900 ${spec.center.length > 4 ? 22 : 40}px ${SANS}`;
  s.fillText(spec.center, o, o + 2);
  s.font = `900 16px ${SANS}`;
  s.fillText('★', o - r * 0.72, o + 2);
  s.fillText('★', o + r * 0.72, o + 2);

  // tekstur tinta: bintik-bintik terhapus
  const rnd = seeded(r * 97 + spec.center.length);
  s.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 520; i++) {
    s.globalAlpha = 0.25 + rnd() * 0.6;
    s.beginPath();
    s.arc(rnd() * size, rnd() * size, 0.6 + rnd() * 2.2, 0, Math.PI * 2);
    s.fill();
  }
  s.globalCompositeOperation = 'source-over';

  g.save();
  g.globalAlpha = 0.76;
  g.translate(cx, cy);
  g.rotate(-0.22);
  g.drawImage(off, -o, -o);
  g.restore();
}

// ---------------------------------------------------------------------------

export function renderKtpCanvas(me: MyCitizen, ownedPlots: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const p = ktpPalette(me.citizenNumber, me.followStatus);
  const tier = findTier(WORLD, me.tierId);
  const num = formatCitizenNumber(me.citizenNumber);
  const rnd = seeded(me.citizenNumber * 7919 + 13);

  drawBackground(g, p, rnd);

  // ---- Label atas (tanpa mengulang judul kartu) ----
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.fillStyle = 'rgba(255,255,255,0.12)';
  g.font = `800 26px ${SANS}`;
  const topLabel = `${WORLD.copy.nationShort.toUpperCase()}  •  DAY ${me.joinedDay}  •  ${p.label}`;
  const tl = fitLine(g, topLabel, 760, 26, 18, 800);
  const tlw = g.measureText(tl).width + 56;
  rr(g, W / 2 - tlw / 2, 128, tlw, 58, 29);
  g.fill();
  g.strokeStyle = `${p.glow}88`;
  g.lineWidth = 2;
  g.stroke();
  g.fillStyle = '#ffffff';
  g.fillText(tl, W / 2, 167);

  // ---- Kartu: bayangan + border metalik ----
  g.save();
  g.shadowColor = `${p.glow}55`;
  g.shadowBlur = 80;
  g.shadowOffsetY = 24;
  g.fillStyle = metalGradient(g, p, CARD.x, CARD.y, CARD.w, CARD.h);
  rr(g, CARD.x, CARD.y, CARD.w, CARD.h, 48);
  g.fill();
  g.restore();
  const inner = g.createLinearGradient(0, CARD.y, 0, CARD.y + CARD.h);
  inner.addColorStop(0, p.cardTop);
  inner.addColorStop(1, p.cardBottom);
  g.fillStyle = inner;
  rr(g, CARD.x + BORDER, CARD.y + BORDER, CARD.w - BORDER * 2, CARD.h - BORDER * 2, 34);
  g.fill();
  g.strokeStyle = `${p.metal[1]}66`;
  g.lineWidth = 2;
  rr(g, CARD.x + BORDER + 10, CARD.y + BORDER + 10, CARD.w - BORDER * 2 - 20, CARD.h - BORDER * 2 - 20, 26);
  g.stroke();
  drawGuilloche(g, p);

  // ---- Header kartu ----
  const serialW = 250;
  const headW = CW - serialW - 30;
  g.textAlign = 'left';
  g.fillStyle = WORLD.theme.primary;
  drawFit(g, WORLD.copy.nationName.toUpperCase(), CX, 334, headW, 28, 18, 900);
  g.fillStyle = '#111827';
  drawFit(g, WORLD.copy.ktpTitle, CX, 378, headW, 36, 22, 900);
  g.fillStyle = '#6b7280';
  drawFit(g, WORLD.copy.ktpDisclaimer, CX, 410, headW, 19, 14, 600);

  const sx = CX + CW - serialW;
  g.fillStyle = '#0b1220';
  rr(g, sx, 298, serialW, 62, 12);
  g.fill();
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  drawFit(g, me.ktpCode, sx + serialW / 2, 341, serialW - 30, 34, 20, 800, MONO);
  drawBarcode(g, me.ktpCode, sx + 6, 372, serialW - 12, 40);
  g.textAlign = 'left';

  g.fillStyle = `${p.accent}40`;
  g.fillRect(CX, 446, CW, 2);

  // ---- Chip + pas foto ----
  drawChip(g, PHOTO.x, 474);
  g.fillStyle = p.photoBg;
  rr(g, PHOTO.x, PHOTO.y, PHOTO.w, PHOTO.h, 18);
  g.fill();
  const shine = g.createLinearGradient(PHOTO.x, PHOTO.y, PHOTO.x, PHOTO.y + PHOTO.h);
  shine.addColorStop(0, 'rgba(255,255,255,0.18)');
  shine.addColorStop(1, 'rgba(0,0,0,0.12)');
  g.fillStyle = shine;
  g.fill();
  g.save();
  rr(g, PHOTO.x, PHOTO.y, PHOTO.w, PHOTO.h, 18);
  g.clip();
  const avatar = chibiSprite(me.avatarColor, tier.look, me.avatarStyle.accessory, me.followStatus === 'impeached', 8);
  g.drawImage(avatar, PHOTO.x - 40, PHOTO.y + 30, PHOTO.w + 80, PHOTO.w + 80);
  g.restore();
  g.strokeStyle = `${p.metal[3]}aa`;
  g.lineWidth = 3;
  rr(g, PHOTO.x, PHOTO.y, PHOTO.w, PHOTO.h, 18);
  g.stroke();

  // ---- Identitas (fokus utama: #nomor & nama) ----
  g.fillStyle = p.accent;
  g.font = `800 20px ${SANS}`;
  g.fillText(`NOMOR ${WORLD.copy.citizenNoun.toUpperCase()}`, RIGHT_X, 500);
  const numGrad = g.createLinearGradient(RIGHT_X, 520, RIGHT_X, 650);
  numGrad.addColorStop(0, p.numberFrom);
  numGrad.addColorStop(1, p.numberTo);
  g.fillStyle = numGrad;
  drawFit(g, `#${num}`, RIGHT_X - 4, 640, RIGHT_W, 168, 96, 900);
  g.fillStyle = '#0f172a';
  drawFit(g, me.username, RIGHT_X, 726, RIGHT_W, 78, 38, 900);

  g.font = `900 22px ${SANS}`;
  const badge = fitLine(g, tier.name.toUpperCase(), RIGHT_W - 36, 22, 16, 900);
  const bw = g.measureText(badge).width + 36;
  g.fillStyle = pillGradient(g, p, RIGHT_X, 752, bw, 46);
  rr(g, RIGHT_X, 752, bw, 46, 23);
  g.fill();
  g.fillStyle = p.group === 'gold' ? '#422006' : '#ffffff';
  g.fillText(badge, RIGHT_X + 18, 783);

  g.fillStyle = '#1f2937';
  g.font = `800 32px ${SANS}`;
  wrapLines(g, me.roleTitle, RIGHT_X, 856, RIGHT_W, 40, 2);
  g.fillStyle = '#6b7280';
  drawFit(g, `@${me.igUsername}`, RIGHT_X, 946, RIGHT_W, 26, 18, 700);

  // ---- Stempel menyerempet sudut kanan-bawah foto (bukan di atas teks) ----
  drawStamp(g, me.followStatus, PHOTO.x + PHOTO.w - 70, PHOTO.y + PHOTO.h - 56, 104);

  // ---- Grid metadata 2 kolom ----
  g.fillStyle = `${p.accent}40`;
  g.fillRect(CX, GRID_Y - 46, CW, 2);
  const ring = Number(/Ring (\d+)/.exec(me.rtRwAddress)?.[1] ?? 1);
  const fields: Array<[string, string]> = [
    ['ALAMAT', me.rtRwAddress.replace(/\s*•\s*Ring \d+/, '')],
    ['ZONA', `Ring ${ring} • ${ringName(WORLD, ring)}`],
    ['WARGA SEJAK', `DAY ${me.joinedDay}`],
    ['KEKAYAAN', formatCoins(me.coins, WORLD.currency.code)],
    ['PROPERTI', ktpPropertyLabel(me, ownedPlots)],
    ['STATUS', followStatusLabel(me.followStatus)],
  ];
  fields.forEach(([k, v], i) => {
    const fx = CX + (i % 2) * (COL_W + 40);
    const fy = GRID_Y + Math.floor(i / 2) * ROW_H;
    g.fillStyle = '#6b7280';
    g.font = `800 20px ${SANS}`;
    g.fillText(k, fx, fy);
    g.fillStyle = '#0f172a';
    drawFit(g, v, fx, fy + 44, COL_W, 34, 20, 800);
  });

  // ---- Footer kartu (handle & domain hanya muncul di sini) ----
  const footY = CARD.y + CARD.h - BORDER - 46;
  g.fillStyle = `${p.accent}40`;
  g.fillRect(CX, footY - 42, CW, 2);
  g.fillStyle = '#4b5563';
  g.textAlign = 'left';
  drawFit(g, `@${WORLD.igAccountHandle}`, CX, footY, CW / 2 - 20, 22, 16, 800);
  g.textAlign = 'right';
  drawFit(g, WORLD.domain, CX + CW, footY, CW / 2 - 20, 22, 16, 700);

  // ---- Pita status pelantikan (menimpa tepi bawah kartu) ----
  const inaug = inaugurationBadge(me.citizenNumber, me.followStatus);
  if (inaug) {
    const gold = inaug.tier === 'pioneer';
    const bw = 820;
    const bh = 92;
    const bx = W / 2 - bw / 2;
    const by = CARD.y + CARD.h - bh / 2 - 6;
    g.save();
    g.shadowColor = gold ? '#f5c542aa' : 'rgba(0,0,0,0.45)';
    g.shadowBlur = 36;
    const frame = g.createLinearGradient(bx, by, bx + bw, by + bh);
    const stops = gold ? ['#fff3c4', '#c8901c', '#fde68a', '#8a5a0b'] : inaug.tier === 'queue' ? ['#f8fafc', '#93c5fd', '#e2e8f0', '#3b82f6'] : ['#ecfdf5', '#34d399', '#a7f3d0', '#065f46'];
    stops.forEach((c, i) => frame.addColorStop(i / (stops.length - 1), c));
    g.fillStyle = frame;
    rr(g, bx, by, bw, bh, 26);
    g.fill();
    g.restore();
    g.fillStyle = gold ? '#2a1203' : inaug.tier === 'queue' ? '#0b1b3a' : '#052e1f';
    rr(g, bx + 6, by + 6, bw - 12, bh - 12, 21);
    g.fill();
    g.textAlign = 'center';
    g.fillStyle = gold ? '#fde68a' : '#ffffff';
    drawFit(g, `${gold ? '🏅' : inaug.tier === 'queue' ? '⏳' : '🎖️'} ${inaug.title}`, W / 2, by + 48, bw - 60, 38, 24, 900);
    g.fillStyle = gold ? '#f5c542' : 'rgba(255,255,255,0.75)';
    drawFit(g, inaug.subtitle, W / 2, by + 76, bw - 60, 20, 14, 800);
  }

  // ---- Hook + CTA ----
  g.textAlign = 'center';
  g.fillStyle = '#ffffff';
  const hook =
    me.citizenNumber <= 100 ? `Kursi #${num} sudah kuamankan. Kamu dapat nomor berapa?` : `Aku ${WORLD.copy.citizenNoun.toLowerCase()} #${num}. Kamu dapat nomor berapa?`;
  drawFit(g, hook, W / 2, 1580, 940, 44, 28, 800);

  g.font = `900 38px ${SANS}`;
  const cta = 'Klaim KTP-mu  →  link di bio';
  const cw = g.measureText(cta).width + 96;
  g.save();
  g.shadowColor = `${p.glow}88`;
  g.shadowBlur = 40;
  g.fillStyle = pillGradient(g, p, W / 2 - cw / 2, 1640, cw, 100);
  rr(g, W / 2 - cw / 2, 1640, cw, 100, 50);
  g.fill();
  g.restore();
  g.fillStyle = p.group === 'gold' ? '#2a1203' : '#ffffff';
  g.fillText(cta, W / 2, 1704);
  return c;
}

export function ktpBlob(me: MyCitizen, ownedPlots: number): Promise<Blob> {
  const c = renderKtpCanvas(me, ownedPlots);
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Gagal membuat PNG.'))), 'image/png'));
}

export function ktpFileName(me: MyCitizen): string {
  return `KTP-${WORLD.ktpPrefix}-${formatCitizenNumber(me.citizenNumber)}-${me.username.replace(/[^a-z0-9]+/gi, '_')}.png`;
}
