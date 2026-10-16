/* A placa do pedido também escolhe: cada linha (iate, uso, quando, país, dealer) abre ali mesmo o seletor nativo
   com as opções do formulário, para quem não percebe que se escolhe nos passos. O formulário continua a ser o dono:
   a escolha marca o campo verdadeiro e dispara change, e é o 70-proposta.js que pinta a placa. */
(() => {
  const { $$ } = DA;
  const form = document.querySelector('[data-form-p], .proposta form, form[data-form]') || document.querySelector('#proposta form');
  if (!form) return;
  const campos = {
    modelo: { titulo: 'Choose your yacht', ops: () => $$('input[name=modelo]', form).map((i) => ({ v: i.value, t: i.value, on: i.checked, el: i })) },
    uso: { titulo: 'How will you use it', ops: () => $$('input[name=uso]', form).map((i) => ({ v: i.value, t: i.value, on: i.checked, el: i })) },
    quando: { titulo: 'When', ops: () => $$('input[name=quando]', form).map((i) => ({ v: i.value, t: i.value, on: i.checked, el: i })) },
    pais: { titulo: 'Your country', ops: () => { const s = form.querySelector('select[name=pais]'); return s ? [...s.options].filter((o) => o.value).map((o) => ({ v: o.value, t: o.value, on: s.value === o.value, el: s })) : []; } },
    dealer: { titulo: 'Your dealer', ops: () => $$('input[name=dealer]', form).map((i) => ({ v: i.value, t: i.closest('label') ? (i.closest('label').querySelector('b') || i.closest('label')).textContent.trim() : i.value, on: i.checked, el: i })) },
  };
  const marca = (op) => {
    const el = op.el;
    if (el.tagName === 'SELECT') el.value = op.v;
    else if (el.type === 'checkbox') el.checked = !el.checked;
    else el.checked = true;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const prepara = (dd) => {
    const nome = dd.dataset.p, c = campos[nome]; if (!c || dd.dataset.escolhe) return;
    dd.dataset.escolhe = '1';
    const linha = dd.parentElement; linha.classList.add('placa-escolhe');
    const sel = document.createElement('select');
    sel.className = 'placa-sel'; sel.setAttribute('aria-label', c.titulo);
    // as opções refazem-se no momento do toque: o dealer depende do país escolhido
    const enche = () => {
      const ops = c.ops();
      sel.innerHTML = '';
      const cab = new Option(ops.length ? c.titulo : (nome === 'dealer' ? 'Choose your country first' : c.titulo), '', true, true); cab.disabled = true; sel.add(cab);
      ops.forEach((o, i) => sel.add(new Option((o.on ? '✓ ' : '') + o.t, String(i))));
      sel._ops = ops;
    };
    sel.addEventListener('focus', enche); sel.addEventListener('pointerdown', enche); sel.addEventListener('mousedown', enche);
    sel.addEventListener('change', () => {
      const op = sel._ops && sel._ops[+sel.value];
      if (op) marca(op);
      else if (nome === 'dealer') { const s = form.querySelector('select[name=pais]'); if (s) s.focus(); }
      sel.selectedIndex = 0;
    });
    enche();
    linha.appendChild(sel);
  };
  const tudo = () => $$('.placa dd[data-p]').forEach(prepara);
  tudo();
  // a placa muda de sítio no telemóvel (placa-slot): prepara as cópias que aparecerem
  new MutationObserver(tudo).observe(document.body, { childList: true, subtree: true });
})();
