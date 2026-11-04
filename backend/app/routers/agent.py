"""API used only by Local Agents (agent-token auth)."""
import time
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import crew, mail
from ..config import settings
from ..db import get_db
from ..models import UNFINISHED, AgentSession, Approval, MailMessage, MailThread, Task, TaskEvent, UsageRecord, User
from ..realtime import rt
from ..security import agent_user, make_jwt, sees_all
from ..services import (AWAY, ONLINE_VIA, PENDING_ONLINE, SOFT_VIA, where, approval_out, deciders, event_out, log_activity, notify,
                        save_agent_state, task_out, team_view)
from . import conversas, emails
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
    worker: str = ""  # one of several agents of the same person (TEAM_AGENT_WORKER); empty: the only one


class TaskUpdate(BaseModel):
    # ASSIGNED: the agent puts the task back in its queue (Claude's plan limit stopped it; it starts again by itself after the reset)
    status: Literal["ASSIGNED", "IN_PROGRESS", "WAITING_APPROVAL", "PAUSED", "NEEDS_HELP", "COMPLETED", "FAILED", "STOPPED"] | None = None
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


# Several agents of one person (the cloud server runs 2-3): the last heartbeat of each, so the team sees the busiest one
# and not whichever spoke last. Kept in memory: presence is not synced either.
WORKERS: dict[int, dict[str, tuple[float, dict]]] = {}
BUSY = {"WORKING": 0, "WAITING": 1, "PAUSED": 2, "ERROR": 3, "IDLE": 4, "ONLINE": 5}


def busiest(user_id: int, body: Heartbeat) -> dict:
    state = body.model_dump()
    if not body.worker:
        return state
    now = time.time()
    mine = WORKERS.setdefault(user_id, {})
    mine[body.worker] = (now, state)
    fresh = [st for at, st in mine.values() if now - at < settings.heartbeat_timeout]
    best = min(fresh, key=lambda st: BUSY.get(st["status"], 9))
    return {**best, "workers": len(fresh), "working": sum(st["status"] == "WORKING" for st in fresh)}


async def commands_for(db: AsyncSession, user: User, worker: str) -> list[dict]:
    """The commands of this worker. Several share a login, and a command about a task taken by another one would be lost here."""
    mine = []
    for command in await rt.store.pop_commands(user.id):
        task = await db.get(Task, command["task_id"]) if command.get("task_id") else None
        if task and task.worker and task.worker != worker and task.status in conversas.RUNNING:
            await rt.store.push_command(user.id, command)
        else:
            mine.append(command)
    return mine


@router.post("/heartbeat")
async def heartbeat(body: Heartbeat, user: User = Depends(agent_user), db: AsyncSession = Depends(get_db)):
    if user.id in AWAY:  # switched offline in the widget: the agent still gets its commands, but nobody sees them online
        return {"commands": await commands_for(db, user, body.worker), "team": await team_view(db, user)}
    before = await rt.store.get_presence(user.id)
    was_online = before is not None and before.get("via") not in SOFT_VIA  # an open Hub/widget is not the agent
    state = busiest(user.id, body)
    await rt.store.set_presence(user.id, {**state, "where": where(user.id, agent=True), "last_seen": time.time()}, settings.heartbeat_timeout)
    if body.worker == conversas.PC:
        conversas.PC_SEEN[user.id] = time.time()
    await save_agent_state(db, user.id, state["status"])
    rt.online.add(user.id)
    ONLINE_VIA[user.id] = "agent"
    PENDING_ONLINE.discard(user.id)
    if not was_online:
        await log_activity(db, user, "agent_online", f"{user.display_name} ligou o agente")
    await rt.publish("presence", user.id, "team")
    return {"commands": await commands_for(db, user, body.worker), "team": await team_view(db, user)}


@router.get("/tasks/next")
async def next_tasks(user: User = Depends(agent_user), db: AsyncSession = Depends(get_db)):
    query = select(Task).where(Task.assignee_id == user.id, Task.status == "ASSIGNED", Task.trashed_at.is_(None),
                               Task.worker.is_(None)).order_by(Task.id)
    return [task_out(t) for t in (await db.execute(query)).scalars()]


@router.post("/tasks/claim")
async def claim_task(worker: str, user: User = Depends(agent_user), db: AsyncSession = Depends(get_db)):
    """One of several agents of the same person takes the oldest free task, and it is written down as theirs in the same
    transaction (db.py opens each one with BEGIN IMMEDIATE), so two agents asking at once never get the same task."""
    # The agent of the person's own computer only takes what was asked to run there (routers/conversas.py)
    mine = Task.worker == worker if worker == conversas.PC else or_(Task.worker.is_(None), Task.worker == worker)
    query = (select(Task).where(Task.assignee_id == user.id, Task.status == "ASSIGNED", Task.trashed_at.is_(None),
                                mine).order_by(Task.id).limit(1))
    task = (await db.execute(query)).scalar_one_or_none()
    if not task:
        return {"task": None}
    task.worker = worker
    await db.commit()
    await db.refresh(task)
    return {"task": task_out(task)}


def worker_tasks(worker: str):
    """The tasks that are this worker's to resume: its own, and for worker 1 also those of an agent without workers."""
    if not worker:
        return Task.worker.is_(None)
    return or_(Task.worker == worker, Task.worker.is_(None)) if worker == "1" else Task.worker == worker


