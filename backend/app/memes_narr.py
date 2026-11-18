"""Narrativas (Memecoins › Ao vivo): one theme the whole market is trading, followed everywhere at once. The first is GTA 6.

18 nov, Marco (GTA 6 comes out on 19 Nov 2026 and the GTA coins were exploding: Leonida +706 % in an hour, GTA VI at 10 M$,
$58 M of weekly volume in GTA-themed Solana coins): «procura as melhores fontes... o pessoal a mandar calls disso... todos os
gajos que estiverem a fazer live... pesquisa por GTA em todo o lado, e mete isso tudo para o widget... o nosso objetivo é
comprar memecoins e fazer dinheiro com isso... agora é o momento perfeito».

What a narrative follows, every pass of memes_live.Live.checker:
- **Moedas** (DexScreener search, free, every 45 s): each `search` term; a pair counts only if the coin's own name or
  ticker belongs to the theme (`coin_hit`: a strong word inside it, or a weak one as the whole name: «Lucia», «Wasted»).
  The best pool per coin, with price, size, pool, volume 5 min/1 h/24 h, change, buys/sells and age; and tags in words:
  A explodir, Nova, Forte, Perigo.
- **Novas**: every pump.fun launch whose name hits the theme, the second it is created (memes_live.on_pump).
- **Calls e posts**: every post of X (Tree News, and with the twitterapi.io key also an X search), Telegram (the channels of
  the Oráculo, plus the GTA news channels) and Reddit that talks of the theme (`text_hit`); one that names a coin of the
  theme by $TICKER or contract is a call, and the first to call each coin is kept.
- **Lives**: the live streams on YouTube for `yt` (the public results page, every 5 min), and with a Twitch key (the
  official Helix API, free: twitch_id and twitch_secret in the memes cfg) the streams of the game on Twitch.
- **Aviso**: a coin of the theme that explodes with money behind it (≥ 50 k$ in an hour, ≥ +100 % in an hour, pool ≥ 25 k$)
  goes once to the bell, the widget and the phone (memes.send).
Memory only; the narratives can be changed in the memes state (`narratives`), the default is GTA 6.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import time
import unicodedata
from collections import deque

import httpx

log = logging.getLogger("memes.narr")
DEX_SEARCH = "https://api.dexscreener.com/latest/dex/search?q="
YT = "https://www.youtube.com/results?search_query={q}&sp=EgJAAQ%253D%253D"   # sp: only live now
BROWSER = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131 Safari/537.36",
           "Accept-Language": "en-US,en;q=0.8,pt;q=0.6"}

GTA = {
    "id": "gta", "name": "GTA 6", "since": "2026-11-18",
    "note": "O GTA 6 sai a 19 de novembro de 2026: as moedas com o nome do jogo, das personagens e de Leonida estão a mexer.",
    # inside a coin's name or ticker (normalised): enough on its own
    "strong": ["gta", "grandtheft", "vicecity", "leonida", "rockstar", "vercetti", "dacity", "cyberleek", "grovestreet", "gtavi"],
    # only as the coin's whole name or ticker (a coin called just «Lucia» in this week is a GTA coin; «Lucia Pizza» is not)
    "weak": ["lucia", "jason", "wasted", "busted", "tommy", "trevor", "franklin", "niko", "lamar", "cj", "fivestars", "wantedlevel"],
    # in a post: the theme is being talked about
    "text": r"\bgta\s?(?:6|vi|six)?\b|\bgta6\b|grand\s+theft\s+auto|vice\s?city|\bleonida\b|rockstar\s?games|\bvercetti\b|\bdacity\b|"
            r"\bcyberleek\b|\$(?:lucia|jason|wasted|leonida|gta\w*|vice\w*|rockstar)\b",
    "search": ["gta", "gta6", "gta vi", "leonida", "vice city", "rockstar", "lucia", "wasted", "vercetti", "grand theft", "dacity"],
    "yt": ["GTA 6", "GTA 6 memecoin"],
    "twitch_game": "Grand Theft Auto VI",
    "x_query": '(GTA6 OR "GTA 6" OR "GTA VI" OR Leonida OR "Vice City") (memecoin OR "pump.fun" OR pumpfun OR CA OR solana OR $GTA OR ape) -is:retweet',
}
DEFAULT = [GTA]


def norm(s: str | None) -> str:
    return "".join(c.lower() for c in unicodedata.normalize("NFKD", s or "") if c.isalnum() and not unicodedata.combining(c))


def coin_hit(n: dict, symbol: str | None, name: str | None) -> str | None:
    """Which word of the theme the coin's name or ticker carries, or None."""
    s, nm = norm(symbol), norm(name)
    for w in n["strong"]:
        if w in s or w in nm:
            return w
    for w in n["weak"]:
        if w in (s, nm):
            return w
    return None


