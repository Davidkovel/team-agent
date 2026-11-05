"""The person's projects, for a conversation that continues one (backend/app/routers/conversas.py).

The Hub of each computer lists the projects of its Claude conversations (backend/app/recall_share.py): in
~/.team-agent/projetos.json for the agent of that computer, and in recall-peers/<computer>/ on the person's other computers.
On the person's computer a conversation runs in the real folder. In the cloud its workspace gets the code from git, so what
was never committed and pushed is not there, and the listing says so to the agent.
"""
import json
import os
import subprocess
from datetime import datetime
from pathlib import Path

HOME = Path(os.environ.get("TEAM_AGENT_HOME", Path.home() / ".team-agent"))
LOCAL = HOME / "projetos.json"
PEERS = Path(os.environ.get("TEAM_AGENT_RECALL_PEERS", HOME / "recall-peers"))
MEMORY_CHARS = 6000
MIRROR = Path(os.environ.get("ESPELHO_PASTA", Path.home() / "trabalho"))  # backend/app/espelho.py keeps it, on the cloud
FOLDERS = {"Secretária": "Desktop", "Documentos": "Documents"}


def _read(path: Path) -> list:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except (OSError, ValueError):
        return []


def elsewhere() -> list[dict]:
    """The projects the person's other computers listed, newest first."""
    out = []
    if PEERS.is_dir():
        for folder in (d for d in PEERS.iterdir() if d.is_dir()):
            out += _read(folder / "_projects.json")
    return sorted(out, key=lambda p: p.get("used") or 0, reverse=True)


def local_path(name: str) -> Path | None:
    """The real folder of a project on this computer. Only inside the person's home, and never the home itself."""
    home = Path.home().resolve()
    if name in FOLDERS and (Path.home() / FOLDERS[name]).is_dir():
        return Path.home() / FOLDERS[name]
    for project in _read(LOCAL):
        if project.get("name") == name:
            path = Path(project.get("path") or "").expanduser().resolve()
            if home in path.parents and path.is_dir():
                return path
    return None


def mirrored() -> list[str]:
    """The folders the computer really keeps here. ~/trabalho also holds the agents' own task folders: those are not it."""
    try:
        names = json.loads((MIRROR / ".espelho.json").read_text(encoding="utf-8")).get("pastas") or {}
    except (OSError, ValueError, AttributeError):
        return []
    return sorted(n for n in names if (MIRROR / n).is_dir())


def mirror(name: str) -> Path | None:
    """The copy of this folder of the person's computer on this server, when the computer has already sent it."""
    return MIRROR / name if name in mirrored() else None


def mirror_note(name: str) -> str:
    try:
        last = json.loads((MIRROR / ".espelho.json").read_text(encoding="utf-8"))
        when = datetime.fromtimestamp(last["quando"]).strftime("%d/%m %H:%M")
    except (OSError, ValueError, KeyError, TypeError):
        when = "desconhecida"
    return (f"This folder is the copy of {name} from the person's computer, with the files not yet committed. Last copy: {when} "
            "(server time); the computer may be off, which is fine. Work here as if on the computer: what you change goes back "
            "to the computer by itself when it is on, with no commit and no push. Commit and push only when the person asks.")


def fetch(workspace: Path, name: str) -> str:
    """Bring the project's code into this workspace from git. What it could not do is said to the agent."""
    if workspace == mirror(name):
        return mirror_note(name)
    project = next((p for p in elsewhere() if p.get("name") == name), None)
    remote = (project or {}).get("remote") or ""
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0"}
    try:
        if (workspace / ".git").exists():
            subprocess.run(["git", "-C", str(workspace), "pull", "-q", "--ff-only"], env=env, capture_output=True, timeout=180)
        elif remote.startswith(("https://", "git@")) and not any(workspace.iterdir()):
            done = subprocess.run(["git", "clone", "-q", "--", remote, str(workspace)], env=env, capture_output=True, text=True, timeout=600)
            if done.returncode:
                return (f"The code of {name} could not be fetched from {remote} (no access to it from this server). Say so to "
                        "the person and that scripts/nuvem/preparar.py github gives this server access.")
    except (OSError, subprocess.SubprocessError) as exc:
        return f"The code of {name} could not be fetched: {type(exc).__name__}."
    if not project:
        return ""
    pending = []
    if project.get("dirty"):
        pending.append(f"{project['dirty']} changed files not committed")
    if project.get("ahead"):
        pending.append(f"{project['ahead']} commits not pushed")
    if not pending:
        return ""
    return (f"On the person's computer, {name} has {' and '.join(pending)}, which are NOT here. Tell the person, and do not redo "
            "or overwrite that work without asking.")


def lines(project: str = "") -> list[str]:
    """For the first prompt of a conversation: the projects known, and the index of the person's Claude memory."""
    out, known = [], elsewhere()[:20]
    if copies := mirrored():
        out += ["", f"The folders of the person's computer are copied on this server, in {MIRROR}: {', '.join(copies)}. "
                    "Secretária is their Desktop. Look there for their files and work there; changes go back by themselves. "
                    "Only what is inside those folders goes back: a new file with no folder of its own goes in Secretária."]
    if known:
        out += ["", "The person's projects on their other computers (the recall tool finds what was said about each):",
                *[f"- {p['name']}{' · ' + p['remote'] if p.get('remote') else ' · not in git'}"
                  f"{' · last commit: ' + p['last'] if p.get('last') else ''}" for p in known]]
    if PEERS.is_dir():
        for f in PEERS.glob("*/*__memoria-MEMORY.json"):
            try:
                items = json.loads(f.read_text(encoding="utf-8")).get("items") or []
            except (OSError, ValueError):
                continue
            if items:
                out += ["", "The index of the memory the person's Claude keeps on their computer. The recall tool finds the "
                            "full notes:", str(items[-1][2])[:MEMORY_CHARS]]
    return out
