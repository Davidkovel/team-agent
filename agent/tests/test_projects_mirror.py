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
