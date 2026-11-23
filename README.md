# 🏛️ Negara Virtual — Multi-Tenant Virtual Nation Platform

1 codebase + 1 database Supabase → 10 dunia virtual (10 akun IG), dibedakan oleh `VITE_WORLD_ID`.
Pilot: **Republik Konoha** (`republikkonoha.pages.dev`). Stack: Vite + React 19 + TypeScript + Tailwind v4,
Supabase (PostgreSQL + RPC + Realtime Presence), Cloudflare Pages + Turnstile. Biaya: Rp 0 (free tier).

> Status: **Fase 1–5 selesai** — scaffold multi-tenant, database & RPC atomik, mesin peta kanvas, UI lengkap
> (KTP PNG, Buku Sejarah, Sidang Warga, Creator Studio 9:16), worker verifikasi follow opsional, dan panduan deploy.
>
> 👉 **Deploy ke production: [DEPLOY_GUIDE.md](DEPLOY_GUIDE.md)** • Worker otomatis: [worker/README.md](worker/README.md)

---

## ⚡ Quick start (Mode Sandbox, tanpa Supabase)

```bash
npm install
npm run dev          # http://localhost:5173
```

Tanpa `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`, aplikasi otomatis jalan di **Mode Sandbox**: seluruh dunia
disimpan di `localStorage` dan meniru semua aturan RPC (FCFS, verifikasi follow, ekonomi, voting, admin).

- Badge **MODE SANDBOX ⚙️** (kanan atas) → Dev Tools: seed 20 warga demo, simulasi worker cek follow, mundurkan waktu 49 jam (tes pemakzulan),
  tambah 5.000 saldo, mundurkan pendapatan properti 12 jam (koin klaim muncul), reset ke 0 warga.
- Peta: geser 1 jari / drag, cubit 2 jari / scroll-wheel untuk zoom, tap kavling → beli / bangun / upgrade / klaim,
  tap warga → profil, tap Zona Proyek → patungan. Tombol kanan: **Deket** (terbang ke karaktermu), **Kota** (lihat semua), **Berita**.
- Admin Panel: buka `http://localhost:5173/#admin`, PIN sandbox `admin123`.
- Buka beberapa tab untuk melihat **Tamu online** antar-tab (BroadcastChannel) + beberapa Tamu simulasi.
- Dunia lain: `VITE_WORLD_ID=kerajaan-kucing npm run dev`.

## 🗄️ Setup Supabase (production)

