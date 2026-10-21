"""Sinal na notícia (#/sinal, Sala de Trading; pedido do David a 21 out): the second a US figure is out, BUY or SELL on the
page and over any page of the Hub, so nobody has to keep refreshing Forex Factory. The figure is read from TradingView's
calendar (~5 checks a second over one kept-alive connection, ~130 ms each) and from the Forex Factory day page (once a
second), whichever shows it first, and judged against the Forex Factory forecast (the one traders look at; TradingView's
differs now and then). Direction = what the asset did in the first 5 minutes after past releases with the same outcome
(reaction_data/, the same files as «Reação à notícia»); under 60% of them = no edge, never a signal. Without history, the
dollar rule. Synchronous: main.py's loop calls DESK.step through asyncio.to_thread. Per PC, nothing goes by sync; the
diary is ~/.team-agent/trading-room/sinal.json. Research behind it: the news-reaction repository."""
from __future__ import annotations

import gzip
import http.client
import json
import logging
import math
import re
import statistics as st
import time
from datetime import datetime, timedelta, timezone

from . import reaction
from .room import DIR

log = logging.getLogger("tradingroom.sinal")

FILE = DIR / "sinal.json"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
MONTHS = ("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec")
# Forex Factory name -> (TradingView title in lower case, history file in reaction_data/, name on the page).
# The order is the priority of the main figure when several come out at the same minute.
WATCH = {
    "Federal Funds Rate": ("fed interest rate decision", "fomc", "Juros da Fed"),
    "Non-Farm Employment Change": ("non farm payrolls", "nfp", "Payrolls (NFP)"),
    "Core CPI m/m": ("core inflation rate mom", "cpi", "CPI core m/m"),
    "Core PCE Price Index m/m": ("core pce price index mom", "pce", "PCE core m/m"),
    "PPI m/m": ("ppi mom", "ppi", "PPI m/m"),
    "Retail Sales m/m": ("retail sales mom", "retail", "Vendas a retalho m/m"),
    "CPI m/m": ("inflation rate mom", None, "CPI m/m"),
    "Core CPI y/y": ("core inflation rate yoy", None, "CPI core a/a"),
    "CPI y/y": ("inflation rate yoy", None, "CPI a/a"),
    "Core PPI m/m": ("core ppi mom", None, "PPI core m/m"),
    "Core Retail Sales m/m": ("retail sales ex autos mom", None, "Vendas core m/m"),
    "Unemployment Rate": ("unemployment rate", None, "Taxa de desemprego"),
    "Average Hourly Earnings m/m": ("average hourly earnings mom", None, "Salário por hora m/m"),
    "Advance GDP q/q": ("gdp growth rate qoq adv", None, "PIB q/q"),
    "ISM Manufacturing PMI": ("ism manufacturing pmi", None, "ISM indústria"),
    "ISM Services PMI": ("ism services pmi", None, "ISM serviços"),
    "JOLTS Job Openings": ("jolts job openings", None, "JOLTS vagas"),
    "ADP Non-Farm Employment Change": ("adp employment change", None, "ADP emprego"),
    "Unemployment Claims": ("initial jobless claims", None, "Pedidos de subsídio"),
    "Prelim UoM Consumer Sentiment": ("michigan consumer sentiment prel", None, "Confiança Michigan"),
    "Revised UoM Consumer Sentiment": ("michigan consumer sentiment final", None, "Confiança Michigan (final)"),
    "Flash Manufacturing PMI": ("s&p global manufacturing pmi flash", None, "PMI indústria (flash)"),
    "Flash Services PMI": ("s&p global services pmi flash", None, "PMI serviços (flash)"),
    "CB Consumer Confidence": ("cb consumer confidence", None, "Confiança CB"),
}
ORDER = list(WATCH)
USD_DOWN_IF_ABOVE = ("Unemployment Claims", "Unemployment Rate")   # more of these = a weaker dollar
SYMS = list(reaction.SYMS)   # GOLD, EURUSD, GER40, GBPUSD: all go against the dollar
MIN_N, MIN_SHARE = 6, 0.6
POLL_FROM, GIVE_UP = 2.0, 180.0   # start checking 2 s before the minute; no figure in 3 min = give up
ENSAIO_LEAD, ENSAIO_KEEP = 10.0, 240.0   # the rehearsal: the release 10 s after the press, on screen for 4 min


