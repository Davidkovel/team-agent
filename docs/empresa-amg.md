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

## Quando ficar enorme

Com agentes a trabalhar 24 horas, muito histórico e 3D pesado, a sede passa para **um computador sempre ligado**
(um mini-PC ou um servidor na nuvem, ligado pelo Tailscale como o iPhone), que faz o trabalho pesado; os PCs ficam só
com o ecrã. A arquitetura acima (um registo, secções independentes) deixa fazer essa mudança sem refazer nada.
