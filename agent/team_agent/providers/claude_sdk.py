"""Claude Agent SDK provider.

The SDK runs the Claude Code agent loop (planning, context management, session
persistence). Claude Code's built-in tools are switched off: the model can act
only through our ToolRegistry, exposed as an in-process MCP server, so every
action passes the PermissionPolicy.

The one built-in that may be switched on is the subagent tool ("Agent"; older
CLIs call it "Task"): with it the main session can hand part of the work to a
research, coding, testing or review subagent. A subagent gets the same MCP tools
and nothing else, so it is held by the same policy.
"""
import os
import shutil
from pathlib import Path

from ..core.logs import log
from ..tools import ToolRegistry
from .base import AIProvider, RunResult

MCP_SERVER = "team"
SUBAGENT_TOOLS = ("Agent", "Task")  # the same tool: "Task" was renamed "Agent" in Claude Code 2.1.63
BUILTIN_TOOLS = ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "WebFetch", "WebSearch", "NotebookEdit"]

# name -> (what it is for, how it works, the registry tools it may use; None = all of them)
SUBAGENTS = {
    "research": ("Reads the workspace and reports findings. Use it to explore or to gather facts before deciding.",
                 "You are a research subagent. Read what you need, change nothing, and answer with the facts you found "
                 "and where you found them.", ("read_file", "list_files", "git")),
    "coding": ("Writes or changes code for one well-defined piece of the task.",
               "You are a coding subagent. Make exactly the change you were asked for, keep it small, and report which "
               "files you changed.", ("read_file", "write_file", "list_files", "git", "run_command")),
    "testing": ("Runs the tests or linters and reports what failed.",
                "You are a testing subagent. Run the checks you were asked to run and report the exact failures. Do not "
                "fix anything.", ("read_file", "list_files", "run_command")),
    "review": ("Reviews a change for bugs before it is called done.",
               "You are a review subagent. Read the change and list concrete problems, most serious first. Change "
               "nothing.", ("read_file", "list_files", "git")),
}


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


def _usage(raw: dict | None) -> dict:
    raw = raw or {}
    return {"input_tokens": raw.get("input_tokens", 0) or 0, "output_tokens": raw.get("output_tokens", 0) or 0,
            "cache_read_tokens": raw.get("cache_read_input_tokens", 0) or 0,
            "cache_creation_tokens": raw.get("cache_creation_input_tokens", 0) or 0}


