"""The two traders of the room and their meetings.

- Pinguim (Oswald Cobblepot): the macro desk. The economic calendar, the central banks, the dollar, yields, oil, fear,
  and the headlines.
- Duas-Caras (Harvey Dent): the chart desk. Smart Money Concepts: liquidity, sweeps, BOS/CHoCH, gaps, blocks,
  premium/discount, killzones. Always both faces of the market, and the coin stays in the pocket when they tie.

A meeting is three turns: the Pinguim opens, the Duas-Caras answers, the Pinguim closes with the minutes (a JSON
verdict: what matters, how much, and whether to call the partners with the big alert). With Claude on (a switch per
PC, `claude` in the room's settings) each turn is a real Claude, run headless here with no tools, no hooks and no
saved session; with it off, the room still meets, with the lines written from the numbers (mode "auto")."""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import shutil
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .analysis import fmt
from .sessions import killzone, london_offset, ny, sessions

log = logging.getLogger("tradingroom")
UTC = timezone.utc

PEOPLE = {
    "penguin": {"name": "Pinguim", "full": "Oswald Cobblepot", "what": "Macro e notícias"},
    "twoface": {"name": "Duas-Caras", "full": "Harvey Dent", "what": "Gráfico (SMC)"},
}

PENGUIN = ("És o Pinguim, Oswald Cobblepot, o homem do dinheiro da Empresa AMG, dono do Iceberg Lounge e trader macro de "
           "velha escola. Na Sala de Trading cuidas das notícias e do macro: calendário económico, bancos centrais, dólar "
           "(DXY), juros (US10Y), petróleo, medo (VIX) e manchetes. Falas português de Portugal, frases curtas, com uma ponta "
           "de vaidade e a ironia de quem já viu tudo, mas nunca inventas: só usas os números e as notícias do briefing, e "
           "dizes as horas em hora de Lisboa. Estás a falar com os sócios e com o teu colega, não a dar conselhos de "
           "investimento. Sem emojis, sem markdown, sem listas.")
TWOFACE = ("És o Duas-Caras, Harvey Dent, o técnico da Sala de Trading da Empresa AMG. Lês o preço com Smart Money Concepts "
           "(ICT): liquidez (topos e fundos iguais, PDH e PDL, máximos e mínimos da Ásia e de Londres, semana passada), sweeps, "
           "BOS e CHoCH, fair value gaps, order blocks, premium e desconto, killzones. Vês sempre as duas caras do mercado: "
           "dizes o cenário de alta e o de baixa e o que invalida cada um, e só escolhes um lado quando há confluência. Se os "
           "dois empatam, a moeda fica no bolso e não se entra. Português de Portugal, direto, níveis com o número exato do "
           "briefing (nunca inventes um nível). Sem emojis, sem markdown, sem listas.")

VERDICT = """{
  "fala": "a tua última fala na reunião, 2 a 4 frases: se concordas com o Duas-Caras e qual é o plano",
  "titulo": "a mensagem para os sócios, até 70 caracteres, concreta (instrumento, nível, hora)",
  "resumo": "2 a 3 frases: o que interessa agora e porquê",
  "importancia": 3,
  "alerta": false,
  "foco": [{"simbolo": "XAUUSD", "direcao": "compra | venda | esperar", "zona": "4 182,66–4 184,94", "stop": "4 180,49",
            "alvos": ["4 196,54"], "condicao": "o que tem de acontecer antes de entrar", "confianca": 3}],
  "atencao": ["frases curtas: horas a evitar, níveis a vigiar"]
}
Regras: importancia de 1 (nada a fazer) a 5 (exige atenção já: sweep de um nível-chave com setup A ou A+, ou notícia de alto
impacto daqui a menos de 30 minutos, ou acabada de sair com surpresa). alerta só é true com importancia 4 ou 5 e uma ação
concreta para os sócios. foco: no máximo 3, só com níveis que estão no briefing. atencao: no máximo 4."""


# ------------------------------------------------------------------ the briefing both of them read
def lisbon(t: datetime) -> datetime:
    return (t + timedelta(hours=london_offset(t))).replace(tzinfo=None)   # Lisbon keeps London's time


def _hm(t: datetime) -> str:
    return lisbon(t).strftime("%H:%M")


