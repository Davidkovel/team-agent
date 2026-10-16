# SECÇÕES E MAPA DE PÁGINAS

Catálogo do género "site de consultor imobiliário". Destilado de dois sites reais
(um consultor solo em HTML vanilla, uma equipa em build compilado). Tudo o que está
aqui funciona sem build e sem npm: HTML + CSS + JS de browser.

Placeholders usados nos snippets: `{{NOME}}`, `{{TELEFONE_E164}}`, `{{WHATSAPP}}`,
`{{INSTAGRAM}}`, `{{AGENCIA}}`, `{{AMI}}`, `{{DOMINIO}}`, `{{CIDADE}}`, `{{ANO}}`.
Nunca metas dados reais nos ficheiros de referência do kit.

---

## 1. MAPA DE PÁGINAS

### 1.1 O núcleo canónico (consultor solo — 8 páginas)

Cada página é um ficheiro HTML autónomo, com o seu CSS e JS **inline**. Não há
partials nem includes: a navbar, o footer e o fundo são copiados de página para
página. É deliberado — o site tem de correr a partir de um `file://`, de um bucket
estático ou de uma pasta no servidor, sem passo de compilação.

| Ficheiro | Função | Existe sempre? |
|---|---|---|
| `index.html` | A porta de entrada. Hero → ponte → prova/imóvel → social → footer. | Sim |
| `sobre.html` | Quem é a pessoa. Card pessoal + texto + indicadores + CTA. | Sim |
| `vender.html` | A página que **converte proprietários**. Herói editorial, 3 passos, formulário de avaliação. | Sim |
| `imovel.html` | Ficha de um imóvel: visualizador + ficha técnica + descrição + CTA de visita. | Sim, se houver ≥1 imóvel |
| `credito.html` | Simulador de prestação de crédito habitação. | Sim (ver `calculators.md`) |
| `mais-valias.html` | Simulador de IRS sobre mais-valias na venda. | Sim |
| `imt.html` | Simulador de IMT + Imposto do Selo na compra. | Sim |
| `privacidade.html` | Política de privacidade. Obrigatória a partir do momento em que existe um formulário. | Sim |

Mais três ficheiros que não são páginas mas fazem parte da entrega:
`robots.txt`, `sitemap.xml`, e um gerador do cartão OG (uma página HTML que se
fotografa a 1200×630 para produzir `og-{{SLUG}}-v1.jpg`).

**Regra de ouro da home:** a home tem UM destino primário (`vender.html`) e UM
secundário (o imóvel em destaque). Tudo o resto — ferramentas, sobre, redes — é
navegação de apoio. Se a home tiver três CTAs de igual peso não tem nenhum.

### 1.2 O que a home faz, secção a secção

```
HERO            — quem és, o que fazes, dois botões. Retrato recortado.
PONTE           — uma frase. Corta o salto entre o hero e o corpo.
[PROVA]         — números/indicadores. Opcional na home; no site solo vive em sobre.html.
IMÓVEL/IMÓVEIS  — o cartão único clicável (solo) ou a grelha (equipa).
CONVITE         — "procura outra coisa?" em painel de vidro.
SOCIAL          — leque de reels do Instagram.
FOOTER          — nome gigante, logo, sociais, nav, barra final.
```

A navbar é fixa e vive **fora** deste fluxo (`position:fixed`), pelo que o hero
leva `padding-top` suficiente para não ficar por baixo dela, e todas as secções
com âncora levam `scroll-margin-top:96px` — senão o link `#imovel` encosta o topo
da secção debaixo da dock.

### 1.3 As extras de EQUIPA

Quando o cliente não é um consultor solo mas uma **equipa** (o segundo site de
referência: 20 pessoas, 17 imóveis em carteira, 6 prémios), o mapa cresce em três
rotas. Cada uma só se justifica com um limiar concreto:

| Extra | Justifica-se quando | Não faças se |
|---|---|---|
| `imoveis.html` (listagem com filtros) | Há **≥ 6 imóveis** em carteira em simultâneo, ou a carteira roda todos os meses. | Há 1–3 imóveis: o cartão único da home resolve, e uma listagem com três cartões parece uma loja vazia. |
| `equipa.html` (grelha de consultores) | Há **≥ 4 pessoas** com foto tratada e função definida. | O "equipa" é o consultor + a assistente. Nesse caso é um parágrafo em `sobre.html`. |
| `premios.html` | Existem distinções **verificáveis e com imagem** (selos de rede, rankings, imprensa). | Só há um selo genérico da agência. Nesse caso é uma linha de prova no footer ou no hero. |

Notas de arquitectura das extras:

- **Listagem com filtros** (`imoveis.html`): os imóveis são um array em JS no topo
  do ficheiro; os filtros são botões que ligam/desligam uma classe de estado
  (ex.: `is-on`) e escondem cartões com `hidden`. Sem router, sem query strings a
  não ser que valha a pena partilhar um filtro por link. Cada cartão liga a uma
  ficha `imovel-{{REF}}.html` gerada a partir do mesmo template. As fotos vivem
  numa pasta por imóvel, nomeadas `{{REF}}-01.webp … -06.webp` — nomes previsíveis
  poupam JSON.
- **Equipa**: grelha de cartões `auto-fill, minmax(min(100%,240px),1fr)`, retrato
  em `aspect-ratio:4/5`, nome + função + contacto directo. Se cada pessoa tiver
  página própria, o cartão é um stretched link (ver §4.3); se não tiver, o
  cartão não é link nenhum — um cartão que parece clicável e não é custa confiança.
- **Prémios**: faixa de selos, não uma grelha de cartões. Imagem + ano + uma linha.
  Prémios em cartões grandes leem-se como auto-elogio; em selos pequenos leem-se
  como currículo.

Regra transversal: uma equipa mantém as três páginas de ferramentas e a de
privacidade exactamente iguais às do solo. O que muda é a autoria no footer.

---

## 2. TÓNICA COMUM A TODAS AS SECÇÕES

Antes das secções, três decisões que atravessam o género inteiro:

**O fundo é fixo e o body é transparente.**
```css
html{background:var(--bg)}
body{
  /* transparente de propósito: o fundo vive no <html>, senão o box do body
     pinta por cima da camada de fundo (z-index negativo) e apaga-a */
  background:transparent;
}
```
As secções também são `background:transparent`. O contraste nasce **sempre** de um
painel local (vidro) ou de um véu em gradiente — nunca de um fundo opaco de secção.
É isto que dá a sensação de uma página só, e não de sete faixas empilhadas.

**Reveal por IntersectionObserver, com a classe de estado escrita por JS.**
O estado inicial (invisível, deslocado) só existe se o JS acrescentar uma classe ao
`<html>` (`pv-js`, `vd-js`, `rl-js`, `ft-js`). Sem JS a página fica visível e
estática. Sem esse guard, um erro de JS deixa metade do site invisível.

**`prefers-reduced-motion` fecha cada bloco.** Todas as secções acabam com um
`@media(prefers-reduced-motion:reduce)` que põe opacidade a 1, `transform:none`,
`transition:none` e `animation:none`. Onde há hover que desloca, o hover deixa de
deslocar. Onde há sublinhado que cresce, o sublinhado aparece já inteiro
(`transform:scaleX(1)`), não desaparece.

---

## 3. HERO COM RETRATO RECORTADO

**O que é.** Ecrã de abertura: retrato da pessoa recortado (PNG/WebP com alpha, sem
fundo de estúdio) à esquerda, conteúdo à direita. Kicker, título em duas linhas com
uma palavra em gradiente, subtítulo, dois botões.

**Quando entra.** Sempre, na home. `vender.html` usa a variante editorial (§10),
sem retrato. As páginas de ferramenta e a ficha de imóvel usam um cabeçalho curto
(`.pg`), que é um hero reduzido a kicker + h1 + lead.

### Markup

```html
<header class="hero" id="top">
  <div class="hero__figure">
    <picture>
      <source type="image/webp"
              srcset="assets/hero-cut@900.webp 900w, assets/hero-cut@1400.webp 1400w"
              sizes="(max-width:820px) 88vw, 55vw">
      <img src="assets/hero-cut.png" width="1400" height="1739"
           alt="{{NOME}}, consultor imobiliário"
           fetchpriority="high" decoding="async" />
    </picture>
  </div>

  <div class="hero__content">
    <p class="kicker">Comprar · Vender · {{CIDADE}}</p>
    <h1 class="reveal-lines">
      <span class="ln"><span>Ajudo proprietários</span></span>
      <span class="ln"><span>a vender <em>melhor.</em></span></span>
    </h1>
    <p class="sub">Do primeiro contacto à escritura. Em {{CIDADE}} e em todo o país.</p>
    <div class="cta">
      <a href="vender.html" class="btn btn--solid">Vender o meu imóvel</a>
      <!-- vai ao anúncio da casa, aqui no site; com tel: o Mac atira para o FaceTime -->
      <a href="#imovel" class="btn">Quero comprar</a>
    </div>
  </div>
</header>
```

### O padrão `<picture>`

`fetchpriority="high"` **só** no retrato do hero — é o LCP da página. Todas as
outras imagens levam `loading="lazy"` e, no caso da foto do imóvel em destaque,
`fetchpriority="low"`, para não competirem com ele.

`width`/`height` intrínsecos são obrigatórios em todas as imagens: sem eles há CLS.
O `srcset` tem duas medidas, não cinco — um consultor não tem pipeline de imagens e
duas medidas cobrem telemóvel e desktop. O `sizes` declara a largura real ocupada
em cada breakpoint (`88vw` no telemóvel porque a figura passa a ocupar quase todo o
ecrã; `55vw` no desktop).

O `<img>` de fallback é o PNG (transparência garantida em qualquer browser); o
WebP entra pela `<source>`.

### Layout desktop

