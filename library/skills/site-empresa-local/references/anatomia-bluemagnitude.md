# Anatomia do site Blue Magnitude

Fonte: `tomas476/bluemagnitude`. Cliente: instalações fotovoltaicas em Leiria (serviços em Leiria, Santarém e Lisboa). O site antigo era WordPress com um tema comprado (Energyland). O novo foi feito de raiz, em 26 a 31 de agosto de 2026, com revisões no iPhone do Tomás.

Os ficheiros citados estão copiados em `assets/bluemagnitude/` com o mesmo caminho do repositório (a pasta `[slug]` chama-se `slug` na skill).

## Stack

- Next 16.2 + React 19 + Tailwind 4 (`@tailwindcss/postcss`). `lucide-react`, `clsx`, `tailwind-merge` são as únicas dependências além do Next.
- `next.config.ts`: `output: "export"`, `trailingSlash: true`, `images: { unoptimized: true }`, `basePath` e `assetPrefix` vindos de `BASE_PATH`.
- **Zero framer-motion, zero GSAP, zero shadcn.** Todo o movimento é CSS mais um `IntersectionObserver` (`reveal.tsx`) e um ou outro `requestAnimationFrame`.
- Letra: Manrope pelo `next/font/google` (400 a 800), variável CSS `--font-manrope`.
- Tailwind 4: um token `--color-x` declarado em `@theme` existe como `var(--color-x)` e como utilitário (`bg-shell`, `text-brand`). **Nunca** como `var(--x)`.
- Scripts: `npm run build:pages` define `BASE_PATH=/bluemagnitude`, `NEXT_PUBLIC_BASE_PATH`, `NEXT_PUBLIC_SITE_URL`, corre `next build`, depois `node scripts/prefixar.mjs` e `touch out/.nojekyll`.

## Mapa de páginas

Rotas em `src/content/rotas.ts`; todas passam por `caminho()` (prefixo do Pages).

| Rota | Ficheiro | Para que serve |
|---|---|---|
| `/` | `src/app/page.tsx` | Home: hero → quem somos → reels → serviços → projetos → processo → perguntas → rodapé |
| `/sobre/` | `src/app/sobre/page.tsx` | Arranque com ilustração, números verificáveis, história, missão/visão/equipa/sustentabilidade |
| `/servicos/` | `src/app/servicos/page.tsx` | Índice editorial (folhas empilhadas) dos 6 serviços |
| `/servicos/[slug]/` | `src/app/servicos/[slug]/page.tsx` | Ficha de serviço: capa com fotografia, intro com realces, "O que ganhas", passos |
| `/projetos/` | `src/app/projetos/page.tsx` | Índice dos 5 projetos |
| `/projetos/[slug]/` | `src/app/projetos/[slug]/page.tsx` | Ficha de projeto: especificações técnicas, resumo de uma frase, "Outras instalações" |
| `/contacto/` | `src/app/contacto/page.tsx` | Título, formulário em 3 passos, linhas de contacto com ícone, mapa |
| `/privacidade/` | `src/app/privacidade/page.tsx` | Política reproduzida na íntegra do site antigo |
| 404 | `src/app/not-found.tsx` | |
| `robots.txt`, `sitemap.xml` | `robots.ts`, `sitemap.ts` | Estáticos (`dynamic = "force-static"`) |

**Não há secção de formulário na home.** O formulário vive em `/contacto/`; o resto do site leva lá com "Pedir proposta".

## Ordem da home (`src/app/page.tsx`)

```
<SiteNav />  <AncorasSuaves />
<main id="conteudo" tabIndex={-1}>
  <Hero />                      fora do CampoLuz: é ele que dá a luz
  <CampoLuz>
    <QuemSomos /> <Reels /> <Servicos /> <Projetos /> <Processo /> <Perguntas />
  </CampoLuz>
</main>
<SiteFooter />                  fora: é chapa opaca
```

## Componentes e para que servem

Todos em `assets/bluemagnitude/src/components/` (os marcados com * são só descritos, não copiados).

