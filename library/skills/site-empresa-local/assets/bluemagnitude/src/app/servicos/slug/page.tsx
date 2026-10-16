import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SiteNav } from "@/components/site-nav";
import { SiteFooter } from "@/components/site-footer";
import { AncorasSuaves } from "@/components/ancoras-suaves";
import { CampoLuz } from "@/components/ui/campo-luz";
import { Reveal } from "@/components/reveal";
import { TextoRealcado } from "@/components/ui/texto-realcado";
import { CapaFoto } from "@/components/ui/capa-foto";
import { ListaLuz } from "@/components/ui/lista-luz";
import { SERVICOS } from "@/content/site";
import { ROTAS } from "@/content/rotas";

export function generateStaticParams() {
  return SERVICOS.map((s) => ({ slug: s.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const servico = SERVICOS.find((s) => s.slug === slug);
  if (!servico) return {};
  return {
    title: servico.nome,
    description: servico.resumo,
    openGraph: { images: [servico.imagem] },
  };
}

export default async function PaginaServico({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const servico = SERVICOS.find((s) => s.slug === slug);
  if (!servico) notFound();

  return (
    <>
      {/* a barra nasce transparente sobre a capa e pousa quando ela acaba,
          exactamente como na homepage */}
      <SiteNav />
      <AncorasSuaves />

      <main id="conteudo" tabIndex={-1}>
        {/* A CAPA: a fotografia do servico e o hero da pagina, com o mesmo
            sistema de blend do heroi principal: tinta base, subida do fundo
            ate --color-shell cheio, e a lavagem verde espelhada do CampoLuz
            para a emenda nao existir. */}
        <CapaFoto
          imagem={servico.imagem}
          credito={servico.credito}
          titulo={servico.titulo}
          migalhas={[
            { rotulo: "Serviços", href: ROTAS.servicos },
            { rotulo: servico.nome },
          ]}
        />

        <CampoLuz>
          <section className="field-shell section--tight" aria-label="O serviço">
            <div className="shell">
              {/* como nas fichas de projeto: as partes que contam em
                  destaque, com as marcas ** do site.ts */}
              <Reveal delay={150}>
                <TextoRealcado className="corpo" texto={servico.intro} />
              </Reveal>
            </div>
          </section>

          <section className="field-shell section--tight" aria-labelledby="ganhos-t">
            <div className="shell grid gap-[var(--s-lg)] lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
              <Reveal>
                <h2 id="ganhos-t" className="title max-w-[20ch]">
                  {servico.listaTitulo}
                </h2>
              </Reveal>
              <ListaLuz itens={servico.lista} variante="icone" delayBase={90} />
            </div>
          </section>

          {servico.extra && servico.extraTitulo ? (
            <section className="field-shell section--tight" aria-labelledby="extra-t">
              <div className="shell">
                <Reveal>
                  <h2 id="extra-t" className="title max-w-[24ch]">
                    {servico.extraTitulo}
                  </h2>
                </Reveal>
                <ol className="mt-[var(--s-md)] grid gap-[var(--s-md)] sm:grid-cols-2 lg:grid-cols-3">
                  {servico.extra.map((item, i) => (
                    <Reveal as="li" key={item.titulo} delay={i * 90}>
                      <div
                        className="pt-[var(--s-sm)]"
                        style={{ borderTop: "2px solid var(--color-line-strong)" }}
                      >
                        <h3 className="h3">{item.titulo}</h3>
                        {item.texto ? (
                          <p className="corpo mt-[var(--s-xs)]">{item.texto}</p>
                        ) : null}
                      </div>
                    </Reveal>
                  ))}
                </ol>
              </div>
            </section>
          ) : null}

        </CampoLuz>
      </main>

      <SiteFooter />
    </>
  );
}
