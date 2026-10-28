"""Radar: a nota, o gasto estimado e o juntar de fontes, sem rede."""
from app.radar import Radar


def test_merge_junta_o_mesmo_negocio_e_tira_redes_do_site():
    negs = Radar._merge([
        {"nome": "Escola de Condução Rota do Sol Leiria", "site": "", "fonte": "OpenStreetMap", "telefone": "244 000 000"},
        {"nome": "Rota do Sol", "site": "rotadosol.pt", "fonte": "lista"},
        {"nome": "LeiriDrive", "site": "https://www.facebook.com/LeiriDrive/", "fonte": "OpenStreetMap"},
    ], "Leiria")
    assert len(negs) == 2
    rota = next(n for n in negs if "Rota" in n["nome"])
    assert rota["site"] == "https://rotadosol.pt" and rota["telefone"] and set(rota["fontes"]) == {"OpenStreetMap", "lista"}
    leiri = next(n for n in negs if n["nome"] == "LeiriDrive")
    assert leiri["site"] == "" and "facebook" in leiri["facebook"]


def test_sem_site_e_quente_e_cada_problema_tem_solucao():
    n = {"nome": "Gato Preto", "site": "", "telefone": "910"}
    Radar._score(n)
    assert n["nota_site"] == 0 and n["nivel"] == "quente"
    assert all(p["solucao"] for p in n["problemas"])
    assert n["gasto"] == {"min": 0, "max": 0, "porque": [], "anuncios": False}


def test_gasto_soma_plataforma_agencia_e_anuncios():
    n = {"nome": "X", "site": "https://x.pt", "audit": {"plataforma": "Wix", "agencia": "LinkDUO", "google_ads": True, "telemovel": True,
                                                         "https": True, "segundos": 1.0}}
    Radar._score(n)
    g = n["gasto"]
    assert (g["min"], g["max"]) == (17 + 30 + 150, 36 + 120 + 600) and g["anuncios"] and len(g["porque"]) == 3
    assert 0 < n["nota_site"] < 100


def test_seguimento_guarda_por_nome_e_sobrevive_a_varreduras(tmp_path, monkeypatch):
    import app.radar as r
    monkeypatch.setattr(r, "DIR", tmp_path)
    R = r.Radar()
    scan = {"id": "a" * 12, "ramo": "escolas", "local": "Leiria", "raio": 20, "at": 0, "fim": 1,
            "negocios": [{"id": "n1", "nome": "Escola de Condução Esteves", "site": ""}]}
    R._save(scan)
    R.set_lead(scan["id"], "n1", "contactado", "ligar sexta", "Marco")
    scan2 = {**scan, "id": "b" * 12, "negocios": [{"id": "x9", "nome": "Esteves", "site": ""}]}
    R._save(scan2)
    assert R.get(scan2["id"])["negocios"][0]["lead"]["estado"] == "contactado"
    R.set_lead(scan2["id"], "x9", "por_contactar", "", "Marco")
    assert R.leads() == []


def test_ficha_marca_redes_e_custo_sem_rede():
    import httpx
    from app import radar_ficha as F
    page = """<html><head><meta name="theme-color" content="#c8102e"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Poppins:wght@400">
      <style>body{color:#222222;background:#fafafa} .btn{background:#c8102e} a{color:#0a4d8c} .x{color:#cf2e2e}</style></head>
      <body><a class="logo" href="/"><img src="/img/logo.png" alt="Logo"></a><h1>Tire a carta connosco</h1>
      <a href="https://www.instagram.com/escolaxpto/">ig</a><a href="https://www.facebook.com/sharer/sharer.php">x</a>
      <a href="/precos">p</a><a href="contactos.html">c</a>
      <footer>Desenvolvido por <a href="https://agenciax.pt">Agência X</a></footer></body></html>"""
    base = httpx.URL("https://escolax.pt/")
    cores = [c["hex"] for c in F._palette(page, "#c8102e")]
    assert cores[0] == "#c8102e" and "#0a4d8c" in cores and "#cf2e2e" not in cores  # a paleta do WordPress não é a marca
    assert F._fonts(page, page) == ["Poppins"]
    assert F._logo(page, base)["logo"] == "https://escolax.pt/img/logo.png"
    assert F._credit(page, base) == {"nome": "Agência X", "site": "https://agenciax.pt/"}
    assert F._pages(page, "escolax.pt") == 3
    assert F._followers("Escola X (@escolaxpto) • 1,2 mil seguidores, 300 publicações") == {"seguidores": 1200, "publicacoes": 300}
    n = {"nome": "X", "site": "https://escolax.pt", "audit": {"plataforma": "WordPress", "agencia": "Agência X"}, "gasto": {"min": 35, "max": 150}}
    k = F.custo(n, {"paginas": 25, "desde": 2016})
    assert (k["min"], k["max"]) == (1040, 3250) and k["anos"] >= 10 and k["ate_hoje"][0] > k["min"]
    assert F.custo({"nome": "Y", "site": ""}) is None


def test_ofertas_tem_sempre_preco_e_porque():
    from app import radar_ficha as F
    n = {"nome": "Gato Preto", "site": "", "nota_site": 0, "problemas": [], "gasto": {}}
    of = F.ofertas(n, {"redes": {}, "google": {"nao_tem": True}})
    ids = [o["id"] for o in of]
    assert ids[0] == "site" and "redes" in ids and "google" in ids and "acompanhamento" in ids
    assert all(o["porque"] and (o["unico"] or o["mensal"]) for o in of)


def test_qualquer_ramo_e_veredicto():
    from app.radar import _filtros, veredicto
    assert _filtros("clínicas dentárias") == ['nwr["amenity"="dentist"]']  # a mais exata ganha à «clínica»
    assert _filtros("restaurantes de sushi") == ['nwr["amenity"="restaurant"]["cuisine"~"sushi|japanese"]']
    assert any('"name"~' in f for f in _filtros("empresas de software"))  # o que não tem tipo procura-se também pelo nome
    assert _filtros("xy") == []
    sim = veredicto({"nome": "A", "site": "", "telefone": "912345678", "oportunidade": 70})
    assert sim["v"] == "sim" and sim["passo"] == "Ligar" and sim["porque"]
    nao = veredicto({"nome": "B", "site": "https://b.pt", "nota_site": 90, "audit": {}, "oportunidade": 10})
    assert nao["v"] == "nao" and "difícil" in nao["porque"][0] or "bom" in " ".join(nao["porque"])
