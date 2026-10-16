# Anatomia do site De Antonio Yachts (tomas476.github.io/deantonio)

O site de referência. Código completo em `assets/reference/deantonio/` (index.html, estilo.css,
js/). Ler para perceber o nível; nunca copiar textos, imagens ou a ideia do barco para outro
negócio.

**Conceito numa frase:** "A travessia" — o D60 visto de cima sai do cais ao lado do primeiro título,
desce pela página inteira atrás do scroll, mergulha por baixo das fotografias, deixa esteira de
espuma, e atraca em Barcelona no mapa dos dealers, onde as rotas para 39 países se acendem.

**Sistema:** uma letra (Archivo variável, eixo de peso 100–900 e de largura 62–125%, alojada em
`fonts/`); cores `--mar #06111b` (3 tons), `--espuma #f3efe6` (2 tons), `--nevoa #8fa1b0`,
`--teca #caa57b` (2 tons), `--tinta #0b1620`; uma curva `cubic-bezier(.16,1,.3,1)`; durações
200/700/1200 ms; gutter `clamp(16px,4vw,56px)`; escala `--f-xxl … --f-mi` com `clamp()`.
`color-scheme: dark`. Ficheiros JS numerados por secção, todos registados num núcleo (`window.DA`).

## Ecrã a ecrã (home)

1. **Cabeçalho** (`.topo`): links à esquerda (Range, D60, Dealers), logótipo ao centro, pílula
   clara "Request a quote" à direita. Branco em `mix-blend-mode: difference`, por isso lê-se sobre
   o mar e sobre o fundo claro; por cima do hero fica em modo normal (o logótipo que voou e o do
   cabeçalho têm de ser o mesmo branco, píxel a píxel). O botão do cabeçalho vive numa camada
   própria, fora da mistura, para ficar sólido.
2. **Hero** (`[data-hero]`): um ecrã inteiro, filme do iate ao pôr do sol que funde no azul da
   página. Fontes de vídeo por dispositivo (vertical no telemóvel ao alto, 720 e 1080), cartaz
   webp por baixo com Ken Burns se o vídeo não tocar (Poupança de energia no iPhone). **Abertura:**
   uma "linha de água" risca o ecrã, as letras do logótipo emergem uma a uma quando a cabeça da
   esteira passa por baixo delas (atraso calculado pela mesma curva), e o logótipo voa (FLIP:
   `translate3d + scale`) para o seu lugar no cabeçalho. O scroll fica preso só durante a
   abertura (garantia de 6 s). Título "From Barcelona to the world." sobe e desvanece ao sair
   (`--q` de 0 a 1 em 70% de um ecrã; parallax no compositor com `animation-timeline: scroll()`).
3. **Motores escondidos** (`.motores`): a primeira ideia técnica da marca. Um **raio X**: duas
   imagens do mesmo casco (com e sem a plataforma) e uma linha que o scroll leva de 95% a 5%;
   também se arrasta, se clica e anda com as setas. O iate atraca aqui, ao lado do título.
4. **A gama à escala** (`.gama`): "The range, to scale." As 7 silhuetas sobre a mesma linha de
   água, à escala real, com uma régua honesta de 20 m. Tocar escolhe; a ficha em brochura abre
   ao lado (fotografia, marca do modelo em contorno que se desenha, especificações, galeria
   exterior/convés/interior, variantes Open/Cabin/Coupé trocadas no sítio, acabamentos oficiais
   com amostras). Tabs acessíveis (`role="tabpanel"`, `inert`). No telemóvel: lista com nome à
   esquerda e silhueta à direita, e só a ficha escolhida ocupa lugar (altura animada).
5. **Porta** (`.porta-m`): no telemóvel, cada bloco grande vira uma "porta" que leva à página
   própria (/models/, /awards/, /dealers/, /quote/) — o telemóvel não carrega a home inteira.
