(() => {
  const { $, $$, reduz, clamp } = SITE;

  /* ---------- LAS DOS MITADES: raio X entre el día (marketing) y la noche (IA) ----------
     El scroll lleva la línea de 88 a 12; también se arrastra, se toca y se mueve con las flechas.
     Lo que la persona elige queda como desvío y se disuelve a medida que sigue bajando. */
  const rx = $('[data-rx]');
  if (rx) {
    let desvio = 0, yDesvio = 0, xAuto = 50, arrasta = false, ultX = '';
    const deX = (clientX) => { const r = rx.getBoundingClientRect(); return clamp((clientX - r.left) / r.width, 0.02, 0.98) * 100; };
    const fixa = (x) => { desvio = x - xAuto; yDesvio = scrollY; };
    rx.addEventListener('pointerdown', (e) => { arrasta = true; rx.setPointerCapture(e.pointerId); fixa(deX(e.clientX)); });
    rx.addEventListener('pointermove', (e) => { if (arrasta) fixa(deX(e.clientX)); });
    const larga = () => { arrasta = false; };
    rx.addEventListener('pointerup', larga); rx.addEventListener('pointercancel', larga);
    rx.addEventListener('keydown', (e) => {
      const passo = e.key === 'ArrowLeft' ? -5 : e.key === 'ArrowRight' ? 5 : 0;
      if (!passo) return; e.preventDefault(); fixa(clamp(xAuto + desvio + passo, 2, 98));
    });
    SITE.aCada((t, { y, h }) => {
      const c = SITE.caixa(rx), top = c.top - y;
      if (c.bottom - y < -h || top > h * 1.4) return;
      const p = clamp((h * 0.92 - top) / (h * 0.92 + c.height * 0.4));
      xAuto = reduz ? 50 : 88 - p * 76;
      const fade = arrasta ? 1 : clamp(1 - Math.abs(y - yDesvio) / (h * 0.55));
      if (!arrasta && fade === 0) desvio = 0;
      const x = clamp(xAuto + desvio * fade, 2, 98).toFixed(2);
      if (x !== ultX) { ultX = x; rx.style.setProperty('--x', x); rx.setAttribute('aria-valuenow', Math.round(x)); }
    });
  }

  /* ---------- PRODUCCIÓN: la pista horizontal fijada ----------
     La sección mide una pantalla más el recorrido de la pista; el scroll vertical la empuja de lado. */
  const prod = $('[data-prod]');
  if (prod) {
    const pista = $('[data-prod-pista]', prod), janela = $('[data-prod-janela]', prod), barra = $('[data-prod-barra]', prod);
    let rec = 0, ult = '';
    const mede = () => { rec = Math.max(0, pista.scrollWidth - janela.clientWidth); prod.style.setProperty('--recorrido', rec + 'px'); SITE.remede(); };
    SITE.quieto().then(mede);
    addEventListener('load', mede);
    let rt = 0; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(mede, 160); }, { passive: true });
    SITE.aCada((t, { y, h }) => {
      const c = SITE.caixa(prod);
      if (c.bottom - y < 0 || c.top - y > h) return;
      const p = SITE.fixado(prod), s = p.toFixed(4);
      if (s === ult) return; ult = s;
      pista.style.transform = `translate3d(${(-p * rec).toFixed(1)}px,0,0)`;
      barra.style.setProperty('--p', s);
    });
  }

  /* ---------- DEMOSTRACIÓN con botón (página de IA): el mismo guion, un mensaje cada 700 ms ---------- */
  $$('[data-demo]').forEach((d) => {
    const b = $('[data-demo-play]', d), msgs = $$('.msg', d), esc = $('[data-escribe]', d);
    let ts = [];
    b.addEventListener('click', () => {
      ts.forEach(clearTimeout); ts = [];
      msgs.forEach((m) => m.classList.remove('vis'));
      if (reduz) { msgs.forEach((m) => m.classList.add('vis')); return; }
      b.disabled = true; b.firstChild.textContent = 'Reproduciendo… ';
      msgs.forEach((m, i) => ts.push(setTimeout(() => {
        m.classList.add('vis');
        const prox = msgs[i + 1]; esc.hidden = !prox || !prox.classList.contains('agente');
        if (i === msgs.length - 1) { b.disabled = false; b.firstChild.textContent = 'Repetir la simulación '; }
      }, 700 * (i + 1))));
    });
  });

  /* ---------- 23:40: LA CONSULTA ----------
     Guion fijo de la web original (Simulación ilustrativa): cada tramo del scroll añade un mensaje.
     En «Fuera de alcance autorizado» el agente calla y pasa a recepción: ese es el momento que importa. */
  const cs = $('[data-consulta]');
  if (cs) {
    const msgs = $$('.msg', cs), trasp = $('[data-traspaso]', cs), escribe = $('[data-escribe]', cs);
    const iCorte = msgs.findIndex((m) => m.classList.contains('corte'));
    let ult = -1;
    const mostra = (n) => {
      msgs.forEach((m, i) => m.classList.toggle('vis', i < n));
      trasp.classList.toggle('on', iCorte >= 0 && n > iCorte);
      const prox = msgs[n];
      escribe.hidden = !prox || !prox.classList.contains('agente');
    };
    if (reduz) mostra(msgs.length);
    else SITE.aCada((t, { y, h }) => {
      const c = SITE.caixa(cs);
      if (c.bottom - y < 0 || c.top - y > h) return;
      const p = SITE.fixado(cs);
      const n = Math.min(msgs.length, Math.floor(clamp((p - 0.04) / 0.82) * (msgs.length + 0.999)));
      if (n !== ult) { ult = n; mostra(n); }
    });
  }
})();
