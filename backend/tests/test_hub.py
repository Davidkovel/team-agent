import json
import os
import tempfile

os.environ.setdefault("DATABASE_URL", f"sqlite+aiosqlite:///{tempfile.mkdtemp()}/test.db")
os.environ.setdefault("REDIS_URL", "")

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="module")
def library(tmp_path_factory):
    root = tmp_path_factory.mktemp("lib")
    project = root / "project"
    (project / "skills" / "boa").mkdir(parents=True)
    (project / "skills" / "boa" / "SKILL.md").write_text("---\nname: boa\ndescription: Sync to GitHub\n---\nbody", encoding="utf-8")
    (project / "videos").mkdir()
    (project / "videos" / "ad.mp4").write_bytes(b"0" * 2048)
    (root / "secret.txt").write_text("outside", encoding="utf-8")
    (root / "sources.json").write_text(json.dumps({"proj": str(project)}), encoding="utf-8")
    company = root / "companies" / "acme"
    company.mkdir(parents=True)
    (company / "company.json").write_text(json.dumps({"name": "Acme", "sections": [
        {"id": "skills", "label": "Skills", "kind": "cards", "editable": True,
         "sources": [{"source": "proj", "path": "skills", "cards": "skills"}]},
        {"id": "videos", "label": "Videos", "kind": "videos", "sources": [{"source": "proj", "path": "videos"}]},
    ]}), encoding="utf-8")
    old = settings.library_dir
    settings.library_dir = str(root)
    yield root
    settings.library_dir = old


def login(client, username):
    r = client.post("/api/auth/login", json={"username": username, "password": f"{username}-change-me"})
    assert r.status_code == 200
    return r.json()["token"], {"Authorization": f"Bearer {r.json()['token']}"}


def test_companies_and_cards(client, library):
    _, owner = login(client, "owner")
    companies = client.get("/api/hub/companies", headers=owner).json()
    assert companies[0]["name"] == "Acme" and {s["id"]: s["count"] for s in companies[0]["sections"]} == {"skills": 1, "videos": 1}
    card = client.get("/api/hub/acme/skills", headers=owner).json()["items"][0]
    assert card["name"] == "boa" and card["description"] == "Sync to GitHub"


def test_requires_login(client, library):
    assert client.get("/api/hub/companies").status_code == 401
    assert client.get("/api/hub/acme/videos/media", params={"id": "0:ad.mp4", "token": "bad"}).status_code == 401


def test_path_traversal_blocked(client, library):
    _, owner = login(client, "owner")
    for bad in ("0:../secret.txt", "0:../../secret.txt", "9:x", "nonsense"):
        assert client.get("/api/hub/acme/skills/file", params={"id": bad}, headers=owner).status_code == 404
    assert client.get("/api/hub/acme/nope", headers=owner).status_code == 404


def test_edit_only_where_allowed_and_logged(client, library):
    token, mark = login(client, "mark")
    card = client.get("/api/hub/acme/skills", headers=mark).json()["items"][0]
    assert client.put("/api/hub/acme/skills/file", params={"id": card["id"]}, json={"content": "new"}, headers=mark).status_code == 200
    assert client.get("/api/hub/acme/skills/file", params={"id": card["id"]}, headers=mark).json()["content"] == "new"
    video = client.get("/api/hub/acme/videos", headers=mark).json()["items"][0]
    assert client.put("/api/hub/acme/videos/file", params={"id": video["id"]}, json={"content": "x"}, headers=mark).status_code == 403
    history = client.get("/api/history", headers=_owner(client)).json()
    assert any("Mark" in h["message"] and "SKILL.md" in h["message"] for h in history)


def _owner(client):
    return login(client, "owner")[1]


def test_media_streams_with_range(client, library):
    token, _ = login(client, "mark")
    r = client.get("/api/hub/acme/videos/media", params={"id": "0:ad.mp4", "token": token}, headers={"Range": "bytes=0-9"})
    assert r.status_code == 206 and len(r.content) == 10


def test_history_visible_to_everyone(client, library):
    _, david = login(client, "david")
    assert any(h["kind"] == "login" for h in client.get("/api/history", headers=david).json())


def test_week_percentage_and_higgsfield_meter(client, library):
    _, david = login(client, "david")
    raw = client.post("/api/users/david/agent-token", headers=david).json()["agent_token"]
    agent = {"Authorization": f"Bearer {raw}"}
    assert client.post("/api/agent/usage", json={"cost_usd": 5.0}, headers=agent).status_code == 200
    me = next(m for m in client.get("/api/team", headers=david).json() if m["user"] == "david")
    assert me["week_cost_usd"] == 5.0 and me["week_pct"] == round(5 / settings.weekly_budget_usd * 100)
    assert me["higgsfield_pct"] is None

    assert client.put("/api/meters/higgsfield", json={"pct": 42}, headers=david).status_code == 200
    assert client.put("/api/meters/higgsfield", json={"pct": 101}, headers=david).status_code == 422
    assert client.put("/api/meters/other", json={"pct": 1}, headers=david).status_code == 404
    _, mark = login(client, "mark")
    seen = next(m for m in client.get("/api/team", headers=mark).json() if m["user"] == "david")
    assert seen["higgsfield_pct"] == 42  # the whole team sees everyone's meters


def test_commit_feed_falls_back_to_local_git(client, library, monkeypatch):
    import subprocess
    from app import commits

    repo = library / "project"
    git = ["git", "-C", str(repo), "-c", "user.name=Marco", "-c", "user.email=m@x.io"]
    subprocess.run(["git", "-C", str(repo), "init", "-q"], check=True)
    subprocess.run([*git, "add", "-A"], check=True)
    subprocess.run([*git, "commit", "-q", "-m", "Primeiro commit\n\ncorpo"], check=True)
    (library / "repos.json").write_text(json.dumps([{"name": "Proj", "github": "acme/proj", "source": "proj"}]), encoding="utf-8")

    def offline(repo, limit):
        raise OSError("no network")

    monkeypatch.setattr(commits, "_github", offline)
    commits._cache.clear()
    _, mark = login(client, "mark")
    feed = client.get("/api/commits", headers=mark).json()
    assert feed[0]["repo"] == "Proj" and feed[0]["author"] == "Marco" and feed[0]["message"] == "Primeiro commit"
    assert feed[0]["via"] == "local" and feed[0]["url"].startswith("https://github.com/acme/proj/commit/")
    assert client.get("/api/commits").status_code == 401


def test_only_owner_creates_users(client, library):
    _, mark = login(client, "mark")
    body = {"username": "ana", "display_name": "Ana", "password": "longenough1"}
    assert client.post("/api/users", json=body, headers=mark).status_code == 403
    owner = _owner(client)
    assert client.post("/api/users", json=body, headers=owner).status_code == 200
    assert client.post("/api/users", json=body, headers=owner).status_code == 409
    assert client.post("/api/users", json={**body, "username": "bob", "password": "short"}, headers=owner).status_code == 422
    r = client.post("/api/auth/login", json={"username": "ana", "password": "longenough1"})
    assert r.status_code == 200
