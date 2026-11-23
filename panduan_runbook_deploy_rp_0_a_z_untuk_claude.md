# 🚀 DEPLOYMENT RUNBOOK (A–Z) — 100% GRATIS (RP 0)
## Arsitektur: GitHub Private + Supabase (1 DB) + Cloudflare Pages (Wrangler CLI) + Turnstile

> **Instruksi Khusus untuk Claude (Executor):**
> Kamu bertindak sebagai **DevOps & Release Engineer** untuk proyek **Multi-Tenant Virtual Nation (Pilot: Republik Konoha + 9 Dunia Lainnya)**.
> Jalankan runbook ini secara berurutan dari **Fase A sampai Fase F**.
>
> **Aturan Keamanan Wajib:**
> 1. **JANGAN PERNAH** menaruh `SUPABASE_SERVICE_ROLE_KEY`, `DB_PASSWORD`, `ADMIN_SECRET`, atau `TURNSTILE_SECRET_KEY` di kode frontend (`src/`), variabel `VITE_*`, maupun commit ke GitHub.
> 2. **JANGAN PERNAH** menjalankan *reset/wipe database* di Production tanpa konfirmasi eksplisit dari user.
> 3. Sebelum setiap deploy ke Production, wajib pastikan `npm run build` dan `tsc --noEmit` lulus **0 error**, serta tidak ada data dummy/seed yang aktif di Production (**Strict FCFS dimulai dari 0 warga asli**).

---

## 1. ARSITEKTUR DEPLOY PALING EFISIEN (RP 0 / BULAN)

| Lapisan | Layanan Gratis | Peran & Batas Free Tier | Kenapa Paling Efisien? |
| :--- | :--- | :--- | :--- |
| **Source Code** | **GitHub (Private Repo)** | Gratis unlimited private repo | Kode aman nggak diintip kompetitor, sekaligus backup & trigger otomatis. |
| **Database & Presence** | **Supabase (Free Tier)** | 1 proyek (500 MB DB, 50.000 MAU, Realtime Presence) | **1 DB dipakai rame-rame untuk 10 dunia** via kolom `world_id`. |
| **Hosting 10 Web** | **Cloudflare Pages** | Gratis s.d. 100 proyek, **Bandwidth Unlimited** | Anti jebol pas 10 akun FYP barengan; tiap dunia dapat link bersih `*.pages.dev`. |
| **Deploy Automation** | **Wrangler CLI (`npx wrangler`)** | Gratis, bawaan resmi Cloudflare | Claude bisa bikin proyek & deploy 10 web langsung dari terminal tanpa klik manual. |
| **Anti-Bot / Spam** | **Cloudflare Turnstile** | Gratis unlimited | Tahan bot penimbun nomor `#001–#100` tanpa captcha gambar yang bikin ribet. |
| **Anti-Sleep DB** | **GitHub Actions Cron** | Gratis (2.000 menit/bulan) | Mencegah proyek Supabase Free Tier terkena *auto-pause* jika sepi >7 hari. |

---

## 2. FASE A — PERSIAPAN SINGKAT OLEH USER (5–10 MENIT)

*(Bagian ini hanya perlu dilakukan user sekali di browser sebelum menyuruh Claude eksekusi terminal.)*

### Langkah A1: Siapkan 1 Repositori Private di GitHub
1. Buka `https://github.com/new`.
2. Nama repo: `negara-virtual-engine` → pilih **Private** → klik **Create repository** (kosongkan, jangan centang README/.gitignore).
3. Salin URL repo (contoh: `https://github.com/USERNAME/negara-virtual-engine.git`).

### Langkah A2: Siapkan 1 Proyek Database di Supabase
1. Buka `https://supabase.com/dashboard` → klik **New Project**.
2. Isi nama proyek: `negara-virtual-prod`.
3. Pilih **Region: Southeast Asia (Singapore)** *(wajib agar respons cepat untuk pengguna Indonesia)*.
4. Buat dan simpan **Database Password** di catatan pribadi (Notepad).
5. Setelah proyek aktif (±1–2 menit), buka **Project Settings → General** dan **Project Settings → API**, lalu siapkan data berikut (berikan ke Claude hanya saat diminta atau masukkan sendiri ke file `.env.local` lokal):
   * `Project Reference ID` (contoh: `abcdefghijklmnop`)
   * `Project URL` (`https://xxxx.supabase.co`)
   * `anon` `public` key (aman untuk frontend `VITE_SUPABASE_ANON_KEY`)
   * `service_role` key (**RAHASIA — hanya untuk Edge Function / Worker lokal, JANGAN masuk frontend**)

