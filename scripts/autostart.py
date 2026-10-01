"""Optional autostart for the Local Agent and Widget at user login.

Nothing is installed unless you run this yourself:

    python scripts/autostart.py install            # agent and widget
    python scripts/autostart.py install widget     # only the widget (or: agent)
    python scripts/autostart.py remove

Run it with the Python (venv) that has the agent and widget dependencies.
It only creates per-user files; no admin rights, no system services.
"""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APPS = {"agent": ("team_agent", ROOT / "agent"), "widget": ("team_widget", ROOT / "widget")}


def targets() -> dict[str, Path]:
    home = Path.home()
    if sys.platform == "win32":
        folder = Path(os.environ["APPDATA"]) / "Microsoft/Windows/Start Menu/Programs/Startup"
        return {name: folder / f"team-{name}.cmd" for name in APPS}
    if sys.platform == "darwin":
        return {name: home / f"Library/LaunchAgents/com.team.{name}.plist" for name in APPS}
    return {name: home / f".config/autostart/team-{name}.desktop" for name in APPS}


def content(name: str) -> str:
    module, cwd = APPS[name]
    python = Path(sys.executable)
    if sys.platform == "win32":
        pythonw = python.with_name("pythonw.exe")  # no console window
        return f'@echo off\r\ncd /d "{cwd}"\r\nstart "" "{pythonw}" -m {module}\r\n'
    if sys.platform == "darwin":
        return f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.team.{name}</string>
  <key>ProgramArguments</key><array><string>{python}</string><string>-m</string><string>{module}</string></array>
  <key>WorkingDirectory</key><string>{cwd}</string>
  <key>RunAtLoad</key><true/>
</dict></plist>
"""
    return f"[Desktop Entry]\nType=Application\nName=Team {name}\nPath={cwd}\nExec={python} -m {module}\n"


def main():
    action = sys.argv[1] if len(sys.argv) > 1 else ""
    chosen = sys.argv[2:] or list(APPS)  # e.g. `install widget` to leave the agent out
    if action not in ("install", "remove") or not set(chosen) <= set(APPS):
        sys.exit(__doc__)
    for name, path in targets().items():
        if name not in chosen:
            continue
        if action == "install":
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content(name), encoding="utf-8")
            print(f"created {path}")
        elif path.exists():
            path.unlink()
            print(f"removed {path}")


if __name__ == "__main__":
    main()
