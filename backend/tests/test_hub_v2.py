"""The Team AI Hub additions: migrations, projects, the task board, sessions and subagents, notifications, memory,
expenses, analytics, search and questions for the AI."""
import asyncio
import sqlite3

from test_api import agent, client, login  # noqa: F401  (first: it points the app at a temporary database)

from sqlalchemy.ext.asyncio import create_async_engine

import pytest

from app import migrate, services
from app.realtime import rt


@pytest.fixture(autouse=True)
def nobody_left_online():
    """These tests bring agents online; the other test files start from an empty team."""
    yield
    rt.store._presence.clear()
    rt.store._commands.clear()
    rt.online.clear()
    services.ONLINE_VIA.clear()
    services.PENDING_ONLINE.clear()


def test_migration_upgrades_an_old_database_and_keeps_its_rows(tmp_path):
    """A database from the first release (no version table, fewer columns) is brought up to date without losing a row,
    a backup is left beside it, and running it again changes nothing."""
    path = tmp_path / "hub.db"
    with sqlite3.connect(path) as old:
        old.execute("CREATE TABLE users (id INTEGER PRIMARY KEY, username VARCHAR(50), display_name VARCHAR(100), "
                    "role VARCHAR(20), password_hash VARCHAR(200), agent_token_hash VARCHAR(64))")
        old.execute("CREATE TABLE tasks (id INTEGER PRIMARY KEY, title VARCHAR(200), description TEXT, goal TEXT, requirements JSON, "
                    "project VARCHAR(100), assignee_id INTEGER, created_by INTEGER, status VARCHAR(30), progress INTEGER, "
                    "current_action TEXT, last_action TEXT, next_action TEXT, result TEXT, session_id VARCHAR(100), "
                    "created_at DATETIME, updated_at DATETIME, started_at DATETIME, completed_at DATETIME)")
        old.execute("INSERT INTO users VALUES (1, 'owner', 'Kovel', 'owner', 'x', NULL)")
        old.execute("INSERT INTO tasks (id, title, assignee_id, created_by, status, progress) VALUES (7, 'Old task', 1, 1, 'ASSIGNED', 40)")

    async def run():
        engine = create_async_engine(f"sqlite+aiosqlite:///{path}")
        await migrate.upgrade(engine)
        await migrate.upgrade(engine)  # idempotent
        async with engine.connect() as conn:
            tables, columns = await conn.run_sync(migrate.pending)
            version = await conn.run_sync(migrate.current_version)
        await engine.dispose()
        return tables, columns, version

    tables, columns, version = asyncio.run(run())
    assert (tables, columns, version) == ([], [], migrate.SCHEMA_VERSION)
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT title, progress, priority FROM tasks WHERE id = 7").fetchone() == ("Old task", 40, "normal")
        assert db.execute("SELECT COUNT(*) FROM schema_version").fetchone() == (1,)
        assert db.execute("SELECT COUNT(*) FROM projects").fetchone() == (0,)
    backups = list(tmp_path.glob("hub.db.bak-*"))
    assert len(backups) == 1  # made once, before the change; the second run had nothing to change
    with sqlite3.connect(backups[0]) as copy:
        assert copy.execute("SELECT title FROM tasks").fetchone() == ("Old task",)


