"""The daily clock-in ("bater o ponto"). Each person taps once a day, from the Hub or the widget;
every Hub and every widget sees it at once and tells its person.

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


async def board(db: AsyncSession) -> dict:
    """Today's clock-in for the whole team, in team order."""
    done = await punches(db)
    users = (await db.execute(select(User).order_by(User.id))).scalars()
    return {"day": today(), "people": [{"user": u.username, "name": u.display_name, "at": iso(done.get(u.id))} for u in users]}


async def punch(db: AsyncSession, user: User) -> dict:
    """Clocks `user` in for today. Tapping again the same day changes nothing."""
    day = today()
    existing = (await punches(db, day)).get(user.id)
    if existing is None:
        db.add(Ponto(user_id=user.id, day=day))
        try:
            await db.commit()
        except IntegrityError:  # a double tap from two places at once: the first one wins
            await db.rollback()
        else:
            await log_activity(db, user, "ponto", f"{user.display_name} bateu o ponto")
            await rt.publish("ponto", user.id, "team")
        existing = (await punches(db, day)).get(user.id)
    return {"user": user.username, "name": user.display_name, "at": iso(existing)}
