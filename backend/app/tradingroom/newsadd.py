"""Reforço na notícia (#/reforco, a tab of the Sala de Trading): on a US release the trader opens the main position by
hand in MT5 (1.5% of the allocation at risk), and the Hub adds to it by itself.

The idea (Kovel, 18 Oct): after the news the price first runs a little against the trade (a sell goes up a bit, then
straight down). So once his position is open, the Hub lays a ladder of limit orders in the same direction between the
price and the VWAP band on the far side (above the upper band for a sell, below the lower band for a buy), each step a
little further and a bigger lot: the risk is the same on every step, so the closer to the stop the more volume. The whole
ladder risks `add_pct` (0.5%) of the allocation to that stop. Take-profit from the release's statistics (how far gold went
in the first hour, reaction_data/), else a fixed 0.5% from his entry. His own position is never touched.

Runs on the PC where the MT5 account is (the Escritório de Robôs' accounts, robots.OFFICE): one Start per release. Waits
for his manual position (magic 0) on the symbol, places the ladder once, cancels what did not fill when his position
closes, on Stop or after `window` minutes. Filled steps keep their own stop and TP. All synchronous, on the MT5 thread
(mt5.run): the async loop crosses that boundary once per step."""
from __future__ import annotations

import json
import logging
import math
import os
import statistics as st
import time
from datetime import datetime, timezone

from . import mt5, reaction
from .room import DIR
from .vwap import anchor

log = logging.getLogger("tradingroom.newsadd")
UTC = timezone.utc
FILE = DIR / "reforco.json"
MAGIC = 7700   # the ladder's orders and positions (the robots use their own)
SYMS = ["XAUUSD", "EURUSD", "GBPUSD", "GER40"]
STAT_SYM = {"XAUUSD": "GOLD", "EURUSD": "EURUSD", "GBPUSD": "GBPUSD", "GER40": "GER40"}
DEFAULTS = {"account": "", "symbol": "XAUUSD", "alloc": 50_000.0, "main_pct": 1.5, "add_pct": 0.5, "levels": 5,
            "band": 1, "buffer_pct": 0.03, "tp_auto": True, "tp_pct": 0.5, "window": 60, "tf": 15}


