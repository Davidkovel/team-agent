"""Vinted Radar: anúncios novos -> SQLite -> preço de mercado por comparáveis -> alerta Telegram.

python radar.py semear      # base de preços: 3 páginas (~290 anúncios) por nicho
python radar.py ciclo       # uma volta pelos nichos (anúncios novos + alertas)
python radar.py correr      # ciclo a cada N minutos, para sempre (VPS)
python radar.py mercado     # mostra a mediana por nicho/marca/estado

Segredos só no ambiente (.env): TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID. Sem eles, os alertas vão para o ecrã.
"""
import json
import os
import re
import random
import sqlite3
import statistics
import sys
import time
import traceback
import urllib.parse
import urllib.request

from fonte import abrir_browser, ler_anuncios, ler_vendedor

RAIZ = os.path.dirname(os.path.abspath(__file__))
CFG = json.load(open(os.path.join(RAIZ, "config", "nichos.json"), encoding="utf-8"))
DB = os.path.join(RAIZ, "radar.db")


def carregar_env():
    p = os.path.join(RAIZ, ".env")
    if os.path.exists(p):
        for linha in open(p, encoding="utf-8"):
            if "=" in linha and not linha.startswith("#"):
                k, v = linha.strip().split("=", 1)
                os.environ.setdefault(k, v)


def ligar():
    c = sqlite3.connect(DB)
    c.execute("""CREATE TABLE IF NOT EXISTS anuncios (
        id INTEGER PRIMARY KEY, nicho TEXT, titulo TEXT, marca TEXT, tamanho TEXT, estado TEXT,
        preco REAL, foto TEXT, link TEXT, visto_em TEXT, origem TEXT, alertado INTEGER DEFAULT 0)""")
    cols = {x[1] for x in c.execute("PRAGMA table_info(anuncios)")}
    for col in ("mediana REAL", "lucro REAL", "comparaveis INTEGER", "alertado_em TEXT", "vendedor TEXT", "estrelas REAL", "avaliacoes INTEGER"):
        if col.split()[0] not in cols:
            c.execute(f"ALTER TABLE anuncios ADD COLUMN {col}")
    # 13 nov (Marco: «procuras no Vinted produtos iguais a esse e ficas a avaliar o preço que as pessoas estão a pôr»): para
    # cada produto que o Hub pede, uma pesquisa no Vinted pelo mesmo produto; os anúncios encontrados ficam aqui.
    c.execute("""CREATE TABLE IF NOT EXISTS copias (alvo INTEGER, id INTEGER, titulo TEXT, marca TEXT, tamanho TEXT, estado TEXT,
        preco REAL, foto TEXT, link TEXT, visto_em TEXT, PRIMARY KEY (alvo, id))""")
    c.execute("CREATE TABLE IF NOT EXISTS comparado (alvo INTEGER PRIMARY KEY, pesquisa TEXT, em TEXT, n INTEGER)")
    return c


def ativos():
    return [n for n in CFG["nichos"] if n.get("ativo", True)]


def estado(**kw):
    """Estado para o Hub (status.json): ciclo, nichos, erro."""
    p = os.path.join(RAIZ, "status.json")
    try:
        st = json.load(open(p, encoding="utf-8"))
    except Exception:
        st = {}
    st.update(kw, pid=os.getpid(), em=time.strftime("%Y-%m-%d %H:%M:%S"))
    json.dump(st, open(p, "w", encoding="utf-8"), ensure_ascii=False)


def guardar(c, nicho, itens, origem):
    novos = []
    for a in itens:
        if a["preco"] is None:
            continue
        cur = c.execute("INSERT OR IGNORE INTO anuncios (id,nicho,titulo,marca,tamanho,estado,preco,foto,link,visto_em,origem)"
                        " VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                        (a["id"], nicho, a["titulo"], a["marca"], a["tamanho"], a["estado"], a["preco"],
                         a["foto"], a["link"], a["visto_em"], origem))
        if cur.rowcount:
            novos.append(a)
    c.commit()
    return novos


