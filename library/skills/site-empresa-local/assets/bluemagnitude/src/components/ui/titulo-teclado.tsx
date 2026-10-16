"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

const PASSO = 45;

/**
 * Titulo escrito a maquina, que fica escrito no fim.
 *
 * ⚠️ O texto COMPLETO esta sempre no DOM. As letras entram por opacity, uma a
 * uma, com um animation-delay por indice: se as letras fossem acrescentadas
 * por JavaScript, o leitor de ecra e o motor de busca apanhavam a frase a
 * meio, e o h1 de uma pagina de servico e exactamente aquilo por que ela e
 * encontrada.
 *
 * ⚠️ COM `aoEntrar`, A MAQUINA SO ESCREVE QUANDO A FRASE CHEGA AO ECRA. As
 * letras nascem em pausa e o `Reveal` a volta liberta-as ao marcar
 * `data-shown`. Sem isto, um titulo a meio da pagina ja tinha acabado de se
 * escrever quando alguem la chegava, e o gesto perdia-se todo.
 *
 * ⚠️ A quebra de linha e por PALAVRA: cada palavra vive num span nowrap e o
 * espaco entre palavras e texto normal, onde a linha pode partir. Com as
 * letras soltas, o browser partia a meio de uma palavra ou nao partia de todo
 * e o titulo saia do ecra no telemovel.
 */
export function TituloTeclado({
  texto,
  className,
  as: Tag = "h1",
  aoEntrar = false,
}: {
  texto: string;
  className?: string;
  as?: "h1" | "h2";
  /** espera pelo Reveal que o envolve, em vez de escrever ao carregar */
  aoEntrar?: boolean;
}) {
  const palavras = React.useMemo(() => texto.split(" "), [texto]);
  const total = Array.from(texto).length * PASSO;

  let indice = 0;

  return (
    <Tag
      className={cn("teclado", aoEntrar && "teclado--ao-entrar", className)}
      style={{ "--tecla-fim": `${total}ms` } as React.CSSProperties}
    >
      <span className="sr-so-leitor">{texto}</span>
      <span aria-hidden="true">
        {palavras.map((palavra, p) => {
          const inicio = indice;
          indice += Array.from(palavra).length + 1; // +1 pelo espaco
          return (
            <React.Fragment key={`${palavra}-${p}`}>
              {p > 0 ? " " : null}
              <span className="teclado__palavra">
                {Array.from(palavra).map((letra, i) => (
                  <span
                    key={i}
                    className="teclado__l"
                    style={{ animationDelay: `${(inicio + i) * PASSO}ms` }}
                  >
                    {letra}
                  </span>
                ))}
              </span>
            </React.Fragment>
          );
        })}
        <span
          className="teclado__cursor"
          /* o blink comeca ja, o apagar so no fim: um atraso por animacao */
          style={{ animationDelay: `0ms, ${total}ms` }}
        />
      </span>
    </Tag>
  );
}
