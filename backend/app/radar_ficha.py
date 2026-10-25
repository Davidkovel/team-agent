"""Radar: a ficha completa de um negócio, feita quando se abre (25 out, pedido do David: «ver o branding todo dessa empresa,
as redes sociais, a página do Google, quanto gastaram a fazer o site e o que podíamos mais fazer para ganhar dinheiro»).

O que faz: volta a abrir o site e tira a marca (logótipo, cores, letras, frase), procura as redes que o site não liga
(Instagram, Facebook, TikTok, YouTube, LinkedIn) e os seguidores que a pesquisa mostra, a ficha do Google (estrelas,
opiniões, horário; precisa da GOOGLE_PLACES_KEY), estima quanto custou o site e quanto já lá meteram, e junta o que lhes
podemos vender, com preço. No fim a IA (Claude) lê tudo e propõe as ideias e a primeira frase da conversa.

Regras: só o que se vê em público nesse dia; o custo é uma estimativa a preços de mercado, nunca a fatura; os seguidores são
os que a pesquisa mostra, com «cerca de». Fica em ~/.team-agent/radar/fichas/ deste PC."""
from __future__ import annotations

import asyncio
import base64
import colorsys
import html
import json
import os
import re
import time
import urllib.parse
from collections import Counter
from pathlib import Path

import httpx

from .radar import DIR, GENERIC, RAMOS, UA, _norm

FX = DIR / "fichas"
UA_PC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"

# o que vendemos, a preço de partida (o pacote e o acompanhamento são os da skill site-empresa-local; o resto ajusta-se aqui)
PRECOS = {
    "site": ("Site novo, feito para telemóvel", 390, 0),
    "acompanhamento": ("Acompanhamento mensal (alterações, SEO, relatório)", 0, 149),
    "google": ("Ficha Google afinada e SEO local", 120, 0),
    "opinioes": ("Pedido de opiniões automático no WhatsApp", 0, 29),
    "redes": ("Gestão de Instagram e TikTok (Reels e carrosséis)", 0, 249),
    "anuncios": ("Anúncios geridos no Meta e no Google", 0, 150),
    "ia": ("Assistente com IA no WhatsApp e no site (responde 24 h, marca e inscreve)", 190, 39),
    "inscricao": ("Inscrição e marcação online ligada ao telemóvel", 150, 0),
    "marca": ("Logótipo e identidade visual renovados", 250, 0),
}

REDES = {  # rede -> (nome, padrão do perfil num link)
    "instagram": ("Instagram", r"instagram\.com/(?!p/|reel|explore|accounts|stories|tv/|about|legal|developer)([A-Za-z0-9_.]{2,30})"),
    "facebook": ("Facebook", r"facebook\.com/(?!tr\b|tr\?|sharer|plugins|dialog|share|login|groups/?[\"'?]|policies|help|privacy|events/?[\"'?])"
                             r"((?:profile\.php\?id=\d+)|(?:pages/[^\"'?#\s]+)|[A-Za-z0-9_.\-]{3,80})"),
    "tiktok": ("TikTok", r"tiktok\.com/@([A-Za-z0-9_.]{2,30})"),
    "youtube": ("YouTube", r"youtube\.com/((?:@|channel/|c/|user/)[A-Za-z0-9_.\-]{2,60})"),
    "linkedin": ("LinkedIn", r"linkedin\.com/(company/[A-Za-z0-9_\-%.]{2,80})"),
}
BASE_URL = {"instagram": "https://www.instagram.com/{}/", "facebook": "https://www.facebook.com/{}", "tiktok": "https://www.tiktok.com/@{}",
            "youtube": "https://www.youtube.com/{}", "linkedin": "https://www.linkedin.com/{}/"}

# cores que o WordPress mete em todas as páginas (a paleta do editor), e as das ferramentas de cookies: não são a marca
WP_PRESET = {"#cf2e2e", "#ff6900", "#fcb900", "#7bdcb5", "#00d084", "#8ed1fc", "#0693e3", "#abb8c3", "#9b51e0", "#f78da7", "#eeeeee",
             "#313131", "#32373c", "#0073aa", "#00a0d2", "#2271b1", "#135e96", "#d63638", "#00a32a", "#dba617", "#3858e9", "#1e1e1e",
             "#007cba", "#006ba1", "#4ab866", "#f0b849", "#cc1818", "#757575", "#ddd", "#dddddd", "#0000ee", "#551a8b", "#561a8b", "#0000ff", "#800080"}
GENERIC_FONTS = {"sans-serif", "serif", "monospace", "inherit", "initial", "arial", "helvetica", "helvetica neue", "system-ui", "-apple-system",
                 "blinkmacsystemfont", "segoe ui", "roboto", "times new roman", "times", "georgia", "verdana", "tahoma", "cursive", "fantasy",
                 "dashicons", "fontawesome", "font awesome 5 free", "font awesome 5 brands", "font awesome 6 free", "eicons", "star", "wix",
                 "apple color emoji", "segoe ui emoji", "noto color emoji", "unset", "var", "icomoon", "swiper-icons", "revicons", "ui-sans-serif"}


def _key(sid: str, nid: str) -> Path:
    if not re.fullmatch(r"[a-f0-9]{12}", sid or "") or not re.fullmatch(r"[a-f0-9]{8}", nid or ""):
        raise ValueError("negócio desconhecido")
    return FX / f"{sid}-{nid}.json"


def _text(s: str) -> str:
    return html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s or ""))).strip()


def _num(s: str) -> int | None:
    """«1,2 mil», «3.456», «12K» -> número."""
    m = re.match(r"([\d.,]+)\s*(mil|k|m\b|mi)?", (s or "").strip(), re.I)
    if not m:
        return None
    raw, mult = m.group(1), (m.group(2) or "").lower()
    if mult:
        v = float(raw.replace(".", "").replace(",", ".")) if raw.count(",") == 1 or "." not in raw else float(raw.replace(",", ""))
        return int(v * (1_000_000 if mult in ("m", "mi") else 1000))
    digits = re.sub(r"\D", "", raw)
    return int(digits) if digits else None


