"""The hook Claude Code runs at each step (scripts/claude_hook.py): what leaves this PC for the Hub."""
import importlib.util
import json
from pathlib import Path

HOOK = Path(__file__).resolve().parents[2] / "scripts" / "claude_hook.py"
spec = importlib.util.spec_from_file_location("claude_hook", HOOK)
hook = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hook)


def transcript(tmp_path, *records):
    path = tmp_path / "s.jsonl"
    path.write_text("\n".join(json.dumps(r) for r in records) + "\n", encoding="utf-8")
    return str(path)


def said(text, model="claude-opus-5-5"):
    return {"type": "assistant", "message": {"model": model, "content": [{"type": "text", "text": text}]}}


def test_the_title_claude_gave_the_conversation_goes_with_a_request_and_with_the_end(tmp_path):
    path = transcript(tmp_path, {"type": "ai-title", "aiTitle": "Primeiro título"}, said("ok"),
                      {"type": "ai-title", "aiTitle": "Agentes: organização visual"}, said("feito"))
    for event in ("UserPromptSubmit", "Stop"):
        assert hook.step({"hook_event_name": event, "session_id": "s", "transcript_path": path})["title"] == "Agentes: organização visual"
    step = hook.step({"hook_event_name": "PreToolUse", "session_id": "s", "transcript_path": path, "tool_name": "Read"})
    assert "title" not in step  # an ordinary step reads nothing


def test_a_window_that_stops_sends_the_start_of_its_last_answer(tmp_path):
    path = transcript(tmp_path, said("A ver o código."), {"type": "user", "message": {"content": "segredo do pedido"}},
                      said("Corrigi o login. " + "x" * 900), {"type": "assistant", "message": {"content": [{"type": "tool_use", "name": "Read"}]}})
    body = hook.step({"hook_event_name": "Stop", "session_id": "s", "transcript_path": path})
    assert body["last_assistant_message"].startswith("Corrigi o login.") and len(body["last_assistant_message"]) <= 300
    assert "segredo" not in json.dumps(body)
    given = hook.step({"hook_event_name": "Stop", "session_id": "s", "transcript_path": path, "last_assistant_message": "O que o Claude Code mandou."})
    assert given["last_assistant_message"] == "O que o Claude Code mandou."  # what Claude Code says itself comes first


def test_a_window_with_no_transcript_still_reports(tmp_path):
    body = hook.step({"hook_event_name": "Stop", "session_id": "s", "transcript_path": str(tmp_path / "nada.jsonl")})
    assert body["hook_event_name"] == "Stop" and "title" not in body and "last_assistant_message" not in body
