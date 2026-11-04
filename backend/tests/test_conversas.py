"""Claude no telemóvel (routers/conversas.py): uma conversa continua a mesma sessão, a mensagem durante um turno não se perde,
«no computador» só vai para o agente do computador, e e só a própria pessoa a vê. Que não sai por sync: test_sync.py."""
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


@pytest.fixture(scope="module")
def people(client):
    david = login(client, "david")
    token = client.post("/api/users/david/agent-token", headers=david).json()["agent_token"]
    agent = {"Authorization": f"Bearer {token}"}
    # the suite shares one database: what other tests left in David's queue would come first
    while task := client.post("/api/agent/tasks/claim", headers=agent, params={"worker": "limpar"}).json()["task"]:
        client.post(f"/api/agent/tasks/{task['id']}/update", headers=agent, json={"status": "COMPLETED", "result": "-"})
    return david, agent, login(client, "mark")


def claim(client, agent, worker):
    """Takes a task as the agent does: it always reads the briefing, which marks the messages as read."""
    task = client.post("/api/agent/tasks/claim", headers=agent, params={"worker": worker}).json()["task"]
    if task:
        client.get(f"/api/agent/tasks/{task['id']}/briefing", headers=agent)
    return task


def finish(client, agent, task_id, text):
    r = client.post(f"/api/agent/tasks/{task_id}/update", headers=agent, json={"status": "COMPLETED", "result": text})
    assert r.status_code == 200


def test_a_conversation_goes_on_in_turns(client, people):
    david, agent, _ = people
    c = client.post("/api/conversas", headers=david, json={"text": "Continua a loja"}).json()
    assert c["where"] == "nuvem" and c["busy"]
    assert client.post("/api/agent/tasks/claim", headers=agent, params={"worker": "1"}).json()["task"]["id"] == c["id"]
    brief = client.get(f"/api/agent/tasks/{c['id']}/briefing", headers=agent).json()
    assert brief["chat"]["new"] == ["Continua a loja"]

    # written during the turn: not lost, and the conversation goes back to the agent when the turn ends
    assert client.post(f"/api/conversas/{c['id']}", headers=david, json={"text": "E o preço"}).status_code == 200
    finish(client, agent, c["id"], "Feito o primeiro")
    seen = client.get(f"/api/conversas/{c['id']}", headers=david).json()
    assert seen["status"] == "ASSIGNED"
    assert [(m["kind"], m["text"]) for m in seen["messages"]] == [
        ("message", "Continua a loja"), ("message", "E o preço"), ("reply", "Feito o primeiro")]
    client.post("/api/agent/tasks/claim", headers=agent, params={"worker": "1"})
    brief = client.get(f"/api/agent/tasks/{c['id']}/briefing", headers=agent).json()
    assert brief["chat"]["new"] == ["E o preço"]
    finish(client, agent, c["id"], "Preço visto")
    assert client.get(f"/api/conversas/{c['id']}", headers=david).json()["status"] == "COMPLETED"

    # at rest: a new message wakes it
    client.post(f"/api/conversas/{c['id']}", headers=david, json={"text": "Mais uma"})
    assert client.get(f"/api/conversas/{c['id']}", headers=david).json()["status"] == "ASSIGNED"
    claim(client, agent, "1")
    finish(client, agent, c["id"], "ok")


def test_on_the_computer_only_its_agent_takes_it(client, people):
    david, agent, _ = people
    c = client.post("/api/conversas", headers=david, json={"text": "No Mac", "where": "pc"}).json()
    assert c["where"] == "pc"
    assert (claim(client, agent, "1") or {}).get("id") != c["id"]
    assert claim(client, agent, "pc")["id"] == c["id"]
    finish(client, agent, c["id"], "Feito no Mac")
    plain = client.post("/api/conversas", headers=david, json={"text": "Na nuvem"}).json()
    assert (claim(client, agent, "pc") or {}).get("id") != plain["id"]   # the computer takes nothing else
    assert claim(client, agent, "1")["id"] == plain["id"]
    finish(client, agent, plain["id"], "ok")


def test_only_its_person_sees_it(client, people):
    david, _, mark = people
    c = client.post("/api/conversas", headers=david, json={"text": "Segredo"}).json()
    assert client.get(f"/api/conversas/{c['id']}", headers=mark).status_code == 404
    assert client.post(f"/api/conversas/{c['id']}", headers=mark, json={"text": "x"}).status_code == 404
    assert all(x["id"] != c["id"] for x in client.get("/api/conversas", headers=mark).json()["conversas"])
    assert all(t["id"] != c["id"] for t in client.get("/api/tasks", headers=david).json())
