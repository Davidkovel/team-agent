"""Entry point: python -m team_widget

Reads the same TEAM_AGENT_PROFILE / TEAM_AGENT_DATA_DIR / TEAM_AGENT_LOCAL_PORT
as the agent to find its local API and token.
"""
import os
from pathlib import Path

import webview

from .api.agent_client import AgentClient
from .state.store import StateStore
from .ui.tray import start_tray
from .ui.window import WidgetShell


def main():
    profile = os.environ.get("TEAM_AGENT_PROFILE", "default")
    data_dir = Path(os.environ.get("TEAM_AGENT_DATA_DIR", Path.home() / ".team-agent" / profile))
    port = int(os.environ.get("TEAM_AGENT_LOCAL_PORT", "8765"))
    token_path = data_dir / "local_api.token"

    store = StateStore()
    client = AgentClient(port, token_path, store)  # feeds the tray icon and tray commands
    client.start()
    shell = WidgetShell(port, token_path, store)
    tray = start_tray(shell, store, client)
    # Persistent storage keeps the workspace login between restarts.
    webview.start(private_mode=False, storage_path=str(data_dir / "webview"))
    if tray:
        tray.stop()


if __name__ == "__main__":
    main()
