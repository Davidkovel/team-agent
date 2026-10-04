import asyncio
import os
import tempfile
import time

os.environ.setdefault("DATABASE_URL", f"sqlite+aiosqlite:///{tempfile.mkdtemp()}/test.db")
os.environ.setdefault("REDIS_URL", "")

import pytest
from fastapi.testclient import TestClient

from app import services
from app.main import app
from app.realtime import rt


@pytest.fixture(scope="module")
def client():
    # Requests look like they come from this computer, which is what /api/local/* requires.
    with TestClient(app, client=("127.0.0.1", 50000)) as c:
        yield c


def login(client, username):
    r = client.post("/api/auth/login", json={"username": username, "password": f"{username}-change-me"})
    assert r.status_code == 200
    return r.json()["token"], {"Authorization": f"Bearer {r.json()['token']}"}


def status_of(client, headers, username):
    return next(m for m in client.get("/api/team", headers=headers).json() if m["user"] == username)["status"]


def messages(client, headers):
    return [a["message"] for a in client.get("/api/history?limit=200", headers=headers).json()]


def wait_for(check, timeout=10):
    end = time.time() + timeout
    while time.time() < end:
        if check():
            return True
        time.sleep(0.2)
    return check()


def test_open_hub_means_online_and_closing_it_means_offline(client):
    _, owner = login(client, "owner")
    dtok, _ = login(client, "david")
    assert status_of(client, owner, "david") == "OFFLINE"
    with client.websocket_connect(f"/ws?token={dtok}"):
        assert wait_for(lambda: status_of(client, owner, "david") == "ONLINE")  # no agent needed
        assert wait_for(lambda: "David ficou online" in messages(client, owner))  # written down by the watcher
    assert wait_for(lambda: status_of(client, owner, "david") == "OFFLINE")
    assert wait_for(lambda: "David saiu" in messages(client, owner))


def test_two_windows_stay_online_until_the_last_one_closes(client):
    otok, owner = login(client, "owner")
    with client.websocket_connect(f"/ws?token={otok}"):
        with client.websocket_connect(f"/ws?token={otok}"):
            assert wait_for(lambda: status_of(client, owner, "owner") == "ONLINE")
        time.sleep(0.5)
        assert status_of(client, owner, "owner") == "ONLINE"  # one window is still open
    assert wait_for(lambda: status_of(client, owner, "owner") == "OFFLINE")


def test_the_agents_own_status_wins_over_an_open_hub(client):
    _, owner = login(client, "owner")
    dtok, david = login(client, "david")
    agent_token = client.post("/api/users/david/agent-token", headers=david).json()["agent_token"]
    agent = {"Authorization": f"Bearer {agent_token}"}
    with client.websocket_connect(f"/ws?token={dtok}"):
        assert wait_for(lambda: status_of(client, owner, "david") == "ONLINE")
        client.post("/api/agent/heartbeat", headers=agent, json={"status": "WORKING", "task": "Anúncios", "progress": 40})
        client.post("/api/agent/heartbeat", headers=agent, json={"status": "WORKING", "task": "Anúncios", "progress": 41})
        assert status_of(client, owner, "david") == "WORKING"
        time.sleep(0.5)
        assert status_of(client, owner, "david") == "WORKING"  # pings from the Hub do not overwrite it
    time.sleep(0.5)
    assert status_of(client, owner, "david") == "WORKING"  # closing the Hub must not drop a live agent
    assert any("David ligou o agente" in m for m in messages(client, owner))


def test_widget_ping_marks_online_and_is_local_and_header_protected(client):
    _, owner = login(client, "owner")
    assert client.post("/api/local/presence", json={"user": "owner"}).status_code == 403  # no widget header: a web page
    assert client.post("/api/local/presence", json={"user": "nobody"}, headers={"X-Team-Widget": "1"}).status_code == 404
    ok = client.post("/api/local/presence", json={"user": "Owner"}, headers={"X-Team-Widget": "1"})
    assert ok.status_code == 200 and ok.json()["name"] == "Owner"  # the name people see works as well as the login
    try:
        assert status_of(client, owner, "owner") == "ONLINE"
        team = {m["user"]: m for m in client.get("/api/local/team").json()}
        assert team["owner"]["online"] and team["owner"]["via"] == "widget" and team["mark"]["name"] == "Mark"
    finally:
        services.WIDGET_SEEN.clear()
        asyncio.run(rt.store.clear_presence(1))
    stranger = TestClient(app, client=("203.0.113.9", 5000))  # not this computer; no lifespan needed for a 403
    assert stranger.get("/api/local/team").status_code == 403
    assert stranger.post("/api/local/presence", json={"user": "owner"}, headers={"X-Team-Widget": "1"}).status_code == 403


