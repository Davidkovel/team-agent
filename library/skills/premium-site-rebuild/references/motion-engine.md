# O motor de movimento

Tudo o que mexe passa por um núcleo pequeno (`assets/starter/js/00-nucleo.js`, tirado de
`assets/reference/deantonio/js/00-core.js`). As receitas das secções estão em
`assets/starter/js/20-comuns.js`. Ler o original quando houver dúvida.

## 1. O núcleo

```js
window.SITE = (() => {   // versão completa em assets/starter/js/00-nucleo.js
  const reduz = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const ecra = { y: scrollY, h: innerHeight, w: innerWidth, mexeu: true, t: 0 };
  // caixas em coordenadas da PÁGINA, medidas todas de uma vez só quando o desenho muda
  const caixas = new Map(); let sujas = true;
  const mede = () => { sujas = false; const y = scrollY, x = scrollX;
    for (const [el, c] of caixas) { const r = el.getBoundingClientRect();
      c.top = r.top + y; c.left = r.left + x; c.width = r.width; c.height = r.height; c.bottom = c.top + r.height; c.right = c.left + r.width; } };
  const caixa = (el) => { let c = caixas.get(el); if (!c) { c = {}; caixas.set(el, c); sujas = true; } if (sujas) mede(); return c; };
  const remede = () => { sujas = true; };
  // 0 quando o topo entra por baixo, 1 quando o fundo sai por cima
  const prog = (el) => { const c = caixa(el), top = c.top - ecra.y; return clamp((ecra.h - top) / (ecra.h + c.height)); };
  // um só laço: primeiro as leituras, depois as escritas (nenhum layout forçado)
  const leituras = [], escritas = []; let yAnt = NaN, ultimoMexe = 0;
  const corre = (l, t) => { for (const f of l) { try { f(t, ecra); } catch (e) { console.error(e); } } };
  const quadro = (t) => { requestAnimationFrame(quadro); if (document.hidden) return;
    const y = scrollY; ecra.mexeu = y !== yAnt; ecra.y = y; ecra.t = t; yAnt = y;
    if (ecra.mexeu) ultimoMexe = t; else if (ultimoMexe && t - ultimoMexe > 500) { ultimoMexe = 0; sujas = true; }
    if (sujas && caixas.size) mede(); corre(leituras, t); corre(escritas, t); };
  requestAnimationFrame(quadro);
  // trabalho pesado espera que o scroll pare
  const quieto = (ms = 160) => new Promise((ok) => { const t0 = performance.now();
    const ve = (t) => ((t - ultimoMexe > ms || !ultimoMexe) && t - t0 > 16 ? ok() : requestAnimationFrame(ve)); requestAnimationFrame(ve); });
  const ocioso = (fn, ms = 600) => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: ms }) : setTimeout(fn, 1));
  addEventListener('resize', () => { ecra.h = innerHeight; ecra.w = innerWidth; sujas = true; }, { passive: true });
  addEventListener('load', remede); document.fonts?.ready.then(remede);
  new ResizeObserver(remede).observe(document.documentElement);
  return { reduz, clamp, prog, caixa, remede, ecra, quieto, ocioso, aLer: (f) => leituras.push(f), aCada: (f) => escritas.push(f) };
})();
```

Regras do laço:
- Cada função de escrita guarda o último valor e **só escreve quando muda** (`if (s !== ant)`),
  com `toFixed(3–4)` para não escrever ruído.
- Uma secção fora do ecrã sai logo (`if (c.bottom - y <= 0 || top >= h) continue`).
- Propriedades CSS animadas (`--q`, `--j`, `--x`) registadas com `@property … inherits:false`
  e escritas só nas folhas que as usam: mudar o valor não recalcula o estilo de nada por baixo.

## 2. Receitas comuns (atributos `data-*`)

