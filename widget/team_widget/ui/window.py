"""The widget: a small dark panel in the style of a modern OS control centre.

Frameless, rounded, drawn with anti-aliasing, and every animation runs off one frame clock
at the monitor's refresh rate (see motion.py). Closing it hides it to the tray; the agent keeps running.
"""
import getpass
import json
import os
import threading
import time
import urllib.error
import webbrowser
from datetime import datetime
from pathlib import Path

from PySide6.QtCore import QEasingCurve, QEvent, QPointF, QRectF, QSize, Qt, QTimer, QVariantAnimation, Signal
from PySide6.QtGui import QColor, QFont, QFontMetricsF, QIcon, QLinearGradient, QPainter, QPainterPath, QPen, QPixmap, QRadialGradient
from PySide6.QtWidgets import QAbstractButton, QHBoxLayout, QLabel, QLayout, QMessageBox, QSizePolicy, QVBoxLayout, QWidget

from .. import hub
from ..api.agent_client import AgentClient
from ..state.store import StateStore
from .car import CarView
from .motion import clock

TEXT, MUTED, FAINT = "#f2f4f5", "#8a8a8a", "#4a4a4a"
ACCENT, ACCENT2 = "#e6e6e6", "#ffffff"
# quiet tones only: black, silver, and a hint of colour where a state needs one
COLORS = {"WORKING": "#9cc9a6", "ONLINE": "#9cc9a6", "IDLE": "#c8ccce", "WAITING": "#cdbb8f",
          "PAUSED": "#cdbb8f", "ERROR": "#d39a7c", "OFFLINE": "#5d5d63"}
LABELS = {"WORKING": "A trabalhar", "ONLINE": "Online", "IDLE": "Livre", "WAITING": "À espera",
          "PAUSED": "Em pausa", "ERROR": "Erro", "OFFLINE": "Agente desligado"}
WIDTH = 380            # the panel; the window adds SHADOW on every side
SHADOW = 18
RADIUS = 20
ASSETS = Path(__file__).resolve().parents[1] / "assets"
LOGO, WORDMARK = ASSETS / "logo.png", ASSETS / "amg-wordmark.png"
UI, MONO = ("Segoe UI Variable Text", "Segoe UI"), ("Cascadia Mono", "Consolas")


def hhmm(iso_time: str) -> str:
    """09:12, in this computer's time, from the Hub's ISO time."""
    return datetime.fromisoformat(iso_time).astimezone().strftime("%H:%M")


def elapsed(started_at) -> str:
    if not started_at:
        return ""
    seconds = int(time.time() - started_at)
    return f"{seconds // 3600}h {seconds % 3600 // 60:02d}m" if seconds >= 3600 else f"{seconds // 60}m {seconds % 60:02d}s"


def meter_color(pct):
    return COLORS["ERROR"] if pct >= 85 else COLORS["WAITING"] if pct >= 60 else ACCENT


def claude_plan_usage():
    """The real plan limits, saved by claude_statusline.py every time Claude Code answers: (weekly %, hint) or None."""
    try:
        saved = json.loads((hub.DATA_DIR / "claude_usage.json").read_text(encoding="utf-8"))
        limits = saved["rate_limits"]
        week = limits["seven_day"]["used_percentage"]
    except (OSError, ValueError, KeyError, TypeError):
        return None
    five = (limits.get("five_hour") or {}).get("used_percentage")
    hint = "semana" + (f" · 5h {round(five)}%" if five is not None else "")
    if time.time() - saved.get("saved_at", 0) > 6 * 3600:
        hint += " · desatualizado"
    return week, hint


def clip(text: str, n: int) -> str:
    return text if len(text) <= n else text[: n - 1] + "…"


def rgba(colour: str, alpha: float) -> QColor:
    c = QColor(colour)
    c.setAlphaF(alpha)
    return c


def font(size, weight=QFont.Normal, families=UI, spacing=0.0) -> QFont:
    f = QFont()
    f.setFamilies(list(families))
    f.setPointSizeF(size)
    f.setWeight(weight)
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
    return label(text, 7.5, colour, QFont.DemiBold, spacing=1.1)


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


# ------------------------------------------------------------------ building blocks


