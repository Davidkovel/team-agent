// Team AI Hub: the pages. Each is built from the components in ui.js and reads only what the Hub really has.

const page = (html) => { $("view").innerHTML = `<div class="page">${html}</div>`; };
const leadOnly = (html) => (me.lead ? html : "");
const AI_ERRORS = {
  agent_offline: "O teu agente local não está ligado. Quem responde é o teu próprio agente, com o Claude do teu computador: liga o agente e pergunta outra vez.",
  timeout: "O agente não respondeu a tempo.",
};
const aiError = (code) => t(AI_ERRORS[code] || code || "Sem resposta.");

// Ask the Team AI (or for the weekly report) and wait for the answer of the person's own agent.
async function askAI(question, kind = "chat") {
  let request = await api("/api/ai/ask", { method: "POST", body: { question, kind } });
  for (let i = 0; i < 150 && ["PENDING", "RUNNING"].includes(request.status); i++) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    request = await request_("/api/ai/requests/" + request.id);
  }
  return request;
}
const request_ = (path) => request(path); // uncached read (api() shares reads for a few seconds)

/* ================================================================ tasks */
let taskFilter = "";
const HUMAN_STATUS = { todo: "TODO", blocked: "BLOCKED", review: "REVIEW", done: "COMPLETED" }; // columns a person may drop a task into
const canGiveToAI = (x) => ["TODO", "BLOCKED", "REVIEW", "FAILED", "STOPPED", "COMPLETED"].includes(x.status);
const heldByAgent = (x) => ["IN_PROGRESS", "WAITING_APPROVAL", "PAUSED", "NEEDS_HELP", "ASSIGNED"].includes(x.status);

// A task sent to everybody is one task per person. Those made together (same text, same moment) are shown as ONE card, "Para todos".
function groupAll(list) {
  const used = new Set(), out = [];
  for (const x of list) {
    if (used.has(x.id)) continue;
    const same = list.filter((y) => !used.has(y.id) && y.title === x.title && (y.description || "") === (x.description || "") && y.priority === x.priority
      && (y.deadline || "") === (x.deadline || "") && Math.abs(new Date(y.created_at) - new Date(x.created_at)) < 30000);
    if (same.length > 1 && new Set(same.map((y) => y.assignee)).size === same.length) { same.forEach((y) => used.add(y.id)); out.push({ ...x, group: same }); }
    else { used.add(x.id); out.push(x); }
  }
  return out;
}
// The card for a task sent to everybody is done only when everybody has done it; until then it stands where the work still is.
function asOne(list) {
  return groupAll(list).map((x) => {
    if (!x.group) return x;
    const left = x.group.filter((y) => y.stage !== "done");
    if (left.length) return { ...(left.find((y) => y.stage === "in_progress") || left[0]), group: x.group };
    return { ...x.group.reduce((a, b) => (new Date(b.completed_at || 0) > new Date(a.completed_at || 0) ? b : a)), group: x.group };
  });
}
// A face per person: a tick on whoever did their part, faded for whoever has not.
const whoFace = (y, size = "sm") => `<span class="doer ${y.stage === "done" ? "did" : "left"}" title="${esc(nameOf(y.assignee))}: ${esc(y.stage === "done"
  ? `${t("feito")}${y.completed_by && y.completed_by !== y.assignee ? ` (${t("por")} ${nameOf(y.completed_by)})` : ""}` : t("por fazer"))}">${ui.avatar(nameOf(y.assignee), size)}<i>${icon("tick")}</i></span>`;
const whoFaces = (group, size) => `<span class="doer-row">${group.map((y) => whoFace(y, size)).join("")}</span>`;
// "2 de 3 feito · falta Kovel"
function whoLeft(group) {
  const left = group.filter((y) => y.stage !== "done");
  if (!left.length) return t("Todos fizeram");
  const did = group.length - left.length;
  return `${t("{a} de {b} feito", { a: did, b: group.length })} · ${t("falta")} ${left.map((y) => nameOf(y.assignee)).join(", ")}`;
}
// "por Kovel", and when it was somebody else's: "por Kovel (era do Marco)"
const doneBy = (x) => (x.completed_by ? `${t("por")} ${nameOf(x.completed_by)}${x.completed_by !== x.assignee ? ` (${t("era de")} ${nameOf(x.assignee)})` : ""}` : "");
const importance = (x) => (x.priority === "urgent" ? 0 : x.priority === "high" ? 1 : 2);
const isFresh = (x) => x.stage !== "done" && Date.now() - new Date(x.created_at) < 15 * 60000;

function taskCard(x) {
  const late = x.deadline && x.stage !== "done" && new Date(x.deadline) < new Date();
  const mineOf = x.group && x.group.find((y) => y.assignee === me.username);
  const stack = x.group ? whoFaces(x.group) : ui.avatar(nameOf(x.assignee), "sm");
  const top = [x.priority === "urgent" ? ui.tag(t("Urgente"), "bad") : x.priority === "high" ? ui.tag(t("Alta"), "warn") : "", x.group ? ui.tag(groupLabel(x.group), "ai") : "", isFresh(x) ? ui.tag(t("Nova"), "ok") : ""].join("");
  return `<article class="tk ${x.priority === "urgent" ? "urgent" : x.priority === "high" ? "high" : ""} ${isFresh(x) ? "fresh" : ""}" draggable="${x.group ? "false" : "true"}" data-id="${(mineOf || x).id}">
    ${top ? `<div class="tk-top">${top}</div>` : ""}
    <b>${esc(x.title)}</b>
    ${x.stage === "in_progress" || (x.progress > 0 && x.stage !== "done") ? ui.progress(x.progress, "ai") : ""}
    ${x.group ? `<span class="tk-who">${esc(whoLeft(x.group))}</span>` : ""}
    <div class="tk-foot">${stack}<span class="grow ell">${esc(x.project_name || x.project || "")}</span>
      ${x.agent_role ? ui.tag("IA", "ai") : ""}${x.priority === "low" ? ui.tag(t(PRIORITY[x.priority]), x.priority) : ""}
      ${x.deadline ? ui.tag(fmt.date(x.deadline), late ? "bad" : "") : ""}</div></article>`;
}

// What is finished takes little room: one short line each, only today's, and the older ones behind a button.
let showOlderDone = false;
const doneAt = (x) => new Date(x.completed_at || x.updated_at || x.created_at);
const doneCard = (x) => `<article class="tk tk-done" draggable="${x.group ? "false" : "true"}" data-id="${((x.group && x.group.find((y) => y.assignee === me.username)) || x).id}"
  title="${esc(x.group ? whoLeft(x.group) : doneBy(x))}"><span class="tk-tick">${icon("check")}</span><span class="tk-dt"><b>${esc(x.title)}</b>
  ${x.group ? `<i>${t("Todos fizeram")}</i>` : x.completed_by ? `<i class="${x.completed_by !== x.assignee ? "other" : ""}">${esc(doneBy(x))}</i>` : ""}</span>
  ${x.group ? whoFaces(x.group) : ui.avatar(nameOf(x.completed_by || x.assignee), "sm")}</article>`;
function doneColumn(list, label) {
  const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
  const sorted = [...list].sort((a, b) => doneAt(b) - doneAt(a));
  const today = sorted.filter((x) => doneAt(x) >= midnight), older = sorted.filter((x) => doneAt(x) < midnight);
  return `<section class="col col-done" data-stage="done"><div class="col-head"><span>${t(label)}</span><i>${list.length}</i></div>
    ${today.length ? today.map(doneCard).join("") : `<p class="faint" style="margin:6px 2px;font-size:12px">${t("Nada concluído hoje")}</p>`}
    ${older.length ? `<button class="done-older" data-older-done>${t(showOlderDone ? "Esconder as anteriores" : "Ver as anteriores ({n})", { n: older.length })}</button>
      ${showOlderDone ? older.slice(0, 20).map(doneCard).join("") : ""}` : ""}</section>`;
}

/* ---------- Tarefas as lists, like the phone: Hoje, Próximas and Feitas side by side, each in blocks ---------- */
let taskView = (() => { try { return localStorage.getItem("hub.taskView") || "lista"; } catch { return "lista"; } })();
let taskCoFilter = "";
const tlDay = (iso) => {
  const d = new Date(iso), now = new Date();
  return Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5);
};
const tlLate = (x) => (x.deadline ? tlDay(x.deadline) : null);
const tlOrder = (a, b) => importance(a) - importance(b) || String(a.deadline || "9").localeCompare(String(b.deadline || "9")) || b.id - a.id;
function tlWhen(x) {
  const n = tlLate(x);
  if (n === null) return "";
  if (n > 0) return `<em class="late">${t(n === 1 ? "Atrasada há 1 dia" : "Atrasada há {n} dias", { n })}</em>`;
  if (n === 0) return `<em class="today">${t("Hoje")} ${fmt.hhmm(x.deadline)}</em>`;
  return n === -1 ? `${t("Amanhã")} ${fmt.hhmm(x.deadline)}` : `${fmt.date(x.deadline)}`;
}
function tlRow(x) {
  const own = x.group ? x.group.find((y) => y.assignee === me.username) : x;
  const done = x.stage === "done", tone = done ? "done" : x.priority === "urgent" ? "urgent" : x.priority === "high" ? "high" : "";
  const co = companies.find((c) => c.id === x.company)?.name;
  const meta = [co ? `<span class="tl-co">${esc(co)}</span>` : "", x.project_name ? esc(x.project_name) : "",
    x.group ? `<span class="all">${esc(whoLeft(x.group))}</span>` : done ? (x.completed_by ? `<span class="${x.completed_by !== x.assignee ? "other" : ""}">${esc(doneBy(x))}</span>` : "") : esc(nameOf(x.assignee)),
    done ? (x.completed_at ? `${fmt.day(x.completed_at)} ${fmt.hhmm(x.completed_at)}` : "") : tlWhen(x),
    x.stage === "in_progress" ? `<em class="ai">${t("Em curso")}</em>` : x.stage === "blocked" ? `<em class="late">${t("Bloqueada")}</em>` : ""].filter(Boolean);
  const check = done ? `<span class="tl-check">${icon("tick")}</span>`
    : own && own.stage !== "done" && !heldByAgent(own) ? `<button class="tl-check" data-done="${own.id}" title="${t("Concluir")}"></button>`
    : `<span class="tl-check ${own && own.stage === "done" ? "part" : "held"}">${own && own.stage === "done" ? icon("tick") : ""}</span>`;
  return `<div class="tl-row ${tone}" data-id="${(own || x).id}">${check}
    <div class="tl-t"><b>${tone === "urgent" ? '<i class="bang">!!</i>' : tone === "high" ? '<i class="bang high">!</i>' : ""}${esc(x.title)}</b>${meta.length ? `<span>${meta.join(" · ")}</span>` : ""}</div>
    ${x.group ? whoFaces(x.group) : ui.avatar(nameOf(done && x.completed_by ? x.completed_by : x.assignee), "sm")}</div>`;
}
const tlBlock = (title, list, tone = "", sort = true) => (list.length ? `<div class="tl-block"><h4 class="${tone}"><i></i>${t(title)}<span>${list.length}</span></h4>
  <div class="tl-list">${(sort ? [...list].sort(tlOrder) : list).map(tlRow).join("")}</div></div>` : "");
let showOlderFeitas = false;

async function loadLists(board) {
  await mount(board, async () => {
    const [list, approvals] = await Promise.all([api("/api/tasks"), api("/api/approvals").catch(() => [])]);
    const all = list.filter((x) => !x.trashed_at);
    const people = [...new Set(all.map((x) => x.assignee))];
    const withCo = companies.filter((c) => all.some((x) => x.company === c.id));
    if (taskCoFilter && taskCoFilter !== "none" && !withCo.some((c) => c.id === taskCoFilter)) taskCoFilter = "";
    paint($("task-filter"), [["", t("Todas")], ...people.map((u) => [u, nameOf(u)])]
      .map(([u, label]) => `<button class="chp ${u === taskFilter ? "on" : ""}" data-u="${esc(u)}">${esc(label)}</button>`).join("")
      + (withCo.length ? `<span class="chp-sep"></span>${[["", "Todas as empresas"], ...withCo.map((c) => [c.id, c.name]), ["none", "Sem empresa"]]
        .map(([id, label]) => `<button class="chp ${id === taskCoFilter ? "on" : ""}" data-co="${esc(id)}">${esc(t(label))}</button>`).join("")}` : ""));
    const mine = all.filter((x) => (!taskFilter || x.assignee === taskFilter) && (!taskCoFilter || (taskCoFilter === "none" ? !x.company : x.company === taskCoFilter)));
    // filtered by a person, a task for everybody stands for that person's copy; otherwise it is one card for all
    const cards = taskFilter ? groupAll(all).filter((g) => g.group ? g.group.some((y) => y.assignee === taskFilter) : g.assignee === taskFilter)
      .map((g) => (g.group ? { ...g.group.find((y) => y.assignee === taskFilter), group: g.group } : g))
      .filter((x) => !taskCoFilter || (taskCoFilter === "none" ? !x.company : x.company === taskCoFilter)) : asOne(mine);
    const open = cards.filter((x) => x.stage !== "done"), rest = open.filter((x) => x.priority !== "urgent");
    const later = rest.filter((x) => tlLate(x) !== null && tlLate(x) < 0);
    const done = cards.filter((x) => x.stage === "done").sort((a, b) => String(b.completed_at || "").localeCompare(String(a.completed_at || "")));
    const doneOn = (x) => tlDay(x.completed_at || x.updated_at || x.created_at);
    const hoje = [["Urgentes", open.filter((x) => x.priority === "urgent"), "late"], ["Atrasadas", rest.filter((x) => tlLate(x) > 0), "late"],
      ["Para hoje", rest.filter((x) => tlLate(x) === 0), "today"], ["Sem prazo", rest.filter((x) => tlLate(x) === null), ""]];
    const prox = [["Amanhã", later.filter((x) => tlLate(x) === -1)], ["Esta semana", later.filter((x) => tlLate(x) < -1 && tlLate(x) >= -7)], ["Mais tarde", later.filter((x) => tlLate(x) < -7)]];
    const older = done.filter((x) => doneOn(x) > 1);
    const count = (blocks) => blocks.reduce((k, b) => k + b[1].length, 0);
    const col = (title, sub, n, body, empty, tone = "") => `<section class="tl-col ${tone}"><header><b>${t(title)}</b><span>${esc(sub)}</span><i>${n}</i></header>
      ${body || `<p class="tl-empty">${t(empty)}</p>`}</section>`;
    const waiting = approvals.filter((a) => a.status === "PENDING").length;
    if (!all.length) return ui.empty("tasks", "Sem tarefas", "Cria a primeira tarefa: fica contigo ou vai direta para um agente.", `<button class="btn sm primary" data-new-task>${t("Nova tarefa")}</button>`);
    return `${waiting ? `<a class="tl-approve" href="#/aprovacoes">${icon("alert")}<span>${t(waiting === 1 ? "1 aprovação à espera" : "{n} aprovações à espera", { n: waiting })}</span>${icon("chevron")}</a>` : ""}
      <div class="tl-cols">
      ${col("Hoje", t("o que é para fazer já"), count(hoje), hoje.map(([title, l, tone]) => tlBlock(title, l, tone)).join(""), "Tudo feito por hoje.", count(hoje) && hoje[0][1].length ? "hot" : "")}
      ${col("Próximas", t("com prazo nos próximos dias"), count(prox), prox.map(([title, l]) => tlBlock(title, l)).join(""), "Nada marcado para os próximos dias.")}
      ${col("Feitas", t("as mais recentes primeiro"), done.length, tlBlock("Hoje", done.filter((x) => doneOn(x) <= 0), "ok", false) + tlBlock("Ontem", done.filter((x) => doneOn(x) === 1), "ok", false)
        + (older.length ? `<button class="tl-more" data-older-feitas>${t(showOlderFeitas ? "Esconder as anteriores" : "Ver as anteriores ({n})", { n: older.length })}</button>${showOlderFeitas ? tlBlock("Mais antigas", older.slice(0, 40), "ok", false) : ""}` : ""),
        "Ainda nada concluído.")}
      </div>`;
  }, 6);
}

