"""Espelho: the person's work, the same on their computer and on their own cloud, so the phone can work with the computer off.

The computer's Hub drives. Every few minutes it compares each folder (the Desktop, the Documents, the projects of its Claude
conversations) with the same folder under ~/trabalho on the person's cloud server and copies what changed, both ways, against
what both sides had the last time. The computer exposes nothing: only the cloud answers these routes, and only to the person's
own Tailscale network with the team key, because a partner's computer holds the same key.

Nothing is lost: when a file changed on both sides both versions stay; a file about to be deleted or overwritten goes to a
trash folder for 30 days; a listing that fails or comes back empty never counts as "everything was deleted". .git is never
copied: each side keeps its own history, and a commit that one side pushed is fast-forwarded on the other (git_align).
"""
import asyncio
import hashlib
import hmac
import json
import logging
import os
import shutil
import subprocess
import sys
import time
import unicodedata
import uuid
from datetime import datetime
from pathlib import Path, PurePosixPath

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel

from . import recall_share, sync
from .config import settings

log = logging.getLogger("espelho")
router = APIRouter(prefix="/api/sync/espelho", tags=["espelho"])

EVERY = 180
FIRST = 60
HOME = Path(os.environ.get("TEAM_AGENT_HOME", Path.home() / ".team-agent"))
TRABALHO = Path(os.environ.get("ESPELHO_PASTA", Path.home() / "trabalho"))
STATE = HOME / "espelho.json"
OWNER = HOME / "espelho-dono.json"
HASHES = HOME / "espelho-hashes.json"
TRASH = HOME / "espelho-lixo"
PROJECTS = HOME / "projetos.json"
THIS_CODE = Path(__file__).resolve().parents[2]
FOLDERS = {"Secretária": "Desktop", "Documentos": "Documents"}  # the Downloads stay out: that is the person's decision

MAX_FILE = 200 * 1024 * 1024
MAX_ROOT = 3 * 1024 * 1024 * 1024
MIN_FREE = 2 * 1024 * 1024 * 1024
TRASH_DAYS = 30
HOLD_SECONDS = 24 * 3600
HOLD_FILES = 50
JUNK_DIRS = {".git", "node_modules", ".venv", "venv", "__pycache__", ".next", ".cache", ".Trash", ".lixo",
             ".pytest_cache", ".mypy_cache", ".turbo", ".svn", ".hg", ".idea", ".gradle"}
JUNK_FILES = {".DS_Store", "Thumbs.db", "desktop.ini", "Icon\r", ".localized"}
JUNK_ENDS = (".pyc", ".tmp", ".crdownload", ".part", ".swp", ".pem", ".key", ".p12", ".pfx")
SECRETS = (".env", "id_rsa", "id_ed25519", "credentials.json", ".netrc", ".npmrc", ".pypirc")


class ScanFailed(Exception):
    pass


# ------------------------------------------------------------------ what counts

def junk(rel: str) -> bool:
    """Not copied, whichever side asks: rebuildable folders, system clutter, secrets, and our own temporary files."""
    parts = PurePosixPath(rel).parts
    if any(p in JUNK_DIRS for p in parts[:-1]):
        return True
    name = parts[-1] if parts else ""
    if name in JUNK_FILES or name.endswith(JUNK_ENDS) or name.startswith((".espelho-tmp", "~$", ".~lock")):
        return True
    return name in SECRETS or name.startswith(".env.")


def _key(rel: str) -> str:
    """macOS may hand a name decomposed and Linux keeps what it gets: the same name must compare equal on both."""
    return unicodedata.normalize("NFC", rel.replace(os.sep, "/"))


def _git_files(root: Path) -> list[str]:
    done = subprocess.run(["git", "-C", str(root), "ls-files", "-co", "--exclude-standard", "-z"],
                          capture_output=True, timeout=120)
    if done.returncode:
        raise ScanFailed(f"git ls-files: {done.stderr.decode(errors='replace')[:200]}")
    return [n for n in done.stdout.decode("utf-8", "surrogateescape").split("\0") if n]


def _walk_files(root: Path) -> list[str]:
    def stop(err):
        raise ScanFailed(f"{type(err).__name__}: {err.filename}")  # a folder we cannot read must never look empty
    out = []
    for folder, dirs, names in os.walk(root, onerror=stop):
        dirs[:] = [d for d in dirs if d not in JUNK_DIRS and not (Path(folder) / d).is_symlink()]
        rel = Path(folder).relative_to(root)
        out += [str(rel / n) for n in names]
    return out


