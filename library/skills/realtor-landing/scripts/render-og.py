#!/usr/bin/env python3
"""Renderiza o cartao de pre-visualizacao (og:image) 1200x630 a partir de
assets/og-card.html.

O que faz:
  1. le o template HTML,
  2. substitui os placeholders {{...}} a partir de um JSON,
  3. abre a pagina num browser headless e tira uma captura 1200x630 a 2x,
  4. reduz para 1200x630 e grava JPEG.

Motor: usa Playwright se estiver instalado (unica via para fazer os passos 3 e 4
num so processo). Se nao estiver, o script NAO falha em silencio: imprime o
comando exacto de Chrome headless para fazer o mesmo a mao.

Exemplos:
  ./render-og.py --data cliente.json --out site/assets/og-cliente-v1.jpg
  ./render-og.py --data cliente.json --out og.jpg --keep-html   # ver o HTML final
  ./render-og.py --print-defaults > cliente.json                # ponto de partida

Lembra-te: mudar o conteudo do cartao obriga a mudar o NOME do ficheiro
(og-...-v2.jpg) e os metas og:image/twitter:image. Os scrapers fazem cache por URL.
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_TEMPLATE = os.path.normpath(os.path.join(HERE, "..", "assets", "og-card.html"))

WIDTH, HEIGHT = 1200, 630
SCALE = 2          # renderiza a 2x e reduz: texto limpo sem o peso do 2x
JPEG_QUALITY = 88  # 88 mantem o ficheiro bem abaixo dos 300KB

# Valores de exemplo — todos placeholders, sem dados reais de ninguem.
DEFAULTS = {
    "NOME": "{{NOME}}",
    "FUNCAO": "Consultor Imobiliario",
    "KICKER": "Comprar &middot; Vender &middot; {{CIDADE}}",
    "META1": "{{AGENCIA}} &middot; {{CIDADE}} e todo o pais",
    "META2": "Avaliacao gratuita &middot; {{TELEFONE_E164}}",
    "FOTO": "https://{{DOMINIO}}/assets/hero-cut.png",
    "LOGO": "https://{{DOMINIO}}/assets/logo.png",
    "COR_FUNDO": "#0A0A0A",
    "COR_FUNDO_RGB": "10,10,10",
    "COR_ACENTO": "#1C64F2",
    "COR_ACENTO_CLARO": "#9DC2FF",
    "COR_ACENTO_REGUA": "#4D8DF6",
    "COR_TEXTO": "#F2F5FA",
    "COR_TEXTO_SEC": "#AEB9CC",
    "COR_META": "#C4CDDC",
    "COR_META_FRACA": "#8792A6",
    "FONTE_DISPLAY": "Bricolage Grotesque",
    "FONTE_DISPLAY_URL": "Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700",
    "FONTE_TEXTO": "Instrument Sans",
    "FONTE_TEXTO_URL": "Instrument+Sans:wght@400;500;600",
}


# ---------------------------------------------------------------- template

def fill(template: str, data: dict) -> str:
    """Substitui {{CHAVE}} pelos valores do dict. Placeholders sem valor ficam
    como estao — de proposito: assim veem-se na imagem em vez de saltarem para
    producao vazios e passarem despercebidos."""
    def sub(m):
        key = m.group(1).strip()
        return str(data[key]) if key in data else m.group(0)
    return re.sub(r"\{\{([A-Z0-9_]+)\}\}", sub, template)


def missing_keys(html: str) -> list:
    return sorted(set(re.findall(r"\{\{([A-Z0-9_]+)\}\}", html)))


# ---------------------------------------------------------------- motores

def have_playwright() -> bool:
    """Testa o import a serio, nao adivinha. Ter o pacote nao chega — e preciso
    que o Chromium tenha sido descarregado (playwright install chromium)."""
    try:
        import playwright.sync_api  # noqa: F401
        return True
    except Exception:
        return False


def find_chrome() -> str:
    """Procura um Chrome/Chromium utilizavel para o caminho alternativo."""
    for name in ("google-chrome", "google-chrome-stable", "chromium",
                 "chromium-browser", "microsoft-edge"):
        p = shutil.which(name)
        if p:
            return p
    mac = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    if os.path.exists(mac):
        return mac
    mac_c = "/Applications/Chromium.app/Contents/MacOS/Chromium"
    if os.path.exists(mac_c):
        return mac_c
    return ""


def render_playwright(html_path: str, out_path: str) -> None:
    from playwright.sync_api import sync_playwright

    png_path = out_path + ".raw.png"
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(
            viewport={"width": WIDTH, "height": HEIGHT},
            device_scale_factor=SCALE,
        )
        page.goto("file://" + html_path)
        # Esperar pelas fontes e pelas imagens: uma captura tirada antes disto
        # sai com a fonte de sistema e sem o recorte da pessoa.
        page.wait_for_load_state("networkidle")
        page.evaluate("document.fonts.ready")
        page.wait_for_timeout(600)
        page.screenshot(path=png_path, clip={"x": 0, "y": 0,
                                             "width": WIDTH, "height": HEIGHT})
        browser.close()

    to_jpeg(png_path, out_path)
    os.remove(png_path)


def to_jpeg(png_path: str, out_path: str) -> None:
    """PNG 2x -> JPEG 1200x630. Pillow se existir; senao sips (macOS);
    senao deixa o PNG e avisa — PNG passa dos 1MB e ha clientes que desistem
    do download, por isso isto e um aviso a serio, nao um detalhe."""
    try:
        from PIL import Image
        im = Image.open(png_path).convert("RGB")
        if im.size != (WIDTH, HEIGHT):
            im = im.resize((WIDTH, HEIGHT), Image.LANCZOS)
        im.save(out_path, "JPEG", quality=JPEG_QUALITY, optimize=True,
                progressive=True)
        return
    except ImportError:
        pass

    if shutil.which("sips"):
        subprocess.run(["sips", "-s", "format", "jpeg",
                        "-s", "formatOptions", str(JPEG_QUALITY),
                        "-z", str(HEIGHT), str(WIDTH),
                        png_path, "--out", out_path],
                       check=True, capture_output=True)
        return

    fallback = os.path.splitext(out_path)[0] + ".png"
    shutil.copyfile(png_path, fallback)
    sys.stderr.write(
        "\nAVISO: sem Pillow e sem sips — nao foi possivel converter para JPEG.\n"
        f"Ficou {fallback} (PNG, tipicamente >1MB).\n"
        "Instala Pillow (pip install Pillow) ou converte a mao antes de publicar:\n"
        f"  magick {fallback} -resize {WIDTH}x{HEIGHT} -quality {JPEG_QUALITY} {out_path}\n"
    )


def print_chrome_instructions(html_path: str, out_path: str) -> None:
    chrome = find_chrome() or "google-chrome"
    quoted = f'"{chrome}"' if " " in chrome else chrome
    png = os.path.splitext(out_path)[0] + "-2x.png"
    sys.stderr.write(f"""
