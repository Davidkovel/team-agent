"""Radar (#/radar): a máquina de prospeção (app/radar.py). Só neste PC: nada vai por sync."""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from .. import radar_doc
from ..db import get_db
from ..models import User
from ..radar import ESTADOS, RADAR, RAMOS
from ..security import user_from_jwt
from .tradingroom import viewer

router = APIRouter(prefix="/api/radar")


@router.get("")
def view(user: User = Depends(viewer)):
    return {"ramos": {k: v[0] for k, v in RAMOS.items()}, "estados": ESTADOS, "varreduras": RADAR.list(), "seguimento": RADAR.leads()}


@router.post("/{sid}/{nid}/lead")
def lead(sid: str, nid: str, body: dict, user: User = Depends(viewer)):
    try:
        return RADAR.set_lead(sid, nid, str(body.get("estado") or ""), body.get("nota"), user.display_name or user.username)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/{sid}/{nid}/pdf")
async def pdf(sid: str, nid: str, token: str = Query(...), db: AsyncSession = Depends(get_db)):
    """O diagnóstico em PDF; o token vai no endereço porque abre no browser."""
    if not await user_from_jwt(token, db):
        raise HTTPException(401, "Invalid token")
    await db.commit()
    try:
        path = await asyncio.to_thread(radar_doc.pdf, RADAR.get(sid), nid)
    except ValueError as e:
        raise HTTPException(404, str(e))
    except RuntimeError as e:
        raise HTTPException(500, str(e))
    return FileResponse(path, media_type="application/pdf", headers={"Content-Disposition": f'inline; filename="diagnostico-{nid}.pdf"'})


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
