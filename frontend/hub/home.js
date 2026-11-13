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
    <div class="hero-side"><div id="in-focus" class="in-focus"></div><div id="in-newsbar" class="in-newsbar"></div></div>
  </header>`;
}

// Atalhos, hoje só no Início do telemóvel (mobile.js); o do computador deixou de ter a doca (13 nov, 4.ª volta).
// 13 nov, David: «botões bem vistos e as funcionalidades mais importantes todas a jeito, estilo iPhone em vidro»: uma
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
    if (!href) return `<button type="button" class="in-app" data-act="${id}" title="${esc(t(label))}">${inner}</button>`;
    const out = href.startsWith("http");
    return `<a class="in-app" data-app="${id}" href="${href}" title="${esc(t(label))}"${out ? ' target="_blank" rel="noopener"' : ""}>${inner}</a>`;
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
  // 13 nov, 4.ª volta: uma linha de números por baixo da caixa, cada um leva à página dele; o pormenor vai no title
  const tile = (go, ic, n, label, sub, tone = "") => `<button class="cc-n ${tone}" data-go="${go}" title="${esc(sub)}">${icon(ic)}
    <b>${n ?? "—"}</b><span>${esc(t(label))}</span></button>`;
  return `<div class="cc-nrow">
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
    const to = $("ck-to")?.value || "";   // o «Para» da barra do computador: vazio é o escritório (o teu agente escolhe o departamento)
    const made = await api("/api/tasks", { method: "POST", body: { title, description: "", assignee: to || me.username, for_ai: true, crew: "" } });
    flash(t("Mandada para {d}. O agente começa sozinho.", { d: made.crew_name || t("o escritório") }));
    input.value = ""; ckRoute();
    form.classList.add("sent"); setTimeout(() => form.classList.remove("sent"), 900);
    loadHome(["plan", "biz"]);
  } catch (err) { flash(err.message); }
  form.classList.remove("sending");
}

/* ---------- 13 nov, 6.ª volta (David: «quero os agentes como uma entidade, como o meu agente de verdade: clico nele e falo
   com ele como com uma pessoa»; dos tokens gostou) ----------
   Cada pessoa tem um agente, desenhado como uma esfera: o anel à volta é o Claude de 5 h já gasto (branco, âmbar a partir de
   70%, vermelho a partir de 90%), e a esfera acende-se a verde quando está a trabalhar e a âmbar quando espera por alguém.
   Um clique abre a conversa com ele, ao lado (agentChat): o teu agente é uma conversa do Claude a sério (/api/conversas, a
   mesma da página Claude); o de um colega recebe o que lhe escreves como tarefa para o agente dele, e a resposta é o
   resultado dessa tarefa. */
const tokK = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(".", ",")}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n || 0));
const levelOf = (p) => (p == null ? "" : p >= 90 ? "bad" : p >= 70 ? "warn" : "ok");
const winTok = (x) => (x.tokens || 0) + (x.agents || []).reduce((n, a) => n + (a.tokens || 0), 0);
function ringSvg(p) {
  const r = 46, c = 2 * Math.PI * r, v = p == null ? 0 : Math.max(0, Math.min(100, p));
  return `<svg class="ae-ring" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="${r}"/><circle class="v" cx="50" cy="50" r="${r}" stroke-dasharray="${(c * v / 100).toFixed(1)} ${c.toFixed(1)}"/></svg>`;
}
const agentName = (m) => (m.user === me.username ? t("O teu agente") : t("Agente {n}", { n: m.display_name }));

/* ---------- o cérebro de cada agente (7.ª volta, 13 nov, David: «bué linhas em forma de um cérebro ou uma bola com milhares
   de linhas, como uma inteligência extrema») ---------- */
