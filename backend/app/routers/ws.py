from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..db import SessionLocal
from ..realtime import Connection, rt
from ..security import user_from_agent_token, user_from_jwt

router = APIRouter()


async def _serve(ws: WebSocket, kind: str, token: str):
    async with SessionLocal() as db:
        lookup = user_from_agent_token if kind == "agent" else user_from_jwt
        user = await lookup(token, db)
    if not user:
        await ws.close(code=4401)
        return
    await ws.accept()
    conn = Connection(ws, user.id, user.role, kind)
    rt.connections.append(conn)
    try:
        while True:
            await ws.receive_text()  # clients only listen; this detects disconnect
    except WebSocketDisconnect:
        pass
    finally:
        if conn in rt.connections:
            rt.connections.remove(conn)


@router.websocket("/ws")
async def dashboard_ws(ws: WebSocket, token: str = ""):
    await _serve(ws, "dashboard", token)


@router.websocket("/ws/agent")
async def agent_ws(ws: WebSocket, token: str = ""):
    await _serve(ws, "agent", token)
