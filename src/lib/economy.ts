/**
 * Upgrade v3 — konstanta ekonomi (cermin upgrade_v3_economy_ux.sql). Server tetap sumber kebenaran:
 * nilai di sini hanya untuk tampilan, countdown & mode sandbox.
 */
import type { MyCitizen } from '../services/types';

export const SALARY_BASE = 50;
export const SALARY_COOLDOWN_MS = 24 * 60 * 60 * 1000;
export const QUICK_WORK_REWARD = 25;
export const QUICK_WORK_COOLDOWN_MS = 2 * 60 * 60 * 1000;
export const QUICK_WORK_MAX_PER_DAY = 3;
export const DONATION_ANNOUNCE_MIN = 50;
export const QUICK_DONATIONS = [10, 25, 50, 100];

export const QUICK_WORK_LABELS = [
  'Jaga Warung Madura',
  'Narik Ojol Alun-Alun',
  'Rapat Lembur DPR',
  'Bantu Cor Stasiun',
  'Jadi Kang Parkir Minimarket',
  'Antar Paket Kilat',
  'Jualan Cilok Depan Istana',
  'Bikin Konten FYP',
];

/**
 * Bonus gaji jabatan dari tier di database (bukan nomor kursi): RI-1/RI-2 +40, Kabinet +25, DPR & Naga +15.
 * Cermin nv_rank_salary_bonus_tier di Supabase (migrasi 008).
 */
export function rankSalaryBonus(tierId: string): number {
  if (tierId === 'head' || tierId === 'deputy') return 40;
  if (tierId === 'cabinet') return 25;
  if (tierId === 'council' || tierId === 'elite') return 15;
  return 0;
}

export interface PropertyType {
  id: string;
  name: string;
  emoji: string;
  price: number;
  dailyBonus: number;
  sort: number;
}

/** Katalog default Republik Konoha (fallback sandbox; production membaca tabel property_types). */
export const DEFAULT_PROPERTY_CATALOG: PropertyType[] = [
  { id: 'gerobak_lapak', name: 'Gerobak / Lapak RT', emoji: '🛒', price: 80, dailyBonus: 5, sort: 1 },
  { id: 'warung_madura', name: 'Warung Madura Mini', emoji: '🏪', price: 150, dailyBonus: 12, sort: 2 },
  { id: 'rumah_kavling', name: 'Rumah Kavling RT', emoji: '🏠', price: 350, dailyBonus: 30, sort: 3 },
  { id: 'ruko_distrik', name: 'Ruko Distrik Kota', emoji: '🏬', price: 800, dailyBonus: 75, sort: 4 },
  { id: 'mansion_konglo', name: 'Mansion Konglomerat', emoji: '🏰', price: 2000, dailyBonus: 200, sort: 5 },
];

export type MissionKey = 'first_salary' | 'first_chat' | 'first_emote' | 'first_donation';

export interface MissionDef {
  key: MissionKey;
  title: string;
  reward: number;
  cta: string;
  emoji: string;
}

export const MISSIONS: MissionDef[] = [
  { key: 'first_salary', title: 'Klaim Gaji Harian pertamamu', reward: 30, cta: 'Ambil Gaji', emoji: '💰' },
  { key: 'first_chat', title: 'Sapa warga di Global Chat', reward: 30, cta: 'Buka Chat', emoji: '💬' },
  { key: 'first_emote', title: 'Pencet 1 Emote 3D di peta', reward: 20, cta: 'Pilih Emote', emoji: '😆' },
  { key: 'first_donation', title: 'Patungan min. 10 RpK ke Proyek Stasiun', reward: 40, cta: 'Patungan', emoji: '🚇' },
];

export interface MissionProgress {
  done: boolean;
  claimed: boolean;
}

const EMOTE_FLAG = 'nv:mission:first_emote';

export function markEmoteMissionDone(): void {
  try {
    localStorage.setItem(EMOTE_FLAG, '1');
  } catch {
    // abaikan
  }
}

function emoteDoneLocally(): boolean {
  try {
    return localStorage.getItem(EMOTE_FLAG) === '1';
  } catch {
    return false;
  }
}

/** Progres misi dari data warga (server memverifikasi ulang saat klaim). */
export function missionProgress(me: MyCitizen, totalDonatedAny: number): Record<MissionKey, MissionProgress> {
  const claimed = me.claimedMissions ?? {};
  const c = (k: MissionKey) => k in claimed;
  return {
    first_salary: { done: !!me.lastSalaryAt, claimed: c('first_salary') },
    first_chat: { done: !!me.lastChatAt, claimed: c('first_chat') },
    first_emote: { done: emoteDoneLocally(), claimed: c('first_emote') },
    first_donation: { done: totalDonatedAny >= 10 || me.totalDonated >= 10, claimed: c('first_donation') },
  };
}

export function isDonaturPerintis(me: Pick<MyCitizen, 'claimedMissions'>): boolean {
  return !!me.claimedMissions && 'first_donation' in me.claimedMissions;
}

/** Tanggal hari ini (WIB) "YYYY-MM-DD" — sama dengan (now() AT TIME ZONE 'Asia/Jakarta')::date. */
export function todayWib(now = Date.now()): string {
  return new Date(now + 7 * 3600_000).toISOString().slice(0, 10);
}

export interface EconomyStatus {
  salaryAt: number;
  salaryReady: boolean;
  quickUsedToday: number;
  quickLeft: number;
  quickAt: number;
  quickReady: boolean;
  missionsReady: number;
  missionsLeft: number;
}

export function economyStatus(me: MyCitizen, now = Date.now()): EconomyStatus {
  const salaryAt = me.lastSalaryAt ? new Date(me.lastSalaryAt).getTime() + SALARY_COOLDOWN_MS : 0;
  const quickUsedToday = me.quickWorkDate === todayWib(now) ? (me.quickWorkCount ?? 0) : 0;
  const quickLeft = Math.max(0, QUICK_WORK_MAX_PER_DAY - quickUsedToday);
  const quickAt = me.quickWorkAt ? new Date(me.quickWorkAt).getTime() + QUICK_WORK_COOLDOWN_MS : 0;
  const prog = missionProgress(me, me.totalDonated);
  const vals = Object.values(prog);
  return {
    salaryAt,
    salaryReady: salaryAt <= now,
    quickUsedToday,
    quickLeft,
    quickAt,
    quickReady: quickLeft > 0 && quickAt <= now,
    missionsReady: vals.filter((m) => m.done && !m.claimed).length,
    missionsLeft: vals.filter((m) => !m.claimed).length,
  };
}

/** Tahap pembangunan proyek berdasarkan persentase dana. */
export function projectPhase(pct: number): { label: string; emoji: string } {
  if (pct >= 100) return { label: 'Beroperasi!', emoji: '🚆' };
  if (pct >= 75) return { label: 'Finishing & Uji Coba', emoji: '🏗️' };
  if (pct >= 50) return { label: 'Rangka Baja', emoji: '🏗️' };
  if (pct >= 25) return { label: 'Pondasi', emoji: '🧱' };
  return { label: 'Lahan Kosong', emoji: '🚧' };
}

/** Label kolom PROPERTI di e-KTP: properti tertinggi + jumlah kavling peta. */
export function ktpPropertyLabel(me: Pick<MyCitizen, 'topProperty'>, ownedPlots: number): string {
  const top = me.topProperty?.trim();
  if (top && ownedPlots > 0) return `${top} +${ownedPlots} kavling`;
  if (top) return top;
  return ownedPlots > 0 ? `${ownedPlots} kavling` : 'Belum punya';
}
