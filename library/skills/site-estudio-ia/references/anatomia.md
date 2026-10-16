# Anatomia do site

Tudo em `assets/starter/`. Caminhos iguais aos do repositório original.

## Páginas

| Rota | Ficheiro | Para que serve |
|---|---|---|
| `/` | `app/page.tsx` | Compõe as 5 secções: Hero, About, Products, Services, Contact. |
| `/work` | `app/work/page.tsx` | Lista completa dos `products` em grelha de 2 colunas. Tem o seu `metadata` (`title: "Work"`). |
| todas | `app/layout.tsx` | `<html>`, fontes, `metadata` (SEO), `<Navbar />`, `<main>`, rodapé. |

## Layout (`app/layout.tsx`)

- Fontes `Inter` (`--font-inter`) e `JetBrains_Mono` (`--font-jetbrains`) via
  `next/font/google`, `display: "swap"`, subset `latin`. Ligadas ao Tailwind em `fontFamily`.
- `<body className="font-sans bg-bg text-text-primary antialiased">`.
- Rodapé: `border-t border-subtle py-10 px-6`, texto mono `text-xs text-text-muted`, ano com
  `new Date().getFullYear()`.
- `metadataBase`, `title.template` `"%s · NeoDaemon"`, `openGraph`, `twitter`, `icons`.

## Componentes (`components/`)

Todos com `"use client"` (usam Framer Motion ou estado).

| Componente | Para que serve | Notas |
|---|---|---|
| `Navbar.tsx` | Cabeçalho fixo, `h-16`, `backdrop-blur-md`. | Escurece depois de 20 px de scroll (`scrolled`). Links no array `links` (`/work`, `/#services`, `/#contact`). Menu hambúrguer abaixo de `md`. |
| `NeoLogo.tsx` | Logótipo em texto `</ND>` com brilho a pulsar. | Props: `size` (`sm`/`md`/`lg`/`xl`), `withCircle`, `animated`, `className`. Para outro estúdio, trocar a string `"</ND>"`. |
| `HeroSection.tsx` | Primeiro ecrã, `min-h-screen`, centrado. | Grelha de fundo a 4 % de opacidade com máscara radial, linha a descer (scan line), halo a respirar, logótipo, `h1`, frase, 2 botões, seta «SCROLL». |
| `AboutSection.tsx` | Quem somos. `id="about"`. | Etiqueta `$ whoami`, título, 2 parágrafos, `roles` (cápsulas) e `stats` (3 números). Largura `max-w-3xl`. |
| `ProductsSection.tsx` | Grelha de produtos. `id="products"`. | Lê `products` de `lib/data.ts`; um `ProductCard` por item. |
| `ProductCard.tsx` | Cartão de produto/projeto. | Número `01`, etiqueta, estado com ponto a piscar (`Live`/`Active`), nome, descrição. Cantos que acendem e linha de scan no hover. |
| `ServicesSection.tsx` | Serviços. `id="services"`. | Grelha 1/2/3 colunas (`md`/`lg`) com linhas de 1 px entre cartões. Lê `services`. |
| `ContactSection.tsx` | Contacto. `id="contact"`. | Formulário nome/e-mail/mensagem; no submit abre `mailto:` com assunto e corpo preenchidos. Lê `contactEmail`. |

## Ritmo das secções

Cada secção: `py-28 px-6 border-t border-subtle`, contentor `max-w-6xl mx-auto` (`max-w-3xl`
em About e Contact). Cabeçalho de secção igual em todas:

1. etiqueta mono `text-xs text-accent tracking-widest mb-4` (`// PRODUCTS`);
2. título `text-3xl md:text-4xl font-medium tracking-tight`.

## Âncoras

`#about`, `#products`, `#services`, `#contact`. O `html` tem `scroll-behavior: smooth`. Da
página `/work`, os links usam `/#services` e `/#contact` para voltar à home.

## Ficheiros de configuração

`tailwind.config.ts`, `postcss.config.js` (tailwindcss + autoprefixer), `tsconfig.json`
(alias `@/*` para a raiz, `strict: true`), `next.config.mjs` (`reactStrictMode`,
`output: "standalone"`), `package.json`, `Dockerfile`, `gitignore.txt`, `dockerignore.txt`.

## Adaptar a outro tipo de site

- **Freelancer**: o `AboutSection` fala de ti; `products` = projetos; `services` = o que vendes.
- **Agência**: acrescentar `team` e `clients` em `data.ts`, cada um com uma secção copiada de
  `ServicesSection`.
- **Portefólio**: mudar o `h1` do hero para o teu nome; apagar a secção que não tens e o link
  correspondente no `Navbar`.
