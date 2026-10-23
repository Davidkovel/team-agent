"""Planos: one head for the whole team (23 Oct, David: «eu mando o plano todo, ele começa a fazer; acabo os tokens, entra um
parceiro lá no escritório, vê as cenas e consegue acrescentar e continuar»).

A plan is a job in steps. The Claude that gets it writes it here (scripts/plano.py novo), ticks each step as it goes and
leaves a hand-over note before it stops; the Escritório shows every open plan to every partner (Missões > Planos), who can
add steps, tick or write a note, and «Continuar» copies a prompt that sends their own Claude to the first step left.
Every Claude window also hears of the open plans when it starts (scripts/claude_contexto.py, through /api/local/plans).
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..models import Plan, User
from ..security import current_user
from ..services import iso
from .local import only_local

router = APIRouter(prefix="/api")
DONE_SHOWN = 6   # finished plans still shown, newest first


class PlanIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    goal: str = ""
    project: str = ""
    repo: str = ""
    steps: list[str] = []


class PlanChange(BaseModel):
    add_steps: list[str] = []
    tick: int | None = None        # the step's number, from 1
    untick: int | None = None
    step_note: str = ""            # what was done in the step being ticked
    note: str = ""                 # a hand-over for whoever comes next
    working: bool | None = None    # True: I am on it now; False: I stopped
    status: str | None = None      # open | done


def _now() -> str:
    return iso(datetime.now(timezone.utc))


def _line(text: str, limit: int) -> str:
    return " ".join(str(text or "").split())[:limit]


def out(p: Plan, names: dict[int, str]) -> dict:
    steps = p.steps or []
    return {"id": p.id, "title": p.title, "goal": p.goal, "project": p.project, "repo": p.repo, "status": p.status,
            "steps": steps, "notes": p.notes or [], "done": sum(1 for s in steps if s.get("done")), "total": len(steps),
            "worker": p.worker, "worker_at": iso(p.worker_at), "by": names.get(p.created_by, ""),
            "created_at": iso(p.created_at), "updated_at": iso(p.updated_at)}


async def _list(db: AsyncSession) -> list[dict]:
    names = {u.id: u.display_name for u in (await db.execute(select(User))).scalars()}
    rows = list((await db.execute(select(Plan).order_by(Plan.updated_at.desc()))).scalars())
    shown = [p for p in rows if p.status != "done"] + [p for p in rows if p.status == "done"][:DONE_SHOWN]
    return [out(p, names) for p in shown]


@router.get("/plans")
async def plans(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    return await _list(db)


@router.get("/local/plans", dependencies=[Depends(only_local)])
async def local_plans(db: AsyncSession = Depends(get_db)):
    """For the hook that starts each Claude window: the open plans, without signing in."""
    return [p for p in await _list(db) if p["status"] != "done"]


@router.post("/plans")
async def new_plan(body: PlanIn, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    steps = [{"text": _line(s, 400), "done": False} for s in body.steps if s.strip()]
    p = Plan(title=_line(body.title, 200), goal=body.goal.strip(), project=_line(body.project, 200), repo=_line(body.repo, 300),
             steps=steps, notes=[], created_by=user.id, worker=user.display_name, worker_at=datetime.now(timezone.utc))
    db.add(p)
    await db.commit()
    return out(p, {user.id: user.display_name})


@router.get("/plans/{plan_id}")
async def one_plan(plan_id: int, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    p = await db.get(Plan, plan_id)
    if not p:
        raise HTTPException(404, "Esse plano não existe.")
    names = {u.id: u.display_name for u in (await db.execute(select(User))).scalars()}
    return out(p, names)


@router.patch("/plans/{plan_id}")
async def change_plan(plan_id: int, body: PlanChange, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    p = await db.get(Plan, plan_id)
    if not p:
        raise HTTPException(404, "Esse plano não existe.")
    steps = [dict(s) for s in (p.steps or [])]   # a new list, or the JSON column is not seen as changed
    notes = list(p.notes or [])
    who, at = user.display_name, _now()
    steps += [{"text": _line(s, 400), "done": False, "added_by": who} for s in body.add_steps if s.strip()]
    for n, done in ((body.tick, True), (body.untick, False)):
        if n is None:
            continue
        if not 1 <= n <= len(steps):
            raise HTTPException(400, f"O plano tem {len(steps)} passos.")
        steps[n - 1].update(done=done, by=who if done else "", at=at if done else "", note=_line(body.step_note, 400) if done else "")
    if body.note.strip():
        notes.append({"by": who, "at": at, "text": body.note.strip()[:2000]})
    if body.working is not None:
        p.worker, p.worker_at = (who, datetime.now(timezone.utc)) if body.working else ("", None)
    if body.status in ("open", "done"):
        p.status = body.status
        if body.status == "done":
            p.worker, p.worker_at = "", None
    elif steps and all(s.get("done") for s in steps) and body.tick:
        p.status, p.worker, p.worker_at = "done", "", None
    p.steps, p.notes = steps, notes
    p.updated_at = datetime.now(timezone.utc)
    await db.commit()
    names = {u.id: u.display_name for u in (await db.execute(select(User))).scalars()}
    return out(p, names)
