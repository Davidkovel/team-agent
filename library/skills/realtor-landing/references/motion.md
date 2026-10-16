# Sistema de movimento

Este é o ficheiro mais importante do kit. A "smoothness" do género não vem de uma
biblioteca — vem de um conjunto pequeno de decisões repetidas com disciplina:

- **um único easing** (`--ease:cubic-bezier(.4,0,.2,1)`) em tudo;
- **uma tabela curta de durações**, sempre a mesma;
- **estado inicial escrito por JS** (classe `.xx-js` no `<html>`), para a página
  continuar legível sem JS;
- **IntersectionObserver + `unobserve`**, nunca listeners de `scroll`;
- **CSS a interpolar, JS só a calcular** — nada de GSAP, nada de build, nada de npm;
- **`prefers-reduced-motion` a desligar tudo**, obrigatoriamente.

Tudo o que está aqui funciona em HTML + CSS + JS vanilla, colado dentro de um
`<style>` no `<head>` e de um `<script>` antes de `</body>`.

Placeholders usados nos snippets: `{{NOME}}`, `{{TELEFONE_E164}}`, `{{WHATSAPP}}`,
`{{INSTAGRAM}}`, `{{AGENCIA}}`, `{{AMI}}`, `{{DOMINIO}}`, `{{CIDADE}}`, `{{ANO}}`.

---

## 0. Tokens de base

Todos os blocos deste ficheiro dependem destas variáveis. Declara-as uma vez.

```css
:root{
  --ink:#F2F5FA;              /* neutral near-white — o off-white quente puxava a amarelo sobre azul */
  --muted:#AEB9CC;            /* texto secundário */
  --faint:#8792A6;
  --accent:#4D8DF6;           /* acento único — o mesmo azul das barras */
  --accent-2:#9DC2FF;         /* azul claro — gradientes e realces */
  --line:rgba(255,255,255,.12);
  --display:"Bricolage Grotesque", system-ui, sans-serif;
  --sans:"Instrument Sans", system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  --ease:cubic-bezier(.4,0,.2,1);
  --pad:clamp(22px,5vw,80px);
  --bg:rgb(10,10,10);         /* == backgroundColor do componente gradient-bars */
}
*{box-sizing:border-box;margin:0;padding:0}
html{background:var(--bg);-webkit-text-size-adjust:100%;scroll-behavior:smooth;overflow-x:clip}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
body{
  font-family:var(--sans);
  color:var(--ink);
  line-height:1.6;
  overflow-x:hidden;
  /* transparente de propósito: o fundo vive no <html>, senão o box do body
     pinta por cima da camada .gbars (z-index negativo) e apaga as barras */
  background:transparent;
  font-optical-sizing:auto;
  -webkit-font-smoothing:antialiased;
}
```

**Porquê `body{background:transparent}`**: as barras animadas vivem numa camada com
`z-index:-2`. Um `background` opaco no `body` cria uma superfície pintada por cima
delas e o fundo desaparece por completo. O fundo tem de estar no `<html>`.

---

## 1. Fundo animado — `gradient-bars`

Uma fila de barras verticais em gradiente, fixa ao ecrã, que "respira". É o que dá
vida à página inteira sem ter de animar seja o que for nas secções — todas as
secções são transparentes e deixam-no passar.

### 1.1 A configuração

Um único objecto no topo do script. Afinar o fundo é mexer aqui e mais nada.

```js
/* =========================================================
   GRADIENT BARS — mesma matemática do componente React.
   Muda só este objeto para afinar o fundo.
   ========================================================= */
const GBARS = {
  numBars: 15,
  gradientFrom: 'rgb(28, 100, 242)',
  gradientTo: 'transparent',
  animationDuration: 2,          // segundos — base; cada barra desvia ligeiramente
  amplitude: 0.62,               // scaleY no fim do ciclo (menor = mais movimento)
};
```

### 1.2 O CSS

```css
/* =========================================================
   GRADIENT BARS
   As barras são geradas em JS; --initial-scale é escrito por barra.
   ========================================================= */
@keyframes pulseBar{
  0%   { transform:scaleY(var(--initial-scale)); }
  100% { transform:scaleY(calc(var(--initial-scale) * var(--gb-amp, .62))); }
}
.gbars{position:fixed;inset:0;z-index:-2;overflow:hidden}
/* véu global: mantém as barras legíveis como fundo em toda a página,
   sem as apagar — o hero acrescenta por cima o seu véu direcional */
.gveil{position:fixed;inset:0;z-index:-1;pointer-events:none;
  background:linear-gradient(to bottom, rgba(10,10,10,.55) 0%, rgba(10,10,10,.40) 45%, rgba(10,10,10,.52) 100%)}
.gbars__row{
  display:flex;height:100%;width:100%;
  transform:translateZ(0);
  backface-visibility:hidden;
  -webkit-font-smoothing:antialiased;
}
.gbars__bar{
  height:100%;
  transform-origin:bottom;
  transition:transform .5s ease-in-out;
  animation:pulseBar var(--gb-dur,2s) ease-in-out infinite alternate;
  outline:1px solid rgba(0,0,0,0);
  box-sizing:border-box;
}
```

Notas de cada linha que não é óbvia:

- **`transform-origin:bottom`** — as barras crescem do chão para cima, como um
  equalizador. Com a origem ao centro leem-se como um respiração simétrica sem
  chão, e o efeito perde-se.
- **`animation-direction: alternate`** — a barra vai de `--initial-scale` até
  `--initial-scale * --gb-amp` e volta, sem salto no fim do ciclo. Um keyframe de
  duas paragens chega.
- **`outline:1px solid rgba(0,0,0,0)`** — outline transparente. Evita a costura de
  sub-pixel entre barras adjacentes em alguns motores de render.
- **`translateZ(0)` + `backface-visibility:hidden`** na fila — promove a camada para
  a GPU uma vez, em vez de 15 vezes.

### 1.3 O HTML

Duas divs vazias, logo a abrir o `<body>`:

```html
<!-- BACKGROUND — camada fixa, atrás do site inteiro -->
<div class="gbars" id="gbars" aria-hidden="true"></div>
<div class="gveil" aria-hidden="true"></div>
```

### 1.4 O JS

```js
(function renderGradientBars(cfg){
  const root = document.getElementById('gbars');
  if(!root) return;

  // idêntica à calculateHeight do componente: perfil em U, mínimo 30% ao centro
  function barHeight(index, total){
    const position = total > 1 ? index / (total - 1) : 0;
    const maxHeight = 100, minHeight = 30, center = .5;
    const distanceFromCenter = Math.abs(position - center);
    const heightPercentage = Math.pow(distanceFromCenter * 2, 1.2);
    return minHeight + (maxHeight - minHeight) * heightPercentage;
  }

  const row = document.createElement('div');
  row.className = 'gbars__row';

  for(let i = 0; i < cfg.numBars; i++){
    const scale = barHeight(i, cfg.numBars) / 100;
    const bar = document.createElement('div');
    bar.className = 'gbars__bar';
    bar.style.flex = '1 0 calc(100% / ' + cfg.numBars + ')';
    bar.style.maxWidth = 'calc(100% / ' + cfg.numBars + ')';
    bar.style.background = 'linear-gradient(to top, ' + cfg.gradientFrom + ', ' + cfg.gradientTo + ')';
    bar.style.transform = 'scaleY(' + scale + ')';
    bar.style.animationDelay = (i * 0.1) + 's';
    bar.style.setProperty('--initial-scale', scale);
    bar.style.setProperty('--gb-amp', cfg.amplitude);
    // duração ligeiramente diferente por barra: sem isto todas respiram ao mesmo
    // compasso e o fundo lê-se mecânico em vez de vivo
    bar.style.setProperty('--gb-dur', (cfg.animationDuration + (i % 4) * 0.28).toFixed(2) + 's');
    row.appendChild(bar);
  }
  root.appendChild(row);
})(GBARS);
```

### 1.5 O perfil em U — porquê

`barHeight` devolve uma altura entre **30%** (centro) e **100%** (extremos):

```
position          = i / (total - 1)            → 0 .. 1
distanceFromCenter= |position - 0.5|           → 0.5 .. 0 .. 0.5
heightPercentage  = (distance * 2) ^ 1.2       → 1 .. 0 .. 1
altura            = 30 + 70 * heightPercentage → 100 .. 30 .. 100
```

O expoente **1.2** (não 1, não 2) é o que faz o U ter fundo largo: com expoente 1 a
curva é um V duro e as barras do meio sobem cedo de mais; com 2 o vale fica plano de
mais e as barras centrais quase desaparecem. 1.2 dá um vale suave, com espaço no
centro para o conteúdo do hero respirar — que é exactamente onde o texto assenta.

O mínimo de **30%** existe para o centro nunca ficar vazio: uma barra a 0 lê-se como
um buraco no fundo.

### 1.6 Os dois desfasamentos — o detalhe que faz o efeito

Duas coisas, ambas por barra, ambas obrigatórias:

1. **`animation-delay: i * 0.1s`** — as barras não arrancam ao mesmo tempo, a onda
   corre da esquerda para a direita.
2. **`--gb-dur: animationDuration + (i % 4) * 0.28`** — cada barra tem uma duração
   *diferente*: 2.00s, 2.28s, 2.56s, 2.84s, 2.00s, ... Só com o delay, ao fim de um
   ciclo todas voltam a estar em fase e vê-se um pulso sincronizado. Com durações
   diferentes as fases nunca reconvergem e o fundo lê-se orgânico, indefinidamente.

Sem o `--gb-dur` **o fundo lê-se mecânico**. É a diferença entre um equalizador de
leitor de MP3 e uma coisa viva.

### 1.7 z-index e position — a arquitectura de camadas

```
z-index: -2   .gbars    position:fixed   barras animadas
z-index: -1   .gveil    position:fixed   véu global que as acalma
z-index:  0   secções   transparentes    o site
z-index: 60   .nv       position:fixed   navbar
z-index: 70   .nv__menu position:fixed   menu mobile
```

- **`position:fixed`** nas duas camadas de fundo: o fundo não rola com a página. É o
  que faz o site inteiro parecer estar em cima de uma superfície viva, em vez de ter
  uma imagem de fundo a passar. Também torna o custo constante: 15 elementos animados
  no total, não por secção.
- **`z-index:-2` e `-1`**: negativos porque o fundo tem de ficar atrás do conteúdo
  *sem* que cada secção precise de `z-index` próprio. É por isso que o `body` tem de
  ser transparente (ponto 0) e é por isso que as secções são transparentes: o
  contraste vem sempre de painéis locais de vidro, nunca de um fundo de secção opaco.
- **O `.gveil` é uma camada à parte** e não um gradiente dentro do `.gbars` porque
  tem de cobrir também o que está entre secções, e porque o hero acrescenta por cima
  o seu próprio véu direccional (ver ponto 11).

### 1.8 Movimento reduzido

```css
@media(prefers-reduced-motion:reduce){
  .gbars__bar{animation:none;transition:none}
}
```

As barras ficam nas alturas iniciais — o perfil em U continua a ler-se, só não se
mexe. O fundo não desaparece.

---

## 2. Reveal ao entrar no viewport — o padrão canónico

Este é o padrão que se repete em **todas** as secções, de todas as páginas. Muda só
o prefixo (`pv-`, `vd-`, `rl-`, `ft-`, `pg-`). O prefixo por secção existe para se
poder copiar um bloco inteiro para outra página sem colisões.

### 2.1 A regra de ouro: o estado inicial só existe com JS

```js
document.documentElement.classList.add('pv-js'); /* o estado inicial do reveal só existe com JS */
```

```css
/* ---------- reveal (só existe com JS; sem JS fica visível) ---------- */
.pv-js .pv-reveal{opacity:0;transform:translateY(22px);
  transition:opacity .75s var(--ease),transform .75s var(--ease)}
.pv-js .pv-reveal.is-in{opacity:1;transform:none}
.pv-js .pv-reveal--d1{transition-delay:.08s}
.pv-js .pv-reveal--d2{transition-delay:.16s}
```

