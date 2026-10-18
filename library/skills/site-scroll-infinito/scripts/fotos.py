"""Screenshots de um site de scroll em vários pontos do scroll, no PC e no telemóvel, com os erros da consola.

    pip install websocket-client
    python -I fotos.py http://127.0.0.1:8765/ pasta-de-saida [--pontos 0,6,12,...] [--so desk|tel] [--quieto]

- O site tem de estar servido por HTTP (dentro da pasta do site: python -m http.server 8765).
- --pontos: percentagens do caminho até ao fim da página (sem contar a cópia da volta). Por omissão 0 a 100 de 5 em 5.
- --quieto: liga prefers-reduced-motion (tem de ficar tudo legível e parado).
- Escreve desk-030.png, tel-030.png..., folha-desk.jpg / folha-tel.jpg (todas numa imagem, se houver ffmpeg)
  e relatorio.txt (erros da consola, pedidos falhados, peso da página).
Usa o Chrome instalado (Windows, macOS ou Linux), sem janela, pelo protocolo DevTools.
"""
import argparse
import base64
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

try:
    import websocket  # websocket-client
except ImportError:
    sys.exit("Falta o websocket-client: pip install websocket-client")

sys.stdout.reconfigure(encoding="utf-8")
CHROMES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "google-chrome", "chromium", "chromium-browser",
]
APARELHOS = {
    "desk": {"width": 1440, "height": 900, "deviceScaleFactor": 1, "mobile": False},
    "tel": {"width": 390, "height": 844, "deviceScaleFactor": 2, "mobile": True},
}


def chrome() -> str:
    for c in CHROMES:
        if os.path.isfile(c) or shutil.which(c):
            return shutil.which(c) or c
    sys.exit("Não encontrei o Chrome.")


def porta_livre() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Pagina:
    def __init__(self, ws_url: str):
        self.ws = websocket.create_connection(ws_url, timeout=60, suppress_origin=True)
        self.n = 0
        self.eventos = []

    def cdp(self, metodo: str, **params):
        self.n += 1
        self.ws.send(json.dumps({"id": self.n, "method": metodo, "params": params}))
        while True:
            m = json.loads(self.ws.recv())
            if m.get("id") == self.n:
                if "error" in m:
                    raise RuntimeError(f"{metodo}: {m['error']}")
                return m.get("result", {})
            self.eventos.append(m)

    def js(self, expr: str):
        r = self.cdp("Runtime.evaluate", expression=expr, returnByValue=True, awaitPromise=True)
        return r.get("result", {}).get("value")

    def espera(self, s: float):
        fim = time.time() + s
        self.ws.settimeout(0.2)
        while time.time() < fim:
            try:
                self.eventos.append(json.loads(self.ws.recv()))
            except websocket.WebSocketTimeoutException:
                pass
        self.ws.settimeout(60)


