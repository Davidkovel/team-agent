"""The widget, in three sizes: a small orb on the desktop, the command centre (a tall panel), and the Hub.

Click the orb and it grows into the panel; the panel's ⤢ grows into the Hub (expand.py); ▾ shrinks it back
to the orb. Night-series look: charcoal with a fine weave, champagne-rose accents, serif titles. Every animation
runs off one frame clock at the monitor's refresh rate (see motion.py). Closing hides it to the tray.
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
from .motion import clock

TEXT, MUTED, FAINT = "#ece6e1", "#8f8984", "#57524e"
ROSE, ROSE2 = "#e9c1aa", "#f6e0d3"        # champagne rose
ACCENT = ROSE
# quiet tones only; a hint of colour where a state needs one
COLORS = {"WORKING": "#9cc9a6", "ONLINE": "#9cc9a6", "IDLE": "#c8ccce", "WAITING": "#d8c08a",
          "PAUSED": "#d8c08a", "ERROR": "#e0907a", "OFFLINE": "#5d5d63"}
LABELS = {"WORKING": "A trabalhar", "ONLINE": "Online", "IDLE": "Livre", "WAITING": "À espera",
          "PAUSED": "Em pausa", "ERROR": "Erro", "OFFLINE": "Agente desligado"}
WIDTH = 344            # the panel; the window adds SHADOW on every side
SHADOW = 18
RADIUS = 26
ORB = 96               # the orb's face; its window adds ORB_MARGIN for the shadow
ORB_MARGIN = 14
GROW, SHRINK = 0.42, 0.34   # seconds
ASSETS = Path(__file__).resolve().parents[1] / "assets"
LOGO = ASSETS / "logo.png"
UI, MONO = ("Segoe UI Variable Text", "Segoe UI"), ("Cascadia Mono", "Consolas")
DISPLAY, SERIF = ("Segoe UI Variable Display", "Segoe UI"), ("Palatino Linotype", "Georgia")
WEEKDAYS = ["SEG", "TER", "QUA", "QUI", "SEX", "SÁB", "DOM"]
MONTHS = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"]


def hhmm(iso_time: str) -> str:
    """09:12, in this computer's time, from the Hub's ISO time."""
    return datetime.fromisoformat(iso_time).astimezone().strftime("%H:%M")


def elapsed(started_at) -> str:
    if not started_at:
        return ""
    seconds = int(time.time() - started_at)
    return f"{seconds // 3600}h {seconds % 3600 // 60:02d}m" if seconds >= 3600 else f"{seconds // 60}m {seconds % 60:02d}s"


def ago(epoch: float) -> str:
    """HÁ 4 MIN, for the small labels on the right of a section."""
    m = max(0, int(time.time() - epoch) // 60)
    return "AGORA" if m < 1 else f"HÁ {m} MIN" if m < 60 else f"HÁ {m // 60} H" if m < 1440 else f"HÁ {m // 1440} D"


def until(epoch: float | None) -> str:
    if not epoch:
        return ""
    s = max(0, int(epoch - time.time()))
    d, h, m = s // 86400, s % 86400 // 3600, s % 3600 // 60
    return f"volta em {d}d {h}h" if d else f"volta em {h}h {m:02d}m" if h else f"volta em {m} min"


def meter_color(pct):
    return COLORS["ERROR"] if pct >= 85 else COLORS["WAITING"] if pct >= 60 else ROSE


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
    return label(text, 7, colour, QFont.Bold, spacing=1.8)


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


def weave(p: QPainter, rect: QRectF, step=5.0):
    """The fine diagonal weave in the leather of the panel and the orb."""
    p.save()
    p.setClipRect(rect, Qt.IntersectClip)  # keeps the round or rounded clip the caller set
    light, dark = pen(QColor(255, 255, 255, 7), 1), pen(QColor(0, 0, 0, 40), 1)
    x = rect.left() - rect.height()
    while x < rect.right():
        p.setPen(light)
        p.drawLine(QPointF(x, rect.top()), QPointF(x + rect.height(), rect.bottom()))
        p.setPen(dark)
        p.drawLine(QPointF(x + step / 2, rect.top()), QPointF(x + step / 2 + rect.height(), rect.bottom()))
        x += step
    p.restore()


def ease(k: float) -> float:
    return 1 - (1 - k) ** 3


# ------------------------------------------------------------------ building blocks


class Glide:
    """A number that slides to its new value, for arcs and bars."""

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
    """A quiet tile for the things that only show up sometimes: an alert, a task, unsaved work."""

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
        p.drawRoundedRect(r, 14, 14)


class Meter(QWidget):
    """A hairline progress bar that glides to its new value."""

    def __init__(self, height=3):
        super().__init__()
        self.setFixedHeight(height)
        self._colour = QColor(ROSE)
        self._glide = Glide(self, 800)

    def set(self, pct, colour=ROSE):
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
            w = max(h, self.width() * self._glide.value)
            fill = QLinearGradient(0, 0, w, 0)
            fill.setColorAt(0, rgba(self._colour.name(), 0.55))
            fill.setColorAt(1, self._colour)
            p.setBrush(fill)
            p.drawRoundedRect(QRectF(0, 0, w, h), h / 2, h / 2)


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
    """Round dark button of the title bar: 'shrink' (back to the orb), 'hub' (full size) or 'hide' (to the tray)."""

    def __init__(self, glyph, tip):
        super().__init__()
        self.glyph = glyph
        self.setFixedSize(26, 26)
        self.setToolTip(tip)

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        face = QLinearGradient(0, 0, 0, 26)
        face.setColorAt(0, QColor(70 + int(24 * self.hover), 68 + int(22 * self.hover), 68 + int(22 * self.hover)))
        face.setColorAt(1, QColor(38, 37, 38))
        p.setBrush(face)
        p.setPen(QPen(QColor(255, 255, 255, 30), 1))
        p.drawEllipse(QRectF(1, 1, 24, 24))
        p.setPen(pen(QColor(222 + int(30 * self.hover), 216, 212), 1.4))
        p.setBrush(Qt.NoBrush)
        if self.glyph == "hide":
            p.drawLine(QPointF(9.5, 9.5), QPointF(16.5, 16.5))
            p.drawLine(QPointF(16.5, 9.5), QPointF(9.5, 16.5))
        elif self.glyph == "shrink":
            path = QPainterPath(QPointF(9, 11.5))
            path.lineTo(13, 15.5)
            path.lineTo(17, 11.5)
            p.drawPath(path)
        else:  # two corners pulling apart
            path = QPainterPath(QPointF(14.5, 8.5))
            path.lineTo(17.5, 8.5)
            path.lineTo(17.5, 11.5)
            path.moveTo(11.5, 17.5)
            path.lineTo(8.5, 17.5)
            path.lineTo(8.5, 14.5)
            path.moveTo(17.5, 8.5)
            path.lineTo(14, 12)
            path.moveTo(8.5, 17.5)
            path.lineTo(12, 14)
            p.drawPath(path)


class Monogram(QWidget):
    """AMG in a thin rose circle, like a coachbuilder's badge."""

    def __init__(self):
        super().__init__()
        self.setFixedSize(38, 38)

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        p.setPen(QPen(rgba(ROSE, 0.85), 1.2))
        p.setBrush(QColor(20, 19, 20))
        p.drawEllipse(QRectF(1.5, 1.5, 35, 35))
        p.setPen(QColor(ROSE2))
        p.setFont(font(7.5, QFont.Bold, SERIF, 0.2))
        p.drawText(QRectF(0, 0, 38, 38), Qt.AlignCenter, "AMG")


