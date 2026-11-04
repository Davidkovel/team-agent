"""Procurar em tudo o que foi dito ao Claude: neste computador, no telemóvel e na nuvem (a mesma busca do `recall` dos agentes).

    python3 scripts/lembrar.py loja natal desconto
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "agent"))
from team_agent.tools.recall_tool import search  # noqa: E402

words = " ".join(sys.argv[1:]).strip()
if not words:
    sys.exit("O que procuro? python3 scripts/lembrar.py <palavras>")
hits = search(words)
if not hits:
    print("Nada encontrado.")
for hit in hits:
    print(f"- {hit.get('when', '')} · {hit.get('project', '')}: {hit.get('text') or hit.get('snippet') or hit}")
