"""Painel FundedNext (#/fundednext, a tab of the Sala de Trading): the prop account as the firm's dashboard shows it, more
organised and with more in it.

- **Fase e objetivos**: the phase (Fase 1, Fase 2, Financiada) with its profit target and minimum trading days, the daily
  and the max loss with the floors, and how much can still be lost today (in money and in trades at the chosen risk).
- **Os teus limites**: a daily stop and a daily goal of the person's own, stricter than the firm's; the robots respect them
  too (robots.Office.guard).
- **Curva, dias e estatística**: the balance from every deal since the start, the equity sampled every 5 min, the summary
  per trading day (the server's day: midnight = 17:00 New York), every closed trade with its R, and the statistics per
  instrument, session, weekday, direction and origin (manual, each robot, the Reforço).
- **Posições e ordens** from the Hub (close, half, stop to the entry, cancel) and an order ticket sized by risk, that
  refuses a trade whose stop would cross today's floor.
- **Recompensa** of a funded account (split, next date) and the red news ahead.

The account is read through the Escritório de Robôs (robots.OFFICE, the MT5 API on this PC). Nothing here goes by sync."""
from __future__ import annotations

import time
from datetime import datetime, timezone

from . import mt5
from .robots import FOCUS, OFFICE, PHASES, PRESETS, _session, day_start, phase_of
from .room import ROOM

UTC = timezone.utc
MANUAL_MAGIC = 7701          # trades sent from this panel's ticket
REFORCO_MAGIC = 7700         # newsadd.py
WEEKDAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"]
_HIST: dict[str, dict] = {}  # account id -> {"at", "data"}


# ---------------------------------------------------------------- pure (tested)
def money_of(d: dict) -> float:
    return d.get("profit", 0) + d.get("swap", 0) + d.get("commission", 0) + d.get("fee", 0)


def closed_trades(deals: list[dict], stops: dict, offset: int = 0) -> tuple[list[dict], list[dict]]:
    """Deals → positions. Returns (closed, still open). Times are moved from the server's clock to UTC."""
    by: dict = {}
    for d in sorted(deals, key=lambda d: (d["at"], d["ticket"])):
        if d["type"] not in (0, 1) or not d.get("position"):
            continue
        t = by.get(d["position"])
        if t is None:
            t = by[d["position"]] = {"position": d["position"], "symbol": d["symbol"], "dir": None, "open_at": None, "open_price": None,
                                     "volume": 0.0, "out_volume": 0.0, "out_value": 0.0, "close_at": None, "pnl": 0.0,
                                     "magic": d.get("magic", 0), "comment": "", "server_open": None}
        t["pnl"] += money_of(d)
        if d["entry"] == 0:
            if t["open_at"] is None:
                t.update(dir="buy" if d["type"] == 0 else "sell", open_at=d["at"] - offset, server_open=d["at"], open_price=d["price"],
                         comment=d.get("comment", ""), magic=d.get("magic", 0))
            else:   # added to: the average price
                t["open_price"] = (t["open_price"] * t["volume"] + d["price"] * d["volume"]) / (t["volume"] + d["volume"])
            t["volume"] += d["volume"]
        else:       # out, in/out, out by
            t["out_volume"] += d["volume"]
            t["out_value"] += d["price"] * d["volume"]
            t["close_at"] = d["at"] - offset
    done, live = [], []
    for t in by.values():
        if t["open_at"] is None:
            continue
        t["pnl"] = round(t["pnl"], 2)
        sl = stops.get(t["position"]) or stops.get(str(t["position"]))
        t["sl"] = sl or None
        if t["out_volume"] >= t["volume"] - 1e-9 and t["close_at"]:
            t["close_price"] = t["out_value"] / t["out_volume"]
            sign = 1 if t["dir"] == "buy" else -1
            t["r"] = round(sign * (t["close_price"] - t["open_price"]) / abs(t["open_price"] - sl), 2) if sl and abs(t["open_price"] - sl) > 0 else None
            t["minutes"] = round((t["close_at"] - t["open_at"]) / 60, 1)
            t["session"] = _session(t["open_at"])
            t["weekday"] = WEEKDAYS[datetime.fromtimestamp(t["server_open"], UTC).weekday()]
            done.append(t)
        else:
            live.append(t)
    for t in done + live:
        for k in ("out_value", "server_open"):
            t.pop(k, None)
    done.sort(key=lambda t: t["close_at"])
    return done, live


