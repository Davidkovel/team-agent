---
name: realtor-landing
description: Constrói sites premium de consultores imobiliários e agências em Portugal, sem build e sem npm — HTML + CSS + JS vanilla. O género tem fundo animado fixo (barras em gradiente com respiração desfasada), reveals ao scroll por IntersectionObserver, painéis de vidro sobre fundo transparente, hero com retrato recortado, três simuladores que funcionam (crédito habitação, IMT + Imposto do Selo, mais-valias de IRS), pré-visualização de link (cartão OG 1200x630 que aparece no WhatsApp), navbar em pílula fixa com submenus, i18n PT/EN/FR e seletor de idioma, e formulários sem backend que abrem uma conversa de WhatsApp já preenchida. USE THIS SKILL sempre que o pedido tocar em qualquer um destes elementos, ou quando alguém disser "site para consultor imobiliário", "landing de imobiliária", "site de agente/mediadora/REMAX/Century21/KW", "página para vender casas", "adicionar um simulador", "simulador de crédito/IMT/mais-valias", "trocar a paleta", "mudar as cores e as fontes do site", "adicionar uma secção", "ficha de imóvel", "carrossel de reels", "o link não mostra imagem quando partilho", "o cartão do WhatsApp está em branco", "o formulário não envia", "o site salta no telemóvel", ou pedir uma auditoria/deploy de um site deste género. Serve tanto para construir de raiz como para alterar, auditar ou herdar um site já feito neste molde.
---

# Site de consultor imobiliário (PT)

## O que é o género

Um site de 8 páginas estáticas, entregue como pasta, que abre por `file://` ou de um bucket.
O fundo é uma camada fixa animada que se vê através de todas as secções; o contraste nasce
sempre de painéis de vidro locais, nunca de fundos opacos. O conteúdo é sóbrio e o movimento
serve para dar peso, nunca para chamar atenção. O que o distingue de um portfólio bonito são
os três simuladores fiscais que funcionam a sério e o cartão de partilha — é por eles que
alguém abre o site sem andar à procura de um imóvel específico.

## Regras não negociáveis

1. **Zero traços decorativos.** Sem barrinhas de acento, sem réguas, sem separadores. Números
   e etiquetas vivem em cápsulas arredondadas. A única linha animada tolerada é o sublinhado
   de link de rodapé, que cresce do zero no hover.
2. **Um só acento.** `--accent` e `--accent-2` são a mesma cor em dois níveis; a escolha entre
   elas é decisão de contraste. Sem segunda cor de destaque, sem verdes de sucesso, sem
   vermelhos decorativos. Gradientes só entre os dois.
3. **Um só easing:** `cubic-bezier(.4,0,.2,1)`, em tudo. Nada de bounce, elastic ou overshoot.
4. **Nunca `tel:` num CTA de navegação.** Em macOS abre o FaceTime. `tel:` só em botões que
   digam literalmente "Ligar" e no ícone de telefone do rodapé. "Contactar" vai a WhatsApp.
5. **Formulários sem backend abrem WhatsApp**, com `window.open(..., '_blank', 'noopener')`,
   validação própria com `aria-invalid`, e `encodeURIComponent` sobre a mensagem inteira.
   Sem recolha de dados, logo sem caixa de consentimento — mas com nota debaixo do botão e
   `privacidade.html` no rodapé.
6. **Conteúdo pt-PT vindo de um único ficheiro** (`content.json`) e nunca inventado. AMI, NIF,
   prémios, anos de mercado, número de imóveis vendidos: ou vêm do cliente, ou não entram.
   Um facto que não existe não se estima. O mesmo vale para números fiscais nos simuladores.
7. **`prefers-reduced-motion` sempre**, em CSS e em JS. `reduce` significa sem movimento, não
   sem conteúdo: nada desaparece, nada fica invisível à espera de uma animação que não corre.
8. **O estado inicial dos reveals só existe com JS** (classe `.xx-js` no `<html>`). Sem JS, a
   página fica visível e estática — nunca meio site invisível.
