---
name: site-estudio-ia
description: Faz o site de um estúdio digital, agência, freelancer ou portefólio (landing de serviços de IA) em Next.js 14 + TypeScript + Tailwind + Framer Motion, com todo o texto num só ficheiro lib/data.ts, SEO/Open Graph e deploy na Vercel. Método do site neodaemon.com.
---

# Site de estúdio digital / freelancer (método NeoDaemon)

## O que é

Um site de uma página com scroll (hero, sobre, produtos, serviços, contacto) mais uma página
`/work`. Feito por Fábio Cabaceira para neodaemon.com, um estúdio «AI-first». Repositório de
origem: `github.com/fabiocabaceira/NeoDaemon`. Usado com autorização dele.

Stack: Next.js 14.2.5 (App Router), TypeScript, Tailwind 3.4, Framer Motion 11, deploy na Vercel.
Sem CMS, sem base de dados, sem backend. Todo o texto e os produtos vivem em `lib/data.ts`.

O site tem 15 ficheiros de código. É pequeno de propósito: trocar o conteúdo e as cores chega
para ter outro site.

## Regras de qualidade

1. **O conteúdo está em `lib/data.ts`.** Os componentes não têm produtos, serviços nem e-mail
   escritos à mão. (No original, os títulos e parágrafos das secções ainda estão nos
   componentes: ver passo 2 e `references/modelo-de-dados.md`.)
2. **Nada inventado.** Produtos, números, clientes e prémios têm de existir. Os números do
   `AboutSection` (`4+ live systems`, `24/7`, `100%`) são do estúdio dele: nunca os copiar.
3. **Cores só por tokens** (`bg`, `surface`, `accent`, `text-primary`, `text-muted`). Nunca
   `#hex` solto dentro de um componente.
4. **Animar só `opacity` e `y`** nas secções (`initial` + `whileInView`, `once: true`).
   Laços infinitos só no hero, no logótipo e no ponto de estado.
5. **Cada página tem `title` e `description` próprios** (`export const metadata`).
6. **Imagem de partilha 1200×630 a sério** (`/og.png`), não o logótipo. O original usa
   `logo.png` e deixa um `TODO`.
7. **Sem backend no contacto**: o formulário abre um `mailto:` já escrito.
8. **Testar a 390 px** (menu hambúrguer) e a 1440 px.
9. **Português de Portugal** no texto e `lang="pt-PT"` no `<html>` quando o site é em português.
   O original está em inglês com `lang="en"`.

## Método, passo a passo

### 0. Preparar a pasta
Copiar `assets/starter/` para a pasta do projeto novo. Dois ficheiros vêm com outro nome
(para não serem ficheiros ocultos): `gitignore.txt` passa a `.gitignore` e `dockerignore.txt`
passa a `.dockerignore`. O `package-lock.json` não vem: correr `npm install` no projeto novo.
Versões em `assets/starter/package.json`.
Ler: `references/anatomia.md`.

### 1. Conteúdo em `lib/data.ts`
Abrir `assets/starter/lib/data.ts` e `assets/starter/types/index.ts`. Escrever os teus
`products` (nome, etiqueta, descrição, estado), `services` (título, descrição) e o
`contactEmail`. Descrições de 1 a 2 frases, concretas, com o que faz e para quem.
Para portefólio de freelancer: um `product` = um projeto; o `status` diz se está no ar.
Ler: `references/modelo-de-dados.md`.

### 2. Secções
Montar `app/page.tsx` pela ordem: `HeroSection`, `AboutSection`, `ProductsSection`,
`ServicesSection`, `ContactSection`. Adaptar os textos fixos de cada secção (etiqueta `//`,
título, parágrafos, `roles`, `stats`). Sem números reais, apaga o bloco `stats`. A página
`/work` (`app/work/page.tsx`) reusa o `ProductCard`. Trocar o `</ND>` do `NeoLogo.tsx` pelo teu
nome ou sigla.
Ler: `references/anatomia.md`.

### 3. Design
Mudar as 5 cores em **dois sítios iguais**: `tailwind.config.ts` (`theme.extend.colors`) e o
`:root` de `app/globals.css`. Trocar as fontes em `app/layout.tsx` (`next/font/google`). O
acento aparece também como `rgba(0,255,136,…)` em `tailwind.config.ts` (`boxShadow`),
`HeroSection.tsx`, `NeoLogo.tsx` e `globals.css` (`::selection`): trocar tudo ao mesmo tempo.
Ler: `references/sistema-de-design.md`.

### 4. Animação
Reutilizar os padrões do Framer Motion que já estão nos componentes (entrada ao scroll,
escalonada por `index * 0.08`, pulso, scan line). Valores em `references/sistema-de-design.md`,
secção «Animação». Modelos: `HeroSection.tsx`, `ProductCard.tsx`, `NeoLogo.tsx`.

### 5. SEO e Open Graph
Editar o `metadata` de `app/layout.tsx`: `metadataBase`, `title.template`, `description`,
`keywords`, `openGraph`, `twitter`, `icons`. Criar `public/og.png` (1200×630) e
`public/logo.png`.
Ler: `references/assets-publicos.md`.

### 6. Deploy
`npm run build` e depois `vercel --prod`. Passos, domínio, Docker e lista final em
`references/deploy-vercel.md`.

## Armadilhas do original (corrigir ao copiar)

- `ServicesSection.tsx` usa `bg-subtle` na grelha, mas `subtle` só está definido em
  `borderColor` no `tailwind.config.ts`. A classe `bg-subtle` não gera nada e as linhas entre
  cartões ficam sem cor. Solução: acrescentar `subtle` a `colors` ou usar `bg-white/10`.
- O README diz que `fabio.jpg` aparece no About, mas o `AboutSection.tsx` não tem foto.
- `og.png` é pedido mas não é usado; `layout.tsx` aponta `openGraph.images` para `/logo.png`.
- Os links do `Navbar.tsx` (`links`) estão fora do `data.ts`.
- `package.json` tem o script `next lint`, mas não há config de ESLint nem as dependências.
- O `Dockerfile` precisa de `package-lock.json` (usa `npm ci`).

## Mapa: que ficheiro ler em cada passo

| Passo | Ler | Copiar de |
|---|---|---|
| 0 Preparar | `references/anatomia.md` | `assets/starter/` (tudo) |
| 1 Conteúdo | `references/modelo-de-dados.md` | `assets/starter/lib/data.ts`, `types/index.ts` |
| 2 Secções | `references/anatomia.md` | `assets/starter/components/`, `app/page.tsx`, `app/work/page.tsx` |
| 3 Design | `references/sistema-de-design.md` | `tailwind.config.ts`, `app/globals.css` |
| 4 Animação | `references/sistema-de-design.md` | `HeroSection.tsx`, `ProductCard.tsx`, `NeoLogo.tsx` |
| 5 SEO | `references/assets-publicos.md` | `app/layout.tsx` |
| 6 Deploy | `references/deploy-vercel.md` | `next.config.mjs`, `Dockerfile`, `gitignore.txt` |
