"""Farol, the widget's pet (16 Nov, Marco: «quero que o robôzinho seja mesmo assim... um Jarvis, o nosso cérebro»).

Marco's own drawing (assets/farol-*.png, cut from ~/Desktop/AMG/Robozin): a brushed-chrome robot on tracks, a headlight for a
face with big blue eyes, a helmet with the star, AMG on the plate. Three poses: idle (looking at you), think (hand on the
chin), work (wrench on a bolt). Like his GIF: it appears out of a blue ring, thinks, works, looks, and sinks back into it.

What it does (window.py calls `set_state`, `alert`, `leave`, `arrive`):
  * the central opens -> it sinks into the ring and is gone; it closes -> it rises out of the ring again;
  * a task or a message for this person -> a red count on the helmet, a hop now and then, and a small black card next to it
    saying who sent what; it stays until clicked (opens it) or closed with ×;
  * Claude starts -> it thinks a moment, then works with the wrench; Claude waits for you -> it says so;
    Claude finished -> «Pronto: ...»; back at the computer after a while -> a short briefing (what is waiting);
  * the mouse on it -> what it knows right now (messages, tasks, what the Claude is doing);
  * calm -> now and then it thinks; five quiet minutes -> eyes half shut, «z».

Weight (Marco: «roubar o mínimo de CPU e nunca afetar nada»): each pose is a pixmap scaled once; a still frame is one
drawPixmap. It repaints only when something changes: a blink every few seconds, the wrench 6 times a second while
Claude works, 30 frames a second only while it appears, disappears, hops or changes pose. Slower with the computer
busy, and the process runs at low priority (nice)."""
import ctypes
import math
import os
import random
import sys
import time
from pathlib import Path

from PySide6.QtCore import QPoint, QPointF, QRectF, Qt, QTimer
from PySide6.QtGui import QColor, QFont, QFontMetricsF, QImage, QPainter, QPen, QPixmap, QRadialGradient
from PySide6.QtWidgets import QApplication, QWidget

from . import prefs

ASSETS = Path(__file__).resolve().parents[1] / "assets"
SRC_W, SRC_H = 293, 320          # the pose images
RH = 124                         # the robot on screen (points)
RW = round(RH * SRC_W / SRC_H)
AW, AH = RW + 22, RH + 34        # the robot's area: room for the ring below and the count above
FLOOR = AH - 12                  # where the tracks stand
BW = 238                         # the card
GAP = 4

# where the eyes are in each pose image (the blue irises, found with a scan of the pictures)
EYES = {"idle": ((121, 102, 138, 117), (158, 101, 175, 117)),
        "think": ((164, 89, 177, 100), (202, 77, 214, 89)),
        "work": ((115, 130, 127, 143), (151, 136, 163, 150))}

BLUE = QColor("#4fc3ff")         # the ring of his GIF
RED = QColor("#ff3b30")
TEXT, MUTED = QColor("#f2f3f5"), QColor("#a3a7ae")
UI = "Helvetica Neue" if sys.platform == "darwin" else "Segoe UI"

STATE = {"think": "A pensar", "work": "A trabalhar", "idle": "A olhar", "sleep": "A descansar",
         "alert": "Para ti", "wait": "À tua espera"}


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


def _ease(u: float) -> float:
    return 1 - (1 - u) ** 3


def _plural(n: int, one: str, many: str) -> str:
    return f"{n} {one if n == 1 else many}"


