"""Prepara o Hub na nuvem a partir do PC de quem o quer, David, Marco ou Kovel (docs/nuvem.md).

Lê o ~/.team-agent/widget.json deste PC (chave da equipa, telemóvel, Hubs com quem troca), pede a chave da Tailscale e escreve
~/.team-agent/nuvem/cloud-init.sh: o texto que se cola na Oracle ao criar o servidor, que instala tudo sozinho
(scripts/nuvem/instalar.sh). No Mac também o copia para a área de transferência. Junta ainda o «amg-nuvem:8000» aos
sync_peers deste PC, para ele trocar com a nuvem pela Tailscale.

    python3 scripts/nuvem/preparar.py

O ficheiro tem a chave da equipa e a da Tailscale: fica fora do git e só o dono o lê.
"""
import getpass
import json
import shlex
import subprocess
import sys
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


def phones() -> list[str]:
    """Os endereços na tailnet dos telemóveis (iOS e Android) que a Tailscale deste PC vê."""
    try:
        out = subprocess.run(["tailscale", "status", "--json"], capture_output=True, text=True, timeout=10).stdout
        peers = json.loads(out).get("Peer", {}).values()
    except (OSError, ValueError, subprocess.SubprocessError):
        return []
    return [ip for p in peers if p.get("OS", "").lower() in ("ios", "android") for ip in p.get("TailscaleIPs", [])]


def main():
    config = json.loads(CONFIG.read_text(encoding="utf-8"))
    if not config.get("key"):
        sys.exit(f"Falta a chave da equipa («key») em {CONFIG}: sem ela a nuvem não faz sync com os PCs.")
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
    phone_ips = config.get("phone_ips") or phones()
    if not phone_ips:
        print("Não vejo o telemóvel na Tailscale: instala lá a app Tailscale com a mesma conta e corre isto outra vez.\n"
              "Sem ele, o telemóvel abre o Hub mas pede a palavra-passe.")
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
    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    OUT.chmod(0o600)

    if CLOUD_PEER not in config.get("sync_peers", ""):
        config["sync_peers"] = ",".join(peers + [CLOUD_PEER])
        CONFIG.write_text(json.dumps(config, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"Este PC passa a trocar também com a nuvem ({CLOUD_PEER}); reinicia o widget para valer.")

    copy = {"darwin": ["pbcopy"], "win32": ["clip"]}.get(sys.platform)
    copied = bool(copy) and subprocess.run(copy, input=OUT.read_bytes(), shell=sys.platform == "win32").returncode == 0
    print(f"\nPronto: {OUT}" + ("\nJá está copiado: na Oracle, cola em «Cloud-init script» (docs/nuvem.md, passo 3)." if copied else ""))


if __name__ == "__main__":
    main()
