"""The room's read of each instrument, from its candles on five timeframes: the trend on each, the bias they add up to,
the key liquidity (previous day and week, the Asian and London ranges, equal highs and lows) and what became of it,
the points of interest (gaps and blocks of H1 and H4 near the price), the setups of the model on M15 and M5 with a
score, and the events worth telling someone about. Also what a chart needs to draw all of it."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from . import sessions, smc
from .markets import BY_ID, INSTRUMENTS, split_live

UTC = timezone.utc
T, O, H, L, C = range(5)
KEY_WEIGHT = {"PWH": 5, "PWL": 5, "PDH": 4, "PDL": 4, "ASH": 3, "ASL": 3, "LOH": 3, "LOL": 3}
KEY_NAME = {"PDH": "máximo de ontem (PDH)", "PDL": "mínimo de ontem (PDL)", "PWH": "máximo da semana passada (PWH)",
            "PWL": "mínimo da semana passada (PWL)", "ASH": "máximo da Ásia", "ASL": "mínimo da Ásia",
            "LOH": "máximo de Londres", "LOL": "mínimo de Londres"}
TREND_PT = {"bull": "alta", "bear": "baixa", None: "sem estrutura"}


def fmt(v: float | None, dp: int) -> str:
    if v is None:
        return "—"
    s = f"{v:,.{dp}f}".replace(",", " ").replace(".", ",")
    return s


def _index_at(cs: list, t: float) -> int:
    """The first candle at or after t."""
    for k, x in enumerate(cs):
        if x[T] >= t:
            return k
    return len(cs)


def _range(cs: list, live, a: datetime, b: datetime) -> tuple[float, float] | None:
    rows = [x for x in cs + ([live] if live else []) if a.timestamp() <= x[T] < b.timestamp()]
    return (max(x[H] for x in rows), min(x[L] for x in rows)) if rows else None


def key_levels(m15: list, m15_live, h1: list, d1: list, d1_live, now: datetime) -> list[dict]:
    """Previous day and week highs and lows, today's Asian and London ranges. start: from when a touch counts."""
    out = []
    if d1:
        if d1_live:
            prev, today = d1[-1], d1_live
        else:
            prev, today = (d1[-2] if len(d1) > 1 else None), d1[-1]
        if prev:
            out += [{"key": "PDH", "p": prev[H], "start": today[T], "tf": "M15"}, {"key": "PDL", "p": prev[L], "start": today[T], "tf": "M15"}]
        days = d1 + ([d1_live] if d1_live else [])
        weeks: dict[tuple, list] = {}
        for x in days:
            weeks.setdefault(datetime.fromtimestamp(x[T], UTC).isocalendar()[:2], []).append(x)
        keys = sorted(weeks)
        if len(keys) > 1:
            pw, cw = weeks[keys[-2]], weeks[keys[-1]]
            out += [{"key": "PWH", "p": max(x[H] for x in pw), "start": cw[0][T], "tf": "H1"},
                    {"key": "PWL", "p": min(x[L] for x in pw), "start": cw[0][T], "tf": "H1"}]
    a0, a1 = sessions.asia_window(now)
    if a1 > now:   # the range still forming: yesterday's
        a0, a1 = a0 - timedelta(days=1), a1 - timedelta(days=1)
    r = _range(m15, m15_live, a0, a1)
    if r:
        out += [{"key": "ASH", "p": r[0], "start": a1.timestamp(), "tf": "M15"}, {"key": "ASL", "p": r[1], "start": a1.timestamp(), "tf": "M15"}]
    l0, l1 = sessions.london_window(now)
    if l1 <= now:
        r = _range(m15, m15_live, l0, l1)
        if r:
            out += [{"key": "LOH", "p": r[0], "start": l1.timestamp(), "tf": "M15"}, {"key": "LOL", "p": r[1], "start": l1.timestamp(), "tf": "M15"}]
    for k in out:
        k["label"], k["above"] = KEY_NAME[k["key"]], k["key"].endswith("H")
        cs = m15 if k["tf"] == "M15" else h1
        k.update(smc.touch(cs, _index_at(cs, k["start"]), k["p"], k["above"], m15_live if k["tf"] == "M15" else None))
    return out