def test_widget_on_a_trusted_network_counts_as_local(client, monkeypatch):
    from app.config import settings
    vpn = TestClient(app, client=("26.10.20.30", 5000))  # a teammate's widget over the VPN
    monkeypatch.setattr(settings, "widget_networks", "")  # whatever this machine's .env says
    assert vpn.get("/api/local/team").status_code == 403
    monkeypatch.setattr(settings, "widget_networks", "26.0.0.0/8, 10.8.0.0/24")
    try:
        assert vpn.post("/api/local/presence", json={"user": "mark"}, headers={"X-Team-Widget": "1"}).status_code == 200
        assert {m["user"]: m for m in vpn.get("/api/local/team").json()}["mark"]["online"]
        assert vpn.get("/api/local/week").status_code == 200
        assert TestClient(app, client=("203.0.113.9", 5000)).get("/api/local/team").status_code == 403
    finally:
        services.WIDGET_SEEN.clear()
        asyncio.run(rt.store.clear_presence(2))


def test_history_is_in_portuguese_and_names_who_did_it(client):
    _, owner = login(client, "owner")
    tid = client.post("/api/tasks", headers=owner, json={"title": "Reels de Natal", "assignee": "mark"}).json()["id"]
    client.post(f"/api/tasks/{tid}/control", headers=owner, json={"action": "pause"})
    feed = client.get("/api/history?limit=200", headers=owner).json()
    line = next(a for a in feed if a["message"].endswith("pausar a tarefa: Reels de Natal"))
    assert line["name"] == "Owner" and line["message"].startswith("Owner pediu para")  # logged under who asked, not the assignee


def test_team_mode_shows_the_real_names_and_everybody_is_owner(client, monkeypatch):
    from app import main
    from app.config import settings
    from app.db import SessionLocal
    from app.models import User
    from sqlalchemy import select

    async def restore():  # the rest of the suite runs in the strict mode, with the seeded names
        async with SessionLocal() as db:
            seeded = {"owner": ("Owner", "owner"), "mark": ("Mark", "member"), "david": ("David", "member")}
            for u in (await db.execute(select(User))).scalars():
                if u.username in seeded:  # other test files add users of their own; leave those alone
                    u.display_name, u.role = seeded[u.username]
            await db.commit()

    _, owner = login(client, "owner")
    monkeypatch.setattr(settings, "team_mode", True)
    try:
        client.portal.call(main.sync_team_names)
        names = {m["user"]: m["display_name"] for m in client.get("/api/team", headers=owner).json()}  # other test files add users too
        assert (names["owner"], names["mark"], names["david"]) == ("Kovel", "Marco", "David")
        assert client.get("/api/me", headers=login(client, "mark")[1]).json()["role"] == "owner"
    finally:
        client.portal.call(restore)


def test_other_computer_needs_the_team_key_to_show_online(client, monkeypatch):
    from app.config import settings
    stranger = TestClient(app, client=("26.1.2.3", 5000))  # e.g. a Radmin address
    ping = {"X-Team-Widget": "1"}
    monkeypatch.setattr(settings, "team_key", "")
    assert stranger.get("/api/local/team", headers={"X-Team-Key": ""}).status_code == 403  # no key set on the host: stays local-only
    monkeypatch.setattr(settings, "team_key", "segredo")
    assert stranger.get("/api/local/team", headers={"X-Team-Key": "errado"}).status_code == 403
    assert stranger.post("/api/local/presence", json={"user": "owner"}, headers={**ping, "X-Team-Key": "errado"}).status_code == 403
    assert stranger.get("/api/local/week", headers={"X-Team-Key": "errado"}).status_code == 403
    assert stranger.post("/api/local/session", json={"user": "mark"}, headers={**ping, "X-Team-Key": "errado"}).status_code == 403
    try:
        with stranger:
            # a Hub that is not on anybody's PC: the key alone gives the widget the ledger and a signed-in session
            assert stranger.get("/api/local/week", headers={"X-Team-Key": "segredo"}).status_code == 200
            assert stranger.post("/api/local/session", json={"user": "mark"}, headers={"X-Team-Key": "segredo"}).status_code == 403
            token = stranger.post("/api/local/session", json={"user": "mark"}, headers={**ping, "X-Team-Key": "segredo"}).json()["token"]
            assert stranger.get("/api/me", headers={"Authorization": f"Bearer {token}"}).json()["username"] == "mark"
            ok = stranger.post("/api/local/presence", json={"user": "mark"}, headers={**ping, "X-Team-Key": "segredo"})
            assert ok.status_code == 200
            team = {m["user"]: m for m in stranger.get("/api/local/team", headers={"X-Team-Key": "segredo"}).json()}
            assert team["mark"]["online"]
    finally:
        services.WIDGET_SEEN.clear()
        asyncio.run(rt.store.clear_presence(2))
