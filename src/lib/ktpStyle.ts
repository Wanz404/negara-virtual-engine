/**
 * Palet KTP per golongan nomor urut (dipakai kartu HTML & export PNG):
 *  #001–#030 Emas • #031–#100 Perak/Ungu • #101+ Biru e-KTP • dimakzulkan Abu.
 */
import type { FollowStatus } from '../configs/types';

export type KtpGroup = 'gold' | 'silver' | 'blue' | 'ash';

export interface KtpPalette {
  group: KtpGroup;
  label: string;
  /** Latar Story (atas → bawah) + warna glow radial. */
  bgTop: string;
  bgBottom: string;
  glow: string;
  /** Gradasi border metalik (4 stop). */
  metal: [string, string, string, string];
  /** Latar kartu (atas → bawah). */
  cardTop: string;
  cardBottom: string;
  /** Warna garis guilloche & aksen teks. */
  accent: string;
  /** Gradasi angka nomor urut. */
  numberFrom: string;
  numberTo: string;
  /** Latar pas foto (merah / biru khas KTP). */
  photoBg: string;
}

const PALETTES: Record<KtpGroup, KtpPalette> = {
  gold: {
    group: 'gold',
    label: 'EDISI EMAS',
    bgTop: '#2a0608',
    bgBottom: '#050304',
    glow: '#f5c542',
    metal: ['#fff3c4', '#c8901c', '#fde68a', '#8a5a0b'],
    cardTop: '#fffaf0',
    cardBottom: '#f6e7c8',
    accent: '#b7791f',
    numberFrom: '#b8860b',
    numberTo: '#7c2d12',
    photoBg: '#c81e1e',
  },
  silver: {
    group: 'silver',
    label: 'EDISI PERAK',
    bgTop: '#1a0f33',
    bgBottom: '#05040b',
    glow: '#a78bfa',
    metal: ['#f8fafc', '#8b5cf6', '#e2e8f0', '#4b5563'],
    cardTop: '#faf8ff',
    cardBottom: '#e9e3fb',
    accent: '#7c3aed',
    numberFrom: '#6d28d9',
    numberTo: '#1e1b4b',
    photoBg: '#c81e1e',
  },
  blue: {
    group: 'blue',
    label: 'E-KTP',
    bgTop: '#06173a',
    bgBottom: '#020617',
    glow: '#38bdf8',
    metal: ['#e0f2fe', '#2563eb', '#bae6fd', '#1e3a8a'],
    cardTop: '#f4f9ff',
    cardBottom: '#dbeafe',
    accent: '#1d4ed8',
    numberFrom: '#1d4ed8',
    numberTo: '#0f172a',
    photoBg: '#1d4ed8',
  },
  ash: {
    group: 'ash',
    label: 'ARSIP',
    bgTop: '#1f2937',
    bgBottom: '#030712',
    glow: '#9ca3af',
    metal: ['#f3f4f6', '#6b7280', '#d1d5db', '#374151'],
    cardTop: '#f9fafb',
    cardBottom: '#e5e7eb',
    accent: '#4b5563',
    numberFrom: '#4b5563',
    numberTo: '#111827',
    photoBg: '#6b7280',
  },
};

export function ktpPalette(citizenNumber: number, status: FollowStatus): KtpPalette {
  if (status === 'impeached') return PALETTES.ash;
  if (citizenNumber <= 30) return PALETTES.gold;
  if (citizenNumber <= 100) return PALETTES.silver;
  return PALETTES.blue;
}

export interface StampSpec {
  ink: string;
  top: string;
  bottom: string;
  center: string;
}

/** Teks stempel dari config dunia → 2 busur (atas/bawah) + teks tengah. */
export function stampSpec(status: FollowStatus, text: string): StampSpec {
  const key = status === 'recheck_requested' ? 'pending' : status;
  const ink = { verified: '#c81e1e', pending: '#b45309', not_following: '#475569', impeached: '#7f1d1d' }[key];
  const center = { verified: 'SAH', pending: '1×24 JAM', not_following: 'GELAP', impeached: 'MAKZUL' }[key];
  let parts = text.split(/\s+•\s+|\s+\/\s+/).filter(Boolean);
  if (parts.length < 2) {
    const words = text.split(/\s+/);
    let best = 1;
    let bestDiff = Infinity;
    for (let i = 1; i < words.length; i++) {
      const diff = Math.abs(words.slice(0, i).join(' ').length - words.slice(i).join(' ').length);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = i;
      }
    }
    parts = words.length > 1 ? [words.slice(0, best).join(' '), words.slice(best).join(' ')] : [text, ''];
  }
  return { ink, top: parts[0], bottom: parts.slice(1).join(' '), center };
}

/** Pola barcode deterministik dari kode KTP (lebar batang 1–3). */
export function barcodeBars(code: string, count = 46): number[] {
  let h = 2166136261;
  const bars: number[] = [];
  for (let i = 0; i < count; i++) {
    h ^= code.charCodeAt(i % code.length) + i * 31;
    h = Math.imul(h, 16777619) >>> 0;
    bars.push(1 + (h % 3));
  }
  return bars;
}

export function followStatusLabel(status: FollowStatus): string {
  return {
    verified: 'Terverifikasi ✓',
    pending: 'Menunggu cek follow',
    recheck_requested: 'Menunggu cek ulang',
    not_following: 'Belum follow',
    impeached: 'Dimakzulkan',
  }[status];
}
