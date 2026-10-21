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

- **«Continua», «faz o que estavas a fazer», «vou de novo fazer aquilo»** (Marco, 14 out: «tu já devias ir ver no widget
  aquilo que foi feito»): antes de responder ou perguntar, corre `.venv\Scripts\python scripts\continuar.py` aqui no team-agent.
  Mostra as tuas janelas do Claude do último dia (vêm do Escritório, `/api/office`) e, de cada uma, lê o histórico deste PC: o que
  a pessoa pediu (também o que mandou enquanto a janela trabalhava), o que o Claude disse no fim, os últimos passos, o que foi
  cortado a meio e o que ficou por commitar. `continuar.py <início do id>` mostra uma janela em detalhe. Segue sozinho a partir
  daí. No Escritório, cada janela tua acabada tem **«Continuar»**, que copia um prompt pronto a colar numa janela nova.

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

- **Empresa AMG** (`#/empresa`; o `#/niggaz` antigo continua a abrir) **é a cave**, a página inteira. Ao passar o rato num agente
  aparece um cartão pequeno ao lado do rato (`peek` no `crew.js`: nome, estado, meta, para quem, agora); a ficha grande à direita
  (`.cr-side`) saiu a 9 out («parece uma janela que ocupa quase a tela toda... não é clean»). O botão **Mini janela** (`openMini`)
  põe a cave numa janela pequena por cima de tudo: no widget pela `amg.openMini` (`widget/team_widget/ui/mini.py`, sempre por
  cima, guarda o sítio e o tamanho), no Chrome com picture-in-picture, noutro browser numa janela pequena. A página com `?mini=1`
  (`html.is-mini`, posto no `app.js`) é só a cave, a menos imagens por segundo, com uma barra fina com os números e um cartão em
  baixo que mostra um a um quem trabalha, para quem e em quê (`paintMini`, um novo de 6 em 6 s; clicar abre a missão); por cima
  dos agentes só os nomes, e as vistas aparecem com o rato. Os estilos da página e da mini janela estão no `crew.css` com
  `#cr-cave` à frente.
- **Janelas pequenas** (9 out, «quando mete a janela bem mais pequenina... buga-se tudo»): abaixo de 1100 px a barra lateral do
  Hub fica em ícones e o Painel (`#hpanel`) só abre quando se pede, por cima, e fecha ao clicar fora (`shell.js`, `painel.js`; a
  escolha feita numa janela grande fica guardada). A cave nunca passa do fundo: o HUD, a equipa e as vistas ficam sempre por cima
  da imagem, mais pequenos (container queries no `crew.css`), e o `fitCave` volta a medir sempre que o espaço muda
  (`ResizeObserver`). No telemóvel a equipa, as vistas e a legenda continuam por baixo da imagem.
- **Escritório** (`#/escritorio`) **é a central de comando**: `frontend/hub/crew-board.js` + `crew-board.css`. Num ecrã só no PC
  (`.desk`, a partir de 760 px; cada coluna rola por dentro). **Desde 14 out tem duas vistas no PC** (`data-view`, botões Equipa ·
  Câmaras no topo; pedido do Marco: «bué confuso, fica bué grande... quero saber quem está a trabalhar com quem, o Kovel com o
  Batman e a prompt»):
  - **Equipa** (a de abrir): uma coluna por sócio (`personCard`). Cada trabalho é um cartão com o agente que trabalha com ele no
    topo (`pair`: cara, nome, setor, estado, há quanto tempo), a meta, o pedido inteiro (`askLine`, 4 linhas e um clique para tudo:
    «nem completas umas frases») e o que faz agora. Em baixo, sempre à vista, **uma fila de mini câmaras** dos dez (`minis()` no
    `wallPlan`): quem trabalha primeiro, aceso e com o dobro da largura; clicar numa abre-a em grande na vista Câmaras.
  - **A meta acompanha o assunto**: o Hub dá `topic` em `/api/office` (`_topic` no `office.py`), a 1.ª frase do último pedido da
    pessoa. O título que o Claude Code dá à conversa (`ai-title`) é escrito uma vez e nunca muda com o assunto, por isso só serve
    quando não há pedido. Um «sim», «ok» ou «continua» (`_ack`) não muda o pedido nem o assunto.
  - **Câmaras**: a parede de antes (abaixo), com as missões à direita.
  - **A parede de câmaras** (`paintWall`, `wallPlan`, `gridFor`). Quem tem missão (a trabalhar ou à espera de alguém)
    ganha um monitor grande, aceso na cor do estado, com o agente, a meta, o que faz agora e para quem escritos por cima da imagem
    (`hud`). Os monitores dividem a parede entre si (`gridFor` escolhe as colunas). Os livres ficam pequenos e escuros numa fila
    por baixo; sem ninguém a trabalhar, os oito dividem a parede. Monitor mais pequeno = menos texto (container queries).
  - Clicar num monitor põe-no na parede inteira; «Todas» volta atrás. Os monitores são movidos, nunca refeitos (um canvas guarda a
    imagem), e o motor filma logo (`film(true)`), com o agente um pouco acima do meio (`lift`) para o texto não o tapar.
  - À direita, os sócios numa linha cada (Claude 5 h e semana ao canto; uma linha por trabalho, que acende a câmara dele) e, por
    baixo, as missões: o formulário numa linha até se escrever, e «Na fila» / «Feito hoje» em abas.
  - O painel do lado direito do Hub (`#hpanel`) fica escondido nesta página (`:has(#cr-board)`).
  - Passar o rato numa câmara pequena mostra um cartão pequeno (`peek`), não a ficha inteira.
  - Peso medido: 2,1–2,8% de um núcleo parado.
  Numa janela estreita (menos de 760 px, `.tabbed`) e **no telemóvel** é uma app de quatro abas (Agora · Câmaras · Sócios ·
  Missões, `data-tab`/`data-pane`), com os monitores um por baixo do outro e o texto por baixo da imagem. No telemóvel o Escritório
  está na barra de baixo (`TABS` no `mobile.js`) e a Empresa AMG em «Mais». Desenha o que o `crew.js` lhe dá (`boardHost`) e só mexe
  no bocado que mudou.

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

### Mensagens (21 out, pedido do Marco)

«Quando quiser passar contas, comandos e tal, o pop-up ali pode abrir; consigo mandar como se fossem mensagens lá no widget.»
`#/mensagens` (01 · Comando; `frontend/hub/mensagens.js` + `.css`) e `backend/app/routers/messages.py` (`/api/messages`).

- Uma conversa é com uma pessoa (`peer` = id dela) ou com a equipa toda (`peer` = `team`). Tabelas `messages` e `message_seen`
  (versão 18 da base de dados): vão por sync para os três PCs como qualquer linha; a API só mostra uma conversa a quem está nela.
- Enviar escreve uma notificação `message` (dirigida) para quem recebe: acende o «Mensagens» da barra, abre em qualquer página o
  cartão com o texto e uma caixa para responder ali (`msgNews`/`drawMsgPop` no `shell.js`), aparece no widget como cartão
  «MENSAGEM PARA TI» (`/api/local/notices` inclui `message`; `caption` no `notice.py`) e chega à app do telemóvel (web push,
  cifrado). O ntfy é texto aberto noutro servidor: recebe só «X mandou-te uma mensagem», nunca o conteúdo.
