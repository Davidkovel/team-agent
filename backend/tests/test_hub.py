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
    (root / "notas").mkdir()
    (root / "notas" / "nota.md").write_text("# nota", encoding="utf-8")
    (root / "secret.txt").write_text("outside", encoding="utf-8")
    (root / "sources.json").write_text(json.dumps({"proj": str(project), "notas": str(root / "notas")}), encoding="utf-8")
    company = root / "companies" / "acme"
    company.mkdir(parents=True)
    (company / "company.json").write_text(json.dumps({"name": "Acme", "sections": [
        {"id": "skills", "label": "Skills", "kind": "cards", "editable": True,
         "sources": [{"source": "proj", "path": "skills", "cards": "skills"}]},
        {"id": "videos", "label": "Videos", "kind": "videos", "sources": [{"source": "proj", "path": "videos"}]},
        {"id": "docs", "label": "Docs", "kind": "files", "sources": [{"source": "notas", "path": ""}]},
        {"id": "plugins", "label": "Plugins", "kind": "static", "file": "plugins.json"},
    ]}), encoding="utf-8")
    (company / "plugins.json").write_text(json.dumps([{"name": "Figma", "description": "d"}, {"name": "Shopify", "description": "d"}]),
                                          encoding="utf-8")
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
    assert companies[0]["name"] == "Acme" and {s["id"]: s["count"] for s in companies[0]["sections"]} == {"skills": 1, "videos": 1, "docs": 1, "plugins": 2}
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
    # where / how much: the files of the commit, grouped by top-level folder
    assert feed[0]["stats"]["files"] == 2 and feed[0]["stats"]["added"] >= 1
    assert {a["name"] for a in feed[0]["areas"]} == {"skills", "videos"}
    assert any(f["path"] == "skills/boa/SKILL.md" for f in feed[0]["files"])
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


def test_gallery_rename_move_trash_restore_and_stay_inside(client, library):
    _, owner = login(client, "owner")
    base = library / "project" / "videos"
    (base / "a.mp4").write_bytes(b"1")
    url = "/api/hub/acme/videos"

    def op(action, **body):
        return client.post(f"{url}/item/{action}", headers=owner, json=body)

    try:
        assert op("rename", id="0:a.mp4", name="b.mp4").json()["id"] == "0:b.mp4" and (base / "b.mp4").exists()
        assert op("rename", id="0:b.mp4", name="b.exe").status_code == 400          # keeps its extension
        assert op("rename", id="0:b.mp4", name="../x.mp4").status_code == 400       # no paths in names
        assert op("rename", id="0:b.mp4", name="ad.mp4").status_code == 400         # never overwrites
        moved = op("move", id="0:b.mp4", folder="Verao/2026").json()["id"]
        assert moved == "0:Verao/2026/b.mp4" and (base / "Verao" / "2026" / "b.mp4").exists()
        for bad in ("../..", "..", ".lixo", "a/../../x"):
            assert op("move", id=moved, folder=bad).status_code == 400
        trashed = op("trash", id=moved).json()["id"]
        assert (base / ".lixo" / "Verao" / "2026" / "b.mp4").exists() and not (base / "Verao" / "2026" / "b.mp4").exists()
        assert "b.mp4" not in [i["name"] for i in client.get(url, headers=owner).json()["items"]]
        assert [i["id"] for i in client.get(f"{url}/trash", headers=owner).json()["items"]] == [trashed]
        assert op("restore", id=trashed).status_code == 200 and (base / "Verao" / "2026" / "b.mp4").exists()
        assert op("restore", id="0:ad.mp4").status_code == 400                      # not in the trash
        assert client.get(url, headers=owner).json()["manage"] is True
        messages = " ".join(a["message"] for a in client.get("/api/history", headers=owner).json())
        assert "mandou para o lixo" in messages and "restaurou do lixo" in messages and "renomeou" in messages
    finally:
        for f in (base / "a.mp4", base / "b.mp4", base / "Verao" / "2026" / "b.mp4", base / ".lixo" / "Verao" / "2026" / "b.mp4"):
            f.unlink(missing_ok=True)


def test_library_actions_need_login(client, library):
    assert client.post("/api/hub/acme/videos/item/trash", json={"id": "0:ad.mp4"}).status_code == 401
    assert (library / "project" / "videos" / "ad.mp4").exists()


def test_trash_and_restore_in_every_section_but_delete_for_good_only_media(client, library, tmp_path, monkeypatch):
    from app import hub
    monkeypatch.setattr(hub, "TRASH_DIR", tmp_path / "lixo")
    _, owner = login(client, "owner")

    def op(section, action, **body):
        return client.post(f"/api/hub/acme/{section}/item/{action}", headers=owner, json=body)

    def names(section, trash=False):
        r = client.get(f"/api/hub/acme/{section}" + ("/trash" if trash else ""), headers=owner).json()
        return [i["name"] for i in r["items"]]

    skill = library / "project" / "skills" / "boa"
    gone = op("skills", "trash", id="0:boa/SKILL.md").json()["id"]
    assert not skill.exists() and names("skills") == [] and names("skills", True) == ["boa"]
    assert not (library / "project" / "skills" / ".lixo").exists()          # the trash lives outside the folder
    assert op("skills", "purge", id=gone).status_code == 400                 # skills are only restored
    assert op("skills", "restore", id=gone).status_code == 200 and (skill / "SKILL.md").exists()

    gone = op("docs", "trash", id="0:nota.md").json()["id"]
    assert names("docs") == [] and names("docs", True) == ["nota.md"]
    assert client.post("/api/hub/acme/docs/trash/empty", headers=owner).status_code == 403
    assert op("docs", "restore", id=gone).status_code == 200 and names("docs") == ["nota.md"]

    assert op("plugins", "trash", id="s:Figma").status_code == 200
    assert names("plugins") == ["Shopify"] and names("plugins", True) == ["Figma"]
    assert op("plugins", "trash", id="s:Nada").status_code == 400
    assert op("plugins", "restore", id="s:Figma").status_code == 200 and names("plugins") == ["Figma", "Shopify"]

    clip = library / "project" / "videos" / "lixo-teste.mp4"
    clip.write_bytes(b"1")
    gone = op("videos", "trash", id="0:lixo-teste.mp4").json()["id"]
    assert op("videos", "purge", id="0:ad.mp4").status_code == 400          # only from the trash
    assert op("videos", "purge", id=gone).status_code == 200 and not (library / "project" / "videos" / ".lixo" / "lixo-teste.mp4").exists()
    clip.write_bytes(b"1")
    op("videos", "trash", id="0:lixo-teste.mp4")
    assert client.post("/api/hub/acme/videos/trash/empty", headers=owner).json()["deleted"] == 1
    assert names("videos", True) == [] and (library / "project" / "videos" / "ad.mp4").exists()