9. **Cada site novo muda paleta, par tipográfico e um ou dois mecanismos de assinatura.** A
   estrutura, as medidas e o movimento mantêm-se; a assinatura visual não. Um site novo com o
   par tipográfico de um anterior lê-se como template. Isto não é sugestão.

---

## Workflow

### Fase 0 — Briefing e `content.json`
Recolher do cliente, por escrito, antes de tocar em código: nome, função, agência/rede, AMI,
cidade e zona de actuação, telefone E.164, número de WhatsApp (`351XXXXXXXXX`, sem `+` nem
espaços), Instagram, domínio que **resolve agora**, a linha de prova (um facto verificável:
anos, imóveis, distinção), fotografia de retrato para recortar, logótipo, e os imóveis que
vão para o ar. Tudo isto vive num `content.json` que alimenta os placeholders das páginas. O
cartão OG usa um JSON próprio, plano e de chaves maiúsculas, gerado com
`scripts/render-og.py --print-defaults > og-data.json` e preenchido à mão a partir do
`content.json` — o `content.json` não serve directamente ao `--data`. Qualquer campo que o
cliente não confirme fica vazio e a secção correspondente não se constrói.
Decidir aqui o mapa de páginas: núcleo de 8 (`sections.md` §1.1) e, só com os limiares
cumpridos, as extras de equipa (`imoveis.html` com ≥6 imóveis, `equipa.html` com ≥4 pessoas,
`premios.html` com distinções verificáveis).
**Lê:** `references/sections.md` §1.

### Fase 1 — Paleta e tipografia
Escolher `--bg`, `--ink`, `--muted`, `--faint`, `--accent`, `--accent-2`, `--line` e o par
display+sans. Decidir variante escura ou clara (a clara inverte sombras, `inset` e a lógica
do par de acentos). Verificar AA do acento sobre o fundo animado — é o motivo de existir o
`--accent-2`. Escrever os tokens uma única vez em `:root`. `--bg` tem de ser exactamente a
`backgroundColor` da camada de fundo.
**Lê:** `references/design-system.md` §1–3 e §10.

### Fase 2 — Shell
Montar `head.html`, `navbar.html`, `footer.html`, `shell.css`, `shell.js` a partir de
`assets/shell/`. Via A (ficheiros partilhados) para sites novos; Via B (tudo colado) só para
entrega de ficheiro único. Ligar o fundo animado (`.gbars` + `.gveil`), o i18n PT/EN/FR, o
menu mobile com focus trap, e substituir todos os placeholders. Confirmar as âncoras cruzadas
(`index.html#top` fora da home) e o `aria-current="page"`.
**Lê:** `references/shell.md` inteiro + `references/motion.md` §1 e §4.

### Fase 3 — Secções
Construir a home pela ordem canónica: hero com retrato recortado, ponte, prova, imóvel em
destaque, convite, social, footer. Depois `sobre.html`, `vender.html`, `imovel.html`,
`privacidade.html`. Respeitar a alternância densa/respirável e a regra de nunca encostar dois
painéis de vidro. Ligar os reveals com o prefixo próprio de cada secção.
**Lê:** `references/sections.md` §2–14 + `references/motion.md` §2, §3, §5–8.

### Fase 4 — Simuladores
`credito.html`, `imt.html`, `mais-valias.html`, com o cálculo puro em `assets/calculators.js`
(sem DOM). Recálculo em tempo real, sem botão. Inputs `type="text" inputmode="decimal"` com
parser pt-PT. Painel `aria-live="polite"` que actualiza por `textContent` e nunca se
reconstrói. Disclaimer específico com o ano das tabelas à vista, e CTA de WhatsApp com texto
próprio. Correr os valores de validação antes de dar por terminado.
**Lê:** `references/calculators.md` inteiro.

