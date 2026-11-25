#!/usr/bin/env node
/**
 * Deploy 1 / beberapa / semua dunia ke Cloudflare Pages lewat Wrangler CLI.
 *
 *   npm run deploy:pilot                       → republik-konoha
 *   npm run deploy:world -- pt-virtual         → dunia tertentu (boleh lebih dari satu)
 *   npm run deploy:all                         → 10 dunia berurutan
 *
 * Membaca VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_TURNSTILE_SITE_KEY dari .env.production.local
 * (atau env shell). Menolak deploy bila build masih Mode Sandbox (env Supabase kosong) — production wajib
 * mulai dari 0 warga asli di Supabase, bukan localStorage.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WRANGLER = 'wrangler@4.166.0';

/** world_id → nama proyek Cloudflare Pages (= subdomain *.pages.dev). Harus sama dengan `domain` di config dunia. */
const PROJECTS = {
  'republik-konoha': 'republikkonoha',
  'pt-virtual': 'ptvirtual',
  'kampus-virtual': 'kampusvirtual',
  'kampung-mistis': 'kampungmistis',
  'kerajaan-nusantara': 'kerajaannusantara',
  'guild-petualang': 'guildisekai',
  'kota-mafia': 'kotamafia',
  'pulau-penjara': 'pulaupenjara',
  'koloni-mars': 'kolonimars',
  'kerajaan-kucing': 'kerajaankucing',
};

function fail(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

function loadEnvFile(file) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

function run(cmd, args, env, capture = false) {
  const res = spawnSync(cmd, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: capture ? ['inherit', 'pipe', 'pipe'] : 'inherit',
    shell: process.platform === 'win32',
    encoding: 'utf8',
  });
  if (capture) {
    if (res.stdout) process.stdout.write(res.stdout);
    if (res.stderr) process.stderr.write(res.stderr);
  }
  return { code: res.status ?? 1, out: `${res.stdout ?? ''}\n${res.stderr ?? ''}` };
}

/** Wrangler versi baru bisa menulis wrangler.jsonc / mengubah vite.config.ts. Hentikan bila itu terjadi. */
function assertUntouched() {
  const touched = ['wrangler.jsonc', 'wrangler.toml', 'wrangler.json'].filter((f) => existsSync(join(root, f)));
  const vite = readFileSync(join(root, 'vite.config.ts'), 'utf8');
  if (touched.length || vite.includes('@cloudflare/vite-plugin')) {
    fail(
      `Wrangler mengubah file proyek (${[...touched, vite.includes('@cloudflare/vite-plugin') ? 'vite.config.ts' : ''].filter(Boolean).join(', ')}). ` +
        'Kembalikan dengan `git checkout -- . && git clean -f wrangler.jsonc`, lalu ulangi.',
    );
  }
}

function configDomain(worldId) {
  const file = join(root, 'src', 'configs', 'worlds', `${worldId}.ts`);
  const m = /domain:\s*'([^']+)'/.exec(readFileSync(file, 'utf8'));
  return m?.[1] ?? null;
}

// ---- Argumen ----
const args = process.argv.slice(2);
const worlds = args.includes('--all') ? Object.keys(PROJECTS) : args.filter((a) => !a.startsWith('-'));
if (worlds.length === 0) fail('Sebutkan world_id, mis. `npm run deploy:world -- pt-virtual`, atau pakai --all.');
const unknown = worlds.filter((w) => !PROJECTS[w]);
if (unknown.length) fail(`world_id tidak dikenal: ${unknown.join(', ')}. Pilihan: ${Object.keys(PROJECTS).join(', ')}`);

// ---- Env production ----
const env = { ...loadEnvFile(join(root, '.env.production.local')), ...pick(process.env) };
function pick(e) {
  const o = {};
  for (const k of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'VITE_TURNSTILE_SITE_KEY', 'VITE_REGISTER_VIA']) if (e[k]) o[k] = e[k];
  return o;
}
const url = env.VITE_SUPABASE_URL ?? '';
const anon = env.VITE_SUPABASE_ANON_KEY ?? '';
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url)) fail('VITE_SUPABASE_URL belum diisi dengan benar di .env.production.local (format https://<ref>.supabase.co).');
if (/^sb_secret_/i.test(anon)) fail('Key yang diisi adalah SECRET key (sb_secret_…)! Itu rahasia — pakai publishable key (sb_publishable_…).');
for (const [k, v] of Object.entries(env)) if (/^(YOUR_|TEMPEL_)/.test(v ?? '')) fail(`${k} masih berisi placeholder di .env.production.local.`);
if (!anon || anon.length < 40) fail('VITE_SUPABASE_ANON_KEY belum diisi di .env.production.local (pakai anon/publishable key, BUKAN service_role).');
if (/service_role/.test(Buffer.from(anon.split('.')[1] ?? '', 'base64').toString('utf8'))) fail('Key yang diisi adalah service_role! Itu rahasia — pakai anon key.');
if (!env.VITE_TURNSTILE_SITE_KEY) console.warn('⚠ VITE_TURNSTILE_SITE_KEY kosong: form daftar tanpa anti-bot. Edge Function akan menolak bila TURNSTILE_SECRET_KEY di-set.');