class Card(QWidget):
    """Rounded tile with a hairline border, like a control-centre module."""

    def __init__(self, tint: str | None = None):
        super().__init__()
        self.tint = tint
        self.box = QVBoxLayout(self)
        self.box.setContentsMargins(14, 12, 14, 13)
        self.box.setSpacing(6)

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        r = QRectF(self.rect()).adjusted(0.5, 0.5, -0.5, -0.5)
        if self.tint:
            p.setBrush(rgba(self.tint, 0.09))
            p.setPen(QPen(rgba(self.tint, 0.28), 1))
        else:
            fill = QLinearGradient(0, 0, 0, r.height())
            fill.setColorAt(0, QColor(22, 22, 24))
            fill.setColorAt(1, QColor(14, 14, 16))
            p.setBrush(fill)
            p.setPen(QPen(QColor(255, 255, 255, 17), 1))
        p.drawRoundedRect(r, 14, 14)


class Meter(QWidget):
    """Rounded progress bar that glides to its new value."""

    def __init__(self):
        super().__init__()
        self.setFixedHeight(6)
        self._shown, self._colour = 0.0, QColor(ACCENT)
        self._anim = animate(self, 700, self._set_shown)

    def _set_shown(self, value):
        self._shown = value
        self.update()

    def set(self, pct, colour=ACCENT):
        self._colour = QColor(colour)
        target = max(0, min(100, pct or 0)) / 100
        if abs(target - self._shown) > 0.001:
            self._anim.stop()
            self._anim.setStartValue(self._shown)
            self._anim.setEndValue(target)
            self._anim.start()
        self.update()

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        p.setPen(Qt.NoPen)
        h = self.height()
        p.setBrush(QColor(255, 255, 255, 20))
        p.drawRoundedRect(QRectF(0, 0, self.width(), h), h / 2, h / 2)
        if self._shown > 0:
            w = max(h, self.width() * self._shown)
            fill = QLinearGradient(0, 0, w, 0)
            fill.setColorAt(0, rgba(self._colour.name(), 0.55))
            fill.setColorAt(1, self._colour)
            p.setBrush(fill)
            p.drawRoundedRect(QRectF(0, 0, w, h), h / 2, h / 2)


class Ring(QWidget):
    """A round gauge: the arc glides to its value, the percentage sits in the middle."""
    SIZE, STROKE = 84, 8

    def __init__(self):
        super().__init__()
        self.setFixedSize(self.SIZE, self.SIZE)
        self._shown, self._pct, self._colour = 0.0, None, QColor(ACCENT)
        self._anim = animate(self, 900, self._set_shown)

    def _set_shown(self, value):
        self._shown = value
        self.update()

    def set(self, pct, colour=ACCENT):
        self._pct, self._colour = pct, QColor(colour)
        target = max(0, min(100, pct or 0)) / 100
        if abs(target - self._shown) > 0.001:
            self._anim.stop()
            self._anim.setStartValue(self._shown)
            self._anim.setEndValue(target)
            self._anim.start()
        self.update()

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        inset = self.STROKE / 2 + 3
        box = QRectF(inset, inset, self.SIZE - 2 * inset, self.SIZE - 2 * inset)
        track = QPen(QColor(255, 255, 255, 22), self.STROKE)
        track.setCapStyle(Qt.RoundCap)
        p.setPen(track)
        p.drawArc(box, 0, 360 * 16)
        if self._shown > 0:
            span = -int(360 * 16 * self._shown)                  # clockwise from the top
            glow = QPen(rgba(self._colour.name(), 0.16), self.STROKE + 6)
            glow.setCapStyle(Qt.RoundCap)
            p.setPen(glow)
            p.drawArc(box, 90 * 16, span)
            arc = QPen(self._colour, self.STROKE)
            arc.setCapStyle(Qt.RoundCap)
            p.setPen(arc)
            p.drawArc(box, 90 * 16, span)
        p.setPen(QColor(TEXT) if self._pct is not None else QColor(FAINT))
        p.setFont(font(14.5 if self._pct is not None else 13, QFont.DemiBold, MONO))
        p.drawText(QRectF(self.rect()), Qt.AlignCenter, "—" if self._pct is None else f"{round(self._pct)}%")


