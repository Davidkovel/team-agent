"""The AMG badge: the real chrome logo (assets/amg-logo.png, cut out of its black background), drawn at any height.

The Hub shows the same picture as frontend/assets/amg-wordmark.png.
"""
from pathlib import Path

from PySide6.QtCore import QRectF
from PySide6.QtGui import QImage, QPainter

LOGO = Path(__file__).resolve().parents[1] / "assets" / "amg-logo.png"
_image: QImage | None = None


def _logo() -> QImage:
    global _image
    if _image is None:
        _image = QImage(str(LOGO))
    return _image


def width(h: float) -> float:
    img = _logo()
    return h * img.width() / max(1, img.height())


def paint(p: QPainter, x: float, y: float, h: float, alpha: float = 1.0) -> float:
    """Draws the badge with its top-left at (x, y), `h` tall; returns its width."""
    w = width(h)
    p.save()
    p.setRenderHint(QPainter.SmoothPixmapTransform)
    p.setRenderHint(QPainter.Antialiasing)
    p.setOpacity(p.opacity() * alpha)
    p.drawImage(QRectF(x, y, w, h), _logo())
    p.restore()
    return w
