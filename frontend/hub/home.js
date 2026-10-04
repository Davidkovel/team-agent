// Início: the command center at a glance, as in the team's mockup: the greeting beside the front of the car, the team, four
// shortcuts, today's progress, the tasks by day, the coming deadlines, what just happened, and a thought for the day.
// Every figure is the Hub's own record; where there is nothing, an honest empty state, never a made-up number.
//
// Light on the processor, because the Hub also runs inside the widget: the car is two still pictures drawn once (the car,
// and its light on top; scripts/make_mercedes.py), the only motion is that light coming on once per session (opacity, done
// by the graphics card), the clock changes once a minute, and nothing is blurred behind the cards (on a still background a
// translucent card looks the same and costs nothing). The look is in hub/home.css.

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

// The tag beside a task: its project or company, else whose it is. The colour follows the name, so it is always the same.
const TAG_TONES = ["blue", "green", "amber", "violet", "teal"];
function tagOf(x) {
  const label = x.project_name || companies.find((c) => c.id === x.company)?.name || nameOf(x.assignee);
  let h = 0;
  for (const ch of label) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return [label, TAG_TONES[h % TAG_TONES.length]];
}

/* ---------- the blocks ---------- */
const greetingOf = (hour) => (hour < 6 ? "Boa noite" : hour < 13 ? "Bom dia" : hour < 20 ? "Boa tarde" : "Boa noite");

function heroHtml(now, ignite) {
  const night = now.getHours() >= 20 || now.getHours() < 7;
  const date = now.toLocaleDateString("pt-PT", { weekday: "long", day: "numeric", month: "long" });
  return `<header class="in-hero ${ignite ? "ignite" : ""}">
    <div class="hero-copy">
      <span class="hero-sky ${night ? "moon" : "sun"}">${icon(night ? "moon" : "sun")}</span>
      <h1>${esc(t(greetingOf(now.getHours())))}, ${esc(me.display_name)}</h1>
      <p class="hero-date">${esc(date[0].toUpperCase() + date.slice(1))}<i>·</i><time id="in-clock">${fmt.hhmm(now.toISOString())}</time></p>
    </div>
    <div class="hero-car" aria-hidden="true"><img src="assets/mercedes-front.svg" alt="" decoding="async"><img class="lights" src="assets/mercedes-lights.svg" alt="" decoding="async"></div>
    <blockquote class="hero-quote">“${esc(t(quoteOfDay()))}”</blockquote>
  </header>`;
}

const cardHead = (ic, tone, title, sub, link = "") => `<header class="ch"><span class="ch-ic ${tone}">${icon(ic)}</span>
  <div class="ch-t"><b>${esc(t(title))}</b>${sub ? `<span>${esc(sub)}</span>` : ""}</div>${link}</header>`;
const seeAll = (label, href) => `<a class="ch-link" href="${href}">${esc(t(label))}${icon("chevron")}</a>`;

const RING = { WORKING: "busy", ONLINE: "on", IDLE: "on", WAITING: "wait", PAUSED: "wait", ERROR: "bad", OFFLINE: "off" };
async function teamCard() {
  const team = await api("/api/team");
  const online = team.filter((m) => m.status !== "OFFLINE").length;
  return `${cardHead("users", "blue", "A tua equipa", `${team.length} ${t("membros")} · ${online} ${t("online")}`,
    `<a class="ch-link pill" href="#/equipa">${t("Ver equipa")}${icon("chevron")}</a>`)}
    <div class="crew" style="--n:${team.length || 1}">${team.map((m) => {
      const tone = RING[m.status] || "off";
      return `<a class="mate" href="#/equipa"><span class="mate-ring ${tone}">${ui.avatar(m.display_name, "xl")}<i></i></span>
        <b>${esc(m.display_name)}</b><span class="mate-st ${tone}"><i></i>${esc(t((AGENT_ST[m.status] || [, m.status])[1]))}</span></a>`;
    }).join("")}</div>`;
}

const TILES = [["task", "plus", "blue", "Tarefa", "Criar nova tarefa"], ["agenda", "calendar", "green", "Calendário", "Ver prazos"],
  ["note", "note", "violet", "Notas", "Guardar ideias"], ["team", "users", "amber", "Equipa", "Ver membros"]];
