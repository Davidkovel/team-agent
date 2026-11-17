"""Agente de chamadas da Angariação, em simulação (fase 11 do prompt das escolas, feito para qualquer ramo, 15 nov 2026).

Ninguém é ligado a sério: a conversa corre em texto contra uma de 5 personas (dono interessado, secretária, «mande por email»,
«já temos sistema», «não quero»). O agente segue o guião da secção 12 do prompt:
  1. abertura ligada ao email e ao sinal; se visitou a página diz quanto tempo e o que viu, se não visitou é a abertura fria;
  2. confirma se fala com quem decide (se não, pede o nome e a melhor hora); 3. pergunta de dor ligada ao sinal;
  4. a oferta em 2 frases; 5. as objeções (não tenho tempo, já temos sistema, é caro, mande por email), insiste no máximo uma vez;
  6. fecho com dia e hora concretos (2 opções). Um «não» claro acaba com educação e marca NAO_CONTACTAR.
Só se liga em dias úteis das 9:30 às 12:30 e das 14:30 às 18:30 (Lisboa); fora disso a chamada fica AGENDADA para a próxima vaga.

Máquina de estados (a mesma do prompt): AGENDADA -> A_LIGAR -> {ATENDEU, NAO_ATENDEU, OCUPADO, ERRO};
ATENDEU -> EM_CONVERSA -> TERMINADA -> A_ANALISAR -> ANALISADA -> PDF_GERADO -> SINCRONIZADA;
NAO_ATENDEU/OCUPADO -> nova tentativa (máx. 3, depois de 2 h e de 1 dia, sempre em horário) -> ESGOTADA; ERRO -> 5 min (máx. 2) -> ESGOTADA.
As chamadas ficam em angariacao.json («calls»); o resultado vai para o CRM (atividade, fase) e há um PDF por chamada e um diário."""
from __future__ import annotations

import html
import subprocess
import sys
import time
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from . import angariacao as A

LX = ZoneInfo("Europe/Lisbon")
VAGAS = [((9, 30), (12, 30)), ((14, 30), (18, 30))]
MAX_TENTATIVAS = {"NAO_ATENDEU": 3, "OCUPADO": 3, "ERRO": 2}
ESPERA = {"NAO_ATENDEU": [2 * 3600, 86400], "OCUPADO": [2 * 3600, 86400], "ERRO": [300]}
TRANSICOES = {
    "AGENDADA": {"A_LIGAR"}, "A_LIGAR": {"ATENDEU", "NAO_ATENDEU", "OCUPADO", "ERRO"},
    "ATENDEU": {"EM_CONVERSA"}, "EM_CONVERSA": {"TERMINADA"}, "TERMINADA": {"A_ANALISAR"}, "A_ANALISAR": {"ANALISADA"},
    "ANALISADA": {"PDF_GERADO"}, "PDF_GERADO": {"SINCRONIZADA"},
    "NAO_ATENDEU": {"AGENDADA", "ESGOTADA"}, "OCUPADO": {"AGENDADA", "ESGOTADA"}, "ERRO": {"AGENDADA", "ESGOTADA"},
}
RESULTADOS = {"REUNIAO": "Reunião marcada", "INTERESSADO": "Interessado", "LIGAR_MAIS_TARDE": "Ligar mais tarde",
              "NAO_INTERESSADO": "Não interessado", "NAO_ATENDEU": "Não atendeu", "NAO_CONTACTAR": "Não contactar"}
ESTADO_CRM = {"REUNIAO": "reuniao", "INTERESSADO": "respondeu", "LIGAR_MAIS_TARDE": "contactado", "NAO_INTERESSADO": "contactado",
              "NAO_CONTACTAR": "nao"}
PERSONAS = {"dono": "Dono interessado", "secretaria": "Secretária", "email": "«Mande por email»", "sistema": "«Já temos sistema»",
            "nao": "«Não quero»"}
e = html.escape


# ------------------------------------------------------------------ horário (Lisboa)
def em_horario(ts: float) -> bool:
    d = datetime.fromtimestamp(ts, LX)
    if d.weekday() >= 5:
        return False
    m = d.hour * 60 + d.minute
    return any(a[0] * 60 + a[1] <= m < b[0] * 60 + b[1] for a, b in VAGAS)


