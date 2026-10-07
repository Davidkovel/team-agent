"""The car in profile: a black coupe parked under a studio light, animated at the monitor's refresh rate.

No outlines and no loud colours: gloss black paint, tinted glass, dark wheels. The motion is slow on purpose:
a soft band of light glides over the paint every few seconds, the spotlight on the floor breathes and the
headlight glows. Everything that does not move is drawn once into a cache. scripts/make_car.py writes the same
car as an SVG for the Hub, from the shapes and colours below.
"""
import math

from PySide6.QtCore import QPointF, QRectF, Qt
from PySide6.QtGui import QBrush, QColor, QImage, QLinearGradient, QPainter, QPainterPath, QPen, QPixmap, QRadialGradient
from PySide6.QtWidgets import QSizePolicy, QWidget

from .motion import clock

W, H = 352.0, 128.0          # design space; the drawing is scaled to the widget's width
TOP = 18.0                   # empty sky above the roof, cropped off
GROUND = 104.0
WHEEL_R = 21.0
WHEELS = (QPointF(82, GROUND - WHEEL_R), QPointF(262, GROUND - WHEEL_R))
SWEEP_EVERY, SWEEP_TAKES = 9.0, 4.2   # seconds: one slow pass of light, then rest
BREATH = 8.0                          # seconds per breath of the floor light

# paint, as (y, colour) stops from roof to sill: dark, a lit shoulder crease, then into shadow
BODY_STOPS = ((30, "#36383d"), (44, "#151619"), (58, "#212327"), (62.5, "#323438"), (65, "#0e0f11"), (80, "#08080a"), (93, "#030304"))
RIM_STOPS = ((29, 0.62), (40, 0.34), (52, 0.12), (60, 0.0))      # light catching the roof and bonnet edges


def pen(colour, width) -> QPen:
    p = QPen(QBrush(colour), width)
    p.setCapStyle(Qt.RoundCap)
    p.setJoinStyle(Qt.RoundJoin)
    return p


def white(alpha: float) -> QColor:
    return QColor(255, 255, 255, int(255 * alpha))


def _arch(cx):
    return QRectF(cx - 26, WHEELS[0].y() - 26, 52, 52)


def body_path() -> QPainterPath:
    p = QPainterPath(QPointF(30, 93))
    p.lineTo(25, 88)
    p.cubicTo(22, 82, 22, 72, 24, 66)              # tail
    p.cubicTo(25, 62, 27, 59.5, 31, 58.5)
    p.lineTo(40, 57.2)                              # ducktail
    p.cubicTo(52, 55.5, 62, 53, 72, 49)             # short rear deck
    p.cubicTo(102, 37, 132, 32, 158, 31.5)          # fastback
    p.cubicTo(174, 31.2, 186, 32.5, 195, 36)
    p.cubicTo(207, 41, 215, 46, 224, 50)            # windscreen
    p.cubicTo(255, 53, 290, 56, 313, 62)            # long bonnet
    p.cubicTo(322, 64.5, 327, 69, 328.5, 75)        # nose
    p.cubicTo(329.5, 80, 327.5, 86, 322, 90.5)
    p.lineTo(287, 91)
    p.arcTo(_arch(262), -14, 208)                   # front arch
    p.lineTo(107, 91.5)
    p.arcTo(_arch(82), -14, 208)                    # rear arch
    p.closeSubpath()
    return p


def glass_path() -> QPainterPath:
    p = QPainterPath(QPointF(80, 51.5))
    p.cubicTo(106, 41.5, 132, 35.5, 158, 35)
    p.cubicTo(174, 34.8, 185, 36, 192, 39.5)
    p.cubicTo(199, 43, 205, 47, 209, 49.6)
    p.cubicTo(170, 50.2, 110, 51, 80, 51.5)
    p.closeSubpath()
    return p


def mirror_path() -> QPainterPath:
    p = QPainterPath(QPointF(204, 48))
    p.cubicTo(203, 42, 212, 40, 219, 42.5)
    p.cubicTo(220, 44.5, 219, 47, 216.5, 48.5)
    p.closeSubpath()
    return p


