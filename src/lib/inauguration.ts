/**
 * Pelantikan bergelombang Republik Konoha.
 *   Gelombang 1 · Perintis 1K : warga #0001–#1000 (stempel emas PERINTIS 1K)
 *   Gelombang 2               : warga #1001–#5535 (5.531 warga pertama; nomor #3347, #4185, #4335, #4347 kosong) — migrasi 005
 *   Gelombang 3               : warga #5536–#INAUGURATED_UPTO (= MAX(citizen_number) saat pelantikan 28-11-2026) — migrasi 008
 *   Di atas INAUGURATED_UPTO  : antrean pelantikan Gelombang 4
 *
 * Satu sumber kebenaran untuk hak akses ekonomi (Iuran/Patungan, Beli tanah/usaha, Bangun, Voting, Pemerintahan):
 * `isInaugurated()` di sini, dicerminkan 1:1 oleh `nv_require_verified` di Supabase
 * (world_states.config->'economy'->>'inauguratedUpto'). Server tetap otoritas.
 * Semua status dihitung dari data warga yang sudah ada di state frontend — 0 query tambahan.
 */
import { WORLD } from '../configs';

export const INAUGURATION_ENABLED = WORLD.worldId === 'republik-konoha';

/** Nomor kursi terakhir Perintis 1K. */
export const PIONEER_UPTO = 1000;
/** Nomor kursi terakhir Gelombang 2 (warga ke-5.531). */
export const WAVE2_UPTO = 5535;
/** Nomor kursi terakhir yang sudah resmi dilantik (akhir Gelombang 3). */
export const INAUGURATED_UPTO = WORLD.economy.inauguratedUpto ?? 0;
/** Jumlah warga yang resmi dilantik (Perintis + Gelombang 2 + Gelombang 3) — hasil hitung DB saat migrasi 008. */
export const INAUGURATED_COUNT = 8680;

const fmt = (n: number) => n.toLocaleString('id-ID');
const seat = (n: number) => `#${String(n).padStart(4, '0')}`;
/** "8.680+" — angka yang tampil di ticker, Alun-Alun & E-KTP. */
export const INAUGURATED_LABEL = `${fmt(INAUGURATED_COUNT)}+`;

export type InaugurationTier = 'pioneer' | 'wave2' | 'wave3' | 'queue';

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
  if (citizenNumber <= WAVE2_UPTO)
    return { tier: 'wave2', title: 'SAH DILANTIK · GELOMBANG 2', subtitle: 'Resmi Dilantik · Akses penuh Iuran & Beli' };
  if (citizenNumber <= INAUGURATED_UPTO)
    return { tier: 'wave3', title: 'SAH DILANTIK · GELOMBANG 3', subtitle: 'Resmi Dilantik · Akses penuh Iuran & Beli' };
  return { tier: 'queue', title: 'ANTREAN PELANTIKAN', subtitle: 'Menunggu pelantikan Gelombang 4' };
}

/** Wapres baru (serah terima #0002 → #2552, migrasi 008). */
export const NEW_DEPUTY = { seat: 2552, name: 'Adias', ig: 'adprji_' } as const;

export const INAUGURATION_TICKER =
  `BREAKING: ${seat(NEW_DEPUTY.seat)} ${NEW_DEPUTY.name} (@${NEW_DEPUTY.ig}) RESMI DILANTIK SEBAGAI WAKIL PRESIDEN KONOHA usai menang Pemilu Komentar Cawapres!` +
  `     •     PELANTIKAN GELOMBANG 3: ${INAUGURATED_LABEL} Warga Resmi Dilantik! Warga #5536–${seat(INAUGURATED_UPTO)} kini bebas Iuran Proyek & Beli Warung, Kavling RT & Item. ` +
  `Warga ${seat(INAUGURATED_UPTO + 1)} ke atas masuk antrean Gelombang 4.`;

/** Kartu pengumuman resmi yang dipin di paling atas panel Berita (statis, tidak ada insert DB). */
export const INAUGURATION_PINNED_NEWS = {
  title: `Wapres Baru ${NEW_DEPUTY.name} ${seat(NEW_DEPUTY.seat)} & Pelantikan Gelombang 3`,
  body:
    `${NEW_DEPUTY.name} (${seat(NEW_DEPUTY.seat)}, @${NEW_DEPUTY.ig}) resmi dilantik sebagai Wakil Presiden ${WORLD.copy.nationName} setelah memenangkan Pemilu Komentar Cawapres, ` +
    'menggantikan Wanz #0002 yang mengundurkan diri (tetap tercatat sebagai Angkatan Perintis). ' +
    `Bersamaan dengan itu Gelombang 3 #5536–${seat(INAUGURATED_UPTO)} resmi dilantik — total ${INAUGURATED_LABEL} warga sah: ` +
    'Perintis #0001–#1000, Gelombang 2 #1001–#5535 dan Gelombang 3. Seluruhnya berhak ikut Iuran/Patungan proyek nasional, beli warung, kavling RT & item, serta voting. ' +
    `Warga ${seat(INAUGURATED_UPTO + 1)} ke atas masuk antrean Gelombang 4.`,
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
