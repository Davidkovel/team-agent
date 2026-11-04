"""recall: this computer's Claude conversations and, since 4 Nov, those the person's other computers sent
(backend/app/recall_share.py writes them to ~/.team-agent/recall-peers/<computer>/)."""
import json

from team_agent.tools import recall_tool


def write_transcript(root, folder, session, lines):
    (root / folder).mkdir(parents=True, exist_ok=True)
    (root / folder / f"{session}.jsonl").write_text(
        "\n".join(json.dumps(x, separators=(",", ":"), ensure_ascii=False) for x in lines), encoding="utf-8")


def test_finds_what_was_done_on_the_mac(tmp_path, monkeypatch):
    monkeypatch.setattr(recall_tool, "INDEX", tmp_path / "index")
    here, peers = tmp_path / "projects", tmp_path / "recall-peers"
    write_transcript(here, "-opt-amg-team-agent", "c1",
                     [{"type": "user", "timestamp": "2026-11-04T09:00:00Z", "message": {"content": "Liga os agentes na nuvem"}}])
    mac = peers / "MacBook-Air-de-David"
    mac.mkdir(parents=True)
    (mac / "_computer.json").write_text(json.dumps({"computer": "MacBook-Air-de-David", "system": "mac"}))
    (mac / "Users-david-Documents-escola__s1.json").write_text(json.dumps({
        "folder": "-Users-david-Documents-escola", "mtime": 1,
        "items": [["2026-11-03 10:00", "pessoa", "O site da escola com a qualidade do Gato Preto: preto e âmbar"],
                  ["2026-11-03 10:05", "claude", "Feito, com o gato no topo e o manual de marca."]]}), encoding="utf-8")

    hits = recall_tool.search("qualidade gato preto", root=here, peers=peers)
    assert hits and hits[0]["project"] == "escola · Mac" and "Gato Preto" in hits[0]["text"]
    assert "· Mac" not in recall_tool.search("agentes nuvem", root=here, peers=peers)[0]["project"]   # this computer's own


def test_without_anything_from_other_computers_it_works_as_before(tmp_path, monkeypatch):
    monkeypatch.setattr(recall_tool, "INDEX", tmp_path / "index")
    here = tmp_path / "projects"
    write_transcript(here, "-opt-amg-team-agent", "c1",
                     [{"type": "assistant", "message": {"content": [{"type": "text", "text": "O Hub da nuvem está ligado"}]}}])
    assert recall_tool.search("hub nuvem", root=here, peers=tmp_path / "nada")[0]["who"] == "claude"
    assert recall_tool.search("hub nuvem", root=tmp_path / "nada", peers=tmp_path / "nada") == []


def test_the_cloud_agent_sees_its_code_change(tmp_path):
    from team_agent.core import agent
    (tmp_path / "a.py").write_text("x = 1")
    before = agent.code_stamp(tmp_path)
    import os
    os.utime(tmp_path / "a.py", (before + 5, before + 5))
    assert agent.code_stamp(tmp_path) > before
    assert agent.code_stamp(tmp_path / "nada") == 0.0