# ---------------------------------------------------------------- a marca, lida no site
def _hexes(css: str) -> Counter:
    c = Counter()
    for h in re.findall(r"#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b", css):
        h = h.lower()
        c["#" + (h if len(h) == 6 else "".join(x * 2 for x in h))] += 1
    for r, g, b in re.findall(r"rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})", css):
        if max(int(r), int(g), int(b)) <= 255:
            c["#%02x%02x%02x" % (int(r), int(g), int(b))] += 1
    return c


def _palette(css: str, theme: str = "") -> list[dict]:
    """As cores da marca: as mais usadas com cor a sério, mais um escuro e um claro se o site os usar."""
    cnt = _hexes(css)
    for k in list(cnt):
        if k in WP_PRESET:
            del cnt[k]
    out, seen = [], []

    def near(h):
        r, g, b = (int(h[i:i + 2], 16) for i in (1, 3, 5))
        return any(abs(r - r2) + abs(g - g2) + abs(b - b2) < 60 for r2, g2, b2 in seen)

    def add(h, papel):
        r, g, b = (int(h[i:i + 2], 16) for i in (1, 3, 5))
        seen.append((r, g, b))
        out.append({"hex": h, "papel": papel})

    if re.fullmatch(r"#[0-9a-f]{6}", theme or ""):
        add(theme, "cor do browser")
    for h, _ in cnt.most_common(80):
        r, g, b = (int(h[i:i + 2], 16) / 255 for i in (1, 3, 5))
        _, l, s = colorsys.rgb_to_hls(r, g, b)
        if s > 0.25 and 0.12 < l < 0.9 and not near(h):
            add(h, "marca")
        if len([x for x in out if x["papel"] != "neutro"]) >= 4:
            break
    for h, _ in cnt.most_common(40):  # um neutro escuro (o texto) e um claro (o fundo), se não forem preto e branco puros
        r, g, b = (int(h[i:i + 2], 16) / 255 for i in (1, 3, 5))
        _, l, s = colorsys.rgb_to_hls(r, g, b)
        if s <= 0.25 and (l < 0.25 or l > 0.93) and h not in ("#000000", "#ffffff") and not near(h):
            add(h, "neutro")
        if len([x for x in out if x["papel"] == "neutro"]) >= 2:
            break
    return out[:6]


def _fonts(s: str, css: str) -> list[str]:
    fams = []
    for q in re.findall(r"fonts\.googleapis\.com/css2?\?([^\"'>\s]+)", s):
        for f in re.findall(r"family=([^&:;\"']+)", html.unescape(q)):
            fams.append(re.sub(r"\+|%20", " ", f).strip())
    c = Counter()
    for decl in re.findall(r"font-family\s*:\s*([^;}\"]+)", css, re.I):
        first = decl.split(",")[0].strip().strip("'\"").strip()
        if first and first.lower() not in GENERIC_FONTS and not first.startswith(("var(", "--")) and len(first) < 40:
            c[first] += 1
    fams += [f for f, _ in c.most_common(6)]
    out = []
    for f in fams:
        if f.lower() not in {x.lower() for x in out} and f.lower() not in GENERIC_FONTS:
            out.append(f)
    return out[:3]


def _logo(s: str, base: httpx.URL) -> dict:
    def abs_(u):
        try:
            return str(base.join(html.unescape(u.strip()))) if u and not u.startswith("data:") else ""
        except Exception:  # noqa: BLE001
            return ""
    logo = ""
    for tag in re.findall(r"<img\b[^>]+>", s[:400_000], re.I):
        if re.search(r"""(class|id|alt|src)=["'][^"']*logo""", tag, re.I):
            m = re.search(r"""\s(?:data-src|src)=["']([^"']+)""", tag, re.I) or re.search(r"""srcset=["']([^"'\s]+)""", tag, re.I)
            if m and not re.search(r"wix\.com/.*logo|wordpress|facebook|google|paypal|visa|mbway|multibanco", m.group(1), re.I):
                logo = abs_(m.group(1))
                break
    if not logo:  # um logótipo em SVG dentro do HTML não tem endereço: fica o ícone do site
        m = re.search(r"""<a[^>]+class=["'][^"']*(?:logo|brand)[^"']*["'][^>]*>\s*<img[^>]+src=["']([^"']+)""", s, re.I)
        logo = abs_(m.group(1)) if m else ""
    m = re.search(r"""<link[^>]+rel=["'][^"']*apple-touch-icon[^"']*["'][^>]*href=["']([^"']+)""", s, re.I) \
        or re.search(r"""<link[^>]+rel=["'](?:shortcut )?icon["'][^>]*href=["']([^"']+)""", s, re.I) \
        or re.search(r"""<link[^>]+href=["']([^"']+)["'][^>]*rel=["'](?:shortcut )?icon""", s, re.I)
    icon = abs_(m.group(1)) if m else ""
    m = re.search(r"""<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)""", s, re.I)
    og = abs_(m.group(1)) if m else ""
    return {"logo": logo, "icone": icon, "partilha": og}


def _features(s: str) -> list[str]:
    checks = [
        (r"tawk\.to|crisp\.chat|tidio|intercom|livechat|smartsupp|zopim|messenger.*chat|fb-customerchat", "Chat no site"),
        (r"wa\.me/|api\.whatsapp\.com", "Botão de WhatsApp"),
        (r"google\.com/maps/embed|maps\.google\.[a-z.]+/maps\?|maps/embed", "Mapa"),
        (r"youtube\.com/embed|player\.vimeo|<video", "Vídeo"),
        (r"calendly|booksy|fresha|treatwell|simplybook|setmore|zappointment|agendar|marcar online|reservar", "Marcações online"),
        (r"woocommerce|add-to-cart|carrinho|/cart\b|shopify", "Loja online"),
        (r"mailchimp|sendinblue|brevo|mailerlite|newsletter", "Newsletter"),
        (r"elementor", "Elementor"), (r"et_pb_|divi", "Divi"), (r"vc_row|wpbakery|js_composer", "WPBakery"),
        (r"trustindex|elfsight|reviews-widget|google-reviews", "Opiniões do Google no site"),
        (r"static\.hotjar\.com|clarity\.ms/tag|luckyorange|mouseflow|smartlook", "Mapa de cliques (Hotjar/Clarity)"),
    ]
    return [lbl for pat, lbl in checks if re.search(pat, s, re.I)]


