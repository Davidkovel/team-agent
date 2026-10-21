"""MetaTrader 5 (FundedNext and any MT5 prop firm or broker): the Hub talks to the MT5 terminal installed on this PC through
the official MetaTrader5 package. The terminal has to be installed (C:\\Program Files\\MetaTrader 5, or the firm's own
build), but it does not have to be open: initialize() starts it and logs in with the account's login, password and server.

The package keeps one connection per process and is not thread-safe, so every call goes through `run`, one at a time, on
a single thread of its own. One terminal holds one account at a time: with two MT5 accounts the Hub logs in and out in
turns (a few seconds each), which is fine for a 15-second loop."""
from __future__ import annotations

import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

from . import sessions

log =logging.getLogger("tradingroom.mt5")
UTC = timezone.utc
POOL = ThreadPoolExecutor(max_workers=1, thread_name_prefix="mt5")
_lock = threading.Lock()
_logged: dict = {"login": None, "at": 0.0}

# where the terminal usually is: the generic one from MetaQuotes and the builds the prop firms hand out
TERMINALS = [r"C:\Program Files\MetaTrader 5\terminal64.exe", r"C:\Program Files\FundedNext MT5 Terminal\terminal64.exe",
             r"C:\Program Files\FundedNext MetaTrader 5\terminal64.exe", r"C:\Program Files\MetaTrader 5 FundedNext\terminal64.exe"]

# what our instruments are called at the brokers (the firm adds suffixes: .r, .m, .cash, +...)
ALIASES = {"XAUUSD": ["XAUUSD", "GOLD", "XAUUSDM"], "EURUSD": ["EURUSD"], "GBPUSD": ["GBPUSD"],
           "GER40": ["GER40", "DE40", "DAX40", "GER30", "DE30", "GERMANY40", "DAX"],
           "NAS100": ["NAS100", "US100", "USTEC", "NDX100", "NQ100", "USTECH"], "US30": ["US30", "DJ30", "WS30", "DOW30", "US30CASH"],
           "BTCUSD": ["BTCUSD", "BITCOIN"]}


def lib():
    try:
        import MetaTrader5 as mt5
        return mt5
    except Exception:
        return None


def terminal(path: str = "") -> str:
    """The terminal64.exe to start: the one set on the account, else the first that exists."""
    for p in [path] + TERMINALS + sorted(str(x) for x in Path(os.environ.get("ProgramFiles", r"C:\Program Files")).glob("*/terminal64.exe")):
        if p and Path(p).is_file():
            return p
    return ""


def installed() -> dict:
    return {"package": lib() is not None, "terminal": terminal()}


def run(fn, *args):
    """Runs fn on the MT5 thread (await asyncio.wrap_future(run(...)) from the loop)."""
    return POOL.submit(fn, *args)


def _norm(s: str) -> str:
    return "".join(ch for ch in s.upper() if ch.isalnum())


def _attach(exe: str, number: int | None) -> str | None:
    """No password on the Hub: use the account the terminal itself is logged in to (the person entered it in the MT5 with
    «Guardar password»). The Hub never sees the password; it only checks that it is the right account."""
    mt5 = lib()
    with _lock:
        info = mt5.account_info() if _logged["login"] is not None else None
        if info is None:
            mt5.shutdown()
            if not mt5.initialize(path=exe, timeout=30000):
                code, text = mt5.last_error()
                _logged["login"] = None
                return f"Não consegui abrir o MT5 ({code}: {text})."
            info = mt5.account_info()
        if info is None:
            _logged["login"] = None
            return "O MT5 está aberto mas sem conta: entra na conta da FundedNext no MT5 (Ficheiro › Entrar numa conta de trading) e marca «Guardar password»."
        if number and info.login != number:
            _logged["login"] = None
            return f"O MT5 está na conta {info.login}, não na {number}. Entra na {number} no MT5 (com «Guardar password»)."
        _logged.update(login=info.login, at=time.time())
    return None


