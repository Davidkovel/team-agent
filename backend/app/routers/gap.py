"""Gap da manhã (#/gap): the gaps on the FundedNext MT5 quotes (tradingroom/gap.py). Runs on the PC where the MT5 account
is (the Escritório de Robôs' accounts); nothing here goes by sync, only the notes do."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from ..config import settings
from ..models import User
from ..tradingroom.gap import WATCH, loop  # noqa: F401  (loop: started by main.py)
from .tradingroom import viewer

router = APIRouter(prefix="/api/gap")


def _out() -> dict:
    ips = dict(p.split("=")[::-1] for p in settings.team_ip_users.split(",") if "=" in p)
    return {**WATCH.out(), "marco": f"http://{ips['mark']}:8000/#/gap" if ips.get("mark") else ""}


@router.get("")
def view(user: User = Depends(viewer)):
    return _out()


@router.post("/cfg")
def cfg(body: dict, user: User = Depends(viewer)):
    try:
        WATCH.set_cfg(body)
    except (ValueError, TypeError) as e:
        raise HTTPException(400, str(e))
    return _out()


@router.post("/test")
async def test(user: User = Depends(viewer)):
    from ..tradingroom.gap import send
    r = next(iter(WATCH.state["days"]), None)
    title, body = WATCH.note_open(r) if r else ("Gap: teste", "Assim chega a nota do gap da manhã.")
    await send([("low", f"[teste] {title}", body)])
    return {"ok": True}
