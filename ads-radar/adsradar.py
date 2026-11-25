"""Radar de Anúncios: o que a Meta está a mostrar agora em cada país, e o que já aguenta dias no ar.

A ideia (David, 25 nov): um anúncio que começou há pouco e continua ativo há 2+ dias está a ser pago e a dar dinheiro, por
isso o produto tem procura. Lemos a Biblioteca de Anúncios pública da Meta (sem login, sem chave), guardamos cada anúncio
em SQLite e o Hub (#/anuncios) mostra as tendências por país, categoria e risco (burla/zona cinzenta à parte).

python adsradar.py uma            # uma volta por todos os países ligados
python adsradar.py uma UZ         # só um país
python adsradar.py correr         # uma volta a cada intervalo_h, para sempre (o Hub arranca-o assim)
python adsradar.py top [UZ]       # as tendências no ecrã

Educado: uma página por pesquisa, uma pausa entre páginas, sem login, sem proxies. Sem login a Meta só deixa ver a 1.ª
página (~30 anúncios) de cada pesquisa: a «página seguinte» responde «Rate limit exceeded». Por isso há várias pesquisas
por país, cada uma ordenada pelas impressões (os mais vistos primeiro). Se a Meta pedir captcha, paramos essa volta.
"""
import json
import math
import os
import re
import sqlite3
import sys
import time
import traceback
from urllib.parse import quote, urlparse

RAIZ = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(RAIZ, "ads.db")
STATUS = os.path.join(RAIZ, "status.json")
CFG_F = os.path.join(RAIZ, "config", "pesquisas.json")
DIA = 86400


def cfg():
    with open(CFG_F, encoding="utf-8") as f:
        return json.load(f)


def agora():
    return time.strftime("%Y-%m-%d %H:%M:%S")


def estado(**kw):
    try:
        with open(STATUS, encoding="utf-8") as f:
            st = json.load(f)
    except Exception:
        st = {}
    st.update(kw, em=agora())
    with open(STATUS, "w", encoding="utf-8") as f:
        json.dump(st, f, ensure_ascii=False)


# ---------------------------------------------------------------- categorias e risco