def text_hit(n: dict, text: str) -> bool:
    return bool(re.search(n["text"], text or "", re.I))


def _viewers(s: str) -> int:
    m = re.search(r"([\d.,]+)\s*([KkMm]?)\s*(?:watching|a assistir|assistindo|espectadores)", s or "")
    if not m:
        return 0
    v = float(m.group(1).replace(",", "")) if m.group(2) else float(m.group(1).replace(",", "").replace(".", ""))
    return int(v * {"k": 1e3, "m": 1e6}.get(m.group(2).lower(), 1))


def yt_lives(page: str) -> list[dict]:
    """The live videos of a YouTube results page (its ytInitialData: the lockupViewModel cards of 2026)."""
    m = re.search(r"var ytInitialData = (\{.*?\});</script>", page, re.S)
    if not m:
        return []
    try:
        data = json.loads(m.group(1))
    except ValueError:
        return []
    out: list[dict] = []

    def texts(o, acc):
        if isinstance(o, dict):
            if isinstance(o.get("content"), str):
                acc.append(o["content"])
            for v in o.values():
                texts(v, acc)
        elif isinstance(o, list):
            for x in o:
                texts(x, acc)
        return acc

    def walk(o):
        if isinstance(o, dict):
            r = o.get("videoRenderer")   # the older cards (YouTube serves either, by browser)
            if isinstance(r, dict) and r.get("videoId"):
                run = lambda x: (x or {}).get("simpleText") or "".join(t.get("text", "") for t in (x or {}).get("runs", []))  # noqa: E731
                watching = run(r.get("viewCountText"))
                if _viewers(watching):
                    thumbs = (r.get("thumbnail") or {}).get("thumbnails") or [{}]
                    out.append({"id": r["videoId"], "title": run(r.get("title"))[:120], "channel": run(r.get("ownerText"))[:60],
                                "viewers": _viewers(watching), "thumb": thumbs[-1].get("url", ""),
                                "url": f"https://www.youtube.com/watch?v={r['videoId']}", "site": "YouTube"})
            v = o.get("lockupViewModel")
            if isinstance(v, dict) and v.get("contentId"):
                md = (v.get("metadata") or {}).get("lockupMetadataViewModel") or {}
                rows = texts(md.get("metadata") or {}, [])
                watching = next((r for r in rows if _viewers(r)), "")
                if watching:
                    thumb = ""
                    try:
                        thumb = v["contentImage"]["thumbnailViewModel"]["image"]["sources"][0]["url"]
                    except (KeyError, IndexError, TypeError):
                        pass
                    out.append({"id": v["contentId"], "title": ((md.get("title") or {}).get("content") or "")[:120],
                                "channel": rows[0][:60] if rows else "", "viewers": _viewers(watching), "thumb": thumb,
                                "url": f"https://www.youtube.com/watch?v={v['contentId']}", "site": "YouTube"})
            for x in o.values():
                walk(x)
        elif isinstance(o, list):
            for x in o:
                walk(x)
    walk(data)
    return out


