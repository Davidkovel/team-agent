# Assets públicos (`public/`)

Conteúdo do `public/README.md` original, traduzido:

> Pôr aqui os ficheiros. Obrigatórios antes de lançar:
> - `logo.png`: logótipo `</ND>` verde brilhante (favicon e partilha)
> - `fabio.jpg`: foto do fundador para a secção About
> - `og.png`: imagem Open Graph de 1200×630
>
> Enquanto não existirem, a secção About mostra um bloco de substituição e as partilhas
> sociais usam o cartão de texto por defeito.

## O que o código realmente usa

| Ficheiro | Usado em | Estado no original |
|---|---|---|
| `public/logo.png` | `app/layout.tsx`: `icons.icon`, `openGraph.images`, `twitter.images` | existe (cerca de 900 KB) |
| `public/og.png` | pedido no README | não é referenciado no código; há um `TODO` no `layout.tsx` |
| `public/fabio.jpg` | pedido no README | não é referenciado: o `AboutSection` não tem foto nem bloco de substituição |

## Para o teu site

1. `logo.png`: quadrado, PNG, ideal até 100 KB. O de origem pesa cerca de 900 KB: não copiar o
   peso. Serve de favicon, por isso um ficheiro quadrado fica melhor.
2. `og.png`: 1200×630, até 300 KB, com nome e frase. No `layout.tsx`:
   ```ts
   images: [{ url: "/og.png", width: 1200, height: 630 }]
   ```
   e o mesmo em `twitter.images`. O original declara `width: 1200, height: 630` para o
   `logo.png`, o que está errado se o logótipo não tiver esse tamanho.
3. Foto (opcional): `public/foto.jpg`, e acrescentar um `<Image>` do `next/image` no
   `AboutSection`. Só com autorização da pessoa.
4. Testar a partilha: colar o link no WhatsApp e no LinkedIn Post Inspector.

Esta skill não traz imagens: os ficheiros de `public/` não estão em `assets/`.
