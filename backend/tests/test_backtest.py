"""The backtest of the trading room: the past is replayed without seeing the future, and a candle read twice counts once."""
import random
from datetime import datetime, timezone

from app.tradingroom import backtest
from app.tradingroom.book import Book
from app.tradingroom.markets import INSTRUMENTS

UTC = timezone.utc
T0 = 1_790_000_000 - 1_790_000_000 % 86400


def walk(n: int, step: int, seed: int = 1, start: float = 100.0) -> list[tuple]:
    rnd, rows, p = random.Random(seed), [], start
    for i in range(n):
        o = p
        c = o + rnd.uniform(-.3, .3)
        rows.append((float(T0 + i * step), o, max(o, c) + rnd.uniform(0, .15), min(o, c) - rnd.uniform(0, .15), c, 1.0))
        p = c
    return rows


def pack(m5: list[tuple], step: int) -> list[tuple]:
    out: list[tuple] = []
    for r in m5:
        b = r[0] - r[0] % step
        if out and out[-1][0] == b:
            t, o, h, low, _, v = out[-1]
            out[-1] = (t, o, max(h, r[2]), min(low, r[3]), r[4], v + r[5])
        else:
            out.append((b, r[1], r[2], r[3], r[4], r[5]))
    return out


def test_replay_shows_only_what_was_known():
    m5 = walk(60, 300)
    store = backtest.Replay({("XAUUSD", "M5"): m5, ("XAUUSD", "H1"): pack(m5, 3600)})
    store.now = T0 + 3600 + 3 * 300   # the 2nd hour is 15 minutes old
    assert [r[0] for r in store.get("XAUUSD", "M5")][-1] == T0 + 3600 + 2 * 300
    h1 = store.get("XAUUSD", "H1")
    assert len(h1) == 2 and h1[0] == pack(m5, 3600)[0]
    part = m5[12:15]
    assert h1[1] == (T0 + 3600, part[0][1], max(c[2] for c in part), min(c[3] for c in part), part[-1][4], 3.0)
    store.now = T0 + 3600   # on the hour: nothing of the next one yet
    assert len(store.get("XAUUSD", "H1")) == 1


def trade(**over):
    t = {"id": 1, "agent": "model", "symbol": "XAUUSD", "dir": "buy", "entry": 100.0, "stop": 99.0, "tp1": 102.0, "tp2": None, "risk": 1.0, "cost": 0,
         "status": "pending", "half": False, "mfe": 0.0, "mae": 0.0, "note": "", "r": None, "valid": "2100-01-01T00:00:00Z", "checked": 0.0}
    return {**t, **over}


def test_the_fill_candle_read_twice_never_gives_the_target():
    book, t = Book({"trades": []}), trade()
    c = (1000.0, 103.0, 103.0, 99.5, 100.5, 1.0)   # came down from above the target to fill the order
    book._step(t, c)
    assert t["status"] == "open"
    book._step(t, c)   # the room reads its last candle again on the next turn
    assert t["status"] == "open" and t["mfe"] == 0
    book._step(t, (1300.0, 100.5, 102.5, 100.2, 102.2, 1.0))
    assert t["status"] == "won" and t["r"] == 2.0


def test_the_candle_of_the_first_target_does_not_stop_the_other_half():
    book, t = Book({"trades": []}), trade(status="open", tp2=104.0, fill_bar=700.0)
    c = (1000.0, 99.8, 102.5, 99.7, 102.2, 1.0)   # below the entry first, then the 1st target
    book._step(t, c)
    book._step(t, c)
    assert t["status"] == "open" and t["half"]
    book._step(t, (1300.0, 102.2, 102.4, 99.9, 100.1, 1.0))
    assert t["status"] == "won" and t["r"] == 1.0   # half at +2R, half at the entry


def test_replay_runs_the_model_over_the_past():
    inst = INSTRUMENTS[0]["id"]
    m5 = walk(900, 300, seed=7, start=4000.0)
    data = {(inst, "M5"): m5, **{(inst, tf): pack(m5, sec) for tf, sec in (("M15", 900), ("H1", 3600), ("H4", 14400), ("D1", 86400))}}
    out = backtest.replay(data)
    assert out["candles"] == 900 - backtest.WARM and out["from"] == m5[backtest.WARM][0] + 300
    assert out["stats"]["n"] == sum(t["status"] in ("won", "lost", "be") for t in out["trades"])
    for t in out["trades"]:   # an order is never filled before it was placed
        if t.get("filled_at"):
            assert datetime.fromisoformat(t["filled_at"]) >= datetime.fromisoformat(t["at"])
