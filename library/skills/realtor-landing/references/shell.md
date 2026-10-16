# SHELL PARTILHADO

O esqueleto que todas as páginas do site repetem: `<head>`, camada de fundo, navbar
(com submenus e seletor de idioma), footer, o CSS de tudo isso e o JS de tudo isso.

Origem: site de referência do género (index/vender/crédito com heads idênticos), cruzado
entre as três páginas para confirmar o que é mesmo partilhado. Os ficheiros vivem em `assets/shell/`:

| Ficheiro | O que é |
|---|---|
| `assets/shell/head.html` | `<head>` completo com placeholders (SEO, OG, favicons, fontes) |
| `assets/shell/navbar.html` | pílula fixa + submenus + seletor de idioma + menu mobile |
| `assets/shell/footer.html` | rodapé completo (nome gigante, sociais, navegação, legais) |
| `assets/shell/shell.css` | tokens, reset, botões, gbars, navbar, footer, reveals, a11y, reduced-motion |
| `assets/shell/shell.js` | gbars, scroll lock, menu mobile, dropdowns, i18n, seletor de idioma, reveals |

---

## 1. Duas vias de montagem, e qual escolher

### Via A — ficheiros partilhados (**recomendada para sites novos**)

```html
<link rel="stylesheet" href="assets/shell.css" />
<script defer src="assets/shell.js"></script>
```

`shell.css` e `shell.js` são autónomos: funcionam tal como estão, sem build, sem npm.
O `defer` garante que o script corre com o DOM já montado (por isso o `shell.js` não
usa `DOMContentLoaded`) e sem bloquear o render.

O HTML da navbar e do footer continua a ser copiado para dentro de cada página — sem
build não há includes — mas o navbar/footer é markup estático que muda uma vez por ano,
e o CSS/JS é o que se mexe todas as semanas.

### Via B — tudo colado dentro da página

`<style>` com o conteúdo de `shell.css` no `<head>`, `<script>` com o conteúdo de
`shell.js` antes de `</body>`. Foi assim que o site de referência foi feito.

**Só faz sentido quando:** a entrega é literalmente um ficheiro (uma landing única,
um HTML enviado por email, um preview que tem de abrir por `file://` sem servidor).

### O custo real da Via B

O site de referência tem sete páginas e o shell está duplicado nas sete. Isso significa,
na prática:

- mudar uma entrada da navbar → editar sete ficheiros, sem falhar nenhum;
- corrigir um bug do menu mobile → sete vezes o mesmo patch;
- as páginas ficam com 90–125 KB cada, quase tudo shell repetido, e **nada** disso é
  cacheado entre páginas: o visitante que vai da home para "Vender" volta a descarregar
  a navbar inteira;
- as versões desalinham-se em silêncio. Uma legenda de menu corrigida numa página e
  esquecida noutra só se descobre quando o cliente reclama.

Com a Via A, `shell.css` e `shell.js` são descarregados uma vez e servidos do cache em
todas as páginas seguintes, e a correção é feita num sítio.

**Regra do kit: site novo → Via A. Ficheiro único → Via B. Site herdado já duplicado →
não se converte a meio; converte-se todo de uma vez ou não se converte.**

---

## 2. Placeholders

Nunca deixar dados reais nos ficheiros do kit. Substituir na cópia da página:

| Placeholder | Exemplo de valor |
|---|---|
| `{{NOME}}` | nome do consultor |
| `{{AGENCIA}}` | agência / rede |
| `{{AMI}}` | número(s) de licença AMI (obrigatório por lei no rodapé) |
| `{{CIDADE}}` | cidade base |
| `{{ANO}}` | ano do copyright |
| `{{DOMINIO}}` | `https://exemplo.pt` (sem barra final) |
| `{{PAGINA}}` | `""` na home, `vender.html` nas outras |
| `{{TELEFONE_E164}}` | `+351XXXXXXXXX` |
| `{{WHATSAPP}}` | `https://wa.me/351XXXXXXXXX` |
| `{{INSTAGRAM}}` | URL do perfil |
| `{{TITULO}}`, `{{DESCRICAO}}` | SEO por página |
| `{{HOME}}`, `{{COMPRAR}}`, `{{REDES}}` | âncoras (ver ponto 4) |