TIPOS = {  # tipo de artigo a partir do título (várias línguas); sem tipo = sem alerta
    "colete": ["colete", "gilet", "vest ", "smanicato", "chaleco", "bodywarmer", "sans manche"],
    "polar": ["fleece", "polar", "polaire", "pile ", "synchilla", "retro x", "retro-x"],
    "camisola": ["hoodie", "sweat", "felpa", "sudadera", "moletom", "camisola", "pull", "maglione", "jersey", "jumper",
                 "knit", "cardigan", "quarter zip", "1/4 zip", "half zip"],
    "casaco": ["casaco", "jacket", "giacca", "giubbotto", "giacchetto", "piumino", "veste", "chaqueta", "cazadora",
               "anorak", "parka", "doudoune", "blouson", "windbreaker", "corta-vento", "cortavientos", "coupe-vent",
               "nuptse", "puffer", "shell", "manteau", "cappotto", "abrigo", "overshirt", "jacke"],
    "t-shirt": ["t-shirt", "tshirt", " tee ", "maglietta", "camiseta", "t shirt"],
    "polo": ["polo shirt", "camisa polo", "polo manica", "polo homme"],
    "camisa": ["camisa", "shirt", "camicia", "chemise"],
    "calcas": ["calças", "pants", "pantaloni", "pantalon", "trousers", "jeans", "cargo", "calções", "shorts", "bermuda"],
    "tenis": ["xt-6", "xt6", "xt-4", "acs", "sneaker", "ténis", "tenis", "scarpe", "zapatillas", "baskets", "shoes"],
    "acessorio": ["boné", " cap ", "cappello", "gorra", "casquette", "beanie", "gorro", " bag ", "mala", "borsa", "bolso", " sac "],
}


def tipo(titulo):
    t = " " + titulo.lower() + " "
    for nome, palavras in TIPOS.items():
        if any(p in t for p in palavras):
            return nome
    return None


TECH_REJEITAR = ["capa", "case", "cover", "funda", "coque", "película", "pelicula", "protector", "vidro temperado", "carregador",
    "charger", "cabo", "cable", "caixa vazia", "só caixa", "so caixa", "solo scatola", "empty box", "box only", "icloud", "bloqueado",
    "blocked", "locked", "peças", "pecas", "parts", "ricambi", "piezas", "avariado", "não liga", "nao liga", "partido", "cracked",
    "broken", "rotto", "roto", "cassé", "faceid", "face id não", "sem face", "custodia", "sleeve", "housse", "adaptador", "adapter",
    "sem ssd", "sans ssd", "senza ssd", "sin ssd", "no ssd", "lote", "boîte vide", "boite vide", "caja vacía", "caja vacia",
    "scatola vuota", "cx vazia", "pour pièces", "pour pieces", "hors service", "écran cassé", "dummy", "réplica", "replica", "fake",
    "skin", "sticker", "suporte", "stand", "comando só", "manette seule", "jogo", "game only", "solo juego"]


def modelo_tech(titulo):
    """Chave de comparação para tecnologia: modelo + armazenamento (ex. «iphone 13 pro|128gb», «macbook air m1|256gb»,
    «airpods pro 2|», «ps5 digital|», «switch oled|», «apple watch series 8|45mm»). None quando não se percebe o modelo."""
    import re
    t = titulo.lower().replace("-", " ")
    gb = re.search(r"(\d{2,4})\s?(?:gb|go)|(\d)\s?(?:tb|to)", t)
    gb = (gb.group(1) + "gb") if gb and gb.group(1) else (gb.group(2) + "tb" if gb else "")
    m = re.search(r"iphone\s?(\d{1,2}|xs|xr|x|se)(\s?(pro max|pro|plus|max|mini))?", t)
    if m:
        return f"iphone {m.group(1)}{(' ' + m.group(3)) if m.group(3) else ''}|{gb}"
    m = re.search(r"macbook\s?(air|pro)?.*?\b(m[1-4])(\s?(pro|max))?\b", t)
    if m:
        return f"macbook {m.group(1) or ''} {m.group(2)}{(' ' + m.group(4)) if m.group(4) else ''}|{gb}".replace("  ", " ")
    m = re.search(r"mac\s?book\s?(air|pro)?.*?\b(20[01]\d|2020)\b", t)
    if m:
        return f"macbook {m.group(1) or ''} {m.group(2)}|{gb}".replace("  ", " ")
    m = re.search(r"ipad\s?(air|pro|mini)?", t)
    if m and gb:
        return f"ipad {m.group(1) or ''}|{gb}".replace(" |", "|")
    m = re.search(r"airpods?\s?(pro|max)?\s?(\d)?", t)
    if m:
        return f"airpods {m.group(1) or ''} {m.group(2) or ''}".strip().replace("  ", " ") + "|"
    m = re.search(r"\b(?:ps5|playstation\s?5)\b", t)
    if m:
        return "ps5 " + ("digital" if re.search(r"digital|digitale|sem leitor|sans lecteur|senza lettore", t) else "standard") + ("|pro" if " pro" in t else "|")
    m = re.search(r"\bswitch\b\s?(oled|lite|2)?", t)
    if m and "nintendo" in t:
        return f"switch {m.group(1) or 'v1'}|"
    m = re.search(r"apple\s?watch\s?(?:series\s?)?(\d{1,2}|ultra\s?\d?|se)", t)
    if m:
        mm = re.search(r"(\d{2})\s?mm", t)
        return f"apple watch {m.group(1).replace(' ', '')}|{mm.group(1) + 'mm' if mm else ''}"
    return None


