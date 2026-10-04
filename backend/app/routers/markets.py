"""Home's outside numbers: the coins and shares each person follows, and the BareDesk shop (Shopify sales, Meta ads).

Markets: crypto from Binance's public API, shares from Yahoo Finance's chart API. Neither needs a key.
Shop: Shopify Admin GraphQL (orders) and the Meta Marketing API (spend, views, carts, purchases). Both need the keys in
backend/.env (see config.py); without them the answer says `not_connected` and which key is missing - never a made-up zero.
Everything is cached for a short while, so many widgets open on many PCs do not hammer the APIs.
"""
import asyncio
import time
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import APIRouter, Depends

from ..config import settings
from ..models import User
from ..security import current_user

router = APIRouter(prefix="/api")

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) agente-amg"}
_cache: dict[str, tuple[float, object]] = {}


async def cached(key: str, seconds: int, make):
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < seconds:
        return hit[1]
    value = await make()
    _cache[key] = (time.time(), value)
    return value


# ---------------------------------------------------------------- markets
# Binance gives pairs, not names: the names of the coins people actually look for.
COIN_NAMES = {"BTC": "Bitcoin", "ETH": "Ethereum", "BNB": "BNB", "SOL": "Solana", "XRP": "XRP", "DOGE": "Dogecoin", "ADA": "Cardano",
              "TRX": "TRON", "AVAX": "Avalanche", "DOT": "Polkadot", "LINK": "Chainlink", "MATIC": "Polygon", "POL": "Polygon",
              "LTC": "Litecoin", "SHIB": "Shiba Inu", "TON": "Toncoin", "PEPE": "Pepe", "SUI": "Sui", "NEAR": "NEAR", "APT": "Aptos",
              "ARB": "Arbitrum", "OP": "Optimism", "ATOM": "Cosmos", "UNI": "Uniswap", "XLM": "Stellar", "BCH": "Bitcoin Cash",
              "ETC": "Ethereum Classic", "FIL": "Filecoin", "HBAR": "Hedera", "ICP": "Internet Computer", "INJ": "Injective",
              "RENDER": "Render", "WIF": "dogwifhat", "BONK": "Bonk", "TAO": "Bittensor", "FET": "Fetch.ai", "AAVE": "Aave",
              "SEI": "Sei", "TIA": "Celestia", "FLOKI": "Floki", "TRUMP": "Official Trump", "ENA": "Ethena", "ONDO": "Ondo"}
# What "+" shows before anyone types: the big coins and the shares and indices people follow most.
POPULAR = ["crypto:BTCUSDT", "crypto:ETHUSDT", "crypto:SOLUSDT", "crypto:BNBUSDT", "crypto:XRPUSDT", "crypto:DOGEUSDT", "crypto:ADAUSDT",
           "stock:AAPL", "stock:NVDA", "stock:TSLA", "stock:MSFT", "stock:AMZN", "stock:GOOGL", "stock:META", "stock:NFLX", "stock:AMD",
           "stock:SPY", "stock:QQQ", "stock:^GSPC", "stock:^IXIC", "stock:GC=F", "stock:EURUSD=X"]
STOCK_NAMES = {"AAPL": "Apple", "NVDA": "NVIDIA", "TSLA": "Tesla", "MSFT": "Microsoft", "AMZN": "Amazon", "GOOGL": "Alphabet",
               "META": "Meta Platforms", "NFLX": "Netflix", "AMD": "AMD", "SPY": "S&P 500 ETF", "QQQ": "Nasdaq 100 ETF",
               "^GSPC": "S&P 500", "^IXIC": "Nasdaq", "GC=F": "Ouro", "EURUSD=X": "EUR / USD"}


def _coin(pair: str) -> dict:
    base = pair.removesuffix("USDT")
    return {"id": f"crypto:{pair}", "kind": "crypto", "symbol": base, "name": COIN_NAMES.get(base, base), "currency": "USD"}


async def _pairs(client: httpx.AsyncClient) -> list[str]:
    async def make():
        r = await client.get("https://api.binance.com/api/v3/exchangeInfo", params={"permissions": "SPOT"}, timeout=10)
        r.raise_for_status()
        return [s["symbol"] for s in r.json()["symbols"] if s["quoteAsset"] == "USDT" and s["status"] == "TRADING"]
    return await cached("pairs", 6 * 3600, make)


