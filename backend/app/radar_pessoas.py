"""Radar: com quem falar em cada empresa (9 nov, pedido do David: «encontrar o LinkedIn e pôr no radar, assim é mais fácil
falar com eles; o email também, se tiverem, o LinkedIn obrigatório... encontra o CEO, o patrão, quem pode falar connosco»).

Para cada negócio procura a pessoa que decide (CEO, dono, sócio-gerente, fundador, diretor) com o perfil do LinkedIn, e a
página da empresa no LinkedIn. Primeiro a pesquisa grátis (DuckDuckGo/Bing, «site:linkedin.com/in»), depois o Claude deste PC
com WebSearch para os que ficaram sem ninguém, oito empresas de cada vez. Só o que é público: nada de emails adivinhados; o
email é o que aparece no site, no Google ou num perfil público. Fica no próprio negócio da pesquisa (`decisores`)."""
from __future__ import annotations

import asyncio
import json
import re
import time

from .radar import DIR, GENERIC, RADAR, _norm

# quem decide primeiro: o nível diz a ordem e a etiqueta que a página mostra
NIVEIS = [
    (3, r"\b(ceo|founder|co-?founder|fundador|fundadora|cofundador|owner|propriet[aá]ri[oa]|don[oa]|s[oó]ci[oa][- ]gerente|"
        r"gerente|managing director|diretor[a]? geral|director[a]? geral|administrador[a]?|presidente|general manager|partner|s[oó]ci[oa])\b"),
    (2, r"\b(diretor[a]?|director[a]?|head|manager|respons[aá]vel|coordenador[a]?|chefe|lead)\b"),
]
IN = re.compile(r"https?://(?:[a-z]{2,3}\.)?linkedin\.com/in/([A-Za-z0-9_\-%]{3,100})", re.I)
CO = re.compile(r"https?://(?:[a-z]{2,3}\.)?linkedin\.com/company/([A-Za-z0-9_\-%.]{2,80})", re.I)
MAIL = re.compile(r"^[\w.+-]+@[\w-]+(\.[\w-]+)+$")


def nivel(cargo: str) -> int:
    c = (cargo or "").lower()
    return next((k for k, pat in NIVEIS if re.search(pat, c)), 1)


def _curto(nome: str) -> str:
    return re.sub(r"^(escolas? de condu[cç][aã]o|auto[- ]?escola|gin[aá]sio|restaurante|cabeleireiro|cl[ií]nica( dent[aá]ria)?|imobili[aá]ria|oficina)\s*",
                  "", nome, flags=re.I).strip(" -,") or nome


def _palavras(n: dict, local: str) -> set[str]:
    return {w for w in _norm(n["nome"]).split() if w not in GENERIC and len(w) > 2} - set(_norm(local).split())


def _pessoa(titulo: str, texto: str, url: str) -> dict | None:
    """«João Silva - Sócio-Gerente - Escola X | LinkedIn» -> nome e cargo."""
    m = IN.search(url)
    if not m:
        return None
    partes = [p.strip() for p in re.split(r"\s[-–|]\s", re.sub(r"\s*\|\s*LinkedIn.*$", "", titulo, flags=re.I)) if p.strip()]
    if not partes or len(partes[0]) > 60:
        return None
    cargo = partes[1] if len(partes) > 1 else ""
    if not cargo or nivel(cargo) == 1:  # o cargo às vezes só vem no texto
        mm = re.search(r"(?:Experi[eê]ncia|Experience|Cargo)\s*:\s*([^·\n]{3,80})", texto)
        cargo = cargo or (mm.group(1).strip() if mm else "")
        if nivel(texto[:300]) > nivel(cargo):
            cargo = next(re.search(p, texto[:300], re.I).group(0) for k, p in NIVEIS if re.search(p, texto[:300], re.I)).capitalize()
    return {"nome": partes[0][:60], "cargo": cargo[:80], "linkedin": f"https://www.linkedin.com/in/{m.group(1)}/", "email": "", "fonte": "pesquisa"}


