"""The widget, in three sizes: a start button on the desktop, the cockpit (a tall panel), and the Hub.

Press the start button and it grows into the cockpit; the cockpit's ⤢ grows into the Hub (expand.py); ▾ shrinks
it back. The look is a luxury car's dashboard screen: black glass, white type, grey, nothing else. The AMG badge
and the three-pointed star are the official vector marks (badge.py: assets/amg-logo.svg, assets/mercedes-star.svg). The cockpit is laid out
like iOS widgets: the hero card (time, date, how things are, the star), the Claude and Higgsfield limits as lines, three round dials for this PC
(processor, memory, battery), and the team as a list.
Every animation runs off one frame clock at the monitor's refresh rate (motion.py).
"""
import getpass
import math
import os
import threading
import time
import urllib.error
import webbrowser
from datetime import datetime
from pathlib import Path

from PySide6.QtCore import QByteArray, QEasingCurve, QEvent, QPoint, QPointF, QRect, QRectF, QSize, Qt, QTimer, QVariantAnimation, Signal
from PySide6.QtGui import (QColor, QConicalGradient, QFont, QFontMetricsF, QIcon, QImage, QLinearGradient, QPainter, QPainterPath,
                           QPen, QPixmap, QPolygonF, QRadialGradient)
from PySide6.QtSvg import QSvgRenderer
from PySide6.QtWidgets import (QAbstractButton, QFrame, QGraphicsOpacityEffect, QHBoxLayout, QLabel, QLayout, QMessageBox, QSizePolicy,
                               QVBoxLayout, QWidget)

from .. import hub
from ..api.agent_client import AgentClient
from ..limits import claude_plan_usage, refresh_from_account
from ..state.store import StateStore
from . import badge, prefs
from .motion import clock
from .notice import Notices, Presence

TEXT, MUTED, FAINT = "#f2f3f5", "#8d9198", "#4e5258"
WHITE, RED = "#ffffff", "#e5534b"
ACCENT = WHITE
COLORS = {"WORKING": "#7fd492", "ONLINE": "#7fd492", "IDLE": "#c8ccce", "WAITING": "#e3bd6b",
          "PAUSED": "#e3bd6b", "ERROR": RED, "OFFLINE": "#5b5f65"}
LABELS = {"WORKING": "A trabalhar", "ONLINE": "Online", "IDLE": "Livre", "WAITING": "À espera",
          "PAUSED": "Em pausa", "ERROR": "Erro", "OFFLINE": "Agente desligado"}
WIDTH = 340            # the cockpit; the window adds SHADOW on every side
INNER = WIDTH - 28     # what the modules get
SHADOW = 18
RADIUS = 24
GROW, SHRINK = 0.42, 0.32   # seconds
NOTES_IN_WIDGET = False     # the list of notifications inside the widget: off since 6 Oct, nobody read it there (they are in the Hub's bell)
CLOCK_PILL = 74             # width of the Parar / Retomar button in your own row
COMMITS_EVERY = 8           # Hub polls (4 s each) between two looks at the last commits: every half minute
ACCOUNT_EVERY = 75          # Hub polls (4 s each) between two looks at the Claude account's usage: every 5 minutes
ASSETS = Path(__file__).resolve().parents[1] / "assets"
LOGO = ASSETS / "logo.png"
UI, MONO = ("Segoe UI Variable Text", "Segoe UI"), ("Cascadia Mono", "Consolas")
DISPLAY = ("Segoe UI Variable Display", "Segoe UI")
WEEKDAYS = ["segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado", "domingo"]
MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"]


def hhmm(iso_time: str) -> str:
    """09:12, in this computer's time, from the Hub's ISO time."""
    return datetime.fromisoformat(iso_time).astimezone().strftime("%H:%M")


def worked(iso_time: str) -> str:
    """3h 25, the time since they clocked in today: what the team looks at is how long, not since when."""
    minutes = max(0, int((datetime.now().astimezone() - datetime.fromisoformat(iso_time).astimezone()).total_seconds())) // 60
    return f"{minutes // 60}h {minutes % 60:02d}"


def worked_of(person: dict) -> str:
    """3h 25 worked today: the stretches the clock already ran, plus the one running now. It stands still while stopped."""
    state = person.get("ponto_state")
    if not state:   # a Hub from before the clock could stop
        return worked(person["ponto"])
    seconds = int(state.get("worked_s") or 0)
    if state.get("running") and state.get("since"):
        seconds += max(0, int((datetime.now().astimezone() - datetime.fromisoformat(state["since"]).astimezone()).total_seconds()))
    return f"{seconds // 3600}h {seconds % 3600 // 60:02d}"


def clock_runs(person: dict) -> bool:
    return bool(person.get("ponto")) and (person.get("ponto_state") or {}).get("running", True)


def elapsed(started_at) -> str:
    if not started_at:
        return ""
    seconds = int(time.time() - started_at)
    return f"{seconds // 3600}h {seconds % 3600 // 60:02d}m" if seconds >= 3600 else f"{seconds // 60}m {seconds % 60:02d}s"


def ago(epoch: float) -> str:
    m = max(0, int(time.time() - epoch) // 60)
    return "agora" if m < 1 else f"há {m} min" if m < 60 else f"há {m // 60} h" if m < 1440 else f"há {m // 1440} d"


def ago_iso(iso_time: str | None) -> str:
    try:
        return ago(datetime.fromisoformat(iso_time).timestamp()) if iso_time else ""
    except ValueError:
        return ""


def until(epoch: float | None) -> str:
    if not epoch:
        return ""
    s = max(0, int(epoch - time.time()))
    d, h, m = s // 86400, s % 86400 // 3600, s % 3600 // 60
    return f"renova em {d}d {h}h" if d else f"renova em {h}h {m:02d}m" if h else f"renova em {m} min"


def meter_color(pct):
    return COLORS["ERROR"] if pct >= 85 else COLORS["WAITING"] if pct >= 60 else WHITE


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


def paint_star(p: QPainter, rect: QRectF, opacity=1.0, shadow=False):
    """The Mercedes star (vector, chrome) in `rect`."""
    badge.star(p, rect, opacity, shadow)


def studio(p: QPainter, rect: QRectF):
    """The background: black glass with a light from above and a faint floor, the corners falling into dark."""
    w, h = rect.width(), rect.height()
    body = QLinearGradient(0, rect.top(), 0, rect.bottom())
    body.setColorAt(0, QColor(13, 13, 15))
    body.setColorAt(0.6, QColor(7, 7, 8))
    body.setColorAt(1, QColor(9, 9, 10))
    p.fillRect(rect, body)
    glow_disc(p, QPointF(rect.center().x(), rect.top() - 30), w * 0.85, h * 0.4, "#ffffff", 0.06)
    glow_disc(p, QPointF(rect.center().x(), rect.bottom() + 10), w * 0.75, h * 0.18, "#ffffff", 0.05)
    vignette = QRadialGradient(rect.center(), max(w, h) * 0.75)
    vignette.setColorAt(0.55, QColor(0, 0, 0, 0))
    vignette.setColorAt(1, QColor(0, 0, 0, 110))
    p.fillRect(rect, vignette)


def ease(k: float) -> float:
    return 1 - (1 - k) ** 3


# ------------------------------------------------------------------ building blocks


class Glide:
    """A number that slides to its new value, for bars."""

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


def platter(p: QPainter, rect: QRectF, radius=18.0):
    """The iOS module look: a dark rounded plate with a hairline edge."""
    p.setPen(QPen(QColor(255, 255, 255, 13), 1))
    p.setBrush(QColor(24, 24, 26, 215))
    p.drawRoundedRect(rect.adjusted(0.5, 0.5, -0.5, -0.5), radius, radius)


class Card(QWidget):
    """A module for what only shows up sometimes: an alert, a task, unsaved work."""

    def __init__(self, tint: str | None = None):
        super().__init__()
        self.tint = tint
        self.box = QVBoxLayout(self)
        self.box.setContentsMargins(14, 11, 14, 12)
        self.box.setSpacing(6)

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        if self.tint:
            r = QRectF(self.rect()).adjusted(0.5, 0.5, -0.5, -0.5)
            p.setBrush(rgba(self.tint, 0.09))
            p.setPen(QPen(rgba(self.tint, 0.28), 1))
            p.drawRoundedRect(r, 18, 18)
        else:
            platter(p, QRectF(self.rect()))


# the Hub's own icons (frontend/app.js, hub/ui.js): a notification looks the same in the cockpit and in the Hub
NOTE_GLYPHS = {
    "task_new": '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 12l3 3 5-6"/>',
    "task": '<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>',
    "approval_required": '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17v.5"/>',
    "approval_decided": '<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>',
    "agent_failed": '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17v.5"/>',
    "agent_waiting": '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
}
BELL = '<path d="M6 17V11a6 6 0 1112 0v6l2 2H4z"/><path d="M10 21a2 2 0 004 0"/>'
_note_icons: dict[tuple, QPixmap] = {}


def note_icon(kind: str | None, size: int, dpr: float) -> QPixmap:
    """A notification's icon on a dark disc with a chrome ring, as in the Hub; drawn once per kind and screen density."""
    key = (kind, size, round(dpr, 2))
    if key not in _note_icons:
        pix = QPixmap(round(size * dpr), round(size * dpr))
        pix.setDevicePixelRatio(dpr)
        pix.fill(Qt.transparent)
        p = QPainter(pix)
        p.setRenderHint(QPainter.Antialiasing)
        disc = QRadialGradient(QPointF(size / 2, size * 0.3), size * 0.7)
        disc.setColorAt(0, QColor("#2b3036"))
        disc.setColorAt(1, QColor("#0c0d10"))
        p.setBrush(disc)
        p.setPen(QPen(QColor(222, 229, 238, 70), 1))
        p.drawEllipse(QRectF(0.5, 0.5, size - 1, size - 1))
        svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#e8ecf0" stroke-width="1.9" '
               f'stroke-linecap="round" stroke-linejoin="round">{NOTE_GLYPHS.get(kind, BELL)}</svg>')
        QSvgRenderer(QByteArray(svg.encode())).render(p, QRectF(size * 0.26, size * 0.26, size * 0.48, size * 0.48))
        p.end()
        _note_icons[key] = pix
    return _note_icons[key]


