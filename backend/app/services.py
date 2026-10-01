from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import Activity, AgentState, Approval, Task, TaskEvent, User
from .realtime import rt


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


async def log_activity(db: AsyncSession, user: User, kind: str, message: str, task_id: int | None = None):
    db.add(Activity(user_id=user.id, task_id=task_id, kind=kind, message=message))
    await db.commit()
    await rt.publish("activity", user.id)


async def team_view(db: AsyncSession, viewer: User) -> list[dict]:
    """Owner and the agent's own user see full state; teammates see the
    permitted Team information only: status, task title, progress."""
    users = (await db.execute(select(User).order_by(User.id))).scalars().all()
    states = {s.user_id: s for s in (await db.execute(select(AgentState))).scalars()}
    out = []
    for u in users:
        presence = await rt.store.get_presence(u.id)
        saved = states.get(u.id)
        entry = {
            "user": u.username, "display_name": u.display_name, "role": u.role,
            "status": presence["status"] if presence else "OFFLINE",
            "task": presence.get("task", "") if presence else "",
            "progress": presence.get("progress", 0) if presence else 0,
            "last_seen": iso(saved.last_seen) if saved else None,
        }
        if presence and (viewer.role == "owner" or viewer.id == u.id):
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
