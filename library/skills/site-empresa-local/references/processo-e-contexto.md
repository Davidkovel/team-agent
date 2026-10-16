# Processo e contexto (resumo de `docs/CONTEXTO.md` e `docs/SESSAO-27-28-AGOSTO.md`)

Resumo do que o Tomás e o Claude dele decidiram e aprenderam a fazer o site da Blue Magnitude (26 a 31 de agosto de 2026). Tirei o que é só da máquina dele (caminhos pessoais, servidor, chaves, memórias locais).

## Como o trabalho correu

1. **Auditoria do site antigo** (752 linhas): fonte de todo o conteúdo. O site novo não inventa um número.
2. **Site novo de raiz** no sistema visual de outro site do Tomás, adaptado a claro e à marca do cliente.
3. **Rondas de revisão no iPhone dele**: cada ronda uma lista de alterações, todas aplicadas e verificadas a 390 e 1440 px. Foram 11 rondas.
4. **Publicado a cada passo**: `git push` republica o GitHub Pages. O cliente vê sempre a última versão num link.

O que o Tomás quer (útil para ti): faz **exatamente** a referência que ele manda (componente, captura), recolorida para a marca; não interpretes. Revê no iPhone, mobile a 390 px primeiro. Fazer bem à primeira e verificar com captura real antes de dizer "feito". Quando a tarefa é grande, paralelismo e execução, não perguntas.

## Regras da casa dos sites do Tomás

- Nada de travessão (`-`, `–`, `—`) a meio de frase em nenhum texto.
- Nada de: cápsula de prova social, numeração decorativa 01/02/03 em secções, par de botões primário + fantasma como muleta, glassmorphism, vocabulário de template. (Nota: o Detalhes Cautelosos usa números "01 — Obras" nos rótulos de secção; é outro site, outra regra.)
- Mobile a 390 px primeiro.
- Publicar é parte de acabar; não se pergunta.
- Nada de factos inventados: NIF, ano de fundação, equipa, números totais ficam em `perguntas-ao-cliente.md`, nunca no ecrã.
- O logótipo é do cliente e não se redesenha; só se anima por cima (traço, sol a nascer).
- Sem `backdrop-filter` na navbar do Blue Magnitude. Sem `tel:` em CTA de navegação.

## Regras técnicas que custaram bugs

- **Prefixo do GitHub Pages.** O Pages serve em subpasta (`/bluemagnitude/`). O `basePath` do Next só trata do que o Next gera. Tudo o que é caminho escrito à mão (`/video`, `/marca`, `/projetos`) tem de passar por `caminho()` (`src/lib/caminho.ts`, usa `NEXT_PUBLIC_BASE_PATH` inlined no build). `scripts/prefixar.mjs` reescreve `href`/`src`/`content` no HTML exportado, mas **só isso não chega**: a hidratação repõe os `href` do payload e deu 404 em todos os links do Pages até se prefixar na origem.
- **Componentes cliente.** Uma função (um ícone do lucide) não atravessa a fronteira servidor/cliente. Passa o ícone por nome (`icone: "sol"`) e resolve num mapa dentro do componente (`passos.tsx`).
- **Blend do hero com o resto.** A camada 2b do `video-backdrop.tsx` espelha, ancorada em `50% 100%`, o gradiente que `.campo-luz__luz` pinta no topo, com a mesma percentagem de verde (10%). Se um mudar sem o outro, aparece uma risca.
- **Vídeo do hero no iOS.** `<video>` com `opacity: 0` até `onPlaying`; 3 recusas de `play()` e fica o poster a respirar; tenta outra vez no primeiro toque e no `visibilitychange`. Duas versões anteriores com dois `<video>` a trocarem na fronteira do laço "fritavam o iPhone". Fica um laço nativo sobre um ficheiro bem codificado.
- **Codificação do vídeo.** H.264 High 8 bits, `yuv420p`, `+faststart`, keyframe por segundo, sem áudio. Master HEVC 10 bits não serve para web. `hero-lg.mp4` 1920x1080 CRF 21 (4,4 MB), `hero-vert.mp4` 720x1280 CRF 23 (1,3 MB). Para o vertical, recorte mais largo (`crop=800:1080:783:0`) assente sobre uma cópia desfocada do próprio fotograma, em vez de um recorte demasiado perto. No fecho do laço, a cabeça entra para a frente (invertida lia-se como marcha atrás nos primeiros instantes).
- **Rodapé é o fim do documento.** `overscroll-behavior-y: none` e `overflow-x: clip` em `html` e `body`. Passa no Chrome e o defeito continua no iPhone: o elástico do iOS é que mostrava meio ecrã vazio. `clip` e nunca `hidden` (o `hidden` cria contexto de scroll; no Mac o trackpad engata nele e morre o scroll).
- **Tailwind 4.** `--color-x` em `@theme` vira `var(--color-x)`, nunca `var(--x)`.
- **Parser TypeScript.** Um `{cond ? (<elemento/>) : (<elemento/>)}` dentro de um `<svg>` em `.tsx` foi lido como objeto literal. Calcula o elemento numa constante antes do `return`.
- **Editar `site.ts` por script.** Cortar por `index()` de uma string que existe em dois blocos apaga o que está pelo meio. Ficheiros gerados por script não se editam à mão (o JSON da fita foi reescrito sem a cor e o build parou).
- **Regex em keyframes.** O `}` interior dos frames faz o regex parar cedo e deixa caudas órfãs que partem o build.
- **Imagem de pré-visualização com base64.** Uma prévia com base64 embebido não reflete o ficheiro regenerado: verificaste uma versão antiga.
- **Instagram.** Exige sessão para descarregar reels (`yt-dlp --cookies-from-browser chrome` com a sessão do dono). No site vão os primeiros 20 s de cada, 720x1280, H.264 CRF 26, AAC 96k (~19 MB os cinco). Antes de haver vídeo, cada cartão aponta para o reel real.

