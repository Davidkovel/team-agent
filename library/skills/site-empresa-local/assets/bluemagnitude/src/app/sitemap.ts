import type { MetadataRoute } from "next";

export const dynamic = "force-static";
import { SERVICOS, PROJETOS } from "@/content/site";
import { ROTAS, servicoHref, projetoHref } from "@/content/rotas";

const BASE = "https://bluemagnitude.imogrow.pt";

export default function sitemap(): MetadataRoute.Sitemap {
  const fixas = [
    ROTAS.home,
    ROTAS.sobre,
    ROTAS.servicos,
    ROTAS.projetos,
    ROTAS.contacto,
    ROTAS.privacidade,
  ];

  return [
    ...fixas.map((rota) => ({ url: `${BASE}${rota}` })),
    ...SERVICOS.map((s) => ({ url: `${BASE}${servicoHref(s.slug)}` })),
    ...PROJETOS.map((p) => ({ url: `${BASE}${projetoHref(p.slug)}` })),
  ];
}