class ClaudeAgentProvider(AIProvider):
    def __init__(self, model: str, max_turns: int, max_budget_usd: float, subagents: bool = False):
        self.model, self.max_turns, self.max_budget_usd, self.subagents = model, max_turns, max_budget_usd, subagents
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

    def _agents(self, registry: ToolRegistry) -> dict:
        from claude_agent_sdk import AgentDefinition

        # background=False: the main session waits for the subagent's answer instead of finishing without it
        return {name: AgentDefinition(description=description, prompt=prompt, background=False,
                                      tools=[f"mcp__{MCP_SERVER}__{t}" for t in tools if t in registry.tools])
                for name, (description, prompt, tools) in SUBAGENTS.items()}

    async def run(self, prompt, system_prompt, registry, workspace: Path, resume_session, on_session, home: Path | None = None) -> RunResult:
        from claude_agent_sdk import (AssistantMessage, ClaudeAgentOptions, ClaudeSDKClient, ResultMessage,
                                      SystemMessage, TextBlock, ToolResultBlock, ToolUseBlock, UserMessage)

        allowed = [f"mcp__{MCP_SERVER}__{name}" for name in registry.tools]
        options = ClaudeAgentOptions(
            model=self.model,
            cli_path=native_cli(),
            system_prompt=system_prompt,
            # Claude Code keeps a conversation under the folder it ran in: a crew member always runs in their own, so
            # their conversation can be resumed whatever the task's workspace. Our tools work in the workspace anyway.
            cwd=home or workspace,
            mcp_servers={MCP_SERVER: self._mcp_server(registry)},
            strict_mcp_config=True,  # only our server: not the connectors of the signed-in Claude account
            tools=["Agent"] if self.subagents else [],  # no other Claude Code built-in
            disallowed_tools=BUILTIN_TOOLS + ([] if self.subagents else list(SUBAGENT_TOOLS)),
            allowed_tools=allowed + (list(SUBAGENT_TOOLS) if self.subagents else []),
            agents=self._agents(registry) if self.subagents else None,
            # a subagent sent to the background would outlive the turn: the run would end without its answer
            env={"CLAUDE_CODE_DISABLE_BACKGROUND_TASKS": "1"},
            permission_mode="dontAsk",  # anything not explicitly allowed is denied, never prompted
            setting_sources=[],  # ignore the user's own Claude Code settings, hooks and plugins
            max_turns=self.max_turns,
            max_budget_usd=self.max_budget_usd,
            resume=resume_session,
        )
        result = RunResult(ok=False, error="Claude session ended without a result")
        text: list[str] = []
        counted: set[str] = set()   # message ids whose usage was already reported (one reply can arrive in several parts)
        spawned: set[str] = set()   # tool-use ids of the subagents still running
        async with ClaudeSDKClient(options=options) as client:
            self._client = client
            try:
                await client.query(prompt)
                async for message in client.receive_response():
                    if isinstance(message, ResultMessage):
                        result = RunResult(
                            ok=not message.is_error,
                            text=message.result or "\n".join(text),
                            error="; ".join(message.errors or []) or (message.subtype if message.is_error else ""),
                            session_id=message.session_id,
                            usage=_usage(message.usage),
                            session_cost_usd=message.total_cost_usd,
                        )
                    elif isinstance(message, AssistantMessage):
                        if message.parent_tool_use_id is None:
                            text += [b.text for b in message.content if isinstance(b, TextBlock)]
                        if message.model:
                            await self.emit({"type": "model", "model": message.model})
                        if message.usage and (message.message_id or id(message)) not in counted:
                            counted.add(message.message_id or id(message))
                            await self.emit({"type": "usage", **_usage(message.usage)})
                        for block in message.content:
                            if not isinstance(block, ToolUseBlock):
                                continue
                            if block.name in SUBAGENT_TOOLS:
                                spawned.add(block.id)
                                await self.emit({"type": "subagent", "external_id": block.id, "status": "RUNNING",
                                                 "role": str(block.input.get("subagent_type") or ""),
                                                 "task": str(block.input.get("description") or ""),
                                                 "parent_external_id": message.parent_tool_use_id})
                            else:
                                await self.emit({"type": "tool", "name": block.name.removeprefix(f"mcp__{MCP_SERVER}__"),
                                                 "input": block.input, "subagent": message.parent_tool_use_id})
                    elif isinstance(message, UserMessage) and isinstance(message.content, list):
                        for block in message.content:
                            if isinstance(block, ToolResultBlock) and block.tool_use_id in spawned:
                                spawned.discard(block.tool_use_id)
                                await self.emit({"type": "subagent", "external_id": block.tool_use_id,
                                                 "status": "ERROR" if block.is_error else "DONE"})
                    elif isinstance(message, SystemMessage):
                        if message.subtype == "init":
                            if session_id := message.data.get("session_id"):
                                await on_session(session_id)
                        # task_progress / task_notification: what a running subagent has used so far
                        usage, spawner = getattr(message, "usage", None), getattr(message, "tool_use_id", None)
                        if usage and spawner in spawned:
                            await self.emit({"type": "subagent", "external_id": spawner, "status": "RUNNING",
                                             "total_tokens": usage.get("total_tokens"), "tool_uses": usage.get("tool_uses")})
            finally:
                self._client = None
        return result

    async def ask(self, prompt: str, system_prompt: str) -> RunResult:
        """One answer, no tools at all: the model can only read what is in the prompt."""
        from claude_agent_sdk import AssistantMessage, ClaudeAgentOptions, ClaudeSDKClient, ResultMessage, TextBlock

        options = ClaudeAgentOptions(
            model=self.model, cli_path=native_cli(), system_prompt=system_prompt, tools=[], strict_mcp_config=True,
            disallowed_tools=BUILTIN_TOOLS + list(SUBAGENT_TOOLS), permission_mode="dontAsk", setting_sources=[],
            max_turns=1, max_budget_usd=min(self.max_budget_usd, 1.0),
        )
        result = RunResult(ok=False, error="Claude session ended without a result")
        text: list[str] = []
        async with ClaudeSDKClient(options=options) as client:
            await client.query(prompt)
            async for message in client.receive_response():
                if isinstance(message, AssistantMessage):
                    text += [b.text for b in message.content if isinstance(b, TextBlock)]
                    if message.model:
                        await self.emit({"type": "model", "model": message.model})
                elif isinstance(message, ResultMessage):
                    result = RunResult(
                        ok=not message.is_error, text=message.result or "\n".join(text),
                        error="; ".join(message.errors or []) or (message.subtype if message.is_error else ""),
                        session_id=message.session_id, usage=_usage(message.usage), session_cost_usd=message.total_cost_usd)
        return result

    async def interrupt(self):
        if self._client:
            log.info("Interrupting Claude session")
            await self._client.interrupt()
