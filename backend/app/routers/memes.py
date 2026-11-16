"""Memecoins (#/memes): what the agents of memes.py collected on this PC, and the switches. /api/memes."""
from __future__ import annotations

import asyncio
import re
import time

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..memes import AGENTS, BRAIN, CHAINS, NOT_MEME, sync_influencers
from ..models import MarketItem, User
from ..security import current_user
from ..tradingroom import council

router = APIRouter(prefix="/api/memes")
SLIM = ("key", "chain", "address", "symbol", "name", "price", "liq", "mcap", "vol24", "vol1", "ch5", "ch1", "ch6", "ch24",
        "buys1", "sells1", "created", "image", "twitter", "telegram", "website", "url", "score", "parts", "flags", "why",
        "n6", "people6", "inf6", "danger", "age_h", "rug", "first")


async def viewer(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)) -> User:
    await db.commit()   # nothing here holds the Hub's SQLite while waiting (see tradingroom.viewer)
    return user


def _slim(t: dict) -> dict:
    out = {k: t.get(k) for k in SLIM}
    out["spark"] = [s[1] for s in t.get("snaps", [])[-40:]]
    out["watched"] = t["key"] in BRAIN.state["watch"]
    out["chain_name"] = CHAINS.get(t["chain"], t["chain"])
    return out


def _cfg_out() -> dict:
    c = dict(BRAIN.cfg)
    c["gmgn_key"] = bool(c.get("gmgn_key"))   # the key never goes back to the page
    return c


