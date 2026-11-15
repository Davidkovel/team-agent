"""Radar: uma pesquisa deixada a meio por um reinício recomeça ao arrancar (as de outro PC e as muito velhas não)."""
import asyncio
import json
import socket
import time

from app import radar as R


def test_retomar(tmp_path, monkeypatch):
    monkeypatch.setattr(R, "DIR", tmp_path)
    host = socket.gethostname()
    base = {"ramo": "tudo", "local": "Leiria", "raio": 5, "fontes": ["x"], "negocios": [{"nome": "a"}], "erro": ""}
    scans = {"aaaaaaaaaaaa": {"at": time.time(), "fim": None},                         # deste PC, sem marca: recomeça
             "bbbbbbbbbbbb": {"at": time.time(), "fim": None, "maquina": "outro-pc"},  # de outro PC: não se mexe
             "cccccccccccc": {"at": time.time() - 5 * 86400, "fim": None},            # velha: fecha com o aviso
             "dddddddddddd": {"at": time.time(), "fim": time.time()}}                  # acabou: não se mexe
    for sid, extra in scans.items():
        (tmp_path / f"{sid}.json").write_text(json.dumps({"id": sid, **base, **extra}))
    corridas = []

    async def run(self, scan, lista):
        corridas.append((scan["id"], scan["negocios"], lista))

    monkeypatch.setattr(R.Radar, "_run", run)
    r = R.Radar()

    async def go():
        ids = r.retomar_interrompidas()
        await asyncio.sleep(0)
        return ids
    assert asyncio.run(go()) == ["aaaaaaaaaaaa"]
    assert corridas == [("aaaaaaaaaaaa", [], "")]
    a = json.loads((tmp_path / "aaaaaaaaaaaa.json").read_text())
    assert a["maquina"] == host and a["fim"] is None
    c = json.loads((tmp_path / "cccccccccccc.json").read_text())
    assert c["fim"] and "interrompida" in c["erro"]
    assert json.loads((tmp_path / "bbbbbbbbbbbb.json").read_text())["fim"] is None
