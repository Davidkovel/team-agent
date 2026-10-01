"""Agent core: owns the state, the task lifecycle and the bridge that tools use."""
import asyncio
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
from .state import AgentState

SYSTEM_PROMPT = """You are {name}'s Team Agent: an autonomous AI worker running on {name}'s computer as part of a small team. You receive one assigned task and carry it out end to end.

How you work:
- You can act only through the provided tools. Files, git and commands are confined to the task workspace (the current directory).
- Call update_progress after every meaningful step, with an honest percentage and concrete last/next actions. Your teammates and the owner watch this live.
- Every tool call is checked by a permission policy. Safe actions run immediately. Sensitive ones pause until the owner approves. A BLOCKED or REJECTED result is final: do not retry it or look for a workaround.
- Before any action with outside effect that the tools do not gate themselves (publishing ads or content, production changes, spending money), call request_approval first and proceed only if approved. If you cannot perform such an action with your tools, prepare everything as a draft in the workspace and say so in the result.
- Use record_decision for choices a future session would need to understand.
- If you are blocked or the task is ambiguous, call request_help and stop.
- When every requirement is met, call complete_task once with a summary of the result and where the deliverables are, then stop."""


class TeamAgent:
    def __init__(self, cfg: Config, backend, tasks: TaskProvider, ai: AIProvider, store: LocalStore):
        self.cfg, self.backend, self.tasks, self.ai, self.store = cfg, backend, tasks, ai, store
        self.state = AgentState(dashboard_url=cfg.server_url)
        self.on_change: Callable[[], None] = lambda: None
        self._wake = asyncio.Event()
        self._task: dict | None = None      # task this agent currently holds (running, paused or stuck)
        self._context: dict = {}            # saved context returned by recovery
        self._run: asyncio.Task | None = None
        self._intent: str | None = None     # 'pause' | 'stop' requested while running
        self._result: str | None = None     # set by complete_task

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

    async def _execute(self, task: dict, resume: bool):
        self._intent, self._result = None, None
        workspace = self._workspace(task)
        registry = build_registry(ToolContext(workspace, PermissionPolicy(workspace, self.cfg.policy_file), self))
        system = SYSTEM_PROMPT.format(name=self.state.display_name or self.state.user)
        try:
            if reason := self.ai.unavailable_reason():
                raise RuntimeError(f"AI provider is not ready: {reason}")
            await self._set_status("WORKING", "IN_PROGRESS")
            session = task.get("session_id") if resume else None
            log.info("%s Claude session for TASK-%s", "Resuming" if session else "Started", task["id"])
            try:
                result = await self.ai.run(self._prompt(task, resume), system, registry, workspace, session, self._on_session)
            except Exception as exc:
                if not session or self._intent:
                    raise
                # The saved session is gone (e.g. another machine); the task context in the prompt is enough.
                log.info("Could not resume the saved session (%s); continuing from task context", type(exc).__name__)
                result = await self.ai.run(self._prompt(task, True), system, registry, workspace, None, self._on_session)
            await self._report_usage(task["id"], result)
        except Exception as exc:
            result = RunResult(ok=False, error=f"{type(exc).__name__}: {exc}")
        await self._finish(task, result)
        self._run = None
        self.wake()

    async def _on_session(self, session_id: str):
        if self._task and self._task.get("session_id") != session_id:
            self._task["session_id"] = session_id
            await self._safe(self.backend.update_task(self._task["id"], session_id=session_id), "save session")

    async def _finish(self, task: dict, result: RunResult):
        s, tid = self.state, task["id"]
        if self._intent == "stop":
            log.info("TASK-%s stopped", tid)
            await self._release("STOPPED")
        elif self._intent == "pause":
            log.info("TASK-%s paused", tid)
            s.current_action = "Paused"
            await self._set_status("PAUSED", "PAUSED")
        elif self._result is not None:
            log.info("TASK-%s completed", tid)
            await self.notify(f"Task completed: {task['title']}")
            await self._release("COMPLETED", result=self._result)
        elif not result.ok:
            log.info("TASK-%s error: %s", tid, result.error)
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

    async def _report_usage(self, task_id: int, result: RunResult):
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
        await self._safe(self.backend.report_usage(task_id=task_id, cost_usd=delta, **result.usage), "usage")

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

    # ---------------------------------------------------------------- AgentBridge (used by tools)

    async def report_progress(self, progress: int, current_action: str, last_action: str, next_action: str):
        s = self.state
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

    async def request_approval(self, action: str, detail: str) -> bool:
        approval = await self._safe(self.backend.create_approval(self.state.task_id, action, detail), "approval")
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
