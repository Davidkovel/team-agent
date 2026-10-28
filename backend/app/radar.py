"""Radar (#/radar): a máquina de prospeção. Dá-se um ramo (escolas de condução, ginásios...) e uma zona; o Radar encontra os
negócios (OpenStreetMap, e o Google Places se houver GOOGLE_PLACES_KEY no backend/.env), abre o site de cada um, vê o que
está bem e mal, estima o que gastam com o digital pelo que o site mostra e ordena-os por oportunidade. Cada problema vem
com a solução que vendemos (feedback do Marco: problema → solução, à primeira).

Regras: só o que se vê no site público nesse dia; o gasto é uma estimativa a preços de mercado a partir de sinais visíveis
(plataforma, tag de anúncios, crédito de agência), nunca uma fatura. Tudo fica em ~/.team-agent/radar/ deste PC."""
from __future__ import annotations

import asyncio
import base64
import html
import json
import os
import re
import time
import unicodedata
import urllib.parse
import uuid
from pathlib import Path

import httpx

DIR = Path.home() / ".team-agent" / "radar"
UA_BOT = "team-agent-hub/1.0 (radar de prospecao)"
UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile Safari/604.1"
MAX = 300

# ramo -> (nome, filtros OSM, pesquisa no Google)
RAMOS = {
    "escolas": ("Escolas de condução", ['nwr["amenity"="driving_school"]', 'nwr["name"~"escola de condu|auto[- ]?escola|drive school",i]'], "escola de condução"),
    "ginasios": ("Ginásios", ['nwr["leisure"="fitness_centre"]', 'nwr["sport"="fitness"]'], "ginásio"),
    "restaurantes": ("Restaurantes", ['nwr["amenity"="restaurant"]'], "restaurante"),
    "cabeleireiros": ("Cabeleireiros e estética", ['nwr["shop"="hairdresser"]', 'nwr["shop"="beauty"]'], "cabeleireiro"),
    "dentistas": ("Dentistas e clínicas", ['nwr["amenity"="dentist"]', 'nwr["amenity"="clinic"]'], "clínica dentária"),
    "imobiliarias": ("Imobiliárias", ['nwr["office"="estate_agent"]', 'nwr["shop"="estate_agent"]'], "imobiliária"),
    "oficinas": ("Oficinas", ['nwr["shop"="car_repair"]'], "oficina automóvel"),
}

# qualquer ramo escrito à mão (28 out, Marco: «todas as empresas, não só as escolas de condução»): palavra -> filtros do mapa.
# O que não estiver aqui procura-se pelo nome; o que estiver junta as duas coisas.
TIPOS = {
    "escola de conducao": RAMOS["escolas"][1], "auto escola": RAMOS["escolas"][1], "driving school": RAMOS["escolas"][1],
    "ginasio": RAMOS["ginasios"][1], "academia": RAMOS["ginasios"][1], "fitness": RAMOS["ginasios"][1], "crossfit": RAMOS["ginasios"][1],
    "gym": RAMOS["ginasios"][1], "pilates": ['nwr["name"~"pilates",i]'], "yoga": ['nwr["name"~"yoga",i]', 'nwr["sport"="yoga"]'],
    "restaurante": ['nwr["amenity"="restaurant"]'], "restaurant": ['nwr["amenity"="restaurant"]'], "pizzaria": ['nwr["amenity"="restaurant"]["cuisine"~"pizza"]'],
    "hamburgueria": ['nwr["amenity"~"restaurant|fast_food"]["cuisine"~"burger"]'], "sushi": ['nwr["amenity"="restaurant"]["cuisine"~"sushi|japanese"]'],
    "cafe": ['nwr["amenity"="cafe"]'], "snack": ['nwr["amenity"~"cafe|fast_food"]'], "bar": ['nwr["amenity"~"^(bar|pub)$"]'],
    "pastelaria": ['nwr["shop"~"pastry|bakery"]', 'nwr["amenity"="cafe"]["name"~"pastelaria",i]'], "padaria": ['nwr["shop"="bakery"]'], "bakery": ['nwr["shop"="bakery"]'],
    "cabeleireiro": RAMOS["cabeleireiros"][1], "barbearia": ['nwr["shop"="hairdresser"]'], "barber": ['nwr["shop"="hairdresser"]'],
    "estetica": ['nwr["shop"="beauty"]'], "beleza": ['nwr["shop"="beauty"]'], "unhas": ['nwr["shop"="beauty"]'], "spa": ['nwr["leisure"="spa"]', 'nwr["shop"="beauty"]["beauty"~"spa"]'],
    "tatuagem": ['nwr["shop"="tattoo"]'], "tattoo": ['nwr["shop"="tattoo"]'],
    "dentista": ['nwr["amenity"="dentist"]'], "dentaria": ['nwr["amenity"="dentist"]'], "dentist": ['nwr["amenity"="dentist"]'],
    "clinica dentaria": ['nwr["amenity"="dentist"]'], "clinica veterinaria": ['nwr["amenity"="veterinary"]'],
    "clinica": ['nwr["amenity"~"^(clinic|doctors|dentist)$"]', 'nwr["healthcare"]'], "medico": ['nwr["amenity"~"^(clinic|doctors)$"]'],
    "fisioterapia": ['nwr["healthcare"="physiotherapist"]'], "psicologo": ['nwr["healthcare"="psychotherapist"]'], "nutricionista": ['nwr["healthcare"="nutrition_counselling"]'],
    "farmacia": ['nwr["amenity"="pharmacy"]'], "veterinario": ['nwr["amenity"="veterinary"]'], "optica": ['nwr["shop"="optician"]'],
    "imobiliaria": RAMOS["imobiliarias"][1], "real estate": RAMOS["imobiliarias"][1], "advogado": ['nwr["office"="lawyer"]'], "lawyer": ['nwr["office"="lawyer"]'],
    "contabilista": ['nwr["office"~"accountant|tax_advisor"]'], "contabilidade": ['nwr["office"~"accountant|tax_advisor"]'], "seguros": ['nwr["office"="insurance"]'],
    "arquiteto": ['nwr["office"="architect"]'], "arquitecto": ['nwr["office"="architect"]'], "construcao": ['nwr["craft"="builder"]', 'nwr["office"="construction_company"]'],
    "construtora": ['nwr["craft"="builder"]', 'nwr["office"="construction_company"]'], "remodelacoes": ['nwr["craft"="builder"]'],
    "canalizador": ['nwr["craft"="plumber"]'], "eletricista": ['nwr["craft"="electrician"]'], "carpintaria": ['nwr["craft"="carpenter"]'],
    "serralharia": ['nwr["craft"="metal_construction"]'], "pintor": ['nwr["craft"="painter"]'], "jardinagem": ['nwr["craft"="gardener"]'],
    "oficina": RAMOS["oficinas"][1], "mecanico": RAMOS["oficinas"][1], "stand": ['nwr["shop"="car"]'], "carros usados": ['nwr["shop"="car"]'],
    "pneus": ['nwr["shop"="tyres"]'], "lavagem": ['nwr["amenity"="car_wash"]'], "rent a car": ['nwr["amenity"="car_rental"]'],
    "hotel": ['nwr["tourism"="hotel"]'], "alojamento": ['nwr["tourism"~"guest_house|hostel|apartment|hotel"]'], "hostel": ['nwr["tourism"="hostel"]'],
    "turismo rural": ['nwr["tourism"~"guest_house|chalet"]'],
    "roupa": ['nwr["shop"~"clothes|boutique"]'], "boutique": ['nwr["shop"~"clothes|boutique"]'], "sapataria": ['nwr["shop"="shoes"]'],
    "florista": ['nwr["shop"="florist"]'], "moveis": ['nwr["shop"="furniture"]'], "mobiliario": ['nwr["shop"="furniture"]'], "decoracao": ['nwr["shop"~"interior_decoration|furniture"]'],
    "eletrodomesticos": ['nwr["shop"~"electronics|appliance"]'], "telemoveis": ['nwr["shop"="mobile_phone"]'], "informatica": ['nwr["shop"="computer"]'],
    "joalharia": ['nwr["shop"="jewelry"]'], "ourivesaria": ['nwr["shop"="jewelry"]'], "supermercado": ['nwr["shop"="supermarket"]'], "mercearia": ['nwr["shop"~"convenience|greengrocer"]'],
    "talho": ['nwr["shop"="butcher"]'], "garrafeira": ['nwr["shop"="wine"]'], "vinhos": ['nwr["shop"="wine"]', 'nwr["craft"="winery"]'], "adega": ['nwr["craft"="winery"]'],
    "pet shop": ['nwr["shop"="pet"]'], "animais": ['nwr["shop"="pet"]', 'nwr["amenity"="veterinary"]'],
    "agencia de viagens": ['nwr["shop"="travel_agency"]'], "lavandaria": ['nwr["shop"~"laundry|dry_cleaning"]'],
    "creche": ['nwr["amenity"~"kindergarten|childcare"]'], "infantario": ['nwr["amenity"~"kindergarten|childcare"]'],
    "explicacoes": ['nwr["amenity"="prep_school"]'], "escola de linguas": ['nwr["amenity"="language_school"]'], "danca": ['nwr["amenity"="dancing_school"]', 'nwr["leisure"="dance"]'],
    "software": ['nwr["office"~"^(it|software|telecommunication)$"]'], "tecnologia": ['nwr["office"~"^(it|software)$"]'],
    "marketing": ['nwr["office"~"advertising_agency|marketing"]'], "publicidade": ['nwr["office"="advertising_agency"]'], "consultoria": ['nwr["office"="consulting"]'],
    "transporte": ['nwr["office"~"logistics|courier|moving_company"]'], "mudancas": ['nwr["office"="moving_company"]'], "limpeza": ['nwr["office"="cleaning"]', 'nwr["craft"="cleaning"]'],
    "musica": ['nwr["amenity"="music_school"]'], "fotografo": ['nwr["craft"="photographer"]', 'nwr["shop"="photo"]'], "grafica": ['nwr["shop"="copyshop"]', 'nwr["craft"="printer"]'],
}


