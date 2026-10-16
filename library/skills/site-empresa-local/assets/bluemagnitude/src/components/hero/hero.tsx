import { VideoBackdrop } from "@/components/hero/video-backdrop";
import { HERO } from "@/content/site";
import { caminho } from "@/lib/caminho";
import { ANCORAS, ROTAS } from "@/content/rotas";

export function Hero() {
  return (
    <section className="relative isolate flex min-h-[100svh] flex-col justify-end overflow-hidden">
      <VideoBackdrop
        poster={caminho("/video/hero-poster-lg.webp")}
        posterEstreito={caminho("/video/hero-poster-vert.webp")}
        descricao={HERO.videoAlt}
        fontes={{
          largo: caminho("/video/hero-lg.mp4"),
          estreito: caminho("/video/hero-vert.mp4"),
        }}
      />

      <div
        className="shell relative z-10 w-full"
        style={{
          paddingBottom: "calc(var(--s-sm) + var(--safe-b))",
          paddingTop: "calc(var(--s-xl) + var(--safe-t))",
        }}
      >
        <p className="credito rise [animation-delay:40ms]">{HERO.credito}</p>

        <h1 className="display rise mt-[var(--s-xs)] max-w-[16ch] text-ink [animation-delay:80ms] lg:max-w-[24ch]">
          {HERO.titulo}{" "}
          <span className="text-ink-soft">{HERO.tituloDestaque}</span>
        </h1>

        <div className="rise mt-[var(--s-md)] flex flex-wrap gap-3 [animation-delay:280ms] sm:gap-4">
          <a className="btn flex-1 sm:flex-none" href={ROTAS.contacto}>
            {HERO.primario}
          </a>
          <a
            className="btn btn--contorno flex-1 sm:flex-none"
            href={ANCORAS.projetos}
          >
            {HERO.secundario}
          </a>
        </div>
      </div>
    </section>
  );
}
