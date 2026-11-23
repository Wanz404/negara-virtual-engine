# 🏛️ MASTER SPECIFICATION & PROMPT FOR CLAUDE

## Proyek: Multi-Tenant Interactive Virtual Nation Platform (Pilot: "Republik Konoha")

> **Instruksi Khusus untuk Claude:**
> Kamu bertindak sebagai **Principal Full-Stack Engineer, Game/Canvas Architect, & Product Designer**. Tugasmu adalah membangun aplikasi web simulasi negara/desa virtual yang **production-ready, ringan, mobile-first, multi-tenant (1 codebase untuk 10 dunia berbeda), dan bisa di-deploy dengan biaya Rp 0** menggunakan **Cloudflare Pages + Supabase + Cloudflare Turnstile**.
>
> User juga akan melampirkan file prototipe awal **`republik-konoha.html`** sebagai referensi visual, *vibe*, mekanik inti, dan alur UX. Gunakan prototipe tersebut sebagai fondasi inspirasi, lalu **refactor, perluas, dan tingkatkan kualitasnya** menjadi aplikasi *full-stack* yang jauh lebih rapi, modular, skalabel, dan kaya fitur sesuai spesifikasi lengkap di bawah ini.

## 1. VISI PRODUK & KONTEKS BISNIS (INSTAGRAM REELS ENGINE)

Platform ini dirancang sebagai **"mesin konten viral" untuk ekosistem Instagram Reels / TikTok** bertema *"1 Follower = 1 Warga"*.

* **Alur Akuisisi Penonton:** Penonton melihat video Reels harian (*"Hari ke-X membangun Republik Konoha dari followers"*) → penasaran → klik **link di bio** → langsung melihat peta negara virtual *live* (sekaligus langsung muncul di peta sebagai `Tamu`) → klik **"Daftar Warga"** → isi username IG → dapat nomor urut asli & jabatan eksklusif → *download* **KTP Virtual (PNG)** → pamer di IG Story (promosi organik) → sistem memverifikasi status follow dalam 1x24 jam agar jabatan & KTP-nya resmi **Dilantik/Sah**.

* **Strategi Multi-Akun (10 Akun IG = 10 Web Dunia):** Daripada membuat 10 repositori terpisah, seluruh 10 web harus berjalan dari **1 Codebase & 1 Database Supabase yang sama**, dibedakan hanya melalui satu konfigurasi *Environment Variable* (`VITE_WORLD_ID`).

* **Pilot Project #1:** **Republik Konoha** (`republikkonoha.pages.dev`) — memakai kata "Konoha" sebatas *branding* judul/satire tongkrongan sosmed Indonesia, sementara seluruh isi jabatan, *landmark*, dan humornya murni parodi sosial-politik lokal Indonesia (Presiden, Wapres, Menteri, DPR, Konglomerat, Warung Madura 24 Jam, Ojol, Kang Parkir, dll.). **Tetap aman secara hukum (100% fiktif/parodi, tidak menyebut tokoh/partai dunia nyata).**

## 2. ATURAN EMAS SISTEM (NON-NEGOTIABLE RULES)

Claude **WAJIB** mematuhi aturan inti berikut tanpa kompromi:

1. **STRICT FIRST-COME, FIRST-SERVED (BUKAN RANDOM!):**

   * Penentuan nomor urut warga **TIDAK BOLEH ACAK**.

   * Jika **Novi** adalah orang nyata pertama yang mendaftar di web ini, sistem **WAJIB** menetapkan Novi sebagai **`Novi | 001` (Presiden)**. Orang kedua yang mendaftar mendapat **`002` (Wakil Presiden)**, orang ketiga mendapat **`003` (Menteri Keuangan)**, dan seterusnya secara berurutan mutlak.

   * Penentuan nomor wajib menggunakan **Atomic Database Increment (PostgreSQL RPC + Row-Level Locking)** agar meskipun 100 orang klik tombol daftar di milidetik yang sama saat video FYP, **tidak akan pernah terjadi nomor kembar** atau urutan melompat.

   * **Production Mode = 0 Fake/Seeded Users:** Di *production*, database harus mulai bersih dari **0 warga** agar kursi `#001` benar-benar diklaim oleh follower asli pertama (sediakan tombol *demo/sandbox seeding* hanya di mode lokal/development).

2. **BLIND REVEAL SUSPENSE (TANPA SPOILER DI FORM):**

   * Di halaman pendaftaran, **JANGAN PERNAH** membocorkan nomor urut berapa yang akan didapat user sebelum mereka menekan submit (misal, jangan tampilkan *"Klaim Warga #48"*).

   * User cukup mengisi `@username_ig` + pilih warna/gaya avatar → klik submit.

   * Selama 1,5 detik setelah server mengembalikan nomor urut asli mereka, tampilkan **animasi *roulette*/stempel** sekadar untuk efek deg-degan visual, lalu *reveal* hasil asli mereka (misal: **`Novi | 001 — Presiden Republik Konoha`**) disertai konfeti & suara fanfare.

3. **ZERO-COST MULTI-TENANT ARCHITECTURE:**

   * Harus berjalan 100% di *free tier* **Cloudflare Pages** (hosting unlimited bandwidth) + **Supabase Free Tier** (PostgreSQL + Edge/RPC + Realtime Presence ringan) + **Cloudflare Turnstile** (anti-bot gratis).

   * Jangan pernah meng-query seluruh 10.000+ baris warga sekaligus saat halaman dibuka! Gunakan *viewport culling*, *pagination*, dan sampling pintar (selalu render user sendiri + Top 20 pejabat + warga aktif terbaru + bangunan di area kamera + tamu online via Presence).

4. **MOBILE-FIRST & 60 FPS PERFORMANCE:**

   * 95%+ trafik berasal dari *in-app browser* Instagram di HP (layar vertikal). UI harus responsif, *touch-friendly* (pan 1 jari, pinch-to-zoom 2 jari), dan kanvas tetap mulus 60 FPS.

## 3. FITUR LENGKAP A–Z

### A. Pendaftaran Cepat ("Klaim KTP Warga") & Format Identitas

* **Tanpa Login Ribet:** Tidak perlu email, password, atau OTP. Cukup input **`@username_instagram`** (unik per `world_id`, validasi ketat sesuai aturan Instagram: huruf, angka, titik, garis bawah `^[a-zA-Z0-9._]{1,30}$`, melarang user memasukkan handle akun resmi dunia itu sendiri seperti `@republikkonoha`, serta dilengkapi filter kata kasar), nama panggilan/tampilan (opsional maks. 16 karakter), dan pilihan kustomisasi avatar ringan (warna baju/aksesoris dasar).

* **Pemberitahuan Verifikasi Transparan:** Di form pendaftaran tampilkan pesan jelas: *"Satu kali saja. Setelah disimpan, pengecekan follow `@republikkonoha` dilakukan otomatis maksimal 1x24 jam. KTP-mu bisa langsung dilihat setelah username Instagram disimpan."*

