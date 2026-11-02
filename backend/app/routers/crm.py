"""CRM (#/crm): o seguimento do Radar como quadro de negócios (app/crm.py). Só neste PC: nada vai por sync."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from .. import crm
from ..models import User
from ..radar_ficha import FICHAS
from .tradingroom import viewer

router = APIRouter(prefix="/api/crm")


def _who(user: User) -> str:
    return user.display_name or user.username


@router.get("")
def board(user: User = Depends(viewer)):
    return crm.board()


@router.post("/add")
def add(body: dict, user: User = Depends(viewer)):
    try:
        return crm.add(str(body.get("sid") or ""), str(body.get("nid") or ""), _who(user))
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/lead")
def update(body: dict, user: User = Depends(viewer)):
    try:
        return crm.update(str(body.get("key") or ""), body, _who(user))
    except (ValueError, TypeError) as e:
        raise HTTPException(400, str(e))


@router.post("/agente")
async def agent(body: dict, user: User = Depends(viewer)):
    # async só por causa da ficha do Radar (FICHAS.start cria uma tarefa no loop); o resto é síncrono e rápido
    try:
        return crm.agent(str(body.get("key") or ""), str(body.get("agente") or ""), _who(user), FICHAS.start)
    except ValueError as e:
        raise HTTPException(400, str(e))
