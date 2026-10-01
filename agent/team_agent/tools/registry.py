from ..core.logs import log
from ..permissions import Level
from .approval_tool import RequestApproval
from .base import Tool, ToolContext, ToolResult
from .file_tool import FILE_TOOLS
from .git_tool import Git
from .notification_tool import Notify
from .task_tool import TASK_TOOLS
from .terminal_tool import RunCommand


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
            if not await self.ctx.bridge.request_approval(summary, decision.reason):
                return ToolResult("REJECTED by the owner. Do not retry this action.", True)

        try:
            result = await tool.run(args, self.ctx)
        except Exception as exc:  # a tool failure is a result for the AI, not an agent crash
            result = ToolResult(f"{type(exc).__name__}: {exc}", True)
        log.info("%s %s", "FAILED" if result.is_error else "Tool", summary)
        return result


def build_registry(ctx: ToolContext) -> ToolRegistry:
    classes = [*FILE_TOOLS, Git, RunCommand, *TASK_TOOLS, RequestApproval, Notify]
    return ToolRegistry([cls() for cls in classes], ctx)