* **Sesi Persisten:** Setelah daftar, simpan `citizen_token` (UUID rahasia dari server) & `citizen_id` di `localStorage` agar user tetap dikenali saat kembali besok (bisa juga sediakan fitur *"Masuk KTP / Kode Pemulihan"* menggunakan nomor KTP + PIN 4-digit opsional agar user bisa memindahkan sesi jika ganti browser/HP).

* **Format Penulisan Identitas:** Selalu gunakan format ringkas ala tag profil game:

  * Nomor 1–999: *zero-padded* 3 digit → **`Novi | 001`**, **`Wanz | 045`**, **`Budi | 999`**.

  * Nomor 1000+: tanpa padding → **`Raka | 1000`**, **`Siti | 2450`**.

* **Soft-Gate Follow IG (Opsional di Config):** Sediakan opsi konfigurasi untuk menampilkan tombol langkah ringan *"Step 1: Follow @republikkonoha"* (membuka profil IG di tab baru, lalu membuka kunci tombol daftar setelah 3 detik).

### B. Sistem Hierarki Kasta & Jabatan (Republik Konoha)

Nomor urut secara deterministik menentukan kasta, jabatan, tampilan karakter, serta *privilege* di peta:

| Nomor Urut | Golongan / Kasta | Jabatan Spesifik | Visual & Privilege |
| :--- | :--- | :--- | :--- |
| **`001`** | **RI 1 (Presiden)** | Presiden Republik Konoha | Mahkota emas, jas + dasi merah, tinggal di Istana Negara, nama terpampang di plakat Istana, hak mengajukan **Dekrit / Proposal Proyek Nasional**. |
| **`002`** | **RI 2 (Wapres)** | Wakil Presiden Konoha | Bintang emas, jas + dasi emas, area Istana Negara, hak mengajukan proposal proyek. |
| **`003 – 030`** | **Kabinet Menteri** | Urut tetap (Menkeu, Menteri Perkopian & WFA, Menteri Urusan Gabut, Menteri Sinyal & Kuota, Menteri Perparkiran, dll. — total 28 kursi) | Jas rapi, *nametag* emas, kantor di Ring 1, pendapatan kerja lebih tinggi. |
| **`031 – 060`** | **Senayan & Pejabat** | Ketua DPR, Anggota Dewan, Stafsus, Gubernur, Walikota | Area Gedung DPR (atap kura-kura hijau + animasi `"Zzz"`), *nametag* biru langit. |
| **`061 – 100`** | **Konglomerat / Naga** | Bos Tambang, Sultan Properti, Owner Bank, Bos Sawit, Investor Asing | Kacamata hitam, area Kompleks Konglomerat (helipad + kolam renang), *nametag* ungu neon, diskon/bonus beli kavling properti. |
| **`101 – 250`** | **Ring 2 & Orang Dalam** | Komisaris BUMN, Artis Ibukota, Influencer Centang Biru, Pengacara Kondang | *Nametag* teal/toska, area distrik komersial elit. |
| **`251 – 500`** | **Penguasa Akar Rumput** | Ketua Ormas, Juragan Kosan, Ketua RT/RW, ASN Senior, Mandor Proyek | *Nametag* oranye/perunggu, tersebar di area pemukiman & jalan utama. |
| **`501 – 1000`** | **Ikon Jalanan & Pekerja** | Penjaga Warung Madura 24 Jam, Driver Ojol, Kang Parkir Minimarket, Barista SCBD, Karyawan Swasta | Atribut khas (helm/jaket ijo Ojol, peluit parkir), area Gerbang & Warung. |
| **`1001+`** | **Rakyat Jelata (Sipil)** | Profesi lucu berbasis hash nomor urut: Mahasiswa Abadi, Sobat Misqueen, Pengangguran Banyak Acara, Pejuang UMR, Kaum Rebahan | Tampilan standar, tetap bisa menjadi **Tuan Tanah / Warga Terkaya** lewat rajin kerja, beli tanah, & bangun properti! |

### C. Generator KTP Virtual (Siap Share IG Story)

* Render otomatis di sisi klien menggunakan **HTML5 Canvas Resolusi Tinggi (900x1200 / rasio 3:4 atau 1080x1920 siap Story)**.

* Isi KTP:
  * Header resmi negara + subtitle disclaimer kecil: *"Kartu Tanda Penduduk versi virtual • bukan dokumen resmi"*.
  * *Border* warna sesuai kasta (Emas untuk Top 30, Ungu untuk Konglo, dst.) + avatar chibi warga.
  * Teks besar **`Novi | 001`**, badge kasta, nama jabatan, kode KTP unik (misal `RK-0001`), alamat otomatis berbasis zona (misal **`RT 01 / RW 01 • Ring 1`**), **`WARGA SEJAK DAY X`**, jumlah kekayaan (`RpK`), dan status kepemilikan properti.
  * **Stempel Status Dinamis:**
    * Jika `pending`: Stempel kuning **"MENUNGGU PELANTIKAN"** *(Cek follow otomatis 1x24 jam)*.
    * Jika `verified`: Stempel merah/emas **"DUKCAPIL SAH • RESMI DILANTIK"**.
    * Jika `not_following`: Stempel abu/merah **"BELUM FOLLOW / WARGA GELAP"**.
  * Footer domain resmi web + handle IG negara (`@republikkonoha`).

* **Panel Kelola Instagram di Bawah KTP (Modal KTP):**
  * Menampilkan `@username_instagram` yang tertaut dan status verifikasi terkini (`menunggu verifikasi • dicek otomatis 1x24 jam`, `Terverifikasi ✓`, atau `Belum Follow ⚠️`).
  * Tombol **"Ganti Instagram"** (jika user typo saat mengetik username, dibatasi cooldown ringan agar tidak disalahgunakan).
  * Tombol **"Cek Ulang"** (menandai ulang akun ke antrean prioritas pengecekan follow berikutnya setelah user benar-benar mem-follow).

* Tombol **"Download PNG"** + integrasi **Web Share API** (`navigator.share`) agar di HP langsung bisa dibagikan ke Instagram Story / WhatsApp.

### D. Peta 2D Interaktif & Sistem Ekspansi Wilayah Dinamis (AUTO-EXPANDING MAP)

Peta bukan sekadar latar statis, melainkan kota hidup yang **melebar secara otomatis seiring bertambahnya populasi warga**:

