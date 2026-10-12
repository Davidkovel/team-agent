"""Where the room's numbers come from, all free and without keys:
- candles: TradingView's own chart feed (the websocket its charts use), real time for the OANDA CFDs a trader actually
  trades (XAUUSD spot, DE30EUR = GER40, NAS100USD, US30USD); Yahoo Finance when that fails;
- the economic calendar: TradingView's (with the actual figure once it is out);
- headlines: TradingView's news per symbol (Reuters, Dow Jones, FXStreet...)."""
from __future__ import annotations

import asyncio
import json
import logging
import random
import re
import string
import time
from datetime import datetime, timedelta, timezone

import httpx

log = logging.getLogger("tradingroom")
UTC = timezone.utc
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"}
TV_HEAD = {**UA, "Origin": "https://www.tradingview.com", "Referer": "https://www.tradingview.com/"}

# what the room follows. tv: the chart feed's symbol; news: the symbol whose headlines are about it; ccy: the
# currencies whose news move it; dp: decimals.
INSTRUMENTS = [
    {"id": "XAUUSD", "name": "Ouro", "tv": "OANDA:XAUUSD", "yahoo": "GC=F", "news": "OANDA:XAUUSD", "spread": 0.35, "dp": 2, "ccy": ["USD"]},
    {"id": "EURUSD", "name": "Euro / Dólar", "tv": "OANDA:EURUSD", "yahoo": "EURUSD=X", "news": "FX:EURUSD", "spread": 0.0001, "dp": 5, "ccy": ["EUR", "USD"]},
    {"id": "GER40", "name": "DAX 40", "tv": "OANDA:DE30EUR", "yahoo": "^GDAXI", "news": "XETR:DAX", "spread": 1.2, "dp": 1, "ccy": ["EUR"]},
    {"id": "NAS100", "name": "Nasdaq 100", "tv": "OANDA:NAS100USD", "yahoo": "NQ=F", "news": "NASDAQ:NDX", "spread": 1.5, "dp": 1, "ccy": ["USD"]},
    {"id": "GBPUSD", "name": "Libra / Dólar", "tv": "OANDA:GBPUSD", "yahoo": "GBPUSD=X", "news": "FX:GBPUSD", "spread": 0.00014, "dp": 5, "ccy": ["GBP", "USD"]},
    {"id": "US30", "name": "Dow Jones", "tv": "OANDA:US30USD", "yahoo": "YM=F", "news": "DJ:DJI", "spread": 2.5, "dp": 1, "ccy": ["USD"]},
    {"id": "BTCUSD", "name": "Bitcoin", "tv": "BITSTAMP:BTCUSD", "yahoo": "BTC-USD", "news": "BITSTAMP:BTCUSD", "spread": 40, "dp": 0, "ccy": ["USD"], "crypto": True},
]
# the backdrop the macro side reads: the dollar, the 10-year yield, oil and fear
CONTEXT = [
    {"id": "DXY", "name": "Índice do dólar", "tv": "TVC:DXY", "yahoo": "DX-Y.NYB", "dp": 3},
    {"id": "US10Y", "name": "Juro a 10 anos (EUA)", "tv": "TVC:US10Y", "yahoo": "^TNX", "dp": 3},
    {"id": "USOIL", "name": "Petróleo WTI", "tv": "TVC:USOIL", "yahoo": "CL=F", "dp": 2},
    {"id": "VIX", "name": "VIX (medo)", "tv": "TVC:VIX", "yahoo": "^VIX", "dp": 2},
    # read once a day (D1 only): what drives each pair, the yields of two years and the real yield behind gold
    {"id": "US02Y", "name": "Juro a 2 anos (EUA)", "tv": "TVC:US02Y", "yahoo": "^IRX", "dp": 3, "tfs": ["D1"]},
    {"id": "DE02Y", "name": "Juro a 2 anos (Alemanha)", "tv": "TVC:DE02Y", "yahoo": "", "dp": 3, "tfs": ["D1"]},
    {"id": "GB02Y", "name": "Juro a 2 anos (Reino Unido)", "tv": "TVC:GB02Y", "yahoo": "", "dp": 3, "tfs": ["D1"]},
    {"id": "DE10Y", "name": "Juro a 10 anos (Alemanha)", "tv": "TVC:DE10Y", "yahoo": "", "dp": 3, "tfs": ["D1"]},
    {"id": "REAL10", "name": "Juro real a 10 anos (TIPS)", "tv": "FRED:DFII10", "yahoo": "", "dp": 2, "tfs": ["D1"]},
    {"id": "BE10", "name": "Inflação implícita a 10 anos", "tv": "FRED:T10YIE", "yahoo": "", "dp": 2, "tfs": ["D1"]},
    {"id": "SPX", "name": "S&P 500", "tv": "OANDA:SPX500USD", "yahoo": "^GSPC", "dp": 1, "tfs": ["D1"]},
    {"id": "USDJPY", "name": "Dólar / Iene", "tv": "FX:USDJPY", "yahoo": "JPY=X", "dp": 3, "tfs": ["D1"]},
]
BY_ID = {i["id"]: i for i in INSTRUMENTS + CONTEXT}
TF = {"M5": ("5", 300), "M15": ("15", 300), "H1": ("60", 300), "H4": ("240", 300), "D1": ("1D", 260)}
TF_SECONDS = {"M5": 300, "M15": 900, "H1": 3600, "H4": 14400, "D1": 86400}


