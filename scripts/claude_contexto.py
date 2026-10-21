"""Puts the company's skills library (library/skills) in front of every Claude window on this PC, so nobody has to remind
Claude to use it. Marco, 16 out: «sempre que a gente fala, tu tens que dar uma averiguada no widget... és uma máquina».

Claude Code runs it at two moments (backend/app/claude_hooks.py puts the hooks in ~/.claude/settings.json when the Hub starts):
- SessionStart: a short index of the library by area and the rule (read the SKILL.md that fits before doing the work).
- UserPromptSubmit: the library skills that fit this request, found by its words (Portuguese, English or Russian), at most six,
  each with the path of its SKILL.md. Nothing when no area fits, so a «sim» or a question costs nothing.
It only reads the library folder (no network, no Hub), keeps an index in ~/.team-agent/skills-index.json and never stops
Claude: any error means no output. AMG_SKILLS=0 in the environment silences it.

Try it by hand: python scripts/claude_contexto.py "faz-me um site para uma escola de condução"
"""
import hashlib
import json
import os
import re
import sys
from pathlib import Path

LIB = Path(__file__).resolve().parents[1] / "library" / "skills"
CACHE = Path.home() / ".team-agent" / "skills-index.json"
MAX_OFFER = 6

# (area, the words of a request or of a skill's description that belong to it, the library skills to offer first)
AREAS = [
    ("Sites", r"\bsites?\b|website|webpage|p[aá]ginas? (web|de entrada|inicial)|landing|homepage|portef[oó]lio|portfolio|"
              r"front-?end|\bhtml\b|\bcss\b|next\.?js|react|tailwind|web ?app|infinite ?scroll|scroll infinito|"
              r"parallax|scrollytelling|awwwards|сайт|лендинг|скролл",
     ["site-scroll-infinito", "premium-site-rebuild", "site-empresa-local", "site-estudio-ia", "realtor-landing", "frontend-design",
      "senior-frontend", "web-artifacts-builder", "webapp-testing"]),
    ("Clientes e vendas", r"angaria[rç]|prospe[cç]|prospect|dossi[eê]s?|propostas?\b|proposal|cold ?e-?mail|outreach|"
                          r"clientes? novos|novos clientes|vendas por apanhar|\bsales\b|lead ?gen|\bcrm\b|\bdeals?\b|"
                          r"opportunit|oportunidades? de neg|fechar (o )?neg[oó]cio|obje[cç](ão|ões)|objections?|"
                          r"account plan|\bquota\b|\brfp\b|клиент|продаж",
     ["dossie-crescimento"]),
    ("SEO", r"\bseo\b|google (maps|search|business)|aparecer no google|posicionamento|ranking|sitemap|\bschema\b|"
            r"keywords?|palavras?-chave|backlinks?",
     ["seo", "seo-audit", "seo-local", "seo-technical", "seo-page", "seo-content", "seo-schema", "seo-plan"]),
    ("Anúncios", r"an[uú]ncios?|\bads?\b|advertis|publicidade|campanhas? pagas?|meta ads|google ads|tiktok ads|criativos\b|"
                 r"\bppc\b|\broas\b|реклам",
     ["ads", "ads-plan", "ads-create", "ads-creative", "ads-meta", "ads-google", "ads-tiktok", "ads-audit"]),
    ("Vídeo", r"v[ií]deos?|\breels?\b|\bgifs?\b|\bshorts\b|motion|anima[cç](ão|ões)|animad[oa]s?|showreel|explainer|видео|ролик|анимац",
     ["motion-reel-codigo", "ads-creative", "algorithmic-art"]),
    ("Redes sociais e conteúdo", r"instagram|linkedin|facebook|tiktok|\bposts?\b|carross[eé]is|carross[eé]l|carousel|"
                                 r"redes sociais|social media|conte[uú]dos?|\bcontent\b|newsletter|e-?mails?\b|\bblog|"
                                 r"инстаграм|контент|пост",
     ["social-content", "content-creation", "draft-content", "email-sequence", "campaign-plan", "brand-review"]),
    ("Print-on-demand", r"\betsy\b|printify|printful|print[- ]on[- ]demand|\bpod\b|estampas?|t-?shirts?|sweatshirts?|canecas?|"
                        r"fiverr|farmar dinheiro|ganhar dinheiro|fazer dinheiro|renda passiva|passive income",
     ["pod-etsy"]),
    ("Loja Shopify", r"shopify|loja online|e-?commerce|\bliquid\b|checkout|online store|магазин",
     ["shopify-liquid", "shopify-admin", "shopify-dev", "shopify-custom-data", "shopify-use-shopify-cli", "seo-ecommerce"]),
    ("Marca e design", r"\bmarcas?\b|log[oó]tipo|\blogo\b|identidade visual|branding|\bbrand\b|cartaz|poster|flyer|"
                       r"\bdesign\b|paleta|tipografia|\bfonts?\b|логотип|бренд|дизайн",
     ["canvas-design", "theme-factory", "brand-review", "frontend-design", "algorithmic-art"]),
    ("Marketing", r"marketing|campanhas?\b|lan[cç]amento|\blaunch|concorr[eê]ncia|concorrentes|competitors?|"
                  r"p[uú]blico-alvo|personas?\b|funil|funnel|\bleads?\b|positioning|messaging|message house|\bicp\b|"
                  r"ideal customer|proof points?|proposta de valor|value prop|go-to-market|маркетинг",
     ["campaign-plan", "competitive-brief", "performance-report", "content-creation", "email-sequence"]),
    ("Documentos", r"\bpdfs?\b|\bdocx\b|\bword\b|excel|\bxlsx\b|folhas? de c[aá]lculo|spreadsheet|\bpptx\b|powerpoint|"
                   r"apresenta[cç](ão|ões)|\bslides?\b|\bdeck\b|документ",
     ["pdf", "docx", "xlsx", "pptx", "doc-coauthoring"]),
    ("Finanças e dados", r"finan[cç]|financial|contabil|accounting|\bledger|journal entr|\btax\b|impostos?|payroll|"
                         r"cash ?flow|tesouraria|reconcil|fatura[cç]|invoices?|or[cç]amento|budget|\bsql\b|dataset|"
                         r"an[aá]lise de dados|data analy|statistic|estat[ií]stic|m[eé]tricas|\bmetrics\b|финанс",
     []),
    ("Trading", r"trading|\btrader|forex|\bxau|\bouro\b|\bgold\b|eurusd|gbpusd|ger40|\bdax\b|nasdaq|backtest|\bmt5\b|"
                r"metatrader|price action|\bsmc\b|indicadores?|velas|candles?|торг|трейд",
     []),
    ("Equipa e RH", r"recrut|recruit|hiring|candidat|entrevistas? de emprego|interview|onboarding|\bhr\b|recursos humanos|"
                    r"compensation|sal[aá]rios?|performance review|avalia[cç][aã]o de desempenho|headcount|\bpto\b|"
                    r"new hire|novos? colaborador",
     []),
    ("Código", r"\bbugs?\b|\berros?\b|debug|n[aã]o funciona|partiu|crash|\btestes?\b|\btests?\b|refactor|implementa|"
               r"\bfeature|c[oó]digo|\bcode\b|pull request|\bcommit|\bmerge\b|deploy|cloudflare|wrangler|\bworkers?\b|"
               r"\bsdk\b|database|base de dados|mongodb|postgres|stripe|ошибк|\bбаг|тест|\bкод",
     ["systematic-debugging", "test-driven-development", "brainstorming", "writing-plans", "executing-plans",
      "verification-before-completion", "requesting-code-review"]),
    ("Claude, MCP e skills", r"\bskills?\b|\bmcp\b|\bplugins?\b|claude api|anthropic|agent sdk|claude\.?md|connectors?\b|"
                             r"conectores?|discord|agent-browser|скилл",
     ["skill-creator", "writing-skills", "mcp-builder", "claude-api", "dispatching-parallel-agents"]),
    ("Operações e suporte", r"processos?\b|procedimentos?|runbook|status report|relat[oó]rio de estado|fornecedor|vendor|"
                            r"an[aá]lise de risco|risk|compliance|suporte|tickets?|reclama[cç]|\bfaq\b|base de conhecimento|"
                            r"knowledge base|inbox|caixa de entrada|\bslack\b|digest|briefing|reuni[aã]o|meetings?\b|"
                            r"\blegal\b|\bndas?\b|contratos?\b|contracts?\b|e-?signature|assinatura|отч[её]т",
     ["process-doc", "runbook", "status-report", "risk-assessment", "vendor-review", "ticket-triage", "draft-response",
      "kb-article"]),
]
# what each area is for, in a line: the page Skills of the Hub shows it over the area's skills
PARA = {
    "Sites": "Fazer ou refazer o site de um cliente, do zero até estar publicado.",
    "Clientes e vendas": "Encontrar negócios que precisam de nós, preparar a proposta e fechar a venda.",
    "SEO": "Pôr um negócio a aparecer no Google: auditorias, Google Maps, conteúdo e schema.",
    "Anúncios": "Campanhas pagas no Meta, Google e TikTok, e os criativos delas.",
    "Vídeo": "Reels, motion graphics e vídeos de marca.",
    "Redes sociais e conteúdo": "Posts, carrosséis, newsletters e emails.",
    "Print-on-demand": "Vender estampas na Etsy: nichos, desenhos e anúncios (Fábrica Etsy).",
    "Loja Shopify": "Montar e mexer em lojas online Shopify.",
    "Marca e design": "Logótipos, cartazes, paletas e identidade visual.",
    "Marketing": "Planos de campanha, concorrência e público-alvo.",
    "Documentos": "PDF, Word, Excel e apresentações.",
    "Finanças e dados": "Contas, faturas, impostos, orçamentos e análise de dados.",
    "Trading": "Mercados, notícias, análise de gráficos e robôs.",
    "Equipa e RH": "Contratar, entrevistas, integrar pessoas novas e avaliações.",
    "Código": "Corrigir erros, testar, construir e pôr no ar.",
    "Claude, MCP e skills": "Fazer skills, ligar ferramentas ao Claude e afiná-lo.",
    "Operações e suporte": "Processos, relatórios, reuniões, contratos e apoio ao cliente.",
    "Outras": "Ainda sem tema certo: abre a skill e escolhe um.",
}
PREFIX = {"seo": "SEO", "ads": "Anúncios", "shopify": "Loja Shopify", "ucp": "Loja Shopify"}
COMPILED = [(area, re.compile(words, re.I), first) for area, words, first in AREAS]
NAMES = [area for area, _, _ in AREAS] + ["Outras"]
CHOSEN = LIB / "temas.json"   # {"skill": "area"}: an area chosen by hand on the page Skills, over the one found here


