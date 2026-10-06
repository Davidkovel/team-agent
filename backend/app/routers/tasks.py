from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import hub, push
from ..db import get_db
from ..models import Activity, AgentSession, Approval, Project, Task, TaskEvent, UsageRecord, User
from ..realtime import rt
from ..security import current_user, sees_all
from ..services import (approval_out, delete_tasks, event_out, finishers, iso, log_activity, not_mistake, notify, purge_at,
                        purge_trash, session_out, task_out)

router = APIRouter(prefix="/api/tasks")

Priority = Literal["low", "normal", "high", "urgent"]
Role = Literal["developer", "research", "marketing", "testing", "custom"]
# While the agent holds a task (it is running, or waiting for an approval) only the agent moves it.
HELD_BY_AGENT = ("IN_PROGRESS", "WAITING_APPROVAL")
EVERYBODY = "all"  # as the assignee of a new task: one task for each person


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


class Trash(BaseModel):
    reason: Literal["done", "mistake"]


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


async def _create(db: AsyncSession, body: TaskCreate, assignee: User, creator: User) -> Task:
    task = Task(**body.model_dump(exclude={"assignee", "for_ai"}), assignee_id=assignee.id, created_by=creator.id,
                status="ASSIGNED" if body.for_ai else "TODO")
    db.add(task)
    await db.commit()
    await db.refresh(task)
    await log_activity(db, assignee, "task_assigned", f"recebeu a tarefa: {task.title}", task.id)
    await rt.publish("task", assignee.id)
    if body.for_ai:
        await rt.publish("wake", assignee.id, "agent")
    return task


async def _announce(db: AsyncSession, sender: User, tasks: list[Task], everybody: bool):
    """Everyone but the sender hears about a new task, so all the screens stay current. It is `directed` at whoever the task
    is for (the widget rings for them) and only shown to the others. Sent to everybody, it is directed at all of them."""
    for person in (await db.execute(select(User).where(User.id != sender.id))).scalars():
        task = next((t for t in tasks if t.assignee_id == person.id), tasks[0])
        if everybody:
            title, directed = f"{sender.display_name} mandou uma tarefa a todos: {task.title}", True
        elif task.assignee_id == person.id:
            title, directed = f"{sender.display_name} deu-te uma tarefa: {task.title}", True
        else:
            title, directed = f"{sender.display_name} mandou uma tarefa a {task.assignee.display_name}: {task.title}", False
        await notify(db, [person.id], "task_new", "info", title, task.description, f"#/tarefas/{task.id}", directed)
    mine = next((t for t in tasks if t.assignee_id == sender.id), None)
    if mine:  # whoever sends it knows: no bell and no widget ring for them, but their phone still gets it, as the proof it went in
        await push.to_people(db, {sender.id}, f"Nova tarefa: {mine.title}"[:200], mine.description or "", "info", f"#/tarefas/{mine.id}")


