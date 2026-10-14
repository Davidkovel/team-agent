"""The company's skills library (library/skills in the repository, the Hub's page Skills): how a crew member finds and
reads a skill before doing the work it covers.

Each skill is a folder with a SKILL.md (what it is for in its frontmatter, then the instructions) and sometimes more files
it points to (references, templates, scripts). library/skills/agentes.json says which crew member masters each one; the
briefing tells each agent their own (skill_lines), and this tool reads any of them, theirs or not. Only reads: a skill
is instructions, the work itself still goes through the other tools and the permission policy.
"""
import json
import re
from pathlib import Path

from .base import STR, Tool, ToolResult, schema

LIB = Path(__file__).resolve().parents[3] / "library" / "skills"
MAX_TEXT = 40000


def _about(md: Path) -> str:
    try:
        head = md.read_text(encoding="utf-8", errors="replace")[:3000]
    except OSError:
        return ""
    found = re.search(r"^description:[ \t]*(.*)$", head, re.M) if head.startswith("---") else None
    text = found.group(1).strip() if found else ""
    if found and text in ("", ">", "|", ">-", "|-", ">+", "|+"):   # a YAML block: the indented lines under it
        block = re.match(r"((?:[ \t]+.*\n?)+)", head[found.end() + 1:])
        text = block.group(1) if block else ""
    text = " ".join(text.strip().strip("\"'").split())
    return text if len(text) <= 200 else text[:199].rsplit(" ", 1)[0] + "…"


def owners() -> dict[str, list[str]]:
    try:
        return json.loads((LIB / "agentes.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def library() -> dict[str, str]:
    """name -> what it is for, for every skill in the library."""
    try:
        return {md.parent.name: _about(md) for md in sorted(LIB.glob("*/SKILL.md"))}
    except OSError:
        return {}


def skill_lines(crew: str) -> list[str]:
    """What the briefing says about skills: the crew member's own, with what each is for, and how to reach the rest."""
    lib = library()
    if not lib:
        return []
    own = [name for name, who in owners().items() if crew and crew in who and name in lib]
    lines = ["", f"The company's skills library has {len(lib)} skills (the `skills` tool lists and reads them)."]
    if own:
        lines += ["The skills you master. When the task is the kind of work one of them covers, read it with the `skills` "
                  "tool first and follow it:", *[f"- {name}: {lib[name]}" for name in own[:40]]]
    lines += ["When the task asks about the team's skills, or a skill could help with it, list them with `skills` and read the "
              "ones that fit before starting."]
    return lines


class Skills(Tool):
    name = "skills"
    description = ("The company's skills library: instructions written for a kind of work (design, marketing, documents, "
                   "testing, research...). With no arguments: every skill with what it is for and who masters it. With "
                   "`query`: only the skills whose name or description has those words. With `name`: that skill's whole "
                   "SKILL.md and the list of its other files. With `name` and `file`: one of those files. Read a skill "
                   "before doing the work it covers, and follow it.")
    schema = schema([], name=STR, query=STR, file=STR)

    def summary(self, args):
        return f"skills {args.get('name') or args.get('query') or ''}".strip()

    async def run(self, args, ctx):
        name, query, file = (str(args.get(k) or "").strip() for k in ("name", "query", "file"))
        lib, who = library(), owners()
        if not lib:
            return ToolResult("The skills library is empty: nobody has brought skills into it yet (Hub, page Skills).")
        if not name:
            words = [w for w in query.lower().split() if w]
            rows = [(n, a) for n, a in lib.items() if all(w in f"{n} {a}".lower() for w in words)]
            if not rows:
                return ToolResult(f"No skill matches {query!r}. Call skills with no arguments to see all {len(lib)}.")
            return ToolResult("\n".join(f"- {n}: {a}" + (f" [masters: {', '.join(who[n])}]" if who.get(n) else "") for n, a in rows))
        folder = (LIB / name).resolve()
        if folder.parent != LIB.resolve() or not (folder / "SKILL.md").is_file():
            close = [n for n in lib if name.lower() in n.lower()]
            return ToolResult(f"There is no skill called {name!r}." + (f" Did you mean: {', '.join(close[:6])}?" if close else ""), True)
        if file:
            target = (folder / file).resolve()
            if folder not in target.parents or not target.is_file():
                return ToolResult(f"The skill {name} has no file {file!r}.", True)
            return ToolResult(target.read_text(encoding="utf-8", errors="replace")[:MAX_TEXT])
        text = (folder / "SKILL.md").read_text(encoding="utf-8", errors="replace")[:MAX_TEXT]
        others = sorted(str(p.relative_to(folder)).replace("\\", "/") for p in folder.rglob("*") if p.is_file() and p.name != "SKILL.md")
        if others:
            text += "\n\n---\nOther files of this skill (read one with skills name=" + name + " file=<path>):\n" + "\n".join(f"- {o}" for o in others[:60])
        return ToolResult(text)
