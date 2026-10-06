"""The Hub inside the command center: maximizing grows the widget into a large window and the Hub appears in it.

HubExpander starts exactly on top of the widget, grows to a large centered window on the screen the widget is on, then shows the Hub.
Minimizing (the button, Esc or the taskbar) shrinks it back onto the widget and hands control back to it.
Once open it is a normal window: drag the bar to move it (to another monitor too), drag any edge or corner to resize,
double-click the bar or use the middle button to switch between full screen and a smaller window.

    expander = HubExpander()
    expander.collapsed.connect(widget.show_panel)
    expander.expand(widget.frameGeometry(), url)   # then hide the widget
"""
import os

# GPU raster and zero-copy for the embedded Hub: Chromium blocks many laptop GPUs by default and falls back to
# software painting, which is what made scrolling and clicks feel heavy. Must be set before the web engine starts.
os.environ.setdefault("QTWEBENGINE_CHROMIUM_FLAGS",
                      "--ignore-gpu-blocklist --enable-gpu-rasterization --enable-zero-copy --enable-smooth-scrolling")

from PySide6.QtCore import QElapsedTimer, QEasingCurve, QEvent, QFile, QIODevice, QObject, QRect, QRectF, Qt, QTimer, QUrl, Signal, Slot
from PySide6.QtGui import QColor, QDesktopServices, QGuiApplication, QPainter, QPainterPath, QPen
from PySide6.QtWebChannel import QWebChannel
from PySide6.QtWebEngineCore import QWebEnginePage, QWebEngineScript
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWidgets import QHBoxLayout, QStackedWidget, QVBoxLayout, QWidget

from .motion import FrameClock, clock
from .player import VideoPlayer

BG = QColor(7, 7, 8)
GROW_MS = 460
SHRINK_MS = 320
EDGE = 6           # px around the Hub that resize the window
WINDOWED = (0.72, 0.8)   # size of the "smaller window" as a share of the screen


class Ghost(QWidget):
    """The shape that grows and shrinks. Resizing the real window every frame makes Chromium lay the Hub out
    60+ times a second, which is what stuttered; this one only repaints a rounded rectangle on a still window,
    at the monitor's refresh rate (never below 144 Hz, like the rest of the widget)."""

    def __init__(self):
        super().__init__(None, Qt.Tool | Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint | Qt.WindowTransparentForInput)
        self.setAttribute(Qt.WA_TranslucentBackground)
        self.setAttribute(Qt.WA_ShowWithoutActivating)
        self._rect = QRectF()
        self._timer = QTimer(self)
        self._timer.setTimerType(Qt.PreciseTimer)
        self._timer.timeout.connect(self._step)
        self._clock = QElapsedTimer()

    def run(self, start: QRect, end: QRect, ms: int, curve, done):
        area = start.united(end)
        self.setGeometry(area)
        self._from = QRectF(start.translated(-area.topLeft()))
        self._to = QRectF(end.translated(-area.topLeft()))
        self._rect, self._ms, self._curve, self._done = self._from, ms, QEasingCurve(curve), done
        self.show()
        clock().start()  # 1 ms Windows timer resolution, else frames land every 15.6 ms
        self._clock.start()
        self._timer.start(max(1, int(1000 / FrameClock.target_fps())))

    def _step(self):
        t = min(1.0, self._clock.elapsed() / self._ms)
        k, a, b = self._curve.valueForProgress(t), self._from, self._to
        self._rect = QRectF(a.x() + (b.x() - a.x()) * k, a.y() + (b.y() - a.y()) * k,
                            a.width() + (b.width() - a.width()) * k, a.height() + (b.height() - a.height()) * k)
        self.repaint()
        if t >= 1.0:
            self._timer.stop()
            self._done()

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        path = QPainterPath()
        path.addRoundedRect(self._rect.adjusted(.5, .5, -.5, -.5), 14, 14)
        p.fillPath(path, BG)
        p.setPen(QPen(QColor(255, 255, 255, 34), 1))
        p.drawPath(path)