def _pages(s: str, host: str) -> int:
    links = set()
    for u in re.findall(r"""href=["']([^"'#?]+)""", s):
        u = u.strip()
        if u.startswith(("mailto:", "tel:", "javascript:")) or re.search(r"\.(jpg|jpeg|png|webp|gif|pdf|css|js|svg|ico|xml)$", u, re.I):
            continue
        if not re.match(r"[a-z]+:|//", u, re.I):
            links.add("/" + u.lstrip("./").rstrip("/") if not u.startswith("/") else u.rstrip("/") or "/")
        elif host and re.match(rf"https?://(www\.)?{re.escape(host.removeprefix('www.'))}(/|$)", u):
            links.add(re.sub(r"^https?://[^/]+", "", u).rstrip("/") or "/")
    return len({x for x in links if not re.search(r"wp-|/feed|/tag/|/category/|/author/|/page/\d", x)})


def _langs(s: str) -> list[str]:
    ls = set(re.findall(r"""hreflang=["']([a-z]{2})""", s, re.I))
    ls |= {m.lower() for m in re.findall(r"""href=["'][^"']*/(en|fr|es|de)/["']""", s, re.I)}
    m = re.search(r"""<html[^>]+lang=["']([a-z]{2})""", s, re.I)
    if m:
        ls.add(m.group(1).lower())
    return sorted(x.lower() for x in ls)


def _credit(s: str, base: httpx.URL) -> dict:
    """O crédito de quem fez o site, no fim da página: o nome e o link para o site dessa agência ou pessoa."""
    tail = s[-25_000:]
    m = re.search(r"(?:desenvolvido|criado|concebido|design|webdesign|powered|made|feito|realizado|produzido)\s+(?:pelos|pelas|pela|pelo|por|by)\b"
                  r"(?:(?!</footer>).){0,400}?<a[^>]+href=[\"']([^\"']+)[\"'][^>]*>(.*?)</a>", tail, re.I | re.S)
    if not m:  # sem frase: um link no rodapé com o nome de quem fez (title/alt «web design», «agência»)
        m = re.search(r"<a[^>]+href=[\"'](https?://[^\"']+)[\"'][^>]*(?:title|alt)=[\"'][^\"']*(?:web ?design|desenvolvimento|ag[eê]ncia|sites)[^\"']*[\"'][^>]*>(.*?)</a>", tail, re.I | re.S)
    if not m:
        return {}
    href = html.unescape(m.group(1).strip())
    try:
        u = base.join(href)
    except Exception:  # noqa: BLE001
        return {}
    if not u.host or (u.host or "").removeprefix("www.") == (base.host or "").removeprefix("www.") or re.search(
            r"wix\.com|wordpress\.(org|com)|shopify|squarespace|jimdo|godaddy|webflow|google\.|facebook|instagram|elementor|joomla\.org", u.host or "", re.I):
        return {}
    nome = _text(m.group(2)) or re.sub(r"^www\.", "", u.host)
    return {"nome": nome[:60], "site": f"{u.scheme}://{u.host}/"}


async def _agencia(c: httpx.AsyncClient, cred: dict, nome: str, dom: dict) -> dict:
    """Quem fez o site, por inteiro: o site da agência, os contactos, as redes e o que diz que faz. O nome vem do crédito no
    rodapé ou do registo do domínio (o «Admin» de um .pt é quase sempre quem o registou para o cliente)."""
    out = {"nome": cred.get("nome") or nome or dom.get("registado_por") or "", "site": cred.get("site", ""),
           "fontes": [x for x, ok in (("crédito no rodapé", cred or nome), ("registo do domínio", dom.get("registado_por"))) if ok]}
    if dom.get("registado_por") and dom["registado_por"] != out["nome"]:
        out["registou_dominio"] = dom["registado_por"]
    if not out["site"]:
        return out
    try:
        r = await c.get(out["site"])
    except httpx.HTTPError:
        out["erro"] = "o site da agência não abriu"
        return out
    s = r.text[:500_000]
    m = re.search(r"<title[^>]*>(.*?)</title>", s, re.I | re.S)
    out["titulo"] = _text(m.group(1))[:120] if m else ""
    m = re.search(r"""<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)""", s, re.I)
    out["descricao"] = html.unescape(m.group(1)).strip()[:220] if m else ""
    out["emails"] = sorted({e.lower() for e in re.findall(r"mailto:([\w.+-]+@[\w-]+\.[\w.]+)", s)})[:3] or \
        sorted({e.lower() for e in re.findall(r"\b[\w.+-]+@[\w-]+\.(?:pt|com|net|eu|org)\b", _text(s)) if not e.endswith((".png", ".jpg"))})[:3]
    out["telefones"] = sorted({re.sub(r"\s", "", x[4:]) for x in re.findall(r"tel:[+\d\s]{9,16}", s)})[:3]
    out["redes"] = {}
    for k, (_, pat) in REDES.items():
        for h in re.findall(pat, s):
            h = html.unescape(h).strip("/")
            if h and h.lower() not in ("share", "sharer", "home", "watch", "embed", "intent"):
                out["redes"][k] = BASE_URL[k].format(h)
                break
    out["plataforma"] = next((p for p, pat, *_ in __import__("app.radar", fromlist=["PLATS"]).PLATS if re.search(pat, s, re.I)), "")
    return out


async def _site(c: httpx.AsyncClient, url: str) -> dict:
    r = await c.get(url)
    s = r.text[:800_000]
    base = r.url
    css = " ".join(re.findall(r"<style[^>]*>(.*?)</style>", s, re.S | re.I)) + " " + " ".join(re.findall(r"""style=["']([^"']+)""", s))
    sheets = [m for tag in re.findall(r"<link\b[^>]+>", s, re.I) if re.search(r"stylesheet", tag, re.I)
              for m in re.findall(r"""href=["']([^"']+)""", tag)]
    for href in sheets[:8]:
        u = base.join(html.unescape(href))
        if u.host and (u.host.removeprefix("www.") == (base.host or "").removeprefix("www.")) and not re.search(r"wp-includes|/plugins/|bootstrap|fontawesome|font-awesome", str(u)):
            try:
                rc = await c.get(u)
                css += " " + rc.text[:300_000]
            except httpx.HTTPError:
                pass
            if len(css) > 600_000:
                break
    m = re.search(r"""<meta[^>]+name=["']theme-color["'][^>]+content=["']([^"']+)""", s, re.I)
    theme = (m.group(1).strip().lower() if m else "")
    h1 = next((t for t in (_text(x) for x in re.findall(r"<h1[^>]*>(.*?)</h1>", s, re.S | re.I)) if 3 < len(t) < 140), "")
    m = re.search(r"""<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)""", s, re.I)
    marca = {**_logo(s, base), "cores": _palette(css, theme if theme.startswith("#") else ""), "letras": _fonts(s, css),
             "frase": h1, "nome": html.unescape(m.group(1)).strip() if m else ""}
    redes = {}
    for k, (_, pat) in REDES.items():
        for h in re.findall(pat, s):
            h = html.unescape(h).strip("/")
            if h and h.lower() not in ("share", "sharer", "home", "watch", "embed", "intent", "wix", "elementor", "wordpress"):
                redes[k] = {"url": BASE_URL[k].format(h), "perfil": h, "fonte": "ligado no site"}
                break
    return {"marca": marca, "redes": redes, "funcoes": _features(s), "paginas": _pages(s, base.host or ""), "linguas": _langs(s),
            "credito": _credit(s, base),
            "final": str(base)}


