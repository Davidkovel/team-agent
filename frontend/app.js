// Agente AMG: REST for data, WebSocket events as "something changed" hints.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const time = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "");
const dayLabel = (iso) => {
  const d = new Date(iso), t = new Date(), y = new Date(Date.now() - 864e5);
  if (d.toDateString() === t.toDateString()) return "Hoje";
  if (d.toDateString() === y.toDateString()) return "Ontem";
  return d.toLocaleDateString("pt-PT", { weekday: "long", day: "numeric", month: "long" });
};
const size = (b) => (b > 1e6 ? (b / 1e6).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1e3)) + " KB");
const initial = (name) => esc((name || "?").trim()[0]?.toUpperCase());

const ICONS = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/>',
  building: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2"/>',
  tasks: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 12l3 3 5-6"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><circle cx="17.5" cy="9" r="2.5"/><path d="M17 14c2.8.2 4.5 2 4.5 5"/>',
  history: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  tema: '<path d="M12 3a9 9 0 100 18c1.5 0 2-1 1.5-2-.6-1.2.2-2.5 1.6-2.5H17a4 4 0 004-4c0-5-4-9.5-9-9.5z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7.5" r="1"/>',
  skills: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  plugins: '<path d="M10 4a2 2 0 114 0v2h4v4h-2a2 2 0 100 4h2v4h-4v-2a2 2 0 10-4 0v2H6v-4H4a2 2 0 110-4h2V6h4z"/>',
  videos: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
  fotos: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5-5-8 8"/>',
  docs: '<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3"/>',
};
const icon = (name) => `<svg class="i" viewBox="0 0 24 24">${ICONS[name] || ICONS.building}</svg>`;
const meterClass = (pct) => (pct >= 85 ? "bad" : pct >= 60 ? "warn" : "");
const meter = (title, pct, hint = "") => `
  <div class="meter"><div class="row"><span>${esc(title)}${hint ? ` · ${esc(hint)}` : ""}</span><b>${pct == null ? "—" : pct + "%"}</b></div>
  <div class="track"><i class="${meterClass(pct)}" style="width:${pct ?? 0}%"></i></div></div>`;

const handoff = location.hash.match(/^#login=(.+)$/); // opened from the widget: already signed in
if (handoff) {
  sessionStorage.setItem("token", handoff[1]);
  history.replaceState(null, "", location.pathname + "#/home");
}
let token = sessionStorage.getItem("token");
let me = null;
let companies = [];
let openTask = null;
let historyFilter = "";

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 401) { logout(); throw new Error("unauthorized"); }
  if (!res.ok) {
    const detail = (await res.json().catch(() => ({}))).detail;
    throw new Error(typeof detail === "string" ? detail : res.statusText);
  }
  return res.json();
}

function logout() {
  sessionStorage.removeItem("token");
  token = null;
  $("app").hidden = true;
  $("login").hidden = false;
}

$("login-form").onsubmit = async (e) => {
  e.preventDefault();
  const res = await fetch("/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: $("username").value, password: $("password").value }),
  });
  if (!res.ok) { $("login-error").textContent = "Utilizador ou palavra-passe errados"; return; }
  token = (await res.json()).token;
  sessionStorage.setItem("token", token);
  start();
};
$("logout").onclick = logout;
$("maximize").onclick = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen());

/* ---------- modal ---------- */
function openModal(html) { $("modal-box").innerHTML = html; $("modal").hidden = false; }
function closeModal() { $("modal").hidden = true; $("modal-box").innerHTML = ""; }
$("modal").onclick = (e) => { if (e.target === $("modal") || e.target.dataset.close !== undefined) closeModal(); };
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

/* ---------- routing ---------- */
const TABS = [["home", "Início", "home"], ["empresas", "Empresas", "building"], ["tarefas", "Tarefas", "tasks"], ["equipa", "Equipa", "users"], ["historico", "Histórico", "history"]];

