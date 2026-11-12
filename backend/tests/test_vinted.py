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
