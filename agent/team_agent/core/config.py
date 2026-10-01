import os
from dataclasses import dataclass
from pathlib import Path


def load_env_file(path: Path):
    """Minimal KEY=VALUE loader; real environment variables win."""
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            value = value.strip().strip('"').strip("'")
            if value:  # an empty ANTHROPIC_API_KEY= must not shadow the local Claude login
                os.environ.setdefault(key.strip(), value)


@dataclass
class Config:
    server_url: str
    agent_token: str
    workspace: Path
    data_dir: Path
    local_port: int = 8765
    model: str = "claude-opus-5-5"
    max_budget_usd: float = 5.0
    max_turns: int = 80
    heartbeat_interval: float = 10.0
    approval_poll: float = 3.0
    # resume: continue an unfinished task after verifying its saved state.
    # ask: restore context but stay PAUSED until the user presses Resume.
    recovery_mode: str = "resume"
    policy_file: Path | None = None

    @classmethod
    def from_env(cls) -> "Config":
        profile = os.environ.get("TEAM_AGENT_PROFILE", "default")
        home = Path.home()
        policy = os.environ.get("TEAM_AGENT_POLICY_FILE")
        return cls(
            server_url=os.environ.get("TEAM_SERVER_URL", "http://localhost:8000").rstrip("/"),
            agent_token=os.environ.get("TEAM_AGENT_TOKEN", ""),
            workspace=Path(os.environ.get("TEAM_AGENT_WORKSPACE", home / "team-agent-workspace")),
            data_dir=Path(os.environ.get("TEAM_AGENT_DATA_DIR", home / ".team-agent" / profile)),
            local_port=int(os.environ.get("TEAM_AGENT_LOCAL_PORT", "8765")),
            model=os.environ.get("TEAM_AGENT_MODEL", "claude-opus-5-5"),
            max_budget_usd=float(os.environ.get("TEAM_AGENT_MAX_BUDGET_USD", "5")),
            max_turns=int(os.environ.get("TEAM_AGENT_MAX_TURNS", "80")),
            recovery_mode=os.environ.get("TEAM_AGENT_RECOVERY_MODE", "resume"),
            policy_file=Path(policy) if policy else None,
        )
