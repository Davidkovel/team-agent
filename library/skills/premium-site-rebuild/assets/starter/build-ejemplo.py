"""Escreve o site estático da proposta Ferreras: o shell partilhado e o conteúdo de cada página.

    python -I _fonte/build.py

O site publicado é só HTML/CSS/JS; este script é a ferramenta que o escreve (não há build no servidor).
O conteúdo vem do site antigo (marketingferreras.com), reescrito em «usted» e encurtado; nada inventado.
Python 3.11: nenhuma expressão de f-string leva barra invertida nem o mesmo tipo de aspas.
"""
import html as H
import json
import re
from pathlib import Path

from PIL import Image
import sys
sys.stdout.reconfigure(encoding="utf-8")

RAIZ = Path(__file__).resolve().parents[1]
URL = "https://davidkovel.github.io/ferreras/"
EMAIL = "administracion@marketingferreras.com"
VERSAO = "1"
Q = '"'


def e(s):
    return H.escape(s, quote=True)


def se(cond, s):
    return s if cond else ""


# ---------------------------------------------------------------- logotipo (vectorizado a partir dos PNG originais)
def _paths(svg):
    return re.findall(r'<path fill="([^"]+)" fill-rule="evenodd" d="([^"]+)"/>', svg)


def _sub(d):
    return [("M" + p).strip() for p in d.split("M") if p.strip()]


def _xs(d):
    xs = [float(a) for a in re.findall(r"(-?[\d.]+) -?[\d.]+", d)]
    return min(xs), max(xs)


MARK = (RAIZ / "img/logo-mark-light.svg").read_text()
WORD = (RAIZ / "img/logo-wordmark-light.svg").read_text()
_M = {c[:2]: d for c, d in _paths(MARK)}           # '#f' marfil, '#a' piedra, '#0' señal
MARFIL = sorted(_sub(_M["#f"]), key=lambda d: _xs(d)[1] - _xs(d)[0], reverse=True)   # [barra de arriba, vertical]
WORD_D = _paths(WORD)[0][1]


def _letras():
    subs = sorted(_sub(WORD_D), key=lambda d: _xs(d)[0])
    out = []
    for d in subs:
        a, b = _xs(d)
        if out and a < out[-1][1] - 2:
            out[-1][0].append(d)
            out[-1][1] = max(out[-1][1], b)
        else:
            out.append([[d], b])
    return [" ".join(ds) for ds, _ in out]


LETRAS = _letras()


def logo_svg(pecas=False):
    """F + FERRERAS na horizontal; com pecas=True cada peça leva classe e índice para a abertura."""
    def p(cls, d, i=None, extra=""):
        k = cls + (" pz" if pecas and i is not None else "") + (" pz-senal" if pecas and extra == "senal" else "")
        st = f' style="--i:{i}"' if pecas and i is not None else ""
        return f'<path class="{k}"{st} fill-rule="evenodd" d="{d}"/>'
    partes = [p("lg-m", MARFIL[0], 0), p("lg-p", _M["#a"], 1), p("lg-m", MARFIL[1], 2), p("lg-s", _M["#0"], extra="senal")]
    letras = "".join(f'<path{se(pecas, f" class={Q}letra{Q} style={Q}--i:{i}{Q}")} fill-rule="evenodd" d="{d}"/>' for i, d in enumerate(LETRAS))
    return f'<svg viewBox="0 0 1253 256" aria-hidden="true">{"".join(partes)}<g class="lg-w" transform="translate(305 79) scale(1.0208)">{letras}</g></svg>'


def marca_paths():
    return (f'<path fill="#f3e6dc" fill-rule="evenodd" d="{_M["#f"]}"/><path fill="#a1998f" fill-rule="evenodd" d="{_M["#a"]}"/>'
            f'<path fill="#0022f1" fill-rule="evenodd" d="{_M["#0"]}"/>')


def wordmark_svg(cls="wm"):
    return f'<svg class="{cls}" viewBox="0 0 929 96" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="{WORD_D}"/></svg>'


