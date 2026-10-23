"""Radar (#/radar): a máquina de prospeção (app/radar.py). Só neste PC: nada vai por sync."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from ..models import User
from ..radar import RADAR, RAMOS
from .tradingroom import viewer

router = APIRouter(prefix="/api/radar")


@router.get("")
def view(user: User = Depends(viewer)):
    return {"ramos": {k: v[0] for k, v in RAMOS.items()}, "varreduras": RADAR.list()}


@router.post("")
async def start(body: dict, user: User = Depends(viewer)):
    try:
        return RADAR.start(body.get("ramo", "escolas"), body.get("local", ""), body.get("raio", 15), body.get("lista", ""), user.username)
    except (ValueError, TypeError) as e:
        raise HTTPException(400, str(e))


@router.get("/{sid}")
def one(sid: str, user: User = Depends(viewer)):
    try:
        return RADAR.get(sid)
    except ValueError as e:
        raise HTTPException(404, str(e))


@router.delete("/{sid}")
def delete(sid: str, user: User = Depends(viewer)):
    try:
        RADAR.delete(sid)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"ok": True}