**Porquê**: se `opacity:0` estivesse escrito directamente em `.pv-reveal`, uma página
sem JavaScript (bloqueado, erro de script, crawler antigo) ficaria em branco. Ao
prender o estado inicial a `.pv-js`, que só o JS põe no `<html>`, o pior caso é a
página aparecer toda de uma vez — legível, indexável, funcional.

A classe vai no `documentElement` e não no `body` para que a regra esteja em vigor
antes do primeiro paint do conteúdo, sem flash.

### 2.2 O observer

```js
(function PV_reveal(){
  var sec = document.getElementById('imovel');
  if(!sec) return;
  document.documentElement.classList.add('pv-js');

  var items = Array.prototype.slice.call(sec.querySelectorAll('.pv-reveal'));
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion:reduce)').matches;

  if(!items.length) return;
  if(reduce || !('IntersectionObserver' in window)){
    items.forEach(function(el){ el.classList.add('is-in'); });
  } else {
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(en){
        if(en.isIntersecting){ en.target.classList.add('is-in'); io.unobserve(en.target); }
      });
    }, {rootMargin:'0px 0px -12% 0px', threshold:.12});
    items.forEach(function(el){ io.observe(el); });
  }
})();
```

Os quatro pontos que interessam:

- **`{rootMargin:'0px 0px -12% 0px', threshold:.12}`** — a margem negativa em baixo
  encolhe o viewport de observação 12%: o elemento só conta como "dentro" quando já
  subiu bem para dentro do ecrã, não quando espreita a primeira linha de pixéis. O
  `threshold:.12` exige ainda que 12% da área do elemento esteja visível. Juntos, o
  reveal dispara **quando o utilizador já está a olhar para ele**, não antes. Sem a
  rootMargin negativa, os blocos altos animam com o topo ainda fora de vista e a
  animação passa despercebida.
- **`io.unobserve(en.target)`** — depois de disparar, deixa de observar. Um reveal é
  uma entrada, não um estado que oscila: sem `unobserve` cada scroll para cima e para
  baixo continua a produzir callbacks para nada.
- **O ramo de fallback** cobre dois casos ao mesmo tempo: sem `IntersectionObserver` e
  com `prefers-reduced-motion`. Nos dois põe-se `is-in` em tudo imediatamente.
- **`querySelectorAll` dentro da secção**, não no documento, quando o bloco é
  auto-contido. Uma variante mais simples observa o documento inteiro:

```js
(function VD_reveal(){
  document.documentElement.classList.add('vd-js');
  var items = Array.prototype.slice.call(document.querySelectorAll('.vd-rev'));
  if(!items.length) return;
  var show = function(){ items.forEach(function(el){ el.classList.add('is-in'); }); };
  if(!('IntersectionObserver' in window) || matchMedia('(prefers-reduced-motion:reduce)').matches){ show(); return; }
  var io = new IntersectionObserver(function(entries){
    entries.forEach(function(en){
      if(en.isIntersecting){ en.target.classList.add('is-in'); io.unobserve(en.target); }
    });
  }, {rootMargin:'0px 0px -12% 0px', threshold:.12});
  items.forEach(function(el){ io.observe(el); });
})();
```

### 2.3 Os atrasos escalonados — três formas

**(a) Classes de atraso**, quando são poucos e fixos:

```css
.pv-js .pv-reveal--d1{transition-delay:.08s}
.pv-js .pv-reveal--d2{transition-delay:.16s}
```
```html
<header class="pv-head pv-reveal">…</header>
<article class="pv-card pv-reveal pv-reveal--d1">…</article>
<aside class="pv-ask pv-reveal pv-reveal--d2">…</aside>
```

**(b) Variável CSS por elemento**, quando o atraso varia caso a caso:

```css
.vd-js .vd-rev{opacity:0;transform:translateY(26px);
  transition:opacity .8s var(--ease),transform .8s var(--ease);transition-delay:var(--vd-d,0s)}
.vd-js .vd-rev.is-in{opacity:1;transform:none}
```
```html
<article class="vd-step vd-rev" style="--vd-d:.06s">…</article>
<article class="vd-step vd-rev" style="--vd-d:.16s">…</article>
<article class="vd-step vd-rev" style="--vd-d:.26s">…</article>
```

É o padrão preferido: o atraso vive no markup, ao lado do conteúdo, e a folha de
estilo não precisa de saber quantos itens existem. Nota o fallback `var(--vd-d,0s)`,
que faz um elemento sem a variável entrar imediatamente.

**(c) `:nth-child`**, quando o pai é que ganha `is-in` e os filhos escalonam sozinhos:

```css
.sb__i{opacity:0;transform:translateY(20px);
  transition:opacity .8s var(--ease),transform .8s var(--ease)}
.sb__text.is-in .sb__i{opacity:1;transform:none}
.sb__text.is-in .sb__i:nth-child(1){transition-delay:.10s}
.sb__text.is-in .sb__i:nth-child(2){transition-delay:.18s}
.sb__text.is-in .sb__i:nth-child(3){transition-delay:.26s}
.sb__text.is-in .sb__i:nth-child(4){transition-delay:.34s}
.sb__text.is-in .sb__i:nth-child(5){transition-delay:.42s}
.sb__text.is-in .sb__i:nth-child(6){transition-delay:.50s}
```

Passo de **0.08s** entre irmãos. É o valor certo para o género: mais curto e leem-se
como um bloco só; mais longo e a última linha chega tarde de mais e nota-se a espera.

**Repara que o `transition-delay` está na regra `.is-in`, não no estado inicial.**
Se estivesse no estado base, o elemento também *sairia* com atraso — irrelevante
aqui porque nunca sai, mas o hábito importa quando o estado é reversível.

### 2.4 Sequenciar duas peças que não devem entrar juntas

Quando um bloco tem duas metades (uma imagem e o texto), entrar em simultâneo lê-se
plano. O truque é observar a primeira e disparar a segunda por `setTimeout`:

```js
var io = new IntersectionObserver(function(entries){
  entries.forEach(function(en){
    if(!en.isIntersecting) return;
    var el = en.target;
    el.classList.add('is-in');
    io.unobserve(el);
    if(el === card) setTimeout(shine, 620);  /* o clarão entra depois de o card assentar */
    if(el === card && text){                 /* o texto vem a seguir, não em simultâneo */
      setTimeout(function(){ text.classList.add('is-in'); }, 240);
      io.unobserve(text);
    }
  });
}, {threshold:.22, rootMargin:'0px 0px -8% 0px'});
```

240ms é aproximadamente um terço da duração do reveal (0.9s): o texto começa a
aparecer com o cartão já a chegar ao lugar.

### 2.5 Movimento reduzido

```css
@media(prefers-reduced-motion:reduce){
  .pv-js .pv-reveal,.pv-js .pv-reveal.is-in{opacity:1;transform:none;transition:none}
}
```

Nota que a regra cobre **as duas** classes. Se cobrisse só `.pv-reveal`, e o JS ainda
não tivesse posto `is-in`, a especificidade da regra `is-in` podia reintroduzir a
transição. Escreve sempre as duas.

---

## 3. Entrada do hero

O hero é a única coisa da página que anima **sem esperar por scroll** — está no ecrã
desde o primeiro frame. Duas técnicas em simultâneo: linhas de título a subir de
dentro de uma máscara, e um fade-up para o resto.

### 3.1 O HTML

```html
<div class="hero__content">
  <p class="kicker">Comprar · Vender · {{CIDADE}}</p>
  <h1 class="reveal-lines"><span class="ln"><span>Ajudo proprietários</span></span><span class="ln"><span>a vender <em>melhor.</em></span></span></h1>
  <p class="sub">Do primeiro contacto à escritura, seja para vender o seu imóvel ou encontrar o próximo. Em {{CIDADE}} e em todo o país.</p>
  <div class="cta">
    <a href="vender.html" class="btn btn--solid">Vender o meu imóvel</a>
    <!-- vai ao anúncio da casa, aqui no site; antes abria o tel: e o Mac atirava para o FaceTime -->
    <a href="#imovel" class="btn">Quero comprar</a>
  </div>
</div>
```

Duas camadas de `<span>` por linha, e não uma: a de fora (`.ln`) é a **janela** que
recorta, a de dentro é o que **viaja**. Não dá para fazer com uma só.

### 3.2 O CSS

```css
/* ---------- hero entrance ---------- */
.reveal-lines .ln{display:block;overflow:hidden;padding-bottom:.06em}
.reveal-lines .ln>span{display:block;transform:translateY(118%);animation:lineUp 1.05s var(--ease) forwards}
.reveal-lines .ln:nth-child(1)>span{animation-delay:.12s}
.reveal-lines .ln:nth-child(2)>span{animation-delay:.27s}
@keyframes lineUp{to{transform:translateY(0)}}
.hero .kicker,.hero .sub,.hero .cta{opacity:0;animation:fadeUp .9s var(--ease) forwards}
.hero .kicker{animation-delay:.05s}
.hero .sub{animation-delay:.46s}
.hero .cta{animation-delay:.6s}
@keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}
```

Os valores, e porquê cada um:

- **`translateY(118%)`**, não 100%. Uma linha de texto tem descendentes (g, p, q) e o
  `line-height` deixa folga por baixo da baseline. A 100% ainda se via a ponta de um
  "g" a espreitar debaixo da máscara antes de arrancar. 118% garante que a linha
  começa completamente fora da janela.
- **`padding-bottom:.06em`** no `.ln` — pela mesma razão, mas do lado do fim:
  `overflow:hidden` cortaria a cauda dos descendentes na posição final. O padding dá
  o espaço e o `display:block` do `<span>` interior mantém o alinhamento.
- **`1.05s`** — a duração mais longa da página inteira. O hero é a primeira coisa que
  se vê e é onde o utilizador está disposto a esperar. Todo o resto é mais rápido.
- **`.12s` e `.27s`** — 150ms entre as duas linhas. Suficiente para se lerem como duas
  linhas, curto para não se lerem como dois acontecimentos.
- **`forwards`** em ambos os keyframes — a animação mantém o estado final. Sem isto o
  elemento volta ao `translateY(118%)` / `opacity:0` no último frame.

A escadaria completa do hero, por ordem de chegada:

| elemento | atraso | duração | chega a |
|---|---|---|---|
| kicker | .05s | .9s | .95s |
| título, linha 1 | .12s | 1.05s | 1.17s |
| título, linha 2 | .27s | 1.05s | 1.32s |
| subtítulo | .46s | .9s | 1.36s |
| CTAs | .6s | .9s | 1.50s |

O subtítulo arranca (`.46s`) enquanto a segunda linha do título ainda está a subir, e
acaba quase no mesmo instante — as peças sobrepõem-se em vez de esperarem umas pelas
outras. É isso que faz a entrada parecer **uma coisa só**, e não uma lista.

### 3.3 Variante: hero centrado, sem linhas mascaradas

Numa página interior (ex.: a de venda), o hero é centrado e uma cascata simples chega:

```css
.vd-hero>*{opacity:0;transform:translateY(18px);animation:fadeUp .95s var(--ease) forwards}
.vd-hero>:nth-child(1){animation-delay:.05s}
.vd-hero>:nth-child(2){animation-delay:.18s}
.vd-hero>:nth-child(3){animation-delay:.42s}
.vd-hero>:nth-child(4){animation-delay:.56s}
```

E, se houver um indicador de scroll centrado por `transform`, **precisa de keyframe
próprio**:

```css
.vd-cue{
  position:absolute;left:50%;bottom:clamp(24px,4vh,44px);transform:translateX(-50%);
  display:flex;flex-direction:column;align-items:center;gap:9px;
  font-size:10px;letter-spacing:2.6px;text-transform:uppercase;color:var(--faint);
  opacity:0;animation:vdCueIn .9s var(--ease) 1s forwards;
}
/* keyframe próprio: o fadeUp partilhado acaba em "transform:none" e isso
   apagava o translateX(-50%) que centra o cue, atirando-o para a direita
   metade da própria largura. Aqui a centragem viaja dentro do keyframe. */
@keyframes vdCueIn{
  from{opacity:0;transform:translate(-50%,16px)}
  to{opacity:1;transform:translate(-50%,0)}
}
```

Armadilha clássica e cara: `transform` é uma propriedade só. Um keyframe partilhado
que acabe em `transform:none` destrói qualquer `translate` de posicionamento que o
elemento tenha. Quem se centra por `transform` leva keyframe dedicado.

