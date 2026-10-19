"""The trading book of the room: every trade the Pinguim and the Duas-Caras decide at a meeting (and, as a yardstick,
every A/A+ setup of the SMC model), followed candle by candle until it ends, and the statistics of each one.

Paper trading, with the rules a desk would use and no favours:
- an order is a limit at `entry` (a buy limit above the price, or a sell limit below it, is filled at once, at the price),
  or, with `ordem: stop`, a stop order (a buy above the price fills when the price trades up to it, at the open when it
  gaps past); it lives until `valid`; if the first target is reached before it fills, it missed;
- once open: the stop is the stop. With two targets, half closes at the first and the stop of the rest goes to the entry;
  with one, all of it closes there. Open for 72 hours (`max_h` for a swing trade): closed at the price of then;
- `swing: true` (the inside bar of D1): entry and stop are checked against the daily ATR instead of the H1 one;
- each candle is read in the worst order for the trade: a candle that touches the stop and the target counts as the stop,
  and on the candle that fills the order only the stop counts;
- the result is in R (multiples of what was risked), less the typical spread of the instrument;
- good trade: won; bad: lost; neutral: closed at the entry. Expired and missed orders were never trades.
Candles: M5, and H1 for the part M5 no longer covers (a Hub that was off). Trades live in the room's state file."""
from __future__ import annotations

import re
import time
from datetime import datetime, timedelta, timezone

from .markets import BY_ID, INSTRUMENTS
from .sessions import london_offset

UTC = timezone.utc
AGENTS = {"penguin": "Pinguim", "twoface": "Duas-Caras", "model": "Modelo", "ema": "EMA 125/200", "vwap": "VWAP + EMA", "combo": "Combinado"}
ACTIVE = ("pending", "open")
DONE = ("won", "lost", "be")
MAX_NEW, MAX_ACTIVE, MAX_HOURS, TIME_STOP_H = 2, 4, 24, 72


def num(v) -> float | None:
    """A price as the agents write it: 4196.5, "4 196,54", "4196,5"."""
    if isinstance(v, (int, float)):
        return float(v)
    if not isinstance(v, str):
        return None
    s = re.sub(r"[\s  ]", "", v)
    if "," in s and "." in s:
        s = s.replace(".", "").replace(",", ".") if s.rfind(",") > s.rfind(".") else s.replace(",", "")
    else:
        s = s.replace(",", ".")
    m = re.search(r"-?\d+(\.\d+)?", s)
    return float(m.group(0)) if m else None


def iso(t: datetime) -> str:
    return t.isoformat(timespec="seconds")


def local(ts: float) -> datetime:
    """A moment in Lisbon time (the room speaks Lisbon time; it is also this PC's)."""
    t = datetime.fromtimestamp(ts, UTC)
    return (t + timedelta(hours=london_offset(t))).replace(tzinfo=None)


def hm(ts: float) -> str:
    return local(ts).strftime("%H:%M")


def window(text, now: datetime) -> tuple[str, str] | None:
    """ "14:30-16:00" (Lisbon) as UTC, today or, when it has already gone by, tomorrow."""
    m = re.findall(r"(\d{1,2})[:hH.]?(\d{2})?", str(text or ""))
    if len(m) < 2:
        return None
    off = timedelta(hours=london_offset(now))
    day = (now + off).replace(tzinfo=None, hour=0, minute=0, second=0, microsecond=0)
    a, b = [day + timedelta(hours=int(h) % 24, minutes=int(mm or 0)) for h, mm in m[:2]]
    if b <= a:
        b += timedelta(days=1)
    if b < (now + off).replace(tzinfo=None):
        a, b = a + timedelta(days=1), b + timedelta(days=1)
    return iso((a - off).replace(tzinfo=UTC)), iso((b - off).replace(tzinfo=UTC))


def _ts(s: str | None) -> float:
    return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp() if s else 0.0


