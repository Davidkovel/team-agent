"""Smart Money Concepts on a list of candles: swings, structure (BOS and CHoCH), fair value gaps, order blocks, the
liquidity resting above highs and below lows, its sweeps, and the setups that come out of them (sweep → change of
structure → gap or block to enter from → the liquidity on the other side as the target).

Pure functions, no I/O. A candle is a tuple (t, o, h, l, c): unix seconds, oldest first. The caller passes closed
candles only; the one still open is only used for the price of now."""
from __future__ import annotations

T, O, H, L, C = range(5)


def atr(cs: list, n: int = 14) -> float:
    """Wilder's average true range over the whole list (the last value)."""
    if not cs:
        return 0.0
    if len(cs) < 2:
        return cs[0][H] - cs[0][L]
    trs = [max(cs[i][H] - cs[i][L], abs(cs[i][H] - cs[i - 1][C]), abs(cs[i][L] - cs[i - 1][C])) for i in range(1, len(cs))]
    a = sum(trs[:n]) / min(n, len(trs))
    for tr in trs[n:]:
        a = (a * (n - 1) + tr) / n
    return a or 1e-9


def swings(cs: list, k: int = 2) -> list[dict]:
    """Fractal highs and lows: higher (lower) than the k candles on each side. ci: where it is confirmed."""
    out = []
    for i in range(k, len(cs) - k):
        h, low = cs[i][H], cs[i][L]
        if all(h > cs[j][H] for j in range(i - k, i)) and all(h >= cs[j][H] for j in range(i + 1, i + k + 1)):
            out.append({"i": i, "ci": i + k, "kind": "H", "p": h, "t": cs[i][T]})
        if all(low < cs[j][L] for j in range(i - k, i)) and all(low <= cs[j][L] for j in range(i + 1, i + k + 1)):
            out.append({"i": i, "ci": i + k, "kind": "L", "p": low, "t": cs[i][T]})
    return out


def _block(cs: list, a: int, b: int, up: bool) -> dict | None:
    """The order block of a leg that broke structure: for a break up, the last down candle at or just before the lowest
    point of the leg (from a to b); for a break down, the last up candle at or before its highest point."""
    if a > b:
        return None
    m = min(range(a, b + 1), key=lambda x: cs[x][L]) if up else max(range(a, b + 1), key=lambda x: cs[x][H])
    pick = m
    for x in range(m, max(m - 6, 0) - 1, -1):
        if (cs[x][C] < cs[x][O]) if up else (cs[x][C] > cs[x][O]):
            pick = x
            break
    return {"dir": "up" if up else "down", "i": pick, "t": cs[pick][T], "top": cs[pick][H], "bot": cs[pick][L],
            "body": sorted((cs[pick][O], cs[pick][C]))}


def structure(cs: list, sw: list[dict]) -> tuple[str | None, list[dict]]:
    """Walks the candles in order and returns the trend now and every break of structure. A close above the latest
    confirmed swing high is a break up: a BOS when the trend was already up, a CHoCH when it was down (the character of
    the market changed). Each break carries the order block of the leg that made it."""
    trend, events, hi, lo, si = None, [], None, None, 0
    order = sorted(sw, key=lambda s: s["ci"])
    for j in range(len(cs)):
        while si < len(order) and order[si]["ci"] <= j:
            s = dict(order[si])
            si += 1
            if s["kind"] == "H":
                hi = s
            else:
                lo = s
        c = cs[j][C]
        if hi and not hi.get("broken") and c > hi["p"]:
            kind = "CHoCH" if trend == "bear" else "BOS"
            events.append({"kind": kind, "dir": "up", "i": j, "t": cs[j][T], "level": hi["p"], "swing": hi["i"],
                           "ob": _block(cs, hi["i"], j, True)})
            hi["broken"], trend = True, "bull"
        if lo and not lo.get("broken") and c < lo["p"]:
            kind = "CHoCH" if trend == "bull" else "BOS"
            events.append({"kind": kind, "dir": "down", "i": j, "t": cs[j][T], "level": lo["p"], "swing": lo["i"],
                           "ob": _block(cs, lo["i"], j, False)})
            lo["broken"], trend = True, "bear"
    return trend, events


