"""O cérebro unido (Memecoins › Quem acerta): everything the agents found, joined, so nobody has to click a robot to see it.

18 nov, Marco: «está super confuso... tenho que estar a clicar nos robôs para ver as publicações... aquele cérebro tem que ter
as informações todas... vais unindo e vais meter as tokens, vale a pena... super empresarial... vai tudo sempre a unir».

Two lists, rebuilt on every call from what is already in memory (no network):
- **picks** «Vale a pena agora»: one line per coin, whichever agent saw it (the Robin's scored coins, the narrative's coins,
  the Ao vivo signals, the Leitor's buy calls of our influencers), joined by contract. A verdict in words with the reasons:
  «Vale a pena olhar» (money in the pool, money moving, going up, nothing bad), «Arriscado» (moving but thin, or just born),
  «Evitar» (a danger flag, a thin pool, a crash). Not advice: what the data says, for the team to decide.
- **stream** «O que se diz agora»: one timeline of the influencer posts (as the Leitor read them), the narrative's posts and
  calls, the hunt's signs, and the X posts with coins launched under them; each with its coins.
"""
from __future__ import annotations

import time


# 18 Nov, Marco: «nós queremos só SOL... está aí bué coins à toa... avisos quando for para comprar e quando não». Three
# words, strict on purpose: most of these coins go to zero.
BUY, WAIT, NO = "Sinal de compra", "Esperar", "Não comprar"


def _verdict(c: dict) -> tuple[str, str]:
    liq, vol1, ch1, mcap = c.get("liq") or 0, c.get("vol1") or 0, c.get("ch1") or 0, c.get("mcap") or 0
    b1, s1, age = c.get("b1"), c.get("s1"), c.get("age_h")
    if c.get("danger") or liq < 15_000 or ch1 <= -35 or (mcap and liq and mcap > liq * 40):
        return NO, "bad"
    if (liq >= 30_000 and vol1 >= 50_000 and 5 <= ch1 <= 400 and mcap <= liq * 20
            and (b1 is None or b1 >= 1.2 * max(1, s1 or 0)) and (age is None or age >= 0.33)):
        return BUY, "ok"
    return WAIT, "warn"


def why_buy(p: dict) -> str:
    return "; ".join(p["why"][:3])


