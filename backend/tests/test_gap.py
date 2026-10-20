"""Gap da manhã: finding the gaps in M1 bars, the fill, and a pass against a fake MT5 account (never a real one)."""
import time
from types import SimpleNamespace as NS

from app.tradingroom import gap


def bars_with(gap_pts: float, pause: bool, base: float = 24000.0, n: int = 120, at: int = 60):
    out, p, t = [], base, 1_000_000
    for i in range(n):
        t += 60 if not (pause and i == at) else 2 * 3600
        o = p + (gap_pts if i == at else 0.5 * (-1) ** i)
        c = o + (-1) ** i
        out.append((t, o, max(o, c) + 1, min(o, c) - 1, c))
        p = c
    return out


def test_gap_after_a_pause_and_a_jump():
    g = gap.find_gaps(bars_with(80, True), 0.05)
    assert len(g) == 1 and g[0]["i"] == 60 and g[0]["dir"] == "up" and g[0]["kind"] == "pausa" and round(g[0]["pts"]) == 80
    j = gap.find_gaps(bars_with(-60, False), 0.05)
    assert len(j) == 1 and j[0]["dir"] == "down" and j[0]["kind"] == "salto"
    assert gap.find_gaps(bars_with(8, True), 0.05) == []   # 0.03%: below the minimum
    assert gap.find_gaps(bars_with(0, False), 0.0) == []    # the usual steps are not gaps


def test_fill():
    b = bars_with(80, True)
    g = gap.find_gaps(b, 0.05)[0]
    f = gap.fill(b, g)
    assert f["filled"] is None and 70 < f["left"] <= 82
    b[90] = (b[90][0], b[90][1], b[90][2], g["prev"] - 1, b[90][4])   # one bar back to the close before the gap
    f = gap.fill(b, g)
    assert f["filled"] == b[90][0] and f["left"] == 0
    s = gap.spark(b, g["i"])
    assert s[-1][0] >= b[g["i"]][0] and any(x[3] == g["prev"] for x in s)   # the bar before the gap stays its own point


class FakeMT5:
    TIMEFRAME_M1 = 1

    def __init__(self, bars):
        self.b = bars

    def symbol_select(self, *_):
        return True

    def copy_rates_from_pos(self, *_):
        return [{"time": t, "open": o, "high": h, "low": l, "close": c} for t, o, h, l, c in self.b]

    def symbol_info(self, _):
        return NS(digits=1)

    def symbol_info_tick(self, _):
        return NS(time=self.b[-1][0], bid=self.b[-1][4])


class Office:
    state = {"accounts": [{"id": "a1", "name": "FundedNext", "link": "mt5"}]}

    def account(self, aid):
        return self.state["accounts"][0] if aid == "a1" else None

    def full(self, acc):
        return acc


def test_a_pass_tells_the_gap_once_then_the_fill(monkeypatch, tmp_path):
    monkeypatch.setattr(gap, "FILE", tmp_path / "gap.json")
    monkeypatch.setattr(gap, "DIR", tmp_path)
    now = int(time.time()) // 60 * 60
    b = bars_with(80, True, at=100)   # the gap 20 minutes ago, the last bar 1 minute ago, the broker's clock 3 h ahead of UTC
    shift = now - 60 + 3 * 3600 - b[-1][0]
    b = [(t + shift, o, h, l, c) for t, o, h, l, c in b]
    fake = FakeMT5(b)
    monkeypatch.setattr(gap.mt5, "lib", lambda: fake)
    monkeypatch.setattr(gap.mt5, "login", lambda acc: None)
    monkeypatch.setattr(gap.mt5, "symbol", lambda acc, ours: "GER30" if ours == "GER40" else None)
    w = gap.Watch(Office())
    w.state["cfg"]["symbols"] = ["GER40"]
    w.step()
    assert w.state["offset"] == 3 * 3600
    assert len(w.state["days"]) == 1 and [x[0] for x in w.outbox] == ["medium"] and "GER30 ▲ +80" in w.outbox[0][1]
    w.outbox.clear()
    w.step()
    assert w.outbox == []   # told once
    rec = w.state["days"][0]
    b[110] = (b[110][0], b[110][1], b[110][2], rec["prev"] - 1, b[110][4])
    w.step()
    assert [x[0] for x in w.outbox] == ["low"] and "fechado em" in w.outbox[0][1]
    assert w.out()["today"][0]["filled"]
