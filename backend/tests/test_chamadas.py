"""Agente de chamadas em simulação: as 5 personas acabam no estado certo, abertura quente/fria, horário, novas tentativas."""
from datetime import datetime

import pytest

from app import angariacao as A
from app import chamadas as C

CARD = {"key": "escolas|exemplo", "nome": "Escola Exemplo", "local": "Leiria", "ramo_nome": "Escolas de condução",
        "telefones": ["929 197 171"], "emails": ["geral@exemplo.pt"], "site": "https://exemplo.pt", "maps": "",
        "problemas": [{"problema": "Não há marcação de aulas online", "solucao": "Marcações online em 24 h"}],
        "vale": {"v": "sim"}, "nota_site": 40}
# terça 17/11/2026 às 10:00 de Lisboa (dentro do horário) e sábado 21/11 às 11:00 (fora)
TER = datetime(2026, 11, 17, 10, 0, tzinfo=C.LX).timestamp()
SAB = datetime(2026, 11, 21, 11, 0, tzinfo=C.LX).timestamp()


@pytest.fixture(autouse=True)
def estado(tmp_path, monkeypatch):
    monkeypatch.setattr(A, "STATE", tmp_path / "angariacao.json")
    monkeypatch.setattr(A, "lead_card", lambda key: dict(CARD) if key == CARD["key"] else None)
    monkeypatch.setattr(A, "_negocio", lambda card: {})
    A.set_config({"nome": "Marco", "empresa": "AMG"})
    sync = []
    monkeypatch.setattr(C, "_sincronizar", lambda call, card: sync.append(call["analise"]["resultado"]))
    monkeypatch.setattr(C, "pdf_chamada", lambda call, card: tmp_path / "c.pdf")
    return sync


def test_horario():
    assert C.em_horario(TER)
    assert not C.em_horario(SAB)
    assert not C.em_horario(datetime(2026, 11, 17, 13, 0, tzinfo=C.LX).timestamp())  # almoço
    seg = datetime.fromtimestamp(C.proxima_vaga(SAB), C.LX)
    assert (seg.weekday(), seg.hour, seg.minute) == (0, 9, 30)
    tarde = datetime.fromtimestamp(C.proxima_vaga(datetime(2026, 11, 17, 13, 0, tzinfo=C.LX).timestamp()), C.LX)
    assert (tarde.hour, tarde.minute) == (14, 30)


@pytest.mark.parametrize("persona,resultado", [("dono", "REUNIAO"), ("secretaria", "LIGAR_MAIS_TARDE"),
                                               ("email", "LIGAR_MAIS_TARDE"), ("sistema", "NAO_INTERESSADO"),
                                               ("nao", "NAO_CONTACTAR")])
def test_personas(estado, persona, resultado):
    c = C.simular(CARD["key"], persona, TER)
    assert c["estado"] == "SINCRONIZADA"
    assert c["analise"]["resultado"] == resultado and estado[-1] == resultado
    assert [s for _, s in c["log"]] == ["AGENDADA", "A_LIGAR", "ATENDEU", "EM_CONVERSA", "TERMINADA", "A_ANALISAR", "ANALISADA",
                                        "PDF_GERADO", "SINCRONIZADA"]
    assert c["duracao"] <= 240
    assert 3 <= len(c["analise"]["resumo"]) <= 5
    falas = [x for q, x in c["transcricao"] if q == "Cliente"]
    assert all(q in falas for q in c["analise"]["citacoes"])  # citações tal e qual
    if resultado != "NAO_CONTACTAR":
        assert c["analise"]["proximo_ts"] and C.em_horario(c["analise"]["proximo_ts"]) or resultado == "NAO_INTERESSADO"
    assert C.get(c["id"])["estado"] == "SINCRONIZADA"


def test_abertura_fria_e_quente():
    fria = C.simular(CARD["key"], "dono", TER)["transcricao"][0][1]
    assert "Marco" in fria and "AMG" in fria and "marcação de aulas online" in fria and "na página" not in fria
    code = A.code_for(CARD["key"])
    A.edit(lambda d: d["visits"].__setitem__("v1", {"code": code, "ended": True, "ativo_ms": 130000, "scroll": 80, "wa": 0,
                                                     "last": TER - 3600, "secoes": ["topo", "problema", "prova"]}))
    quente = C.simular(CARD["key"], "dono", TER)
    assert "estiveram 2 min 10 s na página" in quente["transcricao"][0][1] and "prova" in quente["transcricao"][0][1]
    assert quente["contexto"]["visitas"] == 1


def test_fora_de_horas_fica_agendada():
    c = C.simular(CARD["key"], "dono", SAB)
    assert c["estado"] == "AGENDADA" and "transcricao" not in c
    assert datetime.fromtimestamp(c["quando"], C.LX).weekday() == 0


def test_novas_tentativas():
    c = C.simular(CARD["key"], "sem_resposta", TER)
    assert c["estado"] == "AGENDADA" and c["quando"] >= TER + 2 * 3600 and C.em_horario(c["quando"])
    for _ in range(2):
        C.transitar(c, "A_LIGAR")
        C.transitar(c, "NAO_ATENDEU")
        C.reagendar(c, c["quando"] + 30)
    assert c["estado"] == "ESGOTADA"
    e = C.nova(CARD["key"], "dono", TER)
    C.transitar(e, "A_LIGAR")
    C.transitar(e, "ERRO")
    C.reagendar(e, TER)
    assert e["estado"] == "AGENDADA" and e["quando"] == TER + 300
    with pytest.raises(ValueError):
        C.transitar(e, "TERMINADA")


def test_html_chamada_uma_pagina():
    c = C.simular(CARD["key"], "dono", TER)
    h = C.html_chamada(c, CARD)
    assert "Reunião marcada" in h and "Escola Exemplo" in h
    for proibida in ("advogado", "RGPD", "consentimento", "versão"):
        assert proibida.lower() not in h.lower()
