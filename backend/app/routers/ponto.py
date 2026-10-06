from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from .. import ponto
from ..db import get_db
from ..models import User
from ..security import current_user

router = APIRouter(prefix="/api")


@router.get("/ponto")
async def ponto_today(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    """Who already clocked in today."""
    return await ponto.board(db)


@router.post("/ponto")
async def ponto_punch(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    """Clock in for today. The whole team is told."""
    return await ponto.punch(db, user)


@router.post("/ponto/stop")
async def ponto_stop(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    """Stop the clock: the hours of today stop counting until it is started again (POST /ponto)."""
    return await ponto.stop(db, user)
