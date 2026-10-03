import os
import tempfile

os.environ.setdefault("DATABASE_URL", f"sqlite+aiosqlite:///{tempfile.mkdtemp()}/test.db")
os.environ.setdefault("REDIS_URL", "")

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture(scope="module")
def client():
    # Looks like it comes from this computer, which is what /api/local/* (the widget's door) requires.
    with TestClient(app, client=("127.0.0.1", 50000)) as c:
        yield c


def login(client, username):
    r = client.post("/api/auth/login", json={"username": username, "password": f"{username}-change-me"})
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['token']}"}


def notices(client, who, after=None):
    r = client.get(f"/api/local/notices?user={who}" + ("" if after is None else f"&after={after}"))
    assert r.status_code == 200
    return r.json()


def mark_point(client):
    """Where each person's widget would start reading from: the newest notice they already have."""
    return {who: notices(client, who)["latest"] for who in ("owner", "mark", "david")}


def send(client, headers, assignee, title="Mandada", **extra):
    return client.post("/api/tasks", headers=headers, json={"title": title, "assignee": assignee, "for_ai": False, **extra})


def test_everybody_but_the_sender_is_told_and_only_the_receiver_is_directed(client):
    owner = login(client, "owner")
    after = mark_point(client)
    assert send(client, owner, "mark", "Anúncios de Natal").status_code == 200

    mark, david, sender = (notices(client, w, after[w])["items"] for w in ("mark", "david", "owner"))
    assert [(n["title"], n["directed"]) for n in mark] == [("Owner deu-te uma tarefa: Anúncios de Natal", True)]
    assert [(n["title"], n["directed"]) for n in david] == [("Owner mandou uma tarefa a Mark: Anúncios de Natal", False)]
    assert sender == []  # whoever sends it knows
    assert mark[0]["href"].startswith("#/tarefas/")


def test_a_task_for_kovel_still_reaches_the_others(client):
    owner = login(client, "owner")
    after = mark_point(client)
    send(client, owner, "owner", "Para mim")
    assert notices(client, "owner", after["owner"])["items"] == []
    for who in ("mark", "david"):
        items = notices(client, who, after[who])["items"]
        assert [(n["title"], n["directed"]) for n in items] == [("Owner mandou uma tarefa a Owner: Para mim", False)]


def test_todos_makes_one_task_each_and_tells_everybody_once(client):
    owner = login(client, "owner")
    before = len(client.get("/api/tasks", headers=owner).json())
    after = mark_point(client)
    r = send(client, owner, "all", "Para todos")
    assert r.status_code == 200

    everyone = sorted(u["username"] for u in client.get("/api/users", headers=owner).json())  # other test files add people of their own
    mine = [t for t in client.get("/api/tasks", headers=owner).json() if t["title"] == "Para todos"]
    assert {"owner", "mark", "david"} <= set(everyone)
    assert sorted(t["assignee"] for t in mine) == everyone
    assert len(client.get("/api/tasks", headers=owner).json()) - before == len(everyone)
    assert r.json()["assignee"] in ("owner", "mark", "david")
    for who in ("mark", "david"):
        items = notices(client, who, after[who])["items"]
        assert [(n["title"], n["directed"]) for n in items] == [("Owner mandou uma tarefa a todos: Para todos", True)]
        assert items[0]["href"] == f"#/tarefas/{next(t['id'] for t in mine if t['assignee'] == who)}"  # each opens their own
    assert notices(client, "owner", after["owner"])["items"] == []


def test_only_someone_who_can_direct_work_can_send_to_everybody(client, monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, "team_mode", False)
    mark = login(client, "mark")
    assert send(client, mark, "all", "Não pode").status_code == 403
    assert send(client, mark, "david", "Também não").status_code == 403


def test_other_news_does_not_ring_the_widget(client):
    owner, mark = login(client, "owner"), login(client, "mark")
    tid = send(client, owner, "mark", "Para concluir").json()["id"]
    after = mark_point(client)
    client.patch(f"/api/tasks/{tid}", headers=mark, json={"status": "COMPLETED"})  # tells the sender it is done
    assert any(n["title"].endswith("concluiu: Para concluir") for n in client.get("/api/notifications", headers=owner).json()["items"])
    assert notices(client, "owner", after["owner"])["items"] == []  # but that is not a new task


def test_the_widgets_door_knows_its_people_and_its_visitors(client):
    assert client.get("/api/local/notices?user=nobody").status_code == 404
    assert notices(client, "Mark")["latest"] == notices(client, "mark")["latest"]  # by the name people see, too
    stranger = TestClient(app, client=("203.0.113.9", 5000))
    assert stranger.get("/api/local/notices?user=mark").status_code == 403
