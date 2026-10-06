"""The Claude plan limits (Sessão 5 h, Semana) of the person this computer belongs to, for the Hub's side panel.

The widget keeps them in ~/.team-agent/claude_usage.json (widget/team_widget/limits.py asks the Claude account every few
minutes; scripts/claude_statusline.py writes them too). The Hub only reads that file, with the widget's own rule: a window
counts while it is recent and before its reset.

Each Hub also writes its own person's two windows into their meters (claude_5h, claude_week), and sync carries those rows
to the other PCs: that is how one person sees how much of the plan the others still have.
"""
import asyncio
import json
import logging
import time
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select

from . import sync
from .config import settings
from .db import SessionLocal
from .models import Meter, User

log = logging.getLogger("limits")
SERVICES = {"five": "claude_5h", "week": "claude_week"}
PUBLISH_EVERY = 60

USAGE = Path.home() / ".team-agent" / "claude_usage.json"
FIVE_MAX_AGE = 5 * 3600     # the session window is 5 hours long
WEEK_MAX_AGE = 24 * 3600    # the week moves slowly: a day-old figure is still worth seeing


def is_owner(username: str) -> bool:
    """Is this the person whose computer the Hub runs on? With the VPN down nobody can be told apart, so it is."""
    me = sync.whoami()
    return me is None or me[1] == username


def _reset(limit) -> float | None:
    v = (limit or {}).get("resets_at")
    if isinstance(v, (int, float)):
        return float(v)
    try:
        return datetime.fromisoformat(v.replace("Z", "+00:00")).timestamp() if isinstance(v, str) else None
    except ValueError:
        return None


def _fresh(limit, age: float, max_age: float, now: float):
    """(used %, reset) of a window still true now, else (None, None)."""
    if not isinstance(limit, dict) or limit.get("used_percentage") is None or age > max_age:
        return None, None
    reset = _reset(limit)
    return (None, None) if reset is not None and reset <= now else (limit["used_percentage"], reset)


def plan(path: Path = USAGE, now: float | None = None) -> dict | None:
    """{five, five_reset, week, week_reset, saved_at}, or None when nothing recent was saved on this computer."""
    now = time.time() if now is None else now
    try:
        saved = json.loads(Path(path).read_text(encoding="utf-8"))
        limits, age = saved["rate_limits"], now - float(saved["saved_at"])
    except (OSError, ValueError, KeyError, TypeError):
        return None
    week, week_reset = _fresh(limits.get("seven_day"), age, WEEK_MAX_AGE, now)
    five, five_reset = _fresh(limits.get("five_hour"), age, FIVE_MAX_AGE, now)
    if week is None and five is None:
        return None
    return {"five": five, "five_reset": five_reset, "week": week, "week_reset": week_reset, "saved_at": saved["saved_at"]}


# ---------------------------------------------------------------- the team's windows, by sync

def _utc(at: datetime | None) -> datetime | None:
    return at if at is None or at.tzinfo else at.replace(tzinfo=timezone.utc)   # SQLite hands the time back without its zone


async def publish(db, data: dict | None = None) -> bool:
    """Writes the windows of this computer's person into their meters, only when a figure moved. True when it wrote."""
    me, data = sync.whoami(), plan() if data is None else data
    if me is None or data is None:
        return False
    user = (await db.execute(select(User).where(User.username == me[1]))).scalar_one_or_none()
    if user is None:
        return False
    wrote = False
    for key, service in SERVICES.items():
        pct, reset = data.get(key), data.get(f"{key}_reset")
        if pct is None:
            if key == "week":
                continue
            pct, reset = 0, None   # no session open: nothing of the next one is used
        pct, reset_at = round(pct), datetime.fromtimestamp(reset, timezone.utc) if reset else None
        meter = await db.get(Meter, (user.id, service))
        if meter is None:
            meter = Meter(user_id=user.id, service=service)
            db.add(meter)
        else:
            old = _utc(meter.resets_at)
            same_reset = (old is None) == (reset_at is None) and (old is None or abs((old - reset_at).total_seconds()) < 120)
            if meter.pct == pct and same_reset:
                continue   # the reset time wobbles by a few seconds each reading: that is not news
        meter.pct, meter.resets_at, wrote = pct, reset_at, True
    if wrote:
        await db.commit()
    return wrote


async def team(db, now: datetime | None = None) -> dict[str, dict]:
    """login -> {five, five_reset, week, week_reset, seen}: each person's windows as their own computer last wrote them.
    A window whose reset has passed counts as 0: it started again, whatever the old figure was."""
    now = now or datetime.now(timezone.utc)
    names = {u.id: u.username for u in (await db.execute(select(User))).scalars()}
    out: dict[str, dict] = {}
    for m in (await db.execute(select(Meter).where(Meter.service.in_(SERVICES.values())))).scalars():
        key = next(k for k, service in SERVICES.items() if service == m.service)
        reset, seen = _utc(m.resets_at), _utc(m.updated_at)
        renewed = reset is not None and reset <= now
        entry = out.setdefault(names.get(m.user_id, str(m.user_id)), {"five": None, "five_reset": None, "week": None, "week_reset": None, "seen": None})
        entry[key] = 0 if renewed else m.pct
        entry[f"{key}_reset"] = None if renewed or reset is None else reset.timestamp()
        if seen and (entry["seen"] is None or seen.isoformat() > entry["seen"]):
            entry["seen"] = seen.isoformat()
    return out


async def loop():
    if not settings.sync:
        return
    while True:
        try:
            async with SessionLocal() as db:
                await publish(db)
        except Exception:  # the file is being written, the database is busy...: next minute
            log.exception("could not publish the Claude limits")
        await asyncio.sleep(PUBLISH_EVERY)