class Elided(QLabel):
    """One line of text that ends in "…" when it does not fit, and never widens what holds it."""

    def __init__(self, size, colour, weight=QFont.Normal):
        super().__init__()
        self._full = ""
        self.setFont(font(size, weight, UI))
        recolour(self, colour)
        self.setSizePolicy(QSizePolicy.Ignored, QSizePolicy.Fixed)

    def set_full(self, text: str):
        self._full = text
        self._elide()

    def resizeEvent(self, e):
        super().resizeEvent(e)
        self._elide()

    def _elide(self):
        self.setText(QFontMetricsF(self.font()).elidedText(self._full, Qt.ElideRight, max(0, self.width())))


class NoticeRow(QFrame):
    """One notification in the cockpit's mini history, on two short lines that never grow: what happened, and when.
    Click: open it. ×: delete it."""
    clicked = Signal()
    dismissed = Signal()
    H = 40

    def __init__(self):
        super().__init__()
        self.item = None
        self.setObjectName("notice")
        self.setAttribute(Qt.WA_Hover)
        self.setCursor(Qt.PointingHandCursor)
        self.setFixedHeight(self.H)
        self.setStyleSheet("QFrame#notice { background: transparent; border-radius: 10px; }"
                           "QFrame#notice:hover { background: rgba(255, 255, 255, 16); }")
        row = QHBoxLayout(self)
        row.setContentsMargins(6, 4, 3, 4)
        row.setSpacing(8)
        self.icon = QLabel()
        self.icon.setFixedSize(22, 22)
        self.icon.setStyleSheet("background: transparent;")
        row.addWidget(self.icon, 0, Qt.AlignVCenter)
        text = QVBoxLayout()
        text.setSpacing(0)
        self.title = Elided(9, TEXT, QFont.DemiBold)
        self.meta = Elided(8, MUTED)
        text.addWidget(self.title)
        text.addWidget(self.meta)
        row.addLayout(text, 1)
        self.bin = Dismiss("Apagar esta notificação")
        self.bin.clicked.connect(lambda: self.dismissed.emit())
        row.addWidget(self.bin, 0, Qt.AlignVCenter)

    def show_item(self, item: dict):
        self.item = item
        self.icon.setPixmap(note_icon(item.get("kind"), 22, self.devicePixelRatioF()))
        read = bool(item.get("read"))                              # already read: still in the history, dimmed
        self.title.setFont(font(9, QFont.Normal if read else QFont.DemiBold, UI))
        recolour(self.title, MUTED if read else TEXT)
        title = item.get("title") or ""
        body = (item.get("body") or "").strip().split("\n")[0]
        when = ago_iso(item.get("created_at"))
        self.title.set_full(title)
        self.meta.set_full(f"{when} · {body}" if body else when)
        self.setToolTip(title + (f"\n{body}" if body else ""))   # the whole text, when a line had to be cut

    def mousePressEvent(self, e):
        if e.button() == Qt.LeftButton:
            self.clicked.emit()


class Platter(QWidget):
    """An iOS module with a title (and a note on the right) inside it, then its content."""

    def __init__(self, title: str = "", note: str = ""):
        super().__init__()
        self.box = QVBoxLayout(self)
        self.box.setContentsMargins(14, 12, 14, 8)
        self.box.setSpacing(4)
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
        platter(p, QRectF(self.rect()))


class Meter(QWidget):
    """A hairline progress bar that glides to its new value."""

    def __init__(self, height=3):
        super().__init__()
        self.setFixedHeight(height)
        self._colour = QColor(WHITE)
        self._glide = Glide(self, 800)

    def set(self, pct, colour=WHITE):
        self._colour = QColor(colour)
        self._glide.to(max(0, min(100, pct or 0)) / 100)
        self.update()

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        p.setPen(Qt.NoPen)
        h = self.height()
        p.setBrush(QColor(255, 255, 255, 18))
        p.drawRoundedRect(QRectF(0, 0, self.width(), h), h / 2, h / 2)
        if self._glide.value > 0:
            p.setBrush(self._colour)
            p.drawRoundedRect(QRectF(0, 0, max(h, self.width() * self._glide.value), h), h / 2, h / 2)


class Hover(QAbstractButton):
    """A button whose hover and press states fade instead of snapping, and that answers a click with a wave
    spreading from under the finger."""

    def __init__(self):
        super().__init__()
        self.setCursor(Qt.PointingHandCursor)
        self.hover = self.press = 0.0
        self.wave, self._wave_at, self._wave_reach = 1.0, QPointF(), 0.0
        self._wave = animate(self, 460, lambda v: self._set("wave", v))
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

    def mousePressEvent(self, e):
        if e.button() == Qt.LeftButton:
            at = e.position()
            self._wave_at = at
            self._wave_reach = math.hypot(max(at.x(), self.width() - at.x()), max(at.y(), self.height() - at.y()))
            self._to(self._wave, 0.0, 1)
        super().mousePressEvent(e)

    def paint_wave(self, p: QPainter, shape: QPainterPath, colour=WHITE, strength=0.26):
        """The click wave, kept inside the button's own shape."""
        if not 0 < self.wave < 1:
            return
        p.save()
        p.setClipPath(shape)
        p.setPen(Qt.NoPen)
        p.setBrush(rgba(colour, strength * (1 - self.wave)))
        r = self._wave_reach * (0.15 + 0.85 * self.wave)
        p.drawEllipse(self._wave_at, r, r)
        p.restore()

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
        disc = QPainterPath()
        disc.addEllipse(QRectF(1, 1, 26, 26))
        self.paint_wave(p, disc)
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