def build(brain) -> dict:
    now = time.time()
    st = brain.state
    picks: dict[str, dict] = {}

    def pick(addr: str, **kw) -> dict:
        p = picks.setdefault(addr, {"address": addr, "why": [], "sources": set(), "heat": 0.0})
        for k, v in kw.items():
            if v is not None and (p.get(k) is None or k in ("mcap", "liq", "vol1", "ch1", "price")):
                p[k] = v
        return p

    # the Robin's coins, scored with the Lucius' checks
    for t in st.get("tokens", {}).values():
        if (t.get("score") or 0) < 55 or t.get("chain") != "solana":
            continue
        p = pick(t["address"], symbol=t.get("symbol"), name=t.get("name"), chain=t.get("chain"), image=t.get("image"), url=t.get("url"),
                 mcap=t.get("mcap"), liq=t.get("liq"), vol1=t.get("vol1"), ch1=t.get("ch1"), danger=bool(t.get("danger")), age_h=t.get("age_h"))
        p["sources"].add("Robin")
        p["why"].append(f"nota {t['score']} do Robin")
        if t.get("people6"):
            p["why"].append(f"{t['people6']} contas a falar dela")
        p["heat"] += t["score"]
    # the narratives (GTA 6)
    for n in brain.live.narr.view():
        for c in n["coins"]:
            if (c.get("vol1") or 0) < 20_000 or c.get("chain") != "solana":   # only SOL, only coins with money moving
                continue
            p = pick(c["address"], symbol=c["symbol"], name=c["name"], chain=c.get("chain"), image=c.get("image"), url=c.get("url"),
                     mcap=c.get("mcap"), liq=c.get("liq"), vol1=c.get("vol1"), ch1=c.get("ch1"), age_h=c.get("age_h"), b1=c.get("b1"), s1=c.get("s1"))
            p["sources"].add(n["name"])
            k = lambda v: f"{v / 1e6:.1f} M$".replace(".", ",") if v >= 1e6 else f"{v / 1e3:.0f} k$"  # noqa: E731
            p["why"].append(f"{c.get('ch1') or 0:+.0f}% numa hora, {k(c.get('vol1') or 0)} negociados, pool {k(c.get('liq') or 0)}")
            if c.get("age_h") is not None and c["age_h"] < 24:
                p["why"].append(f"nasceu há {c['age_h']:.0f} h" if c["age_h"] >= 1 else f"nasceu há {max(1, round(c['age_h'] * 60))} min")
            if c.get("calls"):
                p["why"].append(f"{c['calls']} calls" + (f" (1.º @{c['first']['who']})" if c.get("first") else ""))
            if any(t[0] == "Perigo" for t in c.get("tags") or []):
                p["danger"] = True
            p["heat"] += min(100, (c.get("vol1") or 0) / 10_000) + min(60, max(0, c.get("ch1") or 0) / 10) + 8 * (c.get("calls") or 0)
    # the Ao vivo signals (pump.fun coins that held money and buyers)
    for s in brain.live.view().get("signals", []):
        p = pick(s["mint"], symbol=s["symbol"], name=s["name"], chain="solana", image=s.get("image"), url=s.get("url"), mcap=s.get("mcap"), liq=s.get("liq"))
        p["sources"].add("Ao vivo")
        p["why"].append(f"sinal {s['word']}: {s['why']}")
        p["heat"] += 40 if s["tone"] == "ok" else 20
    # our influencers' buy calls, as the Leitor read them (last 12 h)
    reads, toks = st.get("reads", {}), st.get("tokens", {})
    by_sym = {}
    for t in toks.values():
        k = (t.get("symbol") or "").upper()
        if k and (k not in by_sym or (t.get("liq") or 0) > (by_sym[k].get("liq") or 0)):
            by_sym[k] = t
    for post in st.get("posts", []):
        r = reads.get(post["id"])
        if not r or r.get("tipo") != "compra" or now - post["t"] > 12 * 3600:
            continue
        for m in r.get("moedas") or []:
            t = next((x for x in toks.values() if m.get("address") and x["address"] == m["address"]), None) or by_sym.get((m.get("symbol") or "").upper())
            if not t:
                continue
            p = pick(t["address"], symbol=t.get("symbol"), name=t.get("name"), chain=t.get("chain"), image=t.get("image"), url=t.get("url"),
                     mcap=t.get("mcap"), liq=t.get("liq"), vol1=t.get("vol1"), ch1=t.get("ch1"), danger=bool(t.get("danger")))
            p["sources"].add("Influencers")
            p["why"].insert(0, f"@{post['who']} mandou comprar (certeza {r.get('conviccao') or 0}/5)")
            p["heat"] += 30 + 8 * (r.get("conviccao") or 0)
    out = []
    for p in list(picks.values()):
        if p.get("chain") not in (None, "solana"):
            continue
        word, tone = _verdict(p)
        p.update(verdict=word, tone=tone, sources=sorted(p["sources"]), why=list(dict.fromkeys(p["why"]))[:4])
        out.append(p)
    rank = {"ok": 0, "warn": 1, "bad": 2}
    out.sort(key=lambda p: (rank[p["tone"]], -p["heat"]))

    # one timeline of what is said
    stream = []
    for post in st.get("posts", []):
        r = reads.get(post["id"])
        if post.get("inf") and r and not r.get("miss") and r.get("tipo") != "conversa":
            stream.append({"t": post["t"], "kind": r["tipo"], "src": post["src"], "who": post["who"], "url": post["url"],
                           "text": r.get("resumo") or post["text"], "quote": r.get("citacao") or "",
                           "coins": [{"symbol": m.get("symbol"), "address": m.get("address")} for m in r.get("moedas") or []][:3]})
    for n in brain.live.narr.view():
        for f in n["feed"][:30]:
            stream.append({"t": f["t"], "kind": "call" if f.get("coins") else "narr", "src": f["src"], "who": f["who"], "url": f["url"],
                           "text": f["text"], "narr": n["name"], "coins": f.get("coins") or []})
        for e in n["hunt"]["events"][:15]:
            stream.append({"t": e["t"], "kind": "hunt", "src": "Caça", "who": e["term"].upper(), "url": e["url"], "text": e["text"],
                           "coins": [e["coin"]] if e.get("coin") else []})
    for p in brain.live.view().get("posts", [])[:30]:
        if p["coins"]:
            stream.append({"t": p["t"], "kind": "launch", "src": "X", "who": p["who"], "url": p["url"], "text": p["text"],
                           "coins": [{"symbol": c["symbol"], "address": c["mint"]} for c in p["coins"]]})
    seen, uniq = set(), []
    for x in sorted(stream, key=lambda x: -x["t"]):
        k = (x["who"], x["text"][:60])
        if k in seen or now - x["t"] > 48 * 3600:
            continue
        seen.add(k)
        uniq.append(x)
    ok = sum(1 for p in out if p["tone"] == "ok")
    shown = [p for p in out if p["tone"] != "bad"][:12]
    everything = out   # «Não comprar» is a count and an alert, not a list of junk
    return {"picks": shown, "signals": list(brain.state.get("buy_signals", []))[:20], "stream": uniq[:50], "_all": everything, "counts": {"ok": ok, "warn": sum(1 for p in out if p["tone"] == "warn"),
                                                                 "bad": sum(1 for p in out if p["tone"] == "bad"), "said": len(uniq)}}


