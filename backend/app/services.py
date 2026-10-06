import time
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from .config import settings
from .models import (TASK_STAGE, Activity, AgentSession, AgentState, Approval, Meter, Notification, Subagent, Task, TaskEvent,
                     UsageRecord, User)
from . import hub, push, sync
from .realtime import rt
from .security import sees_all


def iso(dt: datetime | None) -> str | None:
    """Always with the timezone: SQLite hands back UTC times without one, and a browser would read those as local time."""
    if dt is None:
        return None
    return (dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)).isoformat()


def task_out(t: Task, completed_by: str | None = None) -> dict:
    return {
        "id": t.id, "title": t.title, "description": t.description, "goal": t.goal,
        "requirements": t.requirements, "project": t.project,
        "assignee": t.assignee.username, "status": t.status, "progress": t.progress,
        "current_action": t.current_action, "last_action": t.last_action,
        "next_action": t.next_action, "result": t.result, "session_id": t.session_id,
        "created_at": iso(t.created_at), "updated_at": iso(t.updated_at),
        "started_at": iso(t.started_at), "completed_at": iso(t.completed_at),
        "stage": TASK_STAGE.get(t.status, "todo"), "priority": t.priority or "normal", "deadline": iso(t.deadline),
        "company": t.company or (t.project if t.project in hub.companies() else None),
        "project_id": t.project_id, "project_name": t.project_ref.name if t.project_ref else "",
        "agent_role": t.agent_role or "", "agent_instructions": t.agent_instructions or "",
        "git_branch": t.git_branch or "", "blocked_reason": t.blocked_reason or "",
        "trashed_at": iso(t.trashed_at), "trash_reason": t.trash_reason,
        "created_by": t.creator.username if t.creator else None,
        # who finished it, which is not always the person it was for (see finishers)
        "completed_by": completed_by if t.status == "COMPLETED" else None,
    }


async def finishers(db: AsyncSession, task_ids: list[int] | None = None) -> dict[int, str]:
    """Who finished each task: the last status change written down for it is a "concluiu" (reopening it is a newer one).
    The activity log was always kept, by whoever pressed the button (or the agent), so this holds for old tasks too."""
    query = select(Activity.task_id, Activity.message, User.username).join(User, User.id == Activity.user_id) \
        .where(Activity.kind == "task_status", Activity.task_id.is_not(None)).order_by(Activity.id)
    if task_ids is not None:
        query = query.where(Activity.task_id.in_(task_ids))
    last: dict[int, tuple[str, str]] = {}
    for task_id, message, username in (await db.execute(query)).all():
        last[task_id] = (message, username)
    return {task_id: username for task_id, (message, username) in last.items() if message.startswith("concluiu")}


TRASH_HOURS = 7  # how long a task stays in the bin, recoverable, before it is deleted for good


def not_mistake():
    """A task put in the bin as a mistake never happened: every list and count leaves it out (a finished one stays)."""
    return Task.trash_reason.is_distinct_from("mistake")


def purge_at(t: Task) -> str | None:
    """When the bin deletes the task for good (None for a task that is not in the bin)."""
    return None if t.trashed_at is None else iso(t.trashed_at + timedelta(hours=TRASH_HOURS))


async def delete_tasks(db: AsyncSession, ids: list[int]):
    """Deletes tasks for good. What other records say about them stays (their cost, the activity feed), without the link."""
    if not ids:
        return
    # plain DELETE/UPDATE: the other computers only hear about these rows through sync.note
    await sync.note(db, TaskEvent, (await db.execute(select(TaskEvent.id).where(TaskEvent.task_id.in_(ids)))).scalars().all(), deleted=True)
    await db.execute(delete(TaskEvent).where(TaskEvent.task_id.in_(ids)))
    for model in (Approval, Activity, UsageRecord, AgentSession):
        await sync.note(db, model, (await db.execute(select(model.id).where(model.task_id.in_(ids)))).scalars().all())
        await db.execute(update(model).where(model.task_id.in_(ids)).values(task_id=None))
    await sync.note(db, Task, ids, deleted=True)
    await db.execute(delete(Task).where(Task.id.in_(ids)))
    await db.commit()


async def purge_trash(db: AsyncSession):
    """Deletes what has been in the bin for TRASH_HOURS. Runs when the Hub starts and whenever the board or the bin is read."""
    cutoff = datetime.now(timezone.utc) - timedelta(hours=TRASH_HOURS)
    await delete_tasks(db, list((await db.execute(select(Task.id).where(Task.trashed_at < cutoff))).scalars()))


