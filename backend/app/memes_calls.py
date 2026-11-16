"""Quem acerta (#/memes): every call of the team's influencers and how it went, so the team follows only who is right.

16 nov, Marco: «depois dessas calls que os gajos mandam... como uma análise, a cada dia, se eram positivos ou negativos, para
ver se vale a pena seguir... encontrar os melhores influencers». The agent is the Alfred (Árbitro):

- A **call** = a post of one of the team's influencers that names a coin: its contract address (sure) or its $TICKER (the
  deepest pool with that symbol that already existed when the post was made: a guess, marked as such).
- History: the public page of each Telegram channel read backwards (`t.me/s/<canal>?before=<id>`) up to `DAYS` days, so the
  ranking does not start from zero. X and Instagram cannot be read for free (see memes.py).
- Prices from GeckoTerminal's candles of the coin's pool (free, ~30 requests a minute): the price when the post was made
  (the 15-minute candle that holds it), the best and the worst of the next 24 h, and the price 24 h later.
- **Result of a call** = price 24 h later / price at the call − 1. Up = positive, down = negative. «Se tivesses posto 100 $
  em cada call» sums 100 $ × result: buying at the call's price and selling 24 h later, no fees. Nobody bought anything.
"""
from __future__ import annotations

import asyncio
import html
import logging
import re
import time

import httpx

log = logging.getLogger("memes.calls")
DAYS = 30                 # how far back the history of a channel goes
HOLD = 24 * 3600          # a call is judged 24 h after it was made
GECKO = "https://api.geckoterminal.com/api/v2/networks"
NET = {"solana": "solana", "base": "base", "ethereum": "eth", "bsc": "bsc"}
STOCKS = {"NVDA", "TSLA", "AAPL", "MSFT", "AMZN", "GOOGL", "GOOG", "META", "COIN", "MSTR", "HOOD", "SPY", "QQQ", "PLTR", "GME",
          "AMC", "NFLX", "AMD", "INTC", "BABA", "CRCL", "SPX", "NDX", "DJI", "GOLD", "OIL"}
TAG = re.compile(r"<[^>]+>")


def _now() -> float:
    return time.time()


def call_refs(text: str) -> tuple[list[str], list[str]]:
    """(contract addresses, tickers) a post names, the way memes.py reads them."""
    from .memes import CASH, EVM_ADDR, MAJORS, NOT_MEME, SOL_ADDR
    addrs = list(dict.fromkeys(EVM_ADDR.findall(text) + [a for a in SOL_ADDR.findall(text)
                                                         if re.search(r"\d", a) and re.search(r"[a-z]", a) and re.search(r"[A-Z]", a)]))
    tickers = [k for k in dict.fromkeys(m.upper() for m in CASH.findall(text)) if k not in MAJORS and k not in STOCKS and not NOT_MEME.search(k)]
    return addrs[:2], tickers[:2]


