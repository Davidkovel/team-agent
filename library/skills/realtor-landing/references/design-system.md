# Sistema visual do género

Este ficheiro define a linguagem visual partilhada pelos sites de consultor imobiliário deste kit: os tokens `:root`, a regra do acento único, a tipografia, o fundo transparente, a receita do vidro, os botões, o kicker, o espaçamento e os raios. Serve de base a qualquer site novo — a estrutura é sempre a mesma, o par tipográfico e a paleta é que mudam de cliente para cliente.

---

## 1. Tokens `:root`

Uma só declaração no topo da folha. Todos os valores abaixo são os do site do exemplo (variante escura) — servem de referência de grandeza, não de imposição de marca.

```css
:root{
  --ink:#F2F5FA;              /* neutral near-white — o off-white quente puxava a amarelo sobre azul */
  --muted:#AEB9CC;            /* secondary text */
  --faint:#8792A6;
  --accent:#4D8DF6;           /* acento único — o mesmo azul do fundo animado */
  --accent-2:#9DC2FF;         /* variante clara — gradientes e realces */
  --line:rgba(255,255,255,.12);
  --display:"{{FONTE_DISPLAY}}", system-ui, sans-serif;
  --sans:"{{FONTE_SANS}}", system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  --ease:cubic-bezier(.4,0,.2,1);
  --pad:clamp(22px,5vw,80px);
  --bg:rgb(10,10,10);         /* == backgroundColor da camada de fundo animada */
}
```

| Token | Papel |
|---|---|
| `--ink` | Cor do texto principal e das superfícies "sólidas" (fundo do `.btn--solid`, CTA da navbar). Num fundo azulado tem de ser um near-white **neutro**: o off-white quente puxa a amarelo e suja. |
| `--muted` | Texto secundário: leads, parágrafos de apoio, links da navbar em repouso, rodapé. |
| `--faint` | Terceiro nível: legendas de cápsulas, notas legais, descrições dentro de dropdowns. Nunca leva informação crítica. |
| `--accent` | A cor de marca. Acentos sobre fundo escuro, sublinhados, pontos, `::selection`, `em` dentro de títulos. |
| `--accent-2` | A mesma cor, mais clara. Só existe por contraste: usa-se onde o texto assenta **por cima do fundo animado** e o `--accent` não passa AA. |
| `--line` | O único traço permitido: 1px de borda das caixas. Branco a 12% no escuro; tinta a ~10–12% no claro. |
| `--display` | Fonte dos títulos, números grandes e nome de marca. |
| `--sans` | Fonte do corpo, botões, navegação, legendas. |
| `--ease` | Curva única de todo o site: `cubic-bezier(.4,0,.2,1)`. Todas as transições e animações a referenciam — é isso que faz o site parecer uma peça só. |
| `--pad` | Enchimento lateral universal das secções. |
| `--bg` | Cor de fundo da página. Tem de ser **exactamente** a `backgroundColor` da camada de fundo animada, senão vê-se a costura nas margens. |

---

## 2. Regra do acento único

**Uma cor de marca e mais nenhuma.** O site inteiro é neutro (ink / muted / faint / line) e a marca entra só em acentos. Sem segunda cor de destaque, sem verdes de "sucesso", sem vermelhos de "erro" decorativos.

O par `--accent` / `--accent-2` não são duas cores: são a mesma cor em dois níveis de luminosidade, e a escolha entre elas é uma decisão de contraste, não de gosto.

```css
/* fundo escuro e liso → --accent */
.kicker{color:var(--accent)}
em{font-style:normal;font-weight:600;color:var(--accent)}
::selection{background:rgba(77,141,246,.28);color:var(--ink)}

/* texto assente POR CIMA do fundo animado → --accent-2 (AA, ao contrário do --accent) */
.pv-kicker{color:var(--accent-2)}
.rl__kicker{color:var(--accent-2)}
.sb__role{color:var(--accent-2)}
```

