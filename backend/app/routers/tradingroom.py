"""Sala de Trading (#/trading): the room's read of the markets, the charts, the meetings of the Pinguim and the
Duas-Caras, and the big alert (tradingroom/). Not to be confused with Mercados (routers/trading.py, /api/trading):
the watchlist and the paper trading."""
from __future__ import annotations

import time
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..models import User
from ..security import current_user
from ..tradingroom import backtest, council, sessions
from ..tradingroom.analysis import chart as chart_of
from ..tradingroom.markets import BY_ID, INSTRUMENTS, TF
from ..tradingroom.book import AGENTS
from ..tradingroom.room import MODELS, ROOM, loop, publish  # noqa: F401  (loop: started by main.py)

router = APIRouter(prefix="/api/trading-room")
UTC = timezone.utc


async def viewer(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)) -> User:
    """The person, with current_user's transaction already closed: these endpoints can wait on the network, and an open
    transaction on the Hub's SQLite (BEGIN IMMEDIATE) would lock the whole Hub meanwhile."""
    await db.commit()
    return user


def _settings() -> dict:
    st = ROOM.state
    return {"claude": bool(st["claude"]), "model": st["model"], "cap": st["cap"], "today": ROOM.today_count(),
            "installed": council.claude_exe() is not None, "models": list(MODELS)}


@router.get("/state")
async def state(user: User = Depends(viewer)):
    if not ROOM.view and time.time() - ROOM.updated > 30:
        await ROOM.refresh(force=True)
    now = datetime.now(UTC)
    cal = [e for e in ROOM.calendar if e["imp"] >= 2 and e["t"] and -12 * 3600 <= (datetime.fromisoformat(e["t"].replace("Z", "+00:00")) - now).total_seconds() <= 48 * 3600]
    meetings = ROOM.state["meetings"][:12]
    return {"now": now.isoformat(), "updated": ROOM.updated, "sessions": sessions.sessions(now), "killzone": sessions.killzone(now),
            "instruments": [ROOM.view[i["id"]] for i in INSTRUMENTS if i["id"] in ROOM.view], "context": ROOM.context,
            "calendar": cal, "news": ROOM.news[:30], "meetings": meetings, "alert": ROOM.alert_for(user.username),
            "settings": _settings(), "people": council.PEOPLE, "pending": ROOM.pending and {k: ROOM.pending[k] for k in ("reason", "kind")},
            "sources": {i: ROOM.store.source.get(i, "") for i in BY_ID},
            "stats": [ROOM.book.stats(a) for a in AGENTS], "trades": [ROOM.book.out(t, ROOM.view) for t in ROOM.book.trades[:80]],
            "macro": ROOM.macro, "cot": ROOM.inst.cot}


@router.get("/chart")
async def chart(id: str, tf: str = "M15", user: User = Depends(viewer)):
    if id not in BY_ID or tf not in TF:
        raise HTTPException(404, "Instrumento ou tempo gráfico desconhecido")
    if not ROOM.store.get(id, tf):
        await ROOM.store.refresh([id], force=True)
    out = chart_of(id, tf, ROOM.store, datetime.now(UTC))
    if not out:
        raise HTTPException(503, "Ainda sem velas para este gráfico")
    a = ROOM.view.get(id)
    if a:
        out["keys"], out["setups"] = a["keys"], [s for s in a["setups"] if s["tf"] == tf] or (a["setups"][:1] if tf in ("H1", "H4", "D1") else [])
        out["price"], out["bias"] = a["price"], a["bias"]
    t0 = out["candles"][0][0] if out["candles"] else 0
    out["trades"] = [ROOM.book.out(t, ROOM.view) for t in ROOM.book.trades
                     if t["symbol"] == id and t["status"] not in ("refused", "cancelled") and (t["status"] in ("pending", "open") or (t.get("closed_at") and datetime.fromisoformat(t["closed_at"]).timestamp() >= t0))][:30]
    return out


@router.get("/trades")
async def trades(agent: str = "", status: str = "", symbol: str = "", limit: int = 200, user: User = Depends(viewer)):
    """The book: every trade of the room, newest first, and the numbers of each agent."""
    rows = [t for t in ROOM.book.trades if (not agent or t["agent"] == agent) and (not symbol or t["symbol"] == symbol)
            and (not status or t["status"] in status.split(","))]
    return {"trades": [ROOM.book.out(t, ROOM.view) for t in rows[: max(1, min(600, limit))]], "stats": [ROOM.book.stats(a) for a in AGENTS]}


@router.get("/backtest")
async def backtest_state(user: User = Depends(viewer)):
    """The last backtest of the SMC model (None before the first) and whether one is running now."""
    return {**backtest.status(), "result": backtest.last()}


@router.post("/backtest")
async def backtest_start(user: User = Depends(viewer)):
    backtest.start()
    return backtest.status()


@router.get("/pulse")
async def pulse(user: User = Depends(viewer)):
    return ROOM.pulse()


@router.get("/meetings")
async def meetings(limit: int = 20, user: User = Depends(viewer)):
    return ROOM.state["meetings"][: max(1, min(40, limit))]


class Meet(BaseModel):
    focus: list[str] = []
    topic: str = ""


@router.post("/meet")
async def meet(body: Meet, user: User = Depends(viewer)):
    if ROOM.running():
        raise HTTPException(409, "Já há uma reunião a decorrer")
    if not ROOM.view:
        await ROOM.refresh(force=True)
    focus = [f for f in body.focus if f in BY_ID][:3]
    reason = body.topic.strip()[:300] or f"{user.display_name or user.username} convocou a reunião" + (f" sobre {', '.join(focus)}" if focus else "") + "."
    rec = ROOM.start(reason, focus, "manual", user.username)
    if not rec:
        raise HTTPException(409, "Já há uma reunião a decorrer")
    return {"id": rec["id"], "mode": rec["mode"]}


class Settings(BaseModel):
    claude: bool | None = None
    model: str | None = None
    cap: int | None = None


@router.post("/settings")
async def set_settings(body: Settings, user: User = Depends(viewer)):
    if body.claude is not None:
        ROOM.state["claude"] = bool(body.claude)
    if body.model in MODELS:
        ROOM.state["model"] = body.model
    if body.cap is not None:
        ROOM.state["cap"] = max(1, min(40, body.cap))
    ROOM.save()
    await publish()
    return _settings()


@router.get("/alert")
async def alert(user: User = Depends(viewer)):
    return ROOM.alert_for(user.username)


@router.post("/alerts/{alert_id}/seen")
async def seen(alert_id: int, user: User = Depends(viewer)):
    ROOM.ack(user.username, alert_id)
    return {"ok": True}


@router.post("/alerts/test")
async def test_alert(user: User = Depends(viewer)):
    """The big alert with what the room sees now, to see how it looks (it only goes to the pages, not to the phones)."""
    if not ROOM.view:
        await ROOM.refresh(force=True)
    room = ROOM.room()
    best = max((s | {"_id": a["id"]} for a in room["instruments"] for s in a["setups"]), key=lambda s: s["score"], default=None)
    focus = [best["_id"]] if best else [a["id"] for a in room["instruments"][:1]]
    turns, verdict = council.auto_meeting(room, datetime.now(UTC), "Ensaio do aviso", focus)
    verdict["importancia"] = max(4, verdict["importancia"])
    rec = {"id": int(time.time() * 1000), "turns": [{"who": w, "text": t} for w, t in zip(("penguin", "twoface", "penguin"), turns)], "mode": "auto",
           "reason": "Ensaio do aviso (pedido na sala)"}
    return await ROOM.alert(rec, verdict, test=True)