```css
.hero{
  min-height:100svh;
  display:flex;align-items:center;justify-content:flex-end;   /* conteúdo à DIREITA */
  position:relative;padding:140px var(--pad) 60px;overflow:hidden;
}
.hero__figure{
  position:absolute;left:clamp(-40px,4vw,110px);bottom:0;height:86%;z-index:2;
  pointer-events:none;
}
/* o <picture> tem de ser bloco com altura própria, senão o height:100% do <img>
   não tem contra quem resolver e a foto encolhe para o tamanho natural */
.hero__figure picture{display:block;height:100%}
.hero__figure img{height:100%;width:auto;object-fit:contain;
  filter:drop-shadow(0 30px 60px rgba(0,0,0,.55))}
.hero__content{position:relative;z-index:3;max-width:560px}
```

`100svh` e não `100vh`: em telemóvel o `vh` conta a barra do browser que depois
desaparece, e o hero fica alto de mais.

### O véu direccional

Um pseudo-elemento sobre o fundo, por **baixo** da figura (`z-index:1` contra o
`z-index:2` da figura). A foto é recortada e vai por cima sem nada a toldá-la; só
o fundo é acalmado, e mais do lado onde o texto assenta.

```css
.hero::after{
  content:"";position:absolute;inset:0;z-index:1;pointer-events:none;
  background:linear-gradient(100deg, transparent 0%, rgba(10,10,10,.18) 44%,
             rgba(10,10,10,.42) 78%, rgba(10,10,10,.50) 100%);
  /* o véu tem de chegar a ZERO exactamente no fim do hero: se acabar com alguma
     opacidade, o fundo salta de repente à saída da secção e lê-se um risco
     horizontal. A queda é longa e escalonada para não haver degrau. */
  -webkit-mask-image:linear-gradient(to bottom,#000 0%,#000 38%,rgba(0,0,0,.88) 58%,
                     rgba(0,0,0,.58) 74%,rgba(0,0,0,.26) 88%,rgba(0,0,0,0) 100%);
          mask-image:linear-gradient(to bottom,#000 0%,#000 38%,rgba(0,0,0,.88) 58%,
                     rgba(0,0,0,.58) 74%,rgba(0,0,0,.26) 88%,rgba(0,0,0,0) 100%);
}
```

A própria figura leva máscara pela mesma razão: o recorte acaba a direito na base
da imagem e o `overflow:hidden` do hero corta-o em seco à mesma altura do véu, o
que **reforça** o risco. Com máscara, dissolve-se em vez de ser fatiado.

```css
.hero__figure{
  -webkit-mask-image:linear-gradient(to bottom,#000 0%,#000 72%,
                     rgba(0,0,0,.62) 87%,rgba(0,0,0,0) 100%);
          mask-image:linear-gradient(to bottom,#000 0%,#000 72%,
                     rgba(0,0,0,.62) 87%,rgba(0,0,0,0) 100%);
}
```

### A foto passa para TRÁS do texto no telemóvel

Este é o ponto mais afinado do género e o que mais custa a acertar.

```css
@media(max-width:820px){
  /* min-height:auto: com 100svh o conteúdo acabava a meio e sobrava um terço de
     ecrã morto entre os botões e a secção seguinte. A altura passa a ser a do
     conteúdo, e a secção seguinte já espreita — que é o que convida a rolar. */
  .hero{align-items:flex-start;min-height:auto;
        padding-top:164px;padding-bottom:clamp(56px,16vh,150px)}

  .hero__figure{
    /* Ancorado ao TOPO e à DIREITA, com sangramento PEQUENO. Encostado a baixo
       ficava numa faixa morta por baixo dos botões. O top em px acompanha o
       padding-top do hero, por isso a cabeça nasce sempre à altura do kicker,
       independentemente da altura do ecrã (100svh varia com as barras do browser). */
    left:auto;right:-5%;top:96px;bottom:auto;transform:none;
    height:auto;width:min(62%,290px);display:block;
    /* ATRÁS do texto (o .hero__content é z-index:3). A opacidade é contida:
       nem sendo fundo pode deixar de se ler o subtítulo por cima. */
    z-index:2;opacity:.62;
    filter:saturate(.96) drop-shadow(-8px 20px 44px rgba(0,0,0,.7));
    -webkit-mask-image:linear-gradient(to bottom,#000 0%,#000 64%,
                       rgba(0,0,0,.6) 81%,rgba(0,0,0,.18) 93%,rgba(0,0,0,0) 100%);
            mask-image:linear-gradient(to bottom,#000 0%,#000 64%,
                       rgba(0,0,0,.6) 81%,rgba(0,0,0,.18) 93%,rgba(0,0,0,0) 100%);
  }
  .hero__figure picture{height:auto}
  .hero__figure img{width:100%;height:auto}

  .hero__content{max-width:100%}
  .hero .sub{max-width:min(76%,340px)}

  /* os botões ficam lado a lado, em partes iguais: a largura natural deixava-os
     desirmanados. z-index próprio porque a foto desce até à altura deles e tem
     de passar POR TRÁS — é a única sobreposição que não se aceita. */
  .hero .cta{flex-direction:row;align-items:stretch;gap:10px;position:relative;z-index:6}
  .hero .cta .btn{flex:1 1 0;min-width:0;justify-content:center;
    font-size:11px;letter-spacing:.6px;padding:15px 12px}

  /* em ecrã estreito um scrim elíptico deixa uma banda dura onde acaba — troca-se
     por um véu vertical que cobre o hero inteiro, sem aresta visível */
  .hero::after{background:linear-gradient(to bottom, rgba(10,10,10,.84) 0%,
    rgba(10,10,10,.70) 48%, rgba(10,10,10,.34) 80%, transparent 100%)}
}
```

Duas regras de medição que vale a pena repetir em qualquer retrato novo:

1. **Mede o alpha do recorte antes de escolher o `padding-top`.** Descobre em que
   percentagem da caixa está a cabeça (largura e altura). Empurra o conteúdo até
   o título começar já abaixo do queixo — texto claro sobre a gola escura do fato
   lê-se; sobre a cara, não.
2. **Ancora à direita com sangramento pequeno.** Centrar a figura e dar-lhe 79% de
   largura deixa o ombro decepado pela margem. Mais vale um pouco menos de altura
   do que um recorte cortado a meio.

### Entrada

Duas linhas do h1 sobem de dentro de um `overflow:hidden`; o resto faz fade-up com
atraso escalonado.

```css
.reveal-lines .ln{display:block;overflow:hidden;padding-bottom:.06em}
.reveal-lines .ln>span{display:block;transform:translateY(118%);
  animation:lineUp 1.05s var(--ease) forwards}
.reveal-lines .ln:nth-child(1)>span{animation-delay:.12s}
.reveal-lines .ln:nth-child(2)>span{animation-delay:.27s}
@keyframes lineUp{to{transform:translateY(0)}}

.hero .kicker,.hero .sub,.hero .cta{opacity:0;animation:fadeUp .9s var(--ease) forwards}
.hero .kicker{animation-delay:.05s}
.hero .sub{animation-delay:.46s}
.hero .cta{animation-delay:.6s}
```

O `padding-bottom:.06em` na linha existe para as descidas (g, p, ç) não serem
cortadas pelo `overflow:hidden`.

---

## 4. PONTE

**O que é.** Uma frase só, grande, centrada, com um desenho SVG animado por trás e
um halo radial atrás dele. Não tem CTA, não tem lista, não tem imagem de conteúdo.

**Para que serve.** Cortar o salto entre o hero e o resto. Sem ela, o olho passa
de um ecrã cheio de movimento directamente para uma grelha de informação, e a
transição lê-se como duas páginas coladas. A ponte é ar com uma ideia dentro.

**Quando entra.** Na home, imediatamente a seguir ao hero. Uma vez por página, nunca
duas.

```html
<section class="sb-bridge">
  <svg class="sb-house" viewBox="0 0 200 150" aria-hidden="true" focusable="false">
    <g class="sb-house__luz">   <!-- janelas e porta, acendem depois -->
      <path style="--d:0s"   d="M54 86 H80 V110 H54 Z"/>
      <path style="--d:.18s" d="M120 86 H146 V110 H120 Z"/>
      <path style="--d:.36s" d="M86 140 V98 H114 V140 Z"/>
    </g>
    <g class="sb-house__linhas">   <!-- contorno, desenha-se a traço -->
      <path style="--d:0s"   d="M18 72 L100 10 L182 72"/>
      <path style="--d:.5s"  d="M34 62 V140 H166 V62"/>
      <!-- … -->
    </g>
    <circle class="sb-house__ponta" r="2.4"/>   <!-- a ponta da caneta -->
  </svg>
  <p class="sb-bridge__line">Cada imóvel tem uma história e um valor justo.</p>
</section>
```

```css
.sb-bridge{position:relative;
  padding:clamp(64px,10vh,120px) var(--pad) clamp(52px,8vh,96px);
  display:flex;justify-content:center;text-align:center}
/* Nada de véu extra aqui. Era ele o culpado do risco entre o hero e o corpo:
   escurecia o fim do hero e chegava a zero mesmo na fronteira, o que criava o
   degrau em vez de o tapar. A continuidade vem do véu global, que é fixo ao
   ecrã e não conhece fronteiras de secção. */

.sb-bridge__line{position:relative;z-index:1;max-width:22ch;
  font-family:var(--display);font-weight:500;letter-spacing:-.02em;line-height:1.18;
  font-size:clamp(23px,3.4vw,42px);color:var(--ink);
  opacity:0;transform:translateY(18px);
  transition:opacity 1s var(--ease),transform 1s var(--ease)}
.sb-bridge__line.is-in{opacity:1;transform:none}

/* halo por trás, para o fundo não ficar chapado */
.sb-bridge::after{
  content:"";position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
  width:min(620px,118vw);height:min(400px,78vw);z-index:0;pointer-events:none;
  background:radial-gradient(ellipse at center,
    rgba(77,141,246,.2) 0%, rgba(77,141,246,0) 68%);
}
```

O desenho tem três tempos, como uma composição de motion: (1) os traços correm com
um ponto de luz à frente da caneta; (2) as janelas acendem depois de o contorno
fechar — é o momento em que deixa de ser um desenho e passa a ser uma casa
habitada; (3) tudo respira devagar, apaga e recomeça. Ciclo de 12s.

