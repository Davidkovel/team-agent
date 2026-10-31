"""The central's modules one at a time, behind a row of tabs (31 Oct, David, from a reel of a dashboard: «tudo muito clean
e com a funcionalidade que está no vídeo, movimentos suaves e tudo rápido com bons fps»).

TabBar: the names in a dark glass track and a lighter pill under the one chosen. The pill stretches as it goes: the edge in
front leaves first and fast, the one behind follows a moment later (as in the reel's code), so it reads as a thing that moves
and not a highlight that jumps. The names change colour by how much of the pill is under them, not by a switch.
Pages: one module shown, always the height of the tallest, so changing tab never resizes the window (that would cost a new
backdrop per frame). Changing tab paints the two pages as pictures for 0.4 s: the old one blurs, rises a little and goes, the
new one comes up out of the blur. Pictures only: no widget is laid out or painted during the move, so it keeps the screen's rate.
Both run off the widget's one frame clock (motion.py) and stop asking for frames the moment they rest.
"""
import time

from PySide6.QtCore import QEvent, QPoint, QPointF, QRectF, Qt, Signal
from PySide6.QtGui import QColor, QFont, QFontMetricsF, QLinearGradient, QPainter, QPen, QPixmap, QRegion
from PySide6.QtWidgets import QStackedLayout, QVBoxLayout, QWidget

from .motion import clock
from .window import MUTED, TEXT, UI, clear_glass, cut_path, font

LEAD, TRAIL = 0.30, 0.48     # seconds: the pill's edge in front, and the one behind
OUT, IN, IN_AT = 0.20, 0.34, 0.07   # seconds: the old page going, the new one coming, and when it starts coming
BLUR = 7                     # the blur's strength: the page is shrunk this many times and grown back


def out3(t: float) -> float:
    return 1 - (1 - t) ** 3


def inout3(t: float) -> float:
    return 4 * t ** 3 if t < 0.5 else 1 - (-2 * t + 2) ** 3 / 2


def mix(a: QColor, b: QColor, k: float) -> QColor:
    return QColor(round(a.red() + (b.red() - a.red()) * k), round(a.green() + (b.green() - a.green()) * k),
                  round(a.blue() + (b.blue() - a.blue()) * k))