CATEGORIAS = [
    ("apostas", "Apostas e casino", r"casino|cassino|kazino|казино|slot|1win|1xbet|mostbet|pin-?up|melbet|betano|bet365|parimatch|favbet|vbet|stake\.|aposta|ставки на спорт|ставка на матч|букмекер|джекпот|jackpot|roleta|рулетк|poker|покер|tikish|bukmeker"),
    ("cripto", "Cripto e investimento", r"crypto|cripto|крипт|bitcoin|btc|ethereum|binance|bybit|okx|kraken|coinbase|trading|трейд|forex|форекс|invest|інвест|инвест|акці[їй] компан|dividend|дивіденд|дивиденд|bourse|broker|брокер|токен|token|blockchain|staking|airdrop|passiv|пасивн|пассивн|sarmoya|birja"),
    ("credito", "Crédito e banca", r"кредит|credit|crédito|credito|kredit|позик|займ|zaym|qarz|ипотек|іпотек|hipoteca|mortgage|loan|empréstimo|emprestimo|cartão|card|картк|карт[аы] |bank|банк|monobank|privat|uzum bank|tbc|kapitalbank|anor|payme|click\.uz|seguro|insurance|страхов|sug'urta"),
    ("cursos", "Cursos e infoprodutos", r"curso|курс|kurs|webinar|вебінар|вебинар|masterclass|майстер-клас|мастер-класс|ebook|e-book|mentoria|ментор|навчан|обучен|o'quv|o‘quv|ta'lim|academy|академ|school|школ|maktab|ielts|english|англій|англий|ingliz|aprenda|aprende|lesson|урок|dars|марафон|marathon|коуч|coach"),
    ("apps", "Apps e jogos", r"play\.google|apps\.apple|app store|google play|install|instal|завантаж|скачай|скачать|o'rnat|yuklab|baixe|baixar|jogo|game|гра |игра|ilova|додаток|приложен|aplicação|aplicacao"),
    ("beleza", "Beleza e saúde", r"pele|skin|шкір|кож|teri|cabelo|hair|волос|soch|creme|cream|крем|perfum|парфум|парфюм|atir|maquilh|makeup|косметик|kosmetik|dieta|diet|дієт|диет|emagrec|похуд|схуд|ozish|vitamin|вітамін|витамин|suplement|добавк|saúde|saude|health|здоров|sog'liq|clínica|clinica|клінік|клиник|klinika|dent|стоматолог|stomatolog|ортопед|ortoped"),
    ("imobiliario", "Imobiliário", r"imóve|imove|apartamento|moradia|t[0-4] |квартир|kvartira|нерухом|недвижим|ko'chmas|житлов|жилой|новобуд|новострой|real estate|imobili|propriedade|turar joy"),
    ("auto", "Automóvel", r"\bcarro|\bauto|автомоб|авто |машин|mashina|chevrolet|byd|tesla|toyota|kia |hyundai|pneu|шини|шины|test drive|тест-драйв|stand automóvel"),
    ("viagens", "Viagens", r"viage|travel|подорож|путешеств|sayohat|tur |тур |hotel|готел|отел|mehmonxona|voo|flight|авіа|авиа|aviabilet|booking|cruise|cruzeiro|férias|ferias|відпуст|отпуск"),
    ("comida", "Comida e entregas", r"pizza|піц|пицц|sushi|суші|суши|burger|бургер|restaurante|ресторан|restoran|кафе|cafe|delivery|доставка їжі|доставка еды|yandex eda|glovo|uber eats|bolt food|menu|меню|taom|ovqat"),
    ("emprego", "Emprego e renda", r"vaga|emprego|\bjob\b|вакан|ishga kir|ish o'rni|recrut|hiring|найм|зарплат|salário|salario|maosh|підробіт|подработ|заробіт|заработ|ganhe|ganhar dinheiro|\bearn\b|renda extra"),
    ("loja", "Loja e produtos", r"comprar|compre|encomend|купи|купити|замов|заказ|buyurtma|sotib|xarid|shop|loja|магазин|do'kon|desconto|знижк|скидк|chegirma|promo|акці[яї]|акция|sale|saldo|portes grátis|envio grátis|безкоштовн[аа] доставк|бесплатн[ая] доставк|yetkazib|доставк|delivery|preço|ціна|цена|narx|uzum market|rozetka|prom\.ua|olx|wildberries|ozon|amazon|aliexpress|temu|shein|grn|грн|so'm|сум|€"),
    ("servicos", "Serviços", r"serviço|servico|послуг|услуг|xizmat|reparação|ремонт|ta'mir|limpeza|прибиран|уборк|advogad|юрист|lawyer|contabil|бухгалт|marketing|маркетинг|site|сайт|design|дизайн|fotograf|фотограф|evento|подія|событи|wedding|весілл|свадьб|to'y"),
]
_CAT_RE = [(k, n, re.compile(p, re.I)) for k, n, p in CATEGORIAS]
CAT_NOME = {k: n for k, n, _ in CATEGORIAS} | {"outros": "Outros"}
# a categoria da página na Meta ajuda quando o texto não diz nada
CAT_PAGINA = [("cripto", r"financ|invest|crypto"), ("credito", r"bank|insurance|loan"), ("apostas", r"gambl|casino"),
              ("cursos", r"educat|school|coach"), ("apps", r"app page|video game|software"), ("beleza", r"health|beauty|cosmetic|medical"),
              ("imobiliario", r"real estate"), ("auto", r"automotive|car dealer"), ("viagens", r"travel|hotel"),
              ("comida", r"restaurant|food"), ("loja", r"shopping|retail|clothing|product|brand|e-commerce|ecommerce"),
              ("servicos", r"service|agency|consult")]

PROMESSA = re.compile(r"garant|guarant|гарант|kafolat|sem risco|без ризик|без риск|risk-?free|risksiz|\d[\d\s.,]*\s?(€|\$|usd|eur|грн|uah|руб|so'm|сум)\s?(por|per|в|на|за)\s?(dia|day|день|kun|semana|week|тиждень|неделю|hafta)"
                      r"|пасивн|пассивн|passive income|renda passiva|rendimento passivo|без вкладень|без вложений|ganhe até|earn up to|до \d+ ?% (в|на)|\d{2,}\s?% (lucro|profit|прибут|прибыл|daromad)|миттєв(і|ий) виплат|мгновенн(ые|ый) выплат"
                      r"|retire já|забери|withdraw instantly|x\d{2,}|ікс \d+|удвоит|подвоїт|duplic", re.I)
