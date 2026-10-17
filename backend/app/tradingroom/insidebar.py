"""The third model of the room: the inside bar of the daily chart, only with the daily trend. It came out of a study of
2676 combinations (10 classic patterns × parameters × six instruments, OANDA candles, spread paid, chosen on 2006–2019
and checked on 2020–2026) as the one with the best hit rate that still pays: on gold, 289 trades in 20 years, 67% won,
profit factor 1,96, 16 of 21 years positive; 70% won and PF 2,32 on the years it was not chosen on. Nasdaq 100 next
(68%, PF 2,10 on 2020–2026). On EUR/USD, GER40 and US30 it did not hold up, so it does not run there.

The rules: yesterday's candle sits inside the one before (lower high, higher low). EMA 50 above EMA 200 on D1 → only a
buy stop at yesterday's high; below → only a sell stop at yesterday's low. Good for today only; a day that breaks both
sides is skipped. Stop at the other side of the mother candle, target 1R, at most 20 days."""
from __future__ import annotations

from datetime import datetime, timezone

from .technicals import ema

UTC = timezone.utc
T, O, H, L, C = range(5)
SYMBOLS = {"XAUUSD": "Ouro: 289 trades em 20 anos, 67% ganhas, PF 1,96 (2020–26: 70%, PF 2,32)",
           "NAS100": "Nasdaq 100: 2020–26 68% ganhas, PF 2,10"}
SCORE = 85


def setups(inst_id: str, closed: list, live, dp: int, now: datetime) -> list[dict]:
    """The inside bar order for today, if there is one (with what today's candle already did to it)."""
    if inst_id not in SYMBOLS or len(closed) < 210:
        return []
    m, x = closed[-2], closed[-1]
    if not (x[H] < m[H] and x[L] > m[L]):
        return []
    closes = [c[C] for c in closed]
    e50, e200 = ema(closes, 50)[-1], ema(closes, 200)[-1]
    buy = e50 > e200
    sign = 1 if buy else -1
    entry = x[H] if buy else x[L]
    stop = m[L] if buy else m[H]
    risk = abs(entry - stop)
    if risk <= 0:
        return []
    target = entry + sign * risk
    status = "armed"
    if live:
        took_long, took_short = live[H] > x[H], live[L] < x[L]
        if took_long and took_short:
            return []   # both sides broken today: the rules skip the day
        filled = took_long if buy else took_short
        if filled:
            status = "won" if ((live[H] >= target) if buy else (live[L] <= target)) else \
                "stopped" if ((live[L] <= stop) if buy else (live[H] >= stop)) else "active"
        elif took_long or took_short:
            return []   # broke the side against the trend: nothing to do today
    if status not in ("armed", "active"):
        return []
    word = "compra" if buy else "venda"
    return [{
        "kind": "ib", "key": f"ib:{'buy' if buy else 'sell'}:D1:{int(x[T])}", "dir": "buy" if buy else "sell", "tf": "D1",
        "zone": [x[L], x[H]], "entry": entry, "stop": stop, "targets": [{"p": target, "label": "1R", "kind": ""}], "rr": 1.0,
        "status": status, "age": 0, "t": x[T], "price_in_zone": bool(live and x[L] <= live[C] <= x[H]),
        "score": SCORE, "grade": "A+", "news_risk": [], "gap": None, "ob": None,
        "why": [f"Inside bar no D1 ({x[L]:.{dp}f}–{x[H]:.{dp}f}) dentro da vela anterior",
                f"Tendência D1: EMA 50 {'acima' if buy else 'abaixo'} da EMA 200 → só {word}s",
                f"Ordem stop em {entry:.{dp}f}, stop no outro lado da vela-mãe ({stop:.{dp}f}), alvo 1R",
                f"Backtest: {SYMBOLS[inst_id]}"],
        "plan": (f"Ontem o D1 fez uma inside bar ({x[L]:.{dp}f}–{x[H]:.{dp}f}) com a tendência diária de "
                 f"{'alta' if buy else 'baixa'}. Hoje, se o preço romper {entry:.{dp}f}, a ordem stop entra na {word} e o "
                 f"alvo é {target:.{dp}f} (1R). Se romper primeiro o lado contrário, o dia não conta. Dura até 20 dias."),
        "trigger": f"ordem stop em {entry:.{dp}f} (rompimento da inside bar a favor da tendência)",
        "order": "stop", "swing": True, "max_h": 20 * 24,
        "valid_h": max(1.0, (live[T] + 86400 - now.timestamp()) / 3600) if live else 24.0,   # to the end of today's candle
    }]
