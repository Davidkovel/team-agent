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
import sys
from pathlib import Path

log = logging.getLogger("memes.narr")
DEX_SEARCH = "https://api.dexscreener.com/latest/dex/search?q="
YT = "https://www.youtube.com/results?search_query={q}&sp=EgJAAQ%253D%253D"   # sp: only live now
BROWSER = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131 Safari/537.36",
           "Accept-Language": "en-US,en;q=0.8,pt;q=0.6"}

GTA = {
    "id": "gta", "name": "GTA 6", "since": "2026-11-18",
    "note": "O GTA 6 sai a 19 de novembro de 2026: as moedas com o nome do jogo, das personagens e de Leonida estão a mexer.",
    # inside a coin's name or ticker (normalised): enough on its own
    "strong": ["gta", "grandtheft", "vicecity", "leonida", "rockstar", "vercetti", "dacity", "cyberleek", "grovestreet", "gtavi",
               "tomas"],   # 18 Nov, 12h: «Tomás», Lucia's son, dozens of coins in 2 hours (Tomás Lucia's Baby, Baby Tomas Wanted...)
    # only as the coin's whole name or ticker (a coin called just «Lucia» in this week is a GTA coin; «Lucia Pizza» is not)
    "weak": ["lucia", "jason", "wasted", "busted", "tommy", "trevor", "franklin", "niko", "lamar", "cj", "fivestars", "wantedlevel"],
    # in a post: the theme is being talked about
    "text": r"\bgta\s?(?:6|vi|six)?\b|\bgta6\b|grand\s+theft\s+auto|vice\s?city|\bleonida\b|rockstar\s?games|\bvercetti\b|\bdacity\b|"
            r"\bcyberleek\b|\$(?:lucia|jason|wasted|leonida|gta\w*|vice\w*|rockstar|tomas)\b|lucia'?s\s+(?:baby|son)|baby\s+tom[aá]s",
    "search": ["gta", "gta6", "gta vi", "leonida", "vice city", "rockstar", "lucia", "wasted", "vercetti", "grand theft", "dacity", "tomas", "baby tomas"],
    "yt": ["GTA 6", "GTA 6 memecoin"],
    "twitch_game": "Grand Theft Auto VI",
    "x_query": '(GTA6 OR "GTA 6" OR "GTA VI" OR Leonida OR "Vice City") (memecoin OR "pump.fun" OR pumpfun OR CA OR solana OR $GTA OR ape) -is:retweet',
}
DEFAULT = [GTA]

# 18 Nov, 14h, Marco: «vai haver uma moeda do Dacity... só há pessoas a falar disso... ainda não apareceu em nenhuma stream
# aquele avião... estamos à espera que apareça numa live para a coin sair... mete-te em cima disso». The hunt: words the team is
# waiting for. The moment one shows anywhere it is an alert (bell, widget, phone): a pump.fun coin born with it, a coin with it
# starting to move, a post, a live's title, or **written on the screen of a live** (the frame YouTube shows of each live,
# read by the Mac's own text recognition, tools/ocr_mac.swift: free, nothing of the Claude spent).
HUNT = ["dacity"]
DEX_TOKENS = "https://api.dexscreener.com/latest/dex/tokens/"
MILESTONES = (250_000, 1_000_000, 5_000_000, 10_000_000, 25_000_000, 50_000_000)


def variants(term: str) -> list[str]:
    """A hunted word as the coins really write it. 18 Nov: the Dacity coin that fired was $DCTY «DacityCoin», and a
    search for «dacity» never returned it: so its ticker without vowels too (DCTY), and «<word> coin»."""
    w = norm(term)
    skel = w[:1] + "".join(c for c in w[1:] if c not in "aeiou")
    return list(dict.fromkeys([term, w, skel, f"{term} coin", f"{w}coin"]))


def is_hunted(term: str, symbol: str | None, name: str | None) -> bool:
    w, s, n = norm(term), norm(symbol), norm(name)
    skel = w[:1] + "".join(c for c in w[1:] if c not in "aeiou")
    return w in s or w in n or s == skel or s == skel + "coin"
