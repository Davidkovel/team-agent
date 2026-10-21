"""Sinal na notícia (#/sinal, Sala de Trading; pedido do David a 21 out): the second a red (high-impact) figure of any currency
is out, BUY or SELL on the page and over any page of the Hub, so nobody refreshes Forex Factory during the news.

Speed: from 2 s before the minute the Hub keeps 4 kept-alive connections to TradingView's calendar and 5 to the Forex Factory
day page busy at once (select over the sockets, no threads): ~8 answers a second from each, a fresh one every ~65 ms, the
most the two sites take (measured 21 out: above ~10 a second TradingView answers 429 «too many requests», and Forex Factory
gives no more than ~8 whatever the connections). On a 429 that site gets 2 s off and a slower pace for that minute. The first
source with the figure wins; a round trip is ~130 ms, the floor for knowing it after the site has it. The figure is judged against the
Forex Factory forecast; a TradingView row is tied to its Forex Factory figure by country, minute, previous value (the K/M
scale corrected) and forecast, never by name alone, and a figure without a sure row is read from Forex Factory only.

Direction: USD figures with history (reaction_data/, the same files as «Reação à notícia») = what the asset did in the first
5 minutes after past releases with the same outcome, and also after those with a surprise at least this big; under 60% =
NO TRADE. Everything else = the currency rule (above the forecast = the currency up; unemployment and claims the other way)
on its pair against the dollar. Synchronous: main.py's loop calls DESK.step through asyncio.to_thread. Per PC, nothing goes
by sync; the diary is ~/.team-agent/trading-room/sinal.json. Research behind it: the news-reaction repository."""
from __future__ import annotations

import bisect
import gzip
import http.client
import json
import logging
import math
import re
import select
import statistics as st
import time
from datetime import datetime, timedelta, timezone

from . import reaction
from .room import DIR

log = logging.getLogger("tradingroom.sinal")

FILE = DIR / "sinal.json"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
MONTHS = ("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec")
# USD figures with history in reaction_data/ and their TradingView title; first in this order = the figure that decides
# when several come out at the same minute (otherwise Forex Factory's own order, which puts the headline first).
KNOWN = {"Federal Funds Rate": ("fed interest rate decision", "fomc"), "Non-Farm Employment Change": ("non farm payrolls", "nfp"),
         "Core CPI m/m": ("core inflation rate mom", "cpi"), "Core PCE Price Index m/m": ("core pce price index mom", "pce"),
         "PPI m/m": ("ppi mom", "ppi"), "Retail Sales m/m": ("retail sales mom", "retail")}
COUNTRIES = {"USD": ("US",), "EUR": ("EU", "DE", "FR", "IT", "ES"), "GBP": ("GB",), "JPY": ("JP",), "AUD": ("AU",), "NZD": ("NZ",),
             "CAD": ("CA",), "CHF": ("CH",), "CNY": ("CN",)}
# the pair that moves on a currency's news; -1 = that currency is the second one (USD/JPY up = yen down)
PAIR = {"EUR": ("EURUSD", 1), "GBP": ("GBPUSD", 1), "AUD": ("AUDUSD", 1), "NZD": ("NZDUSD", 1), "CNY": ("AUDUSD", 1),
        "JPY": ("USDJPY", -1), "CAD": ("USDCAD", -1), "CHF": ("USDCHF", -1)}
USD_ASSETS = list(reaction.SYMS)   # GOLD, EURUSD, GER40, GBPUSD: all go against the dollar
INVERSE = re.compile(r"unemployment|jobless|claimant|claims", re.I)   # more of these = a weaker currency
MIN_N, MIN_SHARE = 6, 0.6
POLL_FROM, GIVE_UP = 2.0, 180.0   # start 2 s before the minute; no figure in 3 min = give up
ENSAIO_LEAD, ENSAIO_KEEP = 15.0, 240.0   # the rehearsal: the release 15 s after the press (the lanes open first), on screen for 4 min
TV_LANES, TV_GAP = 4, 0.12   # requests in flight at once, and the least time between two sends (measured limits above)
FF_LANES, FF_GAP = 5, 0.06


# ------------------------------------------------------------------ the connections