### 3.4 Movimento reduzido

```css
@media(prefers-reduced-motion:reduce){
  .reveal-lines .ln>span{transform:none;animation:none}
  .hero .kicker,.hero .sub,.hero .cta{opacity:1;animation:none}
  .vd-hero>*{opacity:1;transform:none;animation:none}
  /* o cue fica quieto, mas nunca pode perder a centragem */
  .vd-cue{opacity:1;transform:translateX(-50%);animation:none}
}
```

---

## 4. Navbar

Pílula de vidro fixa e centrada, com dropdowns em desktop e um menu de ecrã inteiro
em mobile. Quatro sistemas de movimento distintos.

### 4.1 A entrada — nvIn / nvMark / nvLink / nvCta

```css
.nv{position:fixed;top:0;left:0;right:0;z-index:60;display:flex;justify-content:center;
  padding:18px clamp(12px,3vw,16px);pointer-events:none}
.nv__bar{pointer-events:auto;width:100%;max-width:880px;
  display:flex;align-items:center;justify-content:space-between;gap:18px;
  padding:10px 12px 10px 16px;border-radius:999px;
  background:rgba(12,17,28,.68);border:1px solid rgba(255,255,255,.14);
  -webkit-backdrop-filter:blur(18px) saturate(1.3);backdrop-filter:blur(18px) saturate(1.3);
  box-shadow:0 14px 40px -16px rgba(0,0,0,.8);
  animation:nvIn .5s var(--ease) both}
@keyframes nvIn{from{opacity:0;transform:translateY(-10px)}to{opacity:1;transform:none}}

.nv__mark{width:30px;height:30px;flex:none;display:block;transition:transform .3s var(--ease);
  animation:nvMark .45s var(--ease) both}
@keyframes nvMark{from{transform:scale(.8)}to{transform:scale(1)}}
.nv__brand:hover .nv__mark{transform:rotate(10deg)}

.nv__links>a,.nv__links>.nv__item{font-size:13.5px;font-weight:500;color:var(--muted);white-space:nowrap;
  transition:color .25s var(--ease),transform .25s var(--ease);
  animation:nvLink .35s var(--ease) both}
.nv__links>:nth-child(1){animation-delay:.06s}
.nv__links>:nth-child(2){animation-delay:.12s}
.nv__links>:nth-child(3){animation-delay:.18s}
@keyframes nvLink{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}
.nv__links>a:hover{color:var(--ink);transform:scale(1.05)}
.nv__links a[aria-current="page"]{color:var(--ink)}

.nv__cta{display:inline-flex;align-items:center;justify-content:center;white-space:nowrap;
  padding:9px 18px;border-radius:999px;background:var(--ink);color:#0B1220;
  font-size:13px;font-weight:500;transition:background .25s var(--ease),transform .25s var(--ease);
  animation:nvCta .4s var(--ease) .2s both}
@keyframes nvCta{from{opacity:0;transform:translateX(14px)}to{opacity:1;transform:none}}
.nv__cta:hover{background:var(--accent-2);transform:scale(1.04)}
```

A coreografia é direccional e conta uma história pequena: a **barra desce** (-10px), a
**marca cresce** (0.8→1), os **links caem** um a um (-8px, 60ms de passo), e o **CTA
entra pela direita** (+14px). São quatro vectores diferentes; se todos entrassem de
cima lia-se como um bloco a cair.

Nota **`both`** em todos: `animation-fill-mode:both` aplica o estado do `from` durante
o `animation-delay`. Sem isto, um link com `.18s` de atraso ficaria visível 180ms
antes de arrancar, e depois piscava.

**`.nv{pointer-events:none}` com `.nv__bar{pointer-events:auto}`** — a faixa fixa
ocupa a largura toda do ecrã. Sem isto ela intercepta cliques nos cantos superiores da
página onde não há barra nenhuma.

### 4.2 Dropdowns

```css
.nv__item{position:relative;display:flex;align-items:center}
.nv__top{
  display:inline-flex;align-items:center;gap:6px;cursor:pointer;
  background:none;border:none;padding:0;font:inherit;color:inherit;
  transition:color .25s var(--ease);
}
.nv__top:hover,.nv__item.open .nv__top{color:var(--ink)}
.nv__caret{width:13px;height:13px;flex:none;transition:transform .3s var(--ease)}
.nv__item.open .nv__caret{transform:rotate(180deg)}
.nv__drop{
  position:absolute;top:calc(100% + 16px);left:50%;
  min-width:246px;padding:8px;border-radius:20px;
  background:rgba(12,17,28,.94);border:1px solid rgba(255,255,255,.14);
  -webkit-backdrop-filter:blur(18px) saturate(1.3);backdrop-filter:blur(18px) saturate(1.3);
  box-shadow:0 26px 60px -20px rgba(0,0,0,.92);
  opacity:0;visibility:hidden;pointer-events:none;transform:translate(-50%,-8px);
  transition:opacity .26s var(--ease),transform .26s var(--ease),visibility .26s;
}
.nv__item.open .nv__drop{opacity:1;visibility:visible;pointer-events:auto;transform:translate(-50%,0)}
.nv__drop a{
  display:block;padding:11px 14px;border-radius:13px;color:var(--muted);
  animation:none;white-space:normal;
  transition:background .22s var(--ease),color .22s var(--ease);
}
.nv__drop a:hover,.nv__drop a:focus-visible{background:rgba(255,255,255,.07);color:var(--ink);outline:none;transform:none}
.nv__drop b{display:block;font-family:var(--display);font-weight:600;font-size:14.5px;letter-spacing:-.01em;color:var(--ink)}
.nv__drop span{display:block;font-size:11.5px;line-height:1.45;color:var(--faint);margin-top:3px}
```

Três detalhes:

- **`visibility` na transição**, com a mesma duração. `opacity:0` sozinho deixa o
  painel a interceptar cliques; `display:none` mata a transição. `visibility` transita
  em degrau (não interpola), por isso o painel fica visível durante toda a saída e
  desaparece exactamente no fim. `pointer-events:none` é o cinto de segurança.
- **`transform:translate(-50%,-8px)` → `translate(-50%,0)`** — a centragem `-50%` tem
  de estar nos **dois** estados. Mesma armadilha do `.vd-cue`.
- **`.nv__drop a{animation:none}`** — os links do dropdown estão dentro de `.nv__links`
  e herdariam o `nvLink` da entrada da navbar. Anula-se explicitamente.

### 4.3 O JS dos dropdowns

```js
/* =========================================================
   NAVBAR — submenu: não reencaminha, desce as opções.
   Abre ao passar o rato e também ao clicar (teclado e trackpad).
   ========================================================= */
(function navDrop(){
  var items = Array.prototype.slice.call(document.querySelectorAll('.nv__item'));
  if(!items.length) return;

  function set(item, on){
    item.classList.toggle('open', on);
    item.querySelector('.nv__top').setAttribute('aria-expanded', on ? 'true' : 'false');
  }
  function closeAll(except){
    items.forEach(function(it){ if(it !== except) set(it, false); });
  }

  items.forEach(function(item){
    var btn = item.querySelector('.nv__top');
    var drop = item.querySelector('.nv__drop');
    if(!btn || !drop) return;
    var t;

    btn.addEventListener('click', function(e){
      e.stopPropagation();
      var on = !item.classList.contains('open');
      closeAll(item); set(item, on);
    });
    item.addEventListener('pointerenter', function(){ clearTimeout(t); closeAll(item); set(item, true); });
    item.addEventListener('pointerleave', function(){
      /* um respiro antes de fechar: o rato tem de conseguir descer até ao painel */
      clearTimeout(t); t = setTimeout(function(){ set(item, false); }, 180);
    });
    item.addEventListener('focusout', function(e){
      if(!item.contains(e.relatedTarget)) set(item, false);
    });
    drop.querySelectorAll('a').forEach(function(a){
      a.addEventListener('click', function(){ set(item, false); });
    });
  });

  document.addEventListener('click', function(e){
    items.forEach(function(it){ if(!it.contains(e.target)) set(it, false); });
  });
  document.addEventListener('keydown', function(e){ if(e.key === 'Escape') closeAll(null); });
})();
```

Os cinco mecanismos de fecho, e porque existem todos:

1. **`pointerleave` + `setTimeout(…, 180)`** — o painel abre 16px abaixo do botão
   (`top:calc(100% + 16px)`). Esse vão não é área sensível: se o fecho fosse imediato,
   o rato a descer do botão para o painel atravessaria terra de ninguém e o menu
   fechava-se na cara da pessoa. 180ms é o respiro exacto — curto o suficiente para
   não parecer preso, longo o suficiente para o gesto caber. O `clearTimeout` no
   `pointerenter` cancela o fecho quando se volta a entrar.
2. **`click`** além do hover — trackpads, touch e teclado não produzem hover fiável.
   O botão é um `<button>` a sério, com `aria-expanded`.
3. **`focusout`** com `item.contains(e.relatedTarget)` — quem navega por Tab sai do
   painel e este fecha. O teste `contains` evita fechar quando o foco só se move de um
   link do painel para outro.
4. **`Escape`** em todo o documento — fecha todos.
5. **Clique fora** — o `document` fecha os itens que não contêm o alvo. É por isso que
   o handler do botão faz `e.stopPropagation()`: sem ele, o clique que abre borbulha
   até ao documento e fecha logo a seguir.

`pointerenter` e não `mouseenter`: cobre rato, caneta e toque com a mesma API.

### 4.4 O menu mobile de ecrã inteiro

```css
/* menu de ecrã inteiro (mobile) */
.nv__menu{position:fixed;inset:0;z-index:70;pointer-events:auto;padding:88px 26px 26px;
  background:rgba(8,11,18,.97);-webkit-backdrop-filter:blur(20px);backdrop-filter:blur(20px);
  display:flex;flex-direction:column;gap:22px;
  transform:translateX(100%);opacity:0;visibility:hidden;
  transition:transform .35s var(--ease),opacity .35s var(--ease),visibility .35s}
.nv__menu.open{transform:none;opacity:1;visibility:visible}
.nv__close{position:absolute;top:22px;right:22px;background:none;border:none;cursor:pointer;
  padding:8px;color:var(--ink)}
.nv__menu a,.nv__menu .nv__mgroup{font-size:17px;font-weight:500;color:var(--ink);
  opacity:0;transform:translateX(18px);transition:opacity .3s var(--ease),transform .3s var(--ease)}
.nv__menu.open a,.nv__menu.open .nv__mgroup{opacity:1;transform:none}
.nv__menu.open a:nth-child(2){transition-delay:.08s}
.nv__menu.open a:nth-child(3){transition-delay:.16s}
.nv__menu.open a:nth-child(4){transition-delay:.24s}
.nv__menu .nv__cta{margin-top:10px;padding:14px 20px;font-size:15px;justify-content:center;animation:none;color:#0B1220}

@media(max-width:820px){
  .nv__links{display:none}
  .nv__right .nv__cta,.nv__right .lang{display:none}
  .nv__burger{display:block}
  .nv__bar{padding:10px 10px 10px 16px}
}
```

O painel entra pela direita (`translateX(100%)` → `none`) e **os itens entram por
dentro dele**, cada um com mais 18px de deslocamento à direita e 80ms de atraso. Duas
camadas de movimento no mesmo gesto: é isso que separa uma gaveta de um `display:block`.

O atraso está outra vez na regra `.open`. Aqui isso é deliberado e importa: ao
**fechar**, a classe sai, os atrasos desaparecem e todos os itens saem em conjunto,
instantaneamente, com o painel. Uma saída escalonada leria-se lenta.

`animation:none` no CTA dentro da gaveta — pela mesma razão dos links do dropdown:
herdava o `nvCta` da barra de desktop.

### 4.5 O JS: abrir, fechar, focus trap, bloqueio de scroll

