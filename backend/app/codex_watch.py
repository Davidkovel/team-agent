"""ChatGPT (Codex) on this computer, for the Cérebro: which conversations it has, what was asked, what it answered, the
tools it is calling and whether it is working now. Read from the files the ChatGPT app writes itself (~/.codex), never
sent anywhere: it stays on this PC's Hub, like the Claude windows' own transcripts.

Also the one way the Cérebro talks to ChatGPT: `ask()` runs the Codex CLI that comes inside ChatGPT.app, read-only
(it may read, never change a file), and the conversation it makes shows up here like any other.
"""
import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
from pathlib import Path

HOME = Path(os.environ.get("CODEX_HOME") or Path.home() / ".codex")
CLI = ("/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex", shutil.which("codex") or "")
SHOWN = 24 * 3600     # conversations of the last day
TAIL = 262144         # only the end of a conversation is read
_paths: dict[str, Path] = {}
_cache: dict[str, tuple[float, dict]] = {}
_jobs: dict[str, dict] = {}
INTERNAL = re.compile(r"guardian review|approval", re.I)   # Codex's own reviewer of its permissions, not a conversation   # questions the Cérebro sent to ChatGPT, by id


def cli() -> str:
    return next((c for c in CLI if c and os.access(c, os.X_OK)), "")


def _cut(text, size: int) -> str:
    text = " ".join(str(text or "").split())
    return text if len(text) <= size else text[: size - 1].rstrip() + "…"


def _text(content) -> str:
    if isinstance(content, list):
        return " ".join(str(p.get("text") or "") for p in content if isinstance(p, dict))
    return str(content or "")


def _path(sid: str) -> Path | None:
    if sid in _paths and _paths[sid].exists():
        return _paths[sid]
    found = sorted((HOME / "sessions").glob(f"*/*/*/*{sid}.jsonl"))
    if found:
        _paths[sid] = found[-1]
    return _paths.get(sid)


def _read(path: Path) -> dict:
    """What a conversation says, from its last 256 KB (and its first line, for the folder it works in)."""
    out = {"asked": "", "answer": "", "tools": [], "working": False, "cwd": "", "model": "", "steps": []}
    try:
        with open(path, "rb") as f:
            first = f.readline()
            f.seek(0, 2)
            f.seek(max(0, f.tell() - TAIL))
            lines = f.read().decode("utf-8", "replace").splitlines()
    except OSError:
        return out
    try:
        meta = json.loads(first).get("payload") or {}
        out["cwd"] = str(meta.get("cwd") or "")
    except (ValueError, AttributeError):
        pass
    for line in lines:
        try:
            r = json.loads(line)
        except ValueError:
            continue
        if not isinstance(r, dict):
            continue
        p = r.get("payload") if isinstance(r.get("payload"), dict) else {}
        kind, sub = r.get("type"), p.get("type")
        at = r.get("timestamp") or ""
        if kind == "turn_context" and p.get("model"):
            out["model"] = str(p["model"])
        if kind == "event_msg" and sub == "task_started":
            out["working"] = True
        elif kind == "event_msg" and sub in ("task_complete", "turn_aborted"):
            out["working"] = False
        elif kind == "response_item" and sub == "message":
            text = _text(p.get("content")).strip()
            if not text or text.startswith("<"):   # the environment and instructions the app sends by itself
                continue
            if p.get("role") == "user":
                out["asked"] = _cut(text, 2000)
                out["steps"].append([at, "pediu: " + _cut(text, 140)])
            elif p.get("role") == "assistant":
                out["answer"] = _cut(text, 1200)
                out["steps"].append([at, "respondeu: " + _cut(text, 140)])
        elif kind == "response_item" and sub in ("custom_tool_call", "function_call"):
            name = str(p.get("name") or "ferramenta")
            out["tools"] = [t for t in out["tools"] if t != name][-5:] + [name]
            out["steps"].append([at, f"a usar {name}"])
    out["steps"] = out["steps"][-10:]
    return out


