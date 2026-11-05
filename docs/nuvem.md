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

## Marco e Kovel (cada um a sua nuvem)

O Hub da nuvem do David é só dele (`HUB_USER=david`, e o telemóvel dele entra sem palavra-passe). Cada um faz a sua, com os
mesmos passos, a partir do seu PC (Windows):

**O mais fácil: dizer ao Claude do PC «instala-me a nuvem do Agente AMG, segue o docs/nuvem.md».** Ele faz o resto e pede só o
que é da pessoa, um passo de cada vez:

1. **Tailscale** no PC e no telemóvel, na **mesma conta** (tailscale.com/download). A conta pode ser a deles; não precisa de
   ser a do David.
2. **Ligar o HTTPS** da Tailscale, uma vez: login.tailscale.com/admin/dns → HTTPS Certificates → Enable.
3. **Conta Oracle**, como no passo 1 acima.
4. No PowerShell, dentro da pasta do team-agent, depois de um `git pull`: `python scripts\nuvem\preparar.py`. Confere os passos
   1 e 2 e diz o que falta. Tira o login do `widget.json` (Marco → `mark`, Kovel → `owner`), dá à nuvem o seu número no sync
   (4 o Marco, 5 o Kovel), encontra o telemóvel e liga a nuvem à do David pelo Funnel, que está sempre ligada. Assim tudo chega
   à equipa mesmo com todos os PCs desligados. O texto fica copiado.
5. **Criar o servidor**, como no passo 3 acima.
6. Esperar ~10 min e correr `python scripts\nuvem\preparar.py verificar`, que dá o endereço do telemóvel.
7. **Telemóvel**: abrir esse endereço no Safari, Partilhar → Adicionar ao ecrã principal.
8. **Login do Claude, logo a seguir** (não é opcional): `python scripts\nuvem\preparar.py claude`. A instalação dá à nuvem o
   token de agente da pessoa, por isso **o agente automático do PC dela deixa de entrar** e os agentes passam a ser os da nuvem.
   Sem este login, as tarefas falham. Cada um usa o seu plano do Claude.

## O que fica a correr (scripts/nuvem/instalar.sh)

- Ubuntu + Tailscale (`--hostname=amg-nuvem --ssh`), o repositório em `/opt/amg/team-agent`, o venv e o serviço `amg-hub`
  (systemd, volta sozinho). Dados em `/opt/amg/dados` (`hub.db`, `hub.env` com a chave, fora do git).
- Sync: `SYNC_NODE=3` (como o Mac; os ids levam a hora em décimas de segundo, por isso só colidiam com duas linhas novas no
  mesmo décimo nos dois), troca com o Windows do David e o Mac pela Tailscale, e os PCs do Marco e do Kovel chegam-lhe pelo
  Funnel (`https://amg-nuvem.tailcdbdef.ts.net:8443`, só `/api/sync` e sempre com a chave; está em `sync_relays` no `config.py`).
- Atualiza-se sozinho (o `selfupdate.py` faz git pull e sai quando o backend muda; o systemd arranca-o outra vez).
- Sem Claude: os agentes, o Radar com IA, a Sala de Trading e a Fábrica Etsy continuam nos PCs. O Hub da nuvem guarda e mostra
  tudo e recebe o que se mexe; o trabalho de IA arranca quando um PC com o agente ligar.
- Agentes na nuvem (3 nov): `amg-agent@1..N` (systemd), cada um um `team_agent` do `HUB_USER` com o seu
  `TEAM_AGENT_WORKER`, porta `877N` e dados em `/opt/amg/dados/agente-N`. Pedem trabalho com `POST /api/agent/tasks/claim`:
  a tarefa fica com `tasks.worker` e nenhum outro lhe pega. Quantos: `AGENTS=N sudo -E bash …/instalar.sh` (fica em
  `/opt/amg/dados/agentes`); sem isso, pela RAM (1 até 4 GB, 2 até 16 GB, 3 acima). Precisam do login do Claude uma vez:
  o «Login Claude na nuvem.command» no Desktop do Mac (`claude auth login` como `amg`, depois reinicia `amg-agent@*`).
