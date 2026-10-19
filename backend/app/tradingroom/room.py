"""The trading room on this Hub: keeps the candles, the calendar and the headlines fresh, reads every instrument
(analysis.py), decides when the two traders meet (council.py) and when to call the partners with the big alert.

Each PC's Hub runs its own room (light: one connection to the chart feed a minute, the reading in a few milliseconds).
Claude only meets where it was switched on (`claude` in the settings, from the room's page): it spends that PC's plan.
State (settings, meetings, alerts, what was already told) is a JSON file, not the database, so nothing here syncs."""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx

from . import council, reaction, sessions
from .analysis import analyse
from .book import Book
from .institutional import Institutional, drivers
from .markets import CONTEXT, INSTRUMENTS, UA, CandleStore, calendar, headlines, split_live

log = logging.getLogger("tradingroom")
UTC = timezone.utc
DIR = Path(os.environ.get("TRADING_ROOM_DIR") or Path.home() / ".team-agent" / "trading-room")
WALL = ["XAUUSD", "EURUSD", "GER40"]   # the three screens of the room's video wall in the cave
MODELS = ("sonnet", "opus", "haiku")


def iso(t: datetime | None = None) -> str:
    return (t or datetime.now(UTC)).isoformat(timespec="seconds")


def _parse(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


class Room:
    def __init__(self):
        self.store = CandleStore()
        self.calendar: list[dict] = []
        self.news: list[dict] = []
        self.cal_at = self.news_at = 0.0
        self.view: dict[str, dict] = {}
        self.context: list[dict] = []
        self.updated = 0.0
        self.task: asyncio.Task | None = None
        self.pending: dict | None = None
        self.first = True
        self.published = 0.0
        self.state = self._load()
        self.book = Book(self.state)
        self.inst = Institutional()
        self.macro: dict = {}

    # ---------------------------------------------------------------- the file
    def _load(self) -> dict:
        st = {"claude": False, "model": "sonnet", "cap": 16, "meetings": [], "alerts": [], "seen": {}, "acks": {}, "trades": []}
        try:
            st.update(json.loads((DIR / "state.json").read_text("utf-8")))
        except (OSError, ValueError):
            pass
        for m in st["meetings"]:   # a meeting cut by a restart
            if m.get("status") == "running":
                m["status"] = "failed"
                m["error"] = "o Hub reiniciou a meio"
        return st

    def save(self):
        DIR.mkdir(parents=True, exist_ok=True)
        cut = time.time() - 3 * 86400
        self.state["seen"] = {k: v for k, v in self.state["seen"].items() if v > cut}
        self.state["meetings"] = self.state["meetings"][:40]
        self.state["alerts"] = self.state["alerts"][:30]
        tmp = DIR / "state.json.tmp"
        tmp.write_text(json.dumps(self.state, ensure_ascii=False), "utf-8")
        os.replace(tmp, DIR / "state.json")

    # ---------------------------------------------------------------- the numbers
    async def refresh(self, force: bool = False):
        now = datetime.now(UTC)
        ids = [i["id"] for i in INSTRUMENTS + CONTEXT]
        closed = [i["id"] for i in INSTRUMENTS + CONTEXT if not sessions.market_open(now, bool(i.get("crypto")))]
        # a closed market is read once every quarter of an hour
        ids = [i for i in ids if i not in closed or force or time.time() - self.store.at.get((i, "M15"), 0) > 900]
        await self.store.refresh(ids, force)
        near = any(e["imp"] >= 3 and e["actual"] is None and abs((_parse(e["t"]) - now).total_seconds()) < 20 * 60 for e in self.calendar if e["t"])
        async with httpx.AsyncClient(headers=UA) as client:
            if force or time.time() - self.cal_at > (60 if near else 300):
                cal = await calendar(client, now)
                if cal:
                    self.calendar, self.cal_at = cal, time.time()
            if force or time.time() - self.news_at > 240:
                news = await headlines(client)
                if news:
                    self.news, self.news_at = news, time.time()
        try:   # history of the US release in play (page + briefing); Binance only after a release
            await asyncio.to_thread(reaction.refresh, self.calendar, now)   # reaction is synchronous; keep Binance off the loop
        except Exception:
            log.exception("reaction")
        view = {}
        for inst in INSTRUMENTS:
            try:
                a = analyse(inst, self.store, self.calendar, now)
            except Exception:
                log.exception("trading room: reading %s", inst["id"])
                a = None
            if a:
                view[inst["id"]] = a
        self.view = view
        ctx = []
        for c in CONTEXT:
            d1, m15 = self.store.get(c["id"], "D1"), self.store.get(c["id"], "M15")
            if not (m15 or d1):
                continue
            price = (m15 or d1)[-1][4]
            closed_d, live_d = split_live(d1, "D1", now.timestamp())
            prev = (closed_d[-1][4] if live_d else closed_d[-2][4] if len(closed_d) > 1 else None) if closed_d else None
            ctx.append({"id": c["id"], "name": c["name"], "dp": c["dp"], "price": price, "chg": (price / prev - 1) * 100 if prev else None})
        self.context = ctx
        try:
            await self.inst.refresh_cot()
            self.macro = drivers(self.store)
        except Exception:
            log.exception("trading room: the institutional layer")
        self.updated = time.time()

    def room(self) -> dict:
        last = next((m["at"] for m in self.state["meetings"] if m["status"] == "done" and m["mode"] == "claude"), None)
        return {"instruments": list(self.view.values()), "context": self.context, "calendar": self.calendar, "news": self.news,
                "macro": self.macro, "cot": self.inst.cot, "journals": {a: self.book.journal(a, self.view, last) for a in ("penguin", "twoface")}}

    # ---------------------------------------------------------------- when to meet
    def triggers(self, now: datetime) -> list[dict]:
        seen, out, ts = self.state["seen"], [], time.time()
        for a in self.view.values():
            for e in a["events"]:
                if e["key"] in seen:
                    continue
                seen[e["key"]] = ts
                if e["w"] >= 4 and not self.first and ts - e["t"] < 3600:
                    out.append({"p": e["w"], "reason": e["text"], "focus": [a["id"]], "kind": e["kind"]})
        for e in self.calendar:
            if e["imp"] < 3 or e["ccy"] not in ("USD", "EUR", "GBP") or not e["t"]:
                continue
            mins = (_parse(e["t"]) - now).total_seconds() / 60
            hit = [a["id"] for a in sorted(self.view.values(), key=lambda a: -max([x["w"] for x in a["events"]] or [0])) if e["ccy"] in a["ccy"]][:3]
            if 12 <= mins <= 25 and f"pre:{e['id']}" not in seen:
                seen[f"pre:{e['id']}"] = ts
                out.append({"p": 5, "reason": f"Daqui a {int(mins)} min sai {e['pt'] or e['title']} ({e['ccy']}), notícia de alto impacto.", "focus": hit, "kind": "news"})
            if e["actual"] is not None and -15 <= mins <= -1 and f"post:{e['id']}" not in seen:
                seen[f"post:{e['id']}"] = ts
                out.append({"p": 6, "reason": f"Saiu {e['pt'] or e['title']} ({e['ccy']}): {e['actual']}{e['unit']} contra {e['forecast'] if e['forecast'] is not None else '—'}{e['unit']} previsto (anterior {e['previous']}{e['unit']}).",
                            "focus": hit, "kind": "news"})
        if now.weekday() < 5:
            lo, n = sessions.london(now), sessions.ny(now)
            for key, local, name in (("london", lo, "Antes da abertura de Londres"), ("ny", n, "Antes da killzone de Nova Iorque")):
                k = f"sched:{key}:{local:%Y-%m-%d}"
                if (local.hour == 6 and local.minute >= 40 or local.hour == 7 and local.minute < 10) and k not in seen:
                    seen[k] = ts
                    out.append({"p": 3, "reason": f"{name}: o que vigiar nesta sessão.", "focus": [], "kind": "schedule"})
        self.first = False
        return sorted(out, key=lambda x: -x["p"])

    def today_count(self) -> int:
        day = datetime.now(UTC).date().isoformat()
        return sum(1 for m in self.state["meetings"] if m["mode"] == "claude" and m["at"][:10] == day)

    def wait_for(self, kind: str) -> float:
        """Seconds until the next meeting may start (0 now)."""
        last = next((m for m in self.state["meetings"] if m["status"] != "failed"), None)
        if not last:
            return 0
        gap = (8 if kind in ("news", "manual") else 20) if self.state["claude"] else (3 if kind in ("news", "manual") else 10)
        since = (datetime.now(UTC) - _parse(last.get("ended") or last["at"])).total_seconds()
        return max(0.0, gap * 60 - since)

    def running(self) -> dict | None:
        return self.state["meetings"][0] if self.state["meetings"] and self.state["meetings"][0]["status"] == "running" else None

    # ---------------------------------------------------------------- the meeting
    def start(self, reason: str, focus: list[str], kind: str, by: str | None = None) -> dict | None:
        if self.running() or (self.task and not self.task.done()):
            return None
        claude = bool(self.state["claude"]) and self.today_count() < int(self.state["cap"]) and council.claude_exe() is not None
        rec = {"id": int(time.time() * 1000), "at": iso(), "reason": reason, "focus": focus, "kind": kind, "by": by,
               "mode": "claude" if claude else "auto", "model": self.state["model"] if claude else None, "status": "running", "turns": [], "verdict": None, "cost": 0}
        self.state["meetings"].insert(0, rec)
        self.save()
        self.task = asyncio.create_task(self._run(rec))
        return rec

    async def _run(self, rec: dict):
        async def said(who: str, text: str, data: dict | None = None):
            turn = {"who": who, "text": text, "at": iso()}
            if data:
                now_ = datetime.now(UTC)
                self.book.review(who, data.get("revisoes"))
                closed = self.book.close_now(who, data.get("fechar"), self.view, now_)
                booked = self.book.propose(who, data.get("trades"), rec["id"], self.view, now_)
                turn["trades"] = [t["id"] for t in booked]
                turn["closed"] = [t["id"] for t in closed]
                srcs = [x for x in (data.get("fontes") or []) if isinstance(x, dict) and str(x.get("url", "")).startswith("http")]
                if srcs:
                    turn["sources"] = [{"title": str(x.get("titulo") or x.get("title") or x["url"])[:140], "url": x["url"]} for x in srcs[:6]]
            rec["turns"].append(turn)
            self.save()
            await publish()
        await publish()
        now = datetime.now(UTC)
        room = self.room()
        try:
            if rec["mode"] == "claude":
                try:
                    _, verdict, cost = await council.claude_meeting(room, now, rec["reason"], rec["focus"], rec["model"], DIR / "claude", said)
                    rec["cost"] = round(cost, 4)
                except Exception as exc:
                    log.info("trading room: Claude meeting failed (%s), writing it from the numbers", exc)
                    rec["error"], rec["mode"], rec["turns"] = f"Claude: {exc}", "auto", []
            if rec["mode"] == "auto":
                turns, verdict = council.auto_meeting(room, now, rec["reason"], rec["focus"])
                for who, text in zip(("penguin", "twoface", "penguin"), turns):
                    await asyncio.sleep(5)
                    await said(who, text)
            rec["verdict"], rec["status"], rec["ended"] = verdict, "done", iso()
            if verdict.get("alerta") and self.may_alert(verdict):
                await self.alert(rec, verdict)
        except Exception as exc:
            log.exception("trading room: meeting")
            rec["status"], rec["error"], rec["ended"] = "failed", str(exc)[:300], iso()
        self.save()
        await publish()

    async def alert(self, rec: dict, v: dict, test: bool = False):
        f = (v.get("foco") or [{}])[0]
        a = {"id": rec["id"], "at": iso(), "level": v["importancia"], "title": v.get("titulo") or "Mensagem da Sala de Trading", "body": v.get("resumo") or "",
             "focus": v.get("foco") or [], "attention": v.get("atencao") or [], "symbol": f.get("simbolo"), "dir": f.get("direcao"),
             "turns": rec.get("turns", [])[-3:], "mode": rec.get("mode"), "reason": rec.get("reason"), "test": test,
             "until": iso(datetime.now(UTC) + timedelta(minutes=10 if test else 90))}
        self.state["alerts"].insert(0, a)
        self.save()
        if not test:
            await phones(f"Sala de Trading: {a['title']}", a["body"])
        await publish()
        return a

    def may_alert(self, v: dict) -> bool:
        """Not the same instrument twice in 90 minutes, nor any two alerts within 20 (a 5 always goes through)."""
        now = datetime.now(UTC)
        sym = ((v.get("foco") or [{}])[0] or {}).get("simbolo")
        for a in self.state["alerts"]:
            if a.get("test"):
                continue
            age = (now - _parse(a["at"])).total_seconds() / 60
            if age < 90 and sym and a.get("symbol") == sym:
                return False
            if age < 20 and v.get("importancia", 0) < 5:
                return False
        return True

    def alert_for(self, username: str) -> dict | None:
        acks = set(self.state["acks"].get(username, []))
        now = datetime.now(UTC)
        return next((a for a in self.state["alerts"] if a["id"] not in acks and _parse(a["until"]) > now), None)

    def ack(self, username: str, alert_id: int):
        acks = self.state["acks"].setdefault(username, [])
        if alert_id not in acks:
            acks.append(alert_id)
            self.state["acks"][username] = acks[-60:]
            self.save()

    # ---------------------------------------------------------------- one turn of the loop
    async def tick(self):
        await self.refresh()
        now = datetime.now(UTC)
        changed = self.book.update(self.store, now)
        for a in self.view.values():
            for st in a.get("ideas", a["setups"]):
                for agent in takers(st):
                    key = f"{agent}:{a['id']}:{st['key']}"
                    if st["grade"] in ("A+", "A") and st["status"] == "armed" and st["age"] <= 3 and key not in self.state["seen"]:
                        self.state["seen"][key] = time.time()
                        self.book.propose(agent, [model_trade(a, st, now)], None, self.view, now, key)
                        changed = True
        if changed:
            self.save()
            await publish()
        found = self.triggers(now)
        if found:
            top = found[0]
            extra = [t["reason"] for t in found[1:3]]
            focus = list(dict.fromkeys(f for t in found[:3] for f in t["focus"]))[:3]
            self.pending = {**top, "reason": top["reason"] + (" Também: " + " ".join(extra) if extra else ""), "focus": focus, "at": time.time()}
            self.save()
        if self.pending and time.time() - self.pending["at"] > 30 * 60:
            self.pending = None
        if self.pending and not self.running() and self.wait_for(self.pending["kind"]) <= 0:
            p, self.pending = self.pending, None
            self.start(p["reason"], p["focus"], p["kind"])
        if time.time() - self.published > 55:
            await publish()

    # ---------------------------------------------------------------- what the cave draws
    def pulse(self) -> dict:
        wall = []
        now = time.time()
        for i in WALL:
            a = self.view.get(i)
            rows = self.store.get(i, "M15")[-26:]
            if not a or not rows:
                continue
            lo, hi = min(r[3] for r in rows), max(r[2] for r in rows)
            span = (hi - lo) or 1
            norm = lambda v: round((v - lo) / span, 3)
            gap = next((p for p in a["pois"] if p["type"] == "FVG"), None)
            wall.append({"id": i, "dp": a["dp"], "price": a["price"], "chg": a["chg"], "bias": a["bias"]["dir"],
                         "c": [[norm(r[1]), norm(r[2]), norm(r[3]), norm(r[4])] for r in rows],
                         "up": norm(a["above"][0]["p"]) if a["above"] else None, "down": norm(a["below"][0]["p"]) if a["below"] else None,
                         "gap": [norm(gap["bot"]), norm(gap["top"]), gap["dir"]] if gap else None,
                         "setup": a["setups"][0]["grade"] if a["setups"] else None})
        m = self.state["meetings"][0] if self.state["meetings"] else None
        meeting = None
        if m:
            meeting = {"id": m["id"], "status": m["status"], "mode": m["mode"], "at": m["at"], "ended": m.get("ended"), "turns": [{"who": t["who"], "text": t["text"]} for t in m["turns"]],
                       "title": (m.get("verdict") or {}).get("titulo"), "level": (m.get("verdict") or {}).get("importancia")}
        live_alert = next((a for a in self.state["alerts"] if _parse(a["until"]).timestamp() > now), None)
        return {"wall": wall, "meeting": meeting, "alert": live_alert and {"id": live_alert["id"], "level": live_alert["level"], "title": live_alert["title"]},
                "ticker": [{"id": a["id"], "price": a["price"], "chg": a["chg"], "dp": a["dp"]} for a in self.view.values()]
                + [{"id": c["id"], "price": c["price"], "chg": c["chg"], "dp": c["dp"]} for c in self.context],
                "score": {a: {k: v for k, v in self.book.stats(a).items() if k in ("wins", "losses", "total_r", "open", "winrate")} for a in ("penguin", "twoface")},
                "news": reaction.pulse(), "updated": self.updated}


ROOM = Room()


async def publish():
    from ..realtime import rt
    ROOM.published = time.time()
    try:
        await rt.publish("trading", 0, "team")
    except Exception:
        log.exception("trading room: publish")


async def phones(title: str, body: str):
    """The big alert goes to every phone subscribed on this Hub."""
    try:
        from sqlalchemy import select

        from .. import webpush
        from ..db import SessionLocal
        from ..models import User
        async with SessionLocal() as db:
            ids = (await db.execute(select(User.id))).scalars().all()
            await webpush.to_people(db, ids, title, body, "#/trading")
    except Exception:
        log.exception("trading room: phones")


async def loop():
    await asyncio.sleep(8)   # let the Hub finish starting
    while True:
        started = time.time()
        try:
            await ROOM.tick()
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("trading room tick")
        await asyncio.sleep(max(5.0, 20 - (time.time() - started)))


KIND_NAME = {"vwap": "VWAP + EMA ", "ib": "inside bar D1 ", "ema": "EMA 125/200 "}


def takers(st: dict) -> list[str]:
    """The accounts of the book that take this setup: the Modelo (SMC, VWAP + EMA and the D1 inside bar, as always), one
    account per strategy (EMA 125/200, VWAP + EMA), and the Combinado, only when the EMA 125/200 of H1, the VWAP of M15
    and the H4 structure all point the setup's way."""
    kind = st.get("kind")
    out = ["model"] if kind in ("smc", "vwap", "ib") else []
    if kind in ("ema", "vwap"):
        out.append(kind)
    if kind in ("smc", "vwap", "ema") and len(st.get("agree") or []) == 3:
        out.append("combo")
    return out


def model_trade(a: dict, st: dict, now: datetime) -> dict:
    """The order the model places for one armed setup, SMC, VWAP + EMA or the D1 inside bar (the live room and the backtest
    place the same one)."""
    dp = a["dp"]
    return {"simbolo": a["id"], "direcao": "compra" if st["dir"] == "buy" else "venda", "entrada": round(st["entry"], dp),
            "stop": round(st["stop"], dp), "alvos": [round(x["p"], dp) for x in st["targets"]], "validade_h": st.get("valid_h") or 6, "grade": st["grade"],
            "porque": f"Setup {KIND_NAME.get(st.get('kind'), '')}{st['grade']} ({st['score']}/100) em {st['tf']}: " + "; ".join(st["why"]),
            "zona": st["zone"], "invalida": round(st["stop"], dp), "janela": "" if st.get("swing") else next_killzone(now),
            "ordem": st.get("order") or "limite", "swing": bool(st.get("swing")), "max_h": st.get("max_h"),
            "gatilho": st.get("trigger") or "o preço voltar à zona (ordem limite no meio dela)",
            "plano": st.get("plan") or f"Depois do sweep do {st['sweep']['label']} e do {st['brk']['kind']} de {'baixa' if st['dir'] == 'sell' else 'alta'} em {st['tf']}, "
            f"esperamos que o preço {'suba' if st['dir'] == 'sell' else 'desça'} de volta à zona {st['zone'][0]:.{dp}f}–{st['zone'][1]:.{dp}f} "
            f"e daí {'caia' if st['dir'] == 'sell' else 'suba'} até {st['targets'][0]['label'] if st['targets'] else 'o alvo'}."}


def next_killzone(now: datetime) -> str:
    """The next London or New York AM killzone (or the one on now), as Lisbon "HH:MM-HH:MM"."""
    for day in (now, now + timedelta(days=1)):
        for k in sessions.killzones_local(day, council.lisbon):
            if k["key"] in ("london", "ny") and datetime.fromisoformat(k["end"]) > now:
                return f"{k['from']}-{k['to']}"
    return ""
