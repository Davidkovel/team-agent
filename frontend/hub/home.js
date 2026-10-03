// Home: the command center. A grid of widgets the person arranges: drag to reorder, pull the corner to resize,
// hide and bring back. The layout is kept per person in this browser.

/* ---------- the widgets ----------
   Each one: a title, an icon, a default size (columns of 12 x rows), the live events that refresh it, where its
   "see all" goes, and load() -> html. Loading, empty and error states come from the system (mount, ui.empty, ui.error). */
const WIDGETS = {
  work: {
    title: "Trabalho em curso", icon: "tasks", w: 8, h: 2, href: "#/tarefas", on: ["task", "presence", "session"],
    async load() {
      const tasks = (await api("/api/tasks")).filter((x) => ["in_progress", "approval", "review", "blocked"].includes(x.stage));
      if (!tasks.length) return ui.empty("tasks", "Nada em curso", "Nenhuma tarefa está a ser trabalhada neste momento.",
        `<a class="btn sm" href="#/tarefas">${t("Abrir tarefas")}</a>`);
      return tasks.slice(0, 8).map((x) => `<a class="work" href="#/tarefas/${x.id}">
        <div class="work-top">${ui.avatar(nameOf(x.assignee), "sm")}<b>${esc(x.title)}</b>${ui.tag(t(STAGE_LABEL[x.stage]), STAGE_TONE[x.stage])}</div>
        ${ui.progress(x.progress, x.stage === "blocked" ? "bad" : x.stage === "in_progress" ? "ai" : "warn")}
        <div class="work-meta"><span class="ell grow">${esc(nameOf(x.assignee))}${x.project_name || x.project ? " · " + esc(x.project_name || x.project) : ""}${x.current_action ? " · " + esc(x.current_action) : ""}</span>
          <span class="pct">${x.progress}%</span></div></a>`).join("");
    },
  },
  attention: {
    title: "Precisa de ti", icon: "alert", w: 4, h: 2, on: ["task", "approval", "presence"],
    async load() {
      const items = await api("/api/attention");
      if (!items.length) return ui.empty("check", "Tudo em ordem", "Nada precisa da tua atenção agora.");
      return items.slice(0, 8).map((i) => `<a class="att ${i.severity}" href="${esc(i.href)}"><i></i>
        <div class="rw-main"><b>${esc(i.title)}</b><span>${esc(i.detail)}</span></div></a>`).join("");
    },
  },
  today: {
    title: "Hoje", icon: "calendar", w: 3, h: 1, href: "#/tarefas", on: ["task", "approval"], pad: true,
    async load() {
      const [tasks, pending] = await Promise.all([api("/api/tasks"), api("/api/approvals/pending-count")]);
      const today = new Date().toDateString();
      const done = tasks.filter((x) => x.status === "COMPLETED" && x.completed_at && new Date(x.completed_at).toDateString() === today).length;
      const active = tasks.filter((x) => x.stage === "in_progress").length;
      const open = tasks.filter((x) => x.stage !== "done").length;
      return `<div class="kpis">${[[open, "Abertas"], [done, "Concluídas"], [active, "Em curso"], [pending.pending, "Aprovações"]]
        .map(([n, label]) => `<div class="kpi"><b class="num sm">${n}</b><span>${t(label)}</span></div>`).join("")}</div>`;
    },
  },
  usage: {
    title: "Uso de IA · 7 dias", icon: "token", w: 3, h: 1, href: "#/uso", on: ["usage"], pad: true,
    async load() {
      const u = await api("/api/usage/summary");
      if (!u.runs) return `<div class="stat">${ui.num(null)}<small>${t("Ainda nenhuma sessão de IA registada.")}</small></div>`;
      return `<div class="stat"><div class="rowx">${ui.num(fmt.tokens(u.input_tokens + u.output_tokens))}${ui.src("live")}</div>
        <small>${t("tokens em {n} sessões", { n: u.runs })} · ${fmt.tokens(u.cache_read_tokens)} ${t("de cache")}</small></div>`;
    },
  },
  cost: {
    title: "Custo de IA · 7 dias", icon: "wallet", w: 3, h: 1, href: "#/analise", on: ["usage"], pad: true,
    async load() {
      const u = await api("/api/usage/summary");
      if (u.cost_usd == null) return `<div class="stat">${ui.num(null)}<small>${t("Sem sessões de IA neste período.")}</small></div>`;
      return `<div class="stat"><div class="rowx">${ui.num(fmt.usd(u.cost_usd))}${ui.src("estimated")}</div>
        <small>${t("estimativa do SDK do Claude, não é faturação")}</small></div>`;
    },
  },
  ponto: {
    title: "Ponto de hoje", icon: "clock", w: 3, h: 1, on: ["ponto"], pad: true,
    async load() {
      const board = await api("/api/ponto");
      const mine = board.people.find((p) => p.user === me.username);
      return `<div class="stat"><div class="rowx" style="flex-wrap:wrap;gap:6px">${board.people.map((p) =>
        `<span class="st ${p.at ? "ok" : "off"}" title="${p.at ? fmt.hhmm(p.at) : t("por bater")}"><i></i>${esc(p.name)}</span>`).join("")}</div>
        ${mine?.at ? `<small>${t("Bateste o ponto às {h}", { h: fmt.hhmm(mine.at) })}</small>`
          : `<button class="btn sm primary" data-punch style="align-self:flex-start">${t("Bater o ponto")}</button>`}</div>`;
    },
  },
  agents: {
    title: "IA ativa", icon: "bot", w: 4, h: 2, href: "#/agentes", on: ["presence", "session", "task"],
    async load() {
      const agents = (await api("/api/agents")).filter((a) => ["WORKING", "WAITING", "PAUSED", "ERROR"].includes(a.status));
      if (!agents.length) return ui.empty("bot", "Nenhum agente ativo", "Nenhum agente de IA está a trabalhar agora.",
        `<a class="btn sm" href="#/tarefas">${t("Entregar uma tarefa")}</a>`);
      return agents.map((a) => `<a class="work" href="#/agentes/${esc(a.id)}">
        <div class="work-top">${ui.avatar(a.display_name, "sm ai")}<b>${esc(a.name)}</b>${ui.status(a.status)}</div>
        <div class="work-meta"><span class="ell grow">${a.project ? esc(a.project) + " · " : ""}${esc(a.task || t("sem tarefa"))}</span></div>
        ${ui.progress(a.progress, "ai")}
        <div class="work-meta"><span class="mono">${a.session ? fmt.tokens(a.session.tokens.total) + " tokens" : "—"}</span>
          <span class="grow"></span><span>${a.started_at ? fmt.span(a.started_at) : ""}</span><span class="pct">${a.progress}%</span></div></a>`).join("");
    },
  },
  team: {
    title: "Equipa", icon: "users", w: 4, h: 2, href: "#/equipa", on: ["presence", "task"],
    async load() {
      const team = await api("/api/team");
      return `<div class="rows">${team.map((m) => `<a class="rw" href="#/agentes/${esc(m.user)}">${ui.avatar(m.display_name)}
        <div class="rw-main"><b>${esc(m.display_name)}</b><span>${esc(m.task || (m.status === "OFFLINE" ? t("visto {quando}", { quando: fmt.ago(m.last_seen) }) : t("sem tarefa")))}</span></div>
        ${ui.status(m.status)}</a>`).join("")}</div>`;
    },
  },
  approvals: {
    title: "Aprovações", icon: "check", w: 4, h: 2, href: "#/aprovacoes", on: ["approval"],
    async load() {
      const pending = (await api("/api/approvals")).filter((a) => a.status === "PENDING");
      if (!pending.length) return ui.empty("check", "Sem pedidos", "Nenhum agente está à espera de aprovação.");
      return pending.slice(0, 4).map((a) => `<div class="work">
        <div class="work-top"><b>${esc(a.action)}</b>${a.risk ? ui.tag(t("Risco") + " " + t({ low: "baixo", medium: "médio", high: "alto" }[a.risk]), a.risk) : ""}</div>
        <div class="work-meta"><span class="ell grow">Claude / ${esc(a.user_name)}${a.detail ? " · " + esc(a.detail) : ""}</span></div>
        ${me.lead ? `<div class="rowx"><button class="btn sm ok" data-decide="${a.id}" data-approve="1">${t("Aprovar")}</button>
          <button class="btn sm danger" data-decide="${a.id}" data-approve="0">${t("Recusar")}</button></div>` : ""}</div>`).join("");
    },
  },
  activity: {
    title: "Atividade ao vivo", icon: "pulse", w: 8, h: 2, href: "#/aovivo", on: ["activity", "task", "approval"],
    async load() {
      const items = await api("/api/history?limit=14");
      if (!items.length) return ui.empty("pulse", "Sem atividade", "Ainda não aconteceu nada hoje.");
      return `<div class="tl" style="padding:4px 0">${ui.feed(items.map((a) => activityItem(a)))}</div>`;
    },
  },
  completed: {
    title: "Concluídas", icon: "check", w: 4, h: 2, href: "#/tarefas", on: ["task"],
    async load() {
      const done = (await api("/api/tasks")).filter((x) => x.status === "COMPLETED" && x.completed_at)
        .sort((a, b) => b.completed_at.localeCompare(a.completed_at)).slice(0, 7);
      if (!done.length) return ui.empty("check", "Nada concluído", "As tarefas concluídas aparecem aqui.");
      return `<div class="rows">${done.map((x) => `<a class="rw" href="#/tarefas/${x.id}"><span class="st ok"><i></i></span>
        <div class="rw-main"><b>${esc(x.title)}</b><span>${esc(nameOf(x.assignee))} · ${fmt.day(x.completed_at)} ${fmt.hhmm(x.completed_at)}</span></div></a>`).join("")}</div>`;
    },
  },
  companies: {
    title: "Empresas", icon: "building", w: 4, h: 1, href: "#/empresas", on: [],
    async load() {
      if (!companies.length) return ui.empty("building", "Sem empresas", "Ainda não há empresas na biblioteca.");
      return `<div class="rows">${companies.map((c) => `<a class="rw" href="#/empresas/${esc(c.id)}"><span class="av">${esc(c.short || c.name[0])}</span>
        <div class="rw-main"><b>${esc(c.name)}</b><span>${esc(c.tagline || "")}</span></div></a>`).join("")}</div>`;
    },
  },
};
const DEFAULT_LAYOUT = ["work", "attention", "today", "usage", "cost", "ponto", "agents", "team", "approvals", "activity", "completed", "companies"];

