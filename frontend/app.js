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
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>',
  wallet: '<rect x="3" y="6" width="18" height="14" rx="3"/><path d="M3 10h18M16 15h2"/>',
  code: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="9" r="2.5"/><path d="M6 8.5v7M18 11.5c0 4-6 3-11.2 5"/>',
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
let teamNames = {}; // login -> name people see (kovel, marco, david)
const nameOf = (u) => teamNames[u] || u;
const STATUS_PT = { ONLINE: "online", WORKING: "a trabalhar", IDLE: "livre", WAITING: "à espera", PAUSED: "em pausa", ERROR: "erro", OFFLINE: "offline" };
const TASK_PT = { ASSIGNED: "por começar", IN_PROGRESS: "em curso", WAITING_APPROVAL: "à espera de aprovação", PAUSED: "em pausa", NEEDS_HELP: "precisa de ajuda", COMPLETED: "concluída", FAILED: "falhou", STOPPED: "parada" };

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
$("maximize").onclick = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen());

/* ---------- modal ---------- */
function openModal(html) { $("modal-box").innerHTML = html; $("modal").hidden = false; }
function closeModal() { $("modal").hidden = true; $("modal-box").innerHTML = ""; $("modal-box").className = "modal-box"; $("modal-box").onkeydown = null; if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); }
$("modal").onclick = (e) => { if (e.target === $("modal") || e.target.closest("[data-close]")) closeModal(); };
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

/* ---------- routing ---------- */
// sidebar: [group, [id, label, icon]...]
const NAV = [
  ["", [["home", "Início", "home"], ["semana", "Semana", "calendar"], ["tarefas", "Tarefas", "tasks"], ["aprovacoes", "Aprovações", "check"]]],
  ["Trabalho", [["empresas", "Empresas", "building"], ["codigo", "Código", "code"], ["historico", "Histórico", "history"]]],
  ["Equipa", [["equipa", "Agentes", "users"], ["gastos", "Gastos", "wallet"]]],
];
const TABS = NAV.flatMap(([, items]) => items);