def seam_path() -> QPainterPath:
    """Shut lines and small details, pressed into the paint."""
    p = QPainterPath()
    p.moveTo(212, 52); p.cubicTo(210.5, 66, 210, 78, 212, 90)       # door, front edge
    p.moveTo(122, 52); p.cubicTo(125, 66, 126, 78, 124, 90.5)       # door, rear edge
    p.moveTo(149, 35.3); p.lineTo(140, 51)                          # B-pillar
    p.moveTo(152, 59); p.lineTo(167, 58.8)                          # handle
    for i in range(3):                                              # wing vent
        y = 67 + i * 3.6
        p.moveTo(227 - i, y); p.lineTo(235 - i * 0.5, y - 1)
    p.moveTo(112, 81.5); p.cubicTo(150, 79, 200, 79, 233, 81.5)     # sculpted sill
    p.moveTo(300, 85.5); p.lineTo(323, 87)                          # splitter
    p.moveTo(27, 87.5); p.lineTo(47, 90)                            # diffuser
    return p


def shoulder_path() -> QPainterPath:
    p = QPainterPath(QPointF(28, 62.5))
    p.cubicTo(110, 59.5, 220, 58, 316, 63.5)
    return p


def headlight_path() -> QPainterPath:
    p = QPainterPath(QPointF(299, 60.5))
    p.cubicTo(309, 61.5, 317, 63.5, 323, 67)
    p.lineTo(320.5, 69)
    p.cubicTo(312, 66.5, 304, 64.5, 297.5, 63.5)
    p.closeSubpath()
    return p


def taillight_path() -> QPainterPath:
    p = QPainterPath(QPointF(26, 61))
    p.lineTo(41, 58.2)
    p.lineTo(41, 60.8)
    p.lineTo(25.4, 64)
    p.closeSubpath()
    return p


def stops_y(y0, y1, stops):
    return [((y - y0) / (y1 - y0), c) for y, c in stops]