class Gauge(QWidget):
    """A ring with the service name and a small hint under it."""

    def __init__(self):
        super().__init__()
        col = QVBoxLayout(self)
        col.setContentsMargins(0, 2, 0, 0)
        col.setSpacing(4)
        self.ring = Ring()
        self.name = label("", 9, TEXT, QFont.DemiBold)
        self.hint = label("", 8, MUTED)
        col.addWidget(self.ring, 0, Qt.AlignHCenter)
        col.addWidget(self.name, 0, Qt.AlignHCenter)
        col.addWidget(self.hint, 0, Qt.AlignHCenter)

    def set(self, title, pct, hint):
        self.name.setText(title)
        self.hint.setText(hint)
        self.ring.set(pct, meter_color(pct or 0))


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


class PrimaryButton(Hover):
    def __init__(self, text):
        super().__init__()
        self.setText(text)
        self.setFixedHeight(42)
        self.setFont(font(8.5, QFont.Bold, spacing=1.4))

    def sizeHint(self):
        return QSize(200, 42)

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        r = QRectF(self.rect()).adjusted(1, 1, -1, -1)
        s = 1 - 0.02 * self.press
        p.translate(r.center())
        p.scale(s, s)
        p.translate(-r.center())
        if not self.isEnabled():
            p.setPen(QPen(QColor(255, 255, 255, 20), 1))
            p.setBrush(QColor(24, 24, 26))
            p.drawRoundedRect(r, 13, 13)
            p.setPen(QColor(MUTED))
        else:
            p.setPen(Qt.NoPen)
            for i in range(4, 0, -1):          # soft halo that grows on hover
                p.setBrush(QColor(255, 255, 255, int(7 * self.hover)))
                p.drawRoundedRect(r.adjusted(-i * 0.6, -i * 0.6, i * 0.6, i * 0.6), 13 + i * 0.6, 13 + i * 0.6)
            fill = QLinearGradient(0, r.top(), 0, r.bottom())
            fill.setColorAt(0, QColor(ACCENT).lighter(int(100 + 9 * self.hover)))
            fill.setColorAt(1, QColor(200, 204, 206).lighter(int(100 + 9 * self.hover)))
            p.setBrush(fill)
            p.drawRoundedRect(r, 13, 13)
            p.setPen(QColor(0, 0, 0))
        p.setFont(self.font())
        p.drawText(r, Qt.AlignCenter, self.text())


class IconButton(Hover):
    """Round title-bar button: 'hide' (a dash) or 'hub' (open full size)."""

    def __init__(self, glyph, tip):
        super().__init__()
        self.glyph = glyph
        self.setFixedSize(28, 28)
        self.setToolTip(tip)

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        p.setPen(Qt.NoPen)
        p.setBrush(QColor(255, 255, 255, int(8 + 22 * self.hover + 14 * self.press)))
        p.drawEllipse(QRectF(0.5, 0.5, 27, 27))
        c = QColor(MUTED)
        c = QColor(int(c.red() + (242 - c.red()) * self.hover), int(c.green() + (244 - c.green()) * self.hover),
                   int(c.blue() + (245 - c.blue()) * self.hover))
        pen = QPen(c, 1.5)
        pen.setCapStyle(Qt.RoundCap)
        pen.setJoinStyle(Qt.RoundJoin)
        p.setPen(pen)
        if self.glyph == "hide":
            p.drawLine(QPointF(9.5, 14), QPointF(18.5, 14))
        else:  # two corners pulling apart
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


class StatusChip(QWidget):
    """Pill with the agent's status; the dot breathes while the agent works or waits."""

    def __init__(self):
        super().__init__()
        self.setFont(font(7.5, QFont.Bold, spacing=1.0))
        self.setSizePolicy(QSizePolicy.Fixed, QSizePolicy.Fixed)
        self._text, self._colour, self._pulse, self._t = "", QColor(COLORS["OFFLINE"]), False, 0.0
        clock().frame.connect(self._frame)

    def set(self, text, colour, pulse):
        self._text, self._colour, self._pulse = text.upper(), QColor(colour), pulse
        self.updateGeometry()
        self.update()

    def _frame(self, t):
        self._t = t
        if self._pulse and self.isVisible():
            self.update()

    def sizeHint(self):
        return QSize(int(QFontMetricsF(self.font()).horizontalAdvance(self._text)) + 34, 26)

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        r = QRectF(self.rect()).adjusted(0.5, 0.5, -0.5, -0.5)
        p.setBrush(rgba(self._colour.name(), 0.10))
        p.setPen(QPen(rgba(self._colour.name(), 0.26), 1))
        p.drawRoundedRect(r, r.height() / 2, r.height() / 2)
        dot = QPointF(r.left() + 13, r.center().y())
        if self._pulse:
            wave = (self._t % 1.8) / 1.8
            glow = QRadialGradient(dot, 3 + 7 * wave)
            glow.setColorAt(0, rgba(self._colour.name(), 0.55 * (1 - wave)))
            glow.setColorAt(1, rgba(self._colour.name(), 0))
            p.setPen(Qt.NoPen)
            p.setBrush(glow)
            p.drawEllipse(dot, 3 + 7 * wave, 3 + 7 * wave)
        p.setPen(Qt.NoPen)
        p.setBrush(self._colour)
        p.drawEllipse(dot, 3.2, 3.2)
        p.setPen(self._colour)
        p.setFont(self.font())
        p.drawText(r.adjusted(22, 0, -10, 0), Qt.AlignVCenter | Qt.AlignLeft, self._text)


