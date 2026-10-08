import difflib
import re
from pathlib import Path

from ..core.logs import log
from ..permissions import Level
from ..permissions.policy import SECRET_FILE
from .approval_tool import RequestApproval
from .base import Tool, ToolContext, ToolResult
from .file_tool import FILE_TOOLS
from .git_tool import Git
from .notification_tool import Notify
from .recall_tool import Recall
from .task_tool import TASK_TOOLS
from .terminal_tool import RunCommand


HIGH_RISK = re.compile(r"prod|deploy|publish|release|push|secret|credential|delete|migrat", re.I)


def approval_meta(name: str, args: dict, reason: str, ctx: ToolContext) -> dict:
    """What the person deciding should see next to the request: the kind of action, how risky, which files, the change."""
    kind = {"git": "git", "run_command": "command"}.get(name, "file" if name.endswith("_file") else "external")
    risky = name == "delete_file" or HIGH_RISK.search(f"{reason} {args.get('command', '')} {args.get('args', '')} {args.get('path', '')}")
    meta = {"risk": "high" if risky else "medium", "kind": kind, "files": [str(args["path"])] if args.get("path") else []}
    if name == "write_file" and not SECRET_FILE.match(Path(str(args["path"])).name):  # a secret is never sent anywhere
        try:
            path = ctx.policy.resolve(args["path"])
            before = path.read_text(encoding="utf-8").splitlines() if path.is_file() else []
            lines = difflib.unified_diff(before, str(args.get("content", "")).splitlines(), "antes", "depois", lineterm="")
            meta["diff"] = "\n".join(lines)[:20000]
        except (OSError, UnicodeDecodeError):
            pass  # no diff to show; the request still goes out
    return meta


class ToolRegistry:
    """The only path from the AI to the computer: check permission, then run."""

    def __init__(self, tools: list[Tool], ctx: ToolContext):
        self.tools = {t.name: t for t in tools}
        self.ctx = ctx
        self.changes: dict[str, list] = {}   # path -> [text before the task touched it (None: did not exist), text now]

    def _snapshot(self, name: str, args: dict) -> tuple[str, str | None] | None:
        """Before a file tool runs: which file, and what it had (None when it did not exist). Secrets are never read."""
        if name not in ("write_file", "delete_file") or SECRET_FILE.match(Path(str(args.get("path", ""))).name):
            return None
        try:
            path = self.ctx.policy.resolve(args["path"])
            return str(args["path"]), path.read_text(encoding="utf-8") if path.is_file() else None
        except (OSError, UnicodeDecodeError, KeyError):
            return None

    def change_report(self) -> list[dict]:
        """What the task changed, file by file: added / deleted lines and the diff, for the Hub's "O que mudou"."""
        out = []
        for path, (before, after) in self.changes.items():
            if before == after:
                continue
            lines = list(difflib.unified_diff((before or "").splitlines(), (after or "").splitlines(), "antes", "depois", lineterm="", n=2))
            body = [l for l in lines[2:] if not l.startswith("@@")]
            out.append({"path": path, "status": "new" if before is None else "deleted" if after is None else "changed",
                        "added": sum(1 for l in body if l.startswith("+")), "deleted": sum(1 for l in body if l.startswith("-")),
                        "diff": "\n".join(lines)[:12000]})
        return out

    async def execute(self, name: str, args: dict) -> ToolResult:
        tool = self.tools.get(name)
        if not tool:
            return ToolResult(f"Unknown tool: {name}", True)
        try:
            decision = tool.check(args, self.ctx)
            summary = tool.summary(args)
        except (KeyError, TypeError) as exc:
            return ToolResult(f"Invalid arguments for {name}: {exc}", True)

        if decision.level is Level.BLOCKED:
            log.info("BLOCKED %s (%s)", summary, decision.reason)
            await self.ctx.bridge.record("error", f"Blocked by policy: {summary} - {decision.reason}")
            return ToolResult(f"BLOCKED by policy: {decision.reason}. Do not retry; choose another approach.", True)

        if decision.level is Level.REQUIRES_APPROVAL:
            if not await self.ctx.bridge.request_approval(summary, decision.reason, approval_meta(name, args, decision.reason, self.ctx)):
                return ToolResult("REJECTED by the owner. Do not retry this action.", True)

        snap = self._snapshot(name, args)
        try:
            result = await tool.run(args, self.ctx)
        except Exception as exc:  # a tool failure is a result for the AI, not an agent crash
            result = ToolResult(f"{type(exc).__name__}: {exc}", True)
        if snap and not result.is_error:
            path, before = snap
            entry = self.changes.setdefault(path, [before, before])
            entry[1] = None if name == "delete_file" else str(args.get("content", ""))
        log.info("%s %s", "FAILED" if result.is_error else "Tool", summary)
        return result


def build_registry(ctx: ToolContext) -> ToolRegistry:
    classes = [*FILE_TOOLS, Git, RunCommand, *TASK_TOOLS, RequestApproval, Notify, Recall]
    return ToolRegistry([cls() for cls in classes], ctx)
