"""The mirror between a computer and its cloud: a real round over the real routes, on two temporary folders."""
import asyncio
import functools
import os
import subprocess
import time

import httpx
import pytest
from fastapi import FastAPI

from app import espelho as e
from app.config import settings

PEER = "100.64.0.2:8000"


def runs(test):
    @functools.wraps(test)
    def inner(*args, **kwargs):
        return asyncio.run(test(*args, **kwargs))
    return inner


@pytest.fixture
def world(tmp_path, monkeypatch):
    here, cloud = tmp_path / "Desktop", tmp_path / "trabalho"
    here.mkdir()
    cloud.mkdir()
    monkeypatch.setattr(e, "TRABALHO", cloud)
    monkeypatch.setattr(e, "HASHES", tmp_path / "h.json")
    monkeypatch.setattr(e, "STATE", tmp_path / "s.json")
    monkeypatch.setattr(e, "TRASH", tmp_path / "lixo")
    monkeypatch.setattr(e.sys, "platform", "linux")
    monkeypatch.setattr(settings, "team_key", "k")
    monkeypatch.setattr(e, "roots", lambda: [{"name": "Secretária", "path": here}])
    return here, cloud / "Secretária", tmp_path


def client(host="100.64.0.1"):
    app = FastAPI()
    app.include_router(e.router)
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app, client=(host, 1)), timeout=20)


async def round_():
    async with client() as c:
        return (await e.round_once(c, PEER))["Secretária"]


def later(path, text):
    path.write_text(text)
    future = time.time_ns() + 5_000_000_000
    os.utime(path, ns=(future, future))


def test_plan_every_case():
    both = {"a": "1"}
    assert e.plan({"a": "1"}, {"a": "1"}, both) == []
    assert e.plan({"a": "2"}, {"a": "1"}, both) == [("up", "a")]
    assert e.plan({"a": "1"}, {"a": "2"}, both) == [("down", "a")]
    assert e.plan({"a": "2"}, {"a": "3"}, both) == [("conflict", "a")]
    assert e.plan({}, {"a": "1"}, both) == [("del_remote", "a")]
    assert e.plan({"a": "1"}, {}, both) == [("del_local", "a")]
    assert e.plan({}, {"a": "2"}, both) == [("down", "a")]  # changed beats deleted
    assert e.plan({"a": "2"}, {}, both) == [("up", "a")]
    assert e.plan({"a": "2"}, {"a": "3"}, None) == [("conflict", "a")]  # the first time merges
    assert e.plan({"a": "2"}, {"a": "3", "b": "1"}, None, seed=True) == [("up", "a"), ("del_remote", "b")]
    assert e.plan({}, {"a": "1"}, both, skipped=["a"]) == []  # unreadable or too big is not deleted


def test_junk_and_secrets_stay_home():
    for name in [".env", "x/.env.local", "a/.git/config", "node_modules/x.js", "c/.DS_Store", "chave.pem", ".espelho-tmp-1"]:
        assert e.junk(name), name
    for name in ["proposta.pdf", "dist/site.html", "Logótipos/a b.png"]:
        assert not e.junk(name), name


def test_an_unreadable_folder_is_a_failure_not_an_empty_one(tmp_path, monkeypatch):
    def refuse(*a, **k):
        raise e.ScanFailed("PermissionError")
    monkeypatch.setattr(e, "_walk_files", refuse)
    with pytest.raises(e.ScanFailed):
        e.scan(tmp_path)
    with pytest.raises(e.ScanFailed):
        e.scan(tmp_path / "nope")


@runs
async def test_copies_both_ways_and_keeps_both_versions(world):
    here, there, _ = world
    (here / "sub").mkdir()
    (here / "sub" / "proposta.txt").write_text("do mac")
    (here / ".env").write_text("segredo")
    assert (await round_())["up"] == 1
    assert (there / "sub" / "proposta.txt").read_text() == "do mac"
    assert not (there / ".env").exists()

    later(there / "sub" / "proposta.txt", "do telemovel")  # changed on the phone, computer off
    (there / "novo.txt").write_text("feito na nuvem")
    assert (await round_())["down"] == 2
    assert (here / "sub" / "proposta.txt").read_text() == "do telemovel"
    assert (here / "novo.txt").read_text() == "feito na nuvem"

    later(here / "novo.txt", "versao mac")
    later(there / "novo.txt", "versao nuvem")
    assert (await round_())["conflict"] == 1
    copies = [p for p in here.iterdir() if "versão da nuvem" in p.name]
    assert (here / "novo.txt").read_text() == "versao mac" and copies[0].read_text() == "versao nuvem"
    await round_()
    assert (there / copies[0].name).read_text() == "versao nuvem" and (there / "novo.txt").read_text() == "versao mac"
    assert not await _changes()


