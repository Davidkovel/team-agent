"""The Hub inside the command center: maximizing grows the widget into the whole screen and the Hub appears in it.

HubExpander starts exactly on top of the widget, grows to fill the screen the widget is on, then shows the Hub.
Minimizing (the button, Esc or the taskbar) shrinks it back onto the widget and hands control back to it.
Once open it is a normal window: drag the bar to move it (to another monitor too), drag any edge or corner to resize,
double-click the bar or use the middle button to switch between full screen and a smaller window.

    expander = HubExpander()
    expander.collapsed.connect(widget.show_panel)
    expander.expand(widget.frameGeometry(), url)   # then hide the widget
"""
from PySide6.QtCore import QEasingCurve, QEvent, QParallelAnimationGroup, QPropertyAnimation, QRect, Qt, QUrl, Signal
from PySide6.QtGui import QColor, QGuiApplication, QPainter
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWidgets import QHBoxLayout, QVBoxLayout, QWidget

BG = QColor(7, 7, 8)
GROW_MS = 460
SHRINK_MS = 320
EDGE = 6           # px around the Hub that resize the window
WINDOWED = (0.72, 0.8)   # size of the "smaller window" as a share of the screen


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
        self.view.page().setBackgroundColor(BG)
        self._content = [bar, self.view]

        box = QVBoxLayout(self)
        box.setContentsMargins(EDGE, EDGE, EDGE, EDGE)  # the border strip is where resizing grabs
        box.setSpacing(0)
        box.addWidget(bar)
        box.addWidget(self.view, 1)

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
        self._run(self.geometry(), end, 260, QEasingCurve.OutCubic, lambda: setattr(self, "_busy", False))

    # ------------------------------------------------------------ grow / shrink

    def expand(self, origin: QRect, url: str):
        """Grows from `origin` (the widget on screen) to the full screen it is on, then shows the Hub."""
        if self._busy:
            return
        self._origin = QRect(origin)
        self._full = True
        if self.view.url().toString() != url:
            self.view.load(QUrl(url))  # loads while it grows, so the Hub is ready when the motion ends
        screen = QGuiApplication.screenAt(origin.center()) or QGuiApplication.primaryScreen()
        self._show_content(False)
        self.setGeometry(origin)
        self.setWindowOpacity(1)
        self.showNormal()
        self.raise_()
        self.activateWindow()
        self._run(origin, screen.availableGeometry(), GROW_MS, QEasingCurve.OutQuart, self._grown)

    def collapse(self):
        """Shrinks back onto the widget and hides; the widget comes back via `collapsed`."""
        if self._busy or not self.isVisible():
            return
        self._show_content(False)
        self._run(self.geometry(), self._origin, SHRINK_MS, QEasingCurve.InCubic, self._shrunk)

    def _run(self, start: QRect, end: QRect, ms: int, curve, done):
        self._busy = True
        geo = QPropertyAnimation(self, b"geometry", self)
        geo.setStartValue(start)
        geo.setEndValue(end)
        geo.setDuration(ms)
        geo.setEasingCurve(curve)
        self._anim = QParallelAnimationGroup(self)
        self._anim.addAnimation(geo)
        self._anim.finished.connect(done)
        self._anim.start()

    def _grown(self):
        self._busy = False
        self._show_content(True)  # no QGraphicsEffect on the web view: it swallows every click and keystroke
        self.view.setFocus()

    def _shrunk(self):
        self._busy = False
        self.hide()
        self.collapsed.emit()

    def _show_content(self, on: bool):
        for w in self._content:
            w.setVisible(on)

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