class TextButton(Hover):
    """A small pill with a word on it: the task's controls."""

    def __init__(self, text, tip="", colour=TEXT):
        super().__init__()
        self._text, self._colour, self._font = text, colour, font(8.5, QFont.DemiBold, UI)
        self.setToolTip(tip)
        self.setCursor(Qt.PointingHandCursor)
        self.setFixedSize(round(QFontMetricsF(self._font).horizontalAdvance(text)) + 22, 24)

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        r = QRectF(self.rect()).adjusted(.5, .5, -.5, -.5)
        p.setPen(pen(rgba(self._colour, .28), 1))
        p.setBrush(rgba(self._colour, .07 + .09 * self.hover + .08 * self.press))
        p.drawRoundedRect(r, 12, 12)
        pill = QPainterPath()
        pill.addRoundedRect(r, 12, 12)
        self.paint_wave(p, pill, self._colour)
        p.setPen(QColor(self._colour))
        p.setFont(self._font)
        p.drawText(r, Qt.AlignCenter, self._text)

    def set_text(self, text, colour=None):
        """Another word (and colour) on the same pill, which takes the new word's width."""
        self._text, self._colour = text, colour or self._colour
        self.setFixedSize(round(QFontMetricsF(self._font).horizontalAdvance(text)) + 22, 24)
        self.update()


class Dismiss(Hover):
    """The small × that deletes one notification."""

    def __init__(self, tip):
        super().__init__()
        self.setFixedSize(22, 22)
        self.setToolTip(tip)

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        p.setPen(Qt.NoPen)
        p.setBrush(QColor(255, 255, 255, int(16 * self.hover + 12 * self.press)))
        p.drawEllipse(QRectF(1, 1, 20, 20))
        disc = QPainterPath()
        disc.addEllipse(QRectF(1, 1, 20, 20))
        self.paint_wave(p, disc)
        v = int(120 + 120 * self.hover)
        p.setPen(pen(QColor(v, v + 3, v + 6), 1.4))
        p.drawLine(QPointF(8, 8), QPointF(14, 14))
        p.drawLine(QPointF(14, 8), QPointF(8, 14))


class Badge(QWidget):
    """The chrome AMG badge as a widget."""

    def __init__(self, height: float):
        super().__init__()
        self._h = height
        self.setFixedSize(int(math.ceil(badge.width(height))) + 2, int(math.ceil(height)) + 2)

    def paintEvent(self, _):
        p = QPainter(self)
        badge.paint(p, 1, 1, self._h)


class Hero(QWidget):
    """The main card: the time, the date and how things are on the left; the star on the right, with a slow
    glint of light passing over it."""
    H = 168

    def __init__(self):
        super().__init__()
        self.setFixedSize(INNER, self.H)
        self._status, self._status_colour, self._pulse = "Tudo bem", QColor(COLORS["ONLINE"]), False
        self._note = ""
        self._f_time, self._f_date, self._f_state, self._f_note = (font(34, QFont.DemiBold, DISPLAY), font(9, QFont.Normal, UI),
                                                                   font(8.5, QFont.DemiBold, UI), font(8, QFont.Normal, UI))
        self._card = None
        clock().frame.connect(self._frame)

    def set_status(self, text, colour, pulse=False, note=""):
        self._status, self._status_colour, self._pulse, self._note = text, QColor(colour), pulse, note
        self.update()

    def _frame(self, _):
        if self.isVisible():
            self.update()

    def _star_rect(self) -> QRectF:
        s = self.H - 12
        return QRectF(self.width() - s - 8, (self.H - s) / 2, s, s)

    def _build_card(self) -> QPixmap:
        dpr = self.devicePixelRatioF()
        pix = QPixmap(int(self.width() * dpr), int(self.H * dpr))
        pix.setDevicePixelRatio(dpr)
        pix.fill(Qt.transparent)
        p = QPainter(pix)
        p.setRenderHint(QPainter.Antialiasing)
        r = QRectF(0, 0, self.width(), self.H)
        shape = QPainterPath()
        shape.addRoundedRect(r, 20, 20)
        p.setClipPath(shape)
        p.fillRect(r, QColor(0, 0, 0))
        paint_star(p, self._star_rect())
        fade = QLinearGradient(0, 0, self.width(), 0)     # the star fades into black behind the text
        fade.setColorAt(0.0, QColor(0, 0, 0, 255))
        fade.setColorAt(0.45, QColor(0, 0, 0, 200))
        fade.setColorAt(0.6, QColor(0, 0, 0, 0))
        p.fillRect(r, fade)
        p.setClipping(False)
        p.setPen(QPen(QColor(255, 255, 255, 16), 1))
        p.setBrush(Qt.NoBrush)
        p.drawRoundedRect(r.adjusted(0.5, 0.5, -0.5, -0.5), 20, 20)
        p.end()
        return pix

    def resizeEvent(self, e):
        self._card = None
        super().resizeEvent(e)

    def paintEvent(self, _):
        if self._card is None:
            self._card = self._build_card()
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        p.drawPixmap(0, 0, self._card)
        t = time.time()
        # a glint passes over the star every nine seconds, slowly
        phase = (t % 9.0) / 3.2
        if phase < 1:
            sr = self._star_rect()
            x = sr.left() - 60 + (sr.width() + 120) * (phase * phase * (3 - 2 * phase))
            glint = QLinearGradient(QPointF(x - 40, sr.bottom()), QPointF(x + 40, sr.top()))
            glint.setColorAt(0, QColor(255, 255, 255, 0))
            glint.setColorAt(0.5, QColor(255, 255, 255, 34))
            glint.setColorAt(1, QColor(255, 255, 255, 0))
            ring = QPainterPath()
            ring.addEllipse(sr.adjusted(sr.width() * 0.09, sr.height() * 0.09, -sr.width() * 0.09, -sr.height() * 0.09))
            p.save()
            p.setClipPath(ring)
            p.fillRect(sr, glint)
            p.restore()
        now = datetime.now()
        p.setPen(QColor(TEXT))
        p.setFont(self._f_time)
        p.drawText(QRectF(20, 22, 220, 52), Qt.AlignLeft | Qt.AlignVCenter, now.strftime("%H:%M"))
        p.setPen(QColor(MUTED))
        p.setFont(self._f_date)
        p.drawText(QRectF(21, 74, 220, 18), Qt.AlignLeft | Qt.AlignVCenter,
                   f"{WEEKDAYS[now.weekday()].capitalize()}, {now.day} de {MONTHS[now.month - 1]}")
        f = self._f_state
        w = QFontMetricsF(f).horizontalAdvance(self._status) + 30
        chip = QRectF(20, 106, w, 24)
        p.setPen(Qt.NoPen)
        p.setBrush(QColor(255, 255, 255, 20))
        p.drawRoundedRect(chip, 12, 12)
        glow = 0.5 + 0.5 * math.sin(t * 2 * math.pi / 2.2) if self._pulse else 1.0
        p.setBrush(rgba(self._status_colour.name(), 0.4 + 0.6 * glow))
        p.drawEllipse(QPointF(chip.left() + 13, chip.center().y()), 3.2, 3.2)
        p.setPen(QColor(TEXT))
        p.setFont(f)
        p.drawText(chip.adjusted(22, 0, -8, 0), Qt.AlignVCenter | Qt.AlignLeft, self._status)
        if self._note:
            p.setPen(QColor(FAINT))
            p.setFont(self._f_note)
            p.drawText(QRectF(21, 136, 220, 16), Qt.AlignLeft | Qt.AlignVCenter, self._note)


class Line(QWidget):
    """One limit as a line: what it is on the left, the note and the number on the right, the bar underneath."""
    H = 34

    def __init__(self, title):
        super().__init__()
        self.setFixedHeight(self.H)
        self._title, self._pct, self._value, self._note = title, None, "—", ""
        self._glide = Glide(self, 900)
        self._f_title, self._f_value, self._f_note = font(8.5, QFont.DemiBold, UI), font(10.5, QFont.DemiBold, DISPLAY), font(7.5, QFont.Normal, UI)

    def set(self, pct, value: str, note=""):
        self._pct, self._value, self._note = pct, value, note
        self._glide.to(max(0, min(100, pct or 0)) / 100)
        self.update()

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        w = self.width()
        p.setPen(QColor(MUTED))
        p.setFont(self._f_title)
        p.drawText(QRectF(0, 2, w, 18), Qt.AlignLeft | Qt.AlignVCenter, self._title)
        p.setPen(QColor(TEXT) if self._pct is not None else QColor(FAINT))
        p.setFont(self._f_value)
        p.drawText(QRectF(0, 2, w, 18), Qt.AlignRight | Qt.AlignVCenter, self._value)
        p.setPen(QColor(FAINT))
        p.setFont(self._f_note)
        p.drawText(QRectF(0, 2, w - 44, 18), Qt.AlignRight | Qt.AlignVCenter, self._note)
        bar = QRectF(0, 25, w, 3)
        p.setPen(Qt.NoPen)
        p.setBrush(QColor(255, 255, 255, 18))
        p.drawRoundedRect(bar, 1.5, 1.5)
        if self._glide.value > 0.002:
            p.setBrush(QColor(meter_color(self._pct or 0)))
            p.drawRoundedRect(QRectF(0, bar.top(), max(3, w * self._glide.value), 3), 1.5, 1.5)


