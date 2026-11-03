"""O destaque: what an icon of the minimized clock opens, right beside it.

28 Oct, Marco, about the small icons over the time: «aquele não faz nada, fica igual às horas... eu quero que isso esteja
no relógio... preciso de utilizar para ver rápido». So the clock has three sizes now: the clock with its icons, the
destaque of one icon (this card), and the central. A click on an icon opens its card: Claude, the windows of this person
and what each does; Tokens, the 5 h and the week of each partner; Equipa, how many Claudes each partner has working and
on what; Mensagens and Tarefas, the unread messages and the open tasks themselves; Ponto, the hours and the button;
Câmaras, one button per room of the cave (each opens the mini window on that camera); FundedNext, the account in a few
lines. A click on a line does what it says (opens the task, the conversation, the camera) and the card closes; a click
anywhere else closes it too.

The window (window.py, `_spot_content`) says what goes in it as a plain dict; this file only draws it. It is black glass
with the chrome rim of the central, never repaints by itself, and is made the first time an icon is clicked.
"""
import time

from PySide6.QtCore import QEvent, QPoint, QPointF, QRect, QRectF, Qt
from PySide6.QtGui import QColor, QFont, QFontMetricsF, QGuiApplication, QLinearGradient, QPainter, QPainterPath, QPen
from PySide6.QtWidgets import QGridLayout, QHBoxLayout, QLayout, QVBoxLayout, QWidget

from .photos import photos
from .window import (clear_glass, cut, cut_path, DISPLAY, FAINT, MUTED, SHADOW, TEXT, UI, WHITE, Hover, WidgetWindow, avatar, font, glow_disc,
                     glyph, label, meter_color)

W = 312   # the card; the window adds SHADOW on every side


class Head(QWidget):
    """The card's top: the icon's glyph in a small chrome disc, its name and a note, and the big figure on the right."""
    H = 46

    def __init__(self):
        super().__init__()
        self.setFixedHeight(self.H)
        self.key, self.title, self.note, self.figure, self.colour = "", "", "", "", TEXT
        self._f_title, self._f_note, self._f_figure = font(11, QFont.DemiBold, DISPLAY), font(8, QFont.Normal, UI), font(20, QFont.DemiBold, DISPLAY)

    def set(self, key, title, note, figure, colour):
        if (key, title, note, figure, colour) != (self.key, self.title, self.note, self.figure, self.colour):
            self.key, self.title, self.note, self.figure, self.colour = key, title, note, figure, colour
            self.update()

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        disc = QRectF(0, 5, 34, 34)
        body = QLinearGradient(0, disc.top(), 0, disc.bottom())
        body.setColorAt(0, QColor(238, 240, 244))
        body.setColorAt(1, QColor(160, 166, 174))
        p.setPen(QPen(QColor(255, 255, 255, 80), 1))
        p.setBrush(body)
        p.drawEllipse(disc)
        if self.key:
            p.drawPixmap(QPointF(disc.center().x() - 9, disc.center().y() - 9), glyph(self.key, 18, "#0b0b0d", self.devicePixelRatioF()))
        fig_w = QFontMetricsF(self._f_figure).horizontalAdvance(self.figure) + 4 if self.figure else 0
        p.setFont(self._f_figure)
        p.setPen(QColor(self.colour))
        p.drawText(QRectF(self.width() - fig_w, 0, fig_w, self.H), Qt.AlignRight | Qt.AlignVCenter, self.figure)
        room = self.width() - 46 - fig_w - 6
        p.setFont(self._f_title)
        p.setPen(QColor(TEXT))
        p.drawText(QRectF(46, 5, room, 20), Qt.AlignLeft | Qt.AlignVCenter, QFontMetricsF(self._f_title).elidedText(self.title, Qt.ElideRight, room))
        p.setFont(self._f_note)
        p.setPen(QColor(MUTED))
        p.drawText(QRectF(46, 24, room, 16), Qt.AlignLeft | Qt.AlignVCenter, QFontMetricsF(self._f_note).elidedText(self.note, Qt.ElideRight, room))


GAP = 8   # between two groups of the list


