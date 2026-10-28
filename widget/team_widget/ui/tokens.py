"""The token central: every Claude window of the team in one window of its own, live (23 Oct, Marco: «quero ver, naquela
janela com aquele nome, está a gastar aquilo... tem que ser uma central de controlo, realmente»).

The Hub reads a working window's tokens from its transcript at most every 10 s (office.py, TOKENS_EVERY); the widget
asks for them every 4 s while this window or the Tokens view is open, and TokenTracker (window.py) keeps what it saw,
so each window shows how fast it spends now (tokens per minute over the last minute and a half), what it just spent,
and its curve since the central opened. Painted by hand: no web engine, and nothing draws between two looks at the Hub.
"""
import time

from PySide6.QtCore import QPointF, QRectF, QSettings, Qt
from PySide6.QtGui import QColor, QFont, QFontMetricsF, QGuiApplication, QIcon, QLinearGradient, QPainter, QPainterPath, QPen
from PySide6.QtWidgets import QScrollArea, QVBoxLayout, QWidget

from .window import (cut, cut_path, COLORS, DISPLAY, FAINT, LOGO, MUTED, TEXT, UI, badge, font, glow_disc, meter_color, pen, platter, rgba, studio,
                     tokens_text)

GREEN = COLORS["WORKING"]
SIZE = (860, 640)
PERSON_TINT = {"owner": "#9db7ff", "mark": "#f2f3f5", "david": "#c9a7ff"}   # one quiet tint per partner, for their chip


def rate_text(per_min: float) -> str:
    return f"{tokens_text(per_min)}/min" if per_min >= 1 else "—"


def spark(p: QPainter, r: QRectF, points: list, colour: str, fill=True):
    """A small curve of the tokens over time (cumulative), filled underneath."""
    if len(points) < 2:
        p.setPen(QPen(QColor(255, 255, 255, 30), 1, Qt.DashLine))
        p.drawLine(QPointF(r.left(), r.bottom() - 1), QPointF(r.right(), r.bottom() - 1))
        return
    t0, t1 = points[0][0], points[-1][0]
    v0, v1 = min(v for _, v in points), max(v for _, v in points)
    span_t, span_v = max(1e-6, t1 - t0), max(1, v1 - v0)
    path = QPainterPath()
    for i, (t, v) in enumerate(points):
        at = QPointF(r.left() + r.width() * (t - t0) / span_t, r.bottom() - 1 - (r.height() - 2) * (v - v0) / span_v)
        path.moveTo(at) if i == 0 else path.lineTo(at)
    if fill:
        area = QPainterPath(path)
        area.lineTo(r.right(), r.bottom())
        area.lineTo(r.left(), r.bottom())
        area.closeSubpath()
        g = QLinearGradient(0, r.top(), 0, r.bottom())
        g.setColorAt(0, rgba(colour, 0.32))
        g.setColorAt(1, rgba(colour, 0))
        p.setPen(Qt.NoPen)
        p.setBrush(g)
        p.drawPath(area)
    p.setBrush(Qt.NoBrush)
    p.setPen(pen(QColor(colour), 1.6))
    p.drawPath(path)


