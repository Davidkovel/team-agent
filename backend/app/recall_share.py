"""One Claude memory on all of the person's own computers (4 Nov, David: «quero que tudo seja uma memória grande... o
telemóvel tenha a memória do PC quando eu faço lá coisas»; the Mac is his main computer, the cloud runs his agents).

Claude Code keeps every conversation in ~/.claude/projects on the computer it ran on. The agents in the cloud (docs/nuvem.md)
look into the past with the `recall` tool (agent/team_agent/tools/recall_tool.py), which only saw the cloud's own
conversations: what David did on his Mac was not there, so a task sent from the phone did not know it. Now each Hub sends
what was said in its Claude conversations (the person's text and Claude's, no tool output) to the Hubs of the person's other
computers, which keep it in ~/.team-agent/recall-peers/<computer>/; `recall` searches it there too. Every 10 minutes, only
what changed, so a conversation on the Mac is in the cloud's memory a few minutes later, and stays there with the Mac closed.

Only between the person's own computers. A Hub sends only to the sync peers on its Tailscale network (100.64.0.0/10 or
fd7a:115c:a1e0::/48), which has that person's devices only (the partners reach a cloud through its Funnel, never on the
tailnet), and takes them only from there, with the team key, never through the Funnel. Nothing goes into the database, so
it never travels to the partners' Hubs by sync. RECALL_SHARE=0 in backend/.env switches it off, both ways.
"""
import asyncio
import ipaddress
import json
import logging
import os
import re
import socket
import subprocess
import sys
import time
from pathlib import Path

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from . import sync
from .config import settings

log = logging.getLogger("team.recall")

PROJECTS = Path(os.environ.get("CLAUDE_CONFIG_DIR", Path.home() / ".claude")) / "projects"
STORE = Path.home() / ".team-agent" / "recall-peers"   # what the other computers sent (read by recall_tool.py)
LOCAL_PROJECTS = Path.home() / ".team-agent" / "projetos.json"   # this computer's projects, for its own agent (agent/.../projects.py)
PROJECTS_KEPT = 25
PROJECT_DAYS = 60
STATE = Path.home() / ".team-agent" / "recall-share.json"   # {peer: {"folder/session": [mtime, size]}} of what went where
FIRST = 90              # seconds after the Hub starts
EVERY = 180             # between rounds (4 Nov: from 600, what was said on one computer is on the others in minutes)
DAYS = 120              # a conversation untouched for longer stays where it is
BATCH_FILES = 30
BATCH_CHARS = 4_000_000
BATCHES = 20            # per peer and round: a first time with months of conversations goes over a few rounds
FILE_CHARS = 1_500_000  # of a very long conversation, the newest part
TEXT = 6000             # of one message (as recall_tool.py keeps it)
TAILNET = (ipaddress.ip_network("100.64.0.0/10"), ipaddress.ip_network("fd7a:115c:a1e0::/48"))
SAFE = re.compile(r"[^A-Za-z0-9._-]+")

router = APIRouter(prefix="/api/sync", tags=["sync"])


# ------------------------------------------------------------------ whose computers

def tailnet(host: str) -> bool:
    try:
        ip = ipaddress.ip_address(host.split("%")[0].strip("[]"))
    except ValueError:
        return False
    return any(ip in net for net in TAILNET)


def _host(peer: str) -> str:
    """The address of a sync peer: '100.1.2.3:8000' -> '100.1.2.3', 'amg-nuvem:8000' -> 'amg-nuvem'; '' for a relay URL
    (the Funnel: the internet, so other people's computers too)."""
    if peer.startswith(("http://", "https://")):
        return ""
    if peer.startswith("["):
        return peer[1:].split("]")[0]
    return peer.rsplit(":", 1)[0] if peer.count(":") == 1 else peer


def own(peer: str) -> bool:
    """A peer on this computer's tailnet, by its address or what its name (MagicDNS: amg-nuvem) resolves to."""
    host = _host(peer)
    if not host:
        return False
    if tailnet(host):
        return True
    try:
        return any(tailnet(a[4][0]) for a in socket.getaddrinfo(host, None))
    except (OSError, UnicodeError):
        return False