def proxima_vaga(ts: float) -> float:
    """O próprio instante se já está em horário; senão o início da vaga seguinte (dia útil, 9:30 ou 14:30)."""
    if em_horario(ts):
        return ts
    d = datetime.fromtimestamp(ts, LX)
    for dia in range(8):
        base = (d + timedelta(days=dia)).replace(second=0, microsecond=0)
        if base.weekday() >= 5:
            continue
        for (h, mi), _ in VAGAS:
            c = base.replace(hour=h, minute=mi)
            if c.timestamp() > ts:
                return c.timestamp()
    return ts


# ------------------------------------------------------------------ máquina de estados
def transitar(call: dict, novo: str, ts: float | None = None) -> dict:
    if novo not in TRANSICOES.get(call["estado"], set()):
        raise ValueError(f"{call['estado']} -> {novo} não é permitido")
    call["estado"] = novo
    call["log"].append([ts or time.time(), novo])
    return call


def reagendar(call: dict, ts: float) -> dict:
    """Depois de NAO_ATENDEU, OCUPADO ou ERRO: nova tentativa em horário, ou ESGOTADA quando acabam."""
    falha = call["estado"]
    n = sum(1 for _, s in call["log"] if s == falha)
    if n >= MAX_TENTATIVAS[falha]:
        return transitar(call, "ESGOTADA", ts)
    esperas = ESPERA[falha]
    call["quando"] = proxima_vaga(ts + esperas[min(n - 1, len(esperas) - 1)])
    call["tentativas"] = call.get("tentativas", 0) + 1
    return transitar(call, "AGENDADA", ts)


def nova(key: str, persona: str, ts: float | None = None) -> dict:
    ts = ts or time.time()
    if persona not in PERSONAS and persona != "sem_resposta":
        raise ValueError("persona desconhecida")
    return {"id": uuid.uuid4().hex[:10], "key": key, "persona": persona, "estado": "AGENDADA", "criada": ts,
            "quando": proxima_vaga(ts), "log": [[ts, "AGENDADA"]], "tentativas": 1, "simulada": True}


# ------------------------------------------------------------------ o guião e as personas
def _contexto(card: dict, cfg: dict) -> dict:
    code = A.code_for(card["key"])
    t = A.totais(code)
    ultima = next((v for v in sorted(A._load()["visits"].values(), key=lambda v: -v["last"]) if v["code"] == code and v.get("ended")), None)
    return {"code": code, "t": t, "secoes": (ultima or {}).get("secoes") or [], "sinal": A.sinal(card), "cfg": cfg}


def abertura(card: dict, ctx: dict) -> str:
    """A 1.ª frase do guião: quente se visitou (tempo e o que viu), fria a partir do sinal se não."""
    return A.guiao(card, ctx["cfg"], ctx["t"], ctx["secoes"])[0] + " É consigo que falo sobre isto?"


def _dois_horarios(ts: float) -> list[float]:
    a = proxima_vaga(ts + 86400)
    a = datetime.fromtimestamp(a, LX).replace(hour=10, minute=0).timestamp()
    while not em_horario(a):
        a = proxima_vaga(a + 3600)
    b = proxima_vaga(a + 86400)
    b = datetime.fromtimestamp(b, LX).replace(hour=15, minute=0).timestamp()
    while not em_horario(b):
        b = proxima_vaga(b + 3600)
    return [a, b]


def _dia(ts: float) -> str:
    d = datetime.fromtimestamp(ts, LX)
    dias = ["segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"]
    return f"{dias[d.weekday()]}, {d.day}/{d.month}, às {d.hour}h{d.minute:02d}" if d.minute else f"{dias[d.weekday()]}, {d.day}/{d.month}, às {d.hour}h"


