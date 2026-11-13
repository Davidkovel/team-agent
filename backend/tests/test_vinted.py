"""Vinted Radar: os temas das categorias e a guarda do modo contínuo (sem Selenium nem Chrome: o arranque é fingido)."""
import json
import os
import time

import pytest

from app.routers import vinted


@pytest.fixture
def radar(tmp_path, monkeypatch):
    (tmp_path / "config").mkdir()
    cfg = tmp_path / "config" / "nichos.json"
    cfg.write_text(json.dumps({"intervalo_min": 5, "nichos": [{"nome": "Patagonia", "pesquisa": "patagonia"},
                                                              {"nome": "iPhone", "pesquisa": "iphone", "tech": True}]}), encoding="utf-8")
    monkeypatch.setattr(vinted, "DIR", tmp_path)
    monkeypatch.setattr(vinted, "CFG", cfg)
    monkeypatch.setattr(vinted, "PIDF", tmp_path / "vinted.json")
    monkeypatch.setattr(vinted, "_pronto", lambda: {"selenium": True, "chrome": True})
    arranques = []

    def start(vivo=True):
        arranques.append(time.time())
        vinted._guardar_ficha(pid=os.getpid() if radar.vivo else 2 ** 22 + 12345, arrancou=time.time(), desde="agora")
    monkeypatch.setattr(vinted, "_start", start)
    monkeypatch.setattr(vinted, "_stop", lambda: vinted._guardar_ficha(pid=None))
    radar.vivo, radar.arranques = True, arranques
    return radar


def test_cada_categoria_tem_o_seu_tema():
    assert vinted.grupo_de({"nome": "Patagonia"}) == "Roupa"
    assert vinted.grupo_de({"nome": "iPhone", "tech": True}) == "Tecnologia"
    assert vinted.grupo_de({"nome": "Dyson", "grupo": "Casa", "tech": True}) == "Casa"


def test_sem_continuo_a_guarda_nao_liga_nada(radar):
    vinted.vigiar()
    assert radar.arranques == []


def test_com_continuo_o_coletor_parado_volta_a_ligar(radar):
    vinted._guardar_ficha(continuo=True, ja_correu=True, arrancou=time.time() - 3600, pid=2 ** 22 + 12345)
    vinted.vigiar()
    assert len(radar.arranques) == 1
    f = vinted._ficha()
    assert f["reinicios"] == 1 and f["motivo"] == "tinha parado"
    vinted.vigiar()   # agora está vivo: não mexe
    assert len(radar.arranques) == 1


def test_morrer_tres_vezes_ao_arrancar_faz_a_guarda_esperar_e_dizer_porque(radar, monkeypatch):
    radar.vivo = False
    monkeypatch.setattr(vinted, "_pronto", lambda: {"selenium": False, "chrome": True})
    vinted._guardar_ficha(continuo=True, arrancou=time.time(), pid=2 ** 22 + 12345)
    for _ in range(4):
        vinted.vigiar()
    f = vinted._ficha()
    assert len(radar.arranques) == 2   # à terceira morte cedo deixa de insistir
    assert "Selenium" in f["erro_guarda"] and f["espera_ate"] > time.time()
    vinted.vigiar()
    assert len(radar.arranques) == 2   # à espera


def test_um_coletor_preso_e_reiniciado(radar):
    velho = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(time.time() - 3 * 3600))
    (vinted.DIR / "status.json").write_text(json.dumps({"em": velho}), encoding="utf-8")
    vinted._guardar_ficha(continuo=True, pid=os.getpid(), arrancou=time.time() - 3 * 3600)
    vinted.vigiar()
    assert len(radar.arranques) == 1 and vinted._ficha()["motivo"] == "estava preso"


def test_o_orcamento_diz_o_que_esta_disponivel_e_o_lucro_real():
    c = vinted._contas({"orcamento": {"total": 500, "por_artigo": 200, "por_noite": 300},
                        "compras": [{"id": 1, "custo": 100.0, "lucro_previsto": 40, "vendido": None, "quando": "2020-01-01 00:00:00"},
                                    {"id": 2, "custo": 50.0, "lucro_previsto": 30, "vendido": 95.0, "quando": "2020-01-01 00:00:00"}]})
    assert c["investido"] == 100 and c["disponivel"] == 400   # o que se vendeu volta a estar disponível
    assert c["lucro_real"] == 45 and c["lucro_previsto"] == 40 and c["em_stock"] == 1
    assert vinted._contas({})["disponivel"] is None   # sem orçamento posto: «Sem dados», não zero


