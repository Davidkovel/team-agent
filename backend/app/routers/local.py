"""Endpoints for the desktop widget running on the same computer as the server.

The widget has no login, so these only answer requests that come from this machine (like /api/local/week).
Anyone on the network must use the normal, token-protected endpoints instead.
"""
import hmac
import ipaddress
import time

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import ponto
from ..config import settings
from ..db import get_db
from ..models import User
from ..realtime import rt
from ..services import WIDGET_SEEN, hub_seen, iso, usage_fields, usage_numbers

router = APIRouter(prefix="/api/local")

LOCAL_HOSTS = ("127.0.0.1", "::1", "localhost")


def only_local(request: Request):
    """This computer, or a widget on one of the trusted networks (WIDGET_NETWORKS, e.g. the team's VPN)."""
    host = request.client.host if request.client else ""
    if host in LOCAL_HOSTS:
        return
    try:
        addr = ipaddress.ip_address(host)
        if any(addr in ipaddress.ip_network(n.strip(), strict=False) for n in settings.widget_networks.split(",") if n.strip()):
            return
    except ValueError:
        pass
    raise HTTPException(403, "Only available from the server computer")


def local_or_team_key(request: Request):
    """Presence only: the server computer, or another computer's widget that knows TEAM_KEY."""
    key = request.headers.get("x-team-key", "")
    if settings.team_key and hmac.compare_digest(key.encode(), settings.team_key.encode()):
        return
    only_local(request)


class WidgetPing(BaseModel):
    user: str  # login (owner/mark/david) or the name people see (Kovel/Marco/David)


@router.get("/team")
async def local_team(request: Request, db: AsyncSession = Depends(get_db)):
    """Who is online right now, for the widget's icons. Works with no agent and no login."""
    local_or_team_key(request)
    out = []
    week_cost, meters, budget = await usage_numbers(db)
    clocked = await ponto.punches(db)
    for u in (await db.execute(select(User).order_by(User.id))).scalars():
        presence = await rt.store.get_presence(u.id)
        out.append({"user": u.username, "name": u.display_name, "online": presence is not None,
                    "status": presence["status"] if presence else "OFFLINE",
                    "task": presence.get("task", "") if presence else "",
                    "via": (presence.get("via") or "agent") if presence else None,
                    "ponto": iso(clocked.get(u.id)),  # when they clocked in today, or None
                    **usage_fields(u.id, week_cost, meters, budget)})
    return out


async def widget_user(body: WidgetPing, request: Request, db: AsyncSession, x_team_widget: str | None) -> User:
    """The person a widget speaks for. The custom header keeps web pages from calling these endpoints."""
    local_or_team_key(request)
    if x_team_widget != "1":
        raise HTTPException(403, "Widget only")
    wanted = body.user.strip().lower()
    users = (await db.execute(select(User))).scalars().all()
    user = next((u for u in users if wanted in (u.username.lower(), u.display_name.lower())), None)
    if not user:
        raise HTTPException(404, "Unknown user")
    return user


@router.post("/presence")
async def local_presence(body: WidgetPing, request: Request, db: AsyncSession = Depends(get_db),
                         x_team_widget: str | None = Header(None)):
    """The widget on this computer says "this person is here"."""
    user = await widget_user(body, request, db, x_team_widget)
    WIDGET_SEEN[user.id] = time.time()
    await hub_seen(user.id, "widget")
    return {"ok": True, "name": user.display_name}


@router.post("/ponto")
async def local_ponto(body: WidgetPing, request: Request, db: AsyncSession = Depends(get_db),
                      x_team_widget: str | None = Header(None)):
    """Clock in from the widget, for the person sitting at that computer."""
    return await ponto.punch(db, await widget_user(body, request, db, x_team_widget))