class Dial(QWidget):
    """A round instrument: the ring fills clockwise from the top, the number sits inside, the name and a note below."""
    H = 116
    RING = 58

    def __init__(self, title):
        super().__init__()
        self.setFixedHeight(self.H)
        self._title, self._pct, self._value, self._note, self._colour = title, None, "—", "", WHITE
        self._glide = Glide(self, 900)
        self._f_title, self._f_value, self._f_note = font(8, QFont.DemiBold, UI), font(12.5, QFont.DemiBold, DISPLAY), font(7.5, QFont.Normal, UI)

    def set(self, pct, value: str, note="", colour=WHITE):
        self._pct, self._value, self._note, self._colour = pct, value, note, colour
        self._glide.to(max(0, min(100, pct or 0)) / 100)
        self.update()

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        r = QRectF(self.rect())
        platter(p, r, 16)
        ring = QRectF((r.width() - self.RING) / 2, 13, self.RING, self.RING)
        p.setBrush(Qt.NoBrush)
        p.setPen(pen(QColor(255, 255, 255, 18), 5))
        p.drawEllipse(ring)
        if self._glide.value > 0.002:
            p.setPen(pen(QColor(self._colour), 5))
            p.drawArc(ring, 90 * 16, -round(360 * 16 * self._glide.value))
        p.setPen(QColor(TEXT) if self._pct is not None else QColor(FAINT))
        p.setFont(self._f_value)
        p.drawText(ring, Qt.AlignCenter, self._value)
        p.setPen(QColor(MUTED))
        p.setFont(self._f_title)
        p.drawText(QRectF(4, ring.bottom() + 8, r.width() - 8, 14), Qt.AlignCenter, self._title)
        p.setPen(QColor(FAINT))
        p.setFont(self._f_note)
        p.drawText(QRectF(4, ring.bottom() + 23, r.width() - 8, 14), Qt.AlignCenter, self._note)


