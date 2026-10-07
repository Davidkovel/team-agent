"""O Escritório: every Claude Code window on the team's PCs and the subagents it launches, live (docs/empresa-amg.md).

Claude Code runs scripts/claude_hook.py at each step (the hooks are put in place by claude_hooks.py); the hook posts the
step to this PC's own Hub, here. Only the state is kept - one row per window, one per subagent - never every step:
a window that makes 500 tool calls is one row that changes, writes to it are throttled, and sync (which carries every
table) moves only the latest state. What a step says is its name in words ("a editar pages.js"), never what is inside
a file, a command or a search. History older than a week is dropped.
"""
import asyncio
import re
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path, PureWindowsPath

from fastapi import APIRouter, Body, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from .. import commits, health, transcripts
from ..models import ClaudeAgent, ClaudeSession, PcHealth, User
from ..realtime import rt
from ..security import current_user
from ..services import iso
from .auth import ip_map
from .local import only_local

router = APIRouter(prefix="/api")

THROTTLE = 2.0          # seconds between two writes of the same window's "doing now" line
STALLED = 20 * 60       # working with no news for this long: it stopped without saying so
GONE = 12 * 3600        # no news for this long: the window was closed without a SessionEnd
SHOWN = 24 * 3600       # the office shows the windows of the last day
KEEP = timedelta(days=7)
SUBAGENT_TOOLS = ("Agent", "Task")
_last_write: dict[str, float] = {}  # session key -> when its row was last written
_last_prune = 0.0