def computer() -> tuple[str, str]:
    """(name, system) of this computer, as the others show it: ('MacBook-Air-de-David', 'mac')."""
    name = socket.gethostname().removesuffix(".local") or "computador"
    system = {"darwin": "mac", "win32": "windows"}.get(sys.platform, "linux")
    return name, system


# ------------------------------------------------------------------ what was said here

def _text(message) -> str:
    content = (message or {}).get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text")
    return ""


def digest(f: Path) -> list[list[str]]:
    """[when, who, text] of one conversation, as recall_tool.py reads it: what the person and Claude said, without the tool
    output and the system wrappers (most of the file). Of a very long one, the newest FILE_CHARS.
    A note of Claude's own memory (<project>/memory/*.md) goes whole, as one thing Claude said."""
    if f.suffix == ".md":
        when = time.strftime("%Y-%m-%d %H:%M", time.gmtime(f.stat().st_mtime))
        text = f.read_text(encoding="utf-8", errors="ignore").strip()
        return [[when, "claude", text[:TEXT]]] if text else []
    items = []
    with f.open(encoding="utf-8", errors="ignore") as fh:
        for line in fh:
            if '"text"' not in line and '"content":"' not in line:
                continue
            try:
                entry = json.loads(line)
            except ValueError:
                continue
            if entry.get("type") not in ("user", "assistant") or entry.get("isMeta") or entry.get("isSidechain"):
                continue
            text = _text(entry.get("message")).strip()
            if text and not text.startswith("<"):
                items.append([(entry.get("timestamp") or "")[:16].replace("T", " "),
                              "pessoa" if entry["type"] == "user" else "claude", text[:TEXT]])
    total, keep = 0, []
    for item in reversed(items):
        total += len(item[2])
        if total > FILE_CHARS:
            break
        keep.append(item)
    return keep[::-1]


def _where_from(f: Path) -> tuple[str, str]:
    """(project folder, session name) of a conversation or of a note of Claude's memory."""
    return (f.parents[1].name, f"memoria-{f.stem}") if f.suffix == ".md" else (f.parent.name, f.stem)


def _key(f: Path) -> str:
    return "/".join(_where_from(f))


def pending(sent: dict, root: Path | None = None) -> list[tuple[Path, str, float, int]]:
    """The conversations this peer has not got as they are now, newest first."""
    root = root or PROJECTS
    cutoff, out = time.time() - DAYS * 86400, []
    for f in [*root.glob("*/*.jsonl"), *root.glob("*/memory/*.md")]:
        try:
            st = f.stat()
        except OSError:
            continue
        key = _key(f)
        if st.st_mtime >= cutoff and sent.get(key) != [st.st_mtime, st.st_size]:
            out.append((f, key, st.st_mtime, st.st_size))
    out.sort(key=lambda x: x[2], reverse=True)
    return out


