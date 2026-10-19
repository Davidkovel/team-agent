"""The third model the room trades: the 125 and 200 EMA, on more than one timeframe.

The trend of a timeframe is the price above the 125 EMA, the 125 above the 200 and the 200 rising (the reverse for a
sell). The model enters on M15 or on H1, always with the timeframe above pointing the same way (H1 for an M15 entry,
H4 for an H1 one): the price comes back into the band between the two EMAs and is rejected there (wick into it, close
back out on the trend's side, candle of the trend's colour). Entry on the retest of the 125, stop past the pullback's
extreme and the 200, targets the untouched liquidity on the trend's side, else 2R. Scored 0–100 like the other two;
anything under A never leaves this module.

An EMA 200 needs far more candles than it is long to settle (seeded at the first close, 300 candles still carry a
third of the seed): the store keeps `markets.LONG` candles of M15, H1 and H4 for it. Pure functions on
(t, o, h, l, c, v) candles; one small cache, so the backtest does not recompute an EMA that did not change."""
from __future__ import annotations

from datetime import datetime, timezone

from . import sessions
from .technicals import ema

UTC = timezone.utc
T, O, H, L, C = range(5)
FAST, SLOW = 125, 200
UP_OF = {"M15": "H1", "H1": "H4"}   # the timeframe that must agree with an entry on this one
TREND_PT = {"bull": "alta", "bear": "baixa"}
_CACHE: dict = {}


def lines(cs: list) -> tuple[list[float], list[float]]:
    """The 125 and 200 EMA of these closed candles (cached by the first and last candle)."""
    if not cs:
        return [], []
    key = (cs[0][T], cs[-1][T], len(cs), cs[-1][C])
    hit = _CACHE.get(key)
    if hit is None:
        closes = [x[C] for x in cs]
        hit = (ema(closes, FAST), ema(closes, SLOW))
        if len(_CACHE) > 400:
            _CACHE.clear()
        _CACHE[key] = hit
    return hit


def trend(cs: list) -> str | None:
    """bull / bear when the price, the 125 and the 200 are stacked and the 200 slopes with them; None otherwise or
    with too few candles for a 200 that means anything."""
    if len(cs) < 2 * SLOW:
        return None
    f, s = lines(cs)
    p = cs[-1][C]
    if p > f[-1] > s[-1] and s[-1] > s[-11]:
        return "bull"
    if p < f[-1] < s[-1] and s[-1] < s[-11]:
        return "bear"
    return None


def read(frames: dict) -> dict:
    """The trend of each timeframe and where the two EMAs are, for the briefing and the page."""
    out = {}
    for tf in ("M15", "H1", "H4"):
        cs = frames.get(tf) or []
        if len(cs) >= 2 * SLOW:
            f, s = lines(cs)
            out[tf] = {"trend": trend(cs), "e125": f[-1], "e200": s[-1]}
    return out


def setups(frames: dict, atr: dict, targets: dict, now: datetime, adr_used: float | None, news: list[dict], dp: int,
           crypto: bool = False) -> list[dict]:
    """The EMA 125/200 pullbacks on M15 and H1 that grade A or A+. `frames`: {tf: closed candles}; `atr`: {tf: ATR};
    `targets`: {tf: [{p, label, kind (BSL/SSL)}]} untouched."""
    out = []
    for tf, look in (("M15", 8), ("H1", 4)):
        cs, up = frames.get(tf) or [], frames.get(UP_OF[tf]) or []
        a = atr.get(tf)
        if len(cs) < 2 * SLOW or not a:
            continue
        side = trend(cs)
        if side is None or trend(up) != side:
            continue   # the entry's timeframe and the one above it must both trend, and the same way
        out += _pullbacks(cs, a, side, tf, look, targets.get(tf) or [], frames, now, adr_used, news, dp, crypto)
    out.sort(key=lambda s: -s["t"])
    return out[:1]


