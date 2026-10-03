"""Renders the chrome AMG badge (widget/team_widget/ui/badge.py, from assets/amg-logo.svg) to the Hub's
wordmark PNG, so the Hub and the widget show the same badge. Transparent, 120 px tall: sharp at the sizes the Hub uses.
Run after changing the badge: python scripts/make_badge.py
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "widget"))

from PySide6.QtGui import QGuiApplication  # noqa: E402

OUT = ROOT / "frontend" / "assets" / "amg-wordmark.png"


def main():
    app = QGuiApplication(sys.argv)  # SVG text and gradients need an application
    from team_widget.ui import badge

    img = badge.image(120)
    img.save(str(OUT))
    print("badge written", OUT, img.width(), "x", img.height())
    del app


if __name__ == "__main__":
    main()
