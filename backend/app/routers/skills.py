"""A biblioteca de skills da Empresa AMG (#/skills), pedida pelo Marco a 14 out: «buscar as skills e colocar todas aí,
que vocês dominem todas e que fiquem no widget, fácil para cada agente usar o que for preciso».

The company's skills are files in git, `library/skills/<name>/SKILL.md` (plus whatever files the skill brings), so they
travel to every PC by commit like the rest of the library. `library/skills/agentes.json` says which crew member masters
each one ({"skill": ["batman", ...]}). The automatic agent reads the same folder with its `skills` tool
(agent/team_agent/tools/skills_tool.py): the briefing tells each crew member their own skills and they read one before
doing the work it covers.

Skills come in three ways: from GitHub (a repository, a folder or a SKILL.md: every SKILL.md found is brought in), from
this PC (the person's own ~/.claude/skills and the plugins' skills) and by hand in the repository. Each change is
committed and pushed in the background (only library/skills), so the other PCs get it at their next pull.

The repository is public, so a skill from this PC comes with its licence: one whose licence says it is closed
(proprietary, all rights reserved: Anthropic's docx/pdf/pptx/xlsx) stays out, and the licence file of an open one (MIT,
Apache) travels with it when it lives in the plugin's folder. `library/skills/origens.json` says where each came from.
Every Claude window on every PC is shown the library by scripts/claude_contexto.py (hooks put in by claude_hooks.py).
"""
from __future__ import annotations

import asyncio
import json
import re
import shutil
import subprocess
import time
from pathlib import Path

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .. import commits
from ..models import User
from .office import _about, skill_folders
from .trading import viewer

router = APIRouter(prefix="/api/skills")

REPO = Path(__file__).resolve().parents[3]
LIB = REPO / "library" / "skills"
OWNERS = LIB / "agentes.json"
ORIGINS = LIB / "origens.json"
PLUGINS = Path.home() / ".claude" / "plugins"
CREW = ["batman", "lucius", "riddler", "catwoman", "joker", "alfred", "robin", "gordon", "penguin", "twoface"]
MAX_FILES, MAX_BYTES, MAX_SKILLS = 60, 3_000_000, 80   # per skill and per import: never a whole repository of binaries
GOOD = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")
BIG_FILE = 1_500_000   # a bigger file stays behind (fonts, sample decks): the skill's words and scripts come


def _slug(name: str) -> str:
    s = re.sub(r"[^a-z0-9._-]+", "-", name.lower()).strip("-.")
    return s[:64]