class Dial(QWidget):
    """The big watch face: ticks, a sweeping second, the load arc, the time, the date and how things are."""
    SIZE = 248

    def __init__(self):
        super().__init__()
        self.setFixedSize(self.SIZE, self.SIZE)
        self._load = Glide(self, 1200)
        self._status, self._status_colour, self._pulse = "TUDO BEM", QColor(COLORS["ONLINE"]), False
        self._ticks, self._ticks_key = None, None
        self._f_time, self._f_date, self._f_status = font(31, QFont.DemiBold, DISPLAY, -0.5), font(7, QFont.Bold, UI, 2.2), font(7, QFont.Bold, UI, 1.8)
        clock().frame.connect(self._frame)

    def set_load(self, pct):
        self._load.to(max(0, min(100, pct or 0)) / 100)

    def set_status(self, text, colour, pulse=False):
        self._status, self._status_colour, self._pulse = text, QColor(colour), pulse
        self.update()

    def _frame(self, _):
        if self.isVisible():
            self.update()

    def _tick_ring(self) -> QPixmap:
        dpr = self.devicePixelRatioF()
        pix = QPixmap(int(self.SIZE * dpr), int(self.SIZE * dpr))
        pix.setDevicePixelRatio(dpr)
        pix.fill(Qt.transparent)
        p = QPainter(pix)
        p.setRenderHint(QPainter.Antialiasing)
        c, r = self.SIZE / 2, self.SIZE / 2 - 4
        for i in range(60):
            a = math.radians(i * 6)
            hour = i % 5 == 0
            inner = r - (10 if hour else 5)
            p.setPen(pen(QColor(236, 230, 225, 200 if hour else 70), 1.7 if hour else 1.0))
            p.drawLine(QPointF(c + inner * math.sin(a), c - inner * math.cos(a)), QPointF(c + r * math.sin(a), c - r * math.cos(a)))
        p.end()
        return pix

    def paintEvent(self, _):
        if self._ticks_key != self.devicePixelRatioF():
            self._ticks, self._ticks_key = self._tick_ring(), self.devicePixelRatioF()
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        p.drawPixmap(0, 0, self._ticks)
        c, r = QPointF(self.SIZE / 2, self.SIZE / 2), self.SIZE / 2 - 4
        now = datetime.now()

        # the second, sweeping round the ticks with a short fading tail
        sec = now.second + now.microsecond / 1e6
        for i in range(10):
            a = math.radians((sec - i * 0.09) * 6)
            p.setPen(Qt.NoPen)
            p.setBrush(rgba(ROSE, 0.9 * (1 - i / 10) ** 2))
            rr = r - 2.5
            p.drawEllipse(QPointF(c.x() + rr * math.sin(a), c.y() - rr * math.cos(a)), 2.4 - i * 0.15, 2.4 - i * 0.15)

        # the load arc, clockwise from the top
        ar = r - 22
        box = QRectF(c.x() - ar, c.y() - ar, 2 * ar, 2 * ar)
        p.setPen(pen(QColor(255, 255, 255, 16), 5))
        p.setBrush(Qt.NoBrush)
        p.drawArc(box, 0, 360 * 16)
        k = self._load.value
        if k > 0.002:
            sweep = QConicalGradient(c, 90)
            sweep.setColorAt(0, QColor(ROSE2))
            sweep.setColorAt(1 - k, QColor(ROSE2))
            sweep.setColorAt(1, rgba(ROSE, 0.55))
            p.setPen(pen(rgba(ROSE, 0.14), 11))
            p.drawArc(box, 90 * 16, -int(360 * 16 * k))
            p.setPen(pen(sweep, 5))
            p.drawArc(box, 90 * 16, -int(360 * 16 * k))
            a = math.radians(360 * k)
            p.setPen(Qt.NoPen)
            p.setBrush(QColor(ROSE2))
            p.drawEllipse(QPointF(c.x() + ar * math.sin(a), c.y() - ar * math.cos(a)), 3.2, 3.2)

        # time, date, state
        p.setPen(QColor(TEXT))
        p.setFont(self._f_time)
        p.drawText(QRectF(0, c.y() - 34, self.SIZE, 44), Qt.AlignCenter, now.strftime("%H:%M"))
        p.setPen(QColor(MUTED))
        p.setFont(self._f_date)
        p.drawText(QRectF(0, c.y() + 14, self.SIZE, 16), Qt.AlignCenter, f"{WEEKDAYS[now.weekday()]}  ·  {now.day}  {MONTHS[now.month - 1]}")
        f = self._f_status
        width = QFontMetricsF(f).horizontalAdvance(self._status) + 12
        x = c.x() - width / 2
        y = c.y() + 42
        glow = 0.5 + 0.5 * math.sin(time.time() * 2 * math.pi / 2.2) if self._pulse else 1.0
        p.setPen(Qt.NoPen)
        p.setBrush(rgba(self._status_colour.name(), 0.35 + 0.65 * glow))
        p.drawEllipse(QPointF(x + 2.5, y), 2.6, 2.6)
        p.setPen(QColor(TEXT))
        p.setFont(f)
        p.drawText(QRectF(x + 10, y - 8, width, 16), Qt.AlignVCenter | Qt.AlignLeft, self._status)