O comprimento de cada traço é medido em JS, senão o `stroke-dasharray` teria de
ser adivinhado e o desenho sai a meio:

```js
document.querySelectorAll('.sb-house__linhas path').forEach(function(p){
  try{ p.style.setProperty('--len', Math.ceil(p.getTotalLength()) + 'px'); }catch(e){}
});
```

A ponta da caneta usa `offset-path`, e só existe onde é suportado — sem o guard
`@supports` o círculo cai no canto 0,0 e fica um pingo parado:

```css
.sb-house__ponta{display:none}
@supports (offset-path: path('M0 0 L1 1')){
  .sb-house__ponta{display:block;offset-path:path('M18 72 L100 10 L182 72');
    offset-distance:0%;animation:sbPonta 12s var(--ease) infinite}
}
```

Reduced motion: o desenho fica **completo e parado** (`stroke-dashoffset:0`), as
luzes ficam acesas a opacidade baixa, a ponta desaparece.

Responsivo: no telemóvel a casa encolhe e sobe. Centrada na secção, a base ficava
cortada pela dobra do ecrã. `top:calc(50% - 26px)` corrige sem tocar em
espaçamentos — é `position:absolute` e `pointer-events:none`.

**Armadilha de ordem de cascata:** as regras de telemóvel da ponte e da secção
seguinte têm de estar **no fim da folha**. Escritas no meio, dentro do media query
do hero, são código morto: as regras base vêm depois na folha e, com a mesma
especificidade, ganham. Media queries não acrescentam especificidade.

---

## 5. IMÓVEL EM DESTAQUE — CARTÃO ÚNICO CLICÁVEL

**O que é.** Um só imóvel, apresentado como uma ficha: foto grande à esquerda,
caixa de informação de vidro à direita, montada por cima da foto com margem
negativa. O conjunto inteiro é um link.

**Quando entra.** Na home de um consultor solo com 1 a 3 imóveis em carteira. Com
6+ imóveis troca-se pela listagem com filtros (§1.3) e a home fica com um bloco de
3 destaques.

### Markup

```html
<section class="pv-sec" id="imovel" aria-labelledby="pv-title">
  <div class="pv-wrap">

    <header class="pv-head pv-reveal">
      <p class="kicker pv-kicker">Imóvel em carteira</p>
      <h2 class="pv-title" id="pv-title">O apartamento que tenho para vender agora.</h2>
      <p class="pv-lead">Abra a ficha para o ver por dentro, divisão a divisão.</p>
    </header>

    <article class="pv-card pv-reveal pv-reveal--d1">

      <div class="pv-media">
        <picture>
          <source type="image/webp"
                  srcset="assets/imovel/sala@800.webp 800w, assets/imovel/sala@1600.webp 1600w"
                  sizes="(max-width:880px) 92vw, (max-width:1300px) 50vw, 640px">
          <img src="assets/imovel/sala.jpg" width="800" height="533"
               alt="Sala comum do apartamento"
               loading="lazy" decoding="async" fetchpriority="low" />
        </picture>
        <!-- a foto também abre o anúncio: o stretched link do título fica preso
             ao stacking context da caixa de informação e não a alcança -->
        <a class="pv-cover" href="imovel.html" aria-hidden="true" tabindex="-1"></a>
        <p class="pv-shots">
          <svg viewBox="0 0 24 24" aria-hidden="true"><!-- máquina fotográfica --></svg>
          <span>17 fotografias</span>
        </p>
      </div>

      <div class="pv-body">
        <p class="pv-place">{{ZONA}} · {{CIDADE}}</p>
        <h3 class="pv-name"><a class="pv-go" href="imovel.html">Apartamento T2 com terraço e garagem</a></h3>
        <p class="pv-price">000 000 €</p>

        <ul class="pv-specs">
          <li><b>00 m²</b><span>Área bruta privativa</span></li>
          <li><b>0</b><span>Quartos</span></li>
          <li><b>0</b><span>Casas de banho</span></li>
          <li><b>—</b><span>Certificado</span></li>
        </ul>

        <p class="pv-extras">Garagem fechada · Terraço privativo · Prédio com elevador</p>
        <p class="pv-note">Ref. {{REF}} · nota de rodapé, se houver algo por confirmar.</p>

        <p class="pv-more" aria-hidden="true">
          <span>Ver o imóvel e as 17 fotografias</span>
          <svg viewBox="0 0 24 24"><!-- seta --></svg>
        </p>
      </div>

    </article>
  </div>
</section>
```

### O layout da sobreposição

A caixa **não vive dentro** da foto: encosta-lhe e monta-lhe por cima ~90px, para
o olho ler as duas peças como uma só ficha, sem tapar a imagem.

```css
.pv-card{position:relative;isolation:isolate;display:flex;align-items:stretch;
  border:0;padding:0;background:none;transition:transform .5s var(--ease)}

/* a foto estica à altura da linha e a caixa recolhe-se com margem própria:
   assim a foto fica sempre mais alta e vêem-se os cantos dela a assomar por
   cima e por baixo. Auto-ajusta-se ao texto, em qualquer idioma. */
.pv-media{
  position:relative;overflow:hidden;border-radius:28px;
  width:min(54%,600px);flex:none;align-self:stretch;
  min-height:clamp(300px,26vw,380px);
  border:1px solid rgba(255,255,255,.12);
  box-shadow:0 34px 84px rgba(0,0,0,.50);
}
.pv-media picture{display:block;width:100%;height:100%;line-height:0}
.pv-media img{width:100%;height:100%;object-fit:cover;
  transition:transform .8s var(--ease)}
.pv-card:hover .pv-media img{transform:scale(1.045)}

.pv-body{
  position:relative;z-index:3;flex:1;min-width:0;align-self:center;
  margin-left:clamp(-104px,-6vw,-56px);      /* a sobreposição */
  margin-block:clamp(16px,2vw,24px);         /* o recuo que deixa a foto assomar */
  padding:clamp(26px,3vw,42px) clamp(24px,2.6vw,38px);
  border:1px solid var(--line);border-radius:28px;
  background:linear-gradient(118deg, rgba(24,34,56,.62) 0%,
             rgba(9,12,20,.86) 58%, rgba(7,9,15,.92) 100%);
  -webkit-backdrop-filter:blur(20px) saturate(118%);
          backdrop-filter:blur(20px) saturate(118%);
  box-shadow:0 40px 96px rgba(0,0,0,.58), inset 0 1px 0 rgba(255,255,255,.10);
  transition:transform .5s var(--ease),border-color .4s,box-shadow .5s;
}
.pv-card:hover .pv-body{transform:translateY(-5px);border-color:rgba(157,194,255,.42)}
```

### A pílula "N fotografias"

Vive **em cima** e não em baixo, porque é por baixo que a caixa de informação monta
sobre a foto e a taparia. Assenta sobre um véu superior que a torna legível sem
escurecer a imagem toda:

```css
.pv-media::after{
  content:"";position:absolute;inset:0;z-index:1;pointer-events:none;
  background:linear-gradient(to bottom, rgba(5,7,12,.70) 0%,
             rgba(5,7,12,.12) 36%, rgba(5,7,12,0) 62%);
}
.pv-shots{
  position:absolute;left:14px;top:13px;z-index:4;margin:0;
  display:inline-flex;align-items:center;gap:9px;
  padding:8px 14px;border-radius:999px;
  font-size:11px;font-weight:600;letter-spacing:1.6px;text-transform:uppercase;
  background:rgba(8,12,20,.62);border:1px solid rgba(255,255,255,.20);
  -webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);
}
```

Se a variante do projecto puser a pílula em baixo (é aceitável quando a caixa monta
pela lateral e não pela base), inverte o véu para `to top` e move a pílula para
`bottom:13px`.

### Stretched link + link de cobertura

O padrão canónico: **um** link semântico no título, esticado com `::after` sobre o
cartão inteiro.

```css
.pv-go::after{content:"";position:absolute;inset:0;z-index:6;border-radius:28px}
.pv-go:focus-visible{outline:none}
.pv-go:focus-visible::after{outline:2px solid var(--accent-2);outline-offset:6px}
```

O `::after` resolve contra o antepassado posicionado mais próximo. Como
`.pv-body` é `position:relative;z-index:3`, ele cria um **stacking context** e o
`::after` fica preso lá dentro: nunca chega à foto, por mais alto que seja o
`z-index`. Daí o segundo link, de cobertura, dentro da própria foto:

```html
<a class="pv-cover" href="imovel.html" aria-hidden="true" tabindex="-1"></a>
```
```css
.pv-cover{position:absolute;inset:0;z-index:3;display:block}
```

`aria-hidden="true"` + `tabindex="-1"`: para o leitor de ecrã e para o teclado
continua a existir **um só** link — o do título. O de cobertura é exclusivamente
para o rato e para o dedo.

O foco visível vive no `::after` (`outline-offset:6px`), não no texto: assim o anel
de foco desenha o cartão inteiro, que é o que o link realmente é.

### Guard de selecção de texto

Um stretched link transforma toda a caixa em zona de clique — incluindo enquanto se
arrasta para seleccionar o preço ou a referência. Sem guard, largar o rato navega.

```js
var card = sec.querySelector('.pv-card');
var go   = sec.querySelector('.pv-go');
if(card && go){
  go.addEventListener('click', function(e){
    var sel = window.getSelection && window.getSelection();
    if(!sel || sel.isCollapsed) return;
    var node = sel.anchorNode;
    if(String(sel).length > 6 &&
       node && card.contains(node.nodeType === 1 ? node : node.parentNode)){
      e.preventDefault();
    }
  });
}
```

Os três testes fazem parte da decisão: selecção **não colapsada**, com **mais de 6
caracteres** (um clique acidental arrasta 1–2 letras e não deve bloquear a
navegação), e **dentro do cartão** (uma selecção noutro sítio da página não tem
nada que ver com isto).