class Frame:
    """One timeframe of one instrument, analysed."""

    def __init__(self, tf: str, rows: list, now_ts: float):
        self.tf = tf
        self.closed, self.live = split_live(rows, tf, now_ts)
        cs = self.closed
        self.ok = len(cs) >= 30
        if not self.ok:
            return
        self.atr = smc.atr(cs)
        self.sw = smc.swings(cs, 3 if tf in ("H4", "D1") else 2)
        self.trend, self.events = smc.structure(cs, self.sw)
        self.fvg = smc.gaps(cs, self.atr)
        self.pools = smc.pools(cs, self.sw, self.atr)
        self.hi, self.lo = smc.dealing_range(cs, self.sw)
        for e in self.events:
            if e.get("ob"):
                e["ob"]["state"] = smc.block_state(cs, e["ob"])

    @property
    def last(self):
        return self.live or (self.closed[-1] if self.closed else None)


def _news_soon(cal: list[dict], ccy: list[str], now: datetime, minutes: int) -> list[dict]:
    out = []
    for e in cal:
        if e["imp"] < 3 or e["ccy"] not in ccy or not e["t"]:
            continue
        at = datetime.fromisoformat(e["t"].replace("Z", "+00:00"))
        if now - timedelta(minutes=5) <= at <= now + timedelta(minutes=minutes):
            out.append({**e, "mins": int((at - now).total_seconds() // 60)})
    return out


def analyse(inst: dict, store, cal: list[dict], now: datetime) -> dict | None:
    ts = now.timestamp()
    fr = {tf: Frame(tf, store.get(inst["id"], tf), ts) for tf in ("M5", "M15", "H1", "H4", "D1")}
    if not fr["M15"].ok or not fr["H1"].ok:
        return None
    dp = inst["dp"]
    last = fr["M5"].last if fr["M5"].ok else fr["M15"].last
    price = last[C]
    d1 = fr["D1"]
    prev_close = (d1.closed[-1][C] if d1.live else d1.closed[-2][C] if len(d1.closed) > 1 else None) if d1.ok else None
    chg = (price / prev_close - 1) * 100 if prev_close else None
    keys = key_levels(fr["M15"].closed, fr["M15"].live, fr["H1"].closed, d1.closed if d1.ok else [], d1.live if d1.ok else None, now)

    # the bias: the higher timeframes weigh more
    w = {"D1": 1, "H4": 2, "H1": 1, "M15": .5}
    score = sum(w[tf] * (1 if fr[tf].trend == "bull" else -1 if fr[tf].trend == "bear" else 0) for tf in w if fr[tf].ok)
    bias = "bull" if score >= 2 else "bear" if score <= -2 else "mixed"
    h4 = fr["H4"]
    pd = smc.premium(price, h4.hi, h4.lo) if h4.ok else None

    # liquidity around the price: the nearest untouched above and below (key levels first, then equal highs/lows, then swings)
    atr_h1 = fr["H1"].atr
    liq = [{"p": k["p"], "label": k["label"], "key": k["key"], "kind": "BSL" if k["above"] else "SSL", "state": k["state"], "weight": KEY_WEIGHT[k["key"]]}
           for k in keys]
    for p in fr["H1"].pools:
        if p["state"] == "intact":
            liq.append({"p": p["p"], "label": p["label"] + " H1", "key": "EQ" if p.get("eq") else "SW", "kind": p["kind"], "state": "intact", "weight": 3 if p.get("eq") else 1})
    above = sorted([x for x in liq if x["kind"] == "BSL" and x["state"] == "intact" and x["p"] > price], key=lambda x: x["p"])
    below = sorted([x for x in liq if x["kind"] == "SSL" and x["state"] == "intact" and x["p"] < price], key=lambda x: -x["p"])
    for x in above + below:
        x["dist"] = abs(x["p"] - price) / atr_h1

    # points of interest on H1 and H4 near the price
    pois = []
    for tf in ("H4", "H1"):
        f = fr[tf]
        if not f.ok:
            continue
        for g in f.fvg[-30:]:
            if g["state"] != "filled" and abs(g["ce"] - price) <= 3 * atr_h1:
                pois.append({"tf": tf, "type": "FVG", "dir": g["dir"], "top": g["top"], "bot": g["bot"], "t": g["t"], "state": g["state"],
                             "inside": g["bot"] <= price <= g["top"]})
        for e in f.events[-12:]:
            ob = e.get("ob")
            if ob and ob["state"] != "broken" and abs((ob["top"] + ob["bot"]) / 2 - price) <= 3 * atr_h1:
                pois.append({"tf": tf, "type": "OB", "dir": ob["dir"], "top": ob["top"], "bot": ob["bot"], "t": ob["t"], "state": ob["state"],
                             "inside": ob["bot"] <= price <= ob["top"]})
    pois.sort(key=lambda p: abs((p["top"] + p["bot"]) / 2 - price))

    # the setups, on M15 and M5
    soon = _news_soon(cal, inst["ccy"], now, 60)
    ideas = []
    for tf in ("M15", "M5"):
        f = fr[tf]
        if not f.ok:
            continue
        cs = f.closed
        sweeps = []
        for k in keys:
            st = smc.touch(cs, _index_at(cs, k["start"]), k["p"], k["above"])
            if st["state"] == "swept":
                sweeps.append({"i": st["i"], "t": st["t"], "x": st["x"], "above": k["above"], "label": k["label"], "key": True, "p": k["p"], "code": k["key"]})
        for p in f.pools:
            if p["state"] == "swept":
                sweeps.append({"i": p["ti"], "t": p["tt"], "x": p["x"], "above": p["kind"] == "BSL",
                               "label": p["label"].lower() + f" {tf}", "key": bool(p.get("eq")), "p": p["p"], "code": "EQ" if p.get("eq") else "SW"})
        targets = [{"p": x["p"], "label": x["label"], "kind": x["kind"]} for x in liq if x["state"] == "intact"]
        targets += [{"p": p["p"], "label": p["label"] + f" {tf}", "kind": p["kind"]} for p in f.pools if p["state"] == "intact"]
        for s in smc.setups(cs, f.atr, f.events, f.fvg, sweeps, targets, price, look=40 if tf == "M15" else 48):
            s["tf"] = tf
            ideas.append(s)
    for s in ideas:
        _score(s, fr, pd, soon, dp)
    ideas = [s for s in ideas if s["status"] in ("armed", "active", "won") and s["age"] <= (32 if s["tf"] == "M15" else 36)]
    ideas.sort(key=lambda s: (-s["score"], s["age"]))

    # the events of now, for the alarms
    events = []
    for k in keys:
        if k["state"] == "swept" and ts - k["t"] < 3 * 3600:
            events.append({"key": f"{inst['id']}:sweep:{k['key']}:{int(k['t'])}", "w": KEY_WEIGHT[k["key"]], "t": k["t"], "kind": "sweep",
                           "text": f"{inst['id']}: sweep do {k['label']} ({fmt(k['p'], dp)}) — pavio até {fmt(k['x'], dp)} e fechou de volta"})
        elif k["state"] == "taken" and ts - k["t"] < 2 * 3600:
            events.append({"key": f"{inst['id']}:taken:{k['key']}:{int(k['t'])}", "w": KEY_WEIGHT[k["key"]] - 2, "t": k["t"], "kind": "taken",
                           "text": f"{inst['id']}: rompeu o {k['label']} ({fmt(k['p'], dp)}) e ficou do outro lado"})
    for tf, wb, wc in (("H4", 3, 4), ("H1", 2, 3), ("M15", 1, 2)):
        f = fr[tf]
        if not f.ok:
            continue
        for e in f.events[-3:]:
            if len(f.closed) - 1 - e["i"] <= 2:
                kind = "CHoCH" if e["kind"] == "CHoCH" else "BOS"
                events.append({"key": f"{inst['id']}:{tf}:{kind}:{int(e['t'])}", "w": wc if kind == "CHoCH" else wb, "t": e["t"], "kind": kind.lower(),
                               "text": f"{inst['id']}: {kind} de {'alta' if e['dir'] == 'up' else 'baixa'} em {tf} (fecho além de {fmt(e['level'], dp)})"})
    for p in pois:
        if p["inside"]:
            events.append({"key": f"{inst['id']}:poi:{p['tf']}:{p['type']}:{int(p['t'])}", "w": 3 if p["tf"] == "H4" else 2, "t": ts, "kind": "poi",
                           "text": f"{inst['id']}: preço dentro de um {p['type']} {p['tf']} de {'compra' if p['dir'] == 'up' else 'venda'} ({fmt(p['bot'], dp)}–{fmt(p['top'], dp)})"})
    for s in ideas:
        if s["status"] in ("armed", "active") and s["grade"] in ("A+", "A", "B"):
            events.append({"key": f"{inst['id']}:setup:{s['dir']}:{s['tf']}:{s['sweep']['x']:.6f}", "w": {"A+": 5, "A": 4, "B": 2}[s["grade"]], "t": s["t"],
                           "kind": "setup", "text": f"{inst['id']}: setup {s['grade']} de {'venda' if s['dir'] == 'sell' else 'compra'} em {s['tf']} — " + "; ".join(s["why"][:3])})
    events.sort(key=lambda e: -e["t"])

    tf_out = {}
    for tf, f in fr.items():
        if f.ok:
            lastev = f.events[-1] if f.events else None
            tf_out[tf] = {"trend": f.trend, "atr": f.atr,
                          "last": {"kind": lastev["kind"], "dir": lastev["dir"], "t": lastev["t"], "level": lastev["level"]} if lastev else None}
    return {
        "id": inst["id"], "name": inst["name"], "dp": dp, "price": price, "chg": chg, "t": last[T], "crypto": bool(inst.get("crypto")),
        "open": sessions.market_open(now, bool(inst.get("crypto"))),
        "tf": tf_out, "bias": {"dir": bias, "score": score, "text": _bias_text(fr, bias)},
        "pd": pd, "range": {"hi": h4.hi, "lo": h4.lo} if h4.ok else None, "atr": atr_h1,
        "keys": [{k2: k[k2] for k2 in ("key", "label", "p", "state", "above") if k2 in k} | ({"at": k["t"], "x": k["x"]} if "t" in k else {}) for k in keys],
        "above": above[:3], "below": below[:3], "pois": pois[:6], "setups": ideas[:4], "events": events[:12],
        "news": soon, "ccy": inst["ccy"],
    }


def _bias_text(fr: dict, bias: str) -> str:
    parts = [f"{tf} {TREND_PT[fr[tf].trend]}" for tf in ("D1", "H4", "H1", "M15") if fr[tf].ok]
    head = {"bull": "Viés de alta", "bear": "Viés de baixa", "mixed": "Sem viés claro"}[bias]
    return f"{head} · " + " · ".join(parts)


def _score(s: dict, fr: dict, pd: float | None, soon: list[dict], dp: int):
    sell = s["dir"] == "sell"
    pts, why = 20, [f"Sweep do {s['sweep']['label']} ({fmt(s['sweep']['p'], dp)})"]
    if s["sweep"]["key"]:
        pts += 10
    pts += 20 if s["brk"]["kind"] == "CHoCH" else 14
    why.append(f"{s['brk']['kind']} de {'baixa' if sell else 'alta'} em {s['tf']}")
    if s["gap"]:
        pts += 15 + (5 if s["gap"]["strong"] else 0)
        why.append(f"FVG {fmt(s['gap']['bot'], dp)}–{fmt(s['gap']['top'], dp)} por preencher")
    elif s["ob"]:
        pts += 8
        why.append(f"Order block {fmt(s['ob']['bot'], dp)}–{fmt(s['ob']['top'], dp)}")
    for tf in ("H1", "H4"):
        tr = fr[tf].trend if fr[tf].ok else None
        if tr:
            agree = (tr == "bear") == sell
            pts += 10 if agree else -8
            why.append(f"{tf} em {TREND_PT[tr]}" + ("" if agree else " (contra)"))
    if pd is not None:
        good = pd > .5 if sell else pd < .5
        pts += 10 if good else -5
        why.append(f"{'Premium' if pd > .5 else 'Desconto'} ({round(pd * 100)}% do range H4)" + ("" if good else " (lado errado)"))
    kz = sessions.killzone(datetime.fromtimestamp(s["sweep"].get("t") or s["t"], UTC))
    if kz:
        pts += 5
        why.append(f"Killzone {kz['name']}" + (" · silver bullet" if kz["silver"] else ""))
    if s["tf"] == "M5":
        pts -= 8   # the lower timeframe: more noise, more of them
    rr = s["rr"]
    pts += 8 if rr >= 3 else 5 if rr >= 2 else -10 if rr < 1.5 else 0
    why.append(f"RR {rr:.1f}".replace(".", ","))
    s["news_risk"] = [f"{e['pt'] or e['title']} ({e['ccy']}) {'daqui a ' + str(e['mins']) + ' min' if e['mins'] >= 0 else 'agora'}" for e in soon]
    if soon:
        pts -= 10
    s["score"] = max(0, min(100, pts))
    s["grade"] = "A+" if pts >= 85 else "A" if pts >= 70 else "B" if pts >= 55 else "C"
    s["why"] = why


def chart(inst_id: str, tf: str, store, now: datetime, bars: int = 220) -> dict | None:
    """What the room's chart draws for one instrument and timeframe."""
    inst = BY_ID.get(inst_id)
    if not inst:
        return None
    f = Frame(tf, store.get(inst_id, tf), now.timestamp())
    if not f.ok:
        return None
    cs = f.closed
    first = max(0, len(cs) - bars)
    rows = [list(x) for x in cs[first:]] + ([list(f.live)] if f.live else [])
    t0 = cs[first][T]
    out = {"id": inst_id, "tf": tf, "dp": inst["dp"], "name": inst["name"], "candles": rows, "live": bool(f.live), "atr": f.atr,
           "trend": f.trend, "source": store.source.get(inst_id, "")}
    # what reads on a chart without drowning it: the newest gaps and blocks still alive, equal highs and lows, the swings
    # still resting in the last stretch, the breaks of structure
    recent = cs[max(first, len(cs) - 80)][T]
    out["fvg"] = [{k: g[k] for k in ("dir", "t", "top", "bot", "state", "fill", "strong", "ce")} for g in f.fvg if g["state"] != "filled" and g["t"] >= t0][-10:]
    out["structure"] = [{"kind": e["kind"], "dir": e["dir"], "t": e["t"], "level": e["level"], "from": cs[e["swing"]][T]} for e in f.events if e["t"] >= t0][-10:]
    out["ob"] = [{k: e["ob"][k] for k in ("dir", "t", "top", "bot", "state")} for e in f.events if e.get("ob") and e["ob"]["state"] != "broken" and e["ob"]["t"] >= t0][-5:]
    out["pools"] = [{k: p.get(k) for k in ("kind", "label", "p", "t", "state", "x", "eq", "tt")} for p in f.pools
                    if p["t"] >= t0 and (p.get("eq") or (p["state"] == "intact" and p["t"] >= recent))][-16:]
    out["range"] = {"hi": f.hi, "lo": f.lo}
    return out
