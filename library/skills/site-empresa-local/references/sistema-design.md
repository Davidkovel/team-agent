# Sistema de design (Blue Magnitude e Detalhes Cautelosos)

Valores reais de `assets/bluemagnitude/src/app/globals.css` (2200 linhas) e de `assets/detalhes-cautelosos/`. Copia a estrutura, troca as cores pelas do logótipo do teu cliente.

## 1. Cores com nome

### Blue Magnitude (tokens `@theme`, marca azul + verde)

| Token | Valor | Papel |
|---|---|---|
| `--color-shell` | `#f2f5fc` | fundo da página, nunca branco puro |
| `--color-plate` | `#ffffff` | chapa/cartão |
| `--color-plate-2` | `#e8edf9` | chapa de fundo |
| `--color-deep` | `#0b1437` | secção escura (rodapé) |
| `--color-ink` | `#0b1437` | texto |
| `--color-ink-soft` | `#45527a` | texto secundário |
| `--color-ink-faint` | `#586386` | meta (foi escurecido de `#64709A` por contraste medido) |
| `--color-on-deep` / `-soft` | `#e8edf9` / `#a9b4d4` | texto sobre o escuro |
| `--color-line` / `-lit` / `-strong` / `-deep` | `#dce3f2` / `#c2cce4` / `#8b97b8` / `#26325c` | linhas |
| `--color-brand` | `#2a3fa7` | azul: botões, links, títulos |
| `--color-brand-lit` | `#4c62d4` | |
| `--color-accent` | `#84c885` | verde: lavagens, aresta acesa, gota. **É luz, não texto** |
| `--color-accent-ink` | `#3e7a48` | o verde quando tem de ser texto (o `#84c885` sobre claro dá 1,9:1) |

A paleta saiu do logótipo do cliente, não do tema antigo. Regra: o azul trabalha, o verde é luz.

### Detalhes Cautelosos (`marca/dc-cores.css`, `estilo.css`)

Amostradas do logótipo, contadas pixel a pixel:

| Token | Valor |
|---|---|
| `--dc-verde` | `#205532` (fundo da marca, 96,7% da imagem) |
| `--dc-oliva` | `#50752A` |
| `--dc-osso` | `#E7E1E7` (não é branco puro) |
| `--dc-cinza` | `#969997` |
| `--dc-oliva-claro` | `#97CB63` (derivado: mesmo matiz h=90°, V subido até 4,59:1 sobre o verde) |
| `--papel` | `#F3F5F0` |
| `--fundo-heroi` | `#0C2013` (verde da marca com valor a 38%) |
| `--dc-tinta` / `-2` | `#232B26` / `#5B6560` (verde-grafite, não preto) |
| `--dc-linha` | `#D9DDD4` |

Contrastes medidos sobre o verde: oliva 1,63:1, cinza 3,03:1, osso 6,78:1, branco 8,73:1. Conclusão: sobre verde, texto em osso ou branco; o oliva só em massas grandes. Dentro de `.seccao--escura` redefine-se `--dc-oliva: var(--dc-oliva-claro)`, e tudo o que herda o papel "oliva" muda sem saber onde está ("um sistema de cor e não uma lista de exceções").

## 2. Superfícies ("campos")

Cada secção declara a superfície numa classe; os componentes lá dentro nunca pensam em cor.

- `.field-shell`: **não pinta fundo** (se pintasse, tapava a lavagem do `CampoLuz`).
- `.field-plate` (`--field-bg: plate`), `.field-plate-2`, `.field-deep` (tinta clara, `--field-brand: accent`, botão verde sobre azul-noite).
- Variáveis `--field-ink`, `--field-ink-soft`, `--field-ink-faint`, `--field-line`, `--field-line-lit`, `--field-line-strong`, `--field-brand`, `--field-bg`.

## 3. Letra

- Blue Magnitude: **Manrope**, uma família, pesos 400 a 800. `* { text-transform: none }`.
- Detalhes Cautelosos: **Archivo** variável nos eixos de peso e largura, ficheiro único de 105 kB em woff2 (subset latin + latin-ext), `font-display: swap`, `preload` no `<head>`. Duas vozes da mesma letra por `font-variation-settings`:
  - `--dc-display: 'wght' 560, 'wdth' 82` (títulos, comprimidos)
  - `--dc-corpo: 'wght' 400, 'wdth' 100`
  - `--dc-forte: 'wght' 600, 'wdth' 100`
  - `--dc-rotulo: 'wght' 500, 'wdth' 92`
  - Pilha de recurso `"Archivo", "Segoe UI", Roboto, "Helvetica Neue", Arial` escolhida por métrica, para o salto do swap ser pequeno. `font-variant-numeric: tabular-nums` no `body` (o site está cheio de medidas e anos).
  - Foi escolhida comparando oito candidatas no hero real. Delicadas demais (Jost, Cormorant, Bodoni) não servem uma construtora de Classe 6.
