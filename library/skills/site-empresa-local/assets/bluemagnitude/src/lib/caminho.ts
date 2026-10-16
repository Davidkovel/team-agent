/**
 * Prefixo de base do site.
 *
 * Vazio na VPS, "/bluemagnitude" no GitHub Pages, que serve em subpasta. Usar
 * em tudo o que e caminho decidido em JAVASCRIPT (as fontes do video, por
 * exemplo): o basePath do Next nao lhes toca, e o scripts/prefixar.mjs so
 * alcanca atributos href/src no HTML ja escrito.
 */
const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export function caminho(p: string): string {
  if (!BASE || !p.startsWith("/") || p.startsWith(`${BASE}/`)) return p;
  return `${BASE}${p}`;
}
