import { caminho } from "@/lib/caminho";

export const ROTAS = {
  home: caminho("/"),
  sobre: caminho("/sobre/"),
  servicos: caminho("/servicos/"),
  projetos: caminho("/projetos/"),
  contacto: caminho("/contacto/"),
  privacidade: caminho("/privacidade/"),
} as const;

export const ANCORAS = {
  sobre: "#quem-somos",
  servicos: "#servicos",
  projetos: "#projetos",
  processo: "#processo",
  reels: "#instagram",
  contacto: "#falar",
  perguntas: "#perguntas",
} as const;

export const servicoHref = (slug: string) => caminho(`/servicos/${slug}/`);
export const projetoHref = (slug: string) => caminho(`/projetos/${slug}/`);
