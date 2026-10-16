import type { NextConfig } from "next";

/**
 * O BASE_PATH existe para o GitHub Pages, que serve o site numa subpasta
 * (/bluemagnitude/). Sem ele, e para a VPS, fica vazio e nada muda.
 *
 * O basePath trata do que o Next gera (/_next, metadata, sitemap). Os caminhos
 * escritos a mao neste projeto (/video, /marca, /projetos, /sobre) o Next nao
 * lhes toca: quem os prefixa e o scripts/prefixar.mjs, depois do build.
 */
const base = process.env.BASE_PATH ?? "";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  ...(base ? { basePath: base, assetPrefix: base } : {}),
};

export default nextConfig;
