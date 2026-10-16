# Sistema de design

Estética: escuro, técnico, terminal. Fundo quase preto azulado, um só acento verde néon, texto
mono nas etiquetas. Tudo tirado de `tailwind.config.ts`, `app/globals.css` e dos componentes.

## Cores (iguais no Tailwind e no `:root`)

| Token | Valor | Uso |
|---|---|---|
| `bg` | `#0A0E1A` | Fundo da página, cartões de serviço. |
| `surface` | `#111827` | Cartões de produto, campos do formulário, hover dos serviços. |
| `accent` | `#00FF88` | Etiquetas `//`, links, hover, brilho, estado `Live`. |
| `text-primary` | `#F0F0F0` | Títulos e texto principal. |
| `text-muted` | `#6B7280` | Parágrafos, etiquetas secundárias. |
| `borderColor.subtle` | `rgba(255,255,255,0.08)` | Todas as linhas e bordas. |

Extra: o círculo do logótipo usa `bg-[#060913]` (mais escuro que `bg`). Opacidades do acento
usadas: `accent/5`, `accent/10`, `accent/40`, `accent/60`, e `rgba(0,255,136,0.08)` no halo.
`globals.css` põe `* { border-color: rgba(255,255,255,0.08) }` e `::selection` a
`rgba(0,255,136,0.25)`.

## Tipografia

| Papel | Família | Classes |
|---|---|---|
| Texto | Inter (`font-sans`) | corpo `text-base`/`text-sm`, `leading-relaxed` |
| Etiquetas, botões, números, logótipo | JetBrains Mono (`font-mono`) | `text-xs`, `text-sm`, `text-[10px]`, `text-[11px]` |

Escala usada:

- `h1` hero: `text-5xl md:text-7xl font-medium tracking-tight`
- `h1` de página (`/work`): `text-4xl md:text-5xl font-medium tracking-tight`
- `h2` About: `text-3xl md:text-5xl font-medium tracking-tight leading-tight`
- `h2` outras: `text-3xl md:text-4xl font-medium tracking-tight`
- `h3` cartão: `text-2xl font-medium tracking-tight`
- Etiqueta de secção: `font-mono text-xs text-accent tracking-widest`
- Micro-etiqueta: `font-mono text-[10px] tracking-widest uppercase text-text-muted`
- Peso: `font-medium` em quase tudo; `font-semibold` só no logótipo.

## Espaçamento e forma

- Secção: `py-28 px-6`. Hero: `min-h-screen`. Página interna: `pt-32 pb-28 px-6` (compensa o
  cabeçalho fixo de 64 px).
- Contentores: `max-w-6xl` (grelhas), `max-w-3xl` (texto), `max-w-xl`/`max-w-2xl` (frases).
- Grelhas: `md:grid-cols-2 gap-6` (produtos); `md:grid-cols-2 lg:grid-cols-3` (serviços);
  `grid-cols-3 gap-4` (estatísticas).
- Cartão de produto: `p-7`. Cartão de serviço: `p-8`. Botões: `px-5 py-3`.
- Cantos quase retos: `DEFAULT 4px`, `md 6px`, `lg 8px`. Só o círculo do logótipo é
  `rounded-full`.
- Sombras: `shadow-glow` = `0 0 12px rgba(0,255,136,0.3)`; `shadow-glow-lg` =
  `0 0 32px rgba(0,255,136,0.35)`.

## Componentes visuais recorrentes

- **Botão principal**: `border border-accent/40 bg-accent/5 hover:bg-accent/10
  hover:border-accent text-accent font-mono text-sm hover:shadow-glow transition-all`, com seta
  `→` que desliza 4 px (`group-hover:translate-x-1`).
- **Botão secundário**: só texto, `text-text-muted hover:text-text-primary`.
- **Campo de formulário**: `bg-surface border border-subtle px-4 py-3 font-mono text-sm
  focus:outline-none focus:border-accent focus:shadow-glow`.
- **Cápsula/etiqueta**: `font-mono text-xs px-3 py-1.5 border border-subtle text-text-muted
  hover:border-accent/60 hover:text-accent`.
- **Estado**: `Live` e `Active` com borda e texto `accent` e ponto a piscar; `In Development`
  em cinzento (`statusColor` em `ProductCard.tsx`).
- **Cabeçalho**: `fixed`, `backdrop-blur-md`, `bg-bg/40` no topo e `bg-bg/80` com borda depois
  de 20 px de scroll.

## Animação (Framer Motion 11)

Entrada ao scroll, o padrão de quase todas as secções:

```tsx
initial={{ opacity: 0, y: 16 }}            // 24 nos cartões de produto
whileInView={{ opacity: 1, y: 0 }}
viewport={{ once: true, margin: "-80px" }} // -60px nos cartões
transition={{ duration: 0.5 }}
```

Valores reais usados:

| Onde | Movimento | Tempo |
|---|---|---|
| Cabeçalhos de secção | `y 16 → 0` | `0.5 s` |
| Formulário | igual, `delay 0.1` | `0.5 s` |
| `ProductCard` | `y 24 → 0`, `delay: index * 0.08` | `0.45 s` |
| Serviços | `y 16 → 0`, `delay: i * 0.06` | `0.4 s` |
| Cápsulas `roles` | `y 8 → 0`, `delay: 0.1 + i * 0.06` | `0.3 s` |
| Estatísticas | `y 12 → 0`, `delay: 0.2 + i * 0.08` | `0.4 s` |
| Hero (`h1`, frase, botões) | `y 16 → 0` ao carregar, `delay 0.2 / 0.35 / 0.5` | `0.6 s` |
| Seta SCROLL | aparece com `delay 1.2`; seta `y: [0,6,0]` | `1.6 s` em ciclo |
| Scan line do hero | `y: "-10%" → "110%"`, `linear`, infinito | `6 s` |
| Halo do hero | `scale [1,1.08,1]`, `opacity [0.6,0.9,0.6]`, infinito | `6 s` |
| Brilho do logótipo | `textShadow` e `boxShadow` em 3 passos, infinito | `2.4 s` |
| Ponto de estado | `opacity [1,0.3,1]`, infinito | `1.6 s` |

CSS puro (Tailwind `transition`): hover dos cartões (cantos, linha de scan que desce com
`translate-y-[400%]` em `duration-1000`), `transition-colors`, `transition-all`.

Regra: a entrada é sempre de cima para baixo, com atraso pequeno e crescente por `index`.
Nenhuma entrada passa de 0,6 s.

## Fundo do hero (sem imagens)

Grelha de 48 px feita com dois `linear-gradient` de 1 px, a `opacity-[0.04]`, com
`maskImage: radial-gradient(ellipse at center, black 30%, transparent 80%)`. Zero ficheiros de
imagem.

## Como mudar o tema

1. `tailwind.config.ts`: as 5 cores em `colors` e `boxShadow.glow`.
2. `app/globals.css`: as mesmas 5 variáveis e o `::selection`.
3. Procurar `0,255,136` e `00FF88` em todo o projeto e trocar pelo novo acento.
4. `app/layout.tsx`: fontes.