class CarView(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)
        self.setFixedHeight(int(H - TOP))
        self._body, self._glass, self._mirror = body_path(), glass_path(), mirror_path()
        self._paint = QPainterPath(self._body)
        self._paint.addPath(self._mirror)
        self._cache, self._cache_key = None, None
        self._lights = self._lights_to = 0.35   # headlight level, eased
        self._t, self._last = 0.0, None
        clock().frame.connect(self._advance)

    def set_status(self, status: str):
        self._lights_to = 0.35 if status == "OFFLINE" else 1.0

    # ------------------------------------------------------------ animation

    def showEvent(self, e):
        super().showEvent(e)
        clock().need(self)   # the light moves for as long as the car is on the screen

    def hideEvent(self, e):
        super().hideEvent(e)
        clock().need(self, False)

    def _advance(self, t: float):
        if not self.isVisible():
            self._last = None
            return
        dt = 0.0 if self._last is None else min(t - self._last, 0.1)
        self._last, self._t = t, t
        self._lights += (self._lights_to - self._lights) * (1 - math.exp(-dt * 1.2))
        self.update()

    # ------------------------------------------------------------ the parked car, drawn once

    def _fit(self):
        scale = self.width() / W
        return scale, 0.0, -TOP * scale

    def _build_cache(self, scale) -> QPixmap:
        dpr = self.devicePixelRatioF()
        img = QImage(int(math.ceil(W * scale * dpr)), int(math.ceil(H * scale * dpr)), QImage.Format_ARGB32_Premultiplied)
        img.fill(Qt.transparent)
        p = QPainter(img)
        p.setRenderHint(QPainter.Antialiasing)
        p.scale(scale * dpr, scale * dpr)
        self.draw_static(p)
        p.end()
        pix = QPixmap.fromImage(img)
        pix.setDevicePixelRatio(dpr)
        return pix

    def draw_static(self, p: QPainter):
        # contact shadow, so the car sits on the lit floor
        shadow = QRadialGradient(QPointF(0, 0), 1)
        shadow.setColorAt(0, QColor(0, 0, 0, 240))
        shadow.setColorAt(1, QColor(0, 0, 0, 0))
        p.save()
        p.translate(176, GROUND)
        p.scale(158, 5.5)
        p.setPen(Qt.NoPen)
        p.setBrush(shadow)
        p.drawEllipse(QPointF(0, 0), 1, 1)
        p.restore()

        paint = QLinearGradient(0, 30, 0, 93)
        for at, colour in stops_y(30, 93, BODY_STOPS):
            paint.setColorAt(at, QColor(colour))
        p.fillPath(self._paint, paint)
        ends = QLinearGradient(20, 0, 332, 0)          # the ends turn away from the light
        ends.setColorAt(0, QColor(0, 0, 0, 150))
        ends.setColorAt(0.18, QColor(0, 0, 0, 0))
        ends.setColorAt(0.82, QColor(0, 0, 0, 0))
        ends.setColorAt(1, QColor(0, 0, 0, 130))
        p.fillPath(self._body, ends)
        floor = QLinearGradient(0, 70, 0, 84)          # the lit floor, mirrored low on the doors
        for at, a in ((0, 0), (0.55, 0.045), (1, 0)):
            floor.setColorAt(at, white(a))
        p.fillPath(self._body, floor)

        p.fillPath(self._glass, QColor(5, 6, 7))
        sheen = QLinearGradient(80, 30, 200, 54)
        for at, a in ((0, 0), (0.35, 0.07), (0.5, 0.02), (0.7, 0.06), (1, 0)):
            sheen.setColorAt(at, white(a))
        p.fillPath(self._glass, sheen)

        seams = seam_path()
        p.strokePath(seams.translated(0, 0.7), pen(white(0.05), 0.6))
        p.strokePath(seams, pen(QColor(0, 0, 0, 230), 0.8))
        p.strokePath(shoulder_path(), pen(white(0.09), 1.1))

        rim = QLinearGradient(0, RIM_STOPS[0][0], 0, RIM_STOPS[-1][0])
        for at, a in stops_y(RIM_STOPS[0][0], RIM_STOPS[-1][0], RIM_STOPS):
            rim.setColorAt(at, white(a))
        p.strokePath(self._paint, pen(rim, 0.9))

        p.fillPath(taillight_path(), QColor(28, 29, 32))
        p.strokePath(taillight_path(), pen(white(0.10), 0.5))
        for c in WHEELS:
            self._wheel(p, c)

    @staticmethod
    def _wheel(p: QPainter, c: QPointF):
        r = WHEEL_R
        tyre = QRadialGradient(c, r)
        tyre.setColorAt(0.78, QColor(9, 9, 10))
        tyre.setColorAt(0.94, QColor(24, 25, 27))
        tyre.setColorAt(1, QColor(6, 6, 7))
        p.setPen(Qt.NoPen)
        p.setBrush(tyre)
        p.drawEllipse(c, r, r)
        p.setBrush(QColor(11, 11, 12))
        p.drawEllipse(c, 15.5, 15.5)
        p.setBrush(QColor(17, 18, 20))                  # brake disc behind the spokes
        p.drawEllipse(c, 12, 12)
        face = QRadialGradient(QPointF(c.x() - 4, c.y() - 5), 19)
        face.setColorAt(0, QColor(62, 65, 71))
        face.setColorAt(1, QColor(30, 32, 36))
        for i in range(10):                             # ten thin spokes, lit from above
            a = math.radians(i * 36 - 90)
            inner, outer = QPointF(c.x() + 4.2 * math.cos(a), c.y() + 4.2 * math.sin(a)), QPointF(c.x() + 14.8 * math.cos(a), c.y() + 14.8 * math.sin(a))
            p.setPen(pen(face, 1.7))
            p.drawLine(inner, outer)
            p.setPen(pen(white(0.10), 0.45))
            p.drawLine(inner + QPointF(0, -0.6), outer + QPointF(0, -0.6))
        p.setPen(pen(QColor(75, 78, 84, 180), 0.7))
        p.setBrush(Qt.NoBrush)
        p.drawEllipse(c, 15.3, 15.3)
        p.setPen(pen(QColor(61, 64, 69), 0.6))
        p.setBrush(QColor(26, 27, 30))
        p.drawEllipse(c, 3.4, 3.4)
        p.setPen(pen(white(0.13), 0.9))                 # rim light along the top of the tyre
        p.drawArc(QRectF(c.x() - r + 0.5, c.y() - r + 0.5, 2 * r - 1, 2 * r - 1), 45 * 16, 90 * 16)

    # ------------------------------------------------------------ what moves

    def paintEvent(self, _):
        t = self._t
        scale, ox, oy = self._fit()
        key = (round(scale, 4), self.devicePixelRatioF())
        if key != self._cache_key:
            self._cache, self._cache_key = self._build_cache(scale), key

        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        p.translate(ox, oy)
        p.scale(scale, scale)

        # a dim light behind the car and the spotlight on the floor, breathing slowly; the black paint reads against them
        breath = 0.88 + 0.12 * math.sin(t * 2 * math.pi / BREATH)
        back = QRadialGradient(QPointF(0, 0), 1)
        back.setColorAt(0, white(0.055 * breath))
        back.setColorAt(1, white(0))
        p.save()
        p.translate(176, 62)
        p.scale(185, 58)
        p.setPen(Qt.NoPen)
        p.setBrush(back)
        p.drawEllipse(QPointF(0, 0), 1, 1)
        p.restore()
        spot = QRadialGradient(QPointF(0, 0), 1)
        spot.setColorAt(0, white(0.12 * breath))
        spot.setColorAt(0.6, white(0.03 * breath))
        spot.setColorAt(1, white(0))
        p.save()
        p.translate(176, GROUND + 1)
        p.scale(200, 22)
        p.setPen(Qt.NoPen)
        p.setBrush(spot)
        p.drawEllipse(QPointF(0, 0), 1, 1)
        p.restore()

        p.save()
        p.resetTransform()
        p.drawPixmap(QPointF(ox, oy), self._cache)
        p.restore()

        # headlight
        lights = self._lights * (0.9 + 0.1 * math.sin(t * 2 * math.pi / 4.5))
        glow = QRadialGradient(QPointF(318, 65.5), 11)
        glow.setColorAt(0, white(0.22 * lights))
        glow.setColorAt(1, white(0))
        p.setPen(Qt.NoPen)
        p.setBrush(glow)
        p.drawEllipse(QPointF(318, 65.5), 11, 11)
        p.fillPath(headlight_path(), QColor(215, 218, 221, int(70 + 150 * lights)))

        # a soft band of studio light gliding over the paint, rear to front
        phase = (t % SWEEP_EVERY) / SWEEP_TAKES
        if phase < 1:
            eased = phase * phase * (3 - 2 * phase)
            sx = -80 + eased * (W + 160)
            band = QLinearGradient(QPointF(sx - 55, 75), QPointF(sx + 55, 20))
            for at, a in ((0, 0), (0.5, 0.16), (1, 0)):
                band.setColorAt(at, white(a))
            p.fillPath(self._paint, band)
            glass = QLinearGradient(QPointF(sx - 40, 75), QPointF(sx + 40, 20))
            for at, a in ((0, 0), (0.5, 0.2), (1, 0)):
                glass.setColorAt(at, white(a))
            p.fillPath(self._glass, glass)
            edge = QLinearGradient(QPointF(sx - 70, 0), QPointF(sx + 70, 0))
            for at, a in ((0, 0), (0.5, 0.45), (1, 0)):
                edge.setColorAt(at, white(a))
            p.setClipRect(QRectF(0, 0, W, 61))         # only the top edges catch it, never the sills
            p.strokePath(self._paint, pen(edge, 0.9))
        p.end()
