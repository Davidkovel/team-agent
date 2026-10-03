// Home: the command center. A grid of widgets the person arranges: drag to reorder, pull the corner to resize,
// hide and bring back. The layout is kept per person in this browser.

/* ---------- the widgets ----------
   Each one: a title, an icon, a default size (columns of 12 x rows), the live events that refresh it, where its
   "see all" goes, and load() -> html. Loading, empty and error states come from the system (mount, ui.empty, ui.error). */
const WIDGETS = {
  repos: {
    title: "Os nossos projetos", icon: "code", w: 12, h: 1, href: "#/codigo", on: ["activity"], pad: true,
    async load() {
      const repos = await api("/api/repos");
      if (!repos.length) return ui.empty("code", "Sem projetos", "Ainda não há repositórios em library/repos.json.");
      return `<div class="repos">${repos.map((r, i) => {
        const top = Math.max(1, ...(r.days || []));
        return `<a class="repo ${i === 0 && r.last ? "lead" : ""} ${r.last ? "" : "idle"}" href="${esc(r.last?.url || r.url || "#/codigo")}" ${r.url ? 'target="_blank" rel="noopener"' : ""}>
          <span class="repo-mark">${esc(r.name.trim()[0].toUpperCase())}</span>
          <div class="rw-main"><div class="repo-name"><b>${esc(r.name)}</b>${i === 0 && r.last ? `<em>${t("último commit")}</em>` : ""}</div>
            <span>${r.last ? `${esc(r.last.author)} · ${fmt.ago(r.last.date)} — ${esc(r.last.message)}` : `${t("Sem acesso aos commits deste repositório")} · ${esc(r.github)}`}</span></div>
          ${r.last ? `<div class="repo-week" title="${t("Commits por dia, últimos 7 dias")}"><div class="spark">${(r.days || []).map((n) => `<i style="height:${n ? Math.max(12, Math.round(n / top * 100)) : 4}%" class="${n ? "" : "zero"}"></i>`).join("")}</div>
            <b>${r.week_commits}</b><small>${t("commits · 7 dias")}</small></div>` : ""}</a>`;
      }).join("")}</div>`;
    },
  },
  people: {
    title: "Cada um hoje", icon: "users", w: 12, h: 2, href: "#/tarefas", on: ["task", "presence", "activity"], pad: true,
    async load() {
      const [team, tasks, rank] = await Promise.all([api("/api/team"), api("/api/tasks"), api("/api/analytics/ranking")]);
      const today = new Date().toDateString();
      return `<div class="people">${team.map((m) => {
        const mine = tasks.filter((x) => x.assignee === m.user);
        const open = mine.filter((x) => x.stage !== "done");
        const done = mine.filter((x) => x.status === "COMPLETED" && x.completed_at && new Date(x.completed_at).toDateString() === today);
        const git = rank.today.find((p) => p.user === m.user) || { commits: 0, added: 0, deleted: 0 };
        return `<div class="person-day"><div class="rowx">${ui.avatar(m.display_name)}<b class="grow">${esc(m.display_name)}</b>${ui.status(m.status)}</div>
          <div class="pd-nums"><div><b>${open.length}</b><span>${t("por fazer")}</span></div><div><b>${done.length}</b><span>${t("feitas hoje")}</span></div>
            <div><b>${rank.source === "live" ? git.commits : "–"}</b><span>${t("commits hoje")}</span></div></div>
          <div class="pd-list">${[...done.map((x) => [x, true]), ...open.map((x) => [x, false])].slice(0, 5).map(([x, ok]) =>
            `<a href="#/tarefas/${x.id}" class="${ok ? "ok" : ""}"><i></i><span class="ell">${esc(x.title)}</span></a>`).join("")
            || `<span class="faint">${t("Sem tarefas.")}</span>`}
            ${open.length + done.length > 5 ? `<a href="#/tarefas" class="more">+${open.length + done.length - 5}</a>` : ""}</div></div>`;
      }).join("")}</div>`;
    },
  },
  work: {
    title: "Tarefas em curso", icon: "tasks", w: 6, h: 2, href: "#/tarefas", on: ["task", "presence", "session"],
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
    title: "Precisa de ti", icon: "alert", w: 6, h: 2, on: ["task", "approval", "presence"],
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
    title: "Ponto de hoje", icon: "clock", w: 12, h: 1, on: ["ponto"], pad: true,
    async load() {
      const board = await api("/api/ponto");
      const mine = board.people.find((p) => p.user === me.username);
      return `<div class="ponto-strip">${board.people.map((p) => `<div class="ponto-p ${p.at ? "in" : ""}">
          <span class="tick">${p.at ? icon("check") : ""}</span>
          <div class="rw-main"><b>${esc(p.name)}</b><span>${p.at ? fmt.hhmm(p.at) : t("por bater")}</span></div></div>`).join("")}
        ${mine && !mine.at ? `<button class="btn primary" data-punch>${t("Bater o ponto")}</button>` : ""}</div>`;
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
    title: "Equipa", icon: "users", w: 6, h: 2, href: "#/equipa", on: ["presence", "task"],
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
// Home starts short: the projects by latest commit, what each person has to do and did today, the work, then what needs the person and the team. The rest
// (gauges, agents, approvals, activity...) is one click away in "Personalizar" and on its own page.
const DEFAULT_LAYOUT = ["repos", "people", "work", "attention"];
const INSTRUMENTS = ["today", "usage", "cost"];

/* ---------- the cockpit: the front of an AMG, lights on ----------
   Drawn here (no image file): the Panamericana grille with the star, and the two headlights with the eyebrow
   daytime light and three star LEDs each. The left light is drawn once and mirrored for the right.
   The look is the angry one: slim lights slanting down into the grille, a tall grille, a big lit star, deep intakes. */
const HEADLIGHT = `
  <path d="M118 170C150 150 200 140 252 137L404 170C412 172 414 181 407 187L394 192C330 188 230 186 150 194C126 196 110 184 118 170Z"
    fill="url(#amg-glass)" stroke="rgba(255,255,255,.18)" stroke-width="1"/>
  <path d="M128 188C200 182 300 182 392 188" fill="none" stroke="rgba(255,255,255,.06)"/>
  <ellipse class="bloom" cx="262" cy="166" rx="160" ry="46" fill="url(#amg-bloom)"/>
  <path class="drl" d="M150 188C134 184 132 174 142 166C170 151 212 145 254 144L398 177"/>
  <g><use class="led" href="#amg-tri" x="212" y="156" width="16" height="16"/><use class="led" href="#amg-tri" x="260" y="160" width="16" height="16"/>
    <use class="led" href="#amg-tri" x="308" y="166" width="16" height="16"/></g>
  <path d="M96 232L352 218L384 296L140 310Z" fill="#030405" stroke="rgba(255,255,255,.1)"/>
  <path d="M168 238L190 302M214 234L234 300M260 230L278 298M306 227L322 296" stroke="rgba(255,255,255,.07)" stroke-width="2"/>
  <path d="M104 246L362 232" stroke="url(#amg-blade)" stroke-width="4" stroke-linecap="round"/>
  <path d="M60 206C80 196 100 192 118 192" fill="none" stroke="rgba(255,255,255,.12)"/>
  <ellipse class="floor" cx="250" cy="318" rx="200" ry="16" fill="url(#amg-bloom)" opacity=".9"/>`;
const GRILLE = "M425 140H575C588 140 594 148 596 158L618 262C620 274 612 284 600 284H400C388 284 380 274 382 262L404 158C406 148 412 140 425 140Z";
const SLATS = Array.from({ length: 26 }, (_, i) => `<rect x="${386 + i * 9}" y="140" width="3.2" height="146" rx="1.6" fill="url(#amg-slat)"/>`).join("");
const FASCIA = `<svg viewBox="0 0 1000 320" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
  <defs>
    <filter id="amg-glow" x="-30%" y="-80%" width="160%" height="260%"><feGaussianBlur stdDeviation="3.2" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <radialGradient id="amg-bloom"><stop offset="0" stop-color="#dce9ff" stop-opacity=".34"/><stop offset=".45" stop-color="#b9d0ff" stop-opacity=".1"/><stop offset="1" stop-color="#b9d0ff" stop-opacity="0"/></radialGradient>
    <linearGradient id="amg-body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b1f25"/><stop offset=".35" stop-color="#0d0f12"/><stop offset="1" stop-color="#050607"/></linearGradient>
    <linearGradient id="amg-hood" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <linearGradient id="amg-glass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1a1f27"/><stop offset="1" stop-color="#07090c"/></linearGradient>
    <linearGradient id="amg-slat" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4f6f8"/><stop offset=".45" stop-color="#8c949d"/><stop offset=".55" stop-color="#4a5159"/><stop offset="1" stop-color="#c4cad1"/></linearGradient>
    <linearGradient id="amg-blade" x1="0" x2="1"><stop offset="0" stop-color="#9aa2ab" stop-opacity=".2"/><stop offset=".6" stop-color="#eef1f4"/><stop offset="1" stop-color="#9aa2ab" stop-opacity=".4"/></linearGradient>
    <radialGradient id="amg-halo"><stop offset=".55" stop-color="#e8f0ff" stop-opacity=".0"/><stop offset=".72" stop-color="#e8f0ff" stop-opacity=".38"/><stop offset="1" stop-color="#e8f0ff" stop-opacity="0"/></radialGradient>
    <clipPath id="amg-grille"><path d="${GRILLE}"/></clipPath>
    <symbol id="amg-tri" viewBox="-10 -10 20 20"><path d="M0-9L1.7-1.2L8.2 5.2L0 2.1L-8.2 5.2L-1.7-1.2Z"/></symbol>
  </defs>
  <path d="M20 232C70 150 230 118 500 112C770 118 930 150 980 232L996 320H4Z" fill="url(#amg-body)"/>
  <path d="M44 214C120 142 270 118 500 114C730 118 880 142 956 214" fill="none" stroke="url(#amg-hood)" stroke-width="1.4"/>
  <path d="M300 118C360 128 392 140 420 140M700 118C640 128 608 140 580 140" fill="none" stroke="rgba(255,255,255,.14)"/>
  <path d="M440 114L452 140M560 114L548 140" fill="none" stroke="rgba(255,255,255,.08)"/>
  <g>${HEADLIGHT}</g>
  <g transform="translate(1000 0) scale(-1 1)">${HEADLIGHT}</g>
  <path d="${GRILLE}" fill="#030405"/>
  <g clip-path="url(#amg-grille)">${SLATS}</g>
  <path d="${GRILLE}" fill="none" stroke="url(#amg-slat)" stroke-width="3.5"/>
  <circle class="halo" cx="500" cy="212" r="66" fill="url(#amg-halo)"/>
  <circle cx="500" cy="212" r="47" fill="#040506"/>
  <circle class="halo-ring" cx="500" cy="212" r="47.5" fill="none" stroke="#eef5ff" stroke-width="1.6" filter="url(#amg-glow)"/>
  <image href="assets/mercedes-star.svg" x="456" y="168" width="88" height="88"/>
  <path d="M300 298H700L734 320H266Z" fill="#030405" stroke="rgba(255,255,255,.08)"/>
  <path d="M268 319H732" stroke="url(#amg-blade)" stroke-width="2.5"/>
</svg>`;

// The rev counter of the cockpit: the team's commits of today. Ten is the top of the scale, the last fifth is red.
const TACHO_MAX = 10;
const TACHO = `<a class="tacho" href="#/analise" title="${t("Commits da equipa hoje")}"><svg viewBox="0 0 100 100" aria-hidden="true">
  <path d="M20.3 79.7A42 42 0 1 1 79.7 79.7" fill="none" stroke="rgba(255,255,255,.14)" stroke-width="2.4" stroke-linecap="round"/>
  <path d="M91.5 43.4A42 42 0 0 1 79.7 79.7" fill="none" stroke="#d8402c" stroke-width="2.4" stroke-linecap="round"/>
  ${Array.from({ length: 11 }, (_, i) => { const a = (135 + 27 * i) * Math.PI / 180, r = i % 5 ? 37 : 34;
    return `<line x1="${(50 + r * Math.cos(a)).toFixed(1)}" y1="${(50 + r * Math.sin(a)).toFixed(1)}" x2="${(50 + 40 * Math.cos(a)).toFixed(1)}" y2="${(50 + 40 * Math.sin(a)).toFixed(1)}" stroke="${i > 8 ? "#d8402c" : "#aeb5bd"}" stroke-width="${i % 5 ? 1 : 1.8}"/>`; }).join("")}
  <g id="tacho-needle" style="transform: rotate(-135deg)"><path d="M49 52L50 15L51 52Z" fill="#ff5a3c"/></g>
  <circle cx="50" cy="50" r="5" fill="#15181c" stroke="#aeb5bd" stroke-width="1"/></svg>
  <b id="tacho-n">–</b><span>${t("commits hoje")}</span></a>`;
async function loadTacho() {
  if (!$("tacho-n")) return;
  const r = await api("/api/analytics/ranking");
  const n = r.today.reduce((sum, p) => sum + p.commits, 0);
  $("tacho-n").textContent = r.source === "live" ? n : "–";
  $("tacho-needle").style.transform = `rotate(${-135 + 270 * Math.min(n / TACHO_MAX, 1)}deg)`;
}

let cockpitClock = null;
function cockpitHtml(greeting, date) {
  // the start-up plays once per session; after that the lights are simply on
  let ignite = false;
  try { ignite = !sessionStorage.getItem("hub.ignited"); sessionStorage.setItem("hub.ignited", "1"); } catch { /* private window: no start-up */ }
  return `<section class="cockpit ${ignite ? "ignite" : ""}">
    <div class="fascia">${FASCIA}</div>
    <div class="cockpit-copy">
      <div class="ph-eyebrow">${t("Centro de comando")}</div>
      <h1>${esc(t(greeting))}, <em>${esc(me.display_name)}</em></h1>
      <p class="cockpit-date">${esc(date)}<i></i><time id="cockpit-clock">${new Date().toLocaleTimeString("pt-PT")}</time></p>
      <div class="cockpit-actions">
        ${TACHO}
        <a class="btn amg" href="#/tarefas">${t("Tarefas")}</a>
        <a class="btn amg" href="#/analise">${t("Análise")}</a>
        <button class="btn quiet" id="customize">${icon("sliders")}${t("Personalizar")}</button>
      </div>
    </div>
  </section>`;
}

/* ---------- the layout: order, size and visibility, kept per person ---------- */
const layoutKey = () => `hub.home6.${me.username}`; // "6": the Home that fits the screen; older saved layouts start over
function loadLayout() {
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem(layoutKey())) || []; } catch { /* a broken entry is the same as none */ }
  const known = saved.filter((item) => WIDGETS[item.id]);
  const missing = Object.keys(WIDGETS).filter((id) => !known.some((item) => item.id === id)) // never saved, or added since
    .sort((x, y) => (DEFAULT_LAYOUT.indexOf(x) + 1 || 99) - (DEFAULT_LAYOUT.indexOf(y) + 1 || 99));
  return [...known, ...missing.map((id) => ({ id, w: WIDGETS[id].w, h: WIDGETS[id].h, hidden: !DEFAULT_LAYOUT.includes(id) }))];
}
let layout = [];
const saveLayout = () => localStorage.setItem(layoutKey(), JSON.stringify(layout));
function setDensity(value) {
  localStorage.setItem("hub.density", value);
  document.documentElement.dataset.density = value;
}

function widgetHtml(item) {
  const w = WIDGETS[item.id];
  return `<section class="wg ${INSTRUMENTS.includes(item.id) ? "instr" : ""}" data-id="${item.id}" style="grid-column: span ${item.w}; grid-row: span ${item.h}; --w: ${item.w}">
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
  fitGrid();
}
// Home fits the screen: the rows share the height left under the cockpit, so nothing scrolls. With many widgets
// a row never gets shorter than MIN_ROW, and only then the page scrolls.
const MIN_ROW = 92;
function fitGrid() {
  const grid = $("wgrid"), view = $("view");
  if (!grid) return;
  grid.style.removeProperty("--row");
  const style = getComputedStyle(grid);
  if (style.gridTemplateColumns.split(" ").length < 6) return; // one column (phone): rows are as tall as their content
  const rows = style.gridTemplateRows.split(" ").length, gap = parseFloat(style.rowGap) || 12;
  const top = grid.getBoundingClientRect().top - view.getBoundingClientRect().top + view.scrollTop;
  const free = view.clientHeight - top - parseFloat(getComputedStyle(view).paddingBottom) - 1;
  grid.style.setProperty("--row", `${Math.max(MIN_ROW, Math.floor((free - gap * (rows - 1)) / rows))}px`);
}
window.addEventListener("resize", fitGrid);

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
    const row = parseFloat(getComputedStyle(grid).getPropertyValue("--row")) + gap;
    const box = el.getBoundingClientRect(), start = { x: e.clientX, y: e.clientY };
    el.classList.add("resizing");
    e.target.setPointerCapture(e.pointerId);
    const move = (ev) => {
      item.w = Math.max(2, Math.min(columns, Math.round((box.width + ev.clientX - start.x + gap) / col)));
      item.h = Math.max(1, Math.min(4, Math.round((box.height + ev.clientY - start.y + gap) / row)));
      el.style.gridColumn = `span ${item.w}`; el.style.gridRow = `span ${item.h}`; el.style.setProperty("--w", item.w);
    };
    const up = () => { el.classList.remove("resizing"); e.target.removeEventListener("pointermove", move); saveLayout(); fitGrid(); };
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
  $("view").innerHTML = `<div class="page home">${cockpitHtml(greeting, date[0].toUpperCase() + date.slice(1))}
    <div class="wgrid" id="wgrid"></div></div>`;
  setTimeout(fitGrid, 300); // once more when the page has slid into place
  clearInterval(cockpitClock);
  cockpitClock = setInterval(() => {
    const clock = $("cockpit-clock");
    if (clock) clock.textContent = new Date().toLocaleTimeString("pt-PT");
    else clearInterval(cockpitClock);
  }, 1000);
  $("customize").onclick = customizeHome;
  setTimeout(() => loadTacho().catch(() => {}), 60); // after the first paint, so the needle sweeps up
  wireGrid($("wgrid"));
  drawGrid();
};

// A live event reloads only the widgets that show that kind of thing ("tick" is the slow safety net: all of them).
const reloadWidgets = async (type) => {
  if (!$("wgrid")) return;
  if (type === "activity" || type === "tick") loadTacho().catch(() => {});
  layout.filter((item) => !item.hidden && (type === "tick" || WIDGETS[item.id].on.includes(type))).forEach((item) => loadWidget(item.id));
};
["presence", "task", "approval", "activity", "usage", "ponto", "session", "tick"].forEach((type) => onLive([type], () => reloadWidgets(type)));