async function loadBoard() {
  const board = $("board");
  if (!board) return;
  board.classList.toggle("is-lists", taskView === "lista");
  if (taskView === "lista") { $("bin")?.setAttribute("hidden", ""); return loadLists(board); }
  $("bin")?.removeAttribute("hidden");
  await mount(board, async () => {
    const all = (await api("/api/tasks")).filter((x) => !x.trashed_at); // what went into the bin as finished stays in the numbers, not on the board
    const people = [...new Set(all.map((x) => x.assignee))];
    paint($("task-filter"), [["", t("Todas")], ...people.map((u) => [u, nameOf(u)])]
      .map(([u, label]) => `<button class="chp ${u === taskFilter ? "on" : ""}" data-u="${esc(u)}">${esc(label)}</button>`).join(""));
    const tasks = taskFilter ? all.filter((x) => x.assignee === taskFilter) : all;
    if (!all.length) return `<div style="grid-column:1/-1">${ui.empty("tasks", "Sem tarefas", "Cria a primeira tarefa: fica contigo ou vai direta para um agente.",
      `<button class="btn sm primary" data-new-task>${t("Nova tarefa")}</button>`)}</div>`;
    const cards = asOne(tasks); // "Para todos" is one card, in "Concluída" only once everybody has done it
    return STAGES.map(([stage, label]) => {
      const mine = cards.filter((x) => x.stage === stage).sort((a, b) => importance(a) - importance(b)); // urgent first, then as before
      if (stage === "done") return doneColumn(mine, label);
      return `<section class="col" data-stage="${stage}"><div class="col-head"><span>${t(label)}</span><i>${mine.length}</i></div>
        ${mine.map(taskCard).join("") || `<p class="faint" style="margin:6px 2px;font-size:12px">${t("Vazio")}</p>`}</section>`;
    }).join("");
  }, 5);
  loadBin();
}

/* The bin: a small widget on the board. While a card is being dragged it opens into two drops (finished / mistake);
   otherwise it shows how many tasks are inside and opens the list, where they can be recovered until the Hub deletes them. */
async function loadBin() {
  const bin = $("bin");
  if (!bin) return;
  try {
    const n = (await api("/api/tasks/trash")).length;
    paint(bin, `<button class="bin-main" data-bin-open title="${t("Abrir o lixo")}">${icon("trash")}<b>${t("Lixo")}</b><i>${n}</i></button>
      <div class="bin-drops"><div class="bin-drop ok" data-reason="done">${icon("check")}<span>${t("Concluída")}</span></div>
        <div class="bin-drop bad" data-reason="mistake">${icon("x")}<span>${t("Engano")}</span></div></div>`);
  } catch (e) { /* the board already says when the Hub does not answer */ }
}

async function trashTask(id, reason) {
  const r = await api(`/api/tasks/${id}/trash`, { method: "POST", body: { reason } });
  flash(t("Foi para o Lixo. Tens {n} h para a recuperar.", { n: Math.round((new Date(r.purge_at) - new Date(r.trashed_at)) / 36e5) }));
  loadBoard();
}

const binRow = (x) => `<div class="rw"><div class="rw-main"><b>${esc(x.title)}</b>
    <span>${esc(nameOf(x.assignee))} · ${t("apaga daqui a {tempo}", { tempo: fmt.span(new Date().toISOString(), x.purge_at) })}</span></div>
  ${x.trash_reason === "done" ? ui.tag(t("Concluída"), "ok") : ui.tag(t("Engano"), "bad")}
  <button class="btn sm" data-bin-act="restore" data-id="${x.id}">${t("Recuperar")}</button>
  <button class="btn sm danger" data-bin-act="delete" data-id="${x.id}">${t("Apagar já")}</button></div>`;

async function openBin() {
  let items;
  try { items = await request_("/api/tasks/trash"); } catch (e) { flash(e.message); return; }
  openModal(`<div class="rowx" style="margin-bottom:12px"><h3 style="margin:0" class="grow">${t("Lixo")}</h3><button class="btn quiet sm" data-close>${icon("x")}</button></div>
    ${items.length ? `<div class="panel">${items.map(binRow).join("")}</div>`
      : ui.empty("trash", "O lixo está vazio", "Tudo o que largares aqui fica recuperável durante umas horas e depois desaparece.")}`);
  $("modal-box").onclick = async (e) => {
    const button = e.target.closest("[data-bin-act]");
    if (!button) return;
    try {
      if (button.dataset.binAct === "restore") await api(`/api/tasks/${button.dataset.id}/restore`, { method: "POST" });
      else await api(`/api/tasks/${button.dataset.id}/trash`, { method: "DELETE" });
    } catch (err) { flash(err.message); return; }
    loadBoard();
    openBin();
  };
}

// "Para quem?": one button for each person, any number of them pressed, and one for everybody. Each person chosen gets a task
// of their own; the form sends their logins separated by commas, or "all". Someone who cannot direct work only sends to
// themselves, so there is nothing to choose.
function whoPicker(users, selected) {
  if (!me.lead) return `<input type="hidden" name="assignee" value="${esc(me.username)}">`;
  const on = new Set(String(selected).split(",")), all = on.has("all");
  return `<div class="field wide"><span>${t("Para quem?")}</span><div class="who" data-who><input type="hidden" name="assignee" value="${esc(selected)}">${users.map((u) =>
    `<label class="who-opt"><input type="checkbox" value="${esc(u.username)}" ${all || on.has(u.username) ? "checked" : ""}><span>${esc(u.display_name)}</span></label>`).join("")}
    <label class="who-opt"><input type="checkbox" value="all" ${all ? "checked" : ""}><span>${t("Todos")}</span></label></div>
    <small class="muted">${t("Escolhe uma ou mais pessoas: cada uma recebe a sua tarefa.")}</small></div>`;
}
document.addEventListener("change", (e) => {
  const box = e.target.closest?.("[data-who]");
  if (!box) return;
  const people = [...box.querySelectorAll('input[type="checkbox"]:not([value="all"])')], all = box.querySelector('input[value="all"]');
  if (e.target === all) people.forEach((p) => { p.checked = all.checked; });
  const picked = people.filter((p) => p.checked);
  all.checked = picked.length === people.length;
  box.querySelector('input[name="assignee"]').value = all.checked ? "all" : picked.map((p) => p.value).join(",");
});
// The tag of a task made for several people: "Para todos", or their names when it was only for some.
const groupLabel = (group) => (group.length >= Object.keys(teamNames).length ? t("Para todos") : `${t("Para")} ${group.map((y) => nameOf(y.assignee)).join(", ")}`);

