// Início: the command center at a glance. The organisation of the team's mockup in the AMG finish of the Hub: the greeting
// beside a black Mercedes-AMG coming out of the dark, the team (small) with the notifications beside it, four shortcuts,
// today's progress, the tasks by day, the coming deadlines, what just happened, and a thought for the day.
// Every figure is the Hub's own record; where there is nothing, an honest empty state, never a made-up number.
//
// Light on the processor, because the Hub also runs inside the widget: the car is a still photograph (WebP, the size the
// screen needs: scripts/make_hero_photo.py), the only motion is the car coming out of the dark once per session (opacity,
// done by the graphics card), the clock changes once a minute, and nothing is blurred. The look is in hub/home.css.

const QUOTES = ["Disciplina hoje, liberdade amanhã.", "Grandes resultados exigem tempo, foco e consistência.",
  "Feito é melhor do que perfeito.", "Um passo de cada vez, todos os dias.", "Foca-te no que depende de ti.",
  "A consistência vence o talento.", "Pequenas vitórias, todos os dias.", "Quem planeia o dia, manda no dia."];
const dayOfYear = (d = new Date()) => Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 864e5);
const quoteOfDay = (offset = 0) => QUOTES[(dayOfYear() + offset) % QUOTES.length];

/* ---------- the day: which tasks are today's, tomorrow's, this week's ---------- */
const startOfDay = (d, add = 0) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() + add); return x; };
const MONTHS_SHORT = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];
const WEEKDAYS_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

// An open task with no deadline counts as today's: most of the team's tasks have none, and "Hoje" is where they get done.
// "Esta semana" on the tasks is the next seven days (on a Sunday the calendar week has nothing left); the progress counts the
// week from Monday.
function planOf(tasks, now = new Date()) {
  const today = startOfDay(now), tomorrow = startOfDay(now, 1), after = startOfDay(now, 2), inAWeek = startOfDay(now, 7);
  const monday = startOfDay(now, -((now.getDay() + 6) % 7));
  const due = (x) => (x.deadline ? new Date(x.deadline) : null);
  const done = (x) => (x.status === "COMPLETED" && x.completed_at ? new Date(x.completed_at) : null);
  const byDue = (a, b) => (due(a) ?? Infinity) - (due(b) ?? Infinity) || a.id - b.id;
  const open = tasks.filter((x) => x.stage !== "done" && !x.trashed_at);
  return {
    open,
    late: open.filter((x) => due(x) && due(x) < now),
    doneToday: tasks.filter((x) => done(x) && done(x) >= today).sort((a, b) => done(b) - done(a)),
    doneWeek: tasks.filter((x) => done(x) && done(x) >= monday),
    today: open.filter((x) => !due(x) || due(x) < tomorrow).sort(byDue),
    tomorrow: open.filter((x) => due(x) && due(x) >= tomorrow && due(x) < after).sort(byDue),
    week: open.filter((x) => due(x) && due(x) >= today && due(x) < inAWeek).sort(byDue),
    upcoming: open.filter((x) => due(x) && due(x) >= today).sort(byDue),
    inProgress: open.filter((x) => x.stage === "in_progress").length,
  };
}

function inDayLabel(d, now = new Date()) {
  const diff = Math.round((startOfDay(d) - startOfDay(now)) / 864e5);
  return diff === 0 ? t("Hoje") : diff === 1 ? t("Amanhã") : t(WEEKDAYS_SHORT[d.getDay()]);
}
const dayNum = (d) => `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;

// [what to show for the deadline, "late" when it has passed]
function whenOf(x, tab, now = new Date()) {
  if (!x.deadline) return ["", ""];
  const d = new Date(x.deadline), hhmm = fmt.hhmm(x.deadline);
  if (d < startOfDay(now)) return [dayNum(d).toLowerCase(), "late"];
  if (d < startOfDay(now, 1)) return [hhmm, d < now ? "late" : ""];
  return [tab === "tomorrow" ? hhmm : `${inDayLabel(d, now)} ${hhmm}`, ""];
}

// the tag beside a task: its project or company, else whose it is
const tagOf = (x) => x.project_name || companies.find((c) => c.id === x.company)?.name || nameOf(x.assignee);

/* ---------- the blocks ---------- */
const greetingOf = (hour) => (hour < 6 ? "Boa noite" : hour < 13 ? "Bom dia" : hour < 20 ? "Boa tarde" : "Boa noite");

function heroHtml(now, ignite) {
  const date = now.toLocaleDateString("pt-PT", { weekday: "long", day: "numeric", month: "long" });
  return `<header class="in-hero ${ignite ? "ignite" : ""}">
    <div class="hero-copy">
      <div class="hero-eyebrow">${t("Centro de comando")}</div>
      <h1>${esc(t(greetingOf(now.getHours())))}, <em>${esc(me.display_name)}</em></h1>
      <p class="hero-date">${esc(date[0].toUpperCase() + date.slice(1))}<i></i><time id="in-clock">${fmt.hhmm(now.toISOString())}</time></p>
    </div>
    <div id="in-team" class="hero-team"></div>
  </header>`;
}

// Atalhos (13 nov, David: «botões bem vistos e as funcionalidades mais importantes todas a jeito, estilo iPhone em vidro»): uma
// fila de ícones grandes logo por baixo da saudação. O Gmail abre sempre no browser (o Google não deixa entrar dentro da janela
// do widget); o resto são páginas do Hub. O número no E-mails é o das respostas por ver.
const SHORTCUTS = [
  ["gmail", "Gmail", "mail", "https://mail.google.com/mail/u/0/#inbox"],
  ["emails", "E-mails", "inbox", "#/emails"],
  ["task", "Nova tarefa", "plus", ""],
  ["claude", "Claude", "spark", "#/claude"],
  ["chat", "Chat", "chat", "#/mensagens"],
  ["vinted", "Vinted", "bag", "#/vinted"],
  ["escritorio", "Escritório", "bot", "#/escritorio"],
  ["crm", "Clientes", "target", "#/crm"],
  ["etsy", "Etsy", "layers", "#/etsy"],
  ["trading", "Trading", "trend", "#/trading"],
];
function shortcutsHtml() {
  return `<nav class="in-apps" aria-label="${esc(t("Atalhos"))}">${SHORTCUTS.map(([id, label, ic, href]) => {
    const inner = `<span class="in-app-ic">${icon(ic)}<i class="in-app-n" data-n="${id}" hidden></i></span><span class="in-app-l">${esc(t(label))}</span>`;
    if (!href) return `<button type="button" class="in-app" data-act="${id}">${inner}</button>`;
    const out = href.startsWith("http");
    return `<a class="in-app" data-app="${id}" href="${href}"${out ? ' target="_blank" rel="noopener"' : ""}>${inner}</a>`;
  }).join("")}</nav>`;
}
async function shortcutsFill() {
  const d = await api("/api/mail").catch(() => null);
  if (!d || !$("in-apps-mark")) return;
  const g = document.querySelector('.in-app[data-app="gmail"]');
  if (g && d.conta && d.conta.address) g.href = `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(d.conta.address)}#inbox`;
  const n = (d.threads || []).filter((x) => x.por_ver > 0).length, badge = document.querySelector('.in-app-n[data-n="emails"]');
  if (badge) { badge.hidden = !n; badge.textContent = n > 99 ? "99+" : n; }
}

const cardHead = (ic, title, sub = "", link = "") => `<header class="ch">${icon(ic)}<div class="ch-t"><b>${esc(t(title))}</b>${sub ? `<span>${esc(sub)}</span>` : ""}</div>${link}</header>`;
const seeAll = (label, href) => `<a class="ch-link" href="${href}">${esc(t(label))}${icon("chevron")}</a>`;

