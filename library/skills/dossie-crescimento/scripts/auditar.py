import sys, re, json, time, urllib.request, ssl, html
UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile Safari/604.1"
def get(url):
    t = time.time()
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "pt-PT,pt;q=0.9,en;q=0.8"})
    with urllib.request.urlopen(req, timeout=25, context=ssl.create_default_context()) as r:
        body = r.read()
        return r.geturl(), r.status, body, time.time() - t
def has(p, s): return bool(re.search(p, s, re.I))
def audit(name, url):
    o = {"nome": name, "url": url}
    try:
        final, st, body, dt = get(url)
    except Exception as e:
        o["erro"] = str(e)[:120]; return o
    s = body.decode("utf-8", "replace")
    o.update(final=final, status=st, segundos=round(dt, 2), kb=len(body)//1024, https=final.startswith("https"))
    plat = [n for n, p in [("Shopify", r"cdn\.shopify\.com|Shopify\.theme"), ("Wix", r"wixstatic|_wixCssImports|wix\.com"),
        ("Squarespace", r"squarespace"), ("WooCommerce", r"woocommerce"), ("WordPress", r"wp-content"),
        ("Big Cartel", r"bigcartel"), ("Webflow", r"webflow"), ("Cargo", r"cargo\.site|cargocollective"), ("Format", r"format\.com")] if has(p, s)]
    o["plataforma"] = plat or ["?"]
    m = re.search(r"<title[^>]*>(.*?)</title>", s, re.I | re.S); o["titulo"] = html.unescape(m.group(1).strip())[:90] if m else ""
    m = re.search(r'<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']*)', s, re.I); o["descricao"] = html.unescape(m.group(1))[:160] if m else ""
    o["og_image"] = has(r'property=["\']og:image', s)
    o["viewport"] = has(r'name=["\']viewport', s)
    # na Shopify o pixel vem pelas web pixels das apps e nao aparece como fbq() no HTML
    o["meta_pixel"] = has(r"fbq\(|connect\.facebook\.net/.*/fbevents|\"facebook_pixel", s)
    o["google_analytics"] = has(r"gtag\(|googletagmanager|google-analytics", s)
    o["tiktok_pixel"] = has(r"analytics\.tiktok\.com|ttq\.", s)
    o["loja"] = has(r"/cart|carrinho|add[-_ ]to[-_ ]cart|adicionar ao carrinho|/shop|loja", s)
    o["newsletter"] = has(r"newsletter|subscre|mailchimp|klaviyo|sign up", s)
    o["schema"] = has(r"application/ld\+json", s)
    m = re.search(r'<html[^>]*lang=["\']([^"\']+)', s, re.I); o["lang"] = m.group(1) if m else ""
    o["instagram"] = sorted(set(re.findall(r"instagram\.com/([A-Za-z0-9_.]+)", s)) - {"p", "explore", "accounts"})[:3]
    o["tiktok"] = has(r"tiktok\.com/@", s)
    yrs = [int(y) for y in re.findall(r"(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–]\s*)?(20\d\d)", s, re.I)]
    o["copyright"] = max(yrs) if yrs else None
    if "Shopify" in plat:
        try:
            _, _, pj, _ = get(final.rstrip("/").split("?")[0].rsplit("/", 0)[0] + "/products.json?limit=250")
            p = json.loads(pj)["products"]
            ws = [x for x in p if re.search("workshop|aula|curso|voucher|gift", x["title"] + x["product_type"], re.I)]
            es = [x for x in p if not any(v["available"] for v in x["variants"])]
            o["catalogo"] = dict(produtos=len(p), experiencias=len(ws), esgotados=len(es),
                ultimo=max((x["published_at"][:10] for x in p if x not in ws), default=None))
        except Exception as e:
            o["catalogo"] = {"erro": str(e)[:80]}
    return o
out = [audit(*l.strip().split("|", 1)) for l in open(sys.argv[1]) if l.strip()]
json.dump(out, open(sys.argv[2], "w"), ensure_ascii=False, indent=1)
for o in out:
    if "erro" in o: print(f"{o['nome']:24} ERRO {o['erro']}"); continue
    print(f"{o['nome']:24} {o['status']} {o['segundos']:>5}s {o['kb']:>5}kB {','.join(o['plataforma']):18} px={int(o['meta_pixel'])} ga={int(o['google_analytics'])} og={int(o['og_image'])} desc={int(bool(o['descricao']))} nl={int(o['newsletter'])} loja={int(o['loja'])} lang={o['lang']:6} ©{o['copyright']} ig={o['instagram']} {o.get('catalogo','')}")
