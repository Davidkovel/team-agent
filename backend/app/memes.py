"""Memecoins (#/memes, 04 · Trading): the agents that watch the memecoins day and night and keep everything on this PC.

16 nov, Marco: «agentes que ficam sempre a ver merdas do Twitter sobre memecoins... todas as informações de todas as redes
sociais, de influencers que a gente vai mandando... o maior cérebro de memecoins, até a dormir». A base: only watching and
scoring, **nothing is bought**. Sources need no key:

- **Robin · Mercado DEX** (every 3 min): DexScreener (top boosts, latest profiles, token pairs), GeckoTerminal trending pools
  (Solana, Base, Ethereum, BSC) and CoinGecko trending. Price, volume, liquidity, buys/sells, age of every coin it sees.
- **Oráculo · Redes sociais** (every 5 min): X through Tree News (news.treeofalpha.com, free, ~2000 accounts relayed; the way
  the GMGN tracker's research of 3 nov chose), public Telegram channels (t.me/s/<canal>) and Reddit (RSS). Cashtags ($WIF)
  and contract addresses in each post become mentions of the coins; posts of the team's influencers weigh three times.
- **Lucius · Segurança** (with Robin): RugCheck for Solana coins (risks, LP locked), plus the Hub's own rules (thin
  liquidity, a few hours old, sells far above buys).
- **Batman · Analista** (Claude, off by default, per PC like the Sala de Trading): every `every_min` reads the best
  candidates and the posts, searches the web for what the influencers said, and writes a short report with a verdict.
- **Motor GMGN** (gmgn_link.py): the signals and paper trades of the GMGN tracker (github.com/Davidkovel/gmgn-tracker),
  from its gmgn.db on this PC or from the read-only service on its server.

State in `~/.team-agent/memes/state.json`, nothing goes by sync. Alerts (score ≥ `alert_score`, not dangerous) go to this
PC's person, once per coin every 6 h."""
from __future__ import annotations

import asyncio
import calendar
import html
import json
import logging
import math
import re
import time
from pathlib import Path

import httpx

from . import gmgn_link
from .memes_calls import Judge
from .memes_ler import Reader, tg_media

log = logging.getLogger("memes")
DIR = Path.home() / ".team-agent" / "memes"
FILE = DIR / "state.json"
UA = {"User-Agent": "Mozilla/5.0 (Macintosh) AMG-Hub/1.0", "Accept": "application/json, text/html, */*"}
DEX = "https://api.dexscreener.com"
CHAINS = {"solana": "Solana", "base": "Base", "ethereum": "Ethereum", "bsc": "BSC"}
GECKO_NET = {"solana": "solana", "base": "base", "eth": "ethereum", "bsc": "bsc"}
MAJORS = {"BTC", "ETH", "SOL", "USDT", "USDC", "BNB", "XRP", "DOGE", "ADA", "TRX", "TON", "AVAX", "DOT", "LINK", "SUI",
          "USD", "EUR", "SPX", "NDX", "DXY", "WBTC", "WETH", "WSOL", "PYUSD", "USDE", "DAI", "FDUSD", "USD1", "AI", "CEO", "ETF", "SEC", "FED", "CPI", "GDP", "NFT"}
CASH = re.compile(r"(?<![\w$])\$([A-Za-z][A-Za-z0-9]{1,11})\b")
SOL_ADDR = re.compile(r"\b[1-9A-HJ-NP-Za-km-z]{32,44}\b")
EVM_ADDR = re.compile(r"\b0x[a-fA-F0-9]{40}\b")
TAG = re.compile(r"<[^>]+>")
# stablecoins and tokenized shares are no memecoins: they would fill the radar with $1 coins and NVDA
NOT_MEME = re.compile(r"usd|dollar|euro\b|\b(inc|corp|tokenized|xstock|treasury|bond)\b|(?-i:\b[A-Z]{2,5}x\b)", re.I)

DEFAULT = {
    "on": True, "claude": False, "model": "sonnet", "cap": 8, "every_min": 90, "alert_score": 78, "alerts": True,
    "min_liq": 15000,
    "telegram": ["pumpfunalerts", "dexscreener_trending", "solanatrending", "memecoins", "solanadailynews", "WatcherGuru", "whale_alert_io"],
    "reddit": ["memecoins", "SolanaMemeCoins", "CryptoMoonShots", "solana", "CryptoCurrency"],
    "gmgn_db": "", "gmgn_url": "", "gmgn_key": "",
    "x_key": "", "x_every": 15,
    "ler": True, "ler_cap": 40, "ler_model": "sonnet",   # the Leitor: the Claude of this PC reads each influencer post   # twitterapi.io: the key stays on this PC (state.json), never in the database nor the page
}
AGENTS = {
    "robin": {"name": "Robin", "dept": "Mercado DEX", "code": "DEX", "does": "Lê a DexScreener, a GeckoTerminal e a CoinGecko: as moedas que estão a subir, com preço, volume, liquidez e compras/vendas.", "every": 180},
    "oraculo": {"name": "Oráculo", "dept": "Redes sociais", "code": "SOC", "does": "Ouve o X (pelo Tree News), os canais públicos do Telegram e o Reddit, e conta quem fala de cada moeda. Os influencers da equipa pesam três vezes.", "every": 300},
    "lucius": {"name": "Lucius", "dept": "Segurança", "code": "SEG", "does": "Passa cada candidata pelo RugCheck e pelas regras do Hub: liquidez fina, moeda de horas, vendas muito acima das compras.", "every": 180},
    "leitor": {"name": "Leitor", "dept": "Lê e ouve", "code": "LER", "does": "Lê cada publicação dos influencers por inteiro, vê as imagens e ouve os vídeos (transcritos neste PC), e diz o que cada uma diz: manda comprar, vender, avisa de perigo ou só mostra lucro antigo.", "every": 300},
    "arbitro": {"name": "Alfred", "dept": "Árbitro dos calls", "code": "ARB", "does": "Pega em cada call dos nossos influencers, vê o preço da moeda na hora do call e 24 horas depois, e diz se subiu ou desceu.", "every": 300},
    "batman": {"name": "Batman", "dept": "Analista", "code": "ANL", "does": "Com o Claude ligado, lê as melhores candidatas e o que se diz delas, procura na web o que os influencers disseram e escreve um relatório com veredicto.", "every": 0},
    "gmgn": {"name": "Motor GMGN", "dept": "Sinais e paper trading", "code": "GMG", "does": "O gmgn-tracker: apanha todas as moedas novas da pump.fun, faz paper trading por estratégia e aprende quais ganham.", "every": 300},
}