const tilesHtml = () => `<nav class="in-tiles">${TILES.map(([act, ic, tone, title, sub]) => `<button class="in-tile ${tone}" data-act="${act}">
  <span class="tile-ic">${icon(ic)}</span><span class="tile-t"><b>${esc(t(title))}</b><span>${esc(t(sub))}</span></span>${icon("chevron")}</button>`).join("")}</nav>`;

async function progressBody() {
  const p = planOf(await api("/api/tasks"));
  const doneN = p.doneToday.length, total = doneN + p.today.length;
  const weekDone = p.doneWeek.length, weekTotal = weekDone + p.open.length;
  const pct = weekTotal ? Math.round((weekDone / weekTotal) * 100) : 0;
  const c = 2 * Math.PI * 52, off = total ? c * (1 - doneN / total) : c;
  return `<div class="prog">
      <div class="ring" style="--c:${c.toFixed(1)};--off:${off.toFixed(1)}"><svg viewBox="0 0 120 120" aria-hidden="true">
        <circle class="ring-track" cx="60" cy="60" r="52"/><circle class="ring-val" cx="60" cy="60" r="52"/></svg>
        <div><b>${doneN}<small>/${total}</small></b><span>${t("Tarefas hoje")}</span></div></div>
      <ul class="legend"><li><i class="ok"></i>${t("Concluídas")}<b>${doneN}</b></li>
        <li><i class="warn"></i>${t("Pendentes")}<b>${p.today.length - p.late.length}</b></li>
        <li><i class="bad"></i>${t("Atrasadas")}<b>${p.late.length}</b></li></ul></div>
    <div class="week"><span class="week-ic">${icon("trend")}</span><div><b>${t("Progresso do grupo")}</b><span>${t("Esta semana")}</span></div></div>
    <div class="week-bar"><div class="in-bar"><i style="width:${pct}%"></i></div><b>${weekTotal ? `${pct}%` : "—"}</b></div>
    <div class="week-nums">${[[weekTotal, "Tarefas totais"], [weekDone, "Concluídas"], [p.inProgress, "Em curso"], [p.late.length, "Atrasadas"]]
      .map(([n, label]) => `<div><b>${n}</b><span>${t(label)}</span></div>`).join("")}</div>`;
}

let tasksTab = "today";
const DAY_TABS = [["today", "Hoje"], ["tomorrow", "Amanhã"], ["week", "Esta semana"]];
const DAY_EMPTY = { today: "Nada para hoje. Cria uma tarefa, ou dá um prazo a uma.", tomorrow: "Nada com prazo para amanhã.",
  week: "Nada com prazo para esta semana." };
const MAX_ROWS = 6;

function taskRow(x, done) {
  const [when, late] = done ? [fmt.hhmm(x.completed_at), ""] : whenOf(x, tasksTab);
  const [tag, tone] = tagOf(x), held = !done && heldByAgent(x);
  const check = done ? `<span class="tcheck">${icon("tick")}</span>`
    : held ? `<span class="tcheck held" title="${t("O agente está a tratar dela")}"></span>`
    : `<button class="tcheck" data-done="${x.id}" title="${t("Concluir")}" aria-label="${t("Concluir")}"></button>`;
  return `<div class="trow ${done ? "done" : ""}">${check}<button class="ttitle" data-task="${x.id}">${esc(x.title)}</button>
    <span class="twhen ${late}">${esc(when)}</span><span class="ttag ${tone}">${esc(tag)}</span></div>`;
}

async function tasksBody() {
  const p = planOf(await api("/api/tasks"));
  const rows = [...p[tasksTab].map((x) => [x, false]), ...(tasksTab === "today" ? p.doneToday.map((x) => [x, true]) : [])];
  const more = rows.length - MAX_ROWS;
  return `<div class="day-tabs" role="tablist">${DAY_TABS.map(([id, label]) =>
      `<button role="tab" data-tab="${id}" class="${id === tasksTab ? "on" : ""}" aria-selected="${id === tasksTab}">${t(label)}</button>`).join("")}</div>
    ${rows.length ? `<div class="trows">${rows.slice(0, MAX_ROWS).map(([x, done]) => taskRow(x, done)).join("")}</div>`
      : `<p class="in-empty">${t(DAY_EMPTY[tasksTab])}</p>`}
    ${more > 0 ? `<a class="in-more" href="#/tarefas">${t("Mais {n} no quadro", { n: more })}</a>` : ""}`;
}

