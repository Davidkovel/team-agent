"""The backtest of the SMC model: the room's own reading and its own book, replayed over the past.

Candle by candle (M5), the room sees only what it would have seen at that minute: the closed candles of each timeframe
and, for the higher ones, the candle still forming, built from the M5 candles closed so far. Each armed A/A+ setup
places the order the live room would place (`room.model_trade`) and the book follows it with the same rules
(`book.Book`): spread, stop first when a candle touches both, half off at the 1st target.

What it cannot replay: the two agents (they read the news and search the web) and the news filter of the model's
score (there is no calendar of the past here).

By hand, from `backend/`: `python -m app.tradingroom.backtest`
"""
import asyncio
import json
import os
import subprocess
import sys
import time
from bisect import bisect_left, bisect_right
from datetime import datetime, timezone
from pathlib import Path

from . import analysis
from .book import ACTIVE, DONE, Book
from .markets import INSTRUMENTS, TF, TF_SECONDS, tv_candles

UTC = timezone.utc
# how much past to ask for: M5 sets the length of the test, the others need their 300 candles before its first day
BARS = {"M5": 5000, "M15": 2600, "H1": 1100, "H4": 700, "D1": 400}
WARM = 300   # M5 candles read before the first order


class Replay:
    """The candle store as it was at `now`."""

    def __init__(self, data: dict):
        self.data = data
        self.times = {k: [r[0] for r in v] for k, v in data.items()}
        self.now = 0.0
        self.cache: dict = {}

    def get(self, i: str, tf: str) -> list[tuple]:
        key = (i, tf)
        hit = self.cache.get(key)
        if hit and hit[0] == self.now:
            return hit[1]
        rows, ts, sec = self.data.get(key, []), self.times.get(key, []), TF_SECONDS[tf]
        n = bisect_right(ts, self.now - sec)   # closed: opened a whole candle ago
        out = rows[max(0, n - TF[tf][1]):n]
        if tf != "M5" and n < len(rows) and ts[n] < self.now:   # the one forming, from the M5 candles closed so far
            m5, m5t = self.data.get((i, "M5"), []), self.times.get((i, "M5"), [])
            seg = m5[bisect_left(m5t, ts[n]):bisect_right(m5t, self.now - 300)]
            if seg:
                out = out + [(ts[n], seg[0][1], max(c[2] for c in seg), min(c[3] for c in seg), seg[-1][4], sum(c[5] for c in seg))]
        self.cache[key] = (self.now, out)
        return out


def replay(data: dict, progress=None) -> dict:
    """Runs the model over `data` ({(instrument, timeframe): candles}) and returns the scoreboard and every trade."""
    from .room import model_trade
    store, book, old, seen, view = Replay(data), Book({"trades": []}), [], set(), {}
    closes: dict[float, list[dict]] = {}
    for inst in INSTRUMENTS:
        for r in data.get((inst["id"], "M5"), [])[WARM:]:
            closes.setdefault(r[0] + 300, []).append(inst)
    steps = sorted(closes)
    for n, ts in enumerate(steps):
        store.now, now, fresh = ts, datetime.fromtimestamp(ts, UTC), []
        for inst in closes[ts]:
            a = analysis.analyse(inst, store, [], now)
            if a:
                view[inst["id"]] = a
                fresh.append(a)
        book.update(store, now)
        for a in fresh:
            for st in a["setups"]:
                key = f"model:{a['id']}:{st['key']}"
                if st["grade"] in ("A+", "A") and st["status"] == "armed" and st["age"] <= 3 and key not in seen:
                    seen.add(key)
                    for t in book.propose("model", [model_trade(a, st, now)], None, view, now, key):
                        t["id"], t["tf"] = len(seen), st["tf"]
        if len(book.trades) > 200:   # the book keeps 600: the finished ones wait outside
            old += [t for t in book.trades if t["status"] not in ACTIVE]
            book.state["trades"] = [t for t in book.trades if t["status"] in ACTIVE]
        if progress and n % 200 == 0:
            progress(n / len(steps))
    trades = sorted(old + book.trades, key=lambda t: t["at"])
    stats = Book({"trades": list(trades)}).stats("model")

    def group(field):
        out = {}
        for t in trades:
            if t["status"] in DONE:
                g = out.setdefault(str(t.get(field)), {"n": 0, "w": 0, "l": 0, "r": 0.0})
                g["n"] += 1
                g["w"] += t["r"] > .05
                g["l"] += t["r"] < -.05
                g["r"] = round(g["r"] + t["r"], 2)
        return out
    counts: dict[str, int] = {}
    for t in trades:
        counts[t["status"]] = counts.get(t["status"], 0) + 1
    keep = ("id", "at", "symbol", "dir", "tf", "grade", "entry", "stop", "tp1", "tp2", "status", "r", "note", "filled_at", "closed_at", "mfe", "mae", "rr", "dp")
    return {"from": steps[0] if steps else None, "to": steps[-1] if steps else None, "days": round((steps[-1] - steps[0]) / 86400, 1) if steps else 0,
            "candles": len(steps), "setups": len(seen), "counts": counts, "stats": stats,
            "by_grade": group("grade"), "by_tf": group("tf"), "by_dir": group("dir"),
            "trades": [{k: t.get(k) for k in keep} for t in trades]}


