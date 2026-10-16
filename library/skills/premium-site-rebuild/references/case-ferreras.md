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
