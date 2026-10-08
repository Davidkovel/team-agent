"""The crew: the eight characters of Empresa AMG (frontend/hub/crew.js draws them in the Batcave).

A task can be given to one of them (`tasks.crew`). The agent of the person the task is for then runs it as that
character: the same crew member keeps the same Claude conversation from task to task (the agent resumes it), and every
task starts with a briefing from the Hub: who they are, what the team knows (the Memória), the projects, what is open,
what the crew finished lately and what this one did before. When a task is finished, a note goes into the Memória
(category TAREFAS), so the next run of any of them knows it too.
"""
import re
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from . import hub
from .models import Memory, Project, Task, User

# id -> name, the agent_role the task gets when none is chosen, what they do, and who they are (to the model)
CREW: dict[str, dict] = {
    "batman": {"name": "Batman", "role": "developer", "what": "Código",
               "persona": "You are Batman, the crew's lead developer. You write and change code with discipline: small, "
                          "tested changes, nothing left half done, no shortcuts that come back to bite. Calm, precise, few words."},
    "lucius": {"name": "Lucius Fox", "role": "developer", "what": "Engenharia e código",
               "persona": "You are Lucius Fox, the crew's engineer. You find where things live in a codebase, explain how "
                          "they fit together and build the tools the others need. Thorough and exact; you cite file paths."},
    "riddler": {"name": "Riddler", "role": "research", "what": "Pesquisa",
                "persona": "You are the Riddler, the crew's researcher. You dig for facts on the web and in documents, check "
                           "them twice and give your sources. You love a hard question and you never invent an answer."},
    "catwoman": {"name": "Catwoman", "role": "custom", "what": "Design",
                 "persona": "You are Catwoman, the crew's designer. You design pages and interfaces with taste: spacing, type, "
                            "colour, and the Mercedes-AMG finish of the team's Hub (black, chrome, red). You deliver working "
                            "HTML and CSS, not mock-ups."},
    "joker": {"name": "Joker", "role": "marketing", "what": "Marketing",
              "persona": "You are the Joker, the crew's marketer. Bold copy, ads and campaign ideas for BareDesk and the "
                         "team's companies. Everything you write stays a draft until it is approved: nothing is published "
                         "or paid for without approval."},
    "alfred": {"name": "Alfred", "role": "custom", "what": "Revisão",
               "persona": "You are Alfred, the crew's reviewer. You review changes before they go to everyone: bugs, risks, "
                          "what is missing. Polite and direct; you list concrete problems, the most serious first."},
    "robin": {"name": "Robin", "role": "testing", "what": "Testes",
              "persona": "You are Robin, the crew's tester. You run the checks and the tests, try the edge cases and report "
                         "the exact failures; you fix only what the task asks you to fix."},
    "gordon": {"name": "Gordon", "role": "custom", "what": "Operações",
               "persona": "You are Commissioner Gordon, the crew's operator. You take whatever comes: organising, planning, "
                          "small fixes, chasing the loose ends. Practical; you close tasks."},
}

# Who takes a task nobody named: the words of the request say the sector, else the kind of agent asked for, else Operations.
# The same lists as WORDS and ROLE_CREW in frontend/hub/crew.js (the Batcave draws with them): change both together.
_L = r"[^\W\d_]*"   # the rest of a word: "pesquis" + this takes pesquisa, pesquisar, pesquisas


def _words(*stems: str) -> re.Pattern:
    return re.compile(rf"(?<![^\W_])(?:{'|'.join(stems)})(?![^\W_])".replace("~", _L), re.IGNORECASE)


WORDS: list[tuple[str, re.Pattern]] = [
    ("catwoman", _words("design~", "página~", "pagina~", "cor", "cores", "layout", "ecrã~", "visual", "ícone~", "logo~", "estilo~", "css",
                        "bonit~", "interface~", "aba", "abas", "bot[ãa]o", "bot[õo]es")),
    ("riddler", _words("pesquis~", "preço~", "preco~", "procur~", "concorr~", "fornecedor~")),
    ("robin", _words("test~")),
    ("alfred", _words("rever", "revê", "revisão", "revisao", "revis[ae]~", "review")),
    ("joker", _words("anúncio~", "anuncio~", "posts?", "campanha~", "instagram", "tiktok", "marketing", "legenda~")),
    ("batman", _words("erro~", "bug~", "código", "codigo", "corrig~", "implement~", "script~", "automatiz~", "backend", "api")),
    ("lucius", _words("onde está", "onde esta", "onde fica", "explic~", "como funciona")),
]
ROLE_CREW = {"developer": "batman", "research": "riddler", "marketing": "joker", "testing": "robin"}
# with the agent (waiting for it, running, or stopped half way): what is ahead of a task that arrives now
WITH_AGENT = ("ASSIGNED", "IN_PROGRESS", "WAITING_APPROVAL", "PAUSED", "NEEDS_HELP")

MEMORY_CATEGORY = "TAREFAS"
MEMORY_KEEP = 15  # the TAREFAS notes a task's prompt gets: the newest ones (the Memória page still shows them all)


