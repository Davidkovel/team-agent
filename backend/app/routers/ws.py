import re

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..db import SessionLocal
from ..realtime import Connection, rt
from ..security import user_from_agent_token, user_from_jwt
from ..services import hub_gone, hub_seen

router = APIRouter()
PHONE = re.compile(r"iPhone|iPad|Android|Mobile")


async def _present(user_id: int):
    """Having the Hub open means the person is online, even with no agent running."""
    await hub_seen(user_id, "hub")


async def _serve(ws: WebSocket, kind: str, token: str):
    async with SessionLocal() as db:
        lookup = user_from_agent_token if kind == "agent" else user_from_jwt
        user = await lookup(token, db)
    if not user:
        await ws.close(code=4401)
        return
    await ws.accept()
    conn = Connection(ws, user.id, user.role, kind, "phone" if PHONE.search(ws.headers.get("user-agent", "")) else "pc")
    rt.connections.append(conn)
    user_id = user.id
    if kind == "dashboard":
        await _present(user_id)
    try:
        while True:
            await ws.receive_text()  # a dashboard sends a ping every ~10 s: it is how "online" is kept alive
            if kind == "dashboard":
                await _present(user_id)
    except WebSocketDisconnect:
        pass
    finally:
        if conn in rt.connections:
            rt.connections.remove(conn)
        if kind == "dashboard":
            await hub_gone(user_id)  # no-op while another window or the widget is still open


@router.websocket("/ws")
async def dashboard_ws(ws: WebSocket, token: str = ""):
    await _serve(ws, "dashboard", token)


@router.websocket("/ws/agent")
async def agent_ws(ws: WebSocket, token: str = ""):
    await _serve(ws, "agent", token)
