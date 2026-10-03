from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from ..permissions import Decision, Level, PermissionPolicy


@dataclass
class ToolResult:
    text: str
    is_error: bool = False


class AgentBridge(Protocol):
    """What tools may ask of the agent core. Tools never talk to the backend directly."""

    async def report_progress(self, progress: int, current_action: str, last_action: str, next_action: str): ...
    async def record(self, kind: str, message: str): ...
    async def request_approval(self, action: str, detail: str, meta: dict | None = None) -> bool: ...
    async def complete(self, result: str): ...
    async def ask_help(self, message: str): ...
    async def notify(self, message: str): ...


@dataclass
class ToolContext:
    workspace: Path
    policy: PermissionPolicy
    bridge: AgentBridge


class Tool(ABC):
    name: str
    description: str
    schema: dict  # JSON Schema of the arguments

    def check(self, args: dict, ctx: ToolContext) -> Decision:
        """Permission level of this specific call. Default: SAFE."""
        return Decision(Level.SAFE)

    def summary(self, args: dict) -> str:
        """Human-readable description shown in approval requests and logs."""
        return self.name

    @abstractmethod
    async def run(self, args: dict, ctx: ToolContext) -> ToolResult: ...


def schema(required: list[str] | None = None, **properties: dict) -> dict:
    return {"type": "object", "properties": properties,
            "required": required if required is not None else list(properties), "additionalProperties": False}


STR = {"type": "string"}
