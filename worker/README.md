# Worker Verifikasi Follow (opsional)

Jalur **utama dan paling aman** tetap: ekspor `followers_1.json` dari Meta Accounts Center → upload di Admin Panel
(`#admin` → *Sync & Verifikasi Followers*). Worker ini opsional untuk otomatisasi harian.

> ⚠️ Mengotomasi Instagram bisa melanggar Ketentuan Penggunaan Instagram dan berisiko akun dibatasi.
> Pakai **akun sekunder**, jangan akun utama dunia, dan biarkan batas & jeda bawaan.

## Setup (sekali)

```bash
cd worker
python -m venv .venv
# Windows: .venv\Scripts\activate    macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
python -m playwright install chromium
cp .env.example .env        # Windows: copy .env.example .env  → lalu isi
python verify_followers.py login
```

`login` membuka Chromium; login manual dengan akun sekunder, lalu tekan Enter di terminal.
Sesi disimpan ke `.ig_state.json` (rahasia, sudah di-.gitignore). Password tidak pernah disimpan skrip.

## Jalankan

```bash
python verify_followers.py run --dry-run   # uji: cek tanpa mengirim
python verify_followers.py run             # cek & kirim ke Supabase
python verify_followers.py run --max 50    # batasi jumlah cek
```

Kode keluar: `0` sukses, `1` gagal buka Instagram, `2` belum login, `3` dihentikan karena dibatasi Instagram
(hasil yang sudah didapat tetap dikirim).

## Cara kerja

1. `admin_get_follow_queue` (pakai `ADMIN_SYNC_SECRET`) → antrean: *cek ulang* → *pending* → *belum follow*.
2. Untuk tiap username: pencarian di daftar followers akun dunia (sama seperti kolom cari di modal followers web),
   jeda acak 8–20 detik + istirahat 45–90 detik tiap 25 cek, maks. 120 per run.
3. `report_follow_checks` hanya mengubah username yang **benar-benar berhasil dicek**. Hasil "tidak pasti" tidak
   mengubah status apa pun; sisa antrean dicek di run berikutnya.

Instagram sering mengubah web-nya. Jika semua hasil "tidak pasti" atau error, pakai jalur Upload JSON sampai
skrip disesuaikan.

## Jadwal harian 02:00 WIB

**Linux/macOS (cron):**

```cron
0 2 * * * cd /path/negara-virtual/worker && .venv/bin/python verify_followers.py run >> worker.log 2>&1
```

(Set zona waktu server ke Asia/Jakarta, atau hitung jam UTC: 02:00 WIB = 19:00 UTC.)

**Windows (Task Scheduler, PowerShell sebagai admin):**

```powershell
$action = New-ScheduledTaskAction -Execute "C:\path\negara-virtual\worker\.venv\Scripts\python.exe" -Argument "verify_followers.py run" -WorkingDirectory "C:\path\negara-virtual\worker"
Register-ScheduledTask -TaskName "NegaraVirtual-VerifyFollowers" -Action $action -Trigger (New-ScheduledTaskTrigger -Daily -At 2am)
```

Banyak dunia? Buat satu folder salinan `.env` per dunia (atau set env berbeda per task) — tiap dunia punya
`WORLD_ID`, `IG_ACCOUNT_HANDLE`, dan `ADMIN_SYNC_SECRET` sendiri.