/* ---------- the layout: order, size and visibility, kept per person ---------- */
const layoutKey = () => `hub.home.${me.username}`;
function loadLayout() {
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem(layoutKey())) || []; } catch { /* a broken entry is the same as none */ }
  const known = saved.filter((item) => WIDGETS[item.id]);
  const missing = DEFAULT_LAYOUT.filter((id) => !known.some((item) => item.id === id)); // widgets added since it was saved
  return [...known, ...missing.map((id) => ({ id, w: WIDGETS[id].w, h: WIDGETS[id].h, hidden: false }))];
}
let layout = [];
const saveLayout = () => localStorage.setItem(layoutKey(), JSON.stringify(layout));
function setDensity(value) {
  localStorage.setItem("hub.density", value);
  document.documentElement.dataset.density = value;
}

function widgetHtml(item) {
  const w = WIDGETS[item.id];
  return `<section class="wg" data-id="${item.id}" style="grid-column: span ${item.w}; grid-row: span ${item.h}; --w: ${item.w}">
    <header class="wg-head" draggable="true">${icon(w.icon)}<b>${esc(t(w.title))}</b>
      <div class="wg-tools">${w.href ? `<a href="${w.href}" title="${t("Ver tudo")}">${icon("arrow")}</a>` : ""}
        <button data-hide title="${t("Esconder")}">${icon("x")}</button></div></header>
    <div class="wg-body ${w.pad ? "pad" : ""}" id="wg-${item.id}"></div><span class="wg-grip" title="${t("Redimensionar")}"></span></section>`;
}
const loadWidget = (id) => mount($(`wg-${id}`), WIDGETS[id].load, WIDGETS[id].h > 1 ? 4 : 2);
function drawGrid() {
  const grid = $("wgrid");
  if (!grid) return;
  const shown = layout.filter((item) => !item.hidden);
  grid.innerHTML = shown.length ? shown.map(widgetHtml).join("")
    : `<div class="panel" style="grid-column:1/-1;grid-row:span 2">${ui.empty("sliders", "Sem widgets", "Escondeste todos os widgets.", `<button class="btn sm" data-customize>${t("Personalizar")}</button>`)}</div>`;
  shown.forEach((item) => loadWidget(item.id));
}