def event_out(e: TaskEvent) -> dict:
    return {"id": e.id, "kind": e.kind, "message": e.message, "data": e.data, "created_at": iso(e.created_at)}


def approval_out(a: Approval) -> dict:
    return {
        "id": a.id, "task_id": a.task_id, "user": a.user.username, "action": a.action,
        "detail": a.detail, "status": a.status,
        "created_at": iso(a.created_at), "decided_at": iso(a.decided_at),
        "user_name": a.user.display_name, "risk": a.risk or "", "kind": a.kind or "",
        "files": a.files or [], "diff": a.diff or "",
    }


def session_out(s: AgentSession) -> dict:
    return {
        "id": s.id, "user": s.user.username, "user_name": s.user.display_name, "task_id": s.task_id, "kind": s.kind,
        "model": s.model, "status": s.status, "current_action": s.current_action,
        "tokens": {"input": s.input_tokens, "output": s.output_tokens, "cache_read": s.cache_read_tokens,
                   "cache_creation": s.cache_creation_tokens, "total": s.input_tokens + s.output_tokens},
        "tool_uses": s.tool_uses, "cost_usd": None if s.cost_usd is None else round(s.cost_usd, 4),
        "started_at": iso(s.started_at), "finished_at": iso(s.finished_at),
    }


def subagent_out(a: Subagent) -> dict:
    return {
        "id": a.id, "session_id": a.session_id, "parent_id": a.parent_id, "name": a.name, "role": a.role,
        "status": a.status, "task": a.task, "model": a.model, "tools": a.tools or [],
        "total_tokens": a.total_tokens, "tool_uses": a.tool_uses,
        "started_at": iso(a.started_at), "finished_at": iso(a.finished_at),
    }


async def notify(db: AsyncSession, user_ids, kind: str, severity: str, title: str, body: str = "", href: str = "",
                 directed: bool = False):
    """Write a notification for each of these people. Only for events worth interrupting someone."""
    targets = set(user_ids)
    for user_id in targets:
        db.add(Notification(user_id=user_id, kind=kind, severity=severity, title=title[:200], body=body, href=href, directed=directed))
    await db.commit()
    for user_id in targets:
        await rt.publish("notification", user_id)
    await push.to_people(db, targets, title[:200], body, severity, href)


async def deciders(db: AsyncSession) -> list[int]:
    """Who may approve or reject: everyone in team mode, otherwise the owners."""
    users = (await db.execute(select(User))).scalars()
    return [u.id for u in users if sees_all(u)]


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
            "where": (presence.get("where") or ["pc"]) if presence else [],  # an agent or an older Hub elsewhere: a computer
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


def where(user_id: int, agent: bool = False) -> list[str]:
    """Where the person is at this computer's Hub: "pc" (the widget, the agent or a Hub window on a computer), "phone"."""
    found = {c.device for c in rt.connections if c.kind == "dashboard" and c.user_id == user_id}
    if agent or widget_recent(user_id):
        found.add("pc")
    return sorted(found)


async def _refresh_where(user_id: int, current: dict):
    """The agent owns the status: only say again where the person is, when that changed."""
    places = where(user_id, agent=True)
    if current.get("where") != places:
        await rt.store.set_presence(user_id, {**current, "where": places}, settings.heartbeat_timeout)
        await rt.publish("presence", user_id, "team")


async def hub_seen(user_id: int, via: str = "hub") -> bool:
    """The person's Hub/widget is open, so they are online. Returns True when this made them newly online."""
    current = await rt.store.get_presence(user_id)
    if current is not None and current.get("via") not in SOFT_VIA:
        if not current.get("remote"):
            await _refresh_where(user_id, current)
        return False  # the agent's own heartbeat owns the status while it is alive
    places = where(user_id)
    await rt.store.set_presence(user_id, {"status": "ONLINE", "via": via, "where": places, "task": "", "progress": 0, "last_seen": time.time()}, SOFT_TTL)
    if current is not None and current.get("where") != places:
        await rt.publish("presence", user_id, "team")
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
        await hub_seen(user_id, "widget" if widget_recent(user_id) else "hub")  # still here, maybe no longer on the phone
        return
    current = await rt.store.get_presence(user_id)
    if current is None or current.get("via") not in SOFT_VIA:
        return
    await rt.store.clear_presence(user_id)
    await rt.publish("presence", user_id, "team")
