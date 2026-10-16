(() => {
  const { $, $$ } = DA;
  const sec = $('#premios'); if (!sec) return;

  // os algarismos do ano: a caixa do desenho ajusta-se à letra quando a Archivo chega
  const ajustar = () => $$('.pr-num', sec).forEach((svg) => {
    try { const b = svg.querySelector('text').getBBox(); if (b.width) svg.setAttribute('viewBox', `${(b.x - 6).toFixed(1)} ${(b.y - 6).toFixed(1)} ${(b.width + 12).toFixed(1)} ${(b.height + 12).toFixed(1)}`); } catch (e) {}
  });
  ajustar();
  if (document.fonts) document.fonts.ready.then(ajustar);

  // entradas: limiar 0, sem margem negativa
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('dentro'); io.unobserve(e.target); } }), { threshold: 0 });
  $$('[data-pr]', sec).forEach((el) => io.observe(el));
})();
