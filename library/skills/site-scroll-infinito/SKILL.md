---
name: site-scroll-infinito
description: O padrão da Empresa AMG para qualquer site profissional — o scroll é uma viagem contínua, sem cortes («infinite scroll»), como os sites Levora, Mr. Day e DRIP dos TikToks — filme de fotogramas ou mundo de camadas que a câmara atravessa, faixas infinitas, produto que se desmonta, números que contam, peças que caem, cor que muda e a página que recomeça sem corte. HTML + CSS + JS vanilla, sem build, com motor e demo prontos. USE THIS SKILL sempre que pedirem um site ou landing page profissional, bom, moderno, premium, bonito, «que capte a atenção», «como os do TikTok / Awwwards / Apple», site de produto, marca, loja, app ou jogo, scroll animado, parallax, scrollytelling, infinite scroll, ou para pôr um site fraco a outro nível; em russo «профессиональный сайт», «крутой сайт», «сайт с анимацией», «бесконечный скролл». Junta-se às outras skills de sites (realtor-landing, site-empresa-local, premium-site-rebuild, site-estudio-ia), que dão o conteúdo do ramo.
---

# Site de scroll infinito (o scroll é um filme)

## O que é

Tirado de três vídeos que o Marco escolheu (18 out 2026): a página deixa de ser uma pilha de secções e passa a ser
**uma viagem que o scroll conduz**. Quem visita sente que anda por dentro de um sítio, sem cortes, e quer ver o que vem
a seguir. Anatomia ecrã a ecrã em `references/os-tres-videos.md`.

