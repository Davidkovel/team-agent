# Prompts prontos a correr

**Invocar a skill directamente** (`/realtor-landing` ou "usa a skill realtor-landing") carrega
as regras do género na conversa actual — usa-se para tarefas curtas, dúvidas e correcções pontuais,
com tudo à vista no teu contexto.

**Despachar o agente** (`realtor-site-builder`) abre uma sessão própria que lê a skill, monta o
`content.json`, escreve os ficheiros e devolve a entrega com as checklists preenchidas — usa-se
para trabalho longo ou de várias páginas, sem te encher o contexto.

Substitui tudo o que estiver entre `<>`. Se não souberes um valor, deixa o `<>` — o agente
pergunta em vez de inventar.

---

## 1. Arrancar um site novo para um consultor

```
Usa o agente realtor-site-builder para me construir um site novo de consultor imobiliário.
Ele tem de invocar a skill realtor-landing antes de escrever qualquer código, montar o
content.json primeiro e confirmá-lo comigo, e servir o resultado por python3 -m http.server.

BRIEFING
- Nome: <NOME COMPLETO>
- Função: <Consultor Imobiliário / Consultora Imobiliária>
- Agência / rede: <AGENCIA>
- AMI: <NUMERO AMI>
- Cidade base: <CIDADE>   |   Zona de actuação: <ZONAS>
- Telefone (E.164): <+351XXXXXXXXX>
- WhatsApp (só dígitos): <351XXXXXXXXX>
- Instagram: <@utilizador ou URL>   |   Outras redes: <...>
- Domínio final (o que resolve mesmo): <https://exemplo.pt>
- Domínio provisório, se houver: <...>
- Anos de mercado: <N>   |   Prova verificável (factos, não adjectivos): <...>
- Idiomas: <pt / pt+en / pt+en+fr>
- Assets que já tenho: <retrato recortado PNG, retrato de estúdio, logo, fotos de imóveis, reels>
  Caminho: <PASTA>
- Imóveis em carteira agora: <N>
  Para cada um: <tipologia, zona, preço, área, quartos, WC, certificado, nº de fotos, ref.>
- Paleta: <escura azul (default do género) / clara / outra: ...>
- Tipografia: <default do género / par pretendido>
- Texto do cliente (bio, argumento de venda): <cola aqui ou diz "escreve tu e eu reviso">

Regras: nada de factos inventados — o que faltar fica em placeholder e na lista de pendências.
Mapa de páginas: núcleo de 8 (index, sobre, vender, imovel, credito, mais-valias, imt,
privacidade) + robots.txt, sitemap.xml e o cartão OG. Entrega com as checklists de shell.md §8
e link-preview.md §4 preenchidas e com os valores de validação dos simuladores batidos.
```

---

## 2. Arrancar para uma AGÊNCIA / equipa

```
Usa o agente realtor-site-builder, com a skill realtor-landing, para construir o site de uma
EQUIPA imobiliária. Mesmo núcleo do consultor solo, mais as páginas extra — e só se passarem
os limiares de sections.md §1.3 (imoveis.html com ≥6 imóveis, equipa.html com ≥4 pessoas com
foto tratada, premios.html só com distinções verificáveis e com imagem). Se algum limiar não
passar, diz-me e resolve dentro de outra página em vez de criar a extra.

BRIEFING
- Nome da equipa / agência: <NOME>   |   Rede: <REDE>   |   AMI: <NUMERO>
- Cidade e zona: <...>   |   Domínio: <https://...>
- Contacto central: telefone <+351...>, WhatsApp <351...>, email <...>
- Responsável / líder de equipa: <NOME e função>
- Pessoas (nome, função, foto, contacto directo, tem página própria? s/n):
  <lista>
- Imóveis em carteira: <N>  |  A carteira roda todos os meses? <s/n>
  Ficheiro/folha com os dados: <CAMINHO>
- Prémios e distinções (ano, entidade, imagem do selo): <lista>
- Prova de equipa (volume, cobertura, anos): <factos verificáveis>
- Assets: <PASTA>

Notas: os três simuladores e a privacidade ficam exactamente iguais aos do solo — só muda a
autoria no rodapé. Listagem com filtros sem router nem query strings, imóveis num array no topo
do ficheiro, fichas geradas do mesmo template. Cartões de equipa só são links se a pessoa tiver
página própria. Prémios em faixa de selos, nunca em grelha de cartões grandes.
```

---

## 3. Acrescentar uma secção nova ao site existente

