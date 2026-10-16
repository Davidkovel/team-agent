import { Reveal } from "@/components/reveal";
import { cn } from "@/lib/cn";

type Props = {
  /** o rotulo pequeno por cima do titulo. Sem ele, o titulo abre a seccao. */
  credito?: string;
  titulo: string;
  tituloId?: string;
  lede?: string;
  className?: string;
  nivel?: 1 | 2;
};

/** O ritmo do cabecalho decidido uma vez: credito, 8px, titulo, 12px, lede. */
export function CabecalhoSeccao({
  credito,
  titulo,
  tituloId,
  lede,
  className,
  nivel = 2,
}: Props) {
  const Titulo = nivel === 1 ? "h1" : "h2";

  return (
    <Reveal className={className}>
      {credito ? <p className="credito">{credito}</p> : null}
      <Titulo
        id={tituloId}
        className={cn(
          nivel === 1 ? "display" : "title",
          "mt-[var(--s-xs)] max-w-[26ch]",
        )}
      >
        {titulo}
      </Titulo>
      {lede ? <p className="lede mt-[var(--s-sm)]">{lede}</p> : null}
    </Reveal>
  );
}
