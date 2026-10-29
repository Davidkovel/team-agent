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

**Off unless the person whose PC it is turns it on**: in the Hub, Trabalho › Kit do Claude (only the PC's own person can
press it, by the VPN address of the PC; 16 Oct, Marco: «adicionar isso também lá no widget, na zona de trabalho»), or
CLAUDE_KIT=1 in that PC's backend/.env. It installs other people's plugins and skills on the PC, so each partner decides
for their own. Off, the Hub neither installs nor serves anything. The same page shows every PC: on or off, and which
plugins and skills each one has.
"""
import asyncio
import hashlib
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
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel

from . import sync
from .config import settings
from .models import User
from .routers.trading import viewer

log = logging.getLogger("team.kit")

CLAUDE = Path.home() / ".claude"
STATE = Path.home() / ".team-agent" / "claude-kit.json"
SWITCH = Path.home() / ".team-agent" / "claude-kit-on.json"   # {"on": bool, "by", "at"}: the button in the Hub
LIBRARY = Path(__file__).resolve().parents[2] / "library" / "skills"
EVERY = 1800            # seconds between rounds; the first one a minute after the Hub starts
RETRY = 6 * 3600        # a plugin that failed to install is tried again after this
MAX_ZIP = 20_000_000    # a personal skill bigger than this stays where it is
REPO = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
NAME = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")
FORA = {  # plugins that never travel, and why
    "activecampaign@claude-plugins-official": "precisa do endereço da conta ActiveCampaign em cada PC; sem ele dá erro em cada janela",
}
SOBRE = {  # what each plugin is for, in a line the team reads (the page); one not here shows its own description
    "superpowers": "Método de trabalho: planear, testar, encontrar erros e rever código",
    "claude-seo": "SEO: auditar sites, palavras-chave, SEO local e técnico",
    "claude-ads": "Anúncios: Google, Meta, TikTok, YouTube e outros, da auditoria ao plano",
    "marketing": "Marketing: campanhas, conteúdos, voz da marca e resultados",
    "shopify-ai-toolkit": "Shopify: lojas, temas e apps",
    "adobe-for-creativity": "Adobe: imagens, vetores, design e vídeo",
    "figma": "Figma: ler e fazer designs",
    "document-skills": "Documentos: Word, Excel, PowerPoint e PDF",
    "example-skills": "Skills da Anthropic: design, arte, criar skills e servidores MCP",
    "customer-support": "Apoio ao cliente: triar pedidos, respostas e base de conhecimento",
    "operations": "Operações: processos, fornecedores e relatórios",
    "productivity": "Produtividade: tarefas, o plano do dia e a memória do trabalho",
    "activecampaign": "ActiveCampaign: contactos, campanhas e e-mail marketing",
    "caveman": "Respostas curtas do Claude: desligado até escreveres /caveman",
    "context-mode": "Poupa contexto: os resultados grandes das ferramentas ficam fora da conversa",
    "watch": "Vídeo: o Claude vê um vídeo do YouTube ou do PC (imagens e legendas)",
    "claude-mem": "Memória entre sessões: o que o Claude fez fica guardado e volta na sessão seguinte",
    "task-observer": "Aprende como trabalhas e propõe skills novas ou melhores",
    "security-sweep": "Segurança: procura chaves expostas e falhas no código (/security-sweep)",
    "frontend-design": "Sites: interfaces com design a sério, nada de cara de template (Anthropic)",
    "ui-ux-pro-max": "Sites: base de estilos, paletas, fontes e regras de UX para escolher o design certo",
    "playwright": "Browser a sério: abrir sites, clicar, preencher, tirar prints e testar (Microsoft)",
    "context7": "Documentação sempre atual de qualquer biblioteca enquanto programa",
    "feature-dev": "Construir uma funcionalidade nova com agentes: explorar, desenhar, fazer e rever (/feature-dev)",
    "code-review": "Revisão do código por vários agentes antes de enviar (/code-review)",
    "ralph-loop": "O Claude continua a trabalhar sozinho em ciclo até a tarefa estar acabada (/ralph-loop)",
}
_wake: asyncio.Event | None = None   # set by the button: a round now instead of in 30 min
_busy = False


def enabled() -> bool:
    """On when the PC's person pressed «Ligar» in the Hub; without a press, what CLAUDE_KIT says."""
    switch = _json(SWITCH, {})
    return bool(switch["on"]) if isinstance(switch, dict) and "on" in switch else settings.claude_kit


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


