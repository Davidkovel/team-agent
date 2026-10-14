"""How gold, EUR/USD and GER40 reacted to past US releases (CPI, NFP, FOMC...), for the room's page and the briefing.

The history comes from the news-reaction project (github.com/Davidkovel/news-reaction, `python newsreact.py export cpi`):
one JSON per event in reaction_data/, built from Dukascopy 1-minute candles since 2018. After a release the room reads
gold's 1-minute candles from Binance (XAUUSDT) and looks for the past releases whose first minutes looked the same."""
from __future__ import annotations

import json
import math
import re
import statistics as st
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx

UTC = timezone.utc
DATA = Path(__file__).with_name("reaction_data")
# TradingView calendar title (US) -> file in reaction_data/ and the name on the page
EVENTS = [(r"^Core Inflation Rate MoM$", "cpi", "Inflação core (CPI) m/m"), (r"^Non Farm Payrolls$", "nfp", "Payrolls (NFP)"),
          (r"^PPI MoM$", "ppi", "Preços no produtor (PPI) m/m"), (r"^Retail Sales MoM$", "retail", "Vendas a retalho m/m"),
          (r"^Core PCE Price Index MoM$", "pce", "PCE core m/m"), (r"^Fed Interest Rate Decision$", "fomc", "Decisão de juros da Fed")]
SYMS = {"GOLD": "Ouro", "EURUSD": "EUR/USD", "GER40": "GER40"}
SURPRISE = {"BELOW": "abaixo da previsão", "ABOVE": "acima da previsão", "INLINE": "igual à previsão"}
BIG_DROP = 0.3   # % at the 5-minute close: below it gold usually came back fast, above it usually not
LAST: dict = {}   # what the page and the briefing show, refreshed by the room
_files: dict[str, tuple[float, dict]] = {}


def load(key: str) -> dict | None:
    fn = DATA / f"{key}.json"
    if not fn.exists():
        return None
    mt = fn.stat().st_mtime
    if key not in _files or _files[key][0] != mt:
        _files[key] = (mt, json.loads(fn.read_text(encoding="utf-8")))
    return _files[key][1]


def _parse(t: str) -> datetime:
    return datetime.fromisoformat(t.replace("Z", "+00:00"))


def surprise(actual, forecast) -> str | None:
    if actual is None or forecast is None:
        return None
    return "ABOVE" if actual > forecast else "BELOW" if actual < forecast else "INLINE"


def pick(calendar: list[dict], now: datetime):
    """The US release to talk about: the latest one out in the last 4 h, else the next one in the coming 36 h."""
    found = []
    for e in calendar:
        if e.get("country") != "US" or not e.get("t"):
            continue
        hit = next(((k, pt) for rx, k, pt in EVENTS if re.search(rx, e.get("title") or "")), None)
        if not hit or not load(hit[0]):
            continue
        dt = (_parse(e["t"]) - now).total_seconds()
        if -4 * 3600 <= dt <= 36 * 3600:
            found.append((dt > 0, abs(dt), e, hit))
    if not found:
        return None
    _, _, e, (key, name) = min(found, key=lambda f: (f[0], f[1]))
    return e, key, name


def summary(data: dict) -> dict:
    rel = data["releases"]
    table = {}
    for s in SURPRISE:
        rs = [r for r in rel if r["surprise"] == s]
        row: dict = {"n": len(rs)}
        for sym in SYMS:
            v = [r["m"][sym]["move5"] for r in rs if sym in r["m"]]
            if v:
                row[sym] = {"avg": round(st.mean(v), 3), "up": sum(x > 0 for x in v), "n": len(v)}
        table[s] = row
    # gold when the number came out above the forecast (dollar-positive for every event here) and gold fell in the first 5 min
    hot = [r["m"]["GOLD"] for r in rel if r["surprise"] == "ABOVE" and "GOLD" in r["m"] and r["m"]["GOLD"]["move5"] < 0]
    bounce = [g for g in hot if "a25" in g]
    small = [g for g in hot if g["move5"] > -BIG_DROP]
    big = [g for g in hot if g["move5"] <= -BIG_DROP]
    back_min = [g["back"] for g in small if g.get("back")]
    gold = {"bounce": {"n": len(bounce), "back": sum(g["a25"] > 0 for g in bounce)},
            "small": {"n": len(small), "back": sum(bool(g.get("back")) for g in small), "minutes": round(st.median(back_min)) if back_min else None},
            "big": {"n": len(big), "back": sum(bool(g.get("back")) for g in big)}}
    recent = [{"t": r["t"], "actual": r["actual"], "forecast": r["forecast"], "surprise": r["surprise"],
               "move5": {sym: r["m"][sym]["move5"] for sym in SYMS if sym in r["m"]}} for r in rel[-6:]][::-1]
    return {"count": len(rel), "since": rel[0]["t"][:4] if rel else None, "table": table, "gold": gold, "recent": recent}