def detect(path: str = "") -> dict:
    """The account the MT5 terminal on this PC is logged in to (opens the terminal if it is closed)."""
    mt5 = lib()
    if mt5 is None:
        return {"ok": False, "error": "Falta o pacote MetaTrader5 no Python do Hub (pip install MetaTrader5)."}
    exe = terminal(path)
    if not exe:
        return {"ok": False, "error": "Não encontrei o MetaTrader 5 neste PC."}
    err = _attach(exe, None)
    if err:
        return {"ok": False, "error": err}
    a = mt5.account_info()
    modes = {0: "demo", 1: "concurso", 2: "real"}
    return {"ok": True, "login": a.login, "server": a.server, "name": a.name, "company": a.company, "balance": a.balance,
            "currency": a.currency, "leverage": a.leverage, "kind": modes.get(a.trade_mode, ""), "path": exe}


def login(acc: dict) -> str | None:
    """Logs this account in (only if another one is in). Returns the error, or None."""
    mt5 = lib()
    if mt5 is None:
        return "Falta o pacote MetaTrader5 no Python do Hub (pip install MetaTrader5)."
    exe = terminal(acc.get("path", ""))
    if not exe:
        return "Não encontrei o MetaTrader 5 neste PC. Instala o MT5 da FundedNext (ou o da MetaQuotes) e volta a tentar."
    try:
        number = int(str(acc.get("login", "")).strip())
    except ValueError:
        if acc.get("password"):
            return "O login do MT5 é o número da conta."
        number = 0
    if not acc.get("password"):
        return _attach(exe, number)
    with _lock:
        info = mt5.account_info() if _logged["login"] == number else None
        if info is not None and info.login == number:
            return None
        mt5.shutdown()
        ok = mt5.initialize(path=exe, login=number, password=acc.get("password", ""), server=acc.get("server", "").strip(), timeout=30000)
        if not ok:
            code, text = mt5.last_error()
            _logged["login"] = None
            return f"O MT5 recusou a entrada ({code}: {text}). Confirma o login, a password e o servidor (ex.: FundedNext-Server)."
        _logged.update(login=number, at=time.time())
    return None


def symbol(acc: dict, ours: str) -> str | None:
    """The broker's name for one of our instruments (the account's own map wins)."""
    mt5 = lib()
    named = (acc.get("symbols") or {}).get(ours)
    if named:
        return named
    names = [s.name for s in (mt5.symbols_get() or [])]
    for alias in ALIASES.get(ours, [ours]):
        for n in names:
            if _norm(n) == alias:
                return n
        for n in names:   # with a suffix: XAUUSD.r, GER40.cash
            if _norm(n).startswith(alias) and len(_norm(n)) - len(alias) <= 4:
                return n
    return None


def snapshot(acc: dict, day_start: float) -> dict:
    """Balance, equity, open positions and orders, and today's deals."""
    err = login(acc)
    if err:
        return {"ok": False, "error": err}
    mt5 = lib()
    a = mt5.account_info()
    if a is None:
        return {"ok": False, "error": f"Sem dados da conta ({mt5.last_error()[1]})."}
    positions = [{"ticket": p.ticket, "symbol": p.symbol, "dir": "buy" if p.type == 0 else "sell", "volume": p.volume, "price": p.price_open,
                  "sl": p.sl, "tp": p.tp, "pnl": round(p.profit + p.swap, 2), "magic": p.magic, "comment": p.comment, "at": p.time}
                 for p in (mt5.positions_get() or [])]
    orders = [{"ticket": o.ticket, "symbol": o.symbol, "dir": "buy" if o.type in (2, 4) else "sell", "volume": o.volume_current,
               "price": o.price_open, "sl": o.sl, "tp": o.tp, "magic": o.magic, "comment": o.comment, "at": o.time_setup}
              for o in (mt5.orders_get() or [])]
    deals = []
    for d in mt5.history_deals_get(datetime.fromtimestamp(day_start, UTC), datetime.now(UTC)) or []:
        if d.type not in (0, 1):   # balance, credit, commissions apart
            continue
        deals.append({"ticket": d.ticket, "order": d.order, "position": d.position_id, "symbol": d.symbol, "dir": "buy" if d.type == 0 else "sell",
                      "entry": d.entry, "volume": d.volume, "price": d.price, "pnl": round(d.profit + d.swap + d.commission + d.fee, 2),
                      "magic": d.magic, "comment": d.comment, "at": d.time})
    return {"ok": True, "error": "", "login": a.login, "name": a.name, "server": a.server, "currency": a.currency, "leverage": a.leverage,
            "balance": a.balance, "equity": a.equity, "open_pnl": round(a.profit, 2), "margin_free": a.margin_free,
            "trade_allowed": bool(a.trade_allowed and a.trade_expert and getattr(mt5.terminal_info(), "trade_allowed", True)),
            "positions": positions, "orders": orders, "deals": deals}


