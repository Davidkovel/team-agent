"""Afiliados (3 Nov): programmes with their link and commission, and what each gave, written by hand."""
import os
import tempfile

os.environ.setdefault("DATABASE_URL", f"sqlite+aiosqlite:///{tempfile.mkdtemp()}/test.db")
os.environ.setdefault("REDIS_URL", "")

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture(scope="module")
def client():
    with TestClient(app, client=("127.0.0.1", 50000)) as c:
        yield c


def login(client, username):
    r = client.post("/api/auth/login", json={"username": username, "password": f"{username}-change-me"})
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_programme_results_and_totals(client):
    h = login(client, "mark")
    assert client.post("/api/afiliados/programas", headers=h, json={"name": "X", "link": "javascript:alert(1)"}).status_code == 400
    assert client.post("/api/afiliados/programas", headers=h, json={"name": "X", "kind": "nope"}).status_code == 400
    r = client.post("/api/afiliados/programas", headers=h, json={"name": "FundedNext", "niche": "Trading", "kind": "pct",
                                                                   "commission": 12, "cookie_days": 90, "link": "https://fundednext.com/?ref=x"})
    pid = r.json()["id"]
    assert client.post("/api/afiliados/resultados", headers=h, json={"program_id": pid}).status_code == 400
    assert client.post("/api/afiliados/resultados", headers=h, json={"program_id": pid, "day": "2026-11-01", "clicks": 40, "sales": 1, "earned": 12.5}).status_code == 200
    assert client.post("/api/afiliados/resultados", headers=h, json={"program_id": pid, "clicks": 10}).status_code == 200
    data = client.get("/api/afiliados", headers=h).json()
    p = next(x for x in data["programs"] if x["id"] == pid)
    assert (p["clicks"], p["sales"], p["earned"], p["days"]) == (50, 1, 12.5, 2)
    assert client.patch(f"/api/afiliados/programas/{pid}", headers=h, json={"status": "ativo"}).status_code == 200
    assert client.delete(f"/api/afiliados/programas/{pid}", headers=h).status_code == 200
    data = client.get("/api/afiliados", headers=h).json()
    assert not any(x["id"] == pid for x in data["programs"]) and not any(r["program_id"] == pid for r in data["results"])