/* ---------- drag to reorder, corner to resize ---------- */
function wireGrid(grid) {
  let dragged = null;
  grid.addEventListener("dragstart", (e) => {
    const head = e.target.closest(".wg-head");
    if (!head) return;
    dragged = head.parentElement;
    dragged.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", dragged.dataset.id);
  });
  grid.addEventListener("dragover", (e) => {
    const over = e.target.closest(".wg");
    if (!dragged || !over || over === dragged) return;
    e.preventDefault();
    grid.querySelectorAll(".wg.over").forEach((el) => el !== over && el.classList.remove("over"));
    over.classList.add("over");
  });
  grid.addEventListener("dragleave", (e) => e.target.closest?.(".wg")?.classList.remove("over"));
  grid.addEventListener("drop", (e) => {
    const over = e.target.closest(".wg");
    if (!dragged || !over || over === dragged) return;
    e.preventDefault();
    const nodes = [...grid.children];
    over.classList.remove("over");
    grid.insertBefore(dragged, nodes.indexOf(dragged) < nodes.indexOf(over) ? over.nextSibling : over);
    const order = [...grid.children].map((el) => el.dataset.id);
    layout = [...order.map((id) => layout.find((item) => item.id === id)), ...layout.filter((item) => item.hidden)];
    saveLayout();
  });
  grid.addEventListener("dragend", () => { dragged?.classList.remove("dragging"); grid.querySelectorAll(".wg.over").forEach((el) => el.classList.remove("over")); dragged = null; });

  grid.addEventListener("pointerdown", (e) => {
    if (!e.target.classList.contains("wg-grip")) return;
    e.preventDefault();
    const el = e.target.parentElement, item = layout.find((x) => x.id === el.dataset.id);
    const gap = 12, columns = getComputedStyle(grid).gridTemplateColumns.split(" ").length;
    const col = (grid.clientWidth - gap * (columns - 1)) / columns + gap;
    const row = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--row")) + gap;
    const box = el.getBoundingClientRect(), start = { x: e.clientX, y: e.clientY };
    el.classList.add("resizing");
    e.target.setPointerCapture(e.pointerId);
    const move = (ev) => {
      item.w = Math.max(2, Math.min(columns, Math.round((box.width + ev.clientX - start.x + gap) / col)));
      item.h = Math.max(1, Math.min(4, Math.round((box.height + ev.clientY - start.y + gap) / row)));
      el.style.gridColumn = `span ${item.w}`; el.style.gridRow = `span ${item.h}`; el.style.setProperty("--w", item.w);
    };
    const up = () => { el.classList.remove("resizing"); e.target.removeEventListener("pointermove", move); saveLayout(); };
    e.target.addEventListener("pointermove", move);
    e.target.addEventListener("pointerup", up, { once: true });
    e.target.addEventListener("pointercancel", up, { once: true });
  });

  grid.addEventListener("click", async (e) => {
    const hide = e.target.closest("[data-hide]"), decide = e.target.closest("[data-decide]");
    if (hide) {
      layout.find((x) => x.id === hide.closest(".wg").dataset.id).hidden = true;
      saveLayout(); drawGrid();
    } else if (decide) {
      decide.disabled = true;
      try { await api(`/api/approvals/${decide.dataset.decide}/decide`, { method: "POST", body: { approve: decide.dataset.approve === "1" } }); }
      catch (err) { flash(err.message); }
      loadWidget("approvals");
    } else if (e.target.closest("[data-punch]")) {
      try { await api("/api/ponto", { method: "POST" }); flash(t("Ponto batido. A equipa já sabe.")); } catch (err) { flash(err.message); }
      loadWidget("ponto");
    } else if (e.target.closest("[data-customize]")) customizeHome();
  });
}

