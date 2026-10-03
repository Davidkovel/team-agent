"""Projects, memory, expenses, notifications, what needs attention, and search across the Hub."""
import asyncio
from datetime import date, datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import commits, hub
from ..db import get_db
from ..models import TASK_STAGE, Activity, AgentSession, Approval, Expense, Memory, Notification, Project, Task, UsageRecord, User
from ..realtime import rt
from ..security import current_user, require_owner, sees_all
from ..services import approval_out, iso, task_out, team_view

router = APIRouter(prefix="/api")

OPEN_STAGES = ("todo", "in_progress", "blocked", "review", "approval")
OPEN_STATUSES = [s for s, stage in TASK_STAGE.items() if stage in OPEN_STAGES]


def aware(dt: datetime | None) -> datetime | None:
    """SQLite hands datetimes back without a timezone; they were stored as UTC."""
    return dt if dt is None or dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def visible_tasks(query, user: User):
    return query if sees_all(user) else query.where(Task.assignee_id == user.id)


# ---------------------------------------------------------------- projects

class ProjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    company: str | None = None
    status: Literal["active", "maintenance", "paused", "done"] = "active"
    description: str = ""
    repo: str = ""


class ProjectEdit(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=100)
    company: str | None = None
    status: Literal["active", "maintenance", "paused", "done"] | None = None
    description: str | None = None
    repo: str | None = None


def project_out(p: Project, tasks: list[Task] = (), sessions: int = 0) -> dict:
    open_tasks = [t for t in tasks if TASK_STAGE.get(t.status) in OPEN_STAGES]
    return {"id": p.id, "name": p.name, "company": p.company, "status": p.status, "description": p.description,
            "repo": p.repo, "created_at": iso(p.created_at), "tasks": len(tasks), "open_tasks": len(open_tasks),
            "done_tasks": len(tasks) - len(open_tasks), "people": sorted({t.assignee.username for t in open_tasks}),
            "active_sessions": sessions}


async def _project_stats(db: AsyncSession, user: User) -> tuple[dict[int, list[Task]], dict[int, int]]:
    tasks: dict[int, list[Task]] = {}
    query = visible_tasks(select(Task).where(Task.project_id.is_not(None)), user)
    for t in (await db.execute(query)).scalars():
        tasks.setdefault(t.project_id, []).append(t)
    running = (select(Task.project_id, func.count(AgentSession.id)).join(Task, Task.id == AgentSession.task_id)
               .where(AgentSession.status == "RUNNING", Task.project_id.is_not(None)).group_by(Task.project_id))
    return tasks, dict((await db.execute(running)).all())


