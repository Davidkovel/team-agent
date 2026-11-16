"""The pet (16 Nov, David: «очень красивый дизайн, точно как ChatGPT... побольше»): like the desktop pets of the ChatGPT
app, a big pixel robot that floats over every window, with a dark glass bubble above it saying what this person's Claude
is doing. It reacts: Claude working = it types on its laptop, Claude waiting for you = it jumps to call you, nothing
running = it breathes and now and then hops. Drag it anywhere (the place is kept); a click opens the widget.

The robot is badge.mascot_live (one cached image per size); a frame is a drawImage and a few rects, ~11 a second."""
import time

from PySide6.QtCore import QPoint, QPointF, QRectF, Qt, QTimer
from PySide6.QtGui import QColor, QFont, QFontMetricsF, QPainter, QPainterPath, QPen
from PySide6.QtWidgets import QApplication, QWidget

from . import badge, prefs

W, H, PET = 300, 160, 84   # 16 Nov: a small robot, the ChatGPT-style bubble above it          # the window, and the robot inside it
BUB_H = 54                          # the bubble


class Pet(QWidget):
    def __init__(self, on_click):
        super().__init__(None, Qt.Tool | Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint | Qt.NoDropShadowWindowHint)
        self.setAttribute(Qt.WA_TranslucentBackground)
        self.setAttribute(Qt.WA_ShowWithoutActivating)
        self.setFixedSize(W, H)
        self.on_click = on_click
        self.mode, self.title, self.sub = "idle", "", ""
        self._press, self._moved = None, False
        self._hidden = None                  # the bubble the person closed with ■
        self._btn_open = self._btn_hide = QRectF()
        self._f_title = QFont("Segoe UI", 10, QFont.DemiBold)
        self._f_sub = QFont("Segoe UI", 9)
        pos = prefs.load().get("pet_at")
        if pos:
            self.move(QPoint(*pos))
        else:
            g = QApplication.primaryScreen().availableGeometry()
            self.move(g.right() - W - 24, g.bottom() - H - 24)
        self._tick = QTimer(self)
        self._tick.timeout.connect(self._frame)
        self._tick.start(90)

    # ---- state from the Hub (/api/local/live, this person's row)
    def set_state(self, live: dict, person: dict):
        live = live or {}
        topic = (live.get("topic") or "").strip()
        n = live.get("working") or 0
        if n:
            mode, sub = "work", ("O Claude está a trabalhar" if n == 1 else f"{n} Claudes a trabalhar")
        elif live.get("waiting") and live.get("wait") in ("permission", "answer"):
            mode, sub = "wait", ("O Claude pede autorização" if live.get("wait") == "permission" else "O Claude espera pela tua resposta")
        elif live.get("waiting") and topic:
            mode, sub = "idle", "Acabou"
        else:
            mode, sub, topic = "idle", "", ""
        if (mode, topic, sub) != (self.mode, self.title, self.sub):
            self.mode, self.title, self.sub = mode, topic, sub
            self.update()

    def _frame(self):
        if self.isVisible():
            self.update(self._pet_rect().toAlignedRect().adjusted(-30, -40, 30, 10))

    def _pet_rect(self) -> QRectF:
        return QRectF(W - PET - 20, H - PET - 4, PET, PET)

    # ---- painting
    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        # a soft shadow on the ground
        r = self._pet_rect()
        g = QColor(0, 0, 0, 70)
        p.setPen(Qt.NoPen)
        p.setBrush(g)
        p.drawEllipse(QPointF(r.center().x(), r.bottom() - 2), PET * 0.34, 5)
        if (self.title or self.sub) and (self.title, self.sub) != self._hidden:
            self._bubble(p)
        badge.mascot_live(p, r, time.monotonic(), mode=self.mode)

    def _bubble(self, p: QPainter):
        """The ChatGPT look (16 Nov, David: «подсказки похожие на ChatGPT»): a light frosted pill, the request in dark
        type, what is happening under it in grey, and two round buttons: ↩ opens the widget, ■ hides the bubble until
        the next request."""
        fm_t, fm_s = QFontMetricsF(self._f_title), QFontMetricsF(self._f_sub)
        title = self.title or self.sub
        sub = ""   # 16 Nov: only the request, no grey line under it
        btn, gap = 30, 6
        room = W - 8 - 22 - 2 * btn - gap - 14
        text_w = min(max(fm_t.horizontalAdvance(title), fm_s.horizontalAdvance(sub)), room)
        bw = text_w + 22 + 2 * btn + gap + 14
        rect = QRectF(W - 4 - bw, 4, bw, BUB_H)
        self._btn_open = QRectF(rect.right() - 10 - 2 * btn - gap, rect.center().y() - btn / 2, btn, btn)
        self._btn_hide = QRectF(rect.right() - 10 - btn, rect.center().y() - btn / 2, btn, btn)
        p.setPen(Qt.NoPen)
        for i, a in ((3, 14), (1.5, 22)):   # a soft shadow
            p.setBrush(QColor(0, 0, 0, a))
            p.drawRoundedRect(rect.translated(0, i), BUB_H / 2, BUB_H / 2)
        p.setPen(QPen(QColor(255, 255, 255, 26), 1))
        p.setBrush(QColor(14, 14, 16, 240))
        p.drawRoundedRect(rect, BUB_H / 2, BUB_H / 2)
        x = rect.left() + 22
        p.setPen(QColor("#f2f2f4"))
        p.setFont(self._f_title)
        ty = rect.top() + (9 if sub else (BUB_H - fm_t.height()) / 2)
        p.drawText(QRectF(x, ty, text_w, fm_t.height()), Qt.AlignLeft | Qt.AlignVCenter, fm_t.elidedText(title, Qt.ElideRight, text_w))
        if sub:
            p.setPen(QColor("#8e8e93"))
            p.setFont(self._f_sub)
            p.drawText(QRectF(x, ty + fm_t.height(), text_w, fm_s.height()), Qt.AlignLeft | Qt.AlignVCenter, fm_s.elidedText(sub, Qt.ElideRight, text_w))
        # ↩ open
        p.setPen(Qt.NoPen)
        p.setBrush(QColor(255, 255, 255, 28))
        p.drawEllipse(self._btn_open)
        c = self._btn_open.center()
        pen = QPen(QColor("#d8d8dc"), 1.7)
        pen.setCapStyle(Qt.RoundCap)
        pen.setJoinStyle(Qt.RoundJoin)
        p.setPen(pen)
        p.setBrush(Qt.NoBrush)
        path = QPainterPath(c + QPointF(5, -5))
        path.lineTo(c + QPointF(5, 1))
        path.lineTo(c + QPointF(-5, 1))
        p.drawPath(path)
        p.drawLine(c + QPointF(-5, 1), c + QPointF(-2, -2))
        p.drawLine(c + QPointF(-5, 1), c + QPointF(-2, 4))
        # ■ hide
        p.setPen(Qt.NoPen)
        p.setBrush(QColor(255, 255, 255, 230))
        p.drawEllipse(self._btn_hide)
        p.setBrush(QColor("#111113"))
        p.drawRoundedRect(QRectF(self._btn_hide.center().x() - 4.5, self._btn_hide.center().y() - 4.5, 9, 9), 2, 2)

    # ---- drag and click
    def mousePressEvent(self, e):
        if e.button() == Qt.LeftButton:
            self._press, self._moved = e.globalPosition().toPoint() - self.pos(), False

    def mouseMoveEvent(self, e):
        if self._press is not None:
            to = e.globalPosition().toPoint() - self._press
            if (to - self.pos()).manhattanLength() > 3 or self._moved:
                self._moved = True
                self.move(to)

    def mouseReleaseEvent(self, e):
        if self._press is None:
            return
        self._press = None
        if self._moved:
            prefs.save(pet_at=[self.x(), self.y()])
        elif self._btn_hide.contains(e.position()):
            self._hidden = (self.title, self.sub)
            self.update()
        elif self.on_click:
            self.on_click()
