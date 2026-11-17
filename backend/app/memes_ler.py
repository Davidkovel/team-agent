"""The Leitor (Memecoins): reads what the influencers really say, not only which coin they name.

17 nov, Marco: «não pode só dizer o que está lá no Telegram... tens mesmo que ler o que está escrito, ouvir o que eles dizem
nos vídeos deles... tudo nesse cérebro, super organizado, super funcional». For each influencer post:

1. **Ouvir**: its video or voice note is downloaded from the public page and transcribed on this PC (memes_ouvir.py,
   faster-whisper, niced, its own process). Two a pass, at most 15 min each; the file is deleted right after.
2. **Ver**: its photos (charts, screenshots of wallets) go to the Claude as images.
3. **Ler**: the Claude of this PC (council.ask_claude, the subscription) reads text + transcript + images of up to 10 posts in
   one call and says, for each: what kind of post it is (manda comprar, manda vender, aviso, mostra lucro de um call antigo,
   notícia, conversa), the coins, how sure he sounds (0-5), entry/target/stop when said, and one plain sentence.

What it found goes back into the post: coins heard in a video become the post's tickers/contracts, so the Robin looks them
up, the score counts them and the Alfred judges them as calls. A post that only shows the profit of an old call or tells to
sell is no buy call: the Alfred leaves it out of the ranking (`tipo` on the call).

Cost: one Claude call per ≤10 posts, capped by `ler_cap` a day (default 40). Off with `ler: false`.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import sys
import time
from pathlib import Path

import httpx

log = logging.getLogger("memes.ler")
TIPOS = {"compra", "venda", "aviso", "resultado", "noticia", "conversa"}
BUY = {"compra", None}          # the calls the Alfred judges: told to buy (or not read yet)
BATCH = 10
MAX_VIDEO = 80 * 1024 * 1024


def _now() -> float:
    return time.time()


def _dur_s(txt: str) -> int:
    """«1:02:03» / «4:21» → seconds."""
    n = 0
    for part in (txt or "0").split(":"):
        n = n * 60 + int(part or 0) if part.isdigit() else n
    return n


def tg_media(block: str) -> dict:
    """The video, voice note and photos of one message block of a t.me/s page (only the media, never a neighbour's)."""
    m: dict = {}
    v = re.search(r'<video src="([^"]+)"', block)
    if v:
        m["video"] = v.group(1)
        d = re.search(r'message_video_duration[^>]*>([\d:]+)<', block)
        m["dur"] = _dur_s(d.group(1)) if d else 0
    a = re.search(r'<audio[^>]*src="([^"]+)"', block) or re.search(r'tgme_widget_message_voice[^>]*src="([^"]+)"', block)
    if a:
        m["voice"] = a.group(1)
        d = re.search(r'message_voice_duration[^>]*>([\d:]+)<', block)
        m["dur"] = _dur_s(d.group(1)) if d else 0
    photos = re.findall(r"tgme_widget_message_photo_wrap[^>]*background-image:url\('([^']+)'\)", block)
    if photos:
        m["photos"] = list(dict.fromkeys(photos))[:3]
    return m


class Reader:
    """Lives inside memes.BRAIN's state: `reads` (post id → what the Claude read) and `heard` (post id → transcript)."""

    def __init__(self, brain):
        self.b = brain

    @property
    def reads(self) -> dict:
        return self.b.state.setdefault("reads", {})

    @property
    def heard(self) -> dict:
        return self.b.state.setdefault("heard", {})

    def queue(self) -> list[dict]:
        return [p for p in self.b.state["posts"] if p.get("inf") and p["id"] not in self.reads]

    def day_count(self) -> int:
        d = self.b.state.setdefault("ler_day", {"day": "", "n": 0})
        return d["n"] if d["day"] == time.strftime("%Y-%m-%d") else 0

    def _count(self):
        d = self.b.state.setdefault("ler_day", {"day": "", "n": 0})
        if d["day"] != time.strftime("%Y-%m-%d"):
            d.update(day=time.strftime("%Y-%m-%d"), n=0)
        d["n"] += 1

    # ---------- 1. ears ----------
    async def listen(self, c: httpx.AsyncClient, p: dict) -> str:
        from .memes import DIR
        from .memes_ouvir import available
        media = p.get("media") or {}
        url = media.get("video") or media.get("voice")
        if not url or p["id"] in self.heard:
            return self.heard.get(p["id"], {}).get("text", "")
        if not available():
            return ""
        if media.get("dur", 0) > 900:
            self.heard[p["id"]] = {"text": "", "note": "vídeo com mais de 15 min: não ouvido", "t": _now()}
            return ""
        f = DIR / "ler" / ("a_" + re.sub(r"\W", "_", p["id"]) + (".mp4" if media.get("video") else ".ogg"))
        f.parent.mkdir(parents=True, exist_ok=True)
        try:
            async with c.stream("GET", url, timeout=120) as r:
                r.raise_for_status()
                size = 0
                with f.open("wb") as out:
                    async for chunk in r.aiter_bytes():
                        size += len(chunk)
                        if size > MAX_VIDEO:
                            raise ValueError("vídeo grande demais")
                        out.write(chunk)
            backend = Path(__file__).resolve().parent.parent
            proc = await asyncio.create_subprocess_exec(sys.executable, "-m", "app.memes_ouvir", str(f), cwd=str(backend),
                                                        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
            try:
                out, _ = await asyncio.wait_for(proc.communicate(), timeout=900)
            except asyncio.TimeoutError:
                proc.kill()
                raise ValueError("a transcrição demorou demasiado")
            j = json.loads(out.decode("utf-8", "replace").strip().splitlines()[-1])
            self.heard[p["id"]] = {"text": j["text"][:6000], "lang": j.get("lang"), "dur": j.get("dur"), "t": _now()}
        except (httpx.HTTPError, ValueError, IndexError, KeyError, OSError) as e:
            # the link of a video expires: a failed one is tried again next pass, then given up
            fails = self.heard.get(p["id"], {}).get("fails", 0) + 1
            if fails >= 3:
                self.heard[p["id"]] = {"text": "", "note": f"não deu para ouvir: {type(e).__name__}", "t": _now()}
            else:
                log.info("ouvir %s: %s", p["id"], e)
                return ""
        finally:
            f.unlink(missing_ok=True)
        return self.heard[p["id"]].get("text", "")

    # ---------- 2-3. eyes and reading ----------
    async def _photos(self, c: httpx.AsyncClient, batch: list[dict]) -> dict[str, list[str]]:
        from .memes import DIR
        out: dict[str, list[str]] = {}
        d = DIR / "ler" / "img"
        d.mkdir(parents=True, exist_ok=True)
        for p in batch:
            for n, url in enumerate(((p.get("media") or {}).get("photos") or [])[:2]):
                try:
                    r = await c.get(url, timeout=30)
                    if r.status_code == 200 and len(r.content) < 8 * 1024 * 1024:
                        f = d / f"{re.sub(r'[^A-Za-z0-9]', '_', p['id'])}_{n}.jpg"
                        f.write_bytes(r.content)
                        out.setdefault(p["id"], []).append(f"img/{f.name}")
                except httpx.HTTPError:
                    pass
        return out

    async def read(self, c: httpx.AsyncClient, batch: list[dict]) -> int:
        from .memes import DIR
        from .tradingroom import council
        imgs = await self._photos(c, batch)
        parts = []
        for p in batch:
            h = self.heard.get(p["id"], {}).get("text", "")
            parts.append(f"### id={p['id']} | {p['src']} @{p['who']} | {time.strftime('%Y-%m-%d %H:%M', time.gmtime(p['t']))} UTC\n"
                         f"Texto: {p.get('full') or p['text'] or '(sem texto)'}\n"
                         + (f"O que diz no vídeo/áudio (transcrição automática, pode ter erros nos nomes): {h}\n" if h else "")
                         + (f"Imagens (lê-as com a ferramenta Read): {', '.join(imgs[p['id']])}\n" if imgs.get(p["id"]) else ""))
        system = ("És o Leitor da AMG: lês o que os influencers de memecoins publicam (texto, transcrição dos vídeos, imagens) e dizes, "
                  "em português de Portugal simples, o que cada publicação realmente diz. Não inventas: se não diz, deixas vazio.")
        prompt = ("Publicações:\n\n" + "\n".join(parts) + "\n\nPara cada uma, diz o tipo:\n"
                  "- compra: manda comprar/entrar agora numa moeda (um call)\n- venda: manda vender, sair ou tirar lucro\n"
                  "- aviso: avisa de perigo, rug, scam, para não comprar\n- resultado: mostra o lucro de um call que já fez antes (não é um call novo)\n"
                  "- noticia: notícia ou mercado em geral\n- conversa: o resto (bom dia, publicidade, piadas)\n"
                  "As moedas: o $TICKER e o contrato (endereço) se aparecer no texto, no vídeo ou na imagem; corrige nomes mal ouvidos só se "
                  "o resto deixar claro qual é. Não contes BTC, ETH, SOL nem ações.\n"
                  'Responde SÓ com JSON: {"posts": [{"id": "...", "tipo": "compra|venda|aviso|resultado|noticia|conversa", '
                  '"moedas": [{"symbol": "...", "address": ""}], "conviccao": 0-5, "entrada": "", "alvo": "", "stop": "", '
                  '"resumo": "uma frase simples: o que ele diz", "citacao": "a frase mais forte, curta, na língua original"}]}')
        self.b.busy = "leitor"
        try:
            text, cost = await council.ask_claude(system, prompt, self.b.cfg.get("ler_model") or "sonnet", DIR / "ler", timeout=300,
                                                  tools="Read" if imgs else "")
        finally:
            self.b.busy = ""
            for f in (DIR / "ler" / "img").glob("*.jpg"):
                f.unlink(missing_ok=True)
        self._count()
        j = council.parse_json(text) or {}
        got = {str(x.get("id")): x for x in j.get("posts") or [] if isinstance(x, dict)}
        n = 0
        for p in batch:
            x = got.get(p["id"])
            if not x:
                self.reads[p["id"]] = {"tipo": "conversa", "resumo": "", "moedas": [], "t": _now(), "miss": True}
                continue
            self.reads[p["id"]] = self.apply(p, x)
            n += 1
        self.b.state["ler_cost"] = round(self.b.state.get("ler_cost", 0) + cost, 3)
        return n

    def apply(self, p: dict, x: dict) -> dict:
        """What the Claude read, cleaned, and its coins put back in the post so the other agents use them."""
        from .memes import EVM_ADDR, MAJORS, NOT_MEME, SOL_ADDR
        from .memes_calls import STOCKS
        tipo = x.get("tipo") if x.get("tipo") in TIPOS else "conversa"
        coins = []
        for m in (x.get("moedas") or [])[:4]:
            if not isinstance(m, dict):
                continue
            sym = re.sub(r"[^A-Za-z0-9]", "", str(m.get("symbol") or "")).upper()[:12]
            addr = str(m.get("address") or "").strip()
            addr = addr if EVM_ADDR.fullmatch(addr) or SOL_ADDR.fullmatch(addr) else ""
            if (sym and (sym in MAJORS or sym in STOCKS or NOT_MEME.search(sym))) or not (sym or addr):
                continue
            coins.append({"symbol": sym, "address": addr})
        for m in coins:
            if m["symbol"] and m["symbol"] not in p["tickers"]:
                p["tickers"] = (p["tickers"] + [m["symbol"]])[:8]
            if m["address"] and m["address"] not in p["addrs"]:
                p["addrs"] = (p["addrs"] + [m["address"]])[:4]
        # the coins only the video or the picture named, for the Alfred's call_refs
        p["refs"] = " ".join([f"${m['symbol']}" for m in coins if m["symbol"]] + [m["address"] for m in coins if m["address"]])
        try:
            conv = max(0, min(5, int(x.get("conviccao") or 0)))
        except (TypeError, ValueError):
            conv = 0
        clip = lambda k, n=160: str(x.get(k) or "").strip()[:n]  # noqa: E731
        return {"tipo": tipo, "moedas": coins, "conviccao": conv, "entrada": clip("entrada", 60), "alvo": clip("alvo", 60),
                "stop": clip("stop", 60), "resumo": clip("resumo", 240), "citacao": clip("citacao", 200), "t": _now()}

    # ---------- one pass ----------
    async def run(self, c: httpx.AsyncClient):
        cfg = self.b.cfg
        from .tradingroom import council
        q = self.queue()
        heardn = 0
        for p in [p for p in q if (p.get("media") or {}).get("video") or (p.get("media") or {}).get("voice")]:
            if p["id"] in self.heard:
                continue
            self.b.busy = "leitor"
            await self.listen(c, p)
            heardn += 1
            if heardn >= 2:
                break
        # a post with a video waits for its transcript (or for having been given up on)
        ready = [p for p in q if not ((p.get("media") or {}).get("video") or (p.get("media") or {}).get("voice")) or p["id"] in self.heard]
        readn = 0
        if not cfg.get("ler", True):
            note = "desligado: só ouve os vídeos"
        elif not council.claude_exe():
            note = "o Claude Code não está instalado neste PC"
        elif self.day_count() >= cfg.get("ler_cap", 40):
            note = "chegou ao limite de leituras de hoje"
        else:
            note = ""
            for _ in range(2):   # two batches a pass at most
                batch = ready[readn:readn + BATCH]
                if not batch or self.day_count() >= cfg.get("ler_cap", 40):
                    break
                try:
                    readn += await self.read(c, batch)
                except Exception as e:  # noqa: BLE001
                    log.warning("ler: %s", e)
                    note = f"o Claude falhou: {str(e)[:120]}"
                    break
        ids = {p["id"] for p in self.b.state["posts"]}
        for k in [k for k in self.reads if k not in ids and _now() - self.reads[k]["t"] > 35 * 86400]:
            self.reads.pop(k)
        for k in [k for k in self.heard if k not in ids and _now() - self.heard[k]["t"] > 35 * 86400]:
            self.heard.pop(k)
        left = len(self.queue())
        bits = [f"{readn} publicações lidas"] + ([f"{heardn} vídeos ouvidos"] if heardn else []) + ([f"{left} por ler"] if left else []) + ([note] if note else [])
        self.b.run_mark("leitor", not note.startswith("o Claude falhou"), readn + heardn, "; ".join(bits))