ISCA = re.compile(r"forbes|bbc|cnn|reuters|bloomberg|euronews|tsn\.ua|тсн|unian|уніан|rtp|sic not|cmjornal|observador|публічн|интервью|інтерв'ю|interview|entrevista|exclusiv|ексклюзив|эксклюзив"
                  r"|elon musk|маск|zelensk|зеленськ|зеленск|mirziyoyev|мирзиёев|marcelo rebelo|cristiano ronaldo|ronaldo|роналду|дуров|durov|президент|president|primeiro-ministro|прем'єр|премьер", re.I)
ATALHOS = re.compile(r"(^|//)(t\.me|telegram\.me|wa\.me|api\.whatsapp|chat\.whatsapp|bit\.ly|tinyurl|cutt\.ly|is\.gd|rb\.gy|linktr\.ee|shorturl|clck\.ru|goo\.su)", re.I)
PLATAFORMA = re.compile(r"play\.google|apple\.com|onelink|go\.link|app\.link|appmetrica|adj\.st|appsflyer|branch\.io|facebook\.com|instagram\.com|fb\.me|tiktok", re.I)
TLD_SUSPEITO = re.compile(r"\.(xyz|top|click|online|site|space|fun|icu|buzz|live|life|shop|store|sbs|cfd|bond|monster|cyou|rest|quest|lol|pw|tk|ml|ga|cf|gq|cam|win|vip|pro)$", re.I)


def categoria(ad):
    """A categoria com mais palavras diferentes no anúncio; a categoria da página na Meta soma 2. Empate: a de cima na lista."""
    txt = " ".join(str(ad.get(k) or "") for k in ("texto", "titulo", "descricao", "cta", "dominio", "pagina"))
    pts = {k: len({m.group(0).lower() for m in r.finditer(txt)}) for k, _, r in _CAT_RE}
    pc = (ad.get("pagina_cat") or "").lower()
    for k, p in CAT_PAGINA:
        if re.search(p, pc):
            pts[k] = pts.get(k, 0) + 2
            break
    ordem = [k for k, _, _ in CATEGORIAS]
    best = max(ordem, key=lambda k: (pts.get(k, 0), -ordem.index(k)))
    return best if pts.get(best) else "outros"


def risco(ad, cat):
    """Pontos e porquês. 0 = limpo, 1-2 = atenção, 3+ = provável burla. Só sinais que se veem no anúncio."""
    txt = " ".join(str(ad.get(k) or "") for k in ("texto", "titulo", "descricao"))
    dom, link, gostos = ad.get("dominio") or "", ad.get("link") or "", ad.get("gostos")
    pts, porque = 0, []
    dinheiro = cat in ("cripto", "credito", "apostas", "emprego")
    if PROMESSA.search(txt):
        pts += 2 if dinheiro else 1
        porque.append("Promete ganhos/garantias")
    if ISCA.search(txt) and dinheiro:
        pts += 2
        porque.append("Usa media ou famosos como isco")
    if ATALHOS.search(link) or ATALHOS.search(dom):
        pts += 1
        porque.append("Leva para Telegram/WhatsApp ou link encurtado")
    if dom and TLD_SUSPEITO.search(dom):
        pts += 1
        porque.append(f"Domínio barato ({dom})")
    if gostos is not None and gostos < 300 and dinheiro:
        pts += 1
        porque.append(f"Página pequena ({gostos} gostos) a falar de dinheiro")
    if cat in ("cripto", "apostas") and dom and ad.get("pagina") and not PLATAFORMA.search(dom):
        a = re.sub(r"[^a-z0-9]", "", (ad["pagina"] or "").lower())[:6]
        if len(a) >= 4 and a not in re.sub(r"[^a-z0-9]", "", dom.lower()):
            pts += 1
            porque.append("Nome da página não bate com o site")
    if cat == "apostas":
        pts += 1
        porque.append("Apostas: zona cinzenta")
    if ad.get("finserv"):
        porque.append("A Meta marcou como serviço financeiro")
    return pts, porque


# ---------------------------------------------------------------- base de dados

