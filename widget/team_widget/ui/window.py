"""The widget, in three sizes: a start button on the desktop, the cockpit (a tall panel), and the Hub.

Press the start button and it grows into the cockpit; the cockpit's ⤢ grows into the Hub (expand.py); ▾ shrinks
it back. The look is a luxury car's dashboard screen: black glass, white type, grey, nothing else. The AMG badge
and the three-pointed star are the official vector marks (badge.py: assets/amg-logo.svg, assets/mercedes-star.svg). The cockpit is laid out
like iOS widgets: the hero card (time, date, how things are, the star), the Claude and Higgsfield limits as lines, three round dials for this PC
(processor, memory, battery), and the team as a list.
Every animation runs off one frame clock at the monitor's refresh rate (motion.py), which ticks only while something
moves, and each frame repaints only what moved. The decorative motion (the glint, the pulse, the rings round the faces)
plays for a few seconds after a change and then rests: a cockpit where nothing happens draws nothing.
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
from PySide6.QtGui import (QColor, QGuiApplication, QConicalGradient, QFont, QFontMetricsF, QIcon, QImage, QLinearGradient, QPainter, QPainterPath,
                           QPen, QPixmap, QPolygonF, QRadialGradient, QRegion)
from PySide6.QtSvg import QSvgRenderer
from PySide6.QtWidgets import (QAbstractButton, QFrame, QGridLayout, QHBoxLayout, QLabel, QLayout, QMessageBox, QSizePolicy,
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
AMBIENT_REST = "#6fa8ff"   # the bubble's ambient light at rest: the blue of a Mercedes cabin at night
ACCENT = WHITE
COLORS = {"WORKING": "#7fd492", "ONLINE": "#7fd492", "IDLE": "#c8ccce", "WAITING": "#e3bd6b",
          "PAUSED": "#e3bd6b", "ERROR": RED, "OFFLINE": "#5b5f65"}
LABELS = {"WORKING": "A trabalhar", "ONLINE": "Online", "IDLE": "Livre", "WAITING": "À espera",
          "PAUSED": "Em pausa", "ERROR": "Erro", "OFFLINE": "Agente desligado"}
WIDTH = 340            # the cockpit; the window adds SHADOW on every side
INNER = WIDTH - 28     # what the modules get
SHADOW = 18
RADIUS = 24
GROW, SHRINK = 0.46, 0.34   # seconds: the bubble opening into the cockpit, and back
# The decorative motion (the glint on the hero's star, the agent's dot pulsing, the rings round the faces of whoever is
# online) plays only after a change: the cockpit opens, someone comes online or goes, a state changes. It runs whole
# cycles, from its resting look back to it, and then stops: at rest the cockpit draws no frames at all.
GLINT = 3.2                 # seconds: one glint of light passes over the hero's star
PULSES, PULSE = 2, 2.2      # the agent's dot pulses twice, 2.2 s each, while it works or waits
RINGS, RING = 3, 1.8        # three sonar rings leave an online teammate's dot, 1.8 s each
BREATHS, BREATH = 2, 2 * math.pi / 2.4   # two breaths of the ring round their picture, 2.6 s each
NOTES_IN_WIDGET = False     # the list of notifications inside the widget: off since 6 Oct, nobody read it there (they are in the Hub's bell)
CLOCK_PILL = 74             # width of the Parar / Retomar button in your own row
COMMITS_EVERY = 8           # Hub polls (4 s each) between two looks at the last commits: every half minute
ACCOUNT_EVERY = 75          # Hub polls (4 s each) between two looks at the Claude account's usage: every 5 minutes
FN_EVERY = 3                # Hub polls (4 s each) between two looks at the FundedNext card: every 12 s
LIVE_EVERY = 2              # Hub polls (4 s each) between two looks at what each partner is doing: every 8 s
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


def hours_turn(person: dict) -> float | None:
    """Seconds until worked_of(person) shows another minute; None while it stands still."""
    state = person.get("ponto_state")
    if not person.get("ponto") or (state and not (state.get("running") and state.get("since"))):
        return None
    try:
        start = datetime.fromisoformat(state["since"] if state else person["ponto"]).astimezone()
    except ValueError:
        return None
    run = (datetime.now().astimezone() - start).total_seconds() + (int(state.get("worked_s") or 0) if state else 0)
    return 60 - run % 60


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


def usd(v) -> str:
    """Money the Portuguese way: $100 696,50 (a minus sign, not a hyphen)."""
    if v is None:
        return "—"
    text = f"{abs(v):,.2f}".replace(",", " ").replace(".", ",")
    return f"{'−' if v < 0 else ''}${text}"


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


_avatars: dict[tuple, QPixmap] = {}


def avatar(lit: bool, dpr: float) -> QPixmap:
    """A teammate's picture in the team list, 36 px: the star on a black disc, dimmed when offline. Drawn once per state and
    screen density, not on every frame of the ring breathing round it (the star is a vector file of 25 shapes)."""
    key = (lit, round(dpr, 2))
    if key not in _avatars:
        pix = QPixmap(round(36 * dpr), round(36 * dpr))
        pix.setDevicePixelRatio(dpr)
        pix.fill(Qt.transparent)
        p = QPainter(pix)
        p.setRenderHint(QPainter.Antialiasing)
        p.setPen(Qt.NoPen)
        p.setBrush(QColor(0, 0, 0))
        p.drawEllipse(QRectF(0, 0, 36, 36))
        paint_star(p, QRectF(4, 4, 28, 28), 1.0 if lit else 0.35)
        p.end()
        _avatars[key] = pix
    return _avatars[key]


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
            self.head = head

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
    glint of light passing over it.

    The glint passes once, and the dot pulses while the agent works or waits, only after a change: the cockpit opens or
    the state on the card changes. Then the card rests and draws nothing until the minute on the clock turns. While it
    moves, each frame repaints only the star and the dot."""
    H = 68
    DOT = QRect(28, 89, 11, 11)    # the pulsing dot on the chip (paintEvent: 13 px into the chip at x 20, y 82..106)

    def __init__(self):
        super().__init__()
        self.setFixedSize(INNER, self.H)
        self._status, self._status_colour, self._pulse = "Tudo bem", QColor(COLORS["ONLINE"]), False
        self._note = ""
        self._f_time, self._f_date, self._f_state, self._f_note = (font(30, QFont.DemiBold, DISPLAY), font(9, QFont.Normal, UI),
                                                                   font(8.5, QFont.DemiBold, UI), font(8, QFont.Normal, UI))
        self._card = None
        self._from = -math.inf         # when the last change set the card moving (perf_counter seconds)
        self._shown = self._moving = self._glinting = False   # shown: between showEvent and hideEvent (minimized counts as hidden)
        self._minute = QTimer(self)    # the time on the card changes once a minute: one repaint then
        self._minute.setSingleShot(True)
        self._minute.timeout.connect(self._next_minute)
        clock().frame.connect(self._frame)

    def set_status(self, text, colour, pulse=False, note=""):
        if (text, QColor(colour), pulse, note) == (self._status, self._status_colour, self._pulse, self._note):
            return   # asked again every few seconds with nothing new: no repaint
        self._status, self._status_colour, self._pulse, self._note = text, QColor(colour), pulse, note
        self.update()
        self._play()

    def showEvent(self, e):
        super().showEvent(e)
        self._shown = True
        self._next_minute()
        self._play()

    def hideEvent(self, e):
        super().hideEvent(e)
        self._shown = False
        self._minute.stop()
        self._settle()

    def _play(self):
        """Something changed: the glint passes over the star once and the agent's dot pulses, from rest back to rest."""
        self._from = time.perf_counter()
        self._settle()

    def _motion(self) -> float:
        """Seconds the card moves after a change."""
        return GLINT   # the status dot left the card on 23 Oct: only the glint moves

    def _settle(self):
        """Frames while the motion after the last change lasts and the card is on the screen; none after that."""
        self._moving = self._shown and time.perf_counter() - self._from < self._motion()
        clock().need(self, self._moving)

    def _next_minute(self):
        self.update()
        if self._shown:
            self._minute.start(int((60 - time.time() % 60) * 1000) + 20)

    def _frame(self, _):
        if not self._moving:
            return
        t = time.perf_counter() - self._from
        glint = t < GLINT
        if glint or self._glinting:   # only what moves is repainted; once more after the glint, to leave the star clean
            self.update(self._star_rect().toAlignedRect())
        self._glinting = glint
        if t >= self._motion():
            self._settle()   # this frame paints the card at rest: no more frames until the next change

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
        t = time.perf_counter() - self._from   # seconds since the last change set the card moving
        # after a change a glint passes over the star once, slowly
        phase = t / GLINT
        if phase < 1:
            sr = self._star_rect()
            x = sr.left() - 60 + (sr.width() + 120) * (phase * phase * (3 - 2 * phase))
            # the slanted band already touches the star where the sweep begins and ends: it comes in and leaves softly
            k = min(1.0, phase / 0.2, (1 - phase) / 0.2)
            glint = QLinearGradient(QPointF(x - 40, sr.bottom()), QPointF(x + 40, sr.top()))
            glint.setColorAt(0, QColor(255, 255, 255, 0))
            glint.setColorAt(0.5, QColor(255, 255, 255, round(34 * k * k * (3 - 2 * k))))
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
        p.drawText(QRectF(22, 0, 220, self.H), Qt.AlignLeft | Qt.AlignVCenter, now.strftime("%H:%M"))
        return   # 23 Oct, Marco: only the time (no date, no «Tudo bem», no note)
        p.setPen(QColor(MUTED))
        p.setFont(self._f_date)
        p.drawText(QRectF(21, 58, 220, 18), Qt.AlignLeft | Qt.AlignVCenter,
                   f"{WEEKDAYS[now.weekday()].capitalize()}, {now.day} de {MONTHS[now.month - 1]}")
        f = self._f_state
        w = QFontMetricsF(f).horizontalAdvance(self._status) + 30
        chip = QRectF(20, 82, w, 24)
        p.setPen(Qt.NoPen)
        p.setBrush(QColor(255, 255, 255, 20))
        p.drawRoundedRect(chip, 12, 12)
        # while the agent works or waits the dot pulses after a change, from fully lit back to fully lit
        glow = 0.5 + 0.5 * math.cos(min(t, PULSES * PULSE) * 2 * math.pi / PULSE) if self._pulse else 1.0
        p.setBrush(rgba(self._status_colour.name(), 0.4 + 0.6 * glow))
        p.drawEllipse(QPointF(chip.left() + 13, chip.center().y()), 3.2, 3.2)
        p.setPen(QColor(TEXT))
        p.setFont(f)
        p.drawText(chip.adjusted(22, 0, -8, 0), Qt.AlignVCenter | Qt.AlignLeft, self._status)
        if self._note:
            p.setPen(QColor(FAINT))
            p.setFont(self._f_note)
            p.drawText(QRectF(21, 110, 220, 16), Qt.AlignLeft | Qt.AlignVCenter, self._note)


