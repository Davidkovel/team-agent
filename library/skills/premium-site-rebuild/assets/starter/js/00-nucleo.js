/* Ferreras: núcleo. Un solo bucle de fotogramas para todo el sitio; cada archivo de js/ es una sección que se registra aquí.
   Las cajas se miden todas juntas sólo cuando el dibujo cambia (resize, fuentes, imágenes, ResizeObserver),
   en coordenadas de página; ninguna sección llama a getBoundingClientRect dentro del bucle.
   Primero corren las lecturas (aLer), después las escrituras (aCada): nunca se fuerza un layout a mitad de fotograma. */
window.SITE = (() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduz = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const ecra = { y: scrollY, h: innerHeight, w: innerWidth, mexeu: true, t: 0, dt: 16 };
  const caixas = new Map();
  let sujas = true;
  const mede = () => {
    sujas = false;
    const y = scrollY, x = scrollX;
    for (const [el, c] of caixas) {
      const r = el.getBoundingClientRect();
      c.top = r.top + y; c.left = r.left + x; c.width = r.width; c.height = r.height; c.bottom = c.top + r.height; c.right = c.left + r.width;
    }
  };
  const caixa = (el) => {
    let c = caixas.get(el);
    if (!c) { c = { top: 0, left: 0, width: 0, height: 0, bottom: 0, right: 0 }; caixas.set(el, c); sujas = true; }
    if (sujas) mede();
    return c;
  };
  const remede = () => { sujas = true; };
  // progreso de un elemento al atravesar la pantalla: 0 cuando su borde superior entra por abajo, 1 cuando el inferior sale por arriba
  const prog = (el) => { const c = caixa(el), top = c.top - ecra.y; return clamp((ecra.h - top) / (ecra.h + c.height)); };
  // progreso de una sección fijada (sticky): 0 al fijarse, 1 al soltarse
  const fixado = (el) => { const c = caixa(el); return clamp((ecra.y - c.top) / Math.max(1, c.height - ecra.h)); };

  const leituras = [], escritas = [];
  let yAnt = NaN, ultimoMexe = 0, tAnt = 0;
  const corre = (l, t) => { for (let i = 0; i < l.length; i++) { try { l[i](t, ecra); } catch (e) { console.error(e); } } };
  const quadro = (t) => {
    requestAnimationFrame(quadro);
    if (document.hidden) return;
    const y = scrollY;
    ecra.mexeu = y !== yAnt; ecra.y = y; ecra.dt = Math.min(64, t - (tAnt || t)); ecra.t = t; yAnt = y; tAnt = t;
    if (ecra.mexeu) ultimoMexe = t;
    else if (ultimoMexe && t - ultimoMexe > 500) { ultimoMexe = 0; sujas = true; }
    if (sujas && caixas.size) mede();
    corre(leituras, t);
    corre(escritas, t);
  };
  requestAnimationFrame(quadro);
  // el trabajo pesado espera a que el scroll se pare: nunca cae a mitad de un gesto
  const quieto = (ms = 160) => new Promise((ok) => {
    const t0 = performance.now();
    const ve = (t) => ((t - ultimoMexe > ms || !ultimoMexe) && t - t0 > 16 ? ok() : requestAnimationFrame(ve));
    requestAnimationFrame(ve);
  });
  const ocioso = (fn, ms = 600) => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: ms }) : setTimeout(fn, 1));
  // duración de un token del CSS, en ms (los tiempos del JS salen de los mismos tokens)
  const token = (n) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(n)) || 200;

  addEventListener('resize', () => { ecra.h = innerHeight; ecra.w = innerWidth; sujas = true; }, { passive: true });
  addEventListener('load', remede);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(remede);
  if ('ResizeObserver' in window) new ResizeObserver(remede).observe(document.documentElement);
  addEventListener('pageshow', (e) => { if (e.persisted) location.reload(); });
  addEventListener('load', () => setTimeout(() => document.documentElement.classList.add('suave'), 400));

  // la apertura avisa cuando el logotipo se posa; sin apertura, ya está abierto
  let abre; const abertura = new Promise((r) => (abre = r));
  const aberto = () => { abre(); document.dispatchEvent(new Event('site:aberto')); };
  return { $, $$, reduz, clamp, prog, fixado, caixa, remede, ecra, quieto, ocioso, token, abertura, aberto, aLer: (f) => leituras.push(f), aCada: (f) => escritas.push(f) };
})();