6. **D60** (o topo de gama): uma janela que abre com o scroll (`clip-path: inset()` com `--j`), o
   logótipo do D60 em contorno sobe da linha de água como um casco, e o interior num carrossel
   (setas, arrasto com rato, deslizar no toque com scroll-snap, trackpad, teclado, ecrã inteiro).
7. **Prémios**: "European Powerboat of the Year. Twice." Os dois troféus lado a lado numa faixa e
   as outras honras numa grelha densa, cada selo oficial numa placa clara (para os selos de letra
   escura se lerem). Os anos contam.
8. **Aventura**: filme de ecrã inteiro que só toca à vista; o título assenta onde a imagem se
   dissolve no mar (máscara em degradé).
9. **Mundo**: mapa SVG com Barcelona e 39 países; quando o iate atraca, as rotas desenham-se de
   Barcelona para fora (cada arco mede 1, `stroke-dashoffset` de 1 a 0). Procurar o dealer por
   país: o ponto ganha um anel e a rota acende, as outras recuam. Dealers sem contacto juntam-se
   num só cartão com um pedido de apresentação a Barcelona.
10. **Proposta** ("Request a quote"), em fundo claro (a "cal"): uma viagem em **três boias**
    (Which De Antonio is yours? → How will you use her? → Where shall we reach you?) sobre uma rota
    onde o D60 visto de cima é o marcador do passo. Ao lado, **a placa do estaleiro** regista cada
    escolha (iate, uso, quando, país, dealer) e cada linha abre ali o seletor nativo. Validação
    com mensagem junto do campo. Envio = `mailto:` para vendas com cópia para o dealer, texto
    pronto. "Thank you." com a placa selada (animação de gravação).
11. **Rodapé**: navegação, redes, contactos, voltar ao topo (único scroll suave; o foco volta ao
    início do conteúdo). A barra de contacto fixa (aparece depois de 70% do primeiro ecrã)
    pousa em cima do rodapé (`--sobe`) e recolhe-se enquanto o formulário está à vista.

## Páginas próprias

- `/models/`: a doca (todas as versões), ficha de cada versão, galeria com contador e linha de
  progresso, e **"Build yours"**: visor 3D próprio (three r160 local, `vendor/three-r160.js`, GLB
  de 5–6 MB) para D60 e E23 — luz de fim de tarde, ambiente PMREM, sombra de contacto radial,
  roda do rato desce a página e só Ctrl/pinça aproxima, cores de casco/teca/estofos trocáveis;
  tudo nasce quando o scroll pára perto. Para os outros modelos, o configurador oficial num iframe.
- `/awards/`, `/dealers/`, `/quote/`: as mesmas secções como páginas, para o telemóvel.

## Detalhes que fazem o nível

- Cada carregamento começa no topo e repete a abertura (mesmo com `#âncora`, que se guarda e se
  aplica depois de a abertura soltar o scroll).
- O mergulho: tudo o que é opaco e cruza a rota (img, video, picture, raio X) vira um troço onde o
  barco passa por baixo — azul fundo, desfocado — e volta à tona com anéis e salpicos.
- Velocímetro (HUD): a velocidade do scroll em nós, até aos 46 do D60, e o rumo.
- Perto do porto o iate encolhe até ser o farol de Barcelona.
- Espuma num canvas de 1,5 ecrãs que segue o scroll por `transform` em passos; só limpa o
  rectângulo sujo; partículas agrupadas por 10 níveis de opacidade (um `fill` por nível).
- Rota calculada uma vez por desenho (curvas Bézier com tangente vertical, tabela de pontos a
  cada 4 px; `getPointAtLength` milhares de vezes custava 165 ms). Refazer só com o scroll parado.
- Separador de milhares feito à mão (o primeiro `toLocaleString` custava ~20 ms a meio do scroll).
- Imagens grandes decodificadas a ecrã e meio de distância (`img.decode()`).
- Textos em inglês, curtos, com dois tempos: "Hidden outboard engines." / "Seven yachts, one
  signature." / "From Barcelona to 39 countries."
- `noindex, nofollow` + `robots.txt Disallow: /` — é uma proposta, não o site oficial.
