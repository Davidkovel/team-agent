from abc import ABC, abstractmethod


class TaskProvider(ABC):
    """Where tasks come from. Implement this for GitHub, Jira, Linear, Slack, Telegram...

    A task is a dict with: id, title, description, goal, requirements (list[str]),
    project, status, progress, last_action, session_id.
    """

    @abstractmethod
    async def next_task(self) -> dict | None:
        """The next newly assigned task, or None."""

    @abstractmethod
    async def unfinished(self) -> dict:
        """{'task': dict | None, 'events': [...], 'pending_approvals': [...]} for recovery."""
