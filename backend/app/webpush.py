"""Notifications from the AMG app itself on the iPhone: Web Push, which iOS 16.4+ delivers to a web app added to the home screen.
They show the app's own name and icon (AMG and the star) and the text of the task, which no other app (ntfy) can do.

Browsers only allow push on a secure page, so the Hub has to be opened over https (Tailscale serve, see CLAUDE.md). Everything here
stays off until a phone subscribes, and without the pywebpush package the Hub runs exactly as before.

Subscriptions are kept on the computer whose Hub the phone opens (webpush.json next to the database), never in the shared database:
a phone is subscribed to one Hub. That Hub sends what is made on it (push.to_people) and what arrives by sync from the other
computers (loop), so a task from Kovel reaches Marco's phone through Marco's own Hub.
"""
import asyncio
import base64
import json
import logging
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import settings
from .db import SessionLocal, get_db
from .models import Notification, User
from .security import current_user

try:
    from cryptography.hazmat.primitives import serialization
    from py_vapid import Vapid
    from pywebpush import WebPushException, webpush
except ImportError:  # optional: without the package only this feature is off
    webpush = None

log = logging.getLogger("team.webpush")
router = APIRouter(prefix="/api/webpush")
_lock = threading.Lock()
_sending: set[asyncio.Task] = set()
STALE = timedelta(minutes=15)  # a notification that arrives by sync this long after it was made is old news


def _dir() -> Path:
    path = Path(settings.webpush_dir).expanduser()
    path.mkdir(parents=True, exist_ok=True)
    return path


def _load() -> dict[str, list[dict]]:
    try:
        return json.loads((_dir() / "webpush.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _save(data: dict[str, list[dict]]):
    (_dir() / "webpush.json").write_text(json.dumps(data), encoding="utf-8")


def subscriptions(username: str) -> list[dict]:
    return _load().get(username, [])


def add(username: str, sub: dict):
    with _lock:
        data = _load()
        mine = [s for s in data.get(username, []) if s.get("endpoint") != sub["endpoint"]]
        data[username] = mine + [sub]
        _save(data)


def remove(username: str, endpoint: str | None = None):
    with _lock:
        data = _load()
        data[username] = [s for s in data.get(username, []) if endpoint and s.get("endpoint") != endpoint]
        _save(data)


def _vapid_file() -> Path:
    path = _dir() / "vapid-private.pem"
    if not path.exists():
        key = Vapid()
        key.generate_keys()
        key.save_key(str(path))
    return path


def public_key() -> str:
    """What the browser needs to subscribe: the Hub's public key, as base64url of the uncompressed point."""
    raw = Vapid.from_file(str(_vapid_file())).public_key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _send_one(sub: dict, payload: dict) -> str:
    """'ok', 'gone' (the phone no longer wants it: forget it) or 'failed'. Blocking: run in a thread."""
    try:
        webpush(subscription_info=sub, data=json.dumps(payload), vapid_private_key=str(_vapid_file()), vapid_claims={"sub": settings.webpush_subject},
                ttl=86400, headers={"Urgency": "high"}, timeout=15)
        return "ok"
    except WebPushException as exc:
        status = getattr(exc.response, "status_code", None)
        log.info("Web push refused (%s)", status or type(exc).__name__)
        return "gone" if status in (404, 410) else "failed"
    except Exception as exc:  # no internet and the like: the Hub's own bell still has it
        log.info("Web push not sent (%s)", type(exc).__name__)
        return "failed"


async def _send(username: str, payload: dict) -> int:
    sent = 0
    for sub in subscriptions(username):
        result = await asyncio.to_thread(_send_one, sub, payload)
        if result == "ok":
            sent += 1
        elif result == "gone":
            remove(username, sub.get("endpoint"))
    return sent


def _payload(title: str, body: str, href: str) -> dict:
    url = "./" + (href if href.startswith("#") else "#/home")
    return {"title": title, "body": body or "", "url": url}


async def to_people(db: AsyncSession, user_ids, title: str, body: str = "", href: str = ""):
    """Sends to the phones subscribed on this Hub, without making the caller wait."""
    if webpush is None or not user_ids or not any(_load().values()):
        return
    names = (await db.execute(select(User.username).where(User.id.in_(user_ids)))).scalars().all()
    for name in names:
        if subscriptions(name):
            task = asyncio.create_task(_send(name, _payload(title, body, href)))
            _sending.add(task)
            task.add_done_callback(_sending.discard)


async def loop():
    """What arrives by sync (made on another computer) is sent from here to the phones subscribed here. What is made here is sent as
    it is made, so ids made on this computer are skipped."""
    from . import sync
    if webpush is None or not settings.sync:
        return
    async with SessionLocal() as db:
        start = (await db.execute(select(func.max(Notification.id)))).scalar() or 0
    seen: set[int] = set()
    while True:
        await asyncio.sleep(4)
        try:
            if not any(_load().values()):
                continue
            async with SessionLocal() as db:
                rows = (await db.execute(select(Notification).where(Notification.id > start).order_by(Notification.id))).scalars().all()
                names = {u.id: u.username for u in (await db.execute(select(User))).scalars()}
            for n in rows:
                if n.id in seen:
                    continue
                seen.add(n.id)
                made = n.created_at if n.created_at.tzinfo else n.created_at.replace(tzinfo=timezone.utc)
                if n.id % 4 == sync.NODE or n.read_at or datetime.now(timezone.utc) - made > STALE:
                    continue
                name = names.get(n.user_id)
                if name and subscriptions(name):
                    task = asyncio.create_task(_send(name, _payload(n.title, n.body, n.href)))
                    _sending.add(task)
                    task.add_done_callback(_sending.discard)
        except Exception:  # try again next round
            log.exception("web push loop")


class Subscription(BaseModel):
    endpoint: str
    keys: dict[str, str]
    expirationTime: float | None = None


@router.get("/key")
async def key(user: User = Depends(current_user)):
    return {"available": webpush is not None, "key": public_key() if webpush is not None else None, "subscribed": len(subscriptions(user.username))}


@router.post("/subscribe")
async def subscribe(body: Subscription, user: User = Depends(current_user)):
    if webpush is None:
        raise HTTPException(409, "This Hub cannot send web push (pywebpush is not installed)")
    if not body.endpoint.startswith("https://") or not {"p256dh", "auth"} <= set(body.keys):
        raise HTTPException(422, "Not a push subscription")
    add(user.username, body.model_dump())
    return {"subscribed": len(subscriptions(user.username))}


@router.delete("/subscribe")
async def unsubscribe(user: User = Depends(current_user)):
    remove(user.username)
    return {"subscribed": 0}


@router.post("/test")
async def test(user: User = Depends(current_user)):
    if webpush is None or not subscriptions(user.username):
        raise HTTPException(409, "No phone is subscribed on this Hub")
    return {"sent": await _send(user.username, _payload("Agente AMG", f"{user.display_name}, as notificações da app estão ligadas.", "#/home"))}