def threads(limit: int = 8) -> list[dict]:
    """ChatGPT's conversations of the last day on this PC, newest first. Cheap: a file is read again only when it changed."""
    index = HOME / "session_index.jsonl"
    if not index.exists():
        return []
    try:
        with open(index, "rb") as f:
            f.seek(0, 2)
            f.seek(max(0, f.tell() - 65536))
            rows = f.read().decode("utf-8", "replace").splitlines()
    except OSError:
        return []
    latest: dict[str, dict] = {}
    for line in rows:
        try:
            r = json.loads(line)
        except ValueError:
            continue
        if isinstance(r, dict) and r.get("id") and not INTERNAL.match(str(r.get("thread_name") or "")):
            latest[r["id"]] = r
    out = []
    now = time.time()
    for sid, r in sorted(latest.items(), key=lambda kv: kv[1].get("updated_at") or "", reverse=True)[:limit * 2]:
        path = _path(sid)
        if not path:
            continue
        mtime = path.stat().st_mtime
        if now - mtime > SHOWN:
            continue
        hit = _cache.get(sid)
        if not hit or hit[0] != mtime:
            hit = (mtime, _read(path))
            _cache[sid] = hit
        data = hit[1]
        working = data["working"] and now - mtime < 15 * 60   # a conversation closed half way says nothing for long
        out.append({"id": sid, "name": _cut(r.get("thread_name") or "Conversa", 80), "updated_at": round(mtime),
                    "state": "working" if working else "idle", "project": Path(data["cwd"]).name if data["cwd"] else "",
                    "asked": data["asked"], "answer": data["answer"], "tools": data["tools"], "model": data["model"],
                    "steps": [{"at": s[0], "text": s[1]} for s in data["steps"]],
                    "from_brain": any(j.get("sid") == sid for j in _jobs.values())})
        if len(out) >= limit:
            break
    return out


def jobs() -> list[dict]:
    return sorted(({k: v for k, v in j.items() if k != "proc"} for j in _jobs.values()), key=lambda j: j["at"], reverse=True)[:8]


def ask(prompt: str, job_id: str) -> dict:
    """Ask ChatGPT (Codex, read-only: it may look, never change anything) in the background. Its answer arrives in jobs()."""
    exe = cli()
    if not exe:
        return {"ok": False, "error": "O ChatGPT (Codex) não está instalado neste computador."}
    out = Path(tempfile.gettempdir()) / f"cerebro-chatgpt-{job_id}.txt"
    job = {"id": job_id, "at": round(time.time()), "prompt": _cut(prompt, 400), "state": "working", "answer": "", "error": "", "sid": ""}
    _jobs[job_id] = job
    while len(_jobs) > 20:
        _jobs.pop(min(_jobs, key=lambda k: _jobs[k]["at"]))

    def run():
        try:
            done = subprocess.run([exe, "exec", "--skip-git-repo-check", "--sandbox", "read-only", "-C", str(Path.home()),
                                   "-o", str(out), prompt], capture_output=True, text=True, timeout=900,
                                  stdin=subprocess.DEVNULL)
            answer = out.read_text(encoding="utf-8", errors="replace").strip() if out.exists() else ""
            job["answer"] = _cut(answer, 4000) if answer else ""
            job["state"] = "done" if answer else "failed"
            if not answer:
                job["error"] = _cut(done.stderr or done.stdout or "sem resposta", 300)
            for line in (done.stderr or "").splitlines():   # «session id: 01a1…», to tie it to its conversation
                if "session id:" in line.lower():
                    job["sid"] = line.split(":", 1)[1].strip()
        except (OSError, subprocess.SubprocessError) as e:
            job["state"], job["error"] = "failed", _cut(e, 300)
        finally:
            job["finished"] = round(time.time())
            out.unlink(missing_ok=True)

    threading.Thread(target=run, daemon=True).start()
    return {"ok": True, "job": job_id}
