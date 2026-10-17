"""The inside bar of D1 (tradingroom/insidebar.py) and the stop orders and swing trades it needs from the book."""
from datetime import datetime, timezone

from app.tradingroom import insidebar
from app.tradingroom.book import Book

UTC = timezone.utc
DAY = 86400
T0 = 1_700_000_000 - 1_700_000_000 % DAY


def days(n: int, up: bool = True) -> list[tuple]:
    """n daily candles trending (so the EMA 50 sits above the EMA 200 when up), ending with a mother and an inside bar."""
    rows, p = [], 100.0
    for i in range(n - 2):
        p += .5 if up else -.5
        rows.append((float(T0 + i * DAY), p - .2, p + 1, p - 1, p, 1.0))
    rows.append((float(T0 + (n - 2) * DAY), p, p + 3, p - 3, p + .5, 1.0))   # the mother
    rows.append((float(T0 + (n - 1) * DAY), p, p + 1, p - 1, p - .2, 1.0))   # inside it
    return rows


def test_inside_bar_with_the_trend_gives_a_buy_stop():
    d = days(260)
    m, x = d[-2], d[-1]
    now = datetime.fromtimestamp(x[0] + DAY + 3600, UTC)
    out = insidebar.setups("XAUUSD", d, None, 2, now)
    assert len(out) == 1
    s = out[0]
    assert s["dir"] == "buy" and s["order"] == "stop" and s["swing"] and s["grade"] == "A+"
    assert s["entry"] == x[2] and s["stop"] == m[3] and abs(s["targets"][0]["p"] - (x[2] + (x[2] - m[3]))) < 1e-9


def test_down_trend_sells_and_other_symbols_are_left_alone():
    d = days(260, up=False)
    now = datetime.fromtimestamp(d[-1][0] + DAY, UTC)
    assert insidebar.setups("XAUUSD", d, None, 2, now)[0]["dir"] == "sell"
    assert insidebar.setups("EURUSD", d, None, 5, now) == []


def test_today_breaking_both_sides_or_the_wrong_side_kills_it():
    d = days(260)
    x = d[-1]
    now = datetime.fromtimestamp(x[0] + DAY + 3600, UTC)
    both = (x[0] + DAY, x[4], x[2] + .1, x[3] - .1, x[4], 1.0)
    against = (x[0] + DAY, x[4], x[2] - .1, x[3] - .1, x[3], 1.0)
    taken = (x[0] + DAY, x[4], x[2] + .2, x[3] + .1, x[2] + .1, 1.0)
    assert insidebar.setups("XAUUSD", d, both, 2, now) == []
    assert insidebar.setups("XAUUSD", d, against, 2, now) == []
    assert insidebar.setups("XAUUSD", d, taken, 2, now)[0]["status"] == "active"


def test_no_inside_bar_no_setup():
    d = days(260)
    d[-1] = (d[-1][0], 100, 999, 1, 100, 1.0)
    assert insidebar.setups("XAUUSD", d, None, 2, datetime.fromtimestamp(d[-1][0] + DAY, UTC)) == []


def stop_order(**over):
    t = {"id": 1, "agent": "model", "symbol": "XAUUSD", "dir": "buy", "entry": 101.0, "stop": 99.0, "tp1": 103.0, "tp2": None, "risk": 2.0,
         "cost": 0, "status": "pending", "half": False, "mfe": 0.0, "mae": 0.0, "note": "", "r": None, "valid": "2100-01-01T00:00:00Z",
         "checked": 0.0, "order": "stop"}
    return {**t, **over}


def test_a_buy_stop_waits_below_and_fills_when_the_price_trades_up():
    book, t = Book({"trades": []}), stop_order()
    book._step(t, (1000.0, 100.0, 100.5, 99.5, 100.2, 1.0))   # under the entry: a limit would have filled, a stop does not
    assert t["status"] == "pending"
    book._step(t, (1300.0, 100.2, 101.4, 100.1, 101.3, 1.0))
    assert t["status"] == "open" and t["entry"] == 101.0
    book._step(t, (1600.0, 101.3, 103.2, 101.0, 103.0, 1.0))
    assert t["status"] == "won" and t["r"] == 1.0


def test_a_gap_past_the_stop_order_fills_at_the_open():
    book, t = Book({"trades": []}), stop_order()
    book._step(t, (1000.0, 101.5, 101.8, 101.2, 101.6, 1.0))
    assert t["status"] == "open" and t["entry"] == 101.5 and t["risk"] == 2.5


def test_a_sell_stop_mirrors():
    book, t = Book({"trades": []}), stop_order(dir="sell", entry=99.0, stop=101.0, tp1=97.0)
    book._step(t, (1000.0, 100.0, 100.5, 99.5, 100.0, 1.0))
    assert t["status"] == "pending"
    book._step(t, (1300.0, 100.0, 100.1, 98.8, 98.9, 1.0))
    assert t["status"] == "open"