class Header(QWidget):
    """The team at a glance: tokens of the last 24 h, the speed right now, and one card per partner."""
    H = 236

    def __init__(self):
        super().__init__()
        self.setFixedHeight(self.H)
        self.people, self.tracker = [], None
        self._f_cap, self._f_big, self._f_mid = font(7.5, QFont.Bold, UI, spacing=1.0), font(30, QFont.DemiBold, DISPLAY), font(13, QFont.DemiBold, DISPLAY)
        self._f_name, self._f_small = font(9.5, QFont.DemiBold, UI), font(8, QFont.Normal, UI)

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        w = self.width()
        tr = self.tracker
        total = sum((x.get("tokens") or 0) for x in self.people)
        speed = sum(tr.rate(win.get("key")) for x in self.people for win in x.get("token_windows") or []) if tr else 0
        # the two big figures
        for i, (cap, value, colour) in enumerate((("EQUIPA · ÚLTIMAS 24 H", tokens_text(total), TEXT),
                                                   ("A GASTAR AGORA", rate_text(speed), GREEN if speed >= 1 else MUTED))):
            box = QRectF(24 + i * 250, 16, 240, 70)
            p.setPen(QColor(MUTED))
            p.setFont(self._f_cap)
            p.drawText(QRectF(box.left(), box.top(), box.width(), 14), Qt.AlignLeft | Qt.AlignVCenter, cap)
            p.setPen(QColor(colour))
            p.setFont(self._f_big)
            p.drawText(QRectF(box.left(), box.top() + 14, box.width(), 48), Qt.AlignLeft | Qt.AlignVCenter, value)
            if i == 1 and speed >= 1:   # the live light
                glow_disc(p, QPointF(box.left() - 10, box.top() + 7), 7, 7, GREEN, 0.5)
                p.setPen(Qt.NoPen)
                p.setBrush(QColor(GREEN))
                p.drawEllipse(QPointF(box.left() - 10, box.top() + 7), 3, 3)
        # the team's curve since this central has been watching
        chart = QRectF(524, 22, w - 548, 62)
        p.setPen(QColor(MUTED))
        p.setFont(self._f_cap)
        p.drawText(QRectF(chart.left(), 4, chart.width(), 14), Qt.AlignLeft | Qt.AlignVCenter, "TOKENS DESDE QUE A CENTRAL ABRIU")
        spark(p, chart, list(tr.team) if tr else [], "#f2f3f5")
        # one card per partner
        n = max(1, len(self.people))
        cw = (w - 48 - (n - 1) * 12) / n
        for i, person in enumerate(self.people):
            card = QRectF(24 + i * (cw + 12), 104, cw, 116)
            platter(p, card, 16)
            name = person.get("name") or ""
            tint = PERSON_TINT.get(person.get("user"), TEXT)
            p.setPen(QColor(tint))
            p.setFont(self._f_name)
            p.drawText(QRectF(card.left() + 14, card.top() + 10, cw - 28, 18), Qt.AlignLeft | Qt.AlignVCenter, name)
            live = person.get("working") or 0
            p.setPen(QColor(GREEN if live else FAINT))
            p.setFont(self._f_small)
            p.drawText(QRectF(card.left() + 14, card.top() + 10, cw - 28, 18), Qt.AlignRight | Qt.AlignVCenter,
                       f"{live} a trabalhar" if live else "parado")
            p.setPen(QColor(TEXT))
            p.setFont(self._f_mid)
            p.drawText(QRectF(card.left() + 14, card.top() + 32, cw - 28, 24), Qt.AlignLeft | Qt.AlignVCenter, tokens_text(person.get("tokens")))
            mine = sum(tr.rate(win.get("key")) for win in person.get("token_windows") or []) if tr else 0
            p.setPen(QColor(GREEN if mine >= 1 else FAINT))
            p.setFont(self._f_small)
            p.drawText(QRectF(card.left() + 14, card.top() + 32, cw - 28, 24), Qt.AlignRight | Qt.AlignVCenter, rate_text(mine))
            # the plan: the 5 h session and the week as two bars
            plan = person.get("limits") or {}
            for j, (key, label) in enumerate((("five", "Claude 5 h"), ("week", "Semana"))):
                pct = plan.get(key)
                y = card.top() + 66 + j * 22
                p.setPen(QColor(MUTED))
                p.drawText(QRectF(card.left() + 14, y, 70, 14), Qt.AlignLeft | Qt.AlignVCenter, label)
                p.setPen(QColor(TEXT) if pct is not None else QColor(FAINT))
                p.drawText(QRectF(card.right() - 54, y, 40, 14), Qt.AlignRight | Qt.AlignVCenter, "—" if pct is None else f"{round(pct)}%")
                track = QRectF(card.left() + 84, y + 5, cw - 84 - 62, 4)
                p.setPen(Qt.NoPen)
                p.setBrush(QColor(255, 255, 255, 18))
                cut(p, track, 2, 2)
                if pct:
                    p.setBrush(QColor(meter_color(pct)))
                    cut(p, QRectF(track.left(), track.top(), max(4.0, track.width() * min(1.0, pct / 100)), 4), 2, 2)


