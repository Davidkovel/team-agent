"""Claude Code status line: shows the plan limits in the terminal and saves them for the widget.

Claude Code runs this after every reply and pipes a JSON of the session to stdin. If it carries `rate_limits`
(five_hour / seven_day, with used_percentage), they go to ~/.team-agent/claude_usage.json, which the widget reads.
What it prints is the line under the prompt: «5h ██░░░░░░░░ 21% · 16:20 | Semana █░░░░░░░░░ 8% · sex 00:00 | Effort high».
With no limits in the payload (a new window, before its first reply) it shows the ones saved in that file.
The first payload is also kept whole in claude_statusline_sample.json so the fields can be checked.

In settings.json the command must use forward slashes: Claude Code runs it through bash on Windows too, and bash
eats backslashes, so with them the status line silently never runs.
"""
import json
import sys
import time
from datetime import datetime
from pathlib import Path

DIR = Path.home() / ".team-agent"
USAGE = DIR / "claude_usage.json"
DAYS = ("seg", "ter", "qua", "qui", "sex", "sáb", "dom")
BAR = 10
GREEN, AMBER, RED, DIM, END = "\x1b[32m", "\x1b[33m", "\x1b[31m", "\x1b[2m", "\x1b[0m"


def reset_of(limit):
    """When a limit resets, as epoch seconds: Claude Code sends a number, the widget's copy ISO text."""
    value = limit.get("resets_at")
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() if isinstance(value, str) else None
    except ValueError:
        return None


def when(reset, now):
    """The reset in local time: the hour alone if it is within a day, with the weekday otherwise."""
    moment = datetime.fromtimestamp(reset)
    hour = moment.strftime("%H:%M")
    return hour if reset - now < 86400 else f"{DAYS[moment.weekday()]} {hour}"


def window(name, limit, now):
    """One limit as text, or None when there is no figure or the figure is from before its reset."""
    if not isinstance(limit, dict) or limit.get("used_percentage") is None:
        return None
    reset = reset_of(limit)
    if reset is not None and reset <= now:
        return None
    used = float(limit["used_percentage"])
    color = RED if used >= 90 else AMBER if used >= 70 else GREEN
    full = min(BAR, round(used / 100 * BAR))
    text = f"{name} {color}{'█' * full}{DIM}{'░' * (BAR - full)}{END} {color}{used:.0f}%{END}"
    return f"{text} {DIM}· {when(reset, now)}{END}" if reset is not None else text


def line(limits, effort, now):
    parts = [window("5h", limits.get("five_hour"), now), window("Semana", limits.get("seven_day"), now)]
    parts.append(f"Effort {effort}" if effort else None)
    return f" {DIM}|{END} ".join(p for p in parts if p)


def saved_limits():
    try:
        return json.loads(USAGE.read_text(encoding="utf-8"))["rate_limits"]
    except (OSError, ValueError, KeyError, TypeError):
        return {}


def main():
    sys.stdout.reconfigure(encoding="utf-8")   # Windows would print the bars in its own code page
    try:
        data = json.load(sys.stdin)
    except ValueError:
        data = {}
    DIR.mkdir(exist_ok=True)
    sample = DIR / "claude_statusline_sample.json"
    if data and not sample.exists():
        sample.write_text(json.dumps(data, indent=2), encoding="utf-8")
    limits = data.get("rate_limits")
    if limits:
        USAGE.write_text(json.dumps({"saved_at": time.time(), "rate_limits": limits}), encoding="utf-8")
    print(line(limits or saved_limits(), (data.get("effort") or {}).get("level"), time.time()))


if __name__ == "__main__":
    main()
