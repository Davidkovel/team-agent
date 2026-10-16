# Screenshots de verificação (Windows, Chrome headless)

Servir a pasta do site: `python -m http.server 8765` (dentro da pasta).

Um ecrã num ponto do scroll não sai de `--screenshot` (fica sempre no topo). Duas formas:

1. **Página inteira, telemóvel e desktop**: uma página de teste ao lado do site, que põe o site num
   `<iframe>` e faz scroll lá dentro antes de capturar não funciona com `--screenshot`; em vez disso
   usar a janela alta: `--window-size=1440,6000` mostra os primeiros 6000 px, mas as secções com
   `100vh` ficam com 6000 px. Serve só para ver o topo.
2. **Pontos do scroll (o certo)**: o protocolo DevTools. Script Python sem dependências externas
   além de `websocket-client` (`pip install websocket-client`):

```python
import json, subprocess, time, urllib.request, websocket, base64
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
p = subprocess.Popen([CHROME, "--headless=new", "--remote-debugging-port=9333", "--window-size=1440,900",
                      "--hide-scrollbars", "--user-data-dir=%TEMP%\\shots-profile", "about:blank"])
time.sleep(2)
ws_url = json.load(urllib.request.urlopen("http://127.0.0.1:9333/json"))[0]["webSocketDebuggerUrl"]
ws = websocket.create_connection(ws_url); n = 0
def cdp(method, **params):
    global n; n += 1; ws.send(json.dumps({"id": n, "method": method, "params": params}))
    while True:
        m = json.loads(ws.recv())
        if m.get("id") == n: return m.get("result", {})
cdp("Emulation.setDeviceMetricsOverride", width=390, height=844, deviceScaleFactor=2, mobile=True)  # telemóvel
cdp("Page.navigate", url="http://127.0.0.1:8765/"); time.sleep(5)
for i, y in enumerate([0, 900, 1800, 2700]):
    cdp("Runtime.evaluate", expression=f"scrollTo(0,{y})"); time.sleep(1.2)
    open(f"shot-{i}.png", "wb").write(base64.b64decode(cdp("Page.captureScreenshot")["data"]))
cdp("Runtime.evaluate", expression="JSON.stringify(performance.getEntriesByType('navigation')[0])")
p.kill()
```

Ver também os erros da consola: `cdp("Runtime.enable")` e ler as mensagens
`Runtime.exceptionThrown` / `Runtime.consoleAPICalled` que chegam pelo websocket.
