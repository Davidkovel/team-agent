"""Mercados: the trading page of the Hub (frontend/hub/mercados.js).

What the page shows comes from three places, none of which needs a key:
- TradingView: the price, the day's move, the technical rating and every indicator of any symbol it has
  (scanner.tradingview.com), the movers of the day, and the news (news-headlines.tradingview.com). The charts, heatmaps,
  screener and economic calendar are TradingView's own widgets, put in the page by the frontend.
- SEC EDGAR: what company insiders buy and sell (Form 4) and what the big investors hold each quarter (13F).
- Yahoo Finance and Binance: daily candles for the strategy tests (TradingView gives no history without an account).

The page is built around what the team trades (FOCUS: gold, EUR/USD, GER40, GBP/USD; Marco, 9 Oct). Its news are in
Portuguese and only about those four (`feed`: Reuters through TradingView's Portuguese desk, with its three-point summary and
the whole text, and Investing.com Brasil, with its photos), and its diary is ForexFactory's week (`calendar`).

Each person keeps a watchlist, price alerts and investors to follow (MarketItem), and a paper-trading account with
80 000 virtual dollars (PaperTrade). The real Hub of a PC watches its own person's alerts and investors in `loop()` and
rings a notification when one fires. "Pergunta ao Claude" is a question for the asker's own agent, with the market data
gathered here as its only source (the Hub holds no AI, see ai.py). Symbols are TradingView ids: "NASDAQ:AAPL".
"""
import asyncio
import bisect
import html
import logging
import re
import time
import unicodedata
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from typing import Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import sync
from ..db import SessionLocal, get_db
from ..models import AIRequest, MarketItem, PaperTrade, User
from ..realtime import rt
from ..security import current_user
from ..services import iso, notify
from .ai import agent_connected, request_out
from .markets import UA, cached

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/trading")

TV_HEAD = {**UA, "Origin": "https://www.tradingview.com", "Referer": "https://www.tradingview.com/"}
# The SEC asks every program to say who it is (www.sec.gov/os/accessing-edgar-data) and to stay under 10 requests a second.
SEC_HEAD = {"User-Agent": "AgenteAMG hub@baredesk.store", "Accept-Encoding": "gzip, deflate"}
_sec_gate = asyncio.Semaphore(4)

START_CASH = 80_000.0
# What the team trades (Marco, 9 Oct): the page is built around these four. (topic, symbol, code, name, news symbol): the
# DAX's news hang on the index, not on the CFD that is traded as GER40.
FOCUS = [("gold", "OANDA:XAUUSD", "XAU/USD", "Ouro", "OANDA:XAUUSD"),
         ("eurusd", "FX:EURUSD", "EUR/USD", "Euro · Dólar", "FX:EURUSD"),
         ("ger40", "OANDA:DE30EUR", "GER40", "DAX · Alemanha", "XETR:DAX"),
         ("gbpusd", "FX:GBPUSD", "GBP/USD", "Libra · Dólar", "FX:GBPUSD")]
DEFAULT_WATCH = [(symbol, code) for _, symbol, code, _, _ in FOCUS]
# The strip on top of the page: the market at a glance.
PULSE = [("SP:SPX", "S&P 500"), ("NASDAQ:NDX", "Nasdaq 100"), ("DJ:DJI", "Dow Jones"), ("XETR:DAX", "DAX"),
         ("TVC:VIX", "VIX"), ("TVC:DXY", "Dólar (DXY)"), ("OANDA:XAUUSD", "Ouro"), ("NYMEX:CL1!", "Petróleo"),
         ("BINANCE:BTCUSDT", "Bitcoin"), ("BINANCE:ETHUSDT", "Ethereum"), ("FX:EURUSD", "EUR/USD"), ("TVC:US10Y", "Juro EUA 10a")]
# Investors whose 13F everyone knows. The CIK is the SEC's own number of the firm that files.
INVESTORS = [("1067983", "Warren Buffett", "Berkshire Hathaway"), ("1336528", "Bill Ackman", "Pershing Square"),
             ("1649339", "Michael Burry", "Scion Asset Management"), ("1697748", "Cathie Wood", "ARK Invest"),
             ("1350694", "Ray Dalio", "Bridgewater Associates"), ("1536411", "Stanley Druckenmiller", "Duquesne Family Office"),
             ("1656456", "David Tepper", "Appaloosa"), ("1029160", "George Soros", "Soros Fund Management"),
             ("1061768", "Seth Klarman", "Baupost Group"), ("1709323", "Li Lu", "Himalaya Capital"),
             ("1040273", "Dan Loeb", "Third Point"), ("1037389", "Jim Simons", "Renaissance Technologies")]

QUOTE = ["close", "change", "change_abs", "volume", "description", "currency", "logoid", "type", "exchange",
         "Recommend.All", "RSI", "high", "low", "Perf.W", "Perf.1M", "Perf.YTD", "market_cap_basic"]
DETAIL = QUOTE + ["open", "Recommend.MA", "Recommend.Other", "Recommend.All|60", "Recommend.All|240", "Recommend.All|1W",
                  "Stoch.K", "Stoch.D", "MACD.macd", "MACD.signal", "ADX", "CCI20", "AO", "Mom", "W.R", "BBPower", "UO",
                  "EMA10", "SMA10", "EMA20", "SMA20", "EMA50", "SMA50", "EMA100", "SMA100", "EMA200", "SMA200",
                  "Ichimoku.BLine", "VWMA", "HullMA9", "Pivot.M.Classic.Middle", "Pivot.M.Classic.R1", "Pivot.M.Classic.R2",
                  "Pivot.M.Classic.R3", "Pivot.M.Classic.S1", "Pivot.M.Classic.S2", "Pivot.M.Classic.S3", "ATR", "Volatility.D",
                  "Perf.3M", "Perf.6M", "Perf.Y", "price_52_week_high", "price_52_week_low", "price_earnings_ttm",
                  "earnings_per_share_basic_ttm", "dividend_yield_recent", "beta_1_year", "sector", "industry",
                  "average_volume_10d_calc", "relative_volume_10d_calc", "earnings_release_next_date", "number_of_employees"]

US_EXCH = {"NASDAQ", "NYSE", "AMEX", "CBOE", "OTC", "BATS", "NYSEARCA", "ARCA"}
CRYPTO_EXCH = {"BINANCE", "COINBASE", "BYBIT", "KRAKEN", "BITSTAMP", "OKX", "BITFINEX", "KUCOIN", "CRYPTO", "GEMINI", "MEXC",
               "BITGET", "GATEIO", "CRYPTOCAP"}
FX_EXCH = {"FX", "OANDA", "FX_IDC", "FOREXCOM", "SAXO", "PEPPERSTONE", "ICMARKETS", "FXCM", "CAPITALCOM"}
STABLE = {"USD", "USDT", "USDC", "BUSD", "DAI", "FDUSD", "TUSD"}


def clean(symbol: str) -> str:
    s = (symbol or "").strip().upper()
    if not re.fullmatch(r"[A-Z0-9_.!&-]{1,20}:[A-Z0-9_.!&/-]{1,30}", s):
        raise HTTPException(422, "Símbolo inválido: usa o formato do TradingView, por exemplo NASDAQ:AAPL")
    return s


def logo(d: dict, symbol: str) -> str:
    if d.get("logoid"):
        return f"https://s3-symbol-logo.tradingview.com/{d['logoid']}.svg"
    exch, sym = symbol.split(":", 1)
    if exch in CRYPTO_EXCH:  # TradingView names a coin's logo after the coin, without the pair
        base = re.sub(r"(USDT|USDC|USD|EUR|BUSD|FDUSD|PERP|\.P)+$", "", sym)
        return f"https://s3-symbol-logo.tradingview.com/crypto/XTVC{base}.svg" if base else ""
    return ""


def rating(v) -> str | None:
    """TradingView's own words for its technical rating, from -1 (sell everything) to 1 (buy everything)."""
    if v is None:
        return None
    return "strong_buy" if v > 0.5 else "buy" if v > 0.1 else "neutral" if v >= -0.1 else "sell" if v >= -0.5 else "strong_sell"


def quote_out(symbol: str, d: dict | None, name: str = "") -> dict:
    if not d or d.get("close") is None:
        return {"symbol": symbol, "name": name or symbol.split(":", 1)[1], "missing": True}
    return {"symbol": symbol, "name": name or d.get("description") or symbol, "full_name": d.get("description") or "",
            "price": d["close"], "change_pct": d.get("change"), "change": d.get("change_abs"), "currency": d.get("currency") or "",
            "logo": logo(d, symbol), "rating": rating(d.get("Recommend.All")), "rec": d.get("Recommend.All"),
            "rsi": d.get("RSI"), "volume": d.get("volume"), "high": d.get("high"), "low": d.get("low"),
            "perf_w": d.get("Perf.W"), "perf_m": d.get("Perf.1M"), "perf_ytd": d.get("Perf.YTD"),
            "mcap": d.get("market_cap_basic"), "type": d.get("type") or "", "exchange": d.get("exchange") or symbol.split(":")[0]}


async def viewer(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)) -> User:
    """The signed-in person, with the database let go at once. On SQLite every transaction takes the write lock up front
    (db.py), and these endpoints then wait seconds on TradingView or the SEC: holding it meanwhile locks the whole Hub."""
    await db.commit()
    return user


# ---------------------------------------------------------------- TradingView

async def tv_scan(tickers: list[str], fields: list[str] = QUOTE, seconds: int = 15) -> dict[str, dict]:
    """{symbol: {field: value}} for up to 100 symbols, from TradingView's scanner (the same one its screener uses)."""
    tickers = [t for t in dict.fromkeys(tickers) if t and ":" in t][:100]
    if not tickers:
        return {}

    async def make():
        async with httpx.AsyncClient(headers=TV_HEAD) as client:
            r = await client.post("https://scanner.tradingview.com/global/scan", timeout=12,
                                  json={"symbols": {"tickers": tickers}, "columns": fields})
            r.raise_for_status()
            return {row["s"]: dict(zip(fields, row["d"])) for row in r.json().get("data", [])}
    return await cached(f"tvs:{len(fields)}:" + ",".join(sorted(tickers)), seconds, make)


