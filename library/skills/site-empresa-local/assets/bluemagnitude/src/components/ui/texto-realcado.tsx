import * as React from "react";

/**
 * Texto com as partes que contam em destaque.
 *
 * O conteudo vive em `content/site.ts` como texto simples com as marcas
 * `**assim**`. Aqui parte-se nessas marcas e envolve-se o que esta dentro num
 * <strong>.
 *
 * ⚠️ NAO E HTML DENTRO DO CONTEUDO, e a diferenca importa: uma string com
 * markup e uma porta aberta para `dangerouslySetInnerHTML` e para um ficheiro
 * de conteudo que ninguem sem React consegue editar. Duas estrelas toda a
 * gente sabe escrever.
 */
export function TextoRealcado({
  texto,
  className,
}: {
  texto: string;
  className?: string;
}) {
  const partes = texto.split("**");

  return (
    <p className={className}>
      {partes.map((parte, i) =>
        i % 2 === 1 ? (
          <strong key={i} className="realce">
            {parte}
          </strong>
        ) : (
          <React.Fragment key={i}>{parte}</React.Fragment>
        ),
      )}
    </p>
  );
}
