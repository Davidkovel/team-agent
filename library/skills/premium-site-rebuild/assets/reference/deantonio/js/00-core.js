/* De Antonio Yachts: núcleo partilhado. Cada ficheiro de js/ é uma secção e regista-se aqui. Sem dependências. */
window.DA = (() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduz = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

  /* ---------- o estado do ecrã, lido uma vez por fotograma ----------
     innerHeight e innerWidth guardam-se no resize; scrollY lê-se no início do fotograma, antes de qualquer escrita.
     Nenhuma secção chama getBoundingClientRect no laço: as caixas vêm de DA.caixa(el), em coordenadas da página,
     medidas todas de uma vez só quando o desenho muda (resize, fontes, imagens, ResizeObserver do corpo). */
  const ecra = { y: scrollY, h: innerHeight, w: innerWidth, mexeu: true, t: 0 };
  const vh = () => ecra.h;
  const caixas = new Map(); // el -> { top, left, width, height, bottom, right } na página
  let sujas = true;
  const mede = () => {
    sujas = false;
    const y = scrollY, x = scrollX;
    // todas as leituras seguidas: um só cálculo de layout
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
  // pede nova medição no próximo fotograma (quem muda o desenho de propósito também pode chamar)
  const remede = () => { sujas = true; };
  // progresso de um elemento a atravessar o ecrã: 0 quando o topo entra por baixo, 1 quando o fundo sai por cima
  const prog = (el) => { const c = caixa(el), top = c.top - ecra.y; return clamp((ecra.h - top) / (ecra.h + c.height)); };

  /* ---------- o laço único ----------
     DA.aLer(fn): corre primeiro, só leituras (getComputedStyle, medidas); DA.aCada(fn): corre depois, as escritas.
     Assim nenhuma leitura cai depois de uma escrita no mesmo fotograma (sem layout forçado). */
  const leituras = [], fns = [];
  const aLer = (fn) => leituras.push(fn);
  const aCada = (fn) => fns.push(fn);
  let yAnt = NaN, ultimoMexe = 0;
  const corre = (lista, t) => { for (let i = 0; i < lista.length; i++) { try { lista[i](t, ecra); } catch (e) { console.error(e); } } };
  const quadro = (t) => {
    requestAnimationFrame(quadro);
    if (document.hidden) return;
    const y = scrollY;
    ecra.mexeu = y !== yAnt; ecra.y = y; ecra.t = t; yAnt = y;
    if (ecra.mexeu) ultimoMexe = t;
    // parado há meio segundo: uma medição de rotina corrige qualquer caixa que tenha mudado sem aviso
    else if (ultimoMexe && t - ultimoMexe > 500) { ultimoMexe = 0; sujas = true; }
    if (sujas && caixas.size) mede();
    corre(leituras, t);
    corre(fns, t);
  };
  requestAnimationFrame(quadro);
  // o scroll parado: trabalho pesado (refazer rotas, preparar o 3D) espera por ele, para nunca cair a meio de um gesto
  const quieto = (ms = 160) => new Promise((ok) => {
    const t0 = performance.now();
    const ve = (t) => ((t - ultimoMexe > ms || !ultimoMexe) && t - t0 > 16 ? ok() : requestAnimationFrame(ve));
    requestAnimationFrame(ve);
  });
  const ocioso = (fn, ms = 600) => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: ms }) : setTimeout(fn, 1));

  addEventListener('resize', () => { ecra.h = innerHeight; ecra.w = innerWidth; sujas = true; }, { passive: true });
  addEventListener('load', remede);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(remede);
  if ('ResizeObserver' in window) new ResizeObserver(remede).observe(document.documentElement);

  // cada carregamento começa no topo e repete a abertura do logótipo, mesmo com #âncora no endereço
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  const hashInicial = location.hash, buscaInicial = location.search;
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  scrollTo(0, 0);
  addEventListener('pageshow', (e) => { if (e.persisted) location.reload(); });
  addEventListener('beforeunload', () => scrollTo(0, 0));
  addEventListener('load', () => setTimeout(() => document.documentElement.classList.add('suave'), 400));
  return { hashInicial, buscaInicial, $, $$, reduz, clamp, vh, prog, aCada, aLer, caixa, remede, ecra, quieto, ocioso };
})();