* **Sistem Zona / Ring Konsentris (Grid Kavling):**

  * **Ring 0 (Inti Pusat — Selalu Terbuka):** Alun-Alun Tugu Konoha, Istana Negara, Gedung DPR (dengan animasi `Zzz`), Kompleks Konglomerat, Warung Madura 24 Jam, Gerbang Konoha & Pangkalan Ojol, serta Zona Proyek Nasional.

  * **Ring 1 (Distrik Perintis — Terbuka sejak 0 warga):** Kavling tanah eksklusif dekat pusat pemerintahan & distrik komersial (`RT 01 / RW 01`).

  * **Ring 2 (Distrik Kota Baru — Terbuka otomatis saat populasi ≥ 100 warga):** Perluasan jalan raya, taman baru, dan ratusan kavling pemukiman/ruko baru (`RT 02 / RW 02`).

  * **Ring 3 (Megapolitan / Pulau Reklamasi — Terbuka saat populasi ≥ 500 warga):** Jembatan penghubung ke pulau baru dengan kavling-kavling baru (`RT 03 / RW 03`).

  * **Ring N (Ekspansi Tak Terbatas):** Algoritma *procedural chunk/ring expansion* membuka blok kavling baru secara otomatis setiap kali tingkat keterisian kavling mencapai 80% atau populasi menembus *milestone* baru (1.000, 2.500, 5.000, dst.), sehingga lahan tidak akan pernah habis.

* **Sistem Populasi Hybrid:**

  * Total populasi kota terhubung dengan jumlah follower Instagram terbaru (disinkronkan berkala). Jika jumlah follower IG lebih besar dari pendaftar web, tampilkan **Warga NPC polos (tanpa nama)** agar kota tetap terasa ramai sesuai angka follower, sementara warga terdaftar muncul dengan *nametag*, kostum jabatan, dan balon status, serta pengunjung yang sedang membuka web muncul secara *real-time* sebagai **`Tamu XXXX`**.

### E. Sistem Beli Tanah & Bangun Properti Mandiri (LAND OWNERSHIP & CITY BUILDER)

Agar warga tidak bosan dan memiliki rasa kepemilikan nyata di peta, implementasikan sistem ekonomi properti:

1. **Kavling Tanah (`land_plots`):**

   * Peta memiliki petak-petak tanah kosong (*For Sale / Dijual*) di sepanjang jalan raya pada setiap Ring.

   * Harga kavling berbeda berdasarkan lokasi (Ring 1 dekat Istana lebih mahal daripada Ring 2/Ring 3).

   * Warga bisa klik kavling kosong di peta → muncul kartu detail (*"Kavling #B14 — Harga: 150 RpK"*) → klik **"Beli Tanah"**.

   * Setelah dibeli, kavling langsung terpasang papan nama pemiliknya: **`Milik Novi | 001`**.

2. **Bangun & Upgrade Properti Mandiri:**

   * Di atas tanah miliknya, warga bisa memilih jenis bangunan untuk didirikan (menggunakan `RpK`):

     * **Kategori Hunian:** Rumah Sederhana, Kos-kosan 10 Pintu, Rumah Minimalis, Villa Sultan, Mansion Helipad.

     * **Kategori Usaha / Komersial:** Gerobak Kopi / Angkringan, Warung Kelontong, Ruko Seblak, Kafe SCBD, Gedung Pencakar Langit / Kantor PT.

     * **Kategori Pemerintahan & Umum (Khusus Pejabat / Izin Pemerintah):** Pos Ronda, Balai RT, Kantor Kementerian Cabang, Patung Monumen Pribadi.

   * **Nama Bangunan Custom:** Pemilik boleh menamai bangunannya (maks. 24 karakter, dengan filter kata kasar), misal: *"Warkop Mas Budi"*, *"Kosan Ibu Rina"*, atau *"Menara Novi"*.

   * **Sistem Upgrade (Level 1 → Level 5):** Pemilik bisa meng-upgrade bangunan agar bentuk visualnya di peta makin megah/tinggi dan menghasilkan **Pendapatan Pasif (Pajak/Sewa Harian)** yang bisa diklaim setiap hari!

   * **Patungan Bangun Gedung Bersama (Joint Venture / Klan):** Beberapa warga bisa ikut menyumbang `RpK` ke sebuah proyek bangunan besar (misal: Markas Komunitas, Masjid/Taman Kota, atau Mall) — daftar penyumbang teratas akan terukir di plakat gedung saat diklik di peta.

### F. Sistem Pemerintahan, Kebijakan, & Patungan Proyek Nasional

Menghidupkan dinamika *roleplay* antara pemerintah (`#001–#060`) dan rakyat (`#061+`):

* **Kas Negara & Patungan Proyek Nasional:**

  * Di peta selalu ada 1 proyek nasional aktif (*Global Progress Bar*), misal: *Proyek 1: Stasiun MRT Konoha* → selesai 100% langsung berubah visual menjadi Stasiun MRT lengkap dengan kereta berjalan → berlanjut ke *Proyek 2: Jalan Tol Layang* → *Proyek 3: Bandara Internasional Konoha* → *Proyek 4: Stadion GBK Konoha*.

  * Warga bisa menyumbang `RpK` ke proyek nasional dan masuk leaderboard **Top Penyumbang Proyek** (nama 3 besar terpajang di *landmark* proyek).

* **Hak Istimewa Pemerintahan (Governance Loop):**

  * **Presiden (`#001`) & Wapres (`#002`):** Bisa menulis **"Pidato / Pengumuman Negara"** yang ter-pin di *Breaking News Konoha TV*, serta memilih opsi kandidat proyek nasional berikutnya untuk divoting rakyat.

  * **Kabinet Menteri (`#003–#030`) & DPR (`#031–#060`):** Bisa mengajukan usulan kebijakan/voting lucu (dimoderasi otomatis/admin) seperti *"Ubah warna Tugu Konoha jadi pink"*, *"Diskon harga tanah 20% hari ini"*, atau *"Bonus gaji kerja 2x lipat akhir pekan"*.

* **Sidang Warga (Live Voting):**

  * Setiap warga sah punya hak 1 suara untuk voting kebijakan atau penentuan bangunan di lahan proyek berikutnya.

### G. Aktivitas Harian Warga (Retensi Harian)

* **Tombol Kerja / Absen (Cooldown 1–3 jam di Production, bisa diatur di Config):** Label & nominal `RpK` menyesuaikan jabatan (Presiden: *"Tanda Tangan Keppres"*, Menteri: *"Rapat Paripurna"*, Konglo: *"Cairin Dividen"*, Ojol: *"Narik Orderan"*). Muncul efek animasi melayang `+25 RpK` di atas kepala karakter.

* **Klaim Hasil Properti (Passive Income):** Bagi warga yang sudah membangun rumah/ruko/kosan di tanahnya, muncul ikon koin mengambang di atas gedung untuk diklaim.

* **Update Status & Konoha TV (Breaking News Ticker):** Warga bisa mengetik 1 kalimat pendek (maks. 50 karakter, cooldown) yang langsung muncul sebagai **balon chat** di atas karakter di peta DAN berjalan di *running text* berita bagian atas layar.

### H. Leaderboard "Buku Sejarah Negara"

