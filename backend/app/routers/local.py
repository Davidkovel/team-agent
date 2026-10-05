"""Endpoints for the desktop widget running on the same computer as the server.

The widget has no login, so these only answer requests that come from this machine (like /api/local/week).
Anyone on the network must use the normal, token-protected endpoints instead.
"""
import hmac
import ipaddress
import time
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import ponto, sync
from ..config import settings
from ..db import get_db
from ..models import Approval, Notification, User
from ..realtime import rt
from ..security import make_jwt, sees_all
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
    # what is waiting for each person: counts only, the widget opens the Hub for the rest
    waiting = dict((await db.execute(select(Approval.user_id, func.count(Approval.id)).where(Approval.status == "PENDING")
                                     .group_by(Approval.user_id))).all())
    unread = dict((await db.execute(select(Notification.user_id, func.count(Notification.id)).where(Notification.read_at.is_(None))
                                    .group_by(Notification.user_id))).all())
    for u in (await db.execute(select(User).order_by(User.id))).scalars():
        presence = await rt.store.get_presence(u.id)
        out.append({"user": u.username, "name": u.display_name, "online": presence is not None,
                    "status": presence["status"] if presence else "OFFLINE",
                    "task": presence.get("task", "") if presence else "",
                    "via": (presence.get("via") or "agent") if presence else None,
                    "ponto": iso(clocked.get(u.id)),  # when they clocked in today, or None
                    "approvals": sum(waiting.values()) if sees_all(u) else waiting.get(u.id, 0),  # the ones this person may decide
                    "unread": unread.get(u.id, 0),
                    **usage_fields(u.id, week_cost, meters, budget)})
    return out


@router.get("/notices")
async def local_notices(request: Request, user: str, after: int | None = None, db: AsyncSession = Depends(get_db)):
    """The tasks that were sent (to anyone) since notice `after`, for the widget of `user` to show.

    Without `after` nothing is returned, only `latest`: a widget that has just started remembers where it is and does not
    replay old news. Each item says whether it is `directed` at this person (the widget rings for those)."""
    local_or_team_key(request)
    person = await _person(db, user)
    mine = (Notification.user_id == person.id, Notification.kind == "task_new")
    if sync.ACTIVE:  # ids are not in arrival order between computers: count by when each one got here
        latest, found = await sync.notices(db, Notification, mine, after)
        return {"latest": latest, "items": [{"id": seq, "title": n.title, "body": n.body, "href": n.href, "directed": bool(n.directed),
                                             "created_at": iso(n.created_at)} for seq, n in found]}
    latest = (await db.execute(select(func.max(Notification.id)).where(*mine))).scalar() or 0
    rows = [] if after is None else (await db.execute(select(Notification).where(*mine, Notification.id > after)
                                                      .order_by(Notification.id))).scalars()
    return {"latest": latest, "items": [{"id": n.id, "title": n.title, "body": n.body, "href": n.href, "directed": bool(n.directed),
                                         "created_at": iso(n.created_at)} for n in rows]}


@router.get("/inbox")
async def local_inbox(request: Request, user: str, limit: int = 3, db: AsyncSession = Depends(get_db)):
    """The widget's mini history (the full one is in the Hub): what `user` has not read yet, newest first, then the newest
    already read to fill it, so it never goes blank once everything is read. Each item says whether it was read."""
    local_or_team_key(request)
    person = await _person(db, user)
    limit = min(max(limit, 1), 20)
    newest = (Notification.created_at.desc(), Notification.id.desc())
    unread = (Notification.user_id == person.id, Notification.read_at.is_(None))
    count = (await db.execute(select(func.count(Notification.id)).where(*unread))).scalar() or 0
    rows = list((await db.execute(select(Notification).where(*unread).order_by(*newest).limit(limit))).scalars())
    if len(rows) < limit:
        rows += (await db.execute(select(Notification).where(Notification.user_id == person.id, Notification.read_at.is_not(None))
                                  .order_by(*newest).limit(limit - len(rows)))).scalars()
    return {"unread": count, "items": [{"id": n.id, "kind": n.kind, "title": n.title, "body": n.body, "href": n.href,
                                        "read": n.read_at is not None, "created_at": iso(n.created_at)} for n in rows]}


