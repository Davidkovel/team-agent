import asyncio
from typing import Callable

import httpx

from ..core.logs import log


class BackendClient:
    """HTTP for state and tasks; WebSocket only as a 'wake up now' signal."""

    def __init__(self, base_url: str, token: str):
        self.base_url, self.token = base_url, token
        self._http = httpx.AsyncClient(base_url=base_url, timeout=15, headers={"Authorization": f"Bearer {token}"})

    async def _call(self, method: str, path: str, body: dict | None = None):
        response = await self._http.request(method, f"/api/agent{path}", json=body)
        response.raise_for_status()
        return response.json()

    async def whoami(self) -> dict:
        return await self._call("GET", "/me")

    async def session(self) -> dict:
        return await self._call("POST", "/session")

    async def heartbeat(self, state: dict) -> dict:
        return await self._call("POST", "/heartbeat", state)

    async def next_tasks(self) -> list[dict]:
        return await self._call("GET", "/tasks/next")

    async def recovery(self) -> dict:
        return await self._call("GET", "/recovery")

    async def update_task(self, task_id: int, **fields) -> dict:
        return await self._call("POST", f"/tasks/{task_id}/update", fields)

    async def add_event(self, task_id: int, kind: str, message: str) -> dict:
        return await self._call("POST", f"/tasks/{task_id}/events", {"kind": kind, "message": message})

    approval_meta = True  # this Hub shows the risk, the files and the diff of an approval request

    async def create_approval(self, task_id: int | None, action: str, detail: str, **meta) -> dict:
        return await self._call("POST", "/approvals", {"task_id": task_id, "action": action, "detail": detail, **meta})

    async def task_memory(self, task_id: int) -> list[dict]:
        return await self._call("GET", f"/tasks/{task_id}/memory")

    async def task_briefing(self, task_id: int) -> dict:
        return await self._call("GET", f"/tasks/{task_id}/briefing")

    async def start_session(self, **fields) -> dict:
        return await self._call("POST", "/sessions", fields)

    async def update_session(self, session_id: int, **fields) -> dict:
        return await self._call("POST", f"/sessions/{session_id}", fields)

    async def report_subagent(self, session_id: int, **fields) -> dict:
        return await self._call("POST", f"/sessions/{session_id}/subagents", fields)

    async def ai_take(self, request_id: int) -> dict:
        return await self._call("GET", f"/ai/{request_id}")

    async def ai_result(self, request_id: int, answer: str = "", error: str = "") -> dict:
        return await self._call("POST", f"/ai/{request_id}/result", {"answer": answer, "error": error})

    async def get_approval(self, approval_id: int) -> dict:
        return await self._call("GET", f"/approvals/{approval_id}")

    async def report_usage(self, **usage) -> dict:
        return await self._call("POST", "/usage", usage)

    async def help(self, task_id: int | None, message: str) -> dict:
        return await self._call("POST", "/help", {"task_id": task_id, "message": message})

    async def listen(self, on_wake: Callable[[], None]):
        """Keeps a WebSocket open; any server event triggers an immediate heartbeat."""
        import websockets

        url = self.base_url.replace("http", "ws", 1) + f"/ws/agent?token={self.token}"
        while True:
            try:
                async with websockets.connect(url) as ws:
                    log.info("Realtime channel connected")
                    async for _ in ws:
                        on_wake()
            except Exception as exc:
                log.info("Realtime channel down (%s); heartbeat polling continues", type(exc).__name__)
            await asyncio.sleep(10)