async def tv_symbol(symbol: str) -> dict:
    async def make():
        async with httpx.AsyncClient(headers=TV_HEAD) as client:
            r = await client.get("https://scanner.tradingview.com/symbol", timeout=12,
                                 params={"symbol": symbol, "fields": ",".join(DETAIL), "no_404": "true"})
            r.raise_for_status()
            return r.json() or {}
    return await cached("tvd:" + symbol, 15, make)


async def quotes(symbols: list[tuple[str, str]]) -> list[dict]:
    try:
        found = await tv_scan([s for s, _ in symbols])
    except (httpx.HTTPError, ValueError) as exc:
        log.info("TradingView scanner: %s", exc)
        found = {}
    return [quote_out(s, found.get(s), n) for s, n in symbols]


def _news_item(x: dict) -> dict:
    path = x.get("storyPath") or ""
    provider = x.get("provider")
    return {"id": x.get("id"), "title": x.get("title") or "", "source": x.get("source") or (provider.get("name") if isinstance(provider, dict) else provider) or "",
            "ts": x.get("published") or 0, "at": iso(datetime.fromtimestamp(x.get("published") or 0, timezone.utc)),
            "urgent": x.get("urgency") == 1, "url": ("https://www.tradingview.com" + path) if path.startswith("/") else (x.get("link") or ""),
            "symbols": [s.get("symbol") for s in (x.get("relatedSymbols") or []) if s.get("symbol")][:6]}


async def tv_news(category: str = "", symbol: str = "") -> list[dict]:
    async def make():
        async with httpx.AsyncClient(headers=TV_HEAD) as client:
            if symbol:
                r = await client.get("https://news-headlines.tradingview.com/v2/view/headlines/symbol", timeout=10,
                                     params={"client": "web", "lang": "en", "symbol": symbol})
            else:
                params = {"client": "web", "lang": "en", "streaming": "false"}
                if category:
                    params["category"] = category
                r = await client.get("https://news-headlines.tradingview.com/v2/headlines", params=params, timeout=10)
            r.raise_for_status()
            return [_news_item(x) for x in r.json().get("items", [])]
    return await cached(f"news:{category}:{symbol}", 60 if not symbol else 120, make)


async def focus_quotes() -> list[dict]:
    """The team's four, with the rating on the hour and the four hours next to the day's."""
    fields = QUOTE + ["Recommend.All|60", "Recommend.All|240"]
    try:
        found = await tv_scan([f[1] for f in FOCUS], fields)
    except (httpx.HTTPError, ValueError) as exc:
        log.info("TradingView scanner: %s", exc)
        found = {}
    out = []
    for topic, symbol, code, name, _ in FOCUS:
        d = found.get(symbol)
        q = {**quote_out(symbol, d, code), "topic": topic, "code": code, "label": name}
        if d:
            q.update(r1h=rating(d.get("Recommend.All|60")), r4h=rating(d.get("Recommend.All|240")))
        out.append(q)
    return out


# ---------------------------------------------------------------- news in Portuguese about our four
# Marco (9 Oct): the English one-liners were hard to read. Two Portuguese desks, merged: Reuters through TradingView (a
# three-point summary and the whole text, read inside the Hub) and Investing.com Brasil (a photo for each). Both are
# written in Brazil, so Brazil's own news is left out, and so is anything that does not touch gold, the euro, the DAX,
# the pound or the dollar.
BROWSER = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36"}
INVESTING = ("news_1", "news_11", "news_14", "news_95")  # câmbio, commodities, economia, indicadores (pt.investing.com stopped in 2023)
TOPICS = ("gold", "eurusd", "ger40", "gbpusd", "usd")
TOPIC_WORDS = {
    "gold": r"\bouro\b|\bxau|metais preciosos|metal precioso",
    "eurusd": r"\beuros?\b|eur/usd|\bbce\b|banco central europeu|lagarde|zona do euro|zona euro",
    "ger40": r"\bdax\b|alemanh|\balema(o|es|s)?\b|frankfurt|ger ?40|bundesbank|stoxx|(acoes|bolsas|mercados|indices) europe",
    "gbpusd": r"\blibras?\b|\bgbp|esterlina|banco da inglaterra|\bboe\b|bailey|reino unido|britanic|\bftse\b|bolsa de londres",
    "usd": r"\bfed\b|federal reserve|powell|\bfomc\b|payroll|treasur|\bdolar\b|\bdxy\b|\bcpi\b|\bpce\b|"
           r"\b(juros|inflacao|empregos?|desemprego|economia|pib|consumidor) (nos|dos) (eua|estados unidos)\b|"
           r"\b(juros|inflacao|economia) american|\beua\b.{0,40}\b(inflacao|juros|empregos?|desemprego|pib)\b",
}
OTHER_DOLLARS = r"dolar (canadense|australiano|neozelandes|de hong kong|de singapura|taiwanes)"
ELSEWHERE = (r"ibovespa|\bb3\b|r\$|\blula\b|bolsonaro|copom|selic|petrobras|brasil|haddad|galipolo|\bipca\b|"
             r"\b(o|do|ao|no) real\b|argentin|milei|\bmexic|\bpeso (mexicano|argentino|chileno|colombiano)")


def plain(text: str) -> str:
    """Lower case without accents, so one pattern finds «alemã» and «alema»."""
    return "".join(c for c in unicodedata.normalize("NFKD", (text or "").lower()) if not unicodedata.combining(c))


def topics_of(text: str, given: tuple[str, ...] = ()) -> list[str]:
    """Which of our markets a headline is about. Empty = not ours (Brazil's own news always is not)."""
    t = plain(text)
    if re.search(ELSEWHERE, t):
        return []
    found = set(given)
    for topic, words in TOPIC_WORDS.items():
        if re.search(words, re.sub(OTHER_DOLLARS, "", t) if topic == "usd" else t):
            found.add(topic)
    return [k for k in TOPICS if k in found]


def words_of(title: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]+", plain(title)) if len(w) > 3}


def same_story(a: dict, b: dict) -> bool:
    """The same story told twice: Investing Brasil republishes Reuters, and Reuters rewrites its headline as the day goes
    («Ações europeias têm ganho…», then «Ações europeias registram ganho…»). Most words shared, a few hours apart."""
    wa, wb = a["words"], b["words"]
    return bool(wa and wb) and abs(a["ts"] - b["ts"]) < 10 * 3600 and len(wa & wb) / len(wa | wb) >= 0.45


def _ast_text(node) -> str:
    if isinstance(node, str):
        return node
    if not isinstance(node, dict):
        return ""
    if node.get("type") == "symbol":
        return (node.get("params") or {}).get("text", "").split(":")[-1]
    return "".join(_ast_text(c) for c in node.get("children") or [])


def story_parts(s: dict) -> dict:
    """A TradingView story as plain text: its summary points and its paragraphs (the byline left out)."""
    paras = [re.sub(r"\s+", " ", _ast_text(p)).strip() for p in ((s.get("astDescription") or {}).get("children") or [])]
    paras = [p for p in paras if p]
    if paras and re.match(r"^(Por|Reportagem de|By) [^.]{0,90}$", paras[0]):
        paras = paras[1:]
    bullets = []

    def walk(n):
        if isinstance(n, dict):
            if n.get("type") == "*":
                bullets.append(re.sub(r"\s+", " ", _ast_text(n)).strip())
                return
            for c in n.get("children") or []:
                walk(c)
    walk(s.get("summary"))
    return {"bullets": [b for b in bullets if b][:4], "paragraphs": paras, "read_min": max(1, round((s.get("read_time") or 0) / 60)) if s.get("read_time") else None}


_stories: dict[str, tuple[float, dict]] = {}


async def tv_story(client: httpx.AsyncClient, story_id: str) -> dict:
    hit = _stories.get(story_id)
    if hit and time.time() - hit[0] < 6 * 3600:
        return hit[1]
    r = await client.get("https://news-headlines.tradingview.com/v3/story", params={"id": story_id, "lang": "pt"}, timeout=10)
    r.raise_for_status()
    s = r.json()
    provider = s.get("provider")
    out = {"title": html.unescape(s.get("title") or ""), "source": s.get("source") or (provider.get("name") if isinstance(provider, dict) else provider) or "",
           "ts": s.get("published") or 0, **story_parts(s)}
    if len(_stories) > 600:  # a few days of stories; the rest is fetched again if anybody opens it
        _stories.clear()
    _stories[story_id] = (time.time(), out)
    return out


