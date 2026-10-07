"""Agent core: owns the state, the task lifecycle and the bridge that tools use."""
import asyncio
import json
import re
import time
from pathlib import Path
from typing import Callable

from ..permissions import PermissionPolicy
from ..providers import AIProvider, RunResult
from ..storage import LocalStore
from ..tasks import TaskProvider
from ..tools import ToolContext, build_registry
from .config import Config
from .logs import log
from .session import SessionReport
from .state import AgentState

SYSTEM_PROMPT = """You are {name}'s Team Agent: an autonomous AI worker running on {name}'s computer as part of a small team. You receive one assigned task and carry it out end to end.

How you work:
- You can act only through the provided tools. Files, git and commands are confined to the task workspace; paths are relative to it.
- Call update_progress after every meaningful step, with an honest percentage. Write current_action, last_action and next_action in European Portuguese, at most 8 words each: a plain statement of what was done, without details or reasons. Your teammates read these as the short report of your work.
- Every tool call is checked by a permission policy. Safe actions run immediately. Sensitive ones pause until the owner approves. A BLOCKED or REJECTED result is final: do not retry it or look for a workaround.
- Before any action with outside effect that the tools do not gate themselves (publishing ads or content, production changes, spending money), call request_approval first and proceed only if approved. If you cannot perform such an action with your tools, prepare everything as a draft in the workspace and say so in the result.
- Use record_decision for choices a future session would need to understand.
- If you are blocked or the task is ambiguous, call request_help and stop.
- When every requirement is met, call complete_task once with a summary of the result and where the deliverables are, then stop."""


# Added to the system prompt when the task was given to a member of the crew (the Hub's crew.py).
CREW_PROMPT = """

Who you are in this team: {persona}
You are one of the crew of eight: {team}. Each of you works in their own Claude conversation. This one is yours: the tasks you did before are earlier in it, if any. What any of you finishes goes into the Hub's memory, and you get that memory, the projects and the open work at the start of every task, so take it as what the team knows now.
Stay yourself in how you think and decide, but the work comes first: no role-play in files, code, progress reports or results."""


# How to work when a task was handed over as a particular kind of agent (the Hub's "Assign to AI").
ROLE_PROMPTS = {
    "developer": "You were given this task as a developer: write and change code, run the tests, keep changes small.",
    "research": "You were given this task as a researcher: gather the facts and write up what you found. Do not change code unless the task asks for it.",
    "marketing": "You were given this task as a marketer: write the copy and prepare campaigns as drafts. Anything published or paid needs approval first.",
    "testing": "You were given this task as a tester: run the checks, report the exact failures, and fix only what the task asks you to fix.",
}

ASK_SYSTEM = """You are the Team AI of a small team's Hub. You answer questions about the team's work.

Rules:
- Use ONLY the JSON data in the message: it is the live state of the Hub. You have no tools and no other source.
- If the data does not hold the answer, say the Hub has no data on it. Never guess, never invent a number, a name or an event.
- Costs in the data are estimates made by the Claude SDK, not bills: call them "estimado".
- Answer in European Portuguese, short and direct, in plain text with short lines. No tables, no headings unless asked."""

REPORT_ASK = """Write this week's report for the team, from the data only. Four short parts, in this order:
Concluído (what was finished), Bloqueado (what is stuck and why, if the data says), A seguir (open work, most urgent first),
Uso de IA (tokens and estimated cost). Leave a part out, saying there is no data, rather than filling it with guesses."""


