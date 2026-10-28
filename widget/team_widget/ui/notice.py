"""The cards that tell this person something happened, drawn by the widget (not the Windows balloon).

    notices = Notices(open_page)            # open_page("#/tarefas/3") is called when a card is clicked
    notices.push([{"title": "...", "body": "...", "href": "#/tarefas/3", "directed": True}])
    presence = Presence()
    presence.show("Marco")                  # the corner card: somebody came online (online=False: went offline)

Three kinds, each with its own look, all on the screen under the mouse: a task is a macOS banner in the top right corner; somebody coming online is the green corner
card that rings and beats; somebody going offline is the same corner card, clean: grey, no sound, no ring, no light, and
gone sooner. Leaving is worth knowing, not worth looking up for.

A banner slides in from the right, up to three at once one under the other, waits while the mouse is on it and leaves on
its own. A task sent to this person (`directed`) has an amber caption and rings, with the Windows notification sound; one sent
to somebody else is grey and silent. The presence cards are a lit plate with a shadow, a coloured edge and a line that runs out.
"""
from collections import deque

from PySide6.QtCore import QEasingCurve, QObject, QRectF, QTimer, Qt, QVariantAnimation, Signal
from PySide6.QtGui import QColor, QCursor, QFont, QFontMetricsF, QGuiApplication, QLinearGradient, QPainter, QPainterPath, QPen
from PySide6.QtWidgets import QWidget

from . import badge


def cut_path(rect, r=0.0, _ry=None) -> QPainterPath:
    """The shape of every plate and button: rounded like an iPhone button (David, 28 Oct: «mantém ângulos redondos»)."""
    rect = QRectF(rect)
    path = QPainterPath()
    path.addRoundedRect(rect, float(r), float(r if _ry is None else _ry))
    return path


def cut(p, rect, r=0.0, _ry=None):
    p.drawPath(cut_path(rect, r))

TEXT, MUTED = QColor("#f2f3f5"), QColor("#a3a7ae")
AMBER, WHITE, ONLINE, OFFLINE = QColor("#e3bd6b"), QColor("#f2f3f5"), QColor("#4ee07a"), QColor("#8a8f98")
QUIET = QColor("#9fb4d6")                   # a teammate working or sending a change: pale, so it does not shout
Q_HOLD, Q_OPACITY = 4500, 0.88             # the quiet card: shorter on the screen and a little see-through
UI = ("Segoe UI Variable Text", "Segoe UI")
WIDTH, PAD, RADIUS = 460, 18, 16
ICON = 36                                  # the star at the left of a card
MARGIN = 18                                # room around the plate for its shadow
TOP = 18                                   # gap between the card and the top of the screen
SLIDE_IN, HOLD, SLIDE_OUT, GAP = 460, 8000, 300, 250   # ms
MAX_BATCH = 3                              # more than this at once (a computer that was off, catching up) become a single card
MAX_SHOWN = 3                              # banners on the screen at the same time
M_PAD, M_RADIUS, M_EDGE, M_GAP = 13, 18, 14, 10   # the macOS banner: padding, corners, gap to the screen edge and between banners
P_WIDTH, P_HEIGHT, P_EDGE, P_GAP, P_HOLD = 300, 72, 22, 10, 6000
BEAT, BEATS = 1100, 3                       # ms of one ring beating out of a presence card, and how many


