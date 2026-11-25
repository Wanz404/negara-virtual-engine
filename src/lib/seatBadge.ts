/** Badge nomor kursi berwarna kasta (Global Chat, ticker). */
export interface SeatBadgeStyle {
  label: string;
  caste: string;
  bg: string;
  fg: string;
  ring: string;
  glow: boolean;
}

export function seatLabel(n: number): string {
  return `#${String(Math.max(0, n)).padStart(4, '0')}`;
}

export function seatBadge(n: number): SeatBadgeStyle {
  const label = seatLabel(n);
  if (n === 1) return { label, caste: 'RI-1', bg: 'linear-gradient(135deg,#fde68a,#f59e0b 55%,#b45309)', fg: '#3b1d00', ring: '#fff3c4', glow: true };
  if (n === 2) return { label, caste: 'WAPRES', bg: 'linear-gradient(135deg,#f1f5f9,#cbd5e1 50%,#94a3b8)', fg: '#1e293b', ring: '#fde68a', glow: false };
  if (n <= 30) return { label, caste: 'MENTERI', bg: 'linear-gradient(135deg,#ef4444,#991b1b)', fg: '#fff7ed', ring: '#fbbf24', glow: false };
  if (n <= 100) return { label, caste: 'ELITE', bg: 'linear-gradient(135deg,#a855f7,#6b21a8)', fg: '#faf5ff', ring: '#e9d5ff', glow: false };
  return { label, caste: n <= 1000 ? 'PERINTIS' : 'WARGA', bg: 'linear-gradient(135deg,#475569,#1e293b)', fg: '#e2e8f0', ring: '#64748b', glow: false };
}