class Book:
    def __init__(self, state: dict):
        self.state = state
        state.setdefault("trades", [])

    @property
    def trades(self) -> list[dict]:
        return self.state["trades"]

    def active(self, agent: str | None = None) -> list[dict]:
        return [t for t in self.trades if t["status"] in ACTIVE and (agent is None or t["agent"] == agent)]

    # ---------------------------------------------------------------- new trades
    def propose(self, agent: str, items: list, meeting: int | None, view: dict, now: datetime, key: str | None = None) -> list[dict]:
        """Checks and books an agent's trades; the refused ones are booked too, with the reason, so the table is honest."""
        out = []
        for it in (items or [])[:MAX_NEW]:
            if not isinstance(it, dict):
                continue
            t = self._make(agent, it, meeting, view, now, key)
            if t["status"] != "refused" and len(self.active(agent)) >= MAX_ACTIVE:
                t["status"], t["note"] = "refused", f"já tem {MAX_ACTIVE} trades ativas"
            self.trades.insert(0, t)
            out.append(t)
        del self.trades[600:]
        return out

    def _make(self, agent, it, meeting, view, now, key) -> dict:
        sym = str(it.get("simbolo") or it.get("symbol") or "").upper().replace("/", "").strip()
        d = str(it.get("direcao") or it.get("dir") or "").lower()
        side = "buy" if d.startswith(("compra", "buy", "long")) else "sell" if d.startswith(("venda", "sell", "short")) else None
        tps = [num(x) for x in (it.get("alvos") or it.get("targets") or [])][:2]
        tps = [x for x in tps if x is not None]
        t = {"id": int(time.time() * 1000) + len(self.trades) % 1000, "agent": agent, "meeting": meeting, "key": key, "at": iso(now),
             "symbol": sym, "dir": side, "entry": num(it.get("entrada") or it.get("entry")), "stop": num(it.get("stop")),
             "tp1": tps[0] if tps else None, "tp2": tps[1] if len(tps) > 1 else None, "why": str(it.get("porque") or it.get("why") or "")[:600],
             "grade": it.get("grade"), "status": "pending", "note": "", "r": None, "half": False, "mfe": 0.0, "mae": 0.0, "review": "",
             "valid": iso(now + timedelta(hours=max(1, min(MAX_HOURS, float(num(it.get("validade_h")) or 6))))), "checked": now.timestamp()}
        zone = sorted(x for x in (num(z) for z in (it.get("zona") or it.get("zone") or [])[:2]) if x is not None)
        if t["entry"] is None and len(zone) == 2:
            t["entry"] = (zone[0] + zone[1]) / 2
        win = window(it.get("janela"), now)
        t.update(plan=str(it.get("plano") or "")[:600], trigger=str(it.get("gatilho") or "")[:300], zone=zone if len(zone) == 2 else None,
                 win_from=win[0] if win else None, win_to=win[1] if win else None, invalid=num(it.get("invalida")), best=None, best_at=None)
        a = view.get(sym)
        inst = BY_ID.get(sym)

        def refuse(why):
            t["status"], t["note"] = "refused", why
            return t
        if not inst or sym not in [i["id"] for i in INSTRUMENTS]:
            return refuse("instrumento que a sala não segue")
        t["dp"] = inst["dp"]
        if not a:
            return refuse("sem preço deste instrumento")
        if not a["open"]:
            return refuse("mercado fechado")
        if side is None or None in (t["entry"], t["stop"], t["tp1"]):
            return refuse("faltam direção, entrada, stop ou alvo")
        price, atr = a["price"], a["atr"] or 1
        sign = 1 if side == "buy" else -1
        t["order"] = "stop" if str(it.get("ordem") or "").lower() == "stop" else "limit"
        t["max_h"] = max(1.0, min(24 * 30, float(num(it.get("max_h")) or TIME_STOP_H)))
        swing = bool(it.get("swing"))
        if swing:   # judged on the daily candle: its ATR, not the H1 one
            atr, unit = ((a.get("tf") or {}).get("D1") or {}).get("atr") or atr * 5, "ATR D1"
        else:
            unit = "ATR H1"
        if t["order"] == "stop":
            if (t["entry"] - price) * sign <= 0:
                return refuse("o preço já passou a entrada da ordem stop")
        elif (t["entry"] - price) * sign >= 0:   # a limit on the far side of the price fills at once, at the price
            t["entry"], t["market"] = price, True
        e, s, p1 = t["entry"], t["stop"], t["tp1"]
        if (e - s) * sign <= 0:
            return refuse("stop do lado errado da entrada")
        if (p1 - e) * sign <= 0:
            return refuse("alvo do lado errado da entrada")
        if t["tp2"] is not None and (t["tp2"] - p1) * sign <= 0:
            t["tp2"] = None
        near, lo, hi = (1.5, .2, 3) if swing else (4, .15, 6)
        if abs(price - e) > near * atr:
            return refuse(f"entrada a mais de {near:g} {unit} do preço".replace(".", ","))
        risk = abs(e - s)
        if risk < lo * atr:
            return refuse(f"stop demasiado apertado (menos de {lo:g} {unit})".replace(".", ","))
        if risk > hi * atr:
            return refuse(f"stop demasiado largo (mais de {hi:g} {unit})".replace(".", ","))
        t["risk"], t["rr"] = risk, abs(p1 - e) / risk
        if t["rr"] < 1 - 1e-9:
            return refuse(f"RR {t['rr']:.1f} abaixo de 1")
        if any(x["symbol"] == sym and x["dir"] == side for x in self.active(t["agent"])):
            return refuse("já tem uma trade igual ativa")
        t["cost"] = inst.get("spread", 0) / risk
        if t["zone"]:   # the entry is inside its zone
            t["zone"] = [min(t["zone"][0], e), max(t["zone"][1], e)]
        if t["invalid"] is None or (e - t["invalid"]) * sign < 0:   # what cancels it sits on the stop's side
            t["invalid"] = s
        if t.get("market"):
            t.update(status="open", filled_at=t["at"], fill=e)
        return t

    # ---------------------------------------------------------------- following them
    def update(self, store, now: datetime) -> bool:
        changed = False
        for t in self.trades:
            if t["status"] not in ACTIVE:
                continue
            rows = self._candles(store, t["symbol"], t["checked"])
            before = (t["status"], t["half"], round(t["mfe"], 3), round(t["mae"], 3))
            for c in rows:
                if t["status"] not in ACTIVE:
                    break
                self._step(t, c)
                t["checked"] = c[0]
            if t["status"] == "pending" and now.timestamp() > _ts(t["valid"]):
                t.update(status="expired", closed_at=t["valid"], note="expirou sem entrar")
            hold = t.get("max_h") or TIME_STOP_H
            if t["status"] == "open" and now.timestamp() - _ts(t["filled_at"]) > hold * 3600 and rows:
                self._close(t, rows[-1][4], rows[-1][0], f"fecho por tempo ({hold:g} h)")
            changed |= before != (t["status"], t["half"], round(t["mfe"], 3), round(t["mae"], 3))
        return changed

    @staticmethod
    def _candles(store, sym: str, since: float) -> list:
        m5 = store.get(sym, "M5")
        start = m5[0][0] if m5 else float("inf")
        older = [c for c in store.get(sym, "H1") if since <= c[0] and c[0] + 3600 <= start] if since < start else []
        return older + [c for c in m5 if c[0] >= since]

    def _step(self, t: dict, c):
        _, o, h, low, close = c[:5]
        buy = t["dir"] == "buy"
        if t["status"] in ("pending", "open"):   # the best price the zone gave (looking back: the perfect entry)
            p = max(low, t["stop"]) if buy else min(h, t["stop"])
            if t.get("best") is None or ((p < t["best"]) if buy else (p > t["best"])):
                t["best"], t["best_at"] = p, iso(datetime.fromtimestamp(c[0], UTC))
        if t["status"] == "pending":
            if c[0] > _ts(t["valid"]):
                return
            stop_order = t.get("order") == "stop"
            touched = ((h >= t["entry"]) if buy else (low <= t["entry"])) if stop_order else ((low <= t["entry"]) if buy else (h >= t["entry"]))
            if touched:
                if stop_order and ((o > t["entry"]) if buy else (o < t["entry"])):   # gapped past the stop order: filled at the open
                    t["entry"], t["risk"] = o, abs(o - t["stop"])
                    t["cost"] = (BY_ID.get(t["symbol"]) or {}).get("spread", 0) / (t["risk"] or 1)
                t.update(status="open", filled_at=iso(datetime.fromtimestamp(c[0], UTC)), fill=t["entry"], fill_bar=c[0])
                if (low <= t["stop"]) if buy else (h >= t["stop"]):   # on the fill candle, only the stop counts
                    self._close(t, t["stop"], c[0], "stop no candle da entrada")
                return
            if (h >= t["tp1"]) if buy else (low <= t["tp1"]):
                t.update(status="missed", closed_at=iso(datetime.fromtimestamp(c[0], UTC)), note="o preço foi ao alvo sem passar na entrada")
            elif t.get("invalid") is not None and ((close < t["invalid"]) if buy else (close > t["invalid"])):
                t.update(status="invalidated", closed_at=iso(datetime.fromtimestamp(c[0], UTC)),
                         note=f"o preço fechou {'abaixo' if buy else 'acima'} de {t['invalid']:.{t.get('dp', 2)}f} antes de entrar: a ideia morreu")
            return
        risk, e = t["risk"], t["entry"]
        # the last candle is read again on the next turn (it was still forming): on the fill candle it is still only the
        # stop that counts, and the candle that gave the 1st target cannot also stop the other half at the entry
        if c[0] == t.get("fill_bar"):
            if (low <= t["stop"]) if buy else (h >= t["stop"]):
                self._close(t, t["stop"], c[0], "stop no candle da entrada")
            return
        t["mfe"] = max(t["mfe"], ((h - e) if buy else (e - low)) / risk)
        t["mae"] = max(t["mae"], ((e - low) if buy else (h - e)) / risk)
        if t["half"] and c[0] == t.get("half_bar"):
            return
        stop = e if t["half"] else t["stop"]
        hit_stop = (low <= stop) if buy else (h >= stop)
        target = t["tp2"] if t["half"] else t["tp1"]
        hit_tp = (h >= target) if buy else (low <= target)
        if hit_stop:   # the worst order: a candle that touched both counts as the stop
            self._close(t, stop, c[0], "stop na entrada depois do 1.º alvo" if t["half"] else "stop")
        elif hit_tp:
            if not t["half"] and t["tp2"] is not None:
                t["half"], t["half_bar"] = True, c[0]
                t["note"] = "metade fechada no 1.º alvo, stop na entrada"
            else:
                self._close(t, target, c[0], "2.º alvo" if t["half"] else "alvo")

    def _close(self, t: dict, price: float, ts: float, why: str):
        e, risk, sign = t["entry"], t["risk"], 1 if t["dir"] == "buy" else -1
        r_now = (price - e) * sign / risk
        r = (.5 * abs(t["tp1"] - e) / risk + .5 * r_now) if t["half"] else r_now
        r -= t.get("cost", 0)
        t.update(r=round(r, 2), exit=price, closed_at=iso(datetime.fromtimestamp(ts, UTC)), note=why,
                 status="won" if r > .05 else "lost" if r < -.05 else "be")

    def close_now(self, agent: str, ids: list, view: dict, now: datetime, why: str = "") -> list[dict]:
        """An agent changed its mind: a pending order is cancelled, an open trade closes at the price of now."""
        out = []
        for x in ids or []:
            tid = x.get("id") if isinstance(x, dict) else x
            reason = (x.get("porque") if isinstance(x, dict) else "") or why
            t = next((t for t in self.trades if str(t["id"]) == str(tid) and t["agent"] == agent and t["status"] in ACTIVE), None)
            if not t:
                continue
            if t["status"] == "pending":
                t.update(status="cancelled", closed_at=iso(now), note=f"cancelada: {reason}"[:200])
            elif view.get(t["symbol"]):
                self._close(t, view[t["symbol"]]["price"], now.timestamp(), f"fechada à mão: {reason}"[:200])
            out.append(t)
        return out

    def review(self, agent: str, items: list):
        for x in items or []:
            if isinstance(x, dict):
                t = next((t for t in self.trades if str(t["id"]) == str(x.get("id")) and t["agent"] == agent), None)
                if t:
                    t["review"] = str(x.get("nota") or x.get("note") or "")[:400]

    # ---------------------------------------------------------------- the numbers
    def live_r(self, t: dict, view: dict) -> float | None:
        a = view.get(t["symbol"])
        if t["status"] != "open" or not a:
            return None
        r_now = (a["price"] - t["entry"]) * (1 if t["dir"] == "buy" else -1) / t["risk"]
        return round(((.5 * abs(t["tp1"] - t["entry"]) / t["risk"] + .5 * r_now) if t["half"] else r_now) - t.get("cost", 0), 2)

    def stats(self, agent: str) -> dict:
        mine = [t for t in self.trades if t["agent"] == agent]
        done = sorted([t for t in mine if t["status"] in DONE], key=lambda t: t["closed_at"])
        rs = [t["r"] for t in done]
        wins, losses = [r for r in rs if r > .05], [r for r in rs if r < -.05]
        curve, peak, dd, acc, equity = [], 0.0, 0.0, 0.0, 1.0
        for r in rs:
            acc += r
            equity *= 1 + r / 100   # 1% of the account at risk per trade
            curve.append(round(acc, 2))
            peak = max(peak, acc)
            dd = max(dd, peak - acc)
        streak, kind = 0, None
        for r in reversed(rs):
            k = "w" if r > .05 else "l" if r < -.05 else "b"
            if kind is None:
                kind = k
            if k != kind:
                break
            streak += 1
        by = {}
        for t in done:
            s = by.setdefault(t["symbol"], {"n": 0, "w": 0, "l": 0, "r": 0.0})
            s["n"] += 1
            s["w"] += t["r"] > .05
            s["l"] += t["r"] < -.05
            s["r"] = round(s["r"] + t["r"], 2)
        n = len(rs)
        return {"agent": agent, "name": AGENTS.get(agent, agent), "n": n, "wins": len(wins), "losses": len(losses), "be": n - len(wins) - len(losses),
                "winrate": round(len(wins) / n * 100, 1) if n else None, "total_r": round(sum(rs), 2), "avg_r": round(sum(rs) / n, 2) if n else None,
                "pf": round(sum(wins) / -sum(losses), 2) if losses else (None if not wins else 99.0),
                "avg_win": round(sum(wins) / len(wins), 2) if wins else None, "avg_loss": round(sum(losses) / len(losses), 2) if losses else None,
                "best": max(rs) if rs else None, "worst": min(rs) if rs else None, "max_dd": round(dd, 2), "streak": {"n": streak, "kind": kind},
                "return_pct": round((equity - 1) * 100, 2), "curve": curve[-120:], "last": [t["r"] for t in done[-12:]], "by_symbol": by,
                "open": sum(t["status"] == "open" for t in mine), "pending": sum(t["status"] == "pending" for t in mine),
                "refused": sum(t["status"] == "refused" for t in mine)}

    def journal(self, agent: str, view: dict, since: str | None) -> str:
        """What an agent reads about itself before a meeting: its numbers, what is running, and what closed since the last one
        (with the ids, to review)."""
        s = self.stats(agent)
        lines = [f"{s['name']}: {s['n']} trades fechadas, {s['wins']} ganhas, {s['losses']} perdidas, {s['be']} a zero"
                 + (f", taxa {s['winrate']:.0f}%, {s['total_r']:+.1f}R no total, expectativa {s['avg_r']:+.2f}R por trade, profit factor {s['pf']}" if s["n"] else "")]
        for t in self.active(agent):
            lr = self.live_r(t, view)
            lines.append(f"  ativa #{t['id']} {t['symbol']} {'compra' if t['dir'] == 'buy' else 'venda'} {'aberta' if t['status'] == 'open' else 'pendente'}"
                         f" · entrada {t['entry']:.{t.get('dp', 2)}f} · stop {t['stop']:.{t.get('dp', 2)}f} · alvo {t['tp1']:.{t.get('dp', 2)}f}"
                         + (f" e {t['tp2']:.{t.get('dp', 2)}f}" if t.get("tp2") else "") + (f" · agora {lr:+.2f}R" if lr is not None else "")
                         + f" · válida até às {hm(_ts(t['valid']))}" + (f" · plano: {t['plan'][:160]}" if t.get("plan") else ""))
        cut = _ts(since) if since else 0
        for t in self.trades:
            if t["agent"] == agent and t["status"] in DONE + ("refused",) and _ts(t.get("closed_at") or t["at"]) >= cut and not t["review"]:
                what = f"{t['r']:+.2f}R ({t['note']})" if t["status"] in DONE else f"recusada pelo Hub: {t['note']}"
                lines.append(f"  por rever #{t['id']} {t['symbol']} {'compra' if t['dir'] == 'buy' else 'venda'}: {what}")
        return "\n".join(lines)

    def now(self, t: dict, view: dict) -> dict:
        """In words, for whoever looks: what it is waiting for, whether the entry is still on, whether it is gone.
        can: "yes" (the order is on: put it in), "late" (it entered, but the price is still at the entry), "in" (it entered
        and went: wait for another chance), "no" (over)."""
        a, dp, now = view.get(t["symbol"]), t.get("dp", 2), time.time()
        f = lambda v: f"{v:,.{dp}f}".replace(",", " ").replace(".", ",") if v is not None else "—"
        buy, st = t["dir"] == "buy", t["status"]
        if st == "pending" and a:
            p, e = a["price"], t["entry"]
            gap, atr = abs(p - e), a["atr"] or 1
            where = f"o preço tem de {'descer' if p > e else 'subir'} {f(gap)} ({gap / atr:.1f} ATR H1) até à entrada {f(e)}".replace(".", ",", 1)
            if t.get("zone"):
                where += f", dentro da zona {f(t['zone'][0])}–{f(t['zone'][1])}"
            wtxt = ""
            if t.get("win_from"):
                wa, wb = _ts(t["win_from"]), _ts(t["win_to"])
                if now < wa:
                    mins = int((wa - now) // 60)
                    wtxt = f"Hora ideal: {hm(wa)}–{hm(wb)} (daqui a {mins // 60}h{mins % 60:02d})." if mins >= 60 else f"Hora ideal: {hm(wa)}–{hm(wb)} (daqui a {mins} min)."
                elif now <= wb:
                    wtxt = f"Hora ideal AGORA, até às {hm(wb)}."
                else:
                    wtxt = f"A hora ideal ({hm(wa)}–{hm(wb)}) já passou; a ordem ainda vale."
            cancel = f"Cancela se fechar {'abaixo' if buy else 'acima'} de {f(t.get('invalid'))} antes de entrar." if t.get("invalid") is not None else ""
            return {"can": "yes", "line": f"À espera: {where}. {wtxt} {cancel} Vale até às {hm(_ts(t['valid']))}.".replace("  ", " ")}
        if st == "open" and a:
            lr = self.live_r(t, view)
            near = abs(a["price"] - t["entry"]) <= .25 * t["risk"] and not t["half"]
            lrt = f"{lr:+.2f}".replace(".", ",") if lr is not None else ""
            head = f"Entrou às {hm(_ts(t['filled_at']))} a {f(t['entry'])}; agora {lrt}R." if lr is not None else f"Entrou às {hm(_ts(t['filled_at']))}."
            if near:
                return {"can": "late", "line": f"{head} O preço ainda está junto à entrada: ainda dá, com o mesmo stop {f(t['stop'])}."}
            return {"can": "in", "line": f"{head} Já não é a entrada: quem não entrou espera por um novo retest à zona."
                    + (" Metade já fechou no 1.º alvo e o stop está na entrada." if t["half"] else "")}
        at = hm(_ts(t["closed_at"])) if t.get("closed_at") else "—"
        lines = {"won": f"Fechou às {at} a ganhar: {t['note']}.", "lost": f"Fechou às {at} a perder: {t['note']}.", "be": f"Fechou às {at} na entrada: {t['note']}.",
                 "missed": f"Perdida: às {at} o preço foi ao alvo sem passar pela entrada.", "expired": f"Expirou às {at} sem o preço chegar à entrada.",
                 "invalidated": f"Cancelada às {at}: {t['note']}.", "cancelled": f"Cancelada às {at}: {t['note']}.", "refused": f"Recusada pelo Hub: {t['note']}."}
        return {"can": "no", "line": lines.get(st, t.get("note") or "")}

    def out(self, t: dict, view: dict) -> dict:
        return {**{k: v for k, v in t.items() if k not in ("checked", "key")}, "live_r": self.live_r(t, view), "now": self.now(t, view),
                "outcome": {"won": "boa", "lost": "má", "be": "neutra"}.get(t["status"])}