class Feed:
    """One kept-alive HTTPS connection; get() gives the body or None and keeps the last answer time in ms."""

    def __init__(self, host: str, headers: dict, timeout: float):
        self.host, self.headers, self.timeout, self.c, self.ms, self.errors = host, headers, timeout, None, None, 0

    def get(self, path: str) -> bytes | None:
        for attempt in (0, 1):   # a kept-alive connection the server has closed fails once, then a fresh one
            reused = self.c is not None
            t = time.perf_counter()
            try:
                if self.c is None:
                    self.c = http.client.HTTPSConnection(self.host, timeout=self.timeout)
                self.c.request("GET", path, headers=self.headers)
                r = self.c.getresponse()
                b = r.read()
                if r.status != 200:
                    raise OSError(f"HTTP {r.status}")
                self.ms = round((time.perf_counter() - t) * 1000)
                return gzip.decompress(b) if r.getheader("Content-Encoding") == "gzip" else b
            except Exception:
                if self.c:
                    self.c.close()
                self.c = None
                if attempt or not reused:
                    self.errors += 1
                    return None
        return None


def tv_feed() -> Feed:
    return Feed("economic-calendar.tradingview.com", {"User-Agent": UA, "Origin": "https://www.tradingview.com", "Accept-Encoding": "gzip"}, 2)


def ff_feed() -> Feed:
    return Feed("www.forexfactory.com", {"User-Agent": UA, "Accept-Encoding": "gzip"}, 3)


# ------------------------------------------------------------------ figures

def ff_objects(html: str) -> list[dict]:
    """The event objects Forex Factory embeds as JSON in a calendar page."""
    out, i, start = [], 0, re.compile(r'\{"id":\d+,"ebaseId":')
    while True:
        m = start.search(html, i)
        if not m:
            return out
        i = j = m.start()
        depth, instr = 0, False
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
            out.append(json.loads(html[i:j + 1]))
        except ValueError:
            pass
        i = j + 1


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
    return f"{a:.{decimals(like)}f}{re.sub(r'[0-9.+-]', '', like or '')}"


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


def tv_figures(feed: Feed, t: float) -> dict | None:
    """{lower TradingView title: (actual, previous)} for the US releases around t, or None when TradingView did not answer."""
    a, b = (datetime.fromtimestamp(t + m, timezone.utc).strftime("%Y-%m-%dT%H:%M:00.000Z") for m in (-60, 60))
    body = feed.get(f"/events?from={a}&to={b}&countries=US&_={int(time.time() * 1000)}")
    try:
        rows = json.loads(body).get("result", [])
    except (TypeError, ValueError, AttributeError):
        return None
    return {(e.get("title") or "").lower(): (e.get("actual"), e.get("previous")) for e in rows}


def ff_figures(feed: Feed, t: float) -> dict | None:
    """{Forex Factory name: actual text} for the USD releases at t, from the Forex Factory day page (US releases fall on the
    same date in UTC and in New York), or None."""
    d = datetime.fromtimestamp(t, timezone.utc)
    body = feed.get(f"/calendar?day={MONTHS[d.month - 1]}{d.day}.{d.year}")
    if body is None:
        return None
    return {o["name"]: o.get("actual") or "" for o in ff_objects(body.decode("utf-8", "replace"))
            if o.get("currency") == "USD" and o.get("dateline") == int(t)}


