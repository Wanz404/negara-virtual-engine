# 🚀 Panduan Deploy Rp 0 — 1 Repo, 10 Dunia

Arsitektur: **1 repositori GitHub → 10 proyek Cloudflare Pages** (beda `VITE_WORLD_ID`) → **1 proyek Supabase**
(dipisah kolom `world_id`) + **Cloudflare Turnstile** untuk anti-bot. Semua di paket gratis.

```
GitHub repo ──┬─► Pages "republikkonoha"   (VITE_WORLD_ID=republik-konoha)  ─┐
              ├─► Pages "ptvirtual"        (VITE_WORLD_ID=pt-virtual)        ├─► Supabase (1 proyek)
              └─► … 8 proyek lain                                            ┘     + Edge Function Turnstile
```

Perkiraan waktu: ±45 menit untuk dunia pertama, ±5 menit per dunia berikutnya.

---

## 0. Yang dibutuhkan

- Akun gratis: GitHub, Cloudflare, Supabase.
- Node.js 20+ di laptop (untuk `npm run db:seed` dan Supabase CLI via `npx`).
- Kode ini sudah lolos `npm run build` dan `npm run test:db` di laptop.

## 1. Supabase (database + RPC)

1. Buat proyek baru di <https://supabase.com/dashboard> (region terdekat, mis. Singapore). Simpan password database.
2. **SQL Editor → New query**, tempel & jalankan berurutan:
   1. `supabase/migrations/001_init.sql`
   2. `supabase/migrations/002_worker_checks.sql`
   3. `supabase/seed.sql` (10 dunia, **0 warga** — kursi #001 benar-benar untuk follower pertama)

   Mengubah config dunia nanti? `npm run db:seed` lalu jalankan ulang `seed.sql` (aman, counter warga tidak tersentuh).
3. Set rahasia per dunia (SQL Editor; fungsi ini tidak bisa dipanggil dari browser):
   ```sql
   SELECT set_world_secrets('republik-konoha', 'PIN-ADMIN-PANJANG-MIN-8', 'SYNC-SECRET-WORKER-MIN-16-KARAKTER');
   -- ulangi untuk dunia lain yang dipakai, dengan secret BERBEDA per dunia
   ```
   PIN admin dipakai di `#admin`; sync secret hanya untuk worker (Fase 5). Simpan di password manager.
4. **Project Settings → API**: catat **Project URL** dan **anon public key**. (Jangan pernah taruh `service_role`
   key di frontend atau Cloudflare Pages.)

> ℹ️ Proyek Supabase gratis di-*pause* otomatis bila tidak ada aktivitas selama sekitar seminggu. Dengan trafik
> harian dari Reels ini tidak masalah; jika sepi, buka dashboard lalu klik *Restore*.

## 2. Cloudflare Turnstile (anti-bot)

1. Cloudflare dashboard → **Turnstile → Add widget**. Mode: **Managed**.
2. Hostname: semua domain Pages yang akan dipakai, mis. `republikkonoha.pages.dev`, `ptvirtual.pages.dev`, …
   (+ `localhost` bila ingin tes lokal). Lebih rapi **1 widget untuk semua dunia**. Jika batas jumlah hostname
   per widget tercapai, buat widget kedua.
3. Catat **Site Key** (publik → env Pages) dan **Secret Key** (rahasia → Supabase).

## 3. Edge Function `register-citizen`

Dijalankan dari folder proyek di laptop:

```bash
npx supabase login
npx supabase link --project-ref <ref-proyek>      # ref = subdomain di Project URL
npx supabase functions deploy register-citizen --no-verify-jwt
npx supabase secrets set TURNSTILE_SECRET_KEY=<secret-turnstile> IP_HASH_SALT=<string-acak-panjang>
```

- Lebih dari satu widget? Isi `TURNSTILE_SECRET_KEY=secret1,secret2` (dipisah koma).
- `IP_HASH_SALT`: string acak panjang apa saja (mis. hasil `openssl rand -hex 16`). IP mentah tidak pernah disimpan.
- Pastikan `world_states.allow_direct_registration` tetap `false` (default) di production, supaya semua pendaftaran
  wajib lewat Turnstile.

## 4. GitHub

```bash
git init
git add .
git commit -m "Negara Virtual"
git branch -M main
git remote add origin https://github.com/<user>/negara-virtual.git
git push -u origin main
```

`.gitignore` sudah mengecualikan `.env`, `worker/.env`, dan `worker/.ig_state.json`. Repo boleh private.

## 5. Cloudflare Pages — ulangi untuk tiap dunia

1. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git** → pilih repo.
2. **Project name** = subdomain yang diinginkan (mis. `republikkonoha` → `republikkonoha.pages.dev`).
   Nama ini harus sama dengan `domain` di `src/configs/worlds/<id>.ts` (dipakai di KTP & footer).
3. Build settings:

   | Field | Nilai |
   | --- | --- |
   | Framework preset | None (atau Vite) |
   | Build command | `npm run build` |
   | Build output directory | `dist` |

4. **Environment variables (Production):**

   | Nama | Contoh |
   | --- | --- |
   | `VITE_WORLD_ID` | `republik-konoha` |
   | `VITE_SUPABASE_URL` | `https://<ref>.supabase.co` |
   | `VITE_SUPABASE_ANON_KEY` | `eyJ…` (anon key) |
   | `VITE_TURNSTILE_SITE_KEY` | `0x4AAA…` |
   | `VITE_REGISTER_VIA` | `edge` |
   | `NODE_VERSION` | `22` |

5. **Save and Deploy.** Setiap `git push` ke `main` otomatis me-rebuild ke-10 proyek.

`public/_redirects` (fallback SPA) dan `public/_headers` (cache aset 1 tahun + header keamanan) sudah ikut ter-deploy.
Build gagal dengan pesan `VITE_WORLD_ID "…" tidak punya file …`? Berarti `VITE_WORLD_ID` salah ketik.

Domain sendiri (opsional): **Custom domains** di proyek Pages, lalu tambahkan hostname itu ke widget Turnstile dan
perbarui `domain` di config dunia.

## 6. Checklist sebelum video pertama tayang

- [ ] Buka situsnya: badge **MODE SANDBOX tidak muncul** (kalau muncul → env Supabase belum terisi; rebuild).
- [ ] HUD menampilkan **WARGA: 0**.
- [ ] Daftar dengan akun IG uji → dapat **#001** + animasi reveal. Lalu hapus warga uji supaya #001 tetap untuk
      follower asli:
      ```sql
      DELETE FROM citizens WHERE world_id = 'republik-konoha';
      DELETE FROM news_feed WHERE world_id = 'republik-konoha';
      DELETE FROM polls WHERE world_id = 'republik-konoha';
      DELETE FROM project_donations WHERE world_id = 'republik-konoha';
      UPDATE land_plots SET owner_citizen_id = NULL, owner_tag = NULL, owner_number = NULL, building_type = NULL,
        building_name = NULL, building_level = 0, last_income_claim_at = NULL, purchased_at = NULL
        WHERE world_id = 'republik-konoha';
      UPDATE world_states SET last_citizen_number = 0, current_ring_unlocked = 1, active_project_funding = 0,
        president_announcement = '', announcement_by_citizen_id = NULL WHERE world_id = 'republik-konoha';
      ```
- [ ] `#admin` → login PIN → isi **Hari ke-1** dan **total followers** saat ini.
- [ ] Coba dari HP lewat **in-app browser Instagram** (link di bio): peta bisa digeser/cubit, KTP bisa di-download.
- [ ] `#studio` (setelah login admin) → **Mulai Auto-Camera** sambil rekam layar.

## 7. Rutinitas harian (±5 menit)

1. **Ekspor followers resmi** (0% risiko banned): Instagram → Pengaturan → **Pusat Akun (Accounts Center)** →
   *Informasi dan izin Anda* → **Unduh informasi Anda** → pilih akun dunia → *Sebagian informasi* →
   **Pengikut dan mengikuti** → Format **JSON**, rentang **Sepanjang waktu** → Buat file.
   Meta mengirim notifikasi saat file siap (bisa beberapa menit sampai beberapa jam).
2. Ekstrak ZIP, ambil `connections/followers_and_following/followers_1.json` (bisa juga `followers_2.json`, dst.).
3. Situs dunia → `#admin` → **Sync & Verifikasi Followers** → upload → (centang *daftar LENGKAP* bila semua
   file followers sudah digabung) → **Verifikasi Sekarang**. Total followers & "diperbarui …" ikut ter-update.
4. Update **Hari ke-X**, cek antrean moderasi Sidang Warga, dan **Makzulkan Pejabat Gelap** bila perlu drama.
5. Rekam Reels dari `#studio`.

Atau otomatis tiap 02:00 WIB dengan **worker opsional** — lihat [`worker/README.md`](worker/README.md)
(pakai akun IG sekunder; ada risiko pembatasan akun dari Instagram).

## 8. Batas paket gratis & tips hemat

- **Cloudflare Pages:** bandwidth & request situs statis tidak dibatasi; batas jumlah build per bulan cukup untuk
  10 proyek dengan beberapa push per hari. Hindari push puluhan kali per hari (tiap push = 10 build).
- **Supabase:** aplikasi sudah dirancang hemat: polling 45–60 detik (bukan subscription baris), peta maks. 120
  warga, kavling dijual digenerate di klien, Realtime hanya untuk Presence (Tamu online, tidak menulis database).
  Pantau **Reports / Usage** di dashboard saat video FYP; kalau mendekati batas egress, naikkan interval polling di
  `src/App.tsx` (`POLL_WORLD_MS`, `POLL_MAP_MS`).
- **Turnstile:** gratis tanpa batas verifikasi wajar.

## 9. Troubleshooting

| Gejala | Penyebab & solusi |
| --- | --- |
| Badge MODE SANDBOX muncul di production | `VITE_SUPABASE_URL`/`ANON_KEY` kosong saat build → isi env lalu *Retry deployment* |
| "Dunia … belum di-seed" | `seed.sql` belum dijalankan, atau `VITE_WORLD_ID` beda dengan `world_id` di database |
| Daftar gagal "Verifikasi anti-bot gagal" | Hostname belum ditambahkan ke widget Turnstile, atau secret di Supabase salah |
| Daftar gagal HTTP 404/401 | Edge Function belum di-deploy atau lupa `--no-verify-jwt` |
| "Akses admin ditolak" | PIN salah, belum `set_world_secrets`, atau terkunci 15 menit setelah 10x salah |
| KTP tidak bisa di-share di IG in-app browser | Pakai **Download PNG**, lalu unggah manual ke Story (in-app browser membatasi Web Share) |
