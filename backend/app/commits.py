"""Recent commits of the team's repositories, with who / where / how much.

`library/repos.json` lists them: {"name", "github": "owner/repo", "source": "<key in sources.json> | self"}.
When a local checkout exists we `git fetch` and read `git log --numstat`, which gives the changed files of every
commit (what teammates pushed included). Without a checkout we fall back to GitHub's API (GITHUB_TOKEN is needed
for private repos); that one only knows the message and author, not the files.
"""
import json
import os
import mimetypes
import re
import subprocess
import threading
import time
import urllib.request
from collections import defaultdict
from pathlib import Path

from . import hub
from .config import settings

CACHE_SECONDS = 60
FETCH_COUNT = 100
MAX_FILES = 80
_cache: dict[str, tuple[float, list[dict]]] = {}
_refreshing: set[str] = set()
_lock = threading.Lock()

REC, FIELD, BODY_END = "\x1e", "\x1f", "\x1d"
GIT_ENV = {**os.environ, "GIT_TERMINAL_PROMPT": "0"}  # never wait for a password in the background


def repos() -> list[dict]:
    try:
        data = json.loads((hub.library_dir() / "repos.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    return [r for r in data if isinstance(r, dict) and r.get("name")]


def _local_path(repo: dict) -> Path | None:
    if repo.get("source") == "self":
        return hub.library_dir().parent
    path = hub.sources().get(repo.get("source", ""))
    if path:
        return path
    # no library/sources.json on this PC: a checkout beside team-agent with the repo's name is the same thing
    # (Documents/baredesk-theme next to Documents/team-agent). Without this the BareDesk card said "no access" on every PC.
    beside = hub.library_dir().parent.parent / repo.get("github", "").split("/")[-1]
    return beside if (beside / ".git").exists() else None


def _github(repo: dict, limit: int) -> list[dict]:
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "agente-amg"}
    if settings.github_token:
        headers["Authorization"] = f"Bearer {settings.github_token}"
    url = f"https://api.github.com/repos/{repo['github']}/commits?per_page={limit}"
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=6) as res:
        rows = json.load(res)
    return [{"sha": r["sha"], "author": (r["commit"]["author"] or {}).get("name", "?"), "date": r["commit"]["author"]["date"],
             "message": r["commit"]["message"].splitlines()[0], "body": "", "url": r["html_url"], "via": "github",
             "files": None, "areas": [], "stats": None} for r in rows]


PHOTO = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".bmp", ".ico", ".svg"}
DESIGN = {".css", ".scss", ".html", ".qss", ".ttf", ".otf", ".woff", ".woff2"}
TEXT = {".md", ".txt"}
MAX_BLOB = 8 * 1024 * 1024
MIME = {".webp": "image/webp", ".avif": "image/avif", ".svg": "image/svg+xml", ".ico": "image/x-icon"}   # Windows does not know all of them


def kind(path: str) -> str:
    """What a changed file is to somebody who does not read code: a picture, design, a text, or code."""
    ext = Path(path).suffix.lower()
    return "photo" if ext in PHOTO else "design" if ext in DESIGN else "text" if ext in TEXT else "code"


def _kinds(files: list[dict]) -> dict:
    out = {}
    for f in files:
        k = out.setdefault(f["kind"], {"files": 0, "added": 0, "deleted": 0})
        k["files"] += 1
        k["added"] += f["added"]
        k["deleted"] += f["deleted"]
    return out


def blob(repo_name: str, sha: str, path: str) -> tuple[bytes, str] | None:
    """A picture as it was in one commit, read from the local checkout. Only pictures, and only by commit and path."""
    repo = next((r for r in repos() if r["name"] == repo_name), None)
    root = _local_path(repo) if repo else None
    if not root or not re.fullmatch(r"[0-9a-f]{7,40}", sha) or Path(path).suffix.lower() not in PHOTO:
        return None
    if path.startswith(("-", "/")) or ".." in path.split("/") or ":" in path:
        return None
    try:
        out = subprocess.run(["git", "-C", str(root), "show", f"{sha}:{path}"], capture_output=True, timeout=10, env=GIT_ENV)
    except (OSError, subprocess.SubprocessError):
        return None
    if out.returncode or len(out.stdout) > MAX_BLOB:
        return None   # deleted in that commit, or not a file of it
    return out.stdout, MIME.get(Path(path).suffix.lower()) or mimetypes.guess_type(path)[0] or "application/octet-stream"


def _areas(files: list[dict]) -> list[dict]:
    """Groups changed files by their top-level folder: that is the 'where' of a commit."""
    groups = defaultdict(lambda: {"files": 0, "added": 0, "deleted": 0})
    for f in files:
        name = f["path"].split("/", 1)[0] if "/" in f["path"] else "(raiz)"
        groups[name]["files"] += 1
        groups[name]["added"] += f["added"]
        groups[name]["deleted"] += f["deleted"]
    return sorted(({"name": k, **v} for k, v in groups.items()), key=lambda a: -(a["added"] + a["deleted"]))


