"""The cards that tell this person something happened, drawn by the widget (not the Windows balloon).

    notices = Notices(open_page)            # open_page("#/tarefas/3") is called when a card is clicked
    notices.push([{"title": "...", "body": "...", "href": "#/tarefas/3", "directed": True}])
    presence = Presence()
    presence.show("Marco")                  # the corner card: somebody came online

A task card drops from the top of the screen, one after another, and leaves on its own. A task sent to this person
(`directed`) is amber and rings, with the Windows notification sound; one sent to somebody else is white and silent.
Every card is a lit plate with a shadow, a coloured edge and a line that runs out while it is on the screen.
"""
from collections import deque

from PySide6.QtCore import QEasingCurve, QObject, QRectF, QTimer, Qt, QVariantAnimation, Signal
from PySide6.QtGui import QColor, QFont, QFontMetricsF, QGuiApplication, QLinearGradient, QPainter, QPainterPath, QPen
from PySide6.QtWidgets import QWidget

from . import badge

TEXT, MUTED = QColor("#f2f3f5"), QColor("#a3a7ae")
AMBER, WHITE, ONLINE = QColor("#e3bd6b"), QColor("#f2f3f5"), QColor("#7fd492")
UI = ("Segoe UI Variable Text", "Segoe UI")
WIDTH, PAD, RADIUS = 460, 18, 16
ICON = 36                                  # the star at the left of a card
MARGIN = 18                                # room around the plate for its shadow
TOP = 18                                   # gap between the card and the top of the screen
SLIDE_IN, HOLD, SLIDE_OUT, GAP = 460, 8000, 300, 250   # ms
MAX_BATCH = 3                              # more than this at once (a computer that was off, catching up) become a single card
P_WIDTH, P_HEIGHT, P_EDGE, P_GAP, P_HOLD = 340, 84, 18, 10, 6000


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


def _tint(colour: QColor, alpha: float) -> QColor:
    c = QColor(colour)
    c.setAlphaF(alpha)
    return c


