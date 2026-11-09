#!/usr/bin/env python3
"""Slice the user-provided guild reference into decorative, text-free assets.

Usage: python3 preview/prepare-lobby-art.py /path/to/璀璨宝石商会大厅.png
Requires Pillow only for this optional preparation step. Normal builds consume
these small checked-in JPEGs; the original 2.6 MB reference stays outside the app.
All titles, profile data, navigation and action buttons are rendered by WXML.
"""

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageOps

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "preview" / "thumbs" / "lobby"


def feather_patch(canvas, box, patch, feather=5):
    """Blend a replacement over an area containing baked-in UI."""
    x0, y0, x1, y1 = box
    patch = patch.resize((x1 - x0, y1 - y0), Image.Resampling.LANCZOS)
    mask = Image.new("L", patch.size, 255)
    if feather:
        # Keep an opaque centre so no original lettering can bleed through.
        mask = Image.new("L", patch.size, 0)
        ImageDraw.Draw(mask).rectangle(
            (feather, feather, patch.width - feather, patch.height - feather),
            fill=255,
        )
        mask = mask.filter(ImageFilter.GaussianBlur(feather / 2))
    canvas.paste(patch, (x0, y0), mask)


def prepare(source):
    original = Image.open(source).convert("RGB")
    if abs(original.width / original.height - 1672 / 941) > 0.02:
        raise ValueError("Expected the 1672×941 guild-hall reference aspect ratio")
    original = original.resize((1672, 941), Image.Resampling.LANCZOS)
    scene = original.copy()

    # Remove the fixed merchant portrait/name and the baked-in game wordmark.
    feather_patch(scene, (0, 0, 420, 156), original.crop((0, 156, 420, 250)), 0)
    feather_patch(scene, (625, 0, 1042, 202), original.crop((590, 0, 625, 202)), 10)

    # Remove the old action board entirely. Its decorative frame is sliced below
    # as an independent asset so the live board can move below WeChat's capsule.
    backdrop = original.crop((1160, 0, 1672, 136)).filter(ImageFilter.GaussianBlur(3))
    feather_patch(scene, (1048, 126, 1662, 800), backdrop, 5)
    # Replace the old Friends / Rules / Settings footer with table/room texture.
    feather_patch(scene, (0, 842, 1672, 941), original.crop((0, 790, 1672, 842)), 0)

    # Preserve the photographed carved gold frame and remove every inner label,
    # diamond, button and divider, leaving only teal leather for real controls.
    panel = original.crop((1056, 137, 1652, 784))
    tile = original.crop((1115, 291, 1205, 309))
    leather = Image.new("RGB", (548, 591))
    for y in range(0, leather.height, tile.height):
        for x in range(0, leather.width, tile.width):
            part = ImageOps.mirror(tile) if (x // tile.width) % 2 else tile
            if (y // tile.height) % 2:
                part = ImageOps.flip(part)
            leather.paste(part, (x, y))
    # Cut the mask's corners to leave the original gold foliage untouched.
    mask = Image.new("L", leather.size, 0)
    d = ImageDraw.Draw(mask)
    w, h, cut = leather.width, leather.height, 36
    d.polygon(((cut, 0), (w - cut, 0), (w, cut), (w, h - cut),
               (w - cut, h), (cut, h), (0, h - cut), (0, cut)), fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(1))
    panel.paste(leather, (24, 28), mask)

    OUT.mkdir(parents=True, exist_ok=True)
    scene.resize((1440, 810), Image.Resampling.LANCZOS).save(
        OUT / "scene.jpg", quality=86, optimize=True, progressive=True
    )
    panel.resize((460, 500), Image.Resampling.LANCZOS).save(
        OUT / "panel.jpg", quality=87, optimize=True, progressive=True
    )
    original.crop((37, 21, 147, 133)).resize((128, 128), Image.Resampling.LANCZOS).save(
        OUT / "merchant.jpg", quality=88, optimize=True
    )
    for name in ("scene.jpg", "panel.jpg", "merchant.jpg"):
        file = OUT / name
        print(f"{file.relative_to(ROOT)}: {file.stat().st_size / 1024:.1f} KB")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    prepare(parser.parse_args().source)
