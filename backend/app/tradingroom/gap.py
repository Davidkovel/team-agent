"""Gap da manhã (#/gap): the gaps on the quotes of the FundedNext MT5 account, sent to the team every day.

David (20 Oct): every morning (around 08:00) GER30 at FundedNext opens with a gap that the room's own feed (OANDA DE30)
does not show, because the gap belongs to the broker's quote. It is the DAX cash gap: the cash index (TradingView TVC:DEU40,
on every PC, no MT5) trades 09:00-17:30 Frankfurt and opens each morning away from yesterday's close. The instruments of
the MT5 account of this PC (the Escritório de Robôs' accounts, robots.OFFICE), when there is one, are read from their M1
bars there. Either way the Hub finds where a bar opens away from the
close of the bar before: after a pause in the quotes (the broker's session break), or a jump far bigger than the usual
bar-to-bar step. Each Hub tells its own person (bell, phone) about each new gap once, with the close it would fill back to; when the price
gets back there, a second note says the gap is closed and how long it took. The history gives the fill rate per instrument.

State is a JSON file next to the room's, nothing here goes by sync. All synchronous, on the MT5 thread (mt5.run): the async
loop crosses that boundary once per pass."""
from __future__ import annotations

import json
import logging
import os
import statistics as st
import time
from datetime import datetime

from . import mt5
from .room import DIR

log = logging.getLogger("tradingroom.gap")
FILE = DIR / "gap.json"
SRC = {"mt5": "FundedNext", "tv": "Xetra"}
SYMS = ["DAX", "GER40", "NAS100", "US30", "XAUUSD", "EURUSD", "GBPUSD"]
# read from TradingView, not MT5, so every PC has them: {ours: (TradingView symbol, name, digits)}. TVC:DEU40 is the DAX
# cash index in real time (XETR:DAX is 15 min late): it trades 09:00-17:30 Frankfurt, so every morning at 09:00 it opens
# away from yesterday's close, the same gap GER30 shows at FundedNext.
TV = {"DAX": ("TVC:DEU40", "DAX (Xetra)", 2)}
DEFAULTS = {"on": True, "account": "", "symbols": ["DAX", "GER40", "NAS100", "US30", "XAUUSD"], "min_pct": 0.05, "main": "DAX"}
HOLE = 10 * 60      # a pause this long in the M1 bars is a session break
JUMP = 6            # or a bar-to-bar step this many times the usual big one (95th percentile)
FRESH = 30 * 60     # a gap older than this when first seen goes to the history without a note
KEEP = 120          # records kept


# ---------------------------------------------------------------- pure parts
def find_gaps(bars: list, min_pct: float) -> list[dict]:
    """Gaps in (t, o, h, l, c) M1 bars: where a bar opens at least `min_pct` % away from the close before it, after a
    pause of HOLE or with a step JUMP times the usual big step. i is the index of the bar that opens the gap."""
    steps = [abs(bars[i][1] - bars[i - 1][4]) for i in range(1, len(bars)) if bars[i][0] - bars[i - 1][0] < HOLE]
    big = st.quantiles(steps, n=20)[-1] if len(steps) >= 40 else 0.0
    out = []
    for i in range(1, len(bars)):
        prev, bar = bars[i - 1][4], bars[i][1]
        d = bar - prev
        if not prev or abs(d) / prev * 100 < min_pct:
            continue
        pause = bars[i][0] - bars[i - 1][0] >= HOLE
        if pause or (big and abs(d) >= JUMP * big):
            out.append({"i": i, "t": bars[i][0], "prev": prev, "open": bar, "pts": d, "pct": d / prev * 100,
                        "dir": "up" if d > 0 else "down", "kind": "pausa" if pause else "salto", "after": bars[i][0] - bars[i - 1][0]})
    return out


