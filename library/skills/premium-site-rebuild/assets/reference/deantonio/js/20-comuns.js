(() => {
  const { $, $$, reduz, clamp, vh, prog } = DA;
  /* ---------- entradas por linha e texto em duas tintas ---------- */
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('dentro'); io.unobserve(e.target); } }), { threshold: 0 });
  $$('[data-linhas]').forEach((el) => io.observe(el));
  const tintas = $$('[data-duas-tintas]').map((p) => {
    p.innerHTML = p.textContent.trim().split(/\s+/).map((w) => `<span class="p">${w}</span>`).join(' ');
    return { el: p, ps: $$('.p', p) };
  });

  /* ---------- imagens vivas: seguem o rato ---------- */
  $$('[data-vivo]').forEach((el) => {
    // a caixa vem da medição guardada e a escrita espera pelo fotograma: um rato rápido não força layout a cada evento
    let ev = null, pedido = 0;
    const aplica = () => { pedido = 0; if (!ev) return; const r = DA.caixa(el), x = ev.pageX - r.left, y = ev.pageY - r.top; el.style.setProperty('--mx', (x / r.width - .5) * -14 + 'px'); el.style.setProperty('--my', (y / r.height - .5) * -10 + 'px'); };
    el.addEventListener('pointermove', (e) => { if (e.pointerType !== 'mouse') return; ev = e; if (!pedido) pedido = requestAnimationFrame(aplica); }, { passive: true });
    el.addEventListener('pointerleave', () => { ev = null; el.style.removeProperty('--mx'); el.style.removeProperty('--my'); });
  });

  /* ---------- números que contam ---------- */
  // separador de milhares feito à mão: o primeiro toLocaleString carrega os dados de língua e custava ~20 ms a meio do scroll
  const milhar = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fmt = (v, el) => el.dataset.milhar !== undefined ? milhar(v) : v.toFixed(+el.dataset.casas || 0);
  const ioN = new IntersectionObserver((es) => es.forEach((e) => {
    if (!e.isIntersecting) return; ioN.unobserve(e.target);
    const el = e.target, alvoN = +el.dataset.conta; if (reduz) return;
    const t0 = performance.now(), d = 1600;
    const passo = (t) => { const k = clamp((t - t0) / d); el.textContent = fmt(alvoN * (1 - Math.pow(1 - k, 4)), el); if (k < 1) requestAnimationFrame(passo); };
    el.textContent = fmt(0, el); requestAnimationFrame(passo);
  }), { threshold: 0 });
  $$('[data-conta]').forEach((el) => ioN.observe(el));

  /* ---------- imagens decodificadas antes de chegarem ao ecrã ----------
     uma fotografia grande que entra no ecrã por decodificar atrasa o fotograma em que aparece; a ecrã e meio de distância
     pede-se o decode (fora da thread principal), e quando ela entra já está pronta a pintar */
  if ('decode' in HTMLImageElement.prototype) {
    const pede = (im) => { if (im.complete && im.naturalWidth) im.decode().catch(() => {}); else im.addEventListener('load', () => im.decode().catch(() => {}), { once: true }); };
    const ioD = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { ioD.unobserve(e.target); pede(e.target); } }), { rootMargin: '150% 0px 150% 0px', threshold: 0 });
    $$('img[loading="lazy"]').forEach((im) => ioD.observe(im));
  }

  /* ---------- vídeo da aventura: só toca à vista ---------- */
  $$('[data-video-auto]').forEach((v) => new IntersectionObserver(([e]) => {
    if (e.isIntersecting) { if (!v.src) v.src = v.dataset.src; if (!reduz) v.play().catch(() => {}); } else v.pause();
  }, { threshold: 0 }).observe(v));

  // tudo o que segue o scroll lê caixas guardadas (DA.caixa) e só escreve quando o valor muda
  const janelas = $$('[data-janela]').map((el) => ({ el, v: '' })), barra = $('[data-barra]'), rodape = $('[data-rodape]');
  tintas.forEach((t) => { t.n = -1; });
  let barraOn = null, sobeAnt = '';
  DA.aCada((t, { y, h }) => {
    const on = y > h * 0.7;
    if (on !== barraOn) { barraOn = on; barra.classList.toggle('on', on); }
    // a barra de contacto pousa em cima do rodapé
    if (rodape) { const s = String(Math.max(0, Math.round(h - (DA.caixa(rodape).top - y)))); if (s !== sobeAnt) { sobeAnt = s; barra.style.setProperty('--sobe', s); } }
    for (const tt of tintas) {
      const c = DA.caixa(tt.el), top = c.top - y;
      if (tt.n === tt.ps.length && top < -c.height) continue;
      const n = reduz ? tt.ps.length : Math.round(clamp((h * 0.85 - top) / (h * 0.55)) * tt.ps.length);
      if (n === tt.n) continue;
      // só as palavras que mudam de tinta
      const a = tt.n < 0 ? 0 : Math.min(n, tt.n), z = tt.n < 0 ? tt.ps.length : Math.max(n, tt.n);
      for (let i = a; i < z; i++) tt.ps[i].classList.toggle('on', i < n);
      tt.n = n;
    }
    if (!reduz) for (const j of janelas) {
      const c = DA.caixa(j.el), top = c.top - y;
      if (c.bottom - y <= 0 || top >= h) continue;
      const s = (1 - clamp((clamp((h - top) / (h + c.height)) - 0.05) / 0.4)).toFixed(3);
      if (s !== j.v) { j.v = s; j.el.style.setProperty('--j', s); }
    }
  });
})();
