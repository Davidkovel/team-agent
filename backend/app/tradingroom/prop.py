"""O Desafio 50k: each agent of the room trades its paper book as if it were a prop-firm account of 50 000 $.

17 nov, Marco: «na sala de trading, onde os gajos estão a fazer o paper trading... como se fosse uma funda de 50k, para
sabermos se eles estão a compensar ou não... têm de ter cuidado com as apostas que metem, com o risco, com as regras todas
que normalmente as fundas têm... tomar atenção a esses pequenos pormenores todos».

The rules are a 2-step challenge as FundedNext's Stellar (the firm the team uses, fundednext.py):
- **Fase 1**: +8 % (4 000 $) and at least 5 trading days. **Fase 2**: +5 % (2 500 $), 5 days. Then the **conta financiada**:
  80 % of the profit every 14 days (the balance goes back to 50 000 $ after each payout, as the firms do).
- **Perda diária** 5 %: the equity may never be more than 5 % of the day's starting balance below it (the day turns at
  midnight in Lisbon). **Perda máxima** 10 %: the equity never under 45 000 $ (static, from the start).
- Breaking either = the account is lost; the next trade starts a new attempt from Fase 1 (each attempt costs the fee, `FEE`).
- **Risco por trade**: each trade says how much of the balance it risks (`risco`, 0.25 % to 1 %, 0.5 % when not said); the Hub
  refuses one that would risk more than 1 %, put more than 2 % at risk at once, or that would break the day's loss limit if
  every open stop were hit (`guard`). **Notícias**: no new trade 5 min before or after a high-impact figure of its currency.

Everything is replayed from the book's trades (deterministic, nothing stored): a trade counts in the money when it closes,
at the balance of then × its risk; the worst moment of a trade (its MAE) is checked against the limits on the day it closed;
open trades count at the price of now. Trades in R already have the spread taken off (book.py).
"""
from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone

from .book import DONE, local

UTC = timezone.utc
SIZE = 50_000.0
PHASES = [{"id": "p1", "name": "Fase 1", "target": 8.0, "min_days": 5},
          {"id": "p2", "name": "Fase 2", "target": 5.0, "min_days": 5},
          {"id": "funded", "name": "Conta financiada", "target": None, "min_days": 0}]
DAILY, MAXLOSS = 5.0, 10.0
RISK_DEFAULT, RISK_MIN, RISK_MAX, OPEN_MAX = 0.5, 0.25, 1.0, 2.0
SPLIT, PAYOUT_DAYS, FEE = 80.0, 14, 299.0
NEWS_MIN = 5
RULES = {"size": SIZE, "phases": PHASES, "daily": DAILY, "max": MAXLOSS, "risk_default": RISK_DEFAULT, "risk_max": RISK_MAX,
         "open_max": OPEN_MAX, "split": SPLIT, "payout_days": PAYOUT_DAYS, "fee": FEE, "news_min": NEWS_MIN}


def _ts(s) -> float:
    if not s:
        return 0.0
    try:
        return datetime.fromisoformat(s).replace(tzinfo=UTC).timestamp() if isinstance(s, str) else float(s)
    except ValueError:
        return 0.0


def day_of(ts: float) -> str:
    return local(ts).strftime("%Y-%m-%d")


def risk_of(t: dict) -> float:
    try:
        r = float(t.get("risk_pct") or RISK_DEFAULT)
    except (TypeError, ValueError):
        r = RISK_DEFAULT
    return max(RISK_MIN, min(RISK_MAX, r))