`--accent-2` é também a cor dos estados vivos: borda de cartão activo, ponto de paginação aceso, seta de "ver mais", opção seleccionada num menu.

```css
.rl-card.is-center{border-color:rgba(157,194,255,.44)}
.rl__dot.is-on{background:var(--accent-2);transform:scale(1.4)}
.lang__opt[aria-selected="true"]{color:var(--accent-2);font-weight:600}
```

Gradientes: só entre `--accent-2` e `--accent`. Nunca entre duas famílias de cor.

```css
.hero h1 em{
  background:linear-gradient(115deg,var(--accent-2),var(--accent) 62%);
  -webkit-background-clip:text;background-clip:text;
  -webkit-text-fill-color:transparent;color:var(--accent);
}
```

---

## 3. Tipografia

Sempre **duas** famílias: uma display para títulos, uma sans para tudo o resto. Nunca três.

```css
h1,h2{
  font-family:var(--display);
  font-weight:500;                 /* 600 quando o título é curto e tem de pesar */
  line-height:1.1;
  letter-spacing:-.02em;
  font-optical-sizing:auto;        /* o eixo opsz da variável faz o resto */
}
body{
  font-family:var(--sans);
  line-height:1.6;
  font-optical-sizing:auto;
  -webkit-font-smoothing:antialiased;
}
```

`font-optical-sizing:auto` é obrigatório em qualquer fonte com eixo `opsz` — sem ele, um título a 62px carrega o desenho pensado para corpo de texto e fica com hastes grossas de mais.

### Escala (clamps usados)

```css
/* h1 do hero */
.hero h1{font-size:clamp(34px,4.5vw,62px);letter-spacing:-.028em;margin:22px 0 26px}

/* h1 de página interior */
.pg__title{font-size:clamp(34px,5.2vw,64px);line-height:1.05;letter-spacing:-.032em}

/* h2 de secção */
.pv-title{font-size:clamp(28px,3.5vw,46px);line-height:1.08;letter-spacing:-.028em}
.rl__t   {font-size:clamp(27px,3.5vw,46px);line-height:1.07;letter-spacing:-.03em}

/* nome / marca em display */
.sb__name {font-size:clamp(30px,3.6vw,48px);line-height:1.04;letter-spacing:-.03em}
.ft__brand{font-size:clamp(30px,4vw,52px); line-height:1.06;letter-spacing:-.03em}

/* nome gigante decorativo do rodapé */
.ft__giant{font-size:clamp(3rem,12vw,10rem);line-height:.82;letter-spacing:-.035em}

/* lead / subtítulo */
.hero .sub{font-size:clamp(15px,1.7vw,19px);max-width:44ch}
.pg__lead {font-size:clamp(15px,1.6vw,19px);line-height:1.65;max-width:46ch}
.pv-lead  {font-size:clamp(14.5px,1.2vw,17px);max-width:56ch}

/* corpo */
.sb__p{font-size:clamp(15px,1.2vw,17px);line-height:1.68;max-width:58ch}

/* kicker — fixo, não escala */
.kicker{font-size:12px;letter-spacing:3px}
```

Regra do `letter-spacing`: **negativo nos displays** (−.02em a −.035em, tanto mais negativo quanto maior o corpo), **positivo e grande nos micro-labels** (kicker 3px, botões 2px, legendas de cápsula 1.2–2.2px), **zero no corpo**.

Medida de linha: `max-width` em `ch`, sempre. 44–46ch nos leads, 56–58ch no corpo, 60–64ch nos cabeçalhos de secção.

### Pares já usados no género

| Site | Display | Sans | Fundo |
|---|---|---|---|
| Referência A (escuro) | Bricolage Grotesque | Instrument Sans | escuro |
| Referência B (escuro) | Inter Tight | Inter | escuro |
| Referência C (claro) | Instrument Serif | Geist | claro |

**Cada cliente novo TROCA o par tipográfico e a paleta.** É a única coisa que muda de propósito entre sites do género: a estrutura, o movimento e as medidas mantêm-se, a assinatura visual não. Um site novo com o mesmo par de um anterior lê-se como um template.