def size(acc: dict, ours: str, entry: float, stop: float, money: float) -> dict:
    """The volume that loses `money` from entry to stop, rounded down to the symbol's step."""
    err = login(acc)
    if err:
        return {"ok": False, "error": err}
    mt5 = lib()
    name = symbol(acc, ours)
    if not name or not mt5.symbol_select(name, True):
        return {"ok": False, "error": f"A conta não tem {ours} (mapeia o nome do símbolo nas definições da conta)."}
    s = mt5.symbol_info(name)
    if not s or not s.trade_tick_size or not s.trade_tick_value:
        return {"ok": False, "error": f"Sem especificação de {name}."}
    per_lot = abs(entry - stop) / s.trade_tick_size * s.trade_tick_value
    if per_lot <= 0:
        return {"ok": False, "error": "Entrada e stop iguais."}
    raw = money / per_lot
    step = s.volume_step or .01
    vol = max(0.0, int(raw / step + 1e-9) * step)
    vol = min(vol, s.volume_max)
    out = {"ok": True, "symbol": name, "volume": round(vol, 2), "risk": round(vol * per_lot, 2), "per_lot": round(per_lot, 2),
           "min": s.volume_min, "digits": s.digits}
    if vol < s.volume_min:
        out.update(ok=False, error=f"O risco pedido ({money:.2f}) é menor do que o lote mínimo ({s.volume_min}) arrisca ({s.volume_min * per_lot:.2f}).")
    return out


def _filling(s) -> int:
    mt5 = lib()
    fm = s.filling_mode
    if fm & 1:
        return mt5.ORDER_FILLING_FOK
    if fm & 2:
        return mt5.ORDER_FILLING_IOC
    return mt5.ORDER_FILLING_RETURN


