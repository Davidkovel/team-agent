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


def test_the_clock_stops_and_starts_again_and_keeps_what_was_worked(client):
    owner = headers(client, "owner")
    assert client.post("/api/ponto/stop", headers=owner).json()["at"] is None   # nothing to stop before clocking in
    first = client.post("/api/ponto", headers=owner).json()
    assert first["running"] is True and first["since"] == first["at"] and first["worked_s"] == 0

    stopped = client.post("/api/ponto/stop", headers=owner).json()
    assert stopped["running"] is False and stopped["since"] is None and stopped["worked_s"] >= 0 and stopped["at"] == first["at"]
    assert client.post("/api/ponto/stop", headers=owner).json() == stopped   # stopping twice changes nothing

    again = client.post("/api/ponto", headers=owner).json()
    assert again["running"] is True and again["since"] and again["at"] == first["at"] and again["worked_s"] == stopped["worked_s"]
    mine = next(p for p in client.get("/api/ponto", headers=owner).json()["people"] if p["user"] == "owner")
    assert mine == {k: again[k] for k in mine}
    team = {p["user"]: p for p in client.get("/api/local/team").json()}
    assert team["owner"]["ponto_state"]["running"] is True and team["owner"]["ponto"] == first["at"]


def test_widget_reads_the_last_commits_with_who_sent_them(client, monkeypatch):
    from app import commits
    monkeypatch.setattr(commits, "recent", lambda limit=40: [{"sha": "abc1234", "author": "Marco Goucha", "message": "Página nova", "date": "2026-10-06T10:00:00+00:00", "repo": "Agente AMG"},
                                                              {"sha": "def5678", "author": "Alguém de fora", "message": "Outra", "date": "2026-10-06T09:00:00+00:00"}])
    got = client.get("/api/local/commits").json()
    assert [(c["sha"], c["name"], c["message"]) for c in got] == [("abc1234", got[0]["name"], "Página nova"), ("def5678", "Alguém de fora", "Outra")]
    assert got[1]["user"] is None   # not one of the team: shown by the name git has