def fill(bars: list, g: dict) -> dict:
    """From the gap's bar to the end of its session (the next pause): when the price got back to the close before the gap
    (filled), how far it ran away first, and how much of the gap is still open (0 = filled)."""
    up = g["dir"] == "up"
    away, left = 0.0, abs(g["pts"])
    for k in range(g["i"], len(bars)):
        t, _o, h, l, c = bars[k]
        if k > g["i"] and t - bars[k - 1][0] >= HOLE:
            break
        away = max(away, (h - g["open"]) if up else (g["open"] - l))
        if (l <= g["prev"]) if up else (h >= g["prev"]):
            return {"filled": t, "away": away, "left": 0.0}
        left = (c - g["prev"]) if up else (g["prev"] - c)
    return {"filled": None, "away": away, "left": max(left, 0.0)}


def spark(bars: list, i: int, before: int = 40, after: int = 240, points: int = 90) -> list:
    """The price around the gap for the page's chart: [t, high, low, close] of groups of M1 bars, never mixing the bars
    before the gap with the ones after it."""
    k = max(1, -(-(min(before, i) + min(after, len(bars) - i)) // points))
    out = []
    for part in (bars[max(0, i - before):i], bars[i:i + after]):
        for j in range(0, len(part), k):
            g = part[j:j + k]
            out.append([g[0][0], max(x[2] for x in g), min(x[3] for x in g), g[-1][4]])
    return out


def stats(days: list, sym: str, n: int = 20) -> dict:
    """Of the last n gaps of an instrument: how many filled, and in how many minutes on average."""
    gs = [d for d in days if d["symbol"] == sym][:n]
    done = [d for d in gs if d.get("filled")]
    mins = [(d["filled"] - d["t"]) / 60 for d in done]
    return {"n": len(gs), "filled": len(done), "rate": round(len(done) / len(gs) * 100) if gs else None,
            "mins": round(st.median(mins)) if mins else None, "avg_pct": round(st.mean(abs(d["pct"]) for d in gs), 3) if gs else None}


def hm(ts: float) -> str:
    return datetime.fromtimestamp(ts).strftime("%H:%M")


def fmt(v: float, digits: int) -> str:
    return f"{v:,.{digits}f}".replace(",", " ")


# ---------------------------------------------------------------- the watch
class Watch:
    def __init__(self, office=None):
        self.office = office
        self.state = {"cfg": dict(DEFAULTS), "days": [], "offset": 0}
        try:
            self.state.update(json.loads(FILE.read_text("utf-8")))
        except (OSError, ValueError):
            pass
        self.state["cfg"] = {**DEFAULTS, **self.state["cfg"]}
        self.live: dict = {}
        self.ticks: dict = {}
        self.error = ""
        self.at = 0.0
        self.outbox: list[tuple] = []   # (severity, title, body) for the async loop to send

    def _office(self):
        if self.office is None:
            from .robots import OFFICE
            self.office = OFFICE
        return self.office

    def save(self):
        DIR.mkdir(parents=True, exist_ok=True)
        tmp = FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.state, ensure_ascii=False), "utf-8")
        os.replace(tmp, FILE)

    def accounts(self) -> list[dict]:
        return [{"id": a["id"], "name": a.get("name") or a["id"]} for a in self._office().state["accounts"] if a.get("link", "mt5") == "mt5"]

    def account(self) -> dict | None:
        c = self.state["cfg"]
        acc = self._office().account(c["account"]) if c["account"] else None
        if acc is None and self.accounts():
            acc = self._office().account(self.accounts()[0]["id"])
        return acc

    def set_cfg(self, body: dict) -> dict:
        c = self.state["cfg"]
        if "min_pct" in body and body["min_pct"] not in (None, ""):
            v = float(body["min_pct"])
            if not 0.005 <= v <= 2:
                raise ValueError("O gap mínimo vai de 0,005% a 2%.")
            c["min_pct"] = v
        if "symbols" in body:
            syms = [s for s in body["symbols"] if s in SYMS]
            if not syms:
                raise ValueError("Escolhe pelo menos um instrumento.")
            c["symbols"] = syms
        if "main" in body and body["main"] in SYMS:
            c["main"] = body["main"]
        if "account" in body:
            if body["account"] and not self._office().account(body["account"]):
                raise ValueError("Conta desconhecida neste PC.")
            c["account"] = body["account"]
        if "on" in body:
            c["on"] = bool(body["on"])
        self.save()
        return c

    # -------------------------------------------------------------- the pass (MT5 thread)
    def step(self):
        acc = self.account()
        wanted = [s for s in self.state["cfg"]["symbols"] if s not in TV]
        if not acc:
            for ours in wanted:
                self.live[ours] = {"ok": False, "error": "a conta MT5 está noutro PC"}
            self.error = ""
            return
        err = mt5.login(self._office().full(acc))
        if err:
            self.error = err
            return
        m = mt5.lib()
        self.error, self.at, now = "", time.time(), time.time()
        c, changed = self.state["cfg"], False
        read = {}
        for ours in wanted:
            name = mt5.symbol(acc, ours)
            if not name or not m.symbol_select(name, True):
                self.live[ours] = {"ok": False, "error": "a conta não tem este instrumento"}
                continue
            r = m.copy_rates_from_pos(name, m.TIMEFRAME_M1, 0, 3000)
            s, tick = m.symbol_info(name), m.symbol_info_tick(name)
            if r is None or not len(r) or not s:
                self.live[ours] = {"ok": False, "error": "sem barras"}
                continue
            read[ours] = (name, s.digits, tick, [(int(x["time"]), x["open"], x["high"], x["low"], x["close"]) for x in r])
        offs = []   # the broker's clock vs UTC (bar times are server time), from a quote that just came in
        for ours, (_n, _d, tick, _b) in read.items():
            if not tick:
                continue
            moved = self.ticks.get(ours) not in (None, tick.time)
            self.ticks[ours] = tick.time
            off = round((tick.time - now) / 1800) * 1800
            if abs(tick.time - now - off) < 90 and (moved or not self.state.get("offset_known")):
                offs.append(off)
        if offs:
            off = max(set(offs), key=offs.count)
            changed |= off != self.state["offset"] or not self.state.get("offset_known")
            self.state.update(offset=off, offset_known=True)
        if not self.state.get("offset_known"):
            self.error = "À espera de uma cotação ao vivo para acertar o relógio do servidor."
            return
        off = self.state["offset"]
        for ours, (name, digits, tick, bars) in read.items():
            changed |= self.ingest(ours, name, digits, [(t - off, o, h, l, cl) for t, o, h, l, cl in bars], "mt5", now)
        self.tidy(changed)

    def tv_pass(self, rows: dict):
        """The TradingView instruments: rows = {ours: [(t, o, h, l, c, v), ...]} in UTC."""
        now, changed = time.time(), False
        for ours, (_sym, name, digits) in TV.items():
            if ours not in self.state["cfg"]["symbols"]:
                continue
            bars = [r[:5] for r in rows.get(ours) or []]
            if len(bars) < 50:
                self.live[ours] = {"ok": False, "error": "o TradingView não respondeu"}
                continue
            changed |= self.ingest(ours, name, digits, bars, "tv", now)
        self.tidy(changed)

    def ingest(self, ours: str, name: str, digits: int, bars: list, src: str, now: float) -> bool:
        """Finds the gaps of one instrument in its bars (UTC), records the new ones and follows their fill."""
        changed = False
        self.live[ours] = {"ok": True, "symbol": name, "digits": digits, "price": bars[-1][4], "at": bars[-1][0], "src": SRC[src]}
        for g in find_gaps(bars, self.state["cfg"]["min_pct"]):
            key = f"{ours}:{g['t']}"
            rec = next((d for d in self.state["days"] if d["key"] == key), None)
            f = fill(bars, g)
            if rec is None:
                rec = {"key": key, "symbol": ours, "name": name, "src": SRC[src], "digits": digits, "t": g["t"], "prev": g["prev"],
                       "open": g["open"], "pts": round(g["pts"], digits), "pct": round(g["pct"], 3), "dir": g["dir"], "kind": g["kind"],
                       "after": g["after"], "filled": f["filled"], "told": now - g["t"] < FRESH}
                rec["told_fill"] = bool(f["filled"]) and not rec["told"]
                self.state["days"].append(rec)
                if rec["told"]:
                    self.outbox.append(("medium", *self.note_open(rec)))
            if rec.get("final"):
                continue
            rec.update(away=round(f["away"], digits), left=round(f["left"], digits), spark=spark(bars, g["i"]))
            if f["filled"] and not rec.get("filled"):
                rec["filled"] = f["filled"]
            if rec["filled"] and not rec.get("told_fill"):
                rec["told_fill"] = True
                self.outbox.append(("low", *self.note_fill(rec)))
            if now - rec["t"] > 18 * 3600 or rec["filled"] and now - rec["filled"] > 4 * 3600:
                rec["final"] = True   # the chart stays as it was
            changed = True
        return changed

    def tidy(self, changed: bool):
        self.state["days"].sort(key=lambda d: -d["t"])
        del self.state["days"][KEEP:]
        for d in self.state["days"][40:]:
            d.pop("spark", None)
        if changed:
            self.save()

    def note_open(self, r: dict) -> tuple[str, str]:
        arrow, word = ("▲", "para cima") if r["dir"] == "up" else ("▼", "para baixo")
        s = stats([d for d in self.state["days"] if d is not r], r["symbol"])
        hist = f" Nos últimos {s['n']} gaps de {r['symbol']} fechou {s['filled']} ({s['rate']}%)." if s["n"] >= 3 else ""
        return (f"Gap {r['name']} {arrow} {'+' if r['pts'] > 0 else ''}{fmt(r['pts'], r['digits'])} ({r['pct']:+.2f}%)",
                f"{r.get('src', 'FundedNext')}, {hm(r['t'])}: gap {word}. Fecho anterior {fmt(r['prev'], r['digits'])} → abertura {fmt(r['open'], r['digits'])}. "
                f"O gap fecha se o preço voltar a {fmt(r['prev'], r['digits'])}.{hist}")

    def note_fill(self, r: dict) -> tuple[str, str]:
        mins = round((r["filled"] - r["t"]) / 60)
        return (f"Gap {r['name']} fechado em {mins} min",
                f"Às {hm(r['filled'])} o preço voltou a {fmt(r['prev'], r['digits'])} (gap de {fmt(abs(r['pts']), r['digits'])}, {abs(r['pct']):.2f}%). "
                f"Antes de fechar afastou-se {fmt(r.get('away') or 0, r['digits'])}.")

    def out(self) -> dict:
        c, days = self.state["cfg"], self.state["days"]
        today = [d for d in days if time.time() - d["t"] < 20 * 3600]
        return {"cfg": c, "symbols": SYMS, "accounts": self.accounts(), "account": (self.account() or {}).get("id", ""), "error": self.error,
                "at": self.at, "live": self.live, "today": today, "history": [{k: v for k, v in d.items() if k != "spark"} for d in days[:60]],
                "stats": {s: stats(days, s) for s in c["symbols"]}, "mt5": mt5.installed()}


