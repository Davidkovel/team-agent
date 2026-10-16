"""Reexporta as fotografias com nitidez: dos originais AVIF do site antigo para webp 900/1600.

    python -I _fonte/imagens.py

Os AVIF já vêm comprimidos; um segundo passo a q80 juntava artefactos aos artefactos e a foto ficava «barrada».
Aqui: q90, método 6, e uma máscara de nitidez leve (mais suave na versão grande, que é a nativa). Nunca se amplia:
se o original tem menos de 1600 px, a versão «1600» fica no tamanho nativo.
"""
import sys
from pathlib import Path

from PIL import Image, ImageFilter

ORIG = Path(r"C:\Users\David\ferreras-extra\orig")
IMG = Path(__file__).resolve().parents[1] / "img"


def grava(im, destino, raio, forca):
    im = im.filter(ImageFilter.UnsharpMask(radius=raio, percent=forca, threshold=2))
    im.save(destino, "WEBP", quality=90, method=6)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    for a in sorted(ORIG.glob("*.avif")):
        base = a.stem
        if not (IMG / f"{base}-900.webp").exists():
            continue
        im = Image.open(a).convert("RGB")
        w, h = im.size
        g = im if w <= 1600 else im.resize((1600, round(h * 1600 / w)), Image.LANCZOS)
        grava(g, IMG / f"{base}-1600.webp", 0.9, 45)
        p = im.resize((900, round(h * 900 / w)), Image.LANCZOS) if w > 900 else im
        grava(p, IMG / f"{base}-900.webp", 0.6, 40)
        print(base, im.size)