# ---------------------------------------------------------------- o relógio (inspirado no Ferreras Almirante)
def reloj_html(R=""):
    """O relógio da página: a esfera verdadeira do Ferreras (foto endireitada, com o coração aberto recortado),
    por baixo dela o disco dia/noite que gira dentro da abertura, por cima os ponteiros em SVG."""
    oro = ('<linearGradient id="oroG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ead39f"/>'
           '<stop offset=".5" stop-color="#b8975a"/><stop offset="1" stop-color="#d9bf88"/></linearGradient>')
    estrelas = "".join(f'<circle cx="{x}" cy="{y}" r="{r}" fill="#f3e6dc" opacity="{o}"/>' for x, y, r, o in [(160, 296, 1.6, .8), (238, 284, 1.2, .6), (222, 318, 1.8, .9), (176, 330, 1.1, .5), (252, 312, 1, .5), (148, 270, 1, .4)])
    fundo = f'''<svg class="r-fundo" viewBox="0 0 400 400" aria-hidden="true"><defs>{oro}
<radialGradient id="solG"><stop offset="0" stop-color="#fff6dc"/><stop offset=".35" stop-color="#f1d79a"/><stop offset="1" stop-color="rgba(241,215,154,0)"/></radialGradient>
<linearGradient id="diaG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e9cf95"/><stop offset=".5" stop-color="#b48f4f"/></linearGradient>
<linearGradient id="nocheG" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#000814"/><stop offset=".5" stop-color="#00205a"/></linearGradient></defs>
<circle cx="200" cy="200" r="199" fill="#081322"/>
<g class="ag-d"><path d="M25 200 A175 175 0 0 1 375 200 Z" fill="url(#diaG)"/><path d="M25 200 A175 175 0 0 0 375 200 Z" fill="url(#nocheG)"/>
<circle cx="200" cy="104" r="34" fill="url(#solG)"/><circle cx="200" cy="104" r="13" fill="#fff4d8"/>
{estrelas}<rect x="193" y="289" width="14" height="14" fill="#0022f1"/><rect x="189" y="285" width="22" height="22" fill="rgba(0,34,241,.25)"/></g>
<circle cx="200" cy="200" r="197.5" fill="none" stroke="url(#oroG)" stroke-width="3"/>
<circle cx="200" cy="200" r="193" fill="none" stroke="#0b1622" stroke-width="5"/></svg>'''
    esfera = f'<img class="r-esfera" src="{R}img/dial-ferreras.webp" width="832" height="832" alt="" decoding="async">'
    agujas = f'''<svg class="r-agujas" viewBox="0 0 400 400" aria-hidden="true"><defs>{oro.replace('oroG', 'oroH')}
<filter id="sombraA" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="1.5" dy="2.5" stdDeviation="1.6" flood-color="#2a1d08" flood-opacity=".45"/></filter></defs>
<g filter="url(#sombraA)">
<g class="ag ag-h"><polygon points="200,98 207,200 200,216 193,200" fill="url(#oroH)" stroke="#6b5222" stroke-width=".7"/><polygon points="200,98 200,216 193,200" fill="rgba(110,80,30,.45)"/></g>
<g class="ag ag-m"><polygon points="200,40 205,200 200,219 195,200" fill="url(#oroH)" stroke="#6b5222" stroke-width=".7"/><polygon points="200,40 200,219 195,200" fill="rgba(110,80,30,.45)"/></g>
<g class="ag ag-s"><line x1="200" y1="244" x2="200" y2="54" stroke="#001a39" stroke-width="1.6"/><circle cx="200" cy="230" r="5.5" fill="none" stroke="#001a39" stroke-width="1.6"/><rect x="195" y="44" width="10" height="10" fill="#0022f1"/></g>
<circle cx="200" cy="200" r="8.5" fill="url(#oroH)" stroke="#6b5222" stroke-width=".6"/><circle cx="200" cy="200" r="2.6" fill="#001a39"/></g></svg>'''
    return f'<div class="reloj">{fundo}{esfera}{agujas}<div class="brillo"></div></div>'


