"""The widget restarts itself when new widget code arrives.

This PC's Hub pulls main every two minutes (backend/app/selfupdate.py): the pages reload and the Hub restarts by themselves,
but the widget kept running the code it was started with until somebody ran scripts/iniciar.ps1. Now it looks at the commit
checked out once a minute and, when it moved and the move touched widget/, runs iniciar.ps1 itself: that installs what is
missing, closes this widget and opens the new one. Files only saved, not committed, never restart it.
"""
import os
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
ENV = {**os.environ, "GIT_TERMINAL_PROMPT": "0"}
HIDDEN = getattr(subprocess, "CREATE_NO_WINDOW", 0)
EVERY_MS = 60_000


def git(*args: str) -> str:
    try:
        return subprocess.run(["git", "-C", str(REPO), *args], capture_output=True, text=True, timeout=20, env=ENV,
                              creationflags=HIDDEN).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return ""


def head() -> str:
    return git("rev-parse", "HEAD")


def widget_changed(since: str, now: str | None = None) -> bool:
    """Did the commits between `since` and what is checked out now touch the widget?"""
    now = head() if now is None else now
    return bool(since and now and now != since and git("diff", "--name-only", since, now, "--", "widget/"))


def relaunch() -> bool:
    """Runs scripts/iniciar.ps1 on its own, so it outlives this widget, which it closes. False when it could not be started."""
    script = REPO / "scripts" / "iniciar.ps1"
    if sys.platform != "win32" or not script.exists():
        return False
    try:
        subprocess.Popen(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", str(script)],
                         cwd=str(REPO), creationflags=HIDDEN, close_fds=True,  # not DETACHED_PROCESS: with it powershell exits at once and runs nothing
                         stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except OSError:
        return False
    return True