class TabBar(QWidget):
    picked = Signal(int)
    H = 36
    PAD = 3

    def __init__(self, names: list, current=0):
        super().__init__()
        self.names, self.current = names, current
        self.setFixedHeight(self.H)
        self.setMouseTracking(True)
        self.setCursor(Qt.PointingHandCursor)
        self._f = font(8.4, QFont.DemiBold, UI)
        self._hot = -1
        self._l = self._r = None                 # the pill's edges now (None until the first layout)
        self._from = self._to = (0.0, 0.0)
        self._t0, self._moving = 0.0, False
        clock().frame.connect(self._frame)

    def _cells(self) -> list:
        inner = QRectF(self.rect()).adjusted(self.PAD, self.PAD, -self.PAD, -self.PAD)
        w = inner.width() / len(self.names)
        return [QRectF(inner.left() + i * w, inner.top(), w, inner.height()) for i in range(len(self.names))]

    def resizeEvent(self, e):
        super().resizeEvent(e)
        if not self._moving:
            cell = self._cells()[self.current]
            self._l, self._r = cell.left(), cell.right()

    def set_current(self, i: int, animate=True):
        if i == self.current and self._l is not None:
            return
        self.current = i
        cell = self._cells()[i]
        if not animate or self._l is None or not self.isVisible():
            self._l, self._r = cell.left(), cell.right()
            self._moving = False
            clock().need(self, False)
            self.update()
            return
        self._from, self._to = (self._l, self._r), (cell.left(), cell.right())
        self._t0, self._moving = time.perf_counter(), True
        clock().need(self)

    def _frame(self, _):
        if not self._moving:
            return
        t = time.perf_counter() - self._t0
        right = self._to[0] > self._from[0]          # going right: the right edge leads
        lead, trail = min(1.0, t / LEAD), min(1.0, t / TRAIL)
        kl, kr = (inout3(trail), out3(lead)) if right else (out3(lead), inout3(trail))
        self._l = self._from[0] + (self._to[0] - self._from[0]) * kl
        self._r = self._from[1] + (self._to[1] - self._from[1]) * kr
        if t >= TRAIL:
            self._l, self._r = self._to
            self._moving = False
            clock().need(self, False)
        self.update()

    def _at(self, pos) -> int:
        for i, cell in enumerate(self._cells()):
            if cell.contains(QPointF(pos)):
                return i
        return -1

    def mouseMoveEvent(self, e):
        hot = self._at(e.position())
        if hot != self._hot:
            self._hot = hot
            self.update()

    def leaveEvent(self, e):
        self._hot = -1
        self.update()

    def mousePressEvent(self, e):
        i = self._at(e.position())
        if e.button() == Qt.LeftButton and i >= 0 and i != self.current:
            self.set_current(i)
            self.picked.emit(i)

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        r = QRectF(self.rect()).adjusted(0.5, 0.5, -0.5, -0.5)
        track = cut_path(r, r.height() / 2)
        clear_glass(p, track, r)
        p.setPen(Qt.NoPen)
        p.setBrush(QColor(0, 0, 0, 60))
        p.drawPath(track)
        cells = self._cells()
        if self._l is None:
            self._l, self._r = cells[self.current].left(), cells[self.current].right()
        pill = QRectF(self._l, cells[0].top(), self._r - self._l, cells[0].height())
        shape = cut_path(pill, pill.height() / 2)
        fill = QLinearGradient(0, pill.top(), 0, pill.bottom())
        fill.setColorAt(0, QColor(255, 255, 255, 46))
        fill.setColorAt(1, QColor(255, 255, 255, 22))
        p.setBrush(fill)
        rim = QLinearGradient(0, pill.top(), 0, pill.bottom())
        rim.setColorAt(0, QColor(255, 255, 255, 120))
        rim.setColorAt(1, QColor(255, 255, 255, 18))
        p.setPen(QPen(rim, 1))
        p.drawPath(shape)
        p.setFont(self._f)
        fm = QFontMetricsF(self._f)
        lit, dim, hot = QColor(TEXT), QColor(MUTED), QColor("#c9cdd2")
        for i, (name, cell) in enumerate(zip(self.names, cells)):
            cover = max(0.0, min(cell.right(), self._r) - max(cell.left(), self._l)) / cell.width()
            base = hot if i == self._hot else dim
            p.setPen(mix(base, lit, cover))
            p.drawText(cell, Qt.AlignCenter, fm.elidedText(name, Qt.ElideRight, cell.width() - 6))


def _picture(w: QWidget) -> QPixmap:
    """A page as a picture on a transparent ground, at the screen's real pixel density."""
    dpr = w.devicePixelRatioF()
    pix = QPixmap(max(1, round(w.width() * dpr)), max(1, round(w.height() * dpr)))
    pix.setDevicePixelRatio(dpr)
    pix.fill(Qt.transparent)
    p = QPainter(pix)
    w.render(p, QPoint(0, 0), QRegion(), QWidget.DrawChildren)
    p.end()
    return pix