class Line(QWidget):
    """One limit as a line: what it is on the left, the note and the number on the right, the bar underneath."""
    H = 34

    def __init__(self, title):
        super().__init__()
        self.setFixedHeight(self.H)
        self._title, self._pct, self._value, self._note = title, None, "—", ""
        self._glide = Glide(self, 900)
        self._f_title, self._f_value, self._f_note = font(8.5, QFont.DemiBold, UI), font(10.5, QFont.DemiBold, DISPLAY), font(7.5, QFont.Normal, UI)

    def set(self, pct, value: str, note="", colour=None):
        if (pct, value, note, colour) == (self._pct, self._value, self._note, getattr(self, "_colour", None)):
            return   # asked again every few seconds with nothing new: no repaint
        self._pct, self._value, self._note, self._colour = pct, value, note, colour
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
        room = max(44, QFontMetricsF(self._f_value).horizontalAdvance(self._value) + 10)   # a wide figure ($1 759,50) pushes the note left
        p.drawText(QRectF(0, 2, w - room, 18), Qt.AlignRight | Qt.AlignVCenter, self._note)
        bar = QRectF(0, 25, w, 3)
        p.setPen(Qt.NoPen)
        p.setBrush(QColor(255, 255, 255, 18))
        p.drawRoundedRect(bar, 1.5, 1.5)
        if self._glide.value > 0.002:
            p.setBrush(QColor(getattr(self, "_colour", None) or meter_color(self._pct or 0)))
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
    clocked in. Your own row has the clock-in button.

    After a change (the cockpit opens, they come online or go, their state changes) the ring round an online teammate's
    picture breathes and the dot sends out sonar rings, from rest back to rest, and then the row is still. While it
    moves, each frame repaints only that corner (PICTURE). The hours of a running clock are repainted when their minute
    turns."""
    PICTURE = QRect(0, 6, 45, 47)   # the picture with its rings and dot (paintEvent, on a row 54 tall)
    MOTION = max(RINGS * RING, BREATHS * BREATH)   # seconds the rings move after a change
    GAUGE = 32   # one of the two Claude limit rings on the right

    def __init__(self):
        super().__init__()
        self.setFixedHeight(54)
        self._person, self._me = None, False
        self.last = False
        self._f_name, self._f_state, self._f_time, self._f_small, self._f_pill = (
            font(10, QFont.DemiBold, UI), font(8.5, QFont.Normal, UI), font(11, QFont.DemiBold, DISPLAY),
            font(7, QFont.Normal, UI), font(8.5, QFont.DemiBold, UI))
        self._f_tag = font(6.5, QFont.Bold, UI, spacing=0.6)
        self._f_gauge = font(7.5, QFont.DemiBold, DISPLAY)
        self._t, self.ping = self.MOTION, 1.0   # _t: seconds into the motion after the last change; MOTION and past: at rest
        self._from = 0.0
        self._ping = animate(self, 900, lambda v: self._set("ping", v))
        self._shown = self._breathes = False   # shown: between showEvent and hideEvent (minimized counts as hidden)
        self._minute = QTimer(self)   # the hours of a running clock
        self._minute.setSingleShot(True)
        self._minute.timeout.connect(self._next_minute)
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

    @staticmethod
    def _state(person: dict | None):
        """What sets the row moving again when it changes: who it is, online or not, what they do, their clock."""
        return person and (person.get("user"), bool(person.get("online")), person.get("status"), clock_runs(person))

    def _play(self):
        """Something changed for this row: its rings move again from rest, for MOTION seconds."""
        self._from, self._t = time.perf_counter(), 0.0
        self._settle()

    def _frame(self, _):
        if not self._breathes:
            return
        self._t = time.perf_counter() - self._from
        self.update(self.PICTURE)  # the online dot breathes
        if self._t >= self.MOTION:
            self._settle()   # this frame paints the rings at rest: no more frames until the next change

    def _settle(self):
        """Frames while the motion after the last change lasts, for an online teammate's row on the screen; none after."""
        shown = self._shown and self._person is not None
        self._breathes = shown and bool(self._person.get("online")) and self._t < self.MOTION
        clock().need(self, self._breathes)
        turn = hours_turn(self._person) if shown else None
        if turn is None:
            self._minute.stop()
        else:
            self._minute.start(int(turn * 1000) + 20)

    def _next_minute(self):
        self.update()
        self._settle()

    def showEvent(self, e):
        super().showEvent(e)
        self._shown = True
        self._play()

    def hideEvent(self, e):
        super().hideEvent(e)
        self._shown = False
        self._settle()

    def set(self, person: dict, me: bool):
        was = self._person
        if was and was.get("user") == person.get("user") and (
                (person.get("online") and not was.get("online")) or (person.get("ponto") and not was.get("ponto"))):
            self._to(self._ping, 0.0, 1)  # just came online or clocked in: one ring out of the picture
        self._person, self._me = person, me
        can = False   # since 23 Oct the clock-in is only in the Hub: the row just shows
        self.setEnabled(can)
        self.setCursor(Qt.PointingHandCursor if can else Qt.ArrowCursor)
        self.setToolTip("" if not can else "Bater o ponto" if not person.get("ponto") else
                        "Parar: as horas de hoje deixam de contar" if clock_runs(person) else "Retomar: as horas voltam a contar")
        self.update()
        if self._state(person) != self._state(was):
            self._play()   # they came online or went, or what they do changed: the rings move for a few seconds
        else:
            self._settle()

    def paintEvent(self, e):
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
        p.drawPixmap(av.topLeft(), avatar(bool(online), self.devicePixelRatioF()))
        breath = 0.5 + 0.5 * math.sin(min(self._t, BREATHS * BREATH) * 2.4)   # whole breaths, so it rests where it began
        p.setPen(QPen(rgba(COLORS["ONLINE"], 0.45 + 0.4 * breath) if online else QColor(255, 255, 255, 26), 1.3))
        p.setBrush(Qt.NoBrush)
        p.drawEllipse(av.adjusted(0.6, 0.6, -0.6, -0.6))
        if 0 < self.ping < 1:
            p.setPen(QPen(rgba(COLORS["ONLINE"], 0.9 * (1 - self.ping)), 2))
            r = 5 + 12 * self.ping
            p.drawEllipse(av.center(), r, r)
        dot = QPointF(av.right() - 3, av.bottom() - 3)
        if online and self._t < RINGS * RING:  # a sonar ring leaving the dot (it starts hidden under the dot and fades out)
            k = (self._t / RING) % 1.0
            p.setPen(Qt.NoPen)
            p.setBrush(rgba(COLORS["ONLINE"], 0.42 * (1 - k)))
            p.drawEllipse(dot, 4.4 + 5 * k, 4.4 + 5 * k)
        p.setPen(QPen(QColor(24, 24, 26), 2.5))
        p.setBrush(QColor(COLORS["ONLINE"] if online else COLORS["OFFLINE"]))
        p.drawEllipse(dot, 4.4, 4.4)
        if self.PICTURE.contains(e.rect()):
            return   # a breathing frame: nothing else on the row has changed
        p.setPen(QColor(TEXT) if online else QColor(MUTED))
        p.setFont(self._f_name)
        p.drawText(QRectF(48, 7, 150, 18), Qt.AlignLeft | Qt.AlignVCenter, person["name"])
        if self._me:  # which row is yours
            tag = QRectF(48 + QFontMetricsF(self._f_name).horizontalAdvance(person["name"]) + 7, 10, 22, 13)
            p.setPen(Qt.NoPen)
            p.setBrush(rgba(COLORS["ONLINE"] if online else MUTED, 0.2))
            p.drawRoundedRect(tag, 6.5, 6.5)
            p.setPen(QColor(COLORS["ONLINE"] if online else MUTED))
            p.setFont(self._f_tag)
            p.drawText(tag, Qt.AlignCenter, "TU")
        # on the right, their Claude: the 5 h session and the week, as two small rings (23 Oct, Marco: «os limites do
        # Claude do Kovel e do David, são os importantes»; the clock-in left the cockpit, it is in the Hub)
        plan = (person.get("live") or {}).get("limits") or {}
        right = w - 2 * self.GAUGE - 8
        for i, (key, name) in enumerate((("five", "5 h"), ("week", "sem."))):
            pct = plan.get(key)
            ring = QRectF(right + 6 + i * (self.GAUGE + 2) + (self.GAUGE - 28) / 2, 5, 28, 28)
            p.setBrush(Qt.NoBrush)
            p.setPen(pen(QColor(255, 255, 255, 22), 3))
            p.drawEllipse(ring)
            if pct:
                p.setPen(pen(QColor(meter_color(pct)), 3))
                p.drawArc(ring, 90 * 16, -round(360 * 16 * min(1.0, pct / 100)))
            p.setPen(QColor(TEXT) if pct is not None else QColor(FAINT))
            p.setFont(self._f_gauge)
            p.drawText(ring, Qt.AlignCenter, "—" if pct is None else f"{round(pct)}")
            p.setPen(QColor(FAINT))
            p.setFont(self._f_small)
            p.drawText(QRectF(ring.center().x() - 20, ring.bottom() + 2, 40, 12), Qt.AlignHCenter | Qt.AlignTop, name)
        # the second line says what they are doing: their Claude windows, the task, or whether they are here
        doing, colour = activity({**person, "_me": self._me})
        p.setPen(QColor(colour))
        p.setFont(self._f_state)
        p.drawText(QRectF(48, 27, right - 48, 16), Qt.AlignLeft | Qt.AlignVCenter,
                   QFontMetricsF(self._f_state).elidedText(doing, Qt.ElideRight, right - 52))


APP_GLYPHS = {   # the Hub's pages as iOS icons (24-unit strokes, like the Hub's own icons)
    "tarefas": '<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><path d="M8 12.2l2.8 2.8 5.2-6"/>',
    "mensagens": '<path d="M20.5 11.5a8 8 0 01-11.8 7l-4.7 1.3 1.3-4.4A8 8 0 1120.5 11.5z"/>',
    "escritorio": '<rect x="3" y="4" width="18" height="12" rx="2.5"/><path d="M8.5 20h7M12 16v4"/>',
    "empresa": '<path d="M4.5 20.5V6.5l7.5-3 7.5 3v14"/><path d="M9.5 20.5v-4.5h5v4.5M8.5 9h.01M12 9h.01M15.5 9h.01M8.5 12.5h.01M12 12.5h.01M15.5 12.5h.01"/>',
    "skills": '<path d="M12 3.5l8.5 4.6-8.5 4.6-8.5-4.6z"/><path d="M3.5 12.4l8.5 4.6 8.5-4.6M3.5 16.4l8.5 4.6 8.5-4.6"/>',
    "trading": '<path d="M3.5 17l5.5-5.5 4 4 7.5-7.5"/><path d="M15 8h5.5v5.5"/>',
    "radar": '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><path d="M12 12l5.5-5.5"/><circle cx="12" cy="12" r=".6"/>',
    "fundednext": '<path d="M12 3l7.5 2.8v5.7c0 4.4-3.2 7.8-7.5 9-4.3-1.2-7.5-4.6-7.5-9V5.8z"/><path d="M8.8 12l2.2 2.2 4.2-4.4"/>',
}
APPS = (("hub", "Hub", "#/home"), ("escritorio", "Escritório", "#/escritorio"), ("tarefas", "Tarefas", "#/tarefas"),
        ("mensagens", "Mensagens", "#/mensagens"), ("radar", "Radar", "#/radar"), ("empresa", "Empresa", "#/empresa"), ("skills", "Skills", "#/skills"),
        ("trading", "Trading", "#/trading"), ("fundednext", "FundedNext", "#/fundednext"))
_app_icons: dict[tuple, QPixmap] = {}


