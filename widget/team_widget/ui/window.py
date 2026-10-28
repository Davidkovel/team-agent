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
from PySide6.QtWidgets import (QAbstractButton, QApplication, QFrame, QGridLayout, QToolTip, QHBoxLayout, QLabel, QLayout, QMessageBox, QSizePolicy,
                               QVBoxLayout, QWidget)

from .. import hub
from ..api.agent_client import AgentClient
from ..limits import claude_plan_usage, refresh_from_account
from ..state.store import StateStore
from . import badge, prefs
from .motion import clock
from .notice import Notices, Presence
from .photos import photos

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
SNAP_KEEP = 20.0            # seconds a picture of the central made in advance is still good for opening into it
DECOR_DT = 1 / 30           # seconds between frames of the slow decorations (glint, rings); the morph keeps the screen's rate
GLINT = 3.2                 # seconds: one glint of light passes over the hero's star
PULSES, PULSE = 2, 2.2      # the agent's dot pulses twice, 2.2 s each, while it works or waits
RINGS, RING = 3, 1.8        # three sonar rings leave an online teammate's dot, 1.8 s each
BREATHS, BREATH = 2, 2 * math.pi / 2.4   # two breaths of the ring round their picture, 2.6 s each
NOTES_IN_WIDGET = False     # the list of notifications inside the widget: off since 6 Oct, nobody read it there (they are in the Hub's bell)
CLOCK_PILL = 74             # width of the Parar / Retomar button in your own row
WINDOWS_EACH = 2            # Claude windows shown under each partner in the central (the rest: the count, and the Escritório)
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


def worked_s(person: dict) -> int:
    """Seconds worked today: the stretches the clock already ran, plus the one running now. It stands still while stopped."""
    state = person.get("ponto_state")
    if not person.get("ponto"):
        return 0
    if not state:   # a Hub from before the clock could stop
        return max(0, int((datetime.now().astimezone() - datetime.fromisoformat(person["ponto"]).astimezone()).total_seconds()))
    seconds = int(state.get("worked_s") or 0)
    if state.get("running") and state.get("since"):
        seconds += max(0, int((datetime.now().astimezone() - datetime.fromisoformat(state["since"]).astimezone()).total_seconds()))
    return seconds


def worked_of(person: dict) -> str:
    """3h 25 worked today."""
    seconds = worked_s(person)
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


AMG_RED = "#e10600"


def cut_path(rect, r=0.0, _ry=None) -> QPainterPath:
    """The shape of every plate and button: rounded like an iPhone button (David, 28 Oct: «mantém ângulos redondos»)."""
    rect = QRectF(rect)
    path = QPainterPath()
    path.addRoundedRect(rect, float(r), float(r if _ry is None else _ry))
    return path


def cut(p: QPainter, rect, r=0.0, _ry=None):
    p.drawPath(cut_path(rect, r))


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


GLASS_ROOM = ASSETS / "glass-room.jpg"   # 28 Oct: a room with a view at dusk (the AMG red tunnel was not liked)
_room: dict[tuple, QPixmap] = {}


