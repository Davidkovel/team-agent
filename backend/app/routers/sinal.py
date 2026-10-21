"""Sinal na notícia (#/sinal): BUY or SELL the second a US figure is out (tradingroom/sinal.py). Per PC, nothing by sync."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from ..models import User
from ..tradingroom.sinal import DESK, loop  # noqa: F401  (loop: started by main.py)
from .tradingroom import viewer

router = APIRouter(prefix="/api/sinal")


@router.get("")
def view(user: User = Depends(viewer)):
    return DESK.out()


@router.get("/alert")
def alert(user: User = Depends(viewer)):
    return DESK.alert()


@router.post("/ensaio")
def ensaio(user: User = Depends(viewer)):
    try:
        return DESK.ensaio()
    except ValueError as e:
        raise HTTPException(404, str(e))
