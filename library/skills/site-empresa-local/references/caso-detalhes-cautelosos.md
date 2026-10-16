# Caso: Detalhes Cautelosos (construtora, Rio Maior)

Fonte: `tomas476/detalhes-cautelosos`. O repositório só tem o **build** (HTML + JS compilado por Vite + CSS), sem código fonte. O que se lê aqui vem do CSS completo (`estilo.css`, `tipo.css`, `texto.css`, `marca/dc-cores.css`, copiados para `assets/detalhes-cautelosos/`), dos 9 ficheiros `.html` e do texto dos módulos JS em `assets/`. Os componentes React compilados não foram copiados (ilegíveis); o que fazem está descrito abaixo.

Publicado em `https://tomas476.github.io/detalhes-cautelosos/` (todos os caminhos começam por `/detalhes-cautelosos/`). É uma **proposta**: cada página tem `<meta name="robots" content="noindex, nofollow">` e o `robots.txt` diz `Disallow: /`. Tem `.nojekyll`.

## A empresa (dados públicos do site, só como exemplo)

Construtora de Rio Maior, atividade desde 2016, "Engenharia e Concepção". Alvará IMPIC de obras públicas, Classe 6, que cobre empreitadas até 6,4 milhões de euros. Rodapé: nome legal, NIPC, morada, alvará, link para a política de privacidade. Descritivo da home: "Construção civil e obras públicas desde 2016, com experiência e rigor em cada projecto."

Quatro serviços ("Quatro frentes, a mesma exigência"): Construção civil, Obras públicas, Reconstrução e reabilitação, Projectos e orçamentos. Obras mostradas: duas moradias unifamiliares (Cidral, Rio Maior, 2022; Casais Mestre Mendo, Peniche, 2020), a reconstrução de um prédio multifamiliar (Campo Grande, Lisboa, 2023) e um empreendimento em curso (Detalhes de Sal, Rio Maior: oito moradias T3, imagens 3D).

## Mapa de páginas

Site de várias páginas HTML, cada uma a montar uma pequena app no `<div id="raiz">`. As páginas dinâmicas são **uma só página com `?id=`** (porque o site é estático no Pages).

| Ficheiro | Título | Conteúdo |
|---|---|---|
| `index.html` | Detalhes Cautelosos, Engenharia e Concepção | Entrada com vídeo + declaração, secções "01 Obras" (carrossel), "02 Quem somos" (números), "03 O que fazemos" (4 serviços), contacto |
| `sobre.html` | Sobre nós | "Construímos com rigor. Entregamos com propósito.", "O que uma classe de alvará quer mesmo dizer.", obras com morada e data, zona de atuação |
| `servicos.html` | Serviços | Cabeçalho + índice editorial dos 4 serviços, cada um com chapa do alvará |
| `servico.html?id=<slug>` | Serviço | Capa com fotografia, intro com `**realces**`, "O que isto inclui.", "Obra feita nesta frente." (ou "Ainda sem obra publicada nesta frente.") |
| `obras.html` | Obras | "Obra feita, com morada e com data.": o empreendimento em curso em destaque + "Concluídas" em lista editorial |
| `obra.html?id=<id>` | Obra | Ficha: local, ano, tipo, fotografias |
| `orcamento.html` | Pedir orçamento | Formulário em 3 passos (abaixo) |
| `contacto.html` | Contacto | "Diga-nos o que quer construir." + convite ao orçamento + 3 linhas de contacto + localização |
| `privacidade.html` | Política de privacidade | Página de texto (`texto.css`): resumo grande no início, `h2` verde, data no fim |

Navegação (`Navbar`): Sobre nós · Serviços (com submenu) · Obras (com submenu) · Contacto, mais botão "Pedir orçamento". Há migalhas (`Migalhas`), um bloco "porta" no fim das páginas (`Porta`, chamada para o orçamento) e rodapé (`Rodape`: símbolo da marca, nome legal · NIPC · morada, alvará, privacidade).

## A página de orçamento (`orcamento.html`)

Título "Diga-nos o que quer construir", rótulo "Sem compromisso", migalhas "Início / Pedir orçamento", selo desenhado em SVG (círculos pontilhados, graduação de 48 marcas, mira) com o símbolo da marca no meio.

Formulário em **3 passos**, estado em React, sem backend:

1. **"Quem fala"**: Nome e "Telefone ou e-mail" (obrigatórios; `placeholder`: "Como se chama" e "Por onde lhe respondemos").
2. **"A obra"**: `role="radiogroup"` com quatro botões: Moradia nova · Reabilitação / reconstrução · Obra pública · Ainda não sei. Obrigatório escolher um.
3. **"Detalhes"**: Localidade, Quando ("Já, este ano, sem pressa…") e "Mais alguma coisa", todos opcionais.

Mecânica: contador "1 / 3", barra de progresso (`ol` com `aria-label="Progresso"`), "Continuar" desativado até o passo ser válido, "Voltar", direção da transição (`data-dir` 1 ou -1). O último passo tem "Enviar pedido", que faz `window.location.href = mailto:<email>?subject=Pedido de orçamento - <nome>&body=<campos preenchidos>`. Aviso por baixo: "Ao enviar, abrimos o seu programa de e-mail com o pedido já escrito, para <email>. Pode reler antes de mandar." Rodapé da página com nome legal, NIPC, alvará e privacidade.

Na página de contacto o convite é: "Três perguntas, um minuto. Diga-nos que tipo de obra é, onde fica e para quando. Respondemos com um orçamento ou com uma visita, conforme o caso." e a nota "Sem compromisso, e não é preciso saber medidas."

