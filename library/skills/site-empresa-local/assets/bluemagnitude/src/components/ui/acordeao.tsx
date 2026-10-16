"use client";

import * as React from "react";
import { Reveal } from "@/components/reveal";

type Item = { q: string; r: string };

/**
 * Uma pergunta aberta de cada vez.
 *
 * O HTML ja tem grupo exclusivo (o atributo name nos <details>), mas so em
 * browsers recentes, e os telemoveis a que estes clientes chegam nao sao todos
 * recentes. Por isso o estado e controlado aqui: o name fica na mesma, para
 * quem o suporta, e o React garante o resto.
 *
 * O <details> continua a ser <details>: sem JavaScript abre e fecha na mesma,
 * so perde a exclusividade. A animacao vive no conteudo e nunca na altura.
 */
export function Acordeoes({
  itens,
  grupo = "perguntas",
  passo = 70,
}: {
  itens: ReadonlyArray<Item>;
  grupo?: string;
  passo?: number;
}) {
  const [aberto, setAberto] = React.useState<number | null>(null);

  return (
    <div className="acordeoes">
      {itens.map((item, i) => (
        <Reveal
          as="details"
          key={item.q}
          className="acordeao"
          delay={i * passo}
          nome={grupo}
          aberto={aberto === i}
        >
          <summary
            className="acordeao__b"
            onClick={(evento: React.MouseEvent) => {
              evento.preventDefault();
              setAberto((actual) => (actual === i ? null : i));
            }}
          >
            <span className="h3">{item.q}</span>
            <span className="acordeao__sinal" aria-hidden="true" />
          </summary>
          <div className="acordeao__r">{item.r}</div>
        </Reveal>
      ))}
    </div>
  );
}
