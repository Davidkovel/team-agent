# Pré-visualização do link (o cartão que aparece no WhatsApp)

Isto não é um detalhe de SEO. Um consultor imobiliário partilha o site dele por mensagem
— WhatsApp, Messenger, LinkedIn, iMessage — dezenas de vezes por semana. O cartão que
aparece nessa mensagem é a primeira coisa que o cliente vê. Se sair um rectângulo cinzento
com o URL, o trabalho todo do site fica invisível.

Trata a pré-visualização como uma funcionalidade entregável: tem template, tem
renderizador, tem checklist.

Ficheiros do kit:
- `assets/og-card.html` — template do cartão 1200×630 com placeholders.
- `scripts/render-og.py` — renderiza o HTML para `og.jpg`.

---

## 1. O bloco `<head>` completo

Copia isto para o topo de **todas** as páginas. `og:title`, `og:description` e
`og:url` mudam por página; o resto é igual.

```html
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>{{NOME}} · {{FUNCAO}} em {{CIDADE}}</title>
<meta name="description" content="{{DESCRICAO_SEO}}" />
<link rel="canonical" href="https://{{DOMINIO}}/" />

<!-- favicon -->
<link rel="icon" href="assets/favicon.svg" type="image/svg+xml" />
<link rel="icon" href="assets/favicon-32.png" sizes="32x32" type="image/png" />
<link rel="icon" href="assets/favicon-48.png" sizes="48x48" type="image/png" />
<link rel="icon" href="assets/favicon-192.png" sizes="192x192" type="image/png" />
<link rel="apple-touch-icon" sizes="180x180" href="assets/apple-touch-icon.png" />
<meta name="theme-color" content="{{COR_FUNDO}}" />

<!-- Open Graph -->
<meta property="og:type" content="website" />
<meta property="og:url" content="https://{{DOMINIO}}/" />
<meta property="og:site_name" content="{{NOME}} · {{FUNCAO}}" />
<meta property="og:title" content="{{NOME}} — {{FUNCAO}} em {{CIDADE}}" />
<meta property="og:description" content="{{DESCRICAO_PARTILHA}}" />
<meta property="og:image" content="https://{{DOMINIO}}/assets/og-{{SLUG}}-v1.jpg" />
<meta property="og:image:type" content="image/jpeg" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:image:alt" content="{{NOME}}, {{FUNCAO}} {{AGENCIA}}" />
<meta property="og:locale" content="pt_PT" />
<meta property="og:locale:alternate" content="en_US" />
<meta property="og:locale:alternate" content="fr_FR" />

<!-- Twitter -->
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="{{NOME}} — {{FUNCAO}} em {{CIDADE}}" />
<meta name="twitter:description" content="{{DESCRICAO_PARTILHA}}" />
<meta name="twitter:image" content="https://{{DOMINIO}}/assets/og-{{SLUG}}-v1.jpg" />
```

Notas sobre o bloco:

- `og:image:width` / `og:image:height` declarados poupam ao scraper uma ida à imagem só
  para lhe medir o tamanho. Sem eles, alguns clientes mostram o cartão pequeno na
  primeira partilha e só acertam na segunda.
- `og:locale:alternate` existe porque o mercado é misto: proprietário português,
  comprador estrangeiro. Declarar não traduz nada, mas evita que o cliente estrangeiro
  receba um cartão marcado como conteúdo noutra língua.
- `twitter:card=summary_large_image` é o que faz o LinkedIn e o X mostrarem a imagem
  grande em vez de uma miniatura ao lado do texto. Sem esta linha o cartão encolhe.
- `theme-color` pinta a barra do browser no Android e a barra do Safari em iOS —
  usa a mesma cor de fundo do site, senão a emenda vê-se.
- O conjunto de favicons não é redundância: o SVG serve o browser moderno, o 32 serve o
  separador em ecrãs normais, o 48 e o 192 servem atalhos e a lista de sites do Android,
  e o `apple-touch-icon` 180 é o único que o iOS usa quando o cliente guarda o site no
  ecrã principal.

---

## 2. As três regras que partem a pré-visualização

### Regra 1 — `og:image` tem de ser URL absoluta, no domínio onde o site vive mesmo

Um caminho relativo (`assets/og.jpg`) não funciona: o scraper do WhatsApp não é um
browser, não resolve relativos de forma fiável. Tem de ser `https://{{DOMINIO}}/...`.

E o domínio tem de ser o que **resolve agora**, não o que está previsto comprar.