Compara com o formulário da Blue Magnitude (`assets/bluemagnitude/src/components/contacto-form.tsx`), que valida por passo com mensagens e abre WhatsApp. Escolhe `mailto:` quando o cliente trabalha por email (obras, B2B) e WhatsApp quando trabalha por telemóvel (serviços ao domicílio).

## Regra de ouro do `estilo.css`

> **facto que o cliente não confirmou = campo nulo = secção que não existe.** Não se enche com texto de encomenda nem com fotografia de banco de imagens.

Outras regras escritas nos comentários do CSS:

- **A localidade e o ano de cada obra não são decoração.** "Uma grelha de fotografias sem legenda não prova nada, podia ser de qualquer construtor." Se uma obra chega sem localidade ou sem ano, não entra (`.obra__meta`).
- **Foco visível em todo o lado** (`outline: 2px solid var(--dc-oliva); outline-offset: 3px`). Nunca `outline: none` sem substituto.
- **Alvos de toque de 44 px** sem engordar o desenho: um pseudo-elemento `::after` centrado, invisível, com `width/height: max(100%, 44px)`.
- **Cada correção medida em duas larguras.** O comentário de `barra--clara` conta que o erro do "tick 15" foi medir só a 375 px: a barra de papel funcionava aí e falhava a 1440 px. Testa sempre em mais de uma largura.
- **`overflow-x: clip` nas secções**, porque o "bafo de luz" da marca animada sangrava 12% para fora e a página rolava 31 px na horizontal só a 1200 px: "um defeito que só aparece no meio da escala passa nos testes".
- **Tokens que não chegam a uma página**: a `privacidade.html` pedia `marca/dc-cores.css` por um caminho que devolvia o fallback do servidor e `--dc-verde` ficava por definir. Moral: dá valor de reserva (`var(--dc-verde, #205532)`) onde um token pode faltar, e abre todas as páginas, também a de privacidade, que ninguém nunca abre.
- **A barra nasceu para um hero escuro**: branco sobre papel dava 1,1:1 (invisível). Modificador `.barra.barra--clara` (especificidade 0,2,0, sem `!important`). Fundo de papel e não `transparent`, senão o texto passa por baixo da barra fixa.

## Estilo (`estilo.css`, `tipo.css`, `marca/dc-cores.css`)

Cores, letra, escala e durações em `sistema-design.md`. Estrutura:

- **Barra** pílula fixa (`margin: clamp(12px, 2vh, 20px) auto 0`, `border-radius: 999px`), na barra vai o **símbolo** (38 px, 32 px a ≤ 30rem) e o nome em traçado da marca (`dc-marca-barra.svg`), nunca a assinatura inteira (o "ENGENHARIA E CONCEPÇÃO" ficaria com 1 px de corpo).
- **Entrada com vídeo** (`index.html`): vídeo de fundo `heroi-900/1280/1920.mp4` por largura (≤ 700 px, ≤ 1200 px, resto), `poster`, véu, símbolo da marca no centro com "Role para entrar". O scroll controla uma variável CSS `--p` de 0 a 1 (`offsetHeight - innerHeight`), o símbolo voa para a barra (`--vx`, `--vy`, `--ve` calculados dos retângulos), e `document.documentElement.dataset.fase` passa de `portao` a `aberto` (≥ 0,78) e `dentro` (≥ 0,92). Com `prefers-reduced-motion` fica logo `dentro`. O vídeo tenta tocar em `touchstart`, `pointerdown` e `scroll`.
- **Carrossel de obras** (coverflow): cartão central e dois de cada lado (`data-p`), auto-avanço de 5 s que pára com rato, foco ou clique, setas, pontos, teclado (setas) e arrasto de mais de 45 px; fundo ambiente com a imagem desfocada.
- **Serviços** (`.servicos`): grelha `repeat(auto-fit, minmax(15rem, 1fr))` com linhas de 1 px; em telemóvel uma "gota" desce ao longo da lista (keyframes `dc-gota` geradas por JS a partir das posições medidas de cada ponto).
- **Números** (`.numeros`, `dl`): "2016 Desde o início", "6,4 M€ Tecto de obra pública", "Classe 6 Alvará IMPIC". Só o que se pode provar.
- **Secção escura** (`.seccao--escura`): redefine `--dc-oliva` e `--dc-cinza`; o selo e a marca animada baixam de opacidade para repor a hierarquia (nome 100%, apelido 82%, descritivo 74%, régua 38%, selo 72%).
- **Contacto** (`.contacto__grelha`): `1.1fr .9fr` a partir de 56rem. Linhas `dl` com rótulo em maiúsculas pequenas e valor com sublinhado fino.
- **Rodapé** (`.rodape`): fundo `--dc-verde`, texto 72% branco.
- **Revelar** com `animation-timeline: view()` sem JS (ver `sistema-design.md`).

## PWA e metadados

`site.webmanifest` com `name`, `short_name`, ícones 192 e 512, `theme_color` e `background_color` `#16241B`. `<head>`: `theme-color`, `favicon.ico` com `sizes="48x48"` (para o Chrome não o preferir ao SVG), `icone.svg`, `apple-touch-icon.png` (o iOS não lê SVG), `preload` da letra em woff2. Sem Open Graph neste build (é proposta); numa versão oficial acrescenta-se.

## O que reaproveitar

- O orçamento em 3 passos com `mailto:` (negócios B2B, obras, serviços técnicos).
- A prova do alvará/licença como componente de página (faixa de números + chapa em cada serviço + rodapé).
- Portefólio com "morada e data" em vez de galeria solta.
- O sistema de cor com variante de texto medida.
- Uma letra só, variável, com duas "vozes" por eixo de largura.
- O CSS sem JS (`animation-timeline`) como degradação segura.