def server_day(ts_server: float) -> str:
    """The trading day of a deal: the date on the server's clock (its midnight is 17:00 New York)."""
    return datetime.fromtimestamp(ts_server, UTC).date().isoformat()


def days_of(deals: list[dict], size: float | None) -> list[dict]:
    """The summary per trading day: realised money, trades opened, lots, wins and losses closed, balance at the end."""
    rows: dict = {}
    bal = 0.0
    for d in sorted(deals, key=lambda d: (d["at"], d["ticket"])):
        key = server_day(d["at"])
        r = rows.setdefault(key, {"day": key, "pnl": 0.0, "trades": 0, "lots": 0.0, "wins": 0, "losses": 0, "best": None, "worst": None})
        if d["type"] not in (0, 1):
            bal += d.get("profit", 0)
            r["balance"] = round(bal, 2)
            continue
        m = money_of(d)
        bal += m
        r["pnl"] += m
        if d["entry"] == 0:
            r["trades"] += 1
            r["lots"] += d["volume"]
        else:
            pnl = d.get("profit", 0) + d.get("swap", 0)
            if pnl > 0:
                r["wins"] += 1
            elif pnl < 0:
                r["losses"] += 1
            r["best"] = pnl if r["best"] is None else max(r["best"], pnl)
            r["worst"] = pnl if r["worst"] is None else min(r["worst"], pnl)
        r["balance"] = round(bal, 2)
    out = []
    for r in sorted(rows.values(), key=lambda r: r["day"]):
        if not r["trades"] and not r["wins"] and not r["losses"]:
            continue   # a deposit or a reward only
        r["pnl"], r["lots"] = round(r["pnl"], 2), round(r["lots"], 2)
        r["pct"] = round(r["pnl"] / size * 100, 2) if size else None
        r["weekday"] = WEEKDAYS[datetime.fromisoformat(r["day"]).weekday()]
        out.append(r)
    return out


def balance_curve(deals: list[dict], offset: int = 0) -> tuple[list[list], float | None, list[dict]]:
    """[[ts, balance]] after every deal, the first deposit (the account size) and the payouts (balance deals out)."""
    pts, bal, first, payouts = [], 0.0, None, []
    for d in sorted(deals, key=lambda d: (d["at"], d["ticket"])):
        if d["type"] in (0, 1):
            bal += money_of(d)
        elif d["type"] == 2:   # balance: the deposit, a reward paid out, a reset
            bal += d.get("profit", 0)
            if first is None and d.get("profit", 0) > 0:
                first = d["profit"]
            elif d.get("profit", 0) < 0:
                payouts.append({"at": d["at"] - offset, "money": round(-d["profit"], 2), "comment": d.get("comment", "")})
        else:
            continue
        pts.append([int(d["at"] - offset), round(bal, 2)])
    return pts, first, payouts