def place(acc: dict, o: dict) -> dict:
    """Sends one order: o = {symbol (ours), dir, entry, stop, tp, money, market, magic, comment, expires (epoch), feed}.
    The prices come from the room's feed (OANDA): they are moved by the gap between the feed and this broker right now."""
    err = login(acc)
    if err:
        return {"ok": False, "error": err}
    mt5 = lib()
    sz = size(acc, o["symbol"], o["entry"], o["stop"], o["money"])
    if not sz["ok"]:
        return sz
    name, digits = sz["symbol"], sz["digits"]
    tick = mt5.symbol_info_tick(name)
    s = mt5.symbol_info(name)
    if not tick or not tick.bid:
        return {"ok": False, "error": f"Sem preço de {name} (mercado fechado?)."}
    gap = ((tick.bid + tick.ask) / 2 - o["feed"]) if o.get("feed") else 0.0
    buy = o["dir"] == "buy"
    entry, sl, tp = (round(x + gap, digits) for x in (o["entry"], o["stop"], o["tp"]))
    req = {"symbol": name, "volume": sz["volume"], "sl": sl, "tp": tp, "magic": int(o["magic"]), "comment": o["comment"][:31],
           "deviation": 20, "type_filling": _filling(s)}
    market = o.get("market") or (buy and tick.ask <= entry) or (not buy and tick.bid >= entry)
    if market:
        req.update(action=mt5.TRADE_ACTION_DEAL, type=mt5.ORDER_TYPE_BUY if buy else mt5.ORDER_TYPE_SELL, price=tick.ask if buy else tick.bid)
    else:
        req.update(action=mt5.TRADE_ACTION_PENDING, type=mt5.ORDER_TYPE_BUY_LIMIT if buy else mt5.ORDER_TYPE_SELL_LIMIT, price=entry,
                   type_filling=mt5.ORDER_FILLING_RETURN)
        if o.get("expires"):
            req.update(type_time=mt5.ORDER_TIME_SPECIFIED, expiration=int(o["expires"]))
    r = mt5.order_send(req)
    if r is None:
        return {"ok": False, "error": f"order_send falhou ({mt5.last_error()[1]})."}
    if r.retcode not in (mt5.TRADE_RETCODE_DONE, mt5.TRADE_RETCODE_PLACED, mt5.TRADE_RETCODE_DONE_PARTIAL):
        return {"ok": False, "error": f"O MT5 recusou a ordem ({r.retcode}: {r.comment})."}
    return {"ok": True, "ticket": r.order, "deal": r.deal, "volume": sz["volume"], "risk": sz["risk"], "symbol": name,
            "price": r.price or req["price"], "market": bool(market), "gap": round(gap, digits)}


def cancel(acc: dict, ticket: int) -> dict:
    err = login(acc)
    if err:
        return {"ok": False, "error": err}
    mt5 = lib()
    r = mt5.order_send({"action": mt5.TRADE_ACTION_REMOVE, "order": int(ticket)})
    return {"ok": bool(r and r.retcode == mt5.TRADE_RETCODE_DONE), "error": "" if r and r.retcode == mt5.TRADE_RETCODE_DONE else f"{r and r.comment}"}


def close(acc: dict, ticket: int, volume: float | None = None) -> dict:
    """Closes one position at the market (or `volume` of it, rounded down to the symbol's step)."""
    err = login(acc)
    if err:
        return {"ok": False, "error": err}
    mt5 = lib()
    ps = mt5.positions_get(ticket=int(ticket)) or []
    if not ps:
        return {"ok": True, "error": ""}
    p = ps[0]
    tick = mt5.symbol_info_tick(p.symbol)
    s = mt5.symbol_info(p.symbol)
    buy = p.type == 0
    vol = p.volume
    if volume:
        step = s.volume_step or .01
        vol = min(p.volume, max(s.volume_min, int(float(volume) / step + 1e-9) * step))
    r = mt5.order_send({"action": mt5.TRADE_ACTION_DEAL, "symbol": p.symbol, "volume": round(vol, 2), "position": p.ticket,
                        "type": mt5.ORDER_TYPE_SELL if buy else mt5.ORDER_TYPE_BUY, "price": tick.bid if buy else tick.ask,
                        "deviation": 30, "magic": p.magic, "comment": "AMG fecho", "type_filling": _filling(s)})
    ok = bool(r and r.retcode == mt5.TRADE_RETCODE_DONE)
    return {"ok": ok, "error": "" if ok else f"{r and r.comment}", "volume": round(vol, 2)}