def one_line(text, limit: int) -> str:
    text = " ".join(str(text or "").split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def _request(prompt) -> str:
    """The start of what was asked, as a person would say it: a message from another Claude session is named as such,
    and tags that Claude Code wraps around things are taken out."""
    text = str(prompt or "").lstrip()
    if text.startswith("<cross-session-message") or text.startswith("(mensagem de outra"):
        return "(mensagem de outra sessão do Claude)"
    if text.startswith("<task-notification"):
        return "(aviso: um agente acabou)"
    return one_line(re.sub(r"<[^>]{1,200}>", " ", text), 160)


def _file(inp: dict, *keys) -> str:
    for key in keys:
        if inp.get(key):
            return PureWindowsPath(str(inp[key])).name
    return ""


def describe(tool: str, inp: dict | None) -> str:
    """A step in words, for the person watching: what kind of thing, and at most a file name."""
    inp = inp or {}
    if tool == "Read":
        return one_line(f"a ler {_file(inp, 'file_path')}", 120)
    if tool in ("Edit", "Write", "MultiEdit", "NotebookEdit"):
        return one_line(f"a editar {_file(inp, 'file_path', 'notebook_path')}", 120)
    if tool in ("Bash", "PowerShell"):
        return "a correr: " + one_line(inp.get("description") or "um comando", 90)
    if tool in ("Grep", "Glob"):
        return "a procurar no código"
    if tool == "WebSearch":
        return "a pesquisar na web"
    if tool == "WebFetch":
        return "a ler uma página web"
    if tool in SUBAGENT_TOOLS:
        return one_line(f"lançou {inp.get('subagent_type') or 'um agente'}: {inp.get('description') or ''}", 140)
    if tool == "Skill":
        return one_line(f"a usar a skill {inp.get('skill') or ''}", 100)
    if tool in ("TodoWrite", "TaskCreate", "TaskUpdate", "TaskList", "TaskGet"):
        return "a organizar as tarefas"
    if tool == "AskUserQuestion":
        return "à espera da tua resposta"
    if tool in ("SendMessage", "ListAgents"):
        return "a falar com outra sessão"
    if tool.startswith("mcp__claude-in-chrome__"):
        return "a usar o Chrome"
    if tool.startswith("mcp__"):
        server = tool.split("__")[1].replace("claude_ai_", "").replace("plugin_", "").replace("_", " ")
        return one_line(f"a usar {server}", 80)
    return one_line(f"a usar {tool}", 80)


def _skill_name(name) -> str:
    return one_line(str(name or "").strip().lstrip("/").replace(",", " "), 60)


def _add_skill(used: str | None, name) -> str:
    """The skills a window (or a subagent) used, in the order it first used them; the oldest go if the list gets long."""
    name = _skill_name(name)
    names = [s for s in (used or "").split(",") if s]
    if name and name not in names:
        names.append(name)
    while len(",".join(names)) > 400:
        names.pop(0)
    return ",".join(names)


def _typed_skill(prompt) -> str:
    """A skill the person called by its name ("/boa", or the <command-name> Claude Code wraps around it)."""
    text = str(prompt or "")
    found = re.search(r"<command-name>/?([\w:.-]{2,60})</command-name>", text) or re.match(r"\s*/([A-Za-z][\w:.-]{1,59})(?=\s|$)", text)
    return found.group(1) if found else ""


def _project(cwd: str) -> str:
    path = PureWindowsPath(cwd or "")
    return "pasta pessoal" if not path.name or path.parent.name.lower() == "users" else path.name  # C:\Users\<person> itself


def _text(response) -> str:
    """The words a tool answered with, whatever shape they come in."""
    if isinstance(response, str):
        return response
    if isinstance(response, dict):
        if isinstance(response.get("content"), (list, str)):
            return _text(response["content"])
        return str(response.get("result") or response.get("text") or response.get("output") or "")
    if isinstance(response, list):
        return " ".join(_text(part) for part in response if isinstance(part, (dict, str)))
    return ""


async def _used(path) -> dict | None:
    """Tokens and model so far of a transcript on this PC (only Claude Code's own .jsonl files under .claude)."""
    path = str(path or "")
    if not path.endswith(".jsonl") or ".claude" not in path:
        return None
    return await asyncio.to_thread(transcripts.usage, path)


def _status(row: ClaudeSession, status: str, when: datetime):
    if row.status != status:
        row.status, row.since = status, when


async def _owner(db: AsyncSession) -> User | None:
    """The person this PC belongs to: the steps come from here (127.0.0.1)."""
    login = ip_map().get("127.0.0.1")
    return login and (await db.execute(select(User).where(User.username == login))).scalar_one_or_none()


@router.post("/local/claude", dependencies=[Depends(only_local)])
async def claude_step(body: dict = Body(...), db: AsyncSession = Depends(get_db)):
    """One step of a Claude Code window on this PC, from its hook. Cheap and quiet: it never fails the hook."""
    event = str(body.get("hook_event_name") or "")
    key = str(body.get("session_id") or "")[:80]
    tool = str(body.get("tool_name") or "")
    if not key or not event:
        return {"ok": False}
    clock = time.time()
    inside = str(body.get("agent_id") or "") if event != "SubagentStop" and event != "SubagentStart" else ""  # a step a subagent takes itself
    # a skill is never lost in the 2 s between two writes: the arsenal keeps every one (_add_skill)
    routine = event == "PreToolUse" and tool not in SUBAGENT_TOOLS and tool not in ("AskUserQuestion", "Skill")
    throttle_key = f"{key}/{inside}" if inside else key
    if routine and clock - _last_write.get(throttle_key, 0) < THROTTLE:
        return {"ok": True, "written": False}  # a burst of steps: the row already says it is working
    user = await _owner(db)
    if not user:
        return {"ok": False}
    when = datetime.now(timezone.utc)
    row = (await db.execute(select(ClaudeSession).where(ClaudeSession.key == key, ClaudeSession.user_id == user.id))).scalar_one_or_none()
    if row is None:
        row = ClaudeSession(key=key, user_id=user.id, project=_project(str(body.get("cwd") or "")), started_at=when, since=when)
        db.add(row)
        await db.flush()
    elif body.get("cwd") and not inside:
        row.project = _project(str(body["cwd"]))
    inp = body.get("tool_input") if isinstance(body.get("tool_input"), dict) else {}

    if inside:  # the subagent's own steps say what it is doing; the window's line stays the window's
        agent = (await db.execute(select(ClaudeAgent).where(ClaudeAgent.session_id == row.id, ClaudeAgent.agent_id == inside[:80]))).scalars().first()
        if agent and event == "PreToolUse":
            agent.action = describe(tool, inp)
            if tool == "Skill":
                agent.skills = _add_skill(agent.skills, inp.get("skill"))
            await db.commit()
            _last_write[throttle_key] = clock
            await rt.publish("office", user.id, "team")
            return {"ok": True, "written": True}
        return {"ok": True, "written": False}

    if event == "SessionStart":
        if row.status == "ended":
            row.ended_at = None
        _status(row, "idle", when)
        row.action = "aberto"
    elif event == "UserPromptSubmit":
        _status(row, "working", when)
        row.since = when  # a new request starts the clock again
        row.prompt, row.action = _request(body.get("prompt")), "a pensar"
        if _typed_skill(body.get("prompt")):
            row.skills = _add_skill(row.skills, _typed_skill(body.get("prompt")))
    elif event == "PreToolUse":
        _status(row, "waiting" if tool == "AskUserQuestion" else "working", when)
        row.action = describe(tool, inp)
        if tool == "Skill":
            row.skills = _add_skill(row.skills, inp.get("skill"))
        if tool in SUBAGENT_TOOLS:
            db.add(ClaudeAgent(session_id=row.id, user_id=user.id, tool_use_id=str(body.get("tool_use_id") or "")[:80],
                               kind=one_line(inp.get("subagent_type") or "general-purpose", 60), model=one_line(inp.get("model") or "", 30),
                               description=one_line(inp.get("description") or inp.get("prompt"), 150), started_at=when))
    elif event in ("PostToolUse", "PostToolUseFailure") and tool in SUBAGENT_TOOLS:
        agent = (await db.execute(select(ClaudeAgent).where(ClaudeAgent.session_id == row.id, ClaudeAgent.tool_use_id == str(body.get("tool_use_id") or ""))
                                  .order_by(ClaudeAgent.id.desc()))).scalars().first()
        if agent:
            response = body.get("tool_response")
            facts = response if isinstance(response, dict) else {}
            text = _text(response)
            launched = facts.get("status") == "async_launched" or re.search(r"Async agent launched.*?agentId:\s*([\w-]+)", text, re.S)
            agent.agent_id = str(facts.get("agentId") or (launched.group(1) if hasattr(launched, "group") else "") or agent.agent_id)[:80]
            agent.model = one_line(facts.get("resolvedModel") or agent.model, 30)
            if event == "PostToolUseFailure":
                agent.status, agent.finished_at, agent.result = "failed", when, one_line(body.get("error") or text, 230)
            elif not launched:  # it ran in the foreground and has its answer; one in the background ends with its SubagentStop
                agent.status, agent.finished_at, agent.result = "done", when, one_line(text, 230)
                agent.tokens = int(facts.get("totalTokens") or 0)
    elif event == "SubagentStart":  # now we know its id, so its own steps can be told apart from the window's
        agent_id = str(body.get("agent_id") or "")[:80]
        known = (await db.execute(select(ClaudeAgent).where(ClaudeAgent.session_id == row.id, ClaudeAgent.agent_id == agent_id))).scalars().first()
        agent = known or (await db.execute(select(ClaudeAgent).where(ClaudeAgent.session_id == row.id, ClaudeAgent.status == "working", ClaudeAgent.agent_id == "",
                                                                      ClaudeAgent.kind == str(body.get("agent_type") or "")).order_by(ClaudeAgent.id))).scalars().first()
        if agent:
            agent.agent_id = agent_id
    elif event == "SubagentStop":
        found = select(ClaudeAgent).where(ClaudeAgent.session_id == row.id, ClaudeAgent.status == "working")
        agent_id = str(body.get("agent_id") or "")
        agent = (await db.execute(found.where(ClaudeAgent.agent_id == agent_id))).scalars().first() if agent_id else None
        agent = agent or (await db.execute(found.where(ClaudeAgent.kind == str(body.get("agent_type") or "")).order_by(ClaudeAgent.id))).scalars().first()
        if agent:
            agent.status, agent.finished_at, agent.action = "done", when, ""
            agent.result = one_line(body.get("last_assistant_message") or agent.result, 230)
            used = await _used(body.get("agent_transcript_path"))
            if used:
                agent.tokens = used["tokens"] or agent.tokens
                agent.model = one_line(used["model"] or agent.model, 30)
    elif event == "PermissionRequest":
        _status(row, "waiting", when)
        row.action = "precisa da tua autorização"
    elif event == "Notification":
        _status(row, "waiting", when)
        kind = str(body.get("notification_type") or "")
        row.action = "precisa da tua autorização" if kind == "permission_prompt" or "permission" in str(body.get("message") or "") else "à espera de ti"
    elif event == "Stop":
        _status(row, "waiting", when)
        row.action = "acabou: à tua espera"
    elif event == "PreCompact":
        row.action = "a resumir a conversa"
    elif event == "SessionEnd":
        _status(row, "ended", when)
        row.ended_at, row.action = when, "fechado"
    if event in ("Stop", "SessionEnd"):
        used = await _used(body.get("transcript_path"))
        if used:
            row.tokens = used["tokens"]
            if used["model"]:
                body["model"] = used["model"]
    if body.get("model"):
        model = body["model"]
        row.model = one_line(model.get("display_name") or model.get("id") if isinstance(model, dict) else model, 60)
    await db.commit()
    if event == "PreToolUse":
        _last_write[key] = clock  # only steps throttle steps: the first one after a request always shows
    await rt.publish("office", user.id, "team")
    await _prune(db)
    return {"ok": True, "written": True}


async def _prune(db: AsyncSession):
    """At most once an hour: windows not seen for a week go, with their subagents (the deletes travel by sync too)."""
    global _last_prune
    if time.time() - _last_prune < 3600:
        return
    _last_prune = time.time()
    old = (await db.execute(select(ClaudeSession).where(ClaudeSession.updated_at < datetime.now(timezone.utc) - KEEP))).scalars().all()
    if not old:
        return
    for agent in (await db.execute(select(ClaudeAgent).where(ClaudeAgent.session_id.in_([s.id for s in old])))).scalars():
        await db.delete(agent)
    for session in old:
        await db.delete(session)
    await db.commit()


def _age(dt: datetime | None) -> float:
    if dt is None:
        return 1e12
    return (datetime.now(timezone.utc) - (dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc))).total_seconds()


