// Galeria (#/galeria), a tab of Skills: the best sites on the web, to steal ideas from and show to clients.
// Asked for by Marco on 24 Oct («ver os sites mais fixes, para depois usar, e que o Claude aconselhe outros»): his five
// picks and the Claude's suggestions, each with a picture, the one move that makes it, what to steal, the stack and the
// skill to build it with. The list is frontend/hub/galeria/sites.json, the pictures come from scripts/galeria.py
// (skill site-imersivo-3d, «Juntar um site»). Static: nothing to load from the Hub, nothing animates.
(function () {
  let S = [], tipo = "todos";
  const TIPOS = [["todos", "Todos"], ["produto", "Produto em 3D"], ["historia", "Histórias"], ["estudio", "Estúdios"], ["jogo", "Jogos"]];
  const QUEM = [["marco", "Escolhidos pelo Marco"], ["claude", "Sugestões do Claude"]];

  const ask = (s) => `${t("Faz um site como o {n}", { n: s.nome })} (${s.url}). ${t("Usa a skill")} ${s.skill}. ${t("O que roubar")}: ${s.roubar.join("; ")}.`;

  function card(s) {
    return `<article class="panel gl-card">
      <a class="gl-shot" href="${esc(s.url)}" target="_blank" rel="noopener"><img src="hub/galeria/${esc(s.id)}.jpg?v=${HUB_VERSION}" alt="${esc(s.nome)}" loading="lazy"></a>
      <div class="gl-body">
        <header><b>${esc(s.nome)}</b><span>${esc(s.de)}</span></header>
        <p class="gl-golpe">${esc(t(s.golpe))}</p>
        <ul class="gl-roubar">${s.roubar.map((r) => `<li>${esc(t(r))}</li>`).join("")}</ul>
        <div class="gl-stack">${s.stack.map((x) => `<span>${esc(x)}</span>`).join("")}</div>
        <footer>
          <a class="btn sm" href="${esc(s.url)}" target="_blank" rel="noopener">${icon("arrow")}${esc(t("Abrir o site"))}</a>
          <button type="button" class="btn sm quiet" data-ask="${esc(s.id)}">${esc(t("Copiar o pedido"))}</button>
          <span class="gl-skill" title="${esc(t("A skill para fazer um assim"))}">${icon("layers")}${esc(s.skill)}</span>
        </footer>
      </div></article>`;
  }

  function draw() {
    const list = S.filter((s) => tipo === "todos" || s.tipo === tipo);
    $("gl-seg").innerHTML = TIPOS.map(([id, label]) => {
      const n = id === "todos" ? S.length : S.filter((s) => s.tipo === id).length;
      return `<button type="button" data-tipo="${id}" class="${id === tipo ? "on" : ""}">${esc(t(label))}<b>${n}</b></button>`;
    }).join("");
    $("gl-body").innerHTML = QUEM.map(([q, label]) => {
      const mine = list.filter((s) => s.quem === q);
      return mine.length ? `${ui.sec(label, `<span class="gl-n">${mine.length}</span>`)}<div class="gl-grid">${mine.map(card).join("")}</div>` : "";
    }).join("") || ui.empty("search", t("Nenhum site deste tipo"), t("Escolhe outro tipo em cima."));
  }

  function click(e) {
    const b = e.target.closest("[data-tipo], [data-ask]");
    if (!b) return;
    if (b.dataset.tipo) { tipo = b.dataset.tipo; draw(); return; }
    const s = S.find((x) => x.id === b.dataset.ask);
    navigator.clipboard.writeText(ask(s)).then(() => { b.textContent = t("Copiado"); setTimeout(() => { b.textContent = t("Copiar o pedido"); }, 1600); });
  }

  HUB_VIEWS.galeria = async function () {
    page(`${ui.head("Skills", t("Galeria"), t("Os sites mais bonitos da web: abre, rouba a ideia e manda o pedido ao Claude."))}
      <div id="gl-kpis"></div>
      <nav class="gl-seg" id="gl-seg"></nav>
      <div id="gl-body">${ui.skeleton()}</div>`);
    $("view").onclick = click;
    const r = await fetch(`hub/galeria/sites.json?v=${HUB_VERSION}`);
    if (!r.ok) throw new Error(t("Não consegui abrir a lista de sites."));
    S = await r.json();
    // the Painel's row (hub/painel.css): the gallery in four figures, the kinds of site as columns
    const by = (q) => S.filter((s) => s.quem === q).length, skills = new Set(S.map((s) => s.skill)), stack = {};
    S.forEach((s) => s.stack.forEach((x) => { stack[x] = (stack[x] || 0) + 1; }));
    const top = Object.entries(stack).sort((a, b) => b[1] - a[1])[0];
    $("gl-kpis").innerHTML = ui.kpis([
      ui.kpi({ label: "Sites na galeria", value: S.length, sub: t("{n} tipos", { n: TIPOS.length - 1 }), viz: ui.cols(TIPOS.slice(1).map(([id]) => S.filter((s) => s.tipo === id).length), { fat: true }) }),
      ui.kpi({ label: "Escolhidos pelo Marco", value: by("marco"), viz: ui.ring(S.length ? (by("marco") / S.length) * 100 : null) }),
      ui.kpi({ label: "Sugestões do Claude", value: by("claude"), viz: ui.ring(S.length ? (by("claude") / S.length) * 100 : null) }),
      ui.kpi({ label: "Skills para os fazer", value: skills.size, sub: top ? t("mais usado: {x}", { x: top[0] }) : "" }),
    ]);
    draw();
  };
})();
