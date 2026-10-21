"""Painel FundedNext: deals → trades, days, statistics and objectives, on a made-up account (no MT5)."""
from datetime import datetime, timezone

from app.tradingroom import fundednext as fn

UTC = timezone.utc
OFF = 3 * 3600   # the server's clock, UTC+3


def ts(day, h, m=0):
    return int(datetime(2026, 10, day, h, m, tzinfo=UTC).timestamp()) + OFF   # server time


def deal(t, kind, entry, pos, price, vol=1.0, profit=0.0, sym="XAUUSD", magic=0, commission=-3.0):
    return {"ticket": t, "order": t, "position": pos, "symbol": sym, "type": kind, "entry": entry, "volume": vol, "price": price,
            "profit": profit, "swap": 0.0, "commission": commission if entry == 0 else 0.0, "fee": 0.0, "magic": magic, "comment": "", "at": t}


DEALS = [
    {**deal(ts(13, 8), 2, 0, 0, 0, 0, 100_000.0, sym="", commission=0), "commission": 0.0},    # the deposit
    deal(ts(13, 9), 0, 0, 11, 2400.0),                          # buy 1 lot gold at 2400, stop 2390
    deal(ts(13, 10), 1, 1, 11, 2420.0, profit=2000.0),          # out at 2420: +2R
    deal(ts(14, 9), 1, 0, 12, 1.1000, sym="EURUSD", magic=7701),  # sell EURUSD at 1.1000, stop 1.1050
    deal(ts(14, 11), 0, 1, 12, 1.1050, sym="EURUSD", magic=7701, profit=-500.0),  # stopped: −1R
    deal(ts(15, 9), 0, 0, 13, 2450.0, vol=2.0),                 # buy 2, half closed, half open
    deal(ts(15, 10), 1, 1, 13, 2460.0, vol=1.0, profit=1000.0),
]
STOPS = {11: 2390.0, 12: 1.1050, 13: 2440.0}


def test_trades_r_and_open_part():
    done, live = fn.closed_trades(DEALS, STOPS, OFF)
    assert [t["position"] for t in done] == [11, 12]
    assert done[0]["r"] == 2.0 and done[0]["pnl"] == 1997.0
    assert done[1]["dir"] == "sell" and done[1]["r"] == -1.0
    assert done[0]["open_at"] == ts(13, 9) - OFF   # back on UTC
    assert [t["position"] for t in live] == [13]


def test_days_count_opened_trades_and_money():
    days = fn.days_of(DEALS, 100_000)
    assert [d["day"] for d in days] == ["2026-10-13", "2026-10-14", "2026-10-15"]
    assert days[0]["pnl"] == 1997.0 and days[0]["trades"] == 1 and days[0]["wins"] == 1
    assert days[1]["losses"] == 1 and days[1]["pct"] == -0.5
    assert days[2]["balance"] == 100_000 + 1997 - 503 + 997


def test_curve_first_deposit_is_the_size():
    pts, first, payouts = fn.balance_curve(DEALS, OFF)
    assert first == 100_000.0 and not payouts
    assert pts[-1][1] == 100_000 + 1997 - 503 + 997


def test_stats():
    done, _ = fn.closed_trades(DEALS, STOPS, OFF)
    s = fn.stats(done, 100_000, {})
    assert s["n"] == 2 and s["winrate"] == 50.0 and s["pf"] == round(1997 / 503, 2)
    assert s["total_r"] == 1.0 and s["max_losses"] == 1
    assert {o["key"] for o in s["origins"]} == {"Manual (MT5)", "Manual (Hub)"}


def test_objectives_and_what_is_left_today():
    acc = {"id": "a", "preset": "fn-stellar-2", "phase": "f1", "size": 100_000, "daily": 5.0, "max": 10.0, "target": 8.0, "min_days": 5,
           "stop_at": 70, "panic_at": 90, "my_stop": 2.0}
    snap = {"ok": True, "balance": 102_491.0, "equity": 102_000.0}
    guard = {"ok": True, "daily_limit": 5000.0, "daily_used": 491.0, "daily_pct": 9.8, "max_limit": 10_000.0, "max_used": 0.0, "max_pct": 0.0,
             "floor_day": 97_491.0, "floor_max": 90_000.0, "day_pnl": -491.0}
    o = fn.objectives(acc, snap, guard, 3, 0.5)
    ids = {i["id"]: i for i in o["items"]}
    assert ids["target"]["left"] == 8000 - 2491 and ids["target"]["state"] == "run"
    assert ids["days"]["left"] == 2
    assert o["left_today"] == 2000 - 491          # the person's own stop is stricter than the firm's
    assert o["trades_left"] == int((2000 - 491) // (102_491 * .005))


def test_reward_only_on_a_funded_account():
    acc = {"id": "a", "preset": "fn-stellar-2", "phase": "funded", "size": 100_000, "split": 80, "start": "2026-10-01"}
    r = fn.reward(acc, {"ok": True, "balance": 103_000.0}, None, [])
    assert r["reward"] == 2400.0 and r["next"] > 0
    assert fn.reward({**acc, "phase": "f1"}, {"ok": True, "balance": 103_000.0}, None, []) is None
