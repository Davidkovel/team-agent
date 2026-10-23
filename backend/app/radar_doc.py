"""Radar: o diagnóstico de um negócio em PDF (2 páginas A4), para mandar por WhatsApp ou email com a primeira mensagem.

Regras do Fábio e da skill dossie-crescimento: tratar por «você», sem travessões a meio da frase, só o que se viu no site
público nesse dia (com a data), começar pelo que já está bem e acabar com «Como chegámos a estes números». O gasto
estimado fica de fora: é para nós, não para o cliente. Sem nome da empresa enquanto não houver um."""
from __future__ import annotations

import html
import subprocess
import sys
import time
from pathlib import Path

from .etsy import chrome
from .radar import DIR

e = html.escape


def _page(scan: dict, n: dict) -> str:
    a = n.get("audit") or {}
    negs = scan["negocios"]
    com = [x for x in negs if x.get("site") and not (x.get("audit") or {}).get("erro")]
    melhores = sum(x["nota_site"] > n["nota_site"] for x in com if x is not n)
    data = time.strftime("%d/%m/%Y", time.localtime(scan.get("fim") or scan["at"]))
    zona = scan["local"] or n.get("morada", "")
    probs = n.get("problemas") or []
    if not n.get("site"):
        num1 = ("Sem site", "quem procura no Google não o encontra")
        num3 = (f"{len(com)} de {len(negs)}", f"concorrentes {('em ' + zona) if zona and scan.get('raio') else 'da zona'} já têm site")
    else:
        num1 = (f"{n['nota_site']}/100", "nota do site, de 0 a 100")
        num3 = (f"{melhores} de {len(com)}", "sites da zona com nota melhor do que o seu")
    num2 = (str(len(probs)), "coisa a melhorar" if len(probs) == 1 else "coisas a melhorar, por ordem de impacto")
    if not n.get("site"):
        num2 = ("7 dias", "para ter o site no ar, com inscrição e WhatsApp")
    one = not n.get("site")  # sem site cabe tudo numa página, com o que o site vai ter
    tem = "" if not one else ('<h2>O que o seu site vai ter</h2><div class="steps tem">' + "".join(
        f"<div><b>{t}</b>{d}</div>" for t, d in (
            ("Feito para telemóvel", "Abre rápido no telemóvel, onde estão 8 em cada 10 visitas."),
            ("WhatsApp e chamada", "Um toque para falar consigo, em todas as páginas."),
            ("Inscrição online", "Um formulário curto que chega ao seu telemóvel."),
            ("No Google e no mapa", "Título, descrição e ficha afinados para a sua zona."),
            ("Preços e opiniões", "O que custa e o que dizem de si, à vista."),
            ("Ligado às redes", "O Facebook e o Instagram ligados ao site."))) + "</div>")
    bons = n.get("bons") or []
    if n.get("site") and not a.get("erro"):
        if a.get("telefone_link"):
            bons.append("O telefone no site liga com um toque.")
        if a.get("instagram") or a.get("facebook"):
            bons.append("O site já liga às redes sociais.")
    if n.get("facebook") and not n.get("site"):
        bons.append("Já tem página de Facebook: há clientes que o seguem.")
    if n.get("nota") and n.get("opinioes"):
        bons.append(f"Tem {n['nota']} estrelas no Google com {n['opinioes']} opiniões: a reputação está feita.")
    bons = bons or ["O negócio já existe no mapa e tem contacto público: o mais difícil está feito."]
    row = lambda i, p: f"<tr><td class='i'>{i}</td><td>{e(p['problema'])}</td><td class='s'>{e(p['solucao'])}</td></tr>"
    rows = "".join(row(i, p) for i, p in enumerate(probs[:6], 1))
    more = "".join(row(i, p) for i, p in enumerate(probs[6:], 7))
    medido, plat = "", a.get("plataforma") or ""
    quem, gente = ("escolas", "alunos") if scan["ramo"] == "escolas" else ("negócios", "clientes")
    if a.get("segundos") is not None:
        medido = (f"O site ({e((a.get('final') or n['site']).split('//')[-1].rstrip('/'))}) abriu em {a['segundos']} s no dia {data}"
                  f"{', sem cadeado' if not a.get('https') else ''}{(', feito em ' + e(plat)) if plat else ''}.")
    return f"""<!doctype html><html lang="pt-PT"><head><meta charset="utf-8"><title>Diagnóstico · {e(n['nome'])}</title>
<style>
@page {{ size: A4; margin: 0; }}
* {{ box-sizing: border-box; }}
body {{ margin: 0; font: 11pt/1.5 "Segoe UI", Inter, Arial, sans-serif; color: #17181a; background: #fff; }}
.pg {{ width: 210mm; min-height: 297mm; padding: 18mm 18mm 16mm; page-break-after: always; position: relative; }}
.pg:last-child {{ page-break-after: auto; }}
.eb {{ font-size: 8pt; letter-spacing: .22em; text-transform: uppercase; color: #8a8d93; }}
h1 {{ font: 400 30pt/1.1 Georgia, "Times New Roman", serif; margin: 6mm 0 2mm; }}
h2 {{ font: 400 16pt/1.2 Georgia, serif; margin: 10mm 0 4mm; }}
.sub {{ color: #55585e; margin: 0; }}
.nums {{ display: grid; grid-template-columns: repeat(3, 1fr); gap: 5mm; margin: 12mm 0 4mm; }}
.n {{ border-top: 2px solid #17181a; padding-top: 3mm; }}
.n b {{ display: block; font: 400 24pt/1.1 Georgia, serif; }}
.n span {{ color: #55585e; font-size: 9pt; }}
.ok {{ background: #f3f6f2; border-left: 3px solid #4f8a5b; padding: 4mm 5mm; margin-top: 8mm; }}
.ok ul {{ margin: 2mm 0 0; padding-left: 5mm; }}
table {{ width: 100%; border-collapse: collapse; font-size: 10pt; }}
th {{ text-align: left; font-size: 8pt; letter-spacing: .14em; text-transform: uppercase; color: #8a8d93; font-weight: 600; padding: 0 3mm 2mm 0; }}
td {{ vertical-align: top; padding: 2.6mm 3mm 2.6mm 0; border-top: 1px solid #e3e4e6; }}
td.i {{ color: #8a8d93; width: 7mm; }}
td.s {{ color: #2f6b3c; width: 44%; }}
.steps {{ display: grid; grid-template-columns: repeat(3, 1fr); gap: 5mm; margin-top: 4mm; }}
.steps div {{ border: 1px solid #e3e4e6; padding: 4mm; }}
.tem {{ margin-bottom: 2mm; }} .tem div {{ font-size: 9.5pt; color: #55585e; }}
.steps b {{ display: block; font: 400 13pt Georgia, serif; margin-bottom: 1mm; }}
.met {{ position: absolute; left: 18mm; right: 18mm; bottom: 14mm; font-size: 8pt; color: #8a8d93; border-top: 1px solid #e3e4e6; padding-top: 3mm; }}
.one {{ font-size: 10.2pt; }} .one .pg {{ padding-top: 13mm; min-height: 0; }} .one h1 {{ margin-top: 3mm; font-size: 26pt; }} .one .tem div {{ padding: 2.5mm 3mm; }} .one .nums {{ margin: 7mm 0 2mm; }} .one .ok {{ margin-top: 5mm; }}
.one h2 {{ margin: 6mm 0 3mm; }} .one .steps div {{ padding: 3mm; }} .one .met {{ position: static; margin-top: 5mm; }}
</style></head><body class="{'one' if one else ''}">
<section class="pg">
  <div class="eb">Diagnóstico digital · {e(zona)} · {data}</div>
  <h1>{e(n['nome'])}</h1>
  <p class="sub">O que vimos na sua presença online, o que já está bem e o que faríamos primeiro para trazer mais {gente}.</p>
  <div class="nums">
    <div class="n"><b>{e(num1[0])}</b><span>{e(num1[1])}</span></div>
    <div class="n"><b>{e(num2[0])}</b><span>{e(num2[1])}</span></div>
    <div class="n"><b>{e(num3[0])}</b><span>{e(num3[1])}</span></div>
  </div>
  <div class="ok"><b>O que já está bem</b><ul>{''.join(f'<li>{e(b)}</li>' for b in dict.fromkeys(bons))}</ul></div>
  <h2>O que encontrámos e como resolvemos</h2>
  <table><tr><th></th><th>O que vimos</th><th>O que fazemos</th></tr>{rows}</table>
{'' if one else '</section><section class="pg">'}
  {tem}
  {f'<div class="eb">Também vimos</div><table style="margin:5mm 0 2mm">{more}</table>' if more else ''}
  <h2 style="margin-top:{'8' if more or one else '0'}mm">Como avançamos</h2>
  <div class="steps">
    <div><b>1. Conversa de 15 minutos</b>Mostramos-lhe como ficaria, com o seu nome e as suas fotos. Sem compromisso.</div>
    <div><b>2. Pronto em poucos dias</b>Tratamos de tudo: site, ficha do Google, botões de contacto e inscrição.</div>
    <div><b>3. Acompanhamento</b>Todos os meses dizemos-lhe quantas pessoas o encontraram e quantas pediram contacto.</div>
  </div>
  <div class="met"><b>Como chegámos a estes números.</b> Tudo o que está neste documento foi visto no site público e no mapa no dia {data},
  sem acesso a nada interno. {medido} A nota do site soma pontos por cada coisa que funciona (telemóvel, cadeado, velocidade,
  contacto direto, inscrição, Google, opiniões, preços, redes, medição). A comparação usa {len(negs)} {quem} que encontrámos
  {('num raio de ' + str(scan['raio']) + ' km' + ((' de ' + e(scan['local'])) if scan['local'] else '')) if scan.get('raio') else ('no distrito de ' + e(scan.get('distrito') or scan['local']))}.</div>
</section>
</body></html>"""


def pdf(scan: dict, nid: str) -> Path:
    n = next((x for x in scan["negocios"] if x["id"] == nid), None)
    if not n:
        raise ValueError("negócio desconhecido")
    out = DIR / "pdf" / f"{scan['id']}-{nid}.pdf"
    if out.exists():
        return out
    exe = chrome()
    if not exe:
        raise RuntimeError("falta o Google Chrome para fazer o PDF")
    out.parent.mkdir(parents=True, exist_ok=True)
    page = out.with_suffix(".html")
    page.write_text(_page(scan, n), "utf-8")
    flags = 0x08000000 if sys.platform == "win32" else 0
    subprocess.run([exe, "--headless=new", "--disable-gpu", "--no-pdf-header-footer", f"--print-to-pdf={out}", page.as_uri()],
                   capture_output=True, timeout=120, creationflags=flags)
    page.unlink(missing_ok=True)
    if not out.exists():
        raise RuntimeError("o Chrome não fez o PDF")
    return out
