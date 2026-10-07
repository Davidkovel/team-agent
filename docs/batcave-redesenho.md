# Redesenho da página dos agentes (a Batcave, antiga «My Niggaz»)

Pedido do Marco a 7 de outubro de 2026. **Estado: plano aceite pelo Marco, ainda nada construído.**

Este ficheiro é o contexto todo da conversa em que o Marco o pediu. Quem pegar nisto (o Marco, o Kovel, o David ou
qualquer Claude, em qualquer conta ou PC) lê isto e continua sem precisar dessa conversa. As decisões curtas estão também
na Memória do Hub (categoria EMPRESA, nota «Batcave dos agentes: redesenho pedido pelo Marco»).

## O que o Marco pediu

- A página está gira, mas não se percebe nada: vê-se que os bonecos trabalham, mas não se vê o pedido, o que cada um
  está a fazer nem que skill usa.
- Quer que pareça um vídeo ou um jogo, «à patrão»: com as cores do Hub e do widget (preto, grafite, cromado), com o tema
  do Batman, organizado, sem ar infantil e **mesmo clean**. Animação tipo Sims, à vontade.
- Secretárias melhores e maiores, com ecrãs, organizadas por setores.
- Uma sala de estar onde os agentes estão juntos a ligar ideias e memórias. **Não é decoração:** os agentes têm de estar
  todos ligados entre si e com as skills.
- Quase tudo automático: quando ele pede alguma coisa, os agentes tratam de tudo e vão buscar as skills que forem precisas.
- Ver facilmente o que cada sócio (sobretudo o Kovel) está a usar: que agente, que pedido mandou. Quase tudo explicado.
- O nome «My Niggaz» sai: foi uma brincadeira do início. Quer um nome bonito com AMG e «empresa».
- Fica em 2D por agora; o 3D vem depois.
- Tudo o que ele decide fica na Memória do Hub, para todos.

## O mapa novo do David (7 out, commit ffb8246) é a base

No mesmo dia o David refez o mundo da página: a cave passou a ser uma ilha de rocha sobre um abismo, com o rio e as pontes
entre o escritório e o stand, o cofre de ouro (cada missão acabada é uma barra), o bar na varanda e o miradouro com o
holofote que projeta o bat-sinal (as regras do `MAP` estão no `CLAUDE.md`). **Isso fica.** O pedido do Marco é a
organização e a explicação por cima desse mapa. Duas coisas mexem no que o David fez e têm de ser combinadas com ele:
as luzes passam de néon azul a branco frio, e sai o que só distrai.

Os dois mexeram no `crew.js` no mesmo dia: **um de cada vez.** Antes de começar, `git fetch`, avisar o outro e construir
sobre a versão mais recente.

## O plano

```
          parede de trás: três ecrãs grandes, um por sócio
 ┌──────────┬──────────────────────────────────────────┬─────┬────────────┐
 │ ARSENAL  │ CÓDIGO     ENGENHARIA  PESQUISA  DESIGN   │     │            │
 │ (skills) │ Batman     Lucius      Riddler   Catwoman │ rio │   STAND    │
 │          │                                          │     │ (os carros)│
 │ SALA DE  │ MARKETING  REVISÃO     TESTES    OPERAÇÕES│     │            │
 │ ESTAR    │ Joker      Alfred      Robin     Gordon   │     │            │
 └──────────┴──────────────────────────────────────────┴─────┴────────────┘
   COFRE          BAR NA VARANDA                            MIRADOURO
   por baixo da cave: a PAREDE DE COMANDO, uma coluna por sócio
```

1. **Nome: Empresa AMG.** O Marco deixou a escolha connosco; muda-se se ele quiser outro. «My Niggaz» sai do menu do PC,
   do telemóvel, do título da página, do letreiro na cave e dos documentos. A rota passa a `#/empresa` e a antiga
   `#/niggaz` continua a abrir a mesma página (links antigos).
2. **Um posto fixo por setor.** Cada agente tem a sua secretária, sempre no mesmo sítio, com o nome do setor no chão:
   Código (Batman), Engenharia (Lucius), Pesquisa (Riddler), Design (Catwoman), Marketing (Joker), Revisão (Alfred),
   Testes (Robin), Operações (Gordon). Secretárias maiores: tampo de carbono com aresta cromada, três ecrãs, cadeira de
   pele e uma luz que diz o estado (verde a trabalhar, âmbar à espera, vermelho a precisar de ajuda).
3. **Um cartão por cima de cada posto ocupado:** quem pediu (na cor do sócio), o pedido, o que está a fazer agora, as
   skills e os subagentes em uso, há quanto tempo, o modelo e os tokens.
4. **Quem vai para onde, sempre pela mesma regra.** Uma tarefa nova, um Claude a trabalhar num dos três PCs e um
   subagente vão para o posto do setor que corresponde ao trabalho. Num subagente conta o tipo (pesquisador → Pesquisa,
   revisor-hub → Revisão, explorador → Engenharia, designer-hub → Design, marketing → Marketing). Num pedido contam as
   palavras: design, página, cor → Design; pesquisa, preço, procura → Pesquisa; testes → Testes; rever → Revisão;
   anúncio, post → Marketing; erro, código → Código; onde está, explica → Engenharia; o resto → Operações. Se o agente
   desse setor estiver ocupado, vai o colega livre mais parecido; se ninguém estiver livre, fica na fila, à vista.
