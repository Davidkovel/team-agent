# Como se faz uma página do Hub

Regras para qualquer página nova ou mexida no Hub (o que o widget mostra na janela grande, no PC e no telemóvel).
Escritas a 21 out 2026 (letra atualizada a 23 out), quando o Marco pediu o Hub «como uma obra de arte, muito organizado, funcional a sério», antes de
pôr muitos agentes a trabalhar nele. Todas as páginas seguem isto, para a app parecer uma só e não um monte de páginas
feitas por pessoas diferentes.

## Onde vive cada página

A barra do lado tem cinco secções numeradas (`NAV` em `frontend/app.js`, o 4.º campo de cada entrada é a secção):

| Secção | Entradas (e os separadores no topo de cada uma) |
|---|---|
| 01 · Comando | Início · Tarefas (Aprovações, Semana) · Novidades |
| 02 · Agentes | Escritório · Empresa AMG · Skills (Galeria) · Equipa (Ao vivo, Agentes, Histórico) |
| 03 · Negócios | Trabalho (Empresas, Projetos, Código, Entregas, BareDesk, Kit do Claude) · Fábrica Etsy |
| 04 · Trading | Sala de Trading (Robôs, Reforço na notícia, Gap da manhã) · Mercados |
| 05 · Sistema | Análise (Uso de IA, Despesas) · Sistema (Memória, Saúde, Definições) |

Uma página nova entra numa destas secções: como separador de uma entrada que já existe (o normal) ou como entrada nova se
for um mundo à parte. A procura (Ctrl+K) e o «Mais» do telemóvel leem a mesma lista, por isso a página aparece lá sozinha.

## A anatomia de uma página

1. **Cabeçalho**: sempre `ui.head(eyebrow, título, frase, ações)`. O pequeno texto por cima do título é posto pela moldura
   com a secção da página («04 · Trading»), seja qual for o `eyebrow` passado. O título é o nome da página, em serifa. A frase
   diz para que serve a página, numa linha, em português de Portugal. À direita ficam as ações: no máximo uma `btn primary`
   (cromada) para a ação principal, as outras `btn` ou `btn quiet`, e o estado da página (ligado/desligado, ao vivo) como
   chip ao lado delas. **Nada de cabeçalhos dentro de cartões**, nem um título com outro estilo.
2. **Números de cima** (o Painel, abaixo): `ui.kpis([ui.kpi({...}), ...])` (ou `kpiRow`/`kpi` no `pages.js`). Um número que
   não existe mostra «Sem dados» (`ui.num(null)`), nunca um zero inventado.
3. **Secções**: `ui.sec("Título", direita)` (maiúsculas espaçadas) e por baixo o conteúdo em `.panel` / `.cards`. Uma ideia
   por secção, pela ordem do que se usa mais.
4. **Vazio**: `ui.empty(ícone, título, texto, ação)` com um botão que resolve (ligar, criar, trazer). Nunca uma página que só
   diz «nada».
5. **A carregar / erro**: `mount()` ou `ui.skeleton()` enquanto carrega e `ui.error()` com «Tentar outra vez».

## O aspeto (o gosto do Marco)

- Preto AMG: laca preta, painéis grafite com aresta fina, cromado só no que é principal. **Monocromático**: verde, âmbar e
  vermelho só para estado (bom, atenção, mau/atrasado). Nada de azul-marinho, índigo, vidro colorido ou cores novas.
- Letra (desde 23 out 2026, «mais bonito e moderno, estilo iOS»): a do iPhone. `--ui` e `--display` são SF Pro nos
  aparelhos Apple e Inter (com tamanhos óticos) no resto; `--serif` ficou como nome e aponta para o display: **a serifa e o
  Space Grotesk saíram**. Títulos em display, peso 650-700, tracking negativo (-0.02 a -0.03em); números em display com
  `tabular-nums`; botões, abas e filtros em sentence case, nunca maiúsculas espaçadas; maiúsculas pequenas (tracking ≤ .1em)
  só nas etiquetas de grupo, como os cabeçalhos das listas do iOS. Nada de fontes novas numa página: só os tokens.
  O acabamento iOS do telemóvel e do PC está em `hub/ios-type.css`, carregado por último.
- Botões: os da casa (`.btn`, `.btn.primary`, `.btn.quiet`, `.btn.sm`). Não inventar botões.
- Classes de cada página com prefixo próprio (`ey-`, `gp-`, `rb-`...): o `design.css` tem classes genéricas.
- Texto para o Marco: curto, português de Portugal, sem jargão. Uma frase completa é melhor do que três palavras soltas.

## O Painel (27 out 2026)

O Marco mandou um dashboard de vendas (vídeo da «Corbel Supply Co.») e pediu essa organização em todas as páginas: «algo que
brilha, organizado, para empresas». Tirou-se a arrumação, não as cores (`hub/painel.css`, carregado por último; peças no `ui.js`):

- **Fila de números** com `ui.kpi({ label, value, delta, viz, sub, src, href, go })` dentro de `ui.kpis([...])`. **O primeiro
  cartão da fila fica aceso** (cromado, letra preta); para não o acender, `cls: "pn-plain"` ou um tom `bad`/`warn`.
- `delta`: `ui.delta(agora, antes, { badUp })`, a variação contra o período anterior em chip verde/vermelho (`badUp` num custo).
- `viz`: um gráfico pequeno com uma série real: `ui.spark(valores)` (linha), `ui.cols(valores)` (colunas, a última acesa),
  `ui.ring(pct)` (anel). As séries saem dos registos com `series.byDay(lista, dataDe, dias)` e `series.inPeriod(...)`.
  **Sem série verdadeira, sem gráfico**: nunca uma linha inventada.
- **O coração da página**: `<div class="pn-split">` com dois `.panel.pad`, cada um com `.pn-card-h` (título e nota) e uma peça
  grande: `ui.gauge(valor, máx)` (manómetro), `ui.bars(itens)` (colunas às riscas, a do período aberto acesa), `ui.trend(pontos)`
  (linha com o período anterior a tracejado e o valor ao passar o rato) ou `ui.share(a, b)` (duas partes de um todo).
- O `ui.head` mostra sozinho «N de 3 online» à direita (`ui.live`, atualizado pelo `drawHud`). As abas de cima são uma barra em
  comprimido com a aberta acesa; os filtros (`.segx`) são comprimidos; os botões são redondos; a barra do lado flutua.

## Telemóvel

- Tem de caber em 393 px sem nada cortado nem a andar para o lado. As regras do telemóvel de uma página ficam no CSS dela,
  debaixo de `html.is-phone`.
- Ver com `scripts/ver_hub.py` (`{"mobile": [393, 852, 2]}` e depois `?phone=1#/pagina`).

## Peso

O widget e o Hub parados ficam abaixo de 1% de CPU, e a central de comando abaixo de 3%. Nada anima sem estar a acontecer
alguma coisa, e uma página só lê dados enquanto está aberta. Medir com `{"metrics": ...}` no `ver_hub.py` quando uma página
ganha animação.
