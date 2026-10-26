/* Contacts, estimator and the request form (no backend: the form opens email, Telegram or WhatsApp with the text ready).
   EVERYTHING TO FILL IN IS HERE. Placeholders until the real values exist; an empty field hides that channel. */
// Analytics: paste the Microsoft Clarity project id here (clarity.microsoft.com → New project → Settings → Setup).
// Free: click heatmaps, scroll depth, session recordings. Our own events show up under Clarity → Filters → Custom events.
const ANALITICA = { clarity: '' };

const CONTACTO = {
  telefone: '+380 68 418 55 76',   // shown as written; the link uses only the digits
  email: 'dkovel7@gmail.com',
  emailCopia: 'marco.goucha@gmail.com',   // every request is also copied here
  telegram: 'David_k27',
  whatsapp: '',      // digits with country code, e.g. '380500000000'
  viber: '',         // digits with country code
  instagram: '',     // username
  linkedin: '',      // full company page URL
  horas: '24/7, every day',
  onde: 'Portugal · working with clients worldwide',
};

(() => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const ano = $('#ano'); if (ano) ano.textContent = new Date().getFullYear();

  // ---- contacts everywhere on the page ----
  const digitos = CONTACTO.telefone.replace(/[^\d+]/g, '');
  $$('[data-tel]').forEach((a) => { if (!CONTACTO.telefone) return a.remove(); a.textContent = CONTACTO.telefone; a.href = 'tel:' + digitos; });
  $$('[data-email]').forEach((a) => { if (!CONTACTO.email) return a.remove(); a.textContent = CONTACTO.email; a.href = 'mailto:' + CONTACTO.email; });
  $$('[data-horas]').forEach((e) => { e.textContent = CONTACTO.horas; });
  $$('[data-onde]').forEach((e) => { e.textContent = CONTACTO.onde; });
  const mens = [
    CONTACTO.telegram && ['Telegram', 'https://t.me/' + CONTACTO.telegram],
    CONTACTO.whatsapp && ['WhatsApp', 'https://wa.me/' + CONTACTO.whatsapp],
    CONTACTO.viber && ['Viber', 'viber://chat?number=%2B' + CONTACTO.viber],
  ].filter(Boolean);
  const pill = ([t, h]) => `<a class="pill" href="${h}" target="_blank" rel="noopener">${t}</a>`;
  $$('[data-mensageiros]').forEach((e) => { e.innerHTML = mens.length ? mens.map(pill).join('') : 'Telegram · WhatsApp · Viber — links coming soon'; });
  const redes = [
    CONTACTO.instagram && ['Instagram', 'https://instagram.com/' + CONTACTO.instagram],
    CONTACTO.linkedin && ['LinkedIn', CONTACTO.linkedin],
    ...mens,
  ].filter(Boolean);
  $$('[data-redes]').forEach((e) => { e.innerHTML = redes.map(pill).join(''); });

  // ---- analytics: Clarity + our events (which button, which form, sent or not) ----
  if (ANALITICA.clarity) {
    (function (c, l, a, r, i, t, y) { c[a] = c[a] || function () { (c[a].q = c[a].q || []).push(arguments) }; t = l.createElement(r); t.async = 1; t.src = 'https://www.clarity.ms/tag/' + i; y = l.getElementsByTagName(r)[0]; y.parentNode.insertBefore(t, y); })(window, document, 'clarity', 'script', ANALITICA.clarity);
  }
  const evento = (nome) => { try { if (window.clarity) window.clarity('event', nome); } catch (e) {} };
  window.apexEvento = evento;
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a, button'); if (!a) return;
    const h = a.getAttribute('href') || '';
    if (h.startsWith('https://t.me/')) evento('click_telegram');
    else if (h.startsWith('tel:')) evento('click_call');
    else if (h.startsWith('mailto:')) evento('click_email');
    else if (a.classList.contains('botao')) evento('click_button: ' + a.textContent.trim().slice(0, 40));
  });

  // ---- always-on contact dock: Telegram and a call, like agencies do — the fastest way to a conversation ----
  const tgLink = (txt) => CONTACTO.telegram ? 'https://t.me/' + CONTACTO.telegram + (txt ? '?text=' + encodeURIComponent(txt) : '') : '';
  if (CONTACTO.telegram || CONTACTO.telefone) {
    const dk = document.createElement('div'); dk.className = 'doca';
    dk.innerHTML = (CONTACTO.telegram ? `<a class="doca__tg" href="${tgLink("Hi! I'd like to talk about a website.")}" target="_blank" rel="noopener" aria-label="Write to us in Telegram"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.5 3.6 2.9 10.8c-1.3.5-1.3 1.2-.2 1.5l4.8 1.5 1.8 5.6c.2.6.1.9.8.9.5 0 .7-.2 1-.5l2.3-2.2 4.8 3.5c.9.5 1.5.2 1.7-.8l3.1-14.8c.3-1.3-.5-1.9-1.5-1.4ZM8.1 13.5l9.6-6.1c.5-.3.9-.1.5.2l-8.2 7.4-.3 3.4-1.6-4.9Z"/></svg><span>Telegram</span></a>` : '')
      + (CONTACTO.telefone ? `<a class="doca__tel" href="tel:${digitos}" aria-label="Call us"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 0 1 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1Z"/></svg><span>Call</span></a>` : '');
    document.body.append(dk);
  }

  $$('[data-tg-promo]').forEach((x) => { if (CONTACTO.telegram) { x.href = tgLink("Hi! I'd like −10% on my first project."); x.target = '_blank'; x.rel = 'noopener'; } });

  // ---- brands strip: a second copy so the -50% loop has no seam ----
  const trilho = $('.marcas__trilho');
  if (trilho) [...trilho.children].forEach((li) => { const c = li.cloneNode(true); c.setAttribute('aria-hidden', 'true'); c.querySelectorAll('a').forEach((a) => a.tabIndex = -1); trilho.append(c); });

  // ---- buttons that pre-pick a service in the request form ----
  const form = $('#pedido');
  $$('[data-servico]').forEach((a) => a.addEventListener('click', () => {
    const c = form && form.querySelector(`input[name="servico"][value="${a.dataset.servico}"]`);
    if (c) c.checked = true;
  }));

  // ---- every form.pedido (project request, free audit, job application): the text goes to the chat or email ----
  const ROTULOS = { nome: 'Name', empresa: 'Company', site: 'Website / Instagram', contacto: 'Contact', orcamento: 'Budget', portfolio: 'Portfolio' };
  $$('form.pedido').forEach((f) => f.addEventListener('submit', (e) => {
    e.preventDefault();
    const estado = f.querySelector('.pedido__estado');
    const falta = [...f.querySelectorAll('[required]')].filter((i) => { const v = !i.value.trim(); i.setAttribute('aria-invalid', String(v)); return v; });
    if (falta.length) { evento('form_missing_fields: ' + (f.id || 'form')); estado.textContent = 'Fill in the marked fields so we can answer you.'; falta[0].focus(); return; }
    const d = new FormData(f);
    const linhas = [f.dataset.assunto || 'New project request — Ten Fold'];
    for (const [k, r] of Object.entries(ROTULOS)) if (d.get(k)) linhas.push(r + ': ' + d.get(k).trim());
    if (d.getAll('servico').length) linhas.push((f.dataset.rotulo || 'Needs') + ': ' + d.getAll('servico').join(', '));
    if ((d.get('mensagem') || '').trim()) linhas.push('', d.get('mensagem').trim());
    const texto = linhas.join('\n');
    const quem = (d.get('nome') || d.get('empresa') || d.get('site') || '').trim();

    // 1) the request goes straight to the team's email (FormSubmit, no own server); 2) if that fails, the chat or email app opens
    estado.textContent = 'Sending…'; evento('form_submit: ' + (f.id || 'form'));
    const corpo = { _subject: (f.dataset.assunto || 'New project request — Ten Fold') + (quem ? ' — ' + quem : ''), _template: 'table', _captcha: 'false', Request: texto };
    if (CONTACTO.emailCopia) corpo._cc = CONTACTO.emailCopia;
    fetch('https://formsubmit.co/ajax/' + CONTACTO.email, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(corpo) })
      .then((r) => r.json()).then((j) => {
        if (String(j.success) !== 'true') throw new Error(j.message || 'not sent');
        evento('form_sent: ' + (f.id || 'form'));
        estado.innerHTML = 'Sent! We reply within 2 hours, 24/7. Faster: '
          + (CONTACTO.telegram ? `<a href="${tgLink(texto)}" target="_blank" rel="noopener">write in Telegram</a>` : '')
          + (CONTACTO.telegram && CONTACTO.telefone ? ' or ' : '') + (CONTACTO.telefone ? `<a href="tel:${digitos}">call ${CONTACTO.telefone}</a>` : '') + '.';
        f.reset();
      }).catch(() => abrirCanal(texto, quem, f, estado));
  }));

  function abrirCanal(texto, quem, f, estado) {

    if (CONTACTO.telegram) {
      window.open(`https://t.me/${CONTACTO.telegram}?text=${encodeURIComponent(texto)}`, '_blank', 'noopener');
      estado.textContent = 'Telegram opened with your message ready — just press send.';
    } else if (CONTACTO.whatsapp) {
      window.open(`https://wa.me/${CONTACTO.whatsapp}?text=${encodeURIComponent(texto)}`, '_blank', 'noopener');
      estado.textContent = 'WhatsApp opened with your message ready — just press send.';
    } else if (CONTACTO.email && !CONTACTO.email.endsWith('.example')) {
      location.href = `mailto:${CONTACTO.email}?subject=${encodeURIComponent((f.dataset.assunto || 'Project request') + ' — ' + quem)}&body=${encodeURIComponent(texto)}`;
      estado.textContent = 'Your email app opened with the message ready — just press send.';
    } else {
      estado.textContent = 'Thanks! Our contact channels are being set up — please come back soon.';
    }
  }
})();