- Abrir a conversa lê-a (e as notificações dela). O que vem dos outros PCs chega pelo sync, que não avisa as páginas: com a
  página aberta ela volta a perguntar de 4 em 4 s.
- Entre ``` fica um bloco com «Copiar» (comandos, contas), `assim` é código numa linha, links abrem no browser; cada mensagem
  copia-se inteira e a própria apaga-se com dois toques (o delete vai por sync).
- Testes em `tests/test_messages.py`.
- **`api()` já faz o `JSON.stringify` do `body`**: passar o objeto (`body: { ... }`). Com `JSON.stringify` à mão o Hub recebe
  uma string e responde 422; os botões da página Skills estiveram assim desde 14 out.

### Skills: a biblioteca da Empresa AMG (14 out, pedido do Marco)

«Buscar as skills e colocar todas aí, que vocês dominem todas e que fiquem no widget, fácil para cada agente usar.»
`#/skills` (`frontend/hub/skills.js` + `.css`, na barra logo a seguir à Empresa AMG; no telemóvel em «Mais»; também pelo arsenal da
cave e pela porta Skills do Escritório) e `backend/app/routers/skills.py` (`/api/skills`).

- **A biblioteca são ficheiros em git**: `library/skills/<nome>/SKILL.md` (e os ficheiros que a skill traz), como o resto da
  `library/`. `library/skills/agentes.json` diz que agente domina cada uma (`{"skill": ["batman", ...]}`). Cada mudança feita na
  página faz commit e push **só de `library/skills`** em segundo plano (`_push`), por isso chega aos outros PCs no próximo pull.
- **Três metades na página**: Biblioteca (uma faixa por agente com as skills que domina; clicar abre a skill, com «Quem a domina»
  um toque por agente e «Tirar da biblioteca»), Neste PC (as instaladas: `~/.claude/skills`, os plugins instalados segundo
  `~/.claude/plugins/installed_plugins.json`, as do claude.ai em `plugins/synced`, e as `.claude/skills` dos repositórios da
  equipa) e Loja (os catálogos dos marketplaces em `~/.claude/plugins/marketplaces`). «Trazer» copia para a biblioteca e dá-lhe o
  agente do setor pelas palavras (`_guess_crew`); ficam de fora ficheiros acima de 1,5 MB e o que passe de 3 MB por skill.
- **Arrumadas por tema** (21 out, Marco: «organizado por tema, para saber o que serve para cada; sempre que metemos uma skill,
  fica lá»): as três metades abrem por Tema (uma secção por tema com o «para quê», uma fila de temas no topo para saltar, e na
  Biblioteca os temas ainda vazios com quantas há neste PC e na Loja); o botão ao lado troca para Agente (Biblioteca) ou Origem.
  **Os temas são as áreas de `scripts/claude_contexto.py`** (`AREAS`, `PARA`, `area_of`), as mesmas que as janelas do Claude
  veem: o backend carrega esse ficheiro (`_ctx()`), por isso uma skill nova cai sozinha no tema certo, venha da página, do
  GitHub ou de um commit à mão. Um tema escolhido à mão na skill aberta fica em `library/skills/temas.json`. Tema novo = uma
  linha em `AREAS` + uma em `PARA` + o ícone em `THEME_ICON` (`skills.js`).
- **Do GitHub**: colar o link de um repositório, pasta ou SKILL.md traz todas as skills que lá houver (API de árvores do GitHub +
  raw, sem chave; máximo 80 skills e 60 ficheiros por skill).
- **Os agentes usam-nas** (`agent/team_agent/tools/skills_tool.py`): a ferramenta `skills` lista (com `query` filtra), lê uma
  (`name`) e os ficheiros dela (`name` + `file`). O briefing de cada personagem diz quais domina (`skill_lines`) e manda ler a skill
  antes de fazer esse trabalho, e listar todas quando a tarefa fala das skills da equipa. Depois de mudar o agente, reiniciá-lo.
- **Todos os Claudes de todos os PCs veem a biblioteca sozinhos** (16 out, pedido do Marco: «não queremos relembrar sempre ao
  nosso Claude que tem de usar as skills... és uma máquina»). O Hub põe dois hooks no `~/.claude/settings.json` de cada PC
  (`claude_hooks.py`, ao arrancar, ao lado dos do Escritório; `CLAUDE_SKILLS=0` no `backend/.env` tira-os), que correm
  `scripts/claude_contexto.py`: ao abrir uma janela, um índice curto da biblioteca por área e a regra (ler o `SKILL.md` que
  servir antes de trabalhar); em cada pedido, as até 6 skills da biblioteca que servem para ele, pelas palavras do pedido
  (português, inglês ou russo; `AREAS` no script) e com o caminho do `SKILL.md`. Um «sim» ou um pedido sem área não recebe nada.
  Só lê a pasta, sem rede; o índice fica em `~/.team-agent/skills-index.json`. Experimentar à mão:
  `python scripts/claude_contexto.py "faz-me um site para uma escola de condução"`. Não estão em `.claude/skills` de
  propósito: 100+ descrições em cada sessão gastavam contexto, e no PC do Marco a lista de skills já passa do limite.
- **O repositório é público**: só entram skills nossas, dos parceiros (com autorização) ou com licença aberta. O «Trazer»
  (`_adopt`) recusa as de licença fechada (os docx/pdf/pptx/xlsx da Anthropic) e leva o `LICENSE` do plugin quando ele está
  fora da pasta da skill. `library/skills/origens.json` diz de onde veio cada uma. As skills dos plugins de terceiros (SEO,
  anúncios, Shopify, superpowers...) **não foram copiadas**: publicar 128 skills de outros num repositório público ficou para o
  Marco decidir (16 out).
- **O mesmo Claude Code em todos os PCs** (16 out, `backend/app/claude_kit.py`; Marco: «automatiza tudo... para todos»):
  cada Hub pergunta aos outros, pela VPN (`/api/sync/kit`, mesma regra do sync para quem pode perguntar), que plugins e
  skills pessoais têm, e dá ao seu PC o que falta: os plugins com `claude plugin install <plugin>@<marketplace> --scope user`
  (só marketplaces do GitHub, nunca com `-y`), as skills de `~/.claude/skills` num zip para `~/.claude/skills` (uma pasta
  com um ficheiro `.privada` nunca sai). Nada vai para o git. De 30 em 30 min; o que aprendeu fica em
  `~/.team-agent/claude-kit.json`; um plugin que a pessoa tirou não volta. `FORA` no módulo deixa um plugin de fora para
  todos (o ActiveCampaign, que sem a conta dá erro em cada janela). **Desligado por omissão: cada um liga no seu PC**
  (instala plugins e skills de outros no PC dele): no Hub, **Trabalho › Kit do Claude** (`#/kit`, `frontend/hub/kit.js`),
  botão «Ligar o kit neste PC», que só a pessoa desse PC pode carregar (o login dela é o do endereço VPN do PC,
  `sync.whoami`; sem VPN, só o widget do próprio PC). Fica em `~/.team-agent/claude-kit-on.json` e ganha ao
  `CLAUDE_KIT=1` do `backend/.env`. A mesma página mostra cada PC (ligado, desligado, PC desligado) e quem tem cada plugin
  e skill pessoal; o cartão «Kit do Claude» em Trabalho › Geral resume. O PC que serve também tem de o ter ligado. Nunca
  ligar o kit no PC de outra pessoa por ela (Marco, 16 out: o Kovel e o David ligam no deles).
