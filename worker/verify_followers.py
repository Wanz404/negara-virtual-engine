#!/usr/bin/env python3
"""
Worker Verifikasi Follow (opsional, Fase 5) — Negara Virtual.

Pelengkap fitur "Upload JSON Followers" di Admin Panel. Berjalan terjadwal (mis. 02:00 WIB) di laptop/VPS
kreator memakai AKUN INSTAGRAM SEKUNDER (bukan akun utama dunia), lalu:

  1. Ambil antrean warga (pending / recheck_requested / not_following) lewat RPC admin_get_follow_queue.
  2. Cek satu per satu apakah username itu ada di daftar followers @akun_dunia, dengan jeda lambat & acak.
  3. Kirim hasil ke RPC report_follow_checks — HANYA username yang benar-benar berhasil dicek yang diubah.

Keamanan:
  * Password Instagram TIDAK pernah disimpan skrip. Login dilakukan manual sekali (`login`), lalu sesi
    browser disimpan ke file state lokal (rahasiakan file itu, ia setara cookie login).
  * Dibatasi MAX_CHECKS per run + jeda acak; berhenti otomatis saat Instagram membalas 429 / checkpoint.
  * Mengotomasi Instagram bisa melanggar Ketentuan Penggunaannya dan berisiko akun dibatasi. Karena itu
    jalur utama yang disarankan tetap Upload JSON resmi dari Meta Accounts Center di Admin Panel.

Pemakaian:
  python verify_followers.py login             # buka browser, login akun sekunder secara manual
  python verify_followers.py run --dry-run     # cek tanpa mengirim hasil
  python verify_followers.py run               # cek & kirim hasil ke Supabase
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import httpx
from playwright.sync_api import Page, TimeoutError as PwTimeout, sync_playwright

HERE = Path(__file__).resolve().parent
IG_APP_ID = "936619743392459"  # App-ID publik yang dipakai web instagram.com


# ---------------------------------------------------------------------------
# Konfigurasi
# ---------------------------------------------------------------------------

def load_dotenv(path: Path) -> None:
    """Loader .env minimal (tanpa dependensi tambahan). Env yang sudah ada tidak ditimpa."""
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


@dataclass
class Config:
    supabase_url: str
    anon_key: str
    world_id: str
    sync_secret: str
    ig_handle: str
    state_file: Path
    max_checks: int
    min_delay: float
    max_delay: float
    headless: bool

    @staticmethod
    def from_env() -> "Config":
        load_dotenv(HERE / ".env")
        missing = [k for k in ("SUPABASE_URL", "SUPABASE_ANON_KEY", "WORLD_ID", "ADMIN_SYNC_SECRET", "IG_ACCOUNT_HANDLE") if not os.environ.get(k)]
        if missing:
            sys.exit(f"✗ Env belum diisi: {', '.join(missing)} (salin worker/.env.example → worker/.env)")
        return Config(
            supabase_url=os.environ["SUPABASE_URL"].rstrip("/"),
            anon_key=os.environ["SUPABASE_ANON_KEY"],
            world_id=os.environ["WORLD_ID"],
            sync_secret=os.environ["ADMIN_SYNC_SECRET"],
            ig_handle=os.environ["IG_ACCOUNT_HANDLE"].lstrip("@").lower(),
            state_file=HERE / os.environ.get("IG_STATE_FILE", ".ig_state.json"),
            max_checks=int(os.environ.get("MAX_CHECKS", "120")),
            min_delay=float(os.environ.get("MIN_DELAY_SECONDS", "8")),
            max_delay=float(os.environ.get("MAX_DELAY_SECONDS", "20")),
            headless=os.environ.get("HEADLESS", "true").lower() != "false",
        )


# ---------------------------------------------------------------------------
# Supabase RPC (PostgREST)
# ---------------------------------------------------------------------------

class Supabase:
    def __init__(self, cfg: Config) -> None:
        self.cfg = cfg
        self.http = httpx.Client(
            base_url=f"{cfg.supabase_url}/rest/v1",
            headers={"apikey": cfg.anon_key, "Authorization": f"Bearer {cfg.anon_key}", "Content-Type": "application/json"},
            timeout=30,
        )

    def rpc(self, fn: str, payload: dict) -> dict:
        res = self.http.post(f"/rpc/{fn}", content=json.dumps(payload))
        if res.status_code >= 400:
            raise RuntimeError(f"RPC {fn} gagal ({res.status_code}): {res.text}")
        data = res.json()
        if isinstance(data, dict) and data.get("ok") is False:
            raise RuntimeError(f"RPC {fn} ditolak: {data.get('error')}")
        return data

    def follow_queue(self) -> list[str]:
        data = self.rpc("admin_get_follow_queue", {"p_world_id": self.cfg.world_id, "p_admin_secret": self.cfg.sync_secret})
        return list(data.get("usernames") or [])

    def report(self, followers: list[str], not_followers: list[str], total: Optional[int]) -> dict:
        return self.rpc(
            "report_follow_checks",
            {
                "p_world_id": self.cfg.world_id,
                "p_admin_secret": self.cfg.sync_secret,
                "p_followers": followers,
                "p_not_followers": not_followers,
                "p_total_ig_followers": total,
            },
        )


# ---------------------------------------------------------------------------
# Instagram (lewat sesi browser asli, bukan API tidak resmi berbasis password)
# ---------------------------------------------------------------------------

class StopRun(Exception):
    """Instagram membatasi / minta verifikasi → hentikan run, coba lagi besok."""


def ig_get(page: Page, path: str) -> dict:
    """GET ke endpoint web instagram.com memakai cookie sesi browser yang sedang login."""
    result = page.evaluate(
        """async ([path, appId]) => {
            const csrf = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1] || '';
            const r = await fetch(path, { credentials: 'include', headers: { 'X-IG-App-ID': appId, 'X-CSRFToken': csrf, 'X-Requested-With': 'XMLHttpRequest' } });
            let body = null;
            try { body = await r.json(); } catch (e) { body = null; }
            return { status: r.status, body };
        }""",
        [path, IG_APP_ID],
    )
    status = result["status"]
    body = result["body"] or {}
    if status == 429 or body.get("message") in ("checkpoint_required", "challenge_required", "feedback_required"):
        raise StopRun(f"Instagram membatasi permintaan (status {status}, {body.get('message')}).")
    if status == 401 or body.get("message") == "login_required":
        raise StopRun("Sesi Instagram kedaluwarsa. Jalankan ulang: python verify_followers.py login")
    if status >= 400:
        raise RuntimeError(f"HTTP {status} untuk {path}")
    return body


def target_profile(page: Page, handle: str) -> tuple[str, Optional[int]]:
    data = ig_get(page, f"/api/v1/users/web_profile_info/?username={handle}")
    user = (data.get("data") or {}).get("user") or {}
    if not user.get("id"):
        raise RuntimeError(f"Profil @{handle} tidak ditemukan.")
    count = ((user.get("edge_followed_by") or {}).get("count"))
    return str(user["id"]), int(count) if count is not None else None


def is_follower(page: Page, target_id: str, username: str) -> Optional[bool]:
    """
    Cari `username` di daftar followers target (fitur pencarian di modal followers web).
    True = follow, False = tidak ditemukan, None = tidak bisa dipastikan (jangan ubah status).
    """
    path = f"/api/v1/friendships/{target_id}/followers/?count=12&search_surface=follow_list_page&query={username}"
    data = ig_get(page, path)
    users = data.get("users")
    if users is None:
        return None
    return any((u.get("username") or "").lower() == username for u in users)


def human_pause(cfg: Config) -> None:
    time.sleep(random.uniform(cfg.min_delay, cfg.max_delay))


# ---------------------------------------------------------------------------
# Perintah
# ---------------------------------------------------------------------------

def cmd_login(cfg: Config) -> None:
    print("→ Browser akan terbuka. Login dengan AKUN SEKUNDER, selesaikan verifikasi bila diminta,")
    print("  lalu kembali ke terminal ini dan tekan Enter.")
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=False)
        context = browser.new_context(locale="id-ID")
        page = context.new_page()
        page.goto("https://www.instagram.com/accounts/login/")
        input("Tekan Enter setelah berhasil login dan feed Instagram tampil… ")
        context.storage_state(path=str(cfg.state_file))
        browser.close()
    try:
        os.chmod(cfg.state_file, 0o600)
    except OSError:
        pass
    print(f"✓ Sesi disimpan di {cfg.state_file} (RAHASIA — jangan di-commit / dibagikan).")


def cmd_run(cfg: Config, dry_run: bool) -> int:
    if not cfg.state_file.exists():
        print("✗ Belum ada sesi Instagram. Jalankan dulu: python verify_followers.py login")
        return 2

    sb = Supabase(cfg)
    queue = sb.follow_queue()
    print(f"→ Antrean {cfg.world_id}: {len(queue)} username (diprioritaskan: cek ulang → pending → belum follow)")
    if not queue:
        return 0
    batch = queue[: cfg.max_checks]

    followers: list[str] = []
    not_followers: list[str] = []
    unknown: list[str] = []
    total: Optional[int] = None
    stopped: Optional[str] = None

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=cfg.headless)
        context = browser.new_context(storage_state=str(cfg.state_file), locale="id-ID")
        page = context.new_page()
        try:
            page.goto(f"https://www.instagram.com/{cfg.ig_handle}/", wait_until="domcontentloaded", timeout=45_000)
        except PwTimeout:
            print("✗ instagram.com tidak bisa dibuka (timeout).")
            browser.close()
            return 1
        try:
            target_id, total = target_profile(page, cfg.ig_handle)
            print(f"→ @{cfg.ig_handle}: {total if total is not None else '?'} followers. Mengecek {len(batch)} username…")
            for i, username in enumerate(batch, 1):
                human_pause(cfg)
                try:
                    result = is_follower(page, target_id, username)
                except RuntimeError as e:
                    print(f"  [{i}/{len(batch)}] @{username}: dilewati ({e})")
                    unknown.append(username)
                    continue
                if result is True:
                    followers.append(username)
                elif result is False:
                    not_followers.append(username)
                else:
                    unknown.append(username)
                label = {True: "✓ follow", False: "✗ belum follow", None: "? tidak pasti"}[result]
                print(f"  [{i}/{len(batch)}] @{username}: {label}")
                if i % 25 == 0:
                    time.sleep(random.uniform(45, 90))  # istirahat panjang berkala
        except StopRun as e:
            stopped = str(e)
            print(f"⚠ Berhenti: {stopped}")
        finally:
            context.storage_state(path=str(cfg.state_file))  # simpan cookie terbaru
            browser.close()

    print(f"→ Hasil: {len(followers)} follow, {len(not_followers)} belum follow, {len(unknown)} tidak pasti (status tidak diubah).")
    if dry_run:
        print("✓ Dry-run: tidak ada yang dikirim ke Supabase.")
        return 0
    if followers or not_followers or total is not None:
        r = sb.report(followers, not_followers, total)
        print(f"✓ Terkirim: {r.get('verified')} warga dilantik, {r.get('not_following')} ditandai belum follow.")
    return 3 if stopped else 0


def main() -> None:
    # Konsol Windows (cp1252) tidak bisa mencetak ✓/✗/→ → paksa UTF-8 agar tidak crash di Task Scheduler.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
        except (AttributeError, ValueError):
            pass
    parser = argparse.ArgumentParser(description="Worker verifikasi follow Instagram untuk Negara Virtual")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("login", help="Login manual akun Instagram sekunder & simpan sesi")
    run = sub.add_parser("run", help="Cek antrean follow & kirim hasil")
    run.add_argument("--dry-run", action="store_true", help="Cek saja tanpa mengirim hasil")
    run.add_argument("--max", type=int, help="Batas username yang dicek pada run ini")
    args = parser.parse_args()

    cfg = Config.from_env()
    if args.cmd == "login":
        cmd_login(cfg)
        return
    if getattr(args, "max", None):
        cfg.max_checks = max(1, args.max)
    try:
        code = cmd_run(cfg, args.dry_run)
    except (RuntimeError, httpx.HTTPError) as e:
        print(f"✗ {e}")
        code = 1
    sys.exit(code)


if __name__ == "__main__":
    main()
