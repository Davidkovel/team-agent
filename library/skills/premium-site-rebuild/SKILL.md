---
name: premium-site-rebuild
description: Reconstrói de raiz o site fraco/antigo de uma empresa num site premium, editorial, de nível "prémio" (o padrão do site De Antonio Yachts feito por tomas476), em HTML + CSS + JS vanilla sem build, publicado em GitHub Pages. O método: ler o site velho todo, encontrar UMA ideia-assinatura nascida do negócio (no De Antonio o iate desce pela página atrás do scroll e atraca em Barcelona), um sistema de uma letra + três durações + uma curva, um motor de movimento de um só laço rAF sem layout forçado, abertura com o logótipo a voar para o cabeçalho, vídeo de hero robusto no iPhone, telemóvel com composição própria, formulário-viagem sem backend, e verificação por screenshots. USE THIS SKILL quando pedirem "reconstruir/refazer/redesenhar o site", "site premium", "site de luxo", "site como o da De Antonio", "site que impressione milionários/clientes ricos", "proposta de redesign para um cliente", "переделать сайт", "полностью реконструировать сайт", "премиальный сайт", "сделать сайт лучше", ou quando receberem o link de um site antigo para melhorar. Serve também para auditar um site já feito neste molde.
---

# Reconstrução premium de um site (método De Antonio)

## O que é

Pegar no site de uma empresa que hoje parece genérico e entregar um site que um cliente com dinheiro
abre e pensa "esta gente é do meu nível". Não é um tema nem um template: é um método, destilado do
site `tomas476.github.io/deantonio` (código em `assets/reference/deantonio/`, anatomia em
`references/anatomy-deantonio.md`). O resultado é uma pasta estática que abre em GitHub Pages.

O que faz a diferença não é ter "muitas animações". É:

- **uma ideia-assinatura** que só podia ser desta empresa (o iate que atravessa a página e atraca
  no mapa de Barcelona; os motores escondidos revelados por um raio X que corre com o scroll);
- **calma**: muito espaço, uma letra, poucas cores, fotografia grande, frases curtas;
- **movimento perfeito**: 60 fps no telemóvel, nada salta, nada espera, tudo tem a mesma curva;
- **provas**: números, prémios, clientes, casos, com fonte real;
- **um caminho claro para o contacto**, com um formulário que é uma pequena viagem e acaba num
  email/WhatsApp já escrito.

## Regras não negociáveis

1. **Uma ideia-assinatura, transposta, nunca copiada.** Nunca pôr um barco num site que não é de
   barcos. Pergunta: "qual é o objecto, gesto ou percurso que resume esta empresa?" e faz esse
   objecto viver com o scroll. Ver `references/signature-ideas.md`.
2. **Uma família de letra** (variável, com eixo de peso e de largura; ex. Archivo, Inter Tight,
   Fraunces só se a marca for clássica), alojada no site em woff2 com `preload`. Escala fluida com
   `clamp()` em 7 degraus. Títulos grandes e apertados, texto corrido curto.
3. **Paleta de 3 famílias + 1 material**: um fundo profundo (o "mar"), um claro quente (a
   "espuma"), um cinzento de névoa, e um único acento material (a "teca"). Nada de azul elétrico
   genérico, nada de gradientes arco-íris. Usar as cores da marca do cliente quando existem.
4. **Uma curva e três durações**: `--curva: cubic-bezier(.16,1,.3,1)`, `--t-toque: 200ms`,
   `--t-entra: 700ms`, `--t-cena: 1200ms`. Todos os tempos (CSS e JS) derivam destes tokens.
5. **Só `transform`, `opacity` e `clip-path` mexem.** Um só laço `requestAnimationFrame` com fase
   de leitura (`aLer`) e fase de escrita (`aCada`); caixas medidas em lote e guardadas; nunca
   `getBoundingClientRect` dentro do laço; escrever no DOM só quando o valor muda. Ver
   `references/motion-engine.md`.
6. **Telemóvel tem composição própria**: uma ideia por ecrã, nada do desktop encolhido. O que se
   toca fica ao alcance do polegar. Testar a 390 px.
7. **`prefers-reduced-motion: reduce`** = tudo no estado final, sem nada à espera de entrar.
8. **Conteúdo verdadeiro do cliente.** Nunca inventar números, prémios, clientes, citações,
   moradas. Reescrever para ficar claro e curto, sim; inventar factos, não. O que faltar
   (fotografias próprias, números) fica numa lista para o cliente.