class Lane:
    """One kept-alive HTTPS connection with at most one request in flight."""

    def __init__(self, pool: "Pool"):
        self.pool, self.c, self.sent = pool, None, None

    def fileno(self) -> int:
        return self.c.sock.fileno()

    def send(self, path: str):
        if self.c is None:
            self.c = http.client.HTTPSConnection(self.pool.host, timeout=self.pool.timeout)
        self.c.request("GET", path, headers=self.pool.headers)
        self.sent = time.perf_counter()

    def read(self) -> bytes:
        r = self.c.getresponse()
        b = r.read()
        took, self.sent = time.perf_counter() - self.sent, None
        if r.status != 200:
            raise OSError(r.status)
        self.pool.answered(took)
        return gzip.decompress(b) if r.getheader("Content-Encoding") == "gzip" else b

    def drop(self):
        if self.c:
            self.c.close()
        self.c, self.sent = None, None


class Pool:
    """Several lanes to one host, all kept busy while a figure is due: an answer every round trip / lanes."""

    def __init__(self, host: str, headers: dict, lanes: int, gap: float, timeout: float = 3.0):
        self.host, self.headers, self.gap, self.base_gap, self.timeout = host, headers, gap, gap, timeout
        self.lanes = [Lane(self) for _ in range(lanes)]
        self.side = Lane(self)   # single requests (the calendar, the day page) never wait behind the lanes
        self.last_send, self.pause = 0.0, 0.0
        self.ms, self.errors, self.times = None, 0, []   # last round trip, failures, answer times of the last second

    def answered(self, took: float):
        now = time.perf_counter()
        self.ms = round(took * 1000)
        self.times = [x for x in self.times if now - x < 1] + [now]

    def rate(self) -> int:
        now = time.perf_counter()
        return sum(now - x < 1 for x in self.times)

    def failed(self, lane: Lane, e: Exception):
        lane.drop()
        self.errors += 1
        if isinstance(e, OSError) and e.args and e.args[0] in (403, 429, 503):   # the site says slow down: 2 s off, then slower
            self.pause = time.perf_counter() + 2
            self.gap = min(self.gap * 1.5, 0.5)

    def get(self, path: str) -> bytes | None:
        """One request, waiting for the answer."""
        for attempt in (0, 1):   # a kept-alive connection the server has closed fails once, then a fresh one
            reused = self.side.c is not None
            try:
                self.side.send(path)
                return self.side.read()
            except Exception as e:
                self.side.drop()
                if attempt or not reused:
                    self.failed(self.side, e)
                    return None
        return None

    def warm(self, path) -> bytes | None:
        """Open every lane with one request each (a new TLS connection costs ~0.2 s: not something to do at the minute)."""
        last, self.gap = None, self.base_gap
        for lane in self.lanes:
            try:
                if lane.sent is not None:
                    lane.drop()
                lane.send(path())
                last = lane.read()
            except Exception as e:
                self.failed(lane, e)
        return last


def pump(jobs: list, budget: float, lanes: int | None = None) -> list[tuple[Pool, bytes]]:
    """Keep the lanes of every pool busy for `budget` seconds and hand back the answers that came, as they came.
    jobs = [(pool, function giving the path)]; `lanes` caps how many lanes of each pool are used."""
    out, end = [], time.perf_counter() + budget
    while True:
        now = time.perf_counter()
        for pool, path in jobs:
            for lane in pool.lanes[:lanes]:
                if lane.sent is not None:
                    if now - lane.sent > pool.timeout:
                        pool.failed(lane, TimeoutError())
                elif now >= pool.pause and now - pool.last_send >= pool.gap:
                    try:
                        lane.send(path())
                        pool.last_send = now = time.perf_counter()
                    except Exception as e:
                        pool.failed(lane, e)
        left = end - time.perf_counter()
        if left <= 0:
            return out
        busy = [lane for pool, _ in jobs for lane in pool.lanes if lane.sent is not None]
        wait = min(left, min(pool.gap for pool, _ in jobs))
        if not busy:
            time.sleep(wait)
            continue
        ready, _, _ = select.select(busy, [], [], wait)
        for lane in ready:
            try:
                out.append((lane.pool, lane.read()))
            except Exception as e:
                lane.pool.failed(lane, e)


