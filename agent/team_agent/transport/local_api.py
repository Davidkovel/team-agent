"""Local WebSocket API for the Desktop Widget (127.0.0.1 only, token-protected).

Agent -> widget: full state JSON on every change.
Widget -> agent: {"action": "pause" | "resume" | "stop" | "help", "message": "..."}
"""
import asyncio
import json
import secrets
from pathlib import Path
from typing import Awaitable, Callable

from ..core.logs import log


def local_token(data_dir: Path) -> str:
    """Per-user secret file: only processes of the same OS user can talk to the agent."""
    path = data_dir / "local_api.token"
    if not path.exists():
        data_dir.mkdir(parents=True, exist_ok=True)
        path.write_text(secrets.token_urlsafe(24), encoding="utf-8")
    return path.read_text(encoding="utf-8").strip()


class LocalAPI:
    def __init__(self, port: int, token: str, get_state: Callable[[], dict],
                 on_command: Callable[[dict], Awaitable[None]]):
        self.port, self.token = port, token
        self.get_state, self.on_command = get_state, on_command
        self._clients: set = set()

    async def serve(self):
        import websockets

        async with websockets.serve(self._handle, "127.0.0.1", self.port):
            log.info("Widget API listening on 127.0.0.1:%s", self.port)
            await asyncio.Future()

    async def _handle(self, ws):
        try:
            hello = json.loads(await asyncio.wait_for(ws.recv(), 5))
            if hello.get("token") != self.token:
                await ws.close(code=4401)
                return
            self._clients.add(ws)
            await ws.send(json.dumps(self.get_state()))
            async for raw in ws:
                await self.on_command(json.loads(raw))
        except Exception:
            pass
        finally:
            self._clients.discard(ws)

    def broadcast(self):
        payload = json.dumps(self.get_state())
        for ws in list(self._clients):
            asyncio.ensure_future(self._send(ws, payload))

    async def _send(self, ws, payload: str):
        try:
            await ws.send(payload)
        except Exception:
            self._clients.discard(ws)
