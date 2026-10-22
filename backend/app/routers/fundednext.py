"""Painel FundedNext (#/fundednext): the prop account's dashboard (tradingroom/fundednext.py), its order ticket and the
buttons on its positions and orders. The account is the Escritório de Robôs' (robots.OFFICE), read through the MT5 API on
this PC; sending, closing and changing anything only from this PC or its owner's phone (`_here`). Nothing goes by sync."""
from __future__ import annotations

import asyncio
import subprocess

from fastapi import APIRouter, Depends, HTTPException, Request

from ..models import User
from ..tradingroom import fundednext as fn
from ..tradingroom import mt5
from ..tradingroom.robots import OFFICE
from ..tradingroom.room import publish
from .local import local_or_team_key
from .robots import _here
from .tradingroom import viewer

router = APIRouter(prefix="/api/fundednext")


async def _run(acc: dict, f, *args):
    """MT5 calls go one at a time on the MT5 thread; MetaApi on a worker thread."""
    if acc.get("link", "mt5") == "mt5":
        return await asyncio.wrap_future(mt5.run(f, *args))
    return await asyncio.to_thread(f, *args)


def _acc(aid: str) -> dict:
    acc = OFFICE.account(aid)
    if acc is None:
        raise HTTPException(404, "Conta desconhecida")
    return acc


def _lib(acc: dict, name: str):
    f = getattr(OFFICE.lib(acc), name, None)
    if f is None:
        raise HTTPException(400, "Isto só funciona pela API do MetaTrader 5 neste PC.")
    return f


async def _view(aid: str | None, risk: float = 0.5, fresh: bool = False) -> dict:
    out = fn.overview()
    ids = [a["id"] for a in out["accounts"]]
    aid = aid if aid in ids else (ids[0] if ids else None)
    if aid:
        acc = OFFICE.account(aid)
        try:
            out["dash"] = await _run(acc, fn.dash, aid, risk, fresh)
        except Exception as e:  # shown on the page
            out["dash"] = {"id": aid, "account": OFFICE.public(acc), "error": f"Erro a ler a conta: {e}"}
    return out


@router.get("")
async def view(acc: str = "", risk: float = 0.5, fresh: bool = False, user: User = Depends(viewer)):
    return await _view(acc or None, max(.05, min(5.0, risk)), fresh)


@router.get("/widget")
def widget(request: Request):
    """The widget's FundedNext card (the widget has no sign-in: this PC, or a widget that knows the team key)."""
    local_or_team_key(request)
    return fn.summary()


@router.post("/detect")
async def detect(body: dict, request: Request, user: User = Depends(viewer)):
    """«Apanhar do MT5»: the account the MT5 on this PC is logged in to becomes the panel's account (no password on the Hub)."""
    _here(request)
    found = await asyncio.wrap_future(mt5.run(mt5.detect, ""))
    if not found.get("ok"):
        return {"found": found, **await _view(None)}
    fundednext = "fundednext" in (found.get("server", "") + found.get("company", "")).lower()
    if not fundednext and not body.get("force"):
        return {"found": found, "ask": True, **await _view(None)}
    acc = next((a for a in OFFICE.state["accounts"] if str(a.get("login")) == str(found["login"])), None)
    acc = OFFICE.save_account({"id": acc["id"] if acc else "", "name": (acc or {}).get("name") or f"FundedNext {found['login']}", "link": "mt5",
                               "login": str(found["login"]), "server": found["server"], "path": found.get("path", ""),
                               "preset": (acc or {}).get("preset") or "fn-stellar-2"})
    await OFFICE.test(acc["id"])
    await publish()
    return {"found": found, **await _view(acc["id"], fresh=True)}


@router.post("/open-mt5")
async def open_mt5(request: Request, user: User = Depends(viewer)):
    _here(request)
    exe = mt5.terminal()
    if not exe:
        raise HTTPException(404, "Não encontrei o MetaTrader 5 neste PC.")
    subprocess.Popen([exe], creationflags=getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0), close_fds=True)
    return {"ok": True, "path": exe}


@router.post("/{aid}/settings")
async def settings(aid: str, body: dict, user: User = Depends(viewer)):
    """Phase, program, size, start, the person's daily stop and goal, the reward's split and dates. No secrets here."""
    acc = _acc(aid)
    body = {k: v for k, v in body.items() if k not in ("password", "token", "id", "link", "login", "server", "path")}
    try:
        OFFICE.save_account({**body, "id": acc["id"]})
    except (ValueError, TypeError) as e:
        raise HTTPException(400, str(e))
    await publish()
    return await _view(aid)


@router.get("/{aid}/quotes")
async def quotes(aid: str, user: User = Depends(viewer)):
    acc = _acc(aid)
    return await _run(acc, fn.quotes, acc)