class Person(Hover):
    """One teammate: a ring that fills when they are online, the initial, the name, and when they clocked in.
    Your own ring clocks you in when you tap it."""

    def __init__(self):
        super().__init__()
        self.setFixedSize(92, 104)
        self._name, self._online, self._status, self._ponto, self._me = "", False, "OFFLINE", None, False
        self._fill = Glide(self, 900)
        self.setEnabled(False)

    def set(self, person: dict | None, me: bool):
        if person is None:
            self._name, self._online, self._status, self._ponto = "—", False, "OFFLINE", None
        else:
            self._name, self._online = person["name"], person["online"]
            self._status, self._ponto = person.get("status", "OFFLINE"), person.get("ponto")
        self._me = me
        self.setEnabled(me and not self._ponto and person is not None)
        self.setCursor(Qt.PointingHandCursor if self.isEnabled() else Qt.ArrowCursor)
        self.setToolTip("Bater o ponto" if self.isEnabled() else (f"Ponto às {hhmm(self._ponto)}" if self._ponto else ""))
        self._fill.to(1.0 if self._online else 0.0)
        self.update()

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        c, r = QPointF(46, 34), 27
        box = QRectF(c.x() - r, c.y() - r, 2 * r, 2 * r)
        p.setPen(pen(QColor(255, 255, 255, 18), 3.5))
        p.setBrush(QColor(255, 255, 255, int(6 + 10 * self.hover)))
        p.drawEllipse(c, r, r)
        k = self._fill.value
        if k > 0.002:
            p.setPen(pen(rgba(ROSE, 0.15), 8))
            p.drawArc(box, 90 * 16, -int(360 * 16 * k))
            p.setPen(pen(QColor(ROSE), 3.5))
            p.drawArc(box, 90 * 16, -int(360 * 16 * k))
        p.setPen(QColor(TEXT) if self._online else QColor(FAINT))
        p.setFont(font(17, QFont.DemiBold, SERIF))
        p.drawText(box, Qt.AlignCenter, (self._name[:1] or "?").upper())
        # online dot on the ring; a white tick once they clocked in
        dot = QPointF(c.x() + r * 0.71, c.y() + r * 0.71)
        p.setPen(QPen(QColor(22, 21, 22), 2.5))
        p.setBrush(QColor(COLORS["ONLINE"] if self._online else COLORS["OFFLINE"]))
        p.drawEllipse(dot, 4.6, 4.6)
        if self._ponto:
            badge = QPointF(c.x() + r * 0.71, c.y() - r * 0.71)
            p.setBrush(QColor("#ffffff"))
            p.drawEllipse(badge, 6.5, 6.5)
            p.setPen(pen(QColor("#000000"), 1.5))
            path = QPainterPath(QPointF(badge.x() - 3, badge.y() + 0.2))
            path.lineTo(badge.x() - 0.8, badge.y() + 2.3)
            path.lineTo(badge.x() + 3, badge.y() - 2)
            p.setBrush(Qt.NoBrush)
            p.drawPath(path)
        p.setPen(QColor(TEXT) if self._online else QColor(MUTED))
        p.setFont(font(7, QFont.Bold, UI, 1.8))
        p.drawText(QRectF(0, 69, 92, 14), Qt.AlignCenter, clip(self._name.upper(), 9))
        if self._ponto:
            sub, colour = f"PONTO {hhmm(self._ponto)}", ROSE2
        elif self._me and self.isEnabled():
            sub, colour = "TOCA P/ PONTO", ROSE
        else:
            sub = {"WORKING": "A TRABALHAR", "WAITING": "À ESPERA", "PAUSED": "EM PAUSA", "ERROR": "ERRO"}.get(
                self._status, "ONLINE") if self._online else "OFFLINE"
            colour = MUTED if self._online else FAINT
        p.setPen(QColor(colour))
        p.setFont(font(6.5, QFont.DemiBold, UI, 1.2))
        p.drawText(QRectF(0, 85, 92, 14), Qt.AlignCenter, sub)


