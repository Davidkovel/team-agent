"""The same Claude Code on every PC of the team (16 Oct, Marco: «quero que seja quase automatizado para o meu computador,
para o do Kovel, para todos... automatiza tudo»).

Every Hub asks the other Hubs, over the team's VPN, what their Claude Code has, and gives its own PC what is missing:
- **Plugins** (SEO, ads, Shopify, superpowers, marketing...): each Hub tells the plugins installed on its PC and the GitHub
  repository of each one's marketplace. A plugin another PC has and this one lacks is installed here with this PC's own
  Claude Code (`claude plugin install <plugin>@<marketplace> --scope user`, adding the marketplace first). Never with -y: a
  plugin that wants to run a command of its own is left out and said in the log. Only marketplaces on GitHub travel.
- **Personal skills** (~/.claude/skills, like motion-reel-codigo): each Hub serves its own as a zip to the other Hubs, and
  a skill missing here is unpacked into ~/.claude/skills. A copy that came this way follows the owner's changes; one the
  person has made their own is never touched. A skill folder with a file named `.privada` is never shared.
Nothing goes into git: the repository is public and these are other people's plugins and skills. They only travel between
the team's own PCs, like the database does (sync.py, same rule for who may ask).

What this PC learned from the others is kept in ~/.team-agent/claude-kit.json, so it can install later even when the others
are off. A plugin this Hub installed and the person removed stays removed here. `FORA` keeps a plugin out for everybody.

**Off unless the person whose PC it is turns it on** (CLAUDE_KIT=1 in that PC's backend/.env, which is not in git): it
installs other people's plugins and skills on the PC, so each partner decides for their own. Off, the Hub neither installs
nor serves anything.
"""
import asyncio
import hashlib
import hmac
import io
import json
import logging
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile
from pathlib import Path

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response

from . import sync
from .config import settings

log = logging.getLogger("team.kit")

CLAUDE = Path.home() / ".claude"
STATE = Path.home() / ".team-agent" / "claude-kit.json"
LIBRARY = Path(__file__).resolve().parents[2] / "library" / "skills"
EVERY = 1800            # seconds between rounds; the first one a minute after the Hub starts
RETRY = 6 * 3600        # a plugin that failed to install is tried again after this
MAX_ZIP = 20_000_000    # a personal skill bigger than this stays where it is
REPO = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
NAME = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")
FORA = {  # plugins that never travel, and why
    "activecampaign@claude-plugins-official": "precisa do endereço da conta ActiveCampaign em cada PC; sem ele dá erro em cada janela",
}


# ------------------------------------------------------------------ what this PC has

def _json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def github_repo(source) -> str | None:
    """owner/repo of a marketplace that lives on GitHub; None for anything else (a path, another host)."""
    if not isinstance(source, dict):
        return None
    if source.get("source") == "github" and REPO.match(str(source.get("repo", ""))):
        return source["repo"]
    m = re.match(r"^https://github\.com/([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+?)(?:\.git)?/?$", str(source.get("url", "")))
    return m.group(1) if source.get("source") in ("git", "url") and m else None


def installed_plugins() -> set[str]:
    data = _json(CLAUDE / "plugins" / "installed_plugins.json", {})
    return set(data.get("plugins", {})) if isinstance(data, dict) else set()


def marketplaces() -> dict[str, str | None]:
    data = _json(CLAUDE / "plugins" / "known_marketplaces.json", {})
    return {name: github_repo(m.get("source")) for name, m in data.items() if isinstance(m, dict)} if isinstance(data, dict) else {}


def my_plugins() -> dict[str, str]:
    """{plugin@marketplace: owner/repo} of what this PC has that can travel."""
    known = marketplaces()
    out = {}
    for key in sorted(installed_plugins()):
        market = key.split("@", 1)[1] if "@" in key else ""
        if known.get(market) and key not in FORA:
            out[key] = known[market]
    return out


def _skill_hash(folder: Path) -> str:
    h = hashlib.sha1()
    for f in sorted(p for p in folder.rglob("*") if p.is_file()):
        h.update(str(f.relative_to(folder)).replace("\\", "/").encode())
        h.update(f.read_bytes())
    return h.hexdigest()[:16]


