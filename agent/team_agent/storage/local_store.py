import json
from pathlib import Path


class LocalStore:
    """Small JSON file with per-task usage totals. The backend (PostgreSQL) stays
    the source of truth for task context; this only keeps what the backend
    cannot know: running session cost, needed to report cost deltas."""

    def __init__(self, data_dir: Path):
        self.path = data_dir / "state.json"
        self.data: dict = json.loads(self.path.read_text(encoding="utf-8")) if self.path.exists() else {}

    def usage(self, task_id: int) -> dict:
        default = {"input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0, "session_cost": 0.0, "session_id": None}
        return {**default, **self.data.get("usage", {}).get(str(task_id), {})}

    def save_usage(self, task_id: int, usage: dict):
        self.data.setdefault("usage", {})[str(task_id)] = usage
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(self.data, indent=2), encoding="utf-8")