def currencies(sym: str) -> set[str]:
    """The currencies whose figures move an instrument (for the news rule)."""
    s = sym.upper()
    out = {c for c in ("USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "NZD") if c in s}
    if s.startswith(("GER", "DE", "EU50", "FRA")):
        out.add("EUR")
    if s.startswith(("NAS", "US30", "US500", "SPX", "XAU", "XAG", "BTC", "ETH", "WTI", "USO")):
        out.add("USD")
    return out or {"USD"}


class Account:
    """One attempt of one agent, replayed."""

    def __init__(self, n: int, start: float):
        self.n, self.start = n, start
        self.phase = 0
        self.phase_start = start
        self.balance = SIZE
        self.day = ""
        self.day_start = SIZE
        self.day_low = SIZE              # the day's lowest equity seen
        self.days: set[str] = set()      # trading days of the phase
        self.peak = SIZE
        self.trades = 0
        self.wins = 0
        self.end: float | None = None
        self.why = ""
        self.history: list[dict] = []    # phases passed, payouts
        self.paid = 0.0
        self.last_payout = start
        self.curve: list[list] = []

    @property
    def ph(self) -> dict:
        return PHASES[self.phase]

    def roll_day(self, ts: float):
        d = day_of(ts)
        if d != self.day:
            self.day, self.day_start, self.day_low = d, self.balance, self.balance

    def daily_floor(self) -> float:
        return self.day_start * (1 - DAILY / 100)

    def max_floor(self) -> float:
        return SIZE * (1 - MAXLOSS / 100)

    def apply(self, t: dict) -> None:
        """A closed trade: its worst moment against the limits, then its result in the balance."""
        if self.end:
            return
        opened, closed = _ts(t.get("filled_at") or t["at"]), _ts(t.get("closed_at"))
        self.roll_day(closed)
        self.days.add(day_of(opened))
        money_r = self.balance * risk_of(t) / 100
        worst = self.balance - (t.get("mae") or 0) * money_r
        self.day_low = min(self.day_low, worst)
        if self.breach(worst, closed, t):
            return
        pnl = (t["r"] or 0) * money_r
        self.balance += pnl
        self.day_low = min(self.day_low, self.balance)
        self.trades += 1
        self.wins += (t["r"] or 0) > 0.05
        self.peak = max(self.peak, self.balance)
        self.curve.append([round(closed), round(self.balance, 2)])
        if self.breach(self.balance, closed, t):
            return
        self.check_phase(closed)

    def breach(self, equity: float, ts: float, t: dict | None) -> bool:
        if equity <= self.daily_floor() + 1e-6:
            self.end, self.why = ts, f"Perda diária: o dia começou com {fmt(self.day_start)} e chegou a {fmt(equity)} (limite {fmt(self.daily_floor())})"
        elif equity <= self.max_floor() + 1e-6:
            self.end, self.why = ts, f"Perda máxima: a conta chegou a {fmt(equity)} (limite {fmt(self.max_floor())})"
        else:
            return False
        if t is not None:
            self.why += f", na trade #{t['id']} {t['symbol']}"
        self.balance = min(self.balance, equity)
        return True

    def check_phase(self, ts: float):
        ph = self.ph
        if ph["target"] is not None:
            if self.balance - SIZE >= SIZE * ph["target"] / 100 and len(self.days) >= ph["min_days"]:
                self.history.append({"kind": "passed", "phase": ph["name"], "at": ts, "days": len(self.days), "trades": self.trades,
                                     "profit": round(self.balance - SIZE, 2)})
                self.phase += 1
                self.phase_start, self.balance, self.days, self.peak = ts, SIZE, set(), SIZE
                self.day, self.trades, self.wins = "", 0, 0
                self.last_payout = ts
                self.curve = []

    def payout(self, now: float):
        """Funded: every 14 days, 80 % of the profit, and the balance back to the start."""
        if self.ph["id"] != "funded" or self.end:
            return
        while now - self.last_payout >= PAYOUT_DAYS * 86400:
            self.last_payout += PAYOUT_DAYS * 86400
            profit = self.balance - SIZE
            if profit > 0:
                pay = profit * SPLIT / 100
                self.paid += pay
                self.history.append({"kind": "payout", "at": self.last_payout, "profit": round(profit, 2), "paid": round(pay, 2)})
                self.balance, self.peak = SIZE, SIZE


def fmt(v: float) -> str:
    return f"{v:,.0f} $".replace(",", " ")


def replay(trades: list[dict], agent: str, now: float | None = None) -> list[Account]:
    """Every attempt of an agent, from its first trade."""
    now = now or time.time()
    done = sorted((t for t in trades if t["agent"] == agent and t["status"] in DONE and t.get("closed_at")), key=lambda t: _ts(t["closed_at"]))
    out: list[Account] = []
    acc: Account | None = None
    for t in done:
        if acc is None or acc.end:
            if acc is not None and _ts(t.get("filled_at") or t["at"]) < acc.end:   # opened before the breach: part of the lost one
                continue
            acc = Account(len(out) + 1, _ts(t.get("filled_at") or t["at"]))
            out.append(acc)
        acc.payout(_ts(t["closed_at"]))
        acc.apply(t)
    if acc is not None:
        acc.payout(now)
    return out


def account(trades: list[dict], agent: str, view: dict, now: float | None = None) -> dict:
    """The agent's challenge as the page shows it: the attempt running now (with its open trades at the price of now), the
    rules' meters, and the history (accounts lost, phases passed, money paid out, what the fees would have cost)."""
    from .book import Book
    now = now or time.time()
    accs = replay(trades, agent, now)
    acc = accs[-1] if accs and not accs[-1].end else None
    if acc is None:   # a fresh attempt waits for the next trade
        acc = Account(len(accs) + 1, now)
        fresh = True
    else:
        fresh = False
    acc.roll_day(now)
    book = Book({"trades": trades})
    live, open_risk = [], 0.0
    for t in book.active(agent):
        rp = risk_of(t)
        money_r = acc.balance * rp / 100
        if t["status"] == "open":
            lr = book.live_r(t, view)
            live.append({"id": t["id"], "symbol": t["symbol"], "dir": t["dir"], "risk_pct": rp, "money_r": round(money_r, 2),
                         "pnl": round((lr or 0) * money_r, 2) if lr is not None else None})
            open_risk += rp if not t.get("half") else 0   # after the 1st target the stop is at the entry: nothing at risk
        else:
            open_risk += 0   # a pending order risks nothing until it fills
    floating = sum(x["pnl"] or 0 for x in live)
    equity = acc.balance + floating
    ph = acc.ph
    dfloor, mfloor = acc.daily_floor(), acc.max_floor()
    day_used = max(0.0, acc.day_start - min(equity, acc.day_low))
    day_limit = acc.day_start - dfloor
    max_used = max(0.0, SIZE - min(equity, acc.balance))
    target = SIZE * ph["target"] / 100 if ph["target"] else None
    lost = [a for a in accs if a.end]
    passed = [h for a in accs for h in a.history if h["kind"] == "passed"]
    paid = sum(a.paid for a in accs)
    attempts = max(1, len(accs) + (1 if fresh and accs else 0))   # each attempt is a challenge bought
    fees = FEE * attempts
    state = "fresh" if fresh else "funded" if ph["id"] == "funded" else "run"
    danger = day_used / day_limit * 100 if day_limit else 0
    out = {
        "agent": agent, "n": acc.n, "phase": ph, "phase_i": acc.phase, "state": state, "start": acc.start, "phase_start": acc.phase_start,
        "balance": round(acc.balance, 2), "equity": round(equity, 2), "floating": round(floating, 2), "open": live,
        "open_risk": round(open_risk, 2), "trades": acc.trades, "wins": acc.wins, "curve": acc.curve[-80:],
        "target": target and {"need": round(target, 2), "have": round(acc.balance - SIZE, 2),
                              "pct": round(max(0.0, (acc.balance - SIZE) / target * 100), 1)},
        "days": {"need": ph["min_days"], "have": len(acc.days)},
        "daily": {"limit": round(day_limit, 2), "used": round(day_used, 2), "pct": round(danger, 1), "floor": round(dfloor, 2), "start": round(acc.day_start, 2)},
        "max": {"limit": SIZE * MAXLOSS / 100, "used": round(max_used, 2), "pct": round(max_used / (SIZE * MAXLOSS / 100) * 100, 1), "floor": mfloor},
        "left_today": round(max(0.0, min(day_limit - day_used, (SIZE * MAXLOSS / 100) - max_used)), 2),
        "history": {"attempts": attempts, "lost": len(lost), "passed": passed[-6:],
                    "lost_list": [{"n": a.n, "at": a.end, "why": a.why, "trades": a.trades} for a in lost][-6:],
                    "payouts": [h for a in accs for h in a.history if h["kind"] == "payout"][-6:], "paid": round(paid, 2),
                    "fees": round(fees, 2), "net": round(paid - fees, 2)},
    }
    out["verdict"] = verdict(out)
    return out


def verdict(a: dict) -> dict:
    """In one line, for someone who does not trade: is this agent paying for itself?"""
    h = a["history"]
    if h["paid"] > h["fees"]:
        return {"word": "Compensa", "tone": "ok", "text": f"Já recebeu {fmt(h['paid'])} em levantamentos, mais do que os {fmt(h['fees'])} das contas."}
    if a["state"] == "funded":
        return {"word": "Financiada", "tone": "ok", "text": "Passou as duas fases: agora cada 14 dias leva 80 % do lucro."}
    if h["lost"] >= 3 and not h["passed"]:
        return {"word": "Não compensa", "tone": "bad", "text": f"Já queimou {h['lost']} contas ({fmt(h['lost'] * FEE)} em taxas) sem passar nenhuma fase."}
    if a["daily"]["pct"] >= 70 or a["max"]["pct"] >= 70:
        return {"word": "Em perigo", "tone": "bad", "text": "Está perto de um limite: mais uma perda pode queimar a conta."}
    if a["phase_i"] == 1:
        return {"word": "Na fase 2", "tone": "warn", "text": "Passou a fase 1: falta a 2.ª para ficar com uma conta financiada."}
    if a["state"] == "fresh":
        return {"word": "À espera", "tone": "mute", "text": "Ainda sem trades nesta conta."}
    return {"word": "A tentar", "tone": "warn", "text": f"Fase 1 a {a['target']['pct']:.0f} % do objetivo." if a.get("target") else "A tentar."}


def guard(trades: list[dict], t: dict, view: dict, calendar: list[dict], now: datetime) -> str | None:
    """Before a trade is booked: the prop rules a careful trader keeps. Returns why it is refused, or None."""
    rp = risk_of(t)
    asked = t.get("risk_pct_asked")
    if asked is not None and asked > RISK_MAX + 1e-9:
        return f"risco de {asked:g} % por trade: o máximo é {RISK_MAX:g} %".replace(".", ",")
    a = account(trades, t["agent"], view, now.timestamp())
    if a["open_risk"] + rp > OPEN_MAX + 1e-9:
        return f"já tem {a['open_risk']:g} % em risco: com esta passava de {OPEN_MAX:g} % ao mesmo tempo".replace(".", ",")
    pending_risk = sum(risk_of(x) for x in trades if x["agent"] == t["agent"] and x["status"] == "pending")
    worst = a["balance"] * (a["open_risk"] + pending_risk + rp) / 100
    if a["daily"]["used"] + worst > a["daily"]["limit"] - 1e-6:
        return (f"se todos os stops fossem tocados perdia {fmt(a['daily']['used'] + worst)} hoje: passava a perda diária de "
                f"{fmt(a['daily']['limit'])}")
    if a["max"]["used"] + worst > a["max"]["limit"] - 1e-6:
        return f"se todos os stops fossem tocados a conta passava a perda máxima ({fmt(a['max']['floor'])})"
    cur = currencies(t["symbol"])
    for e in calendar or []:
        if e.get("imp", 0) < 3 or (e.get("ccy") or "") not in cur or not e.get("t"):
            continue
        try:
            et = datetime.fromisoformat(str(e["t"]).replace("Z", "+00:00"))
        except ValueError:
            continue
        if et.tzinfo is None:
            et = et.replace(tzinfo=UTC)
        if abs((et - now).total_seconds()) <= NEWS_MIN * 60 and t.get("market"):
            return f"notícia de alto impacto ({e.get('ccy')}: {e.get('pt') or e.get('title')}) a menos de {NEWS_MIN} min: as fundas não deixam"
    return None


def board(trades: list[dict], agents: list[str], view: dict) -> list[dict]:
    from .book import AGENTS
    out = []
    for ag in agents:
        a = account(trades, ag, view)
        a["name"] = AGENTS.get(ag, ag)
        out.append(a)
    rank = {"Compensa": 0, "Financiada": 1, "Na fase 2": 2, "A tentar": 3, "Em perigo": 4, "À espera": 5, "Não compensa": 6}
    out.sort(key=lambda a: (rank.get(a["verdict"]["word"], 9), -a["history"]["net"], -(a["equity"] - SIZE)))
    return out


def brief(trades: list[dict], agent: str, view: dict) -> str:
    """What the agent reads about its own account before a meeting (council.py)."""
    a = account(trades, agent, view)
    ph = a["phase"]
    lines = [f"A tua conta de 50 000 $ (Desafio, tentativa {a['n']}, {ph['name']}): saldo {fmt(a['balance'])}, capital agora {fmt(a['equity'])}."]
    if a["target"]:
        lines.append(f"Objetivo da fase: +{fmt(a['target']['need'])} (tens {a['target']['have']:+,.0f} $), mínimo {ph['min_days']} dias de trading (tens {a['days']['have']}).".replace(",", " "))
    lines.append(f"Hoje: perda diária usada {fmt(a['daily']['used'])} de {fmt(a['daily']['limit'])} (5 % do saldo do início do dia). "
                 f"Perda máxima usada {fmt(a['max']['used'])} de {fmt(a['max']['limit'])} (a conta nunca abaixo de {fmt(a['max']['floor'])}).")
    lines.append(f"Risco aberto: {a['open_risk']:g} % (máximo {OPEN_MAX:g} % ao mesmo tempo). Podes perder ainda {fmt(a['left_today'])} hoje.".replace(".", ",", 1))
    h = a["history"]
    if h["lost"]:
        lines.append(f"Já perdeste {h['lost']} contas: " + "; ".join(x["why"] for x in h["lost_list"][-2:]) + ".")
    lines.append("Regras da funda: cada trade diz o \"risco\" em % do saldo (0,25 a 1; 0,5 se não disseres). Passar a perda diária ou a "
                 "máxima, mesmo só com a trade aberta no pior momento, queima a conta e recomeças na Fase 1. Nada de trades novas "
                 f"{NEWS_MIN} min antes ou depois de notícias de alto impacto. Depois de duas perdas seguidas no mesmo dia, baixa o risco.")
    return "\n".join(lines)
