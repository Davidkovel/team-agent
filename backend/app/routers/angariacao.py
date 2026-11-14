"""Angariação (app/angariacao.py): a página pública de cada empresa (/go?r=AG-0001), o registo das visitas (/api/go/t), e o que
a página CRM usa (/api/angariacao). As duas primeiras não pedem login: são abertas pelas empresas, a partir do email."""
from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, Response
from sqlalchemy import select

from .. import angariacao as A
from ..db import SessionLocal
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
