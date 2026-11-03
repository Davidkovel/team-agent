"""Several agents of one person (amg-agent@N on the cloud server): each task goes to one of them only, and a chain of tasks
starts its next step by itself, with the result of the one before."""
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


def agent(client, username, human):
    r = client.post(f"/api/users/{username}/agent-token", headers=human)
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['agent_token']}"}


def claim(client, bot, worker):
    return client.post("/api/agent/tasks/claim", headers=bot, params={"worker": worker}).json()["task"]


def drain(client, bot):
    while task := claim(client, bot, "9"):
        client.post(f"/api/agent/tasks/{task['id']}/update", headers=bot, json={"status": "COMPLETED", "result": "ok"})


def test_two_agents_never_get_the_same_task(client):
    owner = login(client, "owner")
    bot = agent(client, "owner", owner)
    drain(client, bot)
    a = client.post("/api/tasks", headers=owner, json={"title": "Primeira", "assignee": "owner"}).json()
    b = client.post("/api/tasks", headers=owner, json={"title": "Segunda", "assignee": "owner"}).json()
    first, second = claim(client, bot, "1"), claim(client, bot, "2")
    assert {first["id"], second["id"]} == {a["id"], b["id"]}
    assert first["worker"] == "1" and second["worker"] == "2"
    assert claim(client, bot, "3") is None
    # each one finds its own task again after a restart, and only its own
    for t in (first, second):
        client.post(f"/api/agent/tasks/{t['id']}/update", headers=bot, json={"status": "IN_PROGRESS"})
    assert client.get("/api/agent/recovery", headers=bot, params={"worker": "2"}).json()["task"]["id"] == second["id"]
    for t in (first, second):
        client.post(f"/api/agent/tasks/{t['id']}/update", headers=bot, json={"status": "COMPLETED", "result": "ok"})


def test_a_chain_starts_each_step_with_the_result_of_the_one_before(client):
    owner = login(client, "owner")
    bot = agent(client, "owner", owner)
    drain(client, bot)
    r = client.post("/api/tasks/chain", headers=owner, json={"assignee": "owner", "steps": [
        {"title": "Encontrar escolas de condução", "description": "Na minha zona"},
        {"title": "Escrever-lhes um e-mail"},
        {"title": "Fazer o PDF"}]})
    assert r.status_code == 200, r.text
    steps = r.json()
    assert [s["status"] for s in steps] == ["ASSIGNED", "BLOCKED", "BLOCKED"]
    assert steps[1]["after_id"] == steps[0]["id"] and steps[2]["after_id"] == steps[1]["id"]
    got = claim(client, bot, "1")
    assert got["id"] == steps[0]["id"] and claim(client, bot, "2") is None  # the second waits
    client.post(f"/api/agent/tasks/{got['id']}/update", headers=bot,
                json={"status": "COMPLETED", "result": "Escola A: a@escola.pt"})
    nxt = claim(client, bot, "2")
    assert nxt["id"] == steps[1]["id"] and "Escola A: a@escola.pt" in nxt["description"]
    assert client.post("/api/tasks/chain", headers=owner, json={"assignee": "owner", "steps": [{"title": "Só um"}]}).status_code == 422
