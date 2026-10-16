"""Puts the Escritório's hooks into this PC's Claude Code settings (~/.claude/settings.json), so every Claude window on
this PC, in any folder, reports its steps to this Hub (scripts/claude_hook.py -> routers/office.py).

Runs when the Hub starts, so a git pull that changes the hook reaches every PC by itself. It only touches its own hook
entries: every other setting and every other hook stays as it was. A file that is not valid JSON is never written.
The hooks are async (Claude never waits for them). CLAUDE_OFFICE=0 in backend/.env takes them out again.

Next to them go the skills hooks (scripts/claude_contexto.py, 16 Oct, Marco: «não queremos relembrar sempre ao nosso
Claude que tem de usar as skills»): at the start of a window and at each request Claude gets the company library's skills
that fit. Those two are not async, because what they print is read by Claude. CLAUDE_SKILLS=0 takes them out.
"""
import json
import logging
import os
import sys
from pathlib import Path

log = logging.getLogger("claude_hooks")
ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "claude_hook.py"
CONTEXT = ROOT / "scripts" / "claude_contexto.py"
MARKS = ("claude_hook.py", "claude_contexto.py")
CONTEXT_EVENTS = ("SessionStart", "UserPromptSubmit")
# event -> matcher (None = every one). After a tool only the subagent tool matters, so other tools cost nothing there.
EVENTS = {"SessionStart": None, "UserPromptSubmit": None, "PreToolUse": None, "PostToolUse": "Agent", "PostToolUseFailure": "Agent",
          "PermissionRequest": None, "Notification": None, "Stop": None, "SubagentStart": None, "SubagentStop": None,
          "PreCompact": None, "SessionEnd": None}


def _ours(hook: dict) -> bool:
    text = " ".join([str(hook.get("command", ""))] + [str(a) for a in hook.get("args", [])])
    return any(mark in text for mark in MARKS)


def wanted(python: str | None = None, office: bool = True, skills: bool = True) -> dict[str, list[dict]]:
    """The hook groups this Hub wants in the settings, per event: the Escritório's and the skills'."""
    out: dict[str, list[dict]] = {}
    if office:
        hook = {"type": "command", "command": python or sys.executable, "args": [str(SCRIPT)], "timeout": 10, "async": True}
        for event, matcher in EVENTS.items():
            out.setdefault(event, []).append({**({"matcher": matcher} if matcher else {}), "hooks": [hook]})
    if skills:
        hook = {"type": "command", "command": python or sys.executable, "args": [str(CONTEXT)], "timeout": 5}
        for event in CONTEXT_EVENTS:
            out.setdefault(event, []).append({"hooks": [hook]})
    return out


def merged(settings: dict, enabled: bool = True, python: str | None = None, skills: bool | None = None) -> dict:
    """The settings with our hooks in (or out), everything else untouched. `skills` follows `enabled` unless given."""
    out = json.loads(json.dumps(settings))
    hooks = out.get("hooks") if isinstance(out.get("hooks"), dict) else {}
    for event in list(hooks):
        groups = []
        for group in hooks[event] if isinstance(hooks[event], list) else []:
            if not isinstance(group, dict):
                groups.append(group)
                continue
            kept = [h for h in group.get("hooks", []) if not (isinstance(h, dict) and _ours(h))]
            if kept:
                groups.append({**group, "hooks": kept})
        if groups:
            hooks[event] = groups
        else:
            del hooks[event]
    for event, groups in wanted(python, enabled, enabled if skills is None else skills).items():
        hooks.setdefault(event, []).extend(groups)
    if hooks:
        out["hooks"] = hooks
    else:
        out.pop("hooks", None)
    return out


def install(path: Path | None = None, enabled: bool = True, python: str | None = None, skills: bool | None = None) -> bool:
    """True when the file was changed. Never raises: the Hub must start whatever happens here."""
    path = path or Path.home() / ".claude" / "settings.json"
    try:
        current = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
        if not isinstance(current, dict):
            raise ValueError("not a JSON object")
    except (OSError, ValueError) as e:
        log.warning("Claude Code settings not touched (%s): %s", path, e)
        return False
    new = merged(current, enabled, python, skills)
    if new == current:
        return False
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        backup = path.with_name(path.name + ".bak-amg")
        if path.exists() and not backup.exists():
            backup.write_text(path.read_text(encoding="utf-8"), encoding="utf-8")  # the person's own version, kept once
        tmp = path.with_name(path.name + ".tmp-amg")
        tmp.write_text(json.dumps(new, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        os.replace(tmp, path)
    except OSError as e:
        log.warning("Claude Code settings not written (%s): %s", path, e)
        return False
    log.info("Claude Code hooks for the Escritório %s, for the skills %s, in %s", "in place" if enabled else "taken out",
             "in place" if (enabled if skills is None else skills) else "taken out", path)
    return True
