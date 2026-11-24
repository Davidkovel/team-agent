"""O Cérebro (24 Nov, Marco: «o widget é o cérebro principal, tipo um Jarvis... olho para ele e vejo tudo»).

One place that shows everything the company's AIs are doing and takes every request:
- GET  /api/cerebro        every Claude window of the team (the whole request, its trail of steps, the subagents, the
                           skills, the other AIs it reaches) and ChatGPT's conversations on this PC (codex_watch).
- POST /api/cerebro/plan   what the brain would do with a request, said while it is typed: what kind of work, which
                           department, which AI is best for it and why, which model, which skills of the library.
- POST /api/cerebro/send   do it: a Claude Code window opens on this PC with the brain's prompt (and you watch it work
                           in the Cérebro), or ChatGPT answers (read-only), or both at once. A task for the office goes
                           through the usual POST /api/tasks.
Nothing here holds a database transaction while it waits: the plan is words, the send starts a process and returns.
"""
import json
import os
import platform
import re
import shutil
import subprocess
import time
import uuid
from pathlib import Path

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import codex_watch, crew
from ..db import get_db
from ..models import User
from ..security import current_user
from .auth import ip_map
from .local import only_local
from . import office as office_router

router = APIRouter(prefix="/api")

REPO = Path(__file__).resolve().parents[3]
PROMPTS = Path.home() / ".team-agent" / "cerebro"

# What kind of work a request is, by its words (pt, en, ru), the first that matches wins. For each: which AI does it best
# and why, the model of Claude, and the department of the office. Keep the reasons short: they are shown as they are.
KINDS = [
    ("video", r"v[ií]deo|reel|tiktok|anima[cç]|clip|short|montagem|видео|рилс",
     "Vídeo", [("Higgsfield", "gera o vídeo e as imagens (Kling, Veo, Seedance)"), ("Claude Code", "guião, cortes e a montagem com ffmpeg")],
     "opus", "catwoman"),
    ("image", r"logo|log[oó]tipo|imagem|foto|banner|poster|capa|thumbnail|ilustra|desenho|estampa|mockup|картин|логотип",
     "Imagem", [("Higgsfield", "a melhor geração de imagens (GPT Image, Nano Banana, Flux)"), ("Canva", "posts, peças da marca e tamanhos prontos"),
                ("Claude Code", "escolhe o estilo, escreve os prompts e confere o resultado")], "opus", "catwoman"),
    ("design", r"design|ui\b|ux\b|layout|ecr[ãa]|visual|bonit|cores|tipografia|marca|branding|дизайн",
     "Design", [("Claude Code", "Opus com as skills de design (frontend-design, impeccable, ui-ux-pro-max)"),
                ("Higgsfield", "imagens e texturas quando o desenho precisa"), ("ChatGPT", "segunda opinião sobre o aspeto")], "opus", "catwoman"),
    ("site", r"\bsite|landing|p[aá]gina web|website|loja online|shopify|сайт",
     "Site", [("Claude Code", "constrói e testa o site (skills site-scroll-infinito, build-awwwards-quality-sites)"),
              ("Higgsfield", "as imagens e os vídeos do site")], "opus", "batman"),
    ("code", r"c[oó]digo|bug|erro|script|api|backend|frontend|widget|hub|escrit[oó]rio|app\b|programa|corrig|код|ошибк",
     "Código", [("Claude Code", "Opus: lê o repositório, muda, testa e faz push"), ("ChatGPT", "revisão independente do código")], "opus", "batman"),
    ("research", r"pesquis|procura|encontra|compara|lista de|leads|concorr|mercado|estudo|investiga|найди|исслед",
     "Pesquisa", [("Claude Code", "subagentes Haiku em paralelo com WebSearch"), ("Firecrawl", "lê sites inteiros"),
                  ("Perplexity", "respostas com fontes")], "sonnet", "riddler"),
    ("marketing", r"e-?mail|copy|texto|an[uú]ncio|campanha|instagram|legenda|post\b|marketing|venda|cliente|реклам",
     "Marketing", [("Claude Code", "Sonnet com as skills de copy e marketing da biblioteca"), ("Canva", "a peça pronta a publicar")],
     "sonnet", "joker"),
    ("trading", r"memecoin|trading|forex|cripto|crypto|ouro|xau|a[cç][oõ]es|fundednext|trade|трейд",
     "Trading", [("Claude Code", "lê os cérebros do Hub (Memecoins, Sala de Trading) e decide"), ("Web", "notícias e preços ao minuto")],
     "opus", "penguin"),
    ("opinion", r"chatgpt|\bgpt|codex|openai|segunda opini|outra ia|compara as ias",
     "Segunda opinião", [("ChatGPT", "responde sozinho, só a ler"), ("Claude Code", "junta as duas respostas")], "opus", "alfred"),
]
COMPILED = [(k, re.compile(w, re.I), label, engines, model, who) for k, w, label, engines, model, who in KINDS]
HUB_WORDS = re.compile(r"widget|hub|escrit[oó]rio|team-agent|c[eé]rebro|farol|cave|empresa amg", re.I)


def _skills(prompt: str) -> list[dict]:
    """The library skills that fit, chosen the same way as for every Claude window (scripts/claude_contexto.py)."""
    try:
        from .skills import _ctx
        ctx = _ctx()
        index = ctx.index()
        return [{"name": n, "about": index[n]["about"][:160]} for n in ctx.offer(prompt, index)]
    except Exception:   # the library is a bonus: never fail a plan for it
        return []


