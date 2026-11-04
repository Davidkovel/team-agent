"""The crew's long memory: every Claude Code conversation kept on this PC, searched when the past matters.

Claude Code keeps each conversation in ~/.claude/projects/<folder>/<session>.jsonl: what the person asked and what Claude
answered, from the first session on. The Hub's Memória has the short version the team wrote down; this has everything,
so an agent asked to "do it like last time" can go and look. Only read when the agent asks, and the snippets go back to
the agent's own conversation and nowhere else.

Since 4 Nov it also reads what the person's other computers sent (backend/app/recall_share.py, in
~/.team-agent/recall-peers/<computer>/): an agent in the cloud, given a task from the phone, finds what was done on the Mac.
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
# What the Hub of this computer received from the person's other computers (recall_share.py writes it as the Hub's user)
PEERS = Path(os.environ.get("TEAM_AGENT_RECALL_PEERS", Path.home() / ".team-agent" / "recall-peers"))
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


def _peer(f: Path) -> tuple[str, list]:
    """(project folder, items) of a conversation another computer sent."""
    st = f.stat()
    key = str(f)
    hit = _cache.get(key)
    if hit and hit[0] == st.st_mtime and hit[1] == st.st_size:
        return hit[2]
    data = json.loads(f.read_text(encoding="utf-8"))
    value = (str(data.get("folder") or ""), data.get("items") or [])
    _cache[key] = (st.st_mtime, st.st_size, value)
    return value


def _where(folder: Path) -> str:
    """How the computer that sent a folder is called in a hit: «Mac», else its own name."""
    try:
        info = json.loads((folder / "_computer.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        info = {}
    return "Mac" if info.get("system") == "mac" else str(info.get("computer") or folder.name)


def _files(root: Path, peers: Path) -> list[tuple[float, Path, str | None]]:
    """(mtime, file, computer) of every conversation, newest first: computer None for this one's own transcripts."""
    out = []
    if root.is_dir():
        for f in list(root.glob("*/*.jsonl")) + list(root.glob("*/*/subagents/*.jsonl")):
            try:
                out.append((f.stat().st_mtime, f, None))
            except OSError:
                pass
    if peers.is_dir():
        for folder in (d for d in peers.iterdir() if d.is_dir()):
            where = _where(folder)
            for f in folder.glob("*.json"):
                if not f.name.startswith("_"):
                    try:
                        out.append((f.stat().st_mtime, f, where))
                    except OSError:
                        pass
    out.sort(key=lambda x: x[0], reverse=True)
    return out


def search(query: str, root: Path = PROJECTS, limit: int = TOP, budget: float = MAX_SECONDS, peers: Path = PEERS) -> list[dict]:
    words = [w for w in _fold(query).split() if len(w) > 2] or _fold(query).split()
    if not words:
        return []
    start, hits = time.time(), []
    for _, f, where in _files(root, peers):
        if time.time() - start > budget:
            break
        try:
            if where is None:
                items = _messages(f)
                project = _project(f.parent.name if f.parent.name != "subagents" else f.parents[2].name)
            else:
                folder, items = _peer(f)
                project = f"{_project(folder)} · {where}"
        except (OSError, ValueError, AttributeError):
            continue
        for item in items:
            if len(item) != 3:
                continue
            when, who, text = item
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
    description = ("Search every past Claude Code conversation kept on this computer (all projects, from the first session on), "
                   "and those of the person's other computers (a hit marked «· Mac» was done on their Mac): what was asked "
                   "and what was answered. Use it when the task refers to earlier work, a decision, a "
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