---

## 3. Ordem do `<body>`

```
<body>
  <div class="gbars" id="gbars" aria-hidden="true"></div>   <!-- fundo fixo -->
  <div class="gveil" aria-hidden="true"></div>              <!-- véu global -->

  <header class="hero" id="top"> … </header>                <!-- da página -->

  … navbar.html …                                           <!-- position:fixed -->

  … secções da página …

  … footer.html …
</body>
```

Duas coisas que parecem erro e não são:

- **`body{background:transparent}`.** O fundo vive no `<html>`. Se o body tiver fundo
  próprio, pinta por cima da camada `.gbars` (que está em `z-index:-2`) e as barras
  desaparecem.
- **A navbar vem depois do hero no HTML.** É `position:fixed`, portanto a ordem visual
  não depende da ordem do documento — e assim o hero é o primeiro conteúdo que o leitor
  de ecrã e o crawler encontram. Se isto incomodar, acrescentar um link de salto
  (`.skip`, já estilizado no `shell.css`).

---

## 4. Navegação — as regras

**"Imóveis" não navega.** É um `<button class="nv__top">` que desce um painel com
*Comprar* e *Vender*. Um item de topo que é destino **e** abre submenu obriga a adivinhar
se o clique navega ou abre, e em ecrã táctil nunca chega a abrir. O mesmo vale para
"Ferramentas", que desce os três simuladores: Crédito, Mais-Valias, IMT.

**Nunca `href="tel:"` num CTA de navegação.** Em macOS o `tel:` abre o FaceTime e o
utilizador leva com um diálogo que não pediu. No site de origem havia um botão de hero
com `tel:` e foi trocado por uma âncora interna, com o comentário a explicar porquê.
O `tel:` só entra em botões que digam literalmente **"Ligar"** — ou no ícone de telefone
do rodapé, que tem rótulo "Telefone" para leitor de ecrã. Para "Contactar" usa-se o
WhatsApp (`{{WHATSAPP}}`, `target="_blank" rel="noopener"`).

**Âncoras cruzadas.** Na home, `#top` e `#imovel`. Em qualquer outra página têm de ser
`index.html#top` e `index.html#imovel` — é a única diferença de markup entre a navbar da
home e a das interiores, e a que mais vezes se esquece. Vale para a navbar, para o menu
mobile e para o `.ft__nav` do rodapé.

**Página atual.** `aria-current="page"` no link correspondente (na barra e no menu
mobile). O CSS acende-o; sem isso não há pista nenhuma de onde se está.

---

## 5. i18n

Dicionário `I18N` com três idiomas — `pt` (fonte e fallback), `en`, `fr` — em
`shell.js`. Marcação:

- `data-i18n="chave"` → substitui `textContent`;
- `data-i18n="chave" data-i18n-html="1"` → substitui `innerHTML`; só onde a frase precisa
  de `<em>`, `<b>` ou `<br>`, e nunca com texto vindo do utilizador.

`applyLang(lang)` percorre `[data-i18n]`, escreve `document.documentElement.lang` e grava
em `localStorage`. Chave em falta = fica o texto que está no HTML, que está em PT — falhar
uma tradução degrada, não parte.

O idioma persiste em `localStorage.lang` porque cada página é um documento novo: sem build
nem router, é a única memória entre páginas.

O JS de cada página estende o dicionário e volta a aplicar:

```js
Object.assign(Shell.I18N.pt, { 'vd.h1':'…' });
Object.assign(Shell.I18N.en, { 'vd.h1':'…' });
Object.assign(Shell.I18N.fr, { 'vd.h1':'…' });
Shell.applyLang(Shell.lang);
Shell.reveal('.vd-rev');
```

Para strings geradas em JS (validações, resultados de simuladores) usa-se `Shell.T('chave')`,
que cai para PT quando a chave falta.

