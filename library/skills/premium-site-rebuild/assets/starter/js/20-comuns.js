(() => {
  const { $, $$, reduz, clamp } = SITE;
  /* ---------- entradas: por línea y subidas ---------- */
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('dentro'); io.unobserve(e.target); } }), { threshold: 0, rootMargin: '0px 0px -6% 0px' });
  $$('[data-linhas],[data-sube]').forEach((el) => { if (!el.closest('[data-hero]')) io.observe(el); });
  // los títulos de la hero entran con la apertura, no con el observador
  SITE.abertura.then(() => $$('[data-hero] [data-linhas]').forEach((el) => el.classList.add('dentro')));

  /* ---------- texto en dos tintas: palabra a palabra con el scroll ---------- */
  const tintas = $$('[data-duas-tintas]').map((p) => {
    const parte = (n) => {
      if (n.nodeType === 3) {
        const f = document.createDocumentFragment();
        n.textContent.split(/(\s+)/).forEach((w) => { if (!w) return; if (/^\s+$/.test(w)) f.append(w); else { const s = document.createElement('span'); s.className = 'p'; s.textContent = w; f.append(s); } });
        n.replaceWith(f);
      } else [...n.childNodes].forEach(parte);
    };
    [...p.childNodes].forEach(parte);
    return { el: p, ps: $$('.p', p), n: -1 };
  });

  /* ---------- imágenes vivas: siguen al ratón ---------- */
  $$('[data-vivo]').forEach((el) => {
    let ev = null, pedido = 0;
    const aplica = () => { pedido = 0; if (!ev) return; const r = SITE.caixa(el), x = ev.pageX - r.left, y = ev.pageY - r.top; el.style.setProperty('--mx', (x / r.width - .5) * -16 + 'px'); el.style.setProperty('--my', (y / r.height - .5) * -12 + 'px'); };
    el.addEventListener('pointermove', (e) => { if (e.pointerType !== 'mouse') return; ev = e; if (!pedido) pedido = requestAnimationFrame(aplica); }, { passive: true });
    el.addEventListener('pointerleave', () => { ev = null; el.style.removeProperty('--mx'); el.style.removeProperty('--my'); });
  });

  /* ---------- números que cuentan ---------- */
  // separador de miles a mano: el primer toLocaleString carga los datos del idioma a mitad del scroll
  const milhar = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const ioN = new IntersectionObserver((es) => es.forEach((e) => {
    if (!e.isIntersecting) return; ioN.unobserve(e.target);
    const el = e.target, alvo = +el.dataset.conta; if (reduz) return;
    const t0 = performance.now(), d = 1800;
    const passo = (t) => { const k = clamp((t - t0) / d); el.textContent = milhar(alvo * (1 - Math.pow(1 - k, 4))); if (k < 1) requestAnimationFrame(passo); };
    el.textContent = '0'; requestAnimationFrame(passo);
  }), { threshold: 0 });
  $$('[data-conta]').forEach((el) => ioN.observe(el));

  /* ---------- imágenes decodificadas antes de llegar a la pantalla ---------- */
  if ('decode' in HTMLImageElement.prototype) {
    const pede = (im) => { if (im.complete && im.naturalWidth) im.decode().catch(() => {}); else im.addEventListener('load', () => im.decode().catch(() => {}), { once: true }); };
    const ioD = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { ioD.unobserve(e.target); pede(e.target); } }), { rootMargin: '150% 150% 150% 150%', threshold: 0 });
    $$('img[loading="lazy"]').forEach((im) => ioD.observe(im));
  }

  /* ---------- vídeos de fondo (hero y páginas): el cartaz primero, el filme en cuanto hay fotogramas ----------
     iPhone: sin sonido, en línea, sin controles; si el navegador lo rechaza (Ahorro de energía) el cartaz
     gana un Ken Burns lento y cualquier gesto vuelve a intentarlo. */
  const vertical = matchMedia('(max-width: 899px) and (orientation: portrait)').matches;
  $$('video[data-filme]').forEach((v) => {
    const caixa = v.parentElement;
    v.muted = true; v.defaultMuted = true; v.setAttribute('muted', ''); v.playsInline = true;
    if (reduz) { caixa.classList.add('kb'); return; }
    const fonte = () => { if (!v.src) v.src = vertical ? v.dataset.srcV : v.dataset.srcH; };
    const preguica = v.dataset.lazy !== undefined;
    if (!preguica) fonte();
    let vis = !preguica, pendente = false, tent = 0;
    const mostra = () => v.classList.add('a-tocar');
    v.addEventListener('playing', () => { if ('requestVideoFrameCallback' in v) v.requestVideoFrameCallback(mostra); else setTimeout(mostra, 60); });
    const toca = (gesto) => {
      if (document.hidden || !vis || !v.src || (!v.paused && v.classList.contains('a-tocar'))) return;
      if (pendente && !gesto) return;
      let p; try { p = v.play(); } catch (e) { p = Promise.reject(e); }
      if (!p || !p.then) return;
      pendente = true;
      p.then(() => { pendente = false; tent = 0; }, () => { pendente = false; caixa.classList.add('kb'); if (tent < 3) setTimeout(() => toca(), 500 * 2 ** tent++); });
    };
    const gestos = ['touchstart', 'pointerdown', 'click', 'keydown', 'scroll'];
    const noGesto = (e) => { toca(e.type !== 'scroll'); if (v.classList.contains('a-tocar')) gestos.forEach((g) => removeEventListener(g, noGesto, true)); };
    gestos.forEach((g) => addEventListener(g, noGesto, { passive: true, capture: true }));
    v.addEventListener('canplay', () => toca(), { once: true });
    toca();
    // os momentos a meio da página só pedem o vídeo quando estão a um ecrã de distância
    if (preguica) new IntersectionObserver(([e], o) => { if (e.isIntersecting) { fonte(); o.disconnect(); } }, { rootMargin: '100% 0px' }).observe(caixa);
    new IntersectionObserver(([e]) => { vis = e.isIntersecting; vis ? toca() : v.pause(); }, { threshold: 0 }).observe(caixa);
    document.addEventListener('visibilitychange', () => (document.hidden ? v.pause() : toca()));
  });

  /* ---------- vídeos de las secciones: sólo cargan y tocan a la vista ---------- */
  const ioV = new IntersectionObserver((es) => es.forEach((e) => {
    const v = e.target;
    if (e.isIntersecting) {
      if (reduz) return;
      if (!v.src) v.src = v.dataset.src;
      const p = v.play(); if (p && p.catch) p.catch(() => {});
    } else if (!v.paused) v.pause();
  }), { threshold: 0.2 });
  $$('video[data-video-auto]').forEach((v) => { v.muted = true; v.defaultMuted = true; v.playsInline = true; ioV.observe(v); });

  /* ---------- menú de pantalla entera ---------- */
  const mb = $('[data-menu-botao]'), menu = $('[data-menu]');
  if (mb && menu) {
    const fecha = () => { mb.setAttribute('aria-expanded', 'false'); menu.classList.remove('aberto'); setTimeout(() => (menu.hidden = true), 300); document.body.style.overflow = ''; };
    mb.addEventListener('click', () => {
      if (mb.getAttribute('aria-expanded') === 'true') return fecha();
      menu.hidden = false; requestAnimationFrame(() => menu.classList.add('aberto'));
      mb.setAttribute('aria-expanded', 'true'); document.body.style.overflow = 'hidden';
      const a = $('a', menu); a && a.focus({ preventScroll: true });
    });
    menu.addEventListener('click', (e) => { if (e.target.closest('a')) fecha(); });
    addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { fecha(); mb.focus(); } });
  }

  /* ---------- todo lo que sigue al scroll lee cajas guardadas y sólo escribe cuando el valor cambia ---------- */
  const janelas = $$('[data-janela]').map((el) => ({ el, v: '' }));
  const linhas = $$('[data-linha-viva]').map((el) => ({ el, alvo: el.closest('[data-linha-alvo]') || el.parentElement, v: '' }));
  const fases = $$('[data-fase]');
  const topo = $('[data-topo]'), claros = $$('[data-claro]');
  const barra = $('[data-barra]'), rodape = $('[data-rodape]');
  let claroAnt = null, fundoAnt = null, barraOn = null, yAnt = scrollY, acum = 0;
  SITE.aCada((t, { y, h }) => {
    if (topo) {
      // sobre una sección clara la cabecera pasa a tinta; con el scroll gana un velo detrás para leerse
      const meio = y + 36;
      const sobre = claros.some((c) => { const b = SITE.caixa(c); return b.top <= meio && b.bottom >= meio; });
      if (sobre !== claroAnt) { claroAnt = sobre; topo.classList.toggle('sobre-claro', sobre); }
      const fundo = y > 30;
      if (fundo !== fundoAnt) { fundoAnt = fundo; topo.classList.toggle('fundo', fundo); }
    }
    if (barra && !barra.hidden) {
      // la barra del teléfono aparece al subir (intención de actuar) y se va al bajar; nunca sobre el rodapé
      const dy = y - yAnt; yAnt = y;
      if (dy) acum = Math.sign(dy) === Math.sign(acum) ? acum + dy : dy;
      let on = barraOn;
      if (y < h * 0.9 || (rodape && SITE.caixa(rodape).top - y < h * 0.9)) on = false;
      else if (acum < -50) on = true;
      else if (acum > 60) on = false;
      if (on !== barraOn) { barraOn = on; barra.classList.toggle('on', !!on); }
    }
    for (const tt of tintas) {
      const c = SITE.caixa(tt.el), top = c.top - y;
      if (tt.n === tt.ps.length && top < -c.height) continue;
      const n = reduz ? tt.ps.length : Math.round(clamp((h * 0.88 - top) / (h * 0.45)) * tt.ps.length);
      if (n === tt.n) continue;
      const a = tt.n < 0 ? 0 : Math.min(n, tt.n), z = tt.n < 0 ? tt.ps.length : Math.max(n, tt.n);
      for (let i = a; i < z; i++) tt.ps[i].classList.toggle('on', i < n);
      tt.n = n;
    }
    if (reduz) return;
    for (const j of janelas) {
      const c = SITE.caixa(j.el), top = c.top - y;
      if (c.bottom - y <= 0 || top >= h) continue;
      const s = (1 - clamp((clamp((h - top) / (h + c.height)) - 0.04) / 0.34)).toFixed(3);
      if (s !== j.v) { j.v = s; j.el.style.setProperty('--j', s); }
    }
    for (const l of linhas) {
      const c = SITE.caixa(l.alvo), top = c.top - y;
      if (c.bottom - y < -h || top > h * 1.5) continue;
      const k = clamp((h * 0.8 - top) / (c.height * 0.9 + h * 0.2));
      const s = k.toFixed(3);
      if (s !== l.v) {
        l.v = s; l.el.style.transform = `scaleX(${s})`;
        fases.forEach((f, i) => f.classList.toggle('on', k >= i / fases.length));
      }
    }
  });
})();
