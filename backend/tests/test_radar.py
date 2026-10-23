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