```js
/* =========================================================
   NAVBAR — menu mobile (abrir/fechar, Esc, foco, scroll bloqueado)
   ========================================================= */
window.__scrollLocks = 0;
window.__lockScroll = function(on){
  var d = document.documentElement;
  if(on){ if(!window.__scrollLocks++){ var g = window.innerWidth - d.clientWidth;
    d.style.overflow='hidden'; if(g>0) d.style.paddingRight = g+'px'; } }
  else if(window.__scrollLocks > 0 && !--window.__scrollLocks){ d.style.overflow=''; d.style.paddingRight=''; }
};

(function navbar(){
  const menu = document.getElementById('nv-menu');
  const burger = document.getElementById('nv-burger');
  const close = document.getElementById('nv-close');
  if(!menu || !burger || !close) return;

  let lastFocus = null;

  function setOpen(open){
    menu.classList.toggle('open', open);
    burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    window.__lockScroll(open);
    if(open){ lastFocus = document.activeElement; close.focus(); }
    else if(lastFocus){ lastFocus.focus(); lastFocus = null; }
  }

  burger.addEventListener('click', () => setOpen(true));
  close.addEventListener('click', () => setOpen(false));
  menu.querySelectorAll('a').forEach(a => a.addEventListener('click', () => setOpen(false)));
  document.addEventListener('keydown', e => {
    if(e.key === 'Escape' && menu.classList.contains('open')) setOpen(false);
    if(e.key !== 'Tab' || !menu.classList.contains('open')) return;
    // prende o foco dentro do menu enquanto está aberto
    const f = menu.querySelectorAll('a,button');
    if(!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if(e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
    else if(!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
  });
  // se passar a desktop com o menu aberto, fecha para não deixar o scroll travado
  matchMedia('(min-width:821px)').addEventListener('change', e => { if(e.matches) setOpen(false); });
})();
```

**O bloqueio de scroll com contador.** É a peça que mais vezes se faz mal.

- **Contador (`__scrollLocks`), não booleano.** Numa página há mais do que uma coisa
  que bloqueia o scroll — o menu mobile e um lightbox de galeria, por exemplo. Com um
  booleano, fechar o lightbox que abriu *por cima* do menu destravava o scroll com o
  menu ainda aberto. O contador só destranca quando o último dono larga. `!__scrollLocks++`
  é verdadeiro só na transição 0→1; `!--__scrollLocks` só na transição 1→0.
- **`window.innerWidth - documentElement.clientWidth`** é a largura da barra de
  scroll. Ao pôr `overflow:hidden` a barra desaparece e a página inteira salta essa
  largura para a direita — em desktop com barra clássica são 15-17px de salto brutal.
  Compensa-se com `paddingRight` do mesmo valor. Em macOS com barras sobrepostas o
  cálculo dá 0 e não se põe padding nenhum, que é o correcto.
- **`documentElement`, não `body`.** É no `<html>` que está o `background` e é ele que
  rola.

**`matchMedia('(min-width:821px)')`** — 821px, ou seja o media query mobile é
`max-width:820px` e o seu complemento exacto começa em 821. Se o utilizador rodar o
telemóvel ou redimensionar a janela com o menu aberto, o menu deixa de estar visível
(`.nv__burger{display:none}`) mas o `overflow:hidden` continuava aplicado: a página
ficava com o scroll morto e sem forma de o recuperar. Fechar o menu na transição
resolve-o na raiz.

**Focus trap** — enquanto o menu está aberto, Tab no último elemento salta para o
primeiro e Shift+Tab no primeiro salta para o último. Sem isto o foco sai para trás do
overlay e o utilizador de teclado fica a navegar às cegas. `lastFocus` devolve o foco
ao burger ao fechar.

### 4.6 Movimento reduzido

```css
@media(prefers-reduced-motion:reduce){
  .nv__bar,.nv__mark,.nv__links a,.nv__cta{animation:none}
  .nv__menu,.nv__menu a{transition:none}
}
```

---

## 5. Sheen — o clarão de vidro

Uma faixa de luz que atravessa o cartão em diagonal. Dispara uma vez quando o cartão
assenta e outra no hover, com cooldown.

### 5.1 O CSS

```css
/* o clarão do glass-shine-card: varre uma vez à entrada, e no hover */
.sb__sheen{position:absolute;inset:-45%;z-index:3;pointer-events:none;
  opacity:0;transform:translate3d(-60%,60%,0);mix-blend-mode:screen;
  background:linear-gradient(66deg,
    rgba(255,255,255,0) 42%, rgba(157,194,255,.14) 47%,
    rgba(255,255,255,.32) 50%, rgba(157,194,255,.14) 53%,
    rgba(255,255,255,0) 58%)}
.sb__sheen.is-shine{animation:sb-shine 1.9s var(--ease) forwards}
@keyframes sb-shine{
  0%{opacity:0;transform:translate3d(-60%,60%,0)}
  14%{opacity:1} 70%{opacity:1}
  100%{opacity:0;transform:translate3d(60%,-60%,0)}
}
```

O `.sb__sheen` é um `<span>` vazio dentro do cartão, que tem
`overflow:hidden;isolation:isolate`.

Cada valor:

- **`inset:-45%`** — a camada é *maior* que o cartão em todas as direcções. Tem de ser:
  a faixa viaja de `-60%` a `+60%` e, se a camada fosse do tamanho do cartão, a luz
  entraria já dentro do enquadramento em vez de vir de fora. Os 45% de folga garantem
  que a faixa nasce e morre fora da área visível.
- **`mix-blend-mode:screen`** — é o que faz a luz **somar-se** ao que está por baixo em
  vez de o tapar. Com `normal`, a faixa branca lê-se como um plástico por cima da
  foto; com `screen`, os pixéis escuros da foto clareiam e os claros mantêm-se, que é
  como o vidro se comporta. Requer o `isolation:isolate` no cartão para o blend não
  escapar para o resto da página.
- **`66deg`** — não 45. A diagonal exacta lê-se geométrica e barata. 66° é uma
  inclinação de reflexo credível, e é o mesmo ângulo em que a faixa viaja
  (`-60%,60%` → `60%,-60%`: para a direita e para cima).
- **O gradiente tem cinco paragens em 16% da largura (42%→58%)** — bordo suave, halo
  azul (`--accent-2` a .14), núcleo branco a .32, halo, bordo. É um núcleo com dois
  halos, não um risco. Uma paragem só lê-se como uma linha.
- **`1.9s`** — lenta de propósito. Um sheen rápido lê-se como um glitch.
- **`14%` e `70%`** de opacidade cheia — acende depressa e apaga devagar, tal como um
  reflexo real ao sair do enquadramento.
- **`translate3d`** e não `translate` — força camada de composição, a animação nunca
  toca em layout.

### 5.2 O JS

```js
var reduce = matchMedia('(prefers-reduced-motion:reduce)').matches;
var cool = 0;

function shine(){
  if(!sheen || reduce) return;
  sheen.classList.remove('is-shine');
  void sheen.offsetWidth;                    /* reinicia a animação */
  sheen.classList.add('is-shine');
}
function pulse(){
  var now = Date.now();
  if(now < cool) return;
  cool = now + 1600;
  shine();
}

/* dentro do observer do reveal: */
if(el === card) setTimeout(shine, 620);      /* o clarão entra depois de o card assentar */

/* e no hover: */
if(card) card.addEventListener('pointerenter', pulse);
```

**`void sheen.offsetWidth` — o truque de reinício.** Tirar e voltar a pôr a classe na
mesma tarefa de JS não reinicia nada: o browser junta as duas mutações num só recálculo
de estilo e conclui que a classe nunca saiu. Ler `offsetWidth` força um *reflow*
síncrono, ou seja obriga o browser a materializar o estado sem a classe antes de a
tornar a pôr. O `void` está lá só para deixar explícito que o valor lido se deita fora
— é uma leitura com efeito secundário, e o `void` diz ao próximo leitor que é
intencional e não código morto.

**Os 620ms.** O reveal do cartão dura `.9s`. Disparar o sheen ao mesmo tempo mistura
dois movimentos e não se lê nenhum. 620ms é aproximadamente 70% da entrada: o cartão
já está quase parado, a luz varre-o depois. **O clarão é a confirmação de que o cartão
chegou**, não parte da chegada.

**O cooldown de 1600ms.** A animação dura 1.9s. Sem cooldown, entrar e sair do cartão
depressa reinicia a faixa a cada movimento e o cartão pisca. 1600ms é ligeiramente
*menos* do que a duração: quem passa o rato repetidamente com paciência normal vê um
clarão completo de cada vez, e quem varre o rato com nervosismo vê um só.

### 5.3 Movimento reduzido

```css
@media(prefers-reduced-motion:reduce){
  .sb__sheen{display:none}
}
```

Aqui não se "para" — remove-se. Um sheen parado a meio é uma barra branca no meio da
foto. E o `reduce` no JS impede o `shine()` de sequer correr.

---

## 6. Desenho SVG em ciclo — a casa da ponte

Uma casa desenhada a traço que se desenha sozinha, acende as luzes, respira e apaga —
em ciclo de 12s, por trás de uma frase. Serve de "ponte" entre o hero e o resto da
página.

### 6.1 O HTML

```html
<section class="sb-bridge">
  <svg class="sb-house" viewBox="0 0 200 150" aria-hidden="true" focusable="false">
    <g class="sb-house__luz">
      <path style="--d:0s"   d="M54 86 H80 V110 H54 Z"/>
      <path style="--d:.18s" d="M120 86 H146 V110 H120 Z"/>
      <path style="--d:.36s" d="M86 140 V98 H114 V140 Z"/>
    </g>
    <g class="sb-house__linhas">
      <path style="--d:0s"    d="M18 72 L100 10 L182 72"/>
      <path style="--d:.5s"   d="M34 62 V140 H166 V62"/>
      <path style="--d:1.1s"  d="M150 33 V16 H162 V45"/>
      <path style="--d:1.5s"  d="M86 140 V98 H114 V140"/>
      <path style="--d:1.9s"  d="M54 86 H80 V110 H54 Z M67 86 V110 M54 98 H80"/>
      <path style="--d:2.3s"  d="M120 86 H146 V110 H120 Z M133 86 V110 M120 98 H146"/>
    </g>
    <circle class="sb-house__ponta" r="2.4"/>
  </svg>
  <p class="sb-bridge__line">Cada imóvel tem uma história e um valor justo.</p>
</section>
```

Ordem de desenho: telhado → paredes → chaminé → porta → janela esquerda → janela
direita. É a ordem por que uma pessoa desenharia a casa, e é isso que faz o
espectador ler o traço como uma mão e não como uma máquina.

### 6.2 O CSS

```css
/* =========================================================
   A CASA — desenha-se sozinha por trás da frase, em ciclo.

   Três tempos, como numa composição de After Effects:
   1. os traços correm com um ponto de luz à frente da caneta (trim path);
   2. as janelas e a porta acendem-se depois do contorno fechar;
   3. tudo respira devagar e apaga, e recomeça.

   O comprimento de cada traço é medido em JS (getTotalLength), senão o
   stroke-dasharray tinha de ser adivinhado e o desenho saía a meio.
   ========================================================= */
.sb-house{
  position:absolute;left:50%;top:50%;
  width:min(440px,68vw);height:auto;z-index:0;pointer-events:none;
  color:var(--accent-2);opacity:.2;
  transform:translate(-50%,-50%);
  animation:sbRespira 12s ease-in-out infinite;
}
@keyframes sbRespira{
  0%,100%{transform:translate(-50%,-50%) scale(.985)}
  50%    {transform:translate(-50%,-50%) scale(1.015)}
}

.sb-house__linhas path{
  fill:none;stroke:currentColor;stroke-width:1.6;
  stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke;
  stroke-dasharray:var(--len,600);stroke-dashoffset:var(--len,600);
  filter:drop-shadow(0 0 3px rgba(157,194,255,.5));
  animation:sbDraw 12s var(--ease) infinite;animation-delay:var(--d,0s);
}
@keyframes sbDraw{
  0%  {stroke-dashoffset:var(--len,600);opacity:0}
  4%  {opacity:1}
  22% {stroke-dashoffset:0;opacity:1}
  86% {stroke-dashoffset:0;opacity:1}
  94% {stroke-dashoffset:0;opacity:0}
  100%{stroke-dashoffset:var(--len,600);opacity:0}
}

/* a luz que se acende lá dentro depois de a casa estar fechada — é o momento
   em que deixa de ser um desenho e passa a ser uma casa habitada */
.sb-house__luz path{
  fill:var(--accent);stroke:none;opacity:0;
  filter:blur(1px);
  animation:sbLuz 12s var(--ease) infinite;animation-delay:var(--d,0s);
}
@keyframes sbLuz{
  0%,40%{opacity:0}
  48%   {opacity:.62}
  56%   {opacity:.3}
  86%   {opacity:.3}
  94%   {opacity:0}
  100%  {opacity:0}
}

/* a ponta da caneta a correr o telhado. Só existe onde o offset-path é
   suportado: sem ele o círculo cairia no canto 0,0 e ficava um pingo parado. */
.sb-house__ponta{display:none}
@supports (offset-path: path('M0 0 L1 1')){
  .sb-house__ponta{
    display:block;fill:#EAF1FF;opacity:0;
    offset-path:path('M18 72 L100 10 L182 72');offset-distance:0%;
    filter:drop-shadow(0 0 5px rgba(157,194,255,.95));
    animation:sbPonta 12s var(--ease) infinite;
  }
  @keyframes sbPonta{
    0%  {offset-distance:0%;opacity:0}
    4%  {opacity:1}
    22% {offset-distance:100%;opacity:1}
    28% {offset-distance:100%;opacity:0}
    100%{offset-distance:100%;opacity:0}
  }
}

/* um halo por trás, para o fundo não ficar chapado */
.sb-bridge::after{
  content:"";position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
  width:min(620px,118vw);height:min(400px,78vw);z-index:0;pointer-events:none;
  background:radial-gradient(ellipse at center,rgba(77,141,246,.2) 0%,rgba(77,141,246,0) 68%);
}
```

