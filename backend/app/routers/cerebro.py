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

import asyncio
import logging
import sys
import tempfile

import unicodedata
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Body, Depends, HTTPException, Request
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import codex_watch, crew
from ..db import get_db
from ..db import SessionLocal
from ..models import Approval, BrainMessage, Memory, Notification, Plan, Task, User
from ..realtime import rt
from ..services import iso
from ..security import current_user, sees_all
from .auth import ip_map
from .local import only_local
from . import office as office_router
from .work import OPEN_STATUSES, TASK_STAGE, aware, visible_tasks

router = APIRouter(prefix="/api")
log = logging.getLogger("team.cerebro")

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
    state = await company(db, user)
    await db.commit()   # nothing more from the database: let the lock go before reading files
    here = user.username.lower() == await _owner_login()
    return {"now": round(time.time()), "people": people, "sessions": office["sessions"], "film": office["film"],
            "pulse": {**{k: len(state[k]) for k in ("tasks", "mine", "blocked", "late", "approvals", "plans")}, "unread": state["unread"]},
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


# ---------- the conversation (24 Nov, Marco: «um chat em que ele fica a falar com a gente... ao vivo para todos») ----------

BRAIN_MODEL = "sonnet"   # quick enough to talk; the work itself goes to the window or the AI the plan picks
HISTORY = 16   # messages of the conversation the brain rereads before each answer

# The pages of the Hub the brain can open with a button (24 Nov, David: «unido com o resto das coisas do widget»).
PAGES = {"home": "Início", "tarefas": "Tarefas", "escritorio": "Escritório", "aprovacoes": "Aprovações", "avisos": "Avisos",
         "mensagens": "Mensagens", "memoria": "Memória", "projetos": "Projetos", "semana": "Semana", "etsy": "Loja Etsy",
         "trading": "Trading", "mercados": "Mercados", "radar": "Radar", "emails": "E-mails", "crm": "Clientes", "uso": "Uso",
         "skills": "Skills", "vinted": "Vinted", "fundednext": "FundedNext", "aovivo": "Ao vivo", "despesas": "Despesas",
         "equipa": "Equipa", "saude": "Saúde dos PCs"}

SYSTEM = """És o Cérebro da Empresa AMG: o chefe de gabinete dos sócios Marco, Kovel e David (agentes de IA, sites, vídeo,
trading, loja Etsy, clientes). Pensas como o diretor de operações de uma empresa grande: sabes o que se passa, dizes o que
importa primeiro, decides e propões o passo seguinte. Falas em português de Portugal (se te escreverem noutra língua,
respondes nessa), calmo e direto. Respostas curtas, faladas: 1 a 4 frases, sem listas compridas nem markdown, porque podem
ser lidas em voz alta. No contexto tens o estado real da empresa agora: janelas do Claude, tarefas, aprovações, planos
partilhados, avisos por ler e notas da Memória. Usa-o: nomeia as coisas pelo nome e pelo número (tarefa #12, plano #3).
Nunca inventes números, nomes nem estados que não estão no contexto; se não sabes, diz que não está no Hub.

No fim podes pôr linhas de ação, cada uma sozinha numa linha (no máximo três), que viram botões para a pessoa carregar:
[ação: claude] uma janela do Claude Code faz o trabalho · [ação: chatgpt] o ChatGPT responde · [ação: escritorio] tarefa
para o agente do escritório · [ação: nenhuma] quando é só conversa.
[abrir: <página>] quando a resposta está numa página do Hub. Páginas: {pages}.
[plano: Título | passo 1; passo 2; passo 3] quando pedem para planear ou organizar trabalho com vários passos (3 a 8 passos
curtos, cada um uma coisa que se faz).
[nota: Título | o que fica decidido] quando pedem para te lembrares de uma coisa ou quando se decide algo que a equipa
deve saber sempre."""
ACTION = re.compile(r"\[a[cç][aã]o:\s*(claude|chatgpt|escritorio|escritório|nenhuma)\]\s*$", re.I)
TAG = re.compile(r"[ \t]*\[(a[cç][aã]o|abrir|plano|nota):\s*([^\]\n]{1,1500})\][ \t]*", re.I)
SESSION_PT = {"working": "a trabalhar", "waiting": "à espera de resposta", "idle": "livre", "stalled": "parada"}
STAGE_PT = {"todo": "por fazer", "in_progress": "em curso", "blocked": "bloqueada", "review": "para rever", "approval": "à espera de aprovação"}
WEEKDAYS = ("segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo")


def read_tags(text: str) -> tuple[str, dict]:
    """The answer without its action lines, and what they ask: {action, open, new_plan, note}. Unknown pages and empty
    plans are dropped: a button never points at nothing."""
    out = {"action": "nenhuma"}
    for kind, value in TAG.findall(text):
        kind, value = kind.lower(), value.strip()
        if kind.startswith("a") and kind != "abrir":
            v = value.lower().replace("ó", "o")
            if v in ("claude", "chatgpt", "escritorio", "nenhuma"):
                out["action"] = v
        elif kind == "abrir":
            page = value.lower().lstrip("#/").split("/")[0].strip()
            if page in PAGES:
                out["open"] = {"page": page, "label": PAGES[page]}
        else:
            title, _, rest = value.partition("|")
            title = " ".join(title.split())[:200]
            if kind == "plano":
                steps = [" ".join(x.split())[:400] for x in re.split(r";|\s\d+[.)]\s", rest) if x.strip()][:12]
                if title and steps:
                    out["new_plan"] = {"title": title, "steps": steps}
            elif title and rest.strip():
                out["note"] = {"title": title, "content": rest.strip()[:2000]}
    clean = re.sub(r"\n{3,}", "\n\n", TAG.sub("", text)).strip()
    return clean, out


def msg_out(m: BrainMessage) -> dict:
    try:
        plan_ = json.loads(m.plan) if m.plan else None
    except ValueError:
        plan_ = None
    return {"id": m.id, "role": m.role, "text": m.text, "status": m.status, "via": m.via, "reply_to": m.reply_to,
            "user": m.user.username, "name": m.user.display_name, "plan": plan_, "at": iso(m.created_at)}


async def company(db: AsyncSession, user: User) -> dict:
    """The state of the company the brain knows and the page counts: open tasks (blocked and late among them), approvals
    waiting, open shared plans and this person's unread notices. Only what this person may see, read from the database."""
    now = datetime.now(timezone.utc)
    tasks = list((await db.execute(visible_tasks(select(Task).where(Task.status.in_(OPEN_STATUSES)), user)
                                   .order_by(Task.updated_at.desc()))).scalars())
    approvals = select(Approval).where(Approval.status == "PENDING").order_by(Approval.id.desc())
    if not sees_all(user):
        approvals = approvals.where(Approval.user_id == user.id)
    plans = list((await db.execute(select(Plan).where(Plan.status != "done").order_by(Plan.updated_at.desc()))).scalars())
    fresh = (Notification.user_id == user.id, Notification.read_at.is_(None))
    unread = int((await db.execute(select(func.count(Notification.id)).where(*fresh))).scalar() or 0)
    seen, latest = set(), []   # the newest unread notices, each said once (a robot may write the same one ten times)
    for n in (await db.execute(select(Notification).where(*fresh).order_by(Notification.id.desc()).limit(60))).scalars():
        if (n.title, n.body) not in seen and len(latest) < 6:
            seen.add((n.title, n.body))
            latest.append(n)
    return {"tasks": tasks, "mine": [t for t in tasks if t.assignee_id == user.id],
            "blocked": [t for t in tasks if TASK_STAGE.get(t.status) == "blocked"],
            "late": [t for t in tasks if aware(t.deadline) and aware(t.deadline) < now],
            "approvals": list((await db.execute(approvals)).scalars()), "plans": plans, "unread": unread, "notices": latest}


def _fold(text: str) -> str:
    return unicodedata.normalize("NFKD", text.lower()).encode("ascii", "ignore").decode()


STOP = set("para como isso esta este essa esse aqui agora onde quem qual quais quando porque mais menos muito pouco fazer "
           "faz tens temos tenho estou estas queres quero sobre entre depois antes ainda tudo nada cena cenas mano".split())


async def recall(db: AsyncSession, user: User, question: str, limit: int = 4) -> list[Memory]:
    """The notes of the Memória that speak of what was asked: the words of the question (4+ letters) found in the title
    count three times, in the text once. A member sees the shared notes and their own agent's, as on the Memória page."""
    words = {w for w in re.findall(r"[a-z0-9]{4,}", _fold(question)) if w not in STOP}
    if not words:
        return []
    q = select(Memory)
    if not sees_all(user):
        q = q.where(or_(Memory.scope.in_(("global", "team", "company", "project")),
                        (Memory.scope == "agent") & (Memory.scope_id == user.username)))
    scored = []
    for m in (await db.execute(q)).scalars():
        title, body = _fold(m.title), _fold(m.content or "")
        score = sum(3 * (w in title) + (w in body) for w in words)
        if score >= 2:
            scored.append((score, aware(m.updated_at) or datetime.min.replace(tzinfo=timezone.utc), m))
    scored.sort(key=lambda x: (x[0], x[1]), reverse=True)
    return [m for _, _, m in scored[:limit]]


def _when(dt) -> str:
    dt = aware(dt)
    return dt.astimezone().strftime("%d/%m %H:%M") if dt else ""


def _context(office: dict, state: dict | None = None, notes: list | None = None, user: User | None = None) -> str:
    """Everything the brain reads before it answers, in short lines, worst first in each part."""
    out = []
    if user:
        now = datetime.now().astimezone()
        out.append(f"Agora: {WEEKDAYS[now.weekday()]}, {now.strftime('%d/%m/%Y %H:%M')} · fala {user.display_name}")
    rows = []
    for s in office["sessions"][:14]:
        if s["state"] == "ended":
            continue
        rows.append(f"- {s['name']} · {s['project']} · {SESSION_PT.get(s['state'], s['state'])} · meta: {s['topic'] or s['title']} · agora: {s['action']}"
                    + (f" · IAs: {', '.join(s['links'])}" if s.get("links") else ""))
    gpt = [f"- ChatGPT: {j['prompt'][:120]} → {j['state']}" for j in codex_watch.jobs()[:3]]
    out.append("Janelas do Claude da equipa agora:\n" + ("\n".join(rows) or "- nenhuma") + ("\n" + "\n".join(gpt) if gpt else ""))
    if state is not None:
        def task(t):
            stage = TASK_STAGE.get(t.status, t.status)
            who = (t.assignee.display_name if t.assignee else "") + (" (de quem fala)" if user and t.assignee_id == user.id else "")
            bits = [f"#{t.id} {t.title}", who, STAGE_PT.get(stage, stage)]
            if t.priority in ("high", "urgent"):
                bits.append("prioridade " + ("urgente" if t.priority == "urgent" else "alta"))
            if t.deadline:
                bits.append("prazo " + _when(t.deadline))
            return "- " + " · ".join(b for b in bits if b)
        order = {"urgent": 0, "high": 1, "normal": 2, "low": 3}
        tasks = sorted(state["tasks"], key=lambda t: (t not in state["late"], t not in state["blocked"], order.get(t.priority, 2)))
        out.append(f"Tarefas abertas ({len(tasks)}, das quais {len(state['blocked'])} bloqueadas e {len(state['late'])} com o prazo "
                   f"passado):\n" + ("\n".join(task(t) for t in tasks[:12]) or "- nenhuma"))
        out.append(f"À espera de aprovação ({len(state['approvals'])}):\n" + ("\n".join(
            f"- {a.user.display_name}: {a.action[:140]}" for a in state["approvals"][:5]) or "- nada"))
        prow = []
        for p in state["plans"][:8]:
            steps = p.steps or []
            done = sum(1 for x in steps if x.get("done"))
            nxt = next((x.get("text", "") for x in steps if not x.get("done")), "")
            prow.append(f"- plano #{p.id} {p.title} · {done}/{len(steps)} passos" + (f" · com {p.worker}" if p.worker else "")
                        + (f" · próximo: {nxt[:120]}" if nxt else ""))
        out.append(f"Planos partilhados abertos ({len(state['plans'])}):\n" + ("\n".join(prow) or "- nenhum"))
        if state["unread"]:
            out.append(f"Avisos por ler de quem fala ({state['unread']}, os mais recentes):\n" + "\n".join(
                f"- {n.title}" + (f": {n.body[:120]}" if n.body else "") for n in state["notices"]))
    if notes:
        out.append("Notas da Memória da equipa sobre isto:\n" + "\n".join(
            f"- [{m.category or m.scope}] {m.title}: {' '.join((m.content or '').split())[:500]}" for m in notes))
    return "\n\n".join(out)


async def _answer(question_id: int, brain_id: int, user_id: int):
    """The brain answers one question, in the background: the person's message is already on every screen."""
    extra = {}
    try:
        async with SessionLocal() as db:
            user = await db.get(User, user_id)
            office = await office_router.office(user=user, db=db)
            history = (await db.execute(select(BrainMessage).where(BrainMessage.status != "thinking")
                                        .order_by(BrainMessage.id.desc()).limit(HISTORY))).scalars().all()
            q = await db.get(BrainMessage, question_id)
            state = await company(db, user)
            notes = await recall(db, user, q.text)
            context = _context(office, state, notes, user)
            await db.commit()
        talk = "\n".join(f"{'Cérebro' if m.role == 'brain' else m.user.display_name}: {m.text}" for m in reversed(history)
                         if m.id != question_id)
        prompt = (f"{context}\n\nConversa até aqui:\n{talk or '(nada)'}\n\n"
                  f"Agora {user.display_name} diz: {q.text}")
        text, _ = await council_ask(SYSTEM.replace("{pages}", ", ".join(PAGES)), prompt)
        text, extra = read_tags(text)
        if notes:
            extra["notes"] = [{"id": m.id, "title": m.title} for m in notes]
        status = "ok"
    except Exception as e:   # the brain says it could not, never stays «a pensar» forever
        log.warning("cerebro: %s", e)
        text, extra, status = f"Não consegui responder: {str(e)[:200]}", {"action": "nenhuma"}, "failed"
    async with SessionLocal() as db:
        m = await db.get(BrainMessage, brain_id)
        if m:
            m.text, m.status = text or "…", status
            p = json.loads(m.plan or "{}")
            p.update(extra)
            m.plan = json.dumps(p, ensure_ascii=False)
            await db.commit()
    await rt.publish("cerebro", user_id, "team")


async def council_ask(system: str, prompt: str) -> tuple[str, float]:
    from ..tradingroom.council import ask_claude
    return await ask_claude(system, prompt, BRAIN_MODEL, PROMPTS / "brain", timeout=150)


@router.get("/cerebro/chat")
async def chat_list(after: int = 0, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    q = select(BrainMessage).order_by(BrainMessage.id.desc()).limit(80)
    rows = (await db.execute(q)).scalars().all()
    return {"messages": [msg_out(m) for m in reversed(rows)], "me": user.username}


@router.post("/cerebro/chat")
async def chat_send(body: dict = Body(...), user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    text = str(body.get("text") or "").strip()[:4000]
    if len(text) < 2:
        raise HTTPException(422, "Escreve ou diz alguma coisa")
    p = plan(text)
    p["prompt"] = brain_prompt(text, p)
    q = BrainMessage(user_id=user.id, role="user", text=text, via="voz" if body.get("via") == "voz" else "texto")
    db.add(q)
    await db.flush()
    a = BrainMessage(user_id=user.id, role="brain", text="", status="thinking", reply_to=q.id,
                     plan=json.dumps({k: p[k] for k in ("kind", "label", "department", "model", "engines", "skills", "crew", "prompt")}, ensure_ascii=False))
    db.add(a)
    await db.commit()
    asyncio.create_task(_answer(q.id, a.id, user.id))
    await rt.publish("cerebro", user.id, "team")
    return {"question": q.id, "answer": a.id}


@router.post("/cerebro/voice")
async def chat_voice(request: Request, user: User = Depends(current_user)):
    """What was said into the microphone, as text: transcribed on this PC by faster-whisper (free, nothing leaves the PC)."""
    data = await request.body()
    if len(data) < 800:
        raise HTTPException(422, "Não ouvi nada")
    if len(data) > 25_000_000:
        raise HTTPException(413, "Áudio demasiado longo")
    suffix = ".mp4" if "mp4" in (request.headers.get("content-type") or "") else ".webm"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
        f.write(data)
        path = f.name
    try:
        proc = await asyncio.create_subprocess_exec(sys.executable, "-m", "app.cerebro_ouvir", path, cwd=str(Path(__file__).resolve().parents[2]),
                                                    stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        out, err = await asyncio.wait_for(proc.communicate(), timeout=180)
    except asyncio.TimeoutError:
        raise HTTPException(504, "A transcrição demorou demasiado")
    finally:
        Path(path).unlink(missing_ok=True)
    try:
        return json.loads(out.decode("utf-8", "replace").strip().splitlines()[-1])
    except (ValueError, IndexError):
        raise HTTPException(500, "Não deu para transcrever: " + err.decode("utf-8", "replace")[-200:])
