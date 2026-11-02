"""CRM (#/crm, 03 · Negócios): o Radar encontra, o CRM leva cada empresa até ao negócio (2 nov 2026, pedido do David a partir
da conversa do Marco com o GPT: «o Radar e o CRM deixam de ser ferramentas separadas»).

Não há base nova: cada lead é a entrada do seguimento do Radar (`~/.team-agent/radar/seguimento.json`, por ramo + nome), por
isso o que se marca no Radar aparece aqui e vice-versa. O CRM junta-lhe o valor do negócio, a próxima ação com data, as
atividades (chamadas, emails, reuniões, propostas, notas) e o trabalho dos três departamentos:
- Pesquisa (PES) faz a ficha completa da empresa (radar_ficha) e resume o veredicto;
- Marketing (MKT) escreve a primeira mensagem, que fica «por aprovar»: quem envia é sempre uma pessoa;
- Operações (OPS) marca a próxima ação conforme a fase.
Só neste PC, como o Radar: nada vai por sync. Código síncrono; a única chamada assíncrona é a ficha (FICHAS.start), feita no router.
"""
from __future__ import annotations

import time

from .radar import ESTADOS, RADAR, veredicto

# a ordem do quadro; «por_contactar» com nota é um lead novo, «nao» fica nos perdidos
STAGES = [("novo", "Novo lead"), ("contactado", "Contactado"), ("respondeu", "Respondeu"), ("reuniao", "Reunião"),
          ("proposta", "Proposta"), ("fechou", "Ganho")]
TIPOS = {"chamada": "Chamada", "email": "Email", "whatsapp": "WhatsApp", "reuniao": "Reunião", "proposta": "Proposta", "nota": "Nota"}
AGENTES = {"pesquisa": ("PES", "Pesquisa"), "marketing": ("MKT", "Marketing"), "operacoes": ("OPS", "Operações")}
DIA = 86400
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
    tel = [x.strip() for x in str((n or {}).get("telefone") or lead.get("telefone") or "").replace(",", ";").replace("/", ";").split(";") if x.strip()]
    tel += [x for x in a.get("telefones") or [] if x not in tel]
    mails = ([n["email"]] if n and n.get("email") else []) + [x for x in a.get("emails") or [] if x != (n or {}).get("email")]
    return {"telefones": tel[:4], "emails": mails[:4], "facebook": (n or {}).get("facebook", ""), "site": (n or {}).get("site") or lead.get("site", ""),
            "morada": (n or {}).get("morada", ""), "maps": (n or {}).get("maps", ""), "lat": (n or {}).get("lat"), "lon": (n or {}).get("lon")}


def card(key: str, lead: dict, cache: dict) -> dict:
    sc, n = _negocio(cache, lead)
    v = veredicto(n) if n and "oportunidade" in n else None
    return {"key": key, "nome": lead.get("nome", ""), "ramo": lead.get("ramo", ""), "ramo_nome": (sc or {}).get("ramo_nome", ""),
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
    }
    return {"stages": STAGES, "estados": ESTADOS, "tipos": TIPOS, "agentes": {k: v[1] for k, v in AGENTES.items()},
            "leads": cards, "radar": quentes, "resumo": resumo}


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


def update(key: str, body: dict, who: str) -> dict:
    def fn(lead):
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
                v = float(v)
                if v < 0 or v > 10_000_000:
                    raise ValueError("valor fora do normal")
                lead["valor"] = round(v)
        if "proxima" in body:
            p = body["proxima"]
            if not p:
                lead.pop("proxima", None)
            else:
                lead["proxima"] = {"texto": str(p.get("texto") or "")[:200], "quando": float(p.get("quando") or time.time()), "por": who}
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
                _log(lead, "agente", "Pesquisa: a pesquisa do Radar desta empresa já foi apagada; não há site nem contactos para ler.", "PES")
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
