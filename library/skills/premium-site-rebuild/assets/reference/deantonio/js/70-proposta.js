(() => {
  const { $, $$, reduz, clamp } = DA;
  /* ---------- proposta: três boias, a placa do estaleiro e o email pronto ---------- */
  const sec = $('#proposta'); if (!sec) return;
  const form = $('[data-form]', sec), passos = $$('[data-passo]', form);
  const bVoltar = $('[data-voltar]', form), bSeguir = $('[data-seguir]', form);
  const obrigado = $('[data-obrigado]', sec), placa = $('[data-placa]', sec), bPlaca = $('[data-placa-abre]', placa);
  const caixaDealer = $('[data-dealer-p]', sec), selPais = $('[data-pais-p]', sec), ind = $('#pq-ind', sec);
  const DEALERS = window.DEALERS || [];
  const VENDAS = 'sales@deantonioyachts.com';
  const HQ = { nome: 'Barcelona HQ', local: "Av. d'Esplugues, 87, 08034 Barcelona", tel: '+34 93 467 60 36', email: VENDAS, hq: true };
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const ms = (v) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(v)) || 700;

  let passo = 1, max = 1, tentou = {}, dealer = null, doPais = [];

  /* ---------- mailto e tel não são saídas: o núcleo volta ao topo no beforeunload (corre antes deste), aqui repõe-se o lugar ---------- */
  let saida = -1e9, ySaida = 0;
  const marcaSaida = (y = scrollY) => { saida = performance.now(); ySaida = y; };
  const repoe = () => {
    const h = document.documentElement, antes = h.style.scrollBehavior;
    h.style.scrollBehavior = 'auto'; scrollTo(0, ySaida); h.style.scrollBehavior = antes;
  };
  document.addEventListener('click', (e) => { if (e.target.closest?.('a[href^="mailto:"],a[href^="tel:"]')) marcaSaida(); }, true);
  addEventListener('beforeunload', () => { if (performance.now() - saida < 1500) { repoe(); setTimeout(repoe, 60); } });

  // rolar até um elemento sem o deixar debaixo do cabeçalho fixo
  const hTopo = () => ($('.topo')?.getBoundingClientRect().bottom || 96);
  const rolaPara = (el, folga = 24, sempre = false) => {
    const r = el.getBoundingClientRect(), topo = hTopo();
    if (sempre || r.top < topo + 8 || r.top > innerHeight * 0.6) { const y = Math.max(0, scrollY + r.top - topo - folga); scrollTo({ top: y, behavior: reduz ? 'auto' : 'smooth' }); return y; }
    return scrollY;
  };

  const val = (n) => { const e = form.elements[n]; return e ? String(e.value || '').trim() : ''; };
  const marcados = (n) => $$(`[name="${n}"]:checked`, form).map((i) => i.value);

  /* ---------- a rota: o caminho desenha-se ao tamanho real, as boias pousam nele ---------- */
  const rota = $('[data-percurso]', sec), svg = $('.percurso-mar', rota), pFundo = $('.percurso-fundo', rota), pFeita = $('[data-percurso-feita]', rota);
  const barco = $('[data-percurso-barco]', rota), boias = $$('[data-boia]', rota);
  const MOLDE = pFundo.getAttribute('d');
  let L = 1, sB = [0, 0, 0, 0], sAgora = null, anim = null;
  // curva única do site, cubic-bezier(.16,1,.3,1), resolvida em JS para o barco
  const bez = (x1, y1, x2, y2) => {
    const c = (a, b) => [3 * a, 3 * (b - a) - 3 * a, 1 - 3 * a - 3 * (b - a) + 3 * a];
    const [cx, bx, ax] = c(x1, x2), [cy, by, ay] = c(y1, y2);
    const X = (t) => ((ax * t + bx) * t + cx) * t, Y = (t) => ((ay * t + by) * t + cy) * t;
    return (x) => { let lo = 0, hi = 1, t = x; for (let i = 0; i < 24; i++) { t = (lo + hi) / 2; if (X(t) < x) lo = t; else hi = t; } return Y(t); };
  };
  const curva = bez(.16, 1, .3, 1);
  const pousa = (s) => {
    sAgora = s;
    const a = pFundo.getPointAtLength(clamp(s, 0, L)), b = pFundo.getPointAtLength(clamp(s - 2, 0, L)), c = pFundo.getPointAtLength(clamp(s + 2, 0, L));
    const ang = Math.atan2(c.y - b.y, c.x - b.x) * 180 / Math.PI;
    barco.style.transform = `translate(${a.x}px,${a.y}px) translate(-50%,-50%) rotate(${ang.toFixed(2)}deg)`;
    pFeita.style.strokeDasharray = `${s.toFixed(1)} ${L + 10}`;
  };
  const desenha = () => {
    const W = rota.clientWidth, H = 64; // a altura do mar é fixa no CSS (.percurso-mar)
    if (!W) return;
    let k = 0;
    const d = MOLDE.replace(/-?\d+(\.\d+)?/g, (n) => (+n * (k++ % 2 ? H / 100 : W / 1000)).toFixed(1));
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    pFundo.setAttribute('d', d); pFeita.setAttribute('d', d);
    L = pFundo.getTotalLength();
    // no telemóvel as boias juntam-se à esquerda para o porto ter o seu lugar, longe da última boia
    const estreito = W < 520, XB = estreito ? [60, 430, 760, 975] : [60, 500, 880, 990];
    sB = XB.map((x, i) => {
      // as pontas afastam-se da margem para o barco caber inteiro
      const alvo = clamp(x * W / 1000, 34, W - (estreito ? 14 : 30)); let lo = 0, hi = L;
      for (let i = 0; i < 26; i++) { const m = (lo + hi) / 2; if (pFundo.getPointAtLength(m).x < alvo) lo = m; else hi = m; }
      return lo;
    });
    boias.forEach((b, i) => { const p = pFundo.getPointAtLength(sB[i]); b.style.setProperty('--bx', p.x + 'px'); b.style.setProperty('--by', p.y + 'px'); });
    if (anim) { cancelAnimationFrame(anim); anim = null; }
    pousa(sB[(form.hidden ? 4 : passo) - 1]);
  };
  const navega = (n) => {
    const alvo = sB[n - 1];
    if (sAgora === null || reduz) return pousa(alvo);
    if (anim) cancelAnimationFrame(anim);
    const de = sAgora, t0 = performance.now(), dur = ms('--duration-cena');
    const passoA = (t) => { const k = clamp((t - t0) / dur); pousa(de + (alvo - de) * curva(k)); anim = k < 1 ? requestAnimationFrame(passoA) : null; };
    anim = requestAnimationFrame(passoA);
  };
  if ('ResizeObserver' in window) new ResizeObserver(desenha).observe(rota); else addEventListener('resize', desenha);
  desenha(); addEventListener("load", desenha);

  /* ---------- a placa do estaleiro ---------- */
  // local: a segunda parte do texto, que a placa compacta do telemóvel esconde (o nome do dealer chega)
  const grava = (k, texto, vazio, local = '') => {
    const dd = $(`[data-p="${k}"]`, placa); if (!dd) return;
    const novo = texto || vazio || 'Choose';
    if (dd.textContent === novo + local) return;
    dd.innerHTML = esc(novo) + (local ? `<span class="placa-local">${esc(local)}</span>` : ''); dd.classList.toggle('vazio', !texto);
    dd.classList.remove('muda'); void dd.offsetWidth; dd.classList.add('muda');
  };
  const nomeDealer = () => (val('pais') && dealer ? (dealer.hq ? 'Barcelona HQ' : dealer.nome) : '');
  const localDealer = () => (val('pais') && dealer && !dealer.hq ? `, ${dealer.local}` : '');
  const actualizaPlaca = () => {
    grava('modelo', marcados('modelo').join(', '));
    grava('uso', marcados('uso').join(', '));
    grava('quando', val('quando'));
    grava('pais', val('pais'));
    grava('dealer', nomeDealer(), doPais.length > 1 && !dealer ? `One of ${doPais.length} in ${val('pais')}` : '', localDealer());
  };

  /* ---------- passo 1: o cais ---------- */
  const bercos = $$('.berco', form), indeciso = $('[data-indeciso]', form);
  const marcaBercos = () => bercos.forEach((b) => b.classList.toggle('on', $('input', b).checked));
  form.addEventListener('change', (e) => {
    const t = e.target;
    if (t.name === 'modelo') {
      if (t === indeciso && t.checked) $$('[name=modelo]', form).forEach((i) => { if (i !== indeciso) i.checked = false; });
      else if (t.checked) indeciso.checked = false;
      marcaBercos();
    }
    if (t === selPais) { pintaDealer(true); if (ind && !ind.dataset.tocado) ind.value = selPais.selectedOptions[0]?.dataset.ind || ''; }
    if (t.name === 'dealer') { dealer = doPais[+t.value] || null; pintaDealer(false); }
    if (t.name === 'via' && tentou[3]) valida(3, false);
    actualizaPlaca();
    if (tentou[passo]) valida(passo, false);
  });
  form.addEventListener('input', (e) => {
    if (e.target === ind) ind.dataset.tocado = '1';
    if (tentou[passo]) valida(passo, false);
  });

  /* ---------- passo 2: o país mostra o dealer ---------- */
  const contactos = (d, tag = 'p') => `<${tag} class="dealer-c">${d.tel ? `<a href="tel:${esc(d.tel.replace(/[^+\d]/g, ''))}">${esc(d.tel)}</a>` : ''}${d.email ? `<a href="mailto:${esc(d.email)}">${esc(d.email)}</a>` : ''}</${tag}>`;
  const cartao = (d, rotulo) => `<div class="dealer-escolhido"><p class="dealer-r">${rotulo}</p><p class="dealer-n">${esc(d.hq ? 'De Antonio Yachts, Barcelona HQ' : d.nome)}</p><p class="dealer-l">${esc(d.local)}</p>${contactos(d)}${!d.email && !d.hq ? `<p class="dealer-x">Your request reaches them through ${VENDAS}.</p>` : ''}</div>`;
  function pintaDealer(novoPais) {
    const p = val('pais');
    if (!p) { caixaDealer.hidden = true; caixaDealer.innerHTML = ''; dealer = null; doPais = []; return; }
    if (novoPais) { doPais = DEALERS.filter((d) => d.pais === p); dealer = doPais.length === 1 ? doPais[0] : doPais.length ? null : HQ; }
    let h = '';
    if (!doPais.length) h = cartao(HQ, p === 'Another country' ? 'Your contact' : 'Your contact in Barcelona');
    else if (doPais.length === 1) h = cartao(doPais[0], 'Your dealer');
    else {
      const sel = dealer ? doPais.indexOf(dealer) : -1;
      // os contactos do dealer escolhido aparecem dentro da própria opção, onde o dedo acabou de tocar
      h = `<fieldset class="grupo"><legend>Your dealers in ${esc(p)}</legend><div class="dealer-lista">${doPais.map((d, i) => `<label class="dealer-op${i === sel ? ' on' : ''}"><input type="radio" name="dealer" value="${i}"${i === sel ? ' checked' : ''}><i aria-hidden="true"></i><span><b>${esc(d.nome)}</b><small>${esc(d.local)}</small>${i === sel ? `${contactos(d, 'span')}${!d.email ? `<small class="dealer-x">Your request reaches them through ${VENDAS}.</small>` : ''}` : ''}</span></label>`).join('')}</div></fieldset>`;
    }
    const foco = document.activeElement && caixaDealer.contains(document.activeElement) ? document.activeElement.value : null;
    caixaDealer.innerHTML = h;
    if (foco !== null) $(`input[value="${foco}"]`, caixaDealer)?.focus();
    if (caixaDealer.hidden || novoPais) { caixaDealer.hidden = false; caixaDealer.classList.remove('entra'); void caixaDealer.offsetWidth; caixaDealer.classList.add('entra'); }
  }

  /* ---------- validação, com mensagens junto do campo ---------- */
  const aviso = (k, msg, el) => {
    const a = $(`[data-aviso="${k}"]`, form); if (a) a.textContent = msg || '';
    if (el) el.setAttribute('aria-invalid', msg ? 'true' : 'false');
    return msg ? (el || a) : null;
  };
  function valida(n, focar = true) {
    const erros = [];
    if (n === 1) erros.push(aviso('modelo', marcados('modelo').length ? '' : 'Choose a yacht, or Help me choose if you are still deciding.', null) && $('[name=modelo]', form));
    if (n === 1 && focar && !marcados('modelo').length) { $('[name=modelo]', form).focus({ preventScroll: true }); tituloVisivel(); return false; }
    if (n === 2) erros.push(aviso('pais', val('pais') ? '' : 'Choose your country so we can find your dealer.', selPais));
    if (n === 3) {
      const nome = val('nome'), email = val('email'), tel = val('tel').replace(/\D/g, ''), via = val('via');
      erros.push(aviso('nome', nome ? '' : 'Please tell us your name.', form.elements.nome));
      erros.push(aviso('email', !email ? 'We need an email to send your quote.' : /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? '' : 'That email looks incomplete.', form.elements.email));
      const precisa = via === 'Phone' || via === 'WhatsApp';
      erros.push(aviso('tel', precisa && tel.length < 6 ? (via === 'WhatsApp' ? 'Add your number so we can reach you on WhatsApp.' : 'Add your number so we can call you.') : (tel && tel.length < 6 ? 'That number looks short.' : ''), form.elements.tel));
      erros.push(aviso('ok', form.elements.ok.checked ? '' : 'Please tick this so we may reply.', form.elements.ok));
    }
    const primeiro = erros.find(Boolean);
    // o campo inteiro, com a mensagem por baixo, fica acima das acções presas ao fundo
    if (primeiro && focar) { primeiro.focus(); (primeiro.closest('.campo, .consentir') || primeiro).scrollIntoView({ block: 'nearest' }); }
    return !primeiro;
  }

  /* ---------- entre passos ---------- */
  // no computador o título da secção fica logo abaixo do cabeçalho; no telemóvel não se volta ao título:
  // a rota encosta ao cabeçalho, a placa compacta logo abaixo, e o passo com o seu primeiro campo antes das acções
  const tituloSec = $('#proposta-t', sec);
  const estreito = matchMedia('(max-width: 900px)');
  const slot = $('[data-placa-slot]', sec);
  const tituloVisivel = () => (estreito.matches ? rolaPara(rota, 8, true) : rolaPara(tituloSec, 16));
  const fechaPlaca = () => { placa.classList.remove('aberta'); bPlaca?.setAttribute('aria-expanded', 'false'); const t = bPlaca?.querySelector('span'); if (t) t.textContent = 'All details'; };
  function irPara(n, rolar = true) {
    const dir = n >= passo ? 'entra-d' : 'entra-e';
    passo = n; max = Math.max(max, n); sec.dataset.agora = n;
    passos.forEach((p) => {
      const este = +p.dataset.passo === n;
      p.hidden = !este; p.classList.remove('entra-d', 'entra-e');
      if (este && !reduz) { void p.offsetWidth; p.classList.add(dir); }
    });
    bVoltar.hidden = n === 1;
    bSeguir.textContent = n === 3 ? 'Send request' : 'Continue';
    $$('[data-ir]', rota).forEach((b) => {
      const k = +b.dataset.ir;
      b.disabled = k > max; b.closest('li').classList.toggle('feito', k < n || (k < max && k !== n));
      if (k === n) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
    });
    navega(n);
    fechaPlaca();
    if (rolar) { tituloVisivel(); $(`[data-passo="${n}"] h3`, form).focus({ preventScroll: true }); }
  }
  bVoltar.addEventListener('click', () => irPara(Math.max(1, passo - 1)));
  rota.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ir]'); if (!b || b.disabled || form.hidden) return;
    const n = +b.dataset.ir; if (n === passo) return;
    if (n > passo) { tentou[passo] = true; if (!valida(passo)) return; }
    irPara(n);
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    tentou[passo] = true;
    if (!valida(passo)) return;
    if (passo < 3) irPara(passo + 1); else envia();
  });

  /* ---------- o envio: email para vendas, com cópia para o dealer ---------- */
  let textoPedido = '';
  // telemóvel: a placa selada e o obrigado juntos quando cabem; senão a placa sai por cima e o obrigado abre o ecrã, com as três acções à vista
  const rolaFim = () => {
    const topo = hTopo(), sl = slot.getBoundingClientRect(), fim = $('.obrigado-acoes', obrigado).getBoundingClientRect();
    const y = fim.bottom - sl.top + topo + 8 <= innerHeight - 16 ? scrollY + sl.top - topo - 8 : scrollY + sl.bottom;
    scrollTo({ top: Math.max(0, y), behavior: reduz ? 'auto' : 'smooth' }); return y;
  };
  function envia() {
    const yacht = marcados('modelo').join(', '), pais = val('pais'), nome = val('nome');
    const tel = val('tel') ? `${val('ind')} ${val('tel')}`.trim() : '';
    const cc = dealer && dealer.email && dealer.email !== VENDAS ? dealer.email : '';
    const linhas = [
      `Yacht: ${yacht}`,
      `Use: ${marcados('uso').join(', ') || 'Not said'}`,
      `Timing: ${val('quando') || 'Not said'}`,
      `Country: ${pais}`,
      `Dealer: ${dealer ? (dealer.hq ? 'Barcelona HQ' : `${dealer.nome}, ${dealer.local}`) : `To be suggested (${doPais.length} in ${pais})`}`,
      '',
      `Name: ${nome}`,
      `Email: ${val('email')}`,
      `Phone: ${tel || 'Not given'}`,
      `Reply by: ${val('via')}`,
    ];
    if (val('msg')) linhas.push('', val('msg'));
    textoPedido = linhas.join('\n');
    const assunto = `Quote request · ${yacht} · ${pais}`;
    const href = `mailto:${VENDAS}?${cc ? `cc=${encodeURIComponent(cc)}&` : ''}subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(textoPedido)}`;
    $('[data-reabrir]', obrigado).href = href;
    $('[data-obrigado-t]', obrigado).textContent = `Thank you, ${nome.split(/\s+/)[0]}.`;
    $('[data-obrigado-p]', obrigado).textContent = `Your email app has opened with the request ready to send to ${VENDAS}${cc ? `, with a copy to ${dealer.nome}` : ''}. Press send and it is on its way.`;
    $('[data-copiado]', obrigado).textContent = '';
    grava('data', `Requested ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`);
    placa.classList.add('selada');
    form.hidden = true; obrigado.hidden = false; sec.dataset.agora = 'fim';
    $$('[data-ir]', rota).forEach((b) => { b.disabled = true; b.removeAttribute('aria-current'); b.closest('li').classList.add('feito'); });
    navega(4);
    fechaPlaca();
    const yFim = estreito.matches ? rolaFim() : tituloVisivel(); $('[data-obrigado-t]', obrigado).focus({ preventScroll: true });
    marcaSaida(yFim); location.href = href;
  }
  $('[data-copiar]', obrigado).addEventListener('click', () => {
    const ok = () => { $('[data-copiado]', obrigado).textContent = `Copied. Paste it into an email to ${VENDAS}.`; };
    const plano = () => { const t = document.createElement('textarea'); t.value = textoPedido; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0'; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); ok(); } catch (e) {} t.remove(); };
    if (navigator.clipboard) navigator.clipboard.writeText(textoPedido).then(ok, plano); else plano();
  });
  function recomeca() {
    form.reset(); delete ind.dataset.tocado; tentou = {}; dealer = null; doPais = []; max = 1;
    $$('[aria-invalid]', form).forEach((e) => e.removeAttribute('aria-invalid')); $$('[data-aviso]', form).forEach((a) => { a.textContent = ''; });
    pintaDealer(true); marcaBercos();
    $('[data-p="data"]', placa).textContent = ''; placa.classList.remove('selada');
    obrigado.hidden = true; form.hidden = false;
    actualizaPlaca(); irPara(1);
  }
  $('[data-novo]', obrigado).addEventListener('click', recomeca);

  /* ---------- pré-escolha: qualquer ligação com data-modelo no site ---------- */
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-modelo]'); if (!a || sec.contains(a)) return;
    if (form.hidden) recomeca();
    const m = a.dataset.modelo;
    let algum = false;
    const alvos = $$('[name=modelo]', form).filter((c) => c.value === m || c.value.startsWith(m + ' '));
    if (alvos.length) { $$('[name=modelo]', form).forEach((c) => { c.checked = alvos.includes(c); }); algum = true; }
    marcaBercos(); actualizaPlaca();
    if (tentou[1]) valida(1, false);
    if (passo !== 1) irPara(1, false);
  });

  /* ---------- no telemóvel a placa sobe para junto da rota, compacta, e abre ao toque ---------- */
  const ancora = $('.ancora', sec);
  const arruma = () => { if (estreito.matches) { if (placa.parentNode !== slot) slot.append(placa); } else if (placa.parentNode !== ancora) ancora.append(placa); };
  estreito.addEventListener ? estreito.addEventListener('change', arruma) : estreito.addListener(arruma);
  arruma();
  bPlaca.addEventListener('click', () => {
    const abre = bPlaca.getAttribute('aria-expanded') !== 'true';
    bPlaca.setAttribute('aria-expanded', String(abre)); placa.classList.toggle('aberta', abre);
    bPlaca.querySelector('span').textContent = abre ? 'Less' : 'All details';
  });

  /* ---------- a barra de contacto recolhe-se enquanto o pedido está à vista: nunca tapa um campo nem um botão ---------- */
  // a secção inteira (formulário e a Casa Barcelona) e, no telemóvel, também o rodapé, que já tem telefone, email e voltar ao topo
  const barra = $('[data-barra]'), rodape = $('[data-rodape]');
  if (barra) {
    const vis = new Map();
    const aplica = () => {
      const esconde = vis.get(sec) || (estreito.matches && vis.get(rodape));
      barra.classList.toggle('recolhe', !!esconde); barra.inert = !!esconde;
    };
    const io = new IntersectionObserver((es) => { es.forEach((e) => vis.set(e.target, e.isIntersecting)); aplica(); }, { threshold: 0 });
    io.observe(sec); if (rodape) io.observe(rodape);
    estreito.addEventListener ? estreito.addEventListener('change', aplica) : estreito.addListener(aplica);
  }

  sec.dataset.agora = 1;
  actualizaPlaca();
})();