async def _changes():
    done = await round_()
    return {k: v for k, v in done.items() if k not in ("ficheiros", "fora") and v}


@runs
async def test_deleted_goes_to_the_trash_and_empty_never_wipes(world):
    here, there, tmp = world
    for name in ("a.txt", "b.txt"):
        (here / name).write_text(name)
    await round_()
    (here / "a.txt").unlink()
    assert (await round_())["del_remote"] == 1
    assert not (there / "a.txt").exists()
    assert list((tmp / "trabalho" / ".lixo").rglob("a.txt.*"))
    (here / "b.txt").unlink()  # the computer's folder is now empty: looks like a disk gone, not a decision
    assert "erro" in await round_()
    assert (there / "b.txt").exists()


@runs
async def test_a_mass_deletion_waits_a_day(world, monkeypatch):
    here, there, _ = world
    for i in range(60):
        (here / f"{i}.txt").write_text(str(i))
    (here / "fica.txt").write_text("x")
    await round_()
    for i in range(60):
        (here / f"{i}.txt").unlink()
    assert (await round_())["del_remote"] == 0
    assert (there / "5.txt").exists()
    state = e._load(e.STATE)
    state["hold"]["Secretária"] -= e.HOLD_SECONDS + 1
    e._save(e.STATE, state)
    assert (await round_())["del_remote"] == 60


@runs
async def test_saved_during_the_round_is_not_overwritten(world):
    here, there, _ = world
    (here / "a.txt").write_text("1")
    await round_()
    later(there / "a.txt", "nuvem")
    async with client() as c:
        with pytest.raises(ValueError):
            info = await e._call(c, PEER, "lista", root="Secretária")
            (here / "a.txt").write_text("gravado agora")
            await e._download(c, PEER, "Secretária", "a.txt", here / "a.txt", info["files"]["a.txt"], [0, 0, "x"], here)
    assert (here / "a.txt").read_text() == "gravado agora"
    async with client() as c:
        res = await c.put(f"http://{PEER}/api/sync/espelho/ficheiro", params={"root": "Secretária", "path": "a.txt", "sha": "x", "antes": "velho"},
                          content=b"y", headers={"X-Team-Key": "k"})
    assert res.status_code == 409 and (there / "a.txt").read_text() == "nuvem"


@runs
@pytest.mark.parametrize("params", [{"root": "..", "path": "x"}, {"root": "a/b", "path": "x"}, {"root": ".lixo", "path": "x"},
                                    {"root": "A", "path": "../x"}, {"root": "A", "path": "/etc/x"}, {"root": "A", "path": ".git/config"},
                                    {"root": "A", "path": "h/.git/hooks/pre-commit"}, {"root": "A", "path": ".env"}])
async def test_paths_that_leave_are_refused(world, params):
    async with client() as c:
        res = await c.put(f"http://{PEER}/api/sync/espelho/ficheiro", params={**params, "sha": "x"}, content=b"y", headers={"X-Team-Key": "k"})
    assert res.status_code == 400


@runs
async def test_a_link_out_of_the_folder_is_refused(world, tmp_path):
    root = e.TRABALHO / "A"
    root.mkdir()
    (root / "saida").symlink_to(tmp_path)
    async with client() as c:
        res = await c.put(f"http://{PEER}/api/sync/espelho/ficheiro", params={"root": "A", "path": "saida/x", "sha": "x"}, content=b"y",
                          headers={"X-Team-Key": "k"})
    assert res.status_code == 400 and not (tmp_path / "x").exists()


