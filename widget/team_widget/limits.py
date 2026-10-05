"""The Claude plan limits for the widget's "Claude" lines (Sessão 5 h, Semana), only while they are recent enough to be true.

They are kept in ~/.team-agent/claude_usage.json, which two things write:
- the widget itself, every few minutes, asking the Claude account what the usage page shows (refresh_from_account);
- scripts/claude_statusline.py, each time Claude Code redraws its status line (only in a terminal).
Either way a 5-hour window read long ago says nothing about now: a window counts only while it is fresh and before its
reset, and with no recent week figure the widget falls back to the Hub's own numbers.
"""
import json
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

from . import hub

USAGE = hub.DATA_DIR / "claude_usage.json"
CREDENTIALS = Path.home() / ".claude" / ".credentials.json"
USAGE_URL = "https://api.anthropic.com/api/oauth/usage"   # what Claude's own usage page reads
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


# ---------------------------------------------------------------- straight from the Claude account

def rate_limits_from_account(body) -> dict:
    """The account's answer ({five_hour: {utilization, resets_at}, ...}) in the status line's shape ({used_percentage, resets_at})."""
    if not isinstance(body, dict):
        return {}
    out = {}
    for window in ("five_hour", "seven_day"):
        w = body.get(window)
        if isinstance(w, dict) and w.get("utilization") is not None:
            out[window] = {"used_percentage": w["utilization"], "resets_at": w.get("resets_at")}
    return out


def save_rate_limits(limits: dict, path: Path = USAGE, now: float | None = None):
    Path(path).write_text(json.dumps({"saved_at": time.time() if now is None else now, "rate_limits": limits}), encoding="utf-8")


def refresh_from_account(path: Path = USAGE, timeout: float = 8) -> bool:
    """Asks the Claude account for the usage figures, with the sign-in Claude Code keeps on this PC. True when saved.

    Only the short-lived access token is read and it only goes to api.anthropic.com. The refresh token is never touched:
    renewing it would sign Claude Code itself out. When the access token has run out, this waits for Claude Code to renew it."""
    try:
        oauth = json.loads(CREDENTIALS.read_text(encoding="utf-8"))["claudeAiOauth"]
        token = oauth["accessToken"]
        if oauth.get("expiresAt") and oauth["expiresAt"] / 1000 <= time.time():
            return False
        req = urllib.request.Request(USAGE_URL, headers={"Authorization": f"Bearer {token}", "anthropic-beta": "oauth-2025-04-20",
                                                         "Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout) as res:
            limits = rate_limits_from_account(json.load(res))
    except (OSError, ValueError, KeyError, TypeError, urllib.error.URLError):
        return False
    if "seven_day" not in limits:
        return False
    save_rate_limits(limits, path)
    return True
