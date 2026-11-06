"""«Aceitar tudo» (Definições): ficheiros, comandos e git aprovam-se sozinhos; e-mails e pedidos de propósito continuam à espera."""
from app import aceitar

from test_api import agent, login


def test_aceitar_tudo(client, tmp_path, monkeypatch):
    monkeypatch.setattr(aceitar, "SWITCH", tmp_path / "aceitar-tudo.json")
    owner, mark = login(client, "owner"), login(client, "mark")
    mark_agent = agent(client, "mark", mark)
    tid = client.post("/api/tasks", headers=owner, json={"title": "x", "assignee": "mark"}).json()["id"]

    # desligado: fica à espera, como sempre
    waiting = client.post("/api/agent/approvals", headers=mark_agent, json={"task_id": tid, "action": "sed", "kind": "command"}).json()
    assert waiting["status"] == "PENDING"
    assert client.get("/api/aceitar-tudo", headers=mark).json() == {"on": False}

    # ligar aprova o que já espera
    r = client.put("/api/aceitar-tudo", headers=mark, json={"on": True}).json()
    assert r == {"on": True, "approved": 1}
    assert client.get(f"/api/agent/approvals/{waiting['id']}", headers=mark_agent).json()["status"] == "APPROVED"

    # ligado: comandos, ficheiros e git chegam aprovados; e-mails e pedidos sem tipo não
    for kind in ("command", "file", "git"):
        assert client.post("/api/agent/approvals", headers=mark_agent, json={"task_id": tid, "action": kind, "kind": kind}).json()["status"] == "APPROVED"
    for kind in ("email", ""):
        assert client.post("/api/agent/approvals", headers=mark_agent, json={"task_id": tid, "action": kind, "kind": kind}).json()["status"] == "PENDING"

    # é de cada pessoa: o do owner continua desligado
    assert client.get("/api/aceitar-tudo", headers=owner).json() == {"on": False}

    # desligar volta a pedir
    client.put("/api/aceitar-tudo", headers=mark, json={"on": False})
    assert client.post("/api/agent/approvals", headers=mark_agent, json={"task_id": tid, "action": "ls", "kind": "command"}).json()["status"] == "PENDING"
