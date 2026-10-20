"""Fábrica Etsy (#/etsy): a loja de print-on-demand feita pelos agentes da cave, a partir de um reel (20 out, pedido do
David). Um lote é três passos, cada um um Claude sem sessão (o mesmo `ask_claude` da Sala de Trading):

- **Riddler** pesquisa na web o que está a vender na Etsy agora (a Etsy recusa pedidos de fora, 403) e devolve ideias;
- **Catwoman** desenha cada uma em SVG (tipografia e formas simples, fundo transparente), que o Chrome passa a PNG
  4500 x 5400 (o tamanho da frente de uma t-shirt na Printify);
- **Joker** escreve o anúncio: título, 13 tags, descrição e preço.

O **Alfred** é código: recusa marcas de terceiros, que são a forma mais rápida de a Etsy fechar a loja. Nada é publicado
sozinho: a pessoa aprova na página e põe na Etsy à mão até a loja estar ligada pela API. As vendas são as que a pessoa
regista (nunca números inventados). Tudo fica em ~/.team-agent/etsy/ deste PC; o interruptor gasta o plano Claude dele.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

from .tradingroom.council import ask_claude, claude_exe, parse_json

log = logging.getLogger(__name__)

DIR = Path.home() / ".team-agent" / "etsy"
FILE = DIR / "state.json"
W, H = 4500, 5400
DEFAULTS = {"on": False, "hour": 9, "per_run": 4, "model": "sonnet", "owner": ""}  # owner: quem recebe os avisos

# Marcas e personagens que não se vendem (Alfred). Em minúsculas; procura-se a palavra inteira.
BLOCKED = ["disney", "marvel", "pixar", "star wars", "harry potter", "hogwarts", "taylor swift", "swiftie", "eras tour",
           "stanley", "nike", "adidas", "grinch", "peanuts", "snoopy", "hello kitty", "sanrio", "pokemon", "pokémon",
           "barbie", "friends tv", "starbucks", "coca-cola", "nfl", "nba", "mlb", "nhl", "super bowl", "olympic",
           "mickey", "minnie", "stitch", "bluey", "sesame street", "looney tunes", "yellowstone", "gilmore",
           "stranger things", "beatles", "rolling stones", "metallica", "nirvana", "lululemon", "chanel", "gucci",
           "louis vuitton", "jeep", "harley", "john deere", "carhartt", "trump", "biden", "kamala"]

RIDDLER = """És o Riddler, o pesquisador da Empresa AMG. Encontras o que está a vender AGORA na Etsy em print-on-demand
(t-shirts, sweatshirts, canecas, sacos) para o público dos EUA e da Europa. Pesquisas na web: listas de best-sellers,
tendências da Etsy, eRank/EverBee/Marmalead, Pinterest, temporadas e datas próximas. Copiar desenhos de outros é proibido:
tiras o TEMA, a FRASE-TIPO e o PÚBLICO que vendem, nunca um desenho. Nada de marcas, personagens, celebridades, equipas,
filmes, séries ou letras de músicas. Respondes só com JSON."""

CATWOMAN = """És a Catwoman, a designer da Empresa AMG. Desenhas estampas para print-on-demand em SVG puro: tipografia
bonita e algumas formas simples (flores, estrelas, folhas, ondas, molduras) feitas com path/circle/rect. Regras do ficheiro:
- <svg xmlns="http://www.w3.org/2000/svg" width="4500" height="5400" viewBox="0 0 4500 5400">, fundo TRANSPARENTE
  (nada a cobrir a tela toda);
- só fontes do sistema: font-family com listas como "Georgia, 'Times New Roman', serif", "'Arial Black', Impact,
  sans-serif", "'Snell Roundhand', 'Brush Script MT', cursive", "'Courier New', monospace";