async def _whois(url: str) -> dict:
    """O registo do domínio (whois): desde quando existe, em nome de quem e quem o registou (muitas vezes a agência)."""
    host = (httpx.URL(url).host or "").removeprefix("www.")
    dom = ".".join(host.split(".")[-3:]) if re.search(r"\.(com|org|net|edu|gov)\.pt$", host) else ".".join(host.split(".")[-2:])
    srv = {"pt": "whois.dns.pt", "com": "whois.verisign-grs.com", "net": "whois.verisign-grs.com", "org": "whois.pir.org",
           "eu": "whois.eu", "info": "whois.nic.info", "online": "whois.nic.online", "site": "whois.nic.site"}.get(dom.rsplit(".", 1)[-1])
    if not srv or "." not in dom:
        return {}
    try:
        rd, wr = await asyncio.wait_for(asyncio.open_connection(srv, 43), 8)
        wr.write((dom + "\r\n").encode())
        await wr.drain()
        txt = (await asyncio.wait_for(rd.read(30_000), 8)).decode("utf-8", "replace")
        wr.close()
    except (OSError, asyncio.TimeoutError):
        return {}
    out = {"dominio": dom}
    m = re.search(r"(?:Creation Date|Created On|created):\s*(\d{2})/(\d{2})/(\d{4})", txt, re.I)
    m2 = re.search(r"(?:Creation Date|Created On|created):\s*(\d{4})-(\d{2})", txt, re.I)
    if m:
        out["desde"] = int(m.group(3))
    elif m2:
        out["desde"] = int(m2.group(1))
    for k, pat in (("titular", r"Owner Name:[ \t]*([^\r\n]+)"), ("registado_por", r"Admin Name:[ \t]*([^\r\n]+)"), ("registrar", r"Registrar:[ \t]*([^\r\n]+)")):
        m = re.search(pat, txt)
        if m and not re.search(r"redacted|privacy|not disclosed|data protected", m.group(1), re.I):
            out[k] = m.group(1).strip()[:90]
    return out


# ---------------------------------------------------------------- as redes que o site não liga, pela pesquisa
async def search_rich(q: str) -> list[dict]:
    """Os resultados de uma pesquisa com o título e o texto de cada um (é lá que aparecem os seguidores). O DuckDuckGo
    primeiro: com «site:instagram.com» acerta no perfil; o Bing devolve resultados ao calhas a quem não tem cookies."""
    hd = {"User-Agent": UA_PC, "Accept-Language": "pt-PT,pt;q=0.9"}
    out = []
    async with httpx.AsyncClient(timeout=15, follow_redirects=True, headers=hd) as c:
        try:
            r = await c.post("https://html.duckduckgo.com/html/", data={"q": q, "kl": "pt-pt"})
            for b in r.text.split('class="result__body"')[1:11]:
                m = re.search(r'class="result__a" href="([^"]+)"[^>]*>(.*?)</a>', b, re.S)
                if not m:
                    continue
                raw = html.unescape(m.group(1))
                mm = re.search(r"uddg=([^&]+)", raw)
                sn = re.search(r'class="result__snippet"[^>]*>(.*?)</a>', b, re.S)
                out.append({"url": urllib.parse.unquote(mm.group(1)) if mm else raw, "titulo": _text(m.group(2)), "texto": _text(sn.group(1)) if sn else ""})
        except (httpx.HTTPError, ValueError):
            pass
        if out:
            return out
        try:
            r = await c.get("https://www.bing.com/search", params={"q": q, "setlang": "pt-PT", "cc": "PT"})
            for b in r.text.split('class="b_algo"')[1:11]:
                m = re.search(r'<h2[^>]*><a[^>]+href="(https?://[^"]+)"[^>]*>(.*?)</a>', b, re.S)
                if not m:
                    continue
                raw = html.unescape(m.group(1))
                mm = re.search(r"[?&]u=a1([^&]+)", raw)
                if mm:
                    raw = base64.urlsafe_b64decode(mm.group(1) + "=" * (-len(mm.group(1)) % 4)).decode("utf-8", "replace")
                sn = re.search(r"<p[^>]*>(.*?)</p>", b, re.S)
                out.append({"url": raw, "titulo": _text(m.group(2)), "texto": _text(sn.group(1)) if sn else ""})
        except (httpx.HTTPError, ValueError):
            pass
    return out


def _followers(txt: str) -> dict:
    out = {}
    for pat, k in ((r"([\d][\d.,]*\s*(?:mil|k|m)?)\s*(?:seguidores|followers)", "seguidores"),
                   (r"([\d][\d.,]*\s*(?:mil|k|m)?)\s*(?:gostos|likes|pessoas gostam)", "gostos"),
                   (r"([\d][\d.,]*\s*(?:mil|k)?)\s*(?:publicações|posts|publicacoes)", "publicacoes"),
                   (r"([\d][\d.,]*\s*(?:mil|k|m)?)\s*(?:subscritores|subscribers)", "seguidores")):
        m = re.search(pat, txt, re.I)
        if m and (v := _num(m.group(1))) is not None and k not in out:
            out[k] = v
    return out


