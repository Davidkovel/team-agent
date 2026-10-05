import base64
import os
import tempfile
import time

os.environ.setdefault("DATABASE_URL", f"sqlite+aiosqlite:///{tempfile.mkdtemp()}/test.db")
os.environ.setdefault("REDIS_URL", "")

import pytest
import requests
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient

from app import webpush as wp
from app.config import settings
from app.main import app


@pytest.fixture(scope="module")
def client():
    with TestClient(app, client=("127.0.0.1", 50000)) as c:
        yield c


@pytest.fixture(autouse=True)
def own_folder(monkeypatch, tmp_path):
    """Keys and subscriptions of a test never touch the real ones."""
    monkeypatch.setattr(settings, "webpush_dir", str(tmp_path))


def login(client, username):
    r = client.post("/api/auth/login", json={"username": username, "password": f"{username}-change-me"})
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['token']}"}


def b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def phone_subscription(endpoint="https://push.example.test/abc"):
    """What a browser hands over when it subscribes: its own public key and a secret."""
    key = ec.generate_private_key(ec.SECP256R1()).public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    return {"endpoint": endpoint, "keys": {"p256dh": b64(key), "auth": b64(os.urandom(16))}}


def test_a_phone_subscribes_and_the_hub_hands_out_its_key(client):
    mark = login(client, "mark")
    first = client.get("/api/webpush/key", headers=mark).json()
    assert first["available"] and len(first["key"]) == 87 and first["subscribed"] == 0  # 65 bytes of public key, as base64url
    assert client.get("/api/webpush/key", headers=mark).json()["key"] == first["key"]  # kept in a file: the same every time
    sub = phone_subscription()
    assert client.post("/api/webpush/subscribe", headers=mark, json=sub).json() == {"subscribed": 1}
    assert client.post("/api/webpush/subscribe", headers=mark, json=sub).json() == {"subscribed": 1}  # the same phone twice is one phone
    assert client.post("/api/webpush/subscribe", headers=mark, json={**sub, "endpoint": "http://insecure.test/x"}).status_code == 422
    assert client.post("/api/webpush/subscribe", headers=mark, json={"endpoint": sub["endpoint"], "keys": {}}).status_code == 422
    assert client.delete("/api/webpush/subscribe", headers=mark).json() == {"subscribed": 0}
    assert client.post("/api/webpush/test", headers=mark).status_code == 409  # nothing subscribed, nothing to test


def test_a_push_is_signed_and_encrypted_for_that_phone(monkeypatch):
    calls = []

    class Push:  # stands in for Apple's or Google's server
        def post(self, url, data=None, headers=None, timeout=None):
            calls.append((url, {k.lower(): v for k, v in headers.items()}, data))
            reply = requests.Response()
            reply.status_code = 201
            return reply

    real = wp.webpush
    monkeypatch.setattr(wp, "webpush", lambda **kw: real(**kw, requests_session=Push()))
    assert wp._send_one(phone_subscription(), wp._payload("Owner deu-te uma tarefa: Natal", "Para hoje", "#/tarefas/7")) == "ok"
    (url, headers, data), = calls
    assert url == "https://push.example.test/abc"
    assert headers["authorization"].startswith("vapid ") and headers["content-encoding"] == "aes128gcm"  # the Hub proves who it is
    assert isinstance(data, bytes) and b"Natal" not in data  # what goes out is encrypted: only that phone can read it


def test_a_task_reaches_the_phone_subscribed_here_and_a_phone_that_is_gone_is_forgotten(client, monkeypatch):
    sent = []

    def fake(sub, payload):
        sent.append((sub["endpoint"], payload["title"], payload["url"]))
        return "gone" if sub["endpoint"].endswith("/gone") else "ok"

    monkeypatch.setattr(wp, "_send_one", fake)
    wp.add("mark", phone_subscription("https://push.example.test/ok"))
    wp.add("mark", phone_subscription("https://push.example.test/gone"))
    owner = login(client, "owner")
    r = client.post("/api/tasks", headers=owner, json={"title": "Anúncios de Natal", "assignee": "mark", "for_ai": False})
    assert r.status_code == 200
    end = time.time() + 5
    while len(sent) < 2 and time.time() < end:  # it goes out behind the request
        time.sleep(0.05)
    assert sorted(e for e, _, _ in sent) == ["https://push.example.test/gone", "https://push.example.test/ok"]
    assert {t for _, t, _ in sent} == {"Owner deu-te uma tarefa: Anúncios de Natal"}
    assert all(u.startswith("./#/tarefas/") for _, _, u in sent)  # a tap opens that task
    time.sleep(0.3)
    assert [s["endpoint"] for s in wp.subscriptions("mark")] == ["https://push.example.test/ok"]  # the gone one is forgotten
    assert wp.subscriptions("david") == []  # nobody else's phone is involved
