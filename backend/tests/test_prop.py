"""Desafio 50k (tradingroom/prop.py): the prop-firm rules over the paper book. No network."""
from datetime import datetime, timedelta, timezone

from app.tradingroom import prop

UTC = timezone.utc
T0 = datetime(2026, 11, 2, 9, tzinfo=UTC)   # a Monday


def trade(i, day, r, agent="model", risk=1.0, mae=0.0, sym="XAUUSD"):
    t = T0 + timedelta(days=day, hours=i % 5)
    return {"id": i, "agent": agent, "symbol": sym, "dir": "buy", "status": "won" if r > 0 else "lost", "r": r, "mae": mae,
            "risk_pct": risk, "at": t.isoformat(), "filled_at": t.isoformat(), "closed_at": (t + timedelta(minutes=30)).isoformat()}


def test_phase_one_needs_target_and_five_days():
    tr = [trade(i, i, 2.0) for i in range(4)]          # +8 % in 4 days: target done, days missing
    a = prop.account(tr, "model", {}, (T0 + timedelta(days=5)).timestamp())
    assert a["phase"]["id"] == "p1" and a["target"]["pct"] >= 100 and a["days"]["have"] == 4
    tr.append(trade(9, 5, 0.1))
    a = prop.account(tr, "model", {}, (T0 + timedelta(days=6)).timestamp())
    assert a["phase"]["id"] == "p2" and a["balance"] == 50000 and a["history"]["passed"][0]["phase"] == "Fase 1"


def test_daily_loss_burns_the_account_even_in_the_worst_moment():
    tr = [trade(0, 0, -1.0), trade(1, 0, -1.0), trade(2, 0, -1.0), trade(3, 0, -1.0)]
    tr.append(trade(4, 0, 0.5, mae=1.3))   # closed in profit, but at its worst the day was down > 5 %
    a = prop.account(tr, "model", {}, (T0 + timedelta(days=1)).timestamp())
    assert a["history"]["lost"] == 1 and "Perda diária" in a["history"]["lost_list"][0]["why"]
    assert a["state"] == "fresh" and a["history"]["fees"] == 2 * prop.FEE


def test_guard_refuses_too_much_risk_and_news():
    now = T0 + timedelta(days=1)
    t = {"id": 1, "agent": "penguin", "symbol": "EURUSD", "status": "pending", "risk_pct": 1.0, "risk_pct_asked": 2.0, "at": now.isoformat()}
    assert "máximo" in prop.guard([], t, {}, [], now)
    t["risk_pct_asked"] = 1.0
    opens = [{**trade(10 + i, 1, 0, agent="penguin"), "status": "open", "risk_pct": 1.0} for i in range(2)]
    assert "2 %" in prop.guard(opens, t, {}, [], now) or "2 %" in prop.guard(opens, t, {}, [], now).replace(",", ".")
    cal = [{"imp": 3, "ccy": "EUR", "t": (now + timedelta(minutes=3)).isoformat(), "pt": "Inflação"}]
    assert "notícia" in prop.guard([], {**t, "market": True}, {}, cal, now)
    assert prop.guard([], t, {}, [], now) is None


def test_funded_pays_80_percent_every_14_days():
    tr = [trade(i, i, 2.0) for i in range(5)] + [trade(10 + i, 6 + i, 1.2) for i in range(5)]   # p1 then p2
    tr += [trade(30, 12, 3.0)]
    a = prop.account(tr, "model", {}, (T0 + timedelta(days=40)).timestamp())
    assert a["phase"]["id"] == "funded" and a["history"]["paid"] > 0 and a["verdict"]["word"] in ("Compensa", "Financiada")
