"""Two real Hubs, each on its own database, the way two computers of the team run them: no host."""
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import httpx

BACKEND = Path(__file__).resolve().parents[1]
A, B = "http://127.0.0.1:8021", "http://127.0.0.1:8022"


def start(tmp, name, node, port, peer):
    env = {**os.environ, "DATABASE_URL": f"sqlite+aiosqlite:///{(Path(tmp) / name).as_posix()}", "REDIS_URL": "", "TEAM_KEY": "segredo",
           "SYNC": "1", "SYNC_NODE": str(node), "SYNC_PEERS": f"127.0.0.1:{peer}", "SYNC_SECONDS": "1", "TEAM_MODE": "true",
           "WIDGET_NETWORKS": "", "IP_USERS": ""}
    proc = subprocess.Popen([sys.executable, "-m", "uvicorn", "app.main:app", "--port", str(port)], cwd=BACKEND, env=env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    wait(lambda: httpx.get(f"http://127.0.0.1:{port}/api/hub/companies").status_code == 401)
    return proc


def wait(check, timeout=40):
    end = time.time() + timeout
    while True:
        try:
            if check():
                return
        except (httpx.HTTPError, KeyError):
            pass
        assert time.time() < end, "timed out"
        time.sleep(0.5)


def login(url, username):
    token = httpx.post(url + "/api/auth/login", json={"username": username, "password": f"{username}-change-me"}).json()["token"]
    return {"Authorization": f"Bearer {token}"}


def titles(url, headers=None):
    return {t["title"] for t in httpx.get(url + "/api/tasks", headers=headers or login(url, "owner")).json()}


def test_two_hubs_trade_changes_and_neither_is_the_host():
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        a = start(tmp, "a.db", 0, 8021, 8022)  # the owner's computer: its database is the team's
        b = None
        try:
            owner = login(A, "owner")
            first = httpx.post(A + "/api/tasks", headers=owner, json={"title": "feita no A", "assignee": "mark", "for_ai": False}).json()
            b = start(tmp, "b.db", 1, 8022, 8021)  # Marco's computer joins: it takes what the team has
            wait(lambda: "feita no A" in titles(B))
            after = httpx.get(B + "/api/local/notices", params={"user": "mark"}).json()["latest"]

            a.terminate(); a.wait()  # the owner's computer goes off: Marco keeps working on his own Hub
            mark = login(B, "mark")
            second = httpx.post(B + "/api/tasks", headers=mark, json={"title": "feita no B", "assignee": "owner", "for_ai": False}).json()
            assert second["id"] > first["id"] and second["id"] % 4 == 1  # ids still sort by age and never collide
            httpx.patch(B + f"/api/tasks/{first['id']}", headers=mark, json={"title": "mudada no B"})

            a = start(tmp, "a.db", 0, 8021, 8022)  # back on: it gets what happened meanwhile
            wait(lambda: {"feita no B", "mudada no B"} <= titles(A))
            news = httpx.get(A + "/api/local/notices", params={"user": "owner", "after": 0}).json()["items"]
            assert any("feita no B" in n["title"] + n["body"] for n in news)  # and the owner's widget rings for it

            httpx.post(A + "/api/tasks", headers=login(A, "owner"), json={"title": "outra para o Marco", "assignee": "mark", "for_ai": False})
            wait(lambda: any("outra para o Marco" in n["title"] + n["body"] for n in
                             httpx.get(B + "/api/local/notices", params={"user": "mark", "after": after}).json()["items"]))
        finally:
            for proc in (a, b):
                if proc:
                    proc.terminate(); proc.wait()
