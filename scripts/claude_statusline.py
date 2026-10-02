"""Claude Code status line that shows nothing but saves what Claude Code knows about the plan limits.

Claude Code runs this after every reply and pipes a JSON of the session to stdin. If it carries `rate_limits`
(five_hour / seven_day, with used_percentage), they go to ~/.team-agent/claude_usage.json, which the widget reads.
The first payload is also kept whole in claude_statusline_sample.json so the fields can be checked.
"""
import json
import sys
import time
from pathlib import Path

DIR = Path.home() / ".team-agent"


def main():
    try:
        data = json.load(sys.stdin)
    except ValueError:
        return
    DIR.mkdir(exist_ok=True)
    sample = DIR / "claude_statusline_sample.json"
    if not sample.exists():
        sample.write_text(json.dumps(data, indent=2), encoding="utf-8")
    limits = data.get("rate_limits")
    if limits:
        (DIR / "claude_usage.json").write_text(json.dumps({"saved_at": time.time(), "rate_limits": limits}), encoding="utf-8")


if __name__ == "__main__":
    main()