class Avatar(QWidget):
    def __init__(self, name: str, online: bool, clocked_in: str | None = None):
        super().__init__()
        self.setFixedSize(46, 46)
        self.initial, self.online, self.clocked_in = (name[:1] or "?").upper(), online, clocked_in
        if clocked_in:
            self.setToolTip(f"{name} bateu o ponto às {hhmm(clocked_in)}")

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        c = QPointF(22, 22)
        fill = QRadialGradient(QPointF(16, 12), 34)
        fill.setColorAt(0, QColor(44, 46, 48) if self.online else QColor(24, 24, 26))
        fill.setColorAt(1, QColor(14, 14, 16))
        p.setBrush(fill)
        p.setPen(QPen(rgba(COLORS["ONLINE"], 0.55) if self.online else QColor(255, 255, 255, 22), 1.5))
        p.drawEllipse(c, 20.5, 20.5)
        p.setPen(QColor(TEXT) if self.online else QColor("#5d5d63"))
        p.setFont(font(13, QFont.DemiBold, ("Segoe UI Variable Display", "Segoe UI")))
        p.drawText(QRectF(1, 1, 42, 42), Qt.AlignCenter, self.initial)
        dot = QPointF(37, 37)
        p.setPen(QPen(QColor(10, 10, 12), 3))
        p.setBrush(QColor(COLORS["ONLINE"] if self.online else COLORS["OFFLINE"]))
        p.drawEllipse(dot, 5.5, 5.5)
        if self.clocked_in:  # a white tick: clocked in today
            p.setPen(QPen(QColor(10, 10, 12), 2.5))
            p.setBrush(QColor("#ffffff"))
            p.drawEllipse(QPointF(37, 8), 7, 7)
            tick = QPen(QColor("#000000"), 1.6)
            tick.setCapStyle(Qt.RoundCap)
            tick.setJoinStyle(Qt.RoundJoin)
            p.setPen(tick)
            p.setBrush(Qt.NoBrush)
            path = QPainterPath(QPointF(33.8, 8.2))
            path.lineTo(36.2, 10.4)
            path.lineTo(40.2, 5.8)
            p.drawPath(path)


class PontoButton(Hover):
    """Bater o ponto: white until you clock in, then a quiet pill with the time."""

    def __init__(self):
        super().__init__()
        self.setFont(font(8.5, QFont.DemiBold))
        self.setFixedHeight(30)
        self._at = None

    def set(self, at: str | None):
        self._at = at
        self.setEnabled(not at)
        self.setCursor(Qt.ArrowCursor if at else Qt.PointingHandCursor)
        self.setText(f"Ponto  {hhmm(at)}" if at else "Bater o ponto")
        self.setFixedWidth(int(QFontMetricsF(self.font()).horizontalAdvance(self.text())) + (44 if at else 30))
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
            p.setPen(QPen(QColor(255, 255, 255, 40), 1))
            p.setBrush(Qt.NoBrush)
            p.drawRoundedRect(r, r.height() / 2, r.height() / 2)
            tick = QPen(QColor(TEXT), 1.6)
            tick.setCapStyle(Qt.RoundCap)
            tick.setJoinStyle(Qt.RoundJoin)
            p.setPen(tick)
            y = r.center().y()
            path = QPainterPath(QPointF(r.left() + 12, y))
            path.lineTo(r.left() + 15, y + 3)
            path.lineTo(r.left() + 20, y - 3)
            p.drawPath(path)
            p.setPen(QColor(TEXT))
            p.drawText(r.adjusted(26, 0, -10, 0), Qt.AlignVCenter | Qt.AlignLeft, self.text())
            return
        p.setPen(Qt.NoPen)
        p.setBrush(QColor(255, 255, 255, int(230 + 25 * self.hover)))
        p.drawRoundedRect(r, r.height() / 2, r.height() / 2)
        p.setPen(QColor("#000000"))
        p.drawText(r, Qt.AlignCenter, self.text())


