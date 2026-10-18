# Pôr a viagem numa loja Shopify

A loja já tem tema, produtos e checkout: a viagem entra como **secções do tema**, e o resto da loja fica igual.

## Segurança primeiro

- Nunca editar o tema publicado. Duplicar o tema (Admin › Loja online › Temas › Duplicar) ou trabalhar com
  `shopify theme dev` / `shopify theme push --unpublished`, e mostrar a pré-visualização ao dono antes de publicar.
- Para uma proposta rápida sem tocar na loja: fazer a página como site estático (o `starter/`) com os produtos, fotos
  e textos verdadeiros da loja e os botões «Comprar» a apontar para as páginas de produto da loja.

## Do starter para o tema

| Starter | Tema |
|---|---|
| `js/scroll.js` | `assets/scroll-viagem.js`, carregado com `defer` só nas páginas que têm a secção (`{{ 'scroll-viagem.js' \| asset_url \| script_tag }}` dentro da secção) |
| `estilo.css` (só as partes 30–60 e 99) | `assets/scroll-viagem.css`, com as classes prefixadas (`sv-`) para não chocar com o tema |
| cada bloco (`.cena`, `.faixas`, `.numeros`, `.mochila`) | uma secção `sections/sv-<nome>.liquid` com `{% schema %}`: títulos, textos, imagens, intervalos `de`/`ate` e cores como definições, para o dono mexer no editor |
| fotogramas | ficheiros carregados na loja (Admin › Conteúdo › Ficheiros) ou nos assets do tema; o caminho da pasta fica numa definição da secção |
| botões | `{{ product.url }}`, formulário de «adicionar ao carrinho» do tema, nunca um checkout feito à mão |

- As secções vão para o `templates/index.json` (página inicial) ou para um template de produto/página próprio.
- O `scroll.js` é independente do tema: não usa jQuery nem nada do tema; procura os atributos `data-*`.
- O cabeçalho do tema fica; o indicador de scroll e a percentagem entram na secção do hero.
- Testar com o `scripts/fotos.py` sobre o URL da pré-visualização.
