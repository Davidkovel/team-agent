"""Vinted Radar no Hub (#/vinted, 11 nov, David): escolher as categorias, ligar/desligar o coletor Selenium e ver as
oportunidades (artigos bem abaixo do preço de mercado).

O motor é o repositório vinted-radar (`~/vinted-radar` ou `VINTED_RADAR_DIR`): `radar.py correr` abre um Chrome sem
janela, lê a pesquisa pública do Vinted de 5 em 5 min e guarda em `radar.db`. O Hub só lê esse SQLite, escreve o
`config/nichos.json` e arranca/pára o processo. Por PC, nada vai por sync. Compra sempre manual.

12 nov (Marco: «sempre que seleciono Ligado Contínuo... tenha sempre um agente de 24 horas que sempre olhe», «organizar
tudo por temas e grupos dos produtos»):
- Grupos: cada categoria pertence a um tema (`grupo` no nichos.json; sem ele, Tecnologia se for `tech`, senão Roupa).
- Contínuo: com `continuo` no ~/.team-agent/vinted.json a guarda (`loop`, de minuto a minuto, dentro do Hub) volta a
  arrancar o coletor se ele morrer ou ficar preso, e arranca-o quando o Hub abre. Não é um Claude: não gasta tokens.
  Se ele morrer três vezes logo ao arrancar (falta o Selenium ou o Chrome), a guarda espera 10 min e diz porquê.
- Procurar agora (reinicia o coletor: a primeira coisa que ele faz é uma volta) e esconder oportunidades já vistas.

13 nov (Marco: «orçamento da empresa, o dinheiro que vais poder usar... os feedbacks, as avaliações»):
- Orçamento (no vinted.json deste PC): total, máximo por artigo e por noite. Cada oportunidade tem o seu custo real (preço +
  proteção do comprador + portes) e diz se cabe. O «plano de compra» escolhe, das que cabem, as de maior lucro até esgotar
  o que se pode gastar. As compras marcam-se à mão («Comprei», depois «Vendi por»): daí saem o investido, o disponível e o
  lucro real. Nada aqui compra sozinho: o Hub não tem conta no Vinted nem forma de pagar.
- Vendedor: estrelas e número de avaliações de quem vende, lidos pelo coletor na página do artigo quando ele vira oportunidade.
"""
from __future__ import annotations

import asyncio
import importlib.util
import json
import logging
import os
import shutil
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
_HOME_DIR = Path.home() / "vinted-radar"
# Ordem: VINTED_RADAR_DIR > ~/vinted-radar (o PC do David, com os dados dele) > a cópia que vem no team-agent.
DIR = Path(os.environ.get("VINTED_RADAR_DIR") or (_HOME_DIR if _HOME_DIR.exists() else Path(__file__).resolve().parents[3] / "vinted-radar"))
CFG = DIR / "config" / "nichos.json"
PIDF = Path.home() / ".team-agent" / "vinted.json"
log = logging.getLogger("team.vinted")
GRUPOS = ("Roupa", "Tecnologia", "Casa", "Outros")
TECH_PALAVRAS = ("iphone", "macbook", "ipad", "airpods", "apple watch", "samsung", "galaxy", "pixel", "playstation", "ps4", "ps5",
                 "xbox", "nintendo", "switch", "gopro", "kindle", "portátil", "portatil", "laptop", "monitor", "teclado",
                 "headphones", "auscultadores", "câmara", "camera", "drone", "steam deck", "bose", "sony", "dyson")
VIGIA_S = 60          # de quanto em quanto a guarda olha
MORTE_CEDO_S = 45     # morrer antes disto depois de arrancar = não consegue correr (falta qualquer coisa)
ESPERA_S = 600        # depois de três mortes cedo seguidas
LIMITES = ("margem_min_eur", "margem_min_pct", "max_pct_do_mercado", "percentil_max", "preco_max", "intervalo_min")


def _python() -> str:
    """O Python que tem o Selenium: o do venv do Hub se o tiver (Mac), senão o de fora do venv."""
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


def grupo_de(n: dict) -> str:
    return n.get("grupo") or ("Tecnologia" if n.get("tech") else "Roupa")


def _chrome() -> bool:
    if sys.platform == "darwin":
        return any(Path(p).exists() for p in ("/Applications/Google Chrome.app", str(Path.home() / "Applications/Google Chrome.app")))
    if os.name == "nt":
        return any((Path(os.environ.get(v, "")) / "Google/Chrome/Application/chrome.exe").exists()
                   for v in ("PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA") if os.environ.get(v))
    return bool(shutil.which("google-chrome") or shutil.which("chromium") or shutil.which("chromium-browser"))


