(() => {
  const { $, $$, reduz, clamp, vh, prog } = DA;
  /* ---------- A TRAVESSIA: o D60 navega pela página ---------- */
  const trav = $('[data-travessia]'), svgRota = $('[data-rota]'), paths = $$('[data-rota-p]'), iate = $('[data-iate]');
  const janelaRota = $('[data-rota-janela]');
  // até a rota existir o barco não aparece (nasce depois da abertura, fora do ecrã)
  iate.style.visibility = 'hidden';
  const casco = $('[data-iate-casco]'), sob = $('[data-iate-sob]');
  let mapa = $('[data-mapa]'); const cv = $('[data-espuma]'), cx = cv.getContext('2d'), hud = $('[data-hud]'), nosEl = $('[data-nos]'), rumoEl = $('[data-rumo]');
  const mqEstreito = matchMedia('(max-width:900px)');
  let feito = '', LUT = [], L = 0, L0 = 0, len = 0, lenAlvo = 0, iniciado = false, chegou = false, estreito = false, monotona = false, altRota = 0;
  let compIate = 0, bocaIate = 0; // comprimento e boca do barco em px, lidos só quando a rota se refaz
  const espumas = [];

  function pontoBCN() {
    // o mapa à vista: o grande no computador, o da porta dos dealers no telemóvel
    const vis = (sel) => $$(sel, trav).find((e) => e.getClientRects().length) || $(sel, trav);
    mapa = vis('[data-mapa]');
    const s = vis('.mapa-svg').getBoundingClientRect(), t = trav.getBoundingClientRect();
    return { x: s.left - t.left + (window.MAPA.bcn.x / window.MAPA.w) * s.width, y: s.top - t.top + (window.MAPA.bcn.y / window.MAPA.h) * s.height };
  }
  function construir() {
    const t = trav.getBoundingClientRect(), W = t.width;
    estreito = mqEstreito.matches;
    compIate = iate.offsetWidth; bocaIate = iate.offsetHeight;
    const tit = $('.motores .titulo-g', trav).getBoundingClientRect();
    const meia = compIate * 0.46;
    const b = pontoBCN();
    let pts;
    if (estreito) {
      // telemóvel: uma linha recta, colada à esquerda, ao centro da faixa livre; só no fim se desvia para entrar em Barcelona
      const faixa = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--faixa-m')) || 52;
      const x = faixa / 2, cais = { x, y: tit.top - t.top + tit.height / 2 };
      pts = [{ x, y: cais.y - meia }, cais];
      const yA = b.y - Math.min(380, vh() * 0.46);
      if (yA > cais.y + 60) pts.push({ x, y: yA });
      pts.push(b);
    } else {
      // o cais: ao lado do título dos motores, na faixa à esquerda, de proa para baixo e centrado no bloco do título
      const cais = { x: clamp((tit.left - t.left) / 2, 22, W * 0.2), y: tit.top - t.top + tit.height / 2 };
      // a rota começa na popa atracada: um troço recto até ao centro do barco, de modo que a esteira nasce no cais
      pts = [{ x: cais.x, y: cais.y - meia }, cais];
      // cada secção tem uma faixa de navegação (data-via): o iate entra nela no topo e sai no fundo, e cruza no intervalo
      $$('[data-via]', trav).forEach((el) => {
        const r = el.getBoundingClientRect(), x = +el.dataset.via * W, a = r.top - t.top, z = a + r.height;
        const m = Math.min(160, r.height * 0.18);
        [a + m, z - m].forEach((y) => { if (y > pts[pts.length - 1].y + 100) pts.push({ x, y }); });
      });
      // aproxima-se do mapa por cima e entra no porto de Barcelona
      pts.push({ x: b.x, y: b.y - Math.min(420, vh() * 0.5) }, b);
    }
    // curvas com tangente vertical em cada ponto: nunca saem da faixa para os lados (num troço vertical são rectas)
    let d = `M${pts[0].x} ${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], c = pts[i + 1], h = (c.y - a.y) * 0.5;
      d += ` C${a.x} ${a.y + h} ${c.x} ${c.y - h} ${c.x} ${c.y}`;
    }
    svgRota.setAttribute('viewBox', `0 0 ${W} ${t.height}`);
    paths.forEach((p) => p.setAttribute('d', d));
    // a tabela de pontos sai das próprias curvas, calculada aqui: getPointAtLength milhares de vezes custava 165 ms
    const amostras = [{ x: pts[0].x, y: pts[0].y, s: 0 }];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], c = pts[i + 1], h = (c.y - a.y) * 0.5, n = Math.max(8, Math.ceil((Math.abs(c.y - a.y) + Math.abs(c.x - a.x)) / 2));
      for (let k = 1; k <= n; k++) {
        const u = k / n, v = 1 - u, w0 = v * v * v, w1 = 3 * v * v * u, w2 = 3 * v * u * u, w3 = u * u * u;
        const x = w0 * a.x + w1 * a.x + w2 * c.x + w3 * c.x, y = w0 * a.y + w1 * (a.y + h) + w2 * (c.y - h) + w3 * c.y;
        const q = amostras[amostras.length - 1];
        amostras.push({ x, y, s: q.s + Math.hypot(x - q.x, y - q.y) });
      }
    }
    L = amostras[amostras.length - 1].s;
    LUT = [];
    let maxY = -1, j = 0;
    for (let s = 0; s <= L; s += 4) {
      while (j < amostras.length - 2 && amostras[j + 1].s < s) j++;
      const q = amostras[j], r = amostras[j + 1], f = r.s > q.s ? (s - q.s) / (r.s - q.s) : 0;
      const x = q.x + (r.x - q.x) * f, y = q.y + (r.y - q.y) * f;
      maxY = Math.max(maxY, y); LUT.push({ s, x, y, my: maxY });
    }
    // a rota desce sempre (cada ponto abaixo do anterior)? então «tudo o que já ficou para trás» é «tudo acima de uma linha»:
    // a esteira revela-se com uma janela que só muda transform (compositor), sem repintar o traço. Senão, o tracejado de sempre.
    monotona = LUT.every((q, i) => !i || q.y >= LUT[i - 1].y - 0.5);
    altRota = t.height;
    janelaRota.classList.toggle('corre', monotona && !reduz);
    if (monotona) { paths.forEach((p) => { p.style.strokeDasharray = ''; p.style.strokeDashoffset = ''; }); }
    else { janelaRota.style.transform = ''; svgRota.style.transform = ''; paths.forEach((p) => { p.style.strokeDasharray = `${L} ${L + 40}`; }); }
    mostrado.rv = '';
    feito = W + 'x' + Math.round(t.height);
    const atracado = !iniciado || len <= L0 + 1;
    L0 = meia;
    if (atracado && !reduz) len = L0;
    iniciado = true;
    iate.style.visibility = '';
    DA.remede();
  }

  /* ---------- MERGULHO: o barco passa por baixo das fotografias, dos vídeos e do raio X ----------
     Cada peça opaca dentro da travessia que cruza a rota vira um troço [entra, sai] em comprimento de rota.
     Calcula-se quando o desenho muda (ResizeObserver, imagens que chegam), nunca em cada fotograma. */
  const SEL_MEDIA = 'img,video,picture,.raiox,[data-mergulho]';
  let troços = [], DM = 160;
  function mapaMedia() {
    if (!LUT.length) return;
    const t = trav.getBoundingClientRect(), caixas = [], rel = (r) => [r.left - t.left, r.top - t.top, r.right - t.left, r.bottom - t.top];
    for (const e of trav.querySelectorAll(SEL_MEDIA)) {
      if (e.closest('[data-iate],dialog,[hidden],[data-nao-mergulha]')) continue;
      if (e.parentElement && e.parentElement.closest('.raiox,picture')) continue; // conta o cartão, não cada imagem dentro dele
      let q = rel(e.getBoundingClientRect()), clip = null, cr = null, fade = null;
      // o que se vê é o que a moldura deixa ver: recorta pelos antepassados com overflow escondido e guarda o recorte animado (clip-path)
      for (let a = e; a && a !== trav; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (a !== e && (cs.overflowX !== 'visible' || cs.overflowY !== 'visible')) {
          const r = rel(a.getBoundingClientRect());
          if (cs.overflowX !== 'visible') { q[0] = Math.max(q[0], r[0]); q[2] = Math.min(q[2], r[2]); }
          if (cs.overflowY !== 'visible') { q[1] = Math.max(q[1], r[1]); q[3] = Math.min(q[3], r[3]); }
        }
        // máscara em degradé vertical (o filme da aventura apaga o topo): só conta a parte que já se vê
        if (fade === null) { const f = fadeMascara(a, cs); if (f) fade = f; }
        if (!clip && cs.clipPath.startsWith('inset(')) { clip = a; cr = rel(a.getBoundingClientRect()); q = [Math.max(q[0], cr[0]), Math.max(q[1], cr[1]), Math.min(q[2], cr[2]), Math.min(q[3], cr[3])]; }
      }
      if (fade) { const h = fade.r[3] - fade.r[1]; q[1] = Math.max(q[1], fade.r[1] + fade.topo * h); q[3] = Math.min(q[3], fade.r[3] - fade.fundo * h); }
      if (q[2] - q[0] < 48 || q[3] - q[1] < 48) continue;
      caixas.push({ q, clip, cr });
    }
    // fotografias lado a lado (uma faixa que anda de lado) contam como uma só banda: o barco não espreita nos intervalos
    caixas.sort((a, b) => a.q[1] - b.q[1]);
    const bandas = [];
    for (const c of caixas) {
      const u = bandas.find((b) => Math.min(b.q[3], c.q[3]) - Math.max(b.q[1], c.q[1]) > 0.7 * Math.min(b.q[3] - b.q[1], c.q[3] - c.q[1]));
      if (u) { const q = u.q; q[0] = Math.min(q[0], c.q[0]); q[1] = Math.min(q[1], c.q[1]); q[2] = Math.max(q[2], c.q[2]); q[3] = Math.max(q[3], c.q[3]); if (u.clip !== c.clip) u.clip = null; }
      else bandas.push({ q: c.q.slice(), clip: c.clip, cr: c.cr });
    }
    // conta também quando a peça só cobre parte da boca do barco
    const folga = bocaIate * 0.32;
    troços = [];
    for (const b of bandas) {
      const q = b.q; let dentro = false, a = 0, x = 0;
      for (const p of LUT) {
        const i = p.x > q[0] - folga && p.x < q[2] + folga && p.y > q[1] && p.y < q[3];
        if (i && !dentro) { a = p.s; x = p.x; dentro = true; } else if (!i && dentro) { troços.push({ a, b: p.s, x, ...b }); dentro = false; }
      }
      if (dentro) troços.push({ a, b: L, x, ...b });
    }
    troços.sort((a, b) => a.a - b.a);
    DM = estreito ? 150 : 170;
  }
  // lê uma vez por mapa a máscara de um elemento: devolve a fracção transparente em cima e em baixo, ou null
  function fadeMascara(a, cs) {
    const r = () => { const b = a.getBoundingClientRect(), t = trav.getBoundingClientRect(); return [b.left - t.left, b.top - t.top, b.right - t.left, b.bottom - t.top]; };
    if (a.dataset && a.dataset.mergulhoTopo) return { r: r(), topo: parseFloat(a.dataset.mergulhoTopo) / 100 || 0, fundo: 0 };
    const m = cs.maskImage || cs.webkitMaskImage || 'none';
    if (m === 'none' || !/^linear-gradient\(/.test(m)) return null;
    const corpo = m.slice(16, m.lastIndexOf(')'));
    const partes = corpo.split(/,(?![^(]*\))/).map((x) => x.trim());
    let dir = 'to bottom';
    if (/^(to |-?[\d.]+(deg|turn|rad))/.test(partes[0])) dir = partes.shift();
    const baixo = dir === 'to bottom' || dir === '180deg' || dir === '0.5turn', cima = dir === 'to top' || dir === '0deg';
    if (!baixo && !cima) return null; // degradé de lado (o mapa): não muda a altura
    const alfa = (c) => { if (/transparent/.test(c)) return 0; const k = /rgba?\(([^)]*)\)/.exec(c); if (!k) return 1; const v = k[1].split(/[\s,/]+/).filter(Boolean); return v.length > 3 ? parseFloat(v[3]) : 1; };
    const pos = (c, i, n) => { const k = /(-?[\d.]+)%\s*$/.exec(c); return k ? parseFloat(k[1]) / 100 : i / Math.max(1, n - 1); };
    const st = partes.map((c, i) => ({ a: alfa(c), p: pos(c, i, partes.length) }));
    // até onde a máscara ainda não deixa ver o filme quase inteiro (alfa 0.9) a partir de cada ponta
    const ponta = (lista) => { if (lista[0].a >= 0.9) return 0; const k = lista.find((x) => x.a >= 0.9); return k ? k.p : 0; };
    const ini = ponta(st), fim = 1 - (() => { const inv = st.map((x) => ({ a: x.a, p: 1 - x.p })).reverse(); return ponta(inv); })();
    const topo = baixo ? ini : 1 - fim, fundo = baixo ? 1 - fim : ini;
    if (topo <= 0 && fundo <= 0) return null;
    return { r: r(), topo: clamp(topo, 0, 0.5), fundo: clamp(fundo, 0, 0.5) };
  }
  // recorte animado (a janela do D60 abre com o scroll): lê-se o clip-path já resolvido, só da peça que está perto do barco
  function recorte(el, w, h) {
    const m = /^inset\(([^)]*)\)$/.exec(getComputedStyle(el).clipPath); if (!m) return null;
    const v = m[1].split(' round ')[0].trim().split(/\s+/);
    const n = (x, base) => (x.endsWith('%') ? parseFloat(x) / 100 * base : parseFloat(x) || 0);
    const [tp, rt = tp, bt = tp, lf = rt] = v;
    return [n(tp, h), n(rt, w), n(bt, h), n(lf, w)];
  }
  const suave = (k) => k * k * (3 - 2 * k);
  const ativos = [];
  function fundura(s) {
    // troços perto do barco, já com o recorte do momento
    ativos.length = 0;
    const perto = DM * 3 + 600, folga = bocaIate * 0.32;
    for (const m of troços) {
      if (s < m.a - perto || s > m.b + perto) continue;
      let a = m.a, b = m.b, k = 1;
      if (m.clip) {
        const c = m.cr, i = m.ins; // lido na fase de leitura do fotograma (DA.aLer), antes de qualquer escrita
        if (i) {
          // ainda fechada de lado: quanto mais longe a moldura está da faixa do barco, menos ele desce
          const fora = Math.max(c[0] + i[3] - (m.x + folga), (m.x - folga) - (c[2] - i[1]));
          k = 1 - clamp(fora / (bocaIate * 1.5));
          if (k <= 0) continue;
          a += Math.max(0, c[1] + i[0] - m.q[1]); b -= Math.max(0, m.q[3] - (c[3] - i[2]));
          if (b <= a) continue;
        }
      }
      ativos.push([a, b, k]);
    }
    // peças muito próximas: fica submerso entre elas em vez de subir e voltar a descer
    let d = 0, u = null;
    const sobeAntes = compIate * 0.18;
    const conta = (a, b, k) => { b = Math.max(a, b - sobeAntes); if (s < a - DM || s > b + DM) return; d = Math.max(d, k * suave(clamp(s < a ? (s - a + DM) / DM : s <= b ? 1 : 1 - (s - b) / DM))); };
    for (const m of ativos) {
      if (u && m[0] - u[1] < DM * 1.7) { u[1] = Math.max(u[1], m[1]); u[2] = Math.max(u[2], m[2]); }
      else { if (u) conta(u[0], u[1], u[2]); u = m.slice(); }
    }
    if (u) conta(u[0], u[1], u[2]);
    return d;
  }

  // fase de leitura: o recorte animado das molduras perto do barco (getComputedStyle) lê-se aqui, antes de todas as escritas do fotograma
  DA.aLer(() => {
    if (!travVisivel || !troços.length) return;
    const perto = DM * 3 + 600;
    for (const m of troços) {
      if (!m.clip) continue;
      if (len < m.a - perto || len > m.b + perto) { m.ins = null; continue; }
      const c = m.cr; m.ins = recorte(m.clip, c[2] - c[0], c[3] - c[1]);
    }
  });

  const naLUT = (s) => { const i = clamp(Math.round(s / 4), 0, LUT.length - 1); return LUT[i]; };
  function lenPara(yAlvo) { // primeiro ponto cuja maior altura até ali já passa o alvo
    let a = 0, b = LUT.length - 1;
    if (yAlvo <= LUT[0].y) return 0; if (yAlvo >= LUT[b].my) return L;
    while (a < b) { const m = (a + b) >> 1; if (LUT[m].my < yAlvo) a = m + 1; else b = m; }
    return LUT[a].s;
  }
  // o canvas da espuma: largura do ecrã, altura de 1,5 ecrãs (a folga cobre o scroll que o compositor faz antes do próximo fotograma).
  // Só se refaz quando a largura muda ou o ecrã cresce para lá da folga: a barra do Safari a esconder-se não o limpa.
  let cvW = 0, cvH = 0, cvTop = -1, dprCv = 1;
  function tamCanvas() {
    const w = trav.clientWidth || innerWidth, h = Math.ceil(innerHeight * 1.5);
    if (w === cvW && h <= cvH && h > cvH * 0.8) return;
    // no máximo ~6 milhões de píxeis: num ecrã grande a espuma desce para 1,5x, que não se distingue
    dprCv = Math.min(2, devicePixelRatio || 1); if (w * h * dprCv * dprCv > 6e6) dprCv = Math.max(1, Math.sqrt(6e6 / (w * h)));
    cvW = w; cvH = h; cv.width = Math.round(w * dprCv); cv.height = Math.round(h * dprCv); cv.style.height = h + 'px';
    cx.setTransform(dprCv, 0, 0, dprCv, 0, 0); sujo = null; cvTop = -1;
  }

  // efeitos de água: 0 espuma, 1 anel, 2 bolha
  const anel = (x, y, ang, forte) => espumas.push({ k: 1, x, y, ang, r: bocaIate * 0.3, e: compIate * 0.22, vr: (estreito ? 0.55 : 0.8) * forte, v: 1, q: 0.011 + 0.004 / forte, a: 0.42 * forte });
  const bolha = (x, y) => espumas.push({ k: 2, x, y, r: 0.5, vr: 0.018 + Math.random() * 0.022, vx: (Math.random() - 0.5) * 0.2, vy: (Math.random() - 0.5) * 0.2, v: 1, q: 0.016 + Math.random() * 0.012 });
  function salpico(x, y, ang, n) {
    for (let i = 0; i < n; i++) {
      const a = ang + (Math.random() - 0.5) * Math.PI * 2, sp = (0.5 + Math.random() * 1.3) * (estreito ? 0.6 : 1);
      espumas.push({ k: 0, x: x + (Math.random() - 0.5) * 6, y: y + (Math.random() - 0.5) * 6, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: 1.2 + Math.random() * 2.2, v: 0.9 });
    }
  }

  let sujo = null;
  const baldes = Array.from({ length: 10 }, () => []);
  let dSuave = 0, tAnt = performance.now(), nos = 0, rumo = 180, hudLivre = false, dAnt = 0, mostrado = { tr: '', c: '', s: '', o: '', rv: '', n: '', r: '', h: null };
  function travessia(t, tr) {
    if (!iniciado || !LUT.length) return;
    const dt = Math.min(64, t - tAnt) / 16.67; tAnt = t;
    const yAlvo = -tr.top + vh() * 0.56;
    // até a linha de leitura chegar ao cais o barco fica atracado; depois larga e segue a rota
    lenAlvo = Math.max(L0, lenPara(yAlvo));
    if (reduz) len = L; else len += (lenAlvo - len) * (1 - Math.pow(1 - 0.085, dt));
    const p = naLUT(len), pa = naLUT(len - 18), pd = naLUT(len + 18);
    let ang = Math.atan2(pd.y - pa.y, pd.x - pa.x);
    // amarrado: um balanço quase parado, que se desfaz nos primeiros metros depois de largar
    const amarra = reduz ? 0 : clamp(1 - (len - L0) / 90);
    let mx = 0, my = 0;
    if (amarra > 0) {
      ang += amarra * 0.6 * Math.PI / 180 * Math.sin(t / 2300 + 0.8);
      mx = amarra * 1.2 * Math.sin(t / 3100);
      my = amarra * 2.2 * Math.sin(t / 1700);
    }
    // perto do porto o iate encolhe até ser o farol de Barcelona
    const resto = L - len, esc = clamp(resto / 520, 0.06, 1);
    // mergulho: guiado pela posição suavizada do barco, por isso entra e sai sem saltos nos dois sentidos
    // a fundura ainda passa por um amortecedor curto: uma moldura que abre de repente não faz o barco saltar
    const dAlvo = fundura(len);
    dSuave = reduz ? dAlvo : dSuave + (dAlvo - dSuave) * (1 - Math.pow(1 - 0.16, dt));
    if (Math.abs(dAlvo - dSuave) < 0.002) dSuave = dAlvo;
    const d = dSuave;
    const trS = `translate(${(p.x + mx - compIate / 2).toFixed(2)}px,${(p.y + my - bocaIate / 2).toFixed(2)}px) rotate(${ang.toFixed(4)}rad) scale(${(esc * (1 - 0.12 * d)).toFixed(4)})`;
    if (trS !== mostrado.tr) { iate.style.transform = trS; mostrado.tr = trS; }
    const oC = (1 - clamp(d / 0.7)).toFixed(3), oS = (0.8 * clamp(d / 0.35) * (1 - clamp((d - 0.5) / 0.5))).toFixed(3);
    const oI = (resto < 40 ? clamp(resto / 40) : 1).toFixed(3);
    if (oC !== mostrado.c) { casco.style.opacity = oC; mostrado.c = oC; }
    if (oS !== mostrado.s) { sob.style.opacity = oS; mostrado.s = oS; }
    if (oI !== mostrado.o) { iate.style.opacity = oI; mostrado.o = oI; }
    // o velocímetro só aparece quando a proa já não está por cima dele
    hudLivre = len > L0 + 4 || p.y + tr.top + compIate * 0.5 < vh() - 72;
    const popa = len - compIate * 0.46 * esc;
    if (monotona) {
      // a janela desce até à popa; a esteira por dentro fica parada na página (dois transform, nada se repinta)
      const yv = popa <= 0 ? 0 : Math.min(altRota, naLUT(popa).my);
      const rv = (yv - altRota).toFixed(1);
      if (rv !== mostrado.rv) { mostrado.rv = rv; janelaRota.style.transform = `translate3d(0,${rv}px,0)`; svgRota.style.transform = `translate3d(0,${(altRota - yv).toFixed(1)}px,0)`; }
    } else {
      const dv = (L - Math.max(0, popa)).toFixed(1);
      if (dv !== mostrado.rv) { mostrado.rv = dv; paths.forEach((q) => { q.style.strokeDashoffset = dv; }); }
    }
    // chegada a Barcelona: as rotas do mundo acendem
    const agora = resto < 30;
    if (agora !== chegou) { chegou = agora; mapa.classList.toggle('acende', agora); }
    // velocímetro: a velocidade do scroll em nós, até aos 46 do D60
    const v = Math.abs(lenAlvo - len) / dt;
    nos += (Math.min(46, v * 0.55) - nos) * 0.08;
    const deg = (Math.atan2(Math.cos(ang), -Math.sin(ang)) * 180 / Math.PI + 360) % 360; // rumo de bússola: descer a página é sul (180)
    rumo += (((deg - rumo + 540) % 360) - 180) * 0.1;
    // o texto só se escreve quando muda: trocar um nó de texto em cada fotograma obriga a refazer o layout
    const nT = String(Math.round(nos)), rT = String(Math.round((rumo + 360) % 360)).padStart(3, '0');
    if (nT !== mostrado.n) { mostrado.n = nT; nosEl.textContent = nT; }
    if (rT !== mostrado.r) { mostrado.r = rT; rumoEl.textContent = rT; }
    if (reduz) return;
    const c = Math.cos(ang), s = Math.sin(ang), meio = compIate * 0.47 * esc;
    // água: anéis e bolhas quando desce, anéis e um salpico de espuma quando volta à tona
    const dd = d - dAnt;
    if (dd > 0.0004) {
      [0.18, 0.5, 0.85].forEach((k, i) => { if (dAnt < k && d >= k) anel(p.x + c * meio * 0.2, p.y + s * meio * 0.2, ang, 1 - i * 0.22); });
      if (d > 0.08 && d < 0.97) {
        const n = Math.min(4, dd * 40 + (Math.random() < 0.35 ? 1 : 0));
        for (let i = 0; i < n; i++) { const k = (Math.random() - 0.4) * 1.4; bolha(p.x + c * meio * k + (Math.random() - 0.5) * bocaIate * 0.5, p.y + s * meio * k + (Math.random() - 0.5) * bocaIate * 0.5); }
      }
    } else if (dd < -0.0004) {
      if (dAnt >= 0.9 && d < 0.9) { anel(p.x + c * meio * 0.5, p.y + s * meio * 0.5, ang, 1); salpico(p.x + c * meio * 0.6, p.y + s * meio * 0.6, ang, 18); }
      if (dAnt >= 0.45 && d < 0.45) { anel(p.x, p.y, ang, 0.8); salpico(p.x + c * meio * 0.2, p.y + s * meio * 0.2, ang, 10); }
      if (d > 0.1 && Math.random() < 0.5) bolha(p.x + c * meio * (Math.random() - 0.5) * 1.6, p.y + s * meio * (Math.random() - 0.5) * 1.6);
    }
    dAnt = d;
    // espuma da esteira (só à superfície)
    const ox = tr.left, oy = tr.top, lat = estreito ? 0.35 : 1;
    if (v > 0.4 && esc > 0.3 && len > L0 + 4 && d < 0.3) {
      // no telemóvel a esteira é um rasto curto e calmo atrás da popa, não uma coluna de bolinhas pela página
      const sx = p.x - c * meio, sy = p.y - s * meio, n = (estreito ? Math.min(2, 1 + v / 10) : Math.min(4, 1 + v / 6)) * (1 - d / 0.3);
      for (let i = 0; i < n; i++) {
        const lado = i % 2 ? 1 : -1, sp = (0.25 + Math.random() * 0.5) * lat;
        espumas.push(estreito
          ? { k: 0, x: sx + (Math.random() - .5) * 5, y: sy + (Math.random() - .5) * 6, vx: -s * lado * sp - c * 0.3, vy: c * lado * sp - s * 0.3, r: 0.9 + Math.random() * 1.5 * esc, v: 1, g: 0.012, q: 0.02 }
          : { k: 0, x: sx + (Math.random() - .5) * 8, y: sy + (Math.random() - .5) * 8, vx: -s * lado * sp - c * 0.3, vy: c * lado * sp - s * 0.3, r: 2 + Math.random() * 3 * esc, v: 1, g: 0.06 });
      }
      // onda de proa
      const bx = p.x + c * compIate * 0.48 * esc, by = p.y + s * compIate * 0.48 * esc;
      if (Math.random() < 0.6) { const lado = Math.random() < .5 ? 1 : -1; espumas.push({ k: 0, x: bx, y: by, vx: -s * lado * 0.9 * lat, vy: c * lado * 0.9 * lat, r: 1.5, v: 0.7 }); }
    }
    // um tecto de partículas (mais baixo no telemóvel); as mais velhas saem de uma vez, sem shift em ciclo
    const MAX = estreito ? 280 : 480;
    if (espumas.length > MAX) espumas.splice(0, espumas.length - MAX);
    // só se limpa o rectângulo sujo do fotograma anterior; sem espuma nenhuma, não se toca no canvas
    if (sujo) { cx.clearRect(sujo[0], sujo[1], sujo[2] - sujo[0], sujo[3] - sujo[1]); sujo = null; }
    if (!espumas.length) return;
    // o canvas segue o ecrã por transform, em passos: as coordenadas de desenho são as da travessia menos o topo do canvas
    const H = vh(), topoVer = -oy, margem = (cvH - H) / 2;
    if (cvTop < 0 || topoVer < cvTop + margem * 0.25 || topoVer + H > cvTop + cvH - margem * 0.25) {
      const nt = Math.round(Math.max(0, Math.min(altRota - cvH, topoVer - margem)));
      if (nt !== cvTop) { cvTop = nt; cv.style.transform = `translate3d(0,${nt}px,0)`; cx.clearRect(0, 0, cvW, cvH); }
    }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    cx.fillStyle = '#f3efe6'; cx.strokeStyle = '#f3efe6';
    // os pontos de espuma juntam-se por opacidade (10 níveis) e cada nível é um só caminho e um só fill
    const nivel = baldes; for (let k = 0; k < nivel.length; k++) nivel[k].length = 0;
    let w = 0;
    for (let i = 0; i < espumas.length; i++) {
      const e = espumas[i];
      if (e.k === 1) { e.r += e.vr * dt * (0.4 + e.v); e.v -= e.q * dt; }
      else if (e.k === 2) { e.x += e.vx * dt; e.y += e.vy * dt; e.r += e.vr * dt * 2.2; e.v -= e.q * dt; }
      else { e.x += e.vx * dt; e.y += e.vy * dt; e.vx *= 0.97; e.vy *= 0.97; e.r += (e.g || 0.06) * dt; e.v -= (e.q || 0.012) * dt; }
      if (e.v <= 0) continue;
      espumas[w++] = e;
      const X = e.x, Y = e.y - cvTop; if (Y < -60 || Y > cvH + 60) continue;
      const R = (e.k === 1 ? e.r + e.e : e.r) + 3;
      if (X - R < x0) x0 = X - R; if (Y - R < y0) y0 = Y - R; if (X + R > x1) x1 = X + R; if (Y + R > y1) y1 = Y + R;
      if (e.k === 0) { const a = e.v * (estreito ? 0.18 : 0.32); nivel[Math.min(9, Math.max(0, Math.round(a * 30)))].push(X, Y, Math.min(e.r, estreito ? 2.4 : 99)); continue; }
      if (e.k === 1) {
        // anel na água: alongado como o casco que o desenhou
        cx.globalAlpha = e.a * e.v * e.v; cx.lineWidth = 0.6 + 1.2 * e.v;
        cx.beginPath(); cx.ellipse(X, Y, e.r + e.e, e.r, e.ang, 0, 6.283); cx.stroke();
      } else if (e.k === 2) {
        // bolha que chega à tona: cresce, brilha e rebenta
        const a = Math.sin(Math.PI * Math.min(1, (1 - e.v) * 1.25));
        cx.globalAlpha = 0.55 * a; cx.lineWidth = 0.9;
        cx.beginPath(); cx.arc(X, Y, e.r, 0, 6.283); cx.stroke();
        cx.globalAlpha = 0.35 * a; cx.beginPath(); cx.arc(X - e.r * 0.3, Y - e.r * 0.3, Math.max(0.4, e.r * 0.25), 0, 6.283); cx.fill();
      }
    }
    espumas.length = w;
    for (let k = 0; k < nivel.length; k++) {
      const v = nivel[k]; if (!v.length) continue;
      cx.globalAlpha = k / 30; cx.beginPath();
      for (let j = 0; j < v.length; j += 3) { cx.moveTo(v[j] + v[j + 2], v[j + 1]); cx.arc(v[j], v[j + 1], v[j + 2], 0, 6.283); }
      cx.fill();
    }
    cx.globalAlpha = 1;
    if (x1 > x0) sujo = [Math.max(0, Math.floor(x0)), Math.max(0, Math.floor(y0)), Math.min(cvW, Math.ceil(x1)), Math.min(cvH, Math.ceil(y1))];
  }

  let travVisivel = false;
  new IntersectionObserver(([e]) => { travVisivel = e.isIntersecting; cv.style.display = travVisivel && !reduz ? 'block' : 'none'; if (!travVisivel) hud.classList.remove('on'); }, { threshold: 0 }).observe(trav);

  /* ---------- RAIO X: a linha corre com o scroll e também se arrasta, se clica e se move com as setas ---------- */
  const raiox = $('[data-raiox]'), pega = $('[data-raiox-pega]');
  let doRaiox = () => {};
  if (raiox && pega) {
    // o scroll leva a linha de 95 a 5; o que a pessoa escolhe fica como desvio, que se dissolve à medida que continua a descer
    const peloScroll = (p = prog(raiox)) => (reduz ? 50 : 95 - clamp((p - 0.2) / 0.5) * 90);
    let desvio = 0, pAnt = null, mostradoX = '', valor = 95, arrasta = null, tv, meiaPega = (pega.offsetWidth || 56) / 2;
    addEventListener('resize', () => { meiaPega = (pega.offsetWidth || 56) / 2; mostradoX = ''; }, { passive: true });
    const escreve = (x) => {
      // a pega nunca sai da imagem: linha, recorte e pega param no mesmo sítio
      // larguras da medição guardada (DA.caixa) e da pega lida no resize: escrever o --x nunca força layout
      const w = DA.caixa(raiox).width, m = w ? Math.min(50, (meiaPega + 4) / w * 100) : 0;
      valor = clamp(x, m, 100 - m);
      const s = valor.toFixed(2); if (s === mostradoX) return; mostradoX = s;
      raiox.style.setProperty('--x', s);
      const n = Math.round(valor);
      pega.setAttribute('aria-valuenow', n);
      pega.setAttribute('aria-valuetext', `${100 - n}% shown in transparency`);
    };
    const anima = (classe, ms) => {
      raiox.classList.remove('vai', 'vai-curto'); clearTimeout(tv);
      if (!classe) return;
      raiox.classList.add(classe); tv = setTimeout(() => raiox.classList.remove(classe), ms);
    };
    const poe = (x, classe, ms) => { if (classe !== undefined) anima(classe, ms); escreve(x); desvio = valor - peloScroll(); pAnt = prog(raiox); };
    const xDe = (e) => { const r = DA.caixa(raiox); return ((e.pageX - r.left) / r.width) * 100; };
    raiox.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const naPega = pega.contains(e.target);
      arrasta = { id: e.pointerId, x0: e.clientX, y0: e.clientY, naPega, ativo: naPega };
      try { raiox.setPointerCapture(e.pointerId); } catch (_) {}
      if (naPega) { anima(null); raiox.classList.add('agarra'); pega.focus({ preventScroll: true }); }
    });
    raiox.addEventListener('pointermove', (e) => {
      if (!arrasta || e.pointerId !== arrasta.id) return;
      if (!arrasta.ativo) {
        const dx = Math.abs(e.clientX - arrasta.x0), dy = Math.abs(e.clientY - arrasta.y0);
        if (dx < 6 || dx < dy) return;
        arrasta.ativo = true; raiox.classList.add('agarra');
        poe(xDe(e), 'vai-curto', 220); // apanha o dedo sem salto
        return;
      }
      poe(xDe(e));
    });
    const solta = (e, cancelado) => {
      if (!arrasta || e.pointerId !== arrasta.id) return;
      // um toque curto fora da pega leva a linha até ali, com transição
      if (!cancelado && !arrasta.ativo && !arrasta.naPega && Math.hypot(e.clientX - arrasta.x0, e.clientY - arrasta.y0) < 6) poe(xDe(e), 'vai', 760);
      arrasta = null; raiox.classList.remove('agarra');
    };
    raiox.addEventListener('pointerup', (e) => solta(e, false));
    raiox.addEventListener('pointercancel', (e) => solta(e, true));
    raiox.addEventListener('lostpointercapture', (e) => solta(e, true));
    pega.addEventListener('keydown', (e) => {
      const passo = e.shiftKey ? 10 : 4;
      const teclas = { ArrowLeft: -passo, ArrowDown: -passo, ArrowRight: passo, ArrowUp: passo, PageDown: -20, PageUp: 20 };
      let x;
      if (e.key in teclas) x = valor + teclas[e.key];
      else if (e.key === 'Home') x = 0;
      else if (e.key === 'End') x = 100;
      else return;
      e.preventDefault();
      poe(x, 'vai-curto', 240);
    });
    doRaiox = (p) => {
      if (arrasta && arrasta.ativo) return;
      if (!reduz && desvio && pAnt !== null) { desvio *= Math.exp(-Math.abs(p - pAnt) * 3.5); if (Math.abs(desvio) < 0.05) desvio = 0; }
      pAnt = p;
      escreve(peloScroll(p) + desvio);
    };
    escreve(peloScroll());
  }

  // a caixa da travessia vem da medição guardada (DA.caixa): nenhuma leitura de layout neste laço
  const tr = { top: 0, left: 0, bottom: 0 };
  DA.aCada((t, ecra) => {
    if (!travVisivel) return;
    if (!iniciado) { if (ecra.y > 0) arrancar(); else return; }
    const c = DA.caixa(trav);
    tr.top = c.top - ecra.y; tr.left = c.left - scrollX; tr.bottom = c.bottom - ecra.y;
    const pr = raiox ? prog(raiox) : 0;
    travessia(t, tr);
    const on = !reduz && hudLivre && tr.bottom > ecra.h * 0.8;
    if (on !== mostrado.h) { mostrado.h = on; hud.classList.toggle('on', on); }
    doRaiox(pr);
  });
  // a rota faz-se depois da abertura (o barco atraca abaixo do hero e o scroll está preso até lá), ou no primeiro scroll;
  // o mapa dos mergulhos vem a seguir, num momento livre: nenhum dos dois cai a meio da animação do logótipo
  let arrancou = false;
  function arrancar() { if (arrancou) return; arrancou = true; construir(); tamCanvas(); if (reduz) len = L; DA.ocioso(mapaMedia, 400); }
  // refazer a rota é trabalho pesado: espera que o scroll pare, para nunca cair a meio de um gesto
  let rt, rm, wAnt = innerWidth, hAnt = innerHeight;
  // (o trabalho corre num momento livre da thread, depois do scroll parar; nunca dentro de um fotograma)
  const refaz = (ms = 150) => { clearTimeout(rt); rt = setTimeout(() => DA.quieto().then(() => DA.ocioso(() => { if (!arrancou) return; construir(); tamCanvas(); DA.ocioso(mapaMedia, 300); }, 300)), ms); };
  const remapa = () => { clearTimeout(rm); rm = setTimeout(() => DA.quieto().then(() => DA.ocioso(mapaMedia, 300)), 160); };
  addEventListener('resize', () => {
    // no telemóvel a barra do Safari muda a altura a meio do scroll: só a largura (ou um salto grande) refaz a rota
    const w = innerWidth, h = innerHeight, so = w === wAnt && Math.abs(h - hAnt) < 160;
    wAnt = w; if (!so) hAnt = h;
    if (so) { tamCanvas(); return; }
    refaz();
  }, { passive: true });
  const depoisDaAbertura = () => (DA.abertura ? DA.abertura : Promise.resolve()).then(() => DA.ocioso(arrancar, 300));
  if (document.readyState === 'complete') depoisDaAbertura(); else addEventListener('load', depoisDaAbertura);
  // as imagens têm width e height, por isso carregar não muda o desenho; o que muda de altura apanha-o o ResizeObserver
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (arrancou) refaz(60); });
  if ('ResizeObserver' in window) {
    // a primeira chamada chega logo a seguir ao arranque com o mesmo tamanho: não refaz a rota à toa no meio da abertura
    // um píxel de diferença (uma imagem pequena que chega) não refaz a rota inteira: só o mapa dos mergulhos
    new ResizeObserver(([e]) => {
      const r = e.target.getBoundingClientRect(); if (r.width + 'x' + Math.round(r.height) === feito) return;
      const [w0, h0] = feito.split('x').map(Number);
      if (iniciado && Math.round(r.width) === Math.round(w0) && Math.abs(r.height - h0) <= 3) { remapa(); return; }
      refaz();
    }).observe(trav);
    // cada peça que tapa a água: quando muda de tamanho, refazem-se os troços de mergulho
    const roM = new ResizeObserver(() => { if (iniciado) remapa(); });
    $$(SEL_MEDIA, trav).forEach((e) => { if (!e.closest('[data-iate]')) roM.observe(e); });
  }
})();