class Section(QWidget):
    """A serif italic title on the left, a small caps note on the right."""

    def __init__(self, title):
        super().__init__()
        row = QHBoxLayout(self)
        row.setContentsMargins(0, 0, 0, 0)
        t = QLabel(title)
        t.setFont(font(12.5, QFont.Normal, SERIF, italic=True))
        t.setStyleSheet(f"color: {TEXT}; background: transparent;")
        row.addWidget(t)
        row.addStretch(1)
        self.note = label("", 6.5, FAINT, QFont.Bold, spacing=1.6)
        row.addWidget(self.note, 0, Qt.AlignBottom)


class UsageRow(QWidget):
    """26% SESSÃO ............ volta em 1h 21m, with a hairline bar under it."""

    def __init__(self, what):
        super().__init__()
        self.setFixedHeight(38)
        self._what, self._pct, self._hint = what, None, ""
        self._glide = Glide(self, 900)

    def set(self, pct, hint=""):
        self._pct, self._hint = pct, hint
        self._glide.to(max(0, min(100, pct or 0)) / 100)
        self.update()

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        big = font(15, QFont.DemiBold, DISPLAY)
        value = "—" if self._pct is None else f"{round(self._pct)}"
        p.setFont(big)
        p.setPen(QColor(TEXT))
        p.drawText(QPointF(0, 22), value)
        x = QFontMetricsF(big).horizontalAdvance(value) + 2
        if self._pct is not None:
            p.setFont(font(8, QFont.DemiBold, DISPLAY))
            p.drawText(QPointF(x, 22), "%")
            x += 14
        p.setPen(QColor(MUTED))
        p.setFont(font(6.5, QFont.Bold, UI, 1.8))
        p.drawText(QPointF(x + 4, 21), self._what)
        p.setPen(QColor(FAINT))
        p.setFont(font(7.5, QFont.Normal, UI))
        p.drawText(QRectF(0, 8, self.width(), 16), Qt.AlignRight | Qt.AlignVCenter, self._hint)
        y, w = 31, self.width()
        p.setPen(Qt.NoPen)
        p.setBrush(QColor(255, 255, 255, 16))
        p.drawRoundedRect(QRectF(0, y, w, 2.5), 1.25, 1.25)
        if self._glide.value > 0:
            fill = QLinearGradient(0, 0, w * self._glide.value, 0)
            fill.setColorAt(0, rgba(ROSE, 0.5))
            fill.setColorAt(1, QColor(meter_color(self._pct or 0)))
            p.setBrush(fill)
            p.drawRoundedRect(QRectF(0, y, max(2.5, w * self._glide.value), 2.5), 1.25, 1.25)


class HalfGauge(QWidget):
    """Higgsfield credits as half a dial."""

    def __init__(self):
        super().__init__()
        self.setFixedHeight(92)
        self._pct = None
        self._glide = Glide(self, 1100)

    def set(self, pct):
        self._pct = pct
        self._glide.to(max(0, min(100, pct or 0)) / 100)
        self.update()

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        r = 70
        c = QPointF(self.width() / 2, 82)
        box = QRectF(c.x() - r, c.y() - r, 2 * r, 2 * r)
        p.setPen(pen(QColor(255, 255, 255, 16), 6))
        p.drawArc(box, 180 * 16, -180 * 16)
        k = self._glide.value
        if k > 0.002:
            p.setPen(pen(rgba(ROSE, 0.14), 12))
            p.drawArc(box, 180 * 16, -int(180 * 16 * k))
            p.setPen(pen(QColor(meter_color(self._pct or 0)), 6))
            p.drawArc(box, 180 * 16, -int(180 * 16 * k))
        p.setPen(QColor(TEXT) if self._pct is not None else QColor(FAINT))
        p.setFont(font(19, QFont.DemiBold, DISPLAY))
        p.drawText(QRectF(0, c.y() - 42, self.width(), 30), Qt.AlignCenter, "—" if self._pct is None else f"{round(self._pct)}%")
        p.setPen(QColor(MUTED))
        p.setFont(font(6.5, QFont.Bold, UI, 1.8))
        p.drawText(QRectF(0, c.y() - 12, self.width(), 14), Qt.AlignCenter, "CRÉDITOS GASTOS" if self._pct is not None else "POR DEFINIR NO HUB")