class WindowList(QWidget):
    """Every Claude window of the last day, one row each: whose it is, what it is about, what it does now, its curve,
    how fast it spends, what it just spent and how much in all. Working ones first, the fastest on top."""
    ROW = 54

    def __init__(self):
        super().__init__()
        self.rows, self.tracker = [], None
        self._f_who, self._f_topic, self._f_meta = font(7, QFont.Bold, UI, spacing=0.6), font(9.5, QFont.DemiBold, UI), font(8, QFont.Normal, UI)
        self._f_num, self._f_rate, self._f_head = font(11, QFont.DemiBold, DISPLAY), font(9, QFont.DemiBold, DISPLAY), font(7.5, QFont.Bold, UI, spacing=1.0)

    def set(self, people: list, tracker):
        self.tracker = tracker
        rows = [{**win, "user": person.get("user"), "name": person.get("name")} for person in people for win in person.get("token_windows") or []]
        order = {"working": 0, "waiting": 1}
        rows.sort(key=lambda r: (order.get(r.get("state"), 2), -tracker.rate(r.get("key")), -(r.get("tokens") or 0)))
        self.rows = rows
        self.setFixedHeight(28 + self.ROW * max(1, len(rows)))
        self.update()

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        w = self.width()
        cols = {"spark": w - 400, "rate": w - 270, "delta": w - 180, "total": w - 24}
        p.setPen(QColor(FAINT))
        p.setFont(self._f_head)
        for text, x, align in (("JANELA", 64, Qt.AlignLeft), ("ÚLTIMOS MINUTOS", cols["spark"], Qt.AlignLeft),
                               ("AGORA", cols["rate"], Qt.AlignLeft), ("ACABOU DE GASTAR", cols["delta"], Qt.AlignLeft)):
            p.drawText(QRectF(x, 4, 160, 16), align | Qt.AlignVCenter, text)
        p.drawText(QRectF(cols["total"] - 100, 4, 100, 16), Qt.AlignRight | Qt.AlignVCenter, "24 H")
        if not self.rows:
            p.setPen(QColor(MUTED))
            p.setFont(self._f_meta)
            p.drawText(QRectF(24, 28, w - 48, self.ROW), Qt.AlignLeft | Qt.AlignVCenter, "Nenhuma janela do Claude nas últimas 24 h.")
            return
        tr = self.tracker
        for i, r in enumerate(self.rows):
            y = 28 + i * self.ROW
            row = QRectF(16, y + 3, w - 32, self.ROW - 6)
            working = r.get("state") == "working"
            rate = tr.rate(r.get("key")) if tr else 0
            p.setPen(Qt.NoPen)
            p.setBrush(QColor(255, 255, 255, 14 if working else 7))
            cut(p, row, 12, 12)
            colour = GREEN if working else COLORS["WAITING"] if r.get("state") == "waiting" else "#5b5f65"
            dot = QPointF(row.left() + 20, row.center().y())
            if working:
                glow_disc(p, dot, 10, 10, colour, 0.4)
            p.setBrush(QColor(colour))
            p.drawEllipse(dot, 4, 4)
            # whose, what about, what now
            left, room = row.left() + 48, cols["spark"] - row.left() - 64
            who = (r.get("name") or "").upper()
            p.setFont(self._f_who)
            p.setPen(QColor(PERSON_TINT.get(r.get("user"), TEXT)))
            ww = QFontMetricsF(self._f_who).horizontalAdvance(who) + 8
            p.drawText(QRectF(left, row.top() + 6, ww, 18), Qt.AlignLeft | Qt.AlignVCenter, who)
            p.setFont(self._f_topic)
            p.setPen(QColor(TEXT) if working or r.get("state") == "waiting" else QColor(MUTED))
            topic = r.get("topic") or r.get("project") or "Janela do Claude"
            p.drawText(QRectF(left + ww, row.top() + 6, room - ww, 18), Qt.AlignLeft | Qt.AlignVCenter,
                       QFontMetricsF(self._f_topic).elidedText(topic, Qt.ElideRight, room - ww))
            meta = " · ".join(x for x in (r.get("project"), (r.get("model") or "").replace("claude-", ""), r.get("action")) if x)
            p.setFont(self._f_meta)
            p.setPen(QColor(MUTED))
            p.drawText(QRectF(left, row.top() + 25, room, 16), Qt.AlignLeft | Qt.AlignVCenter,
                       QFontMetricsF(self._f_meta).elidedText(meta, Qt.ElideRight, room))
            # its curve, its speed, what it just spent, its total
            spark(p, QRectF(cols["spark"], row.top() + 10, 110, row.height() - 20), tr.points(r.get("key")) if tr else [],
                  GREEN if rate >= 1 else "#8d9198")
            p.setFont(self._f_rate)
            p.setPen(QColor(GREEN if rate >= 1 else FAINT))
            p.drawText(QRectF(cols["rate"], row.top(), 90, row.height()), Qt.AlignLeft | Qt.AlignVCenter, rate_text(rate))
            jump = tr.jump(r.get("key")) if tr else 0
            p.setPen(QColor(GREEN if jump else FAINT))
            p.drawText(QRectF(cols["delta"], row.top(), 90, row.height()), Qt.AlignLeft | Qt.AlignVCenter,
                       f"+{tokens_text(jump)}" if jump else "—")
            p.setFont(self._f_num)
            p.setPen(QColor(TEXT))
            p.drawText(QRectF(cols["total"] - 100, row.top(), 100, row.height()), Qt.AlignRight | Qt.AlignVCenter, tokens_text(r.get("tokens")))