def conversar(card: dict, ctx: dict, persona: str, ts: float) -> tuple[list[list[str]], dict]:
    """O diálogo em texto. Devolve a transcrição ([quem, frase]) e o que ficou: resultado, próximo passo, objeções, dores."""
    cfg, s = ctx["cfg"], ctx["sinal"]
    nome = cfg.get("nome") or "o nosso comercial"
    g = A.guiao(card, cfg, ctx["t"], ctx["secoes"])
    dor = (f"Hoje, quando alguém procura e vê que {s['texto'][:1].lower() + s['texto'][1:]}, o que costuma acontecer?" if s["texto"]
           else "Hoje, de onde vos chegam os clientes novos, e quantos se perdem pelo caminho?")
    pitch = g[1] + " Em poucos dias fica a funcionar e todos os meses dizemos quantos contactos chegaram por aí."
    op = _dois_horarios(ts)
    fecho = f"Posso mostrar-lhe como ficaria em 15 minutos: dá-lhe mais jeito {_dia(op[0])} ou {_dia(op[1])}?"
    T: list[list[str]] = [["Agente", abertura(card, ctx)]]
    out = {"objecoes": [], "dores": [], "proximo": "", "proximo_ts": None, "resultado": ""}
    ag = lambda x: T.append(["Agente", x])  # noqa: E731
    cl = lambda x: T.append(["Cliente", x])  # noqa: E731
    if persona == "nao":
        cl("Não, obrigado. Não estamos interessados, e não volte a ligar.")
        ag("Com certeza, peço desculpa pelo incómodo. Tiro já o vosso contacto da nossa lista. Bom trabalho!")
        out.update(resultado="NAO_CONTACTAR", proximo="Não voltar a contactar")
        out["objecoes"].append("Não quer ser contactado")
    elif persona == "secretaria":
        cl("Não, eu sou da secretaria. Quem trata disso é o dono, mas agora não está.")
        ag("Obrigado! Como se chama a pessoa com quem devo falar, e qual a melhor hora para a apanhar?")
        cl("É o senhor Carlos. Costuma estar cá de manhã, a partir das dez.")
        quando = op[0]
        ag(f"Perfeito, ligo-lhe {_dia(quando)}. Pode dizer-lhe que liguei a propósito do email? Obrigado e bom trabalho.")
        out.update(resultado="LIGAR_MAIS_TARDE", proximo=f"Ligar ao Carlos (quem decide), {_dia(quando)}", proximo_ts=quando, decisor="Carlos")
    else:
        cl("Sim, sou eu. Diga.")
        ag(dor)
        if persona == "dono":
            cl("Pois, perdemos alguns. As pessoas ligam fora de horas e ninguém atende, e depois vão a outro lado.")
            out["dores"].append("Pedidos fora de horas ficam sem resposta e vão para a concorrência")
            ag(pitch)
            cl("Parece interessante. Quanto é que isso custa?")
            out["objecoes"].append("Preço")
            ag("Depende do que for preciso, mas compare com o que vale um cliente perdido por mês. Na reunião mostro-lhe números à sua medida. " + fecho)
            cl(f"Pode ser {_dia(op[0]).split(',')[0]}.")
            ag(f"Combinado: {_dia(op[0])}. Mando-lhe já a confirmação por email. Obrigado!")
            out.update(resultado="REUNIAO", proximo=f"Reunião de 15 min, {_dia(op[0])}", proximo_ts=op[0])
        elif persona == "email":
            cl("Olhe, agora não tenho tempo. Mande-me isso por email que eu vejo.")
            out["objecoes"].append("Mande por email")
            mail = (card.get("emails") or [""])[0]
            ag(f"Claro. Confirmo o email: {mail}?" if mail else "Claro. Para que email mando?")
            cl("Sim, é esse." if mail else "Mande para o geral da empresa.")
            ag(f"Mando hoje com o exemplo para o vosso caso. Ligo-lhe {_dia(op[1])} para saber o que achou, pode ser?")
            cl("Pode ser.")
            out.update(resultado="LIGAR_MAIS_TARDE", proximo=f"Enviar o email e voltar a ligar {_dia(op[1])}", proximo_ts=op[1])
        else:  # sistema
            cl("Nós já temos um sistema para isso, obrigado.")
            out["objecoes"].append("Já tem sistema")
            ag("Ótimo, já estão um passo à frente. Diga-me só: o que é que esse sistema hoje ainda não vos resolve?")
            cl("Está tudo a funcionar, não precisamos de nada.")
            ag("Percebo, fica registado. Se um dia quiser comparar, tem o meu contacto no email. Obrigado e bom trabalho!")
            out.update(resultado="NAO_INTERESSADO", proximo="Voltar a tentar daqui a 3 meses", proximo_ts=ts + 90 * 86400)
    out["nome_agente"] = nome
    return T, out


