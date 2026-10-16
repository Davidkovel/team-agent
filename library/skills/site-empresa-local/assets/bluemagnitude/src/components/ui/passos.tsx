import {
  Eye,
  Leaf,
  Target,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Reveal } from "@/components/reveal";
import { cn } from "@/lib/cn";

/**
 * OS PASSOS, E A LINHA QUE SE DESENHA ENTRE ELES.
 *
 * Nasceu como a seccao "Como trabalhamos" da homepage e passou a componente
 * quando o Sobre precisou da mesma forma para a missao, a visao, a equipa e a
 * sustentabilidade. O que era um card com fundo passou a ser isto: uma regua
 * cortada, que e a mesma linguagem do bloco extra das paginas de servico.
 *
 * ⚠️ EM TELEMOVEL NAO HA LINHA POR CIMA DO PRIMEIRO. Os passos empilham, e uma
 * linha a abrir o primeiro lia-se como o fim da seccao anterior. As que sobram
 * sao ligacoes, e desenham-se por ordem, esperam, e recolhem pela ordem
 * INVERSA (a ultima a ser desenhada e a primeira a voltar).
 *
 * ⚠️ AS KEYFRAMES SAO GERADAS AQUI, NO SERVIDOR, UMA POR POSICAO. Nao chega
 * uma keyframe partilhada com um `animation-delay` por linha: no regresso a
 * ordem inverte-se, e um delay unico nao sabe inverter. O `<style>` leva
 * `href` derivado do numero de linhas, por isso duas seccoes com o mesmo
 * numero de passos partilham o bloco e o React desduplica-o.
 *
 * ⚠️ A LINHA E UM <span> COM scaleX e nao um border a crescer: corre no
 * compositor, e uma barra esticada e recta por construcao.
 */

const ICONES: Record<string, LucideIcon> = {
  alvo: Target,
  olho: Eye,
  equipa: Users,
  folha: Leaf,
};

export type Passo = {
  titulo: string;
  texto: string;
  /** o rotulo por cima do titulo. Na homepage e "Passo 1", "Passo 2"… */
  rotulo?: string;
  /** escolhido POR NOME: uma funcao nao atravessa a fronteira servidor/cliente */
  icone?: keyof typeof ICONES;
};

const DESENHO = 520;
const PASSO = 560;
const ESPERA = 900;
const DESCANSO = 900;

const REGRESSO = 2 * PASSO + DESENHO + ESPERA;
const CICLO = REGRESSO + 2 * PASSO + DESENHO + DESCANSO;

function keyframes(quantas: number) {
  const pct = (ms: number) => ((ms / CICLO) * 100).toFixed(2);
  const blocos: string[] = [];

  for (let j = 0; j < quantas; j += 1) {
    const abre = j * PASSO;
    const fecha = REGRESSO + (quantas - 1 - j) * PASSO;

    blocos.push(`@keyframes passo-linha-${j} {
0% { transform: scaleX(0) }
${pct(abre)}% { transform: scaleX(0) }
${pct(abre + DESENHO)}% { transform: scaleX(1) }
${pct(fecha)}% { transform: scaleX(1) }
${pct(fecha + DESENHO)}% { transform: scaleX(0) }
100% { transform: scaleX(0) }
}`);
  }

  return blocos.join("\n");
}

export function Passos({
  passos,
  className,
  colunas = 4,
}: {
  passos: ReadonlyArray<Passo>;
  className?: string;
  /** quantas colunas em ecra grande. Quatro na homepage, duas no Sobre. */
  colunas?: 2 | 4;
}) {
  const linhas = passos.length - 1;

  return (
    <>
      <style precedence="medium" href={`passo-linha-${linhas}`}>
        {keyframes(linhas)}
      </style>

      <ol
        className={cn(
          "grid gap-[var(--s-md)] sm:grid-cols-2",
          colunas === 4 && "lg:grid-cols-4",
          className,
        )}
      >
        {passos.map((passo, i) => {
          const Icone = passo.icone ? ICONES[passo.icone] : undefined;

          return (
            <Reveal as="li" key={passo.titulo} className="passo" delay={i * 55}>
              {i > 0 ? (
                <span
                  className="passo__linha"
                  aria-hidden="true"
                  style={{
                    animationName: `passo-linha-${i - 1}`,
                    animationDuration: `${CICLO}ms`,
                    animationIterationCount: "infinite",
                    animationTimingFunction: "var(--ease-glide)",
                  }}
                />
              ) : null}

              <div className="passo__corpo">
                {Icone ? (
                  <span className="passo__icone" aria-hidden="true">
                    <Icone size={20} strokeWidth={1.75} />
                  </span>
                ) : null}

                {passo.rotulo ? (
                  <span className="figure" style={{ fontSize: "var(--t-label)" }}>
                    {passo.rotulo}
                  </span>
                ) : null}

                <h3 className="h3 mt-[var(--s-xs)]">{passo.titulo}</h3>
                <p className="corpo mt-[var(--s-xs)]">{passo.texto}</p>
              </div>
            </Reveal>
          );
        })}
      </ol>
    </>
  );
}
