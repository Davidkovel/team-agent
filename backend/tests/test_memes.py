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


def test_judge_ranks_and_counts_a_repeat_once():
    from app.memes_calls import board, call_refs
    assert call_refs("buy $HWAN and $NVDA and $SOL")[1] == ["HWAN"]   # shares and majors are no calls
    coin = lambda k: {"key": k, "symbol": k, "name": k, "image": None, "url": "", "chain": "solana"}
    t0 = 1_790_000_000
    calls = {}
    for n, (k, dt, r) in enumerate([("A", 0, 50.0), ("A", 3600, -90.0), ("B", 90000, -20.0), ("C", 200000, 30.0), ("D", 300000, 10.0),
                                     ("E", 400000, 5.0), ("F", 500000, 40.0)]):
        calls[str(n)] = {"id": str(n), "platform": "telegram", "who": "dippy_calls", "url": "", "text": "", "t": t0 + dt, "how": "ticker",
                         "coin": coin(k), "r24": r, "done": True}
    b = board({"influencers": [{"platform": "telegram", "handle": "dippy_calls"}], "calls": calls})
    r = b["ranking"][0]
    assert r["judged"] == 6 and r["up"] == 5 and r["usd"] == 115.0   # the second $A within 24 h is the same call
    assert r["verdict"] == "Vale a pena seguir"


def test_x_tweets_through_twitterapi(tmp_path, monkeypatch):
    """The answer of twitterapi.io's last_tweets (its documented shape), with a fake network."""
    import asyncio

    import httpx
    b = brain(tmp_path, monkeypatch)
    b.cfg["x_key"] = "k"
    b.state["influencers"].append({"platform": "x", "handle": "daniworldwide", "note": ""})
    seen = {}

    def answer(req):
        seen["key"], seen["user"] = req.headers.get("X-API-Key"), req.url.params.get("userName")
        return httpx.Response(200, json={"status": "success", "data": {"tweets": [
            {"id": "1", "url": "https://x.com/daniworldwide/status/1", "text": "aping $HWAN", "createdAt": "Mon Nov 16 19:00:00 +0000 2026",
             "author": {"userName": "daniworldwide", "name": "Dani", "profilePicture": "https://pbs.twimg.com/a.jpg"}}]}, "has_next_page": False})

    async def go():
        async with httpx.AsyncClient(transport=httpx.MockTransport(answer)) as c:
            return await b.x_accounts(c, [])
    assert asyncio.run(go()) == 1
    assert seen == {"key": "k", "user": "daniworldwide"}
    p = b.state["posts"][0]
    assert p["platform"] == "x" and p["tickers"] == ["HWAN"] and p["t"] == 1794855600
    assert b.state["influencers"][0]["name"] == "Dani" and b.state["x_used"]["tweets"] == 1


def test_leitor_reads_video_coins_into_calls(tmp_path, monkeypatch):
    """A Telegram block's media; the coins the Leitor heard become the post's; an old-profit post is no call."""
    from app.memes_calls import board
    from app.memes_ler import tg_media
    block = ('<a class="tgme_widget_message_photo_wrap blured" style="width:1px;background-image:url(\'https://cdn.t/p1.jpg\')"></a>'
             '<video src="https://cdn.t/v.mp4?token=a" class="tgme_widget_message_video js-message_video"></video>'
             '<time class="message_video_duration js-message_video_duration">1:04</time>')
    m = tg_media(block)
    assert m == {"video": "https://cdn.t/v.mp4?token=a", "dur": 64, "photos": ["https://cdn.t/p1.jpg"]}
    b = brain(tmp_path, monkeypatch)
    b.state["influencers"].append({"platform": "telegram", "handle": "martynplaybook", "note": ""})
    assert b._post("tg:martynplaybook/9", "Telegram", "martynplaybook", "", "u", time.time(), "telegram", m)
    p = b.state["posts"][0]
    assert p["media"]["video"] and b.reader.queue() == [p]
    r = b.reader.apply(p, {"tipo": "resultado", "moedas": [{"symbol": "$mihau"}, {"symbol": "SOL"}, {"symbol": "NVDA"}], "conviccao": 9, "resumo": "mostra o lucro"})
    assert r["tipo"] == "resultado" and r["conviccao"] == 5 and [c["symbol"] for c in r["moedas"]] == ["MIHAU"]
    assert p["tickers"] == ["MIHAU"] and p["refs"] == "$MIHAU"
    b.state["reads"][p["id"]] = r
    b.judge.collect(b.state["posts"])
    x = next(iter(b.state["calls"].values()))
    assert x["ref"] == "MIHAU" and x["tipo"] == "resultado"
    x.update(coin={"key": "k", "symbol": "MIHAU"}, r24=50.0)
    assert board(b.state)["ranking"][0]["calls"] == 0   # showing an old profit is not a call
    b.state["reads"][p["id"]]["tipo"] = "compra"
    b.judge.collect(b.state["posts"])
    assert board(b.state)["ranking"][0]["judged"] == 1


