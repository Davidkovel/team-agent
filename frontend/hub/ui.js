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

/* A section that lives in its own file, fetched the first time somebody opens it (docs/empresa-amg.md, regras de peso):
   the command center keeps growing by sections, and opening it must not get slower with each one. The file replaces
   the stand-in in HUB_VIEWS with the real view and brings its own stylesheet. */
const HUB_VERSION = (document.currentScript?.src.match(/[?&]v=([^&]+)/) || [])[1] || "";
const lazyFiles = {};
function lazyFile(file) {
  return (lazyFiles[file] ||= new Promise((ok, fail) => {
    const tag = file.endsWith(".css") ? Object.assign(document.createElement("link"), { rel: "stylesheet", href: `${file}?v=${HUB_VERSION}` })
      : Object.assign(document.createElement("script"), { src: `${file}?v=${HUB_VERSION}` });
    tag.onload = ok;
    tag.onerror = () => { delete lazyFiles[file]; fail(new Error(t("Não consegui abrir esta secção. Tenta outra vez."))); };
    document.head.append(tag);
  }));
}
function lazyView(id, script, style) {
  const standIn = async (route) => {
    await Promise.all([lazyFile(script), style ? lazyFile(style).catch(() => {}) : null]);
    if (HUB_VIEWS[id] === standIn) throw new Error(`${script}: HUB_VIEWS.${id} em falta`);
    return HUB_VIEWS[id](route);
  };
  HUB_VIEWS[id] = standIn;
}
lazyView("escritorio", "hub/crew.js", "hub/crew.css");   // the command centre (crew-board.js) runs on the cave's engine
lazyView("saude", "hub/health.js", "hub/office.css");
lazyView("empresa", "hub/crew.js", "hub/crew.css");
lazyView("mensagens", "hub/mensagens.js", "hub/mensagens.css");   // the team writes to each other (routers/messages.py)
lazyView("skills", "hub/skills.js", "hub/skills.css");   // the company's skills library: who masters each one
lazyView("galeria", "hub/galeria.js", "hub/galeria.css");   // Skills › Galeria: the best sites on the web, to steal ideas from
lazyView("kit", "hub/kit.js", "hub/kit.css");   // Trabalho › Kit do Claude: the same plugins and skills on every PC
lazyView("mercados", "hub/mercados.js", "hub/mercados.css"); // Mercados: TradingView, SEC, paper trading
lazyView("trading", "hub/trading-room.js", "hub/trading-room.css"); // Sala de Trading: the room's two traders, SMC, the big alert
lazyView("robos", "hub/robots.js", "hub/robots.css");
lazyView("gap", "hub/gap.js", "hub/gap.css"); // Gap da manhã: the gaps on the FundedNext MT5 quotes, told to everyone
lazyView("radar", "hub/radar.js", "hub/radar.css"); // Radar: os negócios de uma zona, o site de cada um auditado, por oportunidade
lazyView("etsy", "hub/etsy.js", "hub/etsy.css"); // Fábrica Etsy: Riddler, Catwoman e Joker a fazer a loja de print-on-demand
lazyView("sinal", "hub/sinal.js", "hub/sinal.css"); // Sinal na notícia: BUY/SELL the second a US figure is out
lazyView("fundednext", "hub/fundednext.js", "hub/fundednext.css"); // Painel FundedNext: the prop account, its objectives, ticket and statistics
lazyView("reforco", "hub/reforco.js", "hub/reforco.css"); // Reforço na notícia: the Hub adds to the trader's news position on MT5 // Escritório de Robôs: the robots at their desks, the FundedNext accounts by API