async def gratis(n: dict, local: str) -> dict:
    """A pesquisa grátis: perfis do LinkedIn que falam desta empresa e a página dela."""
    from .radar_ficha import search_rich
    words = _palavras(n, local)
    if not words:
        return {}
    curto = _curto(n["nome"])
    out: dict = {"decisores": [], "linkedin": ""}
    res = await search_rich(f'"{curto}" {local} site:linkedin.com/in')
    if not any(IN.search(x["url"]) for x in res):
        await asyncio.sleep(1.5)
        res += await search_rich(f"{curto} {local} linkedin CEO OR fundador OR gerente OR dono")
    out["resultados"] = len(res)  # 0 = o motor cortou-nos (DuckDuckGo e Bing pedem captcha a quem pede muito)
    vistos = set()
    for x in res:
        blob = _norm(x["titulo"] + " " + x.get("texto", "") + " " + x["url"]).replace(" ", "")
        if not any(w in blob for w in words):
            continue  # o perfil tem de falar desta empresa
        m = CO.search(x["url"])
        if m and not out["linkedin"]:
            out["linkedin"] = f"https://www.linkedin.com/company/{m.group(1)}/"
            continue
        p = _pessoa(x["titulo"], x.get("texto", ""), x["url"])
        if p and p["linkedin"] not in vistos:
            vistos.add(p["linkedin"])
            out["decisores"].append(p)
    return out


SYS = ("És pesquisador comercial de uma pequena agência portuguesa. Encontras, só em fontes públicas, a pessoa que decide em cada "
       "empresa (CEO, dono, sócio-gerente, fundador, diretor-geral) e o perfil dela no LinkedIn. Nunca inventas nomes, links nem emails: "
       "o que não achares fica vazio. Respondes só com JSON.")


def _prompt(lote: list[dict], local: str) -> str:
    linhas = "\n".join(f'{n["id"]} | {n["nome"]} | {n.get("morada") or local} | {n.get("site") or ""} | {n.get("linkedin") or ""}' for n in lote)
    return ("Empresas (id | nome | localidade | site | LinkedIn da empresa, se já se sabe):\n" + linhas + "\n\n"
            "Para cada uma, pesquisa na web (o site «sobre nós/equipa», o LinkedIn, o registo comercial, notícias, a página do Facebook) "
            "quem é o CEO / dono / sócio-gerente: o nome, o cargo, o perfil pessoal do LinkedIn (linkedin.com/in/...) e o email dele se "
            "for público (no site, num perfil, numa notícia; nunca adivinhado pelo formato). Também a página da empresa no LinkedIn "
            "(linkedin.com/company/...). O perfil tem de ser mesmo dessa pessoa nessa empresa (nome da empresa e zona batem certo). "
            "Até 2 pessoas por empresa, a que decide primeiro.\n\n"
            'Devolve só: [{"id": "...", "linkedin_empresa": "", "pessoas": [{"nome": "", "cargo": "", "linkedin": "https://www.linkedin.com/in/...", '
            '"email": "", "fonte": "link onde o viste"}]}]')


def limpa(it) -> dict:
    """O que a IA devolveu para uma empresa, só com links e emails bem feitos."""
    ps = []
    if isinstance(it, dict):
        for p in it.get("pessoas") or []:
            if not isinstance(p, dict) or not str(p.get("nome") or "").strip():
                continue
            li = IN.search(str(p.get("linkedin") or ""))
            mail = str(p.get("email") or "").strip().lower()
            ps.append({"nome": str(p["nome"]).strip()[:60], "cargo": str(p.get("cargo") or "").strip()[:80],
                       "linkedin": f"https://www.linkedin.com/in/{li.group(1)}/" if li else "",
                       "email": mail if MAIL.match(mail) else "", "fonte": str(p.get("fonte") or "")[:300] if str(p.get("fonte") or "").startswith("http") else "IA"})
    co = CO.search(str(it.get("linkedin_empresa") or "")) if isinstance(it, dict) else None
    return {"decisores": ps, "linkedin": f"https://www.linkedin.com/company/{co.group(1)}/" if co else ""}


async def ia(lote: list[dict], local: str) -> dict[str, dict]:
    from .tradingroom.council import ask_claude
    text, _ = await ask_claude(SYS, _prompt(lote, local), "sonnet", DIR / "work", timeout=420, tools="WebSearch")
    lista = []
    for m in re.finditer(r"\[\s*\{", text):  # o 1.º JSON que abre bem; o texto à volta (fontes, notas) fica de fora
        try:
            lista = json.JSONDecoder().raw_decode(text[m.start():])[0]
            break
        except ValueError:
            continue
    return {str(it["id"]): limpa(it) for it in lista if isinstance(it, dict) and it.get("id")}


