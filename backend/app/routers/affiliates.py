"""Afiliados (#/afiliados, 3 Nov 2026, Marco: «affiliate market... quero funcional... ainda estou a entrar nesse nicho»).

The team's affiliate programmes (name, niche, network, the link, the commission, the cookie, where it stands) and what each
one gave, day by day, written by hand from the network's dashboard until a network is connected by API. Both tables go to
every PC by sync. Figures are only what was written: no programme, no number.
"""
import re
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..models import AffiliateProgram, AffiliateResult, User
from ..realtime import rt
from ..security import current_user
from ..services import iso

router = APIRouter(prefix="/api/afiliados")
KINDS = ("pct", "fixed", "recurring")
STATUS = ("ideia", "candidatura", "aprovado", "ativo", "parado")
DAY = re.compile(r"\d{4}-\d{2}-\d{2}")


class ProgramIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    niche: str = Field("", max_length=80)
    network: str = Field("", max_length=80)
    link: str = Field("", max_length=600)
    kind: str = "pct"
    commission: float = Field(0, ge=0, le=100000)
    cookie_days: int = Field(0, ge=0, le=3650)
    status: str = "ideia"
    notes: str = Field("", max_length=4000)


class ProgramEdit(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=120)
    niche: str | None = Field(None, max_length=80)
    network: str | None = Field(None, max_length=80)
    link: str | None = Field(None, max_length=600)
    kind: str | None = None
    commission: float | None = Field(None, ge=0, le=100000)
    cookie_days: int | None = Field(None, ge=0, le=3650)
    status: str | None = None
    notes: str | None = Field(None, max_length=4000)


class ResultIn(BaseModel):
    program_id: int
    day: str = ""
    clicks: int = Field(0, ge=0, le=10_000_000)
    sales: int = Field(0, ge=0, le=1_000_000)
    earned: float = Field(0, ge=0, le=10_000_000)
    note: str = Field("", max_length=300)


def _check(kind: str | None, status: str | None, link: str | None):
    if kind is not None and kind not in KINDS:
        raise HTTPException(400, "Tipo de comissão desconhecido.")
    if status is not None and status not in STATUS:
        raise HTTPException(400, "Estado desconhecido.")
    if link and not re.match(r"https?://", link.strip(), re.I):
        raise HTTPException(400, "O link tem de começar por http:// ou https://")


def _program(p: AffiliateProgram, people: dict, totals: dict) -> dict:
    t = totals.get(p.id, {"clicks": 0, "sales": 0, "earned": 0.0, "days": 0})
    return {"id": p.id, "name": p.name, "niche": p.niche, "network": p.network, "link": p.link, "kind": p.kind,
            "commission": p.commission, "cookie_days": p.cookie_days, "status": p.status, "notes": p.notes,
            "by": people.get(p.user_id or 0, ""), "created_at": iso(p.created_at), "updated_at": iso(p.updated_at), **t}


@router.get("")
async def overview(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    people = {u.id: u.display_name for u in (await db.execute(select(User))).scalars()}
    programs = (await db.execute(select(AffiliateProgram).order_by(AffiliateProgram.created_at.desc()))).scalars().all()
    results = (await db.execute(select(AffiliateResult).order_by(AffiliateResult.day.desc(), AffiliateResult.id.desc()))).scalars().all()
    names = {p.id: p.name for p in programs}
    totals: dict[int, dict] = {}
    for r in results:
        t = totals.setdefault(r.program_id, {"clicks": 0, "sales": 0, "earned": 0.0, "days": 0})
        t["clicks"] += r.clicks; t["sales"] += r.sales; t["earned"] += r.earned; t["days"] += 1
    return {
        "programs": [_program(p, people, totals) for p in programs],
        "results": [{"id": r.id, "program_id": r.program_id, "program": names.get(r.program_id, "—"), "day": r.day,
                     "clicks": r.clicks, "sales": r.sales, "earned": r.earned, "note": r.note,
                     "by": people.get(r.user_id or 0, "")} for r in results if r.program_id in names],
    }


@router.post("/programas")
async def add_program(body: ProgramIn, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    _check(body.kind, body.status, body.link)
    p = AffiliateProgram(**{k: (v.strip() if isinstance(v, str) else v) for k, v in body.model_dump().items()}, user_id=user.id)
    db.add(p)
    await db.commit()
    await rt.publish("afiliados", user.id, "team")
    return {"id": p.id}


@router.patch("/programas/{pid}")
async def edit_program(pid: int, body: ProgramEdit, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    p = await db.get(AffiliateProgram, pid)
    if not p:
        raise HTTPException(404, "Esse programa não existe.")
    _check(body.kind, body.status, body.link)
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(p, k, v.strip() if isinstance(v, str) else v)
    await db.commit()
    await rt.publish("afiliados", user.id, "team")
    return {"ok": True}


@router.delete("/programas/{pid}")
async def remove_program(pid: int, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    p = await db.get(AffiliateProgram, pid)
    if not p:
        raise HTTPException(404, "Esse programa não existe.")
    ids = (await db.execute(select(AffiliateResult.id).where(AffiliateResult.program_id == pid))).scalars().all()
    if ids:   # row by row, so each delete is noted for sync
        for r in (await db.execute(select(AffiliateResult).where(AffiliateResult.id.in_(ids)))).scalars():
            await db.delete(r)
    await db.delete(p)
    await db.commit()
    await rt.publish("afiliados", user.id, "team")
    return {"ok": True}


@router.post("/resultados")
async def add_result(body: ResultIn, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    if not await db.get(AffiliateProgram, body.program_id):
        raise HTTPException(404, "Esse programa não existe.")
    day = body.day.strip() or date.today().isoformat()
    if not DAY.fullmatch(day):
        raise HTTPException(400, "Dia inválido.")
    if not (body.clicks or body.sales or body.earned):
        raise HTTPException(400, "Escreve pelo menos cliques, vendas ou comissão.")
    r = AffiliateResult(program_id=body.program_id, day=day, clicks=body.clicks, sales=body.sales, earned=round(body.earned, 2),
                        note=body.note.strip(), user_id=user.id)
    db.add(r)
    await db.commit()
    await rt.publish("afiliados", user.id, "team")
    return {"id": r.id}


@router.delete("/resultados/{rid}")
async def remove_result(rid: int, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    r = await db.get(AffiliateResult, rid)
    if not r:
        raise HTTPException(404, "Esse registo não existe.")
    await db.delete(r)
    await db.commit()
    await rt.publish("afiliados", user.id, "team")
    return {"ok": True}
