"""Sinal na notícia (tradingroom/sinal.py): figures, matching TradingView to Forex Factory, the verdict, the parallel lanes and
one minute watched end to end, without the network."""
import json
import socket
import time

import pytest

from app.tradingroom import sinal


def ev(name, cur="USD", t=100, forecast="0.2%", previous="0.3%", pos=0):
    return {"name": name, "cur": cur, "t": t, "forecast": forecast, "previous": previous, "actual": "", "pos": pos}


def test_figures_like_forex_factory():
    assert sinal.fmt(0.3, "0.2%") == "0.3%" and sinal.fmt(29, "90K") == "29K" and sinal.fmt(1.0, "<1.25%") == "1.00%"
    assert sinal.outcome(0.3, "0.2%") == "ABOVE" and sinal.outcome(0.249, "0.2%") == "INLINE" and sinal.outcome(0.1, "0.2%") == "BELOW"
    assert sinal.outcome(0.1, "") is None
    assert sinal.tv_value(7230, 7110, "7.11M") == pytest.approx(7.23)   # TradingView in K, Forex Factory in M
    assert sinal.same("7.11M", 7110) and sinal.same("0.3%", 0.3) and not sinal.same("0.3%", 0.4) and not sinal.same("", 0.3)


def test_ff_page_parsed_by_minute():
    html = ('x{"id":1,"ebaseId":2,"name":"CPI q/q","currency":"NZD","dateline":500,"actual":"1.1%","x":{"a":"}"}}'
            '{"id":3,"ebaseId":4,"name":"Other","currency":"NZD","dateline":600,"actual":""}')
    assert [o["name"] for o in sinal.ff_at(html, 500)] == ["CPI q/q"]
    assert len(sinal.ff_objects(html)) == 2


def test_tradingview_rows_tied_by_country_and_values():
    when = "1970-01-01T00:01:40.000Z"
    items = [sinal.item(ev("CPI q/q", "NZD", forecast="0.8%", previous="1.5%")), sinal.item(ev("CPI y/y", "NZD", forecast="3.0%", previous="2.7%"))]
    rows = [{"title": "Inflation Rate QoQ", "country": "NZ", "date": when, "previous": 1.5, "forecast": 0.8},
            {"title": "Inflation Rate YoY", "country": "NZ", "date": when, "previous": 2.7, "forecast": 3.0},
            {"title": "Inflation Rate QoQ", "country": "AU", "date": when, "previous": 1.5, "forecast": 0.8}]
    sinal.match(items, rows, 100)
    assert items[0]["tv"] == ("NZ", "inflation rate qoq") and items[1]["tv"] == ("NZ", "inflation rate yoy")
    lone = [sinal.item(ev("Employment Change", "AUD", previous="15.0K"))]
    sinal.match(lone, [{"title": "Building Permits", "country": "AU", "date": when, "previous": 3.0}], 100)
    assert lone[0]["tv"] is None   # nothing sure: Forex Factory alone


def test_groups_and_parts():
    evs = [ev("CPI y/y", pos=3), ev("Core CPI m/m", pos=5), ev("CPI m/m", pos=1), ev("CPI m/m", "CAD", pos=2), ev("Employment Change", "AUD", t=50)]
    g = sinal.groups(evs, 0)
    assert [x["t"] for x in g] == [50, 100]
    assert [(i["cur"], i["name"]) for i in g[1]["items"]] == [("USD", "Core CPI m/m"), ("USD", "CPI m/m"), ("CAD", "CPI m/m"), ("USD", "CPI y/y")]
    assert [(c, its[0]["name"]) for c, its in sinal.parts(g[1]["items"])] == [("USD", "Core CPI m/m"), ("CAD", "CPI m/m")]


def test_verdict_history_surprise_and_rules(monkeypatch):
    def r(s, mv, a, f=0.2):
        return {"surprise": s, "actual": a, "forecast": f, "m": {"GOLD": {"move5": mv}}}
    rel = [r("ABOVE", -0.3, 0.3)] * 6 + [r("ABOVE", -0.8, 0.6)] * 3 + [r("ABOVE", 0.2, 0.3)] * 3 + [r("BELOW", 0.1, 0.1)] * 5 + [r("BELOW", -0.1, 0.1)] * 5
    monkeypatch.setattr(sinal.reaction, "load", lambda key: {"releases": rel} if key == "cpi" else None)
    cpi = sinal.item(ev("Core CPI m/m"))
    cpi["a"] = 0.6
    v = sinal.verdict(cpi, "GOLD", "ABOVE")
    assert (v["side"], v["k"], v["n"], v["strong"], sinal.short(v)) == (-1, 9, 12, True, "SELL")
    assert v["big"] == {"k": 3, "n": 3, "med": 0.8}   # a surprise of +0.4: only the three as big, all down
    assert sinal.short(sinal.verdict(cpi, "GOLD", "BELOW")) == "none"   # 5 of 10: a coin flip
    assert sinal.verdict(cpi, "GOLD", "INLINE")["side"] == 0

    def rule(name, cur, o):
        return sinal.short(sinal.verdict(sinal.item(ev(name, cur)), sinal.assets(cur)[0], o))
    assert rule("Unemployment Claims", "USD", "ABOVE") == "BUY"   # more claims = weaker dollar = gold up
    assert rule("CPI q/q", "NZD", "ABOVE") == "BUY"   # NZD/USD up
    assert rule("CPI m/m", "CAD", "ABOVE") == "SELL"   # USD/CAD down: the loonie is the second currency
    assert rule("Unemployment Rate", "AUD", "ABOVE") == "SELL"


