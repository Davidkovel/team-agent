import time
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import settings
from .models import Activity, AgentState, Approval, Meter, Task, TaskEvent, UsageRecord, User
from . import hub
from .realtime import rt
from .security import sees_all


def iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


def task_out(t: Task) -> dict:
    return {
        "id": t.id, "title": t.title, "description": t.description, "goal": t.goal,
        "requirements": t.requirements, "project": t.project,
        "assignee": t.assignee.username, "status": t.status, "progress": t.progress,
        "current_action": t.current_action, "last_action": t.last_action,
        "next_action": t.next_action, "result": t.result, "session_id": t.session_id,
        "created_at": iso(t.created_at), "updated_at": iso(t.updated_at),
        "started_at": iso(t.started_at), "completed_at": iso(t.completed_at),
    }


def event_out(e: TaskEvent) -> dict:
    return {"id": e.id, "kind": e.kind, "message": e.message, "data": e.data, "created_at": iso(e.created_at)}


def approval_out(a: Approval) -> dict:
    return {
        "id": a.id, "task_id": a.task_id, "user": a.user.username, "action": a.action,
        "detail": a.detail, "status": a.status,
        "created_at": iso(a.created_at), "decided_at": iso(a.decided_at),
    }


async def log_activity(db: AsyncSession, user: User, kind: str, message: str, task_id: int | None = None,
                       company: str | None = None):
    if company is None and task_id is not None:
        task = await db.get(Task, task_id)  # a task created for a company counts as work for that company
        if task and task.project in hub.companies():
            company = task.project
    db.add(Activity(user_id=user.id, task_id=task_id, kind=kind, message=message, company=company))
    await db.commit()
    await rt.publish("activity", user.id)


async def usage_numbers(db: AsyncSession) -> tuple[dict, dict, float]:
    """Claude spend of the last 7 days per user, the service meters (Higgsfield credits), and the weekly budget."""
    since = datetime.now(timezone.utc) - timedelta(days=7)
    week_cost = dict((await db.execute(
        select(UsageRecord.user_id, func.sum(UsageRecord.cost_usd)).where(UsageRecord.created_at >= since)
        .group_by(UsageRecord.user_id))).all())
    meters = {(m.user_id, m.service): m.pct for m in (await db.execute(select(Meter))).scalars()}
    return week_cost, meters, settings.weekly_budget_usd


def usage_fields(user_id: int, week_cost: dict, meters: dict, budget: float) -> dict:
    cost = week_cost.get(user_id) or 0
    return {"week_cost_usd": round(cost, 2), "week_budget_usd": budget,
            "week_pct": min(100, round(cost / budget * 100)) if budget else None,
            "higgsfield_pct": meters.get((user_id, "higgsfield"))}


async def team_view(db: AsyncSession, viewer: User) -> list[dict]:
    """Owner and the agent's own user see full state; teammates see the
    permitted Team information only: status, task title, progress."""
    users = (await db.execute(select(User).order_by(User.id))).scalars().all()
    states = {s.user_id: s for s in (await db.execute(select(AgentState))).scalars()}
    week_cost, meters, budget = await usage_numbers(db)
    out = []
    for u in users:
        presence = await rt.store.get_presence(u.id)
        saved = states.get(u.id)
        entry = {
            "user": u.username, "display_name": u.display_name, "role": "equipa" if settings.team_mode else u.role,
            "status": presence["status"] if presence else "OFFLINE",
            "task": presence.get("task", "") if presence else "",
            "progress": presence.get("progress", 0) if presence else 0,
            "last_seen": iso(saved.last_seen) if saved else None,
            **usage_fields(u.id, week_cost, meters, budget),
        }
        if presence and (sees_all(viewer) or viewer.id == u.id):
            for key in ("task_id", "current_action", "last_action", "next_action", "error", "usage", "started_at"):
                entry[key] = presence.get(key)
        out.append(entry)
    return out


async def save_agent_state(db: AsyncSession, user_id: int, status: str, seen: bool = True):
    state = await db.get(AgentState, user_id)
    if not state:
        state = AgentState(user_id=user_id)
        db.add(state)
    state.status = status
    if seen:
        state.last_seen = datetime.now(timezone.utc)
    await db.commit()


# ---- "online" without an agent: having the Hub or the widget open counts ----
# Connections only touch the live presence store; the database bookkeeping (last_seen, the "ficou online"/"saiu" lines in
# the history) is done by one background task, in order (see presence_watcher in main.py). A WebSocket that closes never
# writes to the database, so nothing is left half-written when it is cancelled.
SOFT_VIA = ("hub", "widget")  # presence that comes from an open Hub/widget; a live agent heartbeat always wins over it
SOFT_TTL = 90                 # a Hub tab pings every ~10 s; browsers may slow a background tab to about once a minute
WIDGET_SEEN: dict[int, float] = {}  # user id -> when this computer's widget last pinged (per process; the TTL covers the rest)
ONLINE_VIA: dict[int, str] = {}     # how each online person got online: "agent", "hub" or "widget"
PENDING_ONLINE: set[int] = set()    # became online through the Hub/widget; the watcher still has to write that down


def widget_recent(user_id: int, within: float = 40) -> bool:
    return time.time() - WIDGET_SEEN.get(user_id, 0) < within


def dashboard_open(user_id: int) -> bool:
    return any(c.kind == "dashboard" and c.user_id == user_id for c in rt.connections)


async def hub_seen(user_id: int, via: str = "hub") -> bool:
    """The person's Hub/widget is open, so they are online. Returns True when this made them newly online."""
    current = await rt.store.get_presence(user_id)
    if current is not None and current.get("via") not in SOFT_VIA:
        return False  # the agent's own heartbeat owns the status while it is alive
    await rt.store.set_presence(user_id, {"status": "ONLINE", "via": via, "task": "", "progress": 0, "last_seen": time.time()}, SOFT_TTL)
    if current is not None:
        return False
    if user_id not in rt.online:
        ONLINE_VIA[user_id] = via
        PENDING_ONLINE.add(user_id)
    await rt.publish("presence", user_id, "team")
    return True


async def hub_gone(user_id: int):
    """The last Hub window closed: drop the presence now instead of waiting for the TTL (unless the widget still vouches for them)."""
    if widget_recent(user_id) or dashboard_open(user_id):
        return
    current = await rt.store.get_presence(user_id)
    if current is None or current.get("via") not in SOFT_VIA:
        return
    await rt.store.clear_presence(user_id)
    await rt.publish("presence", user_id, "team")
