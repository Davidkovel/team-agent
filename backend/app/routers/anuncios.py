"""Radar de Anúncios no Hub (#/anuncios, 25 nov, David): o que a Meta mostra agora no Uzbequistão, em Portugal e na Ucrânia,
e o que começou há pouco e já aguenta 2+ dias no ar (= alguém paga por ele, porque vende).

O motor é `ads-radar/adsradar.py` (`ADS_RADAR_DIR` muda a pasta): um Chrome sem janela lê a Biblioteca de Anúncios pública
(sem login, sem chave) e guarda em `ads.db`. O Hub só lê esse SQLite, liga/desliga o coletor e muda as pesquisas.
Endpoints síncronos de propósito (o FastAPI corre-os numa thread); a guarda do «ligado» é a única chamada a partir do loop.
"""
from __future__ import annotations

import asyncio
import importlib.util
import json
import logging
import os
import sqlite3
import subprocess
import sys
import time
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

from ..models import User
from .tradingroom import viewer

router = APIRouter(prefix="/api/anuncios")
DIR = Path(os.environ.get("ADS_RADAR_DIR") or Path(__file__).resolve().parents[3] / "ads-radar")
CFG = DIR / "config" / "pesquisas.json"
PIDF = Path.home() / ".team-agent" / "anuncios.json"
log = logging.getLogger("team.anuncios")
NOMES = {"UZ": "Uzbequistão", "PT": "Portugal", "UA": "Ucrânia"}


def _motor():
    """O adsradar.py como módulo (as categorias e a conta das tendências são as dele: uma só verdade)."""
    spec = importlib.util.spec_from_file_location("adsradar", DIR / "adsradar.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


_M = None


def motor():
    global _M
    if _M is None:
        _M = _motor()
    return _M


def _python() -> str:
    if os.environ.get("VINTED_PYTHON"):
        return os.environ["VINTED_PYTHON"]
    if importlib.util.find_spec("selenium"):
        return sys.executable
    return getattr(sys, "_base_executable", "") or sys.executable


def _ficha() -> dict:
    try:
        return json.loads(PIDF.read_text())
    except Exception:
        return {}


def _guardar_ficha(**kw) -> dict:
    f = {**_ficha(), **kw}
    PIDF.parent.mkdir(parents=True, exist_ok=True)
    PIDF.write_text(json.dumps(f, ensure_ascii=False))
    return f


def _pid() -> int | None:
    pid = _ficha().get("pid")
    if not pid:
        return None
    if os.name == "nt":
        out = subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/NH"], capture_output=True, text=True,
                             creationflags=0x08000000).stdout
        return pid if str(pid) in out else None
    try:
        if os.waitpid(pid, os.WNOHANG)[0] == pid:
            return None
    except OSError:
        pass
    try:
        os.kill(pid, 0)
        return pid
    except OSError:
        return None


def _start(cmd: str = "correr", *args: str):
    if _pid():
        return
    out = open(DIR / "radar.log", "a", encoding="utf-8")
    flags = 0x08000000 | 0x00000200 if os.name == "nt" else 0
    p = subprocess.Popen([_python(), "-u", "adsradar.py", cmd, *args], cwd=DIR, stdout=out, stderr=subprocess.STDOUT,
                         creationflags=flags, env={**os.environ, "PYTHONIOENCODING": "utf-8"}, start_new_session=os.name != "nt")
    _guardar_ficha(pid=p.pid, desde=time.strftime("%Y-%m-%d %H:%M:%S"), modo=cmd)


def _stop():
    pid = _pid()
    if not pid:
        return
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True, creationflags=0x08000000)
    else:
        import signal
        try:
            os.killpg(pid, signal.SIGTERM)
        except OSError:
            pass


def vigiar():
    """Ligado = o coletor corre; se parou (PC reiniciou, Chrome caiu), volta a arrancar."""
    if _ficha().get("ligado") and not _pid() and CFG.exists():
        _start()


async def loop():
    await asyncio.sleep(40)
    while True:
        try:
            await asyncio.to_thread(vigiar)
        except Exception:
            log.exception("A guarda do Radar de Anúncios falhou")
        await asyncio.sleep(120)


def _db():
    f = DIR / "ads.db"
    if not f.exists():
        return None
    return sqlite3.connect(f"file:{f}?mode=ro", uri=True, timeout=5)


def _status() -> dict:
    try:
        return json.loads((DIR / "status.json").read_text(encoding="utf-8"))
    except Exception:
        return {}


