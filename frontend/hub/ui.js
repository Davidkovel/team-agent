// Team AI Hub: the language, and the components every page is built from.
// Loaded before app.js; everything here that touches app.js ($, api, icon...) does so only when called.

/* ---------- language ----------
   The interface is written in European Portuguese. A string is its own key: t("Aprovações").
   Another language is one more dictionary here, keyed by the Portuguese text; what it lacks stays in Portuguese. */
const I18N = { pt: {} };
let LANG = localStorage.getItem("hub.lang") || "pt";
function t(text, vars) {
  let s = (I18N[LANG] && I18N[LANG][text]) || text;
  if (vars) for (const k in vars) s = s.replaceAll(`{${k}}`, vars[k]);
  return s;
}

const HUB_VIEWS = {};    // page id -> async view(route)
const HUB_LOADERS = {};  // live event type -> [async loaders]
const onLive = (types, fn) => types.forEach((type) => (HUB_LOADERS[type] ||= []).push(fn));

const HUB_ICONS = {
  folder: '<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>',
  bot: '<rect x="4" y="8" width="16" height="11" rx="3"/><path d="M12 8V4M9 13v1M15 13v1M2 13v2M22 13v2"/><circle cx="12" cy="3.5" r="1"/>',
  pulse: '<path d="M2 12h4l2.5-6 4 13 3-9 1.5 2H22"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  token: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 9.5h7M12 9.5V16"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1-1.5 1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1 1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.9.3h0a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9v0a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>',
  bell: '<path d="M6 17V11a6 6 0 1112 0v6l2 2H4z"/><path d="M10 21a2 2 0 004 0"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  spark: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  alert: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17v.5"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  sidebar: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/>',
  sliders: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  arrow: '<path d="M7 17L17 7M9 7h8v8"/>',
  pause: '<path d="M9 5v14M15 5v14"/>',
  play: '<path d="M7 5l12 7-12 7z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  inbox: '<path d="M4 13l2.5-7h11L20 13v5a1 1 0 01-1 1H5a1 1 0 01-1-1z"/><path d="M4 13h4.5l1 2h5l1-2H20"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  bag: '<path d="M5 8h14l-1 12H6z"/><path d="M9 8V6a3 3 0 016 0v2"/>',
  trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  doc: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M10 12h5M10 16h5"/>',
  trash: '<path d="M4 7h16M9.5 4h5M6 7l1 13h10l1-13M10 11v5.5M14 11v5.5"/>',
};