@router.get("/markets/catalog")
async def catalog(q: str = "", user: User = Depends(current_user)):
    """What can be added: everything Binance trades against USDT, and any share Yahoo knows."""
    q = q.strip()
    async with httpx.AsyncClient(headers=UA) as client:
        if not q:
            out = []
            for item in POPULAR:
                kind, sym = item.split(":", 1)
                out.append(_coin(sym) if kind == "crypto" else {"id": item, "kind": "stock", "symbol": sym, "name": STOCK_NAMES.get(sym, sym), "currency": ""})
            return out
        needle = q.upper()
        coins, stocks = [], []
        try:
            pairs = await _pairs(client)
            hits = [p for p in pairs if p.removesuffix("USDT").startswith(needle) or needle in COIN_NAMES.get(p.removesuffix("USDT"), "").upper()]
            hits.sort(key=lambda p: (p.removesuffix("USDT") != needle, len(p)))
            coins = [_coin(p) for p in hits[:12]]
        except httpx.HTTPError:
            pass
        try:
            r = await client.get("https://query2.finance.yahoo.com/v1/finance/search",
                                 params={"q": q, "quotesCount": 12, "newsCount": 0, "listsCount": 0}, timeout=8)
            for x in r.json().get("quotes", []):
                if x.get("quoteType") in ("EQUITY", "ETF", "INDEX", "FUTURE", "CURRENCY", "MUTUALFUND") and x.get("symbol"):
                    stocks.append({"id": f"stock:{x['symbol']}", "kind": "stock", "symbol": x["symbol"],
                                   "name": x.get("shortname") or x.get("longname") or x["symbol"], "exchange": x.get("exchDisp", ""), "currency": ""})
        except (httpx.HTTPError, ValueError):
            pass
        return coins + stocks


async def _crypto_quotes(client: httpx.AsyncClient, pairs: list[str]) -> dict:
    r = await client.get("https://api.binance.com/api/v3/ticker/24hr", params={"symbols": "[" + ",".join(f'"{p}"' for p in pairs) + "]"}, timeout=8)
    r.raise_for_status()
    out = {}
    for t in r.json():
        out[f"crypto:{t['symbol']}"] = {**_coin(t["symbol"]), "price": float(t["lastPrice"]), "change": float(t["priceChange"]),
                                        "change_pct": float(t["priceChangePercent"]), "high": float(t["highPrice"]), "low": float(t["lowPrice"])}
    # the last 24 hours, one point an hour, for the little line
    lines = await asyncio.gather(*(client.get("https://api.binance.com/api/v3/klines", params={"symbol": p, "interval": "1h", "limit": 24}, timeout=8)
                                   for p in pairs), return_exceptions=True)
    for p, res in zip(pairs, lines):
        if isinstance(res, httpx.Response) and res.status_code == 200 and f"crypto:{p}" in out:
            out[f"crypto:{p}"]["spark"] = [float(k[4]) for k in res.json()]
    return out


async def _stock_quote(client: httpx.AsyncClient, sym: str) -> dict | None:
    r = await client.get(f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}", params={"range": "1d", "interval": "15m"}, timeout=8)
    if r.status_code != 200:
        return None
    res = (r.json().get("chart", {}).get("result") or [None])[0]
    if not res:
        return None
    meta = res["meta"]
    price, prev = meta.get("regularMarketPrice"), meta.get("chartPreviousClose") or meta.get("previousClose")
    if price is None:
        return None
    closes = [c for c in ((res.get("indicators", {}).get("quote") or [{}])[0].get("close") or []) if c is not None]
    change = price - prev if prev else None
    return {"id": f"stock:{sym}", "kind": "stock", "symbol": sym, "name": meta.get("shortName") or meta.get("longName") or STOCK_NAMES.get(sym, sym),
            "currency": meta.get("currency", ""), "price": price, "change": change, "change_pct": change / prev * 100 if prev else None,
            "high": meta.get("regularMarketDayHigh"), "low": meta.get("regularMarketDayLow"), "spark": closes,
            "open": meta.get("currentTradingPeriod", {}).get("regular", {}).get("end", 0) > time.time() > meta.get("currentTradingPeriod", {}).get("regular", {}).get("start", 0)}


