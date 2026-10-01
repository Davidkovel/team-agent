from .provider import TaskProvider


class RemoteTaskProvider(TaskProvider):
    """Tasks assigned through the Team Backend."""

    def __init__(self, backend):
        self.backend = backend

    async def next_task(self) -> dict | None:
        tasks = await self.backend.next_tasks()
        return tasks[0] if tasks else None

    async def unfinished(self) -> dict:
        return await self.backend.recovery()
