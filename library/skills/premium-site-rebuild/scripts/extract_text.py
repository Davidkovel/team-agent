"""Lê um site antigo inteiro e escreve o conteúdo para reconstruir.

    python -I extract_text.py https://www.exemplo.com  pasta-de-saida

Escreve na pasta: content.md (texto por página, com os títulos marcados [h1]..[h3]),
media.txt (todas as imagens/vídeos encontrados, já com o URL da versão maior do Next.js),
links.txt (todas as ligações externas, mailto e tel) e html/<página>.html (o original).
Só segue ligações do mesmo domínio. Sem dependências (urllib).
"""
import html
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36"}
SKIP = re.compile(r"\.(css|js|png|jpe?g|webp|avif|gif|svg|ico|woff2?|mp4|webm|pdf|xml|txt)(\?|$)|/_next/|/api/", re.I)


def get(url: str) -> str:
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
        return r.read().decode("utf-8", "replace")


def texto(s: str) -> str:
    b = re.sub(r"<(script|style|svg|noscript)[^>]*>.*?</\1>", "", s, flags=re.S | re.I)
    b = re.sub(r"<(h[1-6])[^>]*>", r"\n[\1] ", b, flags=re.I)
    b = re.sub(r"<(p|li|a|button|section|div|br|span|dt|dd|td|th|label|option)[^>]*>", "\n", b, flags=re.I)
    t = html.unescape(re.sub(r"<[^>]+>", "", b))
    out = []
    for line in t.split("\n"):
        line = " ".join(line.split())
        if line and (not out or out[-1] != line):
            out.append(line)
    return "\n".join(out)


def media(s: str, base: str) -> set[str]:
    found = set()
    for u in re.findall(r'(?:src|srcset|srcSet|poster|href|content)="([^"]+)"', s):
        for part in u.split(","):
            p = html.unescape(part.strip().split(" ")[0])
            if "/_next/image" in p:   # a versão maior que o Next.js serve
                q = urllib.parse.parse_qs(urllib.parse.urlparse(p).query).get("url", [""])[0]
                if q:
                    found.add(urllib.parse.urljoin(base, q))
            elif re.search(r"\.(png|jpe?g|webp|avif|gif|svg|mp4|webm|mov)(\?|$)", p, re.I):
                found.add(urllib.parse.urljoin(base, p))
    return found


def main() -> None:
    start, out = sys.argv[1].rstrip("/") + "/", Path(sys.argv[2])
    (out / "html").mkdir(parents=True, exist_ok=True)
    host = urllib.parse.urlparse(start).netloc
    queue, seen, pages, allmedia, links = [start], set(), [], set(), set()
    while queue and len(seen) < 80:
        url = queue.pop(0)
        if url in seen:
            continue
        seen.add(url)
        try:
            s = get(url)
        except Exception as e:  # noqa: BLE001
            print("falhou", url, e)
            continue
        path = urllib.parse.urlparse(url).path.strip("/") or "home"
        (out / "html" / (path.replace("/", "__") + ".html")).write_text(s, encoding="utf-8")
        title = re.search(r"<title>(.*?)</title>", s, re.S)
        desc = re.search(r'<meta name="description" content="([^"]*)"', s)
        pages.append((url, html.unescape(title.group(1)) if title else "", html.unescape(desc.group(1)) if desc else "", texto(s)))
        allmedia |= media(s, url)
        for h in re.findall(r'href="([^"#]+)', s):
            h = html.unescape(h)
            full = urllib.parse.urljoin(url, h)
            pu = urllib.parse.urlparse(full)
            if pu.scheme in ("mailto", "tel") or (pu.netloc and pu.netloc != host):
                links.add(full)
            elif pu.netloc == host and not SKIP.search(pu.path):
                clean = f"{pu.scheme}://{pu.netloc}{pu.path}"
                if clean not in seen:
                    queue.append(clean)
        print("ok", url)
    with open(out / "content.md", "w", encoding="utf-8") as f:
        for url, title, desc, body in pages:
            f.write(f"\n\n========== {url}\nTITLE: {title}\nDESC: {desc}\n\n{body}\n")
    (out / "media.txt").write_text("\n".join(sorted(allmedia)), encoding="utf-8")
    (out / "links.txt").write_text("\n".join(sorted(links)), encoding="utf-8")
    print(len(pages), "páginas,", len(allmedia), "media,", len(links), "ligações externas")


if __name__ == "__main__":
    main()