### A grelha de 4 cápsulas

Sem linha de separação e **sem barras de acento**: cada número vive numa cápsula
própria.

```css
.pv-specs{list-style:none;display:grid;
  grid-template-columns:repeat(4,minmax(0,1fr));
  gap:clamp(8px,1vw,12px);margin:0 0 clamp(16px,1.8vw,20px);padding:0}
.pv-specs li{display:flex;flex-direction:column;gap:4px;min-width:0;
  padding:clamp(11px,1.2vw,14px) clamp(10px,1.1vw,14px);
  border-radius:15px;background:rgba(255,255,255,.045)}
.pv-specs b{font-family:var(--display);font-weight:600;font-size:16px}
.pv-specs span{font-size:10.5px;line-height:1.35;letter-spacing:1.2px;
  text-transform:uppercase;color:var(--faint)}
```

`minmax(0,1fr)` e `min-width:0` em todas as células: sem isso um rótulo longo
("Área bruta privativa") empurra a coluna e desalinha a grelha.

### Responsivo

```css
@media(max-width:1024px){
  .pv-media{width:min(50%,520px)}
  .pv-body{margin-left:-48px;padding:clamp(22px,3vw,30px)}
}
/* em coluna: a caixa passa a montar por CIMA da foto, pela base */
@media(max-width:880px){
  .pv-card{flex-direction:column;align-items:stretch}
  .pv-media{width:100%;aspect-ratio:16/11;min-height:0;border-radius:24px}
  .pv-body{margin-left:0;margin-top:-46px;margin-bottom:0;width:92%;align-self:center;
    border-radius:24px;
    /* o blur sai e o fundo fica mais opaco: backdrop-filter em ecrãs pequenos
       custa caro e o texto sobre o fundo animado precisa de mais contraste */
    -webkit-backdrop-filter:none;backdrop-filter:none;
    background:linear-gradient(118deg, rgba(24,34,56,.80) 0%,
               rgba(9,12,20,.93) 58%, rgba(7,9,15,.96) 100%)}
}
@media(max-width:560px){
  .pv-body{width:96%;margin-top:-34px;border-radius:20px;padding:22px 20px}
  .pv-go::after{border-radius:22px}     /* acompanha o raio da caixa */
  .pv-specs{grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}
}
```

A regra da sobreposição em coluna: a margem negativa **encolhe** com o ecrã
(−46px → −34px). Um valor fixo faz a caixa comer metade da foto num ecrã de 360px.

---

## 6. CONVITE DE SEGUNDO NÍVEL

**O que é.** Um painel de vidro largo, imediatamente abaixo do cartão do imóvel:
título curto + parágrafo + um botão. Texto à esquerda, botão à direita.

**Para que serve.** Recuperar o visitante que abriu a home à procura de comprar e
não se reviu no único imóvel que lá está. Sem esta peça, um consultor com um imóvel
em carteira perde todos os compradores de todas as outras tipologias.

**Quando entra.** Sempre que a oferta visível seja pequena — cartão único, ou uma
listagem curta. Com uma carteira grande e filtros, não faz sentido: quem procura
tem por onde procurar.

```html
<aside class="pv-ask pv-reveal pv-reveal--d2">
  <div class="pv-ask__txt">
    <p class="pv-ask__t">Procura outra coisa?</p>
    <p class="pv-ask__p">Este é o imóvel que tenho em carteira neste momento. Se o
      que procura é diferente — outra tipologia, outra zona, outro orçamento —
      diga-me o que tem em mente e procuro por si.</p>
  </div>
  <a class="btn pv-ask__btn" href="https://wa.me/{{WHATSAPP}}"
     target="_blank" rel="noopener">Diga-me o que procura</a>
</aside>
```

```css
.pv-ask{
  margin-top:clamp(16px,2.2vw,26px);
  display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;
  gap:clamp(16px,2.4vw,34px);
  padding:clamp(18px,2.2vw,26px) clamp(20px,2.6vw,30px);
  border:1px solid var(--line);border-radius:20px;
  background:linear-gradient(100deg, rgba(20,29,48,.28) 0%, rgba(8,11,18,.52) 100%);
  -webkit-backdrop-filter:blur(12px) saturate(112%);
          backdrop-filter:blur(12px) saturate(112%);
}
.pv-ask__txt{min-width:0;max-width:62ch}
.pv-ask__btn{flex:none}
@media(max-width:560px){
  .pv-ask{flex-direction:column;align-items:flex-start;border-radius:18px}
  .pv-ask__btn{width:100%;justify-content:center}
}
```

O convite é **deliberadamente mais fraco** que o cartão: menos blur, menos opacidade,
raio menor, botão fantasma em vez de sólido. É uma segunda opção e tem de se ler
como tal.

---

## 7. FICHA DE IMÓVEL (`imovel.html`)

**O que é.** A página do anúncio. Duas colunas: visualizador de fotografias à
esquerda (sticky), ficha e descrição à direita. Lightbox por cima.

**Quando entra.** Uma por imóvel. Numa carteira grande, gera-se a partir de um
template com `{{REF}}`.

### Estrutura

```html
<main id="pg-top">
  <section class="pg-show" aria-labelledby="pg-title">
    <div class="pg-wrap">
      <a class="pg-back" href="index.html#top">← Voltar à página inicial</a>

      <div class="pg-split">

        <div class="pg-viewer pg-rev">
          <div class="pg-stage" id="pg-stage">
            <picture id="pg-pic">
              <source id="pg-src" type="image/webp"
                      srcset="…@800.webp 800w, …@1600.webp 1600w"
                      sizes="(max-width:1000px) 92vw, 54vw">
              <img id="pg-img" src="…jpg" width="800" height="533" alt="…"
                   fetchpriority="high" decoding="async" />
            </picture>
            <button type="button" class="pg-open" id="pg-open" aria-label="Ver em ecrã inteiro"></button>
            <button type="button" class="pg-zoom" id="pg-zoom">Ecrã inteiro</button>
            <p class="pg-count"><span id="pg-num">01</span> / 17</p>
            <button type="button" class="pg-nav pg-nav--prev" id="pg-prev" aria-label="Fotografia anterior">…</button>
            <button type="button" class="pg-nav pg-nav--next" id="pg-next" aria-label="Fotografia seguinte">…</button>
            <p class="pg-capnow" id="pg-capnow">Sala</p>
          </div>
          <div class="pg-thumbs" id="pg-thumbs" role="tablist" aria-label="Fotografias do imóvel"></div>
        </div>

        <div class="pg-info pg-rev" style="--pg-d:.1s">
          <p class="kicker pg-kicker">Imóvel à venda · {{CIDADE}}</p>
          <h1 class="pg-title" id="pg-title">…</h1>
          <p class="pg-loc">…</p>
          <div class="pg-pricerow">
            <span><span class="pg-pricelab">Preço pedido</span><br><span class="pg-price">000 000 €</span></span>
            <span class="pg-ref">Ref. {{REF}}</span>
          </div>
          <div class="pg-actions">
            <a class="btn btn--solid" href="https://wa.me/{{WHATSAPP}}" target="_blank" rel="noopener">Marcar visita</a>
            <a class="btn" href="tel:{{TELEFONE_E164}}">{{TELEFONE}}</a>
          </div>
          <div class="pg-panel">
            <p class="pg-panel__t">Ficha do imóvel</p>
            <dl class="pg-facts">
              <div><dt>Tipologia</dt><dd>…</dd></div>
              <!-- … -->
            </dl>
          </div>
          <div class="pg-infoblock">
            <h2 class="pg-h2">Descrição</h2>
            <p class="pg-p">…</p>
            <ul class="pg-chips"><li>Terraço privativo</li><!-- … --></ul>
          </div>
        </div>

      </div>
    </div>
  </section>

  <section class="pg-cta">…</section>
</main>

<!-- VISUALIZADOR — fica escondido até haver clique numa foto -->
<div class="pg-lb" id="pg-lb" hidden> … </div>
```

### Layout

```css
.pg-split{display:grid;
  grid-template-columns:minmax(0,1.06fr) minmax(0,.94fr);
  gap:clamp(24px,3.4vw,54px);align-items:start;margin-top:clamp(16px,2.2vw,28px)}

/* a foto acompanha a leitura da ficha em vez de fugir para cima */
.pg-viewer{position:sticky;top:96px}

.pg-stage{position:relative;overflow:hidden;border-radius:24px;aspect-ratio:3/2;
  border:1px solid rgba(255,255,255,.13);background:#080b12;
  box-shadow:0 34px 84px rgba(0,0,0,.5)}
.pg-stage picture{position:absolute;inset:0;display:block}
.pg-stage img{width:100%;height:100%;object-fit:cover;
  transition:opacity .3s var(--ease)}
.pg-stage.is-swap img{opacity:0}     /* troca com fade, não com salto */

/* véus em cima e em baixo: assentam as setas, o contador e a legenda */
.pg-stage::after{content:"";position:absolute;inset:0;pointer-events:none;z-index:1;
  background:linear-gradient(to top,rgba(4,6,11,.74) 0%,rgba(4,6,11,.08) 32%,rgba(4,6,11,0) 54%),
             linear-gradient(to bottom,rgba(4,6,11,.42) 0%,rgba(4,6,11,0) 22%)}

/* botão invisível a cobrir o palco: clicar na foto abre o lightbox */
.pg-open{position:absolute;inset:0;z-index:2;border:0;padding:0;
  background:none;cursor:zoom-in}

.pg-thumbs{display:flex;gap:8px;margin-top:11px;overflow-x:auto;padding:2px 0 5px;
  scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.18) transparent}
.pg-thumb{flex:none;width:74px;aspect-ratio:3/2;padding:0;cursor:pointer;
  border-radius:10px;overflow:hidden;border:1px solid rgba(255,255,255,.12);
  opacity:.48;transition:opacity .3s var(--ease),border-color .3s,transform .3s}
.pg-thumb:hover{opacity:.85}
.pg-thumb.is-on{opacity:1;border-color:var(--accent-2);transform:translateY(-2px)}
```