Playwright nao esta instalado neste Python ({sys.executable}).

Opcao A — instalar:
  {sys.executable} -m pip install playwright
  {sys.executable} -m playwright install chromium

Opcao B — Chrome headless a mao (o HTML preenchido esta em {html_path}):
  {quoted} \\
    --headless \\
    --disable-gpu \\
    --hide-scrollbars \\
    --force-device-scale-factor={SCALE} \\
    --window-size={WIDTH},{HEIGHT} \\
    --screenshot={png} \\
    "file://{html_path}"

  depois reduz e converte para JPEG:
    sips -s format jpeg -s formatOptions {JPEG_QUALITY} -z {HEIGHT} {WIDTH} {png} --out {out_path}
  ou:
    magick {png} -resize {WIDTH}x{HEIGHT} -quality {JPEG_QUALITY} {out_path}

Nota: o Chrome headless nao espera pelas web fonts. Se o cartao sair com a fonte
de sistema, corre o comando duas vezes (a segunda ja tem as fontes em cache) ou usa
a opcao A. Usa --keep-html para o ficheiro preenchido nao ser apagado.
""")
    if not find_chrome():
        sys.stderr.write("Tambem nao encontrei nenhum Chrome/Chromium no sistema.\n")


# ---------------------------------------------------------------- cli

def main() -> int:
    ap = argparse.ArgumentParser(
        prog="render-og.py",
        description="Renderiza o cartao og:image 1200x630 a partir de og-card.html.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__.split("Exemplos:", 1)[1] if "Exemplos:" in __doc__ else None,
    )
    ap.add_argument("--data", help="JSON com os valores dos placeholders "
                                   "(ver --print-defaults)")
    ap.add_argument("--template", default=DEFAULT_TEMPLATE,
                    help="template HTML (por omissao: assets/og-card.html)")
    ap.add_argument("--out", default="og.jpg",
                    help="ficheiro de saida .jpg (usa sufixo de versao: "
                         "og-nome-v2.jpg — os scrapers fazem cache por URL)")
    ap.add_argument("--set", action="append", default=[], metavar="CHAVE=VALOR",
                    help="sobrepoe um valor do JSON; repetivel")
    ap.add_argument("--keep-html", action="store_true",
                    help="nao apaga o HTML preenchido (util para inspeccionar)")
    ap.add_argument("--print-defaults", action="store_true",
                    help="imprime o JSON de exemplo e sai")
    args = ap.parse_args()

    if args.print_defaults:
        print(json.dumps(DEFAULTS, indent=2, ensure_ascii=False))
        return 0

    if not os.path.exists(args.template):
        sys.stderr.write(f"ERRO: template nao encontrado: {args.template}\n")
        return 2

    data = dict(DEFAULTS)
    if args.data:
        if not os.path.exists(args.data):
            sys.stderr.write(f"ERRO: --data nao encontrado: {args.data}\n")
            return 2
        with open(args.data, encoding="utf-8") as f:
            data.update(json.load(f))
    for pair in args.set:
        if "=" not in pair:
            sys.stderr.write(f"ERRO: --set espera CHAVE=VALOR, recebeu: {pair}\n")
            return 2
        k, v = pair.split("=", 1)
        data[k.strip()] = v

    with open(args.template, encoding="utf-8") as f:
        html = fill(f.read(), data)

    left = missing_keys(html)
    if left:
        sys.stderr.write("AVISO: placeholders por preencher (vao aparecer na "
                         "imagem): " + ", ".join(left) + "\n")

    out_path = os.path.abspath(args.out)
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)

    fd, html_path = tempfile.mkstemp(suffix=".og-card.html",
                                     dir=os.path.dirname(out_path))
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(html)

    try:
        if not have_playwright():
            print_chrome_instructions(html_path, out_path)
            args.keep_html = True  # sem o HTML, a opcao B nao serve de nada
            return 1
        render_playwright(html_path, out_path)
    finally:
        if not args.keep_html and os.path.exists(html_path):
            os.remove(html_path)
        elif args.keep_html:
            sys.stderr.write(f"HTML preenchido: {html_path}\n")

    size = os.path.getsize(out_path)
    print(f"{out_path}  {WIDTH}x{HEIGHT}  {size/1024:.0f}KB")
    if size > 300 * 1024:
        sys.stderr.write("AVISO: acima de 300KB — ha clientes que desistem do "
                         "download e a partilha sai sem imagem. Baixa a "
                         "JPEG_QUALITY.\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
