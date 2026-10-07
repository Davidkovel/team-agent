import json
from pathlib import Path


class LocalStore:
    """Small JSON file with per-task usage totals. The backend (PostgreSQL) stays
    the source of truth for task context; this only keeps what the backend
    cannot know: running session cost, needed to report cost deltas."""

    def __init__(self, data_dir: Path):
        self.path = data_dir / "state.json"
        self.data: dict = json.loads(self.path.read_text(encoding="utf-8")) if self.path.exists() else {}

    def history(self) -> list:
        return self.data.get("history", [])

    def add_history(self, entry: dict):
        self.data["history"] = (self.history() + [entry])[-50:]
        self._save()

    def usage(self, task_id: int) -> dict:
        default = {"input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0, "session_cost": 0.0, "session_id": None}
        return {**default, **self.data.get("usage", {}).get(str(task_id), {})}

    def save_usage(self, task_id: int, usage: dict):
        self.data.setdefault("usage", {})[str(task_id)] = usage
        self._save()

    # A crew member's Claude conversation (crew.py on the Hub): resumed for each of their tasks, so they remember what
    # they did. After CREW_ROTATE tasks it starts afresh (the Hub's memory keeps what matters), so it never gets heavy.
    CREW_ROTATE = 12

    def crew(self, crew_id: str) -> dict:
        return {"session_id": None, "cost": 0.0, "tasks": 0, **self.data.get("crew", {}).get(crew_id, {})}

    def crew_session(self, crew_id: str) -> str | None:
        record = self.crew(crew_id)
        if record["tasks"] >= self.CREW_ROTATE:
            self.data.setdefault("crew", {}).pop(crew_id, None)
            self._save()
            return None
        return record["session_id"]

    def save_crew(self, crew_id: str, session_id: str, cost: float | None, new_task: bool):
        record = self.crew(crew_id)
        if session_id != record["session_id"]:
            record = {"session_id": session_id, "cost": 0.0, "tasks": 0}
        if cost is not None:
            record["cost"] = cost
        record["tasks"] += 1 if new_task else 0
        self.data.setdefault("crew", {})[crew_id] = record
        self._save()

    def _save(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(self.data, indent=2), encoding="utf-8")