def _sha(path: Path) -> str:
    digest = hashlib.sha1()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _load(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _save(path: Path, data: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.{uuid.uuid4().hex}")
    tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, path)


def scan(root: Path) -> dict:
    """{files: {name: [size, mtime_ns, sha1]}, skipped: [names]}. What we could not read or is too big goes in skipped, so it
    is never mistaken for a deleted file. Raises ScanFailed when the listing itself cannot be trusted."""
    if not root.is_dir():
        raise ScanFailed(f"{root} is not there")
    try:
        names = _git_files(root) if (root / ".git").exists() else _walk_files(root)
    except OSError as exc:
        raise ScanFailed(f"{type(exc).__name__}: {exc}") from exc
    cache, fresh = _load(HASHES), False
    files, skipped, total = {}, [], 0
    for rel in names:
        key = _key(rel)
        if junk(key):
            continue
        path = root / rel
        try:
            info = path.lstat()
        except FileNotFoundError:
            continue  # git still lists a tracked file that was deleted
        except OSError:
            skipped.append(key)
            continue
        if not path.is_file() or path.is_symlink():
            continue
        total += info.st_size
        if info.st_size > MAX_FILE or total > MAX_ROOT:
            skipped.append(key)
            continue
        id_ = str(path)
        old = cache.get(id_)
        if old and old[0] == info.st_size and old[1] == info.st_mtime_ns:
            sha = old[2]
        else:
            try:
                sha = _sha(path)
            except OSError:
                skipped.append(key)
                continue
            cache[id_] = [info.st_size, info.st_mtime_ns, sha]
            fresh = True
        files[key] = [info.st_size, info.st_mtime_ns, sha]
    if fresh:
        _save(HASHES, cache)
    return {"files": files, "skipped": skipped}


# ------------------------------------------------------------------ what to do

def plan(local: dict, remote: dict, base: dict | None, skipped=(), seed=False) -> list[tuple[str, str]]:
    """Compare both sides with what they had last time. local and remote: {name: sha}; base: {name: sha}, None the first time.
    A git project's first time (seed) makes the cloud's fresh clone equal to the computer; anything else merges and keeps both."""
    out, base_, skip = [], base or {}, set(skipped)
    for name in sorted(set(local) | set(remote) | set(base_)):
        if name in skip:
            continue
        here, there, was = local.get(name), remote.get(name), base_.get(name)
        if here == there:
            continue
        if seed and base is None:
            out.append(("up", name) if here else ("del_remote", name))
        elif not was:
            out.append(("down", name) if not here else ("up", name) if not there else ("conflict", name))
        elif here == was:
            out.append(("del_local", name) if not there else ("down", name))
        elif there == was:
            out.append(("del_remote", name) if not here else ("up", name))
        else:  # both changed; what still exists beats a deletion
            out.append(("down", name) if not here else ("up", name) if not there else ("conflict", name))
    return out


def conflict_name(name: str, when: datetime | None = None) -> str:
    path = PurePosixPath(name)
    stamp = (when or datetime.now()).strftime("%Y-%m-%d %H%M")
    return str(path.with_name(f"{path.stem} (versão da nuvem {stamp}){path.suffix}"))


def too_many(actions: list[tuple[str, str]], base: dict | None) -> bool:
    """Half of a big folder going away at once looks like an accident (a disk not mounted, a sync gone wrong): wait a day."""
    gone = sum(1 for a, _ in actions if a in ("del_local", "del_remote"))
    return gone > HOLD_FILES and gone * 2 > len(base or {})


# ------------------------------------------------------------------ files and git, on either side

def _bury(root: Path, name: str, trash: Path, move: bool):
    """Keep what is about to go. move=False copies, for a file about to be overwritten."""
    path = root / name
    if not path.is_file():
        return
    target = trash / datetime.now().strftime("%Y-%m-%d") / root.name / f"{name}.{uuid.uuid4().hex[:6]}"
    target.parent.mkdir(parents=True, exist_ok=True)
    if move:
        shutil.move(str(path), target)
        parent = path.parent
        while parent != root and not any(parent.iterdir()):
            parent.rmdir()
            parent = parent.parent
    else:
        shutil.copy2(path, target)


def purge(trash: Path):
    if not trash.is_dir():
        return
    limit = time.time() - TRASH_DAYS * 86400
    for day in trash.iterdir():
        try:
            if day.is_dir() and day.stat().st_mtime < limit:
                shutil.rmtree(day, ignore_errors=True)
        except OSError:
            continue


def _git(path: Path, *args: str, timeout: int = 180) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-C", str(path), *args], capture_output=True, text=True, timeout=timeout,
                          env={**os.environ, "GIT_TERMINAL_PROMPT": "0"})


