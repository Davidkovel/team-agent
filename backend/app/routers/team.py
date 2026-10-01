from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..models import Activity, Approval, UsageRecord, User
from ..realtime import rt
from ..security import current_user, require_owner, sees_all
from ..services import approval_out, iso, log_activity, team_view

router = APIRouter(prefix="/api")


class Decision(BaseModel):
    approve: bool


@router.get("/team")
async def team(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    return await team_view(db, user)


@router.get("/activity")
async def activity(limit: int = 50, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    query = select(Activity).order_by(Activity.id.desc()).limit(min(limit, 200))
    if not sees_all(user):
        query = query.where(Activity.user_id == user.id)
    return [
        {"id": a.id, "user": a.user.username, "kind": a.kind, "message": a.message,
         "task_id": a.task_id, "created_at": iso(a.created_at)}
        for a in (await db.execute(query)).scalars()
    ]


@router.get("/usage")
async def usage(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    query = (
        select(User.username, func.sum(UsageRecord.input_tokens), func.sum(UsageRecord.output_tokens),
               func.sum(UsageRecord.cache_read_tokens), func.sum(UsageRecord.cost_usd), func.count(UsageRecord.id))
        .join(User, User.id == UsageRecord.user_id).group_by(User.username)
    )
    if not sees_all(user):
        query = query.where(UsageRecord.user_id == user.id)
    return [
        {"user": name, "input_tokens": inp or 0, "output_tokens": out or 0, "cache_read_tokens": cache or 0,
         "cost_usd": round(cost or 0, 4), "runs": runs}
        for name, inp, out, cache, cost, runs in (await db.execute(query)).all()
    ]


@router.get("/approvals")
async def approvals(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    query = select(Approval).order_by(Approval.id.desc()).limit(100)
    if not sees_all(user):
        query = query.where(Approval.user_id == user.id)
    return [approval_out(a) for a in (await db.execute(query)).scalars()]


@router.post("/approvals/{approval_id}/decide")
async def decide(approval_id: int, body: Decision, owner: User = Depends(require_owner), db: AsyncSession = Depends(get_db)):
    approval = await db.get(Approval, approval_id)
    if not approval:
        raise HTTPException(404, "Approval not found")
    if approval.status != "PENDING":
        raise HTTPException(409, f"Already {approval.status}")
    approval.status = "APPROVED" if body.approve else "REJECTED"
    approval.decided_by = owner.id
    approval.decided_at = datetime.now(timezone.utc)
    await db.commit()
    verb = "aprovou" if approval.status == "APPROVED" else "recusou"
    await log_activity(db, owner, "approval_decided",
                       f"{owner.display_name} {verb} o pedido de {approval.user.display_name}: {approval.action}", approval.task_id)
    await rt.publish("approval", approval.user_id)
    await rt.command(approval.user_id, {"type": "approval", "approval_id": approval.id, "status": approval.status})
    return approval_out(approval)
