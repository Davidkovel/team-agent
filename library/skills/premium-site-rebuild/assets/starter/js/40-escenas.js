(() => {
  const { $, $$, reduz, clamp } = SITE;

  /* ---------- LAS DOS MITADES: raio X del mismo yate, de día (marketing) y de noche (IA) ----------
     El scroll lleva la línea de 86 a 14; también se arrastra, se toca y se mueve con las flechas.
     Lo que la persona elige queda como desvío y se disuelve a medida que sigue bajando. */
  const rx = $('[data-rx]');
  if (rx) {
    let desvio = 0, yDesvio = 0, xAuto = 50, arrasta = false, ultX = '', x0 = 0, moveu = false;
    const deX = (clientX) => { const r = rx.getBoundingClientRect(); return clamp((clientX - r.left) / r.width, 0.02, 0.98) * 100; };
    const fixa = (x) => { desvio = x - xAuto; yDesvio = scrollY; };
    rx.addEventListener('pointerdown', (e) => { if (e.target.closest('a')) return; arrasta = true; moveu = false; x0 = e.clientX; rx.setPointerCapture(e.pointerId); fixa(deX(e.clientX)); });
    rx.addEventListener('pointermove', (e) => { if (!arrasta) return; if (Math.abs(e.clientX - x0) > 3) moveu = true; fixa(deX(e.clientX)); });
    const larga = () => { arrasta = false; };
    rx.addEventListener('pointerup', larga); rx.addEventListener('pointercancel', larga);
    rx.addEventListener('click', (e) => { if (moveu && e.target.closest('a')) e.preventDefault(); });
    rx.addEventListener('keydown', (e) => {
      const passo = e.key === 'ArrowLeft' ? -5 : e.key === 'ArrowRight' ? 5 : 0;
      if (!passo) return; e.preventDefault(); fixa(clamp(xAuto + desvio + passo, 2, 98));
    });
    SITE.aCada((t, { y, h }) => {
      const c = SITE.caixa(rx), top = c.top - y;
      if (c.bottom - y < -h || top > h * 1.4) return;
      const p = clamp((h * 0.9 - top) / (h * 0.9 + c.height * 0.3));
      xAuto = reduz ? 50 : 86 - p * 72;
      const fade = arrasta ? 1 : clamp(1 - Math.abs(y - yDesvio) / (h * 0.55));
      if (!arrasta && fade === 0) desvio = 0;
      const x = clamp(xAuto + desvio * fade, 2, 98).toFixed(2);
      if (x !== ultX) { ultX = x; rx.style.setProperty('--x', x); rx.setAttribute('aria-valuenow', Math.round(x)); }
    });
  }

  /* ---------- CARRIL: la pared de trabajos. Deslizar nativo con encaje, arrastre con ratón, flechas y contador ---------- */
  $$('[data-carril]').forEach((c) => {
    const sec = c.closest('section') || document;
    const itens = $$('.carril-item', c), barra = $('[data-carril-barra]', sec), nEl = $('[data-carril-n]', sec);
    const ant = $('[data-carril-ant]', sec), prox = $('[data-carril-prox]', sec);
    const total = String(itens.length).padStart(2, '0');
    let posicoes = [], pedido = 0, ultN = -1;
    const mede = () => { const b = c.getBoundingClientRect().left - c.scrollLeft, pad = parseFloat(getComputedStyle(c).scrollPaddingLeft) || 0; posicoes = itens.map((it) => it.getBoundingClientRect().left - b - pad); };
    const atual = () => { let k = 0; for (let i = 0; i < posicoes.length; i++) if (posicoes[i] <= c.scrollLeft + 8) k = i; return c.scrollLeft >= c.scrollWidth - c.clientWidth - 4 ? itens.length - 1 : k; };
    const pinta = () => {
      pedido = 0;
      const max = c.scrollWidth - c.clientWidth, p = max > 0 ? c.scrollLeft / max : 0;
      const vis = c.clientWidth / c.scrollWidth;
      if (barra) { barra.style.width = (vis * 100).toFixed(2) + '%'; barra.style.transform = `translateX(${(p * (1 - vis) * 100 / vis).toFixed(2)}%)`; }
      const k = atual();
      if (k !== ultN) { ultN = k; if (nEl) nEl.textContent = String(k + 1).padStart(2, '0') + ' / ' + total; }
      if (ant) ant.disabled = c.scrollLeft < 4;
      if (prox) prox.disabled = c.scrollLeft > max - 4;
    };
    const pede = () => { if (!pedido) pedido = requestAnimationFrame(pinta); };
    c.addEventListener('scroll', pede, { passive: true });
    addEventListener('resize', () => { mede(); pede(); }, { passive: true });
    SITE.quieto().then(() => { mede(); pinta(); });
    addEventListener('load', () => { mede(); pinta(); });
    const vai = (k) => { if (!posicoes.length) mede(); k = clamp(k, 0, itens.length - 1); c.scrollTo({ left: posicoes[k], behavior: reduz ? 'auto' : 'smooth' }); };
    ant && ant.addEventListener('click', () => vai(atual() - 1));
    prox && prox.addEventListener('click', () => vai(atual() + 1));
    // arrastar com o rato; o toque e o trackpad usam o deslizar nativo com encaixe
    let xIni = null, sIni = 0, moveu = false, ultimoX = 0, vel = 0;
    c.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse' || e.button !== 0) return; xIni = e.clientX; sIni = c.scrollLeft; moveu = false; ultimoX = e.clientX; vel = 0; });
    addEventListener('pointermove', (e) => {
      if (xIni === null) return;
      const dx = e.clientX - xIni;
      if (!moveu && Math.abs(dx) > 5) { moveu = true; c.classList.add('arrasta'); }
      if (moveu) { vel = e.clientX - ultimoX; ultimoX = e.clientX; c.scrollLeft = sIni - dx; }
    });
    addEventListener('pointerup', () => {
      if (xIni === null) return; xIni = null;
      if (!moveu) return;
      c.classList.remove('arrasta');
      if (!posicoes.length) mede();
      const k = atual() + (vel < -2 ? 1 : 0);
      vai(k);
    });
  });

  /* ---------- 24 HORAS: el barrido se dibuja una vez, cuando la esfera entra ---------- */
  $$('[data-dia24]').forEach((d) => {
    if (reduz) { d.classList.add('vivo'); return; }
    const o = new IntersectionObserver(([e]) => { if (e.isIntersecting) { d.classList.add('vivo'); o.disconnect(); } }, { threshold: 0.35 });
    o.observe(d);
  });

  /* ---------- DEMOSTRACIÓN (página de IA): el guion de la web original, un mensaje cada 900 ms ---------- */
  $$('[data-demo]').forEach((d) => {
    const b = $('[data-demo-play]', d), lbl = $('span', b), msgs = $$('.msg', d), esc = $('[data-escribe]', d);
    let ts = [];
    const toca = () => {
      ts.forEach(clearTimeout); ts = [];
      msgs.forEach((m) => m.classList.remove('vis'));
      if (reduz) { msgs.forEach((m) => m.classList.add('vis')); return; }
      b.disabled = true; lbl.textContent = 'Reproduciendo…';
      msgs.forEach((m, i) => ts.push(setTimeout(() => {
        m.classList.add('vis');
        const seg = msgs[i + 1]; esc.hidden = !seg || !seg.classList.contains('agente');
        if (i === msgs.length - 1) { b.disabled = false; lbl.textContent = 'Repetir la simulación'; }
      }, 900 * (i + 1))));
    };
    b.addEventListener('click', toca);
    // se reproduce sola la primera vez que entra en pantalla: una ventana de chat vacía no retiene a nadie
    const o = new IntersectionObserver(([e]) => { if (e.isIntersecting) { o.disconnect(); toca(); } }, { threshold: 0.45 });
    o.observe(d);
  });
})();