- **Skills dos parceiros** (16 out): `site-empresa-local` (método dos sites Blue Magnitude e Detalhes Cautelosos do Tomás,
  tomas476) e `site-estudio-ia` (método do site NeoDaemon do Fábio, fabiocabaceira), ao lado das `premium-site-rebuild` e
  `realtor-landing` que o David trouxe do Tomás. O GitHub do Fábio não tem skills; o do Tomás só tinha o kit imobiliário.
- **`site-scroll-infinito` é o padrão para qualquer site profissional** (18 out, pedido do Marco: «quando pedirem ao
  Claude para fazer um site profissional e bom, que seja assim»). Tirada de três TikToks (Levora, Mr. Day, DRIP): o scroll
  é uma viagem sem cortes (fotogramas num canvas ou mundo de camadas), faixas infinitas, produto que se desmonta, números,
  peças que caem, a cor que muda e a volta ao início. Motor `starter/js/scroll.js`, demo NORTE, `scripts/fotogramas.py`
  (vídeo → fotogramas) e `scripts/fotos.py` (screenshots no PC e no telemóvel). É a primeira da área Sites no
  `claude_contexto.py`; a skill do ramo (imobiliário, negócio local...) junta-se a ela para o conteúdo.
- **Sites no Hub** (18 out, Marco: «manda isso para o widget... como trabalho, para que todos consigam ver»): uma secção
  com `"kind": "sites"` no `company.json` lista as pastas com `index.html` (a da entrada, ou cada subpasta) e mostra-as
  num cartão com a imagem e o README; o visor abre o site dentro do Hub, como no PC ou como no telemóvel (`renderSites`
  / `openSite` no `app.js`, estilos `.sv-*` no `styles.css`). O Hub serve os ficheiros em
  `/api/hub/<empresa>/<secção>/site/<token>/<sid>/<caminho>` (o token vai no caminho porque as páginas pedem o css e as
  imagens por caminhos relativos) e manda o HTML com `Content-Security-Policy: sandbox`: o site corre noutra origem e
  nunca vê o login do Hub. A BareDesk tem `Sites` com o teste `teste-scroll` do repositório do tema: num PC sem ele,
  `git pull` no baredesk-theme.
- Armadilha: uma classe CSS chamada `.src` já existe no `design.css` (rebentou o layout); nas páginas novas, prefixar as classes.

### Fábrica Etsy (print-on-demand) — desde 20 out

Pedido do David a 20 out (um reel de agentes que correm lojas Etsy de print-on-demand): `#/etsy`
(`frontend/hub/etsy.js` + `.css`, `lazyView`), `backend/app/etsy.py` e `backend/app/routers/etsy.py` (`/api/etsy`). Skill
`pod-etsy` na biblioteca (área «Print-on-demand» do `claude_contexto.py`).

- **Um lote** = três `ask_claude` da Sala de Trading (`council.py`): **Riddler** com `WebSearch` (a Etsy dá 403 a pedidos de
  fora) devolve ideias com a prova de que vendem; **Catwoman** desenha cada uma em SVG (só tipografia e formas, fontes do
  sistema, sem `<image>`/scripts/links: `clean_svg` recusa) e o Chrome sem janela passa-o a PNG 4500 × 5400 transparente;
  **Joker** escreve título ≤ 140, 13 tags ≤ 20, descrição com o aviso de IA e preço. O **Alfred** é código (`BLOCKED`):
  marca de terceiros ou anúncio incompleto → «Barrados». ~1 min e ~0,35 $ (estimado, do plano) por desenho em Sonnet.
- **Nada é publicado sozinho** e **o dinheiro é só o registado** à mão («Entrou uma venda?») até haver app na Etsy Open API.
- Por PC, como a Sala de Trading: `~/.team-agent/etsy/` (`state.json` e uma pasta por desenho), nada vai por sync. «Ligar
  todos os dias» faz um lote por dia a partir da hora marcada no PC onde foi ligado, e avisa quem o ligou (`owner`).
- O Hub guarda o estado em memória: mexer no `state.json` à mão só com o Hub parado, senão a próxima gravação apaga a mudança.
- **A sala na cave** (`crew.js`, câmara «Etsy»): uma ilha `e` no `MAP` (x 14–17, y 13–16) entre a varanda do bar e o
  trading, com o painel das três estampas mais novas na cor da peça (`etsyWall`, carregadas uma vez do `/api/etsy/file`), a
  prensa (`PRESS`, acende quando a Catwoman desenha), as encomendas (`PARCELS`, uma caixa por desenho na Etsy) e a placa.
  Enquanto um lote corre, quem faz o passo trabalha no seu posto com o passo como missão (`etsyJobs` → `jobsOf`, tipo
  `etsy`) e passa ao seguinte. Clicar no painel ou na placa abre `#/etsy`.
- **«Reescrever anúncio»** (`POST /api/etsy/rewrite`, sem ids = todos os por aprovar e aprovados): o Joker volta a escrever.
  A 20 out o tom mudou a pedido do David («descrições que não pareçam AI»): 1.ª pessoa, frases normais, lista de
  expressões proibidas no `JOKER`, e o aviso de IA numa frase natural no fim (a Etsy obriga a dizê-lo).
- **No Mac o Hub arrancado pelo widget tem o PATH mínimo** (`/usr/bin:/bin`) e não via o `claude`: a Fábrica e a Sala de Trading
  ficavam sem Claude. O `council.claude_exe()` procura também em `/opt/homebrew/bin`, `/usr/local/bin` e `~/.local/bin`.

### Mercados (TradingView, SEC, paper trading) — desde 9 out

Pedido do David a 9 out (um reel de um «agente de trading do Claude» com dados de insiders, alertas e paper trading):
`#/mercados`, `frontend/hub/mercados.js` + `mercados.css` (carregados à primeira visita, `lazyView`) e
`backend/app/routers/trading.py` (`/api/trading/*`). Oito secções: Painel, Gráfico, Notícias, Insiders, Investidores, Paper
trading, Estratégias, Mapas (desde a simplificação, ver abaixo, quatro à vista e quatro em «Mais»). Nenhuma fonte precisa de chave:

- **TradingView**: preço, variação, sinal técnico (−1 a 1, os limites deles) e todos os indicadores de qualquer símbolo pelo
  scanner (`scanner.tradingview.com/global/scan` e `/symbol`), os movers (`america/scan`, `crypto/scan`) e as notícias
  (`news-headlines.tradingview.com`, por categoria ou símbolo). Gráfico, heatmaps, screener e calendário são os widgets deles.
- **SEC**: insiders de uma empresa (Form 4, o `.txt` de cada entrega) e a carteira 13F dos investidores (`INVESTORS`). Os
  insiders do mercado todo vêm do **OpenInsider** (uma página, 0,7 s): ler 90 Form 4 da SEC um a um demorava 37 s.
- **Paper trading**: `PaperTrade`, 80 000 $ virtuais, ao preço do TradingView convertido para dólares; a liga é da equipa.
  **Estratégias**: backtests no browser sobre velas diárias do Yahoo/Binance, sinal executado na abertura do dia seguinte.
