"""Liga o telemóvel e o computador, de uma vez (5 nov, David: «eles só precisarem de escrever tipo uma palavra»).

É o que corre a skill telemovel, em qualquer PC da equipa. Pode correr-se as vezes que for preciso: o que já está feito fica
como está. Acaba com uma linha por coisa, FEITO ou FALTA, e na FALTA diz o que fazer. Sai com 2 se a pessoa ainda não tem nuvem.

    python3 scripts/nuvem/tudo.py
"""
import json
import shlex
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ligar_pc  # noqa: E402
from preparar import status, tailscale  # noqa: E402

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
# Só onde o agente é mais antigo que o código dele: os agentes anteriores a 4 nov não se atualizam sozinhos (_leave_if_updated)
RESTART = ("c=$(git -C /opt/amg/team-agent log -1 --format=%ct -- agent); for u in $(systemctl list-units --plain --no-legend "
           "'amg-agent@*' | awk '{print $1}'); do s=$(date -d \"$(systemctl show $u -p ActiveEnterTimestamp --value)\" +%s); "
           "[ \"$s\" -lt \"$c\" ] && sudo systemctl restart $u && echo $u; done; true")

# O que o trabalho do telemóvel precisa na nuvem: vídeo, PDF, imagens, sites. Só instala se faltar alguma coisa.
TOOLS = ("for c in ffmpeg node npm chromium yt-dlp convert pdftoppm; do command -v $c >/dev/null || m=1; done; [ -z \"$m\" ] || "
         "sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y -q ffmpeg nodejs npm yt-dlp imagemagick poppler-utils chromium-browser")


def cloud(command: str, seconds: int = 90) -> tuple[int, str]:
    run = subprocess.run([tailscale(), "ssh", "ubuntu@amg-nuvem", command], capture_output=True, text=True, encoding="utf-8",
                         errors="replace", timeout=seconds)
    return run.returncode, run.stdout.strip()


def mirror_state() -> str:
    """O que o espelho deste computador (backend/app/espelho.py) já acabou de copiar. Vazio se ainda não acabou nenhuma ronda."""
    try:
        state = json.loads((Path.home() / ".team-agent" / "espelho.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return ""
    if not state.get("ultima"):
        return ""
    return ", ".join(f"{name} ({row['ficheiros']} ficheiros)" if "ficheiros" in row else f"{name} (ERRO: {row.get('erro')})"
                     for name, row in (state.get("pastas") or {}).items())


def script(*args: str) -> bool:
    return subprocess.run([sys.executable, str(HERE / args[0]), *args[1:]]).returncode == 0


def main():
    state = status()   # sem Tailscale ligada sai a dizer o que fazer
    peers = [p for p in (state.get("Peer") or {}).values() if p.get("HostName", "").startswith("amg-nuvem")]
    if not any(p.get("Online") for p in peers):
        print("FALTA  a tua nuvem: ainda não aparece na Tailscale. Segue docs/nuvem.md, secção «Marco e Kovel», e corre isto de novo.")
        sys.exit(2)

    done, missing = [], []
    done.append("a nuvem está ligada")
    code, here = 0, subprocess.run(["git", "-C", str(REPO), "rev-parse", "--short", "HEAD"], capture_output=True, text=True).stdout.strip()
    code, there = cloud("git -C /opt/amg/team-agent rev-parse --short HEAD")
    if code or not there:
        missing.append("não consegui entrar na nuvem pela Tailscale SSH: confirma que estás na mesma conta da Tailscale")
    elif here != there:
        missing.append(f"a nuvem está na versão {there} e este PC na {here}: a nuvem atualiza-se sozinha, corre isto daqui a 10 min")
    else:
        done.append(f"a nuvem tem o código novo ({there})")

    restarted = cloud(RESTART)[1]
    if restarted:
        done.append("os agentes da nuvem passaram para o código novo")
    if cloud("sudo -u amg -H /opt/amg/.local/bin/claude auth status")[0]:
        missing.append("login do Claude na nuvem: python3 scripts/nuvem/preparar.py claude (abre uma página para autorizares)")
    else:
        done.append("o Claude tem login na nuvem")

    if script("preparar.py", "memoria"):
        done.append("a memória anda nos dois sentidos entre este computador e a nuvem")
    else:
        missing.append("a nuvem não aceitou este computador na memória: python3 scripts/nuvem/preparar.py memoria")

    if script("ligar_pc.py"):
        time.sleep(12)
        log = ligar_pc.LOG.read_text(encoding="utf-8", errors="replace") if ligar_pc.LOG.exists() else ""
        if "Connected to server" in log[-3000:]:
            done.append("o telemóvel pode mandar trabalho para este computador («No computador»)")
        else:
            missing.append(f"o agente deste computador não ligou à nuvem: vê {ligar_pc.LOG}")
    else:
        missing.append("o agente deste computador não arrancou: python3 scripts/nuvem/ligar_pc.py")

    if cloud("sudo -u amg -H gh auth status")[0]:
        missing.append("projetos privados na nuvem: python3 scripts/nuvem/preparar.py github, na janela do terminal (só a pessoa pode autorizar)")
    else:
        done.append("a nuvem chega aos projetos privados do GitHub")

    if cloud(TOOLS, 600)[0]:
        missing.append("as ferramentas de trabalho na nuvem (vídeo, PDF, imagens) não instalaram: corre isto de novo")
    else:
        done.append("a nuvem tem as ferramentas de trabalho (ffmpeg, node, chromium, yt-dlp, imagemagick, poppler)")
    who = [subprocess.run(["git", "-C", str(REPO), "config", key], capture_output=True, text=True).stdout.strip()
           for key in ("user.name", "user.email")]
    if all(who):  # sem isto, um commit feito pelo telemóvel na nuvem falha
        cloud(f"sudo -u amg -H git config --global user.name {shlex.quote(who[0] + ' (nuvem)')}; "
              f"sudo -u amg -H git config --global user.email {shlex.quote(who[1])}")

    mirror = mirror_state()
    if mirror:
        done.append(f"a Secretária, os Documentos e os projetos estão copiados na nuvem: {mirror}")
    else:
        missing.append("a primeira cópia para a nuvem ainda não acabou: com o Hub deste computador ligado, corre isto daqui a 30 min")

    print()
    for line in done:
        print("FEITO ", line)
    for line in missing:
        print("FALTA ", line)


if __name__ == "__main__":
    main()