def _selenium() -> bool:
    py = _python()
    if py == sys.executable:
        return importlib.util.find_spec("selenium") is not None
    try:
        return subprocess.run([py, "-c", "import selenium"], capture_output=True, timeout=20,
                              creationflags=0x08000000 if os.name == "nt" else 0).returncode == 0
    except Exception:
        return False


_pronto_cache: tuple[float, dict] = (0.0, {})


def _pronto() -> dict:
    """O que o coletor precisa neste PC. Visto no máximo de 5 em 5 min: perguntar ao outro Python custa."""
    global _pronto_cache
    if time.time() - _pronto_cache[0] > 300 or not _pronto_cache[1]:
        sel = _selenium()
        # sem Chrome instalado o Selenium (4.11+) descarrega o seu («Chrome for Testing», em ~/.cache/selenium): visto no Mac a 12 nov
        _pronto_cache = (time.time(), {"selenium": sel, "chrome": sel or _chrome()})
    return _pronto_cache[1]


def _ultimo_erro() -> str:
    """A última linha do radar.log quando o coletor morreu: é quase sempre o porquê."""
    try:
        linhas = [x.strip() for x in (DIR / "radar.log").read_text(encoding="utf-8", errors="replace")[-4000:].splitlines() if x.strip()]
    except OSError:
        return ""
    fim = linhas[-1] if linhas else ""
    return fim[:200] if ("Error" in fim or "Exception" in fim or "erro" in fim.lower()) else ""


def _pid() -> int | None:
    pid = _ficha().get("pid")
    if not pid:
        return None
    if os.name == "nt":
        out = subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/NH"], capture_output=True, text=True,
                             creationflags=0x08000000).stdout
        return pid if str(pid) in out else None
    try:
        if os.waitpid(pid, os.WNOHANG)[0] == pid:   # era filho deste Hub e já morreu: sem isto ficava «vivo» (zombie) para sempre
            return None
    except OSError:
        pass   # não é filho deste Hub (arrancou-o um Hub anterior)
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
                         creationflags=flags, env={**os.environ, "PYTHONIOENCODING": "utf-8"},
                         start_new_session=os.name != "nt")   # grupo próprio: parar leva também o Chrome que ele abriu
    _guardar_ficha(pid=p.pid, desde=time.strftime("%Y-%m-%d %H:%M:%S"), arrancou=time.time())


def _stop():
    pid = _pid()
    if not pid:
        return
    if os.name == "nt":   # leva também o Chrome e o chromedriver que ele abriu
        subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True, creationflags=0x08000000)
    else:
        try:
            os.killpg(pid, signal.SIGTERM)
        except OSError:
            try:
                os.kill(pid, signal.SIGTERM)
            except OSError:
                pass


def _preso(intervalo_min: float) -> bool:
    """O processo existe mas o status.json não mexe há muito: Chrome pendurado."""
    try:
        st = json.loads((DIR / "status.json").read_text(encoding="utf-8"))
        visto = time.mktime(time.strptime(st["em"], "%Y-%m-%d %H:%M:%S"))
    except Exception:
        return False
    arrancou = _ficha().get("arrancou") or 0
    return time.time() - max(visto, arrancou) > max(20 * 60, 3 * intervalo_min * 60 + 600)