- **Alertas e investidores seguidos** (`MarketItem`): o `trading.loop()` do Hub de cada PC vigia só os da sua pessoa
  (`sync.whoami`) e toca uma notificação. **Pergunta ao Claude** é um pedido `kind="markets"` para o agente de quem pergunta
  (`MARKETS_SYSTEM` no `agent.py`); sem agente ligado o Hub diz isso.

**Simplificada a 9 out a pedido do Marco** («demasiado completo e confuso», as notícias em inglês difíceis de ler). A equipa só
negoceia **ouro (XAU/USD), EUR/USD, GER40 e GBP/USD** (`FOCUS` no `trading.py`, `MK_FOCUS` no `mercados.js`: mudar nos dois):
- Separadores: **Painel** (os quatro em cartões com preço, variação, intervalo do dia e o sinal a 1 h · 4 h · dia; notícias de hoje;
  agenda; alertas), **Notícias**, **Gráfico** (pílulas dos quatro e «Outro símbolo») e **Paper trading**. Estratégias, Insiders,
  Investidores e Mapas continuam inteiros debaixo de **«Mais»**. A lista pessoal, os movers, a fita e os insiders do painel saíram.
- **Notícias em português** (`/api/trading/feed`, `news_feed()`): Reuters pelo TradingView em PT (`lang=pt`; o `/v3/story` dá
  os 3 pontos do resumo e o texto inteiro, lido dentro do Hub em `/api/trading/story`) e o Investing.com **Brasil** (RSS com
  foto; o pt.investing.com parou em 2023). As duas mesas são do Brasil: `ELSEWHERE` tira Ibovespa, real, Lula, Selic...; `topics_of`
  diz a que mercado é (as do dólar contam para ouro, EUR/USD e GBP/USD) e `same_story` junta a mesma notícia contada duas vezes.
  Notícia sem foto leva uma foto livre do mercado (`frontend/assets/mercados/`, Wikimedia Commons; `MK_PHOTOS` com o autor e a
  licença, e as CC BY mostram o crédito na foto). «Explica-me isto» pede ao Claude do agente a notícia em linguagem simples.
- **Agenda** (`/api/trading/calendar`): o JSON grátis da semana do ForexFactory, só dólar/euro/libra de impacto alto e médio,
  com os nomes em português (`calendar_title`). Só há a semana corrente: a seguinte aparece no domingo.
- O Google Translate grátis responde 429 e o Unsplash 403: não servem para traduzir nem para fotos.

Armadilhas que custaram tempo:
- **SQLite: nunca esperar pela rede com uma transacção aberta.** O `db.py` abre tudo com `BEGIN IMMEDIATE`; o `current_user`
  já começa uma. Os endpoints do `trading.py` usam `Depends(viewer)`, que larga o lock logo, e fazem `commit` antes de cada
  chamada lá fora — sem isso o Hub inteiro dava «database is locked» enquanto a SEC respondia.
- **iframes do TradingView ficam brancos** porque o Hub diz `color-scheme: dark`: `.mk .tradingview-widget-container
  { color-scheme: light }`. O calendário (`events`) não tem português: `locale: "en"`. Os índices (`SP:SPX`, `TVC:VIX`) não são
  grátis nos widgets e aparecem com «!»: na fita usam-se os CFD (`FOREXCOM:SPXUSD`...). O scanner dá-os na mesma.
- Os 13F escrevem os nomes cortados («BANK OF AMER CORP»): `by_name` expande abreviaturas e tenta palavras ordenadas e sem
  espaços. Alguns gestores ainda declaram em milhares: detectado pelo preço mediano por ação.

### A Sala de Trading (12 out, pedido do David)

`#/trading` (`frontend/hub/trading-room.js` + `.css`) e uma ala nova na cave. Não é a página Mercados (`routers/trading.py`,
`/api/trading`): esta é `routers/tradingroom.py`, `/api/trading-room`, e o motor está em `backend/app/tradingroom/`.

- **Dados, sem chaves:** velas do websocket dos gráficos da TradingView (`markets.tv_candles`: CFDs da OANDA em tempo real,
  XAUUSD, DE30EUR = GER40, NAS100USD, US30USD, mais EURUSD, GBPUSD, BTCUSD e o contexto DXY, US10Y, petróleo, VIX), o Yahoo
  quando falha; calendário económico da TradingView (com o valor saído); manchetes por símbolo (Reuters, Dow Jones).
- **Leitura SMC** (`smc.py`, `analysis.py`), em M5, M15, H1, H4 e D1: swings, BOS/CHoCH com o order block da perna, FVG e o
  quanto já foram preenchidos, liquidez (topos/fundos iguais, PDH/PDL, PWH/PWL, Ásia, Londres) e se foi varrida ou rompida,
  premium/desconto do range H4, killzones (horário de verão feito à mão: o Python deste PC não tem tzdata). O **modelo**:
  sweep de liquidez → CHoCH/BOS ao contrário em ≤ 20 velas → FVG (ou OB) dessa perna para entrar, stop além do sweep, alvo
  na liquidez do outro lado. Nota de 0 a 100 (A+, A, B) com o porquê.
- **Os dois agentes** são personagens da cave (`CREW` no `crew.py` e no `crew.js`, papel `custom`): o **Pinguim** (notícias e
  macro) e o **Duas-Caras** (gráfico). Os fatos estão em `crew-people.js` (`LOOKS`: cartola, monóculo, metade queimada).
  **Reunião** (`council.py`): o Pinguim abre, o Duas-Caras responde, o Pinguim fecha com uma ata em JSON (título,
  importância 1–5, alerta, foco com zona/stop/alvos, atenção). Com o Claude ligado cada fala é um `claude -p` sem
  ferramentas, sem hooks (`--setting-sources project` numa pasta vazia) e sem sessão guardada, a correr o `claude.exe` direto
  (o `.cmd` do npm passa por cmd.exe e estraga o prompt). ~80 s e 3 chamadas Sonnet por reunião.
- **O Claude é por PC** (interruptor na página, `~/.team-agent/trading-room/state.json`, desligado por omissão): gasta o plano
  desse PC. Desligado, a reunião é escrita a partir dos números. Máximo `cap` (16) reuniões Claude por dia.
- **Quando se reúnem** (`room.triggers`): antes de Londres e da killzone de Nova Iorque, 12–25 min antes e 1–15 min depois de
  uma notícia de alto impacto (USD, EUR, GBP), e quando aparece um evento de peso ≥ 4 (sweep de PDH/PDL/PWH/PWL, CHoCH H4,
  setup A/A+). Intervalo de 20 min (8 para notícias e pedidos à mão). O primeiro ciclo depois de arrancar não dispara nada.
- **O aviso grande** (`trading-alert.js`, sempre carregado, minúsculo): quando a ata diz `alerta`, aparece em qualquer página
  e no widget, com o gráfico a desenhar-se por trás, a fita de cotações, zona/stop/alvos e o que cada um disse; e vai para os
  telemóveis (web push). Nunca o mesmo instrumento duas vezes em 90 min, nem dois avisos em 20 (salvo importância 5).
  «Ver o aviso» na página mostra um ensaio só no ecrã.
