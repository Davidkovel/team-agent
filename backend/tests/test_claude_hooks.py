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


def test_the_skills_hooks_go_in_at_the_start_and_at_each_request_and_claude_reads_them(tmp_path):
    path = tmp_path / "settings.json"
    path.write_text(json.dumps(THEIRS), encoding="utf-8")
    claude_hooks.install(path, python="py.exe")
    new = json.loads(path.read_text(encoding="utf-8"))
    for event in claude_hooks.CONTEXT_EVENTS:
        context = [h for group in new["hooks"][event] for h in group["hooks"] if str(claude_hooks.CONTEXT) in h["args"]]
        assert context == [{"type": "command", "command": "py.exe", "args": [str(claude_hooks.CONTEXT)], "timeout": 5}]
    assert not any(str(claude_hooks.CONTEXT) in h["args"] for group in new["hooks"]["Stop"] for h in group["hooks"])
    claude_hooks.install(path, python="py.exe", skills=False)   # CLAUDE_SKILLS=0: the Escritório's stay, the skills' go
    new = json.loads(path.read_text(encoding="utf-8"))
    hooks = [h for groups in new["hooks"].values() for group in groups for h in group["hooks"]]
    assert not any(str(claude_hooks.CONTEXT) in h.get("args", []) for h in hooks)
    assert any(str(claude_hooks.SCRIPT) in h.get("args", []) for h in hooks)


def test_a_request_gets_the_library_skills_that_fit_it(tmp_path, monkeypatch):
    import claude_contexto
    for name, about in [("site-empresa-local", "Site premium para um negócio local: escolas de condução, clínicas."),
                        ("premium-site-rebuild", "Rebuilds a weak company website into a premium one."),
                        ("seo-local", "Local SEO: Google Business Profile, maps."),
                        ("ads-meta", "Meta ads campaigns.")]:
        (tmp_path / "lib" / name).mkdir(parents=True)
        (tmp_path / "lib" / name / "SKILL.md").write_text(f"---\nname: {name}\ndescription: >\n  {about}\n---\n# x", encoding="utf-8")
    monkeypatch.setattr(claude_contexto, "LIB", tmp_path / "lib")
    monkeypatch.setattr(claude_contexto, "CACHE", tmp_path / "index.json")
    ask = lambda prompt: claude_contexto.context({"hook_event_name": "UserPromptSubmit", "prompt": prompt})
    text = ask("faz-me um site para uma escola de condução com SEO local")
    assert text.index("site-empresa-local") < text.index("premium-site-rebuild") and "seo-local" in text
    assert "ads-meta" not in text and str(tmp_path / "lib" / "seo-local" / "SKILL.md") in text
    assert ask("sim") == "" and ask("quanto é que o ouro subiu hoje?") == ""
    start = claude_contexto.context({"hook_event_name": "SessionStart", "source": "startup"})
    assert "4 skills" in start and "- SEO: seo-local" in start
    assert claude_contexto.context({"hook_event_name": "SessionStart", "source": "resume"}) == ""


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
