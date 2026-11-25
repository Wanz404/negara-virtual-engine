import { containsProfanity } from './profanity';

/** "@Novi.Keren " → "novi.keren" */
export function normalizeIgUsername(raw: string): string {
  return (raw ?? '').trim().replace(/^@+|@+$/g, '').trim().toLowerCase();
}

/** Aturan identik dengan nv_assert_ig_username di SQL. Mengembalikan pesan error atau null. */
export function validateIgUsername(raw: string, officialHandle: string): string | null {
  const ig = normalizeIgUsername(raw);
  if (!ig) return 'Username Instagram wajib diisi.';
  if (!/^[a-z0-9._]{1,30}$/.test(ig)) return 'Username Instagram hanya boleh huruf, angka, titik, dan garis bawah (maks. 30).';
  if (ig.startsWith('.') || ig.endsWith('.')) return 'Username Instagram tidak boleh diawali/diakhiri titik.';
  if (ig.includes('..')) return 'Username Instagram tidak boleh berisi dua titik berturut-turut.';
  if (ig === officialHandle.toLowerCase()) return 'Gunakan akun Instagram pribadimu, bukan akun resmi negara.';
  if (containsProfanity(ig)) return 'Username mengandung kata yang tidak diizinkan.';
  return null;
}

const FORBIDDEN_NAME_CHARS = /[\u0000-\u001f\u007f<>{}[\]\\|`"]/;

/** Sanitasi spasi ganda; sama dengan SQL regexp_replace('\s+', ' '). */
export function cleanDisplayName(raw: string): string {
  return (raw ?? '').replace(/\s+/g, ' ').trim();
}

export function validateDisplayName(raw: string, maxLength: number): string | null {
  const name = cleanDisplayName(raw);
  if (!name) return null; // opsional → default ke username IG
  if ([...name].length > maxLength) return `Nama tampilan maksimal ${maxLength} karakter.`;
  if (FORBIDDEN_NAME_CHARS.test(name)) return 'Nama tampilan mengandung karakter yang tidak diizinkan.';
  if (containsProfanity(name)) return 'Nama tampilan mengandung kata yang tidak diizinkan.';
  return null;
}

export function validateFreeText(raw: string, maxLength: number, label: string): string | null {
  const text = cleanDisplayName(raw);
  if (!text) return `${label} tidak boleh kosong.`;
  if ([...text].length > maxLength) return `${label} maksimal ${maxLength} karakter.`;
  if (FORBIDDEN_NAME_CHARS.test(text)) return `${label} mengandung karakter yang tidak diizinkan.`;
  if (containsProfanity(text)) return `${label} mengandung kata yang tidak diizinkan.`;
  return null;
}

export function isHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

// ---------------------------------------------------------------------------
// Upgrade v2: Edit Profil & Global Chat (cermin update_citizen_profile / send_global_chat di SQL)
// ---------------------------------------------------------------------------

export const PROFILE_NAME_MIN = 2;
export const PROFILE_NAME_MAX = 24;
export const NAME_EDIT_COOLDOWN_MS = 24 * 60 * 60 * 1000;
export const CHAT_MAX_LENGTH = 140;
export const CHAT_COOLDOWN_MS = 4000;

const INVISIBLE_CHARS = /[​-‏‪-‮⁠-⁯﻿]/g;

/** Buang zero-width / bidi override lalu ciutkan spasi ganda. */
export function cleanProfileText(raw: string): string {
  return cleanDisplayName((raw ?? '').replace(INVISIBLE_CHARS, ''));
}

export function validateProfileName(raw: string): string | null {
  const name = cleanProfileText(raw);
  const len = [...name].length;
  if (len < PROFILE_NAME_MIN || len > PROFILE_NAME_MAX) return `Nama tampilan harus ${PROFILE_NAME_MIN}–${PROFILE_NAME_MAX} karakter.`;
  if (FORBIDDEN_NAME_CHARS.test(name)) return 'Nama tampilan mengandung karakter yang tidak diizinkan (tanpa < > { } [ ] \\ | ` ").';
  if (!/[A-Za-z0-9]/.test(name)) return 'Nama tampilan harus mengandung huruf atau angka.';
  if (containsProfanity(name)) return 'Nama tampilan mengandung kata yang tidak diizinkan.';
  return null;
}

export function validateChatText(raw: string, hasEmote: boolean): string | null {
  const text = cleanProfileText(raw);
  if (!text && !hasEmote) return 'Pesan tidak boleh kosong.';
  if ([...text].length > CHAT_MAX_LENGTH) return `Pesan maksimal ${CHAT_MAX_LENGTH} karakter.`;
  if (/[\u0000-\u001f\u007f<>]/.test(text)) return 'Pesan mengandung karakter yang tidak diizinkan.';
  if (text && containsProfanity(text)) return 'Pesan mengandung kata yang tidak diizinkan.';
  return null;
}