def here():
    """The screen being looked at: the one under the mouse, so the cards come up where the person is, not on the other monitor."""
    screen = QGuiApplication.screenAt(QCursor.pos()) or QGuiApplication.primaryScreen()
    return screen.availableGeometry()


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
            cut(p, rect.adjusted(-i, -i + 2, i, i + 2), RADIUS + i, RADIUS + i)
        path = QPainterPath()
        path.addPath(cut_path(rect.adjusted(.5, .5, -.5, -.5), RADIUS, RADIUS))
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
    """Something for this person (a task, a message): a macOS banner in the top right corner of the screen they are looking at.
    The app's star, a line that says what it is and when, the title in bold and the body under it. No coloured edge, no line
    of time running out: a task sent to them shows only in the caption's amber and in the sound."""

    def __init__(self, item: dict, hold: int = HOLD):
        directed = bool(item.get("directed"))
        # the Hub says what the card is when it is not a task: "MENSAGEM PARA TI" (Mensagens, routers/messages.py)
        self._caption = (item.get("caption") or ("Nova tarefa para ti" if directed else "Nova tarefa")).capitalize()
        self._title, self._body = item.get("title", ""), (item.get("body") or "").strip()
        self._f_caption, self._f_title, self._f_body = _font(8.5, QFont.DemiBold), _font(10.5, QFont.DemiBold), _font(9.5)
        self._text_x = PAD + ICON + 12
        self._inner = WIDTH - self._text_x - PAD
        self._title_h = self._measure(self._f_title, self._title, self._inner, 2)
        self._body_h = self._measure(self._f_body, self._body, self._inner, 2) if self._body else 0
        self._caption_h = QFontMetricsF(self._f_caption).height()
        height = M_PAD + self._caption_h + 4 + self._title_h + (3 + self._body_h if self._body else 0) + M_PAD
        super().__init__(WIDTH, round(max(height, M_PAD + ICON + M_PAD)), AMBER if directed else MUTED, hold)
        self._y = self._rest = self._off = 0
        self._held = False

    @staticmethod
    def _measure(font: QFont, text: str, width: float, lines: int) -> float:
        fm = QFontMetricsF(font)
        return min(fm.boundingRect(QRectF(0, 0, width, 10000), Qt.TextWordWrap, text).height(), fm.lineSpacing() * lines)

    def _at(self, k):
        self.move(round(self._off + (self._rest - self._off) * k), self._y)
        self.setWindowOpacity(max(0.0, min(1.0, k * 1.6)))

    def run(self, y: int):
        """Slides in from the right edge of the screen under the mouse, stays a few seconds, slides back out."""
        area = here()
        self._rest, self._off, self._y = area.right() - M_EDGE - WIDTH - MARGIN, area.right() + 1, y
        self._enter()

    def _enter(self):
        self.setWindowOpacity(0)
        self._at(0.0)
        self.show()
        self._go(0.0, 1.0, SLIDE_IN, QEasingCurve.OutCubic)   # macOS slides in smoothly, no bounce
        self._life.finished.connect(self.leave)
        self._life.start()

    def enterEvent(self, _):   # the mouse on it: it waits, the way macOS keeps a banner that is being read
        self._held = True
        self._life.pause()

    def leaveEvent(self, _):
        self._held = False
        self._life.resume()

    def _plate(self, p: QPainter) -> QRectF:
        p.setRenderHint(QPainter.Antialiasing)
        p.translate(MARGIN, MARGIN)
        rect = QRectF(0, 0, self._w, self._h)
        p.setPen(Qt.NoPen)
        for i in range(16, 0, -2):
            p.setBrush(QColor(0, 0, 0, 10))
            cut(p, rect.adjusted(-i, -i + 3, i, i + 3), M_RADIUS + i, M_RADIUS + i)
        path = QPainterPath()
        path.addPath(cut_path(rect.adjusted(.5, .5, -.5, -.5), M_RADIUS, M_RADIUS))
        body = QLinearGradient(rect.topLeft(), rect.bottomLeft())
        body.setColorAt(0, QColor(44, 44, 48))
        body.setColorAt(1, QColor(30, 30, 33))
        p.fillPath(path, body)
        p.setPen(QPen(QColor(255, 255, 255, 30), 1))
        p.setBrush(Qt.NoBrush)
        p.drawPath(path)
        return rect

    def paintEvent(self, _):
        p = QPainter(self)
        self._plate(p)
        av = QRectF(PAD, M_PAD, ICON, ICON)
        p.setPen(Qt.NoPen)
        p.setBrush(QColor(0, 0, 0))
        cut(p, av, 9, 9)   # the app icon: a rounded square, like every icon on a Mac
        inset = av.width() * 0.16
        badge.star(p, av.adjusted(inset, inset, -inset, -inset))
        x, y = self._text_x, float(M_PAD)
        fm = QFontMetricsF(self._f_caption)
        when = "agora"
        room = self._inner - fm.horizontalAdvance(when) - 10
        p.setFont(self._f_caption)
        p.setPen(MUTED)
        p.drawText(QRectF(x, y, self._inner, self._caption_h), Qt.AlignRight | Qt.AlignVCenter, when)
        p.setPen(self._accent)
        p.drawText(QRectF(x, y, room, self._caption_h), Qt.AlignLeft | Qt.AlignVCenter, fm.elidedText(self._caption, Qt.ElideRight, room))
        y += self._caption_h + 4
        p.setFont(self._f_title)
        p.setPen(TEXT)
        p.drawText(QRectF(x, y, self._inner, self._title_h), Qt.AlignLeft | Qt.AlignTop | Qt.TextWordWrap, self._title)
        if self._body:
            y += self._title_h + 3
            p.setFont(self._f_body)
            p.setPen(MUTED)
            p.drawText(QRectF(x, y, self._inner, self._body_h), Qt.AlignLeft | Qt.AlignTop | Qt.TextWordWrap, self._body)


