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
      <p class="hero-quote">“${esc(t(quoteOfDay()))}”</p>
    </div>
    <div class="hero-car" aria-hidden="true"><img src="assets/amg-front-1200.webp" srcset="assets/amg-front-1200.webp 1200w, assets/amg-front-2400.webp 2400w"
      sizes="(max-width: 700px) 100vw, (max-width: 1150px) 62vw, min(54vw, 860px)" alt="" decoding="async"></div>
  </header>`;
}

const cardHead = (ic, title, sub = "", link = "") => `<header class="ch">${icon(ic)}<div class="ch-t"><b>${esc(t(title))}</b>${sub ? `<span>${esc(sub)}</span>` : ""}</div>${link}</header>`;
const seeAll = (label, href) => `<a class="ch-link" href="${href}">${esc(t(label))}${icon("chevron")}</a>`;

const RING = { WORKING: "busy", ONLINE: "on", IDLE: "on", WAITING: "wait", PAUSED: "wait", ERROR: "bad", OFFLINE: "off" };
async function teamCard() {
  const team = await api("/api/team");
  const online = team.filter((m) => m.status !== "OFFLINE").length;
  return `${cardHead("users", "A tua equipa", `${online} ${t("de")} ${team.length} ${t("online")}`, seeAll("Ver", "#/equipa"))}
    <div class="mates">${team.map((m) => `<a class="mate ${RING[m.status] || "off"}" href="#/equipa">
      <span class="mate-av">${ui.avatar(m.display_name)}<i></i></span><b>${esc(m.display_name)}</b>
      <span class="mate-st">${esc(t((AGENT_ST[m.status] || [, m.status])[1]))}</span></a>`).join("")}</div>`;
}

/* ---------- notifications: the latest beside the team, the whole history one click away ---------- */
const NOTE_ICON = { task_new: "tasks", task: "check", approval_required: "alert", approval_decided: "check", agent_failed: "alert", agent_waiting: "clock" };
const noticeRow = (n) => `<button class="nrow ${n.read ? "" : "unread"}" data-n="${n.id}" data-href="${esc(n.href || "")}"><i></i>
  <span class="n-ic">${icon(NOTE_ICON[n.kind] || "bell")}</span>
  <span class="n-t"><b>${esc(n.title)}</b>${n.body ? `<span>${esc(n.body)}</span>` : ""}</span><time>${fmt.ago(n.created_at)}</time></button>`;

async function newsCard() {
  const inbox = await api("/api/notifications?limit=5");
  const badge = $("in-unread");
  if (badge) { badge.textContent = inbox.unread; badge.hidden = !inbox.unread; }
  return `${cardHead("bell", "Notificações", inbox.unread ? "" : t("Tudo lido"),
      `${inbox.unread ? `<span class="n-count">${inbox.unread} ${t("por ler")}</span>` : ""}
      <button class="ch-link" data-act="alerts">${t("Histórico")}${icon("chevron")}</button>`)}
    ${inbox.items.length ? `<div class="news">${inbox.items.map(noticeRow).join("")}</div>`
      : `<p class="in-empty">${t("Ainda não há notificações. Aparecem aqui as tarefas novas, as aprovações e o que precisa de ti.")}</p>`}`;
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

const TILES = [["task", "plus", "Tarefa", "Criar nova tarefa"], ["agenda", "calendar", "Calendário", "Ver prazos"],
  ["note", "note", "Notas", "Guardar ideias"], ["alerts", "bell", "Notificações", "Ver o histórico"]];
const tilesHtml = () => `<nav class="in-tiles">${TILES.map(([act, ic, title, sub]) => `<button class="in-tile" data-act="${act}">
  <span class="tile-ic"><span>${icon(ic)}</span></span>${act === "alerts" ? '<i class="badge-n" id="in-unread" hidden></i>' : ""}
  <span class="tile-t"><b>${esc(t(title))}</b><span>${esc(t(sub))}</span></span>${icon("chevron")}</button>`).join("")}</nav>`;

// For the figures, a task sent to everybody counts once: it is done when everybody has done it, until then it is still open.
function countOnce(tasks) {
  return groupAll(tasks.filter((x) => !x.trashed_at)).map((x) => {
    if (!x.group) return x;
    const left = x.group.filter((y) => y.stage !== "done");
    if (left.length) return { ...left.find((y) => y.stage === "in_progress") || left[0], group: x.group };
    const last = x.group.reduce((a, b) => (new Date(b.completed_at || 0) > new Date(a.completed_at || 0) ? b : a));
    return { ...last, group: x.group };
  });
}

async function progressBody() {
  const p = planOf(countOnce(await api("/api/tasks")));
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
    <div class="week-nums">${[[weekTotal, "Tarefas totais"], [weekDone, "Concluídas"], [p.inProgress, "Em curso"], [p.late.length, "Atrasadas"]]
      .map(([n, label]) => `<div><b>${n}</b><span>${t(label)}</span></div>`).join("")}</div>`;
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
  const check = done ? `<span class="tcheck">${icon("tick")}</span>`
    : held ? `<span class="tcheck held" title="${t("O agente está a tratar dela")}"></span>`
    : own ? `<button class="tcheck" data-done="${own.id}" title="${t("Concluir")}" aria-label="${t("Concluir")}"></button>`
    : `<button class="tcheck" data-task="${x.id}" title="${t("Abrir")}" aria-label="${t("Abrir")}"></button>`;
  const prio = !done && x.priority === "urgent" ? "urgent" : !done && x.priority === "high" ? "high" : "";
  return `<div class="trow ${done ? "done" : ""} ${prio}">${check}<button class="ttitle" data-task="${(own || x).id}">${esc(x.title)}</button>
    <span class="twhen ${late}">${esc(when)}</span><span class="ttag ${x.group ? "all" : ""}">${esc(x.group ? t("Todos") : tagOf(x))}</span></div>`;
}