def _now() -> float:
    return time.time()


def _tweet_time(v) -> float:
    """«Tue Dec 10 07:00:30 +0000 2024» (X) or an ISO date -> seconds."""
    from datetime import datetime
    for f in ("%a %b %d %H:%M:%S %z %Y", "%Y-%m-%dT%H:%M:%S.%f%z", "%Y-%m-%dT%H:%M:%S%z"):
        try:
            return datetime.strptime(str(v).replace("Z", "+0000"), f).timestamp()
        except ValueError:
            pass
    return _now()


def _utc(iso: str) -> float:
    """«2026-11-16T19:54:34+00:00» (Telegram) or «...Z» (Reddit) -> seconds; both are UTC."""
    return calendar.timegm(time.strptime(iso[:19], "%Y-%m-%dT%H:%M:%S"))


class Brain:
    def __init__(self):
        self.state = {"cfg": dict(DEFAULT), "tokens": {}, "posts": [], "influencers": [], "reports": [], "alerts": [],
                      "runs": {}, "watch": [], "seen_posts": [], "claude_day": {"day": "", "n": 0}}
        self.gmgn: dict | None = None
        self.busy: str = ""
        self.lock = asyncio.Lock()
        self._load()
        self.judge = Judge(self)
        self.reader = Reader(self)

    # ---------- state ----------
    def _load(self):
        try:
            got = json.loads(FILE.read_text("utf-8"))
            self.state.update(got)
            self.state["cfg"] = {**DEFAULT, **got.get("cfg", {})}
        except (OSError, ValueError):
            pass

    def save(self):
        DIR.mkdir(parents=True, exist_ok=True)
        tmp = FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.state, ensure_ascii=False), "utf-8")
        tmp.replace(FILE)

    @property
    def cfg(self) -> dict:
        return self.state["cfg"]

    def run_mark(self, agent: str, ok: bool, n: int = 0, note: str = ""):
        r = self.state["runs"].setdefault(agent, {})
        r.update(at=_now(), ok=ok, n=n, note=note[:200])
        if ok:
            r["last_ok"] = _now()

    def due(self, agent: str) -> bool:
        every = AGENTS[agent]["every"]
        return _now() - self.state["runs"].get(agent, {}).get("at", 0) >= every

    # ---------- Robin: the DEX ----------
    def _tok(self, chain: str, addr: str) -> dict:
        key = f"{chain}:{addr}"
        t = self.state["tokens"].get(key)
        if not t:
            t = self.state["tokens"][key] = {"key": key, "chain": chain, "address": addr, "first": _now(), "src": {}, "snaps": []}
        return t

    def _apply_pair(self, p: dict) -> dict | None:
        chain, base = p.get("chainId"), p.get("baseToken") or {}
        if chain not in CHAINS or not base.get("address") or NOT_MEME.search(f"{base.get('symbol', '')} {base.get('name', '')}") \
                or (base.get("symbol") or "").upper() in MAJORS:
            return None
        t = self._tok(chain, base["address"])
        liq = (p.get("liquidity") or {}).get("usd") or 0
        if t.get("liq") and liq < t["liq"] * 0.5 and t.get("pair") != p.get("pairAddress"):
            return t  # a thinner pool of the same coin: keep the main one
        tx, vol, ch = p.get("txns") or {}, p.get("volume") or {}, p.get("priceChange") or {}
        info = p.get("info") or {}
        socials = {s.get("type"): s.get("url") for s in info.get("socials") or [] if s.get("type")}
        t.update(symbol=(base.get("symbol") or "?")[:16], name=(base.get("name") or "")[:40], pair=p.get("pairAddress"),
                 dex=p.get("dexId"), url=p.get("url"), price=float(p.get("priceUsd") or 0), liq=liq, mcap=p.get("marketCap") or p.get("fdv"),
                 vol24=vol.get("h24") or 0, vol1=vol.get("h1") or 0, vol5=vol.get("m5") or 0,
                 ch5=ch.get("m5"), ch1=ch.get("h1"), ch6=ch.get("h6"), ch24=ch.get("h24"),
                 buys1=(tx.get("h1") or {}).get("buys", 0), sells1=(tx.get("h1") or {}).get("sells", 0),
                 buys24=(tx.get("h24") or {}).get("buys", 0), sells24=(tx.get("h24") or {}).get("sells", 0),
                 created=(p.get("pairCreatedAt") or 0) / 1000 or None, image=info.get("imageUrl"),
                 twitter=socials.get("twitter"), telegram=socials.get("telegram"),
                 website=((info.get("websites") or [{}])[0] or {}).get("url"), boosts=(p.get("boosts") or {}).get("active", 0),
                 updated=_now())
        snaps = t["snaps"]
        if not snaps or _now() - snaps[-1][0] >= 170:
            snaps.append([round(_now()), t["price"], round(liq), round(t["vol1"])])
            del snaps[:-160]
        return t

    async def _details(self, c: httpx.AsyncClient, addrs: list[str]):
        for i in range(0, len(addrs), 30):
            chunk = addrs[i:i + 30]
            try:
                r = await c.get(f"{DEX}/latest/dex/tokens/{','.join(chunk)}")
                pairs = (r.json() or {}).get("pairs") or [] if r.status_code == 200 else []
            except (httpx.HTTPError, ValueError):
                continue
            best: dict[str, dict] = {}
            for p in pairs:
                a = (p.get("baseToken") or {}).get("address")
                if a in chunk and ((p.get("liquidity") or {}).get("usd") or 0) >= ((best.get(a, {}).get("liquidity") or {}).get("usd") or 0):
                    best[a] = p
            for p in best.values():
                self._apply_pair(p)
            await asyncio.sleep(0.3)

    async def robin(self, c: httpx.AsyncClient):
        found: dict[str, set] = {}   # address -> sources

        def add(addr, src):
            if addr:
                found.setdefault(addr, set()).add(src)
        n_err = 0
        for path, src in (("/token-boosts/top/v1", "boost"), ("/token-boosts/latest/v1", "boost"), ("/token-profiles/latest/v1", "perfil")):
            try:
                for x in (await c.get(DEX + path)).json() or []:
                    if x.get("chainId") in CHAINS:
                        add(x.get("tokenAddress"), src)
            except (httpx.HTTPError, ValueError):
                n_err += 1
        for net in GECKO_NET:
            try:
                r = await c.get(f"https://api.geckoterminal.com/api/v2/networks/{net}/trending_pools?page=1")
                for pool in (r.json() or {}).get("data", [])[:20]:
                    tid = ((pool.get("relationships") or {}).get("base_token") or {}).get("data", {}).get("id", "")
                    add(tid.split("_", 1)[1] if "_" in tid else "", "gecko")
            except (httpx.HTTPError, ValueError):
                n_err += 1
        cg = []
        try:
            for x in (await c.get("https://api.coingecko.com/api/v3/search/trending")).json().get("coins", []):
                it = x.get("item") or {}
                cg.append(str(it.get("symbol", "")).upper())
                for chain, a in ((it.get("platforms") or {}) if isinstance(it.get("platforms"), dict) else {}).items():
                    if chain in ("solana", "base", "ethereum", "binance-smart-chain") and a:
                        add(a, "coingecko")
        except (httpx.HTTPError, ValueError, AttributeError):
            n_err += 1
        self.state["cg_trending"] = cg[:15]
        # the coins the posts named, the ones being watched and the best ones get fresh numbers too
        self.state.pop("pending_addrs", None)
        toks = self.state["tokens"]
        have = {t["address"] for t in toks.values()}
        tried = self.state.setdefault("tried_addrs", {})
        pending = [a for p in self.state["posts"] if _now() - p["t"] < 6 * 3600 for a in p["addrs"]
                   if a not in have and _now() - tried.get(a, 0) > 3600][:60]
        for a in pending:
            tried[a] = _now()
        for a in [a for a, v in tried.items() if _now() - v > 86400]:
            tried.pop(a)
        top = sorted(toks.values(), key=lambda t: -(t.get("score") or 0))[:40]
        addrs = list(dict.fromkeys(pending + list(found) + [toks[k]["address"] for k in self.state["watch"] if k in toks] + [t["address"] for t in top]))
        await self._details(c, addrs[:150])
        await self._by_ticker(c)
        for t in toks.values():
            hit = found.get(t["address"])
            if hit:
                for s in hit:
                    t["src"][s] = _now()
        self._prune()
        self.run_mark("robin", n_err < 6, len(found), f"{len(found)} moedas nas listas, {len(addrs[:150])} atualizadas" + (f", {n_err} fontes falharam" if n_err else ""))

    async def _by_ticker(self, c: httpx.AsyncClient):
        """Cashtags used in the last 6 h that are no coin we know: the DexScreener search, exact symbol,
        the pool with the most liquidity (a ticker is often copied: the deepest pool is the one people mean)."""
        known = {(t.get("symbol") or "").upper() for t in self.state["tokens"].values()}
        voices: dict[str, set] = {}
        for p in self.state["posts"]:
            if _now() - p["t"] < 6 * 3600:
                for k in p["tickers"]:
                    voices.setdefault(k, set()).add((p["src"], p["who"].lower()))
        tried = self.state.setdefault("tried_tickers", {})
        todo = [k for k, v in sorted(voices.items(), key=lambda kv: -len(kv[1])) if k not in known and _now() - tried.get(k, 0) > 3600][:6]
        for k in todo:
            tried[k] = _now()
            try:
                pairs = ((await c.get(f"{DEX}/latest/dex/search", params={"q": k})).json() or {}).get("pairs") or []
            except (httpx.HTTPError, ValueError):
                continue
            same = [p for p in pairs if (p.get("baseToken") or {}).get("symbol", "").upper() == k and p.get("chainId") in CHAINS]
            if same:
                self._apply_pair(max(same, key=lambda p: (p.get("liquidity") or {}).get("usd") or 0))
            await asyncio.sleep(0.3)
        for k in [k for k, v in tried.items() if _now() - v > 86400]:
            tried.pop(k)

    def _prune(self):
        toks, watch = self.state["tokens"], set(self.state["watch"])
        old = [k for k, t in toks.items() if k not in watch and (_now() - t.get("updated", t["first"]) > 48 * 3600
                                                                 or NOT_MEME.search(f"{t.get('symbol', '')} {t.get('name', '')}"))]
        for k in old:
            toks.pop(k)
        if len(toks) > 600:
            for k in sorted((k for k in toks if k not in watch), key=lambda k: toks[k].get("score") or 0)[: len(toks) - 600]:
                toks.pop(k)

    # ---------- Oráculo: the social side ----------
    def _influencer(self, platform: str, who: str) -> dict | None:
        who = (who or "").lower().lstrip("@")
        return next((i for i in self.state["influencers"] if i["handle"].lower().lstrip("@") == who and i["platform"] in (platform, "any")), None)

    def _post(self, pid: str, src: str, who: str, text: str, url: str, ts: float, platform: str, media: dict | None = None) -> bool:
        seen = self.state["seen_posts"]
        if pid in seen and media:   # posts seen before the Leitor existed get their video and photos
            old = next((p for p in self.state["posts"] if p["id"] == pid and p.get("inf") and "media" not in p), None)
            if old:
                old["media"] = media
        if pid in seen or _now() - ts > 48 * 3600:   # an old post says nothing about now
            return False
        seen.append(pid)
        del seen[:-3000]
        tickers = sorted({m.upper() for m in CASH.findall(text)} - MAJORS)
        addrs = sorted(set(EVM_ADDR.findall(text)) | {a for a in SOL_ADDR.findall(text) if re.search(r"\d", a) and re.search(r"[a-z]", a) and re.search(r"[A-Z]", a)})
        inf = self._influencer(platform, who)
        if not tickers and not addrs and not inf:
            return False
        p = {"id": pid, "src": src, "platform": platform, "who": who, "text": text[:400], "url": url,
             "t": ts, "tickers": tickers[:8], "addrs": addrs[:4], "inf": bool(inf)}
        if inf:   # the Leitor reads the whole of it, and sees and hears its media
            p.update({"full": text[:3000]} if len(text) > 400 else {}, **({"media": media} if media else {}))
        self.state["posts"].insert(0, p)
        del self.state["posts"][600:]
        return True

    async def oraculo(self, c: httpx.AsyncClient):
        n, errs = 0, []
        self.state["posts"] = [p for p in self.state["posts"] if _now() - p["t"] <= 48 * 3600]
        n += await self.x_accounts(c, errs)
        try:  # X: Tree News relays tweets of ~2000 accounts, free (the history endpoint; the websocket is the next step)
            r = await c.get("https://news.treeofalpha.com/api/news?limit=100")
            for e in r.json() or []:
                if e.get("source") != "Twitter":
                    continue
                title, url = e.get("title") or "", e.get("url") or ""
                m = re.match(r"^(.*?)\s*\(@([A-Za-z0-9_]{1,30})\):\s*(.*)$", title, re.S)
                who = m.group(2) if m else (re.search(r"(?:x|twitter)\.com/([A-Za-z0-9_]+)/status", url) or [None, ""])[1]
                text = (e.get("body") or (m.group(3) if m else title)).strip()
                n += self._post("x:" + str(e.get("_id") or url), "X", who, text, url, (e.get("time") or 0) / 1000 or _now(), "x")
        except (httpx.HTTPError, ValueError) as e:
            errs.append(f"X/Tree News: {type(e).__name__}")
        chans = list(dict.fromkeys(self.cfg["telegram"] + [i["handle"].lstrip("@") for i in self.state["influencers"] if i["platform"] == "telegram"]))
        for ch in chans[:25]:
            try:
                r = await c.get(f"https://t.me/s/{ch}")
                self._channel_face(ch, r.text)
                # one block per message: a photo-only message has no text, and its neighbour's text must not become its own
                for block in r.text.split('class="tgme_widget_message_wrap')[1:]:
                    pid, body, when = (re.search(r'data-post="([^"]+)"', block), re.search(r'tgme_widget_message_text[^>]*>(.*?)</div>', block, re.S),
                                       re.search(r'datetime="([^"]+)"', block))
                    media = tg_media(block)
                    if not (pid and when and (body or (media and self._influencer("telegram", ch)))):   # a video alone counts for an influencer
                        continue
                    text = html.unescape(TAG.sub(" ", body.group(1).replace("<br/>", "\n"))).strip() if body else ""
                    n += self._post("tg:" + pid.group(1), "Telegram", ch, text, f"https://t.me/{pid.group(1)}", _utc(when.group(1)), "telegram", media)
            except (httpx.HTTPError, ValueError) as e:
                errs.append(f"t.me/{ch}: {type(e).__name__}")
            await asyncio.sleep(0.4)
        for sub in self.cfg["reddit"][:10]:
            try:
                r = await c.get(f"https://www.reddit.com/r/{sub}/new/.rss", headers={"User-Agent": "Mozilla/5.0 AMG-Hub/1.0"})
                for m in re.finditer(r"<entry>.*?<name>/u/([^<]+)</name>.*?<link href=\"([^\"]+)\".*?<updated>([^<]+)</updated>.*?<title>([^<]*)</title>(?:.*?<content[^>]*>(.*?)</content>)?", r.text, re.S):
                    text = html.unescape(m.group(4)) + " " + TAG.sub(" ", html.unescape(html.unescape(m.group(5) or "")))[:600]
                    ts = _utc(m.group(3))
                    n += self._post("rd:" + m.group(2), "Reddit", m.group(1), re.sub(r"\s+", " ", text).strip(), m.group(2), ts, "reddit")
            except (httpx.HTTPError, ValueError) as e:
                errs.append(f"r/{sub}: {type(e).__name__}")
            await asyncio.sleep(0.6)
        self.run_mark("oraculo", len(errs) < 5, n, f"{n} publicações novas com moedas" + (f"; falharam: {', '.join(errs[:3])}" if errs else ""))

    # ---------- X through twitterapi.io (paid, ~0.15 $ per 1000 tweets read) ----------
    X_API = "https://api.twitterapi.io/twitter/user/last_tweets"

    async def x_page(self, c: httpx.AsyncClient, handle: str, cursor: str = "") -> tuple[list[dict], str]:
        """One page (~20) of an account's latest tweets: ([{id, text, url, t}], next cursor). Counts what was read, for the cost."""
        r = await c.get(self.X_API, params={"userName": handle, **({"cursor": cursor} if cursor else {})},
                        headers={"X-API-Key": self.cfg["x_key"]}, timeout=25)
        if r.status_code in (401, 403):
            raise RuntimeError("a chave do X foi recusada")
        r.raise_for_status()
        j = r.json()
        d = j.get("data") if isinstance(j.get("data"), dict) else j
        out = []
        for tw in d.get("tweets") or []:
            a = tw.get("author") or {}
            if a.get("userName", "").lower() == handle.lower():
                inf = self._influencer("x", handle)
                if inf:
                    inf["name"], inf["avatar"] = a.get("name") or inf.get("name"), a.get("profilePicture") or inf.get("avatar")
            out.append({"id": str(tw.get("id")), "text": tw.get("text") or "", "url": tw.get("url") or f"https://x.com/{handle}/status/{tw.get('id')}",
                        "t": _tweet_time(tw.get("createdAt"))})
        x = self.state.setdefault("x_used", {"tweets": 0, "since": _now()})
        x["tweets"] += len(out)
        return out, (j.get("next_cursor") or d.get("next_cursor") or "") if (j.get("has_next_page") or d.get("has_next_page")) else ""

    async def x_accounts(self, c: httpx.AsyncClient, errs: list) -> int:
        """The team's influencers on X, each every x_every minutes, when there is a key."""
        if not self.cfg.get("x_key"):
            return 0
        last, n = self.state.setdefault("x_last", {}), 0
        for i in [i for i in self.state["influencers"] if i["platform"] == "x"]:
            h = i["handle"]
            if _now() - last.get(h.lower(), 0) < self.cfg["x_every"] * 60:
                continue
            try:
                tweets, _ = await self.x_page(c, h)
            except (httpx.HTTPError, ValueError, RuntimeError) as e:
                errs.append(f"X @{h}: {e if isinstance(e, RuntimeError) else type(e).__name__}")
                continue
            last[h.lower()] = _now()
            for tw in tweets:
                n += self._post("x:" + tw["id"], "X", h, tw["text"], tw["url"], tw["t"], "x")
        return n

    def _channel_face(self, ch: str, page: str):
        """The name and the photo of an influencer's Telegram channel, for the page (a face reads faster than a handle)."""
        inf = self._influencer("telegram", ch)
        if not inf:
            return
        name, img = re.search(r'og:title" content="([^"]+)', page), re.search(r'og:image" content="([^"]+)', page)
        if name:
            inf["name"] = html.unescape(name.group(1))[:60]
        if img and img.group(1).startswith("https://"):
            inf["avatar"] = img.group(1)

    def link_posts(self):
        """Each post gets the coins it talks about (its contract addresses, else its cashtags: the deepest coin with that
        symbol) and the price each had the first time we saw them together: «desde que ele falou: +40%»."""
        toks = self.state["tokens"]
        by_addr = {t["address"]: t for t in toks.values()}
        by_sym: dict[str, dict] = {}
        for t in toks.values():
            k = (t.get("symbol") or "").upper()
            if k and (k not in by_sym or (t.get("liq") or 0) > (by_sym[k].get("liq") or 0)):
                by_sym[k] = t
        for p in self.state["posts"]:
            coins = p.setdefault("coins", {})
            found = [by_addr[a] for a in p["addrs"] if a in by_addr] or [by_sym[k] for k in p["tickers"] if k in by_sym]
            for t in found[:3]:
                if t["key"] not in coins and t.get("price"):
                    coins[t["key"]] = {"p0": t["price"], "t0": _now()}

    def mentions(self, t: dict, hours: float = 6) -> list[dict]:
        since = _now() - hours * 3600
        sym = (t.get("symbol") or "").upper()
        return [p for p in self.state["posts"] if p["t"] >= since and (t["address"] in p["addrs"] or (sym and sym in p["tickers"]))]

    # ---------- Lucius: safety ----------
    async def lucius(self, c: httpx.AsyncClient):
        cands = sorted((t for t in self.state["tokens"].values() if t["chain"] == "solana" and t.get("liq")),
                       key=lambda t: -(t.get("score") or 0))[:30]
        n = 0
        for t in cands:
            rug = t.get("rug") or {}
            if _now() - rug.get("at", 0) < 6 * 3600 or n >= 10:
                continue
            try:
                r = await c.get(f"https://api.rugcheck.xyz/v1/tokens/{t['address']}/report/summary")
                if r.status_code == 200:
                    j = r.json()
                    t["rug"] = {"at": _now(), "score": j.get("score_normalised"), "lp_locked": j.get("lpLockedPct"),
                                "risks": [{"name": x.get("name"), "level": x.get("level")} for x in j.get("risks") or []][:8]}
                    n += 1
            except (httpx.HTTPError, ValueError):
                pass
            await asyncio.sleep(0.5)
        self.run_mark("lucius", True, n, f"{n} moedas passadas no RugCheck")

    # ---------- the score ----------
    def score(self, t: dict) -> None:
        flags, why = [], []
        liq, mcap = t.get("liq") or 0, t.get("mcap") or 0
        age_h = (_now() - t["created"]) / 3600 if t.get("created") else None
        # momentum (0-35)
        ch1 = t.get("ch1") or 0
        mom = max(0.0, min(15.0, ch1 / 3)) if ch1 > 0 else max(-10.0, ch1 / 3)
        # a coin under 3 h has no «normal» volume yet: its 24 h volume is its whole life
        accel = (t.get("vol1") or 0) * 24 / max(1, t.get("vol24") or 1) if age_h is None or age_h >= 3 else 1.0
        mom += max(0.0, min(10.0, (accel - 1) * 5))
        b, s = t.get("buys1") or 0, t.get("sells1") or 0
        ratio = b / max(1, s)
        mom += max(0.0, min(10.0, (ratio - 1) * 8)) if b + s >= 30 else 0
        if accel > 2:
            why.append(f"volume da última hora {accel:.1f}× o normal")
        if ch1 >= 20:
            why.append(f"+{ch1:.0f}% numa hora")
        # social (0-40)
        ms = self.mentions(t)
        srcs = {p["src"] for p in ms}
        infs = [p for p in ms if p["inf"]]
        people = {(p["src"], p["who"].lower()) for p in ms}   # one account posting ten times is one voice, not ten
        soc = min(22.0, 7 * math.log2(1 + len(people))) + 4 * (len(srcs) - 1 if srcs else 0) + min(12.0, 6 * len(infs))
        lists = [k for k, v in t["src"].items() if _now() - v < 6 * 3600]
        soc += 3 * len(lists)
        soc = min(40.0, soc)
        if ms:
            why.append(f"{len(ms)} menções de {len(people)} contas em 6 h ({', '.join(sorted(srcs))})")
        if infs:
            why.append(f"{len(infs)} de influencers seguidos")
        if lists:
            why.append("nas listas: " + ", ".join(sorted(lists)))
        # safety (0-25)
        safe = 10 if liq >= 50000 else 6 if liq >= self.cfg["min_liq"] else 0
        if liq < self.cfg["min_liq"]:
            flags.append(("bad", f"liquidez só ${liq:,.0f}".replace(",", " ")))
        if mcap and liq and mcap / liq > 25:
            flags.append(("warn", "capitalização muito acima da liquidez"))
        if age_h is not None:
            safe += 5 if age_h >= 6 else 0
            if age_h < 1:
                flags.append(("warn", "tem menos de 1 hora"))
        if b + s >= 30 and s > b * 2:
            flags.append(("warn", "vendas o dobro das compras"))
        rug = t.get("rug")
        danger = False
        if rug:
            lv = [r["level"] for r in rug["risks"]]
            danger = "danger" in lv
            safe += 0 if danger else 10 if (rug.get("score") or 10) <= 3 else 5
            for r in rug["risks"]:
                if r["level"] == "danger":
                    flags.append(("bad", f"RugCheck: {r['name']}"))
        elif t["chain"] != "solana":
            safe += 4
        total = max(0, min(100, round(mom + soc + safe + 0)))
        if danger or liq < self.cfg["min_liq"] / 2:
            total = min(total, 30)
        t.update(score=total, parts={"momento": round(mom), "social": round(soc), "seguranca": round(safe)},
                 flags=flags[:5], why=why[:5], n6=len(ms), people6=len(people), inf6=len(infs), danger=danger, age_h=age_h)

    def rescore(self):
        for t in self.state["tokens"].values():
            if t.get("liq") is not None and t.get("price") is not None:
                self.score(t)

    # ---------- alerts ----------
    async def alerts(self):
        if not self.cfg["alerts"]:
            return
        out = []
        last = {a["key"]: a["t"] for a in self.state["alerts"]}
        for t in sorted(self.state["tokens"].values(), key=lambda t: -(t.get("score") or 0))[:10]:
            if (t.get("score") or 0) < self.cfg["alert_score"] or t.get("danger") or _now() - last.get(t["key"], 0) < 6 * 3600:
                continue
            a = {"key": t["key"], "t": _now(), "symbol": t.get("symbol"), "score": t["score"], "why": "; ".join(t.get("why") or [])[:200], "mcap": t.get("mcap")}
            self.state["alerts"].insert(0, a)
            out.append(a)
        del self.state["alerts"][200:]
        if out:
            await send([("high" if a["score"] >= 90 else "medium", f"Memecoin: ${a['symbol']} com nota {a['score']}", a["why"]) for a in out[:3]])

    # ---------- the GMGN tracker ----------
    async def gmgn_pass(self, c: httpx.AsyncClient):
        db = self.cfg["gmgn_db"] or str(Path.home() / ".team-agent" / "gmgn-tracker" / "gmgn.db")
        try:
            if Path(db).exists():
                self.gmgn = {**await asyncio.to_thread(gmgn_link.summary, db), "via": "local"}
            elif self.cfg["gmgn_url"]:
                r = await c.get(self.cfg["gmgn_url"].rstrip("/") + "/summary", headers={"X-Key": self.cfg["gmgn_key"]}, timeout=15)
                self.gmgn = {**r.json(), "via": "servidor"} if r.status_code == 200 else {"ok": False, "error": f"o servidor respondeu {r.status_code}"}
            else:
                self.gmgn = {"ok": False, "error": "sem ligação", "setup": True}
            self.run_mark("gmgn", bool(self.gmgn.get("ok")), len(self.gmgn.get("signals") or []), self.gmgn.get("error", ""))
        except Exception as e:  # noqa: BLE001 - a broken gmgn.db must not stop the other agents
            self.gmgn = {"ok": False, "error": str(e)[:200]}
            self.run_mark("gmgn", False, 0, str(e))

    # ---------- Batman: Claude ----------
    def claude_today(self) -> int:
        d = self.state["claude_day"]
        return d["n"] if d["day"] == time.strftime("%Y-%m-%d") else 0

    def batman_due(self) -> bool:
        c = self.cfg
        last = self.state["runs"].get("batman", {}).get("at", 0)
        return c["claude"] and self.claude_today() < c["cap"] and _now() - last >= c["every_min"] * 60

    async def batman(self, reason: str = "rotina"):
        from .tradingroom import council
        top = [t for t in sorted(self.state["tokens"].values(), key=lambda t: -(t.get("score") or 0)) if t.get("score")][:12]
        lines = [f"- ${t.get('symbol')} ({t.get('name')}, {CHAINS[t['chain']]}, {t['address']}) nota {t['score']} | preço {t.get('price')} | "
                 f"mcap {t.get('mcap')} | liq {t.get('liq')} | 1h {t.get('ch1')}% 24h {t.get('ch24')}% | compras/vendas 1h {t.get('buys1')}/{t.get('sells1')} | "
                 f"idade {round(t['age_h'], 1) if t.get('age_h') is not None else '?'} h | menções 6h {t.get('n6')} | alertas: {'; '.join(f[1] for f in t.get('flags') or []) or 'nenhum'} | x: {t.get('twitter') or '-'}"
                 for t in top]
        reads = self.state.get("reads", {})
        posts = [f"- [{p['src']} @{p['who']}{' INFLUENCER' if p['inf'] else ''}] {p['text'][:220]}"
                 + (f" || O Leitor leu: {reads[p['id']]['tipo']}, {reads[p['id']]['resumo']}" if p["id"] in reads and reads[p["id"]].get("resumo") else "")
                 for p in self.state["posts"][:40]]
        infs = ", ".join(f"{i['platform']}:@{i['handle']}" for i in self.state["influencers"]) or "nenhum"
        system = ("És o Batman, o analista de memecoins da AMG. Escreves em português de Portugal, curto e direto, para quem não é "
                  "especialista. Nunca prometes lucro: memecoins são de altíssimo risco e quase todas vão a zero. Só vigiamos, não compramos.")
        prompt = (f"Motivo: {reason}. Hora: {time.strftime('%Y-%m-%d %H:%M')}.\n\nAs melhores candidatas agora (do Hub, números reais):\n"
                  + "\n".join(lines) + "\n\nO que se disse nas redes (mais recente primeiro):\n" + "\n".join(posts)
                  + f"\n\nInfluencers seguidos: {infs}.\n\nUsa a pesquisa na web (no máximo 5 pesquisas) para ver o que estes influencers e o X "
                  "dizem agora das 3 a 5 candidatas mais fortes e se há sinais de rug/scam. Responde SÓ com JSON: "
                  '{"resumo": "2-3 frases sobre o mercado de memecoins agora", "destaques": [{"symbol": "...", "address": "...", '
                  '"veredicto": "ver|cedo|evitar", "porque": "1-2 frases", "risco": "1 frase"}], '
                  '"influencers": [{"handle": "...", "disse": "o que disse, 1 frase", "moeda": "..."}], "fontes": ["url", ...]}')
        self.busy = "batman"
        try:
            text, cost = await council.ask_claude(system, prompt, self.cfg["model"], DIR / "claude", timeout=360, tools="WebSearch")
        except Exception as e:  # noqa: BLE001
            self.run_mark("batman", False, 0, str(e))
            return
        finally:
            self.busy = ""
        d = self.state["claude_day"]
        if d["day"] != time.strftime("%Y-%m-%d"):
            d.update(day=time.strftime("%Y-%m-%d"), n=0)
        d["n"] += 1
        j = council.parse_json(text) or {"resumo": text[:600], "destaques": []}
        j.update(t=_now(), reason=reason, cost=round(cost, 3))
        self.state["reports"].insert(0, j)
        del self.state["reports"][30:]
        self.run_mark("batman", True, len(j.get("destaques") or []), j.get("resumo", "")[:180])

    # ---------- one pass ----------
    async def tick(self, force: str = ""):
        async with self.lock:
            async with httpx.AsyncClient(headers=UA, timeout=20, follow_redirects=True) as c:
                for name, fn in (("oraculo", self.oraculo), ("leitor", self.reader.run), ("robin", self.robin), ("lucius", self.lucius), ("arbitro", self.judge.run), ("gmgn", self.gmgn_pass)):
                    if force in (name, "all") or (self.cfg["on"] and self.due(name)):
                        self.busy = name
                        try:
                            await fn(c)
                        except Exception as e:  # noqa: BLE001
                            log.exception("memes %s", name)
                            self.run_mark(name, False, 0, str(e))
                        finally:
                            self.busy = ""
                self.rescore()
                self.link_posts()
            await self.alerts()
            self.save()
        if force == "batman" or (self.cfg["on"] and self.batman_due()):
            await self.batman("pedido à mão" if force == "batman" else "rotina")
            self.save()