def _reloj_antigo():
    t = []
    for i in range(60):
        lg = i % 5 == 0
        t.append(f'<line x1="200" y1="{19 if lg else 20}" x2="200" y2="{27 if lg else 24}" transform="rotate({i * 6} 200 200)" stroke="rgba(243,230,220,{0.6 if lg else 0.32})" stroke-width="{1.4 if lg else 1}"/>')
    b = ['<rect x="191.5" y="34" width="6" height="30" rx="1.4" fill="url(#oroG)"/><rect x="202.5" y="34" width="6" height="30" rx="1.4" fill="url(#oroG)"/>']
    for h in range(1, 12):
        w = 7 if h % 3 == 0 else 5.5
        b.append(f'<rect x="{200 - w / 2}" y="36" width="{w}" height="{28 if h % 3 == 0 else 24}" rx="1.4" fill="url(#oroG)" transform="rotate({h * 30} 200 200)"/>')
    svg = f'''<svg viewBox="0 0 400 400" aria-hidden="true"><defs>
<linearGradient id="oroG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ead39f"/><stop offset=".5" stop-color="#b8975a"/><stop offset="1" stop-color="#d9bf88"/></linearGradient>
<radialGradient id="esfG" cx=".5" cy=".42" r=".62"><stop offset="0" stop-color="#0c2d5a"/><stop offset=".55" stop-color="#05203f"/><stop offset="1" stop-color="#010d1d"/></radialGradient>
<linearGradient id="discoG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e2c690"/><stop offset=".5" stop-color="#b8975a"/><stop offset=".5" stop-color="#001a39"/><stop offset="1" stop-color="#000814"/></linearGradient>
<clipPath id="janelaC"><rect x="168" y="250" width="64" height="30" rx="15"/></clipPath></defs>
<circle cx="200" cy="200" r="198" fill="#0a1626"/><circle cx="200" cy="200" r="197" fill="none" stroke="url(#oroG)" stroke-width="2.4"/>
<circle cx="200" cy="200" r="190" fill="url(#esfG)"/><circle cx="200" cy="200" r="190" fill="none" stroke="rgba(0,0,0,.55)" stroke-width="3"/>
<circle cx="200" cy="200" r="186.5" fill="none" stroke="rgba(243,230,220,.14)" stroke-width=".8"/>
<g clip-path="url(#janelaC)"><rect x="160" y="246" width="80" height="38" fill="#000814"/><g class="ag-d"><circle cx="200" cy="300" r="46" fill="url(#discoG)"/><circle cx="200" cy="268" r="9" fill="rgba(255,243,214,.25)"/><circle cx="200" cy="268" r="5.5" fill="#fff3d6"/><rect x="195.5" y="327.5" width="9" height="9" fill="#0022f1"/></g></g>
<rect x="168" y="250" width="64" height="30" rx="15" fill="none" stroke="url(#oroG)" stroke-width="1.6"/>
<text x="200" y="300" text-anchor="middle" font-family="Geist,system-ui,sans-serif" font-size="8" letter-spacing="3.4" fill="rgba(243,230,220,.55)">BARCELONA</text>
<text x="200" y="313" text-anchor="middle" font-family="Geist,system-ui,sans-serif" font-size="6" letter-spacing="2.6" fill="rgba(243,230,220,.35)">MARKETING · IA</text>
<g transform="translate(189.5 74) scale(.09)">{marca_paths()}</g>
<g transform="translate(163 106) scale(.08)"><path fill="rgba(243,230,220,.85)" fill-rule="evenodd" d="{WORD_D}"/></g>
{"".join(t)}{"".join(b)}
<g class="ag ag-h"><polygon points="200,96 206.5,200 200,214 193.5,200" fill="url(#oroG)"/><polygon points="200,96 200,214 193.5,200" fill="rgba(120,90,40,.55)"/></g>
<g class="ag ag-m"><polygon points="200,36 204.8,200 200,217 195.2,200" fill="url(#oroG)"/><polygon points="200,36 200,217 195.2,200" fill="rgba(120,90,40,.55)"/></g>
<g class="ag ag-s"><line x1="200" y1="240" x2="200" y2="52" stroke="#f3e6dc" stroke-width="1.3"/><circle cx="200" cy="228" r="5.2" fill="none" stroke="#f3e6dc" stroke-width="1.3"/><rect x="195.5" y="44" width="9" height="9" fill="#0022f1"/></g>
<circle cx="200" cy="200" r="8" fill="url(#oroG)"/><circle cx="200" cy="200" r="2.6" fill="#00101f"/></svg>'''
    return f'<div class="reloj"><div class="guilloche"></div>{svg}<div class="brillo"></div></div>'


