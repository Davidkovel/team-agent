(() => {
  const { $, $$, reduz } = DA;
  /* ---------- o mapa e os dealers ---------- */
  const sel = $('[data-dealer-pais]'), lista = $('[data-dealer-lista]'), mapa = $('[data-mapa]');
  if (!sel || !lista || !mapa) return;
  // as rotas desenham-se de Barcelona para fora: cada arco mede 1, e o traço corre de 1 a 0 quando o barco atraca
  const rotas = $$('.mapa-rotas path', mapa);
  rotas.forEach((p) => p.setAttribute('pathLength', '1'));
  // as rotas saem pela ordem alfabética dos países, sem Espanha (é a casa): a mesma ordem das opções
  const paisesRota = [...sel.options].map((o) => o.value).filter((v) => v && v !== 'Spain');
  const pontos = $$('.mapa-dealers circle', mapa);
  const sede = lista.innerHTML;
  const limpo = (s) => s.replace(/[^+\d]/g, '');
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const icTel = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 10.8a15.5 15.5 0 0 0 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 0 1 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1z"/></svg>';
  const icMail = '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="tr" d="M3.5 5.5h17v13h-17z"/><path class="tr" d="m3.5 6.5 8.5 6.5 8.5-6.5"/></svg>';
  // códigos postais e domínios com hífen não se partem a meio; o email só quebra depois da arroba
  const inteiro = (s) => esc(s).replace(/(\S*\d-\d\S*)/g, '<span class="nw">$1</span>');
  const mostraMail = (m) => { const [u, d] = m.split('@'); return `${esc(u)}@<wbr><span class="nw">${esc(d)}</span>`; };
  const acao = (href, ic, html, longo) => `<a class="dealer-acao${longo ? ' longo' : ''}" href="${href}">${ic}<span>${html}</span></a>`;
  const cartao = (d, i) => {
    const a = [];
    if (d.tel) a.push(acao(`tel:${limpo(d.tel)}`, icTel, `<span class="nw">${esc(d.tel)}</span>`));
    if (d.email) a.push(acao(`mailto:${d.email}`, icMail, mostraMail(d.email), d.email.length > 28));
    return `<article class="dealer" style="--i:${i}"><h4>${esc(d.nome)}</h4><p>${inteiro(d.local)}</p><div class="dealer-acoes">${a.join('')}</div></article>`;
  };
  // os dealers sem contacto publicado juntam-se num só cartão, com um único pedido de apresentação a Barcelona
  const semContacto = (ds, i, p) => `<article class="dealer dealer-rede" style="--i:${i}"><ul>${ds.map((d) => `<li><h4>${esc(d.nome)}</h4><p>${inteiro(d.local)}</p></li>`).join('')}</ul><div class="dealer-acoes">${acao(`mailto:sales@deantonioyachts.com?subject=${encodeURIComponent('Dealer in ' + p)}`, icMail, 'Contact through Barcelona')}</div></article>`;
  // no telemóvel o mapa fica longe da lista: uma linha leva o olhar até ele
  const verMapa = '<button type="button" class="dealers-ver" data-ver-mapa><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.6 2.4 3.8 5.2 3.8 8.5s-1.2 6.1-3.8 8.5c-2.6-2.4-3.8-5.2-3.8-8.5S9.4 5.9 12 3.5z"/></svg><span>See it on the map</span></button>';

  // o país passa para o pedido de proposta; só se respeita um país que a pessoa escolheu dentro do formulário
  const fPais = $('[data-pais-p]');
  fPais?.addEventListener('change', (e) => { if (e.isTrusted) delete fPais.dataset.doMapa; });
  const levaPais = (p, forca) => {
    const f = fPais;
    if (!p || !f || ![...f.options].some((o) => o.value === p)) return;
    if (!forca && f.value && !f.dataset.doMapa) return;
    if (f.value === p) return;
    f.value = p; f.dataset.doMapa = '1';
    f.dispatchEvent(new Event('change', { bubbles: true }));
  };

  sel.addEventListener('change', () => {
    const p = sel.value, casa = p === 'Spain';
    if (!p) {
      lista.innerHTML = sede;
    } else {
      const ds = window.DEALERS.filter((d) => d.pais === p);
      const com = ds.filter((d) => d.tel || d.email), sem = ds.filter((d) => !d.tel && !d.email);
      // Espanha é a casa: o estaleiro de Barcelona continua à frente
      let h = verMapa + (casa ? sede.replace('<article class="dealer dealer-sede"', '<article class="dealer dealer-sede" style="--i:0"') : ''), n = casa ? 1 : 0;
      h += com.map((d) => cartao(d, n++)).join('');
      if (sem.length) h += semContacto(sem, n++, p);
      lista.innerHTML = h + `<a class="botao botao-claro dealers-cta" href="#proposta" data-pais-cta="${esc(p)}" style="--i:${n}">Request a quote in ${esc(p)}</a>`;
    }
    // no mapa: o ponto do país ganha um anel e a rota de Barcelona até lá acende, as outras recuam; Espanha acende o porto
    pontos.forEach((c) => c.classList.toggle('escolhido', !!p && !casa && c.dataset.pais === p));
    const ir = paisesRota.indexOf(p);
    rotas.forEach((r, i) => r.classList.toggle('escolhida', i === ir));
    mapa.classList.toggle('tem-escolha', !!p && !casa);
    mapa.classList.toggle('em-casa', casa);
    levaPais(p, false);
  });
  lista.addEventListener('click', (e) => {
    const cta = e.target.closest('[data-pais-cta]');
    if (cta) { levaPais(cta.dataset.paisCta, true); return; }
    if (e.target.closest('[data-ver-mapa]')) {
      const r = mapa.getBoundingClientRect();
      scrollTo({ top: Math.max(0, scrollY + r.top + r.height / 2 - innerHeight / 2), behavior: reduz ? 'auto' : 'smooth' });
    }
  });

  /* ---------- o HUD fixo não passa por cima do seletor ---------- */
  const hud = $('[data-hud]'), dealers = $('.dealers');
  if (hud && dealers) new IntersectionObserver(([e]) => hud.classList.toggle('tapado', e.isIntersecting), { threshold: 0 }).observe(dealers);
})();