function taskFields(x = {}, users = [], projects = [], sending = false) {
  const deadline = x.deadline ? new Date(new Date(x.deadline).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "";
  return (sending ? whoPicker(users, x.assignee || me.username) : "")
    + field("Título", `<input name="title" required value="${esc(x.title || "")}">`, true)
    + field("Descrição", `<textarea name="description">${esc(x.description || "")}</textarea>`, true)
    + (sending ? "" : field("Responsável", `<select name="assignee">${options(users.filter((u) => me.lead || u.username === me.username).map((u) => [u.username, u.display_name]), x.assignee || me.username)}</select>`))
    + field("Prioridade", `<select name="priority">${options(Object.entries(PRIORITY).map(([k, v]) => [k, t(v)]), x.priority || "normal")}</select>`)
    + field("Projeto", `<select name="project_id">${options([["", t("Sem projeto")], ...projects.map((p) => [p.id, p.name])], x.project_id)}</select>`)
    + field("Empresa", `<select name="company">${options([["", t("Sem empresa")], ...companies.map((c) => [c.id, c.name])], x.company)}</select>`)
    + field("Prazo", `<input name="deadline" type="datetime-local" value="${deadline}">`)
    + field("Branch de git", `<input name="git_branch" value="${esc(x.git_branch || "")}" placeholder="ex: checkout-fix">`);
}
const taskBody = (v) => ({ title: v.title.trim(), description: v.description, assignee: v.assignee, priority: v.priority,
  project_id: v.project_id ? Number(v.project_id) : null, company: v.company || null,
  deadline: v.deadline ? new Date(v.deadline).toISOString() : null, git_branch: v.git_branch || "" });

async function newTask(preset = {}) {
  const [users, projects] = await Promise.all([api("/api/users"), api("/api/projects")]);
  formModal("Nova tarefa", taskFields(preset, users, projects, true)
    + field("Quem a faz", `<select name="for_ai">${options([["", t("Uma pessoa (fica em Por fazer)")], ...Object.entries(ROLES).filter(([k]) => k !== "custom").map(([k, v]) => [k, `${t("IA")}: ${t(v)}`])], preset.for_ai || "")}</select>`, true),
  async (v) => {
    if (!v.assignee) throw new Error(t("Escolhe pelo menos uma pessoa."));
    const created = await api("/api/tasks", { method: "POST", body: { ...taskBody(v), for_ai: !!v.for_ai, agent_role: v.for_ai || "" } });
    flash(v.assignee === "all" ? t("Tarefa enviada a todos.") : v.assignee.includes(",") ? t("Tarefa enviada a {n} pessoas.", { n: v.assignee.split(",").length }) : t("Tarefa criada."));
    loadBoard();
    return created;
  }, { submit: "Criar tarefa", wide: true });
}

function assignToAI(x) {
  formModal("Entregar à IA", field("Tipo de agente", `<select name="role">${options(Object.entries(ROLES).map(([k, v]) => [k, t(v)]), x.agent_role || "developer")}</select>`, true)
    + field("Instruções (obrigatórias no agente à medida)", `<textarea name="instructions" placeholder="${t("Como deve trabalhar nesta tarefa")}">${esc(x.agent_instructions || "")}</textarea>`, true)
    + `<p class="dim wide" style="margin:0">${t("A tarefa vai para o agente local de {nome}. Ele arranca o Claude, pode usar subagentes, e pede aprovação antes de qualquer ação sensível.", { nome: nameOf(x.assignee) })}</p>`,
  async (v) => {
    await api(`/api/tasks/${x.id}/assign-ai`, { method: "POST", body: { role: v.role, instructions: v.instructions } });
    flash(t("Entregue ao agente."));
    loadBoard(); openTaskModal(x.id);
  }, { submit: "Entregar" });
}

async function openTaskModal(id) {
  let x, all;
  try { [x, all] = await Promise.all([request_(`/api/tasks/${id}`), request_("/api/tasks")]); } catch (e) { flash(e.message); return; }
  const group = groupAll(all.filter((y) => !y.trashed_at)).find((g) => g.group && g.group.some((y) => y.id === x.id))?.group;
  const held = heldByAgent(x), running = ["IN_PROGRESS", "WAITING_APPROVAL"].includes(x.status);
  const kv = [["Responsável", group ? `${t("Todos")} (${group.length})` : esc(nameOf(x.assignee))],
    ["Criada por", x.created_by ? `${esc(nameOf(x.created_by))} · ${fmt.day(x.created_at)} ${fmt.hhmm(x.created_at)}` : "—"],
    ...(x.stage === "done" && !group ? [["Concluída por", x.completed_by ? `${esc(nameOf(x.completed_by))}${x.completed_at ? ` · ${fmt.day(x.completed_at)} ${fmt.hhmm(x.completed_at)}` : ""}` : `<span class="faint">${t("Sem registo")}</span>`]] : []), ["Projeto", esc(x.project_name || x.project || "—")],
    ["Empresa", esc(companies.find((c) => c.id === x.company)?.name || "—")], ["Prioridade", t(PRIORITY[x.priority])],
    ["Prazo", x.deadline ? `${fmt.date(x.deadline)} ${fmt.hhmm(x.deadline)}` : "—"], ["Agente", x.agent_role ? esc(t(ROLES[x.agent_role])) : "—"],
    ["Branch", x.git_branch ? `<span class="mono">${esc(x.git_branch)}</span>` : "—"],
    ["Custo de IA", x.ai_cost_usd == null ? `<span class="faint">${t("Sem dados")}</span>` : `${fmt.usd(x.ai_cost_usd)} ${ui.src("estimated")}`]];
  openModal(`<div class="rowx" style="margin-bottom:12px"><h3 style="margin:0" class="grow">${esc(x.title)}</h3>
      ${group ? ui.tag(t("{a} de {b} feito", { a: group.filter((y) => y.stage === "done").length, b: group.length }), group.every((y) => y.stage === "done") ? "ok" : "")
        : ui.tag(t(STAGE_LABEL[x.stage]), STAGE_TONE[x.stage])}<button class="btn quiet sm" data-close>${icon("x")}</button></div>
    ${x.progress > 0 && x.stage !== "done" ? `<div class="rowx" style="margin-bottom:12px"><div class="grow">${ui.progress(x.progress, "ai")}</div><span class="mono">${x.progress}%</span></div>` : ""}
    ${x.current_action && running ? `<div class="now" style="margin-bottom:12px">${esc(x.current_action)}</div>` : ""}
    ${x.blocked_reason ? `<p class="msg note" style="margin:0 0 12px">${esc(x.blocked_reason)}</p>` : ""}
    <div class="detail"><div class="stack">
      ${x.description ? `<p style="margin:0;white-space:pre-wrap">${esc(x.description)}</p>` : ""}
      ${x.goal ? `<p style="margin:0" class="dim"><b>${t("Objetivo")}:</b> ${esc(x.goal)}</p>` : ""}
      ${x.requirements?.length ? `<ul style="margin:0;padding-left:18px" class="dim">${x.requirements.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : ""}
      ${x.result ? `<div class="panel pad"><div class="ph-eyebrow">${t("Resultado")}</div><p style="margin:0;white-space:pre-wrap">${esc(x.result)}</p></div>` : ""}
      ${group ? `<div class="panel">${ui.sec("Quem já fez").replace('class="sec"', 'class="sec" style="margin:0;padding:12px var(--pad) 4px"')}
        <div class="who-list">${group.map((y) => `<div class="who-line ${y.stage === "done" ? "did" : ""}">${whoFace(y, "")}<div><b>${esc(nameOf(y.assignee))}${y.assignee === me.username ? ` <small>${t("tu")}</small>` : ""}</b>
          <span>${y.stage === "done" ? `${t("Feito")}${y.completed_at ? ` · ${fmt.day(y.completed_at)} ${fmt.hhmm(y.completed_at)}` : ""}${y.completed_by && y.completed_by !== y.assignee ? ` · ${t("por")} ${esc(nameOf(y.completed_by))}` : ""}`
            : esc(t(STAGE_LABEL[y.stage]))}</span></div></div>`).join("")}</div>
        <p class="faint" style="margin:0;padding:4px var(--pad) 12px;font-size:12px">${esc(whoLeft(group))}</p></div>` : ""}
      <div class="panel">${ui.sec("Histórico").replace('class="sec"', 'class="sec" style="margin:0;padding:12px var(--pad) 4px"')}
        <div class="hist">${(x.log || []).map((e) => `<div class="hist-row">${ui.avatar(e.name, "sm")}<div><b>${esc(e.name)}</b> ${esc(group && e.kind === "task_created" ? t("criou a tarefa para todos") : e.message)}
          <time>${fmt.day(e.at)} ${fmt.hhmm(e.at)}</time></div></div>`).join("") || `<p class="faint" style="margin:0">${t("Sem registo.")}</p>`}</div></div>
      <div class="panel">${ui.sec("Atividade").replace('class="sec"', 'class="sec" style="margin:0;padding:12px var(--pad) 4px"')}
        ${x.events.length ? `<div class="tl" style="padding-bottom:8px">${ui.feed(x.events.slice(-30).map((e) => ({ at: e.created_at, text: e.message,
          tone: e.kind === "error" ? "bad" : e.kind === "decision" ? "warn" : e.kind === "result" ? "ok" : "ai" })))}</div>`
          : `<p class="faint" style="margin:0;padding:6px var(--pad) 14px">${t("Ainda sem atividade.")}</p>`}</div>
    </div><div class="stack">
      <dl class="kv panel pad" style="grid-template-columns:104px minmax(0,1fr);margin:0">${kv.map(([k, v]) => `<dt>${t(k)}</dt><dd>${v}</dd>`).join("")}</dl>
      <div class="rowx" style="flex-wrap:wrap">
        ${canGiveToAI(x) ? ui.btn("Entregar à IA", "data-act=ai", "primary", "bot") : ""}
        ${running ? ui.btn("Pausar", "data-act=pause", "", "pause") + ui.btn("Parar", "data-act=stop", "danger", "stop") : ""}
        ${x.status === "PAUSED" || x.status === "NEEDS_HELP" ? ui.btn("Retomar", "data-act=resume", "", "play") + ui.btn("Parar", "data-act=stop", "danger", "stop") : ""}
        ${!held && x.stage !== "done" ? ui.btn("Concluir", "data-act=done", "ok", "check") : ""}
        ${ui.btn("Editar", "data-act=edit", "quiet")}</div>
      ${held ? "" : `<label class="field">${t("Mudar estado")}<select id="task-status">${options([["", "—"], ["TODO", t("Por fazer")], ["BLOCKED", t("Bloqueada")], ["REVIEW", t("Em revisão")], ["COMPLETED", t("Concluída")]], "")}</select></label>`}
      ${x.sessions.length ? `<div class="panel">${x.sessions.slice(0, 4).map((s) => `<div class="rw">${ui.status(s.status)}<div class="rw-main"><b class="mono">${fmt.tokens(s.tokens.total)} tokens</b>
        <span>${esc(s.model || "—")} · ${fmt.span(s.started_at, s.finished_at)}</span></div></div>`).join("")}</div>` : ""}
      ${x.approvals.length ? `<div class="panel">${x.approvals.slice(0, 4).map((a) => `<a class="rw" href="#/aprovacoes" data-close><div class="rw-main"><b>${esc(a.action)}</b>
        <span>${t({ PENDING: "pendente", APPROVED: "aprovado", REJECTED: "recusado" }[a.status])}</span></div></a>`).join("")}</div>` : ""}
    </div></div>`);
  $("modal-box").classList.add("wide");
  $("modal-box").onclick = async (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (!act) return;
    if (act === "ai") return assignToAI(x);
    if (act === "done") {
      try { await api(`/api/tasks/${x.id}`, { method: "PATCH", body: { status: "COMPLETED" } }); flash(t("Tarefa concluída.")); loadBoard(); openTaskModal(x.id); }
      catch (err) { flash(err.message); }
      return;
    }
    if (act === "edit") {
      const [users, projects] = await Promise.all([api("/api/users"), api("/api/projects")]);
      return formModal("Editar tarefa", taskFields(x, users, projects), async (v) => {
        const body = taskBody(v);
        if (held) delete body.assignee; // while the agent has it, the task stays where it is
        await api(`/api/tasks/${x.id}`, { method: "PATCH", body });
        loadBoard(); openTaskModal(x.id);
      }, { wide: true });
    }
    try { await api(`/api/tasks/${x.id}/control`, { method: "POST", body: { action: act } }); flash(t("Pedido enviado ao agente.")); }
    catch (err) { flash(err.message); }
  };
  if ($("task-status")) $("task-status").onchange = async (e) => {
    if (!e.target.value) return;
    const move = async (body) => { await api(`/api/tasks/${x.id}`, { method: "PATCH", body }); loadBoard(); openTaskModal(x.id); };
    if (e.target.value === "BLOCKED") return formModal("Marcar como bloqueada", field("O que está a bloquear?", '<textarea name="blocked_reason"></textarea>', true),
      (v) => move({ status: "BLOCKED", blocked_reason: v.blocked_reason }), { submit: "Bloquear" });
    try { await move({ status: e.target.value }); } catch (err) { flash(err.message); }
  };
}

HUB_VIEWS.tarefas = async function (r) {
  page(`${ui.head("Centro de comando", t("Tarefas"), t("Hoje, as próximas e as feitas. O quadro tem as colunas por estado, para arrastar cartões."),
    `<div class="segx" id="task-view">${[["lista", "Lista"], ["quadro", "Quadro"]].map(([v, l]) => `<button data-view="${v}" class="${v === taskView ? "on" : ""}">${t(l)}</button>`).join("")}</div>
    ${ui.btn("Nova tarefa", "data-new-task", "primary", "plus")}`)}
    <div class="chipbar" id="task-filter"></div><div class="board" id="board"></div><div class="bin" id="bin"></div>`);
  const view = $("view");
  view.onclick = (e) => {
    if (e.target.closest("[data-new-task]")) return newTask();
    if (e.target.closest("[data-bin-open]")) return openBin();
    const chip = e.target.closest("#task-filter [data-u]");
    if (chip) { taskFilter = chip.dataset.u; $("board")._html = null; return loadBoard(); }
    const coChip = e.target.closest("#task-filter [data-co]");
    if (coChip) { taskCoFilter = coChip.dataset.co; $("board")._html = null; return loadBoard(); }
    const viewBtn = e.target.closest("[data-view]");
    if (viewBtn) {
      taskView = viewBtn.dataset.view;
      try { localStorage.setItem("hub.taskView", taskView); } catch { /* private window: it just is not remembered */ }
      $("task-view").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === viewBtn));
      $("board")._html = null;
      return loadBoard();
    }
    if (e.target.closest("[data-older-feitas]")) { showOlderFeitas = !showOlderFeitas; return loadBoard(); }
    const tick = e.target.closest(".tl-row [data-done]");
    if (tick) {
      tick.disabled = true; tick.closest(".tl-row").classList.add("finishing");
      api(`/api/tasks/${tick.dataset.done}`, { method: "PATCH", body: { status: "COMPLETED" } }).then(() => flash(t("Tarefa concluída.")), (err) => flash(err.message)).finally(loadBoard);
      return;
    }
    const line = e.target.closest(".tl-row");
    if (line) return openTaskModal(Number(line.dataset.id));
    if (e.target.closest("[data-older-done]")) { showOlderDone = !showOlderDone; return loadBoard(); }
    const card = e.target.closest(".tk");
    if (card) openTaskModal(Number(card.dataset.id));
  };
  let dragged = null;
  const board = $("board"); // the listeners live on the board, so they go away with the page
  const bin = $("bin");
  board.addEventListener("dragstart", (e) => { dragged = e.target.closest(".tk"); dragged?.classList.add("dragging"); if (dragged) bin.classList.add("armed"); });
  board.addEventListener("dragend", () => {
    dragged?.classList.remove("dragging");
    bin.classList.remove("armed");
    view.querySelectorAll(".col.over, .bin-drop.over").forEach((c) => c.classList.remove("over"));
  });
  bin.addEventListener("dragover", (e) => {
    const drop = e.target.closest(".bin-drop");
    if (!dragged || !drop) return;
    e.preventDefault();
    bin.querySelectorAll(".bin-drop.over").forEach((d) => d !== drop && d.classList.remove("over"));
    drop.classList.add("over");
  });
  bin.addEventListener("dragleave", (e) => e.target.closest(".bin-drop")?.classList.remove("over"));
  bin.addEventListener("drop", async (e) => {
    const drop = e.target.closest(".bin-drop");
    if (!dragged || !drop) return;
    e.preventDefault();
    try { await trashTask(dragged.dataset.id, drop.dataset.reason); } catch (err) { flash(err.message); }
  });
  board.addEventListener("dragover", (e) => {
    const col = e.target.closest(".col");
    if (!dragged || !col) return;
    e.preventDefault();
    view.querySelectorAll(".col.over").forEach((c) => c !== col && c.classList.remove("over"));
    col.classList.add("over");
  });
  board.addEventListener("drop", async (e) => {
    const col = e.target.closest(".col");
    if (!dragged || !col) return;
    e.preventDefault();
    const status = HUMAN_STATUS[col.dataset.stage];
    if (!status) return flash(t("Em curso e Aprovação são estados do agente: entrega a tarefa à IA para ela lá chegar."));
    try { await api(`/api/tasks/${dragged.dataset.id}`, { method: "PATCH", body: { status } }); } catch (err) { flash(err.message); }
    loadBoard();
  });
  await loadBoard();
  const linked = Number(r.company) || openTask;
  if (linked) { openTask = null; openTaskModal(linked); }
};
onLive(["task", "tick"], loadBoard);

/* ================================================================ approvals */
// What the agent may do alone, what waits for a person, what is never allowed. This is the policy in
// agent/team_agent/permissions/policy.py, said in plain words.
const RULES = [["Ler ficheiros do workspace", "auto"], ["Escrever ficheiros do workspace", "auto"], ["Correr testes e lint", "auto"],
  ["git status, diff, add, commit, branch", "auto"], ["Apagar ficheiros", "ask"], ["Alterar configuração de produção ou segredos", "ask"],
  ["git push e ações remotas", "ask"], ["Deploy, publicar, release, migrações", "ask"], ["Instalar pacotes", "ask"],
  ["Qualquer outro comando", "ask"], ["Gastar dinheiro, publicar, mensagens externas", "ask"],
  ["Ler segredos, sair do workspace, comandos destrutivos", "never"]];
const RULE_LABEL = { auto: ["ok", "Automático"], ask: ["warn", "Aprovação"], never: ["bad", "Bloqueado"] };
const RISK = { low: "baixo", medium: "médio", high: "alto" };

function diffHtml(diff) {
  return `<pre class="diff">${diff.split("\n").map((line) => {
    const cls = line.startsWith("@@") ? "hunk" : line.startsWith("+") && !line.startsWith("+++") ? "add" : line.startsWith("-") && !line.startsWith("---") ? "del" : "";
    return cls ? `<span class="${cls}">${esc(line)}</span>` : esc(line) + "\n";
  }).join("")}</pre>`;
}

async function loadApprovalsPage() {
  if (!$("appr-pending")) return;
  let all = [];
  await mount($("appr-pending"), async () => {
    all = await api("/api/approvals");
    const pending = all.filter((a) => a.status === "PENDING");
    if (!pending.length) return `<div class="panel" style="grid-column:1/-1">${ui.empty("check", "Sem pedidos pendentes", "Quando um agente quiser fazer algo sensível, o pedido aparece aqui.")}</div>`;
    return pending.map((a) => `<article class="panel appr">
      <div class="rowx">${ui.avatar(a.user_name, "ai")}<div class="grow"><b>Claude / ${esc(a.user_name)}</b><div class="faint">${fmt.ago(a.created_at)}</div></div>
        ${a.risk ? ui.tag(`${t("Risco")} ${t(RISK[a.risk])}`, a.risk) : ui.tag(t("Risco não indicado"))}</div>
      <div><div class="ph-eyebrow">${t("Quer")}</div><h3>${esc(a.action)}</h3>${a.detail ? `<p class="dim" style="margin:4px 0 0">${esc(a.detail)}</p>` : ""}</div>
      ${a.files.length ? `<div class="files">${a.files.map((f) => `<code>${esc(f)}</code>`).join("")}</div>` : ""}
      <div class="rowx" style="flex-wrap:wrap">${a.diff ? `<button class="btn sm" data-diff="${a.id}">${t("Ver diff")}</button>` : ""}
        ${a.task_id ? `<a class="btn sm quiet" href="#/tarefas/${a.task_id}">${t("Ver tarefa")}</a>` : ""}<span class="grow"></span>
        ${me.lead ? `<button class="btn sm danger" data-decide="${a.id}" data-approve="0">${t("Recusar")}</button><button class="btn sm ok" data-decide="${a.id}" data-approve="1">${t("Aprovar")}</button>`
          : `<span class="faint">${t("Só o owner decide")}</span>`}</div></article>`).join("");
  }, 4);
  const decided = all.filter((a) => a.status !== "PENDING").slice(0, 25);
  paint($("appr-done"), decided.length ? `<div class="panel rows">${decided.map((a) => `<div class="rw"><span class="st ${a.status === "APPROVED" ? "ok" : "bad"}"><i></i></span>
    <div class="rw-main"><b>${esc(a.action)}</b><span>Claude / ${esc(a.user_name)} · ${t(a.status === "APPROVED" ? "aprovado" : "recusado")} ${fmt.ago(a.decided_at)}</span></div>
    ${a.risk ? ui.tag(t(RISK[a.risk]), a.risk) : ""}</div>`).join("")}</div>` : `<p class="faint">${t("Ainda nada foi decidido.")}</p>`);
  if (!$("appr-pending")) return; // the person moved to another page while this was loading
  $("appr-pending").onclick = async (e) => {
    const diff = e.target.closest("[data-diff]"), decide = e.target.closest("[data-decide]");
    if (diff) {
      const a = all.find((x) => x.id === Number(diff.dataset.diff));
      openModal(`<h3>${esc(a.action)}</h3>${diffHtml(a.diff)}<div class="form-foot"><button class="btn primary" data-close>${t("Fechar")}</button></div>`);
      $("modal-box").classList.add("wide");
    } else if (decide) {
      decide.disabled = true;
      try { await api(`/api/approvals/${decide.dataset.decide}/decide`, { method: "POST", body: { approve: decide.dataset.approve === "1" } }); }
      catch (err) { flash(err.message); }
      loadApprovalsPage();
    }
  };
}
HUB_VIEWS.aprovacoes = async function () {
  page(`${ui.head("Centro de comando", t("Aprovações"), t("O que os agentes pedem para fazer antes de o fazerem."))}
    <div class="cards" id="appr-pending" style="grid-template-columns:repeat(auto-fill,minmax(360px,1fr))"></div>
    ${ui.sec("Regras de permissão")}
    <div class="panel pad"><div class="rules">${RULES.map(([what, rule]) => `<div><span>${t(what)}</span>${ui.tag(t(RULE_LABEL[rule][1]), RULE_LABEL[rule][0])}</div>`).join("")}</div></div>
    ${ui.sec("Decididas")}<div id="appr-done"></div>`);
  await loadApprovalsPage();
};
onLive(["approval", "tick"], loadApprovalsPage);

/* ================================================================ agents */
const SUBAGENT_ROLES = [["research", "Pesquisa", "Lê o workspace e relata factos. Não altera nada."], ["coding", "Código", "Faz uma alteração concreta e diz que ficheiros mudou."],
  ["testing", "Testes", "Corre os testes ou o lint e relata o que falhou."], ["review", "Revisão", "Lê a alteração e aponta problemas antes de fechar."]];
const subName = (s) => SUBAGENT_ROLES.find(([id]) => id === s.role)?.[1] || s.name || s.role || "Subagente";
const subsHtml = (subs) => subs.map((s) => `<div class="sub">${ui.status(s.status, " ")}<b>${esc(t(subName(s)))}</b><span class="dim ell grow">${esc(s.task)}</span>
  <span class="mono faint">${s.total_tokens == null ? "" : fmt.tokens(s.total_tokens)}</span></div>`).join("");

async function loadAgentsPage() {
  await mount($("agents-grid"), async () => {
    const agents = await api("/api/agents");
    if (!agents.length) return ui.empty("bot", "Sem agentes", "Ainda não há ninguém na equipa.");
    return agents.map((a) => `<a class="panel hover agent-card" href="#/agentes/${esc(a.id)}">
      <div class="rowx">${ui.avatar(a.display_name, "ai")}<b class="grow ell">${esc(a.name)}</b>${ui.status(a.status)}</div>
      <dl class="kv" style="margin:0"><dt>${t("Projeto")}</dt><dd>${esc(a.project || "—")}</dd><dt>${t("Tarefa")}</dt><dd>${esc(a.task || "—")}</dd>
        <dt>${t("Modelo")}</dt><dd>${esc(a.session?.model || "—")}</dd>
        <dt>Tokens</dt><dd class="mono">${a.session ? fmt.tokens(a.session.tokens.total) : "—"}</dd>
        <dt>${t("Tempo")}</dt><dd>${a.session ? fmt.span(a.session.started_at) : a.status === "OFFLINE" ? t("visto {quando}", { quando: fmt.ago(a.last_seen) }) : "—"}</dd></dl>
      ${a.task ? ui.progress(a.progress, "ai") : ""}
      ${a.subagents.length ? `<div class="subs">${subsHtml(a.subagents)}</div>` : ""}</a>`).join("");
  }, 5);
}
HUB_VIEWS.agentes = async function (r) {
  if (r.company) return viewAgent(r.company);
  page(`${ui.head("Equipa", t("Agentes"), t("O agente local de cada pessoa, a sessão de IA que está a correr e os subagentes que ela lançou."))}
    <div class="cards" id="agents-grid"></div>
    ${ui.sec("Subagentes disponíveis")}
    <div class="cards">${SUBAGENT_ROLES.map(([, name, what]) => `<div class="panel pad"><div class="rowx" style="margin-bottom:6px">${icon("bot")}<b>${t(name)}</b></div>
      <p class="dim" style="margin:0">${t(what)}</p></div>`).join("")}</div>
    <p class="faint" style="margin-top:12px">${t("Um subagente só existe dentro de uma sessão: é o agente principal que decide lançá-lo. Usa as mesmas ferramentas e a mesma política de permissões.")}</p>`);
  await loadAgentsPage();
};

async function loadAgentDetail() {
  const el = $("agent-detail");
  if (!el) return;
  await mount(el, async () => {
    const a = await request_(`/api/agents/${el.dataset.user}`);
    const s = a.session, task = a.task_detail;
    const hidden = !me.lead && a.user !== me.username;
    const timeline = [...a.events.map((e) => ({ at: e.created_at, text: e.message, tone: e.kind === "error" ? "bad" : "ai" })),
      ...a.activity.map((x) => ({ at: x.created_at, text: x.message, tone: activityTone(x) }))].sort((x, y) => y.at.localeCompare(x.at)).slice(0, 40);
    return `${ui.head("Agente", a.name, "", `${ui.status(a.status)}
      ${a.task_id && ["WORKING", "WAITING"].includes(a.status) ? ui.btn("Pausar", "data-act=pause", "", "pause") + ui.btn("Parar", "data-act=stop", "danger", "stop") : ""}
      ${a.task_id && a.status === "PAUSED" ? ui.btn("Retomar", "data-act=resume", "", "play") + ui.btn("Parar", "data-act=stop", "danger", "stop") : ""}
      ${a.task_id ? `<a class="btn" href="#/tarefas/${a.task_id}">${t("Abrir tarefa")}</a>` : ""}`)}
    <div class="detail"><div class="stack">
      <div class="panel pad"><dl class="kv" style="margin:0;grid-template-columns:120px minmax(0,1fr)">
        <dt>${t("Projeto")}</dt><dd>${esc(a.project || "—")}</dd><dt>${t("Tarefa atual")}</dt><dd>${esc(a.task || "—")}</dd>
        <dt>${t("Modelo")}</dt><dd>${esc(s?.model || "—")}</dd><dt>${t("Sessão")}</dt><dd>${s ? fmt.span(s.started_at) : "—"}</dd>
        <dt>${t("Visto")}</dt><dd>${a.status === "OFFLINE" ? fmt.ago(a.last_seen) : t("agora")}</dd></dl>
        ${a.task ? `<div class="rowx" style="margin-top:12px"><div class="grow">${ui.progress(a.progress, "ai")}</div><span class="mono">${a.progress}%</span></div>` : ""}</div>
      <div class="panel pad"><div class="ph-eyebrow">${t("Ação atual")}</div>
        ${s?.current_action || a.current_action ? `<div class="now">${esc(s?.current_action || a.current_action)}</div>` : `<p class="faint" style="margin:0">${t(hidden ? "Só o próprio e o owner veem o que o agente está a fazer." : "O agente não está a fazer nada agora.")}</p>`}</div>
      <div class="panel">${ui.sec("Atividade").replace('class="sec"', 'class="sec" style="margin:0;padding:12px var(--pad) 4px"')}
        ${timeline.length ? `<div class="tl" style="padding-bottom:8px">${ui.feed(timeline)}</div>` : `<p class="faint" style="margin:0;padding:6px var(--pad) 14px">${t("Sem atividade registada.")}</p>`}</div>
    </div><div class="stack">
      <div class="panel pad"><div class="rowx" style="margin-bottom:10px"><div class="ph-eyebrow grow" style="margin:0">Tokens</div>${s ? ui.src("live") : ""}</div>
        ${s ? `<dl class="tok" style="margin:0"><dt>${t("Entrada")}</dt><dd>${fmt.int(s.tokens.input)}</dd><dt>${t("Saída")}</dt><dd>${fmt.int(s.tokens.output)}</dd>
          <dt>${t("Cache lida")}</dt><dd>${fmt.int(s.tokens.cache_read)}</dd><dt class="total">Total</dt><dd class="total">${fmt.int(s.tokens.total)}</dd></dl>
          <p class="faint" style="margin:10px 0 0">${t("{n} chamadas a ferramentas nesta sessão.", { n: s.tool_uses })}</p>`
          : `<p class="faint" style="margin:0">${t("Sem sessão de IA a correr.")}</p>`}</div>
      <div class="panel pad"><div class="ph-eyebrow">${t("Subagentes")}</div>
        ${a.subagents.length ? `<div class="subs">${subsHtml(a.subagents)}</div>` : `<p class="faint" style="margin:0">${t("Esta sessão não lançou subagentes.")}</p>`}</div>
      <div class="panel">${ui.sec("Sessões recentes").replace('class="sec"', 'class="sec" style="margin:0;padding:12px var(--pad) 4px"')}
        ${a.sessions.length ? a.sessions.slice(0, 8).map((x) => `<div class="rw">${ui.status(x.status)}<div class="rw-main"><b>${t({ task: "Tarefa", chat: "Pergunta no Hub", weekly_report: "Relatório semanal" }[x.kind] || x.kind)}${x.task_id ? ` #${x.task_id}` : ""}</b>
          <span>${fmt.day(x.started_at)} ${fmt.hhmm(x.started_at)} · ${fmt.span(x.started_at, x.finished_at)}${x.subagents.length ? ` · ${x.subagents.length} ${t("subagentes")}` : ""}</span></div>
          <span class="mono dim">${fmt.tokens(x.tokens.total)}</span></div>`).join("")
          : `<p class="faint" style="margin:0;padding:6px var(--pad) 14px">${t(hidden ? "Só o próprio e o owner veem as sessões." : "Ainda sem sessões registadas.")}</p>`}</div>
    </div></div>`;
  }, 6);
  el.onclick = async (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (!act) return;
    const a = await api(`/api/agents/${el.dataset.user}`);
    try { await api(`/api/tasks/${a.task_id}/control`, { method: "POST", body: { action: act } }); flash(t("Pedido enviado ao agente.")); } catch (err) { flash(err.message); }
  };
}
async function viewAgent(username) {
  page(`<p style="margin:0 0 10px"><a class="dim" href="#/agentes">← ${t("Agentes")}</a></p><div id="agent-detail" data-user="${esc(username)}"></div>`);
  await loadAgentDetail();
}
onLive(["presence", "session", "task", "tick"], async () => { if ($("agents-grid")) await loadAgentsPage(); await loadAgentDetail(); });

/* ================================================================ team */
HUB_VIEWS.equipa = async function () {
  page(`${ui.head("Equipa", t("Equipa"), t("Quem está cá, no que está a trabalhar e o que o agente de cada um está a fazer."),
    leadOnly(ui.btn("Adicionar pessoa", "id=add-user", "", "plus")))}<div class="cards" id="team-grid"></div>`);
  if ($("add-user")) $("add-user").onclick = addUser;
  await loadTeamPage();
};
async function loadTeamPage() {
  await mount($("team-grid"), async () => (await api("/api/agents")).map((a) => `<a class="panel hover agent-card" href="#/agentes/${esc(a.id)}">
    <div class="rowx">${ui.avatar(a.display_name, "lg")}<div class="grow"><b style="font-size:15px">${esc(a.display_name)}</b>
      <div>${ui.status(a.status === "OFFLINE" ? "OFFLINE" : "ONLINE")}</div></div></div>
    <dl class="kv" style="margin:0"><dt>${t("A trabalhar em")}</dt><dd>${esc(a.task || "—")}</dd>
      <dt>Claude</dt><dd>${ui.status(a.status)}</dd>
      <dt>${t("Visto")}</dt><dd>${a.status === "OFFLINE" ? fmt.ago(a.last_seen) : t("agora")}</dd></dl></a>`).join(""), 4);
}
onLive(["presence", "task", "tick"], async () => { if ($("team-grid")) await loadTeamPage(); });
function addUser() {
  formModal("Adicionar pessoa", field("Nome", '<input name="display_name" required placeholder="ex: David">')
    + field("Utilizador", '<input name="username" required pattern="[a-zA-Z0-9_]{2,30}" placeholder="ex: david">')
    + field("Palavra-passe (mín. 8)", '<input name="password" type="password" minlength="8" required>')
    + field("Papel", `<select name="role">${options([["member", t("Membro")], ["owner", "Owner"]], "member")}</select>`),
  async (v) => { await api("/api/users", { method: "POST", body: v }); flash(t("Pessoa criada. Já pode entrar.")); loadTeamPage(); }, { submit: "Criar" });
}

/* ================================================================ live and history */
const seenActivity = new Set();
let liveFirst = true;
async function loadLive() {
  const el = $("live-feed");
  if (!el) return;
  await mount(el, async () => {
    const items = (await api("/api/history?limit=120")).filter((a) => new Date(a.created_at).toDateString() === new Date().toDateString());
    const html = items.length ? `<div class="tl" style="padding:8px 0">${ui.feed(items.map((a) => activityItem(a, !liveFirst && !seenActivity.has(a.id))))}</div>`
      : ui.empty("pulse", "Sem atividade hoje", "O que as pessoas e os agentes fizerem aparece aqui no momento em que acontece.");
    items.forEach((a) => seenActivity.add(a.id));
    liveFirst = false;
    return html;
  }, 8);
  await mount($("live-agents"), async () => {
    const running = (await api("/api/agents")).filter((a) => a.status !== "OFFLINE");
    if (!running.length) return ui.empty("bot", "Ninguém online", "");
    return `<div class="rows">${running.map((a) => `<a class="rw" href="#/agentes/${esc(a.id)}">${ui.avatar(a.display_name, "ai")}
      <div class="rw-main"><b>${esc(a.name)}</b><span>${esc(a.session?.current_action || a.current_action || a.task || t("sem tarefa"))}</span></div>${ui.status(a.status)}</a>`).join("")}</div>`;
  });
}
HUB_VIEWS.aovivo = async function () {
  liveFirst = true;
  page(`${ui.head("Equipa", t("Ao vivo"), t("O que está a acontecer hoje, à medida que acontece."), `<span class="st busy"><i></i>${t("Em direto")}</span>`)}
    <div class="detail"><div class="panel" id="live-feed"></div><div class="stack"><div class="panel" id="live-agents"></div></div></div>`);
  await loadLive();
};
onLive(["activity", "task", "approval", "presence", "session", "tick"], loadLive);

let historyCat = "all";
const HISTORY_CATS = [["all", "Tudo"], ["people", "Pessoas"], ["ai", "IA"], ["tasks", "Tarefas"], ["code", "Código"], ["approvals", "Aprovações"], ["companies", "Empresas"]];
async function loadHistoryPage() {
  const el = $("history-feed");
  if (!el) return;
  paint($("history-cats"), HISTORY_CATS.map(([id, label]) => `<button class="chp ${id === historyCat ? "on" : ""}" data-c="${id}">${t(label)}</button>`).join(""));
  await mount(el, async () => {
    const [activity, commits] = await Promise.all([api("/api/history?limit=300"), api("/api/commits?limit=60").catch(() => [])]);
    const items = [...activity.map((a) => ({ ...activityItem(a), cats: [activityKind(a.kind), ...(a.company ? ["companies"] : [])] })),
      ...commits.map((c) => ({ at: c.date, who: c.author, text: `commit em ${c.repo}: ${c.message}`, tone: "", cats: ["code"] }))]
      .filter((i) => historyCat === "all" || i.cats.includes(historyCat)).sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 250);
    if (!items.length) return ui.empty("history", "Nada aqui", "Não há registos deste tipo.");
    let day = "";
    return items.map((i) => {
      const label = fmt.day(i.at), head = label !== day ? `<div class="dayh">${esc(label)}</div>` : "";
      day = label;
      return head + ui.feed([i]);
    }).join("");
  }, 8);
}
HUB_VIEWS.historico = async function () {
  page(`${ui.head("Trabalho", t("Histórico"), t("Uma só linha do tempo: pessoas, IA, tarefas, código e aprovações."))}
    <div class="chipbar" id="history-cats"></div><div class="panel" id="history-feed" style="padding-bottom:10px"></div>`);
  $("history-cats").onclick = (e) => { if (e.target.dataset.c) { historyCat = e.target.dataset.c; $("history-feed")._html = null; loadHistoryPage(); } };
  await loadHistoryPage();
};
onLive(["activity", "tick"], loadHistoryPage);

/* ================================================================ projects */
const PROJECT_ST = { active: ["ok", "Ativo"], maintenance: ["wait", "Manutenção"], paused: ["off", "Em pausa"], done: ["off", "Terminado"] };
const projectFields = (p = {}) => field("Nome", `<input name="name" required value="${esc(p.name || "")}">`, true)
  + field("Estado", `<select name="status">${options(Object.entries(PROJECT_ST).map(([k, v]) => [k, t(v[1])]), p.status || "active")}</select>`)
  + field("Empresa", `<select name="company">${options([["", t("Sem empresa")], ...companies.map((c) => [c.id, c.name])], p.company)}</select>`)
  + field("Repositório", `<input name="repo" value="${esc(p.repo || "")}" placeholder="${t("nome em library/repos.json")}">`, true)
  + field("Descrição", `<textarea name="description">${esc(p.description || "")}</textarea>`, true);
const projectBody = (v) => ({ ...v, company: v.company || null });
async function loadProjects() {
  await mount($("projects-grid"), async () => {
    const projects = await api("/api/projects");
    if (!projects.length) return `<div class="panel" style="grid-column:1/-1">${ui.empty("folder", "Sem projetos", "Um projeto junta tarefas, agentes e custo num só sítio.",
      leadOnly(`<button class="btn sm primary" data-new-project>${t("Novo projeto")}</button>`))}</div>`;
    return projects.map((p) => `<a class="panel hover agent-card" href="#/projetos/${p.id}">
      <div class="rowx"><b class="grow ell" style="font-size:15px">${esc(p.name)}</b><span class="st ${PROJECT_ST[p.status][0]}"><i></i>${t(PROJECT_ST[p.status][1])}</span></div>
      <p class="dim ell" style="margin:0">${esc(p.description || companies.find((c) => c.id === p.company)?.name || "")}&nbsp;</p>
      <div class="kpis"><div class="kpi"><b class="num sm">${p.open_tasks}</b><span>${t("tarefas abertas")}</span></div>
        <div class="kpi"><b class="num sm">${p.done_tasks}</b><span>${t("concluídas")}</span></div>
        <div class="kpi"><b class="num sm">${p.active_sessions}</b><span>${t("agentes ativos")}</span></div></div></a>`).join("");
  }, 4);
}
const newProject = () => formModal("Novo projeto", projectFields(), async (v) => { await api("/api/projects", { method: "POST", body: projectBody(v) }); loadProjects(); }, { submit: "Criar projeto" });
HUB_VIEWS.projetos = async function (r) {
  if (r.company) return viewProject(Number(r.company));
  page(`${ui.head("Trabalho", t("Projetos"), t("Cada projeto com as suas tarefas, os seus agentes e o seu custo."), leadOnly(ui.btn("Novo projeto", "data-new-project", "primary", "plus")))}
    <div class="cards" id="projects-grid"></div>`);
  $("view").onclick = (e) => { if (e.target.closest("[data-new-project]")) newProject(); };
  await loadProjects();
};
async function viewProject(id) {
  page(`<p style="margin:0 0 10px"><a class="dim" href="#/projetos">← ${t("Projetos")}</a></p><div id="project-detail"></div>`);
  await mount($("project-detail"), async () => {
    const p = await request_(`/api/projects/${id}`);
    return `${ui.head("Projeto", p.name, p.description, `<span class="st ${PROJECT_ST[p.status][0]}"><i></i>${t(PROJECT_ST[p.status][1])}</span>
      ${leadOnly(ui.btn("Editar", "data-edit-project", "quiet"))}${ui.btn("Nova tarefa", "data-new-task", "primary", "plus")}`)}
    <div class="stats"><div class="panel statc"><span>${t("Tarefas abertas")}</span>${ui.num(p.open_tasks)}</div>
      <div class="panel statc"><span>${t("Concluídas")}</span>${ui.num(p.done_tasks)}</div>
      <div class="panel statc"><span>${t("Agentes ativos")}</span>${ui.num(p.active_sessions)}</div>
      <div class="panel statc"><span>${t("Custo de IA")} ${p.ai_cost_usd == null ? "" : ui.src("estimated")}</span>${ui.num(p.ai_cost_usd == null ? null : fmt.usd(p.ai_cost_usd))}</div></div>
    ${ui.sec("Tarefas")}
    ${p.task_list.length ? `<div class="panel rows">${p.task_list.map((x) => `<a class="rw" href="#/tarefas/${x.id}">${ui.avatar(nameOf(x.assignee), "sm")}
      <div class="rw-main"><b>${esc(x.title)}</b><span>${esc(nameOf(x.assignee))}</span></div>${ui.tag(t(STAGE_LABEL[x.stage]), STAGE_TONE[x.stage])}</a>`).join("")}</div>`
      : `<div class="panel">${ui.empty("tasks", "Sem tarefas", "Este projeto ainda não tem tarefas.")}</div>`}`;
  }, 6);
  $("view").onclick = async (e) => {
    if (e.target.closest("[data-new-task]")) return newTask({ project_id: id });
    if (!e.target.closest("[data-edit-project]")) return;
    const p = await request_(`/api/projects/${id}`);
    formModal("Editar projeto", projectFields(p), async (v) => { await api(`/api/projects/${id}`, { method: "PATCH", body: projectBody(v) }); viewProject(id); });
  };
}

/* ================================================================ analytics, AI usage, expenses */
let analyticsDays = 7;
const barRows = (rows, total) => (rows.length ? `<div class="bars">${rows.map((r) => `<div class="bar-row"><span class="ell">${esc(r.name || r.title)}</span>
  ${ui.progress(total ? (r.cost_usd / total) * 100 : 0)}<span>${fmt.usd(r.cost_usd)}</span></div>`).join("")}</div>` : `<p class="faint" style="margin:0">${t("Sem dados")}</p>`);
const statCard = (label, value, source) => `<div class="panel statc"><span>${t(label)}</span>${ui.num(value)}${source ? ui.src(source) : ""}</div>`;
// Who did most, today and this week: commits and lines from git, tasks completed and AI sessions from the Hub.
async function loadRanking() {
  await mount($("ranking"), async () => {
    const r = await api("/api/analytics/ranking");
    const board = (title, people) => {
      const top = Math.max(1, ...people.map((p) => p.commits));
      const any = people.some((p) => p.commits || p.tasks_done || p.sessions);
      return `<div class="panel rank"><div class="rank-head">${t(title)}</div>${people.map((p, i) => `<div class="rank-row ${i === 0 && any ? "first" : ""}">
        <span class="rank-pos">${any ? i + 1 : "–"}</span>${ui.avatar(p.name)}
        <div class="rw-main"><b>${esc(p.name)}</b>
          <div class="rank-bar"><i style="width:${Math.round(p.commits / top * 100)}%"></i></div>
          <span>${t("{n} tarefas concluídas", { n: p.tasks_done })} · ${t("{n} sessões de IA", { n: p.sessions })} · +${p.added} −${p.deleted}</span></div>
        <div class="rank-n"><b>${p.commits}</b><small>commits</small></div></div>`).join("")}</div>`;
    };
    return `${ui.sec("Quem fez mais", ui.src(r.source))}<div class="rank-grid">${board("Hoje", r.today)}${board("Esta semana", r.week)}</div>`;
  }, 4);
}
onLive(["activity", "task"], async () => { if ($("ranking")) await loadRanking(); });

// A number with a line under it that says what it means: who, how much of what, compared with what.
const statNote = (label, value, note = "") => `<div class="panel statc"><span>${t(label)}</span>${ui.num(value)}${note ? `<small class="statc-n">${esc(note)}</small>` : ""}</div>`;
// The folders of the repository in the team's words: nobody here says "backend".
const CODE_AREA = { frontend: "Páginas do Hub", backend: "Motor do Hub", widget: "Widget", agent: "Agente de IA", library: "Biblioteca", scripts: "Instalação", docs: "Documentação" };
const CODE_KIND = [["design", "Design"], ["photo", "Fotos"], ["text", "Textos"], ["code", "Código"]];

// "Código" for people who do not read code: how many changes went out, the last one, where they landed and of what kind.
function codeHtml(commits, days, source) {
  if (!commits) return `${ui.sec("Alterações ao Hub e ao widget", ui.src("not_connected"))}<p class="faint">${t("Sem acesso ao repositório neste computador.")}</p>`;
  const since = Date.now() - days * 864e5, list = commits.filter((c) => new Date(c.date) >= since);
  const areas = {}, kinds = {}, authors = {};
  for (const c of list) {
    authors[c.author] = (authors[c.author] || 0) + 1;
    for (const a of c.areas || []) areas[CODE_AREA[a.name] || "Outros"] = (areas[CODE_AREA[a.name] || "Outros"] || 0) + a.files;
    for (const [k, v] of Object.entries(c.kinds || {})) kinds[k] = (kinds[k] || 0) + v.files;
  }
  const files = Object.values(areas).reduce((n, v) => n + v, 0), last = list[0];
  const bars = (rows) => { const top = Math.max(1, ...rows.map((r) => r[1])); return rows.length ? `<div class="cd-bars">${rows.map(([name, n]) =>
    `<div><span>${esc(t(name))}</span><i><u style="width:${n / top * 100}%"></u></i><b>${n}</b></div>`).join("")}</div>` : `<p class="faint" style="margin:0">${t("Sem alterações neste período.")}</p>`; };
  const who = Object.entries(authors).sort((a, b) => b[1] - a[1]).map(([name, n]) => `${name.split(" ")[0]} ${n}`).join(" · ");
  return `${ui.sec("Alterações ao Hub e ao widget", `<a class="ch-link" href="#/entregas">${t("Ver cada uma")}${icon("chevron")}</a>`)}
    <div class="stats">${statNote("Alterações enviadas", list.length, who || t("ninguém enviou nada"))}
      ${statNote("Por dia", list.length ? (list.length / days).toFixed(1).replace(".", ",") : 0, t("em média, nos últimos {n} dias", { n: days }))}
      ${statNote("Ficheiros mexidos", files, t("somando todas as alterações"))}</div>
    ${last ? `<a class="panel cd-last" href="#/entregas"><span>${t("Última alteração")}</span><b>${esc(last.message)}</b><em>${esc(last.author)} · ${fmt.ago(last.date)}</em></a>` : ""}
    <div class="cd-two"><div class="panel pad"><div class="ph-eyebrow">${t("Onde se mexeu")}</div>${bars(Object.entries(areas).sort((a, b) => b[1] - a[1]))}</div>
      <div class="panel pad"><div class="ph-eyebrow">${t("De que tipo")}</div>${bars(CODE_KIND.filter(([k]) => kinds[k]).map(([k, label]) => [label, kinds[k]]))}</div></div>
    ${commits.length >= 100 && list.length === commits.length ? `<p class="faint" style="margin-top:10px">${t("Só se veem as 100 alterações mais recentes: num período longo há mais do que estas.")}</p>` : ""}`;
}

async function loadAnalytics() {
  await mount($("analytics"), async () => {
    const [a, team, tasks, commits] = await Promise.all([api(`/api/analytics?days=${analyticsDays}`), api("/api/team").catch(() => []), api("/api/tasks").catch(() => []),
      api("/api/commits?limit=100").catch(() => null)]);
    const online = team.filter((m) => m.status !== "OFFLINE").map((m) => m.display_name);
    const open = tasks.filter((x) => x.stage !== "done"), urgent = open.filter((x) => x.priority === "urgent").length;
    const carrying = team.map((m) => [m.display_name, open.filter((x) => x.assignee === m.user).length]).filter(([, n]) => n).sort((x, y) => y[1] - x[1]).map(([name, n]) => `${name} ${n}`).join(" · ");
    const period = t("nos últimos {n} dias", { n: analyticsDays });
    const hours = a.ai.ai_seconds ? (a.ai.ai_seconds / 3600).toFixed(1) + " h" : null;
    return `${ui.sec("Equipa", ui.src(a.team.source))}<div class="stats">
        ${statNote("Pessoas online", `${a.team.active_users}/${a.team.people}`, online.length ? online.join(", ") : t("ninguém agora"))}
        ${statNote("Tarefas criadas", a.team.tasks_created, period)}
        ${statNote("Tarefas concluídas", a.team.tasks_completed, a.team.tasks_created ? t("{n}% das criadas no período", { n: Math.round(a.team.tasks_completed / a.team.tasks_created * 100) }) : period)}
        ${statNote("Tarefas por fazer", a.team.tasks_open, `${carrying || t("nenhuma")}${urgent ? ` · ${t(urgent === 1 ? "1 urgente" : "{n} urgentes", { n: urgent })}` : ""}`)}
        ${a.team.active_sessions ? statNote("IA a trabalhar agora", a.team.active_sessions, t("sessões abertas")) : ""}
        ${a.team.approvals ? statNote("À espera de aprovação", a.team.approvals, t("pedidos da IA por decidir")) : ""}</div>
      ${a.ai.sessions || a.ai.runs ? `${ui.sec("Uso de IA", ui.src(a.ai.source))}<div class="stats">
        ${statCard("Sessões", a.ai.sessions || null)}${statCard("Tokens de entrada", a.ai.runs ? fmt.tokens(a.ai.tokens.input) : null)}
        ${statCard("Tokens de saída", a.ai.runs ? fmt.tokens(a.ai.tokens.output) : null)}${statCard("Agentes", a.ai.agents || null)}
        ${statCard("Subagentes", a.ai.sessions ? a.ai.subagents : null)}${statCard("Chamadas a ferramentas", a.ai.sessions ? a.ai.tool_uses : null)}
        ${statCard("Tempo de trabalho da IA", hours)}</div>
      ${a.ai.models.length ? `<div class="panel" style="margin-top:10px"><table class="tbl"><tr><th>${t("Modelo")}</th><th class="r">${t("Sessões")}</th><th class="r">Tokens</th></tr>
        ${a.ai.models.map((m) => `<tr><td>${esc(m.model)}</td><td class="r">${m.sessions}</td><td class="r mono">${fmt.tokens(m.tokens)}</td></tr>`).join("")}</table></div>` : ""}` : ""}
      ${a.cost.total_usd != null ? `${ui.sec("Custo", ui.src(a.cost.source))}
      <div class="detail"><div class="stack"><div class="panel pad"><div class="ph-eyebrow">${t("Por pessoa")}</div>${barRows(a.cost.per_user, a.cost.total_usd)}</div>
        <div class="panel pad"><div class="ph-eyebrow">${t("Por tarefa")}</div>${barRows(a.cost.per_task, a.cost.total_usd)}</div></div>
        <div class="stack">${statCard("Custo total de IA", a.cost.total_usd == null ? null : fmt.usd(a.cost.total_usd))}
        <div class="panel pad"><div class="ph-eyebrow">${t("Por projeto")}</div>${barRows(a.cost.per_project, a.cost.total_usd)}</div></div></div>` : ""}
      ${codeHtml(commits, analyticsDays)}
      ${a.value.cost_per_task.usd != null || a.value.cost_per_commit.usd != null ? `${ui.sec("Valor")}<div class="stats">
        ${statCard("Custo por tarefa concluída", a.value.cost_per_task.usd == null ? null : fmt.usd(a.value.cost_per_task.usd), a.value.cost_per_task.source)}
        ${statCard("Custo por commit", a.value.cost_per_commit.usd == null ? null : fmt.usd(a.value.cost_per_commit.usd), a.value.cost_per_commit.source)}</div>
      <p class="faint" style="margin-top:14px">${t("O custo é a estimativa que o SDK do Claude dá em cada sessão; não é uma fatura.")}</p>` : ""}`;
  }, 8);
}
/* ---------- Análise: what asks for attention, who carries what, and whether we close more than we open.
   The page used to be counters (commits, lines, people online) that nobody could act on. Those are still there, folded
   at the bottom; on top is what a person, or a Claude given the summary, can do something about. ---------- */
const AN_DAY = 864e5;
const anSpan = (ms) => (ms < 36e5 ? `${Math.max(1, Math.round(ms / 6e4))} min` : ms < AN_DAY ? `${Math.round(ms / 36e5)} h` : `${Math.round(ms / AN_DAY)} ${Math.round(ms / AN_DAY) === 1 ? "dia" : "dias"}`);
const anClock = (epoch) => new Date(epoch * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const anList = (names) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`);

function analysisOf(tasks, team, limits, clocks, commits, days, now = new Date()) {
  const since = new Date(now - days * AN_DAY);
  const open = tasks.filter((x) => x.stage !== "done");
  const done = tasks.filter((x) => x.stage === "done" && x.completed_at && new Date(x.completed_at) >= since);
  const made = tasks.filter((x) => new Date(x.created_at) >= since);
  const people = team.map((m) => ({ user: m.user, name: m.display_name, online: m.status !== "OFFLINE", task: m.task,
    open: open.filter((x) => x.assignee === m.user), done: done.filter((x) => (x.completed_by || x.assignee) === m.user),
    lim: limits[m.user] || null, clock: clocks.find((c) => c.user === m.user) || null, commits: commits.find((c) => c.name === m.display_name)?.commits ?? null }));
  const times = done.map((x) => new Date(x.completed_at) - new Date(x.created_at)).sort((a, b) => a - b);
  const shown = Math.min(days, 30);
  // each day: what was created, what was closed, and how many were open when the day ended (the line of the chart)
  const perDay = [...Array(shown)].map((_, i) => {
    const from = startOfDay(now, i - shown + 1), to = startOfDay(from, 1), within = (at) => at && new Date(at) >= from && new Date(at) < to;
    return { from, today: i === shown - 1, made: tasks.filter((x) => within(x.created_at)).length, done: tasks.filter((x) => x.stage === "done" && within(x.completed_at)).length,
      open: tasks.filter((x) => new Date(x.created_at) < to && !(x.stage === "done" && x.completed_at && new Date(x.completed_at) < to)).length };
  });
  // what somebody should look at, the worst first; `step` is what to do about it
  const alerts = [];
  const late = open.filter((x) => x.deadline && new Date(x.deadline) < now).sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
  for (const x of late.slice(0, 3)) alerts.push({ tone: "bad", what: `Atrasada há ${anSpan(now - new Date(x.deadline))}`, text: x.title, who: nameOf(x.assignee), href: `#/tarefas/${x.id}`,
    step: `${nameOf(x.assignee)}: fechar ou dar novo prazo a «${x.title}».` });
  for (const x of open.filter((y) => y.priority === "urgent" && !late.includes(y)).slice(0, 3)) alerts.push({ tone: "bad", what: "Urgente e por fazer", text: x.title, who: nameOf(x.assignee), href: `#/tarefas/${x.id}`,
    step: `${nameOf(x.assignee)}: começar por «${x.title}», que é urgente.` });
  for (const x of open.filter((y) => y.stage === "blocked").slice(0, 3)) alerts.push({ tone: "warn", what: "Bloqueada", text: x.title, who: nameOf(x.assignee), href: `#/tarefas/${x.id}`,
    step: `Desbloquear «${x.title}» (${nameOf(x.assignee)}).` });
  const heavy = [...people].sort((a, b) => b.open.length - a.open.length)[0];
  const rest = people.filter((p) => p !== heavy), restAvg = rest.length ? rest.reduce((n, p) => n + p.open.length, 0) / rest.length : 0;
  if (heavy && heavy.open.length >= 6 && heavy.open.length >= 2 * Math.max(1, restAvg)) alerts.push({ tone: "warn", what: "Carga desigual",
    text: `${heavy.name} tem ${heavy.open.length} tarefas abertas; ${rest.map((p) => `${p.name} ${p.open.length}`).join(", ")}`, who: heavy.name, href: "#/tarefas",
    step: `Repartir a carga: passar tarefas de ${heavy.name} (${heavy.open.length}) para ${anList(rest.map((p) => p.name))}.` });
  for (const p of people) {
    const until = (reset, week) => (reset ? ` até ${week ? `${new Date(reset * 1000).toLocaleDateString("pt-PT", { weekday: "long" })} às ` : "às "}${anClock(reset)}` : "");
    if (p.lim?.week >= 85) alerts.push({ tone: "bad", what: "Claude quase no limite", text: `${p.name} usou ${p.lim.week}% da semana`, who: p.name, href: "",
      step: `${p.name}: poupar o Claude${until(p.lim.week_reset, true)}; o trabalho pesado de IA passa para quem tem folga.` });
    else if (p.lim?.five >= 85) alerts.push({ tone: "warn", what: "Claude quase no limite", text: `${p.name} usou ${p.lim.five}% da sessão de 5 horas`, who: p.name, href: "",
      step: `${p.name}: esperar pela sessão nova${until(p.lim.five_reset)} antes de pedir trabalho grande ao Claude.` });
  }
  const stale = open.filter((x) => now - new Date(x.created_at) > 3 * AN_DAY && x.priority !== "urgent" && !late.includes(x)).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  for (const x of stale.slice(0, 3)) alerts.push({ tone: "", what: `Parada há ${anSpan(now - new Date(x.created_at))}`, text: x.title, who: nameOf(x.assignee), href: `#/tarefas/${x.id}`,
    step: `Decidir sobre «${x.title}»: fazer esta semana ou apagar.` });
  return { days, open, done, made, people, perDay, alerts, median: times.length ? times[Math.floor(times.length / 2)] : null };
}