class Notices(QObject):
    """The banners on the screen: up to MAX_SHOWN at once, stacked down from the top right, so a burst arrives on time instead
    of waiting in a line of 8-second cards. Whatever does not fit waits until the stack is empty."""

    def __init__(self, open_page, hold: int = HOLD, parent=None):
        super().__init__(parent)
        self._open_page, self._hold = open_page, hold
        self._queue, self._cards = deque(), []

    def push(self, items):
        items = list(items)
        if len(items) > MAX_BATCH:
            talk = all(i.get("caption") for i in items)   # all of them messages (Mensagens), not tasks
            items = [{"title": f"{len(items)} {'mensagens novas' if talk else 'tarefas novas'}", "body": "Foram enviadas enquanto estiveste fora.",
                      "href": "#/mensagens" if talk else "#/tarefas", "caption": items[0].get("caption") if talk else None,
                      "directed": any(i.get("directed") for i in items)}]
        if any(i.get("directed") for i in items):
            ring()   # once for the burst, not once a card
        self._queue.extend(items)
        if not self._cards:
            self._next()

    def _next(self):
        y = here().top() + TOP - MARGIN
        while self._queue and len(self._cards) < MAX_SHOWN:
            item = self._queue.popleft()
            card = NoticeCard(item, self._hold + (2000 if item.get("directed") else 0))
            self._cards.append(card)
            if item.get("href"):
                card.clicked.connect(lambda href=item["href"]: self._open_page(href))
            card.finished.connect(lambda card=card: self._gone(card))
            card.run(y)
            y += card.height() - 2 * MARGIN + M_GAP

    def _gone(self, card):
        if card in self._cards:
            self._cards.remove(card)
        card.close()
        card.deleteLater()
        if not self._cards:
            QTimer.singleShot(GAP, self._next)   # the next ones come once the stack is empty, so nothing jumps under the mouse


