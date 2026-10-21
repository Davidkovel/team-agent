import asyncio
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select

from .config import settings
from . import claude_hooks, claude_kit, health, limits, migrate, push, selfupdate, sync, webpush
from .db import SessionLocal, engine
from .models import User
from .realtime import rt
from .routers import agent, agents, ai, analytics, auth, hub, local, markets, office, ponto, tasks, team, trading, week, work, ws
from .routers import etsy, gap, newsadd, robots, sinal, skills, tradingroom
from .security import hash_password
from .services import (AWAY, ONLINE_VIA, PENDING_ONLINE, SOFT_VIA, dashboard_open, hub_seen, log_activity, purge_trash, save_agent_state,
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
                if user_id not in AWAY and (widget_recent(user_id) or dashboard_open(user_id)):
                    # the agent went quiet but the Hub/widget is still open: still online, nothing to announce
                    await hub_seen(user_id, "widget" if widget_recent(user_id) else "hub")
                    continue
                rt.online.discard(user_id)
                by_hub = ONLINE_VIA.pop(user_id, "agent") in SOFT_VIA
                async with SessionLocal() as db:
                    user = await db.get(User, user_id)
                    await save_agent_state(db, user_id, "OFFLINE")  # "visto há" = when they left, not when they came
                    await log_activity(db, user, "hub_offline" if by_hub else "agent_offline",
                                       f"{user.display_name} saiu" if by_hub else f"{user.display_name} desligou o agente")
                await rt.publish("presence", user_id, "team")
        except Exception:
            log.exception("presence watcher")  # keep going: one bad tick must not stop the bookkeeping


@asynccontextmanager
async def lifespan(app: FastAPI):
    await migrate.upgrade(engine)  # creates what is missing, never drops; backs the database up before changing it
    if settings.sync:
        await sync.prepare()  # before the first write: ids and the change log depend on it
    await seed()
    await sync_team_names()
    async with SessionLocal() as db:
        await purge_trash(db)  # what sat in the task bin past its hours while the Hub was off
    await rt.start()
    if settings.sync:  # the real Hub of a PC (the widget starts it with SYNC=1), never a test or a second Hub
        await asyncio.to_thread(claude_hooks.install, None, settings.claude_office, None, settings.claude_skills)
    watcher = asyncio.create_task(offline_watcher())
    syncing = asyncio.create_task(sync.loop()) if settings.sync else None
    updating = asyncio.create_task(selfupdate.loop())
    pushing = asyncio.create_task(webpush.loop())
    limiting = asyncio.create_task(limits.loop())
    measuring = asyncio.create_task(health.loop()) if settings.sync else None  # the real Hub of a PC: Saúde
    watching = asyncio.create_task(trading.loop()) if settings.sync else None  # Mercados: alerts and SEC filings
    trading_room = asyncio.create_task(tradingroom.loop()) if settings.sync or os.environ.get("TRADING_ROOM") == "1" else None  # Sala de Trading
    robots_loop = asyncio.create_task(robots.loop()) if settings.sync or os.environ.get("TRADING_ROOM") == "1" else None  # Escritório de Robôs: the accounts
    signal = asyncio.create_task(sinal.loop()) if trading_room else None  # Sinal na notícia: BUY/SELL the second a US figure is out
    reforco = asyncio.create_task(newsadd.loop()) if robots_loop else None  # Reforço na notícia: the ladder on the MT5 account
    gaps = asyncio.create_task(gap.loop()) if robots_loop else None  # Gap da manhã: the gaps on the MT5 account's quotes
    kit = asyncio.create_task(claude_kit.loop()) if settings.sync else None  # idle until the PC's person turns it on (Trabalho › Kit do Claude)
    factory = asyncio.create_task(etsy.loop()) if settings.sync else None  # Fábrica Etsy: idle until this PC's person turns it on
    yield
    if factory:
        factory.cancel()
    if kit:
        kit.cancel()
    if reforco:
        reforco.cancel()
    if gaps:
        gaps.cancel()
    if robots_loop:
        robots_loop.cancel()
    if signal:
        signal.cancel()
    if trading_room:
        trading_room.cancel()
    if watching:
        watching.cancel()
    if measuring:
        measuring.cancel()
    limiting.cancel()
    updating.cancel()
    pushing.cancel()
    watcher.cancel()
    if syncing:
        syncing.cancel()
    await rt.stop()


app = FastAPI(title="Team Agent Backend", lifespan=lifespan)
for module in (auth, hub, tasks, team, agent, agents, ai, work, analytics, week, ponto, local, markets, trading, office, skills, selfupdate, ws, sync, push, webpush):
    app.include_router(module.router)
app.include_router(tradingroom.router)  # Sala de Trading
app.include_router(robots.router)  # Escritório de Robôs
app.include_router(newsadd.router)  # Reforço na notícia
app.include_router(sinal.router)  # Sinal na notícia
app.include_router(gap.router)  # Gap da manhã
app.include_router(etsy.router)  # Fábrica Etsy
app.include_router(claude_kit.router)  # plugins and personal skills between the PCs that turned it on
app.include_router(claude_kit.panel)  # Trabalho › Kit do Claude: every PC, and the button to turn it on here

@app.middleware("http")
async def always_fresh(request, call_next):
    """The Hub's pages and scripts are revalidated on every load (a 304 when nothing changed): the iPhone app, which Safari
    caches hard, then always shows the version this computer has, the moment it has it."""
    response = await call_next(request)
    if not request.url.path.startswith(("/api", "/ws")) and "cache-control" not in response.headers:
        response.headers["Cache-Control"] = "no-cache"
    return response


if Path(settings.frontend_dir).is_dir():
    app.mount("/", StaticFiles(directory=settings.frontend_dir, html=True), name="dashboard")