// Uma rede numa esfera: ~470 nós (a pele numa espiral de Fibonacci e um miolo solto), cada um ligado aos 4 mais perto, mais
// cordas que atravessam o miolo: ~1800 linhas. Calcula-se uma vez; cada imagem só roda os pontos e risca as linhas em quatro
// camadas de profundidade (quatro traços por imagem). Quem trabalha roda depressa e tem faíscas a correr pelas ligações;
// quem espera roda devagar a 12 imagens/s; parado ou desligado é uma imagem só. Fora do ecrã ou noutra página, nada corre.
const BRAIN = (() => {
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pts = [], N = 380, golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(1 - y * y), th = golden * i, k = 0.9 + rnd() * 0.12;
    pts.push([Math.cos(th) * r * k, y * k, Math.sin(th) * r * k]);
  }
  for (let i = 0; i < 90; i++) {
    const u = rnd() * 2 - 1, th = rnd() * 2 * Math.PI, r = 0.25 + Math.cbrt(rnd()) * 0.55, s = Math.sqrt(1 - u * u);
    pts.push([Math.cos(th) * s * r, u * r, Math.sin(th) * s * r]);
  }
  const M = pts.length, seen = new Set(), edges = [];
  const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  const add = (i, j) => { const key = i < j ? i * M + j : j * M + i; if (i !== j && !seen.has(key)) { seen.add(key); edges.push(i, j); } };
  for (let i = 0; i < M; i++) {
    pts.map((p, j) => [d2(pts[i], p), j]).sort((a, b) => a[0] - b[0]).slice(1, 5).forEach(([, j]) => add(i, j));
  }
  for (let n = 0; n < 420; n++) {
    const i = Math.floor(rnd() * M), j = Math.floor(rnd() * M), d = d2(pts[i], pts[j]);
    if (d > 0.5 && d < 2.6) add(i, j);
  }
  return { pts, edges: Int16Array.from(edges), X: new Float32Array(M), Y: new Float32Array(M), Z: new Float32Array(M) };
})();
const BRAIN_RGB = { work: "74,222,128", wait: "255,177,92", on: "214,220,228", off: "120,126,134" };
const BRAIN_SPIN = { work: 0.42, wait: 0.12, on: 0, off: 0 };
const BRAIN_FPS = { work: 30, wait: 12 };
const brainHtml = (state, size) => `<canvas class="ae-brain" data-state="${state}" data-size="${size}" width="${size}" height="${size}" aria-hidden="true"></canvas>`;
function brainDraw(cv, time) {
  const dpr = Math.min(2, window.devicePixelRatio || 1), css = Number(cv.dataset.size), px = Math.round(css * dpr);
  if (cv.width !== px) { cv.width = px; cv.height = px; cv.style.width = cv.style.height = `${css}px`; }
  const g = cv.getContext("2d"), st = cv.dataset.state, rgb = BRAIN_RGB[st] || BRAIN_RGB.on, h = px / 2, R = px * 0.43;
  const a = 0.6 + time * BRAIN_SPIN[st], ca = Math.cos(a), sa = Math.sin(a), tilt = 0.42, ct = Math.cos(tilt), stl = Math.sin(tilt);
  const { pts, edges, X, Y, Z } = BRAIN;
  for (let i = 0; i < pts.length; i++) {
    const [x, y, z] = pts[i], x1 = x * ca + z * sa, z1 = -x * sa + z * ca, y1 = y * ct - z1 * stl, z2 = y * stl + z1 * ct;
    const k = 1 / (1.9 - z2 * 0.35);   // um pouco de perspetiva: a frente fica maior
    X[i] = h + x1 * R * k * 1.55; Y[i] = h + y1 * R * k * 1.55; Z[i] = z2;
  }
  const beat = st === "work" ? 0.82 + 0.18 * Math.sin(time * 2.4) : st === "off" ? 0.45 : 0.75;
  g.clearRect(0, 0, px, px);
  g.globalCompositeOperation = "lighter";
  const glow = g.createRadialGradient(h, h, 0, h, h, R * 1.15);
  glow.addColorStop(0, `rgba(${rgb},${0.22 * beat})`); glow.addColorStop(0.55, `rgba(${rgb},${0.06 * beat})`); glow.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = glow; g.fillRect(0, 0, px, px);
  g.lineWidth = Math.max(0.5, px / 260);
  const alpha = [0.05, 0.11, 0.2, 0.36];
  for (let b = 0; b < 4; b++) {
    g.beginPath();
    for (let e = 0; e < edges.length; e += 2) {
      const i = edges[e], j = edges[e + 1], z = (Z[i] + Z[j]) / 2;
      if (Math.min(3, Math.max(0, Math.floor((z + 1) * 2))) !== b) continue;
      g.moveTo(X[i], Y[i]); g.lineTo(X[j], Y[j]);
    }
    g.strokeStyle = `rgba(${rgb},${alpha[b] * beat})`; g.stroke();
  }
  g.fillStyle = `rgba(${rgb},${0.7 * beat})`;
  const dot = Math.max(1, px / 130);
  for (let i = 0; i < pts.length; i += 2) if (Z[i] > 0.35) g.fillRect(X[i] - dot / 2, Y[i] - dot / 2, dot, dot);
  if (st === "work") {   // faíscas: impulsos a correr pelas ligações
    const E = edges.length / 2;
    g.fillStyle = "rgba(235,255,240,.95)";
    for (let k = 0; k < 26; k++) {
      const run = time * 1.4 + k * 0.618, e = (Math.floor(run) * 7919 + k * 104729) % E * 2, f = run % 1;
      const i = edges[e], j = edges[e + 1];
      if ((Z[i] + Z[j]) < -0.6) continue;
      g.beginPath(); g.arc(X[i] + (X[j] - X[i]) * f, Y[i] + (Y[j] - Y[i]) * f, dot * 1.3, 0, 7); g.fill();
    }
  }
  g.globalCompositeOperation = "source-over";
}
let brainRaf = 0;
const brainStill = matchMedia("(prefers-reduced-motion: reduce)");
const brainSeen = new WeakMap();   // canvas → à vista (IntersectionObserver)
const brainIO = "IntersectionObserver" in window ? new IntersectionObserver((list) => {
  list.forEach((x) => brainSeen.set(x.target, x.isIntersecting));
  brainStart();
}) : null;
function brainLoop(now) {
  brainRaf = 0;
  let moving = false;
  for (const cv of document.querySelectorAll("canvas.ae-brain")) {
    const fps = BRAIN_FPS[cv.dataset.state];
    if (!fps || brainStill.matches || brainSeen.get(cv) === false) continue;
    moving = true;
    if (now - (Number(cv.dataset.at) || 0) >= 1000 / fps - 2) { cv.dataset.at = now; brainDraw(cv, now / 1000); }
  }
  if (moving && !document.hidden) brainRaf = requestAnimationFrame(brainLoop);
}
// Desenha as esferas novas uma vez e põe a andar as que têm de andar.
const brainWatched = new Set();
function brainStart() {
  for (const cv of brainWatched) if (!cv.isConnected) { brainIO?.unobserve(cv); brainWatched.delete(cv); }
  for (const cv of document.querySelectorAll("canvas.ae-brain")) {
    if (!cv.dataset.drawn) { cv.dataset.drawn = "1"; brainDraw(cv, performance.now() / 1000); brainIO?.observe(cv); brainWatched.add(cv); }
  }
  if (!brainRaf) brainRaf = requestAnimationFrame(brainLoop);
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) brainStart(); });
let agentsSeen = [];   // o que a última leitura disse de cada agente, para o cabeçalho da conversa
async function agentsBody() {
  const [team, lims, mine, office] = await Promise.all([api("/api/team"), soft("/api/limits/team"), soft("/api/limits"), soft("/api/office")]);
  const wins = office?.sessions || [], fresh = (x) => Date.now() - new Date(x.updated_at) < 12 * 3600e3;
  const order = [...team].sort((a, b) => (b.user === me.username) - (a.user === me.username) || (a.status === "OFFLINE") - (b.status === "OFFLINE"));
  agentsSeen = order.map((m) => {
    const own = m.user === me.username;
    const l = own && mine?.claude ? { ...mine.claude, seen: new Date(mine.claude.saved_at * 1000).toISOString() } : lims?.[m.user] || null;
    const old = l?.seen && Date.now() - new Date(l.seen) > 864e5;
    const ws = wins.filter((x) => x.user === m.user);
    const work = ws.filter((x) => x.state === "working"), wait = ws.filter((x) => x.state === "waiting" && fresh(x));
    const on = m.status !== "OFFLINE";
    const state = work.length || m.doing ? "work" : wait.length ? "wait" : on ? "on" : "off";
    const word = work.length > 1 ? t("{n} trabalhos ao mesmo tempo", { n: work.length }) : work.length || m.doing ? t("A trabalhar")
      : wait.length ? t(own ? "À tua espera" : "À espera de {n}", { n: m.display_name }) : on ? t("Pronto") : t("A dormir");
    const now = work[0] ? work[0].title || work[0].topic : m.doing ? m.doing.title : wait[0] ? wait[0].title || wait[0].topic : "";
    return { m, own, state, word, now, five: old ? null : l?.five, week: old ? null : l?.week, reset: !old && l?.five_reset ? l.five_reset : null,
      today: ws.filter((x) => sameDayAs(x.updated_at)).reduce((n, x) => n + winTok(x), 0) };
  });
  const bar = (label, p) => `<span class="ae-b ${levelOf(p)}"><small>${label}</small><i><b style="width:${p == null ? 0 : Math.min(100, p)}%"></b></i><em>${p == null ? "—" : `${Math.round(p)}%`}</em></span>`;
  return `<div class="ae-row">${agentsSeen.map((a) => `
    <button type="button" class="ae is-${a.state} ${chatUser === a.m.user ? "open" : ""}" data-agent="${esc(a.m.user)}" title="${esc(t("Falar com {n}", { n: agentName(a.m) }))}">
      <span class="ae-orb ${levelOf(a.five)}">${brainHtml(a.state, 104)}${ringSvg(a.five)}<span class="ae-who">${ui.avatar(a.m.display_name)}</span></span>
      <span class="ae-main">
        <b class="ae-name">${esc(agentName(a.m))}</b>
        <span class="ae-st"><i></i>${esc(a.word)}<span class="ae-tok"><b>${tokK(a.today)}</b>${t("tokens hoje")}</span></span>
        <span class="ae-now">${esc(a.now || (a.state === "off" ? t("Acorda quando {n} ligar o computador", { n: a.own ? t("tu") : a.m.display_name }) : t("Diz-lhe o que queres feito")))}</span>
        <span class="ae-meters">${bar("5 h", a.five)}${bar(t("Semana"), a.week)}</span>
      </span>
      <span class="ae-talk">${icon("chat")}</span>
    </button>`).join("")}</div>`;
}