def test_project_board_and_assign_to_ai(client):
    owner = login(client, "owner")
    project = client.post("/api/projects", headers=owner, json={"name": "BareDesk Shopify"}).json()
    assert project["status"] == "active" and project["tasks"] == 0
    assert client.post("/api/projects", headers=owner, json={"name": "BareDesk Shopify"}).status_code == 409

    task = client.post("/api/tasks", headers=owner, json={
        "title": "Fix checkout", "assignee": "mark", "project_id": project["id"], "priority": "high", "for_ai": False}).json()
    assert (task["status"], task["stage"], task["project_name"], task["priority"]) == ("TODO", "todo", "BareDesk Shopify", "high")
    # a task kept for a person is not offered to the agent
    mark_agent = agent(client, "mark", owner)
    assert all(t["id"] != task["id"] for t in client.get("/api/agent/tasks/next", headers=mark_agent).json())

    blocked = client.patch(f"/api/tasks/{task['id']}", headers=owner, json={"status": "BLOCKED", "blocked_reason": "No API key"}).json()
    assert (blocked["stage"], blocked["blocked_reason"]) == ("blocked", "No API key")
    assert any(i["kind"] == "task_blocked" for i in client.get("/api/attention", headers=owner).json())

    assert client.post(f"/api/tasks/{task['id']}/assign-ai", headers=owner, json={"role": "custom"}).status_code == 422
    given = client.post(f"/api/tasks/{task['id']}/assign-ai", headers=owner, json={"role": "testing"}).json()
    assert (given["status"], given["agent_role"], given["blocked_reason"]) == ("ASSIGNED", "testing", "")
    assert any(t["id"] == task["id"] for t in client.get("/api/agent/tasks/next", headers=mark_agent).json())
    # while the agent works on it, a person cannot move it
    client.post(f"/api/agent/tasks/{task['id']}/update", headers=mark_agent, json={"status": "IN_PROGRESS"})
    assert client.patch(f"/api/tasks/{task['id']}", headers=owner, json={"status": "REVIEW"}).status_code == 409

    detail = client.get(f"/api/projects/{project['id']}", headers=owner).json()
    assert detail["open_tasks"] == 1 and detail["people"] == ["mark"] and detail["ai_cost_usd"] is None


def test_sessions_subagents_usage_and_notifications(client):
    owner = login(client, "owner")
    mark = login(client, "mark")
    mark_agent = agent(client, "mark", owner)
    task = client.post("/api/tasks", headers=owner, json={"title": "Research competitors", "assignee": "mark"}).json()
    client.post("/api/agent/heartbeat", headers=mark_agent, json={"status": "WORKING", "task_id": task["id"], "task": task["title"]})

    session = client.post("/api/agent/sessions", headers=mark_agent, json={"task_id": task["id"], "model": "claude-sonnet-5-5"}).json()
    assert session["status"] == "RUNNING" and session["cost_usd"] is None
    client.post(f"/api/agent/sessions/{session['id']}", headers=mark_agent,
                json={"current_action": "read_file checkout.tsx", "input_tokens": 1200, "output_tokens": 300, "tool_uses": 2})
    sub = client.post(f"/api/agent/sessions/{session['id']}/subagents", headers=mark_agent,
                      json={"external_id": "toolu_1", "role": "research", "task": "Find three competitors"}).json()
    assert (sub["name"], sub["status"], sub["total_tokens"]) == ("research", "RUNNING", None)
    client.post(f"/api/agent/sessions/{session['id']}/subagents", headers=mark_agent,
                json={"external_id": "toolu_1", "status": "DONE", "total_tokens": 900, "tool_uses": 4})

    card = next(a for a in client.get("/api/agents", headers=owner).json() if a["id"] == "mark")
    assert card["name"].startswith("Claude / ") and card["status"] == "WORKING"
    assert card["session"]["tokens"] == {"input": 1200, "output": 300, "cache_read": 0, "cache_creation": 0, "total": 1500}
    assert [(s["role"], s["status"], s["total_tokens"]) for s in card["subagents"]] == [("research", "DONE", 900)]
    # a member does not see inside a teammate's session
    david = login(client, "david")
    assert next(a for a in client.get("/api/agents", headers=david).json() if a["id"] == "mark")["session"] is None
    assert client.get("/api/agents/mark", headers=owner).json()["sessions"][0]["id"] == session["id"]

    # an approval with its risk and files reaches the owner as a notification
    client.post("/api/agent/approvals", headers=mark_agent, json={
        "task_id": task["id"], "action": "git push", "risk": "high", "kind": "git", "files": ["checkout.tsx"]})
    pending = client.get("/api/approvals", headers=owner).json()[0]
    assert (pending["risk"], pending["files"]) == ("high", ["checkout.tsx"])
    inbox = client.get("/api/notifications", headers=owner).json()
    assert inbox["unread"] >= 1 and inbox["items"][0]["kind"] == "approval_required"
    assert client.get("/api/attention", headers=owner).json()[0]["kind"] == "approval_required"
    client.post("/api/notifications/read", headers=owner, json={})
    assert client.get("/api/notifications", headers=owner).json()["unread"] == 0

    # the run ends: usage is recorded against the session, the session closes, the creator hears about the task
    client.post("/api/agent/usage", headers=mark_agent, json={
        "task_id": task["id"], "session_id": session["id"], "model": "claude-sonnet-5-5",
        "input_tokens": 2000, "output_tokens": 500, "cost_usd": 0.42})
    done = client.post(f"/api/agent/sessions/{session['id']}", headers=mark_agent, json={"status": "DONE", "cost_usd": 0.42}).json()
    assert done["finished_at"] and done["cost_usd"] == 0.42
    client.post(f"/api/agent/tasks/{task['id']}/update", headers=mark_agent, json={"status": "COMPLETED", "result": "ok"})
    assert any(n["kind"] == "task_completed" for n in client.get("/api/notifications", headers=owner).json()["items"])
    assert client.get(f"/api/tasks/{task['id']}", headers=owner).json()["ai_cost_usd"] == 0.42

    summary = client.get("/api/usage/summary", headers=owner).json()
    assert summary["cost_source"] == "estimated" and summary["input_tokens"] >= 2000
    mine = client.get("/api/usage/summary", headers=david).json()  # a member's numbers are only his own runs
    assert mine["input_tokens"] < summary["input_tokens"] and (mine["cost_usd"] is None) == (mine["runs"] == 0)
    numbers = client.get("/api/analytics", headers=owner).json()
    assert numbers["cost"]["source"] == "estimated" and numbers["ai"]["subagents"] >= 1
    assert numbers["value"]["time_saved"] == {"source": "not_connected"}
    assert numbers["code"]["pull_requests"] == {"source": "not_connected"}
    assert mark  # mark's own login still works alongside the agent token


