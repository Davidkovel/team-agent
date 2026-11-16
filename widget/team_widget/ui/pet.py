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

W, H, PET = 320, 210, 120          # the window, and the robot inside it
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
        self._f_title = QFont("Segoe UI", 10, QFont.DemiBold)
        self._f_sub = QFont("Segoe UI", 9)
        pos = prefs.load().get("pet_pos")
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
        return QRectF((W - PET) / 2, H - PET - 4, PET, PET)

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
        if self.title or self.sub:
            self._bubble(p)
        badge.mascot_live(p, r, time.monotonic(), mode=self.mode)

    def _bubble(self, p: QPainter):
        fm_t, fm_s = QFontMetricsF(self._f_title), QFontMetricsF(self._f_sub)
        title = self.title or self.sub
        sub = self.sub if self.title else ""
        btn = 30
        text_w = min(max(fm_t.horizontalAdvance(title), fm_s.horizontalAdvance(sub)), W - 20 - 32 - btn - 14)
        bw = text_w + 32 + btn + 14
        rect = QRectF((W - bw) / 2, 4, bw, BUB_H)
        path = QPainterPath()
        path.addRoundedRect(rect, BUB_H / 2, BUB_H / 2)
        p.setPen(QPen(QColor(255, 255, 255, 28), 1))
        p.setBrush(QColor(28, 29, 33, 238))
        p.drawPath(path)
        # the status dot
        dot = {"work": "#3ecf6e", "wait": "#ffb020"}.get(self.mode, "#8a8f98")
        x = rect.left() + 20
        p.setPen(Qt.NoPen)
        p.setBrush(QColor(dot))
        p.drawEllipse(QPointF(x - 6, rect.top() + (19 if sub else BUB_H / 2)), 3.2, 3.2)
        p.setPen(QColor("#f2f3f5"))
        p.setFont(self._f_title)
        ty = rect.top() + (8 if sub else (BUB_H - fm_t.height()) / 2)
        p.drawText(QRectF(x + 2, ty, text_w, fm_t.height()), Qt.AlignLeft | Qt.AlignVCenter,
                   fm_t.elidedText(title, Qt.ElideRight, text_w))
        if sub:
            p.setPen(QColor("#8f949c"))
            p.setFont(self._f_sub)
            p.drawText(QRectF(x + 2, ty + fm_t.height() + 1, text_w, fm_s.height()), Qt.AlignLeft | Qt.AlignVCenter,
                       fm_s.elidedText(sub, Qt.ElideRight, text_w))
        # the round button on the right: opens the widget
        c = QPointF(rect.right() - 12 - btn / 2, rect.center().y())
        p.setPen(Qt.NoPen)
        p.setBrush(QColor(255, 255, 255, 30))
        p.drawEllipse(c, btn / 2, btn / 2)
        pen = QPen(QColor("#e9ebee"), 1.8)
        pen.setCapStyle(Qt.RoundCap)
        p.setPen(pen)
        p.drawLine(c + QPointF(-4, 4), c + QPointF(4, -4))
        p.drawLine(c + QPointF(-1, -4), c + QPointF(4, -4))
        p.drawLine(c + QPointF(4, -4), c + QPointF(4, 1))
        # the little tail pointing down at the robot
        tail = QPainterPath()
        cx = W / 2
        tail.moveTo(cx - 7, rect.bottom() - 1)
        tail.lineTo(cx, rect.bottom() + 7)
        tail.lineTo(cx + 7, rect.bottom() - 1)
        p.setPen(Qt.NoPen)
        p.setBrush(QColor(28, 29, 33, 238))
        p.drawPath(tail)

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
            prefs.save(pet_pos=[self.x(), self.y()])
        elif self.on_click:
            self.on_click()