def role_of(crew_id: str | None) -> str:
    return CREW[crew_id]["role"] if crew_id in CREW else ""


def name_of(crew_id: str | None) -> str:
    return CREW[crew_id]["name"] if crew_id in CREW else ""


def sector_of(title: str | None, description: str | None = "", role: str | None = "") -> str:
    """The crew member whose sector a request belongs to."""
    text = f"{title or ''} {description or ''}"
    return next((who for who, words in WORDS if words.search(text)), None) or ROLE_CREW.get(role or "") or "gordon"


async def route(db: AsyncSession, person: User, title: str, description: str = "", role: str = "", crew_id: str = "",
                but: int | None = None) -> dict:
    """Where a task sent to the office goes: the crew member (the one asked for, else the sector's) and how many tasks that
    person's agent has before it. An agent runs one task at a time, so a busy one means a queue, not another character:
    the task waits for the one who knows that kind of work and keeps their conversation."""
    who = crew_id if crew_id in CREW else sector_of(title, description, role)
    ahead = (await db.execute(select(Task.id).where(Task.assignee_id == person.id, Task.status.in_(WITH_AGENT),
                                                    Task.trashed_at.is_(None), Task.id != (but or 0)))).scalars().all()
    return {"crew": who, "name": CREW[who]["name"], "what": CREW[who]["what"], "ahead": len(ahead), "for": person.display_name}


def _short(text: str | None, size: int) -> str:
    text = " ".join((text or "").split())
    return text if len(text) <= size else text[: size - 1].rstrip() + "…"


async def remember_task(db: AsyncSession, task: Task, person: User):
    """A finished task becomes a note in the Memória, one per task: what was asked, who did it and what came of it."""
    who = name_of(task.crew) or f"Claude / {person.display_name}"
    title = _short(f"{who}: {task.title}", 200)
    day = (task.completed_at or datetime.now(timezone.utc)).strftime("%d/%m/%Y")
    content = _short(f"{day} · para {task.assignee.display_name}{f' · {task.project}' if task.project else ''}. "
                     f"{task.result or 'Concluída sem resumo.'}", 900)
    note = (await db.execute(select(Memory).where(Memory.scope == "team", Memory.category == MEMORY_CATEGORY,
                                                  Memory.title == title))).scalars().first()
    if note:
        note.content = content
    else:
        db.add(Memory(scope="team", scope_id="", category=MEMORY_CATEGORY, title=title, content=content, created_by=person.id))
    await db.commit()


def trim_memory(rows: list[Memory]) -> list[Memory]:
    """Every task finished adds a TAREFAS note; a prompt gets only the newest of them."""
    done = sorted((m for m in rows if m.category == MEMORY_CATEGORY), key=lambda m: m.updated_at or m.created_at, reverse=True)
    keep = {m.id for m in done[:MEMORY_KEEP]}
    return [m for m in rows if m.category != MEMORY_CATEGORY or m.id in keep]


async def briefing(db: AsyncSession, task: Task, memory: list[Memory]) -> dict:
    """Everything a crew member reads before starting: who they are, the Memória, the projects, the open work, what the
    crew finished lately and what they did themselves."""
    crew_id = task.crew if task.crew in CREW else None
    projects = (await db.execute(select(Project).order_by(Project.name))).scalars().all()
    companies = hub.companies()
    open_tasks = (await db.execute(select(Task).where(Task.status != "COMPLETED", Task.trashed_at.is_(None), Task.id != task.id)
                                   .order_by(Task.updated_at.desc()).limit(15))).unique().scalars().all()
    finished = (await db.execute(select(Task).where(Task.status == "COMPLETED", Task.trashed_at.is_(None))
                                 .order_by(Task.completed_at.desc()).limit(12))).unique().scalars().all()
    mine = []
    if crew_id:
        mine = (await db.execute(select(Task).where(Task.crew == crew_id, Task.status == "COMPLETED", Task.id != task.id)
                                 .order_by(Task.completed_at.desc()).limit(8))).unique().scalars().all()
    return {
        "crew": {"id": crew_id, **{k: CREW[crew_id][k] for k in ("name", "role", "what", "persona")}} if crew_id else None,
        "team": [{"name": name_of(c), "what": CREW[c]["what"]} for c in CREW if c != crew_id],
        "memory": [{"scope": m.scope, "category": m.category, "title": m.title, "content": m.content} for m in memory],
        "companies": [{"id": cid, "name": c.get("name") or cid} for cid, c in companies.items()],
        "projects": [{"name": p.name, "company": p.company or "", "status": p.status, "description": _short(p.description, 240)}
                     for p in projects],
        "open": [{"title": t.title, "status": t.status, "for": t.assignee.display_name, "crew": name_of(t.crew)} for t in open_tasks],
        "finished": [{"title": t.title, "by": name_of(t.crew) or t.assignee.display_name, "result": _short(t.result, 220)}
                     for t in finished],
        "mine": [{"title": t.title, "result": _short(t.result, 300)} for t in mine],
    }
