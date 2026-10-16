"use client";

import * as React from "react";
import { movimentoReduzido, prefersLightweight } from "@/lib/lightweight";

type Props = {
  poster: string;
  posterEstreito: string;
  descricao: string;
  fontes: { largo: string; estreito: string };
  objectPosition?: string;
};

/**
 * O fundo do heroi, refeito do zero a pedido do Tomas: um <video loop> e
 * mais nada.
 *
 * ⚠️ NAO VOLTAR A POR MAQUINARIA AQUI. Ja houve duas versoes com dois <video>
 * a trocarem de lugar na fronteira do laco, vigias por fotograma, aquecimento
 * do descodificador e redes de seguranca. Continuava a fritar no iPhone. O
 * que ficou e o laco nativo do browser sobre um ficheiro codificado direito
 * (H.264 High 8 bits, yuv420p, faststart, keyframe por segundo), sem
 * costura, sem xfade, sem duplicacao.
 *
 * ⚠️ SEM GRAO POR CIMA DO VIDEO. O `.grain` e um `mix-blend-mode: overlay` a
 * ecra inteiro; compor isso sobre um video a andar e caro num telemovel e
 * deixa cair fotogramas. As capas das paginas de servico, que sao fotografia
 * parada, continuam com ele.
 *
 * ⚠️ UM VIDEO PAUSADO NUNCA FICA A VISTA. O iOS desenha o SEU botao de play
 * por cima de qualquer <video> que esteja parado, mesmo sem `controls`. Por
 * isso a opacidade segue o estado real: sobe no `playing` e cai no `pause`.
 * Enquanto ele nao anda ve-se o poster a respirar, que e o fallback desenhado,
 * e nao um rectangulo com um controlo do sistema ao meio.
 *
 * ⚠️ E VOLTA SEMPRE A ANDAR. O iOS pausa o video sozinho em poupanca de
 * bateria, ao voltar de outro separador ou depois de uma chamada, e nao o
 * retoma. Por isso o `pause` tenta logo o play outra vez, e ha ainda o
 * regresso do separador a visivel e o primeiro toque no ecra. Tres recusas
 * seguidas e o sistema esta mesmo a dizer que nao: fica o poster e so um
 * gesto ou um regresso a visivel volta a tentar, para nao ficar um ciclo de
 * play e pause a queimar bateria.
 *
 * As camadas 1, 2 e 2b sao o blend com o CampoLuz que vem a seguir e nao se
 * tocam sem ler a nota em cada uma.
 */
export function VideoBackdrop({
  poster,
  posterEstreito,
  descricao,
  fontes,
  objectPosition = "center 45%",
}: Props) {
  const [fonte, setFonte] = React.useState<string | null>(null);
  const [aTocar, setATocar] = React.useState(false);
  const [posterActivo, setPosterActivo] = React.useState(poster);

  React.useEffect(() => {
    const estreito = window.matchMedia("(max-width: 768px)").matches;
    setPosterActivo(estreito ? posterEstreito : poster);
    if (prefersLightweight() || movimentoReduzido()) return;
    setFonte(estreito ? fontes.estreito : fontes.largo);
  }, [fontes.estreito, fontes.largo, poster, posterEstreito]);

  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const recusas = React.useRef(0);

  /* muted tem de estar na propriedade E no atributo antes do autoplay, senao
     o Safari recusa. */
  const guardarRef = React.useCallback((elemento: HTMLVideoElement | null) => {
    videoRef.current = elemento;
    if (!elemento) return;
    elemento.muted = true;
    elemento.defaultMuted = true;
    elemento.setAttribute("muted", "");
  }, []);

  const tentarTocar = React.useCallback((porGesto = false) => {
    const elemento = videoRef.current;
    if (!elemento || !elemento.paused) return;
    // um gesto ou um regresso a visivel limpa a conta: o sistema pode ter
    // mudado de ideias (saiu da poupanca de bateria, por exemplo)
    if (porGesto) recusas.current = 0;
    if (recusas.current >= 3) return;
    const promessa = elemento.play();
    if (!promessa || typeof promessa.catch !== "function") return;
    promessa.catch(() => {
      recusas.current += 1;
    });
  }, []);

  React.useEffect(() => {
    if (!fonte) return;

    const aoVoltar = () => {
      if (document.visibilityState === "visible") tentarTocar(true);
    };
    const aoTocarNoEcra = () => tentarTocar(true);

    document.addEventListener("visibilitychange", aoVoltar);
    document.addEventListener("touchstart", aoTocarNoEcra, { passive: true });
    document.addEventListener("click", aoTocarNoEcra);

    return () => {
      document.removeEventListener("visibilitychange", aoVoltar);
      document.removeEventListener("touchstart", aoTocarNoEcra);
      document.removeEventListener("click", aoTocarNoEcra);
    };
  }, [fonte, tentarTocar]);

  return (
    <div className="absolute inset-0 -z-10 overflow-hidden">
      <img
        src={posterActivo}
        alt={descricao}
        className={
          aTocar
            ? "absolute inset-0 h-full w-full object-cover opacity-0 transition-opacity duration-500"
            : "hero-respira absolute inset-0 h-full w-full object-cover"
        }
        style={{ objectPosition }}
        fetchPriority="high"
        decoding="async"
      />

      {fonte ? (
        <video
          ref={guardarRef}
          className="absolute inset-0 h-full w-full object-cover"
          style={{ objectPosition, opacity: aTocar ? 1 : 0 }}
          src={fonte}
          poster={posterActivo}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          disablePictureInPicture
          controls={false}
          aria-hidden="true"
          tabIndex={-1}
          onPlaying={() => {
            recusas.current = 0;
            setATocar(true);
          }}
          onPause={() => {
            // esconde-o ANTES de o iOS ter hipotese de desenhar o botao dele,
            // e pede logo para continuar
            setATocar(false);
            tentarTocar();
          }}
          onEnded={() => tentarTocar()}
        />
      ) : null}

      {/* 1. tinta base uniforme */}
      <div
        className="absolute inset-0 bg-shell"
        style={{ opacity: "var(--scrim)" }}
      />

      {/* 2. subida do fundo: o ultimo pixel do heroi e --color-shell cheio.
          ⚠️ A ALTURA E O MEIO-TERMO SAO OS UNICOS NUMEROS DO BLEND QUE SE PODEM
          MEXER SOZINHOS: esta camada nao tem espelho no CampoLuz (a contraparte
          dela e a chapa lisa do .campo-luz). A camada 2b, essa, continua atada
          ao campo-luz. */}
      <div className="absolute inset-x-0 bottom-0 h-[46%] bg-gradient-to-t from-shell via-shell/72 to-transparent" />

      {/* 2b. a lavagem de saida.
          ESPELHA o gradiente que o CampoLuz pinta no topo dele, ancorado em
          50% 100% e com a MESMA percentagem. E esta igualdade que faz a emenda
          desaparecer: sem ela, o heroi acaba em shell puro, o campo comeca em
          shell mais 10% de verde, e a diferenca desenha uma risca horizontal a
          toda a largura. Nao se resolve mascarando o topo do campo. */}
      <div
        className="absolute inset-x-0 bottom-0 h-[60%]"
        style={{
          backgroundImage:
            "radial-gradient(140% 120vh at 50% 100%, rgba(132,200,133,0.10), rgba(132,200,133,0) 82%)",
        }}
      />
    </div>
  );
}