def _state(row: ClaudeSession) -> str:
    quiet = _age(row.updated_at)
    if row.status == "ended" or quiet > GONE:
        return "ended"
    if row.status == "working" and quiet > STALLED:
        return "stalled"
    return row.status


def _skills(text: str | None) -> list[str]:
    return [s for s in (text or "").split(",") if s]  # None: a row from a PC still on schema 13


def _agent_out(a: ClaudeAgent) -> dict:
    state = a.status if a.status != "working" or _age(a.started_at) < GONE else "lost"
    return {"id": a.id, "kind": a.kind, "model": a.model, "description": a.description, "action": a.action if state == "working" else "",
            "state": state, "result": a.result, "tokens": a.tokens, "skills": _skills(a.skills), "started_at": iso(a.started_at),
            "finished_at": iso(a.finished_at)}


_folders: tuple[float, dict] = (0.0, {})


def _about(skill_md: Path) -> str:
    """The description in a SKILL.md's frontmatter: what the skill is for, in its author's words."""
    try:
        head = skill_md.read_text(encoding="utf-8", errors="replace")[:3000]
    except OSError:
        return ""
    found = re.search(r"^description:\s*(.+)$", head, re.M) if head.startswith("---") else None
    return one_line(found.group(1).strip().strip("\"'"), 220) if found else ""


