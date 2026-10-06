"""Finds and, when needed, starts the Team Hub (the big dashboard site) for the widget.

TEAM_HUB_URL picks the server. If it points at this computer and nothing answers,
the widget starts the backend in dev mode (SQLite, no Redis) so the button always works.
"""
import json
import os
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlencode, urlparse

DEFAULT_URL = "http://127.0.0.1:8000"
REPO = Path(__file__).resolve().parents[2]
DATA_DIR = Path.home() / ".team-agent"


def _config() -> dict:
    """~/.team-agent/widget.json: {"hub_url": "http://<host IP>:8000", "key": "<TEAM_KEY>", "user": "Marco"} - set once, no env vars."""
    try:
        return json.loads((DATA_DIR / "widget.json").read_text(encoding="utf-8-sig"))  # utf-8-sig: PowerShell 5.1 writes a BOM
    except (OSError, ValueError):
        return {}


def hub_url() -> str:
    url = _config().get("hub_url") or ""
    if urlparse(url).hostname and urlparse(url).hostname.startswith("26."):
        url = ""  # from when one computer was the host: now every computer runs its own Hub and they sync
    return (os.environ.get("TEAM_HUB_URL") or url or DEFAULT_URL).rstrip("/")


def team_key() -> str:
    return os.environ.get("TEAM_KEY") or _config().get("key") or ""


def configured_user() -> str:
    return _config().get("user") or ""


def get_json(url: str, timeout: int = 5):
    """GET a Hub endpoint as JSON, with the shared team key when there is one."""
    req = urllib.request.Request(url, headers={"X-Team-Key": team_key()})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return json.load(res)


def get_inbox(url: str, user: str, limit: int = 3) -> dict:
    """{unread, items}: the newest notifications `user` has not read, for the widget's mini history."""
    return get_json(f"{url}/api/local/inbox?" + urlencode({"user": user, "limit": limit}))


def mark_read(url: str, user: str, ids: list[int]):
    """Marks notifications read from the widget (the Hub's bell follows). Quiet when the Hub does not answer."""
    req = urllib.request.Request(url + "/api/local/inbox/read", data=json.dumps({"user": user, "ids": ids}).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "X-Team-Widget": "1", "X-Team-Key": team_key()})
    try:
        urllib.request.urlopen(req, timeout=5).close()
    except OSError:
        pass


def delete_notes(url: str, user: str, ids: list[int] | None = None) -> bool:
    """Deletes `user`'s notifications for good (the Hub's bell and the other computers follow); ids None: all of them.
    False when the Hub does not answer."""
    body = {"user": user, "ids": ids or [], "all": ids is None}
    req = urllib.request.Request(url + "/api/local/inbox/delete", data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "X-Team-Widget": "1", "X-Team-Key": team_key()})
    try:
        urllib.request.urlopen(req, timeout=5).close()
        return True
    except OSError:
        return False


def get_notices(url: str, user: str, after: int | None) -> dict:
    """{latest, items}: the tasks sent to anyone since notice `after` (None: only where things are now), for `user`'s widget."""
    return get_json(f"{url}/api/local/notices?" + urlencode({"user": user, **({} if after is None else {"after": after})}))


def is_up(url: str) -> bool:
    try:
        with urllib.request.urlopen(url + "/api/hub/companies", timeout=2):
            return True
    except urllib.error.HTTPError:
        return True  # 401 = the server answered
    except OSError:
        return False


def ping_presence(url: str, user: str):
    """Tells the Hub on this computer that `user` has the widget open: that is what shows them online with no agent running."""
    req = urllib.request.Request(url + "/api/local/presence", data=json.dumps({"user": user}).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "X-Team-Widget": "1", "X-Team-Key": team_key()})
    try:
        urllib.request.urlopen(req, timeout=3).close()
    except OSError:
        pass

def set_away(url: str, user: str, away: bool):
    """Shows `user` offline (or online again) for everyone, to try the notifications. Raises OSError when the Hub does not answer."""
    req = urllib.request.Request(url + "/api/local/away", data=json.dumps({"user": user, "away": away}).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "X-Team-Widget": "1", "X-Team-Key": team_key()})
    urllib.request.urlopen(req, timeout=5).close()


def session(url: str, user: str) -> str | None:
    """A signed-in Hub session for `user`, asked with the team key: opens the Hub with no password when no agent is running."""
    req = urllib.request.Request(url + "/api/local/session", data=json.dumps({"user": user}).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "X-Team-Widget": "1", "X-Team-Key": team_key()})
    try:
        with urllib.request.urlopen(req, timeout=5) as res:
            return json.load(res).get("token")
    except (OSError, ValueError):
        return None


def punch(url: str, user: str) -> dict:
    """Clocks `user` in for today ("bater o ponto") and returns {user, name, at}. Raises OSError when the Hub does not answer."""
    req = urllib.request.Request(url + "/api/local/ponto", data=json.dumps({"user": user}).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "X-Team-Widget": "1", "X-Team-Key": team_key()})
    with urllib.request.urlopen(req, timeout=5) as res:
        return json.load(res)

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
           "REDIS_URL": "", "JWT_SECRET": secret_file.read_text().strip(), "TEAM_KEY": team_key(), "SYNC": "1"}
    port = str(urlparse(url).port or 8000)
    flags = subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP if sys.platform == "win32" else 0
    # Listens on the network (Radmin) so the Hubs of the other computers can trade changes with this one.
    host = "0.0.0.0"
    subprocess.Popen([str(python), "-m", "uvicorn", "app.main:app", "--host", host, "--port", port], cwd=backend, env=env,
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=flags)
    for _ in range(30):
        time.sleep(0.5)
        if is_up(url):
            return True
    return False


def ready() -> str | None:
    """Makes sure the Hub answers, starting it here when it lives on this computer.
    Returns an error message for the widget to show, or None when the Hub is up."""
    url = hub_url()
    if not is_up(url):
        if not is_local(url):
            return f"Hub não responde em {url}"
        if not start_local_server(url):
            return "Não consegui arrancar o servidor do Hub"
    return None