1. Buat proyek di [supabase.com](https://supabase.com) (free tier).
2. **SQL Editor** → jalankan isi `supabase/migrations/001_init.sql`.
3. **SQL Editor** → jalankan `supabase/migrations/002_worker_checks.sql`, lalu `supabase/seed.sql` (10 dunia, 0 warga — tidak ada data dummy).
4. Set PIN admin & secret worker per dunia (SQL Editor, tidak bisa dipanggil dari browser):
   ```sql
   SELECT set_world_secrets('republik-konoha', 'PIN-ADMIN-MINIMAL-8-KARAKTER', 'SYNC-SECRET-WORKER-MINIMAL-16');
   ```
5. Edge Function pendaftaran (Turnstile + rate-limit IP) — butuh [Supabase CLI](https://supabase.com/docs/guides/cli):
   ```bash
   supabase functions deploy register-citizen --no-verify-jwt
   supabase secrets set TURNSTILE_SECRET_KEY=0x... IP_HASH_SALT=<string-acak-panjang>
   ```
   Belum mau pakai Edge Function? Set `VITE_REGISTER_VIA=rpc` lalu aktifkan sementara:
   `UPDATE world_states SET allow_direct_registration = true WHERE world_id = 'republik-konoha';`
   (rate-limit IP tetap jalan via header, tapi **tanpa Turnstile** — jangan dipakai saat video FYP.)
6. Salin `.env.example` → `.env.local`, isi `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_TURNSTILE_SITE_KEY`.

Mengubah config dunia (`src/configs/worlds/*.ts`)? Jalankan `npm run db:seed` lalu eksekusi ulang `supabase/seed.sql`
— aman diulang, counter warga tidak tersentuh.

## 📜 Scripts

| Perintah | Fungsi |
| --- | --- |
| `npm run dev` | Dev server (sandbox otomatis bila env Supabase kosong) |
| `npm run build` | Typecheck + build production ke `dist/` (hanya config dunia aktif yang di-bundle) |
| `npm run db:seed [world_id…]` | Generate `supabase/seed.sql` dari config TypeScript |
| `npm run test:db` | Jalankan migrasi + seed di Postgres WASM (PGlite) dan 108 skenario uji |

## 🧱 Struktur

```
src/
  configs/            types.ts (WorldConfig) · defineWorld.ts (default & preset kasta) · worlds/*.ts (10 dunia)
  lib/                game.ts (kasta, ring, kavling, ekonomi — dicerminkan 1:1 di SQL) · validation · profanity · followersParser · fx
  services/           types.ts (kontrak NationApi) · supabaseAdapter.ts · sandboxAdapter.ts · index.ts (fallback otomatis + sesi)
  engine/             MapEngine (loop rAF terpisah dari React) · geometry (grid → px, jalan & selat) · camera · input (pan/pinch/wheel/tap)
                      · agents (AI jalan-jalan client-side) · spatialHash · sprites (cache chibi & emoji) · draw/{terrain,plots,landmarks}
  components/         MapView · PlotSheet · InfoSheets (warga, landmark/patungan, berita) · Hud · NewsTicker · RegisterModal · RevealOverlay
                      · KtpModal · AdminPanel · DevPanel
supabase/
  migrations/001_init.sql   tabel, RLS, seluruh RPC
  migrations/002_worker_checks.sql  report_follow_checks (worker: hanya ubah username yang dicek)
  functions/register-citizen Edge Function Turnstile
  seed.sql                  GENERATED
scripts/              generate-seed.ts · test-db.ts
worker/               verify_followers.py (Python Playwright, opsional) · requirements.txt · .env.example
public/               _redirects (SPA Cloudflare Pages) · _headers (cache & keamanan)
```

## 🔒 Aturan inti yang dijamin di database

- **Strict FCFS:** `UPDATE world_states SET last_citizen_number = last_citizen_number + 1 … RETURNING` mengunci baris dunia;
  request paralel antre. Validasi gagal setelah increment → exception me-rollback seluruh transaksi → nomor tidak pernah kembar/lompat.
  Pendaftar pertama = `#001` (tier `head`, cth. Presiden).
- **Blind reveal:** form tidak menampilkan nomor; nomor asli dikembalikan server, lalu roulette 1,5 detik + konfeti + fanfare.
- **Verifikasi follow 1x24 jam:** `pending → verified / not_following`, `recheck_requested` (Cek Ulang), `impeached` (pemakzulan admin).
  Upload `followers_1.json` di Admin Panel → klien mengiris antrean ∩ followers (payload kecil walau 100rb+ followers) →
  `batch_verify_followers` dengan `p_snapshot_at` agar pendaftar baru saat proses tidak salah ditandai.
- **RLS:** anon hanya bisa `SELECT` kolom publik. `secret_token`, `ip_hash`, PIN pemulihan tidak pernah terbaca. Semua mutasi lewat RPC ber-token / ber-PIN admin.
- **Paritas TS ↔ SQL** (kasta, jabatan, harga & layout kavling, milestone ring, alamat, filter kata) diuji otomatis di `npm run test:db`.

## 🎬 Fitur Fase 4

- **KTP PNG 1080×1920** (siap IG Story) dibuat di klien (`src/lib/ktpCanvas.ts`): border warna kasta, avatar resolusi tinggi,
  RT/RW, DAY, kekayaan, properti, stempel dinamis (pending / SAH / warga gelap / dimakzulkan). Tombol **Download PNG** dan
  **Bagikan ke Story** (Web Share API dengan file; fallback salin teks promosi).
- **Buku Sejarah Negara** (tombol 🏆): Top 1–100, 101–1000, Terkaya, Tuan Tanah; cari @username / #nomor / jabatan;
  Load More per 50; tap baris → kamera terbang + spotlight (warga di luar sampel peta ikut dimunculkan); sticky "Posisi Kamu".
- **Pemerintahan** (tombol 🗳️): Sidang Warga (1 warga sah = 1 suara) untuk semua; Panel Pejabat untuk #001–#060:
  Pidato Negara (Presiden/Wapres, ter-pin di TV) dan usulan voting (Presiden/Wapres langsung aktif, Kabinet/DPR lewat moderasi).
- **Admin Panel** (`#admin` atau Ctrl/Cmd+Shift+A): + buka/tutup Sidang, setujui/tolak usulan, pilih proyek nasional aktif,
  moderasi (hapus berita, kosongkan status, reset nama bangunan), pulihkan pejabat dimakzulkan.
- **Creator Studio** (`#studio`, wajib sudah login PIN admin di tab yang sama): bingkai 9:16, header "HARI KE-X • NEGARA",
  counter populasi live, ticker di bawah, tanpa HUD. Auto-camera: Istana & Presiden → 3 warga terbaru → bangunan terbaru →
  proyek nasional → zoom-out kota + CTA "Klaim KTP di Link Bio". Kontrol hilang saat merekam; Esc untuk berhenti.

## 🗺️ Mesin peta (Fase 3)

- **Hemat kuota:** kavling dijual digenerate di klien (layout identik SQL, diuji), server hanya mengirim kavling **ber-pemilik**
  untuk ring yang sedang terlihat kamera (cache 45 detik). Warga dibatasi 120 (sampling RPC), Tamu dirender maks. 40,
  NPC tanpa nama (selisih followers IG − terdaftar) maks. 70. Pergerakan karakter 100% di klien, tanpa write ke database.
- **60 FPS:** sprite chibi & emoji di-cache ke kanvas offscreen, viewport culling untuk kavling/landmark, spatial hash untuk
  karakter, LOD (zoom jauh = titik & kotak polos), label di screen-space hanya saat zoom cukup, DPR dibatasi 2.
- **Ekspansi:** ring baru langsung muncul saat `current_ring_unlocked` naik; ring berikutnya tampil berkabut dengan label
  syarat populasinya. Ring 3 dipisah selat dengan 4 jembatan (Pulau Reklamasi).
- **Proyek nasional:** zona proyek menampilkan crane + fondasi yang naik sesuai progres; proyek MRT selesai → rel & kereta
  melingkari jalan lingkar inti; proyek lain yang selesai jadi monumen di pojok selatan.

## 📝 Catatan keputusan

- Belum ada: *Patungan Bangun Gedung Bersama (Joint Venture)* dari blueprint bagian E. Voting jenis "proyek berikutnya"
  bersifat informatif — admin yang mengaktifkan proyek pemenangnya lewat Admin Panel.

- `UNIQUE(world_id, LOWER(username))` dari blueprint **tidak** dipakai: nama panggilan boleh sama (identitas unik = `Nama | Nomor`);
  yang unik adalah `ig_username` dan `ktp_code`.
- Kavling dibuat prosedural per ring (`nv_ensure_plots`): Ring r berisi lapis berjarak Chebyshev d, 8·d kavling per lapis.
  Ring baru terbuka saat populasi tembus milestone (`0, 100, 500, 1000, 2500, …`, lalu terus digandakan) **atau** ring terluar terisi ≥ 80%.
- PIN pemulihan 4–6 digit dikunci 1 jam setelah 5x salah; PIN admin dikunci 15 menit setelah 10x salah. Sarankan warga memakai 6 digit.
- `npm run test:db` memakai PGlite (1 koneksi), jadi ia memverifikasi logika & tidak-ada-nomor-lompat, bukan beban paralel sungguhan.
  Jaminan paralel berasal dari row-lock PostgreSQL di atas.