- `site-nav.tsx`: barra fixa, transparente sobre o hero e "pousa" (fundo branco) por uma sentinela de 1 px com `IntersectionObserver` (zero listeners de scroll). A sentinela tem **10rem**, não `100svh`: com `100svh` a barra ficava invisível pelo meio do hero. Submenu de serviços em desktop (a partir de 64rem). Em telemóvel, folha lateral (`.folha`) com foco preso, Escape fecha, scroll do corpo travado, serviços recolhidos atrás de uma seta. Sombras no logótipo e nos links enquanto está transparente, para o branco ler-se em qualquer fotograma. CSS escrito no próprio ficheiro (`NAV_CSS`).
- `site-footer.tsx`: dois blocos. (1) Faixa de CTA "Pedir proposta" **fora** da chapa escura, na cor do que vem por cima, que leva a `/contacto/`. (2) Rodapé escuro curto: logótipo, discos de Instagram e Facebook, botão "Contactos", linha legal. Morada, email e horário vivem só em `/contacto/`.
- `reveal.tsx`: o motor de entrada. `armed` via `useSyncExternalStore` (a classe `.reveal` só entra depois de montar, para quem tem JS bloqueado não ficar em branco), dois `requestAnimationFrame` encadeados, `threshold: 0`, **zero `rootMargin` negativo**. Props: `as`, `delay` (vira `--reveal-delay`), `repetir`, `nome`/`aberto` (para `<details>`).
- `contacto-form.tsx`: formulário em 3 passos, ver `processo-e-contexto.md` e `perguntas-ao-cliente.md`. Validação por passo ao carregar em "Seguinte", foco no primeiro campo em falta, botão nunca desativado, pré-visualização da mensagem, abre `https://wa.me/<número>?text=<encodeURIComponent>` com `window.open(..., "_blank", "noopener,noreferrer")`, ecrã de sucesso com "Abrir a conversa", "Copiar mensagem" e "Fazer outro pedido".
- `ancoras-suaves.tsx`: um único listener de clique delegado no documento para `#âncoras`, desconta a barra (`ALTURA_DA_BARRA = 64`), e corrige a posição de chegada com `#hash` com dois `rAF`.
- `marca.tsx`: o logótipo do cliente em `<img>` (`logo-cor.png` 1305x469, `logo-branco.png` 690x248). "O logótipo é do cliente e não se redesenha."
- `hero/hero.tsx`: `section` de `min-h-[100svh]`, `VideoBackdrop` por baixo, título (`display`, `max-w-[16ch]`, 24ch em desktop) com uma parte em `text-ink-soft`, dois botões (`btn` e `btn--contorno`). Entra com a classe `rise` e `animation-delay` de 40, 80 e 280 ms.
- `hero/video-backdrop.tsx`: `<video loop muted playsinline>` e mais nada. O vídeo fica `opacity: 0` até ao evento `playing` (um vídeo pausado no iOS desenha o botão de play do sistema). Se `play()` for recusado 3 vezes, desmonta e fica o poster a "respirar" (`hero-respira`). Tenta de novo no primeiro toque e no `visibilitychange`. Posters webp horizontal e vertical; `prefersLightweight()` (em `lib/lightweight.ts`) corta o vídeo com poupança de dados ou 2G.
- `ui/campo-luz.tsx`: uma camada de luz por baixo de todo o conteúdo depois do hero (verde em cima, azul em baixo). **As percentagens do foco de cima têm de ser iguais às da lavagem de saída do hero** (camada 2b do video-backdrop, 10% de verde): senão aparece uma risca horizontal na emenda.
- `ui/cabecalho-seccao.tsx`: ritmo fixo do cabeçalho de secção: `credito`, 8 px, título, 12 px, `lede`.
- `ui/acordeao.tsx`: perguntas frequentes em `<details>` com estado controlado (uma aberta de cada vez), a animação no conteúdo, não na altura.
- `ui/pagina.tsx`: molde das páginas interiores (barra já pousada, migalhas, `credito`, título, `lede`, `CampoLuz`). Props `tituloTeclado`, `gigante`, `fita`.
- `ui/texto-realcado.tsx`: parte o texto por `**` e envolve em `<strong class="realce">`.
- `ui/titulo-teclado.tsx`: título escrito à máquina. **O texto completo está sempre no DOM** (um `span` só para leitores de ecrã); as letras entram por `opacity` com `animation-delay` de 45 ms por letra; quebra por palavra (spans `nowrap`). Opção `aoEntrar` espera pelo `Reveal`.
- `ui/passos.tsx`: os passos do processo com a linha que se desenha. As keyframes são geradas no servidor, uma por posição, porque no regresso a ordem inverte-se.
- `ui/lista-luz.tsx`: lista vertical com uma "gota de luz" que acumula num tópico e cai para o seguinte. Variante `icone` (ícones lucide em círculos). Altura fixa por tópico (`--passo: 3.5rem`).
- `ui/fita-servicos.tsx`*: marquee dos serviços com fotografia, scroll nativo (`overflow-x: auto`, três cópias da lista, `scrollLeft` somado por rAF), arrastável com o rato, setas esquerda/direita.
- `ui/paineis.tsx`*: painéis expansivos (o ativo cresce, flex 7 contra 1, 700 ms). Vertical em ecrã pequeno, horizontal a partir de 48rem.
- `ui/lista-editorial.tsx`*: índices `/servicos/` e `/projetos/`: folhas brancas empilhadas, cada uma tapa o pé da anterior (`margin-top: -5.5rem`); em telemóvel vira fotografia 4:3 com título sobre tinta.
- `ui/carrossel.tsx`* (45 KB): coverflow dos reels, vindo de outro site do Tomás.
- `ui/capa-foto.tsx`*: capa fotográfica das fichas, com o mesmo blend do hero.
- `ui/marca-nasce.tsx`, `ui/sol-nasce.tsx`*: animações da marca em WebP com alfa, num `<picture>` com `<source media="(prefers-reduced-motion: reduce)">`.
- `home/*`*: `quem-somos`, `reels`, `servicos`, `projetos`, `processo`, `perguntas`: cada uma é `<section className="field-shell section">` com `CabecalhoSeccao` e `Reveal`.