def ff_week(feed: Feed, which: str) -> list[dict] | None:
    """The watched USD releases of a Forex Factory week page (`this`, `next` or a Sunday like `oct12.2026`)."""
    body = feed.get(f"/calendar?week={which}")
    if body is None:
        return None
    out, seen = [], set()
    for o in ff_objects(body.decode("utf-8", "replace")):
        if o.get("currency") != "USD" or o.get("name") not in WATCH or (o["name"], o.get("dateline")) in seen:
            continue
        seen.add((o["name"], o.get("dateline")))
        out.append({"name": o["name"], "t": o["dateline"], "forecast": o.get("forecast") or "", "previous": o.get("previous") or "",
                    "actual": o.get("actual") or "", "impact": o.get("impactName") or ""})
    return out


def groups(events: list[dict], since: float) -> list[dict]:
    """Releases from `since` on, high or medium impact, one entry per minute; items[0] is the figure that decides."""
    by: dict[int, list[dict]] = {}
    for e in events:
        if e["impact"] in ("high", "medium") and e["t"] >= since:
            by.setdefault(e["t"], []).append(e)
    out = []
    for t in sorted(by):
        items = [item(e) for e in sorted(by[t], key=lambda e: ORDER.index(e["name"]))]
        out.append({"t": t, "impact": "high" if any(e["impact"] == "high" for e in by[t]) else "medium", "items": items})
    return out


def item(e: dict) -> dict:
    return {"name": e["name"], "key": WATCH[e["name"]][1], "label": WATCH[e["name"]][2], "forecast": e["forecast"],
            "previous": e["previous"], "a": None, "actual": "", "outcome": None, "src": None, "sec": None}


# ------------------------------------------------------------------ the verdict

def verdict(it: dict, sym: str, o: str | None = None) -> dict:
    """What `sym` did in the first 5 minutes after past releases with this outcome: side +1/-1 (0 = nothing to say), k of n
    the same way, median size in %, `rule` when there is no history (the dollar rule), `strong` = a signal worth showing."""
    o = o or it["outcome"]
    if o not in ("ABOVE", "BELOW"):
        return {"side": 0, "k": 0, "n": 0, "med": None, "rule": False, "strong": False}
    data = reaction.load(it["key"]) if it["key"] else None
    moves = [r["m"][sym]["move5"] for r in (data or {}).get("releases", []) if r["surprise"] == o and sym in r["m"]]
    if len(moves) >= MIN_N:
        up = sum(x > 0 for x in moves)
        side = 1 if up * 2 > len(moves) else -1
        k = up if side > 0 else len(moves) - up
        return {"side": side, "k": k, "n": len(moves), "med": round(st.median(abs(x) for x in moves), 3), "rule": False,
                "strong": k / len(moves) >= MIN_SHARE}
    usd = (1 if o == "ABOVE" else -1) * (-1 if it["name"] in USD_DOWN_IF_ABOVE else 1)
    return {"side": -usd, "k": 0, "n": 0, "med": None, "rule": True, "strong": True}


def short(v: dict) -> str:
    return "" if not v["side"] else ("BUY" if v["side"] > 0 else "SELL") if v["strong"] else "none"


# ------------------------------------------------------------------ one release being watched

