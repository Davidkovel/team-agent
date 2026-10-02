"""The Hub inside the command center: maximizing grows the widget into the whole screen and the Hub appears in it.

HubExpander starts exactly on top of the widget, grows to fill the screen the widget is on, then shows the Hub.
Minimizing (the button, Esc or the taskbar) shrinks it back onto the widget and hands control back to it.

    expander = HubExpander()
    expander.collapsed.connect(widget.show_panel)
    expander.expand(widget.frameGeometry(), url)   # then hide the widget
"""
from PySide6.QtCore import QEasingCurve, QEvent, QParallelAnimationGroup, QPropertyAnimation, QRect, Qt, QUrl, Signal
from PySide6.QtGui import QColor, QGuiApplication, QPainter
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWidgets import QGraphicsOpacityEffect, QHBoxLayout, QVBoxLayout, QWidget

BG = QColor(7, 7, 8)
GROW_MS = 460
SHRINK_MS = 320


class HubExpander(QWidget):
    collapsed = Signal()   # back to the widget size: show the widget again

    def __init__(self):
        super().__init__(None, Qt.Window | Qt.FramelessWindowHint)
        self.setWindowTitle("Agente AMG")
        self._origin = QRect()
        self._busy = False

        from .window import IconButton, caption  # the same title bar as the command center

        bar = QWidget()
        bar.setFixedHeight(40)
        bar.setAttribute(Qt.WA_StyledBackground)
        bar.setStyleSheet("background:#070708;")
        shrink = IconButton("hide", "Minimizar")
        shrink.clicked.connect(self.collapse)
        row = QHBoxLayout(bar)
        row.setContentsMargins(16, 0, 10, 0)
        row.addWidget(caption("CENTRAL DE COMANDO"))
        row.addStretch()
        row.addWidget(shrink)

        self.view = QWebEngineView()
        self.view.page().setBackgroundColor(BG)
        self._fade = QGraphicsOpacityEffect(self.view)
        self._fade.setOpacity(0)
        self.view.setGraphicsEffect(self._fade)
        self._content = [bar, self.view]

        box = QVBoxLayout(self)
        box.setContentsMargins(0, 0, 0, 0)
        box.setSpacing(0)
        box.addWidget(bar)
        box.addWidget(self.view, 1)

    def paintEvent(self, _):
        p = QPainter(self)
        p.fillRect(self.rect(), BG)
        p.setPen(QColor(255, 255, 255, 30))
        p.drawRect(self.rect().adjusted(0, 0, -1, -1))

    # ------------------------------------------------------------ grow / shrink

    def expand(self, origin: QRect, url: str):
        """Grows from `origin` (the widget on screen) to the full screen it is on, then shows the Hub."""
        if self._busy:
            return
        self._origin = QRect(origin)
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
        self._show_content(True)
        fade = QPropertyAnimation(self._fade, b"opacity", self)
        fade.setStartValue(0.0)
        fade.setEndValue(1.0)
        fade.setDuration(260)
        fade.setEasingCurve(QEasingCurve.OutCubic)
        fade.start(QPropertyAnimation.DeleteWhenStopped)
        self.view.setFocus()

    def _shrunk(self):
        self._busy = False
        self.hide()
        self.collapsed.emit()

    def _show_content(self, on: bool):
        if not on:
            self._fade.setOpacity(0)
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