def fotos(url: str, saida: Path, pontos: list, so: str, quieto: bool) -> None:
    saida.mkdir(parents=True, exist_ok=True)
    porta = porta_livre()
    perfil = tempfile.mkdtemp(prefix="fotos-scroll-")
    p = subprocess.Popen([chrome(), "--headless=new", f"--remote-debugging-port={porta}", "--hide-scrollbars",
                          "--no-first-run", "--no-default-browser-check", f"--user-data-dir={perfil}",
                          "--window-size=1440,900", "about:blank"],
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    relatorio = []
    try:
        alvo = None
        for _ in range(50):
            try:
                alvo = next(t for t in json.load(urllib.request.urlopen(f"http://127.0.0.1:{porta}/json"))
                            if t.get("type") == "page")
                break
            except Exception:
                time.sleep(0.2)
        if not alvo:
            sys.exit("O Chrome não abriu a porta de depuração.")
        pg = Pagina(alvo["webSocketDebuggerUrl"])
        for dominio in ("Page", "Runtime", "Log", "Network"):
            pg.cdp(f"{dominio}.enable")
        if quieto:
            pg.cdp("Emulation.setEmulatedMedia", features=[{"name": "prefers-reduced-motion", "value": "reduce"}])
        for nome, ap in APARELHOS.items():
            if so and so != nome:
                continue
            pg.cdp("Emulation.setDeviceMetricsOverride", **ap)
            pg.cdp("Emulation.setTouchEmulationEnabled", enabled=ap["mobile"])
            pg.eventos.clear()
            pg.cdp("Page.navigate", url=url)
            pg.espera(4.0)
            fim = pg.js("(() => { const c = document.querySelector('.copia'); "
                        "return c ? c.offsetTop : document.documentElement.scrollHeight - innerHeight; })()") or 0
            ficheiros = []
            for pc in pontos:
                y = round(fim * pc / 100)
                pg.js(f"window.scrollTo({{top: {y}, behavior: 'instant'}})")
                pg.espera(1.3)
                img = pg.cdp("Page.captureScreenshot", format="png")["data"]
                f = saida / f"{nome}-{pc:03d}.png"
                f.write_bytes(base64.b64decode(img))
                ficheiros.append(f)
            peso = pg.js("(() => { let t = 0; for (const e of performance.getEntriesByType('resource')) "
                         "t += e.transferSize || e.encodedBodySize || 0; return t; })()") or 0
            erros = []
            for ev in pg.eventos:
                m, prm = ev.get("method"), ev.get("params", {})
                if m == "Runtime.exceptionThrown":
                    d = prm.get("exceptionDetails", {})
                    erros.append("EXCEÇÃO " + (d.get("exception", {}).get("description") or d.get("text", "")))
                elif m == "Runtime.consoleAPICalled" and prm.get("type") in ("error", "warning"):
                    erros.append(prm["type"].upper() + " " + " ".join(str(a.get("value", a.get("description", "")))
                                                                     for a in prm.get("args", [])))
                elif m == "Log.entryAdded" and prm.get("entry", {}).get("level") in ("error", "warning"):
                    e = prm["entry"]
                    erros.append(f"{e['level'].upper()} {e.get('text', '')} {e.get('url', '')}")
                elif m == "Network.loadingFailed" and not prm.get("canceled"):
                    erros.append(f"PEDIDO FALHOU {prm.get('errorText')}")
            relatorio.append(f"[{nome}] {ap['width']}x{ap['height']} · página {fim} px até ao fim · "
                             f"descarregado {peso / 1e6:.1f} MB · {len(erros)} erros/avisos")
            relatorio += [f"  {e}" for e in dict.fromkeys(erros)]
            if shutil.which("ffmpeg") and ficheiros:
                larg = 480 if nome == "desk" else 240
                cols = 5 if nome == "desk" else 7
                lista = saida / f"_{nome}.txt"
                lista.write_text("".join(f"file '{f.as_posix()}'\n" for f in ficheiros), encoding="utf-8")
                linhas = -(-len(ficheiros) // cols)
                subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(lista),
                                "-vf", f"scale={larg}:-1,tile={cols}x{linhas}:padding=6:color=white",
                                "-frames:v", "1", str(saida / f"folha-{nome}.jpg")], check=False)
                lista.unlink(missing_ok=True)
        pg.ws.close()
    finally:
        p.terminate()
        try:
            p.wait(5)
        except subprocess.TimeoutExpired:
            p.kill()
        shutil.rmtree(perfil, ignore_errors=True)
    (saida / "relatorio.txt").write_text("\n".join(relatorio) + "\n", encoding="utf-8")
    print("\n".join(relatorio))
    print(f"Fotos em {saida}")


if __name__ == "__main__":
    a = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    a.add_argument("url")
    a.add_argument("saida")
    a.add_argument("--pontos", default=",".join(str(i) for i in range(0, 101, 5)))
    a.add_argument("--so", choices=["desk", "tel"])
    a.add_argument("--quieto", action="store_true")
    o = a.parse_args()
    fotos(o.url, Path(o.saida), [int(x) for x in o.pontos.split(",") if x.strip()], o.so, o.quieto)