async def _find_redes(n: dict, local: str, have: dict, termo: str = "") -> dict:
    """Uma pesquisa só por negócio (os motores cortam quem pede muito): o nome curto, o ramo, a zona e as três redes. Cada
    perfil achado tem de ter uma palavra própria do nome; os que o site já liga só ganham os seguidores."""
    words = {w for w in _norm(n["nome"]).split() if w not in GENERIC and len(w) > 2} - set(_norm(local).split())
    if not words:
        return {}
    curto = re.sub(r"^(escolas? de condu[cç][aã]o|auto[- ]?escola|gin[aá]sio|restaurante|cabeleireiro|cl[ií]nica( dent[aá]ria)?|imobili[aá]ria|oficina)\s*", "",
                   n["nome"], flags=re.I).strip(" -,") or n["nome"]
    res = await search_rich(f"{curto} {termo} {local} instagram facebook tiktok".replace("  ", " ").strip())
    if res and not any(w in _norm(x["url"] + " " + x["titulo"]).replace(" ", "") for x in res for w in words):
        raise RuntimeError("o motor de pesquisa cortou-nos (respostas ao calhas)")
    if res and not any(re.search(r"instagram\.com|facebook\.com|tiktok\.com", x["url"]) for x in res):
        await asyncio.sleep(2)  # a primeira não deu nenhuma rede: tenta só o Instagram, que é a que mais conta
        res += await search_rich(f"{curto} {local} site:instagram.com")
    found = {}
    for x in res:
        for k in ("instagram", "facebook", "tiktok"):
            m = re.search(REDES[k][1], x["url"])
            if not m or k in found:
                continue
            perfil = m.group(1).strip("/")
            if perfil.lower() in ("explore", "share", "watch", "public", "people", "hashtag", "discover", "p", "reel"):
                continue
            old = have.get(k)
            weak = not old or old["perfil"].startswith(("pages/", "profile.php"))
            if old and not weak and _norm(old["perfil"]).replace(" ", "") != _norm(perfil).replace(" ", ""):
                continue  # já se sabe qual é: só se aproveita para os seguidores
            if weak and not any(w in _norm(perfil + " " + x["titulo"]).replace(" ", "") for w in words):
                continue
            found[k] = {"url": BASE_URL[k].format(perfil), "perfil": perfil, "fonte": old["fonte"] if old else "pesquisa",
                        **_followers(x["titulo"] + " " + x["texto"])}
    return found


# ---------------------------------------------------------------- a ficha do Google
async def _google(c: httpx.AsyncClient, n: dict, local: str) -> dict:
    q = f"{n['nome']} {local or n.get('morada', '')}".strip()
    qq = urllib.parse.quote(q)
    out = {"pesquisa": f"https://www.google.com/search?q={qq}", "mapa": n.get("maps") or f"https://www.google.com/maps/search/?api=1&query={qq}"}
    if n.get("nota"):
        out.update(estrelas=n["nota"], opinioes=n.get("opinioes"))
    key = os.environ.get("GOOGLE_PLACES_KEY")
    if not key:
        out["sem_chave"] = True
        return out
    body = {"textQuery": q, "languageCode": "pt-PT", "regionCode": "PT", "maxResultCount": 1}
    if n.get("lat"):
        body["locationBias"] = {"circle": {"center": {"latitude": n["lat"], "longitude": n["lon"]}, "radius": 3000}}
    r = await c.post("https://places.googleapis.com/v1/places:searchText", json=body, headers={
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "places.displayName,places.rating,places.userRatingCount,places.googleMapsUri,places.businessStatus,"
                            "places.regularOpeningHours.weekdayDescriptions,places.photos.name,places.primaryTypeDisplayName,"
                            "places.reviews.rating,places.reviews.text.text,places.reviews.relativePublishTimeDescription,places.websiteUri"})
    if r.status_code != 200:
        out["erro"] = f"Google Places respondeu {r.status_code}"
        return out
    p = (r.json().get("places") or [{}])[0]
    if not p:
        out["nao_tem"] = True
        return out
    words = {w for w in _norm(n["nome"]).split() if w not in GENERIC and len(w) > 2}
    if words and not words & set(_norm(p.get("displayName", {}).get("text", "")).split()):
        out["nao_tem"] = True  # o Google devolveu outro negócio: é como se não tivesse ficha
        return out
    out.update(nome=p.get("displayName", {}).get("text", ""), estrelas=p.get("rating"), opinioes=p.get("userRatingCount"),
               mapa=p.get("googleMapsUri") or out["mapa"], fotos=len(p.get("photos") or []), tipo=(p.get("primaryTypeDisplayName") or {}).get("text", ""),
               horario=(p.get("regularOpeningHours") or {}).get("weekdayDescriptions") or [], aberto=p.get("businessStatus") == "OPERATIONAL",
               site=p.get("websiteUri", ""),
               ultimas=[{"estrelas": x.get("rating"), "quando": x.get("relativePublishTimeDescription", ""), "texto": ((x.get("text") or {}).get("text") or "")[:220]}
                        for x in (p.get("reviews") or [])[:3]])
    return out


