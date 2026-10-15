"""Escritório de Robôs (#/robos, a tab of the Sala de Trading): the room's traders as robots at desks, each one a strategy
on one or more instruments (the SMC model per instrument, the Pinguim and the Duas-Caras), with its day in money, its
curve and its drawdown, and the team's real accounts behind them.

- **Robots** follow the room's book (book.py): a robot is an agent of the book filtered to its instruments. With no account
  it trades on paper (R turned into money at its risk per trade). With an account it can send the same trades for real.
- **Accounts** are reached by API, never by hand: the official MetaTrader 5 API on this PC (mt5.py: FundedNext MT5, the
  person's own IP) or MetaApi in the cloud (metaapi.py). Forex and CFD day trading only (XAUUSD, EURUSD, GBPUSD, GER40).
  Passwords and tokens are kept on this PC only (~/.team-agent/trading-room/contas.json, encrypted for this Windows user
  with DPAPI), never in the database, never synced, never sent back to the page.
- **Modes**: "observar" (default: reads balance, positions and deals, sends nothing) and "auto" (the robots on this account
  send their trades). Auto is switched on by a person, per account, in the page.
- **The prop guard** reads the firm's rules (daily loss from the higher of balance and equity at the start of the trading day,
  17:00 New York, and the max loss from the initial balance) and stops new orders at `stop_at` of a limit, and closes the
  robots' positions at `panic_at`. Day trading: no new orders outside the robot's hours, and everything of the robots is
  closed at its `flat` hour (Lisbon) and before the weekend.
- **Afinação**: what the closed trades say per instrument, session and grade, with the hours each robot should keep."""
from __future__ import annotations

import base64
import json
import logging
import os
import time
from datetime import datetime, timedelta, timezone

from . import metaapi, mt5, sessions
from .book import ACTIVE, AGENTS, DONE
from .council import lisbon
from .room import DIR, ROOM

log = logging.getLogger("tradingroom.robots")
UTC = timezone.utc
FILE = DIR / "robots.json"
SECRETS = DIR / "contas.json"
FOCUS = ["XAUUSD", "EURUSD", "GBPUSD", "GER40"]   # what the team trades (Mercados FOCUS)
SECRET_KEYS = ("password", "token")
PAPER = 100_000.0   # a robot with no account trades a paper account of this size

# the prop firms' rules (confirm on the firm's dashboard: they change; every number can be set by hand on the account)
PRESETS = {
    "fn-stellar-2": {"name": "FundedNext Stellar 2-Step", "daily": 5.0, "max": 10.0, "target": 8.0},
    "fn-stellar-1": {"name": "FundedNext Stellar 1-Step", "daily": 3.0, "max": 6.0, "target": 10.0},
    "fn-lite": {"name": "FundedNext Stellar Lite", "daily": 4.0, "max": 8.0, "target": 8.0},
    "fn-funded": {"name": "FundedNext financiada", "daily": 5.0, "max": 10.0, "target": 0.0},
    "custom": {"name": "Outra conta", "daily": 5.0, "max": 10.0, "target": 0.0},
}
LINKS = {"mt5": {"name": "API do MetaTrader 5 (neste PC)", "lib": mt5}, "metaapi": {"name": "MetaApi (cloud)", "lib": metaapi}}
LOOKS = ["#d9dde3", "#8fb4ff", "#5fcf8c", "#e2b55c", "#c49bff", "#5fd3d3", "#ef8f6e", "#f2f4f7"]


def _robot(rid, name, agent, symbols, squad, i) -> dict:
    return {"id": rid, "name": name, "agent": agent, "symbols": symbols, "squad": squad, "seat": i, "look": LOOKS[i % len(LOOKS)],
            "on": True, "account": "", "risk": 0.5, "max_day": 3, "from": "08:00", "to": "20:30", "flat": "21:30",
            "magic": 261000 + i, "armed_at": None}


DEFAULT_ROBOTS = [
    _robot("smc-xau", "Ouro", "model", ["XAUUSD"], "SMC", 0), _robot("smc-eur", "EUR/USD", "model", ["EURUSD"], "SMC", 1),
    _robot("smc-gbp", "GBP/USD", "model", ["GBPUSD"], "SMC", 2), _robot("smc-ger", "GER40", "model", ["GER40"], "SMC", 3),
    _robot("pinguim", "Pinguim", "penguin", list(FOCUS), "Mesa Claude", 4), _robot("duascaras", "Duas-Caras", "twoface", list(FOCUS), "Mesa Claude", 5),
]


# ---------------------------------------------------------------- secrets (DPAPI on Windows)
def _seal(text: str) -> str:
    if not text:
        return ""
    try:
        import win32crypt
        return "dpapi:" + base64.b64encode(win32crypt.CryptProtectData(text.encode(), "AMG", None, None, None, 0)).decode()
    except Exception:
        return "plain:" + text


