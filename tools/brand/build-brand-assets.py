#!/usr/bin/env python3
"""Builds every derived brand asset from the five Owner-approved originals in docs/brand/originals/.

Nothing is redrawn: the originals are only cropped, resized or placed on a canvas.
  * UI logos (transparent PNG): transparent margins cropped, downscaled. Used by the PC/web apps and the Flutter apps.
  * Android launcher icons (legacy + adaptive) and splash images for 11Food and 11Ship, built from icon-11food / icon-11ship.
  * docs/brand/brand-assets.json: sha256 of originals and derived files, plus the measured alpha of the logos.

Run from the repository root:  python3 tools/brand/build-brand-assets.py            (writes files)
                               python3 tools/brand/build-brand-assets.py --check     (fails if a derived file is stale)
Needs Pillow and numpy. The output is committed, so CI does not need this script.
"""
from __future__ import annotations

import hashlib
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
ORIG = ROOT / 'docs' / 'brand' / 'originals'
WEB_BRAND = ROOT / 'apps' / 'client-shared' / 'public' / 'brand'
# The admin console is served through an explicit allowlist (apps/backend/src/http/admin-web-hosting.ts): PNGs only at the site root.
ADMIN_BRAND = ROOT / 'apps' / 'admin-web' / 'public'
FLUTTER_BRAND = ROOT / 'mobile' / 'packages' / 'n11_shared' / 'assets' / 'brand'
MANIFEST = ROOT / 'docs' / 'brand' / 'brand-assets.json'

LOGOS = {'logo-11': 480, 'logo-11food': 720, 'logo-11ship': 720}  # name -> UI width in px
ICONS = {'food': 'icon-11food', 'ship': 'icon-11ship'}
DENSITY = {'mdpi': 1.0, 'hdpi': 1.5, 'xhdpi': 2.0, 'xxhdpi': 3.0, 'xxxhdpi': 4.0}
ALPHA_VISIBLE = 16  # alpha below this is invisible haze: ignored when measuring the logo's real extent
CROP_PAD = 0.03  # transparent breathing room kept around the cropped logo, as a share of its longest side
SAFE_RADIUS_DP = 32.0  # logo half-diagonal must fit this radius inside the 108dp adaptive canvas (platform safe zone is 33dp)
SPLASH_CONTENT_WIDTH_DP = 150.0


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def alpha_report(img: Image.Image) -> dict:
    a = np.array(img.convert('RGBA'))[..., 3]
    hist = np.bincount(a.ravel(), minlength=256)
    total = int(a.size)
    ys, xs = np.where(a >= ALPHA_VISIBLE)
    solid = a[a >= 128]
    return {
        'size': [img.width, img.height],
        'has_alpha_channel': True,
        'transparent_share': round(float(hist[0]) / total, 4),
        'alpha_255_pixels': int(hist[255]),
        'alpha_240_254_pixels': int(hist[240:255].sum()),
        'alpha_1_15_pixels': int(hist[1:16].sum()),
        'median_alpha_of_ink': int(np.median(solid)) if solid.size else 0,
        'corner_alpha': [int(a[0, 0]), int(a[0, -1]), int(a[-1, 0]), int(a[-1, -1])],
        'visible_bbox': [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1],
    }


def crop_logo(img: Image.Image) -> Image.Image:
    rgba = img.convert('RGBA')
    a = np.array(rgba)[..., 3]
    ys, xs = np.where(a >= ALPHA_VISIBLE)
    x0, y0, x1, y1 = int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1
    pad = int(round(max(x1 - x0, y1 - y0) * CROP_PAD))
    box = (max(0, x0 - pad), max(0, y0 - pad), min(rgba.width, x1 + pad), min(rgba.height, y1 + pad))
    return rgba.crop(box)


def save_png(img: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, format='PNG', optimize=True)


def ui_logo(name: str, width: int) -> Image.Image:
    cropped = crop_logo(Image.open(ORIG / f'{name}.png'))
    height = int(round(cropped.height * width / cropped.width))
    return cropped.resize((width, height), Image.LANCZOS)  # Pillow resamples RGBA premultiplied: no dark fringes


def border_color(rgb: np.ndarray, ring: int = 10) -> tuple[int, int, int]:
    h, w, _ = rgb.shape
    mask = np.zeros((h, w), dtype=bool)
    mask[:ring, :] = mask[-ring:, :] = True
    mask[:, :ring] = mask[:, -ring:] = True
    return tuple(int(v) for v in np.median(rgb[mask], axis=0))