Se o painel da ficha for `sticky` em vez do visualizador, o `sticky` vive **no item
da grelha** (a coluna tem a altura da linha), nunca no painel: dentro do
`<aside>` ele não teria espaço para deslizar.

As miniaturas são geradas em JS a partir do array de fotos, com `role="tablist"` /
`aria-selected` — o visualizador é semanticamente um conjunto de separadores.

### Lightbox

- Vive **fora** do `<main>`, no fim do `<body>`, com `hidden` até ser aberto.
- `role="dialog" aria-modal="true" tabindex="-1"`; abre com foco no painel e
  devolve o foco ao elemento que o abriu ao fechar.
- Fecha com `Esc`, com clique no scrim e no botão de fechar.
- Setas do teclado ← → mudam de foto; a mesma função serve o visualizador e o
  lightbox, para o índice nunca divergir entre os dois.
- Bloqueia o scroll do documento enquanto está aberto, com contador de bloqueios
  partilhado com o menu mobile (senão fechar um deles desbloqueia com o outro
  ainda aberto):

```js
window.__scrollLocks = 0;
window.__lockScroll = function(on){
  var d = document.documentElement;
  if(on){
    if(!window.__scrollLocks++){
      var g = window.innerWidth - d.clientWidth;   /* largura da scrollbar */
      d.style.overflow='hidden';
      if(g>0) d.style.paddingRight = g+'px';       /* evita o salto do layout */
    }
  } else if(window.__scrollLocks > 0 && !--window.__scrollLocks){
    d.style.overflow=''; d.style.paddingRight='';
  }
};
```

### Honestidade da ficha

Quando um dado do anúncio está em contradição consigo próprio (áreas, ano, piso),
**declara-se, não se esconde**. O valor duvidoso fica assinalado na ficha, e uma
caixa explica a contradição e diz como vai ser resolvida:

```css
.pg-facts dd.pg-todo{color:var(--accent-2);font-weight:500;
  border-bottom:1px dashed rgba(157,194,255,.55);padding-bottom:1px}
.pg-flag{margin-top:18px;padding:14px 16px;border-radius:14px;
  background:rgba(77,141,246,.12);border:1px solid rgba(157,194,255,.28);
  border-left:2px solid var(--accent-2)}
```

Isto não é um detalhe visual — é a peça que separa este género de um portal de
anúncios. Um consultor que assinala o que ainda não confirmou ganha a conversa.

---

## 8. LEQUE DE REELS / SOCIAL

**O que é.** Seis cartões verticais 9:16 dispostos em leque no desktop (rodados,
sobrepostos, o do centro à frente); no telemóvel, uma tira horizontal que se
arrasta com snap. Cada cartão tem poster + vídeo; só o do centro toca.

**Quando entra.** Quando o cliente publica com regularidade. Sem conteúdo recente,
a secção denuncia o abandono — nesse caso, corta-se.

### Estrutura

```html
<section class="rl" id="redes" aria-labelledby="rl-t">
  <div class="rl__wrap">
    <header class="rl__head rl-rev">
      <p class="kicker rl__kicker">Instagram</p>
      <h2 class="rl__t" id="rl-t">Acompanhe o dia a dia.</h2>
      <p class="rl__p">O mercado de {{CIDADE}}, visitas, negócios fechados.</p>
    </header>

    <div class="rl__stage rl-rev" id="rl-stage" role="group" aria-label="Reels"></div>

    <div class="rl__nav rl-rev">
      <button type="button" class="rl__arrow" id="rl-prev" aria-label="Anterior">…</button>
      <div class="rl__dots" id="rl-dots"></div>
      <button type="button" class="rl__arrow" id="rl-next" aria-label="Seguinte">…</button>
    </div>

    <div class="rl__cta rl-rev">
      <a class="btn" href="https://instagram.com/{{INSTAGRAM}}" target="_blank" rel="noopener">
        Seguir @{{INSTAGRAM}}</a>
    </div>
  </div>
</section>
```

Os cartões são criados em JS (`<a>` com `<img>` poster + `<video muted loop
playsinline preload="none">` + selo). `preload="none"` é obrigatório: seis vídeos a
carregar custam megabytes e bateria a troco de nada.

### O leque (desktop)

O activo está **sempre** no meio, direito e à frente; os outros distribuem-se à
volta pela distância relativa. Tabelas por `|rel|`, em vez de fórmula contínua —
o afastamento tem de crescer menos que linearmente para o extremo não fugir do
palco:

```js
var STEP = 0.55;                    // passo entre slots, em larguras de cartão
var XS  = [0, 1, 1.85, 2.45];       // afastamento horizontal
var ROT = [0, 10, 19, 26];          // rotação em graus
var SC  = [1.06, .9, .78, .68];     // escala
var DY  = [-.03, .02, .075, .13];   // descida, em alturas de cartão
var OP  = [1, .92, .6, .2];         // opacidade

function relOf(i){ return ((((i - active + H) % N) + N) % N) - H; }
```

Com seis cartões para uma volta inteira há uma emenda: o slot mais afastado é onde
o cartão salta de um extremo ao outro, e por isso é o mais apagado. Quando um
cartão dá a volta, reposiciona-se **invisível** e só depois acende — senão vê-se
atravessar o palco todo:

```js
var wrapped = prevRel[i] !== null && Math.abs(rel - prevRel[i]) > H;
if(wrapped && !reduce){
  card.style.transition = 'none';
  card.style.opacity = '0';
  card.style.transform = tf;
  void card.offsetWidth;               // obriga o salto a ser aplicado já
  card.style.transition = '';
  requestAnimationFrame(function(){ card.style.opacity = op; });
}
```

Nota de curadoria: a qualidade das capas cai **do meio para fora**, não da esquerda
para a direita. A melhor capa fica ao centro, ladeada pela 2.ª e 3.ª, e as piores
nas pontas. Assim abre já com o melhor à frente e há vídeo dos dois lados dele —
que é o que dá a entender que se pode ir para ambos os lados.

### A tira (telemóvel, ≤760px)

Rodado e sobreposto, o leque sai cortado pelas margens num ecrã estreito. Os
cartões voltam ao fluxo, lado a lado, e o dedo é que manda.

```css
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
       conseguia rolar a página para baixo, só para o lado. Declarar os dois
       eixos deixa o browser decidir pela direcção do gesto — horizontal vai
       para a tira, vertical passa para a página. */
    touch-action:pan-x pan-y;
    scrollbar-width:none;-ms-overflow-style:none;
    /* a tira sangra até às margens do ecrã, mas o scroll fica preso a ela: a
       página não ganha deslocamento lateral. width:auto é preciso para as
       margens negativas esticarem em vez de só empurrarem */
    width:auto;margin-inline:calc(var(--pad) * -1);
    /* as folgas laterais valem meio ecrã menos meio cartão: é o que permite ao
       primeiro e ao último assentarem no centro como todos os outros. Em vw
       porque a tira ocupa o ecrã todo, e % contaria a partir do pai.
       A folga vertical existe para o cartão em destaque poder crescer 7% sem
       ser cortado pelo overflow-y:hidden — o clip é na caixa de padding. */
    padding:20px calc(50vw - var(--rl-w) / 2) 26px;
  }
  .rl__stage::-webkit-scrollbar{display:none}
  .rl-card{
    position:static;display:inline-block;vertical-align:top;
    width:var(--rl-w);margin-right:12px;   /* GAP_TIRA em JS: manter os dois iguais */
    transform:none;opacity:1;
    scroll-snap-align:center;              /* o que encaixa é o que o JS diz activo */
  }
  .rl-card.is-center{transform:scale(1.07);box-shadow:0 22px 48px rgba(0,0,0,.62)}
  .rl-card:not(.is-center){opacity:.78}
  .rl-card__tag{opacity:1}   /* na tira não há cartão "à frente": o selo acende em todos */
}
```

O JS distingue os dois modos com o **mesmo** breakpoint do CSS
(`matchMedia('(max-width:760px)')`) e, na tira, limpa tudo o que escreveu no leque
— senão os transforms inline desfazem o alinhamento do fluxo. O activo, na tira, é
o cartão mais perto do centro do scroll, calculado com throttle por `rAF`.

O carregamento é o mais avaro possível: só um `<video>` recebe `src` de cada vez, e
um segundo IntersectionObserver pausa tudo quando a secção sai do ecrã.

---

## 9. PROVA — INDICADORES

**O que é.** Três (ou quatro) pares valor + rótulo. Não são estatísticas
inventadas: são factos verificáveis — a rede, a cobertura geográfica, o tempo de
resposta, os anos de actividade.

**Quando entra.** Uma vez por site. No site solo vive dentro do bloco `sobre`,
imediatamente abaixo dos parágrafos e acima dos CTAs — nunca também no hero. Ter
os mesmos três números no hero e no sobre é repetir-se em duas secções seguidas e
esvazia ambas. Numa equipa, pode subir para a home, junto dos prémios.

```html
<div class="sb__proof sb__i">
  <div><b>{{AGENCIA}}</b><span>Rede &amp; retaguarda</span></div>
  <div><b>{{CIDADE}}</b><span>&amp; todo o país</span></div>
  <div><b>No próprio dia</b><span>Resposta pessoal</span></div>
</div>
```

```css
.sb__proof{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));
  gap:clamp(8px,1vw,12px);margin:clamp(22px,3vw,30px) 0 0}
.sb__proof div{display:flex;flex-direction:column;gap:4px;min-width:0;
  padding:clamp(12px,1.3vw,16px) clamp(11px,1.2vw,16px);
  border:1px solid var(--line);border-radius:16px;background:rgba(255,255,255,.045)}
.sb__proof b{font-family:var(--display);font-weight:600;font-size:15px}
.sb__proof span{font-size:10.5px;line-height:1.35;letter-spacing:1.4px;
  text-transform:uppercase;color:var(--faint)}
```