# ------------------------------------------------------------------ candles: TradingView's chart feed
def _frame(m: str, p: list) -> str:
    s = json.dumps({"m": m, "p": p}, separators=(",", ":"))
    return f"~m~{len(s)}~m~{s}"


async def tv_candles(wanted: list[tuple[str, str]], seconds: float = 20) -> dict[tuple[str, str], list[tuple]]:
    """Candles for each (symbol, timeframe) in one connection: {(symbol, tf): [(t, o, h, l, c), ...]}. Missing on error."""
    import websockets
    out: dict[tuple[str, str], list[tuple]] = {}
    if not wanted:
        return out
    try:
        async with websockets.connect("wss://data.tradingview.com/socket.io/websocket", max_size=None, open_timeout=10,
                                      additional_headers={"Origin": "https://data.tradingview.com", "User-Agent": UA["User-Agent"]}) as ws:
            await ws.send(_frame("set_auth_token", ["unauthorized_user_token"]))
            jobs = {}
            for sym, tf in wanted:
                cs = "cs_" + "".join(random.choices(string.ascii_lowercase, k=12))
                jobs[cs] = (sym, tf)
                res, count = TF[tf]
                await ws.send(_frame("chart_create_session", [cs, ""]))
                await ws.send(_frame("resolve_symbol", [cs, "sym", '={"symbol":"%s","adjustment":"splits"}' % sym]))
                await ws.send(_frame("create_series", [cs, "s1", "s1", "sym", res, count, ""]))
            done: set[str] = set()
            end = time.monotonic() + seconds
            while len(done) < len(jobs) and time.monotonic() < end:
                raw = await asyncio.wait_for(ws.recv(), timeout=max(.5, end - time.monotonic()))
                for part in re.split(r"~m~\d+~m~", raw):
                    if not part:
                        continue
                    if part.startswith("~h~"):
                        await ws.send(f"~m~{len(part)}~m~{part}")
                        continue
                    try:
                        j = json.loads(part)
                    except ValueError:
                        continue
                    m, p = j.get("m"), j.get("p") or []
                    if not p or p[0] not in jobs:
                        continue
                    if m == "timescale_update":
                        rows = ((p[1] or {}).get("s1") or {}).get("s") or []
                        out[jobs[p[0]]] = [tuple(float(x) for x in (list(r["v"]) + [0])[:6]) for r in rows if len(r.get("v", [])) >= 5]
                    elif m in ("series_completed", "symbol_error", "series_error", "critical_error"):
                        if m != "series_completed":
                            log.info("tradingview %s: %s", m, jobs[p[0]])
                        done.add(p[0])
    except Exception as exc:  # the caller falls back to Yahoo for what is missing
        log.info("tradingview feed: %s", type(exc).__name__)
    return out


