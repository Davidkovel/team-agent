"""The pet (16 Nov). 1st pass, David: a pixel robot like the ChatGPT pets. 2nd pass, Marco: «tu imitas literalmente o
robô do ChatGPT... faz uma cena completamente diferente, com o tema e as cores do nosso widget»: now it is our own
character, a little black AMG seen from the front, chrome trim, the headlights are its eyes and the intake its mouth.

What it does:
  * the central opens -> it drives off (shrinks into the distance) and is gone; the central closes -> it drops back in
    and bounces on its suspension (`leave` / `arrive`, called by window.py);
  * a message or a task sent to this person -> hazard lights, horn waves and a red count on the roof, and it keeps
    nagging (a hop every few seconds) until it is clicked: the click opens what was sent (`alert`);
  * Claude working -> the engine idles: a light shake and exhaust puffs; Claude waiting for you -> hazards;
    a job finished -> a chequered flag; five quiet minutes -> it parks, lights off, «z»;
  * calm -> now and then it looks around, flashes its high beams, revs or honks.

Weight (Marco: «roubar o mínimo de CPU e nunca afetar nada»): the car body is one cached image; a frame is a drawImage and
a few small shapes. Frames a second follow what is on: 1 asleep, 2-5 calm, 30 only while it arrives or leaves; the busier
the computer the slower, almost frozen when it works flat out; and the process runs at low priority (nice)."""
import math
import os
import random
import time

from PySide6.QtCore import QPoint, QPointF, QRectF, Qt, QTimer
from PySide6.QtGui import QColor, QFont, QImage, QLinearGradient, QPainter, QPainterPath, QPen, QRadialGradient
from PySide6.QtWidgets import QApplication, QWidget

from . import prefs

W, H = 128, 112             # the window
CW, CH = 84, 50             # the car (front view) inside it
GROUND = H - 14             # where the tyres touch

CHROME_HI, CHROME_LO = QColor("#f4f6f8"), QColor("#7c828c")
BODY_HI, BODY_LO = QColor("#2a2d33"), QColor("#060708")
RED = QColor("#ff3b30")
AMBER = QColor("#e3bd6b")    # the widget's colour for «this is for you»
EYE = QColor("#eaf2ff")


def _ease_out(u: float) -> float:
    return 1 - (1 - u) ** 3


def _bounce(u: float) -> float:
    """0 -> 1 with a drop and two little bounces (the suspension)."""
    if u < 0.55:
        return (u / 0.55) ** 2
    if u < 0.8:
        v = (u - 0.675) / 0.125
        return 1 - 0.10 * (1 - v * v)
    v = (u - 0.9) / 0.1
    return 1 - 0.03 * (1 - v * v)


