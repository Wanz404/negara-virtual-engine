import type { Accessory, CharacterLook } from '../configs/types';

/** Utilitas warna kecil. */
export function shade(hex: string, amt: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(amt >= 0 ? c + (255 - c) * amt : c * (1 + amt))));
  const r = f((n >> 16) & 255);
  const g = f((n >> 8) & 255);
  const b = f(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

const SPRITE_RES = 2; // 64 unit → 128 px
const chibiCache = new Map<string, HTMLCanvasElement>();
const P = (d: string) => new Path2D(d);

const PATHS = {
  body: P('M14 58c0-13 8-20 18-20s18 7 18 20z'),
  collar: P('M27 39l5 9 5-9z'),
  tie: P('M31 41h2l1 10-2 3-2-3z'),
  hair: P('M19 22c0-9 6-13 13-13s13 4 13 13c-3-4-8-6-13-6s-10 2-13 6z'),
  robe: P('M18 58l4-18h20l4 18z'),
  shades: P('M23 24h7v3a3 3 0 0 1-7 0zM34 24h7v3a3 3 0 0 1-7 0z'),
  smile: P('M29 30c1.5 1.4 4.5 1.4 6 0'),
  crown: P('M22 13l4-7 6 5 6-5 4 7z'),
  star: P('M32 2l2.6 5.4 5.9.8-4.3 4.1 1 5.8L32 15.3l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z'),
  helmet: P('M18 22a14 14 0 0 1 28 0v2H18z'),
  cap: P('M19 18a13 9 0 0 1 26 0zM40 17h9v3h-9z'),
  hat: P('M16 15h32v3H16zM22 15V7h20v8z'),
  horns: P('M21 12l-3-8 7 6zM43 12l3-8-7 6z'),
  ears: P('M20 15l2-11 8 7zM44 15l-2-11-8 7z'),
  sparkle: P('M50 10l1.5 3.5L55 15l-3.5 1.5L50 20l-1.5-3.5L45 15l3.5-1.5z'),
};

/** Gambar chibi (64×64 unit, sama dengan komponen Avatar SVG) ke kanvas offscreen yang di-cache. */
export function chibiSprite(color: string, look: CharacterLook, accessory: Accessory | undefined, dim: boolean, res = SPRITE_RES): HTMLCanvasElement {
  const acc = look.accessory !== 'none' ? look.accessory : (accessory ?? 'none');
  const key = `${color}|${look.outfit}|${acc}|${look.accentColor}|${dim ? 1 : 0}|${res}`;
  const hit = chibiCache.get(key);
  if (hit) return hit;

  const c = makeCanvas(64 * res, 64 * res);
  const g = c.getContext('2d')!;
  g.scale(res, res);
  if (dim) g.globalAlpha = 0.55;
  const suit = look.outfit === 'suit' || look.outfit === 'formal';
  const ghost = look.outfit === 'ghost';

  g.fillStyle = suit ? '#1f2937' : ghost ? '#f8fafc' : color;
  g.fill(PATHS.body);
  if (suit) {
    g.fillStyle = '#fff';
    g.fill(PATHS.collar);
    g.fillStyle = look.accentColor;
    g.fill(PATHS.tie);
  }
  if (look.outfit === 'jacket') {
    g.fillStyle = look.accentColor;
    g.fillRect(18, 44, 28, 4);
  }
  if (look.outfit === 'prison') {
    g.strokeStyle = '#1f2937';
    g.lineWidth = 2.5;
    g.beginPath();
    g.moveTo(16, 48);
    g.lineTo(48, 48);
    g.moveTo(15, 53);
    g.lineTo(49, 53);
    g.stroke();
  }
  if (look.outfit === 'robe' || look.outfit === 'fur') {
    g.globalAlpha *= 0.6;
    g.fillStyle = look.accentColor;
    g.fill(PATHS.robe);
    g.globalAlpha = dim ? 0.55 : 1;
  }
  // kepala
  g.fillStyle = ghost ? '#f8fafc' : '#fcd9b6';
  g.beginPath();
  g.arc(32, 24, 13, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = ghost ? '#e2e8f0' : '#3f2a1d';
  g.fill(PATHS.hair);
  if (look.outfit === 'spacesuit') {
    g.strokeStyle = 'rgba(186,230,253,0.85)';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(32, 24, 17, 0, Math.PI * 2);
    g.stroke();
  }
  // wajah
  if (acc === 'sunglasses') {
    g.fillStyle = '#111827';
    g.fill(PATHS.shades);
    g.fillRect(30, 25, 4, 1.2);
  } else {
    g.fillStyle = '#1f2937';
    g.beginPath();
    g.arc(27, 25.5, 1.7, 0, Math.PI * 2);
    g.arc(37, 25.5, 1.7, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = '#7c2d12';
  g.lineWidth = 1.5;
  g.lineCap = 'round';
  g.stroke(PATHS.smile);
  g.fillStyle = 'rgba(251,113,133,0.35)';
  g.beginPath();
  g.arc(24, 29, 2, 0, Math.PI * 2);
  g.arc(40, 29, 2, 0, Math.PI * 2);
  g.fill();
  // aksesoris
  const accent = look.accentColor;
  switch (acc) {
    case 'crown':
      g.fillStyle = '#facc15';
      g.fill(PATHS.crown);
      g.strokeStyle = '#b45309';
      g.lineWidth = 1;
      g.stroke(PATHS.crown);
      break;
    case 'star':
      g.fillStyle = '#facc15';
      g.fill(PATHS.star);
      break;
    case 'helmet':
      g.fillStyle = accent;
      g.fill(PATHS.helmet);
      break;
    case 'cap':
      g.fillStyle = accent;
      g.fill(PATHS.cap);
      break;
    case 'hat':
      g.fillStyle = '#1f2937';
      g.fill(PATHS.hat);
      break;
    case 'horns':
      g.fillStyle = '#7f1d1d';
      g.fill(PATHS.horns);
      break;
    case 'ears':
      g.fillStyle = accent;
      g.fill(PATHS.ears);
      break;
    case 'sparkle':
      g.fillStyle = '#fde047';
      g.fill(PATHS.sparkle);
      break;
    case 'antenna':
      g.strokeStyle = '#64748b';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(32, 11);
      g.lineTo(32, 3);
      g.stroke();
      g.fillStyle = '#22d3ee';
      g.beginPath();
      g.arc(32, 3, 2.5, 0, Math.PI * 2);
      g.fill();
      break;
    case 'halo':
      g.strokeStyle = '#facc15';
      g.lineWidth = 2;
      g.beginPath();
      g.ellipse(32, 7, 10, 3, 0, 0, Math.PI * 2);
      g.stroke();
      break;
    case 'nametag':
      g.fillStyle = '#facc15';
      g.fillRect(36, 46, 9, 5);
      break;
    case 'pin':
      g.fillStyle = accent;
      g.beginPath();
      g.arc(40, 47, 2.5, 0, Math.PI * 2);
      g.fill();
      break;
    case 'whistle':
      g.fillStyle = '#e5e7eb';
      g.beginPath();
      g.arc(38, 47, 2, 0, Math.PI * 2);
      g.fill();
      break;
    default:
      break;
  }
  chibiCache.set(key, c);
  return c;
}

const emojiCache = new Map<string, HTMLCanvasElement>();

/** Emoji dirender sekali ke kanvas offscreen (fillText emoji tiap frame itu mahal). */
export function emojiSprite(emoji: string): HTMLCanvasElement {
  const hit = emojiCache.get(emoji);
  if (hit) return hit;
  const c = makeCanvas(72, 72);
  const g = c.getContext('2d')!;
  g.font = '56px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(emoji, 36, 40);
  emojiCache.set(emoji, c);
  return c;
}

export function drawEmoji(ctx: CanvasRenderingContext2D, emoji: string, x: number, y: number, size: number): void {
  ctx.drawImage(emojiSprite(emoji), x - size / 2, y - size / 2, size, size);
}