/* ---------- a conversa com um agente ---------- */
let chatUser = null, chatConv = null, chatTimer = null, chatBusy = false;
const chatText = (s) => esc(s).replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)»"']/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`).replace(/\n/g, "<br>");
const shortTitle = (text) => { const line = text.replace(/\s+/g, " ").trim(); return line.length <= 70 ? line : `${line.slice(0, 69).trim()}…`; };
const AGENT_HINTS = [
  t("O que fizeste hoje?"),
  t("Vê os e-mails por responder e prepara as respostas"),
  t("Faz 3 desenhos novos para a Etsy"),
  t("Encontra 10 negócios perto de mim que precisam de site"),
];
async function chatOwnLoad() {
  const L = await api("/api/conversas");
  const c = chatConv ? L.conversas.find((x) => x.id === chatConv)
    : chatFresh ? null : L.conversas.find((x) => x.busy || Date.now() - new Date(x.updated_at) < 6 * 3600e3);
  if (!c) return { msgs: [], busy: false, where: L.pc_online ? "pc" : "nuvem" };
  chatConv = c.id;
  const d = await api(`/api/conversas/${c.id}`);
  return { busy: d.busy, action: d.action, where: d.where, approvals: d.approvals || [],
    msgs: d.messages.map((x) => ({ mine: x.kind === "message", err: x.kind === "error", text: x.text, at: x.at })) };
}
async function chatMateLoad(user) {
  const tasks = await api("/api/tasks"), week = Date.now() - 7 * 864e5;
  const asked = tasks.filter((x) => x.assignee === user && x.created_by === me.username && !x.trashed_at && new Date(x.created_at) > week)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at)).slice(-12);
  const msgs = [];
  for (const x of asked) {
    msgs.push({ mine: true, text: x.description || x.title, at: x.created_at });
    if (x.result) msgs.push({ mine: false, text: x.result, at: x.completed_at || x.updated_at });
    else if (x.status === "FAILED" || x.status === "STOPPED") msgs.push({ mine: false, err: true, text: x.blocked_reason || t("Não consegui fazer isto."), at: x.updated_at });
    else if (x.status === "TODO") msgs.push({ mine: false, quiet: true, text: t("Ficou na lista, à espera que alguém a mande arrancar."), at: x.updated_at });
  }
  const run = asked.find((x) => ["ASSIGNED", "IN_PROGRESS", "WAITING_APPROVAL", "NEEDS_HELP"].includes(x.status));
  return { msgs, busy: !!run, action: run ? run.current_action || (run.status === "ASSIGNED" ? t("Na fila, começa quando o computador estiver ligado") : "") : "" };
}
function chatShell(a) {
  return `<aside class="agc" id="agc" role="dialog" aria-label="${esc(t("Conversa com {n}", { n: agentName(a.m) }))}">
    <header class="agc-h">
      <span class="ae-orb sm is-${a.state} ${levelOf(a.five)}">${brainHtml(a.state, 48)}${ringSvg(a.five)}</span>
      <div><b>${esc(agentName(a.m))}</b><span id="agc-st">${esc(a.word)}${a.five == null ? "" : ` · ${t("5 h a {p}%", { p: Math.round(a.five) })}`} · ${tokK(a.today)} ${t("tokens hoje")}</span></div>
      ${a.own ? `<button type="button" class="agc-ic" data-chat-new title="${esc(t("Nova conversa"))}">${icon("plus")}</button>` : ""}
      <a class="agc-ic" href="#/agentes/${esc(a.m.user)}" title="${esc(t("Ver tudo o que faz"))}">${icon("arrow")}</a>
      <button type="button" class="agc-ic" data-chat-close title="${esc(t("Fechar"))}">${icon("x")}</button>
    </header>
    <div class="agc-body" id="agc-body"></div>
    <form class="agc-f" id="agc-f" autocomplete="off">
      <textarea id="agc-in" rows="1" maxlength="4000" placeholder="${esc(a.own ? t("Escreve ao teu agente…") : t("Escreve ao agente do {n}…", { n: a.m.display_name }))}"></textarea>
      <button class="agc-go" aria-label="${esc(t("Enviar"))}">${icon("arrow")}</button>
    </form></aside>`;
}
async function chatRefresh() {
  clearTimeout(chatTimer);
  const body = $("agc-body"), a = agentsSeen.find((x) => x.m.user === chatUser);
  if (!body || !a) return;
  let d;
  try { d = a.own ? await chatOwnLoad() : await chatMateLoad(a.m.user); } catch (err) { body.innerHTML = `<p class="agc-err">${esc(err.message)}</p>`; return; }
  if (!$("agc-body") || chatUser !== a.m.user) return;
  const hello = `<div class="agc-m ag"><p>${esc(a.own ? t("Olá, {n}. Sou o teu agente. Diz-me o que queres feito e eu trato disso.", { n: me.display_name })
    : t("Olá. Sou o agente do {n}. O que me pedires entra na lista dele e eu faço-o.", { n: a.m.display_name }))}</p></div>`;
  const rows = d.msgs.map((x) => `<div class="agc-m ${x.mine ? "me" : "ag"} ${x.err ? "err" : ""} ${x.quiet ? "quiet" : ""}"><p>${chatText(x.text)}</p>${x.at ? `<time>${fmt.ago(x.at)}</time>` : ""}</div>`).join("");
  const asks = (d.approvals || []).map((x) => `<div class="agc-m ag warn"><p><b>${t("Preciso da tua aprovação")}</b><br>${esc(x.action)}</p><a href="#/claude/${chatConv}">${t("Ver e aprovar")}</a></div>`).join("");
  const typing = d.busy ? `<div class="agc-m ag typing"><p><span class="dots"><i></i><i></i><i></i></span>${esc(d.action || t("A pensar…"))}</p></div>` : "";
  const hints = d.msgs.length ? "" : `<div class="agc-hints">${AGENT_HINTS.map((h) => `<button type="button" data-hint="${esc(h)}">${esc(h)}</button>`).join("")}</div>`;
  const stick = body.scrollHeight - body.scrollTop - body.clientHeight < 60;
  body.innerHTML = hello + rows + asks + typing + hints;
  if (stick || !body.dataset.ready) body.scrollTop = body.scrollHeight;
  body.dataset.ready = "1";
  chatTimer = setTimeout(chatRefresh, d.busy ? 4000 : 20000);
}
function chatOpen(user) {
  const a = agentsSeen.find((x) => x.m.user === user);
  if (!a) return;
  chatClose(true);
  chatUser = user; chatConv = null; chatFresh = false;
  $("view").querySelector(".page.inicio").insertAdjacentHTML("beforeend", chatShell(a));
  document.querySelectorAll(".ae").forEach((x) => x.classList.toggle("open", x.dataset.agent === user));
  const input = $("agc-in");
  input.oninput = () => { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 140) + "px"; };
  input.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("agc-f").requestSubmit(); } };
  $("agc-f").onsubmit = chatSend;
  requestAnimationFrame(() => { $("agc")?.classList.add("in"); input.focus(); });
  brainStart();
  chatRefresh();
}
function chatClose(quick) {
  clearTimeout(chatTimer);
  const el = $("agc");
  chatUser = null;
  document.querySelectorAll(".ae.open").forEach((x) => x.classList.remove("open"));
  if (!el) return;
  if (quick) el.remove(); else { el.classList.remove("in"); setTimeout(() => el.remove(), 220); }
}
async function chatSend(e) {
  e.preventDefault();
  const input = $("agc-in"), text = input.value.trim(), a = agentsSeen.find((x) => x.m.user === chatUser);
  if (!text || !a || chatBusy) return;
  chatBusy = true; $("agc-f").classList.add("sending");
  try {
    if (!a.own) await api("/api/tasks", { method: "POST", body: { title: shortTitle(text), description: text, assignee: a.m.user, for_ai: true, crew: "" } });
    else if (chatConv) await api(`/api/conversas/${chatConv}`, { method: "POST", body: { text } });
    else {
      const L = await api("/api/conversas");
      chatConv = (await api("/api/conversas", { method: "POST", body: { text, where: L.pc_online ? "pc" : "nuvem", project: "" } })).id;
      chatFresh = false;
    }
    input.value = ""; input.style.height = "auto";
    await chatRefresh();
  } catch (err) { flash(err.message); }
  chatBusy = false; $("agc-f")?.classList.remove("sending");
}
async function chatClick(e) {
  const agent = e.target.closest("[data-agent]");
  if (agent) { chatUser === agent.dataset.agent ? chatClose() : chatOpen(agent.dataset.agent); return true; }
  if (e.target.closest("[data-chat-close]")) { chatClose(); return true; }
  if (e.target.closest("[data-chat-new]")) { await chatRefreshNew(); return true; }
  const hint = e.target.closest("[data-hint]");
  if (hint) { const input = $("agc-in"); input.value = hint.dataset.hint; input.focus(); input.oninput(); return true; }
  return false;
}
// «Nova conversa»: a próxima mensagem começa outra (chatConv a null depois de mostrar a conversa vazia)
async function chatRefreshNew() {
  chatConv = null; clearTimeout(chatTimer);
  const body = $("agc-body");
  if (body) { body.dataset.ready = ""; body.innerHTML = `<div class="agc-m ag"><p>${esc(t("Conversa nova. O que queres que eu faça?"))}</p></div>
    <div class="agc-hints">${AGENT_HINTS.map((h) => `<button type="button" data-hint="${esc(h)}">${esc(h)}</button>`).join("")}</div>`; }
  chatFresh = true;
}
let chatFresh = false;
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && $("agc")) chatClose(); });