### Langkah A3: Siapkan Akun Cloudflare & Turnstile (Gratis)
1. Daftar/login di `https://dash.cloudflare.com`.
2. *(Opsional tapi sangat disarankan untuk anti-bot)*: Buka menu **Turnstile** → **Add Widget**:
   * Widget Name: `Negara Virtual Multi-Tenant`
   * Hostnames: tambahkan `*.pages.dev` dan `localhost` (atau domain spesifik masing-masing dunia).
   * Widget Mode: **Managed** (atau **Invisible**).
   * Simpan `Site Key` (untuk frontend) dan `Secret Key` (untuk backend/Edge Function).

### Langkah A4: Login CLI Sekali di Terminal Lokal
Saat Claude siap deploy, user cukup menyetujui login browser yang dibuka dari terminal untuk:
* `npx supabase login` (untuk push migrasi SQL otomatis)
* `npx wrangler login` (untuk izin Cloudflare Pages)

---

## 3. FASE B — AUDIT PRA-DEPLOY OLEH CLAUDE (WAJIB SEBELUM ONLINE)

Claude **WAJIB** memeriksa dan menambahkan file/konfigurasi berikut di repositori sebelum melakukan deploy pertama:

### B1. Routing SPA & Security Headers untuk Cloudflare Pages
1. Buat file `public/_redirects` berisi:
   ```text
   /* /index.html 200
   ```
   *(Mencegah error 404 jika user me-refresh halaman atau membuka link langsung seperti `/admin` atau `/ktp`.)*
2. Buat file `public/_headers` berisi:
   ```text
   /*
     X-Frame-Options: DENY
     X-Content-Type-Options: nosniff
     Referrer-Policy: strict-origin-when-cross-origin

   /assets/*
     Cache-Control: public, max-age=31536000, immutable
   ```

### B2. Sanitasi `.gitignore` & Template `.env.example`
Pastikan `.gitignore` memuat:
```gitignore
node_modules
dist
.env
.env.local
.env.*.local
.wrangler
worker/.env
worker/__pycache__
```
Dan buat `.env.example` (tanpa nilai asli):
```env
VITE_WORLD_ID=republik-konoha
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_ANON_KEY
VITE_TURNSTILE_SITE_KEY=YOUR_TURNSTILE_SITE_KEY
VITE_ENABLE_SANDBOX_SEED=false
```

### B3. Audit Production Readiness (3 Poin Kritis)
1. **Zero Dummy Data di Production:** Pastikan saat `VITE_SUPABASE_URL` terisi dan `VITE_ENABLE_SANDBOX_SEED=false`, aplikasi **TIDAK** memunculkan warga dummy `#001–#020`. Kursi `#001 Presiden` harus benar-benar kosong menunggu follower pertama.
2. **Keamanan RLS Supabase:** Verifikasi bahwa tabel `citizens` **TIDAK** mengekspos kolom `secret_token` maupun `ip_hash` melalui public `SELECT`. Gunakan PostgreSQL `VIEW` publik (misal `public_citizens`) atau kolom terfilter via RLS/RPC.
3. **Kompatibilitas Instagram In-App Browser (Wajib untuk KTP PNG!):**
   * Browser bawaan Instagram (iOS/Android WebView) sering memblokir `<a download="ktp.png">`.
   * Pastikan tombol **Download KTP** memiliki fallback berlapis:
     1. Coba `navigator.share({ files: [pngFile] })` jika didukung (terbaik di HP).
     2. Jika gagal, coba trigger `<a download>` standar.
     3. Selalu sediakan teks bantuan di bawah gambar preview KTP: *"Kalau tombol download tidak jalan di browser IG, tekan & tahan gambar KTP di atas lalu pilih Simpan Gambar (atau screenshot)."*