async def _investing_feed(client: httpx.AsyncClient, feed: str) -> list[dict]:
    r = await client.get(f"https://br.investing.com/rss/{feed}.rss", timeout=10)
    r.raise_for_status()
    out = []
    for it in ET.fromstring(r.content).iter("item"):
        title = html.unescape((it.findtext("title") or "").strip())
        try:  # Investing writes UTC as "2026-10-09 17:49:19"
            when = datetime.strptime((it.findtext("pubDate") or "").strip(), "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
        except ValueError:
            continue
        enc = it.find("enclosure")
        out.append({"id": "inv:" + (it.findtext("link") or title)[-90:], "title": title, "source": (it.findtext("author") or "Investing.com").strip(),
                    "ts": int(when.timestamp()), "url": (it.findtext("link") or "").strip(), "image": enc.get("url") if enc is not None else "",
                    "topics": topics_of(title), "story": False})
    return out


async def _tv_pt(client: httpx.AsyncClient, symbol: str = "", category: str = "", topic: str = "") -> list[dict]:
    params = {"client": "web", "lang": "pt"}
    if symbol:
        r = await client.get("https://news-headlines.tradingview.com/v2/view/headlines/symbol", params={**params, "symbol": symbol}, timeout=10)
    else:
        r = await client.get("https://news-headlines.tradingview.com/v2/headlines", params={**params, "streaming": "false", "category": category}, timeout=10)
    r.raise_for_status()
    out = []
    for x in r.json().get("items", []):
        title = re.sub(r"\s+", " ", html.unescape(x.get("title") or "")).strip()
        path = x.get("storyPath") or ""
        out.append({"id": x.get("id") or "", "title": title, "source": x.get("source") or "Reuters", "ts": x.get("published") or 0,
                    "url": "https://br.tradingview.com" + path if path.startswith("/") else x.get("link") or "", "image": "",
                    "topics": topics_of(title, (topic,) if topic else ()), "story": x.get("permission") != "preview" and bool(x.get("id"))})
    return out


async def news_feed() -> list[dict]:
    """The news about our four, newest first, from the last five days: one card per story."""
    async def make():
        async with httpx.AsyncClient(headers=BROWSER, follow_redirects=True) as inv, httpx.AsyncClient(headers=TV_HEAD) as tv:
            jobs = [_investing_feed(inv, f) for f in INVESTING]
            jobs += [_tv_pt(tv, symbol=news, topic=topic) for topic, _, _, _, news in FOCUS]
            jobs += [_tv_pt(tv, category=c) for c in ("forex", "economic", "index", "futures")]
            lists = await asyncio.gather(*jobs, return_exceptions=True)
            since = time.time() - 5 * 86400
            fresh = []
            for lst in lists:
                if isinstance(lst, BaseException):
                    log.info("Mercados, notícias: %s", lst)
                    continue
                fresh += [{**x, "words": words_of(x["title"])} for x in lst if x["ts"] >= since and x["topics"]]
            merged: list[dict] = []
            for x in sorted(fresh, key=lambda x: (-x["ts"], not x["story"])):
                have = next((m for m in merged if same_story(m, x)), None)
                if not have:
                    merged.append(x)
                    continue
                have["topics"] = [k for k in TOPICS if k in set(have["topics"]) | set(x["topics"])]
                have["image"] = have["image"] or x["image"]
                if x["story"] and not have["story"]:  # the Reuters copy can be read in the Hub: keep its id and link
                    have.update(id=x["id"], url=x["url"], story=True, source=x["source"])
            for x in merged:
                del x["words"]
            items = merged[:80]
            gate = asyncio.Semaphore(6)

            async def summary(x):
                async with gate:
                    try:
                        s = await tv_story(tv, x["id"])
                    except (httpx.HTTPError, ValueError):
                        return
                    x.update(bullets=s["bullets"], lead=s["paragraphs"][0] if s["paragraphs"] else "", read_min=s["read_min"])
            await asyncio.gather(*(summary(x) for x in items if x["story"]))  # each story is fetched once, then kept
            for x in items:
                x["at"] = iso(datetime.fromtimestamp(x["ts"], timezone.utc))
                x.setdefault("bullets", [])
                x.setdefault("lead", "")
                x.setdefault("read_min", None)
            return items
    return await cached("feed:pt", 300, make)


# ---------------------------------------------------------------- the week's diary (ForexFactory), in Portuguese
# Only what moves our four: the dollar, the euro and the pound, high and medium impact. The free JSON is the week of
# ForexFactory's own calendar, refreshed by them every hour.
CAL_WHO = {"Fed Chair Powell": "Powell, presidente da Fed", "ECB President Lagarde": "Lagarde, presidente do BCE",
           "BOE Gov Bailey": "Bailey, governador do Banco de Inglaterra", "President Trump": "o presidente Trump"}
CAL_WHAT = [  # (English, Portuguese), the longest first: "Core CPI" must win over "CPI"
    ("Non-Farm Employment Change", "Payroll: empregos criados"), ("ADP Non-Farm Employment Change", "Empregos no privado (ADP)"),
    ("Unemployment Claims", "Pedidos de subsídio de desemprego"), ("Unemployment Rate", "Taxa de desemprego"),
    ("Claimant Count Change", "Novos pedidos de subsídio"), ("Average Hourly Earnings", "Salário médio por hora"),
    ("Average Earnings Index 3m/y", "Salários (3 meses)"), ("JOLTS Job Openings", "Ofertas de emprego (JOLTS)"),
    ("Core CPI", "Inflação core (CPI)"), ("CPI", "Inflação (CPI)"), ("Core PCE Price Index", "Inflação core (PCE)"),
    ("PCE Price Index", "Inflação (PCE)"), ("Core PPI", "Preços no produtor core (PPI)"), ("PPI", "Preços no produtor (PPI)"),
    ("Core Retail Sales", "Vendas a retalho core"), ("Retail Sales", "Vendas a retalho"), ("GDP", "PIB"),
    ("Federal Funds Rate", "Decisão de juros da Fed"), ("FOMC Statement", "Comunicado da Fed"),
    ("FOMC Press Conference", "Conferência de imprensa da Fed"), ("FOMC Meeting Minutes", "Atas da reunião da Fed"),
    ("FOMC Economic Projections", "Projeções da Fed"), ("Main Refinancing Rate", "Decisão de juros do BCE"),
    ("Monetary Policy Statement", "Comunicado de política monetária"), ("ECB Press Conference", "Conferência de imprensa do BCE"),
    ("Official Bank Rate", "Decisão de juros do Banco de Inglaterra"), ("MPC Official Bank Rate Votes", "Votos do Banco de Inglaterra"),
    ("ISM Manufacturing PMI", "ISM indústria"), ("ISM Services PMI", "ISM serviços"), ("Manufacturing PMI", "PMI indústria"),
    ("Services PMI", "PMI serviços"), ("ifo Business Climate", "Clima de negócios Ifo"), ("ZEW Economic Sentiment", "Confiança ZEW"),
    ("UoM Consumer Sentiment", "Confiança do consumidor (Michigan)"), ("UoM Inflation Expectations", "Inflação esperada (Michigan)"),
    ("CB Consumer Confidence", "Confiança do consumidor"), ("Durable Goods Orders", "Encomendas de bens duradouros"),
    ("Empire State Manufacturing Index", "Indústria de Nova Iorque"), ("Philly Fed Manufacturing Index", "Indústria de Filadélfia"),
    ("Trade Balance", "Balança comercial"), ("Crude Oil Inventories", "Reservas de petróleo"), ("Bank Holiday", "Feriado"),
    ("Industrial Production", "Produção industrial"), ("Building Permits", "Licenças de construção"),
    ("Existing Home Sales", "Venda de casas usadas"), ("New Home Sales", "Venda de casas novas"), ("Housing Starts", "Obras de casas novas"),
]
CAL_WHEN = {"Flash": "preliminar", "Prelim": "preliminar", "Advance": "1.ª estimativa", "Final": "final", "Revised": "revisto"}
CAL_PERIOD = {"m/m": "do mês", "q/q": "do trimestre", "y/y": "do ano"}
CAL_LAND = {"German": "Alemanha", "French": "França", "Italian": "Itália", "Spanish": "Espanha"}


def calendar_title(title: str) -> str:
    """ForexFactory's English event name in plain Portuguese; an event it does not know keeps its own name."""
    t = title.strip()
    m = re.fullmatch(r"(.+?) Speaks", t)
    if m:
        who = m.group(1)
        who = CAL_WHO.get(who) or re.sub(r"^FOMC Member (.+)$", r"\1, da Fed", re.sub(r"^ECB (?:Member|Vice President) (.+)$", r"\1, do BCE",
                                                                                     re.sub(r"^MPC Member (.+)$", r"\1, do Banco de Inglaterra", who)))
        return f"Discurso: {who}"
    land = when = period = ""
    first = t.split(" ", 1)
    if first[0] in CAL_LAND and len(first) > 1:
        land, t = CAL_LAND[first[0]], first[1]
    first = t.split(" ", 1)
    if first[0] in CAL_WHEN and len(first) > 1:
        when, t = CAL_WHEN[first[0]], first[1]
    m = re.fullmatch(r"(.+?) (m/m|q/q|y/y)", t)
    if m:
        t, period = m.group(1), CAL_PERIOD[m.group(2)]
    for en, pt in sorted(CAL_WHAT, key=lambda p: -len(p[0])):
        if t == en:
            t = pt
            break
    else:
        return title
    words = " ".join(w for w in (t, period) if w) + (f" ({when})" if when else "")
    return f"{land} · {words}" if land else words


CAL_TOPICS = {"USD": ["gold", "eurusd", "gbpusd"], "EUR": ["eurusd", "ger40"], "GBP": ["gbpusd"]}


async def calendar() -> list[dict]:
    async def make():
        async with httpx.AsyncClient(headers=BROWSER) as client:
            r = await client.get("https://nfs.faireconomy.media/ff_calendar_thisweek.json", timeout=10)
            r.raise_for_status()
            rows = r.json()
        out = []
        for x in rows:
            if x.get("country") not in CAL_TOPICS or x.get("impact") not in ("High", "Medium"):
                continue
            try:
                when = datetime.fromisoformat(x["date"])
            except (KeyError, ValueError):
                continue
            out.append({"at": iso(when.astimezone(timezone.utc)), "ts": int(when.timestamp()), "currency": x["country"],
                        "impact": "high" if x["impact"] == "High" else "medium", "title": calendar_title(x.get("title") or ""),
                        "title_en": x.get("title") or "", "forecast": x.get("forecast") or "", "previous": x.get("previous") or "",
                        "actual": x.get("actual") or "", "topics": CAL_TOPICS[x["country"]]})
        return sorted(out, key=lambda e: e["ts"])
    return await cached("calendar:ff", 1800, make)


# ---------------------------------------------------------------- SEC EDGAR

async def sec_get(client: httpx.AsyncClient, url: str) -> httpx.Response:
    async with _sec_gate:
        r = await client.get(url, timeout=20)
        await asyncio.sleep(0.15)
    r.raise_for_status()
    return r


def sec_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(headers=SEC_HEAD, follow_redirects=True)


def _norm(name: str) -> str:
    words = re.sub(r"[^A-Z0-9 ]", " ", re.sub(r"/.*$", "", (name or "").upper()).replace("'", "")).split()
    drop = {"INC", "CORP", "CORPORATION", "CO", "COMPANY", "LTD", "LIMITED", "PLC", "HOLDINGS", "HLDGS", "HOLDING", "THE", "COM",
            "CL", "CLASS", "NEW", "DEL", "DE", "GROUP", "GRP", "SA", "NV", "AG", "LLC", "LP", "ADR", "SPONSORED", "ORD", "SHS", "N", "V"}
    return " ".join(ABBR.get(w, w) for w in words if w not in drop)


# 13F names are cut short ("BANK OF AMER CORP", "OCCIDENTAL PETE CORP"); the SEC's list of tickers spells them out.
ABBR = {"AMER": "AMERICA", "PETE": "PETROLEUM", "INTL": "INTERNATIONAL", "FINL": "FINANCIAL", "SVCS": "SERVICES", "SYS": "SYSTEMS",
        "MTRS": "MOTORS", "HLTH": "HEALTH", "ENTMT": "ENTERTAINMENT", "PPTYS": "PROPERTIES", "NATL": "NATIONAL", "INDS": "INDUSTRIES",
        "MFG": "MANUFACTURING", "TECHNOLOGIES": "TECHNOLOGY", "TECH": "TECHNOLOGY", "COMMUNICATIONS": "COMMUNICATION",
        "PHARMACEUTICALS": "PHARMACEUTICAL", "SEMICONDUCTOR": "SEMICONDUCTORS", "LABS": "LABORATORIES", "MGMT": "MANAGEMENT",
        "SOLUTIONS": "SOLUTION", "BANCORPORATION": "BANCORP", "AMERN": "AMERICAN", "CMNTY": "COMMUNITY", "ENTERPRISES": "ENTERPRISE"}


def by_name(names: dict, name: str) -> str | None:
    """The ticker of a company named as in a 13F: the same name, else the shortest SEC name that starts with it."""
    key = _norm(name)
    if not key:
        return None
    for index, k in (("by_name", key), ("by_compact", key.replace(" ", "")), ("by_words", " ".join(sorted(key.split())))):
        if k in names[index]:
            return names[index][k]
    keys = names["sorted"]
    i = bisect.bisect_left(keys, key + " ")
    hits = []
    while i < len(keys) and keys[i].startswith(key + " ") and len(hits) < 20:
        hits.append(keys[i])
        i += 1
    return names["by_name"][min(hits, key=len)] if hits else None


async def sec_tickers() -> dict:
    """{"by_ticker": {TICKER: {cik, name, exchange}}, "by_name": {normalised name: TICKER}} from the SEC's own list."""
    async def make():
        async with sec_client() as client:
            data = (await sec_get(client, "https://www.sec.gov/files/company_tickers_exchange.json")).json()
        by_ticker, by_name, by_compact, by_words = {}, {}, {}, {}
        for cik, name, ticker, exchange in data.get("data", []):
            if not ticker:
                continue
            key = _norm(name)
            by_ticker.setdefault(ticker.upper(), {"cik": int(cik), "name": name, "exchange": exchange or ""})
            by_name.setdefault(key, ticker.upper())
            by_compact.setdefault(key.replace(" ", ""), ticker.upper())
            by_words.setdefault(" ".join(sorted(key.split())), ticker.upper())
        return {"by_ticker": by_ticker, "by_name": by_name, "by_compact": by_compact, "by_words": by_words, "sorted": sorted(by_name)}
    return await cached("sec:tickers:3", 12 * 3600, make)


SEC_TO_TV = {"Nasdaq": "NASDAQ", "NYSE": "NYSE", "CBOE": "CBOE", "OTC": "OTC"}


def tv_from_ticker(ticker: str, exchange: str) -> str:
    return f"{SEC_TO_TV.get(exchange, 'NYSE' if exchange else 'OTC')}:{ticker.replace('-', '.')}"


def sec_ticker(symbol: str) -> str | None:
    exch, sym = symbol.split(":", 1)
    return sym.replace(".", "-") if exch in US_EXCH else None


async def submissions(cik: int) -> dict:
    async def make():
        async with sec_client() as client:
            return (await sec_get(client, f"https://data.sec.gov/submissions/CIK{int(cik):010d}.json")).json()
    return await cached(f"sec:subs:{cik}", 600, make)


def _recent(subs: dict, forms: tuple[str, ...], limit: int) -> list[dict]:
    rec = subs.get("filings", {}).get("recent", {})
    out = []
    for i, form in enumerate(rec.get("form", [])):
        if form in forms:
            out.append({"form": form, "acc": rec["accessionNumber"][i], "filed": rec["filingDate"][i],
                        "period": (rec.get("reportDate") or [""] * (i + 1))[i]})
            if len(out) >= limit:
                break
    return out


def _strip_ns(root):
    for el in root.iter():
        if isinstance(el.tag, str) and "}" in el.tag:
            el.tag = el.tag.split("}", 1)[1]
    return root


def _num(el, path: str):
    text = el.findtext(path)
    try:
        return float(text.strip()) if text and text.strip() else None
    except ValueError:
        return None


CODES = {"P": "buy", "S": "sell", "A": "award", "M": "exercise", "X": "exercise", "F": "tax", "G": "gift", "D": "disposal",
         "C": "conversion", "J": "other", "W": "other", "I": "other"}


def parse_form4(text: str, acc: str) -> dict | None:
    """One insider filing: who (and their role), which company, and each trade in its shares (not the options)."""
    m = re.search(r"<XML>(.*?)</XML>", text, re.S | re.I)
    xml = (m.group(1) if m else text).strip()
    try:
        root = _strip_ns(ET.fromstring(xml))
    except ET.ParseError:
        return None
    if root.tag != "ownershipDocument":
        return None
    owners = root.findall("reportingOwner")
    owner = (owners[0].findtext("reportingOwnerId/rptOwnerName") or "").strip() if owners else ""
    rel = owners[0].find("reportingOwnerRelationship") if owners else None
    role = ""
    if rel is not None:
        flag = lambda tag: (rel.findtext(tag) or "").strip().lower() in ("1", "true")
        role = (rel.findtext("officerTitle") or "").strip() if flag("isOfficer") else ""
        role = role or ("Administrador" if flag("isDirector") else "Dono de mais de 10%" if flag("isTenPercentOwner") else "Outro")
    txs = []
    for t in root.iter("nonDerivativeTransaction"):
        code = (t.findtext("transactionCoding/transactionCode") or "").strip()
        shares, price = _num(t, "transactionAmounts/transactionShares/value"), _num(t, "transactionAmounts/transactionPricePerShare/value")
        txs.append({"date": (t.findtext("transactionDate/value") or "").strip()[:10], "code": code, "kind": CODES.get(code, "other"),
                    "shares": shares, "price": price, "value": shares * price if shares and price else None,
                    "acquired": (t.findtext("transactionAmounts/transactionAcquiredDisposedCode/value") or "").strip() == "A",
                    "after": _num(t, "postTransactionAmounts/sharesOwnedFollowingTransaction/value")})
    issuer = root.find("issuer")
    return {"acc": acc, "owner": owner.title() if owner.isupper() else owner, "others": max(0, len(owners) - 1), "role": role,
            "company": (issuer.findtext("issuerName") or "").strip() if issuer is not None else "",
            "ticker": (issuer.findtext("issuerTradingSymbol") or "").strip().upper() if issuer is not None else "",
            "cik": int((issuer.findtext("issuerCik") or "0").strip() or 0) if issuer is not None else 0, "txs": txs}


def summarise(f: dict, filed: str = "") -> dict:
    """A filing as one line: the open-market buys first (what insiders do with their own money), then the sales."""
    txs = f["txs"]
    for kind in ("buy", "sell"):
        mine = [t for t in txs if t["kind"] == kind and t["shares"]]
        if mine:
            break
    else:
        mine = [t for t in txs if t["shares"]][:1]
        kind = mine[0]["kind"] if mine else "other"
    shares = sum(t["shares"] for t in mine) if mine else None
    value = sum(t["value"] or 0 for t in mine) if mine else None
    after = mine[-1]["after"] if mine else None
    change = None
    if shares and after is not None:
        before = after - shares if kind == "buy" else after + shares
        change = shares / before * 100 if before > 0 else None
    ex = f["ticker"]
    return {"acc": f["acc"], "owner": f["owner"], "others": f["others"], "role": f["role"], "company": f["company"], "ticker": ex,
            "kind": kind, "shares": shares, "value": value or None, "price": (value / shares) if value and shares else None,
            "after": after, "change_pct": change, "date": max((t["date"] for t in mine), default="") or filed, "filed": filed,
            "url": f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={f['cik']}&type=4&owner=include" if f["cik"] else ""}


async def _filing_text(client: httpx.AsyncClient, cik: int, acc: str) -> str:
    return (await sec_get(client, f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{acc.replace('-', '')}/{acc}.txt")).text


async def company_insiders(symbol: str) -> dict:
    ticker = sec_ticker(symbol)
    if not ticker:
        return {"source": "not_connected", "reason": "A SEC só tem os insiders de empresas cotadas nos EUA.", "items": []}
    info = (await sec_tickers())["by_ticker"].get(ticker)
    if not info:
        return {"source": "not_connected", "reason": f"A SEC não conhece {ticker} (ETF, índice ou empresa estrangeira).", "items": []}

    async def make():
        filings = _recent(await submissions(info["cik"]), ("4",), 25)
        async with sec_client() as client:
            texts = await asyncio.gather(*(_filing_text(client, info["cik"], f["acc"]) for f in filings), return_exceptions=True)
        items = []
        for f, text in zip(filings, texts):
            parsed = parse_form4(text, f["acc"]) if isinstance(text, str) else None
            if parsed and parsed["txs"]:
                items.append(summarise(parsed, f["filed"]))
        return {"source": "live", "company": info["name"], "cik": info["cik"], "items": items}
    return await cached("sec:ins:" + ticker, 900, make)


OPENINSIDER = {"buys": "latest-insider-purchases-25k", "clusters": "latest-cluster-buys", "sales": "insider-sales-25k",
               "top": "top-insider-purchases-of-the-week"}


def _money(text: str) -> float | None:
    t = re.sub(r"[^0-9.\-]", "", text.replace("+", ""))
    try:
        return float(t) if t not in ("", "-", ".") else None
    except ValueError:
        return None


async def latest_insiders(view: str = "buys") -> dict:
    """The market's newest insider trades over 25 000 $, from OpenInsider (which reads the same SEC Form 4 filings, all of
    them, the moment they come in). "clusters" = several insiders of one company buying in the same days."""
    page = OPENINSIDER.get(view, OPENINSIDER["buys"])

    async def make():
        async with httpx.AsyncClient(headers=UA, follow_redirects=True) as client:
            r = await client.get(f"http://openinsider.com/{page}", timeout=15)
            r.raise_for_status()
        text = r.text
        i = text.find('class="tinytable"')
        table = text[i:text.find("</table>", i)] if i >= 0 else ""
        cell = lambda c: html.unescape(re.sub(r"<[^>]+>", "", c)).replace(" ", " ").strip()
        head = [cell(c) for c in re.findall(r"<th[^>]*>(.*?)</th>", table, re.S)]
        tickers = (await sec_tickers())["by_ticker"]
        items = []
        for row in re.findall(r"<tr[^>]*>(.*?)</tr>", table.split("</thead>")[-1], re.S):
            raw = re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)
            if len(raw) != len(head):
                continue
            d = dict(zip(head, (cell(c) for c in raw)))
            ticker_cell = raw[head.index("Ticker")]
            m = re.search(r'href="/([A-Z0-9.\-]+)"', ticker_cell)
            ticker = m.group(1) if m else d.get("Ticker", "")
            info = tickers.get(ticker.replace(".", "-"))
            kind = "buy" if d.get("Trade Type", "").startswith("P") else "sell" if d.get("Trade Type", "").startswith("S") else "other"
            delta = d.get("ΔOwn", "")
            items.append({"filed": d.get("Filing Date", ""), "date": d.get("Trade Date", ""), "ticker": ticker,
                          "symbol": tv_from_ticker(ticker.replace(".", "-"), info["exchange"]) if info else "",
                          "company": d.get("Company Name", ""), "owner": d.get("Insider Name", ""), "role": d.get("Title", ""),
                          "industry": d.get("Industry", ""), "insiders": int(d["Ins"]) if d.get("Ins", "").isdigit() else None,
                          "kind": kind, "type": d.get("Trade Type", ""), "price": _money(d.get("Price", "")),
                          "shares": abs(_money(d.get("Qty", "")) or 0) or None, "after": _money(d.get("Owned", "")),
                          "change_pct": None if delta in ("", "New") else _money(delta), "new": delta == "New",
                          "value": abs(_money(d.get("Value", "")) or 0) or None,
                          "url": f"http://openinsider.com/{ticker}" if ticker else ""})
        return {"source": "live", "via": "OpenInsider (SEC Form 4)", "view": view, "fetched_at": iso(datetime.now(timezone.utc)), "items": items}
    return await cached("oi:" + page, 600, make)


async def holdings(cik: int) -> dict:
    """A 13F: what the investor held at the end of the last quarter, and what changed from the quarter before."""
    async def make():
        subs = await submissions(cik)
        filings = _recent(subs, ("13F-HR",), 2)
        if not filings:
            return {"source": "not_connected", "reason": "Este investidor não tem 13F na SEC.", "name": subs.get("name", "")}
        quarters = []
        async with sec_client() as client:
            for f in filings:
                folder = f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{f['acc'].replace('-', '')}"
                files = (await sec_get(client, folder + "/index.json")).json()["directory"]["item"]
                table = next((x["name"] for x in files if x["name"].lower().endswith(".xml") and x["name"].lower() != "primary_doc.xml"), None)
                rows: dict[tuple, dict] = {}
                if table:
                    root = _strip_ns(ET.fromstring((await sec_get(client, f"{folder}/{table}")).content))
                    scale = 1000 if f["filed"] < "2023-01-03" else 1  # until 2023 the SEC asked for thousands of dollars
                    for it in root.iter("infoTable"):
                        key = ((it.findtext("cusip") or "").strip(), (it.findtext("putCall") or "").strip())
                        row = rows.setdefault(key, {"name": (it.findtext("nameOfIssuer") or "").strip(), "cusip": key[0],
                                                    "put_call": key[1], "value": 0.0, "shares": 0.0, "cls": (it.findtext("titleOfClass") or "").strip()})
                        row["value"] += (_num(it, "value") or 0) * scale
                        row["shares"] += _num(it, "shrsOrPrnAmt/sshPrnamt") or 0
                # some filers still write thousands: a median share worth cents means the values are in thousands
                prices = sorted(r["value"] / r["shares"] for r in rows.values() if r["shares"] and r["value"] and not r["put_call"])
                if prices and prices[len(prices) // 2] < 1:
                    for r in rows.values():
                        r["value"] *= 1000
                quarters.append({**f, "rows": rows})
        now, before = quarters[0], (quarters[1] if len(quarters) > 1 else None)
        total = sum(r["value"] for r in now["rows"].values()) or 1
        names = (await sec_tickers())
        out = []
        for key, r in now["rows"].items():
            prev = before["rows"].get(key) if before else None
            change = "new" if before and not prev else None
            pct = None
            if prev and prev["shares"]:
                pct = (r["shares"] - prev["shares"]) / prev["shares"] * 100
                change = "added" if pct > 0.5 else "reduced" if pct < -0.5 else "same"
            ticker = by_name(names, r["name"])
            info = names["by_ticker"].get(ticker) if ticker else None
            out.append({**r, "weight": r["value"] / total * 100, "change": change, "change_pct": pct,
                        "ticker": ticker or "", "symbol": tv_from_ticker(ticker, info["exchange"]) if info else ""})
        sold = []
        if before:
            for key, r in before["rows"].items():
                if key not in now["rows"]:
                    ticker = by_name(names, r["name"])
                    sold.append({**r, "change": "sold", "ticker": ticker or ""})
        out.sort(key=lambda r: -r["value"])
        sold.sort(key=lambda r: -r["value"])
        return {"source": "live", "name": subs.get("name", ""), "cik": cik, "period": now["period"], "filed": now["filed"],
                "previous": before["period"] if before else None, "total": total, "count": len(out), "holdings": out[:60],
                "sold": sold[:25], "new": sum(1 for r in out if r["change"] == "new"),
                "url": f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={cik}&type=13F-HR"}
    return await cached(f"sec:13f:{cik}:3", 6 * 3600, make)


# ---------------------------------------------------------------- daily candles, for the strategy tests

YAHOO_SPECIAL = {"SP:SPX": "^GSPC", "TVC:SPX": "^GSPC", "NASDAQ:NDX": "^NDX", "NASDAQ:IXIC": "^IXIC", "DJ:DJI": "^DJI",
                 "TVC:DJI": "^DJI", "TVC:DXY": "DX-Y.NYB", "TVC:VIX": "^VIX", "CBOE:VIX": "^VIX", "XETR:DAX": "^GDAXI",
                 "TVC:DAX": "^GDAXI", "TVC:UKX": "^FTSE", "TVC:NI225": "^N225", "OANDA:XAUUSD": "GC=F", "TVC:GOLD": "GC=F",
                 "COMEX:GC1!": "GC=F", "OANDA:XAGUSD": "SI=F", "TVC:SILVER": "SI=F", "TVC:USOIL": "CL=F", "NYMEX:CL1!": "CL=F",
                 "TVC:UKOIL": "BZ=F", "EURONEXT:PSI20": "PSI20.LS", "TVC:US10Y": "^TNX"}
YAHOO_SUFFIX = {"XETR": [".DE"], "FWB": [".F"], "LSE": [".L"], "MIL": [".MI"], "BME": [".MC"], "SIX": [".SW"], "TSX": [".TO"],
                "ASX": [".AX"], "TSE": [".T"], "HKEX": [".HK"], "EURONEXT": [".PA", ".AS", ".BR", ".LS"], "OMXSTO": [".ST"],
                "OSL": [".OL"], "OMXCOP": [".CO"], "OMXHEX": [".HE"], "VIE": [".VI"], "NSE": [".NS"], "BSE": [".BO"]}
RANGES = {"1y": 365, "2y": 730, "5y": 1826}


async def _yahoo(client: httpx.AsyncClient, sym: str, rng: str) -> list | None:
    r = await client.get(f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}", params={"range": rng, "interval": "1d"}, timeout=12)
    if r.status_code != 200:
        return None
    res = (r.json().get("chart", {}).get("result") or [None])[0]
    if not res or not res.get("timestamp"):
        return None
    q = (res.get("indicators", {}).get("quote") or [{}])[0]
    out = []
    for i, ts in enumerate(res["timestamp"]):
        o, h, l, c, v = (q.get(k, [None] * (i + 1))[i] for k in ("open", "high", "low", "close", "volume"))
        if c is not None:
            out.append([ts, o if o is not None else c, h if h is not None else c, l if l is not None else c, c, v or 0])
    return out or None


async def _binance(client: httpx.AsyncClient, pair: str, days: int) -> list | None:
    out, end = [], None
    while len(out) < days:
        params = {"symbol": pair, "interval": "1d", "limit": 1000}
        if end:
            params["endTime"] = end
        r = await client.get("https://api.binance.com/api/v3/klines", params=params, timeout=12)
        if r.status_code != 200 or not r.json():
            break
        rows = [[k[0] // 1000, float(k[1]), float(k[2]), float(k[3]), float(k[4]), float(k[5])] for k in r.json()]
        out = rows + out
        if len(rows) < 1000:
            break
        end = r.json()[0][0] - 1
    return out[-days:] or None


async def history(symbol: str, rng: str) -> dict:
    async def make():
        exch, sym = symbol.split(":", 1)
        async with httpx.AsyncClient(headers=UA) as client:
            if exch in CRYPTO_EXCH:
                base = re.sub(r"(USDT|USDC|USD|BUSD|FDUSD|\.P)+$", "", sym)
                if exch == "BINANCE" and sym.endswith("USDT"):
                    candles = await _binance(client, sym, RANGES[rng])
                    if candles:
                        return {"source": "Binance", "source_symbol": sym, "currency": "USDT", "candles": candles}
                tries = [base + "-USD"]
            elif symbol in YAHOO_SPECIAL:
                tries = [YAHOO_SPECIAL[symbol]]
            elif exch in FX_EXCH and len(sym) == 6:
                tries = [sym + "=X"]
            elif exch in US_EXCH:
                tries = [sym.replace(".", "-")]
            else:
                tries = [sym + s for s in YAHOO_SUFFIX.get(exch, [""])]
            for t in tries:
                candles = await _yahoo(client, t, rng)
                if candles:
                    return {"source": "Yahoo Finance", "source_symbol": t, "currency": "", "candles": candles}
        return {"source": "not_connected", "reason": f"Não encontrei o histórico diário de {symbol}.", "candles": []}
    return await cached(f"hist:{symbol}:{rng}", 1800, make)


# ---------------------------------------------------------------- paper trading

async def usd_rates(currencies: set[str]) -> dict[str, float]:
    rates = {c: 1.0 for c in currencies if c in STABLE or not c}
    other = {c for c in currencies if c not in rates}
    pairs = {c: f"FX_IDC:{'GBP' if c == 'GBX' else c}USD" for c in other}
    if pairs:
        try:
            found = await tv_scan(list(pairs.values()), ["close"], 300)
        except (httpx.HTTPError, ValueError):
            found = {}
        for c, p in pairs.items():
            close = (found.get(p) or {}).get("close")
            if close:
                rates[c] = close / 100 if c == "GBX" else close
    return rates


def account(trades: list[PaperTrade]) -> dict:
    """Cash, positions and what was realised, from the orders after the last reset."""
    start, cash, realised = START_CASH, START_CASH, 0.0
    pos: dict[str, dict] = {}
    count = 0
    for t in sorted(trades, key=lambda t: (t.at, t.id)):
        if t.side == "reset":
            start = cash = t.price or START_CASH
            pos, realised, count = {}, 0.0, 0
            continue
        p = pos.setdefault(t.symbol, {"symbol": t.symbol, "name": t.name, "qty": 0.0, "cost": 0.0, "currency": t.currency})
        count += 1
        if t.side == "buy":
            cash -= t.qty * t.price
            p["qty"] += t.qty
            p["cost"] += t.qty * t.price
        else:
            avg = p["cost"] / p["qty"] if p["qty"] else t.price
            cash += t.qty * t.price
            realised += t.qty * (t.price - avg)
            p["qty"] -= t.qty
            p["cost"] -= t.qty * avg
            if p["qty"] <= 1e-9:
                pos.pop(t.symbol)
    return {"start": start, "cash": cash, "realised": realised, "orders": count, "positions": list(pos.values())}


async def priced(acc: dict) -> dict:
    """The account at today's TradingView prices, in US dollars."""
    syms = [p["symbol"] for p in acc["positions"]]
    try:
        found = await tv_scan(syms) if syms else {}
    except (httpx.HTTPError, ValueError):
        found = {}
    rates = await usd_rates({(found.get(s) or {}).get("currency") or "USD" for s in syms})
    value, missing = 0.0, False
    positions = []
    for p in acc["positions"]:
        d = found.get(p["symbol"]) or {}
        price = d.get("close") * rates.get(d.get("currency") or "USD", 0) if d.get("close") is not None else None
        avg = p["cost"] / p["qty"] if p["qty"] else 0
        now = price * p["qty"] if price else None
        if now is None:
            missing = True
            now = p["cost"]  # no price now: counted at what it cost, and the page says so
        value += now
        positions.append({**p, "avg": avg, "price": price, "value": now, "pnl": now - p["cost"],
                          "pnl_pct": (now - p["cost"]) / p["cost"] * 100 if p["cost"] else None, "change_pct": d.get("change"),
                          "logo": logo(d, p["symbol"]) if d else "", "local_price": d.get("close"), "local_currency": d.get("currency")})
    equity = acc["cash"] + value
    positions.sort(key=lambda p: -p["value"])
    return {**acc, "positions": positions, "invested": value, "equity": equity, "pnl": equity - acc["start"],
            "pnl_pct": (equity - acc["start"]) / acc["start"] * 100 if acc["start"] else 0, "stale": missing}


# ---------------------------------------------------------------- the page's endpoints

class ItemIn(BaseModel):
    kind: Literal["watch", "alert", "investor"]
    symbol: str = Field(..., max_length=60)
    name: str = Field("", max_length=120)
    op: Literal["", "above", "below"] = ""
    value: float | None = None
    note: str = Field("", max_length=200)


def item_out(i: MarketItem) -> dict:
    return {"id": i.id, "kind": i.kind, "symbol": i.symbol, "name": i.name, "op": i.op, "value": i.value, "note": i.note,
            "created_at": iso(i.created_at), "fired_at": iso(i.fired_at)}


async def my_items(db: AsyncSession, user: User, seed: bool = False) -> list[MarketItem]:
    items = (await db.execute(select(MarketItem).where(MarketItem.user_id == user.id).order_by(MarketItem.id))).scalars().all()
    if seed and not any(i.kind == "watch" for i in items):  # a first visit starts with the market everyone follows
        for symbol, name in DEFAULT_WATCH:
            db.add(MarketItem(user_id=user.id, kind="watch", symbol=symbol, name=name))
        await db.commit()
        items = (await db.execute(select(MarketItem).where(MarketItem.user_id == user.id).order_by(MarketItem.id))).scalars().all()
    return list(items)


@router.get("/board")
async def board(user: User = Depends(viewer), db: AsyncSession = Depends(get_db)):
    """The first paint of the page: the team's four markets, the alerts, the investors followed."""
    items = await my_items(db, user, seed=True)
    await db.commit()
    alerts = [i for i in items if i.kind == "alert"]
    focus_q, alert_q = await asyncio.gather(focus_quotes(), quotes(list(dict.fromkeys((i.symbol, i.name) for i in alerts))))
    return {"focus": focus_q, "alerts": [item_out(i) for i in alerts], "alert_quotes": {q["symbol"]: q for q in alert_q if not q.get("missing")},
            "investors": [item_out(i) for i in items if i.kind == "investor"],
            "agent": await agent_connected(user.id), "fetched_at": iso(datetime.now(timezone.utc))}


@router.post("/items")
async def add_item(body: ItemIn, user: User = Depends(viewer), db: AsyncSession = Depends(get_db)):
    symbol = body.symbol.strip() if body.kind == "investor" else clean(body.symbol)
    if body.kind == "investor" and not symbol.isdigit():
        raise HTTPException(422, "Um investidor é o número CIK da SEC")
    if body.kind == "alert" and (not body.op or body.value is None):
        raise HTTPException(422, "Um alerta precisa de «acima de» ou «abaixo de» e de um preço")
    seen = ""
    if body.kind == "investor":  # what is on file today is not news: only filings after this one ring
        try:
            last = _recent(await submissions(int(symbol)), ("13F-HR", "SC 13D", "SC 13G", "4"), 1)
            seen = last[0]["acc"] if last else ""
        except (httpx.HTTPError, ValueError):
            pass
    if body.kind != "alert":
        same = (await db.execute(select(MarketItem).where(MarketItem.user_id == user.id, MarketItem.kind == body.kind,
                                                          MarketItem.symbol == symbol))).scalars().first()
        if same:
            return item_out(same)
    item = MarketItem(user_id=user.id, kind=body.kind, symbol=symbol, name=body.name.strip(), op=body.op, value=body.value,
                      note=body.note.strip(), seen=seen)
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item_out(item)


@router.delete("/items/{item_id}")
async def remove_item(item_id: int, user: User = Depends(viewer), db: AsyncSession = Depends(get_db)):
    item = await db.get(MarketItem, item_id)
    if not item or item.user_id != user.id:
        raise HTTPException(404, "Não encontrado")
    await db.delete(item)
    await db.commit()
    return {"ok": True}


@router.get("/symbol")
async def symbol_detail(symbol: str, user: User = Depends(viewer)):
    """Everything TradingView says about one symbol: price, ratings on four timeframes, indicators, pivots, fundamentals."""
    symbol = clean(symbol)
    try:
        d = await tv_symbol(symbol)
    except (httpx.HTTPError, ValueError) as exc:
        return {"symbol": symbol, "missing": True, "error": str(exc)}
    if d.get("close") is None:
        return {"symbol": symbol, "missing": True}
    close = d["close"]
    mas = [{"name": f"{k[:3]} {k[3:]}", "value": d.get(k), "action": None if d.get(k) is None else ("buy" if close > d[k] else "sell")}
           for k in ("EMA10", "SMA10", "EMA20", "SMA20", "EMA50", "SMA50", "EMA100", "SMA100", "EMA200", "SMA200")]
    mas += [{"name": n, "value": d.get(k), "action": None if d.get(k) is None else ("buy" if close > d[k] else "sell")}
            for k, n in (("Ichimoku.BLine", "Ichimoku (linha base)"), ("VWMA", "VWMA 20"), ("HullMA9", "Hull 9"))]

    def osc(name, key, buy, sell):
        v = d.get(key)
        return {"name": name, "value": v, "action": None if v is None else "buy" if buy(v) else "sell" if sell(v) else "neutral"}
    macd, signal = d.get("MACD.macd"), d.get("MACD.signal")
    oscs = [osc("RSI (14)", "RSI", lambda v: v < 30, lambda v: v > 70),
            osc("Estocástico %K", "Stoch.K", lambda v: v < 20, lambda v: v > 80),
            osc("CCI (20)", "CCI20", lambda v: v < -100, lambda v: v > 100),
            osc("ADX (14)", "ADX", lambda v: False, lambda v: False),
            osc("Awesome Oscillator", "AO", lambda v: v > 0, lambda v: v < 0),
            osc("Momentum (10)", "Mom", lambda v: v > 0, lambda v: v < 0),
            {"name": "MACD (12, 26)", "value": macd, "action": None if macd is None or signal is None else "buy" if macd > signal else "sell"},
            osc("Williams %R", "W.R", lambda v: v < -80, lambda v: v > -20),
            osc("Bull Bear Power", "BBPower", lambda v: v > 0, lambda v: v < 0),
            osc("Ultimate Oscillator", "UO", lambda v: v < 30, lambda v: v > 70)]
    pivots = {k: d.get(f"Pivot.M.Classic.{k}") for k in ("R3", "R2", "R1", "Middle", "S1", "S2", "S3")}
    return {**quote_out(symbol, d), "open": d.get("open"),
            "ratings": {"all": rating(d.get("Recommend.All")), "ma": rating(d.get("Recommend.MA")), "osc": rating(d.get("Recommend.Other")),
                        "h1": rating(d.get("Recommend.All|60")), "h4": rating(d.get("Recommend.All|240")), "w1": rating(d.get("Recommend.All|1W")),
                        "values": {"all": d.get("Recommend.All"), "ma": d.get("Recommend.MA"), "osc": d.get("Recommend.Other")}},
            "mas": mas, "oscillators": oscs, "pivots": pivots, "atr": d.get("ATR"), "volatility": d.get("Volatility.D"),
            "perf": {"1S": d.get("Perf.W"), "1M": d.get("Perf.1M"), "3M": d.get("Perf.3M"), "6M": d.get("Perf.6M"),
                     "YTD": d.get("Perf.YTD"), "1A": d.get("Perf.Y")},
            "fundamentals": {"mcap": d.get("market_cap_basic"), "pe": d.get("price_earnings_ttm"), "eps": d.get("earnings_per_share_basic_ttm"),
                             "dividend": d.get("dividend_yield_recent"), "beta": d.get("beta_1_year"), "sector": d.get("sector"),
                             "industry": d.get("industry"), "employees": d.get("number_of_employees"),
                             "earnings": iso(datetime.fromtimestamp(d["earnings_release_next_date"], timezone.utc)) if d.get("earnings_release_next_date") else None,
                             "hi52": d.get("price_52_week_high"), "lo52": d.get("price_52_week_low"),
                             "avg_vol": d.get("average_volume_10d_calc"), "rel_vol": d.get("relative_volume_10d_calc")}}


@router.get("/news")
async def news(cat: str = "all", symbol: str = "", user: User = Depends(viewer), db: AsyncSession = Depends(get_db)):
    """TradingView's newsroom (Reuters, Dow Jones, the agencies) newest first. `mine` = the news of my watchlist."""
    try:
        if symbol:
            items = await tv_news(symbol=clean(symbol))
        elif cat == "mine":
            watch = [i.symbol for i in await my_items(db, user) if i.kind == "watch"][:12]
            await db.commit()
            lists = await asyncio.gather(*(tv_news(symbol=s) for s in watch), return_exceptions=True)
            seen, items = set(), []
            for lst in lists:
                for x in lst if isinstance(lst, list) else []:
                    if x["id"] not in seen:
                        seen.add(x["id"])
                        items.append(x)
            items.sort(key=lambda x: -x["ts"])
        else:
            items = await tv_news(category="" if cat == "all" else cat if cat in ("stock", "crypto", "forex", "economic", "index", "futures") else "")
    except (httpx.HTTPError, ValueError) as exc:
        return {"source": "error", "error": str(exc), "items": []}
    now = time.time()
    return {"source": "live", "items": [{**x, "fresh": now - x["ts"] < 3600} for x in items[:150]]}


@router.get("/feed")
async def feed(topic: str = "all", user: User = Depends(viewer)):
    """The news about our four in Portuguese, one card per story. `topic` = gold, eurusd, ger40 or gbpusd; the dollar's
    news count for the three quoted in dollars."""
    try:
        items = await news_feed()
    except (httpx.HTTPError, ValueError, ET.ParseError) as exc:
        return {"source": "error", "error": str(exc), "items": []}
    if topic in ("gold", "eurusd", "gbpusd"):
        items = [x for x in items if topic in x["topics"] or "usd" in x["topics"]]
    elif topic == "ger40":
        items = [x for x in items if "ger40" in x["topics"]]
    return {"source": "live", "items": items, "fetched_at": iso(datetime.now(timezone.utc))}


@router.get("/story")
async def story(id: str, user: User = Depends(viewer)):
    """A Reuters story from TradingView's Portuguese desk, whole, to read inside the Hub."""
    if not re.fullmatch(r"[\w:.,/@-]{4,200}", id):
        raise HTTPException(422, "Notícia inválida")
    try:
        async with httpx.AsyncClient(headers=TV_HEAD) as client:
            return {**await tv_story(client, id), "source": "live"}  # the story's own source (Reuters) is on the card already
    except (httpx.HTTPError, ValueError) as exc:
        return {"source": "error", "error": str(exc)}


@router.get("/calendar")
async def diary(user: User = Depends(viewer)):
    """This week's events for the dollar, the euro and the pound (ForexFactory), high and medium impact."""
    try:
        return {"source": "live", "events": await calendar()}
    except (httpx.HTTPError, ValueError) as exc:
        return {"source": "error", "error": str(exc), "events": []}


MOVER_COLUMNS = ["name", "description", "close", "change", "volume", "logoid", "market_cap_basic", "Recommend.All",
                 "relative_volume_10d_calc", "currency"]


async def _screen(market: str, sort: str, order: str, extra: list[dict], n: int = 8) -> list[dict]:
    async def make():
        body = {"columns": MOVER_COLUMNS, "sort": {"sortBy": sort, "sortOrder": order}, "range": [0, n],
                "filter": extra, "options": {"lang": "en"}}
        async with httpx.AsyncClient(headers=TV_HEAD) as client:
            r = await client.post(f"https://scanner.tradingview.com/{market}/scan", json=body, timeout=12)
            r.raise_for_status()
            out = []
            for row in r.json().get("data", []):
                d = dict(zip(MOVER_COLUMNS, row["d"]))
                out.append({**quote_out(row["s"], d), "ticker": d["name"], "rel_vol": d.get("relative_volume_10d_calc")})
            return out
    return await cached(f"scr:{market}:{sort}:{order}:{hash(str(extra))}", 60, make)


@router.get("/movers")
async def movers(user: User = Depends(viewer)):
    """The day in the US market and in crypto: what went up most, down most, what traded most, and unusual volume."""
    us = [{"left": "market_cap_basic", "operation": "greater", "right": 2_000_000_000},
          {"left": "exchange", "operation": "in_range", "right": ["NASDAQ", "NYSE", "AMEX"]},
          {"left": "type", "operation": "in_range", "right": ["stock", "dr"]},
          {"left": "volume", "operation": "greater", "right": 300_000}]
    crypto = [{"left": "exchange", "operation": "equal", "right": "BINANCE"}, {"left": "currency", "operation": "equal", "right": "USDT"},
              {"left": "type", "operation": "equal", "right": "spot"}, {"left": "24h_vol|5", "operation": "greater", "right": 20_000_000}]
    jobs = {"gainers": _screen("america", "change", "desc", us), "losers": _screen("america", "change", "asc", us),
            "active": _screen("america", "Value.Traded", "desc", us), "unusual": _screen("america", "relative_volume_10d_calc", "desc", us),
            "crypto_up": _screen("crypto", "change", "desc", crypto), "crypto_down": _screen("crypto", "change", "asc", crypto)}
    results = await asyncio.gather(*jobs.values(), return_exceptions=True)
    return {k: (v if isinstance(v, list) else []) for k, v in zip(jobs, results)}


@router.get("/insiders")
async def insiders(symbol: str = "", view: str = "buys", user: User = Depends(viewer)):
    try:
        return await company_insiders(clean(symbol)) if symbol else await latest_insiders(view)
    except (httpx.HTTPError, ValueError, KeyError, ET.ParseError) as exc:
        return {"source": "error", "error": f"A SEC não respondeu: {exc}", "items": []}


@router.get("/investors")
async def investors(user: User = Depends(viewer), db: AsyncSession = Depends(get_db)):
    followed = {i.symbol: i.id for i in await my_items(db, user) if i.kind == "investor"}
    known = [{"cik": cik, "person": person, "firm": firm, "item_id": followed.pop(cik, None)} for cik, person, firm in INVESTORS]
    for cik, item_id in followed.items():  # followed by number, not in the famous list
        known.append({"cik": cik, "person": "", "firm": f"CIK {cik}", "item_id": item_id})
    return known


@router.get("/investors/{cik}")
async def investor(cik: int, user: User = Depends(viewer)):
    try:
        return await holdings(cik)
    except (httpx.HTTPError, ValueError, KeyError, ET.ParseError) as exc:
        return {"source": "error", "error": f"A SEC não respondeu: {exc}"}


@router.get("/history")
async def candles(symbol: str, range: Literal["1y", "2y", "5y"] = "2y", user: User = Depends(viewer)):
    try:
        return {"symbol": clean(symbol), **await history(clean(symbol), range)}
    except (httpx.HTTPError, ValueError) as exc:
        return {"symbol": symbol, "source": "error", "reason": str(exc), "candles": []}


@router.get("/paper")
async def paper(user: User = Depends(viewer), db: AsyncSession = Depends(get_db)):
    """My paper account at today's prices, my last orders, and the team's league (the same rules for everyone)."""
    trades = (await db.execute(select(PaperTrade))).scalars().all()
    people = {u.id: u for u in (await db.execute(select(User))).scalars()}
    await db.commit()
    by_user: dict[int, list] = {}
    for t in trades:
        by_user.setdefault(t.user_id, []).append(t)
    accounts = {uid: account(ts) for uid, ts in by_user.items()}
    accounts.setdefault(user.id, account([]))
    priced_all = dict(zip(accounts, await asyncio.gather(*(priced(a) for a in accounts.values()))))
    me = priced_all[user.id]
    mine = sorted(by_user.get(user.id, []), key=lambda t: (t.at, t.id), reverse=True)
    league = [{"user": people[uid].username, "name": people[uid].display_name, "equity": a["equity"], "pnl_pct": a["pnl_pct"],
               "orders": a["orders"], "positions": len(a["positions"]),
               "best": max(a["positions"], key=lambda p: p["pnl_pct"] or -1e9)["symbol"] if a["positions"] else ""}
              for uid, a in priced_all.items() if uid in people]
    league.sort(key=lambda x: -x["pnl_pct"])
    return {"me": me, "trades": [{"id": t.id, "side": t.side, "symbol": t.symbol, "name": t.name, "qty": t.qty, "price": t.price,
                                  "local_price": t.local_price, "currency": t.currency, "note": t.note, "at": iso(t.at)} for t in mine[:60]],
            "league": league}


class Order(BaseModel):
    symbol: str = Field(..., max_length=60)
    side: Literal["buy", "sell"]
    qty: float | None = Field(None, gt=0)
    amount: float | None = Field(None, gt=0)  # in USD, instead of a quantity
    note: str = Field("", max_length=200)


@router.post("/paper/order")
async def order(body: Order, user: User = Depends(viewer), db: AsyncSession = Depends(get_db)):
    symbol = clean(body.symbol)
    try:
        d = (await tv_scan([symbol], QUOTE, 5)).get(symbol)
    except (httpx.HTTPError, ValueError):
        d = None
    if not d or d.get("close") is None:
        raise HTTPException(422, f"O TradingView não deu preço para {symbol} agora")
    currency = d.get("currency") or "USD"
    rate = (await usd_rates({currency})).get(currency)
    if not rate:
        raise HTTPException(422, f"Não consegui converter {currency} para dólares")
    price = d["close"] * rate
    qty = body.qty if body.qty else (body.amount / price if body.amount else None)
    if not qty:
        raise HTTPException(422, "Diz a quantidade ou o valor em dólares")
    acc = account((await db.execute(select(PaperTrade).where(PaperTrade.user_id == user.id))).scalars().all())
    if body.side == "buy" and qty * price > acc["cash"] + 1e-6:
        raise HTTPException(422, f"Dinheiro disponível: {acc['cash']:,.2f} $. Esta ordem custa {qty * price:,.2f} $")
    if body.side == "sell":
        have = next((p["qty"] for p in acc["positions"] if p["symbol"] == symbol), 0)
        if qty > have + 1e-9:
            raise HTTPException(422, f"Só tens {have:g} de {symbol}")
    trade = PaperTrade(user_id=user.id, side=body.side, symbol=symbol, name=d.get("description") or symbol, qty=qty, price=price,
                       local_price=d["close"], currency=currency, note=body.note.strip())
    db.add(trade)
    await db.commit()
    return {"ok": True, "qty": qty, "price": price, "total": qty * price, "name": trade.name}


class Reset(BaseModel):
    cash: float = Field(START_CASH, ge=1000, le=10_000_000)


@router.post("/paper/reset")
async def reset(body: Reset, user: User = Depends(viewer), db: AsyncSession = Depends(get_db)):
    db.add(PaperTrade(user_id=user.id, side="reset", price=body.cash, note="Conta reiniciada"))
    await db.commit()
    return {"ok": True}


class MarketAsk(BaseModel):
    question: str = Field(..., min_length=2, max_length=2000)
    symbol: str = Field("", max_length=60)


async def market_context(db: AsyncSession, user: User, symbol: str) -> dict:
    """The market as the Hub sees it right now. The answer may use nothing else."""
    items = await my_items(db, user)
    await db.commit()
    watch = [(i.symbol, i.name) for i in items if i.kind == "watch"]
    jobs = [quotes(PULSE), quotes(watch), tv_news(), focus_quotes(), news_feed(), calendar()]
    if symbol:
        jobs += [symbol_detail(symbol, user), tv_news(symbol=symbol), company_insiders(symbol) if sec_ticker(symbol) else asyncio.sleep(0)]
    res = await asyncio.gather(*jobs, return_exceptions=True)
    ok = lambda x: None if isinstance(x, BaseException) else x
    slim = lambda q: {k: q.get(k) for k in ("symbol", "name", "price", "currency", "change_pct", "rating", "rsi", "perf_w", "perf_m", "perf_ytd") if q.get(k) is not None}
    trades = (await db.execute(select(PaperTrade).where(PaperTrade.user_id == user.id))).scalars().all()
    await db.commit()
    acc = await priced(account(trades))
    context = {
        "now": datetime.now(timezone.utc).astimezone().isoformat(timespec="minutes"),
        "asked_by": user.display_name,
        "sources": "Prices, ratings and indicators: TradingView (rating from -1 strong sell to 1 strong buy). News: TradingView's "
                   "newsroom; team_news is in Portuguese (Reuters, Investing.com Brasil). Diary: ForexFactory. Insiders: SEC Form 4. "
                   "The paper account is virtual money, not a real portfolio.",
        "team_markets": "What the team trades: gold (XAU/USD), EUR/USD, GER40 (the DAX) and GBP/USD. Answer about these first, in "
                        "plain Portuguese from Portugal, for a trader who is not an economist.",
        "market": [slim(q) for q in ok(res[0]) or [] if not q.get("missing")],
        "watchlist": [slim(q) for q in ok(res[1]) or [] if not q.get("missing")],
        "headlines": [{"title": n["title"], "source": n["source"], "at": n["at"], "symbols": n["symbols"]} for n in (ok(res[2]) or [])[:25]],
        "team_quotes": [{**slim(q), "rating_1h": q.get("r1h"), "rating_4h": q.get("r4h")} for q in ok(res[3]) or [] if not q.get("missing")],
        "team_news": [{"title": n["title"], "points": n["bullets"], "topics": n["topics"], "at": n["at"]} for n in (ok(res[4]) or [])[:25]],
        "diary": [{k: e[k] for k in ("at", "currency", "impact", "title_en", "forecast", "previous", "actual")} for e in ok(res[5]) or []
                  if e["ts"] > time.time() - 86400][:20],
        "paper_account": {"cash_usd": round(acc["cash"], 2), "equity_usd": round(acc["equity"], 2), "return_pct": round(acc["pnl_pct"], 2),
                          "positions": [{"symbol": p["symbol"], "qty": p["qty"], "avg_usd": round(p["avg"], 4),
                                         "pnl_pct": None if p["pnl_pct"] is None else round(p["pnl_pct"], 2)} for p in acc["positions"]]},
    }
    if symbol:
        detail = ok(res[6]) or {}
        context["focus"] = {k: detail.get(k) for k in ("symbol", "name", "price", "currency", "change_pct", "ratings", "oscillators",
                                                       "mas", "pivots", "perf", "fundamentals", "atr", "volatility") if detail.get(k) is not None}
        context["focus_news"] = [{"title": n["title"], "source": n["source"], "at": n["at"]} for n in (ok(res[7]) or [])[:15]]
        ins = ok(res[8])
        if isinstance(ins, dict) and ins.get("items"):
            context["focus_insiders"] = [{k: x.get(k) for k in ("owner", "role", "kind", "shares", "price", "value", "date")} for x in ins["items"][:15]]
    return context


@router.post("/ask")
async def ask(body: MarketAsk, user: User = Depends(viewer), db: AsyncSession = Depends(get_db)):
    """A question about the market for the asker's own agent (kind "markets"), answered from the data gathered here."""
    symbol = clean(body.symbol) if body.symbol.strip() else ""
    request = AIRequest(user_id=user.id, kind="markets", question=body.question.strip()[:2000])
    if await agent_connected(user.id):
        request.context = await market_context(db, user, symbol)
    else:
        request.status, request.error, request.finished_at = "ERROR", "agent_offline", datetime.now(timezone.utc)
    db.add(request)
    await db.commit()
    await db.refresh(request)
    if request.status == "PENDING":
        await rt.command(user.id, {"type": "ask", "request_id": request.id})
    return request_out(request)


# ---------------------------------------------------------------- the watcher (the real Hub of each PC, for its own person)

async def _alerts(db: AsyncSession, user: User, items: list[MarketItem]):
    live = [i for i in items if i.kind == "alert" and i.fired_at is None and i.value is not None]
    if not live:
        return
    found = await tv_scan([i.symbol for i in live])
    for i in live:
        price = (found.get(i.symbol) or {}).get("close")
        if price is None or not ((i.op == "above" and price >= i.value) or (i.op == "below" and price <= i.value)):
            continue
        i.fired_at = datetime.now(timezone.utc)
        await db.commit()
        word = "subiu acima de" if i.op == "above" else "desceu abaixo de"
        await notify(db, [user.id], "market_alert", "high", f"{i.name or i.symbol} {word} {i.value:g}",
                     f"Agora a {price:,.4g}. {i.note}".strip(), f"#/mercados/grafico/{i.symbol}")


async def _filings(db: AsyncSession, user: User, items: list[MarketItem]):
    """New SEC filings of the investors followed, and insiders buying the shares of the watchlist."""
    for i in [i for i in items if i.kind == "investor"]:
        try:
            last = _recent(await submissions(int(i.symbol)), ("13F-HR", "SC 13D", "SC 13G", "4"), 1)
        except (httpx.HTTPError, ValueError):
            continue
        if not last or last[0]["acc"] == i.seen:
            continue
        first, i.seen = not i.seen, last[0]["acc"]
        await db.commit()
        if not first:
            what = {"13F-HR": "a carteira do trimestre (13F)", "SC 13D": "uma posição de mais de 5% (13D)",
                    "SC 13G": "uma posição de mais de 5% (13G)", "4": "uma compra ou venda (Form 4)"}[last[0]["form"]]
            await notify(db, [user.id], "market_investor", "medium", f"{i.name or 'Investidor'} entregou {what}",
                         f"Na SEC a {last[0]['filed']}.", f"#/mercados/investidores/{i.symbol}")
    tickers = None
    for i in [i for i in items if i.kind == "watch" and sec_ticker(i.symbol)][:15]:
        try:
            tickers = tickers or (await sec_tickers())["by_ticker"]
            info = tickers.get(sec_ticker(i.symbol))
            if not info:
                continue
            last = _recent(await submissions(info["cik"]), ("4",), 1)
            if not last or last[0]["acc"] == i.seen:
                continue
            first, i.seen = not i.seen, last[0]["acc"]
            await db.commit()
            if first:
                continue
            async with sec_client() as client:
                f = parse_form4(await _filing_text(client, info["cik"], last[0]["acc"]), last[0]["acc"])
            s = summarise(f) if f else None
            if s and s["kind"] == "buy" and (s["value"] or 0) >= 25_000:
                await notify(db, [user.id], "market_insider", "medium", f"Insider a comprar {i.name or i.symbol}",
                             f"{s['owner']} ({s['role']}) comprou {s['value']:,.0f} $ em ações.", f"#/mercados/grafico/{i.symbol}")
        except (httpx.HTTPError, ValueError, KeyError):
            continue


async def _warm():
    """What is slow the first time (the SEC's list of tickers, OpenInsider, the news) is fetched before anybody asks."""
    for make in (sec_tickers, lambda: latest_insiders("buys"), lambda: latest_insiders("clusters"), tv_news, news_feed, calendar):
        try:
            await make()
        except Exception:  # noqa: BLE001 - a cache that is not warm only means a slower first look
            pass


async def loop():
    await asyncio.sleep(30)
    turn = 0
    while True:
        if turn % 9 == 0:  # the caches last 10 minutes
            await _warm()
        try:
            me = sync.whoami()
            if me:
                async with SessionLocal() as db:
                    user = (await db.execute(select(User).where(User.username == me[1]))).scalars().first()
                    if user:
                        items = (await db.execute(select(MarketItem).where(MarketItem.user_id == user.id))).scalars().all()
                        await db.commit()  # let the database go while TradingView and the SEC answer
                        await _alerts(db, user, items)
                        if turn % 20 == 0:
                            await _filings(db, user, items)
        except Exception:  # a market that does not answer must never stop the Hub
            log.exception("Mercados: the watcher failed this turn")
        turn += 1
        await asyncio.sleep(60)
