"""Reforço na notícia (#/reforco): the Hub adds to the trader's news position on the MT5 account of this PC
(tradingroom/newsadd.py). The accounts are the Escritório de Robôs' ones; nothing here goes by sync."""
from __future__ import annotations

import time

from fastapi import APIRouter, Depends, HTTPException

from ..config import settings
from ..models import User
from ..tradingroom.newsadd import DESK, loop  # noqa: F401  (loop: started by main.py)
from .tradingroom import viewer

router = APIRouter(prefix="/api/reforco")


def _out() -> dict:
    DESK.viewed = time.time()
    ips = dict(p.split("=")[::-1] for p in settings.team_ip_users.split(",") if "=" in p)
    return {**DESK.out(), "marco": f"http://{ips['mark']}:8000/#/reforco" if ips.get("mark") else ""}


@router.get("")
def view(user: User = Depends(viewer)):
    return _out()


@router.post("/cfg")
def cfg(body: dict, user: User = Depends(viewer)):
    try:
        DESK.set_cfg(body)
    except (ValueError, TypeError) as e:
        raise HTTPException(400, str(e))
    return _out()


@router.post("/start")
def start(body: dict, user: User = Depends(viewer)):
    try:
        if body:
            DESK.set_cfg(body)
        DESK.start()
    except (ValueError, TypeError) as e:
        raise HTTPException(400, str(e))
    DESK.note(f"Start por {user.display_name or user.username}.")
    return _out()


@router.post("/stop")
def stop(body: dict, user: User = Depends(viewer)):
    DESK.stop(close=bool(body.get("close")))
    return _out()