@runs
async def test_only_the_persons_own_network_with_the_key(world, monkeypatch):
    url = f"http://{PEER}/api/sync/espelho/ola"
    async with client() as c:
        assert (await c.post(url, headers={"X-Team-Key": "k"})).status_code == 200
        assert (await c.post(url)).status_code == 403
        assert (await c.post(url, headers={"X-Team-Key": "k", "Tailscale-Funnel-Request": "?1"})).status_code == 403
    async with client("26.1.2.3") as c:  # a partner's computer has the key too
        assert (await c.post(url, headers={"X-Team-Key": "k"})).status_code == 403
    monkeypatch.setattr(e.sys, "platform", "darwin")  # a computer never serves its files
    async with client() as c:
        assert (await c.post(url, headers={"X-Team-Key": "k"})).status_code == 403


def run(path, *args):
    return subprocess.run(["git", "-C", str(path), "-c", "user.name=t", "-c", "user.email=t@t", *args], check=True, capture_output=True, text=True).stdout


@pytest.fixture
def repos(tmp_path):
    origin = tmp_path / "origin.git"
    subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(origin)], check=True)
    a, b = tmp_path / "a", tmp_path / "b"
    subprocess.run(["git", "clone", "-q", str(origin), str(a)], check=True, capture_output=True)
    run(a, "checkout", "-q", "-b", "main")
    (a / "f.txt").write_text("1")
    (a / "g.txt").write_text("1")
    run(a, "add", ".")
    run(a, "commit", "-qm", "um")
    run(a, "push", "-q", "-u", "origin", "main")
    subprocess.run(["git", "clone", "-q", str(origin), str(b)], check=True, capture_output=True)
    return a, b


def test_a_commit_the_mirror_already_brought_fast_forwards(repos):
    a, b = repos
    (a / "f.txt").write_text("2")
    (a / "novo.txt").write_text("n")
    (a / "g.txt").unlink()
    run(a, "add", "-A")
    run(a, "commit", "-qm", "dois")
    run(a, "push", "-q")
    (b / "f.txt").write_text("2")  # what the mirror did
    (b / "novo.txt").write_text("n")
    (b / "g.txt").unlink()
    assert e.git_align(b) == "merged"
    assert run(b, "status", "--porcelain") == "" and run(b, "rev-parse", "HEAD") == run(a, "rev-parse", "HEAD")


def test_really_different_work_is_left_alone(repos):
    a, b = repos
    (a / "f.txt").write_text("2")
    run(a, "commit", "-qam", "dois")
    run(a, "push", "-q")
    (b / "f.txt").write_text("trabalho meu")
    assert e.git_align(b) == "kept"
    assert (b / "f.txt").read_text() == "trabalho meu"


@runs
async def test_a_git_project_first_time_makes_the_clone_equal_to_the_computer(world, repos, monkeypatch):
    a, b = repos
    (a / "f.txt").write_text("por guardar")
    (a / "g.txt").unlink()
    monkeypatch.setattr(e, "roots", lambda: [{"name": "proj", "path": a}])
    (e.TRABALHO / "proj").mkdir()
    subprocess.run(["cp", "-R", str(b / ".git"), str(e.TRABALHO / "proj" / ".git")], check=True)
    run(e.TRABALHO / "proj", "checkout", "-q", "--", ".")
    async with client() as c:
        done = (await e.round_once(c, PEER))["proj"]
    assert done["up"] == 1 and done["del_remote"] == 1 and done["conflict"] == 0
    assert (e.TRABALHO / "proj" / "f.txt").read_text() == "por guardar"
    assert not (e.TRABALHO / "proj" / "g.txt").exists()


def test_a_second_hub_sees_the_port_is_taken(monkeypatch):
    import socket
    import sys

    from app.main import _port_taken

    monkeypatch.setattr(sys, "argv", ["uvicorn", "app.main:app"])
    assert _port_taken() is False  # tests and other ways in never stop
    with socket.socket() as held:
        held.bind(("127.0.0.1", 0))
        port = held.getsockname()[1]
        monkeypatch.setattr(sys, "argv", ["uvicorn", "app.main:app", "--port", str(port)])
        held.listen()
        assert _port_taken() is True
    assert _port_taken() is False
