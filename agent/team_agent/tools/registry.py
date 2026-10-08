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

        try:
            result = await tool.run(args, self.ctx)
        except Exception as exc:  # a tool failure is a result for the AI, not an agent crash
            result = ToolResult(f"{type(exc).__name__}: {exc}", True)
        log.info("%s %s", "FAILED" if result.is_error else "Tool", summary)
        return result


def build_registry(ctx: ToolContext) -> ToolRegistry:
    classes = [*FILE_TOOLS, Git, RunCommand, *TASK_TOOLS, RequestApproval, Notify, Recall]
    return ToolRegistry([cls() for cls in classes], ctx)
