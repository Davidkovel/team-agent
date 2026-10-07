"""Every PC updates itself: the Hub pulls main every few minutes, so what one person pushes reaches the others without
anyone remembering to `git pull`.

- Only Hubs started by the widget (SYNC=1) do it, never a test server; and never over local changes (dirty tree = skip).
- Frontend changes are live at once (the files are served from disk); the open page sees /api/version change and reloads.
- Backend changes need a new process: the Hub exits and the widget, which watches it, starts it again with the new code.
Until 4 Oct each PC showed the old Hub until someone ran git pull there by hand, and nobody did.
"""
import asyncio
import logging
import os
import subprocess
import time
from pathlib import Path

from fastapi import APIRouter

from .config import settings

log = logging.getLogger("selfupdate")
router = APIRouter(prefix="/api")
ROOT = Path(__file__).resolve().parents[2]
ENV = {**os.environ, "GIT_TERMINAL_PROMPT": "0"}
EVERY = 120


def git(*args: str) -> str:
    return subprocess.run(["git", "-C", str(ROOT), *args], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=60, env=ENV,
                          creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)).stdout.strip()


VERSION = {"head": ""}
CACHE: dict = {}  # the answer of the last few seconds: every open page asks often


def current() -> str:
    """What this PC serves now: the commit checked out, and when index.html last changed (every frontend change bumps the ?v=
    in it). Read live, not from the last pull, so a change committed or saved on this PC reaches the open pages too."""
    head = git("rev-parse", "--short=7", "HEAD") or VERSION["head"]
    try:
        stamp = int((Path(settings.frontend_dir) / "index.html").stat().st_mtime)
    except OSError:
        stamp = 0
    return f"{head}-{stamp}"


@router.get("/version")
async def version():
    now = time.monotonic()
    if CACHE.get("at", -10) < now - 5:
        subject, _, when = (await asyncio.to_thread(git, "log", "-1", "--format=%s%x1f%cI")).partition("\x1f")
        CACHE.update(at=now, head=await asyncio.to_thread(current), subject=subject, when=when)
    return {"head": CACHE["head"], "subject": CACHE["subject"], "when": CACHE["when"]}   # the last change, for whoever wants to see it arrived


def pull_once() -> bool:
    """True when the backend changed and this process must make way for a new one."""
    if git("status", "--porcelain", "--untracked-files=no"):
        return False
    before = git("rev-parse", "HEAD")
    git("pull", "--ff-only", "-q")
    after = git("rev-parse", "HEAD")
    VERSION["head"] = after[:7]
    if not before or before == after:
        return False
    changed = git("diff", "--name-only", before, after).splitlines()
    log.info("updated %s..%s (%d files)", before[:7], after[:7], len(changed))
    return any(f.startswith("backend/") for f in changed)


async def loop():
    VERSION["head"] = (await asyncio.to_thread(git, "rev-parse", "HEAD"))[:7]
    if not settings.sync:
        return
    while True:
        await asyncio.sleep(EVERY)
        try:
            if await asyncio.to_thread(pull_once):
                log.info("backend changed: exiting so the widget restarts the Hub with the new code")
                await asyncio.sleep(2)
                os._exit(0)
        except Exception:  # no network, git missing...: try again next round
            log.exception("self-update failed")
