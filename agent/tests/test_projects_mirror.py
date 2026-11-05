"""Only what the computer really keeps on the cloud counts as its folder, never the agents' own task folders."""
import json

from team_agent.core import projects


def test_only_the_folders_the_computer_sent(tmp_path, monkeypatch):
    monkeypatch.setattr(projects, "MIRROR", tmp_path)
    (tmp_path / "Secretária").mkdir()
    (tmp_path / "task-1").mkdir()
    assert projects.mirror("Secretária") is None  # no round yet
    (tmp_path / ".espelho.json").write_text(json.dumps({"quando": 1, "pastas": {"Secretária": {}, "sumiu": {}}}), encoding="utf-8")
    assert projects.mirror("Secretária") == tmp_path / "Secretária"
    assert projects.mirror("task-1") is None and projects.mirror("sumiu") is None and projects.mirror("../x") is None
    assert projects.fetch(tmp_path / "Secretária", "Secretária").startswith("This folder is the copy")


def test_a_conversation_with_no_project_sees_all_the_folders(tmp_path, monkeypatch):
    from types import SimpleNamespace

    from team_agent.core.agent import Agent

    monkeypatch.setattr(projects, "MIRROR", tmp_path)
    (tmp_path / "Secretária").mkdir()
    (tmp_path / ".espelho.json").write_text(json.dumps({"pastas": {"Secretária": {}}}), encoding="utf-8")
    me = SimpleNamespace(cfg=SimpleNamespace(worker="1", workspace=tmp_path / "w"))
    assert Agent._workspace(me, {"id": 1, "agent_role": "conversa"}) == tmp_path
    assert Agent._workspace(me, {"id": 2, "agent_role": "conversa", "project": "Secretária"}) == tmp_path / "Secretária"
    assert Agent._workspace(me, {"id": 3, "agent_role": "programador"}) == tmp_path / "w" / "task-3"