def _filtros(termo: str) -> list[str]:
    """Os filtros do mapa para um ramo escrito à mão: os tipos que a frase menciona e o nome (a palavra mais própria)."""
    t = _norm(termo)
    t1 = re.sub(r"s\b", "", t)  # «ginásios» -> «ginasio», «clínicas dentárias» -> «clinica dentaria»
    keys = [k for k in TIPOS if re.search(rf"\b{k}", t) or re.search(rf"\b{k}", t1)]
    keys = [k for k in keys if not any(k != o and k in o for o in keys)]  # «clínica dentária» ganha à «clínica»
    out = []
    for k in keys:
        out += [f for f in TIPOS[k] if f not in out]
    words = [w for w in t1.split() if len(w) > 3 and w not in GENERIC | {"loja", "lojas", "empresa", "empresas", "servico", "servicos"}]
    out = [f for f in out if not any(g != f and g.startswith(f) for g in out)]  # «restaurantes de sushi»: só os de sushi
    tagged = bool(out)
    if words and (not tagged or len(max(words, key=len)) >= 7):  # com tipo achado, uma palavra curta pelo nome só traz ruído («roupa» -> «Garoupa»)
        w = max(words, key=len)[:-1]  # sem a última letra: apanha plural e masculino/feminino
        acc = {"a": "[aáàâã]", "e": "[eéê]", "i": "[ií]", "o": "[oóôõ]", "u": "[uú]", "c": "[cç]"}  # o mapa escreve com acentos
        out.append('nwr["name"~"' + "".join(acc.get(ch, ch) for ch in w) + '",i]')
    return out


# o caminho de um contacto, por ordem
ESTADOS = {"por_contactar": "Por contactar", "contactado": "Contactado", "respondeu": "Respondeu", "reuniao": "Reunião marcada",
           "fechou": "Fechou", "nao": "Não quer"}

# resultados de pesquisa que não são o site do negócio (diretórios, redes, mapas)
NOT_SITE = re.compile(r"facebook|instagram|crossfit\.com|treatwell|fresha|booksy|linktr\.ee|youtube|linkedin|tiktok|twitter|x\.com|google\.|bomcondutor|escolasconducao|drivingschools|"
                      r"escola-de-conducao\.pt|schoolandcollege|pai\.pt|paginasamarelas|tripadvisor|zomato|cylex|infoempresas|racius|einforma|"
                      r"guiaempresas|yelp|booking\.com|olx\.|wikipedia|portugalio|kompass|nif\.pt|empresite|guia-empresas|maps\.|waze|"
                      r"theFork|thefork|uber|glovo|imt-ip|dre\.pt|sapo\.pt/|cmjornal|jn\.pt|publico\.pt|noticias", re.I)
GENERIC = {"escola", "escolas", "conducao", "de", "da", "do", "dos", "das", "e", "lda", "unipessoal", "auto", "centro", "the", "ginasio",
           "restaurante", "cabeleireiro", "clinica", "dentaria", "imobiliaria", "oficina", "studio", "estudio"}

# plataforma -> (padrão no HTML, €/mês mín, máx) — preços públicos dos planos, out 2026
PLATS = [
    ("Wix", r"wixstatic|_wixCssImports|static\.parastorage", 17, 36),
    ("Squarespace", r"squarespace", 16, 49),
    ("Shopify", r"cdn\.shopify\.com|Shopify\.theme", 29, 79),
    ("Webflow", r"webflow", 14, 39),
    ("WordPress", r"wp-content|wp-includes", 5, 30),
    ("Joomla", r"/media/jui/|joomla", 5, 25),
    ("GoDaddy", r"img1\.wsimg\.com|godaddy", 10, 25),
    ("Jimdo", r"jimdo", 9, 20),
    ("Site123", r"site123", 13, 20),
]


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def _has(p: str, s: str) -> bool:
    return bool(re.search(p, s, re.I))


