"""Notifications on the phone, through ntfy (https://ntfy.sh): no account, the person installs the ntfy app and follows
their own topic. The topic name is the only secret, so it is long and random; what goes out is what the Hub's bell shows
(title and one line), nothing else. The phone never talks to the Hub.

Only the Hub where a notification is made sends it: the other computers get the row by sync and stay quiet.
"""
import asyncio
import logging
import secrets

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import settings
from .db import get_db
from .models import User
from .security import current_user

log = logging.getLogger("team.push")
PRIORITY = {"high": 5, "medium": 4, "low": 3}  # ntfy: 5 rings through "do not disturb" exceptions, 3 is a normal notification
_sending: set[asyncio.Task] = set()


async def _post(topic: str, title: str, body: str, severity: str) -> bool:
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            message = {"topic": topic, "title": title, "message": body or title, "priority": PRIORITY.get(severity, 3), "tags": ["racing_car"]}
            if settings.ntfy_icon:
                message["icon"] = settings.ntfy_icon
            res = await client.post(settings.ntfy_url, json=message)
        return res.status_code < 300
    except httpx.HTTPError as exc:
        log.info("Phone notification not sent (%s)", type(exc).__name__)  # no internet: the Hub's own bell still has it
        return False


async def to_people(db: AsyncSession, user_ids, title: str, body: str, severity: str):
    """Sends to the phones of these people, without making the caller wait for the internet."""
    if not settings.ntfy_url or not user_ids:
        return
    topics = (await db.execute(select(User.phone_topic).where(User.id.in_(user_ids), User.phone_topic.is_not(None)))).scalars().all()
    for topic in topics:
        task = asyncio.create_task(_post(topic, title, body, severity))
        _sending.add(task)
        task.add_done_callback(_sending.discard)


router = APIRouter(prefix="/api/phone")


def phone_out(user: User) -> dict:
    server = settings.ntfy_url.rstrip("/")
    return {"topic": user.phone_topic, "server": server, "url": f"{server}/{user.phone_topic}" if user.phone_topic else None}


@router.get("")
async def phone(user: User = Depends(current_user)):
    return phone_out(user)


@router.post("")
async def phone_on(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    """This person's topic, made the first time it is asked for."""
    if not settings.ntfy_url:
        raise HTTPException(409, "Phone notifications are switched off on this Hub")
    me = await db.get(User, user.id)
    if not me.phone_topic:
        me.phone_topic = f"amg-{secrets.token_urlsafe(18)}"
        await db.commit()
    return phone_out(me)


@router.delete("")
async def phone_off(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    """Forgets the topic: nothing more goes to that phone, and a new topic is made next time."""
    me = await db.get(User, user.id)
    me.phone_topic = None
    await db.commit()
    return phone_out(me)


@router.post("/test")
async def phone_test(user: User = Depends(current_user)):
    if not user.phone_topic:
        raise HTTPException(409, "No phone yet")
    return {"sent": await _post(user.phone_topic, "Agente AMG", f"{user.display_name}, o telemóvel está ligado ao Hub.", "low")}
