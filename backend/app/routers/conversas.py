"""Claude no telemóvel (#/claude; 4 nov, David: «trabalhar no meu telemóvel como se fosse no computador»).

A conversation is a task with agent_role «conversa»: the same agents, approvals, tokens and sync as any task, and the Claude
session is kept in tasks.session_id, so each new message continues the same conversation. Task events «message» (the person)
and «reply» (Claude) are what is shown. It runs in the cloud, or on the person's computer when it was asked for there
(worker «pc»: only the agent started by scripts/nuvem/ligar_pc.py takes those, and it is not in the queue of the others).
"""
import time

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import recall_share
from ..db import get_db
from ..models import Approval, Task, TaskEvent, User
from ..realtime import rt
from ..security import current_user
from ..services import iso

router = APIRouter(prefix="/api/conversas", tags=["conversas"])

ROLE = "conversa"
PC = "pc"
PC_FRESH = 90            # seconds without a heartbeat before the computer counts as off
PC_SEEN: dict[int, float] = {}   # user id -> the last heartbeat of their computer's agent
RUNNING = ("ASSIGNED", "IN_PROGRESS", "WAITING_APPROVAL", "PAUSED")


class Nova(BaseModel):
    text: str
    where: str = "nuvem"     # nuvem | pc
    project: str = ""


class Mensagem(BaseModel):
    text: str


def pc_online(user_id: int) -> bool:
    return time.time() - PC_SEEN.get(user_id, 0) < PC_FRESH


def _title(text: str) -> str:
    line = " ".join(text.split())
    return line if len(line) <= 70 else line[:69].rstrip() + "…"


async def _events(db: AsyncSession, task_id: int) -> list[TaskEvent]:
    query = select(TaskEvent).where(TaskEvent.task_id == task_id).order_by(TaskEvent.id)
    return list((await db.execute(query)).scalars())


def _unread(events: list[TaskEvent]) -> list[TaskEvent]:
    """The person's messages no turn has read yet. Not «after the last answer»: one written during a turn comes before it."""
    upto = max((e.data.get("upto", 0) for e in events if e.kind == "delivered" and e.data), default=0)
    return [e for e in events if e.kind == "message" and e.id > upto]


async def turn(db: AsyncSession, task: Task) -> dict:
    """What the agent answers now, read when it starts a turn. A message written after this goes in the next turn."""
    events = await _events(db, task.id)
    chat = [e for e in events if e.kind in ("message", "reply")]
    new = _unread(events)
    if new:
        db.add(TaskEvent(task_id=task.id, kind="delivered", message="", data={"upto": new[-1].id}))
        await db.commit()
    return {"history": [{"who": "pessoa" if e.kind == "message" else "claude", "text": e.message} for e in chat],
            "new": [e.message for e in new]}


async def answered(db: AsyncSession, task: Task) -> bool:
    """The agent finished a turn: its answer goes in the conversation. True when a message arrived in the meantime, and the
    conversation goes back to the agent at once."""
    db.add(TaskEvent(task_id=task.id, kind="reply", message=(task.result or "Feito.")[:20000], data={}))
    await db.commit()
    return await requeue_if_waiting(db, task)


async def requeue_if_waiting(db: AsyncSession, task: Task) -> bool:
    if not _unread(await _events(db, task.id)):
        return False
    _assign(task)
    await db.commit()
    await rt.publish("wake", task.assignee_id, "agent")
    return True


def _assign(task: Task):
    task.status, task.completed_at, task.blocked_reason, task.progress = "ASSIGNED", None, "", 0
    task.worker = PC if task.worker == PC else None
    task.current_action = ""


def _out(task: Task, last: TaskEvent | None = None) -> dict:
    return {"id": task.id, "title": task.title, "status": task.status, "where": PC if task.worker == PC else "nuvem",
            "project": task.project or "", "action": task.current_action or task.last_action or "",
            "busy": task.status in RUNNING, "updated_at": iso(task.updated_at),
            "snippet": (last.message[:120] if last else "")}


async def _mine(task_id: int, user: User, db: AsyncSession) -> Task:
    task = await db.get(Task, task_id)
    if not task or task.agent_role != ROLE or task.assignee_id != user.id or task.trashed_at is not None:
        raise HTTPException(404, "Conversa desconhecida")
    return task


@router.get("")
async def lista(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    query = (select(Task).where(Task.agent_role == ROLE, Task.assignee_id == user.id, Task.trashed_at.is_(None))
             .order_by(Task.updated_at.desc()).limit(40))
    tasks = list((await db.execute(query)).unique().scalars())
    out = []
    for task in tasks:
        chat = [e for e in await _events(db, task.id) if e.kind in ("message", "reply")]
        out.append(_out(task, chat[-1] if chat else None))
    return {"conversas": out, "pc_online": pc_online(user.id), "projetos": recall_share.known_projects()}


@router.post("")
async def nova(body: Nova, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    text = body.text.strip()
    if not text:
        raise HTTPException(422, "Escreve alguma coisa primeiro")
    if body.where not in ("nuvem", PC):
        raise HTTPException(422, "Onde corre: nuvem ou pc")
    task = Task(title=_title(text), description=text, project=body.project.strip()[:100], assignee_id=user.id, created_by=user.id,
                status="ASSIGNED", agent_role=ROLE, worker=PC if body.where == PC else None)
    db.add(task)
    await db.commit()
    await db.refresh(task)
    db.add(TaskEvent(task_id=task.id, kind="message", message=text[:20000], data={"name": user.display_name}))
    await db.commit()
    await rt.publish("task", user.id)
    await rt.publish("wake", user.id, "agent")
    return _out(task)


@router.get("/{task_id}")
async def ver(task_id: int, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    task = await _mine(task_id, user, db)
    events = await _events(db, task.id)
    query = select(Approval).where(Approval.task_id == task.id, Approval.status == "PENDING")
    asks = list((await db.execute(query)).unique().scalars())
    return {**_out(task), "pc_online": pc_online(user.id),
            "messages": [{"id": e.id, "kind": e.kind, "text": e.message, "at": iso(e.created_at)}
                         for e in events if e.kind in ("message", "reply", "error")],
            "approvals": [{"id": a.id, "action": a.action, "detail": a.detail, "risk": a.risk or ""} for a in asks]}


@router.post("/{task_id}")
async def mensagem(task_id: int, body: Mensagem, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    """A running conversation keeps the message for its next turn (`answered`); one at rest goes back to the agent."""
    task = await _mine(task_id, user, db)
    text = body.text.strip()
    if not text:
        raise HTTPException(422, "Escreve alguma coisa primeiro")
    db.add(TaskEvent(task_id=task.id, kind="message", message=text[:20000], data={"name": user.display_name}))
    if task.status not in RUNNING:
        _assign(task)
    await db.commit()
    await rt.publish("task", user.id)
    await rt.publish("wake", user.id, "agent")
    return _out(task)


@router.post("/{task_id}/parar")
async def parar(task_id: int, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    task = await _mine(task_id, user, db)
    await rt.command(user.id, {"type": "stop", "task_id": task.id})
    return {"queued": "stop"}
