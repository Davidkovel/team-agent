from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import hub
from ..db import get_db
from ..models import AgentSession, Approval, Project, Task, TaskEvent, UsageRecord, User
from ..realtime import rt
from ..security import current_user, sees_all
from ..services import approval_out, event_out, log_activity, notify, session_out, task_out

router = APIRouter(prefix="/api/tasks")

Priority = Literal["low", "normal", "high", "urgent"]
Role = Literal["developer", "research", "marketing", "testing", "custom"]
# While the agent holds a task (it is running, or waiting for an approval) only the agent moves it.
HELD_BY_AGENT = ("IN_PROGRESS", "WAITING_APPROVAL")


class TaskCreate(BaseModel):
    title: str
    description: str = ""
    goal: str = ""
    requirements: list[str] = []
    project: str = ""
    assignee: str
    priority: Priority = "normal"
    deadline: datetime | None = None
    company: str | None = None
    project_id: int | None = None
    agent_role: Role | Literal[""] = ""
    # True: the assignee's agent picks it up at once (how tasks always worked). False: it waits in "to do" for a person.
    for_ai: bool = True


class TaskEdit(BaseModel):
    title: str | None = None
    description: str | None = None
    goal: str | None = None
    priority: Priority | None = None
    deadline: datetime | None = None
    company: str | None = None
    project_id: int | None = None
    git_branch: str | None = None
    blocked_reason: str | None = None
    assignee: str | None = None
    status: Literal["TODO", "BLOCKED", "REVIEW", "COMPLETED"] | None = None


class AssignAI(BaseModel):
    role: Role
    instructions: str = ""


class Control(BaseModel):
    action: Literal["pause", "resume", "stop"]


async def get_task(task_id: int, user: User, db: AsyncSession) -> Task:
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(404, "Task not found")
    if not sees_all(user) and task.assignee_id != user.id:
        raise HTTPException(403, "Not your task")
    return task


async def _check_links(db: AsyncSession, company: str | None, project_id: int | None):
    if company and company not in hub.companies():
        raise HTTPException(404, "Company not found")
    if project_id is not None and not await db.get(Project, project_id):
        raise HTTPException(404, "Project not found")