def gaps(cs: list, a: float, min_size: float = .12) -> list[dict]:
    """Fair value gaps: three candles where the first and the third do not overlap. How much of each has been filled
    since (0 open, 1 filled through), and whether the middle candle was a displacement (a body of over 1.2 ATR)."""
    out = []
    for i in range(1, len(cs) - 1):
        p, n = cs[i - 1], cs[i + 1]
        if n[L] > p[H] and n[L] - p[H] >= min_size * a:
            out.append({"dir": "up", "i": i, "t": cs[i][T], "top": n[L], "bot": p[H]})
        elif n[H] < p[L] and p[L] - n[H] >= min_size * a:
            out.append({"dir": "down", "i": i, "t": cs[i][T], "top": p[L], "bot": n[H]})
    for g in out:
        rest = cs[g["i"] + 2:]
        size = g["top"] - g["bot"]
        if g["dir"] == "up":
            deep = min((x[L] for x in rest), default=g["top"])
            g["fill"] = max(0.0, min(1.0, (g["top"] - deep) / size)) if deep < g["top"] else 0.0
        else:
            deep = max((x[H] for x in rest), default=g["bot"])
            g["fill"] = max(0.0, min(1.0, (deep - g["bot"]) / size)) if deep > g["bot"] else 0.0
        g["state"] = "filled" if g["fill"] >= 1 else "partial" if g["fill"] > 0 else "open"
        g["strong"] = abs(cs[g["i"]][C] - cs[g["i"]][O]) >= 1.2 * a
        g["ce"] = (g["top"] + g["bot"]) / 2
    return out


def block_state(cs: list, ob: dict) -> str:
    """An order block since it formed: fresh, tapped (price came back into it) or broken (closed through it)."""
    state = "fresh"
    for x in cs[ob["i"] + 2:]:
        if ob["dir"] == "up":
            if x[C] < ob["bot"]:
                return "broken"
            if x[L] <= ob["top"]:
                state = "tapped"
        else:
            if x[C] > ob["top"]:
                return "broken"
            if x[H] >= ob["bot"]:
                state = "tapped"
    return state


def touch(cs: list, start: int, price: float, above: bool, live: tuple | None = None) -> dict:
    """What happened to the liquidity at `price` from candle `start` on. Above: buy stops over a high. A wick through it
    that closes back (on that candle or the next two) is a sweep; a close beyond that stays is the level taken."""
    for k in range(max(start, 0), len(cs)):
        x = cs[k]
        if (x[H] > price) if above else (x[L] < price):
            span = cs[k:k + 3]
            back = any((y[C] < price) if above else (y[C] > price) for y in span)
            far = max(y[H] for y in span) if above else min(y[L] for y in span)
            if not back and len(span) < 3:
                return {"state": "testing", "i": k, "t": x[T], "x": far}
            return {"state": "swept" if back else "taken", "i": k, "t": x[T], "x": far}
    if live and ((live[H] > price) if above else (live[L] < price)):
        return {"state": "testing", "i": len(cs), "t": live[T], "x": live[H] if above else live[L]}
    return {"state": "intact"}


def pools(cs: list, sw: list[dict], a: float, tol: float = .12, keep: int = 40) -> list[dict]:
    """The liquidity of the swings: every recent swing high (buy-side) and low (sell-side) and what became of it, with
    equal highs and lows (two swings within `tol` ATR of each other) marked, since stops pile up over them."""
    out = []
    recent = [s for s in sw if s["i"] >= len(cs) - 200][-keep:]
    for s in recent:
        above = s["kind"] == "H"
        st = touch(cs, s["i"] + 1, s["p"], above)
        out.append({"kind": "BSL" if above else "SSL", "label": "Topo" if above else "Fundo", "p": s["p"], "t": s["t"], "i": s["i"],
                    "state": st["state"], "x": st.get("x"), "ti": st.get("i"), "tt": st.get("t")})
    for side in ("BSL", "SSL"):
        ps = [p for p in out if p["kind"] == side]
        for x in range(len(ps)):
            for y in range(x + 1, len(ps)):
                if abs(ps[x]["p"] - ps[y]["p"]) <= tol * a and abs(ps[x]["i"] - ps[y]["i"]) >= 3:
                    ps[x]["eq"] = ps[y]["eq"] = True
    for p in out:
        if p.get("eq"):
            p["label"] = "Topos iguais" if p["kind"] == "BSL" else "Fundos iguais"
    return out


def premium(price: float, hi: float, lo: float) -> float | None:
    """Where the price sits in a dealing range: 0 at the low, 1 at the high (over .5 premium, under .5 discount)."""
    return None if hi is None or lo is None or hi <= lo else (price - lo) / (hi - lo)