# ---------------------------------------------------------------- o dinheiro
def custo(n: dict, f: dict | None = None) -> dict | None:
    """Quanto custou fazer o site, a preços de mercado em Portugal (out 2026), pelo que se vê; e quanto já lá meteram."""
    a = n.get("audit") or {}
    if not n.get("site") or a.get("erro"):
        return None
    f = f or {}
    plat, ag = a.get("plataforma") or "", a.get("agencia") or ""
    porque = []
    if plat in ("Wix", "Squarespace", "Jimdo", "Site123", "GoDaddy", "Webflow"):
        lo, hi = (400, 1500) if ag else (0, 300)
        porque.append(f"{plat} {'montado por uma agência: 400–1500 €' if ag else 'feito no construtor, quase sempre pelo próprio: 0–300 €'}")
    elif plat in ("WordPress", "Joomla"):
        lo, hi = (800, 2500) if ag else (300, 1200)
        porque.append(f"{plat} com tema {'e agência: 800–2500 €' if ag else 'comprado ou freelancer: 300–1200 €'}")
    elif plat == "Shopify":
        lo, hi = (1500, 4000) if ag else (500, 2000)
        porque.append(f"Loja Shopify{' feita por agência' if ag else ''}: {lo}–{hi} €")
    else:
        lo, hi = (1500, 4000) if ag else (500, 2000)
        porque.append(f"Feito à medida (sem construtor conhecido){' por agência' if ag else ''}: {lo}–{hi} €")
    if ag:
        porque.append(f"Assinado por «{ag}» no rodapé")
    pg = f.get("paginas") or 0
    if pg > 20:
        lo, hi = round(lo * 1.3), round(hi * 1.3)
        porque.append(f"{pg} páginas ligadas: mais 30 %")
    if len(f.get("linguas") or []) > 1:
        lo, hi = lo + 300, hi + 800
        porque.append(f"Em {len(f['linguas'])} línguas: mais 300–800 €")
    fn = f.get("funcoes") or []
    if "Marcações online" in fn or a.get("inscricao_online"):
        lo, hi = lo + 200, hi + 600
        porque.append("Inscrição ou marcação online: mais 200–600 €")
    if "Loja online" in fn and plat != "Shopify":
        lo, hi = lo + 500, hi + 1500
        porque.append("Loja online: mais 500–1500 €")
    ano = f.get("desde") or None
    cy = a.get("copyright")
    g = n.get("gasto") or {}
    out = {"min": lo, "max": hi, "porque": porque, "desde": ano, "ano_copyright": cy}
    if ano and ano < time.localtime().tm_year:
        anos = time.localtime().tm_year - ano
        base_lo, base_hi = (g.get("min") or 0), (g.get("max") or 0)
        # só o que paga sempre (plataforma, alojamento, domínio); a manutenção da agência e os anúncios ficam de fora: não se sabe
        # há quanto tempo correm
        ads = a.get("meta_pixel") or a.get("tiktok_pixel")
        fix_lo = base_lo - (150 if a.get("google_ads") else 0) - (80 if ads else 0) - (30 if ag else 0)
        fix_hi = base_hi - (600 if a.get("google_ads") else 0) - (400 if ads else 0) - (120 if ag else 0)
        out["ate_hoje"] = [lo + max(0, fix_lo) * 12 * anos, hi + max(0, fix_hi) * 12 * anos]
        out["anos"] = anos
    return out


def ofertas(n: dict, f: dict) -> list[dict]:
    """O que lhes vendemos, por ordem do que mais falta faz, com o porquê de cada um."""
    a, g, redes = n.get("audit") or {}, f.get("google") or {}, f.get("redes") or {}
    out = []

    def add(k, porque):
        nome, uni, mes = PRECOS[k]
        out.append({"id": k, "servico": nome, "porque": porque, "unico": uni, "mensal": mes})

    if not n.get("site"):
        add("site", "Não tem site: quem procura no Google vai parar aos concorrentes.")
    elif a.get("erro"):
        add("site", "O site está em baixo; cada visita perde-se.")
    elif (n.get("nota_site") or 0) < 70:
        add("site", f"O site tem {n.get('nota_site')}/100: {', '.join(p['problema'].split(':')[0].rstrip('.').lower() for p in (n.get('problemas') or [])[:2])}.")
    if not a.get("inscricao_online") and "Marcações online" not in (f.get("funcoes") or []):
        add("inscricao", "Ninguém se consegue inscrever ou marcar sem telefonar.")
    if not ("Chat no site" in (f.get("funcoes") or [])):
        add("ia", "Ninguém responde fora de horas; a maioria das perguntas (preços, horários, como me inscrevo) é sempre a mesma.")
    if g.get("nao_tem"):
        add("google", "Não aparece no mapa do Google com ficha própria.")
    elif g.get("estrelas") is not None and (g.get("opinioes") or 0) < 60:
        add("opinioes", f"Só {g.get('opinioes') or 0} opiniões no Google; os concorrentes com mais estrelas ficam à frente no mapa.")
    elif not a.get("schema") and n.get("site"):
        add("google", "O Google não tem os dados do negócio local (morada, horário, opiniões) para mostrar.")
    ig = redes.get("instagram") or {}
    if not ig:
        add("redes", "Não tem Instagram: é onde se escolhe uma escola, um ginásio ou um restaurante hoje.")
    elif (ig.get("seguidores") or 0) < 1500:
        add("redes", f"Instagram com {'cerca de ' + str(ig['seguidores']) if ig.get('seguidores') else 'poucos'} seguidores: precisa de Reels todas as semanas.")
    elif "tiktok" not in redes:
        add("redes", "Não está no TikTok, onde estão os clientes mais novos.")
    gasto = n.get("gasto") or {}
    if gasto.get("anuncios"):
        add("anuncios", "Já paga anúncios: com um site que converte e campanhas afinadas, o mesmo dinheiro rende mais.")
    elif (n.get("nota_site") or 0) >= 60 or not out:
        add("anuncios", "O site já está razoável; falta trazer gente a ele com anúncios locais.")
    m = f.get("marca") or {}
    if n.get("site") and not a.get("erro") and (not m.get("logo") or not m.get("cores")):
        add("marca", "Não se vê um logótipo claro nem cores próprias no site.")
    if any(o["id"] in ("site", "redes", "google") for o in out):
        add("acompanhamento", "Para não voltar a ficar parado: alguém trata disto todos os meses.")
    return out


# ---------------------------------------------------------------- a IA
SYS = ("És o estratega comercial de uma pequena agência portuguesa que vende sites, IA, redes sociais e anúncios a negócios locais. "
       "Recebes a ficha pública de um negócio (o que se viu no site, nas redes e no Google). Respondes só com JSON. Português de Portugal, "
       "frases curtas, tratamento por «você» nas frases para o cliente, sem travessões a meio da frase, sem emojis. Usas só os números que "
       "estão na ficha; o que não está lá, não inventas.")


