"""MetaApi (metaapi.cloud): the same MT5 account through a REST API in the cloud, for when the PC should not keep a
terminal (or for a Mac). The account is added once on app.metaapi.cloud (login, password, server: FundedNext-Server...);
the Hub only needs the token and the account id. Same functions as mt5.py, so the rest of the room does not care which.

Note: MetaApi logs in from its own servers, so the prop firm sees another IP than the person's. The MT5 API on the PC
(mt5.py) keeps the person's IP and is the default."""
from __future__ import annotations

from datetime import datetime, timezone

import httpx

from .mt5 import ALIASES, _norm

UTC = timezone.utc
REGIONS = ("london", "new-york", "singapore", "vint-hill")


def installed() -> dict:
    return {"package": True, "terminal": "cloud"}


def _base(acc: dict) -> str:
    region = acc.get("region") if acc.get("region") in REGIONS else "london"
    return f"https://mt-client-api-v1.{region}.agiliumtrade.ai/users/current/accounts/{acc.get('account_id', '').strip()}"


def _call(acc: dict, method: str, path: str, body: dict | None = None):
    if not acc.get("token") or not acc.get("account_id"):
        raise RuntimeError("Falta o token ou o id da conta da MetaApi.")
    r = httpx.request(method, _base(acc) + path, json=body, timeout=20, headers={"auth-token": acc["token"].strip()})
    if r.status_code == 401:
        raise RuntimeError("A MetaApi recusou o token.")
    if r.status_code == 404:
        raise RuntimeError("A MetaApi não conhece esta conta (confirma o id e se está «deployed»).")
    if r.status_code >= 400:
        try:
            msg = r.json().get("message") or r.text
        except ValueError:
            msg = r.text
        raise RuntimeError(f"MetaApi {r.status_code}: {str(msg)[:200]}")
    return r.json() if r.content else None


def _ts(s: str | None) -> float:
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00")).timestamp()
    except ValueError:
        return 0.0


def snapshot(acc: dict, day_start: float) -> dict:
    try:
        a = _call(acc, "GET", "/account-information")
        ps = _call(acc, "GET", "/positions") or []
        os_ = _call(acc, "GET", "/orders") or []
        start = datetime.fromtimestamp(day_start, UTC).isoformat().replace("+00:00", "Z")
        end = datetime.now(UTC).isoformat().replace("+00:00", "Z")
        ds = _call(acc, "GET", f"/history-deals/time/{start}/{end}") or []
    except (RuntimeError, httpx.HTTPError) as e:
        return {"ok": False, "error": str(e)}
    positions = [{"ticket": str(p["id"]), "symbol": p["symbol"], "dir": "buy" if p["type"].endswith("BUY") else "sell", "volume": p["volume"],
                  "price": p["openPrice"], "sl": p.get("stopLoss"), "tp": p.get("takeProfit"),
                  "pnl": round(p.get("profit", 0) + p.get("swap", 0), 2), "magic": p.get("magic", 0), "comment": p.get("comment", ""),
                  "at": _ts(p.get("time"))} for p in ps]
    orders = [{"ticket": str(o["id"]), "symbol": o["symbol"], "dir": "buy" if "BUY" in o["type"] else "sell", "volume": o.get("currentVolume", o.get("volume")),
               "price": o.get("openPrice"), "sl": o.get("stopLoss"), "tp": o.get("takeProfit"), "magic": o.get("magic", 0),
               "comment": o.get("comment", ""), "at": _ts(o.get("time"))} for o in os_]
    deals = []
    for d in ds:
        if d.get("type") not in ("DEAL_TYPE_BUY", "DEAL_TYPE_SELL"):
            continue
        deals.append({"ticket": str(d["id"]), "order": str(d.get("orderId", "")), "position": str(d.get("positionId", "")), "symbol": d.get("symbol"),
                      "dir": "buy" if d["type"] == "DEAL_TYPE_BUY" else "sell", "entry": 1 if d.get("entryType") == "DEAL_ENTRY_OUT" else 0,
                      "volume": d.get("volume"), "price": d.get("price"),
                      "pnl": round(d.get("profit", 0) + d.get("swap", 0) + d.get("commission", 0), 2), "magic": d.get("magic", 0),
                      "comment": d.get("comment", ""), "at": _ts(d.get("time"))})
    return {"ok": True, "error": "", "login": a.get("login"), "name": a.get("name"), "server": a.get("server"), "currency": a.get("currency"),
            "leverage": a.get("leverage"), "balance": a.get("balance"), "equity": a.get("equity"),
            "open_pnl": round((a.get("equity") or 0) - (a.get("balance") or 0), 2), "margin_free": a.get("freeMargin"),
            "trade_allowed": bool(a.get("tradeAllowed", True)), "positions": positions, "orders": orders, "deals": deals}


