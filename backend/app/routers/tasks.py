from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..models import Task, TaskEvent, User
from ..realtime import rt
from ..security import current_user, sees_all
from ..services import event_out, log_activity, task_out

router = APIRouter(prefix="/api/tasks")


class TaskCreate(BaseModel):
    title: str
    description: str = ""
    goal: str = ""
    requirements: list[str] = []
    project: str = ""
    assignee: str


class Control(BaseModel):
    action: Literal["pause", "resume", "stop"]


async def get_task(task_id: int, user: User, db: AsyncSession) -> Task:
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(404, "Task not found")
    if not sees_all(user) and task.assignee_id != user.id:
        raise HTTPException(403, "Not your task")
    return task


@router.post("")
async def create_task(body: TaskCreate, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    assignee = (await db.execute(select(User).where(User.username == body.assignee))).scalar_one_or_none()
    if not assignee:
        raise HTTPException(404, "Assignee not found")
    if not sees_all(user) and assignee.id != user.id:
        raise HTTPException(403, "Members can only create tasks for themselves")
    task = Task(**body.model_dump(exclude={"assignee"}), assignee_id=assignee.id, created_by=user.id)
    db.add(task)
    await db.commit()
    await db.refresh(task)
    await log_activity(db, assignee, "task_assigned", f"recebeu a tarefa: {task.title}", task.id)
    await rt.publish("task", assignee.id)
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
    return {**task_out(task), "events": [event_out(e) for e in events]}


@router.post("/{task_id}/control")
async def control(task_id: int, body: Control, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    task = await get_task(task_id, user, db)
    await rt.command(task.assignee_id, {"type": body.action, "task_id": task.id})
    verb = {"pause": "pausar", "resume": "retomar", "stop": "parar"}[body.action]
    await log_activity(db, user, "control", f"{user.display_name} pediu para {verb} a tarefa: {task.title}", task.id)
    return {"queued": body.action}