- **Na cave:** uma ilha `x` no `MAP` (x 18–24, y 13–16) ligada ao miradouro, com uma parede de três ecrãs a mostrar o
  XAUUSD, EURUSD e GER40 ao vivo (`tradeWall`, dados do `/api/trading-room/pulse`), as secretárias dos dois com velas em vez
  de código, o touro de ouro, a fita LED à frente e a placa «AMG Capital». Numa reunião os dois vão para o corredor
  (`MEET`) e dizem o que disseram de verdade, aos bocados. Câmara «Trading». Clicar na parede, na placa ou no touro abre a sala.
- **Armadilhas:** um `onLive` tem de devolver uma promessa (o `refresh` do `app.js` faz `fn().catch`): uma função que devolve
  `undefined` rebenta e cala os seguintes. Os retratos dos dois na sala são guardados como imagem (`faces`): um frame da cache do
  `crew-people.js` pode voltar em branco. Os endpoints fecham a transação do `current_user` antes de esperar pela rede (`viewer`).
- **Cada um tem a sua conta** (12 out, `book.py`): nas falas 1 e 2 cada agente responde em JSON com as suas `trades` (entrada
  limite, stop, 1 ou 2 alvos, validade, porquê), as que quer `fechar` e as `revisoes` das que fecharam (o diário de cada um vai
  no briefing, com os ids «por rever»). O Hub confere (stop e alvo do lado certo, entrada a ≤ 4 ATR H1, stop entre 0,15 e 6
  ATR, RR ≥ 1, máximo 2 novas e 4 ativas, nada repetido) e as recusadas ficam na tabela com o motivo. Segue cada trade vela a
  vela (M5, e H1 para o que o M5 já não cobre): na mesma vela stop e alvo contam como stop; na vela da entrada só o stop; com
  2 alvos fecha metade no 1.º e o stop vai para a entrada; 72 h abertas fecha ao preço. Resultado em R menos o spread típico
  (`spread` em `INSTRUMENTS`). Boa = ganha, má = perdida. O **Modelo SMC** abre uma trade por cada setup A/A+ armado
  (referência). Estatística por agente em `Book.stats` (acerto, R total, % da conta a 1% por trade, profit factor,
  expectativa, drawdown, série, curva). Página: placar dos três por baixo do radar, «Diário de trades» com filtros (clicar numa
  linha abre o porquê, a revisão, MFE/MAE), as trades no gráfico, os chips na fala. Cave: o placar de cada um na secretária.
- **Cada trade com plano** (12 out, pedido do David: «não percebo quando era a entry perfeita e se já perdi a trade»): o
  agente escreve o `plano` (o que esperamos que o preço faça antes e depois da entrada), a `zona`, o `gatilho`, a `janela`
  (hora ideal em hora de Lisboa, `book.window`; se já passou hoje, é amanhã) e o `invalida` (fecho além dele antes da entrada
  = `invalidated`). O briefing traz as killzones do dia em hora de Lisboa. `Book.now` diz em palavras onde está cada trade e
  `can`: `yes` (ainda dá), `late` (entrou mas o preço está junto à entrada), `in` (já andou: perdeste a entrada), `no` (acabou);
  e guarda a entrada perfeita vista depois (`best`, `best_at`). Página: «Trades em jogo agora» (um cartão por trade, com
  «HORA IDEAL AGORA»), a zona e a hora ideal desenhadas no gráfico, o plano nos chips da reunião e no aviso grande. O gatilho
  é para quem lê: no papel o Hub entra quando o preço toca na entrada.
- **Fontes mais finas** (12 out): o Pinguim pesquisa na web na fala 1 (`--tools WebSearch`, máx. 4, as `fontes` aparecem
  por baixo da fala); COT da CFTC (`institutional.py`, API pública, de 6 em 6 h: managed money no ouro, leveraged funds e
  asset managers nos financeiros, índice COT de 3 anos; o DAX não tem); juros a 2 anos EUA/Alemanha/Reino Unido, juro real
  e inflação implícita (FRED, pelo websocket da TradingView: o fred.stlouisfed.org não responde nesta rede), S&P 500,
  USD/JPY, correlações de 20 dias; e a leitura clássica (`technicals.py`: EMA 21/50/200, RSI e divergências, ADR gasto,
  perfil de volume da sessão anterior). Tudo isto entra no briefing e no painel «Contexto institucional» da página.
- **Backtest do Modelo SMC** (13 out, pedido do David: «ele não faz backtest»): `tradingroom/backtest.py` repete o passado
  vela a vela (M5, ~4 semanas: 5000 velas da TradingView) com a mesma leitura (`analysis.analyse`) e a mesma conta
  (`Book`, ordem de `room.model_trade`). `Replay` só mostra o que se sabia a cada minuto: velas fechadas e, nos gráficos
  maiores, a vela em curso feita das M5 já fechadas. Só o modelo: os dois agentes e o filtro de notícias não se repetem.
  O Hub corre-o noutro processo, com prioridade baixa (`backtest.start`, ~5 min; no mesmo processo parava o Hub);
  resultado em `~/.team-agent/trading-room/backtest.json`, `GET/POST /api/trading-room/backtest`, painel por baixo do
  diário. À mão: `python -m app.tradingroom.backtest` em `backend/`. De caminho, o `Book._step` deixou de contar duas
  vezes a última vela (`fill_bar`, `half_bar`): dava o alvo na vela da entrada e parava a 2.ª metade na vela do 1.º alvo.
- **Reação à notícia** (14 out, pedido do Kovel depois do CPI): `tradingroom/reaction.py`, `GET /api/trading-room/reaction`,
  painel por cima do calendário. Para a notícia dos EUA em jogo (CPI core, NFP, PPI, vendas a retalho, PCE core, Fed; a que
  saiu nas últimas 4 h, senão a próxima em 36 h) mostra como o ouro, o EUR/USD e o GER40 se mexeram nos primeiros 5 min em cada
  saída desde 2018, conforme o número veio acima, abaixo ou igual à previsão, e se o ouro voltou ao preço de antes. Depois da
  saída lê o ouro de minuto a minuto na Binance (XAUUSDT) e mostra as 4 saídas passadas com o caminho mais parecido e o que
  fizeram a seguir. O mesmo texto entra no briefing do Pinguim (`reaction.brief_text`). O histórico são JSON em
  `tradingroom/reaction_data/<evento>.json`, feitos no repositório news-reaction do Kovel (`python newsreact.py export cpi`,
  velas de 1 min da Dukascopy); um evento sem ficheiro simplesmente não aparece.
  **15 out (pedido do Marco: «quero ver»):** a secção está sempre à vista logo a seguir aos mercados (sem notícia em jogo, a
  próxima da semana ou só o histórico), com abas por notícia (`?key=` no `/reaction`, `reaction.browse`) e três cartões «se sair
  abaixo / acima / igual». GBP/USD entra (a coluna só aparece quando o JSON a tem). A placa AMG Capital na cave (`newsLine`, campo
  `news` do `/pulse`) e uma faixa «Notícias» por baixo das portas do Escritório (`newsDoor`) dizem a próxima notícia e o ouro.
  O briefing só fala da notícia a ≤ 36 h (`far`). **Os JSON das outras notícias** são feitos no PC do Marco por
  `~/.team-agent/news-reaction/fetch_all.py` (clone do news-reaction com GBPUSD em `SYMS`): ouro primeiro, depois EUR/USD, GER40,
  GBP/USD; a Dukascopy só dá um ficheiro de cada vez (25–50 s, em paralelo recusa), por isso demora muitas horas. Cada evento é
  publicado sozinho (commit + push só desse ficheiro) quando tem ≥ 20 saídas com ouro e nunca menos do que o que já está no git.
  Se o PC reiniciar, correr outra vez `python -u fetch_all.py` nessa pasta: retoma onde parou (log em `fetch.log`).
