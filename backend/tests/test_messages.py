"""Mensagens (21 Oct): the team writes to each other; the one who receives it gets a notification, a card in the widget,
and the conversation counts as read once opened. Only the two people of a conversation see it."""
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


def ids(client, headers):
    """{username: id} of the other people, from this person's conversations."""
    return {c["username"]: c["peer"] for c in client.get("/api/messages", headers=headers).json()["conversations"] if c["peer"] != "team"}


def conv(client, headers, peer):
    return next(c for c in client.get("/api/messages", headers=headers).json()["conversations"] if c["peer"] == peer)


def test_a_message_reaches_one_person_and_only_them(client):
    owner, mark, david = (login(client, u) for u in ("owner", "mark", "david"))
    to_mark = ids(client, owner)["mark"]
    after = client.get("/api/local/notices?user=mark").json()["latest"]
    text = "A conta nova:\n```\nlogin 123\n```"
    r = client.post(f"/api/messages/{to_mark}", headers=owner, json={"body": text})
    assert r.status_code == 200 and r.json()["body"] == text

    owner_id = ids(client, mark)["owner"]
    assert conv(client, mark, owner_id)["unread"] == 1
    card = client.get(f"/api/local/notices?user=mark&after={after}").json()["items"]
    assert [(n["caption"], n["directed"], n["href"]) for n in card] == [("MENSAGEM PARA TI", True, f"#/mensagens/{owner_id}")]
    inbox = client.get("/api/notifications", headers=mark).json()["items"]
    assert any(n["kind"] == "message" and "login 123" in n["body"] and not n["read"] for n in inbox)

    # David is not in it: his conversation with Owner is empty, and he cannot open Owner and Mark's
    assert conv(client, david, ids(client, david)["owner"])["last"] is None
    assert client.get(f"/api/messages/{to_mark}", headers=david).json()["messages"] == []

    # opening it reads it: no more unread, and the notification is read too
    thread = client.get(f"/api/messages/{owner_id}", headers=mark).json()["messages"]
    assert [m["body"] for m in thread] == [text]
    assert conv(client, mark, owner_id)["unread"] == 0
    inbox = client.get("/api/notifications", headers=mark).json()["items"]
    assert all(n["read"] for n in inbox if n["kind"] == "message")


def test_the_team_conversation_reaches_everybody_else(client):
    owner, mark, david = (login(client, u) for u in ("owner", "mark", "david"))
    assert client.post("/api/messages/team", headers=david, json={"body": "Reunião às 15h"}).status_code == 200
    assert conv(client, owner, "team")["unread"] >= 1 and conv(client, mark, "team")["unread"] >= 1
    assert conv(client, david, "team")["unread"] == 0   # what I write, I have read


def test_only_my_own_messages_can_be_taken_back(client):
    owner, mark = login(client, "owner"), login(client, "mark")
    m = client.post("/api/messages/team", headers=owner, json={"body": "engano"}).json()
    assert client.delete(f"/api/messages/msg/{m['id']}", headers=mark).status_code == 404
    assert client.delete(f"/api/messages/msg/{m['id']}", headers=owner).status_code == 200
    assert all(x["id"] != m["id"] for x in client.get("/api/messages/team", headers=owner).json()["messages"])


def test_bad_conversations_and_empty_messages_are_refused(client):
    owner = login(client, "owner")
    me = next(c for c in client.get("/api/messages", headers=owner).json()["conversations"])  # the team
    assert me["peer"] == "team"
    assert client.post("/api/messages/9999", headers=owner, json={"body": "olá"}).status_code == 404
    assert client.post("/api/messages/abc", headers=owner, json={"body": "olá"}).status_code == 404
    assert client.post("/api/messages/team", headers=owner, json={"body": "   "}).status_code == 400
