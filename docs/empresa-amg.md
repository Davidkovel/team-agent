# O Agente AMG como empresa de agentes

Decidido com o Marco a 6 de outubro de 2026. Este é o rumo para quem mexer no team-agent (pessoas e Claudes):
tudo o que se constrói deve levar até aqui. As decisões curtas estão também na Memória do Hub (categorias EMPRESA e REGRAS).

## A visão

O Agente AMG deixa de ser só um widget e um Hub: passa a ser **uma empresa de agentes**. O Marco está no topo com a
**visão de Deus**, a ver e a controlar tudo; o Kovel e o David são sócios e veem o mesmo.

```
                 Marco (visão de Deus) · sócios Kovel e David
                                  │
             AGENTE AMG: a sede (widget + Hub + telemóvel)
  ┌───────────┬────────────┬─────────────┬────────────┬─────────────┬───────────────┐
Pesquisa    Código       Design        Marketing    Revisão       Empresas
pesquisador explorador   designer-hub  marketing    revisor-hub   um agente por empresa
```

- **Tudo vive dentro do Agente AMG.** O Hub é a sede: liga os 3 PCs, tem as tarefas, a Memória (o cérebro partilhado),
  as aprovações, as notificações e a app no iPhone, e já comanda o agente automático de cada um. O widget é a sala de
  comando; o telemóvel é o comando no bolso. Não se cria outra app ao lado.
- **Cada Claude aberto é um diretor**: recebe o pedido e distribui o trabalho pelos departamentos (os agentes em
  `.claude/agents/`).
- **A empresa cresce sozinha**: os agentes leem a Memória e a biblioteca de cada empresa; cada empresa nova ganha um
  agente próprio; um tipo de trabalho que se repete pela terceira vez dá uma proposta de agente novo ao Marco.

## As fases

1. **Visão de Deus (2D).** O **Escritório**: uma mesa por cada Claude aberto nos 3 PCs (de quem é, projeto, estado:
   a trabalhar / à espera de resposta / parado, o que lhe pediram, o que está a fazer agora), os subagentes que lançou
   (qual, modelo, o que lhe pediram, resultado) e o filme do dia. O painel **Saúde** mostra quanto o Agente AMG gasta
   em cada PC. Os dados vêm dos hooks do Claude Code de cada PC, que avisam o Hub desse PC; a sincronização leva-os aos outros.
2. **Controlo.** Dar uma ordem a um departamento a partir do Hub (vira uma tarefa para o agente certo, no agente
   automático da pessoa), pausar, parar, aprovar. Agentes que crescem sozinhos. As janelas do Claude Code continuam a ser
   onde cada um fala diretamente com o seu Claude: veem-se no Escritório, mas as ordens vão para o agente automático.
3. **3D.** O mesmo escritório em 3D: cada departamento uma sala, cada agente uma personagem na sua mesa, que se mexe
   quando trabalha. O 2D e o 3D desenham **o mesmo registo**, por isso o que se faz na fase 1 não se perde.

## Regras de peso (para nunca deixar os PCs lentos)

Isto vai sempre crescer, como uma bola de neve. Não vai ser possível ser leve em tudo, mas a organização tem de ser a
melhor possível. Três camadas, cada uma com o seu limite:

| Camada | O que faz | Regra | Limite parado |
|---|---|---|---|
| **Motor** (Hub, em segundo plano) | guarda e sincroniza | guarda o **estado**, não cada passo (um Claude com 500 passos é uma linha que se atualiza); sincroniza só o que mudou; limpa o histórico velho | < 1% de CPU |
| **Widget** (o painel pequeno) | resumos e alertas | nunca o escritório inteiro; só anima quando algo muda | < 1% de CPU |
| **Central de comando** (a janela grande) | tudo o resto | só trabalha aberta (fechada congela); **cada secção carrega só quando se entra nela**; o 3D abre em janela própria e só desenha quando algo mexe | < 3% de CPU aberta e parada |

