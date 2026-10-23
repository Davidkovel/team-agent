// Início: the central of the working day. Redone on 23 Oct 2026 (Marco: «o início está completamente as mesmas merdas,
// inventa, dá-lhe algo completamente diferente... um dashboard do trabalho»). The big greeting, the quote and four counters
// that were nearly always zero are gone. What is here, in the order it is used:
//   - Mandar uma tarefa: write and press Enter. For whom (the office, me, a teammate), which department, for when, urgent;
//     «Mais opções» opens the full composer (newTask in pages.js) with what was chosen here.
//   - Agora mesmo: what the departments are doing this minute (the same jobs and the same choice of department as the
//     Escritório, crew.js jobsOf/routeOf), each with its monogram (DEV, PES...), the goal and for whom.
//   - À tua espera: approvals, Claude windows waiting for an answer, unread messages and notices.
//   - O teu dia: your tasks (late, today, the next days) as an iOS list; an empty day proposes something to do.
//   - Hoje: a few real figures of the day; Equipa: the three partners, small; Atividade: who did what, person or department.
// The same page is the phone's Início (mobile.js hands it over): the phone layout is in home.css under html.is-phone.
// Light: no animation that is not something happening, the clock changes once a minute, and the data is read only while
// the page is open (the live events below reload only the parts that show that kind of thing).
// All of it lives inside one function, so none of its names can clash with another file's (the scripts share one scope).
(function () {

/* ---------- the departments (docs: BRIEF 23 out; crew.py keeps the internal ids) ---------- */
const IN_DEPTS = [
  ["batman", "DEV", "Desenvolvimento"], ["lucius", "ENG", "Engenharia"], ["riddler", "PES", "Pesquisa"], ["catwoman", "DSG", "Design"],
  ["joker", "MKT", "Marketing"], ["alfred", "REV", "Revisão"], ["robin", "QA", "Testes"], ["gordon", "OPS", "Operações"],
  ["penguin", "MAC", "Macro"], ["twoface", "TEC", "Análise técnica"]];
const deptOf = (id) => { const d = IN_DEPTS.find(([x]) => x === id) || IN_DEPTS[7]; return { id: d[0], code: d[1], name: t(d[2]) }; };
const monoHtml = (id, state = "", size = "") => { const d = deptOf(id); return `<span class="in-mono ${state} ${size}" title="${esc(d.name)}">${d.code}</span>`; };

// Who takes a job: the same rule as the Escritório (crew.js sectorOf/routeOf, backend crew.py): asked by name, the kind of
// subagent, the words of the request, the role, else Operations; busy, the most alike free colleague.
const inWord = (s) => new RegExp(`(?<![\\p{L}\\d])(${s})(?![\\p{L}\\d])`, "iu");
const IN_WORDS = [
  ["twoface", inWord("sweep\\p{L}*|liquidez|fvg|order block\\p{L}*|bos|choch|smc|price action|an[áa]lise t[ée]cnica|gr[áa]fico\\p{L}* de velas")],
  ["penguin", inWord("trading|trade\\p{L}*|trader\\p{L}*|forex|xauusd|eurusd|gbpusd|ger40|dax|nas100|nasdaq|us30|bolsa|a[çc][õo]es|cripto\\p{L}*|bitcoin|calend[áa]rio econ[óo]mico|not[íi]cias do mercado")],
  ["catwoman", inWord("design\\p{L}*|página\\p{L}*|pagina\\p{L}*|cor|cores|layout|ecrã\\p{L}*|visual|ícone\\p{L}*|logo\\p{L}*|estilo\\p{L}*|css|bonit\\p{L}*|interface\\p{L}*|aba|abas|bot[ãa]o|bot[õo]es")],
  ["riddler", inWord("pesquis\\p{L}*|preço\\p{L}*|preco\\p{L}*|procur\\p{L}*|concorr\\p{L}*|fornecedor\\p{L}*")],
  ["robin", inWord("test\\p{L}*")],
  ["alfred", inWord("rever|revê|revisão|revisao|revis[ae]\\p{L}*|review")],
  ["joker", inWord("anúncio\\p{L}*|anuncio\\p{L}*|posts?|campanha\\p{L}*|instagram|tiktok|marketing|legenda\\p{L}*")],
  ["batman", inWord("erro\\p{L}*|bug\\p{L}*|código|codigo|corrig\\p{L}*|implement\\p{L}*|script\\p{L}*|automatiz\\p{L}*|backend|api")],
  ["lucius", inWord("onde está|onde esta|onde fica|explic\\p{L}*|como funciona")],
];
const IN_ROLE = { developer: "batman", research: "riddler", marketing: "joker", testing: "robin" };
const IN_KIND = { "general-purpose": "batman", explorador: "lucius", Explore: "lucius", pesquisador: "riddler", "claude-code-guide": "riddler",
  "designer-hub": "catwoman", marketing: "joker", "revisor-hub": "alfred", Plan: "gordon" };
const IN_NEAR = { batman: ["lucius", "robin", "alfred"], lucius: ["batman", "riddler", "alfred"], riddler: ["lucius", "joker", "gordon"],
  catwoman: ["joker", "batman", "robin"], joker: ["catwoman", "riddler", "gordon"], alfred: ["robin", "lucius", "batman"],
  robin: ["alfred", "batman", "lucius"], gordon: ["alfred", "lucius", "riddler"], penguin: ["twoface", "riddler", "gordon"], twoface: ["penguin", "lucius", "batman"] };
const sectorOfJob = (j) => (j.crew && IN_NEAR[j.crew] ? j.crew : IN_KIND[j.kind] || (IN_WORDS.find(([, re]) => re.test(`${j.title || ""} ${j.description || ""}`)) || [])[0] || IN_ROLE[j.role] || "gordon");

// What Claude Code told a window by itself is not what the person asked (crew.js cleanPrompt)
function cleanAsk(text) {
  const raw = String(text || ""), summary = raw.match(/<summary>([\s\S]*?)(<\/summary>|$)/);
  if (summary && summary[1].trim()) return summary[1].trim();
  if (/^\s*</.test(raw)) return "";
  const said = raw.replace(/<[^>]*>?/g, " ").replace(/[A-Z]:\\[^\s]+|\/[\w./-]{12,}/g, " ").replace(/(?<![\w])(?=\w*\d)\w{10,}(?![\w])/g, " ").replace(/\s+/g, " ").trim();
  return /^\((aviso|mensagem de outra)/.test(said) || /^https?:/.test(said) ? "" : said;
}

const TASK_JOB = { IN_PROGRESS: "work", WAITING_APPROVAL: "wait", NEEDS_HELP: "help", PAUSED: "pause" };
const STILL_WAITING = 20 * 60e3;
// The jobs of the office this minute, each with its department (the Escritório's jobsOf + routeOf, without the cave)
function officeJobs(tasks, office) {
  const now = Date.now(), jobs = [];
  for (const x of tasks) {
    const state = !x.trashed_at && TASK_JOB[x.status];
    if (state) jobs.push({ key: "t" + x.id, type: "task", state, crew: x.crew || "", role: x.agent_role || "", title: x.title, description: x.description || "",
      goal: x.title, who: x.assignee, action: x.current_action || "", since: x.started_at || x.created_at, project: x.project_name || "", href: `#/tarefas/${x.id}` });
  }
  for (const s of office.sessions || []) {
    if (s.state === "working" || (s.state === "waiting" && now - Date.parse(s.since) < STILL_WAITING)) {
      const asked = cleanAsk(s.prompt);
      jobs.push({ key: "c" + s.id, type: "claude", state: s.state === "working" ? "work" : "wait", title: asked, description: s.request || "",
        goal: cleanAsk(s.topic) || s.title || asked || t("Claude a trabalhar em {p}", { p: s.project }), whoName: s.name, wait: s.wait,
        action: s.state === "working" ? s.action || "" : "", since: s.since, project: s.project, href: "#/escritorio" });
    }
    for (const ag of s.agents || []) if (ag.state === "working") {
      jobs.push({ key: "a" + ag.id, parent: "c" + s.id, type: "sub", kind: ag.kind, state: "work", title: ag.description || ag.kind, goal: ag.description || ag.kind,
        whoName: s.name, action: ag.action || "", since: ag.started_at, project: s.project, href: "#/escritorio" });
    }
  }
  const rank = { work: 0, help: 1, wait: 2, pause: 3 };
  jobs.sort((p, q) => (q.type === "task" && q.crew ? 1 : 0) - (p.type === "task" && p.crew ? 1 : 0) || rank[p.state] - rank[q.state] || String(q.since).localeCompare(String(p.since)));
  const busy = new Set();
  for (const j of jobs) {
    const home = sectorOfJob(j);
    j.home = home;
    j.dept = j.crew ? (busy.has(j.crew) ? "" : j.crew) : [home, ...IN_NEAR[home]].find((id) => !busy.has(id)) || IN_DEPTS.map(([id]) => id).find((id) => !busy.has(id)) || "";
    if (j.dept) busy.add(j.dept);
  }
  // shown with each subagent right after its window (the departments were given in the Escritório's order, above)
  for (const j of jobs.filter((x) => x.parent)) {
    if (!jobs.some((x) => x.key === j.parent)) continue;
    jobs.splice(jobs.indexOf(j), 1);
    jobs.splice(jobs.findIndex((x) => x.key === j.parent) + 1, 0, j);
  }
  return { jobs, busy };
}

/* ---------- the day: which tasks are late, today's, the next days' ---------- */
const startOfDay = (d, add = 0) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() + add); return x; };
const MONTHS_SHORT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const WEEKDAYS_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const dayNum = (d) => `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
function inDayLabel(d, now = new Date()) {
  const diff = Math.round((startOfDay(d) - startOfDay(now)) / 864e5);
  return diff === 0 ? t("Hoje") : diff === 1 ? t("Amanhã") : t(WEEKDAYS_SHORT[d.getDay()]);
}
// [what to show for the deadline, "late" when it has passed]
function whenOf(x, now = new Date()) {
  if (!x.deadline) return ["", ""];
  const d = new Date(x.deadline), hhmm = fmt.hhmm(x.deadline);
  if (d < startOfDay(now)) return [dayNum(d), "late"];
  if (d < startOfDay(now, 1)) return [`${t("Hoje")} ${hhmm}`, d < now ? "late" : ""];
  return [`${inDayLabel(d, now)} ${hhmm}`, ""];
}
const plainOf = (text) => String(text || "").replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`#>]+/g, "").replace(/\s+/g, " ").trim();
const greetingOf = (hour) => (hour < 6 ? "Boa noite" : hour < 13 ? "Bom dia" : hour < 20 ? "Boa tarde" : "Boa noite");
const sameDay = (iso, day = startOfDay(new Date())) => iso && new Date(iso) >= day;

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
  return out.sort((a, b) => importance(a.x) - importance(b.x));   // urgent first; the newest first among equals
}
const ntShown = new Set(); // it slides in once, not again at every refresh
function newTaskCard(fresh) {
  if (!fresh.length) return "";
  const [{ x, n }, ...more] = fresh, from = x.created_by || "", everybody = /a todos:/.test(n.title);
  const enter = !ntShown.has(x.id), body = plainOf(x.description);
  ntShown.add(x.id);
  const [when, late] = whenOf(x);
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
async function freshBody() {
  const [tasks, inbox] = await Promise.all([api("/api/tasks"), api("/api/notifications?limit=100")]);
  return newTaskCard(newTasksOf(tasks, inbox));
}

/* ---------- Mandar uma tarefa: write, Enter, done ---------- */
const SEND_KEY = "hub.inicio.send";
const sendState = (() => {
  let kept = {};
  try { kept = JSON.parse(localStorage.getItem(SEND_KEY) || "{}") || {}; } catch { /* private window: the defaults */ }
  return { to: kept.to || "office", crew: "", due: "", urgent: false, pick: false };   // the department is chosen per task, never kept
})();
const keepSend = () => { try { localStorage.setItem(SEND_KEY, JSON.stringify({ to: sendState.to })); } catch { /* not kept */ } };
let sendUsers = [];

function sendHtml() {
  return `<form class="in-send" id="in-send" autocomplete="off">
    <label class="in-send-field">${icon("plus")}<input id="in-send-t" name="title" maxlength="200" placeholder="${esc(t(document.documentElement.classList.contains("is-phone") ? "O que é preciso fazer?" : "Escreve uma tarefa e carrega Enter"))}" aria-label="${esc(t("Nova tarefa"))}">
      <button class="btn primary in-send-go" type="submit">${t("Mandar")}${icon("arrow")}</button></label>
    <div class="in-send-opts" id="in-send-opts"></div>
    <div class="in-send-route" id="in-send-route" aria-live="polite"></div>
  </form>`;
}
function sendOptsHtml() {
  const s = sendState;
  const people = [["office", t("Escritório"), "bot"], [me.username, t("Eu"), ""], ...sendUsers.filter((u) => u.username !== me.username).map((u) => [u.username, u.display_name, ""])];
  const seg = (name, list, on) => `<div class="in-seg" role="radiogroup">${list.map(([v, label, ic]) =>
    `<button type="button" role="radio" aria-checked="${v === on}" data-${name}="${esc(v)}" class="${v === on ? "on" : ""}">${ic ? icon(ic) : ""}${esc(label)}</button>`).join("")}</div>`;
  return `<span class="in-opt-l">${t("Para")}</span>${seg("to", people, s.to)}
    <span class="in-opt-l">${t("Prazo")}</span>${seg("due", [["", t("Sem prazo")], ["hoje", t("Hoje")], ["amanha", t("Amanhã")]], s.due)}
    <button type="button" class="in-tog ${s.urgent ? "on" : ""}" data-urgent aria-pressed="${s.urgent}">${icon("flag")}${t("Urgente")}</button>
    <button type="button" class="in-more-opts" data-more-opts>${icon("sliders")}${t("Mais opções")}</button>`;
}
// Under the bar, for the office: who takes it (the Hub answers while it is written, /api/tasks/route) and the departments
let routeTurn = 0, routeTimer = 0, routeSaid = null;
function routeHtml() {
  const s = sendState;
  if (s.to !== "office") return `<p class="in-route-line">${icon("users")}<span>${s.to === me.username ? t("Fica contigo, em «Por fazer».") : t("Vai para {n}, em «Por fazer».", { n: nameOf(s.to) })}</span></p>`;
  const r = routeSaid, chosen = s.crew ? deptOf(s.crew) : null;
  const who = chosen || (r ? deptOf(r.crew) : null);
  const line = who ? `${monoHtml(who.id, "on", "sm")}<span>${t("Vai para")} <b>${esc(who.name)}</b>${r && r.for ? ` · ${esc(r.ahead ? t(r.ahead === 1 ? "1 tarefa à frente" : "{n} tarefas à frente", { n: r.ahead }) : t("nada à frente"))}` : ""}${chosen ? "" : ` · ${t("escolhido pelo escritório")}`}</span>`
    : `${icon("bot")}<span>${t("O escritório escolhe pelo que escreveres.")}</span>`;
  return `<p class="in-route-line">${line}<button type="button" class="in-route-pick" data-pick aria-expanded="${s.pick}">${t(s.pick ? "Fechar" : "Escolher departamento")}</button></p>
    ${s.pick ? `<div class="in-depts" role="radiogroup" aria-label="${esc(t("Departamento"))}"><button type="button" role="radio" aria-checked="${!s.crew}" class="in-dept ${!s.crew ? "on" : ""}" data-crew="">${icon("bolt")}<b>${t("Automático")}</b></button>
      ${IN_DEPTS.map(([id, code, name]) => `<button type="button" role="radio" aria-checked="${s.crew === id}" class="in-dept ${s.crew === id ? "on" : ""}" data-crew="${id}"><i>${code}</i><b>${esc(t(name))}</b></button>`).join("")}</div>` : ""}`;
}
function paintSend() {
  paint($("in-send-opts"), sendOptsHtml());
  paint($("in-send-route"), routeHtml());
}
function askRoute(now = false) {
  clearTimeout(routeTimer);
  routeTimer = setTimeout(async () => {
    const my = ++routeTurn, title = $("in-send-t")?.value.trim() || "";
    if (sendState.to !== "office" || (!title && !sendState.crew)) { routeSaid = null; return paintSend(); }
    try { const r = await api("/api/tasks/route", { method: "POST", body: { title, description: "", crew: sendState.crew, assignee: me.username } }); if (my === routeTurn) { routeSaid = r; paintSend(); } }
    catch { if (my === routeTurn) { routeSaid = null; paintSend(); } }
  }, now ? 0 : 260);
}
const dueIso = (pick) => { if (!pick) return null; const d = startOfDay(new Date(), pick === "amanha" ? 1 : 0); d.setHours(18); return d.toISOString(); };
async function sendTask(form) {
  const input = form.elements.title, title = input.value.trim(), go = form.querySelector(".in-send-go");
  if (!title) { input.focus(); form.classList.add("shake"); setTimeout(() => form.classList.remove("shake"), 400); return; }
  const s = sendState, office = s.to === "office";
  go.disabled = true;
  try {
    const made = await api("/api/tasks", { method: "POST", body: { title, description: "", assignee: office ? me.username : s.to, priority: s.urgent ? "urgent" : "normal",
      deadline: dueIso(s.due), for_ai: office, crew: office ? s.crew : "" } });
    flash(office ? t("Mandada para o escritório: {n}.", { n: made.crew_name || deptOf(made.crew).name }) : s.to === me.username ? t("Tarefa criada para ti.") : t("Tarefa mandada a {n}.", { n: nameOf(s.to) }));
    input.value = ""; s.urgent = false; s.due = ""; routeSaid = null;
    keepSend(); paintSend();
    loadHome(["tasks", "office"]);
  } catch (err) { flash(err.message); }
  go.disabled = false;
  input.focus();
}
function sendPreset() {
  const s = sendState, office = s.to === "office";
  return { title: $("in-send-t")?.value.trim() || "", for_ai: office, crew: office ? s.crew : "", assignee: office ? "" : s.to, priority: s.urgent ? "urgent" : "normal",
    due: s.due || "", deadline: dueIso(s.due) };
}
function sendClick(e) {
  const s = sendState, b = e.target.closest("button");
  if (!b || !b.closest("#in-send")) return false;
  if (b.dataset.to !== undefined) { s.to = b.dataset.to; s.pick = false; keepSend(); paintSend(); askRoute(true); }
  else if (b.dataset.due !== undefined) { s.due = b.dataset.due; paintSend(); }
  else if (b.hasAttribute("data-urgent")) { s.urgent = !s.urgent; paintSend(); }
  else if (b.hasAttribute("data-pick")) { s.pick = !s.pick; paintSend(); }
  else if (b.dataset.crew !== undefined) { s.crew = b.dataset.crew; s.pick = false; keepSend(); paintSend(); askRoute(true); }
  else if (b.hasAttribute("data-more-opts")) newTask(sendPreset());
  else return false;
  return true;
}
const focusSend = () => { const el = $("in-send-t"); if (el) { el.scrollIntoView({ block: "center", behavior: "smooth" }); el.focus({ preventScroll: true }); } };

/* ---------- Agora mesmo: the office this minute ---------- */
const JOB_STATE = { work: ["on", "A trabalhar"], wait: ["wait", "À espera"], help: ["bad", "Precisa de ajuda"], pause: ["off", "Em pausa"] };
async function nowBody() {
  const [tasks, office] = await Promise.all([api("/api/tasks"), api("/api/office").catch(() => ({ sessions: [] }))]);
  const { jobs, busy } = officeJobs(tasks, office);
  const strip = `<div class="in-roster" role="list">${IN_DEPTS.map(([id, code, name]) => {
    const j = jobs.find((x) => x.dept === id), st = j ? JOB_STATE[j.state][0] : "";
    return `<a role="listitem" class="in-rost ${st}" href="#/escritorio" title="${esc(`${t(name)}: ${j ? t(JOB_STATE[j.state][1]) : t("Livre")}`)}"><i>${code}</i><span>${esc(t(name))}</span></a>`;
  }).join("")}</div>`;
  const head = `<p class="in-now-sum"><b>${busy.size ? t(busy.size === 1 ? "1 a trabalhar" : "{n} a trabalhar", { n: busy.size }) : t("Todos livres")}</b><span>${t(busy.size ? "de {n} departamentos" : "{n} departamentos", { n: IN_DEPTS.length })}</span></p>`;
  if (!jobs.length) return `${head}${strip}<div class="in-calm">${icon("bot")}<div><b>${t("O escritório está livre.")}</b><span>${t("Escreve uma tarefa em cima e o escritório escolhe quem a faz.")}</span></div></div>`;
  const row = (j) => {
    const [tone, word] = JOB_STATE[j.state], d = j.dept ? deptOf(j.dept) : null;
    const who = j.whoName || nameOf(j.who);
    const meta = [d ? d.name : t("Na fila"), j.type === "sub" ? t("subagente") : "", who ? t("para {n}", { n: isMe(j.who) || who === me.display_name ? t("ti") : who }) : "", j.project].filter(Boolean);
    return `<a class="in-job ${tone}" href="${j.href}">${d ? monoHtml(d.id, tone) : `<span class="in-mono off">${t("FILA")}</span>`}
      <div class="in-job-t"><b>${esc(j.goal)}</b><span>${esc(meta.join(" · "))}</span>${j.action ? `<em>${esc(j.action)}</em>` : ""}</div>
      <div class="in-job-s"><span class="in-pill ${tone}"><i></i>${t(j.state === "wait" && j.wait === "permission" ? "Pede autorização" : j.state === "wait" && j.wait === "answer" ? "Espera resposta" : word)}</span><time>${esc(fmt.ago(j.since))}</time></div></a>`;
  };
  return `${head}${strip}<div class="in-jobs">${jobs.slice(0, 5).map(row).join("")}</div>
    ${jobs.length > 5 ? `<a class="in-foot" href="#/escritorio">${t("Mais {n} no Escritório", { n: jobs.length - 5 })}${icon("chevron")}</a>` : ""}`;
}

/* ---------- À tua espera ---------- */
async function waitBody() {
  const [approvals, inbox, msgs, office] = await Promise.all([api("/api/approvals").catch(() => []), api("/api/notifications?limit=100"),
    api("/api/messages").catch(() => ({ unread: 0, conversations: [] })), api("/api/office").catch(() => ({ sessions: [] }))]);
  const pending = approvals.filter((a) => a.status === "PENDING");
  const asking = (office.sessions || []).filter((s) => s.user === me.username && s.state === "waiting" && (s.wait === "permission" || s.wait === "answer") && Date.now() - Date.parse(s.since) < 6 * 3600e3);
  const badge = $("in-unread");
  if (badge) { badge.textContent = inbox.unread; badge.hidden = !inbox.unread; }
  const rows = [];
  if (pending.length) rows.push(`<a class="in-row hot" href="#/aprovacoes"><span class="in-ic">${icon("alert")}</span><div><b>${t(pending.length === 1 ? "1 aprovação pendente" : "{n} aprovações pendentes", { n: pending.length })}</b>
    <span>${esc(`${pending[0].user_name}: ${pending[0].action}`)}</span></div>${icon("chevron")}</a>`);
  for (const s of asking.slice(0, 3)) rows.push(`<a class="in-row warn" href="#/escritorio"><span class="in-ic">${icon("chat")}</span><div><b>${t(s.wait === "permission" ? "O Claude pede autorização" : "O Claude espera a tua resposta")}</b>
    <span>${esc(`${s.project} · ${cleanAsk(s.topic) || s.title || ""}`)}</span></div><time>${esc(fmt.ago(s.since))}</time></a>`);
  if (msgs.unread) {
    const c = (msgs.conversations || []).find((x) => x.unread);
    rows.push(`<a class="in-row" href="#/mensagens"><span class="in-ic">${icon("chat")}</span><div><b>${t(msgs.unread === 1 ? "1 mensagem por ler" : "{n} mensagens por ler", { n: msgs.unread })}</b>
      ${c ? `<span>${esc(t("De {n}", { n: c.name }))}</span>` : ""}</div>${icon("chevron")}</a>`);
  }
  if (inbox.unread) {
    const last = inbox.items.find((n) => !n.read);
    rows.push(`<button class="in-row" data-act="alerts"><span class="in-ic">${icon("bell")}</span><div><b>${t(inbox.unread === 1 ? "1 aviso por ler" : "{n} avisos por ler", { n: inbox.unread })}</b>
      ${last ? `<span>${esc(last.title)}</span>` : ""}</div>${icon("chevron")}</button>`);
  }
  if (!rows.length) return `<div class="in-calm lite">${icon("check")}<div><b>${t("Nada à tua espera.")}</b><span>${t("Sem aprovações, mensagens nem avisos por ler.")}</span></div>
    <button class="btn quiet sm" data-act="alerts">${t("Avisos")}</button></div>`;
  return `<div class="in-rows">${rows.join("")}</div>`;
}

/* ---------- O teu dia ---------- */
const DAY_ROWS = 7;
function dayRow(x) {
  const own = x.group ? x.group.find((y) => y.assignee === me.username) : x;
  const [when, late] = whenOf(x), held = own && heldByAgent(own);
  const prio = x.priority === "urgent" ? "urgent" : x.priority === "high" ? "high" : "";
  const doer = doingOf(x);
  const check = held ? `<span class="in-check held" title="${t("Um agente está a tratar dela")}"></span>`
    : `<button class="in-check" data-done="${(own || x).id}" title="${t("Concluir")}" aria-label="${t("Concluir")}"></button>`;
  const sub = [prio === "urgent" ? `<em class="bad">${t("Urgente")}</em>` : prio === "high" ? `<em class="warn">${t("Alta")}</em>` : "",
    when ? `<em class="${late ? "bad" : ""}">${esc(late && !/^Hoje/.test(when) ? t("Atrasada · {d}", { d: when }) : when)}</em>` : "",
    x.group ? esc(whoLeft(x.group)) : "", esc(x.project_name || companies.find((c) => c.id === x.company)?.name || ""),
    held ? esc(t("com um agente")) : ""].filter(Boolean);
  return `<div class="in-task ${prio}" data-task="${(own || x).id}">${check}<div class="in-task-t"><b>${esc(x.title)}</b>${sub.length ? `<span>${sub.join("<s>·</s>")}</span>` : ""}</div>
    ${doer ? doingBadge(doer) : icon("chevron")}</div>`;
}
async function dayBody() {
  const all = asOne((await api("/api/tasks")).filter((x) => !x.trashed_at));
  const now = new Date(), today = startOfDay(now), tomorrow = startOfDay(now, 1), week = startOfDay(now, 8);
  const mineOf = (x) => (x.group ? x.group.some((y) => y.assignee === me.username && y.stage !== "done") : x.assignee === me.username);
  const open = all.filter((x) => x.stage !== "done");
  const mine = open.filter(mineOf).sort((a, b) => importance(a) - importance(b) || String(a.deadline || "9").localeCompare(String(b.deadline || "9")));
  const due = (x) => (x.deadline ? new Date(x.deadline) : null);
  const late = mine.filter((x) => due(x) && due(x) < today);
  const todays = mine.filter((x) => !late.includes(x) && (!due(x) || due(x) < tomorrow));
  const next = mine.filter((x) => due(x) && due(x) >= tomorrow && due(x) < week);
  const later = mine.length - late.length - todays.length - next.length;
  const doneToday = all.filter((x) => x.stage === "done" && sameDay(x.completed_at, today) && (x.completed_by === me.username || x.assignee === me.username)).length;
  const team = new Map();
  for (const x of open.filter((y) => !mineOf(y) && !y.group)) team.set(x.assignee, (team.get(x.assignee) || 0) + 1);
  let left = DAY_ROWS;
  const group = (title, list, tone = "") => {
    if (!list.length || left <= 0) return "";
    const shown = list.slice(0, left); left -= shown.length;
    return `<div class="in-grp ${tone}"><span>${t(title)}</span><i>${list.length}</i></div>${shown.map(dayRow).join("")}`;
  };
  const teamLine = team.size ? `<a class="in-foot" href="#/tarefas">${icon("users")}<span>${t("Da equipa")}: ${[...team].map(([u, n]) => `${esc(nameOf(u))} ${n}`).join(" · ")}</span>${icon("chevron")}</a>` : "";
  const doneLine = doneToday ? `<p class="in-done-line">${icon("check")}${t(doneToday === 1 ? "Fizeste 1 hoje." : "Fizeste {n} hoje.", { n: doneToday })}</p>` : "";
  if (!mine.length) return `<div class="in-calm">${icon("calendar")}<div><b>${t(doneToday ? "Fizeste tudo o que era teu." : "Dia limpo: nada no teu nome.")}</b>
      <span>${t("Escreve em cima o que queres feito hoje: fica contigo ou vai para o escritório.")}</span></div><button class="btn sm" data-focus-send>${t("Escrever tarefa")}</button></div>${doneLine}${teamLine}`;
  const more = mine.length - DAY_ROWS;
  return `<div class="in-list">${group("Atrasadas", late, "bad")}${group("Hoje", todays)}${group("Próximos dias", next)}</div>
    ${more > 0 || later > 0 ? `<a class="in-foot" href="#/tarefas">${t("Ver as {n} no quadro", { n: mine.length })}${icon("chevron")}</a>` : ""}${doneLine}${teamLine}`;
}

/* ---------- Hoje: a few real figures ---------- */
async function todayBody() {
  const [tasks, office] = await Promise.all([api("/api/tasks"), api("/api/office").catch(() => null)]);
  const day = startOfDay(new Date()), monday = startOfDay(new Date(), -((new Date().getDay() + 6) % 7));
  const done = tasks.filter((x) => x.stage === "done" && !x.trashed_at);
  const doneToday = done.filter((x) => sameDay(x.completed_at, day)).length, doneWeek = done.filter((x) => sameDay(x.completed_at, monday)).length;
  const fig = (ic, label, value, sub = "") => `<div class="in-fig"><span>${t(label)}</span><b>${value == null ? `<small>${t("Sem dados")}</small>` : value}</b>${sub ? `<em>${esc(sub)}</em>` : ""}</div>`;
  if (!office) return `<div class="in-figs">${fig("check", "Tarefas feitas", doneToday, t("{n} esta semana", { n: doneWeek }))}${fig("chat", "Pedidos ao Claude", null)}${fig("layers", "Subagentes", null)}</div>`;
  const sessions = (office.sessions || []).filter((s) => sameDay(s.started_at, day));
  const subs = (office.sessions || []).flatMap((s) => s.agents || []).filter((a) => sameDay(a.started_at, day)).length;
  const tokens = (office.sessions || []).filter((s) => sameDay(s.updated_at, day)).reduce((n, s) => n + (s.tokens || 0), 0);
  const people = new Set(sessions.map((s) => s.name));
  return `<div class="in-figs">${fig("check", "Tarefas feitas", doneToday, t("{n} esta semana", { n: doneWeek }))}
    ${fig("chat", "Pedidos ao Claude", sessions.length, people.size ? [...people].join(", ") : t("Ninguém ainda"))}
    ${fig("layers", "Subagentes", subs, t("lançados hoje"))}
    ${tokens ? fig("token", "Tokens do Claude", fmt.tokens(tokens), t("hoje")) : ""}</div>`;
}

/* ---------- Equipa: the three partners, small ---------- */
const PLACE = { pc: "no computador", phone: "no telemóvel" };
async function teamBody() {
  const [team, office] = await Promise.all([api("/api/team"), api("/api/office").catch(() => ({ sessions: [] }))]);
  const order = [...team].sort((a, b) => (b.user === me.username) - (a.user === me.username) || (a.status === "OFFLINE") - (b.status === "OFFLINE"));
  return `<div class="in-people">${order.map((m) => {
    const on = m.status !== "OFFLINE", where = (m.where || []).filter((w) => PLACE[w]).map((w) => t(PLACE[w]));
    const working = (office.sessions || []).filter((s) => s.user === m.user && s.state === "working").length;
    const line = m.doing ? t("A fazer: {x}", { x: m.doing.title }) : working ? t(working === 1 ? "1 janela do Claude a trabalhar" : "{n} janelas do Claude a trabalhar", { n: working })
      : m.status === "WORKING" && m.task ? t("Agente: {x}", { x: m.task }) : on ? t("Online {w}", { w: where.join(" e ") || "" }).trim() : m.last_seen ? t("Visto {w}", { w: fmt.ago(m.last_seen) }) : t("Offline");
    const tone = m.doing || working || m.status === "WORKING" ? "p-work" : on ? "p-on" : "p-off";
    return `<a class="in-person ${tone}" href="${m.doing ? `#/tarefas/${m.doing.id}` : "#/equipa"}"><span class="in-av">${ui.avatar(m.display_name, "sm")}<i></i></span>
      <div><b>${esc(m.user === me.username ? `${m.display_name} (${t("tu")})` : m.display_name)}</b><span>${esc(line)}</span></div></a>`;
  }).join("")}</div>`;
}

/* ---------- Atividade: who did what, a person or a department ---------- */
const NOISE = ["login", "hub_online", "hub_offline", "agent_online", "agent_offline"];
// "Marco concluiu: X" or "concluiu: X" → ["concluiu", "X"]
function splitActivity(a) {
  const m = a.name && a.message.startsWith(a.name) ? a.message.slice(a.name.length).trim() : a.message, cut = m.indexOf(": ");
  return cut > 0 ? [m.slice(0, cut), m.slice(cut + 2)] : [m, ""];
}
async function activityBody() {
  const [items, office] = await Promise.all([api("/api/history?limit=200"), api("/api/office").catch(() => ({ film: [] }))]);
  const rows = items.filter((a) => !NOISE.includes(a.kind)).slice(0, 12).map((a) => {
    const [what, detail] = splitActivity(a);
    return { at: a.created_at, face: ui.avatar(a.name, "sm"), who: a.name, what, detail };
  });
  for (const f of office.film || []) {
    const ask = cleanAsk(f.text);
    if (f.kind === "window_open") { if (ask) rows.push({ at: f.at, face: ui.avatar(f.who, "sm"), who: f.who, what: t("pediu ao Claude"), detail: ask, where: f.project }); }
    else if (f.kind === "agent_start" || f.kind === "agent_done") {
      const d = deptOf(IN_KIND[f.agent] || "batman");
      rows.push({ at: f.at, face: monoHtml(d.id, f.kind === "agent_done" ? "" : "on", "sm"), who: d.name, what: t(f.kind === "agent_done" ? "acabou" : "começou"), detail: plainOf(f.text), where: t("para {n}", { n: f.who }) });
    }
  }
  rows.sort((p, q) => String(q.at).localeCompare(String(p.at)));
  if (!rows.length) return `<div class="in-calm lite">${icon("pulse")}<div><b>${t("Ainda não aconteceu nada hoje.")}</b><span>${t("O que a equipa e os agentes fizerem aparece aqui.")}</span></div></div>`;
  return `<div class="in-feed">${rows.slice(0, 7).map((r) => `<div class="in-ev">${r.face}<div><p><b>${esc(r.who)}</b> ${esc(r.what)}${r.where ? ` <small>· ${esc(r.where)}</small>` : ""}</p>
    ${r.detail ? `<span>${esc(r.detail.slice(0, 220))}</span>` : ""}</div><time>${esc(fmt.ago(r.at))}</time></div>`).join("")}</div>`;
}

/* ---------- notifications: the whole history one click away ---------- */
const NOTE_ICON = { task_new: "tasks", task: "check", approval_required: "alert", approval_decided: "check", agent_failed: "alert", agent_waiting: "clock" };
const noticeRow = (n) => `<button class="nrow ${n.read ? "" : "unread"}" data-n="${n.id}" data-href="${esc(n.href || "")}"><i></i>
  <span class="n-ic">${icon(NOTE_ICON[n.kind] || "bell")}</span>
  <span class="n-t"><b>${esc(n.title)}</b>${n.body ? `<span>${esc(n.body)}</span>` : ""}</span><time>${fmt.ago(n.created_at)}</time></button>`;
async function openNotices() {
  let inbox;
  try { inbox = await request("/api/notifications?limit=100"); } catch (e) { flash(e.message); return; }
  const days = new Map();
  for (const n of inbox.items) days.set(fmt.day(n.created_at), [...(days.get(fmt.day(n.created_at)) || []), n]);
  openModal(`<div class="rowx" style="margin-bottom:14px"><h3 class="grow" style="margin:0">${t("Notificações")}</h3>
      ${inbox.unread ? `<button class="btn quiet sm" data-read-all>${t("Marcar tudo como lido")}</button>` : ""}
      <button class="btn quiet sm" data-close aria-label="${t("Fechar")}">${icon("x")}</button></div>
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
    loadHome(["tasks", "news"]);
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
  if (sendClick(e)) return;
  if (await newTaskClick(e)) return;
  if (e.target.closest("[data-focus-send]")) return focusSend();
  if (e.target.closest("[data-act=alerts]")) return openNotices();
  const notice = e.target.closest("[data-n]");
  if (notice) return openNotice(notice);
  const done = e.target.closest("[data-done]");
  if (done) {
    done.disabled = true;
    done.closest(".in-task")?.classList.add("finishing");
    try { await api(`/api/tasks/${done.dataset.done}`, { method: "PATCH", body: { status: "COMPLETED" } }); flash(t("Tarefa concluída.")); }
    catch (err) { flash(err.message); done.disabled = false; }
    return loadHome(["tasks"]);
  }
  const task = e.target.closest("[data-task]");
  if (task) openTaskModal(Number(task.dataset.task));
}

/* ---------- the page ---------- */
const subOf = (now) => { const date = now.toLocaleDateString("pt-PT", { weekday: "long", day: "numeric", month: "long" }); return `${date[0].toUpperCase() + date.slice(1)} · ${fmt.hhmm(now.toISOString())}`; };
// The clock moves on the minute, and stops by itself once the page is gone.
let homeClock = null;
function startHomeClock() {
  clearTimeout(homeClock);
  const next = () => {
    const sub = document.querySelector(".inicio > .ph p");
    if (!sub) return;
    sub.textContent = subOf(new Date());
    homeClock = setTimeout(next, 60000 - (Date.now() % 60000) + 20);
  };
  homeClock = setTimeout(next, 60000 - (Date.now() % 60000) + 20);
}

// What each kind of change reloads; a promise, as the live events expect of the loaders they call.
const PARTS = {
  fresh: ["in-fresh", freshBody, 0, ["tasks", "news"]], now: ["in-now", nowBody, 4, ["tasks", "office"]], wait: ["in-wait", waitBody, 2, ["news", "office", "approval"]],
  day: ["in-day", dayBody, 4, ["tasks"]], today: ["in-today", todayBody, 2, ["tasks", "office"]], team: ["in-team", teamBody, 3, ["team", "office", "tasks"]],
  act: ["in-act", activityBody, 4, ["act", "office", "tasks"]],
};
async function loadHome(kinds = null) {
  if (!$("in-now")) return;
  // the card of a task sent to you is usually nothing: no skeleton for it (mount would leave one standing over an empty answer)
  const quiet = async (el, fn) => { try { paint(el, await fn()); } catch { /* the next event tries again */ } };
  await Promise.all(Object.values(PARTS).filter(([, , , on]) => !kinds || kinds.some((k) => on.includes(k)))
    .map(([id, fn, lines]) => (lines ? mount($(id), fn, lines) : quiet($(id), fn))));
}
const card = (id, title, link = "", cls = "") => `<section class="in-card ${cls}"><header class="in-h"><h2>${esc(t(title))}</h2>${link}</header><div id="${id}"></div></section>`;
const headLink = (label, href) => `<a class="in-h-link" href="${href}">${esc(t(label))}${icon("chevron")}</a>`;

HUB_VIEWS.home = async function viewHome() {
  $("view").innerHTML = `<div class="page inicio">
    ${ui.head("", `${t(greetingOf(new Date().getHours()))}, ${me.display_name}`, subOf(new Date()),
      `<div class="in-car" aria-hidden="true"><img src="assets/amg-front-1200.webp" alt="" decoding="async"></div>`)}
    ${sendHtml()}
    <div id="in-fresh" class="in-fresh"></div>
    <div class="in-grid">
      <div class="in-col">
        ${card("in-now", "Agora mesmo", headLink("Escritório", "#/escritorio"), "in-now")}
        ${card("in-day", "O teu dia", headLink("Quadro", "#/tarefas"))}
        ${card("in-act", "Atividade", headLink("Ver tudo", "#/aovivo"))}
      </div>
      <div class="in-col">
        ${card("in-wait", "À tua espera")}
        ${card("in-today", "Hoje")}
        ${card("in-team", "Equipa", headLink("Ver", "#/equipa"))}
      </div>
    </div></div>`;
  $("view").onclick = homeClick;
  const form = $("in-send");
  form.onsubmit = (e) => { e.preventDefault(); sendTask(form); };
  form.elements.title.addEventListener("input", () => askRoute());
  paintSend();
  startHomeClock();
  api("/api/users").then((list) => { sendUsers = list; paintSend(); }).catch(() => {});
  loadHome();
};

// A live event reloads only what shows that kind of thing ("tick" is the slow safety net: all of it).
onLive(["presence"], () => loadHome(["team"]));
onLive(["notification"], () => loadHome(["news"]));
onLive(["approval"], () => loadHome(["approval"]));
onLive(["task"], () => loadHome(["tasks"]));
onLive(["office"], () => loadHome(["office"]));
onLive(["activity"], () => loadHome(["act"]));
onLive(["tick"], () => loadHome());

// what other files may use: the card of a task sent to you, and the notifications' history
Object.assign(window, { newTasksOf, newTaskCard, newTaskClick, openNotices });
})();