### 6.3 O JS — medir os comprimentos

```js
/* a casa da ponte: cada traço precisa de saber o seu próprio comprimento
   para se desenhar do princípio ao fim e não a meio */
(function SB_casa(){
  var casa = document.querySelector('.sb-house');
  if(!casa) return;
  casa.querySelectorAll('.sb-house__linhas path').forEach(function(p){
    try{ p.style.setProperty('--len', Math.ceil(p.getTotalLength()) + 'px'); }catch(e){}
  });
})();
```

**Porquê JS e não um valor à mão.** `stroke-dasharray` tem de valer *exactamente* o
comprimento do traço:

- **valor a menos** → o traço fica desenhado só em parte e o resto nunca aparece;
- **valor a mais** → o traço acaba de desenhar antes do fim da animação e fica um
  tempo morto parado.

E o comprimento não se adivinha: um `path` com curvas, ou com vários subpaths (repara
que as janelas têm três `M` no mesmo `d`), tem um comprimento que só o motor de
render sabe calcular. `getTotalLength()` devolve-o. O `Math.ceil` arredonda para cima
— um pixel a mais nunca se vê, um a menos deixa um resto de traço por desenhar.

O `try/catch` cobre motores onde `getTotalLength` falha em `path` invisível; nesse
caso fica o fallback `var(--len, 600)` e o desenho degrada em vez de partir.

### 6.4 Os três tempos, na linha de 12s

Tudo — o traço, as luzes, a respiração, a ponta — corre a **12s**, em fase.

| % | s | acontecimento |
|---|---|---|
| 0% | 0.0 | tudo apagado, `dashoffset` no máximo |
| 4% | 0.5 | os traços acendem (`opacity` 0→1) |
| 22% | 2.6 | `dashoffset:0` — o contorno está fechado |
| 40% | 4.8 | as luzes ainda apagadas |
| 48% | 5.8 | as luzes acendem ao máximo (.62) |
| 56% | 6.7 | as luzes baixam para o brilho de repouso (.3) |
| 86% | 10.3 | fim do repouso — a casa esteve viva ~3.6s |
| 94% | 11.3 | tudo apaga (`opacity:0`) |
| 100% | 12.0 | `dashoffset` volta ao máximo, invisível, e recomeça |

Duas coisas a reter:

- **O reset do `dashoffset` acontece entre 94% e 100%, com `opacity` já a 0.** Se o
  reset fosse a 100% com opacidade cheia, ver-se-ia o desenho a desaparecer de golpe.
  Assim ele apaga primeiro e só depois "rebobina", invisível.
- **As luzes só arrancam a 40%**, muito depois do contorno fechar a 22%. Esse silêncio
  de 2 segundos é o que faz a casa parecer *habitada* — primeiro constrói-se, depois
  alguém acende a luz. Sem a pausa, é só um desenho colorido.

Os `--d` por `path` (0s, .5s, 1.1s, 1.5s, 1.9s, 2.3s) escalonam **dentro** desta linha
de tempo — todos os traços correm o mesmo keyframe de 12s, mas desfasados. Os
intervalos crescem (0.5, 0.6, 0.4, 0.4, 0.4) e não são regulares, precisamente para
não se lerem como um metrónomo.

### 6.5 A respiração de 12s

```css
@keyframes sbRespira{
  0%,100%{transform:translate(-50%,-50%) scale(.985)}
  50%    {transform:translate(-50%,-50%) scale(1.015)}
}
```

3% de amplitude total (.985 → 1.015), num ciclo de 12 segundos. É deliberadamente
sub-liminar: ninguém repara que a casa está a respirar, mas se se tirar a animação o
bloco fica visivelmente morto. E, outra vez, o `translate(-50%,-50%)` está nos dois
keyframes.

### 6.6 O `@supports` do `offset-path`

O ponto de luz que corre à frente da caneta usa `offset-path`, que não existe em todo
o lado. O padrão:

```css
.sb-house__ponta{display:none}
@supports (offset-path: path('M0 0 L1 1')){
  .sb-house__ponta{ display:block; offset-path:path('…'); … }
}
```

Escondido por omissão, mostrado só quando o motor confirma que sabe usar `offset-path`.
**Sem isto o `<circle>` renderiza-se na sua posição declarada — cx=0, cy=0 — e fica um
pingo branco parado no canto superior esquerdo do SVG.** Um bug visível e feio, e o
`@supports` custa três linhas.

O `path()` da ponta é uma cópia literal do `d` do telhado. É uma duplicação assumida:
`offset-path` não sabe referenciar outro elemento. Se o telhado mudar, esta string tem
de mudar com ele.

A ponta desaparece a 28% (`opacity:0`) e fica parada no fim do caminho o resto do
ciclo — não volta para trás, não pisca.

### 6.7 Movimento reduzido

```css
@media(prefers-reduced-motion:reduce){
  .sb-house{animation:none}
  .sb-house__linhas path{animation:none;stroke-dashoffset:0}
  .sb-house__luz path{animation:none;opacity:.3}
  .sb-house__ponta{display:none}
}
```

O resultado é a casa desenhada por inteiro, com as luzes no brilho de repouso, parada.
Nada desaparece — é o estado final da animação, congelado. `stroke-dashoffset:0` é o
que a torna visível: sem essa linha, a regra `animation:none` deixaria a casa no estado
*inicial*, ou seja invisível.

---

## 7. Hovers de cartão

Um cartão em hover move **quatro coisas ao mesmo tempo**, e é o facto de se moverem
juntas com o mesmo easing que faz a coisa parecer cara.

```css
/* a foto respira */
.pv-media img{
  width:100%;height:100%;object-fit:cover;object-position:center;
  transform:scale(1);transition:transform .8s var(--ease);
}
.pv-card:hover .pv-media img{transform:scale(1.045)}

/* a moldura da foto ganha profundidade */
.pv-media{transition:box-shadow .5s var(--ease)}
.pv-card:hover .pv-media{box-shadow:0 44px 100px rgba(0,0,0,.58)}

/* a caixa sobe e a borda acende */
.pv-body{
  transition:transform .5s var(--ease),border-color .4s var(--ease),box-shadow .5s var(--ease);
}
.pv-card:hover .pv-body{
  transform:translateY(-5px);
  border-color:rgba(157,194,255,.42);
  box-shadow:0 52px 110px rgba(0,0,0,.64), inset 0 1px 0 rgba(255,255,255,.14);
}

/* o título muda de cor */
.pv-name .pv-go{color:var(--ink);transition:color .3s var(--ease)}
.pv-card:hover .pv-name .pv-go{color:var(--accent-2)}

/* a seta avança */
.pv-more svg{width:18px;height:18px;flex:none;transition:transform .4s var(--ease)}
.pv-card:hover .pv-more svg{transform:translateX(5px)}
```

Os números, e porquê:

- **`scale(1.045)` em `.8s`** na foto. Um `scale` grande (1.1) lê-se como zoom digital
  e revela pixelização; 4.5% é quase imperceptível como escala mas perfeitamente
  perceptível como *vida*. A duração longa (.8s) é o que o torna cinemático em vez de
  nervoso — a foto continua a crescer devagar enquanto o resto já assentou. **É a única
  duração longa num hover, e é intencional.**
- **`translateY(-5px)` em `.5s`** na caixa. 5px chega. A 10px o cartão descola e
  parece que se desprendeu.
- **`translateX(5px)` em `.4s`** na seta. Mesmo deslocamento da caixa, noutro eixo: a
  seta *aponta* para onde o clique leva.
- **`border-color` a `rgba(157,194,255,.42)` em `.4s`** — a borda acende ao acento
  claro. É a única mudança de cor da caixa; o fundo não muda.
- **A sombra cresce** (44→52px de offset, 100→110px de blur) com a subida. Uma coisa
  que sobe projecta sombra mais longe. Se o `translateY` subisse sem a sombra crescer,
  o olho detecta a incoerência mesmo sem a saber nomear.

**A regra**: todas estas transições usam `var(--ease)`. As durações variam entre .3s e
.8s conforme a massa do que se move (texto é leve e rápido, fotografia é pesada e
lenta), mas a **curva é sempre a mesma**. Ver ponto 9.

Variantes noutras páginas, mesmos números:

```css
.pg-shot:hover{border-color:rgba(157,194,255,.55)}
.pg-shot:hover img{transform:scale(1.045)}
.pg-shot:hover::after,.pg-shot:focus-visible::after{opacity:1;transform:none}
.pg-shot:focus-visible{outline:2px solid var(--accent-2);outline-offset:3px;border-color:transparent}
```

**Nota de acessibilidade**: sempre que há `:hover`, há `:focus-visible` a fazer o
mesmo. Um cartão que só reage ao rato é um cartão que não existe para o teclado.

### 7.1 Movimento reduzido

```css
@media(prefers-reduced-motion:reduce){
  .pv-body,.pv-card:hover .pv-body{transform:none;transition:none}
  .pv-media img,.pv-card:hover .pv-media img{transform:none;transition:none}
  .pv-more svg,.pv-card:hover .pv-more svg{transform:none;transition:none}
  .pv-name .pv-go{transition:none}
}
```

As mudanças de **cor** ficam (a borda acende, o título muda) — não são movimento e são
sinal de interactividade que não convém perder. Só os `transform` desaparecem.

---

## 8. Carrossel em leque (reels)

Seis cartões verticais 9:16 dispostos em leque, o do meio direito e à frente, os
outros a rodar e a encolher para os lados. Em ecrã estreito o leque deixa de fazer
sentido e transforma-se numa tira com scroll-snap.

**A decisão estruturante**: o JS calcula **posições**, o CSS faz a **interpolação**.
Não há GSAP, não há rAF a interpolar. Quando o utilizador avança, o JS escreve um
`transform` novo em cada cartão e a `transition .62s var(--ease)` do CSS trata da
viagem. Menos código, easing consistente com o resto da página, e a animação corre no
compositor.

### 8.1 O CSS — o palco

```css
/* ---------- o palco: em ecrã largo, o leque ---------- */
.rl__stage{
  --rl-w:clamp(160px,19vw,264px);   /* leque maior no desktop, mesma composição */
  position:relative;width:100%;height:calc(var(--rl-w) * 16 / 9 * 1.2);
  display:flex;align-items:center;justify-content:center;
  touch-action:pan-y;
}
.rl-card{
  position:absolute;left:50%;top:50%;
  width:var(--rl-w);aspect-ratio:9/16;
  margin:0;border-radius:20px;overflow:hidden;cursor:pointer;
  border:1px solid rgba(255,255,255,.16);
  background:#0b0f18;
  box-shadow:0 26px 60px rgba(0,0,0,.55);
  transform:translate(-50%,-50%) scale(.5);opacity:0;
  transition:transform .62s var(--ease),opacity .45s var(--ease),border-color .35s var(--ease);
  will-change:transform;
}
.rl-card.is-center{border-color:rgba(157,194,255,.44)}
.rl-card img,.rl-card video{
  position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;
}
.rl-card video{opacity:0;transition:opacity .45s var(--ease)}
.rl-card.is-playing video{opacity:1}
```