// The analysis as a short brief: one sentence a person, what to do next, and the rhythm. `analysisText` is the same brief
// in plain text, to paste into a Claude that is about to work for the team.
function briefOf(a, now = new Date()) {
  const person = (p) => {
    const urgent = p.open.filter((x) => x.priority === "urgent").length;
    const bits = [p.open.length ? `${p.open.length} ${p.open.length === 1 ? "tarefa aberta" : "tarefas abertas"}${urgent ? ` (${urgent} ${urgent === 1 ? "urgente" : "urgentes"})` : ""}` : "sem tarefas abertas",
      `${p.done.length} ${p.done.length === 1 ? "concluída" : "concluídas"}`,
      p.clock?.at ? `${pontoWorked(p.clock)} de ponto hoje${p.clock.running ? "" : " (parado)"}` : "sem ponto hoje",
      p.lim ? `Claude a ${p.lim.five ?? "?"}% da sessão e ${p.lim.week ?? "?"}% da semana` : "Claude sem leitura"];
    return { name: p.name, line: `${bits.join("; ")}${p.online ? "" : "; offline"}.` };
  };
  const balance = a.done.length - a.made.length;
  return { title: `Estado da equipa em ${now.toLocaleDateString("pt-PT", { day: "numeric", month: "long" })}, ${fmt.hhmm(now.toISOString())}`, period: `últimos ${a.days} dias`,
    people: a.people.map(person), steps: a.alerts.map((x) => x.step),
    rhythm: `Em ${a.days} dias criaram-se ${a.made.length} tarefas e concluíram-se ${a.done.length}: ${balance >= 0 ? "fecha-se mais do que se abre" : `ficam mais ${-balance} por fazer do que havia`}. `
      + `Há ${a.open.length} abertas ao todo${a.median == null ? "." : ` e uma tarefa leva tipicamente ${anSpan(a.median)} a ser concluída.`}` };
}
const analysisText = (b) => [`${b.title} (${b.period})`, "", ...b.people.map((p) => `${p.name}: ${p.line}`), "",
  b.steps.length ? "O que fazer a seguir:" : "Nada a pedir atenção.", ...b.steps.map((x, i) => `${i + 1}. ${x}`), "", b.rhythm].join("\n");