// What is still to do fills the card, the most important first. What is already done today is one quiet line that opens on a click.
let showDone = false;
async function tasksBody() {
  const p = planOf(await api("/api/tasks"));
  const open = groupAll(p[tasksTab]).sort((a, b) => importance(a) - importance(b));
  const done = tasksTab === "today" ? groupAll(p.doneToday) : [];
  const more = open.length - MAX_ROWS;
  return `<div class="day-tabs" role="tablist">${DAY_TABS.map(([id, label]) =>
      `<button role="tab" data-tab="${id}" class="${id === tasksTab ? "on" : ""}" aria-selected="${id === tasksTab}">${t(label)}</button>`).join("")}</div>
    ${open.length ? `<div class="trows">${open.slice(0, MAX_ROWS).map((x) => taskRow(x, false)).join("")}</div>`
      : `<p class="in-empty">${t(done.length ? "Tudo feito por hoje." : DAY_EMPTY[tasksTab])}</p>`}
    ${more > 0 ? `<a class="in-more" href="#/tarefas">${t("Mais {n} no quadro", { n: more })}</a>` : ""}
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
  const [items, team] = await Promise.all([api("/api/history?limit=40"), api("/api/team")]);
  const online = new Set(team.filter((m) => m.status !== "OFFLINE").map((m) => m.user));
  const shown = items.filter((a) => !NOISE.includes(a.kind)).slice(0, 3);
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

// "Notas": an idea for the whole team, kept in the team's memory, where the Team AI reads it too.
function newNote() {
  formModal("Nova nota", field("Título", `<input name="title" required maxlength="200" placeholder="${t("A ideia, numa linha")}">`, true)
    + field("Nota", `<textarea name="content" placeholder="${t("Os pormenores (opcional)")}"></textarea>`, true)
    + `<p class="dim wide" style="margin:0">${t("Fica na Memória da equipa: todos a veem e a Team AI também a lê.")}</p>`,
  async (v) => {
    await api("/api/memory", { method: "POST", body: { scope: "team", category: "nota", title: v.title.trim(), content: v.content || "" } });
    flash(t("Nota guardada na Memória da equipa."));
  }, { submit: "Guardar nota" });
}

async function homeClick(e) {
  const act = e.target.closest("[data-act]")?.dataset.act;
  if (act === "task") return newTask();
  if (act === "agenda") return openAgenda();
  if (act === "note") return newNote();
  if (act === "alerts") return openNotices();
  const notice = e.target.closest("[data-n]");
  if (notice) return openNotice(notice);
  const tab = e.target.closest("[data-tab]");
  if (tab) { tasksTab = tab.dataset.tab; return mount($("in-tasks"), tasksBody, 4); }
  if (e.target.closest("[data-show-done]")) { showDone = !showDone; return mount($("in-tasks"), tasksBody, 4); }
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
async function loadHome(parts = ["team", "news", "plan", "act"]) {
  if (!$("in-team")) return;
  const jobs = [];
  if (parts.includes("team")) jobs.push(mount($("in-team"), teamCard, 3));
  if (parts.includes("news")) jobs.push(mount($("in-news"), newsCard, 3));
  if (parts.includes("plan")) jobs.push(mount($("in-prog"), progressBody, 5), mount($("in-tasks"), tasksBody, 5), mount($("in-cal"), calendarBody, 3));
  if (parts.includes("act")) jobs.push(mount($("in-act"), activityBody, 3));
  await Promise.all(jobs);
}

HUB_VIEWS.home = async function viewHome() {
  let ignite = false; // the car comes out of the dark once per session; after that it is simply there
  try { ignite = !sessionStorage.getItem("hub.lights"); sessionStorage.setItem("hub.lights", "1"); } catch { /* private window: no start-up */ }
  $("view").innerHTML = `<div class="page inicio">${heroHtml(new Date(), ignite)}
    <div class="in-top"><section class="in-card" id="in-team"></section><section class="in-card" id="in-news"></section></div>
    ${tilesHtml()}
    <div class="in-grid">
      <section class="in-card in-prog">${cardHead("target", "Progresso da equipa", "", seeAll("Visão geral", "#/analise"))}<div id="in-prog"></div></section>
      <section class="in-card in-tasks">${cardHead("tasks", "Tarefas", "", seeAll("Ver todas", "#/tarefas"))}<div id="in-tasks"></div></section>
      <section class="in-card in-cal">${cardHead("calendar", "Calendário", t("Próximos prazos"),
        `<button class="ch-link" data-act="agenda">${t("Ver tudo")}${icon("chevron")}</button>`)}<div id="in-cal"></div></section>
      <div class="in-side">
        <section class="in-card">${cardHead("bolt", "Atividade recente", "", seeAll("Ver todas", "#/aovivo"))}<div id="in-act"></div></section>
        ${quoteCard()}
      </div>
    </div></div>`;
  $("view").onclick = homeClick;
  startHomeClock();
  loadHome();
};

// A live event reloads only what shows that kind of thing ("tick" is the slow safety net: all of it).
onLive(["presence"], () => loadHome(["team", "act"]));
onLive(["notification"], () => loadHome(["news"]));
onLive(["task"], () => loadHome(["plan", "act"]));
onLive(["activity", "ponto"], () => loadHome(["act"]));
onLive(["tick"], () => loadHome());