# ---------------------------------------------------------------- pure parts
def bands(bars: list, since: float, tf: int = 15) -> dict | None:
    """Session VWAP and its σ as TradingView draws them on a `tf`-minute chart (his gold chart is 15m): the hlc3 of each
    tf bar weighted by its volume, from (t, o, h, l, c, v) 1-minute bars at or after `since`; the last bar as it stands."""
    groups: dict = {}
    for t, _o, h, l, c, v in bars:
        if t >= since:
            groups.setdefault(int(t // (tf * 60)) if tf else t, []).append((h, l, c, v or 1.0))
    if len(groups) < 2:
        return None
    sv = spv = sp2v = 0.0
    for g in groups.values():
        p = (max(x[0] for x in g) + min(x[1] for x in g) + g[-1][2]) / 3
        v = sum(x[3] for x in g)
        sv += v
        spv += p * v
        sp2v += p * p * v
    vw = spv / sv
    return {"vwap": vw, "sd": math.sqrt(max(sp2v / sv - vw * vw, 0.0)), "bars": len(groups)}


def stop_at(direction: str, price: float, b: dict, band: int, buffer_pct: float) -> tuple[float, int] | None:
    """The stop beyond the far band: the chosen σ, else the next one out if the price is already past it."""
    gap = price * 0.0005   # the stop must be at least 0.05% away from the price
    for k in sorted({int(band), 2, 3}):
        if k < band:
            continue
        if direction == "sell":
            s = b["vwap"] + k * b["sd"] + price * buffer_pct / 100
            if s > price + gap:
                return s, k
        else:
            s = b["vwap"] - k * b["sd"] - price * buffer_pct / 100
            if s < price - gap:
                return s, k
    return None


def ladder(direction: str, start: float, stop: float, money: float, n: int, spec: dict) -> list[dict]:
    """n limit orders between start and stop, the same risk on each, so the lots grow towards the stop.
    spec = {tick_size, tick_value, step, min, max, digits}."""
    n = max(1, int(n))
    dist = stop - start
    out, carry = [], 0.0
    for i in range(1, n + 1):
        price = start + dist * i / (n + 1)
        per_lot = abs(stop - price) / spec["tick_size"] * spec["tick_value"]
        if per_lot <= 0:
            continue
        budget = money / n + carry   # what a step could not use by the lot's rounding goes to the next one
        vol = min(int(budget / per_lot / spec["step"] + 1e-9) * spec["step"], spec["max"])
        if vol < spec["min"]:
            carry = budget
            continue
        carry = budget - vol * per_lot
        out.append({"n": i, "price": round(price, spec["digits"]), "volume": round(vol, 2), "risk": round(vol * per_lot, 2)})
    return out


def stat_tp(key: str | None, symbol: str, direction: str) -> float | None:
    """The take-profit in % from the release's history: the median of how far the price went the trade's way in the first
    hour, on the releases that moved that way in the first 5 minutes. None without data."""
    data = reaction.load(key) if key else None
    sym = STAT_SYM.get(symbol)
    if not data or not sym:
        return None
    moves = []
    for r in data["releases"]:
        m = r["m"].get(sym)
        if not m or m.get("move5") is None:
            continue
        if direction == "sell" and m["move5"] < 0 and m.get("low60") is not None:
            moves.append(-m["low60"])
        elif direction == "buy" and m["move5"] > 0:
            moves.append(max(m.get(k) or 0 for k in ("up5", "a10", "a25", "a55")))
    if len(moves) < 5:
        return None
    return round(min(1.5, max(0.15, st.median(moves))), 2)


# ---------------------------------------------------------------- the broker (MT5 on this PC; a fake in the tests)
class Broker:
    def __init__(self, acc: dict):
        self.acc = acc
        self.lib = mt5.lib()

    def login(self) -> str | None:
        return mt5.login(self.acc)

    def symbol(self, ours: str) -> str | None:
        name = mt5.symbol(self.acc, ours)
        return name if name and self.lib.symbol_select(name, True) else None

    def spec(self, name: str) -> dict | None:
        s = self.lib.symbol_info(name)
        if not s or not s.trade_tick_size or not s.trade_tick_value:
            return None
        return {"tick_size": s.trade_tick_size, "tick_value": s.trade_tick_value, "step": s.volume_step or .01,
                "min": s.volume_min, "max": s.volume_max, "digits": s.digits}

    def tick(self, name: str) -> dict | None:
        t = self.lib.symbol_info_tick(name)
        return {"bid": t.bid, "ask": t.ask, "time": t.time} if t and t.bid else None

    def bars(self, name: str) -> list:
        r = self.lib.copy_rates_from_pos(name, self.lib.TIMEFRAME_M1, 0, 1600)
        if r is None:
            return []
        return [(int(x["time"]), x["open"], x["high"], x["low"], x["close"], float(x["real_volume"] or x["tick_volume"])) for x in r]

    def positions(self, name: str) -> list[dict]:
        return [{"ticket": p.ticket, "dir": "buy" if p.type == 0 else "sell", "volume": p.volume, "price": p.price_open,
                 "sl": p.sl, "tp": p.tp, "pnl": round(p.profit + p.swap, 2), "magic": p.magic}
                for p in (self.lib.positions_get(symbol=name) or [])]

    def orders(self, name: str) -> list[dict]:
        return [{"ticket": o.ticket, "magic": o.magic} for o in (self.lib.orders_get(symbol=name) or [])]

    def limit(self, name: str, direction: str, volume: float, price: float, sl: float, tp: float, comment: str) -> dict:
        m = self.lib
        r = m.order_send({"action": m.TRADE_ACTION_PENDING, "symbol": name, "volume": volume, "price": price, "sl": sl, "tp": tp,
                          "type": m.ORDER_TYPE_SELL_LIMIT if direction == "sell" else m.ORDER_TYPE_BUY_LIMIT, "magic": MAGIC,
                          "comment": comment[:31], "deviation": 20, "type_time": m.ORDER_TIME_GTC, "type_filling": m.ORDER_FILLING_RETURN})
        if r is None:
            return {"ok": False, "error": f"order_send falhou ({m.last_error()[1]})."}
        if r.retcode not in (m.TRADE_RETCODE_DONE, m.TRADE_RETCODE_PLACED):
            return {"ok": False, "error": f"O MT5 recusou ({r.retcode}: {r.comment})."}
        return {"ok": True, "ticket": r.order}

    def cancel(self, ticket: int) -> dict:
        return mt5.cancel(self.acc, ticket)

    def close(self, ticket: int) -> dict:
        return mt5.close(self.acc, ticket)


# ---------------------------------------------------------------- the desk
class Desk:
    def __init__(self, office=None, broker=Broker):
        self.office = office
        self.broker = broker
        self.state = {"cfg": dict(DEFAULTS), "run": None, "done": [], "log": []}
        try:
            self.state.update(json.loads(FILE.read_text("utf-8")))
        except (OSError, ValueError):
            pass
        self.state["cfg"] = {**DEFAULTS, **self.state["cfg"]}
        self.market: dict = {}
        self.viewed = 0.0
        self.busy = False

    def _office(self):
        if self.office is None:
            from .robots import OFFICE
            self.office = OFFICE
        return self.office

    def save(self):
        DIR.mkdir(parents=True, exist_ok=True)
        tmp = FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.state, ensure_ascii=False, indent=1), "utf-8")
        os.replace(tmp, FILE)

    def note(self, text: str, kind: str = "info"):
        self.state["log"].insert(0, {"t": time.time(), "text": text, "kind": kind})
        del self.state["log"][80:]
        log.info("reforço: %s", text)

    def accounts(self) -> list[dict]:
        return [{"id": a["id"], "name": a.get("name") or a["id"]} for a in self._office().state["accounts"] if a.get("link", "mt5") == "mt5"]

    def set_cfg(self, body: dict) -> dict:
        c = self.state["cfg"]
        num = {"alloc": (1000, 10_000_000), "main_pct": (0.1, 5), "add_pct": (0.05, 3), "levels": (1, 12), "band": (1, 3),
               "buffer_pct": (0, 0.5), "tp_pct": (0.05, 5), "window": (5, 240), "tf": (1, 60)}
        for k, (lo, hi) in num.items():
            if k in body and body[k] not in (None, ""):
                v = float(body[k])
                if not lo <= v <= hi:
                    raise ValueError(f"{k} fora de {lo}–{hi}.")
                c[k] = int(v) if k in ("levels", "band", "window", "tf") else v
        if "symbol" in body:
            if body["symbol"] not in SYMS:
                raise ValueError("Instrumento desconhecido.")
            c["symbol"] = body["symbol"]
        if "account" in body:
            if body["account"] and not self._office().account(body["account"]):
                raise ValueError("Conta desconhecida neste PC.")
            c["account"] = body["account"]
        if "tp_auto" in body:
            c["tp_auto"] = bool(body["tp_auto"])
        self.save()
        return c

    def news(self) -> dict | None:
        """The release in play from the room (reaction.LAST), if it is within 2 h before / 4 h after now."""
        x = reaction.LAST
        if not x or not x.get("key") or not x.get("t"):
            return None
        dt = (reaction._parse(x["t"]) - datetime.now(UTC)).total_seconds()
        return x if -4 * 3600 <= dt <= 2 * 3600 else None

    # -------------------------------------------------------------- start / stop
    def start(self) -> dict:
        c = self.state["cfg"]
        if not c["account"] or not self._office().account(c["account"]):
            raise ValueError("Escolhe a conta MT5 primeiro.")
        if self.state["run"] and self.state["run"]["phase"] != "done":
            raise ValueError("Já está ligado.")
        n = self.news()
        self.state["run"] = {"phase": "waiting", "armed_at": time.time(), "cfg": dict(c), "news": n and {"key": n["key"], "name": n.get("name"), "t": n["t"]},
                             "main": None, "levels": [], "stop": None, "tp": None, "band": None}
        self.note(f"Ligado em {c['symbol']}: à espera da tua posição no MT5 (reforço {c['add_pct']}% de {c['alloc']:,.0f} $).".replace(",", " "))
        self.save()
        return self.state["run"]

    def stop(self, close: bool = False):
        run = self.state["run"]
        if run and run["phase"] == "waiting":   # nothing placed yet
            self.note("Parado antes da tua posição.", "warn")
            self._finish(run)
            self.save()
        elif run and run["phase"] != "done":
            run["stop_asked"] = "close" if close else "cancel"
            self.save()

    # -------------------------------------------------------------- the step (MT5 thread)
    def step(self):
        """One pass: read the market, then do what the run needs. Synchronous; called on the MT5 thread."""
        c = self.state["cfg"]
        run = self.state["run"] if self.state["run"] and self.state["run"]["phase"] != "done" else None
        acc_id = run["cfg"]["account"] if run else c["account"]
        acc = self._office().account(acc_id) if acc_id else None
        if not acc:
            self.market = {"ok": False, "error": "Sem conta MT5 escolhida."}
            return
        b = self.broker(self._office().full(acc))
        err = b.login()
        if err:
            self.market = {"ok": False, "error": err}
            return
        cfg = run["cfg"] if run else c
        name = b.symbol(cfg["symbol"])
        spec = name and b.spec(name)
        tick = name and b.tick(name)
        if not spec or not tick:
            self.market = {"ok": False, "error": f"Sem {cfg['symbol']} ou sem preço na conta (mercado fechado?)."}
            return
        offset = round((tick["time"] - time.time()) / 1800) * 1800   # the broker's clock (server time) vs UTC
        bd = bands(b.bars(name), anchor(datetime.now(UTC)) + offset, cfg.get("tf", 15))
        mid = (tick["bid"] + tick["ask"]) / 2
        self.market = {"ok": True, "at": time.time(), "symbol": name, "bid": tick["bid"], "ask": tick["ask"], "digits": spec["digits"],
                       "vwap": bd and round(bd["vwap"], spec["digits"]), "sd": bd and round(bd["sd"], spec["digits"] + 1), "main": {}}
        if bd:
            for d in ("buy", "sell"):   # the lot of his main position, to the same stop, at main_pct
                s = stop_at(d, mid, bd, cfg["band"], cfg["buffer_pct"])
                if s:
                    per_lot = abs(mid - s[0]) / spec["tick_size"] * spec["tick_value"]
                    vol = int(cfg["alloc"] * cfg["main_pct"] / 100 / per_lot / spec["step"] + 1e-9) * spec["step"]
                    self.market["main"][d] = {"stop": round(s[0], spec["digits"]), "band": s[1], "volume": round(vol, 2),
                                              "risk": round(vol * per_lot, 2)}
        if run:
            self._run(run, b, name, spec, tick, bd)
            self.save()

    def _run(self, run: dict, b, name: str, spec: dict, tick: dict, bd: dict | None):
        cfg = run["cfg"]
        pos = b.positions(name)
        mine = {p["ticket"]: p for p in pos if p["magic"] == MAGIC}
        pending = {o["ticket"] for o in b.orders(name) if o["magic"] == MAGIC}
        for lv in run["levels"]:
            if lv.get("ticket") and lv["status"] == "pending" and lv["ticket"] not in pending:
                lv["status"] = "filled"   # an MT5 limit becomes a position with the same ticket number
            if lv["status"] == "filled" and lv.get("ticket") in mine:
                lv["pnl"] = mine[lv["ticket"]]["pnl"]
            elif lv["status"] == "filled" and lv.get("ticket") not in mine:
                lv["status"] = "closed"

        asked = run.pop("stop_asked", None)
        if asked:
            self._cancel(run, b, pending)
            if asked == "close":
                for t in mine:
                    b.close(t)
                self.note(f"Parado: ordens canceladas e {len(mine)} reforços fechados.", "warn")
            else:
                self.note("Parado: ordens por encher canceladas (os reforços abertos ficam com o seu stop e TP).", "warn")
            return self._finish(run)

        if run["phase"] == "waiting":
            used = {d["main"] for d in self.state["done"][-20:] if d.get("main")}
            manual = [p for p in pos if p["magic"] == 0 and p["ticket"] not in used]
            if not manual:
                if time.time() - run["armed_at"] > 3 * 3600:
                    self.note("3 h sem a tua posição: desliguei.", "warn")
                    self._finish(run)
                return
            main = max(manual, key=lambda p: p["ticket"])
            run["main"] = {"ticket": main["ticket"], "dir": main["dir"], "price": main["price"], "volume": main["volume"], "sl": main["sl"]}
            self._place(run, b, name, spec, tick, bd)
            return

        if run["phase"] == "placed":
            main_open = any(p["ticket"] == run["main"]["ticket"] for p in pos)
            late = time.time() - run["placed_at"] > cfg["window"] * 60
            if pending and (not main_open or late):
                self._cancel(run, b, pending)
                self.note("A tua posição fechou: cancelei as ordens por encher." if not main_open else f"Passaram {cfg['window']} min: cancelei as ordens por encher.")
            if not main_open and not mine:
                self.note("Terminado: a tua posição e os reforços estão fechados.")
                self._finish(run)

    def _place(self, run: dict, b, name: str, spec: dict, tick: dict, bd: dict | None):
        cfg, main = run["cfg"], run["main"]
        d = main["dir"]
        g = self._office().guard(self._office().account(cfg["account"]))
        if g.get("ok") and not g.get("can"):
            self.note(f"Sem reforço: {g['why']}", "bad")
            return self._finish(run)
        if not bd:
            self.note("Sem velas do dia para a VWAP: sem reforço.", "bad")
            return self._finish(run)
        start = max(main["price"], tick["bid"]) if d == "sell" else min(main["price"], tick["ask"])
        s = stop_at(d, start, bd, cfg["band"], cfg["buffer_pct"])
        if not s:
            self.note("O preço já passou a 3.ª banda da VWAP: sem reforço.", "bad")
            return self._finish(run)
        stop, k = s
        news = run.get("news") or {}
        tp_pct = (cfg["tp_auto"] and stat_tp(news.get("key"), cfg["symbol"], d)) or cfg["tp_pct"]
        tp = main["price"] * (1 - tp_pct / 100) if d == "sell" else main["price"] * (1 + tp_pct / 100)
        if (d == "sell" and tp >= tick["bid"]) or (d == "buy" and tp <= tick["ask"]):
            self.note(f"O preço já está no TP ({tp_pct}%): sem reforço.", "warn")
            return self._finish(run)
        money = cfg["alloc"] * cfg["add_pct"] / 100
        steps = ladder(d, start, stop, money, cfg["levels"], spec)
        if not steps:
            self.note(f"O risco do reforço ({money:.0f} $) não chega ao lote mínimo: sem reforço.", "bad")
            return self._finish(run)
        stop_r, tp_r = round(stop, spec["digits"]), round(tp, spec["digits"])
        run.update(phase="placed", placed_at=time.time(), stop=stop_r, tp=tp_r, tp_pct=tp_pct, band=k, start=round(start, spec["digits"]),
                   vwap=round(bd["vwap"], spec["digits"]), sd=round(bd["sd"], spec["digits"] + 1))
        for lv in steps:
            res = b.limit(name, d, lv["volume"], lv["price"], stop_r, tp_r, f"AMG reforco {lv['n']}")
            lv.update(status="pending" if res["ok"] else "error", ticket=res.get("ticket"), error=res.get("error", ""))
            run["levels"].append(lv)
        ok = [lv for lv in run["levels"] if lv["status"] == "pending"]
        self.note(f"Tua posição {('venda' if d == 'sell' else 'compra')} {main['volume']} a {main['price']}: {len(ok)} ordens de reforço "
                  f"{'acima' if d == 'sell' else 'abaixo'}, stop {stop_r} (banda {k}σ), TP {tp_r} ({tp_pct}%), risco {sum(lv['risk'] for lv in ok):.0f} $.",
                  "good" if ok else "bad")
        for lv in run["levels"]:
            if lv["status"] == "error":
                self.note(f"Reforço {lv['n']} não entrou: {lv['error']}", "bad")

    def _cancel(self, run: dict, b, pending: set):
        for lv in run["levels"]:
            if lv["status"] == "pending" and lv.get("ticket") in pending:
                if b.cancel(lv["ticket"]).get("ok"):
                    lv["status"] = "cancelled"

    def _finish(self, run: dict):
        run["phase"] = "done"
        run["ended_at"] = time.time()
        self.state["done"].append({"main": (run.get("main") or {}).get("ticket"), "at": run["ended_at"]})
        del self.state["done"][:-40]

    def out(self) -> dict:
        return {"cfg": self.state["cfg"], "run": self.state["run"], "market": self.market, "accounts": self.accounts(),
                "news": self.news(), "log": self.state["log"][:30], "symbols": SYMS, "mt5": mt5.installed()}


DESK = Desk()


async def loop():
    """Every 2 s while a run is on, every 5 s while the page is open (the market panel), else idle."""
    import asyncio
    await asyncio.sleep(20)
    while True:
        try:
            on = DESK.state["run"] and DESK.state["run"]["phase"] != "done"
            if on or time.time() - DESK.viewed < 30:
                await asyncio.wrap_future(mt5.run(DESK.step))
            await asyncio.sleep(2 if on else 5)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("reforço step")
            await asyncio.sleep(5)