def app_icon(glyph: str, size: int, dpr: float) -> QPixmap:
    """An iOS app icon in the car's colours: a graphite squircle with a chrome rim and a white glyph (the Hub's is the
    star on black). Drawn once per glyph and screen density."""
    key = (glyph, size, round(dpr, 2))
    if key not in _app_icons:
        pix = QPixmap(round(size * dpr), round(size * dpr))
        pix.setDevicePixelRatio(dpr)
        pix.fill(Qt.transparent)
        p = QPainter(pix)
        p.setRenderHint(QPainter.Antialiasing)
        r = QRectF(0.5, 0.5, size - 1, size - 1)
        radius = size * 0.27
        body = QLinearGradient(0, 0, 0, size)
        body.setColorAt(0, QColor(58, 61, 67) if glyph != "hub" else QColor(22, 23, 26))
        body.setColorAt(1, QColor(16, 17, 19) if glyph != "hub" else QColor(0, 0, 0))
        p.setPen(Qt.NoPen)
        p.setBrush(body)
        p.drawRoundedRect(r, radius, radius)
        sheen = QLinearGradient(0, 0, 0, size * 0.55)
        sheen.setColorAt(0, QColor(255, 255, 255, 30))
        sheen.setColorAt(1, QColor(255, 255, 255, 0))
        p.setBrush(sheen)
        p.drawRoundedRect(r.adjusted(1, 1, -1, -size * 0.45), radius - 1, radius - 1)
        rim = QLinearGradient(0, 0, size, size)
        rim.setColorAt(0, QColor(255, 255, 255, 120))
        rim.setColorAt(0.45, QColor(255, 255, 255, 22))
        rim.setColorAt(1, QColor(255, 255, 255, 60))
        p.setBrush(Qt.NoBrush)
        p.setPen(QPen(rim, 1))
        p.drawRoundedRect(r, radius, radius)
        if glyph == "hub":
            paint_star(p, QRectF(size * 0.14, size * 0.14, size * 0.72, size * 0.72))
        else:
            svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#f4f6f8" stroke-width="1.7" '
                   f'stroke-linecap="round" stroke-linejoin="round">{APP_GLYPHS[glyph]}</svg>')
            QSvgRenderer(QByteArray(svg.encode())).render(p, QRectF(size * 0.24, size * 0.24, size * 0.52, size * 0.52))
        p.end()
        _app_icons[key] = pix
    return _app_icons[key]


class AppIcon(Hover):
    """One of the central's apps: the icon, its name under it and a count on its corner. It lifts under the mouse and
    sinks under the finger, like on the iPhone; a click opens the Hub on that page."""
    ICON, H = 48, 72

    def __init__(self, glyph, name, tip):
        super().__init__()
        self.glyph, self.name, self.count, self.count_colour = glyph, name, 0, "#ff3b30"
        self.setToolTip(tip)
        self.setFixedHeight(self.H)
        self._f_name, self._f_count = font(7.8, QFont.Normal, UI), font(7.5, QFont.Bold, UI)

    def set_count(self, n: int, colour="#ff3b30"):
        if (n, colour) != (self.count, self.count_colour):
            self.count, self.count_colour = n, colour
            self.update()

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        p.setRenderHint(QPainter.SmoothPixmapTransform)
        icon = QRectF((self.width() - self.ICON) / 2, 4, self.ICON, self.ICON)
        c = icon.center()
        s = 1 + 0.06 * self.hover - 0.1 * self.press
        p.save()
        p.translate(c)
        p.scale(s, s)
        p.translate(-c)
        glow_disc(p, QPointF(c.x(), icon.bottom() - 2), self.ICON * 0.42, 7, "#000000", 0.6)   # its shadow on the glass
        p.drawPixmap(icon.topLeft(), app_icon(self.glyph, self.ICON, self.devicePixelRatioF()))
        shape = QPainterPath()
        shape.addRoundedRect(icon, self.ICON * 0.27, self.ICON * 0.27)
        self.paint_wave(p, shape, WHITE, 0.22)
        if self.hover > 0.01:
            p.setPen(Qt.NoPen)
            p.setBrush(QColor(255, 255, 255, int(16 * self.hover)))
            p.drawPath(shape)
        if self.count:
            text = str(self.count) if self.count < 100 else "99+"
            w = max(18.0, QFontMetricsF(self._f_count).horizontalAdvance(text) + 10)
            pill = QRectF(icon.right() - w + 7, icon.top() - 6, w, 18)
            p.setPen(QPen(QColor(9, 9, 10), 2))
            p.setBrush(QColor(self.count_colour))
            p.drawRoundedRect(pill, 9, 9)
            p.setPen(QColor(WHITE))
            p.setFont(self._f_count)
            p.drawText(pill, Qt.AlignCenter, text)
        p.restore()
        p.setPen(QColor(TEXT) if self.hover > 0.5 else QColor("#c9ccd1"))
        p.setFont(self._f_name)
        p.drawText(QRectF(0, icon.bottom() + 5, self.width(), 14), Qt.AlignHCenter | Qt.AlignTop, self.name)


class ClaudeRow(Hover):
    """One of this person's Claude windows that is working or waiting: a dot in the state's colour, what it is about, and
    what it is doing right now (or what it waits for), with how long it has been like that. A click opens the Escritório.
    Not a stream: it changes when the Hub's reading changes (every 8 s), and draws nothing in between."""
    H = 44

    def __init__(self):
        super().__init__()
        self.setFixedHeight(self.H)
        self.window_ = None
        self.setToolTip("Abrir no Escritório")
        self._f_topic, self._f_action, self._f_time = font(9, QFont.DemiBold, UI), font(8, QFont.Normal, UI), font(7.5, QFont.Normal, UI)

    def show_window(self, w: dict):
        if w != self.window_:
            self.window_ = w
            self.update()

    def paintEvent(self, _):
        w = self.window_
        if not w:
            return
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        r = QRectF(self.rect()).adjusted(0, 1, 0, -1)
        p.setPen(Qt.NoPen)
        p.setBrush(QColor(255, 255, 255, int(8 + 14 * self.hover)))
        p.drawRoundedRect(r, 11, 11)
        shape = QPainterPath()
        shape.addRoundedRect(r, 11, 11)
        self.paint_wave(p, shape)
        asks = w.get("wait") in ("permission", "answer")
        colour = COLORS["WORKING"] if w.get("state") == "working" else COLORS["WAITING"] if asks else MUTED
        dot = QPointF(14, r.center().y())
        glow_disc(p, dot, 8, 8, colour, 0.35)
        p.setBrush(QColor(colour))
        p.drawEllipse(dot, 3.4, 3.4)
        since = ago_iso(w.get("since"))
        p.setFont(self._f_time)
        tw = QFontMetricsF(self._f_time).horizontalAdvance(since) + 4
        p.setPen(QColor(FAINT))
        p.drawText(QRectF(r.right() - tw - 10, r.top() + 5, tw, 16), Qt.AlignRight | Qt.AlignVCenter, since)
        topic = w.get("topic") or w.get("project") or "Janela do Claude"
        p.setPen(QColor(TEXT))
        p.setFont(self._f_topic)
        p.drawText(QRectF(28, r.top() + 5, r.width() - 40 - tw, 16), Qt.AlignLeft | Qt.AlignVCenter,
                   QFontMetricsF(self._f_topic).elidedText(topic, Qt.ElideRight, r.width() - 42 - tw))
        if w.get("state") == "working":
            what = w.get("action") or "a trabalhar"
        elif w.get("wait") == "permission":
            what = "Precisa da tua autorização"
        elif w.get("wait") == "answer":
            what = "Fez-te uma pergunta"
        else:
            what = "Acabou, à espera do próximo pedido"
        if w.get("project"):
            what = f"{w['project']} · {what}"
        p.setPen(QColor(COLORS["WAITING"] if asks else MUTED))
        p.setFont(self._f_action)
        p.drawText(QRectF(28, r.top() + 21, r.width() - 38, 16), Qt.AlignLeft | Qt.AlignVCenter,
                   QFontMetricsF(self._f_action).elidedText(what[0].upper() + what[1:], Qt.ElideRight, r.width() - 40))


def tokens_text(n) -> str:
    """1,2 M · 340 k · 812: tokens the short way, with a Portuguese comma."""
    n = int(n or 0)
    if n >= 1_000_000:
        return f"{n / 1_000_000:.1f} M".replace(".", ",")
    return f"{round(n / 1000)} k" if n >= 1000 else str(n)


class TokenTracker:
    """What the widget saw of each Claude window's tokens at each look at the Hub, so it can say how fast a window spends
    now and what it just spent (the Hub only knows the totals). Kept for a quarter of an hour, in memory."""
    KEEP, SPAN, FRESH = 900.0, 90.0, 30.0   # seconds: history, the speed's window, how long «acabou de gastar» stays

    def __init__(self):
        from collections import deque
        self._deque = deque
        self.seen: dict[str, "deque"] = {}   # window key -> (time, tokens) whenever it changed (and every 20 s)
        self.team = deque()                 # (time, the team's 24 h total)

    def update(self, people: list):
        now = time.time()
        for person in people:
            for win in person.get("token_windows") or []:
                key, tokens = win.get("key"), win.get("tokens") or 0
                if not key:
                    continue
                h = self.seen.setdefault(key, self._deque())
                if not h or h[-1][1] != tokens or now - h[-1][0] >= 20:
                    h.append((now, tokens))
                while h and now - h[0][0] > self.KEEP:
                    h.popleft()
        total = sum(person.get("tokens") or 0 for person in people)
        if not self.team or self.team[-1][1] != total or now - self.team[-1][0] >= 20:
            self.team.append((now, total))
        while self.team and now - self.team[0][0] > self.KEEP:
            self.team.popleft()

    def rate(self, key) -> float:
        """Tokens per minute over the last minute and a half; 0 when nothing was spent in it."""
        h = self.seen.get(key)
        if not h or len(h) < 2:
            return 0.0
        now = time.time()
        old = next(((t, v) for t, v in h if now - t <= self.SPAN), h[-1])
        before = [x for x in h if x[0] < old[0]]
        start = before[-1] if before else old   # from the last look before the window, so a change inside it counts whole
        dt = now - start[0]
        return max(0.0, (h[-1][1] - start[1]) * 60 / dt) if dt > 5 else 0.0

    def jump(self, key) -> int:
        """What the window spent between the last two looks, while that is fresh."""
        h = self.seen.get(key)
        if not h or len(h) < 2 or time.time() - h[-1][0] > self.FRESH:
            return 0
        return max(0, h[-1][1] - h[-2][1])

    def points(self, key) -> list:
        return list(self.seen.get(key) or ())


