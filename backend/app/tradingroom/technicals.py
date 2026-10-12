"""The classic read that sits next to the SMC one: moving averages (21, 50, 200) and where the price is against them,
RSI with divergences at the last two swings, the average daily range and how much of it today already used, and the
volume profile of the previous session (point of control, value area). Pure functions on (t, o, h, l, c, v) candles."""
from __future__ import annotations

from datetime import datetime, timezone

T, O, H, L, C, V = range(6)


def ema(values: list[float], n: int) -> list[float]:
    if not values:
        return []
    k, out = 2 / (n + 1), [values[0]]
    for v in values[1:]:
        out.append(v * k + out[-1] * (1 - k))
    return out


def rsi(closes: list[float], n: int = 14) -> list[float]:
    """Wilder's RSI; the first n values are 50."""
    if len(closes) <= n:
        return [50.0] * len(closes)
    gains = [max(0.0, closes[i] - closes[i - 1]) for i in range(1, len(closes))]
    losses = [max(0.0, closes[i - 1] - closes[i]) for i in range(1, len(closes))]
    ag, al = sum(gains[:n]) / n, sum(losses[:n]) / n
    out = [50.0] * (n + 1)
    for i in range(n, len(gains)):
        ag, al = (ag * (n - 1) + gains[i]) / n, (al * (n - 1) + losses[i]) / n
        out.append(100 - 100 / (1 + ag / al) if al else 100.0)
    return out


def averages(cs: list) -> dict:
    """Where the price stands against the 21, 50 and 200 EMA, and whether they are stacked (21 > 50 > 200 up, the
    reverse down)."""
    closes = [x[C] for x in cs]
    if len(closes) < 60:
        return {}
    e = {n: ema(closes, n)[-1] for n in (21, 50, 200) if len(closes) >= n}
    p = closes[-1]
    stack = "up" if e.get(200) and e[21] > e[50] > e[200] else "down" if e.get(200) and e[21] < e[50] < e[200] else "mixed"
    slope = (ema(closes, 50)[-1] - ema(closes, 50)[-6]) / (abs(p) or 1) * 100
    return {"ema": {str(k): v for k, v in e.items()}, "above": [str(k) for k, v in e.items() if p > v], "stack": stack, "slope50": slope}


def divergence(cs: list, sw: list[dict], values: list[float]) -> dict | None:
    """Regular divergence at the last two confirmed swings: a higher high with a lower RSI high (bearish), a lower
    low with a higher RSI low (bullish)."""
    hs = [s for s in sw if s["kind"] == "H"][-2:]
    ls = [s for s in sw if s["kind"] == "L"][-2:]
    out = None
    if len(hs) == 2 and hs[1]["p"] > hs[0]["p"] and values[hs[1]["i"]] < values[hs[0]["i"]] - 2:
        out = {"dir": "bear", "t": hs[1]["t"], "rsi": [round(values[hs[0]["i"]]), round(values[hs[1]["i"]])]}
    if len(ls) == 2 and ls[1]["p"] < ls[0]["p"] and values[ls[1]["i"]] > values[ls[0]["i"]] + 2:
        if not out or ls[1]["t"] > out["t"]:
            out = {"dir": "bull", "t": ls[1]["t"], "rsi": [round(values[ls[0]["i"]]), round(values[ls[1]["i"]])]}
    return out


def adr(d1: list, live, n: int = 14) -> dict | None:
    """The average daily range of the last n days and how much of it today's range already is."""
    days = d1[-n:]
    if len(days) < 5:
        return None
    avg = sum(x[H] - x[L] for x in days) / len(days)
    today = (live[H] - live[L]) if live else None
    return {"adr": avg, "today": today, "used": (today / avg) if today is not None and avg else None}


def profile(cs: list, start: float, end: float, bins: int = 48) -> dict | None:
    """Volume profile of the candles between start and end (unix seconds): the point of control (the price with the most
    volume) and the value area (70% of the volume around it). Each candle's volume is spread over its range."""
    rows = [x for x in cs if start <= x[T] < end and len(x) > V]
    if len(rows) < 12 or not sum(x[V] for x in rows):
        return None
    lo, hi = min(x[L] for x in rows), max(x[H] for x in rows)
    if hi <= lo:
        return None
    step = (hi - lo) / bins
    vol = [0.0] * bins
    for x in rows:
        a, b = int((x[L] - lo) / step), int((x[H] - lo) / step)
        a, b = max(0, min(bins - 1, a)), max(0, min(bins - 1, b))
        share = x[V] / (b - a + 1)
        for k in range(a, b + 1):
            vol[k] += share
    poc = max(range(bins), key=lambda k: vol[k])
    total, inside, a, b = sum(vol), vol[poc], poc, poc
    while inside < .7 * total and (a > 0 or b < bins - 1):
        up = vol[b + 1] if b < bins - 1 else -1
        down = vol[a - 1] if a > 0 else -1
        if up >= down:
            b += 1
            inside += up
        else:
            a -= 1
            inside += down
    mid = lambda k: lo + (k + .5) * step
    return {"poc": mid(poc), "vah": lo + (b + 1) * step, "val": lo + a * step}


def previous_session(d1_closed: list, d1_live) -> tuple[float, float] | None:
    """Start and end (unix seconds) of the last complete daily candle."""
    if not d1_closed:
        return None
    prev = d1_closed[-1] if d1_live else (d1_closed[-2] if len(d1_closed) > 1 else None)
    if not prev:
        return None
    end = d1_live[T] if d1_live else d1_closed[-1][T]
    return prev[T], end


def read(fr: dict, now: datetime) -> dict:
    """Everything above for one instrument, from its analysed frames (analysis.Frame by timeframe)."""
    out: dict = {}
    for tf in ("H1", "H4", "D1"):
        f = fr.get(tf)
        if f is not None and f.ok:
            out.setdefault("ma", {})[tf] = averages(f.closed + ([f.live] if f.live else []))
    for tf in ("H1", "H4"):
        f = fr.get(tf)
        if f is not None and f.ok:
            values = rsi([x[C] for x in f.closed])
            out.setdefault("rsi", {})[tf] = round(values[-1], 1)
            dv = divergence(f.closed, f.sw, values)
            if dv and now.timestamp() - dv["t"] < 3 * 86400:
                out.setdefault("div", {})[tf] = dv
    d1 = fr.get("D1")
    if d1 is not None and d1.ok:
        out["adr"] = adr(d1.closed, d1.live)
        win = previous_session(d1.closed, d1.live)
        m5 = fr.get("M15")
        if win and m5 is not None and m5.ok:
            out["vp"] = profile(m5.closed, *win)
    return out