* **4 Tab Utama:**

  1. **Top 1–100 (Pendiri & Elit)** — highlight warna emas/ungu/biru + lencana centang hijau bagi yang sudah terverifikasi follow.

  2. **101–1000 (Generasi 1)** — pagination (*Load More* per 50 baris).

  3. **Terkaya (`RpK`)** — memberi peluang warga `#2500` menyalip pejabat!

  4. **Tuan Tanah (Properti Terbanyak / Level Tertinggi)**.

* **Fitur Wajib:**

  * Pencarian instan (*Search* berdasarkan username, nomor, atau jabatan).

  * **Click-to-Locate:** Klik nama warga mana pun → modal menutup → kamera terbang mulus + *zoom-in* + sorotan cahaya (*spotlight*) ke karakter atau properti warga tersebut di peta.

  * **Sticky Footer "Posisi Kamu":** Selalu menampilkan peringkat user yang sedang login.

### I. Mode Kreator & Auto-Camera Reels (9:16) + Admin Panel

Karena proyek ini untuk produksi konten IG Reels harian di 10 akun:

* **Akses Aman:** Panel Kreator/Admin hanya bisa dibuka via shortcut/URL khusus + PIN Admin (tidak mengganggu warga biasa, berbeda dari prototipe demo yang terbuka umum).

* **Mode Rekam Reels (9:16):**

  * Menampilkan bingkai tepat rasio **9:16**, menyembunyikan HUD tombol yang tidak perlu, menampilkan *header* siaran (*"HARI KE-X • REPUBLIK KONOHA"*) dan *live counter* populasi.

  * **Auto-Camera Sequence:** Kamera otomatis berpindah sinematik: *(1) Istana Negara & Presiden → (2) Spotlight 3 Warga Terbaru yang baru daftar → (3) Sorot Bangunan/Properti Baru yang baru dibangun warga → (4) Update Proyek Nasional (MRT) → (5) Zoom-out memperlihatkan seluruh kota yang makin padat + CTA "Klaim KTP di Link Bio"*.

* **Admin Controls:** Update angka Hari ke-X, sinkronisasi jumlah total follower IG (+ timestamp otomatis), **Import File JSON Followers untuk Batch-Verifikasi Follow**, buat/ganti Polling Sidang Warga, moderasi/hapus status atau nama bangunan yang melanggar aturan, eksekusi pemakzulan pejabat yang belum follow >48 jam, serta kelola proyek nasional.

### J. Sinkronisasi Follower IG, Verifikasi Follow 1x24 Jam, & Live Tamu Online (FITUR TERBARU!)

Terinspirasi dari pola *batch-sync* yang terbukti sukses dan aman terhadap kebijakan Meta/Instagram:

1. **Sinkronisasi Populasi Web ↔ Followers Instagram (Dengan Timestamp Transparan):**
   * Di HUD kiri atas peta, tampilkan kartu populasi utama yang terhubung dengan total followers akun IG dunia tersebut:
     * **`WARGA: 168.121`** (angka sinkronisasi total followers IG atau nilai maksimum antara followers IG & warga terdaftar).
     * Sub-teks transparan di bawahnya: **`diperbarui 12 Nov 2026 · 02:00`** (diambil dari `world_states.followers_synced_at`).
     * Tampilkan juga badge kecil **`DAY 24`** dan indikator hijau menyala **`19 warga online`**.
   * **Cara Update Populasi (Zero-Risk):** Admin bisa mengupdate angka follower harian langsung di Admin Panel (atau otomatis saat mengupload file followers / via skrip cron ringan harian jam 02:00 WIB) yang sekaligus memperbarui timestamp `followers_synced_at`.

2. **Sistem Verifikasi Follow Otomatis Maksimal 1x24 Jam (Anti-Curang & 0% Risiko Banned):**
   * Karena Instagram tidak menyediakan API publik gratis untuk cek status follow secara *real-time*, verifikasi dilakukan secara **Batch Asynchronous (Antrean Maksimal 1x24 Jam)** dengan 2 metode yang harus didukung oleh backend:
     * **Metode 1 — Admin Batch Upload (Wajib Ada, 0% Risiko Banned, 100% Gratis):**
       * Di Admin Panel, sediakan fitur **"Sync & Verifikasi Followers (Upload JSON / CSV / Paste List)"**.
       * Admin cukup mengunggah file resmi ekspor Meta Accounts Center (`followers_1.json` — parser harus otomatis mendeteksi format JSON resmi Instagram seperti `string_list_data[].value`, array JSON sederhana, maupun daftar username per baris).
       * Sistem langsung memanggil RPC `batch_verify_followers` yang dalam <1 detik membandingkan seluruh warga berstatus `pending` atau `recheck_requested` terhadap daftar follower tersebut:
         * **Ketemu di daftar followers** → `follow_status = 'verified'`, `follow_checked_at = NOW()`.
         * **Tidak ketemu di daftar followers** → `follow_status = 'not_following'`, `follow_checked_at = NOW()`.
       * Sekaligus otomatis memperbarui `ig_follower_count` & `followers_synced_at` di `world_states`!
     * **Metode 2 — Standalone Automation Worker Script (Opsional untuk Full-Auto):**
       * Sediakan skrip terpisah di folder `/worker/verify_followers.py` (Python Playwright) yang berjalan terjadwal (misal tiap hari jam 02:00 WIB di laptop/VPS kreator) menggunakan akun sekunder/tumbal.
       * Skrip hanya menarik daftar warga dengan `follow_status IN ('pending', 'recheck_requested')` lewat endpoint/RPC ber-API Key, mengecek dengan jeda lambat & aman, lalu mengirim hasil verifikasi ke Supabase RPC `batch_verify_followers`.

3. **Integrasi Status Follow dengan Mekanik Jabatan "Pelantikan vs Pemakzulan":**
   * **`pending` (Menunggu Pelantikan — 0–24 jam pertama):** User langsung mendapat nomor urut & KTP sementara, sudah bisa melihat karakternya di peta, melakukan kerja harian (`RpK`), dan *download* KTP untuk dipamerkan di Story IG.
   * **`verified` (Resmi Dilantik ✓):** Badge/stempel KTP berubah menjadi **SAH**, *nametag* menyala sesuai warna kasta, dan akses penuh terbuka (beli tanah, bangun properti, patungan proyek, voting, serta panel dekrit bagi Presiden/Menteri).
   * **`not_following` (Warga Gelap / Belum Follow ⚠️):** Akses beli tanah, patungan, dan hak pemerintahan dikunci sementara. Muncul banner di KTP: *"Akun `@username` belum terdeteksi follow `@republikkonoha`. Follow dulu lalu klik **Cek Ulang** atau **Ganti Instagram**."*
   * **Mekanik Pemakzulan Kursi Elit (Opsional di Admin Panel — Bahan Drama Reels!):** Khusus pejabat kursi `#001–#100`, jika berstatus `not_following` lebih dari 48 jam, Admin memiliki tombol **"Makzulkan Pejabat Gelap"** yang mengubah statusnya menjadi `impeached` (turun kasta menjadi Rakyat Jelata/Warga Gelap) dan mencatat berita panas otomatis di *Konoha TV* (*"BREAKING NEWS: Menteri Keuangan #003 resmi dimakzulkan karena ketahuan belum follow!"*).