class TeamAgent:
    def __init__(self, cfg: Config, backend, tasks: TaskProvider, ai: AIProvider, store: LocalStore,
                 ask_ai: Callable[[], AIProvider] | None = None):
        self.cfg, self.backend, self.tasks, self.ai, self.store = cfg, backend, tasks, ai, store
        self.ask_ai = ask_ai                # makes a provider for a question from the Hub, apart from the task's own
        self._session: SessionReport | None = None  # the Hub's record of the run in progress
        self._memory: list[dict] = []       # what the Hub says the AI should know for the current task
        self._brief: dict = {}              # the Hub's briefing for it (crew.py): projects, open work, the crew member
        self._crew = ""                     # the crew member it runs as, if any
        self._asks: set[asyncio.Task] = set()
        self.state = AgentState(dashboard_url=cfg.server_url, history=store.history()[-8:])
        self.on_change: Callable[[], None] = lambda: None
        self._wake = asyncio.Event()
        self._task: dict | None = None      # task this agent currently holds (running, paused or stuck)
        self._context: dict = {}            # saved context returned by recovery
        self._run: asyncio.Task | None = None
        self._intent: str | None = None     # 'pause' | 'stop' requested while running
        self._result: str | None = None     # set by complete_task
        self._run_cost: float | None = None  # what the last run cost (the SDK's estimate), None if it did not say

    # ---------------------------------------------------------------- lifecycle

    def wake(self):
        self._wake.set()

    async def run(self):
        log.info("Agent started")
        await self._connect()
        await self._recover()
        while True:
            self._wake.clear()
            await self._heartbeat()
            if self._task is None and self.state.connected:
                await self._poll()
            try:
                await asyncio.wait_for(self._wake.wait(), self.cfg.heartbeat_interval)
            except asyncio.TimeoutError:
                pass

    async def _connect(self):
        while True:
            try:
                me = await self.backend.whoami()
                self.state.user, self.state.display_name = me["username"], me["display_name"]
                self.state.connected = True
                log.info("Connected to server as %s", me["username"])
                return
            except Exception as exc:
                log.info("Cannot reach server (%s); retrying", type(exc).__name__)
                self.on_change()
                await asyncio.sleep(self.cfg.heartbeat_interval)

    async def _recover(self):
        """Ask the backend 'what was my last task?' and restore context before doing anything."""
        try:
            saved = await self.tasks.unfinished()
        except Exception as exc:
            log.info("Recovery check failed: %s", exc)
            saved = {}
        task = saved.get("task")
        if not task:
            self.state.status = "IDLE"
            return
        log.info("Recovered TASK-%s: status %s, progress %s%%, last action: %s",
                 task["id"], task["status"], task["progress"], task["last_action"] or "-")
        self._context, self._task = saved, task
        self._show(task)
        if self.cfg.recovery_mode == "resume" and task["status"] in ("IN_PROGRESS", "WAITING_APPROVAL"):
            self._start(task, resume=True)
            return
        self.state.current_action = "Recovered - press Resume to continue"
        await self._set_status("PAUSED", None if task["status"] in ("PAUSED", "NEEDS_HELP") else "PAUSED")

    async def _heartbeat(self):
        try:
            reply = await self.backend.heartbeat(self.state.heartbeat())
        except Exception as exc:
            if self.state.connected:
                log.info("Server unreachable (%s)", type(exc).__name__)
            self.state.connected = False
            self.on_change()
            return
        if not self.state.connected:
            log.info("Reconnected to server")
        self.state.connected, self.state.team = True, reply["team"]
        for command in reply["commands"]:
            await self.handle_command(command)
        self.on_change()

    async def _poll(self):
        try:
            task = await self.tasks.next_task()
        except Exception as exc:
            log.info("Task poll failed: %s", exc)
            return
        if task:
            log.info("Received TASK-%s: %s", task["id"], task["title"])
            self._remember(f"Recebi a tarefa: {task['title']}")
            await self.notify(f"New task: {task['title']}")
            self._start(task, resume=False)

    # ---------------------------------------------------------------- task execution

    def _show(self, task: dict):
        s = self.state
        s.task_id, s.task, s.progress = task["id"], task["title"], task.get("progress", 0)
        s.last_action, s.next_action, s.error = task.get("last_action", ""), task.get("next_action", ""), ""
        s.started_at = s.started_at or time.time()
        saved = self.store.usage(task["id"])
        if saved["input_tokens"] or saved["cost_usd"]:
            s.usage = self._usage_view(saved)

    def _start(self, task: dict, resume: bool):
        self._task = task
        self._show(task)
        self._run = asyncio.create_task(self._execute(task, resume))

    def _workspace(self, task: dict) -> Path:
        name = re.sub(r"[^A-Za-z0-9_.-]", "_", task.get("project") or "").strip(".") or f"task-{task['id']}"
        path = self.cfg.workspace / name
        path.mkdir(parents=True, exist_ok=True)
        return path

    def _prompt(self, task: dict, resume: bool) -> str:
        lines = [f"Task #{task['id']}: {task['title']}"]
        if task.get("description"):
            lines += ["", "Description:", task["description"]]
        if task.get("goal"):
            lines += ["", "Goal:", task["goal"]]
        if task.get("requirements"):
            lines += ["", "Requirements:", *[f"- {r}" for r in task["requirements"]]]
        role = task.get("agent_role") or ""
        if role == "custom" and task.get("agent_instructions"):
            lines += ["", "How to work on this task:", task["agent_instructions"]]
        elif role in ROLE_PROMPTS:
            lines += ["", ROLE_PROMPTS[role]]
        if self._memory:
            lines += ["", "What the team already knows (the Hub's memory). Take it as given:",
                      *[f"- [{m['scope']}{'/' + m['category'] if m.get('category') else ''}] {m['title']}: {m['content']}"
                        for m in self._memory]]
        lines += self._briefing_lines()
        if resume:
            lines += ["", "This task was interrupted and is being RESUMED. Do not start over.",
                      f"Saved state: {task.get('progress', 0)}% done; last action: {task.get('last_action') or 'none'}; "
                      f"planned next: {task.get('next_action') or 'unknown'}."]
            context = self._context if (self._context.get("task") or {}).get("id") == task["id"] else {}
            if context.get("events"):
                lines += ["Previous actions, decisions and errors:",
                          *[f"- [{e['kind']}] {e['message']}" for e in context["events"][-40:]]]
            if context.get("pending_approvals"):
                lines += ["Approval requests that were pending when you were interrupted (request again if still needed):",
                          *[f"- {a['action']}" for a in context["pending_approvals"]]]
            lines += ["First verify the real state of the workspace (list_files, git status), then continue from where you stopped."]
        return "\n".join(lines)

    def _briefing_lines(self) -> list[str]:
        """The rest of the Hub's briefing (crew.py): the projects, the open work, what the team finished, what you did."""
        b, lines = self._brief, []
        if b.get("companies") or b.get("projects"):
            lines += ["", "The team's companies and projects:",
                      *[f"- company: {c['name']}" for c in b.get("companies", [])],
                      *[f"- project {p['name']} ({p['status']}{', ' + p['company'] if p.get('company') else ''})"
                        f"{': ' + p['description'] if p.get('description') else ''}" for p in b.get("projects", [])]]
        if b.get("open"):
            lines += ["", "Open work right now (what comes next):",
                      *[f"- {t['title']} [{t['status']}, for {t['for']}{', ' + t['crew'] if t.get('crew') else ''}]" for t in b["open"]]]
        if b.get("finished"):
            lines += ["", "Finished lately by the team:", *[f"- {t['title']} ({t['by']}): {t['result']}" for t in b["finished"]]]
        if b.get("mine"):
            lines += ["", "Your own last tasks:", *[f"- {t['title']}: {t['result']}" for t in b["mine"]]]
        return lines

    def _crew_home(self, crew: str) -> Path:
        path = self.cfg.data_dir / "crew" / re.sub(r"[^A-Za-z0-9_-]", "_", crew)
        path.mkdir(parents=True, exist_ok=True)
        return path

    async def _execute(self, task: dict, resume: bool):
        self._intent, self._result = None, None
        workspace = self._workspace(task)
        registry = build_registry(ToolContext(workspace, PermissionPolicy(workspace, self.cfg.policy_file), self))
        system = SYSTEM_PROMPT.format(name=self.state.display_name or self.state.user)
        # A Hub that knows the crew sends a whole briefing; an older one only the memory.
        self._brief = await self._report("task_briefing", task["id"]) or {}
        self._memory = self._brief.get("memory", []) if self._brief else await self._report("task_memory", task["id"]) or []
        member = self._brief.get("crew") or {}
        crew = member.get("id") or ""
        if crew:
            team = ", ".join(f"{m['name']} ({m['what']})" for m in self._brief.get("team", []))
            system += CREW_PROMPT.format(persona=member["persona"], team=team or "the rest of the crew")
        self._crew = crew
        self._session = SessionReport(self._report, "task", self.cfg.model, task["id"])
        await self._session.open()
        self.ai.on_event = self._session.on_event
        result, self._run_cost = None, None
        try:
            if reason := self.ai.unavailable_reason():
                raise RuntimeError(f"AI provider is not ready: {reason}")
            await self._set_status("WORKING", "IN_PROGRESS")
            session = task.get("session_id") if resume else self.store.crew_session(crew) if crew else None
            extra = {"home": self._crew_home(crew)} if crew else {}
            if crew and session and not resume:
                # the crew member's conversation already cost something before this task: count only what this one adds
                saved = self.store.usage(task["id"])
                if not saved["session_id"]:
                    saved["session_id"], saved["session_cost"] = session, self.store.crew(crew)["cost"]
                    self.store.save_usage(task["id"], saved)
            log.info("%s Claude session for TASK-%s%s", "Resuming" if session else "Started", task["id"],
                     f" as {member.get('name')}" if crew else "")
            try:
                result = await self.ai.run(self._prompt(task, resume), system, registry, workspace, session, self._on_session, **extra)
            except Exception as exc:
                if not session or self._intent:
                    raise
                # The saved session is gone (e.g. another machine); the task context in the prompt is enough.
                log.info("Could not resume the saved session (%s); continuing from task context", type(exc).__name__)
                result = await self.ai.run(self._prompt(task, resume), system, registry, workspace, None, self._on_session, **extra)
            await self._report_usage(task["id"], result)
            if crew and result.session_id:
                self.store.save_crew(crew, result.session_id, result.session_cost_usd, new_task=not resume)
        except Exception as exc:
            result = RunResult(ok=False, error=f"{type(exc).__name__}: {exc}")
        await self._session.close("INTERRUPTED" if self._intent else "DONE" if result.ok else "ERROR", result, self._run_cost)
        await self._finish(task, result)
        self._run = None
        self.wake()

    async def _on_session(self, session_id: str):
        if self._crew and self.store.crew(self._crew)["session_id"] != session_id:
            self.store.save_crew(self._crew, session_id, None, new_task=False)  # kept at once: a crash must not lose it
        if self._session:
            await self._session.set_claude_session(session_id)
        if self._task and self._task.get("session_id") != session_id:
            self._task["session_id"] = session_id
            await self._safe(self.backend.update_task(self._task["id"], session_id=session_id), "save session")

    async def _finish(self, task: dict, result: RunResult):
        s, tid = self.state, task["id"]
        if self._intent == "stop":
            log.info("TASK-%s stopped", tid)
            self._remember(f"Tarefa parada: {task['title']}")
            await self._release("STOPPED")
        elif self._intent == "pause":
            log.info("TASK-%s paused", tid)
            s.current_action = "Paused"
            await self._set_status("PAUSED", "PAUSED")
        elif self._result is not None:
            log.info("TASK-%s completed", tid)
            self._remember(f"Concluído: {task['title']}")
            await self.notify(f"Task completed: {task['title']}")
            await self._release("COMPLETED", result=self._result)
        elif not result.ok:
            log.info("TASK-%s error: %s", tid, result.error)
            self._remember(f"Erro: {result.error.split(':')[0][:50]}")
            s.error = result.error
            await self.record("error", result.error)
            await self._set_status("ERROR", "NEEDS_HELP")
        else:
            s.current_action = "Needs human input"
            await self.record("note", f"Agent stopped without completing the task: {result.text[:500]}")
            await self._set_status("WAITING", "NEEDS_HELP")

    async def _release(self, task_status: str, **fields):
        await self._safe(self.backend.update_task(self._task["id"], status=task_status, **fields), task_status)
        self._task, self._context = None, {}
        self.state.clear_task()
        self.state.status = "IDLE"
        self.on_change()

    async def _set_status(self, agent_status: str, task_status: str | None = None):
        self.state.status = agent_status
        if task_status and self._task:
            await self._safe(self.backend.update_task(self._task["id"], status=task_status), task_status)
        self.on_change()
        self.wake()

    def _usage_view(self, saved: dict) -> dict:
        budget = self.cfg.max_budget_usd
        return {"input_tokens": saved["input_tokens"], "output_tokens": saved["output_tokens"],
                "cost_usd": round(saved["cost_usd"], 4), "budget_usd": budget,
                "budget_pct": min(100, round(saved["cost_usd"] / budget * 100)) if budget else None}

    async def _report(self, method: str, *args, **kwargs):
        """The newer reports to the Hub (sessions, subagents, memory, questions). A backend without them is not told."""
        call = getattr(self.backend, method, None)
        return await self._safe(call(*args, **kwargs), method) if call else None

    async def _report_usage(self, task_id: int, result: RunResult):
        self._run_cost = None
        if not result.usage and result.session_cost_usd is None:
            return
        saved = self.store.usage(task_id)
        cost = result.session_cost_usd
        # The SDK reports a running total per session, including spend restored on resume.
        if cost is None:
            delta = 0.0
        elif result.session_id == saved["session_id"]:
            delta = max(0.0, cost - saved["session_cost"])
        else:
            delta = cost
        saved["input_tokens"] += result.usage.get("input_tokens", 0)
        saved["output_tokens"] += result.usage.get("output_tokens", 0)
        saved["cost_usd"] += delta
        saved["session_cost"], saved["session_id"] = cost or 0.0, result.session_id
        self.store.save_usage(task_id, saved)
        self.state.usage = self._usage_view(saved)
        self._run_cost = delta if cost is not None else None
        # which run and which model, when the Hub keeps sessions
        run = {"session_id": self._session.id, "model": self._session.model} if self._session and self._session.id else {}
        await self._safe(self.backend.report_usage(task_id=task_id, cost_usd=delta, **result.usage, **run), "usage")

    def _remember(self, text: str):
        """Local, persistent record of what this agent did (survives restarts)."""
        text = " ".join(text.split())
        if len(text) > 70:
            text = text[:69].rstrip() + "…"
        self.store.add_history({"time": time.time(), "text": text})
        self.state.history = self.store.history()[-8:]

    async def hub_session(self) -> str | None:
        reply = await self._safe(self.backend.session(), "hub session")
        return reply["token"] if reply else None

    async def _safe(self, call, what: str):
        try:
            return await call
        except Exception as exc:
            log.info("Backend call failed (%s): %s", what, exc)
            return None

    # ---------------------------------------------------------------- commands (widget + dashboard)

    async def handle_command(self, command: dict):
        kind = command.get("type") or command.get("action")
        if command.get("task_id") not in (None, self.state.task_id):
            return
        running = self._run is not None
        if kind == "ask" and command.get("request_id") is not None:
            job = asyncio.create_task(self._answer(command["request_id"]))
            self._asks.add(job)
            job.add_done_callback(self._asks.discard)
            return
        if kind in ("pause", "stop", "resume", "help"):
            log.info("Command: %s", kind)
        if kind == "pause" and running:
            self._intent = "pause"
            await self.ai.interrupt()
        elif kind == "stop" and running:
            self._intent = "stop"
            await self.ai.interrupt()
        elif kind == "stop" and self._task:
            self._intent = "stop"
            await self._finish(self._task, RunResult(ok=True))
        elif kind == "resume" and self._task and not running:
            self._start(self._task, resume=True)
        elif kind == "help":
            await self.ask_help(command.get("message") or "The user asked for help from the widget")
        self.wake()

    async def _answer(self, request_id: int):
        """A question asked in the Hub (or the weekly report): run Claude on the Hub's own data and send the answer back."""
        request = await self._report("ai_take", request_id)
        if not request:
            return
        log.info("Hub question #%s (%s)", request_id, request["kind"])
        session = SessionReport(self._report, request["kind"], self.cfg.model)
        provider = self.ask_ai() if self.ask_ai else self.ai
        try:
            if provider is self.ai and self._run is not None:
                raise RuntimeError("the agent is busy with a task")
            if reason := provider.unavailable_reason():
                raise RuntimeError(f"AI provider is not ready: {reason}")
            await session.open()
            provider.on_event = session.on_event
            ask = REPORT_ASK if request["kind"] == "weekly_report" else f"Question: {request['question']}"
            prompt = f"{ask}\n\nHub data (JSON):\n{json.dumps(request['context'], ensure_ascii=False, default=str)}"
            result = await provider.ask(prompt, ASK_SYSTEM)
        except Exception as exc:
            result = RunResult(ok=False, error=f"{type(exc).__name__}: {exc}")
        await session.close("DONE" if result.ok else "ERROR", result, result.session_cost_usd)
        if result.usage or result.session_cost_usd:
            run = {"session_id": session.id, "model": session.model} if session.id else {}
            await self._safe(self.backend.report_usage(task_id=None, cost_usd=result.session_cost_usd or 0.0,
                                                       **result.usage, **run), "usage")
        await self._report("ai_result", request_id, answer=result.text if result.ok else "",
                           error="" if result.ok else (result.error or "no answer")[:500])

    # ---------------------------------------------------------------- AgentBridge (used by tools)

    async def report_progress(self, progress: int, current_action: str, last_action: str, next_action: str):
        s = self.state
        if last_action and last_action != s.last_action:
            self._remember(last_action)
        s.progress, s.current_action, s.last_action, s.next_action = progress, current_action, last_action, next_action
        log.info("%s%% %s", progress, last_action or current_action)
        await self._safe(self.backend.update_task(
            s.task_id, progress=progress, current_action=current_action,
            last_action=last_action, next_action=next_action), "progress")
        self.on_change()
        self.wake()

    async def record(self, kind: str, message: str):
        if self.state.task_id is not None:
            await self._safe(self.backend.add_event(self.state.task_id, kind, message), "event")

    async def request_approval(self, action: str, detail: str, meta: dict | None = None) -> bool:
        # meta: how risky it is, what kind of action, which files, the diff - for a Hub that shows them
        extra = meta if meta and getattr(self.backend, "approval_meta", False) else {}
        approval = await self._safe(self.backend.create_approval(self.state.task_id, action, detail, **extra), "approval")
        if not approval:
            return False  # cannot reach the owner -> not approved
        log.info("Waiting for approval: %s", action)
        self.state.pending_approval = action
        await self._set_status("WAITING", "WAITING_APPROVAL")
        status = "PENDING"
        while status == "PENDING" and not self._intent:
            await asyncio.sleep(self.cfg.approval_poll)
            current = await self._safe(self.backend.get_approval(approval["id"]), "approval status")
            status = current["status"] if current else status
        self.state.pending_approval = ""
        if self._intent:
            return False
        log.info("Approval %s: %s", status.lower(), action)
        self._remember(f"{'Aprovado' if status == 'APPROVED' else 'Recusado'}: {action}")
        await self.record("decision", f"Owner {status.lower()}: {action}")
        await self._set_status("WORKING", "IN_PROGRESS")
        return status == "APPROVED"

    async def complete(self, result: str):
        self._result = result
        self.state.progress, self.state.current_action = 100, "Completed"
        self.on_change()

    async def ask_help(self, message: str):
        log.info("Help requested: %s", message)
        await self._safe(self.backend.help(self.state.task_id, message), "help")
        await self.notify(f"Help requested: {message}")

    async def notify(self, message: str):
        self.state.notifications = (self.state.notifications + [{"time": time.time(), "message": message}])[-5:]
        self.on_change()
