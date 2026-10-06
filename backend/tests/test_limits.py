import asyncio
import os
import tempfile
import time

os.environ.setdefault("DATABASE_URL", f"sqlite+aiosqlite:///{tempfile.mkdtemp()}/test.db")
os.environ.setdefault("REDIS_URL", "")

import pytest
from fastapi.testclient import TestClient

from app import limits, sync
from app.db import SessionLocal
from app.main import app


@pytest.fixture(scope="module")
def client():
    with TestClient(app, client=("127.0.0.1", 50000)) as c:
        yield c


def headers(client, username):
    r = client.post("/api/auth/login", json={"username": username, "password": f"{username}-change-me"})
    return {"Authorization": f"Bearer {r.json()['token']}"}


def publish(data):
    async def go():
        async with SessionLocal() as db:
            return await limits.publish(db, data)
    return asyncio.run(go())


def test_each_computer_writes_its_persons_windows_and_the_team_reads_them(client, monkeypatch):
    monkeypatch.setattr(sync, "whoami", lambda: (1, "mark"))
    soon, later = time.time() + 3600, time.time() + 5 * 86400
    assert publish({"five": 41.6, "five_reset": soon, "week": 17, "week_reset": later}) is True
    assert publish({"five": 41.6, "five_reset": soon + 30, "week": 17, "week_reset": later}) is False   # a wobble of seconds is not news

    team = client.get("/api/limits/team", headers=headers(client, "owner")).json()
    assert team["mark"]["five"] == 42 and team["mark"]["week"] == 17
    assert abs(team["mark"]["five_reset"] - soon) < 1 and team["mark"]["seen"]
    assert "david" not in team   # his computer has not written anything
    assert client.get("/api/limits/team").status_code == 401

    assert publish({"five": None, "five_reset": None, "week": 18, "week_reset": later}) is True   # the session ended
    assert client.get("/api/limits/team", headers=headers(client, "david")).json()["mark"]["five"] == 0


def test_a_window_past_its_reset_counts_as_new(client, monkeypatch):
    monkeypatch.setattr(sync, "whoami", lambda: (2, "david"))
    assert publish({"five": 90, "five_reset": time.time() - 60, "week": 55, "week_reset": time.time() + 86400}) is True
    mine = client.get("/api/limits/team", headers=headers(client, "david")).json()["david"]
    assert mine["five"] == 0 and mine["five_reset"] is None and mine["week"] == 55


def test_check_now_reads_again_here_and_asks_the_others(client, monkeypatch):
    monkeypatch.setattr(sync, "whoami", lambda: (0, "owner"))
    monkeypatch.setattr(sync, "peers", lambda: [])
    monkeypatch.setattr(limits, "refresh_account", lambda: True)
    monkeypatch.setattr(limits, "plan", lambda: {"five": 12, "five_reset": time.time() + 600, "week": 30, "week_reset": time.time() + 86400})
    assert client.post("/api/limits/refresh").status_code == 401
    r = client.post("/api/limits/refresh", headers=headers(client, "owner")).json()
    assert r == {"fresh": True, "wrote": True, "peers": {}}
    assert client.get("/api/limits/team", headers=headers(client, "owner")).json()["owner"]["five"] == 12
