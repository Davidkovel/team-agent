"""Fábrica Etsy (#/etsy): os lotes do Riddler, da Catwoman e do Joker (app/etsy.py). Só neste PC: nada vai por sync."""
from __future__ import annotations

import re

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..etsy import DIR, FACTORY, loop  # noqa: F401  (loop: started by main.py)
from ..models import User
from ..security import user_from_jwt
from .tradingroom import viewer

router = APIRouter(prefix="/api/etsy")


@router.get("")
def view(user: User = Depends(viewer)):
    return FACTORY.out()


@router.post("/cfg")
def cfg(body: dict, user: User = Depends(viewer)):
    try:
        FACTORY.set_cfg(body)
        if body.get("on"):  # quem liga é quem recebe os avisos dos lotes
            FACTORY.state["cfg"]["owner"] = user.username
            FACTORY.save()
    except (ValueError, TypeError) as e:
        raise HTTPException(400, str(e))
    return FACTORY.out()


@router.post("/run")
async def run(user: User = Depends(viewer)):
    if not FACTORY.out()["installed"]:
        raise HTTPException(400, "O Claude Code não está instalado neste PC")
    FACTORY.state["cfg"]["owner"] = FACTORY.state["cfg"].get("owner") or user.username
    if not FACTORY.start("à mão"):
        raise HTTPException(409, "Já há um lote a correr")
    return FACTORY.out()


@router.post("/item/{item_id}")
def item(item_id: str, body: dict, user: User = Depends(viewer)):
    try:
        FACTORY.set_status(item_id, str(body.get("status") or ""))
    except KeyError:
        raise HTTPException(404, "Desenho não encontrado")
    except ValueError as e:
        raise HTTPException(400, str(e))
    return FACTORY.out()


@router.post("/rewrite")
async def rewrite(body: dict, user: User = Depends(viewer)):
    ids = [str(i) for i in body.get("ids") or []] or [i["id"] for i in FACTORY.state["items"] if i["status"] in ("new", "approved")]
    if not FACTORY.start_rewrite(ids):
        raise HTTPException(409, "Já há um lote a correr")
    return FACTORY.out()


@router.post("/sale")
def sale(body: dict, user: User = Depends(viewer)):
    try:
        FACTORY.add_sale(float(body.get("amount") or 0), str(body.get("note") or ""))
    except (ValueError, TypeError) as e:
        raise HTTPException(400, str(e))
    return FACTORY.out()


@router.get("/file/{item_id}/{name}")
async def file(item_id: str, name: str, token: str = Query(...), db: AsyncSession = Depends(get_db)):
    """O PNG ou o SVG de um desenho; o token vai no endereço porque é um <img> ou um download."""
    if not await user_from_jwt(token, db):
        raise HTTPException(401, "Invalid token")
    if not re.fullmatch(r"[\d-]+", item_id) or name not in ("design.png", "design.svg"):
        raise HTTPException(404, "Ficheiro não encontrado")
    path = DIR / item_id / name
    if not path.exists():
        raise HTTPException(404, "Ficheiro não encontrado")
    return FileResponse(path, media_type="image/png" if name.endswith(".png") else "image/svg+xml",
                        headers={"Cache-Control": "private, max-age=86400"})
