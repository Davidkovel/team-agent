import {
  BatteryCharging,
  Euro,
  Leaf,
  ShieldCheck,
  Sun,
  Wind,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { Reveal } from "@/components/reveal";
import { cn } from "@/lib/cn";

const ACUMULA = 900;
const CAI = 320;
const RESPIRO = 1200;

/** A ordem com que os icones entram numa lista, quando nao e dada outra. */
const ICONES: LucideIcon[] = [
  Sun,
  Euro,
  BatteryCharging,
  ShieldCheck,
  Leaf,
  Wind,
  Wrench,
];

type Item = string | { titulo: string; texto?: string };

/**
 * Timeline vertical com uma gota de luz a descer.
 *
 * ⚠️ NAO SAO CARDS. E uma linha com pontos (ou icones) por onde uma luz desce:
 * nasce no primeiro, acumula ate a base dele e CAI para o seguinte. A queda e
 * quase tres vezes mais rapida do que a acumulacao, e e essa diferenca de ritmo
 * que a faz ler como gota e nao como barra de progresso.
 *
 * Em vez da numeracao 01/02/03 (banida) marca cada tópico com um icone.
 *
 * ⚠️ As percentagens dos keyframes dependem do NUMERO de topicos, e
 * percentagens nao se calculam em CSS. Por isso o keyframe e gerado aqui, no
 * servidor, com um nome por comprimento e altura de passo. Duas listas iguais
 * partilham o mesmo <style>, que o React desduplica pelo href.
 *
 * ⚠️ Cada topico tem altura FIXA (--passo). E o que garante que a gota aterra
 * exactamente no centro do ponto seguinte, mesmo que um titulo parta em duas
 * linhas e outro nao.
 */
function keyframes(n: number, passoRem: number) {
  const troco = ACUMULA + CAI;
  const total = n * troco + RESPIRO;
  const pct = (ms: number) => ((ms / total) * 100).toFixed(2);
  const linhas: string[] = [
    `0% { transform: translate3d(0,0,0) scale(.5); opacity: 0 }`,
  ];

  for (let i = 0; i < n; i += 1) {
    const y = (i * passoRem).toFixed(2);
    const yBaixo = ((i + 1) * passoRem).toFixed(2);
    const inicio = i * troco;

    if (i === 0) {
      linhas.push(
        `${pct(inicio + 70)}% { transform: translate3d(0,${y}rem,0) scale(1); opacity: 1 }`,
      );
    }
    linhas.push(
      `${pct(inicio + ACUMULA)}% { transform: translate3d(0,${y}rem,0) scale(1); opacity: 1 }`,
    );

    if (i === n - 1) {
      linhas.push(
        `${pct(inicio + ACUMULA + CAI)}% { transform: translate3d(0,${y}rem,0) scale(.5); opacity: 0 }`,
      );
      break;
    }

    // estica ao soltar-se e cai
    linhas.push(
      `${pct(inicio + ACUMULA + 90)}% { transform: translate3d(0,${y}rem,0) scaleY(1.6) scaleX(.75); opacity: 1 }`,
    );
    linhas.push(
      `${pct(inicio + troco)}% { transform: translate3d(0,${yBaixo}rem,0) scale(1); opacity: 1 }`,
    );
  }

  linhas.push(`100% { opacity: 0 }`);
  return { css: linhas.join("\n"), total };
}

export function ListaLuz({
  itens,
  className,
  delayBase = 0,
  variante = "ponto",
}: {
  itens: ReadonlyArray<Item>;
  className?: string;
  delayBase?: number;
  /** "icone" da a cada topico um icone em circulo, no lugar do ponto. */
  variante?: "ponto" | "icone";
}) {
  const linhas = itens.map((item) =>
    typeof item === "string" ? { titulo: item } : item,
  );
  const comIcone = variante === "icone";
  const comTexto = linhas.some((l) => l.texto);

  // altura fixa de cada topico, em rem, escolhida pelo que la vai dentro
  const passo = comIcone ? (comTexto ? 7 : 5) : comTexto ? 5.5 : 3.5;
  const nome = `gota-${linhas.length}-${String(passo).replace(".", "-")}`;
  const { css, total } = keyframes(linhas.length, passo);

  // O ACENDER DO ICONE. Enquanto a gota esta pousada num topico, o circulo
  // inteiro enche-se de luz, nao so o miolo. Um keyframe partilhado, com um
  // delay por topico igual ao do proprio trajecto da gota. Os frames sem
  // propriedades herdam o estilo base, e e isso que faz o icone apagar-se
  // sozinho quando a gota parte.
  const troco = ACUMULA + CAI;
  const fimLit = (((ACUMULA + CAI * 0.5) / total) * 100).toFixed(2);
  const posLit = (((ACUMULA + CAI * 0.5) / total) * 100 + 4).toFixed(2);
  const cssMarca = `@keyframes ${nome}-m {
0%, ${fimLit}% {
  background-color: var(--color-accent);
  color: #0b1437;
  box-shadow: 0 0 18px 2px color-mix(in srgb, var(--color-accent) 55%, transparent);
}
${posLit}%, 100% {
  box-shadow: 0 0 0 0 transparent;
}
}`;

  return (
    <>
      <style precedence="medium" href={nome}>
        {`@keyframes ${nome} {\n${css}\n}\n${cssMarca}`}
      </style>

      <ul
        className={cn("lista-luz", comIcone && "lista-luz--icone", className)}
        style={{ "--passo": `${passo}rem` } as React.CSSProperties}
      >
        <span
          className="lista-luz__gota"
          aria-hidden="true"
          style={{ animationName: nome, animationDuration: `${total}ms` }}
        />

        {linhas.map((linha, i) => {
          const Icone = ICONES[i % ICONES.length];
          return (
            <Reveal
              as="li"
              key={linha.titulo}
              className="lista-luz__item"
              delay={delayBase + i * 55}
            >
              <span
                className="lista-luz__marca"
                aria-hidden="true"
                style={{
                  animationName: `${nome}-m`,
                  animationDuration: `${total}ms`,
                  animationDelay: `${i * troco}ms`,
                  animationIterationCount: "infinite",
                }}
              >
                {comIcone ? <Icone size={20} strokeWidth={1.75} /> : null}
              </span>
              <div className="lista-luz__texto">
                <p className="lista-luz__titulo">{linha.titulo}</p>
                {linha.texto ? (
                  <p className="corpo mt-[2px]">{linha.texto}</p>
                ) : null}
              </div>
            </Reveal>
          );
        })}
      </ul>
    </>
  );
}