def content_bbox(rgb: np.ndarray, bg: tuple[int, int, int], tol: int = 48) -> tuple[int, int, int, int]:
    diff = np.abs(rgb.astype(int) - np.array(bg)).max(axis=2)
    ys, xs = np.where(diff > tol)
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def feathered(img: Image.Image, fraction: float = 0.05) -> Image.Image:
    """Fades the outer edge of an icon square to transparent so it blends into a solid background of the same colour."""
    rgba = img.convert('RGBA')
    w, h = rgba.size
    ramp = max(2, int(min(w, h) * fraction))
    ax = np.minimum(np.arange(w), np.arange(w)[::-1]).astype(float)
    ay = np.minimum(np.arange(h), np.arange(h)[::-1]).astype(float)
    edge = np.minimum.outer(ay, ax)
    alpha = np.clip(edge / ramp, 0.0, 1.0)
    out = np.array(rgba)
    out[..., 3] = (alpha * 255).astype(np.uint8)
    return Image.fromarray(out, 'RGBA')


def place(source: Image.Image, bbox: tuple[int, int, int, int], dp_per_px: float, canvas_dp: float, scale: float) -> Image.Image:
    """Source icon scaled so 1 source px = dp_per_px dp, centred so the logo's bbox centre is the canvas centre."""
    n = int(round(canvas_dp * scale))
    canvas = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    k = dp_per_px * scale
    scaled = source.resize((max(1, int(round(source.width * k))), max(1, int(round(source.height * k)))), Image.LANCZOS)
    cx, cy = (bbox[0] + bbox[2]) / 2 * k, (bbox[1] + bbox[3]) / 2 * k
    canvas.alpha_composite(scaled, (int(round(n / 2 - cx)), int(round(n / 2 - cy))))
    return canvas


def android_resources(app: str, icon_name: str) -> dict[str, Path]:
    src_rgb = Image.open(ORIG / f'{icon_name}.png').convert('RGB')
    rgb = np.array(src_rgb)
    bg = border_color(rgb)
    bbox = content_bbox(rgb, bg)
    half_diag = math.hypot((bbox[2] - bbox[0]) / 2, (bbox[3] - bbox[1]) / 2)
    adaptive_dp_per_px = SAFE_RADIUS_DP / half_diag
    splash_dp_per_px = SPLASH_CONTENT_WIDTH_DP / (bbox[2] - bbox[0])
    soft = feathered(src_rgb)
    res = ROOT / 'mobile' / app / 'android_overlay' / 'res'
    written: dict[str, Path] = {}
    for dens, scale in DENSITY.items():
        legacy = src_rgb.resize((int(48 * scale), int(48 * scale)), Image.LANCZOS)
        for rel, img in (
            (f'mipmap-{dens}/ic_launcher.png', legacy),
            (f'mipmap-{dens}/ic_launcher_foreground.png', place(soft, bbox, adaptive_dp_per_px, 108, scale)),
            (f'drawable-{dens}/splash_icon.png', place(soft, bbox, adaptive_dp_per_px, 108, scale)),
            (f'drawable-{dens}/splash_logo.png', place(soft, bbox, splash_dp_per_px, 200, scale)),
        ):
            target = res / rel
            save_png(img, target)
            written[str(target.relative_to(ROOT))] = target
    hex_bg = '#%02X%02X%02X' % bg
    files = {
        'values/colors.xml': f'<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">{hex_bg}</color>\n</resources>\n',
        'mipmap-anydpi-v26/ic_launcher.xml': (
            '<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
            '    <background android:drawable="@color/ic_launcher_background"/>\n'
            '    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n</adaptive-icon>\n'
        ),
    }
    for rel, text in files.items():
        target = res / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding='utf-8')
        written[str(target.relative_to(ROOT))] = target
    return written


def build() -> dict:
    manifest: dict = {'originals': {}, 'derived': {}, 'alpha': {}, 'android': {}}
    for name in list(LOGOS) + list(ICONS.values()):
        manifest['originals'][f'{name}.png'] = sha256(ORIG / f'{name}.png')
    for name in LOGOS:
        manifest['alpha'][name] = alpha_report(Image.open(ORIG / f'{name}.png'))
    for name, width in LOGOS.items():
        image = ui_logo(name, width)
        targets = [WEB_BRAND, FLUTTER_BRAND] + ([ADMIN_BRAND] if name == 'logo-11' else [])
        for folder in targets:
            target = folder / f'{name}-ui.png'
            save_png(image, target)
            manifest['derived'][str(target.relative_to(ROOT))] = sha256(target)
    for app, icon_name in ICONS.items():
        for rel, target in android_resources(app, icon_name).items():
            manifest['android'][rel] = sha256(target)
    return manifest


def main() -> int:
    before = MANIFEST.read_text(encoding='utf-8') if MANIFEST.exists() else ''
    manifest = build()
    text = json.dumps(manifest, indent=2, sort_keys=True) + '\n'
    if '--check' in sys.argv:
        if text != before:
            print('brand assets are stale: run python3 tools/brand/build-brand-assets.py', file=sys.stderr)
            return 1
        print('brand assets are up to date')
        return 0
    MANIFEST.write_text(text, encoding='utf-8')
    print(f'wrote {len(manifest["derived"])} UI logos and {len(manifest["android"])} Android resources')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