def junta(n: dict, achado: dict) -> None:
    """Mete o que se achou no negócio, sem perder o que já lá estava; o que decide fica em primeiro."""
    if achado.get("linkedin") and not str(n.get("linkedin") or "").startswith("https://"):
        n["linkedin"] = achado["linkedin"]
    tem = {(p.get("linkedin") or _norm(p["nome"])): p for p in n.get("decisores") or []}
    for p in achado.get("decisores") or []:
        k = p.get("linkedin") or _norm(p["nome"])
        old = tem.get(k) or next((o for o in tem.values() if _norm(o["nome"]) == _norm(p["nome"])), None)
        if old:
            for f in ("cargo", "linkedin", "email"):
                if p.get(f) and not old.get(f):
                    old[f] = p[f]
        else:
            tem[k] = dict(p)
    ps = list(tem.values())
    for p in ps:
        p["nivel"] = nivel(p.get("cargo", ""))
    ps.sort(key=lambda p: (-p["nivel"], not p.get("linkedin"), not p.get("email")))
    n["decisores"] = ps[:4]
    n["pessoas_at"] = time.time()


class Pessoas:
    """A procura em lote de uma pesquisa inteira: os que valem a pena primeiro."""

    def __init__(self):
        self.jobs: dict[str, dict] = {}
        self._tasks: set = set()

    def _grava(self, sid: str, feitos: dict[str, dict]) -> None:
        p = RADAR._path(sid)
        scan = json.loads(p.read_text("utf-8"))  # o ficheiro de agora: o resto do Radar pode ter mudado entretanto
        for n in scan.get("negocios", []):
            if n["id"] in feitos:
                junta(n, feitos[n["id"]])
        RADAR._save(scan)

    def start(self, sid: str, ids: list[str] | None = None, maximo: int = 40) -> dict:
        from .radar import veredicto
        if sid in self.jobs:
            raise ValueError("já está a procurar")
        scan = RADAR.get(sid)
        negs = [n for n in scan.get("negocios", []) if (n["id"] in ids if ids else not n.get("pessoas_at"))]
        ordem = {"sim": 0, "talvez": 1, "nao": 2}
        negs.sort(key=lambda n: ordem.get(veredicto(n)["v"], 1) if "oportunidade" in n else 1)
        negs = negs[:maximo]
        if not negs:
            raise ValueError("já se procurou em todas: escolhe uma empresa e carrega «Procurar de novo»")
        local = scan.get("local") or ""
        job = self.jobs[sid] = {"fase": "a procurar no LinkedIn", "feitos": 0, "total": len(negs), "achados": 0}

        async def run():
            try:
                achou: dict[str, dict] = {}
                for n in negs:
                    try:
                        achou[n["id"]] = await gratis(n, re.split(r"\d+[A-Za-z]?\s*", n.get("morada") or "")[-1].strip(" ,") or local)
                    except Exception:  # noqa: BLE001  o motor cortou: a IA trata dele
                        achou[n["id"]] = {}
                    job["feitos"] += 1
                    job["achados"] = sum(1 for a in achou.values() if a.get("decisores"))
                    if achou[n["id"]].get("decisores") or achou[n["id"]].get("linkedin"):
                        self._grava(sid, {n["id"]: achou[n["id"]]})
                    if job["feitos"] >= 3 and not any(a.get("resultados") for a in achou.values()):
                        break  # os motores grátis estão a cortar-nos: a IA faz o resto
                    await asyncio.sleep(2)
                # a IA só para quem ficou sem ninguém que decida, oito de cada vez
                falta = [n | {"linkedin": achou.get(n["id"], {}).get("linkedin") or n.get("linkedin", "")} for n in negs
                         if not any(nivel(p.get("cargo", "")) == 3 for p in achou.get(n["id"], {}).get("decisores", []))]
                job.update(fase="a IA procura o CEO / dono", feitos=0, total=len(falta))
                for i in range(0, len(falta), 8):
                    lote = falta[i:i + 8]
                    try:
                        res = await ia(lote, local)
                        self._grava(sid, res)
                        job["achados"] += sum(1 for n in lote if res.get(n["id"], {}).get("decisores") and not achou.get(n["id"], {}).get("decisores"))
                    except Exception as e:  # noqa: BLE001
                        job["erro"] = f"a IA não respondeu ({str(e)[:80]})"
                    job["feitos"] += len(lote)
            finally:
                self.jobs.pop(sid, None)

        t = asyncio.create_task(run())
        self._tasks.add(t)
        t.add_done_callback(self._tasks.discard)
        return {"ok": True, "job": job}


PESSOAS = Pessoas()
