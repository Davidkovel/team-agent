"""Escritório de Robôs (#/robos): the room's robots, the real accounts behind them (FundedNext by the MT5 API or MetaApi)
and the prop guard (tradingroom/robots.py). The accounts and their secrets live on this PC only: nothing here goes by sync."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request

from ..models import User
from ..tradingroom.robots import OFFICE, loop  # noqa: F401  (loop: started by main.py)
from ..tradingroom.room import publish
from .tradingroom import viewer

router = APIRouter(prefix="/api/robots")


def _here(request: Request):
    """Turning an account automatic, or sending its password, only from this PC or its owner's phone (not by sync)."""
    host = request.client.host if request.client else ""
    if not (host.startswith("127.") or host == "::1" or host.startswith("100.") or host.startswith("fd7a:")):
        raise HTTPException(403, "Isto só se faz no PC onde está a conta (ou no telemóvel dele).")


@router.get("")
async def office(user: User = Depends(viewer)):
    return OFFICE.out()


@router.get("/tuning")
async def tuning(user: User = Depends(viewer)):
    return OFFICE.tuning()


@router.post("/robot/{rid}")
async def robot_save(rid: str, body: dict, user: User = Depends(viewer)):
    try:
        OFFICE.save_robot(rid[:30], body)
    except ValueError as e:
        raise HTTPException(400, str(e))
    await publish()
    return OFFICE.out()


@router.delete("/robot/{rid}")
async def robot_remove(rid: str, user: User = Depends(viewer)):
    OFFICE.remove_robot(rid)
    await publish()
    return OFFICE.out()


@router.post("/account")
async def account_save(body: dict, request: Request, user: User = Depends(viewer)):
    if body.get("password") or body.get("token"):
        _here(request)
    acc = OFFICE.save_account(body)
    if acc["id"] in OFFICE.secrets or acc.get("link") == "metaapi":
        try:
            await OFFICE.test(acc["id"])
        except Exception as e:  # shown on the account
            OFFICE.snaps[acc["id"]] = {"ok": False, "error": str(e)}
    return OFFICE.out()


@router.delete("/account/{aid}")
async def account_remove(aid: str, request: Request, user: User = Depends(viewer)):
    _here(request)
    OFFICE.remove_account(aid)
    return OFFICE.out()


@router.post("/account/{aid}/test")
async def account_test(aid: str, user: User = Depends(viewer)):
    try:
        await OFFICE.test(aid)
    except KeyError:
        raise HTTPException(404, "Conta desconhecida")
    return OFFICE.out()


@router.post("/account/{aid}/mode")
async def account_mode(aid: str, body: dict, request: Request, user: User = Depends(viewer)):
    _here(request)
    try:
        OFFICE.set_mode(aid, str(body.get("mode", "")))
    except KeyError:
        raise HTTPException(404, "Conta desconhecida")
    except ValueError as e:
        raise HTTPException(400, str(e) or "Modo desconhecido")
    await publish()
    return OFFICE.out()


@router.post("/account/{aid}/flatten")
async def account_flatten(aid: str, user: User = Depends(viewer)):
    try:
        res = await OFFICE.flatten(aid)
    except KeyError:
        raise HTTPException(404, "Conta desconhecida")
    await publish()
    return {**OFFICE.out(), "flatten": res}


@router.get("/size")
async def size(account: str, symbol: str, entry: float, stop: float, risk: float = 0.5, user: User = Depends(viewer)):
    try:
        return await OFFICE.size(account, symbol, entry, stop, risk)
    except KeyError:
        raise HTTPException(404, "Conta desconhecida")
