"""The crew (crew.py): a task given to a character, the briefing their Claude reads before starting, and the note every
finished task leaves in the Memória for the rest of them."""
import os
import tempfile

os.environ.setdefault("DATABASE_URL", f"sqlite+aiosqlite:///{tempfile.mkdtemp()}/test.db")
os.environ.setdefault("REDIS_URL", "")

import pytest
from fastapi.testclient import TestClient

from app import crew
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


def test_a_task_goes_to_a_crew_member_with_their_role(client):
    owner = login(client, "owner")
    task = client.post("/api/tasks", headers=owner, json={"title": "Campanha de outono", "assignee": "owner", "crew": "joker"}).json()
    assert task["crew"] == "joker" and task["agent_role"] == "marketing" and task["status"] == "ASSIGNED"
    chosen = client.post("/api/tasks", headers=owner, json={"title": "Rever", "assignee": "owner", "crew": "alfred", "agent_role": "testing"}).json()
    assert chosen["agent_role"] == "testing"  # a role chosen by hand stays
    assert client.post("/api/tasks", headers=owner, json={"title": "X", "assignee": "owner", "crew": "bane"}).status_code == 422
    plain = client.post("/api/tasks", headers=owner, json={"title": "Sem ninguém", "assignee": "owner", "for_ai": False}).json()
    assert plain["crew"] == "" and plain["crew_name"] == ""  # a task for a person stays with the person


def test_a_task_for_the_office_goes_to_its_sector_by_itself(client):
    owner = login(client, "owner")

    def send(title, **more):
        return client.post("/api/tasks", headers=owner, json={"title": title, "assignee": "owner", **more}).json()

    def ask(**body):
        return client.post("/api/tasks/route", headers=owner, json=body).json()

    assert send("Fazer a página de preços mais bonita")["crew"] == "catwoman"
    assert send("PESQUISAR fornecedores de café")["crew"] == "riddler"
    assert send("Corrigir o bug do login")["crew"] == "batman"
    assert send("Ver isto", description="Como funciona o sync entre os Hubs?")["crew"] == "lucius"  # the description counts too
    ops = send("Organizar a semana")
    assert ops["crew"] == "gordon" and ops["crew_name"] == "Gordon" and ops["agent_role"] == "custom" and ops["status"] == "ASSIGNED"
    assert send("Qualquer coisa", agent_role="marketing")["crew"] == "joker"  # no word says the sector: the kind of agent does
    assert send("O decorador novo")["crew"] == "gordon"  # "cor" inside another word is not the word

    # asked while it is being written: who would take it and how much that person's agent has before it
    before = ask(title="Testar o checkout")
    assert before["crew"] == "robin" and before["name"] == "Robin" and before["what"] == "Testes" and before["for"]
    send("Mais uma")
    assert ask(title="Testar o checkout")["ahead"] == before["ahead"] + 1
    assert ask(title="Testar o checkout", crew="alfred")["crew"] == "alfred"  # named by hand: that one
    assert client.post("/api/tasks/route", headers=owner, json={"title": "X", "crew": "bane"}).status_code == 422
    assert [c["id"] for c in client.get("/api/tasks/crew", headers=owner).json()] == list(crew.CREW)

    # a task a person had, handed to the office: the office chooses, unless somebody is named
    mine = send("Rever o contrato", for_ai=False)
    assert ask(title=mine["title"], task_id=mine["id"])["ahead"] == ask(title="X")["ahead"]
    given = client.post(f"/api/tasks/{mine['id']}/assign-ai", headers=owner, json={"instructions": "Só as cláusulas de preço"}).json()
    assert given["crew"] == "alfred" and given["agent_role"] == "custom" and given["status"] == "ASSIGNED"
    assert given["agent_instructions"] == "Só as cláusulas de preço"
    other = send("Outra", for_ai=False)
    named = client.post(f"/api/tasks/{other['id']}/assign-ai", headers=owner, json={"crew": "batman"}).json()
    assert named["crew"] == "batman" and named["agent_role"] == "developer"
    assert client.post(f"/api/tasks/{send('Z', for_ai=False)['id']}/assign-ai", headers=owner, json={"crew": "bane"}).status_code == 422