def _prompt(scan: dict, n: dict, f: dict) -> str:
    a = n.get("audit") or {}
    ficha = {"ramo": scan.get("ramo_nome"), "zona": scan.get("local") or n.get("morada"), "nome": n["nome"], "site": n.get("site"),
             "nota_site": n.get("nota_site"), "problemas": [p["problema"] for p in (n.get("problemas") or [])[:6]], "ja_bem": n.get("bons"),
             "plataforma": a.get("plataforma"), "agencia": a.get("agencia"), "gasto_mensal_estimado": [n.get("gasto", {}).get("min"), n.get("gasto", {}).get("max")],
             "custo_site_estimado": f.get("custo"), "marca": {k: v for k, v in (f.get("marca") or {}).items() if k in ("cores", "letras", "frase", "nome")} | {"tem_logo": bool((f.get("marca") or {}).get("logo"))},
             "redes": f.get("redes"), "google": {k: v for k, v in (f.get("google") or {}).items() if k in ("estrelas", "opinioes", "fotos", "nao_tem", "sem_chave", "ultimas")},
             "agencia": f.get("agencia"), "dominio": f.get("dominio"),
             "funcoes_do_site": f.get("funcoes"), "paginas": f.get("paginas"), "linguas": f.get("linguas"),
             "o_que_ja_propomos": [{"servico": o["servico"], "unico": o["unico"], "mensal": o["mensal"]} for o in f.get("ofertas") or []]}
    return ("Ficha:\n" + json.dumps(ficha, ensure_ascii=False) + "\n\n"
            "Primeiro usa a pesquisa web (3 a 5 pesquisas curtas, uma por rede: «<nome curto> <localidade> instagram», «... facebook», "
            "«... tiktok», e «<nome> <localidade> opiniões google») para completar o que falta: o Instagram, o Facebook e o TikTok "
            "deste negócio (só perfis que são mesmo dele: o nome e a localidade têm de bater certo) com os seguidores que a pesquisa "
            "mostrar, e a ficha do Google Maps (estrelas e número de opiniões, se aparecerem). Não inventes perfis nem números: o que "
            "não achares fica de fora. Se a ficha tem «agencia» (quem fez o site), pesquisa também essa agência ou pessoa: o site, "
            "a cidade, o email, o telefone, o Instagram/Facebook/LinkedIn e outros clientes que mostre.\n\n"
            "Depois devolve este JSON e mais nada:\n"
            '{"redes": {"instagram": {"url": "https://www.instagram.com/...", "seguidores": 1234}, "facebook": {"url": "...", "seguidores": 0}, '
            '"tiktok": {"url": "...", "seguidores": 0}},\n'
            ' "agencia": {"nome": "", "site": "", "cidade": "", "email": "", "telefone": "", "instagram": "", "facebook": "", "linkedin": "", '
            '"clientes": ["outros clientes que mostre"], "nota": "1 frase: que tipo de fornecedor é (freelancer, agência pequena, grande)"},\n'
            ' "google": {"estrelas": 4.7, "opinioes": 120, "url": "link do Google Maps, se o tiveres"},\n'
            ' "resumo": "2 frases: como está a presença e a marca deste negócio hoje",\n'
            ' "ideias": [{"titulo": "o que fazer, em 6 palavras", "porque": "o que na ficha mostra que faz falta", '
            '"como": "o que entregamos, concreto", "ganho": "o que o negócio ganha", "preco": "preço sugerido, ex. 390 € + 49 €/mês"}],\n'
            ' "abordagem": "a primeira frase para lhe dizer ao telefone, a partir de uma coisa concreta da ficha"}\n'
            "3 a 5 ideias, a que dá mais dinheiro primeiro. Pelo menos uma tem de usar IA (assistente no WhatsApp, respostas automáticas, "
            "conteúdo, marcações). Pensa no que este ramo vende e em como ganha clientes, não só no site.")


async def _ai(scan: dict, n: dict, f: dict) -> dict:
    from .tradingroom.council import ask_claude
    text, cost = await ask_claude(SYS, _prompt(scan, n, f), "sonnet", DIR / "work", timeout=300, tools="WebSearch")
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        raise RuntimeError("a IA não devolveu a ficha")
    js = json.loads(m.group(0))
    ideias = [{k: str(i.get(k) or "").strip() for k in ("titulo", "porque", "como", "ganho", "preco")} for i in js.get("ideias") or [] if isinstance(i, dict)][:5]
    redes = {}
    for k, v in (js.get("redes") or {}).items():  # só perfis com o endereço certo de cada rede
        if k in ("instagram", "facebook", "tiktok") and isinstance(v, dict) and (m := re.search(REDES[k][1], str(v.get("url") or ""))):
            perfil = m.group(1).strip("/")
            seg = v.get("seguidores")
            redes[k] = {"url": BASE_URL[k].format(perfil), "perfil": perfil, "fonte": "IA (pesquisa web)",
                        **({"seguidores": int(seg)} if isinstance(seg, (int, float)) and seg > 0 else {})}
    g = js.get("google") if isinstance(js.get("google"), dict) else {}
    google = {}
    if isinstance(g.get("estrelas"), (int, float)) and 1 <= g["estrelas"] <= 5:
        google = {"estrelas": round(float(g["estrelas"]), 1), "opinioes": int(g["opinioes"]) if isinstance(g.get("opinioes"), (int, float)) else None, "fonte": "IA (pesquisa web)"}
        if re.match(r"https://(www\.)?(google\.[a-z.]+/maps|maps\.google\.|maps\.app\.goo\.gl|goo\.gl/maps)", str(g.get("url") or "")):
            google["mapa"] = g["url"]
    ag = {k: v for k, v in (js.get("agencia") or {}).items() if v} if isinstance(js.get("agencia"), dict) else {}
    return {"agencia": ag, "resumo": str(js.get("resumo") or "").strip(), "ideias": ideias, "abordagem": str(js.get("abordagem") or "").strip(),
            "redes": redes, "google": google, "custo_usd": round(cost, 3)}