class Bridge(QObject):
    """What the Hub page can ask of the widget (as `amg` over QWebChannel): today, playing videos in the native player."""
    play = Signal(str)

    @Slot(str)
    def playVideos(self, payload: str):
        self.play.emit(payload)


def _channel_script() -> QWebEngineScript:
    """Qt's qwebchannel.js, run before the Hub's own scripts so `QWebChannel` exists when app.js starts."""
    f = QFile(":/qtwebchannel/qwebchannel.js")
    f.open(QIODevice.ReadOnly)
    script = QWebEngineScript()
    script.setName("amg-webchannel")
    script.setSourceCode(bytes(f.readAll()).decode("utf-8"))
    script.setInjectionPoint(QWebEngineScript.DocumentCreation)
    script.setWorldId(QWebEngineScript.MainWorld)
    script.setRunsOnSubFrames(False)
    return script


class DragBar(QWidget):
    """Moves the window like a title bar; double-click switches full screen / smaller window."""

    def __init__(self, on_double_click):
        super().__init__()
        self._on_double_click = on_double_click

    def mousePressEvent(self, e):
        if e.button() == Qt.LeftButton:
            self.window().begin_move(e.globalPosition().toPoint())

    def mouseDoubleClickEvent(self, e):
        if e.button() == Qt.LeftButton:
            self._on_double_click()


