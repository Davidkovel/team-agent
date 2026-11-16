"""Memecoins (app/memes.py): mentions from posts, what is not a memecoin, the score's limits. No network."""
import time

from app import memes


def brain(tmp_path, monkeypatch):
    monkeypatch.setattr(memes, "DIR", tmp_path)
    monkeypatch.setattr(memes, "FILE", tmp_path / "state.json")
    return memes.Brain()


def pair(addr="So1anaMemeAddr1111111111111111111111111pump", symbol="WIF", liq=80000, created_h=10):
    return {"chainId": "solana", "pairAddress": "P" + addr[:10], "baseToken": {"address": addr, "symbol": symbol, "name": symbol},
            "priceUsd": "0.01", "liquidity": {"usd": liq}, "marketCap": 900000, "volume": {"h24": 240000, "h1": 30000},
            "priceChange": {"h1": 25, "h24": 60}, "txns": {"h1": {"buys": 300, "sells": 100}},
            "pairCreatedAt": (time.time() - created_h * 3600) * 1000}


def test_mentions_and_one_voice(tmp_path, monkeypatch):
    b = brain(tmp_path, monkeypatch)
    t = b._apply_pair(pair())
    now = time.time()
    for i in range(5):   # the same account five times is one voice
        b._post(f"x:{i}", "X", "spammer", f"buy $WIF now {i}", "", now, "x")
    b._post("tg:1", "Telegram", "canal", "$wif is running", "", now, "telegram")
    b._post("rd:old", "Reddit", "old", "$WIF", "", now - 72 * 3600, "reddit")   # older than 48 h: ignored
    b.score(t)
    assert t["n6"] == 6 and t["people6"] == 2
    assert not b._post("x:0", "X", "spammer", "$WIF", "", now, "x")   # seen already


def test_influencer_weighs_more(tmp_path, monkeypatch):
    b = brain(tmp_path, monkeypatch)
    t = b._apply_pair(pair())
    b._post("x:a", "X", "someone", "$WIF", "", time.time(), "x")
    b.score(t)
    plain = t["parts"]["social"]
    b.state["influencers"].append({"platform": "x", "handle": "BigCaller", "note": ""})
    b._post("x:b", "X", "bigcaller", "$WIF", "", time.time(), "x")
    b.score(t)
    assert t["inf6"] == 1 and t["parts"]["social"] > plain


def test_not_memes_and_danger_cap(tmp_path, monkeypatch):
    b = brain(tmp_path, monkeypatch)
    assert b._apply_pair(pair(symbol="USDG")) is None
    assert b._apply_pair({**pair(addr="X" * 40), "baseToken": {"address": "X" * 40, "symbol": "NVDAx", "name": "NVIDIA xStock"}}) is None
    t = b._apply_pair(pair(liq=3000))
    b.score(t)
    assert t["score"] <= 30 and any(f[0] == "bad" for f in t["flags"])


def test_post_gets_its_coin_and_the_price_then(tmp_path, monkeypatch):
    b = brain(tmp_path, monkeypatch)
    t = b._apply_pair(pair(symbol="HWAN"))
    b._post("tg:dippy/1", "Telegram", "dippy_calls", "just bought a bag of $HWAN", "", time.time(), "telegram")
    b._post("tg:dippy/2", "Telegram", "dippy_calls", "gm", "", time.time(), "telegram")
    b.state["influencers"].append({"platform": "telegram", "handle": "dippy_calls", "note": ""})
    b._post("tg:dippy/3", "Telegram", "dippy_calls", "gm", "", time.time(), "telegram")   # an influencer's post counts even without a coin
    b.link_posts()
    by_id = {p["id"]: p for p in b.state["posts"]}
    assert list(by_id["tg:dippy/1"]["coins"]) == [t["key"]] and by_id["tg:dippy/1"]["coins"][t["key"]]["p0"] == 0.01
    assert "tg:dippy/2" not in by_id and by_id["tg:dippy/3"]["coins"] == {}
    assert memes._utc("2026-11-16T19:54:34+00:00") == 1794858874
