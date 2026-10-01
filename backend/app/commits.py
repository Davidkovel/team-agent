"""Recent commits of the team's repositories.

`library/repos.json` lists them: {"name", "github": "owner/repo", "source": "<key in sources.json> | self"}.
GitHub's API is tried first (GITHUB_TOKEN is needed for private repos); if that fails the local checkout's
`git log` is used, so the feed still works offline.
"""
import json
import subprocess
import time
import urllib.request
from pathlib import Path

from .config import settings
from . import hub

CACHE_SECONDS = 60
FETCH_COUNT = 100
_cache: dict[str, tuple[float, list[dict]]] = {}


def repos() -> list[dict]:
    try:
        data = json.loads((hub.library_dir() / "repos.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    return [r for r in data if isinstance(r, dict) and r.get("name")]


def _local_path(repo: dict) -> Path | None:
    if repo.get("source") == "self":
        return hub.library_dir().parent
    return hub.sources().get(repo.get("source", ""))


def _github(repo: dict, limit: int) -> list[dict]:
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "agente-amg"}
    if settings.github_token:
        headers["Authorization"] = f"Bearer {settings.github_token}"
    url = f"https://api.github.com/repos/{repo['github']}/commits?per_page={limit}"
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=6) as res:
        rows = json.load(res)
    return [{"sha": r["sha"], "author": (r["commit"]["author"] or {}).get("name", "?"), "date": r["commit"]["author"]["date"],
             "message": r["commit"]["message"].splitlines()[0], "url": r["html_url"], "via": "github"} for r in rows]


def _local(repo: dict, limit: int) -> list[dict]:
    path = _local_path(repo)
    if not path or not (path / ".git").exists():
        return []
    out = subprocess.run(["git", "-C", str(path), "log", f"-n{limit}", "--format=%H%x1f%an%x1f%aI%x1f%s"],
                         capture_output=True, text=True, timeout=10, encoding="utf-8", errors="replace")
    rows = [line.split("\x1f") for line in out.stdout.splitlines() if line.count("\x1f") == 3]
    base = f"https://github.com/{repo['github']}/commit/" if repo.get("github") else ""
    return [{"sha": sha, "author": author, "date": date, "message": message, "url": base + sha if base else "", "via": "local"}
            for sha, author, date, message in rows]


def recent(limit: int = 40) -> list[dict]:
    now, items = time.time(), []
    for repo in repos():
        key = repo["name"]  # always fetch FETCH_COUNT once; callers slice
        hit = _cache.get(key)
        if hit and now - hit[0] < CACHE_SECONDS:
            commits = hit[1]
        else:
            commits = []
            for source in (_github, _local):
                if source is _github and not repo.get("github"):
                    continue
                try:
                    commits = source(repo, FETCH_COUNT)
                except Exception:
                    commits = []
                if commits:
                    break
            _cache[key] = (now, commits)
        items += [{**c, "repo": repo["name"]} for c in commits]
    return sorted(items, key=lambda c: c["date"], reverse=True)[:limit]