def nicho_cfg(nicho):
    return next((n for n in CFG["nichos"] if n["nome"] == nicho), {})


def chave(nicho, titulo):
    return modelo_tech(titulo) if nicho_cfg(nicho).get("tech") else tipo(titulo)


def grupo_estado(estado):
    return "novo" if estado.startswith("Novo") else "usado"


def mercado(c, nicho, marca, estado, tp):
    """Mediana dos comparáveis: mesmo nicho, marca, tipo de artigo e grupo de estado. None se poucos."""
    if nicho_cfg(nicho).get("tech"):   # na tecnologia o modelo diz tudo; a marca vem às vezes vazia
        linhas = c.execute("SELECT preco, estado, titulo FROM anuncios WHERE nicho=?", (nicho,)).fetchall()
    else:
        linhas = c.execute("SELECT preco, estado, titulo FROM anuncios WHERE nicho=? AND lower(marca)=lower(?)",
                           (nicho, marca)).fetchall()
    precos = [p for p, e, t in linhas if grupo_estado(e) == grupo_estado(estado) and chave(nicho, t) == tp
              and not (nicho_cfg(nicho).get("tech") and any(w in t.lower() for w in TECH_REJEITAR))]
    if len(precos) < CFG["min_comparaveis"]:
        return None, len(precos)
    return statistics.median(precos), precos


def avaliar(c, nicho, a):
    """Devolve dict com o cálculo se for oportunidade, senão None."""
    t = a["titulo"].lower()
    if a["estado"] not in CFG["estados_aceites"]:
        return None
    if any(p in t for p in CFG["palavras_rejeitar"]):
        return None
    ncfg = nicho_cfg(nicho)
    if a["preco"] > ncfg.get("preco_max", CFG["preco_max"]):
        return None
    if ncfg.get("tech") and any(w in t for w in TECH_REJEITAR):
        return None
    tech_min = ncfg.get("tech") and CFG.get("tech_min_pct_do_mercado", 0.4)
    if ncfg.get("tamanhos") and a["tamanho"] not in ncfg["tamanhos"]:
        return None
    # mesmo título e preço em 3+ anúncios (vários tamanhos) = loja de cópias/revenda em série
    rep = c.execute("SELECT count(*) FROM anuncios WHERE preco=? AND lower(substr(titulo,1,20))=lower(substr(?,1,20))",
                    (a["preco"], a["titulo"])).fetchone()[0]
    if rep >= 3:
        return None
    tp = chave(nicho, a["titulo"])
    if tp is None:
        return None
    med, precos = mercado(c, nicho, a["marca"], a["estado"], tp)
    if med is None:
        return None
    n = len(precos)
    # «bem abaixo do mercado»: abaixo de X% da mediana e entre os mais baratos dos comparáveis
    if a["preco"] > med * CFG["max_pct_do_mercado"]:
        return None
    if tech_min and a["preco"] < med * tech_min:   # telemóvel/portátil a menos de 40% do mercado = burla, avariado ou bloqueado
        return None
    if sum(p < a["preco"] for p in precos) / n > CFG["percentil_max"]:
        return None
    prot = CFG["protecao_comprador"]
    custo = a["preco"] + prot["fixo"] + a["preco"] * prot["pct"] + ncfg.get("portes", CFG["portes_compra_eur"])   # portes da categoria
    lucro = med - custo
    if lucro < CFG["margem_min_eur"] or lucro / custo < CFG["margem_min_pct"]:
        return None
    return {"mediana": med, "comparaveis": n, "custo": custo, "lucro": lucro, "tipo": tp}