---

## 4. FASE C — EKSEKUSI DEPLOY DATABASE SUPABASE

Claude menjalankan langkah berikut di terminal (jika CLI belum login, minta user menyelesaikan login browser terlebih dahulu):

### C1. Hubungkan & Push Migrasi SQL
```bash
npx supabase login
npx supabase link --project-ref <PROJECT_REF_ID>
npx supabase db push
```
*(Fallback jika `supabase db push` terkendala: Claude gabungkan seluruh migrasi menjadi 1 file bersih `supabase/DEPLOY_ALL_SQL.sql` agar user tinggal copy-paste 1 kali ke **Supabase Dashboard → SQL Editor → Run**.)*

### C2. Inisialisasi 10 Baris `world_states` (Bersih dari 0 Warga)
Pastikan migrasi atau skrip seed awal memasukkan 10 baris di tabel `world_states` dengan `last_citizen_number = 0` dan `ON CONFLICT (world_id) DO NOTHING`:
1. `republik-konoha` (`ig_account_handle = 'republikkonoha'`)
2. `pt-virtual` (`ig_account_handle = 'ptvirtualscbd'`)
3. `kampus-virtual` (`ig_account_handle = 'kampusvirtual'`)
4. `kampung-mistis` (`ig_account_handle = 'kampungmistis'`)
5. `kerajaan-nusantara` (`ig_account_handle = 'kerajaannusantara'`)
6. `guild-petualang` (`ig_account_handle = 'guildisekai'`)
7. `kota-mafia` (`ig_account_handle = 'kotamafia'`)
8. `pulau-penjara` (`ig_account_handle = 'pulaupenjara'`)
9. `koloni-mars` (`ig_account_handle = 'kolonimars'`)
10. `kerajaan-kucing` (`ig_account_handle = 'kerajaankucing'`)

*(Catatan: Handle IG bisa diubah kapan saja lewat Admin Panel saat akun IG resminya sudah dibuat.)*

### C3. Konfigurasi Secrets & Edge Functions (Jika Menggunakan Turnstile / Admin Auth)
```bash
npx supabase secrets set ADMIN_PIN_HASH="<HASH_PIN_ADMIN>"
npx supabase secrets set TURNSTILE_SECRET_KEY="<SECRET_KEY_TURNSTILE>"
npx supabase functions deploy register-citizen --no-verify-jwt
npx supabase functions deploy admin-actions --no-verify-jwt
```
*(Atau jika mutasi murni memakai PostgreSQL RPC, pastikan `ADMIN_PIN` diverifikasi menggunakan `pgcrypto` / `crypt()` di dalam tabel konfigurasi private `admin_secrets` yang terkunci total oleh RLS `USING (false)`.)*

### C4. Konfigurasi Realtime Presence (Hemat Kuota)
* Pastikan di Dashboard Supabase, **Realtime Broadcast / Presence** aktif untuk fitur **`X warga online`** dan karakter **`Tamu XXXX`**.
* **JANGAN** mengaktifkan Realtime Postgres Changes (CDC) pada tabel `citizens` agar kuota *free tier* tetap aman saat ribuan orang masuk bersamaan.

---

## 5. FASE D — PUSH KODE KE GITHUB (BACKUP AMAN)

Claude menjalankan:
```bash
git status
# Pastikan TIDAK ADA file .env atau secret key di staging!
git init
git add .
git commit -m "feat: initial production build multi-tenant virtual nation engine"
git branch -M main
git remote add origin <URL_REPO_GITHUB_USER>
git push -u origin main
```

---

## 6. FASE E — DEPLOY KE CLOUDFLARE PAGES (OTOMATIS VIA WRANGLER CLI)

Ada dua jalur deploy di Cloudflare Pages. **Gunakan Jalur 1 (Wrangler Script)** agar Claude bisa langsung membuat proyek & deploy dari terminal tanpa menyuruh user klik berulang kali, lalu nanti user tetap bisa menghubungkannya ke GitHub bila ingin *auto-deploy* on push.