def stats(trades: list[dict], size: float | None, robots: dict[int, str]) -> dict:
    """Everything the firm's statistics show, and more."""
    n = len(trades)
    if not n:
        return {"n": 0}
    wins = [t for t in trades if t["pnl"] > 0]
    losses = [t for t in trades if t["pnl"] < 0]
    gp, gl = sum(t["pnl"] for t in wins), -sum(t["pnl"] for t in losses)
    rs = [t["r"] for t in trades if t.get("r") is not None]
    streak, best_w, best_l = 0, 0, 0
    for t in trades:
        streak = (max(streak, 0) + 1) if t["pnl"] > 0 else (min(streak, 0) - 1) if t["pnl"] < 0 else 0
        best_w, best_l = max(best_w, streak), max(best_l, -streak)
    bal = peak = size or 0.0
    dd = dd_pct = 0.0
    for t in trades:
        bal += t["pnl"]
        peak = max(peak, bal)
        if peak - bal > dd:
            dd, dd_pct = peak - bal, ((peak - bal) / peak * 100) if peak else 0.0

    def group(key) -> list[dict]:
        g: dict = {}
        for t in trades:
            k = key(t)
            x = g.setdefault(k, {"key": k, "n": 0, "wins": 0, "pnl": 0.0, "r": 0.0, "rn": 0})
            x["n"] += 1
            x["wins"] += t["pnl"] > 0
            x["pnl"] += t["pnl"]
            if t.get("r") is not None:
                x["r"] += t["r"]
                x["rn"] += 1
        for x in g.values():
            x["winrate"] = round(x["wins"] / x["n"] * 100)
            x["pnl"] = round(x["pnl"], 2)
            x["avg_r"] = round(x["r"] / x["rn"], 2) if x["rn"] else None
            del x["r"], x["rn"]
        return sorted(g.values(), key=lambda x: -x["pnl"])

    def origin(t):
        m = t.get("magic") or 0
        return "Manual (MT5)" if m == 0 else "Manual (Hub)" if m == MANUAL_MAGIC else "Reforço" if m == REFORCO_MAGIC else robots.get(m, f"Magic {m}")

    avg_w = gp / len(wins) if wins else 0.0
    avg_l = gl / len(losses) if losses else 0.0
    return {"n": n, "wins": len(wins), "losses": len(losses), "winrate": round(len(wins) / n * 100, 1), "net": round(gp - gl, 2),
            "gross_profit": round(gp, 2), "gross_loss": round(gl, 2), "pf": round(gp / gl, 2) if gl else None,
            "avg_win": round(avg_w, 2), "avg_loss": round(avg_l, 2), "rrr": round(avg_w / avg_l, 2) if avg_l else None,
            "expectancy": round((gp - gl) / n, 2), "best": max(trades, key=lambda t: t["pnl"])["pnl"], "worst": min(trades, key=lambda t: t["pnl"])["pnl"],
            "avg_r": round(sum(rs) / len(rs), 2) if rs else None, "total_r": round(sum(rs), 2) if rs else None, "r_n": len(rs),
            "lots": round(sum(t["volume"] for t in trades), 2), "avg_lots": round(sum(t["volume"] for t in trades) / n, 2),
            "avg_minutes": round(sum(t["minutes"] for t in trades) / n), "max_wins": best_w, "max_losses": best_l,
            "max_dd": round(dd, 2), "max_dd_pct": round(dd_pct, 2),
            "long": group(lambda t: "Compras" if t["dir"] == "buy" else "Vendas"), "symbols": group(lambda t: t["symbol"]),
            "sessions": group(lambda t: t["session"]), "weekdays": sorted(group(lambda t: t["weekday"]), key=lambda x: WEEKDAYS.index(x["key"])),
            "origins": group(origin)}


