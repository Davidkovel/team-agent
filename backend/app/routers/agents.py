"""Agents as people see them, and the reports a Local Team Agent sends about its AI runs.

Four different things, never mixed up:
- User: a person.
- Team Agent: the background process on that person's computer (one per person). Its live state is the presence.
- AgentSession: one run of the AI by that agent (a task, a question from the Hub, a weekly report).
- Subagent: an agent spawned inside a session (research, coding, testing, review).
"""
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..models import Activity, AgentSession, Subagent, Task, TaskEvent, User
from ..realtime import rt
from ..security import agent_user, current_user, sees_all
from ..services import event_out, iso, session_out, subagent_out, task_out, team_view

router = APIRouter(prefix="/api")


class SessionStart(BaseModel):
    task_id: int | None = None
    kind: Literal["task", "chat", "weekly_report"] = "task"
    model: str = ""


class SessionUpdate(BaseModel):
    claude_session_id: str | None = None
    model: str | None = None
    status: Literal["RUNNING", "DONE", "ERROR", "INTERRUPTED"] | None = None
    current_action: str | None = None
    input_tokens: int | None = Field(None, ge=0)
    output_tokens: int | None = Field(None, ge=0)
    cache_read_tokens: int | None = Field(None, ge=0)
    cache_creation_tokens: int | None = Field(None, ge=0)
    tool_uses: int | None = Field(None, ge=0)
    cost_usd: float | None = Field(None, ge=0)


class SubagentIn(BaseModel):
    external_id: str
    name: str = ""
    role: str = ""
    status: Literal["RUNNING", "DONE", "ERROR", "STOPPED"] = "RUNNING"
    task: str = ""
    model: str = ""
    tools: list[str] | None = None
    total_tokens: int | None = None
    tool_uses: int | None = None
    parent_external_id: str | None = None


def can_see(viewer: User, owner_id: int) -> bool:
    return sees_all(viewer) or viewer.id == owner_id


async def subagents_of(db: AsyncSession, session_ids: list[int]) -> dict[int, list[dict]]:
    out: dict[int, list[dict]] = {i: [] for i in session_ids}
    if session_ids:
        rows = (await db.execute(select(Subagent).where(Subagent.session_id.in_(session_ids)).order_by(Subagent.id))).scalars()
        for a in rows:
            out[a.session_id].append(subagent_out(a))
    return out


async def agents_view(db: AsyncSession, viewer: User) -> list[dict]:
    """One entry per person's Team Agent: the live presence, plus the AI session it is running (when the viewer may see it)."""
    users = {u.username: u for u in (await db.execute(select(User))).scalars()}
    running = {}
    query = select(AgentSession).where(AgentSession.status == "RUNNING", AgentSession.kind == "task").order_by(AgentSession.id)
    for s in (await db.execute(query)).scalars():
        running[s.user_id] = s  # the newest one wins
    subs = await subagents_of(db, [s.id for s in running.values()])
    task_ids = [s.task_id for s in running.values() if s.task_id]
    tasks = {t.id: t for t in (await db.execute(select(Task).where(Task.id.in_(task_ids)))).scalars()} if task_ids else {}
    out = []
    for entry in await team_view(db, viewer):
        user = users[entry["user"]]
        session = running.get(user.id) if can_see(viewer, user.id) and entry["status"] != "OFFLINE" else None
        task = tasks.get(session.task_id) if session else None
        out.append({
            "id": user.username, "name": f"Claude / {user.display_name}", "user": user.username,
            "display_name": user.display_name, "status": entry["status"], "task": entry.get("task", ""),
            "task_id": entry.get("task_id"), "progress": entry.get("progress", 0),
            "current_action": entry.get("current_action") or "", "started_at": entry.get("started_at"),
            "last_seen": entry.get("last_seen"), "doing": entry.get("doing"),  # the task they said "Estou a fazer" on
            "project": (task.project_ref.name if task and task.project_ref else (task.project if task else "")) or "",
            "session": session_out(session) if session else None,
            "subagents": subs.get(session.id, []) if session else [],
        })
    return out


