"""Mercados (routers/trading.py): the parts that do not need the network."""
from datetime import datetime, timedelta, timezone

from app.models import PaperTrade
from app.routers.trading import START_CASH, _norm, account, by_name, parse_form4, rating, summarise

FORM4 = """<SEC-DOCUMENT><XML>
<ownershipDocument>
  <issuer><issuerCik>0001045810</issuerCik><issuerName>NVIDIA CORP</issuerName><issuerTradingSymbol>NVDA</issuerTradingSymbol></issuer>
  <reportingOwner><reportingOwnerId><rptOwnerName>HUANG JEN HSUN</rptOwnerName></reportingOwnerId>
    <reportingOwnerRelationship><isDirector>1</isDirector><isOfficer>1</isOfficer><officerTitle>President and CEO</officerTitle></reportingOwnerRelationship></reportingOwner>
  <nonDerivativeTable>
    <nonDerivativeTransaction><transactionDate><value>2026-10-01</value></transactionDate>
      <transactionCoding><transactionCode>P</transactionCode></transactionCoding>
      <transactionAmounts><transactionShares><value>1000</value></transactionShares><transactionPricePerShare><value>200</value></transactionPricePerShare>
        <transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode></transactionAmounts>
      <postTransactionAmounts><sharesOwnedFollowingTransaction><value>5000</value></sharesOwnedFollowingTransaction></postTransactionAmounts></nonDerivativeTransaction>
    <nonDerivativeTransaction><transactionDate><value>2026-10-02</value></transactionDate>
      <transactionCoding><transactionCode>F</transactionCode></transactionCoding>
      <transactionAmounts><transactionShares><value>10</value></transactionShares><transactionPricePerShare><value>201</value></transactionPricePerShare>
        <transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode></transactionAmounts>
      <postTransactionAmounts><sharesOwnedFollowingTransaction><value>4990</value></sharesOwnedFollowingTransaction></postTransactionAmounts></nonDerivativeTransaction>
  </nonDerivativeTable>
</ownershipDocument></XML></SEC-DOCUMENT>"""


def test_an_insider_filing_reads_as_one_line_with_the_buys_first():
    f = parse_form4(FORM4, "0000-26-1")
    assert f["ticker"] == "NVDA" and f["role"] == "President and CEO" and f["owner"] == "Huang Jen Hsun"
    s = summarise(f, "2026-10-03")
    assert s["kind"] == "buy" and s["shares"] == 1000 and s["value"] == 200_000 and s["price"] == 200
    assert round(s["change_pct"]) == 25  # 1000 bought on top of the 4000 held before


def test_the_paper_account_follows_the_orders_and_starts_again_at_a_reset():
    at = datetime(2026, 10, 1, tzinfo=timezone.utc)
    t = lambda i, **kw: PaperTrade(id=i, user_id=1, at=at + timedelta(minutes=i), currency="USD", name="", **kw)
    acc = account([t(1, side="buy", symbol="NASDAQ:NVDA", qty=10, price=100), t(2, side="sell", symbol="NASDAQ:NVDA", qty=4, price=150)])
    assert acc["start"] == START_CASH and acc["cash"] == START_CASH - 1000 + 600
    assert acc["realised"] == 200 and acc["positions"][0]["qty"] == 6 and acc["positions"][0]["cost"] == 600
    acc = account([t(1, side="buy", symbol="NASDAQ:NVDA", qty=10, price=100), t(2, side="reset", symbol="", qty=0, price=5000)])
    assert acc["cash"] == 5000 and acc["positions"] == [] and acc["orders"] == 0