class PresenceCard(Card):
    """Somebody came online (green) or went offline (grey): a small card in the bottom right corner, the way Steam says it."""

    def __init__(self, name: str, text: str, slot: int, colour: QColor = ONLINE, quiet: bool = False, clean: bool = False):
        super().__init__(P_WIDTH, P_HEIGHT, colour, Q_HOLD if quiet or clean else P_HOLD)
        self._name, self._text, self._colour, self._quiet, self._clean = name, text, colour, quiet, clean
        self._f_name, self._f_text = _font(11, QFont.DemiBold), _font(9, QFont.DemiBold)
        self._beat = 1.0   # how far the ring has gone out; 1 = no ring
        self._pulse = QVariantAnimation(self)
        self._pulse.setStartValue(0.0)
        self._pulse.setEndValue(1.0)
        self._pulse.setDuration(BEAT)
        self._pulse.setLoopCount(BEATS)
        self._pulse.setEasingCurve(QEasingCurve.OutCubic)
        self._pulse.valueChanged.connect(self._beaten)
        area = here()
        self._rest, self._off = area.right() - P_EDGE - P_WIDTH - MARGIN, area.right() + 1
        self._y = area.bottom() - P_EDGE - P_HEIGHT - MARGIN - slot * (P_HEIGHT + P_GAP)

    def _at(self, k):
        self.move(round(self._off + (self._rest - self._off) * k), self._y)
        self.setWindowOpacity(max(0.0, min(Q_OPACITY if self._quiet else 1.0, k * 1.6)))

    def _beaten(self, v):
        self._beat = v
        self.update()

    def run(self):
        self._enter()
        if not (self._quiet or self._clean):
            QTimer.singleShot(SLIDE_IN - 120, self._pulse.start)   # the ring starts as the card lands

    def paintEvent(self, _):
        p = QPainter(self)
        rect = self._plate(p)
        if self._clean:   # went offline: the plate, the name and a grey line, nothing that moves or glows
            return self._paint_clean(p, rect)
        wash = QLinearGradient(rect.topLeft(), rect.topRight())   # green light from the left, so it does not read as one more dark window
        wash.setColorAt(0, _tint(self._colour, 0.1 if self._quiet else 0.28))
        wash.setColorAt(0.75, _tint(self._colour, 0.0))
        p.setPen(Qt.NoPen)
        p.setBrush(wash)
        cut(p, rect.adjusted(.5, .5, -.5, -.5), RADIUS, RADIUS)
        if self._beat < 1.0:   # the ring that beats out of the card: movement is what the eye catches in a corner
            grow = 2 + 9 * self._beat
            p.setPen(QPen(_tint(self._colour, 0.8 * (1 - self._beat)), 2))
            p.setBrush(Qt.NoBrush)
            cut(p, rect.adjusted(-grow, -grow, grow, grow), RADIUS + grow, RADIUS + grow)
        av = QRectF(16, (P_HEIGHT - 3) / 2 - 18, 36, 36)
        self._star(p, av)
        dot = av.bottomRight() - QRectF(0, 0, 5, 5).bottomRight()
        p.setPen(QPen(QColor(24, 24, 27), 2.5))
        p.setBrush(self._colour)
        p.drawEllipse(dot, 5, 5)
        x = av.right() + 14
        w = P_WIDTH - x - PAD
        p.setFont(self._f_name)
        p.setPen(TEXT)
        p.drawText(QRectF(x, P_HEIGHT / 2 - 21, w, 20), Qt.AlignLeft | Qt.AlignVCenter, QFontMetricsF(self._f_name).elidedText(self._name, Qt.ElideRight, w))
        p.setFont(self._f_text)
        p.setPen(self._colour)
        p.drawText(QRectF(x, P_HEIGHT / 2 - 1, w, 18), Qt.AlignLeft | Qt.AlignVCenter, QFontMetricsF(self._f_text).elidedText(self._text, Qt.ElideRight, w))

    def _paint_clean(self, p: QPainter, rect: QRectF):
        av = QRectF(16, (P_HEIGHT - 3) / 2 - 18, 36, 36)
        p.setOpacity(0.45)   # the badge greyed out, the way an avatar fades when somebody leaves
        self._star(p, av)
        p.setOpacity(1.0)
        dot = av.bottomRight() - QRectF(0, 0, 5, 5).bottomRight()
        p.setPen(QPen(self._colour, 2))   # a hollow dot: nobody there
        p.setBrush(QColor(24, 24, 27))
        p.drawEllipse(dot, 4.5, 4.5)
        x = av.right() + 14
        w = P_WIDTH - x - PAD
        p.setFont(self._f_name)
        p.setPen(MUTED)
        p.drawText(QRectF(x, P_HEIGHT / 2 - 21, w, 20), Qt.AlignLeft | Qt.AlignVCenter, QFontMetricsF(self._f_name).elidedText(self._name, Qt.ElideRight, w))
        p.setFont(_font(9))
        p.setPen(self._colour)
        p.drawText(QRectF(x, P_HEIGHT / 2 - 1, w, 18), Qt.AlignLeft | Qt.AlignVCenter, QFontMetricsF(self._f_text).elidedText(self._text, Qt.ElideRight, w))


class Presence(QObject):
    """The presence cards on the screen: each new one sits above the ones still showing."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self._cards = {}   # slot -> card

    def show(self, name: str, online: bool = True):
        text = "está online agora" if online else "ficou offline"
        if online and not any(c._colour == ONLINE and not c._quiet for c in self._cards.values()):
            ring()   # once for a group of people arriving together, not once each; leaving makes no sound
        slot = next(i for i in range(len(self._cards) + 1) if i not in self._cards)
        card = self._cards[slot] = PresenceCard(name, text, slot, ONLINE if online else OFFLINE, clean=not online)
        card.finished.connect(lambda: (self._cards.pop(slot, None), card.close(), card.deleteLater()))
        card.run()

    def say(self, name: str, text: str):
        """Something a teammate is doing (started a task, sent a change): the same corner, but no sound, no ring, a little
        see-through and gone sooner. It is there for whoever looks, and does not ask to be looked at."""
        slot = next(i for i in range(len(self._cards) + 1) if i not in self._cards)
        card = self._cards[slot] = PresenceCard(name, text, slot, QUIET, quiet=True)
        card.finished.connect(lambda: (self._cards.pop(slot, None), card.close(), card.deleteLater()))
        card.run()
