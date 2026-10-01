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
    """The reasoning engine. It only acts through the ToolRegistry it is given."""

    @abstractmethod
    def unavailable_reason(self) -> str | None:
        """None when ready; otherwise a message explaining what is missing."""

    @abstractmethod
    async def run(self, prompt: str, system_prompt: str, registry: ToolRegistry, workspace: Path,
                  resume_session: str | None, on_session: Callable[[str], Awaitable[None]]) -> RunResult: ...

    @abstractmethod
    async def interrupt(self): ...