9. **Sem build, sem framework, sem CDN em produção**: HTML + CSS + JS vanilla; bibliotecas
   pesadas (three.js) copiadas para `vendor/` e carregadas só quando o scroll pára perto delas.
11. **Três segundos de atenção por ecrã.** Cada ecrã começa por algo para ver (vídeo, fotografia, o objecto da
    assinatura), depois um título curto e, no máximo, uma linha. Hero = vídeo de margem a margem montado com cortes
    de 1,5–2,5 s a partir das filmagens do próprio cliente. Nada de secções fixadas que obrigam a rolar ecrãs a fio;
    o detalhe vai para blocos que se abrem ou para as páginas interiores. Medir a altura no telemóvel (≈ 10–12 ecrãs
    para uma home). Pergunta de controlo: «um cliente rico pagaria 100 000 € por isto?».
12. **Composição, não coluna**: âncoras alternadas (nunca dois blocos seguidos na mesma margem), título e frase lado
    a lado, media fora do eixo ou a sair da margem, um ou dois momentos de ecrã inteiro a meio, números enormes em
    contorno por trás das imagens, ar entre blocos.
13. **Nada que se abra, nada numerado.** Sem acordeões com «+», sem `<details>`, sem separadores, sem cartões
    01–04 (parecem baratos e repetem-se de página em página). O texto mostra-se em formas que se vêem: linhas
    riscadas, índice com pré-visualização, uma linha de palavras para o método, cartões de fotografia para os casos
    (ver `references/case-ferreras.md`, terceira volta). Cada facto aparece uma vez no site.
14. **Nitidez de relógio.** Vídeo do hero a 1080 sem ampliar nada (dípticos de painéis verticais nativos,
    `assets/starter/showreel2.py`), fotos reexportadas dos originais a q90 (`assets/starter/imagens.py`) e `sizes`
    calculado depois do `object-fit:cover`. Media 9:16 mede-se pela altura do ecrã, nunca pela largura.
10. **Proposta, não impostura**: enquanto não for o site oficial, `<meta name="robots"
    content="noindex, nofollow">`, `robots.txt` com `Disallow: /` e os contactos a apontar para
    os contactos reais da empresa. Nunca recolher dados em nome de outra empresa.

## Workflow

### Fase 0 — ler o site velho inteiro (antes de desenhar)

- Descarregar todas as páginas (menu + rodapé + sitemap) e extrair para `content.md`: por página,
  títulos, textos, botões, FAQ, contactos, dados legais. Script: `scripts/extract_text.py`.
- Inventário de media: logótipos (versões clara/escura), fotografias e vídeos com o tamanho maior
  disponível (em Next.js, `/_next/image?url=...&w=1920` dá a maior). Guardar os originais.
- Marca: cores do CSS (`:root`), letras usadas, tom de voz.
- Screenshots do site velho (desktop 1440 e telemóvel 390) para comparar no fim.

### Fase 1 — diagnóstico e conceito

- 5–10 linhas: o que está fraco (ex. hero escuro e vazio, cartões genéricos, texto de agência,
  sem provas visíveis, sem fotografia, intro que esconde o conteúdo).
- Para quem é (o cliente rico: quer calma, prova e discrição; detesta ruído e jargão).
- **A ideia-assinatura** (1 frase) e como ela atravessa a home do topo ao contacto.
- Mapa de páginas e o ritmo da home, ecrã a ecrã (hero → manifesto → prova → serviço → caso →
  pessoas → contacto). Cada secção tem uma razão para existir; cortar o que repete.

### Fase 2 — sistema

Tokens em `:root` (ver `references/design-system.md`): cores, letra, escala, gutter `--g`,
curva, durações, raios. Componentes: botão em pílula, cabeçalho em `mix-blend-mode: difference`
(lê-se sobre fotografia e sobre fundo claro), barra de contacto fixa que pousa em cima do rodapé,
menu de ecrã inteiro no telemóvel.

### Fase 3 — construção

```
index.html            uma página longa (a home) com as secções
<pagina>/index.html   páginas próprias (serviços, sectores, casos, contacto) com o mesmo shell
estilo.css            um só ficheiro, organizado por secções com comentários (00-base, 10-hero, ...)
js/00-core.js         o motor (laço único, caixas, prog, quieto, ocioso)
js/NN-<secção>.js     um ficheiro por secção, cada um regista-se no núcleo
img/  media/  fonts/  vendor/  og/
favicon.svg  robots.txt  sitemap.xml  .nojekyll
```