Carregamento (variante Google Fonts, sem build):

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family={{DISPLAY}}:opsz,wght@12..96,400;12..96,500;12..96,600;12..96,700&family={{SANS}}:wght@400;500;600;700&display=swap" rel="stylesheet">
```

Só os pesos que a página usa. Numa página de texto puro (política de privacidade) o pedido encolhe para 600;700 no display e 400;500;600 no sans.

---

## 4. O fundo transparente

O fundo (barras animadas, vídeo, gradiente — o que for) vive numa camada `position:fixed` com `z-index` negativo. Para ela se ver, a cor de fundo tem de estar no `<html>` e o `<body>` tem de ser transparente.

```css
html{
  background:var(--bg);
  -webkit-text-size-adjust:100%;
  scroll-behavior:smooth;
  overflow-x:clip;
}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}

body{
  font-family:var(--sans);
  color:var(--ink);
  line-height:1.6;
  overflow-x:hidden;
  /* transparente de propósito: o fundo vive no <html>, senão o box do body
     pinta por cima da camada de fundo (z-index negativo) e apaga-a */
  background:transparent;
  font-optical-sizing:auto;
  -webkit-font-smoothing:antialiased;
}
```

Consequência directa: **nenhuma secção leva fundo opaco**. O contraste vem sempre de véus parciais e de painéis de vidro locais.

```css
.pv-sec{background:transparent}
.ft{background:transparent}
```

E a camada fixa por cima do fundo animado — o véu global — é o que garante legibilidade do site inteiro sem apagar o efeito:

```css
.gbars{position:fixed;inset:0;z-index:-2;overflow:hidden}
/* véu global: mantém o fundo legível em toda a página, sem o apagar —
   o hero acrescenta por cima o seu véu direccional */
.gveil{position:fixed;inset:0;z-index:-1;pointer-events:none;
  background:linear-gradient(to bottom,
    rgba(10,10,10,.55) 0%, rgba(10,10,10,.40) 45%, rgba(10,10,10,.52) 100%)}
```

O véu global é fixo ao ecrã de propósito: não conhece fronteiras de secção, portanto não pode criar degraus. Qualquer véu **local** que exista (o do hero, por exemplo) tem de chegar a **zero** exactamente onde acaba a sua secção — se acabar com alguma opacidade, o fundo salta e lê-se um risco horizontal na página.

---

## 5. Vidro (glass)

A receita canónica de um painel. Cinco ingredientes, sempre os mesmos:

```css
.panel{
  border:1px solid var(--line);
  border-radius:28px;
  background:linear-gradient(118deg,
      rgba(24,34,56,.62) 0%,
      rgba(9,12,20,.86) 58%,
      rgba(7,9,15,.92) 100%);
  -webkit-backdrop-filter:blur(20px) saturate(118%);
          backdrop-filter:blur(20px) saturate(118%);
  box-shadow:0 40px 96px rgba(0,0,0,.58),
             inset 0 1px 0 rgba(255,255,255,.10);
}
```

1. **Gradiente escuro** em vez de cor chapada — o painel ganha volume e não se lê como um rectângulo colado.
2. **1px de `--line`** — o único contorno.
3. **`backdrop-filter: blur() saturate()`** — o `saturate` (112–118%, ou 1.3 na navbar) impede que o desfoque lave a cor do fundo por trás.
4. **Sombra exterior larga e difusa** — `0 34–40px 80–96px rgba(0,0,0,.46–.58)`.
5. **`inset 0 1px 0` branco a 8–10%** — a linha de luz no topo. É este detalhe que faz o painel parecer vidro e não plástico.

Intensidades por tipo de peça:

```css
/* navbar / dropdowns — mais desfoque, mais saturação, sombra curta e funda */
.nv__bar{
  background:rgba(12,17,28,.68);border:1px solid rgba(255,255,255,.14);
  -webkit-backdrop-filter:blur(18px) saturate(1.3);backdrop-filter:blur(18px) saturate(1.3);
  box-shadow:0 14px 40px -16px rgba(0,0,0,.8);
}