def caveman_off() -> None:
    """Caveman starts on in every window by itself (short answers, also in the Etsy listings); on the team's PCs it waits
    for /caveman, like on Marco's (21 Oct). A config the person already has is left as it is."""
    if os.environ.get("XDG_CONFIG_HOME"):
        folder = Path(os.environ["XDG_CONFIG_HOME"]) / "caveman"
    elif sys.platform == "win32":
        folder = Path(os.environ.get("APPDATA") or Path.home() / "AppData" / "Roaming") / "caveman"
    else:
        folder = Path.home() / ".config" / "caveman"
    if not (folder / "config.json").exists():
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "config.json").write_text('{\n  "defaultMode": "manual"\n}\n', encoding="utf-8")


def run_install(exe: str, key: str, repo: str, known: bool) -> tuple[bool, str]:
    plugin, _, _ = key.partition("@")
    args = [exe, "plugin", "install", key if known else plugin, "--scope", "user", "--json"]
    if not known:
        args += ["--marketplace", repo]   # adds the marketplace in the user's settings first
    env = {k: v for k, v in os.environ.items() if k not in ("ANTHROPIC_API_KEY", "CLAUDECODE")}
    env.setdefault("CLAUDE_CODE_PLUGIN_GIT_TIMEOUT_MS", "600000")   # claude-mem's repository takes more than the 2 min default
    if plugin == "caveman":
        caveman_off()
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
        if not enabled():
            break   # turned off in the middle of the round
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
    return f"{sync._base(peer)}/api/sync/kit{path}"


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
    global _busy
    state = _json(STATE, {})
    if not isinstance(state, dict):
        state = {}
    _busy = True
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(60, connect=3)) as client:
            await learn(client, state)
        await asyncio.to_thread(install_round, state)
    finally:
        _busy = False
    state["at"] = time.time()
    _save(state)


async def _nap(seconds: float) -> None:
    try:
        await asyncio.wait_for(_wake.wait(), seconds)
    except asyncio.TimeoutError:
        pass


async def loop():
    """Every Hub of a PC runs it; it does nothing while the kit is off there."""
    global _wake
    _wake = asyncio.Event()
    await _nap(60)   # the Hub first, then this (at once if somebody presses «Ligar»)
    while True:
        _wake.clear()
        if enabled():
            try:
                await round_once()
            except Exception:
                log.exception("Claude kit round failed")
        await _nap(EVERY)


# ------------------------------------------------------------------ what this PC gives the others

router = APIRouter(prefix="/api/sync/kit")


def _team_only(request: Request) -> None:
    """The team's computers (sync.team_only), and this computer itself, but never what came through the Funnel: there the
    Mac's own proxy is the 127.0.0.1 the request seems to come from."""
    host = request.client.host if request.client else ""
    if host in ("127.0.0.1", "::1") and not request.headers.get("tailscale-funnel-request"):
        return
    sync.team_only(request)


@router.get("")
async def what_i_have(request: Request):
    _team_only(request)
    if not enabled():
        return {"on": False}   # off here: nothing to give, and the others' page says so
    plugins, skills = await asyncio.to_thread(my_plugins), await asyncio.to_thread(my_skills)
    return {"on": True, "plugins": plugins, "skills": skills}


@router.get("/skill/{name}")
async def one_skill(name: str, request: Request):
    _team_only(request)
    if not enabled() or not NAME.match(name) or name not in await asyncio.to_thread(my_skills):
        raise HTTPException(404, "Not shared here")
    data = await asyncio.to_thread(pack, CLAUDE / "skills" / name)
    return Response(data, media_type="application/zip")