| Atributo | O que faz | Como |
|---|---|---|
| `data-linhas` | o bloco entra linha a linha | IntersectionObserver `threshold:0` põe `.dentro`; CSS: cada `.l>span` sobe de `translateY(105%)` com `transition-delay: calc(var(--i)*80ms)` |
| `data-duas-tintas` | o parágrafo acende-se palavra a palavra com o scroll | partir em `<span class="p">`; no laço, `n = round(clamp((h*.85 - top)/(h*.55)) * total)`; trocar só as palavras entre o n antigo e o novo |
| `data-janela` | a imagem abre como uma janela | `--j` de 1 a 0 entre 5% e 45% do progresso; CSS `clip-path: inset(calc(var(--j)*18%) calc(var(--j)*24%) round 4px)` |
| `data-vivo` | a imagem segue o rato (±14 px) | `pointermove` só `mouse`, guardar o evento, escrever num rAF; posição pela caixa guardada |
| `data-conta="46"` | número que conta | IO + rAF 1600 ms, easing `1-(1-k)^4`; milhares à mão (`toLocaleString` custa 20 ms) |
| `img[loading=lazy]` | decode antecipado | IO com `rootMargin:'150% 0px'` → `img.decode()` |
| `data-video-auto` | vídeo que só toca à vista | IO: põe `src` de `data-src` na primeira vez, `play()`/`pause()` |
| `data-barra` | barra de contacto fixa | `.on` depois de `y > h*.7`; `--sobe = max(0, h - (topoRodape - y))` |

CSS das entradas, com reduced motion já resolvido:

```css
@media (prefers-reduced-motion:no-preference){
  [data-linhas] .l{display:block;overflow:hidden}
  [data-linhas] .l>span{display:block;transform:translateY(105%);transition:transform var(--t-cena) var(--curva);transition-delay:calc(var(--i,0)*80ms)}
  [data-linhas].dentro .l>span{transform:none}
}
[data-duas-tintas] .p{color:color-mix(in srgb,var(--claro) 28%,transparent);transition:color var(--t-entra) var(--curva)}
[data-duas-tintas] .p.on{color:var(--claro)}
```

## 3. O hero com filme

- `<video muted playsinline preload="auto" data-src-h="hero-1080.mp4" data-src-m="hero-720.mp4" data-src-v="hero-v.mp4">`
  + `<picture>` com o cartaz (vertical para telemóvel ao alto) por baixo.
- Antes do primeiro play: `muted = defaultMuted = true`, atributo `muted`, `playsInline`, sem
  `controls`. Escolher a fonte: vertical se `(max-width:899px) and (orientation:portrait)`,
  1080 se `innerWidth*devicePixelRatio >= 1500`, senão 720.
- Só mostrar o vídeo quando há fotogramas a sério (`requestVideoFrameCallback` ou
  `currentTime > 0`): o primeiro fotograma é igual ao cartaz, não há salto.
- Recusado (Poupança de energia): o cartaz ganha Ken Burns lento (`.kb`), e tenta-se de novo com
  recuo exponencial (400·2ⁿ ms, 4 vezes) e em qualquer gesto (toque, tecla; scroll/roda no
  máximo a cada 600 ms).
- Pausa fora do ecrã (IO) e com a aba escondida.
- Parallax: `--q = clamp(y/(h*.7))`; onde há `animation-timeline: scroll()`, o CSS faz o parallax
  no compositor e o JS só troca estados (`.fora` quando q > .6; `sobre-hero` no body).

## 4. A abertura (o logótipo voa para o cabeçalho)

1. Prender o scroll (`documentElement.style.overflow='hidden'`), com garantia de soltar aos 6 s.
2. Esperar fontes + cartaz decodificado + logótipo decodificado (máx. 900 ms), mais 2 fotogramas.
3. Desenhar o logótipo verdadeiro (o mesmo `path` do cabeçalho) como **uma imagem** (SVG em
   data URL), recortado em janelas por letra/bloco; cada bloco anima só `transform/opacity`.
4. Um traço (a "linha de água") risca o ecrã com a curva do site; cada bloco sobe quando a
   cabeça do traço passa por baixo dele: atraso = `tempoPara(x/largura) * RISCA`, onde
   `tempoPara` inverte a Bézier `.16,1,.3,1` por bissecção.
5. FLIP: medir a caixa do logótipo grande e a do cabeçalho, aplicar
   `translate3d(dx,dy,0) scale(b.width/a.width)` com transição declarada já com atraso no CSS
   (corre no compositor mesmo com a thread ocupada).