class Watch:
    """wait -> poll -> done (or none). An ensaio replays a past release with the clock moved so it comes out 10 s later:
    the same checks against the real pages of that day, the figure hidden until 1.5 s (TradingView) / 3 s (Forex Factory)."""

    def __init__(self, g: dict, test: bool = False):
        self.t, self.items, self.impact, self.test = g["t"], g["items"], g["impact"], test
        self.shift = g["t"] - time.time() - ENSAIO_LEAD if test else 0.0
        self.started = time.time()
        self.id = f"{g['t']}{'e' if test else ''}"
        self.state, self.checks, self.warm, self.last_tv, self.last_ff, self.last_px = "wait", 0, 0.0, 0.0, 0.0, 0.0
        self.done_at = None
        self.px0 = self.px = None   # gold just before the minute and now (not in an ensaio: that price is today's)

    def clock(self) -> float:
        return time.time() + self.shift

    def tick(self, desk: "Desk") -> float:
        now = self.clock()
        left = self.t - now
        if self.state == "wait":
            if left > POLL_FROM:
                if left < 30 and now - self.warm >= 10:   # open both connections before the minute and keep them alive
                    self.warm = now
                    tv_figures(desk.tv, self.t)
                    ff_figures(desk.ff, self.t)
                if not self.test and left < 60 and now - self.last_px >= 2:
                    self.last_px = now
                    self.px0 = desk.price()
                return min(1.0, max(0.05, left - POLL_FROM))
            self.state = "poll"
        if self.state == "poll":
            self.poll(desk, now)
            if self.done_at:
                self.state = "done"
                desk.news = True
                if not self.test:
                    desk.note(self)
            elif left < -GIVE_UP:
                self.state = "none"
                desk.news = True
            else:
                return 0.05
        if self.state == "done":
            if now - self.done_at < 20 and any(i["a"] is None for i in self.items):
                self.poll(desk, now, slow=True)
            if not self.test and now - self.t < 330 and now - self.last_px >= 1:
                self.last_px = now
                self.px = desk.price() or self.px
                if now - self.t >= 300:
                    desk.five(self)
            return 0.5 if now - self.t < 330 else 5.0
        return 5.0

    def poll(self, desk: "Desk", now: float, slow: bool = False):
        """One round of checks; the first source with the figure wins."""
        if now - self.last_tv >= (1 if slow else 0.15):
            self.last_tv = now
            self.checks += 1
            tv = tv_figures(desk.tv, self.t)
            if tv is not None and not (self.test and now < self.t + 1.5):
                for i in self.items:
                    x = tv.get(WATCH[i["name"]][0])
                    if i["a"] is None and x and x[0] is not None:
                        self.got(i, tv_value(x[0], x[1], i["previous"]), "TradingView")
        if now - self.last_ff >= 1:
            self.last_ff = now
            self.checks += 1
            ff = ff_figures(desk.ff, self.t)
            if ff is not None and not (self.test and now < self.t + 3):
                for i in self.items:
                    a = num(ff.get(i["name"]))
                    if i["a"] is None and a is not None:
                        self.got(i, a, "Forex Factory")

    def got(self, i: dict, a: float, src: str):
        i.update(a=a, actual=fmt(a, i["forecast"] or i["previous"]), outcome=outcome(a, i["forecast"]), src=src,
                 sec=round(self.clock() - self.t, 2))
        if i is self.items[0] and not self.done_at:
            self.done_at = self.clock()

    def view(self, desk: "Desk") -> dict:
        m = self.items[0]
        out = {"id": self.id, "test": self.test, "state": self.state, "t": self.t, "left": round(self.t - self.clock(), 2),
               "impact": self.impact, "checks": self.checks, "ms": {"tv": desk.tv.ms, "ff": desk.ff.ms},
               "errors": {"tv": desk.tv.errors, "ff": desk.ff.errors}, "px0": self.px0, "px": self.px,
               "items": [{k: i[k] for k in ("name", "label", "forecast", "previous", "actual", "outcome", "src", "sec")} for i in self.items],
               "scen": {o: {s: verdict(m, s, o) for s in SYMS} for o in ("ABOVE", "BELOW")}}
        if self.state == "done":
            out["verdict"] = {s: verdict(m, s) for s in SYMS}
            out["ago"] = round(self.clock() - self.t)
        return out


# ------------------------------------------------------------------ the desk

