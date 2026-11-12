"""Compress generated 3x3 contact sheets for the shared theme art pipeline.

Usage: uv run --with pillow python preview/prepare-theme-art.py SOURCE_DIRECTORY [THEME ...]
Raw generated images stay outside the mini-program project.
"""

from pathlib import Path
import sys
from PIL import Image

source = Path(sys.argv[1])
themes = sys.argv[2:] or ("pokemon", "cyberpunk", "ai")
if any(theme not in ("pokemon", "cyberpunk", "ai") for theme in themes):
    raise SystemExit("Unknown theme; choose pokemon, cyberpunk or ai")
output = Path(__file__).resolve().parent / "thumbs" / "themes"
output.mkdir(parents=True, exist_ok=True)

for theme in themes:
    image = Image.open(source / f"splendor-{theme}-atlas.png").convert("RGB")
    atlas = Image.new("RGB", (480, 480))
    for row in range(3):
        for col in range(3):
            box = (round(col * image.width / 3) + 3,
                   round(row * image.height / 3) + 3,
                   round((col + 1) * image.width / 3) - 3,
                   round((row + 1) * image.height / 3) - 3)
            tile = image.crop(box).resize((160, 160), Image.Resampling.LANCZOS)
            atlas.paste(tile, (col * 160, row * 160))
    target = output / f"{theme}.jpg"
    atlas.save(target, quality=60, optimize=True, progressive=False)
    print(f"{theme}: {target.stat().st_size} bytes")