class Backdrop(QWidget):
    def paintEvent(self, _):
        p = QPainter(self)
        studio(p, QRectF(self.rect()))


class TokenCenter(QWidget):
    """The window: the header with the team, then every window in a list that scrolls. Its place and size are kept."""

    def __init__(self):
        super().__init__(None, Qt.Window)
        self.setWindowTitle("Central de tokens · Agente AMG")
        if LOGO.exists():
            self.setWindowIcon(QIcon(str(LOGO)))
        self.setMinimumSize(720, 420)
        back = Backdrop(self)
        col = QVBoxLayout(self)
        col.setContentsMargins(0, 0, 0, 0)
        col.setSpacing(0)
        self._back = back
        self.header = Header()
        col.addWidget(self.header)
        self.list = WindowList()
        scroll = QScrollArea()
        scroll.setWidget(self.list)
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QScrollArea.NoFrame)
        scroll.setStyleSheet("QScrollArea { background: transparent; } QScrollArea > QWidget > QWidget { background: transparent; }"
                             "QScrollBar:vertical { background: transparent; width: 8px; margin: 4px; }"
                             "QScrollBar::handle:vertical { background: rgba(255,255,255,40); border-radius: 3px; min-height: 30px; }"
                             "QScrollBar::add-line, QScrollBar::sub-line { height: 0; }")
        col.addWidget(scroll, 1)
        self._settings = QSettings("AgenteAMG", "widget")
        saved = self._settings.value("tokens/geometry")
        if saved is None or not self.restoreGeometry(saved):
            screen = QGuiApplication.primaryScreen().availableGeometry()
            self.setGeometry(screen.center().x() - SIZE[0] // 2, screen.center().y() - SIZE[1] // 2, *SIZE)

    def resizeEvent(self, e):
        self._back.setGeometry(self.rect())
        super().resizeEvent(e)

    def show_data(self, live: dict | None, tracker):
        people = (live or {}).get("people") or []
        self.header.people, self.header.tracker = people, tracker
        self.header.update()
        self.list.set(people, tracker)

    def open(self):
        self.show()
        self.raise_()
        self.activateWindow()

    def closeEvent(self, e):
        self._settings.setValue("tokens/geometry", self.saveGeometry())
        super().closeEvent(e)


_ = (time, badge)   # imported for the module's readers: the AMG badge and the clock live in window.py