function customizeHome() {
  const density = localStorage.getItem("hub.density") || "normal";
  openModal(`<h3>${t("Personalizar o Início")}</h3>
    ${ui.sec("Widgets visíveis")}
    <div class="custom">${layout.map((item) => `<label><input type="checkbox" data-w="${item.id}" ${item.hidden ? "" : "checked"}>${esc(t(WIDGETS[item.id].title))}</label>`).join("")}</div>
    ${ui.sec("Densidade")}
    <div class="segx" id="density">${[["compact", "Compacta"], ["normal", "Normal"], ["expanded", "Ampla"]].map(([v, l]) => `<button data-d="${v}" class="${v === density ? "on" : ""}">${t(l)}</button>`).join("")}</div>
    <p class="dim" style="margin:14px 0 0">${t("Arrasta um widget pelo título para o mudar de sítio. Puxa o canto inferior direito para lhe mudar o tamanho.")}</p>
    <div class="form-foot"><button class="btn quiet" id="reset-layout" style="margin-right:auto">${t("Repor a disposição original")}</button><button class="btn primary" data-close>${t("Feito")}</button></div>`);
  $("modal-box").onchange = (e) => {
    if (!e.target.dataset.w) return;
    layout.find((x) => x.id === e.target.dataset.w).hidden = !e.target.checked;
    saveLayout(); drawGrid();
  };
  $("density").onclick = (e) => {
    if (!e.target.dataset.d) return;
    setDensity(e.target.dataset.d);
    $("density").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === e.target));
  };
  $("reset-layout").onclick = () => { localStorage.removeItem(layoutKey()); layout = loadLayout(); drawGrid(); closeModal(); };
}

