"""One memory on the person's own computers (4 Nov): the Claude conversations of the Mac reach the cloud's agents
(recall_share.py), a task's briefing says what the person did in their own Claude windows, and a new window hears what
was done elsewhere (/api/local/news)."""
import asyncio
import json
import os
import tempfile
from pathlib import Path

os.environ.setdefault("DATABASE_URL", f"sqlite+aiosqlite:///{tempfile.mkdtemp()}/test.db")
os.environ.setdefault("REDIS_URL", "")

import httpx
import pytest
from fastapi.testclient import TestClient

from app import recall_share
from app.config import settings
from app.main import app
from app.routers import office

MAC = "100.101.102.103"


@pytest.fixture(scope="module")
def client():
    old = settings.ip_users
    settings.ip_users = "127.0.0.1=owner"   # the hooks post from this computer (owner here: test_week wants david untouched)
    with TestClient(app, client=("127.0.0.1", 50000)) as c:
        yield c
    settings.ip_users = old


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(recall_share, "STORE", tmp_path / "recall-peers")
    monkeypatch.setattr(settings, "team_key", "segredo")
    return tmp_path / "recall-peers"


def login(client, username):
    r = client.post("/api/auth/login", json={"username": username, "password": f"{username}-change-me"})
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['token']}"}


def transcript(folder: Path, session: str, lines: list[dict]) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    f = folder / f"{session}.jsonl"
    f.write_text("\n".join(json.dumps(x, separators=(",", ":"), ensure_ascii=False) for x in lines), encoding="utf-8")  # as Claude Code writes it
    return f


SAID = [
    {"type": "user", "timestamp": "2026-11-03T10:00:00Z", "message": {"content": "Faz o site da escola como o do Gato Preto"}},
    {"type": "assistant", "timestamp": "2026-11-03T10:01:00Z",
     "message": {"content": [{"type": "text", "text": "Fiz: preto e âmbar, o gato no topo."}, {"type": "tool_use", "name": "Edit"}]}},
    {"type": "user", "timestamp": "2026-11-03T10:01:05Z", "message": {"content": [{"type": "tool_result", "content": "ok"}]}},
    {"type": "user", "isMeta": True, "message": {"content": "<command-name>/clear</command-name>"}},
]


def test_a_conversation_goes_as_what_was_said_only(tmp_path):
    f = transcript(tmp_path / "-Users-david-Documents-escola", "abc", SAID)
    assert recall_share.digest(f) == [["2026-11-03 10:00", "pessoa", "Faz o site da escola como o do Gato Preto"],
                                      ["2026-11-03 10:01", "claude", "Fiz: preto e âmbar, o gato no topo."]]


def test_only_what_changed_goes_and_only_once(tmp_path):
    root = tmp_path / "projects"
    transcript(root / "-Users-david-escola", "abc", SAID)
    transcript(root / "-Users-david-vazio", "only-tools", [SAID[2]])
    sent: dict = {}
    first = recall_share.batch(sent, root)
    assert [f["session"] for f in first] == ["abc"]
    assert "-Users-david-vazio/only-tools" in sent   # nothing said: marked without going
    sent.update({f"{f['folder']}/{f['session']}": [f["mtime"], f["size"]] for f in first})
    assert recall_share.batch(sent, root) == []
    transcript(root / "-Users-david-escola", "abc", SAID + [{"type": "user", "message": {"content": "E agora o logótipo"}}])
    assert [f["session"] for f in recall_share.batch(sent, root)] == ["abc"]


def test_only_peers_on_the_persons_own_tailnet():
    assert recall_share.own("100.88.1.2:8000") and recall_share.own("[fd7a:115c:a1e0::5]:8000")
    assert not recall_share.own("26.68.80.191:8000")   # Radmin: the partners' PCs
    assert not recall_share.own("https://amg-nuvem.tailcdbdef.ts.net:8443")   # the Funnel: the internet
    assert not recall_share.own("127.0.0.1:8001")


def test_the_cloud_keeps_what_the_mac_sends(store):
    body = {"computer": "MacBook-Air-de-David", "system": "mac",
            "files": [{"folder": "-Users-david-escola", "session": "abc", "mtime": 1, "size": 2,
                       "items": [["2026-11-03 10:00", "pessoa", "Faz o site da escola"]]}]}
    with TestClient(app, client=(MAC, 50000)) as mac:
        assert mac.post("/api/sync/recall", json=body).status_code == 403   # without the team key
        r = mac.post("/api/sync/recall", json=body, headers={"X-Team-Key": "segredo"})
        assert r.status_code == 200 and r.json()["kept"] == 1
        # through the Funnel (the internet), even with the key and a tailnet address: no
        assert mac.post("/api/sync/recall", json=body, headers={"X-Team-Key": "segredo", "Tailscale-Funnel-Request": "?1"}).status_code == 403
    kept = json.loads((store / "MacBook-Air-de-David" / "Users-david-escola__abc.json").read_text(encoding="utf-8"))
    assert kept["items"] == [["2026-11-03 10:00", "pessoa", "Faz o site da escola"]] and kept["folder"] == "-Users-david-escola"
    assert json.loads((store / "MacBook-Air-de-David" / "_computer.json").read_text())["system"] == "mac"


