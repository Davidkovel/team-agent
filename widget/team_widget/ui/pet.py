"""Bit, the widget's pet (17 Nov, Marco).

«Um amiguinho... uma espécie de programador... não uma imagem com bordas feias... como se fosse um PC de um robô... tem
de se ver o gajo a pensar quando tu estás a pensar, a andar.» Then: «tiraste as rodinhas... tinha de ser o mesmo robô
[o Farol], só que a versão programador». So he is the Farol in pixel art, in the widget's black chrome: a round helmet
with a visor and a light on top, a ribbed headlight for a face with big round eyes, ear cups like headphones, claw
hands, and tracks with two turning wheels and the AMG plate. He rolls on them when he moves.

He is drawn in code, cell by cell, into a tiny image (32 x 32 cells) scaled up without smoothing: sharp pixels at every
size, no cut-out picture and no halo. The headlight does the acting, following what the Claude of this computer is doing
(the `action` of the working window, from the Escritório hooks):
  * «a pensar»: three dots that run, a hand on the chin, a little thought bubble;
  * editing: he types on his laptop and the screen is a code editor that scrolls;
  * a command: «>_» with the output coming;
  * reading or searching: the eyes sweep left and right with a scan line;
  * done: ^ ^ and both arms up, a hop; waiting for you: «?» and he waves; something for you: a red «!» and hops;
  * free: blinks, looks around, follows the mouse, walks a few steps now and then, falls asleep after 5 minutes.
He comes in and goes out by dissolving pixel by pixel, the screen powering on and off like an old monitor.

Weight (Marco: «roubar o mínimo de CPU»): one 26x26 image built only when a cell changes (cached), a few frames a second
only while something moves (typing 8/s, walking 12/s, still otherwise: the next blink). The process runs at nice 10."""
import ctypes
import math
import os
import random
import sys
import time

from PySide6.QtCore import QPoint, QPointF, QRectF, Qt, QTimer
from PySide6.QtGui import QColor, QCursor, QFont, QFontMetricsF, QImage, QPainter, QPen, QRadialGradient
from PySide6.QtWidgets import QApplication, QWidget

from . import prefs

W, H = 32, 32                            # the sprite, in cells
CELLS = (1.5, 2.0, 2.5, 3.0, 3.5)        # «Tamanho» in the central: logical pixels per cell
HEADROOM = 4                             # cells above the sprite for a hop
BW = 214                                 # the card
GAP = 2
NAME = "BIT"


def _c(hexs: str, a: int = 255) -> int:
    v = int(hexs.lstrip("#"), 16)
    return (a << 24) | v


# the palette: the widget's black chrome, ice blue, the AMG red
K = _c("#050506")                        # outline
HEAD, HEAD_HI, HEAD_LO = _c("#34373e"), _c("#5d626d"), _c("#1d1f23")
RIM = _c("#0b0c0e")
BODY, BODY_HI, BODY_LO = _c("#3a3d45"), _c("#575c67"), _c("#25272c")
HAND, LIMB = _c("#9aa1ad"), _c("#5d626d")
RED, RED_DK = _c("#ff3b30"), _c("#5a1612")
AMBER, GREEN = _c("#ffb340"), _c("#34c759")
SCR, SCR_LINE, SCR_GLARE = _c("#06121b"), _c("#0a1824"), _c("#183244")
EYE, EYE_HI, EYE_DIM = _c("#8fdcff"), _c("#effaff"), _c("#2f6580")
LID, LID_HI, BASE, BASE_LO = _c("#2a2d33"), _c("#4b505a"), _c("#71767f"), _c("#3b3e45")
EAR, EAR_HI = _c("#2a2d33"), _c("#4f5560")
PUPIL, GLOSS = _c("#0b2a3f"), _c("#a9b0bb")
TREAD, TREAD_HI, TRACK_IN = _c("#16171a"), _c("#3a3d44"), _c("#0c0d0f")
WHEEL, WHEEL_HI, HUB = _c("#40444c"), _c("#9aa1ad"), _c("#25272c")
PLATE, PLATE_HI = _c("#5b606b"), _c("#8a909b")
CODE = (_c("#8fdcff"), _c("#7ee2a8"), _c("#ff7a70"), _c("#cfd8e3"), _c("#c9a7ff"))
BUBBLE = _c("#dfe6ee", 230)

