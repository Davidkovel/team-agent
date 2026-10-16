(() => {
  const { $, $$, reduz, clamp } = SITE;
  /* ---------- EL RELOJ: las 24 horas de su empresa ----------
     Vive en la cabecera. En la portada la hora sale del scroll: cada sección lleva data-hora y data-momento, la línea
     de lectura (al 58% de la pantalla) se proyecta entre las marcas y las agujas persiguen esa hora con inercia.
     De día el acento es el oro (el marketing que atrae); de noche, la señal azul (la IA que atiende).
     El cielo del coração aberto gira con el día: sol arriba a mediodía, luna a medianoche.
     Todas las esferas de la página (la de la cabecera y la grande de la marca) marcan la misma hora.
     En las páginas interiores, la hora real de Barcelona. */
  const voo = $('[data-reloj-voo]'), hud = $('[data-hud]'), dock = $('[data-hud-dock]');
  if (!voo || !hud || !dock) return;
  const relojes = $$('.reloj').map((r) => ({ h: $('.ag-h', r), m: $('.ag-m', r), d: $('.ag-d', r), s: $('.ag-s', r) }));
  const horaEl = $('[data-hud-hora]'), momEl = $('[data-hud-mom]'), anel = $('[data-hud-anillo] circle.v');
  const ceuD = $('.cielo-dia'), ceuN = $('.cielo-noche');

  const aMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + (m || 0); };
  const marcas = $$('[data-hora]').map((el) => ({ el, m: aMin(el.dataset.hora), txt: el.dataset.momento || '' }));
  for (let i = 1; i < marcas.length; i++) while (marcas[i].m < marcas[i - 1].m) marcas[i].m += 1440;   // nunca vuelve atrás
  const historia = marcas.length > 1;
  const m0 = historia ? marcas[0].m : 0, mFim = historia ? marcas[marcas.length - 1].m : 1440;

  // el segundero barre como un automático: una animación CSS, sin escrituras por fotograma
  const ahora = new Date();
  relojes.forEach((r) => { r.s.style.animationDelay = -(ahora.getSeconds() + ahora.getMilliseconds() / 1000) + 's'; if (!reduz) r.s.classList.add('barre'); });

  const barcelona = () => {
    try {
      const p = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
      const g = (t) => +p.find((x) => x.type === t).value;
      return g('hour') * 60 + g('minute') + g('second') / 60;
    } catch (e) { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
  };
  // noche: 1 de 22:00 a 05:00, rampas al anochecer (19–22) y al amanecer (05–07:30)
  const noite = (m) => {
    m = ((m % 1440) + 1440) % 1440;
    if (m < 300) return 1;
    if (m < 450) return 1 - (m - 300) / 150;
    if (m < 1140) return 0;
    if (m < 1320) return (m - 1140) / 180;
    return 1;
  };
  const dois = (n) => String(n).padStart(2, '0');

  // en la portada las agujas dan una vuelta rápida al abrir: el reloj se pone en hora
  let alvo = historia ? m0 : barcelona();
  let cur = historia && !reduz ? m0 - 170 : alvo;
  const ult = { h: '', m: '', d: '', hora: '', n: '', mom: -2, an: '', noite: null, w: '', pos: '' };
  if (!historia) setInterval(() => { alvo = barcelona(); }, 1000);

  const escreveMomento = (txt) => {
    // todos los que siguen visibles salen (un scroll rápido puede cruzar varias marcas en menos de una transición)
    $$('span:not(.sai)', momEl).forEach((v) => { v.classList.add('sai'); setTimeout(() => v.remove(), 700); });
    const novo = document.createElement('span');
    novo.textContent = txt; novo.className = 'entra';
    momEl.append(novo);
    requestAnimationFrame(() => requestAnimationFrame(() => novo.classList.remove('entra')));
  };

  // la esfera de la cabecera se coloca sobre su sitio (sólo cuando el diseño cambia)
  let dockR = null;
  addEventListener('resize', () => { dockR = null; }, { passive: true });
  SITE.aLer(() => { if (!dockR) { const r = dock.getBoundingClientRect(); dockR = { left: r.left, top: r.top, width: r.width }; } });

  let pronto = !document.body.classList.contains('a-abrir');
  SITE.abertura.then(() => { pronto = true; voo.classList.add('listo'); });
  if (pronto) voo.classList.add('listo');

  SITE.aCada((t, { y, h, dt }) => {
    let iMom = -1;
    if (historia) {
      const linha = y + h * 0.58 * clamp(y / (h * 0.6));   // no topo marca a hora da primeira secção
      let i = 0;
      while (i < marcas.length - 1 && SITE.caixa(marcas[i + 1].el).top <= linha) i++;
      const a = SITE.caixa(marcas[i].el).top;
      if (linha < a) { alvo = marcas[0].m; iMom = 0; }
      else if (i === marcas.length - 1) { alvo = marcas[i].m; iMom = i; }
      else {
        const b = SITE.caixa(marcas[i + 1].el).top;
        alvo = marcas[i].m + clamp((linha - a) / Math.max(1, b - a)) * (marcas[i + 1].m - marcas[i].m);
        iMom = i;
      }
    }
    // inercia: las agujas persiguen la hora (más despacio mientras se abre la página)
    if (pronto) {
      const k = reduz ? 1 : 1 - Math.exp(-dt / 160);
      cur += (alvo - cur) * k;
      if (Math.abs(alvo - cur) < 0.02) cur = alvo;
    }
    const vh = (cur * 0.5).toFixed(2), vm = (cur * 6).toFixed(1), vd = ((cur - 720) * 0.25).toFixed(2);
    if (vh !== ult.h) { ult.h = vh; relojes.forEach((r) => (r.h.style.transform = `rotate(${vh}deg)`)); }
    if (vm !== ult.m) { ult.m = vm; relojes.forEach((r) => (r.m.style.transform = `rotate(${vm}deg)`)); }
    if (vd !== ult.d) { ult.d = vd; relojes.forEach((r) => (r.d.style.transform = `rotate(${vd}deg)`)); }
    const mm = Math.floor(((alvo % 1440) + 1440) % 1440);
    const hora = dois(Math.floor(mm / 60)) + ':' + dois(mm % 60);
    if (hora !== ult.hora) { ult.hora = hora; horaEl.firstChild.textContent = hora; }
    if (historia && iMom !== ult.mom && marcas[iMom]) { ult.mom = iMom; escreveMomento(marcas[iMom].txt); }
    if (!historia && ult.mom === -2) { ult.mom = -1; escreveMomento('Barcelona, ahora mismo'); }
    // día y noche: sólo la opacidad de dos capas fijas; el acento cambia una vez, por clase
    const n = noite(alvo), ns = n.toFixed(3);   // a cor do dia segue a hora da história, não a volta dos ponteiros
    if (ns !== ult.n) { ult.n = ns; ceuN.style.opacity = ns; ceuD.style.opacity = (1 - n).toFixed(3); }
    const esNoite = n > 0.5;
    if (esNoite !== ult.noite) { ult.noite = esNoite; document.body.classList.toggle('es-noche', esNoite); horaEl.lastChild.textContent = esNoite ? 'IA' : 'MKT'; }
    if (anel) {
      const pr = historia ? clamp((cur - m0) / Math.max(1, mFim - m0)) : (((cur % 1440) + 1440) % 1440) / 1440;
      const s = (1 - pr).toFixed(4);
      if (s !== ult.an) { ult.an = s; anel.style.strokeDashoffset = s; }
    }
    // la esfera de la cabecera: siempre a su tamaño real (nítida), sobre el hueco que le guarda el HUD
    if (dockR) {
      const w = dockR.width + 'px', pos = `translate3d(${dockR.left.toFixed(1)}px,${dockR.top.toFixed(1)}px,0)`;
      if (w !== ult.w) { ult.w = w; voo.style.width = w; }
      if (pos !== ult.pos) { ult.pos = pos; voo.style.transform = pos; }
    }
  });
})();