@router.get("/markets/quotes")
async def quotes(ids: str = "", user: User = Depends(current_user)):
    """Price and today's move for the given ids ("crypto:BTCUSDT,stock:AAPL"), in the order asked."""
    wanted = [i for i in dict.fromkeys(x.strip() for x in ids.split(",")) if ":" in i][:40]
    if not wanted:
        return []

    async def make():
        async with httpx.AsyncClient(headers=UA) as client:
            pairs = [i.split(":", 1)[1] for i in wanted if i.startswith("crypto:")]
            syms = [i.split(":", 1)[1] for i in wanted if i.startswith("stock:")]
            jobs = [_crypto_quotes(client, pairs)] if pairs else []
            jobs += [_stock_quote(client, s) for s in syms]
            found = {}
            for res in await asyncio.gather(*jobs, return_exceptions=True):
                if isinstance(res, dict) and "id" in res:
                    found[res["id"]] = res
                elif isinstance(res, dict):
                    found.update(res)
            return [found.get(i) or {"id": i, "missing": True, "symbol": i.split(":", 1)[1]} for i in wanted]
    return await cached("q:" + ",".join(wanted), 20, make)


# ---------------------------------------------------------------- the shop: Shopify
SHOPIFY_API = "2025-01"
_shop_token: dict = {}


async def _shopify_token(client: httpx.AsyncClient) -> str:
    if settings.shopify_admin_token:
        return settings.shopify_admin_token
    # an app from Shopify's Dev Dashboard installed on our own shop: the token comes from its id + secret and lasts 24 h
    if _shop_token.get("until", 0) > time.time():
        return _shop_token["token"]
    r = await client.post(f"https://{settings.shopify_store}/admin/oauth/access_token", timeout=10,
                          data={"grant_type": "client_credentials", "client_id": settings.shopify_client_id, "client_secret": settings.shopify_client_secret})
    r.raise_for_status()
    body = r.json()
    _shop_token.update(token=body["access_token"], until=time.time() + int(body.get("expires_in", 86399)) - 300)
    return body["access_token"]


ORDERS_QUERY = """query($q: String!, $after: String) {
  orders(first: 100, after: $after, query: $q, sortKey: CREATED_AT, reverse: true) {
    pageInfo { hasNextPage endCursor }
    nodes { name createdAt displayFinancialStatus cancelledAt
      currentTotalPriceSet { shopMoney { amount currencyCode } }
      lineItems(first: 10) { nodes { title quantity } } } } }"""


async def _shopify() -> dict:
    if not (settings.shopify_admin_token or (settings.shopify_client_id and settings.shopify_client_secret)):
        return {"source": "not_connected", "missing": "SHOPIFY_ADMIN_TOKEN"}
    now = datetime.now(timezone.utc)
    since = (now - timedelta(days=30)).strftime("%Y-%m-%d")
    try:
        async with httpx.AsyncClient() as client:
            token = await _shopify_token(client)
            orders, after = [], None
            for _ in range(5):  # up to 500 orders in 30 days
                r = await client.post(f"https://{settings.shopify_store}/admin/api/{SHOPIFY_API}/graphql.json", timeout=15,
                                      headers={"X-Shopify-Access-Token": token},
                                      json={"query": ORDERS_QUERY, "variables": {"q": f"created_at:>={since}", "after": after}})
                r.raise_for_status()
                body = r.json()
                if body.get("errors"):
                    return {"source": "error", "error": str(body["errors"])[:300]}
                page = body["data"]["orders"]
                orders += page["nodes"]
                if not page["pageInfo"]["hasNextPage"]:
                    break
                after = page["pageInfo"]["endCursor"]
    except httpx.HTTPStatusError as e:
        return {"source": "error", "error": f"Shopify respondeu {e.response.status_code}"}
    except httpx.HTTPError as e:
        return {"source": "error", "error": f"Shopify não respondeu ({type(e).__name__})"}

    local = datetime.now().astimezone()
    start_today = local.replace(hour=0, minute=0, second=0, microsecond=0)
    real = [o for o in orders if not o.get("cancelledAt")]

    def window(days: int) -> dict:
        start = start_today - timedelta(days=days - 1)
        rows = [o for o in real if datetime.fromisoformat(o["createdAt"].replace("Z", "+00:00")) >= start]
        revenue = sum(float(o["currentTotalPriceSet"]["shopMoney"]["amount"]) for o in rows)
        return {"orders": len(rows), "revenue": round(revenue, 2), "aov": round(revenue / len(rows), 2) if rows else None}

    sold: dict[str, int] = {}
    for o in real:
        for li in o["lineItems"]["nodes"]:
            sold[li["title"]] = sold.get(li["title"], 0) + li["quantity"]
    currency = orders[0]["currentTotalPriceSet"]["shopMoney"]["currencyCode"] if orders else "EUR"
    # sales per day, oldest first, for the bars
    days = []
    for back in range(13, -1, -1):
        d0 = start_today - timedelta(days=back)
        d1 = d0 + timedelta(days=1)
        days.append(sum(float(o["currentTotalPriceSet"]["shopMoney"]["amount"]) for o in real
                        if d0 <= datetime.fromisoformat(o["createdAt"].replace("Z", "+00:00")) < d1))
    return {"source": "live", "currency": currency, "today": window(1), "week": window(7), "month": window(30), "days": days,
            "top": sorted(({"title": k, "qty": v} for k, v in sold.items()), key=lambda x: -x["qty"])[:4],
            "recent": [{"name": o["name"], "at": o["createdAt"], "total": float(o["currentTotalPriceSet"]["shopMoney"]["amount"]),
                        "status": o["displayFinancialStatus"], "items": ", ".join(f"{li['quantity']}× {li['title']}" for li in o["lineItems"]["nodes"])}
                       for o in real[:5]]}