const bestDeal = (vinted) => (vinted ? (vinted.alertas || []).filter((a) => a.lucro > 0).sort((a, b) => b.lucro - a.lucro)[0] : null);
function tipsHtml(mail, vinted, etsy, cal) {
  const best = bestDeal(vinted), news = nextNews(cal)[0];
  const porVer = mail ? (mail.threads || []).filter((x) => x.por_ver > 0).length : 0;
  // sugestões: o que os dados dizem que dá jeito fazer agora; «fill» escreve o pedido na caixa, «go» abre a página
  const tips = [
    porVer ? ["fill", "mail", t(porVer === 1 ? "Responder ao e-mail por ver" : "Responder aos {n} e-mails", { n: porVer }), t("Responde aos e-mails por ver da Ten Fold e mostra-me as respostas antes de enviar")] : null,
    etsy?.counts?.new ? ["go", "layers", t("Rever {n} desenhos Etsy", { n: etsy.counts.new }), "#/etsy"] : null,
    best ? ["go", "bag", t("Pechincha +{v}", { v: eur(best.lucro) }), "#/vinted"] : null,
    news ? ["go", "trend", `${news.currency} ${untilOf(news.ts)}`, "#/sinal"] : null,
    ["fill", "search", t("Procurar clientes"), t("Vai ao Radar e encontra 10 negócios perto de mim que precisam de site")],
  ].filter(Boolean).slice(0, 4);
  return `<div class="ck-tips">${tips.map(([k, ic, label, v]) => `<button type="button" class="ck-tip" data-${k === "fill" ? "fill" : "go"}="${esc(v)}">${icon(ic)}<span>${esc(label)}</span></button>`).join("")}</div>`;
}
const tipsBody = async () => tipsHtml(...await Promise.all([soft("/api/mail"), soft("/api/vinted"), soft("/api/etsy"), soft("/api/trading/calendar")]));

