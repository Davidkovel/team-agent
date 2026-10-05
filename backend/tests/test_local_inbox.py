import os
import tempfile

os.environ.setdefault("DATABASE_URL", f"sqlite+aiosqlite:///{tempfile.mkdtemp()}/test.db")
os.environ.setdefault("REDIS_URL", "")

import pytest
from fastapi.testclient import TestClient

from app.main import app

WIDGET = {"X-Team-Widget": "1"}


@pytest.fixture(scope="module")
def client():
    # Looks like it comes from this computer, which is what /api/local/* (the widget's door) requires.
    with TestClient(app, client=("127.0.0.1", 50000)) as c:
        yield c


def login(client, username):
    r = client.post("/api/auth/login", json={"username": username, "password": f"{username}-change-me"})
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['token']}"}


def inbox(client, who, limit=3):
    r = client.get(f"/api/local/inbox?user={who}&limit={limit}")
    assert r.status_code == 200
    return r.json()


def test_the_widget_sees_the_newest_unread_notifications(client):
    owner = login(client, "owner")
    before = inbox(client, "mark")["unread"]
    for title in ("Primeira", "Segunda", "Terceira", "Quarta"):
        client.post("/api/tasks", headers=owner, json={"title": title, "assignee": "mark", "for_ai": False})
    box = inbox(client, "mark")
    assert box["unread"] == before + 4
    assert [n["title"] for n in box["items"]] == ["Owner deu-te uma tarefa: Quarta", "Owner deu-te uma tarefa: Terceira",
                                                  "Owner deu-te uma tarefa: Segunda"]
    assert box["items"][0]["href"].startswith("#/tarefas/") and box["items"][0]["kind"] == "task_new"
    assert inbox(client, "Mark")["unread"] == box["unread"]   # by the name people see, too


def test_a_notification_read_from_the_widget_leaves_the_list(client):
    first = inbox(client, "mark")["items"][0]
    r = client.post("/api/local/inbox/read", headers=WIDGET, json={"user": "mark", "ids": [first["id"]]})
    assert r.status_code == 200 and r.json()["read"] == 1
    assert first["id"] not in [n["id"] for n in inbox(client, "mark", 20)["items"]]
    mark = login(client, "mark")
    seen = {n["id"]: n["read"] for n in client.get("/api/notifications?limit=200", headers=mark).json()["items"]}
    assert seen[first["id"]] is True                          # the Hub's bell agrees


def test_nobody_reads_someone_elses_notifications(client):
    marks = [n["id"] for n in inbox(client, "mark", 20)["items"]]
    r = client.post("/api/local/inbox/read", headers=WIDGET, json={"user": "david", "ids": marks[:1]})
    assert r.json()["read"] == 0 and marks[0] in [n["id"] for n in inbox(client, "mark", 20)["items"]]
    assert client.post("/api/local/inbox/read", json={"user": "mark", "ids": marks[:1]}).status_code == 403  # widgets only


def test_the_door_knows_its_people_and_its_visitors(client):
    assert client.get("/api/local/inbox?user=nobody").status_code == 404
    stranger = TestClient(app, client=("203.0.113.9", 5000))
    assert stranger.get("/api/local/inbox?user=mark").status_code == 403
