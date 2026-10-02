import os
import tempfile

os.environ.setdefault("DATABASE_URL", f"sqlite+aiosqlite:///{tempfile.mkdtemp()}/test.db")
os.environ.setdefault("REDIS_URL", "")

import pytest
from fastapi.testclient import TestClient

from app.main import app

WIDGET = {"X-Team-Widget": "1"}


@pytest.fixture(scope="module")
def client():
    # Requests look like they come from this computer, which is what /api/local/* requires.
    with TestClient(app, client=("127.0.0.1", 50000)) as c:
        yield c


def headers(client, username):
    r = client.post("/api/auth/login", json={"username": username, "password": f"{username}-change-me"})
    return {"Authorization": f"Bearer {r.json()['token']}"}


def at_of(board, username):
    return next(p for p in board["people"] if p["user"] == username)["at"]


def test_clock_in_once_a_day_and_everyone_sees_it(client):
    mark, owner = headers(client, "mark"), headers(client, "owner")
    assert at_of(client.get("/api/ponto", headers=owner).json(), "mark") is None

    first = client.post("/api/ponto", headers=mark).json()
    assert first["user"] == "mark" and first["at"].endswith("+00:00")  # with its zone, so every browser shows the right hour
    again = client.post("/api/ponto", headers=mark).json()
    assert again["at"] == first["at"]  # tapping again changes nothing

    board = client.get("/api/ponto", headers=owner).json()
    assert at_of(board, "mark") == first["at"] and at_of(board, "owner") is None
    assert "bateu o ponto" in [a["message"].split(" ", 1)[1] for a in client.get("/api/history?limit=50", headers=owner).json()]


def test_widget_clocks_in_and_team_list_carries_it(client):
    assert client.post("/api/local/ponto", json={"user": "David"}).status_code == 403  # web pages cannot
    r = client.post("/api/local/ponto", json={"user": "David"}, headers=WIDGET)
    assert r.status_code == 200 and r.json()["user"] == "david"
    team = {p["user"]: p for p in client.get("/api/local/team").json()}
    assert team["david"]["ponto"] == r.json()["at"]
    assert client.post("/api/local/ponto", json={"user": "ninguem"}, headers=WIDGET).status_code == 404