def test_pump_keeps_every_lane_busy():
    sent = []

    class Lane(sinal.Lane):   # an answer 50 ms after each send, over a real socket pair so select() sees it
        def send(self, path):
            self.a, self.b = socket.socketpair()
            self.at = self.sent = time.perf_counter()
            self.fired = False
            sent.append(self.at)

        def fileno(self):
            if time.perf_counter() - self.at >= 0.05 and not self.fired:
                self.b.send(b"x")
                self.fired = True
            return self.a.fileno()

        def read(self):
            self.sent = None
            self.a.close()
            self.b.close()
            self.pool.answered(0.05)
            return b"{}"

    pool = sinal.Pool("x", {}, 0, 0.005)
    pool.lanes = [Lane(pool) for _ in range(8)]
    got = sinal.pump([(pool, lambda: "/")], 0.5)
    assert len(got) >= 20   # one lane alone gives under 10 in 0.5 s with a 50 ms round trip
    assert min(b - a for a, b in zip(sent, sent[1:])) >= 0.004   # never two sends closer than the gap


def test_a_minute_watched_end_to_end(monkeypatch, tmp_path):
    monkeypatch.setattr(sinal, "FILE", tmp_path / "sinal.json")
    monkeypatch.setattr(sinal.reaction, "load", lambda key: None)
    t = int(time.time()) + 1
    date = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(t))
    rows = [{"title": "Core Inflation Rate MoM", "country": "US", "date": date, "previous": 0.3, "forecast": 0.2, "actual": None},
            {"title": "Inflation Rate MoM", "country": "CA", "date": date, "previous": 0.4, "forecast": 0.6, "actual": None}]
    desk = sinal.Desk()
    desk.price = lambda: 4100.0
    monkeypatch.setattr(sinal, "pump", lambda jobs, budget, lanes=None: [(desk.tv, json.dumps({"result": rows}).encode())])
    monkeypatch.setattr(sinal.Watch, "warm", lambda self, desk: sinal.match(self.items, rows, self.t))
    g = sinal.groups([ev("Core CPI m/m", t=t), ev("CPI m/m", "CAD", t=t, forecast="0.6%", previous="0.4%")], 0)[0]
    w = desk.cur = sinal.Watch(g)
    assert w.tick(desk) == 0.0 and w.state == "poll" and desk.alert() is None
    rows[0]["actual"] = 0.3
    w.tick(desk)
    assert w.state == "poll" and list(w.done_at) == ["USD"] and desk.alert()["parts"][0]["cur"] == "USD"
    rows[1]["actual"] = 0.5
    w.tick(desk)
    assert w.state == "done" and desk.news
    usd, cad = w.view(desk)["parts"]
    assert usd["items"][0]["actual"] == "0.3%" and usd["items"][0]["src"] == "TradingView" and usd["verdict"]["GOLD"]["side"] == -1
    assert cad["assets"] == ["USDCAD"] and cad["verdict"]["USDCAD"]["side"] == 1   # CAD CPI below = USD/CAD up
    assert [d["sides"] for d in desk.diary] == [{"GOLD": "SELL", "EURUSD": "SELL", "GER40": "SELL", "GBPUSD": "SELL"}, {"USDCAD": "BUY"}]
    assert desk.pushes[0][0].startswith("SELL ouro · USD Core CPI m/m") and len(desk.alert()["parts"]) == 2


def test_an_ensaio_hides_the_figure_until_it_is_due(monkeypatch):
    t = 1_760_000_000
    date = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(t))
    body = json.dumps({"result": [{"title": "Core Inflation Rate MoM", "country": "US", "date": date, "previous": 0.3, "forecast": 0.2, "actual": 0.3}]}).encode()
    g = sinal.groups([dict(ev("Core CPI m/m", t=t), actual="0.3%")], 0)[0]
    w = sinal.Watch(g, test=True)
    assert 14 < w.t - w.clock() <= 15   # the old release comes 15 s after the press
    desk = sinal.Desk()
    monkeypatch.setattr(sinal, "pump", lambda jobs, budget, lanes=None: [(desk.tv, body)])
    w.shift += 15   # at the minute: the old page already has the figure, the ensaio still waits 1.5 s for it
    w.poll(desk, 0.1)
    assert w.items[0]["a"] is None
    w.shift += 2
    w.poll(desk, 0.1)
    assert w.items[0]["actual"] == "0.3%"