### Fase 5 — Cartão OG e metas
Preencher `assets/og-card.html`, gerar o esqueleto de dados com `scripts/render-og.py
--print-defaults > og-data.json` (dicionário plano de chaves maiúsculas: `NOME`, `FUNCAO`,
`KICKER`, `COR_FUNDO`…), preenchê-lo à mão a partir do `content.json` e renderizar com
`scripts/render-og.py --data og-data.json --out site/assets/og-{{SLUG}}-v1.jpg`. Colar o bloco `<head>` completo em todas as páginas,
com `og:url` e `og:title` próprios por página. URLs absolutas no domínio que resolve.
Favicons: os cinco ficheiros. `theme-color` igual a `--bg`.
**Lê:** `references/link-preview.md` inteiro.

### Fase 6 — Auditoria
Percorrer a checklist de entrega abaixo, com o site já no domínio final. Procurar `{{` em
todos os ficheiros. Testar teclado, reduced-motion, JS desligado, telemóvel real. Correr
Lighthouse. Só depois disto se fala em entrega.

### Fase 7 — Deploy
Subir a pasta. Se o domínio definitivo mudou desde a fase 5, **voltar aos metas** e trocar
`og:url`, `og:image`, `twitter:image` e `canonical` — e mudar o nome do ficheiro OG para
`-v2` para furar a cache dos scrapers. Forçar refresh no Facebook Sharing Debugger e no
LinkedIn Post Inspector. Testar a partilha num telemóvel que nunca recebeu o link.

---

## Quero X, leio Y

| Quero… | Leio |
|---|---|
| escolher/trocar a paleta, as fontes, os raios, o espaçamento | `references/design-system.md` |
| a receita do vidro, ou desligar o blur em telemóvel | `references/design-system.md` §5 |
| perceber a regra de ouro dos traços e das cápsulas | `references/design-system.md` §7 |
| montar o fundo animado, ou afiná-lo | `references/motion.md` §1 |
| um reveal ao scroll, ou escalonar entradas | `references/motion.md` §2 |
| a entrada do hero, ou uma variante centrada | `references/motion.md` §3 |
| navbar, dropdowns, menu mobile, focus trap, bloqueio de scroll | `references/motion.md` §4 + `references/shell.md` §4 |
| o clarão de vidro (sheen) ou o desenho SVG em ciclo | `references/motion.md` §5–6 |
| hovers de cartão | `references/motion.md` §7 |
| o carrossel de reels (leque no desktop, tira no telemóvel) | `references/motion.md` §8 |
| saber que duração usar numa transição | `references/motion.md` §9 |
| o bloco de `prefers-reduced-motion` completo | `references/motion.md` §10 |
| um bug de movimento, véu, máscara ou especificidade | `references/motion.md` §11 |
| decidir que páginas existem, e se há extras de equipa | `references/sections.md` §1 |
| hero com retrato recortado | `references/sections.md` §3 |
| ponte, convite, prova/indicadores | `references/sections.md` §4, §6, §9 |
| cartão de imóvel clicável, ou ficha de imóvel com lightbox | `references/sections.md` §5, §7 |
| card pessoal do `sobre.html` | `references/sections.md` §10 |
| a página `vender.html` e o painel de avaliação | `references/sections.md` §11 |
| o footer com nome gigante | `references/sections.md` §12 |
| formulários, WhatsApp, RGPD, `privacidade.html` | `references/sections.md` §13 |
| ordem, ritmo e densidade das secções | `references/sections.md` §14 |
| montar o esqueleto partilhado, i18n, acessibilidade | `references/shell.md` |
| qualquer simulador, ou acrescentar um quarto | `references/calculators.md` |
| o cartão que aparece no WhatsApp, metas OG, favicons | `references/link-preview.md` |

---

## Checklist de entrega

