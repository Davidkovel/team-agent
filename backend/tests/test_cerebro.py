"""O Cérebro: the plan of a request, the AIs a step reaches and the trail of a window (routers/cerebro.py, office.py)."""
from types import SimpleNamespace

from app.routers import cerebro, office


def test_plan_picks_the_kind_and_the_ai():
    p = cerebro.plan("faz-me um logo para a Face Twin")
    assert p["label"] == "Imagem" and p["engines"][0]["name"] == "Higgsfield"
    p = cerebro.plan("corrige o bug do widget")
    assert p["label"] == "Código" and p["model"] == "opus" and p["folder"].endswith("team-agent")
    assert cerebro.plan("olá tudo bem")["label"] == "Geral"


def test_brain_prompt_keeps_the_request_whole():
    text = "linha 1\nlinha 2 com muito texto"
    out = cerebro.brain_prompt(text, cerebro.plan(text))
    assert out.startswith(text) and "Cérebro AMG" in out


def test_engine_of():
    assert office.engine_of("mcp__claude_ai_Higgsfield__generate_image", {}) == "Higgsfield"
    assert office.engine_of("Bash", {"description": "Ask ChatGPT (codex) for a review"}) == "ChatGPT"
    assert office.engine_of("Read", {"file_path": "a.py"}) == ""
    assert office.engine_of("Agent", {}) == "Subagente"


def test_trail_is_short_and_links_are_unique():
    row = SimpleNamespace(steps=None, links="")
    for i in range(office.TRAIL + 5):
        office._trail(row, f"passo {i}", "Canva" if i % 2 else "Higgsfield", at=i)
    office._trail(row, f"passo {office.TRAIL + 4}", "")   # the same step twice is kept once
    steps = office.trail_of(row)
    assert len(steps) == office.TRAIL and steps[-1]["text"] == f"passo {office.TRAIL + 4}"
    assert row.links.split(",") == ["Higgsfield", "Canva"] or row.links.split(",") == ["Canva", "Higgsfield"]
