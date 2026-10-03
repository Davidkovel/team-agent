"""Questions asked in the Hub, and the weekly report.

The Hub has no AI of its own and holds no API key. A question becomes a request for the asker's own Local Team Agent:
the Hub gathers the real data the answer must rest on, the agent runs Claude with it (the same sign-in and the same
usage accounting as a task) and posts the answer back. No agent connected means no answer, and the Hub says so.
"""
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import week
from ..db import get_db
from ..models import TASK_STAGE, AIRequest, Approval, Task, UsageRecord, User
from ..realtime import rt
from ..security import agent_user, current_user, sees_all
from ..services import SOFT_VIA, iso, team_view
from .work import aware, attention_items, visible_tasks

router = APIRouter(prefix="/api")

TIMEOUT = timedelta(minutes=4)  # an agent that took the request and went silent


class Ask(BaseModel):
    question: str = Field("", max_length=2000)
    kind: Literal["chat", "weekly_report"] = "chat"


class Result(BaseModel):
    answer: str = ""
    error: str = ""


def request_out(r: AIRequest) -> dict:
    return {"id": r.id, "kind": r.kind, "question": r.question, "status": r.status, "answer": r.answer,
            "error": r.error, "created_at": iso(r.created_at), "finished_at": iso(r.finished_at)}


async def agent_connected(user_id: int) -> bool:
    presence = await rt.store.get_presence(user_id)
    return presence is not None and presence.get("via") not in SOFT_VIA


async def hub_context(db: AsyncSession, user: User, kind: str) -> dict:
    """The real state of the Hub, as this person may see it. The answer may use nothing else."""
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=7)
    tasks = (await db.execute(visible_tasks(select(Task).order_by(Task.id.desc()).limit(80), user))).scalars().all()
    usage = select(User.display_name, func.sum(UsageRecord.input_tokens), func.sum(UsageRecord.output_tokens),
                   func.sum(UsageRecord.cost_usd), func.count(UsageRecord.id)) \
        .join(User, User.id == UsageRecord.user_id).where(UsageRecord.created_at >= since).group_by(User.id)
    if not sees_all(user):
        usage = usage.where(UsageRecord.user_id == user.id)
    pending = select(Approval).where(Approval.status == "PENDING")
    if not sees_all(user):
        pending = pending.where(Approval.user_id == user.id)
    context = {
        "now": now.astimezone().isoformat(timespec="minutes"),
        "asked_by": user.display_name,
        "team": [{"name": m["display_name"], "status": m["status"], "task": m.get("task") or "", "progress": m.get("progress", 0),
                  "current_action": m.get("current_action") or ""} for m in await team_view(db, user)],
        "tasks": [{"id": t.id, "title": t.title, "assignee": t.assignee.display_name, "stage": TASK_STAGE.get(t.status),
                   "status": t.status, "progress": t.progress, "priority": t.priority or "normal",
                   "project": (t.project_ref.name if t.project_ref else t.project) or "",
                   "completed_at": iso(t.completed_at), "blocked_reason": t.blocked_reason or ""} for t in tasks],
        "pending_approvals": [{"by": a.user.display_name, "action": a.action, "risk": a.risk or "unknown"}
                              for a in (await db.execute(pending)).scalars()],
        "needs_attention": [{"severity": i["severity"], "title": i["title"], "detail": i["detail"]}
                            for i in await attention_items(db, user)],
        "ai_usage_last_7_days": {
            "note": "cost is an estimate by the Claude SDK, not a bill",
            "people": [{"name": name, "input_tokens": inp or 0, "output_tokens": out or 0, "estimated_cost_usd": round(cost or 0, 2),
                        "runs": runs} for name, inp, out, cost, runs in (await db.execute(usage)).all()]},
    }
    if kind == "weekly_report":
        summary = await week.summary(db)
        context["week"] = {"number": summary["week"], "from": summary["from"], "to": summary["to"],
                           "people": [{k: p[k] for k in ("name", "commits", "tasks_done", "tasks_open", "logins", "edits")}
                                      for p in summary["people"]],
                           "by_day": [[{"who": f["who"], "what": f["what"], "text": f["text"]} for f in day[:25]]
                                      for day in summary["by_day"]]}
    return context


@router.post("/ai/ask")
async def ask(body: Ask, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    question = body.question.strip()
    if body.kind == "chat" and not question:
        raise HTTPException(422, "Empty question")
    request = AIRequest(user_id=user.id, kind=body.kind, question=question or "Weekly report")
    if await agent_connected(user.id):
        request.context = await hub_context(db, user, body.kind)
    else:
        request.status, request.error, request.finished_at = "ERROR", "agent_offline", datetime.now(timezone.utc)
    db.add(request)
    await db.commit()
    await db.refresh(request)
    if request.status == "PENDING":
        await rt.command(user.id, {"type": "ask", "request_id": request.id})
    return request_out(request)


async def _expire(request: AIRequest, db: AsyncSession):
    if request.status in ("PENDING", "RUNNING") and datetime.now(timezone.utc) - aware(request.created_at) > TIMEOUT:
        request.status, request.error, request.finished_at = "ERROR", "timeout", datetime.now(timezone.utc)
        await db.commit()


@router.get("/ai/requests")
async def requests(kind: str | None = None, limit: int = 20, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    query = select(AIRequest).where(AIRequest.user_id == user.id).order_by(AIRequest.id.desc()).limit(min(max(limit, 1), 100))
    if kind:
        query = query.where(AIRequest.kind == kind)
    rows = (await db.execute(query)).scalars().all()
    for r in rows:
        await _expire(r, db)
    return [request_out(r) for r in rows]


@router.get("/ai/requests/{request_id}")
async def request_status(request_id: int, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    request = await db.get(AIRequest, request_id)
    if not request or request.user_id != user.id:
        raise HTTPException(404, "Request not found")
    await _expire(request, db)
    return request_out(request)


@router.get("/ai/status")
async def status(user: User = Depends(current_user)):
    """Whether a question can be answered right now: it needs this person's own agent."""
    return {"agent_connected": await agent_connected(user.id)}


# ---- the Local Team Agent side ----

async def _own(request_id: int, user: User, db: AsyncSession) -> AIRequest:
    request = await db.get(AIRequest, request_id)
    if not request or request.user_id != user.id:
        raise HTTPException(404, "Request not found")
    return request


@router.get("/agent/ai/{request_id}")
async def take(request_id: int, user: User = Depends(agent_user), db: AsyncSession = Depends(get_db)):
    request = await _own(request_id, user, db)
    if request.status != "PENDING":
        raise HTTPException(409, f"Already {request.status}")
    request.status = "RUNNING"
    await db.commit()
    return {"id": request.id, "kind": request.kind, "question": request.question, "context": request.context or {}}


@router.post("/agent/ai/{request_id}/result")
async def result(request_id: int, body: Result, user: User = Depends(agent_user), db: AsyncSession = Depends(get_db)):
    request = await _own(request_id, user, db)
    if request.status not in ("PENDING", "RUNNING"):
        raise HTTPException(409, f"Already {request.status}")
    request.answer, request.error = body.answer, body.error
    request.status = "ERROR" if body.error or not body.answer else "DONE"
    request.finished_at = datetime.now(timezone.utc)
    await db.commit()
    await rt.publish("ai", user.id)
    return {"ok": True}
