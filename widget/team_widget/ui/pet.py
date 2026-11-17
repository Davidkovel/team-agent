"""The Farol, the widget's pet, programmer version (17 Nov, Marco).

The robot Marco drew (assets/farol-*.png) in black AMG chrome (farol-*-black.png, made by tools/farol_black.py: the star
and the AMG plate stay silver). Marco: «não é para fazer pixel art... tons preto, MG... um ganda patrão, impor respeito,
um petzinho cérebro super funcional». Drawn over the picture, in code:
  * the eyes: a boss look (a black chrome lid slanting to the nose), they blink, follow the mouse, smile «^ ^», sleep;
  * a hologram between his claws, what the Claude of this computer is doing: code while editing, a terminal «>_» for
    commands, a magnifier while reading, a green tick when done;
  * thinking: the hand-on-chin picture and a bubble of dots; «?» waiting for you;
  * something for you (a task, a message): the hologram shows it with its count, a red glow, and every few seconds he
    jumps and wiggles to call you until the mouse goes over him (the card says what it is) or you click.
Free, he rolls a few steps now and then and falls asleep after 5 minutes. Each frame is built once and cached; he only
repaints when the picture changes."""
import ctypes
import math
import os
import random
import sys
import time
from pathlib import Path

from PySide6.QtCore import QPoint, QPointF, QRectF, Qt, QTimer
from PySide6.QtGui import (QColor, QCursor, QFont, QFontMetricsF, QImage, QLinearGradient, QPainter, QPainterPath,
                           QPen, QRadialGradient)
from PySide6.QtWidgets import QApplication, QWidget

from . import prefs

ASSETS = Path(__file__).resolve().parent.parent / "assets"

W, H = 30, 36                            # the canvas, in units (10 pixels of the Farol pictures)
CELLS = (1.8, 2.2, 2.6, 3.0, 3.5)        # «Tamanho» in the central: logical pixels per unit
HEADROOM = 2                             # units above the canvas for a hop
BW = 214                                 # the card
GAP = 2
NAME = "FAROL"


TEXT, MUTED = QColor("#f2f3f5"), QColor("#9a9fa7")
QRED = QColor("#ff3b30")
UI = "Helvetica Neue" if sys.platform == "darwin" else "Segoe UI"

STATE = {"think": "a pensar", "edit": "a programar", "run": "a correr um comando", "read": "a ler",
         "idle": "contigo", "sleep": "a descansar", "alert": "para ti", "wait": "à tua espera", "done": "pronto",
         "walk": "a passear"}


_QUARTZ = []


def _idle_seconds() -> float:
    """How long since the last key or mouse movement (0 when unknown)."""
    try:
        if sys.platform == "darwin":
            if not _QUARTZ:
                q = ctypes.cdll.LoadLibrary("/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices")
                q.CGEventSourceSecondsSinceLastEventType.restype = ctypes.c_double
                _QUARTZ.append(q)
            return _QUARTZ[0].CGEventSourceSecondsSinceLastEventType(1, ctypes.c_uint32(0xFFFFFFFF))
        if sys.platform == "win32":
            class LII(ctypes.Structure):
                _fields_ = [("cbSize", ctypes.c_uint), ("dwTime", ctypes.c_uint)]
            lii = LII()
            lii.cbSize = ctypes.sizeof(LII)
            if ctypes.windll.user32.GetLastInputInfo(ctypes.byref(lii)):
                return (ctypes.windll.kernel32.GetTickCount() - lii.dwTime) / 1000.0
    except (OSError, AttributeError, ValueError):
        pass
    return 0.0


def _plural(n: int, one: str, many: str) -> str:
    return f"{n} {one if n == 1 else many}"


def _spring(u: float) -> float:
    if u >= 1:
        return 1.0
    return 1 - math.exp(-6.5 * u) * math.cos(8.5 * u)


def kind_of(action: str) -> str:
    """What the screen shows for a Claude step (office.describe's words)."""
    a = (action or "").lower()
    if not a or a.startswith(("a pensar", "a resumir", "aberto")):
        return "think"
    if a.startswith("a correr"):
        return "run"
    if a.startswith(("a ler", "a procurar", "a pesquisar", "a usar o chrome")):
        return "read"
    return "edit"


# ---------------------------------------------------------------------------------------------- the sprite
# The canvas, in pixels of the Farol pictures (293 x 320), with room on top for the bubbles. One «unit» is 10 of them.
CW, CH, TOP = 300, 360, 40
_SRC = {}


def _src(pose: str) -> QImage:
    if pose not in _SRC:
        _SRC[pose] = QImage(str(ASSETS / f"farol-{pose}-black.png")).convertToFormat(QImage.Format_ARGB32_Premultiplied)
    return _SRC[pose]


# the eyes of the «idle» picture (canvas coordinates): the white, and where the iris sits when he looks at you
EYE_L, EYE_R = (122.5, 142.5), (180.5, 142.5)
EYE_RX, EYE_RY = 21.5, 24.5
IRIS = ((133.0, 142.0), (170.0, 142.0))
GLASS = QColor("#25272b")                 # the black headlight glass around the eyes


def _qc(v: int) -> QColor:
    return QColor.fromRgba(v)


def build(spec: tuple) -> QImage:
    """One frame of the Farol, from a hashable description (equal frames come from the cache).
    spec = (pose, eyes, holo, fx, tilt)
      eyes = (dx, dy, lid, mood) on the idle picture (dx, dy in -1..1, lid 0 open .. 1 shut, mood open|happy|sleep)
      holo = None | ("code", n) | ("term", n, cursor, seed) | ("read", k) | ("done",)
      fx   = None | ("dots", k) | ("glyph", "?"|"!") | ("z", k)"""
    pose, eyes, holo, fx, tilt = spec
    img = QImage(CW, CH, QImage.Format_ARGB32_Premultiplied)
    img.fill(0)
    p = QPainter(img)
    p.setRenderHint(QPainter.Antialiasing)
    p.setRenderHint(QPainter.SmoothPixmapTransform)
    if tilt:
        p.translate(CW / 2, CH)
        p.rotate(tilt)
        p.translate(-CW / 2, -CH)
    p.drawImage(QPointF(3, TOP), _src(pose))
    if pose == "idle" and eyes:
        _eyes(p, *eyes)
    if holo:
        _holo(p, holo)
    p.resetTransform()
    if fx:
        _fx(p, fx)
    p.end()
    return img


