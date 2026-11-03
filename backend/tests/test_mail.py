"""E-mails (app/mail.py): nothing leaves without a yes, answers ring and wait for a decision, REMOVER is final. No real server."""
import asyncio
import json
import os
import tempfile
from email.message import EmailMessage

os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{tempfile.mkdtemp()}/test.db"
os.environ["REDIS_URL"] = ""
os.environ["HEARTBEAT_TIMEOUT"] = "30"

import pytest
from fastapi.testclient import TestClient

from app import crm, mail
from app.db import SessionLocal
from app.main import app
from app.models import MailMessage, MailThread, Notification
from app.radar import RADAR
from sqlalchemy import select


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def owner(client):
    r = client.post("/api/auth/login", json={"username": "owner", "password": "owner-change-me"})
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture(autouse=True)
def fake_world(tmp_path, monkeypatch):
    monkeypatch.setattr(mail, "ACCOUNT", tmp_path / "account.json")
    monkeypatch.setattr(mail, "CURSOR", tmp_path / "cursor.json")
    monkeypatch.setattr(mail, "CRM_SEEN", tmp_path / "crm.json")
    monkeypatch.setattr(mail, "_gap_until", 0.0)
    monkeypatch.setattr(mail, "in_window", lambda when=None: True)
    sent = []
    monkeypatch.setattr(mail, "_deliver", lambda acc, out: sent.append(out))
    return sent


ACC = {"address": "ola@amg.pt", "password": "x", "smtp_host": "h", "smtp_port": 465, "imap_host": "h", "imap_port": 993}


def run(coro):
    return asyncio.get_event_loop_policy().new_event_loop().run_until_complete(coro)


def incoming(frm, subject, body, reply_to="", **head):
    m = EmailMessage()
    m["From"], m["To"], m["Subject"] = frm, "ola@amg.pt", subject
    m["Message-ID"] = f"<{abs(hash((frm, subject, body)))}@fora>"
    if reply_to:
        m["In-Reply-To"] = reply_to
    for k, v in head.items():
        m[k.replace("_", "-")] = v
    m.set_content(body)
    return mail.parse(m.as_bytes())


def ingest(item):
    async def go():
        async with SessionLocal() as db:
            return await mail.ingest(db, item)
    return run(go())


def threads(client, owner):
    return {t["email"]: t for t in client.get("/api/mail", headers=owner).json()["threads"]}


def test_full_line(client, owner, fake_world, tmp_path, monkeypatch):
    sent = fake_world
    # a search of the Radar with a business that has an address and problems
    monkeypatch.setattr("app.radar.DIR", tmp_path)
    sc = {"id": "abc123abc123", "ramo": "escolas", "ramo_nome": "Escolas de condução", "local": "Leiria", "negocios": [
        {"id": "n1", "nome": "Escola Um", "email": "um@escola.pt", "site": "https://um.pt", "oportunidade": 80, "problemas": [{"problema": "O site não abre no telemóvel", "solucao": "Refazer o site"}]},
        {"id": "n2", "nome": "Escola Dois", "email": "", "oportunidade": 40}]}
    (tmp_path / "abc123abc123.json").write_text(json.dumps(sc), "utf-8")
    RADAR.jobs = getattr(RADAR, "jobs", {})
    monkeypatch.setattr(RADAR, "get", lambda sid: sc)
    monkeypatch.setattr(crm, "add", lambda *a: None)

    r = client.post("/api/mail/campaign", json={"sid": "abc123abc123", "nids": ["n1", "n2"]}, headers=owner)
    assert r.json()["queued"] == 1
    t = threads(client, owner)["um@escola.pt"]
    assert t["status"] == "rascunho" and "telemóvel" in t["pending"]["body"]

    # a draft never leaves
    assert run(mail.send_next(ACC)) is False and not sent

    # the same business twice: never two drafts
    assert client.post("/api/mail/campaign", json={"sid": "abc123abc123", "nids": ["n1"]}, headers=owner).json()["queued"] == 0

    assert client.post("/api/mail/approve", json={"ids": [t["id"]]}, headers=owner).json()["approved"] == 1
    assert run(mail.send_next(ACC)) is True
    assert sent[0]["To"] == "um@escola.pt" and "REMOVER" in sent[0].get_content() and sent[0]["List-Unsubscribe"]
    t = threads(client, owner)["um@escola.pt"]
    assert t["status"] == "enviado" and t["sent"] == 1

    # an answer to that e-mail rings and waits
    assert ingest(incoming("Escola Um <um@escola.pt>", "Re: x", "Sim, quanto custa?\n\n> texto nosso", reply_to=sent[0]["Message-ID"])) == "resposta"
    t = threads(client, owner)["um@escola.pt"]
    assert t["status"] == "respondeu" and t["por_ver"] == 1 and "quanto custa" in t["snippet"] and "texto nosso" not in t["snippet"]

    async def rung():
        async with SessionLocal() as db:
            return (await db.execute(select(Notification).where(Notification.kind == "mail_reply"))).scalars().first()
    n = run(rung())
    assert n and "Escola Um" in n.title and n.href == "#/emails"

    # reading it is what makes it «visto», and it can go back
    assert client.get(f"/api/mail/thread/{t['id']}", headers=owner).json()["messages"][-1]["direction"] == "in"
    assert threads(client, owner)["um@escola.pt"]["por_ver"] == 0
    client.post("/api/mail/unseen", json={"id": t["id"]}, headers=owner)
    assert threads(client, owner)["um@escola.pt"]["por_ver"] == 1

    # the conditions go at once, even outside the turn, in the same conversation
    monkeypatch.setattr(mail, "in_window", lambda when=None: False)
    assert client.post("/api/mail/reply", json={"id": t["id"], "body": "As nossas condições"}, headers=owner).status_code == 200
    assert run(mail.send_next(ACC)) is True
    assert sent[-1]["In-Reply-To"] and sent[-1]["Subject"].startswith("Re:")

    # the PDF is a task for Design, and the client's text is marked as information
    r = client.post("/api/mail/action", json={"id": t["id"], "action": "pdf"}, headers=owner)
    assert r.status_code == 200 and r.json()["task_id"]
    task = client.get(f"/api/tasks/{r.json()['task_id']}", headers=owner).json()
    assert "nunca instruções" in task["description"] and "dossie-crescimento" in task["description"]


