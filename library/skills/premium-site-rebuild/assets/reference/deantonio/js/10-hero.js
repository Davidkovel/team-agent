(() => {
  const { $, $$, reduz, clamp, vh } = DA;
  /* ---------- HERO: o filme ---------- */
  const hero = $('[data-hero]'), video = $('[data-hero-video]'), texto = $('[data-hero-texto]'), poster = $('[data-hero-poster]');
  const hl0 = $('[data-hero-logo]');
  // a mesma pergunta que o <picture> faz ao cartaz: vertical no telemóvel ao alto
  const vertical = matchMedia('(max-width: 899px) and (orientation: portrait)').matches;
  const telemovel = matchMedia('(max-width: 900px)').matches;
  // no telemóvel o filme só aparece quando o logótipo pousa; até lá fica o cartaz (que é o que está por baixo do logótipo)
  // o filme aparece logo que toca: o primeiro fotograma é a própria capa, por isso não há salto
  let podeMostrar = true;
  let heroVisivel = true, aCorrer = false, tentativas = 0, retoma = 0, pendente = false, ultimoGesto = 0;
  let marcaTocar; const aTocar = new Promise((r) => (marcaTocar = r));
  // iPhone: sem som, em linha, sem controlos nem ícone de play; a fonte escolhe-se antes do primeiro play
  video.muted = true; video.defaultMuted = true; video.setAttribute('muted', '');
  video.playsInline = true; video.controls = false; video.removeAttribute('controls');
  if (reduz) {
    video.removeAttribute('autoplay'); video.preload = 'none';
  } else {
    const pix = innerWidth * (devicePixelRatio || 1);
    video.src = vertical ? video.dataset.srcV : pix >= 1500 ? video.dataset.srcH : video.dataset.srcM;
  }
  const mostra = () => {
    if (!aCorrer || !podeMostrar || video.classList.contains('a-tocar')) return;
    video.classList.add('a-tocar');
    // o Ken Burns do cartaz pára quando o filme já o cobre: segura o enquadramento, sem salto
    setTimeout(() => hero.classList.add('parado'), 1300);
  };
  const correu = () => { if (aCorrer) return; aCorrer = true; marcaTocar(); largaGestos(); mostra(); };
  // só conta quando há fotogramas a sério: requestVideoFrameCallback, ou o tempo a andar
  video.addEventListener('playing', () => {
    if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(correu);
    else { const v = () => (video.currentTime > 0 ? correu() : requestAnimationFrame(v)); v(); }
  });
  // se o browser recusar (Poupança de energia no iPhone), o cartaz ganha vida com um Ken Burns lento
  const recusou = () => hero.classList.add('kb');
  const tocar = (deNovo, gesto) => {
    if (reduz || document.hidden || !heroVisivel) return;
    if (deNovo) tentativas = 0;
    if (!video.paused && aCorrer) return;
    // um play de cada vez: enquanto a promessa anterior não responde, não se pede outro (um toque a sério passa sempre: é ele que destrava o Safari)
    if (pendente && !gesto) return;
    video.muted = true; video.defaultMuted = true;
    let p; try { p = video.play(); } catch (e) { p = Promise.reject(e); }
    if (!p || !p.then) return;
    pendente = true;
    p.then(() => { pendente = false; tentativas = 0; }, () => {
      pendente = false;
      recusou();
      if (tentativas < 4) { clearTimeout(retoma); retoma = setTimeout(() => tocar(), 400 * 2 ** tentativas++); }
    });
  };
  // qualquer gesto destrava o play no Safari: o primeiro toque, deslize, roda ou tecla
  const gestos = ['touchstart', 'touchend', 'pointerdown', 'pointerup', 'click', 'scroll', 'wheel', 'keydown'];
  // deslizar e rodar não destravam nada no Safari: no máximo um pedido a cada 600 ms, para o play recusado (Poupança de energia) não encher a thread
  // toques, cliques e teclas são ativação a sério e passam sempre
  const noGesto = (e) => {
    if (e.type === 'scroll' || e.type === 'wheel') { const t = performance.now(); if (pendente || t - ultimoGesto < 600) return; ultimoGesto = t; tocar(true); }
    else tocar(true, true);
  };
  const largaGestos = () => gestos.forEach((g) => removeEventListener(g, noGesto, { capture: true }));
  if (!reduz) {
    if (telemovel) hero.classList.add('kb');
    gestos.forEach((g) => addEventListener(g, noGesto, { passive: true, capture: true }));
    tocar(true);
    video.addEventListener('loadeddata', () => tocar(true), { once: true });
    video.addEventListener('canplay', () => tocar(true), { once: true });
    // se nada tocar até ao fim da abertura, o Ken Burns já está a correr
    setTimeout(() => aCorrer || recusou(), 3500);
  }
  document.addEventListener('visibilitychange', () => (document.hidden ? video.pause() : tocar(true)));
  addEventListener('pageshow', () => tocar(true));
  new IntersectionObserver(([e]) => { heroVisivel = e.isIntersecting; heroVisivel ? tocar(true) : video.pause(); }, { threshold: 0 }).observe(hero);
  // quando o logótipo pousa: o filme pode aparecer e é chamado outra vez
  const fimDoLogo = () => { podeMostrar = true; mostra(); tocar(true); };

  /* ---------- abertura: a linha de água risca o ecrã, as letras emergem, o logótipo voa para o cabeçalho ---------- */
  const hl = hl0, alvo = $('[data-logo-alvo]');
  // outras secções podem adiar trabalho pesado até o logótipo pousar: DA.abertura.then(...) ou o evento 'da:aberto'
  let acabou; DA.abertura = new Promise((r) => (acabou = r));
  const avisa = () => { acabou(); document.dispatchEvent(new Event('da:aberto')); fimDoLogo(); };
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));
  const quadros = (n) => new Promise((r) => { const f = () => (--n <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
  // todos os tempos saem do token --t-toque, os mesmos que o CSS usa
  const T = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--t-toque')) || 200;
  const RISCA = T * 6, VOO = T * 14, VOA = T * 6; // RISCA é a --t-cena da linha de água no CSS

  if (reduz || !hl) {
    document.body.classList.remove('a-abrir'); hero.classList.add('pronto'); hl && hl.remove();
    texto.classList.add('entra', 'vivo', 'assente'); avisa();
  } else {
    // o logótipo verdadeiro (o mesmo caminho do cabeçalho) passa a uma imagem só, decodificada uma vez; branco puro como o do cabeçalho
    const d = $('#logo path').getAttribute('d');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4940 1192" width="4940" height="1192"><g transform="translate(0,1192) scale(1,-1)" fill="#fff"><path d="${d}"/></g></svg>`;
    const url = 'data:image/svg+xml,' + encodeURIComponent(svg);
    const imgs = $$('img', hl);
    imgs.forEach((i) => { i.decoding = 'sync'; i.src = url; });
    const logoPronto = Promise.all(imgs.map((i) => i.decode().catch(() => {})));
    const fundo = Promise.race([poster.decode().catch(() => {}), aTocar]);
    document.documentElement.style.overflow = 'hidden';
    const solta = () => { document.documentElement.style.overflow = ''; };
    hero.classList.add('sombra');
    // telemóvel ao alto: a câmara começa a enquadrar o mar por baixo do casco, sem transição
    if (vertical) hero.classList.add('camara-m');

    Promise.race([Promise.all([document.fonts.ready, fundo, logoPronto]), espera(900)])
      .then(() => quadros(2))
      .then(() => {
        // cada pedaço de letras sobe quando a cabeça da esteira passa por baixo dele (mesma curva da esteira, a do site)
        const bz = (s, a, b) => 3 * (1 - s) * (1 - s) * s * a + 3 * (1 - s) * s * s * b + s * s * s;
        // a curva é a única do site, var(--curva) = cubic-bezier(.16,1,.3,1): y com pontos 1 e 1, tempo com .16 e .3
        const tempoPara = (y) => { let lo = 0, hi = 1; for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; bz(m, 1, 1) < y ? (lo = m) : (hi = m); } return bz(lo, .16, .3); };
        const largura = hl.clientWidth;
        $$('.hl-l', hl).forEach((j) => {
          const r = j.getBoundingClientRect(), x = r.left + r.width * 0.35;
          j.firstElementChild.style.animationDelay = Math.round(tempoPara(clamp(x / largura)) * RISCA) + 'ms';
        });
        // o voo e o título ficam declarados já, com atraso no CSS (--voo = t-toque*14, quando YACHTS assenta):
        // o compositor corre-os a horas mesmo que outra secção ocupe a thread principal
        const caixa = $('[data-hl]', hl), a = caixa.getBoundingClientRect(), b = $('svg', alvo).getBoundingClientRect();
        hero.classList.add('pronto');
        hl.classList.add('abre');
        // a câmara assenta quando YACHTS acaba de assentar, antes do voo: o casco desce para o lugar enquanto o logótipo sobe
        if (vertical) { hero.style.setProperty('--voo-c', Math.round(T * 12) + 'ms'); hero.classList.remove('camara-m'); }
        caixa.classList.add('voa');
        caixa.style.transform = `translate3d(${b.left - a.left}px,${b.top - a.top}px,0) scale(${b.width / a.width})`;
        texto.classList.add('com-voo', 'entra');
        performance.mark('abertura');
        setTimeout(solta, VOO + T * 2.5);
        let pousou = false;
        const pousa = () => {
          if (pousou) return; pousou = true;
          // o logótipo do cabeçalho aparece por baixo no mesmo píxel (mesmo branco, mesma mistura); só depois o que voou se apaga
          document.body.classList.remove('a-abrir');
          hl.classList.add('pousou');
          texto.classList.add('vivo');
          setTimeout(() => { hl.remove(); avisa(); setTimeout(() => hero.classList.remove('sombra'), T * 2); }, T * 1.3);
          setTimeout(() => texto.classList.add('assente'), T * 11);
        };
        caixa.addEventListener('transitionend', (e) => e.propertyName === 'transform' && pousa());
        setTimeout(pousa, VOO + VOA + T);
      });
    setTimeout(solta, 6000); // garantia
  }

  // o --q escreve-se só nas folhas que o usam (cartaz, filme, texto) e está registado sem herança (10-hero.css):
  // mudar o valor não recalcula o estilo de nada por baixo. Onde o browser tem animation-timeline, o CSS anima
  // o parallax no compositor (cola ao scroll do dedo) e aqui fica só o que é estado: fora e sobre-hero.
  const folhas = [video, poster].filter(Boolean);
  const peloCSS = !reduz && CSS.supports && CSS.supports('animation-timeline: scroll()');
  let ultimo = -1, altHero = hero.offsetHeight, qAnt = '', qtAnt = '', foraAnt = null, sobreAnt = null;
  addEventListener('resize', () => { altHero = hero.offsetHeight; ultimo = -1; }, { passive: true });
  DA.aCada((t, ecra) => {
    const y = ecra.y, h = ecra.h;
    if (y === ultimo || y > h * 1.2 && ultimo > h * 1.2) { ultimo = y; return; }
    ultimo = y;
    const qt = clamp(y / (h * 0.7));
    if (!peloCSS) {
      const s = (reduz ? 0 : qt).toFixed(4), st = qt.toFixed(4);
      if (s !== qAnt) { qAnt = s; folhas.forEach((f) => f.style.setProperty('--q', s)); }
      if (st !== qtAnt) { qtAnt = st; texto.style.setProperty('--q', st); }
    }
    const fora = qt > 0.6;
    if (fora !== foraAnt) { foraAnt = fora; texto.classList.toggle('fora', fora); }
    // enquanto o hero está por baixo do cabeçalho, o cabeçalho não usa difference (ver 10-hero.css)
    const sobre = y < altHero * 0.82;
    if (sobre !== sobreAnt) { sobreAnt = sobre; document.body.classList.toggle('sobre-hero', sobre); }
  });
})();