def telegram(a, nicho, r):
    texto = (f"🔥 {a['marca']} — {a['titulo'][:80]}\n"
             f"Preço: {a['preco']:.2f} € (com taxa e portes {r['custo']:.2f} €)\n"
             f"Mercado: {r['mediana']:.0f} € (mediana de {r['comparaveis']} anúncios {r['tipo']} {a['marca']})\n"
             f"Lucro esperado: +{r['lucro']:.0f} €\n"
             f"{a['tamanho']} · {a['estado']} · {nicho}\n{a['link']}")
    enviar(texto, a.get("foto"))


def enviar(texto, foto=None):
    tok, chat = os.environ.get("TELEGRAM_BOT_TOKEN"), os.environ.get("TELEGRAM_CHAT_ID")
    if not tok or not chat:
        print("[ALERTA]\n" + texto + "\n")
        return
    if foto:
        metodo, dados = "sendPhoto", {"chat_id": chat, "photo": foto, "caption": texto[:1000]}
    else:
        metodo, dados = "sendMessage", {"chat_id": chat, "text": texto}
    urllib.request.urlopen(f"https://api.telegram.org/bot{tok}/{metodo}",
                           data=urllib.parse.urlencode(dados).encode(), timeout=20)


def pausa():
    time.sleep(random.uniform(*CFG["pausa_entre_paginas_s"]))


def semear(paginas=3, so_faltam=False, b=None, c=None):
    proprio = b is None
    c, b = c or ligar(), b or abrir_browser()
    try:
        for n in ativos():
            if so_faltam and c.execute("SELECT count(*) FROM anuncios WHERE nicho=?", (n["nome"],)).fetchone()[0] >= 150:
                continue
            estado(fase=f"A juntar preços de mercado: {n['nome']}")
            total = 0
            for p in range(1, (paginas + 3 if n.get("tech") else paginas) + 1):
                total += len(guardar(c, n["nome"], ler_anuncios(b, n["pesquisa"], CFG["pais"], preco_max=n.get("preco_max", CFG["preco_max"]),
                                                                 pagina=p, ordem="relevance"), "semente"))
                pausa()
            print(f"{n['nome']}: +{total}")
    finally:
        if proprio:
            b.quit()


def ciclo(b, c, primeira=False):
    alertas = 0
    for n in ativos():
        estado(fase=f"A ver {n['nome']}")
        novos = guardar(c, n["nome"], ler_anuncios(b, n["pesquisa"], CFG["pais"], preco_max=n.get("preco_max", CFG["preco_max"])), "novo")
        if not primeira:  # na primeira volta tudo parece «novo»: só guarda
            for a in novos:
                r = avaliar(c, n["nome"], a)
                if r:
                    telegram(a, n["nome"], r)
                    c.execute("UPDATE anuncios SET alertado=1, mediana=?, lucro=?, comparaveis=?, alertado_em=? WHERE id=?",
                              (r["mediana"], r["lucro"], r["comparaveis"], time.strftime("%Y-%m-%d %H:%M:%S"), a["id"]))
                    try:   # quem vende: estrelas e avaliações, para o Hub mostrar (12 nov, Marco: «os feedbacks, as avaliações»)
                        v = ler_vendedor(b, a["link"])
                        c.execute("UPDATE anuncios SET vendedor=?, estrelas=?, avaliacoes=? WHERE id=?",
                                  (v["vendedor"], v["estrelas"], v["avaliacoes"], a["id"]))
                    except Exception as e:
                        print(f"vendedor de {a['id']}: {str(e)[:120]}")
                    alertas += 1
            c.commit()
        print(f"{time.strftime('%H:%M:%S')} {n['nome']}: {len(novos)} novos")
        pausa()
    return alertas


FILA = os.path.join(RAIZ, "comparar.json")