- **A altura do palco é `--rl-w * 16/9 * 1.2`** — a altura de um cartão mais 20% de
  folga. Os cartões rodam até 26°, e um rectângulo rodado ocupa mais altura do que a
  sua própria. Sem a folga, os cartões das pontas ficam decapitados.
- **`transition` com três durações diferentes**: posição a `.62s`, opacidade a `.45s`,
  borda a `.35s`. A posição é o movimento principal e é a mais lenta; a opacidade
  acompanha mais depressa para o cartão não pairar meio transparente.
- **Estado inicial `scale(.5); opacity:0`** — antes do primeiro `render()` os cartões
  estão encolhidos e invisíveis. A primeira chamada põe-nos no sítio e é isso que se
  lê como a montagem do leque.
- **`touch-action:pan-y`** no palco em desktop/tablet: o gesto vertical continua a
  rolar a página, o horizontal fica para o handler de `touchstart`/`touchend`.
- **`will-change:transform`** — aqui justifica-se (seis elementos, animação contínua,
  sempre `transform`). Não é para ser polvilhado em todo o lado.
- **O `<video>` nasce a `opacity:0` por cima do `<img>` poster** e faz fade quando toca.
  Assim não há salto de frame nem flash preto entre o poster e o primeiro fotograma.

### 8.2 O JS — a função de layout

```js
var N = REELS.length;
var H = Math.floor(N / 2);
var DESTAQUE = 2;
var active = DESTAQUE, hovered = null;

/* ---------- o leque, agora a rodar ----------
   O ativo está SEMPRE no meio, direito e à frente; os outros distribuem-se
   à volta pela distância relativa. Como só há seis cartões para uma volta
   inteira, há uma emenda: o slot mais afastado (rel -3) é onde o cartão
   salta de um extremo ao outro, e por isso é o mais apagado. */
var STEP = 0.55;                    /* passo entre slots, em larguras de cartão */
/* tabelas por |rel|: o afastamento cresce menos que linearmente para o
   extremo esquerdo (que tem um slot a mais) não fugir do palco */
var XS  = [0, 1, 1.85, 2.45];
var ROT = [0, 10, 19, 26];
var SC  = [1.06, .9, .78, .68];
var DY  = [-.03, .02, .075, .13];
var OP  = [1, .92, .6, .2];

function relOf(i){ return ((((i - active + H) % N) + N) % N) - H; }   /* -3 .. +2 */

var prevRel = cards.map(function(){ return null; });

function layoutFan(){
  var w = cards[0].offsetWidth || 190;
  var h = w * 16 / 9;

  cards.forEach(function(card, i){
    var rel = relOf(i);
    var a = Math.abs(rel), s = rel < 0 ? -1 : 1;
    var x = s * XS[a] * STEP * w;
    var y = DY[a] * h;
    var rot = s * ROT[a];
    var sc = SC[a];
    var op = OP[a];
    var z = 30 - a * 6;

    if(hovered === i && i !== active && !reduce){   /* o sobrevoado espreita */
      rot *= .5; sc *= 1.07; y -= h * .03; z = 26; op = Math.min(1, op + .25);
    }

    var tf = 'translate(-50%,-50%) translate(' + x + 'px,' + y + 'px) rotate(' + rot + 'deg) scale(' + sc + ')';
    /* deu a volta: se deixasse a transição correr via-se o cartão atravessar
       o palco todo, por isso reposiciona-se invisível e só depois acende */
    var wrapped = prevRel[i] !== null && Math.abs(rel - prevRel[i]) > H;

    card.style.zIndex = String(z);
    if(wrapped && !reduce){
      card.style.transition = 'none';
      card.style.opacity = '0';
      card.style.transform = tf;
      void card.offsetWidth;                 /* obriga o salto a ser aplicado já */
      card.style.transition = '';
      (function(el, o){ requestAnimationFrame(function(){ el.style.opacity = o; }); })(card, String(op));
    } else {
      card.style.transform = tf;
      card.style.opacity = String(op);
    }
    prevRel[i] = rel;
  });
}

/* na tira quem manda é o scroll: o JS só limpa o que escreveu no leque */
function layoutStrip(){
  cards.forEach(function(card, i){
    card.style.transform = '';
    card.style.opacity = '';
    card.style.zIndex = '';
    card.style.transition = '';
    prevRel[i] = null;
  });
}
```

Como se lê:

- **`relOf(i)`** converte o índice absoluto do cartão em posição *relativa ao activo*,
  no intervalo `-H .. +H-1` (com N=6, H=3: −3 a +2). A dupla módulo com `+N` é para
  lidar com negativos, que em JS `%` não normaliza.
- **`a = |rel|`** indexa as cinco tabelas; **`s`** é o sinal, que espelha o resultado
  para o lado certo. Cinco arrays de quatro valores em vez de fórmulas: é legível,
  afinável à mão e não precisa de matemática nenhuma para ajustar um slot.
- **`XS = [0, 1, 1.85, 2.45]`** — os incrementos são 1, 0.85, 0.60: o afastamento
  **cresce menos que linearmente**. É o que faz os cartões das pontas aproximarem-se e
  se lerem como um leque a fechar, em vez de fugirem para fora do palco. É também o que
  acomoda o slot extra do lado esquerdo (−3 existe, +3 não).
- **`ROT`, `SC`, `OP`, `DY`** todos acompanham: mais longe = mais rodado, mais pequeno,
  mais apagado, mais baixo. O `DY[0] = -.03` levanta o cartão activo 3% acima da linha
  dos outros — é um detalhe minúsculo que o destaca sem o aumentar.
- **`SC[0] = 1.06`** — o activo é 6% maior que a escala natural.
- **`z = 30 - a*6`** — o empilhamento acompanha a distância, sem excepções.
- **O hover intermédio** (`rot *= .5; sc *= 1.07; y -= h*.03`) endireita e levanta o
  cartão sobrevoado. Não o traz ao centro — só o faz "espreitar". É um estado de
  antecipação, não uma navegação.

**A emenda (`wrapped`).** O carrossel é circular mas há seis cartões para uma volta:
em cada avanço há um cartão cuja posição relativa salta de +2 para −3. Se a transição
CSS corresse nesse salto, via-se o cartão atravessar o palco inteiro em .62s, ao
contrário de toda a gente. A solução: detectar o salto (`|rel - prevRel| > H`),
desligar a transição, pôr `opacity:0`, escrever a posição nova, forçar o reflow com
`void card.offsetWidth`, repor a transição e só no frame seguinte
(`requestAnimationFrame`) reacender a opacidade. O cartão teleporta-se invisível e
aparece no sítio certo.

É o mesmo `void offsetWidth` do sheen (ponto 5.2), pela mesma razão exacta.

**`OP[3] = .2`** — o slot mais afastado, que é sempre onde a emenda acontece, é o mais
apagado de todos. Se por alguma razão o salto se vir, vê-se a 20% de opacidade.

### 8.3 Só o cartão ao centro carrega e toca vídeo

```js
/* só um reel pede vídeo à rede de cada vez: seis a tocar custavam
   megabytes e bateria a troco de nada */
function playActive(){
  cards.forEach(function(card, i){
    var v = card.querySelector('video');
    if(i === active && !reduce){
      if(!v.src) v.src = card.dataset.src;
      var pr = v.play();
      if(pr && pr.catch) pr.catch(function(){});
      card.classList.add('is-playing');
    } else {
      if(!v.paused) v.pause();
      card.classList.remove('is-playing');
    }
  });
}
```

O `<video>` nasce com `preload="none"` e **sem `src`**:

```js
'<video muted loop playsinline preload="none" poster="' + r.poster + '"></video>'
```

O `src` só é escrito quando o cartão chega ao centro, e uma vez escrito fica (o
`if(!v.src)` evita recarregar). Seis reels a carregar em simultâneo eram vários MB e
bateria gasta em vídeo que ninguém está a ver.

`muted` + `playsinline` são obrigatórios para o autoplay passar nas políticas dos
browsers. O `pr.catch(function(){})` engole a rejeição de `play()` quando a política
o recusa mesmo assim — sem ele, aparece um erro não tratado na consola.

E a secção inteira pára fora do ecrã:

```js
/* fora do ecrã não se gasta rede nem bateria */
var io2 = new IntersectionObserver(function(entries){
  entries.forEach(function(en){
    if(en.isIntersecting){ render(); }
    else { cards.forEach(function(c){ var v = c.querySelector('video'); if(v && !v.paused) v.pause(); }); }
  });
}, {threshold:.15});
io2.observe(sec);
```

Este observer **não** faz `unobserve` — ao contrário dos reveals, é um estado que
oscila e tem de continuar a ouvir.

### 8.4 Abaixo de 760px: a tira

```css
/* ---------- telemóvel: em vez do leque, uma tira que se arrasta ----------
   Rodado e sobreposto, o leque sai cortado pelas margens num ecrã estreito.
   Aqui os cartões voltam ao fluxo, lado a lado, e o dedo é que manda. */
@media(max-width:760px){
  .rl__stage{
    --rl-w:min(58vw,240px);
    height:auto;
    /* block + inline-block em vez de flex: containers flex ignoram o padding
       final ao chegar ao fim do scroll, e o último cartão ficava colado */
    display:block;white-space:nowrap;
    overflow-x:auto;overflow-y:hidden;
    scroll-snap-type:x mandatory;
    -webkit-overflow-scrolling:touch;
    /* pan-x sozinho SEQUESTRA o gesto: com o dedo em cima da tira já não se
       conseguia rolar a página para baixo, só para o lado. Declarar os dois eixos
       deixa o browser decidir pela direção do gesto — horizontal vai para a tira,
       vertical passa para a página. */
    touch-action:pan-x pan-y;
    /* a barra some: quem indica que há mais é o cartão seguinte a espreitar */
    scrollbar-width:none;-ms-overflow-style:none;
    /* a tira sangra até às margens do ecrã, mas o scroll fica preso a ela:
       a página não ganha deslocamento lateral nenhum. width:auto é preciso
       para as margens negativas esticarem em vez de só empurrarem */
    width:auto;margin-inline:calc(var(--pad) * -1);
    /* as folgas laterais valem meio ecrã menos meio cartão: é o que permite
       ao primeiro e ao último assentarem no centro como todos os outros.
       Em vw porque a tira ocupa o ecrã todo, e % contaria a partir do pai */
    /* a folga vertical existe para o cartão em destaque poder crescer 7% sem ser
       cortado pelo overflow-y:hidden — o clip é na caixa de padding */
    padding:20px calc(50vw - var(--rl-w) / 2) 26px;
  }
  .rl__stage::-webkit-scrollbar{display:none}
  .rl-card{
    position:static;display:inline-block;vertical-align:top;
    width:var(--rl-w);margin-right:12px;   /* GAP_TIRA em JS: manter os dois iguais */
    transform:none;opacity:1;transform-origin:center center;
    box-shadow:0 14px 32px rgba(0,0,0,.5);
    /* assenta ao centro: assim o cartão que encaixa é o mesmo que o JS
       considera ativo, e o pontinho aceso nunca contradiz o que se vê */
    scroll-snap-align:center;
    transition:border-color .35s var(--ease);
  }
  /* o do meio é o que a pessoa "quer ver": cresce só 7% e ganha sombra, o
     suficiente para se destacar sem partir o alinhamento da tira */
  .rl-card.is-center{transform:scale(1.07);box-shadow:0 22px 48px rgba(0,0,0,.62)}
  .rl-card:not(.is-center){opacity:.78}
  @media(prefers-reduced-motion:reduce){
    .rl-card{transition:none}
    .rl-card.is-center{transform:none}
  }
  .rl-card:last-child{margin-right:0}
  /* na tira não há cartão "à frente": o selo é o que identifica a rede,
     por isso fica aceso em todos */
  .rl-card__tag{opacity:1}
}
```