@router.get("")
def resumo(pais: str = "", min_dias: float = 2, max_dias: float = 14, user: User = Depends(viewer)):
    cfg = json.loads(CFG.read_text(encoding="utf-8"))
    f, st = _ficha(), _status()
    base = {"ligado": bool(f.get("ligado")), "a_correr": bool(_pid()), "estado": st, "intervalo_h": cfg.get("intervalo_h", 6),
            "paises": {k: {"nome": v.get("nome") or NOMES.get(k, k), "ligado": v.get("ligado", True), "pesquisas": v["pesquisas"]}
                       for k, v in cfg["paises"].items()},
            "categorias": motor().CAT_NOME}
    c = _db()
    if not c:
        return {**base, "vazio": True, "grupos": [], "por_pais": {}, "por_dia": []}
    try:
        m = motor()
        grupos = m.tendencias(c, pais or None, min_dias, max_dias)
        c.row_factory = None
        agora = time.time()
        por_pais = {}
        for p, n, ativos, recentes in c.execute(
                "SELECT pais, COUNT(*), SUM(ativo), SUM(CASE WHEN inicio >= ? THEN 1 ELSE 0 END) FROM ads GROUP BY pais", (agora - 14 * 86400,)):
            por_pais[p] = {"total": n, "ativos": ativos or 0, "recentes": recentes or 0}
        # anúncios novos por dia de arranque (últimos 21 dias): mostra se o mercado está a acelerar
        q = "SELECT CAST((? - inicio) / 86400 AS INT) d, COUNT(*) FROM ads WHERE inicio >= ?" + (" AND pais=?" if pais else "") + " GROUP BY d"
        dias = dict(c.execute(q, (agora, agora - 21 * 86400, *([pais] if pais else []))).fetchall())
        por_dia = [dias.get(d, 0) for d in range(20, -1, -1)]
        voltas = [dict(zip(("em", "pais", "pesquisa", "n", "novos", "erro"), r))
                  for r in c.execute("SELECT * FROM voltas ORDER BY rowid DESC LIMIT 40")]
    finally:
        c.close()
    return {**base, "vazio": False, "grupos": grupos[:400], "por_pais": por_pais, "por_dia": por_dia, "voltas": voltas}


@router.get("/grupo")
def grupo(pais: str, pagina_id: str = "", dominio: str = "", user: User = Depends(viewer)):
    """Todos os anúncios de um anunciante+site, para a ficha."""
    c = _db()
    if not c:
        raise HTTPException(404, "Ainda sem dados")
    c.row_factory = sqlite3.Row
    try:
        rows = [dict(r) for r in c.execute("SELECT * FROM ads WHERE pais=? AND (pagina_id=? OR ?='') AND dominio=? ORDER BY inicio DESC LIMIT 60",
                                           (pais, pagina_id, pagina_id, dominio))]
    finally:
        c.close()
    for r in rows:
        r["risco_porque"] = json.loads(r["risco_porque"] or "[]")
    return {"anuncios": rows}


@router.post("/ligar")
def ligar(body: dict, user: User = Depends(viewer)):
    on = bool(body.get("on"))
    _guardar_ficha(ligado=on)
    if on:
        _start()
    else:
        _stop()
    return {"ok": True, "ligado": on}


@router.post("/agora")
def agora(body: dict | None = None, user: User = Depends(viewer)):
    """Uma volta já (se o coletor contínuo estiver a dormir, pára-o e arranca uma volta; a guarda volta a ligá-lo depois)."""
    pais = ((body or {}).get("pais") or "").upper()
    _stop()
    _start("uma", *([pais] if pais else []))
    return {"ok": True}


@router.post("/pesquisas")
def pesquisas(body: dict, user: User = Depends(viewer)):
    """Muda as pesquisas de um país, liga/desliga-o ou junta um país novo (código ISO de 2 letras)."""
    pais = str(body.get("pais") or "").upper()
    if len(pais) != 2 or not pais.isalpha():
        raise HTTPException(400, "País: código de 2 letras (UZ, PT, UA...)")
    cfg = json.loads(CFG.read_text(encoding="utf-8"))
    p = cfg["paises"].setdefault(pais, {"nome": body.get("nome") or NOMES.get(pais, pais), "ligado": True, "pesquisas": [""]})
    if "pesquisas" in body:
        lista = [str(x).strip()[:60] for x in body["pesquisas"] if isinstance(x, str)]
        p["pesquisas"] = list(dict.fromkeys(lista))[:25] or [""]
    if "ligado" in body:
        p["ligado"] = bool(body["ligado"])
    if "intervalo_h" in body:
        cfg["intervalo_h"] = max(2, min(48, float(body["intervalo_h"])))
    CFG.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"ok": True}
