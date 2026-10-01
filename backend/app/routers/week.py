import asyncio

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from .. import week, worktree
from ..db import get_db
from ..models import User
from ..security import current_user

router = APIRouter(prefix="/api")


@router.get("/week")
async def weekly_ledger(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    """Who showed up this week, who did what, who still owes what."""
    return await week.summary(db)


@router.get("/local/week")
async def weekly_ledger_local(request: Request, db: AsyncSession = Depends(get_db)):
    """Same ledger for the desktop widget on this computer, so it works before any login.
    Only answers requests coming from this machine; anything else must use /api/week with a token."""
    if (request.client.host if request.client else "") not in ("127.0.0.1", "::1", "localhost"):
        raise HTTPException(403, "Only available from the server computer")
    return await week.summary(db)


@router.get("/worktree")
async def work_in_progress(user: User = Depends(current_user)):
    """Everything edited since the last commit, per repo: the work nobody has committed or pushed yet."""
    return await asyncio.to_thread(worktree.pending)