function calRow(x) {
  const d = new Date(x.deadline);
  return `<button class="crow" data-task="${x.id}"><span class="cdate"><b>${esc(inDayLabel(d))}</b><span>${dayNum(d)}</span></span>
    <span class="ctitle">${esc(x.title)}</span><span class="ctime">${fmt.hhmm(x.deadline)}</span>${icon("chevron")}</button>`;
}
const noDeadlines = () => `<div class="in-none">${icon("calendar")}<div><b>${t("Sem prazos marcados")}</b>
  <span>${t("Dá um prazo a uma tarefa e ela aparece aqui.")}</span></div><button class="in-btn" data-act="task">${t("Nova tarefa")}</button></div>`;

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
    return `<div class="arow"><span class="arow-av">${ui.avatar(a.name, "lg")}${online.has(a.user) ? "<i></i>" : ""}</span>
      <div class="arow-t"><b>${esc(what)}</b>${detail ? `<span>${esc(detail)}</span>` : ""}</div><time>${fmt.ago(a.created_at)}</time></div>`;
  }).join("")}</div>`;
}

const quoteCard = () => `<figure class="in-quote"><blockquote>“${esc(t(quoteOfDay(3)))}”</blockquote>
  <figcaption>${icon("crown")}${t("Centro de comando")}</figcaption></figure>`;

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
  if (act === "team") { location.hash = "#/equipa"; return; }
  const tab = e.target.closest("[data-tab]");
  if (tab) { tasksTab = tab.dataset.tab; return mount($("in-tasks"), tasksBody, 4); }
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
async function loadHome(parts = ["team", "plan", "act"]) {
  if (!$("in-team")) return;
  const jobs = [];
  if (parts.includes("team")) jobs.push(mount($("in-team"), teamCard, 3));
  if (parts.includes("plan")) jobs.push(mount($("in-prog"), progressBody, 5), mount($("in-tasks"), tasksBody, 5), mount($("in-cal"), calendarBody, 3));
  if (parts.includes("act")) jobs.push(mount($("in-act"), activityBody, 3));
  await Promise.all(jobs);
}

HUB_VIEWS.home = async function viewHome() {
  let ignite = false; // the lights come on once per session; after that they are simply on
  try { ignite = !sessionStorage.getItem("hub.lights"); sessionStorage.setItem("hub.lights", "1"); } catch { /* private window: lights on */ }
  $("view").innerHTML = `<div class="page inicio">${heroHtml(new Date(), ignite)}
    <section class="in-card crew-card" id="in-team"></section>
    ${tilesHtml()}
    <div class="in-grid">
      <section class="in-card in-prog">${cardHead("target", "blue", "Progresso da equipa", "", seeAll("Visão geral", "#/analise"))}<div id="in-prog"></div></section>
      <section class="in-card in-tasks">${cardHead("tasks", "blue", "Tarefas", "", seeAll("Ver todas", "#/tarefas"))}<div id="in-tasks"></div></section>
      <section class="in-card in-cal">${cardHead("calendar", "green", "Calendário", t("Próximos prazos"),
        `<button class="ch-link" data-act="agenda">${t("Ver calendário")}${icon("chevron")}</button>`)}<div id="in-cal"></div></section>
      <div class="in-side">
        <section class="in-card">${cardHead("bolt", "blue", "Atividade recente", "", seeAll("Ver todas", "#/aovivo"))}<div id="in-act"></div></section>
        ${quoteCard()}
      </div>
    </div></div>`;
  $("view").onclick = homeClick;
  startHomeClock();
  loadHome();
};

// A live event reloads only what shows that kind of thing ("tick" is the slow safety net: all of it).
onLive(["presence"], () => loadHome(["team", "act"]));
onLive(["task"], () => loadHome(["plan", "act"]));
onLive(["activity", "ponto"], () => loadHome(["act"]));
onLive(["tick"], () => loadHome());
