"""
Olah emote 3D mentah (JPG, background putih) -> WebP transparan 256x256 (+ fallback PNG).

  python scripts/process-emotes.py            # semua *.jpg/*.jpeg/*.png di public/assets/emotes/raw/
  python scripts/process-emotes.py --tol 30   # toleransi putih (default 30)

Pipeline per file:
  1. Downscale kerja ke 1024px (hasil akhir 256px, jadi tidak ada detail yang hilang).
  2. Edge flood-fill: HANYA area putih yang tersambung ke tepi gambar yang dibuang, sehingga putih di
     dalam mata/gigi/uap (dikelilingi outline gelap) TIDAK ikut bolong.
  3. Defringe 1px + anti-aliased feather: alpha di-erode 1px lalu di-blur halus, warna pinggiran
     yang masih keputihan ditarik ke warna tetangga gelap agar tidak ada halo/bintik putih JPG.
  4. Trim padding transparan, letakkan di kanvas persegi, tambah sticker outline putih tipis +
     soft drop shadow agar kontras di atas peta terang maupun UI gelap.
  5. Resize 256x256, ekspor WebP (target < 35KB, kualitas diturunkan otomatis jika perlu) + PNG fallback.

Butuh: Pillow, numpy.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "public" / "assets" / "emotes" / "raw"
OUT_DIR = ROOT / "public" / "assets" / "emotes"
WORK = 1024
FINAL = 256
MAX_BYTES = 35 * 1024


def remove_background(img: Image.Image, tol: int) -> Image.Image:
    rgb = img.convert("RGB")
    rgb.thumbnail((WORK, WORK), Image.LANCZOS)
    a = np.asarray(rgb).astype(np.int16)
    w_, h_ = rgb.size

    # "Hampir putih": kanal paling gelap masih >= 255 - tol, dan saturasi rendah (bukan kuning/krem terang).
    mn = a.min(axis=2)
    mx = a.max(axis=2)
    near_white = (mn >= 255 - tol) & ((mx - mn) <= tol)

    # Flood-fill dari tepi: bingkai 1px putih supaya satu seed (0,0) menjangkau semua sisi.
    mask = Image.new("L", (w_ + 2, h_ + 2), 255)
    mask.paste(Image.fromarray(np.where(near_white, 255, 0).astype(np.uint8)), (1, 1))
    ImageDraw.floodfill(mask, (0, 0), 128, thresh=0)
    bg = (np.asarray(mask)[1:-1, 1:-1] == 128)

    alpha = Image.fromarray(np.where(bg, 0, 255).astype(np.uint8))
    # Defringe 1px (buang cincin putih sisa kompresi) + feather anti-alias.
    alpha = alpha.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.9))
    al = np.asarray(alpha).astype(np.float32) / 255.0

    # Sisa piksel pinggiran yang masih keputihan -> alpha dikurangi proporsional (soft edge).
    whiteness = np.clip((mn.astype(np.float32) - (255 - tol * 2)) / (tol * 2), 0, 1)
    edge = (al > 0) & (al < 1)
    al = np.where(edge, al * (1 - whiteness * 0.85), al)

    # Decontaminate warna pinggiran: tarik ke warna rata-rata tetangga yang opaque.
    rgb_f = a.astype(np.float32)
    opaque = Image.fromarray((al >= 0.98).astype(np.uint8) * 255)
    src = Image.fromarray(np.clip(rgb_f, 0, 255).astype(np.uint8))
    blurred = np.asarray(src.filter(ImageFilter.BoxBlur(2))).astype(np.float32)
    weight = np.asarray(opaque.filter(ImageFilter.BoxBlur(2))).astype(np.float32)[..., None] / 255.0
    masked = np.asarray(Image.composite(src, Image.new("RGB", src.size, 0), opaque).filter(ImageFilter.BoxBlur(2))).astype(np.float32)
    neighbour = np.where(weight > 0.05, masked / np.maximum(weight, 1e-3), blurred)
    mix = np.where(edge[..., None], whiteness[..., None], 0.0)
    out_rgb = rgb_f * (1 - mix) + neighbour * mix

    rgba = np.dstack([np.clip(out_rgb, 0, 255), al * 255]).astype(np.uint8)
    return Image.fromarray(rgba, "RGBA")


def stickerize(cut: Image.Image) -> Image.Image:
    bbox = cut.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
    if bbox:
        cut = cut.crop(bbox)
    # Persegi dengan ruang untuk outline + shadow.
    side = max(cut.size)
    inner = int(FINAL * 0.86)
    scale = inner / side
    cut = cut.resize((max(1, round(cut.width * scale)), max(1, round(cut.height * scale))), Image.LANCZOS)

    canvas = Image.new("RGBA", (FINAL, FINAL), (0, 0, 0, 0))
    ox = (FINAL - cut.width) // 2
    oy = (FINAL - cut.height) // 2 - 4
    placed = Image.new("RGBA", (FINAL, FINAL), (0, 0, 0, 0))
    placed.paste(cut, (ox, oy), cut)
    a = placed.getchannel("A")

    # Soft drop shadow.
    shadow_a = a.filter(ImageFilter.MaxFilter(7)).filter(ImageFilter.GaussianBlur(5)).point(lambda v: int(v * 0.38))
    shadow = Image.new("RGBA", (FINAL, FINAL), (40, 10, 10, 0))
    shadow.putalpha(shadow_a)
    canvas.alpha_composite(shadow, (0, 5))

    # Sticker outline putih ~3px, dengan tepi halus.
    ring_a = a.point(lambda v: 255 if v > 40 else 0).filter(ImageFilter.MaxFilter(7)).filter(ImageFilter.GaussianBlur(0.8))
    ring = Image.new("RGBA", (FINAL, FINAL), (255, 255, 255, 0))
    ring.putalpha(ring_a)
    canvas.alpha_composite(ring)
    canvas.alpha_composite(placed)
    return canvas


def save_webp(img: Image.Image, path: Path) -> int:
    for q in (86, 80, 74, 68, 60, 52):
        img.save(path, "WEBP", quality=q, method=6, alpha_quality=90)
        size = path.stat().st_size
        if size <= MAX_BYTES:
            return size
    return path.stat().st_size


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tol", type=int, default=30)
    args = ap.parse_args()

    files = sorted([p for p in RAW_DIR.glob("*") if p.suffix.lower() in (".jpg", ".jpeg", ".png")])
    if not files:
        print(f"Tidak ada file di {RAW_DIR}")
        return 1
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for f in files:
        cut = remove_background(Image.open(f), args.tol)
        final = stickerize(cut)
        webp = OUT_DIR / f"{f.stem}.webp"
        png = OUT_DIR / f"{f.stem}.png"
        size = save_webp(final, webp)
        final.quantize(colors=255, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE).save(png, optimize=True)
        flag = "OK" if size <= MAX_BYTES else "WARN >35KB"
        print(f"{f.name:22s} -> {webp.name} {size / 1024:5.1f}KB [{flag}] | {png.name} {png.stat().st_size / 1024:5.1f}KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
