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
from ..models import UNFINISHED, Approval, Task, TaskEvent, UsageRecord, User
from ..realtime import rt
from ..security import agent_user, make_jwt
from ..services import approval_out, event_out, log_activity, save_agent_state, task_out, team_view

router = APIRouter(prefix="/api/agent")


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


class UsageIn(BaseModel):
    task_id: int | None = None
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
    was_online = await rt.store.get_presence(user.id) is not None
    await rt.store.set_presence(user.id, {**body.model_dump(), "last_seen": time.time()}, settings.heartbeat_timeout)
    await save_agent_state(db, user.id, body.status)
    rt.online.add(user.id)
    if not was_online:
        await log_activity(db, user, "agent_online", f"{user.display_name}'s agent is online")
    await rt.publish("presence", user.id, "team")
    return {"commands": await rt.store.pop_commands(user.id), "team": await team_view(db, user)}


@router.get("/tasks/next")
async def next_tasks(user: User = Depends(agent_user), db: AsyncSession = Depends(get_db)):
    query = select(Task).where(Task.assignee_id == user.id, Task.status == "ASSIGNED").order_by(Task.id)
    return [task_out(t) for t in (await db.execute(query)).scalars()]


@router.get("/recovery")
async def recovery(user: User = Depends(agent_user), db: AsyncSession = Depends(get_db)):
    """'What was my last task?' -> the unfinished task with its saved context."""
    query = (select(Task).where(Task.assignee_id == user.id, Task.status.in_(UNFINISHED))
             .order_by(Task.updated_at.desc()).limit(1))
    task = (await db.execute(query)).scalar_one_or_none()
    if not task:
        return {"task": None}
    events = (await db.execute(select(TaskEvent).where(TaskEvent.task_id == task.id).order_by(TaskEvent.id))).scalars()
    pending = (await db.execute(select(Approval).where(Approval.task_id == task.id, Approval.status == "PENDING"))).scalars()
    return {"task": task_out(task), "events": [event_out(e) for e in events],
            "pending_approvals": [approval_out(a) for a in pending]}


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
        await log_activity(db, user, "task_status", f"TASK-{task.id} {old_status} -> {task.status}", task.id)
    elif new_action:
        await log_activity(db, user, "task_action", f"TASK-{task.id} ({task.progress}%): {task.last_action}", task.id)
    await rt.publish("task", user.id)
    return task_out(task)


@router.post("/tasks/{task_id}/events")
async def add_event(task_id: int, body: EventIn, user: User = Depends(agent_user), db: AsyncSession = Depends(get_db)):
    task = await own_task(task_id, user, db)
    db.add(TaskEvent(task_id=task.id, **body.model_dump()))
    await db.commit()
    if body.kind == "error":
        await log_activity(db, user, "task_error", f"TASK-{task.id} error: {body.message}", task.id)
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
                       f"{user.display_name}'s agent is waiting for approval: {body.action}", body.task_id)
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
    await log_activity(db, user, "help_requested", f"{user.display_name} needs help: {body.message}", body.task_id)
    return {"ok": True}