def git_state(path: Path) -> dict:
    head = _git(path, "symbolic-ref", "--short", "-q", "HEAD")
    remote = _git(path, "remote", "get-url", "origin")
    return {"branch": head.stdout.strip() if head.returncode == 0 else "",
            "remote": remote.stdout.strip() if remote.returncode == 0 else ""}


def git_align(path: Path) -> str:
    """Fast-forward to what was pushed. A file the mirror already brought is the same as the commit, and git refuses to pull
    over a changed file even so: what already equals the commit is staged first. Anything really different stays untouched."""
    if not (path / ".git").exists() or _git(path, "fetch", "-q").returncode:
        return ""
    if _git(path, "rev-parse", "-q", "--verify", "@{u}").returncode:
        return ""
    if _git(path, "rev-list", "--count", "HEAD..@{u}").stdout.strip() in ("", "0"):
        return ""
    if _git(path, "merge-base", "--is-ancestor", "HEAD", "@{u}").returncode:
        return "diverged"
    for name in filter(None, _git(path, "diff", "--name-only", "-z", "HEAD", "@{u}").stdout.split("\0")):
        want = _git(path, "rev-parse", "-q", "--verify", f"@{{u}}:{name}").stdout.strip()
        here = path / name
        if here.is_file() and want and _git(path, "hash-object", "--", name).stdout.strip() == want:
            _git(path, "add", "--", name)
        elif not here.exists() and not want:
            _git(path, "rm", "-q", "--cached", "--ignore-unmatch", "--", name)
    done = _git(path, "merge", "-q", "--ff-only", "@{u}")
    return "merged" if done.returncode == 0 else "kept"


def git_prepare(path: Path, remote: str, branch: str) -> str:
    """On the cloud: this folder has git, on the computer's branch. The working files stay as the mirror left them.
    "new" means the clone was made just now, so nothing here can be what the computer last saw."""
    fresh = False
    if not (path / ".git").exists():
        if not remote.startswith(("https://", "git@")):
            return "no remote"
        holder = path.with_name(f".espelho-tmp-{uuid.uuid4().hex}")
        done = subprocess.run(["git", "clone", "-q", "--no-checkout", "--", remote, str(holder)], capture_output=True, text=True,
                              timeout=600, env={**os.environ, "GIT_TERMINAL_PROMPT": "0"})
        if done.returncode:
            shutil.rmtree(holder, ignore_errors=True)
            return "clone failed"
        path.mkdir(parents=True, exist_ok=True)
        shutil.move(str(holder / ".git"), path / ".git")
        shutil.rmtree(holder, ignore_errors=True)
        _git(path, "reset", "-q")
        # the files git has and the mirror never sends (a tracked .env.example) must exist, or a commit here would delete them
        missing = [n for n in _git(path, "ls-files", "-d", "-z").stdout.split("\0") if n]
        for start in range(0, len(missing), 200):
            _git(path, "checkout", "-q", "--", *missing[start:start + 200])
        fresh = True
    now = git_state(path)["branch"]
    if branch and now != branch:
        _git(path, "fetch", "-q")
        if _git(path, "rev-parse", "-q", "--verify", f"origin/{branch}").returncode == 0:
            _git(path, "branch", "-f", branch, f"origin/{branch}")
            _git(path, "symbolic-ref", "HEAD", f"refs/heads/{branch}")
            _git(path, "reset", "-q")
            _git(path, "branch", f"--set-upstream-to=origin/{branch}", branch)
    aligned = git_align(path)
    return "new" if fresh else aligned or "ok"


# ------------------------------------------------------------------ the cloud's side

class Root(BaseModel):
    root: str


class Gone(BaseModel):
    root: str
    path: str
    antes: str = ""


class Git(BaseModel):
    root: str
    remote: str = ""
    branch: str = ""


class Fim(BaseModel):
    computador: str
    pastas: dict = {}