def chosen() -> dict:
    try:
        data = json.loads(CHOSEN.read_text(encoding="utf-8"))
        return {k: v for k, v in data.items() if v in NAMES} if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def about(md: Path) -> str:
    """The description in the SKILL.md's frontmatter, on one line (plain, quoted or folded YAML)."""
    head = md.read_text(encoding="utf-8", errors="replace")[:6000]
    if not head.startswith("---"):
        return ""
    lines = head.split("\n")[1:]
    for i, line in enumerate(lines):
        if line.strip() == "---":
            return ""
        if line.startswith("description:"):
            text = line[len("description:"):].strip()
            if text in ("", ">", "|", ">-", "|-"):
                more = []
                for nxt in lines[i + 1:]:
                    if not nxt.startswith((" ", "\t")):
                        break
                    more.append(nxt.strip())
                text = " ".join(more)
            return re.sub(r"\s+", " ", text.strip().strip("\"'")).strip()
    return ""


def area_of(name: str, text: str, by_hand: dict | None = None) -> str:
    """The area of a skill: the one chosen by hand, the one that lists it first, its name's prefix, or the area whose
    words its name and description have the most (the first of them on a tie)."""
    if by_hand and by_hand.get(name) in NAMES:
        return by_hand[name]
    for area, _, first in COMPILED:
        if name in first:
            return area
    if name.split("-")[0] in PREFIX:
        return PREFIX[name.split("-")[0]]
    text = f"{name.replace('-', ' ')} {text}"
    hits, i = max((len(rx.findall(text)), -i) for i, (_, rx, _) in enumerate(COMPILED))
    return COMPILED[-i][0] if hits else "Outras"