def room(size) -> QPixmap | None:
    """The glass look's scene (a room with a view at dusk), cut to cover `size` and softened once; cached per size."""
    key = (round(size.width()), round(size.height()))
    if key not in _room:
        src = QPixmap(str(GLASS_ROOM))
        if src.isNull() or not key[0] or not key[1]:
            return None
        cover = src.scaled(key[0], key[1], Qt.KeepAspectRatioByExpanding, Qt.SmoothTransformation)
        cover = cover.copy((cover.width() - key[0]) // 2, (cover.height() - key[1]) // 2, key[0], key[1])
        small = cover.scaled(max(1, key[0] // 3), max(1, key[1] // 3), Qt.IgnoreAspectRatio, Qt.SmoothTransformation)
        _room[key] = small.scaled(key[0], key[1], Qt.IgnoreAspectRatio, Qt.SmoothTransformation)   # cheap blur
    return _room[key]


def studio(p: QPainter, rect: QRectF):
    """The background: a softened room with a view (glassmorphism, 28 Oct), under a dark veil so white text reads.
    Without the picture it falls back to the old black glass."""
    pic = room(rect.size())
    if pic is not None:
        p.drawPixmap(rect.topLeft(), pic)
        veil = QLinearGradient(0, rect.top(), 0, rect.bottom())
        veil.setColorAt(0, QColor(10, 12, 18, 70))
        veil.setColorAt(0.5, QColor(10, 12, 18, 105))
        veil.setColorAt(1, QColor(6, 7, 10, 165))
        p.fillRect(rect, veil)
        return
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
    """Frosted glass (28 Oct, as in the «Glassy Dashboard» reel): a translucent white plate with iPhone-round corners,
    a light rim from the top-left and a faint sheen, the room showing through."""
    r = rect.adjusted(0.5, 0.5, -0.5, -0.5)
    shape = cut_path(r, radius)
    fill = QLinearGradient(0, r.top(), 0, r.bottom())
    fill.setColorAt(0, QColor(255, 255, 255, 46))
    fill.setColorAt(1, QColor(255, 255, 255, 20))
    p.setPen(Qt.NoPen)
    p.setBrush(QColor(12, 14, 20, 90))                      # body, so text keeps its contrast
    p.drawPath(shape)
    p.setBrush(fill)
    p.drawPath(shape)
    rim = QLinearGradient(r.left(), r.top(), r.right(), r.bottom())
    rim.setColorAt(0, QColor(255, 255, 255, 120))
    rim.setColorAt(0.45, QColor(255, 255, 255, 30))
    rim.setColorAt(1, QColor(255, 255, 255, 64))
    p.setPen(QPen(rim, 1))
    p.setBrush(Qt.NoBrush)
    p.drawPath(shape)


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
            cut(p, r, 18, 18)
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
    """A module of the central, headed like the Hub's Painel (28 Oct, Marco: the dashboard of the video, «super
    organizado»): its number faint, its name in spaced small capitals, a note beside it, and on the right what opens
    more (`note`, e.g. «VER ›»). Then its content."""

    def __init__(self, title: str = "", note: str = "", num: str = ""):
        super().__init__()
        self.box = QVBoxLayout(self)
        self.box.setContentsMargins(14, 12, 14, 10)
        self.box.setSpacing(4)
        self.note = None
        if title:
            head = QHBoxLayout()
            head.setSpacing(7)
            if num:
                head.addWidget(label(num, 7.5, FAINT, QFont.DemiBold, MONO))
            head.addWidget(label(title.upper(), 7.8, "#d5d8dc", QFont.Bold, UI, spacing=1.8))
            self.sub = label("", 7.8, MUTED)
            head.addWidget(self.sub)
            head.addStretch(1)
            self.note = label(note, 7.5, MUTED, QFont.Bold, UI, spacing=1.2)
            head.addWidget(self.note)
            self.box.addLayout(head)
            self.box.addSpacing(4)
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
        cut(p, QRectF(0, 0, self.width(), h), h / 2, h / 2)
        if self._glide.value > 0:
            p.setBrush(self._colour)
            cut(p, QRectF(0, 0, max(h, self.width() * self._glide.value), h), h / 2, h / 2)


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
        cut(p, r, 12, 12)
        pill = QPainterPath()
        pill.addPath(cut_path(r, 12, 12))
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
    """The central's top card: the time in chrome on the left and the day written out on the right, big enough to read
    at a glance (28 Oct, Marco: «quase nem consigo ver o que dia é nem o mês»). The figures that open things are the
    row under it (Kpi). Repaints once a minute and when the day turns, nothing else."""
    H = 70

    def __init__(self):
        super().__init__()
        self.setFixedSize(INNER, self.H)
        self._f_time = font(30, QFont.DemiBold, DISPLAY)
        self._f_day, self._f_date = font(7.5, QFont.Bold, UI, spacing=1.8), font(12, QFont.DemiBold, DISPLAY)
        self._minute = QTimer(self)    # the time on the card changes once a minute: one repaint then
        self._minute.setSingleShot(True)
        self._minute.timeout.connect(self._next_minute)

    def set_status(self, *_args, **_kw):
        """Kept for the callers of before: how things are is said by the figures under the card now."""

    def showEvent(self, e):
        super().showEvent(e)
        self._next_minute()

    def hideEvent(self, e):
        super().hideEvent(e)
        self._minute.stop()

    def _next_minute(self):
        self.update()
        if self.isVisible():
            self._minute.start(int((60 - time.time() % 60) * 1000) + 20)

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        r = QRectF(0, 0, self.width(), self.H)
        p.setPen(QPen(QColor(255, 255, 255, 18), 1))
        p.setBrush(QColor(0, 0, 0))
        cut(p, r.adjusted(0.5, 0.5, -0.5, -0.5), 20, 20)
        glow_disc(p, QPointF(r.width() * 0.3, -10), r.width() * 0.5, 40, "#ffffff", 0.05)
        now = datetime.now()
        chrome_text(p, QPointF(20, self.H / 2 + QFontMetricsF(self._f_time).capHeight() / 2), self._f_time, now.strftime("%H:%M"))
        p.setFont(self._f_day)
        p.setPen(QColor(MUTED))
        p.drawText(QRectF(0, 17, r.width() - 20, 14), Qt.AlignRight | Qt.AlignVCenter, WEEKDAYS[now.weekday()].upper())
        p.setFont(self._f_date)
        p.setPen(QColor(TEXT))
        p.drawText(QRectF(0, 33, r.width() - 20, 22), Qt.AlignRight | Qt.AlignVCenter, f"{now.day} de {MONTHS[now.month - 1]}")


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
        cut(p, bar, 1.5, 1.5)
        if self._glide.value > 0.002:
            p.setBrush(QColor(getattr(self, "_colour", None) or meter_color(self._pct or 0)))
            cut(p, QRectF(0, bar.top(), max(3, w * self._glide.value), 3), 1.5, 1.5)


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
    PICTURE = QRect(0, 0, 45, 44)   # the picture with its rings and dot (paintEvent, on a row 44 tall)
    MOTION = max(RINGS * RING, BREATHS * BREATH)   # seconds the rings move after a change
    GAUGE = 32   # one of the two Claude limit rings on the right

    def __init__(self):
        super().__init__()
        self.setFixedHeight(44)   # 24 Oct, Marco: the team rows were «tão grande»
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
        photos().ready.connect(self.update)
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
        t = time.perf_counter() - self._from
        if t < self.MOTION and t - self._t < DECOR_DT:
            return   # the rings breathe slowly: 30 frames a second, not the screen's 165
        self._t = t
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
        self._settle()   # the rings move when something changes, not each time the central opens

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
        plan = (person.get("live") or {}).get("limits") or {}
        self.setToolTip("\n".join(f"{name}: {round(plan[k])}% usado" + (f" · {until(plan.get(k + '_reset'))}" if plan.get(k + "_reset") else "")
                                  for k, name in (("five", "Claude 5 h"), ("week", "Semana")) if plan.get(k) is not None))
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
        pic = photos().photo(person.get("user", ""), 36, self.devicePixelRatioF())   # their GitHub photo (28 Oct), else the star
        if pic is not None:
            p.setRenderHint(QPainter.SmoothPixmapTransform)
            p.setOpacity(1.0 if online else 0.45)
            p.drawPixmap(av.topLeft(), pic)
            p.setOpacity(1.0)
        else:
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
        p.drawText(QRectF(48, 3, 150, 18), Qt.AlignLeft | Qt.AlignVCenter, person["name"])
        if self._me:  # which row is yours
            tag = QRectF(48 + QFontMetricsF(self._f_name).horizontalAdvance(person["name"]) + 7, 6, 22, 13)
            p.setPen(Qt.NoPen)
            p.setBrush(rgba(COLORS["ONLINE"] if online else MUTED, 0.2))
            cut(p, tag, 6.5, 6.5)
            p.setPen(QColor(COLORS["ONLINE"] if online else MUTED))
            p.setFont(self._f_tag)
            p.drawText(tag, Qt.AlignCenter, "TU")
        # on the right, their Claude: the 5 h session and the week, as two small rings (23 Oct, Marco: «os limites do
        # Claude do Kovel e do David, são os importantes»; the clock-in left the cockpit, it is in the Hub)
        # (24 Oct: the same gauges as the minimized clock's, «os tokens semanais, diários do pessoal»)
        plan = (person.get("live") or {}).get("limits") or {}
        right = w - 2 * self.GAUGE - 8
        for i, (key, name) in enumerate((("five", "5 h"), ("week", "sem."))):
            pct = plan.get(key)
            ring = QRectF(right + 6 + i * (self.GAUGE + 2) + (self.GAUGE - 27) / 2, 1, 27, 27)
            paint_gauge(p, ring, [(pct / 100, meter_color(pct))] if pct is not None else [],
                        "—" if pct is None else f"{round(pct)}", f_value=self._f_gauge, ink=TEXT if pct is not None else FAINT,
                        disc=False, dpr=self.devicePixelRatioF())
            p.setPen(QColor(FAINT))
            p.setFont(self._f_small)
            p.drawText(QRectF(ring.center().x() - 20, ring.bottom() + 1, 40, 12), Qt.AlignHCenter | Qt.AlignTop, name)
        # the second line says what they are doing: their Claude windows, the task, or whether they are here
        doing, colour = activity({**person, "_me": self._me})
        p.setPen(QColor(colour))
        p.setFont(self._f_state)
        p.drawText(QRectF(48, 22, right - 48, 16), Qt.AlignLeft | Qt.AlignVCenter,
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
        body = QLinearGradient(0, 0, 0, size)   # frosted glass (28 Oct, as in the «Glassy Dashboard» reel)
        body.setColorAt(0, QColor(255, 255, 255, 78))
        body.setColorAt(0.55, QColor(255, 255, 255, 34))
        body.setColorAt(1, QColor(255, 255, 255, 22))
        p.setPen(Qt.NoPen)
        p.setBrush(QColor(14, 16, 22, 70))
        cut(p, r, radius, radius)
        p.setPen(Qt.NoPen)
        p.setBrush(body)
        cut(p, r, radius, radius)
        sheen = QLinearGradient(0, 0, 0, size * 0.55)
        sheen.setColorAt(0, QColor(255, 255, 255, 30))
        sheen.setColorAt(1, QColor(255, 255, 255, 0))
        p.setBrush(sheen)
        cut(p, r.adjusted(1, 1, -1, -size * 0.45), radius - 1, radius - 1)
        rim = QLinearGradient(0, 0, size, size)
        rim.setColorAt(0, QColor(255, 255, 255, 120))
        rim.setColorAt(0.45, QColor(255, 255, 255, 22))
        rim.setColorAt(1, QColor(255, 255, 255, 60))
        p.setBrush(Qt.NoBrush)
        p.setPen(QPen(rim, 1))
        cut(p, r, radius, radius)
        if glyph == "hub":
            paint_star(p, QRectF(size * 0.14, size * 0.14, size * 0.72, size * 0.72))
        else:
            # the glyph in chrome: white at the top, steel at the foot
            svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><defs><linearGradient id="c" x1="0" y1="0" x2="0" y2="1">'
                   '<stop offset="0" stop-color="#ffffff"/><stop offset="0.5" stop-color="#e2e5ea"/><stop offset="1" stop-color="#9299a3"/>'
                   '</linearGradient></defs><g fill="none" stroke="url(#c)" stroke-width="1.8" stroke-linecap="round" '
                   f'stroke-linejoin="round">{APP_GLYPHS[glyph]}</g></svg>')
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
        shape.addPath(cut_path(icon, self.ICON * 0.27, self.ICON * 0.27))
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
            cut(p, pill, 9, 9)
            p.setPen(QColor(WHITE))
            p.setFont(self._f_count)
            p.drawText(pill, Qt.AlignCenter, text)
        p.restore()
        p.setPen(QColor(TEXT) if self.hover > 0.5 else QColor("#c9ccd1"))
        p.setFont(self._f_name)
        p.drawText(QRectF(0, icon.bottom() + 5, self.width(), 14), Qt.AlignHCenter | Qt.AlignTop, self.name)


def window_doing(w: dict, me=True) -> str:
    """What one Claude window is doing, in a few words: its action, or what it waits for."""
    if w.get("state") == "working":
        what = w.get("action") or "a trabalhar"
    elif w.get("wait") == "permission":
        what = "Precisa da tua autorização" if me else "Precisa da autorização dele"
    elif w.get("wait") == "answer":
        what = "Fez-te uma pergunta" if me else "Fez-lhe uma pergunta"
    else:
        what = "Acabou, à espera do próximo pedido"
    if w.get("project"):
        what = f"{w['project']} · {what}"
    return what[0].upper() + what[1:]


def live_windows(live: dict) -> list:
    """A partner's Claude windows working or waiting, the ones waiting for an answer first, then the ones working."""
    rank = {"permission": 0, "answer": 0}
    return sorted(live.get("windows") or [], key=lambda w: rank.get(w.get("wait"), 1 if w.get("state") == "working" else 2))


def window_colour(w: dict) -> str:
    return (COLORS["WORKING"] if w.get("state") == "working" else COLORS["WAITING"] if w.get("wait") in ("permission", "answer")
            else MUTED)


class ClaudeRow(Hover):
    """One Claude window working or waiting, under its partner in the central's Equipa (28 Oct, Marco: «controlar o meu, o
    do Kovel e o do David»): a dot in the state's colour, what it is about, and what it is doing right now (or what it
    waits for), with how long it has been like that. A click opens the Escritório.
    Not a stream: it changes when the Hub's reading changes (every 8 s), and draws nothing in between."""
    H = 34

    def __init__(self):
        super().__init__()
        self.setFixedHeight(self.H)
        self.window_, self.me = None, True
        self.indent = 0   # px from the left (44: under a partner's name, past their photo)
        self.setToolTip("Abrir no Escritório")
        self._f_topic, self._f_action, self._f_time = font(8.5, QFont.DemiBold, UI), font(7.5, QFont.Normal, UI), font(7, QFont.Normal, UI)

    def show_window(self, w: dict, me=True):
        if (w, me) != (self.window_, self.me):
            self.window_, self.me = w, me
            self.update()

    def paintEvent(self, _):
        w = self.window_
        if not w:
            return
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        r = QRectF(self.rect()).adjusted(self.indent, 1, 0, -1)
        p.setPen(Qt.NoPen)
        p.setBrush(QColor(255, 255, 255, int(6 + 14 * self.hover)))
        cut(p, r, 9, 9)
        shape = QPainterPath()
        shape.addPath(cut_path(r, 9, 9))
        self.paint_wave(p, shape)
        asks = w.get("wait") in ("permission", "answer")
        colour = window_colour(w)
        dot = QPointF(r.left() + 10, r.center().y())
        glow_disc(p, dot, 7, 7, colour, 0.35)
        p.setBrush(QColor(colour))
        p.drawEllipse(dot, 3, 3)
        since = ago_iso(w.get("since"))
        p.setFont(self._f_time)
        tw = QFontMetricsF(self._f_time).horizontalAdvance(since) + 4
        p.setPen(QColor(FAINT))
        p.drawText(QRectF(r.right() - tw - 8, r.top() + 2, tw, 15), Qt.AlignRight | Qt.AlignVCenter, since)
        topic = w.get("topic") or w.get("project") or "Janela do Claude"
        left = r.left() + 20
        p.setPen(QColor(TEXT))
        p.setFont(self._f_topic)
        p.drawText(QRectF(left, r.top() + 2, r.right() - left - tw - 10, 15), Qt.AlignLeft | Qt.AlignVCenter,
                   QFontMetricsF(self._f_topic).elidedText(topic, Qt.ElideRight, r.right() - left - tw - 12))
        p.setPen(QColor(COLORS["WAITING"] if asks else MUTED))
        p.setFont(self._f_action)
        p.drawText(QRectF(left, r.top() + 16, r.right() - left - 8, 14), Qt.AlignLeft | Qt.AlignVCenter,
                   QFontMetricsF(self._f_action).elidedText(window_doing(w, self.me), Qt.ElideRight, r.right() - left - 10))


class Kpi(Hover):
    """One figure of the central's top row, as the Hub's Painel (ui.kpi): a round icon, the figure big, its name under
    it. The first of the row is lit (raised graphite, a chrome disc); the rest are dark glass. A click opens its destaque."""
    H = 84

    def __init__(self, key: str, name: str, lit=False):
        super().__init__()
        self.key, self.name, self.lit = key, name, lit
        self.value, self.colour = "—", TEXT
        self.setFixedHeight(self.H)
        self.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)
        self._f_value, self._f_name = font(17, QFont.DemiBold, DISPLAY), font(7.5, QFont.DemiBold, UI)

    def set(self, value: str, colour=TEXT, tip=""):
        if (value, colour) != (self.value, self.colour):
            self.value, self.colour = value, colour
            self.update()
        if tip != self.toolTip():
            self.setToolTip(tip)

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        r = QRectF(self.rect()).adjusted(0.5 + self.press, 0.5 + self.press, -0.5 - self.press, -0.5 - self.press)
        shape = QPainterPath()
        shape.addPath(cut_path(r, 16, 16))
        if self.lit:
            body = QLinearGradient(0, r.top(), 0, r.bottom())
            body.setColorAt(0, QColor(50, 52, 58))
            body.setColorAt(1, QColor(26, 27, 31))
            p.setPen(QPen(QColor(255, 255, 255, 46 + int(30 * self.hover)), 1))
            p.setBrush(body)
        else:
            p.setPen(QPen(QColor(255, 255, 255, 16 + int(26 * self.hover)), 1))
            p.setBrush(QColor(255, 255, 255, 8 + int(10 * self.hover)))
        p.drawPath(shape)
        self.paint_wave(p, shape)
        disc = QRectF(r.left() + 10, r.top() + 10, 26, 26)
        if self.lit:
            chrome = QLinearGradient(0, disc.top(), 0, disc.bottom())
            chrome.setColorAt(0, QColor(238, 240, 244))
            chrome.setColorAt(1, QColor(160, 166, 174))
            p.setPen(Qt.NoPen)
            p.setBrush(chrome)
        else:
            p.setPen(QPen(QColor(255, 255, 255, 30), 1))
            p.setBrush(QColor(255, 255, 255, 12))
        p.drawEllipse(disc)
        p.drawPixmap(QPointF(disc.center().x() - 7, disc.center().y() - 7),
                     glyph(self.key, 14, "#0b0b0d" if self.lit else "#d5d8dc", self.devicePixelRatioF()))
        p.setFont(self._f_value)
        p.setPen(QColor(self.colour))
        p.drawText(QRectF(r.left() + 11, r.top() + 38, r.width() - 14, 26), Qt.AlignLeft | Qt.AlignVCenter,
                   QFontMetricsF(self._f_value).elidedText(self.value, Qt.ElideRight, r.width() - 14))
        p.setFont(self._f_name)
        p.setPen(QColor(TEXT if self.hover > 0.5 else "#aeb3ba"))
        p.drawText(QRectF(r.left() + 11, r.top() + 62, r.width() - 14, 14), Qt.AlignLeft | Qt.AlignVCenter, self.name)


class TeamPick(QWidget):
    """The partners as three big photos, like «A tua equipa» on the Hub's Início: a ring in their state's colour (green
    with a Claude working, amber when one waits for an answer), their name, and how many Claudes they have working. A
    click picks whose Claudes and limits show under it (28 Oct, Marco: «controlar o meu, o do Kovel e o do David»)."""
    H, PHOTO = 92, 50

    def __init__(self, on_pick):
        super().__init__()
        self.setFixedHeight(self.H)
        self.setMouseTracking(True)
        self.setCursor(Qt.PointingHandCursor)
        self.on_pick = on_pick
        self.people, self.picked, self.me, self._hot = [], None, None, None
        self._f_name, self._f_state = font(9, QFont.DemiBold, UI), font(7.5, QFont.Normal, UI)
        photos().ready.connect(self.update)

    def set(self, people: list, picked, me):
        if (people, picked, me) != (self.people, self.picked, self.me):
            self.people, self.picked, self.me = people, picked, me
            self.update()

    def _cells(self) -> list:
        n = max(1, len(self.people))
        w = self.width() / n
        return [(p, QRectF(i * w, 0, w, self.H)) for i, p in enumerate(self.people)]

    def _at(self, pos):
        return next((p["user"] for p, r in self._cells() if r.contains(QPointF(pos))), None)

    def mouseMoveEvent(self, e):
        hot = self._at(e.position())
        if hot != self._hot:
            self._hot = hot
            self.update()

    def leaveEvent(self, e):
        self._hot = None
        self.update()

    def mousePressEvent(self, e):
        who = self._at(e.position())
        if who and e.button() == Qt.LeftButton:
            self.on_pick(who)

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        p.setRenderHint(QPainter.SmoothPixmapTransform)
        dpr = self.devicePixelRatioF()
        for person, cell in self._cells():
            live = person.get("live") or {}
            picked = person["user"] == self.picked
            if picked or person["user"] == self._hot:
                p.setPen(QPen(QColor(255, 255, 255, 34 if picked else 16), 1))
                p.setBrush(QColor(255, 255, 255, 14 if picked else 7))
                cut(p, cell.adjusted(3, 0, -3, 0), 16, 16)
            s = self.PHOTO
            box = QRectF(cell.center().x() - s / 2, 8, s, s)
            online = bool(person.get("online"))
            pic = photos().photo(person["user"], s, dpr)
            p.setOpacity(1.0 if online else 0.45)
            if pic is not None:
                p.drawPixmap(box.topLeft(), pic)
            else:
                p.drawPixmap(box.toRect(), avatar(online, dpr))
            p.setOpacity(1.0)
            asks = live.get("waiting") and live.get("wait") in ("permission", "answer")
            ring = COLORS["WAITING"] if asks else COLORS["WORKING"] if live.get("working") else None
            p.setBrush(Qt.NoBrush)
            if ring:
                p.setPen(QPen(QColor(ring), 2.2))
                p.drawEllipse(box.adjusted(-3, -3, 3, 3))
            elif picked:
                p.setPen(QPen(QColor(255, 255, 255, 150), 1.6))
                p.drawEllipse(box.adjusted(-3, -3, 3, 3))
            dot = QPointF(box.right() - 4, box.bottom() - 4)
            p.setPen(QPen(QColor(14, 14, 16), 2.5))
            p.setBrush(QColor(COLORS["ONLINE"] if online else COLORS["OFFLINE"]))
            p.drawEllipse(dot, 4.6, 4.6)
            name = "Tu" if person["user"] == self.me else person.get("name", "")
            p.setFont(self._f_name)
            p.setPen(QColor(TEXT if online or picked else MUTED))
            p.drawText(QRectF(cell.left(), box.bottom() + 5, cell.width(), 15), Qt.AlignHCenter | Qt.AlignVCenter, name)
            n = live.get("working") or 0
            if asks:
                state = "Espera por ti" if person["user"] == self.me else "À espera"
            elif n:
                state = f"{n} Claude{'s' if n > 1 else ''}"
            else:
                state = "online" if online else "offline"
            p.setFont(self._f_state)
            p.setPen(QColor(COLORS["WAITING"] if asks else COLORS["WORKING"] if n else FAINT))
            p.drawText(QRectF(cell.left(), box.bottom() + 19, cell.width(), 13), Qt.AlignHCenter | Qt.AlignVCenter, state)


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


GAUGE_GLYPHS = {   # the clock's complications and the central's controls (24-unit strokes, like the apps)
    "claude": '<rect x="3" y="4.5" width="18" height="15" rx="3.5"/><path d="M7.5 9.8l2.8 2.4-2.8 2.4M13 14.8h3.5"/>',
    "tokens": '<path d="M13.2 2.8L5.5 13.2h5.8l-1 8 7.7-10.4h-5.8z"/>',
    "equipa": ('<circle cx="9" cy="8.6" r="3.1"/><path d="M3.6 19.4a5.4 5.4 0 0110.8 0"/><circle cx="16.6" cy="9.6" r="2.5"/>'
               '<path d="M15.8 14.3a4.5 4.5 0 014.6 5.1"/>'),
    "mensagens": '<path d="M20.5 11.5a8 8 0 01-11.8 7l-4.7 1.3 1.3-4.4A8 8 0 1120.5 11.5z"/>',
    "tarefas": '<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><path d="M8 12.2l2.8 2.8 5.2-6"/>',
    "ponto": '<circle cx="12" cy="13.2" r="7.6"/><path d="M12 9.4v3.8l2.6 1.6M9.6 2.8h4.8M18.6 6.4l1.4-1.4"/>',
    "camaras": '<rect x="3" y="6.5" width="13" height="11" rx="2.5"/><path d="M16 10.5l5-3v9l-5-3z"/>',
    "trading": '<path d="M3.5 17l5.5-5.5 4 4 7.5-7.5"/><path d="M15 8h5.5v5.5"/>',
    "pausa": '<rect x="6.8" y="5.5" width="3.4" height="13" rx="1.2"/><rect x="13.8" y="5.5" width="3.4" height="13" rx="1.2"/>',
    "play": '<path d="M8.5 5.6v12.8l10-6.4z"/>',
    "parar": '<rect x="6.5" y="6.5" width="11" height="11" rx="2.6"/>',
    "cima": '<path d="M9.2 3.5h5.6l-.9 5.6 3.6 3.9H6.5l3.6-3.9z"/><path d="M12 13v7.5"/>',
    "invisivel": '<path d="M19.8 14.6A8 8 0 019.4 4.2a8 8 0 1010.4 10.4z"/>',
    "hub": '<path d="M14.5 4.5h5v5M9.5 19.5h-5v-5M19.5 4.5l-6 6M4.5 19.5l6-6"/>',
}
# What can sit under the minimized clock, in this order (24 Oct, Marco: «quando seleciono "tokens" aquilo fica tipo um ícone
# a combinar de forma com o relógio... funcional o suficiente para não ter que abrir o Hub todo... opções que combinem com a
# funcionalidade de uma empresa»)
GAUGES = (("claude", "Claude"), ("tokens", "Tokens"), ("equipa", "Equipa"), ("mensagens", "Mensagens"),
          ("tarefas", "Tarefas"), ("ponto", "Ponto"), ("camaras", "Câmaras"), ("trading", "FundedNext"))
PINS_BEFORE = {"janelas": "claude", "limites": "tokens"}   # the choices' names before 24 Oct
DEFAULT_PINS = ["claude", "tokens", "equipa", "mensagens"]
SWEEP = 270   # degrees of a gauge's arc: open at the bottom, where its glyph sits, as on the iPhone's lock screen
_glyphs: dict[tuple, QPixmap] = {}


def glyph(key: str, size: float, colour: str, dpr: float, width=1.9) -> QPixmap:
    """A glyph of GAUGE_GLYPHS in one colour; drawn once per size, colour and screen density."""
    k = (key, size, colour, round(dpr, 2), width)
    if k not in _glyphs:
        pix = QPixmap(round(size * dpr), round(size * dpr))
        pix.setDevicePixelRatio(dpr)
        pix.fill(Qt.transparent)
        p = QPainter(pix)
        p.setRenderHint(QPainter.Antialiasing)
        svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="{colour}" stroke-width="{width}" '
               f'stroke-linecap="round" stroke-linejoin="round">{GAUGE_GLYPHS[key]}</svg>')
        QSvgRenderer(QByteArray(svg.encode())).render(p, QRectF(0, 0, size, size))
        p.end()
        _glyphs[k] = pix
    return _glyphs[k]


def blend(a: QColor, b: QColor, k: float) -> QColor:
    return QColor(int(a.red() + (b.red() - a.red()) * k), int(a.green() + (b.green() - a.green()) * k),
                  int(a.blue() + (b.blue() - a.blue()) * k), int(a.alpha() + (b.alpha() - a.alpha()) * k))


def paint_gauge(p: QPainter, r: QRectF, arcs, value="", key=None, segments=None, f_value=None, ink=TEXT, disc=True, dpr=1.0):
    """A complication as on the iPhone's lock screen: a translucent disc, an arc of 270° open at the bottom that fills
    clockwise (`arcs`: [(how full 0..1, colour)], the outer one first, each further one inside it), the glyph in the
    opening and the figure in the middle. `segments` splits the outer arc into one piece per colour (the partners)."""
    s, c = r.width(), r.center()
    w = max(2.2, s * 0.072)
    p.save()
    if disc:
        p.setPen(Qt.NoPen)
        p.setBrush(QColor(255, 255, 255, 16))
        p.drawEllipse(c, s / 2, s / 2)
    radius = s / 2 - w / 2 - (2.6 if disc else 0.6)
    inner = radius - w / 2
    p.setBrush(Qt.NoBrush)
    for i in range(max(1, len(arcs))):
        frac, colour = arcs[i] if i < len(arcs) else (0, WHITE)
        box = QRectF(c.x() - radius, c.y() - radius, 2 * radius, 2 * radius)
        if i == 0 and segments:
            gap = 10
            each = (SWEEP - gap * (len(segments) - 1)) / len(segments)
            for j, col in enumerate(segments):
                p.setPen(pen(QColor(col), w))
                p.drawArc(box, round((225 - j * (each + gap)) * 16), -round(each * 16))
        else:
            p.setPen(pen(QColor(255, 255, 255, 36), w))
            p.drawArc(box, 225 * 16, -SWEEP * 16)
            if frac > 0.004:
                p.setPen(pen(QColor(colour), w))
                p.drawArc(box, 225 * 16, -round(SWEEP * 16 * min(1.0, frac)))
        inner = radius - w / 2
        radius -= w + 1.6
    if key:
        g = round(s * 0.25)
        outer = s / 2 - w / 2 - (2.6 if disc else 0.6)
        p.drawPixmap(QPointF(c.x() - g / 2, c.y() + outer * 0.74 - g / 2), glyph(key, g, "#c9ced6", dpr, 2.1))
    if value:
        f = QFont(f_value or font(10, QFont.DemiBold, DISPLAY))
        room = inner * 2 * (0.9 if len(arcs) < 2 else 0.74)   # inside two rings the figure has less room
        while (QFontMetricsF(f).horizontalAdvance(value) > room or QFontMetricsF(f).capHeight() > inner * 0.8) and f.pointSizeF() > 6:
            f.setPointSizeF(f.pointSizeF() - 0.5)
        p.setFont(f)
        p.setPen(QColor(ink))
        lift = s * 0.06 if key else 0
        p.drawText(QRectF(c.x() - inner, c.y() - inner - lift, 2 * inner, 2 * inner), Qt.AlignCenter, value)
    p.restore()


def paint_chip(p: QPainter, r: QRectF, key: str, g, f_value: QFont, hot=False, dpr=1.0):
    """An option on the minimized card, small: a capsule of glass with a tiny ring (the gauge's arc, or one piece per
    partner) round the option's glyph, and the figure beside it in the gauge's colour."""
    p.save()
    p.setPen(QPen(QColor(255, 255, 255, 70 if hot else 34), 1))
    p.setBrush(QColor(28, 29, 33, 225) if hot else QColor(10, 10, 12, 190))   # its own dark capsule: reads on any desktop
    cut(p, r.adjusted(0.5, 0.5, -0.5, -0.5), r.height() / 2, r.height() / 2)
    c = QPointF(r.left() + 12.5, r.center().y())
    ring = QRectF(c.x() - 8, c.y() - 8, 16, 16)
    p.setBrush(Qt.NoBrush)
    if g.segments:
        gap = 24
        each = (SWEEP - gap * (len(g.segments) - 1)) / len(g.segments)
        for j, col in enumerate(g.segments):
            p.setPen(pen(QColor(col), 1.7))
            p.drawArc(ring, round((225 - j * (each + gap)) * 16), -round(each * 16))
    else:
        p.setPen(pen(QColor(255, 255, 255, 40), 1.7))
        p.drawArc(ring, 225 * 16, -SWEEP * 16)
        if g.arcs and g.arcs[0][0] > 0.004:
            p.setPen(pen(QColor(g.arcs[0][1]), 1.7))
            p.drawArc(ring, 225 * 16, -round(SWEEP * 16 * min(1.0, g.arcs[0][0])))
    p.drawPixmap(QPointF(c.x() - 5, c.y() - 5), glyph(key, 10, "#eef0f3", dpr, 2.3))
    p.setFont(f_value)
    p.setPen(QColor(g.ink))
    p.drawText(QRectF(r.left() + 25, r.top(), r.width() - 28, r.height()), Qt.AlignLeft | Qt.AlignVCenter, g.value or "—")
    p.restore()


class Gauge:
    """What one complication says: its arcs, the outer arc in segments (one per partner) or not, the figure inside and
    its colour, and the line its tooltip shows. set() says whether anything changed, so the card repaints only then."""

    def __init__(self, tip="A ler o Hub…"):
        self.arcs, self.value, self.tip, self.segments, self.ink = [], "", tip, None, TEXT

    def set(self, arcs, value, tip, segments=None, ink=TEXT) -> bool:
        new = ([(round(f, 3), c) for f, c in arcs], value, tip, segments, ink)
        if new == (self.arcs, self.value, self.tip, self.segments, self.ink):
            return False
        self.arcs, self.value, self.tip, self.segments, self.ink = new
        return True


class Toggle(Hover):
    """One choice of «No relógio»: the complication's glyph over its name in a rounded tile. On, the tile is polished
    chrome with a dark glyph, like an iOS Control Centre button; off, dark glass. It slides between the two."""
    changed = Signal()

    def __init__(self, key: str, name: str, on: bool):
        super().__init__()
        self.key, self.name, self.on = key, name, on
        self._lit = 1.0 if on else 0.0
        self._fade = animate(self, 220, lambda v: self._set("_lit", v), curve=QEasingCurve.OutCubic)
        self.setFixedHeight(44)
        self.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)
        self._f = font(7.5, QFont.DemiBold, UI)
        self._tip()

    def _tip(self):
        self.setToolTip(f"Tirar «{self.name}» do relógio" if self.on else f"Pôr «{self.name}» no relógio quando minimizas")

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
        body.setColorAt(0, blend(QColor(255, 255, 255, 64), QColor(244, 246, 250, 235), lit))   # glass, white when lit
        body.setColorAt(1, blend(QColor(255, 255, 255, 22), QColor(200, 205, 214, 225), lit))
        p.setPen(QPen(QColor(255, 255, 255, int(30 + 50 * lit + 30 * self.hover)), 1))
        p.setBrush(body)
        cut(p, r, 14, 14)
        icon = glyph(self.key, 17, "#0b0b0d" if lit > 0.5 else "#aeb3ba", self.devicePixelRatioF())
        p.drawPixmap(QPointF(r.center().x() - 8.5, r.top() + 6), icon)
        v = int(170 + (11 - 170) * lit)
        p.setPen(QColor(v, v, v + 2))
        p.setFont(self._f)
        p.drawText(QRectF(r.left(), r.top() + 24, r.width(), 16), Qt.AlignHCenter | Qt.AlignVCenter, self.name)