@router.get("/agents")
async def agents(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    return await agents_view(db, user)


@router.get("/agents/{username}")
async def agent_detail(username: str, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    entry = next((a for a in await agents_view(db, user) if a["id"] == username), None)
    if not entry:
        raise HTTPException(404, "Agent not found")
    owner = (await db.execute(select(User).where(User.username == username))).scalar_one()
    detail = {**entry, "task_detail": None, "events": [], "sessions": [], "activity": []}
    if not can_see(user, owner.id):
        return detail
    if entry["task_id"]:
        task = await db.get(Task, entry["task_id"])
        if task:
            events = (await db.execute(select(TaskEvent).where(TaskEvent.task_id == task.id)
                                       .order_by(TaskEvent.id.desc()).limit(40))).scalars()
            detail["task_detail"], detail["events"] = task_out(task), [event_out(e) for e in events][::-1]
    sessions = (await db.execute(select(AgentSession).where(AgentSession.user_id == owner.id)
                                 .order_by(AgentSession.id.desc()).limit(15))).scalars().all()
    subs = await subagents_of(db, [s.id for s in sessions])
    detail["sessions"] = [{**session_out(s), "subagents": subs[s.id]} for s in sessions]
    rows = (await db.execute(select(Activity).where(Activity.user_id == owner.id).order_by(Activity.id.desc()).limit(40))).scalars()
    detail["activity"] = [{"id": a.id, "kind": a.kind, "message": a.message, "task_id": a.task_id,
                           "created_at": iso(a.created_at)} for a in rows]
    return detail


@router.get("/sessions")
async def sessions(user_name: str | None = None, task_id: int | None = None, limit: int = 50,
                   user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    query = select(AgentSession).order_by(AgentSession.id.desc()).limit(min(max(limit, 1), 200))
    if not sees_all(user):
        query = query.where(AgentSession.user_id == user.id)
    if user_name:
        query = query.join(User, User.id == AgentSession.user_id).where(User.username == user_name)
    if task_id is not None:
        query = query.where(AgentSession.task_id == task_id)
    rows = (await db.execute(query)).scalars().all()
    subs = await subagents_of(db, [s.id for s in rows])
    return [{**session_out(s), "subagents": subs[s.id]} for s in rows]


@router.get("/subagents")
async def subagents(session_id: int | None = None, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    query = select(Subagent).join(AgentSession, AgentSession.id == Subagent.session_id).order_by(Subagent.id.desc()).limit(200)
    if not sees_all(user):
        query = query.where(AgentSession.user_id == user.id)
    if session_id is not None:
        query = query.where(Subagent.session_id == session_id)
    return [subagent_out(a) for a in (await db.execute(query)).scalars()]


# ---- reported by the Local Team Agent (agent-token auth) ----

async def own_session(session_id: int, user: User, db: AsyncSession) -> AgentSession:
    session = await db.get(AgentSession, session_id)
    if not session or session.user_id != user.id:
        raise HTTPException(404, "Session not found")
    return session


@router.post("/agent/sessions")
async def start_session(body: SessionStart, user: User = Depends(agent_user), db: AsyncSession = Depends(get_db)):
    if body.task_id is not None:
        task = await db.get(Task, body.task_id)
        if not task or task.assignee_id != user.id:
            raise HTTPException(404, "Task not found")
    now = datetime.now(timezone.utc)
    # One agent runs one session of a kind at a time: anything still "running" was cut short (crash, power off).
    stale = select(AgentSession).where(AgentSession.user_id == user.id, AgentSession.kind == body.kind, AgentSession.status == "RUNNING")
    for old in (await db.execute(stale)).scalars():
        old.status, old.finished_at = "INTERRUPTED", now
    session = AgentSession(user_id=user.id, **body.model_dump())
    db.add(session)
    await db.commit()
    await db.refresh(session)
    await rt.publish("session", user.id)
    return session_out(session)


@router.post("/agent/sessions/{session_id}")
async def update_session(session_id: int, body: SessionUpdate, user: User = Depends(agent_user), db: AsyncSession = Depends(get_db)):
    session = await own_session(session_id, user, db)
    for key, value in body.model_dump(exclude_none=True).items():
        setattr(session, key, value)
    if session.status != "RUNNING" and not session.finished_at:
        session.finished_at = datetime.now(timezone.utc)
        open_subs = select(Subagent).where(Subagent.session_id == session.id, Subagent.status == "RUNNING")
        for sub in (await db.execute(open_subs)).scalars():  # a subagent cannot outlive its session
            sub.status, sub.finished_at = "STOPPED", session.finished_at
    await db.commit()
    await rt.publish("session", user.id)
    return session_out(session)


@router.post("/agent/sessions/{session_id}/subagents")
async def report_subagent(session_id: int, body: SubagentIn, user: User = Depends(agent_user), db: AsyncSession = Depends(get_db)):
    session = await own_session(session_id, user, db)
    find = select(Subagent).where(Subagent.session_id == session.id, Subagent.external_id == body.external_id)
    sub = (await db.execute(find)).scalar_one_or_none()
    fields = body.model_dump(exclude={"parent_external_id"}, exclude_none=True)
    if sub is None:
        fields.setdefault("name", body.role or "Subagent")
        fields["name"] = fields["name"] or body.role or "Subagent"
        sub = Subagent(session_id=session.id, **fields)
        if body.parent_external_id:
            parent = select(Subagent.id).where(Subagent.session_id == session.id, Subagent.external_id == body.parent_external_id)
            sub.parent_id = (await db.execute(parent)).scalar_one_or_none()
        db.add(sub)
    else:
        for key, value in fields.items():
            if value != "" or key == "status":
                setattr(sub, key, value)
    if sub.status != "RUNNING" and not sub.finished_at:
        sub.finished_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(sub)
    await rt.publish("session", user.id)
    return subagent_out(sub)


async def session_counts(db: AsyncSession, since: datetime) -> dict:
    row = (await db.execute(select(func.count(AgentSession.id)).where(AgentSession.started_at >= since))).scalar()
    return {"sessions": row or 0}
