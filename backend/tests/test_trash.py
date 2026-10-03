import asyncio
import os
import tempfile
from datetime import datetime, timedelta, timezone

os.environ.setdefault("DATABASE_URL", f"sqlite+aiosqlite:///{tempfile.mkdtemp()}/test.db")
os.environ.setdefault("REDIS_URL", "")

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


def new_task(client, headers, assignee="mark", **extra):
    r = client.post("/api/tasks", headers=headers, json={"title": "Lixo", "assignee": assignee, **extra})
    assert r.status_code == 200
    return r.json()["id"]


def board_ids(client, headers):
    return [t["id"] for t in client.get("/api/tasks", headers=headers).json()]


def trash_ids(client, headers):
    return [t["id"] for t in client.get("/api/tasks/trash", headers=headers).json()]


def age_in_trash(task_id, hours):
    """Pretends the task went into the bin `hours` ago."""
    from app.db import SessionLocal
    from app.models import Task

    async def run():
        async with SessionLocal() as db:
            task = await db.get(Task, task_id)
            task.trashed_at = datetime.now(timezone.utc) - timedelta(hours=hours)
            await db.commit()
    asyncio.run(run())


def test_done_leaves_the_board_but_stays_completed_and_in_the_list(client):
    owner = login(client, "owner")
    tid = new_task(client, owner, for_ai=False)
    r = client.post(f"/api/tasks/{tid}/trash", headers=owner, json={"reason": "done"})
    assert r.status_code == 200
    assert r.json()["status"] == "COMPLETED" and r.json()["trash_reason"] == "done" and r.json()["trashed_at"]
    # a finished task still counts as finished (the board hides it by trashed_at), a mistake never happened
    assert tid in board_ids(client, owner)
    listed = next(t for t in client.get("/api/tasks/trash", headers=owner).json() if t["id"] == tid)
    assert listed["trash_reason"] == "done" and listed["purge_at"] > listed["trashed_at"]


def test_mistake_disappears_everywhere_except_the_list(client):
    owner = login(client, "owner")
    mark = login(client, "mark")
    agent = {"Authorization": "Bearer " + client.post("/api/users/mark/agent-token", headers=mark).json()["agent_token"]}
    open_before = next(p for p in client.get("/api/week", headers=owner).json()["people"] if p["user"] == "mark")["tasks_open"]
    tid = new_task(client, owner, for_ai=True)  # waiting for mark's agent
    assert tid in [t["id"] for t in client.get("/api/agent/tasks/next", headers=agent).json()]

    assert client.post(f"/api/tasks/{tid}/trash", headers=owner, json={"reason": "mistake"}).status_code == 200

    assert tid not in board_ids(client, owner)
    assert tid in trash_ids(client, owner)
    assert tid not in [t["id"] for t in client.get("/api/agent/tasks/next", headers=agent).json()]
    after = next(p for p in client.get("/api/week", headers=owner).json()["people"] if p["user"] == "mark")["tasks_open"]
    assert after == open_before


def test_done_tells_whoever_asked_for_the_task(client):
    owner, mark = login(client, "owner"), login(client, "mark")
    tid = new_task(client, owner, for_ai=False)
    client.post(f"/api/tasks/{tid}/trash", headers=mark, json={"reason": "done"})
    titles = [n["title"] for n in client.get("/api/notifications", headers=owner).json()["items"]]
    assert any(t.endswith("concluiu: Lixo") for t in titles)


def test_restore_puts_the_task_back_where_it_was(client):
    owner = login(client, "owner")
    tid = new_task(client, owner, for_ai=False)
    client.patch(f"/api/tasks/{tid}", headers=owner, json={"status": "REVIEW"})
    client.post(f"/api/tasks/{tid}/trash", headers=owner, json={"reason": "done"})
    back = client.post(f"/api/tasks/{tid}/restore", headers=owner)
    assert back.status_code == 200
    assert back.json()["status"] == "REVIEW" and back.json()["completed_at"] is None and back.json()["trashed_at"] is None
    assert tid not in trash_ids(client, owner)
    assert client.post(f"/api/tasks/{tid}/restore", headers=owner).status_code == 409  # not in the bin any more


def test_the_agent_working_on_a_task_blocks_the_bin(client):
    owner, mark = login(client, "owner"), login(client, "mark")
    agent = {"Authorization": "Bearer " + client.post("/api/users/mark/agent-token", headers=mark).json()["agent_token"]}
    tid = new_task(client, owner, for_ai=True)
    client.post(f"/api/agent/tasks/{tid}/update", headers=agent, json={"status": "IN_PROGRESS", "progress": 10})
    assert client.post(f"/api/tasks/{tid}/trash", headers=owner, json={"reason": "mistake"}).status_code == 409
    assert tid in board_ids(client, owner)


def test_only_your_own_tasks_and_only_known_reasons(client):
    owner, mark = login(client, "owner"), login(client, "mark")
    tid = new_task(client, owner, assignee="david", for_ai=False)
    assert client.post(f"/api/tasks/{tid}/trash", headers=mark, json={"reason": "done"}).status_code == 403
    assert client.post(f"/api/tasks/{tid}/trash", headers=owner, json={"reason": "whatever"}).status_code == 422
    # as a mistake: the test files share one database, and a finished task of david's would count in the week test
    assert client.post(f"/api/tasks/{tid}/trash", headers=owner, json={"reason": "mistake"}).status_code == 200
    assert client.post(f"/api/tasks/{tid}/trash", headers=owner, json={"reason": "mistake"}).status_code == 409  # already there


def test_seven_hours_later_the_task_is_really_gone(client):
    owner = login(client, "owner")
    old, recent, board = (new_task(client, owner, for_ai=False) for _ in range(3))
    for tid in (old, recent):
        client.post(f"/api/tasks/{tid}/trash", headers=owner, json={"reason": "mistake"})
    age_in_trash(old, 7.5)
    age_in_trash(recent, 6)

    listed = trash_ids(client, owner)  # reading the list is what cleans it
    assert old not in listed and recent in listed
    assert client.get(f"/api/tasks/{old}", headers=owner).status_code == 404
    assert client.get(f"/api/tasks/{recent}", headers=owner).status_code == 200
    assert board in board_ids(client, owner)


def test_empty_it_now_deletes_only_what_is_in_the_bin(client):
    owner = login(client, "owner")
    tid, kept = new_task(client, owner, for_ai=False), new_task(client, owner, for_ai=False)
    assert client.delete(f"/api/tasks/{kept}/trash", headers=owner).status_code == 409  # not in the bin: never deleted from here
    client.post(f"/api/tasks/{tid}/trash", headers=owner, json={"reason": "mistake"})
    assert client.delete(f"/api/tasks/{tid}/trash", headers=owner).status_code == 200
    assert client.get(f"/api/tasks/{tid}", headers=owner).status_code == 404
    assert client.get(f"/api/tasks/{kept}", headers=owner).status_code == 200