class Member(Hover):
    """One teammate in the list: the star as their picture (lit when online), name and state, and when they
    clocked in. Your own row has the clock-in button."""

    def __init__(self):
        super().__init__()
        self.setFixedHeight(52)
        self._person, self._me = None, False
        self.last = False
        self._f_name, self._f_state, self._f_time, self._f_small, self._f_pill = (
            font(10, QFont.DemiBold, UI), font(8.5, QFont.Normal, UI), font(11, QFont.DemiBold, DISPLAY),
            font(7, QFont.Normal, UI), font(8.5, QFont.DemiBold, UI))
        self._f_tag = font(6.5, QFont.Bold, UI, spacing=0.6)
        self._t, self.ping = 0.0, 1.0
        self._ping = animate(self, 900, lambda v: self._set("ping", v))
        clock().frame.connect(self._frame)
        self.setEnabled(False)

    def _clock_pill(self) -> QRectF:
        """Where the Parar / Retomar button of your own row sits."""
        return QRectF(self.width() - CLOCK_PILL, self.height() / 2 - 13, CLOCK_PILL, 26)

    def hitButton(self, pos) -> bool:
        # Once the clock was started only its button stops and starts it, as in the Hub: a click anywhere on the row
        # used to stop the hours by accident.
        if self._me and self._person and self._person.get("ponto"):
            return self._clock_pill().contains(QPointF(pos))
        return super().hitButton(pos)

    def _frame(self, t):
        self._t = t
        if self._person and self._person.get("online") and self.isVisible():
            self.update()  # the online dot breathes

    def set(self, person: dict, me: bool):
        was = self._person
        if was and was.get("user") == person.get("user") and (
                (person.get("online") and not was.get("online")) or (person.get("ponto") and not was.get("ponto"))):
            self._to(self._ping, 0.0, 1)  # just came online or clocked in: one ring out of the picture
        self._person, self._me = person, me
        can = me and person.get("user") is not None   # their own line starts the clock, stops it and starts it again
        self.setEnabled(can)
        self.setCursor(Qt.PointingHandCursor if can else Qt.ArrowCursor)
        self.setToolTip("" if not can else "Bater o ponto" if not person.get("ponto") else
                        "Parar: as horas de hoje deixam de contar" if clock_runs(person) else "Retomar: as horas voltam a contar")
        self.update()

    def paintEvent(self, _):
        if not self._person:
            return
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        person, online = self._person, self._person.get("online")
        h, w = self.height(), self.width()
        if not self.last:
            p.setPen(QPen(QColor(255, 255, 255, 16), 1))
            p.drawLine(QPointF(48, h - 0.5), QPointF(w, h - 0.5))
        av = QRectF(0, h / 2 - 18, 36, 36)
        p.setPen(Qt.NoPen)
        p.setBrush(QColor(0, 0, 0))
        p.drawEllipse(av)
        paint_star(p, av.adjusted(4, 4, -4, -4), 1.0 if online else 0.35)
        breath = 0.5 + 0.5 * math.sin(self._t * 2.4)
        p.setPen(QPen(rgba(COLORS["ONLINE"], 0.45 + 0.4 * breath) if online else QColor(255, 255, 255, 26), 1.3))
        p.setBrush(Qt.NoBrush)
        p.drawEllipse(av.adjusted(0.6, 0.6, -0.6, -0.6))
        if 0 < self.ping < 1:
            p.setPen(QPen(rgba(COLORS["ONLINE"], 0.9 * (1 - self.ping)), 2))
            r = 5 + 12 * self.ping
            p.drawEllipse(av.center(), r, r)
        dot = QPointF(av.right() - 3, av.bottom() - 3)
        if online:  # a sonar ring leaving the dot
            k = (self._t / 1.8) % 1.0
            p.setPen(Qt.NoPen)
            p.setBrush(rgba(COLORS["ONLINE"], 0.42 * (1 - k)))
            p.drawEllipse(dot, 4.4 + 5 * k, 4.4 + 5 * k)
        p.setPen(QPen(QColor(24, 24, 26), 2.5))
        p.setBrush(QColor(COLORS["ONLINE"] if online else COLORS["OFFLINE"]))
        p.drawEllipse(dot, 4.4, 4.4)
        p.setPen(QColor(TEXT) if online else QColor(MUTED))
        p.setFont(self._f_name)
        p.drawText(QRectF(48, 8, 150, 18), Qt.AlignLeft | Qt.AlignVCenter, person["name"])
        if self._me:  # which row is yours
            tag = QRectF(48 + QFontMetricsF(self._f_name).horizontalAdvance(person["name"]) + 7, 11, 22, 13)
            p.setPen(Qt.NoPen)
            p.setBrush(rgba(COLORS["ONLINE"] if online else MUTED, 0.2))
            p.drawRoundedRect(tag, 6.5, 6.5)
            p.setPen(QColor(COLORS["ONLINE"] if online else MUTED))
            p.setFont(self._f_tag)
            p.drawText(tag, Qt.AlignCenter, "TU")
        state = {"WORKING": "A trabalhar", "WAITING": "À espera", "PAUSED": "Em pausa", "ERROR": "Erro"}.get(person.get("status"), "Online") \
            if online else "Offline"
        p.setPen(QColor(MUTED) if online else QColor(FAINT))
        p.setFont(self._f_state)
        p.drawText(QRectF(48, 26, 150, 16), Qt.AlignLeft | Qt.AlignVCenter, state)
        if person.get("ponto"):
            runs = clock_runs(person)
            # your own row is the Hub's Ponto box in small: the hours, green while they count, and a button that says what it does
            right = w - (CLOCK_PILL + 10 if self._me else 0)
            p.setPen(QColor("#5fe08a") if runs and self._me else QColor(TEXT) if runs else QColor(MUTED))   # stopped, the hours go grey and stand still
            p.setFont(self._f_time)
            p.drawText(QRectF(right - 80, 8, 80, 20), Qt.AlignRight | Qt.AlignVCenter, worked_of(person))
            p.setPen(QColor(FAINT))
            p.setFont(self._f_small)
            p.drawText(QRectF(right - 110, 28, 110, 14), Qt.AlignRight | Qt.AlignVCenter, f"desde {hhmm(person['ponto'])}" if runs else "parado")
            if self._me:
                pill = self._clock_pill()
                shape = QPainterPath()
                shape.addRoundedRect(pill, 13, 13)
                if runs:   # "Parar" is an outline: stopping the clock is the quieter of the two things
                    p.setPen(pen(QColor(255, 255, 255, int(90 + 110 * self.hover)), 1.2))
                    p.setBrush(QColor(255, 255, 255, int(14 + 30 * self.hover)))
                    p.drawRoundedRect(pill.adjusted(.6, .6, -.6, -.6), 12.4, 12.4)
                    self.paint_wave(p, shape, "#ffffff", 0.2)
                    p.setPen(QColor(TEXT))
                else:      # "Retomar" is the white button, like "Bater ponto"
                    p.setPen(Qt.NoPen)
                    p.setBrush(QColor(255, 255, 255, int(235 + 20 * self.hover)))
                    p.drawRoundedRect(pill, 13, 13)
                    self.paint_wave(p, shape, "#000000", 0.22)
                    p.setPen(QColor("#000000"))
                p.setFont(self._f_pill)
                p.drawText(pill, Qt.AlignCenter, "Parar" if runs else "Retomar")
        elif self.isEnabled():
            pill = QRectF(w - 92, h / 2 - 13, 92, 26)
            p.setPen(Qt.NoPen)
            p.setBrush(QColor(255, 255, 255, int(235 + 20 * self.hover)))
            p.drawRoundedRect(pill, 13, 13)
            shape = QPainterPath()
            shape.addRoundedRect(pill, 13, 13)
            self.paint_wave(p, shape, "#000000", 0.22)
            p.setPen(QColor("#000000"))
            p.setFont(self._f_pill)
            p.drawText(pill, Qt.AlignCenter, "Bater ponto")
        else:
            p.setPen(QColor(FAINT))
            p.setFont(self._f_state)
            p.drawText(QRectF(w - 90, 0, 90, h), Qt.AlignRight | Qt.AlignVCenter, "sem ponto")


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
    """The widget at its smallest, set like a watchmaker's logo: the Mercedes star, a hairline, then the time with
    the AMG badge under it. No background: the desktop shows through, a soft shadow keeps it legible on any
    wallpaper. Click to open; drag to move."""
    STAR, M, GAP, TEXT_W = 64, 12, 14, 106
    W = M + STAR + 2 * GAP + 1 + TEXT_W + M
    H = M + STAR + M
    FACE = QRect(M, M, STAR + 2 * GAP + 1 + TEXT_W, STAR)    # what you see, inside the widget

    def __init__(self, on_click):
        super().__init__()
        self.setFixedSize(self.W, self.H)
        self.setCursor(Qt.PointingHandCursor)
        self.setToolTip("Abrir a central de comando")
        self._on_click = on_click
        self.fade = 1.0
        self._hover, self._down = 0.0, 0.0
        self._hover_anim = animate(self, 200, lambda v: self._set("_hover", v))
        self._down_anim = animate(self, 110, lambda v: self._set("_down", v))
        self._press_at, self._grab, self._dragged = None, None, False
        self._face, self._face_key = None, None
        self._f_time = font(22, QFont.DemiBold, DISPLAY)
        self._light = False                  # is the wallpaper behind it light? then the words go dark
        self._ticks = 0
        self._minute = QTimer(self)          # the face only changes when the minute does
        self._minute.timeout.connect(self._second)
        self._minute.start(1000)

    def _second(self):
        self._ticks += 1
        if self._ticks % 20 == 0:
            self._sample()
        self.update()

    def _sample(self):
        """Looks at the desktop behind it and picks white or dark words to match."""
        if not self.isVisible() or self.window().windowOpacity() < 0.99:
            return
        screen = self.screen()
        if screen is None:
            return
        g = self.mapToGlobal(QPoint(0, 0)) - screen.geometry().topLeft()
        shot = screen.grabWindow(0, g.x(), g.y(), self.width(), self.height()).toImage().scaled(12, 6)
        lum = [QColor(shot.pixel(x, y)).lightnessF() for x in range(shot.width()) for y in range(shot.height())]
        light = sum(lum) / len(lum) > 0.6
        if light != self._light:
            self._light = light
            self.update()

    def showEvent(self, e):
        QTimer.singleShot(400, self._sample)
        super().showEvent(e)

    def _set(self, name, v):
        setattr(self, name, v)
        self.update()

    def _to(self, anim, current, end):
        anim.stop()
        anim.setStartValue(current)
        anim.setEndValue(float(end))
        anim.start()

    def set(self, load, colour, pulse):
        """The window reports load and state; the small widget keeps to the star, the time and AMG."""

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
        elif self._dragged:
            QTimer.singleShot(120, self._sample)   # a new spot on the desktop: check the colour behind it
        self._press_at = None

    def _build_face(self, hhmm_now: str) -> QPixmap:
        dpr = self.devicePixelRatioF()
        pix = QPixmap(int(self.W * dpr), int(self.H * dpr))
        pix.setDevicePixelRatio(dpr)
        pix.fill(Qt.transparent)
        p = QPainter(pix)
        p.setRenderHint(QPainter.Antialiasing)
        p.setRenderHint(QPainter.SmoothPixmapTransform)
        face = QRectF(self.FACE)
        p.setPen(Qt.NoPen)
        p.setBrush(QColor(0, 0, 0, 2))       # invisible, but it keeps the whole thing clickable and draggable
        p.drawRoundedRect(face, 12, 12)

        # the star: the chrome emblem, with a soft shadow under it
        r = self.STAR / 2
        paint_star(p, QRectF(face.left(), face.center().y() - r, self.STAR, self.STAR), shadow=True)

        # a hairline between the star and the words; white on a dark wallpaper, graphite on a light one
        ink = QColor(22, 23, 26) if self._light else QColor(TEXT)
        halo = QColor(255, 255, 255, 120) if self._light else QColor(0, 0, 0, 80)
        x = face.left() + self.STAR + self.GAP
        line = QLinearGradient(0, face.top(), 0, face.bottom())
        line.setColorAt(0, rgba(ink.name(), 0))
        line.setColorAt(0.5, rgba(ink.name(), 0.45))
        line.setColorAt(1, rgba(ink.name(), 0))
        p.setPen(QPen(line, 1))
        p.drawLine(QPointF(x + 0.5, face.top() + 8), QPointF(x + 0.5, face.bottom() - 8))

        # the time, with a faint halo of the opposite colour so it holds on busy wallpapers
        tx = x + 1 + self.GAP
        text = QPainterPath()
        text.addText(QPointF(tx, face.top() + 33), self._f_time, hhmm_now)
        p.setPen(pen(halo, 3.2))
        p.setBrush(Qt.NoBrush)
        p.drawPath(text)
        p.setPen(Qt.NoPen)
        p.setBrush(ink)
        p.drawPath(text)

        # the AMG badge under it, with its own shadow
        bh = 10.0
        bw = badge.width(bh)
        if not self._light:   # bright chrome with a shadow on dark wallpapers; graphite on light ones, where chrome vanishes
            p.drawImage(QRectF(tx + 0.5, face.top() + 45, bw, bh), badge.image(bh, dpr, shadow=True))
        badge.paint(p, tx, face.top() + 44, bh, dark=self._light)
        p.end()
        return pix

    def paintEvent(self, _):
        now = datetime.now().strftime("%H:%M")
        key = (self.devicePixelRatioF(), now, self._light)
        if self._face_key != key:
            self._face, self._face_key = self._build_face(now), key
        p = QPainter(self)
        p.setRenderHint(QPainter.SmoothPixmapTransform)
        p.setOpacity(self.fade)
        c = QPointF(self.FACE.center())
        s = 1 + 0.03 * self._hover - 0.03 * self._down     # it gives a little under the finger, like a real button
        p.translate(c)
        p.scale(s, s)
        p.translate(-c)
        p.drawPixmap(0, 0, self._face)


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
    away_done = Signal(object)  # the offline/online switch: the new state, or the error text
    news = Signal(object)       # tasks that were sent, from the thread that polls the Hub
    inbox_news = Signal(object)  # the notifications not read yet, for the mini history (same thread)

    def __init__(self, store: StateStore, client: AgentClient):
        super().__init__(None, Qt.Window | Qt.FramelessWindowHint | (Qt.WindowStaysOnTopHint if prefs.on_top() else Qt.Widget))
        self.store, self.client = store, client
        self.hub_ready.connect(self._hub_opened)
        self.punched.connect(self._punched)
        self.notices = Notices(self._open_notice)  # the black card that says a task was sent
        self.news.connect(self.notices.push)
        self.presence = Presence(self)  # the corner card that says a teammate came online
        self._online_seen = None
        self._work_seen = None      # user -> the task they are working on (None when not working), as last seen
        self._commits = None        # the last commits the Hub knows (/api/local/commits), read off the UI thread
        self._commits_shown = None  # the list already looked at
        self._commit_shas = None    # every commit seen so far (None until the first look, which is not news)
        self.inbox_news.connect(self._render_notes)
        self._inbox_seen, self._notes = None, None  # unread count last asked about, and what came back
        self._notice_after = None  # newest "task sent" notice when the widget started (None until the first look)
        self._notice_seen = set()  # the ones already shown
        self._hub_page = None      # where the Hub should open, when something asked for a page
        self.on_status = lambda status: None  # tray hook
        self.notify = lambda title, text: None  # tray hook: a Windows notification
        self._away = False  # switched offline with the "Ficar offline" button (to try the notifications)
        self.away_done.connect(self._away_done)
        self._ponto_seen = None  # user -> when they clocked in today, as last seen (None until the first look)
        self._version = -1
        self._opening_hub = False
        self._expander = None
        self._week, self._week_seen = None, None  # what is being touched right now, from the Hub on this computer
        self._team, self._team_seen = [], False   # who is online, from the Hub on this computer (None = Hub not answering)
        self._last_team = []
        self._waiting = None  # approvals waiting for this person at the last look (None: not looked yet)
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
                w.setFixedWidth(INNER)
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
        row.setContentsMargins(2, 0, 0, 0)
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

        self.hero = Hero()
        col.addWidget(self.hero)

        self.tile_session, self.tile_week, self.tile_higgs = Line("Sessão 5 h"), Line("Semana"), Line("Créditos")
        for title, lines in (("Claude", (self.tile_session, self.tile_week)), ("Higgsfield", (self.tile_higgs,))):
            limits = Platter(title)
            for line in lines:
                limits.box.addWidget(line)
            col.addWidget(limits)

        team = Platter("Equipa")
        self.grid_note = team.note
        self.members = [Member() for _ in range(3)]
        for m in self.members:
            m.clicked.connect(self.punch_ponto)
            team.box.addWidget(m)
        self.members[-1].last = True
        self.hub_note = label("O Hub não está a responder.", 8.5, FAINT)
        self.hub_note.hide()
        team.box.addWidget(self.hub_note)
        # to try the notifications: the others see this person go offline, and get the card when they come back
        self.btn_away = TextButton("Ficar offline", "Aparecer offline para a equipa (para testar as notificações)", MUTED)
        self.btn_away.clicked.connect(lambda: self.set_away(not self._away))
        away_row = QHBoxLayout()
        away_row.setContentsMargins(0, 4, 0, 4)
        away_row.addWidget(self.btn_away)
        away_row.addStretch(1)
        team.box.addLayout(away_row)
        col.addWidget(team)

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
        controls = QHBoxLayout()
        controls.setSpacing(6)
        controls.setContentsMargins(0, 4, 0, 0)
        self.btn_pause = TextButton("Pausar", "Pausar o agente")
        self.btn_resume = TextButton("Retomar", "Retomar a tarefa")
        self.btn_stop = TextButton("Parar", "Parar a tarefa atual", COLORS["ERROR"])
        self.btn_task = TextButton("Abrir", "Abrir a tarefa no Hub", MUTED)
        for button, action in ((self.btn_pause, lambda: self.client.send("pause")), (self.btn_resume, lambda: self.client.send("resume")),
                               (self.btn_stop, lambda: self.client.send("stop")), (self.btn_task, self._open_task)):
            button.clicked.connect(action)
            controls.addWidget(button)
        controls.addStretch(1)
        self.task_card.box.addLayout(controls)
        self.task_card.hide()

        # what is waiting for this person in the Hub: approvals to decide, notifications not read yet
        self.inbox = Card(COLORS["WAITING"])
        self.inbox_text = label("", 9, COLORS["WAITING"], QFont.DemiBold, wrap=True)
        self.inbox.box.addWidget(self.inbox_text)
        self.inbox.setCursor(Qt.PointingHandCursor)
        self.inbox.setToolTip("Abrir o Hub")
        self.inbox.mousePressEvent = lambda e: self._open_hub()
        self.inbox.hide()
        col.insertWidget(col.indexOf(self.task_card), self.inbox)

        # the notifications not read yet, readable here: a mini history (the whole one is in the Hub)
        self.notes = Card()
        self.notes.box.setSpacing(3)
        head = QHBoxLayout()
        head.addWidget(caption("Notificações"))
        head.addStretch(1)
        self.notes_count = label("", 8.5, TEXT, QFont.DemiBold)
        head.addWidget(self.notes_count)
        self.notes.box.addLayout(head)
        self.note_rows = [NoticeRow() for _ in range(3)]   # never more: the rest is in the Hub
        for row in self.note_rows:
            row.clicked.connect(lambda row=row: self._read_notice(row.item))
            row.dismissed.connect(lambda row=row: self._delete_notice(row.item))
            self.notes.box.addWidget(row)
        foot = QHBoxLayout()
        foot.setContentsMargins(0, 3, 0, 0)
        self.btn_clear = TextButton("Limpar tudo", "Apagar todas as tuas notificações, aqui e no Hub", MUTED)
        self.btn_clear.clicked.connect(self._clear_notes)
        self._clear_armed = False
        self._clear_timer = QTimer(self)
        self._clear_timer.setSingleShot(True)
        self._clear_timer.setInterval(3500)
        self._clear_timer.timeout.connect(lambda: self._arm_clear(False))
        foot.addWidget(self.btn_clear)
        foot.addStretch(1)
        self.btn_notes = TextButton("Ver todas", "Abrir as notificações no Hub", MUTED)
        self.btn_notes.clicked.connect(self._open_hub)
        foot.addWidget(self.btn_notes)
        self.notes.box.addLayout(foot)
        self.notes.hide()
        col.insertWidget(col.indexOf(self.task_card), self.notes)
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
        """Starts as the button, near the top-right corner of the screen."""
        screen = self.screen().availableGeometry()
        self.setFixedSize(Orb.W, Orb.H)
        self.orb.move(0, 0)
        self.move(screen.right() - Orb.W - 30, screen.top() + 50)

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
        face = QRect(self.pos() + Orb.FACE.topLeft(), Orb.FACE.size())
        x, y = face.right() + 1 - WIDTH - SHADOW, face.top() - SHADOW
        screen = self.screen().availableGeometry()
        x = max(screen.left() - SHADOW, min(x, screen.right() + 1 + SHADOW - size.width()))
        y = max(screen.top() - SHADOW, min(y, screen.bottom() + 1 + SHADOW - size.height()))
        self._orb_face = face.topLeft() - QPoint(x, y)
        self.setFixedSize(size)
        self.move(x, y)
        self.orb.move(self._orb_face - Orb.FACE.topLeft())
        self._start_morph(+1)

    def collapse(self):
        """The cockpit shrinks back into the button at its top-right corner."""
        if self.mode != "panel":
            return
        self._orb_face = QPoint(SHADOW + WIDTH - Orb.FACE.width(), SHADOW)
        self.orb.move(self._orb_face - Orb.FACE.topLeft())
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
            at = self.pos() + self._orb_face - Orb.FACE.topLeft()
            self.orb.fade = 1.0
            self.orb.move(0, 0)
            self.setFixedSize(Orb.W, Orb.H)
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
            p.fillRect(rect, QColor(9, 9, 10))
        p.restore()
        edge = QLinearGradient(rect.left(), rect.top(), rect.right(), rect.bottom())   # a chrome rim
        edge.setColorAt(0, QColor(255, 255, 255, 56))
        edge.setColorAt(0.3, QColor(255, 255, 255, 12))
        edge.setColorAt(0.7, QColor(255, 255, 255, 24))
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
            orb = QRectF(self._orb_face.x(), self._orb_face.y(), Orb.FACE.width(), Orb.FACE.height())
            full = self._panel_rect()
            rect = QRectF(orb.left() + (full.left() - orb.left()) * k, orb.top() + (full.top() - orb.top()) * k,
                          orb.width() + (full.width() - orb.width()) * k, orb.height() + (full.height() - orb.height()) * k)
            small = Orb.FACE.height() / 2
            self._paint_panel(p, rect, small + (RADIUS - small) * k, False, scene=False)  # plain while it moves: cheap frames
        # button mode: the button paints itself

    # ------------------------------------------------------------ the Hub: who is online, what is happening

    def _poll_hub(self):
        """Keeps the widget current. Starts the local Hub server if it is not running, and tells the Hub this person is here
        (that is what shows them online when no agent is running)."""
        tick = 0
        while True:
            url = hub.hub_url()
            who = None
            try:
                if not hub.is_up(url) and hub.is_local(url):
                    hub.start_local_server(url)
                team = hub.get_json(url + "/api/local/team")
                who = self._identity(team)
                if who and not self._away:
                    hub.ping_presence(url, who)
                    team = hub.get_json(url + "/api/local/team")  # again, so this person already shows as online
                self._team = team
            except (OSError, ValueError, urllib.error.URLError):
                self._team = None  # the Hub is not answering
            if who and self._team is not None:
                self._poll_notices(url, who)
                if NOTES_IN_WIDGET:
                    self._poll_inbox(url, who, tick)
            if tick % 2 == 0 and self._team is not None:
                try:
                    self._week = hub.get_json(url + "/api/local/week")  # needs the team key away from the server computer; without it the last value stays
                except (OSError, ValueError, urllib.error.URLError):
                    pass
            if tick % COMMITS_EVERY == 0 and self._team is not None:
                try:
                    self._commits = hub.get_json(url + "/api/local/commits")
                except (OSError, ValueError, urllib.error.URLError):
                    pass   # an older Hub, or it is busy: the last list stays
            if tick % ACCOUNT_EVERY == 0:
                refresh_from_account()  # the Claude usage figures straight from the account, here and never on the UI thread
            tick += 1
            time.sleep(4)

    def _poll_inbox(self, url, who, tick):
        """The notifications not read yet, for the mini history: asked again when their number changes (the team list already
        carries it) and once a minute, so "há 3 min" stays true. An older Hub has no such door: then nothing changes."""
        unread = next((p.get("unread") for p in self._team or [] if p["user"] == who), None)
        if unread == self._inbox_seen and tick % 15:
            return
        try:
            found = hub.get_inbox(url, who)
        except (OSError, ValueError, urllib.error.URLError):
            return
        self._inbox_seen = unread
        self.inbox_news.emit(found)

    def _poll_notices(self, url, who):
        """Tasks sent to anyone since the widget started, for the black card. The first look only notes where things are, so
        a widget that has just started does not replay old news. After that it asks for everything since then and shows what
        it has not shown yet: the Hubs sync, so a notice can arrive after a newer one."""
        try:
            found = hub.get_notices(url, who, self._notice_after)
            if self._notice_after is None:
                self._notice_after = found["latest"]
            fresh = [n for n in found["items"] if n["id"] not in self._notice_seen]
        except (OSError, ValueError, KeyError, urllib.error.URLError):
            return  # a Hub from before this existed has no such door: no cards, and nothing else changes
        self._notice_seen.update(n["id"] for n in fresh)
        if fresh:
            self.news.emit(fresh)

    def _open_notice(self, href):
        """A card was clicked: the Hub opens on that task ("#/tarefas/3")."""
        if not self._opening_hub:
            self._hub_page = href.lstrip("#")
            self._open_hub()

    def _identity(self, team):
        """Who sits at this computer: TEAM_WIDGET_USER, else the agent's user, else the Windows account name (marco -> Marco)."""
        wanted = (os.environ.get("TEAM_WIDGET_USER") or hub.configured_user() or self.store.get().get("user") or getpass.getuser() or "").strip().lower()
        return next((p["user"] for p in team if wanted in (p["user"].lower(), p["name"].lower())), None)

    def _render_people(self, team):
        """Kovel, Marco and David in a list; when the Hub is quiet, the last names seen, all offline."""
        if team:
            self._last_team = team
        shown = team or [{**p, "online": False, "status": "OFFLINE", "ponto": None} for p in self._last_team]
        me = self._identity(shown) if shown else None
        for i, member in enumerate(self.members):
            if i < len(shown):
                member.set(shown[i], shown[i]["user"] == me)
                member.show()
            else:
                member.hide()
        clocked = sum(1 for p in shown if p.get("ponto"))
        self.grid_note.setText(f"{clocked} de {len(shown)} com ponto" if shown else "")
        self.hub_note.setVisible(team is None)
        self._render_state()

    def _render_inbox(self, team):
        """Approvals this person can decide (the notifications have their own card). A new one raises a Windows notification."""
        mine = next((p for p in team or [] if p["user"] == self._identity(team or [])), None)
        approvals = (mine or {}).get("approvals") or 0
        if self._waiting is not None and approvals > self._waiting:
            self.notify("Agente AMG", "Um agente está à espera da tua aprovação.")
        if mine is not None:
            self._waiting = approvals
        self.inbox_text.setText(f"{approvals} aprovação à espera" if approvals == 1 else f"{approvals} aprovações à espera")
        self.inbox.setVisible(bool(approvals))

    def _render_notes(self, data):
        """The mini history: the three newest notifications, the ones not read yet first and in bold, the rest dimmed."""
        if data is not None:
            self._notes = data
        data = self._notes or {"unread": 0, "items": []}
        items = (data.get("items") or [])[:len(self.note_rows)]
        for row, item in zip(self.note_rows, items + [None] * len(self.note_rows)):
            row.setVisible(item is not None)
            if item:
                row.show_item(item)
        unread = data.get("unread") or 0
        self.notes_count.setText(f"{unread} por ler" if unread else "tudo lido")
        self.notes.setVisible(NOTES_IN_WIDGET and bool(items))
        if not items:
            self._arm_clear(False)

    def _delete_notice(self, item):
        """The × on a notification: gone from here at once, and for good from the Hub (its bell, the other computers)."""
        if not item:
            return
        data = self._notes or {}
        self._render_notes({"unread": max(0, (data.get("unread") or 0) - (0 if item.get("read") else 1)),
                            "items": [n for n in data.get("items") or [] if n.get("id") != item.get("id")]})
        self._delete_notes([item["id"]])

    def _clear_notes(self):
        """"Limpar tudo" asks first: the pill turns into "Apagar todas?" for a few seconds, and only a second click deletes."""
        if not self._clear_armed:
            self._arm_clear(True)
            return
        self._arm_clear(False)
        self._render_notes({"unread": 0, "items": []})
        self._delete_notes(None)

    def _arm_clear(self, armed: bool):
        self._clear_armed = armed
        self.btn_clear.set_text("Apagar todas?" if armed else "Limpar tudo", RED if armed else MUTED)
        if armed:
            self._clear_timer.start()
        else:
            self._clear_timer.stop()

    def _delete_notes(self, ids):
        """Deletes in the Hub (ids None: all of this person's) off the UI thread, then asks again so the card fills back up
        with the next ones."""
        who, url = self._identity(self._team or []), hub.hub_url()
        if not who:
            return

        def run():
            hub.delete_notes(url, who, ids)
            try:
                self.inbox_news.emit(hub.get_inbox(url, who))
            except (OSError, ValueError, urllib.error.URLError):
                pass

        threading.Thread(target=run, daemon=True).start()

    def _read_notice(self, item):
        """A notification clicked in the cockpit: opened where it points, and read now if it was not (here, in the Hub, on its bell)."""
        if not item:
            return
        if not item.get("read"):
            data = self._notes or {}
            self._render_notes({"unread": max(0, (data.get("unread") or 1) - 1),
                                "items": [{**n, "read": True} if n.get("id") == item.get("id") else n for n in data.get("items") or []]})
            who, url = self._identity(self._team or []), hub.hub_url()
            if who:
                threading.Thread(target=hub.mark_read, args=(url, who, [item["id"]]), daemon=True).start()
        self._open_notice(item.get("href") or "#/home")

    def set_on_top(self, on: bool):
        """Keep the widget above the other windows, or let it go behind them like any window."""
        shown = self.isVisible()
        self.setWindowFlag(Qt.WindowStaysOnTopHint, on)
        if shown:
            self.show()  # changing a window flag hides the window
        prefs.save(on_top=on)

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
        page, self._hub_page = self._hub_page, None

        def work():  # starting the server can take a few seconds
            error = hub.ready()
            url = hub.hub_url()
            session = None if error else self.client.hub_session()
            who = self._identity(self._team) if self._team else None
            if not session and not error and who:
                session = hub.session(url, who)
            if session:
                url += f"/#login={session}" + (f"&to={page}" if page else "")
            elif page:
                url += f"/#{page}"
            self.hub_ready.emit((error, url))

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
            start = QRect(self.pos() + Orb.FACE.topLeft(), Orb.FACE.size())
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

    def _follow_work(self, team):
        """A quiet card when a teammate starts working on something. Never for this person, never with a sound."""
        if not team:
            return
        me = self._identity(team)
        now = {p["user"]: (p.get("task") or "") if p.get("status") == "WORKING" else None for p in team}
        if self._work_seen is not None:
            for p in team:
                task = now[p["user"]]
                if task is not None and self._work_seen.get(p["user"]) is None and p["user"] != me:
                    self.presence.say(p["name"], f"a trabalhar: {task}" if task else "começou a trabalhar")
        self._work_seen = now

    def _follow_commits(self):
        """A quiet card when a teammate sends changes (commits). Several at once from one person are one card."""
        commits = self._commits
        if commits is None or commits is self._commits_shown:
            return
        self._commits_shown = commits
        if self._commit_shas is not None:
            me = self._identity(self._team or [])
            by = {}
            for c in commits:
                if c["sha"] not in self._commit_shas and c.get("user") != me:
                    by.setdefault(c["name"], []).append(c)
            for name, items in by.items():
                self.presence.say(name, f"enviou: {items[0]['message']}" if len(items) == 1 else f"enviou {len(items)} alterações")
        self._commit_shas = (self._commit_shas or set()) | {c["sha"] for c in commits}

    def _follow_online(self, team):
        """Tells this person when someone comes online or goes offline, the way Steam does."""
        if not team:  # no answer yet: the first real list is a look, not news
            return
        now = {p["user"]: bool(p.get("online")) for p in team}
        if self._online_seen is not None:
            for p in team:  # everyone, this person too: whoever switches offline/online sees the same card as the others
                if now[p["user"]] != bool(self._online_seen.get(p["user"])):
                    self.presence.show(p["name"], now[p["user"]])
        self._online_seen = now

    def set_away(self, away: bool):
        """The "Ficar offline / Ficar online" button: asked of the Hub off the UI thread."""
        who = self._identity(self._team or [])
        if not who:
            self.notify("Equipa", "O Hub não respondeu. Tenta outra vez daqui a pouco.")
            return
        self.btn_away.setEnabled(False)

        def work():
            try:
                hub.set_away(hub.hub_url(), who, away)
                self.away_done.emit(away)
            except (OSError, ValueError) as e:
                self.away_done.emit(str(e))

        threading.Thread(target=work, daemon=True).start()

    def _away_done(self, result):
        self.btn_away.setEnabled(True)
        if isinstance(result, str):
            self.notify("Equipa", "O Hub não aceitou a mudança. Faz git pull e reinicia o Hub.")
            return
        self._away = result
        if result:
            self.btn_away.set_text("Ficar online", COLORS["ERROR"])
        else:
            self.btn_away.set_text("Ficar offline", MUTED)

    def punch_ponto(self):
        who = self._identity(self._team or [])
        if not who:
            self.notify("Ponto", "O Hub não respondeu. Tenta outra vez daqui a pouco.")
            return
        mine = next((p for p in self._team or [] if p.get("user") == who), {})
        stop = clock_runs(mine)   # running: this click stops it; not started or stopped: it starts
        for m in self.members:
            m.setEnabled(False)

        def work():
            try:
                self.punched.emit(hub.punch(hub.hub_url(), who, stop))
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
            state = {k: result.get(k) for k in ("at", "running", "worked_s", "since")} if "running" in result else None
            self._team = [{**p, "ponto": result["at"], "ponto_state": state} if p["user"] == result["user"] else p for p in self._team]
        self._render_people(self._team)
        if not result.get("running", True):
            mine = {"ponto": result["at"], "ponto_state": result}
            self.notify("Ponto", f"Ponto parado: {worked_of(mine)} hoje. «Retomar» põe as horas a contar outra vez.")
        elif result.get("since") and result["since"] != result["at"]:
            self.notify("Ponto", "Ponto a contar outra vez. A equipa já sabe.")
        else:
            self.notify("Ponto", f"Ponto batido às {hhmm(result['at'])}. A equipa já sabe.")

    # ------------------------------------------------------------ rendering

    def _tick(self):
        team = self._team
        if team is not self._team_seen:
            if team != self._team_seen:
                self._render_people(team)
                self._render_inbox(team)
                self._render_usage()
                self._follow_ponto(team)
                self._follow_online(team)
                self._follow_work(team)
            self._team_seen = team
        self._follow_commits()
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
        """How things are, as the chip on the main card and the light on the button."""
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
        team = self._team or []
        online = sum(1 for p in team if p.get("online"))
        note = f"{online} de {len(team)} online" if team else ""
        self.hero.set_status(text, colour, pulse, note)
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
            self.bar.set(progress, COLORS["WORKING"] if progress >= 100 else WHITE)
            self.details.setText(self._details(state))
            self.details.setVisible(bool(self.details.text()))
            status = state.get("status")
            self.btn_pause.setVisible(status in ("WORKING", "WAITING"))
            self.btn_resume.setVisible(status == "PAUSED")
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
        plan = claude_plan_usage()  # None when Claude Code has not reported recently (limits.py)
        if plan:
            self._load = plan["week"]
            week, five = plan["week"], plan["five"]
            read = "agora" if time.time() - plan["saved_at"] < 600 else f"lido {ago(plan['saved_at'])}"
            self.tile_week.set(week, f"{round(week)}%", until(plan["week_reset"]) or read)
            self.tile_session.set(five, "—" if five is None else f"{round(five)}%",
                                  "sem dados recentes" if five is None else until(plan["five_reset"]) or read)
        else:
            spent = mine.get("week_cost_usd") or 0
            self._load = mine.get("week_pct") if spent else None
            self.tile_week.set(self._load, "—" if self._load is None else f"{round(self._load)}%",
                               f"${spent:.2f} de ${mine.get('week_budget_usd', 0):.0f}" if mine else "sem dados")
            self.tile_session.set(None, "—", "sem dados")
        used = mine.get("higgsfield_pct")
        self.tile_higgs.set(used, "—" if used is None else f"{round(used)}%", "por definir no Hub" if used is None else "créditos gastos")
        self._render_state()