**`touch-action:pan-x pan-y` — porque não chega `pan-x`.** `touch-action` declara os
gestos que o *browser* trata nativamente naquele elemento; tudo o resto é entregue ao
JS ou simplesmente não acontece. Com `pan-x` sozinho, o browser assume que naquela
área **só** existe deslocamento horizontal, e um gesto vertical iniciado com o dedo
em cima da tira não rola a página — fica morto. Como a tira ocupa a largura toda do
ecrã e tem a altura de um cartão 9:16, é uma área enorme onde a página deixa de
responder ao gesto normal. Declarar **os dois eixos** devolve ao browser a decisão:
ele mede a direcção inicial do gesto e encaminha-a — horizontal para a tira, vertical
para a página. `pan-x` sozinho **sequestra o gesto vertical**.

Outros pontos duramente ganhos:

- **`display:block; white-space:nowrap` com filhos `inline-block`**, e não flex. Um
  container flex com scroll horizontal **ignora o `padding` do lado do fim** ao chegar
  ao limite do scroll (comportamento antigo mas ainda presente): o último cartão ficava
  colado à margem e nunca centrava. O modelo inline respeita o padding dos dois lados.
- **`padding-inline: calc(50vw - var(--rl-w)/2)`** — meio ecrã menos meio cartão. É o
  que permite ao **primeiro e ao último** cartão assentarem no centro, como todos os
  outros. Sem isto, o primeiro fica encostado à esquerda e o `scroll-snap-align:center`
  não tem para onde o levar. Em `vw` e não em `%` porque a tira ocupa o ecrã inteiro e
  `%` seria calculado sobre o pai.
- **`padding` vertical de 20px/26px** — o cartão activo cresce 7% e `overflow-y:hidden`
  cortaria o topo e a base. O recorte do overflow acontece na caixa de *padding*, por
  isso o padding é o espaço onde o crescimento cabe.
- **`margin-inline: calc(var(--pad) * -1)` com `width:auto`** — a tira sangra até às
  margens do ecrã. `width:auto` é obrigatório: com uma largura explícita, as margens
  negativas só empurravam o bloco em vez de o esticar.
- **`scroll-snap-align:center` a condizer com o cálculo do JS.** O JS considera activo
  o cartão mais próximo do centro do scroll; o snap também assenta o cartão ao centro.
  Se os dois discordassem, o pontinho aceso contradiria o que se vê.
- **`margin-right:12px` == `GAP_TIRA = 12` no JS.** As setas deslocam a tira exactamente
  `largura + 12`. Se um dos dois mudar, o outro tem de mudar. Está comentado nos dois
  sítios de propósito.

### 8.5 Comutar entre os dois modos

```js
/* o mesmo limite do CSS: abaixo disto o palco é uma tira, e o JS não pode
   escrever transforms nos cartões senão desfaz o alinhamento do fluxo */
var mqStrip = window.matchMedia ? matchMedia('(max-width:760px)') : null;
function isStrip(){ return !!(mqStrip && mqStrip.matches); }
var GAP_TIRA = 12;   /* igual ao margin-right do .rl-card na media query */

function render(){
  if(isStrip()) layoutStrip(); else layoutFan();
  markActive();
  playActive();
}

/* mudar de modo é mudar de layout: limpar o que o outro deixou escrito */
function onMode(){
  hovered = null;
  render();
  if(isStrip()) cards[active].scrollIntoView({behavior:'auto', inline:'center', block:'nearest'});
}
if(mqStrip){
  if(mqStrip.addEventListener) mqStrip.addEventListener('change', onMode);
  else if(mqStrip.addListener) mqStrip.addListener(onMode);
}

var rt;
window.addEventListener('resize', function(){ clearTimeout(rt); rt = setTimeout(render, 140); });
```

**`layoutStrip()` limpa os estilos inline** que `layoutFan()` escreveu. Se não o
fizesse, ao passar para a tira os cartões continuariam com `transform` e `opacity`
inline a bater de frente com o layout de fluxo — os estilos inline ganham sempre à
media query.

**O JS conhece o mesmo breakpoint que o CSS (760px)**, duplicado e comentado. É uma
duplicação inevitável sem build; o comentário é o que a torna sustentável.

O `resize` tem debounce de 140ms; a mudança de modo é ouvida no `matchMedia`, que
dispara uma vez só na travessia.

### 8.6 O centro do scroll na tira

```js
/* na tira o ativo é o cartão mais perto do centro do scroll; com throttle
   por rAF para não recalcular a cada evento de scroll */
function nearestToCenter(){
  var mid = stage.scrollLeft + stage.clientWidth / 2;
  var best = 0, bd = Infinity;
  cards.forEach(function(card, i){
    var d = Math.abs((card.offsetLeft + card.offsetWidth / 2) - mid);
    if(d < bd){ bd = d; best = i; }
  });
  return best;
}
var ticking = false;
stage.addEventListener('scroll', function(){
  if(ticking) return;
  ticking = true;
  requestAnimationFrame(function(){
    ticking = false;
    if(!isStrip()) return;
    var i = nearestToCenter();
    if(i !== active){ active = i; markActive(); playActive(); }
  });
}, {passive:true});

/* põe um cartão no centro da tira. Sem isto ela abria encostada à esquerda e
   o destaque ficava fora do ecrã. */
function centrarNaTira(i, suave){
  var card = cards[i];
  if(!card) return;
  var alvo = card.offsetLeft + card.offsetWidth / 2 - stage.clientWidth / 2;
  if(stage.scrollTo) stage.scrollTo({left:alvo, behavior:(suave && !reduce) ? 'smooth' : 'auto'});
  else stage.scrollLeft = alvo;
}

/* o arranque tem de esperar que os cartões tenham largura, senão o cálculo
   do centro sai a zero. Duas passagens: uma já, outra ao carregar as imagens. */
function arrancar(){ if(isStrip()) centrarNaTira(DESTAQUE, false); }
arrancar();
window.addEventListener('load', arrancar);
if(mqStrip && mqStrip.addEventListener) mqStrip.addEventListener('change', arrancar);
```

O throttle por `requestAnimationFrame` com a flag `ticking` é o padrão certo: o evento
de scroll dispara dezenas de vezes por frame e só interessa um cálculo por frame. E
`{passive:true}` porque o handler nunca faz `preventDefault` — sem isso, o browser tem
de esperar pelo handler antes de rolar.

**As duas passagens no arranque** (`arrancar()` imediato + no `load`): antes das
imagens carregarem, `offsetWidth` pode ainda ser 0 e o cálculo do centro sai a zero.
Uma passagem depois do `load` corrige-o.

### 8.7 O gesto de arrasto no leque

```js
/* arrastar no leque (tablet e portáteis com toque): na tira é o scroll
   nativo que trata disto, senão andavam os dois a puxar ao mesmo tempo */
var x0 = null;
stage.addEventListener('touchstart', function(e){ x0 = isStrip() ? null : e.touches[0].clientX; }, {passive:true});
stage.addEventListener('touchend', function(e){
  if(x0 === null) return;
  var dx = e.changedTouches[0].clientX - x0;
  if(Math.abs(dx) > 42) go(active + (dx < 0 ? 1 : -1));
  x0 = null;
}, {passive:true});
```

`x0 = null` na tira desarma o handler por completo — na tira quem manda é o scroll
nativo, e os dois a puxar em simultâneo dão um resultado errático. Limiar de 42px para
distinguir um swipe de um toque trémulo.

### 8.8 Movimento reduzido

```css
@media(prefers-reduced-motion:reduce){
  .rl-js .rl-rev,.rl-js .rl-rev.is-in{opacity:1;transform:none;transition:none}
  .rl-card{transition:opacity .01s}
  .rl__stage{scroll-behavior:auto}
}
```

`.rl-card{transition:opacity .01s}` em vez de `transition:none`: os cartões continuam
a ser posicionados por JS a cada `go()`, e sem qualquer transição saltavam de posição
bruscamente. 10ms é imperceptível mas evita o salto seco. E no JS, `reduce` desliga o
autoplay, o hover intermédio e o `behavior:'smooth'` de todos os `scrollTo`.

---

## 9. A tabela de durações e easings do género

### 9.1 Um easing só

```css
--ease: cubic-bezier(.4,0,.2,1);
```

Este é **o** easing. Não há um segundo. É a curva "standard" do Material — arranque
rápido, saída longa e suave — e é a que produz a sensação de peso sem parecer molenga.

As únicas excepções, ambas justificadas:

- **`ease-in-out`** nas barras do fundo. É uma oscilação simétrica e infinita, não uma
  entrada: uma curva assimétrica leria-se como um tique.
- **`.5s ease-in-out`** na transição de segurança do `.gbars__bar`, pela mesma razão.

### 9.2 A tabela

| duração | onde | exemplos |
|---|---|---|
| **.2s – .25s** | micro-estados de UI | `background`/`color` de item de dropdown (.22s), `color` de link de navbar (.25s), botão de idioma (.25s) |
| **.25s – .35s** | hovers de UI | caret a rodar (.3s), `color` de título (.3s), setas do carrossel (.3s), dropdown a abrir (.26s), sociais do rodapé (.35s), pontinhos (.3s) |
| **.35s – .4s** | painéis e gavetas | menu mobile (.35s), itens do menu (.3s), sublinhado do rodapé (.38s), seta a avançar (.4s), borda de cartão (.4s) |
| **.5s – .62s** | transformações de cartão | `translateY` da caixa (.5s), sombras (.5s), entrada da navbar (.5s), posição no leque (.62s) |
| **.7s – .9s** | reveals de scroll | galeria (.7s), cartão de imóvel (.75s), rodapé (.75s), texto sobre (.8s), passos (.8s), cartão sobre (.9s), fadeUp do hero (.9s), foto a `scale` (.8s) |
| **1.05s** | entrada do hero | linhas do título (`lineUp`) |
| **1s+** | rodapé e frases de ponte | nome gigante (1s + .18s de atraso), frase da ponte (1s) |
| **1.9s** | acontecimentos únicos e lentos | sheen |
| **12s** | ambiente em ciclo | desenho da casa, respiração |

E os atrasos:

| passo | onde |
|---|---|
| **.06s** | links da navbar |
| **.08s** | irmãos de um reveal (`--d1`/`--d2`, `:nth-child`), itens do menu mobile |
| **.1s** | barras do fundo (por barra) |
| **.15s** | as duas linhas do título do hero (.12 → .27) |

### 9.3 A regra por trás da tabela

**A duração é proporcional à massa do que se move.** Texto é leve: .25s. Um painel é
médio: .4s. Um cartão inteiro com foto é pesado: .5-.9s. Uma fotografia a fazer zoom é
o mais pesado de tudo: .8s. Aplicado com consistência, o site ganha uma física própria
e o utilizador aprende-a sem dar por isso.

**E misturar easings é o que faz um site parecer barato.** Um `ease-out` aqui, um
`ease-in-out` ali, um `cubic-bezier` com bounce acolá — cada elemento passa a ter uma
personalidade própria e o conjunto lê-se como um template montado por peças. A curva
única é o que faz tudo parecer *o mesmo objecto*. É a decisão de design mais barata e
mais rentável do kit: uma variável.

Corolário: **nada de bounce, nada de `elastic`, nada de overshoot**. Este género é
sóbrio. O movimento serve para dar peso e continuidade, nunca para chamar a atenção
para si próprio.

---

## 10. `prefers-reduced-motion`

É obrigatório. Tudo o que se mexe tem de ter o seu bloco.

### 10.1 O bloco final consolidado