const PLACE = { pc: ["monitor", "No computador"], phone: ["phone", "No telemóvel"] };
function personHtml(m) {
  if (m.doing) m = { ...m, status: "WORKING", task: m.doing.title }; // said "Estou a fazer" on a task
  const on = m.status !== "OFFLINE", where = (m.where || []).filter((w) => PLACE[w]);
  const working = m.status === "WORKING" && m.task;
  const state = working ? "work" : m.status === "WAITING" || m.status === "PAUSED" ? "wait" : m.status === "ERROR" ? "bad" : on ? "on" : "off";
  const both = where.includes("pc") && where.includes("phone");
  const badge = on ? icon(working ? "bolt" : where.includes("phone") && !where.includes("pc") ? "phone" : "monitor") : "";
  const line = working ? t("A trabalhar") : !on ? (m.last_seen ? fmt.ago(m.last_seen) : t("Offline"))
    : both ? t("PC e telemóvel") : where.includes("phone") ? t("No telemóvel") : t("No computador");
  return `<a class="person ${state}" href="${m.doing ? `#/tarefas/${m.doing.id}` : "#/equipa"}" title="${esc(working ? `${t("A trabalhar")}: ${m.task}` : line)}">
    <span class="p-ring">${ui.avatar(m.display_name)}${on ? `<i class="p-place">${badge}</i>` : ""}</span>
    <b>${esc(m.user === me.username ? t("Tu") : m.display_name)}</b><span>${esc(line)}</span>${working ? `<em>${esc(m.task)}</em>` : ""}</a>`;
}
async function teamCard() {
  const team = await api("/api/team");
  const online = team.filter((m) => m.status !== "OFFLINE").length;
  const order = [...team].sort((a, b) => (a.status === "OFFLINE") - (b.status === "OFFLINE") || (b.user === me.username) - (a.user === me.username));
  return `${cardHead("users", "A tua equipa", `${online} ${t("de")} ${team.length} ${t("online")}`, seeAll("Ver", "#/equipa"))}
    <div class="people">${order.map(personHtml).join("")}</div>`;
}

// 13 nov (David: «quero tudo visível sem scroll»): no Início a equipa é uma fila de caras ao lado da saudação, com o anel
// verde de quem está online; o cartão grande ficou para a página Equipa.
async function teamMini() {
  const team = await api("/api/team");
  const order = [...team].sort((a, b) => (a.status === "OFFLINE") - (b.status === "OFFLINE") || (b.user === me.username) - (a.user === me.username));
  return order.map((m) => {
    const on = m.status !== "OFFLINE", work = m.doing || (m.status === "WORKING" && m.task);
    const line = work ? `${t("A trabalhar")}: ${m.doing ? m.doing.title : m.task}` : on ? t("Online") : m.last_seen ? fmt.ago(m.last_seen) : t("Offline");
    return `<a class="ht-p ${work ? "work" : on ? "on" : "off"}" href="${m.doing ? `#/tarefas/${m.doing.id}` : "#/equipa"}" title="${esc(`${m.display_name} · ${line}`)}">
      ${ui.avatar(m.display_name)}<b>${esc(m.user === me.username ? t("Tu") : m.display_name)}</b></a>`;
  }).join("");
}

/* ---------- notifications: the latest beside the team, the whole history one click away ---------- */
const NOTE_ICON = { task_new: "tasks", task: "check", approval_required: "alert", approval_decided: "check", agent_failed: "alert", agent_waiting: "clock" };
const noticeRow = (n) => `<button class="nrow ${n.read ? "" : "unread"}" data-n="${n.id}" data-href="${esc(n.href || "")}"><i></i>
  <span class="n-ic">${icon(NOTE_ICON[n.kind] || "bell")}</span>
  <span class="n-t"><b>${esc(n.title)}</b>${n.body ? `<span>${esc(n.body)}</span>` : ""}</span><time>${fmt.ago(n.created_at)}</time></button>`;

// The notifications are one line at the top of the page: how many are unread, the newest one, and the way to all of them.
// They used to be a whole card, which pushed the work down the page.
async function newsBar() {
  const inbox = await api("/api/notifications?limit=1");
  const badge = $("in-unread");
  if (badge) { badge.textContent = inbox.unread; badge.hidden = !inbox.unread; }
  const last = inbox.items[0];
  return `<button class="nb-count ${inbox.unread ? "on" : ""}" data-act="alerts" title="${t("Notificações")}">${icon("bell")}<b>${inbox.unread}</b><span>${t("por ler")}</span></button>
    ${last ? `<button class="nb-last ${last.read ? "" : "unread"}" data-n="${last.id}" data-href="${esc(last.href || "")}" title="${esc(last.title)}"><span>${esc(last.title)}</span><time>${fmt.ago(last.created_at)}</time></button>`
      : `<span class="nb-last none"><span>${t("Sem notificações")}</span></span>`}
    <button class="nb-all" data-act="alerts">${t("Ver todas")}${icon("chevron")}</button>`;
}

// "Feitas": the last tasks somebody finished, where the notifications card used to be. Who did each one is their photo, not
// only a name; on top, how many each person closed today. A fixed number of rows, so it never scrolls.
const DONE_ROWS = 3;   // three: the card is then as tall as the team beside it, and neither has empty space
const doneFace = (name, size = "sm") => `<span class="doer did" title="${esc(name)}">${ui.avatar(name, size)}<i>${icon("tick")}</i></span>`;
async function finishedCard() {
  const done = (await api("/api/tasks")).filter((x) => x.stage === "done" && x.completed_at).sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at));
  const who = (x) => nameOf(x.completed_by || x.assignee);
  const today = done.filter((x) => new Date(x.completed_at) >= startOfDay(new Date()));
  const score = [...today.reduce((m, x) => m.set(who(x), (m.get(who(x)) || 0) + 1), new Map())].sort((a, b) => b[1] - a[1]);
  const tag = (x) => (x.priority === "urgent" ? `<em class="dn-tag bad">${t("Urgente")}</em>` : x.priority === "high" ? `<em class="dn-tag warn">${t("Alta")}</em>` : "");
  return `${cardHead("check", "Feitas", today.length ? t(today.length === 1 ? "1 hoje" : "{n} hoje", { n: today.length }) : "", seeAll("Ver todas", "#/tarefas"))}
    ${score.length ? `<div class="dn-score">${score.map(([name, n]) => `<span class="dn-who">${ui.avatar(name, "sm")}<b>${esc(name)}</b><i>${n}</i></span>`).join("")}</div>` : ""}
    ${done.length ? `<div class="dn-list">${done.slice(0, DONE_ROWS).map((x) => `<button class="dn-row" data-go="#/tarefas/${x.id}">${doneFace(who(x))}
      <span class="dn-t"><b>${esc(x.title)}</b><span>${esc(who(x))}${x.completed_by && x.completed_by !== x.assignee ? ` · ${t("era de")} ${esc(nameOf(x.assignee))}` : ""}</span></span>
      ${tag(x)}<time>${fmt.ago(x.completed_at)}</time></button>`).join("")}</div>`
      : `<p class="in-empty">${t("Ainda nada concluído. As tarefas feitas aparecem aqui.")}</p>`}`;
}

async function openNotices() {
  let inbox;
  try { inbox = await request("/api/notifications?limit=100"); } catch (e) { flash(e.message); return; }
  const days = new Map();
  for (const n of inbox.items) days.set(fmt.day(n.created_at), [...(days.get(fmt.day(n.created_at)) || []), n]);
  openModal(`<div class="rowx" style="margin-bottom:14px"><h3 class="grow" style="margin:0">${t("Notificações")}</h3>
      ${inbox.unread ? `<button class="btn quiet sm" data-read-all>${t("Marcar tudo como lido")}</button>` : ""}
      <button class="btn quiet sm" data-close>${icon("x")}</button></div>
    ${days.size ? `<div class="n-hist">${[...days].map(([day, list]) =>
      `<section><div class="n-day">${esc(day)}</div><div class="n-group news">${list.map(noticeRow).join("")}</div></section>`).join("")}</div>`
      : ui.empty("bell", "Sem notificações", "Aparecem aqui as tarefas novas, as aprovações e o que precisa de ti.")}`);
  $("modal-box").classList.add("wide");
  $("modal-box").onclick = async (e) => {
    if (e.target.closest("[data-read-all]")) {
      await api("/api/notifications/read", { method: "POST", body: {} }).catch((err) => flash(err.message));
      if (window.hubNews) hubNews().catch(() => {});
      loadHome(["news"]);
      return openNotices();
    }
    const row = e.target.closest("[data-n]");
    if (row) { closeModal(); openNotice(row); }
  };
}

// A notification opened: it is read now, and it takes you where it points.
async function openNotice(row) {
  api("/api/notifications/read", { method: "POST", body: { ids: [Number(row.dataset.n)] } })
    .then(() => { if (window.hubNews) hubNews().catch(() => {}); loadHome(["news"]); }).catch(() => {});
  if (row.dataset.href) location.hash = row.dataset.href;
}

async function progressBody() {
  const p = planOf(asOne(await api("/api/tasks"))); // a task sent to everybody counts once, done when all did it
  const doneN = p.doneToday.length, total = doneN + p.today.length;
  const weekDone = p.doneWeek.length, weekTotal = weekDone + p.open.length;
  const pct = weekTotal ? Math.round((weekDone / weekTotal) * 100) : 0;
  const c = 2 * Math.PI * 52, off = total ? c * (1 - doneN / total) : c;
  return `<div class="prog">
      <div class="ring" style="--c:${c.toFixed(1)};--off:${off.toFixed(1)}"><svg viewBox="0 0 120 120" aria-hidden="true">
        <defs><linearGradient id="in-chrome" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".45" stop-color="#9aa2ab"/>
          <stop offset=".7" stop-color="#eef1f4"/><stop offset="1" stop-color="#8f98a2"/></linearGradient></defs>
        <circle class="ring-track" cx="60" cy="60" r="52"/><circle class="ring-val" cx="60" cy="60" r="52"/></svg>
        <div><b>${doneN}<small>/${total}</small></b><span>${t("Tarefas hoje")}</span></div></div>
      <ul class="legend"><li><i class="ok"></i>${t("Concluídas")}<b>${doneN}</b></li>
        <li><i class="warn"></i>${t("Pendentes")}<b>${p.today.length - p.late.length}</b></li>
        <li><i class="bad"></i>${t("Atrasadas")}<b>${p.late.length}</b></li></ul></div>
    <div class="week">${icon("trend")}<b>${t("Progresso do grupo")}</b><span>${t("esta semana")}</span></div>
    <div class="week-bar"><div class="in-bar"><i style="width:${pct}%"></i></div><b>${weekTotal ? `${pct}%` : "—"}</b></div>
    <div class="week-nums">${[[weekTotal, "Totais"], [weekDone, "Concluídas"], [p.inProgress, "Em curso"], [p.late.length, "Atrasadas"]]
      .map(([n, label]) => `<div><b>${n}</b><span>${t(label)}</span></div>`).join("")}</div>`;
}

/* ---------- a task somebody sent you: big, above everything, until you open it ---------- */
// It comes from the Hub's notices (a "task_new" meant for you and not read yet), so the phone and the computer agree, and it
// goes away on both once the task is opened (openTaskModal marks the notice read), started here, or left for later.
function newTasksOf(tasks, inbox) {
  const byId = new Map(tasks.map((x) => [x.id, x])), seen = new Set(), out = [];
  for (const n of inbox.items) {
    if (n.kind !== "task_new" || n.read || !n.directed) continue;
    const x = byId.get(Number(String(n.href || "").split("/").pop()));
    if (!x || seen.has(x.id) || x.trashed_at || x.stage === "done" || x.assignee !== me.username) continue;
    seen.add(x.id);
    out.push({ x, n });
  }
  return out.sort((a, b) => importance(a.x) - importance(b.x));   // urgent first; the newest first among equals (the notices come newest first)
}
const ntShown = new Set(); // it slides in and the light runs across it once, not again at every refresh
const plainOf = (text) => String(text || "").replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`#>]+/g, "").replace(/\s+/g, " ").trim();
function newTaskCard(fresh) {
  if (!fresh.length) return "";
  const [{ x, n }, ...more] = fresh, from = x.created_by || "", everybody = /a todos:/.test(n.title);
  const enter = !ntShown.has(x.id), body = plainOf(x.description);
  ntShown.add(x.id);
  const [when, late] = whenOf(x, "week");
  const chips = [x.priority === "urgent" ? `<em class="bad">${icon("flag")}${t("Urgente")}</em>` : x.priority === "high" ? `<em class="warn">${icon("flag")}${t("Alta")}</em>` : "",
    `<em class="${late ? "bad" : ""}">${icon("calendar")}${when ? esc(late ? `${t("Atrasada")} · ${when}` : when) : t("Sem prazo")}</em>`,
    x.project_name ? `<em>${icon("folder")}${esc(x.project_name)}</em>` : "", everybody ? `<em>${icon("users")}${t("Para todos")}</em>` : ""].join("");
  return `<section class="nt ${enter ? "enter" : ""} ${x.priority === "urgent" ? "hot" : ""}" style="${whoVar(from)}">
    <div class="nt-light" aria-hidden="true"></div>
    <header class="nt-eye"><i class="nt-dot"></i><b>${t(fresh.length > 1 ? "Tarefas novas para ti" : "Tarefa nova para ti")}</b>${fresh.length > 1 ? `<span class="nt-n">${fresh.length}</span>` : ""}
      <time>${esc(fmt.ago(n.created_at))}</time></header>
    <div class="nt-main">
      <div class="nt-from">${ui.avatar(nameOf(from))}<span><b>${esc(nameOf(from))}</b> ${t(everybody ? "mandou uma tarefa a todos" : "mandou-te uma tarefa")}</span></div>
      <h2 class="nt-title">${esc(x.title)}</h2>
      ${body ? `<p class="nt-body">${esc(body.slice(0, 360))}${body.length > 360 ? "…" : ""}</p>` : ""}
      <div class="nt-chips">${chips}</div>
      <div class="nt-acts"><button class="nt-btn main" data-nt-open="${x.id}">${t("Abrir a tarefa")}${icon("chevron")}</button>
        ${heldByAgent(x) ? "" : `<button class="nt-btn" data-nt-doing="${x.id}" data-nt-n="${n.id}">${icon("play")}${t("Começar agora")}</button>`}
        <button class="nt-btn quiet" data-nt-later="${n.id}">${t("Mais tarde")}</button></div>
    </div>
    ${more.length ? `<div class="nt-more"><small>${t("Também chegaram")}</small>${more.slice(0, 3).map(({ x: y, n: m }) => `<button class="nt-row" data-nt-open="${y.id}" style="${whoVar(y.created_by)}">
      ${ui.avatar(nameOf(y.created_by), "sm")}<div><b>${esc(y.title)}</b><em>${esc(nameOf(y.created_by))} · ${esc(fmt.ago(m.created_at))}</em></div>${icon("chevron")}</button>`).join("")}
      ${more.length > 3 ? `<a class="nt-all" href="#/tarefas">${t("e mais {n}", { n: more.length - 3 })}</a>` : ""}</div>` : ""}
  </section>`;
}

/* ---------- what is urgent, above everything; the three numbers ---------- */
async function alertBody() {
  const [tasks, inbox] = await Promise.all([api("/api/tasks"), api("/api/notifications?limit=100")]);
  // 13 nov (Marco): a tarefa nova já não ocupa o Início; avisa no canto de cima à direita (o aviso do shell.js), com quem a
  // mandou e um X para a tirar. Aqui fica só a lista de urgentes e os números.
  const freshIds = new Set();
  const p = planOf(asOne(tasks));
  // what the new-task card already shows big is not said again in the urgent strip
  const urgent = p.open.filter((x) => x.priority === "urgent" && !freshIds.has((x.group ? x.group.find((y) => y.assignee === me.username) || x : x).id))
    .sort((a, b) => (a.deadline || "9").localeCompare(b.deadline || "9"));
  const hot = p.open.filter((x) => x.priority === "urgent" || x.priority === "high").length;
  const row = (x) => {
    const own = x.group ? x.group.find((y) => y.assignee === me.username) : x.assignee === me.username ? x : null;
    const mineDone = own && own.stage === "done";
    const [when, late] = whenOf(x, "today");
    return `<div class="u-row" data-task="${(own || x).id}">${own && !mineDone ? `<button class="tcheck" data-done="${own.id}" title="${t("Concluir")}"></button>` : `<span class="tcheck ${mineDone ? "part" : ""}">${mineDone ? icon("tick") : ""}</span>`}
      <div class="u-t"><b>${esc(x.title)}</b><span>${esc(x.group ? whoLeft(x.group) : nameOf(x.assignee))}${when ? ` · <em class="${late}">${esc(when)}</em>` : ` · ${t("Sem prazo")}`}</span></div>
      ${x.group ? whoFaces(x.group) : whoPlate(x.assignee)}${icon("chevron")}</div>`;
  };
  // 13 nov: os quatro números saíram daqui para a faixa «Hoje» (pulseBody), que junta as tarefas aos negócios
  void hot; void inbox;
  return urgent.length ? `<section class="urgent"><header><i class="pulse"></i><b>${t(urgent.length === 1 ? "Urgente" : "Urgentes")}</b><span>${urgent.length}</span></header>
      <div class="u-rows">${urgent.slice(0, 4).map(row).join("")}</div></section>` : "";
}

/* ---------- «Hoje»: a empresa num relance (13 nov, David: «o início muito bonito... com informações importantes nossas») ---------- */
// Uma faixa de vidro com o que conta hoje, cada número de uma fonte real: as tarefas, as notificações, o Gmail da Ten Fold,
// o Vinted Radar, a Fábrica Etsy e o calendário do Forex Factory. Uma fonte que não responde mostra «—», nunca zero.
const soft = (p) => api(p).catch(() => null);
const nextNews = (cal) => (cal?.events || []).filter((e) => e.impact === "high" && e.ts * 1000 > Date.now() - 5 * 60e3).sort((a, b) => a.ts - b.ts);
const hhmmOf = (ts) => new Date(ts * 1000).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });
const dayOf = (ts) => { const d = new Date(ts * 1000); return startOfDay(d) - startOfDay(new Date()) ? inDayLabel(d) : t("Hoje"); };
const today0 = () => startOfDay(new Date()).getTime();
async function pulseBody() {
  const [tasks, mail, vinted, etsy, cal] = await Promise.all([api("/api/tasks"), soft("/api/mail"),
    soft("/api/vinted"), soft("/api/etsy"), soft("/api/trading/calendar")]);
  const p = planOf(asOne(tasks));
  const hot = p.open.filter((x) => x.priority === "urgent" || x.priority === "high").length;
  const porVer = mail ? (mail.threads || []).filter((x) => x.por_ver > 0).length : null;
  const deals = vinted ? (vinted.alertas || []).filter((a) => a.lucro > 0 && new Date(a.alertado_em || a.visto_em).getTime() >= today0()).length : null;
  const news = nextNews(cal)[0];
  const tile = (go, ic, n, label, sub, tone = "") => `<button class="pl ${tone}" data-go="${go}"><span class="pl-ic">${icon(ic)}</span>
    <b>${n ?? "—"}</b><span class="pl-l">${esc(t(label))}</span><span class="pl-s">${esc(sub)}</span></button>`;
  return `<div class="pl-row">
    ${tile("#/tarefas", "calendar", p.today.length, "Para hoje", p.late.length ? t("{n} atrasadas", { n: p.late.length }) : t("Nada atrasado"), p.late.length ? "bad" : "")}
    ${tile("#/tarefas", "flag", hot, "Prioridade", t("urgentes e altas"), hot ? "warn" : "")}
    ${tile("#/emails", "mail", porVer, "E-mails por ver", mail?.conta?.address ? t("{n} enviados hoje", { n: mail.conta.hoje || 0 }) : t("Gmail por ligar"), porVer ? "lit" : "")}
    ${tile("#/vinted", "bag", deals, "Pechinchas hoje", vinted ? (vinted.estado?.ligado ? t("Radar ligado") : t("Radar parado")) : t("Sem dados"), deals ? "ok" : "")}
    ${tile("#/etsy", "layers", etsy ? etsy.counts?.published ?? 0 : null, "Na Etsy", etsy ? t("{n} por aprovar · {v} vendas", { n: etsy.counts?.new || 0, v: (etsy.sales || []).length }) : t("Sem dados"))}
    ${news ? tile("#/sinal", "trend", hhmmOf(news.ts), `${news.currency} · ${news.title}`, `${dayOf(news.ts)} · ${t("impacto alto")}`, "hot")
      : tile("#/sinal", "trend", cal ? 0 : null, "Notícias vermelhas", cal ? t("nenhuma esta semana") : t("Sem dados"))}
  </div>`;
}