def _only_mine(request: Request):
    """Only the person's own cloud answers, and only their own computers, with the key. These routes read and write files."""
    host = request.client.host if request.client else ""
    key = request.headers.get("x-team-key", "")
    if (sys.platform != "linux" or not settings.team_key or request.headers.get("tailscale-funnel-request")
            or not recall_share.tailnet(host) or not hmac.compare_digest(key.encode(), settings.team_key.encode())):
        raise HTTPException(403, "Só os computadores da própria pessoa")


def _root(name: str) -> Path:
    if not name or name != PurePosixPath(name).name or name.startswith(".") or "\\" in name or "\0" in name:
        raise HTTPException(400, "Nome inválido")
    return TRABALHO / name


def _inside(root_name: str, rel: str) -> Path:
    root = _root(root_name)
    path = PurePosixPath(rel)
    if not path.parts or path.is_absolute() or ".." in path.parts or "\\" in rel or "\0" in rel or junk(rel):
        raise HTTPException(400, "Caminho inválido")
    full = root / rel
    top, up = root.resolve(), full.parent.resolve()
    if (up != top and top not in up.parents) or full.is_symlink():
        raise HTTPException(400, "Caminho inválido")
    return full


def _current(path: Path) -> str:
    try:
        return _sha(path)
    except OSError:
        return ""


@router.post("/ola")
async def hello(request: Request):
    _only_mine(request)
    return {"ok": True, "free": shutil.disk_usage(TRABALHO.parent).free}


@router.post("/lista")
async def listing(body: Root, request: Request):
    _only_mine(request)
    root = _root(body.root)
    if not root.is_dir():
        return {"files": {}, "skipped": [], "new": True}
    try:
        return await asyncio.to_thread(scan, root)
    except (ScanFailed, subprocess.SubprocessError) as exc:
        raise HTTPException(503, str(exc)) from exc


@router.get("/ficheiro")
async def give(root: str, path: str, request: Request):
    _only_mine(request)
    full = _inside(root, path)
    if not full.is_file():
        raise HTTPException(404, "Não existe")
    return FileResponse(full, media_type="application/octet-stream")


@router.put("/ficheiro")
async def take(root: str, path: str, sha: str, request: Request, antes: str = "", mtime: int = 0):
    """Written whole or not at all, and only if the file is still what the computer saw when it decided."""
    _only_mine(request)
    full = _inside(root, path)
    if await asyncio.to_thread(_current, full) != antes:
        raise HTTPException(409, "Mudou entretanto")
    if shutil.disk_usage(TRABALHO.parent).free < MIN_FREE:
        raise HTTPException(507, "Pouco espaço na nuvem")
    full.parent.mkdir(parents=True, exist_ok=True)
    tmp = full.with_name(f".espelho-tmp-{uuid.uuid4().hex}")
    digest, size = hashlib.sha1(), 0
    try:
        with tmp.open("wb") as handle:
            async for chunk in request.stream():
                size += len(chunk)
                if size > MAX_FILE:
                    raise HTTPException(413, "Grande demais")
                digest.update(chunk)
                await asyncio.to_thread(handle.write, chunk)
        if digest.hexdigest() != sha:
            raise HTTPException(422, "Chegou incompleto")
        await asyncio.to_thread(_bury, _root(root), path, TRABALHO / ".lixo", False)
        if mtime:
            os.utime(tmp, ns=(mtime, mtime))
        os.replace(tmp, full)
    finally:
        tmp.unlink(missing_ok=True)
    return {"ok": True}


@router.post("/apagar")
async def remove(body: Gone, request: Request):
    _only_mine(request)
    full = _inside(body.root, body.path)
    if await asyncio.to_thread(_current, full) != body.antes:
        raise HTTPException(409, "Mudou entretanto")
    await asyncio.to_thread(_bury, _root(body.root), body.path, TRABALHO / ".lixo", True)
    return {"ok": True}


@router.post("/git")
async def git_there(body: Git, request: Request):
    _only_mine(request)
    root = _root(body.root)
    try:
        return {"git": await asyncio.to_thread(git_prepare, root, body.remote, body.branch)}
    except (OSError, subprocess.SubprocessError) as exc:
        return {"git": f"{type(exc).__name__}"}


@router.post("/fim")
async def finished(body: Fim, request: Request):
    """When and how the last round went: what the agents here tell the person about how fresh the copy is."""
    _only_mine(request)
    await asyncio.to_thread(purge, TRABALHO / ".lixo")
    _save(TRABALHO / ".espelho.json", {"computador": body.computador, "quando": time.time(), "pastas": body.pastas})
    return {"ok": True}