class Pet(QWidget):
    def __init__(self, on_click, open_page=None):
        super().__init__(None, Qt.Tool | Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint | Qt.NoDropShadowWindowHint)
        self.setAttribute(Qt.WA_TranslucentBackground)
        self.setAttribute(Qt.WA_ShowWithoutActivating)
        self.setAttribute(Qt.WA_MacAlwaysShowToolWindow)   # on the Mac a tool window hides when the widget is not the front app
        self.setFixedSize(W, H)
        self.on_click, self.open_page = on_click, open_page
        self.mode = "idle"
        self._press, self._moved = None, False
        pos = prefs.load().get("pet_at")
        if pos:
            self.move(QPoint(*pos))
        else:
            g = QApplication.primaryScreen().availableGeometry()
            self.move(g.right() - W - 24, g.bottom() - H - 24)
        now = time.monotonic()
        self._mode_at = now                    # when the Claude state last changed (it parks after a long calm)
        self._party_until = 0.0                # a job just finished: chequered flag
        self._gag, self._gag_until, self._next_gag = None, 0.0, now + 20
        self._alerts, self._alert_href = 0, None   # messages / tasks for this person not yet looked at
        self._enter = None                     # (start, +1 arriving / -1 leaving)
        self._busy = 0.0                       # load average / cores
        self._body = None                      # the cached car body (QImage, pixel ratio)
        self._load = QTimer(self)
        self._load.timeout.connect(self._read_load)
        self._load.start(4000)
        self._read_load()
        self._tick = QTimer(self)
        self._tick.timeout.connect(self._frame)
        self._tick.start(400)
        if hasattr(os, "nice"):                # the widget always gives way to real work
            try:
                os.nice(10)
            except OSError:
                pass

    # ------------------------------------------------------------ from the widget
    def set_state(self, live: dict, person: dict):
        live = live or {}
        if live.get("working"):
            mode = "work"
        elif live.get("waiting") and live.get("wait") in ("permission", "answer"):
            mode = "wait"
        else:
            mode = "idle"
        if mode != self.mode:
            now = time.monotonic()
            if self.mode == "work" and mode == "idle":
                self._party_until = now + 4.0
            self._mode_at = now
            self.mode = mode
            self._wake()

    def alert(self, items):
        """Messages or tasks arrived (the same list the corner cards get). Only the ones sent to this person count."""
        mine = [i for i in items or () if i.get("directed")]
        if not mine:
            return
        self._alerts += len(mine)
        self._alert_href = mine[-1].get("href") or self._alert_href
        self._mode_at = time.monotonic()
        self._wake()

    def leave(self):
        """The central opens: the car drives off into the distance and the window hides."""
        if not self.isVisible() or (self._enter and self._enter[1] < 0):
            return
        self._alerts, self._alert_href = 0, None   # the central shows them now
        self._enter = (time.monotonic(), -1)
        self._wake()

    def arrive(self):
        """The central closed: the car drops back in and bounces."""
        self._enter = (time.monotonic(), +1)
        self._mode_at = time.monotonic()
        self.show()
        self._wake()

    # ------------------------------------------------------------ timing
    def _read_load(self):
        try:
            self._busy = os.getloadavg()[0] / max(1, os.cpu_count() or 1)
        except (OSError, AttributeError):   # Windows has no load average
            self._busy = 0.0

    def _wake(self):
        self._tick.setInterval(33)
        self.update()

    def _look(self, now: float) -> str:
        if self._alerts:
            return "alert"
        if self.mode == "wait":
            return "wait"
        if now < self._party_until:
            return "party"
        if self.mode == "work":
            return "work"
        if now - self._mode_at > 300:
            return "sleep"
        if self._gag is None and now >= self._next_gag and self._busy < 0.7:
            self._gag, self._gag_until = random.choice(("look", "beams", "rev", "honk")), now + 3.0
        if self._gag and now > self._gag_until:
            self._gag, self._next_gag = None, now + random.uniform(30, 70)
        return self._gag or "idle"

    FPS = {"alert": 5, "wait": 2, "party": 8, "work": 4, "sleep": 1, "idle": 2,
           "look": 4, "beams": 3, "rev": 10, "honk": 6}

    def _frame(self):
        if not self.isVisible():
            return
        now = time.monotonic()
        if self._enter:
            fps = 30
            if now - self._enter[0] > (0.7 if self._enter[1] > 0 else 0.35):
                gone = self._enter[1] < 0
                self._enter = None
                if gone:
                    self.hide()
                    return
        else:
            fps = self.FPS.get(self._look(now), 2)
            if self._busy > 1.0:
                fps = min(fps, 0.5)
            elif self._busy > 0.7:
                fps = min(fps, 2)
        ms = round(1000 / fps)
        if self._tick.interval() != ms:
            self._tick.setInterval(ms)
        self.update()

    # ------------------------------------------------------------ the car
    def _car_image(self, dpr: float) -> QImage:
        """The body, drawn once: black paint with a chrome line, glass, the grille with vertical chrome bars, the red
        AMG line, tyres. Eyes, mouth and lights are drawn live on top."""
        if self._body and self._body[1] == dpr:
            return self._body[0]
        img = QImage(round(CW * dpr), round(CH * dpr), QImage.Format_ARGB32_Premultiplied)
        img.setDevicePixelRatio(dpr)
        img.fill(Qt.transparent)
        p = QPainter(img)
        p.setRenderHint(QPainter.Antialiasing)
        p.setPen(Qt.NoPen)
        # tyres
        p.setBrush(QColor("#0b0c0e"))
        p.drawRoundedRect(QRectF(6, CH - 13, 15, 13), 3, 3)
        p.drawRoundedRect(QRectF(CW - 21, CH - 13, 15, 13), 3, 3)
        # cabin: chrome frame, dark glass, a streak of light
        cab = QPainterPath()
        cab.moveTo(20, 20)
        cab.lineTo(27, 4)
        cab.quadTo(CW / 2, 0, CW - 27, 4)
        cab.lineTo(CW - 20, 20)
        cab.closeSubpath()
        g = QLinearGradient(0, 0, 0, 20)
        g.setColorAt(0, CHROME_HI)
        g.setColorAt(1, CHROME_LO)
        p.setBrush(g)
        p.drawPath(cab)
        glass = QPainterPath()
        glass.moveTo(23.5, 19)
        glass.lineTo(29, 6)
        glass.quadTo(CW / 2, 2.5, CW - 29, 6)
        glass.lineTo(CW - 23.5, 19)
        glass.closeSubpath()
        g = QLinearGradient(0, 3, 0, 19)
        g.setColorAt(0, QColor("#3b4049"))
        g.setColorAt(1, QColor("#0d0f12"))
        p.setBrush(g)
        p.drawPath(glass)
        p.setBrush(QColor(255, 255, 255, 46))
        streak = QPainterPath()
        streak.moveTo(33, 6)
        streak.lineTo(39, 6)
        streak.lineTo(32, 18)
        streak.lineTo(27, 18)
        streak.closeSubpath()
        p.drawPath(streak)
        # body: wide and low, glossy black, a light rim
        body = QRectF(2, 18, CW - 4, CH - 26)
        g = QLinearGradient(0, body.top(), 0, body.bottom())
        g.setColorAt(0, BODY_HI)
        g.setColorAt(0.45, QColor("#121317"))
        g.setColorAt(1, BODY_LO)
        p.setBrush(g)
        p.drawRoundedRect(body, 11, 9)
        p.setPen(QPen(QColor(255, 255, 255, 70), 1.2))
        p.setBrush(Qt.NoBrush)
        p.drawRoundedRect(body.adjusted(0.6, 0.6, -0.6, -0.6), 10.5, 8.5)
        p.setPen(Qt.NoPen)
        # mirrors
        p.setBrush(BODY_HI)
        p.drawRoundedRect(QRectF(10, 15, 9, 5), 2, 2)
        p.drawRoundedRect(QRectF(CW - 19, 15, 9, 5), 2, 2)
        # the grille: chrome frame, vertical bars, a chrome badge
        gr = QRectF(CW / 2 - 13, 22, 26, 12)
        g = QLinearGradient(0, gr.top(), 0, gr.bottom())
        g.setColorAt(0, CHROME_HI)
        g.setColorAt(1, CHROME_LO)
        p.setBrush(g)
        p.drawRoundedRect(gr, 4, 4)
        p.setBrush(QColor("#050506"))
        p.drawRoundedRect(gr.adjusted(1.6, 1.6, -1.6, -1.6), 3, 3)
        p.setBrush(QColor(220, 224, 230, 210))
        for i in range(9):
            p.drawRect(QRectF(gr.left() + 3.2 + i * 2.35, gr.top() + 2.2, 1.0, gr.height() - 4.4))
        p.setBrush(CHROME_HI)
        p.drawEllipse(QPointF(gr.center().x(), gr.center().y()), 2.6, 2.6)
        # the red AMG line low on the bumper
        p.setBrush(RED)
        p.drawRoundedRect(QRectF(14, CH - 9.6, CW - 28, 1.5), 0.75, 0.75)
        p.end()
        self._body = (img, dpr)
        return img

    def paintEvent(self, _):
        now = time.monotonic()
        look = "idle" if self._enter else self._look(now)
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        # arriving drops in from above; leaving shrinks away into the distance
        dy, sc, op = 0.0, 1.0, 1.0
        if self._enter:
            u = min(1.0, (now - self._enter[0]) / (0.7 if self._enter[1] > 0 else 0.35))
            if self._enter[1] > 0:
                dy = -(1 - _bounce(u)) * 70
                op = min(1.0, u * 3)
            else:
                e = _ease_out(u)
                sc, dy, op = 1 - 0.85 * e, -26 * e, 1 - e
        shake = 0.0
        if look in ("work", "rev"):
            shake = 0.7 * math.sin(now * 47)
            bob = 0.5 * math.sin(now * 31)
        elif look == "sleep":
            bob = 2.0                                  # parked low
        elif look == "alert" and (now % 2.4) < 0.5:   # a hop to be seen
            bob = -9 * math.sin(math.pi * (now % 2.4) / 0.5)
        else:
            bob = 0.6 * math.sin(now * 2.2)
        p.setOpacity(op)
        cx = W / 2 + shake
        p.setPen(Qt.NoPen)                             # the shadow on the ground
        sh = max(0.35, 1 - abs(min(0.0, bob + dy)) / 60)
        p.setBrush(QColor(0, 0, 0, round(90 * sh)))
        p.drawEllipse(QPointF(W / 2, GROUND + 1), CW * 0.48 * sc * sh, 4.5 * sc)
        if look in ("work", "rev") and not self._enter:
            self._exhaust(p, now, cx, look == "rev")
        p.save()
        p.translate(cx, GROUND + dy + bob)
        p.scale(sc, sc)
        p.translate(-CW / 2, -CH)
        p.drawImage(QRectF(0, 0, CW, CH), self._car_image(self.devicePixelRatioF()))
        self._face(p, look, now)
        p.restore()
        if not self._enter:
            self._extras(p, look, now, cx, GROUND + bob)
        p.end()

    # ---- the face: the headlights are the eyes, the intake is the mouth
    def _face(self, p: QPainter, look: str, t: float):
        hazard = look in ("alert", "wait") and int(t * 2) % 2 == 0
        lit = look != "sleep"
        for side in (-1, 1):
            cx, cy = CW / 2 + side * 26, 28.5
            lamp = QPainterPath()                      # a slanted, sharp headlight
            lamp.moveTo(cx - 10 * side, cy - 3.5)
            lamp.lineTo(cx + 9 * side, cy - 5.5)
            lamp.quadTo(cx + 11 * side, cy + 1, cx + 6 * side, cy + 5)
            lamp.lineTo(cx - 8 * side, cy + 4)
            lamp.closeSubpath()
            p.setPen(QPen(QColor(255, 255, 255, 60), 0.8))
            p.setBrush(QColor("#0a0b0d"))
            p.drawPath(lamp)
            p.setPen(Qt.NoPen)
            if lit:
                if look == "beams":
                    glow = QRadialGradient(QPointF(cx, cy), 14)
                    glow.setColorAt(0, QColor(255, 255, 255, 170))
                    glow.setColorAt(1, QColor(255, 255, 255, 0))
                    p.setBrush(glow)
                    p.drawEllipse(QPointF(cx, cy), 14, 14)
                p.save()
                p.setClipPath(lamp)
                p.setBrush(EYE)
                p.drawRect(QRectF(cx - 10, cy - 6, 20, 2.2))   # the daytime-light brow
                p.drawEllipse(QPointF(cx + side * 0.5, cy + 0.5), 4.6, 4.2)
                look_x = 0.0
                if look == "look":
                    look_x = 2.2 * math.copysign(1, math.sin(t * 1.6))
                elif look == "alert":
                    look_x = -side * 0.8
                p.setBrush(QColor("#111216"))
                p.drawEllipse(QPointF(cx + side * 0.5 + look_x, cy + 1), 2.2, 2.4)
                p.setBrush(QColor(255, 255, 255, 230))
                p.drawEllipse(QPointF(cx + side * 0.5 + look_x + 0.9, cy - 0.2), 0.8, 0.8)
                p.restore()
                if (t % 5.3) < 0.13:                   # a blink
                    p.setBrush(BODY_HI)
                    p.drawRect(QRectF(cx - 7, cy - 4, 14, 8))
            else:                                      # asleep: lights off, a thin closed line
                p.setPen(QPen(QColor(234, 242, 255, 120), 1.2))
                p.drawLine(QPointF(cx - 5, cy + 1), QPointF(cx + 5, cy + 1))
                p.setPen(Qt.NoPen)
            if hazard:                                 # amber indicators at the outer corners
                p.setBrush(AMBER)
                p.drawRoundedRect(QRectF(cx + side * 9 - 2.5, cy + 1, 5, 3.5), 1.2, 1.2)
        mx, my = CW / 2, 37                          # the mouth: the lower intake
        if look in ("honk", "alert"):
            p.setBrush(QColor("#050506"))
            p.setPen(QPen(CHROME_LO, 1))
            p.drawEllipse(QPointF(mx, my + 0.5), 3.6, 2.8)   # «oh!»
            return
        m = QPainterPath()
        if look == "sleep":
            m.moveTo(mx - 6, my)
            m.lineTo(mx + 6, my)
        elif look == "wait":
            m.moveTo(mx - 6, my + 1)
            m.quadTo(mx, my - 1.5, mx + 6, my + 1)
        else:
            w = 9 if look in ("party", "rev", "beams") else 7
            m.moveTo(mx - w, my - 1.2)
            m.quadTo(mx, my + 4.5, mx + w, my - 1.2)
        p.setBrush(Qt.NoBrush)
        p.setPen(QPen(CHROME_HI, 1.4, Qt.SolidLine, Qt.RoundCap))
        p.drawPath(m)

    def _exhaust(self, p: QPainter, t: float, cx: float, strong: bool):
        n = 4 if strong else 2
        p.setPen(Qt.NoPen)
        for side in (-1, 1):
            for i in range(n):
                u = (t * (1.6 if strong else 0.9) + i / n) % 1.0
                r = 2 + u * (6 if strong else 4)
                p.setBrush(QColor(120, 124, 132, round((110 if strong else 70) * (1 - u))))
                p.drawEllipse(QPointF(cx + side * (CW / 2 - 6 + u * 16), GROUND - 4 - u * 12), r, r)

    def _waves(self, p: QPainter, cx: float, y: float, col: QColor, rings: int):
        p.setBrush(Qt.NoBrush)
        for side in (-1, 1):
            x = cx + side * (CW / 2 + 2)
            a0 = 120 * 16 if side < 0 else -60 * 16
            for i in range(rings):
                c = QColor(col)
                c.setAlpha(max(60, col.alpha() - 80 * i))
                r = 6 + 5 * i
                p.setPen(QPen(QColor(10, 10, 12, c.alpha() // 2), 4, Qt.SolidLine, Qt.RoundCap))   # a dark rim: reads on white
                p.drawArc(QRectF(x - r, y - r, 2 * r, 2 * r), a0, 120 * 16)
                p.setPen(QPen(c, 2, Qt.SolidLine, Qt.RoundCap))
                p.drawArc(QRectF(x - r, y - r, 2 * r, 2 * r), a0, 120 * 16)

    def _extras(self, p: QPainter, look: str, t: float, cx: float, ground: float):
        top = ground - CH
        f = QFont()
        f.setPixelSize(11)
        f.setBold(True)
        if look == "alert":                            # horn waves and the red count on the roof
            if int(t * 4) % 2 == 0:
                self._waves(p, cx, top + 26, QColor(227, 189, 107, 230), 2)
            n = str(min(self._alerts, 9)) + ("+" if self._alerts > 9 else "")
            b = QRectF(cx - 9, top - 14, 18, 16)
            p.setPen(QPen(QColor(0, 0, 0, 120), 2))
            p.setBrush(RED)
            p.drawRoundedRect(b, 8, 8)
            p.setPen(QColor("white"))
            p.setFont(f)
            p.drawText(b, Qt.AlignCenter, n)
        elif look == "party":
            self._flag(p, cx + 12, top - 16, t)
        elif look == "honk" and int(t * 6) % 2 == 0:
            self._waves(p, cx, top + 33, QColor(242, 243, 245, 210), 1)
        elif look == "sleep":
            p.setFont(f)
            u = (t * 0.25) % 1.0
            p.setPen(QColor(242, 243, 245, round(220 * math.sin(math.pi * u))))
            p.drawText(QPointF(cx + CW / 2 - 12 + u * 10, top + 2 - u * 16), "z")

    def _flag(self, p: QPainter, x: float, y: float, t: float):
        """A chequered flag on a chrome stick, waving."""
        p.setPen(QPen(CHROME_LO, 1.6))
        p.drawLine(QPointF(x, y), QPointF(x - 6, y + 30))
        s = 4
        p.setPen(Qt.NoPen)
        for cx in range(4):
            for cy in range(3):
                wave = 2 * math.sin(t * 9 - cx * 0.9)
                p.setBrush(QColor("#0b0c0e") if (cx + cy) % 2 else QColor("#f2f3f5"))
                p.drawRect(QRectF(x + 1 + cx * s, y + cy * s + wave, s, s))

    # ------------------------------------------------------------ drag and click
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
            return
        self._mode_at = time.monotonic()   # a click wakes it up
        if self._alerts:                   # it was calling: open what was sent
            href, self._alerts, self._alert_href = self._alert_href, 0, None
            if href and self.open_page:
                self.open_page(href)
                return
        if self.on_click:
            self.on_click()