def _owners() -> dict[str, list[str]]:
    try:
        return json.loads(OWNERS.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _save_owners(data: dict) -> None:
    LIB.mkdir(parents=True, exist_ok=True)
    OWNERS.write_text(json.dumps(dict(sorted(data.items())), ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def _origins() -> dict[str, dict]:
    try:
        return json.loads(ORIGINS.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _save_origins(data: dict) -> None:
    LIB.mkdir(parents=True, exist_ok=True)
    ORIGINS.write_text(json.dumps(dict(sorted(data.items())), ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


LICENCE_FILES = ("LICENSE", "LICENSE.txt", "LICENSE.md", "LICENCE", "license.txt")
OPEN = re.compile(r"MIT License|Permission is hereby granted|Apache License|\bApache-2\.0\b|\bMIT\b|BSD|ISC License|"
                  r"Unlicense|CC0|Creative Commons Attribution", re.I)
CLOSED = re.compile(r"proprietary|all rights reserved", re.I)


def _licence(folder: Path) -> tuple[str, Path | None]:
    """("open" | "closed" | "", the licence file) of a skill: its frontmatter `license:` or the first licence file in its
    folder or up to four folders above (a plugin's, a marketplace's)."""
    try:
        head = (folder / "SKILL.md").read_text(encoding="utf-8", errors="replace")[:4000]
    except OSError:
        head = ""
    said = re.search(r"^license:\s*(.+)$", head, re.M)
    for place in [folder, *list(folder.parents)[:4]]:
        for name in LICENCE_FILES:
            f = place / name
            if f.is_file():
                text = f.read_text(encoding="utf-8", errors="replace")[:3000]
                kind = "closed" if CLOSED.search(text) else "open" if OPEN.search(text) else ""
                return (kind or ("closed" if said and CLOSED.search(said.group(1)) else "")), f
    if said:
        return ("closed" if CLOSED.search(said.group(1)) else "open" if OPEN.search(said.group(1)) else ""), None
    return "", None


def _guess_crew(name: str, about: str) -> list[str]:
    """Who should master a skill just brought in, from its name and description (the same sectors as crew-board.js)."""
    text = f"{name} {about}".lower()
    rules = [("catwoman", r"design|front-?end|figma|canva|css|ui\b|image|photo|video|font|slides|pptx|motion|brand"),
             ("riddler", r"research|pesquis|search|scrap|web|compet"),
             ("robin", r"test|tdd|verif|debug|qa\b"),
             ("alfred", r"review|revis|security|audit|simplif"),
             ("joker", r"marketing|social|campaign|content|seo|email|copy|ads?\b|instagram|tiktok"),
             ("gordon", r"plan|brainstorm|schedul|project|docs?\b|pdf|xlsx|docx|notion|meeting"),
             ("lucius", r"claude|mcp|plugin|skill|tool|config|api\b|agent"),
             ("penguin", r"news|macro|econom|forex|trading"),
             ("twoface", r"chart|smc|technical|backtest|trade")]
    found = [crew for crew, rx in rules if re.search(rx, text)]
    return found[:2] or ["batman"]


def _scan(folder: Path, where: str, kind: str, out: dict) -> None:
    try:
        found = sorted(folder.glob("*/SKILL.md"))
    except OSError:
        return
    for md in found:
        name = _slug(md.parent.name)
        if name and name not in out:
            out[name] = {"about": _about(md), "where": where, "kind": kind, "path": str(md.parent)}


_found: tuple[float, dict] = (0.0, {})


def _local_skills() -> dict[str, dict]:
    """The skills on this PC outside the library, by name. kind "pc": installed and in use (the person's own
    ~/.claude/skills, the installed plugins, claude.ai's synced ones, the team repositories'); kind "loja": in the catalogs
    of the plugin marketplaces this Claude Code knows, ready to be brought in. Read at most once a minute."""
    global _found
    if time.time() - _found[0] < 60:
        return _found[1]
    out: dict[str, dict] = {}
    _scan(Path.home() / ".claude" / "skills", "As tuas skills", "pc", out)
    try:
        installed = json.loads((PLUGINS / "installed_plugins.json").read_text(encoding="utf-8")).get("plugins", {})
    except (OSError, ValueError):
        installed = {}
    for key, entries in sorted(installed.items()):
        for e in entries if isinstance(entries, list) else [entries]:
            if isinstance(e, dict) and e.get("installPath"):
                _scan(Path(e["installPath"]) / "skills", f"Plugin {key.split('@')[0]}", "pc", out)
    for root in sorted((PLUGINS / "synced").glob("*/*")) if (PLUGINS / "synced").is_dir() else []:
        if root.is_dir():
            _scan(root / "skills", "Claude.ai", "pc", out)
    for name, s in skill_folders().items():   # the team repositories' .claude/skills (office.py reads them)
        if name not in out and s.get("where") not in ("pessoal", None):
            for repo in commits.repos():
                path = commits._local_path(repo)
                if path and repo["name"] == s["where"] and (Path(path) / ".claude" / "skills" / name / "SKILL.md").is_file():
                    out[name] = {"about": s["about"], "where": f"Repositório {repo['name']}", "kind": "pc",
                                 "path": str(Path(path) / ".claude" / "skills" / name)}
    market = PLUGINS / "marketplaces"
    for shop in sorted(market.iterdir()) if market.is_dir() else []:
        try:
            found = sorted(shop.glob("**/skills/*/SKILL.md"))
        except OSError:
            continue
        for md in found:
            name = _slug(md.parent.name)
            if not name or name in out:
                continue
            rel = md.relative_to(shop).parts
            group = rel[-4] if len(rel) >= 4 else shop.name   # <plugin>/skills/<name>/SKILL.md: the plugin it comes with
            out[name] = {"about": _about(md), "where": f"{shop.name} · {group}" if group != shop.name else shop.name,
                         "kind": "loja", "path": str(md.parent)}
    _found = (time.time(), out)
    return out


def _library() -> dict[str, dict]:
    out = {}
    try:
        found = sorted(LIB.glob("*/SKILL.md"))
    except OSError:
        found = []
    for md in found:
        out[md.parent.name] = {"about": _about(md), "files": sum(1 for p in md.parent.rglob("*") if p.is_file())}
    return out


def _push(message: str) -> None:
    """Commit library/skills and send it, without touching anything else the person has in progress."""
    def git(*args):
        return subprocess.run(["git", *args], cwd=REPO, capture_output=True, text=True, timeout=90,
                              creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    git("add", "--", "library/skills")
    if git("diff", "--cached", "--quiet", "--", "library/skills").returncode == 0:
        return
    git("commit", "-m", message, "--", "library/skills")
    git("pull", "--rebase", "--autostash")
    git("push")


def _push_later(message: str) -> None:
    asyncio.get_running_loop().run_in_executor(None, _push, message)


@router.get("")
async def list_skills(user: User = Depends(viewer)):
    lib, local = await asyncio.to_thread(_library), await asyncio.to_thread(_local_skills)
    owners = _owners()
    skills = [{"name": n, "about": s["about"], "files": s["files"], "crew": owners.get(n, []), "kind": "lib"} for n, s in lib.items()]
    skills += [{"name": n, "about": s["about"], "where": s["where"], "kind": s["kind"]} for n, s in sorted(local.items()) if n not in lib]
    return {"skills": skills, "crew": CREW}


@router.get("/{name}")
async def read_skill(name: str, user: User = Depends(viewer)):
    md = LIB / name / "SKILL.md"
    if not GOOD.match(name) or not md.is_file():
        local = _local_skills().get(name)
        if not local:
            raise HTTPException(404, "Essa skill não existe aqui.")
        md = Path(local["path"]) / "SKILL.md"
    files = sorted(str(p.relative_to(md.parent)).replace("\\", "/") for p in md.parent.rglob("*") if p.is_file())
    return {"name": name, "text": md.read_text(encoding="utf-8", errors="replace")[:60000], "files": files[:80]}


class Crew(BaseModel):
    crew: list[str]


@router.put("/{name}/crew")
async def set_crew(name: str, body: Crew, user: User = Depends(viewer)):
    if not (LIB / name / "SKILL.md").is_file():
        raise HTTPException(404, "Essa skill não está na biblioteca.")
    owners = _owners()
    owners[name] = [c for c in CREW if c in body.crew]
    _save_owners(owners)
    _push_later(f"Skills: {name} passa a ser de {', '.join(owners[name]) or 'ninguém'} ({user.display_name})")
    return {"ok": True, "crew": owners[name]}


@router.delete("/{name}")
async def remove_skill(name: str, user: User = Depends(viewer)):
    folder = LIB / name
    if not GOOD.match(name) or not folder.is_dir():
        raise HTTPException(404, "Essa skill não está na biblioteca.")
    shutil.rmtree(folder)
    owners = _owners()
    owners.pop(name, None)
    _save_owners(owners)
    _push_later(f"Skills: tirada {name} ({user.display_name})")
    return {"ok": True}


def _copy(src: Path, dest: Path) -> None:
    skip = {".git", "node_modules", "__pycache__", ".venv"}
    total = 0
    for f in sorted(src.rglob("*")):
        rel = f.relative_to(src)
        if not f.is_file() or skip & set(rel.parts) or f.suffix == ".pyc":
            continue
        size = f.stat().st_size
        if size > BIG_FILE or total + size > MAX_BYTES:
            continue
        total += size
        (dest / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(f, dest / rel)


def _adopt(names: list[str]) -> list[str]:
    local, owners, origins, done = _local_skills(), _owners(), _origins(), []
    for name in names:
        s = local.get(name)
        if not s or not GOOD.match(name) or (LIB / name).exists():
            continue
        src = Path(s["path"])
        kind, licence = _licence(src)
        if kind == "closed":   # the repository is public: a closed skill stays installed where it is, never copied
            continue
        _copy(src, LIB / name)
        if (LIB / name / "SKILL.md").is_file():
            if licence and licence.parent != src and not any((LIB / name / f).exists() for f in LICENCE_FILES):
                shutil.copyfile(licence, LIB / name / "LICENSE.txt")   # MIT and Apache travel with their text
            owners.setdefault(name, _guess_crew(name, s["about"]))
            origins.setdefault(name, {"de": s["where"], "licenca": {"open": "aberta", "": "não indicada"}[kind]})
            done.append(name)
    _save_owners(owners)
    _save_origins(origins)
    return done


class Names(BaseModel):
    names: list[str] = []
    all: bool = False


@router.post("/adopt")
async def adopt(body: Names, user: User = Depends(viewer)):
    """Bring skills of this PC (the person's own, the plugins') into the company's library."""
    names = [n for n, s in (await asyncio.to_thread(_local_skills)).items() if s["kind"] == "pc"] if body.all else body.names
    done = await asyncio.to_thread(_adopt, names)
    if done:
        _push_later(f"Skills: {len(done)} trazidas do PC do {user.display_name} ({', '.join(done[:8])}{'…' if len(done) > 8 else ''})")
    return {"added": done}


class Source(BaseModel):
    url: str


GH = re.compile(r"github\.com/([^/\s]+)/([^/\s#?]+)(?:/(?:tree|blob)/([^/\s]+)(?:/([^\s#?]*))?)?")


async def _import_github(url: str) -> list[str]:
    m = GH.search(url.strip())
    if not m:
        raise HTTPException(400, "Cola o endereço de um repositório, pasta ou SKILL.md do GitHub.")
    owner, repo, branch, path = m.group(1), m.group(2).removesuffix(".git"), m.group(3), (m.group(4) or "").strip("/")
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "agente-amg"}
    async with httpx.AsyncClient(timeout=30, follow_redirects=True, headers=headers) as http:
        if not branch:
            r = await http.get(f"https://api.github.com/repos/{owner}/{repo}")
            if r.status_code != 200:
                raise HTTPException(400, "O GitHub não encontrou esse repositório (privado ou endereço errado).")
            branch = r.json().get("default_branch") or "main"
        r = await http.get(f"https://api.github.com/repos/{owner}/{repo}/git/trees/{branch}?recursive=1")
        if r.status_code != 200:
            raise HTTPException(400, f"O GitHub não deu a lista de ficheiros ({r.status_code}).")
        tree = [x for x in r.json().get("tree", []) if x.get("type") == "blob"]
        if path.endswith(".md"):
            path = path.rsplit("/", 1)[0] if "/" in path else ""
        roots = sorted({x["path"].rsplit("/", 1)[0] if "/" in x["path"] else "" for x in tree
                        if x["path"].rsplit("/", 1)[-1] == "SKILL.md" and (not path or x["path"] == f"{path}/SKILL.md" or x["path"].startswith(path + "/"))})
        if not roots:
            raise HTTPException(400, "Não há nenhum SKILL.md nesse endereço.")
        owners, origins, added, gate = _owners(), _origins(), [], asyncio.Semaphore(8)

        async def fetch(path: str) -> bytes | None:
            async with gate:
                raw = await http.get(f"https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}")
                return raw.content if raw.status_code == 200 else None

        for root in roots[:MAX_SKILLS]:
            name = _slug(root.rsplit("/", 1)[-1] if root else repo)
            if not GOOD.match(name) or (LIB / name).exists():
                continue
            # a skill is its folder; one at the top of the repository is the files that belong to no other skill
            prefix = root + "/" if root else ""
            files = [x for x in tree if x["path"].startswith(prefix)
                     and not any(r != root and r.startswith(prefix) and x["path"].startswith(r + "/") for r in roots)]
            files = [x for x in files if x.get("size", 0) <= BIG_FILE and ".git/" not in x["path"]]
            files.sort(key=lambda x: (x["path"] != prefix + "SKILL.md", x.get("size", 0)))   # the SKILL.md first, then the smallest
            chosen, total = [], 0
            for x in files[:MAX_FILES]:
                if total + x.get("size", 0) <= MAX_BYTES:
                    chosen.append(x)
                    total += x.get("size", 0)
            datas = await asyncio.gather(*(fetch(x["path"]) for x in chosen))
            got = {x["path"][len(prefix):]: d for x, d in zip(chosen, datas) if d is not None}
            if "SKILL.md" not in got:
                continue
            for rel, data in got.items():
                dest = LIB / name / rel
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(data)
            owners.setdefault(name, _guess_crew(name, _about(LIB / name / "SKILL.md")))
            origins.setdefault(name, {"de": f"github.com/{owner}/{repo}" + (f"/{root}" if root else "")})
            added.append(name)
        _save_owners(owners)
        _save_origins(origins)
        return added


@router.post("/import")
async def import_skills(body: Source, user: User = Depends(viewer)):
    added = await _import_github(body.url)
    if added:
        _push_later(f"Skills: {len(added)} do GitHub ({body.url.strip()[:80]}) por {user.display_name}")
    return {"added": added}