/* ---------- «Comando»: pedir trabalho ao escritório sem sair do Início (13 nov, David: «a aba do e-mail já temos de
   lado... funcionalidades inovadoras, que dê jeito à sala do início») ---------- */
// Em cima, uma caixa: escreve-se o que se quer feito e, enquanto se escreve, o Hub diz que departamento o leva e quantas tem
// à frente (o mesmo /api/tasks/route do compositor); Enter manda-o já para o escritório. Por baixo, sugestões tiradas dos
// dados de agora (e-mails por ver, desenhos por aprovar, a pechincha, a próxima notícia), quem do escritório está a
// trabalhar e em quê, e um radar de três vidros. Os e-mails ficaram na doca e na faixa «Hoje».
const eur = (n) => `${Number(n).toLocaleString("pt-PT", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} €`;
const DEPT = { batman: "DEV", lucius: "ENG", riddler: "PES", catwoman: "DSG", joker: "MKT", alfred: "REV", robin: "QA", gordon: "OPS",
  huntress: "CAC", penguin: "MAC", twoface: "TEC" };
const untilOf = (ts) => {
  const m = Math.round((ts * 1000 - Date.now()) / 60e3);
  return m <= 0 ? t("agora") : m < 60 ? t("em {n} min", { n: m }) : m < 24 * 60 ? t("em {h} h {m}", { h: Math.floor(m / 60), m: String(m % 60).padStart(2, "0") }) : `${dayOf(ts)} ${hhmmOf(ts)}`;
};