// The chart of the rhythm: bars for what each day created and closed, a line for what was left open when the day ended.
function rhythmChart(days) {
  const W = 760, H = 230, left = 34, right = 16, top = 26, bottom = 34, innerW = W - left - right, innerH = H - top - bottom;
  const maxBar = Math.max(1, ...days.map((d) => Math.max(d.made, d.done))), maxOpen = Math.max(1, ...days.map((d) => d.open));
  const slot = innerW / days.length, bar = Math.min(18, slot * 0.28), every = Math.ceil(days.length / 10);
  const y = (n, max) => top + innerH - (n / max) * innerH, cx = (i) => left + slot * (i + 0.5);
  const grid = [0, 0.5, 1].map((k) => `<line x1="${left}" x2="${W - right}" y1="${top + innerH * (1 - k)}" y2="${top + innerH * (1 - k)}" class="g"/>
    <text x="${left - 8}" y="${top + innerH * (1 - k) + 3.5}" class="ax" text-anchor="end">${Math.round(maxBar * k)}</text>`).join("");
  const bars = days.map((d, i) => {
    const label = `${d.from.toLocaleDateString("pt-PT", { weekday: "long", day: "numeric", month: "long" })}: ${d.made} criadas, ${d.done} concluídas, ${d.open} abertas no fim do dia`;
    const one = (n, cls, dx) => (n ? `<rect class="${cls}" x="${cx(i) + dx}" y="${y(n, maxBar)}" width="${bar}" height="${top + innerH - y(n, maxBar)}" rx="3"/>
      ${days.length <= 14 ? `<text class="v ${cls}" x="${cx(i) + dx + bar / 2}" y="${y(n, maxBar) - 5}" text-anchor="middle">${n}</text>` : ""}` : "");
    return `<g><title>${esc(label)}</title><rect x="${left + slot * i}" y="${top}" width="${slot}" height="${innerH}" class="${d.today ? "now" : "hit"}"/>
      ${one(d.made, "made", -bar - 1.5)}${one(d.done, "done", 1.5)}
      ${i % every === 0 || d.today ? `<text class="ax ${d.today ? "on" : ""}" x="${cx(i)}" y="${H - 14}" text-anchor="middle">${d.today ? "hoje" : `${d.from.toLocaleDateString("pt-PT", { weekday: "short" }).replace(".", "")} ${d.from.getDate()}`}</text>` : ""}</g>`;
  }).join("");
  const points = days.map((d, i) => `${cx(i)},${y(d.open, maxOpen)}`).join(" ");
  const last = days[days.length - 1];
  return `<svg class="an-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Tarefas criadas, concluídas e abertas por dia">${grid}${bars}
    <polyline class="open" points="${points}"/>${days.map((d, i) => `<circle class="open" cx="${cx(i)}" cy="${y(d.open, maxOpen)}" r="${d.today ? 4 : 2.5}"/>`).join("")}
    <text class="v open" x="${cx(days.length - 1)}" y="${y(last.open, maxOpen) - 10}" text-anchor="middle">${last.open}</text></svg>`;
}

