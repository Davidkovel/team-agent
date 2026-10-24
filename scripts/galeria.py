"""Galeria de sites (Hub › Skills › Galeria): tira a fotografia de um site para o cartão dele.

    python scripts/galeria.py <id> <url> [--wait 10] [--click X,Y | --click "text=Begin"] [--scroll 0]

Abre o site num Chrome com GPU (os sites WebGL ficam pretos sem ela), espera, clica se for preciso (botões «Begin
experience», cookies: escolher sempre recusar), desce `--scroll` píxeis e grava frontend/hub/galeria/<id>.jpg em
800x478. Depois junta-se o site a frontend/hub/galeria/sites.json (skill site-imersivo-3d, «Juntar um site»).
"""
import argparse
import time
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

OUT = Path(__file__).resolve().parent.parent / "frontend" / "hub" / "galeria"


def shoot(sid, url, wait=10, click=None, scroll=0):
    raw = OUT / f"{sid}.png"
    with sync_playwright() as p:
        b = p.chromium.launch(channel="chrome", headless=False, args=["--window-position=-2400,0", "--ignore-gpu-blocklist"])
        pg = b.new_page(viewport={"width": 1440, "height": 860})
        pg.goto(url, timeout=60000, wait_until="domcontentloaded")
        time.sleep(wait)
        if click:
            if "," in click and click.replace(",", "").isdigit():
                pg.mouse.click(*map(int, click.split(",")))
            else:
                pg.locator(click).first.click(timeout=8000)
            time.sleep(5)
        for _ in range(scroll // 300):
            pg.mouse.wheel(0, 300)
            time.sleep(0.25)
        time.sleep(3 if scroll else 0)
        pg.screenshot(path=str(raw))
        b.close()
    Image.open(raw).convert("RGB").resize((800, 478), Image.LANCZOS).save(OUT / f"{sid}.jpg", quality=68, optimize=True)
    raw.unlink()
    return OUT / f"{sid}.jpg"


if __name__ == "__main__":
    a = argparse.ArgumentParser()
    a.add_argument("id")
    a.add_argument("url")
    a.add_argument("--wait", type=int, default=10)
    a.add_argument("--click")
    a.add_argument("--scroll", type=int, default=0)
    o = a.parse_args()
    print(shoot(o.id, o.url, o.wait, o.click, o.scroll))