- **Escrever código destes ficheiros pelo Bash** (heredoc): as barras invertidas chegam mal ao ficheiro (`\\p{L}` virou
  `\p{L}`). Para texto com `\`, usar a ferramenta de editar ou um script escrito com ela.
- **Segundo modelo: VWAP + EMA** (17 out, pedido do David: «só os melhores setups, profissionalismo máximo»):
  `tradingroom/vwap.py`. VWAP do dia ancorado às 17:00 de Nova Iorque (o dia do forex e da vela D1 da OANDA; ao fim de
  semana, o dia da última vela, senão vinha vazio) com desvios de 1σ e 2σ ponderados pelo volume, e as EMA 9/21/50 do
  M5/M15. O setup é um pullback a favor da tendência: H1 com tendência, EMA 9 > 21 > 50 (ou o contrário), ≥ 7 das últimas
  10 velas do lado certo do VWAP e o VWAP a inclinar com elas, VWAP e EMA 21 a ≤ 0,6 ATR uma da outra, e uma vela que
  entra na zona e fecha fora dela a favor. Entrada no reteste da borda da zona, stop além do extremo do pullback, alvo na
  liquidez intacta do lado da tendência (senão a banda de 2σ), RR ≥ 1,5. **Só sai do módulo com A ou A+** (≥ 70): H4 a
  favor, confluência apertada, pavio de rejeição, 1.º reteste desde que cruzou o VWAP e killzone de Londres/NY somam;
  contra o H4, fora das killzones, ≥ 80% do ADR gasto, M5 e notícia a ≤ 60 min tiram (a notícia tira 15, o que basta para
  o deitar fora). Os setups levam `kind` (`smc`/`vwap`) e `key`: o `seen`, o Modelo e o backtest usam
  `model:<id>:<key>`, que para o SMC é igual ao formato antigo. O SMC ganha +5 quando o sweep acontece fora dos 2σ do
  VWAP. O briefing traz o VWAP e as EMA em M15 na leitura clássica, e o Duas-Caras sabe dos dois modelos. Página:
  camadas «VWAP» (linha e bandas, ligada) e «EMA 9/21/50» (desligada) no gráfico, e o rótulo SMC / VWAP + EMA em cada
  cartão de setup. Testes em `tests/test_vwap.py`.
- **Terceiro modelo: inside bar D1** (17 out, pedido do David: «encontra uma só strategy que resulte melhor e tenha mais
  win rate»). Saiu de um estudo de 2676 combinações (10 padrões clássicos × parâmetros × XAUUSD, EURUSD, GBPUSD, GER40,
  NAS100, US30; velas OANDA da TradingView: D1 desde 2006, H4 desde 2023, H1 desde 2025; spread pago; escolhido em
  2006–2019 e confirmado em 2020–2026). No ouro: 289 trades em 20 anos, 67% ganhas, PF 1,96, 16 de 21 anos positivos; 70% e
  PF 2,32 nos anos de confirmação. `tradingroom/insidebar.py`, só XAUUSD e NAS100 (no EURUSD, GER40 e US30 não aguentou):
  inside bar ontem, EMA 50 vs 200 do D1 decide o lado, ordem stop no rompimento só hoje (dia que rompe os dois lados não
  conta), stop no outro lado da vela-mãe, alvo 1R, até 20 dias. Para isto o `book.py` ganhou `ordem: stop` (entra quando o
  preço sobe/desce até lá; num gap, à abertura), `swing` (entrada e stop medidos em ATR D1: entrada ≤ 1,5, stop 0,2–3) e
  `max_h` por trade (o fecho por tempo de 72 h é só o normal). Intradiário H1 não deu nada robusto: a TradingView sem
  login só dá ~10 000 velas H1, a Dukascopy aceita um ficheiro de cada vez (~27 s) e a HistData recusa downloads por script.
- **Filtros medidos no SMC** (17 out): o backtest da sala com cada trade etiquetada mostrou o que separa as boas: vender
  em premium e comprar em desconto (+36,8 R contra −17 R), dentro de killzone (+27 R contra −7 R) e RR ≥ 1,5 (abaixo, −9 R).
  No `_score` um setup que falhe uma delas fica no máximo em B (sem trade nem aviso); a killzone não conta para cripto.
  Backtest antes → depois: 201 trades, 26% ganhas, +19,8 R, PF 1,12, DD 27 R → 92 trades, 33%, +44,8 R, PF 1,61, DD 17 R.
  Atenção: nessas 4 semanas as trades contra o H4/D1 renderam mais, ao contrário dos 20 anos; não se mudou nada por isso
  (um mês em viragem não chega). Testes em `tests/test_insidebar.py`.

- **Quarto modelo: EMA 125/200 e uma conta por estratégia** (19 out, pedido do David: o Pinguim e o Duas-Caras não tinham
  histórico nenhum; «mais duas análises e verificação: EMA 125 + 200 em vários tempos gráficos, VWAP, ou combinar»). Os dois
  só fazem trades nas reuniões com o Claude ligado; neste PC está desligado, por isso nunca tiveram nenhuma (o painel do robô
  diz isso agora). `tradingroom/ema.py`: tendência = preço > EMA 125 > EMA 200 e a 200 a subir (ao contrário na venda); entra em
  M15 (com o H1 na mesma tendência, o H4 soma) ou em H1 (com o H4); pullback à faixa entre as duas EMA rejeitado, entrada no
  reteste da 125, stop além do extremo e da 200, alvo na liquidez ou 2R; só A/A+. A EMA 200 precisa de história: a loja pede
  800 velas de M15/H1/H4 (`markets.LONG`) e o `Frame` guarda-as em `.long`, mas as leituras SMC continuam nas 300 de sempre.
  Cada setup leva `agree` (EMA 125/200 do H1, VWAP do M15, estrutura H4 a favor). `room.takers` diz que contas o tomam: o
  Modelo (SMC, VWAP, inside bar, como antes), `ema`, `vwap` e `combo` (só quando as três leituras concordam). Três robôs novos
  na equipa «Estratégias» (lugares 6–8). O backtest corre todas as contas (`agents` e `more` no `backtest.json`; `trades`
  continua só o Modelo) e o painel do robô mostra o backtest da estratégia nos instrumentos dele. 1.º backtest (28 dias, 19 out):
  Modelo 90 trades 32% +45 R; VWAP 7 trades +9 R; Combinado 3 trades +10 R; EMA 125/200 5 trades, 0 ganhas, −5,5 R. Amostras
  pequenas demais para concluir: 4 semanas de M5 dão poucos setups de H1. Testes em `tests/test_ema.py`.

### Escritório de Robôs e as contas FundedNext (15 out, pedido do Marco)

`#/robos` (página «Robôs»), 2.º separador da Sala de Trading (`frontend/hub/robots.js` + `.css`; no telemóvel em «Mais»), `/api/robots`
(`backend/app/routers/robots.py`) e o motor em `backend/app/tradingroom/robots.py`. Inspirado num reel (um escritório 3D de robôs
de trading a operar contas de prop firm), **nas cores do Hub** (preto e cromado; verde/vermelho só no dinheiro, azul AI numa
ordem à espera): o Marco disse que o amarelo do vídeo não é para copiar. A equipa faz **forex/CFD day trading** (XAUUSD,
EURUSD, GBPUSD, GER40), **não futuros**: a Lucid Trading (futuros, Tradovate) ficou de fora a pedido dele.