def db():
    c = sqlite3.connect(DB, timeout=20)
    c.execute("PRAGMA journal_mode=WAL")
    c.executescript("""
    CREATE TABLE IF NOT EXISTS ads (
      id TEXT, pais TEXT, pagina_id TEXT, pagina TEXT, pagina_cat TEXT, gostos INTEGER, foto_pagina TEXT,
      inicio INTEGER, fim INTEGER, ativo INTEGER, copias INTEGER, grupo TEXT,
      texto TEXT, titulo TEXT, descricao TEXT, link TEXT, dominio TEXT, cta TEXT, formato TEXT, imagem TEXT,
      plataformas TEXT, finserv INTEGER, categoria TEXT, risco INTEGER, risco_porque TEXT,
      pesquisas TEXT, melhor_pos INTEGER, vezes INTEGER, primeiro_visto TEXT, ultimo_visto TEXT,
      PRIMARY KEY (id, pais));
    CREATE INDEX IF NOT EXISTS ads_pais_inicio ON ads(pais, inicio);
    CREATE TABLE IF NOT EXISTS voltas (em TEXT, pais TEXT, pesquisa TEXT, n INTEGER, novos INTEGER, erro TEXT);
    """)
    return c


def guardar(c, pais, pesquisa, ads):
    novos, quando = 0, agora()
    for pos, a in enumerate(ads, 1):
        cat = categoria(a)
        pts, porque = risco(a, cat)
        old = c.execute("SELECT pesquisas, melhor_pos, vezes FROM ads WHERE id=? AND pais=?", (a["id"], pais)).fetchone()
        if old:
            pq = set(filter(None, (old[0] or "").split("|"))) | {pesquisa}
            c.execute("""UPDATE ads SET ativo=?, fim=?, copias=?, gostos=?, categoria=?, risco=?, risco_porque=?, pesquisas=?,
                         melhor_pos=?, vezes=vezes+1, ultimo_visto=?, imagem=COALESCE(?, imagem) WHERE id=? AND pais=?""",
                      (a["ativo"], a["fim"], a["copias"], a["gostos"], cat, pts, json.dumps(porque, ensure_ascii=False),
                       "|".join(sorted(pq)), min(old[1] or 99, pos), quando, a["imagem"], a["id"], pais))
        else:
            novos += 1
            c.execute("INSERT INTO ads VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                      (a["id"], pais, a["pagina_id"], a["pagina"], a["pagina_cat"], a["gostos"], a["foto_pagina"],
                       a["inicio"], a["fim"], a["ativo"], a["copias"], a["grupo"], a["texto"], a["titulo"], a["descricao"],
                       a["link"], a["dominio"], a["cta"], a["formato"], a["imagem"], a["plataformas"], a["finserv"],
                       cat, pts, json.dumps(porque, ensure_ascii=False), pesquisa, pos, 1, quando, quando))
    c.commit()
    return novos


# ---------------------------------------------------------------- ler a Biblioteca de Anúncios

def url_de(pais, q):
    # q vazio = todos os anúncios do país: a Meta aceita a pesquisa por "" (aspas) e devolve-os todos
    qq = quote(q) if q else "%22%22"
    return ("https://www.facebook.com/ads/library/?active_status=active&ad_type=all"
            f"&country={pais}&is_targeted_country=false&media_type=all&q={qq}&search_type=keyword_unordered"
            "&sort_data[direction]=desc&sort_data[mode]=total_impressions")


def _dominio(link, caption):
    try:
        net = urlparse(link).netloc.lower()
        if "facebook.com" in net and "u=" in link:   # l.facebook.com/l.php?u=...
            from urllib.parse import parse_qs, unquote
            net = urlparse(unquote(parse_qs(urlparse(link).query).get("u", [""])[0])).netloc.lower()
    except Exception:
        net = ""
    net = net or (caption or "").lower().strip()
    return re.sub(r"^(www\d?|m|l)\.", "", net)[:80]


