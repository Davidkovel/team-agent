"""Angariação (app/angariacao.py): a página pública de cada empresa (/go?r=AG-0001), o registo das visitas (/api/go/t), e o que
a página CRM usa (/api/angariacao). As duas primeiras não pedem login: são abertas pelas empresas, a partir do email."""
from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse, HTMLResponse, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import angariacao as A
from .. import chamadas as C
from ..db import SessionLocal, get_db
from ..security import user_from_jwt
from ..models import User
from ..services import notify
from .tradingroom import viewer

log = logging.getLogger("team.angariacao")
public = APIRouter()
router = APIRouter(prefix="/api/angariacao")


def _hub(request: Request | None = None) -> str:
    cfg = A.config()
    if cfg.get("base_url"):
        return cfg["base_url"]
    return str(request.base_url).rstrip("/") if request else "http://127.0.0.1:8000"


@public.get("/go", response_class=HTMLResponse)
def landing(r: str = "", v: str = "A"):
    return HTMLResponse(A.landing(r.strip().upper()[:20] or None, "B" if v.upper() == "B" else "A"),
                        headers={"Cache-Control": "no-store", "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer"})


@public.post("/api/go/t")
async def track(request: Request):
    try:
        body = json.loads((await request.body())[:8000] or b"{}")
    except ValueError:
        return Response(status_code=204)
    await asyncio.to_thread(A.track, body, request.headers.get("user-agent", ""))
    return Response(status_code=204)


@router.get("")
def resumo(request: Request, user: User = Depends(viewer)):
    return A.resumo(_hub(request))


@router.post("/config")
def config(body: dict, user: User = Depends(viewer)):
    return A.set_config(body)


@router.post("/rascunhos")
def rascunhos(body: dict, request: Request, user: User = Depends(viewer)):
    """Os emails de todas as empresas do CRM sem rascunho (ou das escolhidas, ou todos outra vez). Nada é enviado."""
    keys = body.get("keys") if isinstance(body.get("keys"), list) else None
    return A.rascunhos(_hub(request), keys, bool(body.get("todos")))


@router.get("/lead")
def lead(key: str, request: Request, user: User = Depends(viewer)):
    try:
        return A.ficha(key, _hub(request))
    except ValueError as e:
        raise HTTPException(404, str(e))


@router.get("/chamadas")
def chamadas(key: str = "", user: User = Depends(viewer)):
    return {"personas": C.PERSONAS, "resultados": C.RESULTADOS, "agora_em_horario": C.em_horario(time.time()),
            "chamadas": [{k: c.get(k) for k in ("id", "key", "code", "nome", "persona", "estado", "criada", "quando", "duracao",
                                                "nota", "analise", "transcricao", "contexto", "log")} | {"pdf": bool(c.get("pdf"))}
                         for c in C.lista(key or None)[:60]]}


@router.post("/simular")
async def simular(body: dict, user: User = Depends(viewer)):
    """Uma chamada em simulação (ninguém é ligado). «hora_teste» deixa ensaiar dentro do horário fora de horas."""
    ts = time.time()
    if body.get("hora_teste"):
        ts = C.proxima_vaga(ts)
    try:
        return await asyncio.to_thread(C.simular, str(body.get("key") or ""), str(body.get("persona") or ""), ts)
    except ValueError as e:
        raise HTTPException(400, str(e))


async def _pdf(token: str, db: AsyncSession, fn, nome: str):
    if not await user_from_jwt(token, db):
        raise HTTPException(401, "Invalid token")
    await db.commit()
    try:
        path = await asyncio.to_thread(fn)
    except ValueError as e:
        raise HTTPException(404, str(e))
    except RuntimeError as e:
        raise HTTPException(500, str(e))
    return FileResponse(path, media_type="application/pdf", headers={"Content-Disposition": f'inline; filename="{nome}"'})


@router.get("/chamada/{cid}/pdf")
async def chamada_pdf(cid: str, token: str = Query(...), db: AsyncSession = Depends(get_db)):
    def fn():
        c = C.get(cid)
        if not c or not c.get("analise"):
            raise ValueError("chamada sem análise")
        card = A.lead_card(c["key"]) or {"key": c["key"], "nome": c.get("nome") or c["key"]}
        return C.pdf_chamada(c, card)
    return await _pdf(token, db, fn, f"chamada-{cid}.pdf")


@router.get("/diario.pdf")
async def diario_pdf(token: str = Query(...), dia: str = "", db: AsyncSession = Depends(get_db)):
    if dia and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", dia):
        raise HTTPException(400, "dia AAAA-MM-DD")
    return await _pdf(token, db, lambda: C.pdf_diario(dia or None), f"diario-{dia or 'hoje'}.pdf")


@router.get("/validacao.pdf")
async def validacao_pdf(request: Request, token: str = Query(...), db: AsyncSession = Depends(get_db)):
    hub = _hub(request)
    return await _pdf(token, db, lambda: C.pdf_validacao(hub), "validacao-angariacao.pdf")


def _person() -> str:
    try:
        return (json.loads((Path.home() / ".team-agent" / "widget.json").read_text(encoding="utf-8-sig")).get("user") or "").lower()
    except (OSError, ValueError):
        return ""


async def loop():
    """De minuto a minuto: fecha as visitas acabadas, atualiza a temperatura no CRM e avisa (sino, telemóvel e Telegram).
    De 10 em 10 s, quando há bot, lê os botões «Já liguei» / «Ainda não liguei»."""
    await asyncio.sleep(20)
    n = 0
    while True:
        try:
            if n % 6 == 0:
                for v in await asyncio.to_thread(A.fechar_visitas):
                    out = await asyncio.to_thread(A.alertar, v, _hub())
                    if not out:
                        continue
                    t = out["t"]
                    async with SessionLocal() as db:
                        login = _person()
                        users = (await db.execute(select(User))).scalars().all()
                        alvo = [u.id for u in users if u.username.lower() == login or (u.display_name or "").lower() == login] or \
                               [u.id for u in users if u.role == "owner"][:1]
                        if alvo:
                            await notify(db, alvo, "angariacao", "info" if t["temperatura"] != "quente" else "warning",
                                         f"{A.EMOJI[t['temperatura']]} {out['card']['nome']} viu a página ({A.dur(v['ativo_ms'] / 1000)})",
                                         out["texto"][:1500], "#/crm", directed=True)
            await asyncio.to_thread(A.telegram_botoes)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 — nunca parar a volta
            log.exception("angariação")
        n += 1
        await asyncio.sleep(10)
