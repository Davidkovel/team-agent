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


def test_auto_login_by_ip(client, monkeypatch):
    monkeypatch.setattr(settings, "ip_users", "testclient=david")  # the TestClient's address
    res = client.post("/api/auth/auto")
    assert res.status_code == 200 and res.json()["user"]["username"] == "david"
    assert client.get("/api/me", headers={"Authorization": f"Bearer {res.json()['token']}"}).json()["username"] == "david"


def test_team_ips_sign_in_without_ip_users():
    from app.routers.auth import ip_map
    m = ip_map()
    assert m["26.245.177.206"] == "david" and m["26.244.76.112"] == "mark" and m["26.68.80.191"] == "owner"


def test_ip_users_overrides_a_team_ip(monkeypatch):
    from app.routers.auth import ip_map
    monkeypatch.setattr(settings, "ip_users", "26.245.177.206=mark")
    assert ip_map()["26.245.177.206"] == "mark"


def test_unknown_ip_gets_its_address_back(client, monkeypatch):
    monkeypatch.setattr(settings, "ip_users", "10.0.0.9=mark")
    res = client.post("/api/auth/auto")
    assert res.status_code == 404 and res.json()["detail"]["ip"] == "testclient"