class PontoButton(Hover):
    """Bater o ponto: champagne until you clock in, then a quiet pill with the time."""

    def __init__(self):
        super().__init__()
        self.setFont(font(8.5, QFont.DemiBold))
        self.setFixedHeight(30)
        self._at = None

    def set(self, at: str | None):
        self._at = at
        self.setEnabled(not at)
        self.setCursor(Qt.ArrowCursor if at else Qt.PointingHandCursor)
        self.setText(f"Ponto batido às {hhmm(at)}" if at else "Bater o ponto")
        self.setFixedWidth(int(QFontMetricsF(self.font()).horizontalAdvance(self.text())) + (46 if at else 36))
        self.update()

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        r = QRectF(self.rect()).adjusted(1, 1, -1, -1)
        s = 1 - 0.03 * self.press
        p.translate(r.center())
        p.scale(s, s)
        p.translate(-r.center())
        p.setFont(self.font())
        if self._at:
            p.setPen(QPen(rgba(ROSE, 0.35), 1))
            p.setBrush(Qt.NoBrush)
            p.drawRoundedRect(r, r.height() / 2, r.height() / 2)
            p.setPen(pen(QColor(ROSE2), 1.6))
            y = r.center().y()
            path = QPainterPath(QPointF(r.left() + 13, y))
            path.lineTo(r.left() + 16, y + 3)
            path.lineTo(r.left() + 21, y - 3)
            p.drawPath(path)
            p.setPen(QColor(ROSE2))
            p.drawText(r.adjusted(28, 0, -10, 0), Qt.AlignVCenter | Qt.AlignLeft, self.text())
            return
        fill = QLinearGradient(0, r.top(), 0, r.bottom())
        fill.setColorAt(0, QColor(ROSE2).lighter(int(100 + 6 * self.hover)))
        fill.setColorAt(1, QColor(ROSE).lighter(int(100 + 6 * self.hover)))
        p.setPen(Qt.NoPen)
        p.setBrush(fill)
        p.drawRoundedRect(r, r.height() / 2, r.height() / 2)
        p.setPen(QColor("#1a1414"))
        p.drawText(r, Qt.AlignCenter, self.text())


class Divider(QWidget):
    """A hairline that fades out at both ends; rose for the main one."""

    def __init__(self, rose=False):
        super().__init__()
        self.setFixedHeight(9)
        self._rose = rose

    def paintEvent(self, _):
        p = QPainter(self)
        line = QLinearGradient(0, 0, self.width(), 0)
        base = ROSE if self._rose else "#ffffff"
        line.setColorAt(0, rgba(base, 0))
        line.setColorAt(0.5, rgba(base, 0.75 if self._rose else 0.09))
        line.setColorAt(1, rgba(base, 0))
        p.setPen(QPen(line, 1))
        p.drawLine(QPointF(0, 4.5), QPointF(self.width(), 4.5))


