---
name: hub-pagina
description: Como se faz ou muda uma página do Hub do Agente AMG (o dashboard que o widget abre, no PC e no telemóvel). Usar sempre que o pedido é juntar uma página, um separador ou uma secção ao Hub/widget, arrumar ou redesenhar uma página, mudar a barra do lado, o Ctrl+K ou o «Mais» do telemóvel, para tudo ficar organizado e com o mesmo aspeto.
---

# hub-pagina: uma página do Hub, feita como as outras

O Hub (`team-agent/frontend/`, sem build) é a app da equipa: o widget abre-o numa janela grande e o telemóvel abre-o
como app. A 21 out 2026 o Marco pediu-o «como uma obra de arte, muito organizado, funcional a sério», e foi todo
arrumado. Esta skill serve para cada página nova continuar assim. **As regras completas estão em
`team-agent/docs/hub-paginas.md`: lê esse ficheiro antes de começar.**

## Antes de escrever código

1. **Em que secção entra?** A barra do lado tem cinco (`SECTIONS` e `NAV` em `frontend/app.js`): 01 Comando, 02 Agentes,
   03 Negócios, 04 Trading e 05 Sistema. O normal é a página entrar como separador de uma entrada que já existe. Uma
   entrada nova só se justifica se a página for um mundo à parte. Basta pôr a página no `NAV` para ela aparecer na barra,
   no Ctrl+K e no «Mais» do telemóvel.
2. **Ficheiros próprios**: `frontend/hub/<pagina>.js` + `.css`, carregados só ao abrir (`lazyView` em `hub/ui.js`). As
   classes levam um prefixo da página.
3. **O que a página faz de verdade?** Cada número vem de dados reais (`live`, `calculated`, `estimated`), e o que falta
   aparece como «Sem dados», nunca como zero. Uma página sem função não entra.

## A anatomia (igual em todas)

- `ui.head(_, "Título", "Para que serve, numa frase.", ações)`: o texto pequeno por cima («04 · Trading») é posto
  sozinho. Nas ações há no máximo uma `btn primary` cromada, e o estado (ligado/desligado) aparece como chip ao lado.
- Por baixo vem uma fila de números (`.panel.pad` + `.num`), depois secções `ui.sec("…")` com `.panel`/`.cards`, os
  vazios com `ui.empty(…, ação)` e o «a carregar» e os erros com `mount()`.
- Aspeto preto AMG e monocromático: verde, âmbar e vermelho só para o estado. Letra do iPhone (SF Pro / Inter, desde
  23 out): títulos e números em `--display` com tracking negativo, botões e abas em sentence case, maiúsculas pequenas só
  nas etiquetas de grupo. Sem serifa. Texto em português de Portugal, curto.
- Os agentes são **departamentos** (Desenvolvimento DEV, Engenharia ENG, Pesquisa PES, Design DSG, Marketing MKT, Revisão
  REV, Testes QA, Operações OPS, Macro MAC, Análise técnica TEC), mostrados com um monograma; nunca personagens nem bonecos.
- No telemóvel tem de caber em 393 px sem nada cortado. As regras ficam no CSS da página, debaixo de `html.is-phone`.
- Peso: nada anima sem estar a acontecer alguma coisa. Widget e Hub parados ficam abaixo de 1% de CPU, a central
  abaixo de 3%.

## Testar e publicar

- Hub de teste com uma cópia dos dados (backup do SQLite) e `scripts/ver_hub.py` para ver a página no PC e no
  telemóvel. Os passos estão no `CLAUDE.md`, em «Testar uma mudança no Hub».
- Subir o `?v=hubN` no `index.html`, fazer commit só dos teus ficheiros, `git fetch` + `rebase` e push. Escreve na
  Memória do Hub o que mudou (`scripts/memoria.py`).
