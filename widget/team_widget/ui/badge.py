"""The two marks, from vector files so they are sharp at any size (both from Wikimedia Commons):
assets/amg-logo.svg (the AMG wordmark, "AMG logo.svg") finished here in chrome, and assets/mercedes-star.svg
(the chrome three-pointed star, "Mercedes-Benz Star 2022.svg"), drawn as it is. Since 17 Nov the mark (`MARK`, `star()`)
is the Farol, the widget's pet (assets/farol-idle.png).

scripts/make_badge.py renders the same AMG badge for the Hub (frontend/assets/amg-wordmark.png).
"""
from pathlib import Path

from PySide6.QtCore import QPointF, QRectF, Qt
from PySide6.QtGui import QColor, QImage, QLinearGradient, QPainter, QPen
from PySide6.QtSvg import QSvgRenderer

ASSETS = Path(__file__).resolve().parents[1] / "assets"
_svgs: dict[str, QSvgRenderer] = {}
_images: dict[tuple, QImage] = {}
MARK = "farol-idle.png"   # 17 nov: o Farol, o pet do widget (16 nov era o robô do portátil, mascot.svg; antes a estrela)


def _mark(q: QPainter, rect: QRectF):
    """The mark in `rect`: an svg stretched to it, a picture fitted inside it (the Farol is taller than wide)."""
    if MARK.endswith(".svg"):
        _svg(MARK).render(q, rect)
        return
    key = ("mark-src", MARK)
    if key not in _images:
        _images[key] = QImage(str(ASSETS / MARK))
    src = _images[key]
    if src.isNull():
        return
    k = min(rect.width() / src.width(), rect.height() / src.height())
    w, h = src.width() * k, src.height() * k
    q.save()
    q.setRenderHint(QPainter.SmoothPixmapTransform)
    q.drawImage(QRectF(rect.center().x() - w / 2, rect.center().y() - h / 2, w, h), src)
    q.restore()


def _svg(name: str) -> QSvgRenderer:
    if name not in _svgs:
        _svgs[name] = QSvgRenderer(str(ASSETS / name))
    return _svgs[name]


def chrome(top: float, h: float) -> QLinearGradient:
    """Polished metal, top to bottom: bright, a dark band through the middle, light again."""
    g = QLinearGradient(0, top, 0, top + h)
    for at, colour in ((0, "#ffffff"), (0.32, "#dfe2e6"), (0.48, "#7c8187"), (0.54, "#4c5056"), (0.7, "#d3d6da"), (1, "#9a9fa5")):
        g.setColorAt(at, QColor(colour))
    return g


def dark_chrome(top: float, h: float) -> QLinearGradient:
    """Graphite metal, for light backgrounds where bright chrome would vanish."""
    g = QLinearGradient(0, top, 0, top + h)
    for at, colour in ((0, "#5d636b"), (0.35, "#3a3e44"), (0.5, "#16181b"), (0.62, "#2e3237"), (1, "#4a4f56")):
        g.setColorAt(at, QColor(colour))
    return g


def width(h: float) -> float:
    vb = _svg("amg-logo.svg").viewBoxF()
    return h * vb.width() / vb.height()


def image(h: float, dpr: float = 1.0, shadow: bool = False, dark: bool = False) -> QImage:
    """The AMG badge `h` tall, in chrome (graphite when `dark`, or a soft shadow of itself), at the screen's pixel density."""
    key = ("amg", round(h, 2), round(dpr, 2), shadow, dark)
    if key not in _images:
        w = width(h)
        img = QImage(max(1, round(w * dpr)), max(1, round(h * dpr)), QImage.Format_ARGB32_Premultiplied)
        img.setDevicePixelRatio(dpr)
        img.fill(Qt.transparent)
        p = QPainter(img)
        p.setRenderHint(QPainter.Antialiasing)
        _svg("amg-logo.svg").render(p, QRectF(0, 0, w, h))   # black shapes: used as a mask
        p.setCompositionMode(QPainter.CompositionMode_SourceIn)
        p.fillRect(QRectF(0, 0, w, h), QColor(0, 0, 0, 140) if shadow else dark_chrome(0, h) if dark else chrome(0, h))
        p.end()
        _images[key] = img
    return _images[key]


def paint(p: QPainter, x: float, y: float, h: float, alpha: float = 1.0, dark: bool = False) -> float:
    """Draws the AMG badge with its top-left at (x, y), `h` tall, in chrome or graphite; returns its width."""
    dpr = p.device().devicePixelRatioF() if p.device() else 1.0
    w = width(h)
    p.save()
    p.setRenderHint(QPainter.SmoothPixmapTransform)
    p.setOpacity(p.opacity() * alpha)
    p.drawImage(QRectF(x, y, w, h), image(h, dpr, dark=dark))
    p.restore()
    return w


def star(p: QPainter, rect: QRectF, opacity: float = 1.0, shadow: bool = False):
    """The Mercedes star in `rect`, with an optional soft shadow under it so it sits on any background."""
    if shadow:
        dpr = p.device().devicePixelRatioF() if p.device() else 1.0
        key = ("star-shadow", round(rect.width(), 1), round(dpr, 2))
        if key not in _images:
            img = QImage(max(1, round(rect.width() * dpr)), max(1, round(rect.height() * dpr)), QImage.Format_ARGB32_Premultiplied)
            img.setDevicePixelRatio(dpr)
            img.fill(Qt.transparent)
            q = QPainter(img)
            q.setRenderHint(QPainter.Antialiasing)
            _mark(q, QRectF(0, 0, rect.width(), rect.height()))
            q.setCompositionMode(QPainter.CompositionMode_SourceIn)
            q.fillRect(QRectF(0, 0, rect.width(), rect.height()), QColor(0, 0, 0, 110))
            q.end()
            _images[key] = img
        p.save()
        p.setOpacity(p.opacity() * opacity)
        for dx, dy in ((0, 2), (0, 3), (1, 2.5), (-1, 2.5)):
            p.drawImage(rect.translated(dx, dy), _images[key])
        p.restore()
    p.save()
    p.setRenderHint(QPainter.Antialiasing)
    p.setOpacity(p.opacity() * opacity)
    _mark(p, rect)
    p.restore()


