/**
 * Geometri peta: grid kavling (sama persis dengan SQL nv_ensure_plots) → koordinat dunia (px).
 *
 * Setiap sel grid berjarak CELL px. Di setiap batas ring (jarak Chebyshev core, core+layers, …)
 * disisipkan celah ekstra untuk jalan raya; batas Ring 2 → Ring 3 diberi selat (Pulau Reklamasi).
 * Karena pergeseran diterapkan per-sumbu dengan fungsi monoton, celah membentuk cincin persegi.
 */
import type { LandmarkKind, MapZone, WorldConfig } from '../configs/types';

export const CELL = 80;
export const PLOT = 64;
export const ROAD_EXTRA = 30;
export const WATER_EXTRA = 150;
/** Selat penghubung "Pulau Reklamasi" ada di luar ring ini. */
export const WATER_AFTER_RING = 2;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class Geometry {
  readonly core: number;
  readonly layers: number;

  constructor(core: number, layers: number) {
    this.core = core;
    this.layers = Math.max(1, layers);
  }

  static from(config: WorldConfig): Geometry {
    return new Geometry(config.map.coreRadius, config.map.layersPerRing);
  }

  /** Jarak Chebyshev lapis terluar ring r (r = 0 → tepi inti). */
  ringOuterDistance(r: number): number {
    return this.core + r * this.layers;
  }

  ringInnerDistance(r: number): number {
    return this.core + (r - 1) * this.layers + 1;
  }

  ringOfDistance(d: number): number {
    return d <= this.core ? 0 : Math.ceil((d - this.core) / this.layers);
  }

  /** Total celah ekstra sebelum sel berjarak k pada satu sumbu. */
  gapsBefore(k: number): number {
    if (k <= this.core) return 0;
    const rMax = Math.floor((k - this.core - 1) / this.layers);
    let g = ROAD_EXTRA * (1 + rMax);
    if (rMax >= WATER_AFTER_RING) g += WATER_EXTRA - ROAD_EXTRA;
    return g;
  }

  /** Posisi pusat sel ke-k (k ≥ 0) pada satu sumbu. */
  axisPos(k: number): number {
    return k * CELL + this.gapsBefore(k);
  }

  axis(g: number): number {
    return Math.sign(g) * this.axisPos(Math.abs(g));
  }

  toWorld(gx: number, gy: number): { x: number; y: number } {
    return { x: this.axis(gx), y: this.axis(gy) };
  }

  /** Kebalikan axis(): koordinat px → indeks sel, atau null bila jatuh di jalan/celah. */
  axisToGrid(px: number): number | null {
    const a = Math.abs(px);
    let k = Math.floor(a / CELL) + 1;
    while (k > 0 && this.axisPos(k) - PLOT / 2 > a) k--;
    if (a > this.axisPos(k) + PLOT / 2) return null;
    return px < 0 ? -k : k;
  }

  worldToGrid(x: number, y: number): { gx: number; gy: number } | null {
    const gx = this.axisToGrid(x);
    const gy = this.axisToGrid(y);
    return gx === null || gy === null ? null : { gx, gy };
  }

  /** Setengah-lebar tepi luar ring r (r = 0 → tepi inti). */
  ringOuterHalf(r: number): number {
    return this.axisPos(this.ringOuterDistance(r)) + PLOT / 2 + 8;
  }

  /** Pita jalan (atau selat) di luar ring r: [inner, outer] setengah-lebar persegi. */
  boundaryBand(r: number): { inner: number; outer: number } {
    const b = this.ringOuterDistance(r);
    return { inner: this.axisPos(b) + PLOT / 2 + 4, outer: this.axisPos(b + 1) - PLOT / 2 - 4 };
  }

  /** Setengah-lebar area inti (Ring 0). */
  get coreHalf(): number {
    return this.core * CELL + PLOT / 2 + 8;
  }

  /** Persegi landmark Ring 0 dari slot bersatuan sel (desain inti 7×7, diskalakan bila coreRadius ≠ 3). */
  slotRect(slot: { cx: number; cy: number; w: number; h: number }): Rect {
    const s = this.core / 3;
    const w = slot.w * s * CELL - 16;
    const h = slot.h * s * CELL - 16;
    return { x: slot.cx * s * CELL - w / 2, y: slot.cy * s * CELL - h / 2, w, h };
  }
}

