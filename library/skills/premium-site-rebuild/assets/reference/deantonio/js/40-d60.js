/* D60: o interior num carrossel. Setas, arrasto com o rato, deslizar no toque, trackpad, teclado, e ecrã inteiro. */
(() => {
  const { $, $$, reduz, clamp } = DA;
  // o logótipo do D60 sobe da linha de água quando entra no ecrã
  const marca = $('[data-d60-marca]');
  if (marca) {
    if (reduz) marca.classList.add('dentro');
    else { const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { marca.classList.add('dentro'); io.disconnect(); } }), { threshold: 0 }); io.observe(marca); }
  }
  const faixa = $('[data-faixa]'); if (!faixa) return;
  const trilho = $('[data-faixa-trilho]', faixa), fotos = $$('[data-faixa-foto]', faixa);
  const ant = $('[data-faixa-ant]', faixa), seg = $('[data-faixa-seg]', faixa);
  const numero = $('[data-faixa-n]', faixa), linha = $('[data-faixa-linha]', faixa), voz = $('[data-faixa-voz]', faixa);
  const N = fotos.length, dois = (n) => String(n).padStart(2, '0');
  const comp = () => (reduz ? 'auto' : 'smooth');
  // posições das fotos medidas uma vez (e quando o trilho muda de tamanho), nunca em cada evento de scroll
  let pos = [], mx = 0, cw = 1, sw = 1;
  const medir = () => {
    const ini = parseFloat(getComputedStyle(trilho).scrollPaddingLeft) || 0;
    cw = trilho.clientWidth; sw = trilho.scrollWidth; mx = sw - cw;
    pos = fotos.map((f) => clamp(f.offsetLeft - ini, 0, mx));
  };
  medir();
  const maximo = () => mx;
  const posDe = (i) => pos[i];

  // a foto actual é a mais próxima do início; no fim do trilho conta a última
  let atual = 0, vozTimer;
  const indice = () => {
    if (trilho.scrollLeft >= maximo() - 4) return N - 1;
    let m = 0, d = Infinity;
    fotos.forEach((f, i) => { const k = Math.abs(posDe(i) - trilho.scrollLeft); if (k < d) { d = k; m = i; } });
    return m;
  };
  let pAnt = '', pedidoE = 0;
  const estado = () => {
    pedidoE = 0;
    const i = indice(), x = trilho.scrollLeft;
    const a0 = x <= 4, s0 = x >= mx - 4;
    if (ant.disabled !== a0) ant.disabled = a0;
    if (seg.disabled !== s0) seg.disabled = s0;
    const p = clamp((x + cw) / sw, 0, 1).toFixed(4);
    if (p !== pAnt) { pAnt = p; linha.style.setProperty('--p', p); }
    if (i !== atual) {
      atual = i; numero.textContent = dois(i + 1);
      clearTimeout(vozTimer); vozTimer = setTimeout(() => { voz.textContent = `Photo ${i + 1} of ${N}`; }, 400);
    }
  };
  const vai = (i) => { i = clamp(i, 0, N - 1); trilho.scrollTo({ left: posDe(i), behavior: comp() }); return i; };
  // as setas andam uma foto de cada vez a partir da que está à vista
  ant.addEventListener('click', () => vai(indice() - 1));
  seg.addEventListener('click', () => vai(trilho.scrollLeft >= maximo() - 4 ? N : indice() + 1));
  // o estado acompanha o deslizar, um fotograma de cada vez
  trilho.addEventListener('scroll', () => { if (!pedidoE) pedidoE = requestAnimationFrame(estado); }, { passive: true });
  addEventListener('resize', () => { medir(); estado(); }, { passive: true });
  if ('ResizeObserver' in window) new ResizeObserver(() => { medir(); }).observe(trilho);
  // com o Tab, a foto focada encaixa no início e o contador acompanha
  trilho.addEventListener('focusin', (e) => {
    const b = e.target.closest('.faixa-abre'); if (!b || !b.matches(':focus-visible')) return;
    const i = fotos.indexOf(b.closest('[data-faixa-foto]')); if (i >= 0 && i !== indice()) vai(i);
  });

  // teclado: setas, início e fim; se o foco está numa foto, o foco vai com ela
  trilho.addEventListener('keydown', (e) => {
    const k = { ArrowLeft: -1, ArrowRight: 1, Home: -N, End: N }[e.key]; if (!k) return;
    e.preventDefault();
    const i = vai(Math.abs(k) === 1 ? indice() + k : (k < 0 ? 0 : N - 1));
    if (e.target.closest('.faixa-abre')) $('.faixa-abre', fotos[i]).focus({ preventScroll: true });
  });

  // arrastar com o rato; o toque e o trackpad usam o deslizar nativo com encaixe
  let arr = null, mexeu = false;
  trilho.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    arr = { x: e.clientX, s: trilho.scrollLeft, t: performance.now(), vx: 0, ux: e.clientX, ut: performance.now() }; mexeu = false;
  });
  addEventListener('pointermove', (e) => {
    if (!arr) return;
    const dx = e.clientX - arr.x;
    if (!mexeu && Math.abs(dx) > 6) { mexeu = true; trilho.classList.add('arrasta'); trilho.setPointerCapture?.(e.pointerId); }
    if (!mexeu) return;
    const t = performance.now(); arr.vx = (e.clientX - arr.ux) / Math.max(1, t - arr.ut); arr.ux = e.clientX; arr.ut = t;
    trilho.scrollLeft = arr.s - dx;
  });
  const solta = () => {
    if (!arr) return;
    const a = arr; arr = null; if (!mexeu) return;
    // encaixa na foto mais próxima, com um empurrão na direcção do gesto
    const proj = trilho.scrollLeft - a.vx * 220;
    let m = 0, d = Infinity; fotos.forEach((f, i) => { const k = Math.abs(posDe(i) - proj); if (k < d) { d = k; m = i; } });
    trilho.scrollTo({ left: posDe(m), behavior: comp() });
    let feito = false; const fim = () => { if (feito) return; feito = true; trilho.classList.remove('arrasta'); };
    trilho.addEventListener('scrollend', fim, { once: true }); setTimeout(fim, 900);
  };
  addEventListener('pointerup', solta); addEventListener('pointercancel', solta);
  // um arrasto não abre a foto
  trilho.addEventListener('click', (e) => { if (mexeu) { e.preventDefault(); e.stopPropagation(); mexeu = false; } }, true);
  trilho.addEventListener('dragstart', (e) => e.preventDefault());

  /* ---------- ecrã inteiro ---------- */
  const ecra = $('[data-ecra]'), foto = $('[data-ecra-foto]'), en = $('[data-ecra-n]');
  const eAnt = $('[data-ecra-ant]'), eSeg = $('[data-ecra-seg]'), fecha = $('[data-ecra-fecha]');
  if (!ecra || !ecra.showModal) { estado(); return; }
  let ei = 0, quem = null, trocaN = 0;
  // duração de um token em ms, para os temporizadores de reserva
  const ms = (t) => { const v = getComputedStyle(document.documentElement).getPropertyValue(t).trim(); return v.endsWith('ms') ? parseFloat(v) : parseFloat(v) * 1000 || 0; };
  // espera pelo fim da transição de opacidade, com reserva se o evento não vier
  const depois = (el, t, fn) => {
    let feito = false; const vai = () => { if (feito) return; feito = true; el.removeEventListener('transitionend', fim); fn(); };
    const fim = (e) => { if (e.target === el && e.propertyName === 'opacity') vai(); };
    el.addEventListener('transitionend', fim); return setTimeout(vai, ms(t) + 60);
  };
  const imgs = fotos.map((f) => $('img', f));
  const mostra = (i, lado = 0) => {
    ei = clamp(i, 0, N - 1); const im = imgs[ei];
    en.textContent = dois(ei + 1); eAnt.disabled = ei === 0; eSeg.disabled = ei === N - 1;
    const poe = () => { foto.src = im.dataset.grande; foto.alt = im.alt; };
    if (!lado || reduz) { poe(); return; }
    foto.style.setProperty('--lado', lado); foto.classList.add('troca');
    const n = ++trocaN;
    depois(foto, '--t-toque', () => { if (n !== trocaN) return; poe(); const volta = () => { if (n !== trocaN) return; foto.style.setProperty('--lado', -lado); requestAnimationFrame(() => foto.classList.remove('troca')); }; foto.decode ? foto.decode().then(volta, volta) : volta(); });
  };
  const abre = (i, btn) => {
    quem = btn; mostra(i); ecra.showModal(); document.documentElement.style.overflow = 'hidden';
    requestAnimationFrame(() => requestAnimationFrame(() => ecra.classList.add('on')));
    fecha.focus();
  };
  const fechar = () => {
    if (!ecra.open) return;
    ecra.classList.remove('on');
    const acaba = () => {
      ecra.close(); document.documentElement.style.overflow = '';
      vai(ei); if (quem) $('.faixa-abre', fotos[ei]).focus({ preventScroll: true });
    };
    reduz ? acaba() : depois(ecra, '--t-entra', acaba);
  };
  fotos.forEach((f, i) => $('.faixa-abre', f).addEventListener('click', (e) => abre(i, e.currentTarget)));
  eAnt.addEventListener('click', () => mostra(ei - 1, -1));
  eSeg.addEventListener('click', () => mostra(ei + 1, 1));
  fecha.addEventListener('click', fechar);
  ecra.addEventListener('cancel', (e) => { e.preventDefault(); fechar(); });
  ecra.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' && ei > 0) mostra(ei - 1, -1);
    else if (e.key === 'ArrowRight' && ei < N - 1) mostra(ei + 1, 1);
  });
  // clicar no fundo fecha, mas só se o toque começou e acabou no fundo e não foi um deslizar
  let baixo = null, deslizou = false;
  ecra.addEventListener('pointerdown', (e) => { baixo = e.target; deslizou = false; });
  ecra.addEventListener('click', (e) => { const ok = e.target === ecra && baixo === ecra && !deslizou; baixo = null; if (ok) fechar(); });
  // deslizar na foto, com o dedo ou com o rato
  let ex = null;
  foto.addEventListener('pointerdown', (e) => { ex = { x: e.clientX, y: e.clientY }; foto.setPointerCapture?.(e.pointerId); });
  foto.addEventListener('pointercancel', () => { ex = null; });
  foto.addEventListener('pointerup', (e) => {
    if (!ex) return; const dx = e.clientX - ex.x, dy = e.clientY - ex.y; ex = null;
    if (Math.hypot(dx, dy) > 10) deslizou = true;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) { if (dx < 0 && ei < N - 1) mostra(ei + 1, 1); else if (dx > 0 && ei > 0) mostra(ei - 1, -1); }
  });
  foto.addEventListener('dragstart', (e) => e.preventDefault());

  estado();
})();
