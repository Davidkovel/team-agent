"""Presence, agent command queues and WebSocket fan-out.

Redis holds everything that is live and ephemeral: presence keys with a TTL
(no heartbeat -> key expires -> OFFLINE), per-agent command queues, and the
pub/sub channel that fans events out to every backend process. MemoryStore is
the same interface for single-process dev and tests.
"""
import asyncio
import json
import time
from collections import defaultdict
from typing import Awaitable, Callable

from fastapi import WebSocket

from .config import settings

Handler = Callable[[dict], Awaitable[None]]
CHANNEL = "team:events"


class MemoryStore:
    def __init__(self):
        self._presence: dict[int, tuple[float, dict]] = {}
        self._commands: dict[int, list[dict]] = defaultdict(list)
        self._handler: Handler | None = None

    async def start(self, handler: Handler):
        self._handler = handler

    async def stop(self):
        pass

    async def set_presence(self, user_id: int, data: dict, ttl: int):
        self._presence[user_id] = (time.time() + ttl, data)

    async def get_presence(self, user_id: int) -> dict | None:
        entry = self._presence.get(user_id)
        return entry[1] if entry and entry[0] > time.time() else None

    async def push_command(self, user_id: int, command: dict):
        self._commands[user_id].append(command)

    async def pop_commands(self, user_id: int) -> list[dict]:
        return self._commands.pop(user_id, [])

    async def publish(self, event: dict):
        if self._handler:
            await self._handler(event)


class RedisStore:
    def __init__(self, url: str):
        import redis.asyncio as redis
        self._redis = redis.from_url(url, decode_responses=True)
        self._listener: asyncio.Task | None = None

    async def start(self, handler: Handler):
        pubsub = self._redis.pubsub()
        await pubsub.subscribe(CHANNEL)

        async def listen():
            async for message in pubsub.listen():
                if message["type"] == "message":
                    await handler(json.loads(message["data"]))

        self._listener = asyncio.create_task(listen())

    async def stop(self):
        if self._listener:
            self._listener.cancel()
        await self._redis.aclose()

    async def set_presence(self, user_id: int, data: dict, ttl: int):
        await self._redis.setex(f"presence:{user_id}", ttl, json.dumps(data))

    async def get_presence(self, user_id: int) -> dict | None:
        raw = await self._redis.get(f"presence:{user_id}")
        return json.loads(raw) if raw else None

    async def push_command(self, user_id: int, command: dict):
        await self._redis.rpush(f"commands:{user_id}", json.dumps(command))

    async def pop_commands(self, user_id: int) -> list[dict]:
        key = f"commands:{user_id}"
        async with self._redis.pipeline(transaction=True) as pipe:
            raw, _ = await pipe.lrange(key, 0, -1).delete(key).execute()
        return [json.loads(item) for item in raw]

    async def publish(self, event: dict):
        await self._redis.publish(CHANNEL, json.dumps(event))


class Connection:
    def __init__(self, ws: WebSocket, user_id: int, role: str, kind: str):
        self.ws, self.user_id, self.role, self.kind = ws, user_id, role, kind


class Realtime:
    """Events are invalidation hints ({type, user_id}); clients re-fetch via REST,
    which is where visibility rules are enforced.

    Audiences: team (every dashboard), private (owner + the subject user),
    agent (only that user's agent connection).
    """

    def __init__(self):
        self.store = RedisStore(settings.redis_url) if settings.redis_url else MemoryStore()
        self.connections: list[Connection] = []
        self.online: set[int] = set()

    async def start(self):
        await self.store.start(self._dispatch)

    async def stop(self):
        await self.store.stop()

    async def publish(self, type_: str, user_id: int, audience: str = "private", **data):
        await self.store.publish({"type": type_, "user_id": user_id, "audience": audience, **data})

    async def command(self, user_id: int, command: dict):
        """Queue a command for an agent and nudge it to heartbeat now."""
        await self.store.push_command(user_id, command)
        await self.publish("wake", user_id, "agent")

    def _visible(self, conn: Connection, event: dict) -> bool:
        if event["audience"] == "agent":
            return conn.kind == "agent" and conn.user_id == event["user_id"]
        if conn.kind == "agent":
            return False
        if event["audience"] == "team" or settings.team_mode or conn.role == "owner":
            return True
        return conn.user_id == event["user_id"]

    async def _dispatch(self, event: dict):
        for conn in list(self.connections):
            if not self._visible(conn, event):
                continue
            try:
                await conn.ws.send_json(event)
            except Exception:
                self.connections.remove(conn)


rt = Realtime()