# ------------------------------------------------------------------ correr uma chamada simulada do princípio ao fim
def analisar(call: dict, card: dict) -> dict:
    """Pós-chamada: resumo de 3 a 5 linhas, dores, objeções e frases citadas tal e qual da transcrição."""
    r, T = call["fim"], call["transcricao"]
    cliente = [x for q, x in T if q == "Cliente"]
    linhas = [f"Ligámos para {card['nome']} ({PERSONAS.get(call['persona'], call['persona'])}, em simulação).",
              ("Abrimos a falar da visita à página (" + A.dur(call["contexto"]["segundos"]) + ")." if call["contexto"]["visitas"]
               else "Não tinha visto a página: abertura a partir do sinal do email."),
              f"Resultado: {RESULTADOS[r['resultado']].lower()}."]
    if r["objecoes"]:
        linhas.append("Objeções: " + ", ".join(o.lower() for o in r["objecoes"]) + ".")
    if r["proximo"]:
        linhas.append("Próximo passo: " + r["proximo"] + ".")
    return {"resultado": r["resultado"], "resumo": linhas[:5], "dores": r["dores"], "objecoes": r["objecoes"],
            "citacoes": cliente[:3], "proximo": r["proximo"], "proximo_ts": r["proximo_ts"]}


def _sincronizar(call: dict, card: dict) -> None:
    from . import crm
    from .radar import RADAR
    a = call["analise"]
    est = ESTADO_CRM.get(a["resultado"])

    def fn(lead):
        crm._log(lead, "chamada", f"📞 Chamada simulada ({PERSONAS.get(call['persona'])}): {RESULTADOS[a['resultado']].lower()}."
                 + (f" {a['proximo']}." if a["proximo"] else ""), "Agente de chamadas")
        if est and est != lead.get("estado") and lead.get("estado") not in ("fechou",):
            lead["hist"] = (lead.get("hist") or [])[-20:] + [[time.time(), est, "Agente de chamadas"]]
            lead["estado"] = est
            if est == "nao":
                lead["motivo"] = "Pediu para não voltar a ser contactado"
        if a.get("proximo_ts") and a["resultado"] != "NAO_CONTACTAR":
            lead["proxima"] = {"texto": a["proximo"], "quando": a["proximo_ts"], "por": "Agente de chamadas"}
        elif a["resultado"] == "NAO_CONTACTAR":
            lead.pop("proxima", None)
    RADAR.edit_lead(card["key"], fn)


def simular(key: str, persona: str, ts: float | None = None, pdf: bool = True, sync: bool = True) -> dict:
    """Uma chamada simulada inteira. Fora do horário fica AGENDADA (não liga); «sem_resposta» testa as novas tentativas."""
    card = A.lead_card(key)
    if not card:
        raise ValueError("lead desconhecido")
    agora = ts or time.time()
    call = nova(key, persona, agora)
    ctx = _contexto(card, A.config())
    call["code"], call["nome"] = ctx["code"], card["nome"]
    call["contexto"] = {**ctx["t"], "secoes": ctx["secoes"], "sinal": ctx["sinal"]["texto"]}
    if not em_horario(agora):
        call["nota"] = "Fora do horário: fica para " + _dia(call["quando"]) + "."
        return _guardar(call)
    transitar(call, "A_LIGAR", agora)
    if persona == "sem_resposta":
        transitar(call, "NAO_ATENDEU", agora + 30)
        reagendar(call, agora + 30)
        call["nota"] = "Não atendeu (30 s a tocar): nova tentativa " + _dia(call["quando"]) + "."
        return _guardar(call)
    transitar(call, "ATENDEU", agora + 8)
    transitar(call, "EM_CONVERSA", agora + 9)
    T, fim = conversar(card, ctx, persona, agora)
    call["transcricao"], call["fim"] = T, fim
    call["duracao"] = min(240, 20 + 14 * len(T))  # máximo 4 min
    transitar(call, "TERMINADA", agora + call["duracao"])
    transitar(call, "A_ANALISAR", agora + call["duracao"])
    call["analise"] = analisar(call, card)
    transitar(call, "ANALISADA", agora + call["duracao"] + 1)
    if pdf:
        try:
            call["pdf"] = str(pdf_chamada(call, card))
            transitar(call, "PDF_GERADO", agora + call["duracao"] + 2)
        except RuntimeError as err:
            call["nota"] = f"PDF por fazer: {err}"
    if sync and call["estado"] == "PDF_GERADO":
        _sincronizar(call, card)
        transitar(call, "SINCRONIZADA", agora + call["duracao"] + 3)
    return _guardar(call)


