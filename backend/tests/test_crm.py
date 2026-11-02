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


def test_lead_a_mao_sem_radar(tmp_path, monkeypatch):
    R, c, scan = _setup(tmp_path, monkeypatch)
    lead = c.create({"nome": "Padaria Nova", "segmento": "Padarias", "valor": "900", "contacto": {"nome": "Rui", "telefone": "934567890", "email": "rui@padaria.pt"}}, "David")
    b = next(x for x in c.board()["leads"] if x["key"] == lead["key"])
    assert b["manual"] and b["stage"] == "novo" and b["ramo_nome"] == "Padarias" and b["proxima"]
    assert b["telefones"] == ["934567890"] and b["emails"] == ["rui@padaria.pt"] and b["valor"] == 900
    # a Pesquisa e o Marketing não rebentam sem pesquisa do Radar
    assert "à mão" in c.agent(lead["key"], "pesquisa", "David")["atividades"][-1]["texto"]
    assert c.agent(lead["key"], "marketing", "David")["rascunho"]["texto"]
    try:
        c.create({"nome": "padaria nova"}, "David")
        raise AssertionError("repetido")
    except ValueError as e:
        assert "Já há" in str(e)
    # o Radar lista-o sem se queixar e pode sair
    assert any(x["nome"] == "Padaria Nova" for x in R.leads())
    c.remove(lead["key"])
    assert c.board()["leads"] == []


def test_previsao_parado_e_funil(tmp_path, monkeypatch):
    R, c, scan = _setup(tmp_path, monkeypatch)
    c.add(scan["id"], "n1", "David")
    key = R.lead_key("t-oficinas", "Oficina Central Auto")
    c.update(key, {"estado": "proposta", "valor": 1000}, "David")
    b = c.board()
    assert b["resumo"]["previsao"] == 700 and b["resumo"]["valor_aberto"] == 1000 and b["leads"][0]["parado"] == 0
    # 10 dias sem ninguém fazer nada: parado; editar o valor não conta como atividade
    velho = time.time() - 10 * 86400

    def envelhece(l):
        l["hist"] = [[velho, h[1], h[2]] for h in l["hist"]]
        for a in l["atividades"]:
            a["at"] = velho
    R.edit_lead(key, envelhece)
    c.update(key, {"valor": 1200}, "David")
    b = c.board()
    assert b["leads"][0]["parado"] == 10 and b["resumo"]["parados"] == 1
    c.update(key, {"atividade": {"tipo": "chamada", "texto": "Quer pensar"}}, "David")
    assert c.board()["leads"][0]["parado"] == 0
    # quem chegou à proposta passou pelas fases de trás; um perdido fica com o motivo
    c.update(key, {"estado": "nao", "motivo": "Sem orçamento"}, "David")
    f = c.board()["funil"]
    assert [x["n"] for x in f["fases"]] == [1, 1, 1, 1, 1, 0] and f["motivos"] == [("Sem orçamento", 1)]


def test_proxima_acao_feita_e_reuniao(tmp_path, monkeypatch):
    R, c, scan = _setup(tmp_path, monkeypatch)
    c.add(scan["id"], "n1", "David")
    key = R.lead_key("t-oficinas", "Oficina Central Auto")
    assert c.board()["resumo"]["sem_proxima"] == 0
    lead = c.update(key, {"feito": True}, "David")
    assert "proxima" not in lead and lead["atividades"][-1]["tipo"] == "feito" and c.board()["resumo"]["sem_proxima"] == 1
    q = time.time() + 86400
    lead = c.update(key, {"reuniao": {"quando": q, "duracao": 45, "link": "https://zoom.us/j/123"}}, "David")
    assert lead["estado"] == "reuniao" and lead["proxima"]["quando"] == q and lead["reuniao"]["link"] == "https://zoom.us/j/123"
    for mau in ("javascript:alert(1)", "http://zoom.us/j/1"):
        try:
            c.update(key, {"reuniao": {"quando": q, "link": mau}}, "David")
            raise AssertionError(mau)
        except ValueError as e:
            assert "https" in str(e)
    # a reunião aconteceu: sai, e Operações marca o passo seguinte da fase
    lead = c.update(key, {"reuniao": None, "reuniao_fim": True, "atividade": {"tipo": "reuniao", "texto": "Correu bem"}}, "David")
    assert "reuniao" not in lead and lead["proxima"]["texto"] == "Mandar a proposta"


def test_zoom_cria_reuniao_com_as_chaves(tmp_path, monkeypatch):
    R, c, scan = _setup(tmp_path, monkeypatch)
    c.add(scan["id"], "n1", "David")
    key = R.lead_key("t-oficinas", "Oficina Central Auto")
    for k in ("zoom_account_id", "zoom_client_id", "zoom_client_secret"):
        monkeypatch.setattr(c.settings, k, "")
    assert c.board()["zoom_api"] is False
    for k in ("zoom_account_id", "zoom_client_id", "zoom_client_secret"):
        monkeypatch.setattr(c.settings, k, "x")
    pedidos = []

    class Res:
        def __init__(self, d):
            self.d = d

        def raise_for_status(self):
            pass

        def json(self):
            return self.d

    def post(url, **kw):
        pedidos.append((url, kw))
        return Res({"access_token": "tk"} if "oauth" in url else {"join_url": "https://us02web.zoom.us/j/99", "id": 99})
    monkeypatch.setattr(c.httpx, "post", post)
    lead = c.zoom_create(key, time.time() + 3600, 30, "David")
    assert lead["reuniao"]["link"] == "https://us02web.zoom.us/j/99" and lead["reuniao"]["zoom_id"] == 99 and lead["estado"] == "reuniao"
    assert pedidos[1][0].endswith("/users/me/meetings") and pedidos[1][1]["json"]["type"] == 2
    cal = c.ics(key)
    assert "BEGIN:VEVENT" in cal and "us02web.zoom.us" in cal and cal.count("DTSTART:") == 1


def test_folha_nao_corre_formulas(tmp_path, monkeypatch):
    R, c, scan = _setup(tmp_path, monkeypatch)
    c.create({"nome": "=HYPERLINK(1)", "contacto": {"telefone": "+351912345678"}}, "David")
    f = c.folha()
    assert f.startswith("\ufeffEmpresa;") and "'=HYPERLINK(1)" in f and "'+351912345678" in f


def test_feito_de_reuniao_fecha_a_reuniao(tmp_path, monkeypatch):
    _, c, _ = _setup(tmp_path, monkeypatch)
    key = c.create({"nome": "Reunida", "valor": 100}, "David")["key"]
    c.update(key, {"reuniao": {"quando": time.time() + 3600, "duracao": 30, "link": ""}}, "David")
    lead = next(x for x in c.board()["leads"] if x["key"] == key)
    assert lead["reuniao"] and lead["proxima"]["reuniao"]
    c.update(key, {"feito": True}, "David")
    lead = next(x for x in c.board()["leads"] if x["key"] == key)
    assert not lead.get("reuniao") and not lead.get("proxima")
