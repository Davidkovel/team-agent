"""Fotos da Ten Fold (30 Oct): the team's photo library in albums. The list never carries the pictures; renaming an
album moves every photo in it; what is not a picture is refused."""
import os
import tempfile

os.environ.setdefault("DATABASE_URL", f"sqlite+aiosqlite:///{tempfile.mkdtemp()}/test.db")
os.environ.setdefault("REDIS_URL", "")

import pytest
from fastapi.testclient import TestClient

from app.main import app

PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="


@pytest.fixture(scope="module")
def client():
    with TestClient(app, client=("127.0.0.1", 50000)) as c:
        yield c


def login(client, username):
    r = client.post("/api/auth/login", json={"username": username, "password": f"{username}-change-me"})
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_photos_go_into_albums_and_open_one_by_one(client):
    owner, mark = login(client, "owner"), login(client, "mark")
    a = client.post("/api/photos", headers=owner, json={"image": PIXEL, "thumb": PIXEL, "album": "  Sessão   Gato Preto ", "title": "Logo"})
    b = client.post("/api/photos", headers=mark, json={"image": PIXEL, "thumb": PIXEL})
    assert a.status_code == 200 and a.json()["album"] == "Sessão Gato Preto" and b.json()["album"] == "Geral"
    lib = client.get("/api/photos", headers=mark).json()
    assert {x["name"] for x in lib["albums"]} >= {"Sessão Gato Preto", "Geral"} and "base64" not in str(lib)
    mine = {x["id"]: x["mine"] for x in lib["items"]}
    assert mine[b.json()["id"]] is True and mine[a.json()["id"]] is False
    token = mark["Authorization"].split()[1]
    got = client.get(f"/api/photos/{a.json()['id']}/img?token={token}&size=thumb")
    assert got.status_code == 200 and got.content[:4] == b"\x89PNG"
    assert client.get(f"/api/photos/{a.json()['id']}/img?token=nope").status_code == 401
    # an album renamed takes its photos along; a photo moves on its own; deleted is gone
    assert client.post("/api/photos/album", headers=mark, json={"name": "Sessão Gato Preto", "to": "Gato Preto"}).json()["moved"] == 1
    assert client.patch(f"/api/photos/{b.json()['id']}", headers=mark, json={"album": "Gato Preto", "title": "Montra"}).json()["album"] == "Gato Preto"
    lib = client.get("/api/photos", headers=mark).json()
    assert [x for x in lib["albums"] if x["name"] == "Gato Preto"][0]["count"] == 2
    assert client.delete(f"/api/photos/{b.json()['id']}", headers=owner).status_code == 200
    assert client.get(f"/api/photos/{b.json()['id']}/img?token={token}").status_code == 404
    assert client.post("/api/photos", headers=owner, json={"image": "data:text/html;base64,PGI+", "thumb": PIXEL}).status_code == 400