const HUB_ICONS = {
  folder: '<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>',
  bot: '<rect x="4" y="8" width="16" height="11" rx="3"/><path d="M12 8V4M9 13v1M15 13v1M2 13v2M22 13v2"/><circle cx="12" cy="3.5" r="1"/>',
  pulse: '<path d="M2 12h4l2.5-6 4 13 3-9 1.5 2H22"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  token: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 9.5h7M12 9.5V16"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>',
  chat: '<path d="M4 6.5A2.5 2.5 0 016.5 4h11A2.5 2.5 0 0120 6.5v7a2.5 2.5 0 01-2.5 2.5H10l-4.5 4v-4h0A1.5 1.5 0 014 14.5z"/><path d="M8.5 9h7M8.5 12h4.5"/>',
  link: '<path d="M10 14a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1"/><path d="M14 10a5 5 0 00-7 0l-3 3a5 5 0 007 7l1-1"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1-1.5 1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1 1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.9.3h0a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9v0a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>',
  bell: '<path d="M6 17V11a6 6 0 1112 0v6l2 2H4z"/><path d="M10 21a2 2 0 004 0"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  spark: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  candles: '<path d="M7 3v4M7 15v6M17 3v8M17 17v4"/><rect x="5" y="7" width="4" height="8" rx="1"/><rect x="15" y="11" width="4" height="6" rx="1"/>',
  news: '<rect x="3" y="5" width="14" height="15" rx="2"/><path d="M17 9h3v9a2 2 0 01-2 2M7 9h6M7 13h6M7 16h4"/>',
  eye: '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  flask: '<path d="M9 3h6M10 3v6L4.5 18.5A1.7 1.7 0 006 21h12a1.7 1.7 0 001.5-2.5L14 9V3"/><path d="M7.5 15h9"/>',
  grid: '<rect x="3" y="3" width="8" height="10" rx="1.5"/><rect x="13" y="3" width="8" height="6" rx="1.5"/><rect x="13" y="11" width="8" height="10" rx="1.5"/><rect x="3" y="15" width="8" height="6" rx="1.5"/>',
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
  // Início
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.4"/><path d="M12 12l6.5-6.5M16 4.8h3.2V8"/>',
  bolt: '<path d="M13.5 2.5L4.5 14h7l-1 7.5 9-11.5h-7z"/>',
  note: '<rect x="5" y="3" width="14" height="18" rx="2.6"/><path d="M8.6 8h6.8M8.6 12h6.8M8.6 16h4.4"/>',
  tick: '<path d="M6 12.6l4 4 8-9"/>',
  chevron: '<path d="M9.5 6l6 6-6 6"/>',
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
  // the eyebrow over every title is the page's section of the sidebar («04 · Trading»), so all pages say where they are
  // the same way; the eyebrow a page passes is used only for a page outside the sidebar (docs/hub-paginas.md)
  head: (eyebrow, title, sub = "", actions = "") => {
    const where = typeof navOf === "function" && typeof route === "function" ? navOf(route().tab) : null;
    const above = where ? `${where.section[0]} · ${t(where.section[1])}` : eyebrow ? t(eyebrow) : "";
    return `<header class="ph"><div>${above ? `<div class="ph-eyebrow">${esc(above)}</div>` : ""}
    <h1>${esc(title)}</h1>${sub ? `<p>${esc(sub)}</p>` : ""}</div><div class="ph-actions">${actions}${ui.live()}</div></header>`;
  },
  sec: (title, right = "") => `<div class="sec"><span>${esc(t(title))}</span>${right}</div>`,
  btn: (label, attrs = "", cls = "", ic = "") => `<button class="btn ${cls}" ${attrs}>${ic ? icon(ic) : ""}${esc(t(label))}</button>`,
  // a figure, or the plain statement that there is none: never a made-up zero
  num: (value, cls = "") => (value == null ? `<span class="num none">${t("Sem dados")}</span>` : `<span class="num ${cls}">${value}</span>`),
  feed(items) {
    return items.map((a) => `<div class="fd ${a.tone || ""} ${a.fresh ? "new" : ""}"><time>${fmt.hhmm(a.at)}</time><i class="dot"></i>
      <p>${a.who ? `<b>${esc(a.who)}</b> ` : ""}${esc(a.text)}</p></div>`).join("");
  },

  /* ---------- Painel (hub/painel.css, 27 out 2026): the dashboard pieces every page builds its figures from ----------
     Only real series go in: a page with no history for a figure leaves the chart out instead of drawing a flat line. */
  // how many people are on now, beside the title of every page («1 de 3 online»); app.js drawHud keeps it current
  live() {
    const team = typeof hudData !== "undefined" && hudData ? hudData.team : null;
    if (!team) return `<span class="pn-live off" data-pn-live><i></i>${t("Equipa")}</span>`;
    const on = team.filter((m) => m.status !== "OFFLINE").length;
    return `<span class="pn-live ${on ? "" : "off"}" data-pn-live title="${esc(team.filter((m) => m.status !== "OFFLINE").map((m) => m.display_name).join(", "))}"><i></i><b>${on}</b>${t("de {n} online", { n: team.length })}</span>`;
  },
  // the change from the period before as a chip: ▲ 12% / ▼ 3%. badUp: a cost, where going up is the bad news
  delta(now, before, { badUp = false, unit = "%", label = "" } = {}) {
    if (now == null || before == null || !isFinite(now) || !isFinite(before)) return "";
    let text, dir;
    if (unit === "%") {
      if (!before) { if (!now) return ""; dir = "up"; text = t("novo"); }
      else { const p = ((now - before) / Math.abs(before)) * 100; dir = Math.abs(p) < 0.5 ? "eq" : p > 0 ? "up" : "dn"; text = `${Math.abs(p) >= 100 ? Math.round(Math.abs(p)) : Math.abs(p).toFixed(1).replace(".", ",")}%`; }
    } else { const d = now - before; dir = d === 0 ? "eq" : d > 0 ? "up" : "dn"; text = `${Math.abs(d).toLocaleString("pt-PT")}${unit}`; }
    const arrow = dir === "eq" ? '<path d="M5 12h14"/>' : dir === "up" ? '<path d="M12 19V5M6 11l6-6 6 6"/>' : '<path d="M12 5v14M6 13l6 6 6-6"/>';
    return `<span class="pn-delta ${dir} ${badUp ? "bad-up" : ""}" ${label ? `title="${esc(label)}"` : ""}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${arrow}</svg>${esc(text)}</span>`;
  },
  // a smooth line through the values (left to right, oldest first), with a soft area under it and a dot on the last one
  spark(values, { prev = null, w = 116, h = 38, area = true } = {}) {
    const vals = (values || []).map(Number).filter((v) => isFinite(v));
    if (vals.length < 2) return "";
    const all = prev ? vals.concat(prev.map(Number).filter(isFinite)) : vals;
    const lo = Math.min(...all), hi = Math.max(...all), span = hi - lo || 1;
    const pts = (list) => list.map((v, i) => [(i / (list.length - 1)) * w, h - 3 - ((v - lo) / span) * (h - 6)]);
    const p = pts(vals), d = smoothPath(p);
    return `<svg class="pn-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
      ${prev && prev.length > 1 ? `<path class="prev" d="${smoothPath(pts(prev))}"/>` : ""}
      ${area ? `<path class="area" d="${d} L${w} ${h} L0 ${h} Z"/>` : ""}<path class="line" d="${d}"/>
      <circle class="dot" cx="${p[p.length - 1][0].toFixed(1)}" cy="${p[p.length - 1][1].toFixed(1)}" r="2.6"/></svg>`;
  },
  // small columns, the last one (or hi) lit
  cols(values, { hi = null, fat = false } = {}) {
    const vals = (values || []).map((v) => Math.max(0, Number(v) || 0));
    if (!vals.length) return "";
    const max = Math.max(1e-9, ...vals), lit = hi == null ? vals.length - 1 : hi;
    return `<span class="pn-cols ${fat ? "fat" : ""}" aria-hidden="true">${vals.map((v, i) => `<i class="${i === lit ? "hi" : ""}" style="height:${Math.max(6, (v / max) * 100).toFixed(1)}%"></i>`).join("")}</span>`;
  },
  // a ring with the share in the middle (0–100)
  ring(pct, { text = null } = {}) {
    if (pct == null || !isFinite(pct)) return "";
    const p = Math.max(0, Math.min(100, pct)), c = 2 * Math.PI * 18;
    return `<svg class="pn-ring" viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="18"/><circle cx="22" cy="22" r="18" stroke-dasharray="${((p / 100) * c).toFixed(1)} ${c.toFixed(1)}"/>
      <text x="22" y="22">${esc(text ?? `${Math.round(p)}%`)}</text></svg>`;
  },
  /* A figure on top of a page: label, number, the change, a small chart, a line under it and where it goes.
     ui.kpi({label, value, delta, viz, sub, src, href, go}); the first of a ui.kpis row is the lit one (chrome). */
  kpi({ label, value, delta = "", viz = "", sub = "", src = "", href = "", go = "", cls = "", hint = "" } = {}) {
    const tag = href ? "a" : "div";
    return `<${tag} class="panel pn-kpi ${href ? "hover" : ""} ${cls}"${href ? ` href="${href}"` : ""}${hint ? ` title="${esc(hint)}"` : ""}>
      <small>${esc(t(label))}</small>
      <div class="pn-row"><div>${ui.num(value)}${delta ? `<span>${delta}</span>` : ""}</div>${viz ? `<span class="pn-viz">${viz}</span>` : ""}</div>
      ${sub || src || go ? `<div class="pn-foot">${sub ? `<em>${esc(sub)}</em>` : ""}${src ? ui.src(src) : ""}${go ? `<span class="pn-go">${esc(t(go))} →</span>` : ""}</div>` : ""}</${tag}>`;
  },
  kpis: (cards) => `<div class="pn-kpis">${cards.filter(Boolean).join("")}</div>`,
  /* The big pieces of a page. A gauge (0..max) with the ticks of theirs, lit up to the value; a trend line over time with the
     period before dashed under it and the value of each point on hover; striped columns with the open period lit. */
  gauge(value, max = 100, { label = "", text = "", of = null } = {}) {
    if (value == null || !isFinite(value)) return "";
    const p = Math.max(0, Math.min(1, value / (max || 1))), R = 104, cx = 130, cy = 128, a0 = Math.PI, at = (f) => a0 - f * Math.PI;
    const xy = (f, r) => [cx + r * Math.cos(at(f)), cy - r * Math.sin(at(f))];
    const ticks = Array.from({ length: 37 }, (_, i) => { const f = i / 36, [x1, y1] = xy(f, R + 16), [x2, y2] = xy(f, R + (i % 6 ? 22 : 26));
      return `<line class="tick ${f <= p + 1e-6 ? "on" : ""}" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`; }).join("");
    const [sx, sy] = xy(0, R), [ex, ey] = xy(p, R), [fx, fy] = xy(1, R);
    return `<div class="pn-gauge"><svg viewBox="0 0 260 150" aria-hidden="true"><defs><linearGradient id="pn-chrome" x1="0" x2="1">
        <stop offset="0" stop-color="#7d858f"/><stop offset=".55" stop-color="#e9edf1"/><stop offset="1" stop-color="#ffffff"/></linearGradient></defs>${ticks}
      <path class="track" d="M${sx} ${sy} A${R} ${R} 0 0 1 ${fx.toFixed(1)} ${fy.toFixed(1)}"/>
      ${p > 0 ? `<path class="fill" d="M${sx} ${sy} A${R} ${R} 0 0 1 ${ex.toFixed(1)} ${ey.toFixed(1)}"/>` : ""}
      <circle class="knob" cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="8"/>
      <text class="val" x="${cx}" y="${cy - 12}">${esc(text || String(Math.round(value)))}</text>
      <text class="of" x="${cx}" y="${cy + 10}">${esc(of ?? t("de {n}", { n: max }))}</text></svg>${label ? `<b>${esc(label)}</b>` : ""}</div>`;
  },
  // points: [{label, value, prev, tip}] oldest first; fmtY formats the axis and the tip
  trend(points, { fmtY = (v) => fmt.int(v), height = 200, showPrev = true } = {}) {
    if (!points || points.length < 2) return "";
    const W = 600, H = height, vals = points.map((p) => p.value || 0), prevs = points.map((p) => p.prev).filter((v) => v != null);
    const hi = Math.max(1e-9, ...vals, ...prevs) * 1.12, y = (v) => H - 4 - (v / hi) * (H - 14);
    const xy = (list) => list.map((v, i) => [(i / (points.length - 1)) * W, y(v || 0)]);
    const line = smoothPath(xy(vals)), prevOk = showPrev && prevs.length === points.length;
    const grid = [0.25, 0.5, 0.75, 1].map((f) => `<line class="grid" x1="0" x2="${W}" y1="${y(hi / 1.12 * f).toFixed(1)}" y2="${y(hi / 1.12 * f).toFixed(1)}"/>`).join("");
    const step = Math.max(1, Math.ceil(points.length / 8));
    return `<div class="pn-trend"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="height:${H}px" aria-hidden="true"><defs><linearGradient id="pn-fade" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stop-color="#e9edf1" stop-opacity=".22"/><stop offset="1" stop-color="#e9edf1" stop-opacity="0"/></linearGradient></defs>${grid}
      ${prevOk ? `<path class="prev" d="${smoothPath(xy(points.map((p) => p.prev)))}"/>` : ""}
      <path class="area" d="${line} L${W} ${H} L0 ${H} Z"/><path class="line" d="${line}"/></svg>
      <div class="pn-trend-hit">${points.map((p) => `<span><span class="pn-tip"><b>${esc(p.label)}</b>${esc(p.tip || fmtY(p.value))}${prevOk ? `<br><span style="opacity:.6">${t("antes")}: ${esc(fmtY(p.prev))}</span>` : ""}</span></span>`).join("")}</div>
      <div class="pn-trend-x">${points.map((p, i) => (i % step === 0 || i === points.length - 1 ? `<span>${esc(p.label)}</span>` : "")).join("")}</div></div>`;
  },
  // bars: [{label, value, tip}] oldest first; hi = index lit (the last by default)
  bars(items, { hi = null, fmtV = (v) => fmt.int(v) } = {}) {
    if (!items || !items.length) return "";
    const max = Math.max(1e-9, ...items.map((b) => b.value || 0)), lit = hi == null ? items.length - 1 : hi;
    return `<div class="pn-bars">${items.map((b, i) => `<div class="${i === lit ? "hi" : ""}"><span class="pn-tip"><b>${esc(b.label)}</b>${esc(b.tip || fmtV(b.value))}</span>
      <i style="height:${Math.max(3, ((b.value || 0) / max) * 100).toFixed(1)}%"></i><span>${esc(b.label)}</span></div>`).join("")}</div>`;
  },
  // two shares of one whole as a split bar with the two numbers over it («65% online · 34% in store» in theirs)
  share(a, b) {
    const total = (a.value || 0) + (b.value || 0);
    if (!total) return "";
    const pa = Math.round(((a.value || 0) / total) * 100);
    return `<div class="pn-share"><div class="pn-share-top"><span><b>${pa}%</b><small>${esc(a.label)}</small></span><span><b>${100 - pa}%</b><small>${esc(b.label)}</small></span></div>
      <div class="pn-share-bar"><i style="flex:${a.value || 0}"></i><i style="flex:${b.value || 0}"></i></div></div>`;
  },
};
/* Day by day from a list of records, for the charts of the Painel: the last n days (oldest first), each with what fell
   on it. byDay(tasks, (x) => x.completed_at, 7) → [{day: "2026-10-21", label: "ter", value: 2}, ...] (today last). */
