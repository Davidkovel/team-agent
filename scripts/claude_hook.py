"""Claude Code hook for the Escritório: sends each step of this Claude window to this PC's Hub (backend/app/routers/office.py).

The Hub puts it in place itself (backend/app/claude_hooks.py) as an async hook, so Claude never waits for it. It sends
names and ids only (which tool, which file name, which subagent), never what is inside a file, a command or a page;
the start of the request and of a subagent's answer are cut short. It never fails: with no Hub it just stays quiet.
"""
import json
import sys
import urllib.request

HUB = "http://127.0.0.1:8000/api/local/claude"
PLAIN = ("hook_event_name", "session_id", "cwd", "tool_name", "tool_use_id", "agent_id", "agent_type", "notification_type", "reason", "source")
TOOL_INPUT = ("file_path", "notebook_path", "description", "subagent_type", "model", "skill")  # nothing else of a tool's input leaves
AGENT_ANSWER = ("status", "agentId", "resolvedModel", "totalTokens")


def cut(text, limit: int) -> str:
    text = " ".join(str(text or "").split())
    return text[:limit]


def answer_text(response) -> str:
    content = response.get("content") if isinstance(response, dict) else response
    if isinstance(content, list):
        return " ".join(part.get("text", "") for part in content if isinstance(part, dict))
    return str(content or "")


def model_of(transcript: str) -> str:
    """The model of the last reply, from the end of the window's transcript (only the last 64 KB are read)."""
    try:
        with open(transcript, "rb") as f:
            f.seek(0, 2)
            f.seek(max(0, f.tell() - 65536))
            lines = f.read().decode("utf-8", "replace").splitlines()
    except (OSError, TypeError):
        return ""
    for line in reversed(lines):
        if '"model"' not in line:
            continue
        try:
            model = (json.loads(line).get("message") or {}).get("model")
        except ValueError:
            continue
        if model:
            return str(model)
    return ""


def step(data: dict) -> dict:
    body = {key: data[key] for key in PLAIN if data.get(key) not in (None, "")}
    event = data.get("hook_event_name")
    if data.get("prompt"):
        body["prompt"] = cut(data["prompt"], 200)
    if isinstance(data.get("tool_input"), dict):
        body["tool_input"] = {key: cut(data["tool_input"][key], 200) for key in TOOL_INPUT if data["tool_input"].get(key)}
    if data.get("tool_name") == "Agent" and data.get("tool_response") is not None:
        response = data["tool_response"]
        facts = {key: response[key] for key in AGENT_ANSWER if isinstance(response, dict) and key in response}
        body["tool_response"] = {**facts, "content": [{"type": "text", "text": cut(answer_text(response), 300)}]}
    if data.get("last_assistant_message"):
        body["last_assistant_message"] = cut(data["last_assistant_message"], 300)
    if data.get("message"):
        body["message"] = cut(data["message"], 200)
    if data.get("error"):
        body["error"] = cut(data["error"], 200)
    if event in ("Stop", "SessionEnd") and data.get("transcript_path"):
        body["transcript_path"] = str(data["transcript_path"])  # the Hub reads only usage numbers in it (transcripts.py)
    if event == "SubagentStop" and data.get("agent_transcript_path"):
        body["agent_transcript_path"] = str(data["agent_transcript_path"])
    if event in ("Stop", "SessionStart"):
        model = model_of(data.get("transcript_path"))
        if model:
            body["model"] = model
    return body


def main():
    try:
        data = json.loads(sys.stdin.buffer.read().decode("utf-8", "replace") or "{}")
    except ValueError:
        return
    if not isinstance(data, dict) or not data.get("session_id"):
        return
    request = urllib.request.Request(HUB, data=json.dumps(step(data)).encode("utf-8"), method="POST",
                                     headers={"Content-Type": "application/json"})
    try:
        urllib.request.urlopen(request, timeout=2).read()
    except Exception:  # no Hub, Hub restarting, anything: the window goes on, the Escritório catches up at the next step
        pass


if __name__ == "__main__":
    main()