function analysisHtml(a) {
  const brief = briefOf(a), balance = a.done.length - a.made.length;
  const person = (p) => {
    const urgent = p.open.filter((x) => x.priority === "urgent").length, total = p.open.length + p.done.length;
    const fact = (n, label, cls = "") => `<div class="an-fact ${cls}"><b>${n}</b><span>${t(label)}</span></div>`;
    return `<div class="panel an-person ${p.online ? "" : "off"}"><header>${ui.avatar(p.name)}<div><b>${esc(p.name)}</b><span>${esc(p.online ? (p.task ? `${t("A trabalhar")}: ${p.task}` : t("Online")) : t("Offline"))}</span></div></header>
      <div class="an-split" title="${t("Concluídas e abertas")}"><i style="width:${total ? p.done.length / total * 100 : 0}%"></i></div>
      <div class="an-facts">${fact(p.open.length, "abertas", urgent ? "bad" : "")}${fact(p.done.length, "concluídas")}${fact(p.commits ?? "—", "commits na semana")}
        ${fact(p.clock?.at ? pontoWorked(p.clock) : "—", "ponto hoje", p.clock?.running ? "ok" : "")}${fact(p.lim?.five == null ? "—" : `${p.lim.five}%`, "Claude 5 h", p.lim?.five >= 85 ? "bad" : "")}${fact(p.lim?.week == null ? "—" : `${p.lim.week}%`, "Claude semana", p.lim?.week >= 85 ? "bad" : "")}</div>
      ${urgent ? `<p class="an-note bad">${t(urgent === 1 ? "1 urgente por fazer" : "{n} urgentes por fazer", { n: urgent })}</p>` : ""}</div>`;
  };
  return `${ui.sec("O que pede atenção", `<span class="faint">${a.alerts.length || t("nada")}</span>`)}
    ${a.alerts.length ? `<div class="panel rows">${a.alerts.map((x) => `<a class="rw an-alert ${x.tone}" ${x.href ? `href="${x.href}"` : ""}><i></i><div class="rw-main"><b>${esc(x.text)}</b><span>${esc(t(x.what))}${x.who && !x.text.startsWith(x.who) ? ` · ${esc(x.who)}` : ""}</span></div>${x.href ? icon("chevron") : ""}</a>`).join("")}</div>`
      : `<div class="panel pad an-fine">${icon("check")}<div><b>${t("Nada a pedir atenção")}</b><span>${t("Sem atrasos, sem urgentes por fazer, sem ninguém sobrecarregado.")}</span></div></div>`}
    ${ui.sec("Carga de cada pessoa", `<span class="faint">${t("últimos {n} dias", { n: a.days })}</span>`)}<div class="an-people">${a.people.map(person).join("")}</div>
    ${ui.sec("Ritmo", `<span class="faint">${t(balance >= 0 ? "fecha-se mais do que se abre" : "abre-se mais do que se fecha")}</span>`)}
    <div class="panel pad an-rhythm"><div class="an-nums"><div><b>${a.made.length}</b><span>${t("criadas")}</span></div><div class="ok"><b>${a.done.length}</b><span>${t("concluídas")}</span></div>
        <div><b>${a.open.length}</b><span>${t("abertas agora")}</span></div><div><b>${a.median == null ? "—" : anSpan(a.median)}</b><span>${t("até concluir (típico)")}</span></div>
        <p class="an-key"><i class="made"></i>${t("criadas no dia")}<i class="done"></i>${t("concluídas no dia")}<i class="open"></i>${t("abertas no fim do dia")}</p></div>
      ${rhythmChart(a.perDay)}</div>
    ${ui.sec("Resumo", `<button class="btn sm quiet" id="an-copy">${icon("doc")}${t("Copiar como texto")}</button>`)}
    <div class="panel an-brief"><header><b>${esc(brief.title)}</b><span>${esc(brief.period)}</span></header>
      <div class="an-brief-people">${brief.people.map((p) => `<div>${ui.avatar(p.name, "sm")}<p><b>${esc(p.name)}</b>${esc(p.line)}</p></div>`).join("")}</div>
      <h5>${t(brief.steps.length ? "O que fazer a seguir" : "Nada a pedir atenção")}</h5>
      ${brief.steps.length ? `<ol>${brief.steps.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>` : ""}
      <h5>${t("Ritmo")}</h5><p>${esc(brief.rhythm)}</p>
      <pre id="an-text" hidden>${esc(analysisText(brief))}</pre>
      <footer>${t("«Copiar como texto» leva isto para colar numa conversa com o Claude antes de lhe pedir trabalho.")}</footer></div>`;
}

async function loadAnalysis() {
  await mount($("an-main"), async () => {
    const [tasks, team, limits, board, rank] = await Promise.all([api("/api/tasks"), api("/api/team"), api("/api/limits/team").catch(() => ({})),
      api("/api/ponto").catch(() => null), api("/api/analytics/ranking").catch(() => null)]);
    return analysisHtml(analysisOf(tasks, team, limits, board?.people || [], rank?.week || [], analyticsDays));
  }, 8);
  if ($("an-copy")) $("an-copy").onclick = async () => {
    const text = $("an-text").textContent;
    try { await navigator.clipboard.writeText(text); flash(t("Resumo copiado.")); }
    catch { $("an-text").hidden = false; const r = document.createRange(); r.selectNodeContents($("an-text")); getSelection().removeAllRanges(); getSelection().addRange(r); flash(t("Selecionado: Ctrl+C para copiar.")); }
  };
}
onLive(["task", "ponto"], async () => { if ($("an-more")?.open) { $("an-main")._html = null; await loadAnalysis(); } });

HUB_VIEWS.analise = async function () {
  // The page is the one the team knows: who did most, the team's numbers, the code. The newer reading of the same data
  // (attention, load, rhythm, summary) is folded at the bottom, for whoever wants it.
  page(`${ui.head("Análise", t("Análise"), t("Quem fez o quê, a equipa e o código."),
    `<div class="segx" id="days">${[7, 30, 90].map((d) => `<button data-d="${d}" class="${d === analyticsDays ? "on" : ""}">${d} ${t("dias")}</button>`).join("")}</div>`)}
    <div id="ranking"></div><div id="analytics"></div>
    <details class="an-more" id="an-more"><summary>${t("Atenção, carga de cada um, ritmo e resumo")}</summary><div id="an-main"></div></details>`);
  loadRanking();
  $("an-more").ontoggle = () => { if ($("an-more").open) loadAnalysis(); };
  $("days").onclick = (e) => {
    if (!e.target.dataset.d) return;
    analyticsDays = Number(e.target.dataset.d);
    $("days").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === e.target));
    $("analytics")._html = null; loadAnalytics();
    if ($("an-more").open) { $("an-main")._html = null; loadAnalysis(); }
  };
  await loadAnalytics();
};