Isto foi um erro real, e está comentado no `<head>` de um dos sites de referência:

```html
<!-- O dominio era {{DOMINIO_PLANEADO}}, que nunca chegou a
     apontar para lado nenhum: o scraper pedia a imagem la, levava com um
     erro de ligacao e a partilha saia sem pre-visualizacao. O site vive em
     {{DOMINIO}} e as URLs absolutas tem de segui-lo. -->
```

O que aconteceu: o site estava no ar e correcto, o `og:image` apontava para o domínio
definitivo que ainda não tinha DNS. O scraper foi buscar a imagem, apanhou erro de
ligação, desistiu — e a partilha saiu sem pré-visualização nenhuma. Nada no site
denunciava o problema; só se via ao enviar o link a alguém.

Consequência prática: quando o domínio definitivo entrar, é preciso **voltar** aos
metas e trocar todas as URLs absolutas (`og:url`, `og:image`, `twitter:image`,
`canonical`). Não é opcional, e não se faz "depois".

### Regra 2 — o cartão tem de dizer QUEM É

Nome + função + a linha de prova. Sempre os três.

O primeiro cartão de um dos sites era só o monograma sobre preto: bonito, e inútil. Numa
conversa de WhatsApp com quinze links, um quadrado preto com duas letras não identifica
nada. Foi preciso fazer uma v2. O comentário ficou no código:

```html
<!-- Cartao 1200×630 gerado por scripts/render-og.py: monograma +
     nome + a linha de prova. O anterior era so o monograma sobre preto —
     uma partilha sem nome nem numero nao diz de quem e o link. -->
```

O teste é simples: tapa o URL e o texto da mensagem. Se, olhando só para a imagem, não
se percebe de quem é e o que faz — o cartão não presta.

A "linha de prova" é o número que dá crédito: anos de mercado, imóveis vendidos,
distinção, a agência. Um facto, não um adjectivo.

### Regra 3 — 1200×630, JPEG, abaixo de ~300KB, e a cache dos scrapers

- **1200×630** é o rácio que o WhatsApp, Messenger, LinkedIn e iMessage esperam.
  Fora deste rácio, cortam — e o corte cai quase sempre em cima do nome.
- **JPEG**, não PNG. O mesmo cartão em PNG pesa mais de 1 MB; em JPEG fica abaixo de
  100 KB. Renderiza a 2× e reduz para 1200×630 — o texto fica limpo sem o peso.
- **Abaixo de ~300 KB.** Acima disso há clientes que desistem do download e a partilha
  sai sem imagem. Vale a pena confirmar o tamanho do ficheiro antes de entregar.

E a parte que apanha toda a gente:

> **Os scrapers guardam a imagem em cache pelo URL.** Substituir o ficheiro no servidor
> não chega. O WhatsApp continua a servir a versão antiga durante dias.

A solução é mudar o **nome** do ficheiro sempre que o cartão muda:

```
og-{{SLUG}}-v1.jpg  →  og-{{SLUG}}-v2.jpg
```

e actualizar `og:image` e `twitter:image` para o nome novo. URL novo, cache vazia,
cartão novo à primeira. O mesmo vale para os favicons (`favicon-32-v2.png`) — o browser
faz cache deles com a mesma teimosia.

Além do nome novo, força o refresh onde dá:

- **Facebook / WhatsApp** — Facebook Sharing Debugger (`developers.facebook.com/tools/debug/`):
  cola o URL da página, carrega em *Scrape Again*. Serve o WhatsApp também, que usa a
  mesma infra-estrutura.
- **LinkedIn** — Post Inspector (`linkedin.com/post-inspector/`): cola o URL e ele
  re-inspecciona. A cache do LinkedIn dura cerca de uma semana; sem passar por aqui,
  esperas.
- **X / Twitter** — não há mais botão de refresh; o URL novo do ficheiro é a única via.
- **iMessage** — cache local no dispositivo. Testa sempre num telemóvel que nunca
  recebeu o link, senão vês a versão antiga e julgas que falhou.

---

## 3. Anatomia do cartão

O cartão não é um banner genérico: é o hero do site comprimido em 1200×630, para que
quem clica reconheça a página onde aterra.

De trás para a frente:

1. **Fundo — as mesmas barras do hero.** Barras verticais encostadas ao fundo, com
   alturas irregulares fixas, cada uma com gradiente vertical que sobe de transparente
   até ao azul de marca. Opacidade global baixa (`.55`) para que sejam textura, não
   assunto. Geradas por um `for` inline em JS a partir de um array de alturas — ficam
   iguais em todos os renders, ao contrário de alturas aleatórias.