def _load() -> dict:
    try:
        data = json.loads(STATE.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _save(state: dict):
    try:
        STATE.parent.mkdir(parents=True, exist_ok=True)
        STATE.write_text(json.dumps(state), encoding="utf-8")
    except OSError:
        pass


def batch(sent: dict, root: Path | None = None) -> list[dict]:
    """The next conversations to send to one peer. One with nothing said (only tools) is marked sent without going."""
    out, chars = [], 0
    for f, key, mtime, size in pending(sent, root):
        try:
            items = digest(f)
        except OSError:
            continue
        if not items:
            sent[key] = [mtime, size]
            continue
        n = sum(len(i[2]) for i in items)
        if out and (len(out) >= BATCH_FILES or chars + n > BATCH_CHARS):
            break
        folder, session = _where_from(f)
        out.append({"folder": folder, "session": session, "mtime": mtime, "size": size, "items": items})
        chars += n
    return out


async def send(client: httpx.AsyncClient, peer: str, state: dict, root: Path | None = None) -> int:
    """One batch to one peer: how many went, 0 when it has everything, -1 when its Hub is too old to take them."""
    sent = state.setdefault(peer, {})
    files = await asyncio.to_thread(batch, sent, root)
    if not files:
        return 0
    name, system = computer()
    res = await client.post(f"{sync._base(peer)}/api/sync/recall", json={"computer": name, "system": system, "files": files},
                            headers={"X-Team-Key": settings.team_key})
    if res.status_code in (404, 405):
        return -1
    res.raise_for_status()
    for f in files:
        sent[f"{f['folder']}/{f['session']}"] = [f["mtime"], f["size"]]
    return len(files)


# ------------------------------------------------------------------ the projects of this computer

def _git(path: str, *args: str) -> str:
    try:
        done = subprocess.run(["git", "-C", path, *args], capture_output=True, text=True, timeout=8,
                              env={**os.environ, "GIT_TERMINAL_PROMPT": "0"})
        return done.stdout.strip() if done.returncode == 0 else ""
    except (OSError, subprocess.SubprocessError):
        return ""


def _cwd(f: Path) -> str:
    """The folder a conversation ran in: every line of the transcript near the start says it."""
    try:
        with f.open(encoding="utf-8", errors="ignore") as fh:
            for _, line in zip(range(40), fh):
                if '"cwd"' in line:
                    return str(json.loads(line).get("cwd") or "")
    except (OSError, ValueError):
        pass
    return ""


def clean_remote(url: str) -> str:
    """Without any user or token written inside the address: this list goes to the other computers."""
    return re.sub(r"^(https?://)[^/@]+@", r"\1", url.strip())


def scan_projects(root: Path | None = None) -> list[dict]:
    """The projects of the Claude conversations of this computer, newest first: name, folder, git remote, what is not pushed."""
    root, home = root or PROJECTS, Path.home().resolve()
    newest: dict[str, tuple[float, Path]] = {}
    cutoff = time.time() - PROJECT_DAYS * 86400
    for f in root.glob("*/*.jsonl"):
        try:
            mtime = f.stat().st_mtime
        except OSError:
            continue
        if mtime >= cutoff and mtime > newest.get(f.parent.name, (0, f))[0]:
            newest[f.parent.name] = (mtime, f)
    # Many conversations start in the home folder, whatever they work on: the repositories in plain sight count too
    places = [(mtime, _cwd(f)) for mtime, f in newest.values()]
    for git in [Path(__file__).resolve().parents[2] / ".git", *home.glob("*/.git"), *home.glob("*/*/.git")]:
        try:
            if git.stat().st_mtime >= cutoff:
                places.append((git.stat().st_mtime, str(git.parent)))
        except OSError:
            continue
    out, seen = [], set()
    for mtime, cwd in sorted(places, key=lambda x: x[0], reverse=True):
        if not cwd or not Path(cwd).is_dir():
            continue
        path = _git(cwd, "rev-parse", "--show-toplevel") or cwd
        resolved = Path(path).resolve()
        # never the home folder as a whole, nor outside it, nor the throwaway folders of Claude's own
        if path in seen or home not in resolved.parents or resolved.name.startswith("scratch-"):
            continue
        seen.add(path)
        ahead = _git(path, "rev-list", "--count", "@{u}..HEAD")
        out.append({"name": resolved.name, "path": str(resolved), "remote": clean_remote(_git(path, "remote", "get-url", "origin")),
                    "branch": _git(path, "branch", "--show-current"), "last": _git(path, "log", "-1", "--format=%s")[:160],
                    "dirty": len(_git(path, "status", "--porcelain").splitlines()), "ahead": int(ahead) if ahead.isdigit() else 0,
                    "used": mtime})
        if len(out) >= PROJECTS_KEPT:
            break
    return out


def known_projects() -> list[dict]:
    """What the phone can choose from: name, computer folder or not, newest first (routers/conversas.py)."""
    lists = [LOCAL_PROJECTS, *STORE.glob("*/_projects.json")] if STORE.is_dir() else [LOCAL_PROJECTS]
    best: dict[str, dict] = {}
    for path in lists:
        try:
            for p in json.loads(path.read_text(encoding="utf-8")):
                if p.get("name") and (p.get("used") or 0) >= (best.get(p["name"], {}).get("used") or 0):
                    best[p["name"]] = p
        except (OSError, ValueError, AttributeError):
            continue
    rows = sorted(best.values(), key=lambda p: p.get("used") or 0, reverse=True)
    mirror = Path.home() / "trabalho"  # the computer's folders on the cloud (espelho.py): the Desktop and Documents too
    if mirror.is_dir():
        rows += [{"name": d.name} for d in sorted(mirror.iterdir()) if d.is_dir() and d.name[0] != "." and d.name not in best]
    return [{"name": p["name"], "git": bool(p.get("remote")), "dirty": p.get("dirty") or 0, "ahead": p.get("ahead") or 0} for p in rows]


async def send_projects(client: httpx.AsyncClient, peer: str, state: dict, rows: list[dict]):
    """The list goes only when it changed."""
    mark = [[p["name"], p["last"], p["dirty"], p["ahead"]] for p in rows]
    if state.get("_projects", {}).get(peer) == mark:
        return
    name, system = computer()
    res = await client.post(f"{sync._base(peer)}/api/sync/recall", json={"computer": name, "system": system, "files": [], "projects": rows},
                            headers={"X-Team-Key": settings.team_key})
    if res.status_code not in (404, 405):
        res.raise_for_status()
        state.setdefault("_projects", {})[peer] = mark


async def loop():
    await asyncio.sleep(FIRST)
    async with httpx.AsyncClient(timeout=90) as client:
        while True:
            if settings.recall_share and settings.team_key and PROJECTS.is_dir():
                try:
                    state = _load()
                    rows = await asyncio.to_thread(scan_projects)
                    await asyncio.to_thread(LOCAL_PROJECTS.write_text, json.dumps(rows, ensure_ascii=False), "utf-8")
                    for peer in [p for p in sync.peers() if await asyncio.to_thread(own, p)]:
                        try:
                            await send_projects(client, peer, state, rows)
                            for _ in range(BATCHES):
                                if await send(client, peer, state) <= 0:
                                    break
                                _save(state)
                                await asyncio.sleep(1)
                        except (httpx.HTTPError, OSError) as exc:
                            log.info("Claude memory not sent to %s: %s", peer, exc)
                    _save(state)
                except Exception:  # never stops the Hub
                    log.exception("Claude memory round failed")
            await asyncio.sleep(EVERY)


# ------------------------------------------------------------------ what the other computers sent

class RecallFile(BaseModel):
    folder: str
    session: str
    mtime: float = 0
    size: int = 0
    items: list[list[str]] = []


class RecallIn(BaseModel):
    computer: str
    system: str = ""
    files: list[RecallFile] = []
    projects: list[dict] | None = None   # the projects of that computer (scan_projects)


def _safe(text: str, cap: int) -> str:
    return SAFE.sub("-", text).strip("-.")[:cap]


@router.post("/recall")
async def take(body: RecallIn, request: Request):
    """Another computer of this person sends what was said in its Claude conversations; the agents here search it."""
    sync.team_only(request)
    host = request.client.host if request.client else ""
    if request.headers.get("tailscale-funnel-request") or not tailnet(host):
        raise HTTPException(403, "Só dos computadores da própria pessoa (a rede Tailscale dela)")
    if not settings.recall_share:
        raise HTTPException(403, "A memória partilhada está desligada neste Hub (RECALL_SHARE=0)")
    where = STORE / (_safe(body.computer, 60) or "computador")
    kept = 0
    for f in body.files[:BATCH_FILES * 2]:
        name = f"{_safe(f.folder, 150) or 'projeto'}__{_safe(f.session, 80) or 'conversa'}.json"
        items, chars = [], 0
        for item in reversed(f.items):
            if len(item) != 3:
                continue
            text = str(item[2])[:TEXT]
            chars += len(text)
            if chars > FILE_CHARS:
                break
            items.append([str(item[0])[:16], "pessoa" if item[1] == "pessoa" else "claude", text])
        if not items:
            continue
        where.mkdir(parents=True, exist_ok=True)
        (where / name).write_text(json.dumps({"folder": f.folder[:200], "mtime": f.mtime, "items": items[::-1]},
                                             ensure_ascii=False), encoding="utf-8")
        kept += 1
    if body.projects is not None:
        where.mkdir(parents=True, exist_ok=True)
        keys = ("name", "path", "remote", "branch", "last", "dirty", "ahead", "used")
        rows = [{k: (clean_remote(str(p.get(k) or "")) if k == "remote" else p.get(k)) for k in keys}
                for p in body.projects[:PROJECTS_KEPT * 2] if isinstance(p, dict)]
        (where / "_projects.json").write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
        kept += 1
    if kept:
        (where / "_computer.json").write_text(json.dumps({"computer": body.computer[:80], "system": body.system[:20],
                                                          "at": time.time()}), encoding="utf-8")
    return {"ok": True, "kept": kept}
