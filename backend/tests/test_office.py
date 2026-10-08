"""O Escritório: every Claude Code window on the team's PCs and the subagents it launches, from the hooks' steps.
Only the state is kept (one row per window, one per subagent), never every step."""
import os
import tempfile

os.environ.setdefault("DATABASE_URL", f"sqlite+aiosqlite:///{tempfile.mkdtemp()}/test.db")
os.environ.setdefault("REDIS_URL", "")

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.routers import office


@pytest.fixture(scope="module")
def client():
    # The hooks post from this computer (127.0.0.1), which belongs to Mark here.
    old = settings.ip_users
    settings.ip_users = "127.0.0.1=mark"
    with TestClient(app, client=("127.0.0.1", 50000)) as c:
        yield c
    settings.ip_users = old


@pytest.fixture(autouse=True)
def no_throttle():
    office._last_write.clear()
    yield


def login(client, username):
    r = client.post("/api/auth/login", json={"username": username, "password": f"{username}-change-me"})
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['token']}"}


def step(client, event, session="s1", **fields):
    r = client.post("/api/local/claude", json={"hook_event_name": event, "session_id": session, "cwd": "C:\\Users\\marco\\Desktop\\team-agent", **fields})
    assert r.status_code == 200, r.text
    return r.json()


def window(client, headers, session="s1"):
    return next(s for s in client.get("/api/office", headers=headers).json()["sessions"] if s["key"] == session)


def test_a_window_shows_whose_it_is_what_was_asked_and_what_it_is_doing(client):
    owner = login(client, "owner")
    step(client, "SessionStart", source="startup")
    step(client, "UserPromptSubmit", prompt="Melhora a página de tarefas\n e põe as urgentes em cima, por favor " + "x" * 300)
    step(client, "PreToolUse", tool_name="Edit", tool_input={"file_path": "C:\\Users\\marco\\Desktop\\team-agent\\frontend\\hub\\pages.js", "old_string": "segredo"})
    w = window(client, owner)
    assert w["user"] == "mark" and w["name"] == "Mark" and w["project"] == "team-agent"
    assert w["state"] == "working"
    assert w["prompt"].startswith("Melhora a página de tarefas e põe as urgentes") and len(w["prompt"]) <= 160
    assert w["request"].startswith("Melhora a página de tarefas\ne põe as urgentes") and len(w["request"]) > 160
    assert w["action"] == "a editar pages.js"
    assert "segredo" not in str(client.get("/api/office", headers=owner).json())  # never what is inside the files


def test_a_subagent_appears_under_its_window_and_finishes(client):
    owner = login(client, "owner")
    step(client, "UserPromptSubmit", session="s2", prompt="Encontra um voo barato")
    step(client, "PreToolUse", session="s2", tool_name="Agent", tool_use_id="tu-1",
         tool_input={"description": "Voos Porto Lisboa", "prompt": "procura...", "subagent_type": "pesquisador", "model": "haiku"})
    w = window(client, owner, "s2")
    assert [(a["kind"], a["model"], a["description"], a["state"]) for a in w["agents"]] == [("pesquisador", "haiku", "Voos Porto Lisboa", "working")]
    step(client, "PostToolUse", session="s2", tool_name="Agent", tool_use_id="tu-1",
         tool_response={"status": "completed", "agentId": "ag-1", "resolvedModel": "claude-haiku-4-5", "totalTokens": 12450,
                        "content": [{"type": "text", "text": "O mais barato: 79 € às 21:15, TAP."}]})
    agent = window(client, owner, "s2")["agents"][0]
    assert agent["state"] == "done" and agent["result"].startswith("O mais barato: 79 €")
    assert agent["model"] == "claude-haiku-4-5" and agent["tokens"] == 12450


def test_a_background_subagent_shows_its_own_steps_until_it_stops(client):
    owner = login(client, "owner")
    step(client, "PreToolUse", session="s3", tool_name="Agent", tool_use_id="tu-2",
         tool_input={"description": "Rever o widget", "subagent_type": "general-purpose"})
    step(client, "SubagentStart", session="s3", agent_id="a51ddc0791d0236f4", agent_type="general-purpose")
    step(client, "PostToolUse", session="s3", tool_name="Agent", tool_use_id="tu-2",
         tool_response={"status": "async_launched", "agentId": "a51ddc0791d0236f4",
                        "content": [{"type": "text", "text": "Async agent launched successfully.\nagentId: a51ddc0791d0236f4 (internal ID)"}]})
    step(client, "PreToolUse", session="s3", tool_name="Read", tool_input={"file_path": "C:\\w\\motion.py"},
         agent_id="a51ddc0791d0236f4", agent_type="general-purpose")
    w = window(client, owner, "s3")
    agent = w["agents"][0]
    assert agent["state"] == "working" and agent["action"] == "a ler motion.py"
    assert w["action"] != "a ler motion.py"  # the subagent's step is not the window's
    step(client, "SubagentStop", session="s3", agent_id="a51ddc0791d0236f4", agent_type="general-purpose", last_assistant_message="CPU do widget: 6,3% → 0,4%.")
    agent = window(client, owner, "s3")["agents"][0]
    assert agent["state"] == "done" and "0,4%" in agent["result"] and agent["action"] == ""