/* painel secundário — menos desfoque, sem inset */
.pv-ask{
  border:1px solid var(--line);border-radius:20px;
  background:linear-gradient(100deg, rgba(20,29,48,.28) 0%, rgba(8,11,18,.52) 100%);
  -webkit-backdrop-filter:blur(12px) saturate(112%);backdrop-filter:blur(12px) saturate(112%);
}

/* peças pequenas — pílulas, botões redondos, selos */
.badge{
  background:rgba(8,12,20,.62);border:1px solid rgba(255,255,255,.20);
  -webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);
}
```

### Regra do ecrã estreito: desligar o `backdrop-filter`

Em telemóvel o desfoque de fundo é caro em GPU e, com o conteúdo mais denso, come legibilidade. Abaixo do breakpoint em que o painel passa a ocupar quase o ecrã todo, **desliga-se o filtro e o fundo passa a opaco** — mesmas cores, opacidades subidas.

```css
@media(max-width:880px){
  .pv-body{
    -webkit-backdrop-filter:none;backdrop-filter:none;
    background:linear-gradient(118deg,
      rgba(24,34,56,.80) 0%, rgba(9,12,20,.93) 58%, rgba(7,9,15,.96) 100%);
  }
  .pv-ask{
    -webkit-backdrop-filter:none;backdrop-filter:none;
    background:linear-gradient(100deg, rgba(20,29,48,.50) 0%, rgba(8,11,18,.72) 100%);
  }
}
```

O mesmo vale para painéis de calculadora e caixas de descrição — em estreito, `backdrop-filter:none` e raio a encolher para 20px.

---

## 6. Botões

Dois, e só dois: o contorno (`.btn`) e o sólido (`.btn--solid`). Ambos pílula, ambos maiúsculas.

```css
.btn{
  display:inline-flex;align-items:center;gap:10px;
  font-family:var(--sans);font-size:12px;font-weight:500;
  letter-spacing:2px;text-transform:uppercase;
  padding:15px 26px;
  border:1px solid var(--line);border-radius:999px;
  color:var(--ink);background:transparent;cursor:pointer;
  transition:all .4s var(--ease);
  white-space:nowrap;
}
.btn:hover{border-color:var(--accent);color:var(--accent)}

.btn--solid{background:var(--ink);color:#0c1120;border-color:var(--ink)}
.btn--solid:hover{background:var(--accent);border-color:var(--accent);color:#0c1120}
```

O sólido inverte: fundo `--ink`, texto quase preto. No hover troca para `--accent` mantendo o texto escuro — é a única vez que a cor de marca aparece como superfície e não como acento.

CTA da navbar, a mesma ideia em corpo mais pequeno:

```css
.nv__cta{
  display:inline-flex;align-items:center;justify-content:center;white-space:nowrap;
  padding:9px 18px;border-radius:999px;
  background:var(--ink);color:#0B1220;font-size:13px;font-weight:500;
  transition:background .25s var(--ease),transform .25s var(--ease);
}
.nv__cta:hover{background:var(--accent-2);transform:scale(1.04)}
```

Em telemóvel, dois botões lado a lado com `flex:1 1 0` e o tipo a encolher só o suficiente para o rótulo mais longo caber numa linha:

```css
@media(max-width:820px){
  .hero .cta{flex-direction:row;align-items:stretch;gap:10px;position:relative;z-index:6}
  .hero .cta .btn{flex:1 1 0;min-width:0;justify-content:center;
    font-size:11px;letter-spacing:.6px;padding:15px 12px}
}
```

`flex:1 1 0` e não largura natural: com rótulos de comprimentos diferentes os botões saem desirmanados.

---

## 7. `.kicker` — e a regra de ouro

```css
.kicker{
  font-size:12px;font-weight:500;letter-spacing:3px;text-transform:uppercase;
  color:var(--accent);display:inline-flex;align-items:center;gap:12px;
}
```

Quando o kicker assenta sobre o fundo animado, troca para `--accent-2`. Quando é centrado, compensa-se o vão que o `letter-spacing` deixa à direita da última letra:

```css
.pg .kicker{margin-right:3px}   /* compensa o vão do letter-spacing ao centrar */
```

### REGRA DE OURO: o kicker é texto e mais nada

**Zero traços decorativos em toda a página.** Sem excepções:

- sem barrinha de acento antes ou depois do kicker;
- sem régua em gradiente atrás ou por baixo de logótipos;
- sem barra vertical de acento ao lado de números, estatísticas ou passos;
- sem separadores horizontais entre blocos de informação.

O que substitui os traços: **cápsulas**. Cada número vive na sua caixa arredondada com fundo branco a 4.5%.

```css
/* sem linha de separação e sem barras: cada número vive numa cápsula própria */
.pv-specs{
  list-style:none;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));
  gap:clamp(8px,1vw,12px);margin:0 0 clamp(16px,1.8vw,20px);padding:0;
}
.pv-specs li{
  display:flex;flex-direction:column;gap:4px;min-width:0;
  padding:clamp(11px,1.2vw,14px) clamp(10px,1.1vw,14px);
  border-radius:15px;background:rgba(255,255,255,.045);
}
.pv-specs b{font-family:var(--display);font-weight:600;font-size:16px;letter-spacing:-.01em}
.pv-specs span{font-size:10.5px;line-height:1.35;letter-spacing:1.2px;
  text-transform:uppercase;color:var(--faint)}