> **As traduções EN/FR que vêm no kit são um ponto de partida e têm de ser revistas por um
> humano antes de produção.** Nomes próprios, nome da agência e designações legais
> (AMI, IMT, mais-valias, escritura) não sobrevivem a tradução automática.

**Seletor de idioma:** pílula com bandeira + código (`PT`/`EN`/`FR`), `aria-haspopup="listbox"`,
`aria-expanded`, e uma lista `role="listbox"` com opções `role="option"`. A opção ativa leva
`aria-selected="true"` **e** um visto visível — cor sozinha não é sinal suficiente. Há dois
blocos `[data-lang-root]` (barra e menu mobile) e o `shell.js` sincroniza os dois de uma vez.

---

## 6. Acessibilidade

- `aria-expanded` em todos os gatilhos (burger, `.nv__top`, `.lang__btn`), sempre
  atualizado no mesmo sítio onde se mexe na classe `open`.
- `aria-controls` a apontar para o `id` do painel.
- Painéis fechados usam `visibility:hidden`, não só `opacity:0` — assim saem da ordem de
  tabulação e não apanham cliques invisíveis.
- **Foco preso** no menu mobile: `Tab` e `Shift+Tab` circulam dentro do painel, `Esc`
  fecha, e o foco volta ao botão que o abriu.
- Scroll bloqueado enquanto o menu está aberto, com contador (não booleano) e compensação
  da largura da barra de scroll, para a página não saltar lateralmente.
- Vários componentes fazem `outline:none` porque desenham o seu próprio realce; o
  `shell.css` garante um anel `:focus-visible` de base para todos os interativos.
- Ícones sem texto levam rótulo só para leitor de ecrã (`.sr-only` / `.ft__sr`), e o SVG
  leva `aria-hidden="true"`.
- Alvos de toque de 48px nos ícones sociais (44px abaixo de 430px).
- `prefers-reduced-motion` desliga tudo o que se mexe sozinho (barras, entradas, reveals),
  mas mantém o que depende de estado: o sublinhado do rodapé continua a aparecer em foco,
  o menu continua a abrir.

---

## 7. Reveals

No site de origem cada secção tinha o seu prefixo (`.vd-rev`, `.ft-rev`, `.pv-reveal`,
`.rl-rev`) com o mesmo CSS copiado. O shell reduz isso a um padrão:

```html
<div class="rev" style="--rev-d:.12s">…</div>
```
```js
Shell.reveal('.rev');            // ou Shell.reveal('.vd-rev') para um prefixo próprio
```

A classe `.rev-js` é acrescentada ao `<html>` pelo JS e é ela que ativa o esconder no CSS:
sem JS, ou com o JS a falhar, o conteúdo fica **visível** em vez de invisível. Com
`prefers-reduced-motion` mostra-se tudo de uma vez e não se observa nada.

O footer é a exceção deliberada: entra em bloco (`.ft-js` + `.is-ft-in`, um único observer
no `<footer>`), porque as peças escalonam-se por `--ft-d` e não pela posição no ecrã.

---

## 8. Checklist antes de publicar

- [ ] Nenhum `{{PLACEHOLDER}}` sobrou (procurar `{{` em todos os ficheiros).
- [ ] `canonical`, `og:url` e `og:image` absolutos e a apontar para o domínio que existe
      mesmo — um domínio comprado e não configurado faz o scraper falhar e a partilha sai
      sem pré-visualização.
- [ ] `og:image` 1200×630, com o nome do consultor legível no cartão.
- [ ] `theme-color` igual ao `--bg`.
- [ ] Âncoras `index.html#…` corrigidas em todas as páginas que não são a home.
- [ ] `aria-current="page"` na página certa.
- [ ] Zero `tel:` em CTAs de navegação.
- [ ] AMI no rodapé.
- [ ] Teste de teclado: `Tab` da barra ao rodapé, abrir e fechar menu e submenus, sempre
      com anel de foco visível.
- [ ] Teste com `prefers-reduced-motion` ligado no sistema: nada pisca, nada se mexe,
      tudo se lê.
- [ ] Teste com JS desligado: o conteúdo aparece todo (só o fundo animado desaparece).