def test_o_plano_escolhe_o_maior_lucro_que_cabe():
    contas = vinted._contas({"orcamento": {"total": 300, "por_artigo": 150, "por_noite": 200}})
    alertas = [{"id": 1, "custo": 160, "lucro": 90}, {"id": 2, "custo": 120, "lucro": 60}, {"id": 3, "custo": 70, "lucro": 35},
               {"id": 4, "custo": 30, "lucro": 20}]
    p = vinted._plano(alertas, contas)
    assert p["ids"] == [2, 3] and p["custo"] == 190 and p["lucro"] == 95   # o 1 passa do máximo por artigo, o 4 já não cabe na noite
    assert vinted._plano(alertas, vinted._contas({}))["ids"] == []


def test_o_custo_real_soma_protecao_e_portes():
    assert vinted._custo(100, {"protecao_comprador": {"fixo": 0.7, "pct": 0.05}, "portes_compra_eur": 4.0}) == 109.7


def _db(radar_dir, linhas):
    import sqlite3
    c = sqlite3.connect(radar_dir / "radar.db")
    c.execute("CREATE TABLE anuncios (id INTEGER PRIMARY KEY, nicho TEXT, titulo TEXT, marca TEXT, tamanho TEXT, estado TEXT, preco REAL,"
              " foto TEXT, link TEXT, visto_em TEXT, origem TEXT, alertado INTEGER DEFAULT 0, mediana REAL, lucro REAL, comparaveis INTEGER, alertado_em TEXT)")
    c.executemany("INSERT INTO anuncios (id, nicho, titulo, marca, tamanho, estado, preco, foto, link, visto_em, origem) VALUES (?,?,?,?,?,?,?,?,?,?,?)", linhas)
    c.commit()
    c.close()


class _U:
    username = "mark"


@pytest.fixture
def catalogo(radar, tmp_path, monkeypatch):
    monkeypatch.setattr(vinted, "_CAT", {"chave": None, "itens": [], "mercado": {}})
    linhas = [(i, "Patagonia", f"Casaco {i}", "Patagonia", "M", "Muito bom", float(p), f"http://f/{i}.webp", f"http://v/{i}", f"2026-11-13 10:{i:02d}:00", "novo")
              for i, p in enumerate([40, 42, 45, 50, 50, 55, 60, 12], start=1)]
    _db(tmp_path, linhas)
    return tmp_path


def test_todos_os_produtos_aparecem_com_foto_link_e_preco_de_mercado(catalogo):
    r = vinted.produtos(q="", grupo="", nicho="", marca="", estado="", etapa="", so="", ordem="desconto", pmin=0, pmax=0, offset=0, limit=60, user=_U)
    assert r["total"] == 8 and r["itens"][0]["id"] == 8   # o de 12 € é o maior desconto
    a = r["itens"][0]
    assert a["foto"] and a["link"] and a["ref"] == 47.5 and a["ref_base"] == "marca" and a["desconto"] > 0.7
    assert vinted.produtos(q="casaco 3", grupo="", nicho="", marca="", estado="", etapa="", so="", ordem="recente", pmin=0, pmax=0, offset=0, limit=60, user=_U)["total"] == 1
    assert vinted.produtos(q="", grupo="", nicho="", marca="", estado="", etapa="", so="abaixo", ordem="recente", pmin=0, pmax=0, offset=0, limit=60, user=_U)["total"] == 1


def test_um_produto_anda_pelo_pipeline_ate_ser_vendido(catalogo):
    d = vinted.produto_crm({"id": 8, "etapa": "mira", "nota": "pedir etiqueta"}, _U)
    assert d["item"]["etapa"] == "mira" and d["item"]["nota"] == "pedir etiqueta" and d["historia"][-1]["o"] == "Na mira"
    vinted.produto_crm({"id": 8, "oferta": 10, "etapa": "negociar"}, _U)
    assert [x["id"] for x in vinted.pipeline(_U)["colunas"]["negociar"]] == [8]
    vinted.compra({"id": 8}, _U)
    col = vinted.pipeline(_U)["colunas"]
    assert col["negociar"] == [] and col["comprado"][0]["compra"]["lucro_previsto"] is not None
    vinted.compra({"a_venda": {"id": 8, "valor": 45}}, _U)
    assert vinted.pipeline(_U)["colunas"]["venda"][0]["id"] == 8
    vinted.compra({"vendido": {"id": 8, "valor": 44}}, _U)
    assert vinted.pipeline(_U)["colunas"]["vendido"][0]["id"] == 8
    vinted.produto_crm({"id": 3, "etapa": "descartado"}, _U)
    assert vinted.produtos(q="", grupo="", nicho="", marca="", estado="", etapa="", so="", ordem="recente", pmin=0, pmax=0, offset=0, limit=60, user=_U)["total"] == 7


