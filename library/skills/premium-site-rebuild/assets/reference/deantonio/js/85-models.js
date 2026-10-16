(() => {
  /* ---------- /models/: a doca, a ficha de cada versão, a galeria e o barco ao lado. Não faz nada noutras páginas ---------- */
  const raiz = document.querySelector('[data-mp]'); if (!raiz || !window.DA) return;
  const { $, $$, reduz } = DA;
  const dados = JSON.parse($('#mp-dados').textContent);
  const fichas = Object.fromEntries($$('[data-mp-ficha]').map((f) => [f.dataset.mpFicha, f]));
  const barcos = $$('[data-mp-barco]');
  const estreito = matchMedia('(max-width: 900px)');
  const ALIAS = { 'd36-open': 'd36', d36open: 'd36', d36cabin: 'd36-cabin', d50: 'd50-open', d50open: 'd50-open', d50coupe: 'd50-coupe', 'd50-coupé': 'd50-coupe' };
  const versaoDe = (h) => { h = decodeURIComponent(String(h || '').replace(/^#/, '')).toLowerCase(); h = ALIAS[h] || h; return fichas[h] ? h : null; };
  let actual = Object.keys(fichas).find((k) => fichas[k].classList.contains('activo')) || dados.inicial;
  let troca = 0;

  // topo da ficha por baixo do cabeçalho fixo
  const rola = (el, suave = true) => {
    const capa = el.classList.contains('mp-ficha');
    const y = el.getBoundingClientRect().top + scrollY - (capa ? (estreito.matches ? 0 : 24) : (estreito.matches ? 84 : 110));
    scrollTo({ top: Math.max(0, y), behavior: suave && !reduz ? 'smooth' : 'instant' });
  };

  function marcaDoca(id) {
    const mod = dados.versoes[id].modelo;
    barcos.forEach((b) => {
      const on = b.dataset.mpBarco === mod;
      b.classList.toggle('activo', on);
      if (on) { b.setAttribute('aria-current', 'true'); b.setAttribute('href', '#' + id); } else b.removeAttribute('aria-current');
      // o desenho acompanha a versão: o D36 Cabin e o D50 Coupé têm outra silhueta
      const im = $('[data-linhas-v]', b);
      if (im && on) { const [a, c] = im.dataset.linhasV.split(' '); const alvo = dados.modelos[mod].indexOf(id) ? c : a; if (!im.src.endsWith(alvo.replace(/^img\//, ''))) im.src = (im.getAttribute('src').startsWith('../') ? '../' : '') + alvo; }
    });
  }

  function vizinhos(id) {
    const ord = dados.ordem, i = ord.indexOf(id);
    $$('[data-mp-viz]').forEach((a) => {
      const k = ord[(i + +a.dataset.mpViz + ord.length) % ord.length], v = dados.versoes[k];
      a.href = '#' + k; a.dataset.alvo = k;
      const u = $('use', a), sym = document.getElementById('wm-' + v.wm), svg = $('svg.mp-wm-viz', a);
      u.setAttribute('href', '#wm-' + v.wm);
      if (sym) { const vb = sym.getAttribute('viewBox'); svg.setAttribute('viewBox', vb); const p = vb.split(' ').map(Number); svg.style.setProperty('--ar', (p[2] / p[3]).toFixed(3)); svg.classList.toggle('duas', p[2] / p[3] < 4.5); }
      $('[data-mp-viz-nome]', a).textContent = 'De Antonio ' + v.nome;
    });
  }

  function escolhe(id, { rolar = false, instante = false } = {}) {
    if (!fichas[id]) return;
    const minha = ++troca;
    const antes = fichas[actual], depois = fichas[id];
    marcaDoca(id); vizinhos(id);
    try { history.replaceState(null, '', '#' + id); } catch (e) { /* sem história, fica o estado */ }
    if (DA.mp3d) DA.mp3d.versao(id);
    if (id === actual) { if (rolar) rola(depois); return; }
    actual = id;
    const mostra = () => {
      if (minha !== troca) return;
      Object.values(fichas).forEach((f) => { if (f !== depois) { f.hidden = true; f.classList.remove('activo', 'sai', 'entra'); } });
      depois.hidden = false; depois.classList.add('activo', 'entra');
      void depois.offsetWidth;
      requestAnimationFrame(() => depois.classList.remove('entra'));
      if (rolar) rola(depois, !instante);
      prepGaleria(depois);
    };
    // a fotografia de capa da nova versão pede-se já, e a troca espera por ela (no máximo um instante)
    const capa = $('.mp-capa-foto img', depois);
    capa.loading = 'eager';
    const pronta = capa.complete && capa.naturalWidth ? Promise.resolve() : Promise.race([capa.decode ? capa.decode().catch(() => {}) : Promise.resolve(), new Promise((r) => setTimeout(r, 700))]);
    if (instante || reduz || antes.hidden) mostra();
    else { antes.classList.add('sai'); Promise.all([pronta, new Promise((r) => setTimeout(r, 320))]).then(mostra); }
  }

  /* doca: um toque escolhe; no telemóvel desce até à ficha */
  const preCapa = (id) => { const f = fichas[id]; if (f) $('.mp-capa-foto img', f).loading = 'eager'; };
  barcos.forEach((b) => b.addEventListener('pointerenter', () => preCapa(dados.modelos[b.dataset.mpBarco][0])));
  barcos.forEach((b) => b.addEventListener('click', (e) => {
    e.preventDefault();
    const mod = b.dataset.mpBarco, vs = dados.modelos[mod];
    const id = vs.includes(actual) ? actual : vs[0];
    escolhe(id, { rolar: estreito.matches || fichas[actual].getBoundingClientRect().top > innerHeight * 0.9 });
  }));
  /* versões no sítio: Open e Cabin, Open e Coupé */
  raiz.addEventListener('click', (e) => {
    const v = e.target.closest('[data-mp-ir]');
    if (v) { e.preventDefault(); escolhe(v.dataset.mpIr); return; }
    const c = e.target.closest('[data-mp-construir]');
    if (c) { e.preventDefault(); rola($('#construir')); return; }
    const z = e.target.closest('[data-mp-viz]');
    if (z) { e.preventDefault(); escolhe(z.dataset.alvo, { rolar: true }); }
  });
  /* o menu e as ligações de fora mudam o #: segue-se */
  addEventListener('hashchange', () => {
    if (location.hash === '#construir') { rola($('#construir')); return; }
    const id = versaoDe(location.hash); if (id) escolhe(id, { rolar: true });
  });

  /* ---------- galeria: contador, linha de progresso e setas ---------- */
  const galerias = new Map();
  function prepGaleria(f) {
    const g = $('[data-mp-galeria]', f); if (!g || galerias.has(g)) return;
    const tr = $('[data-mp-trilho]', g), slides = $$('.mp-slide', tr), n = slides.length;
    const iEl = $('[data-mp-gal-i]', g), barra = $('[data-mp-gal-barra]', g), setas = $$('[data-mp-gal]', g);
    let i = -1, pedido = 0;
    const passo = () => (n > 1 ? slides[1].offsetLeft - slides[0].offsetLeft : tr.clientWidth);
    const le = () => {
      pedido = 0;
      const p = passo(), max = tr.scrollWidth - tr.clientWidth;
      const k = tr.scrollLeft >= max - 4 ? n - 1 : Math.round(tr.scrollLeft / p);
      if (k === i) return; i = k;
      iEl.textContent = String(k + 1).padStart(2, '0');
      barra.style.setProperty('--k', ((k + 1) / n).toFixed(4));
      setas[0].disabled = k <= 0; setas[1].disabled = k >= n - 1;
    };
    tr.addEventListener('scroll', () => { if (!pedido) pedido = requestAnimationFrame(le); }, { passive: true });
    setas.forEach((s) => s.addEventListener('click', () => tr.scrollBy({ left: passo() * +s.dataset.mpGal, behavior: reduz ? 'instant' : 'smooth' })));
    tr.addEventListener('keydown', (e) => { const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key]; if (d) { e.preventDefault(); tr.scrollBy({ left: passo() * d, behavior: reduz ? 'instant' : 'smooth' }); } });
    galerias.set(g, le); le();
  }

  /* ---------- arranque: o #modelo do endereço (guardado antes de o núcleo o limpar) ---------- */
  const h = window.MP_HASH || '';
  const pedida = versaoDe(h);
  marcaDoca(actual); vizinhos(actual);
  if (pedida && pedida !== actual) escolhe(pedida, { instante: true });
  else { prepGaleria(fichas[actual]); if (DA.mp3d) DA.mp3d.versao(actual); }
  if (pedida || h === '#construir') {
    try { history.replaceState(null, '', h); } catch (e) { /* nada */ }
    const alvo = h === '#construir' ? $('#construir') : fichas[pedida];
    // espera que as imagens de cima tenham tamanho, para não parar a meio
    requestAnimationFrame(() => rola(alvo, false));
    addEventListener('load', () => { if (scrollY < 40) rola(alvo, false); }, { once: true });
  }
  /* nesta página as ligações para o D60 da página inicial ficam aqui: a ficha do D60 está nesta página */
  $$('.topo a[href$="#d60"], .rodape a[href$="#d60"], [data-rodape] a[href$="#d60"]').forEach((a) => { a.setAttribute('href', '#d60'); });
  // «Range» no rodapé: aqui a gama é esta página, volta ao índice
  $$('[data-rodape] a[href$="#gama"]').forEach((a) => { a.setAttribute('href', '#conteudo'); a.addEventListener('click', (e) => { e.preventDefault(); rola($('.mp-topo'), true); }); });
  // ligações de fora da página para uma ficha (#d60) com o mesmo # no endereço: o hashchange não dispara, segue-se o toque
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href*="#"]'); if (!a || raiz.contains(a)) return;
    let u; try { u = new URL(a.href); } catch (x) { return; }
    if (u.pathname !== location.pathname) return;
    const id = versaoDe(u.hash); if (!id) return;
    e.preventDefault(); escolhe(id, { rolar: true });
  });
  DA.mpEscolhe = escolhe;
})();