def extrair(html):
    """Cada anúncio vem num objeto JSON que começa em {"ad_archive_id": dentro do HTML; lê-o inteiro, pela ordem da página."""
    dec, out, i = json.JSONDecoder(), {}, 0
    while True:
        i = html.find('{"ad_archive_id"', i)
        if i < 0:
            break
        try:
            o, fim = dec.raw_decode(html, i)
        except ValueError:
            i += 16
            continue
        i = fim
        if o["ad_archive_id"] in out:
            continue
        s = o.get("snapshot") or {}
        card = (s.get("cards") or [{}])[0] or {}
        link = s.get("link_url") or card.get("link_url") or ""
        imgs = s.get("images") or []
        vids = s.get("videos") or []
        img = (imgs[0].get("resized_image_url") if imgs else None) or card.get("resized_image_url") \
            or (vids[0].get("video_preview_image_url") if vids else None) or card.get("video_preview_image_url")
        corpo = (s.get("body") or {}).get("text") if isinstance(s.get("body"), dict) else s.get("body")
        corpo = corpo or card.get("body") or ""
        if "{{product." in corpo:   # anúncio de catálogo: o texto é um molde
            corpo = card.get("body") or card.get("title") or corpo
        fs = ((o.get("regional_regulation_data") or {}).get("finserv") or {})
        out[o["ad_archive_id"]] = {
            "id": o["ad_archive_id"], "pagina_id": o.get("page_id"), "pagina": s.get("page_name") or o.get("page_name"),
            "pagina_cat": ", ".join(s.get("page_categories") or []), "gostos": s.get("page_like_count"),
            "foto_pagina": s.get("page_profile_picture_url"), "inicio": o.get("start_date"), "fim": o.get("end_date"),
            "ativo": 1 if o.get("is_active") else 0, "copias": o.get("collation_count") or 1, "grupo": str(o.get("collation_id") or ""),
            "texto": (corpo or "")[:1500], "titulo": (s.get("title") or card.get("title") or "")[:200],
            "descricao": (s.get("link_description") or card.get("link_description") or "")[:400], "link": link[:500],
            "dominio": _dominio(link, s.get("caption") or card.get("caption")), "cta": s.get("cta_text") or card.get("cta_text") or "",
            "formato": s.get("display_format") or "", "imagem": img,
            "plataformas": ",".join(o.get("publisher_platform") or []), "finserv": 1 if fs.get("is_deemed_finserv") else 0,
        }
    return list(out.values())


def abrir_browser():
    from selenium import webdriver
    o = webdriver.ChromeOptions()
    o.add_argument("--headless=new")
    o.add_argument("--window-size=1400,1000")
    o.add_argument("--lang=en-US")
    return webdriver.Chrome(options=o)


def ler(browser, pais, q):
    browser.get(url_de(pais, q))
    time.sleep(7)
    html = browser.page_source
    if '"xfb_ad_library_is_captcha_required":true' in html or "/checkpoint/" in browser.current_url:
        raise RuntimeError("A Meta pediu captcha: paramos esta volta, sem contornar.")
    return extrair(html)


def volta(paises=None):
    C, c = cfg(), db()
    alvo = [p for p, x in C["paises"].items() if x.get("ligado", True) and (not paises or p in paises)]
    estado(fase="a ler", paises=alvo, erro="")
    b = abrir_browser()
    total = novos = 0
    try:
        for pais in alvo:
            for q in C["paises"][pais]["pesquisas"]:
                estado(fase=f"{pais} · {q or 'todos'}")
                erro, n, nv = "", 0, 0
                try:
                    ads = ler(b, pais, q)
                    n, nv = len(ads), guardar(c, pais, q or "(todos)", ads)
                except RuntimeError as e:
                    erro = str(e)
                except Exception as e:
                    erro = f"{type(e).__name__}: {e}"[:300]
                c.execute("INSERT INTO voltas VALUES (?,?,?,?,?,?)", (agora(), pais, q or "(todos)", n, nv, erro))
                c.commit()
                total, novos = total + n, novos + nv
                print(f"{agora()} {pais} {q or '(todos)'!r}: {n} anúncios, {nv} novos {erro}", flush=True)
                if "captcha" in erro:
                    raise RuntimeError(erro)
                time.sleep(C.get("pausa_s", 25))
    finally:
        try:
            b.quit()
        except Exception:
            pass
    estado(fase="parado", ultima_volta=agora(), lidos=total, novos=novos)
    return total, novos


def correr():
    while True:
        try:
            volta()
        except Exception as e:
            estado(fase="parado", erro=f"{type(e).__name__}: {e}"[:300])
            traceback.print_exc()
        h = cfg().get("intervalo_h", 6)
        estado(proxima=time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(time.time() + h * 3600)))
        time.sleep(h * 3600)


