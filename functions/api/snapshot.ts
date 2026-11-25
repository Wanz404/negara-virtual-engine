/**
 * GET /api/snapshot — perisai trafik read-only untuk data publik utama.
 *
 * Cloudflare Pages Function: menyatukan world_states + get_map_citizens (publik, p_me = null) + news_feed +
 * kavling ber-pemilik (land_plots, ring terbuka) jadi 1 JSON, lalu menyimpannya di Cache API edge selama 10 dtk.
 * Ribuan pengunjung bersamaan → ±1 batch query ke Supabase tiap 10 dtk per lokasi edge.
 *
 * Kredensial = URL + anon/publishable key yang memang sudah publik di bundle frontend; ditulis ke
 * ./_env.generated.ts oleh scripts/deploy-world.mjs saat deploy (file itu tidak di-commit).
 * Semua parameter query diabaikan → kunci cache tunggal, tidak bisa di-cache-bust dari luar.
 */
import { SUPABASE_ANON_KEY, SUPABASE_URL, WORLD_ID } from './_env.generated';

interface Ctx {
  request: Request;
  waitUntil(p: Promise<unknown>): void;
}

const EDGE_TTL = 10;
const SWR = 30;
const WORLD_COLUMNS =
  'world_id, ig_account_handle, last_citizen_number, day_number, ig_follower_count, followers_synced_at, current_ring_unlocked, active_project_id, active_project_funding, active_project_goal, active_project_completed, completed_projects, president_announcement, announcement_at, updated_at';
const PLOT_COLUMNS =
  'id, plot_code, ring_level, grid_x, grid_y, price, owner_citizen_id, owner_tag, owner_number, building_type, building_name, building_level, last_income_claim_at, purchased_at';

const sbHeaders = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, Accept: 'application/json' };

async function sb(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${SUPABASE_URL}${path}`, { ...init, headers: { ...sbHeaders, ...(init?.headers ?? {}) }, signal: AbortSignal.timeout(40_000) });
  if (!res.ok) throw new Error(`${path.split('?')[0]} → HTTP ${res.status}`);
  return res.json();
}

async function build(): Promise<Record<string, unknown>> {
  const w = encodeURIComponent(WORLD_ID);
  // Keempat query paralel (Supabase lambat → total waktu = query terlambat, bukan jumlahnya).
  const [worlds, citizens, news, owned] = await Promise.all([
    sb(`/rest/v1/world_states?select=${WORLD_COLUMNS}&world_id=eq.${w}&limit=1`),
    sb('/rest/v1/rpc/get_map_citizens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_world_id: WORLD_ID, p_me: null, p_limit: 120 }),
    }),
    sb(`/rest/v1/news_feed?select=id,category,message,citizen_id,created_at&world_id=eq.${w}&order=created_at.desc&limit=30`),
    sb(`/rest/v1/land_plots?select=${PLOT_COLUMNS}&world_id=eq.${w}&owner_citizen_id=not.is.null`),
  ]);
  const world = Array.isArray(worlds) ? (worlds[0] ?? null) : null;
  if (!world) throw new Error('world_states kosong');
  const plotRings = Array.from({ length: Math.max(1, Number(world.current_ring_unlocked) || 1) }, (_, i) => i + 1);
  const plots = (Array.isArray(owned) ? owned : []).filter((p: any) => plotRings.includes(Number(p.ring_level)));
  return { v: 1, generatedAt: new Date().toISOString(), world, citizens: citizens ?? [], news: news ?? [], plots, plotRings };
}

/** Salinan segar (10 dtk) + salinan cadangan (1 jam) + kunci refresh (20 dtk) di cache edge yang sama. */
const STALE_TTL = 3600;
const LOCK_TTL = 45;
function cached(body: string, ttl: number): Response {
  return new Response(body, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': `public, max-age=${ttl}` } });
}

function client(body: string, state: string): Response {
  return new Response(body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': `public, max-age=0, s-maxage=${EDGE_TTL}, stale-while-revalidate=${SWR}`,
      'Access-Control-Allow-Origin': '*',
      'X-Snapshot-Cache': state,
    },
  });
}

/** Build lalu tulis ke salinan segar & cadangan. (Workers melarang berbagi promise antar-request.) */
async function refresh(cache: Cache, freshKey: Request, staleKey: Request): Promise<string> {
  const body = JSON.stringify(await build());
  await Promise.all([cache.put(freshKey, cached(body, EDGE_TTL)), cache.put(staleKey, cached(body, STALE_TTL))]);
  return body;
}

export async function onRequestGet(ctx: Ctx): Promise<Response> {
  const cache = (caches as unknown as { default: Cache }).default;
  const base = new URL('/api/snapshot', ctx.request.url);
  const freshKey = new Request(base.toString());
  const staleKey = new Request(`${base}?v=stale`);
  const lockKey = new Request(`${base}?v=lock`);

  const fresh = await cache.match(freshKey);
  if (fresh) return client(await fresh.text(), 'HIT');

  const stale = await cache.match(staleKey);
  if (stale) {
    // Supabase lambat tidak boleh membuat pengunjung menunggu: sajikan cadangan, perbarui di belakang layar
    // (paling banyak 1 refresh per 45 dtk per lokasi edge berkat kunci di cache).
    if (!(await cache.match(lockKey))) {
      ctx.waitUntil(
        cache.put(lockKey, cached('1', LOCK_TTL)).then(() => refresh(cache, freshKey, staleKey)).catch(() => undefined),
      );
    }
    return client(await stale.text(), 'STALE');
  }

  // Cache kosong total: hanya 1 request per 45 dtk per lokasi edge yang boleh membangun dari Supabase.
  // Sisanya dijawab 503 instan (frontend lalu fallback seperti biasa) — edge TIDAK PERNAH melipatgandakan query.
  if (await cache.match(lockKey)) return warming();
  await cache.put(lockKey, cached('1', LOCK_TTL));
  const job = refresh(cache, freshKey, staleKey);
  ctx.waitUntil(job.catch(() => undefined)); // tetap selesai & mengisi cache walau pengunjung pertama sudah pergi
  try {
    return client(await job, 'MISS');
  } catch {
    return warming();
  }
}

function warming(): Response {
  return new Response(JSON.stringify({ error: 'snapshot warming' }), {
    status: 503,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Retry-After': '30' },
  });
}