@router.post("/{aid}/order")
async def order(aid: str, body: dict, request: Request, user: User = Depends(viewer)):
    """The ticket: a market, limit or stop order with its stop, sized by risk % (or lots). Refused when the stop would cross
    today's floor (the firm's or the person's own) or when the prop guard has closed the day."""
    _here(request)
    acc = _acc(aid)
    send, sizes = _lib(acc, "order"), _lib(acc, "quotes")
    g = OFFICE.guard(acc)
    if not g.get("ok"):
        raise HTTPException(400, g.get("why") or "Sem ligação à conta.")
    if g.get("panic"):
        raise HTTPException(400, g["why"])
    snap = OFFICE.snaps.get(aid) or {}
    o = {"symbol": str(body.get("symbol", "")), "dir": "buy" if body.get("dir") == "buy" else "sell", "kind": body.get("kind") if body.get("kind") in ("market", "limit", "stop") else "market",
         "entry": float(body.get("entry") or 0), "sl": float(body.get("sl") or 0), "tp": float(body.get("tp") or 0),
         "magic": fn.MANUAL_MAGIC, "comment": "AMG painel"}
    if body.get("volume"):
        o["volume"] = float(body["volume"])
    else:
        o["money"] = snap.get("balance", 0) * max(.01, min(5.0, float(body.get("risk") or .5))) / 100
    obj = fn.objectives(acc, snap, g, 0, .5)
    left = obj.get("left_today")

    def work():
        q = sizes(OFFICE.full(acc), [o["symbol"]])
        spec = (q.get("quotes") or {}).get(o["symbol"]) if q.get("ok") else None
        if spec and left is not None:
            entry = (spec["ask"] if o["dir"] == "buy" else spec["bid"]) if o["kind"] == "market" else o["entry"]
            risk = o.get("money") or (o.get("volume", 0) * abs(entry - o["sl"]) * (spec["per_unit"] or 0))
            if o["sl"] and risk > left + 1e-6:
                return {"ok": False, "error": f"Se bater no stop perdes {risk:.2f} e hoje só podes perder {left:.2f} (o limite da prop ou o teu stop do dia)."}
        return send(OFFICE.full(acc), o)
    res = await _run(acc, work)
    if not res.get("ok"):
        OFFICE.note(f"Painel: a ordem não entrou — {res.get('error')}", "bad", aid)
        raise HTTPException(400, res.get("error") or "A ordem não entrou.")
    OFFICE.note(f"Painel: {'compra' if o['dir'] == 'buy' else 'venda'} {res['volume']} {res['symbol']} "
                f"{ {'market': 'a mercado', 'limit': 'limite', 'stop': 'stop'}[o['kind']] } (risco {res['risk']:.2f}).", "trade", aid)
    OFFICE.save(True)
    await publish()
    return {"result": res, **await _view(aid, fresh=True)}


@router.post("/{aid}/close")
async def close(aid: str, body: dict, request: Request, user: User = Depends(viewer)):
    """Close a position, or half of it (`half`)."""
    _here(request)
    acc = _acc(aid)
    f = _lib(acc, "close")
    ticket = int(body.get("ticket") or 0)
    pos = next((p for p in (OFFICE.snaps.get(aid) or {}).get("positions", []) if p["ticket"] == ticket), None)
    vol = round(pos["volume"] / 2, 2) if body.get("half") and pos else None
    res = await _run(acc, f, OFFICE.full(acc), ticket, vol) if vol else await _run(acc, f, OFFICE.full(acc), ticket)
    if not res.get("ok"):
        raise HTTPException(400, res.get("error") or "Não fechou.")
    sym = f" ({pos['symbol']})" if pos else ''
    OFFICE.note(f"Painel: fechei {'metade de ' if vol else ''}{ticket}{sym}.", "trade", aid)
    await publish()
    return await _view(aid, fresh=True)


@router.post("/{aid}/cancel")
async def cancel(aid: str, body: dict, request: Request, user: User = Depends(viewer)):
    _here(request)
    acc = _acc(aid)
    res = await _run(acc, _lib(acc, "cancel"), OFFICE.full(acc), int(body.get("ticket") or 0))
    if not res.get("ok"):
        raise HTTPException(400, res.get("error") or "Não cancelou.")
    OFFICE.note(f"Painel: cancelei a ordem {body.get('ticket')}.", "info", aid)
    return await _view(aid, fresh=True)


@router.post("/{aid}/modify")
async def modify(aid: str, body: dict, request: Request, user: User = Depends(viewer)):
    """New stop/target; `be` puts the stop at the entry (break-even)."""
    _here(request)
    acc = _acc(aid)
    f = _lib(acc, "modify")
    ticket = int(body.get("ticket") or 0)
    snap = OFFICE.snaps.get(aid) or {}
    pos = next((p for p in snap.get("positions", []) + snap.get("orders", []) if p["ticket"] == ticket), None)
    sl = pos["price"] if body.get("be") and pos else (float(body["sl"]) if body.get("sl") not in (None, "") else None)
    tp = float(body["tp"]) if body.get("tp") not in (None, "") else None
    res = await _run(acc, f, OFFICE.full(acc), ticket, sl, tp)
    if not res.get("ok"):
        raise HTTPException(400, res.get("error") or "Não mudou.")
    OFFICE.note(f"Painel: {ticket} — {'stop na entrada' if body.get('be') else 'stop/alvo mudados'}.", "info", aid)
    return await _view(aid, fresh=True)


@router.post("/{aid}/close-all")
async def close_all(aid: str, request: Request, user: User = Depends(viewer)):
    """Everything on the account (his trades and the robots'): orders cancelled, positions closed, the account back to Observar."""
    _here(request)
    acc = _acc(aid)
    lib, full = OFFICE.lib(acc), OFFICE.full(acc)

    def work():
        snap = lib.snapshot(full, 0)
        if not snap.get("ok"):
            return snap.get("error")
        bad = 0
        for o in snap["orders"]:
            bad += not lib.cancel(full, o["ticket"]).get("ok")
        for p in snap["positions"]:
            bad += not lib.close(full, p["ticket"]).get("ok")
        return f"{len(snap['orders'])} ordens e {len(snap['positions'])} posições" + (f" ({bad} falharam)" if bad else "")
    res = await _run(acc, work)
    acc["mode"] = "observar"
    OFFICE.note(f"Painel: fechar tudo — {res}; modo observar.", "warn", aid)
    OFFICE.save(True)
    await publish()
    return {"result": res, **await _view(aid, fresh=True)}
