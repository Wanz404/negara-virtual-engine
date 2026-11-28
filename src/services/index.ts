import { WORLD } from '../configs';
import { createSandboxAdapter, type SandboxApi } from './sandboxAdapter';
import { createSupabaseAdapter } from './supabaseAdapter';
import type { MyCitizen, NationApi, Session } from './types';

const env = import.meta.env;
const url = String(env.VITE_SUPABASE_URL ?? '').trim();
const anonKey = String(env.VITE_SUPABASE_ANON_KEY ?? '').trim();
const forceMock = String(env.VITE_DEV_MOCK_MODE ?? '').toLowerCase() === 'true';
const registerVia = String(env.VITE_REGISTER_VIA ?? 'edge').toLowerCase() === 'rpc' ? 'rpc' : 'edge';

/** Edge cache /api/snapshot hanya ada di build production Cloudflare Pages; `vite` dev selalu langsung ke Supabase. */
const snapshotUrl = env.PROD && String(env.VITE_SNAPSHOT_API ?? 'on').toLowerCase() !== 'off' ? '/api/snapshot' : null;

/** Fallback otomatis: env Supabase kosong → Mode Sandbox (localStorage). */
export const api: NationApi =
  !forceMock && url && anonKey ? createSupabaseAdapter(WORLD, { url, anonKey, registerVia, snapshotUrl }) : createSandboxAdapter(WORLD);

export const isSandbox = api.mode === 'sandbox';
export const sandboxApi: SandboxApi | null = isSandbox ? (api as SandboxApi) : null;

/** Dev tools (seed demo, simulasi worker) hanya di `npm run dev` atau VITE_DEV_MOCK_MODE=true. */
export const devToolsEnabled =
  isSandbox && (env.DEV || forceMock) && String(env.VITE_ENABLE_SANDBOX_SEED ?? 'true').toLowerCase() !== 'false';

export const turnstileSiteKey = String(env.VITE_TURNSTILE_SITE_KEY ?? '').trim();
export const turnstileRequired = !isSandbox && registerVia === 'edge' && turnstileSiteKey !== '';

// ---------------------------------------------------------------------------
// Sesi persisten (citizen_id + secret_token) di localStorage, per dunia & per mode
// ---------------------------------------------------------------------------

const SESSION_KEY = `nv:${WORLD.worldId}:${api.mode}:session`;

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    return s && typeof s.citizenId === 'string' && typeof s.token === 'string' ? s : null;
  } catch {
    return null;
  }
}

export function saveSession(session: Session | null): void {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // storage diblokir (mode privat IG in-app browser) → sesi hanya bertahan selama tab terbuka
  }
}

// ---------------------------------------------------------------------------
// Cache KTP lokal (stale-while-revalidate): KTP tampil instan saat buka/refresh,
// data server disegarkan diam-diam di latar belakang.
// ---------------------------------------------------------------------------

// v2 (28-11-2026): serah terima Wapres #0002 → #2552 + Pelantikan Gelombang 3 → abaikan KTP cache lama
// agar jabatan & status pelantikan baru langsung tampil. Sesi login TIDAK disentuh (kunci terpisah).
const ME_CACHE_KEY = `nv:${WORLD.worldId}:${api.mode}:me:v2`;
try {
  localStorage.removeItem(`nv:${WORLD.worldId}:${api.mode}:me`);
} catch {
  // storage diblokir
}

export interface CachedMe {
  me: MyCitizen;
  /** Kapan data ini terakhir dikonfirmasi server (ms epoch). */
  at: number;
}

export function loadCachedMe(citizenId: string | null | undefined): CachedMe | null {
  if (!citizenId) return null;
  try {
    const raw = localStorage.getItem(ME_CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as CachedMe;
    // Hanya milik sesi yang sedang login (ganti akun di perangkat yang sama → cache lama diabaikan).
    return c && c.me && c.me.id === citizenId && typeof c.at === 'number' ? c : null;
  } catch {
    return null;
  }
}

export function saveCachedMe(me: MyCitizen | null, at = Date.now()): void {
  try {
    if (me) localStorage.setItem(ME_CACHE_KEY, JSON.stringify({ me, at } satisfies CachedMe));
    else localStorage.removeItem(ME_CACHE_KEY);
  } catch {
    // storage diblokir → KTP tetap jalan, hanya tanpa cache instan
  }
}

/** Tag Tamu acak 3–4 karakter, stabil selama tab terbuka. */
export function guestTag(): string {
  const KEY = `nv:${WORLD.worldId}:guest`;
  try {
    const existing = sessionStorage.getItem(KEY);
    if (existing) return existing;
  } catch {
    // abaikan
  }
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const len = 3 + Math.floor(Math.random() * 2);
  const tag = Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  try {
    sessionStorage.setItem(KEY, tag);
  } catch {
    // abaikan
  }
  return tag;
}

export * from './types';