- [ ] O hero usa `100svh` (não `100vh`) e não sobra faixa nem corta no telemóvel real; barra do browser a aparecer e a desaparecer não muda o layout
- [ ] Teste de partilha: link enviado para um telemóvel que **nunca** o recebeu, e o cartão aparece com nome, função e linha de prova legíveis
- [ ] `og-{{SLUG}}-vN.jpg` existe, 1200×630, JPEG, abaixo de ~300 KB, com sufixo de versão novo
- [ ] `og:image`, `twitter:image`, `og:url` e `canonical` absolutos, no domínio que resolve agora
- [ ] Crédito: 450 000 € / entrada 90 000 € / 30 anos / Euribor 2,31 % + spread 1,2 % → prestação **1 618,57 €**, MTIC **593 753,02 €**
- [ ] IMT: HPP, 200 000 €, sem IMT Jovem → **3 747,08 €**; IMT Jovem isento até 316 772 €, tecto 633 453 €, pro-rata por quota
- [ ] Mais-valias: coeficiente e taxa de IRS pedidos ao utilizador (default 1,00 e 32 %), englobamento de 50 %, reinvestimento sobre a base já deduzida do crédito amortizado
- [ ] Regiões Autónomas devolvem a mensagem de contacto, não um número
- [ ] `prefers-reduced-motion` ligado no sistema: nada se mexe, nada desaparece, tudo se lê
- [ ] Teclado: `Tab` da barra ao rodapé, abrir e fechar menu, submenus e seletor de idioma, sempre com anel de foco visível; `Esc` fecha e devolve o foco
- [ ] JS desligado: o conteúdo aparece todo (só o fundo animado desaparece)
- [ ] Lighthouse corrido em mobile: performance, acessibilidade e boas práticas verificadas, sem erros de contraste
- [ ] Todas as imagens em `.webp` (retratos recortados em PNG/WebP com alpha), com `width` e `height` no markup e `loading="lazy"` fora do hero
- [ ] Zero dados inventados: AMI, NIF, prémios, anos e números conferidos com o cliente
- [ ] Favicon completo: `svg`, `32`, `48`, `192`, `apple-touch-icon` 180, `theme-color` igual a `--bg`
- [ ] Nenhum `{{PLACEHOLDER}}` sobrou (procurar `{{` em todos os ficheiros)
- [ ] Zero `tel:` em CTAs de navegação; AMI no rodapé; `privacidade.html` linkada
- [ ] Âncoras `index.html#…` corrigidas fora da home e `aria-current="page"` na página certa

---

## Armadilhas conhecidas

- **O véu do hero tem de chegar a zero no último pixel**, com máscara escalonada (38/58/74/88/100%), e a secção seguinte não pode ter véu nenhum. Dois véus locais adjacentes somam-se e o degrau fica pior. (`motion.md` §11.1)
- **Qualquer elemento encostado ao limite de um container com `overflow:hidden` precisa de máscara de saída própria** — o overflow corta a direito, a máscara dilui. (`motion.md` §11.2)
- **Media queries não acrescentam especificidade.** As regras responsivas de uma secção vivem imediatamente a seguir às regras base dessa secção, ou no fim da folha com comentário. Caso contrário são código morto silencioso. (`motion.md` §11.3)
- **`transform:none` apaga a centragem.** Elementos centrados por `translateX(-50%)` repetem o translate em todos os keyframes e no bloco `reduce`. (`motion.md` §11.4)
- **Tirar e pôr uma classe não reinicia a animação** — é preciso `void el.offsetWidth` entre as duas operações. (`motion.md` §11.5)
- **Reveals fazem `unobserve`; observers de estado não.** (`motion.md` §11.6)
- **Se o JS escreve estilos inline num modo, tem de os limpar ao sair desse modo** — inline ganha a media queries. (`motion.md` §11.7)
- **`touch-action: pan-x pan-y`, os dois eixos.** `pan-x` sozinho sequestra o gesto vertical. (`motion.md` §11.8)
- **Bloqueio de scroll com contador, não booleano**, e a compensar a largura da barra. (`motion.md` §11.9)
- **`will-change` só onde é preciso** — espalhado, degrada o que devia melhorar. (`motion.md` §11.11)
- **Os scrapers fazem cache por URL.** Substituir o ficheiro no servidor não chega: muda o nome (`-v2`) e os metas. (`link-preview.md` §2, regra 3)
- **`og:image` num domínio que ainda não resolve** faz a partilha sair sem pré-visualização, sem nada no site a denunciar o problema. (`link-preview.md` §2, regra 1)
- **Um cartão OG só com o monograma não identifica ninguém.** Nome + função + linha de prova, sempre. (`link-preview.md` §2, regra 2)
- **`0.07 * 100` dá `7.000000000000001`** — arredondar com `toFixed(3)` antes de formatar percentagens. (`calculators.md` §4)
- **`type="number"` recusa a vírgula em teclados portugueses.** (`calculators.md` §4)
- **`{{WHATSAPP}}` sem `+`, sem espaços, sem traços** — `wa.me` rejeita tudo o resto; e `encodeURIComponent` sobre a mensagem inteira, não linha a linha. (`sections.md` §13)
- **`body{background:transparent}` não é erro** — o fundo vive no `<html>`, senão o body pinta por cima da camada de fundo. (`design-system.md` §4)