def _open(blob: str) -> str:
    if not blob:
        return ""
    if blob.startswith("dpapi:"):
        try:
            import win32crypt
            return win32crypt.CryptUnprotectData(base64.b64decode(blob[6:]), None, None, None, 0)[1].decode()
        except Exception:
            return ""
    return blob[6:] if blob.startswith("plain:") else blob


# ---------------------------------------------------------------- time
def day_start(now: datetime) -> datetime:
    """The trading day starts at 17:00 New York (00:00 on the GMT+2/+3 servers of FundedNext and most brokers)."""
    off = timedelta(hours=sessions.ny_offset(now))
    n = (now - off).replace(tzinfo=None)
    b = n.replace(hour=17, minute=0, second=0, microsecond=0)
    if n < b:
        b -= timedelta(days=1)
    return (b + off).replace(tzinfo=UTC)


def _hm(s: str) -> float:
    try:
        h, m = str(s).split(":")
        return int(h) + int(m) / 60
    except ValueError:
        return 0.0


def _ts(s) -> float:
    if not s:
        return 0.0
    if isinstance(s, (int, float)):
        return float(s)
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00")).timestamp()
    except ValueError:
        return 0.0


def _session(ts: float) -> str:
    """The session a trade entered in, by New York hour (the room's killzones)."""
    h = sessions._h(sessions.ny(datetime.fromtimestamp(ts, UTC)))
    if 2 <= h < 5:
        return "Londres"
    if 7 <= h < 10:
        return "Nova Iorque"
    if 10 <= h < 16:
        return "Tarde NY"
    if 5 <= h < 7:
        return "Pré-NY"
    return "Ásia"