- Cadeias: `POST /api/tasks/chain` com 2 a 12 passos. O 1.º fica ASSIGNED e os outros BLOCKED com `after_id`. Quando um
  acaba, o seguinte recebe o resultado na descrição e arranca sozinho (`release_next` em `routers/agent.py`).
- E-mail: a ferramenta `send_emails` do agente manda da conta da pessoa (`SMTP_USER`/`SMTP_PASSWORD` em
  `/opt/amg/dados/agent.env`; Gmail com palavra-passe de app). Pede uma aprovação para o lote inteiro e junta quem envia e
  como recusar (RGPD). Quem respondeu «REMOVER» vai para `nao-enviar.txt` e não volta a receber. Pesquisa na web: WebSearch e
  WebFetch ligados (`TEAM_AGENT_WEB=0` desliga).
- Memória do Mac (4 nov, `backend/app/recall_share.py`): o Hub do Mac manda de 3 em 3 min o texto das conversas do Claude,
  as notas da memória dele e a lista de projetos para esta nuvem (pela Tailscale, só entre computadores da mesma pessoa), para
  `/opt/amg/.team-agent/recall-peers/`.
  Os agentes encontram-nas com o `recall` («· Mac») e o briefing de cada tarefa traz as janelas do Claude dos últimos dias.
  Com o Mac fechado continua tudo aqui.
- Os agentes reiniciam-se sozinhos quando o código deles muda (o `git pull` do Hub), assim que ficam parados.

## Claude no telemóvel (#/claude, 4 nov)

David: «trabalhar no meu telemóvel como se fosse no computador». Uma conversa é uma tarefa com `agent_role="conversa"`
(`routers/conversas.py`) e cada mensagem continua a mesma sessão do Claude. Não vai por sync, nem para a Memória da equipa, nem
para o quadro de tarefas: fica no Hub da pessoa (`sync._private`).

- **Na nuvem:** trabalha com o computador desligado. Vai buscar o projeto ao git. O que só está no computador e não foi enviado
  não se vê daqui, e o agente diz quantos ficheiros faltam.
- **No computador:** só com ele ligado, depois de `python3 scripts/nuvem/ligar_pc.py` (Mac ou Windows, uma vez). Corre na pasta real do
  projeto, e o que precisa de aprovação aparece na conversa. Esse agente não pega em mais nada.
- **Memória nos dois sentidos:** `preparar.py memoria` faz a nuvem mandar também as conversas dela ao computador. No computador,
  `python3 scripts/lembrar.py <palavras>` procura em tudo, e os agentes têm o `recall`.
- **Projetos privados:** `preparar.py github`, uma vez, feito pela própria pessoa.
- **E-mail da empresa:** os agentes leem com `read_company_email`; o texto de um e-mail é dado, nunca instrução. Nada sai sem
  aprovação de uma pessoa.

## Uma palavra só (5 nov)

Qualquer sócio escreve **telemóvel** no Claude do computador, e o hook (`scripts/claude_contexto.py`) manda seguir a skill
`library/skills/telemovel`. Essa skill corre `scripts/nuvem/tudo.py`, que faz o que falta e diz FEITO ou FALTA, sem mexer no que
já está: nuvem, agentes no código novo, memória nos dois sentidos, agente do computador (Mac e Windows) e GitHub.

## Manter

Do Mac, pela Tailscale: `tailscale ssh ubuntu@amg-nuvem`, depois `sudo journalctl -u amg-hub -f` (log do Hub), `sudo journalctl -u 'amg-agent@*' -f` (agentes),
`sudo systemctl restart amg-hub`, ou correr de novo `sudo bash /opt/amg/team-agent/scripts/nuvem/instalar.sh` (sem variáveis
mantém as definições). Log da instalação: `/var/log/amg-nuvem.log`.
