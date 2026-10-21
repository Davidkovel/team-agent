"""Sinal na notícia (tradingroom/sinal.py): figures, the verdict and one release watched end to end, without the network."""
import time

import pytest

from app.tradingroom import sinal


def test_figures_like_forex_factory():
    assert sinal.fmt(0.3, "0.2%") == "0.3%"
    assert sinal.fmt(29, "90K") == "29K"
    assert sinal.outcome(0.3, "0.2%") == "ABOVE"
    assert sinal.outcome(0.249, "0.2%") == "INLINE"   # rounded to the forecast's decimals first
    assert sinal.outcome(0.1, "0.2%") == "BELOW"
    assert sinal.outcome(0.1, "") is None
    assert sinal.tv_value(7230, 7110, "7.11M") == pytest.approx(7.23)   # TradingView in K, Forex Factory in M
    assert sinal.tv_value(29, 133, "133K") == 29


def test_groups_pick_the_figure_that_decides():
    evs = [{"name": n, "t": 100, "forecast": "0.2%", "previous": "0.3%", "actual": "", "impact": "high"} for n in ("CPI y/y", "Core CPI m/m", "CPI m/m")]
    evs.append({"name": "Unemployment Claims", "t": 50, "forecast": "200K", "previous": "199K", "actual": "", "impact": "medium"})
    g = sinal.groups(evs, 0)
    assert [x["t"] for x in g] == [50, 100]
    assert [i["name"] for i in g[1]["items"]] == ["Core CPI m/m", "CPI m/m", "CPI y/y"] and g[1]["impact"] == "high"


def test_verdict_from_history_and_the_dollar_rule(monkeypatch):
    rel = [{"surprise": "ABOVE", "m": {"GOLD": {"move5": -0.3}}}] * 7 + [{"surprise": "ABOVE", "m": {"GOLD": {"move5": 0.2}}}] * 3 \
        + [{"surprise": "BELOW", "m": {"GOLD": {"move5": 0.1}}}] * 5 + [{"surprise": "BELOW", "m": {"GOLD": {"move5": -0.1}}}] * 5
    monkeypatch.setattr(sinal.reaction, "load", lambda key: {"releases": rel} if key == "cpi" else None)
    cpi = sinal.item({"name": "Core CPI m/m", "forecast": "0.2%", "previous": "0.3%"})
    v = sinal.verdict(cpi, "GOLD", "ABOVE")
    assert (v["side"], v["k"], v["n"], v["strong"], sinal.short(v)) == (-1, 7, 10, True, "SELL")
    assert sinal.short(sinal.verdict(cpi, "GOLD", "BELOW")) == "none"   # 5 of 10: a coin flip, no signal
    assert sinal.verdict(cpi, "GOLD", "INLINE")["side"] == 0
    claims = sinal.item({"name": "Unemployment Claims", "forecast": "200K", "previous": "199K"})
    assert sinal.short(sinal.verdict(claims, "GOLD", "ABOVE")) == "BUY"   # more claims = weaker dollar = gold up
    assert sinal.verdict(claims, "GOLD", "ABOVE")["rule"]


def test_a_release_watched_end_to_end(monkeypatch, tmp_path):
    monkeypatch.setattr(sinal, "FILE", tmp_path / "sinal.json")
    monkeypatch.setattr(sinal.reaction, "load", lambda key: None)
    t = int(time.time()) + 1
    out = {"tv": None}
    monkeypatch.setattr(sinal, "tv_figures", lambda feed, at: out["tv"])
    monkeypatch.setattr(sinal, "ff_figures", lambda feed, at: {})
    desk = sinal.Desk.__new__(sinal.Desk)
    desk.__init__()
    desk.price = lambda: 4100.0
    g = sinal.groups([{"name": "Core CPI m/m", "t": t, "forecast": "0.2%", "previous": "0.3%", "actual": "", "impact": "high"},
                      {"name": "CPI m/m", "t": t, "forecast": "0.6%", "previous": "0.4%", "actual": "", "impact": "high"}], 0)[0]
    w = desk.cur = sinal.Watch(g)
    assert w.tick(desk) <= 1 and w.state == "poll"   # 1 s before the minute: already checking
    assert w.tick(desk) == 0.05 and desk.alert() is None
    out["tv"] = {"core inflation rate mom": (0.3, 0.3), "inflation rate mom": (0.5, 0.4)}
    w.last_tv = 0
    w.tick(desk)
    assert w.state == "done" and desk.news
    v = w.view(desk)
    assert v["items"][0]["actual"] == "0.3%" and v["items"][0]["outcome"] == "ABOVE" and v["items"][0]["src"] == "TradingView"
    assert v["items"][1]["outcome"] == "BELOW" and v["verdict"]["GOLD"]["side"] == -1
    assert desk.alert()["id"] == w.id
    assert desk.diary[-1]["sides"]["GOLD"] == "SELL" and (tmp_path / "sinal.json").exists()


def test_an_ensaio_hides_the_figure_until_it_is_due(monkeypatch):
    monkeypatch.setattr(sinal, "tv_figures", lambda feed, at: {"core inflation rate mom": (0.3, 0.3)})
    monkeypatch.setattr(sinal, "ff_figures", lambda feed, at: {"Core CPI m/m": "0.3%"})
    g = sinal.groups([{"name": "Core CPI m/m", "t": 1_760_000_000, "forecast": "0.2%", "previous": "0.3%", "actual": "0.3%", "impact": "high"}], 0)[0]
    w = sinal.Watch(g, test=True)
    assert 9 < w.t - w.clock() <= 10   # the old release comes 10 s after the press
    desk = sinal.Desk.__new__(sinal.Desk)
    desk.__init__()
    w.shift += 10   # at the minute: the old pages already have the figure, the ensaio still waits 1.5 s for it
    w.state = "poll"
    w.poll(desk, w.clock())
    assert w.items[0]["a"] is None
    w.shift += 2
    w.last_tv = 0
    w.poll(desk, w.clock())
    assert w.items[0]["actual"] == "0.3%" and w.done_at