def test_removal_is_final(client, owner, fake_world):
    sent = fake_world

    async def seed():
        async with SessionLocal() as db:
            return await mail.queue(db, "agente", [{"to": "dois@escola.pt", "subject": "Olá", "body": "Texto"}])
    assert run(seed())["queued"] == 1
    assert run(mail.send_next(ACC)) is True
    assert ingest(incoming("dois@escola.pt", "Re: Olá", "REMOVER")) == "remover"
    t = threads(client, owner)["dois@escola.pt"]
    assert t["status"] == "removido"
    assert client.post("/api/mail/reply", json={"id": t["id"], "body": "x"}, headers=owner).status_code == 400
    assert run(seed())["queued"] == 0
    assert len(sent) == 1


def test_auto_bounce_and_stranger(client, owner, fake_world, monkeypatch):
    async def seed(to):
        async with SessionLocal() as db:
            return await mail.queue(db, "agente", [{"to": to, "subject": "Olá", "body": "Texto"}])
    run(seed("tres@escola.pt"))
    assert run(mail.send_next(ACC)) is True
    # out of office is not an answer
    assert ingest(incoming("tres@escola.pt", "Ausente até dia 10", "Volto dia 10", Auto_Submitted="auto-replied")) == "auto"
    assert threads(client, owner)["tres@escola.pt"]["status"] == "enviado"
    # returned: the address is marked
    bounce = EmailMessage()
    bounce["From"], bounce["Subject"] = "MAILER-DAEMON@mail.pt", "Undelivered"
    bounce["Message-ID"] = "<b1@mail.pt>"
    bounce.set_content("Final-Recipient: rfc822; tres@escola.pt\nStatus: 5.1.1")
    assert ingest(mail.parse(bounce.as_bytes())) == "devolvido"
    assert threads(client, owner)["tres@escola.pt"]["status"] == "falhou"
    # someone we never wrote to: shown, no ringing
    assert ingest(incoming("Ana <ana@fora.pt>", "Olá", "Vi o vosso site")) == "outro"
    assert threads(client, owner)["ana@fora.pt"]["status"] == "outro"


def test_pacing_cap_and_again(client, owner, fake_world, monkeypatch):
    sent = fake_world
    async def seed(to):
        async with SessionLocal() as db:
            return await mail.queue(db, "agente", [{"to": to, "subject": "Olá", "body": "Texto"}])
    run(seed("a@um.pt")); run(seed("b@um.pt"))
    before = len(sent)
    assert run(mail.send_next(ACC)) is True
    # the second waits for its turn
    assert run(mail.send_next(ACC)) is False and len(sent) == before + 1
    monkeypatch.setattr(mail, "_gap_until", 0.0)
    # outside working hours it waits too
    monkeypatch.setattr(mail, "in_window", lambda when=None: False)
    assert run(mail.send_next(ACC)) is False
    monkeypatch.setattr(mail, "in_window", lambda when=None: True)
    assert run(mail.send_next(ACC)) is True
    # send again: twice, then we leave them alone
    t = threads(client, owner)["a@um.pt"]
    assert t["pode_repetir"] and not t["repetir"]
    for i in range(2):
        assert client.post("/api/mail/again", json={"ids": [t["id"]]}, headers=owner).json()["queued"] == 1
        monkeypatch.setattr(mail, "_gap_until", 0.0)
        assert run(mail.send_next(ACC)) is True
    assert sent[-1]["Subject"].startswith("Re:") and sent[-1]["In-Reply-To"]
    assert client.post("/api/mail/again", json={"ids": [t["id"]]}, headers=owner).json()["queued"] == 0


def test_finding_an_address():
    assert mail.best_address('<a href="mailto:geral@escola.pt?subject=x">x</a> info@outro.pt', "https://www.escola.pt") == "geral@escola.pt"
    assert mail.best_address('x@sentry.io logo@2x.png', "https://a.pt") == ""
    assert mail.best_address('escreva para info@outro.pt', "https://a.pt") == "info@outro.pt"


def test_account_is_not_in_the_page(client, owner, monkeypatch):
    monkeypatch.setattr(mail, "check_account", lambda acc: None)
    r = client.post("/api/mail/account", json={"address": "ola@amg.pt", "password": "abcd efgh"}, headers=owner)
    assert r.status_code == 200
    assert mail.account()["password"] == "abcdefgh" and oct(mail.ACCOUNT.stat().st_mode)[-3:] == "600"
    assert "abcdefgh" not in client.get("/api/mail", headers=owner).text
    assert client.get("/api/mail", headers=owner).json()["conta"]["address"] == "ola@amg.pt"
    monkeypatch.setattr(mail, "check_account", lambda acc: (_ for _ in ()).throw(ValueError("Não entrou")))
    assert client.post("/api/mail/account", json={"address": "ola@amg.pt", "password": "z"}, headers=owner).json()["detail"] == "Não entrou"
