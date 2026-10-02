"""The car in profile, drawn as vectors and animated at the monitor's refresh rate.

Calm on purpose: the road drifts by, the wheels roll, a light sweeps along the body every few seconds
and the headlight breathes. The static parts are drawn once into a cache; a frame only moves pixmaps.
"""
import math

from PySide6.QtCore import QPointF, QRectF, Qt
from PySide6.QtGui import QBrush, QColor, QImage, QLinearGradient, QPainter, QPainterPath, QPen, QPixmap, QRadialGradient
from PySide6.QtWidgets import QSizePolicy, QWidget

from .motion import clock

W, H = 352.0, 128.0          # design space; the drawing is scaled to the widget's width
TOP = 16.0                   # empty sky above the roof, cropped off
GROUND = 104.0
WHEEL_R = 20.0
WHEELS = (QPointF(82, GROUND - WHEEL_R), QPointF(262, GROUND - WHEEL_R))
SPEEDS = {"WORKING": 1.0, "OFFLINE": 0.3}   # anything else cruises at 0.55
CRUISE = 46.0                # road units per second at speed 1.0: a stroll, not a race
SWEEP_EVERY, SWEEP_TAKES = 6.5, 2.6


def pen(colour, width) -> QPen:
    p = QPen(QBrush(colour), width)
    p.setCapStyle(Qt.RoundCap)
    p.setJoinStyle(Qt.RoundJoin)
    return p


def _arch(cx):
    return QRectF(cx - 25, WHEELS[0].y() - 25, 50, 50)


def body_path() -> QPainterPath:
    p = QPainterPath(QPointF(30, 92))
    p.lineTo(24, 86)
    p.cubicTo(21, 80, 21, 70, 23, 64)          # tail
    p.lineTo(26, 58)
    p.lineTo(34, 56)                            # ducktail lip
    p.cubicTo(46, 54, 58, 52, 66, 50)           # short rear deck
    p.cubicTo(96, 38, 128, 30, 160, 29)         # fastback
    p.cubicTo(176, 28.5, 186, 30, 194, 33)
    p.cubicTo(206, 39, 216, 45, 226, 49)        # windscreen
    p.cubicTo(256, 52, 290, 55, 312, 61)        # long bonnet
    p.cubicTo(322, 64, 327, 69, 328, 75)        # nose
    p.cubicTo(329, 80, 327, 86, 322, 90)
    p.lineTo(286, 91)
    p.arcTo(_arch(262), -16, 212)               # front arch
    p.lineTo(106, 91)
    p.arcTo(_arch(82), -16, 212)                # rear arch
    p.closeSubpath()
    return p


def glass_path() -> QPainterPath:
    p = QPainterPath(QPointF(78, 51))
    p.cubicTo(104, 41, 132, 34, 160, 33)
    p.cubicTo(176, 32.5, 186, 34, 192, 37)
    p.cubicTo(200, 41, 207, 46, 211, 49)
    p.cubicTo(170, 49.6, 110, 50.4, 78, 51)
    p.closeSubpath()
    return p


def detail_path() -> QPainterPath:
    """Shut lines, shoulder, sills, handle, vent, mirror."""
    p = QPainterPath()
    p.moveTo(26, 63); p.cubicTo(110, 59, 220, 57, 316, 63)            # shoulder line
    p.moveTo(112, 81); p.cubicTo(150, 78.5, 200, 78.5, 234, 81)       # sculpted sill
    p.moveTo(213, 51); p.cubicTo(211, 66, 210, 78, 212, 90)           # door, front edge
    p.moveTo(122, 51); p.cubicTo(125, 66, 126, 78, 124, 90)           # door, rear edge
    p.moveTo(150, 33.5); p.lineTo(141, 50.5)                          # B-pillar
    p.moveTo(152, 58.5); p.lineTo(168, 58.3)                          # handle
    for i in range(3):                                                # wing vent
        y = 66 + i * 4
        p.moveTo(227 - i, y); p.lineTo(235 - i * 0.5, y - 1)
    p.moveTo(205, 47); p.cubicTo(204, 41, 213, 39.5, 219, 42.5)      # mirror
    p.lineTo(217, 48)
    p.moveTo(300, 85); p.lineTo(323, 86.5)                            # splitter
    p.moveTo(27, 87); p.lineTo(48, 90)                                # diffuser
    return p


def headlight_path() -> QPainterPath:
    p = QPainterPath(QPointF(299, 60))
    p.cubicTo(309, 61, 317, 63, 323, 66.5)
    p.lineTo(320.5, 68.5)
    p.cubicTo(312, 66, 304, 64, 297.5, 63)
    p.closeSubpath()
    return p


def taillight_path() -> QPainterPath:
    p = QPainterPath(QPointF(25.5, 60))
    p.lineTo(41, 57)
    p.lineTo(41, 59.6)
    p.lineTo(24.8, 63)
    p.closeSubpath()
    return p


