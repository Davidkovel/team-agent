"""What the big money is doing, from public sources without keys:
- the CFTC's Commitments of Traders (every Friday, positions as of Tuesday): how leveraged funds and asset managers (and,
  in gold, managed money) are positioned in the futures of each instrument, the change of the week, and the COT index
  (where that position sits in its range of the last three years: 0 the most short, 100 the most long);
- the macro drivers, from the room's own candles: the real yield behind gold, the two-year spreads behind EURUSD and
  GBPUSD, the dollar, risk (VIX, S&P 500, USD/JPY), and the 20-day correlation of each instrument with them."""
from __future__ import annotations

import asyncio
import logging
import math
import time

import httpx

log = logging.getLogger("tradingroom")

# instrument -> (dataset, CFTC contract code, the group that matters, its label). TFF: traders in financial futures;
# disaggregated: commodities. GER40 has no CFTC contract (the DAX trades on Eurex).
COT = {
    "XAUUSD": ("72hh-3qpy", "088691", [("m_money_positions_long_all", "m_money_positions_short_all", "Managed money (fundos)")]),
    "EURUSD": ("gpe5-46if", "099741", [("lev_money_positions_long", "lev_money_positions_short", "Leveraged funds"), ("asset_mgr_positions_long", "asset_mgr_positions_short", "Asset managers")]),
    "GBPUSD": ("gpe5-46if", "096742", [("lev_money_positions_long", "lev_money_positions_short", "Leveraged funds"), ("asset_mgr_positions_long", "asset_mgr_positions_short", "Asset managers")]),
    "NAS100": ("gpe5-46if", "209742", [("lev_money_positions_long", "lev_money_positions_short", "Leveraged funds"), ("asset_mgr_positions_long", "asset_mgr_positions_short", "Asset managers")]),
    "US30": ("gpe5-46if", "124603", [("lev_money_positions_long", "lev_money_positions_short", "Leveraged funds"), ("asset_mgr_positions_long", "asset_mgr_positions_short", "Asset managers")]),
    "BTCUSD": ("gpe5-46if", "133741", [("lev_money_positions_long", "lev_money_positions_short", "Leveraged funds"), ("asset_mgr_positions_long", "asset_mgr_positions_short", "Asset managers")]),
}


class Institutional:
    def __init__(self):
        self.cot: dict[str, dict] = {}
        self.cot_at = 0.0

    async def refresh_cot(self, force: bool = False):
        if not force and time.time() - self.cot_at < 6 * 3600:
            return
        async with httpx.AsyncClient(timeout=30) as client:
            async def one(sym: str, ds: str, code: str, groups: list):
                fields = ",".join(["report_date_as_yyyy_mm_dd", "open_interest_all"] + [f for g in groups for f in g[:2]])
                try:
                    r = await client.get(f"https://publicreporting.cftc.gov/resource/{ds}.json",
                                         params={"$select": fields, "$where": f"cftc_contract_market_code='{code}'",
                                                 "$order": "report_date_as_yyyy_mm_dd DESC", "$limit": "160"})
                    rows = r.json()
                except Exception:
                    return sym, None
                if not isinstance(rows, list) or len(rows) < 2:
                    return sym, None
                out = {"date": rows[0]["report_date_as_yyyy_mm_dd"][:10], "groups": []}
                for lo, sh, label in groups:
                    nets = [float(x.get(lo) or 0) - float(x.get(sh) or 0) for x in rows]
                    a, b = min(nets), max(nets)
                    out["groups"].append({"label": label, "net": nets[0], "change": nets[0] - nets[1], "long": float(rows[0].get(lo) or 0),
                                          "short": float(rows[0].get(sh) or 0), "index": round((nets[0] - a) / (b - a) * 100) if b > a else 50,
                                          "weeks": len(nets)})
                return sym, out
            got = await asyncio.gather(*(one(s, *v) for s, v in COT.items()))
        fresh = {s: v for s, v in got if v}
        if fresh:
            self.cot.update(fresh)
            self.cot_at = time.time()
        else:
            self.cot_at = time.time() - 5 * 3600   # try again in an hour