5. **«Automático» em vez de «Qualquer um»** ao mandar uma missão: enquanto se escreve, a página mostra quem vai fazer
   («Vai para a Catwoman · Design») e manda a missão já com essa personagem.
6. **Parede de comando.** Na cave, três ecrãs grandes na parede de trás, um por sócio (Kovel, Marco, David), que acendem
   na cor dele quando um Claude dele trabalha. Por baixo da cave, a mesma parede em texto legível, uma coluna por sócio:
   cada Claude aberto (o pedido, o estado, o agente que o está a fazer, as skills, os subagentes, o modelo, os tokens e
   desde quando) e as missões do agente automático dessa pessoa. Responde a «o que é que o Kovel está a usar e o que é que
   pediu». Do pedido mostra-se só o início, como no Escritório. Cada sócio tem uma cor discreta, diferente das dos estados.
7. **A sala de estar é onde os agentes ligam ideias e memórias.** Sofás em U à volta de uma mesa com a Memória da equipa
   à vista: as notas como pontos, agrupadas por tema (REGRAS, DESIGN, TAREFAS…). Os agentes livres ficam lá a conversar,
   com balões sobre o que a equipa acabou (as notas TAREFAS). Quando um agente começa uma missão, passa pela mesa e leva
   as notas dessa empresa ou projeto (acende uma linha da mesa até ao posto dele); quando acaba, a nota dele cai na mesa e
   acende, e as moedas voam para o cofre como já fazem. Um botão **Reunião** manda uma missão a sério ao Gordon (gasta como
   qualquer outra): ler a Memória, ligar as ideias e propor o que fazer a seguir. O resultado fica como nota.
8. **Arsenal de skills.** Uma parede com as skills que os Claudes da equipa usaram (e as da pasta `.claude/skills/` do
   projeto). Quando um Claude usa uma skill, o agente do posto vai buscá-la ao arsenal e ela fica no cartão dele.
9. **Ligações.** Uma linha de luz entre o posto de quem lançou um subagente e o posto de quem o está a fazer.
10. **Aspeto.** Bunker do Batman em preto, grafite e cromado, com luz branca fria. Cor só para os estados e para os sócios.
    Sai o néon azul e o que só distrai. Animação tipo Sims: andar, sentar, beber café, conversar com gestos, e um losango
    por cima de cada agente com a cor do estado.
11. **Tudo explicado.** Passar o rato por qualquer coisa (um posto, uma skill, uma nota, um ecrã de sócio) diz o que é, de
    quem e porquê, e há uma legenda curta das cores. Clicar num agente aproxima a câmara do posto dele e abre o painel da
    missão.
12. **Peso.** As regras de sempre (`docs/empresa-amg.md`): só anima com a página aberta e à vista, o fundo desenha-se uma
    vez por tamanho, menos de 3% de CPU parada. Medir antes do push.

## Fora por agora (a seguir, na fase de controlo)

- Missões em cadeia, passadas sozinhas de agente para agente (design → código → testes).
- Os agentes automáticos usarem as skills do Claude Code. Hoje o agente automático corre só com as ferramentas do Hub
  (`agent/team_agent/providers/claude_sdk.py`); o arsenal mostra as skills que os Claudes das janelas usam.
- O 3D.

## Para quem for construir

- A página: `frontend/hub/crew.js` (o `MAP`, a câmara, os agentes, as missões, o painel), `crew.css`, `crew-people.js` (as
  personagens) e `crew-cars.js` (os carros). Do lado do Hub, `backend/app/crew.py` (as personagens, o briefing, as notas
  TAREFAS). A página lê `/api/tasks`, `/api/office` e `/api/memory`. As regras dela estão no `CLAUDE.md` (o fundo fica por
  baixo, a camada que mexe desenha-se a dobrar, o `MAP` e os caminhos, como testar com o painel escondido).
- O nome está em `frontend/app.js` (menu), `frontend/hub/mobile.js` e `mobile.css` (telemóvel), `frontend/hub/ui.js`
  (`lazyView("niggaz", …)`), no `crew.js` (título e letreiro), no `crew.py`, no `CLAUDE.md` e no `docs/empresa-amg.md`.
- **As skills usadas ainda não ficam guardadas.** O hook já manda o nome (`tool_input.skill`), mas o `describe()` em
  `backend/app/routers/office.py` só o põe na linha do momento, e esse passo pode cair no intervalo de 2 s. Falta guardar a
  lista numa coluna nova de `claude_sessions` e de `claude_agents`, por `backend/app/migrate.py` (`SCHEMA_VERSION` 14).
  A sync aguenta: um PC ainda antigo manda as linhas dele sem essa coluna, que chega vazia.
- **A Memória:** o agente automático não escreve notas; a nota de cada tarefa acabada nasce em `crew.remember_task`.
- Testar num Hub de teste com uma cópia da base de dados e do frontend (`CLAUDE.md`, «Testar uma mudança no Hub») e mostrar
  imagens ao Marco antes de publicar. Depois: push e nota na Memória do Hub.

## Como continuar noutro terminal ou noutra conta

Abrir o Claude Code na pasta `Desktop\team-agent` e escrever:

> Lê o docs/batcave-redesenho.md e continua a partir daí.