# ------------------------------------------------------------------ candles: Yahoo, when the feed fails
YAHOO = {"M5": ("5m", "5d"), "M15": ("15m", "10d"), "H1": ("60m", "1mo"), "H4": ("60m", "3mo"), "D1": ("1d", "1y")}


async def yahoo_candles(client: httpx.AsyncClient, sym: str, tf: str) -> list[tuple]:
    if not sym:
        return []
    interval, rng = YAHOO[tf]
    try:
        r = await client.get(f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}", params={"range": rng, "interval": interval}, timeout=12)
        res = r.json()["chart"]["result"][0]
        q = res["indicators"]["quote"][0]
        rows = [(float(t), o, h, low, c, float(v or 0)) for t, o, h, low, c, v in zip(res["timestamp"], q["open"], q["high"], q["low"], q["close"], q.get("volume") or [0] * len(q["close"]))
                if None not in (o, h, low, c)]
    except Exception:
        return []
    if tf == "H4":   # four hours from the hourly candles, on the UTC grid
        out: list[tuple] = []
        for row in rows:
            b = row[0] - row[0] % 14400
            if out and out[-1][0] == b:
                t0, o, h, low, _, v = out[-1]
                out[-1] = (t0, o, max(h, row[2]), min(low, row[3]), row[4], v + row[5])
            else:
                out.append((b, row[1], row[2], row[3], row[4], row[5]))
        rows = out
    return rows


class CandleStore:
    """The candles of every (instrument, timeframe), refreshed no more often than the timeframe needs."""
    EVERY = {"M5": 55, "M15": 55, "H1": 240, "H4": 600, "D1": 1500}

    def __init__(self):
        self.data: dict[tuple[str, str], list[tuple]] = {}
        self.at: dict[tuple[str, str], float] = {}
        self.source: dict[str, str] = {}

    def due(self, ids: list[str], force: bool = False) -> list[tuple[str, str]]:
        now = time.time()
        return [(i, tf) for i in ids for tf in BY_ID[i].get("tfs", TF) if force or now - self.at.get((i, tf), 0) >= self.EVERY[tf]]

    async def refresh(self, ids: list[str], force: bool = False) -> int:
        need = self.due(ids, force)
        if not need:
            return 0
        got = await tv_candles([(BY_ID[i]["tv"], tf) for i, tf in need])
        missing = []
        for i, tf in need:
            rows = got.get((BY_ID[i]["tv"], tf))
            if rows and len(rows) > 20:
                self.data[(i, tf)], self.at[(i, tf)], self.source[i] = rows, time.time(), "TradingView · " + BY_ID[i]["tv"]
            else:
                missing.append((i, tf))
        if missing:
            async with httpx.AsyncClient(headers=UA) as client:
                rows = await asyncio.gather(*(yahoo_candles(client, BY_ID[i]["yahoo"], tf) for i, tf in missing))
            for (i, tf), r in zip(missing, rows):
                if r:
                    self.data[(i, tf)], self.at[(i, tf)], self.source[i] = r, time.time(), "Yahoo · " + BY_ID[i]["yahoo"]
                else:
                    self.at[(i, tf)] = time.time() - self.EVERY[tf] + 30   # try again in half a minute
        return len(need)

    def get(self, i: str, tf: str) -> list[tuple]:
        return self.data.get((i, tf), [])


def split_live(rows: list[tuple], tf: str, now: float | None = None) -> tuple[list[tuple], tuple | None]:
    """The closed candles and the one still forming (None when the last one is already closed: a closed market)."""
    if not rows:
        return [], None
    now = now or time.time()
    if rows[-1][0] + TF_SECONDS[tf] > now:
        return rows[:-1], rows[-1]
    return rows, None