class InboxRead(BaseModel):
    user: str
    ids: list[int]


@router.post("/inbox/read")
async def local_inbox_read(body: InboxRead, request: Request, db: AsyncSession = Depends(get_db),
                           x_team_widget: str | None = Header(None)):
    """A notification opened from the widget: read, there and on the Hub's bell. Only that person's own."""
    user = await widget_user(WidgetPing(user=body.user), request, db, x_team_widget)
    rows = (await db.execute(select(Notification).where(Notification.user_id == user.id, Notification.id.in_(body.ids),
                                                        Notification.read_at.is_(None)))).scalars().all()
    now = datetime.now(timezone.utc)
    for n in rows:
        n.read_at = now
    await db.commit()
    if rows:
        await rt.publish("notification", user.id)
    return {"read": len(rows)}


class InboxDelete(BaseModel):
    user: str
    ids: list[int] = []
    all: bool = False


@router.post("/inbox/delete")
async def local_inbox_delete(body: InboxDelete, request: Request, db: AsyncSession = Depends(get_db),
                             x_team_widget: str | None = Header(None)):
    """Notifications cleared from the widget (one, or `all` of them): gone for good, here, on the Hub's bell and, by sync,
    on the other computers. Only that person's own."""
    user = await widget_user(WidgetPing(user=body.user), request, db, x_team_widget)
    mine = select(Notification).where(Notification.user_id == user.id)
    if not body.all:
        mine = mine.where(Notification.id.in_(body.ids))
    rows = (await db.execute(mine)).scalars().all()
    for n in rows:
        await db.delete(n)  # one by one through the session, so sync sees each delete and passes it on
    await db.commit()
    if rows:
        await rt.publish("notification", user.id)
    return {"deleted": len(rows)}


async def _person(db: AsyncSession, name: str) -> User:
    """The user a widget names, by login (mark) or by the name people see (Marco)."""
    wanted = name.strip().lower()
    person = next((u for u in (await db.execute(select(User))).scalars() if wanted in (u.username.lower(), u.display_name.lower())), None)
    if not person:
        raise HTTPException(404, "Unknown user")
    return person


async def widget_user(body: WidgetPing, request: Request, db: AsyncSession, x_team_widget: str | None) -> User:
    """The person a widget speaks for. The custom header keeps web pages from calling these endpoints."""
    local_or_team_key(request)
    if x_team_widget != "1":
        raise HTTPException(403, "Widget only")
    return await _person(db, body.user)


@router.post("/presence")
async def local_presence(body: WidgetPing, request: Request, db: AsyncSession = Depends(get_db),
                         x_team_widget: str | None = Header(None)):
    """The widget on this computer says "this person is here"."""
    user = await widget_user(body, request, db, x_team_widget)
    WIDGET_SEEN[user.id] = time.time()
    await hub_seen(user.id, "widget")
    return {"ok": True, "name": user.display_name}


@router.post("/session")
async def local_session(body: WidgetPing, request: Request, db: AsyncSession = Depends(get_db),
                        x_team_widget: str | None = Header(None)):
    """A signed-in Hub session for the person at that widget, so the Hub opens with no password when it is not
    on this computer (no IP sign-in there) and no agent is running. The team key is the proof."""
    return {"token": make_jwt(await widget_user(body, request, db, x_team_widget))}


@router.post("/ponto")
async def local_ponto(body: WidgetPing, request: Request, db: AsyncSession = Depends(get_db),
                      x_team_widget: str | None = Header(None)):
    """Clock in from the widget, for the person sitting at that computer."""
    return await ponto.punch(db, await widget_user(body, request, db, x_team_widget))
