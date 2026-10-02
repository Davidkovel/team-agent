"""Entry point: python -m team_widget

Reads the same TEAM_AGENT_PROFILE / TEAM_AGENT_DATA_DIR / TEAM_AGENT_LOCAL_PORT
as the agent to find its local API and token.
"""
import os
import sys
from pathlib import Path

from PySide6.QtWidgets import QApplication

from .api.agent_client import AgentClient
from .state.store import StateStore
from .ui.tray import start_tray
from .ui.window import UI, WidgetWindow, font


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

    store = StateStore()
    client = AgentClient(port, data_dir / "local_api.token", store)
    client.start()
    window = WidgetWindow(store, client)
    window.quit = app.quit
    tray = start_tray(window)
    window.show_panel()
    app.exec()
    if tray:
        tray.hide()


if __name__ == "__main__":
    main()
