"""CRM (#/crm): o seguimento do Radar como quadro de negócios (app/crm.py). Só neste PC: nada vai por sync."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from .. import crm
from ..db import get_db
from ..models import User
from ..radar_ficha import FICHAS
from ..security import user_from_jwt
from .tradingroom import viewer

router = APIRouter(prefix="/api/crm")


def _who(user: User) -> str:
    return user.display_name or user.username


@router.get("")
def board(user: User = Depends(viewer)):
    return crm.board()


# abrem fora da página (o widget entrega o download ao browser), por isso com o token na ligação, como o Excel do Radar
@router.get("/folha.csv")
async def folha(token: str = Query(...), db: AsyncSession = Depends(get_db)):
    if not await user_from_jwt(token, db):
        raise HTTPException(401, "Invalid token")
    return Response(crm.folha(), media_type="text/csv; charset=utf-8", headers={"Content-Disposition": 'attachment; filename="crm-amg.csv"'})


@router.get("/reuniao.ics")
async def calendario(key: str = Query(...), token: str = Query(...), db: AsyncSession = Depends(get_db)):
    if not await user_from_jwt(token, db):
        raise HTTPException(401, "Invalid token")
    try:
        return Response(crm.ics(key), media_type="text/calendar; charset=utf-8", headers={"Content-Disposition": 'attachment; filename="reuniao.ics"'})
    except ValueError as e:
        raise HTTPException(404, str(e))


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


@router.post("/novo")
def create(body: dict, user: User = Depends(viewer)):
    try:
        return crm.create(body, _who(user))
    except (ValueError, TypeError) as e:
        raise HTTPException(400, str(e))


@router.post("/remover")
def remove(body: dict, user: User = Depends(viewer)):
    try:
        crm.remove(str(body.get("key") or ""))
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"ok": True}


@router.post("/zoom")
def zoom(body: dict, user: User = Depends(viewer)):
    try:
        return crm.zoom_create(str(body.get("key") or ""), float(body.get("quando") or 0), int(body.get("duracao") or 30), _who(user))
    except (ValueError, TypeError) as e:
        raise HTTPException(400, str(e))


@router.post("/agente")
async def agent(body: dict, user: User = Depends(viewer)):
    # async só por causa da ficha do Radar (FICHAS.start cria uma tarefa no loop); o resto é síncrono e rápido
    try:
        return crm.agent(str(body.get("key") or ""), str(body.get("agente") or ""), _who(user), FICHAS.start)
    except ValueError as e:
        raise HTTPException(400, str(e))
