/* Vidro em todo o Hub (29 out): procura as superfícies escuras e opacas (cartões, painéis, barras, a barra do lado)
   e põe-lhes a classe .vidro (hub/vidro.css). Assim todas as salas, as que existem e as que vierem, ficam com o mesmo
   vidro limpo da central do widget e o C63 por trás. Só corre quando a página muda (MutationObserver, com pausa),
   parado não gasta nada. */
(() => {
  const SKIP = new Set(["IMG", "VIDEO", "CANVAS", "SVG", "PATH", "INPUT", "TEXTAREA", "SELECT", "OPTION", "IFRAME", "SCRIPT", "STYLE", "I", "B", "SPAN"]);
  const rgba = (s) => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const v = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] : 1 }; };
  const dark = (c) => c && c.a >= 0.6 && (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) < 60;
  const colours = (s) => (s.match(/rgba?\([^)]+\)|#[0-9a-f]{3,8}\b/gi) || []).map((x) => x[0] === "#" ? hex(x) : rgba(x));
  const hex = (h) => { h = h.slice(1); if (h.length <= 4) h = [...h].map((x) => x + x).join(""); return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 }; };

  function opaqueDark(cs) {
    const img = cs.backgroundImage;
    if (img && img !== "none") {
      if (/url\(/.test(img)) return false;            // fotos e ícones ficam como estão
      const solid = colours(img).filter((c) => c && c.a >= 0.6);   // os tons translúcidos (a cor da pessoa) não contam
      return solid.length > 0 && solid.every(dark);   // gradientes escuros (painéis antigos) também viram vidro
    }
    return dark(rgba(cs.backgroundColor));
  }

  const seen = new WeakMap();   // elemento -> a classe que tinha quando foi visto: só se volta a olhar se mudar
  const ALL = "#app *, #modal *, #palette, .pop, #login *";
  function scan(roots) {
    const vw = innerWidth, vh = innerHeight;
    const els = roots ? roots.flatMap((r) => [r, ...r.querySelectorAll("*")]).filter((el) => el.matches(ALL)) : document.querySelectorAll(ALL);
    for (const el of els) {
      if (seen.get(el) === el.className) continue;
      if (SKIP.has(el.tagName.toUpperCase()) || el.classList.contains("vidro") || el.closest("svg")) continue;
      const r0 = el.getBoundingClientRect();
      if (!r0.width) continue;                         // ainda escondido: vê-se quando aparecer
      seen.set(el, el.className);
      const cs = getComputedStyle(el);
      if (cs.display === "none" || !opaqueDark(cs)) continue;
      const r = r0;
      if (r.width < 90 || r.height < 34) continue;    // pontos, barras e etiquetas pequenas ficam como estão
      if (r.width > vw * 0.9 && r.height > vh * 0.8) { el.style.setProperty("background", "transparent", "important"); continue; }   // contentores de página inteira: só transparentes
      if (cs.boxShadow && cs.boxShadow.includes("inset")) el.style.setProperty("--vidro-keep", cs.boxShadow);   // o risco da cor de cada um fica
      el.classList.add("vidro");
      seen.set(el, el.className);
      if (cs.position === "fixed" || cs.position === "absolute" || el.matches(".modal-box, .pop, .pal, [role=dialog], [role=menu]")) { el.classList.add("vidro-flutua"); seen.set(el, el.className); }
    }
  }

  // 31 out, David: «quando mudo de página o vidro primeiro fica mais escuro e depois é que fica normal». Era isto: a página nova
  // pintava-se com o fundo opaco dela e só 120 ms depois passava a vidro. Agora o que entra é visto logo, no próprio
  // MutationObserver (corre antes de o browser pintar), e só as mudanças de classe/estilo esperam pela pausa.
  let t = 0;
  const later = () => { clearTimeout(t); t = setTimeout(scan, 120); };
  new MutationObserver((list) => {
    const added = [];
    for (const m of list) {
      if (m.type !== "childList") continue;
      for (const n of m.addedNodes) if (n.nodeType === 1 && !SKIP.has(n.tagName.toUpperCase())) added.push(n);
    }
    if (added.length) scan(added);
    later();
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "hidden", "style", "data-pane"] });
  addEventListener("hashchange", later);
  addEventListener("resize", later);
  addEventListener("animationend", later, true);
  addEventListener("transitionend", later, true);
  later();
})();