def my_skills() -> dict[str, str]:
    """{name: hash} of this person's own skills in ~/.claude/skills that can travel (not the team library's, not .privada,
    not ones that came from another PC)."""
    got = set(_json(STATE, {}).get("skills", {}))
    out = {}
    root = CLAUDE / "skills"
    for md in sorted(root.glob("*/SKILL.md")) if root.is_dir() else []:
        folder, name = md.parent, md.parent.name
        if not NAME.match(name) or name in got or (folder / ".privada").exists() or (LIBRARY / name).is_dir():
            continue
        size = sum(f.stat().st_size for f in folder.rglob("*") if f.is_file())
        if size <= MAX_ZIP:
            out[name] = _skill_hash(folder)
    return out


def pack(folder: Path) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(p for p in folder.rglob("*") if p.is_file()):
            rel = f.relative_to(folder)
            if not ({".git", "node_modules", "__pycache__"} & set(rel.parts)):
                z.write(f, str(rel).replace("\\", "/"))
    return buf.getvalue()


def unpack(data: bytes, dest: Path) -> None:
    """Into a fresh folder next to dest, then into place: a half-written skill never shows up. Paths that leave the folder
    are refused (a zip with ../ in it)."""
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        names = z.namelist()
        if "SKILL.md" not in names or sum(i.file_size for i in z.infolist()) > MAX_ZIP:
            raise ValueError("not a skill")
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = Path(tempfile.mkdtemp(prefix=f".{dest.name}-", dir=dest.parent))
        try:
            for info in z.infolist():
                target = (tmp / info.filename).resolve()
                if info.is_dir():
                    continue
                if tmp.resolve() not in target.parents:
                    raise ValueError(f"bad path {info.filename}")
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(z.read(info))
            if dest.exists():
                shutil.rmtree(dest)
            os.replace(tmp, dest)
        finally:
            if tmp.exists():
                shutil.rmtree(tmp, ignore_errors=True)


# ------------------------------------------------------------------ giving this PC what the others have

def claude_exe() -> str | None:
    """The Claude Code binary: on the PATH, or where its installer puts it (the Hub may run without the person's PATH)."""
    found = shutil.which("claude")
    if found and found.lower().endswith((".cmd", ".ps1")):
        exe = Path(found).parent / "node_modules" / "@anthropic-ai" / "claude-code" / "bin" / "claude.exe"
        found = str(exe) if exe.exists() else found
    if found:
        return found
    for p in (Path.home() / ".local" / "bin" / ("claude.exe" if sys.platform == "win32" else "claude"),):
        if p.exists():
            return str(p)
    return None


