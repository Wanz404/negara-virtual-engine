/**
 * Uji migrasi + seed di Postgres WASM (PGlite), tanpa perlu akun Supabase.
 *   npm run test:db
 *
 * Mencakup: strict FCFS tanpa nomor lompat, validasi IG, rate-limit IP, verifikasi follow batch,
 * ganti IG / cek ulang, kerja, tanah & properti, proyek nasional, voting, pemakzulan, ekspansi ring,
 * keamanan kolom (anon tidak bisa baca secret_token), serta paritas aturan TypeScript ↔ SQL.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { WORLDS } from '../src/configs/registry';
import { generateRingPlots, resolveTier, resolveTitle, ringsForPopulation, rtRwAddress, ktpCode } from '../src/lib/game';
import { normalizeForFilter } from '../src/lib/profanity';
import { buildSeedSql } from './generate-seed';
import { Geometry } from '../src/engine/geometry';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const W = 'republik-konoha';

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}`, detail ?? '');
  }
}

const db = await PGlite.create({ extensions: { pgcrypto } });

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  const r = await db.query<T>(sql, params);
  return r.rows[0];
}

async function rpc(fn: string, args: unknown[]): Promise<any> {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(', ');
  const row = await one<{ r: unknown }>(`SELECT public.${fn}(${placeholders}) AS r`, args);
  return row.r;
}

async function expectError(name: string, p: Promise<unknown>, contains: string): Promise<void> {
  try {
    await p;
    check(name, false, 'tidak error');
  } catch (e) {
    const msg = (e as Error).message;
    check(name, msg.includes(contains), msg);
  }
}

async function register(ig: string, name = '', ip: string | null = null): Promise<any> {
  return rpc('register_citizen_atomic', [W, name, ig, '#ef4444', ip, '{}']);
}

console.log('\n▶ Setup: roles Supabase, migrasi, seed');
await db.exec(`
  DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
  END $$;
  GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
`);
await db.exec(readFileSync(resolve(root, 'supabase/migrations/001_init.sql'), 'utf8'));
await db.exec(readFileSync(resolve(root, 'supabase/migrations/002_worker_checks.sql'), 'utf8'));
await db.exec(buildSeedSql(Object.values(WORLDS)));
const upgradeV2 = readFileSync(resolve(root, 'supabase/migrations/upgrade_v2_social_ux.sql'), 'utf8');
await db.exec(upgradeV2);
const upgradeV3 = readFileSync(resolve(root, 'supabase/migrations/upgrade_v3_economy_ux.sql'), 'utf8');
await db.exec(upgradeV3);
const worldCount = await one<{ n: number }>('SELECT count(*)::int AS n FROM world_states');
check('10 dunia ter-seed', worldCount.n === 10, worldCount);
const zero = await one<{ n: number }>('SELECT count(*)::int AS n FROM citizens');
check('Production mulai dari 0 warga', zero.n === 0, zero);
const plots1 = await one<{ n: number }>(`SELECT count(*)::int AS n FROM land_plots WHERE world_id = $1`, [W]);
check('Kavling Ring 1 dibuat (72 kavling)', plots1.n === 72, plots1);

console.log('\n▶ Strict FCFS');
const c1 = await register('Novi', 'Novi', 'ipA');
const c2 = await register('@budi_02', 'Budi');
const c3 = await register('siti.k', '');
check('#1 = Presiden', c1.citizen_number === 1 && c1.role_title === 'Presiden Republik Konoha', c1);
check('#2 = Wakil Presiden', c2.citizen_number === 2 && c2.role_title === 'Wakil Presiden Konoha', c2.role_title);
check('#3 = Menteri Keuangan', c3.citizen_number === 3 && c3.role_title === 'Menteri Keuangan', c3.role_title);
check('IG disimpan lowercase tanpa @', c2.ig_username === 'budi_02' && c1.ig_username === 'novi');
check('Nama kosong → default username IG', c3.username === 'siti.k', c3.username);
check('Kode KTP RK-0001', c1.ktp_code === 'RK-0001', c1.ktp_code);
check('Alamat RT/RW', c1.rt_rw_address === 'RT 01 / RW 01 • Ring 1', c1.rt_rw_address);
check('secret_token dikembalikan ke pendaftar', typeof c1.secret_token === 'string' && c1.secret_token.length === 36);
check('ip_hash tidak bocor di respons', !('ip_hash' in c1));

await expectError('Username IG duplikat ditolak', register('NOVI'), 'sudah terdaftar');
await expectError('Format IG tidak valid ditolak', register('novi keren!'), 'hanya boleh');
await expectError('IG diakhiri titik ditolak', register('novi.'), 'titik');
await expectError('Akun resmi negara ditolak', register('@RepublikKonoha'), 'akun resmi');
await expectError('Kata kasar di nama ditolak', register('orangbaik', 'b4ngs4t'), 'tidak diizinkan');
await expectError('Kata kasar di IG ditolak', register('anjjjing_lucu'), 'tidak diizinkan');
await expectError('Karakter terlarang di nama ditolak', register('orangbaik2', '<script>'), 'karakter');
const c4 = await register('orang_keempat');
check('Gagal daftar TIDAK membuat nomor lompat (#4)', c4.citizen_number === 4, c4.citizen_number);
check('Counter = 4', (await one<{ n: number }>('SELECT last_citizen_number AS n FROM world_states WHERE world_id = $1', [W])).n === 4);

await register('ip_user_2', '', 'ipA');
await expectError('Rate-limit IP (maks. 2 / 24 jam)', register('ip_user_3', '', 'ipA'), 'Batas pendaftaran');
const c6 = await register('setelah_limit');
check('Nomor tetap berurutan setelah rate-limit (#6)', c6.citizen_number === 6, c6.citizen_number);

console.log('\n▶ Keamanan & hak akses (role anon)');
await db.exec('SET ROLE anon');
await expectError('anon tidak bisa SELECT secret_token', db.query('SELECT secret_token FROM citizens'), 'permission denied');
await expectError('anon tidak bisa SELECT ip_hash', db.query('SELECT ip_hash FROM citizens'), 'permission denied');
const pub = await db.query('SELECT id, citizen_number, ig_username FROM citizens');
check('anon bisa SELECT kolom publik', pub.rows.length === 6);
await expectError('anon tidak bisa INSERT warga langsung', db.query(`INSERT INTO citizens (world_id, citizen_number, ktp_code, username, ig_username, tier_id, role_title) VALUES ('${W}', 99, 'X', 'x', 'x', 'x', 'x')`), 'permission denied');
await expectError('anon tidak bisa UPDATE counter', db.query(`UPDATE world_states SET last_citizen_number = 0`), 'permission denied');
await expectError('anon tidak bisa panggil register_citizen_atomic', db.query(`SELECT register_citizen_atomic('${W}', '', 'hacker', '#000000', NULL, '{}')`), 'permission denied');
await expectError('anon tidak bisa panggil helper nv_*', db.query(`SELECT nv_ensure_plots('${W}', 9)`), 'permission denied');
await expectError('Jalur direct nonaktif secara default', db.query(`SELECT register_citizen_direct('${W}', '', 'langsung', '#000000', '{}')`), 'dinonaktifkan');
await expectError('anon tidak bisa baca world_secrets', db.query('SELECT * FROM world_secrets'), 'permission denied');
await expectError('anon tidak bisa baca poll_votes', db.query('SELECT * FROM poll_votes'), 'permission denied');
await db.exec('RESET ROLE');

console.log('\n▶ Sesi & pemulihan');
const me = await rpc('get_my_citizen', [W, c1.id, c1.secret_token]);
check('get_my_citizen dengan token benar', me.citizen_number === 1 && me.has_recovery_pin === false);
await expectError('Token salah ditolak', rpc('get_my_citizen', [W, c1.id, c2.secret_token]), 'Sesi warga tidak valid');
await rpc('set_recovery_pin', [W, c1.id, c1.secret_token, '1234']);
const rec = await rpc('recover_session', [W, 'rk-0001', '1234']);
check('Pulihkan sesi via KTP + PIN', rec.ok === true && rec.secret_token === c1.secret_token, rec);
const bad = await rpc('recover_session', [W, 'RK-0001', '0000']);
check('PIN salah → ok:false + sisa percobaan', bad.ok === false && String(bad.error).includes('Sisa 4'), bad);
for (let i = 0; i < 4; i++) await rpc('recover_session', [W, 'RK-0001', '0000']);
const locked = await rpc('recover_session', [W, 'RK-0001', '1234']);
check('Terkunci setelah 5x salah (PIN benar pun ditolak)', locked.ok === false && String(locked.error).includes('Terlalu banyak'), locked);

console.log('\n▶ Admin & verifikasi follow 1x24 jam');
await db.query(`SELECT set_world_secrets($1, 'pin-admin-rahasia', 'sync-secret-worker-123456')`, [W]);
check('Admin PIN salah → ok:false', (await rpc('admin_login', [W, 'salah'])).ok === false);
check('Admin PIN benar → ok:true', (await rpc('admin_login', [W, 'pin-admin-rahasia'])).ok === true);
const queue = await rpc('admin_get_follow_queue', [W, 'sync-secret-worker-123456']);
check('Worker (sync secret) bisa ambil antrean', queue.ok === true && queue.usernames.length === 6, queue);
await expectError('Sync secret tidak bisa dipakai untuk admin_login-only', Promise.resolve(rpc('admin_login', [W, 'sync-secret-worker-123456'])).then((r) => { if (!r.ok) throw new Error('ditolak'); }), 'ditolak');

const lateIg = await register('daftar_telat');
const v = await rpc('batch_verify_followers', [W, 'pin-admin-rahasia', ['NOVI', '@siti.k', 'orang_lain'], 168121, queue.snapshot_at, false]);
check('Batch verify: 2 verified', v.verified === 2, v);
check('Batch verify: sisa antrean (≤ snapshot) → not_following', v.not_following === 4, v);
const late = await one<{ follow_status: string }>('SELECT follow_status FROM citizens WHERE id = $1', [lateIg.id]);
check('Pendaftar SETELAH snapshot tidak salah ditandai', late.follow_status === 'pending', late);
const ws = await one<{ ig_follower_count: number; followers_synced_at: string | null }>('SELECT ig_follower_count, followers_synced_at FROM world_states WHERE world_id = $1', [W]);
check('Follower count & timestamp sinkron', ws.ig_follower_count === 168121 && ws.followers_synced_at !== null, ws);

await expectError('Cek ulang ditolak bila sudah verified', rpc('request_follow_recheck', [W, c1.id, c1.secret_token]), 'sudah terverifikasi');
const rq = await rpc('request_follow_recheck', [W, c2.id, c2.secret_token]);
check('Cek Ulang → recheck_requested', rq.follow_status === 'recheck_requested', rq.follow_status);
await expectError('Cek Ulang kena cooldown', rpc('request_follow_recheck', [W, c2.id, c2.secret_token]), 'Coba lagi');
await expectError('Ganti IG ke username yang dipakai orang lain ditolak', rpc('update_citizen_instagram', [W, c4.id, c4.secret_token, 'novi']), 'sudah dipakai');
const gi = await rpc('update_citizen_instagram', [W, c4.id, c4.secret_token, '@Orang.Ke4']);
check('Ganti Instagram → ig baru & status pending', gi.ig_username === 'orang.ke4' && gi.follow_status === 'pending', gi);
await expectError('Ganti IG kena cooldown', rpc('update_citizen_instagram', [W, c4.id, c4.secret_token, 'orang.ke44']), 'Coba lagi');

console.log('\n▶ Aktivitas & ekonomi');
const w1 = await rpc('claim_work_reward', [W, c1.id, c1.secret_token]);
check('Presiden kerja +60 (Tanda Tangan Keppres)', w1.reward === 60 && w1.label === 'Tanda Tangan Keppres' && w1.coins === 80, w1);
await expectError('Kerja kena cooldown', rpc('claim_work_reward', [W, c1.id, c1.secret_token]), 'Masih capek');
const st = await rpc('post_status', [W, c1.id, c1.secret_token, '  Halo   rakyat Konoha!  ']);
check('Update status (spasi dirapikan)', st.status_text === 'Halo rakyat Konoha!', st.status_text);
await expectError('Status > 50 karakter ditolak', rpc('post_status', [W, c3.id, c3.secret_token, 'x'.repeat(51)]), 'maksimal');

await expectError('Warga pending tidak bisa beli tanah', rpc('buy_land_plot', [W, c4.id, c4.secret_token, 'R1-A001']), 'resmi dilantik');
await expectError('Warga not_following tidak bisa beli tanah', rpc('buy_land_plot', [W, c6.id, c6.secret_token, 'R1-A001']), 'belum terdeteksi follow');
await expectError('Saldo kurang ditolak', rpc('buy_land_plot', [W, c1.id, c1.secret_token, 'R1-A001']), 'Saldo kurang');
await db.query('UPDATE citizens SET coins = 5000 WHERE id = ANY($1)', [[c1.id, c3.id]]);
const plot = await one<{ price: number }>('SELECT price FROM land_plots WHERE world_id = $1 AND plot_code = $2', [W, 'R1-A001']);
const buy = await rpc('buy_land_plot', [W, c1.id, c1.secret_token, 'r1-a001']);
check('Beli kavling R1-A001 (diskon presiden 10%)', buy.plot.owner_tag === 'Novi | 001' && buy.price === Math.floor((plot.price * 90) / 100), buy);
await expectError('Kavling milik orang lain tidak bisa dibeli', rpc('buy_land_plot', [W, c3.id, c3.secret_token, 'R1-A001']), 'sudah dimiliki');
const b1 = await rpc('build_or_upgrade_property', [W, c1.id, c1.secret_token, 'R1-A001', 'warung_kelontong', 'Warung Bu Novi']);
check('Bangun Warung Kelontong Lv1 (200)', b1.plot.building_level === 1 && b1.cost === 200 && b1.plot.building_name === 'Warung Bu Novi', b1);
const b2 = await rpc('build_or_upgrade_property', [W, c1.id, c1.secret_token, 'R1-A001', null, null]);
check('Upgrade Lv2 (biaya 200×1.6 = 320)', b2.plot.building_level === 2 && b2.cost === 320, b2);
await rpc('buy_land_plot', [W, c3.id, c3.secret_token, 'R1-A002']);
await expectError('Menteri boleh, tapi nama bangunan kasar ditolak', rpc('build_or_upgrade_property', [W, c3.id, c3.secret_token, 'R1-A002', 'pos_ronda', 'Pos Kontol']), 'tidak diizinkan');
const gov = await rpc('build_or_upgrade_property', [W, c3.id, c3.secret_token, 'R1-A002', 'pos_ronda', 'Pos Ronda Siti']);
check('Menteri boleh bangun gedung pemerintahan', gov.plot.building_type === 'pos_ronda', gov.plot);
await db.query(`UPDATE land_plots SET last_income_claim_at = now() - interval '12 hours' WHERE world_id = $1 AND plot_code = 'R1-A001'`, [W]);
const inc = await rpc('claim_property_income', [W, c1.id, c1.secret_token, null]);
check('Klaim pendapatan pasif 12 jam (22×2×0.5×1.2 = 26)', inc.total === 26, inc);
await expectError('Klaim lagi langsung → belum ada', rpc('claim_property_income', [W, c1.id, c1.secret_token, 'R1-A001']), 'Belum ada');

console.log('\n▶ Proyek nasional');
await db.query('UPDATE citizens SET coins = 60000 WHERE id = $1', [c1.id]);
const d1 = await rpc('donate_to_project', [W, c1.id, c1.secret_token, 1000]);
check('Donasi tercatat di funding', d1.world.active_project_funding === 1000 && d1.completed_project_id === null, d1.world);
const d2 = await rpc('donate_to_project', [W, c1.id, c1.secret_token, 49500]);
check('MRT selesai → lanjut Tol Layang (overflow terbawa)', d2.completed_project_id === 'mrt_konoha' && d2.world.active_project_id === 'tol_layang' && d2.world.active_project_funding === 500, d2.world);
const donors = await rpc('get_project_top_donors', [W, 'mrt_konoha', 3]);
check('Top penyumbang MRT', donors[0]?.tag === 'Novi | 001' && Number(donors[0]?.amount) === 50500, donors);

console.log('\n▶ Pemerintahan & Sidang Warga');
const ann = await rpc('post_announcement', [W, c1.id, c1.secret_token, 'Mulai hari ini, gorengan gratis!']);
check('Presiden berpidato', ann.president_announcement === 'Mulai hari ini, gorengan gratis!');
await expectError('Menteri tidak bisa pidato', rpc('post_announcement', [W, c3.id, c3.secret_token, 'Halo']), 'Hanya Presiden');
const poll = await rpc('propose_poll', [W, c1.id, c1.secret_token, 'Warna Tugu Konoha?', ['Pink', 'Hijau Neon']]);
check('Poll Presiden langsung aktif', poll.status === 'active' && poll.options.length === 2, poll);
const poll2 = await rpc('propose_poll', [W, c3.id, c3.secret_token, 'Diskon tanah 20% hari ini?', ['Setuju', 'Tolak']]);
check('Poll Menteri masuk moderasi (pending)', poll2.status === 'pending', poll2.status);
const vote = await rpc('cast_poll_vote', [W, c3.id, c3.secret_token, poll.id, 'a']);
check('Vote tercatat', vote.total_votes === 1 && vote.my_vote === 'a', vote);
await expectError('Vote dua kali ditolak', rpc('cast_poll_vote', [W, c3.id, c3.secret_token, poll.id, 'b']), 'sudah memberikan suara');
await expectError('Warga not_following tidak bisa vote', rpc('cast_poll_vote', [W, c6.id, c6.secret_token, poll.id, 'a']), 'belum terdeteksi');
const pend = await rpc('admin_list_pending_polls', [W, 'pin-admin-rahasia']);
check('Admin lihat poll pending', pend.ok && pend.polls.length === 1);
await rpc('admin_moderate_poll', [W, 'pin-admin-rahasia', poll2.id, 'approve']);
const active = await rpc('get_active_polls', [W, c3.id, c3.secret_token]);
check('Poll disetujui jadi aktif + my_vote viewer', active.length === 2 && active.some((p: any) => p.my_vote === 'a'), active);

console.log('\n▶ Pemakzulan pejabat gelap');
await db.query(`UPDATE citizens SET follow_checked_at = now() - interval '49 hours' WHERE world_id = $1 AND citizen_number = 4`, [W]);
await db.query(`UPDATE citizens SET follow_status = 'not_following', follow_checked_at = now() - interval '49 hours' WHERE world_id = $1 AND citizen_number = 2`, [W]);
const imp = await rpc('impeach_unverified_elites', [W, 'pin-admin-rahasia', null, null]);
check('Wapres not_following > 48 jam dimakzulkan', imp.ok && imp.impeached.some((x: any) => x.role_title === 'Wakil Presiden Konoha'), imp);
const wapres = await one<{ follow_status: string; role_title: string; tier_id: string }>('SELECT follow_status, role_title, tier_id FROM citizens WHERE id = $1', [c2.id]);
check('Status impeached + "Mantan ..."', wapres.follow_status === 'impeached' && wapres.role_title === 'Mantan Wakil Presiden Konoha' && wapres.tier_id === 'impeached', wapres);
const news = await one<{ message: string }>(`SELECT message FROM news_feed WHERE world_id = $1 AND category = 'impeachment' ORDER BY id DESC LIMIT 1`, [W]);
check('Breaking news pemakzulan', news?.message.startsWith('BREAKING NEWS: Wakil Presiden Konoha #002'), news);
await rpc('admin_restore_citizen', [W, 'pin-admin-rahasia', c2.id]);
const restored = await one<{ follow_status: string; role_title: string }>('SELECT follow_status, role_title FROM citizens WHERE id = $1', [c2.id]);
check('Admin pulihkan pejabat', restored.follow_status === 'pending' && restored.role_title === 'Wakil Presiden Konoha', restored);

console.log('\n▶ Ekspansi wilayah otomatis');
for (let i = 8; i <= 100; i++) await register(`warga_${i}`);
const ring = await one<{ r: number; n: number }>(`SELECT current_ring_unlocked AS r, last_citizen_number AS n FROM world_states WHERE world_id = $1`, [W]);
check('Populasi 100 → Ring 2 terbuka', ring.r === 2 && ring.n === 100, ring);
const plots2 = await one<{ n: number }>(`SELECT count(*)::int AS n FROM land_plots WHERE world_id = $1 AND ring_level = 2`, [W]);
check('Kavling Ring 2 dibuat (104 kavling)', plots2.n === 104, plots2);
const c101 = await one<{ role_title: string; tier_id: string; rt_rw_address: string }>(`SELECT role_title, tier_id, rt_rw_address FROM citizens WHERE world_id = $1 AND citizen_number = 61`, [W]);
check('#061 = Konglomerat', c101.tier_id === 'elite', c101);

console.log('\n▶ Leaderboard & sampling peta');
const lbF = await rpc('get_leaderboard', [W, 'founders', 0, 5, null]);
check('Top 1–100 urut nomor', lbF.length === 5 && lbF[0].rank === 1 && lbF[0].citizen.citizen_number === 1);
check('Leaderboard tidak bocorkan secret_token', !JSON.stringify(lbF).includes('secret_token'));
const lbR = await rpc('get_leaderboard', [W, 'richest', 0, 3, null]);
check('Terkaya #1 = Presiden', lbR[0].citizen.citizen_number === 1, lbR[0]?.citizen?.coins);
const lbL = await rpc('get_leaderboard', [W, 'landlords', 0, 10, null]);
check('Tuan Tanah: Novi (level 2) di atas Siti (level 1)', lbL[0].citizen.citizen_number === 1 && lbL[0].total_levels === 2 && lbL[1].citizen.citizen_number === 3, lbL);
const lbS = await rpc('get_leaderboard', [W, 'founders', 0, 10, '@siti']);
check('Cari "@siti"', lbS.length === 1 && lbS[0].citizen.ig_username === 'siti.k', lbS);
const lbN = await rpc('get_leaderboard', [W, 'founders', 0, 10, '#003']);
check('Cari "#003"', lbN.length === 1 && lbN[0].citizen.citizen_number === 3, lbN);
const ranks = await rpc('get_my_ranks', [W, c3.id]);
check('Peringkat saya (sticky footer)', ranks.wealth_rank === 2 && ranks.landlord_rank === 2, ranks);
const map = await rpc('get_map_citizens', [W, c6.id, 120]);
check('Sampling peta ≤ 120 & termasuk diri sendiri', map.length <= 120 && map[0].id === c6.id, map.length);

console.log('\n▶ Paritas aturan TypeScript ↔ SQL');
let titleMismatch = 0;
for (const cfg of Object.values(WORLDS)) {
  const r = await db.query<{ n: number; t: string; tier: string }>(
    `SELECT n, nv_resolve_title(nv_resolve_tier(config, n), n) AS t, nv_resolve_tier(config, n)->>'id' AS tier
     FROM world_states, generate_series(1, 1300) n WHERE world_id = $1 ORDER BY n`,
    [cfg.worldId],
  );
  for (const row of r.rows) {
    const tier = resolveTier(cfg, row.n);
    if (resolveTitle(tier, row.n) !== row.t || tier.id !== row.tier) titleMismatch++;
  }
}
check('Kasta & jabatan identik #1–#1300 di 10 dunia', titleMismatch === 0, titleMismatch);

const cfgK = WORLDS[W];
let plotMismatch = 0;
for (const ringN of [1, 2]) {
  const r = await db.query<{ plot_code: string; grid_x: number; grid_y: number; price: number }>(
    `SELECT plot_code, grid_x, grid_y, price::int FROM land_plots WHERE world_id = $1 AND ring_level = $2 ORDER BY plot_code`,
    [W, ringN],
  );
  const ts = generateRingPlots(cfgK, ringN).sort((a, b) => a.plotCode.localeCompare(b.plotCode));
  if (ts.length !== r.rows.length) plotMismatch += 1000;
  ts.forEach((p, i) => {
    const s = r.rows[i];
    if (!s || s.plot_code !== p.plotCode || s.grid_x !== p.gridX || s.grid_y !== p.gridY || s.price !== p.price) plotMismatch++;
  });
}
check('Layout & harga kavling Ring 1–2 identik', plotMismatch === 0, plotMismatch);

let ringMismatch = 0;
for (const pop of [0, 1, 99, 100, 101, 499, 500, 999, 1000, 2500, 100000, 200000, 400001]) {
  const s = await one<{ r: number }>(`SELECT nv_rings_for_population(config, $2) AS r FROM world_states WHERE world_id = $1`, [W, pop]);
  if (s.r !== ringsForPopulation(cfgK, pop)) ringMismatch++;
}
check('Milestone ring identik', ringMismatch === 0, ringMismatch);

let addrMismatch = 0;
const addrRows = await db.query<{ n: number; a: string; k: string }>(`SELECT citizen_number AS n, rt_rw_address AS a, ktp_code AS k FROM citizens WHERE world_id = $1`, [W]);
for (const row of addrRows.rows) if (row.a !== rtRwAddress(cfgK, row.n) || row.k !== ktpCode(cfgK, row.n)) addrMismatch++;
check('Alamat RT/RW & kode KTP identik', addrMismatch === 0, addrMismatch);

let normMismatch = 0;
for (const s of ['Anjjjing', 'K0nt0l', 'b@ngs@t!!', 'Halo Dunia', 'n.o.v.i_123', 'ÉLAN 55']) {
  const r = await one<{ v: string }>('SELECT nv_normalize_filter($1) AS v', [s]);
  if (r.v !== normalizeForFilter(s)) normMismatch++;
}
check('Normalisasi filter kata kasar identik', normMismatch === 0, normMismatch);

const badChars = await one<{ a: boolean; b: boolean; c: boolean; d: boolean }>(
  `SELECT nv_has_bad_chars('a<b') AS a, nv_has_bad_chars('a[b') AS b, nv_has_bad_chars('a\\b') AS c, nv_has_bad_chars('Warkop Mas Budi') AS d`,
);
check('Deteksi karakter terlarang', badChars.a && badChars.b && badChars.c && !badChars.d, badChars);

console.log('\n▶ Worker: report_follow_checks (hanya username yang dicek)');
{
  const PV = 'pt-virtual';
  const reg = (ig: string) => rpc('register_citizen_atomic', [PV, '', ig, '#22c55e', null, '{}']);
  const a = await reg('worker_a');
  const b = await reg('worker_b');
  const cc = await reg('worker_c');
  await db.query(`SELECT set_world_secrets($1, 'pin-admin-pt-virtual', 'sync-secret-pt-virtual-1234')`, [PV]);
  check('Sync secret salah ditolak', (await rpc('report_follow_checks', [PV, 'salah', ['worker_a'], [], null])).ok === false);
  await db.exec('SET ROLE anon');
  const r = await rpc('report_follow_checks', [PV, 'sync-secret-pt-virtual-1234', ['@Worker_A'], ['worker_b'], 5000]);
  await db.exec('RESET ROLE');
  check('Worker (anon + sync secret): 1 verified, 1 not_following', r.ok === true && r.verified === 1 && r.not_following === 1, r);
  const st = await db.query<{ id: string; follow_status: string }>('SELECT id, follow_status FROM citizens WHERE id = ANY($1)', [[a.id, b.id, cc.id]]);
  const by = new Map(st.rows.map((x) => [x.id, x.follow_status]));
  check('Warga yang TIDAK dicek tetap pending', by.get(a.id) === 'verified' && by.get(b.id) === 'not_following' && by.get(cc.id) === 'pending', [...by.values()]);
  const fc = await one<{ n: number }>('SELECT ig_follower_count AS n FROM world_states WHERE world_id = $1', [PV]);
  check('Total followers diperbarui worker', fc.n === 5000, fc);
}

console.log('\n▶ Geometri peta (engine kanvas)');
{
  const geo = Geometry.from(cfgK);
  let roundTrip = 0;
  let overlap = 0;
  const seen = new Set<string>();
  for (let r = 1; r <= 8; r++) {
    for (const p of generateRingPlots(cfgK, r)) {
      const w = geo.toWorld(p.gridX, p.gridY);
      const g = geo.worldToGrid(w.x + 20, w.y - 20);
      if (!g || g.gx !== p.gridX || g.gy !== p.gridY) roundTrip++;
      const key = `${w.x},${w.y}`;
      if (seen.has(key)) overlap++;
      seen.add(key);
      if (geo.ringOfDistance(Math.max(Math.abs(p.gridX), Math.abs(p.gridY))) !== r) roundTrip++;
    }
  }
  check('Tap kavling: dunia → grid kembali ke kavling yang sama (Ring 1–8)', roundTrip === 0, roundTrip);
  check('Tidak ada kavling bertumpuk', overlap === 0, overlap);
  const b = geo.boundaryBand(0);
  check('Titik di jalan lingkar tidak terdeteksi sebagai kavling', geo.worldToGrid((b.inner + b.outer) / 2, 0) === null);
  const water = geo.boundaryBand(2);
  check('Selat Ring 2→3 lebih lebar dari jalan biasa', water.outer - water.inner > (b.outer - b.inner) * 2);
}

// -----------------------------------------------------------------------------
console.log('\n▶ Upgrade v2: Edit Profil & Global Chat');
{
  await db.exec(upgradeV2); // dijalankan ulang → harus idempotent
  check('upgrade_v2_social_ux.sql aman dijalankan 2x', true);
  const a = await register('profil_alpha', 'Alpha');
  const b = await register('profil_bravo', 'Bravo');
  const before = await one<any>('SELECT citizen_number, role_title, tier_id, joined_day, created_at, follow_status FROM citizens WHERE id = $1', [a.id]);

  const r1 = await rpc('update_citizen_profile', [W, a.id, a.secret_token, '  Alpha    Baru ', null, null]);
  check('Ganti nama + trim spasi ganda', r1.username === 'Alpha Baru' && r1.name_edit_count === 1, r1.username);
  const after = await one<any>('SELECT citizen_number, role_title, tier_id, joined_day, created_at, follow_status FROM citizens WHERE id = $1', [a.id]);
  check('Kursi/jabatan/tier/tgl gabung/status follow tidak berubah', JSON.stringify(before) === JSON.stringify(after));
  await expectError('Cooldown 24 jam ganti nama', rpc('update_citizen_profile', [W, a.id, a.secret_token, 'Alpha Lagi', null, null]), 'Bisa ganti lagi dalam');
  await expectError('Token salah ditolak (anti-bajak)', rpc('update_citizen_profile', [W, a.id, b.secret_token, 'Hacker', null, null]), 'Sesi warga tidak valid');
  await expectError('Nama 1 karakter ditolak', rpc('update_citizen_profile', [W, b.id, b.secret_token, 'x', null, null]), '2–24');
  await expectError('Nama 25 karakter ditolak', rpc('update_citizen_profile', [W, b.id, b.secret_token, 'x'.repeat(25), null, null]), '2–24');
  await expectError('Nama kosong / zero-width ditolak', rpc('update_citizen_profile', [W, b.id, b.secret_token, '​ ​', null, null]), '2–24');
  await expectError('Tag HTML ditolak', rpc('update_citizen_profile', [W, b.id, b.secret_token, '<b>Bravo</b>', null, null]), 'karakter');
  await expectError('Nama tanpa huruf/angka ditolak', rpc('update_citizen_profile', [W, b.id, b.secret_token, '...', null, null]), 'huruf atau angka');
  await expectError('Nama kasar ditolak', rpc('update_citizen_profile', [W, b.id, b.secret_token, 'b4ngs4t', null, null]), 'tidak diizinkan');
  await expectError('Tanpa perubahan ditolak', rpc('update_citizen_profile', [W, b.id, b.secret_token, 'Bravo', null, null]), 'Tidak ada perubahan');
  const rc = await rpc('update_citizen_profile', [W, a.id, a.secret_token, null, '#123abc', 'cap']);
  check('Warna & aksesori tetap bisa diubah saat cooldown nama', rc.avatar_color === '#123abc' && rc.avatar_style.accessory === 'cap');
  await expectError('Aksesori di luar daftar ditolak', rpc('update_citizen_profile', [W, a.id, a.secret_token, null, null, 'crown']), 'tidak tersedia');

  // Papan nama kavling ikut sinkron
  await db.query(`UPDATE land_plots SET owner_citizen_id = $1, owner_tag = 'Bravo | 999' WHERE id = (SELECT id FROM land_plots WHERE world_id = $2 AND owner_citizen_id IS NULL LIMIT 1)`, [b.id, W]);

  // Chat
  const m1 = await rpc('send_global_chat', [W, b.id, b.secret_token, '  halo   warga  ', null]);
  check('Kirim chat (snapshot kursi, nama, jabatan, tier)', m1.message === 'halo warga' && m1.seat_number === b.citizen_number && m1.display_name === 'Bravo' && m1.tier === b.tier_id, m1);
  await expectError('Cooldown chat 4 detik', rpc('send_global_chat', [W, b.id, b.secret_token, 'spam', null]), 'tunggu');
  const reset = () => db.query('UPDATE citizens SET last_chat_at = NULL WHERE id = $1', [b.id]);
  await reset();
  await expectError('Chat 141 karakter ditolak', rpc('send_global_chat', [W, b.id, b.secret_token, 'a'.repeat(141), null]), '140');
  await expectError('Chat tag HTML ditolak', rpc('send_global_chat', [W, b.id, b.secret_token, '<script>alert(1)</script>', null]), 'karakter');
  await expectError('Chat kosong ditolak', rpc('send_global_chat', [W, b.id, b.secret_token, '   ', null]), 'kosong');
  await expectError('Emote asing ditolak', rpc('send_global_chat', [W, b.id, b.secret_token, '', 'dance']), 'tidak dikenal');
  await expectError('Token salah tidak bisa chat', rpc('send_global_chat', [W, b.id, a.secret_token, 'hai', null]), 'Sesi warga tidak valid');
  const st = await rpc('send_global_chat', [W, b.id, b.secret_token, '', 'fire']);
  check('Kirim stiker emote tanpa teks', st.emote_key === 'fire' && st.message === '');

  // Rename → sinkron ke chat & owner_tag
  const rb = await rpc('update_citizen_profile', [W, b.id, b.secret_token, 'Bravo Keren', null, null]);
  const chatNames = await one<any>('SELECT array_agg(DISTINCT display_name) AS n FROM global_chat_messages WHERE citizen_id = $1', [b.id]);
  check('Ganti nama menyinkronkan riwayat chat', chatNames.n.length === 1 && chatNames.n[0] === 'Bravo Keren', chatNames);
  const tag = await one<any>('SELECT owner_tag FROM land_plots WHERE owner_citizen_id = $1', [b.id]);
  check('Ganti nama menyinkronkan papan nama kavling', tag.owner_tag === `Bravo Keren | ${String(rb.citizen_number).padStart(3, '0')}`, tag);
  const newsRow = await one<any>(`SELECT message FROM news_feed WHERE citizen_id = $1 AND category = 'system' ORDER BY id DESC LIMIT 1`, [b.id]);
  check('Jejak ganti nama di berita', String(newsRow?.message).includes('Bravo → Bravo Keren'), newsRow);

  // Auto-prune 150
  await db.query(
    `INSERT INTO global_chat_messages (world_id, citizen_id, seat_number, display_name, message)
     SELECT $1, $2, 1, 'Bulk', 'pesan ' || g FROM generate_series(1, 220) g`,
    [W, a.id],
  );
  await reset();
  await rpc('send_global_chat', [W, b.id, b.secret_token, 'pesan terbaru', null]);
  const cnt = await one<{ n: number }>('SELECT count(*)::int AS n FROM global_chat_messages WHERE world_id = $1', [W]);
  check('Auto-prune: maksimal 150 pesan per dunia', cnt.n === 150, cnt);

  await db.exec('SET ROLE anon');
  const vis = await db.query<any>('SELECT id, message FROM global_chat_messages WHERE world_id = $1 ORDER BY id DESC', [W]);
  check('anon hanya bisa baca 50 pesan terbaru', vis.rows.length === 50 && vis.rows[0].message === 'pesan terbaru', vis.rows.length);
  await expectError('anon tidak bisa INSERT chat langsung', db.query(`INSERT INTO global_chat_messages (world_id, citizen_id, seat_number, display_name, message) VALUES ('${W}', '${a.id}', 1, 'x', 'x')`), 'permission denied');
  await expectError('anon tidak bisa DELETE chat', db.query('DELETE FROM global_chat_messages'), 'permission denied');
  await expectError('anon tidak bisa UPDATE nama langsung', db.query(`UPDATE citizens SET username = 'x'`), 'permission denied');
  const viaRpc = await db.query<any>(`SELECT public.update_citizen_profile($1, $2, $3, NULL, '#00ff00', NULL) AS r`, [W, a.id, a.secret_token]);
  check('anon boleh memanggil RPC update_citizen_profile', viaRpc.rows[0].r.avatar_color === '#00ff00');
  await db.exec('RESET ROLE');
}


// -----------------------------------------------------------------------------
console.log('\n▶ Upgrade v3: Ekonomi (gaji, kerja cepat, misi, properti, patungan)');
{
  await db.exec(upgradeV2);
  await db.exec(upgradeV3); // urutan v2 → v3 dijalankan ulang → idempotent
  check('upgrade_v3_economy_ux.sql aman dijalankan ulang setelah v2', true);
  const cat = await db.query<any>(`SELECT id, price, daily_bonus FROM property_types WHERE world_id = $1 ORDER BY sort`, [W]);
  check('Katalog properti Konoha: 5 tier (80 → 2000)', cat.rows.length === 5 && Number(cat.rows[0].price) === 80 && Number(cat.rows[4].price) === 2000, cat.rows);

  const e = await register('ekonomi_warga', 'Ekonom');
  const coins0 = Number((await one<any>('SELECT coins FROM citizens WHERE id = $1', [e.id])).coins);
  await expectError('Misi gaji ditolak sebelum klaim gaji', rpc('claim_mission', [W, e.id, e.secret_token, 'first_salary']), 'belum selesai');
  const sal = await rpc('claim_daily_salary', [W, e.id, e.secret_token]);
  check('Gaji harian warga biasa = 50 (tanpa bonus)', sal.reward === 50 && Number(sal.coins) === coins0 + 50, sal);
  await expectError('Gaji harian hanya 1x / 24 jam', rpc('claim_daily_salary', [W, e.id, e.secret_token]), 'Tersedia lagi dalam');
  await expectError('Token salah tidak bisa ambil gaji', rpc('claim_daily_salary', [W, e.id, c1.secret_token]), 'Sesi warga tidak valid');
  const pres = await rpc('claim_daily_salary', [W, c1.id, c1.secret_token]);
  check('Gaji RI-1 = 50 + 40 bonus jabatan', pres.reward === 90 && pres.rank_bonus === 40, pres);

  const m1 = await rpc('claim_mission', [W, e.id, e.secret_token, 'first_salary']);
  check('Misi 1 (gaji pertama) +30', m1.reward === 30);
  await expectError('Misi tidak bisa diklaim 2x', rpc('claim_mission', [W, e.id, e.secret_token, 'first_salary']), 'sudah kamu ambil');
  await expectError('Misi chat ditolak sebelum chat', rpc('claim_mission', [W, e.id, e.secret_token, 'first_chat']), 'belum selesai');
  await rpc('send_global_chat', [W, e.id, e.secret_token, 'halo semua', null]);
  check('Misi 2 (chat) +30 setelah kirim chat', (await rpc('claim_mission', [W, e.id, e.secret_token, 'first_chat'])).reward === 30);
  check('Misi 3 (emote) +20', (await rpc('claim_mission', [W, e.id, e.secret_token, 'first_emote'])).reward === 20);
  await expectError('Misi asing ditolak', rpc('claim_mission', [W, e.id, e.secret_token, 'free_money']), 'tidak dikenal');

  const q1 = await rpc('do_quick_work', [W, e.id, e.secret_token]);
  check('Kerja cepat +25 dengan label acak', q1.reward === 25 && typeof q1.label === 'string' && q1.remaining === 2, q1);
  await expectError('Kerja cepat jeda 2 jam', rpc('do_quick_work', [W, e.id, e.secret_token]), 'capek');
  await db.query(`UPDATE citizens SET quick_work_at = now() - interval '3 hours', quick_work_count = 3, quick_work_date = (now() AT TIME ZONE 'Asia/Jakarta')::date WHERE id = $1`, [e.id]);
  await expectError('Kerja cepat maks 3x per hari', rpc('do_quick_work', [W, e.id, e.secret_token]), '3/3');
  await db.query(`UPDATE citizens SET quick_work_date = (now() AT TIME ZONE 'Asia/Jakarta')::date - 1 WHERE id = $1`, [e.id]);
  check('Kuota kerja cepat reset di hari berikutnya', (await rpc('do_quick_work', [W, e.id, e.secret_token])).remaining === 2);

  // Patungan & properti mengikuti requireVerified dunia
  await expectError('Warga belum dilantik tidak bisa beli properti', rpc('buy_property', [W, e.id, e.secret_token, 'gerobak_lapak']), 'dilantik');
  await db.query(`UPDATE citizens SET follow_status = 'verified' WHERE id = $1`, [e.id]);
  const d = await rpc('donate_to_project', [W, e.id, e.secret_token, 10]);
  check('Patungan 10 RpK berhasil', Number(d.coins) > 0);
  const m4 = await rpc('claim_mission', [W, e.id, e.secret_token, 'first_donation']);
  check('Misi 4 (patungan) +40 & tercatat (Donatur Perintis)', m4.reward === 40 && 'first_donation' in m4.citizen.claimed_missions);
  const bal = Number((await one<any>('SELECT coins FROM citizens WHERE id = $1', [e.id])).coins);
  check('Hitungan onboarding: 20 + 50 + 120 - 10 + 25 + 25 = 230', bal === 230, bal);
  const chatBefore = await one<any>(`SELECT count(*)::int AS n FROM global_chat_messages WHERE citizen_id = $1 AND kind = 'system'`, [e.id]);
  await rpc('donate_to_project', [W, e.id, e.secret_token, 50]);
  const chatAfter = await one<any>(`SELECT message FROM global_chat_messages WHERE citizen_id = $1 AND kind = 'system' ORDER BY id DESC LIMIT 1`, [e.id]);
  check('Donasi >= 50 RpK → pengumuman sistem di Global Chat', chatBefore.n === 0 && String(chatAfter?.message).includes('menyumbang 50 RpK'), chatAfter);
  const activeProject = (await one<any>('SELECT active_project_id AS p FROM world_states WHERE world_id = $1', [W])).p;
  const board = await rpc('get_project_donor_board', [W, activeProject, 10]);
  check('Top donatur berisi kursi, nama, jabatan, total', board.some((r: any) => r.citizen_id === e.id && Number(r.amount) === 60 && r.username && r.role_title && r.citizen_number), board);

  const buy = await rpc('buy_property', [W, e.id, e.secret_token, 'warung_madura']);
  check('Beli Warung Madura Mini (150) → saldo terpotong & top_property terisi', Number(buy.coins) === 230 - 50 - 150 && buy.top_property === 'Warung Madura Mini', buy);
  await expectError('Properti yang sama tidak bisa dibeli 2x', rpc('buy_property', [W, e.id, e.secret_token, 'warung_madura']), 'sudah punya');
  await expectError('Saldo tidak cukup → ditolak (tidak pernah minus)', rpc('buy_property', [W, e.id, e.secret_token, 'mansion_konglo']), 'Saldo kurang');
  await expectError('Tipe properti asing ditolak', rpc('buy_property', [W, e.id, e.secret_token, 'istana_gratis']), 'tidak ditemukan');
  const after = await one<any>('SELECT coins FROM citizens WHERE id = $1', [e.id]);
  check('Saldo tetap ≥ 0 setelah pembelian gagal', Number(after.coins) === 30, after);
  await db.query(`UPDATE citizens SET last_salary_at = now() - interval '25 hours' WHERE id = $1`, [e.id]);
  const sal2 = await rpc('claim_daily_salary', [W, e.id, e.secret_token]);
  check('Gaji harian + bonus properti (+12)', sal2.reward === 62 && Number(sal2.property_bonus) === 12, sal2);
  const owners = await rpc('get_property_owners', [W, 10]);
  check('Daftar pemilik usaha RT', owners[0]?.property_name === 'Warung Madura Mini' && String(owners[0]?.rt_label).startsWith('RT'), owners[0]);
  const me3 = await rpc('get_my_citizen', [W, e.id, e.secret_token]);
  check('get_my_citizen membawa top_property & claimed_missions (sync e-KTP)', me3.top_property === 'Warung Madura Mini' && Object.keys(me3.claimed_missions).length === 4);

  // Ganti nama → nama di pesan sistem ikut sinkron
  await rpc('update_citizen_profile', [W, e.id, e.secret_token, 'Ekonom Baru', null, null]);
  const sys = await one<any>(`SELECT display_name FROM global_chat_messages WHERE citizen_id = $1 AND kind = 'system' LIMIT 1`, [e.id]);
  check('Pesan sistem donasi ikut ganti nama', sys.display_name === 'Ekonom Baru');

  await db.exec('SET ROLE anon');
  await expectError('anon tidak bisa ubah saldo langsung', db.query(`UPDATE citizens SET coins = 999999`), 'permission denied');
  await expectError('anon tidak bisa INSERT properti langsung', db.query(`INSERT INTO citizen_properties (world_id, citizen_id, property_type) VALUES ('${W}', '${e.id}', 'mansion_konglo')`), 'permission denied');
  await expectError('anon tidak bisa ubah harga katalog', db.query(`UPDATE property_types SET price = 1`), 'permission denied');
  const pubCat = await db.query<any>(`SELECT id FROM property_types WHERE world_id = $1`, [W]);
  check('anon bisa baca katalog', pubCat.rows.length === 5);
  await expectError('anon tidak bisa panggil helper nv_*', db.query(`SELECT nv_rank_salary_bonus(1)`), 'permission denied');
  await db.exec('RESET ROLE');
}

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} lulus, ${failed} gagal\n`);
await db.close();
process.exit(failed === 0 ? 0 : 1);