```
Usa a skill realtor-landing e acrescenta uma secção nova ao site em <CAMINHO DO SITE>.

- Secção: <o que é, numa frase>
- Página: <index.html / vender.html / sobre.html / ...>
- Posição: <a seguir a QUAL secção>
- Conteúdo real (nada inventado): <texto, números, imagens, links>
- CTA: <destino e texto do botão, ou "sem CTA">

Antes de escrever: confirma o ritmo da página segundo sections.md §14 — a secção nova não pode
ficar encostada a outra densa sem peça respirável ou salto de padding, e não pode encostar dois
painéis de vidro. Diz-me qual é a densidade que estás a atribuir e porquê.

Reutiliza os tokens e os componentes do design-system.md (vidro, botões, kicker, raios) em vez
de inventar estilos novos. Reveal pelo padrão do shell (.rev com --rev-d) e bloco
prefers-reduced-motion obrigatório. Actualiza o content.json e, se a secção tiver âncora, a
navbar/menu mobile/rodapé de TODAS as páginas, com scroll-margin-top:96px.

Se eu te der um componente de fora (v0, 21st.dev, um snippet), lê-o linha a linha e audita-o
antes de montar: scroll sequestrado, ctx.scale acumulado no resize, listeners sem remove,
dependências de CDN, IDs em conflito com o shell, ausência de reduced-motion. Diz-me o que
corrigiste.

Verifica por http://localhost com python3 -m http.server, em desktop e a 375px.
```

---

## 4. Acrescentar um quarto simulador

```
Usa o agente realtor-site-builder, com a skill realtor-landing (references/calculators.md §5),
e acrescenta um quarto simulador ao site em <CAMINHO DO SITE>.

- Simulador: <rentabilidade de arrendamento / renda vs prestação / outro: ...>
- Página nova: <ficheiro.html>   |   Prefixo de IDs (duas letras): <r->
- Entradas do utilizador: <lista de campos>
- Saída principal: <o número grande do painel>
- Decomposição a mostrar: <linhas do painel>
- Fonte de cada constante fiscal ou de mercado usada: <URL / documento>

Segue o molde de dez passos: copiar imt.html como esqueleto, função pura em
assets/calculators.js sem DOM, guarda de arranque pelo primeiro input, painéis numerados,
painel de resultado com aria-live="polite" actualizado por textContent, TL.live(calc) sem botão
de submeter, disclaimer específico com o ANO das tabelas à vista, CTA de WhatsApp com texto
próprio, registo no dropdown "Ferramentas" da navbar e do menu mobile nas QUATRO páginas de
ferramentas e nas chaves de i18n nav.t*.

Não inventes nenhum número fiscal. O que caduca por Portaria pergunta-se ao utilizador com a
explicação de onde o ir buscar. Onde não souberes calcular, o resultado é a mensagem "prefiro
não lhe dar um número errado — fale comigo", como nas Regiões Autónomas do IMT.

Obrigatório antes de dares por terminado: escrever o VALOR DE VALIDAÇÃO em
references/calculators.md, com um caso concreto e o resultado esperado ao cêntimo, e correr o
node -e que o confirma. E reconfirmar que o valor de validação do crédito continua a dar
1618.57 / 593753.02.
```

---

## 5. Gerar ou refazer o cartão de pré-visualização do link

```
Usa a skill realtor-landing (references/link-preview.md) e trata do cartão de partilha do site
em <CAMINHO DO SITE>.

Situação: <é novo / a partilha sai sem imagem / o cartão está desactualizado / mudei de domínio>
- Domínio que resolve AGORA: <https://...>
- Nome e função a mostrar: <...>
- Linha de prova (um facto, não um adjectivo): <...>
- Recorte da pessoa (PNG sem fundo): <CAMINHO>   |   Logo: <CAMINHO>
- Versão anterior do ficheiro, se existir: <og-<SLUG>-vN.jpg>

Usa assets/og-card.html e scripts/render-og.py. Renderiza a 2× e reduz para 1200×630, JPEG,
abaixo de ~300 KB. O nome do ficheiro tem de SUBIR de versão (og-<SLUG>-v<N+1>.jpg) — substituir
o ficheiro mantendo o nome deixa a cache dos scrapers a servir o antigo durante dias.

Actualiza og:image, twitter:image, og:url e canonical em TODAS as páginas, sempre com URL
absoluta no domínio que resolve. Confirma og:image:width/height, og:image:type,
twitter:card=summary_large_image, og:image:alt e theme-color igual ao --bg.

No fim, percorre a checklist de link-preview.md §4 e diz-me linha a linha o estado, incluindo o
que só eu posso fazer: Facebook Sharing Debugger (Scrape Again), LinkedIn Post Inspector, e
enviar o link a um telemóvel que nunca o recebeu.
```

---

## 6. Trocar a paleta e a tipografia mantendo o movimento