- sem <image>, sem <script>, sem foreignObject, sem links para fora, sem filtros pesados;
- o desenho ocupa o centro, com ~250 px de margem, legível de longe, 2 a 4 cores que fiquem bem na cor de peça indicada;
- texto em inglês, sem erros, sem marcas nem personagens.
Respondes só com o SVG, do <svg ao </svg>."""

JOKER = """És o Joker, o marketing da Empresa AMG. Escreves anúncios da Etsy que vendem, que a pesquisa da Etsy encontra e
que soam a uma pessoa a sério que tem uma loja pequena, nunca a uma IA:
- título até 140 caracteres, as palavras que as pessoas procuram primeiro, separadas por vírgulas, sem palavras vazias;
- exactamente 13 tags de até 20 caracteres (frases de 2-3 palavras, sem repetir o título palavra a palavra);
- descrição em inglês, na 1.ª pessoa do singular («I made this one for…»), concreta e com um pormenor verdadeiro sobre a
  ideia ou para quem é. Frases curtas e normais. PROIBIDO: «perfect for», «whether you're», «elevate», «unique», «stunning»,
  «must-have», «look no further», «cozy vibes», travessões longos (—), emojis, pontos de exclamação a mais, listas de
  adjectivos. Depois um bloco simples com o material e os cuidados (genéricos de print-on-demand, sem inventar medidas que
  não saibas) e a produção por encomenda. A última linha diz com naturalidade que o desenho é feito por ti com ferramentas
  digitais, incluindo IA, e revisto à mão (a Etsy obriga a dizer que há IA; diz-se uma vez, sem pedir desculpa);
- preço em euros que aguente a Printify (t-shirt ~12 € de custo, sweatshirt ~20 €, caneca ~7 €) mais ~6,5 % + 3 % da Etsy
  com pelo menos 8 € de margem, a acabar em ,90 ou ,50.