```css
@media(prefers-reduced-motion:reduce){
  /* documento */
  html{scroll-behavior:auto}

  /* fundo */
  .gbars__bar{animation:none;transition:none}

  /* navbar */
  .nv__bar,.nv__mark,.nv__links a,.nv__cta{animation:none}
  .nv__menu,.nv__menu a{transition:none}

  /* hero */
  .reveal-lines .ln>span{transform:none;animation:none}
  .hero .kicker,.hero .sub,.hero .cta{opacity:1;animation:none}
  .vd-hero>*{opacity:1;transform:none;animation:none}
  .vd-cue{opacity:1;transform:translateX(-50%);animation:none}   /* nunca perde a centragem */

  /* reveals — sempre as DUAS classes */
  .pv-js .pv-reveal,.pv-js .pv-reveal.is-in{opacity:1;transform:none;transition:none}
  .vd-js .vd-rev,.vd-js .vd-rev.is-in{opacity:1;transform:none;transition:none}
  .rl-js .rl-rev,.rl-js .rl-rev.is-in{opacity:1;transform:none;transition:none}
  .pg-js .pg-rev,.pg-js .pg-rev.is-in{opacity:1;transform:none;transition:none}
  .ft .ft-rev,.ft__giant{opacity:1;transform:none;transition:none;animation:none}
  .sb-bridge__line,.sb__card,.sb__i{opacity:1;transform:none;transition:none}

  /* sheen — remove-se, não se pára */
  .sb__sheen{display:none}
  .sb__card:hover img{transform:none}

  /* casa SVG — fica desenhada, não invisível */
  .sb-house{animation:none}
  .sb-house__linhas path{animation:none;stroke-dashoffset:0}
  .sb-house__luz path{animation:none;opacity:.3}
  .sb-house__ponta{display:none}

  /* hovers de cartão — sai o transform, fica a cor */
  .pv-body,.pv-card:hover .pv-body{transform:none;transition:none}
  .pv-media img,.pv-card:hover .pv-media img{transform:none;transition:none}
  .pv-more svg,.pv-card:hover .pv-more svg{transform:none;transition:none}
  .pv-name .pv-go{transition:none}

  /* carrossel */
  .rl-card{transition:opacity .01s}
  .rl__stage{scroll-behavior:auto}

  /* rodapé */
  .ft__social a,.ft__nav a,.ft__nav a::after{transition:none}
  .ft__social a:hover,.ft__social a:focus-visible{transform:none}
  .ft__nav a:hover::after,.ft__nav a:focus-visible::after{transform:scaleX(1)}
}
```

### 10.2 As cinco regras de ouro do bloco

1. **`animation:none`, `transition:none`, `opacity:1`, `transform:none`.** Os quatro,
   sempre que aplicável. `animation:none` sozinho deixa o elemento no estado *inicial*
   — que é frequentemente invisível. Tem de vir sempre acompanhado do estado final
   escrito à mão.
2. **A página tem de continuar legível e completa.** Nada desaparece. A casa fica
   desenhada (`stroke-dashoffset:0`), as luzes ficam acesas (`opacity:.3`), os reveals
   ficam visíveis. `reduce` significa *sem movimento*, não *sem conteúdo*.
3. **Cobre sempre o par de classes** (`.pv-reveal` **e** `.pv-reveal.is-in`), senão a
   especificidade da segunda pode reintroduzir a transição.
4. **Sublinhados e estados de foco ficam.** `.ft__nav a:hover::after{transform:scaleX(1)}`
   é mantido *dentro* do bloco: o sublinhado deixa de crescer, mas continua a aparecer.
   Perder o sinal de foco em nome de "menos movimento" é trocar acessibilidade por
   acessibilidade.
5. **Cor não é movimento.** Bordas a acender, títulos a mudar de cor, fundos de hover —
   ficam todos. São o que diz ao utilizador que a coisa é clicável.

### 10.3 E no JS

O CSS não chega. Todo o script que anima tem de ler a preferência:

```js
var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion:reduce)').matches;
```

E usá-la para:

- **saltar o observer** e pôr `is-in` em tudo imediatamente;
- **não disparar** o sheen (`if(!sheen || reduce) return;`);
- **não tocar vídeo** (`if(i === active && !reduce)`);
- **não fazer o hover intermédio** do leque (`if(hovered === i && i !== active && !reduce)`);
- **passar `behavior:'auto'`** em vez de `'smooth'` em todos os `scrollTo` /
  `scrollIntoView`;
- **saltar a coreografia do wrap** do carrossel (`if(wrapped && !reduce)`).

---

## 11. Armadilhas

Cada uma destas custou tempo. Estão aqui para não custarem outra vez.

### 11.1 O véu tem de chegar a zero no fim do hero

```css
.hero::after{content:"";position:absolute;inset:0;z-index:1;pointer-events:none;
  background:linear-gradient(100deg, transparent 0%, rgba(10,10,10,.18) 44%, rgba(10,10,10,.42) 78%, rgba(10,10,10,.50) 100%);
  /* o véu tem de chegar a ZERO exatamente no fim do hero: se acabar com alguma
     opacidade, o azul das barras salta de repente à saída da secção e lê-se um
     risco horizontal. A queda é longa e escalonada para não haver degrau. */
  -webkit-mask-image:linear-gradient(to bottom,#000 0%,#000 38%,rgba(0,0,0,.88) 58%,rgba(0,0,0,.58) 74%,rgba(0,0,0,.26) 88%,rgba(0,0,0,0) 100%);
          mask-image:linear-gradient(to bottom,#000 0%,#000 38%,rgba(0,0,0,.88) 58%,rgba(0,0,0,.58) 74%,rgba(0,0,0,.26) 88%,rgba(0,0,0,0) 100%)}
```

O hero tem um véu escuro por cima das barras, para o texto se ler. Esse véu acaba com
a secção. Se ainda tiver opacidade no último pixel, o azul das barras **salta** ao
entrar na secção seguinte e lê-se um risco horizontal a atravessar a página.

A solução é uma máscara de saída **longa e com paragens intermédias** (38%, 58%, 74%,
88%, 100%), não uma rampa linear. Uma rampa linear tem derivada constante e o olho
detecta os dois pontos onde ela começa e acaba; a queda escalonada dilui a transição.

**Corolário**: a secção seguinte (a ponte) **não pode ter véu nenhum**.

```css
/* Nada de véu extra aqui. Era ele o culpado do risco: escurecia o fim do hero
   e chegava a zero mesmo na fronteira, o que criava o degrau em vez de o tapar.
   A continuidade vem do .gveil, que é fixo ao ecrã e não conhece fronteiras. */
```

Dois véus a chegar a zero na mesma fronteira somam-se e o degrau fica **pior**, não
melhor. A continuidade global é responsabilidade do `.gveil`, que é `position:fixed` e
por isso não tem fronteiras de secção nenhumas. Um véu global fixo + véus locais que
morrem suavemente. Nunca dois véus locais adjacentes.

### 11.2 O `overflow:hidden` que fatiava o recorte

```css
.hero__figure{
  position:absolute;left:clamp(-40px,4vw,110px);bottom:0;height:86%;z-index:2;
  pointer-events:none;
  /* o recorte acaba a direito no fundo da imagem e o overflow:hidden do hero
     cortava-o em seco à mesma altura do véu, o que reforçava o risco.
     Assim ele dissolve-se em vez de ser fatiado. */
  -webkit-mask-image:linear-gradient(to bottom,#000 0%,#000 72%,rgba(0,0,0,.62) 87%,rgba(0,0,0,0) 100%);
          mask-image:linear-gradient(to bottom,#000 0%,#000 72%,rgba(0,0,0,.62) 87%,rgba(0,0,0,0) 100%);
}
```

O hero tem `overflow:hidden`. A fotografia recortada da pessoa acabava a direito no
fundo — e o corte do overflow acontecia **à mesma altura** onde o véu acabava.
Coincidiam e reforçavam-se: uma linha horizontal dupla.

A solução: a figura leva máscara própria e **dissolve-se antes** de chegar ao ponto de
corte. Deixa de haver aresta nenhuma para o overflow cortar.

Regra geral: **qualquer elemento que encoste ao limite de um container com
`overflow:hidden` precisa de uma máscara de saída própria.** O overflow corta a
direito; a máscara dilui.

### 11.3 Media queries não acrescentam especificidade

Esta é a mais cara de todas.

```css
/* =========================================================
   PONTE E IMÓVEL EM TELEMÓVEL — tem de vir aqui, no fim.
   Escrito lá em cima, dentro do media query do herói, era código morto:
   as regras base de .sb-bridge e .pv-sec vêm depois na folha e, com a mesma
   especificidade, ganhavam. Media queries não acrescentam especificidade.
   ========================================================= */
@media(max-width:820px){
  .sb-bridge{padding:clamp(48px,9vh,76px) var(--pad)}
  .pv-sec{padding-top:clamp(20px,3vh,38px)}
  .sb-house{width:min(240px,54vw);top:calc(50% - 26px)}
}
```

Um `@media` **não** conta para a especificidade. `.sb-bridge{padding:X}` dentro de um
media query e `.sb-bridge{padding:Y}` fora dele têm a mesma especificidade (0,1,0), e
por isso ganha **a que vier por último na folha**.

Numa folha organizada por secções — hero, depois ponte, depois imóvel, depois reels,
depois rodapé — escrever as regras mobile da ponte dentro do bloco `@media` do hero
significa escrevê-las *antes* das regras base da ponte. São código morto silencioso: o
browser não avisa, o inspector mostra-as riscadas e é preciso ir lá ver.

**A regra**: as regras responsivas de uma secção vivem **imediatamente a seguir** às
regras base dessa secção. Quando isso não for possível (porque agrupam várias secções),
vão para o **fim da folha**, com um comentário a explicar porquê. É exactamente o caso
acima.

### 11.4 `transform:none` apaga a centragem

Já apareceu três vezes neste documento e vale a pena isolar. `transform` é uma
propriedade única e indivisível. Qualquer elemento centrado por
`transform:translateX(-50%)` ou `translate(-50%,-50%)`:

- **não pode** usar um keyframe partilhado que acabe em `transform:none`;
- **tem de** repetir o `translate` em todos os keyframes e em todos os estados
  (incluindo o bloco `prefers-reduced-motion`).

Sintoma: o elemento salta metade da própria largura para a direita no fim da animação.

### 11.5 Tirar e pôr uma classe não reinicia a animação

Precisa de `void el.offsetWidth` entre as duas operações (pontos 5.2 e 8.2). Sem o
reflow forçado, o browser junta as mutações e conclui que nada mudou.

### 11.6 Um observer de reveal precisa de `unobserve`; um de estado não

Reveals: `io.unobserve(en.target)` depois de disparar. É uma entrada única.

Observers que gerem estado (pausar vídeo fora do ecrã, por exemplo) **não** podem
fazer `unobserve` — precisam de continuar a ouvir as duas direcções.

### 11.7 Estilos inline ganham a media queries

O `layoutFan()` escreve `transform`, `opacity` e `zIndex` inline. Ao passar para o modo
tira, esses estilos inline continuam lá e ganham a qualquer regra da media query.
`layoutStrip()` existe só para os limpar (`card.style.transform = ''`).

Regra: **se o JS escreve estilos inline num modo, tem de os limpar ao sair desse modo.**

### 11.8 `pan-x` sozinho sequestra o gesto vertical

Ver 8.4. Numa área com scroll horizontal, `touch-action:pan-x pan-y` — os dois eixos,
sempre.

### 11.9 Bloqueio de scroll: contador, não booleano; e compensar a barra

Ver 4.5. Um booleano parte-se assim que duas coisas bloquearem o scroll ao mesmo tempo,
e esquecer o `paddingRight` faz a página inteira saltar 15px em desktop.

### 11.10 Não usar `tel:` em CTAs de navegação

```html
<!-- vai ao anúncio da casa, aqui no site; antes abria o tel: e o Mac atirava para o FaceTime -->
<a href="#imovel" class="btn">Quero comprar</a>
```

Um `href="tel:{{TELEFONE_E164}}"` num botão principal de navegação abre o FaceTime em
macOS e uma caixa de diálogo em desktop — o utilizador queria ver imóveis. O `tel:`
tem lugar nos ícones do rodapé e na ficha de contacto, não num CTA de percurso. Os CTAs
principais apontam para páginas do site ou para `{{WHATSAPP}}`.

### 11.11 `will-change` só onde é preciso

Está no `.rl-card` (seis elementos, animação contínua de `transform`) e mais em lado
nenhum. `will-change` promove a camada permanentemente e consome memória de GPU;
espalhado por dezenas de elementos, degrada exactamente o que devia melhorar. Os
reveals não precisam — animam uma vez e acabam.