@router.post("")
async def create_task(body: TaskCreate, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    """`assignee` is a login, or EVERYBODY: one task for each person, each finished on its own."""
    everybody = body.assignee == EVERYBODY
    if everybody:
        if not sees_all(user):
            raise HTTPException(403, "Only someone who directs work can send a task to everybody")
        assignees = list((await db.execute(select(User).order_by(User.id))).scalars())
    else:
        assignee = (await db.execute(select(User).where(User.username == body.assignee))).scalar_one_or_none()
        if not assignee:
            raise HTTPException(404, "Assignee not found")
        if not sees_all(user) and assignee.id != user.id:
            raise HTTPException(403, "Members can only create tasks for themselves")
        assignees = [assignee]
    await _check_links(db, body.company, body.project_id)
    tasks = [await _create(db, body, person, user) for person in assignees]
    await _announce(db, user, tasks, everybody)
    return task_out(next((t for t in tasks if t.assignee_id == user.id), tasks[0]))


@router.get("")
async def list_tasks(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    """The board. What went into the bin as finished is still here (trashed_at says so, the board hides it); mistakes are not."""
    await purge_trash(db)
    query = select(Task).where(not_mistake()).order_by(Task.id.desc())
    if not sees_all(user):
        query = query.where(Task.assignee_id == user.id)
    tasks = list((await db.execute(query)).scalars())
    done = await finishers(db)
    return [task_out(t, done.get(t.id)) for t in tasks]


@router.get("/trash")  # declared before /{task_id}, or "trash" would be read as a task number
async def trash_list(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    await purge_trash(db)
    query = select(Task).where(Task.trashed_at.is_not(None)).order_by(Task.trashed_at.desc())
    if not sees_all(user):
        query = query.where(Task.assignee_id == user.id)
    return [{**task_out(t), "purge_at": purge_at(t)} for t in (await db.execute(query)).scalars()]


# What a person did to a task, as the history shows it. The agent's own steps are its events, not this.
LOGGED = ("task_status", "task_edit")


async def task_log(db: AsyncSession, task: Task) -> list[dict]:
    """Who made the task, then every status change and edit, oldest first, each with who did it and when."""
    made = [{"who": task.creator.username, "name": task.creator.display_name, "kind": "task_created",
             "message": f"criou a tarefa para {task.assignee.display_name}", "at": iso(task.created_at)}] if task.creator else []
    rows = (await db.execute(select(Activity).where(Activity.task_id == task.id, Activity.kind.in_(LOGGED)).order_by(Activity.id))).scalars()
    return made + [{"who": a.user.username, "name": a.user.display_name, "kind": a.kind,
                    "message": a.message.split(": ", 1)[0], "at": iso(a.created_at)} for a in rows]


@router.get("/{task_id}")
async def task_detail(task_id: int, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    task = await get_task(task_id, user, db)
    events = (await db.execute(select(TaskEvent).where(TaskEvent.task_id == task_id).order_by(TaskEvent.id))).scalars()
    approvals = (await db.execute(select(Approval).where(Approval.task_id == task_id).order_by(Approval.id.desc()))).scalars()
    sessions = (await db.execute(select(AgentSession).where(AgentSession.task_id == task_id).order_by(AgentSession.id.desc()))).scalars()
    cost, runs = (await db.execute(select(func.sum(UsageRecord.cost_usd), func.count(UsageRecord.id))
                                   .where(UsageRecord.task_id == task_id))).one()
    return {**task_out(task, (await finishers(db, [task.id])).get(task.id)), "log": await task_log(db, task),
            "events": [event_out(e) for e in events], "approvals": [approval_out(a) for a in approvals],
            "sessions": [session_out(s) for s in sessions],
            # the SDK's estimate for the runs of this task; None when no run reported any
            "ai_cost_usd": round(cost, 4) if runs else None}


PRIORITY_TEXT = {"low": "Baixa", "normal": "Normal", "high": "Alta", "urgent": "Urgente"}
MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"]


def _when(d: datetime) -> str:
    d = (d if d.tzinfo else d.replace(tzinfo=timezone.utc)).astimezone()  # the Hub's own clock is the team's (Lisboa)
    return f"{d.day} {MONTHS[d.month - 1]} {d:%H:%M}"


async def _what_changed(db: AsyncSession, task: Task, changes: dict) -> list[str]:
    """The edits in words, only what really changes ("mudou o prazo para 8 out 14:00"). Status has its own line."""
    said = []
    if "title" in changes and (changes["title"] or "") != task.title:
        said.append("mudou o título")
    if "description" in changes and (changes["description"] or "") != (task.description or ""):
        said.append("mudou a descrição")
    if changes.get("priority") and changes["priority"] != (task.priority or "normal"):
        said.append(f"mudou a prioridade para {PRIORITY_TEXT[changes['priority']]}")
    if "deadline" in changes:
        old, new = task.deadline, changes["deadline"]
        same = (old is None and new is None) or (old is not None and new is not None
                                                 and abs((old.replace(tzinfo=old.tzinfo or timezone.utc) - new.replace(tzinfo=new.tzinfo or timezone.utc)).total_seconds()) < 60)
        if not same:
            said.append(f"mudou o prazo para {_when(new)}" if new else "tirou o prazo")
    if "project_id" in changes and changes["project_id"] != task.project_id:
        said.append("mudou o projeto")
    if "company" in changes and (changes["company"] or None) != (task.company or None):
        said.append("mudou a empresa")
    if changes.get("assignee") and changes["assignee"] != task.assignee.username:
        other = (await db.execute(select(User).where(User.username == changes["assignee"]))).scalar_one_or_none()
        if other:
            said.append(f"passou a tarefa a {other.display_name}")
    return said


@router.patch("/{task_id}")
async def edit_task(task_id: int, body: TaskEdit, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    task = await get_task(task_id, user, db)
    if task.trashed_at is not None:
        raise HTTPException(409, "This task is in the bin: recover it first")
    changes = body.model_dump(exclude_unset=True)
    await _check_links(db, changes.get("company"), changes.get("project_id"))
    old_status = task.status
    said = await _what_changed(db, task, changes)
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
    if said:
        await log_activity(db, user, "task_edit", f"{' e '.join(said)}: {task.title}", task.id)
    if task.status != old_status:
        verb = {"TODO": "voltou a pôr por fazer", "BLOCKED": "marcou como bloqueada", "REVIEW": "pôs em revisão",
                "COMPLETED": "concluiu"}[task.status]
        await log_activity(db, user, "task_status", f"{verb}: {task.title}", task.id)
        if task.status == "COMPLETED" and task.created_by != user.id:  # whoever asked for it hears that it is done
            await notify(db, [task.created_by], "task", "info", f"{user.display_name} concluiu: {task.title}", "", f"#/tarefas/{task.id}")
    await rt.publish("task", task.assignee_id)
    return task_out(task, user.username if task.status == "COMPLETED" and task.status != old_status else (await finishers(db, [task.id])).get(task.id))


@router.post("/{task_id}/trash")
async def trash_task(task_id: int, body: Trash, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    """Into the bin, as finished or as a mistake. It stays there recoverable for TRASH_HOURS, then it is deleted for good."""
    task = await get_task(task_id, user, db)
    if task.trashed_at is not None:
        raise HTTPException(409, "This task is already in the bin")
    if task.status in HELD_BY_AGENT:
        raise HTTPException(409, "The agent is working on this task: pause or stop it first")
    now = datetime.now(timezone.utc)
    task.trashed_at, task.trash_reason = now, body.reason
    task.trash_prev_status, task.trash_prev_progress = task.status, task.progress
    finished = body.reason == "done" and task.status != "COMPLETED"
    if finished:
        task.status, task.progress, task.completed_at = "COMPLETED", 100, now
    await db.commit()
    await db.refresh(task)
    if finished:
        await log_activity(db, user, "task_status", f"concluiu: {task.title}", task.id)
        if task.created_by != user.id:  # whoever asked for it hears that it is done
            await notify(db, [task.created_by], "task", "info", f"{user.display_name} concluiu: {task.title}", "", f"#/tarefas/{task.id}")
    await rt.publish("task", task.assignee_id)
    return {**task_out(task), "purge_at": purge_at(task)}


@router.post("/{task_id}/restore")
async def restore_task(task_id: int, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    """Out of the bin, back where it was. A task that was marked finished only by going in is not finished any more."""
    task = await get_task(task_id, user, db)
    if task.trashed_at is None:
        raise HTTPException(409, "This task is not in the bin")
    if task.trash_reason == "done" and task.trash_prev_status not in (None, "COMPLETED"):
        task.status, task.progress, task.completed_at = task.trash_prev_status, task.trash_prev_progress or 0, None
    task.trashed_at = task.trash_reason = task.trash_prev_status = task.trash_prev_progress = None
    await db.commit()
    await db.refresh(task)
    await rt.publish("task", task.assignee_id)
    return task_out(task)


@router.delete("/{task_id}/trash")
async def delete_trashed(task_id: int, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    """'Delete now': for good, without waiting for the hours. Only what is already in the bin."""
    task = await get_task(task_id, user, db)
    if task.trashed_at is None:
        raise HTTPException(409, "Only a task in the bin can be deleted from here")
    assignee_id = task.assignee_id
    await delete_tasks(db, [task.id])
    await rt.publish("task", assignee_id)
    return {"deleted": task_id}


@router.post("/{task_id}/assign-ai")
async def assign_ai(task_id: int, body: AssignAI, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    """Hand the task to the assignee's Local Team Agent, as the kind of agent chosen."""
    task = await get_task(task_id, user, db)
    if task.trashed_at is not None:
        raise HTTPException(409, "This task is in the bin: recover it first")
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
