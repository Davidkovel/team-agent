from dataclasses import asdict, dataclass, field


@dataclass
class AgentState:
    """Single source of truth for heartbeat, widget and dashboard presence."""
    user: str = ""
    display_name: str = ""
    status: str = "ONLINE"  # ONLINE | WORKING | IDLE | WAITING | PAUSED | ERROR
    connected: bool = False  # backend reachable
    task_id: int | None = None
    task: str = ""
    progress: int = 0
    current_action: str = ""
    last_action: str = ""
    next_action: str = ""
    error: str = ""
    pending_approval: str = ""
    started_at: float | None = None
    usage: dict = field(default_factory=dict)
    team: list = field(default_factory=list)
    notifications: list = field(default_factory=list)
    history: list = field(default_factory=list)  # what the agent did, newest last
    dashboard_url: str = ""

    def to_dict(self) -> dict:
        return asdict(self)

    def heartbeat(self) -> dict:
        keys = ("status", "task_id", "task", "progress", "current_action", "last_action",
                "next_action", "error", "started_at", "usage")
        return {k: getattr(self, k) for k in keys}

    def clear_task(self):
        self.task_id, self.task, self.progress, self.started_at = None, "", 0, None
        self.current_action = self.next_action = self.pending_approval = ""
        self.usage = {}
