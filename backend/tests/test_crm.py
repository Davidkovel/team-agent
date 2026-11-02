"""CRM: do Radar ao negócio, sobre o seguimento do Radar, sem rede."""
import time


def _setup(tmp_path, monkeypatch):
    import app.radar as r
    import app.crm as c
    monkeypatch.setattr(r, "DIR", tmp_path)
    R = r.Radar()
    monkeypatch.setattr(r, "RADAR", R)
    monkeypatch.setattr(c, "RADAR", R)
    n = {"id": "n1", "nome": "Oficina Central Auto", "site": "", "telefone": "912345678"}
    R._score(n)
    scan = {"id": "b" * 12, "ramo": "t-oficinas", "ramo_nome": "Oficinas", "local": "Benedita", "raio": 10, "at": 0, "fim": 1, "negocios": [n]}
    R._save(scan)
    return R, c, scan


def test_radar_para_crm_e_pipeline(tmp_path, monkeypatch):
    R, c, scan = _setup(tmp_path, monkeypatch)
    b = c.board()
    assert b["resumo"]["abertos"] == 0 and b["radar"][0]["nome"] == "Oficina Central Auto"
    lead = c.add(scan["id"], "n1", "David")
    assert lead["estado"] == "novo" and lead["proxima"]["por"] == "Operações" and lead["atividades"][0]["tipo"] == "radar"
    key = R.lead_key("t-oficinas", "Oficina Central Auto")
    b = c.board()
    assert b["radar"] == [] and b["leads"][0]["stage"] == "novo" and b["leads"][0]["telefones"] == ["912345678"]
    c.update(key, {"estado": "proposta", "valor": "2400", "atividade": {"tipo": "chamada", "texto": "Interessado"}}, "David")
    b = c.board()
    assert b["resumo"]["valor_aberto"] == 2400 and b["leads"][0]["proxima"]["texto"] == "Perguntar pela proposta"
    c.update(key, {"estado": "fechou"}, "David")
    assert c.board()["resumo"]["taxa"] == 100
    # o Radar continua a ver o mesmo seguimento
    assert R.get(scan["id"])["negocios"][0]["lead"]["estado"] == "fechou"


def test_marketing_escreve_e_espera_aprovacao(tmp_path, monkeypatch):
    R, c, scan = _setup(tmp_path, monkeypatch)
    c.add(scan["id"], "n1", "David")
    key = R.lead_key("t-oficinas", "Oficina Central Auto")
    called = []
    lead = c.agent(key, "marketing", "David")
    assert lead["rascunho"]["estado"] == "por aprovar" and "Olá" in lead["rascunho"]["texto"] and "—" not in lead["rascunho"]["texto"]
    c.agent(key, "pesquisa", "David", lambda s, nid: called.append(nid))
    assert called == ["n1"]
    lead = c.update(key, {"rascunho": "aprovado", "canal": "WhatsApp"}, "David")
    assert lead["rascunho"]["estado"] == "aprovado"
    # uma próxima ação marcada pela pessoa no futuro não é apagada por mudar de fase
    c.update(key, {"proxima": {"texto": "Ligar ao dono", "quando": time.time() + 5 * 86400}}, "David")
    lead = c.update(key, {"estado": "contactado"}, "David")
    assert lead["proxima"]["texto"] == "Ligar ao dono"
