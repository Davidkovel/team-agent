"""The crew's long memory: every Claude Code conversation kept on this PC, searched when the past matters.

Claude Code keeps each conversation in ~/.claude/projects/<folder>/<session>.jsonl: what the person asked and what Claude
answered, from the first session on. The Hub's Memória has the short version the team wrote down; this has everything,
so an agent asked to "do it like last time" can go and look. Only this PC's files are read, only when the agent asks,
and nothing is copied anywhere: the snippets go back to the agent's own conversation and nowhere else.
"""
import json
import os
import time
import unicodedata
from pathlib import Path

from .base import STR, Tool, ToolResult, schema

PROJECTS = Path(os.environ.get("CLAUDE_CONFIG_DIR", Path.home() / ".claude")) / "projects"
MAX_SECONDS = 25      # a search never holds the task up longer than this
SNIPPET = 420
TOP = 8


def _fold(text: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", text.lower()) if not unicodedata.combining(c))


def _text(message) -> str:
    content = (message or {}).get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text")
    return ""


def _project(folder: str) -> str:
    """C--Users-david-Documents-baredesk-theme -> baredesk-theme (the last part is what people call it)."""
    parts = [p for p in folder.split("-") if p]
    for i, p in enumerate(parts):
        if p.lower() in ("documents", "desktop", "projects", "repos", "src"):
            return "-".join(parts[i + 1:]) or folder
    return parts[-1] if parts else folder


INDEX = Path(os.environ.get("TEAM_AGENT_HOME", Path.home() / ".team-agent")) / "recall"
_cache: dict[str, tuple[float, int, list]] = {}


def _messages(f: Path) -> list:
    """[when, who, text] of what was said in one conversation, without the tool output (most of the file). Read once per
    change of the file and kept in ~/.team-agent/recall, so a search reads a few MB, not the 300 MB of transcripts."""
    st = f.stat()
    key = str(f)
    hit = _cache.get(key)
    if hit and hit[0] == st.st_mtime and hit[1] == st.st_size:
        return hit[2]
    disk = INDEX / (f.parent.name + "__" + f.stem + ".json")
    try:
        saved = json.loads(disk.read_text(encoding="utf-8"))
        if saved["mtime"] == st.st_mtime and saved["size"] == st.st_size:
            _cache[key] = (st.st_mtime, st.st_size, saved["items"])
            return saved["items"]
    except (OSError, ValueError, KeyError):
        pass
    items = []
    with f.open(encoding="utf-8", errors="ignore") as fh:
        for line in fh:
            if '"text"' not in line and '"content":"' not in line:
                continue
            try:
                entry = json.loads(line)
            except ValueError:
                continue
            if entry.get("type") not in ("user", "assistant") or entry.get("isMeta"):
                continue
            text = _text(entry.get("message")).strip()
            if text and not text.startswith("<"):   # tool output and system wrappers are not what anybody said
                items.append([(entry.get("timestamp") or "")[:16].replace("T", " "), "pessoa" if entry["type"] == "user" else "claude", text[:6000]])
    try:
        INDEX.mkdir(parents=True, exist_ok=True)
        disk.write_text(json.dumps({"mtime": st.st_mtime, "size": st.st_size, "items": items}, ensure_ascii=False), encoding="utf-8")
    except OSError:
        pass
    _cache[key] = (st.st_mtime, st.st_size, items)
    return items


def search(query: str, root: Path = PROJECTS, limit: int = TOP, budget: float = MAX_SECONDS) -> list[dict]:
    words = [w for w in _fold(query).split() if len(w) > 2] or _fold(query).split()
    if not words or not root.is_dir():
        return []
    start, hits = time.time(), []
    files = sorted(list(root.glob("*/*.jsonl")) + list(root.glob("*/*/subagents/*.jsonl")), key=lambda f: f.stat().st_mtime, reverse=True)
    for f in files:
        if time.time() - start > budget:
            break
        try:
            items = _messages(f)
        except OSError:
            continue
        project = _project(f.parent.name if f.parent.name != "subagents" else f.parents[2].name)
        for when, who, text in items:
            folded = _fold(text)
            score = sum(1 for w in words if w in folded)
            if score < max(1, (len(words) + 1) // 2):
                continue
            at = folded.find(next(w for w in words if w in folded))
            lo = max(0, at - SNIPPET // 3)
            hits.append({"score": score, "when": when, "project": project, "who": who,
                         "text": ("…" if lo else "") + " ".join(text[lo:lo + SNIPPET].split()) + ("…" if lo + SNIPPET < len(text) else "")})
    hits.sort(key=lambda h: (h["score"], h["when"]), reverse=True)
    return hits[:limit]


class Recall(Tool):
    name = "recall"
    description = ("Search every past Claude Code conversation kept on this computer (all projects, from the first session on): "
                   "what the team asked and what was answered. Use it when the task refers to earlier work, a decision, a "
                   "file or a way of doing something that is not in the briefing. Give a few distinctive words, in the "
                   "language the team used (usually Portuguese).")
    schema = schema(query=STR)

    def summary(self, args):
        return f"recall {args.get('query', '')!r}"

    async def run(self, args, ctx):
        import asyncio
        hits = await asyncio.to_thread(search, str(args["query"]))
        if not hits:
            return ToolResult("Nothing found in the past conversations for those words. Try other words, or fewer.")
        return ToolResult("\n\n".join(f"[{h['when']} · {h['project']} · {h['who']}] {h['text']}" for h in hits))