async function loadUsagePage() {
  await mount($("usage-page"), async () => {
    const [summary, users, sessions] = await Promise.all([api("/api/usage/summary"), api("/api/usage"), api("/api/sessions?limit=25")]);
    return `<div class="stats">${statCard("Tokens · 7 dias", summary.runs ? fmt.tokens(summary.input_tokens + summary.output_tokens) : null, summary.source)}
        ${statCard("Custo · 7 dias", summary.cost_usd == null ? null : fmt.usd(summary.cost_usd), summary.cost_source)}
        ${statCard("Sessões · 7 dias", summary.runs || null)}</div>
      ${ui.sec("Por pessoa (desde sempre)")}
      ${users.length ? `<div class="panel"><table class="tbl"><tr><th>${t("Pessoa")}</th><th class="r">${t("Sessões")}</th><th class="r">${t("Entrada")}</th><th class="r">${t("Saída")}</th><th class="r">${t("Custo")} ≈</th></tr>
        ${users.map((u) => `<tr><td>${esc(nameOf(u.user))}</td><td class="r">${u.runs}</td><td class="r mono">${fmt.tokens(u.input_tokens)}</td><td class="r mono">${fmt.tokens(u.output_tokens)}</td><td class="r mono">${fmt.usd(u.cost_usd)}</td></tr>`).join("")}</table></div>`
        : `<div class="panel">${ui.empty("token", "Sem uso registado", "Quando um agente correr uma sessão, os tokens aparecem aqui.")}</div>`}
      ${ui.sec("Sessões recentes")}
      ${sessions.length ? `<div class="panel rows">${sessions.map((s) => `<a class="rw" href="#/agentes/${esc(s.user)}">${ui.status(s.status)}
        <div class="rw-main"><b>Claude / ${esc(s.user_name)}${s.task_id ? ` · #${s.task_id}` : ""}</b><span>${esc(s.model || "—")} · ${fmt.day(s.started_at)} ${fmt.hhmm(s.started_at)} · ${fmt.span(s.started_at, s.finished_at)}</span></div>
        <span class="mono dim">${fmt.tokens(s.tokens.total)}</span><span class="mono" style="width:64px;text-align:right">${s.cost_usd == null ? "—" : fmt.usd(s.cost_usd)}</span></a>`).join("")}</div>`
        : `<div class="panel">${ui.empty("bot", "Sem sessões", "Ainda nenhuma sessão de IA foi registada.")}</div>`}
      ${ui.sec("Limites do plano")}<div class="grid" id="meters"></div>
      <p class="faint" style="margin-top:12px">${t("Tokens: o que cada sessão reportou. Custo: estimativa do SDK do Claude, não é faturação. Higgsfield: indicado à mão por cada pessoa nas Definições.")}</p>`;
  }, 8);
  loadMeters().catch(() => {});
}
HUB_VIEWS.uso = async function () {
  page(`${ui.head("Análise", t("Uso de IA"), t("Tokens, sessões e custo estimado, por pessoa."))}<div id="usage-page"></div>`);
  await loadUsagePage();
};
onLive(["usage", "session"], async () => { if ($("usage-page")) await loadUsagePage(); });

const EXPENSE_CATS = { ai: "IA", software: "Software", ads: "Anúncios", infrastructure: "Infraestrutura", other: "Outros" };
async function loadExpenses() {
  await mount($("expenses"), async () => {
    const e = await api("/api/expenses");
    const totals = (cat) => Object.entries(e.month_totals[cat] || {}).map(([cur, v]) => fmt.money(v, cur)).join(" + ");
    return `${ui.sec("Custo de IA · 7 dias", ui.src(e.ai_cost.source))}
      <div class="stats">${statCard("Esta semana", e.ai_cost.total_usd == null ? null : fmt.usd(e.ai_cost.total_usd))}
        ${e.ai_cost.people.map((p) => statCard(p.name, fmt.usd(p.cost_usd))).join("")}</div>
      ${ui.sec(`${t("Despesas registadas")} · ${e.month}`)}
      <div class="stats">${Object.entries(EXPENSE_CATS).map(([cat, label]) => `<div class="panel statc"><span>${t(label)}</span>
        ${totals(cat) ? `<span class="num sm">${totals(cat)}</span>` : `<span class="num none">${t("Nada registado")}</span>`}</div>`).join("")}</div>
      ${ui.sec("Movimentos")}
      ${e.items.length ? `<div class="panel"><table class="tbl"><tr><th>${t("Data")}</th><th>${t("O quê")}</th><th>${t("Categoria")}</th><th>${t("Por")}</th><th class="r">${t("Valor")}</th><th></th></tr>
        ${e.items.map((x) => `<tr><td class="mono">${esc(x.spent_on)}</td><td>${esc(x.title)}</td><td>${t(EXPENSE_CATS[x.category])}</td><td>${esc(x.by)}</td><td class="r mono">${fmt.money(x.amount, x.currency)}</td>
          <td class="r">${leadOnly(`<button class="btn quiet sm" data-del-expense="${x.id}">${icon("x")}</button>`)}</td></tr>`).join("")}</table></div>`
        : `<div class="panel">${ui.empty("wallet", "Sem despesas registadas", "As despesas são escritas por pessoas. Não há ligação a bancos nem a contas de anúncios.",
          leadOnly(`<button class="btn sm primary" data-new-expense>${t("Registar despesa")}</button>`))}</div>`}`;
  }, 6);
}
HUB_VIEWS.despesas = async function () {
  page(`${ui.head("Análise", t("Despesas"), t("O que a IA custou (estimado) e o que a equipa registou à mão."), leadOnly(ui.btn("Registar despesa", "data-new-expense", "primary", "plus")))}<div id="expenses"></div>`);
  $("view").onclick = async (e) => {
    const del = e.target.closest("[data-del-expense]");
    if (del) { await api(`/api/expenses/${del.dataset.delExpense}`, { method: "DELETE" }).catch((err) => flash(err.message)); $("expenses")._html = null; return loadExpenses(); }
    if (!e.target.closest("[data-new-expense]")) return;
    formModal("Registar despesa", field("O quê", '<input name="title" required>', true)
      + field("Categoria", `<select name="category">${options(Object.entries(EXPENSE_CATS).map(([k, v]) => [k, t(v)]), "software")}</select>`)
      + field("Data", `<input name="spent_on" type="date" value="${new Date().toISOString().slice(0, 10)}">`)
      + field("Valor", '<input name="amount" type="number" step="0.01" min="0.01" required>')
      + field("Moeda", `<select name="currency">${options([["EUR", "EUR"], ["USD", "USD"]], "EUR")}</select>`)
      + field("Empresa", `<select name="company">${options([["", t("Sem empresa")], ...companies.map((c) => [c.id, c.name])], "")}</select>`, true),
    async (v) => { await api("/api/expenses", { method: "POST", body: { ...v, amount: Number(v.amount), company: v.company || null } }); $("expenses")._html = null; loadExpenses(); },
    { submit: "Registar" });
  };
  await loadExpenses();
};

/* ================================================================ memory */
const MEMORY_SCOPES = [["team", "Equipa"], ["global", "Global"], ["company", "Empresa"], ["project", "Projeto"], ["agent", "Agente"], ["task", "Tarefa"]];
let memoryScope = "all";
const memoryOpen = new Set();   // the notes left open stay open when the page reloads
async function memoryTargets(scope) {
  if (scope === "company") return companies.map((c) => [c.id, c.name]);
  if (scope === "project") return (await api("/api/projects")).map((p) => [String(p.id), p.name]);
  if (scope === "agent") return (await api("/api/users")).map((u) => [u.username, `Claude / ${u.display_name}`]);
  if (scope === "task") return (await api("/api/tasks")).slice(0, 60).map((x) => [String(x.id), `#${x.id} ${x.title}`]);
  return [];
}
// A link shows as its site (and path), never the whole tracking tail; it opens in the browser.
const MEM_URL = /https?:\/\/[^\s<>"']+/g;
const memSite = (url) => { try { const u = new URL(url); return u.host.replace(/^www\./, "") + (u.pathname.length > 1 ? u.pathname.replace(/\/$/, "") : ""); } catch { return url; } };
function memText(text) {
  let out = "", last = 0;
  for (const m of text.matchAll(MEM_URL)) {
    out += esc(text.slice(last, m.index)) + `<a class="mem-link" href="${esc(m[0])}" target="_blank" rel="noopener">${esc(memSite(m[0]))} ↗</a>`;
    last = m.index + m[0].length;
  }
  return out + esc(text.slice(last));
}
const memPeek = (text) => (text || "").replace(MEM_URL, (u) => memSite(u)).split("\n").map((l) => l.trim()).filter(Boolean).join(" · ");
function memRow(m) {
  const cat = (m.category || "").trim();
  return `<div class="mem-row ${memoryOpen.has(m.id) ? "open" : ""}" data-memory="${m.id}">
    <button class="mem-head" data-toggle-memory>${cat ? ui.tag(cat) : ""}<b class="mem-title">${esc(m.title.trim())}</b>
      <span class="mem-peek">${esc(memPeek(m.content))}</span><span class="mem-chev">${icon("chevron")}</span></button>
    <div class="mem-body">${m.content ? `<p>${memText(m.content.trim())}</p>` : `<p class="faint">${t("Sem texto.")}</p>`}
      <div class="mem-foot"><span class="faint">${t("Atualizada")} ${fmt.day(m.updated_at)}</span><button class="btn quiet sm" data-edit-memory>${t("Editar")}</button></div></div></div>`;
}
async function loadMemory() {
  await mount($("memory"), async () => {
    const all = await api("/api/memory");
    const count = (id) => all.filter((m) => m.scope === id).length;
    paint($("memory-scopes"), [["all", "Tudo", all.length], ...MEMORY_SCOPES.map(([id, label]) => [id, label, count(id)])]
      .filter(([id, , n]) => id === "all" || n || id === memoryScope || id === "team")
      .map(([id, label, n]) => `<button class="chp ${id === memoryScope ? "on" : ""}" data-s="${id}">${t(label)}${n ? ` <span class="mem-n">${n}</span>` : ""}</button>`).join(""));
    const items = memoryScope === "all" ? all : all.filter((m) => m.scope === memoryScope);
    if (!items.length) return `<div class="panel">${ui.empty("layers", "Memória vazia", "O que escreveres aqui é dado ao agente antes de ele começar uma tarefa deste âmbito.",
      `<button class="btn sm primary" data-new-memory>${t("Adicionar à memória")}</button>`)}</div>`;
    // one block per place (Equipa, Empresa · Bare Desk, ...), the notes inside ordered by category
    const names = {};
    for (const scope of new Set(items.map((m) => m.scope))) for (const [id, name] of await memoryTargets(scope).catch(() => [])) names[`${scope}:${id}`] = name;
    const rank = (m) => MEMORY_SCOPES.findIndex(([s]) => s === m.scope);
    const groups = new Map();
    for (const m of [...items].sort((a, b) => rank(a) - rank(b) || (a.category || "").localeCompare(b.category || "") || a.title.localeCompare(b.title))) {
      const label = t(MEMORY_SCOPES.find(([s]) => s === m.scope)?.[1] || m.scope);
      const key = m.scope_id ? `${label} · ${names[`${m.scope}:${m.scope_id}`] || m.scope_id}` : label;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(m);
    }
    return [...groups].map(([key, list]) => `<section class="mem-group"><div class="sec"><span>${esc(key)}</span><span class="faint">${list.length}</span></div>
      <div class="panel mem-list">${list.map(memRow).join("")}</div></section>`).join("");
  }, 5);
}
async function editMemory(existing) {
  // where a new note goes: one list of every place, starting on the tab that is open
  const places = [["team|", t("Equipa")], ["global|", t("Global")]];
  if (!existing) for (const [scope, label] of MEMORY_SCOPES.slice(2, 5)) for (const [id, name] of await memoryTargets(scope).catch(() => [])) places.push([`${scope}|${id}`, `${t(label)} · ${name}`]);
  const start = places.find(([v]) => v.startsWith(`${memoryScope}|`))?.[0] || "team|";
  formModal(existing ? "Editar memória" : "Adicionar à memória",
    (existing ? "" : field("Onde", `<select name="place">${options(places, start)}</select>`, true))
    + field("Categoria", `<input name="category" value="${esc(existing?.category || "")}" placeholder="ex: NEGÓCIO, DESIGN, TECH, DECISÕES">`)
    + field("Título", `<input name="title" required value="${esc(existing?.title || "")}">`)
    + field("Conteúdo", `<textarea name="content">${esc(existing?.content || "")}</textarea>`, true),
  async (v) => {
    const body = { category: v.category.trim().toUpperCase(), title: v.title.trim(), content: v.content.trim() };
    if (existing) await api(`/api/memory/${existing.id}`, { method: "PUT", body });
    else {
      const [scope, scope_id] = v.place.split("|");
      memoryOpen.add((await api("/api/memory", { method: "POST", body: { ...body, scope, scope_id } })).id);
    }
    $("memory")._html = null; loadMemory();
  }, existing ? { danger: { label: "Apagar", run: async () => { await api(`/api/memory/${existing.id}`, { method: "DELETE" }); $("memory")._html = null; loadMemory(); } } } : {});
}
HUB_VIEWS.memoria = async function () {
  page(`${ui.head("Sistema", t("Memória"), t("O que a IA deve saber antes de começar: factos e decisões, por âmbito. Clica numa nota para a abrir."), ui.btn("Adicionar à memória", "data-new-memory", "primary", "plus"))}
    <div class="chipbar" id="memory-scopes"></div><div class="mem" id="memory"></div>`);
  $("view").onclick = async (e) => {
    if (e.target.closest("a.mem-link")) return;   // the link opens; the note stays as it is
    const scope = e.target.closest("#memory-scopes [data-s]"), row = e.target.closest("[data-memory]");
    if (scope) { memoryScope = scope.dataset.s; $("memory")._html = null; return loadMemory(); }
    if (e.target.closest("[data-new-memory]")) return editMemory();
    if (!row) return;
    const id = Number(row.dataset.memory);
    if (e.target.closest("[data-edit-memory]")) return editMemory((await api("/api/memory")).find((m) => m.id === id));
    if (e.target.closest("[data-toggle-memory]")) { row.classList.toggle("open"); memoryOpen[row.classList.contains("open") ? "add" : "delete"](id); }
  };
  await loadMemory();
};

/* ================================================================ week, code, companies: the older pages, extended */
HUB_VIEWS.semana = async function () {
  page(`${ui.head("Centro de comando", t("Semana"), t("O que ficou feito, o que está preso e o que vem a seguir."), ui.btn("Gerar relatório semanal", "id=week-report", "primary", "spark"))}
    <div id="week-ai"></div><div class="cards" id="week-blocks" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr))"></div>
    ${ui.sec("Dia a dia")}<div id="week"></div>`);
  const showReport = (r) => {
    if (!r) return;
    $("week-ai").innerHTML = `<div class="panel pad" style="margin-bottom:12px"><div class="rowx" style="margin-bottom:8px"><div class="ph-eyebrow grow" style="margin:0">${t("Relatório semanal")}</div>
      <span class="faint">${["PENDING", "RUNNING"].includes(r.status) ? "" : fmt.day(r.created_at) + " " + fmt.hhmm(r.created_at)}</span></div>
      ${["PENDING", "RUNNING"].includes(r.status) ? `<p class="msg think" style="margin:0">${t("O teu agente está a escrever o relatório a partir dos dados do Hub")}</p>`
        : r.status === "DONE" ? `<p style="margin:0;white-space:pre-wrap">${md(r.answer)}</p>` : `<p class="msg note" style="margin:0">${esc(aiError(r.error))}</p>`}</div>`;
  };
  $("week-report").onclick = async () => {
    $("week-report").disabled = true;
    showReport({ status: "PENDING" });
    try { showReport(await askAI("", "weekly_report")); } catch (e) { flash(e.message); }
    $("week-report").disabled = false;
  };
  api("/api/ai/requests?kind=weekly_report&limit=1").then((list) => showReport(list[0])).catch(() => {});
  mount($("week-blocks"), async () => {
    const tasks = await api("/api/tasks");
    const monday = new Date(); monday.setHours(0, 0, 0, 0); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    const rank = { urgent: 0, high: 1, normal: 2, low: 3 };
    const block = (title, tone, list, emptyText) => `<div class="panel"><div class="sec" style="margin:0;padding:12px var(--pad) 6px"><span>${t(title)}</span><i style="font-style:normal">${list.length}</i></div>
      ${list.length ? `<div class="rows">${list.slice(0, 7).map((x) => `<a class="rw" href="#/tarefas/${x.id}"><span class="st ${tone}"><i></i></span>
        <div class="rw-main"><b>${esc(x.title)}</b><span>${esc(nameOf(x.assignee))}${x.blocked_reason ? " · " + esc(x.blocked_reason) : ""}</span></div></a>`).join("")}</div>`
        : `<p class="faint" style="margin:0;padding:4px var(--pad) 14px">${t(emptyText)}</p>`}</div>`;
    return block("Concluídas esta semana", "ok", tasks.filter((x) => x.status === "COMPLETED" && x.completed_at && new Date(x.completed_at) >= monday), "Nada concluído esta semana.")
      + block("Bloqueadas", "bad", tasks.filter((x) => x.stage === "blocked"), "Nada bloqueado.")
      + block("A seguir", "off", tasks.filter((x) => x.stage === "todo").sort((a, b) => rank[a.priority] - rank[b.priority]), "Nada por fazer.");
  });
  await loadWeek();
};

HUB_VIEWS.codigo = async function () {
  const done = viewCode(); // the older page: work in progress and the commit feed
  const head = $("view").querySelector(".page-head");
  head.insertAdjacentHTML("afterend", `<div id="code-status" style="margin:14px 0"></div>`);
  mount($("code-status"), async () => {
    const [commits, tasks] = await Promise.all([api("/api/commits?limit=100").catch(() => null), api("/api/tasks")]);
    const repos = {};
    for (const c of commits || []) (repos[c.repo] ||= { name: c.repo, commits: 0, last: c }).commits++;
    const branches = tasks.filter((x) => x.git_branch && x.stage !== "done");
    return `<div class="stats">
      <div class="panel statc"><span>${t("Repositórios")}</span>${ui.num(commits ? Object.keys(repos).length : null)}${ui.src(commits ? "live" : "not_connected")}</div>
      <div class="panel statc"><span>${t("Commits recentes")}</span>${ui.num(commits ? commits.length : null)}${ui.src(commits ? "live" : "not_connected")}</div>
</div>
      ${branches.length ? `${ui.sec("Branches com trabalho")}<div class="panel rows">${branches.map((x) => `<a class="rw" href="#/tarefas/${x.id}"><span class="mono" style="min-width:150px">${esc(x.git_branch)}</span>
        <div class="rw-main"><b>${esc(x.title)}</b><span>${x.agent_role ? "Claude / " : ""}${esc(nameOf(x.assignee))}</span></div>${ui.tag(t(STAGE_LABEL[x.stage]), STAGE_TONE[x.stage])}</a>`).join("")}</div>` : ""}`;
  }, 2);
  await done;
};

/* Trabalho, the way in (2026-10-06, like the phone): the companies as folders, the rest of the work beside them.
   A company opens its own page (#/empresas/<id>), BareDesk its shop; nothing is opened before you choose. */
async function workOverview() {
  page(`${ui.head("Trabalho", t("Trabalho"), t("As empresas e o trabalho em geral. Escolhe uma empresa para entrar nela."))}<div id="work-in">${ui.skeleton(6)}</div>`);
  await mount($("work-in"), async () => {
    const [tasks, projects, commits, store] = await Promise.all([api("/api/tasks"), api("/api/projects").catch(() => []), api("/api/commits?limit=20").catch(() => []),
      companies.some((c) => c.id === "baredesk") ? api("/api/store/summary").catch(() => null) : null]);
    const works = await Promise.all(companies.map((c) => api(`/api/work/${c.id}`).catch(() => null)));
    const cards = asOne(tasks.filter((x) => !x.trashed_at));
    const live = store && (store.shopify?.source === "live" || store.meta?.source === "live");
    const folder = (c, i) => {
      const open = cards.filter((x) => x.company === c.id && x.stage !== "done").length, done = cards.filter((x) => x.company === c.id && x.stage === "done").length;
      const top = works[i]?.people?.[0];
      const shop = c.id === "baredesk" ? `<a class="wf-fact ${live ? "ok" : "warn"}" href="#/baredesk">${live ? `● ${t("Loja ao vivo")}` : t("Loja por ligar")}</a>` : "";
      return `<article class="wf">
        <a class="wf-head" href="${c.id === "baredesk" ? "#/baredesk" : `#/empresas/${c.id}`}"><span class="wf-logo">${esc(c.short || c.name.slice(0, 3))}</span>
          <div><b>${esc(c.name)}</b><span>${esc(c.tagline || "")}</span></div>${icon("chevron")}</a>
        <div class="wf-facts"><span class="wf-fact"><b>${open}</b> ${t(open === 1 ? "tarefa aberta" : "tarefas abertas")}</span><span class="wf-fact"><b>${done}</b> ${t("feitas")}</span>${shop}
          ${top ? `<span class="wf-fact">${t("Mais ativo")}: ${esc(top.name)}</span>` : ""}</div>
        <div class="wf-lib">${c.sections.map((x) => `<a href="${c.id === "baredesk" ? `#/baredesk/${x.id}` : `#/empresas/${c.id}/${x.id}`}">${icon(x.id)}<span>${esc(t(x.label))}</span>${x.count != null ? `<i>${x.count}</i>` : ""}</a>`).join("")}</div></article>`;
    };
    const general = (href, ic, title, sub, body) => `<a class="in-card wg" href="${href}"><header class="ch">${icon(ic)}<div class="ch-t"><b>${esc(t(title))}</b><span>${esc(sub)}</span></div>${icon("chevron")}</header>${body}</a>`;
    const cline = (c) => `<div class="wg-row">${ui.avatar(c.author, "sm")}<div><b>${esc(c.message)}</b><span>${esc(c.author)} · ${esc(fmt.ago(c.date))}</span></div></div>`;
    return `<div class="wf-grid">${companies.length ? companies.map(folder).join("") : ui.empty("building", "Ainda não há empresas", "")}</div>
      <div class="sec" style="margin-top:22px"><span>${t("Geral")}</span></div>
      <div class="wg-grid">
        ${general("#/projetos", "folder", "Projetos", projects.length ? t(projects.length === 1 ? "1 projeto" : "{n} projetos", { n: projects.length }) : t("Ainda sem projetos"),
          projects.length ? projects.slice(0, 3).map((x) => `<div class="wg-row"><span class="wg-dot"></span><div><b>${esc(x.name)}</b></div></div>`).join("") : `<p class="wg-none">${t("Um projeto junta tarefas, agentes e custo num só sítio.")}</p>`)}
        ${general("#/codigo", "code", "Código", commits[0] ? `${t("último")} ${fmt.ago(commits[0].date)}` : t("Sem commits"), commits.slice(0, 3).map(cline).join("") || `<p class="wg-none">${t("Sem commits.")}</p>`)}
        ${general("#/entregas", "layers", "Entregas", t("o que mudou em cada push"), commits[0] ? `<div class="wg-row"><span class="wg-dot"></span><div><b>${esc(commits[0].message)}</b><span>${esc(commits[0].author)} · ${esc(fmt.ago(commits[0].date))}</span></div></div>` : `<p class="wg-none">${t("Ainda sem entregas.")}</p>`)}
      </div>`;
  }, 6);
}

HUB_VIEWS.empresas = async function (r) {
  if (!r.company) return workOverview();
  const done = viewCompanies(r); // the older page: the company's library (theme, skills, videos, photos, docs)
  const company = companies.find((c) => c.id === r.company) || companies[0];
  const anchor = $("work");
  if (company && anchor) {
    anchor.insertAdjacentHTML("beforebegin", `<div id="co-over"></div>`);
    mount($("co-over"), async () => {
      const o = await api(`/api/companies/${company.id}/overview`);
      const off = (label) => `<div class="panel statc"><span>${t(label)}</span><span class="num none">${t("Não ligado")}</span>${ui.src("not_connected")}</div>`;
      return `<div class="co-over">${off("Receita")}${off("Encomendas")}${off("Tráfego")}${off("Conversão")}
        <div class="panel statc"><span>${t("Anúncios (registado)")}</span>${ui.num(o.ad_spend.length ? o.ad_spend.map((s) => fmt.money(s.amount, s.currency)).join(" + ") : null, "sm")}</div>
        <div class="panel statc"><span>${t("Custo de IA")}</span>${ui.num(o.ai_cost_usd == null ? null : fmt.usd(o.ai_cost_usd), "sm")}${o.ai_cost_usd == null ? "" : ui.src("estimated")}</div>
        <a class="panel statc hover" href="#/tarefas"><span>${t("Tarefas abertas")}</span>${ui.num(o.open_tasks, "sm")}</a>
        <a class="panel statc hover" href="#/projetos"><span>${t("Projetos")}</span>${ui.num(o.projects, "sm")}</a>
        <a class="panel statc hover" href="#/memoria"><span>${t("Memória")}</span>${ui.num(o.memory, "sm")}</a></div>`;
    }, 2);
  }
  await done;
};

/* ================================================================ settings */
HUB_VIEWS.definicoes = async function () {
  const density = localStorage.getItem("hub.density") || "normal";
  page(`${ui.head("Sistema", t("Definições"), t("As tuas preferências neste computador e o teu agente."))}
    <div class="cards" style="grid-template-columns:repeat(auto-fit,minmax(340px,1fr))">
      <div class="panel pad stack"><div class="ph-eyebrow">${t("Aparência")}</div>
        <label class="field">${t("Densidade")}<div class="segx" id="set-density" style="align-self:flex-start">${[["compact", "Compacta"], ["normal", "Normal"], ["expanded", "Ampla"]].map(([v, l]) => `<button data-d="${v}" class="${v === density ? "on" : ""}">${t(l)}</button>`).join("")}</div></label>
        <label class="field">${t("Língua")}<select id="set-lang">${options(Object.keys(I18N).map((l) => [l, { pt: "Português (Portugal)" }[l] || l]), LANG)}</select></label>
        <div class="rowx">${ui.btn("Avisos do browser", "id=set-notify", "quiet")}</div></div>
      <div class="panel pad stack"><div class="ph-eyebrow">${t("O meu agente")}</div>
        <p class="dim" style="margin:0">${t("O agente local corre no teu computador e precisa de um token para falar com o Hub. O token aparece uma vez e substitui o anterior.")}</p>
        <div class="rowx">${ui.btn("Gerar token do agente", "id=set-token", "", "key")}</div><div class="now" id="token-box" hidden></div></div>
      <div class="panel pad stack"><div class="ph-eyebrow">Higgsfield</div>
        <p class="dim" style="margin:0">${t("O Higgsfield não deixa ler os créditos: indica à mão quanto já gastaste.")}</p>
        <form class="rowx" id="higgs-form"><input id="higgs-range" type="range" min="0" max="100" value="0" class="grow"><b id="higgs-val" class="mono" style="width:44px;text-align:right">0%</b>
          <button class="btn primary sm">${t("Guardar")}</button></form></div>
    </div>`);
  $("set-density").onclick = (e) => {
    if (!e.target.dataset.d) return;
    localStorage.setItem("hub.density", e.target.dataset.d); // shell.js puts it back on <html> at start
    document.documentElement.dataset.density = e.target.dataset.d;
    $("set-density").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === e.target));
  };
  $("set-lang").onchange = (e) => { LANG = e.target.value; localStorage.setItem("hub.lang", LANG); render(); };
  $("set-notify").onclick = async () => flash((await Notification.requestPermission()) === "granted" ? t("Avisos do browser ligados.") : t("O browser não deixou ligar os avisos."));
  $("set-token").onclick = async () => {
    const { agent_token } = await api(`/api/users/${me.username}/agent-token`, { method: "POST" });
    $("token-box").hidden = false;
    $("token-box").textContent = `TEAM_AGENT_TOKEN=${agent_token}`;
  };
  const mine = (await api("/api/team")).find((m) => m.user === me.username);
  $("higgs-range").value = mine?.higgsfield_pct ?? 0;
  $("higgs-val").textContent = $("higgs-range").value + "%";
  $("higgs-range").oninput = () => { $("higgs-val").textContent = $("higgs-range").value + "%"; };
  $("higgs-form").onsubmit = async (e) => {
    e.preventDefault();
    await api("/api/meters/higgsfield", { method: "PUT", body: { pct: Number($("higgs-range").value) } });
    flash(t("Guardado."));
  };
};

// ---------------------------------------------------------------- Entregas: what each push changed, for somebody who does not read code
const PUSH_KINDS = [["photo", "Fotos", "fotos"], ["design", "Design", "layers"], ["text", "Textos", "doc"], ["code", "Código", "code"]];
const PUSH_PHOTOS = 12; // pictures shown of one push; the rest is a count
let pushWho = "", pushKind = "";

function pushHtml(c) {
  const files = c.files || [], kinds = c.kinds || {};
  const of = (k) => files.filter((f) => f.kind === k);
  const photos = of("photo");
  const chips = PUSH_KINDS.filter(([k]) => kinds[k]).map(([k, label, ic]) =>
    `<span class="push-kind ${k}">${icon(ic)}${t(label)} <b>${kinds[k].files}</b>${k === "photo" ? "" : diffStat(kinds[k].added, kinds[k].deleted)}</span>`).join("");
  const blob = (f) => `/api/commits/blob?repo=${encodeURIComponent(c.repo)}&sha=${c.sha}&path=${encodeURIComponent(f.path)}`;
  const gallery = photos.length ? `<div class="push-photos">${photos.slice(0, PUSH_PHOTOS).map((f) =>
    `<figure><a target="_blank" rel="noopener"><img alt="" data-blob="${esc(blob(f))}"></a><figcaption title="${esc(f.path)}">${esc(f.path.split("/").pop())}</figcaption></figure>`).join("")}
    ${photos.length > PUSH_PHOTOS ? `<figure class="more"><b>+${photos.length - PUSH_PHOTOS}</b></figure>` : ""}</div>` : "";
  const lists = PUSH_KINDS.filter(([k]) => k !== "photo" && of(k).length).map(([k, label]) => `
    <details class="push-files"><summary>${t(label)} · ${kinds[k].files} ${kinds[k].files === 1 ? "ficheiro" : "ficheiros"}</summary>
      ${of(k).map((f) => `<div class="file"><code>${esc(f.path)}</code><span>${f.binary ? '<span class="muted">binário</span>' : diffStat(f.added, f.deleted)}</span></div>`).join("")}
    </details>`).join("");
  return `<article class="panel push">
    <header><div><b>${esc(c.author)}</b><span>${ago(c.date)} · ${time(c.date)} · ${esc(c.repo)}</span></div>
      ${c.url ? `<a class="ch-link" href="${esc(c.url)}" target="_blank" rel="noopener">GitHub</a>` : ""}</header>
    <h3>${esc(c.message)}</h3>
    ${c.body ? `<p class="push-body">${esc(c.body)}</p>` : ""}
    <div class="push-kinds">${chips || `<span class="muted">${t("Sem detalhe dos ficheiros neste computador.")}</span>`}</div>
    ${gallery}${lists}</article>`;
}

HUB_VIEWS.entregas = async function () {
  page(`${ui.head("Trabalho", t("Entregas"), t("O que mudou em cada push: fotos, design, textos e código, cada coisa no seu sítio."))}
    <div class="chips" id="push-who"></div><div class="chips" id="push-kind"></div>
    <div class="push-list" id="push-list"><p class="muted">A carregar…</p></div>`);
  const all = await api("/api/commits?limit=60");
  const draw = () => {
    if (!$("push-list")) return;
    const authors = [...new Set(all.map((c) => c.author))];
    $("push-who").innerHTML = '<span class="chip-label">Quem</span>' + ["", ...authors].map((a) =>
      `<span class="chip ${a === pushWho ? "active" : ""}" data-a="${esc(a)}">${a ? esc(a) : "Todos"}</span>`).join("");
    $("push-kind").innerHTML = '<span class="chip-label">O quê</span>' + [["", "Tudo"], ...PUSH_KINDS].map(([k, label]) =>
      `<span class="chip ${k === pushKind ? "active" : ""}" data-k="${k}">${t(label)}</span>`).join("");
    const items = all.filter((c) => (!pushWho || c.author === pushWho) && (!pushKind || c.kinds?.[pushKind]));
    $("push-list").innerHTML = items.length ? items.map(pushHtml).join("") : `<div class="empty">${t("Nenhum push com isto.")}</div>`;
    for (const img of $("push-list").querySelectorAll("img[data-blob]")) { // a picture needs the sign-in, so it cannot be a plain src
      fetch(img.dataset.blob, { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => (r.ok ? r.blob() : Promise.reject()))
        .then((b) => { img.src = img.parentNode.href = URL.createObjectURL(b); })
        .catch(() => img.closest("figure").classList.add("gone"));
    }
  };
  $("push-who").onclick = (e) => { if (e.target.dataset.a !== undefined) { pushWho = e.target.dataset.a; draw(); } };
  $("push-kind").onclick = (e) => { if (e.target.dataset.k !== undefined) { pushKind = e.target.dataset.k; draw(); } };
  draw();
};