def test_live_launch_under_a_post(tmp_path, monkeypatch):
    """Ao vivo (memes_live.py): a pump.fun launch named like a fresh tweet is a coin «under» it; the author's name never counts."""
    from app.memes_live import keys_of
    keys, cas = keys_of("Elon: my dog Floki the Viking is back #FLOKI", "elonmusk", "Elon Musk")
    assert "floki" in keys and "elon" not in keys and not cas
    b = brain(tmp_path, monkeypatch)
    lv = b.live
    lv.on_tree({"source": "Twitter", "title": "Elon Musk (@elonmusk): my dog Floki the Viking is back", "url": "https://x.com/elonmusk/status/1",
                "time": time.time() * 1000})
    lv.on_pump({"txType": "create", "mint": "M" * 43, "symbol": "FLOKIV", "name": "Floki Viking", "marketCapSol": 30, "solAmount": 1})
    lv.on_pump({"txType": "create", "mint": "N" * 43, "symbol": "CAT", "name": "cat", "marketCapSol": 30, "solAmount": 1})
    p = lv.view()["posts"][0]
    assert p["watched"] and [c["symbol"] for c in p["coins"]] == ["FLOKIV"]
    r = {"mint": "R" * 43}
    lv.radar.append(r)
    lv._radar(r, {"price": 1, "mcap": 1, "liq": 10000, "ch5": -40, "ch1": -10, "b5": 2, "s5": 20, "at": 0, "symbol": "R", "image": None, "url": ""})
    assert {a["level"] for a in lv.alerts} == {"bad", "warn"}


def test_narrative_gta(tmp_path, monkeypatch):
    """Narrativas (memes_narr.py): which coins are GTA coins, which posts talk of it, a call, and the YouTube lives."""
    from pathlib import Path

    from app.memes_narr import GTA, coin_hit, text_hit, yt_lives
    assert coin_hit(GTA, "Leonida", "The State of Leonida") == "leonida"
    assert coin_hit(GTA, "GTA6", "GTA VI") and coin_hit(GTA, "LUCIA", "Lucia") == "lucia"
    assert coin_hit(GTA, "TOMAS", "Tomás Lucia’s Baby") and text_hit(GTA, "Lucia's son Tomas just launched")
    assert coin_hit(GTA, "PIZZA", "Lucia Pizza") is None and coin_hit(GTA, "CAT", "cat") is None
    assert text_hit(GTA, "GTA 6 is out tomorrow, aping $LEONIDA") and text_hit(GTA, "vice city vibes") and not text_hit(GTA, "a gtag")
    lives = yt_lives((Path(__file__).parent / "data" / "yt_live.html").read_text())
    assert len(lives) == 2 and all(v["viewers"] > 1000 and v["url"].startswith("https://www.youtube.com/watch") for v in lives)
    b = brain(tmp_path, monkeypatch)
    nr = b.live.narr
    s = nr.of("gta")
    s["coins"]["LeoAddr"] = {"address": "LeoAddr", "chain": "solana", "symbol": "Leonida", "name": "GTA6", "why": "leonida", "image": None, "url": "",
                             "mcap": 36000, "liq": 26000, "vol5": 1, "vol1": 750000, "vol24": 750000, "ch5": 1, "ch1": 706, "ch24": 706,
                             "b1": 900, "s1": 300, "peak": 36000, "created": time.time() - 1800, "at": time.time()}
    b._post("tg:x/1", "Telegram", "solearlytrending", "🔥 $LEONIDA trending #1, GTA 6 tomorrow", "u", time.time(), "telegram")
    b._post("tg:x/2", "Telegram", "solearlytrending", "$BONK up", "u2", time.time(), "telegram")   # no GTA: not in the feed
    nr._calls(s)
    v = nr.view()[0]
    assert v["name"] == "GTA 6" and len(v["feed"]) == 1 and v["feed"][0]["coins"][0]["symbol"] == "Leonida"
    c = v["coins"][0]
    assert {"A explodir", "Nova"} <= {t[0] for t in c["tags"]} and c["calls"] == 1 and c["first"]["who"] == "solearlytrending"
    b.live.on_pump({"txType": "create", "mint": "G" * 43, "symbol": "GTA6", "name": "Grand Theft Auto VI", "marketCapSol": 30, "solAmount": 1})
    assert nr.view()[0]["launches"][0]["symbol"] == "GTA6"