def test_o_mercado_diz_o_preco_do_meio_de_cada_categoria_e_marca(catalogo):
    m = vinted.mercado(_U)
    c = m["categorias"][0]
    assert c["nicho"] == "Patagonia" and c["n"] == 8 and c["marcas"][0]["marca"] == "Patagonia" and m["abaixo"] == 1


def test_o_valor_vem_dos_iguais_a_venda_no_vinted(catalogo):
    import sqlite3
    assert vinted.pesquisa_de({"titulo": "Veste Carhartt WIP Terrace Jacket vintage Y2K – Taille M", "marca": "Carhartt"}) == "carhartt wip terrace"
    assert vinted.pesquisa_de({"titulo": "Vintage Errea Navy Windbreaker Lightweight Track Top Size M", "marca": "Erreà"}) == "errea track"
    vinted.produtos(q="", grupo="", nicho="", marca="", estado="", etapa="", so="caca", ordem="melhor", pmin=0, pmax=0, offset=0, limit=40, user=_U)
    assert any(x["id"] == 8 for x in vinted._fila())   # o melhor foi para a fila do radar
    c = sqlite3.connect(catalogo / "radar.db")
    c.execute("CREATE TABLE copias (alvo INTEGER, id INTEGER, titulo TEXT, marca TEXT, tamanho TEXT, estado TEXT, preco REAL, foto TEXT, link TEXT, visto_em TEXT, PRIMARY KEY (alvo, id))")
    c.execute("CREATE TABLE comparado (alvo INTEGER PRIMARY KEY, pesquisa TEXT, em TEXT, n INTEGER)")
    precos = [30, 32, 34, 35, 36, 38, 40, 900]   # 900 é um extremo: não conta
    c.executemany("INSERT INTO copias VALUES (8,?,?,?,?,?,?,?,?,?)", [(100 + i, f"Patagonia casaco {i}", "Patagonia", "M", "Bom", p, "", "", "") for i, p in enumerate(precos)]
                  + [(200, "Nike casaco", "Nike", "M", "Bom", 5, "", "", "")])   # outra marca: não conta
    c.execute("INSERT INTO comparado VALUES (8, 'patagonia casaco', '2026-11-13 11:00:00', 9)")
    c.commit(); c.close()
    vinted._CAT["chave"] = None
    d = vinted.produto(8, _U)
    a = d["item"]
    assert a["ref_base"] == "vinted" and a["ref_n"] == 7 and a["ref"] == 35 and len(d["copias"]) == 7
    assert a["porque"][0][1].startswith("No Vinted pedem ~35 €")


def test_tecnologia_compara_o_mesmo_modelo_e_os_portes_contam(radar):
    cfg = {"portes_compra_eur": 4.0, "protecao_comprador": {"fixo": 0.7, "pct": 0.05}, "nichos": [{"nome": "PS5", "portes": 9.0}]}
    d = vinted._custo_det(100, cfg, "PS5")
    assert d == {"preco": 100, "protecao": 5.7, "portes": 9.0, "total": 114.7} and vinted._custo(100, cfg) == 109.7
    assert vinted.modelo_tech("iPhone 13 Pro 128GB") == "iphone 13 pro|128gb"
    assert vinted.pesquisa_de({"titulo": "Apple MacBook Air M1 256GB", "grupo": "Tecnologia"}) == "macbook air m1 256gb"
    a = {"titulo": "iPhone 13 Pro 128GB azul", "grupo": "Tecnologia", "marca": ""}
    copias = [{"titulo": f"iPhone 13 Pro 128GB {i}", "marca": "", "preco": p} for i, p in enumerate([500, 520, 540, 560, 580])]
    copias += [{"titulo": "iPhone 13 Pro 256GB", "marca": "", "preco": 700}, {"titulo": "Capa iPhone 13 Pro 128GB", "marca": "", "preco": 10},
               {"titulo": "iPhone 13 128GB", "marca": "", "preco": 380}]
    v = vinted.valor_vinted(a, copias)
    assert v["n"] == 5 and v["mediana"] == 540


def test_capas_caixas_burlas_e_precos_impossiveis_sao_suspeitos(radar):
    tech = {"grupo": "Tecnologia", "custo": 20.0, "ref": 450.0, "ref_n": 10, "ref_base": "marca", "rapido": 400.0}
    for titulo, preco in [("Coque iPhone 15 Pro", 15), ("iPhone 16 paiement virement", 60), ("iPhone 14 Pro Max", 1)]:
        v = vinted._veredito({**tech, "titulo": titulo, "preco": preco}, [], [])
        assert v["veredito"] == "suspeito" and v["ganho"] is None, titulo
    v = vinted._veredito({**tech, "titulo": "iPhone 13 pro max - Read before buying", "preco": 300, "custo": 320}, [], [])
    assert v["veredito"] == "nao"