class Judge:
    """Lives inside memes.BRAIN's state: `calls` (id -> call) and `history` (channel -> how far back it was read)."""

    def __init__(self, brain):
        self.b = brain

    @property
    def calls(self) -> dict:
        return self.b.state.setdefault("calls", {})

    # ---------- 1. collect: the influencers' posts that name a coin ----------
    def collect(self, posts: list[dict]):
        infs = {(i["platform"], i["handle"].lower()) for i in self.b.state["influencers"]}
        for p in posts:
            if (p.get("platform"), p["who"].lower()) not in infs or _now() - p["t"] > DAYS * 86400:
                continue
            addrs, tickers = call_refs(p["text"])
            refs = [("contrato", a) for a in addrs] or [("ticker", k) for k in tickers]
            for how, ref in refs[:2]:
                cid = f"{p['id']}|{ref}"
                if cid not in self.calls:
                    self.calls[cid] = {"id": cid, "post": p["id"], "platform": p.get("platform"), "who": p["who"], "url": p["url"],
                                       "text": p["text"][:300], "t": p["t"], "how": how, "ref": ref, "coin": None}

    async def history(self, c: httpx.AsyncClient):
        """Read each influencer channel backwards, a few pages a pass, until DAYS days are covered."""
        hist = self.b.state.setdefault("history", {})
        got = []
        for i in self.b.state["influencers"]:
            if i["platform"] != "telegram":
                continue
            ch = i["handle"]
            h = hist.setdefault(ch.lower(), {"before": None, "done": False})
            for _ in range(4):
                if h["done"]:
                    break
                url = f"https://t.me/s/{ch}" + (f"?before={h['before']}" if h["before"] else "")
                try:
                    page = (await c.get(url)).text
                except httpx.HTTPError:
                    break
                ids = []
                for block in page.split('class="tgme_widget_message_wrap')[1:]:
                    pid, body, when = (re.search(r'data-post="([^"]+)"', block), re.search(r'tgme_widget_message_text[^>]*>(.*?)</div>', block, re.S),
                                       re.search(r'datetime="([^"]+)"', block))
                    if not (pid and when):
                        continue
                    from .memes import _utc
                    ts = _utc(when.group(1))
                    ids.append((int(pid.group(1).rsplit("/", 1)[-1]), ts))
                    if body:
                        got.append({"id": "tg:" + pid.group(1), "platform": "telegram", "who": ch, "t": ts, "url": f"https://t.me/{pid.group(1)}",
                                    "text": html.unescape(TAG.sub(" ", body.group(1).replace("<br/>", "\n"))).strip()})
                if not ids:
                    h["done"] = True
                    break
                oldest = min(ids)
                h["before"] = oldest[0]
                if oldest[1] < _now() - DAYS * 86400 or oldest[0] <= 1:
                    h["done"] = True
                await asyncio.sleep(0.5)
        self.collect(got)
        return len(got)

    # ---------- 2. resolve: which coin each call is about ----------
    async def resolve(self, c: httpx.AsyncClient) -> int:
        from .memes import CHAINS, DEX, NOT_MEME
        todo = [x for x in self.calls.values() if x["coin"] is None][:25]
        n = 0
        for x in todo:
            try:
                if x["how"] == "contrato":
                    pairs = ((await c.get(f"{DEX}/latest/dex/tokens/{x['ref']}")).json() or {}).get("pairs") or []
                    pairs = [p for p in pairs if (p.get("baseToken") or {}).get("address") == x["ref"]]
                else:
                    pairs = ((await c.get(f"{DEX}/latest/dex/search", params={"q": x["ref"]})).json() or {}).get("pairs") or []
                    # the coin people meant had to exist when the post was made (a copy launched after it is another coin)
                    pairs = [p for p in pairs if (p.get("baseToken") or {}).get("symbol", "").upper() == x["ref"]
                             and (p.get("pairCreatedAt") or 0) / 1000 <= x["t"] + 600]
            except (httpx.HTTPError, ValueError):
                continue
            pairs = [p for p in pairs if p.get("chainId") in CHAINS and not NOT_MEME.search((p.get("baseToken") or {}).get("name", ""))]
            if not pairs:
                x["coin"] = False      # nothing to judge: it stays out of the numbers
                continue
            p = max(pairs, key=lambda p: (p.get("liquidity") or {}).get("usd") or 0)
            base = p["baseToken"]
            x["coin"] = {"chain": p["chainId"], "address": base["address"], "pair": p["pairAddress"], "symbol": base.get("symbol"),
                         "name": base.get("name"), "image": (p.get("info") or {}).get("imageUrl"), "url": p.get("url"),
                         "key": f"{p['chainId']}:{base['address']}", "price": float(p.get("priceUsd") or 0)}
            n += 1
            await asyncio.sleep(0.25)
        return n

    # ---------- 3. price: the coin at the call, its best and worst, and 24 h later ----------
    async def price(self, c: httpx.AsyncClient, budget: int = 14) -> int:
        now = _now()
        todo = sorted((x for x in self.calls.values() if x["coin"] and not x.get("done") and now - x.get("priced_at", 0) > 1800),
                      # the ones never priced and already 24 h old first: one visit and they are judged for good
                      key=lambda x: (x.get("priced_at", 0), now - x["t"] < HOLD, -x["t"]))[:budget]
        n = 0
        for x in todo:
            k, t = x["coin"], x["t"]
            base = f"{GECKO}/{NET[k['chain']]}/pools/{k['pair']}/ohlcv"
            try:
                if not x.get("p0"):
                    r = await c.get(f"{base}/minute", params={"aggregate": 15, "before_timestamp": int(t + 900), "limit": 2})
                    if r.status_code == 429:      # GeckoTerminal's limit (~30 a minute): the rest waits for the next pass
                        break
                    l = (r.json().get("data") or {}).get("attributes", {}).get("ohlcv_list") or []
                    at = [q for q in l if q[0] <= t]
                    if at:
                        x["p0"] = float(max(at, key=lambda q: q[0])[1])    # the open of the 15-minute candle that holds the post
                    await asyncio.sleep(3)
                end = min(now, t + HOLD + 3600)
                r = await c.get(f"{base}/hour", params={"aggregate": 1, "before_timestamp": int(end), "limit": 26})
                if r.status_code == 429:
                    break
                l = sorted((r.json().get("data") or {}).get("attributes", {}).get("ohlcv_list") or []) if r.status_code == 200 else []
                await asyncio.sleep(3)
            except (httpx.HTTPError, ValueError, KeyError):
                continue
            x["priced_at"] = now
            after = [r for r in l if t - 3600 < r[0] <= t + HOLD]
            if not x.get("p0") and after:
                x["p0"] = float(after[0][1])
            if not x.get("p0") or not after:
                x["err"] = "sem preços desta moeda"
                if now - t > HOLD + 86400:
                    x["done"] = True
                continue
            p0 = x["p0"]
            x["peak"] = round((max(r[2] for r in after) / p0 - 1) * 100, 1)
            x["low"] = round((min(r[3] for r in after) / p0 - 1) * 100, 1)
            x["now"] = round((after[-1][4] / p0 - 1) * 100, 1)
            h1 = [r for r in after if r[0] >= t + 3600]
            if h1:
                x["r1h"] = round((h1[0][4] / p0 - 1) * 100, 1)
            if now >= t + HOLD:
                x["r24"] = round((after[-1][4] / p0 - 1) * 100, 1)   # the close of the last hour inside the 24 h
                x["done"] = True
            x.pop("err", None)
            n += 1
        return n

    async def run(self, c: httpx.AsyncClient):
        from .memes import _utc  # noqa: F401  (history uses it)
        self.collect(self.b.state["posts"])
        old = await self.history(c)
        found = await self.resolve(c)
        priced = await self.price(c)
        for k in [k for k, x in self.calls.items() if _now() - x["t"] > (DAYS + 5) * 86400]:
            self.calls.pop(k)
        judged = sum(1 for x in self.calls.values() if x.get("done") and x.get("r24") is not None)
        self.b.run_mark("arbitro", True, judged, f"{len(self.calls)} calls guardados, {judged} já julgados (24 h)"
                        + (f"; {old} publicações antigas lidas" if old else "") + (f"; {found} moedas encontradas" if found else "")
                        + (f"; {priced} preços atualizados" if priced else ""))


