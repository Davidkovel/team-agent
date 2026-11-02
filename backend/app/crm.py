"""CRM (#/crm, 03 · Negócios): o Radar encontra, o CRM leva cada empresa até ao negócio (2 nov 2026, pedido do David a partir
da conversa do Marco com o GPT: «o Radar e o CRM deixam de ser ferramentas separadas»).

Não há base nova: cada lead é a entrada do seguimento do Radar (`~/.team-agent/radar/seguimento.json`, por ramo + nome), por
isso o que se marca no Radar aparece aqui e vice-versa. O CRM junta-lhe o valor do negócio, a próxima ação com data, as
atividades (chamadas, emails, reuniões, propostas, notas) e o trabalho dos três departamentos:
- Pesquisa (PES) faz a ficha completa da empresa (radar_ficha) e resume o veredicto;
- Marketing (MKT) escreve a primeira mensagem, que fica «por aprovar»: quem envia é sempre uma pessoa;
- Operações (OPS) marca a próxima ação conforme a fase.
Só neste PC, como o Radar: nada vai por sync. Código síncrono; a única chamada assíncrona é a ficha (FICHAS.start), feita no router.

Disciplina de vendas (2 nov 2026, pedido do David: «melhora completamente o CRM», ideias do Pipedrive): cada negócio aberto tem de
ter próxima ação, um negócio sem atividade há mais dias do que a fase permite fica «parado» (`ROT`, conta só o que alguém fez, não as
edições nem os agentes), a previsão é valor × probabilidade da fase (`PROB`, uma estimativa nossa e dita como tal) e o funil sai do
histórico real. Leads à mão (`create`, ramo «manual», sem sid/nid) e reunião com link (`zoom_create` só com as zoom_* no backend/.env).
"""
from __future__ import annotations

import base64
import csv
import hashlib
import io
import re
import time
from collections import Counter

import httpx

from .config import settings
from .radar import ESTADOS, RADAR, veredicto

# a ordem do quadro; «por_contactar» com nota é um lead novo, «nao» fica nos perdidos
STAGES = [("novo", "Novo lead"), ("contactado", "Contactado"), ("respondeu", "Respondeu"), ("reuniao", "Reunião"),
          ("proposta", "Proposta"), ("fechou", "Ganho")]
TIPOS = {"chamada": "Chamada", "email": "Email", "whatsapp": "WhatsApp", "reuniao": "Reunião", "proposta": "Proposta", "nota": "Nota"}
AGENTES = {"pesquisa": ("PES", "Pesquisa"), "marketing": ("MKT", "Marketing"), "operacoes": ("OPS", "Operações")}
DIA = 86400
# estimativas nossas, ditas como tal na página; o funil real está em funil()
PROB = {"novo": 10, "contactado": 20, "respondeu": 35, "reuniao": 55, "proposta": 70}
# dias sem ninguém fazer nada até o negócio contar como parado (como o «rotting» do Pipedrive: por fase)
ROT = {"novo": 2, "contactado": 5, "respondeu": 4, "reuniao": 7, "proposta": 7}
ORDEM = [k for k, _ in STAGES]
# a próxima ação de cada fase (Operações): texto e daqui a quantos dias
NEXT = {"novo": ("Primeiro contacto", 0), "contactado": ("Voltar a ligar se não respondeu", 3), "respondeu": ("Marcar a reunião", 1),
        "reuniao": ("Mandar a proposta", 2), "proposta": ("Perguntar pela proposta", 4),
        "fechou": ("Pedir uma opinião no Google e uma indicação", 14), "nao": ("Voltar a tentar", 90)}


def stage(lead: dict) -> str:
    e = lead.get("estado") or "novo"
    return "novo" if e == "por_contactar" else e


def _log(lead: dict, tipo: str, texto: str, por: str) -> None:
    lead["atividades"] = (lead.get("atividades") or [])[-99:] + [{"at": time.time(), "tipo": tipo, "texto": str(texto)[:1500], "por": por}]


def _scan(cache: dict, sid: str) -> dict | None:
    if sid not in cache:
        try:
            cache[sid] = RADAR.get(sid)
        except ValueError:
            cache[sid] = None
    return cache[sid]


