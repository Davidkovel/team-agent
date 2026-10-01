"""What is being changed right now, before any commit: the working tree of each repo in library/repos.json.

`git status` + `git diff --numstat` show every file that was edited, added or deleted since the last commit, and the file
timestamps say when. Git does not record WHO edits an uncommitted file, so the row carries the checkout's git user
(`git config user.name`) as "no PC de ...". Nothing here needs a commit or a push.
"""
import os
import subprocess
import time
from pathlib import Path

from . import commits

CACHE_SECONDS = 5
MAX_FILES = 200
SKIP = ("__pycache__/", ".pytest_cache/", ".venv/", "node_modules/", ".git/")
SKIP_END = (".pyc", ".db", ".db-wal", ".db-shm", ".log")
_cache: dict[str, tuple[float, dict | None]] = {}
LABELS = {"M": "alterado", "A": "novo", "D": "apagado", "?": "novo"}


def _git(path: Path, *args: str) -> str:
    out = subprocess.run(["git", "-C", str(path), *args], capture_output=True, timeout=15, env=commits.GIT_ENV)
    return out.stdout.decode("utf-8", errors="replace")


def _status(code: str) -> str:
    for ch in code:
        if ch in "MAD?":
            return LABELS[ch]
    return "alterado"


def _one(repo: dict) -> dict | None:
    path = commits._local_path(repo)
    if not path or not (path / ".git").exists():
        return None
    numstat = {}
    for line in _git(path, "diff", "--numstat", "--no-renames", "HEAD").splitlines():
        parts = line.split("\t", 2)
        if len(parts) == 3:
            numstat[parts[2]] = (int(parts[0]) if parts[0].isdigit() else 0, int(parts[1]) if parts[1].isdigit() else 0)
    files = []
    for entry in _git(path, "status", "--porcelain=v1", "-uall", "--no-renames", "-z").split("\0"):
        if len(entry) < 4:
            continue
        code, rel = entry[:2], entry[3:]
        if any(s in rel + ("/" if not rel.endswith("/") else "") for s in SKIP) or rel.endswith(SKIP_END):
            continue
        try:
            mtime = (path / rel).stat().st_mtime
        except OSError:
            mtime = None  # deleted files have no timestamp
        added, deleted = numstat.get(rel, (0, 0))
        files.append({"path": rel, "status": _status(code), "added": added, "deleted": deleted, "mtime": mtime})
    if not files:
        return None
    files.sort(key=lambda f: f["mtime"] or 0, reverse=True)
    stamps = [f["mtime"] for f in files if f["mtime"]]
    return {"repo": repo["name"], "branch": _git(path, "rev-parse", "--abbrev-ref", "HEAD").strip(),
            "user": _git(path, "config", "user.name").strip() or os.environ.get("USERNAME", ""),
            "count": len(files), "added": sum(f["added"] for f in files), "deleted": sum(f["deleted"] for f in files),
            "newest": max(stamps) if stamps else None, "files": files[:MAX_FILES]}


def pending() -> list[dict]:
    """Repos with uncommitted work, most recently touched first. Cached for a few seconds: it is polled often."""
    now, out = time.time(), []
    for repo in commits.repos():
        hit = _cache.get(repo["name"])
        if hit and now - hit[0] < CACHE_SECONDS:
            result = hit[1]
        else:
            try:
                result = _one(repo)
            except Exception:
                result = None
            _cache[repo["name"]] = (now, result)
        if result:
            out.append(result)
    return sorted(out, key=lambda r: r["newest"] or 0, reverse=True)