# ---------- the numbers the page shows ----------
def _day(ts: float) -> str:
    return time.strftime("%Y-%m-%d", time.gmtime(ts))


def verdict(n: int, up: int, total: float) -> tuple[str, str]:
    if n < 5:
        return "Poucos calls ainda", "mute"
    rate = up / n
    if rate >= 0.55 and total > 0:
        return "Vale a pena seguir", "ok"
    if total < 0 and rate < 0.45:
        return "Não vale a pena", "bad"
    return "A observar", "warn"


def board(state: dict) -> dict:
    """The ranking of the influencers by their judged calls, each with its day by day, and the calls themselves."""
    infs = state["influencers"]
    calls = [x for x in state.get("calls", {}).values() if x.get("coin")]
    # the same coin said again by the same person within 24 h is the same call (Dippy wrote $HWAN three times in 2 h)
    first: dict = {}
    for x in sorted(calls, key=lambda x: x["t"]):
        k = (x.get("platform"), x["who"].lower(), x["coin"]["key"])
        x["repeat"] = k in first and x["t"] - first[k] < HOLD
        if not x["repeat"]:
            first[k] = x["t"]
    calls = [x for x in calls if not x["repeat"]]
    out = []
    for i in infs:
        mine = sorted((x for x in calls if x.get("platform") == i["platform"] and x["who"].lower() == i["handle"].lower()), key=lambda x: -x["t"])
        judged = [x for x in mine if x.get("r24") is not None]
        up = sum(1 for x in judged if x["r24"] > 0)
        total = round(sum(x["r24"] for x in judged), 1)            # 100 $ in each: the result in % is the result in $
        days: dict[str, dict] = {}
        for x in judged:
            d = days.setdefault(_day(x["t"]), {"day": _day(x["t"]), "n": 0, "up": 0, "usd": 0.0})
            d["n"] += 1
            d["up"] += x["r24"] > 0
            d["usd"] = round(d["usd"] + x["r24"], 1)
        v = verdict(len(judged), up, total)
        best = max(judged, key=lambda x: x["r24"], default=None)
        out.append({"platform": i["platform"], "handle": i["handle"], "name": i.get("name"), "avatar": i.get("avatar"),
                    "calls": len(mine), "judged": len(judged), "up": up, "down": len(judged) - up, "usd": total,
                    "open": sum(1 for x in mine if x.get("r24") is None), "verdict": v[0], "tone": v[1],
                    "last10": [1 if x["r24"] > 0 else -1 for x in judged[:10]],
                    "best": best and {"symbol": best["coin"]["symbol"], "r24": best["r24"]},
                    "days": sorted(days.values(), key=lambda d: d["day"], reverse=True)[:14]})
    out.sort(key=lambda r: (r["judged"] >= 5, r["usd"], r["judged"]), reverse=True)
    face = {(i["platform"], i["handle"].lower()): i for i in infs}
    rows = []
    for x in sorted(calls, key=lambda x: -x["t"])[:120]:
        i = face.get((x.get("platform"), x["who"].lower()), {})
        rows.append({k: x.get(k) for k in ("id", "who", "platform", "url", "text", "t", "how", "p0", "peak", "low", "now", "r1h", "r24", "done", "err")}
                    | {"coin": {k: x["coin"].get(k) for k in ("symbol", "name", "image", "url", "key", "chain")}, "name": i.get("name") or x["who"],
                       "avatar": i.get("avatar")})
    return {"ranking": out, "calls": rows, "waiting": sum(1 for x in state.get("calls", {}).values() if x.get("coin") is None)}