OCR = Path.home() / ".team-agent" / "memes" / "ocr"
OCR_SRC = Path(__file__).resolve().parent / "tools" / "ocr_mac.swift"
FAST = re.compile(r"speedrun|100\s?%|walkthrough|parte?\s?\d|part\s?\d|miss[aã]o|mission|story|hist[oó]ria", re.I)


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
        self.events: deque = deque(maxlen=150)   # what the hunt found, newest first
        self.screens: dict[str, dict] = {}      # live id -> what was read on its screen
        self._hunt_at = self._ocr_at = 0.0
        self._said: dict[str, float] = {}
        self._outbox: list[tuple] = []

    @property
    def hunt(self) -> list[str]:
        return self.live.b.state.setdefault("hunt", list(HUNT))

    def _found(self, kind: str, term: str, text: str, url: str = "", coin: dict | None = None, alert: str | None = "high", key: str = ""):
        """One sign of a hunted word. Each (kind, key) once in 10 min; the alert goes on the next pass (memes.send)."""
        k = f"{kind}:{key or url or text[:60]}"
        if time.time() - self._said.get(k, 0) < 600:
            return
        self._said[k] = time.time()
        ev = {"t": time.time(), "kind": kind, "term": term, "text": text[:300], "url": url, "coin": coin}
        self.events.appendleft(ev)
        if alert:
            title = {"launch": "nasceu uma moeda", "move": "está a mexer", "fire": "🚀 A DISPARAR", "post": "falam disso", "title": "numa live",
                     "screen": "APARECEU NO ECRÃ de uma live"}[kind]
            self._outbox.append((alert, f"Caça {term.upper()}: {title}", text[:240]))

    @property
    def defs(self) -> list[dict]:
        return self.live.b.state.get("narratives") or DEFAULT

    def of(self, nid: str) -> dict:
        return self.state.setdefault(nid, {"coins": {}, "feed": deque(maxlen=300), "seen": set(), "lives": [], "first": {},
                                            "at": 0.0, "lives_at": 0.0, "x_at": 0.0, "told": {}, "launches": deque(maxlen=200)})

    # ---------- what the other agents see pass ----------
    def on_post(self, src: str, who: str, text: str, url: str, ts: float, pid: str = "", name: str = ""):
        """Any post read anywhere (Tree News, the Oráculo's Telegram/Reddit/X, the X search): kept when it talks of a theme."""
        low = (text or "").lower()
        for term in self.hunt:
            if term.lower() in low and time.time() - ts < 3 * 3600:
                self._found("post", term, f"{src} @{who}: {text}", url, alert="medium", key=pid or url)
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
        nm = norm(l["symbol"]) + " " + norm(l["name"])
        for term in self.hunt:
            if norm(term) in nm:
                self._found("launch", term, f"Nasceu ${l['symbol']} ({l['name']}) na pump.fun: o criador meteu {l.get('dev_sol') or 0} SOL",
                            f"https://gmgn.ai/sol/token/{l['mint']}", {"address": l["mint"], "symbol": l["symbol"]}, key=l["mint"])
        for n in self.defs:
            w = coin_hit(n, l["symbol"], l["name"])
            if w:
                l.setdefault("narr", []).append(n["id"])
                self.of(n["id"])["launches"].appendleft({**{k: l[k] for k in ("mint", "symbol", "name", "t", "dev_sol")}, "why": w})

    # ---------- one pass ----------
    async def run(self, c: httpx.AsyncClient):
        now = time.time()
        if self.hunt:
            if now - self._hunt_at >= 20:
                self._hunt_at = now
                await self._hunt_coins(c)
            if now - self._ocr_at >= 90:
                self._ocr_at = now
                await self._screens(c)
        if self._outbox:
            from .memes import send
            out, self._outbox = self._outbox[:3], self._outbox[3:]
            try:
                await send(out)
            except Exception:  # noqa: BLE001
                log.exception("hunt send")
        for n in self.defs:
            s = self.of(n["id"])
            if now - s["at"] >= 45:
                s["at"] = now
                await self._coins(c, n, s)
            if now - s["lives_at"] >= (60 if self.hunt else 300):   # hunting: the lives every minute
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
                if not w or not b.get("address") or p.get("chainId") != "solana":   # 18 Nov, Marco: «nós queremos só SOL»
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
        marks = self.live.b.state.setdefault("narr_marks", {})
        for a, d in found.items():
            top = max([m for m in MILESTONES if (d["mcap"] or 0) >= m], default=0)
            if top >= 1_000_000 and top > marks.get(a, 0) and a in marks and (d["vol1"] or 0) >= 100_000:
                k = lambda v: f"{v / 1e6:.1f} M$".replace(".", ",") if v >= 1e6 else f"{v / 1e3:.0f} k$"  # noqa: E731
                self._found("fire", n["name"], f"🚀 {n['name']}: ${d['symbol']} ({d['name']}) passou {k(top)}, {d['ch1'] or 0:+.0f}% numa hora, "
                            f"{k(d['vol1'] or 0)} negociados", d.get("url") or "", {"address": a, "symbol": d["symbol"], "url": d.get("url")}, key=f"{a}:{top}")
            marks[a] = max(top, marks.get(a, 0))
            old = s["coins"].get(a) or {}
            d["seen"] = old.get("seen") or time.time()
            d["peak"] = max(old.get("peak") or 0, d["mcap"] or 0)
            s["coins"][a] = d
        # coins that fell out of the search for a day go
        for a in [a for a, d in s["coins"].items() if time.time() - d["at"] > 86400 or d.get("chain") != "solana"]:
            s["coins"].pop(a)

    async def _hunt_coins(self, c: httpx.AsyncClient):
        """Every 20 s. 1) Search DexScreener for each variant of each hunted word, and for every $TICKER said in the last
        3 h that looks like one (DCTY); 2) every coin found is then followed by its contract (not by the search, which
        missed the one that fired); 3) alerts: a new one, one waking up (+20 % in 5 min), and one firing (passing 250 k$,
        1 M$, 5 M$, 10 M$... of value, or +50 % in an hour with 200 k$ traded)."""
        st = self.live.b.state
        seen = st.setdefault("hunt_seen", {})
        watch = st.setdefault("hunt_watch", {})   # address -> term
        said = {k for p in st.get("posts", []) if time.time() - p["t"] < 3 * 3600 for k in p.get("tickers") or []}
        for n in self.defs:
            said |= {k for f in self.of(n["id"])["feed"] if time.time() - f["t"] < 3 * 3600 for k in f.get("tickers") or []}
        for term in self.hunt:
            queries = variants(term) + [k for k in said if is_hunted(term, k, "")]
            for q in dict.fromkeys(queries):
                try:
                    pairs = ((await c.get(DEX_SEARCH + q, timeout=12)).json() or {}).get("pairs") or []
                except (httpx.HTTPError, ValueError):
                    continue
                for p in pairs:
                    b = p.get("baseToken") or {}
                    if p.get("chainId") == "solana" and b.get("address") and is_hunted(term, b.get("symbol"), b.get("name")):
                        watch.setdefault(b["address"], term)
                await asyncio.sleep(0.25)
        # follow every hunted coin by its contract, its deepest pool
        addrs = list(watch)[-120:]
        best: dict[str, dict] = {}
        for i in range(0, len(addrs), 30):
            try:
                pairs = ((await c.get(DEX_TOKENS + ",".join(addrs[i:i + 30]), timeout=15)).json() or {}).get("pairs") or []
            except (httpx.HTTPError, ValueError):
                continue
            for p in pairs:
                a = (p.get("baseToken") or {}).get("address")
                if a in watch and (a not in best or ((p.get("liquidity") or {}).get("usd") or 0) > ((best[a].get("liquidity") or {}).get("usd") or 0)):
                    best[a] = p
        first_pass = not st.get("hunt_ready2")
        marks = st.setdefault("hunt_marks", {})
        for a, p in best.items():
            term, b = watch[a], p.get("baseToken") or {}
            vol, ch, mc = p.get("volume") or {}, p.get("priceChange") or {}, p.get("marketCap") or p.get("fdv") or 0
            coin = {"address": a, "symbol": b.get("symbol"), "name": b.get("name"), "mcap": mc, "url": p.get("url")}
            k = lambda v: f"{v / 1e6:.1f} M$".replace(".", ",") if v >= 1e6 else f"{v / 1e3:.0f} k$"  # noqa: E731
            if a not in seen:
                seen[a] = time.time()
                if not first_pass:
                    self._found("launch", term, f"Nova moeda de {term.upper()}: ${b.get('symbol')} ({b.get('name')}), vale {k(mc)}", p.get("url") or "", coin, key=a)
            top = max([m for m in MILESTONES if mc >= m], default=0)
            if top > marks.get(a, 0):
                if not first_pass and marks.get(a) is not None:
                    self._found("fire", term, f"🚀 ${b.get('symbol')} ({b.get('name')}) A DISPARAR: passou {k(top)}, vale {k(mc)}, "
                                f"{ch.get('h1') or 0:+.0f}% numa hora, {k(vol.get('h1') or 0)} negociados, pool {k((p.get('liquidity') or {}).get('usd') or 0)}",
                                p.get("url") or "", coin, key=f"{a}:{top}")
                marks[a] = top
            elif a not in marks:
                marks[a] = top
            if (vol.get("m5") or 0) >= 3000 and (ch.get("m5") or 0) >= 20:
                self._found("move", term, f"${b.get('symbol')} ({b.get('name')}) +{ch['m5']:.0f}% em 5 min, {k(vol['m5'])} negociados, vale {k(mc)}",
                            p.get("url") or "", coin, key=a)
            if (ch.get("h1") or 0) >= 50 and (vol.get("h1") or 0) >= 200_000:
                self._found("fire", term, f"🚀 ${b.get('symbol')} a disparar: {ch['h1']:+.0f}% numa hora, {k(vol['h1'])} negociados, vale {k(mc)}",
                            p.get("url") or "", coin, key=f"{a}:h1")
        st["hunt_ready2"] = True
        st["hunt_top"] = sorted(({"address": a, "symbol": (p.get("baseToken") or {}).get("symbol"), "name": (p.get("baseToken") or {}).get("name"),
                                  "mcap": p.get("marketCap") or p.get("fdv"), "ch1": (p.get("priceChange") or {}).get("h1"),
                                  "ch5": (p.get("priceChange") or {}).get("m5"), "vol1": (p.get("volume") or {}).get("h1"),
                                  "liq": (p.get("liquidity") or {}).get("usd"), "url": p.get("url"), "term": watch[a]} for a, p in best.items()),
                                key=lambda x: -(x["mcap"] or 0))[:12]

    async def _screens(self, c: httpx.AsyncClient):
        """The frame of each of the busiest lives (YouTube refreshes it every few minutes), read by the Mac's OCR."""
        if sys.platform != "darwin":
            return
        if not OCR.exists():
            try:
                OCR.parent.mkdir(parents=True, exist_ok=True)
                p = await asyncio.create_subprocess_exec("swiftc", "-O", "-o", str(OCR), str(OCR_SRC),
                                                         stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
                await asyncio.wait_for(p.wait(), 300)
            except (OSError, asyncio.TimeoutError):
                return
            if not OCR.exists():
                return
        lives = [v for st in self.state.values() for v in st["lives"] if v.get("site") == "YouTube"]
        # the most watched, and the ones going through the story (they reach the plane first)
        lives = sorted(lives, key=lambda v: -(v["viewers"] * (3 if FAST.search(v["title"]) else 1)))[:10]
        for k in [k for k in self.screens if k not in {v["id"] for v in lives}]:
            self.screens.pop(k)
        d = OCR.parent / "frames"
        d.mkdir(exist_ok=True)
        files = {}
        for v in lives:
            try:
                r = await c.get(f"https://i.ytimg.com/vi/{v['id']}/maxresdefault_live.jpg", params={"t": int(time.time())}, timeout=15)
                if r.status_code != 200:
                    r = await c.get(f"https://i.ytimg.com/vi/{v['id']}/hqdefault_live.jpg", params={"t": int(time.time())}, timeout=15)
                if r.status_code == 200:
                    f = d / f"{v['id']}.jpg"
                    f.write_bytes(r.content)
                    files[str(f)] = v
            except httpx.HTTPError:
                continue
        if not files:
            return
        try:
            p = await asyncio.create_subprocess_exec(str(OCR), *files, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
            out, _ = await asyncio.wait_for(p.communicate(), 120)
        except (OSError, asyncio.TimeoutError):
            return
        for line in out.decode("utf-8", "replace").splitlines():
            try:
                j = json.loads(line)
            except ValueError:
                continue
            v = files.get(j.get("path"))
            if not v:
                continue
            text = j.get("text") or ""
            low = text.lower()
            hit = next((term for term in self.hunt if term.lower() in low), None)
            self.screens[v["id"]] = {"id": v["id"], "channel": v["channel"], "viewers": v["viewers"], "url": v["url"], "text": text[:300], "t": time.time(),
                                     "title": v["title"][:100], "frame": f"https://i.ytimg.com/vi/{v['id']}/hqdefault_live.jpg?t={int(time.time())}",
                                     "hit": hit, "fast": bool(FAST.search(v["title"]))}
            for term in self.hunt:
                if term.lower() in low:
                    self._found("screen", term, f"Apareceu «{term.upper()}» no ecrã da live de {v['channel']} ({v['viewers']:,} a ver): {text[:160]}".replace(",", " "),
                                v["url"], key=v["id"])
        for v in [v for st in self.state.values() for v in st["lives"]]:
            for term in self.hunt:
                if term.lower() in v["title"].lower():
                    self._found("title", term, f"Live com {term.upper()} no título: {v['channel']} — {v['title']}", v["url"], key=v["id"])

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
                        "viewers": sum(v["viewers"] for v in s["lives"]), "at": s["at"], "lives_at": s["lives_at"],
                        "hunt": {"top": self.live.b.state.get("hunt_top", []), "terms": self.hunt, "events": list(self.events)[:40], "ocr_at": self._ocr_at, "hunt_at": self._hunt_at, "lives_at": s["lives_at"],
                                 "screens": sorted(self.screens.values(), key=lambda x: -x["viewers"])[:10]}})
        return out