def skill_folders() -> dict[str, dict]:
    """The skills that exist on this PC, by name: this person's own (~/.claude/skills) and those of each team repository
    checked out here (<repo>/.claude/skills). Read at most every five minutes."""
    global _folders
    if time.time() - _folders[0] < 300:
        return _folders[1]
    places = [("pessoal", Path.home() / ".claude" / "skills")]
    for repo in commits.repos():
        root = commits._local_path(repo)
        if root:
            places.append((repo["name"], Path(root) / ".claude" / "skills"))
    out: dict[str, dict] = {}
    for where, folder in places:
        try:
            found = sorted(p for p in folder.glob("*/SKILL.md"))
        except OSError:
            continue
        for md in found:
            name = _skill_name(md.parent.name)
            if name and name not in out:
                out[name] = {"about": _about(md), "where": where}
    _folders = (time.time(), out)
    return out


async def arsenal(db: AsyncSession) -> list[dict]:
    """Every skill the team's Claudes used this week (kept with each window and subagent) and every skill found in the
    folders: how often, by whom, when last, and what it is for."""
    users = {u.id: u.display_name for u in (await db.execute(select(User))).scalars()}
    used: dict[str, dict] = {}
    rows = (await db.execute(select(ClaudeSession.user_id, ClaudeSession.skills, ClaudeSession.updated_at).where(ClaudeSession.skills != ""))).all()
    rows += (await db.execute(select(ClaudeAgent.user_id, ClaudeAgent.skills, ClaudeAgent.started_at).where(ClaudeAgent.skills != ""))).all()
    for user_id, skills, when in rows:
        for name in _skills(skills):
            s = used.setdefault(name, {"uses": 0, "last": None, "by": set()})
            s["uses"] += 1
            s["by"].add(users.get(user_id, ""))
            if when and (s["last"] is None or when > s["last"]):
                s["last"] = when
    folders = await asyncio.to_thread(skill_folders)
    out = []
    for name in set(used) | set(folders):
        u, f = used.get(name, {}), folders.get(name, {})
        out.append({"name": name, "uses": u.get("uses", 0), "last": iso(u.get("last")), "by": sorted(b for b in u.get("by", ()) if b),
                    "about": f.get("about", ""), "where": f.get("where", "")})
    out.sort(key=lambda s: (-s["uses"], s["name"]))
    return out[:24]