async function cmdBody() {
  const [tasks, mail, vinted, etsy, cal] = await Promise.all([api("/api/tasks"), soft("/api/mail"), soft("/api/vinted"), soft("/api/etsy"), soft("/api/trading/calendar")]);
  const best = bestDeal(vinted), news = nextNews(cal)[0];
  const office = tasks.filter((x) => x.crew && x.stage !== "done" && !x.trashed_at);
  const busy = office.filter((x) => x.stage === "in_progress" || x.status === "RUNNING" || x.status === "IN_PROGRESS");
  const queued = office.length - busy.length;

  const tipHtml = tipsHtml(mail, vinted, etsy, cal);

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

/* ---------- Modo foco (13 nov, David: «funcionalidades novas») ---------- */
// Foco: 25 minutos numa das tuas tarefas; a tarefa fica «A fazer agora» para a equipa ver, o relógio conta até zero e no fim
// acabas a tarefa ou dás mais 5 min. O relógio guarda-se no navegador: sobrevive a recarregar a página.
const FOCUS_KEY = "hub.focus";
const focusGet = () => { try { return JSON.parse(localStorage.getItem(FOCUS_KEY) || "null"); } catch { return null; } };
const focusSet = (v) => { try { v ? localStorage.setItem(FOCUS_KEY, JSON.stringify(v)) : localStorage.removeItem(FOCUS_KEY); } catch { /* sem armazenamento */ } };
let focusTick = null;

// 13 nov, 4.ª volta: o Foco já não tem cartão. Cada tarefa tua tem um ▶ na linha; enquanto conta, o relógio fica no topo
// da página, ao lado das notificações, com Feita, +5 e Parar.
async function focusBody() {
  const f = focusGet();
  if (!f) return "";
  return `<div class="fp"><i class="fp-dot"></i><b class="fp-time" id="fx-time">--:--</b>
    <button class="fp-t" data-task="${f.id}" title="${esc(f.title)}">${esc(f.title)}</button>
    <button class="fp-b ok" data-fx="done" title="${t("Feita")}">${icon("tick")}</button><button class="fp-b" data-fx="more" title="${t("Mais 5 minutos")}">+5</button>
    <button class="fp-b" data-fx="stop" title="${t("Parar")}">${icon("stop")}</button></div>`;
}
function focusRun() {
  clearInterval(focusTick);
  const step = () => {
    const f = focusGet(), time = $("fx-time");
    if (!f || !time) return clearInterval(focusTick);
    const total = f.mins * 60e3, left = Math.max(0, f.start + total - Date.now());
    time.textContent = `${String(Math.floor(left / 60e3)).padStart(2, "0")}:${String(Math.floor(left / 1e3) % 60).padStart(2, "0")}`;
    const end = !left;
    time.closest(".fp").classList.toggle("end", end);
    if (end && !f.told) { focusSet({ ...f, told: true }); flash(t("Foco acabado. Acabaste «{t}»?", { t: f.title })); }
  };
  step(); focusTick = setInterval(step, 1000);
}
async function focusClick(e) {
  const start = e.target.closest("[data-fx-start]");
  if (start) {
    const id = Number(start.dataset.fxId);
    focusSet({ id, title: start.dataset.fxTitle, mins: Number(start.dataset.fxStart), start: Date.now() });
    api(`/api/tasks/${id}`, { method: "PATCH", body: { doing: true } }).catch(() => {});
    await mount($("in-focus"), focusBody, 1); focusRun(); loadHome(["team", "plan"]);
    return true;
  }
  const act = e.target.closest("[data-fx]")?.dataset.fx;
  if (!act) return false;
  const f = focusGet();
  if (!f) return true;
  if (act === "more") { focusSet({ ...f, mins: f.mins + 5, told: false }); focusRun(); return true; }
  focusSet(null); clearInterval(focusTick);
  await mount($("in-focus"), focusBody, 1);
  try {
    await api(`/api/tasks/${f.id}`, { method: "PATCH", body: act === "done" ? { status: "COMPLETED", doing: false } : { doing: false } });
    if (act === "done") flash(t("Tarefa concluída. Bom foco."));
  } catch (err) { flash(err.message); }
  loadHome(["plan", "team", "ops"]);
  return true;
}

/* ---------- «Operações»: a empresa a trabalhar, ao vivo (13 nov, David: «como se fosse uma empresa enorme de agentes») ----------
   Uma linha por cada coisa em curso: as janelas do Claude de toda a equipa (a trabalhar ou à espera de alguém), o trabalho
   do escritório (a fazer ou na fila) e quem disse «Estou a fazer». O que está à tua espera vem primeiro. Por baixo, o que os
   agentes acabaram hoje, com a frase final de cada um. */
const sameDayAs = (iso) => iso && new Date(iso) >= startOfDay(new Date());
// 7.ª volta (13 nov, David: «a outra parte da página está horrível, bué espaço livre, tarefas com um design de merda e só duas
// filas»): por baixo dos agentes, um painel de três colunas que enche o ecrã até ao fundo. «Ao vivo» é uma lista com tudo o que
// corre (cada linha abre a conversa com esse agente); «As tuas tarefas» tem a captura rápida em cima (Enter guarda, o ✦ manda-a
// ao teu agente) e a lista com Hoje / Amanhã / Esta semana; à direita o «Radar» (a próxima notícia vermelha com contagem, a
// melhor pechincha, a Etsy e os e-mails) e «A semana» (tarefas acabadas por dia e por pessoa, e quem mais fechou hoje).
const LIVE_ROWS = 8;
async function liveBody() {
  const [office, tasks, team] = await Promise.all([soft("/api/office"), api("/api/tasks"), api("/api/team")]);
  const wins = office?.sessions || [], recent = (x) => Date.now() - new Date(x.updated_at) < 12 * 3600e3;
  const live = wins.filter((x) => x.state !== "ended" && recent(x));
  const mineWait = (x) => x.state !== "working" && x.user === me.username;
  live.sort((a, b) => mineWait(b) - mineWait(a) || (a.state !== "working") - (b.state !== "working") || new Date(b.updated_at) - new Date(a.updated_at));
  const crew = tasks.filter((x) => x.crew && x.stage !== "done" && !x.trashed_at);
  const working = live.filter((x) => x.state === "working").length + crew.filter((x) => x.stage === "in_progress").length + team.filter((m) => m.doing).length;
  const waiting = live.filter((x) => x.state !== "working").length, queued = crew.filter((x) => x.stage !== "in_progress").length;
  const ended = wins.filter((x) => x.state === "ended" && sameDayAs(x.updated_at)).length;
  const rows = [
    ...live.map((x) => {
      const work = x.state === "working", mine = x.user === me.username;
      const what = [x.project, (x.action || "").replace(/^a correr: /, "").replace(/^acabou: .*/, "")].filter(Boolean).join(" · ");
      return `<button type="button" class="lv ${work ? "work" : mine ? "you" : "wait"}" data-agent="${esc(x.user)}">
        <span class="lv-av">${ui.avatar(x.name, "sm")}<i></i></span>
        <span class="lv-t"><b>${esc(x.title || x.topic || t("Janela do Claude"))}</b><span>${esc(what || x.name)}</span></span>
        <span class="lv-s"><em>${esc(work ? t("A trabalhar") : mine ? t("À tua espera") : t("À espera de {n}", { n: x.name }))}</em><time>${fmt.ago(x.updated_at)}</time></span></button>`;
    }),
    ...crew.map((x) => `<button type="button" class="lv ${x.stage === "in_progress" ? "work" : "queue"}" data-task="${x.id}">
        <span class="lv-av"><span class="lc-mono">${esc(DEPT[x.crew] || "AMG")}</span><i></i></span>
        <span class="lv-t"><b>${esc(x.title)}</b><span>${esc([x.crew_name, x.current_action || x.last_action].filter(Boolean).join(" · ") || t("Escritório"))}</span></span>
        <span class="lv-s"><em>${esc(x.stage === "in_progress" ? t("A trabalhar") : t("Na fila"))}</em><time>${fmt.ago(x.updated_at || x.created_at)}</time></span></button>`),
  ];
  const all = working + waiting + queued || 1, seg = (n, cls) => (n ? `<i class="${cls}" style="flex:${n}"></i>` : "");
  return `<header class="dk-h">${icon("bolt")}<b>${t("Ao vivo")}</b><a href="#/escritorio">${t("Escritório")}${icon("chevron")}</a></header>
    <div class="lv-sum"><span class="on"><b>${working}</b>${t("a trabalhar")}</span><span class="wt"><b>${waiting}</b>${t("à espera")}</span>
      <span><b>${queued}</b>${t("na fila")}</span><span><b>${ended}</b>${t("acabadas hoje")}</span></div>
    <div class="lv-bar">${seg(working, "on")}${seg(waiting, "wt")}${seg(queued, "q")}${all === 1 && !working && !waiting && !queued ? "<i></i>" : ""}</div>
    <div class="dk-list">${rows.length ? rows.slice(0, LIVE_ROWS).join("") + (rows.length > LIVE_ROWS ? `<a class="dk-more" href="#/escritorio">${t("Mais {n} no Escritório", { n: rows.length - LIVE_ROWS })}</a>` : "")
      : `<p class="dk-quiet">${t("Nenhum agente a trabalhar agora. Clica num agente em cima e diz-lhe o que queres.")}</p>`}</div>`;
}

// O cabeçalho das tarefas: quantas há para hoje, as atrasadas e as de prioridade alta (antes eram a linha de números).
async function tasksHead() {
  const p = planOf(asOne(await api("/api/tasks")));
  const hot = p.open.filter((x) => x.priority === "urgent" || x.priority === "high").length;
  return `<header class="dk-h">${icon("calendar")}<b>${t("As tuas tarefas")}</b>
    <span class="dk-chips"><span>${t("{n} hoje", { n: p.today.length })}</span>${p.late.length ? `<span class="bad">${t("{n} atrasadas", { n: p.late.length })}</span>` : ""}${hot ? `<span class="warn">${t("{n} prioridade", { n: hot })}</span>` : ""}</span>
    <a href="#/tarefas">${t("Quadro")}${icon("chevron")}</a></header>`;
}

// A captura rápida: escreve e Enter cria a tarefa para ti; o ✦ (ou ⌘/Ctrl+Enter) manda-a ao teu agente, que a faz sozinho.
const quickHtml = () => `<form class="qk" id="qk" autocomplete="off">
    <span class="qk-ic">${icon("plus")}</span>
    <input id="qk-in" maxlength="200" placeholder="${esc(t("Nova tarefa… Enter guarda"))}" aria-label="${esc(t("Nova tarefa"))}">
    <button type="button" class="qk-ai" data-qk-ai title="${esc(t("Mandar ao teu agente (⌘ Enter)"))}">${icon("spark")}<span>${t("Agente")}</span></button>
  </form>`;
async function quickSend(ai) {
  const input = $("qk-in"), title = input?.value.trim();
  if (!title) return input?.focus();
  $("qk").classList.add("sending");
  try {
    await api("/api/tasks", { method: "POST", body: ai ? { title: shortTitle(title), description: title, assignee: me.username, for_ai: true, crew: "" } : { title, assignee: me.username } });
    input.value = "";
    flash(t(ai ? "O teu agente já a tem." : "Tarefa guardada."));
  } catch (err) { flash(err.message); }
  $("qk")?.classList.remove("sending");
  loadHome(["plan", "act"]);
}

// O Radar: o que lá fora pede atenção, cada coisa leva à página dela.
async function radarBody() {
  const [mail, vinted, etsy, cal] = await Promise.all([soft("/api/mail"), soft("/api/vinted"), soft("/api/etsy"), soft("/api/trading/calendar")]);
  const news = nextNews(cal), first = news[0], best = bestDeal(vinted);
  const porVer = mail ? (mail.threads || []).filter((x) => x.por_ver > 0).length : null;
  const soon = first && first.ts * 1000 - Date.now() < 3600e3;
  const head = first ? `<a class="rd-news ${soon ? "hot" : ""}" href="#/sinal">
      <span class="rd-k">${icon("trend")}${t("Próxima notícia vermelha")}</span>
      <b class="rd-cd" data-until="${first.ts}">${esc(untilOf(first.ts))}</b>
      <span class="rd-nt"><em>${esc(first.currency)}</em>${esc(first.title)} · ${esc(dayOf(first.ts))} ${hhmmOf(first.ts)}</span>
      ${news.slice(1, 3).map((n) => `<span class="rd-next"><em>${esc(n.currency)}</em><span>${esc(n.title)}</span><time>${esc(dayOf(n.ts))} ${hhmmOf(n.ts)}</time></span>`).join("")}</a>`
    : `<a class="rd-news" href="#/sinal"><span class="rd-k">${icon("trend")}${t("Notícias vermelhas")}</span><b class="rd-cd">—</b>
      <span class="rd-nt">${t(cal ? "Nenhuma esta semana" : "Calendário sem dados")}</span></a>`;
  const tile = (href, ic, label, big, sub, tone = "", img = "") => `<a class="rd-t ${tone}" href="${href}">${img}<span class="rd-k">${icon(ic)}${esc(t(label))}</span><b>${big}</b><span>${esc(sub)}</span></a>`;
  return `<header class="dk-h">${icon("search")}<b>${t("Radar")}</b></header>
    ${head}
    <div class="rd-tiles">
      ${best ? tile("#/vinted", "bag", "Vinted", `+${eur(best.lucro)}`, `${best.titulo} · ${eur(best.preco)}`, "ok", best.foto ? `<img src="${esc(best.foto)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : "")
        : tile("#/vinted", "bag", "Vinted", "—", t(vinted ? "Sem pechinchas hoje" : "Sem dados"))}
      ${tile("#/etsy", "layers", "Etsy", etsy ? eur(etsy.revenue || 0) : "—", etsy ? t("{n} por aprovar · {p} na loja", { n: etsy.counts?.new || 0, p: etsy.counts?.published ?? 0 }) : t("Sem dados"), etsy?.counts?.new ? "lit" : "")}
      ${tile("#/emails", "mail", "E-mails", porVer ?? "—", mail?.conta?.address ? t("por ver · {n} enviados hoje", { n: mail.conta.hoje || 0 }) : t("Gmail por ligar"), porVer ? "lit" : "")}
    </div>`;
}

// A semana: tarefas acabadas em cada um dos últimos 7 dias, uma cor por pessoa, e o placar de hoje.
async function weekBody() {
  const tasks = await api("/api/tasks");
  const done = tasks.filter((x) => x.stage === "done" && x.completed_at && !x.trashed_at);
  const who = (x) => x.completed_by || x.assignee || "";
  const days = Array.from({ length: 7 }, (_, i) => startOfDay(new Date(), i - 6));
  const people = [...new Set(done.filter((x) => new Date(x.completed_at) >= days[0]).map(who))].filter(Boolean);
  const grid = days.map((d, i) => {
    const end = days[i + 1] || startOfDay(new Date(), 1);
    const of = done.filter((x) => { const c = new Date(x.completed_at); return c >= d && c < end; });
    return { d, n: of.length, by: people.map((u) => [u, of.filter((x) => who(x) === u).length]) };
  });
  const top = Math.max(1, ...grid.map((x) => x.n)), total = grid.reduce((n, x) => n + x.n, 0), today = grid[6];
  return `<header class="dk-h">${icon("trend")}<b>${t("A semana")}</b><span class="dk-sub">${t("{n} tarefas acabadas", { n: total })}</span></header>
    <div class="wv">${grid.map((x, i) => `<div class="wv-d ${i === 6 ? "wv-now" : ""}" title="${esc(`${inDayLabel(x.d)}: ${x.n}`)}">
        <span class="wv-n">${x.n || ""}</span>
        <span class="wv-bar" style="height:${Math.round((x.n / top) * 100)}%">${x.by.filter(([, n]) => n).map(([u, n]) => `<i style="flex:${n};background:${tintOf(u)}"></i>`).join("")}</span>
        <small>${esc(i === 6 ? t("Hoje") : t(WEEKDAYS_SHORT[x.d.getDay()]))}</small></div>`).join("")}</div>
    <div class="wv-who">${people.length ? people.map((u) => { const n = today.by.find(([v]) => v === u)?.[1] || 0;
      return `<span><i style="background:${tintOf(u)}"></i>${esc(nameOf(u))}<b>${n}</b></span>`; }).join("") : `<span>${t("Ninguém acabou nada esta semana.")}</span>`}
      <small>${t("hoje")}</small></div>`;
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
  const fx = !done && !held && !mineDone && own && own.stage !== "done" && !doer
    ? `<button class="tfocus" data-fx-start="25" data-fx-id="${own.id}" data-fx-title="${esc(x.title)}" title="${t("Foco de 25 min")}">${icon("play")}</button>` : "";
  return `<div class="trow ${done ? "done" : ""} ${prio} ${doer ? "doing" : ""}">${check}<button class="ttitle" data-task="${(own || x).id}">${esc(x.title)}</button>
    <span class="twhen ${late}">${esc(when)}</span>${fx}${doer ? doingBadge(doer) : ""}${x.group ? `<span class="ttag all" title="${esc(whoLeft(x.group))}">${whoFaces(x.group)}<b>${x.group.filter((y) => y.stage === "done").length}/${x.group.length}</b></span>`
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
  if (await chatClick(e)) return;
  if (await newTaskClick(e)) return;
  if (await focusClick(e)) return;
  if (e.target.closest("[data-qk-ai]")) return quickSend(true);
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
    document.querySelectorAll("[data-until]").forEach((el) => { el.textContent = untilOf(Number(el.dataset.until)); });
    homeClock = setTimeout(next, 60000 - (Date.now() % 60000) + 20);
  };
  homeClock = setTimeout(next, 60000 - (Date.now() % 60000) + 20);
}