def vigiar():
    """Uma volta da guarda do modo contínuo."""
    f = _ficha()
    if not f.get("continuo") or not CFG.exists():
        return
    if time.time() < (f.get("espera_ate") or 0):
        return
    pid = _pid()
    if pid:
        if _preso(_cfg().get("intervalo_min", 5)):
            log.warning("Vinted Radar preso: a guarda reinicia-o")
            _stop()
            time.sleep(1)
            _start()
            _guardar_ficha(reinicios=(f.get("reinicios") or 0) + 1, ultimo_reinicio=time.strftime("%Y-%m-%d %H:%M:%S"), motivo="estava preso")
        elif f.get("cedo") and time.time() - (f.get("arrancou") or 0) > MORTE_CEDO_S:
            _guardar_ficha(cedo=0, erro_guarda="")   # aguentou: está a correr
        return
    cedo = (f.get("cedo") or 0) + 1 if time.time() - (f.get("arrancou") or 0) < MORTE_CEDO_S + VIGIA_S else 1
    if cedo >= 3:
        pronto = _pronto()
        porque = ("Falta o Selenium no Python do coletor" if not pronto["selenium"] else "Falta o Google Chrome neste computador"
                  if not pronto["chrome"] else _ultimo_erro() or "O coletor morre logo ao arrancar")
        _guardar_ficha(cedo=0, espera_ate=time.time() + ESPERA_S, erro_guarda=porque)
        log.warning("Vinted Radar não arranca (%s): a guarda volta a tentar em %d min", porque, ESPERA_S // 60)
        return
    _start()
    _guardar_ficha(cedo=cedo, reinicios=(f.get("reinicios") or 0) + (1 if f.get("ja_correu") else 0), ja_correu=True,
                   ultimo_reinicio=time.strftime("%Y-%m-%d %H:%M:%S"), motivo="tinha parado")


async def loop():
    """A guarda de 24 h: enquanto o modo contínuo estiver ligado, o coletor não fica parado."""
    await asyncio.sleep(20)   # o Hub primeiro
    while True:
        try:
            await asyncio.to_thread(vigiar)
        except Exception:
            log.exception("A guarda do Vinted Radar falhou")
        await asyncio.sleep(VIGIA_S)


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


def _custo(preco: float, cfg: dict) -> float:
    """O que um artigo custa de facto a comprar: preço + proteção do comprador + portes (a mesma conta do radar.py)."""
    prot = cfg.get("protecao_comprador") or {}
    return round(preco + prot.get("fixo", 0.7) + preco * prot.get("pct", 0.05) + cfg.get("portes_compra_eur", 4.0), 2)


def _contas(f: dict) -> dict:
    """O orçamento e o que já saiu dele. Disponível = orçamento - o que está investido em artigos ainda por vender."""
    o = {"total": 0, "por_artigo": 0, "por_noite": 0, **(f.get("orcamento") or {})}
    compras = f.get("compras") or []
    em_stock = [c for c in compras if c.get("vendido") is None]
    vendidas = [c for c in compras if c.get("vendido") is not None]
    investido = round(sum(c["custo"] for c in em_stock), 2)
    hoje = time.strftime("%Y-%m-%d")
    return {**o, "investido": investido, "disponivel": round(o["total"] - investido, 2) if o["total"] else None,
            "gasto_hoje": round(sum(c["custo"] for c in compras if (c.get("quando") or "") >= hoje), 2),
            "lucro_real": round(sum(c["vendido"] - c["custo"] for c in vendidas), 2) if vendidas else None,
            "lucro_previsto": round(sum(c.get("lucro_previsto") or 0 for c in em_stock), 2),
            "em_stock": len(em_stock), "vendidas": len(vendidas)}


def _plano(alertas: list, contas: dict) -> dict:
    """Das oportunidades que cabem no máximo por artigo, as de maior lucro primeiro, até ao que se pode gastar esta noite."""
    if not contas["total"]:
        return {"ids": [], "custo": 0, "lucro": 0, "teto": None}
    teto = max(0.0, contas["disponivel"])
    if contas["por_noite"]:
        teto = min(teto, max(0.0, contas["por_noite"] - contas["gasto_hoje"]))
    ids, custo, lucro = [], 0.0, 0.0
    for a in sorted(alertas, key=lambda a: -(a.get("lucro") or 0)):
        if contas["por_artigo"] and a["custo"] > contas["por_artigo"]:
            continue
        if custo + a["custo"] <= teto:
            ids.append(a["id"])
            custo += a["custo"]
            lucro += a.get("lucro") or 0
    return {"ids": ids, "custo": round(custo, 2), "lucro": round(lucro, 2), "teto": round(teto, 2)}


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
    f = _ficha()
    escondidos = set(f.get("escondidos") or [])
    grupo = {n["nome"]: grupo_de(n) for n in cfg["nichos"]}
    nichos = [{"nome": n["nome"], "pesquisa": n["pesquisa"], "ativo": n.get("ativo", True), "grupo": grupo_de(n),
               "anuncios": por.get(n["nome"], (0, None))[0], "ultimo": por.get(n["nome"], (0, None))[1],
               "hoje": novos_hoje.get(n["nome"], 0)} for n in cfg["nichos"]]
    cols = ["id", "nicho", "titulo", "marca", "tamanho", "estado", "preco", "foto", "link", "visto_em",
            "mediana", "lucro", "comparaveis", "alertado_em"]
    ha = {r[1] for r in _rows("PRAGMA table_info(anuncios)")}   # um radar.db de antes de 13 nov ainda não tem o vendedor
    cols += [c for c in ("vendedor", "estrelas", "avaliacoes") if c in ha]
    alertas = [dict(zip(cols, r)) for r in _rows(f"SELECT {','.join(cols)} FROM anuncios WHERE alertado=1 "
                                                  "ORDER BY coalesce(alertado_em, visto_em) DESC LIMIT 200")]
    n_escondidos = sum(1 for a in alertas if a["id"] in escondidos)
    compradas = {c["id"] for c in f.get("compras") or []}
    contas = _contas(f)
    alertas = [{"vendedor": None, "estrelas": None, "avaliacoes": None, **a, "grupo": grupo.get(a["nicho"], "Outros"), "custo": _custo(a["preco"], cfg)}
               for a in alertas if a["id"] not in escondidos and a["id"] not in compradas][:120]
    plano = _plano(alertas, contas)
    for a in alertas:
        a["no_plano"] = a["id"] in plano["ids"]
        a["cabe"] = None if not contas["total"] else (a["custo"] <= contas["disponivel"] and not (contas["por_artigo"] and a["custo"] > contas["por_artigo"]))
    pid = _pid()
    ordem = [g for g in GRUPOS if any(n["grupo"] == g for n in nichos)] + sorted({n["grupo"] for n in nichos} - set(GRUPOS))
    espera = max(0, int((f.get("espera_ate") or 0) - time.time()))
    return {"instalado": True, "ligado": bool(pid), "estado": st if pid else {}, "nichos": nichos, "alertas": alertas,
            "grupos": ordem, "grupos_possiveis": list(GRUPOS), "escondidos": n_escondidos, "desde": f.get("desde") if pid else None,
            "continuo": bool(f.get("continuo")), "pronto": _pronto(),
            "guarda": {"reinicios": f.get("reinicios") or 0, "ultimo_reinicio": f.get("ultimo_reinicio"), "motivo": f.get("motivo"),
                       "erro": f.get("erro_guarda") or "", "espera_s": espera, "desde": f.get("continuo_desde")},
            "orcamento": contas, "plano": plano, "compras": list(reversed(f.get("compras") or []))[:60],
            "ultimo_erro": "" if pid or not f.get("querido") else _ultimo_erro(),   # só se devia estar ligado e não está
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
    if "continuo" in body:   # o modo contínuo: a guarda mantém-no ligado, e ligá-lo liga já o coletor
        on = bool(body["continuo"])
        _guardar_ficha(continuo=on, cedo=0, espera_ate=0, erro_guarda="", **({"querido": True, "continuo_desde": time.strftime("%Y-%m-%d %H:%M:%S"),
                                                                              "reinicios": 0, "ja_correu": True} if on else {}))
        if on:
            _start()
    elif body.get("on"):
        _guardar_ficha(cedo=0, espera_ate=0, erro_guarda="", querido=True)
        _start()
    else:
        _guardar_ficha(continuo=False, querido=False)   # desligar à mão desliga também a guarda, senão ela voltava a ligá-lo
        _stop()
    time.sleep(0.5)
    return _view()


@router.post("/agora")
def agora(user: User = Depends(viewer)):
    """Uma volta já: o coletor recomeça, e a primeira coisa que faz é ver todas as categorias ligadas."""
    if not CFG.exists():
        raise HTTPException(404, f"Falta o vinted-radar em {DIR}")
    _stop()
    time.sleep(1)
    _guardar_ficha(cedo=0, espera_ate=0, erro_guarda="", querido=True)
    _start()
    time.sleep(0.5)
    return _view()


@router.post("/orcamento")
def orcamento(body: dict, user: User = Depends(viewer)):
    """O dinheiro que se pode usar: total, máximo por artigo, máximo por noite (0 = sem esse limite)."""
    o = {**{"total": 0, "por_artigo": 0, "por_noite": 0}, **(_ficha().get("orcamento") or {})}
    for k in ("total", "por_artigo", "por_noite"):
        v = body.get(k)
        if isinstance(v, (int, float)) and 0 <= v <= 1_000_000:
            o[k] = round(float(v), 2)
    _guardar_ficha(orcamento=o)
    return _view()


@router.post("/compra")
def compra(body: dict, user: User = Depends(viewer)):
    """Registar à mão o que se comprou e por quanto se vendeu. {"id"} comprei; {"vendido": {"id", "valor"}}; {"tirar": id}."""
    f = _ficha()
    compras = list(f.get("compras") or [])
    if isinstance(body.get("id"), int):
        if any(c["id"] == body["id"] for c in compras):
            raise HTTPException(400, "Essa compra já está registada")
        r = _rows("SELECT id, nicho, titulo, preco, link, foto, lucro FROM anuncios WHERE id=?", (body["id"],))
        if not r:
            raise HTTPException(404, "Esse artigo já não está no radar")
        i, nicho, titulo, preco, link, foto, lucro = r[0]
        custo = body.get("custo") if isinstance(body.get("custo"), (int, float)) and body["custo"] > 0 else _custo(preco, _cfg())
        if lucro is None:   # comprado a partir do catálogo (não era oportunidade): o lucro previsto vem do preço de referência
            lucro = (_catalogo()["por_id"].get(i) or {}).get("lucro_est")
        compras.append({"id": i, "nicho": nicho, "titulo": titulo, "preco": preco, "custo": round(float(custo), 2), "link": link, "foto": foto,
                        "lucro_previsto": round(lucro, 2) if lucro is not None else None, "quando": time.strftime("%Y-%m-%d %H:%M:%S"),
                        "quem": user.username, "vendido": None})
    v = body.get("vendido")
    if isinstance(v, dict):
        for c in compras:
            if c["id"] == v.get("id"):
                c["vendido"] = round(float(v["valor"]), 2) if isinstance(v.get("valor"), (int, float)) and v["valor"] >= 0 else None
                c["vendido_em"] = time.strftime("%Y-%m-%d %H:%M:%S") if c["vendido"] is not None else None
    av = body.get("a_venda")   # {"id", "valor"}: posto à venda por esse preço (None tira)
    if isinstance(av, dict):
        for c in compras:
            if c["id"] == av.get("id"):
                c["a_venda"] = round(float(av["valor"]), 2) if isinstance(av.get("valor"), (int, float)) and av["valor"] > 0 else None
    if isinstance(body.get("tirar"), int):
        compras = [c for c in compras if c["id"] != body["tirar"]]
    _guardar_ficha(compras=compras[-300:])
    return _view()


@router.post("/esconder")
def esconder(body: dict, user: User = Depends(viewer)):
    """Tirar da lista uma oportunidade já vista (fica no radar.db; só deixa de aparecer aqui). `repor` mostra todas outra vez."""
    f = _ficha()
    if body.get("repor"):
        _guardar_ficha(escondidos=[])
    elif isinstance(body.get("id"), int):
        _guardar_ficha(escondidos=(list(f.get("escondidos") or []) + [body["id"]])[-500:])
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
        tech = any(w in pesq.lower() for w in ("iphone", "macbook", "ipad"))   # modelo + armazenamento em vez do tipo de roupa
        g = str(novo.get("grupo") or "").strip()[:30]
        if g not in GRUPOS:
            g = "Tecnologia" if tech or any(w in pesq.lower() for w in TECH_PALAVRAS) else "Roupa"
        cfg["nichos"].append({"nome": nome or pesq, "pesquisa": pesq, "tamanhos": [], "ativo": True, "grupo": g,
                              **({"tech": True, "preco_max": 1200} if tech else {"preco_max": 600} if g == "Tecnologia" else {})})
    mover = body.get("mover")   # {"nome":..., "grupo":...}: a categoria passa para outro tema
    if isinstance(mover, dict) and mover.get("grupo") in GRUPOS:
        for n in cfg["nichos"]:
            if n["nome"] == mover.get("nome"):
                n["grupo"] = mover["grupo"]
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


# ------------------------------------------------------------------ CRM de produtos (13 nov, Marco)
# «No radar depois nem dá para ver as fotos ou as páginas dos produtos... quero uma espécie de cérebro... um CRM mas em
# produtos»: a página só mostrava as oportunidades (os poucos que passam a regra), e os centenas de anúncios que o coletor
# guarda ficavam invisíveis. Agora todos se veem, com foto, link, o preço de referência do mercado e uma etapa de CRM:
# Na mira -> A negociar -> Comprado -> À venda -> Vendido (ou Descartado). As duas primeiras e as notas ficam no
# vinted.json («crm»); Comprado/À venda/Vendido são as compras que já existiam.
ETAPAS = {"mira": "Na mira", "negociar": "A negociar", "descartado": "Descartado"}
MIN_REF = 6           # comparáveis para haver preço de referência
_CAT: dict = {"chave": None, "itens": [], "mercado": {}}


def _estado_g(e: str | None) -> str:
    return "novo" if (e or "").startswith("Novo") else "usado"


def _med(v: list) -> float:
    v = sorted(v)
    n = len(v)
    return round(v[n // 2] if n % 2 else (v[n // 2 - 1] + v[n // 2]) / 2, 2)


def _quantil(v: list, q: float) -> float:
    v = sorted(v)
    return round(v[min(len(v) - 1, int(q * len(v)))], 2)


def _catalogo() -> dict:
    """Todos os anúncios do radar.db com o preço de referência de cada um (mediana dos parecidos: mesma categoria, marca e
    estado; se forem poucos, mesma categoria e estado). Refeito só quando o radar.db muda."""
    db = DIR / "radar.db"
    try:
        chave = (db.stat().st_mtime, CFG.stat().st_mtime)
    except OSError:
        return {"itens": [], "mercado": {}, "por_id": {}}
    if _CAT["chave"] == chave:
        return _CAT
    cfg = _cfg()
    grupo = {n["nome"]: grupo_de(n) for n in cfg["nichos"]}
    ha = {r[1] for r in _rows("PRAGMA table_info(anuncios)")}
    cols = ["id", "nicho", "titulo", "marca", "tamanho", "estado", "preco", "foto", "link", "visto_em", "origem", "alertado",
            "mediana", "lucro", "comparaveis", "alertado_em"] + [c for c in ("vendedor", "estrelas", "avaliacoes") if c in ha]
    itens = [dict(zip(cols, r)) for r in _rows(f"SELECT {','.join(cols)} FROM anuncios WHERE preco > 0")]
    por_marca, por_cat = {}, {}
    for a in itens:
        a.setdefault("vendedor", None); a.setdefault("estrelas", None); a.setdefault("avaliacoes", None)
        a["marca"] = (a["marca"] or "").strip()
        a["grupo"] = grupo.get(a["nicho"], "Outros")
        a["eg"] = _estado_g(a["estado"])
        por_marca.setdefault((a["nicho"], a["marca"].lower(), a["eg"]), []).append(a["preco"])
        por_cat.setdefault((a["nicho"], a["eg"]), []).append(a["preco"])
    meds = {k: _med(v) for k, v in {**por_marca, **{("cat",) + k: v for k, v in por_cat.items()}}.items() if len(v) >= MIN_REF}
    for a in itens:
        km, kc = (a["nicho"], a["marca"].lower(), a["eg"]), ("cat", a["nicho"], a["eg"])
        if a["alertado"] and a["mediana"]:
            ref, base, n = a["mediana"], "radar", a["comparaveis"]
        elif a["marca"] and km in meds:
            ref, base, n = meds[km], "marca", len(por_marca[km])
        elif kc in meds:
            ref, base, n = meds[kc], "categoria", len(por_cat[kc[1:]])
        else:
            ref, base, n = None, None, 0
        custo = _custo(a["preco"], cfg)
        a.update(ref=ref, ref_base=base, ref_n=n, custo=custo,
                 desconto=round(1 - a["preco"] / ref, 3) if ref else None,
                 lucro_est=round(a["lucro"], 2) if a["alertado"] and a["lucro"] is not None else (round(ref - custo, 2) if ref else None))
    itens.sort(key=lambda a: a["visto_em"] or "", reverse=True)
    mercado = {}
    for nicho in {a["nicho"] for a in itens}:
        ps = [a["preco"] for a in itens if a["nicho"] == nicho]
        marcas = {}
        for a in itens:
            if a["nicho"] == nicho and a["marca"]:
                marcas.setdefault(a["marca"], []).append(a["preco"])
        mercado[nicho] = {"nicho": nicho, "grupo": grupo.get(nicho, "Outros"), "n": len(ps), "mediana": _med(ps),
                          "p25": _quantil(ps, .25), "p75": _quantil(ps, .75), "min": min(ps), "max": max(ps),
                          "marcas": sorted(({"marca": m, "n": len(v), "mediana": _med(v), "min": min(v)} for m, v in marcas.items()),
                                           key=lambda m: -m["n"])[:12]}
    _CAT.update(chave=chave, itens=itens, mercado=mercado, por_id={a["id"]: a for a in itens})
    return _CAT


def _etapa(a: dict, crm: dict, compras: dict) -> str:
    c = compras.get(a["id"])
    if c:
        return "vendido" if c.get("vendido") is not None else "venda" if c.get("a_venda") else "comprado"
    return (crm.get(str(a["id"])) or {}).get("etapa") or ""


def _publico(a: dict, crm: dict, compras: dict) -> dict:
    out = {k: v for k, v in a.items() if k not in ("eg", "origem")}
    ficha = crm.get(str(a["id"])) or {}
    out.update(etapa=_etapa(a, crm, compras), nota=ficha.get("nota") or "", oferta=ficha.get("oferta"),
               compra=compras.get(a["id"]))
    return out


@router.get("/produtos")
def produtos(q: str = "", grupo: str = "", nicho: str = "", marca: str = "", estado: str = "", etapa: str = "",
             so: str = "", ordem: str = "recente", pmin: float = 0, pmax: float = 0, offset: int = 0, limit: int = 60,
             user: User = Depends(viewer)):
    """O catálogo: todos os anúncios que o radar guardou, com filtros, ordem e a etapa de CRM de cada um."""
    cat = _catalogo()
    f = _ficha()
    crm, compras = f.get("crm") or {}, {c["id"]: c for c in f.get("compras") or []}
    termos = [w for w in q.lower().split() if w]
    lista = []
    for a in cat["itens"]:
        if grupo and a["grupo"] != grupo or nicho and a["nicho"] != nicho or marca and a["marca"].lower() != marca.lower():
            continue
        if estado and a["eg"] != estado or pmin and a["preco"] < pmin or pmax and a["preco"] > pmax:
            continue
        if termos and not all(w in f"{a['titulo']} {a['marca']} {a['nicho']} {a['tamanho'] or ''}".lower() for w in termos):
            continue
        e = _etapa(a, crm, compras)
        if etapa == "crm" and not e or etapa and etapa != "crm" and e != etapa or not etapa and e == "descartado":
            continue
        if so == "abaixo" and not (a["desconto"] is not None and a["desconto"] >= 0.3):
            continue
        if so == "oport" and not a["alertado"]:
            continue
        lista.append(a)
    chaves = {"recente": lambda a: a["visto_em"] or "", "desconto": lambda a: a["desconto"] if a["desconto"] is not None else -9,
              "lucro": lambda a: a["lucro_est"] if a["lucro_est"] is not None else -9e9, "barato": lambda a: -a["preco"],
              "caro": lambda a: a["preco"]}
    lista.sort(key=chaves.get(ordem, chaves["recente"]), reverse=True)
    base = [a for a in cat["itens"] if (not grupo or a["grupo"] == grupo)]
    contar = lambda k: sorted(((v, sum(1 for a in base if a[k] == v)) for v in {a[k] for a in base if a[k]}), key=lambda x: -x[1])
    limit = max(1, min(120, limit))
    return {"total": len(lista), "offset": offset, "itens": [_publico(a, crm, compras) for a in lista[offset:offset + limit]],
            "nichos": contar("nicho"), "marcas": contar("marca")[:40], "todos": len(cat["itens"]),
            "abaixo": sum(1 for a in base if a["desconto"] is not None and a["desconto"] >= 0.3)}


@router.get("/produto/{pid}")
def produto(pid: int, user: User = Depends(viewer)):
    """A ficha de um produto: tudo o que se sabe dele, os parecidos que dão o preço de referência e a etapa de CRM."""
    cat = _catalogo()
    a = cat["por_id"].get(pid)
    if not a:
        raise HTTPException(404, "Esse artigo já não está no radar")
    f = _ficha()
    crm, compras = f.get("crm") or {}, {c["id"]: c for c in f.get("compras") or []}
    if a["ref_base"] in ("marca", "radar") and a["marca"]:
        par = [b for b in cat["itens"] if b["nicho"] == a["nicho"] and b["marca"].lower() == a["marca"].lower() and b["eg"] == a["eg"]]
    else:
        par = [b for b in cat["itens"] if b["nicho"] == a["nicho"] and b["eg"] == a["eg"]]
    precos = sorted(b["preco"] for b in par)
    pos = round(sum(p < a["preco"] for p in precos) / len(precos), 3) if precos else None
    parecidos = sorted((b for b in par if b["id"] != pid), key=lambda b: abs(b["preco"] - (a["ref"] or a["preco"])))[:12]
    return {"item": _publico(a, crm, compras), "posicao": pos, "precos": precos[:400],
            "parecidos": [_publico(b, crm, compras) for b in sorted(parecidos, key=lambda b: b["preco"])],
            "mercado": cat["mercado"].get(a["nicho"]), "historia": (crm.get(str(pid)) or {}).get("historia") or []}


@router.post("/produto")
def produto_crm(body: dict, user: User = Depends(viewer)):
    """Mudar a etapa, a nota ou a oferta de um produto. {"id", "etapa": "mira"|"negociar"|"descartado"|"", "nota", "oferta"}.
    Comprado/À venda/Vendido vão por /compra (mexem no orçamento)."""
    pid = body.get("id")
    if not isinstance(pid, int) or pid not in _catalogo()["por_id"]:
        raise HTTPException(404, "Esse artigo já não está no radar")
    f = _ficha()
    crm = dict(f.get("crm") or {})
    ficha = dict(crm.get(str(pid)) or {})
    hist = list(ficha.get("historia") or [])
    agora = time.strftime("%Y-%m-%d %H:%M:%S")
    if "etapa" in body:
        e = body["etapa"] or ""
        if e and e not in ETAPAS:
            raise HTTPException(400, "Etapa desconhecida")
        if e != ficha.get("etapa", ""):
            hist.append({"em": agora, "quem": user.username, "o": ETAPAS.get(e, "Tirado do CRM")})
        ficha["etapa"] = e
    if isinstance(body.get("nota"), str):
        ficha["nota"] = body["nota"].strip()[:2000]
    if "oferta" in body:
        v = body["oferta"]
        ficha["oferta"] = round(float(v), 2) if isinstance(v, (int, float)) and v > 0 else None
        if ficha["oferta"]:
            hist.append({"em": agora, "quem": user.username, "o": f"Oferta de {ficha['oferta']:.2f} €".replace(".", ",")})
    ficha["historia"] = hist[-30:]
    ficha["em"] = agora
    if not ficha.get("etapa") and not ficha.get("nota") and not ficha.get("oferta"):
        crm.pop(str(pid), None)
    else:
        crm[str(pid)] = ficha
    _guardar_ficha(crm=crm)
    return produto(pid, user)


@router.get("/pipeline")
def pipeline(user: User = Depends(viewer)):
    """As colunas do CRM: o que está na mira, a negociar, comprado, à venda e vendido."""
    cat = _catalogo()
    f = _ficha()
    crm, lista_c = f.get("crm") or {}, f.get("compras") or []
    compras = {c["id"]: c for c in lista_c}
    cols = {k: [] for k in ("mira", "negociar", "comprado", "venda", "vendido")}
    for sid, ficha in crm.items():
        a = cat["por_id"].get(int(sid))
        if a and ficha.get("etapa") in ("mira", "negociar") and int(sid) not in compras:
            cols[ficha["etapa"]].append(_publico(a, crm, compras))
    for c in reversed(lista_c):
        a = cat["por_id"].get(c["id"])
        item = _publico(a, crm, compras) if a else {"id": c["id"], "titulo": c["titulo"], "nicho": c["nicho"], "preco": c["preco"],
                                                     "foto": c.get("foto"), "link": c["link"], "compra": c, "nota": "", "ref": None,
                                                     "lucro_est": c.get("lucro_previsto"), "desconto": None, "grupo": "Outros"}
        item["etapa"] = "vendido" if c.get("vendido") is not None else "venda" if c.get("a_venda") else "comprado"
        cols[item["etapa"]].append(item)
    return {"colunas": cols, "orcamento": _contas(f)}


@router.get("/mercado")
def mercado(user: User = Depends(viewer)):
    """O cérebro: por categoria, quantos anúncios, o preço do meio e o intervalo normal, as marcas mais vistas e o ritmo de
    anúncios novos por dia (dos últimos 14 dias)."""
    cat = _catalogo()
    dias = {}
    for a in cat["itens"]:
        d = (a["visto_em"] or "")[:10]
        if d:
            dias[d] = dias.get(d, 0) + 1
    hoje = time.time()
    serie = [{"dia": time.strftime("%Y-%m-%d", time.localtime(hoje - 86400 * i))} for i in range(13, -1, -1)]
    for s in serie:
        s["n"] = dias.get(s["dia"], 0)
    return {"categorias": sorted(cat["mercado"].values(), key=lambda m: -m["n"]), "dias": serie, "total": len(cat["itens"]),
            "com_ref": sum(1 for a in cat["itens"] if a["ref"]), "abaixo": sum(1 for a in cat["itens"] if (a["desconto"] or 0) >= 0.3)}
