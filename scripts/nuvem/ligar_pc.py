"""O computador como agente da pessoa (4 nov, David: «pelo telemóvel consigo controlar o computador»). Só no Mac, uma vez.

Liga aqui um agente que fala com o Hub da nuvem pela Tailscale e só faz as conversas pedidas no telemóvel como «No computador».
Trabalha na pasta real do projeto e pede aprovação no telemóvel para o que mexe fora dela, como os agentes da nuvem. Com o
Mac a dormir, a conversa fica à espera. O token é o do agente da nuvem, lido por SSH da Tailscale, e fica só neste Mac.

    python3 scripts/nuvem/ligar_pc.py           # liga, e volta a ligar sozinho quando o Mac arranca
    python3 scripts/nuvem/ligar_pc.py desligar
"""
import plistlib
import shutil
import subprocess
import sys
from pathlib import Path

HOME = Path.home() / ".team-agent"
ENV = HOME / "agente-pc.env"
PLIST = Path.home() / "Library/LaunchAgents/com.amg.agente-pc.plist"
REPO = Path(__file__).resolve().parents[2]
PYTHON = HOME / "mac/venv/bin/python"
TAILSCALE = shutil.which("tailscale") or "/Applications/Tailscale.app/Contents/MacOS/Tailscale"
HUB = "http://amg-nuvem:8000"


def desligar():
    subprocess.run(["launchctl", "unload", str(PLIST)], capture_output=True)
    PLIST.unlink(missing_ok=True)
    print("O agente deste computador está desligado.")


def ligar():
    if sys.platform != "darwin":
        sys.exit("Para já isto é só para o Mac.")
    remote = subprocess.run([TAILSCALE, "ssh", "ubuntu@amg-nuvem", "sudo grep ^TEAM_AGENT_TOKEN= /opt/amg/dados/agent.env"],
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
    PLIST.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["launchctl", "unload", str(PLIST)], capture_output=True)
    with PLIST.open("wb") as f:
        plistlib.dump({"Label": "com.amg.agente-pc", "RunAtLoad": True, "KeepAlive": True, "ThrottleInterval": 30,
                       "WorkingDirectory": str(REPO / "agent"),
                       "ProgramArguments": [str(PYTHON), "-m", "team_agent", "--env", str(ENV)],
                       "EnvironmentVariables": {"PATH": f"{Path.home()}/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
                                                "TEAM_AGENT_WORKER": "pc", "TEAM_AGENT_LOCAL_PORT": "8779",
                                                "TEAM_AGENT_DATA_DIR": str(HOME / "agente-pc")},
                       "StandardOutPath": str(HOME / "agente-pc.log"), "StandardErrorPath": str(HOME / "agente-pc.log")}, f)
    subprocess.run(["launchctl", "load", str(PLIST)], check=True)
    print("Ligado. No telemóvel, ao começar uma conversa, escolhe «No computador».")


if __name__ == "__main__":
    desligar() if sys.argv[1:] == ["desligar"] else ligar()
