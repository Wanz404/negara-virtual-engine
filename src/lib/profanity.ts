import rawWords from './profanity-words.json';

/**
 * Normalisasi identik dengan fungsi SQL `nv_normalize_filter`:
 * lowercase → ganti leetspeak (0→o, 1→i, 3→e, 4→a, 5→s, 7→t, 8→b, @→a, $→s, !→i)
 * → buang semua non a-z → ciutkan huruf berulang ("anjjjing" → "anjing").
 */
export function normalizeForFilter(text: string): string {
  const from = '0134578@$!';
  const to = 'oieastbasi';
  let out = '';
  for (const ch of (text ?? '').toLowerCase()) {
    const i = from.indexOf(ch);
    out += i >= 0 ? to[i] : ch;
  }
  return out.replace(/[^a-z]/g, '').replace(/(.)\1+/g, '$1');
}

/** Daftar kata yang sudah dinormalisasi (sama persis dengan isi tabel `profanity_words`). */
export const PROFANITY_WORDS: string[] = Array.from(new Set((rawWords as string[]).map(normalizeForFilter))).filter(
  (w) => w.length >= 3,
);

export function containsProfanity(text: string): boolean {
  const n = normalizeForFilter(text);
  if (!n) return false;
  return PROFANITY_WORDS.some((w) => n.includes(w));
}
