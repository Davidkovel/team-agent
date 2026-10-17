"""The VWAP + EMA model of the trading room (tradingroom/vwap.py)."""
from datetime import datetime, timezone

from app.tradingroom import vwap

UTC = timezone.utc


def test_anchor_is_17h_new_york():
    # summer: New York is UTC-4, so 17:00 NY = 21:00 UTC
    assert datetime.fromtimestamp(vwap.anchor(datetime(2026, 10, 15, 22, 0, tzinfo=UTC)), UTC) == datetime(2026, 10, 15, 21, 0, tzinfo=UTC)
    # before 17:00 NY the day started yesterday
    assert datetime.fromtimestamp(vwap.anchor(datetime(2026, 10, 15, 12, 0, tzinfo=UTC)), UTC) == datetime(2026, 10, 14, 21, 0, tzinfo=UTC)
    # winter: UTC-5
    assert datetime.fromtimestamp(vwap.anchor(datetime(2026, 12, 2, 23, 0, tzinfo=UTC)), UTC) == datetime(2026, 12, 2, 22, 0, tzinfo=UTC)


def test_weekend_uses_the_last_candles_day():
    fri = datetime(2026, 10, 16, 20, 55, tzinfo=UTC).timestamp()
    sat = datetime(2026, 10, 17, 15, 0, tzinfo=UTC)
    assert vwap.day_start([(fri, 1, 1, 1, 1, 1)], sat) == datetime(2026, 10, 15, 21, 0, tzinfo=UTC).timestamp()


def test_series_is_volume_weighted():
    rows = [(0, 9, 9, 9, 9, 5), (100, 10, 10, 10, 10, 1), (200, 13, 13, 13, 13, 3)]
    out = vwap.series(rows, 100)
    assert out[0] is None
    assert out[1] == {"v": 10, "sd": 0}
    assert abs(out[2]["v"] - (10 * 1 + 13 * 3) / 4) < 1e-9
    assert out[2]["sd"] > 0
    # no volume: every candle weighs the same
    flat = vwap.series([(0, 10, 10, 10, 10, 0), (1, 14, 14, 14, 14, 0)], 0)
    assert flat[1]["v"] == 12


def _trend_with_pullback(tf_sec: int = 900, bars_after: int = 40):
    """A steady up-trend (60 candles before the day's anchor, `bars_after` after it), then a one-candle dip into the
    21 EMA that closes back up: the textbook pullback. With M15 and 40 candles the rejection lands at 07:00 UTC, in
    the London killzone."""
    t0 = datetime(2026, 10, 14, 21, 0, tzinfo=UTC).timestamp() - 60 * tf_sec
    rows, p = [], 100.0
    for k in range(60 + bars_after):
        p += .05
        rows.append((t0 + k * tf_sec, p - .04, p + .03, p - .06, p, 100))
    closes = [x[4] for x in rows]
    from app.tradingroom.technicals import ema
    e21 = ema(closes, 21)[-1]
    rows.append((t0 + len(rows) * tf_sec, p, p + .02, e21, p + .01, 100))   # long lower wick into the EMA, closes up
    return rows


def test_no_setup_without_h1_trend_or_against_it():
    rows = _trend_with_pullback()
    now = datetime.fromtimestamp(rows[-1][0] + 900, UTC)
    tg = [{"p": rows[-1][4] + 3, "label": "PDH", "kind": "BSL"}]
    assert vwap.setups(rows, 1.0, None, None, tg, now, "M15", .5, [], 2) == []
    assert vwap.setups(rows, 1.0, "bear", "bear", tg, now, "M15", .5, [], 2) == []


def test_news_and_a_spent_day_kill_the_grade():
    rows = _trend_with_pullback()
    now = datetime.fromtimestamp(rows[-1][0] + 900, UTC)
    tg = [{"p": rows[-1][4] + 3, "label": "PDH", "kind": "BSL"}]
    news = [{"pt": "CPI", "title": "CPI", "ccy": "USD", "mins": 20}]
    assert vwap.setups(rows, 1.0, "bull", "bull", tg, now, "M15", .95, news, 2) == []


def test_textbook_pullback_grades_a():
    rows = _trend_with_pullback()
    now = datetime.fromtimestamp(rows[-1][0] + 900, UTC)
    out = vwap.setups(rows, 1.0, "bull", "bull", [{"p": rows[-1][4] + 3, "label": "PDH", "kind": "BSL"}], now, "M15", .5, [], 2)
    assert len(out) == 1
    for s in out:
        assert s["grade"] in ("A+", "A") and s["score"] >= 70
        assert s["kind"] == "vwap" and s["dir"] == "buy" and s["stop"] < s["entry"] < s["targets"][0]["p"]
        assert s["status"] in ("armed", "active") and s["rr"] >= 1.5
