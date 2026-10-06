"""Entry point: python -m team_widget

Reads the same TEAM_AGENT_PROFILE / TEAM_AGENT_DATA_DIR / TEAM_AGENT_LOCAL_PORT
as the agent to find its local API and token.
"""
import os
import sys
from pathlib import Path

from PySide6.QtNetwork import QLocalServer, QLocalSocket
from PySide6.QtCore import QTimer
from PySide6.QtWidgets import QApplication

from . import selfupdate
from .api.agent_client import AgentClient
from .state.store import StateStore
from .ui.tray import start_tray
from .ui.window import UI, WidgetWindow, font


def already_open(name: str) -> bool:
    """True when this widget is already running: it is asked to come to the front and this copy stops.
    Each click on Abrir AMG used to open one more widget, and each one started its own Hub on the same database."""
    socket = QLocalSocket()
    socket.connectToServer(name)
    if not socket.waitForConnected(500):
        return False
    socket.write(b"show")
    socket.waitForBytesWritten(500)
    socket.disconnectFromServer()
    return True


def listen_for_second_copy(name: str, window) -> QLocalServer:
    server = QLocalServer()
    QLocalServer.removeServer(name)  # a name left behind by a widget that crashed
    server.listen(name)

    def come_forward():
        while (peer := server.nextPendingConnection()) is not None:
            peer.disconnected.connect(peer.deleteLater)
        expander = getattr(window, "_expander", None)
        if expander is not None and expander.isVisible():
            expander.showNormal()
            expander.raise_()
            expander.activateWindow()
        else:
            window.show_panel()
    server.newConnection.connect(come_forward)
    return server


def main():
    profile = os.environ.get("TEAM_AGENT_PROFILE", "default")
    data_dir = Path(os.environ.get("TEAM_AGENT_DATA_DIR", Path.home() / ".team-agent" / profile))
    port = int(os.environ.get("TEAM_AGENT_LOCAL_PORT", "8765"))

    if sys.platform == "win32":
        try:  # own taskbar entry and icon instead of python's
            import ctypes
            ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("team.agent.widget")
        except Exception:
            pass
    app = QApplication(sys.argv)
    app.setApplicationName("Agente AMG")
    app.setQuitOnLastWindowClosed(False)  # closing the widget hides it to the tray
    app.setFont(font(9, families=UI))
    name = f"agente-amg-widget-{os.environ.get('USERNAME', '')}-{profile}"
    if already_open(name):
        return

    store = StateStore()
    client = AgentClient(port, data_dir / "local_api.token", store)
    client.start()
    window = WidgetWindow(store, client)
    # exit, not quit: in Qt 6 quit() asks the windows first, and the widget refuses to close (it hides to the tray)
    window.quit = lambda: app.exit(0)
    tray = start_tray(window)
    server = listen_for_second_copy(name, window)  # noqa: F841 - kept alive while the widget runs
    window.show_panel()

    started_at = selfupdate.head()   # the commit this widget is running

    def follow_updates():
        if selfupdate.widget_changed(started_at) and selfupdate.relaunch():
            updates.stop()   # iniciar.ps1 closes this widget and opens the new one
            window.notify("Agente AMG", "Chegou uma versão nova: o widget reinicia sozinho.")

    updates = QTimer()
    updates.timeout.connect(follow_updates)
    updates.start(selfupdate.EVERY_MS)
    app.exec()
    if tray:
        tray.hide()


if __name__ == "__main__":
    main()
