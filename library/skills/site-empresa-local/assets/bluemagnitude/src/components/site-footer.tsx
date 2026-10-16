import { Marca } from "@/components/marca";
import { EMPRESA } from "@/content/site";
import { ROTAS } from "@/content/rotas";

const ANO = 2026;

function Social({
  href,
  rotulo,
  children,
}: {
  href: string;
  rotulo: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={rotulo}
      className="inline-flex h-11 w-11 items-center justify-center rounded-full"
      style={{ boxShadow: "inset 0 0 0 1px var(--field-line-strong)" }}
    >
      {children}
    </a>
  );
}

export function SiteFooter() {
  return (
    <>
      {/* ⚠️ O CTA NAO E RODAPE. Estava dentro da chapa escura, colado a ela, e
          lia-se como o principio do rodape em vez do fim da pagina. Aqui fica
          na cor do que vem por cima dele, e o escuro so comeca depois. */}
      <section className="field-shell rodape__cta" aria-label="Falar connosco">
        <div className="shell flex flex-col gap-[var(--s-sm)] sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="title" style={{ fontSize: "var(--t-h3)" }}>
              {EMPRESA.promessa}
            </p>
            <p className="meta mt-[2px] rodape__so-largo">
              Proposta gratuita e sem compromisso.
            </p>
          </div>
          {/* ⚠️ LEVA AO FORMULARIO, NAO AO WHATSAPP. O botao aqui abria a
              conversa com uma frase generica, e a pagina de contactos tem o
              pedido em tres passos, que chega ao WhatsApp ja com o servico, o
              distrito e o contacto escritos. Um pedido preenchido vale mais do
              que um "ola" solto. */}
          <a className="btn" href={ROTAS.contacto}>
            Pedir proposta
          </a>
        </div>
      </section>

      <footer className="field-deep">
        <div className="shell rodape">

        {/* ⚠️ UM BOTAO EM VEZ DA LISTA DE CONTACTOS. A morada, o email, o
            telefone e o horario ocupavam metade do rodape e repetiam a pagina
            de contactos, que e onde eles vivem com mapa e formulario. */}
        <div className="rodape__base">
          <div className="rodape__marca">
            <Marca variante="branco" className="h-9 w-auto" />
            <div className="flex gap-[var(--s-xs)]">
              <Social href={EMPRESA.instagram} rotulo="Instagram">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <rect x="3" y="3" width="18" height="18" rx="5" stroke="currentColor" strokeWidth="1.6" />
                  <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.6" />
                  <circle cx="17.5" cy="6.5" r="1.2" fill="currentColor" />
                </svg>
              </Social>
              <Social href={EMPRESA.facebook} rotulo="Facebook">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M14 8.5V7c0-.8.5-1 1-1h1.5V3H14c-2.2 0-3.5 1.3-3.5 3.5v2H8V12h2.5v9H14v-9h2.3l.4-3.5H14z"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinejoin="round"
                  />
                </svg>
              </Social>
            </div>
          </div>

          <a className="btn btn--contorno rodape__contactos" href={ROTAS.contacto}>
            Contactos
          </a>
        </div>

        <div
          className="rodape__legal"
          style={{ borderTop: "1px solid var(--field-line)" }}
        >
          <p className="meta">
            © {ANO} {EMPRESA.nome}
          </p>
          <div className="flex flex-wrap gap-[var(--s-sm)]">
            <a className="meta" href={ROTAS.privacidade}>
              Política de privacidade
            </a>
            <a
              className="meta"
              href="https://www.livroreclamacoes.pt/inicio"
              target="_blank"
              rel="noopener noreferrer"
            >
              Livro de reclamações
            </a>
          </div>
        </div>
        </div>
      </footer>
    </>
  );
}