@router.get("/state")
async def state(user: User = Depends(viewer)):
    st = BRAIN.state
    toks = [t for t in st["tokens"].values() if t.get("score") is not None]
    toks.sort(key=lambda t: -(t.get("score") or 0))
    now = time.time()
    hours = [0] * 24   # mentions per hour, the last 24 h, oldest first
    for p in st["posts"]:
        h = int((now - p["t"]) // 3600)
        if 0 <= h < 24:
            hours[23 - h] += 1
    tick: dict[str, set] = {}
    for p in st["posts"]:
        if now - p["t"] < 6 * 3600:
            for k in p["tickers"]:
                tick.setdefault(k, set()).add((p["src"], p["who"].lower()))
    known = {(t.get("symbol") or "").upper() for t in st["tokens"].values()}
    agents = []
    for k, a in AGENTS.items():
        r = st["runs"].get(k, {})
        agents.append({"id": k, **a, "at": r.get("at"), "ok": r.get("ok"), "n": r.get("n"), "note": r.get("note", ""), "busy": BRAIN.busy == k})
    return {"now": now, "cfg": _cfg_out(), "agents": agents, "tokens": [_slim(t) for t in toks[:80]],
            "n_tokens": len(st["tokens"]), "posts": st["posts"][:80], "hours": hours,
            # a cashtag counts when it is a coin we follow or two accounts used it: one WatcherGuru post about $NVDA is no memecoin
            "tickers": sorted(({"t": k, "n": len(v)} for k, v in tick.items() if not NOT_MEME.search(k) and (k in known or len(v) >= 2)),
                              key=lambda x: -x["n"])[:20],
            "influencers": _influencers(st), "inf_posts": _inf_posts(st), "reports": st["reports"][:10], "alerts": st["alerts"][:30],
            "cg_trending": st.get("cg_trending", []), "gmgn": BRAIN.gmgn,
            "claude": {"installed": council.claude_exe() is not None, "today": BRAIN.claude_today()}}


READS = {"telegram": ("live", "Lido ao minuto"), "reddit": ("live", "Lido de 5 em 5 minutos")}
NOT_FREE = ("batman", "Só com o Batman ligado")   # X, Instagram, TikTok, YouTube: no free way to read an account


def _who(st: dict) -> dict:
    return {(i["platform"], i["handle"].lower()): i for i in st["influencers"]}


def _influencers(st: dict) -> list[dict]:
    """The team's influencers with what the page needs to read them at a glance: the last post and how we read them."""
    who, out = _who(st), []
    last: dict = {}
    for p in st["posts"]:
        k = (p.get("platform"), p["who"].lower())
        if k in who:
            last[k] = max(last.get(k, 0), p["t"])
    for i in st["influencers"]:
        k = (i["platform"], i["handle"].lower())
        r = READS.get(i["platform"], NOT_FREE)
        out.append({**i, "last": last.get(k), "reads": r[0], "reads_txt": r[1],
                    "posts48": sum(1 for p in st["posts"] if (p.get("platform"), p["who"].lower()) == k)})
    return sorted(out, key=lambda i: -(i["last"] or 0))   # who posted last comes first


def _inf_posts(st: dict) -> list[dict]:
    """What the influencers posted (newest first), each with the coins it talks about and how they moved since."""
    who, toks, out = _who(st), st["tokens"], []
    for p in sorted(st["posts"], key=lambda p: -p["t"]):
        i = who.get((p.get("platform"), p["who"].lower()))
        if not i:
            continue
        coins = []
        for key, c in (p.get("coins") or {}).items():
            t = toks.get(key)
            if t and t.get("score") is not None:
                # the price is the one we saw when the agent first linked post and coin: for a post found much later it is
                # «since we saw it», never «since he said it»
                coins.append({**_slim(t), "p0": c["p0"], "late": c["t0"] - p["t"] > 900,
                              "since": round((t["price"] / c["p0"] - 1) * 100, 1) if c.get("p0") and t.get("price") else None})
        out.append({**{k: p[k] for k in ("id", "src", "platform", "who", "text", "url", "t", "tickers")},
                    "name": i.get("name") or i["handle"], "avatar": i.get("avatar"), "coins": coins})
        if len(out) >= 40:
            break
    return out


@router.get("/token")
async def token(key: str, user: User = Depends(viewer)):
    t = BRAIN.state["tokens"].get(key)
    if not t:
        raise HTTPException(404, "Moeda desconhecida")
    return {**_slim(t), "snaps": t.get("snaps", []), "mentions": BRAIN.mentions(t, 48)[:40], "src": t.get("src", {})}


class Cfg(BaseModel):
    on: bool | None = None
    claude: bool | None = None
    model: str | None = None
    cap: int | None = None
    every_min: int | None = None
    alert_score: int | None = None
    alerts: bool | None = None
    min_liq: int | None = None
    telegram: list[str] | None = None
    reddit: list[str] | None = None
    gmgn_db: str | None = None
    gmgn_url: str | None = None
    gmgn_key: str | None = None


NAME = re.compile(r"^[A-Za-z0-9_]{3,40}$")


@router.post("/cfg")
async def cfg(body: Cfg, user: User = Depends(viewer)):
    c = BRAIN.cfg
    d = body.model_dump(exclude_none=True)
    if "model" in d and d["model"] not in ("haiku", "sonnet", "opus"):
        raise HTTPException(400, "Modelo desconhecido")
    for k, lo, hi in (("cap", 1, 40), ("every_min", 20, 1440), ("alert_score", 40, 100), ("min_liq", 0, 10_000_000)):
        if k in d:
            d[k] = max(lo, min(hi, d[k]))
    for k in ("telegram", "reddit"):
        if k in d:
            d[k] = list(dict.fromkeys(x.strip().lstrip("@").removeprefix("r/") for x in d[k] if NAME.match(x.strip().lstrip("@").removeprefix("r/"))))[:30]
    if "gmgn_url" in d and d["gmgn_url"] and not re.match(r"^https?://[^\s]+$", d["gmgn_url"]):
        raise HTTPException(400, "Endereço inválido: começa por http:// ou https://")
    if d.get("claude") and council.claude_exe() is None:
        raise HTTPException(400, "O Claude Code não está instalado neste PC")
    if d.get("claude"):
        c.setdefault("claude_by", user.username)
    c.update(d)
    BRAIN.save()
    if d.get("gmgn_url") or d.get("gmgn_db") or d.get("gmgn_key"):
        asyncio.create_task(BRAIN.tick("gmgn"))
    return {"cfg": _cfg_out()}


class Run(BaseModel):
    agent: str = "all"


@router.post("/run")
async def run(body: Run, user: User = Depends(viewer)):
    if body.agent not in (*AGENTS, "all"):
        raise HTTPException(404, "Agente desconhecido")
    if body.agent == "batman":
        if council.claude_exe() is None:
            raise HTTPException(400, "O Claude Code não está instalado neste PC")
        if BRAIN.busy == "batman":
            raise HTTPException(409, "O Batman já está a escrever um relatório")
    if BRAIN.lock.locked():
        return {"ok": True, "queued": False, "busy": True}
    asyncio.create_task(BRAIN.tick(body.agent))
    return {"ok": True}


class Influencer(BaseModel):
    platform: str
    handle: str
    note: str = ""


PLATFORMS = ("x", "telegram", "youtube", "tiktok", "instagram", "reddit")


def _handle(raw: str) -> str:
    h = raw.strip()
    m = re.search(r"(?:x\.com|twitter\.com|t\.me|tiktok\.com/@|instagram\.com|youtube\.com/@|reddit\.com/u(?:ser)?)/@?([A-Za-z0-9_.\-]+)", h)
    return (m.group(1) if m else h).lstrip("@")[:40]


@router.post("/influencers")
async def add_influencer(body: Influencer, user: User = Depends(viewer), db: AsyncSession = Depends(get_db)):
    """The list is the team's (MarketItem «meme_inf», by sync): added here, it shows on every PC."""
    if body.platform not in PLATFORMS:
        raise HTTPException(400, "Rede desconhecida")
    h = _handle(body.handle)
    if not re.match(r"^[A-Za-z0-9_.\-]{2,40}$", h):
        raise HTTPException(400, "Nome inválido")
    await sync_influencers()
    if any(i["platform"] == body.platform and i["handle"].lower() == h.lower() for i in BRAIN.state["influencers"]):
        raise HTTPException(409, "Já está na lista")
    db.add(MarketItem(user_id=user.id, kind="meme_inf", symbol=f"{body.platform}:{h}"[:60], note=body.note.strip()[:200]))
    await db.commit()
    await sync_influencers()
    BRAIN.save()
    return {"influencers": BRAIN.state["influencers"]}


@router.delete("/influencers/{platform}/{handle}")
async def del_influencer(platform: str, handle: str, user: User = Depends(viewer), db: AsyncSession = Depends(get_db)):
    from sqlalchemy import func, select
    rows = (await db.execute(select(MarketItem).where(MarketItem.kind == "meme_inf",
                                                      func.lower(MarketItem.symbol) == f"{platform}:{handle}".lower()))).scalars().all()
    for r in rows:
        await db.delete(r)
    await db.commit()
    await sync_influencers()
    BRAIN.save()
    return {"influencers": BRAIN.state["influencers"]}


class Watch(BaseModel):
    key: str


@router.post("/watch")
async def watch(body: Watch, user: User = Depends(viewer)):
    w = BRAIN.state["watch"]
    if body.key in w:
        w.remove(body.key)
    elif body.key in BRAIN.state["tokens"]:
        w.insert(0, body.key)
        del w[50:]
    BRAIN.save()
    return {"watched": body.key in w}
