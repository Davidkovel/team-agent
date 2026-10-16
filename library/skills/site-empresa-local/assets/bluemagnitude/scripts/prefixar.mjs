/**
 * Prefixa, no HTML ja exportado, todos os caminhos absolutos escritos a mao.
 *
 * O basePath do Next so alcanca o que e o Next a gerar. Este projeto usa <a> e
 * <img> normais, de proposito (nada de JS para navegar num site estatico), por
 * isso os /video, /marca, /projetos e /sobre saem do build sem prefixo e
 * partiriam num Pages servido em subpasta.
 *
 * Regra: prefixa qualquer href/src/content que comece por "/" e NAO comece ja
 * pelo prefixo. Correr depois de `next build`.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const prefixo = process.env.BASE_PATH ?? "";
if (!prefixo) {
  console.log("prefixar: BASE_PATH vazio, nada a fazer");
  process.exit(0);
}

const raiz = "out";
const alvos = [".html", ".txt", ".xml"];

async function ficheiros(dir) {
  const entradas = await readdir(dir, { withFileTypes: true });
  const lista = [];
  for (const entrada of entradas) {
    const caminho = join(dir, entrada.name);
    if (entrada.isDirectory()) lista.push(...(await ficheiros(caminho)));
    else if (alvos.some((ext) => entrada.name.endsWith(ext))) lista.push(caminho);
  }
  return lista;
}

const padrao = new RegExp(`(href|src|content)="/(?!${prefixo.slice(1)}/)`, "g");
let tocados = 0;

for (const ficheiro of await ficheiros(raiz)) {
  const original = await readFile(ficheiro, "utf8");
  const novo = original.replace(padrao, `$1="${prefixo}/`);
  if (novo !== original) {
    await writeFile(ficheiro, novo);
    tocados += 1;
  }
}

console.log(`prefixar: ${tocados} ficheiros com ${prefixo}`);