function askHtml() {
  return `<form class="ck-ask" id="ck-ask" autocomplete="off">
    <span class="ck-ask-ic">${icon("spark")}</span>
    <input id="ck-in" name="q" maxlength="200" placeholder="${esc(t("Pede ao escritório…"))}" aria-label="${esc(t("Pedir ao escritório"))}">
    <button class="ck-go" aria-label="${esc(t("Mandar"))}">${icon("arrow")}</button></form>
    <div class="ck-route idle" id="ck-route">${t("Escreve e vês logo quem o faz.")}</div>`;
}

let ckTurn = 0, ckTimer = null;
function ckRoute() {
  clearTimeout(ckTimer);
  ckTimer = setTimeout(async () => {
    const line = $("ck-route"), q = $("ck-in")?.value.trim(), my = ++ckTurn;
    if (!line) return;
    if (!q) { line.className = "ck-route idle"; line.textContent = t("Escreve e vês logo quem o faz."); return; }
    try {
      const r = await api("/api/tasks/route", { method: "POST", body: { title: q, description: "" } });
      if (my !== ckTurn || !line.isConnected) return;
      line.className = "ck-route";
      line.innerHTML = `<i class="ck-mono">${esc(DEPT[r.crew] || "AMG")}</i><span>${t("Vai para")} <b>${esc(r.name)}</b></span>
        <em>${esc(r.ahead ? t(r.ahead === 1 ? "1 à frente" : "{n} à frente", { n: r.ahead }) : t("começa já"))}</em>`;
    } catch { /* sem resposta: fica a frase de antes */ }
  }, 200);
}
async function ckSend(e) {
  e.preventDefault();
  const input = $("ck-in"), title = input.value.trim();
  if (!title) { input.focus(); return; }
  const form = $("ck-ask");
  form.classList.add("sending");
  try {
    const made = await api("/api/tasks", { method: "POST", body: { title, description: "", assignee: me.username, for_ai: true, crew: "" } });
    flash(t("Mandada para {d}. O agente começa sozinho.", { d: made.crew_name || t("o escritório") }));
    input.value = ""; ckRoute();
    form.classList.add("sent"); setTimeout(() => form.classList.remove("sent"), 900);
    loadHome(["plan", "biz"]);
  } catch (err) { flash(err.message); }
  form.classList.remove("sending");
}