def _guardar(call: dict) -> dict:
    def fn(d):
        d.setdefault("calls", {})[call["id"]] = call
        if len(d["calls"]) > 500:
            for k in sorted(d["calls"], key=lambda k: d["calls"][k]["criada"])[:-500]:
                d["calls"].pop(k)
    A.edit(fn)
    return call


def lista(key: str | None = None) -> list[dict]:
    cs = (A._load().get("calls") or {}).values()
    return sorted((c for c in cs if not key or c["key"] == key), key=lambda c: -c["criada"])


def get(cid: str) -> dict | None:
    return (A._load().get("calls") or {}).get(cid)


# ------------------------------------------------------------------ PDFs (o mesmo formato da casa do diagnóstico do Radar)
OUT = A.STATE.parent / "chamadas"
CSS = """@page { size: A4; margin: 0; } * { box-sizing: border-box; }
body { margin: 0; font: 10.5pt/1.5 "Segoe UI", Inter, Arial, sans-serif; color: #17181a; }
.pg { width: 210mm; padding: 16mm 18mm 14mm; page-break-after: always; } .pg:last-child { page-break-after: auto; }
.eb { font-size: 8pt; letter-spacing: .22em; text-transform: uppercase; color: #8a8d93; }
h1 { font: 400 26pt/1.1 Georgia, "Times New Roman", serif; margin: 4mm 0 2mm; } h2 { font: 400 14pt/1.2 Georgia, serif; margin: 7mm 0 3mm; }
.sub { color: #55585e; margin: 0; } .box { background: #f6f6f4; padding: 4mm 5mm; margin-top: 5mm; }
.res { border-left: 4px solid #17181a; padding: 3mm 5mm; margin-top: 5mm; font: 400 17pt Georgia, serif; }
.res.REUNIAO, .res.INTERESSADO { border-color: #4f8a5b; } .res.NAO_CONTACTAR, .res.NAO_INTERESSADO { border-color: #b4533c; }
.nums { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4mm; margin: 5mm 0 0; }
.n { border-top: 2px solid #17181a; padding-top: 2mm; } .n b { display: block; font: 400 17pt Georgia, serif; } .n span { color: #55585e; font-size: 8.5pt; }
ul { margin: 1mm 0; padding-left: 5mm; } q { font-style: italic; color: #33363b; }
table { width: 100%; border-collapse: collapse; font-size: 9.5pt; } td, th { text-align: left; vertical-align: top; padding: 2mm 2mm 2mm 0; border-top: 1px solid #e3e4e6; }
th { font-size: 7.5pt; letter-spacing: .14em; text-transform: uppercase; color: #8a8d93; font-weight: 600; border-top: 0; }
.lead { page-break-inside: avoid; border-top: 1px solid #e3e4e6; padding: 3mm 0; } .lead b { font: 400 12pt Georgia, serif; }
.mail { white-space: pre-wrap; background: #f6f6f4; padding: 3mm 4mm; margin-top: 2mm; font-size: 9pt; }
.met { margin-top: 6mm; font-size: 8pt; color: #8a8d93; border-top: 1px solid #e3e4e6; padding-top: 3mm; }"""