def _eyes(p: QPainter, dx: float, dy: float, lid: float, mood: str):
    """Big glossy eyes drawn over the picture's own, so they can look, blink, smile and sleep."""
    for (cx, cy), (ix, iy) in zip((EYE_L, EYE_R), IRIS):
        white = QPainterPath()
        white.addEllipse(QPointF(cx, cy), EYE_RX, EYE_RY)
        p.save()
        p.setClipPath(white)
        g = QRadialGradient(QPointF(cx - 6, cy - 9), EYE_RY * 1.5)
        g.setColorAt(0, QColor("#fffdf8"))
        g.setColorAt(0.6, QColor("#f4ece2"))
        g.setColorAt(1, QColor("#b9c4cc"))
        p.setPen(Qt.NoPen)
        p.setBrush(g)
        p.drawEllipse(QPointF(cx, cy), EYE_RX, EYE_RY)
        if mood != "sleep":
            x, y = ix + dx * 6.5 - (3 if cx < 150 else -3) * abs(dx), iy + dy * 7
            ig = QRadialGradient(QPointF(x, y + 3), 15)
            ig.setColorAt(0, QColor("#0d3f5e"))
            ig.setColorAt(0.45, QColor("#2a8fc4"))
            ig.setColorAt(0.8, QColor("#63c9ef"))
            ig.setColorAt(1, QColor("#1b5878"))
            p.setBrush(ig)
            p.drawEllipse(QPointF(x, y), 10.5, 15.5)
            p.setBrush(QColor("#06090c"))
            p.drawEllipse(QPointF(x, y), 6.6, 10.8)
            p.setBrush(QColor(255, 255, 255, 235))
            p.drawEllipse(QPointF(x - 3.2, y - 7.5), 3.4, 3.4)
            p.setBrush(QColor(255, 255, 255, 150))
            p.drawEllipse(QPointF(x + 3.5, y + 6.5), 1.6, 1.6)
        if mood in ("sleep", "happy"):             # shut (a soft curve) or smiling (a glowing «^»)
            p.setBrush(GLASS)
            p.drawEllipse(QPointF(cx, cy), EYE_RX + 1, EYE_RY + 1)
            p.restore()
            if mood == "sleep":
                arc = QPainterPath(QPointF(cx - 14, cy + 2))
                arc.quadTo(QPointF(cx, cy + 14), QPointF(cx + 14, cy + 2))
                pen = QPen(QColor("#aeb6c2"), 3.2, Qt.SolidLine, Qt.RoundCap)
            else:
                arc = QPainterPath(QPointF(cx - 15, cy + 6))
                arc.quadTo(QPointF(cx, cy - 16), QPointF(cx + 15, cy + 6))
                p.setPen(QPen(QColor(110, 210, 255, 90), 9, Qt.SolidLine, Qt.RoundCap))
                p.setBrush(Qt.NoBrush)
                p.drawPath(arc)
                pen = QPen(QColor("#bfeaff"), 4.2, Qt.SolidLine, Qt.RoundCap)
            p.setPen(pen)
            p.setBrush(Qt.NoBrush)
            p.drawPath(arc)
            p.setPen(Qt.NoPen)
            continue
        shut = lid
        if shut > 0.02:                            # a chrome eyelid coming down
            top = cy - EYE_RY
            h = 2 * EYE_RY * shut
            lg = QLinearGradient(0, top, 0, top + h)
            lg.setColorAt(0, QColor("#6a6e77"))
            lg.setColorAt(1, QColor("#18191d"))
            p.setBrush(lg)
            # the boss look: the lid slants down towards the nose (none when the eye is shut)
            s = 0.0 if shut > 0.9 else 7.0 * (1 if cx < 150 else -1)
            inner, outer = (cx + EYE_RX + 1, cx - EYE_RX - 1) if cx < 150 else (cx - EYE_RX - 1, cx + EYE_RX + 1)
            edge_o, edge_i = QPointF(outer, top + h - abs(s) * 0.6), QPointF(inner, top + h + abs(s))
            p.drawPolygon([QPointF(outer, top - 1), QPointF(inner, top - 1), edge_i, edge_o])
            p.setPen(QPen(QColor("#050506"), 2.0))
            p.drawLine(edge_o, edge_i)
            p.setPen(Qt.NoPen)
        p.restore()
        p.setPen(QPen(QColor(0, 0, 0, 150), 1.4))           # a soft rim so the eye sits in the glass
        p.setBrush(Qt.NoBrush)
        p.drawEllipse(QPointF(cx, cy), EYE_RX, EYE_RY)
        p.setPen(Qt.NoPen)


HOLO = QRectF(68, 238, 164, 66)                    # between the claws, in front of the plate