async def history() -> dict:
    """The past of every instrument, from the chart feed: {(instrument, timeframe): candles}."""
    async def one(inst):
        got = await tv_candles([(inst["tv"], tf) for tf in TF], seconds=45, bars=BARS)
        return {(inst["id"], tf): got.get((inst["tv"], tf), []) for tf in TF}
    data: dict = {}
    todo = list(INSTRUMENTS)
    for _ in range(3):   # the feed sometimes drops one: ask again for what is missing
        for part in await asyncio.gather(*(one(i) for i in todo)):
            data.update({k: v for k, v in part.items() if len(v) > 30})
        todo = [i for i in todo if any((i["id"], tf) not in data for tf in TF)]
        if not todo:
            break
    return {k: v for k, v in data.items() if k[0] not in {i["id"] for i in todo}}


# ---------------------------------------------------------------- one run at a time, kept in a file
# The Hub starts it as a separate, low-priority process (minutes of pure calculation would stall the Hub itself).
PROC: subprocess.Popen | None = None


def _file(name: str = "backtest.json"):
    from .room import DIR
    return DIR / name


def _put(name: str, obj: dict):
    f = _file(name)
    f.parent.mkdir(parents=True, exist_ok=True)
    tmp = f.with_suffix(".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False), "utf-8")
    os.replace(tmp, f)


def _get(name: str) -> dict | None:
    try:
        return json.loads(_file(name).read_text("utf-8"))
    except (OSError, ValueError):
        return None


def last() -> dict | None:
    return _get("backtest.json")


def status() -> dict:
    running = PROC is not None and PROC.poll() is None
    job = _get("backtest.job.json") or {}
    return {"running": running, "progress": job.get("progress", 0) if running else 0,
            "error": None if running else job.get("error") or ("o teste parou a meio" if PROC is not None and PROC.returncode else None)}


def start() -> bool:
    """Starts a run in the background; False when one is already running."""
    global PROC
    if PROC is not None and PROC.poll() is None:
        return False
    _put("backtest.job.json", {"progress": 0})
    flags = (subprocess.BELOW_NORMAL_PRIORITY_CLASS | subprocess.CREATE_NO_WINDOW) if os.name == "nt" else 0
    PROC = subprocess.Popen([sys.executable, "-m", "app.tradingroom.backtest"], cwd=Path(__file__).resolve().parents[2],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=flags)
    return True


async def run() -> dict | None:
    try:
        data = await history()
        if not any(k[1] == "M5" for k in data):
            raise RuntimeError("sem velas da TradingView")
        res = await asyncio.to_thread(replay, data, lambda p: _put("backtest.job.json", {"progress": round(p, 3)}))
        res["at"] = datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")
        res["instruments"] = sorted({k[0] for k in data if k[1] == "M5"})
        _put("backtest.json", res)
        _put("backtest.job.json", {"progress": 1})
        return res
    except Exception as exc:
        _put("backtest.job.json", {"error": f"{type(exc).__name__}: {exc}"[:200]})
        return None


if __name__ == "__main__":
    t0 = time.time()
    out = asyncio.run(run())
    if not out:
        raise SystemExit((_get("backtest.job.json") or {}).get("error") or "nada")
    s = out["stats"]
    print(f"{out['days']} dias, {out['candles']} velas M5, {out['setups']} setups, {time.time() - t0:.0f} s")
    print({k: s[k] for k in ("n", "wins", "losses", "be", "winrate", "total_r", "avg_r", "pf", "max_dd", "return_pct")})
    print("estado", out["counts"])
    for name in ("by_grade", "by_tf", "by_dir"):
        print(name, out[name])
    print("por instrumento", s["by_symbol"])