- O logótipo **não** é a letra do site. Não se recompõe o wordmark em Archivo.

### Escala fluida (Blue Magnitude, `:root`)

| Token | Valor |
|---|---|
| `--t-display` | `clamp(2.125rem, 1.5rem + 2.9vw, 4.25rem)` |
| `--t-title` | `clamp(1.625rem, 1.35rem + 1.1vw, 2.5rem)` |
| `--t-h3` | `clamp(1.125rem, 1.05rem + 0.3vw, 1.375rem)` |
| `--t-lede` | `clamp(1.0625rem, 1rem + 0.35vw, 1.3125rem)` |
| `--t-body` | `clamp(0.9375rem, 0.9rem + 0.15vw, 1.0625rem)` |
| `--t-label` | `clamp(0.8125rem, 0.8rem + 0.05vw, 0.875rem)` |
| `--t-num` | `clamp(2.125rem, 1.6rem + 2.2vw, 3.125rem)` |

Classes: `.display` (800, `line-height: 1.02`, `letter-spacing: -0.02em`, `text-wrap: balance`), `.title` (700, 1.12, `-0.015em`), `.h3` (600), `.lede` (`max-width: 38ch`), `.corpo` (`1.65`, `max-width: 68ch`), `.label`, `.meta`, `.figure` (tabular), `.credito` (a única "etiqueta" do site: uma linha de texto na cor da marca, sem cápsula, sem traço, sem maiúsculas).

Detalhes Cautelosos: títulos `.titulo` `clamp(1.7rem, 4.4vw, 2.9rem)`, `line-height: 1.08`, `max-width: 20ch`; `.rotulo` `.76rem` com `letter-spacing: .18em` maiúsculas e uma linha que se estende (`::after`).

## 4. Espaçamento

```
--s-xs: clamp(0.5rem, 0.45rem + 0.25vw, 0.75rem);
--s-sm: clamp(0.75rem, 0.65rem + 0.5vw, 1rem);
--s-md: clamp(1.25rem, 1rem + 1.25vw, 2rem);
--s-lg: clamp(2rem, 1.5rem + 2.5vw, 4rem);
--s-xl: clamp(3.5rem, 2.5rem + 5vw, 7.5rem);
--gutter: clamp(1.25rem, 0.9rem + 1.8vw, 4.5rem);
```

- `.shell`: `max-width: 78rem`, `padding-inline: max(var(--gutter), var(--safe-l), var(--safe-r))`.
- `.section { padding-block: var(--s-xl) }`, `.section--tight { padding-block: var(--s-lg) }`.
- `--safe-t/b/l/r` = `env(safe-area-inset-*)`.
- Ecrãs baixos (`max-height: 700px`, telemóvel deitado): escala e espaços reduzidos. Decide-se por **altura**, porque a 844 px de largura um breakpoint `sm:` dispara num ecrã de 390 px de altura.
- Detalhes Cautelosos: `--dc-caixa: min(72rem, 100% - 42px)`, `.seccao { padding-block: clamp(4rem, 11vh, 7.5rem); overflow-x: clip }`.

## 5. Raios, chapas e botões

- Raios: `--radius-plate: 12px`, `--radius-field: 10px`, `--radius-reel: 16px`, pílulas `999px`.
- `.plate`: profundidade por luz, nunca por sombra preta: `inset 0 1px 0 rgba(255,255,255,.9), inset 0 0 0 1px var(--color-line), 0 1px 2px rgba(11,20,55,.04)`. `.plate--lit` leva uma aresta acesa de 2 px em gradiente de acento no topo.
- `.btn`: `min-height: 2.75rem`, `padding-inline: 1.5rem`, pílula, fundo `brand`, `hover: brightness(1.1)`, `active: scale(.98)`. `.btn--contorno` (`inset 0 0 0 1px line-strong`). `.btn-quiet` (link sublinhado). **Duas intensidades e mais nada.** Alvos de toque de 44 px ou mais.
- `.field` (input): `min-height: 3rem`, `font-size: 1rem`, `box-shadow: inset 0 0 0 1px var(--color-line-strong)`.
- Barra Detalhes Cautelosos: pílula fixa (`.barra`), nasce transparente sobre o hero e ganha fundo por `animation-timeline: scroll()` (`animation-range: 0 60vh`) sem JS; em páginas de papel usa `.barra.barra--clara`.