def _when(iso: str, now: datetime) -> str:
    at = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    mins = int((at - now).total_seconds() // 60)
    day = "hoje" if lisbon(at).date() == lisbon(now).date() else "amanhã" if lisbon(at).date() == (lisbon(now) + timedelta(days=1)).date() else lisbon(at).strftime("%d/%m")
    rel = f"daqui a {mins // 60}h{mins % 60:02d}" if mins >= 60 else f"daqui a {mins} min" if mins >= 0 else f"há {(-mins) // 60}h{(-mins) % 60:02d}" if mins <= -60 else f"há {-mins} min"
    return f"{_hm(at)} {day} ({rel})"


def _num(v, unit="") -> str:
    if v is None:
        return "—"
    return (f"{v:g}" if isinstance(v, (int, float)) else str(v)).replace(".", ",") + (unit or "")


def _dec(v: float, n: int = 1) -> str:
    return f"{v:.{n}f}".replace(".", ",")


DAYS = ["segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"]


def brief(room: dict, now: datetime, reason: str, focus: list[str]) -> str:
    """Everything the two of them know, in words and numbers, short enough to read in one go."""
    lines = []
    kz = killzone(now)
    open_s = [s["name"] for s in sessions(now) if s["open"]]
    lines.append(f"AGORA: {DAYS[lisbon(now).weekday()]} {lisbon(now):%d/%m/%Y %H:%M} em Lisboa ({now:%H:%M} UTC, {ny(now):%H:%M} em Nova Iorque). "
                 f"Sessões abertas: {', '.join(open_s) or 'nenhuma'}. Killzone: {kz['name'] if kz else 'nenhuma'}.")
    lines.append(f"MOTIVO DA REUNIÃO: {reason}")
    cal = [e for e in room.get("calendar", []) if e["imp"] >= 3 and e["ccy"] in ("USD", "EUR", "GBP", "JPY")]
    near = [e for e in cal if -6 * 60 <= (datetime.fromisoformat(e["t"].replace("Z", "+00:00")) - now).total_seconds() / 60 <= 26 * 60]
    lines.append("\nCALENDÁRIO (alto impacto, das últimas 6 h às próximas 26 h):")
    for e in near[:10]:
        fig = f" · saiu {_num(e['actual'], e['unit'])} · previsão {_num(e['forecast'], e['unit'])} · anterior {_num(e['previous'], e['unit'])}"
        lines.append(f"- {_when(e['t'], now)} · {e['ccy']} · {e['pt'] or e['title']}{fig}")
    if not near:
        lines.append("- nada de alto impacto")
    ctx = room.get("context", [])
    if ctx:
        lines.append("\nCONTEXTO: " + " · ".join(f"{c['name']} {fmt(c['price'], c['dp'])} ({'+' if (c['chg'] or 0) >= 0 else ''}{_num(round(c['chg'] or 0, 2))}%)" for c in ctx))
    news = [n for n in room.get("news", []) if now.timestamp() - n["t"] < 10 * 3600][:12]
    lines.append("\nMANCHETES (últimas 10 h, mais recentes primeiro):")
    for n in news:
        lines.append(f"- {_hm(datetime.fromtimestamp(n['t'], UTC))} {n['source']}{' · URGENTE' if n['urgent'] else ''} · {n['title']} [{', '.join(n['for'])}]")
    if not news:
        lines.append("- nenhuma")
    lines.append("\nMERCADOS (H1 ATR = amplitude média de uma vela de 1 hora; distâncias em ATR H1):")
    for a in room.get("instruments", []):
        dp = a["dp"]
        deep = a["id"] in focus
        pd = f" · {round(a['pd'] * 100)}% do range H4 ({'premium' if a['pd'] > .5 else 'desconto'})" if a.get("pd") is not None else ""
        lines.append(f"{a['id']} {fmt(a['price'], dp)} ({'+' if (a['chg'] or 0) >= 0 else ''}{_num(round(a['chg'] or 0, 2))}% hoje) · {a['bias']['text']}{pd}"
                     + ("" if a["open"] else " · MERCADO FECHADO"))
        ab = " · ".join(f"{x['label']} {fmt(x['p'], dp)} ({_dec(x['dist'])})" for x in a["above"][:3]) or "—"
        be = " · ".join(f"{x['label']} {fmt(x['p'], dp)} ({_dec(x['dist'])})" for x in a["below"][:3]) or "—"
        lines.append(f"  liquidez acima: {ab}")
        lines.append(f"  liquidez abaixo: {be}")
        if deep:
            st = {"intact": "intacto", "swept": "varrido", "taken": "rompido", "testing": "a testar"}
            lines.append("  níveis-chave: " + " · ".join(f"{k['key']} {fmt(k['p'], dp)} {st.get(k['state'], k['state'])}" for k in a["keys"]))
            if a["pois"]:
                lines.append("  zonas H1/H4: " + " · ".join(f"{p['type']} {p['tf']} {'compra' if p['dir'] == 'up' else 'venda'} {fmt(p['bot'], dp)}–{fmt(p['top'], dp)}{' (preço dentro)' if p['inside'] else ''}" for p in a["pois"][:4]))
        evs = a["events"][: 5 if deep else 2]
        for e in evs:
            lines.append(f"  [{_hm(datetime.fromtimestamp(e['t'], UTC))}] {e['text'].split(': ', 1)[-1]}")
        for s in a["setups"][: 3 if deep else 1]:
            tg = ", ".join(f"{fmt(t['p'], dp)} ({t['label']})" for t in s["targets"])
            lines.append(f"  setup {s['tf']} {'VENDA' if s['dir'] == 'sell' else 'COMPRA'} {s['grade']} ({s['score']}/100, {_status(s['status'])}): zona {fmt(s['zone'][0], dp)}–{fmt(s['zone'][1], dp)} · "
                         f"stop {fmt(s['stop'], dp)} · alvo {tg} · RR {_dec(s['rr'])}"
                         + f" · porquê: {'; '.join(s['why'])}" + (f" · notícia perto: {'; '.join(s['news_risk'])}" if s.get("news_risk") else ""))
    return "\n".join(lines)


def _status(s: str) -> str:
    return {"armed": "à espera do preço", "active": "preço na zona", "won": "alvo atingido", "stopped": "stop", "missed": "fugiu sem entrar"}.get(s, s)


# ------------------------------------------------------------------ Claude, headless
def claude_exe() -> str | None:
    """The Claude Code binary itself, not npm's .cmd (a .cmd goes through cmd.exe, which mangles a long prompt)."""
    found = shutil.which("claude")
    if not found:
        return None
    if found.lower().endswith((".cmd", ".ps1")) or not found.lower().endswith(".exe"):
        exe = Path(found).parent / "node_modules" / "@anthropic-ai" / "claude-code" / "bin" / "claude.exe"
        if exe.exists():
            return str(exe)
    return found


async def ask_claude(system: str, prompt: str, model: str, workdir: Path, timeout: float = 240) -> tuple[str, float]:
    """One answer from Claude: (text, cost in dollars). No tools, no hooks (only project settings, and the folder has
    none), nothing saved; the prompt goes in by stdin."""
    exe = claude_exe()
    if not exe:
        raise RuntimeError("Claude Code não está instalado neste PC")
    workdir.mkdir(parents=True, exist_ok=True)
    args = [exe, "-p", "--model", model, "--output-format", "json", "--setting-sources", "project", "--tools", "",
            "--no-session-persistence", "--system-prompt", system]
    flags = 0x08000000 if sys.platform == "win32" else 0   # CREATE_NO_WINDOW: the Hub runs under pythonw
    env = {k: v for k, v in os.environ.items() if k not in ("ANTHROPIC_API_KEY", "CLAUDECODE")}
    proc = await asyncio.create_subprocess_exec(*args, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
                                                stderr=asyncio.subprocess.PIPE, cwd=str(workdir), creationflags=flags, env=env)
    try:
        out, err = await asyncio.wait_for(proc.communicate(prompt.encode("utf-8")), timeout=timeout)
    except asyncio.TimeoutError:
        proc.kill()
        raise RuntimeError("o Claude demorou demasiado")
    try:
        j = json.loads(out.decode("utf-8", "replace"))
    except ValueError:
        raise RuntimeError((err or out).decode("utf-8", "replace")[-300:] or "resposta vazia do Claude")
    if j.get("is_error") or j.get("subtype") not in (None, "success"):
        raise RuntimeError(str(j.get("result") or j.get("subtype") or "erro do Claude")[:300])
    return str(j.get("result") or "").strip(), float(j.get("total_cost_usd") or 0)


def parse_verdict(text: str) -> dict | None:
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        return None
    try:
        v = json.loads(m.group(0))
    except ValueError:
        return None
    try:
        v["importancia"] = max(1, min(5, int(v.get("importancia") or 3)))
    except (TypeError, ValueError):
        v["importancia"] = 3
    v["alerta"] = bool(v.get("alerta")) and v["importancia"] >= 4
    v["foco"] = [f for f in (v.get("foco") or []) if isinstance(f, dict)][:3]
    v["atencao"] = [str(x) for x in (v.get("atencao") or [])][:4]
    for k in ("fala", "titulo", "resumo"):
        v[k] = str(v.get(k) or "").strip()
    return v


# ------------------------------------------------------------------ the meeting written from the numbers (Claude off)
def auto_meeting(room: dict, now: datetime, reason: str, focus: list[str]) -> tuple[list[str], dict]:
    inst = {a["id"]: a for a in room.get("instruments", [])}
    picks = [inst[i] for i in focus if i in inst] or sorted(inst.values(), key=lambda a: -max([e["w"] for e in a["events"]] or [0]))[:2]
    cal = [e for e in room.get("calendar", []) if e["imp"] >= 3 and e["ccy"] in ("USD", "EUR", "GBP")]
    nxt = [e for e in cal if datetime.fromisoformat(e["t"].replace("Z", "+00:00")) >= now - timedelta(minutes=10)][:2]
    ctx = {c["id"]: c for c in room.get("context", [])}
    p1 = []
    if nxt:
        e = nxt[0]
        hit = [a["id"] for a in inst.values() if e["ccy"] in a["ccy"]][:4]
        p1.append(f"{e['pt'] or e['title']} ({e['ccy']}) às {_when(e['t'], now)}" + (f": saiu {_num(e['actual'], e['unit'])} contra {_num(e['forecast'], e['unit'])} previsto." if e["actual"] is not None else f". Mexe com {', '.join(hit)}; quinze minutos antes, ninguém se expõe."))
    else:
        p1.append("Calendário limpo nas próximas horas: o preço anda sozinho, sem desculpas.")
    if "DXY" in ctx:
        d = ctx["DXY"]
        p1.append(f"O dólar está {'mais forte' if (d['chg'] or 0) > 0 else 'mais fraco'} ({fmt(d['price'], d['dp'])}, {_num(round(d['chg'] or 0, 2))}%), o que pesa {'contra' if (d['chg'] or 0) > 0 else 'a favor de'} ouro e euro.")
    heads = room.get("news", [])[:1]
    if heads:
        p1.append(f"Última manchete: «{heads[0]['title']}» ({heads[0]['source']}).")
    if picks:
        p1.append(f"Duas-Caras, o que diz o gráfico do {picks[0]['id']}?")
    p2 = []
    for a in picks[:2]:
        dp = a["dp"]
        s = a["setups"][0] if a["setups"] else None
        ab, be = (a["above"][:1] or [None])[0], (a["below"][:1] or [None])[0]
        line = f"{a['id']}: {a['bias']['text'].split(' · ')[0].lower()}."
        if a["events"]:
            ev = a['events'][0]['text'].split(': ', 1)[-1]
            line += f" {ev[:1].upper()}{ev[1:]}."
        if s:
            tg = fmt(s["targets"][0]["p"], dp) if s["targets"] else "—"
            line += (f" Há um setup {s['grade']} de {'venda' if s['dir'] == 'sell' else 'compra'} em {s['tf']}: zona {fmt(s['zone'][0], dp)}–{fmt(s['zone'][1], dp)}, "
                     f"stop {fmt(s['stop'], dp)}, alvo {tg}, RR {_dec(s['rr'])}.")
        else:
            line += " Sem setup limpo:" + (f" acima está {ab['label']} em {fmt(ab['p'], dp)}" if ab else "") + (f", abaixo {be['label']} em {fmt(be['p'], dp)}" if be else "") + "; espero que varram um dos lados e mudem de estrutura."
        p2.append(line)
    if not p2:
        p2.append("Sem dados de preço suficientes: a moeda fica no bolso.")
    top = max((e for a in picks for e in a["events"]), key=lambda e: e["w"], default=None)
    best = max((s for a in picks for s in a["setups"] if s["status"] in ("armed", "active")), key=lambda s: s["score"], default=None)
    imp = 2
    if top:
        imp = max(imp, min(5, top["w"]))
    if nxt and not nxt[0]["actual"] and (datetime.fromisoformat(nxt[0]["t"].replace("Z", "+00:00")) - now) <= timedelta(minutes=30):
        imp = max(imp, 4)
    foco = []
    for a in picks[:3]:
        s = next((x for x in a["setups"] if x["status"] in ("armed", "active")), None)
        if s:
            foco.append({"simbolo": a["id"], "direcao": "venda" if s["dir"] == "sell" else "compra", "zona": f"{fmt(s['zone'][0], a['dp'])}–{fmt(s['zone'][1], a['dp'])}",
                         "stop": fmt(s["stop"], a["dp"]), "alvos": [fmt(t["p"], a["dp"]) for t in s["targets"]],
                         "condicao": "só com o preço de volta à zona e sem notícia de alto impacto à porta", "confianca": 4 if s["grade"] in ("A+", "A") else 3})
        else:
            foco.append({"simbolo": a["id"], "direcao": "esperar", "zona": "", "stop": "", "alvos": [], "condicao": "esperar um sweep e um CHoCH", "confianca": 2})
    title = (f"{best['grade']} de {'venda' if best['dir'] == 'sell' else 'compra'} no {next(a['id'] for a in picks if best in a['setups'])}" if best and best["grade"] in ("A+", "A")
             else top["text"][:70] if top else "Mercado sem nada de especial")
    p3 = ("Concordo: " + (f"o {foco[0]['simbolo']} é o que interessa, e só com confirmação." if foco else "hoje guarda-se o dinheiro.")
          + (f" E às {_hm(datetime.fromisoformat(nxt[0]['t'].replace('Z', '+00:00')))} ninguém está exposto." if nxt and nxt[0]["actual"] is None else ""))
    news_soon = bool(nxt) and nxt[0]["actual"] is None and (datetime.fromisoformat(nxt[0]["t"].replace("Z", "+00:00")) - now) <= timedelta(minutes=30)
    verdict = {"fala": p3, "titulo": title, "resumo": " ".join(p2)[:300], "importancia": imp, "alerta": imp >= 5 or (imp >= 4 and news_soon),
               "foco": foco, "atencao": [f"{e['pt'] or e['title']} ({e['ccy']}) às {_hm(datetime.fromisoformat(e['t'].replace('Z', '+00:00')))}" for e in nxt]}
    return [" ".join(p1), " ".join(p2), p3], verdict


async def claude_meeting(room: dict, now: datetime, reason: str, focus: list[str], model: str, workdir: Path, on_turn) -> tuple[list[str], dict, float]:
    """The three turns, each one as soon as it is said (on_turn(who, text))."""
    b = brief(room, now, reason, focus)
    cost = 0.0
    t1, c = await ask_claude(PENGUIN, f"{b}\n\nAbres a reunião com o Duas-Caras. Em 4 a 6 frases: o que o calendário e as manchetes dizem "
                                      "para as próximas horas, que instrumentos isso mexe e para que lado, e a que horas ninguém deve estar "
                                      "exposto. Acaba com uma pergunta concreta ao Duas-Caras sobre o gráfico que mais te interessa.", model, workdir)
    cost += c
    await on_turn("penguin", t1)
    t2, c = await ask_claude(TWOFACE, f"{b}\n\nO Pinguim abriu a reunião assim:\n«{t1}»\n\nResponde-lhe em 5 a 8 frases. Para os 2 ou 3 "
                                      "instrumentos que mais importam agora: onde está a liquidez, o que já foi varrido, o cenário de alta e o "
                                      "de baixa com os níveis exatos do briefing, e qual preferes e porquê. Se a notícia dele chocar com o "
                                      "gráfico, diz como se gere (esperar pela notícia, só entrar depois do sweep, etc.).", model, workdir)
    cost += c
    await on_turn("twoface", t2)
    t3, c = await ask_claude(PENGUIN, f"{b}\n\nA reunião até agora:\nPinguim: «{t1}»\nDuas-Caras: «{t2}»\n\nFecha a reunião. Responde só com "
                                      f"um objeto JSON válido (sem texto à volta, sem ```), com estes campos:\n{VERDICT}", model, workdir)
    cost += c
    v = parse_verdict(t3)
    if not v:
        raise RuntimeError("a ata do Pinguim não veio em JSON")
    await on_turn("penguin", v["fala"] or v["resumo"])
    return [t1, t2, v["fala"] or v["resumo"]], v, cost
