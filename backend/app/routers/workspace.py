"""Workspace: shared notes, skill folders, finance and the leader overview."""
from collections import defaultdict
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..models import UNFINISHED, Approval, Doc, FinanceEntry, Task, UsageRecord, User
from ..realtime import rt
from ..security import current_user, require_owner
from ..services import iso

router = APIRouter(prefix="/api")


class DocIn(BaseModel):
    section: Literal["notes", "skills"]
    folder: str = Field("General", max_length=100)
    title: str = Field(min_length=1, max_length=200)
    content: str = ""
    shared: bool = True


class FinanceIn(BaseModel):
    kind: Literal["income", "expense"]
    amount: float = Field(gt=0)
    description: str = Field("", max_length=200)
    category: str = Field("", max_length=50)
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")


def doc_out(d: Doc) -> dict:
    return {"id": d.id, "section": d.section, "folder": d.folder, "title": d.title, "content": d.content,
            "shared": d.shared, "author": d.author.username, "updated_at": iso(d.updated_at)}


async def editable_doc(doc_id: int, user: User, db: AsyncSession) -> Doc:
    doc = await db.get(Doc, doc_id)
    if not doc or (not doc.shared and doc.author_id != user.id):
        raise HTTPException(404, "Document not found")
    return doc


@router.get("/docs")
async def list_docs(section: Literal["notes", "skills"], user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    query = (select(Doc).where(Doc.section == section, or_(Doc.shared, Doc.author_id == user.id))
             .order_by(Doc.folder, Doc.title))
    return [doc_out(d) for d in (await db.execute(query)).scalars()]


@router.post("/docs")
async def create_doc(body: DocIn, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    doc = Doc(**body.model_dump(), author_id=user.id)
    db.add(doc)
    await db.commit()
    await db.refresh(doc)
    await rt.publish("docs", user.id, "team")
    return doc_out(doc)


@router.put("/docs/{doc_id}")
async def update_doc(doc_id: int, body: DocIn, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    doc = await editable_doc(doc_id, user, db)
    if body.shared != doc.shared and doc.author_id != user.id:
        raise HTTPException(403, "Only the author can change who sees this")
    for key, value in body.model_dump().items():
        setattr(doc, key, value)
    await db.commit()
    await db.refresh(doc)
    await rt.publish("docs", user.id, "team")
    return doc_out(doc)


@router.delete("/docs/{doc_id}")
async def delete_doc(doc_id: int, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    doc = await editable_doc(doc_id, user, db)
    if doc.author_id != user.id and user.role != "owner":
        raise HTTPException(403, "Only the author or the owner can delete this")
    await db.delete(doc)
    await db.commit()
    await rt.publish("docs", user.id, "team")
    return {"ok": True}


async def finance_summary(db: AsyncSession) -> dict:
    entries = (await db.execute(select(FinanceEntry).order_by(FinanceEntry.date.desc(), FinanceEntry.id.desc()))).scalars().all()
    ai_cost = (await db.execute(select(func.sum(UsageRecord.cost_usd)))).scalar() or 0.0
    months: dict[str, dict] = defaultdict(lambda: {"income": 0.0, "expense": 0.0})
    for e in entries:
        months[e.date[:7]][e.kind] += e.amount
    income = sum(m["income"] for m in months.values())
    expenses = sum(m["expense"] for m in months.values())
    return {
        "income": round(income, 2), "expenses": round(expenses, 2), "ai_cost": round(ai_cost, 2),
        # AI credits are an SDK estimate, so profit is an estimate too.
        "profit": round(income - expenses - ai_cost, 2),
        "months": [{"month": k, "income": round(v["income"], 2), "expenses": round(v["expense"], 2)}
                   for k, v in sorted(months.items())[-12:]],
        "entries": [{"id": e.id, "kind": e.kind, "amount": e.amount, "description": e.description,
                     "category": e.category, "date": e.date} for e in entries[:200]],
    }


@router.get("/finance")
async def finance(owner: User = Depends(require_owner), db: AsyncSession = Depends(get_db)):
    return await finance_summary(db)


@router.post("/finance")
async def add_finance(body: FinanceIn, owner: User = Depends(require_owner), db: AsyncSession = Depends(get_db)):
    db.add(FinanceEntry(**body.model_dump(), created_by=owner.id))
    await db.commit()
    await rt.publish("finance", owner.id, "private")
    return {"ok": True}


@router.delete("/finance/{entry_id}")
async def delete_finance(entry_id: int, owner: User = Depends(require_owner), db: AsyncSession = Depends(get_db)):
    entry = await db.get(FinanceEntry, entry_id)
    if not entry:
        raise HTTPException(404, "Entry not found")
    await db.delete(entry)
    await db.commit()
    await rt.publish("finance", owner.id, "private")
    return {"ok": True}


@router.get("/overview")
async def overview(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    mine = user.role != "owner"

    async def count(model, *where):
        query = select(func.count(model.id)).where(*where)
        return (await db.execute(query)).scalar() or 0

    task_scope = [Task.assignee_id == user.id] if mine else []
    usage_query = select(func.sum(UsageRecord.cost_usd))
    if mine:
        usage_query = usage_query.where(UsageRecord.user_id == user.id)
    users = (await db.execute(select(User.id))).scalars().all()
    online = sum([await rt.store.get_presence(uid) is not None for uid in users])
    out = {
        "tasks_active": await count(Task, Task.status.in_(("ASSIGNED", *UNFINISHED)), *task_scope),
        "tasks_completed": await count(Task, Task.status == "COMPLETED", *task_scope),
        "pending_approvals": await count(Approval, Approval.status == "PENDING",
                                         *([Approval.user_id == user.id] if mine else [])),
        "agents_online": online, "agents_total": len(users),
        "ai_cost": round((await db.execute(usage_query)).scalar() or 0.0, 2),
    }
    if not mine:
        summary = await finance_summary(db)
        out["finance"] = {k: summary[k] for k in ("income", "expenses", "profit")}
    return out
