"""The widget's own video player, shown inside the Hub window when a video is opened there.

The Hub runs in Qt's Chromium, which has no H.264: MP4s would not play and the page could crash. Here the video goes
through Qt Multimedia (FFmpeg, decoded on the GPU), with the controls of a small editor: a timeline you drag with the
time under the cursor, jumps of 5 and 10 s, frame steps, an A-B loop, speed, volume, the whole playlist beside it,
and full screen. The playhead moves at the monitor's refresh rate (never below 144 Hz), like the rest of the widget.

Keys: Space/K play · J/L 10 s · ←/→ 5 s · , . one frame · ↑/↓ volume · M mute · 0-9 jump to 0-90 %
      I/O loop in/out · X clear loop · N/P next/previous · F or double-click full screen · Esc back to the Hub
"""
import json
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

from PySide6.QtCore import QElapsedTimer, QPointF, QRectF, QSize, Qt, QTimer, QUrl, Signal
from PySide6.QtGui import QColor, QFont, QFontMetricsF, QImage, QPainter, QPainterPath, QPixmap
from PySide6.QtMultimedia import QAudioOutput, QMediaMetaData, QMediaPlayer
from PySide6.QtMultimediaWidgets import QVideoWidget
from PySide6.QtNetwork import QNetworkAccessManager, QNetworkRequest
from PySide6.QtWidgets import (QAbstractButton, QComboBox, QHBoxLayout, QLabel, QLineEdit, QListWidget, QListWidgetItem,
                               QSlider, QVBoxLayout, QWidget)

from .motion import FrameClock, clock

BG = "#070708"
PANEL = "#0e0f11"
LINE = "rgba(255,255,255,0.08)"
TEXT = "#eef0f2"
MUTED = "#8b9096"
SPEEDS = (0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0)