def mini_reloj():
    return ('<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="19" fill="#05203f" stroke="#c2a263" stroke-width="1.2"/>'
            '<line x1="20" y1="20" x2="20" y2="9" stroke="#d6bc86" stroke-width="2" stroke-linecap="round"/><line x1="20" y1="20" x2="27" y2="24" stroke="#d6bc86" stroke-width="2" stroke-linecap="round"/>'
            '<rect x="18.5" y="4.5" width="3" height="3" fill="#0022f1"/></svg>')


# ---------------------------------------------------------------- imagens
def _dim(base, w):
    p = RAIZ / "img" / f"{base}-{w}.webp"
    return Image.open(p).size if p.exists() else None


def img(R, base, alt, sizes="100vw", lazy=True, extra=""):
    d9, d16 = _dim(base, 900), _dim(base, 1600)
    src = [f"{R}img/{base}-900.webp {d9[0]}w"] + ([f"{R}img/{base}-1600.webp {d16[0]}w"] if d16 else [])
    w, h = d16 or d9
    carga = ' loading="lazy" decoding="async"' if lazy else ' fetchpriority="high"'
    return f'<img src="{R}img/{base}-{1600 if d16 else 900}.webp" srcset="{", ".join(src)}" sizes="{sizes}" width="{w}" height="{h}" alt="{e(alt)}"{carga}{extra}>'


# ---------------------------------------------------------------- shell
NAV = [("quien-somos/", "Quién somos"), ("marketing/", "Marketing"), ("inteligencia-artificial/", "IA"), ("sectores/", "Sectores"), ("resultados/", "Resultados")]
SECT = [("sectores/hoteles/", "Hoteles"), ("sectores/automocion-lujo/", "Automoción de lujo"), ("sectores/nautica/", "Náutica, yates y puertos"), ("sectores/joyeria-relojeria/", "Joyería y relojería")]


def head(R, titulo, desc, rota):
    t = titulo if "Ferreras" in titulo else f"{titulo} · IA & Marketing Ferreras"
    org = {"@context": "https://schema.org", "@type": "Organization", "name": "IA & Marketing Ferreras", "legalName": "FERRERAS LUXURY GROUP, S.L.",
           "url": URL, "email": EMAIL, "taxID": "B25958869",
           "address": {"@type": "PostalAddress", "streetAddress": "Passeig de Gràcia 95, 5º 1ª", "postalCode": "08008", "addressLocality": "Barcelona", "addressCountry": "ES"},
           "sameAs": ["https://relojes-ferreras.com/"]}
    return f'''<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{e(t)}</title>
<meta name="description" content="{e(desc)}">
<meta name="robots" content="noindex, nofollow">
<link rel="canonical" href="{URL}{rota}">
<meta name="theme-color" content="#00101f">
<meta property="og:type" content="website">
<meta property="og:site_name" content="IA &amp; Marketing Ferreras">
<meta property="og:locale" content="es_ES">
<meta property="og:title" content="{e(t)}">
<meta property="og:description" content="{e(desc)}">
<meta property="og:url" content="{URL}{rota}">
<meta property="og:image" content="{URL}og/inicio.jpg">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta property="og:image:alt" content="El reloj Ferreras sobre azul noche junto al logotipo y la frase Su departamento de marketing e IA. Todo incluido.">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="{URL}og/inicio.jpg">
<link rel="icon" href="{R}favicon.svg" type="image/svg+xml">
<link rel="preload" href="{R}fonts/newsreader-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="{R}fonts/geist-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="{R}estilo.css?v={VERSAO}">
<script>document.documentElement.classList.add('js');try{{if(sessionStorage.getItem('ferreras.abertura')==='1'||matchMedia('(prefers-reduced-motion: reduce)').matches)document.documentElement.classList.add('sem-abertura')}}catch(e){{}}</script>
<script type="application/ld+json">{json.dumps(org, ensure_ascii=False)}</script>
</head>
'''


