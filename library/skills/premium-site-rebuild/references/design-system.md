# Sistema visual

## Tokens (ponto de partida — trocar pelos da marca do cliente)

```css
:root{
  /* fundo profundo, claro quente, névoa, um material de acento */
  --fundo:#06111b; --fundo-2:#0a1a28; --fundo-3:#10263a;
  --claro:#f3efe6; --claro-2:#d9d4c8; --nevoa:#8fa1b0;
  --acento:#caa57b; --acento-2:#e2c39d;
  --tinta:#0b1620;                       /* texto sobre o claro */
  --curva:cubic-bezier(.16,1,.3,1);      /* a ÚNICA curva do site */
  --t-toque:200ms; --t-entra:700ms; --t-cena:1200ms;
  --g:clamp(16px,4vw,56px);              /* gutter lateral e unidade de ar */
  --f-xxl:clamp(3rem,9.2vw,9rem);
  --f-xl:clamp(2.5rem,6.4vw,6.4rem);
  --f-l:clamp(2rem,4.2vw,4rem);
  --f-m:clamp(1.45rem,2.4vw,2.2rem);
  --f-s:clamp(1.1rem,1.4vw,1.3rem);
  --f-c:1rem; --f-p:.875rem; --f-mi:.75rem;
  color-scheme:dark;
}
```

- **Durações no JS** saem do CSS: `parseFloat(getComputedStyle(documentElement).getPropertyValue('--t-toque'))`,
  e as outras são múltiplos (`T*6`, `T*14`). Mudar o ritmo = mudar um token.
- **Curva no JS**: a mesma Bézier resolvida à mão (bissecção de 24 passos) quando algo tem de
  seguir a curva fora do CSS.

## Letra

- Uma família variável, alojada: `@font-face{font-family:X;font-weight:100 900;font-stretch:62% 125%;font-display:swap;src:url(fonts/x.woff2) format('woff2')}`
  + `<link rel="preload" href="fonts/x.woff2" as="font" type="font/woff2" crossorigin>`.
- Títulos: peso 300–500, largura um pouco condensada, `letter-spacing:-.02em…-.04em`,
  `line-height:.92–1`, duas linhas com quebra intencional (`<br>` ou spans por linha).
- Etiquetas: maiúsculas pequenas, `letter-spacing:.14em`, cor névoa.
- Texto corrido: 1–1.125rem, `max-width:34–42ch`, cor clara a 80%.
- Itálico só para uma palavra de ênfase por título, nunca frases inteiras.

## Cor

- Fundo profundo na maior parte; uma secção clara (o contacto, por exemplo) para o fim da
  viagem — o contraste de "chegar".
- O acento material só em: linha de água/realce, pílula activa, amostras, números-chave.
- Branco puro só no logótipo e no cabeçalho em `difference`.
- Fotografia faz a cor. Sem gradientes decorativos; degradés só como máscara (imagem que se
  dissolve no fundo).

## Componentes

- **Botão**: pílula (`border-radius:999px`), padding generoso, texto + seta "—" ou "→" que anda
  `translateX(4px)` no hover; fundo claro sobre o escuro. Hover só com `@media (hover:hover) and (pointer:fine)`
  (no toque o :hover fica preso).
- **Cabeçalho fixo**: 3 zonas (links · logótipo · CTA), `mix-blend-mode:difference` com branco;
  no telemóvel ganha fundo depois do primeiro ecrã (só muda a classe quando o estado muda).
  `top: env(safe-area-inset-top)`.
- **Menu de ecrã inteiro** no telemóvel: abre com `hidden=false` → rAF → classe `aberto`;
  `overflow:hidden` no body; Escape fecha e devolve o foco; o primeiro link recebe o foco.
- **Barra de contacto fixa** (telefone · WhatsApp · pedido): aparece depois de 70% do primeiro
  ecrã, pousa em cima do rodapé (`transform: translateY(calc(var(--sobe)*-1px))`), recolhe-se
  quando o formulário está à vista.
- **Fichas/tabs**: `role="tablist"`, `role="tab"`, `role="tabpanel"`, painéis fechados com `inert`
  e `aria-hidden`; setas do teclado andam entre tabs.
- **Carrossel**: `scroll-snap` nativo para toque/trackpad; arrasto com rato próprio (encaixa na
  foto mais próxima com empurrão na direcção do gesto); setas; contador "03 / 12"; ecrã inteiro
  com fecho por Escape ou toque no fundo (só se o toque começou e acabou no fundo).
- **Prova**: números grandes que contam (`data-conta`), selos de prémios em placas claras.

## Layout

- Secções altas (min 100svh nas cenas, 70–90vh no resto), muito ar (`padding-block: calc(var(--g)*3)`).
- Grelha de 12 colunas só onde é preciso; a maior parte é composição livre e assimétrica.
- Imagens de margem a margem alternadas com blocos de texto estreitos.
- Telemóvel: uma ideia por ecrã; título → imagem → frase → botão; nada lado a lado.
- `svh`/`dvh` para ecrãs inteiros no telemóvel (barras do Safari).
