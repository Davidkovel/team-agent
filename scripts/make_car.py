"""Renders the widget's car banner (a flat PNG) from frontend/assets/car.svg using headless Edge.

The site uses the SVG directly; Tk cannot draw SVG, so the widget gets a PNG on its own background colour.
Run: python scripts/make_car.py
"""
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SVG = ROOT / "frontend" / "assets" / "car.svg"
OUT = ROOT / "widget" / "team_widget" / "assets" / "car.png"
BG = "#000000"  # the widget's background
WIDTH, HEIGHT = 312, 128
EDGES = (r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe", r"C:\Program Files\Microsoft\Edge\Application\msedge.exe")


def main():
    edge = next((e for e in EDGES if Path(e).exists()), None)
    if not edge:
        raise SystemExit("Microsoft Edge not found")
    with tempfile.TemporaryDirectory() as tmp:
        page = Path(tmp) / "car.html"
        # crop the empty top of the artwork: the car starts at y = 90 of 440
        page.write_text(f'<body style="margin:0;background:{BG};overflow:hidden"><img src="{SVG.as_uri()}" '
                        f'style="display:block;width:{WIDTH * 1.12:.0f}px;margin:-{HEIGHT * 0.30:.0f}px 0 0 -{WIDTH * 0.06:.0f}px"></body>', encoding="utf-8")
        OUT.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run([edge, "--headless=new", f"--screenshot={OUT}", f"--window-size={WIDTH},{HEIGHT}", "--hide-scrollbars", page.as_uri()],
                       capture_output=True, timeout=60)
    print("car banner written", OUT)


if __name__ == "__main__":
    main()
