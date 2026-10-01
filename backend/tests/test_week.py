import os
import tempfile
from datetime import datetime, timezone

os.environ.setdefault("DATABASE_URL", f"sqlite+aiosqlite:///{tempfile.mkdtemp()}/test.db")
os.environ.setdefault("REDIS_URL", "")

import pytest
from fastapi.testclient import TestClient

from app import commits
from app.main import app


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def login(client, username):
    r = client.post("/api/auth/login", json={"username": username, "password": f"{username}-change-me"})
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['token']}"}


def row(data, username):
    return next(p for p in data["people"] if p["user"] == username)


def test_ledger_counts_logins_tasks_and_commits(client, monkeypatch):
    owner, mark = login(client, "owner"), login(client, "mark")  # david never signs in here: he must show as "parado"
    agent = {"Authorization": "Bearer " + client.post("/api/users/mark/agent-token", headers=mark).json()["agent_token"]}
    now = datetime.now(timezone.utc).isoformat()
    monkeypatch.setattr(commits, "recent", lambda limit=40: [
        {"author": "Marco Goucha", "date": now, "repo": "Agente AMG", "message": "x", "stats": {"added": 10, "deleted": 2}},
        {"author": "Estranho", "date": now, "repo": "Agente AMG", "message": "y", "stats": None}])

    before = row(client.get("/api/week", headers=owner).json(), "mark")  # other test modules share this database
    done = client.post("/api/tasks", headers=owner, json={"title": "Feito", "assignee": "mark"}).json()["id"]
    client.post("/api/tasks", headers=owner, json={"title": "Por fazer", "assignee": "mark"})
    client.post(f"/api/agent/tasks/{done}/update", headers=agent, json={"status": "COMPLETED", "progress": 100})

    data = client.get("/api/week", headers=owner).json()
    me, nobody = row(data, "mark"), row(data, "david")
    assert me["days"][data["today"]] == 1 and me["logins"] >= 1 and me["status"] == "ativo"
    assert me["tasks_done"] - before["tasks_done"] == 1 and me["tasks_open"] - before["tasks_open"] == 1
    assert me["commits"] == 1 and me["added"] == 10 and me["deleted"] == 2  # only the commit by an alias of Marco counts
    assert nobody["commits"] == 0 and nobody["tasks_done"] == 0
    assert any(f["what"] == "login" and f["text"] == "entrou no Hub" for f in data["feed"]) and any(f["what"] == "commit" for f in data["feed"])
    assert data["demo"] is False and len(data["days"]) == 7


def test_local_ledger_refuses_other_machines_and_login_is_required(client):
    assert client.get("/api/week").status_code == 401
    assert client.get("/api/local/week").status_code == 403  # the test client does not come from 127.0.0.1