class UsageView(QWidget):
    """«Hoje»: what this person spent and what they can still use (23 Oct, Marco: «quero mais saber o uso diário, o que
    estou a gastar, o que posso utilizar»). The tokens of the last 24 h, counting up when they grow, with the speed now;
    then the Claude plan as two bars, the 5 h session and the week, each with what is left and when it renews. A click
    opens the token central (tokens.py), where every window is."""
    opened = Signal()
    BAR = 34

    def __init__(self, tracker):
        super().__init__()
        self.tracker = tracker
        self.setCursor(Qt.PointingHandCursor)
        self.setToolTip("Abrir a central de tokens")
        self._mine, self._windows, self._shown = 0, [], 0.0
        self._limits = [("Claude 5 h", None, "sem dados"), ("Semana", None, "sem dados")]
        self._count = animate(self, 700, self._count_to)
        self._f_big, self._f_unit = font(20, QFont.DemiBold, DISPLAY), font(8, QFont.Normal, UI)
        self._f_name, self._f_num, self._f_note = font(8.5, QFont.DemiBold, UI), font(8.5, QFont.DemiBold, DISPLAY), font(7.5, QFont.Normal, UI)
        self.setFixedHeight(44 + 2 * self.BAR)

    def _count_to(self, v):
        self._shown = v
        self.update()

    def mousePressEvent(self, e):
        if e.button() == Qt.LeftButton:
            self.opened.emit()

    def set_tokens(self, mine: int, windows: list):
        """Repainted at every look at the Hub: the speed changes with time."""
        if mine != self._mine:
            self._count.stop()
            self._count.setStartValue(float(self._shown or mine))
            self._count.setEndValue(float(mine))
            self._count.start()
        self._mine, self._windows = mine, windows
        self.update()

    def set_limits(self, limits: list):
        """[(name, percent used or None, note)] for the 5 h session and the week."""
        if limits != self._limits:
            self._limits = limits
            self.update()

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        w = self.width()
        p.setPen(QColor(TEXT))
        p.setFont(self._f_big)
        big = tokens_text(self._shown or self._mine)
        p.drawText(QRectF(0, 2, w, 32), Qt.AlignLeft | Qt.AlignVCenter, big)
        x = QFontMetricsF(self._f_big).horizontalAdvance(big) + 10
        speed = sum(self.tracker.rate(win.get("key")) for win in self._windows)
        if speed >= 1:   # spending right now: a green chip with the speed
            text = f"{tokens_text(speed)}/min"
            chip = QRectF(x, 9, QFontMetricsF(self._f_num).horizontalAdvance(text) + 24, 20)
            p.setPen(Qt.NoPen)
            p.setBrush(rgba(COLORS["WORKING"], 0.16))
            p.drawRoundedRect(chip, 10, 10)
            p.setBrush(QColor(COLORS["WORKING"]))
            p.drawEllipse(QPointF(chip.left() + 10, chip.center().y()), 3, 3)
            p.setPen(QColor(COLORS["WORKING"]))
            p.setFont(self._f_num)
            p.drawText(chip.adjusted(16, 0, -6, 0), Qt.AlignCenter, text)
        else:
            p.setPen(QColor(MUTED))
            p.setFont(self._f_unit)
            p.drawText(QRectF(x, 10, w - x, 22), Qt.AlignLeft | Qt.AlignVCenter, "tokens nas últimas 24 h")
        y = 44.0
        for name, pct, note in self._limits:
            p.setFont(self._f_name)
            p.setPen(QColor(TEXT))
            p.drawText(QRectF(0, y, w / 2, 16), Qt.AlignLeft | Qt.AlignVCenter, name)
            left = "—" if pct is None else f"restam {max(0, round(100 - pct))}%"
            p.setFont(self._f_num)
            p.setPen(QColor(TEXT) if pct is not None else QColor(FAINT))
            lw = QFontMetricsF(self._f_num).horizontalAdvance(left) + 2
            p.drawText(QRectF(w - lw, y, lw, 16), Qt.AlignRight | Qt.AlignVCenter, left)
            p.setFont(self._f_note)
            p.setPen(QColor(FAINT))
            p.drawText(QRectF(w / 2 - 40, y, w / 2 + 40 - lw - 8, 16), Qt.AlignRight | Qt.AlignVCenter,
                       QFontMetricsF(self._f_note).elidedText(note, Qt.ElideRight, w / 2 + 40 - lw - 8))
            track = QRectF(0, y + 20, w, 5)
            p.setPen(Qt.NoPen)
            p.setBrush(QColor(255, 255, 255, 16))
            p.drawRoundedRect(track, 2.5, 2.5)
            if pct:
                p.setBrush(QColor(meter_color(pct)))
                p.drawRoundedRect(QRectF(0, track.top(), max(5.0, w * min(pct, 100) / 100), 5), 2.5, 2.5)
            y += self.BAR


TOGGLE_GLYPHS = {   # what can sit beside the minimized clock (24-unit strokes, like the apps)
    "janelas": '<rect x="3" y="4.5" width="18" height="15" rx="3"/><path d="M7 9.5l3 2.5-3 2.5M12.5 15h4.5"/>',
    "tokens": '<path d="M13 2.5L5 13.5h6l-1 8 8-11h-6z"/>',
    "limites": '<path d="M4.5 16.5a7.5 7.5 0 1115 0"/><path d="M12 16.5l4-5"/><path d="M8 19.5h8"/>',
    "camaras": '<rect x="3" y="6.5" width="13" height="11" rx="2.5"/><path d="M16 10.5l5-3v9l-5-3z"/>',
}
TOGGLES = (("janelas", "Claude"), ("tokens", "Tokens"), ("limites", "Limites"), ("camaras", "Câmaras"))
_toggle_icons: dict[tuple, QPixmap] = {}


def toggle_icon(glyph: str, on: bool, dpr: float) -> QPixmap:
    key = (glyph, on, round(dpr, 2))
    if key not in _toggle_icons:
        pix = QPixmap(round(18 * dpr), round(18 * dpr))
        pix.setDevicePixelRatio(dpr)
        pix.fill(Qt.transparent)
        p = QPainter(pix)
        p.setRenderHint(QPainter.Antialiasing)
        ink = "#0b0b0d" if on else "#8d9198"
        svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="{ink}" stroke-width="1.9" '
               f'stroke-linecap="round" stroke-linejoin="round">{TOGGLE_GLYPHS[glyph]}</svg>')
        QSvgRenderer(QByteArray(svg.encode())).render(p, QRectF(0, 0, 18, 18))
        p.end()
        _toggle_icons[key] = pix
    return _toggle_icons[key]


class Toggle(Hover):
    """One choice of «Ao lado do relógio»: an icon over its name in a rounded tile. On, the tile is polished chrome with
    a dark icon, like an iOS Control Centre button; off, dark glass. It slides between the two."""
    changed = Signal()

    def __init__(self, glyph: str, name: str, on: bool):
        super().__init__()
        self.glyph, self.name, self.on = glyph, name, on
        self._lit = 1.0 if on else 0.0
        self._fade = animate(self, 220, lambda v: self._set("_lit", v), curve=QEasingCurve.OutCubic)
        self.setFixedHeight(54)
        self.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)
        self._f = font(7.5, QFont.DemiBold, UI)
        self._tip()

    def _tip(self):
        self.setToolTip(f"Tirar «{self.name}» do lado do relógio" if self.on else f"Mostrar «{self.name}» ao lado do relógio quando minimizas")

    def toggle(self):
        self.on = not self.on
        self._tip()
        self._to(self._fade, self._lit, 1 if self.on else 0)

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        r = QRectF(self.rect()).adjusted(0.5, 0.5, -0.5, -0.5)
        r = r.adjusted(self.press, self.press, -self.press, -self.press)
        lit = self._lit
        body = QLinearGradient(0, r.top(), 0, r.bottom())
        top, bottom = QColor(232, 234, 238), QColor(168, 172, 180)
        dark_top, dark_bottom = QColor(44, 46, 51), QColor(22, 23, 26)
        mix = lambda a, b: QColor(int(a.red() + (b.red() - a.red()) * lit), int(a.green() + (b.green() - a.green()) * lit),
                                  int(a.blue() + (b.blue() - a.blue()) * lit))
        body.setColorAt(0, mix(dark_top, top))
        body.setColorAt(1, mix(dark_bottom, bottom))
        p.setPen(QPen(QColor(255, 255, 255, int(30 + 50 * lit + 30 * self.hover)), 1))
        p.setBrush(body)
        p.drawRoundedRect(r, 14, 14)
        icon = toggle_icon(self.glyph, lit > 0.5, self.devicePixelRatioF())
        p.drawPixmap(QPointF(r.center().x() - 9, r.top() + 9), icon)
        v = int(170 + (11 - 170) * lit)
        p.setPen(QColor(v, v, v + 2))
        p.setFont(self._f)
        p.drawText(QRectF(r.left(), r.top() + 30, r.width(), 16), Qt.AlignHCenter | Qt.AlignVCenter, self.name)


class Pill(QAbstractButton):
    """A pinned view at its smallest, beside the minimized clock: one line on a dark glass capsule, like an iPhone's
    Live Activity (23 Oct, Marco: the cards «ocupam boé espaço... tem que ser justo, no canto do monitor»). A click
    opens the cockpit on that view."""
    H, MAX_W = 26, 214

    def __init__(self):
        super().__init__()
        self.text, self.dot, self.glow = "", MUTED, False
        self.setCursor(Qt.PointingHandCursor)
        self._f = font(8, QFont.DemiBold, UI)
        self.setFixedSize(60, self.H)

    on_change = None   # the window's InfoColumn repaints when a line changes

    def set(self, text: str, dot: str, glow=False):
        if (text, dot, glow) != (self.text, self.dot, self.glow):
            self.text, self.dot, self.glow = text, dot, glow
            if self.on_change:
                self.on_change()
            self.setToolTip(text)
            self.setFixedWidth(int(min(self.MAX_W, QFontMetricsF(self._f).horizontalAdvance(text) + 34)))
            self.update()

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        r = QRectF(self.rect()).adjusted(0.5, 0.5, -0.5, -0.5)
        body = QLinearGradient(0, 0, 0, r.height())
        body.setColorAt(0, QColor(30, 31, 35, 240))
        body.setColorAt(1, QColor(8, 8, 10, 240))
        rim = QLinearGradient(0, 0, r.width(), r.height())
        rim.setColorAt(0, QColor(255, 255, 255, 80))
        rim.setColorAt(0.5, QColor(255, 255, 255, 16))
        rim.setColorAt(1, QColor(255, 255, 255, 46))
        p.setPen(QPen(rim, 1))
        p.setBrush(body)
        p.drawRoundedRect(r, r.height() / 2, r.height() / 2)
        dot = QPointF(13, r.center().y())
        if self.glow:
            glow_disc(p, dot, 8, 8, self.dot, 0.4)
        p.setPen(Qt.NoPen)
        p.setBrush(QColor(self.dot))
        p.drawEllipse(dot, 3.2, 3.2)
        p.setPen(QColor(TEXT))
        p.setFont(self._f)
        p.drawText(QRectF(23, 0, r.width() - 31, r.height()), Qt.AlignLeft | Qt.AlignVCenter,
                   QFontMetricsF(self._f).elidedText(self.text, Qt.ElideRight, r.width() - 31))