def symbol(acc: dict, ours: str) -> str | None:
    named = (acc.get("symbols") or {}).get(ours)
    if named:
        return named
    names = _call(acc, "GET", "/symbols") or []
    for alias in ALIASES.get(ours, [ours]):
        for n in names:
            if _norm(n) == alias:
                return n
        for n in names:
            if _norm(n).startswith(alias) and len(_norm(n)) - len(alias) <= 4:
                return n
    return None


def size(acc: dict, ours: str, entry: float, stop: float, money: float) -> dict:
    try:
        name = symbol(acc, ours)
        if not name:
            return {"ok": False, "error": f"A conta não tem {ours} (mapeia o nome do símbolo nas definições da conta)."}
        spec = _call(acc, "GET", f"/symbols/{name}/specification")
        price = _call(acc, "GET", f"/symbols/{name}/current-price")
    except (RuntimeError, httpx.HTTPError) as e:
        return {"ok": False, "error": str(e)}
    tick, value = spec.get("tickSize"), price.get("lossTickValue") or price.get("profitTickValue")
    if not tick or not value:
        return {"ok": False, "error": f"Sem especificação de {name}."}
    per_lot = abs(entry - stop) / tick * value
    if per_lot <= 0:
        return {"ok": False, "error": "Entrada e stop iguais."}
    step = spec.get("volumeStep") or .01
    vol = min(int(money / per_lot / step + 1e-9) * step, spec.get("maxVolume") or 100)
    out = {"ok": True, "symbol": name, "volume": round(vol, 2), "risk": round(vol * per_lot, 2), "per_lot": round(per_lot, 2),
           "min": spec.get("minVolume") or .01, "digits": spec.get("digits", 5), "bid": price.get("bid"), "ask": price.get("ask")}
    if vol < out["min"]:
        out.update(ok=False, error=f"O risco pedido ({money:.2f}) é menor do que o lote mínimo ({out['min']}) arrisca ({out['min'] * per_lot:.2f}).")
    return out


def place(acc: dict, o: dict) -> dict:
    sz = size(acc, o["symbol"], o["entry"], o["stop"], o["money"])
    if not sz["ok"]:
        return sz
    bid, ask, digits = sz.get("bid"), sz.get("ask"), sz["digits"]
    if not bid:
        return {"ok": False, "error": f"Sem preço de {sz['symbol']} (mercado fechado?)."}
    gap = ((bid + ask) / 2 - o["feed"]) if o.get("feed") else 0.0
    buy = o["dir"] == "buy"
    entry, sl, tp = (round(x + gap, digits) for x in (o["entry"], o["stop"], o["tp"]))
    market = o.get("market") or (buy and ask <= entry) or (not buy and bid >= entry)
    body = {"symbol": sz["symbol"], "volume": sz["volume"], "stopLoss": sl, "takeProfit": tp, "comment": o["comment"][:26],
            "magic": int(o["magic"]), "actionType": ("ORDER_TYPE_BUY" if buy else "ORDER_TYPE_SELL") if market
            else ("ORDER_TYPE_BUY_LIMIT" if buy else "ORDER_TYPE_SELL_LIMIT")}
    if not market:
        body["openPrice"] = entry
        if o.get("expires"):
            body["expiration"] = {"type": "ORDER_TIME_SPECIFIED", "time": datetime.fromtimestamp(o["expires"], UTC).isoformat().replace("+00:00", "Z")}
    try:
        r = _call(acc, "POST", "/trade", body)
    except (RuntimeError, httpx.HTTPError) as e:
        return {"ok": False, "error": str(e)}
    if r.get("stringCode") not in ("TRADE_RETCODE_DONE", "TRADE_RETCODE_PLACED", "TRADE_RETCODE_DONE_PARTIAL"):
        return {"ok": False, "error": f"A conta recusou a ordem ({r.get('stringCode')}: {r.get('message')})."}
    return {"ok": True, "ticket": str(r.get("orderId") or r.get("positionId")), "volume": sz["volume"], "risk": sz["risk"],
            "symbol": sz["symbol"], "price": entry if not market else (ask if buy else bid), "market": bool(market), "gap": round(gap, digits)}


def cancel(acc: dict, ticket) -> dict:
    try:
        r = _call(acc, "POST", "/trade", {"actionType": "ORDER_CANCEL", "orderId": str(ticket)})
        return {"ok": r.get("stringCode") == "TRADE_RETCODE_DONE", "error": r.get("message", "")}
    except (RuntimeError, httpx.HTTPError) as e:
        return {"ok": False, "error": str(e)}


def close(acc: dict, ticket) -> dict:
    try:
        r = _call(acc, "POST", "/trade", {"actionType": "POSITION_CLOSE_ID", "positionId": str(ticket)})
        return {"ok": r.get("stringCode") == "TRADE_RETCODE_DONE", "error": r.get("message", "")}
    except (RuntimeError, httpx.HTTPError) as e:
        return {"ok": False, "error": str(e)}
