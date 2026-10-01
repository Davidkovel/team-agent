"""Draws the Agente AMG mark: a violet tile with an arrow-shaped "A" and a glowing node (the agent).

Writes frontend/logo.svg (site), frontend/favicon.png and widget/team_widget/assets/logo.png.
Run: python scripts/make_logo.py
"""
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageOps

ROOT = Path(__file__).resolve().parents[1]
S = 1024  # drawn big, then scaled down for smooth edges

SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#b794ff"/><stop offset="1" stop-color="#5b30d6"/></linearGradient>
    <radialGradient id="h" cx=".5" cy=".62" r=".5"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="64" height="64" rx="15" fill="url(#g)"/>
  <circle cx="32" cy="39" r="15" fill="url(#h)"/>
  <path d="M17 47 L32 15 L47 47" fill="none" stroke="#fff" stroke-width="5.2" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="32" cy="38" r="4.6" fill="#fff"/>
</svg>
"""


def tile() -> Image.Image:
    big = Image.linear_gradient("L").resize((S * 2, S * 2)).rotate(45, resample=Image.BICUBIC)  # oversized so no corner shows
    gradient = ImageOps.colorize(big.crop((S // 2, S // 2, S // 2 + S, S // 2 + S)), "#5b30d6", "#b794ff").convert("RGBA")
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, S - 1, S - 1), radius=int(S * 0.235), fill=255)
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    img.paste(gradient, (0, 0), mask)

    k = S / 64
    glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse((17 * k, 24 * k, 47 * k, 54 * k), fill=(255, 255, 255, 150))
    img = Image.alpha_composite(img, glow.filter(ImageFilter.GaussianBlur(S * 0.05)))

    mark = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(mark)
    points = [(17 * k, 47 * k), (32 * k, 15 * k), (47 * k, 47 * k)]
    width = int(5.2 * k)
    d.line(points, fill="white", width=width, joint="curve")
    for x, y in (points[0], points[2]):
        d.ellipse((x - width / 2, y - width / 2, x + width / 2, y + width / 2), fill="white")
    d.ellipse((32 * k - 4.6 * k, 38 * k - 4.6 * k, 32 * k + 4.6 * k, 38 * k + 4.6 * k), fill="white")
    img = Image.alpha_composite(img, mark)
    return ImageChops.composite(img, Image.new("RGBA", (S, S), (0, 0, 0, 0)), img.split()[3])


def main():
    img = tile()
    targets = {ROOT / "frontend" / "favicon.png": 64, ROOT / "widget" / "team_widget" / "assets" / "logo.png": 256}
    for path, size in targets.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        img.resize((size, size), Image.LANCZOS).save(path)
    (ROOT / "frontend" / "logo.svg").write_text(SVG, encoding="utf-8")
    print("logo written")


if __name__ == "__main__":
    main()
