"""Entry point: python -m team_widget

Reads the same TEAM_AGENT_PROFILE / TEAM_AGENT_DATA_DIR / TEAM_AGENT_LOCAL_PORT
as the agent to find its local API and token.
"""
import os
from pathlib import Path

from .api.agent_client import AgentClient
from .state.store import StateStore
from .ui.tray import start_tray
from .ui.window import WidgetWindow


def main():
    profile = os.environ.get("TEAM_AGENT_PROFILE", "default")
    data_dir = Path(os.environ.get("TEAM_AGENT_DATA_DIR", Path.home() / ".team-agent" / profile))
    port = int(os.environ.get("TEAM_AGENT_LOCAL_PORT", "8765"))

    store = StateStore()
    client = AgentClient(port, data_dir / "local_api.token", store)
    client.start()
    window = WidgetWindow(store, client)
    tray = start_tray(window)
    window.root.mainloop()
    if tray:
        tray.stop()


if __name__ == "__main__":
    main()