# ---------------------------------------------------------------- tendências (o Hub usa a mesma conta)

def tendencias(c, pais=None, min_dias=2, max_dias=14, so_ativos=True):
    """Agrupa os anúncios por anunciante+site e dá nota 0-100 a cada grupo. Quente = começou há ≤ max_dias e aguenta ≥ min_dias."""
    agora_s = time.time()
    q = "SELECT * FROM ads WHERE inicio >= ?" + (" AND pais=?" if pais else "") + (" AND ativo=1" if so_ativos else "")
    args = [agora_s - max_dias * DIA] + ([pais] if pais else [])
    c.row_factory = sqlite3.Row
    grupos = {}
    for r in c.execute(q, args):
        r = dict(r)
        dias = (agora_s - (r["inicio"] or agora_s)) / DIA
        if dias < min_dias:
            continue
        r["dias"] = round(dias, 1)
        k = (r["pais"], r["pagina_id"] or r["pagina"], r["dominio"] or "")
        grupos.setdefault(k, []).append(r)
    out = []
    for (p, _, dom), ads in grupos.items():
        ads.sort(key=lambda a: (a["melhor_pos"] or 99, -(a["copias"] or 1)))
        top = ads[0]
        dias = max(a["dias"] for a in ads)
        copias = sum(a["copias"] or 1 for a in ads)
        pos = min(a["melhor_pos"] or 31 for a in ads)
        pq = set()
        for a in ads:
            pq |= set(filter(None, (a["pesquisas"] or "").split("|")))
        nota = (min(dias, 14) / 14 * 30 + min(math.log2(1 + copias) * 6, 25) + max(0, 31 - pos) / 30 * 25
                + min(len(ads) - 1, 5) * 2 + min(len(pq) - 1, 5))
        cats = {}
        for a in ads:
            cats[a["categoria"]] = cats.get(a["categoria"], 0) + 1
        rk = max(a["risco"] or 0 for a in ads)
        porque = []
        for a in ads:
            for x in json.loads(a["risco_porque"] or "[]"):
                if x not in porque:
                    porque.append(x)
        out.append({
            "pais": p, "pagina": top["pagina"], "pagina_id": top["pagina_id"], "foto_pagina": top["foto_pagina"],
            "gostos": top["gostos"], "pagina_cat": top["pagina_cat"], "dominio": dom, "link": top["link"],
            "categoria": max(cats, key=cats.get), "anuncios": len(ads), "copias": copias, "dias": dias,
            "inicio": min(a["inicio"] for a in ads), "melhor_pos": pos, "pesquisas": sorted(pq),
            "nota": round(min(nota, 100)), "risco": rk, "nivel": "burla" if rk >= 3 else "atencao" if rk >= 1 else "limpo",
            "risco_porque": porque[:5], "visto": max(a["ultimo_visto"] for a in ads),
            "exemplo": {k: top[k] for k in ("id", "texto", "titulo", "descricao", "cta", "imagem", "formato", "plataformas")},
            "ids": [a["id"] for a in ads[:8]],
        })
    out.sort(key=lambda g: -g["nota"])
    return out


def top(pais=None):
    for g in tendencias(db(), pais)[:30]:
        print(f"{g['nota']:3d} {g['pais']} {CAT_NOME.get(g['categoria'], g['categoria']):22} {g['dias']:5.1f}d x{g['copias']:<3} "
              f"#{g['melhor_pos']:<2} {g['nivel']:8} {(g['pagina'] or '')[:28]:28} {g['dominio']}")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "uma"
    arg = [x.upper() for x in sys.argv[2:]]
    if cmd == "uma":
        print(volta(arg or None))
    elif cmd == "correr":
        correr()
    elif cmd == "reclassificar":   # depois de mudar as palavras das categorias ou do risco
        c = db()
        c.row_factory = sqlite3.Row
        for r in [dict(x) for x in c.execute("SELECT * FROM ads")]:
            cat = categoria(r)
            pts, porque = risco(r, cat)
            c.execute("UPDATE ads SET categoria=?, risco=?, risco_porque=? WHERE id=? AND pais=?",
                      (cat, pts, json.dumps(porque, ensure_ascii=False), r["id"], r["pais"]))
        c.commit()
        print("ok")
    elif cmd == "top":
        top(arg[0] if arg else None)
    else:
        print(__doc__)