async def live(e: dict, key: str, now: datetime) -> dict | None:
    """Gold since the release (Binance XAUUSDT, 1 minute) and the past releases with the closest path."""
    t = _parse(e["t"])
    if not 60 <= (now - t).total_seconds() <= 4 * 3600:
        return None
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.get("https://fapi.binance.com/fapi/v1/klines", params={
            "symbol": "XAUUSDT", "interval": "1m", "startTime": int((t - timedelta(minutes=1)).timestamp() * 1000), "limit": 250})
        k = r.json()
    if not isinstance(k, list) or len(k) < 2:
        return None
    ref = float(k[0][4])   # close of the minute before the release
    path = [round((float(x[4]) - ref) / ref * 100, 3) for x in k[1:]]
    low = min(float(x[3]) for x in k[1:])
    n = min(len(path), 121)
    similar = []
    for r in load(key)["releases"]:
        p = r.get("path")
        if not p or _parse(r["t"]).date() == t.date():
            continue
        g = r["m"].get("GOLD") or {}
        similar.append({"t": r["t"], "surprise": r["surprise"], "dist": round(math.sqrt(sum((a - b) ** 2 for a, b in zip(p[:n], path[:n])) / n), 3),
                        "same": p[n - 1], "p60": p[59], "p120": p[120], "low60": g.get("low60"), "back": g.get("back")})
    similar.sort(key=lambda s: s["dist"])
    return {"minutes": len(path), "now": path[-1], "low": round((low - ref) / ref * 100, 3), "price": float(k[-1][4]), "similar": similar[:4]}


async def refresh(calendar: list[dict], now: datetime) -> dict:
    """Called by the room every cycle and by the page. Binance only after a release, at most once a minute."""
    global LAST
    got = pick(calendar, now)
    if not got:
        LAST = {}
        return LAST
    e, key, name = got
    data = load(key)
    out = {"key": key, "name": name, "t": e["t"], "actual": e.get("actual"), "forecast": e.get("forecast"), "previous": e.get("previous"),
           "unit": e.get("unit") or "", "surprise": surprise(e.get("actual"), e.get("forecast")), "built": data.get("built"), **summary(data)}
    same = LAST.get("t") == e["t"]
    if same and time.time() - LAST.get("live_at", 0) < 55:
        out["live"], out["live_at"] = LAST.get("live"), LAST["live_at"]
    else:
        try:
            out["live"] = await live(e, key, now)
        except Exception:
            out["live"] = LAST.get("live") if same else None
        out["live_at"] = time.time()
    LAST = out
    return out


def _p(v) -> str:
    return "—" if v is None else f"{v:+.2f}%".replace(".", ",")


def _n(v) -> str:
    return "—" if v is None else f"{v:g}".replace(".", ",")


def brief_text() -> str:
    """The same history in words, for the meeting's briefing."""
    x = LAST
    if not x:
        return ""
    L = [f"REAÇÃO HISTÓRICA À NOTÍCIA {x['name'].upper()} ({x['count']} saídas desde {x['since']}; movimento nos primeiros 5 min, "
         "a partir do último preço antes da notícia):"]
    for s, label in SURPRISE.items():
        row = x["table"][s]
        L.append(f"- número {label} ({row['n']} vezes): " + " · ".join(
            f"{SYMS[sym]} {_p(row[sym]['avg'])} em média, subiu {row[sym]['up']} de {row[sym]['n']}" for sym in SYMS if sym in row))
    g, big = x["gold"], _n(BIG_DROP)
    L.append(f"- Ouro com o número acima da previsão e a cair nos primeiros 5 min: 25 min depois do fecho dos 5 min estava mais alto "
             f"em {g['bounce']['back']} de {g['bounce']['n']}. Quedas menores que {big}% voltaram ao preço de antes da notícia no "
             f"próprio dia em {g['small']['back']} de {g['small']['n']}" + (f" (mediana {g['small']['minutes']} min)" if g['small']['minutes'] else "")
             + f"; quedas de {big}% ou mais em {g['big']['back']} de {g['big']['n']}.")
    if x.get("surprise"):
        L.append(f"- HOJE saiu {_n(x['actual'])}{x['unit']} contra {_n(x['forecast'])}{x['unit']} de previsão: {SURPRISE[x['surprise']]}.")
    lv = x.get("live")
    if lv:
        L.append(f"- Ouro agora {_p(lv['now'])} desde a notícia ({lv['minutes']} min; mínimo {_p(lv['low'])}). Saídas passadas mais parecidas: " + "; ".join(
            f"{s['t'][:10]} ({SURPRISE[s['surprise']]}): +60 min {_p(s['p60'])}, +120 min {_p(s['p120'])}, "
            + (f"voltou ao preço de antes em {s['back']} min" if s["back"] else "não voltou ao preço de antes no próprio dia") for s in lv["similar"][:3]) + ".")
    L.append("São frequências do passado em amostras pequenas, não uma garantia.")
    return "\n".join(L)
