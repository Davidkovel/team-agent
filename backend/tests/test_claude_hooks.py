"""The Escritório's hooks go into Claude Code's settings without touching anything else there, and the hook script
sends only names and ids."""
import json
import sys
from pathlib import Path

from app import claude_hooks

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
import claude_hook  # noqa: E402

THEIRS = {"model": "opus", "theme": "dark", "statusLine": {"type": "command", "command": "python statusline.py"},
          "hooks": {"Stop": [{"hooks": [{"type": "command", "command": "powershell.exe", "args": ["-File", "notify-windows.ps1"], "async": True}]}]}}


def test_our_hooks_go_in_and_everything_else_stays(tmp_path):
    path = tmp_path / "settings.json"
    path.write_text(json.dumps(THEIRS), encoding="utf-8")
    assert claude_hooks.install(path, python="py.exe")
    new = json.loads(path.read_text(encoding="utf-8"))
    assert new["model"] == "opus" and new["statusLine"] == THEIRS["statusLine"] and new["theme"] == "dark"
    stop = [h for group in new["hooks"]["Stop"] for h in group["hooks"]]
    assert any("notify-windows.ps1" in h["args"][-1] for h in stop)  # their own hook is still there
    ours = [h for group in new["hooks"]["Stop"] for h in group["hooks"] if claude_hooks._ours(h)]
    assert ours == [{"type": "command", "command": "py.exe", "args": [str(claude_hooks.SCRIPT)], "timeout": 10, "async": True}]
    assert set(claude_hooks.EVENTS) <= set(new["hooks"])
    assert new["hooks"]["PostToolUse"][-1]["matcher"] == "Agent"
    assert (tmp_path / "settings.json.bak-amg").exists()


def test_installing_twice_changes_nothing_and_off_takes_ours_out(tmp_path):
    path = tmp_path / "settings.json"
    path.write_text(json.dumps(THEIRS), encoding="utf-8")
    claude_hooks.install(path, python="py.exe")
    assert not claude_hooks.install(path, python="py.exe")
    assert claude_hooks.install(path, enabled=False)
    assert json.loads(path.read_text(encoding="utf-8")) == THEIRS


def test_a_broken_settings_file_is_never_written(tmp_path):
    path = tmp_path / "settings.json"
    path.write_text("{ not json", encoding="utf-8")
    assert not claude_hooks.install(path)
    assert path.read_text(encoding="utf-8") == "{ not json"


def test_the_hook_sends_names_not_contents():
    body = claude_hook.step({"hook_event_name": "PreToolUse", "session_id": "s", "cwd": "C:\\x", "tool_name": "Edit", "tool_use_id": "t",
                             "tool_input": {"file_path": "C:\\x\\pages.js", "old_string": "SEGREDO", "new_string": "SEGREDO2"},
                             "transcript_path": "C:\\nada.jsonl", "permission_mode": "default"})
    assert body["tool_input"] == {"file_path": "C:\\x\\pages.js"} and "SEGREDO" not in json.dumps(body)
    agent = claude_hook.step({"hook_event_name": "PostToolUse", "session_id": "s", "tool_name": "Agent",
                              "tool_input": {"prompt": "SEGREDO longo", "description": "Voos", "subagent_type": "pesquisador"},
                              "tool_response": {"status": "completed", "agentId": "a1", "totalTokens": 5, "usage": {"x": 1},
                                                "content": [{"type": "text", "text": "79 € " + "x" * 1000}]}})
    assert "SEGREDO" not in json.dumps(agent) and agent["tool_input"]["description"] == "Voos"
    assert agent["tool_response"]["totalTokens"] == 5 and len(agent["tool_response"]["content"][0]["text"]) == 300


def test_the_model_comes_from_the_end_of_the_transcript(tmp_path):
    transcript = tmp_path / "t.jsonl"
    transcript.write_text("\n".join(json.dumps(x) for x in [
        {"type": "assistant", "message": {"model": "claude-sonnet-5-5"}},
        {"type": "user", "message": {"content": "olá"}},
        {"type": "assistant", "message": {"model": "claude-opus-5-5"}},
        {"type": "user", "message": {"content": "fim"}}]), encoding="utf-8")
    assert claude_hook.model_of(str(transcript)) == "claude-opus-5-5"
    assert claude_hook.step({"hook_event_name": "Stop", "session_id": "s", "transcript_path": str(transcript)})["model"] == "claude-opus-5-5"
