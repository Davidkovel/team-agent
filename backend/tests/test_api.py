import os
import tempfile

os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{tempfile.mkdtemp()}/test.db"
os.environ["REDIS_URL"] = ""
os.environ["HEARTBEAT_TIMEOUT"] = "30"

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def login(client, username):
    r = client.post("/api/auth/login", json={"username": username, "password": f"{username}-change-me"})
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['token']}"}


def agent(client, username, human):
    r = client.post(f"/api/users/{username}/agent-token", headers=human)
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['agent_token']}"}


def test_login_rejects_bad_password(client):
    assert client.post("/api/auth/login", json={"username": "mark", "password": "x"}).status_code == 401


def test_member_cannot_assign_to_others_or_issue_foreign_token(client):
    mark = login(client, "mark")
    r = client.post("/api/tasks", json={"title": "t", "assignee": "david"}, headers=mark)
    assert r.status_code == 403
    assert client.post("/api/users/david/agent-token", headers=mark).status_code == 403


def test_full_task_lifecycle_with_approval_and_recovery(client):
    owner, mark, david = login(client, "owner"), login(client, "mark"), login(client, "david")
    mark_agent = agent(client, "mark", mark)

    task = client.post("/api/tasks", headers=owner, json={
        "title": "Create Meta Ads", "goal": "Prepare campaign", "assignee": "mark",
        "requirements": ["3 creatives", "3 texts", "2 headlines"]}).json()
    tid = task["id"]

    # Agent picks the task up.
    assert [t["id"] for t in client.get("/api/agent/tasks/next", headers=mark_agent).json()] == [tid]
    client.post(f"/api/agent/tasks/{tid}/update", headers=mark_agent,
                json={"status": "IN_PROGRESS", "progress": 45, "last_action": "Created ad copy",
                      "next_action": "Create creatives", "session_id": "sess-1"})
    assert client.get("/api/agent/tasks/next", headers=mark_agent).json() == []

    # Heartbeat -> presence. Owner sees details, David only team info, and never Mark's tasks.
    hb = client.post("/api/agent/heartbeat", headers=mark_agent, json={
        "status": "WORKING", "task_id": tid, "task": "Create Meta Ads", "progress": 45,
        "last_action": "Created ad copy"}).json()
    assert hb["commands"] == []
    as_owner = {m["user"]: m for m in client.get("/api/team", headers=owner).json()}
    as_david = {m["user"]: m for m in client.get("/api/team", headers=david).json()}
    assert as_owner["mark"]["status"] == "WORKING" and as_owner["mark"]["last_action"] == "Created ad copy"
    assert as_david["mark"]["status"] == "WORKING" and as_david["mark"]["progress"] == 45
    assert "last_action" not in as_david["mark"]
    assert as_david["david"]["status"] == "OFFLINE"
    assert client.get("/api/tasks", headers=david).json() == []
    assert client.get(f"/api/tasks/{tid}", headers=david).status_code == 403

    # Recovery returns saved context.
    rec = client.get("/api/agent/recovery", headers=mark_agent).json()
    assert rec["task"]["id"] == tid and rec["task"]["progress"] == 45
    assert rec["task"]["session_id"] == "sess-1"
    assert rec["events"][0]["message"] == "Created ad copy"

    # Approval: member cannot decide, owner can; decision reaches the agent as a command.
    ap = client.post("/api/agent/approvals", headers=mark_agent,
                     json={"task_id": tid, "action": "Publish campaign"}).json()
    assert client.post(f"/api/approvals/{ap['id']}/decide", headers=mark, json={"approve": True}).status_code == 403
    assert client.post(f"/api/approvals/{ap['id']}/decide", headers=owner, json={"approve": True}).json()["status"] == "APPROVED"
    assert client.post(f"/api/approvals/{ap['id']}/decide", headers=owner, json={"approve": True}).status_code == 409
    assert client.get(f"/api/agent/approvals/{ap['id']}", headers=mark_agent).json()["status"] == "APPROVED"

    # Owner control command is queued for the agent too.
    client.post(f"/api/tasks/{tid}/control", headers=owner, json={"action": "pause"})
    cmds = client.post("/api/agent/heartbeat", headers=mark_agent, json={"status": "WORKING"}).json()["commands"]
    assert [c["type"] for c in cmds] == ["approval", "pause"]

    # Usage + completion.
    client.post("/api/agent/usage", headers=mark_agent,
                json={"task_id": tid, "input_tokens": 100, "output_tokens": 50, "cost_usd": 0.01})
    done = client.post(f"/api/agent/tasks/{tid}/update", headers=mark_agent,
                       json={"status": "COMPLETED", "result": "Campaign ready"}).json()
    assert done["progress"] == 100 and done["completed_at"]
    assert client.get("/api/agent/recovery", headers=mark_agent).json()["task"] is None
    assert client.get("/api/usage", headers=owner).json()[0]["input_tokens"] == 100
    assert client.get("/api/usage", headers=david).json() == []
    assert any("COMPLETED" in a["message"] for a in client.get("/api/activity", headers=owner).json())


