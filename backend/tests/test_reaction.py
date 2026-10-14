"""The history of US releases in the trading room: which release is picked, the surprise and the summary."""
from datetime import datetime, timezone

from app.tradingroom import reaction

UTC = timezone.utc


def _cal(t, title="Core Inflation Rate MoM", country="US", actual=None, forecast=0.2):
    return {"country": country, "t": t, "title": title, "actual": actual, "forecast": forecast, "previous": 0.3, "unit": "%"}


def test_surprise():
    assert reaction.surprise(0.3, 0.2) == "ABOVE"
    assert reaction.surprise(0.1, 0.2) == "BELOW"
    assert reaction.surprise(0.2, 0.2) == "INLINE"
    assert reaction.surprise(None, 0.2) is None


def test_pick_prefers_the_release_just_out_then_the_next_one():
    now = datetime(2026, 10, 14, 13, 0, tzinfo=UTC)
    out = _cal("2026-10-14T12:30:00.000Z", actual=0.3)
    nxt = _cal("2026-10-15T12:30:00.000Z", title="PPI MoM")
    other = _cal("2026-10-14T12:45:00.000Z", country="EU")
    e, key, _ = reaction.pick([nxt, other, out], now)
    assert key == "cpi" and e is out
    later = datetime(2026, 10, 14, 17, 0, tzinfo=UTC)          # more than 4 h after: nothing with history left in range
    assert reaction.pick([out], later) is None
    assert reaction.pick([_cal("2026-10-14T12:30:00.000Z", title="Housing Starts")], now) is None


def test_summary_counts_and_brief():
    s = reaction.summary(reaction.load("cpi"))
    assert s["count"] >= 100 and s["since"] == "2018"
    above = s["table"]["ABOVE"]
    assert above["GOLD"]["n"] <= above["n"] and above["GOLD"]["avg"] < 0
    g = s["gold"]
    assert g["bounce"]["back"] <= g["bounce"]["n"] and g["small"]["n"] + g["big"]["n"] >= g["bounce"]["n"]
    reaction.LAST = {"name": "Inflação core (CPI) m/m", "actual": 0.3, "forecast": 0.2, "unit": "%", "surprise": "ABOVE", **s}
    text = reaction.brief_text()
    assert "HOJE saiu 0,3% contra 0,2%" in text and "acima da previsão" in text
    reaction.LAST = {}
    assert reaction.brief_text() == ""
