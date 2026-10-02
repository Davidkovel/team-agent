"""The weekly ledger: who showed up, who did what, who still owes what. One row per person.

Sources: logins and edits (activity log), tasks (done / still open) and commits (git, matched to people by the
aliases in library/people.json). Rows marked company="__demo__" / project="__demo__" are sample data, flagged `demo`.
"""
import asyncio
import json
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from . import commits, hub, worktree
from .models import Activity, Task, User

DAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"]
OPEN = ("ASSIGNED", "IN_PROGRESS", "WAITING_APPROVAL", "PAUSED", "NEEDS_HELP")
DEMO = "__demo__"
FEED_KINDS = {"login", "library_edit", "task_done", "task_created", "user_created"}
KEY_KINDS = ("task_done", "commit", "task_created", "library_edit")  # what goes in the day-by-day report; logins don't


def _utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _sentence(a: Activity, name: str) -> str:
    """One short line for the feed, without repeating the person's name."""
    if a.kind == "login":
        return "entrou no Hub"
    if a.kind == "task_done":
        return "concluiu: " + a.message.split(": ", 1)[-1]
    msg = a.message
    for old in (name, name.lower()):
        if msg.startswith(old):
            msg = msg[len(old):].strip()
    return msg or a.kind


def week_start(now: datetime) -> datetime:
    local = now.astimezone()
    return (local - timedelta(days=local.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)


def aliases() -> dict[str, list[str]]:
    try:
        raw = json.loads((hub.library_dir() / "people.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return {k: [a.lower() for a in v] for k, v in raw.items() if isinstance(v, list)}


def person_for(author: str, users: list[User], alias_map: dict[str, list[str]]) -> User | None:
    low = author.lower().strip()
    for u in users:  # exact alias / name first
        if low in alias_map.get(u.username, []) or low in (u.display_name.lower(), u.username.lower()):
            return u
    for u in users:
        if any(a and a in low for a in alias_map.get(u.username, []) + [u.display_name.lower()]):
            return u
    return None


async def summary(db: AsyncSession, now: datetime | None = None, with_commits: bool = True) -> dict:
    now = (now or datetime.now(timezone.utc)).astimezone()
    start = week_start(now)
    users = list((await db.execute(select(User).order_by(User.id))).scalars())
    alias_map = aliases()
    rows = {u.id: {"user": u.username, "name": u.display_name, "days": [0] * 7, "logins": 0, "last_login": None, "commits": 0,
                   "added": 0, "deleted": 0, "tasks_done": 0, "tasks_open": 0, "edits": 0, "last_activity": None} for u in users}
    feed, demo = [], False

    for a in (await db.execute(select(Activity).order_by(Activity.id.desc()).limit(600))).scalars():
        when = _utc(a.created_at)
        if when is None or when.astimezone() < start or a.user_id not in rows:
            continue
        r = rows[a.user_id]
        demo = demo or a.company == DEMO
        r["last_activity"] = r["last_activity"] or when.isoformat()
        if a.kind == "login":
            r["days"][when.astimezone().weekday()] = 1
            r["logins"] += 1
            r["last_login"] = r["last_login"] or when.isoformat()
        elif a.kind == "library_edit":
            r["edits"] += 1
        if a.kind in FEED_KINDS:
            feed.append({"when": when.isoformat(), "who": r["name"], "what": a.kind, "text": _sentence(a, r["name"])})

    for t in (await db.execute(select(Task))).scalars():
        r = rows.get(t.assignee_id)
        if not r:
            continue
        demo = demo or t.project == DEMO
        done_at = _utc(t.completed_at)
        if t.status == "COMPLETED" and done_at and done_at.astimezone() >= start:
            r["tasks_done"] += 1
        elif t.status in OPEN:
            r["tasks_open"] += 1

    if with_commits:
        for c in await asyncio.to_thread(commits.recent, 100):
            when = datetime.fromisoformat(c["date"].replace("Z", "+00:00"))
            if when.astimezone() < start:
                continue
            u = person_for(c["author"], users, alias_map)
            if not u:
                continue
            r = rows[u.id]
            r["commits"] += 1
            r["added"] += (c.get("stats") or {}).get("added", 0)
            r["deleted"] += (c.get("stats") or {}).get("deleted", 0)
            if not r["last_activity"] or when.isoformat() > r["last_activity"]:
                r["last_activity"] = when.isoformat()
            feed.append({"when": when.isoformat(), "who": r["name"], "what": "commit", "text": f"commit em {c['repo']}: {c['message']}"})

    feed.sort(key=lambda f: f["when"], reverse=True)
    by_day = [[] for _ in DAYS]
    for f in feed:
        if f["what"] in KEY_KINDS:
            by_day[datetime.fromisoformat(f["when"]).astimezone().weekday()].append(f)
    for items in by_day:
        items.sort(key=lambda f: (KEY_KINDS.index(f["what"]), f["when"]))
    people = list(rows.values())
    for r in people:
        r["status"] = "ativo" if (r["logins"] or r["commits"] or r["tasks_done"] or r["edits"]) else "parado"
    iso_year, iso_week, _ = start.isocalendar()
    return {"week": iso_week, "from": start.date().isoformat(), "to": (start + timedelta(days=6)).date().isoformat(), "days": DAYS,
            "today": now.weekday(), "demo": demo, "people": people, "feed": feed[:10], "by_day": by_day,
            "pending": await asyncio.to_thread(worktree.pending)}
