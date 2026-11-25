import type { EmoteKey } from '../services/types';

export interface EmoteDef {
  key: EmoteKey;
  label: string;
  /** Fallback bila gambar WebP/PNG belum ada / gagal dimuat. */
  emoji: string;
}

/** Urutan tampil di Emote Picker. Gambar: public/assets/emotes/emote-<key>.webp (hasil scripts/process-emotes.py). */
export const EMOTES: EmoteDef[] = [
  { key: 'laugh', label: 'Ngakak', emoji: '😂' },
  { key: 'cry', label: 'Nangis', emoji: '😭' },
  { key: 'salute', label: 'Hormat', emoji: '🫡' },
  { key: 'fire', label: 'Membara', emoji: '🔥' },
  { key: 'coin', label: 'Sultan', emoji: '🪙' },
  { key: 'angry', label: 'Marah', emoji: '😡' },
];

export const EMOTE_KEYS = EMOTES.map((e) => e.key);
export const EMOTE_COOLDOWN_MS = 2500;
export const EMOTE_DURATION_MS = 3000;

export function isEmoteKey(v: unknown): v is EmoteKey {
  return typeof v === 'string' && (EMOTE_KEYS as string[]).includes(v);
}

export function emoteDef(key: EmoteKey): EmoteDef {
  return EMOTES.find((e) => e.key === key) ?? EMOTES[0];
}

export function emoteSrc(key: EmoteKey, ext: 'webp' | 'png' = 'webp'): string {
  return `${import.meta.env.BASE_URL}assets/emotes/emote-${key}.${ext}`;
}

// ---------------------------------------------------------------------------
// Cache gambar untuk kanvas peta (WebP → PNG → null/emoji)
// ---------------------------------------------------------------------------
const cache = new Map<EmoteKey, HTMLImageElement | null>();

/** Mengembalikan gambar yang SUDAH siap digambar, atau null (sedang dimuat / tidak ada → pakai emoji). */
export function emoteImage(key: EmoteKey): HTMLImageElement | null {
  if (cache.has(key)) {
    const img = cache.get(key) ?? null;
    return img && img.complete && img.naturalWidth > 0 ? img : null;
  }
  if (typeof Image === 'undefined') return null;
  const img = new Image();
  img.decoding = 'async';
  let triedPng = false;
  img.onerror = () => {
    if (!triedPng) {
      triedPng = true;
      img.src = emoteSrc(key, 'png');
    } else cache.set(key, null);
  };
  img.src = emoteSrc(key, 'webp');
  cache.set(key, img);
  return null;
}

/** Panaskan cache (dipanggil saat app mulai agar emote pertama langsung tampil). */
export function preloadEmotes(): void {
  EMOTE_KEYS.forEach((k) => emoteImage(k));
}
