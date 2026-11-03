#!/bin/bash
# O Hub na nuvem (3 nov, David: «quero mexer no meu widget mesmo com o PC desligado»). Corre como root num servidor Ubuntu
# (Oracle Cloud Always Free) e deixa lá um Hub ligado 24 h: entra na Tailscale como «amg-nuvem», faz sync com os PCs como
# qualquer outro Hub, e o telemóvel abre-o em https://amg-nuvem.<tailnet>.ts.net. Pode correr outra vez sem estragar nada.
# Normalmente não se corre à mão: scripts/nuvem/preparar.py faz o texto que se cola na Oracle ao criar o servidor, e esse
# texto corre isto com as variáveis abaixo. Guia: docs/nuvem.md.
#
#   TS_AUTHKEY   chave de autenticação da Tailscale (tskey-auth-…), só da 1.ª vez
#   TEAM_KEY     a chave da equipa (a do widget.json), para o sync com os PCs
#   HUB_USER     quem é este Hub (david)
#   PHONE_IPS    os endereços Tailscale do telemóvel, separados por vírgulas (entram como HUB_USER sem palavra-passe)
#   SYNC_PEERS   os Hubs com quem troca pela Tailscale, "host:porta,…"
#   SYNC_RELAYS  os Hubs com quem troca pelo Funnel, "https://…,…"
set -euo pipefail
exec > >(tee -a /var/log/amg-nuvem.log) 2>&1
echo "== AMG nuvem: $(date -Is)"

HUB_USER="${HUB_USER:-david}"
APP=/opt/amg
REPO="$APP/team-agent"
DATA="$APP/dados"
id amg >/dev/null 2>&1 || useradd --system --home-dir "$APP" --shell /usr/sbin/nologin amg
mkdir -p "$APP" "$DATA"

# 1 GB de RAM no servidor grátis: o pip precisa de folga
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q /swapfile /etc/fstab || echo "/swapfile none swap sw 0 0" >> /etc/fstab
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q git python3 python3-venv python3-pip curl ca-certificates

# Tailscale: entra na rede do David, com SSH da Tailscale (o Claude do Mac mantém o servidor sem chaves nem portas abertas)
command -v tailscale >/dev/null || curl -fsSL https://tailscale.com/install.sh | sh
if [ -n "${TS_AUTHKEY:-}" ]; then
  tailscale up --authkey="$TS_AUTHKEY" --hostname=amg-nuvem --ssh --accept-dns=true
fi

# O código: o repositório é público, o Hub faz git pull sozinho (selfupdate.py) e sai quando o backend muda; o systemd volta a arrancá-lo
if [ ! -d "$REPO/.git" ]; then git clone -q https://github.com/Davidkovel/team-agent.git "$REPO"; else git -C "$REPO" pull -q --ff-only || true; fi
[ -x "$APP/venv/bin/python" ] || python3 -m venv "$APP/venv"
"$APP/venv/bin/pip" install -q --upgrade pip
"$APP/venv/bin/pip" install -q -r "$REPO/backend/requirements.txt"
git config --system --add safe.directory "$REPO"

# Definições deste Hub (fora do git): o que o widget põe no ambiente num PC
[ -s "$DATA/jwt-secret" ] || head -c 32 /dev/urandom | base64 > "$DATA/jwt-secret"
ENVF="$DATA/hub.env"
if [ ! -s "$ENVF" ] || [ -n "${TEAM_KEY:-}" ]; then
  users="127.0.0.1=$HUB_USER,::1=$HUB_USER"
  for ip in ${PHONE_IPS//,/ }; do users="$users,$ip=$HUB_USER"; done
  cat > "$ENVF" <<EOF
DATABASE_URL=sqlite+aiosqlite:///$DATA/hub.db
REDIS_URL=
JWT_SECRET=$(cat "$DATA/jwt-secret")
TEAM_KEY=${TEAM_KEY:-}
SYNC=1
SYNC_NODE=3
SYNC_PEERS=${SYNC_PEERS:-}
SYNC_RELAYS=${SYNC_RELAYS:-}
IP_USERS=$users
CLAUDE_OFFICE=0
CLAUDE_SKILLS=0
HOME=$APP
EOF
fi
chmod 600 "$ENVF" "$DATA/jwt-secret"
chown -R amg:amg "$APP"

# Claude Code para o utilizador do Hub (~/.local/bin, onde o council.claude_exe procura): fica por entrar na conta, uma vez,
# com `tailscale ssh ubuntu@amg-nuvem` e `sudo -u amg -H /opt/amg/.local/bin/claude` (docs/nuvem.md)
[ -x "$APP/.local/bin/claude" ] || sudo -u amg -H bash -c 'curl -fsSL https://claude.ai/install.sh | bash' || echo "== Claude Code não instalou (fica para depois)"

cat > /etc/systemd/system/amg-hub.service <<EOF
[Unit]
Description=Agente AMG - Hub na nuvem
After=network-online.target tailscaled.service
Wants=network-online.target

[Service]
User=amg
WorkingDirectory=$REPO/backend
EnvironmentFile=$ENVF
ExecStart=$APP/venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now amg-hub
systemctl restart amg-hub

# https para o telemóvel (só dentro da Tailscale) e o /api/sync aberto pelo Funnel para os PCs do Marco e do Kovel (sempre com a chave)
if tailscale status >/dev/null 2>&1; then
  tailscale serve --bg 8000 || true
  tailscale funnel --bg --https=8443 --set-path=/api/sync http://127.0.0.1:8000/api/sync || true
fi

for _ in $(seq 30); do curl -fs http://127.0.0.1:8000/api/version >/dev/null && break; sleep 2; done
curl -fs http://127.0.0.1:8000/api/version && echo && echo "== Hub da nuvem a correr" || echo "== O Hub não respondeu: journalctl -u amg-hub"
