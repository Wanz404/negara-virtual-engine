// Supabase Edge Function (Deno): pendaftaran warga ber-Turnstile + rate-limit IP.
//
// Deploy:
//   supabase functions deploy register-citizen --no-verify-jwt
//   supabase secrets set TURNSTILE_SECRET_KEY=0x... IP_HASH_SALT=$(openssl rand -hex 16)
//
// SUPABASE_URL & SUPABASE_SERVICE_ROLE_KEY sudah tersedia otomatis di runtime Edge Functions.
// Alur: verifikasi token Turnstile → hash IP (SHA-256 + salt, IP mentah tidak disimpan) →
//       RPC register_citizen_atomic (service_role) yang mengunci counter dunia (strict FCFS).

import { createClient } from 'npm:@supabase/supabase-js@2.58.0';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function verifyTurnstile(secret: string, token: string, ip: string | null): Promise<boolean> {
  const form = new FormData();
  form.append('secret', secret);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
  if (!res.ok) return false;
  const data = (await res.json()) as { success?: boolean };
  return data.success === true;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Body harus JSON.' }, 400);
  }

  const worldId = String(body.worldId ?? '');
  const igUsername = String(body.igUsername ?? '');
  const username = String(body.username ?? '');
  const avatarColor = String(body.avatarColor ?? '#ef4444');
  const avatarStyle = body.avatarStyle && typeof body.avatarStyle === 'object' ? body.avatarStyle : {};
  const turnstileToken = String(body.turnstileToken ?? '');

  if (!/^[a-z0-9-]{2,40}$/.test(worldId)) return json({ error: 'world_id tidak valid.' }, 400);

  const ip =
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-real-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    null;

  // Satu atau beberapa secret (dipisah koma) bila 10 domain memakai lebih dari satu widget Turnstile.
  const turnstileSecrets = (Deno.env.get('TURNSTILE_SECRET_KEY') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (turnstileSecrets.length > 0) {
    if (!turnstileToken) return json({ error: 'Verifikasi anti-bot belum selesai. Coba lagi.' }, 400);
    let ok = false;
    for (const secret of turnstileSecrets) {
      if (await verifyTurnstile(secret, turnstileToken, ip)) {
        ok = true;
        break;
      }
    }
    if (!ok) return json({ error: 'Verifikasi anti-bot gagal. Muat ulang halaman lalu coba lagi.' }, 403);
  }

  const salt = Deno.env.get('IP_HASH_SALT') ?? 'negara-virtual';
  const ipHash = ip ? await sha256Hex(`${ip}:${worldId}:${salt}`) : null;

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });

  const { data, error } = await supabase.rpc('register_citizen_atomic', {
    p_world_id: worldId,
    p_username: username,
    p_ig_username: igUsername,
    p_avatar_color: avatarColor,
    p_ip_hash: ipHash,
    p_avatar_style: avatarStyle,
  });

  if (error) return json({ error: error.message }, 400);
  return json({ citizen: data });
});