## Conteúdo (`src/content/site.ts`, 28 KB)

Constantes tipadas, uma por bloco: `EMPRESA` (nome, claim, promessa, morada, telefone, whatsapp `351...`, email, horário, zonas, redes), `HERO`, `QUEM_SOMOS` (título, parágrafos, 4 pilares, imagem), `SERVICOS` (6, cada um com `slug`, `nome`, `resumo`, `titulo`, `intro` com `**realces**`, `imagem`, `lista`, `extra`), `PROJETOS` (5, com potência em W, painéis, inversor, bateria, local), `PROCESSO` (4 passos), `PERGUNTAS` (7), `CONTACTO` (garantias, distritos, tipos de serviço), `PRIVACIDADE`, `SOBRE`. Todo o texto saiu do site antigo numa auditoria; o que falta está nas perguntas ao cliente.

Imagens são caminhos passados por `caminho()`. Campos que existem no `site.ts` mas já não têm consumidor (`HERO.lede`, `CONTACTO.lede`) ficaram lá de propósito.

## SEO e metadados (`src/app/layout.tsx`)

- `metadataBase` a partir de `NEXT_PUBLIC_SITE_URL` (cada build põe o seu endereço, com a subpasta do Pages).
- Cartão de partilha: `og-bluemagnitude.jpg`, URL escrito por extenso, `width: 1200`, `height: 630`, `type: "image/jpeg"`, `twitter.card: "summary_large_image"`. **O nome do ficheiro é a versão do cartão**: o WhatsApp e o Facebook guardam por URL. Trocar o conteúdo sem trocar o nome deixa a conversa a mostrar o antigo durante dias.
- `title.template: "%s · Blue Magnitude"`, `lang="pt-PT"`, `locale: "pt_PT"`.
- Páginas dinâmicas têm `generateStaticParams` e `generateMetadata`.
- `<a class="skip-link" href="#conteudo">` no `body`; `main` com `id="conteudo" tabIndex={-1}`.
- Não há JSON-LD no repositório. Acrescenta `LocalBusiness` com os dados de `EMPRESA`.

## Pasta `public/`

`marca/` (logótipos, ícone, WebP animados), `video/` (`hero-lg.mp4` 5,3 MB, `hero-vert.mp4` 1,9 MB, posters webp), `projetos/` (fotografias JPG), `reels/` (`<id>.mp4` e `<id>.webp`, ~19 MB os cinco), `sobre/`, `og-bluemagnitude.jpg`. A skill não traz nenhum destes ficheiros.
