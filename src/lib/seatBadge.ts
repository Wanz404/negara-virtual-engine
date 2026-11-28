/** Badge nomor kursi berwarna kasta (Global Chat, ticker). */
import { WORLD } from '../configs';

export interface SeatBadgeStyle {
  label: string;
  caste: string;
  bg: string;
  fg: string;
  ring: string;
  glow: boolean;
}

/**
 * Kursi pejabat inti saat ini. Sumber kebenaran tetap citizens.tier_id di database ('head' / 'deputy');
 * angka ini hanya cadangan untuk tempat yang tidak membawa tier (papan donor, emote melayang).
 * Wapres Konoha: #2552 (Adias) sejak serah terima 28-11-2026 — lihat migrasi 008.
 */
export const HEAD_SEAT = 1;
export const DEPUTY_SEAT = WORLD.worldId === 'republik-konoha' ? 2552 : 2;

export function seatLabel(n: number): string {
  return `#${String(Math.max(0, n)).padStart(4, '0')}`;
}

const STYLE = {
  head: { caste: 'RI-1', bg: 'linear-gradient(135deg,#fde68a,#f59e0b 55%,#b45309)', fg: '#3b1d00', ring: '#fff3c4', glow: true },
  deputy: { caste: 'WAPRES', bg: 'linear-gradient(135deg,#f1f5f9,#cbd5e1 50%,#94a3b8)', fg: '#1e293b', ring: '#fde68a', glow: false },
  cabinet: { caste: 'MENTERI', bg: 'linear-gradient(135deg,#ef4444,#991b1b)', fg: '#fff7ed', ring: '#fbbf24', glow: false },
  elite: { caste: 'ELITE', bg: 'linear-gradient(135deg,#a855f7,#6b21a8)', fg: '#faf5ff', ring: '#e9d5ff', glow: false },
  base: { bg: 'linear-gradient(135deg,#475569,#1e293b)', fg: '#e2e8f0', ring: '#64748b', glow: false },
} as const;

/**
 * `tier` = citizens.tier_id (atau global_chat_messages.tier) bila tersedia → jabatan dibaca dari DB.
 * Tanpa tier: tebakan dari nomor kursi, dengan Wapres = DEPUTY_SEAT (bukan lagi #0002).
 */
export function seatBadge(n: number, tier?: string | null): SeatBadgeStyle {
  const label = seatLabel(n);
  const base = { label, caste: n <= 1000 ? 'PERINTIS' : 'WARGA', ...STYLE.base };
  if (tier) {
    if (tier === 'head') return { label, ...STYLE.head };
    if (tier === 'deputy') return { label, ...STYLE.deputy };
    if (tier === 'cabinet') return { label, ...STYLE.cabinet };
    if (tier === 'council' || tier === 'elite') return { label, ...STYLE.elite };
    return base;
  }
  if (n === HEAD_SEAT) return { label, ...STYLE.head };
  if (n === DEPUTY_SEAT) return { label, ...STYLE.deputy };
  if (n >= 3 && n <= 30) return { label, ...STYLE.cabinet };
  if (n >= 3 && n <= 100) return { label, ...STYLE.elite };
  return base;
}
