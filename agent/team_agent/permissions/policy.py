"""Permission policy: every tool call is classified before it runs.

SAFE              -> runs immediately
REQUIRES_APPROVAL -> agent stops and waits for the owner's decision
BLOCKED           -> never runs, cannot be approved
"""
import json
import re
from dataclasses import dataclass
from enum import Enum
from pathlib import Path


class Level(str, Enum):
    SAFE = "SAFE"
    REQUIRES_APPROVAL = "REQUIRES_APPROVAL"
    BLOCKED = "BLOCKED"


@dataclass
class Decision:
    level: Level
    reason: str = ""


SAFE = Decision(Level.SAFE)


def _approval(reason: str) -> Decision:
    return Decision(Level.REQUIRES_APPROVAL, reason)


def _blocked(reason: str) -> Decision:
    return Decision(Level.BLOCKED, reason)


SECRET_FILE = re.compile(r"^(\.env(\..*)?|.*\.(pem|key|pfx|p12)|id_(rsa|ed25519).*|credentials.*|secrets?\..*)$", re.I)
PROD_FILE = re.compile(r"prod(uction)?", re.I)

# Allowed test/lint commands (prefix match on normalized command).
SAFE_COMMANDS = [
    "pytest", "python -m pytest", "python -m unittest", "npm test", "npm run test", "npm run lint",
    "npx eslint", "ruff", "mypy", "tsc --noemit", "go test", "cargo test",
]
APPROVAL_PATTERNS = [
    r"\bdeploy", r"\bpublish", r"\brelease\b", r"\bpush\b", r"\bkubectl\b", r"\bhelm\b", r"\bterraform\b",
    r"\bdocker\b", r"\balembic\b", r"\bmigrat", r"\bpsql\b", r"\bmysql\b", r"\bprod(uction)?\b", r"\bnpm (i|install)\b",
    r"\bpip install\b",
]
BLOCKED_PATTERNS = [
    r"\brm\s+-[a-z]*r", r"\bdel\s+/[sq]", r"\brmdir\s+/s", r"\bformat\b", r"\bmkfs", r"\bdd\s+if=", r"\bshutdown\b",
    r"\breboot\b", r"\bsudo\b", r"\breg\s+(add|delete)\b", r"drop\s+(database|schema)", r"\bcurl\b", r"\bwget\b",
    r"\bpowershell\b", r"\bpwsh\b", r"\bcmd\b", r"\bbash\b", r"\bsh\b", r"\bnet\s+user\b", r"\bchmod\s+777\b",
]
SHELL_OPERATORS = re.compile(r"[;&|<>`$\n\r]")

GIT_SAFE = {"status", "diff", "log", "show", "add", "commit", "branch", "checkout", "switch", "init", "rev-parse", "stash"}
GIT_BLOCKED_FLAGS = {"-f", "--force", "--force-with-lease", "-c", "-C", "--exec-path", "--upload-pack", "--receive-pack"}
GIT_BLOCKED = {"filter-branch", "config", "gc", "reflog"}


class PermissionPolicy:
    def __init__(self, workspace: Path, policy_file: Path | None = None):
        self.workspace = workspace.resolve()
        self.safe_commands = list(SAFE_COMMANDS)
        self.approval_patterns = list(APPROVAL_PATTERNS)
        self.blocked_patterns = list(BLOCKED_PATTERNS)
        if policy_file and policy_file.is_file():
            # Project policy can extend the lists; it cannot remove built-in blocks.
            extra = json.loads(policy_file.read_text(encoding="utf-8"))
            self.safe_commands += extra.get("safe_commands", [])
            self.approval_patterns += extra.get("approval_patterns", [])
            self.blocked_patterns += extra.get("blocked_patterns", [])

    def resolve(self, raw: str) -> Path:
        return (self.workspace / raw).resolve()

    def check_path(self, raw: str, op: str) -> Decision:
        """op: read | write | delete"""
        path = self.resolve(raw)
        if path != self.workspace and not path.is_relative_to(self.workspace):
            return _blocked("path is outside the task workspace")
        if ".git" in path.relative_to(self.workspace).parts:
            return _blocked("direct access to .git is not allowed; use the git tool")
        if SECRET_FILE.match(path.name):
            if op == "read":
                return _blocked("secret/credential files are never exposed to the AI")
            return _approval("changes a secrets/configuration file")
        if op == "delete":
            return _approval("deletes a file")
        if op == "write" and PROD_FILE.search(path.name):
            return _approval("changes production configuration")
        return SAFE

    def check_command(self, command: str) -> Decision:
        if SHELL_OPERATORS.search(command):
            return _blocked("shell operators (; & | < > ` $) are not allowed; run one plain command")
        normalized = " ".join(command.lower().split())
        for pattern in self.blocked_patterns:
            if re.search(pattern, normalized):
                return _blocked(f"destructive or unrestricted command (rule: {pattern})")
        for pattern in self.approval_patterns:
            if re.search(pattern, normalized):
                return _approval(f"sensitive command (rule: {pattern})")
        if any(normalized == safe or normalized.startswith(safe + " ") for safe in self.safe_commands):
            return SAFE
        return _approval("command is not on the allowlist of safe test/lint commands")

    def check_git(self, args: list[str]) -> Decision:
        if any(a in GIT_BLOCKED_FLAGS or a.startswith("--exec") for a in args):
            return _blocked("forced or config-overriding git flags are not allowed")
        sub = next((a for a in args if not a.startswith("-")), "")
        if not sub or sub in GIT_BLOCKED:
            return _blocked(f"git {sub or '(no subcommand)'} is not allowed")
        if sub in GIT_SAFE:
            return SAFE
        return _approval(f"git {sub} changes shared or remote state")