function route() {
  const hash = location.hash;
  const linked = hash.match(/^#task-(\d+)$/); // "Open Task" from the widget
  if (linked) { openTask = Number(linked[1]); return { tab: "tarefas" }; }
  const [, tab = "home", company, section] = hash.replace(/^#/, "").split("/");
  return { tab: TABS.some(([id]) => id === tab) ? tab : "home", company, section };
}

function render() {
  const r = route();
  $("tabs").innerHTML = TABS.map(([id, label, ic]) => `<a class="tab ${id === r.tab ? "active" : ""}" href="#/${id}">${icon(ic)}${label}</a>`).join("");
  const views = { home: viewHome, empresas: viewCompanies, tarefas: viewTasks, equipa: viewTeam, historico: viewHistory };
  views[r.tab](r).catch((e) => { if (e.message !== "unauthorized") $("view").innerHTML = `<p class="error">${esc(e.message)}</p>`; });
}
window.addEventListener("hashchange", render);

/* ---------- shared loaders (each only runs if its element is on screen) ---------- */
async function loadStats() {
  const [team, tasks, approvals] = await Promise.all([api("/api/team"), api("/api/tasks"), api("/api/approvals")]);
  if (!$("tiles")) return;
  const online = team.filter((m) => m.status !== "OFFLINE").length;
  const active = tasks.filter((t) => ["IN_PROGRESS", "WAITING_APPROVAL", "PAUSED", "NEEDS_HELP"].includes(t.status)).length;
  const pending = approvals.filter((a) => a.status === "PENDING").length;
  $("tiles").innerHTML = [[`${online}/${team.length}`, "agentes online"], [active, "tarefas ativas"], [pending, "aprovações"], [companies.length, "empresas"]]
    .map(([n, label]) => `<div class="tile"><b>${n}</b><span>${label}</span></div>`).join("");
}

async function loadMeters() {
  if (!$("meters")) return;
  const team = await api("/api/team");
  $("meters").innerHTML = team.map((m) => `
    <div class="card">
      <div class="person"><span class="avatar">${initial(m.display_name)}</span><div><b>${esc(m.display_name)}</b><div class="muted">${esc(m.role)}</div></div></div>
      ${meter("Claude esta semana", m.week_pct, `$${m.week_cost_usd} de $${m.week_budget_usd}`)}
      ${meter("Higgsfield", m.higgsfield_pct, m.higgsfield_pct == null ? "por definir" : "")}
    </div>`).join("");
}

async function loadTeam() {
  if (!$("team")) return;
  const team = await api("/api/team");
  $("team").innerHTML = team.map((m) => `
    <div class="card">
      <b>${esc(m.display_name)}</b> <span class="tag">${esc(m.role)}</span>
      <div class="status s-${esc(m.status)}">● ${esc(m.status)}</div>
      <div>${m.task ? esc(m.task) : '<span class="muted">Sem tarefa agora</span>'}</div>
      <div class="bar"><i style="width:${Number(m.progress) || 0}%"></i></div>
      <div class="muted">${Number(m.progress) || 0}%${m.last_seen ? " · visto às " + time(m.last_seen) : ""}</div>
      ${m.current_action ? `<div class="muted">Agora: ${esc(m.current_action)}</div>` : ""}
      ${m.last_action ? `<div class="muted">Antes: ${esc(m.last_action)}</div>` : ""}
      ${m.next_action ? `<div class="muted">A seguir: ${esc(m.next_action)}</div>` : ""}
      ${m.error ? `<div class="error">${esc(m.error)}</div>` : ""}
    </div>`).join("");
}

function eventHtml(a) {
  return `<div class="event"><span class="avatar">${initial(a.name || a.user)}</span>
    <div><b>${esc(a.name || a.user)}</b> <span class="muted">${esc(a.message.replace(a.name || "\u0000", "").trim())}</span></div>
    <span class="when">${time(a.created_at)}</span></div>`;
}

async function loadRecent() {
  if (!$("recent")) return;
  const items = (await api("/api/history?limit=8"));
  $("recent").innerHTML = items.length ? items.map(eventHtml).join("") : '<p class="muted">Ainda sem atividade.</p>';
}

async function loadTimeline() {
  if (!$("timeline")) return;
  const all = await api("/api/history?limit=300");
  const names = [...new Map(all.map((a) => [a.user, a.name])).entries()];
  $("who-chips").innerHTML = [["", "Todos"], ...names].map(([u, n]) => `<span class="chip ${u === historyFilter ? "active" : ""}" data-u="${esc(u)}">${esc(n)}</span>`).join("");
  const items = historyFilter ? all.filter((a) => a.user === historyFilter) : all;
  let last = "";
  $("timeline").innerHTML = items.length ? items.map((a) => {
    const d = dayLabel(a.created_at);
    const head = d !== last ? `<div class="day">${esc(d)}</div>` : "";
    last = d;
    return head + eventHtml(a);
  }).join("") : '<div class="empty">Nada por aqui ainda.</div>';
}

async function loadApprovals() {
  if (!$("approvals")) return;
  const pending = (await api("/api/approvals")).filter((a) => a.status === "PENDING");
  $("approvals").innerHTML = pending.length ? pending.map((a) => `
    <div class="card approval">
      <span>🟡 O agente de <b>${esc(a.user)}</b> pede aprovação: <b>${esc(a.action)}</b>
        ${a.task_id ? `(TASK-${a.task_id})` : ""}<br><span class="muted">${esc(a.detail)}</span></span>
      <span>${me.role === "owner"
        ? `<button class="primary" data-ap="${a.id}" data-ok="1">Aprovar</button> <button class="danger" data-ap="${a.id}">Recusar</button>`
        : '<span class="muted">À espera do Owner</span>'}</span>
    </div>`).join("") : '<p class="muted">Nada à espera de aprovação.</p>';
}

async function loadTasks() {
  if (!$("tasks")) return;
  const tasks = await api("/api/tasks");
  const live = ["IN_PROGRESS", "WAITING_APPROVAL", "PAUSED", "NEEDS_HELP"];
  $("tasks").innerHTML = "<tr><th>#</th><th>Título</th><th>Quem</th><th>Estado</th><th>Progresso</th><th>Última ação</th><th></th></tr>" +
    tasks.map((t) => `
      <tr class="clickable" data-id="${t.id}">
        <td>${t.id}</td><td>${esc(t.title)}</td><td>${esc(t.assignee)}</td><td>${esc(t.status)}</td>
        <td>${t.progress}%</td><td>${esc(t.last_action)}</td>
        <td>${["IN_PROGRESS", "WAITING_APPROVAL"].includes(t.status) ? `<button class="ghost" data-act="pause" data-id="${t.id}">Pausar</button>` : ""}
            ${["PAUSED", "NEEDS_HELP"].includes(t.status) ? `<button class="ghost" data-act="resume" data-id="${t.id}">Retomar</button>` : ""}
            ${live.includes(t.status) ? `<button class="danger" data-act="stop" data-id="${t.id}">Parar</button>` : ""}</td>
      </tr>`).join("");
  if (openTask) showTask(openTask);
}

async function loadUsage() {
  if (!$("usage")) return;
  const rows = await api("/api/usage");
  $("usage").innerHTML = "<tr><th>Quem</th><th>Execuções</th><th>Input</th><th>Output</th><th>Cache</th><th>Custo estimado</th></tr>" +
    rows.map((u) => `<tr><td>${esc(u.user)}</td><td>${u.runs}</td><td>${u.input_tokens}</td><td>${u.output_tokens}</td><td>${u.cache_read_tokens}</td><td>$${u.cost_usd.toFixed(4)}</td></tr>`).join("");
}

/* ---------- views ---------- */
async function viewHome() {
  $("view").innerHTML = `
    <div class="hero">
      <div><h2>Olá, <span>${esc(me.display_name)}</span></h2><p>Tudo da equipa num só sítio.</p><div class="tiles" id="tiles"></div></div>
      <img class="car" src="assets/amg-car.svg" alt="">
    </div>
    <div class="section-title">Empresas</div>
    <div class="grid" id="home-companies"></div>
    <div class="section-title">Quanto cada um já gastou</div>
    <div class="grid" id="meters"></div>
    <div class="section-title">Aprovações</div><div id="approvals"></div>
    <div class="section-title">Equipa agora</div><div class="grid" id="team"></div>
    <div class="section-title">O que se fez há pouco</div><div class="timeline" id="recent"></div>`;
  $("home-companies").innerHTML = companies.length ? companies.map((c) => `
    <a class="card click big-card" href="#/empresas/${esc(c.id)}">
      <span class="co-logo">${esc(c.short)}</span>
      <div><h3>${esc(c.name)}</h3><p>${esc(c.tagline)}</p></div>
    </a>`).join("") : '<div class="empty">Ainda não há empresas.</div>';
  await Promise.all([loadStats(), loadMeters(), loadApprovals(), loadTeam(), loadRecent()]);
}

async function viewCompanies(r) {
  if (!companies.length) { $("view").innerHTML = '<div class="empty">Ainda não há empresas.</div>'; return; }
  const company = companies.find((c) => c.id === r.company) || companies[0];
  const section = company.sections.find((s) => s.id === r.section) || company.sections[0];
  $("view").innerHTML = `
    <div class="chips">${companies.map((c) => `<a class="chip ${c.id === company.id ? "active" : ""}" href="#/empresas/${esc(c.id)}">${esc(c.short)} · ${esc(c.name)}</a>`).join("")}</div>
    <div class="split">
      <nav class="side">${company.sections.map((s) => `
        <a class="${s.id === section.id ? "active" : ""}" href="#/empresas/${esc(company.id)}/${esc(s.id)}">${icon(s.id)}${esc(s.label)}<span class="n">${s.count}</span></a>`).join("")}</nav>
      <section><div class="page-head"><div><h2>${esc(section.label)}</h2><p>${esc(section.description)}</p></div></div><div id="section-body"><p class="muted">A carregar…</p></div></section>
    </div>`;
  const data = await api(`/api/hub/${company.id}/${section.id}`);
  const body = $("section-body");
  if (!body) return;
  const note = data.missing?.length ? `<p class="muted">Pasta não encontrada neste servidor: ${data.missing.map(esc).join(", ")}</p>` : "";
  const ctx = { company, section, data };
  const render = { cards: renderCards, static: renderCards, files: renderFiles, videos: renderMedia, photos: renderMedia }[data.kind];
  body.innerHTML = note + (data.items.length ? "" : '<div class="empty">Ainda não há nada aqui.</div>');
  if (data.items.length) render(body, ctx);
}

function mediaUrl({ company, section }, id) {
  return `/api/hub/${company.id}/${section.id}/media?id=${encodeURIComponent(id)}&token=${encodeURIComponent(token)}`;
}

function renderCards(body, ctx) {
  const clickable = ctx.data.kind === "cards";
  body.insertAdjacentHTML("beforeend", `<div class="grid">${ctx.data.items.map((it, i) => `
    <div class="card ${clickable ? "click" : ""}" data-i="${i}">
      <span class="ico">${icon(ctx.section.id)}</span>
      <h3>${esc(it.name)}</h3><p>${esc(it.description)}</p>${it.tag ? `<span class="tag">${esc(it.tag)}</span>` : ""}
    </div>`).join("")}</div>`);
  if (clickable) body.onclick = (e) => { const c = e.target.closest("[data-i]"); if (c) openFile(ctx, ctx.data.items[c.dataset.i]); };
}

function renderFiles(body, ctx) {
  body.insertAdjacentHTML("beforeend", `<div class="toolbar"><input id="filter" placeholder="🔍 Procurar ficheiro…"></div><div class="rows" id="rows"></div>`);
  const draw = () => {
    const q = $("filter").value.toLowerCase();
    $("rows").innerHTML = ctx.data.items.map((it, i) => [it, i]).filter(([it]) => (it.folder + "/" + it.name).toLowerCase().includes(q)).slice(0, 300)
      .map(([it, i]) => `<div class="row" data-i="${i}">${icon("docs")}<b>${esc(it.name)}</b><span class="tag">${esc(it.group)}</span><span class="path">${esc(it.folder)}</span><span class="muted">${size(it.size)}</span></div>`).join("")
      || '<div class="empty">Nenhum ficheiro encontrado.</div>';
  };
  $("filter").oninput = draw;
  draw();
  body.onclick = (e) => { const r = e.target.closest("[data-i]"); if (r) openFile(ctx, ctx.data.items[r.dataset.i]); };
}

function renderMedia(body, ctx) {
  const isVideo = ctx.data.kind === "videos";
  const groups = [...new Set(ctx.data.items.map((i) => i.group))];
  let group = "";
  body.insertAdjacentHTML("beforeend", `<div class="chips" id="groups"></div><div class="media-grid" id="media"></div>`);
  const draw = () => {
    $("groups").innerHTML = ["", ...groups].map((g) => `<span class="chip ${g === group ? "active" : ""}" data-g="${esc(g)}">${esc(g || "Tudo")}</span>`).join("");
    $("media").innerHTML = ctx.data.items.filter((it) => !group || it.group === group).slice(0, 400).map((it) => {
      const url = mediaUrl(ctx, it.id);
      return `<div class="media">${isVideo
        ? `<video controls preload="metadata" src="${url}#t=0.1"></video>`
        : `<img loading="lazy" src="${url}" data-full="${url}" alt="${esc(it.name)}">`}
        <div class="cap"><b>${esc(it.name)}</b><span class="muted">${esc(it.group)} · ${size(it.size)}</span></div></div>`;
    }).join("");
  };
  body.onclick = (e) => {
    if (e.target.dataset.g !== undefined) { group = e.target.dataset.g; draw(); }
    if (e.target.tagName === "IMG") openModal(`<div class="modal-head"><b>${esc(e.target.alt)}</b><button class="ghost" data-close>Fechar ✕</button></div><img src="${e.target.dataset.full}" alt="">`);
  };
  draw();
}

async function openFile(ctx, item) {
  const { company, section } = ctx;
  const f = await api(`/api/hub/${company.id}/${section.id}/file?id=${encodeURIComponent(item.id)}`);
  openModal(`
    <div class="modal-head"><b>${esc(f.name)}</b><span><span id="save-msg" class="muted"></span>
      ${f.editable ? '<button class="primary" id="save-file">Guardar</button>' : '<span class="tag">só leitura</span>'}
      <button class="ghost" data-close>Fechar ✕</button></span></div>
    <textarea class="editor" id="editor" ${f.editable ? "" : "readonly"} spellcheck="false">${esc(f.content)}</textarea>`);
  if (f.editable) $("save-file").onclick = async () => {
    try {
      await api(`/api/hub/${company.id}/${section.id}/file?id=${encodeURIComponent(item.id)}`, { method: "PUT", body: { content: $("editor").value } });
      $("save-msg").textContent = "Guardado ✓ ";
    } catch (e) { $("save-msg").textContent = e.message; }
  };
}

async function viewTasks() {
  const users = await api("/api/users");
  $("view").innerHTML = `
    <div class="page-head"><div><h2>Tarefas</h2><p>O que cada agente está a fazer.</p></div></div>
    <div class="section-title">Aprovações</div><div id="approvals"></div>
    <div class="section-title">Nova tarefa</div>
    <form id="task-form" class="card form">
      <input id="t-title" placeholder="Título" required>
      <input id="t-goal" placeholder="Objetivo">
      <input id="t-project" placeholder="Pasta do projeto (opcional)">
      <select id="t-assignee">${users.filter((u) => me.role === "owner" || u.username === me.username).map((u) => `<option value="${esc(u.username)}">${esc(u.display_name)}</option>`).join("")}</select>
      <textarea class="wide" id="t-description" placeholder="Descrição"></textarea>
      <textarea class="wide" id="t-requirements" placeholder="Requisitos, um por linha"></textarea>
      <button class="primary wide">Criar tarefa</button>
    </form>
    <div class="section-title">Todas</div>
    <div class="table-wrap card"><table id="tasks"></table></div>
    <div id="task-detail" class="card" hidden></div>`;
  $("task-form").onsubmit = async (e) => {
    e.preventDefault();
    await api("/api/tasks", { method: "POST", body: {
      title: $("t-title").value, goal: $("t-goal").value, project: $("t-project").value,
      description: $("t-description").value, assignee: $("t-assignee").value,
      requirements: $("t-requirements").value.split("\n").map((s) => s.trim()).filter(Boolean),
    } });
    e.target.reset();
  };
  $("tasks").onclick = async (e) => {
    const act = e.target.dataset.act;
    if (act) { await api(`/api/tasks/${e.target.dataset.id}/control`, { method: "POST", body: { action: act } }); return; }
    const row = e.target.closest("tr[data-id]");
    if (row) showTask(Number(row.dataset.id));
  };
  await Promise.all([loadApprovals(), loadTasks()]);
}

async function showTask(id) {
  openTask = id;
  const t = await api(`/api/tasks/${id}`);
  const box = $("task-detail");
  if (!box) return;
  box.hidden = false;
  box.innerHTML = `
    <b>TASK-${t.id}: ${esc(t.title)}</b> <span class="tag">${esc(t.status)}</span>
    <button class="ghost" id="close-task">Fechar</button>
    ${t.goal ? `<pre><b>Objetivo:</b> ${esc(t.goal)}</pre>` : ""}
    ${t.description ? `<pre>${esc(t.description)}</pre>` : ""}
    ${t.requirements.length ? `<pre><b>Requisitos:</b>\n${t.requirements.map((r) => "• " + esc(r)).join("\n")}</pre>` : ""}
    ${t.result ? `<pre><b>Resultado:</b> ${esc(t.result)}</pre>` : ""}
    <div class="timeline">${t.events.map((ev) => `<div class="event"><div><span class="muted">${esc(ev.kind)}</span> ${esc(ev.message)}</div><span class="when">${time(ev.created_at)}</span></div>`).join("")}</div>`;
  $("close-task").onclick = () => { openTask = null; box.hidden = true; };
}

async function viewTeam() {
  $("view").innerHTML = `
    <div class="page-head"><div><h2>Equipa</h2><p>Quem está ligado e o que está a fazer.</p></div>
      <button id="agent-token">${icon("key")}O meu token de agente</button></div>
    <p id="token-box" class="card" hidden></p>
    <div class="section-title">Quanto cada um já gastou</div>
    <div class="grid" id="meters"></div>
    <form id="higgs-form" class="card" style="margin-top:16px">
      <b>O meu Higgsfield</b> <span class="muted">· quanto dos créditos já gastei (o Higgsfield não deixa ler isto sozinho)</span>
      <div class="range-row" style="margin-top:12px">
        <input id="higgs-range" type="range" min="0" max="100" value="0"><b id="higgs-val">0%</b>
        <button class="primary">Guardar</button>
      </div>
    </form>
    <div class="section-title">Agentes</div>
    <div class="grid" id="team"></div>
    ${me.role === "owner" ? `
    <div class="section-title">Criar utilizador</div>
    <form id="user-form" class="card form">
      <input id="u-name" placeholder="Nome (ex: David)" required>
      <input id="u-username" placeholder="Utilizador (ex: david)" required pattern="[a-zA-Z0-9_]{2,30}">
      <input id="u-password" type="password" placeholder="Palavra-passe (mín. 8)" minlength="8" required>
      <select id="u-role"><option value="member">Membro</option><option value="owner">Owner</option></select>
      <button class="primary">Criar</button>
      <p id="user-msg" class="wide muted"></p>
    </form>` : ""}
    <div class="section-title">Uso do Claude</div>
    <div class="table-wrap card"><table id="usage"></table></div>
    <p class="muted">Tokens e custo são estimativas do Claude Agent SDK, não faturação.</p>`;
  $("agent-token").onclick = async () => {
    const { agent_token } = await api(`/api/users/${me.username}/agent-token`, { method: "POST" });
    $("token-box").hidden = false;
    $("token-box").innerHTML = `Token do agente de <b>${esc(me.username)}</b> (aparece só uma vez e substitui o anterior). Põe-no no <code>.env</code> do agente como TEAM_AGENT_TOKEN:<br><code>${esc(agent_token)}</code>`;
  };
  if ($("user-form")) $("user-form").onsubmit = async (e) => {
    e.preventDefault();
    try {
      const u = await api("/api/users", { method: "POST", body: {
        display_name: $("u-name").value, username: $("u-username").value, password: $("u-password").value, role: $("u-role").value } });
      $("user-msg").className = "wide ok";
      $("user-msg").textContent = `${u.display_name} criado. Já pode entrar com o utilizador "${u.username}".`;
      e.target.reset();
      loadTeam();
    } catch (err) { $("user-msg").className = "wide error"; $("user-msg").textContent = err.message; }
  };
  const mine = (await api("/api/team")).find((m) => m.user === me.username);
  $("higgs-range").value = mine?.higgsfield_pct ?? 0;
  $("higgs-val").textContent = $("higgs-range").value + "%";
  $("higgs-range").oninput = () => { $("higgs-val").textContent = $("higgs-range").value + "%"; };
  $("higgs-form").onsubmit = async (e) => {
    e.preventDefault();
    await api("/api/meters/higgsfield", { method: "PUT", body: { pct: Number($("higgs-range").value) } });
    loadMeters();
  };
  await Promise.all([loadMeters(), loadTeam(), loadUsage()]);
}

async function viewHistory() {
  $("view").innerHTML = `
    <div class="page-head"><div><h2>Histórico</h2><p>O que cada um fez, mesmo sem escrever nada.</p></div></div>
    <div class="chips" id="who-chips"></div><div class="timeline" id="timeline"></div>`;
  $("who-chips").onclick = (e) => { if (e.target.dataset.u !== undefined) { historyFilter = e.target.dataset.u; loadTimeline(); } };
  await loadTimeline();
}

/* ---------- live updates ---------- */
const loaders = {
  presence: [loadTeam, loadStats, loadMeters], task: [loadTasks, loadStats], approval: [loadApprovals, loadStats],
  activity: [loadRecent, loadTimeline], usage: [loadUsage, loadMeters],
};
const pending = new Set();
function refresh(type) {
  // Heartbeats arrive every few seconds; coalesce bursts into one fetch per kind.
  if (pending.has(type)) return;
  pending.add(type);
  setTimeout(() => { pending.delete(type); (loaders[type] || []).forEach((fn) => fn().catch(() => {})); }, 300);
}

function connect() {
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws?token=${token}`);
  ws.onopen = () => { $("live").textContent = "● ao vivo"; $("live").classList.add("live"); };
  ws.onmessage = (e) => refresh(JSON.parse(e.data).type);
  ws.onclose = () => { $("live").textContent = "a reconectar"; $("live").classList.remove("live"); if (token) setTimeout(connect, 3000); };
}

async function start() {
  try { me = await api("/api/me"); } catch { return; }
  $("login").hidden = true;
  $("app").hidden = false;
  $("whoami").textContent = `${me.display_name} · ${me.role}`;
  $("maximize").innerHTML = icon("expand");
  companies = await api("/api/hub/companies").catch(() => []);
  render();
  loadStats().catch(() => {});
  setInterval(() => { loadTeam().catch(() => {}); loadStats().catch(() => {}); }, 15000); // catches OFFLINE even if the socket dropped
  connect();
}

token ? start() : logout();