def test_the_briefing_says_who_they_are_and_what_the_team_knows(client):
    owner = login(client, "owner")
    bot = agent(client, "owner", owner)
    client.post("/api/projects", headers=owner, json={"name": "Batcave", "description": "A garagem dos projetos"})
    client.post("/api/memory", headers=owner, json={"scope": "agent", "scope_id": "owner", "category": "REGRAS", "title": "Português", "content": "Tudo em PT-PT"})
    task = client.post("/api/tasks", headers=owner, json={"title": "Página nova", "assignee": "owner", "crew": "catwoman"}).json()
    brief = client.get(f"/api/agent/tasks/{task['id']}/briefing", headers=bot).json()
    assert brief["crew"]["name"] == "Catwoman" and "designer" in brief["crew"]["persona"]
    assert len(brief["team"]) == len(crew.CREW) - 1 and all(m["name"] != "Catwoman" for m in brief["team"])
    assert any(m["title"] == "Português" for m in brief["memory"])
    assert any(p["name"] == "Batcave" for p in brief["projects"])
    assert any(t["title"] == "Campanha de outono" and t["crew"] == "Joker" for t in brief["open"])
    assert all(t["title"] != "Página nova" for t in brief["open"])  # not the task itself


def test_a_finished_task_is_remembered_by_the_whole_crew(client):
    owner = login(client, "owner")
    bot = agent(client, "owner", owner)
    task = client.post("/api/tasks", headers=owner, json={"title": "Corrigir o checkout", "assignee": "owner", "crew": "batman"}).json()
    client.post(f"/api/agent/tasks/{task['id']}/update", headers=bot, json={"status": "IN_PROGRESS"})
    client.post(f"/api/agent/tasks/{task['id']}/update", headers=bot, json={"status": "COMPLETED", "result": "O checkout já paga no Shopify."})
    notes = client.get("/api/memory", headers=owner, params={"scope": "team"}).json()
    note = next(m for m in notes if m["category"] == "TAREFAS" and m["title"] == "Batman: Corrigir o checkout")
    assert "O checkout já paga no Shopify." in note["content"]
    # the next task, by anyone, reads it; and Batman's own briefing lists it as his
    later = client.post("/api/tasks", headers=owner, json={"title": "Seguinte", "assignee": "owner", "crew": "batman"}).json()
    brief = client.get(f"/api/agent/tasks/{later['id']}/briefing", headers=bot).json()
    assert any(m["title"] == "Batman: Corrigir o checkout" for m in brief["memory"])
    assert [t["title"] for t in brief["mine"]] == ["Corrigir o checkout"]
    assert brief["finished"][0]["by"] == "Batman"


def test_only_the_newest_task_notes_reach_a_prompt(client):
    owner = login(client, "owner")
    bot = agent(client, "owner", owner)
    for i in range(crew.MEMORY_KEEP + 4):
        t = client.post("/api/tasks", headers=owner, json={"title": f"Pequena {i:02d}", "assignee": "owner", "crew": "robin"}).json()
        client.post(f"/api/agent/tasks/{t['id']}/update", headers=bot, json={"status": "COMPLETED", "result": f"feito {i}"})
    task = client.post("/api/tasks", headers=owner, json={"title": "Última", "assignee": "owner"}).json()
    memory = client.get(f"/api/agent/tasks/{task['id']}/memory", headers=bot).json()
    titles = [m["title"] for m in memory if m["category"] == "TAREFAS"]
    assert len(titles) == crew.MEMORY_KEEP and "Robin: Pequena 00" not in titles and f"Robin: Pequena {crew.MEMORY_KEEP + 3:02d}" in titles
