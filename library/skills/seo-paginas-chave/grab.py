import urllib.request, urllib.parse, json, websocket, sys, time
# usage: grab.py URL OUTFILE [js]
url, out = sys.argv[1], sys.argv[2]
js = sys.argv[3] if len(sys.argv) > 3 else "document.body.innerText"
req = urllib.request.Request('http://localhost:9333/json/new?' + url, method='PUT')
t = json.load(urllib.request.urlopen(req, timeout=10))
time.sleep(14)
ws = websocket.create_connection(t['webSocketDebuggerUrl'], suppress_origin=True, timeout=30)
ws.send(json.dumps({'id': 1, 'method': 'Runtime.evaluate', 'params': {'expression': js, 'returnByValue': True}}))
r = json.loads(ws.recv())
open(out, 'w', encoding='utf-8').write(str(r['result']['result'].get('value', r)))
ws.close()
urllib.request.urlopen('http://localhost:9333/json/close/' + t['id'], timeout=10)
