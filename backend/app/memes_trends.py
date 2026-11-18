"""Tendências (18 nov, David: «ver os contratos de todos os canais... saber o trend mais frequente em que se pode ganhar»).

Lives inside memes_live.Live (live.trends), next to the narratives. Two things, from what the other agents already read:

- **Palavras**: every pump.fun launch (PumpPortal websocket) split into the words of its name and ticker. For each word, in the
  last 1 h and 6 h: how many coins were launched with it and how many of them got to `WIN` $ (the peak the Live checker saw at
  3/10/30 min). The trend «em que se ganha» is the word with launches *and* winners, not just the most launched.
- **Contratos e canais**: every post read anywhere (Telegram channels of the Oráculo, Reddit, X by the Tree News) with a Solana
  contract. Per contract: who said it, how many channels, the first one. Its price (DexScreener) is taken the first time we see it
  (only when the post is < 15 min old: an old post would give a wrong «price at the call») and the peak after. Per channel: how
  many contracts it posted in 24 h and how many went ×2 from the price at its post.
Everything in memory: a restart starts the counts again.
"""
from __future__ import annotations

import re
import time
from collections import deque

import httpx

WIN = 30_000          # a launch that got to 30 k$ counts as a winner
FRESH = 15 * 60       # a post older than this when first seen has no «price at the call»
CA = re.compile(r"\b[1-9A-HJ-NP-Za-km-z]{32,44}\b")
STOP = set("""the and for of to in on a an is it my me you we our your this that with from by at as be are was coin token
memecoin meme sol solana pump fun official real new first last best just only not no yes inu dao club world""".split())


def words_of(symbol: str | None, name: str | None) -> set[str]:
    out = set()
    for w in re.split(r"[^0-9a-zà-ÿ]+", f"{name or ''} {symbol or ''}".lower()):
        if len(w) >= 3 and not w.isdigit() and w not in STOP:
            out.add(w)
    return out


def addrs_of(text: str) -> list[str]:
    return [a for a in dict.fromkeys(CA.findall(text or ""))
            if re.search(r"\d", a) and re.search(r"[a-z]", a) and re.search(r"[A-Z]", a)][:4]


class Trends:
    def __init__(self, live):
        self.live = live
        self.calls: dict[str, dict] = {}          # contract -> {"by": {who: {...}}, "first": {...}, "dex": {...}}
        self.seen: deque = deque(maxlen=6000)
        self._seen: set = set()
        self.at = 0.0

    # ---------- what passes ----------
    def on_post(self, src: str, who: str, text: str, url: str, ts: float, pid: str = ""):
        now = time.time()
        if now - ts > 86400:
            return
        key = pid or url or text[:80]
        if key in self._seen:
            return
        if len(self.seen) == self.seen.maxlen:
            self._seen.discard(self.seen[0])
        self.seen.append(key)
        self._seen.add(key)
        for a in addrs_of(text):
            c = self.calls.setdefault(a, {"by": {}, "first": None, "dex": {}, "t": ts})
            if who in c["by"]:
                c["by"][who]["n"] += 1
                continue
            c["by"][who] = {"who": who, "src": src, "t": ts, "url": url, "n": 1, "fresh": now - ts < FRESH, "mc": None}
            if not c["first"] or ts < c["first"]["t"]:
                c["first"] = {"who": who, "src": src, "t": ts, "url": url}
            c["t"] = max(c["t"], ts)

    # ---------- one pass (from Live.checker, every 10 s; prices every 30 s) ----------
    async def run(self, c: httpx.AsyncClient):
        now = time.time()
        for a in [a for a, d in self.calls.items() if now - d["t"] > 86400]:
            self.calls.pop(a)
        if now - self.at < 30:
            return
        self.at = now
        want = sorted(self.calls, key=lambda a: (-len(self.calls[a]["by"]), -self.calls[a]["t"]))[:90]
        got = await self.live._dex(c, want)
        for a, d in got.items():
            k = self.calls.get(a)
            if not k:
                continue
            k["dex"] = d
            k["peak"] = max(k.get("peak") or 0, d.get("mcap") or 0)
            for b in k["by"].values():
                if b["mc"] is None and b["fresh"] and d.get("mcap"):
                    b["mc"] = d["mcap"]
                if d.get("mcap"):
                    b["peak"] = max(b.get("peak") or 0, d["mcap"])

    # ---------- for the page ----------
    def _words(self, hours: float) -> list[dict]:
        now = time.time()
        acc: dict[str, dict] = {}
        for l in reversed(list(self.live.launches.values())):
            if now - l["t"] > hours * 3600:
                break
            peak = l.get("peak") or 0
            for w in words_of(l.get("symbol"), l.get("name")):
                s = acc.setdefault(w, {"word": w, "n": 0, "win": 0, "best": None})
                s["n"] += 1
                if peak >= WIN:
                    s["win"] += 1
                if peak and (not s["best"] or peak > s["best"]["peak"]):
                    s["best"] = {"mint": l["mint"], "symbol": l["symbol"], "peak": peak, "url": (l.get("dex") or {}).get("url")}
        rows = [s for s in acc.values() if s["n"] >= 3]
        for s in rows:
            s["rate"] = round(100 * s["win"] / s["n"])
        rows.sort(key=lambda s: (-s["win"], -s["n"]))
        return rows[:25]

    def view(self) -> dict:
        now = time.time()
        coins = []
        for a, k in self.calls.items():
            d = k["dex"]
            first = k["first"] or {}
            fb = k["by"].get(first.get("who")) or {}
            x = round(d["mcap"] / fb["mc"], 2) if fb.get("mc") and d.get("mcap") else None
            xp = round(k["peak"] / fb["mc"], 2) if fb.get("mc") and k.get("peak") else None
            coins.append({"address": a, "symbol": d.get("symbol") or "", "name": d.get("name") or "", "image": d.get("image"),
                          "url": d.get("url"), "mcap": d.get("mcap"), "liq": d.get("liq"), "ch1": d.get("ch1"), "vol1": d.get("vol1"),
                          "channels": len(k["by"]), "mentions": sum(b["n"] for b in k["by"].values()), "t": k["t"],
                          "first": first and {**first, "mc": fb.get("mc"), "x": x, "x_peak": xp},
                          "who": [b["who"] for b in sorted(k["by"].values(), key=lambda b: b["t"])][:6]})
        coins.sort(key=lambda c: (-c["channels"], -c["mentions"], -c["t"]))
        ch: dict[str, dict] = {}
        for a, k in self.calls.items():
            for b in k["by"].values():
                s = ch.setdefault(b["who"], {"who": b["who"], "src": b["src"], "calls": 0, "judged": 0, "x2": 0, "xs": [], "first": 0})
                s["calls"] += 1
                if (k["first"] or {}).get("who") == b["who"] and len(k["by"]) > 1:
                    s["first"] += 1
                if b.get("mc") and b.get("peak"):
                    s["judged"] += 1
                    xp = b["peak"] / b["mc"]
                    s["xs"].append(xp)
                    s["x2"] += xp >= 2
        chans = []
        for s in ch.values():
            xs = sorted(s.pop("xs"))
            s["med"] = round(xs[len(xs) // 2], 2) if xs else None
            chans.append(s)
        chans.sort(key=lambda s: (-s["calls"], -s["x2"]))
        return {"w1": self._words(1), "w6": self._words(6), "coins": coins[:40], "channels": chans[:30],
                "launches6": sum(1 for l in self.live.launches.values() if now - l["t"] < 6 * 3600), "win": WIN, "at": self.at}
