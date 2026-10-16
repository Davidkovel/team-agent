import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import "./globals.css";
import { EMPRESA } from "@/content/site";

const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-manrope",
  display: "swap",
});

/* ⚠️ O CARTAO DE PARTILHA TEM DE APONTAR PARA ONDE A IMAGEM ESTA MESMO.
   Isto estava fixo em https://bluemagnitude.imogrow.pt, que ainda nao
   responde: o WhatsApp ia buscar a imagem la, nao encontrava nada, e o link
   saia com titulo e descricao mas sem cartao. O scraper nao sabe nem quer
   saber que o site vive por agora no GitHub Pages.

   Agora a origem vem do ambiente e cada build poe a sua: o `build:pages`
   define o endereco do Pages (com a subpasta, que faz parte do endereco), e
   um build normal fica com o dominio final, para quando ele existir. O URL da
   imagem e escrito por extenso e nao deixado ao `metadataBase`, que resolve
   caminhos relativos contra a raiz do dominio e deitaria a subpasta fora. */
const ORIGEM =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://bluemagnitude.imogrow.pt";

/* ⚠️ O NOME DO FICHEIRO E A VERSAO DO CARTAO. O WhatsApp e o Facebook guardam
   o cartao pelo URL da imagem: trocar o conteudo sem trocar o nome deixa a
   conversa a mostrar o antigo durante dias. Quando o cartao mudar, muda-se
   para og-bluemagnitude-v2.jpg e nao so o ficheiro. */
const CARTAO = `${ORIGEM}/og-bluemagnitude.jpg`;

const DESCRICAO =
  "Instalação de sistemas fotovoltaicos, autoconsumo com e sem baterias, off-grid, AVAC, manutenção e consultoria em Leiria, Santarém e Lisboa.";

export const metadata: Metadata = {
  metadataBase: new URL(ORIGEM),
  title: {
    default: `${EMPRESA.nome}, energia solar para empresas em Leiria`,
    template: `%s · ${EMPRESA.nome}`,
  },
  description: DESCRICAO,
  openGraph: {
    type: "website",
    locale: "pt_PT",
    siteName: EMPRESA.nome,
    url: ORIGEM,
    title: `${EMPRESA.nome}, energia solar para empresas em Leiria`,
    description: DESCRICAO,
    /* a largura e a altura por extenso: sem elas ha clientes que mostram a
       miniatura pequena em vez do cartao grande */
    images: [
      {
        url: CARTAO,
        width: 1200,
        height: 630,
        type: "image/jpeg",
        alt: `${EMPRESA.nome}, instalações fotovoltaicas em Leiria`,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: `${EMPRESA.nome}, energia solar para empresas em Leiria`,
    description: DESCRICAO,
    images: [CARTAO],
  },
  icons: { icon: "/marca/icone.png", apple: "/marca/icone.png" },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-PT" className={manrope.variable}>
      <body>
        <a className="skip-link" href="#conteudo">
          Saltar para o conteúdo
        </a>
        {children}
      </body>
    </html>
  );
}
