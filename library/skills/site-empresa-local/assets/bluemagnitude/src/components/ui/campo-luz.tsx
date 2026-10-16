import type { ReactNode } from "react";

/**
 * A camada de luz sob todo o conteudo depois do heroi.
 *
 * O verde sobe do video em cima, o azul assenta no rodape em baixo. As
 * percentagens do foco de cima tem de ser IGUAIS as da lavagem de saida do
 * heroi (video-backdrop, camada 2b): e essa igualdade que faz a costura
 * desaparecer. Mudar uma sem mudar a outra traz de volta a risca horizontal.
 */
export function CampoLuz({ children }: { children: ReactNode }) {
  return (
    <div className="campo-luz">
      <div className="campo-luz__luz" aria-hidden="true" />
      <div className="campo-luz__conteudo">{children}</div>
    </div>
  );
}