def modify(acc: dict, ticket: int, sl: float | None, tp: float | None) -> dict:
    """New stop and/or target on a position or a pending order (None = keep, 0 = remove)."""
    err = login(acc)
    if err:
        return {"ok": False, "error": err}
    mt5 = lib()
    ps = mt5.positions_get(ticket=int(ticket)) or []
    if ps:
        p = ps[0]
        d = mt5.symbol_info(p.symbol).digits
        req = {"action": mt5.TRADE_ACTION_SLTP, "position": p.ticket, "symbol": p.symbol, "magic": p.magic,
               "sl": round(p.sl if sl is None else sl, d), "tp": round(p.tp if tp is None else tp, d)}
    else:
        os_ = mt5.orders_get(ticket=int(ticket)) or []
        if not os_:
            return {"ok": False, "error": "Já não existe essa posição nem essa ordem."}
        o = os_[0]
        d = mt5.symbol_info(o.symbol).digits
        req = {"action": mt5.TRADE_ACTION_MODIFY, "order": o.ticket, "symbol": o.symbol, "price": o.price_open,
               "sl": round(o.sl if sl is None else sl, d), "tp": round(o.tp if tp is None else tp, d),
               "type_time": o.type_time, "expiration": o.time_expiration}
    r = mt5.order_send(req)
    ok = bool(r and r.retcode in (mt5.TRADE_RETCODE_DONE, mt5.TRADE_RETCODE_PLACED))
    return {"ok": ok, "error": "" if ok else f"O MT5 recusou ({r and r.retcode}: {r and r.comment})."}


def quotes(acc: dict, ours: list[str]) -> dict:
    """Bid/ask and the contract of our instruments on this account: what the order ticket needs."""
    err = login(acc)
    if err:
        return {"ok": False, "error": err}
    mt5 = lib()
    out = {}
    for o in ours:
        name = symbol(acc, o)
        if not name or not mt5.symbol_select(name, True):
            continue
        s, tick = mt5.symbol_info(name), mt5.symbol_info_tick(name)
        if not s:
            continue
        out[o] = {"name": name, "bid": tick.bid if tick else None, "ask": tick.ask if tick else None, "digits": s.digits, "point": s.point,
                  "min": s.volume_min, "step": s.volume_step, "max": s.volume_max, "stops": s.trade_stops_level,
                  "per_unit": (s.trade_tick_value / s.trade_tick_size) if s.trade_tick_size else None}   # money per 1.0 of price per lot
    return {"ok": True, "quotes": out}