# ---------------------------------------------------------------- a ficha inteira
class Fichas:
    def __init__(self):
        FX.mkdir(parents=True, exist_ok=True)
        self.jobs: dict[str, str] = {}  # chave -> fase
        self._tasks: set = set()

    def get(self, sid: str, nid: str) -> dict:
        p = _key(sid, nid)
        f = json.loads(p.read_text("utf-8")) if p.exists() else None
        return {"ficha": f, "fase": self.jobs.get(p.stem)}

    def start(self, scan: dict, nid: str) -> dict:
        p = _key(scan["id"], nid)
        n = next((x for x in scan["negocios"] if x["id"] == nid), None)
        if not n:
            raise ValueError("negócio desconhecido")
        if p.stem not in self.jobs:
            self.jobs[p.stem] = "a abrir o site"
            t = asyncio.create_task(self._run(scan, n, p))
            self._tasks.add(t)
            t.add_done_callback(self._tasks.discard)
        return self.get(scan["id"], nid)

    def _save(self, p: Path, f: dict) -> None:
        tmp = p.with_suffix(".tmp")
        tmp.write_text(json.dumps(f, ensure_ascii=False), "utf-8")
        tmp.replace(p)

    async def _run(self, scan: dict, n: dict, p: Path) -> None:
        local = (re.split(r"\d+[A-Za-z]?\s*", n.get("morada") or "")[-1].strip(" ,") if n.get("morada") else "") or scan.get("local") or ""
        f = {"at": time.time(), "nome": n["nome"], "marca": {}, "redes": {}, "google": {}, "funcoes": [], "paginas": 0, "linguas": [], "erros": []}
        try:
            async with httpx.AsyncClient(timeout=15, follow_redirects=True, verify=False, headers={"User-Agent": UA, "Accept-Language": "pt-PT,pt;q=0.9"}) as c:
                if n.get("site") and not (n.get("audit") or {}).get("erro"):
                    try:
                        f.update(await _site(c, (n.get("audit") or {}).get("final") or n["site"]))
                    except httpx.HTTPError as e:
                        f["erros"].append(f"o site não abriu ({e.__class__.__name__})")
                    self.jobs[p.stem] = "a ver há quanto tempo existe"
                    f["dominio"] = await _whois(n["site"])
                    f["desde"] = f["dominio"].get("desde")
                    ag = (n.get("audit") or {}).get("agencia", "")
                    if f.get("credito") or ag or f["dominio"].get("registado_por"):
                        self.jobs[p.stem] = "a ver quem fez o site"
                        f["agencia"] = await _agencia(c, f.get("credito") or {}, ag, f["dominio"])
                        # os outros clientes dessa agência nesta pesquisa
                        nm = _norm(f["agencia"].get("nome", ""))
                        if nm:
                            f["agencia"]["clientes_na_zona"] = [x["nome"] for x in scan["negocios"] if x["id"] != n["id"] and _norm((x.get("audit") or {}).get("agencia", "")) == nm][:12]
                if n.get("facebook") and "facebook" not in f["redes"]:
                    m = re.search(REDES["facebook"][1], n["facebook"])
                    if m:
                        f["redes"]["facebook"] = {"url": n["facebook"], "perfil": m.group(1).strip("/"), "fonte": "diretório"}
                self.jobs[p.stem] = "a procurar as redes sociais"
                try:
                    for k, v in (await _find_redes(n, local, f["redes"], RAMOS.get(scan.get("ramo"), ("", [], ""))[2])).items():
                        f["redes"][k] = {**f["redes"].get(k, {}), **v}
                except Exception as e:  # noqa: BLE001  a pesquisa corta quem pede muito: fica o que o site liga
                    f["redes_falhou"] = True
                    f["erros"].append(f"pesquisa das redes: {str(e)[:80]}")
                self.jobs[p.stem] = "a ver a ficha do Google"
                async with httpx.AsyncClient(timeout=15) as g:
                    try:
                        f["google"] = await _google(g, n, local)
                    except Exception as e:  # noqa: BLE001
                        f["google"] = {"erro": str(e)[:100]}
            f["custo"] = custo(n, f)
            f["ofertas"] = ofertas(n, f)
            uni, mes = sum(o["unico"] for o in f["ofertas"]), sum(o["mensal"] for o in f["ofertas"])
            f["potencial"] = {"unico": uni, "mensal": mes, "ano": uni + 12 * mes}
            f["ia"] = {"fase": "a pensar"}
            self._save(p, f)
            self.jobs[p.stem] = "a IA está a procurar as redes e a pensar no que lhes vender"
            try:
                f["ia"] = await _ai(scan, n, f)
                for k, v in f["ia"].pop("redes", {}).items():  # o que a IA achou completa o que a pesquisa grátis não achou
                    if k not in f["redes"]:
                        f["redes"][k] = v
                    elif v.get("seguidores") and not f["redes"][k].get("seguidores"):
                        f["redes"][k]["seguidores"] = v["seguidores"]
                ai_ag = f["ia"].pop("agencia", {})
                if ai_ag:  # completa a agência com o que a IA achou, sem apagar o que se leu no site
                    cur_ag = f.setdefault("agencia", {"nome": ai_ag.get("nome", ""), "fontes": []})
                    for k in ("site", "cidade", "nota"):
                        if ai_ag.get(k) and not cur_ag.get(k):
                            cur_ag[k] = str(ai_ag[k])[:200]
                    if ai_ag.get("email") and not cur_ag.get("emails"):
                        cur_ag["emails"] = [str(ai_ag["email"])[:80]]
                    if ai_ag.get("telefone") and not cur_ag.get("telefones"):
                        cur_ag["telefones"] = [str(ai_ag["telefone"])[:30]]
                    rd = cur_ag.setdefault("redes", {})
                    for k in ("instagram", "facebook", "linkedin"):
                        if k not in rd and re.match(r"https?://(www\.)?" + {"linkedin": "linkedin"}.get(k, k) + r"\.com/", str(ai_ag.get(k) or "")):
                            rd[k] = ai_ag[k]
                    if isinstance(ai_ag.get("clientes"), list):
                        cur_ag["clientes"] = [str(x)[:60] for x in ai_ag["clientes"]][:10]
                    cur_ag["fontes"] = cur_ag.get("fontes", []) + ["IA (pesquisa web)"]
                gi = f["ia"].pop("google", {})
                if gi and f["google"].get("estrelas") is None:
                    f["google"].update(gi)
                    f["google"].pop("sem_chave", None)
                f["ofertas"] = ofertas(n, f)  # com as redes e o Google completos, as propostas mudam
                uni, mes = sum(o["unico"] for o in f["ofertas"]), sum(o["mensal"] for o in f["ofertas"])
                f["potencial"] = {"unico": uni, "mensal": mes, "ano": uni + 12 * mes}
            except Exception as e:  # noqa: BLE001  sem IA a ficha fica com as ofertas feitas por regras
                f["ia"] = {"erro": str(e)[:160] or e.__class__.__name__}
        except Exception as e:  # noqa: BLE001
            f["erros"].append(str(e)[:160] or e.__class__.__name__)
        finally:
            f["fim"] = time.time()
            self._save(p, f)
            self.jobs.pop(p.stem, None)


FICHAS = Fichas()