@router.get("/office")
async def office(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    """Everybody's Claude windows of the last day with their subagents, and the day's film (most recent first)."""
    cut = datetime.now(timezone.utc) - timedelta(seconds=SHOWN)
    rows = (await db.execute(select(ClaudeSession).where(ClaudeSession.updated_at >= cut).order_by(ClaudeSession.updated_at.desc()))).scalars().all()
    agents = (await db.execute(select(ClaudeAgent).where(ClaudeAgent.session_id.in_([r.id for r in rows])).order_by(ClaudeAgent.id.desc()))).scalars().all() if rows else []
    by_session: dict[int, list] = {}
    for a in agents:
        by_session.setdefault(a.session_id, []).append(a)
    sessions = [{"id": r.id, "key": r.key, "user": r.user.username, "name": r.user.display_name, "project": r.project, "state": _state(r),
                 "prompt": _request(r.prompt), "action": r.action, "model": r.model, "tokens": r.tokens, "since": iso(r.since), "started_at": iso(r.started_at),
                 "updated_at": iso(r.updated_at), "skills": _skills(r.skills), "agents": [_agent_out(a) for a in by_session.get(r.id, [])[:12]]}
                for r in rows]
    names = {r.id: (r.user.display_name, r.project) for r in rows}
    film = []
    for a in agents[:60]:
        who, project = names[a.session_id]
        if a.finished_at:
            film.append({"at": iso(a.finished_at), "who": who, "project": project, "kind": "agent_done", "agent": a.kind, "text": a.result or a.description})
        film.append({"at": iso(a.started_at), "who": who, "project": project, "kind": "agent_start", "agent": a.kind, "text": a.description})
    for r in rows:
        film.append({"at": iso(r.started_at), "who": r.user.display_name, "project": r.project, "kind": "window_open", "agent": "", "text": r.prompt})
    film.sort(key=lambda f: f["at"] or "", reverse=True)
    return {"sessions": sessions, "film": film[:40], "arsenal": await arsenal(db)}


@router.get("/health")
async def health_view(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    """Saúde: what the Agente AMG costs on each person's PC, as that PC last measured it (health.py)."""
    rows = {r.user_id: r for r in (await db.execute(select(PcHealth))).scalars()}
    people = (await db.execute(select(User).order_by(User.id))).scalars().all()
    keys = ("cores", "hub_cpu", "hub_ram", "widget_cpu", "widget_ram", "web_cpu", "web_ram")
    return {"limits": health.LIMITS, "every": health.EVERY,
            "pcs": [{"user": p.username, "name": p.display_name, "updated_at": iso(rows[p.id].updated_at) if p.id in rows else None,
                     **{k: getattr(rows[p.id], k) if p.id in rows else None for k in keys}} for p in people]}