```
Usa a skill realtor-landing (references/design-system.md) e muda a identidade visual do site em
<CAMINHO DO SITE>, sem tocar em nenhuma animação, timing ou easing.

- Nova direcção: <escura → clara / azul → <cor> / paleta da agência <REDE>>
- Cor de fundo: <#...>   |   Tinta / texto: <#...>   |   Acento único: <#...>
- Tipografia display: <FONTE>   |   Texto corrido: <FONTE>
- Restrições da marca: <o que é obrigatório usar / o que é proibido>

Mexe só nos tokens :root e no que deles depender. Mantém intactos: durações, easings, atrasos
escalonados, o fundo animado, os reveals, o sheen, o leque e todos os blocos
prefers-reduced-motion.

Respeita a regra do acento único — uma cor de acento e uma só, sem segunda cor "para variar".
Se a paleta for clara, reavalia o vidro: os valores de opacidade, borda e sombra do género
escuro não transpõem, e o véu do hero tem de continuar a chegar a zero no fim da secção, senão
aparece um risco horizontal.

Verifica contraste em texto pequeno, kickers, rótulos das cápsulas e estados de foco. Actualiza
theme-color, o favicon se a cor de fundo mudou, e o cartão OG (com nome de versão novo).
Mostra-me antes/depois por http://localhost.
```

---

## 7. Auditar um site já feito contra a checklist

```
Usa o agente realtor-site-builder para auditar o site em <CAMINHO DO SITE> contra a skill
realtor-landing. Só auditoria — não corrijas nada sem eu aprovar a lista.

Serve por python3 -m http.server e percorre, por esta ordem:
1. shell.md §8 — placeholders {{ }} por substituir, canonical/og absolutos e no domínio que
   resolve, theme-color = --bg, âncoras index.html#… nas páginas interiores, aria-current="page",
   zero tel: em CTAs de navegação, AMI no rodapé, teste de teclado da barra ao rodapé,
   prefers-reduced-motion, e o site com JS desligado.
2. link-preview.md §4 — ficheiro, conteúdo do cartão, metas, favicons.
3. calculators.md — correr os valores de validação (crédito 1618.57 / 593753.02; IMT HPP
   200 000 € sem IMT Jovem = 3 747,08 €) e confirmar disclaimers com o ano à vista.
4. design-system.md — acento único, vidro, kicker só texto, sem barras de acento nos indicadores.
5. sections.md §14 — ritmo densa/respirável e nenhum par de painéis de vidro encostados.
6. motion.md §11 — as armadilhas: véu que não chega a zero, overflow que fatia o recorte, media
   queries no meio da folha que viram código morto, transform:none que apaga a centragem,
   pan-x sozinho a sequestrar o gesto vertical, bloqueio de scroll por booleano.
7. Terceiros — qualquer componente colado de fora: scroll sequestrado, ctx.scale acumulado no
   resize, listeners/observers sem limpeza, CDN, IDs em conflito.

Devolve uma tabela: item | estado (ok / falha / pendente) | ficheiro:linha | impacto real |
correcção proposta. Ordena por impacto. Sem emojis.
```

---

## 8. Preparar o deploy

```
Usa o agente realtor-site-builder, com a skill realtor-landing, para preparar o deploy do site
em <CAMINHO DO SITE>.

- Destino: <VPS / bucket estático / Vercel / pasta no servidor do cliente>
- Domínio final: <https://...>   |   DNS já aponta? <s/n>
- Acesso: <host, utilizador, caminho, chave — ou "eu faço o upload">
- www e barra final: <preferência>

Antes de empacotar:
- Correr a auditoria do prompt 7 e não avançar com nenhuma falha de impacto alto em aberto.
- Trocar TODAS as URLs absolutas (canonical, og:url, og:image, twitter:image, sitemap.xml) para
  o domínio final. Se o DNS ainda não resolve, avisa-me: o scraper falha e a partilha sai sem
  cartão — vale mais adiar a partilha do que publicar metas que não resolvem.
- Confirmar robots.txt e sitemap.xml com todas as páginas e nenhuma que não deva ser indexada.
- Confirmar que não sobrou nenhum {{PLACEHOLDER}}, nenhum lorem, nenhum dado de teste, nenhum
  console.log e nenhuma dependência de CDN.
- Confirmar pesos: retrato do hero e fotos de imóveis em WebP com fallback, width/height
  intrínsecos em todas as imagens, fetchpriority="high" só no retrato do hero.
- Revisão humana das traduções EN/FR marcadas — nomes próprios, agência e designações legais
  (AMI, IMT, mais-valias, escritura) não sobrevivem a tradução automática.

Depois de publicar, confirma no domínio real: as três páginas de ferramentas a calcular, o
formulário de avaliação a abrir o WhatsApp já preenchido, o cartão de partilha num telemóvel que
nunca recebeu o link, e o site com e sem www e com e sem barra final.

Entrega-me: lista do que foi publicado, o que ficou pendente, e as instruções para eu voltar a
publicar uma alteração sozinho.
```