TEXT, MUTED = QColor("#f2f3f5"), QColor("#9a9fa7")
QRED = QColor("#ff3b30")
UI = "Helvetica Neue" if sys.platform == "darwin" else "Segoe UI"

STATE = {"think": "a pensar", "edit": "a programar", "run": "a correr um comando", "read": "a ler",
         "idle": "contigo", "sleep": "a descansar", "alert": "para ti", "wait": "à tua espera", "done": "pronto",
         "walk": "a passear"}

GLYPHS = {"?": (".###.", "#...#", "....#", "..##.", "..#..", ".....", "..#.."),
          "!": ("..##.", "..##.", "..##.", "..##.", ".....", "..##.", "..##.")}

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
def _mirror(pts):
    return [(W - 1 - x, y) for (x, y) in pts]


# the arms, left side (the right one is the mirror): segments from the shoulder, then the claw
ARM = {"down": [(9, 20), (8, 21), (8, 22)],
       "up": [(9, 20), (8, 20), (7, 19), (6, 19), (5, 18), (4, 17), (3, 16), (3, 15)],
       "wave2": [(9, 20), (8, 20), (7, 19), (6, 19), (5, 18), (4, 18), (3, 17), (2, 16)],
       "chin": [(9, 20), (8, 20), (7, 19), (7, 18)]}
CLAW_DOWN = [(7, 23), (8, 23), (9, 23), (7, 24), (9, 24)]                 # a «U» upside down
CLAW_UP = {"up": [(2, 14), (3, 14), (4, 14), (2, 13), (4, 13)],
           "wave2": [(1, 15), (2, 15), (3, 15), (1, 14), (3, 14)],
           "chin": [(8, 17), (9, 17), (10, 17), (8, 16)]}


