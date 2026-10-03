"""Numbers about the team, the AI, its cost and the code. Every block says where it comes from:

live           read from records the Hub keeps (tasks, sessions, approvals) or from git
calculated     derived from live numbers
estimated      the Claude SDK's own cost estimate for each run; never a bill
not_connected  there is no source for it, so no number is shown
"""
import asyncio
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import commits
from ..db import get_db
from ..models import AgentSession, Approval, Project, Subagent, Task, UsageRecord, User
from ..security import current_user, sees_all
from ..services import team_view
from .work import aware, visible_tasks

router = APIRouter(prefix="/api")


def _own(query, column, user: User):
    return query if sees_all(user) else query.where(column == user.id)


@router.get("/analytics")
async def analytics(days: int = 7, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    days = min(max(days, 1), 90)
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=days)
    names = {u.id: u.display_name for u in (await db.execute(select(User))).scalars()}

    team = await team_view(db, user)
    tasks = (await db.execute(visible_tasks(select(Task), user))).scalars().all()
    created = [t for t in tasks if aware(t.created_at) >= since]
    completed = [t for t in tasks if t.completed_at and aware(t.completed_at) >= since and t.status == "COMPLETED"]
    approvals = (await db.execute(_own(select(Approval).where(Approval.created_at >= since), Approval.user_id, user))).scalars().all()

    sessions = (await db.execute(_own(select(AgentSession).where(AgentSession.started_at >= since),
                                      AgentSession.user_id, user))).scalars().all()
    running = [s for s in sessions if s.status == "RUNNING"]
    subagents = (await db.execute(select(func.count(Subagent.id)).where(Subagent.session_id.in_([s.id for s in sessions])))).scalar() \
        if sessions else 0
    usage = (await db.execute(_own(select(UsageRecord).where(UsageRecord.created_at >= since), UsageRecord.user_id, user))).scalars().all()
    tokens = {"input": sum(u.input_tokens for u in usage), "output": sum(u.output_tokens for u in usage),
              "cache_read": sum(u.cache_read_tokens for u in usage), "cache_creation": sum(u.cache_creation_tokens for u in usage)}
    by_model: dict[str, dict] = {}
    for s in sessions:
        entry = by_model.setdefault(s.model or "desconhecido", {"sessions": 0, "tokens": 0})
        entry["sessions"] += 1
        entry["tokens"] += s.input_tokens + s.output_tokens
    seconds = sum((aware(s.finished_at) - aware(s.started_at)).total_seconds() for s in sessions if s.finished_at)

    cost_total = sum(u.cost_usd for u in usage)
    per_user: dict[int, float] = {}
    per_task: dict[int, float] = {}
    for u in usage:
        per_user[u.user_id] = per_user.get(u.user_id, 0) + u.cost_usd
        if u.task_id:
            per_task[u.task_id] = per_task.get(u.task_id, 0) + u.cost_usd
    task_by_id = {t.id: t for t in tasks}
    projects = {p.id: p.name for p in (await db.execute(select(Project))).scalars()}
    per_project: dict[str, float] = {}
    for task_id, cost in per_task.items():
        task = task_by_id.get(task_id)
        name = projects.get(task.project_id) if task and task.project_id else (task.project if task else "") or ""
        per_project[name or "Sem projeto"] = per_project.get(name or "Sem projeto", 0) + cost

    try:
        recent = await asyncio.wait_for(asyncio.to_thread(commits.recent, 100), 6)
        code_source = "live"
    except Exception:
        recent, code_source = [], "not_connected"
    period_commits = [c for c in recent if c.get("date") and _when(c["date"]) and _when(c["date"]) >= since]
    has_usage = bool(usage)
    return {
        "days": days,
        "team": {"source": "live", "people": len(team), "active_users": sum(1 for m in team if m["status"] != "OFFLINE"),
                 "active_sessions": len(running), "tasks_created": len(created), "tasks_completed": len(completed),
                 "tasks_open": sum(1 for t in tasks if t.status not in ("COMPLETED", "STOPPED")),
                 "approvals": len(approvals), "approvals_pending": sum(1 for a in approvals if a.status == "PENDING")},
        "ai": {"source": "live" if sessions or usage else "no_data", "sessions": len(sessions), "runs": len(usage), "tokens": tokens,
               "models": [{"model": m, **v} for m, v in sorted(by_model.items(), key=lambda kv: -kv[1]["sessions"])],
               "agents": len({s.user_id for s in sessions}), "subagents": subagents or 0,
               "tool_uses": sum(s.tool_uses for s in sessions), "ai_seconds": round(seconds)},
        "cost": {"source": "estimated" if has_usage else "no_data", "total_usd": round(cost_total, 2) if has_usage else None,
                 "per_user": [{"name": names.get(uid, "?"), "cost_usd": round(c, 2)} for uid, c in sorted(per_user.items(), key=lambda kv: -kv[1])],
                 "per_project": [{"name": n, "cost_usd": round(c, 2)} for n, c in sorted(per_project.items(), key=lambda kv: -kv[1])],
                 "per_task": [{"id": tid, "title": task_by_id[tid].title if tid in task_by_id else f"#{tid}", "cost_usd": round(c, 2)}
                              for tid, c in sorted(per_task.items(), key=lambda kv: -kv[1])[:8]]},
        "code": {"source": code_source, "commits": len(period_commits),
                 "added": sum((c.get("stats") or {}).get("added", 0) for c in period_commits),
                 "deleted": sum((c.get("stats") or {}).get("deleted", 0) for c in period_commits),
                 "repos": sorted({c["repo"] for c in period_commits}),
                 "pull_requests": {"source": "not_connected"}, "code_reviews": {"source": "not_connected"}},
        "value": {
            "cost_per_task": {"source": "calculated" if has_usage and completed else "no_data",
                              "usd": round(cost_total / len(completed), 2) if has_usage and completed else None},
            "cost_per_commit": {"source": "calculated" if has_usage and period_commits else "no_data",
                                "usd": round(cost_total / len(period_commits), 2) if has_usage and period_commits else None},
            "time_saved": {"source": "not_connected"}},
    }


def _when(text: str) -> datetime | None:
    try:
        return aware(datetime.fromisoformat(text.replace("Z", "+00:00")))
    except ValueError:
        return None