def tv_pool() -> Pool:
    return Pool("economic-calendar.tradingview.com", {"User-Agent": UA, "Origin": "https://www.tradingview.com", "Accept-Encoding": "gzip"}, TV_LANES, TV_GAP)


def ff_pool(lanes: int = FF_LANES) -> Pool:
    return Pool("www.forexfactory.com", {"User-Agent": UA, "Accept-Encoding": "gzip"}, lanes, FF_GAP)


# ------------------------------------------------------------------ figures

FF_START = re.compile(r'\{"id":\d+,"ebaseId":')


def obj_at(html: str, i: int) -> dict | None:
    """The JSON object that starts at html[i] (Forex Factory embeds its events as JSON in the page)."""
    j, depth, instr = i, 0, False
    while j < len(html):
        ch = html[j]
        if instr:
            if ch == "\\":
                j += 1
            elif ch == '"':
                instr = False
        elif ch == '"':
            instr = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                break
        j += 1
    try:
        return json.loads(html[i:j + 1])
    except ValueError:
        return None


def ff_objects(html: str) -> list[dict]:
    return [o for o in (obj_at(html, m.start()) for m in FF_START.finditer(html)) if o]


def ff_at(html: str, ts: int) -> list[dict]:
    """The events of one minute in a Forex Factory page: found by their dateline, so only those few are parsed."""
    starts = [m.start() for m in FF_START.finditer(html)]
    out = []
    for m in re.finditer(rf'"dateline":{int(ts)}(?=[,}}])', html):
        k = bisect.bisect_right(starts, m.start()) - 1
        o = obj_at(html, starts[k]) if k >= 0 else None
        if o and o.get("dateline") == int(ts) and o not in out:
            out.append(o)
    return out


def num(v) -> float | None:
    try:
        return float(re.sub(r"[^0-9.\-]", "", v or ""))
    except ValueError:
        return None


def decimals(s: str) -> int:
    m = re.search(r"\.(\d+)", s or "")
    return len(m.group(1)) if m else 0


def fmt(a: float, like: str) -> str:
    """A figure written like Forex Factory writes the forecast (decimals and %, K, M)."""
    return f"{a:.{decimals(like)}f}{re.sub(r'[0-9.+<>-]', '', like or '')}"


def outcome(a: float | None, forecast: str) -> str | None:
    f = num(forecast)
    if a is None or f is None:
        return None
    a = round(a, decimals(forecast))
    return "ABOVE" if a > f + 1e-9 else "BELOW" if a < f - 1e-9 else "INLINE"


def tv_value(v, tv_prev, previous: str):
    """TradingView's figure in Forex Factory's units (the K/M scale differs at times), matched on the previous value."""
    p = num(previous)
    if v is not None and p and tv_prev and p / tv_prev > 0:
        v *= 10 ** round(math.log10(p / tv_prev))
    return v


def same(text: str, v) -> bool:
    """Is TradingView's value the Forex Factory one (scale aside, to Forex Factory's decimals)?"""
    p = num(text)
    try:
        v = float(v)
    except (TypeError, ValueError):
        return False
    if p is None:
        return False
    if p == 0 or v == 0:
        return p == v
    if p / v <= 0:
        return False
    v *= 10 ** round(math.log10(p / v))
    return abs(v - p) <= 0.5 * 10 ** -decimals(text) + 1e-9


DROP = {"german", "french", "italian", "spanish", "prelim", "flash", "final", "revised", "advance", "adv", "index", "rate", "s", "a"}


def words(name: str, title: str) -> float:
    """How much of the names is the same, 0 to 1 (Forex Factory writes CPI m/m, TradingView Inflation Rate MoM)."""
    def toks(s):
        s = s.lower().replace("m/m", " mom").replace("y/y", " yoy").replace("q/q", " qoq").replace("cpi", "inflation")
        return {w for w in re.findall(r"[a-z]+", s) if w not in DROP}
    a, b = toks(name), toks(title)
    return len(a & b) / len(a | b) if a | b else 0.0


def tv_key(r: dict) -> tuple:
    return (r.get("country"), (r.get("title") or "").lower())


