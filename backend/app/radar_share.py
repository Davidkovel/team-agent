"""O Radar igual em todos os computadores da pessoa (4 nov, David: «quero que esteja tudo interligado: o que peço no PC
está no telemóvel e o que faço no telemóvel está no PC»; a nuvem do docs/nuvem.md corre 24 h).

As pesquisas, as fichas e o seguimento ficam em ~/.team-agent/radar e nunca foram pelo sync (não estão na base de dados).
Agora cada Hub manda o que mudou aos Hubs dos outros computadores da mesma pessoa, de 2 em 2 minutos, e junta o que
recebe: de cada pesquisa e de cada ficha fica a versão mais recente (a hora do ficheiro vai com ela), o seguimento junta-se
lead a lead pela hora (`at`), e o que se apagou num lado (`apagadas.json`) apaga-se no outro. Assim a nuvem confirma 24 h
as pesquisas feitas no Mac (radar.loop) e o que se pesquisa pelo telemóvel aparece no PC.

Só entre os computadores da própria pessoa, como a memória do Claude (recall_share.py): só os peers da tailnet dela
(recall_share.own), com a chave da equipa, nunca pelo Funnel, por isso nunca chega aos Hubs do Marco e do Kovel.
RECALL_SHARE=0 ou RADAR_SHARE=0 no backend/.env desliga, nos dois sentidos.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
from pathlib import Path

import httpx
from fastapi import APIRouter, HTTPException, Request

from . import radar as R
from . import recall_share, sync
from .config import settings

log = logging.getLogger("team.radar")

FIRST = 60          # segundos depois de o Hub arrancar
EVERY = 120         # entre voltas
QUIETO = 30         # um ficheiro mexido há menos do que isto ainda está a ser escrito (uma ficha a fazer-se): fica para a volta seguinte
MAX_BYTES = 4_000_000   # por pedido; o resto vai na volta seguinte
GUARDA = 60 * 86400     # quanto tempo se lembra do que foi apagado
SCAN = re.compile(r"[a-f0-9]{12}\.json")
FICHA = re.compile(r"[a-f0-9]{12}-[\w-]{1,40}\.json")

router = APIRouter()


def ligado() -> bool:
    return bool(settings.recall_share and settings.team_key and os.environ.get("RADAR_SHARE") != "0")


def _state_path() -> Path:
    return R.DIR / "partilha.json"


def _read(p: Path, default):
    try:
        return json.loads(p.read_text("utf-8"))
    except (OSError, ValueError):
        return default


def _write_json(p: Path, data, mtime: float | None = None) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_name(p.name + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False), "utf-8")
    if mtime:
        os.utime(tmp, (mtime, mtime))
    tmp.replace(p)


def apagadas() -> dict[str, float]:
    """O que se apagou aqui: "scan:<id>", "lead:<chave>" -> quando."""
    return _read(R.DIR / "apagadas.json", {})


def apagar(chaves: list[str], quando: float | None = None) -> None:
    """Chamado pelo Radar quando apaga uma pesquisa ou um lead, para o outro computador também o apagar."""
    if not chaves:
        return
    tombs, agora = apagadas(), time.time()
    for k in chaves:
        tombs[k] = max(tombs.get(k, 0), quando or agora)
    _write_json(R.DIR / "apagadas.json", {k: t for k, t in tombs.items() if agora - t < GUARDA})


# ------------------------------------------------------------------ o que sai daqui

def _ficheiros() -> list[tuple[str, Path]]:
    out = [(p.name, p) for p in R.DIR.glob("*.json") if SCAN.fullmatch(p.name)]
    out += [(f"fichas/{p.name}", p) for p in (R.DIR / "fichas").glob("*.json") if FICHA.fullmatch(p.name)]
    return out


def lote(enviado: dict) -> dict:
    """O que este peer ainda não tem: os ficheiros mudados desde a última vez, o seguimento e as apagadas se mudaram."""
    agora, files, total = time.time(), [], 0
    for nome, p in _ficheiros():
        try:
            mt = p.stat().st_mtime
        except OSError:
            continue
        sid = nome.removeprefix("fichas/")[:12]
        if enviado.get(nome) == mt or agora - mt < QUIETO or sid in R.RADAR.jobs:
            continue
        data = _read(p, None)
        if not isinstance(data, dict):
            continue
        size = p.stat().st_size
        if files and total + size > MAX_BYTES:
            break
        files.append({"nome": nome, "mtime": mt, "data": data})
        total += size
    out: dict = {"files": files}
    seg = R.DIR / "seguimento.json"
    if seg.exists() and enviado.get("seguimento.json") != seg.stat().st_mtime:
        out["leads"], out["leads_mtime"] = _read(seg, {}), seg.stat().st_mtime
    tombs = R.DIR / "apagadas.json"
    if tombs.exists() and enviado.get("apagadas.json") != tombs.stat().st_mtime:
        out["apagadas"], out["apagadas_mtime"] = apagadas(), tombs.stat().st_mtime
    return out


async def send(client: httpx.AsyncClient, peer: str, state: dict) -> int:
    """Uma volta para um peer: quantas coisas foram, 0 quando já tem tudo, -1 quando o Hub dele ainda não sabe receber."""
    enviado = state.setdefault(peer, {})
    body = await asyncio.to_thread(lote, enviado)
    if not body["files"] and "leads" not in body and "apagadas" not in body:
        return 0
    body["computer"] = recall_share.computer()[0]
    res = await client.post(f"{sync._base(peer)}/api/radar/partilha", json=body, headers={"X-Team-Key": settings.team_key})
    if res.status_code in (404, 405):
        return -1
    res.raise_for_status()
    for f in body["files"]:
        enviado[f["nome"]] = f["mtime"]
    if "leads" in body:
        enviado["seguimento.json"] = body["leads_mtime"]
    if "apagadas" in body:
        enviado["apagadas.json"] = body["apagadas_mtime"]
    return len(body["files"]) + ("leads" in body) + ("apagadas" in body)


async def loop():
    await asyncio.sleep(FIRST)
    async with httpx.AsyncClient(timeout=90) as client:
        while True:
            if ligado() and R.DIR.is_dir():
                state = _read(_state_path(), {})
                for peer in [p for p in sync.peers() if await asyncio.to_thread(recall_share.own, p)]:
                    try:
                        for _ in range(10):
                            if await send(client, peer, state) <= 0:
                                break
                            _write_json(_state_path(), state)
                    except (httpx.HTTPError, OSError) as exc:
                        log.info("Radar não foi para %s: %s", peer, exc)
                    except Exception:  # noqa: BLE001  nunca para o Hub
                        log.exception("Radar: volta para %s falhou", peer)
                _write_json(_state_path(), state)
            await asyncio.sleep(EVERY)


# ------------------------------------------------------------------ o que chega dos outros computadores

def juntar(body: dict, de: str = "") -> int:
    """Junta o que outro computador da pessoa mandou; devolve quantas coisas mudaram aqui. `de` é o peer, para não lhe
    devolver o que veio dele."""
    mudou, tombs_in = 0, body.get("apagadas") if isinstance(body.get("apagadas"), dict) else {}
    if tombs_in:
        mine = apagadas()
        novas = {k: float(t) for k, t in tombs_in.items() if isinstance(k, str) and isinstance(t, (int, float)) and t > mine.get(k, 0)}
        if novas:
            _write_json(R.DIR / "apagadas.json", {**mine, **novas})
            mudou += len(novas)
    tombs = apagadas()
    # as pesquisas apagadas lá: apagam-se aqui, se não mudaram depois
    for k, t in tombs.items():
        if k.startswith("scan:"):
            sid = k[5:]
            p = R.DIR / f"{sid}.json"
            if SCAN.fullmatch(p.name) and p.exists() and p.stat().st_mtime <= t and sid not in R.RADAR.jobs:
                p.unlink(missing_ok=True)
                for f in (R.DIR / "fichas").glob(f"{sid}-*.json"):
                    f.unlink(missing_ok=True)
                mudou += 1
    state = _read(_state_path(), {}) if de else {}
    enviado = state.setdefault(de, {}) if de else {}
    agora = time.time()
    for f in body.get("files") or []:
        nome, mt, data = str(f.get("nome") or ""), f.get("mtime"), f.get("data")
        pasta, _, base = nome.rpartition("/")
        if pasta not in ("", "fichas") or not (SCAN if not pasta else FICHA).fullmatch(base) or not isinstance(mt, (int, float)) or not isinstance(data, dict):
            continue
        sid = base[:12]
        if not pasta and data.get("id") != sid:
            continue
        p = R.DIR / nome
        if sid in R.RADAR.jobs or tombs.get(f"scan:{sid}", 0) >= mt or mt > agora + 600:
            continue
        if p.exists() and (p.stat().st_mtime >= mt or agora - p.stat().st_mtime < QUIETO):
            continue
        _write_json(p, data, mt)
        enviado[nome] = mt
        mudou += 1
    leads_in = body.get("leads")
    if isinstance(leads_in, dict):
        leads = R.RADAR._leads()
        antes = json.dumps(leads, sort_keys=True)
        for k, ld in leads_in.items():
            if not isinstance(ld, dict) or not isinstance(ld.get("at"), (int, float)):
                continue
            if tombs.get(f"lead:{k}", 0) >= ld["at"]:
                continue
            if ld["at"] > (leads.get(k) or {}).get("at", 0):
                leads[k] = ld
        for k, t in tombs.items():
            if k.startswith("lead:") and k[5:] in leads and leads[k[5:]].get("at", 0) <= t:
                leads.pop(k[5:])
        if json.dumps(leads, sort_keys=True) != antes:
            R.RADAR._write(leads, partilha=False)
            mudou += 1
    if de:
        _write_json(_state_path(), state)
    return mudou


@router.post("/partilha")
async def take(body: dict, request: Request):
    """Outro computador da pessoa manda o Radar dele (as pesquisas, as fichas, o seguimento, o que apagou)."""
    sync.team_only(request)
    host = request.client.host if request.client else ""
    if request.headers.get("tailscale-funnel-request") or not recall_share.tailnet(host):
        raise HTTPException(403, "Só dos computadores da própria pessoa (a rede Tailscale dela)")
    if not ligado():
        raise HTTPException(403, "A partilha do Radar está desligada neste Hub (RADAR_SHARE=0 ou RECALL_SHARE=0)")
    peer = next((p for p in sync.peers() if recall_share._host(p) == host), "")
    return {"ok": True, "mudou": await asyncio.to_thread(juntar, body, peer)}
