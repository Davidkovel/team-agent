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

from .. import commits, week
from ..db import get_db
from ..models import Activity, AgentSession, Approval, ClaudeAgent, ClaudeSession, Project, Subagent, Task, UsageRecord, User
from ..security import current_user, sees_all
from ..services import iso, not_mistake, team_view
from .office import KEEP, _state, _topic
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
    people = await _people(db, user, since, days, tasks, sessions, approvals, period_commits, now)
    return {
        "people": people,
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


@router.get("/analytics/ranking")
async def ranking(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    """Who did how much, today and this week (Monday on): commits and lines from git, tasks completed and AI
    sessions from the Hub's own records. Each list is ordered by commits, then tasks completed, then lines."""
    now = datetime.now(timezone.utc).astimezone()
    starts = {"today": now.replace(hour=0, minute=0, second=0, microsecond=0), "week": week.week_start(now)}
    users = list((await db.execute(select(User).order_by(User.id))).scalars())
    team = {m["user"] for m in await team_view(db, user)}
    users = [u for u in users if u.username in team]
    rows = {key: {u.id: {"commits": 0, "added": 0, "deleted": 0, "tasks_done": 0, "sessions": 0} for u in users} for key in starts}

    def add(uid, when, field, n=1):
        for key, start in starts.items():
            if uid in rows[key] and when and when.astimezone() >= start:
                rows[key][uid][field] += n

    alias_map = week.aliases()
    recent = await asyncio.to_thread(commits.recent, 100)
    for c in recent:
        u = week.person_for(c["author"], users, alias_map)
        when = _when(c.get("date") or "")
        if u and when:
            stats = c.get("stats") or {}
            add(u.id, when, "commits")
            add(u.id, when, "added", stats.get("added", 0))
            add(u.id, when, "deleted", stats.get("deleted", 0))
    for t in (await db.execute(select(Task).where(Task.status == "COMPLETED", Task.completed_at.is_not(None), not_mistake()))).scalars():
        add(t.assignee_id, aware(t.completed_at), "tasks_done")
    for s in (await db.execute(select(AgentSession).where(AgentSession.started_at >= starts["week"]))).scalars():
        add(s.user_id, aware(s.started_at), "sessions")

    def listed(key):
        out = [{"user": u.username, "name": u.display_name, **rows[key][u.id]} for u in users]
        return sorted(out, key=lambda r: (r["commits"], r["tasks_done"], r["added"] + r["deleted"]), reverse=True)

    return {"source": "live" if recent else "not_connected", "today": listed("today"), "week": listed("week")}


async def _members(db: AsyncSession, viewer: User) -> list[User]:
    """The people the viewer sees on the team, in the team's order."""
    users = {u.username: u for u in (await db.execute(select(User))).scalars()}
    return [users[m["user"]] for m in await team_view(db, viewer) if m["user"] in users]


async def _windows(db: AsyncSession, since: datetime) -> tuple[list[ClaudeSession], dict[int, list[int]]]:
    """The Claude Code windows of the team's PCs (the Escritório's claude_sessions) with a step since `since`, and the
    tokens of each one's subagents."""
    rows = (await db.execute(select(ClaudeSession).where(ClaudeSession.updated_at >= since))).scalars().all()
    subs: dict[int, list[int]] = {}
    if rows:
        found = await db.execute(select(ClaudeAgent.session_id, ClaudeAgent.tokens).where(ClaudeAgent.session_id.in_([r.id for r in rows])))
        for session_id, tokens in found.all():
            subs.setdefault(session_id, []).append(tokens or 0)
    return rows, subs


async def _people(db, viewer, since, days, tasks, sessions, approvals, period_commits, now) -> dict:
    """Who did what in the period, person by person: commits and lines from git, tasks finished and created, the runs of
    their automatic agent, the approvals it asked for and their Claude Code windows. The windows are kept for a week
    (office.KEEP), so they cover `claude_days`, never more."""
    members = await _members(db, viewer)
    out = {u.id: {"user": u.username, "name": u.display_name, "commits": 0, "added": 0, "deleted": 0, "tasks_done": 0,
                  "tasks_created": 0, "agent_sessions": 0, "approvals": 0, "claude_windows": 0, "claude_tokens": 0} for u in members}
    alias_map = week.aliases()
    for c in period_commits:
        u = week.person_for(c["author"], members, alias_map)
        if u and u.id in out:
            stats = c.get("stats") or {}
            out[u.id]["commits"] += 1
            out[u.id]["added"] += stats.get("added", 0)
            out[u.id]["deleted"] += stats.get("deleted", 0)
    for t in tasks:
        if t.status == "COMPLETED" and t.completed_at and aware(t.completed_at) >= since and t.assignee_id in out:
            out[t.assignee_id]["tasks_done"] += 1
        if aware(t.created_at) >= since and t.created_by in out:
            out[t.created_by]["tasks_created"] += 1
    for s in sessions:
        if s.user_id in out:
            out[s.user_id]["agent_sessions"] += 1
    for a in approvals:
        if a.user_id in out:
            out[a.user_id]["approvals"] += 1
    rows, subs = await _windows(db, max(since, now - KEEP))
    for r in rows:
        tokens = (r.tokens or 0) + sum(subs.get(r.id, []))
        if tokens and r.user_id in out:
            out[r.user_id]["claude_windows"] += 1
            out[r.user_id]["claude_tokens"] += tokens
    listed = sorted(out.values(), key=lambda p: (p["commits"] + p["tasks_done"], p["claude_tokens"]), reverse=True)
    return {"claude_days": min(days, KEEP.days), "list": listed}


@router.get("/analytics/claude")
async def claude_usage(days: int = 7, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    """How much Claude the team used (Uso de IA, 21 Oct: the page said «Sem dados» while the Escritório showed 524k
    tokens today). Two sources, never mixed up: every Claude Code window on the team's PCs (claude_sessions, the tokens
    read from each window's transcript, with its subagents': live) and the runs of each person's automatic agent (what
    the Agent SDK reported, with its own cost estimate). The windows are kept for a week, so `days` is at most 7; a window
    counts on the day of its last step, as in the Escritório. Claude Code windows run on the plan: no cost is made up for
    them."""
    days = min(max(days, 1), KEEP.days)
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=days)
    midnight = now.astimezone().replace(hour=0, minute=0, second=0, microsecond=0)
    dates = [(midnight - timedelta(days=i)).date().isoformat() for i in range(days - 1, -1, -1)]
    members = await _members(db, user)
    people = {u.id: {"user": u.username, "name": u.display_name, "windows": 0, "tokens": 0, "subagents": 0, "subagent_tokens": 0,
                     "today": 0, "working": 0, "last": None, "by_day": {d: 0 for d in dates}, "models": {},
                     "agent_sessions": 0, "agent_runs": 0, "agent_tokens": 0, "agent_cost_usd": None} for u in members}
    rows, subs = await _windows(db, since)
    models: dict[str, dict] = {}
    projects: dict[str, dict] = {}
    top = []
    for r in rows:
        mine = subs.get(r.id, [])
        tokens = (r.tokens or 0) + sum(mine)
        p = people.get(r.user_id)
        if not tokens or p is None:
            continue
        when = aware(r.updated_at)
        state = _state(r)
        p["windows"] += 1
        p["tokens"] += tokens
        p["subagents"] += len(mine)
        p["subagent_tokens"] += sum(mine)
        day = when.astimezone().date().isoformat()
        if day in p["by_day"]:
            p["by_day"][day] += tokens
        if when >= midnight:
            p["today"] += tokens
        if state in ("working", "waiting"):
            p["working"] += 1
        p["last"] = max(p["last"] or when, when)
        model = r.model or "?"
        p["models"][model] = p["models"].get(model, 0) + tokens
        for table, key in ((models, model), (projects, r.project or "?")):
            entry = table.setdefault(key, {"name": key, "windows": 0, "tokens": 0})
            entry["windows"] += 1
            entry["tokens"] += tokens
        top.append({"user": r.user.username, "name": r.user.display_name, "project": r.project, "topic": _topic(r), "model": r.model,
                    "tokens": tokens, "subagents": len(mine), "state": state, "started_at": iso(r.started_at), "updated_at": iso(when)})
    sessions = (await db.execute(_own(select(AgentSession).where(AgentSession.started_at >= since), AgentSession.user_id, user))).scalars().all()
    usage = (await db.execute(_own(select(UsageRecord).where(UsageRecord.created_at >= since), UsageRecord.user_id, user))).scalars().all()
    for s in sessions:
        if s.user_id in people:
            people[s.user_id]["agent_sessions"] += 1
    for u in usage:
        p = people.get(u.user_id)
        if p is not None:
            p["agent_runs"] += 1
            p["agent_tokens"] += u.input_tokens + u.output_tokens
            p["agent_cost_usd"] = round((p["agent_cost_usd"] or 0) + u.cost_usd, 4)
    listed = sorted(people.values(), key=lambda p: -(p["tokens"] + p["agent_tokens"]))
    for p in listed:
        p["last"] = iso(p["last"])
        p["models"] = [m for m, _ in sorted(p["models"].items(), key=lambda kv: -kv[1])]
    count = sum(p["windows"] for p in listed)
    return {
        "days": days, "kept_days": KEEP.days, "dates": dates, "source": "live" if count or usage else "no_data",
        "windows": {"source": "live" if count else "no_data", "count": count, "tokens": sum(p["tokens"] for p in listed),
                    "subagents": sum(p["subagents"] for p in listed), "subagent_tokens": sum(p["subagent_tokens"] for p in listed),
                    "today": sum(p["today"] for p in listed), "working": sum(p["working"] for p in listed)},
        "agent": {"source": "live" if usage or sessions else "no_data", "sessions": len(sessions), "runs": len(usage),
                  "input_tokens": sum(u.input_tokens for u in usage), "output_tokens": sum(u.output_tokens for u in usage),
                  "cache_read_tokens": sum(u.cache_read_tokens for u in usage),
                  "cost_usd": round(sum(u.cost_usd for u in usage), 2) if usage else None, "cost_source": "estimated" if usage else "no_data"},
        "people": listed,
        "models": sorted(models.values(), key=lambda m: -m["tokens"]),
        "projects": sorted(projects.values(), key=lambda m: -m["tokens"])[:8],
        "top": sorted(top, key=lambda w: -w["tokens"])[:8],
    }


PRESENCE = ("login", "hub_online", "hub_offline", "agent_online", "agent_offline")  # comings and goings, not work


def _activity_out(a: Activity) -> dict:
    return {"id": a.id, "user": a.user.username, "name": a.user.display_name, "kind": a.kind, "message": a.message,
            "task_id": a.task_id, "company": a.company, "created_at": iso(a.created_at)}


@router.get("/analytics/feed")
async def feed(limit: int = 200, before: int | None = None, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    """The team's timeline for Ao vivo and Histórico, without the comings and goings drowning it (21 Oct: «Marco entrou no
    Hub» fifteen times in a row hid the commits and the tasks, and 300 lines of /api/history reached back only a few days).
    `items` is what people and agents did, newest first, `limit` at a time (`before`: the id of the oldest one already
    shown). `presence` (entrou no Hub, ficou online, saiu, ligou/desligou o agente) comes apart, only for the stretch of
    time `items` covers, so the page folds it into one line per person and nothing is lost. The whole team sees it, like
    /api/history."""
    limit = min(max(limit, 1), 300)
    query = select(Activity).where(Activity.kind.not_in(PRESENCE)).order_by(Activity.id.desc()).limit(limit + 1)
    newest = None
    if before is not None:
        query = query.where(Activity.id < before)
        anchor = await db.get(Activity, before)
        newest = anchor.created_at if anchor else None
    rows = (await db.execute(query)).scalars().all()
    more = len(rows) > limit
    rows = rows[:limit]
    presence = select(Activity).where(Activity.kind.in_(PRESENCE)).order_by(Activity.id.desc()).limit(1500)
    if more and rows:
        presence = presence.where(Activity.created_at >= rows[-1].created_at)
    if newest is not None:
        presence = presence.where(Activity.created_at < newest)
    return {"items": [_activity_out(a) for a in rows], "presence": [_activity_out(a) for a in (await db.execute(presence)).scalars()],
            "more": more}


def _when(text: str) -> datetime | None:
    try:
        return aware(datetime.fromisoformat(text.replace("Z", "+00:00")))
    except ValueError:
        return None
