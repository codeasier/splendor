"""Compress generated 3x3 contact sheets for the shared theme art pipeline.

Usage: uv run --with pillow python preview/prepare-theme-art.py SOURCE_DIRECTORY
Raw generated images stay outside the mini-program project.

尺寸与质量的依据（2026-11-12 实测）：
  图集只以 background-size:300% 300% 复用，单格在牌桌的实际显示尺寸为
  卡面 92x112 / 头像 64x80 / 建房预览缩略图，160px 图集分辨率明显过剩。
  主题样式是把整张图集 base64 内嵌进 WXSS 的，体积直接计入主包 2MiB 预算，
  三套合计曾经顶到 194KB。降到 144px/格（432 总宽）+ q52 后单套约 36KB，
  三套合计约 143KB，比原来省约 51KB；在 432px 与 q52 下肉眼无可察觉劣化
  （含赛博朋克深色渐变，未见色带或块状伪影）。

  注意：不要用 macOS 的 sips 重编码，它的 JPEG 编码器效率明显低于 PIL
  optimize=True，同一张图会从 36KB 涨到 70KB+。
"""

from pathlib import Path
import sys
from PIL import Image

TILE = 144          # 单格边长，3 格合计 432
QUALITY = 52
SUBSAMPLING = 2     # 4:2:0，深色渐变下未见色带

source = Path(sys.argv[1])
output = Path(__file__).resolve().parent / "thumbs" / "themes"
output.mkdir(parents=True, exist_ok=True)

for theme in ("pokemon", "cyberpunk", "ai"):
    image = Image.open(source / f"splendor-{theme}-atlas.png").convert("RGB")
    atlas = Image.new("RGB", (TILE * 3, TILE * 3))
    for row in range(3):
        for col in range(3):
            box = (round(col * image.width / 3) + 3,
                   round(row * image.height / 3) + 3,
                   round((col + 1) * image.width / 3) - 3,
                   round((row + 1) * image.height / 3) - 3)
            tile = image.crop(box).resize((TILE, TILE), Image.Resampling.LANCZOS)
            atlas.paste(tile, (col * TILE, row * TILE))
    target = output / f"{theme}.jpg"
    atlas.save(target, quality=QUALITY, optimize=True, progressive=False,
               subsampling=SUBSAMPLING)
    print(f"{theme}: {target.stat().st_size} bytes")