def _pullbacks(cs, a, side, tf, look, targets, frames, now, adr_used, news, dp, crypto) -> list[dict]:
    n = len(cs)
    f, s = lines(cs)
    buy = side == "bull"
    sign = 1 if buy else -1
    out = []
    for r in range(n - look, n):
        x = cs[r]
        band = abs(f[r] - s[r])
        if band > 2.5 * a:
            continue   # the two lines far apart: a pullback to the 200 would be a reversal, not a retest
        lo_z, hi_z = min(f[r], s[r]) - .1 * a, max(f[r], s[r]) + .1 * a
        touched = (x[L] <= hi_z) if buy else (x[H] >= lo_z)
        rejected = (x[C] > f[r] and x[C] > x[O]) if buy else (x[C] < f[r] and x[C] < x[O])
        if not (touched and rejected):
            continue
        if (x[L] < s[r] - .3 * a) if buy else (x[H] > s[r] + .3 * a):
            continue   # it went well through the 200: that is not holding
        held = sum(1 for k in range(r - 20, r) if sign * (cs[k][C] - s[k]) > 0)
        if held < 16:
            continue
        rng = x[H] - x[L] or 1e-9
        wick = ((min(x[O], x[C]) - x[L]) if buy else (x[H] - max(x[O], x[C]))) / rng
        # the pullback: from the last close that was clear of the 125 on the trend's side
        p0 = r
        while p0 > r - 30 and sign * (cs[p0 - 1][C] - f[p0 - 1] - sign * .3 * a) <= 0:
            p0 -= 1
        ext = min(cs[k][L] for k in range(p0, r + 1)) if buy else max(cs[k][H] for k in range(p0, r + 1))
        # how many times the band was touched in the last 60 candles: the first one is the best
        tests, inside = 0, False
        for k in range(max(0, r - 60), r):
            z0, z1 = min(f[k], s[k]) - .1 * a, max(f[k], s[k]) + .1 * a
            hit = (cs[k][L] <= z1) if buy else (cs[k][H] >= z0)
            if hit and not inside:
                tests += 1
            inside = hit
        nth = tests + (0 if inside else 1)
        entry = f[r]
        stop = (min(ext, s[r]) - .2 * a) if buy else (max(ext, s[r]) + .2 * a)
        risk = abs(entry - stop)
        if risk < .3 * a or risk > 3 * a:
            continue
        tg, seen = [], []
        for t in sorted((t for t in targets if t.get("kind") == ("BSL" if buy else "SSL") and sign * (t["p"] - entry) >= 1.5 * risk),
                        key=lambda t: sign * t["p"]):
            if all(abs(t["p"] - q) > .05 * a for q in seen):
                tg.append(t)
                seen.append(t["p"])
        tg = tg[:2] or [{"p": entry + sign * 2 * risk, "label": "2R", "kind": ""}]
        rr = abs(tg[0]["p"] - entry) / risk
        status, filled = "armed", False
        for y in cs[r + 1:]:
            if (y[L] <= stop) if buy else (y[H] >= stop):
                status = "stopped"
                break
            if not filled and ((y[L] <= entry) if buy else (y[H] >= entry)):
                filled, status = True, "active"
            if (y[H] >= tg[0]["p"]) if buy else (y[L] <= tg[0]["p"]):
                status = "won" if filled else "missed"
                break
        if status not in ("armed", "active"):
            continue

        up = UP_OF[tf]
        pts = 40
        why = [f"Pullback às EMA 125/200 em {tf} ({'compra' if buy else 'venda'} a favor da tendência)",
               f"Preço {'acima' if buy else 'abaixo'} da EMA 125, a 125 {'acima' if buy else 'abaixo'} da 200 e a 200 a {'subir' if buy else 'descer'}",
               f"{up} na mesma tendência ({TREND_PT[side]})"]
        h4 = frames.get("H4") or []
        if tf == "M15" and len(h4) >= 2 * SLOW:
            t4 = trend(h4)
            if t4 == side:
                pts += 10
                why.append("H4 também alinhado (três tempos gráficos)")
            elif t4:
                pts -= 10
                why.append(f"H4 em {TREND_PT[t4]} (contra)")
        if wick >= .5:
            pts += 7
            why.append(f"Rejeição limpa: pavio de {round(wick * 100)}% da vela")
        if nth == 1:
            pts += 8
            why.append("1.º toque nas EMA em 60 velas")
        elif nth >= 3:
            pts -= 8
            why.append(f"{nth}.º toque nas EMA (gasto)")
        if tf == "M15" and not crypto:
            kz = sessions.killzone(datetime.fromtimestamp(x[T], UTC))
            if kz and kz["key"] in ("london", "ny", "lclose", "pm"):
                pts += 8
                why.append(f"Killzone {kz['name']}")
            else:
                pts -= 5
                why.append("Fora das killzones de Londres e Nova Iorque")
        if adr_used is not None and adr_used >= .8 and tf == "M15":
            pts -= 10
            why.append(f"{round(adr_used * 100)}% da amplitude diária já gasta")
        pts += 10 if rr >= 3 else 6 if rr >= 2 else 0
        why.append(f"RR {rr:.1f}".replace(".", ","))
        if news:
            pts -= 15
        score = max(0, min(100, pts))
        grade = "A+" if score >= 85 else "A" if score >= 70 else None
        if not grade:
            continue
        zone = [round(min(lo_z, hi_z), 10), round(max(lo_z, hi_z), 10)]
        word = "compra" if buy else "venda"
        out.append({
            "kind": "ema", "key": f"ema:{'buy' if buy else 'sell'}:{tf}:{int(x[T])}",
            "dir": "buy" if buy else "sell", "tf": tf, "zone": zone, "entry": entry, "stop": stop, "targets": tg, "rr": rr,
            "status": status, "age": n - 1 - r, "t": x[T], "price_in_zone": zone[0] <= cs[-1][C] <= zone[1],
            "score": score, "grade": grade, "why": why,
            "news_risk": [f"{q['pt'] or q['title']} ({q['ccy']})" for q in news], "gap": None, "ob": None,
            "valid_h": 6 if tf == "M15" else 24,
            "plan": (f"Tendência de {TREND_PT[side]} em {tf} e {up}: o preço {'acima' if buy else 'abaixo'} das EMA 125 e 200. "
                     f"Recuou até elas e foi rejeitado. Esperamos o reteste da EMA 125 ({entry:.{dp}f}) para a {word} e daí "
                     f"{'subida' if buy else 'descida'} até {tg[0]['label']}. Um fecho {'abaixo' if buy else 'acima'} de {stop:.{dp}f} invalida."),
            "trigger": "reteste da EMA 125 (ordem limite em cima dela)",
        })
    return out
