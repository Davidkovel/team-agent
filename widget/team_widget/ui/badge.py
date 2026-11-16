"""The two marks, from vector files so they are sharp at any size (both from Wikimedia Commons):
assets/amg-logo.svg (the AMG wordmark, "AMG logo.svg") finished here in chrome, and assets/mercedes-star.svg
(the chrome three-pointed star, "Mercedes-Benz Star 2022.svg"), drawn as it is.

scripts/make_badge.py renders the same AMG badge for the Hub (frontend/assets/amg-wordmark.png).
"""
from pathlib import Path

from PySide6.QtCore import QPointF, QRectF, Qt
from PySide6.QtGui import QColor, QImage, QLinearGradient, QPainter, QPen
from PySide6.QtSvg import QSvgRenderer

ASSETS = Path(__file__).resolve().parents[1] / "assets"
_svgs: dict[str, QSvgRenderer] = {}
_images: dict[tuple, QImage] = {}
MARK = "mascot.svg"   # 16 nov, David: o robô com o portátil em vez da estrela da Mercedes


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
            _svg(MARK).render(q, QRectF(0, 0, rect.width(), rect.height()))
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
    _svg(MARK).render(p, rect)
    p.restore()


def mascot_live(p: QPainter, rect: QRectF, t: float, opacity: float = 1.0):
    """The robot alive (16 Nov, David: «интерактивнее, в движении, маленькими шагами»): it steps in place, little hops
    with a sway from foot to foot, blinks now and then, and the antenna tip breathes. The robot itself is one cached
    image per size, so a frame is a drawImage and three small shapes: cheap enough for ~11 frames a second."""
    import math
    dpr = p.device().devicePixelRatioF() if p.device() else 1.0
    key = ("robot", round(rect.width(), 1), round(dpr, 2))
    if key not in _images:
        img = QImage(max(1, round(rect.width() * dpr)), max(1, round(rect.height() * dpr)), QImage.Format_ARGB32_Premultiplied)
        img.setDevicePixelRatio(dpr)
        img.fill(Qt.transparent)
        q = QPainter(img)
        q.setRenderHint(QPainter.Antialiasing)
        _svg(MARK).render(q, QRectF(0, 0, rect.width(), rect.height()))
        q.end()
        _images[key] = img
    k = rect.width() / 100.0
    phase = (t / 0.85) % 1.0                     # one step every 0.425 s, left foot then right
    hop = abs(math.sin(math.pi * 2 * phase)) * 3.2 * k
    tilt = math.sin(math.pi * 2 * phase) * 4.0
    p.save()
    p.setRenderHint(QPainter.Antialiasing)
    p.setRenderHint(QPainter.SmoothPixmapTransform)
    p.setOpacity(p.opacity() * opacity)
    p.translate(rect.left() + 50 * k, rect.top() + 93 * k - hop)
    p.rotate(tilt)
    p.translate(-50 * k, -93 * k)
    p.drawImage(QRectF(0, 0, rect.width(), rect.height()), _images[key])
    # the antenna tip breathes
    pulse = 0.5 + 0.5 * math.sin(t * 3.1)
    p.setPen(Qt.NoPen)
    p.setBrush(QColor(255, 58, 42, round(40 + 90 * pulse)))
    p.drawEllipse(QRectF((50 - 4 - 3 * pulse) * k, (7 - 4 - 3 * pulse) * k, (8 + 6 * pulse) * k, (8 + 6 * pulse) * k))
    # a blink every few seconds (a double one now and then)
    b = t % 4.3
    if b < 0.14 or 0.32 < b < 0.44 and int(t / 4.3) % 3 == 0:
        p.setBrush(QColor(8, 8, 10))
        p.drawRoundedRect(QRectF(26 * k, 27 * k, 48 * k, 22 * k), 9 * k, 9 * k)
        pen = QPen(QColor("#ff4433"), 3.0 * k)
        pen.setCapStyle(Qt.RoundCap)
        p.setPen(pen)
        p.drawLine(QPointF(33 * k, 39 * k), QPointF(45 * k, 39 * k))
        p.drawLine(QPointF(55 * k, 39 * k), QPointF(67 * k, 39 * k))
    p.restore()