# ---------------------------------------------------------------- the office
class Office:
    def __init__(self):
        self.state = self._load()
        self.secrets = self._load_secrets()
        self.snaps: dict[str, dict] = {}     # account id -> last snapshot (memory only)
        self.saved = 0.0
        self.busy = False

    def _load(self) -> dict:
        st = {"robots": [dict(r) for r in DEFAULT_ROBOTS], "accounts": [], "sent": {}, "days": {}, "log": []}
        try:
            st.update(json.loads(FILE.read_text("utf-8")))
        except (OSError, ValueError):
            pass
        known = {r["id"] for r in st["robots"]}
        st["robots"] += [dict(r) for r in DEFAULT_ROBOTS if r["id"] not in known and not st.get("removed", {}).get(r["id"])]
        return st

    def _load_secrets(self) -> dict:
        try:
            return json.loads(SECRETS.read_text("utf-8"))
        except (OSError, ValueError):
            return {}

    def save(self, force: bool = False):
        if not force and time.time() - self.saved < 20:
            return
        self.saved = time.time()
        DIR.mkdir(parents=True, exist_ok=True)
        for path, data in ((FILE, self.state), (SECRETS, self.secrets)):
            tmp = path.with_suffix(".tmp")
            tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), "utf-8")
            os.replace(tmp, path)

    def note(self, text: str, kind: str = "info", acc: str = ""):
        self.state["log"].insert(0, {"t": time.time(), "text": text, "kind": kind, "acc": acc})
        del self.state["log"][120:]
        log.info("robots: %s", text)

    # ---------------------------------------------------------------- accounts
    def account(self, aid: str) -> dict | None:
        return next((a for a in self.state["accounts"] if a["id"] == aid), None)

    def full(self, acc: dict) -> dict:
        """The account with its secrets, for the API calls."""
        sec = self.secrets.get(acc["id"], {})
        return {**acc, **{k: _open(sec.get(k, "")) for k in SECRET_KEYS}}

    def public(self, acc: dict) -> dict:
        sec = self.secrets.get(acc["id"], {})
        snap = self.snaps.get(acc["id"]) or {}
        return {**acc, "has": {k: bool(sec.get(k)) for k in SECRET_KEYS}, "snap": {k: v for k, v in snap.items() if k != "deals"},
                "deals_today": len([d for d in snap.get("deals", []) if d.get("entry") == 1]), "guard": self.guard(acc),
                "link_name": LINKS.get(acc.get("link"), {}).get("name", acc.get("link")), "preset_name": PRESETS.get(acc.get("preset"), {}).get("name", "")}

    def save_account(self, body: dict) -> dict:
        aid = str(body.get("id") or "").strip() or f"acc{int(time.time())}"
        acc = self.account(aid)
        if acc is None:
            acc = {"id": aid, "mode": "observar", "created": time.time()}
            self.state["accounts"].append(acc)
        preset = body.get("preset") if body.get("preset") in PRESETS else acc.get("preset", "fn-stellar-2")
        p = PRESETS[preset]
        acc.update(name=str(body.get("name") or acc.get("name") or "FundedNext")[:40], link=body.get("link") if body.get("link") in LINKS else acc.get("link", "mt5"),
                   login=str(body.get("login", acc.get("login", ""))).strip()[:20], server=str(body.get("server", acc.get("server", ""))).strip()[:60],
                   path=str(body.get("path", acc.get("path", ""))).strip()[:260], account_id=str(body.get("account_id", acc.get("account_id", ""))).strip()[:80],
                   region=str(body.get("region", acc.get("region", "london")))[:20], preset=preset,
                   size=float(body.get("size") or acc.get("size") or 0) or None,
                   daily=float(body.get("daily") or acc.get("daily") or p["daily"]), max=float(body.get("max") or acc.get("max") or p["max"]),
                   target=float(body.get("target") if body.get("target") not in (None, "") else acc.get("target", p["target"])),
                   stop_at=min(95.0, max(30.0, float(body.get("stop_at") or acc.get("stop_at") or 70))),
                   panic_at=min(99.0, max(50.0, float(body.get("panic_at") or acc.get("panic_at") or 90))),
                   symbols={k: str(v).strip() for k, v in (body.get("symbols") or acc.get("symbols") or {}).items() if str(v).strip()})
        if body.get("preset") in PRESETS and body.get("preset") != "custom" and not body.get("daily"):
            acc.update(daily=p["daily"], max=p["max"], target=p["target"])
        sec = self.secrets.setdefault(aid, {})
        for k in SECRET_KEYS:
            if body.get(k):   # blank = keep what was there
                sec[k] = _seal(str(body[k]))
        self.note(f"Conta «{acc['name']}» guardada ({LINKS[acc['link']]['name']}).", acc=aid)
        self.save(True)
        return acc

    def remove_account(self, aid: str):
        self.state["accounts"] = [a for a in self.state["accounts"] if a["id"] != aid]
        self.secrets.pop(aid, None)
        self.snaps.pop(aid, None)
        for r in self.state["robots"]:
            if r.get("account") == aid:
                r["account"] = ""
        self.save(True)

    def set_mode(self, aid: str, mode: str) -> dict:
        acc = self.account(aid)
        if not acc:
            raise KeyError(aid)
        if mode not in ("observar", "auto"):
            raise ValueError(mode)
        if mode == "auto" and not (self.snaps.get(aid) or {}).get("ok"):
            raise ValueError("Primeiro liga a conta (Testar ligação) e confirma que o saldo aparece.")
        acc["mode"] = mode
        now = datetime.now(UTC).isoformat()
        for r in self.state["robots"]:   # only what the robots decide from now on goes to the account
            if r.get("account") == aid:
                r["armed_at"] = now if mode == "auto" else None
        self.note(f"Conta «{acc['name']}»: modo {'AUTOMÁTICO — os robôs enviam ordens' if mode == 'auto' else 'observar (não envia nada)'}.",
                  "warn" if mode == "auto" else "info", aid)
        self.save(True)
        return acc

    # ---------------------------------------------------------------- reading the accounts
    def lib(self, acc: dict):
        return LINKS.get(acc.get("link"), LINKS["mt5"])["lib"]

    def read(self, acc: dict, now: datetime) -> dict:
        """One snapshot (blocking: runs on the MT5 thread or a worker thread)."""
        start = day_start(now)
        snap = self.lib(acc).snapshot(self.full(acc), start.timestamp())
        snap["at"] = time.time()
        if not snap.get("ok"):
            return snap
        day = self.state["days"].setdefault(acc["id"], {})
        key = start.date().isoformat()
        if day.get("key") != key:   # a new trading day: the daily loss counts from the higher of balance and equity now
            day.update(key=key, start=max(snap["balance"], snap["equity"]), curve=[], peak=snap["equity"], low=snap["equity"], flat_done=False)
        day["peak"], day["low"] = max(day["peak"], snap["equity"]), min(day["low"], snap["equity"])
        if not day["curve"] or time.time() - day["curve"][-1][0] >= 60 or abs(day["curve"][-1][1] - snap["equity"]) > 1e-6:
            day["curve"].append([int(time.time()), round(snap["equity"], 2)])
            del day["curve"][:-1500]
        if not acc.get("size"):
            acc["size"] = round(snap["balance"], 2)   # the first balance seen is the initial one (set it on the account if not)
        return snap

    def guard(self, acc: dict) -> dict:
        """How far the account is from the firm's limits, and what the robots may do."""
        snap = self.snaps.get(acc["id"]) or {}
        day = self.state["days"].get(acc["id"]) or {}
        if not snap.get("ok") or not acc.get("size"):
            return {"ok": False, "can": False, "why": snap.get("error") or "Ainda sem ligação à conta."}
        size, eq = acc["size"], snap["equity"]
        daily_lim, max_lim = size * acc["daily"] / 100, size * acc["max"] / 100
        used_day = max(0.0, (day.get("start") or eq) - eq)
        used_max = max(0.0, size - eq)
        out = {"ok": True, "daily_limit": round(daily_lim, 2), "daily_used": round(used_day, 2), "daily_pct": round(used_day / daily_lim * 100, 1) if daily_lim else 0,
               "max_limit": round(max_lim, 2), "max_used": round(used_max, 2), "max_pct": round(used_max / max_lim * 100, 1) if max_lim else 0,
               "floor_day": round((day.get("start") or eq) - daily_lim, 2), "floor_max": round(size - max_lim, 2),
               "target": round(size * acc.get("target", 0) / 100, 2), "profit": round(eq - size, 2),
               "target_pct": round((eq - size) / (size * acc["target"] / 100) * 100, 1) if acc.get("target") else None,
               "day_pnl": round(eq - (day.get("start") or eq), 2), "can": True, "why": "", "panic": False}
        worst = max(out["daily_pct"], out["max_pct"])
        if worst >= acc.get("panic_at", 90):
            out.update(can=False, panic=True, why=f"Perto do limite da prop ({worst:.0f}%): os robôs fecham tudo e param até amanhã.")
        elif worst >= acc.get("stop_at", 70):
            out.update(can=False, why=f"{worst:.0f}% do limite de perda usado: sem ordens novas hoje.")
        elif not snap.get("trade_allowed", True):
            out.update(can=False, why="A conta não deixa negociar por API (ativa o «Algo Trading» no MT5).")
        elif acc.get("target") and eq - size >= size * acc["target"] / 100:
            out.update(can=False, why="Objetivo da fase atingido: os robôs param para não arriscar o que já está ganho.")
        return out

    # ---------------------------------------------------------------- the robots
    def robot(self, rid: str) -> dict | None:
        return next((r for r in self.state["robots"] if r["id"] == rid), None)

    def save_robot(self, rid: str, body: dict) -> dict:
        r = self.robot(rid)
        if r is None:
            used = {x["magic"] for x in self.state["robots"]}
            seat = max([x["seat"] for x in self.state["robots"]] + [-1]) + 1
            r = _robot(rid, "Robô", "model", ["XAUUSD"], "SMC", seat)
            while r["magic"] in used:
                r["magic"] += 1
            self.state["robots"].append(r)
        for k in ("name", "squad", "look", "from", "to", "flat"):
            if k in body and body[k] is not None:
                r[k] = str(body[k])[:40]
        if body.get("agent") in AGENTS:
            r["agent"] = body["agent"]
        if isinstance(body.get("symbols"), list):
            r["symbols"] = [s for s in body["symbols"] if s in FOCUS + ["NAS100", "US30", "BTCUSD"]] or r["symbols"]
        for k, lo, hi in (("risk", .05, 3.0), ("max_day", 1, 20)):
            if body.get(k) not in (None, ""):
                r[k] = min(hi, max(lo, float(body[k]))) if k == "risk" else int(min(hi, max(lo, int(body[k]))))
        if "seat" in body and body["seat"] is not None:
            seat = int(body["seat"])
            other = next((x for x in self.state["robots"] if x["seat"] == seat and x is not r), None)
            if other:   # swap places
                other["seat"] = r["seat"]
            r["seat"] = seat
        if "on" in body:
            r["on"] = bool(body["on"])
        if "account" in body:
            aid = str(body["account"] or "")
            if aid and not self.account(aid):
                raise ValueError("Conta desconhecida.")
            r["account"] = aid
            acc = self.account(aid)
            r["armed_at"] = datetime.now(UTC).isoformat() if acc and acc.get("mode") == "auto" else None
        self.save(True)
        return r

    def remove_robot(self, rid: str):
        self.state["robots"] = [r for r in self.state["robots"] if r["id"] != rid]
        self.state.setdefault("removed", {})[rid] = True
        self.save(True)

    def trades_of(self, r: dict) -> list[dict]:
        return [t for t in ROOM.book.trades if t["agent"] == r["agent"] and t["symbol"] in r["symbols"]]

    def in_hours(self, r: dict, now: datetime) -> bool:
        if not any(sessions.market_open(now, s == "BTCUSD") for s in r["symbols"]):
            return False
        h = lisbon(now)
        x = h.hour + h.minute / 60
        if sessions.ny(now).weekday() == 4 and sessions._h(sessions.ny(now)) >= 15.5:   # Friday: flat before the weekend
            return False
        return _hm(r["from"]) <= x < min(_hm(r["to"]), _hm(r["flat"]))

    def view(self, r: dict, now: datetime) -> dict:
        """One robot as the office draws it: state, today's money and curve, drawdown, the last trades."""
        start = day_start(now).timestamp()
        acc = self.account(r.get("account") or "")
        snap = self.snaps.get(acc["id"]) if acc else None
        mine = self.trades_of(r)
        risk_money = (acc.get("size") if acc and acc.get("size") else PAPER) * r["risk"] / 100
        real = bool(acc and snap and snap.get("ok"))
        curve, pnl_day, ops, best, worst, wins, losses = [], 0.0, 0, None, None, 0, 0
        if real:   # the account's own deals with this robot's magic number
            deals = sorted([d for d in snap.get("deals", []) if d.get("magic") == r["magic"] and d.get("entry") == 1], key=lambda d: d["at"])
            for d in deals:
                pnl_day += d["pnl"]
                curve.append([int(d["at"]), round(pnl_day, 2)])
                best = d["pnl"] if best is None else max(best, d["pnl"])
                worst = d["pnl"] if worst is None else min(worst, d["pnl"])
                wins += d["pnl"] > 0
                losses += d["pnl"] < 0
            ops = len([d for d in snap.get("deals", []) if d.get("magic") == r["magic"] and d.get("entry") == 0])
            live = sum(p["pnl"] for p in snap.get("positions", []) if p.get("magic") == r["magic"])
            open_n = len([p for p in snap.get("positions", []) if p.get("magic") == r["magic"]])
            pend_n = len([o for o in snap.get("orders", []) if o.get("magic") == r["magic"]])
        else:      # paper: the book's R at this robot's risk
            done = sorted([t for t in mine if t["status"] in DONE and _ts(t.get("closed_at")) >= start], key=lambda t: _ts(t["closed_at"]))
            for t in done:
                m = t["r"] * risk_money
                pnl_day += m
                curve.append([int(_ts(t["closed_at"])), round(pnl_day, 2)])
                best = m if best is None else max(best, m)
                worst = m if worst is None else min(worst, m)
                wins += t["r"] > .05
                losses += t["r"] < -.05
            ops = len([t for t in mine if t.get("filled_at") and _ts(t["filled_at"]) >= start])
            live = sum((ROOM.book.live_r(t, ROOM.view) or 0) * risk_money for t in mine if t["status"] == "open")
            open_n = len([t for t in mine if t["status"] == "open"])
            pend_n = len([t for t in mine if t["status"] == "pending"])
        peak, dd, dd_curve = 0.0, 0.0, []
        for ts, v in curve:
            peak = max(peak, v)
            dd = max(dd, peak - v)
            dd_curve.append([ts, round(v - peak, 2)])
        hours = self.in_hours(r, now)
        state = "off" if not r["on"] else "trade" if open_n else "wait" if pend_n else "watch" if hours else "rest"
        stats = ROOM.book.stats(r["agent"])
        closed = [t for t in mine if t["status"] in DONE]
        return {**{k: r[k] for k in ("id", "name", "agent", "symbols", "squad", "seat", "look", "on", "account", "risk", "max_day", "from", "to", "flat", "magic")},
                "agent_name": AGENTS.get(r["agent"], r["agent"]), "real": real, "mode": acc.get("mode") if acc else "papel",
                "account_name": acc["name"] if acc else "Papel", "state": state, "in_hours": hours,
                "day_pnl": round(pnl_day, 2), "live_pnl": round(live, 2), "equity": round((snap["equity"] if real else PAPER) + 0, 2),
                "ops": ops, "open": open_n, "pending": pend_n, "wins": wins, "losses": losses, "best": best and round(best, 2), "worst": worst and round(worst, 2),
                "curve": curve, "dd": round(dd, 2), "dd_curve": dd_curve, "risk_money": round(risk_money, 2),
                "all": {"n": len(closed), "winrate": round(sum(t["r"] > .05 for t in closed) / len(closed) * 100) if closed else None,
                        "r": round(sum(t["r"] for t in closed), 2), "agent_winrate": stats.get("winrate")},
                "last": [{"id": t["id"], "symbol": t["symbol"], "dir": t["dir"], "status": t["status"], "r": t.get("r"), "at": t["at"],
                          "entry": t["entry"], "stop": t["stop"], "tp1": t["tp1"], "grade": t.get("grade"), "note": t.get("note", ""),
                          "sent": self.state["sent"].get(f"{r.get('account')}:{t['id']}")} for t in mine[:6]],
                "note": r.get("note", "")}

    # ---------------------------------------------------------------- tuning the setups
    def tuning(self) -> dict:
        """What the closed trades say: per instrument and session, per grade and per agent, with the hours worth keeping."""
        closed = [t for t in ROOM.book.trades if t["status"] in DONE and t.get("filled_at")]
        bt = []
        try:
            bt = [t for t in json.loads((DIR / "backtest.json").read_text("utf-8")).get("trades", []) if t.get("status") in DONE and t.get("filled_at")]
        except (OSError, ValueError, AttributeError):
            pass

        def agg(rows):
            n = len(rows)
            if not n:
                return None
            w = sum(t["r"] > .05 for t in rows)
            gains = sum(t["r"] for t in rows if t["r"] > 0)
            loss = -sum(t["r"] for t in rows if t["r"] < 0)
            return {"n": n, "winrate": round(w / n * 100), "avg": round(sum(t["r"] for t in rows) / n, 2), "r": round(sum(t["r"] for t in rows), 2),
                    "pf": round(gains / loss, 2) if loss else None}
        out = {"cells": [], "grades": [], "agents": [], "tips": [], "source": {"live": len(closed), "backtest": len(bt)}}
        rows = closed + [dict(t, agent="model", bt=True) for t in bt]
        sess = ["Ásia", "Londres", "Pré-NY", "Nova Iorque", "Tarde NY"]
        for s in FOCUS:
            for ss in sess:
                a = agg([t for t in rows if t["symbol"] == s and _session(_ts(t["filled_at"])) == ss])
                if a:
                    out["cells"].append({"symbol": s, "session": ss, **a})
        for g in ("A+", "A", "B"):
            a = agg([t for t in rows if t.get("grade") == g])
            if a:
                out["grades"].append({"grade": g, **a})
        for ag, name in AGENTS.items():
            a = agg([t for t in closed if t["agent"] == ag])
            if a:
                out["agents"].append({"agent": ag, "name": name, **a})
        for c in out["cells"]:
            if c["n"] >= 5 and c["avg"] <= -.15:
                out["tips"].append({"kind": "bad", "symbol": c["symbol"], "session": c["session"],
                                    "text": f"{c['symbol']} em {c['session']}: {c['n']} trades, {c['winrate']}% de acerto, {c['avg']:+.2f}R por trade. Os robôs deste instrumento devem ficar fora desta sessão."})
            elif c["n"] >= 5 and c["avg"] >= .25:
                out["tips"].append({"kind": "good", "symbol": c["symbol"], "session": c["session"],
                                    "text": f"{c['symbol']} em {c['session']}: {c['n']} trades, {c['winrate']}% de acerto, {c['avg']:+.2f}R por trade. É aqui que o setup rende."})
        for g in out["grades"]:
            if g["grade"] == "B" and g["n"] >= 6 and g["avg"] < 0:
                out["tips"].append({"kind": "bad", "text": f"Setups B: {g['n']} trades a {g['avg']:+.2f}R. Só A e A+ devem ir para a conta."})
        if not out["tips"]:
            out["tips"].append({"kind": "info", "text": "Ainda poucas trades fechadas para tirar conclusões (5 por instrumento e sessão). Corre o backtest na Sala de Trading para encher isto."})
        return out

    # ---------------------------------------------------------------- the loop (every 15 s)
    def accounts_to_read(self) -> list[dict]:
        return [a for a in self.state["accounts"] if (a["id"] in self.secrets) or a.get("link") == "metaapi"]

    def sync_account(self, acc: dict, now: datetime):
        """Blocking: read the account, enforce the guard and the day-trading hours, send and follow the robots' orders."""
        snap = self.read(acc, now)
        self.snaps[acc["id"]] = snap
        if not snap.get("ok"):
            return
        lib, full = self.lib(acc), self.full(acc)
        robots = [r for r in self.state["robots"] if r.get("account") == acc["id"]]
        magics = {r["magic"]: r for r in robots}
        g = self.guard(acc)
        day = self.state["days"][acc["id"]]
        ours_pos = [p for p in snap["positions"] if p.get("magic") in magics]
        ours_ord = [o for o in snap["orders"] if o.get("magic") in magics]
        auto = acc.get("mode") == "auto"
        if not auto:
            return
        # the prop guard: close everything of the robots near a limit
        if g.get("panic") and (ours_pos or ours_ord):
            for o in ours_ord:
                lib.cancel(full, o["ticket"])
            for p in ours_pos:
                lib.close(full, p["ticket"])
            self.note(f"«{acc['name']}»: {g['why']} Fechei {len(ours_pos)} posições e {len(ours_ord)} ordens dos robôs.", "bad", acc["id"])
            return
        # day trading: at each robot's flat hour (and on Friday before the close) its positions and orders go
        for r in robots:
            if r["on"] and self.in_hours(r, now):
                continue
            mine_p = [p for p in ours_pos if p["magic"] == r["magic"]]
            mine_o = [o for o in ours_ord if o["magic"] == r["magic"]]
            if mine_p or mine_o:
                for o in mine_o:
                    lib.cancel(full, o["ticket"])
                for p in mine_p:
                    lib.close(full, p["ticket"])
                self.note(f"{r['name']}: fora do horário ({r['from']}–{r['to']}, fecho {r['flat']}): fechei {len(mine_p)} posições e cancelei {len(mine_o)} ordens.", "info", acc["id"])
        # orders whose trade in the book is over (expired, invalidated, closed by the agent) are cancelled / closed
        by_id = {t["id"]: t for t in ROOM.book.trades}
        open_tickets = {str(p["ticket"]) for p in ours_pos}
        order_tickets = {str(o["ticket"]) for o in ours_ord}
        for key, s in self.state["sent"].items():
            if not key.startswith(acc["id"] + ":") or s.get("status") != "sent":
                continue
            t = by_id.get(s["trade"])
            tk = str(s.get("ticket"))
            if tk in order_tickets and (t is None or t["status"] not in ACTIVE):
                lib.cancel(full, tk)
                s["status"] = "cancelled"
                self.note(f"{s.get('robot')}: cancelei a ordem {tk} ({(t['note'] or t['status']) if t else 'trade apagada'}).", "info", acc["id"])
            elif tk in open_tickets and t is not None and t["status"] in DONE and ("fecho" in (t.get("note") or "") or "fechad" in (t.get("note") or "")):
                lib.close(full, tk)
                s["status"] = "closed"
                self.note(f"{s.get('robot')}: fechei a posição {tk} como a trade do livro ({t['note']}).", "info", acc["id"])
        if not g["can"]:
            for r in robots:
                r["note"] = g["why"]
            return
        # new trades of the robots, from the moment the account went automatic
        sent_today = {}
        for s in self.state["sent"].values():
            if s.get("acc") == acc["id"] and s.get("at", 0) >= day_start(now).timestamp() and s.get("status") != "error":
                sent_today[s["robot"]] = sent_today.get(s["robot"], 0) + 1
        for r in robots:
            if not r["on"] or not r.get("armed_at"):
                continue
            if not self.in_hours(r, now):
                r["note"] = f"Fora do horário ({r['from']}–{r['to']})."
                continue
            for t in self.trades_of(r):
                key = f"{acc['id']}:{t['id']}"
                if key in self.state["sent"] or t["status"] not in ACTIVE or _ts(t["at"]) < _ts(r["armed_at"]):
                    continue
                if sent_today.get(r["id"], 0) >= r["max_day"]:
                    r["note"] = f"Já fez {r['max_day']} trades hoje (máximo do robô)."
                    break
                if t["status"] == "open" and not (t.get("market") and time.time() - _ts(t["at"]) < 120):
                    continue   # the paper trade filled before the account could follow: the entry is gone
                if t["status"] == "pending" and ROOM.book.now(t, ROOM.view).get("can") not in ("yes", None):
                    continue
                a = ROOM.view.get(t["symbol"]) or {}
                flat_at = lisbon(now).replace(hour=int(_hm(r["flat"])), minute=int(_hm(r["flat"]) % 1 * 60), second=0)
                expires = min(_ts(t["valid"]), (now + (flat_at - lisbon(now))).timestamp())
                res = lib.place(full, {"symbol": t["symbol"], "dir": t["dir"], "entry": t["entry"], "stop": t["stop"], "tp": t["tp1"],
                                       "money": snap["balance"] * r["risk"] / 100, "market": t["status"] == "open", "magic": r["magic"],
                                       "comment": f"AMG {r['id']} {t['id'] % 100000}", "expires": expires, "feed": a.get("price")})
                self.state["sent"][key] = {"acc": acc["id"], "robot": r["name"], "robot_id": r["id"], "trade": t["id"], "at": time.time(),
                                           "status": "sent" if res["ok"] else "error", "ticket": res.get("ticket"), "volume": res.get("volume"),
                                           "risk": res.get("risk"), "error": res.get("error", ""), "symbol": res.get("symbol")}
                if res["ok"]:
                    sent_today[r["id"]] = sent_today.get(r["id"], 0) + 1
                    self.note(f"{r['name']}: {'compra' if t['dir'] == 'buy' else 'venda'} {res['volume']} {res['symbol']} "
                              f"{'a mercado' if res['market'] else 'limite'} (risco {res['risk']:.2f}).", "trade", acc["id"])
                else:
                    self.note(f"{r['name']}: a ordem não entrou — {res['error']}", "bad", acc["id"])
        self.save()

    async def tick(self):
        import asyncio
        if self.busy:
            return
        self.busy = True
        try:
            now = datetime.now(UTC)
            for acc in self.accounts_to_read():
                try:
                    if acc.get("link", "mt5") == "mt5":
                        await asyncio.wrap_future(mt5.run(self.sync_account, acc, now))
                    else:
                        await asyncio.to_thread(self.sync_account, acc, now)
                except Exception as e:
                    log.exception("robots: account %s", acc.get("name"))
                    self.snaps[acc["id"]] = {"ok": False, "error": f"Erro a ler a conta: {e}", "at": time.time()}
            self.save()
        finally:
            self.busy = False

    async def test(self, aid: str) -> dict:
        import asyncio
        acc = self.account(aid)
        if not acc:
            raise KeyError(aid)
        now = datetime.now(UTC)
        if acc.get("link", "mt5") == "mt5":
            snap = await asyncio.wrap_future(mt5.run(self.read, acc, now))
        else:
            snap = await asyncio.to_thread(self.read, acc, now)
        self.snaps[aid] = snap
        self.note(f"«{acc['name']}»: " + (f"ligada, saldo {snap['balance']:.2f} {snap.get('currency', '')}." if snap.get("ok") else snap.get("error", "falhou")),
                  "info" if snap.get("ok") else "bad", aid)
        self.save(True)
        return self.public(acc)

    async def flatten(self, aid: str) -> dict:
        """The red button: cancel every order and close every position of the robots on this account, and stop auto."""
        import asyncio
        acc = self.account(aid)
        if not acc:
            raise KeyError(aid)
        magics = {r["magic"] for r in self.state["robots"]}

        def work():
            lib, full = self.lib(acc), self.full(acc)
            snap = lib.snapshot(full, day_start(datetime.now(UTC)).timestamp())
            if not snap.get("ok"):
                return snap.get("error")
            n = 0
            for o in snap["orders"]:
                if o.get("magic") in magics:
                    lib.cancel(full, o["ticket"])
                    n += 1
            for p in snap["positions"]:
                if p.get("magic") in magics:
                    lib.close(full, p["ticket"])
                    n += 1
            return n
        res = await (asyncio.wrap_future(mt5.run(work)) if acc.get("link", "mt5") == "mt5" else asyncio.to_thread(work))
        acc["mode"] = "observar"
        self.note(f"«{acc['name']}»: botão vermelho — {res if isinstance(res, str) else f'{res} ordens/posições dos robôs fechadas'}; modo observar.", "warn", aid)
        self.save(True)
        return {"ok": not isinstance(res, str), "result": res}

    async def size(self, aid: str, symbol: str, entry: float, stop: float, risk_pct: float) -> dict:
        import asyncio
        acc = self.account(aid)
        if not acc:
            raise KeyError(aid)
        snap = self.snaps.get(aid) or {}
        money = (snap.get("balance") or acc.get("size") or PAPER) * risk_pct / 100
        fn = self.lib(acc).size
        if acc.get("link", "mt5") == "mt5":
            return await asyncio.wrap_future(mt5.run(fn, self.full(acc), symbol, entry, stop, money))
        return await asyncio.to_thread(fn, self.full(acc), symbol, entry, stop, money)

    # ---------------------------------------------------------------- what the page gets
    def out(self) -> dict:
        now = datetime.now(UTC)
        robots = sorted((self.view(r, now) for r in self.state["robots"]), key=lambda r: r["seat"])
        accs = [self.public(a) for a in self.state["accounts"]]
        real = [a for a in accs if a["snap"].get("ok")]
        tape = []
        for s in FOCUS:
            a = ROOM.view.get(s)
            if a:
                closes = [c[4] for c in ROOM.store.get(s, "M5")[-72:]]
                tape.append({"id": s, "price": a["price"], "chg": a["chg"], "dp": a["dp"], "open": a["open"], "spark": closes})
        squads = {}
        for r in robots:
            q = squads.setdefault(r["squad"], {"name": r["squad"], "pnl": 0.0, "n": 0, "on": 0})
            q["pnl"] = round(q["pnl"] + r["day_pnl"] + r["live_pnl"], 2)
            q["n"] += 1
            q["on"] += r["state"] in ("trade", "wait")
        return {"now": now.isoformat(), "robots": robots, "accounts": accs, "squads": list(squads.values()), "tape": tape,
                "totals": {"balance": round(sum(a["snap"]["equity"] for a in real), 2) if real else None,
                           "currency": real[0]["snap"].get("currency") if real else "USD",
                           "day": round(sum(r["day_pnl"] + r["live_pnl"] for r in robots), 2),
                           "ops": sum(r["ops"] for r in robots), "working": sum(r["state"] in ("trade", "wait") for r in robots),
                           "on": sum(r["on"] for r in robots), "n": len(robots), "paper": not real},
                "presets": [{"id": k, **v} for k, v in PRESETS.items()], "links": [{"id": k, "name": v["name"]} for k, v in LINKS.items()],
                "mt5": mt5.installed(), "log": self.state["log"][:40], "agents": [{"id": k, "name": v} for k, v in AGENTS.items()],
                "focus": FOCUS, "day_start": day_start(now).isoformat()}


OFFICE = Office()


async def loop():
    import asyncio
    await asyncio.sleep(15)   # after the room has its first prices
    while True:
        started = time.time()
        try:
            if OFFICE.accounts_to_read():
                await OFFICE.tick()
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("robots tick")
        await asyncio.sleep(max(5.0, 15 - (time.time() - started)))