---

## Estrutura de ficheiros da skill

```
skills/realtor-landing/
├── SKILL.md                      este mapa
├── references/
│   ├── design-system.md          tokens, acento único, tipografia, vidro, botões, raios, variante clara
│   ├── motion.md                 fundo animado, reveals, hero, navbar, sheen, SVG, carrossel, durações, reduced-motion, armadilhas
│   ├── sections.md               mapa de páginas e catálogo de secções, formulários sem backend, ordem e ritmo
│   ├── calculators.md            os três simuladores: fórmulas, tabelas fiscais, UX partilhada, valores de validação
│   ├── link-preview.md           cartão OG, bloco <head>, as três regras que partem a partilha, checklist
│   └── shell.md                  esqueleto partilhado: vias de montagem, placeholders, navegação, i18n, a11y, reveals
├── assets/
│   ├── shell/head.html           <head> completo com placeholders (SEO, OG, favicons, fontes)
│   ├── shell/navbar.html         pílula fixa, submenus, seletor de idioma, menu mobile
│   ├── shell/footer.html         rodapé completo (nome gigante, sociais, nav, legais)
│   ├── shell/shell.css           tokens, reset, botões, gbars, navbar, footer, reveals, a11y, reduced-motion
│   ├── shell/shell.js            gbars, scroll lock, menu, dropdowns, i18n, reveals
│   ├── calculators.js            cálculo puro dos três simuladores, sem DOM, testável em Node
│   └── og-card.html              template do cartão 1200×630 com placeholders
└── scripts/
    └── render-og.py              renderiza og-card.html para JPEG 1200×630 (Playwright, ou imprime o comando de Chrome headless)
```

E, ao lado da skill, no mesmo repositório:

```
starter/                          site de arranque que JÁ FUNCIONA — copiar e trocar o content.json
├── index.html                    hero, ponte, cartão de imóvel, prova, footer
├── credito.html                  o simulador de crédito ligado a assets/calculators.js
├── content.json                  o contrato: todos os factos do cliente num só sítio
└── README.md                     como correr (python3 -m http.server 8777) e o que trocar primeiro

agents/
├── realtor-site-builder.md       o subagente que executa um site de raiz sozinho
└── PROMPTS.md                    prompts prontos a copiar (site novo, secção nova, 4.º simulador,
                                  cartão OG, troca de paleta, auditoria, deploy)
```

**Começar um site novo é copiar o `starter/`, não escrever do zero.** As secções que faltam
constroem-se com `references/sections.md`; o `content.json` é o primeiro ficheiro a mudar.

### Precedência entre `content.json` e o dicionário i18n

Um elemento pode ter `data-c` (texto do cliente, vindo do `content.json`) e `data-i18n`
(tradução) ao mesmo tempo. A regra, implementada em `applyLang`: **em PT manda o `content.json`;
em EN/FR manda o dicionário.** Sem esta precedência o dicionário corre depois do `content.js` e
reescreve por cima — e mudar um texto no `content.json` deixa de ter qualquer efeito visível.