- Cada novidade é **medida antes do push** (CPU e memória do widget, do Hub e da janela grande). Se pesar, não entra.
- Medido a 6 out 2026 no PC do Marco (12 núcleos): widget 6,3% do PC (a animação do painel), Hub 0,6% e 94 MB,
  janela grande minimizada 0% e 166 MB.
- 7 out 2026 (cecde17): o widget parado passou a 0% (0 imagens por segundo); as animações decorativas tocam ~5 s depois
  de uma mudança (o painel abre, alguém fica online ou offline, o estado muda), a ~166 imagens por segundo, e param.

## Quando ficar enorme

Com agentes a trabalhar 24 horas, muito histórico e 3D pesado, a sede passa para **um computador sempre ligado**
(um mini-PC ou um servidor na nuvem, ligado pelo Tailscale como o iPhone), que faz o trabalho pesado; os PCs ficam só
com o ecrã. A arquitetura acima (um registo, secções independentes) deixa fazer essa mudança sem refazer nada.

## O que já existe (6 out 2026)

- **Escritório** (menu do PC, a seguir ao Início; telemóvel em Mais): uma mesa por cada Claude aberto nos 3 PCs, os subagentes
  de cada um, os departamentos acesos e o filme do dia. Dados: `scripts/claude_hook.py` (hook async do Claude Code, só nomes e ids)
  → `POST /api/local/claude` → tabelas `claude_sessions` e `claude_agents` (estado, nunca cada passo) → sync → `GET /api/office`.
  O Hub instala os hooks sozinho em `~/.claude/settings.json` ao arrancar (`backend/app/claude_hooks.py`; `CLAUDE_OFFICE=0` tira-os).
- **Saúde** (Sistema; telemóvel em Mais): cada Hub mede-se de minuto a minuto (Hub, widget, janela grande) com as contas do
  Windows (`backend/app/health.py`), tabela `pc_health` sincronizada.
- **My Niggaz** (menu do PC, a seguir ao Escritório; telemóvel em Mais, a toda a largura): a Batcave da equipa, em pixel art
  isométrica (`frontend/hub/crew.js` + `crew.css`), com uma câmara que vai do escritório à garagem (Escritório · Garagem · Tudo,
  ou arrastar). **Os agentes são personagens do Batman** e cada um tem um papel: Batman (código), Lucius Fox (engenharia),
  Riddler (pesquisa), Catwoman (design), Joker (marketing), Alfred (revisão), Robin (testes) e Gordon (operações); o Lucius,
  o Riddler, o Alfred e o Gordon andam de fato e gravata. Sem trabalho ficam no lounge (sofá, Batcomputador, o fato na
  vitrine, café, saco de boxe, xadrez); uma missão mandada daqui (a um deles pelo nome, ou a qualquer um), uma tarefa do
  quadro, um Claude a trabalhar ou um subagente põe um deles a caminho de um dos 6 computadores. Clicar num agente abre o
  **painel de missão** (acabamento AMG: carbono, cromado, conta-rotações do progresso, tempo, custo, agora/último/a seguir,
  registo, pausar/parar); num agente livre, dá-lhe uma missão ali mesmo. Peso medido a 7 out: ~3,6 ms por imagem a 3000 px,
  12 imagens/s parado e 26 a mexer, só com a página aberta e à vista. A 7 out o Marco pediu para a refazer e mudar-lhe o
  nome: o plano está em `docs/batcave-redesenho.md`.
- **Cada personagem é a sua própria conversa do Claude** (`tasks.crew`, `backend/app/crew.py`): o agente automático de quem
  recebe a tarefa corre-a como essa personagem, retomando sempre a mesma conversa (guardada em
  `~/.team-agent/<perfil>/crew/<id>`, recomeça ao fim de 12 tarefas) e começa cada missão com o briefing do Hub
  (`GET /api/agent/tasks/{id}/briefing`): quem é, a Memória, as empresas e os projetos, o trabalho aberto, o que a equipa
  acabou e o que ela própria fez. **Cada tarefa acabada pelo agente deixa uma nota na Memória** (categoria TAREFAS), por isso
  todos sabem tudo a partir da tarefa seguinte; o pedido de cada tarefa leva só as 15 mais recentes dessas notas.
