"""Fonte: lê anúncios do Vinted abrindo a página pública da pesquisa num Chrome normal (Selenium).

Educado: uma página por pesquisa, sem disfarces nem proxies. Se o Vinted mostrar um desafio/bloqueio, paramos.
"""
import re
import sys
import time
from urllib.parse import quote

from selenium import webdriver
from selenium.webdriver.common.by import By

DOMINIOS = {"pt": "www.vinted.pt", "es": "www.vinted.es", "fr": "www.vinted.fr",
            "it": "www.vinted.it", "de": "www.vinted.de", "at": "www.vinted.at"}


def abrir_browser():
    o = webdriver.ChromeOptions()
    o.add_argument("--headless=new")
    o.add_argument("--window-size=1400,1000")
    return webdriver.Chrome(options=o)


def _preco(txt):
    m = re.search(r"(\d+(?:[.,]\d+)?)", txt)
    return float(m.group(1).replace(",", ".")) if m else None


def ler_anuncios(browser, pesquisa, pais="pt", n=200, preco_max=200, pagina=1, ordem="newest_first"):
    url = (f"https://{DOMINIOS[pais]}/catalog?search_text={quote(pesquisa)}"
           f"&order={ordem}&price_to={preco_max}&page={pagina}")
    browser.get(url)
    time.sleep(5)
    if "Artigos" not in browser.title and "Vinted" not in browser.title:
        raise RuntimeError(f"Página inesperada ({browser.title!r}); paramos, sem contornar.")
    anuncios = []
    for caixa in browser.find_elements(By.CSS_SELECTOR, "[data-testid^='product-item-id-'][data-testid$='-overlay-link']")[:n]:
        titulo_completo = caixa.get_attribute("title") or ""
        partes = [p.strip() for p in titulo_completo.split(",")]
        info = {"titulo": partes[0] if partes else "", "marca": "", "estado": "", "tamanho": "", "preco": None}
        resto = []
        for p in partes[1:]:
            if p.startswith("Marca:"):
                info["marca"] = p[6:].strip()
            elif p.startswith("Estado:"):
                info["estado"] = p[7:].strip()
            elif p.startswith("Tamanho:"):
                info["tamanho"] = p[8:].strip()
            else:
                resto.append(p)
        # o primeiro valor com dígitos depois dos campos é o preço; o segundo inclui a proteção do comprador
        precos = [_preco(p) for p in resto if _preco(p) is not None]
        info["preco"] = precos[-2] if len(precos) >= 2 else (precos[0] if precos else None)
        href = caixa.get_attribute("href") or ""
        info["id"] = int(re.search(r"/items/(\d+)", href).group(1))
        info["link"] = href.split("?")[0]
        img = browser.find_elements(By.CSS_SELECTOR, f"[data-testid='product-item-id-{info['id']}--image--img']")
        info["foto"] = img[0].get_attribute("src") if img else ""
        info["visto_em"] = time.strftime("%Y-%m-%d %H:%M:%S")
        anuncios.append(info)
    return anuncios

