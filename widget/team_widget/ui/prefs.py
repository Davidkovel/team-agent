"""What this person chose for the widget on this computer (kept in ~/.team-agent/widget-prefs.json)."""
import json
from pathlib import Path

PATH = Path.home() / ".team-agent" / "widget-prefs.json"


def load() -> dict:
    try:
        return json.loads(PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def save(**changes):
    try:
        PATH.parent.mkdir(parents=True, exist_ok=True)
        PATH.write_text(json.dumps({**load(), **changes}), encoding="utf-8")
    except OSError:
        pass  # a preference that cannot be saved is not worth stopping the widget for