def index() -> dict:
    """{name: {"about", "area"}} for every skill in the library, rebuilt only when a SKILL.md or temas.json changed."""
    found = sorted((md.parent.name, md.stat().st_mtime_ns) for md in LIB.glob("*/SKILL.md"))
    by_hand = chosen()
    key = hashlib.sha1(json.dumps([found, by_hand, NAMES]).encode()).hexdigest()
    try:
        cached = json.loads(CACHE.read_text(encoding="utf-8"))
        if cached.get("key") == key and cached.get("lib") == str(LIB):
            return cached["skills"]
    except (OSError, ValueError):
        pass
    skills = {}
    for name, _ in found:
        text = about(LIB / name / "SKILL.md")
        skills[name] = {"about": text, "area": area_of(name, text, by_hand)}
    try:
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        CACHE.write_text(json.dumps({"key": key, "lib": str(LIB), "skills": skills}, ensure_ascii=False), encoding="utf-8")
    except OSError:
        pass
    return skills


def start_text(skills: dict) -> str:
    by_area: dict[str, list[str]] = {}
    for name, s in sorted(skills.items()):
        by_area.setdefault(s["area"], []).append(name)
    rows = "\n".join(f"- {a}: {', '.join(by_area[a])}" for a in NAMES if a in by_area)
    return (f"Biblioteca de skills da Empresa AMG: {len(skills)} skills em {LIB}. É o cérebro da empresa, o mesmo para o "
            "Marco, o Kovel e o David. Antes de fazer um trabalho, vê se alguma serve; se servir, lê o SKILL.md dela "
            "e segue-o (se a mesma skill já estiver instalada aqui, usa-a pelo Skill). Em cada pedido aparecem as que "
            "servem para ele. Uma skill está em <pasta>/<nome>/SKILL.md e os ficheiros dela ao lado. Para juntar uma: "
            "a página Skills do Hub (#/skills) ou uma pasta nova em library/skills com commit e push (chega aos outros "
            "PCs no pull seguinte). O que a equipa decidiu está na Memória do Hub (scripts/memoria.py --list no "
            "team-agent).\n" + rows)


