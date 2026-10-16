type ConexaoLeve = { saveData?: boolean; effectiveType?: string };

/**
 * Poupanca de dados ou rede fraca. No servidor devolve true, para o primeiro
 * render nunca montar video.
 *
 * NAO conta o prefers-reduced-motion: nesse caso a regra e nao haver movimento
 * automatico, e isso resolve-se com o poster, nao com a ausencia de ficheiro.
 * Quem decide isso e o proprio VideoBackdrop.
 */
export function prefersLightweight(): boolean {
  if (typeof window === "undefined") return true;

  const nav = navigator as Navigator & { connection?: ConexaoLeve };
  const ligacao = nav.connection;
  if (!ligacao) return false;
  if (ligacao.saveData) return true;
  const tipo = ligacao.effectiveType ?? "";
  return tipo === "slow-2g" || tipo === "2g";
}

/** Movimento reduzido pedido pelo sistema. SSR-safe. */
export function movimentoReduzido(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}