def _returns(rows: list) -> dict[int, float]:
    """Daily changes by day number (t // 86400): percentage for prices, the change itself for yields."""
    out = {}
    for a, b in zip(rows, rows[1:]):
        out[int(b[0] // 86400)] = (b[4] - a[4]) / a[4] * 100 if a[4] else 0.0
    return out


def _diffs(rows: list) -> dict[int, float]:
    return {int(b[0] // 86400): b[4] - a[4] for a, b in zip(rows, rows[1:])}


def corr(a: dict[int, float], b: dict[int, float], n: int = 20) -> float | None:
    days = sorted(set(a) & set(b))[-n:]
    if len(days) < 10:
        return None
    xs, ys = [a[d] for d in days], [b[d] for d in days]
    mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
    sx = math.sqrt(sum((x - mx) ** 2 for x in xs))
    sy = math.sqrt(sum((y - my) ** 2 for y in ys))
    return None if not sx or not sy else sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / (sx * sy)


def drivers(store) -> dict:
    """The macro board: levels and five-day changes, and what each instrument has been moving with."""
    d1 = {i: store.get(i, "D1") for i in ("DXY", "US10Y", "US02Y", "DE02Y", "GB02Y", "DE10Y", "REAL10", "BE10", "VIX", "SPX", "USDJPY", "USOIL",
                                          "XAUUSD", "EURUSD", "GBPUSD", "GER40", "NAS100", "US30", "BTCUSD")}

    def last(i, back=0):
        rows = d1.get(i) or []
        return rows[-1 - back][4] if len(rows) > back else None

    def level(i):
        v, w = last(i), last(i, 5)
        return {"v": v, "d5": (v - w) if v is not None and w is not None else None}
    board = {k: level(k) for k in ("DXY", "US10Y", "US02Y", "REAL10", "BE10", "VIX", "SPX", "USDJPY", "USOIL")}
    for name, a, b in (("US_DE_2Y", "US02Y", "DE02Y"), ("US_GB_2Y", "US02Y", "GB02Y"), ("US_DE_10Y", "US10Y", "DE10Y")):
        x, y, x5, y5 = last(a), last(b), last(a, 5), last(b, 5)
        board[name] = {"v": x - y if x is not None and y is not None else None,
                       "d5": (x - y) - (x5 - y5) if None not in (x, y, x5, y5) else None}
    rets = {i: _returns(d1[i]) for i in ("XAUUSD", "EURUSD", "GBPUSD", "GER40", "NAS100", "US30", "BTCUSD", "DXY", "SPX", "USDJPY", "USOIL") if d1.get(i)}
    yields = {i: _diffs(d1[i]) for i in ("US10Y", "REAL10", "US02Y") if d1.get(i)}
    spread = {}
    if d1.get("US02Y") and d1.get("DE02Y"):
        de = {int(r[0] // 86400): r[4] for r in d1["DE02Y"]}
        us = {int(r[0] // 86400): r[4] for r in d1["US02Y"]}
        days = sorted(set(de) & set(us))
        spread = {d: (us[d] - de[d]) - (us[p] - de[p]) for p, d in zip(days, days[1:])}
    pairs = {"XAUUSD": [("DXY", rets.get("DXY")), ("juro real", yields.get("REAL10")), ("US10Y", yields.get("US10Y"))],
             "EURUSD": [("DXY", rets.get("DXY")), ("spread 2a EUA−Alemanha", spread)],
             "GBPUSD": [("DXY", rets.get("DXY"))],
             "GER40": [("S&P 500", rets.get("SPX"))],
             "NAS100": [("US10Y", yields.get("US10Y")), ("S&P 500", rets.get("SPX"))],
             "US30": [("S&P 500", rets.get("SPX"))],
             "BTCUSD": [("NAS100", rets.get("NAS100")), ("DXY", rets.get("DXY"))]}
    correlations = {}
    for sym, items in pairs.items():
        mine = rets.get(sym)
        if not mine:
            continue
        correlations[sym] = [{"with": label, "r": round(c, 2)} for label, other in items if other and (c := corr(mine, other)) is not None]
    vix = board["VIX"]["v"]
    regime = None if vix is None else "risk-off (medo alto)" if vix >= 25 else "nervoso" if vix >= 18 else "risk-on (calmo)"
    return {"board": board, "corr": correlations, "regime": regime}