def _clean_body(body: str) -> str:
    """Commit body without the Co-Authored-By trailers, which only add noise to the feed."""
    lines = [l for l in body.strip().splitlines() if not l.lower().startswith("co-authored-by:")]
    return "\n".join(lines).strip()[:600]


def _parse(raw: str, repo: dict) -> list[dict]:
    base = f"https://github.com/{repo['github']}/commit/" if repo.get("github") else ""
    out = []
    for record in raw.split(REC):
        if not record.strip() or BODY_END not in record:
            continue
        head, numstat = record.split(BODY_END, 1)
        parts = head.split(FIELD)
        if len(parts) < 5:
            continue
        sha, author, date, subject, body = parts[:5]
        files = []
        for line in numstat.strip().splitlines():
            nums = line.split("\t", 2)  # "added<TAB>deleted<TAB>path"; binary files report "-"
            if len(nums) < 3:
                continue
            files.append({"path": nums[2], "added": int(nums[0]) if nums[0].isdigit() else 0,
                          "deleted": int(nums[1]) if nums[1].isdigit() else 0, "binary": nums[0] == "-", "kind": kind(nums[2])})
        out.append({"sha": sha.strip(), "author": author, "date": date, "message": subject, "body": _clean_body(body),
                    "url": base + sha.strip() if base else "", "via": "local",
                    "files": files[:MAX_FILES], "areas": _areas(files), "kinds": _kinds(files),
                    "stats": {"files": len(files), "added": sum(f["added"] for f in files), "deleted": sum(f["deleted"] for f in files)}})
    return out


def _local(repo: dict, limit: int) -> list[dict]:
    path = _local_path(repo)
    if not path or not (path / ".git").exists():
        return []
    try:  # pick up what teammates pushed; fine if it fails (offline, private repo without saved login)
        subprocess.run(["git", "-C", str(path), "fetch", "--quiet", "--all"], capture_output=True, timeout=20, env=GIT_ENV)
    except (OSError, subprocess.SubprocessError):
        pass
    fmt = f"{REC}%H{FIELD}%aN{FIELD}%aI{FIELD}%s{FIELD}%b{BODY_END}"
    out = subprocess.run(["git", "-C", str(path), "log", "--all", f"-n{limit}", "--no-renames", "--numstat", f"--format={fmt}"],
                         capture_output=True, timeout=20, env=GIT_ENV)
    return _parse(out.stdout.decode("utf-8", errors="replace"), repo)


def _fetch(repo: dict) -> list[dict]:
    for source in (_local, _github):
        if source is _github and not repo.get("github"):
            continue
        try:
            commits = source(repo, FETCH_COUNT)
        except Exception:
            commits = []
        if commits:
            return commits
    return []


def _refresh(repo: dict):
    try:
        _cache[repo["name"]] = (time.time(), _fetch(repo))
    finally:
        with _lock:
            _refreshing.discard(repo["name"])


def recent(limit: int = 40) -> list[dict]:
    """Never makes the caller wait for git once a repo was read: stale data is returned at once and refreshed
    in the background (git log + fetch takes seconds and the Hub polls this every few seconds)."""
    now, items = time.time(), []
    for repo in repos():
        key = repo["name"]  # always fetch FETCH_COUNT once; callers slice
        hit = _cache.get(key)
        if hit is None:
            commits = _fetch(repo)
            _cache[key] = (now, commits)
        else:
            commits = hit[1]
            if now - hit[0] >= CACHE_SECONDS:
                with _lock:
                    start = key not in _refreshing
                    _refreshing.add(key)
                if start:
                    threading.Thread(target=_refresh, args=(repo,), daemon=True).start()
        items += [{**c, "repo": repo["name"]} for c in commits]
    return sorted(items, key=lambda c: c["date"], reverse=True)[:limit]


def projects() -> list[dict]:
    """Every repository of library/repos.json with its latest commit, the one worked on last first.
    A repo we cannot read (no checkout, private without GITHUB_TOKEN) is still listed, with `last` empty."""
    from datetime import datetime, timedelta, timezone

    recent(1)  # fills or refreshes the cache
    week = datetime.now(timezone.utc) - timedelta(days=7)
    out = []
    for repo in repos():
        commits = sorted(_cache.get(repo["name"], (0, []))[1], key=lambda c: datetime.fromisoformat(c["date"]), reverse=True)
        fresh = [c for c in commits if datetime.fromisoformat(c["date"]) >= week]
        today = datetime.now().astimezone().date()
        days = [0] * 7  # commits per day, oldest first, today last
        for c in fresh:
            back = (today - datetime.fromisoformat(c["date"]).astimezone().date()).days
            if 0 <= back < 7:
                days[6 - back] += 1
        out.append({"name": repo["name"], "github": repo.get("github", ""),
                    "url": f"https://github.com/{repo['github']}" if repo.get("github") else "",
                    "last": {k: commits[0][k] for k in ("sha", "author", "date", "message", "url")} if commits else None,
                    "week_commits": len(fresh), "days": days, "week_authors": sorted({c["author"] for c in fresh})})
    return sorted(out, key=lambda r: datetime.fromisoformat(r["last"]["date"]).timestamp() if r["last"] else 0, reverse=True)