```

Variante com borda, para cápsulas soltas fora de um painel:

```css
.proof div{
  display:flex;flex-direction:column;gap:4px;min-width:0;
  padding:clamp(12px,1.3vw,16px) clamp(11px,1.2vw,16px);
  border:1px solid var(--line);border-radius:16px;background:rgba(255,255,255,.045);
}
```

A única linha animada tolerada no género é o sublinhado de um link de rodapé — e cresce do zero no hover, não existe em repouso:

```css
.ft__nav a::after{
  content:"";position:absolute;left:0;right:0;bottom:0;height:1px;background:var(--accent);
  transform:scaleX(0);transform-origin:left;transition:transform .38s var(--ease);
}
.ft__nav a:hover::after,.ft__nav a:focus-visible::after{transform:scaleX(1)}
```

Também não há linha atrás do logótipo do rodapé — o lockup é só uma caixa de vidro:

```css
/* sem linha nenhuma atrás do logo: o crest é só o lockup em vidro */
```

---

## 8. Espaçamento

Enchimento lateral universal:

```css
--pad:clamp(22px,5vw,80px);
```

Todas as secções seguem o mesmo padrão: `clamp()` na vertical, `var(--pad)` na horizontal. O topo e o fundo raramente são iguais — a secção fecha com mais ar do que abre.

```css
.pv-sec{padding:clamp(72px,11vh,132px) var(--pad) clamp(64px,9vh,116px)}
.rl    {padding:clamp(60px,9vh,110px)  var(--pad) clamp(50px,8vh,96px)}
.sb    {padding:clamp(24px,4vh,56px)   var(--pad) clamp(76px,11vh,132px)}
.ft    {padding:0 var(--pad) clamp(52px,6vw,84px)}

