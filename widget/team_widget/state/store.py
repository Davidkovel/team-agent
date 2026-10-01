import threading

OFFLINE = {"status": "OFFLINE", "connected": False, "task": "", "progress": 0, "team": [], "notifications": []}


class StateStore:
    """Latest agent state, written by the network thread and read by the UI thread."""

    def __init__(self):
        self._lock = threading.Lock()
        self._state = dict(OFFLINE)
        self.version = 0

    def set(self, state: dict):
        with self._lock:
            self._state = state
            self.version += 1

    def set_offline(self):
        # Keep the dashboard URL so "Open Dashboard" still works while the agent is down.
        self.set({**OFFLINE, "dashboard_url": self._state.get("dashboard_url", "")})

    def get(self) -> dict:
        with self._lock:
            return dict(self._state)