def _blurred(pix: QPixmap) -> QPixmap:
    """A cheap, soft blur: shrunk and grown back twice, smoothly. Made once per change of tab, never per frame."""
    dpr = pix.devicePixelRatio()
    w, h = pix.width(), pix.height()
    small = pix.scaled(max(1, w // BLUR), max(1, h // BLUR), Qt.IgnoreAspectRatio, Qt.SmoothTransformation)
    small = small.scaled(max(1, w // (BLUR // 2)), max(1, h // (BLUR // 2)), Qt.IgnoreAspectRatio, Qt.SmoothTransformation)
    out = small.scaled(w, h, Qt.IgnoreAspectRatio, Qt.SmoothTransformation)
    out.setDevicePixelRatio(dpr)
    return out


class _Veil(QWidget):
    """Over the pages while they change: paints the two pictures and nothing else."""

    def __init__(self, parent):
        super().__init__(parent)
        self.setAttribute(Qt.WA_TransparentForMouseEvents)
        self.old = self.old_soft = self.new = self.new_soft = None
        self.t = 0.0
        self.down = 1                 # +1: the new page is to the right (comes in from the right), -1: to the left

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.SmoothPixmapTransform)
        t = self.t
        if self.old is not None and t < OUT:
            k = out3(t / OUT)
            o = 1 - k
            x = -8 * k * self.down
            p.setOpacity(o * (1 - k))
            p.drawPixmap(QPointF(x, 0), self.old)
            p.setOpacity(o * k)
            p.drawPixmap(QPointF(x, 0), self.old_soft)
        if self.new is not None and t > IN_AT:
            k = out3(min(1.0, (t - IN_AT) / IN))
            x = 14 * (1 - k) * self.down
            p.setOpacity(k * (1 - k))
            p.drawPixmap(QPointF(x, 0), self.new_soft)
            p.setOpacity(k * k)
            p.drawPixmap(QPointF(x, 0), self.new)


class Pages(QWidget):
    changed = Signal(int)

    def __init__(self, pages: list, current=0):
        super().__init__()
        self.pages = []
        self._stack = QStackedLayout(self)
        self._stack.setContentsMargins(0, 0, 0, 0)
        self._blank = QWidget()        # shown under the veil while the pictures move
        self._stack.addWidget(self._blank)
        for page in pages:
            holder = QWidget()             # each page keeps its own height, at the top; the stack is as tall as the tallest
            box = QVBoxLayout(holder)
            box.setContentsMargins(0, 0, 0, 0)
            box.addWidget(page)
            box.addStretch(1)
            self._stack.addWidget(holder)
            self.pages.append(holder)
        self.current = max(0, min(current, len(pages) - 1))
        self._stack.setCurrentWidget(self.pages[self.current])
        self._veil = _Veil(self)
        self._veil.hide()
        self._t0, self._moving = 0.0, False
        clock().frame.connect(self._frame)

    def resizeEvent(self, e):
        super().resizeEvent(e)
        self._veil.setGeometry(self.rect())

    def warm(self):
        """Each page painted once off screen, so the first change of tab does not pay for fonts and pictures (88 ms once)."""
        if self._moving:
            return
        for page in self.pages:
            if page is not self.pages[self.current]:
                page.setGeometry(self.pages[self.current].geometry())
                page.layout().activate()
                _blurred(_picture(page))

    def show_page(self, i: int):
        if i == self.current and not self._moving:
            return
        before = self.pages[self.current]
        old = self._veil.new if self._moving and self._veil.new is not None else _picture(before)
        target = self.pages[i]
        target.setGeometry(before.geometry())
        target.layout().activate()
        new = _picture(target)
        self._veil.down = 1 if i > self.current else -1
        self._veil.old, self._veil.old_soft = old, _blurred(old)
        self._veil.new, self._veil.new_soft = new, _blurred(new)
        self._veil.t = 0.0
        self.current = i
        self._stack.setCurrentWidget(self._blank)
        self._veil.setGeometry(self.rect())
        self._veil.show()
        self._veil.raise_()
        self._t0, self._moving = time.perf_counter(), True
        clock().need(self)
        self.changed.emit(i)

    def _frame(self, _):
        if not self._moving:
            return
        t = time.perf_counter() - self._t0
        self._veil.t = t
        self._veil.update()
        if t >= IN_AT + IN:
            self._moving = False
            clock().need(self, False)
            self._stack.setCurrentWidget(self.pages[self.current])
            self._veil.hide()
            self._veil.old = self._veil.old_soft = self._veil.new = self._veil.new_soft = None
