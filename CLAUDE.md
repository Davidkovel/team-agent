# Agente AMG (team-agent) — notes for Claude

Read this after a `git clone` or `git pull`. The goal on every PC is the same: the widget is open, its own Hub runs and syncs with the others.

## The team setup

- Three people: `owner` (shown as Kovel), `mark` (Marco), `david` (David). Windows PCs, all in the same **Radmin VPN** network.
- **Host = Kovel's PC**, Radmin IP `26.68.80.191`. The Hub (backend, port 8000) lives only there. Radmin IPs: Marco `26.244.76.112`, David `26.245.177.206`.
- The team key (`-Key`) is a secret: ask the person for it, never write it into the repo.
- **A member PC does not need the key** (2 Oct, David's PC was set up this way). `local_or_team_key`
  (`backend/app/routers/local.py`) lets a widget in by the key **or** by `only_local`, and the host's
  `WIDGET_NETWORKS=26.0.0.0/8` trusts the whole Radmin network. So when nobody remembers the key, write
  `~/.team-agent/widget.json` by hand — `{"hub_url": "http://26.68.80.191:8000", "user": "David"}`, no `key` —
  and run `.\scripts\iniciar.ps1`: the person shows online. With no key the widget also never starts a Hub of
  its own (`is_local` is false), so there is no second Hub to confuse things. The key is still needed on the
  host — it is what makes its Hub listen on `0.0.0.0` — and for a widget outside the Radmin network.

## No host: every PC runs its own Hub (since 4 Oct)

Kovel's PC used to be the host and had to be on for anyone to open the Hub. Not any more:

- On every PC the widget starts a Hub on `127.0.0.1:8000` with its own `~/.team-agent/hub.db` (`SYNC=1`, listening on `0.0.0.0`).
  A `hub_url` in `widget.json` that points at a `26.x` address is from the old setup and is ignored.
- `backend/app/sync.py`: every 5 s each Hub calls the other two Radmin IPs (`team_ip_users`) on `/api/sync/exchange` and they
  trade the rows that changed (`sync_log`; newest change to a row wins; deletes travel too). A PC that was off catches up when
  it meets any other PC; a task sent meanwhile rings in its widget then.
- New ids are `time * 4 + computer number` (owner 0, mark 1, david 2), so they never collide and still sort by age.
- Kovel's database is the team's (`origin` in `sync_meta`). A PC that never synced takes it whole the first time the two
  meet and drops its own local data. Until then its Hub is a separate, empty one.
- Sign-in: on each PC `127.0.0.1` is the person whose Radmin IP that PC has. Online/offline of the others is not synced.
- Only one of two PCs needs to accept connections for them to sync. Kovel's has the firewall rule; `iniciar.ps1` adds it on
  the others when run as administrator (needed only for Marco and David to sync with each other while Kovel is off).
- After a `git pull`: `.\scripts\iniciar.ps1`, and if a Hub from before is still running, stop that `uvicorn` first.
- The company library (`library/`) is files in git, not the database: it travels by commit, not by sync.

## Phone

No phone app of our own: `backend/app/push.py` sends every notification (`services.notify`) to the person's topic on
ntfy.sh, and the phone follows it in the ntfy app (bell → «Telemóvel» in the Hub shows the topic). Only the Hub where the
notification is made sends it. The phone cannot open the Hub: it is not in Radmin, and the Hub is not put on the internet.
`NTFY_URL=` (empty) switches it off.

**The AMG app's own notifications** (`backend/app/webpush.py`, `frontend/sw.js`): Web Push to the app added to the iPhone's home screen
(iOS 16.4+), which shows the app's name and icon and the task, unlike ntfy. Browsers only allow it over https, so the PC the phone opens
needs `tailscale serve --bg 8000` (after HTTPS is enabled for the tailnet in the admin console, DNS) and the phone must open
`https://<pc>.<tailnet>.ts.net`, add it to the home screen and tap «Ativar as notificações da app» (Mais, Notificações no telemóvel).
Subscriptions and the VAPID key live in `~/.team-agent/` (`webpush.json`, `vapid-private.pem`), never in the database: a phone belongs to
one Hub, which sends what is made on it and what arrives by sync. Needs `pywebpush` (in requirements); without it the Hub runs as before.
Whoever creates a task for themselves gets it on the phone too (not in the bell or the widget).

**Phone sign-in through Tailscale (6 Oct, David's iPhone).** Behind `tailscale serve` the Hub sees the *phone's* own tailnet
address (100.x and its fd7a:… IPv6), not 127.0.0.1, so the phone got the password page. Fix per PC: put the phone's two
addresses in `backend/.env` → `IP_USERS=<phone 100.x>=david,<phone fd7a:…>=david` (`tailscale ip -4 <phone>` / `-6`), then
restart the Hub. `auth.py` also treats this PC's own addresses as its person (for requests the proxy makes from the PC itself).
Setting it up on a PC: `winget install Tailscale.Tailscale`, sign in on PC and phone with the same account, enable HTTPS in
the admin console (DNS → HTTPS Certificates), then `tailscale serve --bg 8000`; the address is `https://<pc>.<tailnet>.ts.net`.

## Keep the Hub's Memória up to date (always)

Marco asked (6 Oct): everything we change in the widget or the Hub must also be written into the Hub's **Memória**
(Sistema > Memória), so the team, and every Team AI run that reads it before a task, knows the current state.
After a change that matters (a new behaviour, a decision, a rule, something that must never come back):

```powershell
.\.venv\Scripts\python scripts\memoria.py WIDGET "Vídeos no widget" "O que é verdade agora e porquê, em 2-4 frases."
.\.venv\Scripts\python scripts\memoria.py --list
```

Same title = the note is rewritten, not repeated: keep one note per subject with the current state, not a diary.
Categories in use: REGRAS, HUB, WIDGET, TELEMÓVEL, DESIGN. Team notes go to every PC by sync and into every task's
prompt, so keep them short, in Portuguese, and without secrets, IPs or keys.

## Claude na equipa: modelos, subagentes e budget

Vale para os Claudes do Kovel, do Marco e do David. Responde sempre em português de Portugal.

- **O modelo certo para cada trabalho:** Haiku para pesquisar e procurar; Sonnet para rotina (textos, revisões, mudanças simples); Opus para decidir, desenhar e problemas difíceis.
- **Subagentes só para trabalho grande ou em paralelo:** pesquisas largas, varrer muitos ficheiros, rever antes do push. Cada um começa do zero e gasta do limite do plano (5 h e semana): em paralelo fica mais rápido, não mais barato. Para uma coisa pequena, faz tu. Diz à pessoa quando lanças um e porquê.
- **Limite do plano quase no fim** (sessão de 5 h acima de ~75%): nada de subagentes em paralelo, os que forem precisos em Haiku ou Sonnet, e acabar e fazer commit do que está a meio.
- **Agentes da equipa** em `.claude/agents/`: `pesquisador` (Haiku), `explorador` (Haiku, só lê), `revisor-hub` (Sonnet, antes do push), `designer-hub` (Sonnet), `marketing` (Sonnet, BareDesk e escolas).
- **Várias sessões no mesmo PC:** ver as outras (ListAgents) antes de mexer em ficheiros partilhados e combinar por mensagem; nunca deixar commits por enviar; o merge ou o reset do trabalho de outra sessão é a pessoa que decide.

- **A equipa da Empresa AMG** (`backend/app/crew.py`): uma tarefa pode ir para uma personagem (`crew`: batman, lucius, riddler, catwoman, joker, alfred, robin, gordon). O agente automático corre-a nessa personagem, sempre na mesma conversa do Claude, com o briefing do Hub; cada tarefa acabada vira uma nota TAREFAS na Memória. Mudar uma personagem = `CREW` no `crew.py` e no `frontend/hub/crew.js`.
- **Tarefas para o escritório num toque** (9 out): «Mandar para o escritório» na linha da tarefa, na janela da tarefa
  (`sendToOffice` no `pages.js`) e no cartão «Tarefa para ti»; «Escolher o agente» fica em segundo plano. Uma tarefa mandada a
  alguém aparece num cartão no topo de qualquer página e acende o número do «Tarefas» da barra (`taskNews` no `shell.js`, a partir
  dos avisos `task_new` dirigidos e por ler; `setBadge` no `app.js`).
- **O agente espera pelo limite do Claude** (9 out, `limit_reset` no `agent/team_agent/core/agent.py`): uma tarefa parada pelo fim do
  plano volta a ASSIGNED com «À espera do limite do Claude: recomeça às HH:MM» e o agente não pega em mais nada até essa hora; o
  Hub aceita ASSIGNED vindo do agente. O agente automático do Marco está ligado desde 9 out (`agent/.env`, arranque com o Windows
  por `scripts/autostart.py install agent`).
- **O escritório distribui sozinho** (8 out, pedido do Marco): uma tarefa para a IA sem `crew` recebe-o no Hub (`crew.sector_of`: palavras do título e da descrição → papel → Gordon), tanto ao criar (`POST /api/tasks`) como ao entregar uma que já existe (`POST /api/tasks/{id}/assign-ai`, com `crew` vazio). O agente corre uma tarefa de cada vez, por isso ocupado = fila, não outra personagem. `POST /api/tasks/route` diz quem a leva e quantas tem à frente; `GET /api/tasks/crew` dá a lista. As palavras (`WORDS`, `ROLE_CREW`) estão no `crew.py` **e** no `crew.js`: mudar nos dois. A janela de mandar tarefas é o compositor do `pages.js` (`newTask`, `assignToAI`, estilos `.cmp` no `design.css`): Escritório ou Pessoa, os oito agentes, e a linha «Vai para…» pedida ao Hub enquanto se escreve.
- **A empresa de agentes:** o rumo do Agente AMG está em `docs/empresa-amg.md` (visão de Deus, departamentos, fases 2D → controlo → 3D). Lê-o antes de construir algo grande.
- **Regras de peso:** o Hub guarda o estado e não cada passo; o widget só mostra resumos e só anima quando algo muda; cada secção da central carrega só quando se entra nela. Limites parados: widget e Hub abaixo de 1% de CPU, central aberta abaixo de 3%. Mede antes do push: se pesar, não entra.

### A Empresa AMG (a Batcave, antiga My Niggaz)

**Redesenhada a 7 out** a pedido do Marco e arrumada em duas páginas a 9 out (`docs/batcave-redesenho.md`: o que ele pediu, o
que se fez e o que falta). Antes de mudar alguma coisa grande nestas páginas, lê esse ficheiro. Correm no mesmo motor (`crew.js`):

- **Empresa AMG** (`#/empresa`; o `#/niggaz` antigo continua a abrir) **é a cave**, a página inteira. A ficha do agente aparece por
  cima dela ao passar o rato (`.cr-side`). O botão **Mini janela** (`openMini`) põe a cave numa janela pequena por cima de tudo: no
  widget pela `amg.openMini` (`widget/team_widget/ui/mini.py`, sempre por cima, guarda o sítio e o tamanho), no Chrome com
  picture-in-picture, noutro browser numa janela pequena. A página com `?mini=1` (`html.is-mini`, posto no `app.js`) é só a cave
  e uma linha de quem trabalha para quem, a menos imagens por segundo.
- **Escritório** (`#/escritorio`) **é a central de comando**: `frontend/hub/crew-board.js` + `crew-board.css`. Num ecrã só no PC
  (`.desk`: duas colunas a partir de 760 px, três a partir de 1180 px, `.wide`; cada coluna rola por dentro): os sócios (online ou
  visto há, Claude 5 h e semana, o que cada Claude deles faz e o que espera por eles), as **câmaras** (monitor principal com quem
  pediu, a meta e o que faz agora, e uma câmara por agente) e as missões (mandar, pôr na fila, a fila, o feito hoje). Desenha o que
  o `crew.js` lhe dá (`boardHost`) e só mexe no bocado que mudou. **No telemóvel** é uma app de quatro abas (Agora · Câmaras · Sócios ·
  Missões, `data-tab`/`data-pane`) e o Escritório está na barra de baixo (`TABS` no `mobile.js`); a Empresa AMG fica em «Mais».

- `frontend/hub/crew.js`: o motor e **a cave** (construída uma vez, `buildCave`; a página Empresa AMG põe-na dentro de si e a sair
  ela pára, `openCave`/`closeCave`).
  O mundo, a câmara (Escritório · Cofre · Stand · Tudo, arrastar, roda do rato; clicar num agente leva-a ao posto dele), os agentes
  a andar e a trabalhar, as missões (lê `/api/tasks`, `/api/office`, `/api/memory` e `/api/team`, cria com `POST /api/tasks` e
  `crew`), os painéis (agente, Memória, arsenal, cofre, carro: uma gaveta à direita, por cima do quadro e da cave) e as câmaras do
  quadro (`camFrame`: copia bocados da cave para os canvas do quadro uma vez por segundo, seis enquanto alguém anda, e só com a
  parede de monitores à vista).
- `frontend/hub/crew-people.js`: as personagens, com o dobro do detalhe da cave, luz, sombra e contorno. Cada imagem de uma pose
  desenha-se uma vez e fica guardada (`sprite`, `portrait`).
- `frontend/hub/crew-cars.js`: os carros em 3D (G 63, 911 GT3 RS, Aventador SVJ, SF90). Carroçaria feita de secções ao longo do
  carro a partir de números tirados do carro verdadeiro (`MODELS`), mais os pormenores de cada um (`DETAILS`); desenham-se uma vez
  por tamanho para dentro do fundo.
- `backend/app/crew.py`: as personagens do lado do Hub (papel, personalidade), o briefing que o agente lê e as notas TAREFAS.
- `backend/app/routers/office.py`: as janelas do Claude e os subagentes, e o **arsenal** (`arsenal()`): as skills que cada janela e
  cada subagente usou (colunas `skills` de `claude_sessions` e `claude_agents`, versão 14 da base de dados) mais as que há nas pastas
  `.claude/skills` deste PC e dos repositórios da equipa (`skill_folders()`, lidas de 5 em 5 minutos).

- **Postos e encaminhamento** (`DESKS`, `WORDS`, `NEAR` no `crew.js`): um posto de dois ladrilhos por setor, sempre do mesmo
  agente, com o setor escrito no chão (`sectorFloor`, no fundo). Quem vai é o `routeOf()`: nome pedido → tipo de subagente → palavras
  do pedido → papel → Operações; ocupado, o colega de `NEAR`. O «Automático» do formulário usa o mesmo `routeOf()` e manda já com `crew`.
  Um posto ordena-se pelo meio (`x + y + 2`), a cadeira logo a seguir: assim quem passa atrás fica por baixo e quem passa à frente, por cima.
  Uma missão dada a uma personagem (`crew`) passa à frente de um espelho de janela: se ela só estava a mostrar um Claude ou um
  subagente, esse espelho passa para o colega de `NEAR`, porque a missão é a conversa dela a correr de verdade.
- **Sala de estar** (`LOUNGE`, `TABLE`): sofás em U à volta da mesa da Memória (cada nota é um ponto, os temas em grupos ligados).
  Quem se senta num sofá é desenhado dentro da fatia do sofá (`chairAt`), entre o que fica atrás e o que fica à frente, como nos
  cadeirões antigos. Os livres conversam à vez (`talker`, um de cada vez, 4,5 s cada) e o balão diz o que a equipa acabou (notas
  TAREFAS). Uma missão começa na mesa (`TABLE_SPOT`, «a levar as notas da Memória») e acaba lá (`dropNote`). Reunião = missão a
  sério para o Gordon, com descrição; a nota sai do `crew.remember_task` como as outras.
- **Paredes** (`wallPicture`/`wallPic`): o letreiro, os três ecrãs dos sócios (`SCREENS`), o arsenal (`ARSENAL`) e o quadro da
  Memória (`BOARD`) são imagens nítidas desenhadas uma vez e refeitas só quando a assinatura do conteúdo muda; ficam por baixo da
  camada que mexe. As dicas e os cliques sabem onde se está numa parede com `wallAt()`; quem mexer no tamanho de uma delas mexe
  também nos limites usados no `hitTest`.
- **Cor só para os estados e para os sócios** (`LIGHT`, `DIAMOND`, `PARTNERS`): a luz do bunker é branco frio (`COLD`). As cores
  próprias das personagens já não pintam nada na gruta.
- **A meta, o que fez e porque espera** (9 out): o hook manda o título que o próprio Claude Code dá à conversa (`ai-title` do
  transcript) e, ao parar, o início da última resposta; o Hub guarda-os em `claude_sessions.title` e `.result` (versão 16) e diz em
  `/api/office` o `wait` de uma janela à espera: `permission`, `answer` ou `done`. Um aviso de máquina (agente que acabou, mensagem
  de outra sessão) já não apaga o pedido da pessoa. O quadro mostra a meta em grande e o pedido por baixo.
- **Fila de espera**: uma tarefa `TODO` com `crew` está em espera para o escritório («Pôr na fila» na linha da missão); «Arrancar»
  entrega-a (`assign-ai`). O quadro diz porque espera cada uma (em espera, agente automático desligado, à vez).
- **Ninguém a ver = nada a mexer**: com a cave fechada e as câmaras fora do ecrã, o `settleAll()` faz de uma vez o que seriam
  segundos a andar. Quem juntar animações novas confirma que o quadro não fica à espera delas.
- **Câmaras nítidas** (`shoot`): cada pixel da camada que mexe é um número inteiro de pixels no ecrã e a imagem assenta na grelha
  dela; um zoom livre dava pixels desiguais e parecia avariado. Sem filtro CSS nos canvas (em nove pesava mais do que desenhar).
- **«Agente automático ligado»** vem do `status` do `/api/team` (WORKING, IDLE, WAITING, PAUSED, ERROR); `ONLINE` é só o widget
  ou uma página aberta. O agente de outro PC não se vê daqui (a presença não vai por sync).
- **No telemóvel** (`narrow`, menos de 640 px) os cartões são pastilhas de uma linha, senão tapam a gruta toda.

Coisas que custaram tempo e não se devem repetir:

- **O fundo fica sempre por baixo.** A cave, os stands e os carros estão no fundo (estático); a mobília do escritório e os agentes
  estão na camada que mexe, por cima. Por isso nada do escritório pode ficar, no ecrã, por cima de um carro (o armário de servidores
  estava em x=16 e aparecia à frente do G 63: passou para x=6). Pela mesma razão os agentes só vão ver os carros da fila da frente.
- **A camada que mexe é desenhada a dobrar** (`WS = 2`). Desenhar numa parede é com `onBackWall`/`onLeftWall`, que respeitam a
  escala do canvas (`g.k`); um `setTransform` à mão perde-a.
- **Um carro novo**: modelo em `MODELS` e `DETAILS` no `crew-cars.js`, e o lugar num stand em `CARS` no `crew.js` (com `project`).
  Os pormenores da frente e da traseira têm de caber na largura da ponta do carro, que é mais estreita do que o carro (`plan`).
- **Uma personagem nova**: `CREW` no `crew.py` e no `crew.js`; o fato é o `look` (o que cada campo faz está no `crew-people.js`).
- **Testar no painel do browser**: escondido, o browser não corre `requestAnimationFrame` nem o `ResizeObserver`, por isso a página
  fica parada. Para testar, juntar um gancho temporário no fim do `crew.js` **da cópia de teste** (nunca no repositório):
  `window.__crew = { draw, run: (s, dt = 1 / 26) => { for (...) { clock += dt; stepCamera(dt); stepBeam(dt); agents.forEach((a) =>
  step(a, dt)); tickParticles(dt); } draw(); }, load: () => { lastLoad = 0; return load(); }, ... }`. Para ver de perto, copiar
  um bocado do canvas para um canvas por cima da página e tirar o screenshot desse. Os screenshots desse painel às vezes chegam um
  passo atrasados: tirar dois. Para ver um agente a ir à mesa, à parede das skills ou a acabar: criar a tarefa ou o passo do hook
  no Hub de teste **com a página já aberta** (num primeiro carregamento tudo aparece já sentado).
- **Peso**: 3,5–5 ms por imagem a 1600 px (melhor de vários lotes; as medições soltas variam o dobro com o PC ocupado); o fundo
  com os carros ~300 ms, só ao abrir e ao mudar de tamanho (espera 160 ms). Medido a 9 out no Chrome sem placa gráfica, a 1920 px:
  o quadro com as câmaras à vista 3,7% de um núcleo, a cave aberta 42%, outra página do Hub 0,1%. Por isso a cave só abre a pedido.
- **`\b` numa expressão escrita por uma ferramenta pode virar um carácter de controlo** (9 out): no `index.html` o `/[?&]phone=1\b/`
  estava com um ^H em vez de `\b` e nunca dava certo; o `?mini=1` saiu igual. Escrever `(&|$)` em vez de `\b`, e procurar
  caracteres de controlo antes do push (`grep -rlP "\x08"`).
- **Um nome que já existe no `crew.js` apaga o outro** (9 out): uma função nova chamada `release` substituiu a que liberta o sítio
  de um agente, e cada passo de um agente passou a mandar um pedido errado ao Hub. Antes de juntar uma função, procurar o nome.
- **O mundo é o `MAP`** (7 out): uma letra por ladrilho (o escritório, `~` o rio, `b` as pontes, `g` o stand, `v` o cofre, `t` a
  varanda do bar, `p` o miradouro, `.` o abismo). Só há paredes em y = 0 e x = 0; qualquer outra aresta é uma ravina com uma luz ao
  longo dela. Não pôr paredes noutras arestas: o fundo fica por baixo, e uma parede à frente não taparia quem está atrás dela.
- **Mudar o `MAP` = confirmar que todos os `SPOTS` e secretárias têm caminho.** Os stands bloqueiam o stand inteiro entre o
  corredor do meio e a fila da frente, e o rio só se atravessa nas pontes; sem a ponte da foz, a frente do stand e o miradouro
  ficavam sem caminho e o `route()` mandava os agentes em linha reta por cima da água.
- **Uma peça larga corta-se em fatias de um ladrilho** (o bar), cada uma ordenada onde está; ordenada como um só bloco, tapava quem
  estava ao balcão ou deixava ver quem passava atrás. O que não muda desenha-se uma vez para uma imagem (`still` / `cachedDraw`, com
  a área que ocupa); o ouro e as notas do cofre têm a contagem na chave da imagem.
- **O cofre**: cada tarefa `COMPLETED` é uma barra de ouro (duas paletes de 30), as desta semana são as notas no carrinho. Clicar
  abre o painel com a loja (`/api/store/summary`) e o custo da IA (`/api/usage/summary`). Quando um agente acaba, voam moedas para lá.
- **O holofote do miradouro** varre a gruta e, quando chega uma missão, projeta o bat-sinal na parede do escritório (já não sai de
  dentro do escritório).

### Testar uma mudança no Hub

1. Copiar os dados com a API de backup do SQLite (`sqlite3.connect(origem).backup(destino)`): copiar o `hub.db` com o Hub a correr dá "database disk image is malformed".
2. Hub de teste, a partir de `backend/`: `DATABASE_URL=sqlite+aiosqlite:///<cópia> REDIS_URL= SYNC=0 ..\.venv\Scripts\python -m uvicorn app.main:app --port 8010` (com `FRONTEND_DIR=<cópia do frontend>` para não mostrar trabalho a meio no Hub verdadeiro).
3. PC: Chrome headless com `--window-size=1500,1200 --screenshot=<png> "http://127.0.0.1:8010/#login=<token>&to=/tarefas"`; o token vem de `POST /api/auth/auto`.
4. Telemóvel: uma página de teste com `<iframe src="/?phone=1#/home" width="393">` (o headless não fica mais estreito do que ~490 px, e o `#login=` apaga o `?phone=1`).
5. No fim: apagar as páginas de teste e parar o Hub da 8010.
6. Para mais do que uma captura (clicar, passar o rato, um telemóvel a sério, os pedidos que o Hub recusou, os erros da página e quanto
   ela gasta do PC): `scripts/ver_hub.py passos.json`, um Chrome sem janela guiado por uma lista de passos (o cabeçalho do ficheiro diz quais).

### Publicar

1. O frontend mudou: subir o `?v=hubN` no `frontend/index.html`.
2. `git add` só dos teus ficheiros, commit em português, `git fetch` + `git rebase origin/main` + `git push`.
3. O backend mudou: reiniciar o Hub deste PC (parar o `uvicorn ... --port 8000` e o widget, correr `Abrir AMG.cmd`); os outros PCs reiniciam sozinhos quando fazem pull.
4. Quando o `GET /api/version` muda, os telemóveis recarregam sozinhos em até 15 s.
5. Escrever o que mudou na Memória do Hub (`scripts/memoria.py`, acima).

The sections below were written for the old host setup; where they disagree with this one, this one is right.

## Make it work

```powershell
git pull
# once per PC (the host runs it in an administrator PowerShell, without -HostIp):
.\scripts\configurar_widget.ps1 -Key <team key> -User Marco -HostIp 26.68.80.191
# every time, also after a git pull:
.\scripts\iniciar.ps1
```

`iniciar.ps1` creates `.venv` if missing, installs backend + widget requirements, closes an old widget and opens the new one with `pythonw` (no console; it survives closing the terminal).

## How it fits together

- `configurar_widget.ps1` writes `~/.team-agent/widget.json` (`key`, `user`, and `hub_url` when `-HostIp` is given). `TEAM_HUB_URL`, `TEAM_KEY`, `TEAM_WIDGET_USER` override it.
- On the host the widget starts the Hub itself when nothing answers on port 8000 (`widget/team_widget/hub.py`, `start_local_server`). It binds `0.0.0.0` only when a team key is set, otherwise `127.0.0.1`. Its database is `~/.team-agent/hub.db`, not `backend/dev.db`.
- That Hub runs with `backend/` as working directory, so it still reads `backend/.env` (not in git). On the host it holds `IP_USERS=127.0.0.1=owner,::1=owner,26.244.76.112=mark` and `WIDGET_NETWORKS=26.0.0.0/8`.
- **Hub sign-in needs no password for the team.** The three Radmin IPs are built in (`team_ip_users` in `config.py`:
  owner, mark, david) and `IP_USERS` from `.env` goes on top (adds a computer or moves one to another person). Until 3 Oct
  David's IP was only meant to be added by hand to the host's `.env`, it never was, and his browser kept getting the
  password page. A new teammate = one more `ip=login` in `team_ip_users`, then the host pulls and restarts the Hub.
- Online status comes from the widget pinging `/api/local/presence` with the `X-Team-Key` header. The agent (`agent/`, token in `agent/.env`) is optional for being online.
- An agent token is tied to one database: a token issued against `backend/dev.db` is rejected by the widget-started Hub (`hub.db`) with `HTTPStatusError`.

## Someone is not online — check in this order

1. Same Radmin network? Each side must see the other in the Radmin VPN window. Ping can fail even when it works (Windows blocks ICMP), so test `http://26.68.80.191:8000/api/hub/companies` instead: 401 means the Hub answers.
2. Host: `netstat -ano | findstr :8000` must show `0.0.0.0:8000`. `127.0.0.1:8000` means the Hub started without the team key: run `configurar_widget.ps1` on the host again, then `iniciar.ps1`.
3. Host firewall: rule "Agente AMG Hub" must exist (TCP 8000, remote `26.0.0.0/8`). The broad `python.exe` allow rules that Windows creates stay disabled: the host has a public IP on its network adapter and those rules open the Hub to the internet.
4. After editing `backend/.env`, the Hub must be restarted: stop the `uvicorn app.main:app` process, then `iniciar.ps1`. If it was started from an administrator window, only an administrator can stop it.

## The Team AI Hub (what is where)

Four different things, never mixed: a **User** (person), their **Local Team Agent** (`agent/`, a background process, one per
person), an **AgentSession** (one run of Claude by that agent: a task, a question from the Hub, a weekly report) and a
**Subagent** (research / coding / testing / review, spawned inside a session). The Qt widget (`widget/`) is only the
control surface of the agent; it is not the agent.

- **Database changes**: only through `backend/app/migrate.py`. Add the column or table to `models.py`, bump `SCHEMA_VERSION`;
  on start the Hub creates what is missing, never drops anything, and copies a SQLite database to `hub.db.bak-<date>` before
  changing it. New columns must be nullable or have a plain default.
- **API** (`backend/app/routers/`): `agents.py` (agents, sessions, subagents, and the agent's reports), `work.py` (projects,
  memory, expenses, notifications, attention, search, company overview), `analytics.py`, `ai.py` (questions and the weekly
  report), `tasks.py` (board, edit, assign to AI).
- **No AI in the Hub**: the Hub holds no API key. A question (`/api/ai/ask`) is queued for the asker's own agent, which runs
  Claude on the data the Hub gathered and posts the answer back. No agent connected = no answer, and the UI says so.
- **Where numbers come from**: every figure is `live`, `calculated`, `estimated` (cost is always the SDK's estimate) or
  `not_connected`. A missing source is shown as missing, never as zero. Do not add demo data.
- **Frontend** (`frontend/`, no build step): `hub/design.css` is the design system (tokens + components), `hub/ui.js` the
  components and `t()` (Portuguese text is its own key; another language is one more dictionary in `I18N`), `hub/home.js` the
  widget grid, `hub/pages.js` the pages, `hub/shell.js` notifications, Ctrl+K and the Team AI. `app.js` and `styles.css` are
  the older pages (company library, media player, code feed, week). After changing any of them, bump `?v=` in `index.html`.
- **Agent** (`agent/team_agent/`): `providers/claude_sdk.py` runs the SDK with only our tools, `strict_mcp_config` (the
  account's connectors are not loaded) and background tasks off; `core/session.py` reports the run to the Hub.
  `TEAM_AGENT_SUBAGENTS=0` switches subagents off.

To try changes without touching the real Hub: a second server on another port with its own database, from `backend/`:
`DATABASE_URL=sqlite+aiosqlite:///C:/tmp/dev.db REDIS_URL= ..\.venv\Scripts\python -m uvicorn app.main:app --port 8010`.

## Working on the code

- Tests: `cd backend; ..\.venv\Scripts\python -m pytest -q` and the same in `agent`; the widget's Qt-free parts with
  `cd widget; ..\.venv\Scripts\python -m pytest tests -q`.
- Commit and push straight to `main`.
- Never commit `.env`, `widget.json`, tokens or the team key.
