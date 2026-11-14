"""Angariação: nota, temperatura, alerta do fim da visita, regras dos emails e o registo das visitas (sem rede nem Radar real)."""
import time

import pytest

from app import angariacao as A


@pytest.fixture(autouse=True)
def estado(tmp_path, monkeypatch):
    monkeypatch.setattr(A, "STATE", tmp_path / "angariacao.json")


CARD = {"key": "escolas|exemplo", "nome": "Escola Exemplo", "local": "Leiria", "ramo_nome": "Escolas de condução",
        "telefones": ["929 197 171"], "emails": ["geral@exemplo.pt"], "site": "https://exemplo.pt", "maps": "",
        "problemas": [{"problema": "Não há marcação de aulas online", "solucao": "Marcações online em 24 h"}],
        "vale": {"v": "sim"}, "nota_site": 40}


def test_temperatura():
    assert A.temperatura(0, 0, 0, 0) == "frio"
    assert A.temperatura(1, 25, 30, 0) == "morno"
    assert A.temperatura(1, 10, 55, 0) == "morno"
    assert A.temperatura(1, 10, 10, 1) == "quente"
    assert A.temperatura(1, 125, 10, 0) == "quente"
    assert A.temperatura(3, 10, 10, 0) == "quente"
    assert A.temperatura(1, 61, 80, 0) == "quente"


def test_nota():
    assert A.nota(CARD, {"decisores": [{"nome": "x"}], "nota": 4.5, "opinioes": 120}) == 8.5
    assert A.nota({**CARD, "telefones": [], "emails": []}, {}) == 0.0
    assert A.nota({**CARD, "vale": {"v": "nao"}, "problemas": [], "nota_site": 90, "telefones": ["244 000 000"], "emails": []}, {}) == 0.0


def test_email_cumpre_as_regras():
    cfg = {"oferta": "marcações online e atendimento automático", "nome": "Marco", "empresa": "AMG", "whatsapp": "+351900000000"}
    m = A.email(CARD, cfg, "https://go.x.pt/go?r=AG-0001")
    assert m["lint"] == [] and m["para"] == "geral@exemplo.pt" and len(m["assunto"]) <= 60
    assert "https://go.x.pt/go?r=AG-0001" in m["texto"] and "marcação de aulas online" in m["texto"]
    assert A.lint("ASSUNTO A GRITAR", "Olá — tudo bem? espero que esteja bem", "http://l") == [
        "assunto em maiúsculas", "travessão ou « - » a separar frases", "frase proibida: «espero que esteja bem»", "falta o link pessoal"]


def test_alerta_no_formato_do_prompt(monkeypatch):
    monkeypatch.setattr(A, "_negocio", lambda card: {"nicho": "Escola de condução"})
    visit = {"code": "AG-0040", "variant": "A", "started": time.mktime((2026, 11, 13, 8, 0, 0, 0, 0, -1)), "ativo_ms": 44000, "scroll": 100,
             "wa": 0, "secoes": ["topo", "problema", "como-funciona", "perguntas", "contacto"]}
    t = {"visitas": 1, "segundos": 44, "scroll": 100, "wa": 0, "temperatura": "morno"}
    txt = A.render_alert(CARD, {"nome": "Fábio", "empresa": "SOUZA", "oferta": "Pomos serralheiros a trabalhar convosco"}, visit, t, "http://hub")
    linhas = txt.split("\n")
    assert linhas[0] == "🌤 ESCOLA EXEMPLO (Leiria)"
    assert linhas[1] == "📞 +351929197171"
    assert linhas[2] == "AG-0040 · landing A · abriu às 08:00"
    assert linhas[3] == "✉️ geral@exemplo.pt"
    assert "⏱ Nesta visita: 44 s · viu 100% da página · WhatsApp: não clicou" in linhas
    assert "Viu: topo, o problema, como funciona, perguntas, contacto." in linhas
    assert "📊 Total da empresa: 1 visita · 44 s no site · 0 cliques no WhatsApp" in linhas
    assert "🗣 O que dizer na chamada" in linhas and linhas[-1] == "http://hub/#/crm"
    assert any(x.startswith("Bom dia, fala o Fábio, da SOUZA.") and "44 s na página" in x for x in linhas) and "Na SOUZA, " in txt


def test_visita_registada_e_fechada(monkeypatch):
    monkeypatch.setattr(A, "lead_card", lambda key: CARD)
    code = A.code_for("escolas|exemplo")
    assert code == "AG-0001" and A.code_for("escolas|exemplo") == "AG-0001"
    ua = "Mozilla/5.0 (iPhone)"
    assert not A.track({"visit_id": "v1", "lead_id": code, "ev": "start"}, "WhatsApp/2.0")   # pré-visualização: não conta
    assert A.track({"visit_id": "v1", "lead_id": code, "ev": "start", "t_ms_ativo": 0}, ua)
    A.edit(lambda d: d["visits"]["v1"].__setitem__("started", time.time() - 60))
    assert A.track({"visit_id": "v1", "lead_id": code, "ev": "section", "t_ms_ativo": 40000, "scroll_max": 100, "secoes": ["topo", "contacto"], "wa": 1}, ua)
    assert A.track({"visit_id": "v1", "lead_id": code, "ev": "end", "t_ms_ativo": 41000, "scroll_max": 100}, ua)
    assert not A.track({"visit_id": "v1", "lead_id": code, "ev": "heartbeat"}, ua)          # já fechou
    prontas = A.fechar_visitas()
    assert [v["id"] for v in prontas] == ["v1"] and A.fechar_visitas() == []                   # um alerta só
    t = A.totais(code)
    assert t["visitas"] == 1 and t["wa"] == 1 and t["temperatura"] == "quente"
    assert not A.track({"visit_id": "v2", "lead_id": "AG-9999", "ev": "start"}, ua)           # código que não existe


def test_visita_sem_fim_fecha_ao_fim_de_30_min():
    A.edit(lambda d: d["codes"].__setitem__("k", "AG-0007"))
    assert A.track({"visit_id": "v9", "lead_id": "AG-0007", "ev": "start"}, "Mozilla/5.0")
    A.edit(lambda d: d["visits"]["v9"].update(last=time.time() - 31 * 60, ativo_ms=3000))
    assert A.fechar_visitas() == []                                                               # < 5 s: fecha sem alerta
    assert A._load()["visits"]["v9"]["ended_by"] == "timeout"
