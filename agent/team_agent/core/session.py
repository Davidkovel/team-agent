"""Tells the Hub about one AI run while it happens: the model, the tokens so far, the current action, the subagents.

Everything sent is what the AI runtime itself reported. A Hub that does not know these reports (an older one, or the
test double) is simply not told, and the run goes on the same.
"""
import time

from ..providers import RunResult

TOKEN_KEYS = ("input_tokens", "output_tokens", "cache_read_tokens", "cache_creation_tokens")
PUSH_EVERY = 2.0  # seconds between updates while the AI works; the last one is always sent


def describe(name: str, args: dict) -> str:
    """A short line for 'what is it doing now': the tool and the thing it is applied to."""
    if name == "update_progress" and args.get("current_action"):
        return str(args["current_action"])[:200]
    detail = args.get("path") or args.get("command") or args.get("action") or ""
    if not detail and isinstance(args.get("args"), list):
        detail = " ".join(str(a) for a in args["args"])
    return f"{name} {detail}".strip()[:200]


class SessionReport:
    def __init__(self, report, kind: str, model: str, task_id: int | None = None):
        self._report = report  # async (method name, *args, **kwargs) -> reply or None
        self.kind, self.model, self.task_id = kind, model, task_id
        self.id: int | None = None
        self.tokens = dict.fromkeys(TOKEN_KEYS, 0)
        self.tool_uses, self.current_action = 0, ""
        self._dirty, self._pushed = False, 0.0

    async def open(self):
        row = await self._report("start_session", task_id=self.task_id, kind=self.kind, model=self.model)
        self.id = row["id"] if row else None

    async def set_claude_session(self, claude_session_id: str):
        if self.id is not None:
            await self._report("update_session", self.id, claude_session_id=claude_session_id)

    async def on_event(self, event: dict):
        kind = event.get("type")
        if kind == "usage":
            for key in TOKEN_KEYS:
                self.tokens[key] += event.get(key, 0)
        elif kind == "model":
            if event["model"] == self.model:
                return
            self.model = event["model"]
        elif kind == "tool":
            self.tool_uses += 1
            if not event.get("subagent"):  # the line shown is the main agent's own action
                self.current_action = describe(event["name"], event.get("input") or {})
        elif kind == "subagent":
            if self.id is not None:
                fields = {k: v for k, v in event.items() if k != "type" and v is not None}
                await self._report("report_subagent", self.id, **fields)
            return
        else:
            return
        self._dirty = True
        await self.push()

    async def push(self, force: bool = False, **extra):
        if self.id is None or not (self._dirty or extra):
            return
        if not force and time.monotonic() - self._pushed < PUSH_EVERY:
            return
        self._dirty, self._pushed = False, time.monotonic()
        await self._report("update_session", self.id, model=self.model, current_action=self.current_action,
                           tool_uses=self.tool_uses, **self.tokens, **extra)

    async def close(self, status: str, result: RunResult | None = None, cost_usd: float | None = None):
        """status: DONE | ERROR | INTERRUPTED. The run's own totals replace the running count when it reported them."""
        if result and any(result.usage.get(k) for k in TOKEN_KEYS):
            self.tokens = {k: result.usage.get(k, 0) for k in TOKEN_KEYS}
        extra = {"status": status}
        if cost_usd is not None:
            extra["cost_usd"] = cost_usd
        await self.push(force=True, **extra)