@router.post("")
async def create_task(body: TaskCreate, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    assignee = (await db.execute(select(User).where(User.username == body.assignee))).scalar_one_or_none()
    if not assignee:
        raise HTTPException(404, "Assignee not found")
    if not sees_all(user) and assignee.id != user.id:
        raise HTTPException(403, "Members can only create tasks for themselves")
    await _check_links(db, body.company, body.project_id)
    task = Task(**body.model_dump(exclude={"assignee", "for_ai"}), assignee_id=assignee.id, created_by=user.id,
                status="ASSIGNED" if body.for_ai else "TODO")
    db.add(task)
    await db.commit()
    await db.refresh(task)
    await log_activity(db, assignee, "task_assigned", f"recebeu a tarefa: {task.title}", task.id)
    await rt.publish("task", assignee.id)
    if assignee.id != user.id:  # a task from someone else is worth a notification: the bell, and the widget
        await notify(db, [assignee.id], "task", "info", f"{user.display_name} deu-te uma tarefa: {task.title}", task.description, f"#/tarefas/{task.id}")
    if body.for_ai:
        await rt.publish("wake", assignee.id, "agent")
    return task_out(task)


@router.get("")
async def list_tasks(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    query = select(Task).order_by(Task.id.desc())
    if not sees_all(user):
        query = query.where(Task.assignee_id == user.id)
    return [task_out(t) for t in (await db.execute(query)).scalars()]


@router.get("/{task_id}")
async def task_detail(task_id: int, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    task = await get_task(task_id, user, db)
    events = (await db.execute(select(TaskEvent).where(TaskEvent.task_id == task_id).order_by(TaskEvent.id))).scalars()
    approvals = (await db.execute(select(Approval).where(Approval.task_id == task_id).order_by(Approval.id.desc()))).scalars()
    sessions = (await db.execute(select(AgentSession).where(AgentSession.task_id == task_id).order_by(AgentSession.id.desc()))).scalars()
    cost, runs = (await db.execute(select(func.sum(UsageRecord.cost_usd), func.count(UsageRecord.id))
                                   .where(UsageRecord.task_id == task_id))).one()
    return {**task_out(task), "events": [event_out(e) for e in events], "approvals": [approval_out(a) for a in approvals],
            "sessions": [session_out(s) for s in sessions],
            # the SDK's estimate for the runs of this task; None when no run reported any
            "ai_cost_usd": round(cost, 4) if runs else None}


@router.patch("/{task_id}")
async def edit_task(task_id: int, body: TaskEdit, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    task = await get_task(task_id, user, db)
    changes = body.model_dump(exclude_unset=True)
    await _check_links(db, changes.get("company"), changes.get("project_id"))
    old_status = task.status
    if "status" in changes or "assignee" in changes:
        if task.status in HELD_BY_AGENT:
            raise HTTPException(409, "The agent is working on this task: pause or stop it first")
    if username := changes.pop("assignee", None):
        assignee = (await db.execute(select(User).where(User.username == username))).scalar_one_or_none()
        if not assignee:
            raise HTTPException(404, "Assignee not found")
        if not sees_all(user) and assignee.id != user.id:
            raise HTTPException(403, "Members can only keep tasks for themselves")
        task.assignee_id = assignee.id
    for key, value in changes.items():
        setattr(task, key, value)
    if task.status == "COMPLETED" and old_status != "COMPLETED":
        task.progress, task.completed_at = 100, datetime.now(timezone.utc)
    if task.status != "BLOCKED" and "blocked_reason" not in changes:
        task.blocked_reason = ""
    await db.commit()
    await db.refresh(task)
    if task.status != old_status:
        verb = {"TODO": "voltou a pôr por fazer", "BLOCKED": "marcou como bloqueada", "REVIEW": "pôs em revisão",
                "COMPLETED": "concluiu"}[task.status]
        await log_activity(db, user, "task_status", f"{verb}: {task.title}", task.id)
        if task.status == "COMPLETED" and task.created_by != user.id:  # whoever asked for it hears that it is done
            await notify(db, [task.created_by], "task", "info", f"{user.display_name} concluiu: {task.title}", "", f"#/tarefas/{task.id}")
    await rt.publish("task", task.assignee_id)
    return task_out(task)


@router.post("/{task_id}/assign-ai")
async def assign_ai(task_id: int, body: AssignAI, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    """Hand the task to the assignee's Local Team Agent, as the kind of agent chosen."""
    task = await get_task(task_id, user, db)
    if task.status in HELD_BY_AGENT or task.status in ("ASSIGNED", "PAUSED", "NEEDS_HELP"):
        raise HTTPException(409, "This task is already with the agent")
    if body.role == "custom" and not body.instructions.strip():
        raise HTTPException(422, "A custom agent needs instructions")
    task.agent_role, task.agent_instructions, task.status = body.role, body.instructions.strip(), "ASSIGNED"
    task.completed_at, task.blocked_reason = None, ""
    await db.commit()
    await db.refresh(task)
    await log_activity(db, user, "task_assigned", f"{user.display_name} entregou à IA ({body.role}): {task.title}", task.id)
    await rt.publish("task", task.assignee_id)
    await rt.publish("wake", task.assignee_id, "agent")
    return task_out(task)


@router.post("/{task_id}/control")
async def control(task_id: int, body: Control, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    task = await get_task(task_id, user, db)
    await rt.command(task.assignee_id, {"type": body.action, "task_id": task.id})
    verb = {"pause": "pausar", "resume": "retomar", "stop": "parar"}[body.action]
    await log_activity(db, user, "control", f"{user.display_name} pediu para {verb} a tarefa: {task.title}", task.id)
    return {"queued": body.action}