// A promise, as the live events expect of the loaders they call.
async function loadHome(parts = ["team", "news", "plan", "act", "biz"]) {
  if (!$("in-agents")) return;
  const jobs = [];
  if (["team", "ops"].some((x) => parts.includes(x))) jobs.push(mount($("in-agents"), agentsBody, 1).then(brainStart));
  if (parts.includes("news")) jobs.push(mount($("in-newsbar"), newsBar, 1));
  if (parts.includes("plan") || parts.includes("news")) jobs.push(mount($("in-alert"), alertBody, 2));
  if (parts.includes("plan") || parts.includes("biz")) jobs.push(mount($("in-pulse"), pulseBody, 1));
  if (parts.includes("plan")) jobs.push(mount($("in-tasks"), tasksBody, 5), mount($("in-thead"), tasksHead, 1), mount($("in-week"), weekBody, 1), mount($("in-cal"), calendarBody, 1));
  if (parts.includes("biz") || parts.includes("news")) jobs.push(mount($("in-radar"), radarBody, 1));
  if (parts.includes("plan") && !focusGet()) jobs.push(mount($("in-focus"), focusBody, 1));
  if (["act", "plan", "team", "ops"].some((x) => parts.includes(x))) jobs.push(mount($("in-live"), liveBody, 1));
  if (parts.includes("biz") || parts.includes("plan")) jobs.push(mount($("in-biz"), tipsBody, 1));
  if (chatUser && ["act", "plan", "team", "ops"].some((x) => parts.includes(x))) chatRefresh();
  await Promise.all(jobs);
}