def test_agent_cannot_touch_foreign_task(client):
    owner, david = login(client, "owner"), login(client, "david")
    david_agent = agent(client, "david", david)
    tid = client.post("/api/tasks", headers=owner, json={"title": "x", "assignee": "mark"}).json()["id"]
    r = client.post(f"/api/agent/tasks/{tid}/update", headers=david_agent, json={"progress": 5})
    assert r.status_code == 404


def test_websocket_visibility(client):
    owner, david = login(client, "owner"), login(client, "david")
    otok, dtok = owner["Authorization"][7:], david["Authorization"][7:]
    with client.websocket_connect(f"/ws?token={otok}") as ows, client.websocket_connect(f"/ws?token={dtok}") as dws:
        client.post("/api/tasks", headers=owner, json={"title": "private", "assignee": "mark"})
        assert ows.receive_json()["type"] == "activity"
        client.post("/api/tasks", headers=owner, json={"title": "for david", "assignee": "david"})
        # David's first event must be about himself, not Mark's private task.
        assert dws.receive_json()["user_id"] != 2


def test_workspace_docs_and_finance(client):
    owner, mark, david = login(client, "owner"), login(client, "mark"), login(client, "david")
    shared = client.post("/api/docs", headers=mark, json={"section": "skills", "folder": "Ads", "title": "Meta copy", "content": "x"}).json()
    private = client.post("/api/docs", headers=mark, json={"section": "notes", "title": "Mine", "shared": False}).json()
    assert [d["title"] for d in client.get("/api/docs?section=skills", headers=david).json()] == ["Meta copy"]
    assert client.get("/api/docs?section=notes", headers=david).json() == []
    assert client.put(f"/api/docs/{private['id']}", headers=david, json={"section": "notes", "title": "hack"}).status_code == 404
    # A teammate can edit a shared doc but not hide or delete it.
    body = {"section": "skills", "folder": "Ads", "title": "Meta copy v2", "content": "y"}
    assert client.put(f"/api/docs/{shared['id']}", headers=david, json=body).json()["title"] == "Meta copy v2"
    assert client.put(f"/api/docs/{shared['id']}", headers=david, json={**body, "shared": False}).status_code == 403
    assert client.delete(f"/api/docs/{shared['id']}", headers=david).status_code == 403
    assert client.delete(f"/api/docs/{shared['id']}", headers=owner).status_code == 200

    assert client.get("/api/finance", headers=mark).status_code == 403
    client.post("/api/finance", headers=owner, json={"kind": "income", "amount": 1000, "date": "2026-10-01"})
    client.post("/api/finance", headers=owner, json={"kind": "expense", "amount": 300, "date": "2026-10-02"})
    f = client.get("/api/finance", headers=owner).json()
    assert (f["income"], f["expenses"]) == (1000, 300)
    assert f["profit"] == round(700 - f["ai_cost"], 2) and f["months"][0]["month"] == "2026-10"
    assert "finance" in client.get("/api/overview", headers=owner).json()
    assert "finance" not in client.get("/api/overview", headers=mark).json()