HUB_VIEWS.home = async function viewHome() {
  const hour = new Date().getHours();
  const greeting = hour < 6 ? "Boa noite" : hour < 13 ? "Bom dia" : hour < 20 ? "Boa tarde" : "Boa noite";
  const date = new Date().toLocaleDateString("pt-PT", { weekday: "long", day: "numeric", month: "long" });
  layout = loadLayout();
  $("view").innerHTML = `<div class="page">${ui.head("Centro de comando", `${t(greeting)}, ${me.display_name}`, date[0].toUpperCase() + date.slice(1),
    ui.btn("Nova tarefa", 'data-new-task', "", "plus") + ui.btn("Personalizar", "id=\"customize\"", "quiet", "sliders"))}
    <div class="wgrid" id="wgrid"></div></div>`;
  $("customize").onclick = customizeHome;
  $("view").querySelector("[data-new-task]").onclick = () => newTask();
  wireGrid($("wgrid"));
  drawGrid();
};

// A live event reloads only the widgets that show that kind of thing ("tick" is the slow safety net: all of them).
const reloadWidgets = async (type) => {
  if (!$("wgrid")) return;
  layout.filter((item) => !item.hidden && (type === "tick" || WIDGETS[item.id].on.includes(type))).forEach((item) => loadWidget(item.id));
};
["presence", "task", "approval", "activity", "usage", "ponto", "session", "tick"].forEach((type) => onLive([type], () => reloadWidgets(type)));