def build(spec: tuple) -> QImage:
    """One frame of Bit, from a hashable description (so equal frames come from the cache).
    spec = (arms, tracks, head_dy, screen, led, laptop, fx, dissolve)"""
    arms, legs, hdy, screen, led, laptop, fx, dissolve = spec
    cells = {}

    def rect(x, y, w, h, col):
        for j in range(y, y + h):
            for i in range(x, x + w):
                cells[(i, j)] = col

    def put(pts, col):
        for p in pts:
            cells[p] = col

    # the tracks: a rubber band round two wheels, the AMG plate in the middle
    ty = 25 if legs == "dangle" else 24
    roll = {"roll1": 1, "roll2": 2, "roll3": 3}.get(legs, 0)
    band = [(x, ty) for x in range(6, 26)] + [(x, ty + 5) for x in range(6, 26)] + \
           [(5, ty + j) for j in range(1, 5)] + [(26, ty + j) for j in range(1, 5)]
    for (x, y) in band:                            # the treads move round when he rolls
        k = (x - roll) if y == ty else (x + roll) if y == ty + 5 else (y + (roll if x > 15 else -roll))
        cells[(x, y)] = TREAD_HI if k % 3 == 0 else TREAD
    rect(6, ty + 1, 20, 4, TRACK_IN)
    for cx in (6, 22):                             # the wheels, the spokes turn
        rect(cx, ty + 1, 4, 4, WHEEL)
        for p in ((cx, ty + 1), (cx + 3, ty + 1), (cx, ty + 4), (cx + 3, ty + 4)):
            cells[p] = TRACK_IN
        spoke = (((cx + 1, ty + 2), (cx + 2, ty + 3)), ((cx + 2, ty + 2), (cx + 1, ty + 3)))[roll % 2]
        put([(cx + 1, ty + 2), (cx + 2, ty + 2), (cx + 1, ty + 3), (cx + 2, ty + 3)], HUB)
        put(spoke, WHEEL_HI)
    rect(11, ty + 1, 10, 4, PLATE)                 # the plate
    rect(11, ty + 1, 10, 1, PLATE_HI)
    rect(13, ty + 2, 6, 1, RED)
    rect(13, ty + 3, 6, 1, RED_DK)
    # the body
    rect(11, 20, 10, 4, BODY)
    rect(11, 20, 10, 1, BODY_HI)
    rect(11, 23, 10, 1, BODY_LO)
    rect(14, 21, 4, 2, BODY_LO)                    # a small chest panel
    cells[(15, 21)] = led if led != RED_DK else BODY_LO
    rect(14, 19, 4, 1, HEAD_LO)                    # neck
    # the head: a round helmet with a visor, a headlight for a face, ear cups
    hy = 3 + hdy
    for r, (a, b) in enumerate(((12, 19), (10, 21), (9, 22), (8, 23), (8, 23), (7, 24))):
        rect(a, hy + r, b - a + 1, 1, HEAD)
    rect(12, hy, 8, 1, HEAD_HI)
    put([(10, hy + 1), (11, hy + 1), (9, hy + 2), (8, hy + 3), (8, hy + 4)], HEAD_HI)
    put([(22, hy + 2), (23, hy + 3), (23, hy + 4), (23, hy + 5)], HEAD_LO)
    put([(11, hy + 2), (10, hy + 3)], GLOSS)       # the shine on the chrome
    rect(14, hy + 1, 4, 2, HEAD_HI)                # the badge on top, its light
    put([(15, hy + 1), (16, hy + 1), (15, hy + 2), (16, hy + 2)], RIM)
    cells[(15, hy + 1)] = led
    cells[(16, hy + 2)] = led if led != RED_DK else RIM
    rect(7, hy + 6, 18, 1, HEAD_LO)                # the visor's lip
    rect(8, hy + 6, 16, 1, HEAD_HI)
    rect(8, hy + 7, 16, 9, HEAD)                   # the face frame
    rect(8, hy + 7, 1, 8, HEAD_HI)
    rect(23, hy + 7, 1, 9, HEAD_LO)
    put([(8, hy + 15), (23, hy + 15)], None)
    rect(9, hy + 15, 14, 1, HEAD_LO)
    for ex in (5, 24):                             # the ear cups
        rect(ex, hy + 9, 3, 5, EAR)
        cells.pop((ex if ex == 5 else ex + 2, hy + 9), None)
        cells.pop((ex if ex == 5 else ex + 2, hy + 13), None)
        rect(ex + (1 if ex == 5 else 0), hy + 10, 2, 3, EAR_HI if ex == 5 else HEAD_LO)
    _screen(cells, 9, hy + 7, screen)
    cells = {k: v for k, v in cells.items() if v is not None}
    # the arms (after the head: a raised one passes in front of it)
    if arms in ("type1", "type2"):
        pass
    else:
        la = "wave2" if arms == "wave2" else ("up" if arms == "up" else "down")
        ra = {"wave1": "up", "wave2": "wave2", "up": "up", "chin": "chin"}.get(arms, "down")
        if arms == "wave2":
            la = "down"
        put(ARM[la], LIMB), put(_mirror(ARM[ra]), LIMB)
        put([ARM[la][0], _mirror(ARM[ra])[0]], HEAD_LO)            # the shoulders
        put(CLAW_UP.get(la, CLAW_DOWN), HAND)
        put(_mirror(CLAW_UP.get(ra, CLAW_DOWN)), HAND)
    # the laptop in front (working)
    if laptop:
        rect(10, 18, 12, 6, LID)
        for p in ((10, 18), (21, 18)):
            cells.pop(p, None)
        rect(11, 18, 10, 1, LID_HI)
        put([(15, 20), (16, 20), (15, 21), (16, 21)], EYE if laptop == 2 else EYE_DIM)
        rect(8, 24, 16, 1, BASE)
        rect(8, 25, 16, 1, BASE_LO)
        put([(9, 20), (8, 21), (22, 20), (23, 21)], LIMB)            # the arms reach the keys
        hl, hr = ((9, 23), (22, 22)) if arms == "type1" else ((9, 22), (22, 23))
        put([(8, 22), (23, 22)], LIMB)
        put([hl, hr], HAND)
    # the outline: every empty cell touching the robot
    solid = set(cells)
    for (x, y) in list(solid):
        for n in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if n not in solid and 0 <= n[0] < W and 0 <= n[1] < H:
                cells[n] = K
    # effects (no outline)
    kind = fx[0] if fx else None
    if kind == "bubble":
        k = fx[1]
        cells[(27, 3)] = BUBBLE
        if k >= 1:
            rect(28, 0, 3, 2, BUBBLE)
    elif kind == "z":
        y0 = fx[1]
        for dx, dy in ((0, 0), (1, 0), (2, 0), (3, 0), (4, 0), (3, 1), (2, 2), (1, 3), (0, 4), (1, 4), (2, 4), (3, 4), (4, 4)):
            if 0 <= y0 + dy < H:
                cells[(26 + dx, y0 + dy)] = _c("#c8e4ff", 200)
    elif kind == "bits":
        for (bx, by, col) in fx[1]:
            if (bx, by) not in solid:
                cells[(bx, by)] = col
    img = QImage(W, H, QImage.Format_ARGB32)
    img.fill(0)
    for (x, y), col in cells.items():
        if 0 <= x < W and 0 <= y < H:
            if dissolve < 1.0 and ((x * 73 + y * 151) % 97) / 97.0 >= dissolve:
                continue
            img.setPixel(x, y, col)
    return img


