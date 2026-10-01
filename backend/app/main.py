import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select

from .config import settings
from .db import Base, SessionLocal, engine
from .models import User
from .realtime import rt
from .routers import agent, auth, tasks, team, workspace, ws
from .security import hash_password
from .services import log_activity, save_agent_state

log = logging.getLogger("team.backend")

SEED_USERS = [
    ("owner", "Owner", "owner", settings.owner_password),
    ("mark", "Mark", "member", settings.mark_password),
    ("david", "David", "member", settings.david_password),
]


async def seed():
    async with SessionLocal() as db:
        if (await db.execute(select(User).limit(1))).scalar_one_or_none():
            return
        for username, name, role, password in SEED_USERS:
            db.add(User(username=username, display_name=name, role=role, password_hash=hash_password(password)))
        await db.commit()
        log.warning("Seeded users owner/mark/david - set *_PASSWORD env vars before first start in production")


async def offline_watcher():
    """Presence keys expire without heartbeats; announce the transition to OFFLINE."""
    while True:
        await asyncio.sleep(5)
        for user_id in list(rt.online):
            if await rt.store.get_presence(user_id) is None:
                rt.online.discard(user_id)
                async with SessionLocal() as db:
                    user = await db.get(User, user_id)
                    await save_agent_state(db, user_id, "OFFLINE", seen=False)
                    await log_activity(db, user, "agent_offline", f"{user.display_name}'s agent went offline")
                await rt.publish("presence", user_id, "team")


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await seed()
    await rt.start()
    watcher = asyncio.create_task(offline_watcher())
    yield
    watcher.cancel()
    await rt.stop()


app = FastAPI(title="Team Agent Backend", lifespan=lifespan)
for module in (auth, tasks, team, workspace, agent, ws):
    app.include_router(module.router)

if Path(settings.frontend_dir).is_dir():
    app.mount("/", StaticFiles(directory=settings.frontend_dir, html=True), name="dashboard")
