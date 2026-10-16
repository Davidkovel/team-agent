(() => {
  const { $, $$, reduz, clamp } = SITE;
  /* ---------- EL RELOJ: las 24 horas de su empresa ----------
     En la portada la hora sale del scroll: cada sección lleva data-hora y data-momento, la línea de lectura
     (al 58% de la pantalla) se proyecta entre las marcas y las agujas persiguen esa hora con inercia.
     De día el acento es el oro (el marketing que atrae); de noche, la señal azul de la marca (la IA que atiende).
     El reloj nace grande en la hero y vuela a la muñeca de la página (el HUD) con el scroll: sólo transform.
     En las páginas interiores marca la hora real de Barcelona. */
  const voo = $('[data-reloj-voo]'), hud = $('[data-hud]'), dock = $('[data-hud-dock]');
  if (!voo || !hud || !dock) return;
  const heroR = $('[data-hero-reloj]');
  const agH = $('.ag-h', voo), agM = $('.ag-m', voo), disco = $('.ag-d', voo), agS = $('.ag-s', voo);
  const horaEl = $('[data-hud-hora]'), momEl = $('[data-hud-mom]'), anel = $('[data-hud-anillo] circle.v');
  const ceuD = $('.cielo-dia'), ceuN = $('.cielo-noche');
  const historia = !!heroR;

  // el segundero barre como un automático: una animación CSS, sin escrituras por fotograma
  const ahora = new Date();
  agS.style.animationDelay = -(ahora.getSeconds() + ahora.getMilliseconds() / 1000) + 's';
  if (!reduz) agS.classList.add('barre');

  const aMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + (m || 0); };
  const marcas = $$('[data-hora]').map((el) => ({ el, m: aMin(el.dataset.hora), txt: el.dataset.momento || '' }));
  // las horas nunca vuelven atrás: pasada la medianoche se suma un día
  for (let i = 1; i < marcas.length; i++) while (marcas[i].m < marcas[i - 1].m) marcas[i].m += 1440;
  const m0 = marcas.length ? marcas[0].m : 0, mFim = marcas.length ? marcas[marcas.length - 1].m : 1440;

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

  let cur = historia ? m0 : barcelona(), alvo = cur, ult = { h: '', m: '', d: '', hora: '', n: '', mom: -2, an: '', voo: '', on: null, noite: null };
  let dockR = null;
  const medeDock = () => { const r = dock.getBoundingClientRect(); dockR = { left: r.left, top: r.top, width: r.width }; };
  addEventListener('resize', () => { dockR = null; }, { passive: true });

  // a hora real avança sozinha nas páginas interiores
  if (!historia) setInterval(() => { alvo = barcelona(); }, 1000);

  const escreveMomento = (txt) => {
    // todos los que siguen visibles salen (un scroll rápido puede cruzar varias marcas en menos de una transición)
    $$('span:not(.sai)', momEl).forEach((v) => { v.classList.add('sai'); setTimeout(() => v.remove(), 700); });
    const novo = document.createElement('span');
    novo.textContent = txt; novo.className = 'entra';
    momEl.append(novo);
    requestAnimationFrame(() => requestAnimationFrame(() => novo.classList.remove('entra')));
  };

  let pronto = !document.body.classList.contains('a-abrir');
  SITE.abertura.then(() => { pronto = true; voo.classList.add('listo'); });

  SITE.aLer(() => { if (!dockR) medeDock(); });
  SITE.aCada((t, { y, h, dt }) => {
    // 1. a hora alvo
    let iMom = -1;
    if (historia && marcas.length) {
      const linha = y + h * 0.58;
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
    // 2. inercia: las agujas persiguen la hora
    const k = reduz ? 1 : 1 - Math.exp(-dt / 150);
    cur += (alvo - cur) * k;
    if (Math.abs(alvo - cur) < 0.02) cur = alvo;
    const vh = (cur * 0.5).toFixed(2), vm = (cur * 6).toFixed(1), vd = ((cur - 720) * 0.25).toFixed(2);
    if (vh !== ult.h) { ult.h = vh; agH.style.transform = `rotate(${vh}deg)`; }
    if (vm !== ult.m) { ult.m = vm; agM.style.transform = `rotate(${vm}deg)`; }
    if (vd !== ult.d) { ult.d = vd; disco.style.transform = `rotate(${vd}deg)`; }
    const mm = Math.floor(((cur % 1440) + 1440) % 1440);
    const hora = dois(Math.floor(mm / 60)) + ':' + dois(mm % 60);
    if (hora !== ult.hora) { ult.hora = hora; horaEl.firstChild.textContent = hora; }
    if (historia && iMom !== ult.mom && marcas[iMom]) { ult.mom = iMom; escreveMomento(marcas[iMom].txt); }
    if (!historia && ult.mom === -2) { ult.mom = -1; escreveMomento('Barcelona, ahora mismo'); }
    // 3. día y noche: sólo opacidad de dos capas fijas; el acento cambia una vez, por clase
    const n = noite(cur), ns = n.toFixed(3);
    if (ns !== ult.n) { ult.n = ns; ceuN.style.opacity = ns; ceuD.style.opacity = (1 - n).toFixed(3); }
    const esNoite = n > 0.5;
    if (esNoite !== ult.noite) { ult.noite = esNoite; document.body.classList.toggle('es-noche', esNoite); horaEl.lastChild.textContent = esNoite ? 'IA' : 'MKT'; }
    if (anel) {
      const pr = historia ? clamp((cur - m0) / Math.max(1, mFim - m0)) : (((cur % 1440) + 1440) % 1440) / 1440;
      const s = (1 - pr).toFixed(4);
      if (s !== ult.an) { ult.an = s; anel.style.strokeDashoffset = s; }
    }
    // 4. el vuelo: de la hero a la muñeca
    if (!dockR) return;
    let x, yy, esc, on;
    if (historia && pronto) {
      const c = SITE.caixa(heroR);
      const p = reduz ? (y > h * 0.5 ? 1 : 0) : clamp(y / (h * 0.78));
      const e = 1 - Math.pow(1 - p, 3);
      const w = c.width || 1;
      x = c.left + (dockR.left - c.left) * e;
      yy = (c.top - y) + (dockR.top - (c.top - y)) * e;
      esc = (w + (dockR.width - w) * e) / w;
      on = p >= 0.999;
      if (voo.style.width !== w + 'px') voo.style.width = w + 'px';
    } else {
      x = dockR.left; yy = dockR.top; esc = 1; on = pronto;
      if (voo.style.width !== dockR.width + 'px') voo.style.width = dockR.width + 'px';
    }
    const tv = `translate3d(${x.toFixed(1)}px,${yy.toFixed(1)}px,0) scale(${esc.toFixed(4)})`;
    if (tv !== ult.voo) { ult.voo = tv; voo.style.transform = tv; }
    if (on !== ult.on) { ult.on = on; hud.classList.toggle('on', on); }
  });
  if (!historia) { pronto = true; voo.classList.add('listo'); }
})();