def match(items: list[dict], rows: list[dict], t: float):
    """Give each Forex Factory figure its TradingView row: the same country and minute, the same previous value and forecast,
    the words of the name only as the tie-break. A figure without a sure row stays on Forex Factory alone."""
    when = datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%dT%H:%M")
    used = {i["tv"] for i in items if i["tv"]}
    for i in items:
        if i["tv"]:
            continue
        known = KNOWN.get(i["name"]) if i["cur"] == "USD" else None
        best, score = None, 0.0
        for r in rows:
            if not (r.get("date") or "").startswith(when) or r.get("country") not in COUNTRIES[i["cur"]] or tv_key(r) in used:
                continue
            title = (r.get("title") or "").lower()
            s = 10.0 if known and title == known[0] else 2 * same(i["previous"], r.get("previous")) + same(i["forecast"], r.get("forecast")) + words(i["name"], title)
            if s > score:
                best, score = r, s
        if best is not None and score >= 2.3:   # the previous value plus the forecast or some of the words
            i["tv"] = tv_key(best)
            used.add(i["tv"])


def tv_rows(body: bytes | None) -> list[dict] | None:
    try:
        return json.loads(body).get("result", [])
    except (TypeError, ValueError, AttributeError):
        return None


def ff_week(pool: Pool, which: str) -> list[dict] | None:
    """The red figures of a Forex Factory week page (`this`, `next` or a Sunday like `oct12.2026`), every currency we
    trade; speeches and statements have no figure and stay out."""
    body = pool.get(f"/calendar?week={which}")
    if body is None:
        return None
    out, seen = [], set()
    for pos, o in enumerate(ff_objects(body.decode("utf-8", "replace"))):
        key = (o.get("currency"), o.get("name"), o.get("dateline"))
        if o.get("impactName") != "high" or o.get("currency") not in COUNTRIES or not (o.get("forecast") or o.get("previous")) or key in seen:
            continue
        seen.add(key)
        out.append({"name": o["name"], "cur": o["currency"], "t": o["dateline"], "forecast": o.get("forecast") or "",
                    "previous": o.get("previous") or "", "actual": o.get("actual") or "", "pos": pos})
    return out


def item(e: dict) -> dict:
    return {"name": e["name"], "cur": e["cur"], "label": e["name"], "key": KNOWN[e["name"]][1] if e["cur"] == "USD" and e["name"] in KNOWN else None,
            "forecast": e["forecast"], "previous": e["previous"], "a": None, "actual": "", "outcome": None, "src": None, "sec": None, "tv": None}


def rank(e: dict) -> tuple:
    known = list(KNOWN).index(e["name"]) if e["cur"] == "USD" and e["name"] in KNOWN else 99
    return (known, e.get("pos", 0))


def groups(events: list[dict], since: float) -> list[dict]:
    """The minutes from `since` on, each with its figures in order: per currency, the first one decides."""
    by: dict[int, list[dict]] = {}
    for e in events:
        if e["t"] >= since:
            by.setdefault(e["t"], []).append(e)
    return [{"t": t, "items": [item(e) for e in sorted(by[t], key=rank)]} for t in sorted(by)]


def parts(items: list[dict]) -> list[tuple[str, list[dict]]]:
    out: dict[str, list[dict]] = {}
    for i in items:
        out.setdefault(i["cur"], []).append(i)
    return list(out.items())


# ------------------------------------------------------------------ the verdict

def assets(cur: str) -> list[str]:
    return USD_ASSETS if cur == "USD" else [PAIR[cur][0]]