# ------------------------------------------------------------------ the computer's side

def roots() -> list[dict]:
    """The folders this computer keeps on its cloud. The folder this very Hub runs from stays out: half an edit from the phone
    would land in the code that is running."""
    home = Path.home().resolve()
    out = [{"name": name, "path": Path.home() / folder} for name, folder in FOLDERS.items() if (Path.home() / folder).is_dir()]
    try:
        rows = json.loads(PROJECTS.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        rows = []
    taken = {r["name"] for r in out}
    for row in rows if isinstance(rows, list) else []:
        name = str(row.get("name") or "")
        path = Path(row.get("path") or "").expanduser().resolve()
        if path == THIS_CODE:
            taken.add(name)  # and no other copy under the same name: the cloud reads this project from git
        if (not name or name in taken or name != PurePosixPath(name).name or name.startswith(".")
                or home not in path.parents or not path.is_dir()):
            continue
        taken.add(name)
        out.append({"name": name, "path": path, "remote": row.get("remote") or ""})
    return out


async def _call(client: httpx.AsyncClient, peer: str, way: str, **body) -> dict:
    res = await client.post(f"{sync._base(peer)}/api/sync/espelho/{way}", json=body, headers={"X-Team-Key": settings.team_key})
    res.raise_for_status()
    return res.json()


async def _chunks(path: Path):
    with path.open("rb") as handle:
        while chunk := await asyncio.to_thread(handle.read, 1024 * 1024):
            yield chunk


async def _upload(client, peer, root: str, path: Path, name: str, info: list, antes: str):
    res = await client.put(f"{sync._base(peer)}/api/sync/espelho/ficheiro",
                           params={"root": root, "path": name, "sha": info[2], "antes": antes, "mtime": info[1]},
                           content=_chunks(path), headers={"X-Team-Key": settings.team_key})
    res.raise_for_status()


async def _download(client, peer, root: str, name: str, target: Path, info: list, seen: list | None, folder: Path):
    """Replace target only if it is still what we listed: the person may have saved it a second ago."""
    tmp = target.with_name(f".espelho-tmp-{uuid.uuid4().hex}")
    target.parent.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha1()
    try:
        async with client.stream("GET", f"{sync._base(peer)}/api/sync/espelho/ficheiro", params={"root": root, "path": name},
                                 headers={"X-Team-Key": settings.team_key}) as res:
            res.raise_for_status()
            with tmp.open("wb") as handle:
                async for chunk in res.aiter_bytes(1024 * 1024):
                    digest.update(chunk)
                    await asyncio.to_thread(handle.write, chunk)
        if digest.hexdigest() != info[2]:
            raise ValueError("changed on the way")
        now = target.lstat() if target.exists() else None
        if (now.st_size, now.st_mtime_ns) != (seen[0], seen[1]) if now and seen else bool(now) != bool(seen):
            raise ValueError("changed here meanwhile")
        if now:
            await asyncio.to_thread(_bury, folder, str(target.relative_to(folder)), TRASH, False)
        os.utime(tmp, ns=(info[1], info[1]))
        os.replace(tmp, target)
    finally:
        tmp.unlink(missing_ok=True)


async def apply(client, peer: str, root: str, folder: Path, here: dict, there: dict, actions: list, base: dict) -> dict:
    """Do it; each file on its own, so that one failure costs one file until the next round. Base moves only for what worked."""
    done = {"up": 0, "down": 0, "del_local": 0, "del_remote": 0, "conflict": 0, "failed": 0}
    for action, name in actions:
        info, other = here.get(name), there.get(name)
        local = folder / name
        try:
            if action == "up":
                await _upload(client, peer, root, local, name, info, other[2] if other else "")
                base[name] = info[2]
            elif action == "down":
                await _download(client, peer, root, name, local, other, info, folder)
                base[name] = other[2]
            elif action == "del_remote":
                await _call(client, peer, "apagar", root=root, path=name, antes=other[2])
                base.pop(name, None)
            elif action == "del_local":
                if await asyncio.to_thread(_current, local) != info[2]:
                    raise ValueError("changed here meanwhile")
                await asyncio.to_thread(_bury, folder, name, TRASH, True)
                base.pop(name, None)
            elif action == "conflict":
                # the cloud's version becomes a file of its own (it goes back up next round); this one takes the name there
                await _download(client, peer, root, name, folder / conflict_name(name), other, None, folder)
                await _upload(client, peer, root, local, name, info, other[2])
                base[name] = info[2]
            done[action] += 1
        except (httpx.HTTPError, OSError, ValueError) as exc:
            log.info("espelho %s %s/%s: %s", action, root, name, type(exc).__name__)
            done["failed"] += 1
    return done


def _shas(listing: dict) -> dict:
    return {k: v[2] for k, v in listing["files"].items()}


async def sync_root(client, peer: str, entry: dict, state: dict) -> dict:
    root, folder = entry["name"], Path(entry["path"])
    is_git = (folder / ".git").exists()
    bases = state.setdefault("base", {})
    base = bases.get(root)
    if is_git:
        info = await asyncio.to_thread(git_state, folder)
        await asyncio.to_thread(git_align, folder)
        answer = await _call(client, peer, "git", root=root, remote=entry.get("remote") or info["remote"], branch=info["branch"])
        if answer.get("git") == "new":
            base = None
    here = await asyncio.to_thread(scan, folder)
    there = await _call(client, peer, "lista", root=root)
    if base and (not here["files"] or (not there["files"] and not there.get("new"))):
        return {"erro": "uma das pastas veio vazia; fica como está"}  # never "everything was deleted"
    if base and there.get("new"):
        base = None  # the cloud lost this folder: begin again, nothing is deleted here
    actions = plan(_shas(here), _shas(there), base, [*here["skipped"], *there["skipped"]], seed=is_git)
    holds = state.setdefault("hold", {})
    if too_many(actions, base):
        since = holds.setdefault(root, time.time())
        if time.time() - since < HOLD_SECONDS:
            actions = [a for a in actions if a[0] not in ("del_local", "del_remote")]
    else:
        holds.pop(root, None)
    working = dict(base or {})
    for name, sha in _shas(here).items():  # what is already equal on both sides needs no copy
        if _shas(there).get(name) == sha:
            working[name] = sha
    for name in list(working):
        if name not in here["files"] and name not in there["files"]:
            working.pop(name)
    done = await apply(client, peer, root, folder, here["files"], there["files"], actions, working)
    bases[root] = working
    if is_git and (done["down"] or done["up"]):
        await asyncio.to_thread(git_align, folder)
    done["ficheiros"] = len(here["files"])
    done["fora"] = len(here["skipped"])
    return done


async def round_once(client, peer: str) -> dict:
    state = _load(STATE)
    results = {}
    for entry in await asyncio.to_thread(roots):
        try:
            results[entry["name"]] = await sync_root(client, peer, entry, state)
        except ScanFailed as exc:
            results[entry["name"]] = {"erro": str(exc)[:200]}
        except (httpx.HTTPError, OSError, subprocess.SubprocessError, ValueError) as exc:
            results[entry["name"]] = {"erro": type(exc).__name__}
        _save(STATE, state)
    await asyncio.to_thread(purge, TRASH)
    name = recall_share.computer()[0]
    await _call(client, peer, "fim", computador=name, pastas=results)
    state["ultima"], state["pastas"] = time.time(), results
    _save(STATE, state)
    return results


async def _my_cloud(client) -> str:
    for peer in sync.peers():
        if not await asyncio.to_thread(recall_share.own, peer):
            continue
        try:
            res = await client.post(f"{sync._base(peer)}/api/sync/espelho/ola", headers={"X-Team-Key": settings.team_key}, timeout=8)
            if res.status_code == 200:
                return peer
        except httpx.HTTPError:
            continue
    return ""


async def loop():
    """Runs on the person's computer. A cloud has nothing to drive: the computer may be off, and it catches up when it wakes."""
    if sys.platform == "linux" or os.environ.get("ESPELHO") == "0":
        return
    me = {"pid": os.getpid(), "desde": time.time()}
    _save(OWNER, me)  # a Hub that never finished dying must not copy next to its successor: the newest owns the mirror
    await asyncio.sleep(FIRST)
    async with httpx.AsyncClient(timeout=httpx.Timeout(60, read=600, write=600)) as client:
        while True:
            if _load(OWNER).get("pid") != me["pid"]:
                return
            if settings.team_key:
                try:
                    if peer := await _my_cloud(client):
                        await round_once(client, peer)
                except Exception as exc:  # the mirror must never take the Hub down
                    log.warning("espelho: %s", type(exc).__name__)
            await asyncio.sleep(EVERY)