class Card(QWidget):
    """What every card shares: it never takes the keyboard, slides in, stays `hold` ms, slides out."""
    clicked = Signal()
    finished = Signal()    # it has slid out

    def __init__(self, width: int, height: int, accent: QColor, hold: int):
        super().__init__(None, Qt.Tool | Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint)
        self.setAttribute(Qt.WA_TranslucentBackground)
        self.setAttribute(Qt.WA_ShowWithoutActivating)   # it must never take the keyboard from what somebody is typing
        self.setCursor(Qt.PointingHandCursor)
        self._w, self._h, self._accent, self._hold, self._leaving = width, height, accent, hold, False
        self.setFixedSize(width + 2 * MARGIN, height + 2 * MARGIN)
        self._left = 1.0   # how much of its time on the screen is left
        self._slide = QVariantAnimation(self)
        self._slide.valueChanged.connect(self._at)
        self._life = QVariantAnimation(self)
        self._life.setStartValue(1.0)
        self._life.setEndValue(0.0)
        self._life.setDuration(hold)
        self._life.valueChanged.connect(self._aged)

    def _aged(self, v):
        self._left = v
        self.update()

    def _at(self, k):
        raise NotImplementedError

    def _go(self, start, end, ms, curve):
        self._slide.stop()
        self._slide.setStartValue(start)
        self._slide.setEndValue(end)
        self._slide.setDuration(ms)
        self._slide.setEasingCurve(curve)
        self._slide.start()

    def _enter(self):
        self.setWindowOpacity(0)
        self._at(0.0)
        self.show()
        self._go(0.0, 1.0, SLIDE_IN, QEasingCurve.OutBack)   # it lands with a small bounce, so the eye catches it
        self._life.start()
        QTimer.singleShot(self._hold, self.leave)

    def leave(self):
        if self._leaving:
            return
        self._leaving = True
        self._go(min(1.0, self._slide.currentValue() or 1.0), 0.0, SLIDE_OUT, QEasingCurve.InCubic)
        self._slide.finished.connect(self.finished.emit)

    def mousePressEvent(self, e):
        self.clicked.emit()
        self.leave()

    def _plate(self, p: QPainter) -> QRectF:
        """The shadow, the lit plate with its coloured edge and the line of time left. Leaves the painter at the plate's corner."""
        p.setRenderHint(QPainter.Antialiasing)
        p.translate(MARGIN, MARGIN)
        rect = QRectF(0, 0, self._w, self._h)
        p.setPen(Qt.NoPen)
        for i in range(16, 0, -2):   # a soft shadow, so the card stands off whatever is behind it
            p.setBrush(QColor(0, 0, 0, 9))
            p.drawRoundedRect(rect.adjusted(-i, -i + 2, i, i + 2), RADIUS + i, RADIUS + i)
        path = QPainterPath()
        path.addRoundedRect(rect.adjusted(.5, .5, -.5, -.5), RADIUS, RADIUS)
        body = QLinearGradient(rect.topLeft(), rect.bottomLeft())
        body.setColorAt(0, QColor(38, 38, 43))
        body.setColorAt(1, QColor(18, 18, 21))
        p.fillPath(path, body)
        p.save()
        p.setClipPath(path)
        p.fillRect(QRectF(0, 0, 4, self._h), self._accent)                                      # the coloured edge
        p.fillRect(QRectF(0, self._h - 3, self._w, 3), QColor(255, 255, 255, 14))
        p.fillRect(QRectF(0, self._h - 3, self._w * self._left, 3), _tint(self._accent, 0.85))  # time left
        p.restore()
        p.setPen(QPen(_tint(self._accent, 0.5), 1.2))
        p.setBrush(Qt.NoBrush)
        p.drawPath(path)
        return rect

    def _star(self, p: QPainter, av: QRectF):
        p.setPen(QPen(self._accent, 1.4))
        p.setBrush(QColor(0, 0, 0))
        p.drawEllipse(av)
        inset = av.width() * 0.13
        badge.star(p, av.adjusted(inset, inset, -inset, -inset))


class NoticeCard(Card):
    """A task was sent: the card at the top of the screen."""

    def __init__(self, item: dict, hold: int = HOLD):
        directed = bool(item.get("directed"))
        self._caption = "NOVA TAREFA PARA TI" if directed else "NOVA TAREFA"
        self._title, self._body = item.get("title", ""), (item.get("body") or "").strip()
        self._f_caption, self._f_title, self._f_body = _font(7.5, QFont.Bold, 1.4), _font(11.5, QFont.DemiBold), _font(9.5)
        self._text_x = PAD + ICON + 14
        self._inner = WIDTH - self._text_x - PAD
        self._title_h = self._measure(self._f_title, self._title, self._inner, 3)
        self._body_h = self._measure(self._f_body, self._body, self._inner, 2) if self._body else 0
        self._caption_h = QFontMetricsF(self._f_caption).height()
        height = PAD + self._caption_h + 7 + self._title_h + (6 + self._body_h if self._body else 0) + PAD + 3
        super().__init__(WIDTH, round(max(height, PAD + ICON + PAD + 3)), AMBER if directed else WHITE, hold)
        self._x = self._rest = self._off = 0

    @staticmethod
    def _measure(font: QFont, text: str, width: float, lines: int) -> float:
        fm = QFontMetricsF(font)
        return min(fm.boundingRect(QRectF(0, 0, width, 10000), Qt.TextWordWrap, text).height(), fm.lineSpacing() * lines)

    def _at(self, k):
        self.move(self._x, round(self._off + (self._rest - self._off) * k))
        self.setWindowOpacity(max(0.0, min(1.0, k * 1.6)))

    def run(self):
        """Drops from above the screen, stays a few seconds, slides back up."""
        area = QGuiApplication.primaryScreen().availableGeometry()
        self._x, self._rest, self._off = area.center().x() - self.width() // 2, area.top() + TOP - MARGIN, area.top() - self.height()
        self._enter()

    def paintEvent(self, _):
        p = QPainter(self)
        self._plate(p)
        self._star(p, QRectF(PAD, PAD, ICON, ICON))
        x, y = self._text_x, float(PAD)
        p.setFont(self._f_caption)
        p.setPen(self._accent)
        p.drawText(QRectF(x, y, self._inner, self._caption_h), Qt.AlignLeft | Qt.AlignVCenter, self._caption)
        y += self._caption_h + 7
        p.setFont(self._f_title)
        p.setPen(TEXT)
        p.drawText(QRectF(x, y, self._inner, self._title_h), Qt.AlignLeft | Qt.AlignTop | Qt.TextWordWrap, self._title)
        if self._body:
            y += self._title_h + 6
            p.setFont(self._f_body)
            p.setPen(MUTED)
            p.drawText(QRectF(x, y, self._inner, self._body_h), Qt.AlignLeft | Qt.AlignTop | Qt.TextWordWrap, self._body)


