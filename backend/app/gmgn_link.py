"""The GMGN tracker (github.com/Davidkovel/gmgn-tracker) seen from the Hub: its signals, the paper trades and the
numbers of each strategy (tier), read-only from its SQLite gmgn.db. Standard library only, so the same file runs in two
places:

- inside the Hub (memes.py), when the gmgn.db is on this computer (`~/.team-agent/gmgn-tracker/gmgn.db` or the path
  set on the Memecoins page);
- on the tracker's server, next to gmgn.db, as a tiny read-only JSON service the Hubs read over the network:

      python3 gmgn_link.py serve --db /root/gmgn-tracker/gmgn.db --port 8787 --key <a long secret>

  then on the Memecoins page: Motor GMGN > endereço `http://<server>:8787` and the same key.

Nothing here writes to gmgn.db: it is opened `mode=ro`, so the tracker's own rules (CLAUDE.md there) are untouched."""
from __future__ import annotations

import json
import sqlite3
import sys
import time
from pathlib import Path

TIERS = {  # short neutral names for the tracker's tiers (its own repository is private: no parameters here)
    "news": "Notícia", "launch": "Arranque", "flip": "Flip", "mid": "Médias", "big": "Grandes", "surge": "Pico de volume",
    "mig": "Migração", "paid": "Dex paid", "cto": "CTO", "dip": "Segunda entrada",
}
ACTIONS = {"ВХОД": "Entrar", "СМОТРЕТЬ": "Ver", "ПРОПУСК": "Saltar", "УЧУСЬ": "A aprender", "ПОЗДНО": "Tarde"}


def _open(db: str | Path) -> sqlite3.Connection:
    c = sqlite3.connect(f"file:{Path(db).as_posix()}?mode=ro", uri=True, timeout=10)
    c.row_factory = sqlite3.Row
    return c


def _cols(c, table: str) -> set[str]:
    return {r[1] for r in c.execute(f"PRAGMA table_info({table})")}


def summary(db: str | Path, days: float = 7) -> dict:
    """Everything the Memecoins page shows of the tracker: totals, strategies, latest signals."""
    c = _open(db)
    try:
        now = time.time()
        since = now - days * 86400
        acols = _cols(c, "alerts")
        has_paper = "paper" in acols
        tokens = c.execute("SELECT COUNT(*) FROM tokens").fetchone()[0]
        new24 = c.execute("SELECT COUNT(*) FROM tokens WHERE created_ts > ?", (now - 86400,)).fetchone()[0]
        last = c.execute("SELECT MAX(created_ts) FROM tokens").fetchone()[0]
        tiers = []
        for r in c.execute("""SELECT tier, COUNT(*) n, SUM(outcome='win') w, SUM(outcome='loss') l, SUM(outcome='open') o
                              FROM entries WHERE ts > ? GROUP BY tier""", (since,)):
            row = {"tier": r["tier"], "name": TIERS.get(r["tier"], r["tier"]), "entries": r["n"], "wins": r["w"] or 0,
                   "losses": r["l"] or 0, "open": r["o"] or 0}
            if has_paper:  # the $100 paper trades of the tier, and whether both halves of the period are in plus
                v = [x[0] for x in c.execute("SELECT paper FROM alerts WHERE tier=? AND paper IS NOT NULL AND ts > ? ORDER BY ts",
                                              (r["tier"], since))]
                half = len(v) // 2
                row.update(paper_n=len(v), paper_usd=round(sum(v) * 100, 1) if v else None,
                           paper_avg=round(sum(v) / len(v) * 100, 1) if v else None,
                           both_halves=bool(half) and sum(v[:half]) > 0 and sum(v[half:]) > 0)
            tiers.append(row)
        tiers.sort(key=lambda x: -(x.get("paper_usd") or 0))
        pick = "a.paper, a.peak_x, a.mc_now," if has_paper else "NULL paper, NULL peak_x, NULL mc_now,"
        signals = [{"mint": r["mint"], "symbol": r["symbol"], "name": r["name"], "tier": r["tier"],
                    "tier_name": TIERS.get(r["tier"], r["tier"]), "ts": r["ts"], "mc": r["mc"], "action": ACTIONS.get(r["action"], r["action"]),
                    "p_win": r["p_win"], "sent": bool(r["sent"]), "paper_usd": None if r["paper"] is None else round(r["paper"] * 100, 1),
                    "peak_x": r["peak_x"], "twitter": r["twitter"], "last_mc": r["last_mc"]}
                   for r in c.execute(f"""SELECT a.mint, a.tier, a.ts, a.mc, a.action, a.p_win, a.sent, {pick}
                                          t.symbol, t.name, t.twitter, t.last_mc
                                          FROM alerts a LEFT JOIN tokens t USING(mint)
                                          WHERE a.action != 'ПОЗДНО' ORDER BY a.ts DESC LIMIT 40""")]
        paper = c.execute("SELECT COUNT(*), SUM(paper), SUM(paper > 0) FROM alerts WHERE paper IS NOT NULL AND ts > ?", (since,)).fetchone() if has_paper else (0, None, 0)
        wallets = c.execute("SELECT COUNT(*) FROM wallets WHERE verdict IN ('Сильный','Хороший')").fetchone()[0]
        x_handles = c.execute("SELECT COUNT(*) FROM twitters").fetchone()[0]
        return {"ok": True, "at": now, "days": days, "tokens": tokens, "new24": new24, "last_token": last, "tiers": tiers,
                "signals": signals, "paper": {"n": paper[0] or 0, "usd": round((paper[1] or 0) * 100, 1), "wins": paper[2] or 0},
                "good_wallets": wallets, "x_handles": x_handles}
    finally:
        c.close()


def serve(db: str, port: int, key: str):
    """The read-only service for the Hubs: GET /summary?days=7 with the header X-Key."""
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
    from urllib.parse import parse_qs, urlparse

    class H(BaseHTTPRequestHandler):
        def do_GET(self):
            u = urlparse(self.path)
            if self.headers.get("X-Key") != key:
                return self._send(401, {"ok": False, "error": "chave errada"})
            if u.path != "/summary":
                return self._send(404, {"ok": False})
            days = float((parse_qs(u.query).get("days") or ["7"])[0])
            try:
                self._send(200, summary(db, max(1.0, min(60.0, days))))
            except Exception as e:  # noqa: BLE001
                self._send(500, {"ok": False, "error": str(e)[:200]})

        def _send(self, code, body):
            raw = json.dumps(body, ensure_ascii=False).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def log_message(self, *a):
            pass

    print(f"gmgn_link: {db} em http://0.0.0.0:{port}/summary", flush=True)
    ThreadingHTTPServer(("0.0.0.0", port), H).serve_forever()


if __name__ == "__main__":
    a = sys.argv[1:]
    if a[:1] == ["serve"]:
        opt = {a[i].lstrip("-"): a[i + 1] for i in range(1, len(a) - 1, 2)}
        if len(opt.get("key", "")) < 16:
            sys.exit("--key com pelo menos 16 caracteres")
        serve(opt.get("db", "gmgn.db"), int(opt.get("port", 8787)), opt["key"])
    else:
        print(json.dumps(summary(a[0] if a else "gmgn.db"), ensure_ascii=False, indent=1)[:4000])