def group_shape(r: QRectF, radius: float, top: bool, bottom: bool) -> QPainterPath:
    """A slice of a grouped list: round corners only where the group starts and ends."""
    path = QPainterPath()
    path.addRoundedRect(r, radius, radius)
    if top and bottom:
        return path
    square = QPainterPath()
    if not top:
        square.addRect(QRectF(r.left(), r.top(), r.width(), r.height() / 2))
    if not bottom:
        square.addRect(QRectF(r.left(), r.center().y(), r.width(), r.height() / 2))
    return path.united(square).simplified()


class Row(Hover):
    """One line of the card, inside a group (3 Nov, Marco: «essas abas estão... tipo Android... a da equipa está bem
    confusa... tudo junto»): the lines of one thing share one rounded block with hairlines between them, as the lists of
    iOS Settings, instead of a glass box each with the car through it. A line: the person's photo (or a dot in the
    state's colour), a title, a line under it, a figure on the right, and up to two thin bars (the Claude limits).
    `head` is a partner at the top of their group (Equipa); the lines after it are their windows. No tooltips: the old
    black Windows box is what Marco called «a cena do Windows antigo»."""

    def __init__(self):
        super().__init__()
        self.item = {}
        self.first, self.last, self.gap = True, True, False
        self._f_title, self._f_sub, self._f_right, self._f_bar = (font(9, QFont.DemiBold, UI), font(8, QFont.Normal, UI),
                                                                  font(8.5, QFont.DemiBold, DISPLAY), font(7, QFont.DemiBold, UI))
        self._f_head = font(10, QFont.DemiBold, DISPLAY)
        photos().ready.connect(self.update)

    def show_item(self, item: dict, first=True, last=True, gap=False):
        h = 56 if item.get("bars") else 48 if item.get("head") else 42 if item.get("sub") else 32
        self.setFixedHeight(h + (GAP if gap else 0))
        self.setEnabled(bool(item.get("action")))
        self.setCursor(Qt.PointingHandCursor if item.get("action") else Qt.ArrowCursor)
        if (item, first, last, gap) != (self.item, self.first, self.last, self.gap):
            self.item, self.first, self.last, self.gap = item, first, last, gap
            self.update()

    def paintEvent(self, _):
        it = self.item
        if not it:
            return
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        p.setRenderHint(QPainter.SmoothPixmapTransform)
        r = QRectF(self.rect()).adjusted(0, GAP if self.gap else 0, 0, 0)
        shape = group_shape(r, 12, self.first, self.last)
        p.setPen(Qt.NoPen)
        p.setBrush(QColor(255, 255, 255, 19 if it.get("head") else 12))
        p.drawPath(shape)
        if it.get("action"):
            if self.hover:
                p.setBrush(QColor(255, 255, 255, int(14 * self.hover)))
                p.drawPath(shape)
            self.paint_wave(p, shape)
        x = 12.0
        if not self.first:   # the hairline between two lines of a group, from where the text starts
            p.setPen(QPen(QColor(255, 255, 255, 22), 1))
            start = x + (38 if it.get("user") else 16)
            p.drawLine(QPointF(r.left() + start, r.top() + 0.5), QPointF(r.right(), r.top() + 0.5))
        colour = it.get("colour") or MUTED
        two = bool(it.get("sub") or it.get("bars"))
        if it.get("user"):
            s = 28
            pic = photos().photo(it["user"], s, self.devicePixelRatioF())
            top = QPointF(x, r.top() + (8 if it.get("bars") else (r.height() - s) / 2))
            if not it.get("online", True):
                p.setOpacity(0.5)
            if pic is not None:
                p.drawPixmap(top, pic)
            else:
                p.drawPixmap(QRectF(top, QPointF(top.x() + s, top.y() + s)).toRect(), avatar(bool(it.get("online", True)), self.devicePixelRatioF()))
            p.setOpacity(1)
            p.setPen(QPen(QColor(24, 24, 26), 2))
            p.setBrush(QColor(colour))
            p.drawEllipse(QPointF(top.x() + s - 3, top.y() + s - 3), 3.6, 3.6)
            x += s + 10
        else:
            dot = QPointF(x + 4, r.top() + (15 if two else r.height() / 2))
            glow_disc(p, dot, 7, 7, colour, 0.35)
            p.setPen(Qt.NoPen)
            p.setBrush(QColor(colour))
            p.drawEllipse(dot, 3.2, 3.2)
            x += 16
        line1 = QRectF(0, r.top() + 6, 0, 18) if two else QRectF(0, r.top(), 0, r.height())
        right = it.get("right", "")
        rw = QFontMetricsF(self._f_right).horizontalAdvance(right) + 6 if right else 0
        room = r.width() - x - rw - 14
        p.setFont(self._f_right)
        p.setPen(QColor(it.get("right_colour") or FAINT))
        p.drawText(QRectF(r.right() - rw - 12, line1.top(), rw, line1.height()), Qt.AlignRight | Qt.AlignVCenter, right)
        f_title = self._f_head if it.get("head") else self._f_title
        p.setFont(f_title)
        p.setPen(QColor(it.get("title_colour") or TEXT))
        p.drawText(QRectF(x, line1.top(), room, line1.height()),
                   Qt.AlignLeft | Qt.AlignVCenter, QFontMetricsF(f_title).elidedText(it.get("title", ""), Qt.ElideRight, room))
        if it.get("sub"):
            p.setFont(self._f_sub)
            p.setPen(QColor(it.get("sub_colour") or MUTED))
            sub_room = r.width() - x - 12
            p.drawText(QRectF(x, r.top() + 23, sub_room, 15), Qt.AlignLeft | Qt.AlignVCenter,
                       QFontMetricsF(self._f_sub).elidedText(it["sub"], Qt.ElideRight, sub_room))
        bars = it.get("bars") or []
        if bars:   # [(pct or None, name)]: side by side, the name and the figure over each bar
            gap = 12
            each = (r.width() - x - 12 - gap * (len(bars) - 1)) / len(bars)
            for i, (pct, name) in enumerate(bars):
                bx = x + i * (each + gap)
                p.setFont(self._f_bar)
                p.setPen(QColor(MUTED))
                p.drawText(QRectF(bx, r.top() + 25, each, 13), Qt.AlignLeft | Qt.AlignVCenter, name)
                p.setPen(QColor(TEXT if pct is not None else FAINT))
                p.drawText(QRectF(bx, r.top() + 25, each, 13), Qt.AlignRight | Qt.AlignVCenter, "—" if pct is None else f"{round(pct)}%")
                bar = QRectF(bx, r.top() + 41, each, 4)
                p.setPen(Qt.NoPen)
                p.setBrush(QColor(255, 255, 255, 22))
                cut(p, bar, 2, 2)
                if pct:
                    p.setBrush(QColor(meter_color(pct)))
                    cut(p, QRectF(bx, bar.top(), max(4.0, each * min(100, pct) / 100), 4), 2, 2)


