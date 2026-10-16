"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

const subscreverNada = () => () => {};
const vivoNoCliente = () => true;
const vivoNoServidor = () => false;

type Tag = "div" | "section" | "li" | "figure" | "p" | "details" | "article";

type Props = {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  as?: Tag;
  repetir?: boolean;
  /** so para as = "details": o grupo exclusivo nativo do HTML */
  nome?: string;
  /** so para as = "details": estado controlado */
  aberto?: boolean;
};

/**
 * O motor de animacao do site.
 *
 * Tres detalhes decidem se isto funciona:
 * 1. `armed` vem de useSyncExternalStore e nao de useState + useEffect. A
 *    classe .reveal (opacity: 0) so entra depois de montar, para quem tem JS
 *    bloqueado nao ficar com a pagina em branco, e sem custar um render extra
 *    por cada Reveal.
 * 2. DOIS requestAnimationFrame encadeados antes de setShown(true). O callback
 *    do observador corre antes do passo de pintura; com um so rAF o browser
 *    resolve os dois estados no mesmo frame, nunca pinta o opacity: 0 e nao ha
 *    nada para animar.
 * 3. threshold 0 e ZERO rootMargin negativo. Um rootMargin negativo condena o
 *    que cai nos ultimos por cento do documento a ficar invisivel para sempre,
 *    e o azarado e sempre o rodape, que e onde estao os contactos.
 */
export function Reveal({
  children,
  className,
  delay,
  as = "div",
  repetir = false,
  nome,
  aberto,
}: Props) {
  const ref = React.useRef<HTMLElement | null>(null);
  const [shown, setShown] = React.useState(false);
  const armed = React.useSyncExternalStore(
    subscreverNada,
    vivoNoCliente,
    vivoNoServidor,
  );

  React.useEffect(() => {
    const alvo = ref.current;
    if (!alvo) return;

    let vivo = true;
    let pedido = 0;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          pedido = requestAnimationFrame(() => {
            if (!vivo) return;
            pedido = requestAnimationFrame(() => {
              if (vivo) setShown(true);
            });
          });
          if (!repetir) observer.disconnect();
        } else if (repetir) {
          setShown(false);
        }
      },
      { threshold: 0 },
    );

    observer.observe(alvo);

    return () => {
      vivo = false;
      cancelAnimationFrame(pedido);
      observer.disconnect();
    };
  }, [repetir]);

  const Tag = as as React.ElementType;

  return (
    <Tag
      ref={ref}
      className={cn(armed && "reveal", className)}
      data-shown={shown ? "true" : undefined}
      name={nome}
      open={aberto}
      style={
        delay
          ? ({ "--reveal-delay": `${delay}ms` } as React.CSSProperties)
          : undefined
      }
    >
      {children}
    </Tag>
  );
}
