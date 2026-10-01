"""Widget shell: one small always-on-top window that becomes the full workspace
when it is maximized (or made wide), and a compact widget again when restored.

Compact mode renders local HTML that talks to the Local Agent's WebSocket API.
Workspace mode shows the team web app served by the backend.
"""
import os
import threading
from pathlib import Path

import webview

from ..state.store import StateStore

WIDGET_HTML = str(Path(__file__).parent / "web" / "widget.html")
COMPACT = (340, 620)
WORKSPACE_MIN_WIDTH = 700  # wider than this -> show the workspace


class Api:
    """Methods callable from the page as window.pywebview.api.*"""

    def __init__(self, shell: "WidgetShell"):
        self._shell = shell

    def config(self) -> dict:
        return {"port": self._shell.port, "token": self._shell.local_token()}

    def expand(self, task_id=None):
        self._shell.expand(task_id)

    def compact(self):
        self._shell.compact()


class WidgetShell:
    def __init__(self, port: int, token_path: Path, store: StateStore):
        self.port, self.token_path, self.store = port, token_path, store
        self.mode = "compact"
        self.quitting = False
        self._task_id = None
        screen = webview.screens[0]
        self.window = webview.create_window(
            "Team Agent", url=WIDGET_HTML, js_api=Api(self), on_top=True,
            width=COMPACT[0], height=COMPACT[1], min_size=(300, 420),
            x=screen.width - COMPACT[0] - 24, y=60, background_color="#0c0f14")
        self.window.events.resized += self._on_resized
        self.window.events.closing += self._on_closing

    def local_token(self) -> str:
        try:
            return self.token_path.read_text(encoding="utf-8").strip()
        except OSError:
            return ""

    def workspace_url(self) -> str:
        base = (self.store.get().get("dashboard_url") or os.environ.get("TEAM_SERVER_URL") or "http://localhost:8000")
        return base.rstrip("/") + (f"/#task-{self._task_id}" if self._task_id else "/")

    # ------------------------------------------------------------ mode switching

    def _on_resized(self, width, height):
        if height < 100:  # minimized / not yet shown
            return
        mode = "workspace" if width >= WORKSPACE_MIN_WIDTH else "compact"
        if mode == self.mode:
            return
        self.mode = mode
        url = self.workspace_url() if mode == "workspace" else WIDGET_HTML
        self._task_id = None
        # Window calls made from inside a window event deadlock the UI thread, so switch from a worker.
        threading.Thread(target=self._switch, args=(mode, url), daemon=True).start()

    def _switch(self, mode: str, url: str):
        self.window.on_top = mode == "compact"
        self.window.load_url(url)

    def expand(self, task_id=None):
        self._task_id = task_id
        if self.mode == "workspace":
            self.window.load_url(self.workspace_url())
            self._task_id = None
        else:
            self.window.maximize()

    def compact(self):
        self.window.restore()
        self.window.resize(*COMPACT)

    # ------------------------------------------------------------ tray integration

    def _on_closing(self):
        if self.quitting:
            return True
        self.window.hide()  # closing hides to the tray; the agent keeps running
        return False

    def show(self):
        self.window.show()
        self.window.restore()

    def quit(self):
        self.quitting = True
        self.window.destroy()
