# O Hub na nuvem (ligado 24 h)

Pedido do David a 3 nov: «quero mexer no meu widget mesmo com o PC desligado». Um servidor grátis da Oracle corre mais um Hub,
ligado sempre. Faz sync com os PCs como os outros Hubs, e o telemóvel passa a abri-lo a ele.

## O que a pessoa faz (uma vez, ~15 min)

1. **Conta Oracle**: [oracle.com/cloud/free](https://www.oracle.com/cloud/free/) → Start for free. Pede um cartão só para
   confirmar quem és; o «Always Free» não cobra nada. Região: a mais perto (ex. Madrid ou Frankfurt), e não dá para mudar depois.
2. **Chave da Tailscale e o texto para colar**: no Mac, no terminal:
   ```
   cd ~/.team-agent/mac/team-agent && python3 scripts/nuvem/preparar.py
   ```
   Ele diz onde fazer a chave (login.tailscale.com/admin/settings/keys → Generate auth key), pede para a colar e deixa o texto
   da instalação copiado.
3. **Criar o servidor** na Oracle: menu → Compute → Instances → **Create instance**.
   - Image: **Ubuntu 24.04** (Change image).
   - Shape: **Ampere A1** (VM.Standard.A1.Flex, 4 OCPU e 24 GB, grátis): chega para o Claude trabalhar lá. Se disser que não
     há capacidade, tentar outra vez mais tarde ou ficar com o VM.Standard.E2.1.Micro (só o Hub, 1 GB).
   - Em baixo, **Show advanced options → Management → Paste cloud-init script**: colar (Cmd+V).
   - **Create**. Não é preciso guardar a chave SSH nem abrir portas.
4. Esperar ~10 min. O servidor aparece na Tailscale como **amg-nuvem**.
5. **Telemóvel**: abrir no Safari `https://amg-nuvem.tailcdbdef.ts.net`, Partilhar → Adicionar ao ecrã principal, e usar
   esta app em vez da antiga. Em Mais → Notificações no telemóvel, ligar outra vez as notificações da app.

## O que fica a correr (scripts/nuvem/instalar.sh)

- Ubuntu + Tailscale (`--hostname=amg-nuvem --ssh`), o repositório em `/opt/amg/team-agent`, o venv e o serviço `amg-hub`
  (systemd, volta sozinho). Dados em `/opt/amg/dados` (`hub.db`, `hub.env` com a chave, fora do git).
- Sync: `SYNC_NODE=3` (como o Mac; os ids levam a hora em décimas de segundo, por isso só colidiam com duas linhas novas no
  mesmo décimo nos dois), troca com o Windows do David e o Mac pela Tailscale, e os PCs do Marco e do Kovel chegam-lhe pelo
  Funnel (`https://amg-nuvem.tailcdbdef.ts.net:8443`, só `/api/sync` e sempre com a chave; está em `sync_relays` no `config.py`).
- Atualiza-se sozinho (o `selfupdate.py` faz git pull e sai quando o backend muda; o systemd arranca-o outra vez).
- Sem Claude: os agentes, o Radar com IA, a Sala de Trading e a Fábrica Etsy continuam nos PCs. O Hub da nuvem guarda e mostra
  tudo e recebe o que se mexe; o trabalho de IA arranca quando um PC com o agente ligar.

## Manter

Do Mac, pela Tailscale: `tailscale ssh ubuntu@amg-nuvem`, depois `sudo journalctl -u amg-hub -f` (log do Hub),
`sudo systemctl restart amg-hub`, ou correr de novo `sudo bash /opt/amg/team-agent/scripts/nuvem/instalar.sh` (sem variáveis
mantém as definições). Log da instalação: `/var/log/amg-nuvem.log`.
