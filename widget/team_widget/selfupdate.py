"""The widget follows git too. The Hub pulls main every 2 minutes (backend/app/selfupdate.py), but until 6 Oct only the Hub
restarted with the new code: the widget kept running what it had when it was opened, so a push to widget/ reached nobody
until they closed and reopened Abrir AMG. Now the widget watches the checked-out commit and, when it brings new widget
code, starts a fresh copy of itself and closes.

It waits while the Hub window is open (someone is using it), but never more than MAX_WAIT_MS.
"""
import subprocess
import sys

from PySide6.QtCore import QElapsedTimer, QTimer

from .hub import REPO

EVERY_MS = 20_000
MAX_WAIT_MS = 10 * 60_000
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def git(*args: str) -> str:
    try:
        return subprocess.run(["git", "-C", str(REPO), *args], capture_output=True, text=True, timeout=20,
                              creationflags=NO_WINDOW).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return ""


class SelfUpdate:
    def __init__(self, app, window, server):
        self.app, self.window, self.server = app, window, server
        self.running = git("rev-parse", "HEAD")  # the code this process was started with
        self.waiting = QElapsedTimer()
        self.timer = QTimer()
        self.timer.timeout.connect(self.check)
        if self.running:
            self.timer.start(EVERY_MS)

    def check(self):
        head = git("rev-parse", "HEAD")
        if not head or head == self.running:
            return
        changed = git("diff", "--name-only", self.running, head).splitlines()
        if not any(path.startswith("widget/") for path in changed):
            self.running = head  # only the Hub or the pages changed: they update themselves
            return
        expander = getattr(self.window, "_expander", None)
        if expander is not None and expander.isVisible():
            if not self.waiting.isValid():
                self.waiting.start()
            if self.waiting.elapsed() < MAX_WAIT_MS:
                return
        self.restart()

    def restart(self):
        self.timer.stop()
        self.server.close()  # free the single-widget name first, so the new copy does not hand over to this one
        flags = NO_WINDOW | getattr(subprocess, "DETACHED_PROCESS", 0) | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
        subprocess.Popen([sys.executable, "-m", "team_widget"], cwd=str(REPO / "widget"), creationflags=flags, close_fds=True)
        self.app.quit()