/** Tata letak Ring 0 (inti 7×7 sel): istana di utara, gerbang di selatan, alun-alun di tengah. */
export const LANDMARK_SLOTS: Record<LandmarkKind, { cx: number; cy: number; w: number; h: number }> = {
  palace: { cx: 0, cy: -2.5, w: 3, h: 2 },
  parliament: { cx: -2.5, cy: -2.5, w: 2, h: 2 },
  elite_complex: { cx: 2.5, cy: -2.5, w: 2, h: 2 },
  shop: { cx: -2.5, cy: 0, w: 2, h: 3 },
  plaza: { cx: 0, cy: 0, w: 3, h: 3 },
  project_site: { cx: 2.5, cy: 0, w: 2, h: 3 },
  gate: { cx: 0, cy: 2.5, w: 3, h: 2 },
};

/** Dua slot pojok selatan untuk monumen proyek nasional yang sudah selesai. */
export const MONUMENT_SLOTS = [
  { cx: -2.5, cy: 2.5, w: 2, h: 2 },
  { cx: 2.5, cy: 2.5, w: 2, h: 2 },
];

export type Rng = () => number;

/** PRNG kecil & deterministik (mulberry32) agar posisi awal stabil per id. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function inRect(r: Rect, rng: Rng, pad = 6): { x: number; y: number } {
  return { x: r.x + pad + rng() * Math.max(1, r.w - pad * 2), y: r.y + pad + rng() * Math.max(1, r.h - pad * 2) };
}

/** Titik acak di pita jalan luar ring r. */
export function roadPoint(geo: Geometry, r: number, rng: Rng): { x: number; y: number } {
  const band = geo.boundaryBand(r);
  const water = r === WATER_AFTER_RING;
  const lane = water ? band.inner + 12 : (band.inner + band.outer) / 2;
  const off = (rng() - 0.5) * (water ? 10 : Math.max(4, band.outer - band.inner - 10));
  const s = lane + off;
  const along = (rng() * 2 - 1) * s;
  switch (Math.floor(rng() * 4)) {
    case 0:
      return { x: along, y: -s };
    case 1:
      return { x: s, y: along };
    case 2:
      return { x: along, y: s };
    default:
      return { x: -s, y: along };
  }
}

/** Titik tujuan jalan-jalan berdasarkan zona kasta. */
export function zonePoint(geo: Geometry, zone: MapZone | 'plaza' | 'guest', unlockedRings: number, rng: Rng): { x: number; y: number } {
  const s = geo.core / 3;
  const front = (slot: { cx: number; cy: number; w: number; h: number }, dy: number): Rect => {
    const r = geo.slotRect(slot);
    return { x: r.x, y: r.y + r.h + dy * s, w: r.w, h: 18 };
  };
  switch (zone) {
    case 'palace':
      return inRect(front(LANDMARK_SLOTS.palace, -6), rng);
    case 'parliament':
      return inRect(front(LANDMARK_SLOTS.parliament, -6), rng);
    case 'elite_complex':
      return inRect(front(LANDMARK_SLOTS.elite_complex, -6), rng);
    case 'gate': {
      const r = geo.slotRect(LANDMARK_SLOTS.gate);
      return inRect({ x: r.x, y: r.y - 10, w: r.w, h: 22 }, rng);
    }
    case 'plaza':
    case 'guest': {
      const a = rng() * Math.PI * 2;
      const d = 40 * s + rng() * 70 * s;
      return { x: Math.cos(a) * d, y: Math.sin(a) * d };
    }
    case 'ring1':
      return roadPoint(geo, 0, rng);
    case 'commercial':
      return roadPoint(geo, Math.min(1, unlockedRings), rng);
    case 'residential':
      return roadPoint(geo, Math.floor(rng() * (unlockedRings + 1)), rng);
    default:
      return rng() < 0.4 ? zonePoint(geo, 'plaza', unlockedRings, rng) : roadPoint(geo, Math.floor(rng() * (unlockedRings + 1)), rng);
  }
}
