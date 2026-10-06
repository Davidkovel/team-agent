"""The daily clock ("bater o ponto"). Each person starts it when they begin to work, from the Hub or the widget, and can
stop it and start it again: the day's hours are the sum of the stretches it ran. Every Hub and every widget sees it at once.

The day is the server computer's local date, so everybody shares one "today".
"""
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .models import Ponto, User
from .realtime import rt
from .services import iso, log_activity


def today() -> str:
    return datetime.now().astimezone().date().isoformat()


async def punches(db: AsyncSession, day: str | None = None) -> dict[int, datetime]:
    """user id -> when that person clocked in on `day` (today by default)."""
    rows = await db.execute(select(Ponto).where(Ponto.day == (day or today())))
    # SQLite hands the time back without its zone; it was stored in UTC
    return {p.user_id: p.at if p.at.tzinfo else p.at.replace(tzinfo=timezone.utc) for p in rows.scalars()}


def _utc(at: datetime | None) -> datetime | None:
    return at if at is None or at.tzinfo else at.replace(tzinfo=timezone.utc)   # SQLite hands the time back without its zone


async def rows(db: AsyncSession, day: str | None = None) -> dict[int, Ponto]:
    """user id -> that person's clock on `day` (today by default)."""
    return {p.user_id: p for p in (await db.execute(select(Ponto).where(Ponto.day == (day or today())))).scalars()}


def state(p: Ponto | None) -> dict:
    """{at, running, worked_s, since}: the first clock-in of the day, whether the clock counts now, the seconds of the
    stretches already closed, and when the one running began. Hours so far = worked_s + (now - since) while running."""
    if p is None:
        return {"at": None, "running": False, "worked_s": 0, "since": None}
    running = p.running is None or bool(p.running)   # a row from before the clock could stop: it runs
    return {"at": iso(_utc(p.at)), "running": running, "worked_s": int(p.worked_s or 0),
            "since": iso(_utc(p.since or p.at)) if running else None}


async def board(db: AsyncSession) -> dict:
    """Today's clock of the whole team, in team order."""
    clocks = await rows(db)
    users = (await db.execute(select(User).order_by(User.id))).scalars()
    return {"day": today(), "people": [{"user": u.username, "name": u.display_name, **state(clocks.get(u.id))} for u in users]}


async def punch(db: AsyncSession, user: User) -> dict:
    """Starts `user`'s clock: the first time today it clocks them in, after a stop it counts again. Running, it changes nothing."""
    day = today()
    row = (await rows(db, day)).get(user.id)
    if row is not None and row.running is not None and not row.running:
        row.running, row.since = True, datetime.now(timezone.utc)
        await db.commit()
        await log_activity(db, user, "ponto", f"{user.display_name} retomou o ponto")
        await rt.publish("ponto", user.id, "team")
    existing = _utc(row.at) if row is not None else None
    if existing is None:
        db.add(Ponto(user_id=user.id, day=day))
        try:
            await db.commit()
        except IntegrityError:  # a double tap from two places at once: the first one wins
            await db.rollback()
        else:
            await log_activity(db, user, "ponto", f"{user.display_name} bateu o ponto")
            await rt.publish("ponto", user.id, "team")
    return {"user": user.username, "name": user.display_name, **state((await rows(db, day)).get(user.id))}


async def stop(db: AsyncSession, user: User) -> dict:
    """Stops `user`'s clock: what ran until now is kept and nothing more counts until it is started again."""
    row = (await rows(db)).get(user.id)
    if row is not None and (row.running is None or row.running):
        now = datetime.now(timezone.utc)
        row.worked_s = int(row.worked_s or 0) + max(0, int((now - _utc(row.since or row.at)).total_seconds()))
        row.running, row.since = False, None
        await db.commit()
        await log_activity(db, user, "ponto", f"{user.display_name} parou o ponto")
        await rt.publish("ponto", user.id, "team")
        row = (await rows(db)).get(user.id)
    return {"user": user.username, "name": user.display_name, **state(row)}
