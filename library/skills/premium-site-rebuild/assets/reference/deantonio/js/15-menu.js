(() => {
  const { $, $$, reduz, clamp, vh, prog } = DA;
  /* ---------- menu ---------- */
  const mb = $('[data-menu-botao]'), menu = $('[data-menu]');
  const fechaMenu = () => { mb.setAttribute('aria-expanded', 'false'); menu.classList.remove('aberto'); setTimeout(() => (menu.hidden = true), 300); document.body.style.overflow = ''; };
  mb.addEventListener('click', () => {
    if (mb.getAttribute('aria-expanded') === 'true') return fechaMenu();
    menu.hidden = false; requestAnimationFrame(() => menu.classList.add('aberto'));
    mb.setAttribute('aria-expanded', 'true'); document.body.style.overflow = 'hidden'; $('a', menu).focus();
  });
  menu.addEventListener('click', (e) => { const a = e.target.closest('a'); if (!a) return; if (a.dataset.irBarco && DA.escolheBarco) DA.escolheBarco(a.dataset.irBarco); fechaMenu(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { fechaMenu(); mb.focus(); } });

})();