- **Robôs** (`robots.json` em `~/.team-agent/trading-room/`, por PC): cada um é um agente do livro (`book.py`) filtrado aos seus
  instrumentos. Por omissão seis: o Modelo SMC num robô por instrumento (equipa «SMC») e o Pinguim e o Duas-Caras («Mesa
  Claude»). Sem conta negoceiam em papel (o R do livro × o risco do robô numa conta de 100 000 $). Escritório isométrico em canvas
  (~20 imagens/s, só com a página aberta): mesas em grupos de quatro (`PODS`), a etiqueta de cada equipa no chão com o dinheiro do
  dia, o ecrã grande na parede com o saldo e os quatro instrumentos, a sala de descanso (snooker, sofá) para quem está fora de
  horas ou desligado. Clicar num robô abre o painel: equity, resultado do dia, curva e drawdown, melhor/pior, operações, últimas
  trades, «Mudar de lugar» (troca de mesa), «Personalizar» (nome, equipa, cor) e as definições (ligado, conta, risco %, máx.
  trades/dia, horário, hora de fecho, estratégia, instrumentos). Peso medido: 7–9% de um núcleo com a página aberta.
- **Contas por API, nunca à mão** (`LINKS`): a **API oficial do MetaTrader 5** (`tradingroom/mt5.py`, pacote `MetaTrader5`, que
  fala com o `terminal64.exe` instalado neste PC: entra com login/password/servidor, ex. `FundedNext-Server`; a prop vê o IP do
  PC, como se fosse a pessoa) ou a **MetaApi** (`tradingroom/metaapi.py`, REST na cloud: token + id da conta, a prop vê o IP
  deles). O pacote MT5 não é thread-safe: tudo passa por uma thread só (`mt5.run`). O terminal tem de estar instalado (instalado
  no PC do Marco a 15 out, `C:\Program Files\MetaTrader 5`) e abre-se sozinho quando a conta liga; o «Algo Trading» tem de
  estar ligado nele. Os nomes dos símbolos da corretora (`XAUUSD.r`, `GER40.cash`...) acham-se sozinhos (`ALIASES`) ou
  mapeiam-se à mão na conta. Os preços das ordens vêm do feed da sala (OANDA) e são deslocados pela diferença para a corretora
  nesse momento (`gap`).
- **Segredos**: password e token só em `contas.json` neste PC, cifrados com DPAPI para o utilizador do Windows (`_seal`); nunca
  na base de dados, nunca no sync, nunca devolvidos à página. Guardar uma password, mudar o modo ou apagar uma conta só se faz
  do próprio PC ou do telemóvel dele pelo Tailscale (`_here`), não de outro PC do Radmin.
- **Modos**: «Observar» (por omissão: lê saldo, posições e deals, não envia nada) e «Automático» (pedido de confirmação na
  página). Em automático, cada trade nova do robô (só as criadas depois de ligar, `armed_at`) vai para a conta: limite (ou mercado
  se o livro entrou a mercado há < 2 min) com stop e o 1.º alvo, volume para perder `risco %` do saldo no stop (`size`), validade
  até à hora de fecho do robô, `magic` próprio de cada robô (é por ele que se sabem as posições e o dinheiro de cada um) e
  comentário `AMG <robô> <id>`. A ordem é cancelada quando a trade do livro acaba (expirou, invalidada) e a posição fecha quando o
  agente a fecha. Máx. trades por dia por robô.
- **Day trading**: fora do horário do robô (hora de Lisboa) nada abre; à hora de fecho (`flat`, 21:30 por omissão) e na
  sexta a partir das 15:30 de Nova Iorque as ordens e posições dos robôs na conta são canceladas/fechadas.
- **Guarda da prop** (`guard`, `PRESETS`: Stellar 2-Step 5%/10%, 1-Step 3%/6%, Lite 4%/8%; confirmar no painel da FundedNext): o
  dia de trading começa às 17:00 de Nova Iorque (`day_start`), a perda diária conta do maior entre saldo e equity a essa hora, a
  máxima do saldo inicial (`size`). Sem ordens novas a `stop_at` (70%) de qualquer limite; a `panic_at` (90%) fecha tudo dos
  robôs. Também pára com o objetivo da fase atingido. Botão vermelho «Fechar tudo dos robôs» por conta (e volta a Observar).
- **Afinação dos setups** (`tuning`): as trades fechadas da sala e do backtest por instrumento × sessão (Ásia, Londres, Pré-NY,
  Nova Iorque, Tarde NY), por nota (A+, A, B) e por agente, com dicas (sessões que perdem/rendem, setups B a evitar).
- **Calculadora de lote** nas Contas (pela especificação real do símbolo na conta).
- **Testar sem dinheiro**: um adaptador falso em `LINKS` (snapshot/place/cancel/close) e `OFFICE.sync_account` com
  `TRADING_ROOM_DIR` numa pasta de teste; nunca ligar uma conta real para testar.

### Painel FundedNext (21 out, pedido do Marco)

`#/fundednext`, separador da Sala de Trading (`frontend/hub/fundednext.js` + `.css`), `/api/fundednext`
(`backend/app/routers/fundednext.py`), cálculo em `backend/app/tradingroom/fundednext.py`, testes `tests/test_fundednext.py`.
«Como o dashboard da FundedNext, só que muito mais organizado, o máximo de funcionalidade.» A conta é a do Escritório de
Robôs (`robots.OFFICE`), lida pela API do MT5 deste PC.

- **Sem password no Hub** (`mt5._attach`, `mt5.detect`): uma conta MT5 sem password guardada (`attach`) usa a conta em que o
  terminal está (a pessoa entrou no MT5 com «Guardar password»); o Hub só confere o número. «Apanhar a conta do MT5»
  (`POST /detect`) cria a conta sozinha se o servidor for da FundedNext. Nunca escrever a password de ninguém por ele.
- **Fases** (`PHASES` no `robots.py`, `phase_of`): Fase 1/Fase 2/Financiada por programa, com o objetivo e os dias mínimos.
  O tamanho da conta vem do 1.º depósito (`size_set` quando a pessoa o escreve). O stop e a meta do dia da pessoa
  (`my_stop`, `my_goal`, % do tamanho) entram no `guard()`: os robôs também param.
- **Histórico** (`mt5.history`): todos os deals desde o início, com o stop de cada posição (das ordens) e o fuso do servidor
  (`server_offset`: tick fresco, senão Nova Iorque + 7 h). O dia de trading é o dia do servidor (meia-noite = 17:00 NY).
  Lido no máximo de 30 em 30 s. A equity fica guardada de 5 em 5 min em `robots.json` (`eq`).