4. **Live Online Counter & Karakter "Tamu" Real-Time (`Supabase Realtime Presence`):**
   * Gunakan **Supabase Realtime Presence** (channel per `world_id`, misal `presence:republik-konoha`) — fitur ini *ephemeral* (tidak memakan kuota *write* database dan sangat ringan di *free tier*).
   * Begitu siapa saja membuka halaman web:
     * Indikator **`🟢 X warga online`** di kiri atas langsung diperbarui *real-time*.
     * **Jika pengunjung belum punya KTP:** Otomatis muncul karakter sementara di peta dengan tag acak 4 karakter seperti **`Tamu ONI`**, **`Tamu BMPI`**, atau **`Tamu 8CJT`** yang berjalan santai di sekitar Alun-Alun. Begitu tab ditutup, karakter Tamu hilang otomatis.
     * **Jika pengunjung sudah terdaftar:** Karakter aslinya diberi indikator titik hijau online kecil di sebelah *nametag*-nya.
   * Tambahkan juga tombol cepat di sisi kanan peta: **`Deket`** (zoom cepat ke area padat/lokasi diri sendiri) dan tombol **`Pengumuman / Megaphone`** (buka *Breaking News* & Pidato Presiden).

## 4. BLUEPRINT 10 DUNIA VIRTUAL (MULTI-TENANT CONFIG MATRIX)

Seluruh 10 dunia di bawah ini harus bisa dijalankan hanya dengan mengganti file konfigurasi di `src/configs/worlds/<worldId>.ts` dan *Environment Variable* `VITE_WORLD_ID`:

| No | `world_id` & Nama | Domain Cloudflare Gratis | Hierarki Kasta (`001` → `1001+`) | Mata Uang | Tema Properti & Proyek |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | `republik-konoha` — **Republik Konoha** *(Pilot)* | `republikkonoha.pages.dev` | Presiden → Wapres → Menteri → DPR → Konglo → Ring 2 → Ormas/RT → Ojol/Warung Madura → Rakyat Jelata | `RpK` | Kosan, Warung, Mansion / Proyek: MRT, Tol, Bandara |
| **2** | `pt-virtual` — **PT Virtual SCBD** | `ptvirtual.pages.dev` | CEO/Founder → Komisaris → Direktur → HRD → Manager → Senior → Staff → Anak Magang | `Gaji` | Kubikel, Ruang Meeting, Kafe Kopi / Proyek: Mesin Kopi, Rooftop, THR |
| **3** | `kampus-virtual` — **Kampus Konoha** | `kampusvirtual.pages.dev` | Rektor → Dekan → Dosen Killer → Ketua BEM → Senior → Kupu-kupu → Maba Abadi | `SKS` | Kantin, Kos Mahasiswa, Perpus / Proyek: AC Kelas, Parkiran, Wi-Fi |
| **4** | `kampung-mistis` — **Kampung Mistis** | `kampungmistis.pages.dev` | Sesepuh/Ratu Gaib → Mbah Dukun → Genderuwo → Kuntilanak → Pocong Senior → Tuyul Magang → Warga Nyasar | `Kemenyan` | Pohon Beringin, Rumah Kosong, Warung Sate / Proyek: Kuburan Elit |
| **5** | `kerajaan-nusantara` — **Kerajaan Nusantara** | `kerajaannusantara.pages.dev` | Raja/Ratu → Mahapatih → Panglima → Pendekar → Saudagar → Prajurit → Rakyat Jelata | `Keping` | Padepokan, Pasar Rempah, Pendopo / Proyek: Candi Agung, Kapal Perang |
| **6** | `guild-petualang` — **Guild Isekai** | `guildisekai.pages.dev` | Guild Master → S-Rank → Archmage → A-Rank → Blacksmith → B/C-Rank → F-Rank / NPC | `Gold` | Tavern, Bengkel Senjata, Menara Sihir / Proyek: Raid Boss, Markas Guild |
| **7** | `kota-mafia` — **Kota Mafia** | `kotamafia.pages.dev` | Godfather → Consigliere → Capo → Hitman → Hacker → Bandar → Informan → Preman Pasar | `Cash` | Gudang Rahasia, Kasino, Bar / Proyek: Pelabuhan Gelap, Bunker |
| **8** | `pulau-penjara` — **Pulau Penjara** | `pulaupenjara.pages.dev` | Kepala Sipir → Bos Geng Sel → Napi Senior → Koki Penjara → Penyelundup → Tahanan Baru | `Rokok` | Sel VIP, Dapur, Gym / Proyek: Gali Terowongan Kabur 100% |
| **9** | `koloni-mars` — **Koloni Mars** | `kolonimars.pages.dev` | Komandan → Ilmuwan Utama → Pilot Roket → Teknisi AI → Astronot → Penumpang Gelap | `O2` | Habitat Pod, Panel Surya, Lab / Proyek: Kubah Oksigen, Roket Jupiter |
| **10** | `kerajaan-kucing` — **Kerajaan Kucing** | `kerajaankucing.pages.dev` | Kucing Oren Barbar → Kucing Ras → Kucing Abu → Kucing Kampung → Kitten | `Whiskas` | Kardus Bekas, Cat Tree, Toko Ikan / Proyek: Menara Kardus Raksasa |

## 5. ARSITEKTUR TEKNIS RP 0 (TECH STACK & DEPLOYMENT)

### Rekomendasi Stack Modern untuk Refactoring:

* **Frontend Framework:** **Vite + React + TypeScript + Tailwind CSS** (sangat cepat, *tree-shaking* kecil, tipe data aman untuk konfigurasi multi-tenant).

* **2D Map Renderer:** **PixiJS v8** *atau* **Optimized HTML5 Canvas 2D Engine** (terpisah dalam modul `src/engine/` dengan *viewport culling*, *spatial hashing/grid* untuk klik properti/warga, dan *requestAnimationFrame* loop terisolasi dari React re-render).

* **Backend & Database:** **Supabase (PostgreSQL + Row Level Security + Database Functions/RPC + Realtime Presence untuk Tamu Online)** — 1 proyek Supabase dipakai bersama oleh 10 dunia melalui kolom `world_id`.

* **Follower Verification Worker (Opsional):** Folder `/worker/verify_followers.py` (Python Playwright) yang terhubung aman via `ADMIN_SYNC_SECRET` ke Supabase RPC, sebagai pelengkap fitur **Upload JSON Followers** di Admin Panel.