def verdict(it: dict, asset: str, o: str | None = None) -> dict:
    """What `asset` did in the first 5 minutes after past releases with this outcome: side +1/-1 (0 = nothing to say), k of n
    the same way, median size in %, `big` = the same among those with a surprise at least this big, `rule` when there is no
    history (the currency rule), `strong` = a signal worth showing."""
    o = o or it["outcome"]
    if o not in ("ABOVE", "BELOW"):
        return {"side": 0, "k": 0, "n": 0, "med": None, "big": None, "rule": False, "strong": False}
    data = reaction.load(it["key"]) if it["key"] else None
    rel = [r for r in (data or {}).get("releases", []) if r["surprise"] == o and asset in r["m"]]
    if len(rel) >= MIN_N:
        up = sum(r["m"][asset]["move5"] > 0 for r in rel)
        side = 1 if up * 2 > len(rel) else -1
        k = up if side > 0 else len(rel) - up
        big, f = None, num(it["forecast"])
        if it["a"] is not None and f is not None:
            d = abs(it["a"] - f) - 1e-9
            fig = lambda x: float(x) if isinstance(x, (int, float)) else num(x)   # the history writes "0.2%"
            bigger = [r for r in rel if fig(r.get("actual")) is not None and fig(r.get("forecast")) is not None
                      and abs(fig(r["actual"]) - fig(r["forecast"])) >= d]
            if len(bigger) >= 3:
                big = {"k": sum((r["m"][asset]["move5"] > 0) == (side > 0) for r in bigger), "n": len(bigger),
                       "med": round(st.median(abs(r["m"][asset]["move5"]) for r in bigger), 3)}
        return {"side": side, "k": k, "n": len(rel), "med": round(st.median(abs(r["m"][asset]["move5"]) for r in rel), 3), "big": big,
                "rule": False, "strong": k / len(rel) >= MIN_SHARE}
    up = (1 if o == "ABOVE" else -1) * (-1 if INVERSE.search(it["name"]) else 1)   # the currency's own way
    side = -up if it["cur"] == "USD" else up * PAIR[it["cur"]][1]
    return {"side": side, "k": 0, "n": 0, "med": None, "big": None, "rule": True, "strong": True}


def short(v: dict) -> str:
    return "" if not v["side"] else ("BUY" if v["side"] > 0 else "SELL") if v["strong"] else "none"


# ------------------------------------------------------------------ one minute being watched

