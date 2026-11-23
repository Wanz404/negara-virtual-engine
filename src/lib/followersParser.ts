/**
 * Parser daftar followers untuk fitur "Sync & Verifikasi Followers".
 *
 * Mendukung:
 *  1. Ekspor resmi Meta Accounts Center — `followers_1.json`:
 *       [{ "title": "", "string_list_data": [{ "href": "...", "value": "username", "timestamp": 1 }] }]
 *     Varian lain: `{ "relationships_followers": [...] }`, username di `title`, atau hanya di `href`.
 *  2. Array JSON sederhana: ["user1", "user2"] atau [{ "username": "user1" }].
 *  3. Teks biasa / CSV: satu username per baris (kolom pertama), boleh pakai '@'.
 */

const IG_RE = /^[a-z0-9._]{1,30}$/;

function clean(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let v = raw.trim();
  const fromUrl = v.match(/instagram\.com\/(?:_u\/)?([A-Za-z0-9._]{1,30})\/?/i);
  if (fromUrl) v = fromUrl[1];
  v = v.replace(/^@+/, '').replace(/^"+|"+$/g, '').trim().toLowerCase();
  return IG_RE.test(v) ? v : null;
}

function fromEntry(entry: unknown, out: Set<string>): void {
  if (typeof entry === 'string') {
    const v = clean(entry);
    if (v) out.add(v);
    return;
  }
  if (!entry || typeof entry !== 'object') return;
  const obj = entry as Record<string, unknown>;

  if (Array.isArray(obj.string_list_data)) {
    let found = false;
    for (const s of obj.string_list_data as Array<Record<string, unknown>>) {
      const v = clean(s?.value) ?? clean(s?.href);
      if (v) {
        out.add(v);
        found = true;
      }
    }
    if (!found) {
      const t = clean(obj.title);
      if (t) out.add(t);
    }
    return;
  }

  for (const key of ['username', 'ig_username', 'value', 'handle', 'title']) {
    const v = clean(obj[key]);
    if (v) {
      out.add(v);
      return;
    }
  }
}

export interface ParsedFollowers {
  usernames: string[];
  format: 'meta-json' | 'json-array' | 'text';
}

export function parseFollowersInput(text: string): ParsedFollowers {
  const trimmed = text.trim();
  const out = new Set<string>();

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const data: unknown = JSON.parse(trimmed);
      let list: unknown[] = [];
      let format: ParsedFollowers['format'] = 'json-array';
      if (Array.isArray(data)) {
        list = data;
        if (data.some((d) => d && typeof d === 'object' && 'string_list_data' in (d as object))) format = 'meta-json';
      } else if (data && typeof data === 'object') {
        const obj = data as Record<string, unknown>;
        const key = Object.keys(obj).find((k) => Array.isArray(obj[k]));
        if (key) list = obj[key] as unknown[];
        format = 'meta-json';
      }
      list.forEach((e) => fromEntry(e, out));
      return { usernames: [...out], format };
    } catch {
      // bukan JSON valid → anggap teks
    }
  }

  for (const line of trimmed.split(/\r?\n/)) {
    const first = line.split(/[,;\t]/)[0] ?? '';
    const v = clean(first);
    if (v && v !== 'username') out.add(v);
  }
  return { usernames: [...out], format: 'text' };
}
