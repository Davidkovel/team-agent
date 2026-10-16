# Modelo de dados (`lib/data.ts` + `types/index.ts`)

Regra: o conteúdo muda neste ficheiro, o código não.

## Tipos (`types/index.ts`)

```ts
export type ProductStatus = "Live" | "Active" | "In Development";

export interface Product {
  name: string;
  tag: string;
  description: string;
  status: ProductStatus;
}

export interface Service {
  title: string;
  description: string;
}
```

## Dados (`lib/data.ts`)

Três exportações:

| Export | Tipo | Usado por |
|---|---|---|
| `products` | `Product[]` (4 itens no original) | `ProductsSection`, `app/work/page.tsx` |
| `services` | `Service[]` (5 itens no original) | `ServicesSection` |
| `contactEmail` | `string` | `ContactSection` (mailto) |

Import com o alias `@/`: `import { products } from "@/lib/data";`.

## Campos de um produto

- `name`: nome curto (`OpenClaw`, `Autoclippers`, `Two Trim`, `Fortis`).
- `tag`: categoria em 1 a 2 palavras, aparece em maiúsculas (`AI Infrastructure`,
  `Automation`, `E-Commerce`, `Mobile App`).
- `description`: 1 a 2 frases. Diz o que faz, como, e o resultado.
- `status`: `Live`, `Active` ou `In Development`. Os dois primeiros ganham ponto verde a piscar.

## Campos de um serviço

- `title`: 2 a 3 palavras (`Mobile Apps`, `SaaS Tools`, `Funnels & Landing`,
  `Automation Systems`, `Shopify & E-Commerce`).
- `description`: uma linha, frases secas separadas por ponto.

## Estilo do texto do original

Frases curtas, verbos concretos, listas de coisas reais. Exemplos:
«Native and cross-platform apps. iOS, Android, .NET MAUI. Built to ship.»
«Full-stack web products. Auth, billing, dashboards, APIs — end to end.»

## O que NÃO está em `data.ts` no original

Textos fixos do `HeroSection` (título, frase, botões), do `AboutSection` (`roles`, `stats`,
parágrafos), títulos de secção, links do `Navbar`, `metadata` do `layout.tsx`. Se o site vai
mudar de texto muitas vezes, mover estes para `data.ts` (por exemplo `site`, `roles`, `stats`,
`navLinks`) e importá-los. É uma melhoria sobre o original, não está lá.

## Alargar o modelo

Para projeto de cliente: acrescentar campos opcionais (`url?: string`, `year?: number`) ao tipo
`Product` e mostrá-los no `ProductCard`. Se acrescentares um valor a `ProductStatus`, tens de o
acrescentar também ao objeto `statusColor` (`Record<Product["status"], string>`) em
`ProductCard.tsx`, senão não compila.