def test_13f_names_find_their_ticker():
    names = {"by_name": {}, "by_compact": {}, "by_words": {}}
    for name, ticker in (("BANK OF AMERICA CORP /DE/", "BAC"), ("HORTON D R INC /DE/", "DHI"), ("SIRIUS XM HOLDINGS INC.", "SIRI"), ("Macy's, Inc.", "M")):
        key = _norm(name)
        names["by_name"][key] = ticker
        names["by_compact"][key.replace(" ", "")] = ticker
        names["by_words"][" ".join(sorted(key.split()))] = ticker
    names["sorted"] = sorted(names["by_name"])
    assert by_name(names, "BANK OF AMER CORP") == "BAC"
    assert by_name(names, "D R HORTON INC") == "DHI"
    assert by_name(names, "SIRIUSXM HOLDINGS INC") == "SIRI"
    assert by_name(names, "MACYS INC") == "M"
    assert by_name(names, "UNKNOWN THING") is None


def test_tradingview_ratings_use_its_own_thresholds():
    assert [rating(v) for v in (0.6, 0.3, 0, -0.3, -0.7, None)] == ["strong_buy", "buy", "neutral", "sell", "strong_sell", None]


def test_a_headline_counts_only_for_the_markets_it_names_and_never_for_brazil():
    from app.routers.trading import topics_of
    assert topics_of("O ouro registra alta, à medida que dados sobre a inflação enfraquecem o Fed") == ["gold", "usd"]
    assert topics_of("Libra esterlina sobe levemente com recuo do dólar") == ["gbpusd", "usd"]
    assert topics_of("Ações europeias têm ganho semanal modesto") == ["ger40"]
    assert topics_of("Alemanha planeja indicar candidato para o conselho do BCE") == ["eurusd", "ger40"]
    assert topics_of("Ibovespa bate recorde e dólar vai abaixo de R$5") == []
    assert topics_of("Dólar canadense cai após perda de empregos") == []
    assert topics_of("Produção colombiana de café aumenta em setembro") == []
    assert topics_of("Títulos, bombas e barricadas", ("ger40",)) == ["ger40"]  # filed by TradingView under the DAX


def test_the_same_story_told_twice_is_one_card():
    from app.routers.trading import same_story, words_of
    card = lambda title, ts: {"title": title, "ts": ts, "words": words_of(title)}
    a = card("Ações europeias têm ganho semanal modesto com queda de preços do petróleo e rendimentos dos títulos", 1000)
    b = card("Ações europeias registram ganho semanal modesto com a queda dos preços do petróleo e dos rendimentos", 3000)
    assert same_story(a, b)
    assert not same_story(a, card("Euro caminha para 5ª queda semanal consecutiva", 2000))
    assert not same_story(a, {**b, "ts": 1000 + 2 * 86400})  # the same words two days later are another day's story


def test_a_story_reads_as_its_points_and_paragraphs_without_the_byline():
    from app.routers.trading import story_parts
    s = {"read_time": 190, "astDescription": {"type": "root", "children": [
        {"type": "p", "children": ["Por Dhara Ranasinghe e Ankur Banerjee"]},
        {"type": "p", "children": ["O euro ", {"type": "symbol", "params": {"symbol": "FX:EURUSD", "text": "FX:EURUSD"}}, " caía 0,1%."]}]},
        "summary": {"type": "root", "children": [{"type": "list", "children": [{"type": "*", "children": ["Euro sob pressão"]}]}]}}
    assert story_parts(s) == {"bullets": ["Euro sob pressão"], "paragraphs": ["O euro EURUSD caía 0,1%."], "read_min": 3}


def test_the_diary_speaks_portuguese_and_keeps_what_it_does_not_know():
    from app.routers.trading import calendar_title
    assert calendar_title("Non-Farm Employment Change") == "Payroll: empregos criados"
    assert calendar_title("Core CPI m/m") == "Inflação core (CPI) do mês"
    assert calendar_title("German Flash Manufacturing PMI") == "Alemanha · PMI indústria (preliminar)"
    assert calendar_title("FOMC Member Waller Speaks") == "Discurso: Waller, da Fed"
    assert calendar_title("BOE Gov Bailey Speaks") == "Discurso: Bailey, governador do Banco de Inglaterra"
    assert calendar_title("Something New") == "Something New"