**REGRA: sem barras de acento ao lado dos números.** Nem `border-left` colorido,
nem traço vertical, nem divisor entre células. Cada indicador é uma cápsula
fechada, com fundo próprio e a mesma moldura dos outros. As barras de acento
transformam três factos numa infografia de apresentação de vendas, e o género
inteiro vive de não parecer uma apresentação de vendas.

Responsivo — a decisão que evita o buraco:

```css
/* No telemóvel a grelha de 2 colunas deixava o terceiro indicador sozinho com um
   buraco ao lado, e três colunas não cabem sem partir o nome da agência ao meio.
   Passa a uma coluna e cada indicador vira uma LINHA (valor à esquerda, legenda à
   direita): a informação lê-se como uma ficha, sem espaços mortos. */
@media(max-width:560px){
  .sb__proof{grid-template-columns:1fr}
  .sb__proof div{flex-direction:row;align-items:baseline;justify-content:space-between;gap:14px}
  .sb__proof span{text-align:right}
}
```

---

## 10. CARD PESSOAL (`sobre.html`)

**O que é.** Duas colunas: à esquerda um card de vidro que contém **só a foto**; à
direita o texto, solto na página, sem caixa nenhuma.

**A decisão.** O card é uma moldura, não um contentor de conteúdo. Meter o texto
lá dentro faz o bloco parecer um cartão de visita gigante e obriga a limitar a
medida de leitura à largura do card. Fora dele, o texto respira e o card é o que
deve ser: uma fotografia emoldurada.

```html
<header class="pg" id="top">
  <p class="kicker">Sobre mim</p>
  <h1 class="pg__title">{{NOME}}</h1>
  <p class="pg__lead">Cada imóvel tem uma história e um valor justo.</p>
</header>

<section class="sb" id="sobre" aria-labelledby="sb-role">
  <div class="sb__wrap">

    <figure class="sb__card" id="sb-card">
      <span class="sb__sheen" aria-hidden="true"></span>
      <picture>
        <source type="image/webp" srcset="assets/retrato@640.webp 640w, assets/retrato@900.webp 900w"
                sizes="(max-width:900px) 78vw, 34vw">
        <img src="assets/retrato.jpg" width="640" height="800" loading="lazy" decoding="async"
             alt="Retrato de {{NOME}}, consultor imobiliário" />
      </picture>
    </figure>

    <div class="sb__text" id="sb-text">
      <p class="sb__role sb__i" id="sb-role">Consultor Imobiliário na {{AGENCIA}}, em {{CIDADE}}</p>
      <p class="sb__p sb__i">…</p>
      <p class="sb__p sb__i">…</p>
      <div class="sb__proof sb__i">…</div>
      <div class="sb__cta sb__i">
        <a class="btn btn--solid" href="https://wa.me/{{WHATSAPP}}" target="_blank" rel="noopener">Falar comigo</a>
        <a class="btn" href="tel:{{TELEFONE_E164}}">{{TELEFONE}}</a>
      </div>
    </div>

  </div>
</section>
```

```css
.sb__wrap{max-width:1240px;margin:0 auto;
  display:grid;grid-template-columns:minmax(0,.78fr) minmax(0,1.22fr);
  gap:clamp(28px,4.5vw,76px);align-items:center}

/* o card: moldura de vidro à volta da foto */
.sb__card{position:relative;margin:0;overflow:hidden;isolation:isolate;
  border-radius:24px;padding:clamp(9px,1vw,14px);
  border:1px solid var(--line);
  background:linear-gradient(150deg, rgba(30,44,74,.55) 0%, rgba(9,12,20,.62) 100%);
  box-shadow:0 34px 80px rgba(0,0,0,.46), inset 0 1px 0 rgba(255,255,255,.10)}
/* fundo branco no <picture>: um retrato de estúdio com fundo claro precisa de
   uma base branca por baixo, senão vê-se o vidro escuro pelas bordas do JPEG */
.sb__card picture{display:block;border-radius:16px;overflow:hidden;background:#fff}
.sb__card img{display:block;width:100%;height:auto;transition:transform .8s var(--ease)}
.sb__card:hover img{transform:scale(1.02)}

/* o texto: solto na página, sem caixa nenhuma */
.sb__text{position:relative}
.sb__p{color:var(--muted);font-size:clamp(15px,1.2vw,17px);line-height:1.68;
  max-width:58ch;margin:0 0 16px}
```

O clarão (`sheen`) varre o vidro uma vez à entrada e outra no hover, com
arrefecimento de 1600ms para não piscar a cada passagem do rato:

```css
.sb__sheen{position:absolute;inset:-45%;z-index:3;pointer-events:none;
  opacity:0;transform:translate3d(-60%,60%,0);mix-blend-mode:screen;
  background:linear-gradient(66deg,
    rgba(255,255,255,0) 42%, rgba(157,194,255,.14) 47%,
    rgba(255,255,255,.32) 50%, rgba(157,194,255,.14) 53%,
    rgba(255,255,255,0) 58%)}
.sb__sheen.is-shine{animation:sb-shine 1.9s var(--ease) forwards}
```

O reset da animação exige forçar reflow (`void sheen.offsetWidth`) entre remover e
repor a classe. Em reduced motion o sheen é `display:none` — um clarão não tem
versão calma.

Sequência de entrada: primeiro o card, o texto **240ms depois**, e só então o
clarão (620ms após o card assentar). Entrar tudo ao mesmo tempo faz a secção
"aparecer"; entrar por etapas faz a secção "montar-se".

Responsivo: abaixo de 900px passa a uma coluna, o card ganha
`max-width:420px;margin-inline:auto`. No telemóvel os botões passam a coluna
explícita com largura total — empilhados por `flex-wrap`, cada botão abraça o seu
texto e ficam com larguras diferentes.

---

## 11. VENDER (`vender.html`)

A página mais importante do site: é aqui que um proprietário se converte em lead.
Três blocos, por esta ordem.

### 11.1 Herói editorial

Sem retrato. Centrado, uma frase enorme com uma palavra em gradiente, subtítulo,
dois botões, e uma pista de scroll no fundo.

```css
.vd-hero{
  min-height:94svh;   /* 94 e não 100: a secção seguinte espreita e convida a rolar */
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  text-align:center;position:relative;padding:150px var(--pad) 110px;
}
.vd-hero h1{font-size:clamp(33px,5.6vw,72px);font-weight:600;
  line-height:1.04;letter-spacing:-.034em;margin:26px 0 0;max-width:17ch}
.vd-hero h1 em{background:linear-gradient(115deg,var(--accent-2),var(--accent) 62%);
  -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.vd-hero .sub{color:var(--muted);font-size:clamp(15px,1.7vw,19px);
  line-height:1.66;max-width:50ch;margin:28px 0 36px}
.vd-hero>*{opacity:0;transform:translateY(18px);animation:fadeUp .95s var(--ease) forwards}
```

A pista de scroll tem keyframe próprio:

```css
/* o fadeUp partilhado acaba em "transform:none" e isso apagava o translateX(-50%)
   que centra o cue, atirando-o para a direita metade da própria largura. Aqui a
   centragem viaja dentro do keyframe. */
@keyframes vdCueIn{
  from{opacity:0;transform:translate(-50%,16px)}
  to{opacity:1;transform:translate(-50%,0)}
}
```

Detalhe tipográfico que se repete em todo o género: `letter-spacing` em maiúsculas
deixa um vão **depois da última letra**. Compensa-se com `margin-right:3px` no
kicker e no cue, senão o texto fica opticamente descentrado.

### 11.2 Os três passos

Grelha de três cartões numerados, com um fio que os liga por trás e uma faísca que
corre de um ao outro.

```css
.vd-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));
  gap:clamp(12px,1.6vw,20px);position:relative}
/* O FIO vive por trás dos cartões (z-index 0 contra 1): vê-se inteiro nos
   intervalos e esbatido através do vidro, como um circuito por baixo.
   A posição é escrita em JS a partir do centro real das bolas — em CSS não
   acerta, porque a bola é inline-flex e assenta numa linha de texto. */
.vd-wire{position:absolute;z-index:0;pointer-events:none;border-radius:2px;overflow:hidden}
```

Empilhado em telemóvel, o fio muda de comportamento:

```css
@media(max-width:960px){
  /* Empilhados, o fio passa a correr na vertical e atravessaria a cara dos três
     cartões — lia-se um risco a cortá-los, não uma ligação. Dá-se fundo opaco ao
     cartão (o fio deixa de transparecer pelo vidro) e mais folga entre eles, para
     a corrente só aparecer no salto de um passo para o seguinte. O fio continua a
     ser um só, contínuo por baixo: é o mesmo condutor a emergir nas juntas. */
  .vd-grid{grid-template-columns:minmax(0,1fr);gap:30px}
  .vd-step{background-color:var(--bg);
    -webkit-backdrop-filter:none;backdrop-filter:none}
}
```

Reduced motion: **fica o fio, sai a corrente** (`.vd-wire__spark`,
`.vd-wire__trail{display:none}`). A ligação é informação; a faísca é enfeite.

### 11.3 O painel de avaliação

Um só painel de vidro em duas colunas: à esquerda a promessa (título + lista de
quatro garantias com visto), à direita o formulário.

```css
.vd-panel{max-width:1140px;margin:0 auto;
  display:grid;grid-template-columns:minmax(0,.86fr) minmax(0,1.14fr);
  gap:clamp(28px,4vw,64px);align-items:start;
  padding:clamp(26px,3.6vw,52px);
  border:1px solid var(--line);border-radius:32px;
  background:linear-gradient(122deg, rgba(26,38,64,.44) 0%,
             rgba(9,12,20,.78) 60%, rgba(7,9,15,.86) 100%);
  -webkit-backdrop-filter:blur(22px) saturate(118%);
          backdrop-filter:blur(22px) saturate(118%);
  box-shadow:0 46px 110px rgba(0,0,0,.56), inset 0 1px 0 rgba(255,255,255,.10)}

.vd-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));
  gap:clamp(12px,1.4vw,16px)}
.vd-field--wide{grid-column:1/-1}
.vd-submit{grid-column:1/-1;justify-content:center;width:100%}
```