def _print(html_doc: str, out: Path) -> Path:
    from .etsy import chrome
    exe = chrome()
    if not exe:
        raise RuntimeError("falta o Google Chrome para fazer o PDF")
    out.parent.mkdir(parents=True, exist_ok=True)
    page = out.with_suffix(".html")
    page.write_text(html_doc, "utf-8")
    out.unlink(missing_ok=True)
    subprocess.run([exe, "--headless=new", "--disable-gpu", "--no-pdf-header-footer", f"--print-to-pdf={out}", page.as_uri()],
                   capture_output=True, timeout=120, creationflags=0x08000000 if sys.platform == "win32" else 0)
    page.unlink(missing_ok=True)
    if not out.exists():
        raise RuntimeError("o Chrome não fez o PDF")
    return out


def _doc(titulo: str, corpo: str) -> str:
    return f'<!doctype html><html lang="pt-PT"><head><meta charset="utf-8"><title>{e(titulo)}</title><style>{CSS}</style></head><body>{corpo}</body></html>'


def html_chamada(call: dict, card: dict) -> str:
    a, c = call["analise"], call["contexto"]
    quando = datetime.fromtimestamp(call["log"][1][0] if len(call["log"]) > 1 else call["criada"], LX)
    sobre = " · ".join(x for x in [card.get("ramo_nome") if not str(card.get("ramo_nome", "")).lower().startswith("todas") else "",
                                    card.get("local"), (card.get("telefones") or [""])[0], (card.get("emails") or [""])[0]] if x)
    lis = lambda xs: "".join(f"<li>{e(x)}</li>" for x in xs) or "<li>Nenhuma.</li>"  # noqa: E731
    return _doc(f"Chamada · {card['nome']}", f"""<section class="pg">
<div class="eb">Chamada {e(call['code'])} · {quando:%d/%m/%Y %H:%M} · {A.dur(call.get('duracao') or 0)}{' · simulação' if call.get('simulada') else ''}</div>
<h1>{e(card['nome'])}</h1>
<div class="box"><b>Sobre a empresa.</b> {e(sobre) or 'Sem dados de contacto.'}{('<br>Sinal do email: ' + e(c['sinal']) + '.') if c.get('sinal') else ''}</div>
<div class="res {a['resultado']}">{e(RESULTADOS[a['resultado']])}</div>
<h2>Resumo</h2><ul>{lis(a['resumo'])}</ul>
<div class="nums"><div class="n"><b>{c['visitas']}</b><span>visitas à página antes da chamada</span></div>
<div class="n"><b>{e(A.dur(c['segundos']))}</b><span>no site</span></div>
<div class="n"><b>{c['scroll']}%</b><span>da página lida</span></div>
<div class="n"><b>{c['wa']}</b><span>cliques no WhatsApp</span></div></div>
<h2>Dores e objeções</h2><table><tr><th>Dores</th><th>Objeções</th></tr><tr><td><ul>{lis(a['dores'])}</ul></td><td><ul>{lis(a['objecoes'])}</ul></td></tr></table>
<h2>Próximo passo</h2><p>{e(a['proximo'] or 'Nenhum.')}</p>
<h2>Frases-chave</h2><ul>{''.join(f'<li><q>{e(x)}</q></li>' for x in a['citacoes']) or '<li>Nenhuma.</li>'}</ul>
<div class="met">Feito pelo agente de chamadas do Hub. As frases citadas são tal e qual da transcrição.</div>
</section>""")


def pdf_chamada(call: dict, card: dict) -> Path:
    return _print(html_chamada(call, card), OUT / f"{call['code']}-{datetime.fromtimestamp(call['criada'], LX):%Y%m%d-%H%M}-{call['id']}.pdf")