SW, SH = 14, 8                                    # the headlight glass
_GLASS_CUT = {(0, 0), (SW - 1, 0), (0, SH - 1), (SW - 1, SH - 1)}


def _screen(cells, sx, sy, screen):
    """The face: a 14 x 8 headlight glass with ribs, where the eyes (and the work) show."""
    kind = screen[0]
    for j in range(SH):
        for i in range(SW):
            cells[(sx + i, sy + j)] = RIM if (i, j) in _GLASS_CUT else (SCR_LINE if i % 2 else SCR)
    for p in ((11, 1), (12, 1), (12, 2)):
        cells[(sx + p[0], sy + p[1])] = SCR_GLARE

    def px(i, j, col):
        if 0 <= i < SW and 0 <= j < SH and (i, j) not in _GLASS_CUT:
            cells[(sx + i, sy + j)] = col

    if kind == "off":
        return
    if kind == "crt":                              # powering on/off: a line that opens into the picture
        p = screen[1]
        if p < 0.5:
            w = max(1, round(SW * p * 2))
            for i in range(7 - w // 2, 7 + (w + 1) // 2):
                px(i, 4, EYE_HI)
        else:
            h = max(1, round(SH * (p - 0.5) * 2))
            for j in range(4 - h // 2, 4 + (h + 1) // 2):
                for i in range(SW):
                    px(i, j, _c("#bfe9ff") if j == 4 else EYE_DIM)
        return
    if kind == "eyes":
        _, dx, dy, shape, col = screen
        for ex in (2, 8):
            x, y = ex + dx, 1 + dy
            if shape == "open":                    # a big round eye: iris, pupil, a spark of light
                for j in range(5):
                    for i in range(4):
                        if i in (0, 3) and j in (0, 4):
                            continue
                        px(x + i, y + j, col)
                for p in ((1, 2), (2, 2), (1, 3), (2, 3)):
                    px(x + p[0], y + p[1], PUPIL)
                px(x + 1, y + 1, EYE_HI)
            elif shape == "blink":
                for i in range(4):
                    px(x + i, y + 3, col)
            elif shape == "squint":
                for i in range(4):
                    px(x + i, y + 2, col), px(x + i, y + 3, col)
                px(x + 1, y + 3, PUPIL), px(x + 2, y + 3, PUPIL)
            elif shape == "sleep":
                px(ex, 4, EYE_DIM), px(ex + 1, 5, EYE_DIM), px(ex + 2, 5, EYE_DIM), px(ex + 3, 4, EYE_DIM)
            elif shape == "happy":
                px(ex, 4, col), px(ex + 1, 3, col), px(ex + 2, 3, col), px(ex + 3, 4, col)
        if shape == "happy":
            px(5, 6, col), px(6, 7, col), px(7, 7, col), px(8, 6, col)
        return
    if kind == "scan":
        _, dx, line = screen
        for i in range(SW):
            px(i, line, _c("#13324a"))
        for ex in (2, 8):
            for i in range(4):
                px(ex + dx + i, 3, EYE), px(ex + dx + i, 4, EYE)
            px(ex + dx + 1, 4, PUPIL), px(ex + dx + 2, 4, PUPIL)
        return
    if kind == "dots":
        k = screen[1]
        for n, x in enumerate((2, 6, 10)):
            col = EYE if n == k else EYE_DIM
            for i in range(2):
                for j in range(2):
                    px(x + i, 3 + j, col)
        return
    if kind == "code":
        off = screen[1]
        for row in range(SH):
            r = random.Random((off + row) * 7919)
            if r.random() < 0.18:
                continue
            x = r.choice((1, 1, 2, 3, 4))
            for _ in range(r.choice((1, 2, 2, 3))):
                ln = r.randint(1, 4)
                col = r.choice(CODE)
                for i in range(ln):
                    px(x + i, row, col)
                x += ln + 1
                if x >= SW - 2:
                    break
        if screen[2]:                              # the cursor on the last line
            px(min(12, 2 + (off % 10)), 6, EYE_HI)
        return
    if kind == "term":
        n, cursor = screen[1], screen[2]
        for j, i in ((1, 1), (2, 2), (3, 3), (4, 2), (5, 1)):
            px(i + 1, j, GREEN)
        for j in range(min(n, 3)):
            r = random.Random(j * 31 + screen[3])
            for i in range(6, 6 + r.randint(3, 6)):
                px(i, 1 + j, _c("#9aa4b1"))
        if cursor:
            for i in range(6, 9):
                px(i, 5, EYE_HI)
        return
    if kind == "glyph":
        g, col = GLYPHS[screen[1]], screen[2]
        for j, line in enumerate(g):
            for i, ch in enumerate(line):
                if ch == "#":
                    px(5 + i, j, col)


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
        lead = "Olá, sou o Bit." if first else "Bem-vindo de volta."
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
        face = self.mapToGlobal(QPoint(round(self._robot_x + self.AW / 2), round(self._robot_y + self.AH - 18 * self.CELL)))
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
        hop = now - self._hop_at
        # paint only when the picture changes (a paint costs ~2 ms of the window server on the Mac)
        sig = (self._spec(look, now), look == "walk" and self._face, self._alerts and len(self._alerts))
        if sig != self._painted or self._enter or hop < 0.7 or self._press_down or now - self._card_at < 0.3 \
                or now - self._badge_at < 0.5:
            self._painted = sig
            self.update()
        # the next frame: as late as it can be
        if self._enter or hop < 0.7 or now - self._card_at < 0.3 or self._press_down or now - self._badge_at < 0.5:
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
        arms, legs, hdy, laptop, fx = "down", "stand", 0, 0, None
        led = RED_DK
        gx, gy = self._glance
        if self._mouse and look in ("idle", "wait", "done", "alert"):
            gx, gy = self._mouse
        eyes = ("eyes", gx, gy, "blink" if blink else "open", EYE)
        if look == "idle":
            hdy = 1 if (self._busy < 0.85 and (t % 3.2) > 2.2) else 0         # a slow breath, one cell
            led = EYE if (t % 4.0) < 0.25 else RED_DK
            if self._hover and now - self._hover_at < 1.6:
                arms = "wave1" if int(t * 6) % 2 else "wave2"
            screen = eyes
        elif look == "walk":
            legs = ("roll1", "roll2", "roll3", "stand")[int(t * 8) % 4]
            hdy = 1 if int(t * 4) % 2 else 0
            screen = ("eyes", self._face, 0, "blink" if blink else "open", EYE)
        elif look == "sleep":
            hdy = 1
            screen = ("eyes", 0, 0, "sleep", EYE)
            fx = ("z", 6 - int(t * 1.5) % 7)
        elif look == "think":
            arms = "chin"
            screen = ("dots", int(t * 3.5) % 3)
            led = RED if int(t * 2) % 2 else RED_DK
            fx = ("bubble", int(t * 1.5) % 2)
        elif look == "edit":                     # one 32-frame loop, so every frame is built once and kept
            f = int(t * 3) % 32
            arms = "type1" if f % 2 else "type2"
            laptop = 2 if (f // 2) % 2 else 1
            led = RED if f % 2 else RED_DK
            screen = ("code", f // 2, (f // 2) % 2)
        elif look == "run":
            f = int(t * 3) % 40
            arms = "type1" if f % 2 else "type2"
            laptop = 1
            led = GREEN if f % 2 else RED_DK
            screen = ("term", (f // 2) % 5, (f // 2) % 2, f // 10)
        elif look == "read":
            led = EYE if int(t * 2) % 2 else RED_DK
            screen = ("scan", (-1, 0, 1, 0)[int(t * 2.5) % 4], int(t * 6) % 7)
        elif look == "wait":
            arms = "wave1" if int(t * 3) % 2 else "wave2"
            led = AMBER if int(t * 2) % 2 else RED_DK
            screen = ("glyph", "?", AMBER) if int(t / 1.2) % 2 else ("eyes", 0, 1, "open", EYE)
        elif look == "alert":
            arms = "wave1" if int(t * 4) % 2 else "wave2"
            led = RED if int(t * 4) % 2 else RED_DK
            screen = ("glyph", "!", RED) if int(t / 0.9) % 2 else ("eyes", 0, 0, "open", EYE)
        else:                                                                 # done
            arms = "up"
            led = GREEN
            screen = ("eyes", 0, 0, "happy", EYE)
        if self._press and self._moved:                                       # picked up: the tracks hang, arms up
            arms, legs, laptop, hdy = "up", "dangle", 0, 0
            screen = ("eyes", 0, -1, "open", EYE)
        h = now - self._hop_at
        if 0.42 < h < 0.52:                                                   # landing: the head gives a cell
            hdy = 1
        dissolve = 1.0
        if self._enter:
            u = now - self._enter[0]
            if self._enter[1] > 0:
                dissolve = min(1.0, u / 0.35)
                p = (u - 0.35) / 0.35
                screen = ("off",) if p <= 0 else (("crt", min(1.0, p)) if p < 1 else screen)
            else:
                p = 1 - u / 0.25
                screen = ("crt", max(0.0, p)) if p > 0 else ("off",)
                dissolve = 1.0 if u < 0.25 else max(0.0, 1 - (u - 0.25) / 0.33)
            dissolve = round(dissolve * 12) / 12
        return (arms, legs, hdy, screen, led, laptop, fx, dissolve)

    def _image(self, spec) -> QImage:
        img = self._cache.get(spec)
        if img is None:
            if len(self._cache) > 320:
                self._cache.clear()
            img = build(spec)
            self._cache[spec] = img
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
        spec = self._spec(look, now)
        img = self._image(spec)
        if self._face < 0 and look == "walk":
            img = img.mirrored(True, False)
        x0 = 0.0
        y0 = self.AH - H * c - hop
        # the shadow on the floor, smaller in the air
        if spec[7] > 0.3:
            fy = self.AH - 1.2 * c
            k = max(0.4, 1 - hop / (5 * c))
            sh = QRadialGradient(QPointF(self.AW / 2, fy), 11 * c)
            sh.setColorAt(0, QColor(0, 0, 0, round(90 * k * spec[7])))
            sh.setColorAt(1, QColor(0, 0, 0, 0))
            p.setPen(Qt.NoPen)
            p.setBrush(sh)
            p.drawEllipse(QPointF(self.AW / 2, fy), 11 * c * k, 1.4 * c)
        p.setRenderHint(QPainter.SmoothPixmapTransform, False)
        p.setRenderHint(QPainter.Antialiasing, False)
        p.drawImage(QRectF(x0, y0, W * c, H * c), img)
        p.setRenderHint(QPainter.Antialiasing)
        if self._alerts and not self._enter:
            self._paint_badge(p, x0 + 24.5 * c, y0 + 4 * c, now)
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
    """The central's «Bit» line: − five dots + to size him, and a switch to show or hide him. Per computer."""

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
