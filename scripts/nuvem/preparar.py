"""Prepara o Hub na nuvem a partir do PC do David (docs/nuvem.md).

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
CLOUD_PEER = "amg-nuvem:8000"


def main():
    config = json.loads(CONFIG.read_text(encoding="utf-8"))
    if not config.get("key"):
        sys.exit(f"Falta a chave da equipa («key») em {CONFIG}: sem ela a nuvem não faz sync com os PCs.")
    # A chave copiada na Tailscale (botão de copiar) serve sem a colar outra vez
    clip = subprocess.run(["pbpaste"], capture_output=True, text=True).stdout.strip() if sys.platform == "darwin" else ""
    if clip.startswith("tskey-"):
        authkey = clip
    else:
        print("Chave da Tailscale: login.tailscale.com/admin/settings/keys → Generate auth key (não reutilizável chega).")
        authkey = getpass.getpass("Cola aqui a chave (tskey-auth-…, não aparece no ecrã): ").strip()
    if not authkey.startswith("tskey-"):
        sys.exit("Isso não parece uma chave da Tailscale (começa por tskey-).")

    peers = [p.strip() for p in config.get("sync_peers", "").split(",") if p.strip() and p.strip() != CLOUD_PEER]
    env = {
        "TS_AUTHKEY": authkey,
        "TEAM_KEY": config["key"],
        "HUB_USER": (config.get("user") or "david").lower(),
        "PHONE_IPS": ",".join(config.get("phone_ips", [])),
        "SYNC_PEERS": ",".join(peers),
        "SYNC_RELAYS": MAC_FUNNEL,
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

    copied = sys.platform == "darwin" and subprocess.run(["pbcopy"], input=OUT.read_bytes()).returncode == 0
    print(f"\nPronto: {OUT}" + ("\nJá está copiado: na Oracle, cola em «Cloud-init script» (docs/nuvem.md, passo 3)." if copied else ""))


if __name__ == "__main__":
    main()