BRAIN = Brain()


async def send(items: list[tuple]):
    """Notes to this PC's own person (bell, widget, phone), like the Gap da manhã."""
    from sqlalchemy import select

    from . import sync
    from .db import SessionLocal
    from .models import User
    from .services import notify
    me = sync.whoami()
    async with SessionLocal() as db:
        q = select(User.id).where(User.username == me[1]) if me else select(User.id)
        ids = (await db.execute(q)).scalars().all() or (await db.execute(select(User.id))).scalars().all()
        for severity, title, body in items:
            await notify(db, ids, "memes", severity, title, body, "#/memes")


async def sync_influencers():
    """The team's influencers live in the Hub's database (MarketItem, kind «meme_inf», symbol «platform:handle»), which goes
    by sync to every PC: who adds one on any computer, everyone sees it. The name and the photo of a channel stay here
    (they are read again by each PC). A PC that had a list of its own before (16 nov) brings it in once."""
    from sqlalchemy import select

    from .db import SessionLocal
    from .models import MarketItem, User
    async with SessionLocal() as db:
        q = select(MarketItem).where(MarketItem.kind == "meme_inf").order_by(MarketItem.id.desc())
        rows = (await db.execute(q)).scalars().all()
        # the first version (16 nov) put three examples in every PC's own list: they are not the team's and never come in
        seeds = {"on-chain: baleias e carteiras", "o que está em alta nas DEX", "notícias rápidas de cripto"}
        old = [i for i in BRAIN.state["influencers"] if "id" not in i and i.get("note") not in seeds]
        if old and not BRAIN.state.get("inf_moved"):
            ids = {u.username: u.id for u in (await db.execute(select(User))).scalars()}
            have = {r.symbol.lower() for r in rows}
            for i in old:
                key = f"{i['platform']}:{i['handle']}"
                if key.lower() not in have:
                    db.add(MarketItem(user_id=ids.get(i.get("by")) or next(iter(ids.values())), kind="meme_inf", symbol=key[:60],
                                      name=(i.get("name") or "")[:120], note=(i.get("note") or "")[:200]))
            await db.commit()
            rows = (await db.execute(q)).scalars().all()
        BRAIN.state["inf_moved"] = True
        users = {u.id: u.username for u in (await db.execute(select(User))).scalars()}
        await db.commit()
    faces = {(i["platform"], i["handle"].lower()): i for i in BRAIN.state["influencers"]}
    out = []
    for r in rows:
        plat, _, handle = r.symbol.partition(":")
        f = faces.get((plat, handle.lower()), {})
        out.append({"id": r.id, "platform": plat, "handle": handle, "note": r.note, "by": users.get(r.user_id, ""),
                    "at": r.created_at.timestamp() if r.created_at else None, "name": f.get("name") or r.name or None, "avatar": f.get("avatar")})
    BRAIN.state["influencers"] = out


async def loop():
    await asyncio.sleep(20)
    while True:
        try:
            await sync_influencers()
        except Exception:  # noqa: BLE001 - a busy database must not stop the agents
            log.exception("memes influencers")
        try:
            await BRAIN.tick()
        except Exception:  # noqa: BLE001
            log.exception("memes loop")
        await asyncio.sleep(30)
