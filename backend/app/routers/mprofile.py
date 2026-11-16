"""Market Profile (#/mprofile, a tab of the Sala de Trading): the research of the market-profile-bot
(github.com/Davidkovel/market-profile-bot, Market Profile + VWAP on FDAX and NQ), read from its clone on this PC
(`~/.team-agent/market-profile-bot`, or MPROFILE_DIR). The Hub only reads its reports; the bot trades nothing.
«Atualizar» does a `git pull` of the clone (cloned on the first press if it is not there)."""
from __future__ import annotations

import asyncio
import os
import re
import subprocess
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse

from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..models import User
from ..security import user_from_jwt
from .memes import viewer

router = APIRouter(prefix="/api/mprofile")
REPO = "https://github.com/Davidkovel/market-profile-bot.git"
DIR = Path(os.environ.get("MPROFILE_DIR") or Path.home() / ".team-agent" / "market-profile-bot")
SETUPS = {"B1": "Volta à value area", "B2": "Rotação dentro da VA", "B3": "Open test drive", "B4": "Open drive",
          "B5": "Rejeição da abertura para o equilíbrio", "B6": "Aceitação + reteste", "B7": "Tendência na VWAP",
          "B8": "VWAP: volta à média", "3I": "3-I (dia anterior)", "NE": "Neutral extreme", "GP": "Gap que aguenta",
          "FA": "Leilão falhado", "N1": "POC da noite → topo/fundo da noite", "SP": "Single prints de ontem"}
PICKS = {"теория": "Teoria", "карта": "Mapa", "GBM": "GBM"}


def _git(*args: str) -> str:
    try:
        return subprocess.run(["git", "-C", str(DIR), *args], capture_output=True, text=True, timeout=60).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return ""


def _block(text: str, title: str) -> list[list[str]]:
    """The rows of one section of SUMMARY.txt (fixed-width columns, the first line is the header)."""
    m = re.search(rf"^{title}\n(.*?)(?:\n\n|\Z)", text, re.S | re.M)
    return [ln.split() for ln in m.group(1).splitlines()[1:]] if m else []


def _num(x: str):
    try:
        return float(x)
    except ValueError:
        return None


def read() -> dict:
    if not (DIR / "reports").exists():
        return {"ok": False, "dir": str(DIR)}
    summ = (DIR / "reports" / "SUMMARY.txt").read_text("utf-8", "replace") if (DIR / "reports" / "SUMMARY.txt").exists() else ""
    head = summ.splitlines()[0] if summ else ""
    m = re.search(r"(\d{4}-\d\d-\d\d)\D+(\d{4}-\d\d-\d\d)\D+(\d+)", head)
    setups = [{"market": r[0], "id": r[1], "name": SETUPS.get(r[1], r[1]), "n": int(r[2]), "win": _num(r[3]), "r": _num(r[4]),
               "pf": _num(r[5]), "t": _num(r[6]), "r_oos": _num(r[7]), "n_oos": int(r[8])}
              for r in _block(summ, "СЕТАПЫ") if len(r) >= 9]
    wf = [{"market": r[0], "pick": PICKS.get(r[1], r[1]), "n": int(r[2]), "win": _num(r[3]), "r": _num(r[4]), "sum_r": _num(r[5]),
           "pf": _num(r[6]), "dd": _num(r[7]), "t": _num(r[8])}
          for r in _block(summ, "WALK-FORWARD") if len(r) >= 9]
    final = DIR / "research" / "FINAL_REPORT.md"
    report = final.read_text("utf-8", "replace") if final.exists() else ""
    log = _git("log", "-1", "--format=%cI|%s")
    return {"ok": True, "dir": str(DIR), "from": m and m.group(1), "to": m and m.group(2), "trades": m and int(m.group(3)),
            "setups": setups, "walkforward": wf, "report": report[:9000],
            "images": sorted(p.name for p in (DIR / "reports").glob("*.png")),
            "commit": dict(zip(("at", "msg"), log.split("|", 1))) if "|" in log else None}


@router.get("")
async def state(user: User = Depends(viewer)):
    return await asyncio.to_thread(read)


@router.post("/pull")
async def pull(user: User = Depends(viewer)):
    def go():
        if (DIR / ".git").exists():
            return subprocess.run(["git", "-C", str(DIR), "pull", "-q", "--ff-only"], capture_output=True, text=True, timeout=120)
        DIR.parent.mkdir(parents=True, exist_ok=True)
        return subprocess.run(["git", "clone", "-q", "--depth", "1", REPO, str(DIR)], capture_output=True, text=True, timeout=300)
    r = await asyncio.to_thread(go)
    if r.returncode:
        raise HTTPException(502, (r.stderr or "o git falhou").strip()[-300:] + " (o repositório é privado: este PC precisa de acesso no GitHub)")
    return await asyncio.to_thread(read)


@router.get("/img/{name}")
async def img(name: str, token: str = Query(...), db: AsyncSession = Depends(get_db)):
    """A chart of the reports; the token goes in the address because it is an <img>."""
    ok = await user_from_jwt(token, db)
    await db.commit()
    if not ok:
        raise HTTPException(401, "Invalid token")
    p = DIR / "reports" / name
    if not re.match(r"^[\w\-]+\.png$", name) or not p.exists():
        raise HTTPException(404)
    return FileResponse(p, media_type="image/png")
