"""Planos da equipa: a job in steps that any Claude on any PC can pick up where the last one stopped (routers/plans.py).

    python scripts/plano.py novo "Título" "Objetivo em poucas linhas" "passo 1" "passo 2" ...   # prints the plan's number
    python scripts/plano.py ver                 # the open plans
    python scripts/plano.py ver 12              # one plan in full: steps, who did what, the hand-over notes
    python scripts/plano.py estou 12            # I am on it now (the Escritório shows who)
    python scripts/plano.py feito 12 3 "o que ficou feito"
    python scripts/plano.py passo 12 "passo novo" ["outro"]
    python scripts/plano.py nota 12 "onde parei, o que falta, o que não fazer"   # always before stopping
    python scripts/plano.py fechar 12

`novo` keeps the folder it is run from and its git remote, so the partner's Claude knows where the work is.
It talks to this PC's own Hub (127.0.0.1:8000) as the person this PC belongs to; the plan reaches the other PCs by sync.
"""
import json
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

HUB = "http://127.0.0.1:8000"


def call(method, path, token=None, body=None):
    request = urllib.request.Request(HUB + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                     headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {token}"} if token else {})})
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.loads(response.read() or b"null")


def clock(iso: str | None) -> str:
    if not iso:
        return ""
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone().strftime("%d/%m %H:%M")
    except ValueError:
        return iso[:16]


def remote(folder: Path) -> str:
    try:
        return subprocess.run(["git", "-C", str(folder), "remote", "get-url", "origin"], capture_output=True, text=True, timeout=5).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return ""


def show(p: dict):
    print(f"Plano #{p['id']}: {p['title']}  ({p['done']}/{p['total']} feitos, {'fechado' if p['status'] == 'done' else 'aberto'})")
    if p["goal"]:
        print(f"Objetivo: {p['goal']}")
    if p["project"] or p["repo"]:
        print(f"Onde: {p['project']}" + (f"  (git: {p['repo']}; se não tiveres a pasta, clona-a)" if p["repo"] else ""))
    print(f"Criado por {p['by']} a {clock(p['created_at'])}" + (f"; agora com {p['worker']} desde {clock(p['worker_at'])}" if p["worker"] else ""))
    print("\nPassos:")
    first = None
    for n, s in enumerate(p["steps"], 1):
        if not s.get("done") and first is None:
            first = n
        mark = "[x]" if s.get("done") else "[ ]"
        extra = f"  — {s['by']} {clock(s.get('at'))}: {s['note']}" if s.get("done") and s.get("note") else (f"  — {s['by']} {clock(s.get('at'))}" if s.get("done") else "")
        print(f"  {n}. {mark} {s['text']}{extra}")
    if p["notes"]:
        print("\nNotas de passagem (a mais recente no fim):")
        for x in p["notes"][-8:]:
            print(f"  - {x['by']} {clock(x['at'])}: {x['text']}")
    if p["status"] != "done":
        print(f"\nA seguir: passo {first}." if first else "\nTodos os passos feitos: confirma e fecha (plano.py fechar).")
        print(f"Marca cada passo com: python scripts/plano.py feito {p['id']} <n> \"o que fizeste\"; antes de parar: plano.py nota {p['id']} \"...\"")


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    args = sys.argv[1:]
    if not args or args[0] in ("-h", "--help"):
        print(__doc__)
        return
    try:
        token = call("POST", "/api/auth/auto")["token"]
    except (urllib.error.URLError, OSError) as e:
        sys.exit(f"O Hub deste PC não respondeu ({e}). Abre o AMG e tenta outra vez.")
    cmd, rest = args[0], args[1:]
    need = lambda n: rest[n] if len(rest) > n else sys.exit(f"Falta um valor: python scripts/plano.py {cmd} ...")
    try:
        if cmd == "novo":
            here = Path.cwd()
            p = call("POST", "/api/plans", token, {"title": need(0), "goal": rest[1] if len(rest) > 1 else "",
                                                   "steps": rest[2:], "project": str(here), "repo": remote(here)})
            print(f"Plano #{p['id']} criado com {p['total']} passos. Já está no Escritório de toda a equipa.")
        elif cmd == "ver":
            if rest:
                show(call("GET", f"/api/plans/{int(rest[0])}", token))
            else:
                open_ = [p for p in call("GET", "/api/plans", token) if p["status"] != "done"]
                for p in open_:
                    print(f"#{p['id']}  {p['title']}  {p['done']}/{p['total']}  {('com ' + p['worker']) if p['worker'] else 'parado'}  ({clock(p['updated_at'])})")
                print("Nenhum plano aberto." if not open_ else "\nPara ver um: python scripts/plano.py ver <número>")
        elif cmd in ("estou", "feito", "passo", "nota", "fechar", "sai"):
            pid = int(need(0))
            body = {"estou": lambda: {"working": True}, "sai": lambda: {"working": False},
                    "feito": lambda: {"tick": int(need(1)), "step_note": rest[2] if len(rest) > 2 else "", "working": True},
                    "passo": lambda: {"add_steps": rest[1:] or [need(1)]},
                    "nota": lambda: {"note": need(1)}, "fechar": lambda: {"status": "done"}}[cmd]()
            p = call("PATCH", f"/api/plans/{pid}", token, body)
            print(f"Plano #{p['id']}: {p['done']}/{p['total']} feitos{' — fechado' if p['status'] == 'done' else ''}.")
        else:
            sys.exit(f"Não conheço «{cmd}». python scripts/plano.py --help")
    except urllib.error.HTTPError as e:
        sys.exit(f"O Hub recusou: {e.read().decode('utf-8', 'replace')}")


if __name__ == "__main__":
    main()