def cabecera(R, atual):
    nav = "".join(f'<a href="{R}{h}"{se(atual.startswith(h), " aria-current=" + Q + "page" + Q)}>{e(t)}</a>' for h, t in NAV)
    itens = NAV + [("contacto/", "Contacto")]
    menu = "".join(f'<li style="--i:{i}"><a href="{R}{h}"><small>0{i + 1}</small>{e(t)}</a></li>' for i, (h, t) in enumerate(itens))
    sub = "".join(f'<a href="{R}{h}">{e(t)}</a>' for h, t in SECT)
    inicio = R or "./"
    return f'''<a class="saltar" href="#contenido">Saltar al contenido</a>
<div class="cielo" aria-hidden="true"><div class="cielo-dia"></div><div class="cielo-noche"></div></div>
<header class="topo" data-topo>
  <nav class="topo-lado" aria-label="Principal">{nav}</nav>
  <a class="topo-marca" href="{inicio}" data-logo-alvo aria-label="IA &amp; Marketing Ferreras, inicio">{logo_svg()}</a>
  <div class="topo-dir"><a class="btn btn-claro" href="{R}diagnostico/">Pide su diagnóstico <span class="fl">→</span></a><button class="menu-botao" type="button" data-menu-botao aria-expanded="false" aria-controls="menu"><span>Menú</span><i></i></button></div>
</header>
<div class="menu" id="menu" data-menu hidden>
  <nav aria-label="Menú"><ul class="menu-lista">{menu}</ul><div class="menu-sub">{sub}</div></nav>
  <div class="menu-pe"><a class="btn btn-claro" href="{R}diagnostico/">Pide su diagnóstico <span class="fl">→</span></a><p class="mini">{EMAIL}</p></div>
</div>
'''


