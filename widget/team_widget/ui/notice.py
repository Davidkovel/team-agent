"""The card that says a task was sent: black and clean, at the top of the screen (not the Windows balloon).

    notices = Notices(open_page)            # open_page("#/tarefas/3") is called when a card is clicked
    notices.push([{"title": "...", "body": "...", "href": "#/tarefas/3", "directed": True}])

Cards come one after another and leave on their own. A task sent to this person (`directed`) also rings, with the Windows
notification sound; one sent to somebody else only shows the card.
"""
from collections import deque

from PySide6.QtCore import QEasingCurve, QObject, QRectF, QTimer, Qt, QVariantAnimation, Signal
from PySide6.QtGui import QColor, QFont, QFontMetricsF, QGuiApplication, QPainter, QPainterPath, QPen
from PySide6.QtWidgets import QWidget

BG = QColor(7, 7, 8)
TEXT, MUTED = QColor("#f2f3f5"), QColor("#8d9198")
UI = ("Segoe UI Variable Text", "Segoe UI")
WIDTH, PAD, RADIUS = 420, 18, 16
TOP = 18                                   # gap between the card and the top of the screen
SLIDE_IN, HOLD, SLIDE_OUT, GAP = 380, 6000, 300, 250   # ms


def ring():
    """The notification sound of Windows. Nothing anywhere else."""
    try:
        import winsound
        winsound.PlaySound("SystemNotification", winsound.SND_ALIAS | winsound.SND_ASYNC)
    except Exception:
        pass


def _font(size: float, weight=QFont.Normal, spacing=0.0) -> QFont:
    f = QFont()
    f.setFamilies(list(UI))
    f.setPointSizeF(size)
    f.setWeight(weight)
    f.setStyleStrategy(QFont.PreferAntialias)
    if spacing:
        f.setLetterSpacing(QFont.AbsoluteSpacing, spacing)
    return f


class NoticeCard(QWidget):
    clicked = Signal()
    finished = Signal()    # it has slid out

    def __init__(self, item: dict, hold: int = HOLD):
        super().__init__(None, Qt.Tool | Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint)
        self.setAttribute(Qt.WA_TranslucentBackground)
        self.setAttribute(Qt.WA_ShowWithoutActivating)   # it must never take the keyboard from what somebody is typing
        self.setCursor(Qt.PointingHandCursor)
        self._hold, self._leaving = hold, False
        self._caption, self._title, self._body = "NOVA TAREFA", item.get("title", ""), (item.get("body") or "").strip()
        self._f_caption, self._f_title, self._f_body = _font(7.5, QFont.DemiBold, 1.4), _font(10.5, QFont.DemiBold), _font(9)
        inner = WIDTH - 2 * PAD
        self._title_h = self._measure(self._f_title, self._title, inner, 3)
        self._body_h = self._measure(self._f_body, self._body, inner, 2) if self._body else 0
        self._caption_h = QFontMetricsF(self._f_caption).height()
        height = PAD + self._caption_h + 7 + self._title_h + (6 + self._body_h if self._body else 0) + PAD
        self.setFixedSize(WIDTH, round(height))
        self._x = self._rest = self._off = 0
        self._slide = QVariantAnimation(self)
        self._slide.valueChanged.connect(self._at)

    @staticmethod
    def _measure(font: QFont, text: str, width: float, lines: int) -> float:
        fm = QFontMetricsF(font)
        return min(fm.boundingRect(QRectF(0, 0, width, 10000), Qt.TextWordWrap, text).height(), fm.lineSpacing() * lines)

    def _at(self, k):
        self.move(self._x, round(self._off + (self._rest - self._off) * k))
        self.setWindowOpacity(min(1.0, k * 1.6))

    def run(self):
        """Slides down from above the screen, stays a few seconds, slides back up."""
        area = QGuiApplication.primaryScreen().availableGeometry()
        self._x, self._rest, self._off = area.center().x() - WIDTH // 2, area.top() + TOP, area.top() - self.height()
        self.setWindowOpacity(0)
        self.move(self._x, self._off)
        self.show()
        self._go(0.0, 1.0, SLIDE_IN, QEasingCurve.OutCubic)
        QTimer.singleShot(self._hold, self.leave)

    def _go(self, start, end, ms, curve):
        self._slide.stop()
        self._slide.setStartValue(start)
        self._slide.setEndValue(end)
        self._slide.setDuration(ms)
        self._slide.setEasingCurve(curve)
        self._slide.start()

    def leave(self):
        if self._leaving:
            return
        self._leaving = True
        self._go(self._slide.currentValue() or 1.0, 0.0, SLIDE_OUT, QEasingCurve.InCubic)
        self._slide.finished.connect(self.finished.emit)

    def mousePressEvent(self, e):
        self.clicked.emit()
        self.leave()

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        path = QPainterPath()
        path.addRoundedRect(QRectF(self.rect()).adjusted(.5, .5, -.5, -.5), RADIUS, RADIUS)
        p.fillPath(path, BG)
        p.setPen(QPen(QColor(255, 255, 255, 34), 1))
        p.drawPath(path)
        inner, y = WIDTH - 2 * PAD, float(PAD)
        p.setFont(self._f_caption)
        p.setPen(MUTED)
        p.drawText(QRectF(PAD, y, inner, self._caption_h), Qt.AlignLeft | Qt.AlignVCenter, self._caption)
        y += self._caption_h + 7
        p.setFont(self._f_title)
        p.setPen(TEXT)
        p.drawText(QRectF(PAD, y, inner, self._title_h), Qt.AlignLeft | Qt.AlignTop | Qt.TextWordWrap, self._title)
        if self._body:
            y += self._title_h + 6
            p.setFont(self._f_body)
            p.setPen(MUTED)
            p.drawText(QRectF(PAD, y, inner, self._body_h), Qt.AlignLeft | Qt.AlignTop | Qt.TextWordWrap, self._body)


class Notices(QObject):
    """The queue of cards: one on the screen at a time."""

    def __init__(self, open_page, hold: int = HOLD, parent=None):
        super().__init__(parent)
        self._open_page, self._hold = open_page, hold
        self._queue, self._card = deque(), None

    def push(self, items):
        self._queue.extend(items)
        if self._card is None:
            self._next()

    def _next(self):
        if not self._queue:
            self._card = None
            return
        item = self._queue.popleft()
        if item.get("directed"):
            ring()
        card = self._card = NoticeCard(item, self._hold)
        if item.get("href"):
            card.clicked.connect(lambda href=item["href"]: self._open_page(href))
        card.finished.connect(lambda: (card.close(), card.deleteLater(), QTimer.singleShot(GAP, self._next)))
        card.run()