async def watch(brain):
    """Every half minute (memes_live.checker): a coin turning «Sinal de compra», or one that was it turning «Não comprar»,
    is an alert to the bell, the widget and the phone. Each change of a coin once in 2 h; at most 3 an hour pass."""
    from .memes import send
    st = brain.state
    last = st.setdefault("brain_last", {})
    sigs = st.setdefault("buy_signals", [])
    told = st.setdefault("brain_told", {})
    now = time.time()
    out = []
    for p in build(brain)["_all"]:
        a, tone, before = p["address"], p["tone"], last.get(p["address"])
        last[a] = tone
        if before is None and not st.get("brain_ready"):
            continue   # the first look only learns where each coin is
        key = f"{a}:{tone}"
        if now - told.get(key, 0) < 2 * 3600:
            continue
        if tone == "ok" and before != "ok":
            told[key] = now
            item = {"t": now, "kind": "buy", "symbol": p.get("symbol"), "address": a, "mcap": p.get("mcap"), "why": why_buy(p), "url": p.get("url")}
            out.append(("high", f"🟢 SINAL DE COMPRA: ${p.get('symbol')}", f"{why_buy(p)}. Vale {p.get('mcap') or 0:,.0f} $. Não é conselho: decide tu.".replace(",", " ")))
        elif tone == "bad" and before == "ok":
            told[key] = now
            item = {"t": now, "kind": "sell", "symbol": p.get("symbol"), "address": a, "mcap": p.get("mcap"), "why": why_buy(p), "url": p.get("url")}
            out.append(("high", f"🔴 NÃO COMPRAR / SAI: ${p.get('symbol')}", f"Deixou de ter sinal: {why_buy(p)}. Vale {p.get('mcap') or 0:,.0f} $.".replace(",", " ")))
        else:
            continue
        sigs.insert(0, item)
    del sigs[60:]
    for k in [k for k, v in told.items() if now - v > 86400]:
        told.pop(k)
    st["brain_ready"] = True
    if out:
        try:
            await send(out[:3])
        except Exception:  # noqa: BLE001
            pass


# ---------------------------------------------------------------- the advice, what is talked about, what is born, the memory
# 18 Nov, Marco: «super confuso... tem que estar sempre a unir as informações... nem consigo ver onde está a memória desse
# cérebro a guardar e a ver cada detalhe... sempre aconselhar e ver as coins criadas e faladas sempre atualizadas». So the
# page Cérebro (#/meme-cerebro) shows four things, from here: one sentence of advice, the coins most talked about, the coins
# just born that matter, and the memory: every thing the brain noticed or decided, in order, kept (state["memory"]).

def missing(c: dict) -> list[str]:
    """What a coin still lacks to be a «Sinal de compra», in words (empty = it is one)."""
    liq, vol1, ch1, mcap = c.get("liq") or 0, c.get("vol1") or 0, c.get("ch1") or 0, c.get("mcap") or 0
    b1, s1, age = c.get("b1"), c.get("s1"), c.get("age_h")
    k = lambda v: f"{v / 1e3:.0f} k$"  # noqa: E731
    out = []
    if liq < 30_000:
        out.append(f"pool {k(liq)} (precisa de 30 k$)")
    if vol1 < 50_000:
        out.append(f"{k(vol1)} numa hora (precisa de 50 k$)")
    if ch1 < 5:
        out.append(f"{ch1:+.0f}% numa hora (precisa de estar a subir)")
    if ch1 > 400:
        out.append(f"+{ch1:.0f}% numa hora: já é topo de foguete")
    if liq and mcap > liq * 20:
        out.append("vale mais de 20 vezes a pool")
    if b1 is not None and b1 < 1.2 * max(1, s1 or 0):
        out.append(f"{b1} compras contra {s1} vendas")
    if age is not None and age < 0.33:
        out.append("nasceu há menos de 20 min")
    if c.get("danger"):
        out.insert(0, "tem um alerta de perigo")
    return out