def tc(ms: float, precise=True) -> str:
    """1:05.3 (or 1:02:05.3 past an hour)."""
    s = max(0.0, ms / 1000)
    h, m, sec = int(s // 3600), int(s % 3600 // 60), s % 60
    body = f"{m:02d}:{int(sec):02d}" if h else f"{m}:{int(sec):02d}"
    return (f"{h}:" if h else "") + body + (f".{int(sec * 10) % 10}" if precise else "")


def local_file(url: str) -> QUrl | None:
    """The file behind a Hub media URL when the Hub is on this computer: from disk a video starts at once,
    over HTTP Qt's FFmpeg spends many seconds probing it. None when the Hub is elsewhere or does not know."""
    parts = urlsplit(url)
    if parts.hostname not in ("127.0.0.1", "localhost", "::1") or not parts.path.endswith("/media"):
        return None
    try:
        with urllib.request.urlopen(urlunsplit(parts._replace(path=parts.path[:-len("media")] + "path")), timeout=2) as res:
            path = Path(json.load(res)["path"])
    except (OSError, ValueError, KeyError):
        return None
    return QUrl.fromLocalFile(str(path)) if path.is_file() else None


def ui_font(size, weight=QFont.Normal) -> QFont:
    f = QFont()
    f.setFamilies(["Segoe UI Variable Text", "Segoe UI"])
    f.setPointSizeF(size)
    f.setWeight(weight)
    return f


class Glyph(QAbstractButton):
    """A round transport button drawn in chrome; `big` for play/pause. Never takes focus, so Space stays with the player."""

    def __init__(self, glyph, tip, big=False):
        super().__init__()
        self.glyph, self.big, self._hover = glyph, big, False
        self.setToolTip(tip)
        self.setFocusPolicy(Qt.NoFocus)
        self.setCursor(Qt.PointingHandCursor)
        self.setFixedSize(QSize(46, 46) if big else QSize(36, 36))

    def enterEvent(self, _):
        self._hover = True
        self.update()

    def leaveEvent(self, _):
        self._hover = False
        self.update()

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        w, h = self.width(), self.height()
        on = self.isEnabled()
        if self.big:
            p.setBrush(QColor(238, 240, 242) if self._hover else QColor(214, 218, 222))
        else:
            p.setBrush(QColor(255, 255, 255, 26 if self._hover else (12 if self.isChecked() else 0)))
        p.setPen(Qt.NoPen)
        p.drawEllipse(QRectF(1, 1, w - 2, h - 2))
        ink = QColor(10, 10, 12) if self.big else QColor(255, 255, 255, (235 if self._hover or self.isChecked() else 190) if on else 60)
        p.setBrush(ink)
        p.setPen(Qt.NoPen)
        cx, cy, k = w / 2, h / 2, (1.25 if self.big else 1.0)
        g = self.glyph

        def tri(x, y, s, left=False):
            path = QPainterPath()
            if left:
                path.moveTo(x + s * .55, y - s * .62)
                path.lineTo(x + s * .55, y + s * .62)
                path.lineTo(x - s * .55, y)
            else:
                path.moveTo(x - s * .45, y - s * .62)
                path.lineTo(x - s * .45, y + s * .62)
                path.lineTo(x + s * .65, y)
            path.closeSubpath()
            p.drawPath(path)

        if g == "play":
            tri(cx + 1, cy, 9 * k)
        elif g == "pause":
            p.drawRoundedRect(QRectF(cx - 7 * k, cy - 7.5 * k, 4.5 * k, 15 * k), 1.2, 1.2)
            p.drawRoundedRect(QRectF(cx + 2.5 * k, cy - 7.5 * k, 4.5 * k, 15 * k), 1.2, 1.2)
        elif g in ("prev", "next"):
            left = g == "prev"
            tri(cx + (2 if left else -2), cy, 8, left)
            p.drawRect(QRectF(cx - 7 if left else cx + 5, cy - 6, 2, 12))
        elif g in ("frame-", "frame+"):
            left = g == "frame-"
            tri(cx + (2.5 if left else -2.5), cy, 6, left)
            p.drawRect(QRectF(cx + 3 if left else cx - 5, cy - 5, 2, 10))
        elif g in ("-10", "-5", "+5", "+10"):
            p.setPen(ink)
            p.setFont(ui_font(8.2, QFont.DemiBold))
            p.drawText(self.rect(), Qt.AlignCenter, g)
        elif g in ("full", "window"):
            p.setBrush(Qt.NoBrush)
            p.setPen(ink)
            a, b = (cx - 7, cy - 7), (cx + 7, cy + 7)
            d = 4 if g == "full" else -4
            for x, y, sx, sy in ((a[0], a[1], 1, 1), (b[0], a[1], -1, 1), (a[0], b[1], 1, -1), (b[0], b[1], -1, -1)):
                ox, oy = (x, y) if g == "full" else (x + sx * 4, y + sy * 4)
                p.drawLine(QPointF(ox, oy), QPointF(ox + sx * d * (1 if g == "full" else -1), oy))
                p.drawLine(QPointF(ox, oy), QPointF(ox, oy + sy * d * (1 if g == "full" else -1)))
        elif g in ("vol", "mute"):
            path = QPainterPath()
            path.moveTo(cx - 8, cy - 3)
            path.lineTo(cx - 4, cy - 3)
            path.lineTo(cx + 1, cy - 8)
            path.lineTo(cx + 1, cy + 8)
            path.lineTo(cx - 4, cy + 3)
            path.lineTo(cx - 8, cy + 3)
            path.closeSubpath()
            p.drawPath(path)
            p.setBrush(Qt.NoBrush)
            p.setPen(ink)
            if g == "mute":
                p.drawLine(QPointF(cx + 4, cy - 4), QPointF(cx + 10, cy + 4))
                p.drawLine(QPointF(cx + 10, cy - 4), QPointF(cx + 4, cy + 4))
            else:
                p.drawArc(QRectF(cx - 3, cy - 6, 10, 12), -50 * 16, 100 * 16)
        elif g == "loop":
            p.setBrush(Qt.NoBrush)
            p.setPen(ink)
            p.drawRoundedRect(QRectF(cx - 8, cy - 5, 16, 10), 5, 5)
            tri(cx + 3, cy - 5, 3.5)
        elif g == "back":
            p.setBrush(Qt.NoBrush)
            p.setPen(ink)
            p.drawLine(QPointF(cx - 6, cy - 6), QPointF(cx + 6, cy + 6))
            p.drawLine(QPointF(cx + 6, cy - 6), QPointF(cx - 6, cy + 6))


class Timeline(QWidget):
    """A thick scrub bar: drag anywhere, the time under the cursor floats above it, A-B loop shaded, ticks every 10 %."""
    seek = Signal(float)   # ms

    def __init__(self):
        super().__init__()
        self.setFixedHeight(46)
        self.setMouseTracking(True)
        self.setCursor(Qt.PointingHandCursor)
        self.duration = 0.0
        self.position = 0.0
        self.loop = (None, None)
        self._hover_x = None
        self._dragging = False

    def _ms_at(self, x: float) -> float:
        bar = self._bar()
        return max(0.0, min(1.0, (x - bar.left()) / max(1.0, bar.width()))) * self.duration

    def _bar(self) -> QRectF:
        return QRectF(8, 28, self.width() - 16, 8)

    def mousePressEvent(self, e):
        if e.button() == Qt.LeftButton and self.duration:
            self._dragging = True
            self.seek.emit(self._ms_at(e.position().x()))

    def mouseMoveEvent(self, e):
        self._hover_x = e.position().x()
        if self._dragging:
            self.seek.emit(self._ms_at(self._hover_x))
        self.update()

    def mouseReleaseEvent(self, _):
        self._dragging = False

    def leaveEvent(self, _):
        self._hover_x = None
        self.update()

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        bar = self._bar()
        hot = self._hover_x is not None or self._dragging
        if hot:
            bar.adjust(0, -2, 0, 2)
        p.setPen(Qt.NoPen)
        p.setBrush(QColor(255, 255, 255, 30))
        p.drawRoundedRect(bar, bar.height() / 2, bar.height() / 2)
        if not self.duration:
            return
        x_of = lambda ms: bar.left() + bar.width() * min(1.0, ms / self.duration)
        a, b = self.loop
        if a is not None:
            p.setBrush(QColor(227, 189, 107, 70))
            p.drawRect(QRectF(x_of(a), bar.top() - 4, x_of(b if b is not None else self.duration) - x_of(a), bar.height() + 8))
        done = QRectF(bar.left(), bar.top(), x_of(self.position) - bar.left(), bar.height())
        p.setBrush(QColor(236, 238, 240))
        p.drawRoundedRect(done, bar.height() / 2, bar.height() / 2)
        p.setBrush(QColor(255, 255, 255, 40))
        for i in range(1, 10):
            x = bar.left() + bar.width() * i / 10
            p.drawRect(QRectF(x - .5, bar.bottom() + 3, 1, 4))
        knob = QPointF(x_of(self.position), bar.center().y())
        p.setBrush(QColor(255, 255, 255))
        p.drawEllipse(knob, 8 if hot else 6, 8 if hot else 6)
        if self._hover_x is not None:
            ms = self._ms_at(self._hover_x)
            text = tc(ms)
            p.setFont(ui_font(8.5, QFont.DemiBold))
            w = QFontMetricsF(p.font()).horizontalAdvance(text) + 16
            x = max(0.0, min(self.width() - w, self._hover_x - w / 2))
            p.setBrush(QColor(20, 21, 24, 240))
            p.setPen(QColor(255, 255, 255, 40))
            p.drawRoundedRect(QRectF(x, 0, w, 20), 6, 6)
            p.setPen(QColor(TEXT))
            p.drawText(QRectF(x, 0, w, 20), Qt.AlignCenter, text)
            p.setPen(QColor(255, 255, 255, 120))
            p.drawLine(QPointF(self._hover_x, bar.top() - 3), QPointF(self._hover_x, bar.bottom() + 3))


class VideoPlayer(QWidget):
    closed = Signal()               # back to the Hub
    fullscreen = Signal(bool)       # the Hub window should cover the whole monitor (or come back)

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setFocusPolicy(Qt.StrongFocus)
        self.setAttribute(Qt.WA_StyledBackground)
        self.setStyleSheet(f"""
            VideoPlayer {{ background: {BG}; }}
            QLabel {{ color: {TEXT}; background: transparent; }}
            QLabel#muted {{ color: {MUTED}; }}
            QLineEdit {{ background: {PANEL}; color: {TEXT}; border: 1px solid {LINE}; border-radius: 9px; padding: 7px 10px; }}
            QListWidget {{ background: transparent; border: none; outline: none; color: {TEXT}; }}
            QListWidget::item {{ border-radius: 10px; padding: 6px; margin: 2px 0; }}
            QListWidget::item:hover {{ background: rgba(255,255,255,0.05); }}
            QListWidget::item:selected {{ background: rgba(255,255,255,0.11); color: white; }}
            QComboBox {{ background: {PANEL}; color: {TEXT}; border: 1px solid {LINE}; border-radius: 8px; padding: 4px 8px; }}
            QComboBox QAbstractItemView {{ background: {PANEL}; color: {TEXT}; selection-background-color: #2a2d31; }}
            QSlider::groove:horizontal {{ height: 4px; background: rgba(255,255,255,0.15); border-radius: 2px; }}
            QSlider::sub-page:horizontal {{ background: #e6e8ea; border-radius: 2px; }}
            QSlider::handle:horizontal {{ width: 12px; margin: -5px 0; background: white; border-radius: 6px; }}
            QScrollBar:vertical {{ width: 8px; background: transparent; }}
            QScrollBar::handle:vertical {{ background: rgba(255,255,255,0.14); border-radius: 4px; min-height: 30px; }}
            QScrollBar::add-line, QScrollBar::sub-line {{ height: 0; }}
        """)
        self.items, self.index, self.fps = [], 0, 30.0
        self.loop_in = self.loop_out = None
        self._full = False

        self.audio = QAudioOutput(self)
        self.audio.setVolume(0.8)
        self.media = QMediaPlayer(self)
        self.media.setAudioOutput(self.audio)
        self.screen_ = QVideoWidget()
        self.screen_.setStyleSheet("background: black;")
        self.screen_.setAttribute(Qt.WA_TransparentForMouseEvents)
        self.media.setVideoOutput(self.screen_)

        # the playhead is drawn from the last position the decoder reported plus the time since, every frame
        self._pos_ms, self._pos_clock = 0.0, QElapsedTimer()
        self._pos_clock.start()
        self._ticker = QTimer(self)
        self._ticker.setTimerType(Qt.PreciseTimer)
        self._ticker.timeout.connect(self._tick)
        self.media.positionChanged.connect(self._on_position)
        self.media.durationChanged.connect(lambda d: (setattr(self.timeline, "duration", float(d)), self._paint_time()))
        self.media.playbackStateChanged.connect(self._on_state)
        self.media.mediaStatusChanged.connect(self._on_status)
        self.media.metaDataChanged.connect(self._on_meta)
        self.media.errorOccurred.connect(lambda _e, msg: self._set_status(f"Não deu para abrir este vídeo: {msg}"))
        self.media.bufferProgressChanged.connect(lambda v: self._set_status("A carregar…" if v < 1 else ""))

        self._net = QNetworkAccessManager(self)

        # ---- head: name, details, counter, back
        self.name = QLabel()
        self.name.setFont(ui_font(13, QFont.DemiBold))
        self.meta = QLabel()
        self.meta.setObjectName("muted")
        self.meta.setFont(ui_font(9))
        self.meta.setTextInteractionFlags(Qt.TextSelectableByMouse)
        self.count = QLabel()
        self.count.setObjectName("muted")
        self.count.setFont(ui_font(9.5, QFont.DemiBold))
        back = Glyph("back", "Voltar ao Hub (Esc)")
        back.clicked.connect(self.close_player)
        titles = QVBoxLayout()
        titles.setSpacing(2)
        titles.addWidget(self.name)
        titles.addWidget(self.meta)
        self.head = QWidget()
        head = QHBoxLayout(self.head)
        head.setContentsMargins(20, 12, 12, 8)
        head.addLayout(titles, 1)
        head.addWidget(self.count)
        head.addSpacing(10)
        head.addWidget(back)

        # ---- stage: the picture, with a quiet status line over it
        self.status = QLabel(self.screen_)
        self.status.setFont(ui_font(10, QFont.DemiBold))
        self.status.setStyleSheet("background: rgba(0,0,0,0.6); color: white; border-radius: 8px; padding: 6px 12px;")
        self.status.hide()
        self.osd = QLabel(self.screen_)    # what a key just did: "+5 s", "1.5×", "Volume 60 %"
        self.osd.setFont(ui_font(16, QFont.DemiBold))
        self.osd.setStyleSheet("background: rgba(0,0,0,0.55); color: white; border-radius: 12px; padding: 10px 18px;")
        self.osd.hide()
        self._osd_timer = QTimer(self, singleShot=True, interval=700, timeout=self.osd.hide)

        # ---- controls
        self.timeline = Timeline()
        self.timeline.seek.connect(self.seek)
        self.cur = QLabel("0:00.0")
        self.cur.setFont(ui_font(10, QFont.DemiBold))
        self.total = QLabel("0:00.0")
        self.total.setObjectName("muted")
        self.total.setFont(ui_font(10))
        self.frame_no = QLabel("")
        self.frame_no.setObjectName("muted")
        self.frame_no.setFont(ui_font(8.5))

        self.b_prev, self.b_next = Glyph("prev", "Vídeo anterior (P)"), Glyph("next", "Vídeo seguinte (N)")
        self.b_play = Glyph("play", "Play / pausa (Espaço)", big=True)
        self.b_prev.clicked.connect(lambda: self.open_index(self.index - 1))
        self.b_next.clicked.connect(lambda: self.open_index(self.index + 1))
        self.b_play.clicked.connect(self.toggle)
        jumps = []
        for g, d, tip in (("-10", -10000, "Recuar 10 s (J)"), ("-5", -5000, "Recuar 5 s (←)"),
                          ("frame-", None, "Frame anterior (,)"), ("frame+", None, "Frame seguinte (.)"),
                          ("+5", 5000, "Avançar 5 s (→)"), ("+10", 10000, "Avançar 10 s (L)")):
            b = Glyph(g, tip)
            b.clicked.connect((lambda d=d: self.skip(d)) if d else (lambda f=(g == "frame+"): self.step(1 if f else -1)))
            jumps.append(b)
        self.b_loop = Glyph("loop", "Repetir um trecho: I marca o início, O o fim, X limpa")
        self.b_loop.setCheckable(True)
        self.b_loop.clicked.connect(self._loop_button)
        self.speed = QComboBox()
        self.speed.setFocusPolicy(Qt.NoFocus)
        self.speed.setToolTip("Velocidade ([ e ])")
        for s in SPEEDS:
            self.speed.addItem(f"{s:g}×", s)
        self.speed.setCurrentIndex(SPEEDS.index(1.0))
        self.speed.currentIndexChanged.connect(lambda i: self.media.setPlaybackRate(SPEEDS[i]))
        self.b_mute = Glyph("vol", "Som (M)")
        self.b_mute.clicked.connect(self.toggle_mute)
        self.vol = QSlider(Qt.Horizontal)
        self.vol.setFocusPolicy(Qt.NoFocus)
        self.vol.setRange(0, 100)
        self.vol.setValue(80)
        self.vol.setFixedWidth(96)
        self.vol.valueChanged.connect(self._volume)
        self.b_full = Glyph("full", "Ecrã inteiro (F)")
        self.b_full.clicked.connect(self.toggle_full)

        transport = QHBoxLayout()
        transport.setSpacing(4)
        transport.addWidget(self.cur)
        transport.addWidget(QLabel("/"))
        transport.addWidget(self.total)
        transport.addSpacing(8)
        transport.addWidget(self.frame_no)
        transport.addStretch(1)
        transport.addWidget(self.b_prev)
        for b in jumps[:3]:
            transport.addWidget(b)
        transport.addWidget(self.b_play)
        for b in jumps[3:]:
            transport.addWidget(b)
        transport.addWidget(self.b_next)
        transport.addStretch(1)
        transport.addWidget(self.b_loop)
        transport.addWidget(self.speed)
        transport.addSpacing(6)
        transport.addWidget(self.b_mute)
        transport.addWidget(self.vol)
        transport.addWidget(self.b_full)

        self.controls = QWidget()
        box = QVBoxLayout(self.controls)
        box.setContentsMargins(16, 0, 16, 12)
        box.setSpacing(2)
        box.addWidget(self.timeline)
        box.addLayout(transport)

        main = QVBoxLayout()
        main.setContentsMargins(0, 0, 0, 0)
        main.setSpacing(0)
        main.addWidget(self.head)
        main.addWidget(self.screen_, 1)
        main.addWidget(self.controls)

        # ---- the playlist
        self.side = QWidget()
        self.side.setFixedWidth(330)
        self.side.setAttribute(Qt.WA_StyledBackground)
        self.side.setStyleSheet(f"background: {PANEL}; border-left: 1px solid {LINE};")
        self.filter = QLineEdit()
        self.filter.setPlaceholderText("Procurar vídeo…")
        self.filter.textChanged.connect(self._filter)
        self.list = QListWidget()
        self.list.setIconSize(QSize(112, 63))
        self.list.setFocusPolicy(Qt.NoFocus)
        self.list.setVerticalScrollMode(QListWidget.ScrollPerPixel)
        self.list.itemClicked.connect(lambda it: self.open_index(it.data(Qt.UserRole)))
        self.auto = QLabel()
        self.auto.setObjectName("muted")
        self.auto.setFont(ui_font(8.5))
        self.auto.setText("No fim passa ao seguinte")
        side = QVBoxLayout(self.side)
        side.setContentsMargins(12, 14, 8, 12)
        side.setSpacing(8)
        title = QLabel("LISTA")
        title.setObjectName("muted")
        title.setFont(ui_font(8, QFont.DemiBold))
        side.addWidget(title)
        side.addWidget(self.filter)
        side.addWidget(self.list, 1)
        side.addWidget(self.auto)

        row = QHBoxLayout(self)
        row.setContentsMargins(0, 0, 0, 0)
        row.setSpacing(0)
        row.addLayout(main, 1)
        row.addWidget(self.side)

    # ------------------------------------------------------------ opening

    def open_playlist(self, payload: str):
        data = json.loads(payload)
        self.items = data.get("items") or []
        self.list.clear()
        for i, it in enumerate(self.items):
            row = QListWidgetItem(f"{it['name']}\n{it.get('meta', '')}")
            row.setData(Qt.UserRole, i)
            row.setSizeHint(QSize(0, 76))
            row.setIcon(self._blank_icon())
            self.list.addItem(row)
            if it.get("poster"):
                self._load_poster(i, it["poster"])
        self.filter.clear()
        self.open_index(int(data.get("index", 0)))
        self.setFocus()

    def _blank_icon(self):
        pm = QPixmap(112, 63)
        pm.fill(QColor(0, 0, 0))
        return pm

    def _load_poster(self, i, url):
        reply = self._net.get(QNetworkRequest(QUrl(url)))

        def done():
            img = QImage()
            if reply.error() == reply.NetworkError.NoError and img.loadFromData(reply.readAll()) and i < self.list.count():
                big = img.scaled(224, 126, Qt.KeepAspectRatioByExpanding, Qt.SmoothTransformation)   # fill, then crop the middle
                pm = QPixmap.fromImage(big.copy((big.width() - 224) // 2, (big.height() - 126) // 2, 224, 126))
                pm.setDevicePixelRatio(2)
                self.list.item(i).setIcon(pm)
            reply.deleteLater()
        reply.finished.connect(done)

    def open_index(self, i: int):
        if not (0 <= i < len(self.items)):
            return
        self.index = i
        self.loop_in = self.loop_out = None
        self.b_loop.setChecked(False)
        it = self.items[i]
        self.name.setText(it["name"])
        self.meta.setText(it.get("meta", ""))
        self.count.setText(f"{i + 1} / {len(self.items)}")
        self.b_prev.setEnabled(i > 0)
        self.b_next.setEnabled(i < len(self.items) - 1)
        self.list.setCurrentRow(i)
        self.list.scrollToItem(self.list.item(i))
        self.fps = 30.0
        self._pos_ms = 0.0
        self.timeline.duration = 0.0
        self._set_status("A abrir…")
        self.media.setSource(local_file(it["url"]) or QUrl(it["url"]))
        self.media.setPlaybackRate(SPEEDS[self.speed.currentIndex()])
        self.media.play()

    def close_player(self):
        if self._full:
            self.toggle_full()
        self.media.stop()
        self.media.setSource(QUrl())   # lets go of the file and the decoder
        self._ticker.stop()
        self.closed.emit()

    # ------------------------------------------------------------ transport

    def toggle(self):
        if self.media.playbackState() == QMediaPlayer.PlayingState:
            self.media.pause()
        else:
            if self.media.mediaStatus() == QMediaPlayer.EndOfMedia:
                self.media.setPosition(0)
            self.media.play()

    def now(self) -> float:
        """Where the picture is, between the decoder's reports."""
        if self.media.playbackState() == QMediaPlayer.PlayingState:
            return min(self.timeline.duration or 1e12, self._pos_ms + self._pos_clock.elapsed() * self.media.playbackRate())
        return self._pos_ms

    def seek(self, ms: float):
        ms = max(0.0, min(ms, self.timeline.duration or ms))
        self.media.setPosition(int(ms))
        self._on_position(int(ms))

    def skip(self, delta_ms: float):
        self.seek(self.now() + delta_ms)
        self._show_osd(f"{'+' if delta_ms > 0 else '−'}{abs(delta_ms) / 1000:g} s")

    def step(self, frames: int):
        self.media.pause()
        self.seek(self.now() + frames * 1000 / self.fps)

    def toggle_mute(self):
        self.audio.setMuted(not self.audio.isMuted())
        self.b_mute.glyph = "mute" if self.audio.isMuted() else "vol"
        self.b_mute.update()
        self._show_osd("Sem som" if self.audio.isMuted() else f"Volume {self.vol.value()} %")

    def _volume(self, v):
        self.audio.setVolume(v / 100)
        if self.audio.isMuted() and v:
            self.toggle_mute()

    def toggle_full(self):
        self._full = not self._full
        self.head.setVisible(not self._full)
        self.side.setVisible(not self._full)
        self.b_full.glyph = "window" if self._full else "full"
        self.b_full.update()
        self.fullscreen.emit(self._full)

    def _loop_button(self):
        if self.loop_in is None:
            self.loop_in = self.now()
            self._show_osd("Início do trecho")
        elif self.loop_out is None:
            self.loop_out = self.now() if self.now() > self.loop_in else None
            self._show_osd("Trecho a repetir" if self.loop_out else "O fim tem de vir depois do início")
        else:
            self.loop_in = self.loop_out = None
            self._show_osd("Sem repetição")
        self.b_loop.setChecked(self.loop_in is not None)
        self.timeline.loop = (self.loop_in, self.loop_out)
        self.timeline.update()

    # ------------------------------------------------------------ media events

    def _on_position(self, ms):
        self._pos_ms = float(ms)
        self._pos_clock.restart()
        if self.loop_out is not None and ms >= self.loop_out:
            self.seek(self.loop_in or 0)
            return
        if self.media.playbackState() != QMediaPlayer.PlayingState:
            self._paint_time()

    def _on_state(self, state):
        playing = state == QMediaPlayer.PlayingState
        self.b_play.glyph = "pause" if playing else "play"
        self.b_play.update()
        self._pos_clock.restart()
        if playing and self.isVisible():
            clock().start()   # 1 ms Windows timers, so the playhead lands on every refresh
            self._ticker.start(max(1, int(1000 / FrameClock.target_fps())))
        else:
            self._ticker.stop()
            self._paint_time()

    def _on_status(self, status):
        if status in (QMediaPlayer.LoadedMedia, QMediaPlayer.BufferedMedia):
            self._set_status("")
            self._on_meta()
        elif status == QMediaPlayer.InvalidMedia:
            self._set_status("Este vídeo não abre (ficheiro estragado ou formato desconhecido).")
        elif status == QMediaPlayer.EndOfMedia:
            if self.loop_in is not None:
                self.seek(self.loop_in)
                self.media.play()
            elif self.index < len(self.items) - 1:
                self.open_index(self.index + 1)

    def _on_meta(self):
        md = self.media.metaData()

        def get(key):
            try:   # PySide cannot convert some values (the codec enum raises RuntimeError)
                return md.value(key)
            except RuntimeError:
                return None
        try:
            self.fps = float(get(QMediaMetaData.VideoFrameRate) or 0) or 30.0
        except (TypeError, ValueError):
            self.fps = 30.0
        res, bits = get(QMediaMetaData.Resolution), []
        if res is not None and not res.isEmpty():
            bits.append(f"{res.width()}×{res.height()}")
        bits.append(f"{self.fps:.3g} fps")
        rate = get(QMediaMetaData.VideoBitRate)
        if rate:
            bits.append(f"{int(rate) / 1e6:.1f} Mb/s")
        base = self.items[self.index].get("meta", "") if self.items else ""
        self.meta.setText(" · ".join(bits + ([base] if base else [])))

    def _tick(self):
        if not self.isVisible():
            self._ticker.stop()
            return
        self._paint_time()

    def _paint_time(self):
        ms = self.now()
        self.timeline.position = ms
        self.timeline.update()
        self.cur.setText(tc(ms))
        self.total.setText(tc(self.timeline.duration))
        self.frame_no.setText(f"frame {int(ms / 1000 * self.fps)}")

    # ------------------------------------------------------------ text over the picture

    def _set_status(self, text):
        self.status.setText(text)
        self.status.adjustSize()
        self.status.move(16, 16)
        self.status.setVisible(bool(text))

    def _show_osd(self, text):
        self.osd.setText(text)
        self.osd.adjustSize()
        self.osd.move((self.screen_.width() - self.osd.width()) // 2, (self.screen_.height() - self.osd.height()) // 2)
        self.osd.show()
        self.osd.raise_()
        self._osd_timer.start()

    def _filter(self, text):
        q = text.lower().strip()
        for r in range(self.list.count()):
            self.list.item(r).setHidden(bool(q) and q not in self.items[r]["name"].lower())

    # ------------------------------------------------------------ keys and mouse

    def mouseDoubleClickEvent(self, e):
        if self.screen_.geometry().contains(e.position().toPoint()):
            self.toggle_full()

    def mousePressEvent(self, e):
        if e.button() == Qt.LeftButton and self.screen_.geometry().contains(e.position().toPoint()):
            self.toggle()
        self.setFocus()

    def wheelEvent(self, e):
        if self.screen_.geometry().contains(e.position().toPoint()):
            self.vol.setValue(self.vol.value() + (5 if e.angleDelta().y() > 0 else -5))
            self._show_osd(f"Volume {self.vol.value()} %")

    def keyPressEvent(self, e):
        k, t = e.key(), e.text().lower()
        if self.filter.hasFocus() and k != Qt.Key_Escape:
            return super().keyPressEvent(e)
        if k == Qt.Key_Escape:
            self.toggle_full() if self._full else self.close_player()
        elif k in (Qt.Key_Space, Qt.Key_K):
            self.toggle()
        elif k == Qt.Key_Left:
            self.skip(-5000)
        elif k == Qt.Key_Right:
            self.skip(5000)
        elif k == Qt.Key_J:
            self.skip(-10000)
        elif k == Qt.Key_L:
            self.skip(10000)
        elif t == ",":
            self.step(-1)
        elif t == ".":
            self.step(1)
        elif k == Qt.Key_Up:
            self.vol.setValue(self.vol.value() + 5)
            self._show_osd(f"Volume {self.vol.value()} %")
        elif k == Qt.Key_Down:
            self.vol.setValue(self.vol.value() - 5)
            self._show_osd(f"Volume {self.vol.value()} %")
        elif k == Qt.Key_M:
            self.toggle_mute()
        elif k == Qt.Key_F:
            self.toggle_full()
        elif k == Qt.Key_N:
            self.open_index(self.index + 1)
        elif k == Qt.Key_P:
            self.open_index(self.index - 1)
        elif k == Qt.Key_Home:
            self.seek(0)
        elif k == Qt.Key_End:
            self.seek(max(0.0, self.timeline.duration - 1000 / self.fps))
        elif t in ("[", "]"):
            i = max(0, min(len(SPEEDS) - 1, self.speed.currentIndex() + (1 if t == "]" else -1)))
            self.speed.setCurrentIndex(i)
            self._show_osd(f"{SPEEDS[i]:g}×")
        elif k == Qt.Key_I:
            self.loop_in, self.loop_out = self.now(), None
            self.b_loop.setChecked(True)
            self.timeline.loop = (self.loop_in, None)
            self._show_osd("Início do trecho")
        elif k == Qt.Key_O and self.loop_in is not None and self.now() > self.loop_in:
            self.loop_out = self.now()
            self.timeline.loop = (self.loop_in, self.loop_out)
            self._show_osd("Trecho a repetir")
        elif k == Qt.Key_X:
            self.loop_in = self.loop_out = None
            self.b_loop.setChecked(False)
            self.timeline.loop = (None, None)
            self._show_osd("Sem repetição")
        elif Qt.Key_0 <= k <= Qt.Key_9:
            self.seek(self.timeline.duration * (k - Qt.Key_0) / 10)
        else:
            return super().keyPressEvent(e)
        self.timeline.update()


if __name__ == "__main__":   # python -m team_widget.ui.player <video url or file> [...]
    import sys

    from PySide6.QtWidgets import QApplication

    app = QApplication(sys.argv)
    urls = [a if "://" in a else QUrl.fromLocalFile(str(Path(a).resolve())).toString() for a in sys.argv[1:]]
    w = VideoPlayer()
    w.closed.connect(app.quit)
    w.resize(1400, 860)
    w.show()
    w.open_playlist(json.dumps({"index": 0, "items": [{"name": u.rsplit("/", 1)[-1], "url": u} for u in urls]}))
    app.exec()
