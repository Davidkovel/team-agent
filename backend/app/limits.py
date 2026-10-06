"""The Claude plan limits (Sessão 5 h, Semana) of the person this computer belongs to, for the Hub's side panel.

The widget keeps them in ~/.team-agent/claude_usage.json (widget/team_widget/limits.py asks the Claude account every few
minutes; scripts/claude_statusline.py writes them too). The Hub only reads that file, with the widget's own rule: a window
counts while it is recent and before its reset. Nobody else's limits are known on this computer.
"""
import json
import time
from datetime import datetime
from pathlib import Path

from . import sync

USAGE = Path.home() / ".team-agent" / "claude_usage.json"
FIVE_MAX_AGE = 5 * 3600     # the session window is 5 hours long
WEEK_MAX_AGE = 24 * 3600    # the week moves slowly: a day-old figure is still worth seeing


def is_owner(username: str) -> bool:
    """Is this the person whose computer the Hub runs on? With the VPN down nobody can be told apart, so it is."""
    me = sync.whoami()
    return me is None or me[1] == username


def _reset(limit) -> float | None:
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
    reset = _reset(limit)
    return (None, None) if reset is not None and reset <= now else (limit["used_percentage"], reset)


def plan(path: Path = USAGE, now: float | None = None) -> dict | None:
    """{five, five_reset, week, week_reset, saved_at}, or None when nothing recent was saved on this computer."""
    now = time.time() if now is None else now
    try:
        saved = json.loads(Path(path).read_text(encoding="utf-8"))
        limits, age = saved["rate_limits"], now - float(saved["saved_at"])
    except (OSError, ValueError, KeyError, TypeError):
        return None
    week, week_reset = _fresh(limits.get("seven_day"), age, WEEK_MAX_AGE, now)
    five, five_reset = _fresh(limits.get("five_hour"), age, FIVE_MAX_AGE, now)
    if week is None and five is None:
        return None
    return {"five": five, "five_reset": five_reset, "week": week, "week_reset": week_reset, "saved_at": saved["saved_at"]}