function route() {
  const hash = location.hash;
  const linked = hash.match(/^#task-(\d+)$/); // "Open Task" from the widget
  if (linked) { openTask = Number(linked[1]); return { tab: "tarefas" }; }
  const [, tab = "home", company, section] = hash.replace(/^#/, "").split("/");
  return { tab: TABS.some(([id]) => id === tab) ? tab : "home", company, section };
}

function render() {
  const r = route();
  $("tabs").innerHTML = NAV.map(([group, items]) => `${group ? `<div class="nav-group">${group}</div>` : ""}${items.map(([id, label, ic]) =>
    `<a class="tab ${id === r.tab ? "active" : ""}" href="#/${id}">${icon(ic)}<span>${label}</span><i class="badge" data-badge="${id}" hidden></i></a>`).join("")}`).join("");
  $("view").scrollTop = 0;
  const views = { home: viewHome, semana: viewWeek, tarefas: viewTasks, aprovacoes: viewApprovals, empresas: viewCompanies, codigo: viewCode,
    historico: viewHistory, equipa: viewTeam, gastos: viewSpend };
  views[r.tab](r).catch((e) => { if (e.message !== "unauthorized") $("view").innerHTML = `<p class="error">${esc(e.message)}</p>`; });
}
window.addEventListener("hashchange", render);

/* ---------- shared loaders (each only runs if its element is on screen) ---------- */
async function loadStats() {
  const [team, tasks, approvals] = await Promise.all([api("/api/team"), api("/api/tasks"), api("/api/approvals")]);
  teamNames = Object.fromEntries(team.map((m) => [m.user, m.display_name]));
  const active = tasks.filter((t) => ["IN_PROGRESS", "WAITING_APPROVAL", "PAUSED", "NEEDS_HELP"].includes(t.status)).length;
  const pending = approvals.filter((a) => a.status === "PENDING").length;
  const done = tasks.filter((t) => t.status === "COMPLETED").length;
  const week = team.reduce((sum, m) => sum + (Number(m.week_cost_usd) || 0), 0);
  drawHud(team, active, pending, week);
  const badge = (id, n) => { const b = document.querySelector(`[data-badge="${id}"]`); if (b) { b.textContent = n; b.hidden = !n; } };
  badge("aprovacoes", pending); badge("tarefas", active);
  if (!$("tiles")) return;
  $("tiles").innerHTML = [[active, "Em curso", "blue"], [pending, "Aprovações", pending ? "orange" : ""],
    [done, "Concluídas", "green"], [`$${week.toFixed(2)}`, "Gasto esta semana"]]
    .map(([n, label, tone = ""]) => `<div class="tile ${tone}"><span>${label}</span><b>${n}</b></div>`).join("");
}

/* HUD: always-visible strip, so everybody is in the loop on every tab */
let hudData = null;
function drawHud(team, active, pending, week) {
  if (team) hudData = { team, active, pending, week };
  if (!hudData || !$("hud")) return;
  const { team: t, active: a, pending: p, week: w } = hudData;
  $("hud").innerHTML = `
    <div class="hud-agents">${t.map((m) => `<a class="hud-agent" href="#/home" title="${esc(m.display_name)}: ${esc(STATUS_PT[m.status] || m.status)}${m.task ? " · " + esc(m.task) : ""}">
      <span class="dot ${m.status === "ERROR" ? "err" : m.status !== "OFFLINE" ? "on" : "off"}"></span>${esc(m.display_name)}</a>`).join("")}</div>
    <div class="hud-stats">
      <span><b>${a}</b> em curso</span>
      <span class="${p ? "warn" : ""}"><b>${p}</b> aprovaç${p === 1 ? "ão" : "ões"}</span>
      <span><b>$${w.toFixed(2)}</b> esta semana</span>
      <span class="clock">${new Date().toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" })}</span>
    </div>`;
}

async function loadAgents() {
  if (!$("agents") && !$("presence")) return;
  const team = await api("/api/team");
  teamNames = Object.fromEntries(team.map((m) => [m.user, m.display_name]));
  if ($("presence")) {
    $("presence").innerHTML = team.map((m) => {
      const on = m.status !== "OFFLINE", label = STATUS_PT[m.status] || m.status;
      return `<a class="who ${on ? "on" : "off"}" href="#/equipa" title="${esc(m.display_name)}: ${esc(label)}${m.task ? " · " + esc(m.task) : ""}">
        <span class="who-ava">${initial(m.display_name)}<i class="dot ${m.status === "ERROR" ? "err" : on ? "on" : "off"}"></i></span>
        <b>${esc(m.display_name)}</b><small>${esc(label)}</small></a>`;
    }).join("");
  }
  if (!$("agents")) return;
  $("agents").innerHTML = team.map((m) => {
    const on = m.status !== "OFFLINE", pct = Number(m.progress) || 0;
    return `<div class="agent ${on ? "on" : "off"}">
      <div class="agent-top"><span class="dot ${m.status === "ERROR" ? "err" : on ? "on" : "off"}" title="${esc(STATUS_PT[m.status] || m.status)}"></span>
        <b>${esc(m.display_name)}</b><span class="agent-state">${esc(STATUS_PT[m.status] || m.status)}</span></div>
      <div class="agent-task">${m.task ? esc(m.task) : '<span class="muted">Sem tarefa agora</span>'}</div>
      <div class="bar"><i style="width:${pct}%"></i></div>
      <div class="muted small">${pct}%${m.last_seen ? " · visto às " + time(m.last_seen) : ""}</div>
      ${m.current_action ? `<div class="small"><span class="muted">Agora:</span> ${esc(m.current_action)}</div>` : ""}
      ${m.next_action ? `<div class="small"><span class="muted">A seguir:</span> ${esc(m.next_action)}</div>` : ""}
      ${m.error ? `<div class="error small">${esc(m.error)}</div>` : ""}
    </div>`;
  }).join("");
}

async function loadToday() {
  if (!$("today")) return;
  const tasks = (await api("/api/tasks")).filter((t) => !["COMPLETED", "FAILED", "STOPPED"].includes(t.status));
  $("today").innerHTML = tasks.length ? tasks.slice(0, 8).map((t) => `
    <a class="plan-row" href="#task-${t.id}">
      <span class="avatar">${initial(nameOf(t.assignee))}</span>
      <div class="plan-main"><b>${esc(t.title)}</b><div class="muted small">${esc(nameOf(t.assignee))} · ${esc(TASK_PT[t.status] || t.status)}${t.next_action ? " · a seguir: " + esc(t.next_action) : ""}</div></div>
      <div class="plan-pct"><div class="bar"><i style="width:${Number(t.progress) || 0}%"></i></div><span class="muted small">${Number(t.progress) || 0}%</span></div>
    </a>`).join("") : '<div class="empty">Sem tarefas por fazer. Cria uma em Tarefas.</div>';
}

/* ---------- notifications: toasts, bell, and a summary when you open the site ---------- */
let seenTasks = null, seenApprovals = null; // null until the first look, so opening the site is not a flood of toasts
const inbox = [];
function notify(text, href) {
  inbox.unshift({ text, href, at: new Date().toISOString() });
  inbox.length = Math.min(inbox.length, 30);
  updateBell(true);
  const el = document.createElement("a");
  el.className = "toast"; el.href = href || "#/home";
  el.innerHTML = `<b>${esc(text)}</b><span class="muted small">agora</span>`;
  $("toasts").append(el);
  setTimeout(() => el.classList.add("out"), 6000);
  setTimeout(() => el.remove(), 6600);
}
let unread = 0;
function updateBell(add = false) {
  if (add) unread++;
  $("bell-n").textContent = unread; $("bell-n").hidden = !unread;
}
async function checkNews() {
  const [tasks, approvals] = await Promise.all([api("/api/tasks"), api("/api/approvals")]);
  const pend = approvals.filter((a) => a.status === "PENDING");
  if (seenTasks === null) {
    seenTasks = new Set(tasks.map((t) => t.id)); seenApprovals = new Set(pend.map((a) => a.id));
    const mine = tasks.filter((t) => t.assignee === me.username && !["COMPLETED", "FAILED", "STOPPED"].includes(t.status)).length;
    const live = tasks.filter((t) => ["IN_PROGRESS", "WAITING_APPROVAL", "PAUSED", "NEEDS_HELP"].includes(t.status)).length;
    if (mine || live || pend.length) notify(`Olá ${me.display_name}: ${mine} tarefa${mine === 1 ? "" : "s"} tua${mine === 1 ? "" : "s"}, ${live} em curso na equipa, ${pend.length} aprovaç${pend.length === 1 ? "ão" : "ões"} pendente${pend.length === 1 ? "" : "s"}.`, "#/home");
    return;
  }
  for (const t of tasks) if (!seenTasks.has(t.id)) { seenTasks.add(t.id); notify(`Nova tarefa para ${nameOf(t.assignee)}: ${t.title}`, `#task-${t.id}`); }
  for (const a of pend) if (!seenApprovals.has(a.id)) { seenApprovals.add(a.id); notify(`${nameOf(a.user)} pede aprovação: ${a.action}`, "#/home"); }
}
function openInbox() {
  unread = 0; updateBell();
  openModal(`<h3>Notificações</h3>${inbox.length ? inbox.map((n) => `<a class="plan-row" href="${esc(n.href || "#/home")}" data-close><div class="plan-main"><b>${esc(n.text)}</b><div class="muted small">${time(n.at)}</div></div></a>`).join("") : '<p class="muted">Nada de novo.</p>'}
    <p><button class="ghost" data-close>Fechar</button></p>`);
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

function eventHtml(a, relative = false) {
  return `<div class="event"><span class="avatar">${initial(a.name || a.user)}</span>
    <div><b>${esc(a.name || a.user)}</b> <span class="muted">${esc(a.message.replace(a.name || "\u0000", "").trim())}</span></div>
    <span class="when" title="${esc(dayLabel(a.created_at))} ${time(a.created_at)}">${relative ? ago(a.created_at) : time(a.created_at)}</span></div>`;
}

async function loadRecent() {
  if (!$("recent")) return;
  const NOISE = ["login", "hub_online", "hub_offline", "agent_online", "agent_offline"]; // who is online lives in the icons above; this is what people DID
  const items = (await api("/api/history?limit=80")).filter((a) => !NOISE.includes(a.kind)).slice(0, 10);
  $("recent").innerHTML = items.length ? items.map((a) => eventHtml(a, true)).join("") : '<p class="muted">Ainda sem atividade. Assim que alguém fizer alguma coisa, aparece aqui.</p>';
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

const AREA_LABELS = {
  sections: "Secções", layout: "Layout", snippets: "Snippets", templates: "Templates", assets: "Assets", config: "Config",
  locales: "Idiomas", docs: "Documentos", backend: "Servidor", frontend: "Site", widget: "Widget", agent: "Agente",
  scripts: "Scripts", library: "Biblioteca", tests: "Testes", ads: "Anúncios", "(raiz)": "Raiz do projeto",
};
const areaLabel = (name) => AREA_LABELS[name] || name;
const ago = (iso) => {
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  return m < 1 ? "agora" : m < 60 ? `há ${m} min` : m < 1440 ? `há ${Math.round(m / 60)} h` : `há ${Math.round(m / 1440)} d`;
};
const diffStat = (a, d) => `<span class="add">+${a}</span> <span class="del">−${d}</span>`;

function commitHtml(c, full = true) {
  const link = (inner) => (c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener" title="Abrir no GitHub">${inner}</a>` : inner);
  const stats = c.stats ? `<span class="muted">${c.stats.files} ficheiro${c.stats.files === 1 ? "" : "s"}</span> ${diffStat(c.stats.added, c.stats.deleted)}` : "";
  const areas = c.areas.map((a) => `<span class="area" title="${esc(a.name)}">${esc(areaLabel(a.name))} <i>${a.files}</i></span>`).join("");
  const files = c.files?.length ? `
    <details class="files"><summary>Ver os ${c.stats.files} ficheiros alterados</summary>
      ${c.files.map((f) => `<div class="file"><code>${esc(f.path)}</code><span>${f.binary ? '<span class="muted">binário</span>' : diffStat(f.added, f.deleted)}</span></div>`).join("")}
      ${c.stats.files > c.files.length ? `<div class="muted">… e mais ${c.stats.files - c.files.length}</div>` : ""}
    </details>` : "";
  return `<article class="commit">
    <span class="avatar">${initial(c.author)}</span>
    <div class="commit-main">
      <div class="commit-head"><b>${esc(c.author)}</b><span class="muted">${ago(c.date)} · ${time(c.date)}</span>
        <span class="tag">${esc(c.repo)}</span>${link(`<code>${esc(c.sha.slice(0, 7))}</code>`)}</div>
      <div class="commit-msg">${esc(c.message)}</div>
      ${full && c.body ? `<div class="commit-body">${esc(c.body)}</div>` : ""}
      ${full ? `<div class="commit-where">${areas}${stats ? `<span class="spacer"></span>${stats}` : ""}</div>${files}` : ""}
    </div></article>`;
}

let commitRepo = "", commitAuthor = "", commitLimit = 100;
async function loadCommits() {
  if ($("commit-list")) {
    const all = await api(`/api/commits?limit=${commitLimit}`);
    const sig = all.map((c) => c.sha).join() + commitRepo + commitAuthor;
    if ($("commit-list").dataset.sig === sig) return; // nothing new: keep open file lists and scroll as they are
    $("commit-list").dataset.sig = sig;
    if ($("commit-count")) { $("commit-count").textContent = `A mostrar ${all.length} commits`; $("more-commits").hidden = all.length < commitLimit; }
    const repos = [...new Set(all.map((c) => c.repo))], authors = [...new Set(all.map((c) => c.author))];
    $("repo-chips").innerHTML = '<span class="chip-label">Onde</span>' + ["", ...repos].map((r) => `<span class="chip ${r === commitRepo ? "active" : ""}" data-r="${esc(r)}">${esc(r || "Todos")}</span>`).join("");
    $("author-chips").innerHTML = '<span class="chip-label">Quem</span>' + ["", ...authors].map((a) => `<span class="chip ${a === commitAuthor ? "active" : ""}" data-a="${esc(a)}">${esc(a || "Todos")}</span>`).join("");
    const items = all.filter((c) => (!commitRepo || c.repo === commitRepo) && (!commitAuthor || c.author === commitAuthor));

    const per = new Map();
    for (const c of items) {
      const p = per.get(c.author) || { n: 0, files: 0, add: 0, del: 0, areas: new Set(), last: c.date };
      p.n++; p.files += c.stats?.files || 0; p.add += c.stats?.added || 0; p.del += c.stats?.deleted || 0;
      c.areas.forEach((a) => p.areas.add(areaLabel(a.name)));
      per.set(c.author, p);
    }
    $("who-summary").innerHTML = [...per].map(([name, p]) => `
      <div class="card"><div class="person"><span class="avatar">${initial(name)}</span><div><b>${esc(name)}</b><div class="muted">último ${ago(p.last)}</div></div></div>
        <div class="summary-nums"><div><b>${p.n}</b><span>commits</span></div><div><b>${p.files}</b><span>ficheiros</span></div><div>${diffStat(p.add, p.del)}<span>linhas</span></div></div>
        <div class="muted small">Mexeu em: ${[...p.areas].map(esc).join(", ") || "—"}</div></div>`).join("");

    let last = "";
    $("commit-list").innerHTML = items.length ? items.map((c) => {
      const d = dayLabel(c.date);
      const head = d !== last ? `<div class="day">${esc(d)}</div>` : "";
      last = d;
      return head + commitHtml(c);
    }).join("") : '<div class="empty">Sem commits para mostrar. Confirma o repositório em library/repos.json.</div>';
  }
  if ($("recent-commits")) {
    const recent = await api("/api/commits?limit=5");
    $("recent-commits").innerHTML = recent.length ? recent.map((c) => commitHtml(c, false)).join("") : '<p class="muted">Sem commits para mostrar.</p>';
  }
}

async function viewCode() {
  $("view").innerHTML = `
    <div class="page-head"><div><h2>Código</h2><p>Quem mexeu, onde e quanto, em cada commit do GitHub. Atualiza sozinho.</p></div></div>
    <div id="worktree"></div>
    <div class="chips" id="author-chips"></div><div class="chips" id="repo-chips"></div>
    <div class="grid" id="who-summary"></div>
    <div class="section-title">Commits</div>
    <div class="timeline" id="commit-list"><p class="muted">A carregar…</p></div>
    <p class="more"><span class="muted" id="commit-count"></span> <button class="ghost" id="more-commits">Ver mais commits</button></p>`;
  $("more-commits").onclick = async () => { commitLimit += 100; await Promise.all([loadWorktree(), loadCommits()]); };
  $("repo-chips").onclick = (e) => { if (e.target.dataset.r !== undefined) { commitRepo = e.target.dataset.r; loadCommits(); } };
  $("author-chips").onclick = (e) => { if (e.target.dataset.a !== undefined) { commitAuthor = e.target.dataset.a; loadCommits(); } };
  await loadCommits();
}

async function loadApprovals() {
  if (!$("approvals")) return;
  const pending = (await api("/api/approvals")).filter((a) => a.status === "PENDING");
  $("approvals").innerHTML = pending.length ? pending.map((a) => `
    <div class="card approval">
      <span>🟡 O agente de <b>${esc(nameOf(a.user))}</b> pede aprovação: <b>${esc(a.action)}</b>
        ${a.task_id ? `(TASK-${a.task_id})` : ""}<br><span class="muted">${esc(a.detail)}</span></span>
      <span>${me.lead
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
        <td>${t.id}</td><td>${esc(t.title)}</td><td>${esc(nameOf(t.assignee))}</td><td>${esc(TASK_PT[t.status] || t.status)}</td>
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

const MONTHS = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];
const shortDate = (iso) => { const d = new Date(iso + "T12:00:00"); return `${String(d.getDate()).padStart(2, "0")} ${MONTHS[d.getMonth()]}`; };


// Work in progress: files edited since the last commit. Shown the moment someone touches something, no commit or push needed.
const wtAgo = (epoch) => (epoch ? ago(new Date(epoch * 1000).toISOString()) : "—");
const WT_STATUS = { alterado: "ALTERADO", novo: "NOVO", apagado: "APAGADO" };

function pendingBlock(pending) {
  if (!pending?.length) return '<div class="pending none"><span class="pending-title">A mexer agora, sem commit</span><span class="muted small">Nada por guardar: tudo o que foi feito já tem commit.</span></div>';
  return `<div class="pending"><div class="pending-title">A mexer agora, sem commit</div>${pending.map((r) => `
    <div class="pending-row"><b>${esc(r.repo)}</b><span>${r.count} ficheiro${r.count === 1 ? "" : "s"}</span>
      <span><span class="add">+${r.added}</span> <span class="del">−${r.deleted}</span></span><span class="muted">${wtAgo(r.newest)}</span><span class="muted">no PC de ${esc(r.user || "?")}</span></div>
    <div class="pending-files">${r.files.slice(0, 3).map((f) => `<span><i>${WT_STATUS[f.status] || f.status}</i> ${esc(f.path)}</span>`).join("")}${r.count > 3 ? `<span class="muted">… e mais ${r.count - 3}</span>` : ""}</div>`).join("")}</div>`;
}

let worktreeSig = "";
async function loadWorktree() {
  if (!$("worktree")) return;
  const data = await api("/api/worktree");
  const sig = JSON.stringify(data.map((r) => [r.repo, r.count, r.newest, r.added, r.deleted]));
  if (sig === worktreeSig && $("worktree").dataset.ready) return; // nothing changed: keep open file lists as they are
  worktreeSig = sig;
  $("worktree").dataset.ready = "1";
  $("worktree").innerHTML = `<div class="section-title">A mexer agora · sem commit</div>` + (data.length ? data.map((r) => `
    <div class="card wt-card">
      <div class="wt-head"><b>${esc(r.repo)}</b><span class="tag">${esc(r.branch)}</span><span class="muted">no PC de ${esc(r.user || "?")}</span><span class="spacer"></span>
        <span>${r.count} ficheiro${r.count === 1 ? "" : "s"}</span> <span><span class="add">+${r.added}</span> <span class="del">−${r.deleted}</span></span><span class="muted">último ${wtAgo(r.newest)}</span></div>
      <details class="files" open><summary>Ficheiros ainda por guardar</summary>
        ${r.files.map((f) => `<div class="file"><span><i class="wt-status ${f.status}">${WT_STATUS[f.status] || f.status}</i> <code>${esc(f.path)}</code></span><span class="muted">${wtAgo(f.mtime)} ${f.status === "apagado" ? "" : `<span class="add">+${f.added}</span> <span class="del">−${f.deleted}</span>`}</span></div>`).join("")}
      </details></div>`).join("") : '<div class="empty">Nada por guardar: tudo o que foi feito já tem commit.</div>');
}

// The weekly ledger: one row per person, a mark for every day they showed up, then what they did and what they still owe.
const KEY_LABEL = { task_done: "Feito", commit: "Commit", task_created: "Nova", library_edit: "Edição" };
const DAY_SHOWN = 5;
const keyText = (f) => f.what === "commit" ? f.text.replace(/^commit em ([^:]+): /, (_, repo) => `${repo} · `) : f.text;
const keyRow = (f) => `<div class="wr-item"><span class="wr-tag ${f.what}">${KEY_LABEL[f.what]}</span><b>${esc(f.who)}</b><span>${esc(keyText(f))}</span><span class="t">${time(f.when)}</span></div>`;
function weekReportHtml(w) {
  const days = w.days.map((d, i) => {
    if (i > w.today) return "";
    const items = w.by_day[i] || [];
    const date = new Date(w.from + "T12:00:00"); date.setDate(date.getDate() + i);
    return `<div class="wr-day ${i === w.today ? "today" : ""}">
      <div class="wr-date"><b>${esc(d)}</b><span>${shortDate(date.toISOString().slice(0, 10))}</span></div>
      <div class="wr-items">${items.length ? items.slice(0, DAY_SHOWN).map(keyRow).join("")
        + (items.length > DAY_SHOWN ? `<details class="wr-more"><summary>Mais ${items.length - DAY_SHOWN}</summary>${items.slice(DAY_SHOWN).map(keyRow).join("")}</details>` : "")
        : '<div class="wr-item muted">Nada de importante.</div>'}</div></div>`;
  }).reverse().join("");
  return `
    <section class="ledger-box">
      <div class="ledger-head"><span>Relatório da semana <i>Semana ${w.week} · ${shortDate(w.from)} – ${shortDate(w.to)}</i></span>${w.demo ? '<span class="demo-tag">Dados de exemplo</span>' : ""}</div>
      <div class="wr">${days}</div>
      ${pendingBlock(w.pending)}
    </section>`;
}

async function loadWeek() {
  if (!$("week")) return;
  $("week").innerHTML = weekReportHtml(await api("/api/week"));
}

const pageHead = (title, sub = "") => `<header class="large-title">${sub ? `<small>${esc(sub)}</small>` : ""}<h1>${esc(title)}</h1></header>`;
const widget = (title, href, body) => `<section class="widget"><div class="widget-head"><b>${esc(title)}</b>${href ? `<a href="${href}">Ver tudo ›</a>` : ""}</div>${body}</section>`;

async function loadTodayKey() {
  if (!$("today-key")) return;
  const w = await api("/api/week");
  const items = w.by_day[w.today] || [];
  $("today-key").innerHTML = items.length ? items.slice(0, 6).map(keyRow).join("") : '<p class="muted pad">Ainda nada hoje.</p>';
}

async function viewHome() {
  const today = new Date().toLocaleDateString("pt-PT", { weekday: "long", day: "numeric", month: "long" });
  $("view").innerHTML = `
    ${pageHead("Início", today)}
    <div class="tiles" id="tiles"></div>
    <div class="widgets">
      ${widget("Hoje", "#/semana", '<div class="wr-items list" id="today-key"></div>')}
      ${widget("Por fazer", "#/tarefas", '<div class="plan" id="today"></div>')}
      ${widget("Aprovações", "#/aprovacoes", '<div id="approvals"></div>')}
      ${widget("Agentes", "#/equipa", '<div class="agents compact" id="agents"></div>')}
    </div>
    <div class="group-title">Empresas</div>
    <div class="grid" id="home-companies"></div>`;
  $("home-companies").innerHTML = companies.length ? companies.map((c) => `
    <a class="card click big-card" href="#/empresas/${esc(c.id)}">
      <span class="co-logo">${esc(c.short)}</span>
      <div><h3>${esc(c.name)}</h3><p>${esc(c.tagline)}</p></div>
    </a>`).join("") : '<div class="empty">Ainda não há empresas.</div>';
  await Promise.all([loadStats(), loadTodayKey(), loadToday(), loadApprovals(), loadAgents()]);
}

async function viewWeek() {
  $("view").innerHTML = `${pageHead("Semana", "O que se fez, dia a dia")}<div id="week"></div>
    <div class="group-title">Últimos commits</div><div class="group timeline" id="recent-commits"></div>`;
  await Promise.all([loadWeek(), loadCommits()]);
}

async function viewApprovals() {
  $("view").innerHTML = `${pageHead("Aprovações", "O que os agentes pedem para fazer")}<div class="group" id="approvals"></div>`;
  await loadApprovals();
}

async function viewSpend() {
  $("view").innerHTML = `${pageHead("Gastos", "Quanto cada um já gastou esta semana")}<div class="grid" id="meters"></div>`;
  await loadMeters();
}

async function viewCompanies(r) {
  if (!companies.length) { $("view").innerHTML = '<div class="empty">Ainda não há empresas.</div>'; return; }
  const company = companies.find((c) => c.id === r.company) || companies[0];
  const section = company.sections.find((s) => s.id === r.section) || company.sections[0];
  $("view").innerHTML = `
    <div class="chips">${companies.map((c) => `<a class="chip ${c.id === company.id ? "active" : ""}" href="#/empresas/${esc(c.id)}">${esc(c.short)} · ${esc(c.name)}</a>`).join("")}</div>
    <div id="work"></div>
    <div class="split">
      <nav class="side">${company.sections.map((s) => `
        <a class="${s.id === section.id ? "active" : ""}" href="#/empresas/${esc(company.id)}/${esc(s.id)}">${icon(s.id)}${esc(s.label)}<span class="n">${s.count}</span></a>`).join("")}</nav>
      <section><div class="page-head"><div><h2>${esc(section.label)}</h2><p>${esc(section.description)}</p></div></div><div id="section-body"><p class="muted">A carregar…</p></div></section>
    </div>`;
  api(`/api/work/${company.id}`).then((w) => {
    if (!$("work")) return;
    $("work").innerHTML = `<div class="section-title">Quem trabalhou em ${esc(company.name)}</div><div class="card">
      ${w.people.length
        ? `<div class="chips">${w.people.map((p) => `<span class="chip">${esc(p.name)} · ${p.count}</span>`).join("")}</div>${w.items.map(eventHtml).join("")}`
        : '<p class="muted">Ainda ninguém. Cria uma tarefa para esta empresa ou edita um ficheiro dela e aparece aqui.</p>'}</div>`;
  }).catch(() => {});
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

function flash(text) {
  const el = document.createElement("div");
  el.className = "toast"; el.innerHTML = `<b>${esc(text)}</b>`;
  $("toasts").append(el);
  setTimeout(() => el.classList.add("out"), 3500);
  setTimeout(() => el.remove(), 4100);
}

function closeMenu() { document.querySelector(".pop-menu")?.remove(); }
document.addEventListener("click", (e) => { if (!e.target.closest(".pop-menu, .dots")) closeMenu(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });

// Video player with the whole library beside it, built like a small editor: a big timeline you can drag, jumps of 5 and
// 10 s, frame stepping, an in/out loop, speed, and two ways to enlarge it (maximize inside the page, or real fullscreen).
function openPlayer(ctx, items, current) {
  let index = Math.max(0, items.findIndex((i) => i.id === current.id)), q = "", auto = true;
  let loopIn = null, loopOut = null, dragging = false;
  const FPS = 30;
  const url = (it) => mediaUrl(ctx, it.id);
  const tc = (s) => (isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}.${Math.floor((s % 1) * 10)}` : "0:00.0");
  const where = (it) => `${it.group} · ${size(it.size)}${it.folder ? " · " + it.folder : ""}`;
  const box = $("modal-box");
  box.classList.add("player-box");
  openModal(`
    <div class="player" id="player">
      <div class="player-main">
        <div class="stage" id="pv-stage"><video id="pv" playsinline preload="auto"></video></div>
        <div class="timeline">
          <span class="tc" id="pv-cur">0:00.0</span>
          <div class="scrub" id="pv-scrub" title="Arrasta para andar no vídeo">
            <div class="buf" id="pv-buf"></div><div class="played" id="pv-played"></div><div class="loop-range" id="pv-loop"></div><div class="knob" id="pv-knob"></div>
          </div>
          <span class="tc" id="pv-dur">0:00.0</span>
        </div>
        <div class="controls">
          <div class="grp">
            <button id="b-prevv" title="Vídeo anterior (Shift + ←)">⏮</button>
            <button id="b-m10" title="Recuar 10 s (J)">−10 s</button>
            <button id="b-m5" title="Recuar 5 s (←)">−5 s</button>
            <button id="b-play" class="big" title="Reproduzir / pausar (Espaço)">▶</button>
            <button id="b-p5" title="Avançar 5 s (→)">+5 s</button>
            <button id="b-p10" title="Avançar 10 s (L)">+10 s</button>
            <button id="b-nextv" title="Vídeo seguinte (Shift + →)">⏭</button>
          </div>
          <div class="grp">
            <button id="b-fb" title="Uma imagem para trás ( , )">◂ imagem</button>
            <button id="b-ff" title="Uma imagem para a frente ( . )">imagem ▸</button>
            <button id="b-in" title="Marcar entrada (I)">[ Entrada</button>
            <button id="b-out" title="Marcar saída (O)">Saída ]</button>
            <button id="b-clr" title="Limpar trecho (X)">✕</button>
          </div>
          <div class="grp">
            <label class="inline">Velocidade <select id="pv-speed">${[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 4].map((s) => `<option value="${s}" ${s === 1 ? "selected" : ""}>${s}×</option>`).join("")}</select></label>
            <label class="inline">Volume <input type="range" id="pv-vol" min="0" max="1" step="0.05" value="1"></label>
            <label class="inline"><input type="checkbox" id="pv-auto" checked> Seguinte</label>
          </div>
          <div class="grp end">
            <button id="b-theater" title="Maximizar dentro da página (T)">⤢ Maximizar</button>
            <button id="b-fs" title="Ecrã inteiro (F)">⛶ Ecrã inteiro</button>
            <button class="ghost" data-close>Fechar ✕</button>
          </div>
        </div>
        <div class="player-info"><b id="pv-name"></b><span class="muted small" id="pv-meta"></span><span class="muted small" id="pv-count"></span></div>
        <div class="muted small keys">Espaço ▶/⏸ · ←/→ ±5 s · J/L ±10 s · , . imagem a imagem · I/O trecho · X limpar · T maximizar · F ecrã inteiro · M som · 0–9 salta · Shift+←/→ outro vídeo</div>
      </div>
      <aside class="player-list">
        <div class="player-list-head"><b>Biblioteca</b><span class="muted small">${items.length} vídeos</span></div>
        <input id="pv-q" placeholder="Procurar vídeo…">
        <div id="pv-items"></div>
      </aside>
    </div>`);
  const video = $("pv"), player = $("player");
  const dur = () => (isFinite(video.duration) ? video.duration : 0);
  const clampT = (t) => Math.max(0, Math.min(dur() || t, t));
  const seek = (t) => { video.currentTime = clampT(t); paint(); };
  const skip = (d) => seek(video.currentTime + d);
  const pct = (t) => (dur() ? (100 * t) / dur() : 0);

  const paint = () => {
    const t = video.currentTime;
    $("pv-cur").textContent = tc(t);
    $("pv-dur").textContent = tc(dur());
    $("pv-played").style.width = pct(t) + "%";
    $("pv-knob").style.left = pct(t) + "%";
    const b = video.buffered;
    $("pv-buf").style.width = b.length ? pct(b.end(b.length - 1)) + "%" : "0%";
    const a = loopIn ?? 0, z = loopOut ?? dur();
    const l = $("pv-loop");
    l.style.display = loopIn !== null || loopOut !== null ? "block" : "none";
    l.style.left = pct(a) + "%";
    l.style.width = Math.max(0, pct(z) - pct(a)) + "%";
    $("b-play").textContent = video.paused ? "▶" : "⏸";
  };
  const toggle = () => (video.paused ? video.play().catch(() => {}) : video.pause());

  // timeline: click or drag anywhere on it
  const scrub = $("pv-scrub");
  const at = (e) => { const r = scrub.getBoundingClientRect(); seek(((e.clientX - r.left) / r.width) * dur()); };
  scrub.onpointerdown = (e) => { dragging = true; scrub.setPointerCapture(e.pointerId); at(e); };
  scrub.onpointermove = (e) => { if (dragging) at(e); };
  scrub.onpointerup = scrub.onpointercancel = () => { dragging = false; };

  const drawList = () => {
    const shown = items.map((it, i) => [it, i]).filter(([it]) => it.name.toLowerCase().includes(q));
    $("pv-items").innerHTML = shown.length ? shown.map(([it, i]) => `
      <button class="pl-item ${i === index ? "now" : ""}" data-i="${i}">
        <span class="pl-thumb"><video preload="metadata" muted src="${url(it)}#t=0.1"></video></span>
        <span class="pl-text"><b>${esc(it.name)}</b><small>${esc(it.group)} · ${size(it.size)}</small></span>
        <span class="pl-no">${i === index ? "▶" : i + 1}</span>
      </button>`).join("") : '<div class="muted small" style="padding:12px">Nenhum vídeo com esse nome.</div>';
    $("pv-items").querySelector(".now")?.scrollIntoView({ block: "nearest" });
  };
  const play = (i) => {
    if (i < 0 || i >= items.length) return;
    index = i;
    loopIn = loopOut = null;
    const it = items[i];
    video.src = url(it);
    video.playbackRate = Number($("pv-speed").value);
    video.play().catch(() => {});
    $("pv-name").textContent = it.name;
    $("pv-meta").textContent = where(it);
    $("pv-count").textContent = `${i + 1} / ${items.length}`;
    $("b-prevv").disabled = i === 0;
    $("b-nextv").disabled = i === items.length - 1;
    drawList();
    paint();
  };

  video.onloadedmetadata = () => { $("pv-meta").textContent = `${video.videoWidth}×${video.videoHeight} · ${tc(video.duration)} · ${where(items[index])}`; paint(); };
  video.ontimeupdate = () => {
    if (loopOut !== null && video.currentTime >= loopOut) video.currentTime = loopIn ?? 0;
    paint();
  };
  video.onplay = video.onpause = video.onprogress = video.onseeked = paint;
  video.onended = () => { if (loopIn !== null) { video.currentTime = loopIn; video.play(); } else if (auto && index < items.length - 1) play(index + 1); };
  const ticker = setInterval(() => { if (!document.getElementById("pv")) clearInterval(ticker); else if (!video.paused) paint(); }, 100);

  $("pv-stage").onclick = toggle;
  $("pv-stage").ondblclick = () => $("b-fs").click();
  $("b-play").onclick = toggle;
  $("b-m10").onclick = () => skip(-10); $("b-m5").onclick = () => skip(-5);
  $("b-p5").onclick = () => skip(5); $("b-p10").onclick = () => skip(10);
  $("b-prevv").onclick = () => play(index - 1); $("b-nextv").onclick = () => play(index + 1);
  $("b-fb").onclick = () => { video.pause(); skip(-1 / FPS); };
  $("b-ff").onclick = () => { video.pause(); skip(1 / FPS); };
  $("b-in").onclick = () => { loopIn = video.currentTime; if (loopOut !== null && loopOut <= loopIn) loopOut = null; paint(); };
  $("b-out").onclick = () => { loopOut = video.currentTime; if (loopIn === null) loopIn = 0; paint(); };
  $("b-clr").onclick = () => { loopIn = loopOut = null; paint(); };
  $("pv-speed").onchange = () => { video.playbackRate = Number($("pv-speed").value); };
  $("pv-vol").oninput = () => { video.volume = Number($("pv-vol").value); video.muted = false; };
  $("pv-auto").onchange = (e) => { auto = e.target.checked; };
  $("pv-q").oninput = (e) => { q = e.target.value.trim().toLowerCase(); drawList(); };
  $("pv-items").onclick = (e) => { const b = e.target.closest(".pl-item"); if (b) play(Number(b.dataset.i)); };

  // two ways to make it big: fill the page, or the whole screen
  $("b-theater").onclick = () => {
    box.classList.toggle("theater");
    $("b-theater").textContent = box.classList.contains("theater") ? "⤡ Minimizar" : "⤢ Maximizar";
  };
  $("b-fs").onclick = () => (document.fullscreenElement ? document.exitFullscreen() : player.requestFullscreen?.().catch(() => {}));
  const fsChange = () => { $("b-fs") && ($("b-fs").textContent = document.fullscreenElement ? "⛶ Sair do ecrã inteiro" : "⛶ Ecrã inteiro"); };
  document.addEventListener("fullscreenchange", fsChange);

  box.onkeydown = (e) => {
    if (e.target.matches("input[type=text], input:not([type]), select")) return;
    const k = e.key.toLowerCase();
    const act = {
      " ": toggle, k: toggle, arrowleft: () => (e.shiftKey ? play(index - 1) : skip(-5)), arrowright: () => (e.shiftKey ? play(index + 1) : skip(5)),
      j: () => skip(-10), l: () => skip(10), ",": () => $("b-fb").click(), ".": () => $("b-ff").click(), i: () => $("b-in").click(), o: () => $("b-out").click(),
      x: () => $("b-clr").click(), t: () => $("b-theater").click(), f: () => $("b-fs").click(), m: () => { video.muted = !video.muted; },
      home: () => seek(0), end: () => seek(dur()),
    }[k];
    if (act) { e.preventDefault(); act(); }
    else if (/^[0-9]$/.test(k)) { e.preventDefault(); seek((dur() * Number(k)) / 10); }
  };
  box.tabIndex = -1;
  box.focus();
  play(index);
}

function renderMedia(body, ctx) {
  const isVideo = ctx.data.kind === "videos", manage = !!ctx.data.manage;
  const base = `/api/hub/${ctx.company.id}/${ctx.section.id}`;
  let items = ctx.data.items, trash = [], view = "gallery", group = "", folder = "", q = "", playlist = [];
  body.insertAdjacentHTML("beforeend", `
    <div class="gallery-bar">
      <div class="seg" id="g-view"></div>
      <input id="g-q" placeholder="🔍 Procurar pelo nome…">
    </div>
    <div class="chips" id="groups"></div><div class="chips" id="folders"></div>
    <div class="media-grid" id="media"></div>`);

  const list = () => (view === "trash" ? trash : items);
  const find = (id) => list().find((it) => it.id === id);
  const draw = () => {
    const all = list(), groups = [...new Set(all.map((i) => i.group))], folders = [...new Set(all.map((i) => i.folder).filter(Boolean))].sort();
    $("g-view").innerHTML = `<button class="${view === "gallery" ? "on" : ""}" data-view="gallery">Galeria <i>${items.length}</i></button>` +
      (manage ? `<button class="${view === "trash" ? "on" : ""}" data-view="trash">Lixo <i>${trash.length}</i></button>` : "");
    $("groups").innerHTML = groups.length > 1 ? ["", ...groups].map((g) => `<span class="chip ${g === group ? "active" : ""}" data-g="${esc(g)}">${esc(g || "Tudo")}</span>`).join("") : "";
    $("folders").innerHTML = folders.length ? '<span class="chip-label">Pastas</span>' + ["", ...folders].map((f) => `<span class="chip ${f === folder ? "active" : ""}" data-f="${esc(f)}">${esc(f || "Todas")}</span>`).join("") : "";
    const shown = all.filter((it) => (!group || it.group === group) && (!folder || it.folder === folder) && it.name.toLowerCase().includes(q)).slice(0, 400);
    playlist = shown;
    $("media").innerHTML = shown.length ? shown.map((it, n) => {
      const url = mediaUrl(ctx, it.id);
      return `<div class="media ${view === "trash" ? "in-trash" : ""}" data-id="${esc(it.id)}" style="--i:${Math.min(n, 14)}">
        <div class="thumb">${isVideo ? `<video preload="metadata" src="${url}#t=0.1" muted></video><span class="play">▶</span>` : `<img loading="lazy" src="${url}" alt="${esc(it.name)}">`}</div>
        ${manage ? `<button class="dots" data-menu="${esc(it.id)}" aria-label="Opções de ${esc(it.name)}" title="Opções">⋯</button>` : ""}
        <div class="cap"><b title="${esc(it.name)}">${esc(it.name)}</b><span class="muted">${it.folder ? "📁 " + esc(it.folder) + " · " : ""}${esc(it.group)} · ${size(it.size)}</span></div></div>`;
    }).join("") : `<div class="empty wide-empty">${view === "trash" ? "O lixo está vazio. O que mandares para aqui pode sempre ser restaurado." : "Nada para mostrar com este filtro."}</div>`;
  };

  const reload = async () => {
    const [d, t] = await Promise.all([api(base), manage ? api(`${base}/trash`) : { items: [] }]);
    ctx.data = d; items = d.items; trash = t.items; draw();
  };
  const post = async (action, id, extra = {}) => {
    try { await api(`${base}/item/${action}`, { method: "POST", body: { id, ...extra } }); closeModal(); await reload(); return true; }
    catch (err) { const box = $("op-error"); if (box) box.textContent = err.message; else flash(err.message); return false; }
  };
  const view_ = (it) => (isVideo && view !== "trash" ? openPlayer(ctx, playlist.length ? playlist : list(), it)
    : openModal(`<div class="modal-head"><b>${esc(it.name)}</b><button class="ghost" data-close>Fechar ✕</button></div>${isVideo
      ? `<video controls autoplay src="${mediaUrl(ctx, it.id)}"></video>` : `<img src="${mediaUrl(ctx, it.id)}" alt="">`}`));

  const ask = {
    rename(it) {
      openModal(`<h3>Mudar o nome</h3><form id="op-form" class="form"><label class="wide">Novo nome<input id="op-name" value="${esc(it.name)}" required maxlength="120"></label>
        <p class="error wide" id="op-error"></p><div class="wide"><button class="primary">Guardar</button> <button type="button" class="ghost" data-close>Cancelar</button></div></form>`);
      const input = $("op-name"); input.focus(); input.setSelectionRange(0, it.name.lastIndexOf(".") > 0 ? it.name.lastIndexOf(".") : it.name.length);
      $("op-form").onsubmit = async (e) => { e.preventDefault(); if (await post("rename", it.id, { name: input.value })) flash("Nome alterado"); };
    },
    move(it) {
      const folders = [...new Set(items.map((i) => i.folder).filter(Boolean))].sort();
      openModal(`<h3>Mover para uma pasta</h3><form id="op-form" class="form">
        <label class="wide">Pasta existente<select id="op-folder"><option value="">(pasta principal)</option>${folders.map((f) => `<option ${f === it.folder ? "selected" : ""}>${esc(f)}</option>`).join("")}</select></label>
        <label class="wide">…ou cria uma nova<input id="op-new" placeholder="ex: Campanha Natal/Reels" maxlength="120"></label>
        <p class="error wide" id="op-error"></p><div class="wide"><button class="primary">Mover</button> <button type="button" class="ghost" data-close>Cancelar</button></div></form>`);
      $("op-form").onsubmit = async (e) => { e.preventDefault(); if (await post("move", it.id, { folder: $("op-new").value.trim() || $("op-folder").value })) flash("Movido"); };
    },
  };

  const openMenu = (btn, it) => {
    closeMenu();
    const entries = view === "trash"
      ? [["restore", "↩ Restaurar"], ["view", "👁 Ver em grande"]]
      : [["view", "👁 Ver em grande"], ["rename", "✎ Mudar o nome"], ["move", "📁 Mover / organizar"], ["trash", "🗑 Mandar para o lixo", "danger"]];
    const menu = document.createElement("div");
    menu.className = "pop-menu";
    menu.innerHTML = entries.map(([act, label, tone = ""]) => `<button class="${tone}" data-act="${act}">${label}</button>`).join("");
    document.body.append(menu);
    const r = btn.getBoundingClientRect();
    menu.style.top = Math.min(r.bottom + 6, innerHeight - menu.offsetHeight - 8) + "px";
    menu.style.left = Math.max(8, Math.min(r.right - menu.offsetWidth, innerWidth - menu.offsetWidth - 8)) + "px";
    menu.onclick = async (e) => {
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (!act) return;
      closeMenu();
      if (act === "view") view_(it);
      else if (ask[act]) ask[act](it);
      else {
        const card = body.querySelector(`.media[data-id="${CSS.escape(it.id)}"]`);
        card?.classList.add("leaving");
        await new Promise((ok) => setTimeout(ok, 220));
        if (await post(act, it.id)) flash(act === "trash" ? "Mandado para o Lixo. Podes restaurá-lo lá." : "Restaurado");
        else card?.classList.remove("leaving");
      }
    };
  };

  body.onclick = (e) => {
    const t = e.target;
    if (t.dataset.view) { view = t.dataset.view; group = folder = ""; draw(); return; }
    if (t.dataset.g !== undefined) { group = t.dataset.g; draw(); return; }
    if (t.dataset.f !== undefined) { folder = t.dataset.f; draw(); return; }
    const dots = t.closest(".dots");
    if (dots) { openMenu(dots, find(dots.dataset.menu)); return; }
    const card = t.closest(".media");
    if (card && find(card.dataset.id)) view_(find(card.dataset.id));
  };
  $("g-q").oninput = (e) => { q = e.target.value.trim().toLowerCase(); draw(); };
  draw();
  if (manage) api(`${base}/trash`).then((t) => { trash = t.items; draw(); }).catch(() => {});
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
    ${pageHead("Tarefas", "O que cada agente está a fazer")}
    <div class="section-title">Nova tarefa</div>
    <form id="task-form" class="card form">
      <input id="t-title" placeholder="Título" required>
      <input id="t-goal" placeholder="Objetivo">
      <select id="t-project"><option value="">Sem empresa</option>${companies.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("")}</select>
      <select id="t-assignee">${users.filter((u) => me.lead || u.username === me.username).map((u) => `<option value="${esc(u.username)}">${esc(u.display_name)}</option>`).join("")}</select>
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
    <div class="page-head">${pageHead("Agentes", "Quem está ligado e o que está a fazer")}
      <button id="agent-token">${icon("key")}O meu token de agente</button></div>
    <p id="token-box" class="card" hidden></p>
    <form id="higgs-form" class="card" style="margin-top:16px">
      <b>O meu Higgsfield</b> <span class="muted">· quanto dos créditos já gastei (o Higgsfield não deixa ler isto sozinho)</span>
      <div class="range-row" style="margin-top:12px">
        <input id="higgs-range" type="range" min="0" max="100" value="0"><b id="higgs-val">0%</b>
        <button class="primary">Guardar</button>
      </div>
    </form>
    <div class="section-title">Agentes</div>
    <div class="grid" id="team"></div>
    ${me.lead ? `
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
    <div id="week"></div>
    <div class="chips" id="who-chips"></div><div class="timeline" id="timeline"></div>`;
  $("who-chips").onclick = (e) => { if (e.target.dataset.u !== undefined) { historyFilter = e.target.dataset.u; loadTimeline(); } };
  await Promise.all([loadWeek(), loadTimeline()]);
}

/* ---------- live updates ---------- */
const loaders = {
  presence: [loadTeam, loadAgents, loadStats, loadMeters], task: [loadTasks, loadToday, loadAgents, loadStats, checkNews, loadWeek], approval: [loadApprovals, loadStats, checkNews],
  activity: [loadRecent, loadTimeline, loadWeek], usage: [loadUsage, loadMeters],
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
  const ping = () => { if (ws.readyState === 1) ws.send("ping"); };
  let timer = null;
  ws.onopen = () => { $("live").textContent = "● ao vivo"; $("live").classList.add("live"); timer = setInterval(ping, 10000); };
  ws.onmessage = (e) => refresh(JSON.parse(e.data).type);
  ws.onclose = () => { clearInterval(timer); $("live").textContent = "a reconectar"; $("live").classList.remove("live"); if (token) setTimeout(connect, 3000); };
  document.addEventListener("visibilitychange", () => { if (!document.hidden) ping(); });
}

async function start() {
  try { me = await api("/api/me"); } catch { return; }
  $("login").hidden = true;
  $("app").hidden = false;
  $("whoami").textContent = me.team_mode ? me.display_name : `${me.display_name} · ${me.role}`;
  $("maximize").innerHTML = icon("expand");
  companies = await api("/api/hub/companies").catch(() => []);
  $("bell").onclick = openInbox;
  setInterval(() => drawHud(), 30000); // keeps the clock honest
  await loadStats().catch(() => {}); // names first, so every view shows Kovel/Marco/David
  render();
  checkNews().catch(() => {});
  setInterval(() => { loadWorktree().catch(() => {}); loadWeek().catch(() => {}); loadTodayKey().catch(() => {}); }, 8000); // uncommitted work shows up within seconds
  setInterval(() => loadCommits().catch(() => {}), 30000); // new commits from teammates show up by themselves
  setInterval(() => { loadTeam().catch(() => {}); loadAgents().catch(() => {}); loadStats().catch(() => {}); checkNews().catch(() => {}); loadRecent().catch(() => {}); loadToday().catch(() => {}); loadApprovals().catch(() => {}); }, 15000); // catches OFFLINE and new activity even if the socket dropped
  connect();
}

async function autoLogin() {
  const res = await fetch("/api/auth/auto", { method: "POST" }).catch(() => null);
  if (res?.ok) { token = (await res.json()).token; sessionStorage.setItem("token", token); return start(); }
  const ip = res ? (await res.json().catch(() => ({}))).detail?.ip : "";
  logout();
  if (ip) $("login-error").textContent = `Este computador (${ip}) ainda não está associado a ninguém. Entra como admin ou adiciona-o em IP_USERS.`;
}

token ? start() : autoLogin();