O formulário é 2×2 (nome / contacto, tipo / localização) + um campo largo de notas
+ botão. Cinco campos, um deles opcional. Cada campo a mais custa conversões; um
consultor liga a seguir e pergunta o resto.

O `<select>` nativo herda o tema do sistema — as opções têm de ser pintadas à mão,
senão em modo escuro aparece um menu branco:

```css
.vd-field select{appearance:none;-webkit-appearance:none;cursor:pointer;
  background-image:url("data:image/svg+xml;charset=utf-8,…seta…");
  background-repeat:no-repeat;background-position:right 14px center;
  background-size:16px;padding-right:40px}
.vd-field select option{background:#0D1220;color:#F2F5FA}
```

Abaixo de 600px o painel perde o blur e ganha opacidade — mesma decisão da caixa do
imóvel (§5): `backdrop-filter` em ecrã pequeno custa caro e o texto precisa de mais
contraste sobre um fundo animado.

---

## 12. FOOTER

**O que é.** O fecho da página, e a segunda peça mais desenhada do site depois do
hero. Fundo **transparente** de propósito: o fundo animado continua a ver-se; o
contraste vem de véus parciais e de painéis locais, nunca de um fundo opaco.

### Camadas, de trás para a frente

```
0  .ft__giant   — o nome em maiúsculas, gigante, em gradiente que se apaga
1  .ft::before  — scrim radial local
1  .ft__fade    — esbatimento sobre a metade de baixo
2  .ft__crest   — o logo em caixa de vidro
2  .ft__inner   — kicker, nome, descrição, sociais, nav
2  .ft__base    — barra final
```

```html
<footer class="ft" id="ft">
  <p class="ft__giant" aria-hidden="true">{{NOME}}</p>
  <div class="ft__fade" aria-hidden="true"></div>

  <div class="ft__crest ft-rev">
    <span class="ft__logo">
      <img class="ft__logoimg" src="assets/logo-white.png" width="727" height="385"
           loading="lazy" decoding="async" alt="{{AGENCIA}} — AMI {{AMI}}" />
    </span>
  </div>

  <div class="ft__inner">
    <p class="kicker ft__eyebrow ft-rev" style="--ft-d:.05s">Consultor Imobiliário</p>
    <h2 class="ft__brand ft-rev" style="--ft-d:.12s">{{NOME}}</h2>
    <p class="ft__desc ft-rev" style="--ft-d:.18s">Consultoria imobiliária em {{CIDADE}}…</p>

    <ul class="ft__social ft-rev" style="--ft-d:.24s">
      <li><a href="https://instagram.com/{{INSTAGRAM}}" target="_blank" rel="noopener">
        <svg …></svg><span class="ft__sr">Instagram</span></a></li>
      <li><a href="https://wa.me/{{WHATSAPP}}" target="_blank" rel="noopener">
        <svg …></svg><span class="ft__sr">WhatsApp</span></a></li>
      <li><a href="tel:{{TELEFONE_E164}}">
        <svg …></svg><span class="ft__sr">Telefone</span></a></li>
    </ul>

    <nav class="ft__nav ft-rev" style="--ft-d:.3s" aria-label="Navegação do rodapé">
      <a href="#top">Início</a><a href="#imovel">Comprar</a><a href="vender.html">Vender</a>
      <a href="#redes">Instagram</a><a href="sobre.html">Sobre mim</a>
    </nav>
  </div>

  <div class="ft__base ft-rev" style="--ft-d:.36s">
    <p class="ft__copy">© {{ANO}} {{NOME}} · Consultor Imobiliário {{AGENCIA}} · {{CIDADE}}</p>
    <a href="privacidade.html">Política de Privacidade</a>
    <p>{{AGENCIA}} · AMI {{AMI}}</p>
    <p class="ft__net"><span class="ft__dot" aria-hidden="true"></span><span>{{AGENCIA}} · {{CIDADE}}</span></p>
  </div>
</footer>
```

### O nome gigante

```css
.ft{position:relative;z-index:0;isolation:isolate;background:transparent;
  min-height:clamp(30rem,44vw,40rem);
  display:flex;flex-direction:column;
  padding:0 var(--pad) clamp(52px,6vw,84px);
  overflow:hidden}   /* o nome gigante pode transbordar em ecrãs estreitos */

.ft__giant{
  position:absolute;left:0;right:0;bottom:-.06em;z-index:0;
  font-family:var(--display);font-weight:700;
  font-size:clamp(3rem,12vw,10rem);
  line-height:.82;letter-spacing:-.035em;
  text-align:center;text-transform:uppercase;white-space:nowrap;
  background:linear-gradient(180deg,
      rgba(242,245,250,.24) 0%,
      rgba(157,194,255,.13) 52%,
      rgba(157,194,255,0) 92%);
  -webkit-background-clip:text;background-clip:text;
  -webkit-text-fill-color:transparent;color:transparent;
  -webkit-user-select:none;user-select:none;pointer-events:none;
  opacity:0;transform:translateY(26px);
  transition:opacity 1s var(--ease) .18s,transform 1s var(--ease) .18s}
.ft.is-ft-in .ft__giant{opacity:1;transform:none}
```

`bottom:-.06em` para as descidas assentarem na base sem folga. `white-space:nowrap`
+ `overflow:hidden` no `.ft`: em ecrã estreito o nome sai pelos lados, e sai bem —
é decorativo (`aria-hidden`) e o corte lê-se como intenção.

### O véu

```css
.ft__fade{position:absolute;left:0;right:0;bottom:0;height:64%;z-index:1;
  pointer-events:none;
  background:linear-gradient(to bottom, rgba(10,10,10,0) 0%,
             rgba(10,10,10,.18) 46%, rgba(10,10,10,.40) 100%)}

/* scrim local: tem de viver no PRÓPRIO footer, não dentro de .ft__inner —
   .ft__inner cria contexto de empilhamento (z-index:2) e prendia o pseudo lá
   dentro, a pintar por cima do nome gigante em vez de por baixo */
.ft::before{
  content:"";position:absolute;z-index:1;left:50%;top:44%;transform:translate(-50%,-50%);
  width:min(1100px,132%);height:64%;pointer-events:none;
  background:radial-gradient(ellipse at center,rgba(10,10,10,.32) 0%,
             rgba(10,10,10,.16) 46%,rgba(10,10,10,0) 72%)}
```

### O logo em caixa de vidro

```css
.ft__logo{position:relative;z-index:1;
  /* landscape, não quadrada: forçar um quadrado deforma o lockup */
  width:clamp(132px,15vw,178px);height:clamp(70px,8vw,94px);
  display:grid;place-items:center;border-radius:20px;padding:0 clamp(14px,1.6vw,20px);
  background:rgba(12,16,26,.58);border:1px solid var(--line);
  -webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);
  box-shadow:0 18px 42px rgba(0,0,0,.38), inset 0 1px 0 rgba(255,255,255,.08)}
.ft__logoimg{width:100%;height:auto;max-height:64%;object-fit:contain;display:block}
```

Sem linha nem risco atrás do logo: o crest é só o lockup em vidro.

### Sociais em círculo

```css
.ft__social a{width:48px;height:48px;border-radius:50%;
  display:inline-flex;align-items:center;justify-content:center;
  background:rgba(255,255,255,.06);border:1px solid var(--line);
  -webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);
  transition:transform .35s var(--ease),background .35s,border-color .35s,color .35s}
.ft__social a:hover,.ft__social a:focus-visible{
  transform:translateY(-3px);
  background:rgba(77,141,246,.20);border-color:rgba(77,141,246,.62);color:#fff;outline:none}
/* rótulo só para leitor de ecrã: o ícone sozinho não é nome acessível */
.ft__sr{position:absolute;width:1px;height:1px;overflow:hidden;
  clip-path:inset(50%);white-space:nowrap}
```

48×48 é o mínimo de alvo táctil confortável; abaixo de 430px desce para 44×44, que
é o mínimo absoluto.

### Nav com sublinhado que cresce da esquerda

```css
.ft__nav a{position:relative;color:var(--muted);
  font-size:12px;font-weight:500;letter-spacing:2px;text-transform:uppercase;
  padding-bottom:4px;transition:color .3s var(--ease)}
.ft__nav a::after{content:"";position:absolute;left:0;right:0;bottom:0;height:1px;
  background:var(--accent);
  transform:scaleX(0);transform-origin:left;
  transition:transform .38s var(--ease)}
.ft__nav a:hover::after,.ft__nav a:focus-visible::after{transform:scaleX(1)}
```

`transform-origin:left` e não `center`: cresce **da esquerda**, na direcção da
leitura. Em reduced motion o sublinhado aparece já inteiro no hover
(`transform:scaleX(1)`), não desaparece — a afordância continua a existir.

### Barra final

```css
.ft__base{position:relative;z-index:2;
  margin-top:auto;padding-top:clamp(70px,10vw,132px);
  display:flex;align-items:center;justify-content:space-between;
  gap:14px 26px;flex-wrap:wrap;
  font-size:12.5px;line-height:1.5;color:var(--muted)}
@media(max-width:768px){
  .ft__base{flex-direction:column;justify-content:center;text-align:center;
    padding-top:clamp(80px,16vw,110px)}
}
```

`margin-top:auto` empurra-a para o fundo do flex column do footer, e o
`padding-top` grande é o que deixa o nome gigante respirar por baixo do bloco
central. É esse espaço vazio que faz o footer parecer desenhado e não sobrado.

Conteúdo obrigatório da barra: copyright com o ano, link para a política de
privacidade, agência e **número AMI**. O AMI não é opcional em Portugal.

### Entrada

Uma classe no footer inteiro (`is-ft-in`), disparada por IntersectionObserver, e
atrasos por elemento via `--ft-d`. Um observer para o footer todo, não um por
elemento: o footer entra em bloco.

---

## 13. FORMULÁRIOS SEM BACKEND

