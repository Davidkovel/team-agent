"""Prepara o Hub na nuvem a partir do PC de quem o quer, David, Marco ou Kovel (docs/nuvem.md).

Lê o ~/.team-agent/widget.json deste PC (chave da equipa, telemóvel, Hubs com quem troca), pede a chave da Tailscale e escreve
~/.team-agent/nuvem/cloud-init.sh: o texto que se cola na Oracle ao criar o servidor, que instala tudo sozinho
(scripts/nuvem/instalar.sh). No Mac também o copia para a área de transferência. Junta ainda o «amg-nuvem:8000» aos
sync_peers deste PC, para ele trocar com a nuvem pela Tailscale.

    python3 scripts/nuvem/preparar.py            # confere o que falta e faz o texto para colar na Oracle
    python3 scripts/nuvem/preparar.py verificar  # depois de criar o servidor: está a responder? dá o endereço do telemóvel
    python3 scripts/nuvem/preparar.py claude     # login do Claude na nuvem, para os agentes trabalharem lá
    python3 scripts/nuvem/preparar.py github     # login do GitHub na nuvem, para ela chegar aos projetos privados
    python3 scripts/nuvem/preparar.py memoria    # a nuvem passa a mandar as conversas dela a este computador

O ficheiro tem a chave da equipa e a da Tailscale: fica fora do git e só o dono o lê.
"""
import getpass
import json
import shlex
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

HOME = Path.home() / ".team-agent"
CONFIG = HOME / "widget.json"
OUT = HOME / "nuvem" / "cloud-init.sh"
RAW = "https://raw.githubusercontent.com/Davidkovel/team-agent/main/scripts/nuvem/instalar.sh"
MAC_FUNNEL = "https://macbook-air-de-david.tailcdbdef.ts.net:8443"
DAVID_CLOUD = "https://amg-nuvem.tailcdbdef.ts.net:8443"
CLOUD_PEER = "amg-nuvem:8000"
# O número da nuvem no sync: 0 a 2 são os PCs no Radmin, 3 o Mac e a nuvem do David; cada nuvem nova tem o seu
NODES = {"david": 3, "mark": 4, "owner": 5}
LOGINS = {"marco": "mark", "kovel": "owner"}  # o nome no widget.json e o login no Hub (backend/app/main.py)
# Os PCs no Radmin (o team_ip_users do backend/app/config.py): sem sync_peers no widget.json, o PC trocava com eles
TEAM_PCS = ["26.68.80.191:8000", "26.244.76.112:8000", "26.245.177.206:8000"]


def tailscale() -> str | None:
    """O comando da Tailscale: nem sempre está no PATH (no Mac vem dentro da app, no Windows em Program Files)."""
    for path in (shutil.which("tailscale"), "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
                 r"C:\Program Files\Tailscale\tailscale.exe"):
        if path and Path(path).exists():
            return path
    return None


def status() -> dict:
    """A Tailscale deste PC, ou sai a dizer o que a pessoa tem de fazer."""
    exe = tailscale()
    if not exe:
        sys.exit("Falta a Tailscale neste PC. Instala-a (Windows: winget install Tailscale.Tailscale; "
                 "ou tailscale.com/download), entra com a tua conta e corre isto outra vez.")
    try:
        out = subprocess.run([exe, "status", "--json"], capture_output=True, text=True, encoding="utf-8", timeout=15).stdout
        state = json.loads(out)
    except (OSError, ValueError, subprocess.SubprocessError):
        state = {}
    if state.get("BackendState") != "Running":
        sys.exit("A Tailscale deste PC não está ligada: abre-a, entra com a tua conta e corre isto outra vez.")
    return state


def phones(state: dict) -> list[str]:
    """Os endereços na tailnet dos telemóveis (iOS e Android) que a Tailscale deste PC vê."""
    peers = (state.get("Peer") or {}).values()
    return [ip for p in peers if p.get("OS", "").lower() in ("ios", "android") for ip in p.get("TailscaleIPs", [])]


def address(state: dict) -> str:
    return f"https://amg-nuvem.{(state.get('MagicDNSSuffix') or '').rstrip('.')}"


def verificar():
    state = status()
    cloud = [p for p in (state.get("Peer") or {}).values() if p.get("HostName", "").startswith("amg-nuvem")]
    if not any(p.get("Online") for p in cloud):
        sys.exit("A amg-nuvem ainda não apareceu na Tailscale. Demora ~10 min depois de criar o servidor; "
                 "volta a correr isto daqui a pouco.")
    url = address(state)
    try:
        urllib.request.urlopen(f"{url}/api/version", timeout=20).read()
    except (OSError, urllib.error.URLError) as e:
        sys.exit(f"A amg-nuvem está ligada mas {url} ainda não responde ({e}). A instalação pode estar a acabar: "
                 "volta a correr isto daqui a uns minutos.")
    print(f"A nuvem responde: {url}\n\n"
          f"No telemóvel: abre esse endereço no Safari, Partilhar, Adicionar ao ecrã principal. Usa essa app.\n"
          f"Falta o login do Claude: python scripts/nuvem/preparar.py claude")


def claude():
    """O login do Claude na nuvem: abre um endereço para a pessoa autorizar, depois reinicia os agentes."""
    status()
    remote = "sudo -u amg -H /opt/amg/.local/bin/claude auth login && sudo systemctl restart 'amg-agent@*'"
    sys.exit(subprocess.run([tailscale(), "ssh", "ubuntu@amg-nuvem", "-t", remote]).returncode)


def github():
    """O login do GitHub na nuvem: é a própria pessoa que autoriza, e o token dela não passa por este computador."""
    status()
    remote = ("command -v gh >/dev/null || sudo apt-get install -y -q gh; "
              "sudo -u amg -H gh auth login --git-protocol https --web && sudo -u amg -H gh auth setup-git")
    sys.exit(subprocess.run([tailscale(), "ssh", "ubuntu@amg-nuvem", "-t", remote]).returncode)


