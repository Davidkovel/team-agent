"""Passo 1: lista 20 anúncios reais do Vinted (Selenium, página pública).
Uso: python scripts/teste_acesso.py ["casaco nylon"] [pt]
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from fonte import abrir_browser, ler_anuncios  # noqa: E402

if __name__ == "__main__":
    pesquisa = sys.argv[1] if len(sys.argv) > 1 else "casaco nylon"
    pais = sys.argv[2] if len(sys.argv) > 2 else "pt"
    b = abrir_browser()
    try:
        itens = ler_anuncios(b, pesquisa, pais, n=20)
    finally:
        b.quit()
    print(f"{len(itens)} anúncios ({pesquisa}, {pais})")
    for a in itens:
        print(f"- {a['preco']} EUR | {a['marca']} | {a['tamanho']} | {a['estado']} | {a['titulo'][:45]} | {a['link']}")