class Radar:
    def __init__(self):
        DIR.mkdir(parents=True, exist_ok=True)
        self.jobs: dict[str, dict] = {}  # id -> progresso de uma varredura a correr
        self._tasks: set = set()  # guarda as tarefas para o asyncio não as largar a meio

    # ---------- guardar ----------
    def _path(self, sid: str) -> Path:
        if not re.fullmatch(r"[a-f0-9]{12}", sid or ""):
            raise ValueError("varredura desconhecida")
        return DIR / f"{sid}.json"

    def get(self, sid: str) -> dict:
        p = self._path(sid)
        if not p.exists():
            raise ValueError("varredura desconhecida")
        out = json.loads(p.read_text("utf-8"))
        out["job"] = self.jobs.get(sid)
        leads = self._leads()
        for n in out.get("negocios", []):
            n["lead"] = leads.get(self.lead_key(out["ramo"], n["nome"]))
        return out

    # ---------- seguimento: quem foi contactado, respondeu, fechou ----------
    # guardado por ramo + nome, por isso sobrevive a varreduras novas da mesma zona
    @staticmethod
    def lead_key(ramo: str, nome: str) -> str:
        return f"{ramo}:{' '.join(sorted(w for w in _norm(nome).split() if w not in GENERIC)) or _norm(nome)}"

    def _leads(self) -> dict:
        try:
            return json.loads((DIR / "seguimento.json").read_text("utf-8"))
        except (OSError, ValueError):
            return {}

    def set_lead(self, sid: str, nid: str, estado: str, nota: str | None, who: str) -> dict:
        if estado not in ESTADOS:
            raise ValueError("estado desconhecido")
        scan = self.get(sid)
        n = next((x for x in scan["negocios"] if x["id"] == nid), None)
        if not n:
            raise ValueError("negócio desconhecido")
        leads = self._leads()
        k = self.lead_key(scan["ramo"], n["nome"])
        old = leads.get(k) or {}
        lead = {**old, "estado": estado, "nota": old.get("nota", "") if nota is None else str(nota)[:1000], "at": time.time(), "por": who,
                "nome": n["nome"], "ramo": scan["ramo"], "local": scan["local"] or n.get("morada", ""), "telefone": n.get("telefone", ""),
                "site": n.get("site", ""), "sid": sid, "nid": nid}
        if old.get("estado") != estado:
            lead["hist"] = (old.get("hist") or [])[-20:] + [[time.time(), estado, who]]
        if estado == "por_contactar" and not lead["nota"]:
            leads.pop(k, None)
        else:
            leads[k] = lead
        tmp = DIR / "seguimento.tmp"
        tmp.write_text(json.dumps(leads, ensure_ascii=False), "utf-8")
        tmp.replace(DIR / "seguimento.json")
        return lead

    def leads(self) -> list[dict]:
        return sorted(self._leads().values(), key=lambda x: -x["at"])

    def _save(self, scan: dict) -> None:
        tmp = self._path(scan["id"]).with_suffix(".tmp")
        tmp.write_text(json.dumps(scan, ensure_ascii=False), "utf-8")
        tmp.replace(self._path(scan["id"]))

    def list(self) -> list[dict]:
        out = []
        for p in sorted(DIR.glob("[0-9a-f]" * 12 + ".json"), key=lambda p: p.stat().st_mtime, reverse=True)[:40]:
            try:
                s = json.loads(p.read_text("utf-8"))
            except (OSError, ValueError):
                continue
            out.append({k: s.get(k) for k in ("id", "ramo", "ramo_nome", "local", "raio", "at", "fim", "resumo")} | {"job": self.jobs.get(s["id"])})
        return out

    def delete(self, sid: str) -> None:
        if sid in self.jobs:
            raise ValueError("ainda está a correr")
        self._path(sid).unlink(missing_ok=True)

    # ---------- arrancar ----------
    def start(self, ramo: str, local: str, raio: int, lista: str = "", owner: str = "", termo: str = "") -> dict:
        termo = re.sub(r"\s+", " ", termo or "").strip()[:60]
        if ramo not in RAMOS:  # um ramo escrito à mão: qualquer tipo de empresa
            if not termo:
                raise ValueError("diz o que procuras (ex.: ginásios, clínicas, restaurantes)")
            hit = next((k for k, v in RAMOS.items() if _norm(v[0]) == _norm(termo)), None)
            ramo = hit or "t-" + re.sub(r"[^a-z0-9]+", "-", _norm(termo)).strip("-")[:40]
        local = (local or "").strip()[:80]
        if not local and not lista.strip():
            raise ValueError("diz a zona (ex.: Leiria) ou cola uma lista")
        raio = int(raio if raio not in (None, "") else 15)
        raio = 0 if raio == 0 and ramo == "escolas" else max(2, min(raio or 50, 100))  # 0 = o distrito inteiro (pelo diretório)
        preset = RAMOS.get(ramo)
        filtros = preset[1] if preset else _filtros(termo)
        if not filtros and not lista.strip():
            raise ValueError("escreve o tipo de empresa com mais uma palavra (ex.: «lojas de roupa», «clínicas dentárias»)")
        sid = uuid.uuid4().hex[:12]
        scan = {"id": sid, "ramo": ramo, "ramo_nome": preset[0] if preset else termo[:1].upper() + termo[1:], "termo": preset[2] if preset else termo,
                "filtros": filtros, "local": local, "raio": raio, "at": time.time(), "fim": None,
                "owner": owner, "fontes": [], "negocios": [], "mercado": {}, "resumo": {}, "erro": ""}
        self._save(scan)
        self.jobs[sid] = {"fase": "a localizar a zona", "feitos": 0, "total": 0}
        task = asyncio.create_task(self._run(scan, lista))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return scan

    async def _run(self, scan: dict, lista: str) -> None:
        job = self.jobs[scan["id"]]
        try:
            async with httpx.AsyncClient(timeout=20, follow_redirects=True, headers={"User-Agent": UA_BOT}) as c:
                found: list[dict] = []
                ia = None
                if scan["local"]:
                    geo = await self._geocode(c, scan["local"])
                    scan["geo"] = geo
                    ia = asyncio.create_task(self._ia_lista(scan, geo))  # corre ao mesmo tempo que o mapa
                    if scan["raio"]:
                        job["fase"] = "a procurar no mapa"
                        try:
                            found += await self._osm(c, scan["filtros"], geo, scan["raio"])
                            scan["fontes"].append("OpenStreetMap")
                        except RuntimeError:  # o Overpass vive cheio: o Nominatim e o Photon leem o mesmo mapa
                            try:
                                found += await self._osm_lite(c, scan["filtros"], scan["termo"], geo, scan["raio"])
                                scan["fontes"].append("OpenStreetMap")
                            except RuntimeError as e:  # sem mapa fica a pesquisa da IA; sem as duas, o erro aparece no fim
                                scan["erro"] = str(e)
                    else:  # o distrito inteiro: o mapa num raio largo, só o que é desse distrito
                        scan["distrito"] = geo.get("distrito", "")
                        job["fase"] = "a procurar no mapa"
                        try:
                            got = await self._osm_lite(c, scan["filtros"], scan["termo"], geo, 60)
                            found += [x for x in got if _norm(x.get("distrito", "")) == _norm(scan["distrito"])]
                            scan["fontes"].append("OpenStreetMap")
                        except RuntimeError:
                            pass
                    if scan["ramo"] == "escolas" and geo.get("pais", "pt") == "pt":
                        job["fase"] = "a ler o diretório das escolas"
                        try:
                            got = await self._directory(c, geo, scan["raio"], job)
                            if got:
                                found += got
                                scan["fontes"].append("escolasconducao.com")
                        except (httpx.HTTPError, ValueError, KeyError):
                            pass
                    if ia:
                        job["fase"] = "a procurar na web com a IA"
                        try:
                            got = await ia
                            if got:
                                found += got
                                scan["fontes"].append("pesquisa web (IA)")
                        except Exception as e:  # noqa: BLE001  a IA é extra: o mapa chega
                            scan["erro"] = f"pesquisa da IA: {str(e)[:100]}"
                    if os.environ.get("GOOGLE_PLACES_KEY"):
                        job["fase"] = "a procurar no Google"
                        try:
                            found += await self._google(c, scan["termo"], scan["local"], geo, scan["raio"])
                            scan["fontes"].append("Google Places")
                        except Exception as e:  # noqa: BLE001  o Google é extra; o mapa chega
                            scan["erro"] = f"Google Places: {str(e)[:100]}"
                for line in lista.splitlines():
                    if line.strip():
                        nome, _, url = line.partition("|")
                        if not url and re.match(r"https?://|www\.", nome.strip()):
                            nome, url = re.sub(r"^https?://(www\.)?|/.*$", "", nome.strip()), nome
                        found.append({"nome": nome.strip()[:90], "site": url.strip(), "fonte": "lista"})
                if lista.strip():
                    scan["fontes"].append("lista colada")
                negs = self._merge(found, scan["local"])[:MAX]
                scan["negocios"] = negs
                job.update(fase="a procurar os sites", total=len(negs))
                self._save(scan)
                look = asyncio.Semaphore(2)  # o mapa quase nunca tem o site: procura-se pelo nome, dois de cada vez

                async def find(n: dict):
                    async with look:
                        if not n.get("site"):
                            await self._find_site(n, n["morada"] if n.get("fonte") == "escolasconducao.com" and n.get("morada") else scan["local"])
                        job["feitos"] += 1
                await asyncio.gather(*(find(n) for n in negs))
                job.update(fase="a abrir os sites", feitos=0)
                self._save(scan)
            sem = asyncio.Semaphore(6)
            async with httpx.AsyncClient(timeout=15, follow_redirects=True, verify=False,
                                         headers={"User-Agent": UA, "Accept-Language": "pt-PT,pt;q=0.9"}) as c:
                async def one(n: dict):
                    async with sem:
                        if n.get("site"):
                            n["audit"] = await self._audit(c, n["site"])
                        self._score(n)
                        job["feitos"] += 1
                await asyncio.gather(*(one(n) for n in scan["negocios"]))
            scan["negocios"].sort(key=lambda n: (-n["oportunidade"], n["nota_site"], n["nome"]))
            scan["mercado"] = self._market(scan["negocios"])
            scan["resumo"] = self._summary(scan["negocios"])
        except Exception as e:  # noqa: BLE001  a varredura acaba sempre, com o erro à vista
            scan["erro"] = str(e)[:200] or e.__class__.__name__
        finally:
            scan["fim"] = time.time()
            self._save(scan)
            self.jobs.pop(scan["id"], None)

    # ---------- encontrar ----------
    async def _geocode(self, c: httpx.AsyncClient, local: str) -> dict:
        """Qualquer sítio do mundo; num nome que existe em vários países ganha Portugal se for quase tão conhecido."""
        r = await c.get("https://nominatim.openstreetmap.org/search", params={"q": local, "format": "json", "limit": 5, "addressdetails": 1,
                                                                              "accept-language": "pt-PT,pt,en"})
        r.raise_for_status()
        js = r.json()
        if not js:
            raise ValueError(f"não encontrei «{local}» no mapa")
        top = float(js[0].get("importance") or 0)
        x = next((y for y in js if (y.get("address") or {}).get("country_code") == "pt" and float(y.get("importance") or 0) >= top * 0.6), js[0])
        ad = x.get("address") or {}
        return {"lat": float(x["lat"]), "lon": float(x["lon"]), "nome": x.get("display_name", local)[:120],
                "distrito": ad.get("county") or ad.get("state", ""), "pais": ad.get("country_code", "pt")}

    async def _where(self, c: httpx.AsyncClient, q: str) -> tuple[float, float] | None:
        """Coordenadas de uma localidade, guardadas em disco (o Nominatim aceita um pedido por segundo)."""
        f = DIR / "localidades.json"
        try:
            cache = json.loads(f.read_text("utf-8"))
        except (OSError, ValueError):
            cache = {}
        if q in cache:
            return tuple(cache[q]) if cache[q] else None
        await asyncio.sleep(1)
        r = await c.get("https://nominatim.openstreetmap.org/search", params={"q": q, "format": "json", "limit": 1, "countrycodes": "pt"})
        js = r.json() if r.status_code == 200 else []
        cache[q] = [float(js[0]["lat"]), float(js[0]["lon"])] if js else None
        f.write_text(json.dumps(cache, ensure_ascii=False), "utf-8")
        return tuple(cache[q]) if cache[q] else None

    async def _directory(self, c: httpx.AsyncClient, geo: dict, raio: int, job: dict) -> list[dict]:
        """As escolas de condução do escolasconducao.com: o distrito da zona e os vizinhos que o raio apanha, depois as que
        ficam dentro do raio (pela localidade de cada uma) com o telefone, o email e o site da ficha."""
        lat, lon, d = geo["lat"], geo["lon"], raio / 111
        dists = {geo.get("distrito", "")}
        for dy, dx in () if not raio else ((d, 0), (-d, 0), (0, d * 1.3), (0, -d * 1.3)):  # os distritos vizinhos que o círculo toca
            await asyncio.sleep(1)
            r = await c.get("https://nominatim.openstreetmap.org/reverse", params={"lat": lat + dy, "lon": lon + dx, "format": "json", "zoom": 8})
            if r.status_code == 200:
                dists.add((r.json().get("address") or {}).get("county", ""))
        hd = {"User-Agent": UA}
        cards = []
        for dist in filter(None, dists):
            slug = re.sub(r"\s+", "-", _norm(dist))
            for pg in range(1, 16):
                r = await c.get(f"https://escolasconducao.com/distrito/{slug}", params={"page": pg}, headers=hd)
                got = re.findall(r'<h3 class="font-semibold[^>]*>([^<]+)</h3>\s*<p[^>]*>\s*([^<]+?)\s*<span.*?href="(https://escolasconducao\.com/escola/[^"]+)"', r.text, re.S)
                if r.status_code != 200 or not got:
                    break
                cards += [(html.unescape(n).strip(), html.unescape(cid).strip(), u, dist) for n, cid, u in got]
                await asyncio.sleep(0.5)
        out = []
        for nome, cid, url, dist in cards:
            job["fase"] = f"a ler as fichas ({cid.title()})"
            pt = await self._where(c, f"{cid}, {dist}, Portugal") if raio else None
            if raio and not pt or raio and ((pt[0] - lat) ** 2 + ((pt[1] - lon) * 0.77) ** 2) ** 0.5 * 111 > raio:
                continue
            n = {"nome": re.sub(r",?\s*(unipessoal\s*)?,?\s*lda\.?$", "", nome, flags=re.I).strip(" -,")[:90], "morada": cid.title(), "fonte": "escolasconducao.com", "ficha": url}
            try:
                r = await c.get(url, headers=hd)
                links = re.findall(r'href="([^"]+)"', r.text)
                n["telefone"] = next((x[4:].strip() for x in links if x.startswith("tel:")), "")
                n["email"] = next((x[7:].strip() for x in links if x.startswith("mailto:")), "")
                n["site"] = next((x for x in links if x.startswith("http") and not re.search(r"escolasconducao|bunny\.net|googlesyndication|google\.|facebook|instagram|wa\.me|whatsapp|maps", x)), "")
                n["facebook"] = next((x for x in links if "facebook.com/" in x and "sharer" not in x), "")
            except httpx.HTTPError:
                pass
            out.append(n)
            await asyncio.sleep(0.3)
        return out

    async def _osm(self, c: httpx.AsyncClient, filtros: list[str], geo: dict, raio: int) -> list[dict]:
        around = f"(around:{raio * 1000},{geo['lat']},{geo['lon']})"
        q = "[out:json][timeout:60];(" + "".join(f"{f}{around};" for f in filtros) + ");out center tags;"
        r = None
        for url in ("https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter",
                    "https://overpass.kumi.systems/api/interpreter", "https://overpass-api.de/api/interpreter"):  # vivem cheios: tenta-se outra vez
            try:
                r = await c.post(url, data={"data": q}, timeout=45)
                if r.status_code == 200:
                    break
            except httpx.HTTPError:
                continue
        if not r or r.status_code != 200:
            raise RuntimeError("o OpenStreetMap não respondeu; tenta daqui a um minuto")
        out = []
        for e in r.json().get("elements", []):
            tg = e.get("tags", {})
            if not tg.get("name"):
                continue
            addr = " ".join(x for x in (tg.get("addr:street"), tg.get("addr:housenumber"), tg.get("addr:city") or tg.get("addr:place")) if x)
            out.append({"nome": tg["name"][:90], "site": tg.get("website") or tg.get("contact:website") or tg.get("url") or "",
                        "telefone": tg.get("phone") or tg.get("contact:phone") or "", "email": tg.get("email") or tg.get("contact:email") or "",
                        "morada": addr, "facebook": tg.get("contact:facebook", ""), "fonte": "OpenStreetMap",
                        "lat": e.get("lat") or e.get("center", {}).get("lat"), "lon": e.get("lon") or e.get("center", {}).get("lon")})
        return out

    async def _osm_lite(self, c: httpx.AsyncClient, filtros: list[str], termo: str, geo: dict, raio: int) -> list[dict]:
        tags = [m.groups() for f in filtros for m in [re.match(r'nwr\["(\w+)"="(\w+)"\]$', f)] if m] or [("", "")]
        lat, lon, d = geo["lat"], geo["lon"], raio / 111
        out = []
        for k, v in tags:
            try:
                # o Nominatim só aceita «amenity» como etiqueta; o resto vai pelo nome, dentro da caixa da zona
                r = await c.get("https://nominatim.openstreetmap.org/search", params={
                    **({k: v} if k == "amenity" else {"q": termo}), "format": "jsonv2", "limit": 50, "extratags": 1, "addressdetails": 1, "bounded": 1,
                    "viewbox": f"{lon - d * 1.3},{lat + d},{lon + d * 1.3},{lat - d}"})
                js = r.json() if r.status_code == 200 else []
                for x in js if isinstance(js, list) else []:
                    if not x.get("name"):
                        continue
                    et, ad = x.get("extratags") or {}, x.get("address") or {}
                    out.append({"nome": (x.get("name") or "")[:90], "site": et.get("website") or et.get("contact:website") or "",
                                "telefone": et.get("phone") or et.get("contact:phone") or "", "email": et.get("email") or "",
                                "morada": " ".join(filter(None, (ad.get("road"), ad.get("house_number"), ad.get("city") or ad.get("town") or ad.get("village")))),
                                "fonte": "OpenStreetMap", "lat": float(x["lat"]), "lon": float(x["lon"]), "distrito": ad.get("county", "")})
                await asyncio.sleep(1)  # a regra do Nominatim: um pedido por segundo
                r = await c.get("https://photon.komoot.io/api/", params={"q": termo, **({"osm_tag": f"{k}:{v}"} if k else {}), "lat": lat, "lon": lon, "limit": 80})
                for f in r.json().get("features", []) if r.status_code == 200 else []:
                    p, (x_lon, x_lat) = f["properties"], f["geometry"]["coordinates"]
                    if not k and p.get("osm_key") not in ("shop", "amenity", "office", "craft", "leisure", "tourism", "healthcare"):
                        continue  # sem etiqueta a pesquisa também devolve ruas e terras com a mesma palavra
                    if ((x_lat - lat) ** 2 + ((x_lon - lon) * 0.77) ** 2) ** 0.5 * 111 > raio:
                        continue
                    out.append({"nome": (p.get("name") or "")[:90], "morada": " ".join(filter(None, (p.get("street"), p.get("housenumber"), p.get("city")))),
                                "fonte": "OpenStreetMap", "lat": x_lat, "lon": x_lon, "distrito": p.get("county", "")})
            except (httpx.HTTPError, ValueError, KeyError, TypeError, AttributeError):
                continue
        if not out:
            raise RuntimeError("o mapa não respondeu; tenta daqui a um minuto")
        return out

    @staticmethod
    async def search(q: str) -> list[httpx.URL]:
        """Os links de uma pesquisa na web: Bing, e o DuckDuckGo se o Bing falhar (os dois cortam quem pede muito)."""
        hd = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
              "Accept-Language": "pt-PT,pt;q=0.9"}
        async with httpx.AsyncClient(timeout=15, follow_redirects=True, headers=hd) as c:
            try:
                r = await c.get("https://www.bing.com/search", params={"q": q, "setlang": "pt-PT", "cc": "PT"})
                out = []
                for raw in re.findall(r'<h2[^>]*><a[^>]+href="(https?://[^"]+)"', r.text)[:10]:
                    raw = html.unescape(raw)
                    m = re.search(r"[?&]u=a1([^&]+)", raw)
                    if m:
                        raw = base64.urlsafe_b64decode(m.group(1) + "=" * (-len(m.group(1)) % 4)).decode("utf-8", "replace")
                    if raw.startswith("http"):
                        out.append(httpx.URL(raw))
                if out:
                    return out
            except (httpx.HTTPError, ValueError):
                pass
            try:
                r = await c.post("https://html.duckduckgo.com/html/", data={"q": q, "kl": "pt-pt"})
                out = []
                for raw in re.findall(r'class="result__a" href="([^"]+)"', r.text)[:10]:
                    m = re.search(r"uddg=([^&]+)", raw)
                    out.append(httpx.URL(urllib.parse.unquote(html.unescape(m.group(1))) if m else html.unescape(raw)))
                return out
            except (httpx.HTTPError, ValueError):
                return []

    async def _find_site(self, n: dict, local: str) -> None:
        """Procura o site pelo nome. Só conta um resultado cujo endereço tenha uma palavra própria do nome."""
        words = {w for w in _norm(n["nome"]).split() if w not in GENERIC and len(w) > 2} - set(_norm(local).split())
        if not words:
            return
        links = await self.search(f"{n['nome']} {local}".strip())
        await asyncio.sleep(0.8)
        for u in links:
            host = (u.host or "").removeprefix("www.")
            if "facebook.com" in host and not n.get("facebook") and words & set(_norm(u.path).split()):
                n["facebook"] = str(u)
            if not host or NOT_SITE.search(host):
                continue
            if any(w in _norm(host).replace(" ", "") for w in words):
                n["site"], n["site_achado"] = f"{u.scheme}://{u.host}/", True
                return

    async def _google(self, c: httpx.AsyncClient, termo: str, local: str, geo: dict, raio: int) -> list[dict]:
        out, token = [], None
        for _ in range(3):  # até 60 resultados
            body = {"textQuery": f"{termo} {local}", "languageCode": "pt-PT", "regionCode": (geo.get("pais") or "pt").upper(),
                    "locationBias": {"circle": {"center": {"latitude": geo["lat"], "longitude": geo["lon"]}, "radius": min(raio * 1000, 50000)}}}
            if token:
                body["pageToken"] = token
            r = await c.post("https://places.googleapis.com/v1/places:searchText", json=body, headers={
                "X-Goog-Api-Key": os.environ["GOOGLE_PLACES_KEY"],
                "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.websiteUri,places.nationalPhoneNumber,"
                                    "places.rating,places.userRatingCount,places.location,places.googleMapsUri,nextPageToken"})
            r.raise_for_status()
            js = r.json()
            for p in js.get("places", []):
                out.append({"nome": p.get("displayName", {}).get("text", "")[:90], "site": p.get("websiteUri", ""),
                            "telefone": p.get("nationalPhoneNumber", ""), "morada": p.get("formattedAddress", ""),
                            "nota": p.get("rating"), "opinioes": p.get("userRatingCount"), "maps": p.get("googleMapsUri", ""),
                            "fonte": "Google", "lat": p.get("location", {}).get("latitude"), "lon": p.get("location", {}).get("longitude")})
            token = js.get("nextPageToken")
            if not token:
                break
            await asyncio.sleep(2)
        return out

    async def _ia_lista(self, scan: dict, geo: dict) -> list[dict]:
        """As empresas que a pesquisa web encontra (28 out, Marco: «procura tudo o que é possível»): o mapa não tem todas, e
        fora de Portugal tem menos ainda. O Claude deste PC pesquisa e devolve só o que viu, com o contacto público."""
        from .tradingroom.council import ask_claude, claude_exe
        if not claude_exe() or os.environ.get("RADAR_IA") == "0":
            return []
        zona = f"{scan['local']} ({geo.get('nome', '')})" + (f", até {scan['raio']} km à volta" if scan["raio"] else ", o distrito inteiro")
        text, _ = await ask_claude(
            "Encontras empresas para uma agência que lhes vai propor sites, redes sociais e IA. Respondes só com JSON. Nunca inventas: "
            "só empresas e contactos que viste nas páginas da pesquisa.",
            f"Pesquisa na web (6 a 10 pesquisas curtas, em várias formas e na língua do país) e lista o máximo de empresas reais deste tipo: "
            f"«{scan['termo']}» em {zona}. Procura em diretórios, Google Maps, páginas amarelas, redes sociais e nos sites delas. "
            "Devolve só isto, até 60 empresas: "
            '[{"nome": "", "morada": "rua e localidade", "telefone": "", "email": "", "site": "https://...", "facebook": "https://...", "instagram": "https://..."}]. '
            "Campo que não viste fica vazio.", "sonnet", DIR / "work", timeout=420, tools="WebSearch")
        m = re.search(r"\[.*\]", text, re.S)
        out = []
        for x in json.loads(m.group(0)) if m else []:
            if isinstance(x, dict) and str(x.get("nome") or "").strip():
                g = lambda k: str(x.get(k) or "").strip()[:200]  # noqa: E731
                out.append({"nome": g("nome")[:90], "morada": g("morada"), "telefone": g("telefone")[:40], "email": g("email")[:80] if "@" in g("email") else "",
                            "site": g("site") if g("site").startswith("http") else "", "facebook": g("facebook") if "facebook.com/" in g("facebook") else "",
                            "fonte": "pesquisa web (IA)"})
        return out[:80]

    @staticmethod
    def _merge(found: list[dict], local: str = "") -> list[dict]:
        by: dict[str, dict] = {}
        skip = GENERIC | set(_norm(local).split())
        for n in found:
            if re.search(r"facebook\.com|instagram\.com", n.get("site") or ""):  # uma rede social não é um site
                n["facebook"], n["site"] = n.get("facebook") or n["site"], ""
            if NOT_SITE.search(re.sub(r"^https?://(www\.)?|/.*$", "", n.get("site") or "")):  # diretório ou rede, não o site deles
                n["site"] = ""
            if n.get("site") and not n["site"].startswith("http"):
                n["site"] = "https://" + n["site"].lstrip("/")
            key = " ".join(sorted(w for w in _norm(n["nome"]).split() if w not in skip)) or _norm(n["nome"])
            if not key:
                continue
            if key in by:  # o mesmo negócio por duas fontes: junta o que falta
                for k, v in n.items():
                    if v and not by[key].get(k):
                        by[key][k] = v
                if n.get("fonte") not in by[key]["fontes"]:
                    by[key]["fontes"].append(n["fonte"])
            else:
                by[key] = {**n, "fontes": [n["fonte"]]}
        for n in by.values():
            n["id"] = uuid.uuid4().hex[:8]
        return list(by.values())

    # ---------- auditar ----------
    async def _audit(self, c: httpx.AsyncClient, url: str, hops: int = 0) -> dict:
        t0 = time.time()
        try:
            r = await c.get(url)
        except Exception as e:  # noqa: BLE001
            u = httpx.URL(url)
            if (u.host or "").startswith("www.") and hops < 2:  # muitos links velhos têm um www. que o site não tem
                return await self._audit(c, str(u.copy_with(host=u.host[4:])), hops + 1)
            return {"erro": f"o site não abre ({e.__class__.__name__})"}
        dt = round(time.time() - t0, 2)
        s = r.text[:600_000]
        final = str(r.url)
        o = {"final": final, "status": r.status_code, "segundos": dt, "kb": len(r.content) // 1024, "https": final.startswith("https")}
        m = re.search(r"""<meta[^>]+http-equiv=["']?refresh[^>]+url=([^"'>\s]+)|<frame[^>]+src=["']([^"']+)""", r.text[:20_000], re.I)
        if m and r.status_code < 400 and hops < 2:  # páginas antigas que só reencaminham (refresh ou frames)
            return await self._audit(c, str(r.url.join(m.group(1) or m.group(2))), hops + 1)
        if r.status_code >= 400 and httpx.URL(url).path not in ("", "/") and hops < 2:  # um link velho para uma página interna: a entrada
            u = httpx.URL(url)
            return await self._audit(c, f"{u.scheme}://{u.host}/", hops + 1)
        if r.status_code >= 400:
            o["erro"] = f"o site responde com erro {r.status_code}"
            return o
        o["plataforma"] = next((p for p, pat, *_ in PLATS if _has(pat, s)), "")
        m = re.search(r"<title[^>]*>(.*?)</title>", s, re.I | re.S)
        o["titulo"] = html.unescape(re.sub(r"\s+", " ", m.group(1))).strip()[:100] if m else ""
        m = re.search(r'<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']*)', s, re.I)
        o["descricao"] = html.unescape(m.group(1)).strip()[:180] if m else ""
        o["telemovel"] = _has(r'name=["\']viewport', s)
        o["og"] = _has(r'property=["\']og:image', s)
        o["schema"] = _has(r"application/ld\+json", s)
        o["analytics"] = _has(r"gtag\(|googletagmanager|google-analytics", s)
        o["google_ads"] = _has(r"AW-\d{6,}|googleadservices|gclid", s)
        o["meta_pixel"] = _has(r"fbq\(|connect\.facebook\.net/[^\"']*/fbevents", s)
        o["tiktok_pixel"] = _has(r"analytics\.tiktok\.com|ttq\.load", s)
        o["whatsapp"] = _has(r"wa\.me/|api\.whatsapp\.com|whatsapp://", s)
        o["telefone_link"] = _has(r'href=["\']tel:', s)
        o["formulario"] = _has(r"<form[^>]*>(?:(?!</form>).)*(?:email|telefone|mensagem|nome)", s[:300_000]) if "<form" in s else False
        o["inscricao_online"] = _has(r"inscri[çc][ãa]o online|inscreva-se|inscrever|marcar (aula|exame|online)|reservar|agendar|book now", s)
        o["precos"] = _has(r"\d+[.,]?\d*\s?€|€\s?\d", s)
        o["instagram"] = _has(r"instagram\.com/[A-Za-z0-9_.]{3,}", s)
        o["facebook"] = _has(r"facebook\.com/(?!tr\?|sharer|plugins|dialog)[A-Za-z0-9_.\-]{3,}", s)
        o["tiktok"] = _has(r"tiktok\.com/@", s)
        o["opinioes"] = _has(r"testemunh|opini[õo]es|reviews|avalia[çc][õo]es|trustindex|elfsight", s)
        o["blog"] = _has(r'href=["\'][^"\']*/(blog|noticias|novidades)', s)
        o["cookies"] = _has(r"cookie", s)
        yrs = [int(y) for y in re.findall(r"(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–]\s*)?(20\d\d)", s, re.I)]
        o["copyright"] = max(yrs) if yrs else None
        o["emails"] = sorted({e.lower() for e in re.findall(r"mailto:([\w.+-]+@[\w-]+\.[\w.]+)", s)})[:3]
        if not o["emails"]:  # escrito no texto, sem link
            o["emails"] = sorted({e.lower() for e in re.findall(r"\b[\w.+-]+@[\w-]+\.(?:pt|com|net|org|eu|es|fr|br)\b", s)
                                  if not re.search(r"\.(png|jpg|webp|svg)$|sentry|wixpress|example|domain\.", e)})[:3]
        o["telefones"] = list(dict.fromkeys(re.sub(r"[^\d+]", "", x) for x in re.findall(r"href=[\"']tel:([^\"']+)", s)))[:3]
        # quem fez o site: o crédito no rodapé, lido no texto visível (sem scripts nem estilos)
        txt = re.sub(r"<(script|style|noscript)[^>]*>.*?</\1>", " ", s, flags=re.S | re.I)
        txt = html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", txt)))
        m = re.search(r"(?:desenvolvido|criado|concebido|design|webdesign|powered|made|feito)\s+(?:pelos|pelas|pela|pelo|por|by)\b\s*:?\s*([A-Za-zÀ-ÿ0-9][\w À-ÿ&.\-]{1,30})", txt[-3000:], re.I)
        ag = m.group(1).strip(" .:-|") if m else ""
        ag = re.split(r"\s{2,}| [|©]| Todos| All| Política| Termos", ag)[0].strip()
        o["agencia"] = "" if not ag or re.match(r"(wix|wordpress|shopify|squarespace|google|jimdo|site123|wpbakery|elementor|divi|godaddy|webflow)\b", ag, re.I) else ag
        return o

    # ---------- dar nota ----------
    @staticmethod
    def _score(n: dict) -> None:
        a = n.get("audit") or {}
        probs, bons = [], []

        def p(peso, prob, sol):
            probs.append({"peso": peso, "problema": prob, "solucao": sol})

        if not n.get("site"):
            n["nota_site"] = 0
            p(30, "Não tem site (só Facebook): quem procura no Google encontra os concorrentes primeiro." if n.get("facebook")
              else "Não tem site: quem procura no Google encontra os concorrentes primeiro.",
              "Site de uma página com inscrição e WhatsApp, pronto em 7 dias.")
        elif a.get("erro"):
            n["nota_site"] = 5
            p(28, f"O site está em baixo: {a['erro']}. Cada visita perde-se.", "Pôr o site de pé e sob vigilância, com aviso se cair.")
        else:
            checks = [
                (14, a.get("telemovel"), "Não está feito para telemóvel (8 em 10 visitas vêm do telemóvel).", "Site novo pensado primeiro para o telemóvel."),
                (10, a.get("https"), "Sem cadeado (HTTPS): o Chrome marca o site como «não seguro».", "Certificado SSL e endereço https em todo o site."),
                (10, a.get("segundos", 9) < 3, f"Demora {a.get('segundos')} s a abrir; acima de 3 s metade das pessoas desiste.", "Site leve, com imagens otimizadas, a abrir em menos de 2 s."),
                (10, a.get("whatsapp") or a.get("telefone_link"), "Não há botão para ligar ou falar no WhatsApp.", "Botão fixo de WhatsApp e de chamada em todas as páginas."),
                (10, a.get("inscricao_online") or a.get("formulario"), "Não dá para marcar, inscrever-se ou pedir contacto no site.", "Formulário curto de contacto ou marcação que chega ao telemóvel do dono."),
                (8, a.get("titulo") and a.get("descricao"), "O Google não tem título e descrição bons para mostrar.", "SEO local: título, descrição e ficha Google afinados para a zona."),
                (6, a.get("schema"), "Faltam os dados estruturados que o Google usa no mapa e nas estrelas.", "Dados estruturados de negócio local (morada, horário, opiniões)."),
                (6, a.get("opinioes"), "Não mostra opiniões de clientes.", "Bloco de opiniões do Google no site."),
                (6, a.get("precos"), "Não mostra preços: as pessoas vão perguntar a quem mostra.", "Página de preços e pacotes clara."),
                (6, a.get("instagram") or a.get("facebook") or a.get("tiktok"), "Não liga às redes sociais.", "Redes ligadas e conteúdo mensal (Reels, carrosséis)."),
                (6, a.get("analytics"), "Não mede visitas: não sabe o que funciona.", "Google Analytics e relatório mensal simples."),
                (4, a.get("og"), "Partilhado no WhatsApp/Facebook aparece sem imagem.", "Imagem de partilha com a marca."),
                (4, (a.get("copyright") or 0) >= 2024, f"Parece parado (© {a.get('copyright')})." if a.get("copyright") else "Sem data à vista: parece abandonado.", "Site atualizado com novidades e datas."),
            ]
            tot = sum(w for w, *_ in checks)
            got = 0
            for w, ok, prob, sol in checks:
                if ok:
                    got += w
                else:
                    p(w, prob, sol)
            n["nota_site"] = round(100 * got / tot)
            if a.get("telemovel") and a.get("https"):
                bons.append("Abre bem no telemóvel e com cadeado.")
            if a.get("whatsapp"):
                bons.append("Tem WhatsApp à mão.")
            if a.get("google_ads"):
                bons.append("Já investe em anúncios Google.")
            if a.get("opinioes"):
                bons.append("Mostra opiniões de clientes.")
        probs.sort(key=lambda x: -x["peso"])
        n["problemas"], n["bons"] = probs, bons
        n["gasto"] = Radar._spend(n)
        # oportunidade: site fraco + sinais de que já paga por digital + boa reputação = cliente que compra
        op = (100 - n["nota_site"]) * 0.6
        op += 15 if a.get("google_ads") or a.get("meta_pixel") else 0
        op += 8 if a.get("agencia") else 0
        if n.get("nota") and n.get("opinioes"):
            op += min(17, (n["nota"] >= 4.5) * 7 + min(10, n["opinioes"] / 20))
        else:
            op += 5
        op += 3 if n.get("telefone") or n.get("email") or a.get("emails") else 0  # dá para falar com eles já
        op += 2 if not n.get("site") and n.get("facebook") else 0  # já se mexe no digital, só lhe falta o site
        n["oportunidade"] = max(0, min(100, round(op)))
        n["nivel"] = "quente" if n["oportunidade"] >= 60 else "morna" if n["oportunidade"] >= 40 else "fria"

    @staticmethod
    def _spend(n: dict) -> dict:
        """Gasto mensal estimado a preços de mercado a partir do que se vê; nunca a fatura deles."""
        a = n.get("audit") or {}
        lo = hi = 0
        porque = []
        if n.get("site") and not a.get("erro"):
            pl = next((x for x in PLATS if x[0] == a.get("plataforma")), None)
            if pl:
                lo, hi = pl[2], pl[3]
                porque.append(f"{pl[0]}: plano de {pl[2]}–{pl[3]} €/mês")
            else:
                lo, hi = 5, 20
                porque.append("Alojamento e domínio: 5–20 €/mês")
            if a.get("agencia"):
                lo, hi = lo + 30, hi + 120
                porque.append(f"Site assinado por «{a['agencia']}»: manutenção típica de 30–120 €/mês")
            if a.get("google_ads"):
                lo, hi = lo + 150, hi + 600
                porque.append("Tag de anúncios Google no site: campanhas locais típicas de 150–600 €/mês")
            if a.get("meta_pixel") or a.get("tiktok_pixel"):
                lo, hi = lo + 80, hi + 400
                porque.append("Pixel Meta/TikTok: anúncios típicos de 80–400 €/mês")
        return {"min": lo, "max": hi, "porque": porque, "anuncios": bool(a.get("google_ads") or a.get("meta_pixel") or a.get("tiktok_pixel"))}

    # ---------- a zona inteira ----------
    @staticmethod
    def _market(negs: list[dict]) -> dict:
        plats, ags = {}, {}
        for n in negs:
            a = n.get("audit") or {}
            if n.get("site") and not a.get("erro"):
                k = a.get("plataforma") or "Feito à medida / outro"
                plats[k] = plats.get(k, 0) + 1
            if a.get("agencia"):
                ags[a["agencia"]] = ags.get(a["agencia"], []) + [n["nome"]]
        hosts: dict[str, list] = {}  # vários negócios dentro do mesmo domínio = uma rede ou um fornecedor da zona
        for n in negs:
            u = httpx.URL(n["site"]) if n.get("site") else None
            if u and u.path.strip("/"):
                hosts.setdefault((u.host or "").removeprefix("www."), []).append(n["nome"])
        return {"plataformas": sorted(plats.items(), key=lambda x: -x[1]),
                "redes": sorted(([h, v] for h, v in hosts.items() if len(v) > 1), key=lambda x: -len(x[1])),
                "agencias": sorted(([k, v] for k, v in ags.items()), key=lambda x: -len(x[1]))}

    @staticmethod
    def _summary(negs: list[dict]) -> dict:
        com = [n for n in negs if n.get("site")]
        ok = [n for n in com if not (n.get("audit") or {}).get("erro")]
        notas = sorted(n["nota_site"] for n in ok)
        return {"total": len(negs), "com_site": len(com), "sem_site": len(negs) - len(com), "em_baixo": len(com) - len(ok),
                "quentes": sum(n["nivel"] == "quente" for n in negs), "anuncios": sum(n["gasto"]["anuncios"] for n in negs),
                "nota_mediana": notas[len(notas) // 2] if notas else None,
                "gasto_zona": [sum(n["gasto"]["min"] for n in negs), sum(n["gasto"]["max"] for n in negs)]}



def veredicto(n: dict) -> dict:
    """Vale a pena ou não, numa palavra e com o porquê (28 out, Marco: «diz-me esta vale a pena, esta não vale; orienta-me»).
    Junta o que falta no digital (o que lhe vendemos), sinais de que já paga por isso (tem orçamento) e se há como lhe chegar."""
    a, op = n.get("audit") or {}, n.get("oportunidade") or 0
    tel = bool(n.get("telefone") or a.get("telefones"))
    mail = bool(n.get("email") or a.get("emails"))
    sim, nao = [], []
    if not n.get("site"):
        sim.append("Não tem site: é a venda mais fácil" + (" (já se mexe no Facebook)" if n.get("facebook") else ""))
    elif a.get("erro"):
        sim.append("O site está em baixo: está a perder clientes hoje")
    elif (n.get("nota_site") or 0) < 50:
        sim.append(f"Site fraco ({n.get('nota_site')}/100): há muito para melhorar")
    elif (n.get("nota_site") or 0) >= 80:
        nao.append(f"O site já é bom ({n.get('nota_site')}/100): pouco para lhe vender")
    if a.get("google_ads") or a.get("meta_pixel") or a.get("tiktok_pixel"):
        sim.append("Já paga publicidade: tem orçamento para o digital")
    if a.get("agencia"):
        sim.append(f"Já paga a quem lhe faz o site ({a['agencia']})")
    if n.get("nota") and n.get("opinioes"):
        (sim if n["nota"] >= 4.3 and n["opinioes"] >= 30 else nao if n["nota"] < 3.8 else sim).append(
            f"{str(n['nota']).replace('.', ',')} ★ com {n['opinioes']} opiniões no Google")
    if tel or mail:
        sim.append("Dá para falar já: " + " e ".join(x for x, ok in (("telefone", tel), ("email", mail)) if ok))
    elif n.get("facebook"):
        nao.append("Sem telefone nem email público: só pelo Facebook")
    else:
        nao.append("Sem telefone, email nem redes: difícil de contactar")
    pontos = op + (10 if tel or mail else -25)
    v = "sim" if pontos >= 60 else "talvez" if pontos >= 40 else "nao"
    passo = ("Ligar" if tel else "Mandar email" if mail else "Mensagem no Facebook" if n.get("facebook") else "Ir lá ou procurar o contacto") if v != "nao" else "Deixar para depois"
    return {"v": v, "titulo": {"sim": "Vale a pena", "talvez": "Talvez", "nao": "Não vale a pena"}[v],
            "porque": (sim + nao) if v != "nao" else (nao + sim), "passo": passo, "pontos": max(0, min(100, round(pontos)))}


RADAR = Radar()