* **Hosting:** **Cloudflare Pages** — hubungkan 1 repositori GitHub ke 10 proyek Cloudflare Pages, cukup bedakan *Environment Variable*:

  * `VITE_WORLD_ID=republik-konoha` (atau `pt-virtual`, dst.)

  * `VITE_SUPABASE_URL=...`

  * `VITE_SUPABASE_ANON_KEY=...`

  * `VITE_TURNSTILE_SITE_KEY=...`

* **Anti-Bot / Anti-Spam:** **Cloudflare Turnstile** (mode *invisible/managed* gratis) diverifikasi di Supabase Edge Function sebelum membuat warga baru.

## 6. SKEMA DATABASE POSTGRESQL / SUPABASE (ATOMIC FCFS, FOLLOW VERIFICATION & LAND PLOTS)

Gunakan skema terpusat berikut (semua tabel terisolasi per `world_id`):

```sql
-- 1. Counter atomik & state global per dunia (MENJAMIN STRICT FCFS + SYNC FOLLOWER)
CREATE TABLE world_states (
  world_id TEXT PRIMARY KEY,
  ig_account_handle TEXT NOT NULL DEFAULT 'republikkonoha',
  last_citizen_number INTEGER NOT NULL DEFAULT 0,
  day_number INTEGER NOT NULL DEFAULT 1,
  ig_follower_count INTEGER NOT NULL DEFAULT 0,
  followers_synced_at TIMESTAMPTZ DEFAULT NOW(),
  current_ring_unlocked INTEGER NOT NULL DEFAULT 1,
  active_project_id TEXT NOT NULL DEFAULT 'mrt_konoha',
  active_project_funding BIGINT NOT NULL DEFAULT 0,
  active_project_goal BIGINT NOT NULL DEFAULT 50000,
  active_project_completed BOOLEAN NOT NULL DEFAULT FALSE,
  president_announcement TEXT DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Tabel Warga (Terdaftar + Status Verifikasi Follow IG 1x24 Jam)
CREATE TABLE citizens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id TEXT NOT NULL REFERENCES world_states(world_id),
  citizen_number INTEGER NOT NULL,
  ktp_code TEXT NOT NULL, -- cth: "RK-0001" atau kode alfanumerik singkat
  username TEXT NOT NULL, -- nama tampilan di peta & KTP
  ig_username TEXT NOT NULL, -- username IG murni tanpa '@' (lowercase) untuk cek follow
  follow_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (follow_status IN ('pending', 'verified', 'not_following', 'recheck_requested', 'impeached')),
  follow_checked_at TIMESTAMPTZ,
  follow_recheck_requested_at TIMESTAMPTZ,
  joined_day INTEGER NOT NULL DEFAULT 1,
  rt_rw_address TEXT NOT NULL DEFAULT 'RT 01 / RW 01',
  secret_token UUID NOT NULL DEFAULT gen_random_uuid(), -- validasi aksi tanpa password
  avatar_color TEXT NOT NULL DEFAULT '#ef4444',
  tier_id TEXT NOT NULL,
  role_title TEXT NOT NULL,
  coins BIGINT NOT NULL DEFAULT 20,
  total_donated BIGINT NOT NULL DEFAULT 0,
  status_text TEXT DEFAULT '',
  last_work_at TIMESTAMPTZ,
  last_status_at TIMESTAMPTZ,
  ip_hash TEXT, -- SHA-256 hash IP untuk rate-limit ringan anti penimbun nomor
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(world_id, citizen_number),
  UNIQUE(world_id, LOWER(username)),
  UNIQUE(world_id, LOWER(ig_username))
);

CREATE INDEX idx_citizens_world_num ON citizens(world_id, citizen_number);
CREATE INDEX idx_citizens_world_coins ON citizens(world_id, coins DESC);
CREATE INDEX idx_citizens_follow_queue ON citizens(world_id, follow_status)
  WHERE follow_status IN ('pending', 'recheck_requested');

-- 3. Tabel Kavling Tanah & Properti Bangunan Warga
CREATE TABLE land_plots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id TEXT NOT NULL REFERENCES world_states(world_id),
  plot_code TEXT NOT NULL,           -- cth: "R1-A04", "R2-B12"
  ring_level INTEGER NOT NULL,       -- 1, 2, 3...
  grid_x INTEGER NOT NULL,           -- koordinat grid peta
  grid_y INTEGER NOT NULL,
  price BIGINT NOT NULL,
  owner_citizen_id UUID REFERENCES citizens(id),
  building_type TEXT,                -- 'rumah', 'kosan', 'warung', 'kafe', 'mansion', 'kantor', dll.
  building_name TEXT,                -- nama custom maks 24 karakter
  building_level INTEGER NOT NULL DEFAULT 0, -- 0 = tanah kosong, 1..5 = terisi & upgrade
  last_income_claim_at TIMESTAMPTZ,
  purchased_at TIMESTAMPTZ,
  UNIQUE(world_id, plot_code)
);

CREATE INDEX idx_plots_world_ring ON land_plots(world_id, ring_level);

-- 4. Tabel Berita & Log Aktivitas (Konoha TV Breaking News)
CREATE TABLE news_feed (
  id BIGSERIAL PRIMARY KEY,
  world_id TEXT NOT NULL REFERENCES world_states(world_id),
  citizen_id UUID REFERENCES citizens(id),
  category TEXT NOT NULL DEFAULT 'status', -- 'join', 'status', 'property', 'project', 'decree', 'impeachment'
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Tabel Voting Kebijakan (Sidang Warga)
CREATE TABLE polls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id TEXT NOT NULL REFERENCES world_states(world_id),
  question TEXT NOT NULL,
  options JSONB NOT NULL, -- [{"id":"a","label":"...","votes":0}, ...]
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_citizen_id UUID REFERENCES citizens(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE poll_votes (
  poll_id UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  citizen_id UUID NOT NULL REFERENCES citizens(id) ON DELETE CASCADE,
  option_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (poll_id, citizen_id)
);
```

### Wajib Gunakan Atomic RPC untuk Pendaftaran FCFS & Batch Verifikasi Follow:

```sql
-- A. Pendaftaran Warga Strict First-Come, First-Served
CREATE OR REPLACE FUNCTION register_citizen_atomic(
  p_world_id TEXT,
  p_username TEXT,
  p_ig_username TEXT,
  p_avatar_color TEXT,
  p_ip_hash TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_next_num INTEGER;
  v_day_num INTEGER;
  v_official_handle TEXT;
  v_clean_ig TEXT;
  v_rt_rw TEXT;
  v_ktp_code TEXT;
  v_citizen citizens%ROWTYPE;
BEGIN
  v_clean_ig := LOWER(TRIM(BOTH '@' FROM TRIM(p_ig_username)));

  -- Validasi format username Instagram (huruf, angka, titik, underscore)
  IF v_clean_ig !~ '^[a-z0-9._]{1,30}$' THEN
    RAISE EXCEPTION 'Format username Instagram tidak valid';
  END IF;

  -- 1. Kunci baris counter dunia ini agar request paralel antre rapi (STRICT FCFS!)
  UPDATE world_states
  SET last_citizen_number = last_citizen_number + 1,
      updated_at = NOW()
  WHERE world_id = p_world_id
  RETURNING last_citizen_number, day_number, LOWER(ig_account_handle)
  INTO v_next_num, v_day_num, v_official_handle;

  IF v_next_num IS NULL THEN
    RAISE EXCEPTION 'World tidak ditemukan';
  END IF;

  -- Larang mendaftar pakai akun resmi negara itu sendiri
  IF v_clean_ig = v_official_handle THEN
    RAISE EXCEPTION 'Gunakan akun Instagram pribadimu, bukan akun resmi negara';
  END IF;

  v_ktp_code := UPPER(LEFT(p_world_id, 2)) || '-' || LPAD(v_next_num::TEXT, 4, '0');
  v_rt_rw := 'RT ' || LPAD((((v_next_num - 1) / 50) % 10 + 1)::TEXT, 2, '0')
          || ' / RW ' || LPAD((((v_next_num - 1) / 500) + 1)::TEXT, 2, '0');

  -- 2. Insert warga dengan follow_status = 'pending' (antrean cek 1x24 jam)
  INSERT INTO citizens (
    world_id, citizen_number, ktp_code, username, ig_username,
    follow_status, joined_day, rt_rw_address, avatar_color,
    tier_id, role_title, ip_hash
  )
  VALUES (
    p_world_id, v_next_num, v_ktp_code, p_username, v_clean_ig,
    'pending', v_day_num, v_rt_rw, p_avatar_color,
    'auto', 'auto', p_ip_hash
  )
  RETURNING * INTO v_citizen;

  -- 3. Auto-unlock Ring wilayah baru jika melewati milestone populasi
  IF v_next_num >= 500 THEN
    UPDATE world_states SET current_ring_unlocked = GREATEST(current_ring_unlocked, 3) WHERE world_id = p_world_id;
  ELSIF v_next_num >= 100 THEN
    UPDATE world_states SET current_ring_unlocked = GREATEST(current_ring_unlocked, 2) WHERE world_id = p_world_id;
  END IF;

  RETURN to_jsonb(v_citizen);
END;
$$;

-- B. Batch Verifikasi Follow (Dipanggil dari Admin Panel Upload JSON atau Worker)
CREATE OR REPLACE FUNCTION batch_verify_followers(
  p_world_id TEXT,
  p_follower_usernames TEXT[], -- array lowercase username hasil export Meta / worker
  p_total_ig_followers INTEGER DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_verified_count INTEGER := 0;
  v_not_following_count INTEGER := 0;
BEGIN
  -- 1. Tandai sebagai 'verified' untuk warga yang username IG-nya cocok
  UPDATE citizens
  SET follow_status = 'verified',
      follow_checked_at = NOW()
  WHERE world_id = p_world_id
    AND follow_status IN ('pending', 'recheck_requested', 'not_following')
    AND LOWER(ig_username) = ANY(p_follower_usernames);
  GET DIAGNOSTICS v_verified_count = ROW_COUNT;

  -- 2. Tandai 'not_following' untuk warga antrean yang TIDAK ada di daftar followers
  UPDATE citizens
  SET follow_status = 'not_following',
      follow_checked_at = NOW()
  WHERE world_id = p_world_id
    AND follow_status IN ('pending', 'recheck_requested')
    AND NOT (LOWER(ig_username) = ANY(p_follower_usernames));
  GET DIAGNOSTICS v_not_following_count = ROW_COUNT;

  -- 3. Update total followers & timestamp sinkronisasi ("diperbarui ...")
  UPDATE world_states
  SET ig_follower_count = COALESCE(p_total_ig_followers, GREATEST(ig_follower_count, array_length(p_follower_usernames, 1))),
      followers_synced_at = NOW(),
      updated_at = NOW()
  WHERE world_id = p_world_id;

  RETURN jsonb_build_object(
    'verified', v_verified_count,
    'not_following', v_not_following_count,
    'synced_at', NOW()
  );
END;
$$;
```

*(Catatan untuk Claude: Lengkapi juga RPC `update_citizen_instagram` untuk tombol **"Ganti Instagram"**, `request_follow_recheck` untuk tombol **"Cek Ulang"**, `impeach_unverified_elites` untuk pemakzulan kursi `#001–#100`, pemetaan deterministik `tier_id` & `role_title` berdasarkan `WORLD_CONFIG` dunia terkait, serta validasi `secret_token` pada semua mutasi warga dan validasi `ADMIN_SECRET` pada semua mutasi Admin!)*

## 7. KEAMANAN, ANTI-SPAM, & OPTIMASI SKALA FYP

1. **Anti Penimbun Nomor Awal (`#001`–`#100`):**

   * Pasang **Cloudflare Turnstile** sebelum memanggil RPC pendaftaran.

   * Terapkan *rate limit* berbasis `ip_hash` (maks. 1–2 pendaftaran per IP per `world_id` dalam 24 jam) + deteksi `localStorage`.

   * Validasi *profanity filter* (daftar kata kasar Indonesia & Inggris) di *server-side* untuk `username`, `ig_username`, `status_text`, dan `building_name`.

2. **Hemat Kuota Free Tier Supabase:**

   * Jangan pakai WebSocket/Realtime subscription untuk *database row updates* pergerakan jalan karakter (animasi jalan 100% *client-side AI*). Gunakan **Supabase Realtime Presence** khusus untuk indikator **`X warga online`** dan avatar **`Tamu XXXX`** (ephemeral, ringan, dan batasi maks. 40 Tamu yang dirender di layar sekaligus).

   * Gunakan *polling* ringan atau *cache* tiap 30–60 detik untuk *world state*, *Breaking News*, dan proyek nasional.

   * Di kanvas peta, cukup *fetch* **maks. 120 warga** (User sendiri + Top 25 pejabat + warga terbaru/teraktif) + daftar `land_plots` yang sudah terbeli di *ring* yang terlihat di viewport kamera.

   * Gunakan **Row Level Security (RLS):** Client hanya boleh `SELECT` kolom publik (JANGAN ekspos `secret_token` dan `ip_hash` ke publik; bungkus mutasi lewat Supabase RPC / Edge Functions).

## 8. PANDUAN REFACTORING DARI PROTOTIPE REFERENSI (`republik-konoha.html`)

User melampirkan file **`republik-konoha.html`** yang sudah berfungsi penuh secara lokal. Ketika kamu membaca file tersebut:

* **Pertahankan & Tingkatkan:**

  * Gaya visual *cozy flat 2D illustration* yang cerah, bersih, penuh detail lokal (Istana Negara berbendera Merah-Putih berkibar, Gedung DPR kura-kura hijau dengan animasi `"Zzz"`, Kompleks Konglomerat berhelipad muter, Warung Madura 24 Jam beratap garis merah-kuning, Gerbang Konoha & Pangkalan Ojol, serta Proyek MRT yang berubah jadi Stasiun MRT dengan kereta berjalan).

  * Sensasi *blind reveal roulette* 1,5 detik + konfeti + efek suara synth Web Audio API.

  * Generator KTP Virtual (PNG) siap *download*.

  * Mode Kreator 9:16 Auto-Camera Reels.

* **Hal yang WAJIB Diperbaiki & Diperluas dari Prototipe:**

  1. **Hapus Pre-Seeded Users di Production:** Di prototipe ada 20 warga dummy (`#001–#020`) untuk keperluan demo. Di versi *production*, dunia harus mulai dari **0 warga** (strict FCFS: orang pertama = `#001 Presiden`). Sediakan `DEV_MOCK_MODE` terpisah jika Supabase belum dikonfigurasi.

  2. **Perluas Peta & Tambahkan Sistem Kavling Tanah + Bangun Properti:** Prototipe belum memiliki sistem beli tanah (`land_plots`) dan membangun/meng-upgrade bangunan sendiri. Bangun sistem grid kavling di sekitar jalan raya dan perluasan Ring dinamis!

  3. **Tambahkan Sistem Sinkronisasi Follower, Verifikasi Follow 1x24 Jam, & Live Tamu Online:** Implementasikan validasi `@username` Instagram, status `pending` / `verified` / `not_following`, tombol **Ganti Instagram** & **Cek Ulang** di KTP, fitur **Upload JSON Followers** di Admin Panel (+ skrip worker opsional), tampilan total followers + timestamp `diperbarui ...`, serta kehadiran **Tamu Online** via Supabase Realtime Presence.

  4. **Pisahkan Arsitektur Modular:** Pecah dari 1 file HTML menjadi struktur proyek Vite + React + TypeScript yang bersih (`src/configs/`, `src/engine/`, `src/components/`, `src/services/supabase.ts`, `supabase/migrations/`, `worker/`).

  5. **Tambahkan Pemerintahan Interaktif:** Beri panel khusus untuk `#001` Presiden, `#002` Wapres, dan Kabinet (`#003–#030`) untuk menerbitkan Pengumuman Negara dan mengusulkan agenda voting.

## 9. ROADMAP EKSEKUSI BERTAHAP UNTUK CLAUDE

Kerjakan proyek ini secara terstruktur dalam 5 fase. Berikan kode lengkap siap jalankan dan instruksi *setup* yang jelas di setiap fase:

* **Fase 1 — Project Scaffold & Multi-Tenant Config Engine:**

  * Setup Vite + React + TypeScript + Tailwind CSS.

  * Buat skema TypeScript `WorldConfig` yang kuat (termasuk `igAccountHandle` & aturan verifikasi follow) dan file konfigurasi lengkap untuk `republik-konoha.ts` plus template siap pakai untuk 9 dunia lainnya.

  * Implementasikan *fallback adapter* otomatis: jika env Supabase belum diisi, aplikasi tetap berjalan lancar menggunakan `localStorage` (Mode Sandbox) agar user bisa langsung mengetes semua fitur di lokal (termasuk simulasi verifikasi follow & Tamu online).

* **Fase 2 — Supabase Database Schema, Atomic FCFS RPC, Follow Verification & Land Plots:**

  * Buat file migrasi SQL lengkap (`supabase/migrations/001_init.sql`) mencakup `world_states`, `citizens` (dengan `ig_username`, `follow_status`, `ktp_code`, `rt_rw_address`, `joined_day`), `land_plots`, `news_feed`, `polls`, `poll_votes`, RLS Policies (aman menyembunyikan `secret_token` & `ip_hash`), serta seluruh fungsi RPC atomik: `register_citizen_atomic`, `batch_verify_followers`, `update_citizen_instagram`, `request_follow_recheck`, `impeach_unverified_elites`, `claim_work_reward`, `buy_land_plot`, `build_or_upgrade_property`, `claim_property_income`, `donate_to_project`, `post_status`, dan `cast_poll_vote`.

* **Fase 3 — Upgraded 2D Expandable Map, Live Tamu Presence & City Builder Engine:**

  * Bangun ulang mesin kanvas 2D (HTML5 Canvas / PixiJS) dengan dukungan **Ring Ekspansi Dinamis**, rendering **Kavling Tanah (For Sale / Owned)**, rendering visual unik untuk **berbagai tipe bangunan (Level 1–5)** lengkap dengan nama bangunan & ikon klaim pendapatan pasif, integrasi **Supabase Realtime Presence** untuk memunculkan karakter **`Tamu XXXX`** & hitungan **`X warga online`**, *viewport culling*, serta interaksi *tap-to-buy / tap-to-upgrade*.

* **Fase 4 — Full UI/UX, KTP & Verifikasi IG, Governance, & Creator Reels Studio:**

  * Implementasikan alur **Blind Reveal Strict FCFS** dengan validasi ketat `@username` Instagram, KTP PNG lengkap (dengan `RT/RW`, `WARGA SEJAK DAY X`, stempel dinamis, tombol **Ganti Instagram** & **Cek Ulang**), HUD populasi tersinkronisasi (`WARGA X • diperbarui ...`), modal beli/bangun/upgrade properti, Panel Khusus Presiden/Menteri, Leaderboard 4 tab (termasuk Tuan Tanah), dan **Creator Studio (Mode Rekam 9:16 + Admin Panel ber-PIN dengan fitur Upload JSON Followers & Tombol Makzulkan Pejabat Gelap)**.

* **Fase 5 — Worker Otomatis (Opsional) & Panduan Deploy Rp 0:**

  * Sertakan skrip opsional `/worker/verify_followers.py` (Python Playwright) beserta cara pakainya yang aman, dan file `DEPLOY_GUIDE.md` langkah demi langkah cara menghubungkan 1 repo GitHub ke 10 proyek Cloudflare Pages, menyalakan Cloudflare Turnstile, melakukan ekspor JSON followers resmi dari Meta Accounts Center untuk sinkronisasi harian, dan mengisi *Environment Variables* tanpa mengeluarkan biaya sepeser pun.

### ✅ Konfirmasi Awal sebelum Coding

Jika kamu (Claude) menerima dokumen ini bersama file `republik-konoha.html`, mulailah dengan:

1. Menganalisis `republik-konoha.html` dan merangkum rencana struktur folder proyek.

2. Langsung mengeksekusi **Fase 1 & Fase 2** terlebih dahulu dengan kode yang lengkap, bersih, tanpa *placeholder* potongan kode, dan memastikan aturan **Strict FCFS (pendaftar pertama = `#001 Presiden`)** serta **alur verifikasi follow 1x24 jam** terjamin di level database maupun UI.