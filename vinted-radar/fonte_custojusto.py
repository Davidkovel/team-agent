"""Segunda fonte do radar (13 nov, Marco: «estamos sempre no Vinted... sites fortes, sempre os mais fiáveis»): o CustoJusto,
os classificados portugueses. A página pública da pesquisa traz os anúncios já escritos na página (o mesmo que o browser
recebe): título, preço, foto, cidade, quem vende e se é profissional. Uma página por pesquisa, com a mesma pausa do radar.
O OLX recusa a página a um pedido normal e o Wallapop só mostra a pesquisa dentro da app: ficam de fora (não se contorna).

Os ids ficam negativos (-listID) para nunca se cruzarem com os do Vinted na mesma tabela."""
import json
import re
import time
import urllib.parse
import urllib.request

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36"
BASE = "https://www.custojusto.pt"


def ler_anuncios(pesquisa, preco_max=None, pagina=1):
    q = urllib.parse.quote(pesquisa.replace(" ", "-"))
    url = f"{BASE}/portugal/q/{q}" + (f"?o={pagina}" if pagina > 1 else "")
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "pt-PT,pt;q=0.9"})
    with urllib.request.urlopen(req, timeout=20) as r:
        html = r.read().decode("utf-8", "replace")
    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.S)
    if not m:
        raise RuntimeError("CustoJusto: a página mudou ou recusou o pedido; paramos, sem contornar.")
    itens = json.loads(m.group(1))["props"]["pageProps"].get("listItems") or []
    agora = time.strftime("%Y-%m-%d %H:%M:%S")
    out = []
    for a in itens:
        preco = a.get("price")
        if not isinstance(preco, (int, float)) or preco <= 0 or a.get("type") != "sell":
            continue
        if preco_max and preco > preco_max:
            continue
        loc = a.get("locationNames") or {}
        out.append({"id": -int(a["listID"]), "titulo": (a.get("title") or "").strip(), "marca": "", "tamanho": "", "estado": "",
                    "preco": float(preco), "foto": a.get("imageFullURL") or "", "link": BASE + (a.get("url") or ""),
                    "visto_em": agora, "fonte": "custojusto", "cidade": ", ".join(x for x in (loc.get("county"), loc.get("district")) if x),
                    "vendedor": (a.get("name") or "").strip()[:60] or None, "profissional": 1 if a.get("companyAd") else 0})
    return out
