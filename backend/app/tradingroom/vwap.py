"""The VWAP + EMA read and the second model the room trades, next to the SMC one.

VWAP of the trading day (anchored at 17:00 New York, where the forex day and the OANDA daily candle start) with its
1σ and 2σ bands (volume-weighted standard deviation), and the 9, 21 and 50 EMA of the same timeframe.

The model is a trend pullback, and only the clean ones: the H1 trend and the EMAs (9 > 21 > 50 for a buy, the
reverse for a sell) point the same way, the price has been holding on that side of the VWAP and the VWAP slopes with
it, and the price came back to where the VWAP and the 21 EMA meet and was rejected there (wick into the zone, close
back out on the trend's side). Entry on the retest of that zone, stop past the pullback's extreme, targets the
untouched liquidity on the trend's side, else the 2σ band. Scored 0–100 like the SMC model; anything under A never
leaves this module. Pure functions on (t, o, h, l, c, v) candles."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from . import sessions
from .technicals import ema

UTC = timezone.utc
T, O, H, L, C, V = range(6)
TREND_PT = {"bull": "alta", "bear": "baixa"}


def anchor(now: datetime) -> float:
    """The start of the trading day that holds now: the last 17:00 New York at or before it (unix seconds)."""
    local = sessions.ny(now)
    start = local.replace(hour=17, minute=0, second=0, microsecond=0)
    if local < start:
        start -= timedelta(days=1)
    return (start + timedelta(hours=sessions.ny_offset(now))).replace(tzinfo=UTC).timestamp()


def day_start(cs: list, now: datetime) -> float:
    """The anchor for these candles: the trading day of the last one (on a weekend, Friday's, not an empty today)."""
    return anchor(datetime.fromtimestamp(cs[-1][T], UTC) if cs else now)


def series(cs: list, start: float) -> list[dict | None]:
    """VWAP and bands for each candle from `start` on (None before it). With no volume (some feeds) every candle
    weighs the same, which is still the session's mean price."""
    out: list[dict | None] = []
    pv = pv2 = vol = 0.0
    for x in cs:
        if x[T] < start:
            out.append(None)
            continue
        tp = (x[H] + x[L] + x[C]) / 3
        w = (x[V] if len(x) > V and x[V] else 0.0) or 1.0
        pv, pv2, vol = pv + tp * w, pv2 + tp * tp * w, vol + w
        mean = pv / vol
        sd = max(0.0, pv2 / vol - mean * mean) ** .5
        out.append({"v": mean, "sd": sd})
    return out


def read(cs: list, live, now: datetime) -> dict | None:
    """Where the price stands against today's VWAP and the EMAs of one timeframe, for the briefing and the page."""
    rows = cs + ([live] if live else [])
    vw = series(rows, day_start(rows, now))
    if not rows or not vw[-1] or len(rows) < 60:
        return None
    closes = [x[C] for x in rows]
    p, v = closes[-1], vw[-1]
    e = {n: ema(closes, n)[-1] for n in (9, 21, 50)}
    z = (p - v["v"]) / v["sd"] if v["sd"] else 0.0
    return {"vwap": v["v"], "sd": v["sd"], "z": z, "ema": {str(n): x for n, x in e.items()},
            "stack": "up" if e[9] > e[21] > e[50] else "down" if e[9] < e[21] < e[50] else "mixed"}


def setups(cs: list, atr: float, trend_h1: str | None, trend_h4: str | None, targets: list[dict], now: datetime,
           tf: str, adr_used: float | None, news: list[dict], dp: int, look: int = 12) -> list[dict]:
    """The VWAP + EMA pullbacks of one timeframe that grade A or A+. `targets`: {p, label, kind (BSL/SSL)} untouched.
    `look`: how many closed candles back the rejection may be (fresh only)."""
    n = len(cs)
    vw = series(cs, day_start(cs, now))
    first = next((k for k, x in enumerate(vw) if x), None)
    if first is None or n - first < 12 or n < 60 or not atr or trend_h1 not in ("bull", "bear"):
        return []   # a VWAP of a few candles is noise: wait for the day to have a shape
    closes = [x[C] for x in cs]
    e9, e21, e50 = ema(closes, 9), ema(closes, 21), ema(closes, 50)
    buy = trend_h1 == "bull"
    sign = 1 if buy else -1
    out = []
    for r in range(max(first + 10, n - look), n):
        v = vw[r]
        if not v:
            continue
        # the trend on this timeframe: EMAs stacked, VWAP sloping the same way, the price held on its side
        if not ((e9[r] > e21[r] > e50[r]) if buy else (e9[r] < e21[r] < e50[r])):
            continue
        back = vw[r - 10]
        if not back or sign * (v["v"] - back["v"]) <= 0:
            continue
        held = sum(1 for k in range(r - 10, r) if vw[k] and sign * (cs[k][C] - vw[k]["v"]) > 0)
        if held < 7:
            continue
        # the zone: where the VWAP and the 21 EMA meet, and they must meet
        gap = abs(v["v"] - e21[r])
        if gap > .6 * atr:
            continue
        lo_z, hi_z = min(v["v"], e21[r]) - .1 * atr, max(v["v"], e21[r]) + .1 * atr
        x = cs[r]
        touched = (x[L] <= hi_z) if buy else (x[H] >= lo_z)
        rejected = (x[C] > hi_z and x[C] > x[O]) if buy else (x[C] < lo_z and x[C] < x[O])
        if not (touched and rejected):
            continue
        rng = x[H] - x[L] or 1e-9
        wick = ((min(x[O], x[C]) - x[L]) if buy else (x[H] - max(x[O], x[C]))) / rng
        # the pullback: from the last candle that closed beyond the trend side's EMA 9 to the rejection
        p0 = r
        while p0 > first and sign * (cs[p0 - 1][C] - e9[p0 - 1]) <= 0:
            p0 -= 1
        ext = min(cs[k][L] for k in range(p0, r + 1)) if buy else max(cs[k][H] for k in range(p0, r + 1))
        # how many times the zone was already tested since the price crossed the VWAP: the first pullback is the best
        cross = r
        while cross > first and vw[cross - 1] and sign * (cs[cross - 1][C] - vw[cross - 1]["v"]) > 0:
            cross -= 1
        tests, inside = 0, False
        for k in range(cross, r):
            vk = vw[k]
            if not vk:
                continue
            z0, z1 = min(vk["v"], e21[k]) - .1 * atr, max(vk["v"], e21[k]) + .1 * atr
            hit = (cs[k][L] <= z1) if buy else (cs[k][H] >= z0)
            if hit and not inside:
                tests += 1
            inside = hit
        nth = tests + (0 if inside else 1)   # this pullback's number (already counted when it started before r)
        entry = hi_z if buy else lo_z
        stop = ext - .15 * atr if buy else ext + .15 * atr
        risk = abs(entry - stop)
        if risk < .2 * atr or risk > 3 * atr:
            continue
        side, seen = [], []
        for t in sorted((t for t in targets if t.get("kind") == ("BSL" if buy else "SSL") and sign * (t["p"] - entry) > risk),
                        key=lambda t: sign * t["p"]):
            if all(abs(t["p"] - q) > .05 * atr for q in seen):
                side.append(t)
                seen.append(t["p"])
        band2 = v["v"] + sign * 2 * v["sd"]
        tg = side[:2]
        if not tg and v["sd"] and sign * (band2 - entry) > risk:
            tg = [{"p": band2, "label": "VWAP +2σ" if buy else "VWAP −2σ", "kind": ""}]
        if not tg:
            continue
        rr = abs(tg[0]["p"] - entry) / risk
        if rr < 1.5:
            continue
        # what happened since: stopped, missed (target first), in (the retest filled), or won
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

        # the score: only what a desk would want to see before pressing the button
        pts = 30
        why = [f"Pullback ao VWAP + EMA 21 em {tf} ({'compra' if buy else 'venda'} a favor da tendência)",
               f"EMA 9/21/50 alinhadas {'para cima' if buy else 'para baixo'} · VWAP a {'subir' if buy else 'descer'}",
               f"H1 em {TREND_PT[trend_h1]}"]
        if trend_h4 in ("bull", "bear"):
            agree = trend_h4 == trend_h1
            pts += 10 if agree else -10
            why.append(f"H4 em {TREND_PT[trend_h4]}" + ("" if agree else " (contra)"))
        if gap <= .3 * atr:
            pts += 8
            why.append("VWAP e EMA 21 juntas (confluência apertada)")
        if wick >= .5:
            pts += 7
            why.append(f"Rejeição limpa: pavio de {round(wick * 100)}% da vela na zona")
        if nth == 1:
            pts += 7
            why.append("1.º reteste desde que cruzou o VWAP")
        elif nth >= 3:
            pts -= 8
            why.append(f"{nth}.º reteste da zona (gasta)")
        kz = sessions.killzone(datetime.fromtimestamp(x[T], UTC))
        if kz and kz["key"] in ("london", "ny", "lclose", "pm"):
            pts += 8
            why.append(f"Killzone {kz['name']}")
        else:
            pts -= 5
            why.append("Fora das killzones de Londres e Nova Iorque (lado errado)")
        if adr_used is not None:
            if adr_used < .8:
                pts += 5
            else:
                pts -= 10
                why.append(f"{round(adr_used * 100)}% da amplitude diária já gasta (lado errado)")
        if tf == "M5":
            pts -= 5
        pts += 12 if rr >= 3 else 8 if rr >= 2 else 0
        why.append(f"RR {rr:.1f}".replace(".", ","))
        risk_news = [f"{q['pt'] or q['title']} ({q['ccy']}) {'daqui a ' + str(q['mins']) + ' min' if q['mins'] >= 0 else 'agora'}" for q in news]
        if news:
            pts -= 15
        score = max(0, min(100, pts))
        grade = "A+" if score >= 85 else "A" if score >= 70 else None
        if not grade:
            continue
        zone = [round(min(lo_z, hi_z), 10), round(max(lo_z, hi_z), 10)]
        word = "compra" if buy else "venda"
        out.append({
            "kind": "vwap", "key": f"vwap:{'buy' if buy else 'sell'}:{tf}:{int(x[T])}",
            "dir": "buy" if buy else "sell", "tf": tf, "zone": zone, "entry": entry, "stop": stop, "targets": tg, "rr": rr,
            "status": status, "age": n - 1 - r, "t": x[T], "price_in_zone": zone[0] <= cs[-1][C] <= zone[1],
            "score": score, "grade": grade, "why": why, "news_risk": risk_news,
            "gap": None, "ob": None, "vwap": v["v"], "sd": v["sd"],
            "plan": (f"Tendência de {TREND_PT[trend_h1]} com as EMA alinhadas e o preço {'acima' if buy else 'abaixo'} do VWAP. "
                     f"O preço recuou até onde o VWAP e a EMA 21 se juntam e foi rejeitado. Esperamos o reteste da zona "
                     f"{zone[0]:.{dp}f}–{zone[1]:.{dp}f} para a {word} e daí {'subida' if buy else 'descida'} até {tg[0]['label']}. "
                     f"Um fecho {'abaixo' if buy else 'acima'} de {stop:.{dp}f} invalida."),
            "trigger": "reteste da confluência VWAP + EMA 21 (ordem limite na borda da zona)",
        })
    # one idea per side and timeframe: the newest rejection
    out.sort(key=lambda s: -s["t"])
    return out[:1]
