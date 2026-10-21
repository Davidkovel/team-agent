# Como se faz uma página do Hub

Regras para qualquer página nova ou mexida no Hub (o que o widget mostra na janela grande, no PC e no telemóvel).
Escritas a 21 out 2026, quando o Marco pediu o Hub «como uma obra de arte, muito organizado, funcional a sério», antes de
pôr muitos agentes a trabalhar nele. Todas as páginas seguem isto, para a app parecer uma só e não um monte de páginas
feitas por pessoas diferentes.

## Onde vive cada página

A barra do lado tem cinco secções numeradas (`NAV` em `frontend/app.js`, o 4.º campo de cada entrada é a secção):

| Secção | Entradas (e os separadores no topo de cada uma) |
|---|---|
| 01 · Comando | Início · Tarefas (Aprovações, Semana) · Novidades |
| 02 · Agentes | Escritório · Empresa AMG · Skills · Equipa (Ao vivo, Agentes, Histórico) |
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
2. **Números de cima** (se a página os tiver): uma fila de cartões `.panel.pad` com a etiqueta em maiúsculas pequenas e o
   número em `.num` (serifa). Um número que não existe mostra «Sem dados» (`ui.num(null)`), nunca um zero inventado.
3. **Secções**: `ui.sec("Título", direita)` (maiúsculas espaçadas) e por baixo o conteúdo em `.panel` / `.cards`. Uma ideia
   por secção, pela ordem do que se usa mais.
4. **Vazio**: `ui.empty(ícone, título, texto, ação)` com um botão que resolve (ligar, criar, trazer). Nunca uma página que só
   diz «nada».
5. **A carregar / erro**: `mount()` ou `ui.skeleton()` enquanto carrega e `ui.error()` com «Tentar outra vez».

## O aspeto (o gosto do Marco)

- Preto AMG: laca preta, painéis grafite com aresta fina, cromado só no que é principal. **Monocromático**: verde, âmbar e
  vermelho só para estado (bom, atenção, mau/atrasado). Nada de azul-marinho, índigo, vidro colorido ou cores novas.
- Letra: títulos em serifa (`--serif`), números em serifa (`.num`), etiquetas em maiúsculas espaçadas, texto em Inter.
- Botões: os da casa (`.btn`, `.btn.primary`, `.btn.quiet`, `.btn.sm`). Não inventar botões.
- Classes de cada página com prefixo próprio (`ey-`, `gp-`, `rb-`...): o `design.css` tem classes genéricas.
- Texto para o Marco: curto, português de Portugal, sem jargão. Uma frase completa é melhor do que três palavras soltas.

## Telemóvel

- Tem de caber em 393 px sem nada cortado nem a andar para o lado. As regras do telemóvel de uma página ficam no CSS dela,
  debaixo de `html.is-phone`.
- Ver com `scripts/ver_hub.py` (`{"mobile": [393, 852, 2]}` e depois `?phone=1#/pagina`).

## Peso

O widget e o Hub parados ficam abaixo de 1% de CPU, e a central de comando abaixo de 3%. Nada anima sem estar a acontecer
alguma coisa, e uma página só lê dados enquanto está aberta. Medir com `{"metrics": ...}` no `ver_hub.py` quando uma página
ganha animação.