def test_memory_expenses_and_search(client):
    owner = login(client, "owner")
    david = login(client, "david")
    note = client.post("/api/memory", headers=owner, json={
        "scope": "team", "category": "DECISIONS", "title": "Pricing multiplier", "content": "x2.5 to x3"}).json()
    assert note["scope_id"] == ""
    assert client.post("/api/memory", headers=owner, json={"scope": "project", "title": "No id"}).status_code == 422
    assert client.post("/api/memory", headers=david, json={"scope": "team", "title": "Not allowed"}).status_code == 403
    assert client.post("/api/memory", headers=david, json={"scope": "agent", "scope_id": "david", "title": "Mine"}).status_code == 200
    # finished tasks also leave TAREFAS notes (crew.py); the hand-written ones are what this checks
    assert [m["title"] for m in client.get("/api/memory?scope=team", headers=david).json() if m["category"] != "TAREFAS"] == ["Pricing multiplier"]

    # the notes reach the agent with the task they apply to
    mark_agent = agent(client, "mark", owner)
    task = client.post("/api/tasks", headers=owner, json={"title": "Update prices", "assignee": "mark"}).json()
    assert [m["title"] for m in client.get(f"/api/agent/tasks/{task['id']}/memory", headers=mark_agent).json() if m["category"] != "TAREFAS"] == ["Pricing multiplier"]

    empty = client.get("/api/expenses", headers=owner).json()
    assert empty["items"] == [] and empty["month_totals"] == {}
    assert client.post("/api/expenses", headers=david, json={"category": "ads", "title": "Meta", "amount": 50}).status_code == 403
    client.post("/api/expenses", headers=owner, json={"category": "ads", "title": "Meta Ads", "amount": 50, "currency": "eur"})
    assert client.get("/api/expenses", headers=owner).json()["month_totals"] == {"ads": {"EUR": 50.0}}

    found = client.get("/api/search?q=pricing", headers=owner).json()
    assert {"type": "memory", "title": "Pricing multiplier", "detail": "Memória", "href": "#/memoria"} in found
    assert any(r["type"] == "task" for r in client.get("/api/search?q=update prices", headers=owner).json())
    assert client.get("/api/search?q=a", headers=owner).json() == []