- **Ticket** (`mt5.order`, magic 7701): mercado/limite/stop, sempre com stop, lote pelo risco % ou à mão; o Hub recusa a
  ordem cujo stop passe o que ainda se pode perder hoje. Posições: fechar, metade (`close` com volume), stop na entrada
  (`mt5.modify`); ordens: cancelar; «Fechar tudo» fecha tudo da conta (dele e dos robôs) e volta a Observar. Tudo isto só
  do próprio PC ou do telemóvel dele (`_here`).
- **Página** no padrão do `docs/hub-paginas.md`: números em cima, objetivos da fase, saldo/equity com os chãos, posições,
  ticket, «Quanto queres arriscar?», dia a dia (calendário), estatística, diário, robôs da conta, notícias vermelhas,
  recompensa (financiada) e regras. Num ecrã estreito as duas colunas viram uma, com posições, ticket e plano primeiro (`--o`).
- **Testar sem conta**: um Hub de teste que troca as funções do `mt5` por falsas antes de importar `app.main` (como em
  `tests/test_fundednext.py`); nunca ligar uma conta real para testar.

### Reforço na notícia (18 out, pedido do Kovel)

`#/reforco`, 3.º separador da Sala de Trading (`frontend/hub/reforco.js` + `.css`), `/api/reforco` (`backend/app/routers/newsadd.py`),
motor `backend/app/tradingroom/newsadd.py`, testes `tests/test_newsadd.py` (conta MT5 falsa). Numa notícia dos EUA o trader abre a
posição principal à mão no MT5 (1,5% da alocação de 50 000 $; a página mostra o lote até ao stop na banda). Antes carrega em
**Start**: o Hub espera pela posição manual (magic 0) no instrumento e põe uma **escada de ordens limite** no mesmo sentido entre o
preço e a banda da VWAP do outro lado (venda: acima da banda de cima; compra: abaixo da de baixo), o mesmo risco em cada ordem, por
isso o lote cresce perto do stop; 0,5% no total. Stop além da banda 1σ (verde) + folga; se o preço já a passou, a 2σ, depois a 3σ.
TP: a mediana do movimento a favor na 1.ª hora nas notícias passadas desse tipo (`reaction_data/`), senão 0,5% da entrada dele.
A posição dele nunca é tocada; o que não encheu é cancelado quando ela fecha, no Stop ou ao fim de `window` min; os reforços cheios
ficam com o seu stop/TP («Stop e fechar reforços» fecha-os). VWAP de sessão (17:00 NY) das velas M1 da própria corretora, agrupadas no tempo gráfico do TradingView dele (15m por omissão, `tf`): os valores batem com o OANDA:XAUUSD do TradingView a 0,5–3 $ (até 7 $). Backtest em news-reaction `research/reforco_2026-10-18` (18 out): a ideia perde desde 2018 (−83 000 $ em 50k com reforço). Magic 7700.
Respeita a guarda da prop do Escritório. Corre só no PC com a conta MT5 (o do Marco): noutro PC a página manda abrir o Hub dele.
Estado em `~/.team-agent/trading-room/reforco.json`. Pesquisa por trás: memória «news-reaction» (VWAP após notícias).

### Sinal na notícia (21 out, pedido do David)

`#/sinal`, 2.º separador da Sala de Trading (`frontend/hub/sinal.js` + `.css`), `/api/sinal` (`backend/app/routers/sinal.py`), motor
`backend/app/tradingroom/sinal.py`, testes `tests/test_sinal.py`. «Durante a notícia quero ver logo BUY ou SELL com o número que saiu,
sem atualizar o Forex Factory.» **Todas as notícias vermelhas (impacto alto) de qualquer moeda** (USD, EUR, GBP, JPY, AUD, NZD, CAD,
CHF, CNY) das páginas da semana atual e seguinte do Forex Factory; discursos e conferências ficam de fora (não têm número).
**Velocidade**: a partir de 2 s antes do minuto, 4 ligações mantidas à TradingView e 5 à página do dia do Forex Factory com pedidos
ao mesmo tempo (`Pool`/`pump`: `select` sobre os sockets, sem threads), ~15 respostas por segundo no total. É o máximo: medido a
21 out, acima de ~10/s a TradingView responde 429 e o Forex Factory não dá mais de ~8/s; num 429 esse site pára 2 s e abranda.
As ligações abrem-se a −32, −22 e −12 s (`warm`). A página do dia do Forex Factory segue o fuso de quem a pede: o `warm` procura
o dia certo. Uma linha da TradingView só conta para uma cifra do Forex Factory com o mesmo país, minuto, valor anterior e previsão
(`match`); sem certeza, só o Forex Factory. Compara sempre com a **previsão do Forex Factory**. Um minuto pode trazer várias moedas
(NFP e o emprego do Canadá): cada uma é uma parte com o seu par e o seu BUY/SELL (`parts`). Direção: notícias dos EUA com
histórico (`reaction_data/`) = o que o ativo fez nos primeiros 5 min nas saídas iguais, e também nas com surpresa deste tamanho
ou maior (`big`); menos de 60% = NO TRADE. O resto = a regra da moeda (acima = a moeda sobe; desemprego e pedidos de subsídio ao
contrário) no par contra o dólar (`PAIR`: USD/JPY, USD/CAD e USD/CHF ao contrário). Nas dos EUA a pessoa escolhe Ouro, EUR/USD,
GER40 ou GBP/USD (`localStorage`). Aviso grande em qualquer página (`sinal-alert.js`, evento live `sinal`), som, e **push para o
telemóvel** (`room.phones`). **Ensaio**: o último CPI core com o relógio deslocado (sai 15 s depois do botão). Diário em
`~/.team-agent/trading-room/sinal.json`, nada vai por sync.

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

**On a Mac** (`mac/`): `mac/build.sh` builds `Agente AMG.app` (the star in the menu bar plus the Hub in its own window),
installs it in `/Applications` and copies `mac/widget_mac.py` to `~/.team-agent/mac/`. That launcher runs the same
`widget/` from its own clone in `~/.team-agent/mac/team-agent` (with a `venv` there) and patches only what differs on
macOS: no Dock icon, no screen sampling, the star toggles the panel, and every widget window follows you to every
desktop (Space) and over full-screen apps. Like every PC, the Mac runs its own Hub on `127.0.0.1:8000` (the widget
starts it, `~/.team-agent/hub.db`), signs in as the `user` of `widget.json`, is sync
node 3, and trades changes over Tailscale with the Hubs in `widget.json`'s `"sync_peers": "100.x.x.x:8000"` (no Radmin).
Mac-only fixes go in `widget_mac.py`, not in `widget/`.

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
- **Uma página nova ou mexida segue `docs/hub-paginas.md`** (21 out, o Hub todo arrumado a pedido do Marco: «muito organizado, como uma obra de arte, funcional a sério»; a skill `hub-pagina` da biblioteca aparece sozinha nesses pedidos). A barra tem cinco secções numeradas (`SECTIONS` e `NAV` no `app.js`: 01 Comando, 02 Agentes, 03 Negócios, 04 Trading, 05 Sistema); o Ctrl+K (`allCommands` no `shell.js`) e o «Mais» do telemóvel (`openMore` no `mobile.js`) leem a mesma lista, e o `ui.head` põe a secção por cima de cada título. Cabeçalho sempre `ui.head`, nada de cabeçalhos dentro de cartões.
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