def _holo(p: QPainter, holo: tuple):
    """The programmer's screen: a hologram he holds between his claws."""
    r = HOLO
    kind = holo[0]
    if kind in ("done", "note"):
        r = QRectF(112, 246, 76, 50)
    g = QLinearGradient(0, r.top(), 0, r.bottom())
    g.setColorAt(0, QColor(70, 190, 255, 92))
    g.setColorAt(1, QColor(40, 140, 230, 40))
    p.setBrush(g)
    p.setPen(QPen(QColor(150, 225, 255, 215), 1.6))
    p.drawRoundedRect(r, 7, 7)
    p.setPen(QPen(QColor(220, 245, 255, 200), 1.2))       # the top edge catches the light
    p.drawLine(QPointF(r.left() + 8, r.top() + 1.5), QPointF(r.right() - 8, r.top() + 1.5))
    p.setPen(Qt.NoPen)
    x0, y0 = r.left() + 10, r.top() + 9
    if kind == "code":
        n = holo[1]
        cols = (QColor("#9be3ff"), QColor("#8ff0b4"), QColor("#ff8f86"), QColor("#e6edf5"), QColor("#d3b6ff"))
        for row in range(5):
            rr = random.Random((n + row) * 7919)
            x = x0 + rr.choice((0, 0, 8, 16, 24))
            for _ in range(rr.choice((1, 2, 2, 3))):
                w = rr.randint(10, 34)
                if x + w > r.right() - 10:
                    break
                c = rr.choice(cols)
                c.setAlpha(230)
                p.setBrush(c)
                p.drawRoundedRect(QRectF(x, y0 + row * 10.5, w, 5), 2.5, 2.5)
                x += w + 6
        if n % 2:
            p.setBrush(QColor(255, 255, 255, 240))
            p.drawRect(QRectF(x0 + 8 + (n % 7) * 12, y0 + 4 * 10.5 - 1, 3, 8))
    elif kind == "term":
        n, cursor, seed = holo[1:]
        p.setPen(QPen(QColor("#5cf08f"), 2.6, Qt.SolidLine, Qt.RoundCap, Qt.RoundJoin))
        p.drawPolyline([QPointF(x0, y0), QPointF(x0 + 7, y0 + 5), QPointF(x0, y0 + 10)])
        p.setPen(Qt.NoPen)
        p.setBrush(QColor(225, 240, 250, 220))
        for j in range(min(n, 3)):
            rr = random.Random(j * 31 + seed)
            p.drawRoundedRect(QRectF(x0 + (16 if j == 0 else 0), y0 + 2 + j * 12 + (0 if j == 0 else 4),
                                     rr.randint(40, 110), 5), 2.5, 2.5)
        if cursor:
            p.setBrush(QColor("#5cf08f"))
            p.drawRect(QRectF(x0, r.bottom() - 13, 10, 4))
    elif kind == "read":
        k = holo[1]
        p.setBrush(QColor(225, 240, 250, 150))
        for row in range(5):
            w = (120, 96, 132, 80, 110)[row]
            p.drawRoundedRect(QRectF(x0, y0 + row * 10.5, w, 4.5), 2, 2)
        band = y0 + (k % 5) * 10.5 - 2.5
        p.setBrush(QColor(120, 220, 255, 110))
        p.drawRoundedRect(QRectF(x0 - 4, band, r.width() - 12, 9.5), 3, 3)
        mx = x0 + 20 + (k * 23) % 110
        p.setPen(QPen(QColor(255, 255, 255, 235), 2.4))
        p.setBrush(Qt.NoBrush)
        p.drawEllipse(QPointF(mx, band + 4.5), 7, 7)
        p.drawLine(QPointF(mx + 5, band + 9.5), QPointF(mx + 10, band + 14.5))
        p.setPen(Qt.NoPen)
    elif kind == "note":                           # a message (an envelope) or a task (a list), and how many
        what, n = holo[1], holo[2]
        cx, cy = r.center().x() - 4, r.center().y() + 1
        p.setPen(QPen(QColor(235, 248, 255, 240), 2.6, Qt.SolidLine, Qt.RoundCap, Qt.RoundJoin))
        p.setBrush(Qt.NoBrush)
        if what == "msg":
            p.drawRoundedRect(QRectF(cx - 17, cy - 11, 34, 23), 3, 3)
            p.drawPolyline([QPointF(cx - 16, cy - 9), QPointF(cx, cy + 3), QPointF(cx + 16, cy - 9)])
        else:
            for j in range(3):
                p.drawLine(QPointF(cx - 7, cy - 9 + j * 9), QPointF(cx + 15, cy - 9 + j * 9))
                p.drawPoint(QPointF(cx - 14, cy - 9 + j * 9))
        p.setPen(QPen(QColor(0, 0, 0, 160), 1.5))
        p.setBrush(QColor("#ff3b30"))
        p.drawEllipse(QPointF(r.right() - 6, r.top() + 4), 11, 11)
        f = QFont(UI)
        f.setPixelSize(15)
        f.setWeight(QFont.Black)
        p.setFont(f)
        p.setPen(QColor("white"))
        p.drawText(QRectF(r.right() - 17, r.top() - 7, 22, 22), Qt.AlignCenter, str(min(n, 9)))
        p.setPen(Qt.NoPen)
    elif kind == "done":
        p.setPen(QPen(QColor("#5cf08f"), 5, Qt.SolidLine, Qt.RoundCap, Qt.RoundJoin))
        p.drawPolyline([QPointF(r.center().x() - 15, r.center().y()), QPointF(r.center().x() - 4, r.center().y() + 11),
                        QPointF(r.center().x() + 17, r.center().y() - 11)])
        p.setPen(Qt.NoPen)


def _fx(p: QPainter, fx: tuple):
    kind = fx[0]
    if kind == "dots":                             # a thought bubble with three dots that run
        k = fx[1]
        p.setPen(QPen(QColor(0, 0, 0, 120), 1.5))
        p.setBrush(QColor(242, 245, 248, 245))
        p.drawEllipse(QPointF(236, 58), 5, 5)
        p.drawEllipse(QPointF(250, 42), 7.5, 7.5)
        p.drawRoundedRect(QRectF(214, 0, 82, 34), 17, 17)
        p.setPen(Qt.NoPen)
        for i in range(3):
            p.setBrush(QColor("#1d1e22") if i == k else QColor("#9aa0a8"))
            p.drawEllipse(QPointF(236 + i * 19, 17 - (3 if i == k else 0)), 6, 6)
    elif kind == "glyph":                          # «?» waiting for you, «!» something for you
        ch = fx[1]
        col = QColor("#ff3b30") if ch == "!" else QColor("#ffb340")
        p.setPen(QPen(QColor(0, 0, 0, 140), 2))
        p.setBrush(col)
        p.drawEllipse(QPointF(262, 30), 26, 26)
        p.setPen(QColor("white"))
        f = QFont(UI)
        f.setPixelSize(36)
        f.setWeight(QFont.Black)
        p.setFont(f)
        p.drawText(QRectF(236, 4, 52, 52), Qt.AlignCenter, ch)
    elif kind == "z":
        k = fx[1]
        f = QFont(UI)
        f.setWeight(QFont.Black)
        for i in range(3):
            u = ((k + i * 4) % 12) / 12.0
            f.setPixelSize(round(16 + 14 * u))
            p.setFont(f)
            p.setPen(QColor(200, 228, 255, round(230 * (1 - u))))
            p.drawText(QPointF(232 + 26 * u, 64 - 56 * u), "z")