## Armadilhas de CSS e interação (lista completa da sessão de 27 e 28 de agosto)

1. Ordem da cascata: regra base depois da media query ganha-lhe.
2. `transition` em atalho apaga o que estava.
3. `<img height: 100%>` em caixa sem altura: Safari ≠ Chrome. Usa `aspect-ratio`.
4. iOS: `pointermove` + `transform` nunca cola ao dedo. Scroll nativo.
5. `background-size: auto 120%` repete a imagem. `<img>` com `object-fit: cover`.
6. Instagram pede sessão iniciada.
7. Separar a fita dos cartões só resultou por forma (casco convexo do que é chapa).
8. Alisar uma curva desloca-a (spline com folga 6 000 000: 56 px de desvio; com 5 000: ~5 px).
9. JSX com ternário dentro de `<svg>`.
10. Cortar `site.ts` por `index()` repetido.
11. `prefers-reduced-motion` zera as durações; animações em ciclo precisam de regra que reponha o estado final.
12. Ficheiro gerado por script não se edita à mão.
13. Prévia com base64 desatualizada.

## Decisões de design que valem para outros negócios

- **Formulário em 3 passos** substituiu o formulário de 6 campos numa chapa ("um ecrã cheio de caixas vazias antes de se perceber o que está a ser perguntado"). Cada ecrã faz uma pergunta. Ver o código em `assets/bluemagnitude/src/components/contacto-form.tsx`.
- **O CTA de fim de página** leva a `/contacto/` ("Pedir proposta"), não a uma conversa genérica de WhatsApp: um pedido preenchido vale mais do que um "olá" solto. Não repetir o CTA no fim de cada página e logo a seguir no rodapé: saiu o repetido.
- **Rodapé curto.** Morada, email, telefone e horário vivem só na página de contactos (com mapa e formulário). No rodapé: marca, redes, botão "Contactos" e linha legal. O CTA fica **fora** da chapa escura, senão lê-se como o princípio do rodapé.
- **Cabeçalhos mais limpos.** Saiu o parágrafo por baixo do título do hero, o rótulo e os parágrafos de "Quem somos" (a lista de pilares subiu para o lugar deles), o parágrafo do Sobre. O texto de apoio que existe no `site.ts` e já não tem consumidor fica lá.
- **Entradas rápidas.** 800 ms de translação lia-se como site lento. Passou a 420 ms, com meio rem e escala `.985`, escalonamentos de 45 a 60 ms.
- **Lista com gota de luz** em vez de "certos verdes", e **passos com linha que se desenha** em vez de cartões com fundo.
- **Fotografia dos painéis em `<img>`** e não em `background-image` (aparecia triplicada em telemóvel).
- **Cartões sem sombra** por decisão do Tomás; a profundidade vem de luz e linha.
- **Vídeo do hero**: cena planeada com o cliente (drone baixo a seguir a carrinha com o logótipo, sobe a fachada, revela os instaladores no telhado). Fotos de início e fim geradas com um modelo de imagem com o logótipo do cliente como referência, vídeo gerado depois com essas duas imagens. O Tomás só quer reproduções de referências ou fotos reais do cliente, não fotos inventadas.
- **Marca a nascer.** O logótipo do cliente nunca é redesenhado. A animação (sol que nasce atrás do ícone) é um WebP animado com alfa, num `<picture>` com `<source media="(prefers-reduced-motion: reduce)">` e um PNG parado. Dois `<img>` escondidos por CSS acabaram sobrepostos com cache. O chão do alfa é 0,07 e não zero (o "branco" do H.264 anda em 250 a 253) e o alfa guarda-se em 8 níveis (346 KB em vez de 741 KB).

## Como se verifica (o método que funcionou)

- **O visor**: um `out/_visor.html` temporário com um `<iframe>` do tamanho pedido e parâmetros `?u=&w=&h=&y=&shown=1&sel=&t=`. `shown` marca todos os `.reveal` como revelados; `t` pausa as animações de um seletor num instante exato. Vive em `out/` (no `.gitignore`) e apaga-se no fim. O Chrome headless sozinho não chega, porque o hero é `100svh` e as âncoras não param onde é preciso.
- **Arrasto**: eventos sintéticos de ponteiro, a confirmar que o deslocamento do dedo e o da fita são o mesmo número no mesmo evento.
- **Medir, não ver**: sobreposição da máscara abaixo de ~80% ou desvio vertical acima de ~10 px é defeito.

## Estado do projeto a 31 de agosto

Feito, verificado a 390 e 1440 px, no git, no Pages e no servidor do Tomás. Pendente: registo A do subdomínio (DNS primeiro, vhost depois), vídeos dos reels pelo cliente, e as perguntas ao cliente (NIF, nome legal, ano, equipa, números, testemunhos, certificações).