const series = {
  days(n) {
    const out = [], d = new Date(); d.setHours(12, 0, 0, 0);
    for (let i = n - 1; i >= 0; i--) out.push(new Date(d.getTime() - i * 864e5));
    return out;
  },
  key: (date) => { const d = new Date(date); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; },
  label(date, n) {
    const d = new Date(date);
    if (series.key(d) === series.key(new Date())) return t("Hoje");
    return n <= 7 ? d.toLocaleDateString("pt-PT", { weekday: "short" }).replace(".", "") : String(d.getDate());
  },
  byDay(items, dateOf, n, valueOf = () => 1) {
    const days = series.days(n), at = Object.fromEntries(days.map((d, i) => [series.key(d), i])), vals = days.map(() => 0);
    for (const x of items || []) { const when = dateOf(x); if (!when) continue; const i = at[series.key(when)]; if (i != null) vals[i] += Number(valueOf(x)) || 0; }
    return days.map((d, i) => ({ day: series.key(d), label: series.label(d, n), value: vals[i] }));
  },
  // how much fell in [from, to) days ago: inPeriod(items, dateOf, 7, 14) = the week before this one
  inPeriod(items, dateOf, from, to, valueOf = () => 1) {
    const now = Date.now(), a = now - to * 864e5, b = now - from * 864e5;
    return (items || []).reduce((n, x) => { const w = dateOf(x) ? new Date(dateOf(x)).getTime() : NaN; return w >= a && w < b ? n + (Number(valueOf(x)) || 0) : n; }, 0);
  },
};
// a smooth curve through the points (Catmull-Rom as cubic Béziers), for ui.spark and ui.trend
function smoothPath(p) {
  if (p.length < 3) return p.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  let d = `M${p[0][0].toFixed(1)} ${p[0][1].toFixed(1)}`;
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] || p[i], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

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