- **O stand (a garagem)**: quatro carros modelados em 3D (`frontend/hub/crew-cars.js`) com as medidas dos verdadeiros:
  Mercedes-AMG G 63, Porsche 911 GT3 RS (asa pescoço-de-cisne, barra de luz), Lamborghini Aventador SVJ e Ferrari SF90
  Stradale. Cada carroçaria é feita de secções ao longo do carro (vidros, pilares, cavas das rodas, jantes com raios,
  pinças, faróis, grelhas, espelhos) e pintada com reflexos de estúdio e verniz. Estão em stands pretos espelhados com LED,
  o morcego à frente e cordões nos da frente; desenham-se uma vez por tamanho (~130 ms). **Cada carro vai representar um
  projeto**: por agora estão «por atribuir» (`CARS[].project` no `crew.js`).
- **As personagens** têm o dobro do detalhe da cave, com luz, sombra e contorno (`frontend/hub/crew-people.js`); cada
  imagem desenha-se uma vez e fica guardada. Quando entra uma missão, o **bat-sinal** acende na parede do escritório; o
  Batcomputador mostra as missões a decorrer; os livres às vezes vão ao stand ver os carros; na equipa, cada um mostra as
  missões que já fez. Peso medido a 7 out: ~2,3 ms por imagem.
- **Secções carregadas só ao abrir**: `lazyView(id, ficheiro.js, ficheiro.css)` em `frontend/hub/ui.js`.
- **5 agentes partilhados** em `.claude/agents/` e as regras de modelos e budget no `CLAUDE.md`.

## Próximos passos (com o que a pesquisa de 6 out ensinou)

- **Quanto gasta cada Claude e cada subagente:** os ficheiros de conversa do Claude Code têm `message.model` e `message.usage`
  por mensagem (`~/.claude/projects/<pasta>/<sessão>.jsonl`; subagentes em `<sessão>/subagents/agent-<id>.jsonl` + `.meta.json`).
  Ler só o que é novo (guardar o offset), uma vez por turno (`Stop` / `SubagentStop`), e contar cada `message.id` uma vez só
  (as linhas repetem-se e a primeira pode ter os tokens a meio). Ler os últimos 256 KB de 23 MB custou ~3 ms.
- **Janelas fantasma:** o `SessionEnd` perde-se se o Hub estiver em baixo ou com um Esc; usar também a data do ficheiro de
  conversa (sem mudar há 2 min → à espera; há 3 h → abandonada).
- **Para o 3D (e um 2D com personagens antes):** inspiração em projetos MIT: [Pixel Agents](https://github.com/pixel-agents-hq/pixel-agents)
  (personagem por sessão, balões de espera/permissão, subagentes ligados ao pai), [claude-office](https://github.com/paulrobello/claude-office)
  (FastAPI + PixiJS, chefe = sessão, empregados = subagentes), [pixtuoid](https://github.com/IvanWng97/pixtuoid) (uma cena em JSON,
  vários desenhadores) e, em 3D, [Vibecraft](https://github.com/nearcyan/vibecraft) (uma estação por tipo de ferramenta: ler →
  estante, comandos → terminal, subagentes → portal). Regra: **desenhar só quando algo muda** (PixiJS `ticker.stop()`,
  React Three Fiber `frameloop="demand"`); o Pixel Agents desenha sem parar e é o exemplo a não seguir.
- **Privacidade:** vários projetos nem guardam o pedido. Nós mostramos só o início (decisão do Marco); se um sócio preferir,
  passa a mostrar só o tipo de trabalho.
