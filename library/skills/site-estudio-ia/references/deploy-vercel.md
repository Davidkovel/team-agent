# Deploy na Vercel

## Caminho do original

README: `npm install`, `npm run dev` (http://localhost:3000), depois `vercel --prod`.

## Passos

1. `npm install` (cria `package-lock.json`).
2. `npm run build` para ver erros de TypeScript antes de publicar.
3. `npx vercel` para ligar a pasta a um projeto (primeira vez), depois `vercel --prod`.
   Em alternativa, no painel da Vercel: Import Git Repository e escolher o repositório. Cada
   `git push` na branch principal volta a publicar.
4. Domínio: painel da Vercel, Project, Settings, Domains. Aplicar os registos DNS que a Vercel
   mostra.
5. Confirmar `metadataBase` em `app/layout.tsx` com o domínio final (no original,
   `https://neodaemon.com`).

A Vercel deteta Next.js sozinha. Não é preciso `vercel.json`: o original não tem.

## Ficheiros relevantes

- `.gitignore` (`gitignore.txt` em `assets/starter/`): ignora `node_modules/`, `.next/`, `out/`,
  `build/`, `.env*.local`, `.vercel`, `*.log`, `.DS_Store`, `next-env.d.ts`.
- `next.config.mjs`: `reactStrictMode: true` e `output: "standalone"`. O `standalone` serve
  para o Docker; na Vercel é inofensivo. Pode ser removido se só usares Vercel.
- Não há variáveis de ambiente nem segredos no original. Se acrescentares alguma, vai para
  `.env.local` (já ignorado) e para Settings, Environment Variables na Vercel.

## Alternativa: Docker

O original traz um `Dockerfile` de 3 fases com `node:22-alpine`: `deps` (`npm ci`), `builder`
(`npm run build`), `runner` (copia `.next/standalone`, `.next/static` e `public`). Corre com o
utilizador não-root `nextjs` (uid 1001), `PORT=3000`, `HOSTNAME=0.0.0.0`,
`NEXT_TELEMETRY_DISABLED=1`, `CMD ["node", "server.js"]`. Precisa do `package-lock.json` e da
pasta `public/`.

```
docker build -t meu-site .
docker run -p 3000:3000 meu-site
```

## Antes de publicar

- [ ] `public/logo.png` e `public/og.png` (1200×630) existem.
- [ ] `title` e `description` de cada página.
- [ ] `contactEmail` é o teu.
- [ ] Nada do estúdio de origem ficou no código:
      `grep -ri "neodaemon\|cabaceira\|openclaw\|leiria" .`
- [ ] `npm run build` sem erros.
- [ ] Testado a 390 px e a 1440 px.
