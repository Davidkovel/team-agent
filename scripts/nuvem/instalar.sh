#!/bin/bash
# O Hub na nuvem (3 nov, David: «quero mexer no meu widget mesmo com o PC desligado»). Corre como root num servidor Ubuntu
# (Oracle Cloud Always Free) e deixa lá um Hub ligado 24 h: entra na Tailscale como «amg-nuvem», faz sync com os PCs como
# qualquer outro Hub, e o telemóvel abre-o em https://amg-nuvem.<tailnet>.ts.net. Pode correr outra vez sem estragar nada.
# Normalmente não se corre à mão: scripts/nuvem/preparar.py faz o texto que se cola na Oracle ao criar o servidor, e esse
# texto corre isto com as variáveis abaixo. Guia: docs/nuvem.md.
#
#   TS_AUTHKEY   chave de autenticação da Tailscale (tskey-auth-…), só da 1.ª vez
#   TEAM_KEY     a chave da equipa (a do widget.json), para o sync com os PCs
#   HUB_USER     quem é este Hub (david, mark, owner)
#   SYNC_NODE    o número desta nuvem no sync (3 a do David; o preparar.py dá um a cada pessoa)
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
# O que o trabalho pelo telemóvel precisa (vídeo, PDF, imagens, sites). Se falhar, o Hub arranca na mesma e o tudo.py tenta de novo
apt-get install -y -q ffmpeg nodejs npm yt-dlp imagemagick poppler-utils chromium-browser || echo "== faltam ferramentas de trabalho (scripts/nuvem/tudo.py instala-as)"
# gh: os projetos privados da pessoa, depois de ela entrar uma vez (preparar.py github)
command -v gh >/dev/null || apt-get install -y -q gh || echo "== gh não instalou (só faz falta para repositórios privados)"

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
SYNC_NODE=${SYNC_NODE:-3}
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
  # Com o HTTPS ou o Funnel por ligar na tailnet, estes comandos podem ficar à espera de um clique: sem o timeout a instalação
  # parava aqui e os agentes nunca chegavam a ser instalados
  timeout 60 tailscale serve --bg 8000 || echo "== tailscale serve falhou: ligar o HTTPS em login.tailscale.com/admin/dns"
  timeout 60 tailscale funnel --bg --https=8443 --set-path=/api/sync http://127.0.0.1:8000/api/sync || echo "== tailscale funnel falhou (só serve para os outros PCs chegarem a esta nuvem)"
fi

for _ in $(seq 30); do curl -fs http://127.0.0.1:8000/api/version >/dev/null && break; sleep 2; done
curl -fs http://127.0.0.1:8000/api/version && echo && echo "== Hub da nuvem a correr" || echo "== O Hub não respondeu: journalctl -u amg-hub"

# O agente (agent/, team_agent) do HUB_USER, 3 nov (David: «falo com um agente pelo telemóvel com o PC desligado e o Claude faz
# o site»): faz as tarefas e responde às perguntas do Hub com o Claude deste servidor. Precisa do login do Claude uma vez
# (docs/nuvem.md); até lá avisa e as tarefas falham. O token emite-o este Hub (127.0.0.1 é o HUB_USER) e substitui o anterior
# dessa pessoa, que vai por sync aos PCs: o agente de um PC dela deixa de entrar, e é este que passa a ser o seu.
"$APP/venv/bin/pip" install -q -r "$REPO/agent/requirements.txt"
AENV="$DATA/agent.env"
if ! grep -q '^TEAM_AGENT_TOKEN=.' "$AENV" 2>/dev/null; then
  jwt=$(curl -fs -X POST http://127.0.0.1:8000/api/auth/auto | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])' || true)
  token=$(curl -fs -X POST -H "Authorization: Bearer $jwt" "http://127.0.0.1:8000/api/users/$HUB_USER/agent-token" \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["agent_token"])' || true)
  cat > "$AENV" <<EOF
TEAM_SERVER_URL=http://127.0.0.1:8000
TEAM_AGENT_TOKEN=$token
TEAM_AGENT_WORKSPACE=$APP/trabalho
TEAM_AGENT_DATA_DIR=$DATA/agente
HOME=$APP
PATH=$APP/.local/bin:/usr/local/bin:/usr/bin:/bin
EOF
fi
# Vários agentes em paralelo (3 nov, David: «distribuir as atividades pelos agentes»): cada um é o serviço amg-agent@N e
# pede ao Hub a próxima tarefa livre (POST /api/agent/tasks/claim), que fica escrita como sua; nunca dois na mesma.
# AGENTS=N escolhe quantos (fica guardado em $DATA/agentes); sem ele, pela RAM: 1 até 4 GB, 2 até 16 GB, 3 acima.
if [ -n "${AGENTS:-}" ]; then echo "$AGENTS" > "$DATA/agentes"; fi
if [ -s "$DATA/agentes" ]; then
  AGENTS=$(cat "$DATA/agentes")
else
  mem=$(awk '/MemTotal/ {print int($2 / 1048576)}' /proc/meminfo)
  AGENTS=$(( mem >= 16 ? 3 : mem >= 4 ? 2 : 1 ))
fi
mkdir -p "$APP/trabalho"
for n in $(seq 1 "$AGENTS"); do mkdir -p "$DATA/agente-$n"; done
chmod 600 "$AENV"
chown -R amg:amg "$APP"
# o serviço de um agente só, de antes
if [ -f /etc/systemd/system/amg-agent.service ]; then
  systemctl disable --now amg-agent 2>/dev/null || true
  rm -f /etc/systemd/system/amg-agent.service
fi
cat > /etc/systemd/system/amg-agent@.service <<EOF
[Unit]
Description=Agente AMG %i - agente do Claude na nuvem
After=amg-hub.service
Wants=amg-hub.service

[Service]
User=amg
WorkingDirectory=$REPO/agent
EnvironmentFile=$AENV
ExecStart=/usr/bin/env TEAM_AGENT_WORKER=%i TEAM_AGENT_LOCAL_PORT=877%i TEAM_AGENT_DATA_DIR=$DATA/agente-%i $APP/venv/bin/python -m team_agent --env $AENV
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
for unit in $(systemctl list-units --all --plain --no-legend 'amg-agent@*' | awk '{print $1}'); do
  n=${unit#amg-agent@}; n=${n%.service}
  [ "$n" -le "$AGENTS" ] 2>/dev/null || systemctl disable --now "$unit"
done
for n in $(seq 1 "$AGENTS"); do
  systemctl enable "amg-agent@$n" >/dev/null 2>&1
  systemctl restart "amg-agent@$n"
done
grep -q '^TEAM_AGENT_TOKEN=.' "$AENV" && echo "== $AGENTS agente(s) a correr" || echo "== Os agentes ficaram sem token: o Hub não o deu"
