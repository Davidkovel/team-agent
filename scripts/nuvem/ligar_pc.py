"""O computador como agente da pessoa (4 nov, David: «pelo telemóvel consigo controlar o computador»). Mac e Windows, uma vez.

Liga aqui um agente que fala com o Hub da nuvem pela Tailscale e só faz as conversas pedidas no telemóvel como «No computador».
Trabalha na pasta real do projeto e pede aprovação no telemóvel para o que mexe fora dela, como os agentes da nuvem. Com o
Mac a dormir, a conversa fica à espera. O token é o do agente da nuvem, lido por SSH da Tailscale, e fica só neste Mac.

    python3 scripts/nuvem/ligar_pc.py           # liga, e volta a ligar sozinho quando o Mac arranca
    python3 scripts/nuvem/ligar_pc.py desligar
"""
import os
import plistlib
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from preparar import tailscale  # noqa: E402

HOME = Path.home() / ".team-agent"
ENV = HOME / "agente-pc.env"
PLIST = Path.home() / "Library/LaunchAgents/com.amg.agente-pc.plist"
REPO = Path(__file__).resolve().parents[2]
HUB = "http://amg-nuvem:8000"
LOG = HOME / "agente-pc.log"
# Windows: um .cmd que volta a arrancar o agente se ele sair, lançado sem janela por um .vbs na pasta Arranque
LOOP = HOME / "agente-pc.cmd"


def python() -> Path:
    """O Python com as dependências do agente: o do Mac, o .venv do repositório no Windows, ou o que está a correr isto."""
    for path in (HOME / "mac/venv/bin/python", REPO / ".venv/Scripts/python.exe", REPO / ".venv/bin/python"):
        if path.exists():
            return path
    return Path(sys.executable)


def startup() -> Path:
    return Path(os.environ["APPDATA"]) / "Microsoft/Windows/Start Menu/Programs/Startup/agente-pc.vbs"


def loop_text(py: Path) -> str:
    return (f'@echo off\r\ncd /d "{REPO / "agent"}"\r\nset TEAM_AGENT_WORKER=pc\r\nset TEAM_AGENT_LOCAL_PORT=8779\r\nset TEAM_AGENT_RESTART_ON_UPDATE=1\r\n'
            f'set "TEAM_AGENT_DATA_DIR={HOME / "agente-pc"}"\r\n:volta\r\n'
            f'"{py}" -m team_agent --env "{ENV}" >> "{LOG}" 2>&1\r\ntimeout /t 30 /nobreak >nul\r\ngoto volta\r\n')


def vbs_text() -> str:
    return f'CreateObject("WScript.Shell").Run "cmd /c ""{LOOP}""", 0, False\r\n'


def _stop_windows():
    code = ("Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*agente-pc*' -and $_.ProcessId -ne $PID } "
            "| ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }")
    subprocess.run(["powershell", "-NoProfile", "-Command", code], capture_output=True)


def desligar():
    if sys.platform == "win32":
        _stop_windows()
        startup().unlink(missing_ok=True)
        LOOP.unlink(missing_ok=True)
    else:
        subprocess.run(["launchctl", "unload", str(PLIST)], capture_output=True)
        PLIST.unlink(missing_ok=True)
    print("O agente deste computador está desligado.")


def ligar():
    if sys.platform not in ("darwin", "win32"):
        sys.exit("Isto é para o Mac e o Windows.")
    exe = tailscale()
    if not exe:
        sys.exit("Falta a Tailscale neste computador.")
    remote = subprocess.run([exe, "ssh", "ubuntu@amg-nuvem", "sudo grep ^TEAM_AGENT_TOKEN= /opt/amg/dados/agent.env"],
                            capture_output=True, text=True, timeout=40)
    line = remote.stdout.strip()
    if not line.startswith("TEAM_AGENT_TOKEN=") or len(line) < 30:
        sys.exit("Não consegui ler o token do agente da nuvem. A nuvem está ligada?")
    work = HOME / "trabalho"
    work.mkdir(parents=True, exist_ok=True)
    ENV.touch(mode=0o600)
    ENV.chmod(0o600)
    ENV.write_text("\n".join([f"TEAM_SERVER_URL={HUB}", line, f"TEAM_AGENT_WORKSPACE={work}", f"TEAM_AGENT_DATA_DIR={HOME / 'agente-pc'}",
                              "TEAM_AGENT_WORKER=pc", "TEAM_AGENT_LOCAL_PORT=8779"]) + "\n", encoding="utf-8")
    py = python()
    if sys.platform == "win32":
        _stop_windows()
        # Em bytes: o write_text no Windows trocava \r\n por \r\r\n
        LOOP.write_bytes(loop_text(py).encode("mbcs"))
        startup().parent.mkdir(parents=True, exist_ok=True)
        startup().write_bytes(vbs_text().encode("mbcs"))
        subprocess.run(["wscript", str(startup())], check=True)
        print("Ligado. No telemóvel, ao começar uma conversa, escolhe «No computador».")
        return
    PLIST.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["launchctl", "unload", str(PLIST)], capture_output=True)
    with PLIST.open("wb") as f:
        plistlib.dump({"Label": "com.amg.agente-pc", "RunAtLoad": True, "KeepAlive": True, "ThrottleInterval": 30,
                       "WorkingDirectory": str(REPO / "agent"),
                       "ProgramArguments": [str(py), "-m", "team_agent", "--env", str(ENV)],
                       "EnvironmentVariables": {"PATH": f"{Path.home()}/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
                                                "TEAM_AGENT_WORKER": "pc", "TEAM_AGENT_LOCAL_PORT": "8779", "TEAM_AGENT_RESTART_ON_UPDATE": "1",
                                                "TEAM_AGENT_DATA_DIR": str(HOME / "agente-pc")},
                       "StandardOutPath": str(LOG), "StandardErrorPath": str(LOG)}, f)
    subprocess.run(["launchctl", "load", str(PLIST)], check=True)
    print("Ligado. No telemóvel, ao começar uma conversa, escolhe «No computador».")


if __name__ == "__main__":
    desligar() if sys.argv[1:] == ["desligar"] else ligar()