class Pill(Hover):
    """A button of the card: a room of the cave, or the card's main action. `primary` is polished chrome with dark text,
    like the central's buttons when on; the rest is dark glass."""

    def __init__(self, text, action, primary=False, tip="", colour=None):
        super().__init__()
        self.text, self.action, self.primary, self.colour = text, action, primary, colour
        self.setFixedHeight(32 if primary else 30)
        self._f = font(8.5, QFont.DemiBold, UI)
        self.setMinimumWidth(round(QFontMetricsF(self._f).horizontalAdvance(text)) + 28)
        self.clicked.connect(lambda: self.action())

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        r = QRectF(self.rect()).adjusted(0.5 + self.press, 0.5 + self.press, -0.5 - self.press, -0.5 - self.press)
        shape = QPainterPath()
        shape.addPath(cut_path(r, r.height() / 2, r.height() / 2))
        if self.primary:
            body = QLinearGradient(0, r.top(), 0, r.bottom())
            body.setColorAt(0, QColor(self.colour) if self.colour else QColor(238, 240, 244))
            body.setColorAt(1, QColor(self.colour).darker(130) if self.colour else QColor(166, 171, 179))
            p.setPen(QPen(QColor(255, 255, 255, 90), 1))
            p.setBrush(body)
            p.drawPath(shape)
        else:   # a quiet grey capsule, a touch brighter under the mouse
            p.setPen(QPen(QColor(255, 255, 255, 26), 1))
            p.setBrush(QColor(255, 255, 255, 16 + int(14 * self.hover)))
            p.drawPath(shape)
        self.paint_wave(p, shape, "#000000" if self.primary else WHITE)
        p.setPen(QColor("#0b0b0d") if self.primary else QColor(TEXT))
        p.setFont(self._f)
        p.drawText(r, Qt.AlignCenter, self.text)


