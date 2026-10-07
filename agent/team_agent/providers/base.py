from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import Awaitable, Callable

from ..tools import ToolRegistry


@dataclass
class RunResult:
    ok: bool
    text: str = ""
    error: str = ""
    session_id: str | None = None
    # Tokens of this run: input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens.
    usage: dict = field(default_factory=dict)
    # Provider's running cost estimate for the whole session (None if unknown).
    session_cost_usd: float | None = None


class AIProvider(ABC):
    """The reasoning engine. It only acts through the ToolRegistry it is given.

    While it runs it may tell the agent core what is happening through on_event (set by the core, optional):
      {"type": "model", "model": str}
      {"type": "usage", input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens}   tokens of one reply
      {"type": "tool", "name": str, "input": dict, "subagent": id | None}                        a tool call was made
      {"type": "subagent", "external_id": str, "status": RUNNING|DONE|ERROR, role, task, total_tokens, tool_uses}
    A provider that cannot report these simply never calls it.
    """

    on_event: Callable[[dict], Awaitable[None]] | None = None

    async def emit(self, event: dict):
        if self.on_event:
            await self.on_event(event)

    @abstractmethod
    def unavailable_reason(self) -> str | None:
        """None when ready; otherwise a message explaining what is missing."""

    @abstractmethod
    async def run(self, prompt: str, system_prompt: str, registry: ToolRegistry, workspace: Path,
                  resume_session: str | None, on_session: Callable[[str], Awaitable[None]],
                  home: Path | None = None) -> RunResult:
        """home: where the conversation is kept (a crew member's own folder); the workspace when None."""

    async def ask(self, prompt: str, system_prompt: str) -> RunResult:
        """Answer one question from the text of the prompt alone (no tools). Providers that cannot say so."""
        return RunResult(ok=False, error="this AI provider cannot answer questions")

    @abstractmethod
    async def interrupt(self): ...
