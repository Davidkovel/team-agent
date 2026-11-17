"""Ao vivo (Memecoins): the MemeIntel widget of the gmgn-tracker remade for the Hub, in Portuguese, on any PC.

17 nov, Marco sent github.com/Davidkovel/gmgn-tracker again: «tem que abrir uma merda tipo assim... dá uns toques para
melhorar... mete lá em cima, de forma que combina». The repo's `desktop/` is a Windows-only WPF app (MemeIntel) whose
widget has four tabs: Монеты (signals), Сливы (rug radar), X / Twitter (live posts and the coins launched under them),
Все монеты (every new Solana coin). The same four here, fed by the same free sources:

- **PumpPortal** websocket (`subscribeNewToken`, `subscribeMigration`): every pump.fun launch in about a second. Its trade
  stream needs a funded key, so prices come from DexScreener (free, 300 requests/min, 30 coins a request).
- **Tree News** websocket: tweets of ~2000 accounts relayed in ~0.4 s (the widget measured it). A launch whose name or ticker
  matches a post of the last 20 min (or whose contract is in the post) is a coin «launched under» that post
  (XFeedService.cs: the same keys, stop words and matching, the author's own name never counts).
- **Sinais**: a launch looked up on DexScreener at 3, 10 and 30 minutes of age that holds money, buyers and a rising price.
- **Radar de rugs**: coins the team puts on it (a contract), checked every 20 s: a crash in 5 min, the money leaving the
  pool, many more sellers than buyers. Without the paid trade stream it cannot see who sells (the desktop app watches holders
  on-chain); it sees what that does to the pool.

Memory only (the last hours are what matters), except the radar list (memes state). Runs where the memes loop runs.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import time
import unicodedata
from collections import OrderedDict, deque

import httpx

log = logging.getLogger("memes.live")
PUMP_WS = "wss://pumpportal.fun/api/data"
TREE_WS = "wss://news.treeofalpha.com/ws"
TREE_HIST = "https://news.treeofalpha.com/api/news?limit=60"
DEX = "https://api.dexscreener.com/latest/dex/tokens/"
WSOL = "So11111111111111111111111111111111111111112"
WINDOW = 20 * 60          # a launch counts for a post up to 20 min after it
TRACK, SHOW = 12, 3       # coins tracked / shown under a post
CHECK_AT = (180, 600, 1800)
# the accounts of the GMGN X Tracker list (AppSettings.XWatch in the gmgn-tracker): their posts always show
WATCH = {"elonmusk", "realdonaldtrump", "cz_binance", "cz", "cb_doge", "a1lon9", "pumpfun", "toly", "blknoiz06", "nikitabier",
         "vladtenev", "matt_furie", "sama", "pmarca", "x", "spacex", "cobratate", "kanyewest", "mayemusk", "stoolpresidente",
         "billym2k", "dogeofficialceo", "darkfarms1", "shawmakesmagic", "zachxbt", "mert", "polymarket", "jdvance", "potus",
         "rapidresponse47", "melaniatrump", "doge", "america", "whitehouse", "trumpdailyposts", "gettrumpmemes", "trumpwarroom",
         "watcherguru", "unusual_whales", "marionawfal", "dexerto", "autismcapital", "afpost", "tmz", "degeneratenews",
         "treenewsfeed", "tier10k", "theunipcs", "ga__ke", "0xsunnft", "cupseyy", "traderpow", "haze0x", "eth_cedric",
         "solporttom", "dingalingts", "mrbeast", "kabosumama", "knowyourmeme", "solana"}
STOP = set("""the and for you are was this that with have has had not but all just they their them what when will would there
been from your about into more than then its it's our out who can could should one two new now get got like very much many
some any his her she him how why where which also only over after before make made being here today tomorrow yes yeah lol
lmao gonna wanna really still even every going need want know think see look good great big day time year people thing
things way back first last next right said says say breaking true false real best official crypto coin coins token tokens
memecoin memecoins solana sol pump pumpfun dex buy sell moon chart launch launched contract https http www com via amp""".split())
COMMON = set("""about according after again agent agents against also always another around back because been before being
best better between both breaking bring build call came coin coins come coming could crypto days does doing done down
during each even ever every find first from give going good great hack hacked have here high home image just keep know last
launch launched left life like little live long look made make many market more most much must need never news next nice
official only open other over people photo post price report reports right said same says should show since some soon still
such support sure take team tell than thank thanks that their them then there these they thing think this those through
time today together token tokens told tomorrow update user users very video vote want watch week well were what when where
which while white will with without work world would year years your yours""".split())
CASH = re.compile(r"\$([A-Za-z][A-Za-z0-9_]{1,15})\b")
HASH = re.compile(r"#([A-Za-z][A-Za-z0-9_]{1,30})")
MENTION = re.compile(r"(?<![\w@])@([A-Za-z0-9_]{1,15})")
URL = re.compile(r"https?://\S+")
WORD = re.compile(r"[^\W\d_][\w']{2,}")
CAP = re.compile(r"\b(?:[A-Z][a-zA-Z]+|[A-Z]{2,})(?:\s+(?:[A-Z][a-zA-Z]+|[A-Z]{2,})){1,3}\b")
SOL_ADDR = re.compile(r"\b[1-9A-HJ-NP-Za-km-z]{32,44}\b")
TITLE = re.compile(r"^(.*?)\s*\(@([A-Za-z0-9_]{1,30})\):\s*(.*)$", re.S)
STATUS = re.compile(r"(?:x|twitter)\.com/([A-Za-z0-9_]{1,30})/status/(\d+)", re.I)


def _now() -> float:
    return time.time()


def norm(s: str | None) -> str:
    return "".join(c.lower() for c in unicodedata.normalize("NFKD", s or "") if c.isalnum() and not unicodedata.combining(c))


def _cas(text: str) -> list[str]:
    return [a for a in dict.fromkeys(SOL_ADDR.findall(text)) if re.search(r"\d", a) and re.search(r"[a-z]", a) and re.search(r"[A-Z]", a)]


def keys_of(text: str, handle: str = "", name: str = "") -> tuple[list[str], list[str]]:
    """(match keys, contracts) of a post: its tickers, hashtags, capitalised phrases and strongest words (Social.cs)."""
    cas = _cas(text)
    clean = URL.sub(" ", text)
    for a in cas:
        clean = clean.replace(a, " ")
    tags = [m for m in dict.fromkeys(CASH.findall(clean)) if not m.isdigit()] + list(dict.fromkeys(HASH.findall(clean)))
    clean = MENTION.sub(" ", HASH.sub(r" \1 ", CASH.sub(" ", clean)))
    phrases = [p for p in dict.fromkeys(CAP.findall(clean)) if any(w.lower() not in STOP for w in p.split())]
    counts: dict[str, list] = {}
    for w in WORD.findall(clean):
        w = w.strip("'")
        if len(w) < 3 or w.lower() in STOP:
            continue
        c = counts.setdefault(w.lower(), [0, False])
        c[0] += 1
        c[1] = c[1] or w[0].isupper()
    words = [k for k, _ in sorted(counts.items(), key=lambda kv: (-kv[1][0] * (2 if kv[1][1] else 1), -len(kv[0])))][:12]
    mine = norm(handle), norm(name)
    out = [norm(k) for k in tags if len(norm(k)) >= 3] + [norm(k) for k in phrases + words if len(norm(k)) >= 4 and norm(k) not in COMMON]
    out = [k for k in dict.fromkeys(out) if k and k not in mine[0] and (not mine[1] or k not in mine[1])]
    return out[:25], cas


class Live:
    def __init__(self, brain):
        self.b = brain
        self.launches: OrderedDict[str, dict] = OrderedDict()
        self.posts: OrderedDict[str, dict] = OrderedDict()
        self.alerts: deque = deque(maxlen=200)
        self.src = {"pump": {"on": False, "n": 0, "at": 0}, "tree": {"on": False, "n": 0, "at": 0}}
        self.sol_usd = 0.0
        self._sol_at = 0.0
        self.started = False

    @property
    def radar(self) -> list[dict]:
        return self.b.state.setdefault("radar", [])

    # ---------- the two websockets ----------
    async def _ws(self, key: str, url: str, first: list[str], on_msg):
        import websockets
        wait = 2
        while True:
            try:
                async with websockets.connect(url, open_timeout=20, ping_interval=30, max_size=2 ** 22) as w:
                    for m in first:
                        await w.send(m)
                    self.src[key]["on"], wait = True, 2
                    async for raw in w:
                        self.src[key]["at"] = _now()
                        try:
                            on_msg(json.loads(raw))
                        except (ValueError, KeyError, TypeError):
                            pass
            except Exception as e:  # noqa: BLE001 - a dropped socket comes back
                log.info("live %s: %s", key, e)
            self.src[key]["on"] = False
            await asyncio.sleep(wait)
            wait = min(60, wait * 2)

    def on_pump(self, m: dict):
        tx = m.get("txType")
        if tx == "create" and m.get("mint"):
            l = {"mint": m["mint"], "symbol": (m.get("symbol") or "?")[:16], "name": (m.get("name") or "")[:40], "t": _now(),
                 "mc_sol": m.get("marketCapSol"), "dev": m.get("traderPublicKey"), "dev_sol": round(m.get("solAmount") or 0, 2),
                 "checks": 0}
            self.launches[l["mint"]] = l
            while len(self.launches) > 4000:
                self.launches.popitem(last=False)
            self.src["pump"]["n"] += 1
            self.on_launch(l)
        elif tx == "migrate" or (m.get("pool") and tx is None and m.get("mint")):
            l = self.launches.get(m.get("mint"))
            if l:
                l["migrated"] = _now()
            r = next((r for r in self.radar if r["mint"] == m.get("mint")), None)
            if r:
                self._alert(r, "migrou", "info", "Saiu da pump.fun para a bolsa grande (migração): agora há mais liquidez.")

    def on_tree(self, e: dict, backfill: bool = False):
        if e.get("source") != "Twitter":
            return
        title, url = e.get("title") or "", e.get("url") or ""
        t, u = TITLE.match(title), STATUS.search(url)
        handle = t.group(2) if t else u.group(1) if u else ""
        if not handle:
            return
        text = (t.group(3) if t else title).strip()
        if isinstance(e.get("body"), str) and len(e["body"]) > len(text):
            text = e["body"].strip()
        pid = u.group(2) if u else str(e.get("_id") or url)
        if pid in self.posts:
            return
        tid = int(u.group(2)) if u else 0
        ts = ((tid >> 22) + 1288834974657) / 1000 if tid > 1 << 40 else (e.get("time") or 0) / 1000 or _now()
        name = (t.group(1) if t else handle).strip()
        keys, cas = keys_of(text, handle, name)
        infs = {i["handle"].lower() for i in self.b.state.get("influencers", []) if i["platform"] == "x"}
        p = {"id": pid, "who": handle, "name": name, "text": text[:600], "url": url, "t": ts, "got": _now(),
             "watched": handle.lower() in WATCH or handle.lower() in infs, "inf": handle.lower() in infs,
             "img": (e.get("image") or e.get("icon") or "") if str(e.get("image") or e.get("icon") or "").startswith("https://") else "",
             "keys": keys, "coins": [], "back": backfill}
        self.posts[pid] = p
        while len(self.posts) > 400:
            self.posts.popitem(last=False)
        self.src["tree"]["n"] += 1
        for a in cas[:SHOW]:
            self._attach(p, {"mint": a, "symbol": "", "name": "", "t": ts}, "contrato no post", force=True)
        for l in list(self.launches.values())[-1500:]:
            if ts - 5 <= l["t"] <= ts + WINDOW:
                self._match(p, l)

    def on_launch(self, l: dict):
        for p in list(self.posts.values())[-200:]:
            if l["t"] - p["t"] <= WINDOW and l["t"] >= p["t"] - 5:
                self._match(p, l)

    def _match(self, p: dict, l: dict):
        s, nm = norm(l["symbol"]), norm(l["name"])
        hit = next((k for k in p["keys"] if k in (s, nm)), None) or next((k for k in p["keys"] if len(k) >= 5 and (k in s or k in nm)), None)
        if hit:
            self._attach(p, l, hit)

    def _attach(self, p: dict, l: dict, why: str, force: bool = False):
        if any(c["mint"] == l["mint"] for c in p["coins"]) or (not force and len(p["coins"]) >= TRACK):
            return
        p["coins"].append({"mint": l["mint"], "symbol": l.get("symbol") or "", "name": l.get("name") or "", "why": why,
                           "after": max(0, round(l["t"] - p["t"]))})

    # ---------- prices (DexScreener) ----------
    async def _dex(self, c: httpx.AsyncClient, mints: list[str]) -> dict[str, dict]:
        out: dict[str, dict] = {}
        for i in range(0, len(mints), 30):
            try:
                r = await c.get(DEX + ",".join(mints[i:i + 30]), timeout=15)
                pairs = (r.json() or {}).get("pairs") or []
            except (httpx.HTTPError, ValueError):
                continue
            for p in pairs:
                m = (p.get("baseToken") or {}).get("address")
                if not m or (out.get(m) and (out[m]["liq"] or 0) >= ((p.get("liquidity") or {}).get("usd") or 0)):
                    continue
                tx5, tx1 = (p.get("txns") or {}).get("m5") or {}, (p.get("txns") or {}).get("h1") or {}
                out[m] = {"price": float(p.get("priceUsd") or 0) or None, "mcap": p.get("marketCap") or p.get("fdv"),
                          "liq": (p.get("liquidity") or {}).get("usd"), "ch5": (p.get("priceChange") or {}).get("m5"),
                          "ch1": (p.get("priceChange") or {}).get("h1"), "b5": tx5.get("buys", 0), "s5": tx5.get("sells", 0),
                          "b1": tx1.get("buys", 0), "s1": tx1.get("sells", 0), "vol1": (p.get("volume") or {}).get("h1"),
                          "image": (p.get("info") or {}).get("imageUrl"), "url": p.get("url"), "dex": p.get("dexId"),
                          "symbol": (p.get("baseToken") or {}).get("symbol"), "name": (p.get("baseToken") or {}).get("name"), "at": _now()}
            await asyncio.sleep(0.25)
        return out

    async def checker(self):
        async with httpx.AsyncClient(headers={"User-Agent": "AMG-Hub/1.0"}, follow_redirects=True) as c:
            while True:
                try:
                    await self.check(c)
                except Exception:  # noqa: BLE001
                    log.exception("live check")
                await asyncio.sleep(10)

    async def check(self, c: httpx.AsyncClient):
        now = _now()
        if now - self._sol_at > 300:
            got = await self._dex(c, [WSOL])
            if got.get(WSOL, {}).get("price"):
                self.sol_usd, self._sol_at = got[WSOL]["price"], now
        want: list[str] = []
        for l in list(self.launches.values()):
            age = now - l["t"]
            if l["checks"] < len(CHECK_AT) and age >= CHECK_AT[l["checks"]]:
                want.append(l["mint"])
                l["checks"] = sum(1 for a in CHECK_AT if age >= a)
        coins = {cn["mint"] for p in self.posts.values() if now - p["t"] < 3 * 3600 for cn in p["coins"]}
        if now - getattr(self, "_slow", 0) >= 20:   # the coins under posts and the radar: every 20 s
            self._slow = now
            want += [m for m in coins if m not in want] + [r["mint"] for r in self.radar if r["mint"] not in want]
        got = await self._dex(c, want[:240])
        for m, d in got.items():
            l = self.launches.get(m)
            if l:
                l["dex"] = d
                l["peak"] = max(l.get("peak") or 0, d["mcap"] or 0)
            for p in self.posts.values():
                for cn in p["coins"]:
                    if cn["mint"] == m:
                        cn.update(mcap=d["mcap"], image=d["image"], url=d["url"], ch5=d["ch5"], peak=max(cn.get("peak") or 0, d["mcap"] or 0),
                                  symbol=cn["symbol"] or d["symbol"] or "", name=cn["name"] or d["name"] or "")
            r = next((r for r in self.radar if r["mint"] == m), None)
            if r:
                self._radar(r, d)

    # ---------- radar de rugs ----------
    def _alert(self, r: dict, kind: str, level: str, text: str):
        last = r.setdefault("said", {})
        if _now() - last.get(kind, 0) < 600:
            return
        last[kind] = _now()
        self.alerts.appendleft({"t": _now(), "mint": r["mint"], "symbol": r.get("symbol") or r["mint"][:4], "level": level, "text": text})

    def _radar(self, r: dict, d: dict):
        prev = r.get("last") or {}
        r.update(symbol=r.get("symbol") or d["symbol"], image=d["image"], url=d["url"])
        if d["ch5"] is not None and d["ch5"] <= -30:
            self._alert(r, "crash", "bad", f"O preço caiu {abs(d['ch5']):.0f}% em 5 minutos.")
        if prev.get("liq") and d["liq"] is not None and d["liq"] < prev["liq"] * 0.7:
            self._alert(r, "liq", "bad", f"Saiu dinheiro da pool: {prev['liq']:,.0f} $ → {d['liq']:,.0f} $. Podem estar a tirar a liquidez.".replace(",", " "))
        if d["s5"] >= 10 and d["s5"] >= 3 * max(1, d["b5"]):
            self._alert(r, "sells", "warn", f"Muitas vendas: {d['s5']} vendas contra {d['b5']} compras nos últimos 5 minutos.")
        if d["ch1"] is not None and d["ch1"] <= -50:
            self._alert(r, "hour", "bad", f"Caiu {abs(d['ch1']):.0f}% na última hora.")
        r["last"] = {k: d[k] for k in ("price", "mcap", "liq", "ch5", "ch1", "b5", "s5", "at")}

    def radar_add(self, mint: str) -> bool:
        if not SOL_ADDR.fullmatch(mint) or any(r["mint"] == mint for r in self.radar):
            return False
        l = self.launches.get(mint) or {}
        self.radar.insert(0, {"mint": mint, "symbol": l.get("symbol"), "added": _now()})
        del self.radar[30:]
        self._slow = 0
        return True

    def radar_del(self, mint: str):
        self.b.state["radar"] = [r for r in self.radar if r["mint"] != mint]

    # ---------- the widget's four tabs ----------
    def signal(self, l: dict) -> dict | None:
        d = l.get("dex")
        if not d or not d["mcap"] or _now() - l["t"] > 3600:
            return None
        buys, sells = d["b5"] or d["b1"], d["s5"] or d["s1"]
        if d["mcap"] < 25000 or (d["liq"] or 0) < 8000 or buys < 15 or buys < 1.5 * max(1, sells) or (d["ch5"] or 0) <= 0:
            return None
        strong = d["mcap"] >= 60000 and buys >= 2.5 * max(1, sells)
        return {"tone": "ok" if strong else "warn", "word": "Forte" if strong else "A aquecer",
                "why": f"{buys} compras e {sells} vendas em 5 min, +{d['ch5'] or 0:.0f}% em 5 min"}

    def view(self) -> dict:
        now = _now()
        rows = []
        for l in reversed(list(self.launches.values())[-120:]):
            d = l.get("dex") or {}
            mc = d.get("mcap") or ((l.get("mc_sol") or 0) * self.sol_usd if self.sol_usd else None)
            rows.append({"mint": l["mint"], "symbol": l["symbol"], "name": l["name"], "t": l["t"], "mcap": mc, "image": d.get("image"),
                         "dev_sol": l["dev_sol"], "sig": self.signal(l), "migrated": bool(l.get("migrated"))})
        sigs = []
        for l in reversed(list(self.launches.values())):
            if now - l["t"] > 3600:
                break
            s = self.signal(l)
            if s:
                d = l["dex"]
                xs = [p["who"] for p in self.posts.values() if any(cn["mint"] == l["mint"] for cn in p["coins"])]
                sigs.append({"mint": l["mint"], "symbol": l["symbol"], "name": l["name"], "t": l["t"], "image": d["image"], "url": d["url"],
                             "mcap": d["mcap"], "liq": d["liq"], "ch5": d["ch5"], "peak": l.get("peak"), "x": xs[:2], **s})
        posts = []
        for p in reversed(self.posts.values()):
            if now - p["t"] > 6 * 3600:
                continue
            cs = sorted(p["coins"], key=lambda c: -(c.get("peak") or c.get("mcap") or 0))
            for n, cn in enumerate(cs):
                cn["best"] = n == 0 and len(cs) > 1 and bool(cn.get("peak"))
            posts.append({k: p[k] for k in ("id", "who", "name", "text", "url", "t", "watched", "inf")} | {"coins": cs[:SHOW], "more": max(0, len(cs) - SHOW)})
            if len(posts) >= 80:
                break
        lag = [p["got"] - p["t"] for p in list(self.posts.values())[-30:] if not p["back"] and 0 <= p["got"] - p["t"] < 120]
        return {"src": {k: {**v, "ago": round(now - v["at"]) if v["at"] else None} for k, v in self.src.items()},
                "sol": self.sol_usd, "lag": round(sorted(lag)[len(lag) // 2], 1) if lag else None,
                "launches": rows, "per_min": round(sum(1 for l in self.launches.values() if now - l["t"] < 600) / 10, 1),
                "signals": sigs[:30], "posts": posts,
                "radar": [{**{k: r.get(k) for k in ("mint", "symbol", "image", "url", "added")}, **(r.get("last") or {})} for r in self.radar],
                "alerts": list(self.alerts)[:60]}

    async def run(self):
        if self.started:
            return
        self.started = True
        try:   # the last relayed items, so the X tab is not empty after a start
            async with httpx.AsyncClient(timeout=15) as c:
                for e in reversed((await c.get(TREE_HIST)).json() or []):
                    self.on_tree(e, backfill=True)
        except (httpx.HTTPError, ValueError):
            pass
        await asyncio.gather(self._ws("pump", PUMP_WS, ['{"method":"subscribeNewToken"}', '{"method":"subscribeMigration"}'], self.on_pump),
                             self._ws("tree", TREE_WS, [], self.on_tree), self.checker())
