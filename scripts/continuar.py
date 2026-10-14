"""Ponto de situação: what your Claude windows were doing, so a new window carries on by itself.

    python scripts/continuar.py            # your last windows of the day, newest first
    python scripts/continuar.py a5be231e   # one window in full (the start of its id is enough)

Marco, 14 Oct: «quando digo continuar a fazer o que estavas a fazer, tu já devias ir ver no widget aquilo que foi feito».
So when someone says «continua», «faz o que estavas a fazer» or «vou de novo fazer aquilo», a Claude runs this first.
The windows come from this PC's Hub (/api/office, the Escritório); the detail comes from the window's own transcript on
this PC (~/.claude/projects), read here and printed only here: what the person asked (also the messages sent while it
worked), what Claude last said, its last steps, what was cut off, and what is still uncommitted in the project.
"""
import json
import subprocess
import sys
import urllib.request
from datetime import datetime
from pathlib import Path

HUB = "http://127.0.0.1:8000"
PROJECTS = Path.home() / ".claude" / "projects"
MACHINE = ("<task-notification", "<cross-session-message", "<command-", "<local-command", "<system-reminder", "Caveat:")


def call(method, path, token=None):
    request = urllib.request.Request(HUB + path, method=method, headers={"Content-Type": "application/json",
                                                                       **({"Authorization": f"Bearer {token}"} if token else {})})
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.loads(response.read() or b"null")


def clock(iso: str | None) -> str:
    if not iso:
        return ""
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone().strftime("%d/%m %H:%M")
    except ValueError:
        return iso[:16]


def short(text, limit: int) -> str:
    text = " ".join(str(text or "").split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def transcript(key: str) -> Path | None:
    found = sorted(PROJECTS.glob(f"*/{key}.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True)
    return found[0] if found else None


def words(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return " ".join(part.get("text", "") for part in content if isinstance(part, dict) and part.get("type") == "text")
    return ""


def read(path: Path) -> dict:
    """What a window's transcript says: the person's messages, Claude's texts, the steps, and how it ended."""
    asked, said, steps, stopped, last = [], [], [], [], None
    for raw in path.open(encoding="utf-8", errors="replace"):
        try:
            record = json.loads(raw)
        except ValueError:
            continue
        kind = record.get("type")
        if record.get("isSidechain"):
            continue
        if kind == "queue-operation" and record.get("operation") == "enqueue":
            text = str(record.get("content") or "")
            if "<status>killed</status>" in text or "was stopped" in text:
                stopped.append(short(text.split("<summary>")[-1].split("</summary>")[0], 140))
            elif text.strip() and not text.lstrip().startswith(MACHINE):
                asked.append(("enquanto trabalhava", text.strip()))
            continue
        message = record.get("message") or {}
        if kind == "user":
            text = words(message.get("content"))
            if text.strip() and not text.lstrip().startswith(MACHINE) and not record.get("isMeta"):
                if not asked or asked[-1][1] != text.strip():
                    asked.append(("pedido", text.strip()))
            last = last if not text.strip() else "user"
        elif kind == "assistant":
            for part in message.get("content") or []:
                if not isinstance(part, dict):
                    continue
                if part.get("type") == "text" and part.get("text", "").strip():
                    said.append(part["text"].strip())
                    last = "text"
                elif part.get("type") == "tool_use":
                    inp = part.get("input") or {}
                    what = inp.get("description") or inp.get("file_path") or inp.get("pattern") or inp.get("skill") or ""
                    steps.append(short(f"{part.get('name')}: {what}", 140))
                    last = "tool"
    return {"asked": asked, "said": said, "steps": steps, "stopped": stopped, "cut": last in ("tool", "user")}


def git_state(project: str) -> list[str]:
    """Commits of the last day and anything uncommitted, when the window worked in a git folder under the home folder."""
    for folder in (Path.home() / "Desktop" / project, Path.home() / project, Path.home() / "Documents" / project):
        if (folder / ".git").exists():
            run = lambda *a: subprocess.run(["git", "-C", str(folder), *a], capture_output=True, text=True, encoding="utf-8").stdout.strip()
            out = [f"pasta: {folder}"]
            dirty = run("status", "--short")
            out.append("por commitar:\n" + "\n".join("  " + line for line in dirty.splitlines()[:15]) if dirty else "por commitar: nada")
            return out
    return []


def window(s: dict, full: bool):
    state = {"working": "a trabalhar", "waiting": "parado à espera", "idle": "aberto, sem pedido", "ended": "fechado"}.get(s["state"], s["state"])
    print(f"\n## «{s.get('topic') or s.get('title')}»  ·  {s['project']}  ·  {state}  ·  {clock(s.get('started_at'))} → {clock(s.get('updated_at'))}")
    print(f"id: {s['key']}   tokens: {s.get('tokens') or 0:,}".replace(",", " "))
    path = transcript(s["key"])
    if not path:
        print("pedido:", short(s.get("request") or s.get("prompt"), 600))
        if s.get("result"):
            print("última resposta:", short(s["result"], 400))
        print("(o histórico desta janela não está neste PC)")
        return
    t = read(path)
    shown = t["asked"] if full else t["asked"][-4:]
    print("o que foi pedido" + ("" if full else " (os últimos)") + ":")
    for when, text in shown:
        print(f"  - [{when}] {short(text, 1200 if full else 500)}")
    for text in (t["said"][-3:] if full else t["said"][-1:]):
        print("Claude disse:", short(text, 1500 if full else 700))
    print("últimos passos:", " | ".join(t["steps"][-(10 if full else 5):]) or "nenhum")
    if t["stopped"]:
        print("cortado a meio:", "; ".join(t["stopped"][-4:]))
    if t["cut"] and s["state"] != "working":
        print("ATENÇÃO: a janela fechou a meio de um passo, sem resposta final. Ver o que esse passo fazia e se ficou feito.")
    for agent in s.get("agents", [])[:4] if full else []:
        print(f"  subagente {agent.get('kind')}: {short(agent.get('description'), 120)} → {agent.get('status')}")
    for line in git_state(s["project"]) if full else []:
        print(line)


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    pick = sys.argv[1] if len(sys.argv) > 1 else ""
    try:
        login = call("POST", "/api/auth/auto")
        office = call("GET", "/api/office", login["token"])
    except Exception as e:  # noqa: BLE001 - no Hub: say so, nothing else to show
        print(f"O Hub deste PC não responde em {HUB} ({e}). Abre o widget (Abrir AMG.cmd) e corre outra vez.")
        return
    me = (login.get("user") or {}).get("username") or ""
    quiet = lambda s: len(" ".join((s.get("request") or "").split())) < 16 and (s.get("tokens") or 0) < 60000   # a lone «ok» (the agent's checks)
    mine = [s for s in office["sessions"] if (s["user"] == me or not me) and not quiet(s)]
    if pick:
        found = [s for s in mine if s["key"].startswith(pick)]
        if not found:
            print(f"Nenhuma janela tua começa por {pick}.")
        for s in found[:1]:
            window(s, full=True)
        return
    print(f"Ponto de situação de {me or 'este PC'}: as tuas janelas do Claude do último dia, a mais recente primeiro.")
    print("A primeira costuma ser esta janela. Para ver uma em detalhe: python scripts/continuar.py <id>")
    for s in mine[:4]:
        window(s, full=False)


if __name__ == "__main__":
    main()
