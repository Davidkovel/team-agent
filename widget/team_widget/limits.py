"""The Claude plan limits for the widget's "Claude" lines (Sessão 5 h, Semana), only while they are recent enough to be true.

They come from ~/.team-agent/claude_usage.json, written by scripts/claude_statusline.py each time Claude Code redraws its
status line. That only happens where the status line is drawn (Claude Code in a terminal): elsewhere the file goes stale,
and a 5-hour window read days ago says nothing about now. So a window counts only while it is fresh and before its reset;
with neither window fresh the widget falls back to the Hub's own numbers.
"""
import json
import time
from datetime import datetime
from pathlib import Path

from . import hub

USAGE = hub.DATA_DIR / "claude_usage.json"
FIVE_MAX_AGE = 5 * 3600     # the session window is 5 hours long
WEEK_MAX_AGE = 24 * 3600    # the week moves slowly; a day-old figure, labelled with its age, is still worth seeing


def reset_of(limit) -> float | None:
    """When a limit resets, if Claude Code said so (epoch seconds or ISO text)."""
    v = (limit or {}).get("resets_at")
    if isinstance(v, (int, float)):
        return float(v)
    try:
        return datetime.fromisoformat(v.replace("Z", "+00:00")).timestamp() if isinstance(v, str) else None
    except ValueError:
        return None


def _fresh(limit, age: float, max_age: float, now: float):
    """(used %, reset) of a window still true now, else (None, None)."""
    if not isinstance(limit, dict) or limit.get("used_percentage") is None or age > max_age:
        return None, None
    reset = reset_of(limit)
    return (None, None) if reset is not None and reset <= now else (limit["used_percentage"], reset)


def claude_plan_usage(path: Path = USAGE, now: float | None = None) -> dict | None:
    """{week, week_reset, five, five_reset, saved_at}, or None when there is no recent week figure."""
    now = time.time() if now is None else now
    try:
        saved = json.loads(Path(path).read_text(encoding="utf-8"))
        limits, age = saved["rate_limits"], now - float(saved["saved_at"])
    except (OSError, ValueError, KeyError, TypeError):
        return None
    week, week_reset = _fresh(limits.get("seven_day"), age, WEEK_MAX_AGE, now)
    if week is None:
        return None
    five, five_reset = _fresh(limits.get("five_hour"), age, FIVE_MAX_AGE, now)
    return {"week": week, "week_reset": week_reset, "five": five, "five_reset": five_reset, "saved_at": saved["saved_at"]}
