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


def _verdict(c: dict) -> tuple[str, str]:
    liq, vol1, ch1 = c.get("liq") or 0, c.get("vol1") or 0, c.get("ch1") or 0
    if c.get("danger") or liq < 10_000 or ch1 <= -40:
        return "Evitar", "bad"
    if liq >= 25_000 and vol1 >= 30_000 and ch1 > 0 and (c.get("mcap") or 0) <= liq * 25:
        return "Vale a pena olhar", "ok"
    return "Arriscado", "warn"


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
        if (t.get("score") or 0) < 55:
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
            if (c.get("vol1") or 0) < 5_000:
                continue
            p = pick(c["address"], symbol=c["symbol"], name=c["name"], chain=c.get("chain"), image=c.get("image"), url=c.get("url"),
                     mcap=c.get("mcap"), liq=c.get("liq"), vol1=c.get("vol1"), ch1=c.get("ch1"), age_h=c.get("age_h"))
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
    for p in picks.values():
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
    return {"picks": out[:16], "stream": uniq[:50], "counts": {"ok": ok, "warn": sum(1 for p in out if p["tone"] == "warn"),
                                                                 "bad": sum(1 for p in out if p["tone"] == "bad"), "said": len(uniq)}}
