"use client";

import * as React from "react";

const ALTURA_DA_BARRA = 64;

function alvoDe(hash: string) {
  if (!hash || hash === "#") return null;
  try {
    return document.querySelector<HTMLElement>(hash);
  } catch {
    return null;
  }
}

function irPara(elemento: HTMLElement, suave: boolean) {
  const y =
    elemento.getBoundingClientRect().top + window.scrollY - ALTURA_DA_BARRA;
  window.scrollTo({ top: y, behavior: suave ? "smooth" : "auto" });
}

/** Um unico listener delegado no documento. Nao desenha nada. */
export function AncorasSuaves() {
  React.useEffect(() => {
    function aoClicar(evento: MouseEvent) {
      if (evento.defaultPrevented) return;
      if (evento.button !== 0) return;
      if (evento.metaKey || evento.ctrlKey || evento.shiftKey || evento.altKey)
        return;

      const alvo = (evento.target as HTMLElement | null)?.closest("a");
      if (!alvo) return;
      if (alvo.target && alvo.target !== "_self") return;
      if (alvo.hasAttribute("download")) return;

      const href = alvo.getAttribute("href") ?? "";
      if (!href.startsWith("#")) return;

      const destino = alvoDe(href);
      if (!destino) return;

      evento.preventDefault();
      irPara(destino, true);
      history.replaceState(null, "", href);
    }

    document.addEventListener("click", aoClicar);
    return () => document.removeEventListener("click", aoClicar);
  }, []);

  // chegada vinda de fora (/#falar partilhado no WhatsApp): corrigir a posicao
  // sem animacao, depois do salto do browser, com dois rAF
  React.useEffect(() => {
    const destino = alvoDe(window.location.hash);
    if (!destino) return;
    const a = requestAnimationFrame(() => {
      requestAnimationFrame(() => irPara(destino, false));
    });
    return () => cancelAnimationFrame(a);
  }, []);

  return null;
}