def offer(prompt: str, skills: dict) -> list[str]:
    """The library skills that fit this request: the ones it names, then those of the areas its words hit the most."""
    text = prompt.lower()
    named = [n for n in skills if len(n) > 3 and re.search(rf"(?<![\w-]){re.escape(n)}(?![\w-])|{re.escape(n.replace('-', ' '))}", text)]
    hits = sorted(((len(rx.findall(text)), i) for i, (_, rx, _) in enumerate(COMPILED) if rx.search(text)), reverse=True)
    words = set(re.findall(r"\w{5,}", text))

    def fit(n: str) -> int:   # words of the request that the skill's own description has («escola de condução»)
        own = f"{n} {skills[n]['about']}".lower()
        return sum(1 for w in words if w in own)

    lists = []
    for _, i in hits:
        area, _, first = COMPILED[i]
        rest = sorted(n for n, s in skills.items() if s["area"] == area and n not in first)
        ranked = [n for n in first if n in skills] + rest
        lists.append(sorted(ranked, key=lambda n: (-fit(n), ranked.index(n))))
    out = list(dict.fromkeys(named))
    depth = 0
    while len(out) < MAX_OFFER and any(depth < len(l) for l in lists):
        for l in lists:   # round robin: the best of each area hit before the second of any
            if depth < len(l) and l[depth] not in out and len(out) < MAX_OFFER:
                out.append(l[depth])
        depth += 1
    return out[:MAX_OFFER]


def offer_text(names: list[str], skills: dict) -> str:
    rows = []
    for n in names:
        desc = skills[n]["about"]
        desc = desc if len(desc) <= 170 else desc[:167].rsplit(" ", 1)[0] + "…"
        rows.append(f"- {n}: {desc} → {LIB / n / 'SKILL.md'}")
    return ("Skills da Empresa AMG que servem para este pedido (lê o SKILL.md da que servir antes de começar e "
            "segue-o; se já estiver instalada aqui como skill, usa-a pelo Skill):\n" + "\n".join(rows))


def context(event: dict) -> str:
    if os.environ.get("AMG_SKILLS") == "0" or not LIB.is_dir():
        return ""
    name = event.get("hook_event_name")
    if name == "SessionStart":
        if event.get("source") == "resume":   # the window already has it from when it started
            return ""
        skills = index()
        return start_text(skills) if skills else ""
    if name == "UserPromptSubmit":
        prompt = str(event.get("prompt") or "")
        if len(prompt.strip()) < 12:
            return ""
        skills = index()
        names = offer(prompt, skills)
        return offer_text(names, skills) if names else ""
    return ""


def main() -> None:
    try:
        if len(sys.argv) > 1:   # by hand: the text of a request
            sys.stdout.reconfigure(encoding="utf-8")
            print(context({"hook_event_name": "UserPromptSubmit", "prompt": " ".join(sys.argv[1:])}) or "(nada)")
            return
        event = json.loads(sys.stdin.buffer.read().decode("utf-8", errors="replace") or "{}")
        text = context(event)
        if text:
            sys.stdout.write(json.dumps({"hookSpecificOutput": {"hookEventName": event["hook_event_name"],
                                                                "additionalContext": text}}))
    except Exception:   # never in Claude's way
        pass


if __name__ == "__main__":
    main()