class InfoColumn(QWidget):
    """What sits beside the minimized star (23 Oct, Marco: the pills were «feias»; «as horas ao lado do símbolo», and
    «um ícone e, quando passo o rato por cima, aparecem as informações»): the time written large next to the star, and
    under it a row of small round icons, one per view switched on in the central, each with a dot in the colour of how
    it is. The mouse over an icon opens it into a capsule with the line it stands for; leaving closes it.

    The pills (Pill) still hold the text and the colour; they are never shown, this paints them. The column keeps room
    for one open icon: the empty part is fully transparent, so Windows lets the clicks through to the desktop."""
    W, TIME_H, ICON, GAP = 320, 46, 24, 6
    X0 = 15          # the hairline by the star, then the words
    H = TIME_H + 6 + ICON
    clicked = Signal(str)   # "hora" or the view's key

    def __init__(self):
        super().__init__()
        self.setFixedSize(self.W, self.H)
        self.setMouseTracking(True)
        self.items: list[tuple[str, "Pill"]] = []
        self.time_text, self.right = "", False   # right: the column is on the star's left, everything hugs its right edge
        self.open: dict[str, float] = {}
        self._anims: dict[str, QVariantAnimation] = {}
        self._hovered = None
        self._f_time = font(22, QFont.DemiBold, DISPLAY)
        self._f_text = font(8, QFont.DemiBold, UI)
        self.light = False   # the wallpaper behind is light: the time, the line and AMG go graphite (WidgetWindow._sample)

    def set_light(self, light: bool):
        if light != self.light:
            self.light = light
            self.update()

    def set_items(self, items):
        self.items = items
        self.update()

    def set_time(self, text: str):
        if text != self.time_text:
            self.time_text = text
            self.update()

    # ---- geometry
    def _width_of(self, key, pill) -> float:
        k = self.open.get(key, 0.0)
        full = QFontMetricsF(self._f_text).horizontalAdvance(pill.text) + self.ICON + 14
        room = self.W - self.X0 - 4 - (len(self.items) - 1) * (self.ICON + self.GAP)   # the others stay closed beside it
        return self.ICON + (min(room, full) - self.ICON) * k

    def _rects(self) -> list[tuple[str, "Pill", QRectF]]:
        out, x = [], float(self.X0)
        widths = [(key, pill, self._width_of(key, pill)) for key, pill in self.items]
        total = sum(w for _, _, w in widths) + self.GAP * max(0, len(widths) - 1)
        if self.right:
            x = self.W - self.X0 - total
        y = self.TIME_H + 6
        for key, pill, w in widths:
            out.append((key, pill, QRectF(x, y, w, self.ICON)))
            x += w + self.GAP
        return out

    def _time_rect(self) -> QRectF:
        return QRectF(self.X0, 0, self.W - 2 * self.X0, self.TIME_H)

    # ---- the mouse
    def _hover(self, key):
        if key == self._hovered:
            return
        for k in {self._hovered, key} - {None}:
            target = 1.0 if k == key else 0.0
            anim = self._anims.get(k)
            if anim is None:
                anim = self._anims[k] = animate(self, 240, lambda v, k=k: self._set_open(k, v), curve=QEasingCurve.OutCubic)
            anim.stop()
            anim.setStartValue(self.open.get(k, 0.0))
            anim.setEndValue(target)
            anim.start()
        self._hovered = key
        self.setCursor(Qt.PointingHandCursor if key else Qt.ArrowCursor)

    def _set_open(self, key, v):
        self.open[key] = v
        self.update()

    def _hit(self, pos: QPointF):
        for key, _, r in self._rects():
            if r.adjusted(-2, -3, 2, 3).contains(pos):
                return key
        tw = QFontMetricsF(self._f_time).horizontalAdvance(self.time_text)
        t = self._time_rect()
        time_box = QRectF(t.right() - tw if self.right else t.left(), t.top(), tw, t.height())
        return "hora" if time_box.contains(pos) else None

    def mouseMoveEvent(self, e):
        hit = self._hit(e.position())
        self._hover(hit if hit != "hora" else None)
        self.setCursor(Qt.PointingHandCursor if hit else Qt.ArrowCursor)

    def leaveEvent(self, e):
        self._hover(None)
        super().leaveEvent(e)

    def mousePressEvent(self, e):
        hit = self._hit(e.position())
        if hit and e.button() == Qt.LeftButton:
            self.clicked.emit(hit)
        else:
            e.ignore()

    # ---- painting
    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        # the look Marco liked from the start (2 Oct): a hairline by the star, the time, the AMG badge under it; white
        # with a dark halo on a dark wallpaper, graphite with a light halo on a light one
        ink = QColor(22, 23, 26) if self.light else QColor(TEXT)
        halo = QColor(255, 255, 255, 120) if self.light else QColor(0, 0, 0, 80)
        line_x = self.W - 0.5 if self.right else 0.5
        line = QLinearGradient(0, 2, 0, self.TIME_H)
        line.setColorAt(0, rgba(ink.name(), 0))
        line.setColorAt(0.5, rgba(ink.name(), 0.45))
        line.setColorAt(1, rgba(ink.name(), 0))
        p.setPen(QPen(line, 1))
        p.drawLine(QPointF(line_x, 4), QPointF(line_x, self.TIME_H))
        if self.time_text:
            path = QPainterPath()
            tw = QFontMetricsF(self._f_time).horizontalAdvance(self.time_text)
            x = self.W - self.X0 - tw if self.right else self.X0
            path.addText(QPointF(x, 27), self._f_time, self.time_text)
            p.setPen(pen(halo, 3.2))
            p.setBrush(Qt.NoBrush)
            p.drawPath(path)
            p.setPen(Qt.NoPen)
            p.setBrush(ink)
            p.drawPath(path)
            bh = 10.0
            bx = self.W - self.X0 - badge.width(bh) if self.right else self.X0 + 0.5
            if not self.light:   # bright chrome with a shadow on dark wallpapers; graphite on light ones, where chrome vanishes
                p.drawImage(QRectF(bx + 0.5, 35, badge.width(bh), bh), badge.image(bh, self.devicePixelRatioF(), shadow=True))
            badge.paint(p, bx, 34, bh, dark=self.light)
        dpr = self.devicePixelRatioF()
        for key, pill, r in self._rects():
            k = self.open.get(key, 0.0)
            body = QLinearGradient(0, r.top(), 0, r.bottom())
            body.setColorAt(0, QColor(40, 42, 47, 235))
            body.setColorAt(1, QColor(10, 10, 12, 235))
            rim = QLinearGradient(r.left(), r.top(), r.right(), r.bottom())
            rim.setColorAt(0, QColor(255, 255, 255, 120))
            rim.setColorAt(0.5, QColor(255, 255, 255, 25))
            rim.setColorAt(1, QColor(255, 255, 255, 70))
            p.setPen(QPen(rim, 1))
            p.setBrush(body)
            p.drawRoundedRect(r.adjusted(0.5, 0.5, -0.5, -0.5), r.height() / 2, r.height() / 2)
            glyph = QRectF(r.left() + (self.ICON - 14) / 2, r.top() + (self.ICON - 14) / 2, 14, 14)
            p.drawPixmap(glyph.topLeft(), info_glyph(key, 14, dpr))
            dot = QPointF(r.left() + self.ICON - 5, r.top() + 5)   # how it is, on the icon's shoulder
            if pill.glow:
                glow_disc(p, dot, 6, 6, pill.dot, 0.45)
            p.setPen(QPen(QColor(10, 10, 12), 1.4))
            p.setBrush(QColor(pill.dot))
            p.drawEllipse(dot, 3.2, 3.2)
            if k > 0.02:   # open: the line it stands for, fading in as it widens
                p.setOpacity(min(1.0, k * 1.4))
                p.setPen(QColor(TEXT))
                p.setFont(self._f_text)
                room = r.width() - self.ICON - 10
                p.drawText(QRectF(r.left() + self.ICON + 2, r.top(), room, r.height()), Qt.AlignLeft | Qt.AlignVCenter,
                           QFontMetricsF(self._f_text).elidedText(pill.text, Qt.ElideRight, room))
                p.setOpacity(1.0)


_info_glyphs: dict[tuple, QPixmap] = {}


def info_glyph(key: str, size: int, dpr: float) -> QPixmap:
    """A view's glyph in white, for the icons beside the star; drawn once per size and screen density."""
    k = (key, size, round(dpr, 2))
    if k not in _info_glyphs:
        pix = QPixmap(round(size * dpr), round(size * dpr))
        pix.setDevicePixelRatio(dpr)
        pix.fill(Qt.transparent)
        p = QPainter(pix)
        p.setRenderHint(QPainter.Antialiasing)
        svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#f2f4f7" stroke-width="2" '
               f'stroke-linecap="round" stroke-linejoin="round">{TOGGLE_GLYPHS.get(key, "")}</svg>')
        QSvgRenderer(QByteArray(svg.encode())).render(p, QRectF(0, 0, size, size))
        p.end()
        _info_glyphs[k] = pix
    return _info_glyphs[k]


class Ring(QWidget):
    """A limit as a small ring (the Claude session, the week, Higgsfield): fills clockwise from the top, the number
    inside, the name and a note under it."""
    H, RING = 80, 40

    def __init__(self, title):
        super().__init__()
        self.setFixedHeight(self.H)
        self._title, self._pct, self._value, self._note, self._colour = title, None, "—", "", None
        self._glide = Glide(self, 900)
        self._f_title, self._f_value, self._f_note = font(8, QFont.DemiBold, UI), font(9.5, QFont.DemiBold, DISPLAY), font(7, QFont.Normal, UI)

    def set(self, pct, value: str, note="", colour=None):
        if (pct, value, note, colour) == (self._pct, self._value, self._note, self._colour):
            return   # asked again every few seconds with nothing new: no repaint
        self._pct, self._value, self._note, self._colour = pct, value, note, colour
        self.setToolTip(f"{self._title}: {value}" + (f" · {note}" if note else ""))
        self._glide.to(max(0, min(100, pct or 0)) / 100)
        self.update()

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        w = self.width()
        ring = QRectF((w - self.RING) / 2, 4, self.RING, self.RING)
        p.setBrush(Qt.NoBrush)
        p.setPen(pen(QColor(255, 255, 255, 20), 4))
        p.drawEllipse(ring)
        if self._glide.value > 0.002:
            p.setPen(pen(QColor(self._colour or meter_color(self._pct or 0)), 4))
            p.drawArc(ring, 90 * 16, -round(360 * 16 * self._glide.value))
        p.setPen(QColor(TEXT) if self._pct is not None else QColor(FAINT))
        p.setFont(self._f_value)
        p.drawText(ring, Qt.AlignCenter, self._value)
        p.setPen(QColor(MUTED))
        p.setFont(self._f_title)
        p.drawText(QRectF(0, ring.bottom() + 5, w, 14), Qt.AlignHCenter | Qt.AlignTop, self._title)
        p.setPen(QColor(FAINT))
        p.setFont(self._f_note)
        note = QFontMetricsF(self._f_note).elidedText(self._note, Qt.ElideRight, w - 2)
        p.drawText(QRectF(0, ring.bottom() + 19, w, 13), Qt.AlignHCenter | Qt.AlignTop, note)