class CarView(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)
        self.setFixedHeight(int(H - TOP))
        self.setAttribute(Qt.WA_OpaquePaintEvent, False)
        self._body, self._glass, self._details = body_path(), glass_path(), detail_path()
        self._head, self._tail = headlight_path(), taillight_path()
        self._outline = QPainterPath(self._body)
        self._outline.addPath(self._glass)
        self._outline.addPath(self._details)
        self._cache = self._mirror = None
        self._cache_key = None
        self._speed, self._target = SPEEDS.get("OFFLINE"), SPEEDS.get("OFFLINE")
        self._road = 0.0       # distance travelled, drives the dashes and the wheel angle
        self._lights = 0.35    # headlight level, eased like the speed
        self._lights_to = 0.35
        self._last = None
        clock().frame.connect(self._advance)

    def set_status(self, status: str):
        self._target = SPEEDS.get(status, 0.55)
        self._lights_to = 0.35 if status == "OFFLINE" else 1.0

    # ------------------------------------------------------------ animation

    def _advance(self, t: float):
        if not self.isVisible():
            self._last = None
            return
        dt = 0.0 if self._last is None else min(t - self._last, 0.1)
        self._last = t
        ease = 1 - math.exp(-dt * 1.4)             # slow, car-like change of pace
        self._speed += (self._target - self._speed) * ease
        self._lights += (self._lights_to - self._lights) * ease
        self._road += self._speed * CRUISE * dt
        self._t = t
        self.update()

    # ------------------------------------------------------------ geometry

    def _fit(self):
        scale = self.width() / W
        return scale, 0.0, -TOP * scale

    def _build_cache(self, scale):
        """Everything that does not move, rendered once at the screen's pixel density."""
        dpr = self.devicePixelRatioF()
        size = (int(math.ceil(W * scale * dpr)), int(math.ceil(H * scale * dpr)))

        def canvas():
            img = QImage(size[0], size[1], QImage.Format_ARGB32_Premultiplied)
            img.fill(Qt.transparent)
            painter = QPainter(img)
            painter.setRenderHint(QPainter.Antialiasing)
            painter.scale(scale * dpr, scale * dpr)
            return img, painter

        img, p = canvas()
        body_fill = QLinearGradient(0, 28, 0, 92)
        body_fill.setColorAt(0, QColor(255, 255, 255, 22))
        body_fill.setColorAt(0.45, QColor(255, 255, 255, 8))
        body_fill.setColorAt(1, QColor(255, 255, 255, 2))
        p.fillPath(self._body, body_fill)
        glass = QLinearGradient(80, 30, 200, 50)
        glass.setColorAt(0, QColor(200, 204, 206, 36))
        glass.setColorAt(0.55, QColor(200, 204, 206, 10))
        glass.setColorAt(1, QColor(200, 204, 206, 28))
        p.fillPath(self._glass, glass)
        p.strokePath(self._body, pen(QColor(255, 255, 255, 18), 4.5))   # soft glow
        p.strokePath(self._body, pen(QColor(242, 244, 245, 235), 1.25))
        p.strokePath(self._glass, pen(QColor(242, 244, 245, 170), 1.0))
        p.strokePath(self._details, pen(QColor(242, 244, 245, 105), 0.9))
        p.fillPath(self._head, QColor(242, 244, 245, 220))
        p.fillPath(self._tail, QColor(255, 59, 48, 200))
        p.end()
        body = QPixmap.fromImage(img)
        body.setDevicePixelRatio(dpr)

        # a dim mirror image on the floor
        img, p = canvas()
        p.translate(0, 2 * GROUND)
        p.scale(1, -1)
        p.fillPath(self._body, QColor(255, 255, 255, 10))
        p.strokePath(self._body, pen(QColor(242, 244, 245, 120), 1.2))
        for c in WHEELS:
            p.setPen(pen(QColor(242, 244, 245, 110), 1.2))
            p.setBrush(QColor(0, 0, 0))
            p.drawEllipse(c, WHEEL_R, WHEEL_R)
        p.resetTransform()
        p.scale(scale * dpr, scale * dpr)
        p.setCompositionMode(QPainter.CompositionMode_DestinationIn)
        fade = QLinearGradient(0, GROUND, 0, H)
        fade.setColorAt(0, QColor(0, 0, 0, 90))
        fade.setColorAt(1, QColor(0, 0, 0, 0))
        p.fillRect(QRectF(0, 0, W, GROUND), Qt.transparent)
        p.fillRect(QRectF(0, GROUND, W, H - GROUND), fade)
        p.end()
        mirror = QPixmap.fromImage(img)
        mirror.setDevicePixelRatio(dpr)
        return body, mirror

    # ------------------------------------------------------------ drawing

    def paintEvent(self, _):
        t = getattr(self, "_t", 0.0)
        scale, ox, oy = self._fit()
        key = (round(scale, 4), self.devicePixelRatioF())
        if key != self._cache_key:
            self._cache, self._mirror = self._build_cache(scale)
            self._cache_key = key

        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        p.drawPixmap(QPointF(ox, oy), self._mirror)
        p.translate(ox, oy)
        p.scale(scale, scale)

        # floor: a glow under the car and the lane drifting backwards
        floor = QLinearGradient(0, 0, W, 0)
        floor.setColorAt(0, QColor(255, 255, 255, 0))
        floor.setColorAt(0.5, QColor(255, 255, 255, 70))
        floor.setColorAt(1, QColor(255, 255, 255, 0))
        p.setPen(pen(floor, 0.8))
        p.drawLine(QPointF(0, GROUND), QPointF(W, GROUND))
        dash, gap = 16.0, 26.0
        x = -((self._road % (dash + gap)))
        while x < W:
            mid = x + dash / 2
            a = max(0.0, 1 - abs(mid - W / 2) / (W / 2)) ** 1.6
            if a > 0.01:
                p.setPen(pen(QColor(255, 255, 255, int(70 * a)), 1.0))
                p.drawLine(QPointF(max(x, 0), GROUND + 12), QPointF(min(x + dash, W), GROUND + 12))
            x += dash + gap

        # headlight beam and tail glow, under the body
        lights = self._lights * (0.86 + 0.14 * math.sin(t * 2 * math.pi / 4.2))
        p.save()                                   # the beam: a soft flattened oval ahead of the nose
        p.translate(322, 67.5)
        p.scale(1, 0.32)
        beam = QRadialGradient(QPointF(0, 0), 44)
        beam.setColorAt(0, QColor(255, 255, 255, int(70 * lights)))
        beam.setColorAt(0.5, QColor(255, 255, 255, int(22 * lights)))
        beam.setColorAt(1, QColor(255, 255, 255, 0))
        p.setPen(Qt.NoPen)
        p.setBrush(beam)
        p.setClipRect(QRectF(0, -44, 44, 88))
        p.drawEllipse(QPointF(0, 0), 44, 44)
        p.restore()
        for centre, colour, radius, level in ((QPointF(318, 65.5), (255, 255, 255), 13, lights),
                                              (QPointF(31, 60), (255, 59, 48), 15, 0.5 + 0.5 * self._lights)):
            glow = QRadialGradient(centre, radius)
            glow.setColorAt(0, QColor(*colour, int(80 * level)))
            glow.setColorAt(1, QColor(*colour, 0))
            p.setPen(Qt.NoPen)
            p.setBrush(glow)
            p.drawEllipse(centre, radius, radius)

        p.save()
        p.resetTransform()
        p.drawPixmap(QPointF(ox, oy), self._cache)
        p.restore()

        # a slow light running along the lines, from tail to nose
        phase = (t % SWEEP_EVERY) / SWEEP_TAKES
        if phase < 1:
            eased = phase * phase * (3 - 2 * phase)
            sx = -60 + eased * (W + 120)
            sweep = QLinearGradient(sx - 70, 0, sx + 70, 0)
            sweep.setColorAt(0, QColor(255, 255, 255, 0))
            sweep.setColorAt(0.5, QColor(255, 255, 255, 230))
            sweep.setColorAt(1, QColor(255, 255, 255, 0))
            p.strokePath(self._outline, pen(sweep, 1.6))
            soft = QLinearGradient(sx - 90, 0, sx + 90, 0)
            soft.setColorAt(0, QColor(255, 255, 255, 0))
            soft.setColorAt(0.5, QColor(255, 255, 255, 40))
            soft.setColorAt(1, QColor(255, 255, 255, 0))
            p.strokePath(self._body, pen(soft, 6))

        angle = math.degrees(self._road / WHEEL_R)
        for c in WHEELS:
            self._wheel(p, c, angle)
        p.end()

    @staticmethod
    def _wheel(p: QPainter, c: QPointF, angle: float):
        p.setPen(pen(QColor(242, 244, 245, 230), 1.25))
        p.setBrush(QColor(4, 4, 4))
        p.drawEllipse(c, WHEEL_R, WHEEL_R)
        p.setPen(pen(QColor(242, 244, 245, 70), 0.8))
        p.setBrush(Qt.NoBrush)
        p.drawEllipse(c, WHEEL_R - 4.5, WHEEL_R - 4.5)
        p.save()
        p.translate(c)
        p.rotate(angle)
        p.setPen(pen(QColor(242, 244, 245, 175), 1.1))
        for i in range(5):                      # five twin spokes
            p.save()
            p.rotate(i * 72)
            p.drawLine(QPointF(4, -1.6), QPointF(14.5, -2.6))
            p.drawLine(QPointF(4, 1.6), QPointF(14.5, 2.6))
            p.restore()
        p.restore()
        p.setPen(pen(QColor(242, 244, 245, 200), 1.0))
        p.setBrush(QColor(12, 12, 12))
        p.drawEllipse(c, 3.6, 3.6)
