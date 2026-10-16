(() => {
  const { $, $$, reduz } = DA;
  /* ---------- gama à escala: o porto e a ficha ---------- */
  const sec = $('#gama'); if (!sec) return;
  const barcos = $$('[data-barco]', sec);
  const fichas = barcos.map((b) => $('#' + b.getAttribute('aria-controls')));
  const nI = $('[data-porto-i]', sec);
  const pad = (n) => String(n).padStart(2, '0');
  let actual = Math.max(0, barcos.findIndex((b) => b.classList.contains('activo')));
  let vez = 0;

  // no telemóvel só a ficha escolhida ocupa lugar: a altura passa de uma para a outra sem salto.
  // Leituras e escritas em fotogramas separados: lê-se a altura antiga antes de trocar classes, a nova num rAF, escreve-se no seguinte
  const fichaEl = $('[data-ficha]', sec);
  let fimAlt = 0;
  const soltaAltura = () => { clearTimeout(fimAlt); fichaEl.classList.remove('muda'); fichaEl.style.height = ''; };
  fichaEl.addEventListener('transitionend', (e) => { if (e.target === fichaEl && e.propertyName === 'height') soltaAltura(); });
  const prendeAltura = (h0, h1) => {
    if (reduz || Math.abs(h1 - h0) < 2) return () => {};
    fichaEl.style.height = h0 + 'px';
    return () => { fichaEl.classList.add('muda'); fichaEl.style.height = h1 + 'px'; fimAlt = setTimeout(soltaAltura, 1400); };
  };

  // as imagens das fichas só carregam quando fazem falta
  const acorda = (img) => { if (!img || !img.dataset.src) return img; if (img.dataset.srcset) img.srcset = img.dataset.srcset; img.src = img.dataset.src; delete img.dataset.src; delete img.dataset.srcset; return img; };
  const pronto = (img) => { if (!img) return Promise.resolve(); acorda(img); if (img.complete && img.naturalWidth) return Promise.resolve(); return Promise.race([img.decode ? img.decode().catch(() => {}) : Promise.resolve(), new Promise((r) => setTimeout(r, 450))]); };
  const varActiva = (f) => $('.palco-var.activo', f);
  const prepara = (f) => { if (!f) return; $$('.mini img', f).forEach(acorda); $$('.quadro[data-q="0"] img', f).forEach(acorda); };

  /* a marca do modelo em contorno desenha-se: o traço não escala, por isso o comprimento vem em pixels de ecrã (uma leitura por desenho) */
  const marcas = $$('.marca', sec);
  const comprimentos = (svg) => svg._L || (svg._L = $$('path', svg).map((p) => p.getTotalLength()));
  // leitura: devolve a escrita, para correr no mesmo fotograma depois de todas as leituras
  const mede = (svg) => {
    if (!svg) return () => {};
    if (reduz) return () => svg.classList.remove('espera');
    const k = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
    const L = comprimentos(svg), ps = $$('path', svg);
    return () => {
      if (!k) { svg.classList.remove('espera'); return; }
      ps.forEach((p, n) => { const l = Math.ceil(L[n] * k) + 2; p.style.transition = 'none'; p.style.strokeDasharray = l + ' ' + l; p.style.strokeDashoffset = l; });
      svg.classList.remove('espera');
      requestAnimationFrame(() => requestAnimationFrame(() => ps.forEach((p, n) => {
        p.style.transition = `stroke-dashoffset calc(var(--t-cena) * 2.6) var(--curva) calc(var(--t-toque) * 1.5 + ${n * 160}ms)`;
        p.style.strokeDashoffset = 0;
      })));
      clearTimeout(svg._fim); svg._fim = setTimeout(() => ps.forEach((p) => { p.style.transition = ''; p.style.strokeDasharray = ''; p.style.strokeDashoffset = ''; }), 4600);
    };
  };
  const desenha = (svg) => requestAnimationFrame(() => mede(svg)());
  const marcaDe = (f) => $('.palco-var.activo .marca', f);
  if (!reduz) {
    marcas.forEach((m) => m.classList.add('espera'));
    // a primeira ficha desenha-se quando entra no ecrã
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); desenha(marcaDe(fichas[actual])); } }, { threshold: 0 });
    io.observe(fichaEl);
  }

  // telemóvel: depois de escolher, a ficha sobe ao ecrã (a lista fica em cima, a ficha logo abaixo)
  const estreito = matchMedia('(max-width: 900px)');
  // leitura (dentro do fotograma de leitura de escolhe); devolve a escrita
  const mostraFicha = () => {
    if (!estreito.matches) return () => {};
    const top = fichaEl.getBoundingClientRect().top;
    if (top > 40 && top < innerHeight * 0.4) return () => {};
    const y = scrollY + top - 64;
    return () => scrollTo({ top: y, behavior: reduz ? 'auto' : 'smooth' });
  };

  async function escolhe(i, { foco = false, mostra = false } = {}) {
    i = (i + barcos.length) % barcos.length;
    const minha = ++vez, f = fichas[i];
    prepara(f);
    if (i !== actual) await pronto($('.quadro.activo img', varActiva(f)));
    if (minha !== vez) return;
    const muda = i !== actual;
    const h0 = fichaEl.offsetHeight; // a única leitura antes das escritas
    barcos.forEach((b, k) => { const on = k === i; b.classList.toggle('activo', on); b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1; });
    fichas.forEach((x, k) => { const on = k === i; x.classList.toggle('activo', on); x.inert = !on; if (on) x.removeAttribute('aria-hidden'); else x.setAttribute('aria-hidden', 'true'); });
    actual = i;
    nI.textContent = pad(i + 1);
    if (foco) barcos[i].focus({ preventScroll: true });
    soltaAltura();
    // fotograma 1: lê a altura nova e a marca (um só cálculo de layout), escreve; fotograma 2: a altura anima
    requestAnimationFrame(() => {
      if (minha !== vez) return;
      const h1 = fichaEl.offsetHeight;
      const traca = muda ? mede(marcaDe(f)) : () => {};
      const sobe = mostra ? mostraFicha() : () => {};
      const anima = prendeAltura(h0, h1);
      traca(); sobe();
      requestAnimationFrame(anima);
    });
    // os vizinhos ficam prontos para as setas
    setTimeout(() => { prepara(fichas[(i + 1) % fichas.length]); prepara(fichas[(i - 1 + fichas.length) % fichas.length]); }, 600);
  }

  barcos.forEach((b, i) => {
    b.addEventListener('click', () => escolhe(i, { mostra: true }));
    b.addEventListener('pointerenter', () => prepara(fichas[i]));
    b.addEventListener('keydown', (e) => {
      const k = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: barcos.length - 1 }[e.key];
      if (k === undefined) return; e.preventDefault(); escolhe(k, { foco: true });
    });
  });
  $$('[data-passo]', sec).forEach((s) => s.addEventListener('click', () => escolhe(actual + +s.dataset.passo)));
  $$('[data-ir]', sec).forEach((s) => s.addEventListener('click', async () => { await escolhe(actual + +s.dataset.ir, { mostra: true }); const nav = $('.ficha-nav', fichas[actual]); if (nav) $(`[data-ir="${s.dataset.ir}"]`, nav).focus({ preventScroll: true }); }));

  /* variantes: Open e Cabin, Open e Coupé, trocadas no sítio */
  $$('[data-variante]', sec).forEach((v) => v.addEventListener('click', async () => {
    const f = v.closest('.ficha-m'), k = v.dataset.variante;
    const alvo = $(`.palco-var[data-var="${k}"]`, f);
    $$('[data-variante]', f).forEach((x) => { x.classList.toggle('activo', x === v); x.setAttribute('aria-pressed', x === v); });
    $$('img', alvo).forEach((im) => { if (im.closest('.mini') || im.closest('.quadro.activo')) acorda(im); });
    await pronto($('.quadro.activo img', alvo));
    const antes = $('.palco-var.activo', f);
    $$('.palco-var', f).forEach((p) => { const on = p === alvo; p.classList.toggle('activo', on); if (on) p.removeAttribute('aria-hidden'); else p.setAttribute('aria-hidden', 'true'); p.inert = !on; });
    if (antes !== alvo) desenha($('.marca', alvo));
    // o desenho no porto acompanha a versão (o D50 Coupé tem o hardtop)
    const cfg = $('.botao-linha', f); if (cfg && v.dataset.cfg) cfg.href = v.dataset.cfg;
    if (v.dataset.linha) { const b = barcos[+f.dataset.i]; $$('[data-linha-barco]', b).forEach((im) => { im.src = v.dataset.linha; }); }
  }));
  $$('.palco-var:not(.activo)', sec).forEach((p) => { p.inert = true; });

  /* galeria: exterior, convés e interior de cada versão */
  $$('.mini', sec).forEach((m) => {
    m.addEventListener('pointerenter', () => acorda($(`.quadro[data-q="${m.dataset.q}"] img`, m.closest('.palco-var'))));
    m.addEventListener('click', async () => {
      const p = m.closest('.palco-var'), q = $(`.quadro[data-q="${m.dataset.q}"]`, p);
      $$('.mini', p).forEach((x) => { x.classList.toggle('activo', x === m); x.setAttribute('aria-pressed', x === m); });
      await pronto($('img', q));
      $$('.quadro', p).forEach((x) => x.classList.toggle('activo', x === q));
    });
  });

  /* acabamentos: o nome da amostra aparece ao passar e fica ao escolher */
  const nomeAcab = (g, b) => { $('[data-acab-nome]', g).innerHTML = b.dataset.nome + (b.hasAttribute('data-std') ? ' <i>standard</i>' : ''); };
  $$('[data-acab]', sec).forEach((g) => {
    const amostras = $$('.amostra', g);
    amostras.forEach((b) => {
      b.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') nomeAcab(g, b); });
      b.addEventListener('focus', () => nomeAcab(g, b));
      b.addEventListener('click', () => { amostras.forEach((x) => { x.classList.toggle('activo', x === b); x.setAttribute('aria-pressed', x === b); }); nomeAcab(g, b); });
    });
    const repoe = () => nomeAcab(g, amostras.find((x) => x.classList.contains('activo')));
    $('.acab-l', g).addEventListener('pointerleave', repoe);
    $('.acab-l', g).addEventListener('focusout', (e) => { if (!g.contains(e.relatedTarget)) repoe(); });
  });

  DA.escolheBarco = (id) => { const i = barcos.findIndex((b) => b.dataset.barco === id); if (i >= 0) escolhe(i); };
})();
