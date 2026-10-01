"""Draws the Agente AMG brand images from scratch (nothing is copied from a photo).

  logo.png          black tile with the agent: silver hat and coat, glowing white eyes
  amg-wordmark.png  "AGENTE AMG" in wide chrome letters with three slanted silver bars

Writes frontend/logo.png, frontend/favicon.png, frontend/assets/amg-wordmark.png and the widget copies.
Run: python scripts/make_logo.py
"""
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[1]
S = 1024
K = S / 64  # the tile is designed on a 64x64 grid
SILVER, TEAL, TEAL2 = "#e6eaec", "#1c1c1c", "#ffffff"


def pts(points):
    return [(x * K, y * K) for x, y in points]


def logo_tile() -> Image.Image:
    # background: graphite to black, thin teal rim
    gradient = Image.linear_gradient("L").resize((S * 2, S * 2)).rotate(45, resample=Image.BICUBIC)
    tile = ImageOps.colorize(gradient.crop((S // 2, S // 2, S // 2 + S, S // 2 + S)), "#000000", "#1c1c1c").convert("RGBA")
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, S - 1, S - 1), radius=int(S * 0.235), fill=255)
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    img.paste(tile, (0, 0), mask)
    rim = Image.new("L", (S, S), 0)
    ImageDraw.Draw(rim).rounded_rectangle((0, 0, S - 1, S - 1), radius=int(S * 0.235), outline=255, width=int(S * 0.02))
    img.paste(Image.new("RGBA", (S, S), "#7a7a7a"), (0, 0), ImageChops.multiply(rim, mask))

    # white glow behind the eyes
    glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    for cx in (28.8, 35.2):
        gd.ellipse(((cx - 4) * K, 27.5 * K, (cx + 4) * K, 34.5 * K), fill=(255, 255, 255, 170))
    img = Image.alpha_composite(img, glow.filter(ImageFilter.GaussianBlur(S * 0.022)))

    art = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(art)
    # coat with shoulders, dark shirt V and lapel cuts
    d.polygon(pts([(9, 59), (13.5, 45), (22, 39), (32, 47.5), (42, 39), (50.5, 45), (55, 59)]), fill="#d3d9dc")
    d.polygon(pts([(25.5, 39.5), (32, 58), (38.5, 39.5), (32, 47.5)]), fill="#07090a")
    d.line(pts([(22, 39), (30, 58)]), fill="#07090a", width=int(K * 1.1))
    d.line(pts([(42, 39), (34, 58)]), fill="#07090a", width=int(K * 1.1))
    # masked face, covered up to the nose
    d.polygon(pts([(25.5, 26), (38.5, 26), (38.5, 38), (32, 41.5), (25.5, 38)]), fill="#0c0f10")
    d.polygon(pts([(26.2, 34.6), (32, 37.4), (37.8, 34.6), (37.8, 36), (32, 39), (26.2, 36)]), fill="#1b2023")
    # eyes
    d.polygon(pts([(26.8, 30.2), (30.8, 29.2), (30.6, 31.7), (27.2, 32.1)]), fill=TEAL2)
    d.polygon(pts([(37.2, 30.2), (33.2, 29.2), (33.4, 31.7), (36.8, 32.1)]), fill=TEAL2)
    # fedora: brim, crown, teal band
    d.ellipse(pts([(12.5, 22.2), (51.5, 30.6)])[0] + pts([(12.5, 22.2), (51.5, 30.6)])[1], fill=SILVER)
    d.rounded_rectangle([*pts([(22.4, 8.8)])[0], *pts([(41.6, 26.6)])[0]], radius=int(K * 7), fill=SILVER)
    d.polygon(pts([(22.4, 21), (41.6, 21), (41.9, 24.8), (22.1, 24.8)]), fill=TEAL)
    d.line(pts([(29, 10.6), (35, 10.6)]), fill="#aeb5b9", width=int(K * 0.9))
    # brim shadow over the mask
    d.polygon(pts([(24.5, 27.6), (39.5, 27.6), (39.5, 28.6), (24.5, 28.6)]), fill="#050606")
    return Image.alpha_composite(img, art)


def chrome_fill(width: int, height: int) -> Image.Image:
    stops = [(0.0, (255, 255, 255)), (0.42, (205, 211, 215)), (0.53, (96, 104, 110)), (0.54, (24, 28, 32)),
             (0.78, (70, 78, 84)), (1.0, (233, 237, 239))]
    fill = Image.new("RGB", (width, height))
    d = ImageDraw.Draw(fill)
    for y in range(height):
        t = y / max(1, height - 1)
        for (t0, c0), (t1, c1) in zip(stops, stops[1:]):
            if t0 <= t <= t1:
                f = (t - t0) / (t1 - t0 or 1)
                d.line([(0, y), (width, y)], fill=tuple(round(a + (b - a) * f) for a, b in zip(c0, c1)))
                break
    return fill


def wordmark() -> Image.Image:
    try:
        font = ImageFont.truetype("C:/Windows/Fonts/bahnschrift.ttf", 300)
        font.set_variation_by_axes([720, 100])
    except Exception:
        font = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", 300)
    text, tracking = "AGENTE AMG", 30
    canvas = Image.new("L", (3600, 460), 0)
    d = ImageDraw.Draw(canvas)
    x = 0
    for ch in text:
        d.text((x, 20), ch, font=font, fill=255)
        x += font.getlength(ch) + (tracking * 2.6 if ch == " " else tracking)
    letters = canvas.crop(canvas.getbbox())
    letters = letters.resize((round(letters.width * 1.32), letters.height), Image.LANCZOS)  # wide, flat stance

    h, pad = letters.height, 6
    # bevel: light edge on the top-left, dark edge on the bottom-right
    shifted = ImageChops.offset(letters, 3, 3)
    light = ImageChops.subtract(letters, shifted)
    dark = ImageChops.subtract(shifted, letters)
    word = Image.new("RGBA", letters.size, (0, 0, 0, 0))
    word.paste(chrome_fill(*letters.size).convert("RGBA"), (0, 0), letters)
    word = Image.alpha_composite(word, Image.merge("RGBA", (Image.new("L", letters.size, 255),) * 3 + (light.point(lambda v: v * 0.85),)))
    word = Image.alpha_composite(word, Image.merge("RGBA", (Image.new("L", letters.size, 0),) * 3 + (dark.point(lambda v: v * 0.55),)))

    # three slanted silver bars in front, drawn here, not taken from anywhere
    skew = round(h * 0.34)
    widths, gap = [round(h * 0.30), round(h * 0.20), round(h * 0.11)], round(h * 0.09)
    bars = Image.new("L", (sum(widths) + gap * 2 + skew + 2, h), 0)
    bd, x = ImageDraw.Draw(bars), 0
    for w in widths:
        bd.polygon([(x + skew, 0), (x + skew + w, 0), (x + w, h), (x, h)], fill=255)
        x += w + gap
    teal = Image.new("RGB", bars.size)
    td = ImageDraw.Draw(teal)
    for y in range(h):
        f = y / h
        td.line([(0, y), (bars.width, y)], fill=(round(255 + (110 - 255) * f), round(255 + (110 - 255) * f), round(255 + (110 - 255) * f)))
    bar_img = Image.new("RGBA", bars.size, (0, 0, 0, 0))
    bar_img.paste(teal.convert("RGBA"), (0, 0), bars)

    gap_after = round(h * 0.34)
    out = Image.new("RGBA", (bar_img.width + gap_after + word.width + pad * 2, h + pad * 2), (0, 0, 0, 0))
    out.paste(bar_img, (pad, pad), bar_img)
    out.paste(word, (pad + bar_img.width + gap_after, pad), word)
    return out


def main():
    tile = logo_tile()
    for path, size in {ROOT / "frontend" / "logo.png": 256, ROOT / "frontend" / "favicon.png": 64,
                       ROOT / "widget" / "team_widget" / "assets" / "logo.png": 256}.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        tile.resize((size, size), Image.LANCZOS).save(path)
    mark = wordmark()
    mark = mark.resize((1100, round(mark.height * 1100 / mark.width)), Image.LANCZOS)
    for path in (ROOT / "frontend" / "assets" / "amg-wordmark.png", ROOT / "widget" / "team_widget" / "assets" / "amg-wordmark.png"):
        path.parent.mkdir(parents=True, exist_ok=True)
        mark.save(path)
    print("brand images written; wordmark", mark.size)


if __name__ == "__main__":
    main()