/* ---------- formatting ---------- */
const fmt = {
  tokens: (n) => (n == null ? "—" : n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "k" : String(n)),
  int: (n) => (n == null ? "—" : Number(n).toLocaleString("pt-PT")),
  usd: (n) => (n == null ? "—" : "$" + Number(n).toFixed(2)),
  money: (n, currency) => Number(n).toLocaleString("pt-PT", { style: "currency", currency: currency || "EUR" }),
  hhmm: (iso) => (iso ? new Date(iso).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" }) : ""),
  date: (iso) => (iso ? new Date(iso).toLocaleDateString("pt-PT", { day: "2-digit", month: "short" }) : ""),
  // how long something has been going, or took: "24 min", "1 h 05"
  span: (from, to) => {
    if (!from) return "—";
    const start = typeof from === "number" ? from * 1000 : new Date(from).getTime();
    const min = Math.max(0, Math.round(((to ? new Date(to).getTime() : Date.now()) - start) / 60000));
    return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}`;
  },
  ago: (iso) => {
    if (!iso) return t("nunca");
    const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (min < 1) return t("agora");
    if (min < 60) return t("há {n} min", { n: min });
    if (min < 1440) return t("há {n} h", { n: Math.round(min / 60) });
    return t("há {n} d", { n: Math.round(min / 1440) });
  },
  day: (iso) => {
    const d = new Date(iso), today = new Date();
    const same = (a, b) => a.toDateString() === b.toDateString();
    if (same(d, today)) return t("Hoje");
    if (same(d, new Date(today.getTime() - 864e5))) return t("Ontem");
    return d.toLocaleDateString("pt-PT", { weekday: "long", day: "numeric", month: "long" });
  },
};

/* ---------- vocabulary shared by the pages ---------- */
const AGENT_ST = { WORKING: ["busy", "A trabalhar"], ONLINE: ["ok", "Online"], IDLE: ["ok", "Livre"], WAITING: ["wait", "À espera"],
  PAUSED: ["wait", "Em pausa"], ERROR: ["bad", "Erro"], OFFLINE: ["off", "Offline"],
  RUNNING: ["ai", "A correr"], DONE: ["ok", "Concluído"], INTERRUPTED: ["wait", "Interrompido"], STOPPED: ["off", "Parado"] };
const STAGES = [["todo", "Por fazer"], ["in_progress", "Em curso"], ["blocked", "Bloqueada"], ["review", "Em revisão"], ["approval", "Aprovação"], ["done", "Concluída"]];
const STAGE_LABEL = Object.fromEntries(STAGES);
const STAGE_TONE = { todo: "", in_progress: "ai", blocked: "bad", review: "warn", approval: "warn", done: "ok" };
const PRIORITY = { low: "Baixa", normal: "Normal", high: "Alta", urgent: "Urgente" };
const ROLES = { developer: "Claude Developer", research: "Agente de pesquisa", marketing: "Agente de marketing", testing: "Agente de testes", custom: "Agente à medida" };
const SOURCES = { live: ["●", "Ao vivo"], calculated: ["≈", "Calculado"], estimated: ["≈", "Estimado"], not_connected: ["○", "Não ligado"], no_data: ["○", "Sem dados"] };

/* ---------- components ---------- */
// The team's GitHub accounts, by the names a person shows up with (Hub name and git author names). The avatar is
// the GitHub profile picture; with no account, or when the picture does not load, the initial stays.
const GITHUB = { kovel: "Davidkovel", "david kovel": "Davidkovel", davidkovel: "Davidkovel", marco: "SLayer-marco", "marco goucha": "SLayer-marco",
  david: "Daviddsstt", daviddsstt: "Daviddsstt" };
const githubPhoto = (name) => {
  const login = GITHUB[(name || "").trim().toLowerCase()];
  return login ? `<img src="https://github.com/${login}.png?size=96" alt="" loading="lazy" onerror="this.remove()">` : "";
};

const ui = {
  status(status, label) {
    const [tone, text] = AGENT_ST[status] || ["off", status];
    return `<span class="st ${tone}"><i></i>${esc(label || t(text))}</span>`;
  },
  avatar: (name, cls = "") => `<span class="av ${cls}">${esc((name || "?").trim()[0]?.toUpperCase() || "?")}${cls.includes("ai") ? "" : githubPhoto(name)}</span>`,
  progress: (pct, cls = "") => `<div class="pg ${cls}"><i style="width:${Math.max(0, Math.min(100, Number(pct) || 0))}%"></i></div>`,
  tag: (text, cls = "") => `<span class="tagx ${cls}">${esc(text)}</span>`,
  // where a number comes from; shown beside every figure that is not plainly a record of the Hub
  src(source) {
    const [mark, text] = SOURCES[source] || SOURCES.no_data;
    return `<span class="src ${source}">${mark} ${t(text)}</span>`;
  },
  empty: (ic, title, text = "", action = "") =>
    `<div class="empty-state">${icon(ic)}<b>${esc(t(title))}</b>${text ? `<p>${esc(t(text))}</p>` : ""}${action}</div>`,
  error: (message) => `<div class="empty-state err">${icon("alert")}<b>${t("Algo correu mal")}</b><p>${esc(message || t("Não foi possível ligar ao Hub."))}</p>
    <button class="btn sm" data-retry>${t("Tentar outra vez")}</button></div>`,
  skeleton: (lines = 3) => `<div class="skel">${"<i></i>".repeat(lines)}</div>`,
  head: (eyebrow, title, sub = "", actions = "") => `<header class="ph"><div>${eyebrow ? `<div class="ph-eyebrow">${esc(t(eyebrow))}</div>` : ""}
    <h1>${esc(title)}</h1>${sub ? `<p>${esc(sub)}</p>` : ""}</div><div class="ph-actions">${actions}</div></header>`,
  sec: (title, right = "") => `<div class="sec"><span>${esc(t(title))}</span>${right}</div>`,
  btn: (label, attrs = "", cls = "", ic = "") => `<button class="btn ${cls}" ${attrs}>${ic ? icon(ic) : ""}${esc(t(label))}</button>`,
  // a figure, or the plain statement that there is none: never a made-up zero
  num: (value, cls = "") => (value == null ? `<span class="num none">${t("Sem dados")}</span>` : `<span class="num ${cls}">${value}</span>`),
  feed(items) {
    return items.map((a) => `<div class="fd ${a.tone || ""} ${a.fresh ? "new" : ""}"><time>${fmt.hhmm(a.at)}</time><i class="dot"></i>
      <p>${a.who ? `<b>${esc(a.who)}</b> ` : ""}${esc(a.text)}</p></div>`).join("");
  },
};

// The little markdown an AI answer comes with: bold and headings. Everything is escaped first.
const md = (text) => esc(text).replace(/^#{1,4} +(.+)$/gm, "<b>$1</b>").replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");

// Fill an element from the Hub: a skeleton while it loads, the content, or an error with a way to try again.
async function mount(el, render, lines = 3) {
  if (!el) return;
  if (!el._html) el.innerHTML = ui.skeleton(lines);
  try {
    paint(el, await render());
  } catch (e) {
    if (e.message === "unauthorized") return;
    el._html = null;
    el.innerHTML = ui.error(e.message);
    el.querySelector("[data-retry]").onclick = () => { el.innerHTML = ui.skeleton(lines); mount(el, render, lines); };
  }
}

// A form in the modal: fields by name, submit calls save(values); an error stays in the form instead of closing it.
function formModal(title, fieldsHtml, save, { submit = "Guardar", wide = false, danger = null } = {}) {
  openModal(`<h3>${esc(t(title))}</h3><form id="hub-form"><div class="form-grid">${fieldsHtml}</div>
    <p class="error" id="hub-form-error"></p>
    <div class="form-foot">${danger ? `<button type="button" class="btn danger" id="hub-form-danger" style="margin-right:auto">${esc(t(danger.label))}</button>` : ""}
      <button type="button" class="btn quiet" data-close>${t("Cancelar")}</button><button class="btn primary">${esc(t(submit))}</button></div></form>`);
  if (wide) $("modal-box").classList.add("wide");
  const form = $("hub-form");
  form.querySelector("input, textarea, select")?.focus();
  const fail = (e) => { $("hub-form-error").textContent = e.message; };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const values = Object.fromEntries(new FormData(form).entries());
    try { await save(values); closeModal(); } catch (err) { fail(err); }
  };
  if (danger) $("hub-form-danger").onclick = async () => { try { await danger.run(); closeModal(); } catch (err) { fail(err); } };
}
const field = (label, control, wide = false) => `<label class="field ${wide ? "wide" : ""}">${esc(t(label))}${control}</label>`;
const options = (pairs, selected) => pairs.map(([value, label]) => `<option value="${esc(value)}" ${String(value) === String(selected ?? "") ? "selected" : ""}>${esc(label)}</option>`).join("");

// What kind of thing an activity line is about, and how it should look in a timeline.
function activityKind(kind) {
  if (kind.startsWith("approval")) return "approvals";
  if (/^(hub_|agent_o|ponto)/.test(kind)) return "people";
  if (["task_action", "task_error", "help_requested"].includes(kind)) return "ai";
  if (kind.startsWith("task") || kind === "control") return "tasks";
  if (kind === "library_edit") return "companies";
  return "people";
}
function activityTone(a) {
  if (a.kind === "task_error" || a.kind === "agent_offline") return "bad";
  if (a.kind === "approval_requested" || a.kind === "help_requested") return "warn";
  if (a.kind === "task_status" && /^concluiu/.test(a.message)) return "ok";
  if (activityKind(a.kind) === "ai") return "ai";
  return "";
}
// the name is already in most messages ("Kovel ficou online"); add it only where the message has no subject
const activityItem = (a, fresh) => ({ at: a.created_at, text: a.message, who: a.message.startsWith(a.name || "\u0000") ? "" : a.name, tone: activityTone(a), fresh });