def memoria():
    """Junta este computador aos SYNC_PEERS da nuvem: é por aí que ela lhe manda as conversas do Claude (recall_share.py)."""
    me = (status().get("Self") or {}).get("HostName", "").strip().lower().replace(" ", "-")
    if not me or not all(c.isalnum() or c == "-" for c in me):
        sys.exit("Não consegui ler o nome deste computador na Tailscale.")
    peer = f"{me}:8000"
    remote = (f"sudo grep -q '^SYNC_PEERS=.*{peer}' /opt/amg/dados/hub.env && echo 'Já estava.' || "
              f"(sudo sed -i -E 's/^SYNC_PEERS=(.+)$/SYNC_PEERS=\\1,{peer}/; s/^SYNC_PEERS=$/SYNC_PEERS={peer}/' /opt/amg/dados/hub.env "
              f"&& sudo systemctl restart amg-hub && echo 'Feito.')")
    sys.exit(subprocess.run([tailscale(), "ssh", "ubuntu@amg-nuvem", remote]).returncode)


def main():
    config = json.loads(CONFIG.read_text(encoding="utf-8-sig"))  # utf-8-sig: o PowerShell 5.1 escreve um BOM
    if not config.get("key"):
        sys.exit(f"Falta a chave da equipa («key») em {CONFIG}: sem ela a nuvem não faz sync com os PCs.")
    # Tudo o que falta confere-se antes de gastar a chave, para não criar um servidor que depois não abre no telemóvel
    state = status()
    if not state.get("CertDomains"):
        sys.exit("Falta ligar o HTTPS na Tailscale, sem ele a app do telemóvel não abre: login.tailscale.com/admin/dns → "
                 "HTTPS Certificates → Enable. Depois corre isto outra vez.")
    phone_ips = config.get("phone_ips") or phones(state)
    if not phone_ips:
        sys.exit("Não vejo o telemóvel na Tailscale. Instala lá a app Tailscale, entra com a mesma conta deste PC e "
                 "corre isto outra vez.")
    # A chave copiada na Tailscale (botão de copiar) serve sem a colar outra vez
    paste = {"darwin": ["pbpaste"], "win32": ["powershell", "-NoProfile", "-Command", "Get-Clipboard"]}.get(sys.platform)
    clip = subprocess.run(paste, capture_output=True, text=True).stdout.strip() if paste else ""
    if clip.startswith("tskey-"):
        authkey = clip
    else:
        print("Chave da Tailscale: login.tailscale.com/admin/settings/keys → Generate auth key (não reutilizável chega).")
        authkey = getpass.getpass("Cola aqui a chave (tskey-auth-…, não aparece no ecrã): ").strip()
    if not authkey.startswith("tskey-"):
        sys.exit("Isso não parece uma chave da Tailscale (começa por tskey-).")

    user = (config.get("user") or "david").lower()
    user = LOGINS.get(user, user)
    peers = [p.strip() for p in (config.get("sync_peers") or ",".join(TEAM_PCS)).split(",")
             if p.strip() and p.strip() != CLOUD_PEER]
    env = {
        "TS_AUTHKEY": authkey,
        "TEAM_KEY": config["key"],
        "HUB_USER": user,
        "PHONE_IPS": ",".join(phone_ips),
        "SYNC_NODE": str(NODES.get(user, 6)),
        "SYNC_PEERS": ",".join(peers),
        # A nuvem do David está sempre ligada: as dos outros trocam com ela pelo Funnel e assim chegam a toda a equipa
        "SYNC_RELAYS": MAC_FUNNEL if user == "david" else f"{MAC_FUNNEL},{DAVID_CLOUD}",
    }
    lines = ["#!/bin/bash", "# Agente AMG: o Hub na nuvem (gerado por scripts/nuvem/preparar.py)"]
    lines += [f"export {k}={shlex.quote(v)}" for k, v in env.items()]
    lines += [f"curl -fsSL {RAW} | bash"]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    # Em bytes: no Windows o write_text punha \r\n e o servidor (Linux) não conseguia correr o texto
    OUT.write_bytes(("\n".join(lines) + "\n").encode("utf-8"))
    OUT.chmod(0o600)

    if CLOUD_PEER not in config.get("sync_peers", ""):
        config["sync_peers"] = ",".join(peers + [CLOUD_PEER])
        CONFIG.write_text(json.dumps(config, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"Este PC passa a trocar também com a nuvem ({CLOUD_PEER}); reinicia o widget para valer.")

    copy = {"darwin": ["pbcopy"], "win32": ["clip"]}.get(sys.platform)
    copied = bool(copy) and subprocess.run(copy, input=OUT.read_bytes(), shell=sys.platform == "win32").returncode == 0
    print(f"\nPronto: {OUT}" + ("\nJá está copiado: na Oracle, cola em «Cloud-init script» (docs/nuvem.md, passo 3)." if copied else ""))
    print(f"\nA seguir:\n"
          f"1. Na Oracle: Compute → Instances → Create instance (Ubuntu 24.04, Ampere A1), «Paste cloud-init script», colar.\n"
          f"2. Esperar ~10 min e correr: python scripts/nuvem/preparar.py verificar\n"
          f"3. Login do Claude: python scripts/nuvem/preparar.py claude\n"
          f"O endereço do telemóvel vai ser {address(state)}")


if __name__ == "__main__":
    what = sys.argv[1] if len(sys.argv) > 1 else ""
    {"verificar": verificar, "claude": claude, "github": github, "memoria": memoria}.get(what, main)()