class Control(Hover):
    """A Control Centre button of the central (24 Oct, Marco: «mete todos os botões que estão no widget na central de
    comando»: what was only in the tray menu): a round button with its glyph and its name under it. On (the clock
    running, the widget on top, invisible) it is polished chrome with a dark glyph; off, dark glass. `danger` glyphs are red."""
    D = 40

    def __init__(self, key: str, name: str, tip="", danger=False):
        super().__init__()
        self.key, self.name, self.on, self.danger = key, name, False, danger
        self._lit = 0.0
        self._fade = animate(self, 220, lambda v: self._set("_lit", v))
        self.setFixedHeight(self.D + 20)
        self.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)
        self.setToolTip(tip)
        self._f = font(7.5, QFont.DemiBold, UI)

    def show_as(self, on: bool, key=None, name=None, tip=None, enabled=True):
        if tip is not None and tip != self.toolTip():
            self.setToolTip(tip)
        if (key or self.key, name or self.name, enabled) != (self.key, self.name, self.isEnabled()):
            self.key, self.name = key or self.key, name or self.name
            self.setEnabled(enabled)
            self.setCursor(Qt.PointingHandCursor if enabled else Qt.ArrowCursor)
            self.update()
        if on != self.on:
            self.on = on
            self._to(self._fade, self._lit, 1 if on else 0)

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        if not self.isEnabled():
            p.setOpacity(0.35)
        lit = self._lit
        c = QPointF(self.width() / 2, self.D / 2 + 1)
        rad = self.D / 2 - 1 - 1.5 * self.press
        body = QLinearGradient(0, c.y() - rad, 0, c.y() + rad)
        body.setColorAt(0, blend(QColor(255, 255, 255, 70), QColor(244, 246, 250, 235), lit))   # glass, white when lit
        body.setColorAt(1, blend(QColor(255, 255, 255, 24), QColor(200, 205, 214, 225), lit))
        p.setPen(QPen(QColor(255, 255, 255, int(70 + 50 * lit + 40 * self.hover)), 1))
        p.setBrush(body)
        p.drawEllipse(c, rad, rad)
        disc = QPainterPath()
        disc.addEllipse(c, rad, rad)
        self.paint_wave(p, disc)
        ink = "#0b0b0d" if lit > 0.5 else "#ff6961" if self.danger else "#eef0f3"
        p.drawPixmap(QPointF(c.x() - 9, c.y() - 9), glyph(self.key, 18, ink, self.devicePixelRatioF()))
        p.setPen(QColor("#c9ccd1") if self.hover < 0.5 else QColor(TEXT))
        p.setFont(self._f)
        p.drawText(QRectF(0, self.D + 4, self.width(), 14), Qt.AlignHCenter | Qt.AlignVCenter, self.name)


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
    n = live.get("working") or 0
    if n:   # 28 Oct, Marco: «podia estar a dizer: dois Claudes a trabalhar... o Kovel: três agentes a trabalhar»
        what = "1 Claude a trabalhar" if n == 1 else f"{n} Claudes a trabalhar"
        return f"{what} · {topic}" if topic and n == 1 else what, COLORS["WORKING"]
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


