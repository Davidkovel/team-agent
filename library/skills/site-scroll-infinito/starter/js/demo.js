/* demo.js — só para a demonstração NORTE: desenha as montanhas e o portal em SVG, para o starter abrir sem imagens.
   Num site a sério as camadas são fotografias/ilustrações do cliente (PNG/WebP recortadas) ou o filme é de fotogramas.
   Tem de correr antes do scroll.js (a cópia da volta leva o que já está desenhado). */
(() => {
  'use strict';
  const semente = (s) => () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let id = 0;

  // [data-montes="semente"] data-picos data-alto: uma linha de serra com luz no cume (cores em --c1, --c2, --luz)
  document.querySelectorAll('[data-montes]').forEach((el) => {
    const r = semente(+el.dataset.montes || 1);
    const W = 1600, H = 600, picos = +el.dataset.picos || 5, alto = +el.dataset.alto || 0.7;
    let pts = [[0, H * (0.5 + r() * 0.3)]];
    for (let i = 1; i <= picos * 2; i++) {
      const x = (i / (picos * 2)) * W;
      const y = i % 2 ? H * (1 - alto * (0.6 + r() * 0.4)) : H * (0.45 + r() * 0.35);
      pts.push([x + (r() - 0.5) * (W / picos) * 0.3, y]);
    }
    pts[pts.length - 1][0] = W;
    for (let n = 0; n < 5; n++) {
      const novo = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
        novo.push(pts[i], [(x1 + x2) / 2, (y1 + y2) / 2 + (r() - 0.5) * Math.abs(x2 - x1) * 0.42]);
      }
      novo.push(pts[pts.length - 1]);
      pts = novo;
    }
    const linha = pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L');
    const g = `m${++id}`;
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" style="stop-color:var(--c1)"/><stop offset="1" style="stop-color:var(--c2)"/></linearGradient></defs>
      <path d="M0 ${H} L${linha} L${W} ${H} Z" fill="url(#${g})"/>
      <path d="M${linha}" fill="none" style="stroke:var(--luz,transparent)" stroke-width="2.2" vector-effect="non-scaling-stroke"/>
    </svg>`;
  });

  // [data-portal]: moldura rasgada a toda a largura, com um buraco no meio por onde se entra no mundo
  document.querySelectorAll('[data-portal]').forEach((el) => {
    const r = semente(+el.dataset.portal || 7);
    const W = 1600, H = 900, cx = W / 2, cy = H * 0.5, rx = W * 0.41, ry = H * 0.39;
    const furo = [];
    const n = 140;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rasgo = 1 + (r() - 0.5) * 0.07 + (i % 9 === 0 ? (r() - 0.6) * 0.16 : 0);
      // um retângulo de cantos muito redondos, rasgado: superelipse
      const c = Math.cos(a), s = Math.sin(a);
      const k = 0.28;
      const x = cx + rx * rasgo * Math.sign(c) * Math.pow(Math.abs(c), k);
      const y = cy + ry * rasgo * Math.sign(s) * Math.pow(Math.abs(s), k);
      furo.push(`${x.toFixed(1)} ${y.toFixed(1)}`);
    }
    const g = `p${++id}`;
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <defs><radialGradient id="${g}" cx=".5" cy=".5" r=".75">
        <stop offset=".55" style="stop-color:var(--c1)"/><stop offset="1" style="stop-color:var(--c2)"/></radialGradient></defs>
      <path fill-rule="evenodd" fill="url(#${g})" d="M-40 -40 H${W + 40} V${H + 40} H-40 Z M${furo.join(' L')} Z"/>
      <path fill="none" style="stroke:var(--luz)" stroke-width="3" vector-effect="non-scaling-stroke" d="M${furo.join(' L')} Z"/>
    </svg>`;
  });
})();