class TitleBar(QWidget):
    """Drag the panel by its top; double-click opens the Hub (what maximizing did before)."""

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
    """The widget at its smallest: a watch face with the time, how things are, and the Claude load at the bottom.
    Click it and it opens into the command centre; drag it anywhere."""
    SIZE = ORB + 2 * ORB_MARGIN

    def __init__(self, on_click):
        super().__init__()
        self.setFixedSize(self.SIZE, self.SIZE)
        self.setCursor(Qt.PointingHandCursor)
        self.setToolTip("Abrir a central de comando")
        self._on_click = on_click
        self.fade = 1.0
        self._hover = 0.0
        self._hover_anim = animate(self, 200, self._set_hover)
        self._press_at, self._grab, self._dragged = None, None, False
        self._status_colour, self._pulse = QColor(COLORS["ONLINE"]), False
        self._load = Glide(self, 1200)
        self._face, self._face_key = None, None
        self._f_time = font(15.5, QFont.Bold, DISPLAY, -0.3)
        clock().frame.connect(self._frame)

    def _set_hover(self, v):
        self._hover = v
        self.update()

    def set(self, load, colour, pulse):
        self._load.to(max(0, min(100, load or 0)) / 100)
        self._status_colour, self._pulse = QColor(colour), pulse

    def _frame(self, _):
        if self.isVisible():
            self.update()

    def enterEvent(self, e):
        self._hover_anim.stop()
        self._hover_anim.setStartValue(self._hover)
        self._hover_anim.setEndValue(1.0)
        self._hover_anim.start()

    def leaveEvent(self, e):
        self._hover_anim.stop()
        self._hover_anim.setStartValue(self._hover)
        self._hover_anim.setEndValue(0.0)
        self._hover_anim.start()

    def mousePressEvent(self, e):
        if e.button() == Qt.LeftButton:
            self._press_at = e.globalPosition().toPoint()
            self._grab = self._press_at - self.window().pos()
            self._dragged = False

    def mouseMoveEvent(self, e):
        if self._press_at is None:
            return
        at = e.globalPosition().toPoint()
        if not self._dragged and (at - self._press_at).manhattanLength() > 4:
            self._dragged = True
        if self._dragged:
            self.window().move(at - self._grab)

    def mouseReleaseEvent(self, e):
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
        shadow = QRadialGradient(QPointF(c.x(), c.y() + 4), r + ORB_MARGIN)
        shadow.setColorAt(0.78, QColor(0, 0, 0, 120))
        shadow.setColorAt(1, QColor(0, 0, 0, 0))
        p.setPen(Qt.NoPen)
        p.setBrush(shadow)
        p.drawEllipse(QPointF(c.x(), c.y() + 4), r + ORB_MARGIN, r + ORB_MARGIN)
        face = QRadialGradient(QPointF(c.x() - 12, c.y() - 18), r * 1.3)
        face.setColorAt(0, QColor(44, 42, 44))
        face.setColorAt(1, QColor(16, 15, 16))
        p.setBrush(face)
        p.drawEllipse(c, r - 3, r - 3)
        clip = QPainterPath()
        clip.addEllipse(c, r - 3, r - 3)
        p.setClipPath(clip)
        weave(p, QRectF(c.x() - r, c.y() - r, 2 * r, 2 * r))
        p.setClipping(False)
        p.setPen(QColor(ROSE2))
        p.setFont(font(7, QFont.Bold, SERIF, 1.2))
        p.drawText(QRectF(0, c.y() - 31, self.SIZE, 14), Qt.AlignCenter, "AMG")
        p.end()
        return pix

    def paintEvent(self, _):
        if self._face_key != self.devicePixelRatioF():
            self._face, self._face_key = self._build_face(), self.devicePixelRatioF()
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        p.setOpacity(self.fade)
        c, r = QPointF(self.SIZE / 2, self.SIZE / 2), ORB / 2
        grow = 1 + 0.035 * self._hover
        p.translate(c)
        p.scale(grow, grow)
        p.translate(-c)
        p.drawPixmap(0, 0, self._face)
        t = time.time()
        # metallic bezel with a light that goes round once every twelve seconds
        bezel = QConicalGradient(c, -(t * 30) % 360)
        for at, colour in ((0, "#f4efe9"), (0.18, "#6f6b69"), (0.42, ROSE), (0.62, "#4d4a49"), (0.82, "#cfc8c2"), (1, "#f4efe9")):
            bezel.setColorAt(at, QColor(colour))
        p.setPen(QPen(bezel, 3.2 + 0.6 * self._hover))
        p.setBrush(Qt.NoBrush)
        p.drawEllipse(c, r - 1.8, r - 1.8)
        # time and state
        now = datetime.now()
        p.setPen(QColor(TEXT))
        p.setFont(self._f_time)
        p.drawText(QRectF(0, c.y() - 15, self.SIZE, 28), Qt.AlignCenter, now.strftime("%H:%M"))
        glow = 0.5 + 0.5 * math.sin(t * 2 * math.pi / 2.2) if self._pulse else 1.0
        p.setPen(Qt.NoPen)
        p.setBrush(rgba(self._status_colour.name(), 0.18 * glow))
        p.drawEllipse(QPointF(c.x(), c.y() + 18), 5.5, 5.5)
        p.setBrush(rgba(self._status_colour.name(), 0.4 + 0.6 * glow))
        p.drawEllipse(QPointF(c.x(), c.y() + 18), 2.6, 2.6)
        # the Claude load along the bottom of the bezel
        box = QRectF(c.x() - r + 9, c.y() - r + 9, 2 * r - 18, 2 * r - 18)
        p.setPen(pen(QColor(255, 255, 255, 22), 2.6))
        p.drawArc(box, 210 * 16, 120 * 16)            # the bottom third, left to right through six o'clock
        k = self._load.value
        if k > 0.002:
            p.setPen(pen(QColor(ROSE), 2.6))
            p.drawArc(box, 210 * 16, int(120 * 16 * k))


