"""The widget, in three sizes: a start button on the desktop, the cockpit (a tall panel), and the Hub.

Press the start button and it grows into the cockpit while the rev counter does its start-up sweep; the
cockpit's ⤢ grows into the Hub (expand.py); ▾ shrinks it back. The look: an AMG instrument cluster in a dark
studio, like a black car shot at night: overhead light, a lit concrete floor, street lights far behind; the
chrome AMG badge (badge.py); a white needle with a red tip; segment bars; the team as a starting grid ordered by
who clocked in first. Every animation runs off one frame clock at the monitor's refresh rate (motion.py).
"""
import getpass
import json
import math
import os
import threading
import time
import urllib.error
import webbrowser
from datetime import datetime
from pathlib import Path

from PySide6.QtCore import QEasingCurve, QEvent, QPoint, QPointF, QRect, QRectF, QSize, Qt, QTimer, QVariantAnimation, Signal
from PySide6.QtGui import (QColor, QConicalGradient, QFont, QFontMetricsF, QIcon, QLinearGradient, QPainter, QPainterPath, QPen,
                           QPixmap, QRadialGradient)
from PySide6.QtWidgets import (QAbstractButton, QGraphicsOpacityEffect, QHBoxLayout, QLabel, QLayout, QMessageBox, QSizePolicy,
                               QVBoxLayout, QWidget)

from .. import hub
from ..api.agent_client import AgentClient
from ..state.store import StateStore
from . import badge
from .motion import clock

TEXT, MUTED, FAINT = "#eceff1", "#8b9096", "#50545a"
SILVER, RED = "#d7dbe0", "#d0564b"        # chrome; the needle tip, the red line and the tail light
ACCENT = SILVER
COLORS = {"WORKING": "#8fc79c", "ONLINE": "#8fc79c", "IDLE": "#c8ccce", "WAITING": "#d8c08a",
          "PAUSED": "#d8c08a", "ERROR": "#d9796b", "OFFLINE": "#5b5f65"}
LABELS = {"WORKING": "A trabalhar", "ONLINE": "Online", "IDLE": "Livre", "WAITING": "À espera",
          "PAUSED": "Em pausa", "ERROR": "Erro", "OFFLINE": "Agente desligado"}
WIDTH = 340            # the cockpit; the window adds SHADOW on every side
SHADOW = 18
RADIUS = 24
ORB = 92               # the start button's face; its window adds ORB_MARGIN for the shadow
ORB_MARGIN = 14
GROW, SHRINK = 0.42, 0.32   # seconds
ASSETS = Path(__file__).resolve().parents[1] / "assets"
LOGO = ASSETS / "logo.png"
UI, MONO = ("Segoe UI Variable Text", "Segoe UI"), ("Cascadia Mono", "Consolas")
DISPLAY = ("Segoe UI Variable Display", "Segoe UI")
WEEKDAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"]
MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"]
# street lights far behind, out of focus: (x, y as share of the width/height, radius, strength, colour)
BOKEH = ((0.12, 0.05, 18, 0.05, "#fff1dc"), (0.27, 0.10, 8, 0.07, "#fff1dc"), (0.47, 0.03, 6, 0.06, "#ffffff"),
         (0.63, 0.08, 12, 0.045, "#fff1dc"), (0.80, 0.04, 24, 0.035, "#ffffff"), (0.90, 0.12, 7, 0.07, "#fff1dc"),
         (0.20, 0.15, 6, 0.08, RED))


def hhmm(iso_time: str) -> str:
    """09:12, in this computer's time, from the Hub's ISO time."""
    return datetime.fromisoformat(iso_time).astimezone().strftime("%H:%M")


def elapsed(started_at) -> str:
    if not started_at:
        return ""
    seconds = int(time.time() - started_at)
    return f"{seconds // 3600}h {seconds % 3600 // 60:02d}m" if seconds >= 3600 else f"{seconds // 60}m {seconds % 60:02d}s"


