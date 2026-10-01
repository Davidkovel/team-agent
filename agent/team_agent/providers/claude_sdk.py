"""Claude Agent SDK provider.

The SDK runs the Claude Code agent loop (planning, context management, session
persistence). Claude Code's built-in tools are switched off: the model can act
only through our ToolRegistry, exposed as an in-process MCP server, so every
action passes the PermissionPolicy.
"""
import os
import shutil
from pathlib import Path

from ..core.logs import log
from ..tools import ToolRegistry
from .base import AIProvider, RunResult

MCP_SERVER = "team"
BUILTIN_TOOLS = ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "WebFetch", "WebSearch", "NotebookEdit", "Task"]


def native_cli() -> str | None:
    """A native claude executable. The SDK refuses npm's claude.cmd shim on Windows,
    so look for the real binary next to it. None lets the SDK use its own lookup."""
    if override := os.environ.get("TEAM_AGENT_CLAUDE_PATH"):
        return override
    candidates = [Path.home() / ".local" / "bin" / "claude.exe"]
    if shim := shutil.which("claude"):
        if not shim.lower().endswith((".cmd", ".bat")):
            return None
        candidates.append(Path(shim).parent / "node_modules" / "@anthropic-ai" / "claude-code" / "bin" / "claude.exe")
    return next((str(c) for c in candidates if c.is_file()), None)


class ClaudeAgentProvider(AIProvider):
    def __init__(self, model: str, max_turns: int, max_budget_usd: float):
        self.model, self.max_turns, self.max_budget_usd = model, max_turns, max_budget_usd
        self._client = None

    def unavailable_reason(self) -> str | None:
        try:
            import claude_agent_sdk  # noqa: F401
        except ImportError:
            return "claude-agent-sdk is not installed (pip install claude-agent-sdk)"
        # Without ANTHROPIC_API_KEY the SDK falls back to this computer's own Claude Code login.
        return None

    def _mcp_server(self, registry: ToolRegistry):
        from claude_agent_sdk import create_sdk_mcp_server, tool

        def wrap(name: str):
            async def handler(args: dict) -> dict:
                result = await registry.execute(name, args)
                return {"content": [{"type": "text", "text": result.text}], "is_error": result.is_error}
            return handler

        sdk_tools = [tool(t.name, t.description, t.schema)(wrap(t.name)) for t in registry.tools.values()]
        return create_sdk_mcp_server(name=MCP_SERVER, tools=sdk_tools)

    async def run(self, prompt, system_prompt, registry, workspace: Path, resume_session, on_session) -> RunResult:
        from claude_agent_sdk import (AssistantMessage, ClaudeAgentOptions, ClaudeSDKClient, ResultMessage,
                                      SystemMessage, TextBlock)

        options = ClaudeAgentOptions(
            model=self.model,
            cli_path=native_cli(),
            system_prompt=system_prompt,
            cwd=workspace,
            mcp_servers={MCP_SERVER: self._mcp_server(registry)},
            tools=[],  # no Claude Code built-ins
            disallowed_tools=BUILTIN_TOOLS,
            allowed_tools=[f"mcp__{MCP_SERVER}__{name}" for name in registry.tools],
            permission_mode="dontAsk",  # anything not explicitly allowed is denied, never prompted
            setting_sources=[],  # ignore the user's own Claude Code settings, hooks and plugins
            max_turns=self.max_turns,
            max_budget_usd=self.max_budget_usd,
            resume=resume_session,
        )
        result = RunResult(ok=False, error="Claude session ended without a result")
        text: list[str] = []
        async with ClaudeSDKClient(options=options) as client:
            self._client = client
            try:
                await client.query(prompt)
                async for message in client.receive_response():
                    if isinstance(message, SystemMessage) and message.subtype == "init":
                        if session_id := message.data.get("session_id"):
                            await on_session(session_id)
                    elif isinstance(message, AssistantMessage):
                        text += [b.text for b in message.content if isinstance(b, TextBlock)]
                    elif isinstance(message, ResultMessage):
                        usage = message.usage or {}
                        result = RunResult(
                            ok=not message.is_error,
                            text=message.result or "\n".join(text),
                            error="; ".join(message.errors or []) or (message.subtype if message.is_error else ""),
                            session_id=message.session_id,
                            usage={
                                "input_tokens": usage.get("input_tokens", 0),
                                "output_tokens": usage.get("output_tokens", 0),
                                "cache_read_tokens": usage.get("cache_read_input_tokens", 0),
                                "cache_creation_tokens": usage.get("cache_creation_input_tokens", 0),
                            },
                            session_cost_usd=message.total_cost_usd,
                        )
            finally:
                self._client = None
        return result

    async def interrupt(self):
        if self._client:
            log.info("Interrupting Claude session")
            await self._client.interrupt()