def html_diario(dia: str | None = None) -> str:
    from . import crm
    dia = dia or datetime.now(LX).strftime("%Y-%m-%d")
    d = A._load()
    do_dia = lambda ts: datetime.fromtimestamp(ts, LX).strftime("%Y-%m-%d") == dia  # noqa: E731
    vis = [v for v in d["visits"].values() if v.get("ended") and v["ativo_ms"] >= A.MIN_ATIVO_MS and do_dia(v["last"])]
    calls = [c for c in (d.get("calls") or {}).values() if do_dia(c["criada"])]
    res = [c for c in calls if c.get("analise")]
    reun = sum(1 for c in res if c["analise"]["resultado"] == "REUNIAO")
    quentes = {v["code"] for v in vis if A.totais(v["code"], d)["temperatura"] == "quente"}
    board = {c["key"]: c for c in crm.board()["leads"]}
    linhas = "".join(f"<tr><td>{datetime.fromtimestamp(c['criada'], LX):%H:%M}</td><td>{e(c.get('nome') or board.get(c['key'], {}).get('nome', c['key']))}</td>"
                     f"<td>{e(PERSONAS.get(c['persona'], 'Sem resposta'))}</td><td>{e(RESULTADOS[c['analise']['resultado']] if c.get('analise') else c['estado'].replace('_', ' ').lower())}</td>"
                     f"<td>{e((c.get('analise') or {}).get('proximo') or c.get('nota') or '')}</td></tr>" for c in sorted(calls, key=lambda c: c["criada"]))
    dt = datetime.strptime(dia, "%Y-%m-%d")
    return _doc(f"Diário {dia}", f"""<section class="pg"><div class="eb">Angariação · diário</div><h1>{dt:%d/%m/%Y}</h1>
<p class="sub">O funil do dia e uma linha por chamada.</p>
<div class="nums"><div class="n"><b>{len(vis)}</b><span>visitas às páginas</span></div><div class="n"><b>{len(quentes)}</b><span>empresas quentes</span></div>
<div class="n"><b>{len(calls)}</b><span>chamadas</span></div><div class="n"><b>{reun}</b><span>reuniões marcadas</span></div></div>
<h2>Chamadas</h2><table><tr><th>Hora</th><th>Empresa</th><th>Quem atendeu</th><th>Resultado</th><th>Próximo passo</th></tr>{linhas or '<tr><td colspan=5>Sem chamadas neste dia.</td></tr>'}</table>
<div class="met">Visitas com mais de 5 s ativos. As chamadas marcadas como simulação não ligaram a ninguém.</div></section>""")


def pdf_diario(dia: str | None = None) -> Path:
    dia = dia or datetime.now(LX).strftime("%Y-%m-%d")
    return _print(html_diario(dia), OUT / "diario" / f"{dia}.pdf")


def html_validacao(hub_url: str) -> str:
    """Todas as empresas da Angariação com a nota, o sinal e o email por aprovar: para ver tudo antes de enviar."""
    from . import crm
    cfg = A.config()
    blocos = []
    for c in crm.board()["leads"]:
        if c["stage"] in ("fechou", "nao"):
            continue
        code = A.code_for(c["key"])
        s = A.sinal(c)
        r = c.get("rascunho") or A.email(c, cfg, A.link_for(code, cfg, hub_url))
        contacto = " · ".join(x for x in [(c.get("telefones") or [""])[0], (c.get("emails") or [""])[0], c.get("site")] if x)
        blocos.append((A.nota(c, A._negocio(c)), f"""<div class="lead"><div class="eb">{e(code)} · nota {A.nota(c, A._negocio(c))}/10 · {e(c.get('local') or '')}</div>
<b>{e(c['nome'])}</b><div>{e(contacto) or 'Sem contacto'}</div>
<div><i>Porque a escolhemos:</i> {e(s['texto'] or 'o Radar diz que vale a pena')}{(' (' + e(s['dominio']) + ')') if s['dominio'] else ''}.</div>
<div class="mail"><b>{e(r.get('assunto', ''))}</b>\n{e(r.get('texto', ''))}</div></div>"""))
    blocos.sort(key=lambda x: -x[0])
    return _doc("Validação da Angariação", f"""<section class="pg"><div class="eb">Angariação · validação · {datetime.now(LX):%d/%m/%Y}</div>
<h1>{len(blocos)} empresas</h1><p class="sub">Cada uma com a nota de 0 a 10, o sinal que a fez entrar e o primeiro email por aprovar. Nada foi enviado.</p>
{''.join(b for _, b in blocos)}</section>""")


def pdf_validacao(hub_url: str) -> Path:
    return _print(html_validacao(hub_url), OUT / f"validacao-{datetime.now(LX):%Y%m%d}.pdf")
