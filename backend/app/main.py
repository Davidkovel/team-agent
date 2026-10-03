import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select

from .config import settings
from . import migrate
from .db import SessionLocal, engine
from .models import User
from .realtime import rt
from .routers import agent, agents, ai, analytics, auth, hub, local, ponto, tasks, team, week, work, ws
from .security import hash_password
from .services import (ONLINE_VIA, PENDING_ONLINE, SOFT_VIA, dashboard_open, hub_seen, log_activity, purge_trash, save_agent_state,
                       widget_recent)

log = logging.getLogger("team.backend")

SEED_USERS = [
    ("owner", "Owner", "owner", settings.owner_password),
    ("mark", "Mark", "member", settings.mark_password),
    ("david", "David", "member", settings.david_password),
]


# Logins stay owner/mark/david; the names people see are the real ones. In team mode nobody outranks anybody.
TEAM_NAMES = {"owner": "Kovel", "mark": "Marco", "david": "David"}


async def seed():
    async with SessionLocal() as db:
        if (await db.execute(select(User).limit(1))).scalar_one_or_none():
            return
        for username, name, role, password in SEED_USERS:
            db.add(User(username=username, display_name=name, role=role, password_hash=hash_password(password)))
        await db.commit()
        log.warning("Seeded users owner/mark/david - set *_PASSWORD env vars before first start in production")


async def sync_team_names():
    if not settings.team_mode:
        return
    async with SessionLocal() as db:
        for user in (await db.execute(select(User))).scalars():
            name = TEAM_NAMES.get(user.username)
            if name:
                user.display_name, user.role = name, "owner"
        await db.commit()


async def offline_watcher():
    """The one place that writes presence changes to the database, in order: who just came online through the Hub or
    widget, and who is gone (their presence key expired or was cleared)."""
    while True:
        await asyncio.sleep(2)
        try:
            for user_id in list(PENDING_ONLINE):
                PENDING_ONLINE.discard(user_id)
                if await rt.store.get_presence(user_id) is None:
                    continue  # came and went within a couple of seconds: nothing worth writing down
                rt.online.add(user_id)
                async with SessionLocal() as db:
                    user = await db.get(User, user_id)
                    await save_agent_state(db, user_id, "ONLINE")
                    await log_activity(db, user, "hub_online", f"{user.display_name} ficou online")
            for user_id in list(rt.online):
                if await rt.store.get_presence(user_id) is not None:
                    continue
                if widget_recent(user_id) or dashboard_open(user_id):
                    # the agent went quiet but the Hub/widget is still open: still online, nothing to announce
                    await hub_seen(user_id, "widget" if widget_recent(user_id) else "hub")
                    continue
                rt.online.discard(user_id)
                by_hub = ONLINE_VIA.pop(user_id, "agent") in SOFT_VIA
                async with SessionLocal() as db:
                    user = await db.get(User, user_id)
                    await save_agent_state(db, user_id, "OFFLINE", seen=False)
                    await log_activity(db, user, "hub_offline" if by_hub else "agent_offline",
                                       f"{user.display_name} saiu" if by_hub else f"{user.display_name} desligou o agente")
                await rt.publish("presence", user_id, "team")
        except Exception:
            log.exception("presence watcher")  # keep going: one bad tick must not stop the bookkeeping


@asynccontextmanager
async def lifespan(app: FastAPI):
    await migrate.upgrade(engine)  # creates what is missing, never drops; backs the database up before changing it
    await seed()
    await sync_team_names()
    async with SessionLocal() as db:
        await purge_trash(db)  # what sat in the task bin past its hours while the Hub was off
    await rt.start()
    watcher = asyncio.create_task(offline_watcher())
    yield
    watcher.cancel()
    await rt.stop()


app = FastAPI(title="Team Agent Backend", lifespan=lifespan)
for module in (auth, hub, tasks, team, agent, agents, ai, work, analytics, week, ponto, local, ws):
    app.include_router(module.router)

if Path(settings.frontend_dir).is_dir():
    app.mount("/", StaticFiles(directory=settings.frontend_dir, html=True), name="dashboard")
