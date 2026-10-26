/* scroll.js — o motor do site de scroll infinito (skill site-scroll-infinito). Sem bibliotecas, sem build.

   Um só laço requestAnimationFrame. Em cada fotograma lê o scroll uma vez, mede as caixas só quando o desenho mudou
   (nunca getBoundingClientRect dentro do laço), e cada peça escreve no DOM só quando o seu valor muda.
   Só mexem transform e opacity (e o canvas dos fotogramas).

   Peças, por atributos no HTML (o SKILL.md tem a tabela com exemplos):
     [data-cena]                 secção alta com palco fixo (.palco); o progresso 0→1 anda com o scroll. Altura: --ecras
       canvas[data-fotogramas]   filme de fotogramas: data-dir, data-n, data-ext, data-dir-tel, data-n-tel, data-foco, data-poster
       .mundo [data-z]           mundo de camadas: a câmara avança pelo eixo z até data-viagem (na .mundo)
       [data-beat]               aparece entre data-de e data-ate (data-beat="fade": só a opacidade)
       [data-peca]               anda entre data-de e data-ate: data-dx (vw), data-dy (vh), data-rot (graus), data-escala,
                                 data-op0 → data-op (opacidade)
       [data-pct]                escreve a percentagem da cena
     [data-faixa]                faixa infinita (marquee); acelera e muda de sentido com o scroll
     [data-conta]                número que conta ao entrar (data-casas para decimais, data-dur em ms)
     [data-cai]                  os filhos caem um a um enquanto a secção sobe
     [data-cor] / [data-tinta]   a cor da página muda quando a secção chega ao meio do ecrã
     [data-volta]                (numa [data-cena]) depois do rodapé a viagem recomeça sem corte: scroll infinito a sério
     [data-progresso-pagina]     elemento que estica com o progresso da página (scaleX)
     [data-pct-pagina]           escreve a percentagem da página
*/
(() => {
  'use strict';
  const doc = document.documentElement;
  // The OS "reduce motion" setting is NOT followed here: Windows with animation effects off froze the whole journey
  // for the owner. The still version stays available with ?quieto=1 (for testing and screenshots).
  const reduz = /[?&]quieto=1(&|$)/.test(location.search);
  const tactil = matchMedia('(hover: none)').matches;
  doc.classList.add('js');
  if (reduz) doc.classList.add('quieto');
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

  const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
  const sai = (k) => 1 - Math.pow(1 - k, 3);                                   // a curva de saída, igual em todo o site
  const vaiVem = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
  const num = (v, d = 0) => (v === undefined || v === null || v === '' || isNaN(+v) ? d : +v);

  const ecra = { y: scrollY, h: innerHeight, w: innerWidth, vel: 0 };
  const caixas = new Map();
  const aoMedir = [];
  let sujas = true;
  const caixa = (el) => {
    let c = caixas.get(el);
    if (!c) { c = { top: 0, h: 0 }; caixas.set(el, c); sujas = true; }
    return c;
  };
  function mede() {
    sujas = false;
    const y = scrollY;
    for (const [el, c] of caixas) { const r = el.getBoundingClientRect(); c.top = r.top + y; c.h = r.height; }
    for (const f of aoMedir) f();
  }
  const visivel = (c, folga = 0) => ecra.y + ecra.h > c.top - folga && ecra.y < c.top + c.h + folga;

  /* ---------- imagens partilhadas (a cena e a cópia da volta usam as mesmas) ---------- */
  const cache = new Map();
  function imagem(url) {
    let pr = cache.get(url);
    if (!pr) {
      const im = new Image();
      im.decoding = 'async';
      im.src = url;
      pr = im.decode().then(() => im);
      cache.set(url, pr);
    }
    return pr;
  }

  /* ---------- filme de fotogramas num canvas ---------- */
  function fotogramas(cv, sec) {
    const tel = !!cv.dataset.dirTel && matchMedia('(max-width: 760px) and (orientation: portrait)').matches;
    const dir = tel ? cv.dataset.dirTel : cv.dataset.dir;
    const n = Math.max(1, Math.round(num(tel ? cv.dataset.nTel : cv.dataset.n, 1)));
    const ext = cv.dataset.ext || 'webp';
    const foco = num(cv.dataset.foco, 0.5);
    const url = (i) => `${dir}${String(i + 1).padStart(4, '0')}.${ext}`;
    const g = cv.getContext('2d', { alpha: false });
    const imgs = new Array(n);
    const m = { sujo: true, anda };
    let alvo = 0, feito = -1, W = 0, H = 0;

    // ordem de carga: primeiro e último, depois de 32 em 32, 16, 8, 4, 2, 1 — o scrub funciona logo e vai ficando fino
    const ordem = [];
    const visto = new Uint8Array(n);
    const junta = (i) => { if (i >= 0 && i < n && !visto[i]) { visto[i] = 1; ordem.push(i); } };
    junta(0); junta(n - 1);
    for (let passo = 32; passo >= 1; passo >>= 1) for (let i = 0; i < n; i += passo) junta(i);
    let k = 0, aCorrer = 0, comecou = false;
    function puxa() {
      while (aCorrer < 6 && k < ordem.length) {
        const i = ordem[k++];
        aCorrer++;
        imagem(url(i))
          .then((im) => { imgs[i] = im; if (feito < 0 || Math.abs(i - alvo) < Math.abs(feito - alvo)) m.sujo = true; })
          .catch(() => {})
          .finally(() => { aCorrer--; puxa(); });
      }
    }
    new IntersectionObserver((es, io) => {
      if (es.some((e) => e.isIntersecting) && !comecou) { comecou = true; io.disconnect(); puxa(); }
    }, { rootMargin: '200% 0px' }).observe(sec);

    function tamanho() {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      let w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr);
      const max = 5e6;                                   // tecto de píxeis: acima disto o telemóvel engasga
      if (w * h > max) { const f = Math.sqrt(max / (w * h)); w = Math.round(w * f); h = Math.round(h * f); }
      if (w && h && (w !== W || h !== H)) { W = cv.width = w; H = cv.height = h; feito = -1; m.sujo = true; }
    }
    aoMedir.push(tamanho);
    tamanho();

    function perto(i) {
      if (imgs[i]) return i;
      for (let d = 1; d < n; d++) { if (imgs[i - d]) return i - d; if (imgs[i + d]) return i + d; }
      return -1;
    }
    function anda(p) {
      m.sujo = false;
      alvo = Math.round((reduz ? num(cv.dataset.poster, 0) : p) * (n - 1));
      const i = perto(alvo);
      if (i < 0 || i === feito || !W) return;
      const im = imgs[i];
      const f = Math.max(W / im.naturalWidth, H / im.naturalHeight);   // cover, com o foco horizontal escolhido
      const w = im.naturalWidth * f, h = im.naturalHeight * f;
      g.drawImage(im, (W - w) * foco, (H - h) / 2, w, h);
      feito = i;
    }
    return m;
  }

  /* ---------- mundo de camadas: a câmara voa pelo eixo z ----------
     Cada camada tem data-z (distância, em unidades P). Com a câmara em `cam`, a camada fica a r = z - cam e escala 1/r:
     com r = 1 enche exatamente o tamanho que tem no CSS. data-x / data-y deslocam-na (fração do palco, a r = 1).
     Aparece ao longe (data-longe, 3.2) e some-se ao passar pela câmara (data-perto, 0.16). */
  function mundo(el) {
    const viagem = num(el.dataset.viagem, 4);
    const cams = [...el.querySelectorAll('[data-z]')].map((c) => ({
      el: c, z: num(c.dataset.z, 1), fx: num(c.dataset.x), fy: num(c.dataset.y),
      longe: num(c.dataset.longe, 3.2), perto: num(c.dataset.perto, 0.16), ant: '', viva: false,
    }));
    cams.forEach((c) => { c.el.style.zIndex = String(Math.round(100000 - c.z * 1000)); });
    let W = el.clientWidth, H = el.clientHeight;
    aoMedir.push(() => { W = el.clientWidth; H = el.clientHeight; for (const c of cams) c.ant = ''; m.sujo = true; });
    const m = { sujo: true, anda };
    function anda(p) {
      m.sujo = false;
      const cam = (reduz ? 0 : p) * viagem;
      for (const c of cams) {
        const r = c.z - cam;
        const o = r <= c.perto ? 0 : clamp((r - c.perto) / 0.3) * clamp((c.longe - r) / 1.1);
        if (o < 0.003) {
          if (c.viva) { c.viva = false; c.ant = ''; c.el.classList.remove('viva'); }
          continue;
        }
        if (!c.viva) { c.viva = true; c.el.classList.add('viva'); }
        const s = 1 / r;
        const chave = s.toFixed(4) + '|' + o.toFixed(3);
        if (chave === c.ant) continue;
        c.ant = chave;
        c.el.style.transform = `translate3d(${(c.fx * W * s).toFixed(1)}px, ${(c.fy * H * s).toFixed(1)}px, 0) scale(${s.toFixed(4)})`;
        c.el.style.opacity = o.toFixed(3);
      }
    }
    return m;
  }

  /* ---------- texto que entra e sai numa janela do progresso ---------- */
  function beat(b, p) {
    const L = Math.max(0.001, b.ate - b.de);
    const fade = Math.min(0.08, L * 0.3);
    let o, y;
    if (p < b.de || p > b.ate) { o = 0; y = p < b.de ? 1 : -1; }
    else {
      const ent = b.de <= 0 ? 1 : clamp((p - b.de) / fade);
      const sa = b.ate >= 1 ? 1 : clamp((b.ate - p) / fade);
      o = Math.min(sai(ent), sai(sa));
      y = ent < 1 ? 1 - sai(ent) : sa < 1 ? -(1 - sai(sa)) : 0;
    }
    const chave = o.toFixed(3) + (b.so ? '' : '|' + y.toFixed(3));
    if (chave === b.ant) return;
    b.ant = chave;
    b.el.style.opacity = o.toFixed(3);
    if (!b.so) b.el.style.transform = `translate3d(0, ${(y * 48).toFixed(1)}px, 0)`;
    b.el.classList.toggle('off', o < 0.01);
  }

  /* ---------- peça que anda (produto que se desmonta, luz que acende) ---------- */
  function peca(pe, p) {
    const k = vaiVem(clamp((p - pe.de) / Math.max(0.001, pe.ate - pe.de)));
    const chave = k.toFixed(4);
    if (chave === pe.ant) return;
    pe.ant = chave;
    pe.el.style.transform = `translate3d(${(pe.dx * k).toFixed(3)}vw, ${(pe.dy * k).toFixed(3)}vh, 0) ` +
      `rotate(${(pe.rot * k).toFixed(2)}deg) scale(${(1 + (pe.esc - 1) * k).toFixed(4)})`;
    if (pe.op !== null) pe.el.style.opacity = (pe.op0 + (pe.op - pe.op0) * k).toFixed(3);
  }

  /* ---------- a cena: secção alta, palco fixo ---------- */
  let salto = false;   // no fotograma de um salto da volta, a inércia não existe
  function cena(sec) {
    const c = caixa(sec);
    const beats = [...sec.querySelectorAll('[data-beat]')].map((el) => ({
      el, de: num(el.dataset.de), ate: num(el.dataset.ate, 1), so: el.dataset.beat === 'fade', ant: '',
    }));
    const partes = [...sec.querySelectorAll('[data-peca]')].map((el) => ({
      el, de: num(el.dataset.de), ate: num(el.dataset.ate, 1), dx: num(el.dataset.dx), dy: num(el.dataset.dy),
      rot: num(el.dataset.rot), esc: num(el.dataset.escala, 1),
      op0: num(el.dataset.op0, 1), op: el.dataset.op === undefined && el.dataset.op0 === undefined ? null : num(el.dataset.op, 1), ant: '',
    }));
    const pct = [...sec.querySelectorAll('[data-pct]')];
    const motores = [];
    sec.querySelectorAll('canvas[data-fotogramas]').forEach((cv) => motores.push(fotogramas(cv, sec)));
    sec.querySelectorAll('.mundo').forEach((m) => motores.push(mundo(m)));
    let ps = -1, pAnt = -2, pctAnt = '';
    return (t, dt) => {
      const p = clamp((ecra.y - c.top) / Math.max(1, c.h - ecra.h));
      if (ps < 0 || salto || reduz) ps = p;
      else {
        ps += (p - ps) * (1 - Math.pow(1 - 0.14, dt / 16.67));      // inércia: o filme segue o scroll com peso
        if (Math.abs(p - ps) < 0.0003) ps = p;
      }
      if (!visivel(c, ecra.h * 0.5)) return;
      let sujo = false;
      for (const m of motores) if (m.sujo) sujo = true;
      if (ps === pAnt && !sujo) return;
      pAnt = ps;
      for (const m of motores) m.anda(ps);
      for (const b of beats) beat(b, ps);
      for (const pe of partes) peca(pe, ps);
      if (pct.length) {
        const s = Math.round(ps * 100) + '%';
        if (s !== pctAnt) { pctAnt = s; pct.forEach((e) => { e.textContent = s; }); }
      }
    };
  }

  /* ---------- faixa infinita ---------- */
  function faixa(el) {
    const trilho = el.querySelector('.faixa__trilho') || el.firstElementChild;
    if (!trilho) return null;
    const base = [...trilho.children];
    const copia = (n) => { const c = n.cloneNode(true); c.setAttribute('aria-hidden', 'true'); return c; };
    let guarda = 0;
    while (trilho.scrollWidth < Math.max(ecra.w, 1600) * 1.1 && guarda++ < 30) base.forEach((n) => trilho.appendChild(copia(n)));
    [...trilho.children].forEach((n) => trilho.appendChild(copia(n)));   // duas metades iguais: a animação vai de 0 a -50%
    if (reduz || !trilho.getAnimations) return null;
    const anim = trilho.getAnimations()[0];
    if (!anim) return null;
    const c = caixa(el);
    let taxa = 1, ant = 1;
    return (t, dt) => {
      if (!visivel(c)) return;
      const v = ecra.vel;                                             // px por ms; para cima = negativo
      const alvo = (v < -0.05 ? -1 : 1) * (1 + Math.min(5, Math.abs(v) * 2.5));
      taxa += (alvo - taxa) * (1 - Math.pow(0.9, dt / 16.67));
      if (Math.abs(taxa - ant) > 0.03) { ant = taxa; anim.playbackRate = taxa; }
    };
  }

  /* ---------- números que contam ---------- */
  function conta(el) {
    const fim = num(el.dataset.conta), casas = num(el.dataset.casas), dur = num(el.dataset.dur, 1600);
    const fmt = (v) => {
      const [i, d] = v.toFixed(casas).split('.');
      return i.replace(/(\d)(?=(\d{3})+$)/g, '$1,') + (d ? '.' + d : '');
    };
    if (reduz) { el.textContent = fmt(fim); return; }
    el.textContent = fmt(0);
    new IntersectionObserver((es, io) => {
      if (!es[0].isIntersecting) return;
      io.disconnect();
      const t0 = performance.now();
      const passo = (t) => {
        const k = clamp((t - t0) / dur);
        el.textContent = fmt(fim * (1 - Math.pow(1 - k, 4)));
        if (k < 1) requestAnimationFrame(passo);
      };
      requestAnimationFrame(passo);
    }, { threshold: 0.6 }).observe(el);
  }

  /* ---------- peças que caem uma a uma ---------- */
  function cai(el) {
    const filhos = [...el.children];
    if (reduz) { filhos.forEach((f) => f.classList.add('caiu')); return null; }
    const c = caixa(el);
    let ant = -1;
    return () => {
      const q = clamp((ecra.y + ecra.h * 0.85 - c.top) / Math.max(1, Math.min(c.h, ecra.h) * 0.75));
      const n = Math.round(q * filhos.length);
      if (n === ant) return;
      ant = n;
      filhos.forEach((f, i) => f.classList.toggle('caiu', i < n));
    };
  }

  /* ---------- a volta: scroll infinito a sério ---------- */
  let volta = null;
  function preparaVolta(sec) {
    if (tactil || reduz) return;                     // no telemóvel o salto parte a inércia do dedo: só no PC
    const copia = sec.cloneNode(true);
    copia.removeAttribute('data-volta');
    copia.removeAttribute('id');
    copia.querySelectorAll('[id]').forEach((e) => e.removeAttribute('id'));
    copia.setAttribute('aria-hidden', 'true');
    copia.inert = true;
    copia.classList.add('copia');
    document.body.appendChild(copia);
    volta = { o: caixa(sec), c: caixa(copia) };
  }

  /* ---------- montar (a cópia da volta primeiro, para ganhar as suas peças) ---------- */
  const daVolta = document.querySelector('[data-cena][data-volta]');
  if (daVolta) preparaVolta(daVolta);

  // a cor da página: muda quando uma secção [data-cor] passa pelo meio do ecrã
  const tingidas = [...document.querySelectorAll('[data-cor]')];
  if (tingidas.length) {
    const io = new IntersectionObserver((es) => {
      for (const e of es) {
        if (!e.isIntersecting) continue;
        doc.style.setProperty('--fundo', e.target.dataset.cor);
        if (e.target.dataset.tinta) doc.style.setProperty('--tinta', e.target.dataset.tinta);
      }
    }, { rootMargin: '-50% 0px -50% 0px' });
    tingidas.forEach((s) => io.observe(s));
  }
  const pecas = [];
  document.querySelectorAll('[data-cena]').forEach((s) => pecas.push(cena(s)));
  document.querySelectorAll('[data-faixa]').forEach((s) => { const f = faixa(s); if (f) pecas.push(f); });
  document.querySelectorAll('[data-cai]').forEach((s) => { const f = cai(s); if (f) pecas.push(f); });
  document.querySelectorAll('[data-conta]').forEach(conta);
  const linhas = [...document.querySelectorAll('[data-progresso-pagina]')];
  const pctPagina = [...document.querySelectorAll('[data-pct-pagina]')];
  let pagAnt = '';

  let tAnt = 0, yAnt = scrollY;
  function quadro(t) {
    requestAnimationFrame(quadro);
    const dt = tAnt ? Math.min(100, t - tAnt) : 16.67;
    tAnt = t;
    if (document.hidden) return;
    if (sujas) mede();
    let y = scrollY;
    if (volta && volta.c.top > 0 && y >= volta.c.top) {          // a cópia chegou ao topo: salta para o original
      y = y - volta.c.top + volta.o.top;
      scrollTo({ top: y, behavior: 'instant' });
      yAnt = y;
      salto = true;
    }
    ecra.vel = ecra.vel * 0.8 + ((y - yAnt) / dt) * 0.2;
    yAnt = y;
    ecra.y = y;
    for (const f of pecas) f(t, dt);
    salto = false;
    if (linhas.length || pctPagina.length) {
      const fim = volta ? volta.c.top : doc.scrollHeight - ecra.h;
      const q = clamp(y / Math.max(1, fim));
      const s = q.toFixed(3);
      if (s !== pagAnt) {
        pagAnt = s;
        linhas.forEach((l) => { l.style.transform = `scaleX(${s})`; });
        const txt = Math.round(q * 100) + '%';
        pctPagina.forEach((e) => { if (e.textContent !== txt) e.textContent = txt; });
      }
    }
  }
  requestAnimationFrame(quadro);

  addEventListener('resize', () => { ecra.h = innerHeight; ecra.w = innerWidth; sujas = true; }, { passive: true });
  addEventListener('load', () => { sujas = true; });
  if (document.fonts) document.fonts.ready.then(() => { sujas = true; });
  new ResizeObserver(() => { sujas = true; }).observe(document.body);
  addEventListener('pageshow', (e) => { if (e.persisted) location.reload(); });

  window.AMG_SCROLL = { ecra, remede: () => { sujas = true; } };
})();
