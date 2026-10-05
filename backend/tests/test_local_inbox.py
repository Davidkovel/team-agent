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


def test_a_notification_read_from_the_widget_stays_in_the_history_as_read(client):
    box = inbox(client, "mark")
    first = box["items"][0]
    r = client.post("/api/local/inbox/read", headers=WIDGET, json={"user": "mark", "ids": [first["id"]]})
    assert r.status_code == 200 and r.json()["read"] == 1
    after = inbox(client, "mark", 20)
    assert after["unread"] == box["unread"] - 1
    assert next(n for n in after["items"] if n["id"] == first["id"])["read"] is True
    assert all(not n["read"] for n in after["items"][:after["unread"]])   # the unread ones come first
    mark = login(client, "mark")
    seen = {n["id"]: n["read"] for n in client.get("/api/notifications?limit=200", headers=mark).json()["items"]}
    assert seen[first["id"]] is True                          # the Hub's bell agrees


def test_with_everything_read_the_history_still_shows_the_latest(client):
    ids = [n["id"] for n in inbox(client, "mark", 20)["items"] if not n["read"]]
    client.post("/api/local/inbox/read", headers=WIDGET, json={"user": "mark", "ids": ids})
    box = inbox(client, "mark")
    assert box["unread"] == 0 and len(box["items"]) == 3 and all(n["read"] for n in box["items"])
    assert box["items"][0]["title"] == "Owner deu-te uma tarefa: Quarta"   # newest first


def test_nobody_reads_someone_elses_notifications(client):
    owner = login(client, "owner")
    client.post("/api/tasks", headers=owner, json={"title": "Só minha", "assignee": "mark", "for_ai": False})
    mine = inbox(client, "mark")["items"][0]
    assert mine["read"] is False
    r = client.post("/api/local/inbox/read", headers=WIDGET, json={"user": "david", "ids": [mine["id"]]})
    assert r.json()["read"] == 0 and inbox(client, "mark")["items"][0]["read"] is False
    assert client.post("/api/local/inbox/read", json={"user": "mark", "ids": [mine["id"]]}).status_code == 403  # widgets only


def test_the_door_knows_its_people_and_its_visitors(client):
    assert client.get("/api/local/inbox?user=nobody").status_code == 404
    stranger = TestClient(app, client=("203.0.113.9", 5000))
    assert stranger.get("/api/local/inbox?user=mark").status_code == 403


def test_a_notification_deleted_from_the_widget_is_gone_from_the_hub_too(client):
    owner = login(client, "owner")
    client.post("/api/tasks", headers=owner, json={"title": "Para apagar", "assignee": "mark", "for_ai": False})
    box = inbox(client, "mark")
    gone = box["items"][0]
    assert gone["title"] == "Owner deu-te uma tarefa: Para apagar" and gone["read"] is False
    r = client.post("/api/local/inbox/delete", headers=WIDGET, json={"user": "mark", "ids": [gone["id"]]})
    assert r.status_code == 200 and r.json()["deleted"] == 1
    after = inbox(client, "mark", 20)
    assert gone["id"] not in [n["id"] for n in after["items"]] and after["unread"] == box["unread"] - 1
    mark = login(client, "mark")
    assert gone["id"] not in [n["id"] for n in client.get("/api/notifications?limit=200", headers=mark).json()["items"]]


def test_clear_all_empties_only_that_persons_notifications(client):
    owner = login(client, "owner")
    client.post("/api/tasks", headers=owner, json={"title": "Para o David", "assignee": "david", "for_ai": False})
    davids = [n["id"] for n in inbox(client, "david", 20)["items"]]
    assert davids and inbox(client, "mark")["items"]
    r = client.post("/api/local/inbox/delete", headers=WIDGET, json={"user": "mark", "all": True})
    assert r.status_code == 200 and r.json()["deleted"] > 0
    assert inbox(client, "mark") == {"unread": 0, "items": []}
    assert [n["id"] for n in inbox(client, "david", 20)["items"]] == davids   # David's are his


def test_nobody_deletes_someone_elses_notifications(client):
    owner = login(client, "owner")
    client.post("/api/tasks", headers=owner, json={"title": "Do Marco", "assignee": "mark", "for_ai": False})
    mine = inbox(client, "mark")["items"][0]
    r = client.post("/api/local/inbox/delete", headers=WIDGET, json={"user": "david", "ids": [mine["id"]]})
    assert r.json()["deleted"] == 0
    assert client.post("/api/local/inbox/delete", json={"user": "mark", "all": True}).status_code == 403   # widgets only
    assert inbox(client, "mark")["items"][0]["id"] == mine["id"]
