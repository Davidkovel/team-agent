import threading
import time

from ..api.agent_client import AgentClient
from ..state.store import StateStore
from .window import WidgetShell

COLORS = {"WORKING": "#3ecf8e", "ONLINE": "#3ecf8e", "IDLE": "#6c8cff", "WAITING": "#f5c04a",
          "PAUSED": "#f5c04a", "ERROR": "#f26d6d", "OFFLINE": "#5c6473"}


def start_tray(shell: WidgetShell, store: StateStore, client: AgentClient):
    """System tray icon coloured by agent status. Returns None where no tray backend exists."""
    try:
        import pystray
        from PIL import Image, ImageDraw
    except Exception:
        return None

    def image(status: str):
        img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
        ImageDraw.Draw(img).ellipse((8, 8, 56, 56), fill=COLORS.get(status, COLORS["OFFLINE"]))
        return img

    def quit_widget(icon, _):
        icon.stop()
        shell.quit()

    icon = pystray.Icon("team-agent", image("OFFLINE"), "Team Agent", pystray.Menu(
        pystray.MenuItem("Show widget", lambda *_: shell.show(), default=True),
        pystray.MenuItem("Open workspace", lambda *_: (shell.show(), shell.expand())),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Pause Agent", lambda *_: client.send("pause")),
        pystray.MenuItem("Resume Agent", lambda *_: client.send("resume")),
        pystray.MenuItem("Stop Current Task", lambda *_: client.send("stop")),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Quit widget (agent keeps running)", quit_widget),
    ))

    def follow_status():
        last = None
        while True:
            status = store.get().get("status", "OFFLINE")
            if status != last:
                last = status
                icon.icon, icon.title = image(status), f"Team Agent - {status}"
            time.sleep(1)

    icon.run_detached()
    threading.Thread(target=follow_status, daemon=True).start()
    return icon
