// Fábrica Etsy (#/etsy): a Pesquisa procura o que vende, o Design desenha, o Marketing escreve o anúncio e a Revisão barra
// as marcas (backend/app/etsy.py). A pessoa aprova, copia para a Etsy e regista as vendas: o dinheiro é só o real.
// A página segue docs/hub-paginas.md: cabeçalho com o estado e o botão principal, os números, depois uma secção por ideia
// (a linha de montagem, os desenhos, as vendas e os lotes, como começar e o horário).
(function () {
  let S = null, timer = 0, filter = "new";
  const eur = (v) => Number(v || 0).toLocaleString("pt-PT", { style: "currency", currency: "EUR" });
  const when = (ts) => new Date(ts * 1000).toLocaleString("pt-PT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const img = (id, name = "design.png") => `/api/etsy/file/${encodeURIComponent(id)}/${name}?token=${encodeURIComponent(token)}`;
  const CREW = [
    ["riddler", "Pesquisa", "PES", "Procura na web o que está a vender na Etsy e o que vai vender nas próximas semanas."],
    ["catwoman", "Design", "DSG", "Desenha cada ideia em vetor e passa-a a PNG 4500 × 5400, o tamanho da Printify."],
    ["joker", "Marketing", "MKT", "Escreve o título, as 13 tags, a descrição e o preço com margem."],
    ["alfred", "Revisão", "REV", "Barra marcas, personagens e anúncios incompletos antes de chegarem a ti."],
  ];
  // a cor da peça por baixo da estampa, para se ver como fica (a 1.ª cor conhecida que a Pesquisa escreveu)
  const COLORS = [[/black|pret/i, "#141518"], [/navy|marinho/i, "#1c2541"], [/burgundy|bord|maroon|vinho/i, "#5a1424"],
    [/forest|verde/i, "#23402f"], [/charcoal|antracite|carv/i, "#36393f"], [/heather|grey|gray|cinz/i, "#a3a6ab"],
    [/sand|areia|beige|bege/i, "#dccbaa"], [/cream|creme|natural|ivory/i, "#efe6d2"], [/pink|rosa/i, "#f2c6cf"], [/red|vermelh/i, "#a3162a"],
    [/blue|azul/i, "#7d9cc4"], [/white|branc/i, "#f7f7f5"]];
  const garment = (c) => (COLORS.find(([re]) => re.test(c || "")) || [0, "#f3efe8"])[1];
  const TABS = [["new", "Para aprovar"], ["approved", "Aprovados"], ["published", "Na Etsy"], ["blocked", "Barrados"], ["rejected", "Recusados"]];
  const REASON = { "à mão": "À mão", agenda: "Pelo horário" };
  // o que se diz quando um separador está vazio (o primeiro lote tem o seu próprio vazio, com o botão)
  const NONE = {
    new: "Nada para aprovar. Carrega em «Fazer um lote agora» para mais desenhos.",
    approved: "Nenhum desenho aprovado à espera. Aprova os que gostares em «Para aprovar».",
    published: "Ainda nada na Etsy. Quando puseres um aprovado na loja, marca-o com «Já está na Etsy».",
    blocked: "A Revisão não barrou nenhum desenho.",
    rejected: "Nenhum desenho recusado.",
  };

  HUB_VIEWS.etsy = async function () {
    clearInterval(timer);
    page(`<div class="ey" id="ey">
      ${ui.head("Negócios", t("Fábrica Etsy"), t("Os agentes descobrem o que vende, desenham e escrevem o anúncio; tu aprovas e pões na Etsy. Nada é publicado sem ti."),
        `<div class="ey-ctl" id="ey-ctl"></div>`)}
      <div id="ey-body">
        <section class="ey-kpis" id="ey-kpis">${ui.skeleton(2)}</section>
        <div id="ey-line-sec"></div>
        <section id="ey-line"></section>
        ${ui.sec("Desenhos", `<span class="ey-aside" id="ey-made"></span>`)}
        <nav class="chipbar ey-tabs" id="ey-tabs"></nav>
        <section class="ey-grid" id="ey-grid"></section>
        <div class="ey-two">
          <div class="ey-col">${ui.sec("Vendas", `<span class="ey-aside">${esc(t("só o que registas"))}</span>`)}
            <section class="panel pad ey-sales">
              <form class="ey-sale" data-form="sale" autocomplete="off">
                <div class="ey-q"><b>${esc(t("Entrou uma venda na Etsy?"))}</b>
                  <span>${esc(t("Escreve o valor que a Etsy te pagou. É este o dinheiro que a fábrica mostra."))}</span></div>
                <div class="ey-sale-row">
                  <label class="field ey-amount">${esc(t("Valor (€)"))}<input name="amount" type="number" inputmode="decimal" step="0.01" min="0.01" placeholder="0,00" required></label>
                  <label class="field ey-note">${esc(t("O que vendeste (opcional)"))}<input name="note" maxlength="200" placeholder="${esc(t("ex.: t-shirt preta"))}"></label>
                  <button class="btn ey-save">${esc(t("Registar venda"))}</button>
                </div>
              </form>
              <div id="ey-sales"></div>
            </section></div>
          <div class="ey-col">${ui.sec("Lotes", `<span class="ey-aside">${esc(t("custo estimado pelo Claude, do teu plano"))}</span>`)}
            <section class="panel ey-runs" id="ey-runs"></section></div>
        </div>
        <div class="ey-two">
          <div class="ey-col">${ui.sec("Para começar a vender")}<section class="panel pad" id="ey-start"></section></div>
          <div class="ey-col">${ui.sec("Horário")}<section class="panel pad" id="ey-cfg"></section></div>
        </div>
      </div>
    </div>`);
    $("ey").onclick = click;
    $("ey").onsubmit = submit;
    try {
      await load();
    } catch (e) {
      if (e.message === "unauthorized" || !$("ey-body")) return;
      $("ey-body").innerHTML = ui.error(e.message);
      $("ey-body").querySelector("[data-retry]").onclick = () => HUB_VIEWS.etsy();
      return;
    }
    timer = setInterval(() => { if (!$("ey")) { clearInterval(timer); return; } if (!document.hidden) load().catch(() => {}); }, 5000);
  };

  async function load() {
    S = await api("/api/etsy");
    paintAll();
  }

  function paintAll() {
    if (!$("ey-body")) return;
    paintCtl(); paintKpis(); paintLine(); paintTabs(); paintGrid(); paintSales(); paintRuns(); paintStart(); paintCfg();
  }

  async function post(path, body) {
    S = await api(path, { method: "POST", body: body || {} });
    paintAll();
  }

  // o estado da fábrica ao lado dos botões: a trabalhar, ligada ao horário ou desligada
  function paintCtl() {
    const c = S.cfg;
    const [tone, label] = S.running ? ["busy", t("A trabalhar")] : c.on ? ["ok", t("Ligada · todos os dias às {h}h", { h: c.hour })] : ["off", t("Desligada")];
    paint($("ey-ctl"), `<span class="ey-state st ${tone}"><i></i>${esc(label)}</span>
      <button type="button" class="btn" data-act="toggle">${esc(c.on ? t("Desligar o horário") : t("Ligar todos os dias"))}</button>
      <button type="button" class="btn primary" data-act="run" ${S.running || !S.installed ? "disabled" : ""}>${icon("play")}${esc(t("Fazer um lote agora"))}</button>`);
  }

  // os números de cima; carregar num deles mostra esses desenhos
  function paintKpis() {
    const n = S.counts, sales = S.sales.length;
    const kpi = (label, value, sub, tab = "", tone = "") => `<div class="panel bd-kpi ey-kpi ${tab ? "hover" : ""} ${tone}" ${tab ? `data-tab="${tab}"` : ""}>
      <span class="bd-l">${esc(t(label))}</span>${ui.num(value)}<small>${esc(sub)}</small></div>`;
    paint($("ey-kpis"), [
      kpi("Vendas registadas", eur(S.revenue), sales ? t(sales === 1 ? "1 venda" : "{n} vendas", { n: sales }) : t("Ainda nenhuma venda registada"), "", S.revenue > 0 ? "money" : ""),
      kpi("Para aprovar", n.new, n.new ? t("à espera da tua decisão") : t("nada à tua espera"), "new"),
      kpi("Prontos a publicar", n.approved, t("aprovados, por pôr na Etsy"), "approved"),
      kpi("Na Etsy", n.published, t("anúncios na loja"), "published"),
    ].join(""));
  }

  // a linha de montagem: quem está a trabalhar agora, e o que cada um faz
  function paintLine() {
    const who = S.stage && S.stage.who, c = S.cfg;
    paint($("ey-line-sec"), ui.sec("Linha de montagem", S.running
      ? `<span class="st busy"><i></i>${esc(t("Lote a correr"))}</span>`
      : `<span class="ey-aside">${esc(t("{n} desenhos por lote · modelo {m}", { n: c.per_run, m: c.model }))}</span>`));
    const warn = [
      S.installed ? "" : t("O Claude Code não está instalado neste PC: sem ele os agentes não trabalham."),
      S.chrome ? "" : t("Falta o Google Chrome neste PC: é ele que passa os desenhos a PNG."),
    ].filter(Boolean);
    paint($("ey-line"), `<div class="ey-line">${CREW.map(([id, name, role, what], i) => {
      const live = who === id;
      return `<div class="panel ey-agent ${live ? "live" : ""}">
        <header><span class="ey-step">${i + 1}</span><b>${esc(name)}</b><small>${esc(t(role))}</small></header>
        <p>${esc(live ? S.stage.what : t(what))}</p>${live ? `<span class="st busy"><i></i>${esc(t("A trabalhar"))}</span>` : ""}</div>`;
    }).join("")}</div>`
      + warn.map((w) => `<p class="ey-note warn">${icon("alert")}<span>${esc(w)}</span></p>`).join("")
      + (S.error ? `<p class="ey-note bad">${icon("alert")}<span>${esc(t("Último erro"))}: ${esc(S.error)}</span></p>` : ""));
  }

  function paintTabs() {
    paint($("ey-made"), S.items.length ? esc(t(S.items.length === 1 ? "1 desenho feito" : "{n} desenhos feitos", { n: S.items.length })) : "");
    paint($("ey-tabs"), TABS.map(([k, l]) => `<button type="button" class="chp ${filter === k ? "on" : ""}" data-tab="${k}">${esc(t(l))}<i>${S.counts[k] || 0}</i></button>`).join(""));
  }

  function paintGrid() {
    const items = S.items.filter((i) => i.status === filter);
    if (items.length) { paint($("ey-grid"), items.map(card).join("")); return; }
    let html;
    if (S.running && filter === "new") {
      html = ui.empty("spark", "Os agentes estão a trabalhar", "Os desenhos aparecem aqui assim que ficarem prontos. Demora uns minutos por desenho.");
    } else if (!S.items.length) {
      // a primeira vez: o que fazer primeiro, num clique
      html = ui.empty("spark", "Ainda não há desenhos", t("Começa por um lote: a Pesquisa procura o que está a vender, o Design desenha {n} estampas e o Marketing escreve os anúncios. Uns minutos por desenho, e nada vai para a Etsy sem ti.", { n: S.cfg.per_run }),
        `<button type="button" class="btn" data-act="run" ${!S.installed ? "disabled" : ""}>${esc(t("Fazer o primeiro lote"))}</button>`);
    } else {
      html = ui.empty(filter === "blocked" ? "flag" : "inbox", TABS.find(([k]) => k === filter)[1], NONE[filter]);
    }
    paint($("ey-grid"), `<div class="panel ey-empty">${html}</div>`);
  }

  function card(i) {
    const btns = {
      new: [["approved", "Aprovar", "primary"], ["rejected", "Recusar", ""]],
      approved: [["published", "Já está na Etsy", "primary"], ["new", "Voltar atrás", ""]],
      published: [["approved", "Tirar da Etsy", ""]],
      rejected: [["new", "Repor", ""]],
      blocked: [],
    }[i.status] || [];
    const kind = [i.nicho, i.produto || "t-shirt", i.cor_peca].filter(Boolean).join(" · ");
    return `<article class="panel ey-item" data-id="${esc(i.id)}">
      <div class="ey-shot" style="background:${garment(i.cor_peca)}"><img loading="lazy" src="${img(i.id)}" alt=""></div>
      <div class="ey-top">
        <small class="ey-kind">${esc(kind)}</small>
        <h3>${esc(i.titulo || i.frase)}</h3>
        <div class="ey-meta"><b>${eur(i.preco)}</b>${i.printify ? `<span>${esc(i.printify)}</span>` : ""}</div>
      </div>
      <div class="ey-rest">
        ${i.blocked ? `<p class="ey-note bad">${icon("alert")}<span>${esc(i.blocked)}</span></p>` : ""}
        ${i.porque ? `<p class="ey-why"><b>${esc(t("Porque vende"))}</b> ${esc(i.porque)}</p>` : ""}
        ${(i.tags || []).length ? `<div class="ey-tags">${i.tags.map((g) => `<span>${esc(g)}</span>`).join("")}</div>` : ""}
        <details><summary>${esc(t("Descrição e fontes"))}</summary><p class="ey-desc">${esc(i.descricao || "")}</p>
          ${(i.fontes || []).map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u.replace(/^https?:\/\/(www\.)?/, "").slice(0, 60))}</a>`).join("")}</details>
        <div class="ey-acts">
          ${btns.map(([s, l, k]) => `<button type="button" class="btn sm ${k}" data-status="${s}">${esc(t(l))}</button>`).join("")}
          <button type="button" class="btn sm quiet" data-rewrite="1" ${S.running ? "disabled" : ""}>${esc(t("Reescrever anúncio"))}</button>
        </div>
        <div class="ey-copy"><span>${esc(t("Copiar"))}</span>
          <button type="button" class="btn sm quiet" data-copy="titulo">${esc(t("Título"))}</button>
          <button type="button" class="btn sm quiet" data-copy="tags">${esc(t("Tags"))}</button>
          <button type="button" class="btn sm quiet" data-copy="descricao">${esc(t("Descrição"))}</button>
          <a class="btn sm quiet" href="${img(i.id)}" download="${esc((i.frase || "design").replace(/[^\w]+/g, "-").slice(0, 40))}.png">${esc(t("PNG para a Printify"))}</a>
        </div>
      </div>
    </article>`;
  }

  // as últimas vendas registadas, por baixo do formulário (o formulário nunca é redesenhado: não se perde o que se escreve)
  function paintSales() {
    const last = S.sales.slice(0, 5);
    paint($("ey-sales"), last.length ? `<div class="ey-sold">${last.map((s) => `<div><time>${when(s.at)}</time><span class="ell">${esc(s.note || t("Venda"))}</span><b>${eur(s.amount)}</b></div>`).join("")}
      ${S.sales.length > last.length ? `<p class="ey-more">${esc(t("e mais {n}", { n: S.sales.length - last.length }))}</p>` : ""}</div>` : "");
  }

  function paintRuns() {
    paint($("ey-runs"), S.runs.length
      ? `<table class="tbl ey-table"><thead><tr><th>${esc(t("Quando"))}</th><th>${esc(t("Como"))}</th><th class="r">${esc(t("Desenhos"))}</th><th class="r">${esc(t("Custo"))}</th></tr></thead>
        <tbody>${S.runs.map((r) => `<tr class="${r.error ? "has-err" : ""}"><td>${when(r.at)}</td><td>${esc(t(REASON[r.reason] || r.reason))}</td>
          <td class="r">${r.made}</td><td class="r">${r.cost ? "$" + r.cost.toFixed(2) : "—"}</td></tr>
          ${r.error ? `<tr class="ey-run-err"><td colspan="4">${icon("alert")}${esc(r.error)}</td></tr>` : ""}`).join("")}</tbody></table>`
      : ui.empty("clock", "Ainda nenhum lote", "Cada lote aparece aqui com quantos desenhos fez e quanto custou."));
  }

  function paintStart() {
    const link = (href, text) => `<a href="${href}" target="_blank" rel="noopener">${esc(text)}</a>`;
    paint($("ey-start"), `<ol class="ey-steps">
        <li><b>${esc(t("Abre a loja"))}</b><span>${t("Em {l}, em teu nome. A Etsy pede cartão e conta bancária.", { l: link("https://www.etsy.com/sell", "etsy.com/sell") })}</span></li>
        <li><b>${esc(t("Liga a Printify"))}</b><span>${t("Cria conta em {l} e liga-a à loja (My Stores → Etsy).", { l: link("https://printify.com", "printify.com") })}</span></li>
        <li><b>${esc(t("Publica os aprovados"))}</b><span>${esc(t("Na Printify: novo produto, carrega o PNG, cola o título, as tags e a descrição, e publica."))}</span></li>
        <li><b>${esc(t("Regista as vendas"))}</b><span>${esc(t("Marca «Já está na Etsy» e regista cada venda aqui: é esse o dinheiro que a fábrica mostra."))}</span></li>
      </ol>`);
  }

  function paintCfg() {
    const c = S.cfg;
    const who = c.owner ? nameOf(c.owner) || c.owner : "";
    const line = c.on ? t("Ligada: faz um lote por dia às {h}h neste PC.", { h: c.hour }) + (who ? " " + t("Os avisos vão para {w}.", { w: who }) : "")
      : t("Desligada: os lotes só começam quando carregas em «Fazer um lote agora».");
    paint($("ey-cfg"), `<p class="ey-cfg-state"><span class="st ${c.on ? "ok" : "off"}"><i></i></span>${esc(line)}</p>
      <form class="ey-cfg" data-form="cfg">
        <label class="field">${esc(t("Hora"))}<input name="hour" type="number" min="0" max="23" value="${c.hour}"></label>
        <label class="field">${esc(t("Desenhos por lote"))}<input name="per_run" type="number" min="1" max="8" value="${c.per_run}"></label>
        <label class="field">${esc(t("Modelo"))}<select name="model">${["haiku", "sonnet", "opus"].map((m) => `<option ${m === c.model ? "selected" : ""}>${m}</option>`).join("")}</select></label>
        <button class="btn">${esc(t("Guardar"))}</button>
      </form>`);
  }

  async function submit(e) {
    const form = e.target.closest("form[data-form]");
    if (!form) return;
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    const btn = form.querySelector("button");
    btn.disabled = true;
    try {
      if (form.dataset.form === "sale") {
        await post("/api/etsy/sale", { amount: Number(f.amount), note: f.note });
        form.reset();
        flash(t("Venda registada."));
      } else {
        await post("/api/etsy/cfg", { hour: Number(f.hour), per_run: Number(f.per_run), model: f.model });
        flash(t("Guardado."));
      }
    } catch (err) { flash(err.message); }
    btn.disabled = false;
  }

  async function click(e) {
    const b = e.target.closest("button, [data-tab]");
    if (!b || b.type === "submit" && b.closest("form[data-form]")) return;
    try {
      if (b.dataset.tab) {
        filter = b.dataset.tab; paintTabs(); paintGrid();
        if (b.classList.contains("ey-kpi")) $("ey-tabs").scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      if (b.dataset.act === "run") { b.disabled = true; await post("/api/etsy/run"); flash(t("A Pesquisa começou. Demora uns minutos por desenho.")); return; }
      if (b.dataset.act === "toggle") { await post("/api/etsy/cfg", { on: !S.cfg.on }); return; }
      const id = b.closest("[data-id]") && b.closest("[data-id]").dataset.id;
      const it = S.items.find((i) => i.id === id);
      if (b.dataset.rewrite && it) { await post("/api/etsy/rewrite", { ids: [id] }); flash(t("O Marketing está a reescrever o anúncio.")); return; }
      if (b.dataset.status && it) { await post(`/api/etsy/item/${encodeURIComponent(id)}`, { status: b.dataset.status }); return; }
      if (b.dataset.copy && it) {
        const v = b.dataset.copy === "tags" ? (it.tags || []).join(", ") : it[b.dataset.copy] || "";
        await navigator.clipboard.writeText(v);
        flash(t("Copiado."));
      }
    } catch (err) { flash(err.message); if (b.dataset.act === "run") b.disabled = !S.installed || S.running; }
  }
})();