def _negocio(cache: dict, lead: dict) -> tuple[dict | None, dict | None]:
    sc = _scan(cache, lead.get("sid") or "")
    if not sc:
        return None, None
    return sc, next((x for x in sc.get("negocios", []) if x.get("id") == lead.get("nid")), None)


def _contacts(n: dict | None, lead: dict) -> dict:
    a = (n or {}).get("audit") or {}
    c = lead.get("contacto") or {}
    tel = [x.strip() for x in str((n or {}).get("telefone") or lead.get("telefone") or "").replace(",", ";").replace("/", ";").split(";") if x.strip()]
    tel += [x for x in a.get("telefones") or [] if x not in tel]
    if c.get("telefone"):
        tel = [c["telefone"]] + [x for x in tel if x != c["telefone"]]
    mails = ([n["email"]] if n and n.get("email") else []) + [x for x in a.get("emails") or [] if x != (n or {}).get("email")]
    if c.get("email"):
        mails = [c["email"]] + [x for x in mails if x != c["email"]]
    return {"telefones": tel[:4], "emails": mails[:4], "facebook": (n or {}).get("facebook", ""), "site": (n or {}).get("site") or lead.get("site", ""),
            "morada": (n or {}).get("morada", ""), "maps": (n or {}).get("maps", ""), "lat": (n or {}).get("lat"), "lon": (n or {}).get("lon")}


def _ultima(lead: dict) -> float:
    """A última vez que alguém fez alguma coisa neste negócio: atividades e mudanças de fase, não os agentes nem as edições."""
    ts = [a.get("at") or 0 for a in lead.get("atividades") or [] if a.get("tipo") != "agente"]
    ts += [h[0] for h in lead.get("hist") or []]
    return max(ts, default=lead.get("at") or 0)


