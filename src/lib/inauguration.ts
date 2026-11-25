/**
 * Pelantikan bergelombang (Gelombang 1 = warga #0001–#1000, Gelombang 2 = #1001–#2000, …).
 * Semua status dihitung murni dari `citizen_number` yang sudah ada di state frontend — 0 query tambahan.
 * Hanya aktif di dunia yang benar-benar sudah melewati 1.000 warga (saat ini Republik Konoha).
 */
import { WORLD } from '../configs';

export const WAVE_SIZE = 1000;
export const INAUGURATION_ENABLED = WORLD.worldId === 'republik-konoha';

export type InaugurationTier = 'pioneer' | 'queue' | 'citizen';

export interface InaugurationBadge {
  tier: InaugurationTier;
  title: string;
  subtitle: string;
}

/** Warga yang dimakzulkan tidak mendapat badge (stempel "SAH DILANTIK" akan bertentangan dengan status di kartu). */
export function inaugurationBadge(citizenNumber: number, followStatus?: string): InaugurationBadge | null {
  if (!INAUGURATION_ENABLED || followStatus === 'impeached' || !Number.isFinite(citizenNumber) || citizenNumber < 1) return null;
  if (citizenNumber <= WAVE_SIZE)
    return { tier: 'pioneer', title: 'SAH DILANTIK · PERINTIS 1K', subtitle: `Gelombang 1 · Pendiri ${WORLD.copy.nationName}` };
  if (citizenNumber <= WAVE_SIZE * 2) return { tier: 'queue', title: 'ANTREAN GELOMBANG 2', subtitle: 'Dilantik saat mencapai 2.000 warga' };
  return { tier: 'citizen', title: `WARGA RESMI ${WORLD.copy.nationShort.toUpperCase()}`, subtitle: `Terdaftar di ${WORLD.copy.nationName}` };
}

export const INAUGURATION_TICKER =
  'BREAKING: 1.000 Warga Perintis (#0001–#1000) Resmi Dilantik! Warga #1001–#2000 masuk antrean Pelantikan Gelombang 2.';

/** Kartu pengumuman resmi yang dipin di paling atas panel Berita (statis, tidak ada insert DB). */
export const INAUGURATION_PINNED_NEWS = {
  title: 'Pengesahan Pelantikan Gelombang 1',
  body:
    `Dengan ini 1.000 Warga Perintis (#0001–#1000) resmi dilantik sebagai Pendiri ${WORLD.copy.nationName} dan berhak atas Stempel Emas PERINTIS 1K di E-KTP. ` +
    'Antrean Pelantikan Gelombang 2 (#1001–#2000) resmi dibuka — upacara digelar saat jumlah warga mencapai 2.000.',
};

const CONFETTI_KEY = `nv:${WORLD.worldId}:inauguration-w1-confetti`;

/** true sekali saja per perangkat (flag localStorage). Storage diblokir → anggap sudah tampil, jangan spam. */
export function takeConfettiTicket(): boolean {
  try {
    if (localStorage.getItem(CONFETTI_KEY)) return false;
    localStorage.setItem(CONFETTI_KEY, String(Date.now()));
    return true;
  } catch {
    return false;
  }
}