class HubExpander(QWidget):
    collapsed = Signal()   # back to the widget size: show the widget again

    def __init__(self):
        super().__init__(None, Qt.Window | Qt.FramelessWindowHint)
        self.setWindowTitle("Agente AMG")
        self._origin = QRect()
        self._busy = False
        self._full = True
        self.setMouseTracking(True)
        self.setMinimumSize(720, 480)

        from .window import IconButton, caption  # the same title bar as the command center

        bar = DragBar(self.toggle_size)
        bar.setFixedHeight(40)
        bar.setAttribute(Qt.WA_StyledBackground)
        bar.setStyleSheet("background:#070708;")
        shrink = IconButton("hide", "Minimizar")
        shrink.clicked.connect(self.collapse)
        size = IconButton("hub", "Ecrã inteiro / janela")
        size.clicked.connect(self.toggle_size)
        row = QHBoxLayout(bar)
        row.setContentsMargins(16, 0, 10, 0)
        row.setSpacing(6)
        row.addWidget(caption("CENTRAL DE COMANDO"))
        row.addStretch()
        row.addWidget(size)
        row.addWidget(shrink)

        self.view = QWebEngineView()
        page = self.view.page()
        page.setBackgroundColor(BG)
        # A crashed page used to leave a dead, frozen window: now it comes back by itself.
        page.renderProcessTerminated.connect(self._page_died)
        # A link that opens a new tab (a site in the Memória, a commit on GitHub) goes to the browser.
        page.newWindowRequested.connect(self._open_outside)
        # Videos: the page hands them to the native player (Qt's Chromium has no H.264).
        self._bridge = Bridge(self)
        self._bridge.play.connect(self._play_videos)
        self._channel = QWebChannel(page)
        self._channel.registerObject("amg", self._bridge)
        page.setWebChannel(self._channel)
        page.scripts().insert(_channel_script())

        self.player = VideoPlayer()
        self.player.closed.connect(self._back_to_page)
        self.player.fullscreen.connect(self._player_fullscreen)
        self.stack = QStackedWidget()
        self.stack.addWidget(self.view)
        self.stack.addWidget(self.player)
        self._ghost = Ghost()
        self._before_full = None

        self.bar = bar
        self.box = box = QVBoxLayout(self)
        box.setContentsMargins(EDGE, EDGE, EDGE, EDGE)  # the border strip is where resizing grabs
        box.setSpacing(0)
        box.addWidget(bar)
        box.addWidget(self.stack, 1)

    # ------------------------------------------------------------ the page, the player, crashes

    def _page_died(self, status, code):
        if status != QWebEnginePage.NormalTerminationStatus:
            QTimer.singleShot(400, self.view.reload)

    def _open_outside(self, request):
        url = request.requestedUrl()
        if url.scheme() in ("http", "https"):
            QDesktopServices.openUrl(url)

    def _play_videos(self, payload: str):
        self.stack.setCurrentWidget(self.player)
        self._set_page_state(QWebEnginePage.LifecycleState.Frozen)  # the page waits, still, while the video plays
        self.player.open_playlist(payload)

    def _back_to_page(self, changed: bool = False):
        self._set_page_state(QWebEnginePage.LifecycleState.Active)
        self.stack.setCurrentWidget(self.view)
        self.view.setFocus()
        if changed:   # a video went to the Lixo from the player: the gallery reads the section again
            self.view.page().runJavaScript("window.amgLibraryChanged && window.amgLibraryChanged()")

    def _player_fullscreen(self, on: bool):
        self.bar.setVisible(not on)
        self.box.setContentsMargins(*(0, 0, 0, 0) if on else (EDGE,) * 4)
        if on:
            self._before_full = (self.geometry(), self._full)
            self.showFullScreen()
        else:
            self.showNormal()
            if self._before_full:
                self.setGeometry(self._before_full[0])
                self._full = self._before_full[1]
        self.player.setFocus()

    def _set_page_state(self, state):
        """Frozen when nobody sees the page (minimized, or a video on top): no timers, no painting, no CPU."""
        page = self.view.page()
        try:
            if page.lifecycleState() != state:
                page.setLifecycleState(state)
        except Exception:
            pass  # Chromium refuses Frozen while it thinks the page is visible; it just stays active then

    def paintEvent(self, _):
        p = QPainter(self)
        p.fillRect(self.rect(), BG)
        p.setPen(QColor(255, 255, 255, 30))
        p.drawRect(self.rect().adjusted(0, 0, -1, -1))

    # ------------------------------------------------------------ move / resize like a normal window

    def _edges(self, pos) -> Qt.Edges:
        r, e = self.rect(), Qt.Edges()
        if pos.x() <= EDGE: e |= Qt.LeftEdge
        if pos.x() >= r.width() - EDGE: e |= Qt.RightEdge
        if pos.y() <= EDGE: e |= Qt.TopEdge
        if pos.y() >= r.height() - EDGE: e |= Qt.BottomEdge
        return e

    def mouseMoveEvent(self, e):
        edges = self._edges(e.position().toPoint())
        shape = {Qt.LeftEdge: Qt.SizeHorCursor, Qt.RightEdge: Qt.SizeHorCursor, Qt.TopEdge: Qt.SizeVerCursor,
                 Qt.BottomEdge: Qt.SizeVerCursor, Qt.LeftEdge | Qt.TopEdge: Qt.SizeFDiagCursor,
                 Qt.RightEdge | Qt.BottomEdge: Qt.SizeFDiagCursor, Qt.RightEdge | Qt.TopEdge: Qt.SizeBDiagCursor,
                 Qt.LeftEdge | Qt.BottomEdge: Qt.SizeBDiagCursor}.get(edges)
        self.setCursor(shape) if shape else self.unsetCursor()
        super().mouseMoveEvent(e)

    def mousePressEvent(self, e):
        edges = self._edges(e.position().toPoint())
        if e.button() == Qt.LeftButton and edges and self.windowHandle():
            self._full = False
            self.windowHandle().startSystemResize(edges)
        else:
            super().mousePressEvent(e)

    def begin_move(self, cursor):
        """Dragging a full-screen window first shrinks it under the cursor, like Windows does."""
        if self._full:
            rel = (cursor.x() - self.x()) / max(1, self.width())
            small = self._windowed_rect(cursor)
            small.moveLeft(cursor.x() - int(small.width() * rel))
            small.moveTop(cursor.y() - 20)
            self.setGeometry(small)
            self._full = False
        if self.windowHandle():
            self.windowHandle().startSystemMove()

    def _screen(self):
        return QGuiApplication.screenAt(self.geometry().center()) or QGuiApplication.primaryScreen()

    def _windowed_rect(self, around=None) -> QRect:
        screen = (QGuiApplication.screenAt(around) if around else None) or self._screen()
        area = screen.availableGeometry()
        r = QRect(0, 0, int(area.width() * WINDOWED[0]), int(area.height() * WINDOWED[1]))
        r.moveCenter(area.center())
        return r

    def toggle_size(self):
        """Full screen of the monitor the window is on, or a smaller centered window."""
        if self._busy:
            return
        end = self._windowed_rect() if self._full else self._screen().availableGeometry()
        self._full = not self._full
        self._morph(self.geometry(), end, 220, QEasingCurve.OutCubic, keep_window=True)

    # ------------------------------------------------------------ grow / shrink

    def expand(self, origin: QRect, url: str):
        """Grows from `origin` (the widget on screen) to a large window in the middle of its screen, then shows the Hub.
        Full screen is one click away (the button, or a double-click on the bar)."""
        if self._busy:
            return
        self._origin = QRect(origin)
        self._full = False
        self._set_page_state(QWebEnginePage.LifecycleState.Active)
        if self.view.url().toString() != url:
            self.view.load(QUrl(url))  # loads while it grows, so the Hub is ready when the motion ends
        else:
            # The page was frozen while hidden, so it has not looked for a new version of the Hub since it was last open:
            # it looks now, instead of showing the old page until its own timer comes round (a browser tab was ahead of it).
            self.view.page().runJavaScript("window.hubCheckVersion && window.hubCheckVersion()")
        self._morph(origin, self._windowed_rect(origin.center()), GROW_MS, QEasingCurve.OutQuart, keep_window=True)

    def collapse(self):
        """Shrinks back onto the widget and hides; the widget comes back via `collapsed`."""
        if self._busy or not self.isVisible():
            return
        if self.stack.currentWidget() is self.player:
            self.player.close_player()
        if self.isFullScreen():
            self._player_fullscreen(False)
        self._morph(self.geometry(), self._origin, SHRINK_MS, QEasingCurve.InCubic, keep_window=False)

    def _morph(self, start: QRect, end: QRect, ms: int, curve, keep_window: bool):
        """The ghost moves from start to end while the real window waits, invisible, already at its final size."""
        self._busy = True
        # The real window stays out of the way while the ghost moves: nothing else competes for the GPU.
        self.setWindowOpacity(0)  # layered-window alpha: DWM does it, the web view keeps its pixels and its input
        if keep_window:
            self.setGeometry(end)  # laid out at the final size now, shown when the ghost lands
        else:
            self.hide()
        self._ghost.run(start, end, ms, curve, lambda: self._landed(keep_window))

    def _landed(self, keep_window: bool):
        self._busy = False
        if keep_window:
            if not self.isVisible():
                self.showNormal()
            self.setWindowOpacity(1)
            self.raise_()
            self.activateWindow()
            self.view.setFocus()
            QTimer.singleShot(50, self._ghost.hide)  # a few frames of overlap while the Hub paints, so nothing flashes
        else:
            self._ghost.hide()
            self._set_page_state(QWebEnginePage.LifecycleState.Frozen)
            self.collapsed.emit()

    # ------------------------------------------------------------ minimize from anywhere

    def keyPressEvent(self, e):
        if e.key() == Qt.Key_Escape and not self.view.hasFocus():
            self.collapse()
        else:
            super().keyPressEvent(e)

    def changeEvent(self, e):
        if e.type() == QEvent.WindowStateChange and self.isMinimized():
            self.showNormal()  # the taskbar minimize becomes "back to the command center"
            self.collapse()
        super().changeEvent(e)

    def closeEvent(self, e):
        e.ignore()
        self.collapse()


if __name__ == "__main__":  # python -m team_widget.ui.expand [url]: grows, waits, shrinks
    import sys

    from PySide6.QtCore import QTimer
    from PySide6.QtWidgets import QApplication

    app = QApplication(sys.argv)
    url = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"
    screen = app.primaryScreen().availableGeometry()
    x = HubExpander()
    x.collapsed.connect(lambda: print("collapsed") or app.quit())
    x.expand(QRect(screen.right() - 380, screen.top() + 60, 360, 520), url)
    QTimer.singleShot(3000, x.collapse)
    QTimer.singleShot(8000, app.quit)
    app.exec()
