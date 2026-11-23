/** Nomor urut: 1–999 → 3 digit zero-padded ("001"); 1000+ tanpa padding ("1000"). */
export function formatCitizenNumber(n: number): string {
  return n < 1000 ? String(n).padStart(3, '0') : String(n);
}

/** Format tag profil ala game: "Novi | 001", "Raka | 1000". */
export function formatCitizenTag(name: string, n: number): string {
  return `${name} | ${formatCitizenNumber(n)}`;
}

const numberFmt = new Intl.NumberFormat('id-ID');

export function formatNumber(n: number): string {
  return numberFmt.format(Math.round(n));
}

export function formatCoins(n: number, currencyCode: string): string {
  return `${formatNumber(n)} ${currencyCode}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

/** "12 Nov 2026 · 02:00" (waktu lokal perangkat). */
export function formatSyncedAt(iso: string | null | undefined): string {
  if (!iso) return 'belum disinkronkan';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'belum disinkronkan';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} · ${hh}:${mm}`;
}

/** "3 jam 5 menit", "45 detik". */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s < 60) return `${s} detik`;
  const m = Math.ceil(s / 60);
  if (m < 60) return `${m} menit`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} jam ${rest} menit` : `${h} jam`;
}

export function formatRelative(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '-';
  const diff = now - new Date(iso).getTime();
  if (diff < 60_000) return 'baru saja';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} menit lalu`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} jam lalu`;
  return `${Math.floor(diff / 86_400_000)} hari lalu`;
}