def comparar(b, c, maximo=4):
    """Faz as pesquisas pedidas pelo Hub (comparar.json: [{"id", "pesquisa"}]), no máximo `maximo` de cada vez, com a mesma
    pausa entre páginas que o resto do radar. Guarda os anúncios iguais em `copias`."""
    try:
        fila = json.load(open(FILA, encoding="utf-8"))
    except Exception:
        return 0
    feitos = 0
    for p in list(fila)[:maximo]:
        estado(fase=f"A comparar: {p['pesquisa']}")
        try:
            itens = ler_anuncios(b, p["pesquisa"], CFG["pais"], n=96, preco_max=5000, ordem="relevance")
        except Exception as e:
            print(f"comparar {p['id']}: {str(e)[:120]}")
            break
        c.execute("DELETE FROM copias WHERE alvo=?", (p["id"],))
        c.executemany("INSERT OR IGNORE INTO copias VALUES (?,?,?,?,?,?,?,?,?,?)",
                      [(p["id"], a["id"], a["titulo"], a["marca"], a["tamanho"], a["estado"], a["preco"], a["foto"], a["link"], a["visto_em"])
                       for a in itens if a["preco"] is not None and a["id"] != p["id"]])
        c.execute("INSERT OR REPLACE INTO comparado VALUES (?,?,?,?)", (p["id"], p["pesquisa"], time.strftime("%Y-%m-%d %H:%M:%S"), len(itens)))
        c.commit()
        feitos += 1
        try:   # tira da fila o que já fez (o Hub pode ter juntado mais entretanto)
            agora = json.load(open(FILA, encoding="utf-8"))
            json.dump([x for x in agora if x["id"] != p["id"]], open(FILA, "w", encoding="utf-8"), ensure_ascii=False)
        except Exception:
            pass
        pausa()
    return feitos


def esperar(b, c, segundos):
    """A espera entre voltas: de 15 em 15 s vê se o Hub pediu comparações (para a ficha não ficar à espera 5 minutos)."""
    fim = time.time() + segundos
    while time.time() < fim:
        try:
            if comparar(b, c):
                estado(fase="À espera do próximo ciclo")
        except Exception as e:
            print(f"comparar: {str(e)[:120]}")
        time.sleep(15)


def correr():
    c, b = ligar(), abrir_browser()
    falhas, primeira = 0, True
    estado(ligado=True, erro="", fase="A arrancar")
    try:
        semear(3, so_faltam=True, b=b, c=c)
    except Exception as e:
        estado(erro=str(e)[:200])
    while True:
        try:
            n = ciclo(b, c, primeira)
            primeira, falhas = False, 0
            estado(fase="À espera do próximo ciclo", ultimo_ciclo=time.strftime("%Y-%m-%d %H:%M:%S"), alertas_ciclo=n, erro="")
        except Exception as e:
            falhas += 1
            estado(erro=str(e)[:200])
            traceback.print_exc()
            if falhas == 3:
                enviar("⚠️ Vinted Radar: o coletor falhou 3 vezes seguidas e está parado à espera. Ver os logs.")
            try:
                b.quit()
            except Exception:
                pass
            b = abrir_browser()
        esperar(b, c, CFG["intervalo_min"] * 60)


def mostrar_mercado():
    c = ligar()
    for nicho, marca, n, mn in c.execute("SELECT nicho, marca, count(*), min(preco) FROM anuncios GROUP BY nicho, lower(marca)"
                                         " HAVING count(*) >= ? ORDER BY nicho, count(*) DESC", (CFG["min_comparaveis"],)):
        for tp in TIPOS:
            for g in ("usado", "novo"):
                med, k = mercado(c, nicho, marca, "Novo" if g == "novo" else "Bom", tp)
                if med:
                    print(f"{nicho} | {marca} | {tp} {g}: mediana {med:.0f} € ({len(k)} anúncios)")


if __name__ == "__main__":
    carregar_env()
    cmd = sys.argv[1] if len(sys.argv) > 1 else "correr"
    if cmd == "semear":
        semear(int(sys.argv[2]) if len(sys.argv) > 2 else 3)
    elif cmd == "ciclo":
        c, b = ligar(), abrir_browser()
        try:
            print("alertas:", ciclo(b, c))
        finally:
            b.quit()
    elif cmd == "reavaliar":  # aplica a regra aos anúncios já guardados (sem rede), para afinar limites
        c = ligar()
        cols = ["id", "nicho", "titulo", "marca", "tamanho", "estado", "preco", "foto", "link"]
        rows = [dict(zip(cols, x)) for x in c.execute(f"SELECT {','.join(cols)} FROM anuncios WHERE origem='novo'")]
        ok = [(a, avaliar(c, a["nicho"], a)) for a in rows]
        ok = [(a, r) for a, r in ok if r]
        for a, r in ok:
            print(f"{a['preco']:>6} € vs {r['mediana']:>4.0f} € +{r['lucro']:.0f} | {a['marca']} | {a['titulo'][:60]}")
        print(f"{len(ok)} de {len(rows)} anúncios novos passariam")
    elif cmd == "mercado":
        mostrar_mercado()
    else:
        correr()