async function cmdBody() {
  const [tasks, mail, vinted, etsy, cal] = await Promise.all([api("/api/tasks"), soft("/api/mail"), soft("/api/vinted"), soft("/api/etsy"), soft("/api/trading/calendar")]);
  const best = vinted ? (vinted.alertas || []).filter((a) => a.lucro > 0).sort((a, b) => b.lucro - a.lucro)[0] : null;
  const porVer = mail ? (mail.threads || []).filter((x) => x.por_ver > 0).length : 0;
  const news = nextNews(cal)[0];
  const office = tasks.filter((x) => x.crew && x.stage !== "done" && !x.trashed_at);
  const busy = office.filter((x) => x.stage === "in_progress" || x.status === "RUNNING" || x.status === "IN_PROGRESS");
  const queued = office.length - busy.length;

  // sugestões: o que os dados dizem que dá jeito fazer agora; «fill» escreve o pedido na caixa, «go» abre a página
  const tips = [
    porVer ? ["fill", "mail", t(porVer === 1 ? "Responder ao e-mail por ver" : "Responder aos {n} e-mails", { n: porVer }), t("Responde aos e-mails por ver da Ten Fold e mostra-me as respostas antes de enviar")] : null,
    etsy?.counts?.new ? ["go", "layers", t("Rever {n} desenhos Etsy", { n: etsy.counts.new }), "#/etsy"] : null,
    best ? ["go", "bag", t("Pechincha +{v}", { v: eur(best.lucro) }), "#/vinted"] : null,
    news ? ["go", "trend", `${news.currency} ${untilOf(news.ts)}`, "#/sinal"] : null,
    ["fill", "search", t("Procurar clientes"), t("Vai ao Radar e encontra 10 negócios perto de mim que precisam de site")],
  ].filter(Boolean).slice(0, 4);
  const tipHtml = `<div class="ck-tips">${tips.map(([k, ic, label, v]) => `<button type="button" class="ck-tip" data-${k === "fill" ? "fill" : "go"}="${esc(v)}">${icon(ic)}<span>${esc(label)}</span></button>`).join("")}</div>`;

  const workHtml = busy.length ? `<div class="ck-work">${busy.slice(0, 3).map((x) => {
      const p = Number(x.progress) || 0;
      return `<button class="ck-job" data-task="${x.id}"><i class="ck-mono live">${esc(DEPT[x.crew] || "AMG")}</i>
        <span class="ck-job-t"><b>${esc(x.title)}</b><span>${esc(x.current_action || x.last_action || x.crew_name || "")}</span>
        ${p ? `<span class="ck-bar"><i style="width:${Math.min(100, p)}%"></i></span>` : ""}</span></button>`;
    }).join("")}</div>`
    : `<p class="ck-quiet">${t("Ninguém a trabalhar agora. Escreve em cima e o escritório arranca.")}</p>`;

  const deal = best ? `<a class="ck-tile deal" href="#/vinted">${best.foto ? `<img src="${esc(best.foto)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ""}
      <span class="ck-tl">${icon("bag")}${t("Vinted")}</span><b>+${eur(best.lucro)}</b><span class="ck-ts">${esc(best.titulo)} · ${eur(best.preco)}</span></a>`
    : `<a class="ck-tile" href="#/vinted"><span class="ck-tl">${icon("bag")}${t("Vinted")}</span><b>—</b><span class="ck-ts">${t(vinted ? "Sem pechinchas" : "Sem dados")}</span></a>`;
  const shop = `<a class="ck-tile" href="#/etsy"><span class="ck-tl">${icon("layers")}${t("Etsy")}</span><b>${etsy ? eur(etsy.revenue || 0) : "—"}</b>
      <span class="ck-ts">${etsy ? t("{v} vendas · {p} na loja", { v: (etsy.sales || []).length, p: etsy.counts?.published ?? 0 }) : t("Sem dados")}</span></a>`;
  const nw = `<a class="ck-tile ${news && news.ts * 1000 - Date.now() < 3600e3 ? "hot" : ""}" href="#/sinal"><span class="ck-tl">${icon("trend")}${t("Notícia")}</span>
      <b>${news ? hhmmOf(news.ts) : "—"}</b><span class="ck-ts">${news ? `${esc(news.currency)} · ${esc(news.title)}` : t(cal ? "Nenhuma vermelha" : "Sem dados")}</span></a>`;

  return `${tipHtml}
    <div class="ck-sec"><b>${t("No escritório")}</b><span>${busy.length ? t("{n} a trabalhar", { n: busy.length }) : ""}${queued ? ` · ${t("{n} na fila", { n: queued })}` : ""}</span><a href="#/escritorio">${t("Abrir")}${icon("chevron")}</a></div>
    ${workHtml}
    <div class="ck-sec"><b>${t("Radar")}</b></div>
    <div class="ck-tiles">${deal}${shop}${nw}</div>`;
}

/* ---------- Modo foco e a tua semana (13 nov, David: «funcionalidades novas, preencher a página toda») ---------- */
// Foco: escolhes uma das tuas tarefas e 25 ou 50 minutos; a tarefa fica «A fazer agora» para a equipa ver, o anel conta
// até zero e no fim acabas a tarefa ou dás mais 5 min. O relógio guarda-se no navegador: sobrevive a recarregar a página.
const FOCUS_KEY = "hub.focus";
const focusGet = () => { try { return JSON.parse(localStorage.getItem(FOCUS_KEY) || "null"); } catch { return null; } };
const focusSet = (v) => { try { v ? localStorage.setItem(FOCUS_KEY, JSON.stringify(v)) : localStorage.removeItem(FOCUS_KEY); } catch { /* sem armazenamento */ } };
let focusPick = null, focusTick = null;
const RING = 2 * Math.PI * 34;

async function focusBody() {
  const f = focusGet();
  const dial = (txt) => `<div class="fx-dial"><svg viewBox="0 0 80 80"><circle cx="40" cy="40" r="34"/><circle class="fx-arc" id="fx-arc" cx="40" cy="40" r="34"
    stroke-dasharray="${RING}" stroke-dashoffset="${f ? 0 : RING}"/></svg><b class="fx-time" id="fx-time">${txt}</b></div>`;
  if (f) {
    return `<div class="fx-h"><b>${t("Modo foco")}</b><span class="fx-live">${t("a contar")}</span></div>
      <div class="fx-run">${dial("--:--")}<div class="fx-what"><span>${t("Estás em")}</span><button class="fx-title" data-task="${f.id}">${esc(f.title)}</button></div></div>
      <div class="fx-go"><button class="fx-start ok" data-fx="done">${icon("tick")}${t("Feita")}</button><button class="fx-start alt" data-fx="more">+5</button>
        <button class="fx-start alt" data-fx="stop" aria-label="${t("Parar")}">${icon("stop")}</button></div>`;
  }
  // as tarefas para todos contam pela tua cópia, enquanto não fizeste a tua parte
  const mine = planOf(asOne(await api("/api/tasks"))).today.sort((a, b) => importance(a) - importance(b))
    .map((x) => (x.group ? { ...x, id: x.group.find((y) => y.assignee === me.username && y.stage !== "done")?.id } : x.assignee === me.username ? x : null))
    .filter((x) => x && x.id).slice(0, 5);
  if (!mine.length) return `<div class="fx-h"><b>${t("Modo foco")}</b></div><div class="fx-run idle">${dial("25:00")}<p class="fx-none">${t("Sem tarefas tuas para hoje. Cria uma e foca-te nela.")}</p></div>`;
  const i = Math.max(0, mine.findIndex((x) => x.id === focusPick)), x = mine[i];
  focusPick = x.id;
  return `<div class="fx-h"><b>${t("Modo foco")}</b>${mine.length > 1 ? `<button class="fx-next" data-fx-pick="${mine[(i + 1) % mine.length].id}">${t("Outra")} ${i + 1}/${mine.length}</button>` : ""}</div>
    <div class="fx-run idle">${dial("25:00")}<div class="fx-what"><span>${t("A seguir")}</span><button class="fx-title" data-task="${x.id}">${esc(x.title)}</button></div></div>
    <div class="fx-go"><button class="fx-start" data-fx-start="25">${icon("play")}25 min</button><button class="fx-start alt" data-fx-start="50">50 min</button></div>`;
}
function focusRun() {
  clearInterval(focusTick);
  const step = () => {
    const f = focusGet(), time = $("fx-time");
    if (!f || !time) return clearInterval(focusTick);
    const total = f.mins * 60e3, left = Math.max(0, f.start + total - Date.now());
    time.textContent = `${String(Math.floor(left / 60e3)).padStart(2, "0")}:${String(Math.floor(left / 1e3) % 60).padStart(2, "0")}`;
    $("fx-arc").setAttribute("stroke-dashoffset", String(RING * (1 - left / total)));
    const end = !left;
    time.closest(".fx-run").classList.toggle("end", end);
    if (end && !f.told) { focusSet({ ...f, told: true }); flash(t("Foco acabado. Acabaste «{t}»?", { t: f.title })); }
  };
  step(); focusTick = setInterval(step, 1000);
}
async function focusClick(e) {
  const pick = e.target.closest("[data-fx-pick]");
  if (pick) { focusPick = Number(pick.dataset.fxPick); await mount($("in-focus"), focusBody, 1); return true; }
  const start = e.target.closest("[data-fx-start]");
  if (start) {
    const title = start.closest(".fx").querySelector(".fx-title")?.textContent || "";
    focusSet({ id: focusPick, title, mins: Number(start.dataset.fxStart), start: Date.now() });
    api(`/api/tasks/${focusPick}`, { method: "PATCH", body: { doing: true } }).catch(() => {});
    await mount($("in-focus"), focusBody, 1); focusRun(); loadHome(["team"]);
    return true;
  }
  const act = e.target.closest("[data-fx]")?.dataset.fx;
  if (!act) return false;
  const f = focusGet();
  if (!f) return true;
  if (act === "more") { focusSet({ ...f, mins: f.mins + 5, told: false }); focusRun(); return true; }
  focusSet(null); clearInterval(focusTick);
  try {
    await api(`/api/tasks/${f.id}`, { method: "PATCH", body: act === "done" ? { status: "COMPLETED", doing: false } : { doing: false } });
    if (act === "done") flash(t("Tarefa concluída. Bom foco."));
  } catch (err) { flash(err.message); }
  loadHome(["plan", "team", "act"]);
  return true;
}

// A tua semana: tarefas acabadas em cada um dos últimos 7 dias (as tuas a cheio, as da equipa por trás) e há quantos dias
// seguidos acabas pelo menos uma.
async function weekBody() {
  const done = (await api("/api/tasks")).filter((x) => x.stage === "done" && x.completed_at);
  const mineOf = (x) => x.completed_by === me.username || x.assignee === me.username;
  const days = [...Array(7)].map((_, i) => startOfDay(new Date(), i - 6));
  const count = (d, f) => done.filter((x) => { const c = new Date(x.completed_at); return c >= d && c < startOfDay(d, 1) && f(x); }).length;
  const rows = days.map((d) => ({ d, me: count(d, mineOf), all: count(d, () => true) }));
  const top = Math.max(1, ...rows.map((r) => r.all));
  let streak = 0;
  for (let i = rows[6].me ? 0 : 1; ; i++) { const d = startOfDay(new Date(), -i); if (count(d, mineOf)) streak++; else break; if (i > 60) break; }
  const week = rows.reduce((n, r) => n + r.me, 0);
  return `<div class="fx-h"><b>${t("A tua semana")}</b><span>${t(week === 1 ? "1 feita" : "{n} feitas", { n: week })}${streak ? ` · <em>${t(streak === 1 ? "1 dia seguido" : "{n} dias seguidos", { n: streak })}</em>` : ""}</span></div>
    <div class="wk">${rows.map((r, i) => `<div class="wk-d ${i === 6 ? "wk-now" : ""}" title="${esc(t("{m} tuas · {a} da equipa", { m: r.me, a: r.all }))}">
      <div class="wk-bar"><i class="all" style="height:${(r.all / top) * 100}%"></i><i class="me" style="height:${(r.me / top) * 100}%"></i></div>
      <b>${r.me || ""}</b><span>${t(WEEKDAYS_SHORT[r.d.getDay()]).slice(0, 1)}</span></div>`).join("")}</div>`;
}

let tasksTab = "today";
const DAY_TABS = [["today", "Hoje"], ["tomorrow", "Amanhã"], ["week", "Esta semana"]];
const DAY_EMPTY = { today: "Nada para hoje. Cria uma tarefa, ou dá um prazo a uma.", tomorrow: "Nada com prazo para amanhã.",
  week: "Nada com prazo para esta semana." };
const MAX_ROWS = 6;

// A task sent to everybody is one row ("Todos"); its circle finishes your own copy, or opens it when none is yours.
function taskRow(x, done) {
  const [when, late] = done ? [fmt.hhmm(x.completed_at), ""] : whenOf(x, tasksTab);
  const own = x.group ? x.group.find((y) => y.assignee === me.username) : x;
  const held = !done && own && heldByAgent(own);
  const mineDone = !done && x.group && own && own.stage === "done"; // my part is done, the others' is not
  const check = done || mineDone ? `<span class="tcheck ${mineDone ? "part" : ""}" title="${mineDone ? t("Já fizeste a tua parte") : ""}">${icon("tick")}</span>`
    : held ? `<span class="tcheck held" title="${t("O agente está a tratar dela")}"></span>`
    : own ? `<button class="tcheck" data-done="${own.id}" title="${t("Concluir")}" aria-label="${t("Concluir")}"></button>`
    : `<button class="tcheck" data-task="${x.id}" title="${t("Abrir")}" aria-label="${t("Abrir")}"></button>`;
  const prio = !done && x.priority === "urgent" ? "urgent" : !done && x.priority === "high" ? "high" : "";
  const doer = !done && doingOf(x);
  return `<div class="trow ${done ? "done" : ""} ${prio} ${doer ? "doing" : ""}">${check}<button class="ttitle" data-task="${(own || x).id}">${esc(x.title)}</button>
    <span class="twhen ${late}">${esc(when)}</span>${doer ? doingBadge(doer) : ""}${x.group ? `<span class="ttag all" title="${esc(whoLeft(x.group))}">${whoFaces(x.group)}<b>${x.group.filter((y) => y.stage === "done").length}/${x.group.length}</b></span>`
      : `<span class="ttag ${done && x.completed_by && x.completed_by !== x.assignee ? "other" : ""}" title="${esc(done ? doneBy(x) : "")}">${esc(done && x.completed_by ? nameOf(x.completed_by) : tagOf(x))}</span>`}</div>`;
}

// What is still to do fills the card, the most important first. What is already done today is one quiet line that opens on a click.
let showDone = false;
const openMates = new Set(); // whose tasks are unfolded in "A seguir"
const MATE_ROWS = 5;         // tasks shown of one teammate when unfolded; the rest is on the board
async function tasksBody() {
  const p = planOf(asOne(await api("/api/tasks"))); // "Para todos" is one row, open until everybody did their part
  const open = p[tasksTab].sort((a, b) => importance(a) - importance(b));
  const done = tasksTab === "today" ? p.doneToday : [];
  // Mine and the ones for several people come first, as rows. What belongs to one teammate is a single line with their
  // face and how many: fourteen tasks of somebody else used to push this person's own work out of the card.
  const isMine = (x) => (x.group ? true : x.assignee === me.username);
  const mine = open.filter(isMine), theirs = new Map();
  for (const x of open.filter((y) => !isMine(y))) theirs.set(x.assignee, [...(theirs.get(x.assignee) || []), x]);
  const more = mine.length - MAX_ROWS;
  const mate = ([user, list]) => {
    const urgent = list.filter((x) => x.priority === "urgent").length, on = openMates.has(user);
    return `<button class="mate-sum ${on ? "on" : ""}" data-mate="${esc(user)}" aria-expanded="${on}">${ui.avatar(nameOf(user), "sm")}<b>${esc(nameOf(user))}</b>
        <span>${t(list.length === 1 ? "1 tarefa" : "{n} tarefas", { n: list.length })}${urgent ? ` · <em>${t(urgent === 1 ? "1 urgente" : "{n} urgentes", { n: urgent })}</em>` : ""}</span>${icon("chevron")}</button>
      ${on ? `<div class="trows small">${list.slice(0, MATE_ROWS).map((x) => taskRow(x, false)).join("")}</div>
        ${list.length > MATE_ROWS ? `<a class="in-more" href="#/tarefas">${t("Mais {n} no quadro", { n: list.length - MATE_ROWS })}</a>` : ""}` : ""}`;
  };
  return `<div class="day-tabs" role="tablist">${DAY_TABS.map(([id, label]) =>
      `<button role="tab" data-tab="${id}" class="${id === tasksTab ? "on" : ""}" aria-selected="${id === tasksTab}">${t(label)}</button>`).join("")}</div>
    ${theirs.size ? `<div class="trows-h">${t("Para ti")}</div>` : ""}
    ${mine.length ? `<div class="trows">${mine.slice(0, MAX_ROWS).map((x) => taskRow(x, false)).join("")}</div>`
      : `<p class="in-empty">${t(open.length ? "Nada para ti aqui." : done.length ? "Tudo feito por hoje." : DAY_EMPTY[tasksTab])}</p>`}
    ${more > 0 ? `<a class="in-more" href="#/tarefas">${t("Mais {n} no quadro", { n: more })}</a>` : ""}
    ${theirs.size ? `<div class="trows-h">${t("Da equipa")}</div><div class="mates-sum">${[...theirs].sort((a, b) => b[1].length - a[1].length).map(mate).join("")}</div>` : ""}
    ${done.length ? `<button class="in-done ${showDone ? "on" : ""}" data-show-done>${icon("check")}<span>${t(done.length === 1 ? "1 concluída hoje" : "{n} concluídas hoje", { n: done.length })}</span>${icon("chevron")}</button>
      ${showDone ? `<div class="trows small">${done.map((x) => taskRow(x, true)).join("")}</div>` : ""}` : ""}`;
}

function calRow(x) {
  const d = new Date(x.deadline);
  return `<button class="crow" data-task="${x.id}"><span class="cdate"><b>${esc(inDayLabel(d))}</b><span>${dayNum(d)}</span></span>
    <span class="ctitle">${esc(x.title)}</span><span class="ctime">${fmt.hhmm(x.deadline)}</span>${icon("chevron")}</button>`;
}
const noDeadlines = () => `<div class="in-none">${icon("calendar")}<div><b>${t("Sem prazos marcados")}</b>
  <span>${t("Dá um prazo a uma tarefa e ela aparece aqui.")}</span></div>${ui.btn("Nova tarefa", 'data-act="task"', "sm")}</div>`;

async function calendarBody() {
  const p = planOf(await api("/api/tasks"));
  return p.upcoming.length ? `<div class="crows">${p.upcoming.slice(0, 3).map(calRow).join("")}</div>` : noDeadlines();
}

// "Marco entrou no Hub" and "ficou online" every few minutes would bury the rest: presence is shown on the team card instead
const NOISE = ["login", "hub_online", "hub_offline", "agent_online", "agent_offline"];
function splitActivity(a) {
  const who = a.message.startsWith(a.name || "\u0000") ? "" : `${a.name} `;
  const cut = a.message.indexOf(": ");
  const head = cut > 0 ? a.message.slice(0, cut) : a.message;
  return [who + (head === "concluiu" ? t("concluiu a tarefa") : head), cut > 0 ? a.message.slice(cut + 2) : ""];
}

async function activityBody() {
  const [items, team] = await Promise.all([api("/api/history?limit=300"), api("/api/team")]);
  const online = new Set(team.filter((m) => m.status !== "OFFLINE").map((m) => m.user));
  // the last thing each person did, so the card is the whole team and not only whoever moved last; then what else is recent
  const real = items.filter((a) => !NOISE.includes(a.kind));
  const last = team.map((m) => real.find((a) => a.user === m.user)).filter(Boolean);
  const shown = [...last, ...real.filter((a) => !last.includes(a))].slice(0, Math.max(8, last.length)).sort((x, y) => new Date(y.created_at) - new Date(x.created_at));
  if (!shown.length) return `<p class="in-empty">${t("Ainda não aconteceu nada.")}</p>`;
  return `<div class="arows">${shown.map((a) => {
    const [what, detail] = splitActivity(a);
    return `<div class="arow"><span class="arow-av">${ui.avatar(a.name)}${online.has(a.user) ? "<i></i>" : ""}</span>
      <div class="arow-t"><b>${esc(what)}</b>${detail ? `<span>${esc(detail)}</span>` : ""}</div><time>${fmt.ago(a.created_at)}</time></div>`;
  }).join("")}</div>`;
}

const quoteCard = () => `<figure class="in-quote"><blockquote>“${esc(t(quoteOfDay(3)))}”</blockquote>
  <figcaption><img src="assets/amg-wordmark.png" alt="AMG"></figcaption></figure>`;

/* ---------- the shortcuts ---------- */
// "Calendário": every deadline from today on (and the ones already missed), by day.
async function openAgenda() {
  let p;
  try { p = planOf(await request("/api/tasks")); } catch (e) { flash(e.message); return; }
  const days = new Map();
  for (const x of [...p.late.filter((x) => new Date(x.deadline) < startOfDay(new Date())), ...p.upcoming]) {
    const d = new Date(x.deadline), key = d < startOfDay(new Date()) ? t("Em atraso") : `${inDayLabel(d)} · ${dayNum(d)}`;
    days.set(key, [...(days.get(key) || []), x]);
  }
  openModal(`<div class="rowx" style="margin-bottom:12px"><h3 class="grow" style="margin:0">${t("Próximos prazos")}</h3>
      <button class="btn quiet sm" data-close>${icon("x")}</button></div>
    ${days.size ? [...days].map(([day, list]) => `${ui.sec(day)}<div class="panel">${list.map((x) =>
      `<a class="rw" href="#" data-task="${x.id}"><div class="rw-main"><b>${esc(x.title)}</b><span>${esc(nameOf(x.assignee))}</span></div>
        <span class="mono">${fmt.hhmm(x.deadline)}</span></a>`).join("")}</div>`).join("")
      : ui.empty("calendar", "Sem prazos marcados", "Dá um prazo a uma tarefa (Editar → Prazo) e ela aparece aqui.")}`);
  $("modal-box").onclick = (e) => {
    const row = e.target.closest("[data-task]");
    if (row) { e.preventDefault(); openTaskModal(Number(row.dataset.task)); }
  };
}

// The buttons of the new-task card: open it, start it now (the team sees it is with you), or leave it for later. Each one
// reads the notice, so the card goes away here and on the phone.
const readNotices = (ids) => api("/api/notifications/read", { method: "POST", body: { ids } });
async function newTaskClick(e) {
  const open = e.target.closest("[data-nt-open]");
  if (open) { openTaskModal(Number(open.dataset.ntOpen)); return true; }
  const start = e.target.closest("[data-nt-doing]");
  if (start) {
    start.disabled = true;
    try {
      await api(`/api/tasks/${start.dataset.ntDoing}`, { method: "PATCH", body: { doing: true } });
      await readNotices([Number(start.dataset.ntN)]);
      flash(t("Começaste. A equipa vê que é contigo."));
    } catch (err) { flash(err.message); start.disabled = false; }
    loadHome(["plan", "news"]);
    return true;
  }
  const later = e.target.closest("[data-nt-later]");
  if (later) {
    later.closest(".nt")?.classList.add("leaving");
    try { await readNotices([Number(later.dataset.ntLater)]); } catch (err) { flash(err.message); }
    loadHome(["news"]);
    return true;
  }
  return false;
}

async function homeClick(e) {
  if (await newTaskClick(e)) return;
  if (await focusClick(e)) return;
  const act = e.target.closest("[data-act]")?.dataset.act;
  if (act === "task") return newTask();
  if (act === "agenda") return openAgenda();
  if (act === "alerts") return openNotices();
  const fill = e.target.closest("[data-fill]");
  if (fill) { const input = $("ck-in"); input.value = fill.dataset.fill; input.focus(); return ckRoute(); }
  const go = e.target.closest("[data-go]");
  if (go) { location.hash = go.dataset.go; return; }
  const notice = e.target.closest("[data-n]");
  if (notice) return openNotice(notice);
  const tab = e.target.closest("[data-tab]");
  if (tab) { tasksTab = tab.dataset.tab; return mount($("in-tasks"), tasksBody, 4); }
  if (e.target.closest("[data-show-done]")) { showDone = !showDone; return mount($("in-tasks"), tasksBody, 4); }
  const mateSum = e.target.closest("[data-mate]");
  if (mateSum) { openMates.has(mateSum.dataset.mate) ? openMates.delete(mateSum.dataset.mate) : openMates.add(mateSum.dataset.mate); return mount($("in-tasks"), tasksBody, 4); }
  const done = e.target.closest("[data-done]");
  if (done) {
    done.disabled = true;
    try { await api(`/api/tasks/${done.dataset.done}`, { method: "PATCH", body: { status: "COMPLETED" } }); flash(t("Tarefa concluída.")); }
    catch (err) { flash(err.message); done.disabled = false; }
    return loadHome(["plan", "act"]);
  }
  const task = e.target.closest("[data-task]");
  if (task) openTaskModal(Number(task.dataset.task));
}

/* ---------- the page ---------- */
// The clock moves on the minute, and stops by itself once the page is gone.
let homeClock = null;
function startHomeClock() {
  clearTimeout(homeClock);
  const next = () => {
    const clock = $("in-clock");
    if (!clock) return;
    clock.textContent = fmt.hhmm(new Date().toISOString());
    homeClock = setTimeout(next, 60000 - (Date.now() % 60000) + 20);
  };
  homeClock = setTimeout(next, 60000 - (Date.now() % 60000) + 20);
}

// A promise, as the live events expect of the loaders they call.
async function loadHome(parts = ["team", "news", "plan", "act", "biz"]) {
  if (!$("in-team")) return;
  const jobs = [];
  if (parts.includes("team")) jobs.push(mount($("in-team"), teamMini, 1));
  if (parts.includes("team") || parts.includes("plan")) jobs.push(mount($("in-doing"), doingBody, 1));
  if (parts.includes("news")) jobs.push(mount($("in-newsbar"), newsBar, 1));
  if (parts.includes("plan") || parts.includes("news")) jobs.push(mount($("in-alert"), alertBody, 2));
  if (parts.includes("plan") || parts.includes("biz")) jobs.push(mount($("in-pulse"), pulseBody, 1));
  if (parts.includes("plan")) jobs.push(mount($("in-tasks"), tasksBody, 5), mount($("in-week"), weekBody, 1));
  if (parts.includes("plan") && !focusGet()) jobs.push(mount($("in-focus"), focusBody, 1));
  if (parts.includes("act")) jobs.push(mount($("in-act"), activityBody, 3));
  if (parts.includes("biz") || parts.includes("plan")) jobs.push(mount($("in-biz"), cmdBody, 4));
  await Promise.all(jobs);
}

// "A fazer agora": whoever said "Estou a fazer" on a task shows on Início with the same card the task's window has
// (the face in the green ring, the name, since when), with the task's title on top. A click opens the task; yours
// keeps its "Parar".
async function doingBody() {
  const busy = (await api("/api/team")).filter((m) => m.doing);
  if (!busy.length) return "";
  return `<div class="in-doing-head">${icon("play")}<b>${t("A fazer agora")}</b><i>${busy.length}</i></div><div class="in-doing-list">${busy.map((m) =>
    `<a class="in-doing-card" href="#/tarefas/${m.doing.id}"><span class="in-doing-task">${esc(m.doing.title)}</span>${doingCard(m.display_name, m.doing.since, m.user === me.username)}</a>`).join("")}</div>`;
}
document.addEventListener("click", async (e) => {
  const stop = e.target.closest(".in-doing [data-act=notdoing]");
  if (!stop) return;
  e.preventDefault(); e.stopPropagation();
  const id = stop.closest(".in-doing-card").getAttribute("href").split("/").pop();
  try { await api(`/api/tasks/${id}`, { method: "PATCH", body: { doing: false } }); flash(t("Paraste esta tarefa.")); } catch (err) { flash(err.message); }
  loadHome(["team"]);
}, true);

HUB_VIEWS.home = async function viewHome() {
  let ignite = false; // the car comes out of the dark once per session; after that it is simply there
  try { ignite = !sessionStorage.getItem("hub.lights"); sessionStorage.setItem("hub.lights", "1"); } catch { /* private window: no start-up */ }
  // 13 nov (David: «quero tudo visível só de olhar, sem scroll»): saudação com a equipa ao lado, a doca, a faixa «Hoje», e
  // por baixo o dia de cada um ao lado dos negócios. O que está a acontecer vive em Ao vivo; o progresso em Análise.
  $("view").innerHTML = `<div class="page inicio"><div id="in-newsbar" class="in-newsbar"></div>${heroHtml(new Date(), ignite)}
    <span id="in-apps-mark" hidden></span>${shortcutsHtml()}
    <div id="in-alert" class="in-alert"></div><div id="in-pulse" class="in-pulse"></div><div id="in-doing" class="in-doing"></div>
    <div class="in-main">
      <section class="in-card in-tasks">${cardHead("tasks", "O teu dia", "", seeAll("Ver todas", "#/tarefas"))}<div id="in-tasks"></div><div id="in-week" class="fx fx-wk"></div></section>
      <section class="in-card in-bizc">${cardHead("spark", "Comando", "", seeAll("Escritório", "#/escritorio"))}${askHtml()}<div id="in-biz"></div></section>
      <div class="in-col3"><section class="in-card in-focusc"><div id="in-focus" class="fx"></div></section>
        <section class="in-card in-feed">${cardHead("bolt", "Agora", "", seeAll("Ver tudo", "#/aovivo"))}<div id="in-act"></div></section></div>
    </div></div>`;
  $("view").onclick = homeClick;
  $("ck-ask").onsubmit = ckSend;
  $("ck-in").oninput = ckRoute;
  startHomeClock();
  loadHome().then(() => { if (focusGet()) mount($("in-focus"), focusBody, 1).then(focusRun); });
  shortcutsFill();
};

// A live event reloads only what shows that kind of thing ("tick" is the slow safety net: all of it).
onLive(["presence"], () => loadHome(["team", "act"]));
onLive(["notification"], () => loadHome(["news"]));
onLive(["task"], () => loadHome(["plan", "act"]));
onLive(["activity", "ponto"], () => loadHome(["act"]));
onLive(["tick"], () => { shortcutsFill(); return loadHome(); });
onLive(["vinted", "mail", "etsy"], () => loadHome(["biz"]));
