#!/usr/bin/env python3
"""Downscale the checked-in lobby JPEGs so they fit the 2 MiB main-package budget.

Usage: uv run --with pillow python preview/prepare-lobby-shrink.py

Why this exists
---------------
`preview/art.js` inlines these JPEGs as base64 into `pages/index/art.wxss`.
`scene.jpg` alone was 232KB on disk / ~309KB as base64, and the package total
had reached 2040.7KB against the hard 2048KB limit -- upload failed.

The lobby scene is only ever painted into the 1080x560 stage with
`background-size:100% 100%`, so the original 1440x810 carried ~1.78x more
pixels than could ever be shown. Resizing to 1080x608 (same aspect ratio)
plus a mild quality reduction brings it to ~94KB with no visible loss.

Do NOT use macOS `sips` for this: its JPEG encoder is much less efficient than
Pillow's `optimize=True` (same image: 70KB+ vs 36KB on the theme atlases).

The source reference PNG is not in the repo, so this script works from the
already-sliced JPEGs instead of re-running prepare-lobby-art.py.
"""

from pathlib import Path

from PIL import Image

OUT = Path(__file__).resolve().parents[1] / "preview" / "thumbs" / "lobby"

# file -> (max width, quality). Height is derived to preserve aspect ratio.
TARGETS = {
    "scene.jpg": (1080, 68),    # shown at 1080x560 in the stage
    "panel.jpg": (460, 78),     # shown at ~440px wide, already near 1:1
    "merchant.jpg": (128, 82),  # shown at 64x80, already near 1:1
}


def main():
    for name, (max_width, quality) in TARGETS.items():
        path = OUT / name
        if not path.exists():
            print(f"skip {name}: not found")
            continue
        before = path.stat().st_size
        image = Image.open(path).convert("RGB")
        width, height = image.size
        if width > max_width:
            ratio = max_width / width
            image = image.resize(
                (max_width, round(height * ratio)), Image.Resampling.LANCZOS
            )
        image.save(path, quality=quality, optimize=True, progressive=False,
                   subsampling=2)
        after = path.stat().st_size
        print(f"{name}: {width}px -> {image.width}px, "
              f"{before / 1024:.1f}KB -> {after / 1024:.1f}KB")


if __name__ == "__main__":
    main()