| Vídeo | O que se vê | Peça do starter |
|---|---|---|
| [Levora](https://www.tiktok.com/@wearebrand.io/video/7570502793119862039) | entra-se por um portal rasgado num mundo pintado; a câmara voa pelas nuvens de cena em cena; o texto aparece nas paragens | `data-cena` + fotogramas ou mundo de camadas, `data-beat` |
| [Mr. Day](https://www.tiktok.com/@webforge6/video/7668263321325423894) | laranja, faixas a correr em diagonal que se cruzam, embalagens que caem uma a uma, percentagem a contar, a cor muda | `data-faixa`, `data-cai`, `data-pct`, `data-cor` |
| [DRIP](https://www.tiktok.com/@webloved/video/7644630550736620833) | produto preso ao meio (estilo Apple) que roda, se desmonta, mostra o pormenor e acende; rótulos à esquerda e à direita; números grandes; acaba no escuro com o botão | `data-cena` + `data-peca`, `data-conta`, fotogramas do produto |

A demo `starter/` (marca fictícia NORTE, expedições de montanha) tem tudo isto a funcionar: abre sem imagens nenhumas.

## Com que outras skills

- **Esta dá a experiência** (a viagem do topo, as peças de scroll, o motor). A skill do ramo dá o conteúdo, as páginas e
  o tom: imobiliário → `realtor-landing`; negócio local → `site-empresa-local`; refazer um site de luxo →
  `premium-site-rebuild`; estúdio ou portefólio → `site-estudio-ia`. Ler as duas e juntar.
- **Loja Shopify**: as peças passam para secções do tema (`references/shopify.md`). Nunca mexer no tema publicado sem o
  dono dizer: trabalhar num tema duplicado ou numa página de teste à parte.
- Não serve para painéis e ferramentas internas (o Hub) nem para páginas de texto longo (legal, blog).

## Regras

1. **Uma viagem nascida do negócio.** Pergunta: «por onde anda a câmara?» (o carro do aluno pela cidade até à carta; a
   chávena do grão ao balcão; a casa da rua ao terraço). Ideias por ramo em `references/ideias-por-negocio.md`. Nunca
   copiar o Levora, o Mr. Day ou o DRIP tal e qual.
2. **O primeiro ecrã está pronto no primeiro fotograma**: título (≤ 6 palavras), uma linha, um botão. Nada de ecrã de
   carregamento a esconder o site.
3. **Scroll nativo, nunca sequestrado**: nada de bloquear a roda nem de snap forçado. O peso vem do motor (o filme
   persegue o scroll com inércia).
4. **Só `transform`, `opacity` e o canvas mexem**; um só laço rAF; caixas medidas só quando o desenho muda. O
   `starter/js/scroll.js` já faz isto: estender, não reescrever.
5. **O texto é HTML, nunca dentro do filme** (legível no telemóvel, traduzível, Google, leitores de ecrã).
6. **Telemóvel com filme próprio** (vertical, ou recorte com `--foco`) e menos fotogramas. Testar a 390 px.
7. **Peso**: fotogramas ≤ 9 MB no PC e ≤ 4 MB no telemóvel; o resto da página ≤ 2,5 MB. A carga é progressiva (o
   motor já carrega 1.º e último, depois de 32 em 32, 16, 8...).
8. **Movimento reduzido**: tudo legível e parado (o starter já faz; confirmar com `fotos.py --quieto`).
9. **A volta** (`data-volta`, o scroll que recomeça sem corte) só quando o fim leva ao início; o contacto fica sempre
   antes da cópia. Só liga no PC (no telemóvel o salto parte a inércia do dedo).
10. **Factos verdadeiros do cliente.** Números, prémios, preços, clientes: só os reais. O que faltar vai numa lista para
    o cliente. Uma demo diz que é demo e leva `noindex`.

## Processo

1. **Material.** Ler o site/loja atual, logótipos, cores, fotos e, sobretudo, os vídeos que o cliente já tem (anúncios,
   reels): são o filme mais barato que há.
2. **Guião da viagem, antes de código.** 5 a 8 paragens. Para cada uma: o que a câmara vê, o título, uma linha, e o
   intervalo do progresso (`data-de` → `data-ate`). A primeira é o hero, a última é o convite (botão). Depois da viagem
   vêm as provas (números, produto, faixas, peças que caem) e o contacto.
3. **O filme** (`references/filme.md`), por esta ordem de preferência:
   - **A** filmagens/anúncios do cliente → `python -I scripts/fotogramas.py anuncio1.mp4 anuncio2.mp4 --saida frames`;
   - **B** IA (Higgsfield): imagens-chave no mesmo estilo → clips com **primeiro e último fotograma** (o último do clip N
     é o primeiro do N+1) → `fotogramas.py` cola-os numa viagem só. Gasta créditos: ver o saldo e o custo antes;
   - **B rápida** (reel de um parceiro, 26 out: kutuzova_alesya, «анимация по скроллу в Claude»,
     instagram.com/reel/Dd3Z8kpodHS): **uma** imagem forte (Pinterest ou foto do cliente, no estilo da marca) → um clip
     image-to-video de 5–8 s com a câmara a andar devagar e a cena a mudar (ex.: vinho e queijo → copo → serpente) →
     `fotogramas.py` → o Claude constrói o site à volta desse filme, com o título por cima. Um clip, um ecrã de filme: é a
     forma mais barata de ter um hero «uau»;
   - **C** sem filme: **mundo de camadas** (PNG recortados do cliente, ou SVG e gradientes como na demo);
   - **D** produto: fotos à volta dele / vista explodida / render 3D → fotogramas, ou peças soltas com `data-peca`.
4. **Construir a partir do `starter/`**: copiar a pasta, trocar a demo NORTE pelo cliente, apagar o `demo.js` se não
   houver `data-montes`/`data-portal`. Letras alojadas no site (woff2 + preload) em produção.
5. **Verificar** (antes de dizer que está feito): servir (`python -m http.server 8791`) e correr
   `python -I scripts/fotos.py http://127.0.0.1:8791/ fotos` (precisa de `pip install websocket-client`). Abrir
   `folha-desk.jpg` e `folha-tel.jpg`: nenhuma ponta de camada à vista, texto legível em cada paragem, nada vazio entre
   paragens, consola limpa e peso no `relatorio.txt`. Depois `--quieto`.
6. **Publicar**: GitHub Pages / Netlify (pasta estática), ou o tema Shopify. `noindex` enquanto for proposta.

## As peças (atributos do `scroll.js`)

| Quero | HTML |
|---|---|
| secção em que o scroll anda um filme | `<section class="cena" data-cena style="--ecras:8"><div class="palco">…</div></section>` (altura = (ecras+1) ecrãs) |
| filme de fotogramas | `<canvas data-fotogramas data-dir="frames/desk/" data-n="120" data-dir-tel="frames/tel/" data-n-tel="90">` (+ `data-foco`, `data-poster`) |
| câmara a voar por camadas | `<div class="mundo" data-viagem="7.4">` com camadas `<div class="camada" data-z="2.2" data-x="0" data-y=".25">`: a camada enche o tamanho do CSS quando a câmara está a 1 unidade dela; aparece ao longe (`data-longe`) e some-se ao passar (`data-perto`) |
| céu / fundo que troca devagar | `<div class="ceu" data-beat="fade" data-de=".36" data-ate=".78">` (lua e sol vão dentro do céu, não do mundo) |
| texto numa paragem | `<div class="beat" data-beat data-de=".13" data-ate=".3">` (entra a subir, sai a subir; `data-de="0"` já está visível) |
| produto que se desmonta / luz que acende | `<div data-peca data-de=".3" data-ate=".6" data-dy="-17" data-rot="-10">`, `data-op0="0" data-op="1" data-escala="1.25"`; para vários tempos, embrulhar |
| percentagem da cena / da página | `<span data-pct>` · `<span data-pct-pagina>` · `<b data-progresso-pagina>` (barra) |
| faixa infinita que acelera com o scroll | `<div class="faixa" data-faixa><div class="faixa__trilho">…</div></div>` (CSS `@keyframes faixa` de 0 a -50%; o JS duplica e mexe no `playbackRate`) |
| números que contam | `<span data-conta="98.6" data-casas="1">` |
| peças que caem uma a uma | `<ul data-cai>` (cada filho ganha `.caiu`; a queda é CSS com a curva `--salta`) |
| a cor da página muda | `data-cor="#ff5a1f" data-tinta="#1a0d07"` em cada secção |
| a viagem recomeça sem corte | `data-volta` na primeira `.cena` |

## Quero X → leio Y

| Quero | Leio |
|---|---|
| o que cada um dos três sites faz, ecrã a ecrã | `references/os-tres-videos.md` |
| fazer o filme: anúncios, IA com primeiro/último fotograma, ffmpeg, pesos | `references/filme.md` |
| encontrar a viagem para um ramo | `references/ideias-por-negocio.md` |
| pôr isto numa loja Shopify | `references/shopify.md` |
| ver tudo a funcionar | `starter/index.html` (serve a pasta e abre) |

## Erros que já custaram tempo

- **Camadas estreitas** mostram as pontas quando encolhem ao longe: serras com `--w: 300vmax` e chão por baixo
  (`::after` na cor do sopé). Altura em `vmax`, nunca em `%` (no telemóvel ficam espetos).
- **Lua e sol dentro do mundo** crescem como se a câmara chegasse lá: vão no `.ceu`.
- **`scroll-behavior: smooth`** faz o salto da volta animar: o motor usa `behavior: 'instant'`; quem escrever outro
  salto faz igual.
- **`<video>` com `currentTime` para o scrub** engasga (só salta para keyframes): fotogramas num canvas.
- **Demasiado filme pesa** (26 out, site Ten Fold): uma viagem 3D de 7 ecrãs com screenshots a voar, poeira e brilhos
  com `blur(60px)`, mais uma abertura em túnel de 2 s, foram recusadas pelo cliente: «очень тяжело». Ficou um hero
  estático leve (título, uma linha, dois botões, «Scroll down») e os projetos em cartões normais. Regra: o filme vive
  **num** ecrã (o hero), nada de abertura que prenda o scroll, nada de `filter: blur` grande nem `backdrop-filter` em
  elementos fixos, e uma indicação clara de que a página continua para baixo.
- **A cor da página muda enquanto o palco ainda está à vista**: o palco de produto leva fundo próprio.
- **Texto dentro dos fotogramas**: ilegível no telemóvel e invisível ao Google.
- **Faixa parada**: o CSS do `@keyframes` tem de estar carregado antes do `scroll.js` (`defer` depois do `<link>`).
- **Screenshots no topo**: o `--screenshot` do Chrome não faz scroll; usar `scripts/fotos.py`.

## Checklist de entrega

- [ ] Guião da viagem escrito (paragens com título, linha e intervalo) e ligado ao negócio.
- [ ] Hero legível no primeiro fotograma, no PC e no telemóvel.
- [ ] Filme (ou camadas) sem pontas, sem buracos, sem saltos; o telemóvel com filme/recorte próprio.
- [ ] Pelo menos três peças de prova (faixas, números, produto, peças que caem) com conteúdo real.
- [ ] Contacto/compra a um clique do fim da viagem; a volta (se ligada) depois do contacto.
- [ ] `fotos.py` no PC e no telemóvel: folhas vistas, consola sem erros, peso dentro dos limites; `--quieto` legível.
- [ ] `noindex` enquanto for proposta; lista do que falta pedir ao cliente.