// "A fazer agora" (the phone's Início, mobile.js): the "Parar" on your own card stops the task.
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
  // 13 nov, 4.ª volta (David: «isso é só colunas e quadrados... como se fosse uma empresa enorme de agentes»): um centro de
  // comando. Em cima a saudação, o foco, as notificações e a equipa; ao meio, grande, a caixa onde se pede trabalho ao
  // escritório, com sugestões e os números de hoje numa linha; por baixo, sem cartões, as operações ao vivo (todos os
  // agentes da equipa e o que está à espera de alguém) ao lado da tua fila de tarefas, cada uma com o seu ▶ de foco.
  // 6.ª volta: em cima a saudação; ao meio os agentes, cada um uma entidade com quem se fala (um clique abre a conversa ao lado);
  // os números numa linha; e em baixo duas faixas baixas de cartões: o que está a correr e as tuas tarefas de hoje.
  // 7.ª volta: os agentes com um cérebro de linhas; a linha de números sai (o Radar mostra o mesmo, com mais pormenor) e por
  // baixo fica um painel de três colunas que vai até ao fundo do ecrã: Ao vivo, As tuas tarefas, e Radar com A semana.
  chatClose(true);
  $("view").innerHTML = `<div class="page inicio v6 v7">${heroHtml(new Date(), ignite)}
    <section class="v6-agents"><div id="in-agents"></div></section>
    <div id="in-alert" class="in-alert"></div>
    <section class="dk">
      <div class="dk-p dk-live" id="in-live"></div>
      <div class="dk-p dk-tasks"><div id="in-thead"></div>${quickHtml()}<div class="dk-list" id="in-tasks"></div>
        <div class="dk-cal"><span class="rd-k">${icon("calendar")}${t("Próximos prazos")}</span><div id="in-cal"></div></div></div>
      <div class="dk-side"><div class="dk-p" id="in-radar"></div><div class="dk-p" id="in-week"></div></div>
    </section></div>`;
  $("view").onclick = homeClick;
  $("qk").onsubmit = (e) => { e.preventDefault(); quickSend(false); };
  $("qk-in").onkeydown = (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); quickSend(true); } };
  startHomeClock();
  loadHome().then(() => { if (focusGet()) mount($("in-focus"), focusBody, 1).then(focusRun); });
};

// A live event reloads only what shows that kind of thing ("tick" is the slow safety net: all of it).
onLive(["presence", "office", "session"], () => loadHome(["team", "ops"]));
onLive(["notification"], () => loadHome(["news"]));
onLive(["task"], () => loadHome(["plan", "act"]));
onLive(["activity", "ponto"], () => loadHome(["act"]));
onLive(["tick"], () => loadHome());
onLive(["vinted", "mail", "etsy"], () => loadHome(["biz"]));