DAYS = ["SEG", "TER", "QUA", "QUI", "SEX", "SÁB", "DOM"]
MONTHS_SHORT = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"]


def chrome_text(p: QPainter, at: QPointF, f: QFont, text: str):
    """Text in polished chrome (white at the top, steel at the foot) over a soft shadow: the time, as on the car's badges."""
    path = QPainterPath()
    path.addText(at, f, text)
    cap = QFontMetricsF(f).capHeight()
    p.save()
    p.setPen(Qt.NoPen)
    p.translate(0, 1.2)
    p.fillPath(path, QColor(0, 0, 0, 120))
    p.translate(0, -1.2)
    chrome = QLinearGradient(0, at.y() - cap, 0, at.y())
    chrome.setColorAt(0, QColor("#ffffff"))
    chrome.setColorAt(0.5, QColor("#e4e7eb"))
    chrome.setColorAt(0.52, QColor("#cfd3d9"))
    chrome.setColorAt(1, QColor("#9aa1aa"))
    p.fillPath(path, chrome)
    p.restore()


class Orb(QWidget):
    """The widget at its smallest, transparent on the desktop (24 Oct, Marco, after the card of dark glass: «não curti...
    mete tipo transparente, como tava antes... tá grande»). No card: only a soft dark shadow under the star, the time and
    the badge (always the same, never switching colour by the wallpaper), so it reads on light and dark; each chip keeps
    its own small dark capsule.

    The Mercedes star on the left. On the right, on top, a row of small chips, one per option switched on in the
    central (GAUGES: Claude, Tokens, Equipa, Mensagens, Tarefas, Ponto, Câmaras, FundedNext): a tiny ring with the glyph
    inside, coloured by how it is, and the figure beside it. Under them the time in chrome, and under the time the AMG
    badge with the date (or, in amber or red, what needs this person: a Claude waiting, the Hub down). Up to four chips
    in a row, then two rows. The mouse over a chip shows its line; a click does what it is for (the window's on_icon); a
    click elsewhere opens the central; dragging moves the card and nothing else. It reads the same on any wallpaper.

    It paints a cached face and only repaints when the minute, a figure, the line or the count changes, or under the mouse."""
    PAD, STAR, RADIUS, M = 8, 46, 22, 14
    CHIP_H, CHIP_GAP, PER_ROW = 20, 4, 4
    X0 = PAD + STAR + 10      # where the right column (chips, time, badge) begins
    on_icon = None            # the window: what a click on a chip does
    on_drag = None            # the window: the card started moving (the destaque closes)

    def __init__(self, on_click):
        super().__init__()
        self.setCursor(Qt.PointingHandCursor)
        self.setMouseTracking(True)
        self._on_click = on_click
        self.fade = 1.0
        self._hover, self._down = 0.0, 0.0
        self._hover_anim = animate(self, 200, lambda v: self._set("_hover", v))
        self._down_anim = animate(self, 110, lambda v: self._set("_down", v))
        self._press_at, self._grab, self._dragged = None, None, False
        self._face, self._face_key = None, None
        self._count, self._hot = 0, None
        self.line, self.line_colour = "", MUTED   # what the line over the time says instead of the date
        self.items: list = []
        self._f_time = font(24, QFont.DemiBold, DISPLAY)
        self._f_line = font(8, QFont.Bold, UI, spacing=1.0)   # 28 Oct: 7 pt grey did not read over a video
        self._f_value = font(8.5, QFont.DemiBold, DISPLAY)
        self._f_count = font(7.5, QFont.Bold, UI)
        self._minute = QTimer(self)          # the face only changes when the minute does: one repaint then
        self._minute.setSingleShot(True)
        self._minute.timeout.connect(self._next_minute)
        self._rows = 0
        self.flip = False   # let go on the right of the screen: the star on the outside, the rest on its left
        self._layout()

    def _chip_w(self, g) -> float:
        return 28 + QFontMetricsF(self._f_value).horizontalAdvance(g.value or "—") + 9

    def _layout(self):
        """Sizes the card to what it holds: the chips' rows over the time, the star's height at least."""
        n = len(self.items)
        self._rows = math.ceil(n / self.PER_ROW) if n else 0
        per = math.ceil(n / self._rows) if n else 0
        rows = [self.items[i:i + per] for i in range(0, n, per)] if n else []
        chips_w = max((sum(self._chip_w(g) for _, g in row) + self.CHIP_GAP * (len(row) - 1) for row in rows), default=0)
        fm = QFontMetricsF(self._f_time)
        time_w = fm.horizontalAdvance("00:00")
        content_h = (self._rows * (self.CHIP_H + self.CHIP_GAP) + 4 if n else 0) + fm.capHeight() + 9 + 9
        line_w = badge.width(8.0) + 8 + QFontMetricsF(self._f_line).horizontalAdvance("SÁB 24 MMM") + 4
        self.CW = round(self.X0 + max(chips_w, time_w, line_w) + self.PAD + 2)
        self._colw = self.CW - self.X0 - self.PAD - 2   # the column of chips, time and badge
        self.CH = round(max(self.STAR + 2 * self.PAD, content_h + 2 * self.PAD))
        self._top = (self.CH - content_h) / 2   # the right column is centred on the card
        self._rows_items = rows
        size = (self.CW + 2 * self.M, self.CH + 2 * self.M)
        if size != (getattr(self, "W", 0), getattr(self, "H", 0)):
            self.W, self.H = size
            self.FACE = QRect(self.M, self.M, self.CW, self.CH)   # the card inside the widget (what grows into the central)
            self.setFixedSize(self.W, self.H)
        self._face_key = None

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

    def set_line(self, text: str, colour=MUTED):
        """What the line over the time says instead of the date: what needs this person now ("" = the date)."""
        if (text, colour) != (self.line, self.line_colour):
            self.line, self.line_colour = text, colour
            self.update()

    def set_count(self, n: int):
        """The red count: what waits for this person in the Hub."""
        if n != self._count:
            self._count = n
            self.update()

    def _col(self) -> float:
        """Where the column of chips, time and badge begins (mirrored when the star is on the right)."""
        return float(self.CW - self.X0 - self._colw) if self.flip else float(self.X0)

    def _star_x(self) -> float:
        return float(self.CW - self.PAD - self.STAR) if self.flip else float(self.PAD)

    def set_flip(self, on: bool):
        """The side the star sits on (24 Oct, Marco: dragged to the edges of the monitor, the icons and the rest adjust,
        so they always face the screen). Only when the card is let go, never mid-drag."""
        if on != self.flip:
            self.flip = on
            self._face_key = None
            self.update()

    def set_items(self, items: list):
        """[(key, Gauge)]: the complications switched on in the central, in GAUGES' order."""
        self.items = list(items)
        self._layout()
        self.update()

    # ---- where things are on the card (card coordinates)
    def _gauge_rects(self) -> list:
        """Each chip: (key, Gauge, its rect on the card), row by row from the top of the right column."""
        out, y = [], self._top
        for row in self._rows_items:
            x = self._col()
            if self.flip:   # the rows lean on the star, on its left
                x += self._colw - (sum(self._chip_w(g) for _, g in row) + self.CHIP_GAP * (len(row) - 1))
            for key, g in row:
                w = self._chip_w(g)
                out.append((key, g, QRectF(x, y, w, self.CHIP_H)))
                x += w + self.CHIP_GAP
            y += self.CHIP_H + self.CHIP_GAP
        return out

    def _gauge_at(self, pos: QPointF):
        local = pos - QPointF(self.FACE.topLeft())
        for key, g, r in self._gauge_rects():
            if r.adjusted(-3, -3, 3, 3).contains(local):
                return key, g
        return None, None

    # ---- the mouse
    def enterEvent(self, e):
        self._to(self._hover_anim, self._hover, 1)

    def leaveEvent(self, e):
        self._to(self._hover_anim, self._hover, 0)
        self._hot = None
        QToolTip.hideText()

    def mousePressEvent(self, e):
        if e.button() == Qt.LeftButton:
            self._press_at = e.globalPosition().toPoint()
            self._grab = self._press_at - self.window().pos()
            self._dragged = False
            self._to(self._down_anim, self._down, 1)

    def mouseMoveEvent(self, e):
        if self._press_at is None:   # only hovering: a gauge lights up and says what it is
            key, g = self._gauge_at(e.position())
            if key != self._hot:
                self._hot = key
                self.update()
            if g is not None:
                QToolTip.showText(e.globalPosition().toPoint(), g.tip, self)
            else:
                QToolTip.hideText()
                self.setToolTip("Abrir a central de comando")
            return
        at = e.globalPosition().toPoint()
        if not self._dragged and (at - self._press_at).manhattanLength() > 4:
            self._dragged = True
            self._hot = None
            self._to(self._down_anim, self._down, 0)
            QToolTip.hideText()
            if self.on_drag:
                self.on_drag()
        if self._dragged:
            self.window().move(at - self._grab)   # the card goes where the mouse takes it, nothing else changes

    def mouseReleaseEvent(self, e):
        self._to(self._down_anim, self._down, 0)
        pressed, self._press_at = self._press_at, None
        if pressed is not None and not self._dragged and e.button() == Qt.LeftButton:
            key, _ = self._gauge_at(e.position())
            if key and self.on_icon:
                self.on_icon(key)
            else:
                self._on_click()
        elif self._dragged and hasattr(self.window(), "dock"):
            self.window().dock()   # let go: kept inside the screen, and the place is kept for next time

    # ---- painting
    def paint_face(self, p: QPainter, face: QRectF, hhmm_now: str, shadow=True):
        """The card in `face` (scaled from its own size), which the window also uses while it grows into the central."""
        p.save()
        p.translate(face.topLeft())
        p.scale(face.width() / self.CW, face.height() / self.CH)
        # no card (transparent, as before): a soft dark shadow with no edge, the same on every wallpaper, so the chrome
        # reads on a light desktop too
        p.setPen(Qt.NoPen)
        glow_disc(p, QPointF(self.CW / 2, self.CH / 2), self.CW * 0.56, self.CH * 0.62, "#000000", 0.42)
        glow_disc(p, QPointF(self._star_x() + self.STAR / 2, self.CH / 2), self.STAR * 0.7, self.STAR * 0.7, "#000000", 0.25)
        fm_t = QFontMetricsF(self._f_time)
        ty = self._top + (self._rows * (self.CHIP_H + self.CHIP_GAP) + 4 if self.items else 0)
        tw = max(fm_t.horizontalAdvance(hhmm_now), badge.width(8.0) + 70)
        glow_disc(p, QPointF((self._col() + self._colw - tw / 2) if self.flip else (self.X0 + tw / 2), ty + fm_t.capHeight() * 0.9), tw * 0.78, fm_t.capHeight() * 1.5, "#000000", 0.6)
        # the Mercedes star on the left (24 Oct, Marco: «mete o símbolo da Mercedes»)
        paint_star(p, QRectF(self._star_x(), (self.CH - self.STAR) / 2, self.STAR, self.STAR), shadow=True)
        # on top, the chips of the options switched on
        dpr = self.devicePixelRatioF()
        for key, g, cr in self._gauge_rects():
            paint_chip(p, cr, key, g, self._f_value, key == self._hot, dpr)
        # the time in chrome
        fm = QFontMetricsF(self._f_time)
        y = self._top + (self._rows * (self.CHIP_H + self.CHIP_GAP) + 4 if self.items else 0)
        base = y + fm.capHeight()
        col, end = self._col(), self._col() + self._colw
        tx = end - fm.horizontalAdvance(hhmm_now) if self.flip else col - 1
        chrome_text(p, QPointF(tx, base), self._f_time, hhmm_now)
        # under it the AMG badge and the date, or what needs you
        by = base + 9
        now = datetime.now()
        text = self.line.upper() if self.line else f"{DAYS[now.weekday()]} {now.day} {MONTHS_SHORT[now.month - 1]}"
        fl = QFontMetricsF(self._f_line)
        room = self._colw - badge.width(8.0) - 8 - (10 if self.line else 0)
        text = fl.elidedText(text, Qt.ElideRight, room)
        line_w = badge.width(8.0) + 8 + (10 if self.line else 0) + fl.horizontalAdvance(text) + 1
        x = end - line_w if self.flip else col   # leaning on the star, like the time
        glow_disc(p, QPointF(x + line_w / 2, by + 4.5), line_w * 0.62, 12, "#000000", 0.5)   # the badge and the date on a light video
        badge.paint(p, x, by, 8.0)
        x += badge.width(8.0) + 8
        if self.line:
            dot = QPointF(x + 3, by + 4.5)
            glow_disc(p, dot, 7, 7, self.line_colour, 0.5)
            p.setPen(Qt.NoPen)
            p.setBrush(QColor(self.line_colour))
            p.drawEllipse(dot, 2.6, 2.6)
            x += 10
        # the date in near-white with a dark outline (28 Oct, Marco: «quase nem consigo ver o que dia é nem o mês», over a
        # light, moving video): the outline makes it read on any wallpaper without a card behind it
        path = QPainterPath()
        path.addText(QPointF(x, by + 4.5 + fl.capHeight() / 2), self._f_line, text)
        p.setBrush(Qt.NoBrush)
        p.setPen(QPen(QColor(0, 0, 0, 175), 3.2, Qt.SolidLine, Qt.RoundCap, Qt.RoundJoin))
        p.drawPath(path)
        p.setPen(Qt.NoPen)
        p.fillPath(path, QColor(self.line_colour if self.line else "#eceef1"))
        p.restore()

    def _build_face(self, hhmm_now: str) -> QPixmap:
        dpr = self.devicePixelRatioF()
        pix = QPixmap(int(self.W * dpr), int(self.H * dpr))
        pix.setDevicePixelRatio(dpr)
        pix.fill(Qt.transparent)
        p = QPainter(pix)
        p.setRenderHint(QPainter.Antialiasing)
        p.setRenderHint(QPainter.SmoothPixmapTransform)
        face = QRectF(self.FACE)
        self.paint_face(p, face, hhmm_now)
        if self._count:   # iOS's red count on the card's top right
            text = str(self._count) if self._count < 100 else "99+"
            w = max(18.0, QFontMetricsF(self._f_count).horizontalAdvance(text) + 10)
            pill = QRectF(face.right() - w + 6, face.top() - 6, w, 18)
            p.setPen(QPen(QColor(0, 0, 0, 200), 2))
            p.setBrush(QColor("#ff3b30"))
            cut(p, pill, 9, 9)
            p.setPen(QColor(WHITE))
            p.setFont(self._f_count)
            p.drawText(pill, Qt.AlignCenter, text)
        p.end()
        return pix

    def paintEvent(self, _):
        now = datetime.now().strftime("%H:%M")
        key = (self.devicePixelRatioF(), now, datetime.now().day, self.line, self.line_colour, self._count, self.CW, self.CH,
               self._hot, tuple((k, tuple(g.arcs), g.value, tuple(g.segments or ()), g.ink) for k, g in self.items))
        if self._face_key != key:
            self._face, self._face_key = self._build_face(now), key
        p = QPainter(self)
        p.setRenderHint(QPainter.SmoothPixmapTransform)
        p.setRenderHint(QPainter.Antialiasing)
        p.setOpacity(self.fade)
        c = QPointF(self.FACE.center())
        s = 1 + 0.012 * self._hover - 0.025 * self._down     # it gives a little under the finger, like an iOS widget
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
        self._snap_ready, self._snap_at = None, 0.0   # one made in advance while minimized, so opening never waits for it

        self.setWindowTitle("Agente AMG")
        self.setWindowIcon(QIcon(str(LOGO)))
        self.setAttribute(Qt.WA_TranslucentBackground)

        self.orb = Orb(self.expand)
        self.orb.setParent(self)
        self.orb.on_icon = self._gauge_clicked
        self.orb.on_drag = self._hide_spot
        app = QApplication.instance()   # the gauges' lines show in a dark glass tooltip, like the card
        if app is not None and "QToolTip" not in app.styleSheet():
            app.setStyleSheet(app.styleSheet() + "QToolTip { background: #141518; color: #f2f3f5; border: 1px solid #34373c;"
                              " border-radius: 8px; padding: 5px 8px; font-family: 'Segoe UI Variable Text'; font-size: 9pt; }")
        self.gauges = {key: Gauge() for key, _ in GAUGES}   # what each complication under the minimized clock says
        self._spot = None           # the destaque of an icon of the clock (spotlight.py), made the first time one is clicked
        self._asking = False        # one of this person's Claude windows waits for them
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

        # the figures that matter, as the Hub's Painel (28 Oct, Marco: «eu disse para mudares a maior parte... tá tudo igual»):
        # each opens the same destaque as its icon on the clock, so the clock, the destaque and the central say the same
        figures = QHBoxLayout()
        figures.setContentsMargins(0, 0, 0, 0)
        figures.setSpacing(6)
        self.kpis = {}
        for i, (key, name) in enumerate((("equipa", "Claudes"), ("mensagens", "Mensagens"), ("tarefas", "Tarefas"), ("ponto", "Ponto"))):
            k = Kpi(key, name, lit=i == 0)
            k.clicked.connect(lambda _=False, key=key, k=k: self._spot_from(key, k))
            figures.addWidget(k)
            self.kpis[key] = k
        row_w = QWidget()
        row_w.setLayout(figures)
        col.addWidget(row_w)

        # 01 Equipa: the three partners as big photos; the one picked shows their Claude limits and their windows working
        # (28 Oct, Marco: «de forma organizada, para eu conseguir controlar o meu, o do Kovel e o do David»)
        self.tracker = TokenTracker()   # the token central's speeds (tokens.py)
        team = Platter("Equipa", "TOKENS ›", "01")
        self.team_box = team
        team.note.setCursor(Qt.PointingHandCursor)
        team.note.setToolTip("Os tokens de cada janela do Claude, ao vivo")
        team.note.mousePressEvent = lambda e: self._open_tokens()
        self.members = []   # the rows of before (Member): the photos took their place
        self._picked = prefs.load().get("team_pick")
        self.pick = TeamPick(self._pick_person)
        team.box.addWidget(self.pick)
        limits = QHBoxLayout()
        limits.setContentsMargins(0, 6, 0, 2)
        limits.setSpacing(14)
        self.pick_five, self.pick_week = Line("Claude 5 h"), Line("Semana")
        limits.addWidget(self.pick_five)
        limits.addWidget(self.pick_week)
        team.box.addLayout(limits)
        self.pick_rows = [ClaudeRow() for _ in range(3)]   # never more: the rest is in the Escritório
        for row in self.pick_rows:
            row.clicked.connect(lambda: self._open_notice("#/escritorio"))
            row.hide()
            team.box.addWidget(row)
        self.pick_none = label("", 8.5, FAINT)
        team.box.addWidget(self.pick_none)
        self.hub_note = label("O Hub não está a responder.", 8.5, FAINT)
        self.hub_note.hide()
        team.box.addWidget(self.hub_note)
        col.addWidget(team)

        # 02 No relógio: the icons over the minimized clock, chosen here (23 Oct, Marco: «quero ativar os tokens, quero
        # ativar as câmaras»; 24 Oct: options «que combinem com a funcionalidade de uma empresa»)
        side = Platter("No relógio", "", "02")
        self.side_note = side.sub
        tiles = QGridLayout()
        tiles.setContentsMargins(0, 0, 0, 2)
        tiles.setSpacing(6)
        saved = prefs.load().get("pins")
        if saved is None:
            pinned = set(DEFAULT_PINS)
        elif set(saved) & set(PINS_BEFORE):   # chosen before 24 Oct, when there were four: the new ones that matter come on
            pinned = set(DEFAULT_PINS) | {PINS_BEFORE.get(k, k) for k in saved}
        else:
            pinned = set(saved)
        self.pins = {}
        for i, (key, name) in enumerate(GAUGES):
            tile = Toggle(key, name, key in pinned)
            tile.clicked.connect(lambda _=False, key=key: self._toggle_pin(key))   # clicked(bool) would take key's place
            tiles.addWidget(tile, i // 4, i % 4)
            self.pins[key] = tile
        on = len([k for k in self.pins if self.pins[k].on])
        side.sub.setText(f"{on} de {len(GAUGES)} ligados")
        prefs.save(pins=[k for k, pin in self.pins.items() if pin.on])
        side.box.addLayout(tiles)
        col.addWidget(side)

        # «Controlo»: the buttons that were only in the tray menu, as the iPhone's Control Centre
        controls = Platter("Controlo", "", "03")
        row = QHBoxLayout()
        row.setContentsMargins(0, 4, 0, 2)
        row.setSpacing(0)
        self.ctl_ponto = Control("ponto", "Ponto", "Bater o ponto")
        self.ctl_ponto.clicked.connect(self.punch_ponto)
        self.ctl_agent = Control("pausa", "Pausar", "Pausar o agente")
        self.ctl_agent.clicked.connect(lambda: self.client.send("resume" if self.store.get().get("status") == "PAUSED" else "pause"))
        self.ctl_stop = Control("parar", "Parar", "Parar a tarefa do agente", danger=True)
        self.ctl_stop.clicked.connect(lambda: self.client.send("stop"))
        self.ctl_top = Control("cima", "Por cima", "")
        self.ctl_top.clicked.connect(lambda: self.set_on_top(not prefs.on_top()))
        self.ctl_away = Control("invisivel", "Invisível", "")
        self.ctl_away.clicked.connect(lambda: self.set_away(not self._away))
        self.ctl_hub = Control("hub", "Hub", "Abrir o Hub em grande")
        self.ctl_hub.clicked.connect(self._open_hub)
        for button in (self.ctl_ponto, self.ctl_agent, self.ctl_stop, self.ctl_top, self.ctl_away, self.ctl_hub):
            row.addWidget(button)
        controls.box.addLayout(row)
        col.addWidget(controls)
        self._render_controls()

        # 04 Atalhos: the Hub's pages one click away, as on the iPhone's home screen (headed like the modules, no plate: room)
        head = QHBoxLayout()
        head.setContentsMargins(14, 4, 14, 0)
        head.setSpacing(7)
        head.addWidget(label("04", 7.5, FAINT, QFont.DemiBold, MONO))
        head.addWidget(label("ATALHOS", 7.8, "#d5d8dc", QFont.Bold, UI, spacing=1.8))
        head.addWidget(label("o Hub, página a página", 7.8, MUTED))
        head.addStretch(1)
        head_w = QWidget()
        head_w.setLayout(head)
        col.addWidget(head_w)
        apps = QWidget()
        grid = QGridLayout(apps)
        grid.setContentsMargins(0, 2, 0, 0)
        grid.setHorizontalSpacing(0)
        grid.setVerticalSpacing(4)
        self.apps = {}
        for i, (glyph_key, name, href) in enumerate(APPS):
            icon = AppIcon(glyph_key, name, f"Abrir {name} no Hub")
            icon.clicked.connect(lambda href=href: self._open_notice(href))
            grid.addWidget(icon, i // 5, i % 5)
            self.apps[glyph_key] = icon
        col.addWidget(apps)

        # the FundedNext account (the Hub's #/fundednext in a few numbers); only on a PC with the account
        self.fn = Platter("FundedNext", "", "04")
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
        # to try the notifications (the others see this person go offline): the «Invisível» control
        self.btn_away = self.ctl_away
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
        """Starts where the card was left last time (the top right of the screen the first time)."""
        screen = self.screen().availableGeometry()
        saved = prefs.load()
        face = QPoint(saved.get("star_x", screen.right() - self.orb.CW - 24), saved.get("star_y", screen.top() + 40))
        self._layout_orb(face)

    def dock(self):
        """The card was let go where it is: brought back inside the screen if it went past an edge, and that place is
        kept for next time. Nothing snaps to corners."""
        self._layout_orb()
        face = self.pos() + self.orb.pos() + self.orb.FACE.topLeft()
        prefs.save(star_x=face.x(), star_y=face.y())

    def _pinned(self) -> list:
        return [(k, self.gauges[k]) for k, _ in GAUGES if self.pins[k].on]

    def _layout_orb(self, face: QPoint | None = None):
        """The minimized widget: the card where `face` says (its top left on the screen; by default where it is now), kept
        inside the screen, with the complications switched on in the central (the card grows down with them)."""
        if face is None:
            face = self.pos() + self.orb.pos() + self.orb.FACE.topLeft()
        orb = self.orb
        orb.set_items(self._pinned())
        screen = (QGuiApplication.screenAt(face + QPoint(orb.CW // 2, 20)) or self.screen()).availableGeometry()
        x = max(screen.left() + self.EDGE, min(face.x(), screen.right() - orb.CW - self.EDGE))
        y = max(screen.top() + self.EDGE, min(face.y(), screen.bottom() - orb.CH - self.EDGE))
        orb.set_flip(x + orb.CW / 2 > screen.center().x())   # on the right half the star goes to the outside edge
        orb.move(0, 0)
        self.setFixedSize(orb.W, orb.H)
        self.move(QPoint(x, y) - orb.FACE.topLeft())

    def _refresh_orb(self):
        """A figure changed: the card repaints, and grows or shrinks when a row of gauges comes or goes (never mid-drag)."""
        if self.mode == "orb" and self.orb._press_at is None:
            size = (self.orb.W, self.orb.H)
            self.orb.set_items(self._pinned())
            if (self.orb.W, self.orb.H) != size:
                self._layout_orb()
        else:
            self.orb.set_items(self._pinned())

    def _toggle_pin(self, key: str):
        self.pins[key].toggle()
        on = sum(1 for pin in self.pins.values() if pin.on)
        self.side_note.setText(f"{on} de {len(GAUGES)} ligados")
        prefs.save(pins=[k for k, pin in self.pins.items() if pin.on])
        if self.mode == "orb":
            self._layout_orb()

    def _gauge_clicked(self, key: str):
        """An icon of the minimized clock clicked: its destaque opens beside the clock (28 Oct, Marco: «preciso de utilizar
        para ver rápido»); the same icon again closes it."""
        from .spotlight import Spotlight
        if self._spot is None:
            self._spot = Spotlight()
        if self._spot.toggled_off(key):
            return
        face = QRect(self.pos() + self.orb.pos() + self.orb.FACE.topLeft(), self.orb.FACE.size())
        self._spot.show_for(key, self._spot_content(key), face, self.orb.flip)
        self._fast = True   # the Hub is asked every 4 s while it is open

    def _hide_spot(self):
        if self._spot is not None:
            self._spot.hide()

    def _refresh_spot(self):
        if self._spot is not None and self._spot.isVisible() and self._spot.key:
            self._spot.show_content(self._spot_content(self._spot.key))

    TASK_STATUS = {"TODO": "Por fazer", "ASSIGNED": "Atribuída", "IN_PROGRESS": "Em curso", "RUNNING": "Em curso", "BLOCKED": "Bloqueada",
                   "REVIEW": "Em revisão", "WAITING_APPROVAL": "À espera de aprovação", "PAUSED": "Em pausa", "FAILED": "Falhou"}
    ROOMS = (("Escritório", "office"), ("Trading", "trading"), ("Etsy", "etsy"), ("Cofre", "vault"), ("Stand", "garage"), ("Tudo", "all"))

    def _spot_content(self, key: str) -> dict:
        """What the destaque of `key` says, from what the widget already read of the Hub (nothing more is asked for it)."""
        team = self._team or self._last_team or []
        live = {p["user"]: p for p in (self._live or {}).get("people", [])}
        people = [{**p, "live": live.get(p["user"]) or {}} for p in team]
        me = self._identity(team) if team else None
        mine = next((p for p in people if p["user"] == me), {"live": {}})
        ml, go = mine["live"], self._open_notice
        name = lambda p: f"{p['name']} · tu" if p["user"] == me else p["name"]
        dot = lambda p: COLORS["ONLINE"] if p.get("online") else COLORS["OFFLINE"]
        office = lambda: go("#/escritorio")
        working = sum(p["live"].get("working") or 0 for p in people)
        off = "O Hub não está a responder." if self._team is None else ""

        if key == "claude":
            ws = live_windows(ml)
            asking = sum(1 for w in ws if w.get("wait") in ("permission", "answer"))
            n = ml.get("working") or 0
            return {"title": "Os teus Claudes", "note": f"{asking} à tua espera" if asking else "o que cada janela está a fazer",
                    "figure": str(n), "colour": COLORS["WAITING"] if asking else COLORS["WORKING"] if n else TEXT,
                    "rows": [{"title": w.get("topic") or w.get("project") or "Janela do Claude", "sub": window_doing(w),
                              "right": ago_iso(w.get("since")), "colour": window_colour(w), "action": office, "tip": "Abrir no Escritório",
                              "sub_colour": COLORS["WAITING"] if w.get("wait") in ("permission", "answer") else None} for w in ws],
                    "empty": off or "Nenhuma janela tua a trabalhar agora.",
                    "buttons": [("Escritório ›", office, False, None)]}

        if key == "tokens":
            rows = []
            for p in people:
                plan = p["live"].get("limits") or {}
                rows.append({"user": p["user"], "online": p.get("online"), "colour": dot(p), "title": name(p),
                             "right": until(plan.get("five_reset")).replace("renova em ", "5 h renova em ") if plan.get("five_reset") else "",
                             "bars": [(plan.get("five"), "Claude 5 h"), (plan.get("week"), "Semana")], "action": self._open_tokens,
                             "tip": "Os tokens de cada janela, ao vivo"})
            five = (ml.get("limits") or {}).get("five")
            return {"title": "Tokens do Claude", "note": "o limite de 5 h e o da semana de cada um",
                    "figure": "—" if five is None else f"{round(five)}%", "colour": meter_color(five or 0),
                    "rows": rows, "empty": off or "Sem números do Claude ainda.",
                    "buttons": [("Tokens por janela ›", self._open_tokens, False, None)]}

        if key == "equipa":
            rows = []
            for p in people:
                doing, colour = activity({**p, "_me": p["user"] == me})
                rows.append({"user": p["user"], "online": p.get("online"), "colour": dot(p), "title": name(p), "sub": doing,
                             "sub_colour": colour, "action": office, "tip": "Abrir o Escritório"})
                for w in live_windows(p["live"])[:3]:
                    rows.append({"indent": True, "title": w.get("topic") or w.get("project") or "Janela do Claude",
                                 "sub": window_doing(w, p["user"] == me), "right": ago_iso(w.get("since")), "colour": window_colour(w),
                                 "action": office, "tip": "Abrir no Escritório"})
            return {"title": "Equipa", "note": "Claudes a trabalhar, de cada um", "figure": str(working),
                    "colour": COLORS["WORKING"] if working else TEXT, "rows": rows, "empty": off,
                    "buttons": [("Escritório ›", office, False, None)]}

        if key == "mensagens":
            items = ml.get("message_list") or []
            n = ml.get("messages") or 0
            return {"title": "Mensagens", "note": "por ler" if n else "tudo lido", "figure": str(n), "colour": "#ff453a" if n else TEXT,
                    "rows": [{"title": m.get("title") or "Mensagem", "sub": m.get("body") or "", "right": ago_iso(m.get("at")),
                              "colour": "#ff453a", "action": lambda href=m.get("href") or "#/mensagens": go(href), "tip": "Abrir a conversa"}
                             for m in items],
                    "empty": off or "Sem mensagens por ler.",
                    "buttons": [("Abrir as Mensagens ›", lambda: go("#/mensagens"), False, None)]}

        if key == "tarefas":
            items = ml.get("task_list") or []
            n = ml.get("tasks") or 0
            others = " · ".join(f"{p['name']} {p['live'].get('tasks') or 0}" for p in people if p["user"] != me)
            rows = []
            for t in items:
                urgent = t.get("priority") in ("urgent", "high")
                sub = "A fazer agora" if t.get("doing") else self.TASK_STATUS.get(t.get("status"), (t.get("status") or "").capitalize())
                if urgent:
                    sub = f"{'Urgente' if t['priority'] == 'urgent' else 'Prioridade alta'} · {sub}"
                rows.append({"title": t.get("title") or "Tarefa", "sub": sub, "action": lambda i=t["id"]: go(f"#/tarefas/{i}"),
                             "colour": COLORS["WORKING"] if t.get("doing") else COLORS["WAITING"] if urgent else WHITE,
                             "sub_colour": COLORS["WAITING"] if urgent else None, "tip": "Abrir a tarefa"})
            return {"title": "As tuas tarefas", "note": f"abertas para ti{' · ' + others if others else ''}", "figure": str(n),
                    "colour": TEXT, "rows": rows, "empty": off or "Nenhuma tarefa aberta para ti.",
                    "buttons": [("Ver todas ›", lambda: go("#/tarefas"), False, None)]}

        if key == "ponto":
            rows = []
            for p in people:
                runs = clock_runs(p)
                sub = (f"A contar · {worked_of(p)} hoje" if runs else f"Parado · {worked_of(p)} hoje") if p.get("ponto") else "Por bater hoje"
                rows.append({"user": p["user"], "online": p.get("online"), "colour": COLORS["WORKING"] if runs else COLORS["OFFLINE"],
                             "title": name(p), "sub": sub, "right": f"desde {hhmm(p['ponto'])}" if p.get("ponto") else ""})
            runs = clock_runs(mine)
            button = ("Parar o ponto", "#ff8a80") if runs else ("Retomar o ponto", None) if mine.get("ponto") else ("Bater o ponto", None)
            return {"title": "Ponto", "note": "a contar" if runs else "parado" if mine.get("ponto") else "por bater hoje",
                    "figure": worked_of(mine).replace(" ", "") if mine.get("ponto") else "—",
                    "colour": COLORS["WORKING"] if runs else TEXT, "rows": rows, "empty": off,
                    "buttons": [(button[0], self.punch_ponto, True, button[1])] if me else []}

        if key == "camaras":
            rows = [{"user": p["user"], "online": p.get("online"), "colour": COLORS["WORKING"], "title": name(p),
                     "sub": activity({**p, "_me": p["user"] == me})[0], "sub_colour": COLORS["WORKING"],
                     "action": lambda: self._open_cave("office"), "tip": "Ver o Escritório da cave"}
                    for p in people if p["live"].get("working")]
            return {"title": "Câmaras", "note": "Empresa AMG ao vivo · escolhe a câmara", "figure": str(working),
                    "colour": COLORS["WORKING"] if working else TEXT,
                    "grid": [(room, lambda cam=cam: self._open_cave(cam), f"Abrir a câmara «{room}» numa janela pequena") for room, cam in self.ROOMS],
                    "rows": rows, "empty": off or "Ninguém a trabalhar agora.",
                    "buttons": [("Parede de câmaras ›", office, False, None)]}

        # FundedNext
        f = self._fn or {}
        page = lambda: go("#/fundednext")
        out = {"title": "FundedNext", "note": f.get("phase") or "a conta da prop", "buttons": [("Abrir FundedNext ›", page, False, None)]}
        if not f.get("accounts"):
            return {**out, "figure": "—", "empty": off or "Nenhuma conta ligada. Abre o painel e liga a conta do MT5."}
        if not f.get("ok"):
            return {**out, "figure": "!", "colour": COLORS["WAITING"], "empty": f.get("error") or "Sem ligação à conta: abre o MT5."}
        day = f.get("day_pnl") or 0
        items = {i["id"]: i for i in f.get("items", [])}
        daily, target = items.get("daily") or {}, items.get("target")
        rows = [{"title": "Hoje", "right": f"{'+' if day > 0 else ''}{usd(day)}", "action": page,
                 "right_colour": COLORS["ONLINE"] if day > 0 else RED if day < 0 else TEXT, "colour": COLORS["ONLINE"] if day >= 0 else RED},
                {"title": "Podes perder hoje", "right": usd(f.get("left_today")), "right_colour": TEXT, "action": page,
                 "sub": f"{round(daily.get('pct') or 0)}% do limite diário usado", "colour": meter_color(daily.get("pct") or 0)}]
        if target:
            rows.append({"title": "Objetivo da fase", "right": f"{round(target.get('pct') or 0)}%", "right_colour": TEXT, "action": page,
                         "sub": f"falta {usd(target.get('left'))}", "colour": COLORS["ONLINE"]})
        if f.get("why"):
            rows.append({"title": "Atenção", "sub": f["why"], "colour": COLORS["WAITING"], "action": page})
        return {**out, "figure": usd(f.get("equity")), "rows": rows}

    def _render_gauges(self, shown: list, mine_live: dict, windows: list):
        """The complications that come from the Hub's look at the team (every 8 s). Only a real change repaints the card."""
        g, changed = self.gauges, False
        asking = [w for w in windows if w.get("wait") in ("permission", "answer")]
        working = [w for w in windows if w.get("state") == "working"]
        subject = lambda w: w.get("topic") or w.get("project") or "Claude"
        self._asking = bool(asking)
        if asking:
            changed |= g["claude"].set([(1, COLORS["WAITING"])], str(len(asking)), f"O Claude espera por ti · {subject(asking[0])}")
        elif working:
            changed |= g["claude"].set([(1, COLORS["WORKING"])], str(len(working)),
                                       f"{len(working)} Claude a trabalhar · {subject(working[0])}")
        else:
            changed |= g["claude"].set([], "0", "Nenhum Claude teu a trabalhar agora")
        segments, lines = [], []
        for person in shown:
            live = person.get("live") or {}
            if live.get("working"):
                n = live["working"]
                colour, what = COLORS["WORKING"], "1 Claude a trabalhar" if n == 1 else f"{n} Claudes a trabalhar"
            elif live.get("waiting") and live.get("wait") in ("permission", "answer"):
                colour, what = COLORS["WAITING"], "Claude à espera"
            elif person.get("online"):
                colour, what = WHITE, "online"
            else:
                colour, what = "#3b3e44", "offline"
            segments.append(colour)
            plan = live.get("limits") or {}
            use = " · ".join(f"{name} {round(plan[k])}%" for k, name in (("five", "5 h"), ("week", "semana")) if plan.get(k) is not None)
            lines.append(f"{person['name']}: {what}" + (f" · {use}" if use else ""))
        # the figure is the team's Claudes working (28 Oct, Marco: «dá para ver a quantidade de Claudes em que estamos a trabalhar»)
        team_working = sum((p.get("live") or {}).get("working") or 0 for p in shown)
        changed |= g["equipa"].set([], str(team_working), "\n".join(lines) or "Sem notícias da equipa", segments or None)
        n = mine_live.get("messages") or 0
        changed |= g["mensagens"].set([(1, "#ff453a")] if n else [], str(n),
                                      "1 mensagem por ler" if n == 1 else f"{n} mensagens por ler" if n else "Sem mensagens por ler")
        n = mine_live.get("tasks") or 0
        changed |= g["tarefas"].set([(1, WHITE)] if n else [], str(n),
                                    "1 tarefa aberta para ti" if n == 1 else f"{n} tarefas abertas para ti" if n else "Nenhuma tarefa aberta para ti")
        live = sum(1 for p in shown for w in (p.get("live") or {}).get("windows") or [] if w.get("state") == "working")
        changed |= g["camaras"].set([(1, "#ff453a")] if live else [], str(live),
                                    f"Empresa AMG ao vivo · {live} a trabalhar" if live else "Empresa AMG ao vivo · ninguém a trabalhar agora")
        if changed:
            self._refresh_orb()

    def _render_ponto(self):
        """The Ponto gauge: the hours worked today against an 8 h day, green while the clock runs. A first click arms it."""
        me = self._identity(self._team or [])
        mine = next((p for p in self._team or [] if p.get("user") == me), {})
        runs = clock_runs(mine)
        if not mine.get("ponto"):
            changed = self.gauges["ponto"].set([], "—", "Ponto por bater hoje")
        else:
            s = worked_s(mine)
            hours = f"{s // 3600}h{s % 3600 // 60:02d}"
            changed = self.gauges["ponto"].set([(s / (8 * 3600), COLORS["WORKING"] if runs else WHITE)], hours,
                                               f"Ponto a contar · {hours} hoje" if runs else f"Ponto parado · {hours} hoje")
        if changed:
            self._refresh_orb()

    def _render_controls(self):
        """The Control Centre of the central follows how things are."""
        if not hasattr(self, "ctl_ponto"):
            return
        me = self._identity(self._team or [])
        mine = next((p for p in self._team or [] if p.get("user") == me), {})
        runs = clock_runs(mine)
        self.ctl_ponto.show_as(runs, name=worked_of(mine).replace(" ", "") if mine.get("ponto") else "Ponto",
                               tip="Parar o ponto: as horas de hoje deixam de contar" if runs else
                               "Retomar o ponto" if mine.get("ponto") else "Bater o ponto", enabled=bool(me))
        state = self.store.get()
        status = state.get("status", "OFFLINE")
        paused = status == "PAUSED"
        self.ctl_agent.show_as(paused, key="play" if paused else "pausa", name="Retomar" if paused else "Pausar",
                               tip="Retomar o agente" if paused else "Pausar o agente", enabled=status != "OFFLINE")
        self.ctl_stop.show_as(False, tip="Parar a tarefa do agente", enabled=bool(state.get("task")))
        top = prefs.on_top()
        self.ctl_top.show_as(top, tip="O widget fica por cima das outras janelas (clica para deixar de ficar)" if top
                             else "Pôr o widget sempre por cima das outras janelas")
        self.ctl_away.show_as(self._away, tip="Estás invisível para a equipa: clica para voltar a aparecer online" if self._away
                              else "Aparecer offline para a equipa (para testar as notificações)")

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
        self._hide_spot()
        size = self._panel_size()
        face = QRect(self.pos() + self.orb.pos() + self.orb.FACE.topLeft(), self.orb.FACE.size())
        x, y = face.right() + 1 - WIDTH - SHADOW, face.top() - SHADOW
        screen = self.screen().availableGeometry()
        x = max(screen.left() - SHADOW, min(x, screen.right() + 1 + SHADOW - size.width()))
        y = max(screen.top() - SHADOW, min(y, screen.bottom() + 1 + SHADOW - size.height()))
        self._orb_face = face.topLeft() - QPoint(x, y)
        self.setFixedSize(size)
        self.move(x, y)
        self.orb.hide()   # the window draws the face itself while it grows
        QToolTip.hideText()
        self.panel.layout().activate()
        fresh = (self._snap_ready is not None and time.monotonic() - self._snap_at < SNAP_KEEP
                 and round(self._snap_ready.deviceIndependentSize().height()) == self.panel.height())
        self._snap = self._snap_ready if fresh else self._snapshot()   # ready-made: the first frame comes at once
        self._snap_ready = None
        self._start_morph(+1)

    def collapse(self):
        """The cockpit shrinks back into the button at its top-right corner."""
        if self.mode != "panel":
            return
        self._hide_spot()
        self._orb_face = QPoint(SHADOW + WIDTH - self.orb.FACE.width(), SHADOW)
        self._snap = self._snapshot()
        self.panel.hide()
        self._start_morph(-1)

    def _morph_rect(self, k: float) -> QRectF:
        """Where the growing card is at `k` (0 the clock, 1 the central)."""
        orb = QRectF(self._orb_face.x(), self._orb_face.y(), self.orb.FACE.width(), self.orb.FACE.height())
        full = self._panel_rect()
        return QRectF(orb.left() + (full.left() - orb.left()) * k, orb.top() + (full.top() - orb.top()) * k,
                      orb.width() + (full.width() - orb.width()) * k, orb.height() + (full.height() - orb.height()) * k)

    def _start_morph(self, direction):
        self.mode = "morph"
        self._morph_last = None
        self._morph_dir, self._morph_t0 = direction, time.perf_counter()
        self._k = 0.0 if direction > 0 else 1.0
        clock().need(self)
        self.update()

    def _morph_frame(self, _):
        if self.mode != "morph":
            return
        p = min(1.0, (time.perf_counter() - self._morph_t0) / (GROW if self._morph_dir > 0 else SHRINK))
        self._k = 1 - (1 - p) ** 4 if self._morph_dir > 0 else 1 - ease(p)   # opening: fast, then settles softly, like iOS
        # only the part of the window the card covers now and covered last frame is painted again, not the whole
        # central-sized window: half the work per frame at 165 Hz
        now = self._morph_rect(self._k).adjusted(-16, -16, 16, 22).toAlignedRect()
        self.update(now.united(self._morph_last) if self._morph_last is not None else self.rect())
        self._morph_last = now
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

    def _open_cave(self, cam: str = ""):
        """The cameras clicked: the cave of Empresa AMG live, in its mini window over everything (mini.py), signed in, on
        the room `cam` asks for (one of the cave's VIEWS: office, trading, vault, garage, etsy, all)."""
        who = self._identity(self._team or [])

        def work():
            url = hub.hub_url()
            session = self.client.hub_session() or (hub.session(url, who) if who else None)
            self.cave_ready.emit(f"{url}/?mini=1{'&cam=' + cam if cam else ''}#login={session or ''}&to=/empresa")

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
                cut(p, rect.adjusted(-i, -i + 6, i, i + 6), radius + i, radius + i)
        shape = QPainterPath()
        shape.addPath(cut_path(rect, radius, radius))
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
        cut(p, rect.adjusted(0.6, 0.6, -0.6, -0.6), radius, radius)

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
            p.fillRect(e.rect(), Qt.transparent)
            p.setCompositionMode(QPainter.CompositionMode_SourceOver)
            k = self._k
            p.setRenderHint(QPainter.SmoothPixmapTransform)
            rect = self._morph_rect(k)
            small = Orb.RADIUS
            radius = small + (RADIUS - small) * k
            p.setPen(Qt.NoPen)
            for i in (14, 9, 5):   # a soft shadow that grows with it (three passes, cheap)
                p.setBrush(QColor(0, 0, 0, int(16 * k)))
                cut(p, rect.adjusted(-i, -i + 6, i, i + 6), radius + i, radius + i)
            shape = QPainterPath()
            shape.addPath(cut_path(rect, radius, radius))
            p.save()
            p.setClipPath(shape)
            # the clock is transparent: the black glass comes in with the growth instead of popping up behind it
            p.fillRect(rect, QColor(9, 9, 10, round(255 * min(1.0, k / 0.18))))
            if self._snap is not None:   # the cockpit, scaled from the bubble's width to its own, revealed as it grows
                scale = rect.width() / WIDTH
                snap = self._snap.deviceIndependentSize()
                p.setOpacity(max(0.0, min(1.0, (k - 0.12) / 0.5)))
                p.drawPixmap(QRectF(rect.left(), rect.top(), snap.width() * scale, snap.height() * scale), self._snap,
                             QRectF(0, 0, self._snap.width(), self._snap.height()))
            p.restore()
            fade = max(0.0, 1 - k / 0.3)
            if fade > 0:   # the watch face, carried up to the corner and fading as the cockpit comes in
                sc = 1 + 0.3 * k
                face = QRectF(rect.right() - self.orb.CW * sc, rect.top(), self.orb.CW * sc, self.orb.CH * sc)
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
        mine = next((p for p in shown if p["user"] == me), {})
        mine_live = mine.get("live") or {}
        self.apps["mensagens"].set_count(mine_live.get("messages") or 0)
        self.apps["tarefas"].set_count(mine_live.get("tasks") or 0, "#5b5f66")
        self.apps["escritorio"].set_count(sum((p.get("live") or {}).get("working") or 0 for p in shown), "#2f9e57")
        # the red count on the card: what waits in the Hub (the messages have their own gauge when it is on the card)
        self.orb.set_count((0 if self.pins["mensagens"].on else mine_live.get("messages") or 0) + (mine.get("approvals") or 0))
        windows = live_windows(mine_live)
        self._shown, self._me = shown, me
        self._render_pick()
        working = sum((p.get("live") or {}).get("working") or 0 for p in shown)
        msgs, tasks = mine_live.get("messages") or 0, mine_live.get("tasks") or 0
        self.kpis["equipa"].set(str(working), COLORS["WORKING"] if working else TEXT, "Claudes da equipa a trabalhar agora")
        self.kpis["mensagens"].set(str(msgs), "#ff453a" if msgs else TEXT, "Mensagens por ler")
        self.kpis["tarefas"].set(str(tasks), TEXT, "Tarefas abertas para ti")
        self.kpis["ponto"].set(worked_of(mine).replace(" ", "") if mine.get("ponto") else "—",
                                COLORS["WORKING"] if clock_runs(mine) else TEXT, "As tuas horas de hoje")
        self._render_gauges(shown, mine_live, windows)
        self._render_ponto()
        self._render_controls()
        self.hub_note.setVisible(team is None)
        self._render_doing(team or [], me)
        self._render_state()
        self._refresh_spot()

    def _pick_person(self, user: str):
        """A photo of 01 Equipa clicked: their limits and Claude windows show under the photos (kept for next time)."""
        self._picked = user
        prefs.save(team_pick=user)
        self._render_pick()

    def _render_pick(self):
        shown, me = getattr(self, "_shown", []), getattr(self, "_me", None)
        users = [p["user"] for p in shown]
        picked = self._picked if self._picked in users else me if me in users else users[0] if users else None
        self.pick.set(shown, picked, me)
        person = next((p for p in shown if p["user"] == picked), {})
        live = person.get("live") or {}
        plan = live.get("limits") or {}
        for line, k in ((self.pick_five, "five"), (self.pick_week, "week")):
            pct = plan.get(k)
            line.set(pct, "—" if pct is None else f"{round(pct)}%", until(plan.get(k + "_reset")).replace("renova em ", "") if plan.get(k + "_reset") else "")
        ws = live_windows(live)
        for row, w in zip(self.pick_rows, ws + [None] * len(self.pick_rows)):
            row.setVisible(w is not None)
            if w:
                row.show_window(w, picked == me)
        self.pick_none.setText("" if ws else activity({**person, "_me": picked == me})[0] if person else "")
        self.pick_none.setVisible(not ws and bool(person))
        working = sum((p.get("live") or {}).get("working") or 0 for p in shown)
        self.team_box.sub.setText(f"{working} Claude{'s' if working != 1 else ''} a trabalhar")

    def _spot_from(self, key: str, widget: QWidget):
        """A figure of the central clicked: the same destaque as the clock's icon, beside the central."""
        from .spotlight import Spotlight
        if self._spot is None:
            self._spot = Spotlight()
        if self._spot.toggled_off(key):
            return
        anchor = QRect(widget.mapToGlobal(QPoint(0, 0)), widget.size())
        self._spot.show_for(key, self._spot_content(key), anchor, False, beside=self.geometry().adjusted(SHADOW, SHADOW, -SHADOW, -SHADOW))
        self._fast = True

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
        self._render_controls()

    def _render_trading(self, f: dict):
        """The FundedNext gauge: today's result in the middle, the arc is how much of today's loss limit is used."""
        if not f.get("accounts"):
            changed = self.gauges["trading"].set([], "—", "FundedNext: nenhuma conta ligada · clica para ligar")
        elif not f.get("ok"):
            changed = self.gauges["trading"].set([], "!", f"FundedNext sem ligação · {f.get('error') or 'abre o MT5'}", ink=COLORS["WAITING"])
        else:
            day = f.get("day_pnl") or 0
            pct = ({i["id"]: i for i in f.get("items", [])}.get("daily") or {}).get("pct") or 0
            short = f"{abs(day) / 1000:.1f}k".replace(".", ",") if abs(day) >= 1000 else f"{abs(day):.0f}"
            value = f"{'+' if day > 0 else '−' if day < 0 else ''}{short}"
            changed = self.gauges["trading"].set(
                [(pct / 100, meter_color(pct))], value,
                f"FundedNext · {f.get('phase', '')}\nEquity {usd(f.get('equity'))} · hoje {'+' if day > 0 else ''}{usd(day)}\n"
                f"Podes perder hoje {usd(f.get('left_today'))} ({round(pct)}% do limite usado)",
                ink=COLORS["ONLINE"] if day > 0 else RED if day < 0 else TEXT)
        if changed:
            self._refresh_orb()

    def _render_fn(self, f: dict):
        """The FundedNext card: equity and today, what can still be lost today and the phase target. With no account it is
        there only on the PC with the MT5, to say how to link it."""
        self._render_trading(f)
        self._refresh_spot()
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
            start = QRect(self.pos() + self.orb.pos() + self.orb.FACE.topLeft(), self.orb.FACE.size())
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
        self._render_controls()

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
        self._fast = (self.mode == "panel" or bool(self._token_center and self._token_center.isVisible())
                      or bool(self._spot and self._spot.isVisible()))
        if self._fn is not None and self._fn is not self._fn_seen:
            if self._fn != self._fn_seen:
                self._render_fn(self._fn)
            self._fn_seen = self._fn
        if self.mode == "orb" and self.orb._press_at is None and time.monotonic() - self._snap_at > SNAP_KEEP / 2:
            self._snap_ready, self._snap_at = self._snapshot(), time.monotonic()   # ~20 ms every 10 s while minimized
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
        # the line over the minimized clock says what needs this person; otherwise the date
        if self._team is None or colour == COLORS["ERROR"]:
            self.orb.set_line(text, COLORS["ERROR"])
        elif self._asking:
            self.orb.set_line("O Claude espera por ti", COLORS["WAITING"])
        elif colour == COLORS["WAITING"]:
            self.orb.set_line("Aprovação à espera", COLORS["WAITING"])
        else:
            self.orb.set_line("")
        self._render_controls()

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
        # the Tokens gauge: this person's Claude plan as two rings, the 5 h session outside and the week inside
        five, week = self.tile_session._pct, self.tile_week._pct
        arcs = [((five or 0) / 100, meter_color(five or 0)), ((week or 0) / 100, meter_color(week) if (week or 0) >= 60 else "#8f97a1")]
        tip = (f"Claude 5 h: {'sem dados' if five is None else f'{round(five)}% usado'} · {self.tile_session._note}\n"
               f"Semana: {'sem dados' if week is None else f'{round(week)}% usado'} · {self.tile_week._note}")
        if self.gauges["tokens"].set(arcs, "—" if five is None else f"{round(five)}%", tip):
            self._refresh_orb()
        used = mine.get("higgsfield_pct")
        self.tile_higgs.set(used, "—" if used is None else f"{round(used)}%", "por definir no Hub" if used is None else "créditos gastos")
        self._render_state()