def advice(allp: list[dict]) -> dict:
    buys = [p for p in allp if p["tone"] == "ok"]
    if buys:
        b = buys[0]
        return {"tone": "ok", "head": f"🟢 Sinal de compra: ${b.get('symbol')}" + (f" (e mais {len(buys) - 1})" if len(buys) > 1 else ""),
                "text": f"{why_buy(b)}. Vale {(b.get('mcap') or 0):,.0f} $. Entra com pouco, e sai se aparecer o aviso vermelho.".replace(",", " "),
                "coin": {k: b.get(k) for k in ("symbol", "address", "url", "mcap")}}
    near = sorted((p for p in allp if p["tone"] == "warn"), key=lambda p: (len(missing(p)), -(p.get("vol1") or 0)))
    if near:
        n = near[0]
        return {"tone": "warn", "head": "Não compres nada agora",
                "text": f"Nenhuma moeda passa nas regras. A mais perto é ${n.get('symbol')}: falta " + "; ".join(missing(n)[:3]) + ".",
                "coin": {k: n.get(k) for k in ("symbol", "address", "url", "mcap")}}
    return {"tone": "bad", "head": "Não compres nada agora", "text": "Não há moedas de Solana com dinheiro a sério a mexer.", "coin": None}


def talked(brain, hours: float = 6) -> list[dict]:
    """The coins most talked about in the last hours, from every source (Oráculo, narratives, X launches)."""
    now = time.time()
    seen: dict[str, dict] = {}

    def add(sym, addr, who, src, t, url=""):
        sym = (sym or "").upper().lstrip("$")
        if not sym or now - t > hours * 3600:
            return
        x = seen.setdefault(sym, {"symbol": sym, "address": addr, "n": 0, "people": set(), "sources": set(), "first": t, "last": t, "url": url, "who_first": who})
        x["n"] += 1
        x["people"].add(who.lower())
        x["sources"].add(src)
        x["address"] = x["address"] or addr
        if t < x["first"]:
            x["first"], x["who_first"] = t, who
        x["last"] = max(x["last"], t)
    for p in brain.state.get("posts", []):
        for k in p.get("tickers") or []:
            add(k, None, p["who"], p["src"], p["t"], p["url"])
    for n in brain.live.narr.view():
        for f in n["feed"]:
            for c in f.get("coins") or []:
                add(c.get("symbol"), c.get("address"), f["who"], f["src"], f["t"], f["url"])
            for k in f.get("tickers") or []:
                add(k, None, f["who"], f["src"], f["t"], f["url"])
    from .memes import MAJORS, NOT_MEME
    info = {}
    for t in brain.state.get("tokens", {}).values():
        k = (t.get("symbol") or "").upper()
        if k and t.get("chain") == "solana" and (k not in info or (t.get("liq") or 0) > (info[k].get("liq") or 0)):
            info[k] = t
    for n in brain.live.narr.view():
        for c in n["coins"]:
            k = c["symbol"].upper()
            if k not in info or (c.get("liq") or 0) > (info[k].get("liq") or 0):
                info[k] = c
    out = []
    for x in seen.values():
        if x["symbol"] in MAJORS or NOT_MEME.search(x["symbol"]):
            continue
        i = info.get(x["symbol"], {})
        out.append({"symbol": x["symbol"], "address": x["address"] or i.get("address"), "n": x["n"], "people": len(x["people"]),
                    "sources": sorted(x["sources"]), "first": x["first"], "last": x["last"], "who_first": x["who_first"], "url": i.get("url") or x["url"],
                    "mcap": i.get("mcap"), "ch1": i.get("ch1"), "liq": i.get("liq")})
    out.sort(key=lambda x: (-x["people"], -x["n"], -x["last"]))
    return out[:20]


