"""Makes the Mercedes of the Hub's Início from a photograph: a black Mercedes-AMG GT, head-on, by Szymon Shields on Pexels
(free licence): https://www.pexels.com/photo/a-black-mercedes-benz-6152812/

The street around the car goes black and colourless, the edges and the bottom fade to transparent (so the car comes out
of the page's own black), the number plate is hidden, and it is saved twice as WebP with transparency:

    frontend/assets/amg-front-1200.webp    ordinary screens
    frontend/assets/amg-front-2400.webp    4K and other dense screens (the page picks one with srcset)

A still picture: the browser decodes it once and the graphics card shows it, nothing is redrawn while the page is open.

    python scripts/make_hero_photo.py <the photo, 6000 x 4000> [output folder]
    (needs Pillow and numpy: the widget's Python has both; the output folder defaults to frontend/assets)
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "frontend" / "assets"
CROP = (1340, 1100, 4640, 2500)       # in the 6000 x 4000 photo: from the roof to just under the grille, the car in the middle
PLATE = (2640, 2190, 3380, 2370)      # the number plate, in the photo too
SATURATION = 0.12                     # what is left of the colours: the street's yellow lines and the red car behind go grey
SIZES = (1200, 2400)


def smoothstep(edge0, edge1, x):
    t = np.clip((x - edge0) / (edge1 - edge0), 0, 1)
    return t * t * (3 - 2 * t)


def main(src: Path, out_dir: Path = OUT):
    photo = Image.open(src).convert("RGB")
    plate = photo.crop(PLATE).resize((12, 3), Image.BILINEAR).resize((PLATE[2] - PLATE[0], PLATE[3] - PLATE[1]), Image.BILINEAR)
    photo.paste(plate.filter(ImageFilter.GaussianBlur(18)), PLATE[:2])   # unreadable before it is darkened below
    img = np.asarray(photo.crop(CROP), dtype=np.float32) / 255
    h, w, _ = img.shape
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)

    grey = img @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    img = grey[..., None] + (img - grey[..., None]) * SATURATION
    img = np.clip(img, 0, 1) ** 1.45                                     # darker mids and shadows, the chrome and lights stay bright
    img = smoothstep(0.02, 0.98, img)                                    # a little more contrast
    img *= (0.3 + 0.7 * smoothstep(0.06, 0.36, y / h))[..., None]       # the windscreen mirrors the sky: dim it, the front leads

    # the car sits in an ellipse around the grille; everything outside it goes to black, then to transparent
    cx, cy = w * 0.5, h * 0.53
    d = np.sqrt(((x - cx) / (w * 0.44)) ** 2 + ((y - cy) / (h * 0.66)) ** 2)
    light = 1 - smoothstep(0.62, 1.05, d) * 0.92
    img *= light[..., None]
    px, py = PLATE[0] - CROP[0], PLATE[1] - CROP[1]
    plate_mask = np.exp(-(((x - (px + (PLATE[2] - PLATE[0]) / 2)) / 260) ** 4 + ((y - (py + (PLATE[3] - PLATE[1]) / 2)) / 90) ** 4))
    img *= (1 - 0.88 * plate_mask)[..., None]
    alpha = (1 - smoothstep(0.7, 1.12, d)) * (1 - smoothstep(0.62, 0.98, y / h)) * smoothstep(0.0, 0.1, y / h)

    rgba = np.dstack([np.clip(img, 0, 1), np.clip(alpha, 0, 1)])
    out = Image.fromarray((rgba * 255 + 0.5).astype(np.uint8), "RGBA")
    for width in SIZES:
        name = out_dir / f"amg-front-{width}.webp"
        out.resize((width, round(h * width / w)), Image.LANCZOS).save(name, "WEBP", quality=84, method=6)
        print("written", name, out.size, "->", width, f"{name.stat().st_size // 1024} KB")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(Path(sys.argv[1]), Path(sys.argv[2]) if len(sys.argv) > 2 else OUT)
