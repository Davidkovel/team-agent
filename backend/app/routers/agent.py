"""API used only by Local Agents (agent-token auth)."""
import time
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..db import get_db
from ..models import UNFINISHED, AgentSession, Approval, Task, TaskEvent, UsageRecord, User
from ..realtime import rt
from ..security import agent_user, make_jwt
from ..services import (ONLINE_VIA, PENDING_ONLINE, SOFT_VIA, where, approval_out, deciders, event_out, log_activity, notify,
                        save_agent_state, task_out, team_view)
from .work import memory_for_task

router = APIRouter(prefix="/api/agent")

# Short, human wording for the team history.
STATUS_TEXT = {"IN_PROGRESS": "começou", "WAITING_APPROVAL": "espera aprovação em", "PAUSED": "pausou",
               "NEEDS_HELP": "precisa de ajuda em", "COMPLETED": "concluiu", "FAILED": "falhou em", "STOPPED": "parou"}


class Heartbeat(BaseModel):
    status: Literal["ONLINE", "WORKING", "IDLE", "WAITING", "PAUSED", "ERROR"]
    task_id: int | None = None
    task: str = ""
    progress: int = Field(0, ge=0, le=100)
    current_action: str = ""
    last_action: str = ""
    next_action: str = ""
    error: str = ""
    started_at: float | None = None
    usage: dict = {}


class TaskUpdate(BaseModel):
    status: Literal["IN_PROGRESS", "WAITING_APPROVAL", "PAUSED", "NEEDS_HELP", "COMPLETED", "FAILED", "STOPPED"] | None = None
    progress: int | None = Field(None, ge=0, le=100)
    current_action: str | None = None
    last_action: str | None = None
    next_action: str | None = None
    result: str | None = None
    session_id: str | None = None


class EventIn(BaseModel):
    kind: Literal["action", "decision", "error", "result", "note"]
    message: str
    data: dict = {}


class ApprovalIn(BaseModel):
    task_id: int | None = None
    action: str
    detail: str = ""
    risk: Literal["", "low", "medium", "high"] = ""
    kind: str = Field("", max_length=30)
    files: list[str] | None = None
    diff: str = Field("", max_length=60000)


class UsageIn(BaseModel):
    task_id: int | None = None
    session_id: int | None = None
    model: str = ""
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_creation_tokens: int = 0
    cost_usd: float = 0.0


class HelpIn(BaseModel):
    task_id: int | None = None
    message: str


async def own_task(task_id: int, user: User, db: AsyncSession) -> Task:
    task = await db.get(Task, task_id)
    if not task or task.assignee_id != user.id:
        raise HTTPException(404, "Task not found")
    return task


@router.get("/me")
async def whoami(user: User = Depends(agent_user)):
    return {"username": user.username, "display_name": user.display_name, "role": user.role}


@router.post("/session")
async def session(user: User = Depends(agent_user)):
    """Lets the widget open the Hub already signed in as the agent's user."""
    return {"token": make_jwt(user)}


@router.post("/heartbeat")
async def heartbeat(body: Heartbeat, user: User = Depends(agent_user), db: AsyncSession = Depends(get_db)):
    before = await rt.store.get_presence(user.id)
    was_online = before is not None and before.get("via") not in SOFT_VIA  # an open Hub/widget is not the agent
    await rt.store.set_presence(user.id, {**body.model_dump(), "where": where(user.id, agent=True), "last_seen": time.time()}, settings.heartbeat_timeout)
    await save_agent_state(db, user.id, body.status)
    rt.online.add(user.id)
    ONLINE_VIA[user.id] = "agent"
    PENDING_ONLINE.discard(user.id)
    if not was_online:
        await log_activity(db, user, "agent_online", f"{user.display_name} ligou o agente")
    await rt.publish("presence", user.id, "team")
    return {"commands": await rt.store.pop_commands(user.id), "team": await team_view(db, user)}


@router.get("/tasks/next")
async def next_tasks(user: User = Depends(agent_user), db: AsyncSession = Depends(get_db)):
    query = select(Task).where(Task.assignee_id == user.id, Task.status == "ASSIGNED", Task.trashed_at.is_(None)).order_by(Task.id)
    return [task_out(t) for t in (await db.execute(query)).scalars()]


@router.get("/recovery")
async def recovery(user: User = Depends(agent_user), db: AsyncSession = Depends(get_db)):
    """'What was my last task?' -> the unfinished task with its saved context."""
    query = (select(Task).where(Task.assignee_id == user.id, Task.status.in_(UNFINISHED), Task.trashed_at.is_(None))
             .order_by(Task.updated_at.desc()).limit(1))
    task = (await db.execute(query)).scalar_one_or_none()
    if not task:
        return {"task": None}
    events = (await db.execute(select(TaskEvent).where(TaskEvent.task_id == task.id).order_by(TaskEvent.id))).scalars()
    pending = (await db.execute(select(Approval).where(Approval.task_id == task.id, Approval.status == "PENDING"))).scalars()
    return {"task": task_out(task), "events": [event_out(e) for e in events],
            "pending_approvals": [approval_out(a) for a in pending]}