def ago(epoch: float) -> str:
    m = max(0, int(time.time() - epoch) // 60)
    return "agora" if m < 1 else f"há {m} min" if m < 60 else f"há {m // 60} h" if m < 1440 else f"há {m // 1440} d"


def until(epoch: float | None) -> str:
    if not epoch:
        return ""
    s = max(0, int(epoch - time.time()))
    d, h, m = s // 86400, s % 86400 // 3600, s % 3600 // 60
    return f"renova em {d}d {h}h" if d else f"renova em {h}h {m:02d}m" if h else f"renova em {m} min"


def meter_color(pct):
    return COLORS["ERROR"] if pct >= 85 else COLORS["WAITING"] if pct >= 60 else SILVER


def _reset_of(limit) -> float | None:
    """When a limit resets, if Claude Code said so (epoch seconds or ISO text)."""
    v = (limit or {}).get("resets_at")
    if isinstance(v, (int, float)):
        return float(v)
    try:
        return datetime.fromisoformat(v.replace("Z", "+00:00")).timestamp() if isinstance(v, str) else None
    except ValueError:
        return None


def claude_plan_usage() -> dict | None:
    """The real plan limits, saved by claude_statusline.py every time Claude Code answers, or None."""
    try:
        saved = json.loads((hub.DATA_DIR / "claude_usage.json").read_text(encoding="utf-8"))
        limits = saved["rate_limits"]
        week = limits["seven_day"]["used_percentage"]
    except (OSError, ValueError, KeyError, TypeError):
        return None
    five = limits.get("five_hour") or {}
    return {"week": week, "week_reset": _reset_of(limits.get("seven_day")), "five": five.get("used_percentage"),
            "five_reset": _reset_of(five), "saved_at": saved.get("saved_at", 0)}


def clip(text: str, n: int) -> str:
    return text if len(text) <= n else text[: n - 1] + "…"


def rgba(colour: str, alpha: float) -> QColor:
    c = QColor(colour)
    c.setAlphaF(alpha)
    return c


def pen(colour, width: float) -> QPen:
    p = QPen(colour, width)
    p.setCapStyle(Qt.RoundCap)
    p.setJoinStyle(Qt.RoundJoin)
    return p


def font(size, weight=QFont.Normal, families=UI, spacing=0.0, italic=False) -> QFont:
    f = QFont()
    f.setFamilies(list(families))
    f.setPointSizeF(size)
    f.setWeight(weight)
    f.setItalic(italic)
    f.setStyleStrategy(QFont.PreferAntialias)
    if spacing:
        f.setLetterSpacing(QFont.AbsoluteSpacing, spacing)
    return f


def label(text="", size=9.0, colour=TEXT, weight=QFont.Normal, families=UI, spacing=0.0, wrap=False) -> QLabel:
    w = QLabel(text)
    w.setFont(font(size, weight, families, spacing))
    w.setStyleSheet(f"color: {colour}; background: transparent;")
    w.setWordWrap(wrap)
    return w


def caption(text, colour=MUTED) -> QLabel:
    return label(text, 8, colour, QFont.DemiBold)


def recolour(w: QLabel, colour: str):
    w.setStyleSheet(f"color: {colour}; background: transparent;")


def animate(owner, ms, on_value, start=0.0, end=1.0, curve=QEasingCurve.OutCubic) -> QVariantAnimation:
    a = QVariantAnimation(owner)
    a.setDuration(ms)
    a.setStartValue(float(start))
    a.setEndValue(float(end))
    a.setEasingCurve(curve)
    a.valueChanged.connect(on_value)
    return a


def glow_disc(p: QPainter, centre: QPointF, rx: float, ry: float, colour: str, alpha: float, soft=0.0):
    """A soft light: an ellipse that fades from `alpha` in the middle (or from `soft` of the way out) to nothing."""
    g = QRadialGradient(QPointF(0, 0), 1)
    g.setColorAt(0, rgba(colour, alpha))
    if soft:
        g.setColorAt(soft, rgba(colour, alpha))
    g.setColorAt(1, rgba(colour, 0))
    p.save()
    p.translate(centre)
    p.scale(rx, ry)
    p.setPen(Qt.NoPen)
    p.setBrush(g)
    p.drawEllipse(QPointF(0, 0), 1, 1)
    p.restore()


def studio(p: QPainter, rect: QRectF):
    """The background: a black car's studio at night. Light from above, a lit concrete floor with its horizon,
    street lights out of focus far behind, the corners falling into dark."""
    w, h = rect.width(), rect.height()
    body = QLinearGradient(0, rect.top(), 0, rect.bottom())
    body.setColorAt(0, QColor(14, 14, 16))
    body.setColorAt(0.6, QColor(8, 8, 9))
    body.setColorAt(1, QColor(10, 10, 11))
    p.fillRect(rect, body)
    for x, y, r, a, colour in BOKEH:
        glow_disc(p, QPointF(rect.left() + x * w, rect.top() + y * h), r, r, colour, a, soft=0.55)
    glow_disc(p, QPointF(rect.center().x(), rect.top() - 30), w * 0.85, h * 0.42, "#ffffff", 0.07)
    horizon = rect.bottom() - h * 0.28
    floor = QLinearGradient(0, horizon, 0, rect.bottom())
    floor.setColorAt(0, QColor(255, 255, 255, 0))
    floor.setColorAt(1, QColor(255, 255, 255, 16))
    p.fillRect(QRectF(rect.left(), horizon, w, rect.bottom() - horizon), floor)
    glow_disc(p, QPointF(rect.center().x(), rect.bottom() + 10), w * 0.75, h * 0.22, "#ffffff", 0.08)
    line = QLinearGradient(rect.left(), 0, rect.right(), 0)
    line.setColorAt(0, QColor(255, 255, 255, 0))
    line.setColorAt(0.5, QColor(255, 255, 255, 22))
    line.setColorAt(1, QColor(255, 255, 255, 0))
    p.setPen(QPen(line, 1))
    p.drawLine(QPointF(rect.left(), horizon), QPointF(rect.right(), horizon))
    vignette = QRadialGradient(rect.center(), max(w, h) * 0.75)
    vignette.setColorAt(0.55, QColor(0, 0, 0, 0))
    vignette.setColorAt(1, QColor(0, 0, 0, 120))
    p.fillRect(rect, vignette)


def ease(k: float) -> float:
    return 1 - (1 - k) ** 3


# ------------------------------------------------------------------ building blocks


class Glide:
    """A number that slides to its new value, for bars and arcs."""

    def __init__(self, owner: QWidget, ms=900):
        self.value = 0.0
        self._anim = animate(owner, ms, self._step)
        self._owner = owner

    def _step(self, v):
        self.value = v
        self._owner.update()

    def to(self, target: float):
        if abs(target - self.value) > 0.001:
            self._anim.stop()
            self._anim.setStartValue(self.value)
            self._anim.setEndValue(float(target))
            self._anim.start()


class Card(QWidget):
    """A quiet tile for what only shows up sometimes: an alert, a task, unsaved work."""

    def __init__(self, tint: str | None = None):
        super().__init__()
        self.tint = tint
        self.box = QVBoxLayout(self)
        self.box.setContentsMargins(14, 11, 14, 12)
        self.box.setSpacing(6)

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        r = QRectF(self.rect()).adjusted(0.5, 0.5, -0.5, -0.5)
        p.setBrush(rgba(self.tint, 0.08) if self.tint else QColor(255, 255, 255, 8))
        p.setPen(QPen(rgba(self.tint, 0.26) if self.tint else QColor(255, 255, 255, 16), 1))
        p.drawRoundedRect(r, 12, 12)


class Platter(QWidget):
    """An iOS-style module: a rounded dark platter, a title (and a note on the right) inside it, then its content."""

    def __init__(self, title: str = "", note: str = ""):
        super().__init__()
        self.box = QVBoxLayout(self)
        self.box.setContentsMargins(14, 12, 14, 12)
        self.box.setSpacing(8)
        self.note = None
        if title:
            head = QHBoxLayout()
            head.addWidget(label(title, 10, TEXT, QFont.DemiBold, DISPLAY))
            head.addStretch(1)
            self.note = label(note, 8.5, MUTED)
            head.addWidget(self.note)
            self.box.addLayout(head)

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        p.setPen(QPen(QColor(255, 255, 255, 12), 1))
        p.setBrush(QColor(28, 28, 30, 190))
        p.drawRoundedRect(QRectF(self.rect()).adjusted(0.5, 0.5, -0.5, -0.5), 18, 18)


class Meter(QWidget):
    """A hairline progress bar that glides to its new value."""

    def __init__(self, height=3):
        super().__init__()
        self.setFixedHeight(height)
        self._colour = QColor(SILVER)
        self._glide = Glide(self, 800)

    def set(self, pct, colour=SILVER):
        self._colour = QColor(colour)
        self._glide.to(max(0, min(100, pct or 0)) / 100)
        self.update()

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        p.setPen(Qt.NoPen)
        h = self.height()
        p.setBrush(QColor(255, 255, 255, 16))
        p.drawRoundedRect(QRectF(0, 0, self.width(), h), h / 2, h / 2)
        if self._glide.value > 0:
            p.setBrush(self._colour)
            p.drawRoundedRect(QRectF(0, 0, max(h, self.width() * self._glide.value), h), h / 2, h / 2)


class Hover(QAbstractButton):
    """A button whose hover and press states fade instead of snapping."""

    def __init__(self):
        super().__init__()
        self.setCursor(Qt.PointingHandCursor)
        self.hover = self.press = 0.0
        self._hover = animate(self, 180, lambda v: self._set("hover", v))
        self._press = animate(self, 110, lambda v: self._set("press", v))
        self.pressed.connect(lambda: self._to(self._press, self.press, 1))
        self.released.connect(lambda: self._to(self._press, self.press, 0))

    def _set(self, name, value):
        setattr(self, name, value)
        self.update()

    @staticmethod
    def _to(anim, current, end):
        anim.stop()
        anim.setStartValue(current)
        anim.setEndValue(float(end))
        anim.start()

    def enterEvent(self, e):
        self._to(self._hover, self.hover, 1)
        super().enterEvent(e)

    def leaveEvent(self, e):
        self._to(self._hover, self.hover, 0)
        super().leaveEvent(e)


class IconButton(Hover):
    """A bare glyph that gets a soft round backing on hover: 'shrink', 'hub' or 'hide'."""

    def __init__(self, glyph, tip):
        super().__init__()
        self.glyph = glyph
        self.setFixedSize(28, 28)
        self.setToolTip(tip)

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        p.setPen(Qt.NoPen)
        p.setBrush(QColor(255, 255, 255, int(14 * self.hover + 10 * self.press)))
        p.drawEllipse(QRectF(1, 1, 26, 26))
        v = int(150 + 90 * self.hover)
        p.setPen(pen(QColor(v, v + 3, v + 6), 1.5))
        p.setBrush(Qt.NoBrush)
        if self.glyph == "hide":
            p.drawLine(QPointF(10, 10), QPointF(18, 18))
            p.drawLine(QPointF(18, 10), QPointF(10, 18))
        elif self.glyph == "shrink":
            path = QPainterPath(QPointF(9.5, 12))
            path.lineTo(14, 16.5)
            path.lineTo(18.5, 12)
            p.drawPath(path)
        else:
            path = QPainterPath(QPointF(15.5, 9.5))
            path.lineTo(18.5, 9.5)
            path.lineTo(18.5, 12.5)
            path.moveTo(12.5, 18.5)
            path.lineTo(9.5, 18.5)
            path.lineTo(9.5, 15.5)
            path.moveTo(18.5, 9.5)
            path.lineTo(15, 13)
            path.moveTo(9.5, 18.5)
            path.lineTo(13, 15)
            p.drawPath(path)


class Badge(QWidget):
    """The chrome AMG badge as a widget."""

    def __init__(self, height: float):
        super().__init__()
        self._h = height
        self.setFixedSize(int(math.ceil(badge.width(height))) + 2, int(math.ceil(height)) + 2)

    def paintEvent(self, _):
        p = QPainter(self)
        badge.paint(p, 1, 1, self._h)


class Tacho(QWidget):
    """The rev counter: 0 to 10 over three quarters of a circle, a red line from 8.5, and a needle that moves like
    one (a spring, a little overshoot, a breath of idle). It reads the Claude week; the time sits in the middle."""
    W, H = 268, 232
    START, SPAN = 225.0, 270.0   # degrees, clockwise from the left-bottom to the right-bottom

    def __init__(self):
        super().__init__()
        self.setFixedSize(self.W, self.H)
        self._target, self._pos, self._vel = 0.0, 0.0, 0.0
        self._sweep_until, self._last = 0.0, None
        self._status, self._status_colour, self._pulse = "Tudo bem", QColor(COLORS["ONLINE"]), False
        self._value_text = "—"
        self._scale, self._scale_key = None, None
        self._f_time, self._f_small, self._f_num = font(28, QFont.DemiBold, DISPLAY), font(8.5, QFont.Normal, UI), font(8, QFont.DemiBold, DISPLAY)
        self._f_state = font(8.5, QFont.DemiBold, UI)
        clock().frame.connect(self._frame)

    @property
    def centre(self) -> QPointF:
        return QPointF(self.W / 2, 128)

    def set_load(self, pct):
        self._target = max(0, min(100, pct or 0)) / 100
        self._value_text = "—" if pct is None else f"{round(pct)}%"

    def set_status(self, text, colour, pulse=False):
        self._status, self._status_colour, self._pulse = text, QColor(colour), pulse
        self.update()

    def sweep(self):
        """Start-up: the needle runs to the end of the scale and back, like a cluster waking up."""
        self._sweep_until = time.perf_counter() + 0.55

    def _frame(self, _):
        now = time.perf_counter()
        dt = 0.0 if self._last is None else min(now - self._last, 0.05)
        self._last = now
        if not self.isVisible():
            self._last = None
            return
        target = 1.0 if now < self._sweep_until else self._target
        k = 70.0                                      # stiffness; damping a bit under critical, so it overshoots a touch
        self._vel += (k * (target - self._pos) - 2 * math.sqrt(k) * 0.72 * self._vel) * dt
        self._pos += self._vel * dt
        self.update()

    def _angle(self, v: float) -> float:
        return math.radians(self.START - self.SPAN * v)

    def _point(self, v: float, r: float) -> QPointF:
        a, c = self._angle(v), self.centre
        return QPointF(c.x() + r * math.cos(a), c.y() - r * math.sin(a))

    def _build_scale(self) -> QPixmap:
        dpr = self.devicePixelRatioF()
        pix = QPixmap(int(self.W * dpr), int(self.H * dpr))
        pix.setDevicePixelRatio(dpr)
        pix.fill(Qt.transparent)
        p = QPainter(pix)
        p.setRenderHint(QPainter.Antialiasing)
        c, r = self.centre, 112
        box = QRectF(c.x() - r + 6, c.y() - r + 6, 2 * (r - 6), 2 * (r - 6))
        p.setPen(pen(rgba(RED, 0.3), 5))                 # the red line, as a soft band under the last ticks
        p.drawArc(box, int((self.START - self.SPAN * 0.85) * 16), int(-self.SPAN * 0.15 * 16))
        for i in range(51):
            v = i / 50
            major = i % 5 == 0
            red = v >= 0.85
            colour = rgba(RED, 0.95) if red else QColor(236, 239, 241, 230 if major else 90)
            p.setPen(pen(colour, 2.0 if major else 1.0))
            p.drawLine(self._point(v, r - (13 if major else 6)), self._point(v, r))
            if major:
                p.setPen(QColor(RED) if red else QColor(MUTED))
                p.setFont(self._f_num)
                at = self._point(v, r - 26)
                p.drawText(QRectF(at.x() - 12, at.y() - 9, 24, 18), Qt.AlignCenter, str(i // 5))
        p.setPen(QColor(FAINT))
        p.setFont(font(7, QFont.Normal, UI))
        p.drawText(QRectF(c.x() - 60, c.y() + 76, 120, 14), Qt.AlignCenter, "Claude · semana")
        p.end()
        return pix

    def paintEvent(self, _):
        if self._scale_key != self.devicePixelRatioF():
            self._scale, self._scale_key = self._build_scale(), self.devicePixelRatioF()
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        p.drawPixmap(0, 0, self._scale)
        c = self.centre
        now = datetime.now()

        # time, date, state: the digital part of the cluster
        p.setPen(QColor(TEXT))
        p.setFont(self._f_time)
        p.drawText(QRectF(0, c.y() - 40, self.W, 40), Qt.AlignCenter, now.strftime("%H:%M"))
        p.setPen(QColor(MUTED))
        p.setFont(self._f_small)
        p.drawText(QRectF(0, c.y() - 2, self.W, 18), Qt.AlignCenter, f"{WEEKDAYS[now.weekday()]}, {now.day} {MONTHS[now.month - 1]}")
        f = self._f_state
        w = QFontMetricsF(f).horizontalAdvance(self._status) + 30
        chip = QRectF(c.x() - w / 2, c.y() + 24, w, 22)
        p.setPen(Qt.NoPen)
        p.setBrush(rgba(self._status_colour.name(), 0.12))
        p.drawRoundedRect(chip, 11, 11)
        glow = 0.5 + 0.5 * math.sin(time.time() * 2 * math.pi / 2.2) if self._pulse else 1.0
        p.setBrush(rgba(self._status_colour.name(), 0.4 + 0.6 * glow))
        p.drawEllipse(QPointF(chip.left() + 12, chip.center().y()), 3, 3)
        p.setPen(self._status_colour.lighter(115))
        p.setFont(f)
        p.drawText(chip.adjusted(20, 0, -8, 0), Qt.AlignVCenter | Qt.AlignLeft, self._status)
        p.setPen(QColor(TEXT))
        p.setFont(self._f_num)
        p.drawText(QRectF(c.x() - 40, c.y() + 88, 80, 16), Qt.AlignCenter, self._value_text)

        # the needle lives on the outer ring only, so the digital middle stays clear: white, red tip, a shadow,
        # a faint idle tremor
        v = max(-0.01, min(1.02, self._pos + 0.0016 * math.sin(time.time() * 41) * (1 if self._pos > 0.01 else 0)))
        base, mid, tip = self._point(v, 64), self._point(v, 86), self._point(v, 106)
        p.setPen(pen(QColor(0, 0, 0, 130), 6))
        p.drawLine(base + QPointF(1, 2), tip + QPointF(1, 2))
        p.setPen(pen(QColor("#f5f6f7"), 3))
        p.drawLine(base, mid)
        p.setPen(pen(QColor(RED), 3))
        p.drawLine(mid, tip)


class Segments(QWidget):
    """A segment bar like a fuel or boost gauge: the name, a value, a note, and lit blocks."""
    COUNT = 24

    def __init__(self, title):
        super().__init__()
        self.setFixedHeight(40)
        self._title, self._pct, self._value, self._note = title, None, "—", ""
        self._glide = Glide(self, 900)
        self._f_title, self._f_value, self._f_note = font(9, QFont.DemiBold, UI), font(10.5, QFont.DemiBold, DISPLAY), font(8, QFont.Normal, UI)

    def set(self, pct, value: str, note=""):
        self._pct, self._value, self._note = pct, value, note
        self._glide.to(max(0, min(100, pct or 0)) / 100)
        self.update()

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        w = self.width()
        p.setPen(QColor(TEXT))
        p.setFont(self._f_title)
        p.drawText(QRectF(0, 0, w, 18), Qt.AlignLeft | Qt.AlignVCenter, self._title)
        p.setFont(self._f_value)
        p.drawText(QRectF(0, 0, w, 18), Qt.AlignRight | Qt.AlignVCenter, self._value)
        vw = QFontMetricsF(self._f_value).horizontalAdvance(self._value)
        p.setPen(QColor(FAINT))
        p.setFont(self._f_note)
        p.drawText(QRectF(0, 0, w - vw - 10, 18), Qt.AlignRight | Qt.AlignVCenter, self._note)
        gap = 3.0
        seg = (w - gap * (self.COUNT - 1)) / self.COUNT
        lit = self._glide.value * self.COUNT
        p.setPen(Qt.NoPen)
        for i in range(self.COUNT):
            x = i * (seg + gap)
            on = max(0.0, min(1.0, lit - i))
            hot = (i + 1) / self.COUNT > 0.85
            p.setBrush(QColor(255, 255, 255, 14))
            p.drawRoundedRect(QRectF(x, 25, seg, 9), 2, 2)
            if on > 0:
                p.setBrush(rgba(RED if hot else SILVER, 0.25 + 0.75 * on))
                p.drawRoundedRect(QRectF(x, 25, seg, 9), 2, 2)


class GridRow(Hover):
    """One teammate on the starting grid: position (by who clocked in first), a three-letter tag, the name,
    an online light, and the clock-in time. Your own row clocks you in when you tap it."""

    def __init__(self):
        super().__init__()
        self.setFixedHeight(42)
        self._pos, self._person, self._me = None, None, False
        self._f_pos, self._f_tag, self._f_name, self._f_time = (font(8.5, QFont.Bold, DISPLAY), font(10.5, QFont.Black, DISPLAY, italic=True),
                                                                font(8.5, QFont.Normal, UI), font(10, QFont.DemiBold, DISPLAY))
        self._f_pill = font(8, QFont.DemiBold, UI)
        self.setEnabled(False)

    last = False

    def set(self, position: int | None, person: dict, me: bool):
        self._pos, self._person, self._me = position, person, me
        can = me and not person.get("ponto") and person.get("user") is not None
        self.setEnabled(can)
        self.setCursor(Qt.PointingHandCursor if can else Qt.ArrowCursor)
        self.setToolTip("Bater o ponto" if can else "")
        self.update()

    def paintEvent(self, _):
        if not self._person:
            return
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        r = QRectF(self.rect()).adjusted(0, 2, 0, -2)
        person, online = self._person, self._person.get("online")
        if not self.last:
            p.setPen(QPen(QColor(255, 255, 255, 18), 1))
            p.drawLine(QPointF(42, self.height() - 0.5), QPointF(self.width(), self.height() - 0.5))
        if self._me and self.hover:
            p.setPen(Qt.NoPen)
            p.setBrush(QColor(255, 255, 255, int(12 * self.hover)))
            p.drawRoundedRect(r, 10, 10)
        box = QRectF(r.left(), r.center().y() - 11, 26, 22)
        p.setPen(Qt.NoPen)
        p.setBrush(QColor(SILVER) if self._pos else QColor(255, 255, 255, 18))
        p.drawRoundedRect(box, 6, 6)
        p.setPen(QColor("#111214") if self._pos else QColor(FAINT))
        p.setFont(self._f_pos)
        p.drawText(box, Qt.AlignCenter, f"P{self._pos}" if self._pos else "–")
        p.setPen(QColor(TEXT) if online else QColor(MUTED))
        p.setFont(self._f_tag)
        p.drawText(QRectF(r.left() + 36, r.top(), 40, r.height()), Qt.AlignVCenter | Qt.AlignLeft, person["name"][:3].upper())
        p.setPen(QColor(MUTED) if online else QColor(FAINT))
        p.setFont(self._f_name)
        state = {"WORKING": "a trabalhar", "WAITING": "à espera", "PAUSED": "em pausa", "ERROR": "erro"}.get(person.get("status"), "online") \
            if online else "offline"
        p.drawText(QRectF(r.left() + 78, r.top(), 120, r.height()), Qt.AlignVCenter | Qt.AlignLeft, f"{person['name']} · {state}")
        light = QPointF(r.right() - 62, r.center().y())
        if online:
            glow_disc(p, light, 8, 8, COLORS["ONLINE"], 0.45)
        p.setPen(Qt.NoPen)
        p.setBrush(QColor(COLORS["ONLINE"] if online else COLORS["OFFLINE"]))
        p.drawEllipse(light, 3.4, 3.4)
        right = QRectF(r.right() - 50, r.top(), 50, r.height())
        if person.get("ponto"):
            p.setPen(QColor(TEXT))
            p.setFont(self._f_time)
            p.drawText(right, Qt.AlignVCenter | Qt.AlignRight, hhmm(person["ponto"]))
        elif self.isEnabled():
            pill = QRectF(r.right() - 52, r.center().y() - 11, 52, 22)
            p.setBrush(QColor(SILVER).lighter(int(100 + 8 * self.hover)))
            p.drawRoundedRect(pill, 11, 11)
            p.setPen(QColor("#111214"))
            p.setFont(self._f_pill)
            p.drawText(pill, Qt.AlignCenter, "Ponto")
        else:
            p.setPen(QColor(FAINT))
            p.setFont(self._f_time)
            p.drawText(right, Qt.AlignVCenter | Qt.AlignRight, "--:--")


class Divider(QWidget):
    """A hairline that fades out at both ends."""

    def __init__(self):
        super().__init__()
        self.setFixedHeight(9)

    def paintEvent(self, _):
        p = QPainter(self)
        line = QLinearGradient(0, 0, self.width(), 0)
        line.setColorAt(0, QColor(255, 255, 255, 0))
        line.setColorAt(0.5, QColor(255, 255, 255, 26))
        line.setColorAt(1, QColor(255, 255, 255, 0))
        p.setPen(QPen(line, 1))
        p.drawLine(QPointF(0, 4.5), QPointF(self.width(), 4.5))


class TitleBar(QWidget):
    """Drag the cockpit by its top; double-click opens the Hub (what maximizing did before)."""

    def __init__(self, on_double_click):
        super().__init__()
        self._on_double_click = on_double_click

    def mousePressEvent(self, e):
        if e.button() == Qt.LeftButton and self.window().windowHandle():
            self.window().windowHandle().startSystemMove()

    def mouseDoubleClickEvent(self, e):
        if e.button() == Qt.LeftButton:
            self._on_double_click()


class Orb(QWidget):
    """The widget at its smallest: an engine start button in gloss black, a chrome ring, the AMG badge, the time,
    and a light ring that holds the Claude load and breathes in the colour of how things are.
    Click to start; drag to move."""
    SIZE = ORB + 2 * ORB_MARGIN

    def __init__(self, on_click):
        super().__init__()
        self.setFixedSize(self.SIZE, self.SIZE)
        self.setCursor(Qt.PointingHandCursor)
        self.setToolTip("Abrir o cockpit")
        self._on_click = on_click
        self.fade = 1.0
        self._hover, self._down = 0.0, 0.0
        self._hover_anim = animate(self, 200, lambda v: self._set("_hover", v))
        self._down_anim = animate(self, 110, lambda v: self._set("_down", v))
        self._press_at, self._grab, self._dragged = None, None, False
        self._status_colour, self._pulse = QColor(COLORS["ONLINE"]), False
        self._load = Glide(self, 1200)
        self._face, self._face_key = None, None
        self._f_time = font(15, QFont.DemiBold, DISPLAY)
        clock().frame.connect(self._frame)

    def _set(self, name, v):
        setattr(self, name, v)
        self.update()

    def _to(self, anim, current, end):
        anim.stop()
        anim.setStartValue(current)
        anim.setEndValue(float(end))
        anim.start()

    def set(self, load, colour, pulse):
        self._load.to(max(0, min(100, load or 0)) / 100)
        self._status_colour, self._pulse = QColor(colour), pulse

    def _frame(self, _):
        if self.isVisible():
            self.update()

    def enterEvent(self, e):
        self._to(self._hover_anim, self._hover, 1)

    def leaveEvent(self, e):
        self._to(self._hover_anim, self._hover, 0)

    def mousePressEvent(self, e):
        if e.button() == Qt.LeftButton:
            self._press_at = e.globalPosition().toPoint()
            self._grab = self._press_at - self.window().pos()
            self._dragged = False
            self._to(self._down_anim, self._down, 1)

    def mouseMoveEvent(self, e):
        if self._press_at is None:
            return
        at = e.globalPosition().toPoint()
        if not self._dragged and (at - self._press_at).manhattanLength() > 4:
            self._dragged = True
            self._to(self._down_anim, self._down, 0)
        if self._dragged:
            self.window().move(at - self._grab)

    def mouseReleaseEvent(self, e):
        self._to(self._down_anim, self._down, 0)
        if self._press_at is not None and not self._dragged and e.button() == Qt.LeftButton:
            self._on_click()
        self._press_at = None

    def _build_face(self) -> QPixmap:
        dpr = self.devicePixelRatioF()
        pix = QPixmap(int(self.SIZE * dpr), int(self.SIZE * dpr))
        pix.setDevicePixelRatio(dpr)
        pix.fill(Qt.transparent)
        p = QPainter(pix)
        p.setRenderHint(QPainter.Antialiasing)
        c, r = QPointF(self.SIZE / 2, self.SIZE / 2), ORB / 2
        glow_disc(p, QPointF(c.x(), c.y() + 4), r + ORB_MARGIN, r + ORB_MARGIN, "#000000", 0.55, soft=0.76)
        ring = QConicalGradient(c, 120)                 # chrome: light and dark sectors, never moving
        for at, colour in ((0, "#f2f4f6"), (0.12, "#7d838a"), (0.3, "#d9dde1"), (0.5, "#5d6268"), (0.68, "#e9ecef"),
                           (0.86, "#6f757b"), (1, "#f2f4f6")):
            ring.setColorAt(at, QColor(colour))
        p.setPen(Qt.NoPen)
        p.setBrush(ring)
        p.drawEllipse(c, r, r)
        face = QRadialGradient(QPointF(c.x() - 8, c.y() - 14), r * 1.2)   # gloss black paint
        face.setColorAt(0, QColor(30, 31, 34))
        face.setColorAt(1, QColor(5, 5, 6))
        p.setBrush(face)
        p.drawEllipse(c, r - 5, r - 5)
        clip = QPainterPath()
        clip.addEllipse(c, r - 5, r - 5)
        p.setClipPath(clip)
        sheen = QLinearGradient(c.x(), c.y() - r, c.x(), c.y())        # the studio light reflected on the paint
        sheen.setColorAt(0, QColor(255, 255, 255, 34))
        sheen.setColorAt(0.55, QColor(255, 255, 255, 6))
        sheen.setColorAt(1, QColor(255, 255, 255, 0))
        p.setBrush(sheen)
        p.drawEllipse(QPointF(c.x(), c.y() - r * 0.55), r * 0.9, r * 0.55)
        p.setClipping(False)
        p.setPen(QPen(QColor(0, 0, 0, 170), 1.2))
        p.setBrush(Qt.NoBrush)
        p.drawEllipse(c, r - 5, r - 5)
        bh = 8.0
        badge.paint(p, c.x() - badge.width(bh) / 2, c.y() - 27, bh)
        p.end()
        return pix

    def paintEvent(self, _):
        if self._face_key != self.devicePixelRatioF():
            self._face, self._face_key = self._build_face(), self.devicePixelRatioF()
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        p.setOpacity(self.fade)
        c, r = QPointF(self.SIZE / 2, self.SIZE / 2), ORB / 2
        s = 1 + 0.03 * self._hover - 0.04 * self._down     # it gives a little under the finger, like a real button
        p.translate(c)
        p.scale(s, s)
        p.translate(-c)
        p.drawPixmap(0, 0, self._face)
        t = time.time()
        breath = 0.55 + 0.45 * math.sin(t * 2 * math.pi / (2.2 if self._pulse else 5.0))
        box = QRectF(c.x() - r + 10, c.y() - r + 10, 2 * r - 20, 2 * r - 20)
        p.setPen(pen(rgba(self._status_colour.name(), 0.10 + 0.14 * breath), 2))
        p.setBrush(Qt.NoBrush)
        p.drawEllipse(box)
        k = self._load.value
        if k > 0.002:
            p.setPen(pen(rgba(SILVER, 0.22), 6))
            p.drawArc(box, 90 * 16, -int(360 * 16 * k))
            p.setPen(pen(QColor("#ffffff"), 2))
            p.drawArc(box, 90 * 16, -int(360 * 16 * k))
        now = datetime.now()
        p.setPen(QColor(TEXT))
        p.setFont(self._f_time)
        p.drawText(QRectF(0, c.y() - 13, self.SIZE, 26), Qt.AlignCenter, now.strftime("%H:%M"))
        p.setPen(Qt.NoPen)
        p.setBrush(rgba(self._status_colour.name(), 0.2 * breath))
        p.drawEllipse(QPointF(c.x(), c.y() + 20), 6, 6)
        p.setBrush(self._status_colour)
        p.drawEllipse(QPointF(c.x(), c.y() + 20), 2.6, 2.6)


class Panel(QWidget):
    """The cockpit's content; tells the window when its size changes."""
    resized = Signal()

    def resizeEvent(self, e):
        super().resizeEvent(e)
        self.resized.emit()


# ------------------------------------------------------------------ the window


class WidgetWindow(QWidget):
    hub_ready = Signal(object)  # (error, url) from the thread that wakes the Hub
    punched = Signal(object)    # the clock-in the Hub confirmed, or the error text

    def __init__(self, store: StateStore, client: AgentClient):
        super().__init__(None, Qt.Window | Qt.FramelessWindowHint)
        self.store, self.client = store, client
        self.hub_ready.connect(self._hub_opened)
        self.punched.connect(self._punched)
        self.on_status = lambda status: None  # tray hook
        self.notify = lambda title, text: None  # tray hook: a Windows notification
        self._ponto_seen = None  # user -> when they clocked in today, as last seen (None until the first look)
        self._version = -1
        self._opening_hub = False
        self._expander = None
        self._week, self._week_seen = None, None  # what is being touched right now, from the Hub on this computer
        self._team, self._team_seen = [], False   # who is online, from the Hub on this computer (None = Hub not answering)
        self._last_team = []
        self._backdrop = None
        self._usage_at = 0.0
        self._load = None
        self.mode = "orb"            # orb | panel | morph
        self._morph_dir, self._morph_t0, self._k = 0, 0.0, 0.0
        self._orb_face = QPoint()    # where the button's face sits inside the window during a morph

        self.setWindowTitle("Agente AMG")
        self.setWindowIcon(QIcon(str(LOGO)))
        self.setAttribute(Qt.WA_TranslucentBackground)

        self.orb = Orb(self.expand)
        self.orb.setParent(self)
        self.panel = Panel(self)
        self.panel.setFixedWidth(WIDTH)
        self.panel.move(SHADOW, SHADOW)
        self.panel.resized.connect(self._panel_resized)
        col = QVBoxLayout(self.panel)
        col.setSizeConstraint(QLayout.SetFixedSize)
        col.setContentsMargins(14, 16, 14, 14)
        col.setSpacing(10)
        self._build(col)
        for i in range(col.count()):  # every module spans the cockpit; the fixed-size layout would shrink them to fit
            w = col.itemAt(i).widget()
            if w is not None:
                w.setFixedWidth(WIDTH - 28)
        self.panel.hide()

        clock().frame.connect(self._morph_frame)
        self._fade = animate(self, 220, self.setWindowOpacity)
        self._fade.finished.connect(self._fade_done)
        self._place()
        self._render_people(self._team)
        self._render_week({})
        threading.Thread(target=self._poll_hub, daemon=True).start()
        self._ticker = QTimer(self)
        self._ticker.timeout.connect(self._tick)
        self._ticker.start(500)
        self._tick()

    def _build(self, col: QVBoxLayout):
        bar = TitleBar(self._open_hub)
        row = QHBoxLayout(bar)
        row.setContentsMargins(0, 0, 0, 0)
        row.setSpacing(2)
        names = QVBoxLayout()
        names.setSpacing(5)
        names.setContentsMargins(0, 4, 0, 0)
        names.addWidget(Badge(16))
        self.user_label = label("Agente · central de comando", 8.5, MUTED)
        names.addWidget(self.user_label)
        row.addLayout(names)
        row.addStretch(1)
        for glyph, tip, action in (("shrink", "Encolher para o botão", self.collapse), ("hub", "Abrir o Hub em grande", self._open_hub),
                                   ("hide", "Esconder (o agente continua)", self.hide_panel)):
            b = IconButton(glyph, tip)
            b.clicked.connect(action)
            row.addWidget(b, 0, Qt.AlignTop)
        col.addWidget(bar)

        col.addSpacing(4)
        dial = Platter()
        dial.box.setContentsMargins(4, 6, 4, 2)
        self.tacho = Tacho()
        dial.box.addWidget(self.tacho, 0, Qt.AlignHCenter)
        col.addWidget(dial)

        use = Platter("Consumo")
        self.claude_session = Segments("Claude · sessão de 5 h")
        use.box.addWidget(self.claude_session)
        self.higgs = Segments("Higgsfield · créditos")
        use.box.addWidget(self.higgs)
        col.addWidget(use)

        grid = Platter("Grelha de hoje")
        grid.box.setSpacing(0)
        self.grid_note = grid.note
        self.rows = [GridRow() for _ in range(3)]
        for r in self.rows:
            r.clicked.connect(self.punch_ponto)
            grid.box.addWidget(r)
        self.rows[-1].last = True
        self.hub_note = label("O Hub não está a responder.", 8.5, FAINT)
        self.hub_note.hide()
        grid.box.addWidget(self.hub_note)
        col.addWidget(grid)

        # only when there is something to say
        self.alert = Card(COLORS["WAITING"])
        self.alert_text = label("", 9, COLORS["WAITING"], wrap=True)
        self.alert.box.addWidget(self.alert_text)
        self.alert.hide()
        col.addWidget(self.alert)

        self.task_card = Card()
        head = QHBoxLayout()
        head.addWidget(caption("Tarefa"))
        head.addStretch(1)
        self.progress_text = label("", 9, TEXT, QFont.DemiBold, DISPLAY)
        head.addWidget(self.progress_text)
        self.task_card.box.addLayout(head)
        self.task = label("", 10.5, TEXT, QFont.DemiBold, wrap=True)
        self.task_card.box.addWidget(self.task)
        self.bar = Meter()
        self.task_card.box.addWidget(self.bar)
        self.details = label("", 8.5, MUTED, wrap=True)
        self.task_card.box.addWidget(self.details)
        self.task_card.hide()
        col.addWidget(self.task_card)

        self.ledger = Card()
        self.ledger.box.addWidget(caption("A mexer agora, sem commit"))
        self.pending = QVBoxLayout()
        self.pending.setSpacing(5)
        self.ledger.box.addLayout(self.pending)
        self.ledger.hide()
        col.addWidget(self.ledger)

    # ------------------------------------------------------------ size and place

    def _place(self):
        """Starts as the start button, near the top-right corner of the screen."""
        screen = self.screen().availableGeometry()
        self.setFixedSize(Orb.SIZE, Orb.SIZE)
        self.orb.move(0, 0)
        self.move(screen.right() - Orb.SIZE - 40, screen.top() + 60)

    def _panel_size(self) -> QSize:
        self.panel.adjustSize()
        return QSize(WIDTH + 2 * SHADOW, self.panel.height() + 2 * SHADOW)

    def _panel_resized(self):
        if self.mode == "panel":
            self._backdrop = None
            self.setFixedSize(self._panel_size())

    @staticmethod
    def _clear(layout):
        while layout.count():
            item = layout.takeAt(0)
            if item.widget():
                item.widget().deleteLater()
            elif item.layout():
                WidgetWindow._clear(item.layout())

    # ------------------------------------------------------------ button <-> cockpit

    def expand(self):
        """The button opens into the cockpit, its top-right corner staying where the button was."""
        if self.mode != "orb":
            return
        size = self._panel_size()
        face = QRect(self.pos() + QPoint(ORB_MARGIN, ORB_MARGIN), QSize(ORB, ORB))
        x, y = face.right() + 1 - WIDTH - SHADOW, face.top() - SHADOW
        screen = self.screen().availableGeometry()
        x = max(screen.left() - SHADOW, min(x, screen.right() + 1 + SHADOW - size.width()))
        y = max(screen.top() - SHADOW, min(y, screen.bottom() + 1 + SHADOW - size.height()))
        self._orb_face = face.topLeft() - QPoint(x, y)
        self.setFixedSize(size)
        self.move(x, y)
        self.orb.move(self._orb_face - QPoint(ORB_MARGIN, ORB_MARGIN))
        self._start_morph(+1)

    def collapse(self):
        """The cockpit shrinks back into the button at its top-right corner."""
        if self.mode != "panel":
            return
        self._orb_face = QPoint(SHADOW + WIDTH - ORB, SHADOW)
        self.orb.move(self._orb_face - QPoint(ORB_MARGIN, ORB_MARGIN))
        self.panel.hide()
        self.orb.fade = 0.0
        self.orb.show()
        self._start_morph(-1)

    def _start_morph(self, direction):
        self.mode = "morph"
        self._morph_dir, self._morph_t0 = direction, time.perf_counter()
        self._k = 0.0 if direction > 0 else 1.0
        self.update()

    def _morph_frame(self, _):
        if self.mode != "morph":
            return
        p = min(1.0, (time.perf_counter() - self._morph_t0) / (GROW if self._morph_dir > 0 else SHRINK))
        self._k = ease(p) if self._morph_dir > 0 else 1 - ease(p)
        self.orb.fade = max(0.0, 1 - self._k * 3)
        self.orb.update()
        self.update()
        if p >= 1:
            self._morph_done()

    def _morph_done(self):
        if self._morph_dir > 0:
            self.mode = "panel"
            self.orb.hide()
            self._backdrop = None
            effect = QGraphicsOpacityEffect(self.panel)
            effect.setOpacity(0)
            self.panel.setGraphicsEffect(effect)
            self.panel.show()
            self.tacho.sweep()
            reveal = animate(self, 180, effect.setOpacity)
            reveal.finished.connect(lambda: self.panel.setGraphicsEffect(None))  # no offscreen pass once it is in place
            reveal.start(QVariantAnimation.DeleteWhenStopped)
        else:
            self.mode = "orb"
            at = self.pos() + self._orb_face - QPoint(ORB_MARGIN, ORB_MARGIN)
            self.orb.fade = 1.0
            self.orb.move(0, 0)
            self.setFixedSize(Orb.SIZE, Orb.SIZE)
            self.move(at)
        self.update()

    # ------------------------------------------------------------ painting the cockpit

    def _panel_rect(self) -> QRectF:
        return QRectF(SHADOW, SHADOW, WIDTH, self.height() - 2 * SHADOW)

    @staticmethod
    def _paint_panel(p: QPainter, rect: QRectF, radius: float, shadow: bool, scene=True):
        p.setPen(Qt.NoPen)
        if shadow:
            for i in range(SHADOW, 0, -1):
                p.setBrush(QColor(0, 0, 0, int(42 * (1 - i / SHADOW) ** 2)))
                p.drawRoundedRect(rect.adjusted(-i, -i + 6, i, i + 6), radius + i, radius + i)
        shape = QPainterPath()
        shape.addRoundedRect(rect, radius, radius)
        p.save()
        p.setClipPath(shape)
        if scene:
            studio(p, rect)
        else:
            p.fillRect(rect, QColor(10, 10, 11))
        p.restore()
        edge = QLinearGradient(rect.left(), rect.top(), rect.right(), rect.bottom())   # a chrome rim
        edge.setColorAt(0, QColor(255, 255, 255, 60))
        edge.setColorAt(0.3, QColor(255, 255, 255, 14))
        edge.setColorAt(0.7, QColor(255, 255, 255, 28))
        edge.setColorAt(1, QColor(255, 255, 255, 8))
        p.setBrush(Qt.NoBrush)
        p.setPen(QPen(edge, 1.2))
        p.drawRoundedRect(rect.adjusted(0.6, 0.6, -0.6, -0.6), radius, radius)

    def _paint_backdrop(self) -> QPixmap:
        """Shadow and cockpit, painted once per size."""
        dpr = self.devicePixelRatioF()
        pix = QPixmap(int(self.width() * dpr), int(self.height() * dpr))
        pix.setDevicePixelRatio(dpr)
        pix.fill(Qt.transparent)
        p = QPainter(pix)
        p.setRenderHint(QPainter.Antialiasing)
        self._paint_panel(p, self._panel_rect(), RADIUS, True)
        p.end()
        return pix

    def paintEvent(self, e):
        p = QPainter(self)
        if self.mode == "panel":
            if self._backdrop is None or self._backdrop.deviceIndependentSize().toSize() != self.size():
                self._backdrop = self._paint_backdrop()
            p.setCompositionMode(QPainter.CompositionMode_Source)
            p.setClipRegion(e.region())
            p.drawPixmap(0, 0, self._backdrop)
        elif self.mode == "morph":
            p.setRenderHint(QPainter.Antialiasing)
            p.setCompositionMode(QPainter.CompositionMode_Source)
            p.fillRect(self.rect(), Qt.transparent)
            p.setCompositionMode(QPainter.CompositionMode_SourceOver)
            k = self._k
            orb = QRectF(self._orb_face.x(), self._orb_face.y(), ORB, ORB)
            full = self._panel_rect()
            rect = QRectF(orb.left() + (full.left() - orb.left()) * k, orb.top() + (full.top() - orb.top()) * k,
                          orb.width() + (full.width() - orb.width()) * k, orb.height() + (full.height() - orb.height()) * k)
            self._paint_panel(p, rect, ORB / 2 + (RADIUS - ORB / 2) * k, False, scene=False)  # plain while it moves: cheap frames
        # button mode: the button paints itself

    # ------------------------------------------------------------ the Hub: who is online, what is happening

    def _poll_hub(self):
        """Keeps the widget current. Starts the local Hub server if it is not running, and tells the Hub this person is here
        (that is what shows them online when no agent is running)."""
        tick = 0
        while True:
            url = hub.hub_url()
            try:
                if not hub.is_up(url) and hub.is_local(url):
                    hub.start_local_server(url)
                team = hub.get_json(url + "/api/local/team")
                who = self._identity(team)
                if who:
                    hub.ping_presence(url, who)
                    team = hub.get_json(url + "/api/local/team")  # again, so this person already shows as online
                self._team = team
            except (OSError, ValueError, urllib.error.URLError):
                self._team = None  # the Hub is not answering
            if tick % 2 == 0 and self._team is not None:
                try:
                    self._week = hub.get_json(url + "/api/local/week")  # only the server computer may read this; others keep the last value
                except (OSError, ValueError, urllib.error.URLError):
                    pass
            tick += 1
            time.sleep(4)

    def _identity(self, team):
        """Who sits at this computer: TEAM_WIDGET_USER, else the agent's user, else the Windows account name (marco -> Marco)."""
        wanted = (os.environ.get("TEAM_WIDGET_USER") or hub.configured_user() or self.store.get().get("user") or getpass.getuser() or "").strip().lower()
        return next((p["user"] for p in team if wanted in (p["user"].lower(), p["name"].lower())), None)

    def _render_people(self, team):
        """The starting grid: whoever clocked in first is P1; the rest follow in team order. When the Hub is quiet,
        the last names seen, all offline."""
        if team:
            self._last_team = team
        shown = team or [{**p, "online": False, "status": "OFFLINE", "ponto": None} for p in self._last_team]
        me = self._identity(shown) if shown else None
        clocked = sorted((p for p in shown if p.get("ponto")), key=lambda p: p["ponto"])
        order = clocked + [p for p in shown if not p.get("ponto")]
        for i, row in enumerate(self.rows):
            if i < len(order):
                row.set(i + 1 if order[i].get("ponto") else None, order[i], order[i]["user"] == me)
                row.show()
            else:
                row.hide()
        self.grid_note.setText(f"{len(clocked)} de {len(shown)} com ponto" if shown else "")
        self.hub_note.setVisible(team is None)
        self._render_state()

    def _render_week(self, w: dict):
        self._clear(self.pending)
        for p in w.get("pending", [])[:3]:
            row = QHBoxLayout()
            row.setSpacing(8)
            ago_min = max(0, int(time.time() - (p["newest"] or time.time())) // 60)
            when = "agora" if ago_min < 1 else f"{ago_min} min" if ago_min < 60 else f"{ago_min // 60} h"
            name = label(clip(p["repo"], 16), 9, TEXT, QFont.DemiBold)
            name.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Preferred)
            row.addWidget(name)
            row.addWidget(label(f"{p['count']} fich  +{p['added']} −{p['deleted']}", 8.5, MUTED, families=MONO))
            row.addWidget(label(when, 8.5, FAINT))
            self.pending.addLayout(row)
        self.ledger.setVisible(bool(w.get("pending")))

    # ------------------------------------------------------------ actions

    def show_panel(self, fade=True):
        """Shows the widget in whatever size it is in (the tray's "Mostrar widget")."""
        self._fade.stop()
        if not self.isVisible():
            self.setWindowOpacity(0 if fade else 1)
            self.show()
        self.raise_()
        self.activateWindow()
        if fade:
            self._fade.setStartValue(self.windowOpacity())
            self._fade.setEndValue(1.0)
            self._fade.start()
        else:
            self.setWindowOpacity(1)

    def hide_panel(self):
        if not self.isVisible():
            return
        self._fade.stop()
        self._fade.setStartValue(self.windowOpacity())
        self._fade.setEndValue(0.0)
        self._fade.start()

    def _fade_done(self):
        if self._fade.endValue() == 0.0:
            self.hide()

    def showEvent(self, e):
        clock().start()
        super().showEvent(e)

    def hideEvent(self, e):
        clock().stop()  # nothing to animate while the widget is in the tray
        super().hideEvent(e)

    def closeEvent(self, e):
        e.ignore()  # closing hides to tray; the agent keeps running
        self.hide_panel()

    def keyPressEvent(self, e):
        if e.key() == Qt.Key_Escape:
            self.collapse() if self.mode == "panel" else self.hide_panel()
        else:
            super().keyPressEvent(e)

    def changeEvent(self, e):
        if e.type() == QEvent.WindowStateChange and self.isMaximized():  # e.g. Win+Up: the widget becomes the Hub
            QTimer.singleShot(0, self.showNormal)
            QTimer.singleShot(0, self._open_hub)
        super().changeEvent(e)

    def _open_hub(self):
        """The cockpit grows into the whole screen with the Hub inside (expand.py); minimizing shrinks it back."""
        if self._opening_hub:
            return
        self._opening_hub = True

        def work():  # starting the server can take a few seconds
            error = hub.ready()
            session = None if error else self.client.hub_session()
            self.hub_ready.emit((error, hub.hub_url() + (f"/#login={session}" if session else "")))

        threading.Thread(target=work, daemon=True).start()

    def _hub_opened(self, result):
        error, url = result
        self._opening_hub = False
        if error:
            self.show_panel()
            QMessageBox.warning(self, "Hub", error)
            return
        if self._expander is None:  # made on first use: the web engine is heavy and most sessions never open it
            from .expand import HubExpander
            self._expander = HubExpander()
            self._expander.collapsed.connect(lambda: self.show_panel(fade=False))
        if self.mode == "panel":
            start = self.geometry().adjusted(SHADOW, SHADOW, -SHADOW, -SHADOW)
        else:
            start = QRect(self.pos() + QPoint(ORB_MARGIN, ORB_MARGIN), QSize(ORB, ORB))
        self._expander.expand(start, url)
        self.hide()  # the expander starts exactly on top of the widget

    def _open_dashboard(self):
        self._open_hub()

    def _open_task(self):
        state = self.store.get()
        if state.get("dashboard_url") and state.get("task_id"):
            webbrowser.open(f"{state['dashboard_url']}/#task-{state['task_id']}")

    # ------------------------------------------------------------ the daily clock-in

    def _follow_ponto(self, team):
        """Tells this person when a teammate clocks in."""
        if not team:  # no answer yet: the first real list is a look, not news
            return
        now = {p["user"]: p.get("ponto") for p in team}
        names = {p["user"]: p["name"] for p in team}
        me = self._identity(team)
        if self._ponto_seen is not None:
            for user, at in now.items():
                if at and not self._ponto_seen.get(user) and user != me:
                    self.notify("Ponto", f"{names[user]} bateu o ponto às {hhmm(at)}")
        self._ponto_seen = now

    def punch_ponto(self):
        who = self._identity(self._team or [])
        if not who:
            self.notify("Ponto", "O Hub não respondeu. Tenta outra vez daqui a pouco.")
            return
        for row in self.rows:
            row.setEnabled(False)

        def work():
            try:
                self.punched.emit(hub.punch(hub.hub_url(), who))
            except (OSError, ValueError) as e:
                self.punched.emit(str(e))

        threading.Thread(target=work, daemon=True).start()

    def _punched(self, result):
        if isinstance(result, str):
            self._render_people(self._team)
            self.notify("Ponto", f"Não deu para bater o ponto: {result}")
            return
        if self._ponto_seen is not None:
            self._ponto_seen[result["user"]] = result["at"]
        if self._team:
            self._team = [{**p, "ponto": result["at"]} if p["user"] == result["user"] else p for p in self._team]
        self._render_people(self._team)
        self.notify("Ponto", f"Ponto batido às {hhmm(result['at'])}. A equipa já sabe.")

    # ------------------------------------------------------------ rendering

    def _tick(self):
        team = self._team
        if team is not self._team_seen:
            if team != self._team_seen:
                self._render_people(team)
                self._render_usage()
                self._follow_ponto(team)
            self._team_seen = team
        week = self._week
        if week is not None and week is not self._week_seen:
            if (self._week_seen or {}).get("pending") != week.get("pending"):
                self._render_week(week)
            self._week_seen = week
        if time.time() - self._usage_at > 10:
            self._usage_at = time.time()
            self._render_usage()
        state = self.store.get()
        if self.store.version != self._version:
            self._version = self.store.version
            self._render(state)
        elif state.get("started_at"):
            self.details.setText(self._details(state))

    def _details(self, state: dict) -> str:
        lines = [f"{label}: {state[key]}" for key, label in (("current_action", "agora"), ("next_action", "a seguir")) if state.get(key)]
        if state.get("started_at"):
            lines.append(f"há {elapsed(state['started_at'])}")
        return "\n".join(lines)

    def _render_state(self):
        """How things are, as the chip on the rev counter and the light on the button."""
        state = self.store.get()
        status = state.get("status", "OFFLINE")
        if self._team is None:
            text, colour = "Hub desligado", COLORS["ERROR"]
        elif status == "ERROR" or state.get("error"):
            text, colour = "Erro no agente", COLORS["ERROR"]
        elif status == "WAITING" or state.get("pending_approval"):
            text, colour = "À espera de aprovação", COLORS["WAITING"]
        elif status == "WORKING":
            text, colour = "A trabalhar", COLORS["WORKING"]
        else:
            text, colour = "Tudo bem", COLORS["ONLINE"]
        pulse = status in ("WORKING", "WAITING")
        self.tacho.set_status(text, colour, pulse)
        self.orb.set(self._load, colour, pulse)

    def _render(self, state: dict):
        status = state.get("status", "OFFLINE")
        self.on_status(status)
        name = state.get("display_name")
        self.user_label.setText(f"Agente · central de comando · {name}" if name else "Agente · central de comando")

        if status == "OFFLINE":
            alert = ""
        elif state.get("pending_approval"):
            alert = f"À espera de aprovação: {state['pending_approval']}"
        elif state.get("error"):
            alert = f"Erro: {state['error']}"
        elif not state.get("connected"):
            alert = "Servidor sem resposta, a trabalhar offline."
        else:
            notes = state.get("notifications") or []
            alert = notes[-1]["message"] if notes else ""
        if alert:
            tint = COLORS["ERROR"] if state.get("error") else COLORS["WAITING"]
            self.alert.tint = tint
            recolour(self.alert_text, tint)
            self.alert_text.setText(alert)
            self.alert.show()
            self.alert.update()
        else:
            self.alert.hide()

        if state.get("task"):
            progress = state.get("progress") or 0
            self.task.setText(state["task"])
            self.progress_text.setText(f"{progress}%")
            self.bar.set(progress, COLORS["WORKING"] if progress >= 100 else SILVER)
            self.details.setText(self._details(state))
            self.details.setVisible(bool(self.details.text()))
            self.task_card.show()
        else:
            self.task_card.hide()

        self._render_usage(state)

    def _render_usage(self, state: dict | None = None):
        """Claude and Higgsfield of whoever sits here: the plan limits Claude Code reported, else the Hub's numbers."""
        state = state or self.store.get()
        hub_team = self._team or []
        who = self._identity(hub_team) or state.get("user")
        mine = next((m for m in hub_team if m.get("user") == who and "week_cost_usd" in m), None) \
            or next((m for m in state.get("team") or [] if m.get("user") == who), {})
        plan = claude_plan_usage()
        if plan:
            self._load = plan["week"]
            note = until(plan["five_reset"]) or (f"lido {ago(plan['saved_at'])}" if plan["saved_at"] else "")
            five = plan["five"]
            self.claude_session.set(five, "—" if five is None else f"{round(five)}%", note)
        else:
            spent = mine.get("week_cost_usd") or 0
            self._load = mine.get("week_pct") if spent else None
            self.claude_session.set(None, "—", "sem dados do Claude Code")
        used = mine.get("higgsfield_pct")
        self.higgs.set(None if used is None else 100 - used, "—" if used is None else f"{100 - used}% livres",
                       "por definir no Hub" if used is None else "")
        self.tacho.set_load(self._load)
        self._render_state()
