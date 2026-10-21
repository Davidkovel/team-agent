"""Uso de IA, Análise and the timelines (21 Oct): the Claude Code windows of the Escritório count as the team's Claude use, and
the comings and goings (entrou no Hub, ficou online, saiu) come apart from the work in the timeline."""
import json
import os
import tempfile

os.environ.setdefault("DATABASE_URL", f"sqlite+aiosqlite:///{tempfile.mkdtemp()}/test.db")
os.environ.setdefault("REDIS_URL", "")

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.routers import office


@pytest.fixture(scope="module")
def client():
    old = settings.ip_users
    settings.ip_users = "127.0.0.1=mark"   # the hooks post from this computer, which belongs to Mark here
    with TestClient(app, client=("127.0.0.1", 50000)) as c:
        yield c
    settings.ip_users = old


@pytest.fixture(autouse=True)
def no_throttle():
    office._last_write.clear()
    yield


def login(client, username):
    r = client.post("/api/auth/login", json={"username": username, "password": f"{username}-change-me"})
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['token']}"}


def step(client, event, session, **fields):
    r = client.post("/api/local/claude", json={"hook_event_name": event, "session_id": session, "cwd": "C:\\Users\\marco\\Desktop\\team-agent", **fields})
    assert r.status_code == 200, r.text


def test_the_claude_code_windows_are_the_teams_claude_use(client, tmp_path):
    owner = login(client, "owner")
    folder = tmp_path / ".claude" / "projects" / "x"
    folder.mkdir(parents=True)
    transcript = folder / "u1.jsonl"
    transcript.write_text(json.dumps({"type": "assistant", "message": {"id": "m1", "model": "claude-opus-5-5",
                                                                       "usage": {"input_tokens": 1000, "output_tokens": 500}}}) + "\n", encoding="utf-8")
    step(client, "UserPromptSubmit", "u1", prompt="Arruma a página de uso de IA. Depois vê o resto.")
    step(client, "Stop", "u1", transcript_path=str(transcript))

    c = client.get("/api/analytics/claude", headers=owner).json()
    assert c["days"] == 7 and len(c["dates"]) == 7 and c["windows"]["source"] == "live"
    mark = next(p for p in c["people"] if p["user"] == "mark")
    assert mark["windows"] >= 1 and mark["tokens"] >= 1500 and mark["today"] >= 1500
    assert mark["by_day"][c["dates"][-1]] >= 1500 and "claude-opus-5-5" in mark["models"]
    assert any(w["topic"] == "Arruma a página de uso de IA" and w["tokens"] == 1500 for w in c["top"])
    # no cost is made up for the windows: they run on the plan; only the agent's runs have an (estimated) cost
    assert c["agent"]["cost_source"] in ("estimated", "no_data") and "cost_usd" not in c["windows"]
    assert client.get("/api/analytics/claude?days=30", headers=owner).json()["days"] == 7   # the Escritório keeps a week

    people = client.get("/api/analytics?days=30", headers=owner).json()["people"]
    assert people["claude_days"] == 7
    assert next(p for p in people["list"] if p["user"] == "mark")["claude_tokens"] >= 1500


def test_the_timeline_keeps_the_comings_and_goings_apart(client):
    owner = login(client, "owner")   # signing in writes «entrou no Hub»
    r = client.put("/api/meters/higgsfield", headers=owner, json={"pct": 40})   # a line of work: «atualizou o consumo»
    assert r.status_code == 200, r.text
    feed = client.get("/api/analytics/feed", headers=owner).json()
    assert feed["items"] and not any(a["kind"] in ("login", "hub_online", "hub_offline", "agent_online", "agent_offline") for a in feed["items"])
    assert any(a["kind"] == "login" and a["message"].endswith("entrou no Hub") for a in feed["presence"])
    first = client.get("/api/analytics/feed?limit=1", headers=owner).json()
    assert len(first["items"]) == 1
    if first["more"]:   # the next page starts after the oldest one shown
        older = client.get(f"/api/analytics/feed?limit=1&before={first['items'][0]['id']}", headers=owner).json()
        assert older["items"] and older["items"][0]["id"] < first["items"][0]["id"]