@router.get("/projects")
async def projects(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    tasks, sessions = await _project_stats(db, user)
    rows = (await db.execute(select(Project).order_by(Project.name))).scalars()
    return [project_out(p, tasks.get(p.id, []), sessions.get(p.id, 0)) for p in rows]


@router.post("/projects")
async def create_project(body: ProjectIn, user: User = Depends(require_owner), db: AsyncSession = Depends(get_db)):
    if body.company and body.company not in hub.companies():
        raise HTTPException(404, "Company not found")
    if (await db.execute(select(Project).where(Project.name == body.name))).scalar_one_or_none():
        raise HTTPException(409, "A project with this name already exists")
    project = Project(**body.model_dump(), created_by=user.id)
    db.add(project)
    await db.commit()
    await db.refresh(project)
    await rt.publish("project", user.id, "team")
    return project_out(project)


@router.get("/projects/{project_id}")
async def project_detail(project_id: int, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    tasks, sessions = await _project_stats(db, user)
    mine = tasks.get(project.id, [])
    cost = (await db.execute(select(func.sum(UsageRecord.cost_usd)).join(Task, Task.id == UsageRecord.task_id)
                             .where(Task.project_id == project.id))).scalar()
    return {**project_out(project, mine, sessions.get(project.id, 0)),
            "task_list": [task_out(t) for t in sorted(mine, key=lambda t: -t.id)],
            "ai_cost_usd": None if cost is None else round(cost, 4)}


@router.patch("/projects/{project_id}")
async def edit_project(project_id: int, body: ProjectEdit, user: User = Depends(require_owner), db: AsyncSession = Depends(get_db)):
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    for key, value in body.model_dump(exclude_unset=True).items():
        setattr(project, key, value)
    await db.commit()
    await rt.publish("project", user.id, "team")
    return project_out(project)


# ---------------------------------------------------------------- memory

SCOPES = ("global", "team", "company", "project", "agent", "task")


class MemoryIn(BaseModel):
    scope: Literal["global", "team", "company", "project", "agent", "task"]
    scope_id: str = ""
    category: str = ""
    title: str = Field(min_length=1, max_length=200)
    content: str = ""


class MemoryEdit(BaseModel):
    category: str | None = None
    title: str | None = Field(None, min_length=1, max_length=200)
    content: str | None = None


def memory_out(m: Memory) -> dict:
    return {"id": m.id, "scope": m.scope, "scope_id": m.scope_id, "category": m.category, "title": m.title,
            "content": m.content, "updated_at": iso(m.updated_at)}


async def memory_for_task(db: AsyncSession, task: Task) -> list[Memory]:
    """Everything the AI should know before this task: global and team notes, then the company's, the project's,
    the assignee's agent, and the task's own."""
    company = task.company or (task.project if task.project in hub.companies() else None)
    wanted = [Memory.scope.in_(("global", "team")),
              (Memory.scope == "agent") & (Memory.scope_id == task.assignee.username),
              (Memory.scope == "task") & (Memory.scope_id == str(task.id))]
    if company:
        wanted.append((Memory.scope == "company") & (Memory.scope_id == company))
    if task.project_id:
        wanted.append((Memory.scope == "project") & (Memory.scope_id == str(task.project_id)))
    rows = (await db.execute(select(Memory).where(or_(*wanted)).order_by(Memory.id))).scalars().all()
    return sorted(rows, key=lambda m: SCOPES.index(m.scope))


@router.get("/memory")
async def memory(scope: str | None = None, scope_id: str | None = None,
                 user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    query = select(Memory).order_by(Memory.scope, Memory.scope_id, Memory.category, Memory.id)
    if scope:
        query = query.where(Memory.scope == scope)
    if scope_id is not None:
        query = query.where(Memory.scope_id == scope_id)
    if not sees_all(user):  # a member sees the shared notes and their own agent's
        query = query.where(or_(Memory.scope.in_(("global", "team", "company", "project")),
                                (Memory.scope == "agent") & (Memory.scope_id == user.username)))
    return [memory_out(m) for m in (await db.execute(query)).scalars()]


@router.post("/memory")
async def add_memory(body: MemoryIn, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    if not sees_all(user) and not (body.scope == "agent" and body.scope_id == user.username):
        raise HTTPException(403, "Members can only write their own agent's memory")
    if body.scope in ("global", "team"):
        body.scope_id = ""
    elif not body.scope_id:
        raise HTTPException(422, "This scope needs an id")
    entry = Memory(**body.model_dump(), created_by=user.id)
    db.add(entry)
    await db.commit()
    await db.refresh(entry)
    return memory_out(entry)


async def _own_memory(memory_id: int, user: User, db: AsyncSession) -> Memory:
    entry = await db.get(Memory, memory_id)
    if not entry:
        raise HTTPException(404, "Memory not found")
    if not sees_all(user) and entry.created_by != user.id:
        raise HTTPException(403, "Not yours")
    return entry


@router.put("/memory/{memory_id}")
async def edit_memory(memory_id: int, body: MemoryEdit, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    entry = await _own_memory(memory_id, user, db)
    for key, value in body.model_dump(exclude_unset=True).items():
        setattr(entry, key, value)
    await db.commit()
    await db.refresh(entry)
    return memory_out(entry)


@router.delete("/memory/{memory_id}")
async def delete_memory(memory_id: int, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    await db.delete(await _own_memory(memory_id, user, db))
    await db.commit()
    return {"ok": True}


# ---------------------------------------------------------------- expenses

class ExpenseIn(BaseModel):
    category: Literal["ai", "software", "ads", "infrastructure", "other"]
    title: str = Field(min_length=1, max_length=200)
    amount: float = Field(gt=0)
    currency: str = Field("EUR", min_length=3, max_length=3)
    company: str | None = None
    project_id: int | None = None
    spent_on: date | None = None


def expense_out(e: Expense, names: dict[int, str]) -> dict:
    return {"id": e.id, "category": e.category, "title": e.title, "amount": round(e.amount, 2), "currency": e.currency,
            "company": e.company, "project_id": e.project_id, "spent_on": e.spent_on, "by": names.get(e.created_by, "")}


async def ai_cost(db: AsyncSession, user: User, days: int = 7) -> dict:
    """What the AI cost, per person. An estimate made by the Claude SDK for each run: never a bill."""
    since = datetime.now(timezone.utc) - timedelta(days=days)
    query = (select(User.username, User.display_name, func.sum(UsageRecord.cost_usd), func.count(UsageRecord.id))
             .join(User, User.id == UsageRecord.user_id).where(UsageRecord.created_at >= since).group_by(User.id))
    if not sees_all(user):
        query = query.where(UsageRecord.user_id == user.id)
    rows = (await db.execute(query)).all()
    return {"source": "estimated" if rows else "no_data", "days": days,
            "total_usd": round(sum(r[2] or 0 for r in rows), 2) if rows else None,
            "people": [{"user": r[0], "name": r[1], "cost_usd": round(r[2] or 0, 2), "runs": r[3]} for r in rows]}


@router.get("/expenses")
async def expenses(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    names = {u.id: u.display_name for u in (await db.execute(select(User))).scalars()}
    rows = (await db.execute(select(Expense).order_by(Expense.spent_on.desc(), Expense.id.desc()).limit(300))).scalars().all()
    month = date.today().isoformat()[:7]
    totals: dict[str, dict[str, float]] = {}
    for e in rows:
        if e.spent_on.startswith(month):
            by_currency = totals.setdefault(e.category, {})
            by_currency[e.currency] = round(by_currency.get(e.currency, 0) + e.amount, 2)
    return {"items": [expense_out(e, names) for e in rows], "month": month, "month_totals": totals,
            "ai_cost": await ai_cost(db, user)}


@router.post("/expenses")
async def add_expense(body: ExpenseIn, user: User = Depends(require_owner), db: AsyncSession = Depends(get_db)):
    data = body.model_dump()
    data["spent_on"] = (body.spent_on or date.today()).isoformat()
    data["currency"] = body.currency.upper()
    expense = Expense(**data, created_by=user.id)
    db.add(expense)
    await db.commit()
    await db.refresh(expense)
    return expense_out(expense, {user.id: user.display_name})


@router.delete("/expenses/{expense_id}")
async def delete_expense(expense_id: int, user: User = Depends(require_owner), db: AsyncSession = Depends(get_db)):
    expense = await db.get(Expense, expense_id)
    if not expense:
        raise HTTPException(404, "Expense not found")
    await db.delete(expense)
    await db.commit()
    return {"ok": True}


# ---------------------------------------------------------------- notifications

class ReadIn(BaseModel):
    ids: list[int] | None = None  # None = everything


def notification_out(n: Notification) -> dict:
    return {"id": n.id, "kind": n.kind, "severity": n.severity, "title": n.title, "body": n.body, "href": n.href,
            "created_at": iso(n.created_at), "read": n.read_at is not None}


@router.get("/notifications")
async def notifications(limit: int = 40, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(Notification).where(Notification.user_id == user.id)
                             .order_by(Notification.id.desc()).limit(min(max(limit, 1), 200)))).scalars()
    unread = (await db.execute(select(func.count(Notification.id))
                               .where(Notification.user_id == user.id, Notification.read_at.is_(None)))).scalar()
    return {"unread": unread or 0, "items": [notification_out(n) for n in rows]}


@router.post("/notifications/read")
async def read_notifications(body: ReadIn, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    query = select(Notification).where(Notification.user_id == user.id, Notification.read_at.is_(None))
    if body.ids is not None:
        query = query.where(Notification.id.in_(body.ids))
    now = datetime.now(timezone.utc)
    for n in (await db.execute(query)).scalars():
        n.read_at = now
    await db.commit()
    await rt.publish("notification", user.id)
    return {"ok": True}


# ---------------------------------------------------------------- needs attention

async def attention_items(db: AsyncSession, user: User) -> list[dict]:
    """Only what really needs a person, worst first. Everything here is read from the live state, nothing is made up."""
    now = datetime.now(timezone.utc)
    items = []
    approvals = select(Approval).where(Approval.status == "PENDING").order_by(Approval.id)
    if not sees_all(user):
        approvals = approvals.where(Approval.user_id == user.id)
    for a in (await db.execute(approvals)).scalars():
        items.append({"severity": "high", "kind": "approval_required", "title": f"Claude / {a.user.display_name} precisa de aprovação",
                      "detail": a.action, "href": "#/aprovacoes", "at": iso(a.created_at)})
    for entry in await team_view(db, user):
        if entry["status"] == "ERROR":
            items.append({"severity": "medium", "kind": "agent_failed", "title": f"O agente de {entry['display_name']} parou com erro",
                          "detail": entry.get("error") or entry.get("task") or "", "href": f"#/agentes/{entry['user']}", "at": None})
        elif entry["status"] == "WAITING" and not any(i["kind"] == "approval_required" for i in items):
            items.append({"severity": "medium", "kind": "agent_waiting", "title": f"O agente de {entry['display_name']} está à espera",
                          "detail": entry.get("task") or "", "href": f"#/agentes/{entry['user']}", "at": None})
    tasks = (await db.execute(visible_tasks(select(Task).where(Task.status.in_(OPEN_STATUSES)), user))).scalars().all()
    for t in tasks:
        if TASK_STAGE.get(t.status) == "blocked":
            items.append({"severity": "medium", "kind": "task_blocked", "title": f"{t.assignee.display_name} tem uma tarefa bloqueada",
                          "detail": t.title, "href": f"#/tarefas/{t.id}", "at": iso(t.updated_at)})
        deadline = aware(t.deadline)
        if deadline and deadline - now < timedelta(hours=24):
            late = deadline < now
            items.append({"severity": "high" if late else "medium", "kind": "deadline",
                          "title": "Prazo ultrapassado" if late else "Prazo a menos de 24 horas",
                          "detail": t.title, "href": f"#/tarefas/{t.id}", "at": iso(deadline)})
    done = select(Task).where(Task.status == "COMPLETED", Task.priority.in_(("high", "urgent")),
                              Task.completed_at >= now - timedelta(hours=24))
    for t in (await db.execute(visible_tasks(done, user))).scalars():
        items.append({"severity": "low", "kind": "task_completed", "title": "Tarefa importante concluída",
                      "detail": t.title, "href": f"#/tarefas/{t.id}", "at": iso(t.completed_at)})
    order = {"high": 0, "medium": 1, "low": 2}
    return sorted(items, key=lambda i: order[i["severity"]])


@router.get("/attention")
async def attention(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    return await attention_items(db, user)


# ---------------------------------------------------------------- search

@router.get("/search")
async def search(q: str, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    """People, tasks, projects, companies, memory, approvals, activity and commits that mention the words."""
    needle = q.strip().lower()
    if len(needle) < 2:
        return []
    like = f"%{needle}%"
    out = []
    for u in (await db.execute(select(User))).scalars():
        if needle in u.username.lower() or needle in u.display_name.lower():
            out.append({"type": "person", "title": u.display_name, "detail": "Pessoa e agente", "href": f"#/agentes/{u.username}"})
    tasks = visible_tasks(select(Task).where(or_(func.lower(Task.title).like(like), func.lower(Task.description).like(like)))
                          .order_by(Task.id.desc()).limit(8), user)
    for t in (await db.execute(tasks)).scalars():
        out.append({"type": "task", "title": t.title, "detail": t.assignee.display_name, "href": f"#/tarefas/{t.id}"})
    for p in (await db.execute(select(Project).where(func.lower(Project.name).like(like)).limit(5))).scalars():
        out.append({"type": "project", "title": p.name, "detail": "Projeto", "href": f"#/projetos/{p.id}"})
    for company_id, company in hub.companies().items():
        if needle in company_id or needle in str(company.get("name", "")).lower():
            out.append({"type": "company", "title": company.get("name", company_id), "detail": "Empresa", "href": f"#/empresas/{company_id}"})
    notes = select(Memory).where(or_(func.lower(Memory.title).like(like), func.lower(Memory.content).like(like))).limit(5)
    if not sees_all(user):
        notes = notes.where(Memory.scope.in_(("global", "team", "company", "project")))
    for m in (await db.execute(notes)).scalars():
        out.append({"type": "memory", "title": m.title, "detail": "Memória", "href": "#/memoria"})
    approvals = select(Approval).where(func.lower(Approval.action).like(like)).order_by(Approval.id.desc()).limit(5)
    if not sees_all(user):
        approvals = approvals.where(Approval.user_id == user.id)
    for a in (await db.execute(approvals)).scalars():
        out.append({"type": "approval", "title": a.action, "detail": f"Aprovação · {a.user.display_name}", "href": "#/aprovacoes"})
    activity = select(Activity).where(func.lower(Activity.message).like(like)).order_by(Activity.id.desc()).limit(6)
    if not sees_all(user):
        activity = activity.where(Activity.user_id == user.id)
    for a in (await db.execute(activity)).scalars():
        out.append({"type": "activity", "title": a.message, "detail": a.user.display_name, "href": "#/historico"})
    try:
        recent = await asyncio.wait_for(asyncio.to_thread(commits.recent, 100), 4)
    except Exception:
        recent = []  # git is slow or missing: the rest of the search still answers
    for c in [c for c in recent if needle in c["message"].lower()][:5]:
        out.append({"type": "code", "title": c["message"], "detail": f"{c['repo']} · {c['author']}", "href": "#/codigo"})
    return out


@router.get("/approvals/pending-count")
async def pending_count(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    query = select(func.count(Approval.id)).where(Approval.status == "PENDING")
    if not sees_all(user):
        query = query.where(Approval.user_id == user.id)
    return {"pending": (await db.execute(query)).scalar() or 0}


__all__ = ["router", "attention_items", "memory_for_task", "ai_cost", "approval_out"]