class Desk:
    def __init__(self):
        self.tv, self.ff = tv_feed(), ff_feed()
        self.bn = Feed("fapi.binance.com", {"User-Agent": UA}, 2)
        self.events: list[dict] = []
        self.cal_at, self.cal_error = 0.0, None
        self.cur: Watch | None = None
        self.test: Watch | None = None
        self.viewed, self.gold, self.gold_at = 0.0, None, 0.0
        self.news = False   # a live event for the pages is due
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
            FILE.write_text(json.dumps({"diary": self.diary[-80:]}, ensure_ascii=False), encoding="utf-8")
        except OSError:
            log.exception("sinal: save")

    def note(self, w: Watch):
        m = w.items[0]
        self.diary.append({"id": w.id, "t": w.t, "label": m["label"], "actual": m["actual"], "forecast": m["forecast"],
                           "outcome": m["outcome"], "src": m["src"], "sec": m["sec"],
                           "sides": {s: short(verdict(m, s)) for s in SYMS}, "px0": w.px0, "move5": None})
        self._save()

    def five(self, w: Watch):
        """Gold 5 minutes after the minute, against the price just before it: was the signal right."""
        d = next((d for d in reversed(self.diary) if d["id"] == w.id), None)
        if d and d["move5"] is None and w.px0 and w.px:
            d["move5"] = round((w.px - w.px0) / w.px0 * 100, 3)
            self._save()

    def price(self) -> float | None:
        b = self.bn.get("/fapi/v1/ticker/price?symbol=XAUUSDT")
        try:
            self.gold, self.gold_at = float(json.loads(b)["price"]), time.time()
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
        """The release to watch: the next one; a finished one stays on screen until 10 min before the next."""
        ahead = [g for g in self.events if g["t"] >= now - GIVE_UP]
        if not ahead:
            return
        g = ahead[0]
        if self.cur and self.cur.t == g["t"]:
            if self.cur.state == "wait":   # the forecast can still change on the day
                known = {i["name"]: i for i in self.cur.items}
                self.cur.items = [{**known[i["name"]], "forecast": i["forecast"], "previous": i["previous"]} if i["name"] in known else dict(i)
                                  for i in g["items"]]
            return
        if self.cur and self.cur.state in ("done", "none") and g["t"] - now > 600:
            return
        if self.cur and self.cur.state == "poll":
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
            m = g["items"][0]
            nxt.append({"t": g["t"], "impact": g["impact"], "label": m["label"], "forecast": m["forecast"], "previous": m["previous"],
                        "also": [i["label"] for i in g["items"][1:]], "scen": {o: {s: verdict(m, s, o) for s in SYMS} for o in ("ABOVE", "BELOW")}})
        return {"now": time.time(), "watch": w.view(self) if w else None, "next": nxt[:8], "diary": self.diary[-30:][::-1],
                "gold": self.gold, "error": self.cal_error}

    def alert(self) -> dict | None:
        """The result to put over every page: a high-impact release (or an ensaio) out in the last 3 minutes."""
        for w in (self.test, self.cur):
            if w and w.state == "done" and (w.test or w.impact == "high") and w.clock() - w.done_at < 180:
                v = w.view(self)
                return {k: v[k] for k in ("id", "test", "t", "items", "verdict", "ago")}
        return None

    def ensaio(self) -> dict:
        """Replay the last Core CPI (the Forex Factory weeks before this one, newest first)."""
        feed = ff_feed()   # not the loop's connections: this runs in the request's thread
        sunday = datetime.now(timezone.utc).date()
        sunday -= timedelta(days=(sunday.weekday() + 1) % 7)
        for k in range(8):
            d = sunday - timedelta(weeks=k)
            evs = ff_week(feed, "this" if k == 0 else f"{MONTHS[d.month - 1]}{d.day}.{d.year}") or []
            cpi = [e["t"] for e in evs if e["name"] == "Core CPI m/m" and e["actual"] and e["t"] < time.time()]
            if cpi:
                g = groups([e for e in evs if e["t"] == max(cpi)], 0)[0]
                self.test = Watch(g, test=True)
                self.news = True
                return self.out()
        raise ValueError("Não encontrei um CPI nas últimas 8 semanas do Forex Factory.")


DESK = Desk()


async def loop():
    """Every 5 s at rest, every second in the last minute, ~20 times a second while the figure is due."""
    import asyncio

    from ..realtime import rt
    await asyncio.sleep(8)
    while True:
        try:
            wait = await asyncio.to_thread(DESK.step)
            if DESK.news:
                DESK.news = False
                await rt.publish("sinal", 0, "team")
            await asyncio.sleep(wait)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("sinal step")
            await asyncio.sleep(5)