const buildEnv = {
  VITE_SUPABASE_URL: url.replace(/\/$/, ''),
  VITE_SUPABASE_ANON_KEY: anon,
  VITE_TURNSTILE_SITE_KEY: env.VITE_TURNSTILE_SITE_KEY ?? '',
  VITE_REGISTER_VIA: env.VITE_REGISTER_VIA ?? 'edge',
  VITE_DEV_MOCK_MODE: 'false',
  VITE_ENABLE_SANDBOX_SEED: 'false',
};

const results = [];
for (const worldId of worlds) {
  const project = PROJECTS[worldId];
  const expected = configDomain(worldId);
  console.log(`\n━━━ ${worldId} → Cloudflare Pages "${project}" ━━━`);
  if (expected !== `${project}.pages.dev`) console.warn(`⚠ domain di config (${expected}) ≠ ${project}.pages.dev — KTP & footer memakai nilai config.`);

  // 1) Build production (tsc + vite) untuk dunia ini
  const b = run('npm', ['run', 'build'], { ...buildEnv, VITE_WORLD_ID: worldId });
  if (b.code !== 0) fail(`Build ${worldId} gagal.`);

  // 2) Pengaman: bundle wajib terhubung ke Supabase (bukan Mode Sandbox)
  const assets = join(root, 'dist', 'assets');
  const js = readdirSync(assets).filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(assets, f), 'utf8')).join('\n');
  if (!js.includes(buildEnv.VITE_SUPABASE_URL)) fail(`Bundle ${worldId} tidak memuat URL Supabase → akan jalan di Mode Sandbox. Deploy dibatalkan.`);

  // 3) Pastikan proyek Pages ada (buat bila belum)
  // --force: buat di Cloudflare Pages klasik (*.pages.dev + _redirects). Tanpa itu Wrangler 4.16x mengalihkan ke
  // "Pages di atas Workers" yang mengubah vite.config/package.json otomatis & menolak _redirects SPA.
  const c = run('npx', ['-y', WRANGLER, 'pages', 'project', 'create', project, '--production-branch=main', '--force'], {}, true);
  assertUntouched();
  if (c.code !== 0 && !/already exists|8000002/i.test(c.out)) {
    if (/not logged in|authentication|login|CLOUDFLARE_API_TOKEN/i.test(c.out))
      fail('Wrangler belum login. Jalankan `npx wrangler login` di terminal (setujui di browser), atau set CLOUDFLARE_API_TOKEN.');
    fail(`Gagal membuat proyek Pages "${project}".`);
  }

  // 3b) Kredensial publik untuk Pages Function /api/snapshot (edge cache). Anon/publishable key memang sudah ada di
  // bundle frontend; file ini di-.gitignore dan ditulis ulang tiap deploy agar selalu cocok dengan dunia yang dideploy.
  writeFileSync(
    join(root, 'functions', 'api', '_env.generated.ts'),
    `// AUTO-GENERATED oleh scripts/deploy-world.mjs — jangan di-commit.
` +
      `export const SUPABASE_URL = ${JSON.stringify(buildEnv.VITE_SUPABASE_URL)};
` +
      `export const SUPABASE_ANON_KEY = ${JSON.stringify(anon)};
` +
      `export const WORLD_ID = ${JSON.stringify(worldId)};
`,
  );

  // 4) Deploy (folder ./functions ikut di-bundle Wrangler sebagai Pages Functions)
  const d = run('npx', ['-y', WRANGLER, 'pages', 'deploy', 'dist', `--project-name=${project}`, '--branch=main', '--commit-dirty=true'], {}, true);
  assertUntouched();
  if (d.code !== 0) fail(`Deploy ${worldId} gagal.`);
  const urls = [...new Set(d.out.match(/https:\/\/[a-z0-9.-]+\.pages\.dev/gi) ?? [])];
  results.push({ worldId, project, expected, urls });
}

console.log('\n✅ Selesai');
for (const r of results) {
  console.log(`  • ${r.worldId}: https://${r.project}.pages.dev  (deployment: ${r.urls.join(', ') || '-'})`);
}
console.log(
  '\nCatatan: bila subdomain *.pages.dev sudah dipakai orang lain, Cloudflare memberi subdomain lain.\n' +
    'Cek `npx wrangler pages project list`, lalu samakan `domain` di src/configs/worlds/<id>.ts + hostname Turnstile.',
);
