// Fábrica Etsy (#/etsy): o Riddler pesquisa o que vende, a Catwoman desenha, o Joker escreve o anúncio e o Alfred barra
// as marcas (backend/app/etsy.py). A pessoa aprova, copia para a Etsy e regista as vendas: o dinheiro é só o real.
(function () {
  let S = null, timer = 0, filter = "new";
  const eur = (v) => Number(v || 0).toLocaleString("pt-PT", { style: "currency", currency: "EUR" });
  const when = (ts) => new Date(ts * 1000).toLocaleString("pt-PT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const img = (id, name = "design.png") => `/api/etsy/file/${encodeURIComponent(id)}/${name}?token=${encodeURIComponent(token)}`;
  const CREW = {
    riddler: ["Riddler", "Pesquisa", "Procura na web o que está a vender na Etsy e o que vai vender nas próximas semanas."],
    catwoman: ["Catwoman", "Design", "Desenha cada ideia em vetor e passa-a a PNG 4500 × 5400, o tamanho da Printify."],
    joker: ["Joker", "Anúncio", "Escreve o título, as 13 tags, a descrição e o preço com margem."],
    alfred: ["Alfred", "Revisão", "Barra marcas, personagens e anúncios incompletos antes de chegarem a ti."],
  };
  // a cor da peça por baixo da estampa, para se ver como fica (a 1.ª cor conhecida que o Riddler escreveu)
  const COLORS = [[/black|pret/i, "#141518"], [/navy|marinho/i, "#1c2541"], [/burgundy|bord|maroon|vinho/i, "#5a1424"],
    [/forest|verde/i, "#23402f"], [/charcoal|antracite|carv/i, "#36393f"], [/heather|grey|gray|cinz/i, "#a3a6ab"],
    [/sand|areia|beige|bege/i, "#dccbaa"], [/cream|creme|natural|ivory/i, "#efe6d2"], [/pink|rosa/i, "#f2c6cf"], [/red|vermelh/i, "#a3162a"],
    [/blue|azul/i, "#7d9cc4"], [/white|branc/i, "#f7f7f5"]];
  const garment = (c) => (COLORS.find(([re]) => re.test(c || "")) || [0, "#f3efe8"])[1];
  const TABS = [["new", "Para aprovar"], ["approved", "Aprovados"], ["published", "Na Etsy"], ["blocked", "Barrados"], ["rejected", "Recusados"]];

  HUB_VIEWS.etsy = async function () {
    page(`<div class="ey" id="ey">
      <header class="ey-head">
        <div><small>${esc(t("Negócio · print-on-demand na Etsy com a Printify"))}</small><h1>${esc(t("Fábrica Etsy"))}</h1>
          <p class="ey-sub">${esc(t("Os agentes encontram o que vende, desenham e escrevem o anúncio. Tu aprovas, pões na Etsy e registas as vendas. Nada é publicado sem ti."))}</p></div>
        <div class="ey-ctl" id="ey-ctl"></div>
      </header>
      <div class="ey-msg" id="ey-msg" hidden></div>
      <section class="ey-money" id="ey-money"></section>
      <section class="ey-line" id="ey-line"></section>
      <nav class="ey-tabs" id="ey-tabs"></nav>
      <section class="ey-grid" id="ey-grid"></section>
      <div class="ey-two">
        <section class="ey-card" id="ey-runs"></section>
        <section class="ey-card" id="ey-start"></section>
      </div>
    </div>`);
    $("ey").onclick = click;
    await load().catch((e) => msg(e.message));
    clearInterval(timer);
    timer = setInterval(() => { if (!$("ey")) { clearInterval(timer); return; } if (!document.hidden) load().catch(() => {}); }, 5000);
  };

  async function load() {
    S = await api("/api/etsy");
    paintCtl(); paintMoney(); paintLine(); paintTabs(); paintGrid(); paintRuns(); paintStart();
  }

  function msg(text) {
    const el = $("ey-msg");
    if (!el) return;
    el.hidden = false; el.textContent = text;
    clearTimeout(msg.t); msg.t = setTimeout(() => { el.hidden = true; }, 6000);
  }

  async function post(path, body) {
    S = await api(path, { method: "POST", body: body || {} });
    paintCtl(); paintMoney(); paintLine(); paintTabs(); paintGrid(); paintRuns();
  }

  function paintCtl() {
    const c = S.cfg;
    const state = S.running ? t("A trabalhar") : c.on ? t("Ligada · todos os dias às {h}h", { h: c.hour }) : t("Desligada");
    paint($("ey-ctl"), `<span class="ey-pill ${S.running ? "run" : c.on ? "on" : ""}"><i></i>${esc(state)}</span>
      <div class="ey-btns">
        <button type="button" class="btn primary" data-act="run" ${S.running || !S.installed ? "disabled" : ""}>${esc(t("Fazer um lote agora"))}</button>
        <button type="button" class="btn" data-act="toggle">${esc(c.on ? t("Desligar o horário") : t("Ligar todos os dias"))}</button>
      </div>`);
  }

  function paintMoney() {
    const n = S.counts;
    paint($("ey-money"), `<div class="ey-stat big"><small>${esc(t("Vendas registadas"))}</small><b>${eur(S.revenue)}</b>
        <span>${esc(S.sales.length ? t("{n} vendas", { n: S.sales.length }) : t("Ainda nenhuma: regista cada venda da Etsy aqui"))}</span></div>
      <div class="ey-stat"><small>${esc(t("Para aprovar"))}</small><b>${n.new}</b></div>
      <div class="ey-stat"><small>${esc(t("Prontos a publicar"))}</small><b>${n.approved}</b></div>
      <div class="ey-stat"><small>${esc(t("Na Etsy"))}</small><b>${n.published}</b></div>
      <form class="ey-sale" data-form="sale">
        <div><small>${esc(t("Entrou uma venda na Etsy?"))}</small><input name="amount" type="number" step="0.01" min="0.01" placeholder="€" required><input name="note" placeholder="${esc(t("o quê (opcional)"))}"><button class="btn sm primary">${esc(t("Registar"))}</button></div></form>`);
  }

  // a linha de montagem: quem está a trabalhar agora, e o que cada um faz
  function paintLine() {
    const who = S.stage && S.stage.who;
    paint($("ey-line"), Object.entries(CREW).map(([id, [name, role, what]]) => {
      const live = who === id;
      return `<div class="ey-agent ${live ? "live" : ""}"><span class="ey-face">${esc(name[0])}</span>
        <div><b>${esc(name)}</b> <small>${esc(t(role))}</small><p>${esc(live ? S.stage.what : t(what))}</p></div></div>`;
    }).join(`<span class="ey-arrow">→</span>`) + (S.error ? `<p class="ey-err">${esc(t("Último erro"))}: ${esc(S.error)}</p>` : ""));
  }

  function paintTabs() {
    paint($("ey-tabs"), TABS.map(([k, l]) => `<button type="button" class="${filter === k ? "on" : ""}" data-tab="${k}">${esc(t(l))} <i>${S.counts[k] || 0}</i></button>`).join(""));
  }

  function paintGrid() {
    const items = S.items.filter((i) => i.status === filter);
    if (!items.length) {
      paint($("ey-grid"), `<p class="ey-none">${esc(filter === "new" ? (S.running ? t("Os agentes estão a trabalhar: os desenhos aparecem aqui assim que ficarem prontos.") : t("Nada para aprovar. Carrega em «Fazer um lote agora».")) : t("Nada aqui."))}</p>`);
      return;
    }
    paint($("ey-grid"), items.map(card).join(""));
  }

  function card(i) {
    const btns = {
      new: [["approved", "Aprovar", "primary"], ["rejected", "Recusar", ""]],
      approved: [["published", "Já está na Etsy", "primary"], ["new", "Voltar atrás", ""]],
      published: [["approved", "Tirar da Etsy", ""]],
      rejected: [["new", "Repor", ""]],
      blocked: [],
    }[i.status] || [];
    return `<article class="ey-item" data-id="${esc(i.id)}">
      <div class="ey-shot" style="background:${garment(i.cor_peca)}"><img loading="lazy" src="${img(i.id)}" alt=""></div>
      <div class="ey-body">
        <small>${esc(i.nicho || "")} · ${esc(i.produto || "t-shirt")} ${i.cor_peca ? "· " + esc(i.cor_peca) : ""}</small>
        <h3>${esc(i.titulo || i.frase)}</h3>
        ${i.blocked ? `<p class="ey-err">${esc(i.blocked)}</p>` : ""}
        <p class="ey-why"><b>${esc(t("Porque vende"))}:</b> ${esc(i.porque || "")}</p>
        <div class="ey-tags">${(i.tags || []).map((g) => `<span>${esc(g)}</span>`).join("")}</div>
        <div class="ey-meta"><b>${eur(i.preco)}</b>${i.printify ? `<span>${esc(i.printify)}</span>` : ""}</div>
        <details><summary>${esc(t("Descrição e fontes"))}</summary><p class="ey-desc">${esc(i.descricao || "")}</p>
          ${(i.fontes || []).map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u.replace(/^https?:\/\/(www\.)?/, "").slice(0, 60))}</a>`).join("")}</details>
        <div class="ey-acts">
          ${btns.map(([s, l, k]) => `<button type="button" class="btn sm ${k}" data-status="${s}">${esc(t(l))}</button>`).join("")}
          <button type="button" class="btn sm quiet" data-rewrite="1" ${S.running ? "disabled" : ""}>${esc(t("Reescrever anúncio"))}</button>
          <button type="button" class="btn sm quiet" data-copy="titulo">${esc(t("Copiar título"))}</button>
          <button type="button" class="btn sm quiet" data-copy="tags">${esc(t("Copiar tags"))}</button>
          <button type="button" class="btn sm quiet" data-copy="descricao">${esc(t("Copiar descrição"))}</button>
          <a class="btn sm quiet" href="${img(i.id)}" download="${esc((i.frase || "design").replace(/[^\w]+/g, "-").slice(0, 40))}.png">${esc(t("PNG para a Printify"))}</a>
        </div>
      </div>
    </article>`;
  }

  function paintRuns() {
    paint($("ey-runs"), `<h2>${esc(t("Lotes"))}<small>${esc(t("o custo é o estimado pelo Claude, do teu plano"))}</small></h2>` + (S.runs.length
      ? `<table class="ey-table">${S.runs.map((r) => `<tr><td>${when(r.at)}</td><td>${esc(r.reason)}</td><td>${r.made} ${esc(t("desenhos"))}</td><td>${r.cost ? "$" + r.cost.toFixed(2) : ""}</td><td class="ey-err">${esc(r.error || "")}</td></tr>`).join("")}</table>`
      : `<p class="ey-none">${esc(t("Ainda nenhum lote."))}</p>`));
  }

  function paintStart() {
    const c = S.cfg;
    paint($("ey-start"), `<h2>${esc(t("Para começar a vender"))}</h2>
      <ol class="ey-steps">
        <li>${esc(t("Abre a loja em etsy.com/sell (em teu nome; a Etsy pede cartão e conta bancária)."))}</li>
        <li>${esc(t("Cria conta na printify.com e liga-a à loja (My Stores → Etsy)."))}</li>
        <li>${esc(t("Para cada desenho aprovado: na Printify, novo produto, carrega o PNG, cola o título, as tags e a descrição, e publica."))}</li>
        <li>${esc(t("Marca «Já está na Etsy» e regista cada venda: é esse o dinheiro que a fábrica mostra."))}</li>
      </ol>
      <h4>${esc(t("Horário"))}</h4>
      <form class="ey-cfg" data-form="cfg">
        <label>${esc(t("Hora"))} <input name="hour" type="number" min="0" max="23" value="${c.hour}"></label>
        <label>${esc(t("Desenhos por lote"))} <input name="per_run" type="number" min="1" max="8" value="${c.per_run}"></label>
        <label>${esc(t("Modelo"))} <select name="model">${["haiku", "sonnet", "opus"].map((m) => `<option ${m === c.model ? "selected" : ""}>${m}</option>`).join("")}</select></label>
        <button class="btn">${esc(t("Guardar"))}</button>
      </form>
      ${S.chrome ? "" : `<p class="ey-err">${esc(t("Falta o Google Chrome neste PC: é ele que passa os desenhos a PNG."))}</p>`}`);
  }

  async function click(e) {
    const b = e.target.closest("button, [data-tab]");
    const form = e.target.closest("form[data-form]");
    if (form && b && b.tagName === "BUTTON" && !b.dataset.act && !b.dataset.status && !b.dataset.copy) {
      e.preventDefault();
      if (!form.reportValidity()) return;
      const f = Object.fromEntries(new FormData(form));
      try {
        if (form.dataset.form === "sale") { await post("/api/etsy/sale", { amount: Number(f.amount), note: f.note }); msg(t("Venda registada.")); }
        else { await post("/api/etsy/cfg", { hour: Number(f.hour), per_run: Number(f.per_run), model: f.model }); msg(t("Guardado.")); }
      } catch (err) { msg(err.message); }
      return;
    }
    if (!b) return;
    try {
      if (b.dataset.tab) { filter = b.dataset.tab; paintTabs(); paintGrid(); return; }
      if (b.dataset.act === "run") { await post("/api/etsy/run"); msg(t("O Riddler começou a pesquisar. Demora uns minutos por desenho.")); return; }
      if (b.dataset.act === "toggle") { await post("/api/etsy/cfg", { on: !S.cfg.on }); return; }
      const id = b.closest("[data-id]") && b.closest("[data-id]").dataset.id;
      const it = S.items.find((i) => i.id === id);
      if (b.dataset.rewrite && it) { await post("/api/etsy/rewrite", { ids: [id] }); msg(t("O Joker está a reescrever o anúncio.")); return; }
      if (b.dataset.status && it) { await post(`/api/etsy/item/${encodeURIComponent(id)}`, { status: b.dataset.status }); return; }
      if (b.dataset.copy && it) {
        const v = b.dataset.copy === "tags" ? (it.tags || []).join(", ") : it[b.dataset.copy] || "";
        await navigator.clipboard.writeText(v);
        msg(t("Copiado."));
      }
    } catch (err) { msg(err.message); }
  }
})();