# ------------------------------------------------------------------ the economic calendar
CCY = {"US": "USD", "EU": "EUR", "DE": "EUR", "GB": "GBP", "JP": "JPY", "CN": "CNY", "CH": "CHF", "CA": "CAD"}
TITLES_PT = [(r"Non Farm Payrolls", "Payroll (NFP)"), (r"Unemployment Rate", "Taxa de desemprego"), (r"Core Inflation Rate", "Inflação subjacente"),
             (r"Inflation Rate", "Inflação"), (r"Interest Rate Decision", "Decisão de juros"), (r"GDP Growth Rate", "Crescimento do PIB"),
             (r"Retail Sales", "Vendas a retalho"), (r"Fed .*Speech", "Discurso da Fed"), (r"ECB .*Speech", "Discurso do BCE"),
             (r"FOMC Minutes", "Atas do FOMC"), (r"PPI", "Preços no produtor (PPI)"), (r"CPI", "Preços no consumidor (CPI)"),
             (r"Initial Jobless Claims", "Pedidos de subsídio de desemprego"), (r"ISM Manufacturing PMI", "ISM indústria"),
             (r"ISM Services PMI", "ISM serviços"), (r"Michigan Consumer Sentiment", "Confiança do consumidor (Michigan)"),
             (r"ADP Employment Change", "Emprego ADP"), (r"JOLTs", "Ofertas de emprego (JOLTS)"), (r"PCE", "Preços PCE")]


async def calendar(client: httpx.AsyncClient, now: datetime) -> list[dict]:
    try:
        r = await client.get("https://economic-calendar.tradingview.com/events", headers=TV_HEAD, timeout=12, params={
            "from": (now - timedelta(hours=20)).strftime("%Y-%m-%dT%H:%M:%S.000Z"),
            "to": (now + timedelta(days=4)).strftime("%Y-%m-%dT%H:%M:%S.000Z"),
            "countries": ",".join(CCY)})
        rows = r.json().get("result") or []
    except Exception:
        return []
    out = []
    for e in rows:
        title = e.get("title") or ""
        imp = {1: 3, 0: 2}.get(e.get("importance"), 1)
        out.append({"id": str(e.get("id")), "t": e.get("date"), "title": title, "pt": next((pt for rx, pt in TITLES_PT if re.search(rx, title)), ""),
                    "country": e.get("country"), "ccy": e.get("currency") or CCY.get(e.get("country"), ""), "imp": imp,
                    "actual": e.get("actual"), "forecast": e.get("forecast"), "previous": e.get("previous"),
                    "unit": e.get("unit") or "", "scale": e.get("scale") or "", "period": e.get("period") or ""})
    out.sort(key=lambda e: e["t"] or "")
    return out


# ------------------------------------------------------------------ headlines
async def headlines(client: httpx.AsyncClient) -> list[dict]:
    async def one(inst: dict) -> list[dict]:
        try:
            r = await client.get("https://news-headlines.tradingview.com/v2/view/headlines/symbol", headers=TV_HEAD, timeout=10,
                                 params={"client": "web", "lang": "en", "symbol": inst["news"]})
            return [{**x, "_for": inst["id"]} for x in (r.json().get("items") or [])]
        except Exception:
            return []
    rows = [x for part in await asyncio.gather(*(one(i) for i in INSTRUMENTS)) for x in part]
    by_id: dict[str, dict] = {}
    for x in rows:
        k = x.get("id") or x.get("title")
        item = by_id.setdefault(k, {"id": k, "title": x.get("title", ""), "source": x.get("source") or x.get("provider") or "",
                                    "t": x.get("published") or 0, "urgent": x.get("urgency") == 1, "for": [],
                                    "url": ("https://www.tradingview.com" + x["storyPath"]) if str(x.get("storyPath", "")).startswith("/") else (x.get("link") or "")})
        if x["_for"] not in item["for"]:
            item["for"].append(x["_for"])
    out = sorted(by_id.values(), key=lambda x: -x["t"])
    return out[:60]
