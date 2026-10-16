(() => {
  /* ---------- «Build yours»: visor 3D próprio (three r160 local) para o D60 e o E23, configurador oficial da dimtech para os outros ---------- */
  const sec = document.querySelector('[data-mp-3d]'); if (!sec || !window.DA) return;
  const { $, $$, reduz } = DA;
  const SRC = document.currentScript ? document.currentScript.src : '';
  const BASE = new URL('../', SRC || location.href); // js/ vive na raiz do site
  const dados = JSON.parse($('#mp-dados').textContent);
  const visorEl = $('[data-mp-visor]', sec), oficialEl = $('[data-mp-oficial]', sec);
  const escolha = { casco: 'white', teca: 'scrubbed', calafeto: 'black', estofo: 'herm' };
  let versao = null, modo = null, perto = false, visivel = false, visor = null, aCarregar = null, iframeId = null;

  /* ---------- painel: separadores (telemóvel) e amostras ---------- */
  const abas = $$('[data-mp-aba]', sec);
  const abre = (aba, foco) => {
    abas.forEach((a) => { const on = a === aba; a.classList.toggle('activo', on); a.setAttribute('aria-selected', on); a.tabIndex = on ? 0 : -1; });
    $$('[data-mp-painel]', sec).forEach((p) => p.classList.toggle('activo', p.dataset.mpPainel === aba.dataset.mpAba));
    if (foco) aba.focus();
  };
  abas.forEach((a, i) => {
    a.addEventListener('click', () => abre(a));
    a.addEventListener('keydown', (e) => { const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key]; if (d) { e.preventDefault(); abre(abas[(i + d + abas.length) % abas.length], true); } });
  });
  abre(abas[0]);

  const amostras = $$('.mp-amostra', sec);
  const url = (p) => new URL(p, BASE).href;
  function pinta() {
    // nomes, estado e as amostras de convés com o calafeto escolhido
    for (const g of Object.keys(escolha)) {
      const b = amostras.find((x) => x.dataset.grupo === g && x.dataset.valor === escolha[g]);
      amostras.filter((x) => x.dataset.grupo === g).forEach((x) => { const on = x === b; x.classList.toggle('activo', on); x.setAttribute('aria-pressed', on); });
      const n = $(`[data-mp-nome="${g}"]`, sec); if (n && b) n.innerHTML = b.dataset.nome + (b.hasAttribute('data-std') ? '<i>standard</i>' : '');
    }
    const suf = { black: '_b', grey: '_g', white: '' };
    amostras.filter((x) => x.dataset.grupo === 'teca').forEach((x) => { const s = x.dataset.valor === 'grey' && escolha.calafeto === 'grey' ? '_b' : suf[escolha.calafeto]; $('span', x).style.backgroundImage = `url(${url(`img/models/a-${x.dataset.base}${s}.webp`)})`; });
    const base = amostras.find((x) => x.dataset.grupo === 'teca' && x.dataset.valor === escolha.teca).dataset.base;
    amostras.filter((x) => x.dataset.grupo === 'calafeto').forEach((x) => {
      // «Grey finish: black or white only» (ficha técnica)
      const proibido = escolha.teca === 'grey' && x.dataset.valor === 'grey';
      x.disabled = proibido; x.setAttribute('aria-disabled', proibido);
      $('span', x).style.backgroundImage = `url(${url(`img/models/a-${base}${proibido ? '_b' : x.dataset.suf}.webp`)})`;
    });
  }
  amostras.forEach((b) => b.addEventListener('click', () => {
    if (b.disabled) return;
    const g = b.dataset.grupo; escolha[g] = b.dataset.valor;
    if (g === 'teca' && escolha.teca === 'grey' && escolha.calafeto === 'grey') escolha.calafeto = 'black';
    pinta();
    if (visor) { visor.cor(g, escolha[g]); if (g === 'teca' || g === 'calafeto') visor.cor('calafeto', escolha.calafeto); }
  }));
  pinta();

  /* ---------- modo: visor próprio ou configurador oficial ---------- */
  const tituloV = $('[data-mp-c-nome]', sec), sub = $('[data-mp-c-sub]', sec), cta = $('[data-mp-c-cta]', sec), btCompleto = $('[data-mp-completo]', sec);
  const txtProprio = 'Choose the hull, the Flexiteek deck and the Morbern Sundance upholstery, and watch the yacht change.';
  const txtOficial = (n) => `The official De Antonio configurator for the ${n}, from the engines to the electronics.`;
  let forcaOficial = false, semGL = false; // sem WebGL o visor falha ao nascer e fica o configurador oficial

  function aplica() {
    const v = dados.versoes[versao]; if (!v) return;
    const proprio = !!v.v3d && !semGL && !forcaOficial;
    modo = proprio ? 'proprio' : 'oficial';
    sec.classList.toggle('modo-oficial', !proprio);
    tituloV.textContent = v.nome;
    sub.textContent = proprio ? txtProprio : txtOficial(v.nome);
    // o pedido de proposta leva a versão no endereço: a página inicial pré-escolhe-a no formulário
    cta.dataset.modelo = v.nome;
    cta.href = cta.getAttribute('href').split(/[?#]/)[0] + '?modelo=' + encodeURIComponent(v.nome) + '#proposta';
    btCompleto.hidden = !v.v3d || semGL;
    $('span', btCompleto).textContent = proprio ? 'All options in the official configurator' : 'Back to the colours';
    oficialEl.hidden = proprio;
    if (!proprio) prepPoster(v);
    acorda();
  }
  btCompleto.addEventListener('click', () => { forcaOficial = !forcaOficial; aplica(); requestAnimationFrame(() => $('.mp-palco', sec).scrollIntoView({ block: 'start', behavior: reduz ? 'instant' : 'smooth' })); });

  function prepPoster(v) {
    if (iframeId === versao) return;
    oficialEl.classList.remove('carregado');
    const im = $('[data-mp-poster-img]', oficialEl); im.src = url(v.poster);
    const svg = $('[data-mp-poster-wm]', oficialEl), sym = document.getElementById('wm-' + v.wm);
    $('use', svg).setAttribute('href', '#wm-' + v.wm);
    if (sym) { const vb = sym.getAttribute('viewBox'); svg.setAttribute('viewBox', vb); const p = vb.split(' ').map(Number); svg.style.setProperty('--ar', (p[2] / p[3]).toFixed(3)); }
    $('[data-mp-poster-msg]', oficialEl).textContent = 'Loading the official configurator';
    const velho = $('iframe', oficialEl); if (velho) velho.remove();
    iframeId = null;
  }
  function carregaOficial() {
    const v = dados.versoes[versao];
    if (iframeId === versao) return;
    iframeId = versao;
    const f = document.createElement('iframe');
    f.title = `Official De Antonio configurator, ${v.nome}`;
    f.allow = 'fullscreen';
    f.src = `https://dimtech.es/CustomDIM/CustomDimDeAntonioYachts/?idM=${v.idM}&l=en`;
    let feito = false;
    const pronto = () => { if (feito || iframeId !== versao) return; feito = true; setTimeout(() => oficialEl.classList.add('carregado'), 2200); };
    f.addEventListener('load', pronto);
    setTimeout(pronto, 20000);
    oficialEl.appendChild(f);
  }

  // só se carrega o que está perto do ecrã; o 3D e o iframe nunca entram no carregamento da página
  function acorda() {
    if (!perto || !versao) return;
    if (modo === 'oficial') carregaOficial();
    else montaVisor().then((vi) => vi && vi.modelo(dados.versoes[versao].v3d));
  }
  new IntersectionObserver(([e]) => { perto = e.isIntersecting; if (perto) acorda(); }, { rootMargin: '700px 0px 700px 0px', threshold: 0 }).observe(sec);
  new IntersectionObserver(([e]) => { visivel = e.isIntersecting; }, { threshold: 0 }).observe(visorEl);
  // com o painel à vista, a barra fixa de contacto sai: o painel já tem o seu pedido de proposta
  new IntersectionObserver(([e]) => document.body.classList.toggle('mp-sem-barra', e.isIntersecting), { threshold: 0 }).observe($('.mp-c-corpo', sec));

  DA.mp3d = { versao(id) { if (id === versao) return; versao = id; forcaOficial = false; aplica(); } };

  /* ---------- o visor ---------- */
  const carga = $('[data-mp-carga]', sec), cargaTxt = $('[data-mp-carga-txt]', sec), cargaPct = $('[data-mp-carga-pct]', sec), cargaBarra = $('[data-mp-carga-barra]', sec);
  const progresso = (k) => { cargaBarra.style.setProperty('--p', k.toFixed(3)); cargaPct.textContent = Math.round(k * 100) + '%'; };

  function montaVisor() {
    if (aCarregar) return aCarregar;
    // o three, o ambiente PMREM e o renderer nascem quando o scroll pára: o trabalho pesado nunca cai a meio de um gesto
    aCarregar = import(url('vendor/three-r160.js')).then((T) => DA.quieto(200).then(() => T)).then((T) => (visor = criaVisor(T))).catch((e) => {
      console.error(e); cargaTxt.textContent = 'The 3D view is not available on this device'; cargaPct.textContent = '';
      semGL = true; aplica(); return null;
    });
    return aCarregar;
  }

  function criaVisor(T) {
    const renderer = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.setClearColor(0x000000, 0);
    const tela = renderer.domElement;
    tela.setAttribute('aria-label', '3D view of the yacht. Drag to turn it.'); tela.setAttribute('role', 'img');
    visorEl.prepend(tela);

    const cena = new T.Scene();
    const pm = new T.PMREMGenerator(renderer);
    cena.environment = pm.fromScene(new T.RoomEnvironment(), 0.04).texture;
    // luz de fim de tarde: uma principal quente, alta e de lado, e o céu frio por cima do mar escuro
    const luz = new T.DirectionalLight(0xfff1e0, 1.6); luz.position.set(2, 3, 1.2); cena.add(luz);
    cena.add(new T.HemisphereLight(0xcfe0ee, 0x0b1a28, 0.55));
    const cam = new T.PerspectiveCamera(30, 1, 1, 100000);
    const ctl = new T.OrbitControls(cam, tela);
    tela.style.touchAction = 'pan-y'; // um dedo na vertical continua a descer a página
    Object.assign(ctl, { enableDamping: true, dampingFactor: 0.07, enablePan: false, autoRotate: !reduz, autoRotateSpeed: 0.5, rotateSpeed: 0.7, zoomSpeed: 0.6, minPolarAngle: 0.2 * Math.PI, maxPolarAngle: 0.47 * Math.PI });
    ctl.addEventListener('start', () => { ctl.autoRotate = false; visorEl.classList.add('tocado'); });
    // a roda do rato desce a página; só com Ctrl (ou o gesto de pinça do trackpad) aproxima
    visorEl.addEventListener('wheel', (e) => { if (!e.ctrlKey && !e.metaKey) e.stopPropagation(); }, { capture: true, passive: true });

    // sombra de contacto: um degradê radial por baixo do casco
    const cv = document.createElement('canvas'); cv.width = cv.height = 256;
    const cx = cv.getContext('2d'), gr = cx.createRadialGradient(128, 128, 0, 128, 128, 128);
    gr.addColorStop(0, 'rgba(0,0,0,.55)'); gr.addColorStop(0.45, 'rgba(0,0,0,.28)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    cx.fillStyle = gr; cx.fillRect(0, 0, 256, 256);
    const sombra = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: new T.CanvasTexture(cv), transparent: true, depthWrite: false }));
    sombra.rotation.x = -Math.PI / 2; sombra.visible = false; cena.add(sombra);

    const loader = new T.GLTFLoader().setMeshoptDecoder(T.MeshoptDecoder);
    const texL = new T.TextureLoader();
    let relevo = null;
    const relevoP = new Promise((ok) => texL.load(url('3d/estofo-relevo.webp'), (t) => { t.colorSpace = T.SRGBColorSpace; t.wrapS = t.wrapT = T.RepeatWrapping; relevo = t; ok(t); }, undefined, () => ok(null)));

    let raizM = null, actualM = null, pedidoM = null, sujo = true, base = 0, grupos = null, compilando = false;
    const cores = dados.cores;
    // o estofo leva o relevo neutro do tecido: a cor da amostra sobe para compensar o cinzento médio
    const GANHO = { estofo: 1.55, teca: 1.0, casco: 1, calafeto: 1 };
    const alvoCor = (g, v) => new T.Color(cores[g][v]).multiplyScalar(GANHO[g] || 1);
    const anim = [];
    function cor(g, v, ja) {
      if (!grupos || !grupos[g]) return;
      const alvo = alvoCor(g, v);
      for (const m of grupos[g]) {
        if (ja || reduz) { m.color.copy(alvo); continue; }
        const i = anim.findIndex((a) => a.m === m); if (i >= 0) anim.splice(i, 1);
        anim.push({ m, de: m.color.clone(), para: alvo, t0: performance.now() });
      }
      sujo = true;
    }
    const D = 700, ease = (k) => 1 - Math.pow(1 - k, 4);
    function anima(t) {
      if (!anim.length) return false;
      for (let i = anim.length - 1; i >= 0; i--) { const a = anim[i], k = Math.min(1, (t - a.t0) / D); a.m.color.copy(a.de).lerp(a.para, ease(k)); if (k >= 1) anim.splice(i, 1); }
      return true;
    }

    function enquadra() {
      if (!raizM) return;
      const w = visorEl.clientWidth, h = visorEl.clientHeight;
      cam.aspect = w / h; cam.updateProjectionMatrix();
      const caixa = new T.Box3().setFromObject(raizM), c = caixa.getCenter(new T.Vector3()), tam = caixa.getSize(new T.Vector3());
      const r = tam.length() / 2, vf = T.MathUtils.degToRad(cam.fov), hf = 2 * Math.atan(Math.tan(vf / 2) * cam.aspect);
      // enquadra pela caixa projectada, à volta toda: o iate enche o palco no ângulo mais largo e nunca sai dele a rodar
      const cantos = []; for (let k = 0; k < 8; k++) cantos.push(new T.Vector3(k & 1 ? caixa.max.x : caixa.min.x, k & 2 ? caixa.max.y : caixa.min.y, k & 4 ? caixa.max.z : caixa.min.z));
      const alvo = new T.Vector3(c.x, c.y + tam.y * 0.14, c.z), enche = w < 600 ? 1 : 0.84, hz = Math.hypot(1, 1.15), q = new T.Vector3();
      const dirDe = (a) => new T.Vector3(hz * Math.cos(a), 0.42, hz * Math.sin(a)).normalize();
      const guarda = cam.position.clone();
      base = 0;
      for (let i = 0; i < 12; i++) {
        const dir = dirDe(i * Math.PI / 6);
        let d = r / Math.sin(Math.min(vf, hf) / 2);
        for (let it = 0; it < 4; it++) {
          cam.position.copy(alvo).addScaledVector(dir, d); cam.lookAt(alvo); cam.updateMatrixWorld();
          let m = 0; for (const p of cantos) { q.copy(p).project(cam); m = Math.max(m, Math.abs(q.x), Math.abs(q.y)); }
          d *= m / enche;
        }
        base = Math.max(base, d);
      }
      ctl.minDistance = base * 0.5; ctl.maxDistance = base * 1.5;
      if (!visorEl.classList.contains('tocado')) {
        ctl.target.copy(alvo);
        cam.position.copy(alvo).addScaledVector(dirDe(Math.atan2(1.15, 1)), base);
      } else cam.position.copy(guarda).sub(ctl.target).setLength(T.MathUtils.clamp(cam.position.length(), ctl.minDistance, ctl.maxDistance)).add(ctl.target);
      cam.near = base / 50; cam.far = base * 10; cam.updateProjectionMatrix();
      ctl.update(); sujo = true;
    }

    function limpa(o) {
      o.traverse((x) => {
        if (!x.isMesh) return; x.geometry.dispose();
        (Array.isArray(x.material) ? x.material : [x.material]).forEach((m) => { for (const k of ['map', 'normalMap', 'aoMap', 'roughnessMap', 'metalnessMap', 'emissiveMap']) if (m[k] && m[k] !== relevo) m[k].dispose(); m.dispose(); });
      });
    }

    function prepara(raiz, cfg) {
      raiz.rotation.x = -Math.PI / 2; // 3ds Max: Z para cima
      const esconder = cfg.esconder ? new RegExp(cfg.esconder.join('|')) : null;
      const g = { casco: [], teca: [], calafeto: [], estofo: [] };
      const vistos = new Set();
      let calafetoM = null;
      const fora = []; // peças alternativas: saem da cena (e do enquadramento)
      raiz.traverse((o) => {
        if (!o.isMesh) return;
        if (esconder && esconder.test(o.name)) { fora.push(o); return; }
        const nome = o.name.toLowerCase();
        // o exportador da r124 escreveu cores sRGB como se fossem lineares: corrige-se uma vez por material
        if (!o.material.userData.lin) { o.material.color.convertSRGBToLinear(); if (o.material.emissive) o.material.emissive.convertSRGBToLinear(); o.material.userData.lin = 1; }
        let m = o.material;
        // a madeira do interior usa o material da teca no configurador; aqui fica com a sua cor
        if (/madera/.test(nome)) { m = o.material = m.clone(); m.userData.fixo = true; }
        if (/(^|[\s_])sica$/.test(nome)) {
          if (!calafetoM) { calafetoM = m.clone(); calafetoM.roughness = 0.85; calafetoM.metalness = 0; g.calafeto.push(calafetoM); }
          o.material = calafetoM; return;
        }
        if (vistos.has(m)) return; vistos.add(m);
        if (m.userData.fixo) return;
        const n = m.name;
        m.envMapIntensity = 0.75;
        if (/^(CASCO|ANTIFOULING) /.test(n)) { m.roughness = 0.32; m.metalness = 0; m.envMapIntensity = 0.62; g.casco.push(m); }
        else if (/^(E23 )?TECA /.test(n)) { m.roughness = 0.78; g.teca.push(m); }
        else if (/^TAPICERIA /.test(n)) {
          if (relevo && m.map) { const t = relevo.clone(); t.repeat.copy(m.map.repeat); t.offset.copy(m.map.offset); t.rotation = m.map.rotation; t.center.copy(m.map.center); t.channel = m.map.channel; t.needsUpdate = true; m.map = t; m.needsUpdate = true; }
          m.roughness = 0.92; m.metalness = 0; g.estofo.push(m);
        }
      });
      fora.forEach((o) => { o.parent.remove(o); o.geometry.dispose(); });
      grupos = g;
      for (const k of Object.keys(escolha)) cor(k, escolha[k], true);
      // a sombra assenta por baixo da quilha
      const caixa = new T.Box3().setFromObject(raiz), tam = caixa.getSize(new T.Vector3()), c = caixa.getCenter(new T.Vector3());
      sombra.scale.set(tam.x * 1.25, tam.z * 1.6, 1); sombra.position.set(c.x, caixa.min.y - tam.y * 0.02, c.z); sombra.visible = true;
    }

    function modelo(id) {
      if (!id || id === actualM || id === pedidoM) return;
      pedidoM = id;
      const cfg = dados.v3d[id];
      visorEl.classList.remove('pronto');
      cargaTxt.textContent = 'Preparing the 3D model'; progresso(0);
      // descarrega com progresso, espera que o scroll pare, e só então interpreta o GLB (a parte pesada, na thread principal)
      const baixa = (u, total) => fetch(u).then((r) => {
        if (!r.ok) throw new Error('GLB ' + r.status);
        if (!r.body || !r.body.getReader) return r.arrayBuffer();
        const tam = +r.headers.get('content-length') || total || 1, ler = r.body.getReader(), partes = []; let n = 0;
        const passo = () => ler.read().then(({ done, value }) => {
          if (done) { const b = new Uint8Array(n); let o = 0; for (const c of partes) { b.set(c, o); o += c.length; } return b.buffer; }
          partes.push(value); n += value.length; progresso(Math.min(0.99, n / tam)); return passo();
        });
        return passo();
      });
      const glb = url(cfg.glb);
      Promise.all([relevoP, baixa(glb, cfg.bytes)])
        .then(([, buf]) => DA.quieto(200).then(() => new Promise((ok) => DA.ocioso(() => ok(buf), 500))))
        .then((buf) => new Promise((ok, falha) => loader.parse(buf, glb.slice(0, glb.lastIndexOf('/') + 1), ok, falha)))
        .then((gltf) => {
        if (pedidoM !== id) { limpa(gltf.scene); return; }
        if (raizM) { cena.remove(raizM); limpa(raizM); }
        raizM = gltf.scene; prepara(raizM, cfg); cena.add(raizM);
        actualM = id; pedidoM = null;
        visorEl.classList.remove('tocado');
        ctl.autoRotate = !reduz;
        enquadra(); progresso(1);
        // os shaders compilam em paralelo (KHR_parallel_shader_compile) e o visor só desenha quando estão prontos
        const mostra = () => { compilando = false; sujo = true; requestAnimationFrame(() => visorEl.classList.add('pronto')); };
        compilando = true;
        if (renderer.compileAsync) renderer.compileAsync(cena, cam).then(mostra, mostra);
        else { renderer.compile(cena, cam); mostra(); }
      }).catch((e) => { console.error(e); pedidoM = null; cargaTxt.textContent = 'The 3D model could not load'; cargaPct.textContent = ''; });
    }

    new ResizeObserver(() => {
      const w = visorEl.clientWidth, h = visorEl.clientHeight; if (!w || !h) return;
      renderer.setSize(w, h, false); enquadra(); sujo = true;
    }).observe(visorEl);

    // o laço único do site: só desenha com o visor à vista, no modo próprio e com algo a mudar
    DA.aCada((t) => {
      if (!visivel || modo !== 'proprio' || !raizM || compilando || document.hidden) return;
      const mexeu = ctl.update();
      if (anima(t) || mexeu || sujo) { renderer.render(cena, cam); sujo = false; }
    });
    return { modelo, cor };
  }
})();