@router.get("/tasks/{task_id}/memory")
async def task_memory(task_id: int, user: User = Depends(agent_user), db: AsyncSession = Depends(get_db)):
    """What the AI should know before it starts this task (global, team, company, project, agent and task notes)."""
    task = await own_task(task_id, user, db)
    return [{"scope": m.scope, "category": m.category, "title": m.title, "content": m.content}
            for m in await memory_for_task(db, task)]


@router.post("/tasks/{task_id}/update")
async def update_task(task_id: int, body: TaskUpdate, user: User = Depends(agent_user), db: AsyncSession = Depends(get_db)):
    task = await own_task(task_id, user, db)
    changes = body.model_dump(exclude_none=True)
    new_action = changes.get("last_action") not in (None, "", task.last_action)
    old_status = task.status
    for key, value in changes.items():
        setattr(task, key, value)
    if task.status == "IN_PROGRESS" and not task.started_at:
        task.started_at = datetime.now(timezone.utc)
    if task.status == "COMPLETED":
        task.progress, task.completed_at = 100, datetime.now(timezone.utc)
    if new_action:
        db.add(TaskEvent(task_id=task.id, kind="action", message=task.last_action, data={"progress": task.progress}))
    await db.commit()
    if task.status != old_status:
        await log_activity(db, user, "task_status", f"{STATUS_TEXT.get(task.status, task.status)}: {task.title}", task.id)
        href = f"#/tarefas/{task.id}"
        if task.status == "COMPLETED":
            await notify(db, {user.id, task.created_by}, "task_completed", "low", f"Tarefa concluída: {task.title}",
                         (task.result or "")[:300], href)
        elif task.status == "FAILED":
            await notify(db, {user.id, task.created_by}, "agent_failed", "medium", f"O agente falhou em: {task.title}", "", href)
        elif task.status == "NEEDS_HELP":
            await notify(db, {user.id, task.created_by}, "agent_waiting", "medium",
                         f"Claude / {user.display_name} precisa de ajuda", task.title, href)
    elif new_action:
        await log_activity(db, user, "task_action", f"{task.last_action} ({task.progress}%)", task.id)
    await rt.publish("task", user.id)
    return task_out(task)


@router.post("/tasks/{task_id}/events")
async def add_event(task_id: int, body: EventIn, user: User = Depends(agent_user), db: AsyncSession = Depends(get_db)):
    task = await own_task(task_id, user, db)
    db.add(TaskEvent(task_id=task.id, **body.model_dump()))
    await db.commit()
    if body.kind == "error":
        await log_activity(db, user, "task_error", f"erro na tarefa {task.title}: {body.message}", task.id)
    await rt.publish("task", user.id)
    return {"ok": True}


@router.post("/approvals")
async def request_approval(body: ApprovalIn, user: User = Depends(agent_user), db: AsyncSession = Depends(get_db)):
    if body.task_id is not None:
        await own_task(body.task_id, user, db)
    approval = Approval(user_id=user.id, **body.model_dump())
    db.add(approval)
    await db.commit()
    await db.refresh(approval)
    await log_activity(db, user, "approval_requested",
                       f"{user.display_name} espera aprovação: {body.action}", body.task_id)
    await notify(db, await deciders(db), "approval_required", "high",
                 f"Claude / {user.display_name} precisa de aprovação", body.action, "#/aprovacoes")
    await rt.publish("approval", user.id)
    return approval_out(approval)


@router.get("/approvals/{approval_id}")
async def approval_status(approval_id: int, user: User = Depends(agent_user), db: AsyncSession = Depends(get_db)):
    approval = await db.get(Approval, approval_id)
    if not approval or approval.user_id != user.id:
        raise HTTPException(404, "Approval not found")
    return approval_out(approval)


@router.post("/usage")
async def report_usage(body: UsageIn, user: User = Depends(agent_user), db: AsyncSession = Depends(get_db)):
    if body.task_id is not None:
        await own_task(body.task_id, user, db)
    if body.session_id is not None:
        session = await db.get(AgentSession, body.session_id)
        if not session or session.user_id != user.id:
            raise HTTPException(404, "Session not found")
    db.add(UsageRecord(user_id=user.id, **body.model_dump()))
    await db.commit()
    await rt.publish("usage", user.id)
    return {"ok": True}


@router.post("/help")
async def request_help(body: HelpIn, user: User = Depends(agent_user), db: AsyncSession = Depends(get_db)):
    if body.task_id is not None:
        task = await own_task(body.task_id, user, db)
        db.add(TaskEvent(task_id=task.id, kind="note", message=f"Help requested: {body.message}"))
        await db.commit()
    await log_activity(db, user, "help_requested", f"{user.display_name} pede ajuda: {body.message}", body.task_id)
    return {"ok": True}
