"""Who did what on a task: who made it, who finished it (not always the person it was for) and who changed what."""
import os
import tempfile

os.environ.setdefault("DATABASE_URL", f"sqlite+aiosqlite:///{tempfile.mkdtemp()}/test.db")
os.environ.setdefault("REDIS_URL", "")

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture(scope="module")
def client():
    with TestClient(app, client=("127.0.0.1", 50000)) as c:
        yield c


def login(client, username):
    r = client.post("/api/auth/login", json={"username": username, "password": f"{username}-change-me"})
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['token']}"}


def send(client, headers, assignee, title):
    r = client.post("/api/tasks", headers=headers, json={"title": title, "assignee": assignee, "for_ai": False})
    assert r.status_code == 200
    return r.json()


def listed(client, headers, task_id):
    return next(x for x in client.get("/api/tasks", headers=headers).json() if x["id"] == task_id)


def test_who_made_it_and_who_finished_it(client):
    owner, mark = login(client, "owner"), login(client, "mark")
    task = send(client, owner, "mark", "Para o Mark")
    assert task["created_by"] == "owner" and task["completed_by"] is None
    client.patch(f"/api/tasks/{task['id']}", headers=owner, json={"status": "COMPLETED"})  # the owner finished Mark's task
    assert listed(client, mark, task["id"])["completed_by"] == "owner"
    assert client.get(f"/api/tasks/{task['id']}", headers=mark).json()["completed_by"] == "owner"


def test_reopening_forgets_who_finished_it(client):
    owner = login(client, "owner")
    task = send(client, owner, "mark", "Reaberta")
    client.patch(f"/api/tasks/{task['id']}", headers=owner, json={"status": "COMPLETED"})
    client.patch(f"/api/tasks/{task['id']}", headers=owner, json={"status": "TODO"})
    assert listed(client, owner, task["id"])["completed_by"] is None


def test_the_history_says_who_changed_what(client):
    owner, mark = login(client, "owner"), login(client, "mark")
    task = send(client, owner, "mark", "Com histórico")
    client.patch(f"/api/tasks/{task['id']}", headers=owner, json={"priority": "urgent", "deadline": "2026-10-08T14:00:00Z"})
    client.patch(f"/api/tasks/{task['id']}", headers=mark, json={"title": "Com histórico novo"})
    client.patch(f"/api/tasks/{task['id']}", headers=mark, json={"status": "COMPLETED"})
    log = client.get(f"/api/tasks/{task['id']}", headers=owner).json()["log"]
    said = [(e["who"], e["message"]) for e in log]
    assert said[0] == ("owner", "criou a tarefa para Mark")
    assert any(who == "owner" and "prioridade para Urgente" in m and "prazo" in m for who, m in said)
    assert any(who == "mark" and "mudou o título" in m for who, m in said)
    assert said[-1] == ("mark", "concluiu")
    assert [e["at"] for e in log] == sorted(e["at"] for e in log)


def test_an_edit_that_changes_nothing_is_not_written_down(client):
    owner = login(client, "owner")
    task = send(client, owner, "mark", "Igual")
    client.patch(f"/api/tasks/{task['id']}", headers=owner, json={"title": "Igual", "priority": "normal"})
    assert [e["message"] for e in client.get(f"/api/tasks/{task['id']}", headers=owner).json()["log"]] == ["criou a tarefa para Mark"]


def test_doing_button_shows_the_team_who_is_on_what(client):
    owner, mark = login(client, "owner"), login(client, "mark")
    a = client.post("/api/tasks", headers=owner, json={"title": "logo novo", "assignee": "mark"}).json()["id"]
    b = client.post("/api/tasks", headers=owner, json={"title": "fotos", "assignee": "mark"}).json()["id"]
    assert client.patch(f"/api/tasks/{a}", headers=owner, json={"doing": True}).status_code == 403  # only the person it is for
    assert client.patch(f"/api/tasks/{a}", headers=mark, json={"doing": True}).json()["doing_since"]
    seen = {m["user"]: m["doing"] for m in client.get("/api/team", headers=owner).json()}
    assert seen["mark"]["id"] == a and seen["owner"] is None
    client.patch(f"/api/tasks/{b}", headers=mark, json={"doing": True})  # one at a time: b replaces a
    assert client.get(f"/api/tasks/{a}", headers=mark).json()["doing_since"] is None
    client.patch(f"/api/tasks/{b}", headers=mark, json={"status": "COMPLETED"})  # done clears it
    assert next(m for m in client.get("/api/team", headers=owner).json() if m["user"] == "mark")["doing"] is None