2. **O recorte da pessoa, à direita.** PNG sem fundo, encostado ao canto inferior
   direito, com altura quase total (598 de 630) para que "assente" na base em vez de
   flutuar. Leva `brightness`/`contrast`/`saturate` ligeiramente acima de 1 porque um
   recorte sobre fundo escuro lê sempre mais apagado do que o original.
   A máscara são duas máscaras compostas com `mask-composite: intersect`: uma horizontal
   (transparente à esquerda, opaca a 22%) que dissolve a pessoa para dentro do fundo em
   vez de a cortar a direito; e uma vertical (opaca até 82%, transparente no fim) que
   apaga a linha do corte em baixo.

3. **O véu.** Duas camadas por cima do recorte e por baixo do texto:
   - `radial-gradient` centrado em cima do bloco de texto (à esquerda), muito opaco no
     centro e a **chegar a zero** na borda;
   - `linear-gradient` horizontal, opaco à esquerda, zero a 70%.

   O véu é o que garante contraste do texto sobre qualquer foto. **Tem de chegar a
   zero** no fim: se parar numa opacidade residual, vê-se um degrau vertical a meio do
   cartão, e num JPEG comprimido esse degrau ganha bandas.

4. **A coluna de texto, à esquerda**, largura máxima ~760px, centrada na vertical:
   - **kicker** — maiúsculas, tracking largo (5.5px), em azul claro. Duas ou três
     palavras: o serviço e a zona;
   - **nome** — display grande (96px), peso 700, tracking negativo;
   - **função** — 38px, cor secundária, peso normal. É o contraste de peso entre esta
     linha e o nome que faz a hierarquia;
   - **régua** — barra de 72×3px na cor de acento, a separar identidade de meta;
   - **meta 1** — agência e zona de actuação;
   - **meta 2** — a linha de prova / contacto, mais pequena e mais apagada.

5. **O logo, em baixo à direita**, ~96px, cantos arredondados, com sombra e um anel de
   1px branco a 10% para o descolar do fundo. Por baixo dele, um `radial-gradient`
   escuro de 180px (o **halo**) centrado no logo: sem esse halo, o logo cai em cima do
   recorte da pessoa e fica ilegível.

Tudo em `position:absolute` dentro de um `html,body` fixo em 1200×630 com
`overflow:hidden` — a página é a imagem, não há scroll nem layout responsivo a
considerar.

---

## 4. Checklist antes de entregar um site

Percorre isto com o site já no domínio final.

**Ficheiro**
- [ ] `og-{{SLUG}}-vN.jpg` existe, tem exactamente 1200×630
- [ ] É JPEG e pesa menos de ~300 KB
- [ ] Foi renderizado a 2× e reduzido (texto sem serrilha)
- [ ] O nome tem sufixo de versão e é diferente do da versão anterior

**Conteúdo do cartão**
- [ ] Lê-se o nome, a função e a linha de prova sem esforço a 300px de largura
- [ ] O recorte não tapa o texto nem o logo
- [ ] O véu chega a zero (sem degrau visível)
- [ ] O logo tem halo e não assenta em cima da pessoa

**Metas**
- [ ] `og:image` e `twitter:image` são URLs **absolutas** e no domínio que resolve
- [ ] `og:url` e `canonical` apontam para o domínio final, com `https://` e barra final
- [ ] `og:image:width`/`height` = 1200/630, `og:image:type` = image/jpeg
- [ ] `og:image:alt` descreve a pessoa, não a imagem
- [ ] `twitter:card` = `summary_large_image`
- [ ] `og:title` ≠ `<title>` se o `<title>` for comprido demais para um cartão
- [ ] Todas as páginas internas têm o seu `og:url` e `og:title` próprios

**Favicons**
- [ ] Os 5 ficheiros existem (svg, 32, 48, 192, apple-touch 180)
- [ ] `theme-color` igual ao fundo do site

**Verificação real**
- [ ] Facebook Sharing Debugger: *Scrape Again*, sem avisos e com a imagem correcta
- [ ] LinkedIn Post Inspector: cartão grande e correcto
- [ ] Enviado a um telemóvel que **nunca** recebeu este link — WhatsApp mostra o cartão
- [ ] Testado o link com e sem `www`, e com e sem barra final
