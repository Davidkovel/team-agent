(() => {
  /* ---------- chegar ao pedido de proposta vindo de /models/ com ?modelo=D29#proposta ----------
     só actua onde há o formulário com os modelos e o endereço traz ?modelo: marca essa versão
     como se a pessoa a tivesse tocado (o evento change deixa o formulário e a placa coerentes) */
  let pedido = null;
  try { pedido = new URLSearchParams(location.search).get('modelo'); } catch (e) { return; }
  if (!pedido) return;
  const caixas = [...document.querySelectorAll('input[name=modelo]')]; if (!caixas.length) return;
  const alvos = caixas.filter((c) => c.value === pedido || c.value.startsWith(pedido + ' '));
  if (alvos.length) alvos.forEach((c) => { if (!c.checked) { c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); } });
  // o endereço fica limpo: só a âncora, que o rodapé repõe quando a página se solta
  try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) { /* nada */ }
})();