def card(key: str, lead: dict, cache: dict) -> dict:
    sc, n = _negocio(cache, lead)
    v = veredicto(n) if n and "oportunidade" in n else None
    st, ult = stage(lead), _ultima(lead)
    desde = next((h[0] for h in reversed(lead.get("hist") or []) if h[1] == lead.get("estado")), lead.get("at"))
    dias = int((time.time() - ult) // DIA)
    return {"key": key, "nome": lead.get("nome", ""), "ramo": lead.get("ramo", ""), "ramo_nome": (sc or {}).get("ramo_nome", "") or lead.get("segmento", ""),
            "manual": not lead.get("sid"), "contacto": lead.get("contacto") or {}, "fecho": lead.get("fecho"), "reuniao": lead.get("reuniao"),
            "prob": PROB.get(st), "desde": desde, "ult": ult, "parado": dias if st in ROT and dias >= ROT[st] else 0,
            "local": lead.get("local", ""), "sid": lead.get("sid"), "nid": lead.get("nid"), "estado": lead.get("estado"), "stage": stage(lead),
            "nota": lead.get("nota", ""), "motivo": lead.get("motivo", ""), "valor": lead.get("valor"), "proxima": lead.get("proxima"),
            "rascunho": lead.get("rascunho"), "atividades": lead.get("atividades") or [], "hist": lead.get("hist") or [],
            "at": lead.get("at"), "criado": (lead.get("hist") or [[lead.get("at")]])[0][0], "por": lead.get("por", ""),
            "vale": v, "oportunidade": (n or {}).get("oportunidade"), "nivel": (n or {}).get("nivel", ""),
            "nota_site": (n or {}).get("nota_site"), "problemas": ((n or {}).get("problemas") or [])[:3], **_contacts(n, lead)}


def radar_quentes(leads: dict, cache: dict, limit: int = 12) -> tuple[list[dict], int]:
    """As empresas que o Radar diz que valem a pena e ainda não estão no CRM (das 8 pesquisas mais recentes)."""
    out, seen = [], set()
    for s in RADAR.list()[:8]:
        sc = _scan(cache, s["id"])
        for n in (sc or {}).get("negocios", []):
            if "oportunidade" not in n:
                continue
            k = RADAR.lead_key(sc["ramo"], n["nome"])
            if k in leads or k in seen:
                continue
            v = veredicto(n)
            if v["v"] != "sim":
                continue
            seen.add(k)
            out.append({"sid": sc["id"], "nid": n["id"], "nome": n["nome"], "local": n.get("morada") or sc.get("local") or "",
                        "ramo_nome": sc.get("ramo_nome", ""), "pontos": v["pontos"], "porque": v["porque"][:2], "passo": v["passo"],
                        "telefone": bool(n.get("telefone") or (n.get("audit") or {}).get("telefones")), "site": n.get("site", ""),
                        "nivel": n.get("nivel", ""), "lat": n.get("lat"), "lon": n.get("lon")})
    out.sort(key=lambda x: -x["pontos"])
    return out[:limit], len(out)


def funil(cards: list[dict]) -> dict:
    """O que aconteceu mesmo, a partir do histórico: quantos chegaram a cada fase, quanto tempo lá ficaram, porque se perderam."""
    chegaram, tempos = Counter(), {k: [] for k in ORDEM}
    now = time.time()
    for c in cards:
        hist = [(h[0], "novo" if h[1] == "por_contactar" else h[1]) for h in c["hist"]]
        idx = [ORDEM.index(e) for _, e in hist if e in ORDEM] + ([ORDEM.index(c["stage"])] if c["stage"] in ORDEM else [])
        for i in range(max(idx, default=0) + 1):
            chegaram[ORDEM[i]] += 1
        for j, (at, e) in enumerate(hist):
            if e not in ORDEM or e == "fechou":
                continue
            fim = hist[j + 1][0] if j + 1 < len(hist) else now
            tempos[e].append(max(0.0, fim - at))
    motivos = Counter((c["motivo"] or "Sem motivo").strip() for c in cards if c["stage"] == "nao")
    return {"fases": [{"k": k, "n": chegaram[k], "dias": round(sum(tempos[k]) / len(tempos[k]) / DIA, 1) if tempos[k] else None} for k in ORDEM],
            "motivos": motivos.most_common(6), "origem": {"radar": sum(not c["manual"] for c in cards), "manual": sum(c["manual"] for c in cards)}}


def board() -> dict:
    leads, cache = RADAR._leads(), {}
    cards = [card(k, l, cache) for k, l in leads.items() if l.get("estado") != "por_contactar" or l.get("nota")]
    cards.sort(key=lambda c: -(c["at"] or 0))
    quentes, n_quentes = radar_quentes(leads, cache)
    now = time.time()
    abertos = [c for c in cards if c["stage"] not in ("fechou", "nao")]
    valores = [c["valor"] for c in abertos if isinstance(c["valor"], (int, float))]
    ganhos = [c for c in cards if c["stage"] == "fechou"]
    perdidos = [c for c in cards if c["stage"] == "nao"]
    resumo = {
        "abertos": len(abertos), "quentes": n_quentes,
        "valor_aberto": sum(valores) if valores else None, "com_valor": len(valores),
        "ganhos": len(ganhos), "valor_ganho": sum(c["valor"] for c in ganhos if isinstance(c["valor"], (int, float))) if any(isinstance(c["valor"], (int, float)) for c in ganhos) else None,
        "perdidos": len(perdidos), "taxa": round(100 * len(ganhos) / (len(ganhos) + len(perdidos))) if ganhos or perdidos else None,
        "atrasados": sum(1 for c in abertos if (c["proxima"] or {}).get("quando") and c["proxima"]["quando"] < now - 3600),
        "hoje": sum(1 for c in abertos if (c["proxima"] or {}).get("quando") and now - 3600 <= c["proxima"]["quando"] < now + DIA),
        "previsao": round(sum(c["valor"] * c["prob"] / 100 for c in abertos if isinstance(c["valor"], (int, float)))) if valores else None,
        "parados": sum(1 for c in abertos if c["parado"]), "sem_proxima": sum(1 for c in abertos if not c["proxima"]),
        "reunioes": sum(1 for c in abertos if (c["reuniao"] or {}).get("quando", 0) >= now),
    }
    return {"stages": STAGES, "estados": ESTADOS, "tipos": TIPOS, "agentes": {k: v[1] for k, v in AGENTES.items()},
            "leads": cards, "radar": quentes, "resumo": resumo, "prob": PROB, "rot": ROT, "funil": funil(cards), "zoom_api": zoom_ok()}


def _next(lead: dict, who: str) -> None:
    """Operações: a próxima ação conforme a fase (não apaga uma que a pessoa marcou e ainda não passou)."""
    st = stage(lead)
    texto, dias = NEXT[st]
    if st == "novo":
        texto = lead.get("passo") or texto
    p = lead.get("proxima") or {}
    if p.get("quando") and p.get("quando") > time.time() and p.get("por") != "Operações":
        return
    quando = time.time() + dias * DIA if dias else time.time()
    lead["proxima"] = {"texto": texto, "quando": quando, "por": "Operações"}
    _log(lead, "agente", f"Operações: próxima ação «{texto}» para {time.strftime('%d/%m', time.localtime(quando))}.", "OPS")


def add(sid: str, nid: str, who: str) -> dict:
    """Do Radar para o CRM: a empresa entra como Novo lead com o que o Radar já sabe, e Operações marca o primeiro contacto."""
    sc = RADAR.get(sid)
    n = next((x for x in sc["negocios"] if x["id"] == nid), None)
    if not n:
        raise ValueError("negócio desconhecido")
    key = RADAR.lead_key(sc["ramo"], n["nome"])
    if key not in RADAR._leads() or RADAR._leads()[key].get("estado") == "por_contactar":
        RADAR.set_lead(sid, nid, "novo", None, who)
    v = veredicto(n) if "oportunidade" in n else None

    def fn(lead):
        if not lead.get("atividades"):
            _log(lead, "radar", f"Entrou do Radar ({sc.get('ramo_nome') or sc['ramo']}, {sc.get('local') or 'lista'})"
                 + (f": {v['titulo'].lower()}, {v['pontos']}/100." if v else "."), who)
        if v:
            lead["passo"] = v["passo"]
        _next(lead, who)
    return RADAR.edit_lead(key, fn)


def _txt(v, n: int) -> str:
    return str(v or "").strip()[:n]


def _contacto(c: dict) -> dict:
    out = {k: _txt(c.get(k), 120) for k in ("nome", "cargo", "telefone", "email")}
    if out["email"] and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", out["email"]):
        raise ValueError("Esse email não parece certo")
    return {k: v for k, v in out.items() if v}


def create(body: dict, who: str) -> dict:
    """Um lead que não veio do Radar (uma indicação, alguém que ligou): entra como Novo lead e Operações marca o primeiro contacto."""
    nome = _txt(body.get("nome"), 120)
    if len(nome) < 2:
        raise ValueError("Escreve o nome da empresa")
    leads = RADAR._leads()
    key = RADAR.lead_key("manual", nome)
    fold = nome.casefold()
    if key in leads or any(str(l.get("nome", "")).strip().casefold() == fold for l in leads.values()):
        raise ValueError("Já há um lead com esse nome")
    now = time.time()
    lead = {"estado": "novo", "nota": _txt(body.get("nota"), 1000), "at": now, "por": who, "nome": nome, "ramo": "manual", "local": _txt(body.get("local"), 160),
            "telefone": "", "site": _txt(body.get("site"), 300), "sid": "", "nid": "", "segmento": _txt(body.get("segmento"), 80),
            "contacto": _contacto(body.get("contacto") or {}), "hist": [[now, "novo", who]]}
    if body.get("valor") not in (None, ""):
        lead["valor"] = _valor(body["valor"])
    _log(lead, "manual", "Criado à mão no CRM.", who)
    _next(lead, who)
    leads[key] = lead
    RADAR._write(leads)
    return {**lead, "key": key}


def remove(key: str) -> None:
    """Tira o lead do CRM (e do seguimento do Radar). Se veio do Radar, a empresa volta a poder ser trazida."""
    leads = RADAR._leads()
    if key not in leads:
        raise ValueError("lead desconhecido")
    del leads[key]
    RADAR._write(leads)


def _valor(v) -> int:
    v = float(v)
    if v < 0 or v > 10_000_000:
        raise ValueError("valor fora do normal")
    return round(v)


def _hora(ts: float) -> str:
    return time.strftime("%d/%m às %H:%M", time.localtime(ts))


def _reuniao(lead: dict, m: dict | None, who: str, fim: bool = False) -> None:
    """Marca, muda ou tira a reunião: fica na próxima ação, no histórico e, se ainda não lá estava, o negócio passa à fase Reunião."""
    old = lead.get("reuniao")
    if not m:
        if not old:
            return
        lead.pop("reuniao")
        p = lead.get("proxima") or {}
        if p.get("reuniao"):
            lead.pop("proxima", None)
        if not fim:
            _log(lead, "reuniao", "Reunião cancelada.", who)
        return
    quando, link = float(m.get("quando") or 0), _txt(m.get("link"), 500)
    if quando <= 0:
        raise ValueError("Falta a data da reunião")
    if link and not re.match(r"https://\S+$", link):
        raise ValueError("O link da reunião tem de começar por https://")
    dur = int(m.get("duracao") or 30)
    lead["reuniao"] = {"quando": quando, "duracao": max(5, min(dur, 480)), "link": link, "por": who}
    if m.get("zoom_id"):
        lead["reuniao"]["zoom_id"] = m["zoom_id"]
    _log(lead, "reuniao", f"Reunião {'mudada para' if old else 'marcada para'} {_hora(quando)}" + (" (Zoom)." if "zoom." in link else "."), who)
    if stage(lead) in ("novo", "contactado", "respondeu"):
        lead["hist"] = (lead.get("hist") or [])[-20:] + [[time.time(), "reuniao", who]]
        lead["estado"] = "reuniao"
        _log(lead, "estado", f"Passou a «{ESTADOS['reuniao']}».", who)
    lead["proxima"] = {"texto": f"Reunião com {lead.get('nome', '')}"[:200], "quando": quando, "por": who, "reuniao": True}


def update(key: str, body: dict, who: str) -> dict:
    def fn(lead):
        if body.get("feito") and lead.get("proxima"):
            _log(lead, "feito", f"Feito: {lead['proxima'].get('texto', '')}", who)
            if lead["proxima"].get("reuniao"):
                lead.pop("reuniao", None)  # a ação era a própria reunião: fica feita, não volta a aparecer como marcada
            lead.pop("proxima")
        if "estado" in body:
            e = str(body["estado"] or "")
            if e not in ESTADOS or e == "por_contactar":
                raise ValueError("estado desconhecido")
            if e != lead.get("estado"):
                lead["hist"] = (lead.get("hist") or [])[-20:] + [[time.time(), e, who]]
                lead["estado"] = e
                _log(lead, "estado", f"Passou a «{ESTADOS[e]}».", who)
                if e == "nao" and body.get("motivo"):
                    lead["motivo"] = str(body["motivo"])[:300]
                _next(lead, who)
        if "valor" in body:
            v = body["valor"]
            if v in (None, ""):
                lead.pop("valor", None)
            else:
                lead["valor"] = _valor(v)
        if "proxima" in body:
            p = body["proxima"]
            if not p:
                lead.pop("proxima", None)
            else:
                lead["proxima"] = {"texto": str(p.get("texto") or "")[:200], "quando": float(p.get("quando") or time.time()), "por": who}
        if "fecho" in body:
            lead["fecho"] = float(body["fecho"]) if body["fecho"] else None
        if "contacto" in body:
            lead["contacto"] = _contacto({**(lead.get("contacto") or {}), **(body["contacto"] or {})})
        for campo, n in (("site", 300), ("local", 160), ("segmento", 80)):
            if campo in body:
                lead[campo] = _txt(body[campo], n)
        if "nome" in body and not lead.get("sid"):  # a chave fica; o de um lead do Radar vem da pesquisa
            if len(_txt(body["nome"], 120)) < 2:
                raise ValueError("Escreve o nome da empresa")
            lead["nome"] = _txt(body["nome"], 120)
        if "reuniao" in body:
            _reuniao(lead, body["reuniao"], who, bool(body.get("reuniao_fim")))
            if body.get("reuniao_fim"):
                _next(lead, who)
        if "nota" in body:
            lead["nota"] = str(body["nota"] or "")[:1000]
        if "motivo" in body and "estado" not in body:
            lead["motivo"] = str(body["motivo"] or "")[:300]
        if body.get("atividade"):
            a = body["atividade"]
            t = a.get("tipo") if a.get("tipo") in TIPOS else "nota"
            if str(a.get("texto") or "").strip() or t != "nota":
                _log(lead, t, str(a.get("texto") or TIPOS[t]).strip(), who)
        if body.get("rascunho") == "aprovado" and lead.get("rascunho"):
            lead["rascunho"]["estado"] = "aprovado"
            lead["rascunho"]["por"] = who
            _log(lead, "agente", f"Mensagem do Marketing aprovada por {who} e enviada por {body.get('canal') or 'contacto'}.", who)
        elif body.get("rascunho") == "apagar":
            lead.pop("rascunho", None)
    return RADAR.edit_lead(key, fn)


def zoom_ok() -> bool:
    return bool(settings.zoom_account_id and settings.zoom_client_id and settings.zoom_client_secret)


def zoom_create(key: str, quando: float, duracao: int, who: str) -> dict:
    """Cria a reunião na conta Zoom (app Server-to-Server OAuth: ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID e ZOOM_CLIENT_SECRET no backend/.env) e guarda o link."""
    if not zoom_ok():
        raise ValueError("Falta ligar a conta Zoom")
    lead = RADAR._leads().get(key)
    if not lead:
        raise ValueError("lead desconhecido")
    basic = base64.b64encode(f"{settings.zoom_client_id}:{settings.zoom_client_secret}".encode()).decode()
    try:
        tk = httpx.post("https://zoom.us/oauth/token", params={"grant_type": "account_credentials", "account_id": settings.zoom_account_id},
                        headers={"Authorization": f"Basic {basic}"}, timeout=15)
        tk.raise_for_status()
        r = httpx.post("https://api.zoom.us/v2/users/me/meetings", headers={"Authorization": f"Bearer {tk.json()['access_token']}"}, timeout=15,
                       json={"topic": f"AMG · {lead.get('nome', '')}"[:200], "type": 2, "duration": duracao, "timezone": "Europe/Lisbon",
                             "start_time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(quando))})
        r.raise_for_status()
        z = r.json()
    except (httpx.HTTPError, KeyError, ValueError) as e:
        code = getattr(getattr(e, "response", None), "status_code", "")
        raise ValueError(f"O Zoom não criou a reunião{f' (erro {code})' if code else ''}: confirma a ligação à conta") from e
    return update(key, {"reuniao": {"quando": quando, "duracao": duracao, "link": z["join_url"], "zoom_id": z.get("id")}}, who)


def _cel(v) -> str:
    """Uma célula que o Excel não corre como fórmula (o nome de um lead vem de sites alheios)."""
    s = str(v if v is not None else "")
    return "'" + s if s[:1] in ("=", "+", "-", "@", "\t", "\r") else s


def folha() -> str:
    """Os leads numa folha (Excel abre-a direto: ponto e vírgula e BOM), como a do Radar."""
    out = io.StringIO()
    w = csv.writer(out, delimiter=";")
    w.writerow(["Empresa", "Fase", "Valor (€)", "Probabilidade estimada (%)", "Pessoa", "Telefone", "Email", "Site", "Ramo", "Local", "Próxima ação", "Data",
                "Última atividade", "Fecho previsto", "Motivo", "Notas"])
    data = lambda ts: time.strftime("%Y-%m-%d %H:%M", time.localtime(ts)) if ts else ""
    rot = dict(STAGES) | {"nao": "Perdido"}
    for c in board()["leads"]:
        p = c["proxima"] or {}
        w.writerow([_cel(x) for x in (c["nome"], rot.get(c["stage"], c["stage"]), c["valor"], c["prob"], c["contacto"].get("nome"), (c["telefones"] or [""])[0],
                                      (c["emails"] or [""])[0], c["site"], c["ramo_nome"], c["local"], p.get("texto"), data(p.get("quando")), data(c["ult"]),
                                      data(c["fecho"]), c["motivo"], c["nota"])])
    return "\ufeff" + out.getvalue()


def ics(key: str) -> str:
    """A reunião para o calendário (Apple, Outlook, Google)."""
    lead = RADAR._leads().get(key) or {}
    m = lead.get("reuniao")
    if not m:
        raise ValueError("Este lead não tem reunião marcada")
    fmt = lambda ts: time.strftime("%Y%m%dT%H%M%SZ", time.gmtime(ts))
    txt = lambda s: re.sub(r"([,;\\])", r"\\\1", str(s)).replace("\n", "\\n")
    linhas = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//AMG//CRM//PT", "BEGIN:VEVENT", f"UID:{hashlib.sha1(key.encode()).hexdigest()[:16]}-{int(m['quando'])}@amg", f"DTSTAMP:{fmt(time.time())}",
              f"DTSTART:{fmt(m['quando'])}", f"DTEND:{fmt(m['quando'] + m.get('duracao', 30) * 60)}", f"SUMMARY:{txt('Reunião com ' + lead.get('nome', ''))}"]
    if m.get("link"):
        linhas += [f"LOCATION:{txt(m['link'])}", f"URL:{m['link']}", f"DESCRIPTION:{txt('Entrar: ' + m['link'])}"]
    return "\r\n".join(linhas + ["END:VEVENT", "END:VCALENDAR", ""])


def message(nome: str, ramo_nome: str, problemas: list[dict], tem_site: bool) -> str:
    """A primeira mensagem (a mesma regra do Radar: «você», sem travessões, só o que se viu)."""
    ramo = (ramo_nome or "negócios locais").lower()
    top = problemas[:2]
    if not top:
        return (f"Olá, boa tarde.\n\nEstive a ver o {nome} e gostei do que vi. Trabalhamos com {ramo} a trazer mais clientes pelo Google, "
                "pelas redes e com IA (respostas automáticas e marcações).\n\nPosso mostrar-lhe em 15 minutos o que faríamos no seu caso? Sem compromisso.")
    what = ("Estive a ver o vosso site e reparei em duas coisas que estão a afastar clientes:" if tem_site and len(top) > 1 else
            "Estive a ver o vosso site e reparei numa coisa que está a afastar clientes:" if tem_site else
            "Procurei o vosso negócio no Google e reparei numa coisa que está a afastar clientes:")
    lines = "\n".join(f"• {p['problema']}" for p in top)
    sol = " e ".join(p["solucao"][:1].lower() + p["solucao"][1:].rstrip(".") for p in top if p.get("solucao"))
    return (f"Olá, boa tarde.\n\n{what}\n{lines}\n\nTrabalhamos com {ramo} e resolvemos isto em poucos dias: {sol}.\n\n"
            "Posso mostrar-lhe em 15 minutos como ficaria? Sem compromisso.")


def agent(key: str, who_agent: str, who: str, start_ficha=None) -> dict:
    """Um departamento trabalha o lead. start_ficha(scan, nid) é a ficha do Radar (assíncrona, por isso vem do router)."""
    if who_agent not in AGENTES:
        raise ValueError("departamento desconhecido")
    cache = {}
    lead0 = RADAR._leads().get(key)
    if not lead0:
        raise ValueError("lead desconhecido")
    sc, n = _negocio(cache, lead0)

    def fn(lead):
        if who_agent == "pesquisa":
            if not n:
                _log(lead, "agente", "Pesquisa: este lead foi criado à mão, sem pesquisa do Radar para ler." if not lead.get("sid") else
                     "Pesquisa: a pesquisa do Radar desta empresa já foi apagada; não há site nem contactos para ler.", "PES")
                return
            v = veredicto(n) if "oportunidade" in n else None
            if start_ficha:
                start_ficha(sc, n["id"])
            txt = "Pesquisa: a fazer a ficha completa (marca, redes, Google, dinheiro, o que lhe vender)."
            if v:
                txt += f" Veredicto: {v['titulo'].lower()} ({v['pontos']}/100). " + " ".join(f"{p}." for p in v["porque"][:3])
            _log(lead, "agente", txt, "PES")
        elif who_agent == "marketing":
            texto = message(lead.get("nome", ""), (sc or {}).get("ramo_nome", ""), (n or {}).get("problemas") or [], bool((n or {}).get("site")))
            lead["rascunho"] = {"texto": texto, "assunto": f"{lead.get('nome', '')}: uma ideia para ganhar mais clientes",
                                "at": time.time(), "estado": "por aprovar"}
            _log(lead, "agente", "Marketing: primeira mensagem escrita, à espera de aprovação (quem envia é uma pessoa).", "MKT")
        else:
            p = lead.get("proxima") or {}
            if p.get("por") != "Operações":
                lead.pop("proxima", None)
            _next(lead, who)
    return RADAR.edit_lead(key, fn)