Nada de marcas. Respondes só com JSON."""


class Factory:
    def __init__(self):
        self.state = {"cfg": dict(DEFAULTS), "items": [], "runs": [], "sales": []}
        if FILE.exists():
            try:
                self.state.update(json.loads(FILE.read_text("utf-8")))
            except ValueError:
                log.warning("etsy: state.json estragado, começa vazio")
        self.state["cfg"] = {**DEFAULTS, **self.state["cfg"]}
        self.stage: dict | None = None   # quem está a trabalhar agora: {"who", "what", "at"}
        self.error = ""
        self.task: asyncio.Task | None = None

    def save(self):
        DIR.mkdir(parents=True, exist_ok=True)
        tmp = FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.state, ensure_ascii=False, indent=1), "utf-8")
        tmp.replace(FILE)

    def out(self) -> dict:
        items = sorted(self.state["items"], key=lambda i: -i["at"])
        sales = self.state["sales"]
        return {"cfg": self.state["cfg"], "stage": self.stage, "running": self.running, "error": self.error,
                "installed": claude_exe() is not None, "chrome": chrome() is not None,
                "items": items, "runs": self.state["runs"][-10:][::-1], "sales": sales[::-1][:50],
                "revenue": round(sum(s["amount"] for s in sales), 2),
                "counts": {k: sum(1 for i in items if i["status"] == k) for k in ("new", "approved", "published", "rejected", "blocked")}}

    @property
    def running(self) -> bool:
        return bool(self.task and not self.task.done())

    def set_cfg(self, body: dict):
        c = self.state["cfg"]
        if "on" in body:
            c["on"] = bool(body["on"])
        if "hour" in body:
            c["hour"] = max(0, min(23, int(body["hour"])))
        if "per_run" in body:
            c["per_run"] = max(1, min(8, int(body["per_run"])))
        if body.get("model") in ("haiku", "sonnet", "opus"):
            c["model"] = body["model"]
        self.save()

    def set_status(self, item_id: str, status: str):
        if status not in ("new", "approved", "published", "rejected"):
            raise ValueError("estado desconhecido")
        it = next((i for i in self.state["items"] if i["id"] == item_id), None)
        if not it:
            raise KeyError(item_id)
        it["status"] = status
        self.save()

    def add_sale(self, amount: float, note: str):
        if not 0 < amount < 100000:
            raise ValueError("valor inválido")
        self.state["sales"].append({"at": time.time(), "amount": round(amount, 2), "note": note[:200]})
        self.save()

    def start_rewrite(self, ids: list[str]) -> bool:
        """O Joker volta a escrever o anúncio destes desenhos (o tom mudou, ou o primeiro não ficou bom)."""
        if self.running:
            return False
        self.task = asyncio.create_task(self.rewrite(ids))
        return True

    async def rewrite(self, ids: list[str]):
        model, work = self.state["cfg"]["model"], DIR / "work"
        todo = [i for i in self.state["items"] if i["id"] in ids]
        try:
            for k, item in enumerate(todo, 1):
                self.stage = {"who": "joker", "what": f"A reescrever o anúncio de «{item['frase']}» ({k}/{len(todo)})", "at": time.time()}
                try:
                    text, _ = await ask_claude(JOKER, self.listing_prompt(item), model, work, timeout=180)
                    new = listing(parse_json(text) or {})
                    if new["titulo"] and len(new["tags"]) == 13:
                        item.update(new)
                        bad = alfred(item)
                        item.update(status="blocked", blocked=bad) if bad else item.pop("blocked", None)
                        self.save()
                except Exception as e:
                    log.exception("etsy: reescrever %s", item["id"])
                    self.error = str(e)[:300]
        finally:
            self.stage = None
            self.save()

    def start(self, reason: str) -> bool:
        if self.running:
            return False
        self.task = asyncio.create_task(self.run(reason))
        return True

    # ------------------------------------------------------------------ o lote
    async def run(self, reason: str):
        c = self.state["cfg"]
        model, n = c["model"], c["per_run"]
        run = {"at": time.time(), "reason": reason, "made": 0, "cost": 0.0, "error": ""}
        self.error = ""
        work = DIR / "work"
        try:
            self.stage = {"who": "riddler", "what": f"A pesquisar o que vende na Etsy ({n} ideias)", "at": time.time()}
            ideas, cost = await self.research(n, model, work)
            run["cost"] += cost
            for k, idea in enumerate(ideas, 1):
                item = {"id": f"{int(time.time())}-{k}", "at": time.time(), "status": "new", **idea}
                try:
                    self.stage = {"who": "catwoman", "what": f"A desenhar «{idea['frase']}» ({k}/{len(ideas)})", "at": time.time()}
                    svg, cost = await ask_claude(CATWOMAN, self.design_prompt(idea), model, work, timeout=300)
                    run["cost"] += cost
                    svg = clean_svg(svg)
                    folder = DIR / item["id"]
                    folder.mkdir(parents=True, exist_ok=True)
                    (folder / "design.svg").write_text(svg, "utf-8")
                    await asyncio.to_thread(render_png, folder / "design.svg", folder / "design.png")
                    self.stage = {"who": "joker", "what": f"A escrever o anúncio de «{idea['frase']}»", "at": time.time()}
                    text, cost = await ask_claude(JOKER, self.listing_prompt(idea), model, work, timeout=180)
                    run["cost"] += cost
                    item.update(listing(parse_json(text) or {}))
                    bad = alfred(item)
                    if bad:
                        item.update(status="blocked", blocked=bad)
                    self.state["items"].append(item)
                    run["made"] += 1
                    self.save()
                except Exception as e:   # uma ideia que falha não pára as outras
                    log.exception("etsy: ideia %s", idea.get("frase"))
                    run["error"] = str(e)[:200]
        except Exception as e:
            log.exception("etsy: lote")
            run["error"] = self.error = str(e)[:300]
        finally:
            self.stage = None
            run["cost"] = round(run["cost"], 3)
            self.state["runs"].append(run)
            del self.state["runs"][:-60]
            self.save()
        if run["made"]:
            await tell(f"Fábrica Etsy: {run['made']} desenhos novos para aprovar",
                       "O Riddler pesquisou, a Catwoman desenhou e o Joker escreveu os anúncios. Abre a Fábrica Etsy no Hub.")

    async def research(self, n: int, model: str, work: Path) -> tuple[list[dict], float]:
        today = datetime.now().strftime("%d %b %Y")
        done = [i.get("frase", "") for i in self.state["items"][-60:]]
        prompt = (f"Hoje é {today}. Pesquisa na web (no máximo 5 pesquisas) o que está a vender agora na Etsy em print-on-demand "
                  f"e o que vai vender nas próximas 3-6 semanas (datas, estações, públicos). Dá {n} ideias DIFERENTES entre si, "
                  "com procura comprovada e concorrência que uma loja nova consiga bater (nichos específicos, não 'funny shirt'). "
                  f"Não repitas estas, já feitas: {json.dumps(done, ensure_ascii=False)}.\n\n"
                  'Responde só com {"ideias": [{"nicho": "...", "frase": "o texto exacto da estampa, em inglês, curto", '
                  '"publico": "quem compra e para quem", "porque": "a prova de que vende, 1-2 frases, em português", '
                  '"produto": "t-shirt|sweatshirt|caneca|saco", "cor_peca": "cor da peça", "estilo": "como deve ser o desenho", '
                  '"fontes": ["url", ...]}]}')
        text, cost = await ask_claude(RIDDLER, prompt, model, work, timeout=420, tools="WebSearch")
        data = parse_json(text) or {}
        ideas = []
        for i in (data.get("ideias") or [])[:n]:
            if isinstance(i, dict) and str(i.get("frase") or "").strip():
                ideas.append({k: (i.get(k) if k == "fontes" else str(i.get(k) or "").strip()) for k in
                              ("nicho", "frase", "publico", "porque", "produto", "cor_peca", "estilo", "fontes")})
                ideas[-1]["fontes"] = [str(u) for u in (i.get("fontes") or []) if str(u).startswith("http")][:4]
        if not ideas:
            raise RuntimeError("o Riddler não trouxe ideias: " + text[:200])
        return ideas, cost

    @staticmethod
    def design_prompt(idea: dict) -> str:
        return (f"Estampa para {idea['produto'] or 't-shirt'} de cor {idea['cor_peca'] or 'branca'}.\n"
                f"Texto: \"{idea['frase']}\"\nPúblico: {idea['publico']}\nEstilo: {idea['estilo']}\n"
                "Faz um desenho que pareça de uma loja boa da Etsy, não um texto solto: hierarquia, uma ou duas ilustrações "
                "simples desenhadas com formas, composição centrada.")

    @staticmethod
    def listing_prompt(idea: dict) -> str:
        return (f"Anúncio da Etsy para uma {idea['produto'] or 't-shirt'} com a estampa \"{idea['frase']}\" "
                f"(nicho: {idea['nicho']}; público: {idea['publico']}).\n"
                'Responde só com {"titulo": "...", "tags": ["13 tags"], "descricao": "...", "preco_eur": 24.99, '
                '"produto_printify": "ex.: Bella+Canvas 3001 Unisex Jersey", "cores": ["cores da peça a oferecer"]}')


FACTORY = Factory()


def chrome() -> str | None:
    for p in ("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
              r"C:\Program Files\Google\Chrome\Application\chrome.exe",
              r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"):
        if Path(p).exists():
            return p
    return shutil.which("google-chrome") or shutil.which("chromium")


def clean_svg(text: str) -> str:
    m = re.search(r"<svg\b.*</svg>", text, re.S | re.I)
    if not m:
        raise RuntimeError("a Catwoman não devolveu um SVG")
    svg = m.group(0)
    if re.search(r"<script|<foreignObject|<image\b|(?:href|src)\s*=\s*[\"']\s*(?:https?:|data:|javascript:)", svg, re.I):
        raise RuntimeError("SVG com conteúdo proibido")
    return svg


def render_png(svg: Path, png: Path):
    """O SVG em PNG 4500 x 5400 transparente, pelo Chrome sem janela."""
    exe = chrome()
    if not exe:
        raise RuntimeError("falta o Google Chrome para passar o desenho a PNG")
    page = svg.with_suffix(".html")
    page.write_text("<!doctype html><html><head><style>html,body{margin:0;background:transparent}svg{display:block}"
                    f"</style></head><body>{svg.read_text('utf-8')}</body></html>", "utf-8")
    png.unlink(missing_ok=True)
    flags = 0x08000000 if sys.platform == "win32" else 0
    subprocess.run([exe, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
                    "--default-background-color=00000000", f"--window-size={W},{H}", f"--screenshot={png}",
                    page.as_uri()], capture_output=True, timeout=120, creationflags=flags)
    page.unlink(missing_ok=True)
    if not png.exists():
        raise RuntimeError("o Chrome não fez o PNG")


def listing(d: dict) -> dict:
    tags, seen = [], set()
    for t in d.get("tags") or []:
        t = re.sub(r"\s+", " ", str(t)).strip().lower()[:20].strip()
        if t and t not in seen:
            seen.add(t)
            tags.append(t)
    try:
        price = round(float(d.get("preco_eur") or 0), 2)
    except (TypeError, ValueError):
        price = 0.0
    return {"titulo": str(d.get("titulo") or "").strip()[:140], "tags": tags[:13], "descricao": str(d.get("descricao") or "").strip(),
            "preco": price, "printify": str(d.get("produto_printify") or "").strip(), "cores": [str(c) for c in (d.get("cores") or [])][:6]}


def alfred(item: dict) -> str:
    text = " ".join([item.get("frase", ""), item.get("titulo", ""), " ".join(item.get("tags", [])), item.get("descricao", "")]).lower()
    svg = DIR / item["id"] / "design.svg"
    if svg.exists():
        text += " " + re.sub(r"<[^>]+>", " ", svg.read_text("utf-8")).lower()
    hits = [b for b in BLOCKED if re.search(rf"(?<![a-z]){re.escape(b)}(?![a-z])", text)]
    if hits:
        return "Marca de terceiros: " + ", ".join(hits)
    if len(item.get("tags", [])) < 13 or not item.get("titulo"):
        return "Anúncio incompleto (título ou 13 tags)"
    return ""


async def tell(title: str, body: str):
    """Aviso para a pessoa deste PC (sino, widget e telemóvel)."""
    try:
        from sqlalchemy import select

        from . import services, sync
        from .db import SessionLocal
        from .models import User
        me = sync.whoami()
        who = me[1] if me else FACTORY.state["cfg"].get("owner")
        async with SessionLocal() as db:
            ids = [u.id for u in (await db.execute(select(User).where(User.username == who))).scalars()] if who else []
            if ids:
                await services.notify(db, ids, "etsy", "info", title, body, href="#/etsy")
                await db.commit()
    except Exception:
        log.exception("etsy: aviso")


async def loop():
    """De minuto a minuto: com o interruptor ligado, um lote por dia à hora marcada (hora de Lisboa)."""
    await asyncio.sleep(60)
    while True:
        try:
            c = FACTORY.state["cfg"]
            now = datetime.now()
            today = now.strftime("%Y-%m-%d")
            ran = any(datetime.fromtimestamp(r["at"]).strftime("%Y-%m-%d") == today and r["reason"] == "agenda"
                      for r in FACTORY.state["runs"])
            if c["on"] and not ran and now.hour >= c["hour"] and claude_exe():
                FACTORY.start("agenda")
            await asyncio.sleep(60)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("etsy: loop")
            await asyncio.sleep(60)
