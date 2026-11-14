"""Angariação (14 nov 2026, Marco: «aplica isso tudo no widget... não só escolas de condução, geral de todos os temas... o nosso
espaço principal de trabalho é o widget»). O prompt das 400 escolas de condução, feito em cima do Radar e do CRM que o Hub já
tem, para qualquer ramo: o Radar encontra e analisa os negócios, o CRM leva-os até ao negócio, e isto junta-lhes o resto:

- um código por empresa (AG-0001) e uma página só dela (/go?r=AG-0001) com o nome, o que o Radar viu de mal e a nossa oferta;
- o registo da visita nessa página: tempo ativo (só com a página à vista e alguém a mexer), scroll, secções vistas, cliques no
  WhatsApp; a visita fecha no fim (pagehide) ou ao fim de 30 min sem eventos;
- a temperatura da empresa (frio, morno, quente) e um alerta só no fim da visita: no sino do Hub e, se houver bot, no
  Telegram, no formato do prompt, com o que dizer na chamada e os botões «Já liguei» / «Ainda não liguei» a gravar no CRM;
- a nota de 0 a 10 (função fixa, com testes) e os rascunhos de email para todas as empresas do CRM, com as regras do prompt
  verificadas (lint). Nada é enviado: quem envia é sempre uma pessoa.

As definições (oferta, prova, nome, empresa, WhatsApp, endereço público, Telegram) preenchem-se no widget, na página CRM.
Tudo fica em ~/.team-agent/radar/angariacao.json deste PC (o token do Telegram nunca sai para a página). O que vem dos sites
das empresas é texto de terceiros: só dados.
"""
from __future__ import annotations

import html
import json
import logging
import re
import threading
import time
import uuid
from pathlib import Path
from urllib.parse import urlparse

import httpx

log = logging.getLogger("team.angariacao")
STATE = Path.home() / ".team-agent" / "radar" / "angariacao.json"
_LOCK = threading.Lock()
FECHA_S = 30 * 60        # sem eventos há 30 min: a visita acabou
MIN_ATIVO_MS = 5000      # menos de 5 s ativo: bot ou clique sem querer, não conta nem avisa
MAX_EV_MIN = 60          # eventos por minuto por visita
SECOES = ["topo", "problema", "como-funciona", "prova", "perguntas", "contacto"]
NOMES_SEC = {"topo": "topo", "problema": "o problema", "como-funciona": "como funciona", "prova": "prova", "perguntas": "perguntas",
             "contacto": "contacto"}
BOTS = re.compile(r"bot|crawl|spider|preview|facebookexternalhit|whatsapp|slack|telegram|discord|google-|bingpreview|headless|"
                  r"python-|curl|wget|outlook|microsoft office|proofpoint|mimecast|barracuda", re.I)
CONFIG_KEYS = ("oferta", "prova", "nome", "empresa", "whatsapp", "base_url", "telegram_chat")