def test_waiting_for_the_person_and_closing(client):
    owner = login(client, "owner")
    step(client, "UserPromptSubmit", session="s4", prompt="Faz o push")
    step(client, "Notification", session="s4", message="Claude needs your permission to use Bash", notification_type="permission_prompt")
    assert window(client, owner, "s4")["state"] == "waiting"
    step(client, "UserPromptSubmit", session="s4", prompt="sim")
    step(client, "Stop", session="s4")
    w = window(client, owner, "s4")
    assert w["state"] == "waiting" and w["action"] == "acabou: à tua espera"
    step(client, "SessionEnd", session="s4", reason="prompt_input_exit")
    assert window(client, owner, "s4")["state"] == "ended"


def test_a_flood_of_steps_is_one_row_that_changes(client):
    """Hundreds of tool calls must not become hundreds of rows (or of writes): the state is kept, not every step."""
    owner = login(client, "owner")
    step(client, "UserPromptSubmit", session="s5", prompt="Muitos passos")
    office._last_write.clear()
    answers = [step(client, "PreToolUse", session="s5", tool_name="Read", tool_input={"file_path": f"f{i}.py"}) for i in range(50)]
    assert sum(1 for a in answers if a.get("written")) == 1  # the rest fall inside the throttle
    assert len([s for s in client.get("/api/office", headers=owner).json()["sessions"] if s["key"] == "s5"]) == 1


def test_only_this_computer_can_report_steps(client):
    with TestClient(app, client=("8.8.8.8", 50000)) as outside:
        r = outside.post("/api/local/claude", json={"hook_event_name": "SessionStart", "session_id": "x"})
    assert r.status_code == 403


def test_what_each_step_says(client):
    say = office.describe
    assert say("Read", {"file_path": "C:\\a\\b\\home.js"}) == "a ler home.js"
    assert say("Bash", {"command": "rm -rf segredo", "description": "Run the tests"}) == "a correr: Run the tests"
    assert "segredo" not in say("Bash", {"command": "cat segredo"})
    assert say("WebSearch", {"query": "salário do Kovel"}) == "a pesquisar na web"
    assert say("mcp__claude-in-chrome__navigate", {}) == "a usar o Chrome"
    assert say("Agent", {"subagent_type": "revisor-hub", "description": "Rever antes do push"}) == "lançou revisor-hub: Rever antes do push"


def test_tokens_and_model_come_from_the_transcripts(client, tmp_path):
    import json
    owner = login(client, "owner")
    folder = tmp_path / ".claude" / "projects" / "x"
    folder.mkdir(parents=True)
    main, sub = folder / "s6.jsonl", folder / "agent-a6.jsonl"
    record = lambda i, model, out: json.dumps({"type": "assistant", "message": {"id": i, "model": model, "usage": {"input_tokens": 100, "output_tokens": out}}})
    main.write_text(record("m1", "claude-opus-5-5", 50) + "\n", encoding="utf-8")
    sub.write_text(record("s1", "claude-haiku-4-5", 20) + "\n", encoding="utf-8")
    step(client, "PreToolUse", session="s6", tool_name="Agent", tool_use_id="tu-6", tool_input={"description": "Procurar", "subagent_type": "explorador"})
    step(client, "SubagentStart", session="s6", agent_id="a6", agent_type="explorador")
    step(client, "SubagentStop", session="s6", agent_id="a6", agent_type="explorador", agent_transcript_path=str(sub))
    step(client, "Stop", session="s6", transcript_path=str(main))
    w = window(client, owner, "s6")
    assert w["tokens"] == 150 and w["model"] == "claude-opus-5-5"
    assert w["agents"][0]["tokens"] == 120 and w["agents"][0]["model"] == "claude-haiku-4-5"
    step(client, "Stop", session="s6", transcript_path="C:\Windows\win.ini")  # never anything but Claude Code's own files
    assert window(client, owner, "s6")["tokens"] == 150


def test_a_message_from_another_claude_session_is_not_shown_as_a_request(client):
    owner = login(client, "owner")
    step(client, "UserPromptSubmit", session="s7", prompt='<cross-session-message from="uds:pipe" from-name="marco-6a">Olá</cross-session-message>')
    assert window(client, owner, "s7")["prompt"] == "(mensagem de outra sessão do Claude)"
    step(client, "UserPromptSubmit", session="s7", prompt="<command-name>/effort</command-name> Faz o push")
    assert window(client, owner, "s7")["prompt"] == "/effort Faz o push"


def test_an_agent_notice_is_not_shown_as_a_request(client):
    owner = login(client, "owner")
    step(client, "UserPromptSubmit", session="s8", prompt="<task-notification> <task-id>abc</task-id> <status>completed</status></task-notification>")
    assert window(client, owner, "s8")["prompt"] == "(aviso: um agente acabou)"
