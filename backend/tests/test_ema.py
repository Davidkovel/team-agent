"""The third model of the trading room: EMA 125/200 pullbacks (tradingroom/ema.py) and who takes each setup (room.takers)."""
from datetime import datetime, timezone

from app.tradingroom import ema
from app.tradingroom.room import takers

UTC = timezone.utc


def _trend(n, step, start=100.0, t0=1_700_000_000, sec=900, wave=0.0):
    out, p = [], start
    for i in range(n):
        o = p
        p = p + step + (wave if i % 2 else -wave)
        out.append((t0 + i * sec, o, max(o, p) + .05, min(o, p) - .05, p, 1.0))
    return out


def test_trend_needs_the_stack_and_enough_candles():
    assert ema.trend(_trend(500, .1)) == "bull"
    assert ema.trend(_trend(500, -.1)) == "bear"
    assert ema.trend(_trend(300, .1)) is None   # a 200 on 300 candles has not settled


def test_pullback_to_the_band_is_taken_with_the_timeframe_above():
    k = 598
    m15 = _trend(600, .05, t0=int(datetime(2026, 1, 13, 8, 30, tzinfo=UTC).timestamp()) - k * 900)   # candle k in London's killzone
    f, s = ema.lines(m15)
    t, mid = m15[k][0], (f[k] + s[k]) / 2
    # a candle that dips into the band between the two EMAs and closes back above the 125, green
    m15[k] = (t, f[k] + .02, f[k] + .6, mid, f[k] + .5, 1.0)
    m15[k + 1] = (t + 900, f[k] + .5, f[k] + .7, f[k] + .45, f[k] + .6, 1.0)
    frames = {"M15": m15, "H1": _trend(600, .2, sec=3600), "H4": _trend(600, .4, sec=14400)}
    atr = {"M15": .9, "H1": 2.0}
    now = datetime.fromtimestamp(m15[-1][0], UTC)
    got = ema.setups(frames, atr, {"M15": [], "H1": []}, now, None, [], 2)
    assert got and got[0]["kind"] == "ema" and got[0]["dir"] == "buy" and got[0]["tf"] == "M15"
    assert got[0]["stop"] < got[0]["entry"] < got[0]["targets"][0]["p"]
    # the timeframe above against it: nothing
    frames["H1"] = _trend(600, -.2, start=300, sec=3600)
    assert ema.setups(frames, atr, {"M15": [], "H1": []}, now, None, [], 2) == []


def test_takers():
    assert takers({"kind": "smc", "agree": ["smc"]}) == ["model"]
    assert takers({"kind": "vwap", "agree": []}) == ["model", "vwap"]
    assert takers({"kind": "ema", "agree": ["ema", "vwap", "smc"]}) == ["ema", "combo"]
    assert takers({"kind": "ib", "agree": ["ema", "vwap", "smc"]}) == ["model"]
