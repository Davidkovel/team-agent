---
name: dossie-crescimento
description: Encontra marcas pequenas (lojas online, ateliers, negócios com workshops) que estão a deixar vendas por apanhar, audita o site público delas e faz um dossiê de crescimento em PDF (4 páginas A4) com uma proposta, e o rascunho do email. Nunca envia nada sozinho.
---

# Dossiê de crescimento (prospeção com PDF)

## O que é

Uma forma de chegar a um cliente com o trabalho já feito: em vez de «fazemos sites», mandamos
um PDF que mostra **com os dados do próprio site dele** onde está a perder vendas, e o que
fazemos para resolver, com preço. O primeiro lote (16 out 2026) foi de cerâmica artesanal em
Lisboa: Ramos Cerâmica e San Pi (`exemplos/`).

## Regras (não negociáveis)

0. **Imagens primeiro, nível agência.** Um dossiê só de texto e tabelas não serve (o David, a 16 out
   2026: «está uma merda, sem imagens sem nada»). Formato apresentação 16:9 (1920×1080), as fotos reais
   do negócio em todas as páginas e **amostras** do que propomos: o site/a loja em telemóveis, o
   Instagram refeito, stories. Se o negócio não tem fotos nem redes, as amostras fazem-se de raiz
   (como no caso do DJ Madeira, com imagens geradas no Canva). Modelo: `exemplos/pequeno-mundo/`.
   Ver cada página renderizada antes de mostrar; página com espaço vazio leva fotos.

1. **Só factos verificados no site público, com data.** Cada número do PDF tem de se poder
   refazer a partir do site nesse dia. Sem visitas, faturação ou «vai vender +30 %»: não temos
   esses dados. A nota «Como chegámos a estes números» vai sempre na última página.
2. **Nada sai sem o David (ou o Marco/Kovel) ver.** Os emails ficam em rascunho. Nunca
   `send_message`, nunca formulários de contacto preenchidos por nós.
3. **Cuidado com o que o HTML não mostra.** Na Shopify o Meta Pixel vem pelas web pixels das apps
   e não aparece como `fbq(`: «não tem pixel» só se diz depois de ver `"facebook_pixel"` ausente
   **e** mesmo assim com cuidado. Na Wix/Squarespace não se afirma nada sobre pixel.
4. **O nome dos sítios vem da descrição, não do endereço.** O handle
   `workshop-pintura-com-corda-seca-03-de-maio-loule` é em Campo de Ourique; o texto diz-o.
5. **Sessões passadas não contam.** Uma sessão de setembro marcada «Esgotado» pode só estar
   fechada. Contam-se as que ainda vêm.
6. **Começar pelo que já está bem.** Cada dossiê tem uma caixa «O que já está bem»: o cliente
   lê-o até ao fim quando não se sente atacado.
7. Português de Portugal, tratamento por «vocês/você», sem emojis, sem travessões a meio de frase.

## Método

### 1. Encontrar candidatos
Listas de imprensa («marcas portuguesas de…» na Time Out, NiT, Observador) dão 15–20 marcas com
site de uma vez. A pesquisa genérica no Google é fraca para isto. Guardar `nome|url` num ficheiro
(`exemplos/ceramica-urls.txt`).

### 2. Triagem automática
`python3 -I scripts/auditar.py lista.txt saida.json` — plataforma, tempo, pixel, newsletter,
Instagram, e nas lojas Shopify o catálogo público (`/products.json`): produtos, experiências,
esgotados, data da última peça nova. Bons sinais de cliente: **muitos esgotados** (procura sem
oferta), **última peça nova há muito tempo**, **workshops sem datas**, Shopify (sabemos mexer).

### 3. Ir ao fundo em 2–3
`/products.json` mostra variantes (datas das sessões, preços, estado) e `body_html` (local,
duração, regras). Ler a página inicial e a de contacto com o WebFetch. Anotar email público.

### 4. Escrever o dossiê
Copiar um exemplo de `exemplos/` e o `assets/dossie.css`. Quatro páginas:
capa com resumo de 3 linhas → **O que vimos** (3 números grandes + tabela + o que já está bem) →
**Cinco mudanças por ordem de impacto** → **Proposta** (2 pacotes, próximos passos, nota de método).
Preços de partida: Pacote 390 € único, acompanhamento 149 €/mês (a equipa ajusta).

### 5. PDF
```
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --no-pdf-header-footer \
  --virtual-time-budget=8000 --print-to-pdf="$PWD/x.pdf" "file://$PWD/x.html"
```
(No Windows: `chrome.exe` com os mesmos argumentos.) Abrir o PDF com o Read e ver as 4 páginas
antes de dar por feito: nada a passar para a página seguinte, números iguais à tabela.

### 6. Email em rascunho
Curto, 5 a 7 linhas: um facto concreto do site deles, uma frase do que o PDF tem, pedido de
15 minutos. O PDF vai em anexo. Fica como rascunho para alguém da equipa rever e enviar.

## Fotos do Instagram

Com o Chrome do David (sessão iniciada), ler os códigos das publicações no perfil por JavaScript
(só o `href`, sem querystring, senão a ferramenta bloqueia). Depois cada foto vem sem sessão:
`curl -sL "https://www.instagram.com/p/<código>/media/?size=l"` (960–1080 px), e a legenda/data/gostos
com `curl -A "facebookexternalhit/1.1" https://www.instagram.com/p/<código>/` (og:description).
A API `web_profile_info` dá 429 depressa: não insistir, para não bloquear a conta.
**Fotos com crianças não entram**: só peças estendidas, cabides, montra.

## Influencers

O Instagram e o TikTok não se leem sem sessão, por isso a triagem automática não chega lá.
Com o @ e uma captura do perfil dada por nós, o método é o mesmo: o que vende (ou não vende),
para onde aponta o link da bio, se tem loja/produto próprio. Sem números de seguidores que não
se tenham visto.