def rodape(R):
    sis = [("marketing/", "Departamento de Marketing"), ("inteligencia-artificial/", "Departamento de IA"), ("web/", "Web y ecommerce"), ("ia-hoteles/", "IA para hoteles")]
    fir = [("resultados/", "Resultados"), ("casos/", "Casos"), ("quien-somos/", "Quién somos"), ("contacto/", "Contacto"), ("diagnostico/", "Diagnóstico")]

    def col(t, lista):
        li = "".join(f'<li><a href="{R}{h}">{e(x)}</a></li>' for h, x in lista)
        return f"<div><h3>{t}</h3><ul>{li}</ul></div>"
    return f'''<footer class="rodape" data-rodape>
  <div class="rodape-marca">{wordmark_svg()}<p class="rodape-lema">La innovación es lo que distingue a un líder de los demás.</p></div>
  <div class="rodape-cols">
    <div><h3>IA &amp; Marketing Ferreras</h3><address>Passeig de Gràcia 95, 5º 1ª<br>08008 Barcelona<br><a href="mailto:{EMAIL}">{EMAIL}</a></address></div>
    {col("Sistema", sis)}{col("Firma", fir)}{col("Sectores", SECT)}
  </div>
  <div class="rodape-legal"><p>© 2026 IA &amp; Marketing Ferreras · FERRERAS LUXURY GROUP, S.L. · NIF B25958869</p><nav aria-label="Legal"><a href="{R}legal/aviso-legal/">Aviso legal</a><a href="{R}legal/privacidad/">Privacidad</a><a href="{R}legal/cookies/">Cookies</a></nav><p class="concepto">Propuesta de rediseño · concepto</p></div>
</footer>
<div class="barra-dx" data-barra><a class="btn btn-claro" href="{R}diagnostico/">Diagnóstico <span class="fl">→</span></a></div>
<aside class="hud" data-hud aria-hidden="true">
  <div class="hud-dock" data-hud-dock><svg class="hud-anillo" data-hud-anillo viewBox="0 0 100 100"><circle cx="50" cy="50" r="48" stroke="rgba(243,230,220,.14)"/><circle class="v" cx="50" cy="50" r="48" stroke="var(--acento)" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1" transform="rotate(-90 50 50)"/></svg></div>
  <div class="hud-txt"><b class="hud-hora" data-hud-hora>07:30<small>MKT</small></b><div class="hud-mom" data-hud-mom></div></div>
</aside>
<div class="reloj-voo" data-reloj-voo aria-hidden="true">{reloj_html(R)}</div>
'''


SCRIPTS = ["00-nucleo", "10-abertura", "20-comuns", "30-reloj", "40-escenas", "70-paginas", "80-ai-demo"]
FEITAS = []


def pagina(rota, titulo, desc, corpo, inicio=False):
    R = "../" * rota.count("/")
    ab = f'<div class="abertura" data-abertura aria-hidden="true"><div class="caja">{logo_svg(pecas=True)}</div></div>' if inicio else ""
    s = "".join(f'<script src="{R}js/{n}.js?v={VERSAO}"></script>' for n in SCRIPTS)
    cls = ' class="a-abrir"' if inicio else ' class="interior"'
    doc = head(R, titulo, desc, rota) + f"<body{cls}>\n{ab}{cabecera(R, rota)}<main id=\"contenido\">\n{corpo(R)}\n</main>\n{rodape(R)}{s}\n</body>\n</html>\n"
    if rota == "diagnostico/":
        doc = doc.replace('<div class="barra-dx" data-barra>', '<div class="barra-dx" data-barra hidden>')
    destino = RAIZ / rota / "index.html"
    destino.parent.mkdir(parents=True, exist_ok=True)
    destino.write_text(doc, encoding="utf-8")
    FEITAS.append(rota)


# ---------------------------------------------------------------- componentes
def etq(a, txt, cls="hora"):
    return f'<p class="etiqueta"><span class="{cls}">{a}</span>{txt}</p>'


def L(*ls):
    return "".join(f'<span class="l" style="--i:{i}"><span>{x}</span></span>' for i, x in enumerate(ls))


def btn(href, txt, cls="btn-claro", seta=True, extra=""):
    return f'<a class="btn {cls}" href="{href}"{extra}>{txt}{se(seta, " <span class=" + Q + "fl" + Q + ">→</span>")}</a>'


def faq(items, pref):
    out = []
    for i, (q, a) in enumerate(items):
        out.append(f'<div class="faq-item"><h3><button class="faq-q" type="button" id="{pref}-q{i}" aria-expanded="false" aria-controls="{pref}-a{i}">{e(q)}<i aria-hidden="true"></i></button></h3>'
                   f'<div class="faq-a" id="{pref}-a{i}" role="region" aria-labelledby="{pref}-q{i}" aria-hidden="true"><div><p>{e(a)}</p></div></div></div>')
    return f'<div class="faq" data-faq>{"".join(out)}</div>'


def cards(items, cols=2, num=True):
    out = []
    for i, (t, p) in enumerate(items):
        n = f'<span class="num">0{i + 1}</span>' if num else ""
        out.append(f'<div class="card" data-sube style="--i:{i % cols}">{n}<h3>{e(t)}</h3><p>{e(p)}</p></div>')
    return f'<div class="cards" style="--cols:{cols}">{"".join(out)}</div>'