class Narratives:
    """Lives inside memes_live.Live (live.narr)."""

    def __init__(self, live):
        self.live = live
        self.state: dict[str, dict] = {}
        self._twitch = {"token": "", "exp": 0.0, "game": {}}

    @property
    def defs(self) -> list[dict]:
        return self.live.b.state.get("narratives") or DEFAULT

    def of(self, nid: str) -> dict:
        return self.state.setdefault(nid, {"coins": {}, "feed": deque(maxlen=300), "seen": set(), "lives": [], "first": {},
                                            "at": 0.0, "lives_at": 0.0, "x_at": 0.0, "told": {}, "launches": deque(maxlen=200)})

    # ---------- what the other agents see pass ----------
    def on_post(self, src: str, who: str, text: str, url: str, ts: float, pid: str = "", name: str = ""):
        """Any post read anywhere (Tree News, the Oráculo's Telegram/Reddit/X, the X search): kept when it talks of a theme."""
        for n in self.defs:
            if not text_hit(n, text):
                continue
            s = self.of(n["id"])
            key = pid or url or text[:80]
            if key in s["seen"]:
                continue
            s["seen"].add(key)
            if len(s["seen"]) > 4000:
                s["seen"] = set(list(s["seen"])[-2000:])
            cash = sorted({m.upper() for m in re.findall(r"(?<![\w$])\$([A-Za-z][A-Za-z0-9]{1,11})\b", text)})
            cas = [a for a in dict.fromkeys(re.findall(r"\b[1-9A-HJ-NP-Za-km-z]{32,44}\b", text))
                   if re.search(r"\d", a) and re.search(r"[a-z]", a) and re.search(r"[A-Z]", a)]
            s["feed"].appendleft({"src": src, "who": who, "name": name or who, "text": text[:500], "url": url, "t": ts,
                                  "tickers": cash[:6], "addrs": cas[:3]})

    def on_launch(self, l: dict):
        for n in self.defs:
            w = coin_hit(n, l["symbol"], l["name"])
            if w:
                l.setdefault("narr", []).append(n["id"])
                self.of(n["id"])["launches"].appendleft({**{k: l[k] for k in ("mint", "symbol", "name", "t", "dev_sol")}, "why": w})

    # ---------- one pass ----------
    async def run(self, c: httpx.AsyncClient):
        now = time.time()
        for n in self.defs:
            s = self.of(n["id"])
            if now - s["at"] >= 45:
                s["at"] = now
                await self._coins(c, n, s)
            if now - s["lives_at"] >= 300:
                s["lives_at"] = now
                await self._lives(c, n, s)
            key = self.live.b.cfg.get("x_key")
            if key and n.get("x_query") and now - s["x_at"] >= 180:
                s["x_at"] = now
                await self._x(c, n, key)
            self._calls(s)
            await self._tell(n, s)

    async def _coins(self, c: httpx.AsyncClient, n: dict, s: dict):
        found: dict[str, dict] = {}
        for q in n["search"]:
            try:
                pairs = ((await c.get(DEX_SEARCH + q, timeout=15)).json() or {}).get("pairs") or []
            except (httpx.HTTPError, ValueError):
                continue
            for p in pairs:
                b = p.get("baseToken") or {}
                w = coin_hit(n, b.get("symbol"), b.get("name"))
                if not w or not b.get("address"):
                    continue
                liq = (p.get("liquidity") or {}).get("usd") or 0
                if b["address"] in found and (found[b["address"]]["liq"] or 0) >= liq:
                    continue
                vol, ch, tx = p.get("volume") or {}, p.get("priceChange") or {}, p.get("txns") or {}
                found[b["address"]] = {
                    "address": b["address"], "chain": p.get("chainId"), "symbol": (b.get("symbol") or "?")[:16], "name": (b.get("name") or "")[:40],
                    "why": w, "image": (p.get("info") or {}).get("imageUrl"), "url": p.get("url"), "dex": p.get("dexId"),
                    "price": float(p.get("priceUsd") or 0) or None, "mcap": p.get("marketCap") or p.get("fdv"), "liq": liq or None,
                    "vol5": vol.get("m5") or 0, "vol1": vol.get("h1") or 0, "vol24": vol.get("h24") or 0,
                    "ch5": ch.get("m5"), "ch1": ch.get("h1"), "ch24": ch.get("h24"),
                    "b1": (tx.get("h1") or {}).get("buys", 0), "s1": (tx.get("h1") or {}).get("sells", 0),
                    "created": (p.get("pairCreatedAt") or 0) / 1000 or None, "at": time.time()}
            await asyncio.sleep(0.2)
        for a, d in found.items():
            old = s["coins"].get(a) or {}
            d["seen"] = old.get("seen") or time.time()
            d["peak"] = max(old.get("peak") or 0, d["mcap"] or 0)
            s["coins"][a] = d
        # coins that fell out of the search for a day go
        for a in [a for a, d in s["coins"].items() if time.time() - d["at"] > 86400]:
            s["coins"].pop(a)

    async def _lives(self, c: httpx.AsyncClient, n: dict, s: dict):
        got: dict[str, dict] = {}
        for q in n.get("yt") or []:
            try:
                r = await c.get(YT.format(q=q.replace(" ", "+")), headers=BROWSER, timeout=20)
                for v in yt_lives(r.text):
                    got.setdefault(v["id"], {**v, "q": q})
            except httpx.HTTPError:
                continue
        got.update({v["id"]: v for v in await self._twitch_streams(c, n)})
        if got:
            s["lives"] = sorted(got.values(), key=lambda v: -v["viewers"])[:30]

    async def _twitch_streams(self, c: httpx.AsyncClient, n: dict) -> list[dict]:
        cfg = self.live.b.cfg
        cid, sec = cfg.get("twitch_id"), cfg.get("twitch_secret")
        if not (cid and sec and n.get("twitch_game")):
            return []
        try:
            if time.time() > self._twitch["exp"]:
                r = await c.post("https://id.twitch.tv/oauth2/token", data={"client_id": cid, "client_secret": sec, "grant_type": "client_credentials"})
                j = r.json()
                self._twitch.update(token=j["access_token"], exp=time.time() + j.get("expires_in", 3600) - 120)
            h = {"Client-Id": cid, "Authorization": f"Bearer {self._twitch['token']}"}
            gid = self._twitch["game"].get(n["twitch_game"])
            if not gid:
                g = (await c.get("https://api.twitch.tv/helix/games", params={"name": n["twitch_game"]}, headers=h)).json().get("data") or []
                gid = self._twitch["game"][n["twitch_game"]] = g[0]["id"] if g else ""
            if not gid:
                return []
            rows = (await c.get("https://api.twitch.tv/helix/streams", params={"game_id": gid, "first": 20}, headers=h)).json().get("data") or []
            return [{"id": "tw" + x["id"], "title": x.get("title", "")[:120], "channel": x.get("user_name", ""), "viewers": x.get("viewer_count", 0),
                     "thumb": (x.get("thumbnail_url") or "").replace("{width}", "320").replace("{height}", "180"),
                     "url": f"https://www.twitch.tv/{x.get('user_login', '')}", "site": "Twitch"} for x in rows]
        except (httpx.HTTPError, ValueError, KeyError, IndexError):
            return []

    async def _x(self, c: httpx.AsyncClient, n: dict, key: str):
        """With the twitterapi.io key: the latest tweets of the whole X about the theme (≈ 20 a call, ≈ 0,003 $)."""
        from .memes import _tweet_time
        try:
            r = await c.get("https://api.twitterapi.io/twitter/tweet/advanced_search", params={"query": n["x_query"], "queryType": "Latest"},
                            headers={"X-API-Key": key}, timeout=25)
            tweets = (r.json() or {}).get("tweets") or []
        except (httpx.HTTPError, ValueError):
            return
        used = self.live.b.state.setdefault("x_used", {"tweets": 0, "since": time.time()})
        used["tweets"] = used.get("tweets", 0) + len(tweets)
        for tw in tweets:
            a = tw.get("author") or {}
            self.on_post("X", a.get("userName") or "", tw.get("text") or "", tw.get("url") or "", _tweet_time(tw.get("createdAt")) or time.time(),
                         "x:" + str(tw.get("id")), a.get("name") or "")

    def _calls(self, s: dict):
        """A post naming a coin of the theme ($TICKER or contract) is a call; the first caller of each coin is kept."""
        by_sym: dict[str, dict] = {}
        for d in s["coins"].values():
            k = d["symbol"].upper()
            if k not in by_sym or (d["liq"] or 0) > (by_sym[k]["liq"] or 0):
                by_sym[k] = d
        for p in reversed(s["feed"]):
            coins = [s["coins"][a] for a in p["addrs"] if a in s["coins"]] or [by_sym[k] for k in p["tickers"] if k in by_sym]
            p["coins"] = [{"address": d["address"], "symbol": d["symbol"], "mcap_then": p.get("coins_then", {}).get(d["address"], d["mcap"])} for d in coins[:3]]
            p.setdefault("coins_then", {}).update({d["address"]: d["mcap"] for d in coins if d["address"] not in p.get("coins_then", {})})
            for d in coins:
                f = s["first"].get(d["address"])
                if not f or p["t"] < f["t"]:
                    s["first"][d["address"]] = {"who": p["who"], "src": p["src"], "t": p["t"], "url": p["url"], "mcap": p["coins_then"].get(d["address"])}

    async def _tell(self, n: dict, s: dict):
        from .memes import send
        out = []
        for d in s["coins"].values():
            if (d["vol1"] or 0) >= 50_000 and (d["ch1"] or 0) >= 100 and (d["liq"] or 0) >= 25_000 and d["address"] not in s["told"]:
                s["told"][d["address"]] = time.time()
                out.append(("high", f"{n['name']}: ${d['symbol']} a explodir",
                            f"+{d['ch1']:.0f}% numa hora, {d['vol1']:,.0f} $ negociados, vale {d['mcap'] or 0:,.0f} $ (pool {d['liq']:,.0f} $). "
                            "Não é conselho: memecoins podem ir a zero em minutos.".replace(",", " ")))
        if out:
            try:
                await send(out[:2])
            except Exception:  # noqa: BLE001 - a busy database must not stop the radar
                log.exception("narr send")

    # ---------- for the page ----------
    def view(self) -> list[dict]:
        now = time.time()
        out = []
        for n in self.defs:
            s = self.of(n["id"])
            coins = []
            for d in sorted(s["coins"].values(), key=lambda d: -(d["vol1"] or 0))[:60]:
                age = (now - d["created"]) / 3600 if d.get("created") else None
                tags = []
                if (d["ch1"] or 0) >= 50 and (d["vol1"] or 0) >= 20_000:
                    tags.append(["A explodir", "ok"])
                if age is not None and age < 6:
                    tags.append(["Nova", "info"])
                if (d["vol24"] or 0) >= 1_000_000 and (d["liq"] or 0) >= 50_000:
                    tags.append(["Forte", "ok"])
                if not d["liq"] or d["liq"] < 10_000 or ((d["mcap"] or 0) / d["liq"] > 40 if d["liq"] else False) or (d["ch1"] or 0) <= -40:
                    tags.append(["Perigo", "bad"])
                f = s["first"].get(d["address"])
                calls = sum(1 for p in s["feed"] if any(cn["address"] == d["address"] for cn in p.get("coins") or []))
                coins.append({**{k: d[k] for k in ("address", "chain", "symbol", "name", "image", "url", "mcap", "liq", "vol5", "vol1", "vol24",
                                                   "ch5", "ch1", "ch24", "b1", "s1", "peak", "why")},
                              "age_h": round(age, 1) if age is not None else None, "tags": tags, "calls": calls,
                              "first": f and {**f, "x": round(d["mcap"] / f["mcap"], 1) if f.get("mcap") and d.get("mcap") else None}})
            launches = []
            for l in list(s["launches"])[:40]:
                ld = self.live.launches.get(l["mint"]) or {}
                dx = ld.get("dex") or {}
                launches.append({**l, "mcap": dx.get("mcap") or ((ld.get("mc_sol") or 0) * self.live.sol_usd if self.live.sol_usd else None),
                                 "image": dx.get("image"), "ch5": dx.get("ch5"), "migrated": bool(ld.get("migrated"))})
            feed = [{k: p.get(k) for k in ("src", "who", "name", "text", "url", "t", "tickers", "coins")}
                    for p in sorted(s["feed"], key=lambda p: -p["t"])[:60]]   # newest first, whatever read it first
            vol1 = sum(d["vol1"] or 0 for d in s["coins"].values())
            out.append({"id": n["id"], "name": n["name"], "note": n.get("note", ""), "coins": coins, "launches": launches, "feed": feed,
                        "lives": s["lives"][:20], "vol1": vol1, "n_coins": len(s["coins"]),
                        "viewers": sum(v["viewers"] for v in s["lives"]), "at": s["at"], "lives_at": s["lives_at"]})
        return out
