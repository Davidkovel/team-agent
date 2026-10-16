# Deploy

Dois destinos, pela ordem: **GitHub Pages** (link para o cliente ver, grátis) e, quando há domínio próprio, **Docker + Caddy** num servidor. Ficheiros em `assets/bluemagnitude/deploy/` e `assets/bluemagnitude/`.

## 1. GitHub Pages (Next.js estático)

### Config
- `next.config.ts`: `output: "export"`, `trailingSlash: true`, `images.unoptimized`, e `basePath` + `assetPrefix` = `process.env.BASE_PATH` (vazio fora do Pages). O Pages serve em subpasta (`https://<dono>.github.io/<repo>/`).
- `package.json` → `build:pages`:
  ```
  BASE_PATH=/<repo> NEXT_PUBLIC_BASE_PATH=/<repo> NEXT_PUBLIC_SITE_URL=https://<dono>.github.io/<repo> next build
    && BASE_PATH=/<repo> node scripts/prefixar.mjs && touch out/.nojekyll
  ```
- `src/lib/caminho.ts`: `caminho("/video/x.mp4")` junta o prefixo. **Qualquer caminho novo escrito à mão passa por `caminho()`** (rotas, imagens em `site.ts`, fontes de vídeo, capas). O `scripts/prefixar.mjs` reescreve `href`, `src` e `content` no HTML exportado (`.html`, `.txt`, `.xml`), mas só isso não chega: a hidratação repõe os `href` do payload.
- `.nojekyll` na raiz do `out/`, senão o Pages ignora a pasta `_next`.

### Workflow (`assets/bluemagnitude/deploy/pages.yml` → `.github/workflows/pages.yml`)

```yaml
name: Publicar no GitHub Pages
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: true
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run build:pages
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: out
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

Passos:
1. Repositório público no GitHub. Em Settings → Pages, escolhe **GitHub Actions** como fonte.
2. Troca `/bluemagnitude` e o endereço no `build:pages` pelo nome do teu repositório.
3. `git push origin main` republica sozinho.
4. Abre o link ao vivo, confirma os links internos (404 em todos = falta o prefixo) e o cartão de partilha.

Atenção: depois de um `build:pages` a pasta `out/` fica com o prefixo. Corre `npx next build` sem variáveis antes de servir localmente ou de fazer rsync para o servidor.

## 2. GitHub Pages (site estático sem build, como o Detalhes Cautelosos)

Pasta com HTML + `assets/` + `.nojekyll`, todos os caminhos com o prefixo do repositório (`/detalhes-cautelosos/...`). Pages a partir de `main` / raiz. `robots.txt` com `Disallow: /` e `noindex` enquanto for proposta. Para um site feito à mão em HTML + CSS + JS, `gh api repos/<dono>/<repo>/pages -X POST -f "source[branch]=main" -f "source[path]=/"` ativa o Pages.

## 3. Docker + Caddy (servidor próprio)

### `deploy/Dockerfile`
```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM caddy:2-alpine
COPY --from=build /app/out /srv
EXPOSE 80
```
O `next.config.ts` vive no repositório e **não é injetado**: o build local tem de ser igual ao que vai para o ar. (O `package-lock.json` não vem com a skill; gera-o no teu projeto.)

### `deploy/bluemagnitude.Caddyfile` (montado no servidor e serve `/srv`)
Cada regra existe por uma razão que já custou um bug:

- `:80` com `root * /srv` e `encode zstd gzip`. O nome público e o TLS ficam no Caddy de entrada (proxy), não aqui.
- `handle /_next/*` com `Cache-Control: public, max-age=31536000, immutable` (ficheiros com hash no nome). **Tem de vir antes do `@hidden`**, senão o `/_*` do matcher de ficheiros internos mata o `/_next/*` todo e o site fica sem CSS nem JS.
- `handle /__next*` com `no-cache` (payloads do App Router). Também antes do `@hidden`: os da raiz começam por `/_`; a assimetria fazia a navegação de volta à home cair em reload completo.
- `@hidden path */.* /_*` → `respond 404`; `@repo path /README.md /docs/* /deploy/* /src/* /package.json /package-lock.json /next.config.ts /tsconfig.json /postcss.config.mjs /.git/*` → `respond 404`. Com `handle`, não `respond` solto (o Caddy reordena diretivas soltas).
- Documentos com `Cache-Control: no-cache` e media com nome versionado a 30 dias (`*.mp4 *.webm *.webp *.jpg *.jpeg *.png *.svg *.ico *.woff2`). Sem isto o Safari guarda o HTML por heurística e um cliente fica a ver a página de ontem, que aponta para o vídeo antigo do hero.
- Cabeçalhos `X-Content-Type-Options: nosniff` e `Referrer-Policy: strict-origin-when-cross-origin`.
- `try_files {path} {path}/ {path}.html` **sem `/404.html`** no fim: com ele, um caminho inexistente devolvia 200 com o corpo do erro e o Google indexava lixo como página boa.
- `handle_errors`: reescreve para `/404.html` só quando `{err.status_code} == 404` e mantém o status 404.

### Publicar no servidor
1. Sincroniza o projeto para o servidor excluindo `node_modules`, `.next`, `out`, `.git` (`rsync -az --delete --exclude ... ./ <utilizador>@<servidor>:~/<pasta>/`).
2. No servidor: `docker compose up -d --build <serviço>`. **Nunca `--remove-orphans`** no stack onde há outros sites.
3. O container escuta numa porta interna (127.0.0.1:<porta>); o Caddy de entrada faz proxy do domínio para ele.

### DNS e domínio
- **DNS primeiro, vhost depois.** Pôr o vhost no Caddy antes do registo A existir queima o rate limit do Let's Encrypt do domínio e arrasta os outros sites do mesmo domínio.
- Domínio do cliente: registo A (ou CNAME) para o IP do servidor; só depois o vhost.
- Ao mudar de domínio, muda `NEXT_PUBLIC_SITE_URL` (cartão de partilha, canonical, `sitemap.ts`, `robots.ts`; no Blue Magnitude o `BASE` do `sitemap.ts` e o `sitemap:` do `robots.ts` estão fixos no domínio final e têm de ser trocados).

## 4. Depois de publicar

- Screenshot ao vivo a 390 e 1440 px, ao lado do site antigo.
- Cola o link no WhatsApp: tem de sair com imagem (cartão 1200x630; muda o nome do ficheiro quando mudas a imagem).
- Pede ao cliente: registo A / domínio, quem recebe os emails, aprovação final.
- Quando passa a oficial: tira o `noindex` e o `Disallow: /`, regista no Google Search Console e submete o `sitemap.xml`.