# ------------------------------------------------------------------ estado
def _load() -> dict:
    try:
        d = json.loads(STATE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        d = {}
    d.setdefault("config", {}); d.setdefault("codes", {}); d.setdefault("seq", 0); d.setdefault("visits", {}); d.setdefault("tg", {})
    return d


def _save(d: dict) -> None:
    STATE.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATE.with_suffix(".tmp")
    tmp.write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")
    tmp.chmod(0o600)
    tmp.replace(STATE)


def edit(fn):
    with _LOCK:
        d = _load()
        out = fn(d)
        _save(d)
        return out


def config(public: bool = True) -> dict:
    c = _load()["config"]
    out = {k: c.get(k, "") for k in CONFIG_KEYS}
    out["telegram"] = bool(c.get("telegram_token") and c.get("telegram_chat"))
    if not public:
        out["telegram_token"] = c.get("telegram_token", "")
    return out


def set_config(body: dict) -> dict:
    def fn(d):
        for k in CONFIG_KEYS + ("telegram_token",):
            if k in body and isinstance(body[k], str):
                v = body[k].strip()[:600]
                if k == "telegram_token" and not v:
                    continue          # vazio = fica o que estava (a página nunca o mostra)
                d["config"][k] = v
        if body.get("tirar_telegram"):
            d["config"].pop("telegram_token", None)
    edit(fn)
    return config()


def code_for(key: str) -> str:
    def fn(d):
        if key not in d["codes"]:
            d["seq"] += 1
            d["codes"][key] = f"AG-{d['seq']:04d}"
        return d["codes"][key]
    c = _load()["codes"].get(key)
    return c or edit(fn)


def key_of(code: str) -> str | None:
    return next((k for k, c in _load()["codes"].items() if c == code), None)


# ------------------------------------------------------------------ o lead, o que o Radar sabe dele
def lead_card(key: str) -> dict | None:
    from . import crm
    from .radar import RADAR
    lead = RADAR._leads().get(key)
    if not lead:
        return None
    return crm.card(key, lead, {})


def _negocio(card: dict) -> dict:
    from . import crm
    from .radar import RADAR
    lead = RADAR._leads().get(card["key"]) or {}
    _, n = crm._negocio({}, lead)
    return n or {}


def sinal(card: dict) -> dict:
    """O sinal principal: o problema mais forte que o Radar viu, com a fonte (o site ou o Google)."""
    p = (card.get("problemas") or [{}])[0] if card.get("problemas") else {}
    fonte = card.get("site") or card.get("maps") or ""
    return {"texto": (p.get("problema") or "").rstrip("."), "solucao": (p.get("solucao") or "").rstrip("."), "fonte": fonte,
            "dominio": (urlparse(fonte).hostname or "").replace("www.", "") if fonte else ""}


# ------------------------------------------------------------------ nota e temperatura (funções fixas, com testes)
def nota(card: dict, n: dict | None = None) -> float:
    """0 a 10, a mesma régua para todos os ramos (a secção 7 do prompt, com o que o Radar sabe):
    +3 o Radar diz que vale a pena · +2 há um problema que a nossa oferta resolve · +1 sem site ou site fraco ·
    +1 sabe-se quem decide · +1 telemóvel ou email direto · +0,5 Google ≥ 4,0 com ≥ 50 opiniões · −10 sem contacto nenhum."""
    n = n or {}
    pts = 0.0
    if (card.get("vale") or {}).get("v") == "sim":
        pts += 3
    if card.get("problemas"):
        pts += 2
    if not card.get("site") or (card.get("nota_site") is not None and card["nota_site"] < 50):
        pts += 1
    if n.get("decisores"):
        pts += 1
    tels = [re.sub(r"\D", "", t)[-9:] for t in card.get("telefones") or []]
    if any(t.startswith("9") for t in tels) or card.get("emails"):
        pts += 1
    if (n.get("nota") or 0) >= 4.0 and (n.get("opinioes") or 0) >= 50:
        pts += 0.5
    if not tels and not card.get("emails"):
        pts -= 10
    return round(max(0.0, min(10.0, pts)), 1)


def temperatura(visitas: int, segundos: float, scroll: int, wa: int) -> str:
    """QUENTE: clicou no WhatsApp, ≥ 2 min no site, ≥ 3 visitas, ou leu ≥ 75% com ≥ 1 min. MORNO: uma visita com ≥ 20 s ou
    leu ≥ 50%. FRIO: o resto (inclui quem nunca abriu)."""
    if wa >= 1 or segundos >= 120 or visitas >= 3 or (scroll >= 75 and segundos >= 60):
        return "quente"
    if (visitas >= 1 and segundos >= 20) or scroll >= 50:
        return "morno"
    return "frio"


EMOJI = {"quente": "🔥", "morno": "🌤", "frio": "❄️"}


def totais(code: str, d: dict | None = None) -> dict:
    vs = [v for v in (d or _load())["visits"].values() if v["code"] == code and v.get("ended") and v["ativo_ms"] >= MIN_ATIVO_MS]
    seg = sum(v["ativo_ms"] for v in vs) / 1000
    out = {"visitas": len(vs), "segundos": round(seg), "scroll": max((v["scroll"] for v in vs), default=0),
           "wa": sum(v["wa"] for v in vs), "ultima": max((v["last"] for v in vs), default=None)}
    out["temperatura"] = temperatura(out["visitas"], seg, out["scroll"], out["wa"])
    return out


def dur(s: float) -> str:
    s = int(round(s))
    return f"{s} s" if s < 60 else f"{s // 60} min {s % 60} s" if s % 60 else f"{s // 60} min"


# ------------------------------------------------------------------ o guião da chamada e o alerta
def guiao(card: dict, cfg: dict, t: dict | None = None, secoes: list | None = None) -> list[str]:
    """Três frases: quem é e porque liga (o email e o sinal), a oferta numa frase, uma pergunta fechada."""
    s = sinal(card)
    quem = f"Bom dia, fala o {cfg.get('nome') or '[o teu nome]'}, da {cfg.get('empresa') or '[a tua empresa]'}."
    frase = s["texto"].replace(": ", ", e ", 1)
    sobre = f" Mandei-vos um email sobre o que vi no vosso {'site' if card.get('site') else 'perfil do Google'}: {frase[:1].lower() + frase[1:]}." if s["texto"] else \
        " Mandei-vos um email com uma ideia para trazer mais clientes."
    if t and t.get("visitas"):
        viu = [NOMES_SEC.get(x, x) for x in (secoes or []) if x not in ("topo",)]
        sobre += f" Vi que estiveram {dur(t['segundos'])} na página que preparei" + (f", sobretudo na parte de {viu[-1]}." if viu else ".")
    oferta = cfg.get("oferta") or s["solucao"] or "trazemos mais clientes pelo Google, pelas redes e com respostas automáticas"
    frase2 = f"Na {cfg.get('empresa') or 'nossa empresa'}, {oferta[:1].lower() + oferta[1:]}".rstrip(".") + "."
    frase3 = "Isso ainda vos acontece, ou já está resolvido?" if s["texto"] else "Faz sentido falarmos 10 minutos esta semana?"
    return [quem + sobre, frase2, frase3]


def render_alert(card: dict, cfg: dict, visit: dict, t: dict, hub_url: str) -> str:
    """O alerta do fim da visita (secção 11 do prompt), em HTML do Telegram."""
    e = html.escape
    s = sinal(card)
    tel = (card.get("telefones") or [""])[0]
    tel = ("+351" + re.sub(r"\D", "", tel)[-9:]) if tel and len(re.sub(r"\D", "", tel)) >= 9 else tel
    hora = time.strftime("%H:%M", time.localtime(visit["started"]))
    secs = [NOMES_SEC.get(x, x) for x in SECOES if x in visit.get("secoes", [])]
    linhas = [f"{EMOJI[t['temperatura']]} {e(card['nome'].upper())}" + (f" ({e(card.get('local') or '')})" if card.get("local") else ""),
              f"📞 {e(tel)}" if tel else "📞 sem telefone",
              f"{visit['code']} · landing {visit.get('variant', 'A')} · abriu às {hora}"]
    if card.get("emails"):
        linhas.append(f"✉️ {e(card['emails'][0])}")
    linhas += ["", f"⏱ Nesta visita: {dur(visit['ativo_ms'] / 1000)} · viu {visit['scroll']}% da página · WhatsApp: {'clicou' if visit['wa'] else 'não clicou'}",
               f"Viu: {', '.join(secs)}." if secs else "Viu: só o topo.",
               f"📊 Total da empresa: {t['visitas']} visita{'s' if t['visitas'] != 1 else ''} · {dur(t['segundos'])} no site · {t['wa']} clique{'s' if t['wa'] != 1 else ''} no WhatsApp", ""]
    if s["texto"]:
        fonte = f' · Fonte (<a href="{e(s["fonte"])}">{e(s["dominio"])}</a>)' if s["fonte"] else ""
        linhas.append(f"📌 Sinal: {e(s['texto'])}{fonte}")
    setor = _negocio(card).get("nicho") or card.get("ramo_nome") or "negócio local"
    if setor.lower().startswith("todas"):
        setor = "negócio local"
    linhas += [f"Setor: {e(setor.lower())}", "", "🗣 O que dizer na chamada"]
    linhas += [e(x) for x in guiao(card, cfg, t, visit.get("secoes"))]
    linhas += ["", f"{hub_url.rstrip('/')}/#/crm"]
    return "\n".join(linhas)


# ------------------------------------------------------------------ os emails (rascunhos, nunca enviados)
PROIBIDAS = ["espero que esteja bem", "no mundo de hoje", "solução inovadora", "solucao inovadora", "sinergias", "espero que se encontre bem"]


def lint(assunto: str, corpo: str, link: str) -> list[str]:
    """As regras do prompt (secção 10). Uma lista vazia é um email pronto a aprovar."""
    erros = []
    palavras = len(re.findall(r"\w+", corpo.split("\n\n—")[0]))
    if palavras > 120:
        erros.append(f"{palavras} palavras (máximo 120)")
    if len(assunto) > 60:
        erros.append("assunto com mais de 60 caracteres")
    if assunto.isupper() or re.search(r"[A-ZÁÉÍÓÚ]{6,}", assunto):
        erros.append("assunto em maiúsculas")
    if "—" in corpo or " - " in corpo or "—" in assunto:
        erros.append("travessão ou « - » a separar frases")
    low = corpo.lower()
    erros += [f"frase proibida: «{p}»" for p in PROIBIDAS if p in low]
    if link not in corpo:
        erros.append("falta o link pessoal")
    if "?" not in corpo:
        erros.append("falta a pergunta de sim ou não")
    if "{{" in corpo or "[" in corpo:
        erros.append("há marcadores por preencher")
    return erros


def email(card: dict, cfg: dict, link: str) -> dict:
    s = sinal(card)
    nome = card["nome"]
    assunto = f"{nome}: {('uma ideia para o vosso ' + ('site' if card.get('site') else 'Google'))}"[:60]
    if s["texto"]:
        p = s["texto"].replace(": ", ", e ", 1)
        l1 = f"Estive a ver o {'vosso site' if card.get('site') else 'vosso perfil no Google'} e reparei numa coisa: {p[0].lower() + p[1:]}."
        l2 = "Cada pessoa que procura e não encontra o que precisa à primeira vai para o concorrente ao lado."
    else:
        l1 = f"Estive a ver o {nome} e gostei do que vi."
        l2 = "Há clientes a procurar o que vocês fazem que ainda não chegam até vocês."
    of = cfg.get("oferta") or s["solucao"] or "Trazemos mais clientes pelo Google, pelas redes e com respostas automáticas"
    l3 = (of[0].upper() + of[1:]).rstrip(".") + "."
    if cfg.get("prova"):
        l3 += f" {cfg['prova'].rstrip('.')}."
    l4 = f"Fiz uma página curta a mostrar como ficaria no vosso caso: {link}"
    l5 = "Faz sentido falarmos 10 minutos esta semana?"
    ass = " · ".join(x for x in (cfg.get("nome"), cfg.get("empresa"), cfg.get("whatsapp")) if x)
    corpo = "Bom dia,\n\n" + "\n".join([l1, l2, l3, l4, l5]) + (f"\n\n{ass}" if ass else "")
    return {"para": (card.get("emails") or [""])[0], "assunto": assunto, "texto": corpo, "lint": lint(assunto, corpo, link)}


def link_for(code: str, cfg: dict, hub_url: str) -> str:
    base = (cfg.get("base_url") or hub_url).rstrip("/")
    return f"{base}/go?r={code}"


# ------------------------------------------------------------------ a página pública e o registo das visitas
def landing(code: str | None, variant: str = "A") -> str:
    """A página de uma empresa: o nome, o que se viu e a nossa oferta. Um código desconhecido mostra a versão geral."""
    cfg = config()
    key = key_of(code) if code else None
    card = lead_card(key) if key else None
    e = html.escape
    s = sinal(card) if card else {"texto": "", "solucao": ""}
    nome = card["nome"] if card else "o seu negócio"
    ramo = ((card or {}).get("ramo_nome") or "negócios locais").lower()
    oferta = cfg.get("oferta") or "Trazemos mais clientes pelo Google, pelas redes e com respostas automáticas e marcações online."
    probs = (card or {}).get("problemas") or []
    wa = re.sub(r"\D", "", cfg.get("whatsapp") or "")
    wa_txt = f"Olá, vi a página que prepararam para {nome} ({code or 'geral'})."
    wa_url = f"https://wa.me/{wa}?text={html.escape(wa_txt).replace(' ', '%20')}" if wa else ""
    curto = s["texto"].split(":")[0].strip()
    titulo = f"{nome}: {curto[:1].lower() + curto[1:]}" if curto else f"Mais clientes para {nome}"
    oferta = oferta[:1].upper() + oferta[1:]
    itens = "".join(f"<li><b>{e(p.get('problema', ''))}</b><span>{e(p.get('solucao', ''))}</span></li>" for p in probs[:4]) or \
        f"<li><b>Há clientes a procurar {e(ramo)} na vossa zona que ainda não vos encontram.</b><span>{e(oferta)}</span></li>"
    prova = f'<section data-sec="prova"><h2>Prova</h2><p>{e(cfg["prova"])}</p></section>' if cfg.get("prova") else ""
    btn = f'<a class="wa" href="{e(wa_url)}" data-wa target="_blank" rel="noopener">Falar no WhatsApp</a>' if wa_url else ""
    quem = " · ".join(x for x in (cfg.get("nome"), cfg.get("empresa")) if x)
    js = TRACK_JS.replace("__CODE__", json.dumps(code or "")).replace("__VAR__", json.dumps(variant))
    return f"""<!doctype html><html lang="pt-PT"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>{e(titulo)}</title><style>{LANDING_CSS}</style></head><body>
<section data-sec="topo" class="hero"><small>{e(quem or 'Proposta')}</small><h1>{e(titulo)}</h1><p>{e(oferta)}</p>{btn}</section>
<section data-sec="problema"><h2>O que vimos</h2><ul>{itens}</ul></section>
<section data-sec="como-funciona"><h2>Como funciona</h2><ol><li>Falamos 10 minutos para perceber o vosso caso.</li>
<li>Montamos tudo em poucos dias, sem vos ocupar tempo.</li><li>Acompanhamos os resultados convosco todos os meses.</li></ol></section>
{prova}<section data-sec="perguntas"><h2>Perguntas</h2><details><summary>Quanto tempo demora?</summary><p>Poucos dias desde a conversa.</p></details>
<details><summary>Têm de mudar o que já usam?</summary><p>Não. Juntamos ao que já têm.</p></details></section>
<section data-sec="contacto"><h2>Falamos?</h2><p>Respondemos no próprio dia.</p>{btn}</section>
<footer>Esta página regista o tempo de leitura para sabermos se foi útil. Não usa cookies nem guarda dados pessoais.</footer>
<script>{js}</script></body></html>"""


LANDING_CSS = """*{box-sizing:border-box}body{margin:0;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif;background:#0b0c0e;color:#eceef1}
section{max-width:760px;margin:0 auto;padding:48px 22px}.hero{padding-top:72px}.hero small{color:#9aa1aa;letter-spacing:.08em;text-transform:uppercase;font-size:12px}
h1{font-size:clamp(28px,5vw,44px);line-height:1.1;letter-spacing:-.02em;margin:10px 0 14px}h2{font-size:22px;margin:0 0 14px}
p{color:#c4c9d0}ul,ol{padding-left:20px}li{margin:10px 0}li b{display:block;color:#fff}li span{color:#aab0b8}
.wa{display:inline-block;margin-top:14px;padding:13px 22px;border-radius:999px;background:#25d366;color:#04140a;font-weight:700;text-decoration:none}
details{border-top:1px solid #23262b;padding:12px 0}summary{cursor:pointer;font-weight:600}footer{max-width:760px;margin:0 auto;padding:30px 22px 50px;color:#6c727b;font-size:12px}"""

TRACK_JS = r"""(function(){var C=__CODE__,V=__VAR__,K="ag-v";var id=sessionStorage.getItem(K)||(crypto.randomUUID?crypto.randomUUID():String(Date.now())+Math.random());
sessionStorage.setItem(K,id);var act=0,last=Date.now(),seen=Date.now(),sc=0,secs=[],wa=0,done=0;
function vis(){return document.visibilityState==="visible"}
function send(ev,beacon){var b=JSON.stringify({v:1,visit_id:id,lead_id:C,ev:ev,t_ms_ativo:Math.round(act),scroll_max:sc,secoes:secs,wa:wa,variant:V,ts:Date.now()});
if(beacon&&navigator.sendBeacon){navigator.sendBeacon("/api/go/t",new Blob([b],{type:"application/json"}))}else{fetch("/api/go/t",{method:"POST",headers:{"Content-Type":"application/json"},body:b,keepalive:true}).catch(function(){})}}
setInterval(function(){var n=Date.now();if(vis()&&n-seen<30000)act+=n-last;last=n},1000);
["scroll","mousemove","keydown","touchstart","click"].forEach(function(e){addEventListener(e,function(){seen=Date.now()},{passive:true})});
addEventListener("scroll",function(){var h=document.documentElement,p=Math.round(100*(scrollY+innerHeight)/h.scrollHeight);if(p>sc){sc=Math.min(100,p)}},{passive:true});
var io=new IntersectionObserver(function(es){es.forEach(function(x){var s=x.target.dataset.sec;if(x.isIntersecting&&secs.indexOf(s)<0){x.target._t=setTimeout(function(){if(secs.indexOf(s)<0){secs.push(s);send("section")}},1000)}else clearTimeout(x.target._t)})},{threshold:.5});
document.querySelectorAll("[data-sec]").forEach(function(s){io.observe(s)});
document.querySelectorAll("[data-wa]").forEach(function(a){a.addEventListener("click",function(){wa++;send("click_whatsapp",1)})});
send("start");setInterval(function(){if(vis())send("heartbeat")},15000);
function end(){if(!done){done=1;send("end",1)}}addEventListener("pagehide",end);
document.addEventListener("visibilitychange",function(){if(!vis())send("heartbeat",1)});
sc=Math.round(100*innerHeight/document.documentElement.scrollHeight);})();"""


def track(body: dict, ua: str) -> bool:
    """Um evento da página. Ignora bots e pré-visualizações de email, limita a 60 eventos por minuto por visita."""
    if not isinstance(body, dict) or BOTS.search(ua or ""):
        return False
    vid, code, ev = str(body.get("visit_id") or "")[:64], str(body.get("lead_id") or "")[:20], str(body.get("ev") or "")[:20]
    if not vid or not re.fullmatch(r"AG-\d{4,6}", code or "") or ev not in ("start", "heartbeat", "section", "scroll", "click_whatsapp", "end"):
        return False
    now = time.time()

    def fn(d):
        v = d["visits"].get(vid)
        if v is None:
            if not key_of(code) and code not in d["codes"].values():
                return False
            v = d["visits"][vid] = {"code": code, "variant": str(body.get("variant") or "A")[:2], "started": now, "last": now, "ended": None,
                                    "ativo_ms": 0, "scroll": 0, "secoes": [], "wa": 0, "ended_by": None, "alerted": None, "rate": [now, 0]}
        if v.get("ended"):
            return False
        if now - v["rate"][0] > 60:
            v["rate"] = [now, 0]
        v["rate"][1] += 1
        if v["rate"][1] > MAX_EV_MIN:
            return False
        v["last"] = now
        v["ativo_ms"] = max(v["ativo_ms"], min(int(body.get("t_ms_ativo") or 0), int((now - v["started"]) * 1000) + 2000))
        v["scroll"] = max(v["scroll"], max(0, min(100, int(body.get("scroll_max") or 0))))
        for s in body.get("secoes") or []:
            if s in SECOES and s not in v["secoes"]:
                v["secoes"].append(s)
        v["wa"] = max(v["wa"], int(body.get("wa") or 0))
        if ev == "end":
            v["ended"], v["ended_by"] = now, "pagehide"
        if len(d["visits"]) > 3000:   # guarda as mais recentes
            for k in sorted(d["visits"], key=lambda k: d["visits"][k]["last"])[:500]:
                d["visits"].pop(k, None)
        return True
    return edit(fn)


# ------------------------------------------------------------------ o fim das visitas: temperatura, CRM, sino e Telegram
def fechar_visitas(now: float | None = None) -> list[dict]:
    """Fecha as visitas acabadas (fim ou 30 min sem eventos) e devolve as que merecem alerta (≥ 5 s ativo, ainda sem alerta)."""
    now = now or time.time()

    def fn(d):
        prontas = []
        for vid, v in d["visits"].items():
            if not v["ended"] and now - v["last"] > FECHA_S:
                v["ended"], v["ended_by"] = v["last"], "timeout"
            if v["ended"] and not v["alerted"]:
                v["alerted"] = now
                if v["ativo_ms"] >= MIN_ATIVO_MS:
                    prontas.append({**v, "id": vid})
        return prontas
    return edit(fn)


def _registar_no_crm(key: str, visit: dict, t: dict) -> None:
    from .radar import RADAR

    def fn(lead):
        lead["angariacao"] = {"code": visit["code"], **t}
        lead["atividades"] = (lead.get("atividades") or [])[-99:] + [{"at": time.time(), "tipo": "nota", "por": "Página",
            "texto": f"{EMOJI[t['temperatura']]} Viu a página {visit['code']}: {dur(visit['ativo_ms'] / 1000)}, {visit['scroll']}% lida, "
                     f"WhatsApp: {'clicou' if visit['wa'] else 'não clicou'}."}]
    RADAR.edit_lead(key, fn)


def telegram(method: str, payload: dict, token: str) -> dict:
    for tentativa in range(5):
        try:
            r = httpx.post(f"https://api.telegram.org/bot{token}/{method}", json=payload, timeout=15)
        except httpx.HTTPError as e:
            log.info("telegram %s: %s", method, e)
            time.sleep(2 ** tentativa)
            continue
        if r.status_code == 429:
            time.sleep(min(30, (r.json().get("parameters") or {}).get("retry_after", 5)))
            continue
        return r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
    return {}


def alertar(visit: dict, hub_url: str) -> dict | None:
    key = key_of(visit["code"])
    card = lead_card(key) if key else None
    if not card:
        return None
    t = totais(visit["code"])
    _registar_no_crm(key, visit, t)
    cfg = config(public=False)
    texto = render_alert(card, cfg, visit, t, hub_url)
    if cfg.get("telegram_token") and cfg.get("telegram_chat"):
        telegram("sendMessage", {"chat_id": cfg["telegram_chat"], "text": texto, "parse_mode": "HTML", "disable_web_page_preview": True,
                                 "reply_markup": {"inline_keyboard": [[{"text": "Já liguei", "callback_data": f"c:{visit['code']}:liguei"},
                                                                       {"text": "Ainda não liguei", "callback_data": f"c:{visit['code']}:nao"}]]}},
                 cfg["telegram_token"])
    return {"card": card, "t": t, "texto": re.sub(r"<[^>]+>", "", texto)}


def telegram_botoes() -> int:
    """Os botões do alerta: «Já liguei» marca a chamada no CRM e passa a contactado; «Ainda não liguei» fica escrito. Uma vez por update."""
    cfg = config(public=False)
    if not (cfg.get("telegram_token") and cfg.get("telegram_chat")):
        return 0
    off = _load()["tg"].get("offset", 0)
    r = telegram("getUpdates", {"offset": off, "timeout": 0, "allowed_updates": ["callback_query"]}, cfg["telegram_token"])
    feitos = 0
    for u in r.get("result") or []:
        edit(lambda d: d["tg"].__setitem__("offset", u["update_id"] + 1))
        q = u.get("callback_query") or {}
        if str((q.get("message") or {}).get("chat", {}).get("id")) != str(cfg["telegram_chat"]):
            continue
        m = re.fullmatch(r"c:(AG-\d+):(liguei|nao)", q.get("data") or "")
        if not m or not key_of(m.group(1)):
            continue
        from .radar import RADAR
        liguei = m.group(2) == "liguei"

        def fn(lead):
            lead["atividades"] = (lead.get("atividades") or [])[-99:] + [{"at": time.time(), "tipo": "chamada" if liguei else "nota", "por": "Telegram",
                                                                         "texto": "Já liguei (marcado no Telegram)." if liguei else "Ainda não liguei (marcado no Telegram)."}]
            if liguei and (lead.get("estado") in (None, "por_contactar", "novo")):
                lead["estado"] = "contactado"
                lead["hist"] = (lead.get("hist") or []) + [[time.time(), "contactado"]]
        RADAR.edit_lead(key_of(m.group(1)), fn)
        telegram("answerCallbackQuery", {"callback_query_id": q["id"], "text": "Guardado no CRM"}, cfg["telegram_token"])
        msg = q.get("message") or {}
        telegram("editMessageReplyMarkup", {"chat_id": msg.get("chat", {}).get("id"), "message_id": msg.get("message_id"),
                                            "reply_markup": {"inline_keyboard": [[{"text": ("✅ Já liguei" if liguei else "⏳ Ainda não liguei"), "callback_data": "x"}]]}},
                 cfg["telegram_token"])
        feitos += 1
    return feitos


# ------------------------------------------------------------------ o que a página CRM mostra
def resumo(hub_url: str) -> dict:
    from . import crm
    d = _load()
    cfg = config()
    board = crm.board()
    linhas = []
    for c in board["leads"]:
        if c["stage"] in ("fechou", "nao"):
            continue
        code = d["codes"].get(c["key"])
        t = totais(code, d) if code else {"visitas": 0, "segundos": 0, "scroll": 0, "wa": 0, "ultima": None, "temperatura": "frio"}
        linhas.append({"key": c["key"], "nome": c["nome"], "code": code, "link": link_for(code, cfg, hub_url) if code else None,
                       "nota": nota(c, _negocio(c)), **t, "rascunho": bool(c.get("rascunho")),
                       "lint": (c.get("rascunho") or {}).get("lint") or []})
    linhas.sort(key=lambda x: ({"quente": 0, "morno": 1, "frio": 2}[x["temperatura"]], -x["nota"]))
    visitas = sorted((v for v in d["visits"].values() if v.get("ended") and v["ativo_ms"] >= MIN_ATIVO_MS), key=lambda v: -v["last"])[:20]
    nomes = {c["key"]: c["nome"] for c in board["leads"]}
    inv = {c: k for k, c in d["codes"].items()}
    stages = {c["key"]: c["stage"] for c in board["leads"]}
    for x in linhas:
        x["stage"] = stages.get(x["key"], "novo")
    funil = [["Na lista", len(linhas)], ["Email escrito", sum(1 for x in linhas if x["rascunho"])],
             ["Abriram a página", sum(1 for x in linhas if x["visitas"])], ["Quentes", sum(1 for x in linhas if x["temperatura"] == "quente")],
             ["Contactadas", sum(1 for x in linhas if x["stage"] not in ("novo",))]]
    hoje = time.time()
    dias = []
    todas = [v for v in d["visits"].values() if v.get("ended") and v["ativo_ms"] >= MIN_ATIVO_MS]
    for i in range(13, -1, -1):
        dia = time.strftime("%Y-%m-%d", time.localtime(hoje - 86400 * i))
        dias.append({"dia": dia, "n": sum(1 for v in todas if time.strftime("%Y-%m-%d", time.localtime(v["last"])) == dia)})
    seg = [v["ativo_ms"] / 1000 for v in todas]
    return {"funil": funil, "dias": dias, "frios": sum(1 for x in linhas if x["temperatura"] == "frio"),
            "media_s": round(sum(seg) / len(seg)) if seg else None, "wa_total": sum(v["wa"] for v in todas),
            "config": cfg, "leads": linhas, "quentes": sum(1 for x in linhas if x["temperatura"] == "quente"),
            "mornos": sum(1 for x in linhas if x["temperatura"] == "morno"), "com_rascunho": sum(1 for x in linhas if x["rascunho"]),
            "visitas": [{"code": v["code"], "nome": nomes.get(inv.get(v["code"]), v["code"]), "quando": v["last"], "segundos": round(v["ativo_ms"] / 1000),
                         "scroll": v["scroll"], "wa": v["wa"]} for v in visitas],
            "link_base": (cfg.get("base_url") or hub_url).rstrip("/")}


def rascunhos(hub_url: str, keys: list[str] | None = None, todos: bool = False) -> dict:
    """Marketing escreve o primeiro email de cada empresa do CRM (ou só das escolhidas), com o link pessoal e as regras
    verificadas. Fica «por aprovar»; nada é enviado."""
    from . import crm
    from .radar import RADAR
    cfg = config()
    feitos, com_erros = 0, 0
    for c in crm.board()["leads"]:
        if c["stage"] in ("fechou", "nao") or (keys and c["key"] not in keys) or (c.get("rascunho") and not todos and not keys):
            continue
        code = code_for(c["key"])
        m = email(c, cfg, link_for(code, cfg, hub_url))

        def fn(lead, m=m, code=code):
            lead["rascunho"] = {"texto": m["texto"], "assunto": m["assunto"], "para": m["para"], "at": time.time(), "estado": "por aprovar",
                                "lint": m["lint"], "code": code}
            lead["atividades"] = (lead.get("atividades") or [])[-99:] + [{"at": time.time(), "tipo": "agente", "por": "MKT",
                "texto": "Marketing: email escrito com o link pessoal " + code + (", pronto a aprovar." if not m["lint"] else f", com {len(m['lint'])} regra(s) por acertar.")}]
        RADAR.edit_lead(c["key"], fn)
        feitos += 1
        com_erros += bool(m["lint"])
    return {"feitos": feitos, "com_erros": com_erros}


def ficha(key: str, hub_url: str) -> dict:
    card = lead_card(key)
    if not card:
        raise ValueError("lead desconhecido")
    cfg = config()
    code = code_for(key)
    t = totais(code)
    ultima = next((v for v in sorted(_load()["visits"].values(), key=lambda v: -v["last"]) if v["code"] == code and v.get("ended")), None)
    return {"code": code, "link": link_for(code, cfg, hub_url), "nota": nota(card, _negocio(card)), **t, "sinal": sinal(card),
            "guiao": guiao(card, cfg, t, (ultima or {}).get("secoes"))}