6. No `transitionend` (com reserva por timeout): mostrar o logótipo do cabeçalho por baixo no
   mesmo píxel, só depois apagar o que voou; soltar o scroll; disparar o evento `aberto`
   (outras secções adiam trabalho pesado até lá: `SITE.abertura.then(...)`).
7. Reduced motion ou sem logótipo: saltar tudo para o estado final.
8. Cada carregamento começa no topo (`history.scrollRestoration='manual'`, guardar o `#hash`
   inicial e ir lá depois da abertura).

## 5. Rota: um objecto que atravessa a página (a travessia)

1. **Construir** (no resize de largura e com o scroll parado, nunca num fotograma): pontos a
   partir das secções — cada secção tem `data-via="0.07"` (fracção da largura onde o objecto
   navega); entra-se a `topo + m` e sai-se a `fundo - m`. Ligar os pontos com Béziers de tangente
   vertical (`C a.x a.y+h, c.x c.y-h, c.x c.y`): nunca saem da faixa.
2. **Tabela** de pontos a cada 4 px de comprimento, calculada das próprias curvas (não usar
   `getPointAtLength` em ciclo).
3. **Posição**: o comprimento alvo vem da "linha de leitura" (ex. 55% do ecrã) projectada na
   rota; o comprimento real persegue o alvo com amortecimento (`len += (alvo-len)*k`), por isso o
   objecto tem inércia. Rotação = ângulo da tangente entre dois pontos da tabela.
4. **Esteira**: se a rota for sempre a descer, revelar o traço com uma janela que só muda
   `transform` (compositor); senão, `stroke-dashoffset`.
5. **Mergulho** opcional: cada media opaca que cruza a rota vira um troço [entra, sai]; dentro do
   troço o objecto passa por baixo (troca para uma versão azulada/desfocada por opacidade).
6. **HUD**: velocidade do scroll convertida para a unidade do negócio (nós, km/h, rpm…),
   escrita só quando muda.
7. **Chegada**: no fim da rota acontece o evento de negócio (as rotas do mapa acendem, a
   assinatura escreve-se, o formulário abre).
8. Telemóvel: rota recta numa faixa à esquerda (`--faixa-m: 52px`), texto à direita dela.

## 6. Carrossel, ecrã inteiro, raio X, 3D

- **Carrossel**: `scroll-snap-type:x mandatory` + arrasto de rato próprio; posições das fotos
  medidas uma vez (e no ResizeObserver); a actual é a mais próxima do início; um arrasto não
  abre a foto; Tab encaixa a foto focada; setas/Home/End.
- **Raio X**: duas camadas empilhadas, a de cima com `clip-path: inset(0 0 0 calc(var(--x)*1%))`;
  o scroll leva `--x` de 95 a 5; arrastar/clicar/setas criam um desvio que se dissolve ao
  continuar o scroll; a linha e a pega andam por `translate` em `cqi` (nunca `left`).
- **3D** (three local em `vendor/`): só nasce com o scroll parado perto (IO + `quieto()`);
  descarregar o GLB com progresso, interpretar depois; `KHR_parallel_shader_compile`; desenhar
  só com o visor à vista e algo a mudar; a roda do rato desce a página (zoom só com Ctrl/pinça).

## 7. Armadilhas (custaram tempo no original)

- `getBoundingClientRect` num handler de scroll/pointermove = layout forçado a cada evento.
- Trocar um nó de texto a cada fotograma refaz o layout: escrever só quando muda.
- No iPhone a barra do Safari muda a altura a meio do scroll: refazer coisas só pela largura
  (ou por um salto grande de altura).
- `toLocaleString` na primeira chamada carrega os dados de língua (~20 ms).
- Hover em ecrãs tácteis fica preso: realces só em `(hover:hover) and (pointer:fine)`.
- `pageshow` com `persisted` (voltar atrás no Safari) deixa o estado a meio: recarregar.
- `mailto:`/`tel:` disparam `beforeunload`: se o núcleo volta ao topo no beforeunload, repor o
  lugar depois.
- Canvas grande: tecto de ~6 milhões de píxeis; limpar só o rectângulo sujo.