def test_a_question_goes_to_the_askers_own_agent(client):
    owner = login(client, "owner")
    david = login(client, "david")
    # no agent: no answer, and no pretending
    refused = client.post("/api/ai/ask", headers=david, json={"question": "What is everyone working on?"}).json()
    assert (refused["status"], refused["error"], refused["answer"]) == ("ERROR", "agent_offline", "")

    david_agent = agent(client, "david", owner)
    client.post("/api/agent/heartbeat", headers=david_agent, json={"status": "IDLE"})
    asked = client.post("/api/ai/ask", headers=david, json={"question": "What needs my attention?"}).json()
    assert asked["status"] == "PENDING"
    commands = client.post("/api/agent/heartbeat", headers=david_agent, json={"status": "IDLE"}).json()["commands"]
    assert {"type": "ask", "request_id": asked["id"]} in commands

    taken = client.get(f"/api/agent/ai/{asked['id']}", headers=david_agent).json()
    assert taken["question"] == "What needs my attention?" and "team" in taken["context"] and "tasks" in taken["context"]
    assert client.get(f"/api/agent/ai/{asked['id']}", headers=david_agent).status_code == 409  # taken once
    mark_agent = agent(client, "mark", owner)
    assert client.post(f"/api/agent/ai/{asked['id']}/result", headers=mark_agent, json={"answer": "x"}).status_code == 404
    client.post(f"/api/agent/ai/{asked['id']}/result", headers=david_agent, json={"answer": "Nothing is waiting for you."})
    answered = client.get(f"/api/ai/requests/{asked['id']}", headers=david).json()
    assert (answered["status"], answered["answer"]) == ("DONE", "Nothing is waiting for you.")
    assert client.get(f"/api/ai/requests/{asked['id']}", headers=owner).status_code == 404


def test_notifications_are_deleted_one_by_one_the_read_ones_or_all_and_only_ones_own(client):
    from app.db import SessionLocal
    from app.models import User
    from sqlalchemy import select

    async def make():
        async with SessionLocal() as db:
            users = {u.username: u.id for u in (await db.execute(select(User))).scalars()}
            for i in range(4):
                await services.notify(db, [users["mark"]], "task_new", "info", f"Tarefa {i}")
            await services.notify(db, [users["david"]], "task_new", "info", "Do David")
    asyncio.run(make())
    mark, david = login(client, "mark"), login(client, "david")
    client.post("/api/notifications/delete", headers=mark, json={"all": True})   # start from a clean inbox
    asyncio.run(make())
    items = client.get("/api/notifications", headers=mark).json()["items"]
    assert len(items) == 4
    davids = client.get("/api/notifications", headers=david).json()["items"][0]["id"]
    assert client.post("/api/notifications/delete", headers=mark, json={"ids": [items[0]["id"], davids]}).json()["deleted"] == 1
    assert client.get("/api/notifications", headers=david).json()["items"][0]["id"] == davids        # not his to delete
    client.post("/api/notifications/read", headers=mark, json={"ids": [items[1]["id"]]})
    assert client.post("/api/notifications/delete", headers=mark, json={"read": True}).json()["deleted"] == 1
    assert client.post("/api/notifications/delete", headers=mark, json={}).json()["deleted"] == 0   # nothing chosen: nothing goes
    assert client.post("/api/notifications/delete", headers=mark, json={"all": True}).json()["deleted"] == 2
    assert client.get("/api/notifications", headers=mark).json()["items"] == []
    assert client.post("/api/notifications/delete", json={"all": True}).status_code == 401


def test_the_hub_pages_are_always_revalidated(client):
    assert client.get("/").headers.get("cache-control") == "no-cache"
    assert "cache-control" not in {k.lower() for k in client.get("/api/version").headers}


def test_the_version_changes_when_the_page_changes_even_before_a_commit(client, tmp_path, monkeypatch):
    """The phone app reloads when /api/version changes: a new commit or a new index.html (every frontend change bumps its ?v=)."""
    from app import selfupdate
    page = tmp_path / "index.html"
    page.write_text("v1")
    monkeypatch.setattr(selfupdate.settings, "frontend_dir", str(tmp_path))
    selfupdate.CACHE.clear()
    first = client.get("/api/version").json()["head"]
    import os, time
    os.utime(page, (time.time() + 5, time.time() + 5))
    selfupdate.CACHE.clear()
    assert client.get("/api/version").json()["head"] != first