O site não tem servidor. Um formulário que envia email precisa de um endpoint, de
uma chave de API, de um domínio verificado e de uma fatura mensal. Nada disso
existe aqui, e não deve existir: um site de consultor tem de poder ser entregue
como uma pasta.

### A montagem

```html
<form class="vd-form" id="vd-form" novalidate>
  <div class="vd-field">
    <label for="vd-nome">Nome</label>
    <input id="vd-nome" name="nome" type="text" autocomplete="name" required placeholder="Maria Silva" />
  </div>
  <div class="vd-field">
    <label for="vd-contacto">Telemóvel ou email</label>
    <input id="vd-contacto" name="contacto" type="text" autocomplete="tel" required placeholder="912 345 678" />
  </div>
  <!-- … -->
  <button type="submit" class="btn btn--solid vd-submit">Enviar pedido</button>
  <p class="vd-note">O pedido abre uma conversa de WhatsApp comigo, já preenchida.
     Os dados servem só para lhe responder.</p>
</form>
```

```js
(function VD_form(){
  var f = document.getElementById('vd-form');
  if(!f) return;

  f.addEventListener('submit', function(e){
    e.preventDefault();
    var v = function(id){ var el = document.getElementById(id); return el ? el.value.trim() : ''; };
    var nome = v('vd-nome'), contacto = v('vd-contacto'), local = v('vd-local');

    /* validação própria: o novalidate desliga a do browser, que em pt-PT dá
       mensagens inconsistentes entre motores e não é estilizável */
    if(!nome || !contacto || !local){
      [['vd-nome',nome],['vd-contacto',contacto],['vd-local',local]].forEach(function(p){
        var el = document.getElementById(p[0]);
        if(el) el.setAttribute('aria-invalid', p[1] ? 'false' : 'true');
      });
      var first = document.querySelector('#vd-form [aria-invalid="true"]');
      if(first) first.focus();
      alert('Preencha o nome, o contacto e a localização.');
      return;
    }

    var tipoSel = document.getElementById('vd-tipo');
    var linhas = [
      'Pedido de avaliação', '',
      'Nome: ' + nome,
      'Contacto: ' + contacto,
      'Tipo: ' + (tipoSel ? tipoSel.value : ''),
      'Localização: ' + local
    ];
    var notas = v('vd-notas');
    if(notas) linhas.push('Notas: ' + notas);

    window.open('https://wa.me/{{WHATSAPP}}?text=' + encodeURIComponent(linhas.join('\n')),
                '_blank', 'noopener');
  });

  /* o erro apaga-se assim que a pessoa começa a corrigir */
  f.addEventListener('input', function(e){
    if(e.target.hasAttribute('aria-invalid')) e.target.setAttribute('aria-invalid','false');
  });
})();
```

Pontos de implementação:

- `{{WHATSAPP}}` é o número em formato internacional **sem `+`, sem espaços,
  sem traços** — `351912345678`. `wa.me` rejeita tudo o resto.
- `encodeURIComponent` sobre a mensagem **inteira**, depois de juntar as linhas com
  `\n`. Codificar linha a linha estraga as quebras. Sem codificação, os acentos
  chegam partidos e o `&` de "Sala & cozinha" trunca a mensagem.
- `window.open(..., '_blank', 'noopener')` e não `location.href`: o formulário fica
  preenchido no separador original, e se o WhatsApp não abrir a pessoa não perdeu o
  que escreveu.
- `aria-invalid` nos campos em falta + foco no primeiro. Uma borda vermelha sem
  `aria-invalid` não existe para quem usa leitor de ecrã.

### Porque é decisão e não atalho

1. **Chega onde a pessoa está.** Um consultor imobiliário em Portugal trabalha por
   WhatsApp. O lead cai no mesmo sítio onde ele já responde, com notificação, sem
   passar por uma caixa de spam.
2. **A resposta é imediata e pessoal.** O formulário não devolve um "obrigado, será
   contactado": devolve uma conversa aberta com o consultor. A promessa da página
   ("resposta no próprio dia") passa a ser verificável.
3. **Sem dados em trânsito e sem base de dados.** Não há servidor a receber, não há
   tabela a guardar, não há responsável pelo tratamento a declarar para um sistema
   que não existe. O visitante envia a mensagem a partir da conta dele, para o
   número do consultor. Menos superfície legal e menos superfície de ataque.
4. **Não há nada que possa falhar em silêncio.** Endpoints de formulário caem,
   expiram chaves, mudam de plano. Um `wa.me` não tem manutenção.

O custo — e diz-se ao cliente — é que não há registo automático dos pedidos nem
funil de analytics. Quem quiser CRM instala-o do lado do WhatsApp Business, não do
lado do site.

### O consentimento RGPD

Não há caixa de consentimento e é correcto que não haja: **não estás a recolher
dados**. Os dados nunca chegam ao site — são escritos numa mensagem que a pessoa
envia, por acto próprio, a partir da aplicação dela. Uma caixa "aceito o
tratamento dos meus dados" num formulário que não trata dados é ruído, e ensina o
utilizador a carimbar consentimentos sem ler.

O que **tem** de existir:

- **Uma nota curta debaixo do botão**, na mesma tela onde se decide: "O pedido abre
  uma conversa de WhatsApp comigo, já preenchida. Os dados servem só para lhe
  responder." Diz o destino, o mecanismo e a finalidade em duas linhas.
- **`privacidade.html`**, linkada no footer de todas as páginas, a declarar: quem é
  o responsável (nome, agência, AMI), que dados são partilhados por esta via, com
  que finalidade, durante quanto tempo, que o canal é o WhatsApp e que se rege
  também pelos termos dele, e como exercer os direitos de acesso, rectificação e
  apagamento.
- **Nada de trackers de terceiros** sem banner de cookies. Sem analytics de
  terceiros, o site não põe cookies e não precisa de banner nenhum — o que é, por
  si só, um argumento a favor de não os pôr.

Se o projecto **tiver mesmo** de gravar leads num backend, então tudo muda: passa a
haver recolha, e aí é obrigatória uma checkbox **não pré-marcada**, com link para a
política, e o formulário não pode submeter sem ela.

---

## 14. ORDEM E RITMO

### 14.1 Densa / respirável, alternadamente

A home alterna deliberadamente:

| Secção | Densidade | Porquê |
|---|---|---|
| HERO | densa (imagem + 5 elementos de texto) | primeira impressão |
| PONTE | **respirável** (uma frase, ar à volta) | descomprime |
| IMÓVEL | densa (foto, preço, 4 cápsulas, 2 parágrafos) | a informação |
| CONVITE | **respirável** (3 linhas + 1 botão) | descomprime |
| SOCIAL | densa (6 cartões, setas, pontos) | prova de actividade |
| FOOTER | densa mas com o nome gigante a dar ar | fecho |

A razão é de leitura, não de estética. Uma secção densa exige decisão: o olho tem
de escolher onde pousar, ler valores, comparar. Duas seguidas e a pessoa deixa de
escolher — passa a rolar sem ler, e o cartão do imóvel, que é o único conteúdo que
interessa vender, passa a ser scenery. A secção respirável entre elas não pede nada:
serve para o olho pousar e para a próxima secção densa voltar a ser lida como
informação nova.

Regra prática: **nenhuma secção densa é seguida de outra secção densa sem uma peça
respirável ou pelo menos um salto grande de padding entre as duas.** Se não houver
peça, o padding é `clamp(72px,11vh,132px)` no topo da segunda — foi por isso que a
secção do imóvel tem esse valor e a ponte tem um `padding-top` menor: quando estão
coladas, a soma dos dois é o intervalo.

### 14.2 Nunca dois painéis de vidro seguidos sem ar

O vidro (`backdrop-filter` + fundo translúcido + borda a 12% + sombra profunda) é o
único mecanismo de contraste do site. Funciona porque é **excepção**: uma peça
opaca a flutuar sobre um fundo animado lê-se como um objecto pousado.

Dois painéis de vidro encostados perdem essa leitura por duas razões:

1. **Ópticas.** As bordas a `rgba(255,255,255,.12)` de dois painéis contíguos leem-
   se como uma linha dupla, e os blurs sobrepõem-se: o fundo animado deixa de se
   ver entre eles, e o que era "objectos sobre um fundo vivo" passa a ser "uma
   faixa cinzenta". O fundo é metade da identidade do site; tapá-lo com dois
   painéis colados é apagá-la.
2. **De hierarquia.** Se tudo é painel, nada é destaque. O olho lê "vidro" como
   "isto é importante"; dois seguidos anulam-se.

Por isso o convite (§6) leva `margin-top:clamp(16px,2.2vw,26px)` sobre o cartão do
imóvel e é **visivelmente mais fraco** — menos blur, menos opacidade, raio menor,
botão fantasma. É a única excepção do género, e mesmo essa é resolvida por
hierarquia, não por proximidade.

Onde a regra se aplica sempre:
- Painel de vidro → **secção transparente** (ponte, prova solta, texto) → painel de vidro.
- Nunca dois `backdrop-filter` adjacentes com o mesmo peso visual.
- Em telemóvel, os painéis perdem o blur e ganham opacidade — o que **agrava** o
  problema, porque dois painéis opacos encostados são literalmente um bloco. Abaixo
  de 880px, verifica sempre a distância entre painéis.

### 14.3 A cadência das entradas

Dentro de uma secção, as peças entram por etapas curtas e escalonadas
(`.06s`, `.16s`, `.26s` entre cartões; `240ms` entre o card e o texto do sobre;
`620ms` até ao clarão). Nunca mais do que ~0.6s do primeiro ao último elemento: mais
do que isso e a pessoa já rolou para fora antes de a secção acabar de entrar.

Entre secções, não há coordenação nenhuma: cada uma tem o seu observer e entra
quando chega ao ecrã. Tentar orquestrar a página inteira obriga a um scroll
controlado, e um scroll controlado é a primeira coisa que estraga um site que tem
de funcionar bem num telemóvel de gama média.