/* cabeçalho de página interior: a navbar fixa é descontada no cálculo */
.pg{padding:calc(84px + clamp(44px,8vh,96px)) var(--pad) clamp(18px,3vh,40px)}
```

Wrap interior, sempre o mesmo:

```css
.pv-wrap,.rl__wrap,.sb__wrap{max-width:1240px;margin:0 auto}
```

`scroll-margin-top` em toda a secção com `id` — a navbar é fixa e sem isto o âncora esconde o cabeçalho por baixo dela:

```css
.pv-sec,.rl,.sb{scroll-margin-top:96px}   /* a dock fixa não tapa o topo */
```

Gaps interiores também em `clamp()`:

```css
.sb__wrap{gap:clamp(28px,4.5vw,76px)}
.ft__nav {gap:clamp(20px,3vw,40px);margin-top:clamp(28px,3.6vw,40px)}
.pv-specs{gap:clamp(8px,1vw,12px)}
```

Em telemóvel o enchimento vertical passa a **simétrico**: com valores diferentes em cima e em baixo, um bloco curto assenta visivelmente fora do centro do vão.

```css
@media(max-width:820px){
  .sb-bridge{padding:clamp(48px,9vh,76px) var(--pad)}
}
```

---

## 9. Raios

| Uso | Raio |
|---|---|
| Pílulas: botões, CTA, selos, seletores, badges | `999px` |
| Botões redondos e pontos (setas do carrossel, sociais) | `50%` |
| Cartões grandes: media principal, painel de informação | `28px` |
| Cartões médios: moldura de foto, painéis de calculadora | `24px` |
| Caixas secundárias: dropdown, lockup do logo, painel de convite, cartão de reel | `20px` |
| Menus pequenos e cápsulas: menu de idioma, cápsula de indicador | `16px` |
| Itens dentro de menus e cápsulas de spec | `11–15px` |

No responsivo os raios **encolhem um degrau de cada vez**, acompanhando a largura da peça:

```css
@media(max-width:880px){
  .pv-media{border-radius:24px}
  .pv-body {border-radius:24px}
}
@media(max-width:560px){
  .pv-media{border-radius:20px}
  .pv-body {border-radius:20px;padding:22px 20px}
  .pv-go::after{border-radius:22px}   /* o stretched link acompanha a caixa */
  .pv-ask  {border-radius:18px}
}
```

Quando um pseudo-elemento cobre a caixa toda (stretched link, foco), o seu `border-radius` tem de acompanhar o da caixa em cada breakpoint — senão o anel de foco sai quadrado sobre um cartão arredondado.

---

## 10. Variantes do género

### Escura (as duas referências principais)

- `--bg` quase preto (`rgb(10,10,10)`), `--ink` near-white neutro.
- `--line` = branco a 12%.
- Vidro com gradiente escuro + `inset` branco a 8–10%.
- Fundo animado visível através de todas as secções; o contraste vem de véus e painéis.
- Cápsulas com `rgba(255,255,255,.045)`.
- Sombras muito largas e muito escuras: `0 34–52px 80–110px rgba(0,0,0,.46–.64)`.
- Texto sobre o fundo animado usa `--accent-2`.

### Clara (a terceira referência)

O que muda, mantendo tudo o resto igual:

- `--bg` passa a um off-white/bone; `--ink` passa a uma tinta escura (não preto puro).
- `--muted` e `--faint` invertem-se: tinta a ~60% e ~45%, não branco a 70%/55%.
- `--line` passa a tinta a ~10–12% em vez de branco a 12%.
- O gradiente do vidro inverte para claro-sobre-claro e o `inset 0 1px 0` branco **perde sentido** — num painel claro a linha de luz no topo não se lê. Ou se remove, ou se substitui por `inset 0 -1px 0` de sombra ténue.
- As sombras encolhem muito em opacidade: num fundo claro, `rgba(0,0,0,.58)` lê-se como sujidade. Rondam `.06–.12`.
- As cápsulas trocam `rgba(255,255,255,.045)` por tinta a ~3–4%.
- O par `--accent` / `--accent-2` inverte a lógica: sobre fundo claro o acento **escuro** é o que passa AA, portanto é `--accent` que serve de cor de texto e `--accent-2` fica reservado a superfícies e fundos ténues.
- O par tipográfico costuma virar serif display + sans geométrica, porque no claro a serif ganha o ar editorial que no escuro ficava frágil.

O que **não** muda em nenhuma variante: `--ease`, `--pad`, os clamps de tipografia, a escala de raios, a regra do acento único, a regra de ouro dos traços, o `body` transparente e o `scroll-margin-top:96px`.