# ---------------------------------------------------------------- the shop: Meta Ads
FUNNEL = {"landing_page_view": "views", "view_content": "product_views", "add_to_cart": "carts",
          "initiate_checkout": "checkouts", "purchase": "purchases"}


def _funnel(actions: list[dict] | None) -> dict:
    out = {}
    for a in actions or []:
        kind = a.get("action_type", "")
        for key, name in FUNNEL.items():
            # Meta reports the same event as "purchase" and as "offsite_conversion.fb_pixel_purchase": count it once
            if kind == key or (kind.endswith("fb_pixel_" + key) and name not in out):
                out[name] = max(out.get(name, 0), float(a.get("value", 0)))
    return out


async def _meta() -> dict:
    if not (settings.meta_access_token and settings.meta_ad_account):
        return {"source": "not_connected", "missing": "META_ACCESS_TOKEN" if not settings.meta_access_token else "META_AD_ACCOUNT"}
    account = settings.meta_ad_account if settings.meta_ad_account.startswith("act_") else "act_" + settings.meta_ad_account
    fields = "spend,impressions,reach,clicks,inline_link_clicks,ctr,cpc,actions,action_values,purchase_roas"
    out = {"source": "live"}
    try:
        async with httpx.AsyncClient() as client:
            for preset, key in (("today", "today"), ("last_7d", "week"), ("last_30d", "month")):
                r = await client.get(f"https://graph.facebook.com/v21.0/{account}/insights", timeout=15,
                                     params={"fields": fields, "date_preset": preset, "access_token": settings.meta_access_token})
                body = r.json()
                if r.status_code != 200:
                    return {"source": "error", "error": (body.get("error") or {}).get("message", f"Meta respondeu {r.status_code}")[:300]}
                row = (body.get("data") or [{}])[0]
                funnel = _funnel(row.get("actions"))
                value = _funnel(row.get("action_values")).get("purchases")
                spend = float(row.get("spend", 0) or 0)
                out[key] = {"spend": spend, "impressions": int(row.get("impressions", 0) or 0), "reach": int(row.get("reach", 0) or 0),
                            "clicks": int(row.get("inline_link_clicks", row.get("clicks", 0)) or 0), "ctr": float(row.get("ctr", 0) or 0),
                            **funnel, "purchase_value": value, "roas": round(value / spend, 2) if value and spend else None}
    except httpx.HTTPError as e:
        return {"source": "error", "error": f"Meta não respondeu ({type(e).__name__})"}
    return out


@router.get("/store/summary")
async def store_summary(user: User = Depends(current_user)):
    async def make():
        shop, ads = await asyncio.gather(_shopify(), _meta())
        return {"shopify": shop, "meta": ads, "at": datetime.now(timezone.utc).isoformat()}
    return await cached("store", 45, make)