class Pet(QWidget):
    def __init__(self, on_click, open_page=None):
        super().__init__(None, Qt.Tool | Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint | Qt.NoDropShadowWindowHint)
        self.setAttribute(Qt.WA_TranslucentBackground)
        self.setAttribute(Qt.WA_ShowWithoutActivating)
        self.setAttribute(Qt.WA_MacAlwaysShowToolWindow)   # on the Mac a tool window hides when the widget is not in front
        self.on_click, self.open_page = on_click, open_page
        self._src = {k: QImage(str(ASSETS / f"farol-{k}.png")) for k in EYES}
        self._pix = {}                        # pose -> (pixmap at this screen's pixel ratio, ratio)
        self._lid = {k: self._lid_colour(k) for k in EYES}
        # where the robot stands on the screen (its area's top-left); the window grows around it for the card
        g = QApplication.primaryScreen().availableGeometry()
        at = prefs.load().get("farol_at")
        self._at = QPoint(*at) if at else QPoint(g.right() - AW - 24, g.bottom() - AH - 24)
        self.mode, self.topic, self.live = "idle", "", {}
        now = time.monotonic()
        self._mode_at = now
        self._think_until = 0.0               # thinking a moment before working, and now and then when calm
        self._next_think = now + 45
        self._alerts = []                     # items sent to this person, newest last
        self._card = None                     # (header, text, href or None, until or None = until closed, kind)
        self._hover = False
        self._enter = None                    # (start, +1 appear / -1 leave)
        self._pose, self._from, self._pose_at = "idle", None, 0.0
        self._hop_at = 0.0
        self._next_blink = now + random.uniform(2.5, 5)
        self._busy = 0.0
        self._last_check, self._away = now, False
        self._press, self._moved, self._press_at = None, False, QPoint()
        self._robot_x = self._robot_y = 0
        self._x_rect = self._card_rect = QRectF()
        self._f_head = QFont(UI)
        self._f_head.setPixelSize(10)
        self._f_head.setBold(True)
        self._f_head.setLetterSpacing(QFont.AbsoluteSpacing, 1.2)
        self._f_text = QFont(UI)
        self._f_text.setPixelSize(12)
        self._load = QTimer(self)
        self._load.timeout.connect(self._check)
        self._load.start(4000)
        self._tick = QTimer(self)
        self._tick.setSingleShot(True)
        self._tick.timeout.connect(self._frame)
        if hasattr(os, "nice"):               # the widget always gives way to real work
            try:
                os.nice(10)
            except OSError:
                pass
        self._enter = (now, +1)
        self._layout()

    # ------------------------------------------------------------ from the widget
    def set_state(self, live: dict, person: dict):
        live = live or {}
        first = not self.live
        self.live = live
        topic = (live.get("topic") or "").strip()
        if live.get("working"):
            mode = "work"
        elif live.get("waiting") and live.get("wait") in ("permission", "answer"):
            mode = "wait"
        else:
            mode = "idle"
        if first:                             # the first news from the Hub: say hello with what is waiting
            self.topic = topic
            self._say("FAROL", self._briefing(first=True), None, 8, "info")
        if mode == self.mode:
            self.topic = topic or self.topic
            return
        now = time.monotonic()
        before, self.mode, self._mode_at = self.mode, mode, now
        if mode == "work":
            self._think_until = now + 4.0     # it thinks first, then picks up the wrench
        elif mode == "wait":
            what = "Pede autorização" if live.get("wait") == "permission" else "Espera pela tua resposta"
            self._say("O CLAUDE", what + (f": {topic}" if topic else "."), None, None, "wait")
        elif before == "work" and not first:
            self._say("PRONTO", topic or "O Claude acabou o que estava a fazer.", None, 9, "done")
        if before == "wait" and self._card and self._card[4] == "wait":
            self._card = None
            self._layout()
        self.topic = topic or self.topic
        self._schedule(0)

    def alert(self, items):
        """Tasks or messages arrived (the same list the corner cards get); only the ones sent to this person count."""
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
        self._say(head, text or "Tens uma coisa nova no Hub.", last.get("href"), None, "alert")
        self._hop_at = time.monotonic()
        self._schedule(0)

    def leave(self):
        """The central opens: Farol sinks into the ring and the window hides."""
        if not self.isVisible() or (self._enter and self._enter[1] < 0):
            return
        self._alerts, self._card, self._hover = [], None, False   # the central shows it all now
        self._enter = (time.monotonic(), -1)
        self._layout()
        self._schedule(0)

    def arrive(self):
        """The central closed: Farol rises out of the ring."""
        self._enter = (time.monotonic(), +1)
        self._mode_at = time.monotonic()
        self._layout()
        self.show()
        self._schedule(0)

    def showEvent(self, e):
        super().showEvent(e)
        self._schedule(0)

    # ------------------------------------------------------------ what it says
    def _briefing(self, first=False) -> str:
        m, t = self.live.get("messages") or 0, self.live.get("tasks") or 0
        lead = "Estou cá." if first else "Bem-vindo de volta."
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
        claude = ("a trabalhar" + (f" em «{self.topic}»" if self.topic else "")) if self.mode == "work" else \
            ("à tua espera" if self.mode == "wait" else "parado")
        return f"{_plural(m, 'mensagem', 'mensagens')} · {_plural(t, 'tarefa', 'tarefas')}\nClaude: {claude}"

    def _say(self, head: str, text: str, href, seconds, kind: str):
        self._card = (head, text, href, (time.monotonic() + seconds) if seconds else None, kind)
        self._layout()
        self._schedule(0)

    # ------------------------------------------------------------ the window around the robot and the card
    def _card_lines(self) -> list:
        if not self._card and not self._hover:
            return []
        text = self._card[1] if self._card else self._status()
        fm = QFontMetricsF(self._f_text)
        out = []
        for para in text.split("\n"):
            line = ""
            for w in para.split():
                trial = f"{line} {w}".strip()
                if fm.horizontalAdvance(trial) <= BW - 30 or not line:
                    line = trial
                else:
                    out.append(line)
                    line = w
            out.append(fm.elidedText(line, Qt.ElideRight, BW - 30))
        if len(out) > 4:
            out = out[:4]
            out[-1] = fm.elidedText(out[-1] + " …", Qt.ElideRight, BW - 30)
        return out

    def _layout(self):
        lines = [] if (self._enter and self._enter[1] < 0) else self._card_lines()
        screen = QApplication.screenAt(self._at + QPoint(AW // 2, AH // 2)) or QApplication.primaryScreen()
        g = screen.availableGeometry()
        if lines:
            ch = 36 + 16 * len(lines) + 8
            left = self._at.x() + AW / 2 > g.center().x()       # the card goes on the side with room
            w, h = AW + GAP + BW, max(AH, ch)
            self._robot_x = BW + GAP if left else 0
            self._robot_y = h - AH
            # the card sits level with the robot's head
            top = max(0.0, min(h - ch, self._robot_y + 14))
            self._card_rect = QRectF(0 if left else AW + GAP, top, BW, ch)
            self.setFixedSize(round(w), round(h))
            self.move(self._at.x() - round(self._robot_x), self._at.y() - round(self._robot_y))
        else:
            self._robot_x = self._robot_y = 0
            self._card_rect = QRectF()
            self.setFixedSize(AW, AH)
            self.move(self._at)
        self.update()

    # ------------------------------------------------------------ timing
    def _check(self):
        """Every 4 s: how busy the computer is, cards that ran out, and whether the person just came back."""
        now = time.monotonic()
        try:
            self._busy = os.getloadavg()[0] / max(1, os.cpu_count() or 1)
        except (OSError, AttributeError):
            self._busy = 0.0
        slept = now - self._last_check > 60          # the computer was asleep
        self._last_check = now
        idle = _idle_seconds()
        if idle > 600 or slept:
            self._away = True
        elif self._away and idle < 5:
            self._away = False
            self._mode_at = now
            if self.isVisible() and not (self._card and self._card[3] is None):
                self._say("FAROL", self._briefing(), None, 10, "info")
                self._hop_at = now
        if self._card and self._card[3] and now > self._card[3]:
            self._card = None
            self._layout()
        self._schedule(0)

    def _look(self, now: float) -> str:
        if self._alerts:
            return "alert"
        if self.mode == "work":
            return "think" if now < self._think_until else "work"
        if self.mode == "wait":
            return "wait"
        if now - self._mode_at > 300 and not self._card:
            return "sleep"
        if now >= self._next_think and self._busy < 0.7:
            self._think_until, self._next_think = now + 5.0, now + random.uniform(50, 110)
        return "think" if now < self._think_until else "idle"

    @staticmethod
    def _pose_of(look: str) -> str:
        return {"work": "work", "think": "think"}.get(look, "idle")

    def _schedule(self, ms=None):
        """The next repaint, as late as it can be (ms=0: now)."""
        if ms is None:
            now = time.monotonic()
            look = self._look(now)
            if self._enter or (self._from and now - self._pose_at < 0.35) or now - self._hop_at < 0.5:
                ms = 33
            elif look == "work" and self._busy < 0.9:
                ms = 400                      # the sparks at the wrench (each new frame costs the Mac a window flush)
            elif look == "alert":
                ms = max(33, min(1000, round((self._hop_at + 3.0 - now) * 1000)))
            elif look == "sleep":
                ms = 1500
            else:
                ms = max(33, min(3000, round((self._next_blink - now) * 1000)))
                if self._next_blink <= now:
                    ms = 140                  # the eyes open again
            if self._busy > 1.0:
                ms = max(ms, 1500)
        self._tick.start(ms)

    def _frame(self):
        now = time.monotonic()
        if self._enter and now - self._enter[0] > (0.75 if self._enter[1] > 0 else 0.45):
            gone = self._enter[1] < 0
            self._enter = None
            if gone:
                self.hide()
                return
        if not self.isVisible():
            return
        look = self._look(now)
        if look == "alert" and now - self._hop_at > 3.0:
            self._hop_at = now
        pose = self._pose_of(look)
        if pose != self._pose:
            self._from, self._pose, self._pose_at = self._pose, pose, now
        moving = (self._enter or (self._from and now - self._pose_at < 0.4) or now - self._hop_at < 0.6
                  or look == "sleep")
        if moving:
            self.update()
        elif look == "work":
            self.update(self._spark_rect())           # only the sparks change: a few pixels, not the robot
        else:
            self.update(self._eyes_rect())            # a blink: only the eyes
        if now > self._next_blink + 0.14:
            self._next_blink = now + random.uniform(3, 6)
        self._schedule()

    def _robot_rect(self) -> QRectF:
        return QRectF(self._robot_x + AW / 2 - RW / 2, self._robot_y + FLOOR - RH, RW, RH)

    def _spark_rect(self):
        r = self._robot_rect()
        sx, sy = r.width() / SRC_W, r.height() / SRC_H
        bx, by = r.left() + 150 * sx, r.top() + 218 * sy
        return QRectF(bx - 14, by - 14, 28, 22).toAlignedRect()

    def _eyes_rect(self):
        r = self._robot_rect()
        sx, sy = r.width() / SRC_W, r.height() / SRC_H
        (a, b, _, _), (_, _, c, d) = EYES[self._pose]
        top = min(b, EYES[self._pose][1][1])
        bottom = max(EYES[self._pose][0][3], d)
        return QRectF(r.left() + (a - 10) * sx, r.top() + (top - 12) * sy, (c - a + 20) * sx, (bottom - top + 24) * sy).toAlignedRect()

    # ------------------------------------------------------------ painting
    def _lid_colour(self, pose: str) -> QColor:
        """The colour of the headlight glass just outside the left eye, for the eyelids."""
        img = self._src[pose]
        x0, y0, x1, y1 = EYES[pose][0]
        return QColor.fromRgba(img.pixel(max(0, x0 - 9), (y0 + y1) // 2))

    def _pixmap(self, pose: str) -> QPixmap:
        dpr = self.devicePixelRatioF()
        got = self._pix.get(pose)
        if got and got[1] == dpr:
            return got[0]
        img = self._src[pose].scaled(round(RW * dpr), round(RH * dpr), Qt.KeepAspectRatio, Qt.SmoothTransformation)
        pix = QPixmap.fromImage(img)
        pix.setDevicePixelRatio(dpr)
        self._pix[pose] = (pix, dpr)
        return pix

    def paintEvent(self, _):
        now = time.monotonic()
        look = self._look(now)
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        p.setRenderHint(QPainter.SmoothPixmapTransform)
        if not self._card_rect.isNull():
            self._paint_card(p, look)
        p.translate(self._robot_x, self._robot_y)
        cx = AW / 2
        # appear: the blue ring opens, Farol rises out of it; leave: it sinks back and the ring closes
        rise, ring = 1.0, 0.0
        if self._enter:
            u = min(1.0, (now - self._enter[0]) / (0.75 if self._enter[1] > 0 else 0.45))
            if self._enter[1] > 0:
                ring = math.sin(math.pi * min(1.0, u * 1.15))
                rise = _ease(max(0.0, (u - 0.15) / 0.85))
            else:
                ring = math.sin(math.pi * min(1.0, 0.15 + u))
                rise = 1 - _ease(u)
        hop = 0.0
        if now - self._hop_at < 0.5 and not self._enter:
            hop = 10 * math.sin(math.pi * (now - self._hop_at) / 0.5)
        if ring > 0.01:
            self._paint_ring(p, cx, FLOOR, ring)
        if not self._enter:                                     # the shadow on the ground
            p.setPen(Qt.NoPen)
            sh = QRadialGradient(QPointF(cx, FLOOR), RW * 0.42)
            sh.setColorAt(0, QColor(0, 0, 0, max(30, 100 - round(hop * 5))))
            sh.setColorAt(1, QColor(0, 0, 0, 0))
            p.setBrush(sh)
            p.drawEllipse(QPointF(cx, FLOOR), RW * 0.42, 6)
        if rise <= 0.001:
            p.end()
            return
        top = FLOOR - RH * rise - hop
        p.save()
        if rise < 1.0:                                          # coming out of / going into the ring
            p.setClipRect(QRectF(0, 0, AW, FLOOR + 2))
        rect = QRectF(cx - RW / 2, FLOOR - RH - hop + (RH - RH * rise), RW, RH)
        fade = 1.0
        if self._from and now - self._pose_at < 0.35 and not self._enter:
            fade = (now - self._pose_at) / 0.35
            p.setOpacity(1 - fade)
            p.drawPixmap(rect, self._pixmap(self._from), QRectF())
            p.setOpacity(fade)
        p.drawPixmap(rect, self._pixmap(self._pose), QRectF())
        p.setOpacity(1.0)
        if fade >= 1.0:
            self._from = None
            blink = self._next_blink <= now <= self._next_blink + 0.14
            if (blink or look == "sleep") and not self._enter:
                self._paint_lids(p, rect, half=(look == "sleep" and not blink))
        p.restore()
        if look == "work" and self._busy < 0.9 and int(now * 2.5) % 2 == 0:
            self._paint_spark(p, rect, now)
        if self._alerts and not self._enter:
            self._paint_count(p, cx + RW * 0.26, top + 10)
        if look == "sleep":
            f = QFont(UI)
            f.setPixelSize(13)
            f.setBold(True)
            p.setFont(f)
            u = (now * 0.3) % 1.0
            p.setPen(QColor(230, 236, 244, round(220 * math.sin(math.pi * u))))
            p.drawText(QPointF(cx + RW * 0.3 + u * 8, top + 14 - u * 14), "z")
        p.end()

    def _paint_ring(self, p: QPainter, cx: float, y: float, k: float):
        """The hologram ring on the floor, as in his GIF."""
        rx, ry = RW * 0.62 * (0.4 + 0.6 * k), 8 * (0.4 + 0.6 * k)
        glow = QRadialGradient(QPointF(cx, y), rx)
        glow.setColorAt(0, QColor(79, 195, 255, round(90 * k)))
        glow.setColorAt(1, QColor(79, 195, 255, 0))
        p.setPen(Qt.NoPen)
        p.setBrush(glow)
        p.drawEllipse(QPointF(cx, y), rx, ry * 1.6)
        c = QColor(BLUE)
        c.setAlpha(round(230 * k))
        p.setPen(QPen(c, 2.2))
        p.setBrush(QColor(8, 20, 30, round(160 * k)))
        p.drawEllipse(QPointF(cx, y), rx, ry)
        c.setAlpha(round(120 * k))
        p.setPen(QPen(c, 1))
        p.setBrush(Qt.NoBrush)
        p.drawEllipse(QPointF(cx, y), rx * 0.8, ry * 0.7)

    def _paint_lids(self, p: QPainter, rect: QRectF, half: bool):
        """Eyelids in the colour of the headlight glass; half shut when asleep."""
        sx, sy = rect.width() / SRC_W, rect.height() / SRC_H
        col = self._lid[self._pose]
        for x0, y0, x1, y1 in EYES[self._pose]:
            ecx, ecy = rect.left() + (x0 + x1) / 2 * sx, rect.top() + (y0 + y1) / 2 * sy
            rx, ry = ((x1 - x0) / 2 + 7) * sx, ((y1 - y0) / 2 + 9) * sy
            p.save()
            if half:
                p.setClipRect(QRectF(ecx - rx - 1, ecy - ry - 1, 2 * rx + 2, ry + 2))
            p.setPen(Qt.NoPen)
            p.setBrush(col)
            p.drawEllipse(QPointF(ecx, ecy), rx, ry)
            p.restore()
            p.setPen(QPen(QColor(40, 36, 32, 200), 1.3, Qt.SolidLine, Qt.RoundCap))
            y = ecy if half else ecy + ry * 0.2
            p.drawLine(QPointF(ecx - rx * 0.7, y), QPointF(ecx + rx * 0.7, y))

    def _paint_spark(self, p: QPainter, rect: QRectF, t: float):
        """A few sparks where the wrench meets the bolt."""
        sx, sy = rect.width() / SRC_W, rect.height() / SRC_H
        bx, by = rect.left() + 150 * sx, rect.top() + 218 * sy
        rnd = random.Random(int(t * 2.5))
        p.setPen(Qt.NoPen)
        for _ in range(3):
            a = rnd.uniform(-2.6, -0.5)
            d = rnd.uniform(4, 10)
            p.setBrush(QColor(255, 214, 120, 230) if rnd.random() < 0.6 else QColor(79, 195, 255, 220))
            p.drawEllipse(QPointF(bx + math.cos(a) * d, by + math.sin(a) * d), 1.3, 1.3)

    def _paint_count(self, p: QPainter, x: float, y: float):
        n = len(self._alerts)
        b = QRectF(x - 9, y - 9, 18, 18)
        p.setPen(QPen(QColor(0, 0, 0, 140), 2))
        p.setBrush(RED)
        p.drawEllipse(b)
        f = QFont(UI)
        f.setPixelSize(11)
        f.setBold(True)
        p.setFont(f)
        p.setPen(QColor("white"))
        p.drawText(b, Qt.AlignCenter, str(n) if n < 10 else "9+")

    def _paint_card(self, p: QPainter, look: str):
        """The card, in the widget's black glass: what it is about / what Farol is doing, then what it has to say."""
        r = self._card_rect
        lines = self._card_lines()
        if not lines:
            return
        head = self._card[0] if self._card else "FAROL"
        p.setPen(Qt.NoPen)
        for i, a in ((3, 16), (1.5, 26)):
            p.setBrush(QColor(0, 0, 0, a))
            p.drawRoundedRect(r.translated(0, i), 14, 14)
        p.setBrush(QColor(16, 17, 20, 242))
        p.setPen(QPen(QColor(255, 255, 255, 30), 1))
        p.drawRoundedRect(r, 14, 14)
        x = r.left() + 14
        p.setFont(self._f_head)
        p.setPen(QColor(RED) if (self._card and self._card[4] == "alert") else TEXT)
        p.drawText(QRectF(x, r.top() + 9, BW - 110, 14), Qt.AlignLeft | Qt.AlignVCenter, head)
        f = QFont(self._f_head)
        f.setBold(False)
        f.setLetterSpacing(QFont.AbsoluteSpacing, 0.3)
        p.setFont(f)
        p.setPen(QColor(143, 211, 255))
        p.drawText(QRectF(r.right() - 110, r.top() + 9, 110 - (30 if self._card else 14), 14),
                   Qt.AlignRight | Qt.AlignVCenter, STATE.get(look, ""))
        p.setPen(QPen(QColor(255, 255, 255, 26), 1))
        p.drawLine(QPointF(x, r.top() + 29), QPointF(r.right() - 14, r.top() + 29))
        p.setFont(self._f_text)
        p.setPen(TEXT)
        for i, line in enumerate(lines):
            p.drawText(QRectF(x, r.top() + 35 + 16 * i, BW - 28, 16), Qt.AlignLeft | Qt.AlignVCenter, line)
        if self._card:                                          # × closes
            self._x_rect = QRectF(r.right() - 24, r.top() + 8, 16, 16)
            p.setPen(QPen(MUTED, 1.4, Qt.SolidLine, Qt.RoundCap))
            c = self._x_rect.center()
            p.drawLine(c + QPointF(-3.5, -3.5), c + QPointF(3.5, 3.5))
            p.drawLine(c + QPointF(-3.5, 3.5), c + QPointF(3.5, -3.5))
        else:
            self._x_rect = QRectF()

    # ------------------------------------------------------------ mouse
    def enterEvent(self, e):
        if not self._card and not self._enter:
            self._hover = True
            self._layout()

    def leaveEvent(self, e):
        if self._hover:
            self._hover = False
            self._layout()

    def mousePressEvent(self, e):
        if e.button() == Qt.LeftButton:
            self._press, self._moved, self._press_at = e.globalPosition().toPoint(), False, QPoint(self._at)

    def mouseMoveEvent(self, e):
        if self._press is not None:
            d = e.globalPosition().toPoint() - self._press
            if d.manhattanLength() > 3 or self._moved:
                self._moved = True
                self._at = self._press_at + d
                self.move(self._at.x() - round(self._robot_x), self._at.y() - round(self._robot_y))

    def mouseReleaseEvent(self, e):
        if self._press is None:
            return
        self._press = None
        if self._moved:
            prefs.save(farol_at=[self._at.x(), self._at.y()])
            self._layout()
            return
        pos = e.position()
        self._mode_at = time.monotonic()                        # a click wakes it up
        if self._card and self._x_rect.contains(pos):           # × : just close the card
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