class Watch:
    """The figures of one minute: wait -> poll -> done (or none). Each currency in it is a part with its own verdict.
    An ensaio replays a past release with the clock moved so it comes out 15 s later: the same checks against the real
    pages of that day, the figure hidden until 1.5 s (TradingView) / 3 s (Forex Factory)."""

    def __init__(self, g: dict, test: bool = False):
        self.t, self.items, self.test = g["t"], g["items"], test
        self.shift = g["t"] - time.time() - ENSAIO_LEAD if test else 0.0
        self.started = time.time()
        self.id = f"{g['t']}{'e' if test else ''}"
        self.state, self.checks, self.warm_at, self.slow_at, self.end_at, self.ff_path = "wait", 0, 0.0, 0.0, 0.0, None
        self.done_at: dict[str, float] = {}   # currency -> when its deciding figure landed
        self.px0 = self.px = None   # gold just before the minute and now, on USD figures (not in an ensaio: that price is today's)
        self.last_px = 0.0

    def clock(self) -> float:
        return time.time() + self.shift

    @property
    def usd(self) -> bool:
        return any(i["cur"] == "USD" for i in self.items)

    def mains(self) -> list[tuple[str, dict]]:
        return [(cur, its[0]) for cur, its in parts(self.items)]

    def tv_path(self) -> str:
        a, b = (datetime.fromtimestamp(self.t + m, timezone.utc).strftime("%Y-%m-%dT%H:%M:00.000Z") for m in (-60, 60))
        countries = ",".join(sorted({c for i in self.items for c in COUNTRIES[i["cur"]]}))
        return f"/events?from={a}&to={b}&countries={countries}&_={time.time_ns() // 1000}"

    def warm(self, desk: "Desk"):
        """Before the minute: open every lane, tie the TradingView rows, find the Forex Factory day page that has this minute
        (its days follow the visitor's time zone, so the UTC date can be the day before or after)."""
        rows = tv_rows(desk.tv.warm(self.tv_path))
        if rows:
            match(self.items, rows, self.t)
        if not self.ff_path:
            d = datetime.fromtimestamp(self.t, timezone.utc).date()
            for k in (0, -1, 1):
                x = d + timedelta(days=k)
                path = f"/calendar?day={MONTHS[x.month - 1]}{x.day}.{x.year}"
                b = desk.ff.get(path)
                if b and ff_at(b.decode("utf-8", "replace"), self.t):
                    self.ff_path = path
                    break
        if self.ff_path:
            desk.ff.warm(lambda: self.ff_path)

    def tick(self, desk: "Desk") -> float:
        now = self.clock()
        left = self.t - now
        if self.state == "wait":
            if left > POLL_FROM:
                if left < 32 and now - self.warm_at >= 10:   # at -32, -22 and -12 s: the lanes stay alive
                    self.warm_at = now
                    self.warm(desk)
                if self.usd and not self.test and left < 60 and now - self.last_px >= 2:
                    self.last_px = now
                    self.px0 = desk.price()
                return min(1.0, max(0.02, left - POLL_FROM))
            self.state = "poll"
            if not self.warm_at:   # the Hub started a moment ago
                self.warm(desk)
        if self.state == "poll":
            self.poll(desk, 0.3)
            mains = self.mains()
            for cur, m in mains:
                if m["a"] is not None and cur not in self.done_at:
                    self.done_at[cur] = self.clock()
                    desk.landed(self, cur)
            if len(self.done_at) == len(mains) or left < -GIVE_UP:
                self.state, self.end_at = ("done" if self.done_at else "none"), self.clock()
                desk.news = True
            else:
                return 0.0
        if self.state == "done":
            if now - self.end_at < 20 and any(i["a"] is None for i in self.items) and now - self.slow_at >= 1:
                self.slow_at = now
                self.poll(desk, 0.25, lanes=1)
            if self.usd and not self.test and now - self.t < 330 and now - self.last_px >= 1:
                self.last_px = now
                self.px = desk.price() or self.px
                if now - self.t >= 300:
                    desk.five(self)
            return 0.5 if now - self.t < 330 else 5.0
        return 5.0

    def poll(self, desk: "Desk", budget: float, lanes: int | None = None):
        """Every lane busy for `budget` seconds; the first source with a figure wins it."""
        jobs = [(desk.tv, self.tv_path)] + ([(desk.ff, lambda: self.ff_path)] if self.ff_path else [])
        for pool, body in pump(jobs, budget, lanes):
            self.checks += 1
            now = self.clock()
            if pool is desk.tv:
                rows = tv_rows(body)
                if rows is None or (self.test and now < self.t + 1.5):
                    continue
                if any(i["tv"] is None for i in self.items):
                    match(self.items, rows, self.t)
                by = {tv_key(r): r for r in rows}
                for i in self.items:
                    r = by.get(i["tv"]) if i["tv"] else None
                    if i["a"] is None and r and r.get("actual") is not None:
                        self.got(i, tv_value(r["actual"], r.get("previous"), i["previous"]), "TradingView")
            else:
                if self.test and now < self.t + 3:
                    continue
                acts = {(o.get("currency"), o.get("name")): o.get("actual") or "" for o in ff_at(body.decode("utf-8", "replace"), self.t)}
                for i in self.items:
                    a = num(acts.get((i["cur"], i["name"])))
                    if i["a"] is None and a is not None:
                        self.got(i, a, "Forex Factory")

    def got(self, i: dict, a: float, src: str):
        i.update(a=a, actual=fmt(a, i["forecast"] or i["previous"]), outcome=outcome(a, i["forecast"]), src=src,
                 sec=round(self.clock() - self.t, 2))

    def part(self, cur: str, its: list[dict]) -> dict:
        m = its[0]
        state = "done" if m["a"] is not None else "none" if self.state in ("done", "none") else self.state
        out = {"cur": cur, "id": f"{self.id}{cur}", "state": state, "assets": assets(cur),
               "items": [{k: i[k] for k in ("name", "label", "forecast", "previous", "actual", "outcome", "src", "sec")} for i in its],
               "scen": {o: {s: verdict(m, s, o) for s in assets(cur)} for o in ("ABOVE", "BELOW")}}
        if state == "done":
            out["verdict"] = {s: verdict(m, s) for s in assets(cur)}
            out["ago"] = round(self.clock() - self.done_at[cur])
        return out

    def view(self, desk: "Desk") -> dict:
        return {"id": self.id, "test": self.test, "state": self.state, "t": self.t, "left": round(self.t - self.clock(), 2),
                "checks": self.checks, "rate": {"tv": desk.tv.rate(), "ff": desk.ff.rate()}, "ms": {"tv": desk.tv.ms, "ff": desk.ff.ms},
                "lanes": {"tv": TV_LANES, "ff": FF_LANES}, "px0": self.px0, "px": self.px,
                "parts": [self.part(cur, its) for cur, its in parts(self.items)]}


# ------------------------------------------------------------------ the desk

