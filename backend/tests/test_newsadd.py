"""Reforço na notícia: the ladder towards the VWAP band, and a run against a fake MT5 account (never a real one)."""
import time

from app.tradingroom import newsadd

SPEC = {"tick_size": 0.01, "tick_value": 1.0, "step": 0.01, "min": 0.01, "max": 50.0, "digits": 2}   # gold: 1 lot = 100 oz


def test_bands_and_stop_beyond_the_far_band():
    bars = [(i, 0, 101, 99, 100, 1) for i in range(10)] + [(i, 0, 111, 109, 110, 1) for i in range(10, 20)]
    b = newsadd.bands(bars, 0, 0)
    assert round(b["vwap"], 6) == 105 and round(b["sd"], 6) == 5
    assert newsadd.bands(bars, 15, 0)["vwap"] == 110   # only the bars after the anchor
    stop, k = newsadd.stop_at("sell", 106, b, 1, 0)
    assert (round(stop, 6), k) == (110, 1)   # vwap + 1σ
    stop, k = newsadd.stop_at("sell", 111, b, 1, 0)
    assert (round(stop, 6), k) == (115, 2)   # past the 1σ band already: the 2σ one
    stop, k = newsadd.stop_at("buy", 104, b, 1, 0)
    assert (round(stop, 6), k) == (100, 1)
    assert newsadd.stop_at("buy", 85, b, 1, 0) is None


def test_ladder_same_risk_lots_grow_towards_the_stop():
    steps = newsadd.ladder("sell", 4000, 4012, 250, 5, SPEC)
    assert [s["price"] for s in steps] == [4002, 4004, 4006, 4008, 4010]
    vols = [s["volume"] for s in steps]
    assert vols == sorted(vols) and vols[-1] > vols[0] * 4
    assert sum(s["risk"] for s in steps) <= 250 and all(abs(s["risk"] - 50) < 4 for s in steps) and sum(s["risk"] for s in steps) > 245
    buy = newsadd.ladder("buy", 4000, 3990, 250, 4, SPEC)
    assert [s["price"] for s in buy] == [3998, 3996, 3994, 3992]


def test_bands_on_15m_bars_like_tradingview():
    bars = [(m * 60, 0, 100 + m % 15, 100 + m % 15, 100 + m % 15, 1) for m in range(30)]   # two 15m bars: hlc3 = (114+100+114)/3
    b = newsadd.bands(bars, 0, 15)
    assert b["bars"] == 2 and round(b["vwap"], 6) == round((114 + 100 + 114) / 3, 6) and b["sd"] < 1e-6


def test_stat_tp(monkeypatch):
    rel = [{"m": {"GOLD": {"move5": -0.2, "low60": -x}}} for x in (0.3, 0.4, 0.5, 0.6, 0.7)]
    monkeypatch.setattr(newsadd.reaction, "load", lambda k: {"releases": rel})
    assert newsadd.stat_tp("cpi", "XAUUSD", "sell") == 0.5
    assert newsadd.stat_tp("cpi", "XAUUSD", "buy") is None   # fewer than 5 releases that way
    assert newsadd.stat_tp(None, "XAUUSD", "sell") is None


class FakeOffice:
    def __init__(self):
        self.state = {"accounts": [{"id": "a1", "name": "FundedNext 50k", "link": "mt5"}]}

    def account(self, aid):
        return next((a for a in self.state["accounts"] if a["id"] == aid), None)

    def full(self, acc):
        return acc

    def guard(self, acc):
        return {"ok": True, "can": True}


class FakeMT5:
    """One account, gold at 4000: the VWAP 3995 with σ 5 (upper 1σ band at 4000, 2σ at 4005)."""
    pos, pend, sent, closed, price = [], [], [], [], 4000.0

    def __init__(self, acc):
        pass

    def login(self):
        return None

    def symbol(self, ours):
        return "XAUUSD.r"

    def spec(self, name):
        return SPEC

    def tick(self, name):
        return {"bid": FakeMT5.price, "ask": FakeMT5.price + 0.2, "time": time.time()}

    def bars(self, name):
        now = time.time()
        return [(now - 60 * i, 0, 3990, 3990, 3990, 1) for i in range(10)] + [(now - 60 * i, 0, 4000, 4000, 4000, 1) for i in range(10, 20)]

    def positions(self, name):
        return list(FakeMT5.pos)

    def orders(self, name):
        return list(FakeMT5.pend)

    def limit(self, name, d, volume, price, sl, tp, comment):
        t = 1000 + len(FakeMT5.sent)
        FakeMT5.sent.append({"ticket": t, "dir": d, "volume": volume, "price": price, "sl": sl, "tp": tp})
        FakeMT5.pend.append({"ticket": t, "magic": newsadd.MAGIC})
        return {"ok": True, "ticket": t}

    def cancel(self, ticket):
        FakeMT5.pend = [o for o in FakeMT5.pend if o["ticket"] != ticket]
        return {"ok": True}

    def close(self, ticket):
        FakeMT5.closed.append(ticket)
        FakeMT5.pos = [p for p in FakeMT5.pos if p["ticket"] != ticket]
        return {"ok": True}