def plan(prompt: str) -> dict:
    text = " ".join(prompt.split())
    hits = [(k, label, engines, model, who) for k, rx, label, engines, model, who in COMPILED if rx.search(text)]
    if not hits:
        hits = [("general", "Geral", [("Claude Code", "Opus: o melhor para pensar e fazer")], "opus", crew.sector_of(text))]
    kind, label, engines, model, who = hits[0]
    seen, merged = set(), []
    for _, _, more, _, _ in hits[:2]:   # a «vídeo para o site» gets the engines of both, the first kind leads
        for name, why in more:
            if name not in seen:
                seen.add(name)
                merged.append({"name": name, "why": why, "ready": name != "ChatGPT" or bool(codex_watch.cli())})
    target = "chatgpt" if kind == "opinion" and codex_watch.cli() else "claude"
    folder = REPO if HUB_WORDS.search(text) else Path.home()
    return {"kind": kind, "label": label, "also": [h[1] for h in hits[1:3]], "engines": merged, "model": model,
            "crew": who, "department": crew.CREW.get(who, {}).get("name", "Operações"), "skills": _skills(text),
            "target": target, "folder": str(folder), "chatgpt": bool(codex_watch.cli())}


def brain_prompt(prompt: str, p: dict) -> str:
    """What the Claude window receives: the request as written, then what the brain decided, in a few lines."""
    lines = [prompt.strip(), "", "— Cérebro AMG —", f"Tipo de trabalho: {p['label']} · Departamento: {p['department']} · Modelo: {p['model'].title()}"]
    others = [e for e in p["engines"] if e["name"] != "Claude Code"]
    if others:
        lines.append("Usa também: " + "; ".join(f"{e['name']} ({e['why']})" for e in others))
    if p["skills"]:
        lines.append("Skills da biblioteca para ler antes de começar: " + ", ".join(
            str(REPO / "library" / "skills" / s["name"] / "SKILL.md") for s in p["skills"][:4]))
    lines.append("Mostra o trabalho à medida (o Cérebro está a ver os teus passos) e no fim diz em 3 linhas o que fizeste.")
    return "\n".join(lines)


def _claude() -> str:
    for c in (shutil.which("claude"), str(Path.home() / ".local/bin/claude"), "/opt/homebrew/bin/claude", "/usr/local/bin/claude"):
        if c and os.access(c, os.X_OK):
            return c
    return ""


def open_claude(prompt: str, folder: str, job: str) -> dict:
    """A Claude Code window opens on this PC with the prompt: the hooks show its every step in the Cérebro."""
    exe = _claude()
    if not exe:
        return {"ok": False, "error": "O Claude Code não está instalado neste computador."}
    PROMPTS.mkdir(parents=True, exist_ok=True)
    file = PROMPTS / f"{job}.txt"
    file.write_text(prompt, encoding="utf-8")
    if platform.system() == "Darwin":
        import shlex
        line = f"cd {shlex.quote(folder)} && {shlex.quote(exe)} \"$(cat {shlex.quote(str(file))})\""
        script = 'on run argv\ntell application "Terminal"\nactivate\ndo script (item 1 of argv)\nend tell\nend run'
        subprocess.Popen(["/usr/bin/osascript", "-e", script, line], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    elif platform.system() == "Windows":
        subprocess.Popen([exe, prompt], cwd=folder, creationflags=getattr(subprocess, "CREATE_NEW_CONSOLE", 0))
    else:
        return {"ok": False, "error": "Abrir uma janela do Claude só no Mac e no Windows."}
    return {"ok": True}


async def _owner_login() -> str:
    return (ip_map().get("127.0.0.1") or "").lower()


@router.get("/cerebro")
async def cerebro(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    office = await office_router.office(user=user, db=db)
    people = [{"user": u.username, "name": u.display_name} for u in (await db.execute(select(User).order_by(User.id))).scalars()]
    await db.commit()   # nothing more from the database: let the lock go before reading files
    here = user.username.lower() == await _owner_login()
    return {"now": round(time.time()), "people": people, "sessions": office["sessions"], "film": office["film"],
            "chatgpt": codex_watch.threads() if here else [], "asks": codex_watch.jobs() if here else [],
            "chatgpt_ready": bool(codex_watch.cli()) if here else False, "here": here}


@router.post("/cerebro/plan")
async def cerebro_plan(body: dict = Body(...), user: User = Depends(current_user)):
    prompt = str(body.get("prompt") or "")[:4000]
    if len(prompt.strip()) < 3:
        return {"kind": "", "engines": [], "skills": []}
    p = plan(prompt)
    p["prompt"] = brain_prompt(prompt, p)
    return p


@router.post("/cerebro/send", dependencies=[Depends(only_local)])
async def cerebro_send(body: dict = Body(...), user: User = Depends(current_user)):
    """`to`: claude (a window opens here), chatgpt (it answers, read-only) or both."""
    prompt = str(body.get("prompt") or "").strip()[:4000]
    to = str(body.get("to") or "auto")
    if len(prompt) < 3:
        raise HTTPException(422, "Escreve o que queres")
    if user.username.lower() != await _owner_login():
        raise HTTPException(403, "Só a pessoa deste computador abre janelas nele")
    p = plan(prompt)
    if to == "auto":
        to = p["target"]
    job = time.strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:6]
    out = {"plan": {k: p[k] for k in ("label", "department", "model", "engines")}, "to": to}
    if to in ("claude", "both"):
        folder = Path(str(body.get("folder") or p["folder"])).expanduser()
        out["claude"] = open_claude(brain_prompt(prompt, p), str(folder if folder.is_dir() else Path.home()), job)
    if to in ("chatgpt", "both"):
        out["chatgpt"] = codex_watch.ask(prompt, job)
    if not (out.get("claude") or out.get("chatgpt")):
        raise HTTPException(422, "Destino desconhecido")
    return out