# ---------------------------------------------------------------------------------------------- the window
class Pet(QWidget):
    def __init__(self, on_click, open_page=None):
        # On the Mac a plain window, like the star: a tool window (NSPanel) does not go over apps in full screen.
        kind = Qt.Window | Qt.WindowDoesNotAcceptFocus if sys.platform == "darwin" else Qt.Tool
        super().__init__(None, kind | Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint | Qt.NoDropShadowWindowHint)
        self.setAttribute(Qt.WA_TranslucentBackground)
        self.setAttribute(Qt.WA_ShowWithoutActivating)
        self.setAttribute(Qt.WA_MacAlwaysShowToolWindow)
        self.on_click, self.open_page = on_click, open_page
        saved = prefs.load()
        self._step = max(0, min(len(CELLS) - 1, int(saved.get("bit_size", 1))))
        self._on = saved.get("farol_on", True)
        self._fit()
        g = QApplication.primaryScreen().availableGeometry()
        at = saved.get("bit_at")
        self._at = QPoint(*at) if at else QPoint(g.right() - self.AW - 24, g.bottom() - self.AH - 8)
        self._home = QPoint(self._at)
        self.mode, self.kind, self.topic, self.action, self.live = "idle", "think", "", "", {}
        now = time.monotonic()
        self._t0 = self._last = now
        self._mode_at = self._kind_at = now
        self._done_until = 0.0
        self._alerts = []
        self._card, self._card_at, self._card_left = None, 0.0, False
        self._hover, self._hover_at = False, 0.0
        self._enter = (now, +1)
        self._hop_at, self._press_down = -9.0, False
        self._call_at, self._seen, self._quiet_until = -9.0, 0, 0.0   # calling you: last call, alerts seen, hover pause
        self._badge_at = 0.0
        self._blink_at, self._next_blink = -9.0, now + random.uniform(2, 4)
        self._glance, self._next_glance = (0, 0), now + random.uniform(2.5, 5)
        self._mouse = None
        self._walk, self._next_walk, self._face = None, now + random.uniform(25, 50), 1
        self._busy = 0.0
        self._last_check, self._away = now, False
        self._press, self._moved, self._press_at = None, False, QPoint()
        self._robot_x = self._robot_y = 0
        self._x_rect = self._card_rect = QRectF()
        self._cache = {}
        self._painted = None
        self._f_head = QFont(UI)
        self._f_head.setPixelSize(9)
        self._f_head.setBold(True)
        self._f_head.setLetterSpacing(QFont.AbsoluteSpacing, 1.4)
        self._f_state = QFont(UI)
        self._f_state.setPixelSize(9)
        self._f_text = QFont(UI)
        self._f_text.setPixelSize(11)
        self._check_t = QTimer(self)
        self._check_t.timeout.connect(self._check)
        self._check_t.start(4000)
        self._mouse_t = QTimer(self)
        self._mouse_t.timeout.connect(self._watch_mouse)
        self._mouse_t.start(250)
        self._tick = QTimer(self)
        self._tick.setSingleShot(True)
        self._tick.timeout.connect(self._frame)
        if hasattr(os, "nice"):
            try:
                os.nice(10)
            except OSError:
                pass
        self._layout()

    # ------------------------------------------------------------ size and on/off (the central's line)
    def _fit(self):
        self.CELL = CELLS[self._step]
        self.AW = round(W * self.CELL)
        self.AH = round((H + HEADROOM) * self.CELL)

    def set_size(self, step: int):
        self._step = max(0, min(len(CELLS) - 1, step))
        prefs.save(bit_size=self._step)
        bottom, cx = self._at.y() + self.AH, self._at.x() + self.AW / 2
        self._fit()
        self._at = QPoint(round(cx - self.AW / 2), bottom - self.AH)     # grows from his feet
        self._home = QPoint(self._at)
        self._hop_at = time.monotonic()
        self._layout()
        self._wake()

    def size_step(self) -> int:
        return self._step

    def set_on(self, on: bool):
        self._on = bool(on)
        prefs.save(farol_on=self._on)
        if self._on:
            self.arrive()
        else:
            self.leave()

    def is_on(self) -> bool:
        return self._on

    # ------------------------------------------------------------ from the widget
    @staticmethod
    def _my_action(live: dict) -> str:
        for w in live.get("windows") or ():
            if w.get("state") == "working":
                return w.get("action") or ""
        return ""

    def set_state(self, live: dict, person: dict):
        live = live or {}
        first = not self.live
        self.live = live
        topic = (live.get("topic") or "").strip()
        now = time.monotonic()
        if live.get("working"):
            mode = "work"
        elif live.get("waiting") and live.get("wait") in ("permission", "answer"):
            mode = "wait"
        else:
            mode = "idle"
        action = self._my_action(live) if mode == "work" else ""
        kind = kind_of(action)
        if kind != self.kind:
            self.kind, self._kind_at = kind, now
        self.action = action
        if first:
            self.topic = topic
            self._say(NAME, self._briefing(first=True), None, 8, "info")
        if mode != self.mode:
            before, self.mode, self._mode_at = self.mode, mode, now
            self._walk = None
            if mode == "wait":
                what = "Pede autorização" if live.get("wait") == "permission" else "Espera pela tua resposta"
                self._say("O CLAUDE", what + (f": {topic}" if topic else "."), None, None, "wait")
                self._hop_at = now
            elif before == "work" and mode == "idle" and not first:
                self._say("PRONTO", topic or "O Claude acabou o que estava a fazer.", None, 9, "done")
                self._hop_at, self._done_until = now, now + 3.0
            if before == "wait" and self._card and self._card[4] == "wait":
                self._card = None
                self._layout()
        self.topic = topic or self.topic
        self._wake()

    def alert(self, items):
        """Tasks or messages arrived (the corner cards' list); only the ones sent to this person count."""
        mine = [i for i in items or () if i.get("directed")]
        if not mine:
            return
        if not self._alerts:
            self._seen = 0
        self._alerts.extend(mine)
        last = mine[-1]
        kind = "MENSAGEM" if (last.get("href") or "").startswith("#/mensagens") else "TAREFA NOVA"
        head = kind if len(self._alerts) == 1 else f"{len(self._alerts)} COISAS PARA TI"
        text = (last.get("title") or "").strip()
        body = (last.get("body") or "").strip()
        if body and body != text:
            text = f"{text} — {body}" if text else body
        self._badge_at = self._hop_at = time.monotonic()
        self._walk = None
        self._say(head, text or "Tens uma coisa nova no Hub.", last.get("href"), None, "alert")

    def leave(self):
        """The central opens (or he is switched off): the screen powers off and he dissolves."""
        if not self.isVisible() or (self._enter and self._enter[1] < 0):
            return
        self._alerts, self._card, self._hover, self._walk = [], None, False, None
        self._enter = (time.monotonic(), -1)
        self._layout()
        self._wake()

    def arrive(self):
        """The central closed: he appears pixel by pixel and the screen powers on."""
        if not self._on:
            return
        self._enter = (time.monotonic(), +1)
        self._mode_at = time.monotonic()
        self._layout()
        self.show()
        self._wake()

    def showEvent(self, e):
        super().showEvent(e)
        if not self._on:
            QTimer.singleShot(0, self.hide)
            return
        self._wake()

    # ------------------------------------------------------------ what he says
    def _briefing(self, first=False) -> str:
        m, t = self.live.get("messages") or 0, self.live.get("tasks") or 0
        lead = "Olá, sou o Farol." if first else "Bem-vindo de volta."
        bits = []
        if m:
            bits.append(_plural(m, "mensagem por ler", "mensagens por ler"))
        if t:
            bits.append(_plural(t, "tarefa aberta", "tarefas abertas"))
        out = lead + (" Tens " + " e ".join(bits) + "." if bits else "")
        if self.live.get("working"):
            out += " O Claude está a trabalhar" + (f" em «{self.topic}»." if self.topic else ".")
        elif not bits:
            out += " Está tudo em dia." if first else " Tudo calmo enquanto estiveste fora."
        return out

    def _status(self) -> str:
        m, t = self.live.get("messages") or 0, self.live.get("tasks") or 0
        if self.mode == "work":
            claude = self.action or "a trabalhar"
            if self.topic:
                claude += f" · {self.topic}"
        else:
            claude = "à tua espera" if self.mode == "wait" else "parado"
        return f"Claude {claude}\n{_plural(m, 'mensagem', 'mensagens')} · {_plural(t, 'tarefa', 'tarefas')}"

    def _say(self, head, text, href, seconds, kind):
        self._card = (head, text, href, (time.monotonic() + seconds) if seconds else None, kind)
        self._card_at = time.monotonic()
        self._walk = None
        self._layout()
        self._wake()

    # ------------------------------------------------------------ the window: the robot, and the card beside it
    def _card_lines(self) -> list:
        if not self._card and not self._hover:
            return []
        text = self._card[1] if self._card else self._status()
        fm = QFontMetricsF(self._f_text)
        room = BW - 28
        out = []
        for para in text.split("\n"):
            line = ""
            for w in para.split():
                trial = f"{line} {w}".strip()
                if fm.horizontalAdvance(trial) <= room or not line:
                    line = trial
                else:
                    out.append(line)
                    line = w
            out.append(fm.elidedText(line, Qt.ElideRight, room))
        if len(out) > 3:
            out = out[:3]
            out[-1] = fm.elidedText(out[-1] + " …", Qt.ElideRight, room)
        return out

    def _layout(self):
        lines = [] if (self._enter and self._enter[1] < 0) else self._card_lines()
        screen = QApplication.screenAt(self._at + QPoint(self.AW // 2, self.AH // 2)) or QApplication.primaryScreen()
        g = screen.availableGeometry()
        if lines:
            ch = 30 + 14 * len(lines) + 7
            left = self._at.x() + self.AW / 2 > g.center().x()
            w, h = self.AW + GAP + BW, max(self.AH, ch + 4)
            self._robot_x = BW + GAP if left else 0
            self._robot_y = h - self.AH
            top = max(2.0, min(h - ch - 2, self._robot_y + self.AH * 0.22))
            self._card_rect = QRectF(1 if left else self.AW + GAP, top, BW - 1, ch)
            self._card_left = left
            self.setFixedSize(round(w), round(h))
            self.move(self._at.x() - round(self._robot_x), self._at.y() - round(self._robot_y))
        else:
            self._robot_x = self._robot_y = 0
            self._card_rect = QRectF()
            self.setFixedSize(self.AW, self.AH)
            self.move(self._at)
        self.update()

    # ------------------------------------------------------------ the clock
    def _check(self):
        """Every 4 s: how busy the computer is, cards that ran out, and whether the person just came back."""
        now = time.monotonic()
        try:
            self._busy = os.getloadavg()[0] / max(1, os.cpu_count() or 1)
        except (OSError, AttributeError):
            self._busy = 0.0
        slept = now - self._last_check > 60
        self._last_check = now
        idle = _idle_seconds()
        if idle > 600 or slept:
            self._away = True
        elif self._away and idle < 5:
            self._away = False
            self._mode_at = now
            if self.isVisible() and not (self._card and self._card[3] is None):
                self._say(NAME, self._briefing(), None, 10, "info")
                self._hop_at = now
        if self._card and self._card[3] and now > self._card[3]:
            self._card = None
            self._layout()
        self._wake()

    def _watch_mouse(self):
        """Four times a second: is the mouse near? Then the eyes follow it."""
        if not self.isVisible() or self._enter:
            return
        face = self.mapToGlobal(QPoint(round(self._robot_x + self.AW / 2), round(self._robot_y + self.AH - 21 * self.CELL)))
        d = QCursor.pos() - face
        near = None
        if math.hypot(d.x(), d.y()) < 360:
            near = (max(-1, min(1, round(d.x() / 70))), max(-1, min(1, round(d.y() / 70))))
        if near != self._mouse:
            self._mouse = near
            self._wake()

    def _look(self, now: float) -> str:
        if self._alerts:
            return "alert"
        if self.mode == "work":
            return self.kind
        if self.mode == "wait":
            return "wait"
        if now < self._done_until:
            return "done"
        if self._walk:
            return "walk"
        if now - self._mode_at > 300 and not self._card and not self._hover:
            return "sleep"
        return "idle"

    def _wake(self):
        if not self._tick.isActive() or self._tick.remainingTime() > 34:
            self._tick.start(0)

    def _start_walk(self, now: float):
        scr = QApplication.screenAt(self._at + QPoint(self.AW // 2, self.AH // 2)) or QApplication.primaryScreen()
        g = scr.availableGeometry()
        if abs(self._at.x() - self._home.x()) > 12:
            target = self._home.x()
        else:
            target = self._home.x() + random.choice((-1, 1)) * random.uniform(45, 120)
        target = max(g.left() + 4, min(g.right() - self.AW - 4, target))
        if abs(target - self._at.x()) > 8:
            self._walk = float(target)
            self._face = 1 if target > self._at.x() else -1
            self._walk_x = float(self._at.x())
        self._next_walk = now + random.uniform(40, 110)

    def _frame(self):
        now = time.monotonic()
        dt = min(0.25, max(0.0, now - self._last))
        self._last = now
        if self._enter and now - self._enter[0] > (0.75 if self._enter[1] > 0 else 0.6):
            gone = self._enter[1] < 0
            self._enter = None
            if gone:
                self.hide()
                return
        if not self.isVisible():
            return
        look = self._look(now)
        if now >= self._next_blink:
            self._blink_at = now
            self._next_blink = now + (0.3 if random.random() < 0.18 else random.uniform(2.6, 5.5))
        if now >= self._next_glance:
            self._glance = random.choice(((0, 0), (0, 0), (-1, 0), (1, 0), (1, -1), (-1, 1), (0, 1)))
            self._next_glance = now + random.uniform(1.6, 4.0)
        # a walk now and then, when he is free and nobody is looking at him
        if (look == "idle" and not self._card and not self._hover and not self._press and not self._enter
                and self._busy < 0.7 and now >= self._next_walk):
            self._start_walk(now)
            look = self._look(now)
        if self._walk is not None:
            if look != "walk":
                self._walk = None
            else:
                step = 26.0 * dt * self._face
                self._walk_x += step
                if (self._face > 0 and self._walk_x >= self._walk) or (self._face < 0 and self._walk_x <= self._walk):
                    self._walk_x = self._walk
                    self._walk = None
                    self._glance = (0, 0)
                self._at = QPoint(round(self._walk_x), self._at.y())
                self.move(self._at)
        # something for you that you have not seen yet: he calls you, a jump and a wiggle every few seconds, until the
        # mouse goes over him (the card says what it is) or you click
        if look in ("alert", "wait") and not self._enter and not self._press:
            want = len(self._alerts) > self._seen if look == "alert" else now > self._quiet_until
            if want and now - self._call_at > (3.2 if look == "alert" else 8.0):
                self._call_at = self._hop_at = now
        calling = now - self._call_at < 1.2
        hop = now - self._hop_at
        # paint only when the picture changes (a paint costs ~2 ms of the window server on the Mac)
        sig = (self._spec(look, now), look == "walk" and self._face, self._alerts and len(self._alerts))
        if sig != self._painted or self._enter or hop < 0.7 or calling or self._press_down or now - self._card_at < 0.3 \
                or now - self._badge_at < 0.5:
            self._painted = sig
            self.update()
        # the next frame: as late as it can be
        if self._enter or hop < 0.7 or calling or now - self._card_at < 0.3 or self._press_down or now - self._badge_at < 0.5:
            ms = 33
        elif look == "walk":
            ms = 83
        elif look in ("edit", "run") and self._busy < 0.85:
            ms = 333                            # typing: 3 a second is enough for pixel art (each paint ~2 ms of macOS)
        elif look in ("think", "read", "alert", "wait", "done"):
            ms = 280 if self._busy < 0.85 else 600
        elif look == "sleep":
            ms = 700
        elif self._hover and now - self._hover_at < 1.6:
            ms = 160
        else:                                   # idle: wake for the next blink, glance or breath
            nxt = min(self._next_blink, self._next_glance, self._next_walk)
            if now - self._blink_at < 0.16:
                nxt = self._blink_at + 0.16
            ms = max(120, min(1200, round((nxt - now) * 1000)))
        self._tick.start(ms)

    # ------------------------------------------------------------ the frame description
    def _spec(self, look: str, now: float):
        t = now - self._t0
        blink = 0 <= now - self._blink_at < 0.15
        gx, gy = self._glance
        if self._mouse and look in ("idle", "wait", "done", "alert"):
            gx, gy = self._mouse
        lid = 1.0 if blink else 0.3              # a patrão: eyes a little lowered, sure of himself
        pose, eyes, holo, fx, tilt = "idle", (gx, gy, lid, "open"), None, None, 0
        if look == "idle":
            if self._hover and now - self._hover_at < 2.5:
                eyes = (gx, gy, 0.0, "happy")
        elif look == "walk":
            eyes = (self._face, 0, lid, "open")
            tilt = (-1.5, 0, 1.5, 0)[int(t * 6) % 4]
        elif look == "sleep":
            eyes = (0, 0, 1.0, "sleep")
            fx = ("z", int(t * 4) % 12)
        elif look == "think":                    # the thinking picture: hand on the chin, eyes up
            pose, eyes = "think", None
            fx = ("dots", int(t * 3.5) % 3)
        elif look == "edit":                     # he codes on his hologram (one 32-frame loop, built once)
            f = int(t * 3) % 32
            eyes = (0, 0.9, max(lid, 0.4), "open")
            holo = ("code", f)
        elif look == "run":
            f = int(t * 3) % 40
            eyes = (0, 0.9, max(lid, 0.4), "open")
            holo = ("term", (f // 2) % 5, (f // 2) % 2, f // 10)
        elif look == "read":
            k = int(t * 2.5) % 10
            eyes = ((-1, -0.3, 0.3, 1, 0.3, -0.3)[int(t * 2) % 6], 0.9, lid, "open")
            holo = ("read", k)
        elif look == "wait":
            fx = ("glyph", "?") if int(t / 0.8) % 2 else None
            eyes = (gx, gy, 0.0 if not blink else 1.0, "open")
        elif look == "alert":                    # something for you: he shows it on his hologram and calls you
            last = self._alerts[-1]
            what = "msg" if (last.get("href") or "").startswith("#/mensagens") else "task"
            holo = ("note", what, len(self._alerts))
            fx = ("glyph", "!") if int(t / 0.6) % 2 else None
            eyes = (gx, gy, 0.0 if not blink else 1.0, "happy" if self._hover else "open")   # wide: he calls you
        c = now - self._call_at
        if look in ("alert", "wait") and 0 <= c < 0.9:                       # the call: a jump and a wiggle
            tilt = round(7 * math.sin(c * 22) * (1 - c / 0.9))
            fx = ("glyph", "!" if look == "alert" else "?")
        else:                                                                 # done
            eyes = (0, 0, 0.0, "happy")
            holo = ("done",)
        if self._press and self._moved:                                       # picked up: eyes wide, looking up
            pose, eyes, holo, tilt = "idle", (0, -1, 0.0, "open"), None, 0
        return (pose, eyes, holo, fx, tilt)

    def _image(self, spec) -> QImage:
        dpr = self.devicePixelRatioF()
        key = (spec, self._step, dpr)
        img = self._cache.get(key)
        if img is None:
            if len(self._cache) > 160:
                self._cache.clear()
            w, h = round(W * self.CELL * dpr), round(H * self.CELL * dpr)
            img = build(spec).scaled(w, h, Qt.IgnoreAspectRatio, Qt.SmoothTransformation)
            img.setDevicePixelRatio(dpr)
            self._cache[key] = img
        return img

    # ------------------------------------------------------------ painting
    def paintEvent(self, _):
        now = time.monotonic()
        look = self._look(now)
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        if not self._card_rect.isNull():
            self._paint_card(p, look, now)
        p.translate(self._robot_x, self._robot_y)
        c = self.CELL
        hop = 0.0
        h = now - self._hop_at
        if 0 <= h < 0.42 and not self._enter:
            hop = 3.2 * c * math.sin(math.pi * h / 0.42)
        if self._press and self._moved:
            hop = 1.5 * c
        alpha = 1.0
        if self._enter:                          # comes up out of the floor fading in; goes down fading out
            u = now - self._enter[0]
            k = min(1.0, u / 0.45) if self._enter[1] > 0 else max(0.0, 1 - u / 0.45)
            k = 1 - (1 - k) ** 3
            alpha, hop = k, hop - (1 - k) * 3 * c
        img = self._image(self._spec(look, now))
        x0 = 0.0
        y0 = self.AH - H * c - hop
        # the shadow on the floor, smaller in the air
        fy = self.AH - 1.0 * c
        k = max(0.4, 1 - max(0.0, hop) / (5 * c))
        sh = QRadialGradient(QPointF(self.AW / 2, fy), 11 * c)
        sh.setColorAt(0, QColor(0, 0, 0, round(80 * k * alpha)))
        sh.setColorAt(1, QColor(0, 0, 0, 0))
        p.setPen(Qt.NoPen)
        p.setBrush(sh)
        p.drawEllipse(QPointF(self.AW / 2, fy), 11 * c * k, 1.3 * c)
        unseen = (self._alerts and len(self._alerts) > self._seen) or (self.mode == "wait" and now > self._quiet_until)
        if unseen and not self._enter:
            col = QColor("#ff3b30") if self._alerts else QColor("#ffb340")
            glow = QRadialGradient(QPointF(self.AW / 2, self.AH - 9 * c), 14 * c)
            col.setAlpha(70)
            glow.setColorAt(0, col)
            col.setAlpha(0)
            glow.setColorAt(1, col)
            p.setBrush(glow)
            p.drawEllipse(QPointF(self.AW / 2, self.AH - 9 * c), 14 * c, 12 * c)
            u = now - self._call_at
            if 0 <= u < 1.2:                         # a ring that runs out on the floor
                col.setAlpha(round(220 * (1 - u / 1.2)))
                p.setPen(QPen(col, 2.2))
                p.setBrush(Qt.NoBrush)
                p.drawEllipse(QPointF(self.AW / 2, fy), (5 + 11 * u) * c, (1 + 2.6 * u) * c)
                p.setPen(Qt.NoPen)
        p.setOpacity(alpha)
        p.drawImage(QPointF(x0, y0), img)
        p.setOpacity(1.0)
        if self._alerts and not self._enter:
            self._paint_badge(p, x0 + 25 * c, y0 + 6 * c, now)
        p.end()

    def _paint_badge(self, p: QPainter, x: float, y: float, now: float):
        n = len(self._alerts)
        s = _spring(min(1.0, (now - self._badge_at) / 0.5))
        r = 7.0 * s
        if r <= 0.5:
            return
        p.setPen(QPen(QColor(10, 10, 12, 220), 1.5))
        p.setBrush(QRED)
        p.drawEllipse(QPointF(x, y), r, r)
        f = QFont(UI)
        f.setPixelSize(max(6, round(9 * s)))
        f.setBold(True)
        p.setFont(f)
        p.setPen(QColor("white"))
        p.drawText(QRectF(x - r, y - r, 2 * r, 2 * r), Qt.AlignCenter, str(n) if n < 10 else "9+")

    def _paint_card(self, p: QPainter, look: str, now: float):
        """The card in the widget's black glass, opening with a little spring from his side."""
        r = QRectF(self._card_rect)
        lines = self._card_lines()
        if not lines:
            return
        u = min(1.0, (now - self._card_at) / 0.28)
        s = 0.94 + 0.06 * _spring(u)
        p.save()
        p.setOpacity(min(1.0, u * 2.2))
        ox = r.right() if self._card_left else r.left()
        p.translate(ox, r.center().y())
        p.scale(s, s)
        p.translate(-ox, -r.center().y())
        p.setPen(Qt.NoPen)
        for i, a in ((3, 18), (1.5, 30)):
            p.setBrush(QColor(0, 0, 0, a))
            p.drawRoundedRect(r.translated(0, i), 13, 13)
        p.setBrush(QColor(14, 15, 18, 244))
        p.setPen(QPen(QColor(255, 255, 255, 28), 1))
        p.drawRoundedRect(r, 13, 13)
        x = r.left() + 13
        head = self._card[0] if self._card else NAME
        alert = bool(self._card) and self._card[4] == "alert"
        p.setPen(Qt.NoPen)
        p.setBrush(QRED if alert else QColor(127, 212, 255))
        p.drawEllipse(QPointF(x + 2.5, r.top() + 15.5), 2.5, 2.5)
        p.setFont(self._f_head)
        p.setPen(TEXT)
        p.drawText(QRectF(x + 10, r.top() + 9, BW - 120, 13), Qt.AlignLeft | Qt.AlignVCenter, head)
        p.setFont(self._f_state)
        p.setPen(MUTED)
        p.drawText(QRectF(r.right() - 110, r.top() + 9, 110 - (28 if self._card else 13), 13),
                   Qt.AlignRight | Qt.AlignVCenter, STATE.get(look, ""))
        p.setFont(self._f_text)
        p.setPen(TEXT)
        for i, line in enumerate(lines):
            p.drawText(QRectF(x, r.top() + 27 + 14 * i, BW - 26, 14), Qt.AlignLeft | Qt.AlignVCenter, line)
        if self._card:
            self._x_rect = QRectF(r.right() - 23, r.top() + 7, 15, 15)
            p.setPen(QPen(MUTED, 1.3, Qt.SolidLine, Qt.RoundCap))
            c = self._x_rect.center()
            p.drawLine(c + QPointF(-3, -3), c + QPointF(3, 3))
            p.drawLine(c + QPointF(-3, 3), c + QPointF(3, -3))
        else:
            self._x_rect = QRectF()
        p.restore()

    # ------------------------------------------------------------ mouse
    def enterEvent(self, e):
        self._seen = len(self._alerts)                 # seen: he stops calling (the «!» stays until you click)
        self._quiet_until = time.monotonic() + 30
        if not self._card and not self._enter:
            self._hover = True
            self._hover_at = self._card_at = time.monotonic()
            self._walk = None
            self._layout()
        self._wake()

    def leaveEvent(self, e):
        if self._hover:
            self._hover = False
            self._layout()
        self._wake()

    def mousePressEvent(self, e):
        if e.button() == Qt.LeftButton:
            self._press, self._moved, self._press_at = e.globalPosition().toPoint(), False, QPoint(self._at)
            self._press_down = True
            self._walk = None
            self._wake()

    def mouseMoveEvent(self, e):
        if self._press is not None:
            d = e.globalPosition().toPoint() - self._press
            if d.manhattanLength() > 3 or self._moved:
                self._moved = True
                self._at = self._press_at + d
                self.move(self._at.x() - round(self._robot_x), self._at.y() - round(self._robot_y))
                self._wake()

    def mouseReleaseEvent(self, e):
        self._press_down = False
        if self._press is None:
            return
        self._press = None
        if self._moved:
            self._moved = False
            self._home = QPoint(self._at)
            prefs.save(bit_at=[self._at.x(), self._at.y()])
            self._layout()
            self._hop_at = time.monotonic()
            self._wake()
            return
        pos = e.position()
        self._mode_at = time.monotonic()
        if self._card and self._x_rect.contains(pos):
            if self._card[4] == "alert":
                self._alerts = []
            self._card = None
            self._layout()
            return
        href = self._card[2] if self._card else None
        if self._alerts:
            href = href or self._alerts[-1].get("href")
            self._alerts = []
        self._card, self._hover = None, False
        self._layout()
        if href and self.open_page:
            self.open_page(href)
        elif self.on_click:
            self.on_click()


class FarolControl(QWidget):
    """The central's «Farol» line: − five dots + to size him, and a switch to show or hide him. Per computer."""

    def __init__(self, pet: "Pet"):
        super().__init__()
        self.pet = pet
        self.setFixedHeight(30)
        self.setCursor(Qt.PointingHandCursor)
        self._minus = self._plus = self._switch = QRectF()

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        h = self.height()
        f = QFont(UI)
        f.setPixelSize(11)
        p.setFont(f)
        p.setPen(MUTED)
        p.drawText(QRectF(2, 0, 70, h), Qt.AlignLeft | Qt.AlignVCenter, "Tamanho")
        x = 72
        self._minus = QRectF(x, h / 2 - 11, 22, 22)
        n = len(CELLS)
        self._plus = QRectF(x + 26 + n * 12 + 4, h / 2 - 11, 22, 22)
        for r, glyph in ((self._minus, "−"), (self._plus, "+")):
            p.setPen(QPen(QColor(255, 255, 255, 34), 1))
            p.setBrush(QColor(255, 255, 255, 14))
            p.drawEllipse(r)
            p.setPen(TEXT)
            p.drawText(r, Qt.AlignCenter, glyph)
        step = self.pet.size_step()
        for i in range(n):
            c = QPointF(x + 26 + 6 + i * 12, h / 2)
            p.setPen(Qt.NoPen)
            p.setBrush(QColor(127, 212, 255) if i == step else (QColor(255, 255, 255, 120) if i < step else QColor(255, 255, 255, 40)))
            p.drawEllipse(c, 3.2 if i == step else 2.4, 3.2 if i == step else 2.4)
        on = self.pet.is_on()
        self._switch = QRectF(self.width() - 40, h / 2 - 9, 36, 18)
        p.setPen(Qt.NoPen)
        p.setBrush(QColor(52, 199, 89) if on else QColor(255, 255, 255, 40))
        p.drawRoundedRect(self._switch, 9, 9)
        p.setBrush(QColor("white"))
        p.drawEllipse(QPointF(self._switch.right() - 9 if on else self._switch.left() + 9, self._switch.center().y()), 7, 7)
        p.setPen(MUTED)
        p.drawText(QRectF(self._switch.left() - 70, 0, 64, h), Qt.AlignRight | Qt.AlignVCenter, "Ligado" if on else "Desligado")

    def mousePressEvent(self, e):
        pos = e.position()
        if self._minus.adjusted(-4, -4, 4, 4).contains(pos):
            self.pet.set_size(self.pet.size_step() - 1)
        elif self._plus.adjusted(-4, -4, 4, 4).contains(pos):
            self.pet.set_size(self.pet.size_step() + 1)
        elif self._switch.adjusted(-70, -6, 4, 6).contains(pos):
            self.pet.set_on(not self.pet.is_on())
        self.update()
