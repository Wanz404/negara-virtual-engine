/**
 * Pelantikan bergelombang Republik Konoha.
 *   Gelombang 1 · Perintis 1K : warga #0001–#1000 (stempel emas PERINTIS 1K)
 *   Gelombang 2               : warga #1001–#5535 (= 5.531 warga pertama; nomor #3347, #4185, #4335, #4347 kosong)
 *   #5536 ke atas             : antrean pelantikan gelombang berikutnya
 *
 * Satu sumber kebenaran untuk hak akses ekonomi (Iuran/Patungan, Beli tanah/usaha, Bangun, Voting, Pemerintahan):
 * `isInaugurated()` di sini, dicerminkan 1:1 oleh `nv_require_verified` di Supabase
 * (world_states.config->'economy'->>'inauguratedUpto', lihat migrasi 005). Server tetap otoritas.
 * Semua status dihitung dari data warga yang sudah ada di state frontend — 0 query tambahan.
 */
import { WORLD } from '../configs';

export const INAUGURATION_ENABLED = WORLD.worldId === 'republik-konoha';

/** Nomor kursi terakhir Perintis 1K. */
export const PIONEER_UPTO = 1000;
/** Nomor kursi terakhir yang sudah resmi dilantik (warga ke-5.531 menurut urutan pendaftaran). */
export const INAUGURATED_UPTO = WORLD.economy.inauguratedUpto ?? 0;
/** Jumlah warga yang resmi dilantik (Perintis + Gelombang 2). */
export const INAUGURATED_COUNT = 5531;

export type InaugurationTier = 'pioneer' | 'wave2' | 'queue';

export interface InaugurationBadge {
  tier: InaugurationTier;
  title: string;
  subtitle: string;
}

interface GateCitizen {
  citizenNumber: number;
  followStatus?: string;
}

/**
 * true = warga resmi dilantik → akses penuh Iuran & Beli-beli.
 * Terverifikasi follow ATAU nomor kursi masuk gelombang yang sudah dilantik. Dimakzulkan selalu terkunci.
 */
export function isInaugurated(c: GateCitizen | null | undefined): boolean {
  if (!c || c.followStatus === 'impeached') return false;
  if (c.followStatus === 'verified') return true;
  return INAUGURATION_ENABLED && Number.isFinite(c.citizenNumber) && c.citizenNumber >= 1 && c.citizenNumber <= INAUGURATED_UPTO;
}

/** Warga yang dimakzulkan tidak mendapat badge (stempel "SAH DILANTIK" akan bertentangan dengan status di kartu). */
export function inaugurationBadge(citizenNumber: number, followStatus?: string): InaugurationBadge | null {
  if (!INAUGURATION_ENABLED || followStatus === 'impeached' || !Number.isFinite(citizenNumber) || citizenNumber < 1) return null;
  if (citizenNumber <= PIONEER_UPTO)
    return { tier: 'pioneer', title: 'SAH DILANTIK · PERINTIS 1K', subtitle: `Gelombang 1 · Pendiri ${WORLD.copy.nationName}` };
  if (citizenNumber <= INAUGURATED_UPTO)
    return { tier: 'wave2', title: 'SAH DILANTIK · 5.531 WARGA', subtitle: 'Gelombang 2 · Akses penuh Iuran & Beli' };
  return { tier: 'queue', title: 'ANTREAN PELANTIKAN', subtitle: 'Menunggu pelantikan gelombang berikutnya' };
}

export const INAUGURATION_TICKER =
  'BREAKING: 5.531 Warga Resmi Dilantik! Perintis #0001–#1000 + Gelombang 2 #1001–#5535 kini bebas Iuran Proyek & Beli Tanah/Usaha. Warga #5536 ke atas masuk antrean gelombang berikutnya.';

/** Kartu pengumuman resmi yang dipin di paling atas panel Berita (statis, tidak ada insert DB). */
export const INAUGURATION_PINNED_NEWS = {
  title: 'Pengesahan Pelantikan 5.531 Warga',
  body:
    `Dengan ini 5.531 warga resmi dilantik sebagai warga sah ${WORLD.copy.nationName}: Angkatan Perintis #0001–#1000 (Stempel Emas PERINTIS 1K) ` +
    'dan Gelombang 2 #1001–#5535. Seluruhnya langsung berhak ikut Iuran/Patungan proyek nasional, beli tanah & usaha RT, serta voting. ' +
    'Warga #5536 ke atas masuk antrean pelantikan gelombang berikutnya.',
};

const CONFETTI_KEY = `nv:${WORLD.worldId}:inauguration-w2-confetti`;

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