class Notices(QObject):
    """The queue of cards: one on the screen at a time."""

    def __init__(self, open_page, hold: int = HOLD, parent=None):
        super().__init__(parent)
        self._open_page, self._hold = open_page, hold
        self._queue, self._card = deque(), None

    def push(self, items):
        items = list(items)
        if len(items) > MAX_BATCH:
            items = [{"title": f"{len(items)} tarefas novas", "body": "Foram enviadas enquanto estiveste fora.", "href": "#/tarefas",
                      "directed": any(i.get("directed") for i in items)}]
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


class PresenceCard(Card):
    """Somebody came online: a card in the bottom right corner of the screen, the way Steam says it."""

    def __init__(self, name: str, text: str, slot: int):
        super().__init__(P_WIDTH, P_HEIGHT, ONLINE, P_HOLD)
        self._name, self._text = name, text
        self._f_name, self._f_text = _font(12, QFont.DemiBold), _font(9.5, QFont.DemiBold)
        area = QGuiApplication.primaryScreen().availableGeometry()
        self._rest, self._off = area.right() - P_EDGE - P_WIDTH - MARGIN, area.right() + 1
        self._y = area.bottom() - P_EDGE - P_HEIGHT - MARGIN - slot * (P_HEIGHT + P_GAP)

    def _at(self, k):
        self.move(round(self._off + (self._rest - self._off) * k), self._y)
        self.setWindowOpacity(max(0.0, min(1.0, k * 1.6)))

    def run(self):
        self._enter()

    def paintEvent(self, _):
        p = QPainter(self)
        self._plate(p)
        av = QRectF(20, (P_HEIGHT - 3) / 2 - 24, 48, 48)
        self._star(p, av)
        dot = av.bottomRight() - QRectF(0, 0, 6, 6).bottomRight()
        p.setPen(QPen(QColor(24, 24, 27), 2.5))
        p.setBrush(ONLINE)
        p.drawEllipse(dot, 5.5, 5.5)
        x, w = 84, P_WIDTH - 84 - PAD
        p.setFont(self._f_name)
        p.setPen(TEXT)
        p.drawText(QRectF(x, 18, w, 24), Qt.AlignLeft | Qt.AlignVCenter, QFontMetricsF(self._f_name).elidedText(self._name, Qt.ElideRight, w))
        p.setFont(self._f_text)
        p.setPen(ONLINE)
        p.drawText(QRectF(x, 43, w, 18), Qt.AlignLeft | Qt.AlignVCenter, self._text)


class Presence(QObject):
    """The presence cards on the screen: each new one sits above the ones still showing."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self._cards = {}   # slot -> card

    def show(self, name: str, text: str = "está online agora"):
        slot = next(i for i in range(len(self._cards) + 1) if i not in self._cards)
        card = self._cards[slot] = PresenceCard(name, text, slot)
        card.finished.connect(lambda: (self._cards.pop(slot, None), card.close(), card.deleteLater()))
        card.run()
