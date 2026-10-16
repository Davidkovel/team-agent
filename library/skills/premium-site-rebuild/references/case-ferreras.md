# Caso feito: IA & Marketing Ferreras (16 out 2026)

Site antigo: marketingferreras.com (Next.js, 18 páginas, escuro e genérico: um ponto azul a brilhar no hero, cartões).
Novo: pasta `C:\Users\David\ferreras-web` (gerada por `_fonte/build.py` + `_fonte/paginas.py`), 19 páginas, GitHub
Pages `davidkovel.github.io/ferreras/`. Usar como exemplo completo do método.

## A assinatura: «Las 24 horas»

O negócio: agência de marketing de luxo + departamento de IA, em Barcelona, com marca própria de relógios
(Relojes Ferreras). Objecto = o relógio deles; percurso = um dia da empresa do cliente; fim = o diagnóstico.

- O relógio (a esfera verdadeira, fotografada, endireitada 22,5° e recortada em círculo) nasce grande no hero e voa
  com o scroll para o canto inferior esquerdo (HUD), onde fica o resto da página. Só `transform` num elemento fixo.
- Cada secção tem `data-hora="HH:MM"` e `data-momento="…"`; a linha de leitura (58% do ecrã) interpola a hora entre
  as marcas e os ponteiros perseguem-na com inércia (`cur += (alvo-cur)*(1-exp(-dt/150))`). O segundeiro é uma
  animação CSS (sem escritas por fotograma). Horas que passam da meia-noite somam 1440.
- Dia/noite: duas camadas fixas de fundo, só muda a opacidade; o acento muda uma vez por classe (`es-noche`):
  oro de dia (marketing), azul-sinal do logótipo de noite (IA).
- O «coração aberto» da esfera foi recortado (transparente) e por baixo gira um disco dia/noite (sol / quadrado azul
  e estrelas): uma complicação de relojoaria verdadeira a contar a história.
- 23:40: secção fixada de 340svh onde a conversa (guião real do site antigo, em alemão) aparece mensagem a mensagem
  com o scroll; no «Fuera de alcance autorizado» acende o traspaso a recepção.
- 07:30 do dia seguinte: secção em marfil com o diagnóstico (o logótipo da cabeçalho passa a tinta por cima dela).
- Páginas interiores: o mesmo relógio, compacto, com a hora real de Barcelona.

## Secções da home (ritmo)

hero 07:30 · reto 08:30 (texto em duas tintas) · departamento 09:15 (foto em janela) · las dos mitades 10:00 (raio X
dia/noite entre um yate e uma recepção de hotel) · produção 11:30 (pista horizontal fixada com fotos e reels de
Instagram) · marca própria 13:00 · sectores 16:00 (painéis que se alargam) · alcance 19:30 (números que contam) ·
incluye todo 20:30 · anochece 22:00 · consulta 23:40 · control 03:00 · equipo 06:45 · método 07:00 · FAQ 07:15 ·
final 07:30.

## O que se aprendeu (não repetir)

- **Ler o conteúdo escondido do Next.js**: separadores e listas vêm no payload RSC (`self.__next_f.push([1,"…"])`);
  juntar as strings com `json.loads('"'+p+'"')` e procurar `"items"`. Lógica de formulários/diagnóstico está nos
  chunks `/_next/static/chunks/app/<página>/page-*.js` (descodificar `\xNN` e `\uNNNN`).
- Imagens do Next: `/media/x.avif` é o original; converter com PIL (tem AVIF) para webp 900/1600.
- Logótipo só em PNG: vectorizar com OpenCV (máscara por cor, upscale 8x, `findContours` + `approxPolyDP`) dá SVG
  limpo; separar as letras por colunas de x para animar a abertura.
- **Grelha no telemóvel**: um filho com `grid-column:8/13` do desktop num grid de 1 coluna cria colunas implícitas e
  espreme tudo (página com 433 px num ecrã de 390). Repor `grid-column:1` em TODOS os filhos no breakpoint.