def cab(num, eti, titulo, lead="", h="h2"):
    ld = f'<p class="lead" data-sube>{lead}</p>' if lead else ""
    return f'<div class="cab">{etq(num, eti, "n")}<{h} class="titulo t-l" data-linhas>{titulo}</{h}>{ld}</div>'


def sec(c, cls="", extra=""):
    return f'<section class="sec {cls}"{extra}>{c}</section>'


def banda(titulo, txt, botoes):
    return sec(f'<div class="banda"><div class="cab" style="margin:0"><h2 class="titulo t-l" data-linhas>{titulo}</h2><p class="lead" data-sube>{txt}</p></div><div class="acoes">{botoes}</div></div>')


def tabs(pref, items):
    lista, pan = [], []
    for i, (t, c, ent) in enumerate(items):
        on = i == 0
        lista.append(f'<button role="tab" type="button" id="{pref}-t{i}" aria-controls="{pref}-p{i}" aria-selected="{str(on).lower()}" tabindex="{0 if on else -1}">{e(t)}</button>')
        li = "".join(f"<li>{e(x)}</li>" for x in ent)
        pan.append(f'<div class="tab-painel" role="tabpanel" id="{pref}-p{i}" aria-labelledby="{pref}-t{i}" tabindex="0"{se(not on, " hidden")}><h3>{e(t)}</h3><p class="texto">{e(c)}</p><p class="etiqueta">Qué recibe</p><ul>{li}</ul></div>')
    return f'<div class="tabs" data-tabs><div class="tabs-lista" role="tablist" aria-label="Qué incluye">{"".join(lista)}</div><div>{"".join(pan)}</div></div>'


def passos(items):
    out = "".join(f'<div class="passo" data-sube style="--i:{i}"><span class="num">0{i + 1}</span><h3>{e(a)}</h3><p>{e(b)}</p></div>' for i, (a, b) in enumerate(items))
    return f'<div class="passos" style="--cols:{len(items)}">{out}</div>'


def chips(items):
    return '<ul class="chips">' + "".join(f"<li>{e(x)}</li>" for x in items) + "</ul>"


def ph(R, eti, h1, lead, botoes="", foto=None, chips_=None, migas=None):
    m = ""
    if migas:
        partes = [f'<a href="{R}{h}">{e(t)}</a>' if h is not None else e(t) for h, t in migas]
        m = '<p class="migas">' + ' <span aria-hidden="true">/</span> '.join(partes) + "</p>"
    ch = '<ul class="ph-chips">' + "".join(f"<li>{e(c)}</li>" for c in chips_) + "</ul>" if chips_ else ""
    f = f'<figure class="ph-foto ventana" data-janela>{foto}</figure>' if foto else ""
    ac = f'<div class="acoes" data-sube>{botoes}</div>' if botoes else ""
    et = etq("", eti, "n") if eti else ""
    cls = "pag-hero com-foto" if foto else "pag-hero"
    return f'<section class="{cls}"><div class="ph-txt">{m}{et}<h1 class="titulo t-xl" data-linhas>{h1}</h1><p class="lead" data-sube>{lead}</p>{ac}{ch}</div>{f}</section>'


CONDICIONES = [("Alcance cerrado por escrito", "Antes de empezar a producir, y lo que queda fuera se dice entonces."),
               ("Sin permanencia obligatoria", "Recomendamos continuidad porque la autoridad se construye, no porque le atemos."),
               ("La propiedad es suya", "El proyecto, el dominio y todos los accesos quedan a su nombre desde el primer día."),
               ("Trato uno a uno", "Trabajamos con pocas empresas. Habla siempre con quien dirige su proyecto.")]

exec((Path(__file__).parent / "paginas.py").read_text(encoding="utf-8"))