- Imagens: webp (ou avif) em 2–3 larguras (`-900`, `-1600`, `-2400`) com `srcset`/`sizes`,
  `width`/`height` sempre, `loading="lazy"` fora do primeiro ecrã, `decode()` pedido a ecrã e meio.
- Vídeo: mp4 720 e 1080 + vertical para telemóvel ao alto, `poster` webp, `muted playsinline`,
  toca só à vista; se o browser recusar, o poster ganha Ken Burns lento.
- `<head>` completo: title, description, canonical, theme-color, OG 1200x630 (absoluto),
  twitter card, favicon svg, preload da letra, JSON-LD `Organization` com dados reais.
- Acessibilidade: `lang`, saltar para o conteúdo, foco visível, tabs com `role`/`aria`,
  painéis escondidos com `inert`, teclado nos carrosséis, contraste AA.

### Fase 4 — movimento

Motor + receitas em `references/motion-engine.md`: abertura do logótipo, parallax do hero
(com `animation-timeline: scroll()` onde existe), entradas por linha, texto em duas tintas que
se acende palavra a palavra, janelas que abrem (`clip-path: inset()` com `--j`), números que
contam, imagens que seguem o rato, carrossel com arrasto/teclado/ecrã inteiro, a assinatura.

### Fase 5 — verificação (antes de dizer que está feito)

- Servir por HTTP local (`python -m http.server`) e tirar screenshots com Chrome headless em
  1440x900 e 390x844, em vários pontos do scroll (ver `scripts/shots.md`).
- Consola sem erros; nenhum link partido; nenhuma imagem sem `width`/`height`; peso da home
  (sem vídeo) abaixo de ~2,5 MB; LCP abaixo de 2,5 s numa ligação boa.
- Reduced motion ligado: tudo visível.
- Comparar lado a lado com o site velho: tem de ser óbvio, à primeira vista, que é outro nível.

### Fase 6 — publicação

GitHub Pages: repositório público, `.nojekyll`, Pages a partir de `main` / raiz
(`gh api repos/<dono>/<repo>/pages -X POST -f "source[branch]=main" -f "source[path]=/"`).
Todos os caminhos relativos (o site vive em `/<repo>/`). Confirmar o URL ao vivo com screenshot.

## Quero X → leio Y

| Quero | Leio |
|---|---|
| perceber o que o site De Antonio faz, secção a secção | `references/anatomy-deantonio.md` |
| o motor de scroll, entradas, hero, abertura, carrossel, 3D | `references/motion-engine.md` |
| tokens, letra, cor, botões, cabeçalho, rodapé, telemóvel | `references/design-system.md` |
| compor a página como o De Antonio: margens que rodam, assimetria, ar, ecrãs inteiros (medidas reais) | `references/composition-rhythm.md` |
| encontrar a ideia-assinatura para outro negócio | `references/signature-ideas.md` |
| ver o código verdadeiro de uma técnica | `assets/reference/deantonio/js/*.js`, `estilo.css` |
| um caso completo feito com este método (Ferreras, «Las 24 horas») e as armadilhas | `references/case-ferreras.md`, `assets/starter/` |

## Checklist de entrega

- [ ] Todo o conteúdo do site velho está no novo (ou cortado de propósito, com motivo).
- [ ] Uma ideia-assinatura, própria deste negócio, visível do hero ao contacto.
- [ ] Composição em ritmo, medida: nenhum par de blocos seguidos na mesma margem, título e texto
      lado a lado, mídia fora do eixo, 300–400 px de ar, dois ecrãs inteiros (`references/composition-rhythm.md`).
- [ ] Um token de curva e três de duração; nenhuma animação com outra curva.
- [ ] 60 fps no scroll; nenhum `getBoundingClientRect` no laço; nada salta quando as imagens chegam.
- [ ] Telemóvel com composição própria, testado a 390 px; nada passa da largura do ecrã.
- [ ] Reduced motion testado.
- [ ] Imagens com srcset, width/height, lazy; vídeo com poster e fallback.
- [ ] OG card, favicon, JSON-LD, title/description por página.
- [ ] Contactos reais; formulário que abre email/WhatsApp já preenchido; sem recolha de dados.
- [ ] `noindex` + `robots.txt` enquanto for proposta.
- [ ] Screenshots desktop e telemóvel do resultado ao vivo, lado a lado com o site velho.
- [ ] Lista para o cliente: o que falta (fotografias próprias, números, textos legais).