- Legenda do HUD com troca cruzada: num scroll rápido cruzam-se várias marcas em menos de uma transição; marcar
  como a sair todos os `span:not(.sai)`, não só o primeiro.
- `@property --x/--j` com `inherits:false` não chega aos filhos (`img` dentro da janela): usar `inherits:true`.
- A pista horizontal: medir `scrollWidth - janela.clientWidth` com a pista dentro de uma janela `overflow:hidden`
  com máscara em degradé à esquerda; senão as fotos passam por baixo do título.
- Python 3.11: nenhuma expressão de f-string com barra invertida; aspas internas diferentes das externas.
- Chrome headless por CDP: `--remote-allow-origins=*`; se ficou um Chrome preso na porta, usar outra porta.
  Num `file://` as imagens podem não aparecer no screenshot: servir por HTTP.
- **Publicar**: criar um repositório público novo foi bloqueado pelo classificador do modo automático. Deixar um
  `_fonte/publicar.sh` (cria o repo pela API com a credencial do git, push, liga o Pages) e pedir à pessoa para o
  correr com `! bash …/publicar.sh`.

## Ficheiros úteis para copiar

`assets/starter/` tem o motor (00-nucleo.js), as receitas comuns (20-comuns.js), o relógio-assinatura
(30-reloj.js) e as cenas (40-escenas.js: raio X, pista fixada, conversa por scroll) deste caso.

## Segunda volta (o mesmo dia): «três segundos de atenção»

O cliente (David) olhou para a primeira versão como o dono da Ferreras e recusou-a: demasiado texto, demasiado scroll
no telemóvel (27 100 px), duas cenas fixadas de 3–4 ecrãs cada, e uma demo de chat com dados inventados (de outra
sessão) que não estava no site antigo. O que mudou:

- **Hero = showreel**: `_fonte/showreel.py` monta com ffmpeg (o do `imageio_ffmpeg`) cortes de 1,4–2,4 s dos vídeos
  originais do Instagram (estilo de vida + relógio, TN Autosport GT3 RS, CarDress): versão 16:9 (faixa central dos
  verticais, só de fontes 1080) e versão vertical para o telemóvel; cartaz `<picture>` por baixo, vídeo por cima.
  Escolher os planos olhando para folhas de fotogramas com o tempo escrito (`fps=1/2.5,drawtext,tile`).
- **Interlúdio de ecrã inteiro**: três clips verticais lado a lado num só ficheiro (`hstack`, 3×540×960), sem
  reescalar; no telemóvel um só clip.
- **O relógio passou para a cabeçalho** (sem voo); uma esfera grande e viva na secção da marca marca a mesma hora.
  O céu do coração aberto é um `conic-gradient` com sol, lua e estrelas que roda com o dia.
- **Raio X dia/noite do mesmo iate**: a versão de noite foi feita da fotografia de dia (luz linear, menos exposição,
  azul, luzes quentes nas janelas). Mesmo enquadramento = a metáfora lê-se num segundo.
- **24 h numa esfera** (SVG gerado em Python, pontos com semente fixa): as consultas de um dia, quadrados azuis com a
  recepção fechada; a varredura desenha-se uma vez quando entra no ecrã. Substituiu a conversa por scroll.
- **Composição à De Antonio** (medida noutra sessão e adaptada): título à esquerda e frase à direita mais abaixo,
  carril a partir de 16 % a sair pela direita, raio X de margem a margem, painéis dos sectores em escada, «100» e
  «BCN» em contorno por trás do vídeo e do relógio (factos confirmados nos vídeos e no site; «18 quilates» não se
  confirmou e ficou de fora), cartão largo do director a sair pela direita, números 4 · 20+ · 24 h · 1 dia.
- **Casos em `<details>`** com fotografia: o detalhe abre-se, não se rola.
- Resultado: home 22 800 → 11 900 px no computador, 27 100 → 11 200 px no telemóvel; páginas interiores −40 a −50 %.

