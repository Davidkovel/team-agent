"use client";

import * as React from "react";
import { Marca } from "@/components/marca";
import { EMPRESA, SERVICOS } from "@/content/site";
import { ROTAS, servicoHref } from "@/content/rotas";
import { cn } from "@/lib/cn";

const NAV_CSS = `
.nav { position: fixed; top: 0; left: 0; right: 0; z-index: 60; }
.nav[data-pousado="false"] { background-color: transparent; box-shadow: none; }
.nav[data-pousado="true"] {
  background-color: var(--color-plate);
  box-shadow: inset 0 -1px 0 var(--color-line);
}
.nav {
  transition: background-color 260ms var(--ease-glide), box-shadow 260ms var(--ease-glide);
}
.nav__barra {
  display: flex; align-items: center; justify-content: space-between;
  gap: var(--s-sm); min-height: 4rem;
  padding-top: var(--safe-t);
}
.nav__espaco { height: 4rem; }
/* ⚠️ 10rem E NAO 100svh. A sentinela mede quanto tempo a barra anda
   transparente por cima do heroi, e sao 10rem, o primeiro palmo de scroll.
   Com 100svh a barra so pousava no fim do heroi inteiro: pelo meio, o
   logotipo e os links brancos ficavam por cima da lavagem clara do fundo do
   heroi e a barra desaparecia. No telemovel, onde o heroi e curto, era todo o
   scroll do heroi com a barra invisivel. */
.nav__sentinela {
  position: absolute; top: 0; left: 0; width: 1px; height: 10rem;
  pointer-events: none; visibility: hidden;
}
.nav__logo { display: block; height: 2rem; width: auto; }
/* ⚠️ AS SOMBRAS SEGURAM SOZINHAS A LEITURA. Saiu a faixa escura que havia no
   topo do heroi (video-backdrop.tsx), por isso o branco assenta directamente
   no video. Sem estas sombras projectadas, um fotograma de ceu claro come o
   logotipo e o botao do menu. */
.nav[data-pousado="false"] .nav__logo {
  filter:
    drop-shadow(0 1px 3px rgba(11,20,55,.7))
    drop-shadow(0 0 16px rgba(11,20,55,.5));
}

.nav[data-pousado="false"] .nav__hamburger {
  filter:
    drop-shadow(0 1px 3px rgba(11,20,55,.7))
    drop-shadow(0 0 12px rgba(11,20,55,.45));
}

.nav[data-pousado="false"] .nav__link {
  text-shadow: 0 1px 3px rgba(11,20,55,.7), 0 0 14px rgba(11,20,55,.45);
}
.nav__links { display: none; }
@media (min-width: 64rem) {
  .nav__links { display: flex; align-items: center; gap: var(--s-md); }
}
.nav__link {
  font-size: var(--t-label); font-weight: 600; line-height: 1.2;
  color: var(--nav-ink); padding-block: .5rem;
}
.nav__link:hover { color: var(--nav-ink-forte); }
.nav__grupo { position: relative; }
.nav__sub {
  position: absolute; top: calc(100% + .5rem); left: 50%; translate: -50% 0;
  min-width: 16rem; padding: .5rem;
  border-radius: var(--radius-plate);
  background-color: var(--color-plate);
  box-shadow: inset 0 0 0 1px var(--color-line), 0 12px 30px rgba(11,20,55,.12);
  opacity: 0; visibility: hidden; translate: -50% 6px;
  transition: opacity 200ms var(--ease-glide), translate 200ms var(--ease-glide), visibility 200ms;
}
.nav__grupo:hover .nav__sub, .nav__grupo:focus-within .nav__sub {
  opacity: 1; visibility: visible; translate: -50% 0;
}
.nav__subitem {
  display: block; padding: .625rem .75rem; border-radius: 8px;
  font-size: var(--t-label); font-weight: 500; color: var(--color-ink);
}
.nav__subitem:hover { background-color: var(--color-plate-2); }
.nav__accoes { display: flex; align-items: center; gap: .5rem; }
.nav__hamburger {
  display: inline-flex; align-items: center; justify-content: center;
  width: 2.75rem; height: 2.75rem; border-radius: 999px;
  color: var(--nav-ink);
  box-shadow: inset 0 0 0 1px var(--nav-linha);
}
@media (min-width: 64rem) { .nav__hamburger { display: none; } }
.nav__cta { display: none; }
@media (min-width: 48rem) { .nav__cta { display: inline-flex; } }

.folha {
  position: fixed; inset: 0; z-index: 70;
  display: flex; justify-content: flex-end;
}
.folha__veu { position: absolute; inset: 0; background-color: rgba(11,20,55,.45); }
.folha__caixa {
  position: relative; width: min(20rem, 88vw); height: 100%;
  overflow-y: auto;
  background-color: var(--color-plate);
  padding: var(--s-md);
  padding-top: calc(var(--s-md) + var(--safe-t));
  padding-bottom: calc(var(--s-lg) + var(--safe-b));
  box-shadow: inset 1px 0 0 var(--color-line);
}
.folha__link {
  display: flex; align-items: center; min-height: 3rem;
  font-size: 1.0625rem; font-weight: 600; color: var(--color-ink);
}
.folha__grupo {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: .5rem;
}
.folha__grupo .folha__link { flex: 1; }
.folha__seta {
  display: inline-flex; align-items: center; justify-content: center;
  width: 2.75rem; height: 2.75rem; border-radius: 999px;
  color: var(--color-ink-soft);
  box-shadow: inset 0 0 0 1px var(--color-line-lit);
}
.folha__sublink {
  display: flex; align-items: center; min-height: 2.75rem;
  padding-left: .875rem;
  font-size: var(--t-body); font-weight: 500; color: var(--color-ink-soft);
}
`;