class Panel(QWidget):
    """The command centre's content; tells the window when its size changes."""
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
        self.mode = "orb"            # orb | panel | morph
        self._morph_dir, self._morph_t0, self._k = 0, 0.0, 0.0
        self._orb_face = QPoint()    # where the orb's face sits inside the window during a morph

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
        col.setContentsMargins(20, 16, 20, 20)
        col.setSpacing(10)
        self._build(col)
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
        # title: badge, name, and the three round buttons
        bar = TitleBar(self._open_hub)
        row = QHBoxLayout(bar)
        row.setContentsMargins(0, 0, 0, 0)
        row.setSpacing(10)
        row.addWidget(Monogram(), 0, Qt.AlignVCenter)
        names = QVBoxLayout()
        names.setSpacing(1)
        names.addWidget(label("AGENTE AMG", 12, TEXT, QFont.Bold, SERIF, 1.6))
        self.user_label = label("CENTRAL DE COMANDO", 6.5, ROSE, QFont.Bold, UI, 2.2)
        names.addWidget(self.user_label)
        row.addLayout(names)
        row.addStretch(1)
        for glyph, tip, action in (("shrink", "Encolher para o círculo", self.collapse), ("hub", "Abrir o Hub em grande", self._open_hub),
                                   ("hide", "Esconder (o agente continua)", self.hide_panel)):
            b = IconButton(glyph, tip)
            b.clicked.connect(action)
            row.addWidget(b, 0, Qt.AlignVCenter)
        col.addWidget(bar)

        # the watch face
        col.addSpacing(4)
        self.dial = Dial()
        col.addWidget(self.dial, 0, Qt.AlignHCenter)
        self.load_label = label("CARGA CLAUDE  ·  —", 7, MUTED, QFont.Bold, UI, 2.2)
        self.load_label.setAlignment(Qt.AlignCenter)
        col.addWidget(self.load_label)
        col.addWidget(Divider(rose=True))

        # the team: Kovel, Marco, David, online or not, and the daily clock-in
        people = QHBoxLayout()
        people.setSpacing(0)
        self.persons = [Person() for _ in range(3)]
        for person in self.persons:
            person.clicked.connect(self.punch_ponto)
            people.addWidget(person, 1, Qt.AlignHCenter)
        col.addLayout(people)
        self.hub_note = label("", 7.5, FAINT)
        self.hub_note.setAlignment(Qt.AlignCenter)
        self.hub_note.hide()
        col.addWidget(self.hub_note)
        self.ponto_button = PontoButton()
        self.ponto_button.set(None)
        self.ponto_button.clicked.connect(self.punch_ponto)
        col.addWidget(self.ponto_button, 0, Qt.AlignHCenter)
        col.addWidget(Divider())

        # Claude: this session's window and the week
        self.claude_head = Section("Claude")
        col.addWidget(self.claude_head)
        self.claude_session, self.claude_week = UsageRow("SESSÃO"), UsageRow("SEMANA")
        col.addWidget(self.claude_session)
        col.addWidget(self.claude_week)
        col.addWidget(Divider())

        # Higgsfield
        self.higgs_head = Section("Higgsfield")
        col.addWidget(self.higgs_head)
        self.higgs = HalfGauge()
        col.addWidget(self.higgs)

        # only when there is something to say
        self.alert = Card(COLORS["WAITING"])
        self.alert_text = label("", 9, COLORS["WAITING"], wrap=True)
        self.alert.box.addWidget(self.alert_text)
        self.alert.hide()
        col.addWidget(self.alert)

        self.task_card = Card()
        head = QHBoxLayout()
        head.addWidget(caption("TAREFA"))
        head.addStretch(1)
        self.progress_text = label("", 9, TEXT, QFont.DemiBold, MONO)
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
        self.ledger.box.addWidget(caption("A MEXER AGORA  ·  SEM COMMIT"))
        self.pending = QVBoxLayout()
        self.pending.setSpacing(5)
        self.ledger.box.addLayout(self.pending)
        self.ledger.hide()
        col.addWidget(self.ledger)

    # ------------------------------------------------------------ size and place

    def _place(self):
        """Starts as the orb, near the top-right corner of the screen."""
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

    # ------------------------------------------------------------ orb <-> panel

    def expand(self):
        """The orb opens into the command centre, its top-right corner staying where the orb was."""
        if self.mode != "orb":
            return
        size = self._panel_size()
        face = QRect(self.pos() + QPoint(ORB_MARGIN, ORB_MARGIN), QSize(ORB, ORB))
        x, y = face.right() + 1 - WIDTH - SHADOW, face.top() - SHADOW
        screen = (self.screen() or self.window().screen()).availableGeometry()
        x = max(screen.left() - SHADOW, min(x, screen.right() + 1 + SHADOW - size.width()))
        y = max(screen.top() - SHADOW, min(y, screen.bottom() + 1 + SHADOW - size.height()))
        self._orb_face = face.topLeft() - QPoint(x, y)
        self.setFixedSize(size)
        self.move(x, y)
        self.orb.move(self._orb_face - QPoint(ORB_MARGIN, ORB_MARGIN))
        self._start_morph(+1)

    def collapse(self):
        """The command centre shrinks back into the orb at its top-right corner."""
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

    # ------------------------------------------------------------ painting the panel

    def _panel_rect(self) -> QRectF:
        return QRectF(SHADOW, SHADOW, WIDTH, self.height() - 2 * SHADOW)

    @staticmethod
    def _paint_panel(p: QPainter, rect: QRectF, radius: float, shadow: bool):
        p.setPen(Qt.NoPen)
        if shadow:
            for i in range(SHADOW, 0, -1):
                p.setBrush(QColor(0, 0, 0, int(40 * (1 - i / SHADOW) ** 2)))
                p.drawRoundedRect(rect.adjusted(-i, -i + 6, i, i + 6), radius + i, radius + i)
        body = QLinearGradient(0, rect.top(), 0, rect.bottom())
        body.setColorAt(0, QColor(30, 29, 30))
        body.setColorAt(1, QColor(19, 18, 19))
        p.setBrush(body)
        p.drawRoundedRect(rect, radius, radius)
        shape = QPainterPath()
        shape.addRoundedRect(rect, radius, radius)
        p.save()
        p.setClipPath(shape)
        weave(p, rect)
        glow = QRadialGradient(QPointF(rect.center().x(), rect.top() - 40), rect.width() * 0.9)
        glow.setColorAt(0, rgba(ROSE, 0.10))
        glow.setColorAt(1, rgba(ROSE, 0))
        p.setBrush(glow)
        p.drawRect(rect)
        p.restore()
        edge = QLinearGradient(0, rect.top(), 0, rect.bottom())
        edge.setColorAt(0, QColor(255, 236, 226, 52))
        edge.setColorAt(0.35, QColor(255, 255, 255, 16))
        edge.setColorAt(1, QColor(255, 255, 255, 10))
        p.setBrush(Qt.NoBrush)
        p.setPen(QPen(edge, 1))
        p.drawRoundedRect(rect.adjusted(0.5, 0.5, -0.5, -0.5), radius, radius)

    def _paint_backdrop(self) -> QPixmap:
        """Shadow and panel, painted once per size."""
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
            self._paint_panel(p, rect, ORB / 2 + (RADIUS - ORB / 2) * k, False)
        # orb mode: the orb paints itself

    # ------------------------------------------------------------ the Hub on this computer: who is online, what is happening

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
        """Three rings for Kovel, Marco and David; when the Hub is quiet, the last names seen, all offline."""
        if team:
            self._last_team = team
        shown = team or [{**p, "online": False, "status": "OFFLINE", "ponto": None} for p in self._last_team]
        me = self._identity(shown) if shown else None
        for i, person in enumerate(self.persons):
            person.set(shown[i] if i < len(shown) else None, bool(shown) and i < len(shown) and shown[i]["user"] == me)
            person.setVisible(i < len(shown) or not shown)
        self.hub_note.setText("Hub desligado: sem resposta do servidor." if team is None else "")
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
        """The command centre grows into the whole screen with the Hub inside (expand.py); minimizing shrinks it back."""
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
        """Tells this person when a teammate clocks in, and keeps the button in step."""
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
        self.ponto_button.set(now.get(me))

    def punch_ponto(self):
        who = self._identity(self._team or [])
        if not who:
            self.notify("Ponto", "O Hub não respondeu. Tenta outra vez daqui a pouco.")
            return
        self.ponto_button.setEnabled(False)

        def work():
            try:
                self.punched.emit(hub.punch(hub.hub_url(), who))
            except (OSError, ValueError) as e:
                self.punched.emit(str(e))

        threading.Thread(target=work, daemon=True).start()

    def _punched(self, result):
        if isinstance(result, str):
            self.ponto_button.setEnabled(True)
            self.notify("Ponto", f"Não deu para bater o ponto: {result}")
            return
        self.ponto_button.set(result["at"])
        if self._ponto_seen is not None:
            self._ponto_seen[result["user"]] = result["at"]
        for person in self.persons:
            if person.isEnabled():
                person.set({**next((t for t in self._last_team if t["user"] == result["user"]), {"name": result["name"], "online": True}),
                            "ponto": result["at"]}, True)
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
        """How things are, in one line on the dial and one dot on the orb."""
        state = self.store.get()
        status = state.get("status", "OFFLINE")
        if self._team is None:
            text, colour = "HUB DESLIGADO", COLORS["ERROR"]
        elif status == "ERROR" or state.get("error"):
            text, colour = "ERRO NO AGENTE", COLORS["ERROR"]
        elif status == "WAITING" or state.get("pending_approval"):
            text, colour = "À ESPERA DE APROVAÇÃO", COLORS["WAITING"]
        elif status == "WORKING":
            text, colour = "A TRABALHAR", COLORS["WORKING"]
        else:
            text, colour = "TUDO BEM", COLORS["ONLINE"]
        pulse = status in ("WORKING", "WAITING")
        self.dial.set_status(text, colour, pulse)
        self._status_colour, self._pulse = colour, pulse
        self.orb.set(self._load, colour, pulse)

    def _render(self, state: dict):
        status = state.get("status", "OFFLINE")
        self.on_status(status)
        name = state.get("display_name")
        self.user_label.setText(f"{name.upper()}  ·  CENTRAL DE COMANDO" if name else "CENTRAL DE COMANDO")

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
            self.bar.set(progress, COLORS["WORKING"] if progress >= 100 else ROSE)
            self.details.setText(self._details(state))
            self.details.setVisible(bool(self.details.text()))
            self.task_card.show()
        else:
            self.task_card.hide()

        self._render_usage(state)

    _load = None

    def _render_usage(self, state: dict | None = None):
        """Claude and Higgsfield credits of whoever sits here: the plan limits Claude Code reported, else the Hub's numbers."""
        state = state or self.store.get()
        hub_team = self._team or []
        who = self._identity(hub_team) or state.get("user")
        mine = next((m for m in hub_team if m.get("user") == who and "week_cost_usd" in m), None) \
            or next((m for m in state.get("team") or [] if m.get("user") == who), {})
        plan = claude_plan_usage()
        if plan:
            self._load = plan["week"]
            self.claude_session.set(plan["five"], until(plan["five_reset"]))
            self.claude_week.set(plan["week"], until(plan["week_reset"]))
            self.claude_head.note.setText(ago(plan["saved_at"]) if plan["saved_at"] else "")
        else:
            spent = mine.get("week_cost_usd") or 0
            self._load = mine.get("week_pct") if spent else None
            self.claude_session.set(None, "sem dados da sessão")
            self.claude_week.set(self._load, f"${spent:.2f} de ${mine.get('week_budget_usd', 0):.0f}" if mine else "sem dados")
            self.claude_head.note.setText("")
        self.dial.set_load(self._load)
        self.load_label.setText(f"CARGA CLAUDE  ·  {'—' if self._load is None else round(self._load)} %")
        self.higgs.set(mine.get("higgsfield_pct"))
        self.higgs_head.note.setText("NO HUB")
        self._render_state()