def order(acc: dict, o: dict) -> dict:
    """A trade the person sends from the Hub: o = {symbol (ours), dir, kind (market|limit|stop), entry, sl, tp, money or volume,
    magic, comment}. Prices are the broker's own (the ticket shows its quotes). Always with a stop."""
    err = login(acc)
    if err:
        return {"ok": False, "error": err}
    mt5 = lib()
    name = symbol(acc, o["symbol"])
    if not name or not mt5.symbol_select(name, True):
        return {"ok": False, "error": f"A conta não tem {o['symbol']}."}
    s, tick = mt5.symbol_info(name), mt5.symbol_info_tick(name)
    if not tick or not tick.bid:
        return {"ok": False, "error": f"Sem preço de {name} (mercado fechado?)."}
    buy, kind = o["dir"] == "buy", o.get("kind", "market")
    entry = (tick.ask if buy else tick.bid) if kind == "market" else float(o["entry"])
    sl, tp = float(o.get("sl") or 0), float(o.get("tp") or 0)
    if not sl:
        return {"ok": False, "error": "Sem stop não envio: põe o stop."}
    if (buy and sl >= entry) or (not buy and sl <= entry):
        return {"ok": False, "error": "O stop está do lado errado da entrada."}
    if tp and ((buy and tp <= entry) or (not buy and tp >= entry)):
        return {"ok": False, "error": "O alvo está do lado errado da entrada."}
    if o.get("volume"):
        step = s.volume_step or .01
        vol = min(s.volume_max, int(float(o["volume"]) / step + 1e-9) * step)
        per_lot = abs(entry - sl) / s.trade_tick_size * s.trade_tick_value
        risk = vol * per_lot
    else:
        sz = size(acc, o["symbol"], entry, sl, float(o["money"]))
        if not sz["ok"]:
            return sz
        vol, risk = sz["volume"], sz["risk"]
    if vol < s.volume_min:
        return {"ok": False, "error": f"Lote abaixo do mínimo ({s.volume_min})."}
    d = s.digits
    req = {"symbol": name, "volume": round(vol, 2), "sl": round(sl, d), "tp": round(tp, d), "magic": int(o.get("magic", 0)),
           "comment": str(o.get("comment", "AMG manual"))[:31], "deviation": 20, "type_filling": _filling(s)}
    if kind == "market":
        req.update(action=mt5.TRADE_ACTION_DEAL, type=mt5.ORDER_TYPE_BUY if buy else mt5.ORDER_TYPE_SELL, price=entry)
    else:
        types = {("limit", True): mt5.ORDER_TYPE_BUY_LIMIT, ("limit", False): mt5.ORDER_TYPE_SELL_LIMIT,
                 ("stop", True): mt5.ORDER_TYPE_BUY_STOP, ("stop", False): mt5.ORDER_TYPE_SELL_STOP}
        if (kind == "limit") == (entry > tick.ask if buy else entry < tick.bid):
            return {"ok": False, "error": f"Uma ordem {kind} de {'compra' if buy else 'venda'} tem de ficar {'abaixo' if (kind == 'limit') == buy else 'acima'} do preço."}
        req.update(action=mt5.TRADE_ACTION_PENDING, type=types[(kind, buy)], price=round(entry, d), type_filling=mt5.ORDER_FILLING_RETURN)
    r = mt5.order_send(req)
    if r is None:
        return {"ok": False, "error": f"order_send falhou ({mt5.last_error()[1]})."}
    if r.retcode not in (mt5.TRADE_RETCODE_DONE, mt5.TRADE_RETCODE_PLACED, mt5.TRADE_RETCODE_DONE_PARTIAL):
        return {"ok": False, "error": f"O MT5 recusou a ordem ({r.retcode}: {r.comment})."}
    return {"ok": True, "ticket": r.order, "volume": round(vol, 2), "risk": round(risk, 2), "symbol": name, "price": r.price or entry}


def history(acc: dict, since: float = 0.0) -> dict:
    """Every deal since `since` (balance deals too: the first deposit is the account size) and the stop each position was
    opened with (from its orders), for the account's dashboard."""
    err = login(acc)
    if err:
        return {"ok": False, "error": err}
    mt5 = lib()
    start, end = datetime.fromtimestamp(since or 946684800, UTC), datetime.now(UTC) + timedelta(days=1)
    deals = [{"ticket": d.ticket, "order": d.order, "position": d.position_id, "symbol": d.symbol, "type": d.type, "entry": d.entry,
              "volume": d.volume, "price": d.price, "profit": d.profit, "swap": d.swap, "commission": d.commission, "fee": d.fee,
              "magic": d.magic, "comment": d.comment, "at": d.time} for d in (mt5.history_deals_get(start, end) or [])]
    stops: dict = {}
    for o in mt5.history_orders_get(start, end) or []:
        if o.position_id and o.sl and o.position_id not in stops:
            stops[o.position_id] = o.sl
    for p in mt5.positions_get() or []:
        stops.setdefault(p.ticket, p.sl)
    return {"ok": True, "deals": deals, "stops": stops, "offset": server_offset(acc)}


def server_offset(acc: dict) -> int:
    """Seconds the trade server's clock is ahead of UTC (MT5 gives every time in server time). From a fresh tick when the
    market is open, else the usual prop/broker clock: New York + 7 h (midnight = 17:00 New York)."""
    mt5 = lib()
    now = time.time()
    for ours in ("EURUSD", "XAUUSD"):
        name = symbol(acc, ours)
        tick = mt5.symbol_info_tick(name) if name else None
        if tick and tick.time:
            off = round((tick.time - now) / 1800) * 1800
            if abs(tick.time - off - now) < 120 and abs(off) <= 14 * 3600:
                return int(off)
    return (7 - sessions.ny_offset(datetime.now(UTC))) * 3600