def dealing_range(cs: list, sw: list[dict]) -> tuple[float | None, float | None]:
    """The range the price is dealing in: from the latest swing low to the latest swing high, each pushed out to any
    price made since (so the price is always inside it)."""
    hs = [s for s in sw if s["kind"] == "H"]
    ls = [s for s in sw if s["kind"] == "L"]
    if not hs or not ls:
        return None, None
    hi, lo = hs[-1], ls[-1]
    return max([hi["p"]] + [x[H] for x in cs[hi["i"]:]]), min([lo["p"]] + [x[L] for x in cs[lo["i"]:]])


def setups(cs: list, a: float, events: list[dict], fvg: list[dict], sweeps: list[dict], targets: list[dict],
           now_price: float, look: int = 40, within: int = 20) -> list[dict]:
    """The model the room trades: liquidity swept → structure breaks the other way within `within` candles → a gap (or
    the block) left by that displacement is where to enter, the sweep's extreme (plus a little) is the stop, and the
    nearest untouched liquidity on the other side is the target. `sweeps`: {i, x (the extreme), above, label, key};
    `targets`: {p, label, kind (BSL / SSL)} still intact. Only sweeps from the last `look` candles count."""
    out, n = [], len(cs)
    for sw in sweeps:
        if sw["i"] < n - look:
            continue
        down = sw["above"]   # buy stops taken above a high → the idea is to sell
        brk = next((e for e in events if e["i"] > sw["i"] and e["i"] <= sw["i"] + within and e["dir"] == ("down" if down else "up")), None)
        if not brk:
            continue
        leg = range(sw["i"], brk["i"] + 1)
        ext = max(cs[x][H] for x in leg) if down else min(cs[x][L] for x in leg)
        gs = [g for g in fvg if g["dir"] == ("down" if down else "up") and sw["i"] <= g["i"] <= brk["i"] + 2 and g["state"] != "filled"]
        g = max(gs, key=lambda q: q["top"] - q["bot"]) if gs else None
        # the block of this leg: the last candle against the move at or just before the sweep's extreme
        m = max(leg, key=lambda x: cs[x][H]) if down else min(leg, key=lambda x: cs[x][L])
        ob = _block(cs, max(sw["i"] - 3, 0, m - 4), m, not down)
        zone = (g["bot"], g["top"]) if g else (ob["bot"], ob["top"]) if ob else None
        if not zone:
            continue
        entry = (zone[0] + zone[1]) / 2
        stop = ext + .1 * a if down else ext - .1 * a
        risk = abs(stop - entry)
        if risk <= 0:
            continue
        side, seen_p = [], []
        for t in sorted((t for t in targets if t.get("kind") in ("SSL" if down else "BSL", "") and (t["p"] < zone[0] if down else t["p"] > zone[1])),
                        key=lambda t: -t["p"] if down else t["p"]):
            if all(abs(t["p"] - q) > .05 * a for q in seen_p):   # the same price twice (equal highs on H1 and M5) is one target
                side.append(t)
                seen_p.append(t["p"])
        tg = [t for t in side if abs(t["p"] - entry) >= risk][:2] or side[:1]
        if not tg:
            tg = [{"p": entry - 2 * risk if down else entry + 2 * risk, "label": "2R", "kind": ""}]
        rr = abs(tg[0]["p"] - entry) / risk
        # what happened since the break: stopped, missed (the target came first), in the zone, or the target reached
        status, filled = "armed", False
        for x in cs[brk["i"] + 1:]:
            if (x[H] >= stop) if down else (x[L] <= stop):
                status = "stopped"
                break
            if not filled and ((x[H] >= zone[0]) if down else (x[L] <= zone[1])):
                filled = True
                status = "active"
            if (x[L] <= tg[0]["p"]) if down else (x[H] >= tg[0]["p"]):
                status = "won" if filled else "missed"
                break
        out.append({"dir": "sell" if down else "buy", "sweep": sw, "brk": {k: brk[k] for k in ("kind", "dir", "i", "t", "level")},
                    "gap": g, "ob": ob, "zone": [min(zone), max(zone)], "entry": entry, "stop": stop, "targets": tg, "rr": rr,
                    "status": status, "age": n - 1 - brk["i"], "t": brk["t"], "price_in_zone": min(zone) <= now_price <= max(zone)})
    # one idea per break: the sweep of the most important liquidity (a key level, then equal highs/lows) names it
    seen, uniq = set(), []
    for s in sorted(out, key=lambda s: (-s["t"], not s["sweep"].get("key"), s["sweep"]["i"])):
        key = (s["dir"], s["brk"]["i"])
        if key not in seen:
            seen.add(key)
            uniq.append(s)
    return uniq