def test_a_partner_with_the_key_but_off_the_tailnet_cannot_write_it(store):
    body = {"computer": "../../etc", "files": [{"folder": "x", "session": "y", "items": [["", "pessoa", "olá"]]}]}
    with TestClient(app, client=("26.244.76.112", 50000)) as marco:   # Marco's PC on Radmin
        assert marco.post("/api/sync/recall", json=body, headers={"X-Team-Key": "segredo"}).status_code == 403
    assert not store.exists()


def test_a_bad_computer_name_stays_inside_the_store(store):
    body = {"computer": "../../etc", "files": [{"folder": "../x", "session": "../../y", "items": [["", "pessoa", "olá"]]}]}
    with TestClient(app, client=(MAC, 50000)) as mac:
        assert mac.post("/api/sync/recall", json=body, headers={"X-Team-Key": "segredo"}).json()["kept"] == 1
    files = [p for p in store.rglob("*") if p.is_file()]
    assert files and all(store in p.parents for p in files)


def test_the_mac_sends_to_its_cloud_and_remembers_it(tmp_path, monkeypatch):
    root = tmp_path / "projects"
    transcript(root / "-Users-david-escola", "abc", SAID)
    monkeypatch.setattr(settings, "team_key", "segredo")
    got = []

    def cloud(request: httpx.Request):
        got.append((str(request.url), request.headers.get("x-team-key"), json.loads(request.content)))
        return httpx.Response(200, json={"ok": True, "kept": 1})

    async def go():
        async with httpx.AsyncClient(transport=httpx.MockTransport(cloud)) as c:
            state: dict = {}
            first = await recall_share.send(c, "100.88.1.2:8000", state, root)
            again = await recall_share.send(c, "100.88.1.2:8000", state, root)
            return first, again

    assert asyncio.run(go()) == (1, 0)
    url, key, body = got[0]
    assert url == "http://100.88.1.2:8000/api/sync/recall" and key == "segredo" and len(got) == 1
    assert body["files"][0]["items"][0][2] == "Faz o site da escola como o do Gato Preto"


def test_the_briefing_has_what_the_person_did_in_their_own_claude_windows(client):
    office._last_write.clear()
    david = login(client, "owner")
    step = {"session_id": "mac-1", "cwd": "/Users/david/Documents/escola-site"}
    client.post("/api/local/claude", json={"hook_event_name": "UserPromptSubmit", "prompt": "Site da escola de condução com a qualidade do Gato Preto", **step})
    client.post("/api/local/claude", json={"hook_event_name": "Stop", "last_assistant_message": "Feito: hero preto e âmbar.", **step})
    bot_token = client.post("/api/users/owner/agent-token", headers=david).json()["agent_token"]
    task = client.post("/api/tasks", headers=david, json={"title": "Continua o site da escola", "assignee": "owner"}).json()
    brief = client.get(f"/api/agent/tasks/{task['id']}/briefing", headers={"Authorization": f"Bearer {bot_token}"}).json()
    window = next(c for c in brief["claude"] if "Gato Preto" in c["asked"])
    assert window["project"] == "escola-site"


def test_a_new_window_hears_what_was_done_elsewhere(client):
    david = login(client, "owner")
    task = client.post("/api/tasks", headers=david, json={"title": "Logótipo da escola", "assignee": "owner"}).json()
    r = client.patch(f"/api/tasks/{task['id']}", headers=david, json={"status": "COMPLETED"})
    assert r.status_code == 200, r.text
    r = client.post("/api/memory", headers=login(client, "owner"), json={"scope": "team", "category": "REGRAS", "title": "Qualidade", "content": "Como o Gato Preto"})
    assert r.status_code == 200, r.text
    news = client.get("/api/local/news").json()
    assert any(t["title"] == "Logótipo da escola" and t["status"] == "COMPLETED" for t in news["tasks"])
    assert any(n["title"] == "Qualidade" for n in news["notes"])
    with TestClient(app, client=("8.8.8.8", 50000)) as outside:
        assert outside.get("/api/local/news").status_code == 403
