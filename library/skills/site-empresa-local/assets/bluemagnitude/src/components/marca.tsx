import { EMPRESA } from "@/content/site";
import { caminho } from "@/lib/caminho";

type Props = { variante?: "cor" | "branco"; className?: string };

/**
 * O logotipo e do cliente e nao se redesenha. Sao os ficheiros originais dele,
 * apenas recortados a caixa do conteudo.
 */
export function Marca({ variante = "cor", className }: Props) {
  const cor = variante === "cor";
  return (
    <img
      src={caminho(cor ? "/marca/logo-cor.png" : "/marca/logo-branco.png")}
      alt={EMPRESA.nome}
      width={cor ? 1305 : 690}
      height={cor ? 469 : 248}
      className={className}
      decoding="async"
    />
  );
}