## 6. Movimento

| O quê | Valor |
|---|---|
| curva de entrada | `--ease-land: cubic-bezier(0.16, 1, 0.3, 1)` |
| curva de deslize | `--ease-glide: cubic-bezier(0.32, 0.72, 0, 1)` |
| `.rise` (acima da dobra, CSS puro) | `rise` 700 ms, `translate3d(0, 1.25rem, 0)` → 0 |
| `.reveal` (ao scroll) | **420 ms**, começa em `translate3d(0, .5rem, 0) scale(.985)`; era 800 ms e lia-se como site lento |
| botão | `transform` e `filter` em 500 ms `ease-glide` |
| acordeão | `acordeao-abre` 300 ms, `translate3d(0,-6px,0)` |
| barra a pousar | 260 ms |
| folhas dos índices | `scale(.965)`, 460 ms; escalonamentos de 45 a 60 ms |
| poster do hero | `hero-respira` 14 s `ease-in-out alternate`, `scale(1)` → `1.06` |
| título à máquina | 45 ms por letra |
| fita/seta desenhada | ciclo 3,4 s; desenha em 0,6 s, fica ~2 s |

Detalhes Cautelosos: escala de durações **140 / 220 / 380 / 520 / 800 ms**, curva `--dc-ease: cubic-bezier(.22, 1, .36, 1)`. Revelar ao entrar no ecrã sem JS:

```css
@supports (animation-timeline: view()) {
  @media (prefers-reduced-motion: no-preference) {
    .revela { animation: revela linear both; animation-timeline: view();
              animation-range: entry 5% cover 26%; }
    @keyframes revela { from { opacity: 0; transform: translateY(18px) }
                        to   { opacity: 1; transform: translateY(0) } }
  }
}
```

Onde `view()` não existe a regra é ignorada e o conteúdo fica visível. Uma classe `.oculto` posta no HTML e tirada por JS deixaria a página em branco sem JS.

### Regras de CSS que custaram bugs

- Keyframes com propriedades em **longhand** (`animation-name`, `animation-duration`, ...). O atalho `animation` repõe `animation-delay: 0s` e anula os delays do JSX.
- `transition` em atalho **apaga o que estava** (a `.editorial__folha` declarou só `transform, box-shadow` e a opacidade deixou de animar). Declara as três juntas.
- Uma regra base escrita **depois** de uma media query ganha-lhe com a mesma especificidade.
- `<img height: 100%>` dentro de caixa sem altura: o Safari resolve diferente do Chrome. Dá `aspect-ratio` à caixa.
- `background-size: auto 120%` repete a imagem num painel largo e baixo. Usa `<img>` com `object-fit: cover`.
- `pathLength={1}` com `vector-effect: non-scaling-stroke` parte o tracejado no Chrome: usa o comprimento real do caminho em `stroke-dasharray`.
- Em iOS, ler `pointermove` e escrever `transform` nunca cola ao dedo (`touch-action: pan-y` retém eventos e pode mandar `pointercancel`): usa scroll nativo.
- `mix-blend-mode: multiply` não funciona fora do contexto de empilhamento do `.campo-luz__conteudo` (`z-index: 1`).
- Animação infinita sem `fill-mode` sob `prefers-reduced-motion` (que põe a duração a 0,01 ms) fica no estado base, que costuma ser o invisível.

## 7. Outras peças de CSS reutilizáveis (linhas de `globals.css`)

`CAMPO DE LUZ` (229), `CHAPAS` (336), `BOTOES` (403), `ACORDEAO` (496), `MOVIMENTO` (568), `MOVIMENTO REDUZIDO` (659), `LISTA COM GOTA DE LUZ` (703), `FITA DE SERVICOS` (820), `PAINEIS EXPANSIVEIS` (966), `INDICE EDITORIAL` (1217), `TITULO TECLADO` (1490), `RODAPE` (1565), `LINHAS DE CONTACTO` (1935), `O PEDIDO EM TRES PASSOS` (1983), `A SETA DESENHADA A MAO` (2103), `OS PASSOS DO PROCESSO` (2171).

Detalhes Cautelosos (`estilo.css`, 21 KB): `.servicos` (grelha com linhas de 1 px entre células, `repeat(auto-fit, minmax(15rem, 1fr))`), `.numeros` (faixa de prova, `dt` rótulo e `dd` número grande), `.obras` e `.obra` (`aspect-ratio: 4 / 3`), `.contacto__grelha` (duas colunas a partir de 56rem), `.rodape`.