def objectives(acc: dict, snap: dict, guard: dict, trading_days: int, risk_pct: float) -> dict:
    """The phase's objectives the way the firm checks them, plus what is left today."""
    ph = phase_of(acc)
    size = acc.get("size") or 0
    out = {"phase": ph, "size": size, "items": [], "left_today": None, "trades_left": None}
    if not snap.get("ok") or not size or not guard.get("ok"):
        return out
    bal, eq = snap["balance"], snap["equity"]
    target = acc.get("target") or 0
    min_days = int(acc.get("min_days") if acc.get("min_days") is not None else ph["min_days"])
    items = []
    if target:
        goal = size * target / 100
        items.append({"id": "target", "name": f"Objetivo de lucro ({target:g}%)", "need": round(goal, 2), "have": round(bal - size, 2),
                      "pct": round(max(0.0, (bal - size) / goal * 100), 1), "left": round(max(0.0, goal - (bal - size)), 2),
                      "state": "ok" if bal - size >= goal else "run",
                      "hint": "Conta o saldo: as posições abertas só contam quando fecham." if eq - size >= goal > bal - size else ""})
    items.append({"id": "daily", "name": f"Perda diária ({acc['daily']:g}%)", "need": guard["daily_limit"], "have": guard["daily_used"],
                  "pct": guard["daily_pct"], "left": round(guard["daily_limit"] - guard["daily_used"], 2), "floor": guard["floor_day"],
                  "state": "fail" if guard["daily_pct"] >= 100 else "warn" if guard["daily_pct"] >= acc.get("stop_at", 70) else "ok"})
    items.append({"id": "max", "name": f"Perda máxima ({acc['max']:g}%)", "need": guard["max_limit"], "have": guard["max_used"],
                  "pct": guard["max_pct"], "left": round(guard["max_limit"] - guard["max_used"], 2), "floor": guard["floor_max"],
                  "state": "fail" if guard["max_pct"] >= 100 else "warn" if guard["max_pct"] >= acc.get("stop_at", 70) else "ok"})
    if min_days:
        items.append({"id": "days", "name": f"Dias de trading (mín. {min_days})", "need": min_days, "have": trading_days,
                      "pct": round(min(100.0, trading_days / min_days * 100)), "left": max(0, min_days - trading_days),
                      "state": "ok" if trading_days >= min_days else "run",
                      "hint": "Objetivo feito mas faltam dias: uma trade pequena por dia (lote mínimo) completa-os." if target and bal - size >= size * target / 100 and trading_days < min_days else ""})
    left = max(0.0, min(guard["daily_limit"] - guard["daily_used"], guard["max_limit"] - guard["max_used"]))
    if acc.get("my_stop"):
        left = min(left, max(0.0, size * acc["my_stop"] / 100 + guard["day_pnl"]))
    per = bal * risk_pct / 100
    out.update(items=items, left_today=round(left, 2), trades_left=int(left // per) if per > 0 else None, risk_money=round(per, 2),
               passed=all(i["state"] == "ok" for i in items if i["id"] in ("target", "days")) and target > 0)
    return out


def reward(acc: dict, snap: dict, first_trade: float | None, payouts: list[dict]) -> dict | None:
    """A funded account: the split of the profit and the next reward date (first after `first_reward` days, then every `cycle`)."""
    if phase_of(acc)["id"] != "funded" or not snap.get("ok") or not acc.get("size"):
        return None
    split = acc.get("split") or 80.0
    first, cycle = acc.get("first_reward") or 21, acc.get("cycle") or 14
    start = _start_ts(acc) or first_trade
    nxt = None
    if start:
        nxt = start + first * 86400
        last = max([p["at"] for p in payouts] + [0])
        while nxt < max(time.time(), last + 1):
            nxt += cycle * 86400
    profit = max(0.0, snap["balance"] - acc["size"])
    return {"split": split, "profit": round(profit, 2), "reward": round(profit * split / 100, 2), "next": nxt,
            "days": round((nxt - time.time()) / 86400, 1) if nxt else None, "payouts": payouts[-6:], "first": first, "cycle": cycle}


def _start_ts(acc: dict) -> float | None:
    try:
        return datetime.fromisoformat(acc["start"]).replace(tzinfo=UTC).timestamp() if acc.get("start") else None
    except ValueError:
        return None


def news(now: datetime) -> list[dict]:
    """The red news (USD, EUR, GBP) from an hour ago to 48 h ahead, from the room's calendar."""
    out = []
    for e in ROOM.calendar:
        if e.get("imp", 0) < 3 or e.get("ccy") not in ("USD", "EUR", "GBP") or not e.get("t"):
            continue
        try:
            ts = datetime.fromisoformat(str(e["t"]).replace("Z", "+00:00")).timestamp()
        except ValueError:
            continue
        if -3600 <= ts - now.timestamp() <= 48 * 3600:
            out.append({"t": ts, "title": e.get("pt") or e.get("title"), "ccy": e["ccy"], "actual": e.get("actual"),
                        "forecast": e.get("forecast"), "previous": e.get("previous"), "unit": e.get("unit") or ""})
    return out[:12]


# ---------------------------------------------------------------- the page
def history(acc: dict, fresh: bool = False) -> dict:
    """Blocking (MT5 thread): every deal of the account, at most every 30 s (or now with `fresh`)."""
    h = _HIST.get(acc["id"])
    if h and not fresh and time.time() - h["at"] < 30:
        return h["data"]
    lib = OFFICE.lib(acc)
    fn = getattr(lib, "history", None)
    if fn is None:
        data = {"ok": False, "error": "O histórico completo só vem pela API do MetaTrader 5 neste PC."}
    else:
        data = fn(OFFICE.full(acc), 0.0)
    if data.get("ok") or not h:
        _HIST[acc["id"]] = {"at": time.time(), "data": data}
    return data if data.get("ok") or not h else h["data"]


def quotes(acc: dict) -> dict:
    fn = getattr(OFFICE.lib(acc), "quotes", None)
    return fn(OFFICE.full(acc), list(FOCUS) + ["NAS100", "US30"]) if fn else {"ok": False, "error": "Só pela API do MetaTrader 5."}


def dash(aid: str, risk_pct: float = 0.5, fresh: bool = False) -> dict:
    """Blocking (MT5 thread): the whole panel of one account."""
    acc = OFFICE.account(aid)
    if acc is None:
        raise KeyError(aid)
    now = datetime.now(UTC)
    snap = OFFICE.snaps.get(aid) or {}
    if fresh or not snap.get("ok") or time.time() - snap.get("at", 0) > 20:
        try:
            snap = OFFICE.read(acc, now)
        except Exception as e:  # shown on the page
            snap = {"ok": False, "error": f"Erro a ler a conta: {e}", "at": time.time()}
        OFFICE.snaps[aid] = snap
    out = {"id": aid, "account": OFFICE.public(acc), "now": now.isoformat(), "day_start": day_start(now).isoformat()}
    if not snap.get("ok"):
        out["error"] = snap.get("error") or "Sem ligação à conta."
        return out
    h = history(acc, fresh)
    robots = {r["magic"]: r["name"] for r in OFFICE.state["robots"]}
    if h.get("ok"):
        off = h.get("offset", 0)
        done, live = closed_trades(h["deals"], h.get("stops") or {}, off)
        curve, first, payouts = balance_curve(h["deals"], off)
        days = days_of(h["deals"], acc.get("size") or first)
        if first and not acc.get("size_set"):
            acc["size"] = round(first, 2)   # the first deposit is the account size
    else:
        done, live, curve, first, payouts, days = [], [], [], None, [], []
        out["history_error"] = h.get("error")
    trading_days = len([d for d in days if d["trades"]])
    g = OFFICE.guard(acc)
    ins =OFFICE.state.get("eq", {}).get(aid, [])
    out.update(snap={k: v for k, v in snap.items() if k != "deals"}, guard=g,
               objectives=objectives(acc, snap, g, trading_days, risk_pct), reward=reward(acc, snap, done[0]["open_at"] if done else None, payouts),
               curve=curve[-3000:], equity=ins[-3000:], today=(OFFICE.state["days"].get(aid) or {}).get("curve", [])[-1500:],
               days=days[-120:], trades=done[-400:][::-1], stats=stats(done, acc.get("size") or first, robots), trading_days=trading_days,
               first_trade=done[0]["open_at"] if done else (live[0]["open_at"] if live else None), news=news(now),
               robots=[{"id": r["id"], "name": r["name"], "on": r["on"], "mine": r.get("account") == aid, "risk": r["risk"], "max_day": r["max_day"],
                        "symbols": r["symbols"], "squad": r["squad"], "from": r["from"], "to": r["to"]} for r in OFFICE.state["robots"]],
               log=[x for x in OFFICE.state["log"] if x.get("acc") == aid][:30], programs=[{"id": k, "name": v["name"]} for k, v in PRESETS.items()],
               phases={k: [{"id": p[0], "name": p[1], "target": p[2], "min_days": p[3]} for p in v] for k, v in PHASES.items()},
               stops={str(k): v for k, v in (h.get("stops") or {}).items()} if h.get("ok") else {})
    return out


def overview() -> dict:
    """The page's first call: the accounts, and whether the MT5 is here."""
    return {"accounts": [OFFICE.public(a) for a in OFFICE.state["accounts"]], "mt5": mt5.installed(), "focus": FOCUS}