def _desk(tmp_path, monkeypatch):
    monkeypatch.setattr(newsadd, "FILE", tmp_path / "reforco.json")
    monkeypatch.setattr(newsadd, "DIR", tmp_path)
    monkeypatch.setattr(newsadd, "anchor", lambda now: 0)
    FakeMT5.pos, FakeMT5.pend, FakeMT5.sent, FakeMT5.closed, FakeMT5.price = [], [], [], [], 4000.0
    d = newsadd.Desk(office=FakeOffice(), broker=FakeMT5)
    d.set_cfg({"account": "a1", "symbol": "XAUUSD", "tp_auto": False, "tp_pct": 0.5, "levels": 5, "band": 1, "buffer_pct": 0, "tf": 1})
    return d


def test_run_waits_for_his_position_places_the_ladder_and_cleans_up(tmp_path, monkeypatch):
    d = _desk(tmp_path, monkeypatch)
    d.step()
    assert d.market["ok"] and d.market["main"]["sell"]["volume"] > 0   # the lot for his 1.5% before he opens
    d.start()
    d.step()
    assert d.state["run"]["phase"] == "waiting" and not FakeMT5.sent
    FakeMT5.pos = [{"ticket": 77, "dir": "sell", "volume": 1.0, "price": 3998.0, "sl": 0, "tp": 0, "pnl": 0, "magic": 0}]
    d.step()
    run = d.state["run"]
    assert run["phase"] == "placed" and len(FakeMT5.sent) == 5
    assert all(s["dir"] == "sell" and s["price"] > 4000 and s["sl"] == run["stop"] for s in FakeMT5.sent)
    assert run["stop"] == 4005 and run["band"] == 2   # the price sits on the 1σ band: the stop goes past the 2σ one
    assert run["tp"] == round(3998 * 0.995, 2)
    assert sum(lv["risk"] for lv in run["levels"]) <= 250   # 0.5% of 50 000
    # two steps fill, then his position closes: the rest is cancelled, the filled ones stay
    filled = FakeMT5.sent[0]["ticket"], FakeMT5.sent[1]["ticket"]
    FakeMT5.pend = [o for o in FakeMT5.pend if o["ticket"] not in filled]
    FakeMT5.pos += [{"ticket": t, "dir": "sell", "volume": .1, "price": 4001, "sl": 0, "tp": 0, "pnl": 5.0, "magic": newsadd.MAGIC} for t in filled]
    d.step()
    assert [lv["status"] for lv in run["levels"]][:2] == ["filled", "filled"]
    FakeMT5.pos = [p for p in FakeMT5.pos if p["ticket"] != 77]
    d.step()
    assert not FakeMT5.pend and run["phase"] == "placed"   # cancelled, the two filled ones still open
    FakeMT5.pos = []
    d.step()
    assert run["phase"] == "done"
    # a new Start does not pick the same position again
    FakeMT5.pos = [{"ticket": 77, "dir": "sell", "volume": 1.0, "price": 3998.0, "sl": 0, "tp": 0, "pnl": 0, "magic": 0}]
    d.start()
    d.step()
    assert d.state["run"]["phase"] == "waiting"


def test_stop_and_close(tmp_path, monkeypatch):
    d = _desk(tmp_path, monkeypatch)
    d.start()
    d.stop()
    assert d.state["run"]["phase"] == "done"   # nothing placed yet
    d.start()
    FakeMT5.pos = [{"ticket": 78, "dir": "buy", "volume": 1.0, "price": 4000.0, "sl": 0, "tp": 0, "pnl": 0, "magic": 0}]
    FakeMT5.price = 3996.0   # just under the VWAP: the buy stop goes below the lower 1σ band (3990)
    d.step()
    run = d.state["run"]
    assert run["phase"] == "placed" and run["stop"] == 3990 and all(s["price"] < 3996.2 for s in FakeMT5.sent)
    t = FakeMT5.sent[-1]["ticket"]
    FakeMT5.pend = [o for o in FakeMT5.pend if o["ticket"] != t]
    FakeMT5.pos.append({"ticket": t, "dir": "buy", "volume": .5, "price": 3991, "sl": 0, "tp": 0, "pnl": -1.0, "magic": newsadd.MAGIC})
    d.stop(close=True)
    d.step()
    assert run["phase"] == "done" and FakeMT5.closed == [t] and not FakeMT5.pend
    assert any(p["ticket"] == 78 for p in FakeMT5.pos)   # his own position is never touched
