"""Radar (#/radar): a máquina de prospeção (app/radar.py). Só neste PC: nada vai por sync."""
from __future__ import annotations

import asyncio
import csv
import io
import re

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, Response
from sqlalchemy.ext.asyncio import AsyncSession

from .. import radar_doc
from ..radar_ficha import FICHAS, custo
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


@router.get("/{sid}/csv")
async def export(sid: str, token: str = Query(...), db: AsyncSession = Depends(get_db)):
    """A varredura numa folha (Excel abre-a direto: ponto e vírgula e BOM), com o seguimento de cada um."""
    if not await user_from_jwt(token, db):
        raise HTTPException(401, "Invalid token")
    await db.commit()
    try:
        sc = RADAR.get(sid)
    except ValueError as e:
        raise HTTPException(404, str(e))
    out = io.StringIO()
    w = csv.writer(out, delimiter=";")
    w.writerow(["Posição", "Nome", "Localidade", "Telefone", "Email", "Site", "Facebook", "Plataforma", "Quem fez o site", "Nota do site",
                "Oportunidade", "Nível", "Gasto estimado €/mês", "Custo do site €", "Anúncios", "Principal problema", "O que fazemos", "Seguimento", "Notas"])
    for i, n in enumerate(sc["negocios"], 1):
        a, g, p, ld = n.get("audit") or {}, n.get("gasto") or {}, (n.get("problemas") or [{}])[0], n.get("lead") or {}
        w.writerow([i, n["nome"], n.get("morada", ""), n.get("telefone", ""), n.get("email") or ", ".join(a.get("emails") or []),
                    n.get("site", ""), n.get("facebook", ""), a.get("plataforma", ""), a.get("agencia", ""), n.get("nota_site"),
                    n.get("oportunidade"), n.get("nivel", ""), f"{g.get('min', 0)}-{g.get('max', 0)}" if g.get("max") else "",
                    (lambda k: f"{k['min']}-{k['max']}" if k else "")(custo(n)), "sim" if g.get("anuncios") else "", p.get("problema", ""), p.get("solucao", ""),
                    ESTADOS.get(ld.get("estado", ""), ""), ld.get("nota", "")])
    nome = re.sub(r"[^a-z0-9]+", "-", f"radar-{sc['ramo']}-{sc['local'] or 'lista'}".lower()).strip("-")
    return Response("﻿" + out.getvalue(), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{nome}.csv"'})


@router.get("/{sid}/{nid}/ficha")
def ficha(sid: str, nid: str, user: User = Depends(viewer)):
    """A ficha completa de um negócio (marca, redes, Google, dinheiro, o que lhe vender): o que já há e a fase, se está a correr."""
    try:
        return FICHAS.get(sid, nid)
    except ValueError as e:
        raise HTTPException(404, str(e))


@router.post("/{sid}/{nid}/ficha")
async def ficha_start(sid: str, nid: str, user: User = Depends(viewer)):
    try:
        return FICHAS.start(RADAR.get(sid), nid)
    except ValueError as e:
        raise HTTPException(404, str(e))


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
        sc = RADAR.get(sid)
    except ValueError as e:
        raise HTTPException(404, str(e))
    for n in sc.get("negocios", []):
        n["custo_site"] = custo(n)  # quanto custou o site, pelo que o scan viu (a ficha completa afina)
    return sc


@router.delete("/{sid}")
def delete(sid: str, user: User = Depends(viewer)):
    try:
        RADAR.delete(sid)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"ok": True}