def created(brain, hours: float = 3) -> list[dict]:
    """Coins born in the last hours that matter: the narratives' and the hunt's new ones, and the pump.fun signals."""
    now = time.time()
    out: dict[str, dict] = {}
    for n in brain.live.narr.view():
        for c in n["coins"]:
            if c.get("age_h") is not None and c["age_h"] <= hours:
                out[c["address"]] = {"symbol": c["symbol"], "name": c["name"], "address": c["address"], "t": now - c["age_h"] * 3600, "why": n["name"],
                                     "mcap": c.get("mcap"), "ch1": c.get("ch1"), "vol1": c.get("vol1"), "liq": c.get("liq"), "url": c.get("url")}
        for l in n["launches"]:
            if now - l["t"] <= hours * 3600 and l["mint"] not in out:
                out[l["mint"]] = {"symbol": l["symbol"], "name": l["name"], "address": l["mint"], "t": l["t"], "why": f"{n['name']} · pump.fun",
                                  "mcap": l.get("mcap"), "ch1": None, "vol1": None, "liq": None, "url": f"https://gmgn.ai/sol/token/{l['mint']}"}
    for s in brain.live.view().get("signals", []):
        out.setdefault(s["mint"], {"symbol": s["symbol"], "name": s["name"], "address": s["mint"], "t": s["t"], "why": f"pump.fun · {s['word']}",
                                   "mcap": s.get("mcap"), "ch1": None, "vol1": None, "liq": s.get("liq"), "url": s.get("url")})
    return sorted(out.values(), key=lambda x: -x["t"])[:20]


def remember(brain, kind: str, text: str, coin: dict | None = None, tone: str = ""):
    mem = brain.state.setdefault("memory", [])
    if mem and mem[0]["text"] == text:
        return
    mem.insert(0, {"t": time.time(), "kind": kind, "text": text[:300], "coin": coin, "tone": tone})
    del mem[500:]


async def think(brain):
    """Every half minute: what changed goes to the memory (a coin starting to be followed or talked about, a verdict
    changing, a hunt sign, a new piece of advice)."""
    st = brain.state
    b = build(brain)
    allp = b["_all"]
    known = st.setdefault("mem_known", {})
    for p in allp:
        a = p["address"]
        if a not in known:
            known[a] = p["tone"]
            if st.get("mem_ready"):
                remember(brain, "follow", f"Comecei a seguir ${p.get('symbol')}: {why_buy(p)}", {"symbol": p.get("symbol"), "address": a, "url": p.get("url")}, p["tone"])
        elif known[a] != p["tone"]:
            remember(brain, "verdict", f"${p.get('symbol')} passou de «{_word(known[a])}» a «{p['verdict']}»: {why_buy(p) if p['tone'] != 'warn' else '; '.join(missing(p)[:2])}",
                     {"symbol": p.get("symbol"), "address": a, "url": p.get("url")}, p["tone"])
            known[a] = p["tone"]
    talkedk = st.setdefault("mem_talked", {})
    for x in talked(brain):
        if x["symbol"] not in talkedk:
            talkedk[x["symbol"]] = time.time()
            if st.get("mem_ready"):
                remember(brain, "talk", f"${x['symbol']} começou a ser falado (1.º @{x['who_first']}, {x['people']} pessoas em {', '.join(x['sources'])})",
                         {"symbol": x["symbol"], "address": x.get("address"), "url": x.get("url")}, "info")
    seen_ev = st.setdefault("mem_events", [])
    for e in reversed(brain.live.narr.view()[0]["hunt"]["events"] if brain.live.narr.view() else []):
        k = f"{e['kind']}:{e['t']:.0f}"
        if k not in seen_ev:
            seen_ev.append(k)
            remember(brain, "hunt", f"🎯 {e['text']}", e.get("coin"), "bad" if e["kind"] == "screen" else "warn")
    del seen_ev[:-300]
    adv = advice(allp)
    if st.get("mem_advice") != adv["head"] + adv["text"][:40]:
        st["mem_advice"] = adv["head"] + adv["text"][:40]
        remember(brain, "advice", f"Conselho: {adv['head']}. {adv['text']}", adv.get("coin"), adv["tone"])
    st["mem_ready"] = True
    for k in [k for k, v in talkedk.items() if time.time() - v > 86400]:
        talkedk.pop(k)


def _word(tone: str) -> str:
    return {"ok": BUY, "warn": WAIT, "bad": NO}.get(tone, tone)


def page(brain) -> dict:
    b = build(brain)
    allp = b.pop("_all")
    for p in b["picks"]:
        p["missing"] = missing(p)
    return {**b, "advice": advice(allp), "talked": talked(brain), "created": created(brain), "memory": brain.state.get("memory", [])[:120],
            "at": time.time(), "following": len(allp)}