class Desk:
    def __init__(self):
        self.tv, self.ff = tv_pool(), ff_pool()
        self.bn = Pool("fapi.binance.com", {"User-Agent": UA}, 0, 1.0, 2.0)
        self.events: list[dict] = []
        self.cal_at, self.cal_error = 0.0, None
        self.cur: Watch | None = None
        self.test: Watch | None = None
        self.viewed, self.gold, self.gold_at = 0.0, None, 0.0
        self.news = False   # a live event for the pages is due
        self.pushes: list[tuple[str, str]] = []   # for the phones, sent by the loop
        self.diary: list[dict] = self._read()

    # ---- state on disk
    def _read(self) -> list[dict]:
        try:
            return json.loads(FILE.read_text(encoding="utf-8")).get("diary", [])
        except (OSError, ValueError):
            return []

    def _save(self):
        try:
            FILE.parent.mkdir(parents=True, exist_ok=True)
            FILE.write_text(json.dumps({"diary": self.diary[-120:]}, ensure_ascii=False), encoding="utf-8")
        except OSError:
            log.exception("sinal: save")

    def landed(self, w: Watch, cur: str):
        """A currency's deciding figure is in: the pages hear it now, the phones get it, the diary keeps it."""
        self.news = True
        if w.test:
            return
        m = dict(parts(w.items))[cur][0]
        sides = {s: short(verdict(m, s)) for s in assets(cur)}
        main = assets(cur)[0]
        word = {"BUY": "BUY", "SELL": "SELL"}.get(sides[main], "NO TRADE")
        names = {"GOLD": "ouro"}
        self.pushes.append((f"{word} {names.get(main, main[:3] + '/' + main[3:])} · {cur} {m['name']}",
                            f"Saiu {m['actual']} · previsão {m['forecast'] or '—'} · anterior {m['previous'] or '—'}"))
        self.diary.append({"id": f"{w.id}{cur}", "t": w.t, "cur": cur, "label": m["label"], "actual": m["actual"], "forecast": m["forecast"],
                           "outcome": m["outcome"], "src": m["src"], "sec": m["sec"], "sides": sides,
                           "px0": w.px0 if cur == "USD" else None, "move5": None})
        self._save()

    def five(self, w: Watch):
        """Gold 5 minutes after the minute, against the price just before it: was the signal right."""
        d = next((d for d in reversed(self.diary) if d["id"] == f"{w.id}USD"), None)
        if d and d["move5"] is None and w.px0 and w.px:
            d["move5"] = round((w.px - w.px0) / w.px0 * 100, 3)
            self._save()

    def price(self) -> float | None:
        try:
            self.gold, self.gold_at = float(json.loads(self.bn.get("/fapi/v1/ticker/price?symbol=XAUUSDT"))["price"]), time.time()
        except (TypeError, ValueError, KeyError):
            pass
        return self.gold

    # ---- the calendar
    def _calendar(self, now: float):
        nxt = next((g["t"] for g in self.events if g["t"] > now), None)
        every = 60 if nxt and nxt - now < 1200 else 900
        if now - self.cal_at < (60 if self.cal_error else every):
            return
        self.cal_at = now
        evs = []
        for which in ("this", "next"):
            got = ff_week(self.ff, which)
            if got is None:
                self.cal_error = "O Forex Factory não respondeu: tento outra vez dentro de 1 min."
                return
            evs += got
        self.cal_error = None
        self.events = groups(evs, now - GIVE_UP)

    def _pick(self, now: float):
        """The minute to watch: the next one; a finished one stays on screen until 10 min before the next."""
        ahead = [g for g in self.events if g["t"] >= now - GIVE_UP]
        if not ahead:
            return
        g = ahead[0]
        if self.cur and self.cur.t == g["t"]:
            if self.cur.state == "wait":   # the forecast can still change on the day
                known = {(i["cur"], i["name"]): i for i in self.cur.items}
                self.cur.items = [{**known[(i["cur"], i["name"])], "forecast": i["forecast"], "previous": i["previous"]}
                                  if (i["cur"], i["name"]) in known else dict(i) for i in g["items"]]
            return
        if self.cur and (self.cur.state == "poll" or (self.cur.state in ("done", "none") and g["t"] - now > 600)):
            return
        self.cur = Watch({**g, "items": [dict(i) for i in g["items"]]})

    def step(self) -> float:
        now = time.time()
        if self.test and now - self.test.started > ENSAIO_KEEP:
            self.test = None
            self.news = True
        busy = [w for w in (self.test, self.cur) if w and w.state in ("wait", "poll") and w.t - w.clock() < POLL_FROM + 3]
        if not busy:
            try:
                self._calendar(now)
            except Exception:
                log.exception("sinal: calendar")
            self._pick(now)
            if now - self.viewed < 30 and now - self.gold_at > 30:
                self.price()
        waits = [w.tick(self) for w in (self.test, self.cur) if w]
        return min(waits + [5.0])

    # ---- what the API gives
    def out(self) -> dict:
        self.viewed = time.time()
        w = self.test or self.cur
        nxt = []
        for g in self.events:
            if (w and g["t"] == w.t and not w.test) or g["t"] < time.time() - GIVE_UP:
                continue
            for cur, its in parts(g["items"]):
                m = its[0]
                nxt.append({"t": g["t"], "cur": cur, "label": m["label"], "forecast": m["forecast"], "previous": m["previous"],
                            "also": [i["label"] for i in its[1:]], "assets": assets(cur),
                            "scen": {o: {s: verdict(m, s, o) for s in assets(cur)} for o in ("ABOVE", "BELOW")}})
        return {"now": time.time(), "watch": w.view(self) if w else None, "next": nxt[:10], "diary": self.diary[-30:][::-1],
                "gold": self.gold, "error": self.cal_error}

    def alert(self) -> dict | None:
        """What to put over every page: the parts of a minute (or an ensaio) that landed in the last 3 minutes."""
        for w in (self.test, self.cur):
            if not w:
                continue
            fresh = [cur for cur, at in w.done_at.items() if w.clock() - at < 180]
            if fresh:
                v = w.view(self)
                return {"id": w.id + "".join(sorted(fresh)), "test": w.test, "t": w.t, "px0": w.px0, "px": w.px,
                        "parts": [p for p in v["parts"] if p["cur"] in fresh]}
        return None

    def ensaio(self) -> dict:
        """Replay the last US Core CPI (the Forex Factory weeks before this one, newest first)."""
        pool = ff_pool(0)   # not the loop's connections: this runs in the request's thread
        sunday = datetime.now(timezone.utc).date()
        sunday -= timedelta(days=(sunday.weekday() + 1) % 7)
        for k in range(8):
            d = sunday - timedelta(weeks=k)
            evs = ff_week(pool, "this" if k == 0 else f"{MONTHS[d.month - 1]}{d.day}.{d.year}") or []
            cpi = [e["t"] for e in evs if e["cur"] == "USD" and e["name"] == "Core CPI m/m" and e["actual"] and e["t"] < time.time()]
            if cpi:
                g = groups([e for e in evs if e["t"] == max(cpi) and e["cur"] == "USD"], 0)[0]
                self.test = Watch(g, test=True)
                self.news = True
                return self.out()
        raise ValueError("Não encontrei um CPI nas últimas 8 semanas do Forex Factory.")