@router.get("/recovery")
async def recovery(worker: str = "", user: User = Depends(agent_user), db: AsyncSession = Depends(get_db)):
    """'What was my last task?' -> the unfinished task with its saved context."""
    query = (select(Task).where(Task.assignee_id == user.id, Task.status.in_(UNFINISHED), Task.trashed_at.is_(None),
                                worker_tasks(worker))
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


@router.get("/tasks/{task_id}/briefing")
async def task_briefing(task_id: int, user: User = Depends(agent_user), db: AsyncSession = Depends(get_db)):
    """What a crew member reads before starting (crew.py): who they are, the Memória, the projects, the open work, what
    the crew finished lately and what they did before."""
    task = await own_task(task_id, user, db)
    brief = await crew.briefing(db, task, await memory_for_task(db, task))
    if task.agent_role == conversas.ROLE:
        brief["chat"] = await conversas.turn(db, task)
    return brief


@router.get("/mail/status")
async def mail_status(user: User = Depends(agent_user), db: AsyncSession = Depends(get_db)):
    """Is there a team account, so the agent's batch goes through the Hub's queue? (agent/team_agent/tools/email_tool.py)"""
    st = await mail.get_settings(db)
    await db.commit()
    return {"connected": bool(st.address)}


@router.post("/mail/queue")
async def mail_queue(body: dict, user: User = Depends(agent_user), db: AsyncSession = Depends(get_db)):
    """The agent's batch, after its owner approved it (send_emails waits for that): it leaves from the Hub, in turn."""
    return await mail.queue(db, emails.who(user), body.get("emails") or [])


@router.get("/mail/threads")
async def mail_threads(user: User = Depends(agent_user), db: AsyncSession = Depends(get_db)):
    """The company's e-mail for the person's agent to read. Sending stays with send_emails, which waits for a click."""
    if not sees_all(user):
        raise HTTPException(403, "Só quem dirige o trabalho")
    return {"threads": await emails.all_threads(db)}


@router.get("/mail/threads/{thread_id}")
async def mail_thread(thread_id: int, user: User = Depends(agent_user), db: AsyncSession = Depends(get_db)):
    """One conversation, without marking its answers as seen: only the person opening it does that."""
    if not sees_all(user):
        raise HTTPException(403, "Só quem dirige o trabalho")
    thread = await db.get(MailThread, thread_id)
    if not thread:
        raise HTTPException(404, "Conversa desconhecida")
    query = select(MailMessage).where(MailMessage.thread_id == thread_id).order_by(MailMessage.at)
    messages = list((await db.execute(query)).scalars())
    return {**emails.thread_out(thread, messages),
            "messages": [{"direction": m.direction, "status": m.status, "subject": m.subject, "body": m.body, "at": iso(m.at)}
                         for m in messages]}


@router.post("/tasks/{task_id}/update")
async def update_task(task_id: int, body: TaskUpdate, user: User = Depends(agent_user), db: AsyncSession = Depends(get_db)):
    task = await own_task(task_id, user, db)
    changes = body.model_dump(exclude_none=True)
    new_action = changes.get("last_action") not in (None, "", task.last_action)
    old_status = task.status
    for key, value in changes.items():
        setattr(task, key, value)
    if task.status == "ASSIGNED" and task.worker != conversas.PC:
        task.worker = None  # back in the queue (Claude's limit): any of the person's agents may take it
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
        if task.agent_role == conversas.ROLE and task.status == "COMPLETED":
            if not await conversas.answered(db, task):  # a message written meanwhile: it goes on, and tells when that ends
                await notify(db, {user.id}, "task_completed", "low", f"Claude respondeu: {task.title}", (task.result or "")[:300],
                             f"#/claude/{task.id}")
        elif task.agent_role == conversas.ROLE and task.status == "FAILED":
            if not await conversas.requeue_if_waiting(db, task):
                await notify(db, {user.id}, "agent_failed", "medium", f"O Claude não conseguiu responder: {task.title}", "",
                             f"#/claude/{task.id}")
        elif task.status == "COMPLETED":
            await crew.remember_task(db, task, user)  # the whole crew knows it from the next task on
            await release_next(db, task)
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


async def release_next(db: AsyncSession, done: Task):
    """The next steps of a chain waiting on this task get its result and go to their agent."""
    query = select(Task).where(Task.after_id == done.id, Task.status == "BLOCKED", Task.trashed_at.is_(None))
    for step in (await db.execute(query)).scalars():
        before = (done.result or "(o passo anterior não escreveu resultado)").strip()
        step.description = f"{step.description}\n\nResultado do passo anterior («{done.title}»):\n{before[:6000]}".strip()
        step.status, step.blocked_reason = "ASSIGNED", ""
        await db.commit()
        await log_activity(db, step.assignee, "task_assigned", f"passo seguinte da cadeia: {step.title}", step.id)
        await rt.publish("task", step.assignee_id)
        await rt.publish("wake", step.assignee_id, "agent")


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
    task = await db.get(Task, body.task_id) if body.task_id is not None else None
    if task and task.agent_role == conversas.ROLE:   # a private conversation: only its person hears of it, and it opens there
        await notify(db, [user.id], "approval_required", "high", "O Claude precisa da tua aprovação", body.action, f"#/claude/{task.id}")
    else:
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