class Spotlight(QWidget):
    """The card. `show_for` opens it for an icon next to the clock's face; `show_content` refreshes what it says (the
    window calls it when the Hub's numbers change while it is open)."""

    def __init__(self):
        # a tool window, not a popup: a popup holds the mouse, and the press that closed it never reached the clock, so
        # the clock could not be dragged with a destaque open (28 Oct, Marco: «sempre que arrasto... já tá lá no relógio»)
        super().__init__(None, Qt.Tool | Qt.FramelessWindowHint | Qt.NoDropShadowWindowHint | Qt.WindowStaysOnTopHint)
        self.setAttribute(Qt.WA_TranslucentBackground)
        self.key = None
        self._anchor, self._flip, self._beside = QRect(), False, None
        self._closed_key, self._closed_at = None, 0.0
        self.setFixedWidth(W + 2 * SHADOW)
        col = QVBoxLayout(self)
        col.setContentsMargins(SHADOW + 14, SHADOW + 12, SHADOW + 14, SHADOW + 14)
        col.setSpacing(6)
        col.setSizeConstraint(QLayout.SetFixedSize)
        self.head = Head()
        self.head.setFixedWidth(W - 28)
        col.addWidget(self.head)
        # blocks of text: one Claude window's prompt, what it does now and its last answer (30 Oct, `blocks` in the content)
        self.blocks = QVBoxLayout()
        self.blocks.setSpacing(8)
        self.blocks.setContentsMargins(0, 2, 0, 2)
        col.addLayout(self.blocks)
        self._blocks_sig = None
        self.grid = QGridLayout()
        self.grid.setSpacing(6)
        self.grid.setContentsMargins(0, 2, 0, 2)
        col.addLayout(self.grid)
        self.list = QVBoxLayout()
        self.list.setSpacing(0)
        col.addLayout(self.list)
        self.rows: list[Row] = []
        self.empty = label("", 8.5, FAINT, wrap=True)
        self.empty.setFixedWidth(W - 28)
        col.addWidget(self.empty)
        self.foot = QHBoxLayout()
        self.foot.setSpacing(6)
        self.foot.setContentsMargins(0, 4, 0, 0)
        col.addLayout(self.foot)
        self._grid_sig, self._foot_sig = None, None

    # ---- what it says
    def show_content(self, c: dict):
        self.head.set(self.key, c.get("title", ""), c.get("note", ""), c.get("figure", ""), c.get("colour") or TEXT)
        blocks = tuple(c.get("blocks", []))   # [(caption, text, colour or None)]
        if blocks != self._blocks_sig:
            self._blocks_sig = blocks
            self._clear(self.blocks)
            for cap, text, colour in blocks:
                box = QVBoxLayout()
                box.setSpacing(3)
                box.addWidget(label(cap.upper(), 7, MUTED, QFont.Bold, UI, spacing=1.4))
                body = label(text, 8.5, colour or TEXT, wrap=True)
                body.setFixedWidth(W - 28)
                body.setTextInteractionFlags(Qt.TextSelectableByMouse)   # the prompt can be selected and copied
                box.addWidget(body)
                self.blocks.addLayout(box)
        sig = tuple((label_, tip) for label_, _, tip in c.get("grid", []))
        if sig != self._grid_sig:
            self._grid_sig = sig
            self._clear(self.grid)
            for i, (text, action, tip) in enumerate(c.get("grid", [])):
                self.grid.addWidget(Pill(text, self._do(action), tip=tip), i // 3, i % 3)
        items = c.get("rows", [])
        while len(self.rows) < len(items):
            row = Row()
            row.setFixedWidth(W - 28)
            row.clicked.connect(lambda _=False, row=row: row.item.get("action") and self._do(row.item["action"])())
            self.list.addWidget(row)
            self.rows.append(row)
        # groups: a line with `group` (a partner, a person's limits) starts a new block; the rest join the block above
        starts = [i == 0 or bool(it.get("group")) for i, it in enumerate(items)]
        for i, (row, item) in enumerate(zip(self.rows, items + [None] * len(self.rows))):
            row.setVisible(item is not None)
            if item is not None:
                row.show_item(item, first=starts[i], last=i + 1 == len(items) or starts[i + 1], gap=starts[i] and i > 0)
        self.empty.setText(c.get("empty", ""))
        self.empty.setVisible(bool(c.get("empty")) and not items)
        sig = tuple((text, primary, colour) for text, _, primary, colour in c.get("buttons", []))
        if sig != self._foot_sig:
            self._foot_sig = sig
            self._clear(self.foot)
            for text, action, primary, colour in c.get("buttons", []):
                self.foot.addWidget(Pill(text, self._do(action), primary, colour=colour), 1 if primary else 0)
            if c.get("buttons") and not any(b[2] for b in c["buttons"]):
                self.foot.insertStretch(0, 1)
        # the actions are new lambdas each time: keep the buttons, give them the new ones
        for i, (_, action, _tip) in enumerate(c.get("grid", [])):
            item = self.grid.itemAt(i)
            if item and item.widget():
                item.widget().action = self._do(action)
        buttons = [self.foot.itemAt(i).widget() for i in range(self.foot.count()) if self.foot.itemAt(i).widget()]
        for b, (_, action, _p, _c) in zip(buttons, c.get("buttons", [])):
            b.action = self._do(action)
        self.layout().activate()
        self.adjustSize()
        if self.isVisible():
            self._place()

    def _do(self, action):
        """A click on the card does its thing and the card closes (the thing often opens a window of its own)."""
        def run():
            self.hide()
            action()
        return run

    @staticmethod
    def _clear(layout):
        # out at once: with only deleteLater the old buttons stayed painted on the card, so a destaque opened from another
        # showed the old «Escritório ›» over the new lines (3 Nov, Marco: «tudo junto, tapa-te»)
        while layout.count():
            item = layout.takeAt(0)
            if item.widget():
                item.widget().hide()
                item.widget().setParent(None)
                item.widget().deleteLater()
            elif item.layout():
                Spotlight._clear(item.layout())
                item.layout().deleteLater()

    # ---- where it opens
    def toggled_off(self, key: str) -> bool:
        """The same icon clicked again closes its card: it is open, or the press of this very click just closed it."""
        if self.isVisible() and self.key == key:
            self.hide()
            return True
        return self._closed_key == key and time.monotonic() - self._closed_at < 0.4

    def show_for(self, key: str, content: dict, anchor: QRect, flip: bool, beside: QRect | None = None):
        """Opens the card for `key` beside the clock's face (`anchor`, on the screen): under it, its edge on the star's
        side; above it when there is no room under it. From the central (`beside`: the central on the screen) it opens
        outside the central, level with the figure clicked."""
        self.key, self._anchor, self._flip, self._beside = key, anchor, flip, beside
        self._grid_sig = self._foot_sig = self._blocks_sig = None
        self.show_content(content)
        self._place()
        self.show()
        self.raise_()
        self.activateWindow()   # so a click anywhere else takes it away (changeEvent)

    def hideEvent(self, e):
        self._closed_key, self._closed_at = self.key, time.monotonic()
        super().hideEvent(e)

    def changeEvent(self, e):
        if e.type() == QEvent.ActivationChange and not self.isActiveWindow() and self.isVisible():
            self.hide()   # clicked elsewhere: the clock, the central, another window
        super().changeEvent(e)

    def _place(self):
        a = self._anchor
        screen = (QGuiApplication.screenAt(a.center()) or self.screen()).availableGeometry()
        w, h = self.width(), self.height()
        if self._beside is not None:   # from the central: on its outer side, the side with room
            b = self._beside
            x = b.left() - w + SHADOW - 8 if b.left() - (w - 2 * SHADOW) - 8 >= screen.left() else b.right() - SHADOW + 8
            y = a.top() - SHADOW
        else:
            x = a.right() + SHADOW - w if self._flip else a.left() - SHADOW
            y = a.bottom() + 6 - SHADOW + 4
            if y + h - SHADOW > screen.bottom():
                y = a.top() - h + SHADOW - 6
        x = max(screen.left() - SHADOW, min(x, screen.right() + SHADOW - w))
        y = max(screen.top() - SHADOW, min(y, screen.bottom() + SHADOW - h))
        self.move(QPoint(x, y))

    def keyPressEvent(self, e):
        if e.key() == Qt.Key_Escape:
            self.hide()
        else:
            super().keyPressEvent(e)

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        # flat black without the car (3 Nov): the lines are read at a glance, and the photo behind them made it busy
        WidgetWindow._paint_panel(p, QRectF(SHADOW, SHADOW, self.width() - 2 * SHADOW, self.height() - 2 * SHADOW), 22, True, scene=False)
