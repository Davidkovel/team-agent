// Os avisos do canto de cima à direita (avisos.css) uns debaixo dos outros, como no iPhone: as notificações do Hub (#bn), a
// tarefa nova (#tpop), a notícia de trading (.sn-ov) e a mensagem dos agentes da Sala de Trading (.tr-alert). Sem isto, dois ao
// mesmo tempo ficavam um em cima do outro. Só mexe quando um aviso aparece, sai ou muda de tamanho.
(function () {
  const SEL = ["#bn", "#tpop", "#mpop:not(.low)", ".sn-ov", ".tr-alert"], GAP = 10, TOP = 14;
  let busy = false;
  function stack() {
    busy = false;
    if (document.documentElement.classList.contains("is-phone")) return;
    let y = TOP;
    for (const sel of SEL) {
      for (const el of document.querySelectorAll(sel)) {
        const h = sel === "#bn" ? [...el.children].reduce((s, c) => s + c.offsetHeight + 8, 0) - (el.children.length ? 8 : 0) : el.offsetHeight;
        el.style.top = `${y}px`;
        if (h > 0) y += h + GAP;
      }
    }
  }
  const soon = () => { if (!busy) { busy = true; requestAnimationFrame(stack); } };
  const ro = new ResizeObserver(soon);
  new MutationObserver((list) => {
    for (const m of list) for (const n of m.addedNodes) if (n.nodeType === 1 && SEL.some((s) => n.matches(s))) ro.observe(n);
    soon();
  }).observe(document.body, { childList: true });
  addEventListener("resize", soon);
})();