# ------------------------------------------------------------------ the page: Trabalho › Kit do Claude

panel = APIRouter(prefix="/api/kit")


def about(key: str) -> str:
    name = key.split("@", 1)[0]
    if name in SOBRE:
        return SOBRE[name]
    found = _json(CLAUDE / "plugins" / "installed_plugins.json", {}).get("plugins", {}).get(key) or [{}]
    path = Path(found[0].get("installPath", "") or ".") / ".claude-plugin" / "plugin.json"
    return str(_json(path, {}).get("description", ""))[:160] if found[0].get("installPath") else ""


def here_status() -> dict:
    """This PC: on or off, the plugins it gives, the ones waiting to be installed here, what failed and why, the skills."""
    state = _json(STATE, {})
    state = state if isinstance(state, dict) else {}
    have, on = installed_plugins(), enabled()
    wanted = {**state.get("plugins", {}), **my_plugins()}
    failed = state.get("failed", {})
    return {"on": on, "busy": _busy, "at": state.get("at"), "claude": bool(claude_exe()),
            "plugins": sorted(k for k in have if k in wanted or k in FORA),
            "waiting": to_install(wanted, state, have, time.time()) if on else [],
            "failed": {k: str(v.get("why", ""))[:200] for k, v in failed.items() if k not in have and isinstance(v, dict)},
            "removed": [k for k in state.get("removed", []) if k not in have],
            "skills": sorted(my_skills()),
            "came": sorted(n for n in state.get("skills", {}) if (CLAUDE / "skills" / n / "SKILL.md").exists()),
            "known": sorted(wanted)}


async def _peer(client: httpx.AsyncClient, peer: str) -> dict:
    who = dict(sync.team_ips()).get(peer.split(":")[0], peer)
    try:
        r = await client.get(_url(peer, ""), headers={"X-Team-Key": settings.team_key})
        theirs = r.json() if r.status_code == 200 else {}
    except (httpx.HTTPError, ValueError, OSError):
        return {"who": who, "state": "down"}   # the PC or its Hub is off
    if not isinstance(theirs, dict) or not theirs.get("on", "plugins" in theirs):
        return {"who": who, "state": "off"}    # a Hub from before the button answers 404 when off
    return {"who": who, "state": "on", "plugins": sorted(k for k in (theirs.get("plugins") or {}) if isinstance(k, str)),
            "skills": sorted(k for k in (theirs.get("skills") or {}) if isinstance(k, str))}


def _owner(request: Request, user: User) -> bool:
    """Only the person whose PC it is: their login is the one of this PC's VPN address (sync.whoami). Without the VPN,
    only the widget on the PC itself."""
    me = sync.whoami()
    if me:
        return me[1] == user.username
    return (request.client.host if request.client else "") in ("127.0.0.1", "::1")


@panel.get("")
async def status(request: Request, user: User = Depends(viewer)):
    me = sync.whoami()
    async with httpx.AsyncClient(timeout=httpx.Timeout(4, connect=2)) as client:
        others = await asyncio.gather(*(_peer(client, p) for p in sync.peers()))
    here = await asyncio.to_thread(here_status)
    keys = set(here["plugins"]) | set(here["known"]) | set(FORA) | {k for p in others for k in p.get("plugins", [])}
    return {"here": {**here, "who": me[1] if me else user.username, "can": _owner(request, user)}, "peers": others,
            "about": {k: about(k) for k in sorted(keys)}, "fora": FORA}


class Switch(BaseModel):
    on: bool


@panel.post("")
async def switch(body: Switch, request: Request, user: User = Depends(viewer)):
    if not _owner(request, user):
        raise HTTPException(403, "Só a pessoa deste PC liga ou desliga o kit nele")
    SWITCH.parent.mkdir(parents=True, exist_ok=True)
    SWITCH.write_text(json.dumps({"on": body.on, "by": user.username, "at": time.time()}), encoding="utf-8")
    log.info("Claude kit turned %s here by %s", "on" if body.on else "off", user.username)
    if body.on and _wake:
        _wake.set()
    return await status(request, user)