class TitleBar(QWidget):
    """Drag the widget by its top; double-click opens the Hub (what maximizing did before)."""

    def __init__(self, on_double_click):
        super().__init__()
        self._on_double_click = on_double_click

    def mousePressEvent(self, e):
        if e.button() == Qt.LeftButton and self.window().windowHandle():
            self.window().windowHandle().startSystemMove()

    def mouseDoubleClickEvent(self, e):
        if e.button() == Qt.LeftButton:
            self._on_double_click()


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
        self._backdrop = None
        self._usage_at = 0.0

        self.setWindowTitle("Agente AMG")
        self.setWindowIcon(QIcon(str(LOGO)))
        self.setAttribute(Qt.WA_TranslucentBackground)
        outer = QVBoxLayout(self)
        outer.setSizeConstraint(QLayout.SetFixedSize)
        outer.setContentsMargins(SHADOW, SHADOW, SHADOW, SHADOW)
        panel = QWidget()
        panel.setFixedWidth(WIDTH)
        outer.addWidget(panel)
        col = QVBoxLayout(panel)
        col.setContentsMargins(16, 12, 16, 16)
        col.setSpacing(10)

        # title bar: wordmark, hub and hide; under it who this is and the agent's status
        bar = TitleBar(self._open_hub)
        rows = QVBoxLayout(bar)
        rows.setContentsMargins(2, 0, 0, 0)
        rows.setSpacing(8)
        row = QHBoxLayout()
        row.setSpacing(6)
        mark = QLabel()
        dpr = self.devicePixelRatioF()
        pix = QPixmap(str(WORDMARK)).scaledToHeight(int(round(11 * dpr)), Qt.SmoothTransformation)
        pix.setDevicePixelRatio(dpr)
        mark.setPixmap(pix)
        mark.setStyleSheet("background: transparent;")
        row.addWidget(mark, 0, Qt.AlignVCenter)
        row.addStretch(1)
        hub_button = IconButton("hub", "Abrir o Hub")
        hub_button.clicked.connect(self._open_hub)
        row.addWidget(hub_button, 0, Qt.AlignVCenter)
        hide_button = IconButton("hide", "Esconder (o agente continua)")
        hide_button.clicked.connect(self.hide_panel)
        row.addWidget(hide_button, 0, Qt.AlignVCenter)
        rows.addLayout(row)
        row = QHBoxLayout()
        self.user_label = caption("CENTRAL DE COMANDO")
        row.addWidget(self.user_label, 0, Qt.AlignVCenter)
        row.addStretch(1)
        self.chip = StatusChip()
        row.addWidget(self.chip, 0, Qt.AlignVCenter)
        rows.addLayout(row)
        col.addWidget(bar)

        self.car = CarView()
        col.addWidget(self.car)

        # who is online: one avatar per person, and the daily clock-in
        team_row = QHBoxLayout()
        self.people = QWidget()
        self.people_row = QHBoxLayout(self.people)
        self.people_row.setContentsMargins(2, 0, 0, 0)
        self.people_row.setSpacing(16)
        team_row.addWidget(self.people, 1)
        self.ponto_button = PontoButton()
        self.ponto_button.set(None)
        self.ponto_button.clicked.connect(self.punch_ponto)
        team_row.addWidget(self.ponto_button, 0, Qt.AlignVCenter)
        col.addLayout(team_row)

        # credits: Claude and Higgsfield, always there (a dash until the Hub has numbers)
        self.use_card = Card()
        self.use_card.box.addWidget(caption("CRÉDITOS DA SEMANA"))
        gauges = QHBoxLayout()
        self.claude_gauge, self.higgs_gauge = Gauge(), Gauge()
        gauges.addWidget(self.claude_gauge, 1)
        gauges.addWidget(self.higgs_gauge, 1)
        self.use_card.box.addLayout(gauges)
        col.addWidget(self.use_card)

        self.alert = Card(COLORS["WAITING"])
        self.alert_text = label("", 9, COLORS["WAITING"], wrap=True)
        self.alert.box.addWidget(self.alert_text)
        self.alert.box.setContentsMargins(14, 10, 14, 10)
        self.alert.hide()
        col.addWidget(self.alert)

        # what people are touching right now (the weekly table and calendar live in the Hub)
        self.ledger = Card()
        self.ledger.box.addWidget(caption("A MEXER AGORA · SEM COMMIT"))
        self.pending = QVBoxLayout()
        self.pending.setSpacing(5)
        self.ledger.box.addLayout(self.pending)
        col.addWidget(self.ledger)

        # the agent's current task, only while there is one
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

        col.addSpacing(2)
        self.open_hub = PrimaryButton("ABRIR O HUB")
        self.open_hub.clicked.connect(self._open_hub)
        col.addWidget(self.open_hub)

        self._render_people(self._team)
        self._render_week({})
        self._fade = animate(self, 220, self.setWindowOpacity)
        self._fade.finished.connect(self._fade_done)
        self._place()
        threading.Thread(target=self._poll_hub, daemon=True).start()
        self._ticker = QTimer(self)
        self._ticker.timeout.connect(self._tick)
        self._ticker.start(500)
        self._tick()

    # ------------------------------------------------------------ building blocks

    def _place(self):
        self.adjustSize()
        screen = self.screen().availableGeometry()
        self.move(screen.right() - self.width() + SHADOW - 24, screen.top() + 60 - SHADOW)

    @staticmethod
    def _clear(layout):
        while layout.count():
            item = layout.takeAt(0)
            if item.widget():
                item.widget().deleteLater()
            elif item.layout():
                WidgetWindow._clear(item.layout())

    # ------------------------------------------------------------ the panel itself

    def _paint_backdrop(self) -> QPixmap:
        """Shadow and panel, painted once per size."""
        dpr = self.devicePixelRatioF()
        pix = QPixmap(int(self.width() * dpr), int(self.height() * dpr))
        pix.setDevicePixelRatio(dpr)
        pix.fill(Qt.transparent)
        p = QPainter(pix)
        p.setRenderHint(QPainter.Antialiasing)
        panel = QRectF(self.rect()).adjusted(SHADOW, SHADOW, -SHADOW, -SHADOW)
        p.setPen(Qt.NoPen)
        for i in range(SHADOW, 0, -1):
            p.setBrush(QColor(0, 0, 0, int(34 * (1 - i / SHADOW) ** 2)))
            p.drawRoundedRect(panel.adjusted(-i, -i + 5, i, i + 5), RADIUS + i, RADIUS + i)
        p.setBrush(QColor(7, 7, 8))
        p.drawRoundedRect(panel, RADIUS, RADIUS)
        glow = QRadialGradient(QPointF(panel.left() + panel.width() * 0.12, panel.top() - 30), panel.width() * 0.95)
        glow.setColorAt(0, QColor(200, 204, 206, 26))
        glow.setColorAt(1, QColor(200, 204, 206, 0))
        p.setBrush(glow)
        p.drawRoundedRect(panel, RADIUS, RADIUS)
        p.setBrush(Qt.NoBrush)
        edge = QLinearGradient(0, panel.top(), 0, panel.bottom())
        edge.setColorAt(0, QColor(255, 255, 255, 46))
        edge.setColorAt(0.4, QColor(255, 255, 255, 16))
        edge.setColorAt(1, QColor(255, 255, 255, 12))
        p.setPen(QPen(edge, 1))
        p.drawRoundedRect(panel.adjusted(0.5, 0.5, -0.5, -0.5), RADIUS, RADIUS)
        p.end()
        return pix

    def paintEvent(self, e):
        if self._backdrop is None or self._backdrop.deviceIndependentSize().toSize() != self.size():
            self._backdrop = self._paint_backdrop()
        p = QPainter(self)
        p.setCompositionMode(QPainter.CompositionMode_Source)
        p.setClipRegion(e.region())
        p.drawPixmap(0, 0, self._backdrop)

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
        self._clear(self.people_row)
        if team is None:
            self.people_row.addWidget(label("Hub desligado", 8.5, MUTED))
            self.people_row.addStretch(1)
            return
        states = {"WORKING": "a trabalhar", "WAITING": "à espera", "PAUSED": "em pausa", "ERROR": "erro", "IDLE": "livre"}
        for person in team:
            on = person["online"]
            cell = QVBoxLayout()
            cell.setSpacing(2)
            cell.addWidget(Avatar(person["name"], on, person.get("ponto")), 0, Qt.AlignHCenter)
            cell.addSpacing(3)
            cell.addWidget(label(clip(person["name"], 10), 8.5, TEXT if on else FAINT, QFont.DemiBold), 0, Qt.AlignHCenter)
            cell.addWidget(label(states.get(person["status"], "online") if on else "offline", 7.5,
                                 COLORS["ONLINE"] if on else FAINT), 0, Qt.AlignHCenter)
            self.people_row.addLayout(cell)
        self.people_row.addStretch(1)

    def _render_week(self, w: dict):
        self._clear(self.pending)
        for p in w.get("pending", [])[:3]:
            row = QHBoxLayout()
            row.setSpacing(8)
            ago = max(0, int(time.time() - (p["newest"] or time.time())) // 60)
            when = "agora" if ago < 1 else f"{ago} min" if ago < 60 else f"{ago // 60} h"
            name = label(clip(p["repo"], 16), 9, TEXT, QFont.DemiBold)
            name.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Preferred)
            row.addWidget(name)
            row.addWidget(label(f"{p['count']} fich  +{p['added']} −{p['deleted']}", 8.5, MUTED, families=MONO))
            row.addWidget(label(when, 8.5, FAINT))
            self.pending.addLayout(row)
        if not w.get("pending"):
            self.pending.addWidget(label("Nada por guardar.", 9, FAINT))

    # ------------------------------------------------------------ actions

    def show_panel(self, fade=True):
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
            self.hide_panel()
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
        self.open_hub.setText("A ABRIR…")
        self.open_hub.setEnabled(False)

        def work():  # starting the server can take a few seconds
            error = hub.ready()
            session = None if error else self.client.hub_session()
            self.hub_ready.emit((error, hub.hub_url() + (f"/#login={session}" if session else "")))

        threading.Thread(target=work, daemon=True).start()

    def _hub_opened(self, result):
        error, url = result
        self._opening_hub = False
        self.open_hub.setText("ABRIR O HUB")
        self.open_hub.setEnabled(True)
        if error:
            self.show_panel()
            QMessageBox.warning(self, "Hub", error)
            return
        if self._expander is None:  # made on first use: the web engine is heavy and most sessions never open it
            from .expand import HubExpander
            self._expander = HubExpander()
            self._expander.collapsed.connect(lambda: self.show_panel(fade=False))
        panel = self.geometry().adjusted(SHADOW, SHADOW, -SHADOW, -SHADOW)
        self._expander.expand(panel, url)
        self.hide()  # the expander starts exactly on top of the panel

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

    def _render(self, state: dict):
        status = state.get("status", "OFFLINE")
        self.on_status(status)
        self.car.set_status(status)
        self.chip.set(LABELS.get(status, status), COLORS.get(status, MUTED), status in ("WORKING", "WAITING"))
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
            self.bar.set(progress, COLORS["WORKING"] if progress >= 100 else ACCENT)
            self.details.setText(self._details(state))
            self.details.setVisible(bool(self.details.text()))
            self.task_card.show()
        else:
            self.task_card.hide()

        self._render_usage(state)

    def _render_usage(self, state: dict | None = None):
        """Claude and Higgsfield credits of whoever sits here: from the Hub's team list, else from the agent's own report."""
        state = state or self.store.get()
        hub_team = self._team or []
        who = self._identity(hub_team) or state.get("user")
        mine = next((m for m in hub_team if m.get("user") == who and "week_cost_usd" in m), None)             or next((m for m in state.get("team") or [] if m.get("user") == who), {})
        spent = mine.get("week_cost_usd") or 0
        plan = claude_plan_usage()
        if plan:
            self.claude_gauge.set("Claude", plan[0], plan[1])
        else:
            self.claude_gauge.set("Claude", mine.get("week_pct") if spent else None,
                                  f"${spent:.2f} / ${mine.get('week_budget_usd', 0):.0f}" if mine else "sem dados")
        self.higgs_gauge.set("Higgsfield", mine.get("higgsfield_pct"), "créditos")