DESK = Desk()


async def tell(title: str, body: str):
    """The phones: web push where a phone subscribed on this Hub, and the ntfy app of this PC's person (high priority: it
    rings). Only this PC's person on ntfy, since every PC's Hub watches the same minute and the topics travel by sync."""
    from sqlalchemy import select

    from .. import services, sync
    from ..db import SessionLocal
    from ..models import User
    from .room import phones
    await phones(title, body)
    try:
        me = sync.whoami()
        if not me:
            return
        async with SessionLocal() as db:
            ids = [u.id for u in (await db.execute(select(User).where(User.username == me[1]))).scalars()]
            if ids:
                await services.notify(db, ids, "sinal", "high", title, body, href="#/sinal")
    except Exception:
        log.exception("sinal: phone")


async def loop():
    """Every 5 s at rest, every second in the last minute, without a break while a figure is due."""
    import asyncio

    from ..realtime import rt
    await asyncio.sleep(8)
    while True:
        try:
            wait = await asyncio.to_thread(DESK.step)
            if DESK.news:
                DESK.news = False
                await rt.publish("sinal", 0, "team")
            while DESK.pushes:
                await tell(*DESK.pushes.pop(0))
            await asyncio.sleep(wait)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("sinal step")
            await asyncio.sleep(5)