Armadilhas desta volta:
- Um quadrado rodado (o disco do céu) faz overflow horizontal no telemóvel: `.reloj{overflow:hidden;contain:paint}`
  e a sombra (`drop-shadow`) passa para o contentor.
- `font` em `.bloco span` apanhou os `span` dos contadores dentro do `<b>`: usar `>span`.
- No script de screenshots, separar passos com `;;` (o JS tem vírgulas e `||`); porta aleatória e `taskkill /T` no fim,
  senão ficam Chromes headless presos na porta.
- «Pide su» mistura tú e usted: em «usted» é «Pida su diagnóstico».

## Terceira volta (16 out 2026): «nítido como um relógio» e nada que se abra

O cliente voltou a olhar como dono e pediu: vídeo do hero nítido (1080, «caro como o relógio»), uma abertura como a
do De Antonio mas com um carro, tirar o bloco do director («não se percebe, parece barato»), menos texto nas páginas
interiores, **nenhum acordeão com «+»**, **nenhum cartão numerado 01–04** (repetia-se em três páginas) e fotos menos
«barradas». O que se fez:

- **Hero em díptico nativo** (`_fonte/showreel2.py`): os reels são verticais 1080x1920; uma faixa 16:9 deles tem
  1080x607 e teria de ser ampliada 1,8x. Dois painéis verticais de 960x1080 lado a lado enchem 1920x1080 sem ampliar
  nada; cada coluna corta ao seu ritmo. Saídas `-1080/-720` (díptico) e `-v1080/-v720` (telemóvel); o JS escolhe por
  `innerWidth*devicePixelRatio` (> 1440 no computador, > 800 no telemóvel) e respeita `saveData`. Três montagens
  diferentes (home, marketing, automoção) para não repetir o mesmo filme. Fora os planos com legendas queimadas e
  os cartões brancos de logótipo no fim dos reels (ver folhas de fotogramas antes).
- **Abertura «estela de faros»**: sobre o vídeo, uma linha de luz cruza o ecrã com a curva de um carro a arrancar e a
  travar; cada letra do logótipo nasce quando a cabeça passa por baixo (atraso = inversa da mesma cubic-bezier, em
  JS); depois o FLIP para a cabeçalho. **Sem bloquear o scroll**: qualquer gesto (wheel/touch/tecla) termina-a; não
  corre se a página abriu a meio (voltar atrás) ou com #âncora; nunca mexer em `history.scrollRestoration`.
- **Componentes que substituem texto escondido**: problemas = linhas grandes **riscadas a ouro** quando entram;
  «qué incluye» = **índice** de uma linha por serviço com a imagem/vídeo do activo numa janela sticky (só o vídeo
  activo descarrega e toca; no telemóvel miniatura por linha); método = **uma linha de palavras** ligadas por um
  traço que se desenha; casos = **cartões de fotografia** com sector, título e resultado numa linha (nada abre;
  no telemóvel carrossel 80vw); capacidades = duas colunas de título + meia linha. Sem números de secção.
- **Fotos nítidas** (`_fonte/imagens.py`): reexportar dos AVIF originais a q90 + máscara de nitidez leve (o segundo
  passo a q80 somava artefactos). E o erro principal era o `sizes`: um painel alto que corta uma foto larga precisa
  da largura *depois do cover* (altura × proporção), não da largura do painel — com `45vw` o browser escolhia a de
  900 e ampliava. Para painéis cover: `sizes="(min-width: 900px) 1600px, 100vw"`. Tirar véus `saturate/brightness`.
- **Carril de reels medido pela altura** (`height:min(66svh,640px);aspect-ratio:9/16;width:auto`): num portátil de
  744 px de altura os 9:16 medidos pela largura passavam do ecrã e o vídeo via-se «a meio».
- **Itálicas cortadas** pela máscara das linhas: dar padding lateral e inferior ao `.l` (com margem negativa igual).
- Voltar atrás: `pageshow` com `persisted` volta a dar play aos vídeos.
- Resultado: marketing 4 250 px (≈ 5,7 ecrãs), IA 4 850, sectores 2 350, home 8 800 no computador.
