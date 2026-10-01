"""Opens the Team Hub (the big dashboard site) from the widget.

TEAM_HUB_URL picks the server. If it points at this computer and nothing answers,
the widget starts the backend in dev mode (SQLite, no Redis) so the button always works.
"""
import os
import secrets
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path
from urllib.parse import urlparse

DEFAULT_URL = "http://127.0.0.1:8000"
REPO = Path(__file__).resolve().parents[2]
DATA_DIR = Path.home() / ".team-agent"
BROWSERS = (
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
)


def hub_url() -> str:
    return os.environ.get("TEAM_HUB_URL", DEFAULT_URL).rstrip("/")


def is_up(url: str) -> bool:
    try:
        with urllib.request.urlopen(url + "/api/hub/companies", timeout=2):
            return True
    except urllib.error.HTTPError:
        return True  # 401 = the server answered
    except OSError:
        return False


def is_local(url: str) -> bool:
    return urlparse(url).hostname in ("127.0.0.1", "localhost", "::1")


def start_local_server(url: str) -> bool:
    backend = REPO / "backend"
    python = REPO / ".venv" / "Scripts" / "python.exe"
    if not (backend / "app" / "main.py").exists() or not python.exists():
        return False
    DATA_DIR.mkdir(exist_ok=True)
    secret_file = DATA_DIR / "hub.secret"
    if not secret_file.exists():
        secret_file.write_text(secrets.token_urlsafe(48))
    env = {**os.environ, "DATABASE_URL": f"sqlite+aiosqlite:///{(DATA_DIR / 'hub.db').as_posix()}",
           "REDIS_URL": "", "JWT_SECRET": secret_file.read_text().strip()}
    port = str(urlparse(url).port or 8000)
    flags = subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP if sys.platform == "win32" else 0
    subprocess.Popen([str(python), "-m", "uvicorn", "app.main:app", "--port", port], cwd=backend, env=env,
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=flags)
    for _ in range(30):
        time.sleep(0.5)
        if is_up(url):
            return True
    return False


def open_fullscreen(url: str):
    """App-style window: no address bar, own taskbar entry, normal minimize/maximize/close buttons."""
    for exe in BROWSERS:
        if Path(exe).exists():
            subprocess.Popen([exe, f"--app={url}", "--start-maximized"])
            return
    if found := shutil.which("msedge") or shutil.which("chrome"):
        subprocess.Popen([found, f"--app={url}", "--start-maximized"])
        return
    webbrowser.open(url)


def maximize(session: str | None = None) -> str | None:
    """Returns an error message for the widget to show, or None when the Hub opened."""
    url = hub_url()
    if not is_up(url):
        if not is_local(url):
            return f"Hub não responde em {url}"
        if not start_local_server(url):
            return "Não consegui arrancar o servidor do Hub"
    open_fullscreen(f"{url}/#login={session}" if session else url)
    return None