def run_install(exe: str, key: str, repo: str, known: bool) -> tuple[bool, str]:
    plugin, _, _ = key.partition("@")
    args = [exe, "plugin", "install", key if known else plugin, "--scope", "user", "--json"]
    if not known:
        args += ["--marketplace", repo]   # adds the marketplace in the user's settings first
    env = {k: v for k, v in os.environ.items() if k not in ("ANTHROPIC_API_KEY", "CLAUDECODE")}
    try:
        r = subprocess.run(args, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=900, env=env,
                           stdin=subprocess.DEVNULL, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except (OSError, subprocess.TimeoutExpired) as e:
        return False, str(e)[:300]
    lines = [l for l in (r.stdout or "").splitlines() if l.strip()]
    return r.returncode == 0, (lines[-1] if lines else (r.stderr or "").strip())[-300:]


def to_install(wanted: dict[str, str], state: dict, have: set[str], now: float) -> list[str]:
    """The plugins to install here now: wanted, not here, not kept out, not removed by the person, not failed lately."""
    failed = state.get("failed", {})
    return [k for k in sorted(wanted) if k not in have and k not in FORA and k not in state.get("removed", [])
            and now - failed.get(k, {}).get("at", 0) > RETRY]


def notice_removals(state: dict, have: set[str]) -> None:
    """A plugin this Hub installed that is gone now was removed by the person: never put it back on this PC."""
    for k in list(state.get("installed", [])):
        if k not in have:
            state["installed"].remove(k)
            state.setdefault("removed", []).append(k)


def install_round(state: dict) -> list[str]:
    have = installed_plugins()
    notice_removals(state, have)
    wanted = {**state.get("plugins", {}), **my_plugins()}
    todo = to_install(wanted, state, have, time.time())
    exe = claude_exe() if todo else None
    done = []
    for key in todo:
        if not exe:
            log.info("Claude Code not found: %d plugins of the team wait", len(todo))
            break
        known = key.split("@", 1)[1] in marketplaces()
        ok, said = run_install(exe, key, wanted[key], known)
        if ok and key in installed_plugins():
            state.setdefault("installed", []).append(key)
            state.get("failed", {}).pop(key, None)
            done.append(key)
            log.info("Plugin of the team installed here: %s", key)
        else:
            state.setdefault("failed", {})[key] = {"at": time.time(), "why": said}
            log.warning("Plugin %s not installed: %s", key, said)
    return done


def _save(state: dict) -> None:
    STATE.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATE.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(tmp, STATE)


def _url(peer: str, path: str) -> str:
    return f"http://{peer if ':' in peer else f'{peer}:{settings.sync_port}'}/api/sync/kit{path}"


async def learn(client: httpx.AsyncClient, state: dict) -> None:
    """Ask each other Hub what it has: plugins are remembered, personal skills missing here are fetched now."""
    headers = {"X-Team-Key": settings.team_key}
    for peer in sync.peers():
        try:
            r = await client.get(_url(peer, ""), headers=headers)
            if r.status_code != 200:
                continue
            theirs = r.json()
        except (httpx.HTTPError, ValueError, OSError):
            continue   # that PC is off, or its Hub is from before this existed
        for key, repo in (theirs.get("plugins") or {}).items():
            if isinstance(key, str) and "@" in key and isinstance(repo, str) and REPO.match(repo):
                state.setdefault("plugins", {})[key] = repo
        got = state.setdefault("skills", {})
        for name, h in (theirs.get("skills") or {}).items():
            if not (isinstance(name, str) and NAME.match(name) and isinstance(h, str)) or (LIBRARY / name).is_dir():
                continue
            dest = CLAUDE / "skills" / name
            if dest.exists() and not (name in got and got[name][0] != h and _skill_hash(dest) == got[name][1]):
                continue   # the person's own, or already the owner's latest, or changed here since it came
            try:
                z = await client.get(_url(peer, f"/skill/{name}"), headers=headers)
                if z.status_code == 200:
                    await asyncio.to_thread(unpack, z.content, dest)
                    got[name] = [h, await asyncio.to_thread(_skill_hash, dest)]   # [the owner's, this copy's]
                    log.info("Skill of %s copied here: %s", peer, name)
            except (httpx.HTTPError, ValueError, OSError, zipfile.BadZipFile) as e:
                log.warning("Skill %s from %s not copied: %s", name, peer, e)


async def round_once() -> None:
    state = _json(STATE, {})
    if not isinstance(state, dict):
        state = {}
    async with httpx.AsyncClient(timeout=httpx.Timeout(60, connect=3)) as client:
        await learn(client, state)
    await asyncio.to_thread(install_round, state)
    _save(state)


async def loop():
    await asyncio.sleep(60)   # the Hub first, then this
    while True:
        try:
            await round_once()
        except Exception:
            log.exception("Claude kit round failed")
        await asyncio.sleep(EVERY)


# ------------------------------------------------------------------ what this PC gives the others

router = APIRouter(prefix="/api/sync/kit")


def _team_only(request: Request) -> None:
    host = request.client.host if request.client else ""
    key = request.headers.get("x-team-key", "")
    team = [ip for ip, _ in sync.team_ips()]
    if host not in team and host not in ("127.0.0.1", "::1") and not (
            settings.team_key and hmac.compare_digest(key.encode(), settings.team_key.encode())):
        raise HTTPException(403, "Only the team's computers")


@router.get("")
async def what_i_have(request: Request):
    _team_only(request)
    if not settings.claude_kit:
        raise HTTPException(404, "Off on this PC")
    plugins, skills = await asyncio.to_thread(my_plugins), await asyncio.to_thread(my_skills)
    return {"plugins": plugins, "skills": skills}


@router.get("/skill/{name}")
async def one_skill(name: str, request: Request):
    _team_only(request)
    if not settings.claude_kit or not NAME.match(name) or name not in await asyncio.to_thread(my_skills):
        raise HTTPException(404, "Not shared here")
    data = await asyncio.to_thread(pack, CLAUDE / "skills" / name)
    return Response(data, media_type="application/zip")
