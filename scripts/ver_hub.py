"""See a page of the Hub without anybody's browser: a headless Chrome driven through the DevTools protocol.

It opens the page, runs the steps in order and prints what the page did wrong on the way (requests the Hub refused,
errors of the page's own scripts). Made for trying a change on a test Hub (CLAUDE.md, «Testar uma mudança no Hub»):
it clicks, hovers, emulates a phone, takes pictures and measures what a page costs the PC.

    python scripts/ver_hub.py passos.json [--size 1390x900] [--scale 1] [--profile <empty folder>]

passos.json is a list of steps, one object each:
    {"nav": "http://127.0.0.1:8010/#login=<token>&to=/empresa"}   open an address (the token comes from POST /api/auth/auto)
    {"wait": 5}                                                    seconds
    {"js": "document.title"}                                       run it in the page and print what it returns
    {"move": [x, y]}  {"click": [x, y]}  {"wheel": [x, y, dy]}     the pointer
    {"mobile": [393, 852, 2]}                                      from here on a phone: width, height, pixel ratio, touch
    {"shot": "C:/tmp/a.png", "clip": [x, y, width, height]}        a picture (clip: only that piece)
    {"metrics": "nome"}                                            twice with the same name: CPU of the page between the two

A phone needs two steps: sign in at computer size (the #login= address drops ?phone=1), then {"mobile": …} and
{"nav": "http://127.0.0.1:8010/?phone=1#/empresa"}. Needs the `websockets` package (the Hub's own venv has it).
"""
import argparse
import base64
import json
import subprocess
import sys
import tempfile
import time
import urllib.request

from websockets.sync.client import connect

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
PORT = 9333


def main():
    parser = argparse.ArgumentParser(description="Drive a headless Chrome over a page of the Hub.")
    parser.add_argument("steps", help="a .json file with the list of steps")
    parser.add_argument("--size", default="1390x900", help="the window, WIDTHxHEIGHT")
    parser.add_argument("--scale", type=float, default=1, help="pixel ratio of the pictures")
    parser.add_argument("--profile", default="", help="Chrome's own folder for this run (never the person's profile)")
    args = parser.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    with open(args.steps, encoding="utf-8") as f:
        steps = json.load(f)
    width, height = map(int, args.size.split("x"))
    profile = args.profile or tempfile.mkdtemp(prefix="ver-hub-")
    chrome = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={PORT}", "--remote-allow-origins=*", f"--user-data-dir={profile}",
                               f"--window-size={width},{height}", "--hide-scrollbars", "--no-first-run", "about:blank"],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        run(steps, width, height, args.scale)
    finally:
        chrome.terminate()


def page_socket() -> str:
    for _ in range(60):
        try:
            pages = json.loads(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json", timeout=1).read())
            target = next((p for p in pages if p.get("type") == "page"), None)
            if target:
                return target["webSocketDebuggerUrl"]
        except OSError:
            pass
        time.sleep(.25)
    sys.exit("Chrome did not start")


def run(steps, width, height, scale):
    sent = 0
    marks: dict[str, tuple[float, dict]] = {}
    with connect(page_socket(), max_size=None) as ws:
        def call(method, **params):
            nonlocal sent
            sent += 1
            ws.send(json.dumps({"id": sent, "method": method, "params": params}))
            while True:
                msg = json.loads(ws.recv())
                if msg.get("method") == "Network.responseReceived" and msg["params"]["response"]["status"] >= 400:
                    print("HTTP", msg["params"]["response"]["status"], msg["params"]["response"]["url"][:140])
                if msg.get("method") == "Runtime.exceptionThrown":
                    print("PAGE ERROR:", str(msg["params"]["exceptionDetails"].get("exception", {}).get("description", ""))[:400])
                if msg.get("id") == sent:
                    return msg.get("result", msg)

        for domain in ("Page", "Runtime", "Network", "Performance"):
            call(f"{domain}.enable")
        call("Emulation.setDeviceMetricsOverride", width=width, height=height, deviceScaleFactor=scale, mobile=False)
        for step in steps:
            if "nav" in step:
                call("Page.navigate", url=step["nav"])
            elif "wait" in step:
                time.sleep(step["wait"])
            elif "js" in step:
                answer = call("Runtime.evaluate", expression=step["js"], awaitPromise=True, returnByValue=True)
                if answer.get("exceptionDetails"):
                    print("JS ERROR:", json.dumps(answer["exceptionDetails"])[:600])
                elif answer.get("result", {}).get("value") is not None:
                    print("js:", json.dumps(answer["result"]["value"], ensure_ascii=False)[:1500])
            elif "move" in step:
                call("Input.dispatchMouseEvent", type="mouseMoved", x=step["move"][0], y=step["move"][1])
            elif "click" in step:
                x, y = step["click"]
                for kind in ("mouseMoved", "mousePressed", "mouseReleased"):
                    call("Input.dispatchMouseEvent", type=kind, x=x, y=y, button="left", clickCount=1)
            elif "wheel" in step:
                x, y, dy = step["wheel"]
                call("Input.dispatchMouseEvent", type="mouseWheel", x=x, y=y, deltaX=0, deltaY=dy)
            elif "mobile" in step:
                w, h, ratio = step["mobile"]
                call("Emulation.setDeviceMetricsOverride", width=w, height=h, deviceScaleFactor=ratio, mobile=True)
                call("Emulation.setTouchEmulationEnabled", enabled=True)
            elif "metrics" in step:  # the second time a name comes: how much of one core the page took in between
                now, figures = time.time(), {m["name"]: m["value"] for m in call("Performance.getMetrics")["metrics"]}
                if step["metrics"] in marks:
                    then, before = marks[step["metrics"]]
                    took = lambda key: 100 * (figures[key] - before[key]) / (now - then)
                    print(f"CPU {step['metrics']}: {took('TaskDuration'):.2f}% of one core ({took('ScriptDuration'):.2f}% in scripts) over {now - then:.0f} s")
                marks[step["metrics"]] = (now, figures)
            elif "shot" in step:
                clip = step.get("clip")
                area = {"clip": {"x": clip[0], "y": clip[1], "width": clip[2], "height": clip[3], "scale": 1}} if clip else {}
                with open(step["shot"], "wb") as f:
                    f.write(base64.b64decode(call("Page.captureScreenshot", format="png", **area)["data"]))
                print("shot:", step["shot"])


if __name__ == "__main__":
    main()
