"""The mini window: the cave of Empresa AMG in a small window of its own, over everything else on the screen, like YouTube's
mini player (Marco, 9 Oct: «uma janelinha do tamanho de uma janela de terminal, para estar sempre atualizado, sem ter o
Hub enorme aberto»).

The Hub page asks for it (the cave's «Mini janela», crew.js openMini → amg.openMini over QWebChannel) with the address of
the page in its mini mode (?mini=1): only the cave and a line of who is working on what. It is an ordinary window, so it
can be moved, resized and snapped like a terminal, and it stays on top. Its place and size are kept for next time.
Closing it unloads the page, so the cave stops drawing.
"""
from pathlib import Path

from PySide6.QtCore import QSettings, Qt, QUrl
from PySide6.QtGui import QColor, QGuiApplication, QIcon
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWidgets import QVBoxLayout, QWidget

ICON = Path(__file__).resolve().parents[1] / "assets" / "app.ico"
SIZE = (560, 400)   # the first time: the size of a small terminal, in the bottom right corner


class MiniWindow(QWidget):
    def __init__(self):
        super().__init__(None, Qt.Window | Qt.WindowStaysOnTopHint)
        self.setWindowTitle("Empresa AMG · ao vivo")
        if ICON.exists():
            self.setWindowIcon(QIcon(str(ICON)))
        self.setMinimumSize(320, 220)
        self.setStyleSheet("background:#030407;")
        self.view = QWebEngineView(self)
        self.view.page().setBackgroundColor(QColor("#030407"))
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.addWidget(self.view)
        self._settings = QSettings("AgenteAMG", "widget")
        saved = self._settings.value("mini/geometry")
        if saved is None or not self.restoreGeometry(saved):
            screen = QGuiApplication.primaryScreen().availableGeometry()
            self.setGeometry(screen.right() - SIZE[0] - 24, screen.bottom() - SIZE[1] - 24, *SIZE)

    def open(self, url: str):
        self.view.load(QUrl(url))
        self.show()
        self.raise_()
        self.activateWindow()

    def closeEvent(self, e):
        self._settings.setValue("mini/geometry", self.saveGeometry())
        self.view.setUrl(QUrl("about:blank"))   # nothing drawing while it is closed
        super().closeEvent(e)