def activity(person: dict) -> tuple[str, str]:
    """What a partner is doing, in one line, and its colour: their Claude windows (the Hub's /api/local/live), else the task
    they said they are doing, else whether they are here."""
    live = person.get("live") or {}
    topic = live.get("topic") or ""
    if live.get("working"):
        return f"Claude a trabalhar · {topic}" if topic else "Claude a trabalhar", COLORS["WORKING"]
    if live.get("waiting") and live.get("wait") in ("permission", "answer"):
        return f"O Claude espera por {'ti' if person.get('_me') else 'ele'} · {topic}", COLORS["WAITING"]
    if person.get("doing"):
        return f"Na tarefa · {person['doing'].get('title', '')}", TEXT
    if live.get("waiting") and topic:
        return f"Acabou · {topic}", MUTED
    if topic and live.get("at"):
        return f"Último: {topic} · {ago_iso(live['at'])}", FAINT
    return ("Online, sem nada a correr", MUTED) if person.get("online") else ("Offline", FAINT)


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
    """The widget at its smallest (23 Oct, Marco: «para não estar com muito espaço», «só com o símbolo da Mercedes»): the
    chrome Mercedes star alone, a soft light behind it in the colour of how things are, and an iOS-style red count when
    something waits for this person (messages, approvals). The time and the views chosen in the central are pills beside
    it (WidgetWindow._layout_orb). Click to open the central de comando; drag to move.

    It paints a cached face and only repaints when the minute, the state or the count changes, or while the finger is on it."""
    D, M = 64, 14                    # the star's diameter (as on 2 Oct), and the room round it for its shadow and the count
    CAP_H = 0                        # nothing under the star any more (the time is a pill)
    W, H = D + 2 * M, D + 2 * M
    FACE = QRect(M, M, D, D)        # the star, inside the widget (what grows into the central de comando)

    def __init__(self, on_click):
        super().__init__()
        self.setFixedSize(self.W, self.H)
        self.setCursor(Qt.PointingHandCursor)
        self.setToolTip("Abrir a central de comando")
        self._on_click = on_click
        self.fade = 1.0
        self._hover, self._down = 0.0, 0.0
        self._hover_anim = animate(self, 220, lambda v: self._set("_hover", v))
        self._down_anim = animate(self, 120, lambda v: self._set("_down", v))
        self._press_at, self._grab, self._dragged = None, None, False
        self._face, self._face_key = None, None
        self._colour, self._count, self._load, self._rest = QColor(COLORS["ONLINE"]), 0, None, True
        self._f_time = font(11, QFont.DemiBold, DISPLAY, spacing=0.4)
        self._f_count = font(7.5, QFont.Bold, UI)
        self._minute = QTimer(self)          # the face only changes when the minute does: one repaint then
        self._minute.setSingleShot(True)
        self._minute.timeout.connect(self._next_minute)

    def _next_minute(self):
        self.update()
        if self.isVisible():
            self._minute.start(int((60 - time.time() % 60) * 1000) + 20)

    def showEvent(self, e):
        self._next_minute()
        super().showEvent(e)

    def hideEvent(self, e):
        self._minute.stop()
        super().hideEvent(e)

    def _set(self, name, v):
        setattr(self, name, v)
        self.update()

    def _to(self, anim, current, end):
        anim.stop()
        anim.setStartValue(current)
        anim.setEndValue(float(end))
        anim.start()

    def set(self, load, colour, pulse):
        """How things are, as the ambient light: blue at rest, the state's colour while a Claude works or waits."""
        colour, rest = QColor(colour), not pulse and QColor(colour) == QColor(COLORS["ONLINE"])
        if colour != self._colour or rest != self._rest or load != self._load:
            self._colour, self._rest, self._load = colour, rest, load
            self.update()

    def set_count(self, n: int):
        """The red count: what waits for this person in the Hub."""
        if n != self._count:
            self._count = n
            self.update()

    def enterEvent(self, e):
        self._to(self._hover_anim, self._hover, 1)

    def leaveEvent(self, e):
        self._to(self._hover_anim, self._hover, 0)

    def mousePressEvent(self, e):
        if e.button() == Qt.LeftButton:
            self._press_at = e.globalPosition().toPoint()
            self._grab = self._press_at - self.mapToGlobal(self.FACE.topLeft())   # the mouse, from the star's corner
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
            if hasattr(self.window(), "follow"):
                self.window().follow(at - self._grab)   # the pills rearrange as it nears an edge
            else:
                self.window().move(at - self._grab - self.pos() - self.FACE.topLeft())

    def mouseReleaseEvent(self, e):
        self._to(self._down_anim, self._down, 0)
        if self._press_at is not None and not self._dragged and e.button() == Qt.LeftButton:
            self._on_click()
        elif self._dragged and hasattr(self.window(), "dock"):
            self.window().dock()   # let go: the place is kept for next time
        self._press_at = None

    def ambient(self) -> QColor:
        """The light round the bezel, like the cabin's ambient lighting: blue at rest, green while a Claude works, amber
        when something waits for you, red on an error."""
        return QColor(AMBIENT_REST) if self._rest else self._colour

    def paint_halo(self, p: QPainter, face: QRectF, strength: float):
        """The ambient light: a soft glow behind the star, like a car's cabin at night."""
        c, r = face.center(), face.width() / 2
        glow_disc(p, c, r * 1.2, r * 1.2, self.ambient().name(), 0.3 * strength, soft=0.45)

    def paint_face(self, p: QPainter, face: QRectF, hhmm_now: str, shadow=True):
        """Only the chrome Mercedes star, on nothing: the desktop shows round it (23 Oct, Marco: «mais transparente, só
        com o símbolo da Mercedes»). The time and the rest are pills beside it. Scaled to `face`, which the window also
        uses while the star grows into the central de comando."""
        paint_star(p, face, shadow=shadow)

    def _build_face(self, hhmm_now: str) -> QPixmap:
        dpr = self.devicePixelRatioF()
        pix = QPixmap(int(self.W * dpr), int(self.H * dpr))
        pix.setDevicePixelRatio(dpr)
        pix.fill(Qt.transparent)
        p = QPainter(pix)
        p.setRenderHint(QPainter.Antialiasing)
        p.setRenderHint(QPainter.SmoothPixmapTransform)
        self.paint_face(p, QRectF(self.FACE), hhmm_now)
        if self._count:   # iOS's red count on the bezel's top right
            text = str(self._count) if self._count < 100 else "99+"
            w = max(18.0, QFontMetricsF(self._f_count).horizontalAdvance(text) + 10)
            pill = QRectF(self.FACE.right() - w + 6, self.FACE.top() - 2, w, 18)
            p.setPen(QPen(QColor(0, 0, 0, 200), 2))
            p.setBrush(QColor("#ff3b30"))
            p.drawRoundedRect(pill, 9, 9)
            p.setPen(QColor(WHITE))
            p.setFont(self._f_count)
            p.drawText(pill, Qt.AlignCenter, text)
        p.end()
        return pix

    def paintEvent(self, _):
        now = datetime.now().strftime("%H:%M")
        key = (self.devicePixelRatioF(), now, self.ambient().rgba(), self._count)
        if self._face_key != key:
            self._face, self._face_key = self._build_face(now), key
        p = QPainter(self)
        p.setRenderHint(QPainter.SmoothPixmapTransform)
        p.setRenderHint(QPainter.Antialiasing)
        p.setOpacity(self.fade)
        c = QPointF(self.FACE.center())
        s = 1 + 0.045 * self._hover - 0.07 * self._down     # it gives under the finger, like an iOS icon
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
    cave_ready = Signal(str)     # the cave's address with a sign-in, for the cameras' mini window

    def __init__(self, store: StateStore, client: AgentClient):
        super().__init__(None, Qt.Window | Qt.FramelessWindowHint | (Qt.WindowStaysOnTopHint if prefs.on_top() else Qt.Widget))
        self.store, self.client = store, client
        self.hub_ready.connect(self._hub_opened)
        self.cave_ready.connect(self._cave_opened)
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
        self._fn, self._fn_seen = None, None      # the FundedNext card (the Hub's /api/fundednext/widget)
        self._live, self._live_seen = None, None  # what each partner is doing (the Hub's /api/local/live)
        self._fast = False          # the tokens are on the screen: the Hub is asked every 4 s instead of 8
        self._token_center = None   # the token central's window (tokens.py), made the first time it is opened
        self._team, self._team_seen = [], False   # who is online, from the Hub on this computer (None = Hub not answering)
        self._last_team = []
        self._waiting = None  # approvals waiting for this person at the last look (None: not looked yet)
        self._backdrop = None
        self._usage_at = 0.0
        self._load = None
        self.mode = "orb"            # orb | panel | morph
        self._morph_dir, self._morph_t0, self._k = 0, 0.0, 0.0
        self._orb_face = QPoint()    # where the button's face sits inside the window during a morph
        self._snap = None            # the cockpit as a picture while the bubble grows into it (_snapshot)

        self.setWindowTitle("Agente AMG")
        self.setWindowIcon(QIcon(str(LOGO)))
        self.setAttribute(Qt.WA_TranslucentBackground)

        self.orb = Orb(self.expand)
        self.orb.setParent(self)
        # the pinned views in small, under the clock while the cockpit is minimized
        self.glance = InfoColumn()   # the time and the icons beside the star
        self.glance.setParent(self)
        self.glance.clicked.connect(lambda key: self._open_cave() if key == "camaras" else self.expand())
        self.glances = {key: Pill() for key, _ in TOGGLES}   # the lines and colours the icons show (never shown themselves)
        for card in self.glances.values():
            card.on_change = self._info_changed
        self._looks = QTimer(self)   # a look at the wallpaper behind the time every 20 s, while it is on the screen
        self._looks.timeout.connect(self._sample)
        self._looks.start(20_000)
        self._clock_tick = QTimer(self)   # once a minute, on the minute
        self._clock_tick.setSingleShot(True)
        self._clock_tick.timeout.connect(self._tick_time)
        self._side = "right"
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
        self._tick_time()
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
        self.user_label = label("Agente · central de comando", 8.5, MUTED)   # not shown since 23 Oct: room for the views
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

        # «Hoje» under the time: what this person spends and what is left of the plan (23 Oct, Marco: the windows count,
        # the per-window list and the cameras were «demasiada informação»; the tabs went with them)
        self.tokens = Platter("Hoje", "tokens ›")
        self.tracker = TokenTracker()
        self.usage = UsageView(self.tracker)
        self.usage.opened.connect(self._open_tokens)
        self.tokens.box.addWidget(self.usage)
        self.tokens.box.addSpacing(6)
        col.addWidget(self.tokens)

        # «Ao lado do relógio»: what shows as a pill beside the minimized clock, chosen in the middle of the cockpit, under
        # «Hoje» (23 Oct, Marco: «quero ativar os tokens, quero ativar as câmaras»; then «fica ao lado, no meio», not at the bottom)
        side = Platter("Ao lado do relógio", "quando minimizas")
        tiles = QHBoxLayout()
        tiles.setContentsMargins(0, 4, 0, 4)
        tiles.setSpacing(6)
        pinned = set(prefs.load().get("pins", ["janelas"]))
        self.pins = {}
        for key, name in TOGGLES:
            tile = Toggle(key, name, key in pinned)
            tile.clicked.connect(lambda _=False, key=key: self._toggle_pin(key))   # clicked(bool) would take key's place
            tiles.addWidget(tile)
            self.pins[key] = tile
        side.box.addLayout(tiles)
        col.addWidget(side)

        # «Claude agora»: this person's Claude windows working or waiting, what each is doing
        self.claude_now = Platter("Claude agora")
        self.claude_now.box.setSpacing(4)
        self.claude_rows = [ClaudeRow() for _ in range(3)]   # never more: the rest is in the Escritório
        for row in self.claude_rows:
            row.clicked.connect(lambda: self._open_notice("#/escritorio"))
            self.claude_now.box.addWidget(row)
        self.claude_none = label("Nenhuma janela tua a trabalhar agora.", 8.5, FAINT)
        self.claude_now.box.addWidget(self.claude_none)
        self.claude_now.box.addSpacing(4)
        col.addWidget(self.claude_now)

        # the apps: the Hub's pages one click away, as on the iPhone's home screen
        apps = QWidget()
        grid = QGridLayout(apps)
        grid.setContentsMargins(0, 2, 0, 0)
        grid.setHorizontalSpacing(0)
        grid.setVerticalSpacing(4)
        self.apps = {}
        for i, (glyph, name, href) in enumerate(APPS):
            icon = AppIcon(glyph, name, f"Abrir {name} no Hub")
            icon.clicked.connect(lambda href=href: self._open_notice(href))
            grid.addWidget(icon, i // 5, i % 5)
            self.apps[glyph] = icon
        col.addWidget(apps)

        # the FundedNext account (the Hub's #/fundednext in a few numbers); only on a PC with the account or the MT5
        self.fn = Platter("FundedNext")
        figures = QHBoxLayout()
        figures.setContentsMargins(0, 2, 0, 2)
        self.fn_equity = label("", 15, TEXT, QFont.DemiBold, DISPLAY)
        figures.addWidget(self.fn_equity)
        figures.addStretch(1)
        self.fn_day = label("", 9, MUTED, QFont.DemiBold)
        figures.addWidget(self.fn_day, 0, Qt.AlignBottom)
        self.fn.box.addLayout(figures)
        self.fn_left, self.fn_target = Line("Podes perder hoje"), Line("Objetivo")
        self.fn.box.addWidget(self.fn_left)
        self.fn.box.addWidget(self.fn_target)
        self.fn_hint = label("", 8.5, MUTED, wrap=True)
        self.fn.box.addWidget(self.fn_hint)
        self.fn.setCursor(Qt.PointingHandCursor)
        self.fn.setToolTip("Abrir o painel FundedNext no Hub")
        self.fn.mousePressEvent = lambda e: self._open_notice("#/fundednext")
        self.fn.hide()

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
        # to try the notifications (the others see this person go offline): in the tray menu now, the cockpit kept short
        self.btn_away = TextButton("Ficar offline", "Aparecer offline para a equipa (para testar as notificações)", MUTED)
        team.box.addSpacing(4)
        col.addWidget(team)
        col.addWidget(self.fn)

        # the plan limits as three small rings in one module
        self.tile_session, self.tile_week, self.tile_higgs = Ring("Claude 5 h"), Ring("Semana"), Ring("Higgsfield")
        limits = self._limits = Platter("Limites")   # kept alive, not shown
        rings = QHBoxLayout()
        rings.setContentsMargins(0, 4, 0, 2)
        rings.setSpacing(4)
        for ring in (self.tile_session, self.tile_week, self.tile_higgs):
            rings.addWidget(ring, 1)
        limits.box.addLayout(rings)   # not in the cockpit since 23 Oct (each partner's row has their Claude); kept for the bubble's arc

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
        # "A fazer agora": who said "Estou a fazer" on a task in the Hub, and which; there while it lasts, so the
        # team sees it without opening the Hub. A click on the task opens it there.
        self.doing_card = Card(COLORS["WORKING"])
        self.doing_card.box.addWidget(caption("A fazer agora", COLORS["WORKING"]))
        self.doing_text = label("", 9.5, TEXT, wrap=True)
        self.doing_text.setTextFormat(Qt.RichText)
        self.doing_text.linkActivated.connect(self._open_notice)
        self.doing_card.box.addWidget(self.doing_text)
        self.doing_card.hide()
        col.addWidget(self.doing_card)

        self.ledger = Card()
        self.ledger.box.addWidget(caption("A mexer agora, sem commit"))
        self.pending = QVBoxLayout()
        self.pending.setSpacing(5)
        self.ledger.box.addLayout(self.pending)
        self.ledger.hide()
        col.addWidget(self.ledger)


    # ------------------------------------------------------------ size and place

    EDGE = 6   # px the pills keep from the edges of the screen

    def _place(self):
        """Starts where the star was left last time (the top right of the screen the first time)."""
        screen = self.screen().availableGeometry()
        saved = prefs.load()
        face = QPoint(saved.get("star_x", screen.right() - Orb.D - 24), saved.get("star_y", screen.top() + 40))
        self._layout_orb(face)

    def follow(self, face: QPoint):
        """The star is being dragged: it goes where the mouse takes it, and the pills rearrange round it as it nears an
        edge (23 Oct, Marco: «posso mexer... as coisas que aparecem por fora vão-se ajustando às bordas»)."""
        self._layout_orb(face)

    def dock(self):
        """The star was let go where it is: that place is kept for next time. Nothing snaps."""
        face = self.pos() + self.orb.pos() + Orb.FACE.topLeft()
        prefs.save(star_x=face.x(), star_y=face.y())
        QTimer.singleShot(150, self._sample)   # a new spot on the desktop: check the colour behind it

    def _layout_orb(self, face: QPoint | None = None):
        """The minimized widget: the star where `face` says (its top left on the screen; by default where it is now), and
        the pills beside it on the side with room (left of the star near the right edge, right of it otherwise), centred
        on the star but slid up or down so they never leave the screen. The window takes the size of what shows."""
        if face is None:
            face = self.pos() + self.orb.pos() + Orb.FACE.topLeft()
        self.glance.set_items([(k, card) for k, card in self.glances.items() if self.pins[k].on and card.text])
        gw, gh = self.glance.width(), self.glance.height()
        centre = face + QPoint(Orb.D // 2, Orb.D // 2)
        screen = (QGuiApplication.screenAt(centre) or self.screen()).availableGeometry()
        tuck = Orb.M - 4   # the time and the icons sit in the star's margin, close to it
        room_right = screen.right() - (face.x() + Orb.D + Orb.M - tuck)
        right = room_right < gw + self.EDGE and face.x() - screen.left() > room_right   # star on the right, pills on its left
        self._side = "right" if right else "left"
        orb_top = face.y() - Orb.FACE.top()
        glance_top = centre.y() - gh // 2 + 2
        glance_top = max(screen.top() + self.EDGE, min(glance_top, screen.bottom() - self.EDGE - gh))
        top = min(orb_top, glance_top)
        h = max(orb_top + Orb.H, glance_top + gh) - top
        w = Orb.W + gw - tuck
        self.orb.move(w - Orb.W if right else 0, orb_top - top)
        self.glance.move(0 if right else Orb.W - tuck, glance_top - top)
        self.glance.right = right
        self.glance.update()
        self.glance.setVisible(self.mode == "orb")
        self.setFixedSize(w, h)
        self.move(face - self.orb.pos() - Orb.FACE.topLeft())

    def _tick_time(self):
        """The time pill: the hours, and a dot in the colour of how things are."""
        self.glance.set_time(datetime.now().strftime("%H:%M"))
        self._clock_tick.start(int((60 - time.time() % 60) * 1000) + 20)

    def _sample(self):
        """Looks at the desktop behind the time and picks white or graphite words to match (the old button did this;
        23 Oct, Marco: «quando passo de fundos pretos para brancos o horário não muda de cor»)."""
        if self.mode != "orb" or not self.isVisible() or self.windowOpacity() < 0.99:
            return
        screen = self.screen()
        if screen is None:
            return
        g = self.glance.mapToGlobal(QPoint(0, 0)) - screen.geometry().topLeft()
        shot = screen.grabWindow(0, g.x(), g.y(), self.glance.width(), InfoColumn.TIME_H).toImage().scaled(16, 6)
        lum = [QColor(shot.pixel(x, y)).lightnessF() for x in range(shot.width()) for y in range(shot.height())]
        self.glance.set_light(sum(lum) / len(lum) > 0.6)

    def _info_changed(self):
        """A line beside the star changed: an icon may come or go."""
        if self.mode == "orb" and hasattr(self, "pins"):
            self._layout_orb()

    def _toggle_pin(self, key: str):
        self.pins[key].toggle()
        prefs.save(pins=[k for k, pin in self.pins.items() if pin.on])
        if self.mode == "orb":
            self._layout_orb()

    def _render_glances(self, windows: list, mine_live: dict, cams: list):
        """The pinned views as one line each. Only redrawn on a look at the Hub; the window keeps the clock where it is."""
        asking = [w for w in windows if w.get("wait") in ("permission", "answer")]
        working = sum(1 for w in windows if w.get("state") == "working")
        if asking:   # what waits for you says what it is
            text, dot = f"Espera por ti · {asking[0].get('topic') or asking[0].get('project') or 'Claude'}", COLORS["WAITING"]
        elif working:
            text, dot = f"{working} Claude a trabalhar", COLORS["WORKING"]
        else:
            text, dot = "Claude parado", MUTED
        self.glances["janelas"].set(text, dot, bool(asking or working))
        token_windows = mine_live.get("token_windows") or []
        speed = sum(self.tracker.rate(w.get("key")) for w in token_windows)
        mine = tokens_text(mine_live.get("tokens") or 0)
        self.glances["tokens"].set(f"{mine} · {tokens_text(speed)}/min" if speed >= 1 else f"{mine} tokens · 24 h",
                                   COLORS["WORKING"] if speed >= 1 else MUTED, speed >= 1)
        live = sum(1 for c in cams if c.get("state") == "working")
        self.glances["camaras"].set(f"Empresa AMG · {live} a trabalhar" if live else "Empresa AMG · ao vivo",
                                    "#ff3b30" if live else MUTED, bool(live))
        if self.mode == "orb":
            self._layout_orb()

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
        face = QRect(self.pos() + self.orb.pos() + Orb.FACE.topLeft(), Orb.FACE.size())
        x, y = face.right() + 1 - WIDTH - SHADOW, face.top() - SHADOW
        screen = self.screen().availableGeometry()
        x = max(screen.left() - SHADOW, min(x, screen.right() + 1 + SHADOW - size.width()))
        y = max(screen.top() - SHADOW, min(y, screen.bottom() + 1 + SHADOW - size.height()))
        self._orb_face = face.topLeft() - QPoint(x, y)
        self.setFixedSize(size)
        self.move(x, y)
        self.orb.hide()   # the window draws the face itself while it grows
        self.glance.hide()
        self._snap = self._snapshot()
        self._start_morph(+1)

    def collapse(self):
        """The cockpit shrinks back into the button at its top-right corner."""
        if self.mode != "panel":
            return
        self._orb_face = QPoint(SHADOW + WIDTH - Orb.FACE.width(), SHADOW)
        self._snap = self._snapshot()
        self.panel.hide()
        self._start_morph(-1)

    def _start_morph(self, direction):
        self.mode = "morph"
        self._morph_dir, self._morph_t0 = direction, time.perf_counter()
        self._k = 0.0 if direction > 0 else 1.0
        clock().need(self)
        self.update()

    def _morph_frame(self, _):
        if self.mode != "morph":
            return
        p = min(1.0, (time.perf_counter() - self._morph_t0) / (GROW if self._morph_dir > 0 else SHRINK))
        self._k = 1 - (1 - p) ** 4 if self._morph_dir > 0 else 1 - ease(p)   # opening: fast, then settles softly, like iOS
        self.update()
        if p >= 1:
            self._morph_done()

    def _morph_done(self):
        clock().need(self, False)
        self._snap = None
        if self._morph_dir > 0:
            self.mode = "panel"
            self._backdrop = None
            self.panel.show()   # the last frame already showed exactly this: no fade needed
        else:
            self.mode = "orb"
            face = self.pos() + self._orb_face
            self.orb.fade = 1.0
            self._layout_orb(face)
            self.orb.show()
        self.update()

    def _open_cave(self):
        """The cameras clicked: the cave of Empresa AMG live, in its mini window over everything (mini.py), signed in."""
        who = self._identity(self._team or [])

        def work():
            url = hub.hub_url()
            session = self.client.hub_session() or (hub.session(url, who) if who else None)
            self.cave_ready.emit(f"{url}/?mini=1#login={session or ''}&to=/empresa")

        threading.Thread(target=work, daemon=True).start()

    def _open_tokens(self):
        """The token central: every Claude window of the team, live, in a window of its own."""
        if self._token_center is None:
            from .tokens import TokenCenter
            self._token_center = TokenCenter()
        self._token_center.show_data(self._live, self.tracker)
        self._token_center.open()
        self._fast = True

    def _cave_opened(self, url: str):
        from .mini import MiniWindow   # the web engine is heavy: only when the cameras are first opened
        if getattr(self, "_mini", None) is None:
            self._mini = MiniWindow()
        self._mini.open(url)

    def _snapshot(self) -> QPixmap:
        """The cockpit as a picture (its glass and everything on it), drawn once, so the bubble can grow into it at the
        monitor's refresh rate without laying out or painting a single widget per frame."""
        self.panel.layout().activate()
        dpr = self.devicePixelRatioF()
        w, h = WIDTH, self.panel.height()
        pix = QPixmap(round(w * dpr), round(h * dpr))
        pix.setDevicePixelRatio(dpr)
        pix.fill(Qt.transparent)
        p = QPainter(pix)
        p.setRenderHint(QPainter.Antialiasing)
        self._paint_panel(p, QRectF(0, 0, w, h), RADIUS, False)
        self.panel.render(p, QPoint(0, 0), QRegion(), QWidget.DrawChildren)
        p.end()
        return pix

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
            p.setRenderHint(QPainter.SmoothPixmapTransform)
            k = self._k
            orb = QRectF(self._orb_face.x(), self._orb_face.y(), Orb.FACE.width(), Orb.FACE.height())
            full = self._panel_rect()
            rect = QRectF(orb.left() + (full.left() - orb.left()) * k, orb.top() + (full.top() - orb.top()) * k,
                          orb.width() + (full.width() - orb.width()) * k, orb.height() + (full.height() - orb.height()) * k)
            small = Orb.FACE.height() / 2
            radius = small + (RADIUS - small) * k
            p.setPen(Qt.NoPen)
            for i in (14, 9, 5):   # a soft shadow that grows with it (three passes, cheap)
                p.setBrush(QColor(0, 0, 0, int(16 * k)))
                p.drawRoundedRect(rect.adjusted(-i, -i + 6, i, i + 6), radius + i, radius + i)
            shape = QPainterPath()
            shape.addRoundedRect(rect, radius, radius)
            p.save()
            p.setClipPath(shape)
            p.fillRect(rect, QColor(9, 9, 10))
            if self._snap is not None:   # the cockpit, scaled from the bubble's width to its own, revealed as it grows
                scale = rect.width() / WIDTH
                snap = self._snap.deviceIndependentSize()
                p.setOpacity(max(0.0, min(1.0, (k - 0.12) / 0.5)))
                p.drawPixmap(QRectF(rect.left(), rect.top(), snap.width() * scale, snap.height() * scale), self._snap,
                             QRectF(0, 0, self._snap.width(), self._snap.height()))
            p.restore()
            fade = max(0.0, 1 - k / 0.3)
            if fade > 0:   # the watch face, carried up to the corner and fading as the cockpit comes in
                d = Orb.FACE.width() * (1 + 0.6 * k)
                face = QRectF(rect.right() - d, rect.top(), d, d)
                p.setOpacity(fade)
                self.orb.paint_face(p, face, datetime.now().strftime("%H:%M"), shadow=False)
                p.setOpacity(1)
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
            if (self._fast or tick % LIVE_EVERY == 0) and self._team is not None:
                try:
                    self._live = hub.get_json(url + "/api/local/live")
                except (OSError, ValueError, urllib.error.URLError):
                    pass   # an older Hub has no such door: the rows say online/offline as before
            if tick % FN_EVERY == 0 and self._team is not None:
                try:
                    self._fn = hub.get_json(url + "/api/fundednext/widget")
                except (OSError, ValueError, urllib.error.URLError):
                    pass   # an older Hub has no such door, or it is busy: the last card stays
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
        live = {p["user"]: p for p in (self._live or {}).get("people", [])}
        shown = [{**p, "live": live.get(p["user"])} for p in shown]
        me = self._identity(shown) if shown else None
        for i, member in enumerate(self.members):
            if i < len(shown):
                member.set(shown[i], shown[i]["user"] == me)
                member.show()
            else:
                member.hide()
        online = sum(1 for p in shown if p.get("online"))
        done = (self._live or {}).get("done_today") or 0
        self.grid_note.setText(f"{online} de {len(shown)} online" + (f" · {done} feitas hoje" if done else "") if shown else "")
        mine = next((p for p in shown if p["user"] == me), {})
        mine_live = mine.get("live") or {}
        self.apps["mensagens"].set_count(mine_live.get("messages") or 0)
        self.apps["tarefas"].set_count(mine_live.get("tasks") or 0, "#5b5f66")
        self.apps["escritorio"].set_count(sum((p.get("live") or {}).get("working") or 0 for p in shown), "#2f9e57")
        self.orb.set_count((mine_live.get("messages") or 0) + (mine.get("approvals") or 0))
        rank = {"permission": 0, "answer": 0}   # the ones waiting for this person first, then the ones working
        windows = sorted(mine_live.get("windows") or [], key=lambda w: rank.get(w.get("wait"), 1 if w.get("state") == "working" else 2))
        for row, w in zip(self.claude_rows, windows + [None] * len(self.claude_rows)):
            row.setVisible(w is not None)
            if w:
                row.show_window(w)
        asking = sum(1 for w in windows if w.get("wait") in ("permission", "answer"))
        self.claude_now.note.setText(f"{asking} à tua espera" if asking else "")
        recolour(self.claude_now.note, COLORS["WAITING"] if asking else MUTED)
        self.claude_none.setVisible(not windows)
        self.usage.set_tokens(mine_live.get("tokens") or 0, mine_live.get("token_windows") or [])
        cams = [w for p in shown for w in (p.get("live") or {}).get("windows") or []]
        self._render_glances(windows, mine_live, cams)
        self.hub_note.setVisible(team is None)
        self._render_doing(team or [], me)
        self._render_state()

    def _render_doing(self, team, me):
        from html import escape
        busy = [p for p in team if p.get("doing")]
        rows = []
        for p in busy:
            d = p["doing"]
            since = ""
            try:
                since = datetime.fromisoformat(d["since"].replace("Z", "+00:00")).astimezone().strftime("%H:%M")
            except (KeyError, AttributeError, ValueError):
                pass
            who = "Tu" if p["user"] == me else p["name"]
            rows.append(f'<b style="color:{COLORS["WORKING"]}">{escape(who)}</b>'
                        f'<span style="color:{MUTED}">{" · desde " + since if since else ""}</span><br>'
                        f'<a href="#/tarefas/{d["id"]}" style="color:{TEXT};text-decoration:none">{escape(d["title"])}</a>')
        self.doing_text.setText("<br><br>".join(rows))
        self.doing_card.setVisible(bool(rows))

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

    def _render_fn(self, f: dict):
        """The FundedNext card: equity and today, what can still be lost today and the phase target. With no account it is
        there only on the PC with the MT5, to say how to link it."""
        if not f.get("accounts"):   # with no account the FundedNext app icon is enough: its page says how to link it
            self.fn.hide()
            return
        self.fn.show()
        auto = " · robôs em automático" if f.get("mode") == "auto" else ""
        if not f.get("ok"):
            self.fn.note.setText("sem ligação")
            self.fn_equity.hide(); self.fn_day.hide(); self.fn_left.hide(); self.fn_target.hide()
            self.fn_hint.setText(f.get("error") or "Sem ligação à conta.")
            self.fn_hint.show()
            return
        self.fn.note.setText(f"{f.get('phase', '')}{auto}")
        self.fn_equity.setText(usd(f["equity"]))
        day = f.get("day_pnl") or 0
        self.fn_day.setText(f"hoje {'+' if day > 0 else ''}{usd(day)}")
        recolour(self.fn_day, COLORS["ONLINE"] if day > 0 else RED if day < 0 else MUTED)
        items = {i["id"]: i for i in f.get("items", [])}
        daily = items.get("daily") or {}
        self.fn_left.set(daily.get("pct"), usd(f.get("left_today")), f"{round(daily.get('pct') or 0)}% do limite usado")
        target = items.get("target")
        if target:
            self.fn_target.set(target.get("pct"), f"{round(target.get('pct') or 0)}%", f"falta {usd(target.get('left'))}", COLORS["ONLINE"])
            self.fn_target.show()
        else:
            self.fn_target.hide()
        self.fn_equity.show(); self.fn_day.show(); self.fn_left.show()
        self.fn_hint.setText(f.get("why") or "")
        self.fn_hint.setVisible(bool(f.get("why")))

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
        self.ledger.setVisible(False)   # off since 23 Oct: the cockpit had to fit the screen with «Claude agora»; it is in the Hub

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
            start = QRect(self.pos() + self.orb.pos() + Orb.FACE.topLeft(), Orb.FACE.size())
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
        if self._live is not None and self._live is not self._live_seen:
            self.tracker.update(self._live.get("people") or [])   # every look counts for the speeds, changed or not
            self._render_people(self._team)
            if self._token_center is not None and self._token_center.isVisible():
                self._token_center.show_data(self._live, self.tracker)
            self._live_seen = self._live
        # look at the Hub every 4 s while the tokens are on the screen, every 8 s otherwise
        self._fast = self.mode == "panel" or bool(self._token_center and self._token_center.isVisible())
        if self._fn is not None and self._fn is not self._fn_seen:
            if self._fn != self._fn_seen:
                self._render_fn(self._fn)
            self._fn_seen = self._fn
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
        people = (self._live or {}).get("people") or []
        working = sum(p.get("working") or 0 for p in people)
        waiting = sum(1 for p in people if p.get("waiting") and p.get("wait") in ("permission", "answer"))
        note = ", ".join(n for n in (f"{working} Claude a trabalhar" if working else "",
                                     f"{waiting} à espera de resposta" if waiting else "") if n) or ("Nenhum Claude a correr" if people else "")
        self.hero.set_status(text, colour, pulse, note)
        self.orb.set(self._load, colour, pulse)
        self._tick_time()   # the time pill's dot follows the state

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
        five, week = self.tile_session._pct, self.tile_week._pct
        self.usage.set_limits([("Claude 5 h", five, self.tile_session._note), ("Semana", week, self.tile_week._note)])
        known = [v for v in (five, week) if v is not None]
        if known:
            parts = ([f"5 h · restam {max(0, round(100 - five))}%"] if five is not None else []) +                     ([f"semana {max(0, round(100 - week))}%"] if week is not None else [])
            pill = self.glances["limites"]
            fresh = not pill.text
            pill.set(" · ".join(parts), meter_color(max(known)) if max(known) >= 60 else COLORS["WORKING"])
            if fresh and self.mode == "orb":
                self._layout_orb()
        used = mine.get("higgsfield_pct")
        self.tile_higgs.set(used, "—" if used is None else f"{round(used)}%", "por definir no Hub" if used is None else "créditos gastos")
        self._render_state()