type Props = { pousadaSempre?: boolean };

export function SiteNav({ pousadaSempre = false }: Props) {
  const sentinelaRef = React.useRef<HTMLDivElement | null>(null);
  const hamburgerRef = React.useRef<HTMLButtonElement | null>(null);
  const folhaRef = React.useRef<HTMLDivElement | null>(null);
  const [pousado, setPousado] = React.useState(pousadaSempre);
  const [aberto, setAberto] = React.useState(false);
  const [servAberto, setServAberto] = React.useState(false);

  // pousar por sentinela: zero listeners de scroll
  React.useEffect(() => {
    if (pousadaSempre) return;
    const alvo = sentinelaRef.current;
    if (!alvo) return;
    const observer = new IntersectionObserver(
      ([entrada]) => setPousado(!entrada.isIntersecting),
      { threshold: 0 },
    );
    observer.observe(alvo);
    return () => observer.disconnect();
  }, [pousadaSempre]);

  // folha: Escape fecha, scroll do corpo travado, foco de volta ao hamburger
  React.useEffect(() => {
    if (!aberto) return;

    const anterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key === "Escape") setAberto(false);
      if (evento.key !== "Tab") return;
      const caixa = folhaRef.current;
      if (!caixa) return;
      const focaveis = caixa.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled])',
      );
      if (focaveis.length === 0) return;
      const primeiro = focaveis[0];
      const ultimo = focaveis[focaveis.length - 1];
      if (evento.shiftKey && document.activeElement === primeiro) {
        evento.preventDefault();
        ultimo.focus();
      } else if (!evento.shiftKey && document.activeElement === ultimo) {
        evento.preventDefault();
        primeiro.focus();
      }
    }

    document.addEventListener("keydown", aoTeclar);
    folhaRef.current?.querySelector<HTMLElement>("a, button")?.focus();

    return () => {
      document.removeEventListener("keydown", aoTeclar);
      document.body.style.overflow = anterior;
      hamburgerRef.current?.focus();
    };
  }, [aberto]);

  const tinta = pousado
    ? {
        "--nav-ink": "var(--color-ink-soft)",
        "--nav-ink-forte": "var(--color-ink)",
        "--nav-linha": "var(--color-line-strong)",
      }
    : {
        "--nav-ink": "#ffffff",
        "--nav-ink-forte": "#ffffff",
        "--nav-linha": "rgba(255,255,255,.5)",
      };

  return (
    <>
      <style precedence="medium" href="bm-nav">
        {NAV_CSS}
      </style>

      {!pousadaSempre ? (
        <div ref={sentinelaRef} className="nav__sentinela" aria-hidden="true" />
      ) : null}

      <header
        className="nav"
        data-pousado={pousado ? "true" : "false"}
        style={tinta as React.CSSProperties}
      >
        <div className="shell nav__barra">
          <a href={ROTAS.home} aria-label={`${EMPRESA.nome}, ir para a página inicial`}>
            <Marca
              variante={pousado ? "cor" : "branco"}
              className="nav__logo"
            />
          </a>

          <nav className="nav__links" aria-label="Principal">
            <a className="nav__link" href={ROTAS.sobre}>
              Sobre nós
            </a>
            <div className="nav__grupo">
              <a className="nav__link" href={ROTAS.servicos}>
                Serviços
              </a>
              <div className="nav__sub">
                {SERVICOS.map((s) => (
                  <a
                    key={s.slug}
                    className="nav__subitem"
                    href={servicoHref(s.slug)}
                  >
                    {s.nome}
                  </a>
                ))}
              </div>
            </div>
            <a className="nav__link" href={ROTAS.projetos}>
              Projetos
            </a>
            <a className="nav__link" href={ROTAS.contacto}>
              Contactos
            </a>
          </nav>

          <div className="nav__accoes">
            <a className="btn nav__cta" href={ROTAS.contacto}>
              Pedir proposta
            </a>
            <button
              ref={hamburgerRef}
              type="button"
              className="nav__hamburger"
              aria-expanded={aberto}
              aria-label="Abrir menu"
              onClick={() => setAberto(true)}
            >
              <svg width="20" height="14" viewBox="0 0 20 14" aria-hidden="true">
                <path
                  d="M0 1h20M0 7h20M0 13h20"
                  stroke="currentColor"
                  strokeWidth="1.6"
                />
              </svg>
            </button>
          </div>
        </div>
      </header>

      {aberto ? (
        <div className="folha" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="folha__veu" onClick={() => setAberto(false)} />
          <div ref={folhaRef} className="folha__caixa">
            <div className="flex items-center justify-between">
              <a
                href={ROTAS.home}
                aria-label={`${EMPRESA.nome}, ir para a página inicial`}
                onClick={() => setAberto(false)}
              >
                <Marca variante="cor" className="h-7 w-auto" />
              </a>
              <button
                type="button"
                className="nav__hamburger"
                style={
                  {
                    "--nav-ink": "var(--color-ink)",
                    "--nav-linha": "var(--color-line-strong)",
                  } as React.CSSProperties
                }
                onClick={() => setAberto(false)}
                aria-label="Fechar menu"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <path
                    d="M1 1l14 14M15 1L1 15"
                    stroke="currentColor"
                    strokeWidth="1.6"
                  />
                </svg>
              </button>
            </div>

            <nav className="mt-[var(--s-md)] grid" aria-label="Menu">
              <a className="folha__link" href={ROTAS.sobre}>
                Sobre nós
              </a>

              {/* so as coisas principais a vista: os seis servicos abrem com a
                  seta e voltam a fechar com ela */}
              <div className="folha__grupo">
                <a className="folha__link" href={ROTAS.servicos}>
                  Serviços
                </a>
                <button
                  type="button"
                  className="folha__seta"
                  aria-expanded={servAberto}
                  aria-label={servAberto ? "Esconder os serviços" : "Mostrar os serviços"}
                  onClick={() => setServAberto((v) => !v)}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 14 14"
                    fill="none"
                    aria-hidden="true"
                    style={{
                      transform: servAberto ? "rotate(180deg)" : undefined,
                      transition: "transform 260ms var(--ease-glide)",
                    }}
                  >
                    <path
                      d="M2 5l5 5 5-5"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </div>
              {servAberto
                ? SERVICOS.map((s) => (
                    <a
                      key={s.slug}
                      className="folha__sublink"
                      href={servicoHref(s.slug)}
                    >
                      {s.nome}
                    </a>
                  ))
                : null}

              <a className="folha__link" href={ROTAS.projetos}>
                Projetos
              </a>
              <a className="folha__link" href={ROTAS.contacto}>
                Contactos
              </a>
            </nav>

            {/* ⚠️ ISTO APONTAVA PARA `/#falar` E NAO FAZIA NADA: nao ha nenhum
                elemento com esse id em lado nenhum, o formulario vive em
                /contacto/. Leva ao mesmo sitio que o CTA de desktop, e fecha a
                folha como o link do logotipo aqui em cima. */}
            <a
              className={cn("btn mt-[var(--s-md)] w-full")}
              href={ROTAS.contacto}
              onClick={() => setAberto(false)}
            >
              Pedir proposta
            </a>

            <div className="meta mt-[var(--s-md)] grid gap-[var(--s-xs)]">
              <span>{EMPRESA.morada}</span>
              <span>{EMPRESA.horario}</span>
              <a href={`mailto:${EMPRESA.email}`}>{EMPRESA.email}</a>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
