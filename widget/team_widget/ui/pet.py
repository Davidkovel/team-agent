"""The pet (16 Nov, David: «очень красивый дизайн, точно как ChatGPT... побольше»): like the desktop pets of the ChatGPT
app, a big pixel robot that floats over every window, with a dark glass bubble above it saying what this person's Claude
is doing. It reacts: Claude working = it types on its laptop, Claude waiting for you = it jumps to call you, nothing
running = it breathes and now and then hops. Drag it anywhere (the place is kept); a click opens the widget.

The robot is badge.mascot_live (one cached image per size); a frame is a drawImage and a few rects, ~11 a second."""
import math
import os
import random
import time

from PySide6.QtCore import QPoint, QPointF, QRectF, Qt, QTimer
from PySide6.QtGui import QColor, QFont, QFontMetricsF, QPainter, QPainterPath, QPen
from PySide6.QtWidgets import QApplication, QWidget

from . import badge, prefs

W, H, PET = 132, 128, 84   # 16 Nov: only the black robot, no bubble («убрать сверху где написано»)          # the window, and the robot inside it
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
        # 16 Nov, Marco: «cenas engraçadas» with the AMG theme, only pictures (David did not want text over it)
        self._mode_at = time.monotonic()       # when the Claude state last changed (sleep after a long calm)
        self._party_until = 0.0                # a job just finished: chequered flag and confetti
        self._gag, self._gag_until = None, 0.0  # now and then when calm: coffee, flag, heart
        self._next_gag = time.monotonic() + 25
        self._busy = 0.0                       # how hard this computer works (load / cores), 0..1+
        self._load = QTimer(self)
        self._load.timeout.connect(self._read_load)
        self._load.start(3000)
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
            now = time.monotonic()
            if self.mode == "work" and mode == "idle":
                self._party_until = now + 4.5   # the job is done: a little victory lap
            if mode != self.mode:
                self._mode_at = now
            self.mode, self.title, self.sub = mode, topic, sub
            self.update()

    def _read_load(self):
        try:
            self._busy = os.getloadavg()[0] / max(1, os.cpu_count() or 1)
        except (OSError, AttributeError):   # Windows has no load average
            self._busy = 0.0

    def _look(self, now: float) -> str:
        """What the robot shows now: work / wait / party / turbo / sleep / gag / idle."""
        if self.mode == "wait":
            return "wait"
        if now < self._party_until:
            return "party"
        if self.mode == "work":
            return "turbo" if self._busy > 0.7 else "work"
        if self._busy > 0.7:
            return "turbo"
        if now - self._mode_at > 300:          # five quiet minutes: it falls asleep
            return "sleep"
        if now >= self._next_gag and self._gag is None:
            self._gag, self._gag_until = random.choice(("coffee", "flag", "heart", "wave")), now + 4.0
        if self._gag and now > self._gag_until:
            self._gag, self._next_gag = None, now + random.uniform(35, 70)
        return self._gag or "idle"

    def _frame(self):
        if self.isVisible():
            self.update()

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
        now = time.monotonic()
        look = self._look(now)
        robot = {"work": "work", "turbo": "work", "wait": "wait", "sleep": "sleep",
                 "coffee": "calm", "heart": "calm"}.get(look, "idle")
        if look == "turbo":
            self._turbo(p, r, now)
        badge.mascot_live(p, r, now, mode=robot)
        getattr(self, "_fx_" + look, lambda *a: None)(p, r, now)

    # ---- the little shows (all in the robot's own pixel style: square dots, black, white and AMG red)
    def _px(self, p: QPainter, x: float, y: float, s: float, col: QColor):
        p.setPen(Qt.NoPen)
        if col.lightness() > 150:              # light pixels get a dark rim, so they read on a white desktop too
            p.setBrush(QColor(10, 10, 12, round(col.alpha() * 0.75)))
            p.drawRect(QRectF(round(x) - 1, round(y) - 1, s + 2, s + 2))
        p.setBrush(col)
        p.drawRect(QRectF(round(x), round(y), s, s))

    def _text(self, p: QPainter, pt: QPointF, txt: str, col: QColor):
        """Text with a dark rim (readable on any desktop)."""
        rim = QColor(10, 10, 12, round(col.alpha() * 0.8))
        p.setPen(rim)
        for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            p.drawText(pt + QPointF(dx, dy), txt)
        p.setPen(col)
        p.drawText(pt, txt)

    def _head(self, r: QRectF) -> QPointF:
        return QPointF(r.center().x(), r.top() + r.height() * 0.08)

    def _fx_work(self, p, r, t):
        """Little bits of code fly out of the laptop."""
        p.setFont(QFont("Menlo", 8, QFont.Bold))
        for i, glyph in enumerate(("</>", "{ }", "01", ";")):
            u = (t * 0.6 + i / 4) % 1.0
            x = r.right() - 8 + 10 * math.sin(u * 5 + i)
            y = r.bottom() - 30 - u * 46
            c = QColor("#ff3b30") if i % 2 == 0 else QColor("#f2f2f4")
            c.setAlpha(round(230 * (1 - u)))
            self._text(p, QPointF(x - 10, y), glyph, c)

    def _turbo(self, p, r, t):
        """The computer is working hard: AMG speed lines and exhaust puffs behind it."""
        for i in range(4):
            y = r.top() + r.height() * (0.35 + 0.14 * i)
            u = (t * 3.2 + i * 0.37) % 1.0
            ln = 16 + 10 * ((i * 7) % 3)
            x = r.left() - 4 - u * 18
            a = round(190 * (1 - u))
            p.setPen(QPen(QColor(10, 10, 12, round(a * 0.7)), 4))
            p.drawLine(QPointF(x, y), QPointF(x - ln, y))
            p.setPen(QPen(QColor(255, 255, 255, a), 2))
            p.drawLine(QPointF(x, y), QPointF(x - ln, y))
        for i in range(3):
            u = (t * 1.4 + i / 3) % 1.0
            s = 3 + 5 * u
            g = QColor(40, 40, 46, round(200 * (1 - u)))
            self._px(p, r.left() + 6 - u * 26, r.bottom() - 10 - u * 8 - i * 2, s, g)

    def _fx_turbo(self, p, r, t):
        self._fx_work(p, r, t)

    def _fx_wait(self, p, r, t):
        """A red «!» bounces over its head: the Claude needs you."""
        h = self._head(r)
        y = h.y() - 4 - abs(math.sin(t * 6)) * 6
        red = QColor("#ff3b30")
        for k in range(3):                     # the bar, a gap, the dot
            self._px(p, h.x() + 28, y - 16 + 4 * k, 4, red)
        self._px(p, h.x() + 28, y, 4, red)

    def _fx_sleep(self, p, r, t):
        """Asleep: z Z float up from its head."""
        h = self._head(r)
        p.setFont(QFont("Menlo", 9, QFont.Bold))
        for i in range(3):
            u = (t * 0.35 + i / 3) % 1.0
            f = QFont("Menlo", 7 + 4 * i * u + 2, QFont.Bold)
            p.setFont(f)
            c = QColor(242, 242, 244, round(220 * math.sin(math.pi * u)))
            self._text(p, QPointF(h.x() + 16 + u * 18, h.y() + 8 - u * 26), "z" if i % 2 else "Z", c)

    def _flag(self, p, x, y, t, big=1.0):
        """A chequered race flag, waving."""
        s = 4 * big
        p.setPen(QPen(QColor("#d8d8dc"), 2))
        p.drawLine(QPointF(x, y), QPointF(x, y + 30 * big))
        for cx in range(4):
            for cy in range(3):
                wave = 2.2 * big * math.sin(t * 9 - cx * 0.9)
                col = QColor("#111113") if (cx + cy) % 2 else QColor("#f4f4f6")
                self._px(p, x + 1 + cx * s, y + cy * s + wave, s, col)

    def _fx_flag(self, p, r, t):
        h = self._head(r)
        self._flag(p, h.x() + 24, h.y() - 18, t)

    def _fx_party(self, p, r, t):
        """A job finished: flag up and red, white and black confetti."""
        h = self._head(r)
        self._flag(p, h.x() + 22, h.y() - 22, t, 1.2)
        rnd = random.Random(7)
        for i in range(16):
            x0 = rnd.uniform(r.left() - 16, r.right() + 16)
            sp = rnd.uniform(0.5, 1.0)
            u = (t * 0.7 * sp + rnd.random()) % 1.0
            col = (QColor("#ff3b30"), QColor("#f4f4f6"), QColor("#2a2d33"))[i % 3]
            self._px(p, x0 + 6 * math.sin(t * 3 + i), 4 + u * (H - 20), 3, col)

    def _fx_coffee(self, p, r, t):
        """A coffee break: a tiny cup with steam."""
        x, y = r.left() - 2, r.bottom() - 22
        white, dark = QColor("#f2f2f4"), QColor("#2a2d33")
        p.setPen(QPen(QColor(10, 10, 12, 200), 1.5))
        p.setBrush(white)
        p.drawRect(QRectF(x + 12, y + 3, 3, 6))
        p.drawRect(QRectF(x, y, 12, 12))
        p.setPen(Qt.NoPen)
        p.setBrush(dark)
        p.drawRect(QRectF(x + 2, y + 2, 8, 2))
        for i in range(2):
            u = (t * 0.8 + i / 2) % 1.0
            c = QColor(242, 242, 244, round(200 * (1 - u)))
            self._px(p, x + 3 + 5 * i + 2 * math.sin(t * 4 + i), y - 4 - u * 14, 2, c)

    def _fx_heart(self, p, r, t):
        """A little pixel heart pops above it."""
        h = self._head(r)
        u = (t % 2.0) / 2.0
        s = 3
        x0, y0 = h.x() + 14, h.y() - 10 - u * 14
        red = QColor(255, 59, 48, round(255 * (1 - u * 0.6)))
        for (cx, cy) in ((1, 0), (2, 0), (4, 0), (5, 0), (0, 1), (1, 1), (2, 1), (3, 1), (4, 1), (5, 1), (6, 1),
                         (0, 2), (1, 2), (2, 2), (3, 2), (4, 2), (5, 2), (6, 2), (1, 3), (2, 3), (3, 3), (4, 3), (5, 3),
                         (2, 4), (3, 4), (4, 4), (3, 5)):
            self._px(p, x0 + cx * s, y0 + cy * s, s, red)

    def _fx_wave(self, p, r, t):
        """It waves at you: a little hand going side to side."""
        a = 18 * math.sin(t * 9)              # the arm swings from the shoulder
        sx, sy = r.right() - 4, r.top() + r.height() * 0.70
        p.save()
        p.translate(sx, sy)
        p.rotate(28 + a)
        dark, red = QColor("#2a2d33"), QColor("#ff3b30")
        p.setPen(Qt.NoPen)
        p.setBrush(QColor(10, 10, 12))
        p.drawRect(QRectF(-3, -24, 6, 24))     # the arm
        p.setBrush(dark)
        p.drawRect(QRectF(-6, -34, 12, 11))    # the hand
        for i in range(3):                     # three fingers
            p.drawRect(QRectF(-6 + 4.5 * i, -39, 3, 5))
        p.setBrush(red)
        p.drawRect(QRectF(-2, -30, 4, 3))
        p.restore()

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