### E1. Buat Skrip Otomasi Multi-Tenant (`scripts/deploy-world.mjs`)
Claude wajib membuat skrip Node.js `scripts/deploy-world.mjs` yang menerima argumen nama `world_id` (atau `--all` untuk 10 dunia sekaligus):
* Memetakan setiap `world_id` ke nama proyek Cloudflare Pages resminya:

| `VITE_WORLD_ID` | Nama Proyek Cloudflare Pages | Link Live Gratis |
| :--- | :--- | :--- |
| `republik-konoha` | `republikkonoha` | `https://republikkonoha.pages.dev` |
| `pt-virtual` | `ptvirtual` | `https://ptvirtual.pages.dev` |
| `kampus-virtual` | `kampusvirtual` | `https://kampusvirtual.pages.dev` |
| `kampung-mistis` | `kampungmistis` | `https://kampungmistis.pages.dev` |
| `kerajaan-nusantara` | `kerajaannusantara` | `https://kerajaannusantara.pages.dev` |
| `guild-petualang` | `guildisekai` | `https://guildisekai.pages.dev` |
| `kota-mafia` | `kotamafia` | `https://kotamafia.pages.dev` |
| `pulau-penjara` | `pulaupenjara` | `https://pulaupenjara.pages.dev` |
| `koloni-mars` | `kolonimars` | `https://kolonimars.pages.dev` |
| `kerajaan-kucing` | `kerajaankucing` | `https://kerajaankucing.pages.dev` |

*(Catatan: Jika sebuah nama subdomain `.pages.dev` sudah dipakai orang lain di Cloudflare, fallback otomatis ke format `republik-konoha-id` atau `warga-konoha` lalu catat URL finalnya.)*

* Alur kerja `scripts/deploy-world.mjs`:
  1. Membaca `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, dan `VITE_TURNSTILE_SITE_KEY` dari `.env.production.local`.
  2. Menjalankan build Vite dengan `VITE_WORLD_ID=<world_id>` dan `VITE_ENABLE_SANDBOX_SEED=false`.
  3. Memastikan proyek Cloudflare Pages sudah ada (membuatnya otomatis via `npx wrangler pages project create <projectName> --production-branch=main` jika belum ada).
  4. Menjalankan `npx wrangler pages deploy dist --project-name=<projectName> --branch=main`.
  5. Mencetak URL live hasil deploy.

* Tambahkan shortcut di `package.json`:
  ```json
  "scripts": {
    "deploy:pilot": "node scripts/deploy-world.mjs republik-konoha",
    "deploy:world": "node scripts/deploy-world.mjs",
    "deploy:all": "node scripts/deploy-world.mjs --all"
  }
  ```

### E2. Eksekusi Deploy Pilot #1 (`Republik Konoha`)
```bash
npx wrangler login
npm run deploy:pilot
```
* Setelah Pilot #1 (`republikkonoha.pages.dev`) terbukti 100% lancar, user bisa men-deploy gelombang berikutnya kapan saja cukup dengan 1 perintah:
  ```bash
  npm run deploy:world pt-virtual
  npm run deploy:world kampung-mistis
  # atau sekaligus semua 10 dunia:
  npm run deploy:all
  ```

### E3. Bonus: Cegah Supabase Free Tier Auto-Pause (GitHub Actions Cron)
Supabase Free Tier akan menidurkan database jika tidak ada kueri selama 7 hari. Claude wajib membuat file `.github/workflows/keep-supabase-alive.yml` yang berjalan otomatis setiap 3 hari sekali (ping `GET /rest/v1/world_states?select=world_id&limit=1` menggunakan `secrets.SUPABASE_URL` & `secrets.SUPABASE_ANON_KEY` di GitHub Repository Secrets).

---

## 7. FASE F — VERIFIKASI PASCA-DEPLOY (PRODUCTION SMOKE TEST)

Setelah URL `https://republikkonoha.pages.dev` (atau URL finalnya) aktif, jalankan checklist pengujian ini sebelum menaruh link di bio Instagram:

- [ ] **Tes Strict FCFS:** Daftar 1 akun uji coba → pastikan mendapat nomor **`001` (Presiden Republik Konoha)**, bukan acak dan bukan `#021`.
- [ ] **Tes Blind Reveal:** Pastikan di modal pendaftaran tidak ada bocoran angka urutan sebelum tombol submit ditekan.
- [ ] **Tes Validasi IG:** Coba masukkan akun resmi `@republikkonoha` atau format salah (spasi/simbol) → pastikan ditolak dengan pesan error jelas.
- [ ] **Tes KTP PNG di HP & In-App Browser IG:** Buka link dari DM Instagram di HP sendiri → cek apakah KTP tampil rapi, ada `RT/RW`, `WARGA SEJAK DAY 1`, stempel `MENUNGGU PELANTIKAN`, dan tombol Download / Simpan Gambar berfungsi.
- [ ] **Tes Live Tamu Online:** Buka link di 2 tab berbeda (1 mode Incognito) → pastikan indikator `2 warga online` bertambah dan karakter `Tamu XXXX` muncul di peta.
- [ ] **Tes Beli Tanah & Bangun Properti:** Klaim kerja / tambahkan koin tes → beli 1 kavling tanah → bangun & upgrade properti → refresh halaman dan pastikan bangunan tetap tersimpan di Supabase.
- [ ] **Tes Admin Panel & Verifikasi Follow JSON:** Login Admin Panel via PIN → tes upload file contoh `followers_1.json` → pastikan status akun uji coba berubah dari `pending` menjadi `verified` dan timestamp `diperbarui ...` ikut terupdate.
- [ ] **Tes Mode Kreator 9:16:** Jalankan tur kamera 9:16 untuk memastikan cocok direkam menjadi Reels.
- [ ] **BERSIHKAN DATA TES SEBELUM LAUNCHING!** Setelah semua lulus, hapus akun uji coba dan kembalikan `last_citizen_number = 0` di `world_states` (hanya sebelum link dibagikan ke publik) agar follower asli pertama benar-benar mendapatkan kursi **`#001 Presiden`**.

---

## 8. SOP OPERASIONAL HARIAN (SETELAH LIVE DI IG)

1. **Sinkronisasi Follow Harian (1x24 Jam — 0% Risiko Banned):**
   * Setiap malam (misal jam 01.00–02.00 WIB atau sebelum bikin konten harian), ekspor daftar followers dari **Instagram / Meta Accounts Center → Your information and permissions → Download your information → Followers and following (Format: JSON)**.
   * Buka **Admin Panel** di web (URL/shortcut khusus + PIN) → buka tab **Sync Followers** → upload file `followers_1.json` → sistem otomatis memverifikasi ratusan/ribuan warga antrean dalam 1 detik + mengupdate angka `WARGA` & timestamp `diperbarui ...`.
2. **Produksi Konten Reels Harian:**
   * Buka web di browser PC/HP → masuk **Mode Kreator → Mode Rekam Reels (9:16)** → rekam layar tur kamera otomatis (Istana → Warga Baru → Bangunan Baru → Proyek MRT → Zoom-out) → tambahkan *voiceover* drama harian + *backsound* → upload!
3. **Rolling Out 10 Akun IG:**
   * Mulai aktifkan dulu **Gelombang 1** (Republik Konoha, PT Virtual, Kampung Mistis). Setelah ritme edit dan sistem verifikasi harian berjalan mulus, jalankan `npm run deploy:world <id>` untuk Gelombang 2 & 3.

---

## 📋 PROMPT SIAP COPY-PASTE UNTUK CLAUDE (SAAT KODE SUDAH SIAP DEPLOY)

Setelah Claude menyelesaikan build lokal, kirim file `CLAUDE_DEPLOY_RUNBOOK.md` ini lalu ketik:

> *"Kode lokal sudah beres. Sekarang baca `CLAUDE_DEPLOY_RUNBOOK.md` dan eksekusi mulai dari **Fase B (Audit Pra-Deploy)** sampai **Fase E (Deploy Pilot `republik-konoha`)**. Buat file `_redirects`, `_headers`, skrip `scripts/deploy-world.mjs`, dan GitHub Action `keep-supabase-alive.yml`. Beri tahu saya langkah per langkah kalau butuh saya login browser (`supabase login` / `wrangler login`) atau memasukkan API key Supabase ke `.env.production.local`."*