WATCH = Watch()


async def send(items: list[tuple]):
    """The notes go to this PC's own person (bell, widget, phone): every Hub watches the same DAX, so each tells only its
    own person and nobody gets it three times by sync. A Hub outside the team's network tells everyone on it."""
    from sqlalchemy import select

    from .. import sync
    from ..db import SessionLocal
    from ..models import User
    from ..services import notify
    me = sync.whoami()
    async with SessionLocal() as db:
        q = select(User.id).where(User.username == me[1]) if me else select(User.id)
        ids = (await db.execute(q)).scalars().all() or (await db.execute(select(User.id))).scalars().all()
        for severity, title, body in items:
            await notify(db, ids, "gap", severity, title, body, "#/gap")


async def loop():
    """Every 30 s: the TradingView instruments on every PC, the MT5 ones where there is an account."""
    import asyncio

    from .markets import tv_candles
    await asyncio.sleep(30)
    while True:
        try:
            c = WATCH.state["cfg"]
            if c["on"]:
                tv = [s for s in TV if s in c["symbols"]]
                if tv:
                    got = await tv_candles([(TV[s][0], "M5") for s in tv], bars={"M5": 400})
                    WATCH.tv_pass({s: got.get((TV[s][0], "M5")) for s in tv})
                if any(s not in TV for s in c["symbols"]):
                    await asyncio.wrap_future(mt5.run(WATCH.step))
                WATCH.at = time.time()
                items, WATCH.outbox = WATCH.outbox, []
                if items:
                    await send(items)
            await asyncio.sleep(30)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("gap step")
            await asyncio.sleep(30)
