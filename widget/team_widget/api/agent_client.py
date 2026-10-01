import asyncio
import json
import threading
from pathlib import Path

import websockets

from ..state.store import StateStore


class AgentClient(threading.Thread):
    """WebSocket client for the agent's local API. Reconnects forever; no agent -> OFFLINE."""

    def __init__(self, port: int, token_path: Path, store: StateStore):
        super().__init__(daemon=True)
        self.port, self.token_path, self.store = port, token_path, store
        self._loop: asyncio.AbstractEventLoop | None = None
        self._ws = None
        self._session, self._got_session = None, threading.Event()

    def run(self):
        self._loop = asyncio.new_event_loop()
        self._loop.run_until_complete(self._main())

    async def _main(self):
        while True:
            try:
                token = self.token_path.read_text(encoding="utf-8").strip()
                async with websockets.connect(f"ws://127.0.0.1:{self.port}") as ws:
                    await ws.send(json.dumps({"token": token}))
                    self._ws = ws
                    async for raw in ws:
                        message = json.loads(raw)
                        if "session" in message:
                            self._session = message["session"]
                            self._got_session.set()
                        else:
                            self.store.set(message)
            except Exception:
                pass
            self._ws = None
            self.store.set_offline()
            await asyncio.sleep(3)

    def hub_session(self, timeout: float = 5) -> str | None:
        """A signed-in Hub session for this agent's user, or None when the agent is not reachable."""
        if not self._ws:
            return None
        self._session = None
        self._got_session.clear()
        self.send("session")
        self._got_session.wait(timeout)
        return self._session

    def send(self, action: str, **extra):
        if self._ws and self._loop:
            asyncio.run_coroutine_threadsafe(self._ws.send(json.dumps({"action": action, **extra})), self._loop)
