"""Vinted Radar no Hub (#/vinted, 11 nov, David): escolher as categorias, ligar/desligar o coletor Selenium e ver as
oportunidades (artigos bem abaixo do preço de mercado).

O motor é o repositório vinted-radar (`~/vinted-radar` ou `VINTED_RADAR_DIR`): `radar.py correr` abre um Chrome sem
janela, lê a pesquisa pública do Vinted de 5 em 5 min e guarda em `radar.db`. O Hub só lê esse SQLite, escreve o
`config/nichos.json` e arranca/pára o processo. Por PC, nada vai por sync. Compra sempre manual.
"""
from __future__ import annotations

import json
import os
import signal
import sqlite3
import subprocess
import sys
import time
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

from ..models import User
from .tradingroom import viewer

router = APIRouter(prefix="/api/vinted")
DIR = Path(os.environ.get("VINTED_RADAR_DIR") or Path.home() / "vinted-radar")
CFG = DIR / "config" / "nichos.json"
PIDF = Path.home() / ".team-agent" / "vinted.json"
LIMITES = ("margem_min_eur", "margem_min_pct", "max_pct_do_mercado", "percentil_max", "preco_max", "intervalo_min")


def _python() -> str:
    """O Python de fora do venv do Hub: é lá que está o Selenium."""
    return os.environ.get("VINTED_PYTHON") or getattr(sys, "_base_executable", "") or sys.executable


def _pid() -> int | None:
    try:
        pid = json.loads(PIDF.read_text())["pid"]
    except Exception:
        return None
    if os.name == "nt":
        out = subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/NH"], capture_output=True, text=True,
                             creationflags=0x08000000).stdout
        return pid if str(pid) in out else None
    try:
        os.kill(pid, 0)
        return pid
    except OSError:
        return None


def _start():
    if _pid():
        return
    log = open(DIR / "radar.log", "a", encoding="utf-8")
    flags = 0x08000000 | 0x00000200 if os.name == "nt" else 0   # sem janela, grupo próprio
    p = subprocess.Popen([_python(), "-u", "radar.py", "correr"], cwd=DIR, stdout=log, stderr=subprocess.STDOUT,
                         creationflags=flags, env={**os.environ, "PYTHONIOENCODING": "utf-8"})
    PIDF.parent.mkdir(parents=True, exist_ok=True)
    PIDF.write_text(json.dumps({"pid": p.pid, "desde": time.strftime("%Y-%m-%d %H:%M:%S")}))


def _stop():
    pid = _pid()
    if not pid:
        return
    if os.name == "nt":   # leva também o Chrome e o chromedriver que ele abriu
        subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True, creationflags=0x08000000)
    else:
        os.kill(pid, signal.SIGTERM)


def _cfg() -> dict:
    return json.loads(CFG.read_text(encoding="utf-8"))


def _rows(q: str, args=()) -> list:
    db = DIR / "radar.db"
    if not db.exists():
        return []
    c = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=5)
    try:
        return c.execute(q, args).fetchall()
    except sqlite3.OperationalError:
        return []
    finally:
        c.close()


def _view() -> dict:
    if not CFG.exists():
        return {"instalado": False, "pasta": str(DIR)}
    cfg = _cfg()
    try:
        st = json.loads((DIR / "status.json").read_text(encoding="utf-8"))
    except Exception:
        st = {}
    por = {n: (k, ult) for n, k, ult in _rows("SELECT nicho, count(*), max(visto_em) FROM anuncios GROUP BY nicho")}
    hoje = time.strftime("%Y-%m-%d")
    novos_hoje = {n: k for n, k in _rows("SELECT nicho, count(*) FROM anuncios WHERE origem='novo' AND visto_em>=? "
                                         "GROUP BY nicho", (hoje,))}
    nichos = [{"nome": n["nome"], "pesquisa": n["pesquisa"], "ativo": n.get("ativo", True),
               "anuncios": por.get(n["nome"], (0, None))[0], "ultimo": por.get(n["nome"], (0, None))[1],
               "hoje": novos_hoje.get(n["nome"], 0)} for n in cfg["nichos"]]
    cols = ["id", "nicho", "titulo", "marca", "tamanho", "estado", "preco", "foto", "link", "visto_em",
            "mediana", "lucro", "comparaveis", "alertado_em"]
    alertas = [dict(zip(cols, r)) for r in _rows(f"SELECT {','.join(cols)} FROM anuncios WHERE alertado=1 "
                                                  "ORDER BY coalesce(alertado_em, visto_em) DESC LIMIT 60")]
    pid = _pid()
    return {"instalado": True, "ligado": bool(pid), "estado": st if pid else {}, "nichos": nichos, "alertas": alertas,
            "limites": {k: cfg.get(k) for k in LIMITES}, "pais": cfg.get("pais", "pt"),
            "telegram": bool((DIR / ".env").exists() and "TELEGRAM_BOT_TOKEN=" in (DIR / ".env").read_text()
                             and "TELEGRAM_BOT_TOKEN=\n" not in (DIR / ".env").read_text()),
            "total": sum(n["anuncios"] for n in nichos), "alertas_hoje": sum(1 for a in alertas
                                                                            if (a["alertado_em"] or "") >= hoje)}


@router.get("")
def view(user: User = Depends(viewer)):
    return _view()


@router.post("/ligar")
def ligar(body: dict, user: User = Depends(viewer)):
    if not CFG.exists():
        raise HTTPException(404, f"Falta o vinted-radar em {DIR}")
    _start() if body.get("on") else _stop()
    time.sleep(0.5)
    return _view()


@router.post("/config")
def config(body: dict, user: User = Depends(viewer)):
    """Categorias ligadas/desligadas, categoria nova, limites. Se o coletor corre, reinicia para ler a mudança."""
    cfg = _cfg()
    ativos = body.get("ativos")
    if isinstance(ativos, list):
        for n in cfg["nichos"]:
            n["ativo"] = n["nome"] in ativos
    novo = body.get("novo")
    if novo:
        nome, pesq = str(novo.get("nome", "")).strip()[:60], str(novo.get("pesquisa", "")).strip()[:80]
        if not pesq:
            raise HTTPException(400, "Escreve o que procurar")
        if any(n["nome"].lower() == (nome or pesq).lower() for n in cfg["nichos"]):
            raise HTTPException(400, "Essa categoria já existe")
        cfg["nichos"].append({"nome": nome or pesq, "pesquisa": pesq, "tamanhos": [], "ativo": True})
    tirar = body.get("tirar")
    if tirar:
        cfg["nichos"] = [n for n in cfg["nichos"] if n["nome"] != tirar]
    for k, v in (body.get("limites") or {}).items():
        if k in LIMITES and isinstance(v, (int, float)) and v >= 0:
            cfg[k] = v
    CFG.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
    if _pid():
        _stop()
        time.sleep(1)
        _start()
    return _view()
