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

/* Whose task it is must be seen before what it says. Each partner has a colour of their own, the same as on the wall of the
   Empresa AMG (crew.js, PARTNERS): Kovel violet, Marco blue, David pink. It is the stripe of their rows and cards, the ring
   of their photo and their plate; your own plate says TU. Somebody new gets a spare colour, always the same one. */
const PERSON_TINT = [["kovel", "#a99bff"], ["marco", "#69b4ff"], ["david", "#f28fb8"]];
const SPARE_TINT = ["#5ee0c4", "#9ee06a", "#e7a3ff"];
function tintOf(login) {
  const name = `${nameOf(login) || ""} ${login || ""}`.toLowerCase(), hit = PERSON_TINT.find(([k]) => name.includes(k));
  if (hit) return hit[1];
  let h = 0;
  for (const c of String(login || "")) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return SPARE_TINT[h % SPARE_TINT.length];
}
// --who for solid colour, --who-rgb for the see-through ones (rgba(var(--who-rgb), .1)): no color-mix, so older Chromiums work too
const whoVar = (login) => { const c = tintOf(login); return `--who:${c};--who-rgb:${[1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)).join(",")}`; };
const isMe = (login) => login === me.username;
// The plate: the photo in a ring of the person's colour and the name in capitals. "TU" when it is yours.
const whoPlate = (login, cls = "") => `<span class="wplate ${isMe(login) ? "me" : ""} ${cls}" style="${whoVar(login)}" title="${esc(t("Para {n}", { n: nameOf(login) }))}">${ui.avatar(nameOf(login), "sm")}<b>${esc(isMe(login) ? t("Tu") : nameOf(login))}</b></span>`;
const allPlate = (group) => `<span class="wplate all" title="${esc(groupLabel(group))}">${whoFaces(group)}<b>${esc(group.length >= Object.keys(teamNames).length ? t("Todos") : group.length)}</b></span>`;
// Me first, then the others by name: the order of the people strip and of the columns of "Por pessoa".
const peopleOrder = (logins) => [...new Set(logins)].filter(Boolean).sort((a, b) => isMe(b) - isMe(a) || nameOf(a).localeCompare(nameOf(b)));

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
const whoFace = (y, size = "sm") => `<span class="doer ${y.stage === "done" ? "did" : "left"}" style="${whoVar(y.assignee)}" title="${esc(nameOf(y.assignee))}: ${esc(y.stage === "done"
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

// Who is doing a task, for everybody to see: their photo inside a turning chrome-and-green ring, and "a fazer".
// A task for everybody counts as being done while any one of them is on their part.
const doingOf = (x) => (x.group ? x.group.find((y) => y.doing_since && y.stage !== "done") : x.doing_since && x.stage !== "done" ? x : null);
const doingBadge = (y, size = "sm") => `<span class="doer-live" style="${whoVar(y.assignee)}" title="${esc(t("{n} está a fazer isto", { n: nameOf(y.assignee) }))}"><span class="dl-ring">${ui.avatar(nameOf(y.assignee), size)}</span><em><b>${esc(y.assignee === me.username ? t("Tu") : nameOf(y.assignee))}</b><s> · </s><span>${t("a fazer")}</span></em></span>`;
/* The red bin: on every row and card of Tarefas and in the window of a task. The task goes to the Lixo, where it can be
   recovered for some hours, and «Desfazer» brings it straight back. Not on a task an agent is running (stop it first) nor
   on a task for everybody (each has their own copy; it is deleted from inside it). */
// the same rule as the Hub (tasks.py, HELD_BY_AGENT): only while an agent is running it does it have to be stopped first
const canTrash = (x) => x && !x.group && !["IN_PROGRESS", "WAITING_APPROVAL"].includes(x.status);
const trashBtn = (x, cls) => (canTrash(x) ? `<button type="button" class="${cls}" data-trash="${x.id}" data-title="${esc(x.title)}" data-reason="${x.stage === "done" ? "done" : "mistake"}"
  title="${t("Apagar tarefa")}" aria-label="${t("Apagar tarefa")}">${icon("trash")}</button>` : "");
async function trashTaskUndo(id, title, reason = "mistake") {
  try { await api(`/api/tasks/${id}/trash`, { method: "POST", body: { reason } }); }
  catch (err) { flash(err.message); loadBoard(); return false; }
  loadBoard();
  const el = document.createElement("div");
  el.className = "toast undo";
  el.innerHTML = `<span>${icon("trash")}<b>${esc(t("Tarefa apagada"))}</b><em>${esc(title)}</em></span><button type="button">${esc(t("Desfazer"))}</button>`;
  $("toasts").append(el);
  const gone = () => { el.classList.add("out"); setTimeout(() => el.remove(), 600); };
  const timer = setTimeout(gone, 7000);
  el.querySelector("button").onclick = async () => {
    clearTimeout(timer); gone();
    try { await api(`/api/tasks/${id}/restore`, { method: "POST" }); flash(t("A tarefa voltou: {t}", { t: title })); } catch (err) { flash(err.message); }
    loadBoard();
  };
  return true;
}

/* ---------- Tarefas no computador: como estava antes de 23 out (Por pessoa, Por prazo, Quadro), pedido do Marco a 24 out ---------- */
function taskCard(x) {
  const late = x.deadline && x.stage !== "done" && new Date(x.deadline) < new Date();
  const mineOf = x.group && x.group.find((y) => y.assignee === me.username);
  const doer = doingOf(x);
  const stack = doer ? doingBadge(doer) : x.group ? allPlate(x.group) : whoPlate(x.assignee);
  const top = [x.priority === "urgent" ? ui.tag(t("Urgente"), "bad") : x.priority === "high" ? ui.tag(t("Alta"), "warn") : "", x.group ? ui.tag(groupLabel(x.group), "ai") : "", isFresh(x) ? ui.tag(t("Nova"), "ok") : ""].join("");
  return `<article class="tk ${x.priority === "urgent" ? "urgent" : x.priority === "high" ? "high" : ""} ${isFresh(x) ? "fresh" : ""} ${doer ? "doing" : ""} ${x.group ? "for-all" : isMe(x.assignee) ? "mine" : ""}"
    style="${x.group ? "" : whoVar(x.assignee)}" draggable="${x.group ? "false" : "true"}" data-id="${(mineOf || x).id}">
    ${trashBtn(x.group ? null : x, "tk-del")}${top ? `<div class="tk-top">${top}</div>` : ""}
    <b>${esc(x.title)}</b>
    ${x.stage === "in_progress" || (x.progress > 0 && x.stage !== "done") ? ui.progress(x.progress, "ai") : ""}
    ${x.group ? `<span class="tk-who">${esc(whoLeft(x.group))}</span>` : ""}
    <div class="tk-foot">${stack}<span class="grow ell">${esc(x.project_name || x.project || "")}</span>
      ${x.crew_name ? ui.tag(x.crew_name, "ai") : x.agent_role ? ui.tag("IA", "ai") : ""}${x.priority === "low" ? ui.tag(t(PRIORITY[x.priority]), x.priority) : ""}
      ${x.deadline ? ui.tag(fmt.date(x.deadline), late ? "bad" : "") : ""}</div></article>`;
}

// What is finished takes little room: one short line each, only today's, and the older ones behind a button.
let showOlderDone = false;
const doneAt = (x) => new Date(x.completed_at || x.updated_at || x.created_at);
const doneCard = (x) => `<article class="tk tk-done" style="${x.group ? "" : whoVar(x.completed_by || x.assignee)}" draggable="${x.group ? "false" : "true"}" data-id="${((x.group && x.group.find((y) => y.assignee === me.username)) || x).id}"
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
let taskView = (() => { try { return localStorage.getItem("hub.taskView") || "pessoas"; } catch { return "pessoas"; } })();
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
// A row wears the colour of whose it is (of who did it, once done) and ends in their plate. Inside a person's own column
// (inCol, the "Por pessoa" view) the column already says whose it is: no plate, only who is on it now.

function tlRow(x, inCol = false) {
  const own = inCol ? x : x.group ? x.group.find((y) => y.assignee === me.username) : x;
  const done = x.stage === "done", tone = done ? "done" : x.priority === "urgent" ? "urgent" : x.priority === "high" ? "high" : "";
  const co = companies.find((c) => c.id === x.company)?.name;
  const who = done && x.completed_by ? x.completed_by : x.assignee, doer = !done && doingOf(x);
  const side = inCol ? (doer ? doingBadge(doer) : x.group ? whoFaces(x.group) : "")
    : doer ? doingBadge(doer) : x.group ? allPlate(x.group) : whoPlate(who);
  const meta = [co ? `<span class="tl-co">${esc(co)}</span>` : "", inCol && x.group ? `<span class="tl-all">${esc(groupLabel(x.group))}</span>` : "", x.project_name ? esc(x.project_name) : "",
    x.group ? `<span class="all">${esc(whoLeft(x.group))}</span>` : done && x.completed_by && x.completed_by !== x.assignee ? `<span class="other">${esc(doneBy(x))}</span>` : "",
    !done && x.crew_name ? `<em class="ai">${esc(x.crew_name)}</em>` : "",
    done ? (x.completed_at ? `${fmt.day(x.completed_at)} ${fmt.hhmm(x.completed_at)}` : "") : tlWhen(x),
    x.stage === "in_progress" ? `<em class="ai">${t("Em curso")}</em>` : x.stage === "blocked" ? `<em class="late">${t("Bloqueada")}</em>` : "",
    // a task still with a person goes to the office with one touch: the agent of its sector takes it (Marco, 9 out)
    !done && !x.group && own && own.status === "TODO" ? `<button type="button" class="tl-office" data-office="${own.id}" title="${t("O escritório escolhe o agente certo e ele começa sozinho")}">${icon("bot")}${t("Mandar para o escritório")}</button>` : ""].filter(Boolean);
  const check = done ? `<span class="tl-check">${icon("tick")}</span>`
    : own && own.stage !== "done" && !heldByAgent(own) ? `<button class="tl-check" data-done="${own.id}" title="${t("Concluir")}"></button>`
    : `<span class="tl-check ${own && own.stage === "done" ? "part" : "held"}">${own && own.stage === "done" ? icon("tick") : ""}</span>`;
  return `<div class="tl-row ${tone} ${x.group && !inCol ? "for-all" : isMe(inCol ? x.assignee : who) ? "mine" : ""}" style="${x.group && !inCol ? "" : whoVar(inCol ? x.assignee : who)}" data-id="${(own || x).id}">${check}
    <div class="tl-t"><b>${tone === "urgent" ? '<i class="bang">!!</i>' : tone === "high" ? '<i class="bang high">!</i>' : ""}${esc(x.title)}</b>${meta.length ? `<span>${meta.join(" · ")}</span>` : ""}</div>
    ${side}${x.group && !inCol ? "" : trashBtn(own, "tl-del")}</div>`;
}
// A block with many tasks of several people is not one long list: it is one short list per person, the first few of each
// showing and the rest one click away. Fourteen tasks of one person used to bury everybody else's.
const TL_MANY = 6, TL_FEW = 3;
const tlOpen = new Set(); // "block|person" unfolded
function tlBlock(title, list, tone = "", sort = true) {
  if (!list.length) return "";
  const rows = sort ? [...list].sort(tlOrder) : list;
  const head = `<h4 class="${tone}"><i></i>${t(title)}<span>${list.length}</span></h4>`;
  const owner = (x) => (x.group ? "" : x.stage === "done" && x.completed_by ? x.completed_by : x.assignee);
  const owners = [...new Set(rows.map(owner))];
  if (rows.length <= TL_MANY || taskFilter || !sort) return `<div class="tl-block">${head}<div class="tl-list">${rows.map((x) => tlRow(x)).join("")}</div></div>`;
  return `<div class="tl-block">${head}${owners.map((u) => {
    const mine = rows.filter((x) => owner(x) === u), key = `${title}|${u}`, open = tlOpen.has(key) || mine.length <= TL_FEW + 1;
    return `<div class="tl-who" style="${u ? whoVar(u) : ""}">${u ? ui.avatar(nameOf(u), "sm") : icon("users")}<b>${esc(u ? (isMe(u) ? t("Tu") : nameOf(u)) : t("Para todos"))}</b><span>${mine.length}</span></div>
      <div class="tl-list">${(open ? mine : mine.slice(0, TL_FEW)).map((x) => tlRow(x)).join("")}</div>
      ${mine.length > TL_FEW + 1 ? `<button class="tl-more" data-tl-open="${esc(key)}">${open ? t("Mostrar menos") : t("Ver mais {n} de {quem}", { n: mine.length - TL_FEW, quem: u ? nameOf(u) : t("todos") })}</button>` : ""}`;
  }).join("")}</div>`;
}
let showOlderFeitas = false;

/* The people strip, on top of every view: a card per partner in their colour, with what they have open, what is urgent, late
   or for today, what they finished today and what they are doing right now. A press shows only theirs; pressing it again, or
   "Equipa", shows everybody's. It is also the legend of the colours. */
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const teamLogins = (all) => peopleOrder([...Object.keys(teamNames), ...all.map((x) => x.assignee)]);
const many = (n, one, more) => `${n} ${t(n === 1 ? one : more)}`;
function drawPeople(all) {
  const box = $("task-people");
  if (!box) return;
  const open = all.filter((x) => x.stage !== "done"), midnight = startOfToday(), people = teamLogins(all);
  const facts = (list, did) => {
    const urgent = list.filter((x) => x.priority === "urgent").length, late = list.filter((x) => tlLate(x) > 0).length, today = list.filter((x) => tlLate(x) === 0).length;
    return [urgent ? `<em class="late">${many(urgent, "urgente", "urgentes")}</em>` : "", late ? `<em class="late">${many(late, "atrasada", "atrasadas")}</em>` : "",
      today ? `<em class="today">${many(today, "para hoje", "para hoje")}</em>` : "", did ? `<em class="ok">${many(did, "feita hoje", "feitas hoje")}</em>` : ""].filter(Boolean).join("")
      || `<em class="calm">${t(list.length ? "Tudo dentro do prazo" : "Nada por fazer")}</em>`;
  };
  const card = (u) => {
    const mine = open.filter((x) => x.assignee === u), now = mine.find((x) => x.doing_since) || mine.find((x) => x.stage === "in_progress");
    const did = all.filter((x) => x.stage === "done" && x.assignee === u && doneAt(x) >= midnight).length;
    return `<button class="pcard ${u === taskFilter ? "on" : ""} ${isMe(u) ? "me" : ""}" data-u="${esc(u)}" style="${whoVar(u)}" aria-pressed="${u === taskFilter}">
      <span class="pc-av">${ui.avatar(nameOf(u))}</span>
      <span class="pc-id"><b>${esc(nameOf(u))}</b>${isMe(u) ? `<small>${t("Tu")}</small>` : ""}</span>
      <span class="pc-n"><b>${mine.length}</b><small>${t(mine.length === 1 ? "aberta" : "abertas")}</small></span>
      <span class="pc-facts">${facts(mine, did)}</span>
      ${now ? `<span class="pc-now"><i></i><span>${t("A fazer")}: <b>${esc(now.title)}</b></span></span>` : ""}</button>`;
  };
  const team = asOne(open);
  paint(box, `<button class="pcard team ${taskFilter ? "" : "on"}" data-u="" aria-pressed="${!taskFilter}"><span class="pc-av">${icon("users")}</span>
      <span class="pc-id"><b>${t("Equipa")}</b></span><span class="pc-n"><b>${team.length}</b><small>${t(team.length === 1 ? "aberta" : "abertas")}</small></span>
      <span class="pc-facts">${facts(team, all.filter((x) => x.stage === "done" && doneAt(x) >= midnight).length)}</span></button>${people.map(card).join("")}`);
  box.style.setProperty("--n", people.length + 1);   // the people and the team card, all the same width
}
const coChips = (withCo) => (withCo.length ? [["", "Todas as empresas"], ...withCo.map((c) => [c.id, c.name]), ["none", "Sem empresa"]]
  .map(([id, label]) => `<button class="chp ${id === taskCoFilter ? "on" : ""}" data-co="${esc(id)}">${esc(t(label))}</button>`).join("") : "");

/* "Por pessoa": one column per partner, you first, in their colour. Each says what they are doing now, then what is urgent,
   late, for today, coming and undated, and what they finished today. A task for everybody is in every column, as that
   person's part of it. */
const pcBlock = (title, list, tone = "") => (list.length ? `<div class="tl-block"><h4 class="${tone}"><i></i>${t(title)}<span>${list.length}</span></h4>
  <div class="tl-list">${list.map((x) => tlRow(x, true)).join("")}</div></div>` : "");
function personCols(all) {
  const groups = new Map();
  for (const g of groupAll(all)) if (g.group) for (const y of g.group) groups.set(y.id, g.group);
  const people = taskFilter ? [taskFilter] : teamLogins(all), midnight = startOfToday();
  const col = (u) => {
    const mine = all.filter((x) => x.assignee === u).map((x) => (groups.has(x.id) ? { ...x, group: groups.get(x.id) } : x));
    const open = mine.filter((x) => x.stage !== "done").sort(tlOrder);
    const now = open.filter((x) => x.doing_since || x.stage === "in_progress"), rest = open.filter((x) => !now.includes(x)), calm = rest.filter((x) => x.priority !== "urgent");
    const late = calm.filter((x) => tlLate(x) > 0), did = mine.filter((x) => x.stage === "done" && doneAt(x) >= midnight).sort((a, b) => doneAt(b) - doneAt(a));
    const sub = [now.length ? t("a fazer agora") : "", late.length ? many(late.length, "atrasada", "atrasadas") : "", did.length ? many(did.length, "feita hoje", "feitas hoje") : ""].filter(Boolean).join(" · ");
    const body = pcBlock("A fazer agora", now, "now") + pcBlock("Urgentes", rest.filter((x) => x.priority === "urgent"), "late") + pcBlock("Atrasadas", late, "late")
      + pcBlock("Para hoje", calm.filter((x) => tlLate(x) === 0), "today") + pcBlock("Próximas", calm.filter((x) => tlLate(x) !== null && tlLate(x) < 0))
      + pcBlock("Sem prazo", calm.filter((x) => tlLate(x) === null));
    return `<section class="tl-col pcol ${isMe(u) ? "me" : ""}" style="${whoVar(u)}">
      <header><span class="pc-av">${ui.avatar(nameOf(u))}</span><div><b>${esc(nameOf(u))}${isMe(u) ? `<small>${t("Tu")}</small>` : ""}</b><span>${esc(sub || t(open.length ? "tudo dentro do prazo" : "sem nada por fazer"))}</span></div>
        <i>${open.length}</i></header>
      ${body || `<p class="tl-empty">${t(isMe(u) ? "Não tens nada por fazer." : "Nada por fazer.")}</p>`}${pcBlock("Feitas hoje", did, "ok")}</section>`;
  };
  return `<div class="tl-cols pcols" style="--n:${Math.min(people.length, 4)}">${people.map(col).join("")}</div>`;
}

async function loadLists(board) {
  await mount(board, async () => {
    const [list, approvals] = await Promise.all([api("/api/tasks"), api("/api/approvals").catch(() => [])]);
    const all = list.filter((x) => !x.trashed_at);
    const withCo = companies.filter((c) => all.some((x) => x.company === c.id));
    if (taskCoFilter && taskCoFilter !== "none" && !withCo.some((c) => c.id === taskCoFilter)) taskCoFilter = "";
    const inCo = (x) => !taskCoFilter || (taskCoFilter === "none" ? !x.company : x.company === taskCoFilter);
    drawPeople(all.filter(inCo));
    paint($("task-filter"), coChips(withCo));
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
    const approve = waiting ? `<a class="tl-approve" href="#/aprovacoes">${icon("alert")}<span>${t(waiting === 1 ? "1 aprovação à espera" : "{n} aprovações à espera", { n: waiting })}</span>${icon("chevron")}</a>` : "";
    if (taskView === "pessoas") return approve + personCols(all.filter(inCo));
    return `${approve}
      <div class="tl-cols">
      ${col("Hoje", t("o que é para fazer já"), count(hoje), hoje.map(([title, l, tone]) => tlBlock(title, l, tone)).join(""), "Tudo feito por hoje.", count(hoje) && hoje[0][1].length ? "hot" : "")}
      ${col("Próximas", t("com prazo nos próximos dias"), count(prox), prox.map(([title, l]) => tlBlock(title, l)).join(""), "Nada marcado para os próximos dias.")}
      ${col("Feitas", t("as mais recentes primeiro"), done.length, tlBlock("Hoje", done.filter((x) => doneOn(x) <= 0), "ok", false) + tlBlock("Ontem", done.filter((x) => doneOn(x) === 1), "ok", false)
        + (older.length ? `<button class="tl-more" data-older-feitas>${t(showOlderFeitas ? "Esconder as anteriores" : "Ver as anteriores ({n})", { n: older.length })}</button>${showOlderFeitas ? tlBlock("Mais antigas", older.slice(0, 40), "ok", false) : ""}` : ""),
        "Ainda nada concluído.")}
      </div>`;
  }, 6);
}

async function classicBoard() {
  const board = $("board");
  if (!board) return;
  board.classList.toggle("is-lists", taskView !== "quadro");
  if (taskView !== "quadro") { $("bin")?.setAttribute("hidden", ""); return loadLists(board); }
  $("bin")?.removeAttribute("hidden");
  await mount(board, async () => {
    const all = (await api("/api/tasks")).filter((x) => !x.trashed_at); // what went into the bin as finished stays in the numbers, not on the board
    drawPeople(all);
    paint($("task-filter"), "");
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

// Tarefas, Aprovações, Semana and «Nova tarefa» live in hub/tarefas.js + .css, fetched the first time one of them opens.
const tqLoad = () => Promise.all([lazyFile("hub/tarefas.js"), lazyFile("hub/tarefas.css").catch(() => {})]);
// What changed a task (a window, a button, the live feed) asks the page on screen to show it again: Tarefas, the phone's
// Tarefas or Semana. Nothing is fetched when none of them is open.
function loadBoard() { if ($("board")) return classicBoard(); return typeof tqRefresh === "function" ? tqRefresh() : Promise.resolve(); }

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

// "Para quando?": a new task says when it is for. One press for today, tomorrow or the end of the week, a date of one's
// own, or "Sem prazo" chosen on purpose: a task used to be born with no date unless somebody remembered to give it one.
const dueAt = (days, hour = 18) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(hour, 0, 0, 0); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
function duePicker() {
  const weekday = new Date().getDay(), toFriday = (5 - weekday + 7) % 7;   // 0 on a Friday: then "this week" is today
  const picks = [["hoje", t("Hoje"), dueAt(0)], ["amanha", t("Amanhã"), dueAt(1)], ...(toFriday > 1 ? [["sexta", t("Sexta-feira"), dueAt(toFriday)]] : []),
    ["semana", t("Daqui a uma semana"), dueAt(7)], ["data", t("Outra data"), ""], ["none", t("Sem prazo"), ""]];
  return `<div class="field wide"><span>${t("Para quando?")}</span><div class="who" data-due><input type="hidden" name="deadline" value="">
    ${picks.map(([id, label, at]) => `<label class="who-opt"><input type="radio" name="due_pick" value="${id}" data-at="${at}"><span>${esc(label)}</span></label>`).join("")}</div>
    <input type="datetime-local" class="due-own" hidden aria-label="${t("Outra data")}">
    <small class="muted due-say">${t("Escolhe quando tem de estar feita. As de hoje, amanhã e sexta ficam para as 18:00.")}</small></div>`;
}
document.addEventListener("input", (e) => {
  const field = e.target.closest?.(".field")?.querySelector("[data-due]")?.closest(".field");
  if (!field || !(e.target.name === "due_pick" || e.target.classList.contains("due-own"))) return;
  const pick = field.querySelector('input[name="due_pick"]:checked'), own = field.querySelector(".due-own"), hidden = field.querySelector('input[name="deadline"]');
  own.hidden = pick?.value !== "data";
  if (pick?.value === "data" && !own.value && e.target !== own) own.value = dueAt(2);
  hidden.value = pick?.value === "data" ? own.value : pick?.dataset.at || "";
  field.querySelector(".due-say").textContent = pick?.value === "none" ? t("Sem prazo: fica em «Sem prazo» até alguém lhe dar uma data.")
    : hidden.value ? `${t("Prazo")}: ${new Date(hidden.value).toLocaleString("pt-PT", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}` : "";
});

// The description of a task, and a note, grow with what is written in them, up to most of the screen: a long text used to
// be read through a box three lines tall.
const growText = (el) => { el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight + 2, Math.round(innerHeight * 0.55))}px`; };
document.addEventListener("input", (e) => { if (e.target.matches?.('textarea[name="description"], .tnote-new textarea')) growText(e.target); });
new MutationObserver(() => document.querySelectorAll('#modal textarea[name="description"]:not([data-grown])').forEach((el) => { el.dataset.grown = "1"; growText(el); }))
  .observe(document.documentElement, { childList: true, subtree: true });   // a task opened for editing shows its whole text at once

function taskFields(x = {}, users = [], projects = [], sending = false) {
  const deadline = x.deadline ? new Date(new Date(x.deadline).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "";
  return (sending ? whoPicker(users, x.assignee || me.username) : "")
    + field("Título", `<input name="title" required value="${esc(x.title || "")}">`, true)
    + field("Descrição", `<textarea name="description">${esc(x.description || "")}</textarea>`, true)
    + (sending ? "" : field("Responsável", `<select name="assignee">${options(users.filter((u) => me.lead || u.username === me.username).map((u) => [u.username, u.display_name]), x.assignee || me.username)}</select>`))
    + field("Prioridade", `<select name="priority">${options(Object.entries(PRIORITY).map(([k, v]) => [k, t(v)]), x.priority || "normal")}</select>`)
    + field("Projeto", `<select name="project_id">${options([["", t("Sem projeto")], ...projects.map((p) => [p.id, p.name])], x.project_id)}</select>`)
    + field("Empresa", `<select name="company">${options([["", t("Sem empresa")], ...companies.map((c) => [c.id, c.name])], x.company)}</select>`)
    + (sending ? duePicker() : field("Prazo", `<input name="deadline" type="datetime-local" value="${deadline}">`))
    + field("Branch de git", `<input name="git_branch" value="${esc(x.git_branch || "")}" placeholder="ex: checkout-fix">`);
}
const taskBody = (v) => ({ title: v.title.trim(), description: v.description, assignee: v.assignee, priority: v.priority,
  project_id: v.project_id ? Number(v.project_id) : null, company: v.company || null,
  deadline: v.deadline ? new Date(v.deadline).toISOString() : null, git_branch: v.git_branch || "" });

/* ---- sending work. One window, made to direct it: what, who does it, for when. "Quem faz" is the office (the agents do
   it alone, at once, and the Hub says which of them by the words of the task) or a person (it waits in "Por fazer").
   The form before this one was a grid of eleven fields with a list of "kinds of agent". ---- */
const CREW_ICON = { batman: "code", lucius: "gear", riddler: "search", catwoman: "layers", joker: "trend", alfred: "check", robin: "target", gordon: "tasks" };
let officeCrew = null;
const loadCrew = async () => (officeCrew ||= await api("/api/tasks/crew"));
// Who of the office: "Automático" (the Hub chooses, crew.py) or one of them by name; under it, the line that says who takes it
const crewPicker = (crew, chosen = "") => `<p class="cmp-route idle" data-route aria-live="polite"></p>
  <details class="cmp-pick" ${chosen ? "open" : ""}><summary>${icon("users")}${t("Escolher outro agente")}</summary>
  <div class="cmp-crew" role="radiogroup" aria-label="${esc(t("Quem do escritório"))}">
    <label class="cmp-ag auto"><input type="radio" name="crew" value="" ${chosen ? "" : "checked"}><span>${icon("bolt")}<b>${t("Automático")}</b><em>${t("O escritório escolhe")}</em></span></label>
    ${crew.map((c) => `<label class="cmp-ag" data-crew="${esc(c.id)}"><input type="radio" name="crew" value="${esc(c.id)}" ${chosen === c.id ? "checked" : ""}><span>${icon(CREW_ICON[c.id] || "bot")}<b>${esc(c.name)}</b><em>${esc(t(c.what))}</em></span></label>`).join("")}</div></details>`;
// The line under the picker, asked of the Hub while the task is written: the answer is the one the task gets when it is
// sent. `ask()` gives what to ask; the returned function is called on every change (it waits for a pause in the typing).
function routeWatch(form, ask) {
  const line = form.querySelector("[data-route]");
  let timer = 0, turn = 0;
  const paint = (r, q) => {
    form.querySelectorAll(".cmp-ag.would").forEach((el) => el.classList.remove("would"));
    line.classList.toggle("idle", !r);
    if (!r) { line.textContent = t("Escreve a tarefa: o escritório diz logo quem a faz."); return; }
    if (!q.crew) form.querySelector(`.cmp-ag[data-crew="${r.crew}"]`)?.classList.add("would");
    line.innerHTML = `${icon(CREW_ICON[r.crew] || "bot")}<span>${t("Vai para")} <b>${esc(r.name)}</b> · ${esc(t(r.what))}</span>
      <em>${esc(r.ahead ? t(r.ahead === 1 ? "1 tarefa à frente no agente de {p}" : "{n} tarefas à frente no agente de {p}", { n: r.ahead, p: r.for }) : t("nada à frente no agente de {p}", { p: r.for }))}</em>`;
  };
  const say = async () => {
    const my = ++turn, q = ask();
    if (!q.title && !q.crew) return paint(null);
    try { const r = await api("/api/tasks/route", { method: "POST", body: q }); if (my === turn && line.isConnected) paint(r, q); }
    catch { if (my === turn) paint(null); }
  };
  return (now = false) => { clearTimeout(timer); timer = setTimeout(say, now ? 0 : 220); };
}
const cmpHead = (ic, title) => `<header class="cmp-head"><span>${icon(ic)}${esc(t(title))}</span><button type="button" class="btn quiet sm" data-close aria-label="${esc(t("Fechar"))}">${icon("x")}</button></header>`;

// «Nova tarefa» from anywhere in the Hub (Ctrl+K, Início, a project, the Escritório): the composer as a sheet (tarefas.js).
// preset: { for_ai (true or an old kind of agent), crew, assignee, project_id, company, priority, title, description }
async function newTask(preset = {}) {
  try { await tqLoad(); } catch (err) { flash(err.message); return; }
  return tqNewTask(preset);
}

// A task that exists, sent to the office with one touch: the Hub chooses the agent by the task's words (crew.sector_of)
// and the person's automatic agent starts it (Marco, 9 out: «não quero andar a escolher»).
async function sendToOffice(x) {
  try {
    const given = await api(`/api/tasks/${x.id}/assign-ai`, { method: "POST", body: { crew: "" } });
    flash(t("Mandada para o escritório: {n} · {s}.", { n: given.crew_name, s: t(given.crew_what) }));
    loadBoard(); openTaskModal(x.id);
  } catch (err) { flash(err.message); }
}
// The same, choosing who: the picker, with the task's own words deciding when nobody is named.
async function assignToAI(x) {
  const crew = await loadCrew();
  openModal(`<form class="cmp" id="cmp" autocomplete="off" data-mode="office">
    ${cmpHead("bot", "Entregar ao escritório")}
    <h3 class="cmp-what">${esc(x.title)}</h3>
    <section class="cmp-sec"><h4>${t("Quem faz")}</h4><div class="cmp-pane">${crewPicker(crew, x.crew || "")}</div></section>
    <section class="cmp-sec">${field("Instruções para o agente (opcional)", `<textarea name="instructions" placeholder="${esc(t("Como deve trabalhar nesta tarefa"))}">${esc(x.agent_instructions || "")}</textarea>`)}
      <p class="cmp-note">${esc(t("Corre no agente local de {nome}: arranca o Claude sozinho, pode usar subagentes e pede aprovação antes de qualquer ação sensível.", { nome: nameOf(x.assignee) }))}</p></section>
    <p class="error" id="cmp-error"></p>
    <footer class="cmp-foot"><span class="cmp-key">${t("Ctrl + Enter envia")}</span><button type="button" class="btn quiet" data-close>${t("Cancelar")}</button><button class="btn primary" id="cmp-go">${esc(t("Entregar"))}${icon("arrow")}</button></footer></form>`);
  const form = $("cmp"), go = $("cmp-go");
  $("modal-box").classList.add("cmp-box");
  const read = () => Object.fromEntries(new FormData(form).entries());
  const watch = routeWatch(form, () => ({ title: x.title, description: x.description || "", crew: read().crew || "", assignee: x.assignee, task_id: x.id }));
  form.addEventListener("change", () => watch(true));
  form.onkeydown = (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); form.requestSubmit(); } };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const v = read();
    go.disabled = true;
    try {
      const given = await api(`/api/tasks/${x.id}/assign-ai`, { method: "POST", body: { crew: v.crew || "", instructions: v.instructions } });
      flash(t("Entregue ao escritório: {n} · {s}.", { n: given.crew_name, s: t(given.crew_what) }));
      closeModal();
      loadBoard(); openTaskModal(x.id);
    } catch (err) { $("cmp-error").textContent = err.message; go.disabled = false; }
  };
  watch(true);
}

// A task's text, made to be read: what people type as plain lines becomes paragraphs, numbered and dotted lists, small
// headings over a list, and links one can click. Everything is escaped first; only these few tags are added here.
function richText(text) {
  const line = (s) => esc(s).replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)\]]/g, (url) => `<a href="${url}" target="_blank" rel="noopener">${url.replace(/^https?:\/\/(www\.)?/, "")}</a>`);
  const numbered = /^\s*\d+[.)]\s+/, dotted = /^\s*[-•*–]\s+/;
  const list = (lines) => (lines.every((l) => numbered.test(l)) ? `<ol>${lines.map((l) => `<li value="${parseInt(l, 10)}">${line(l.replace(numbered, ""))}</li>`).join("")}</ol>`   // each keeps the number it was written with: people refer to them
    : lines.every((l) => dotted.test(l)) ? `<ul>${lines.map((l) => `<li>${line(l.replace(dotted, ""))}</li>`).join("")}</ul>` : "");
  return String(text || "").replace(/\r/g, "").split(/\n\s*\n/).map((block) => {
    const lines = block.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim());
    if (!lines.length) return "";
    if (list(lines)) return list(lines);
    const [first, ...rest] = lines;   // a short line over a list is that list's heading
    if (rest.length && list(rest) && first.length <= 70) return `<h5>${line(first.replace(/:$/, ""))}</h5>${list(rest)}`;
    return `<p>${lines.map(line).join("<br>")}</p>`;
  }).join("");
}

// "Estou a fazer": the person a task is for says they are on it, and everybody sees it here, on the team and on the rows,
// so two people never do the same thing. Once somebody is on it: their photo in the turning ring, their name, since when.
// Yours, not started: one chrome button. A tap changes it at once (doingCard is drawn before the Hub answers).
const sinceOf = (iso) => (new Date(iso).toDateString() === new Date().toDateString() ? fmt.hhmm(iso) : `${fmt.day(iso)} ${fmt.hhmm(iso)}`);
const doingGo = () => `<button class="tv-doing go" data-act="doing">${icon("play")}<span><b>${t("Estou a fazer isto")}</b><small>${t("A equipa vê que é contigo")}</small></span></button>`;
const doingCard = (name, since, mine, pop = false) => `<div class="tv-doing on ${pop ? "popin" : ""}"><span class="dl-ring">${ui.avatar(name, "lg")}</span>
  <div><small>${t("A fazer agora")}</small><b>${esc(name)}</b><span>${t(mine ? "Estás a fazer esta tarefa" : "Está a fazer esta tarefa")} · ${t("desde")} ${sinceOf(since)}</span></div>
  ${mine ? `<button class="tv-doing-stop" data-act="notdoing">${icon("pause")}${t("Parar")}</button>` : ""}</div>`;
function doingBanner(x, held) {
  if (x.stage === "done" || held) return "";
  const mine = x.assignee === me.username;
  if (x.doing_since) return doingCard(nameOf(x.assignee), x.doing_since, mine);
  const other = x.group && x.group.find((y) => y.doing_since && y.stage !== "done" && y.assignee !== x.assignee);
  return (other ? doingCard(nameOf(other.assignee), other.doing_since, false) : "") + (mine ? doingGo() : "");
}
// Opening a task you were sent reads the "new task" notice about it, so the big card on the home page goes away everywhere.
function markTaskSeen(x) {
  if (x.assignee !== me.username || !x.created_by || x.created_by === me.username) return;
  request_("/api/notifications?limit=100").then((inbox) => {
    const ids = inbox.items.filter((n) => !n.read && n.kind === "task_new" && n.href === `#/tarefas/${x.id}`).map((n) => n.id);
    if (ids.length) return api("/api/notifications/read", { method: "POST", body: { ids } });
  }).catch(() => { /* the card simply stays until the next time */ });
}
async function openTaskModal(id) {
  let x, all;
  try { [x, all] = await Promise.all([request_(`/api/tasks/${id}`), request_("/api/tasks")]); } catch (e) { flash(e.message); return; }
  markTaskSeen(x);
  const group = groupAll(all.filter((y) => !y.trashed_at)).find((g) => g.group && g.group.some((y) => y.id === x.id))?.group;
  const held = heldByAgent(x), running = ["IN_PROGRESS", "WAITING_APPROVAL"].includes(x.status);
  // The window of a task, made to be read from top to bottom: the title, a line of facts that only says what the task has
  // (no table of dashes), what can be done with it, then its text. The deadline and the history are folded underneath.
  const late = x.stage !== "done" && x.deadline && new Date(x.deadline) < new Date();
  const company = companies.find((c) => c.id === x.company)?.name;
  // The facts are all there, but small, in one quiet line under the text: a late deadline or an urgent task is coloured, not bigger.
  const meta = (ic, value, cls = "", label = "") => `<span class="tm ${cls}"${label ? ` title="${esc(t(label))}"` : ""}>${icon(ic)}${value}</span>`;
  const metas = [
    x.priority === "urgent" || x.priority === "high" ? meta("flag", t(PRIORITY[x.priority]), x.priority === "urgent" ? "bad" : "warn", "Prioridade") : "",
    x.deadline ? meta("calendar", `${late ? `${t("Atrasada desde")} ` : ""}${fmt.date(x.deadline)} ${fmt.hhmm(x.deadline)}`, late ? "bad" : "", "Prazo")
      : x.stage !== "done" ? meta("calendar", t("Sem prazo"), "dim", "Prazo") : "",
    x.project_name || x.project ? meta("folder", esc(x.project_name || x.project), "", "Projeto") : "",
    company ? meta("building", esc(company), "", "Empresa") : "",
    x.crew_name ? meta(CREW_ICON[x.crew] || "bot", `${esc(x.crew_name)} · ${esc(t(x.crew_what))}`, "", "Agente")
      : x.agent_role ? meta("bot", esc(t(ROLES[x.agent_role])), "", "Agente") : "",
    group ? `<span class="tm">${whoFaces(group)}${esc(whoLeft(group))}</span>` : "",
    x.stage === "done" && !group && x.completed_by ? meta("check", `${t("Concluída por")} ${esc(nameOf(x.completed_by))}${x.completed_at ? ` · ${fmt.day(x.completed_at)} ${fmt.hhmm(x.completed_at)}` : ""}`, "ok") : "",
    x.created_at ? meta("clock", `${t("Criada")} ${fmt.day(x.created_at)} ${fmt.hhmm(x.created_at)}`, "dim") : ""].filter(Boolean).join("");
  const steps = x.events.filter((e) => e.kind !== "note");
  const buttons = `${canGiveToAI(x) ? ui.btn("Mandar para o escritório", "data-act=ai", "primary", "bot") + ui.btn("Escolher o agente", "data-act=ai-pick", "quiet", "users") : ""}
    ${running ? ui.btn("Pausar", "data-act=pause", "", "pause") + ui.btn("Parar", "data-act=stop", "danger", "stop") : ""}
    ${x.status === "PAUSED" || x.status === "NEEDS_HELP" ? ui.btn("Retomar", "data-act=resume", "", "play") + ui.btn("Parar", "data-act=stop", "danger", "stop") : ""}
    ${!held && x.stage !== "done" ? ui.btn("Concluir", "data-act=done", "ok", "check") : ""}
    ${ui.btn("Editar", "data-act=edit", "quiet")}`;
  // The window reads like a letter. On top, small: who sent it to whom ("KOVEL › TU", in their colours) and where it stands.
  // Then what matters, big: the title and the text. Then the buttons. The facts and the folds come last, quietly.
  const sender = x.created_by && (group || x.created_by !== x.assignee) ? x.created_by : "";
  const from = sender ? `<span class="tv-sender" style="${whoVar(sender)}" title="${esc(t("Pedida por {n}", { n: nameOf(sender) }))}">${ui.avatar(nameOf(sender), "sm")}<b>${esc(isMe(sender) ? t("Tu") : nameOf(sender))}</b></span><i class="tv-arrow">${icon("chevron")}</i>` : "";
  const stage = group ? [t("{a} de {b} feito", { a: group.filter((y) => y.stage === "done").length, b: group.length }), group.every((y) => y.stage === "done") ? "ok" : ""]
    : x.doing_since && x.stage !== "done" ? [t("A fazer"), "ok"] : [t(STAGE_LABEL[x.stage]), STAGE_TONE[x.stage]];
  const part = (label, html, cls = "") => `<section class="tv-part ${cls}"><small>${t(label)}</small><div class="tread">${html}</div></section>`;
  openModal(`<article class="tview letter" style="${group ? "" : whoVar(x.assignee)}">
    <header class="tv-top"><div class="tv-route">${from}${group ? allPlate(group) : whoPlate(x.assignee)}</div>${ui.tag(stage[0], stage[1])}
      ${canTrash(x) && !group ? `<button type="button" class="tv-del" data-act="trash" title="${t("Apagar tarefa")}">${icon("trash")}<span>${t("Apagar?")}</span></button>` : ""}
      <button class="btn quiet sm" data-close aria-label="${t("Fechar")}">${icon("x")}</button></header>
    <h2 class="tv-title">${x.priority === "urgent" ? '<i class="bang">!!</i>' : x.priority === "high" ? '<i class="bang high">!</i>' : ""}${esc(x.title)}</h2>
    <section class="tv-msg">${x.description ? `<div class="tread">${richText(x.description)}</div>` : `<p class="tv-none">${t("Sem descrição: o título diz tudo.")}</p>`}
      ${x.goal ? part("Objetivo", richText(x.goal)) : ""}
      ${x.requirements?.length ? part("O que tem de ficar feito", `<ul>${x.requirements.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>`) : ""}
      ${x.result ? part("Resultado", richText(x.result), "ok") : ""}</section>
    ${x.progress > 0 && x.stage !== "done" ? `<div class="rowx tv-prog"><div class="grow">${ui.progress(x.progress, "ai")}</div><span class="mono">${x.progress}%</span></div>` : ""}
    ${x.current_action && running ? `<div class="now">${esc(x.current_action)}</div>` : ""}
    ${x.blocked_reason ? `<p class="msg note tv-blocked">${esc(x.blocked_reason)}</p>` : ""}
    ${doingBanner(x, held)}
    <div class="tv-acts">${buttons}
      ${held ? "" : `<label class="tv-state">${t("Estado")}<select id="task-status">${options([["", t("mudar…")], ["TODO", t("Por fazer")], ["BLOCKED", t("Bloqueada")], ["REVIEW", t("Em revisão")], ["COMPLETED", t("Concluída")]], "")}</select></label>`}</div>
    <footer class="tv-meta">${metas}</footer>
    ${group ? `<details class="tv-fold"><summary>${icon("users")}${t("Quem já fez")} · ${esc(whoLeft(group))}</summary>
      <div class="who-list">${group.map((y) => {
        const on = y.doing_since && y.stage !== "done";
        return `<div class="who-line ${y.stage === "done" ? "did" : ""} ${on ? "doing" : ""}">${on ? `<span class="dl-ring">${ui.avatar(nameOf(y.assignee), "sm")}</span>` : whoFace(y, "")}<div><b>${esc(nameOf(y.assignee))}${y.assignee === me.username ? ` <small>${t("tu")}</small>` : ""}</b>
        <span>${y.stage === "done" ? `${t("Feito")}${y.completed_at ? ` · ${fmt.day(y.completed_at)} ${fmt.hhmm(y.completed_at)}` : ""}${y.completed_by && y.completed_by !== y.assignee ? ` · ${t("por")} ${esc(nameOf(y.completed_by))}` : ""}`
          : on ? `<em class="doing-txt">${t("A fazer agora")} · ${t("desde")} ${sinceOf(y.doing_since)}</em>` : esc(t(STAGE_LABEL[y.stage]))}</span></div></div>`;
      }).join("")}</div></details>` : ""}
    ${x.stage !== "done" ? `<details class="tv-fold tdue ${late ? "late" : ""}"><summary>${icon("calendar")}${t(x.deadline ? "Mudar o prazo" : "Dar um prazo")}</summary>
      <div class="tdue-in"><input type="datetime-local" id="task-due" value="${x.deadline ? new Date(new Date(x.deadline).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ""}" aria-label="${t("Prazo")}">
        <div class="tdue-quick">${[["Hoje 18:00", 0], ["Amanhã 18:00", 1], ...((5 - new Date().getDay() + 7) % 7 > 1 ? [["Sexta 18:00", (5 - new Date().getDay() + 7) % 7]] : []), ["Daqui a 1 semana", 7]]
          .map(([label, days]) => `<button type="button" class="chp" data-due-days="${days}">${t(label)}</button>`).join("")}</div>
        ${ui.btn("Guardar prazo", "data-act=due", "sm primary")}${x.deadline ? ui.btn("Tirar prazo", "data-act=nodue", "sm quiet") : ""}</div>
      <p class="tdue-now">${t("Passado o dia e a hora do prazo, a tarefa fica atrasada.")}</p></details>` : ""}
    <details class="tv-fold"><summary>${icon("history")}${t("Histórico e pormenores")}</summary>
      <div class="hist">${(x.log || []).map((e) => `<div class="hist-row">${ui.avatar(e.name, "sm")}<div><b>${esc(e.name)}</b> ${esc(group && e.kind === "task_created" ? t("criou a tarefa para todos") : e.message)}
        <time>${fmt.day(e.at)} ${fmt.hhmm(e.at)}</time></div></div>`).join("") || `<p class="faint" style="margin:0">${t("Sem registo.")}</p>`}</div>
      ${steps.length ? `<small class="tv-sub">${t("O que a IA fez")}</small><div class="tl">${ui.feed(steps.slice(-30).map((e) => ({ at: e.created_at, text: e.message,
        tone: e.kind === "error" ? "bad" : e.kind === "decision" ? "warn" : e.kind === "result" ? "ok" : "ai" })))}</div>` : ""}
      ${x.git_branch || x.ai_cost_usd != null ? `<dl class="kv" style="grid-template-columns:104px minmax(0,1fr);margin:14px 0 0">
        ${x.git_branch ? `<dt>Branch</dt><dd><span class="mono">${esc(x.git_branch)}</span></dd>` : ""}
        ${x.ai_cost_usd != null ? `<dt>${t("Custo de IA")}</dt><dd>${fmt.usd(x.ai_cost_usd)} ${ui.src("estimated")}</dd>` : ""}</dl>` : ""}
      ${x.sessions.length ? `<small class="tv-sub">${t("Sessões de IA")}</small><div class="panel">${x.sessions.slice(0, 4).map((s) => `<div class="rw">${ui.status(s.status)}<div class="rw-main"><b class="mono">${fmt.tokens(s.tokens.total)} tokens</b>
        <span>${esc(s.model || "—")} · ${fmt.span(s.started_at, s.finished_at)}</span></div></div>`).join("")}</div>` : ""}
      ${x.approvals.length ? `<small class="tv-sub">${t("Aprovações")}</small><div class="panel">${x.approvals.slice(0, 4).map((a) => `<a class="rw" href="#/aprovacoes" data-close><div class="rw-main"><b>${esc(a.action)}</b>
        <span>${t({ PENDING: "pendente", APPROVED: "aprovado", REJECTED: "recusado" }[a.status])}</span></div></a>`).join("")}</div>` : ""}
    </details></article>`);
  $("modal-box").classList.add("wide");
  $("modal-box").onclick = async (e) => {
    const quick = e.target.closest("[data-due-days]");
    if (quick) { $("task-due").value = dueAt(Number(quick.dataset.dueDays)); return; }   // fills the field; "Guardar prazo" keeps it
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (!act) return;
    if (act === "trash") {   // the first press asks («Apagar?» in red), the second deletes
      const bin = e.target.closest("[data-act]");
      if (!bin.classList.contains("confirm")) { bin.classList.add("confirm"); setTimeout(() => bin.classList.remove("confirm"), 4000); return; }
      closeModal();
      return trashTaskUndo(x.id, x.title, x.stage === "done" ? "done" : "mistake");
    }
    if (act === "due" || act === "nodue") {
      const value = act === "due" ? $("task-due").value : "";
      if (act === "due" && !value) return flash(t("Escolhe o dia e a hora do prazo."));
      try {
        await api(`/api/tasks/${x.id}`, { method: "PATCH", body: { deadline: value ? new Date(value).toISOString() : null } });
        flash(t(value ? "Prazo guardado." : "Prazo tirado.")); loadBoard(); openTaskModal(x.id);
      } catch (err) { flash(err.message); }
      return;
    }
    if (act === "ai") return sendToOffice(x);
    if (act === "ai-pick") return assignToAI(x);
    if (act === "doing" || act === "notdoing") {
      // the change shows under the finger first (dark card, your photo and name), then the Hub is told; if it says no, the
      // window is drawn again from what the Hub has
      const el = e.target.closest("[data-act]"), box = el.closest(".tv-doing") || el;
      el.disabled = true; el.classList.add("press"); navigator.vibrate?.(14);
      box.outerHTML = act === "doing" ? doingCard(me.display_name, new Date().toISOString(), true, true) : doingGo();
      try {
        await api(`/api/tasks/${x.id}`, { method: "PATCH", body: { doing: act === "doing" } });
        flash(t(act === "doing" ? "A equipa já vê que estás a fazer isto." : "Paraste esta tarefa.")); loadBoard();
      } catch (err) { flash(err.message); openTaskModal(x.id); }
      return;
    }
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
  await tqLoad(); // the composer of «Nova tarefa» lives there
  page(`${ui.head("Comando", t("Tarefas"), t("Cada sócio tem a sua cor, e as tuas dizem TU. Carrega numa pessoa para ver só as dela."),
    `<div class="segx" id="task-view">${[["pessoas", "Por pessoa"], ["lista", "Por prazo"], ["quadro", "Quadro"]].map(([v, l]) => `<button data-view="${v}" class="${v === taskView ? "on" : ""}">${t(l)}</button>`).join("")}</div>
    ${ui.btn("Nova tarefa", "data-new-task", "primary", "plus")}`)}
    <div id="task-kpis" class="tk-kpis"></div><div class="pstrip" id="task-people"></div><div class="chipbar" id="task-filter"></div><div class="board" id="board"></div><div class="bin" id="bin"></div>`);
  const view = $("view");
  view.onclick = (e) => {
    if (e.target.closest("[data-new-task]")) return newTask();
    if (e.target.closest("[data-bin-open]")) return openBin();
    const chip = e.target.closest("#task-people [data-u]");
    if (chip) { taskFilter = chip.dataset.u === taskFilter ? "" : chip.dataset.u; $("board")._html = null; $("task-people")._html = null; return loadBoard(); }
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
    const fold = e.target.closest("[data-tl-open]");
    if (fold) { tlOpen.has(fold.dataset.tlOpen) ? tlOpen.delete(fold.dataset.tlOpen) : tlOpen.add(fold.dataset.tlOpen); $("board")._html = null; return loadBoard(); }
    const office = e.target.closest(".tl-row [data-office]");
    if (office) {
      office.disabled = true;
      api(`/api/tasks/${office.dataset.office}/assign-ai`, { method: "POST", body: { crew: "" } })
        .then((given) => flash(t("Mandada para o escritório: {n} · {s}.", { n: given.crew_name, s: t(given.crew_what) })), (err) => flash(err.message)).finally(loadBoard);
      return;
    }
    const del = e.target.closest("[data-trash]");
    if (del) {
      del.disabled = true; del.closest(".tl-row, .tk")?.classList.add("finishing");
      return trashTaskUndo(Number(del.dataset.trash), del.dataset.title, del.dataset.reason);
    }
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
  loadTaskKpis();
  await loadBoard();
  const linked = Number(r.company) || openTask;
  if (linked) { openTask = null; openTaskModal(linked); }
};
onLive(["task", "tick"], loadBoard);
/* The Painel's row of figures over the tasks (27 Oct): only on top, the board and the lists stay as they were (24 Oct). */
async function loadTaskKpis() {
  if (!$("task-kpis")) return;
  await mount($("task-kpis"), async () => {
    const all = (await api("/api/tasks")).filter((x) => !x.trashed_at);
    const isOpen = (x) => !["COMPLETED", "STOPPED"].includes(x.status);
    const open = all.filter(isOpen), doneAt = (x) => (x.status === "COMPLETED" ? x.completed_at : null);
    const late = open.filter((x) => x.deadline && new Date(x.deadline) < new Date());
    const today = open.filter((x) => x.deadline && sameDay(x.deadline));
    const done7 = series.inPeriod(all, doneAt, 0, 7), made7 = series.inPeriod(all, (x) => x.created_at, 0, 7);
    return kpiRow([
      kpi("Abertas", open.length, { sub: t("{n} criadas nos últimos 7 dias", { n: made7 }),
        delta: ui.delta(made7, series.inPeriod(all, (x) => x.created_at, 7, 14), { label: t("criadas, contra a semana antes") }),
        viz: ui.spark(series.byDay(all, (x) => x.created_at, 14).map((d) => d.value)) }),
      kpi("Concluídas · 7 dias", done7, { sub: t("{n} hoje", { n: all.filter((x) => doneAt(x) && sameDay(x.completed_at)).length }),
        delta: ui.delta(done7, series.inPeriod(all, doneAt, 7, 14), { label: t("contra a semana antes") }),
        viz: ui.cols(series.byDay(all, doneAt, 7).map((d) => d.value)) }),
      kpi("Para hoje", today.length, { sub: today.length ? today.slice(0, 2).map((x) => x.title).join(" · ") : t("nada com prazo hoje") }),
      ui.kpi({ label: "Atrasadas", value: late.length, cls: `vw-kpi ${late.length ? "bad" : ""}`, sub: late.length ? t("passaram do prazo") : t("tudo dentro do prazo"),
        viz: ui.ring(open.length ? (late.length / open.length) * 100 : null) })]);
  }, 2);
}
onLive(["task", "tick"], loadTaskKpis);

/* ================================================================ approvals */
// The policy the agent follows (agent/team_agent/permissions/policy.py) is said in plain words on the page (tarefas.js, TQ_RULES).
function diffHtml(diff) {
  return `<pre class="diff">${diff.split("\n").map((line) => {
    const cls = line.startsWith("@@") ? "hunk" : line.startsWith("+") && !line.startsWith("+++") ? "add" : line.startsWith("-") && !line.startsWith("---") ? "del" : "";
    return cls ? `<span class="${cls}">${esc(line)}</span>` : esc(line) + "\n";
  }).join("")}</pre>`;
}

function loadApprovalsPage() { return typeof tqPaintApprovals === "function" ? tqPaintApprovals() : Promise.resolve(); }
HUB_VIEWS.aprovacoes = async function () {
  await tqLoad();
  return tqApprovals();
};
onLive(["approval", "tick"], loadApprovalsPage);

/* ================================================================ what these pages share (their look is hub/pages.css) */
const pagesCss = () => lazyFile("hub/pages.css").catch(() => {});
pagesCss();   // asked for as the Hub opens, so these pages never show without their look
// Tokens as the Escritório says them: 524k, 1,2M
const tok = (n) => (n == null ? null : n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(".", ",")}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
// A figure on top of a page: the label in small capitals, the number in serif, and under it a short line and where it comes from.
// Since 27 Oct it is the Painel's figure (ui.kpi, hub/painel.css): delta is the change chip, viz a small chart, go the link.
function kpi(label, value, { sub = "", src = "", href = "", delta = "", viz = "", go = "" } = {}) {
  return ui.kpi({ label, value, sub, src, href, delta, viz, go, cls: "vw-kpi" });
}
const kpiRow = (cards) => `<div class="vw-kpis pn-kpis">${cards.join("")}</div>`;
const limitTone = (pct) => (pct == null ? "none" : pct >= 90 ? "bad" : pct >= 75 ? "warn" : "");
const bar = (pct, tone = "") => `<i class="vw-bar ${tone}"><u style="width:${Math.max(0, Math.min(100, Number(pct) || 0)).toFixed(1)}%"></u></i>`;
const sameDay = (iso) => !!iso && new Date(iso).toDateString() === new Date().toDateString();
const winTokens = (s) => (s.tokens || 0) + (s.agents || []).reduce((n, a) => n + (a.tokens || 0), 0);
// a window worth a line: open, or one that did something (the agent's own short runs end with nothing in them)
const worthy = (s) => s.state !== "ended" || winTokens(s) > 0;
// The Claude plan of each person as their PC last read it; this PC's own, fresher, read straight, as in the side panel.
async function planLimits() {
  const [team, mine] = await Promise.all([api("/api/limits/team").catch(() => ({})), api("/api/limits").catch(() => null)]);
  const out = { ...(team || {}) };
  if (mine?.claude) out[me.username] = { ...mine.claude, seen: new Date(mine.claude.saved_at * 1000).toISOString() };
  return out;
}
// A page that follows the Claude windows redraws at most every few seconds: a window at work sends a step every 2 s.
function calm(fn, ms = 8000) {
  let last = 0, timer = 0;
  return () => {
    const wait = last + ms - Date.now();
    if (wait <= 0) { last = Date.now(); return fn(); }
    clearTimeout(timer);
    timer = setTimeout(() => { last = Date.now(); fn().catch(() => {}); }, wait);
    return Promise.resolve();
  };
}

// The automatic agent runs (WORKING...); ONLINE is only the widget or an open page (CLAUDE.md, «Agente automático ligado»).
const AGENT_ON = ["WORKING", "IDLE", "WAITING", "PAUSED", "ERROR"];
// A Claude Code window (the Escritório's /api/office): its state in words
const CLAUDE_ST = { working: ["busy", "A trabalhar"], waiting: ["wait", "À espera"], idle: ["ok", "Aberta"], stalled: ["wait", "Parada"], ended: ["off", "Fechada"] };
const WAIT_SAY = { permission: "Pede autorização", answer: "Fez uma pergunta", done: "Acabou" };
function claudeSt(s) {
  const [tone, label] = CLAUDE_ST[s.state] || ["off", s.state];
  const waiting = s.state === "waiting" && WAIT_SAY[s.wait];
  return `<span class="st ${s.state === "waiting" && s.wait === "done" ? "ok" : tone}"><i></i>${t(waiting || label)}</span>`;
}
const WIN_ORDER = { working: 0, waiting: 1, stalled: 2, idle: 3, ended: 4 };
const byWork = (x, y) => (WIN_ORDER[x.state] ?? 5) - (WIN_ORDER[y.state] ?? 5) || String(y.updated_at).localeCompare(String(x.updated_at));
// One Claude Code window in a line: what it is about, what it does now (or what it used), its state.
function winRow(s, who = false) {
  const n = winTokens(s), busy = s.state === "working" || s.state === "waiting";
  return `<a class="vw-win" href="#/escritorio">${who ? ui.avatar(s.name, "sm") : ""}<div><b>${esc(s.topic || s.prompt || s.title || t("Janela sem pedido"))}</b>
    <span>${esc([who ? s.name : "", busy && s.action ? s.action : "", s.project, n ? `${tok(n)} tokens` : ""].filter(Boolean).join(" · "))}</span></div>${claudeSt(s)}</a>`;
}

/* ================================================================ agents */
const SUBAGENT_ROLES = [["research", "Pesquisa", "Lê o workspace e relata factos. Não altera nada."], ["coding", "Código", "Faz uma alteração concreta e diz que ficheiros mudou."],
  ["testing", "Testes", "Corre os testes ou o lint e relata o que falhou."], ["review", "Revisão", "Lê a alteração e aponta problemas antes de fechar."]];
const subName = (s) => SUBAGENT_ROLES.find(([id]) => id === s.role)?.[1] || s.name || s.role || "Subagente";
const subsHtml = (subs) => subs.map((s) => `<div class="sub">${ui.status(s.status, " ")}<b>${esc(t(subName(s)))}</b><span class="dim ell grow">${esc(s.task)}</span>
  <span class="mono faint">${s.total_tokens == null ? "" : fmt.tokens(s.total_tokens)}</span></div>`).join("");
const SESSION_KIND = { task: "Tarefa", chat: "Pergunta no Hub", weekly_report: "Relatório semanal" };
const sessionRow = (x) => `<a class="rw" href="#/agentes/${esc(x.user)}">${ui.status(x.status)}<div class="rw-main"><b>${esc(x.user_name)} · ${esc(t(SESSION_KIND[x.kind] || x.kind))}${x.task_id ? ` #${x.task_id}` : ""}</b>
  <span>${esc(x.model || "—")} · ${fmt.day(x.started_at)} ${fmt.hhmm(x.started_at)} · ${fmt.span(x.started_at, x.finished_at)}${x.subagents?.length ? ` · ${x.subagents.length} ${t("subagentes")}` : ""}</span></div>
  <span class="mono dim">${tok(x.tokens.total)}</span>${x.cost_usd == null ? "" : `<span class="mono vw-cost">${fmt.usd(x.cost_usd)}</span>`}</a>`;

// A person's automatic agent: on or off, what it is doing, its session and subagents, and how many Claude windows they have open.
function agentCard(a, wins) {
  const on = AGENT_ON.includes(a.status), working = a.status === "WORKING", s = a.session;
  const open = wins.filter((w) => w.user === a.user && w.state !== "ended").length;
  const seen = a.status === "OFFLINE" ? t("{n} está offline · visto {q}", { n: a.display_name, q: fmt.ago(a.last_seen) }) : t("{n} está online", { n: a.display_name });
  const hint = on ? { IDLE: "Ligado e livre: começa sozinho a próxima tarefa que for para o escritório.", PAUSED: "Em pausa: abre a tarefa para a retomar.",
    ERROR: "A última tarefa deu erro: abre-a para ver o que se passou.", WAITING: "À espera de uma resposta ou de uma aprovação." }[a.status]
    : isMe(a.user) ? "O teu agente está desligado. Liga-o no widget (Agente automático) e o escritório faz as tuas tarefas sozinho."
      : "Desligado: as tarefas do escritório para {n} esperam até ele o ligar no PC dele.";
  const body = working && a.task ? `<div class="vw-agent-task"><small>${t("A fazer")}</small><b>${esc(a.task)}</b>${ui.progress(a.progress, "ai")}
      ${s?.current_action || a.current_action ? `<span>${esc(s?.current_action || a.current_action)}</span>` : ""}</div>`
    : `<p class="vw-hint">${esc(t(hint || "", { n: a.display_name }))}</p>`;
  return `<a class="panel hover vw-agent ${on ? "on" : "off"}" href="#/agentes/${esc(a.id)}">
    <header>${ui.avatar(a.display_name, "ai")}<div><b>${esc(a.name)}</b><span>${esc(seen)}</span></div>${on ? ui.status(a.status) : `<span class="st off"><i></i>${t("Desligado")}</span>`}</header>
    ${body}
    ${s ? `<dl class="vw-facts"><div><dt>${t("Modelo")}</dt><dd>${esc(s.model || "—")}</dd></div><div><dt>Tokens</dt><dd>${tok(s.tokens.total)}</dd></div><div><dt>${t("Há")}</dt><dd>${fmt.span(s.started_at)}</dd></div></dl>` : ""}
    ${a.subagents.length ? `<div class="subs">${subsHtml(a.subagents)}</div>` : ""}
    <footer>${icon("monitor")}<span>${open ? t(open === 1 ? "1 janela do Claude aberta" : "{n} janelas do Claude abertas", { n: open }) : t("Nenhuma janela do Claude aberta")}</span></footer></a>`;
}

async function loadAgentsPage() {
  if (!$("agents-grid")) return;
  await mount($("agents-grid"), async () => {
    const [agents, office, sessions] = await Promise.all([api("/api/agents"), api("/api/office").catch(() => null), api("/api/sessions?limit=8").catch(() => [])]);
    if (!agents.length) return `<div class="panel">${ui.empty("bot", "Sem agentes", "Cada pessoa da equipa tem o seu agente: aparece aqui quando a pessoa entra no Hub.")}</div>`;
    const wins = office?.sessions || [], live = wins.filter((s) => s.state !== "ended").sort(byWork);
    const on = agents.filter((a) => AGENT_ON.includes(a.status));
    const subs = wins.flatMap((s) => s.agents || []).filter((x) => sameDay(x.started_at));
    const today = wins.filter((s) => sameDay(s.updated_at)).reduce((n, s) => n + winTokens(s), 0);
    return kpiRow([
        kpi("Agentes ligados", `${on.length}/${agents.length}`, { sub: on.length ? on.map((a) => a.display_name).join(", ") : t("nenhum agente automático ligado"),
          viz: ui.ring((on.length / agents.length) * 100) }),
        kpi("Janelas do Claude", office ? live.length : null, { sub: t("{n} a trabalhar agora", { n: live.filter((s) => s.state === "working").length }), href: "#/escritorio",
          viz: office ? ui.cols(series.byDay(wins, (s) => s.started_at, 7).map((d) => d.value)) : "" }),
        kpi("Subagentes hoje", office ? subs.length : null, { sub: t("{n} a correr", { n: subs.filter((x) => x.state === "working").length }),
          viz: office ? ui.cols(series.byDay(wins.flatMap((s) => s.agents || []), (x) => x.started_at, 7).map((d) => d.value)) : "" }),
        kpi("Tokens hoje", office ? tok(today) || "0" : null, { src: office ? "live" : "not_connected", href: "#/uso",
          viz: office ? ui.spark(series.byDay(wins, (s) => s.updated_at, 7, winTokens).map((d) => d.value)) : "" })])
      + (office && wins.length ? `<div class="pn-split" style="margin-top:14px">
          <div class="panel pad"><div class="pn-card-h">${t("Janelas a trabalhar")}<small>${t("agora")}</small></div>
            ${ui.gauge(live.filter((s) => s.state === "working").length, Math.max(1, live.length), { text: String(live.filter((s) => s.state === "working").length), of: t("de {n} abertas", { n: live.length }) })}</div>
          <div class="panel pad"><div class="pn-card-h">${t("Tokens do Claude por dia")}<small>${t("pelo dia em que a janela mexeu pela última vez")}</small></div>
            ${ui.bars(series.byDay(wins, (s) => s.updated_at, 7, winTokens), { fmtV: (v) => `${tok(v) || "0"} tokens` })}</div></div>` : "")
      + ui.sec("Agente automático de cada um") + `<div class="vw-agents">${agents.map((a) => agentCard(a, wins)).join("")}</div>`
      + ui.sec("Janelas do Claude abertas", `<a class="vw-link" href="#/escritorio">${t("Ver no Escritório")}${icon("chevron")}</a>`)
      + (live.length ? `<div class="panel vw-wins">${live.map((s) => winRow(s, true)).join("")}</div>`
        : `<div class="panel">${ui.empty("monitor", "Nenhuma janela do Claude aberta", "Quando alguém abre o Claude Code no PC, a janela aparece aqui e no Escritório, com o que está a fazer.",
          `<a class="btn sm" href="#/escritorio">${t("Abrir o Escritório")}</a>`)}</div>`)
      + ui.sec("Sessões recentes do agente", `<a class="vw-link" href="#/uso">${t("Uso de IA")}${icon("chevron")}</a>`)
      + (sessions.length ? `<div class="panel rows">${sessions.map(sessionRow).join("")}</div>`
        : `<div class="panel">${ui.empty("bot", "O agente ainda não correu", "Manda uma tarefa ao escritório: o agente automático de quem a recebe corre-a, e cada sessão aparece aqui com os tokens e o custo.",
          `<button class="btn sm" data-office-task>${t("Pedir tarefa")}</button>`)}</div>`);
  }, 6);
}
HUB_VIEWS.agentes = async function (r) {
  await pagesCss();
  if (r.company) return viewAgent(r.company);
  page(`${ui.head("Equipa", t("Agentes"), t("O agente automático de cada pessoa, as janelas do Claude abertas e os subagentes que lançaram."),
      ui.btn("Pedir tarefa", "data-office-task", "primary", "plus"))}
    <div id="agents-grid"></div>
    ${ui.sec("Subagentes que o agente pode lançar")}
    <div class="vw-roles">${SUBAGENT_ROLES.map(([, name, what]) => `<div class="panel pad"><b>${icon("bot")}${t(name)}</b><p>${t(what)}</p></div>`).join("")}</div>
    <p class="vw-note">${t("Um subagente só existe dentro de uma sessão: é o agente principal que decide lançá-lo. Usa as mesmas ferramentas e a mesma política de permissões.")}</p>`);
  $("view").onclick = (e) => { if (e.target.closest("[data-office-task]")) newTask({ for_ai: true }); };
  await loadAgentsPage();
};

async function loadAgentDetail() {
  const el = $("agent-detail");
  if (!el) return;
  await mount(el, async () => {
    const a = await request_(`/api/agents/${el.dataset.user}`);
    const s = a.session;
    const hidden = !me.lead && a.user !== me.username;
    const on = AGENT_ON.includes(a.status);
    const timeline = [...a.events.map((e) => ({ at: e.created_at, text: e.message, tone: e.kind === "error" ? "bad" : "ai" })),
      ...a.activity.map((x) => ({ at: x.created_at, text: x.message, tone: activityTone(x), kind: activityKind(x.kind),
        presence: PRESENCE_KINDS.includes(x.kind) ? { user: a.user, name: a.display_name, kind: x.kind } : null }))].sort((x, y) => y.at.localeCompare(x.at)).slice(0, 60);
    const fact = (label, value) => `<div><dt>${t(label)}</dt><dd>${value}</dd></div>`;
    return `${ui.head("Agente", a.name, t(on ? "O agente automático de {n} está ligado." : "O agente automático de {n} está desligado.", { n: a.display_name }),
      `${on ? ui.status(a.status) : `<span class="st off"><i></i>${t("Desligado")}</span>`}
      ${a.task_id && ["WORKING", "WAITING"].includes(a.status) ? ui.btn("Pausar", "data-act=pause", "", "pause") + ui.btn("Parar", "data-act=stop", "danger", "stop") : ""}
      ${a.task_id && a.status === "PAUSED" ? ui.btn("Retomar", "data-act=resume", "", "play") + ui.btn("Parar", "data-act=stop", "danger", "stop") : ""}
      ${a.task_id ? `<a class="btn primary" href="#/tarefas/${a.task_id}">${t("Abrir tarefa")}</a>` : ""}`)}
    <div class="detail"><div class="stack">
      <div class="panel pad"><dl class="vw-facts wide">${fact("Tarefa atual", esc(a.task || t("Nenhuma")))}${a.project ? fact("Projeto", esc(a.project)) : ""}
        ${s ? fact("Modelo", esc(s.model || "—")) + fact("Sessão", fmt.span(s.started_at)) : ""}${fact("Visto", a.status === "OFFLINE" ? fmt.ago(a.last_seen) : t("agora"))}</dl>
        ${a.task ? `<div class="rowx" style="margin-top:12px"><div class="grow">${ui.progress(a.progress, "ai")}</div><span class="mono">${a.progress}%</span></div>` : ""}
        ${s?.current_action || a.current_action ? `<div class="now" style="margin-top:12px">${esc(s?.current_action || a.current_action)}</div>`
          : `<p class="vw-none" style="margin-top:10px">${t(hidden ? "Só o próprio e o owner veem o que o agente está a fazer." : "O agente não está a fazer nada agora.")}</p>`}</div>
      ${ui.sec("Atividade")}<div class="panel">
        ${timeline.length ? `<div class="tl vw-tl">${timelineHtml(timeline)}</div>` : ui.empty("pulse", "Sem atividade registada", "O que o agente e a pessoa fizerem aparece aqui.")}</div>
    </div><div class="stack">
      ${ui.sec("Tokens", s ? ui.src("live") : "")}<div class="panel pad">
        ${s ? `<dl class="tok" style="margin:0"><dt>${t("Entrada")}</dt><dd>${fmt.int(s.tokens.input)}</dd><dt>${t("Saída")}</dt><dd>${fmt.int(s.tokens.output)}</dd>
          <dt>${t("Cache lida")}</dt><dd>${fmt.int(s.tokens.cache_read)}</dd><dt class="total">Total</dt><dd class="total">${fmt.int(s.tokens.total)}</dd></dl>
          <p class="vw-none" style="margin-top:10px">${t("{n} chamadas a ferramentas nesta sessão.", { n: s.tool_uses })}</p>`
          : `<p class="vw-none">${t("Sem sessão de IA a correr.")}</p>`}</div>
      ${ui.sec("Subagentes")}<div class="panel pad">
        ${a.subagents.length ? `<div class="subs">${subsHtml(a.subagents)}</div>` : `<p class="vw-none">${t("Esta sessão não lançou subagentes.")}</p>`}</div>
      ${ui.sec("Sessões recentes")}<div class="panel">
        ${a.sessions.length ? `<div class="rows">${a.sessions.slice(0, 8).map((x) => sessionRow({ ...x, user: a.user, user_name: a.display_name })).join("")}</div>`
          : ui.empty("bot", hidden ? "Sessões privadas" : "Ainda sem sessões", hidden ? "Só o próprio e o owner veem as sessões." : "Quando o agente correr uma tarefa, a sessão aparece aqui.")}</div>
    </div></div>`;
  }, 6);
  el.onclick = async (e) => {
    const fold = e.target.closest("[data-fold]");
    if (fold) { presenceOpen.has(fold.dataset.fold) ? presenceOpen.delete(fold.dataset.fold) : presenceOpen.add(fold.dataset.fold); return loadAgentDetail(); }
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (!act) return;
    const a = await api(`/api/agents/${el.dataset.user}`);
    try { await api(`/api/tasks/${a.task_id}/control`, { method: "POST", body: { action: act } }); flash(t("Pedido enviado ao agente.")); } catch (err) { flash(err.message); }
  };
}
async function viewAgent(username) {
  page(`<p class="vw-back"><a href="#/agentes">${icon("chevron")}${t("Agentes")}</a></p><div id="agent-detail" data-user="${esc(username)}"></div>`);
  await loadAgentDetail();
}
onLive(["presence", "session", "task", "tick"], async () => { await loadAgentsPage(); await loadAgentDetail(); });
onLive(["office"], calm(async () => { await loadAgentsPage(); }));

/* ================================================================ team */
// Equipa: a card per partner with what matters about them now: here or not, the task they said they are on, their Claude
// windows (the Escritório's), their automatic agent, their Claude plan, and what they did today.
function personCard(m, d) {
  const u = m.user, online = m.status !== "OFFLINE", a = d.agents.find((x) => x.user === u) || m;
  const wins = (d.office?.sessions || []).filter((s) => s.user === u && worthy(s) && (s.state !== "ended" || sameDay(s.updated_at))).sort(byWork);
  const live = wins.filter((s) => s.state !== "ended").length;
  const today = wins.filter((s) => sameDay(s.updated_at)).reduce((n, s) => n + winTokens(s), 0);
  const open = d.tasks.filter((x) => x.assignee === u && x.stage !== "done").length;
  const did = d.tasks.filter((x) => x.assignee === u && x.stage === "done" && sameDay(x.completed_at)).length;
  const commits = d.rank ? (d.rank.today.find((p) => p.user === u)?.commits ?? 0) : null;
  const where = (m.where || []).map((w) => t(w === "phone" ? "telemóvel" : "PC")).join(t(" e "));
  const presence = online ? `<span class="st ok"><i></i>${t("Online")}${where ? ` · ${t("no")} ${esc(where)}` : ""}</span>`
    : `<span class="st off"><i></i>${t("Offline")} · ${t("visto {q}", { q: fmt.ago(m.last_seen) })}</span>`;
  const lim = d.limits[u];
  const limRow = (label, pct) => `<div class="vw-lim ${limitTone(pct)}"><em>${t(label)}</em>${bar(pct, limitTone(pct))}<b>${pct == null ? "—" : `${pct}%`}</b></div>`;
  const plan = lim ? `<div class="vw-lims ${Date.now() - new Date(lim.seen) > 864e5 ? "old" : ""}" title="${esc(t("Plano do Claude · lido {q}", { q: fmt.ago(lim.seen) }))}">${limRow("5 h", lim.five)}${limRow("Semana", lim.week)}</div>` : "";
  const doing = m.doing ? `<a class="vw-doing" href="#/tarefas/${m.doing.id}"><small>${t("A fazer agora")} · ${t("desde")} ${sinceOf(m.doing.since)}</small><b>${esc(m.doing.title)}</b></a>` : "";
  const agentOn = AGENT_ON.includes(a.status);
  const agent = a.status === "WORKING" && a.task ? `<div class="vw-line"><span class="st busy"><i></i>${t("A trabalhar")}</span><b class="ell">${esc(a.task)}</b>${a.progress ? `<em>${a.progress}%</em>` : ""}</div>`
    : agentOn ? `<div class="vw-line">${ui.status(a.status)}<span class="ell">${a.status === "IDLE" ? t("começa sozinho a próxima tarefa do escritório") : ""}</span></div>`
    : `<div class="vw-line"><span class="st off"><i></i>${t("Desligado")}</span><span class="ell">${esc(t(isMe(u) ? "liga-o no widget e o escritório faz as tuas tarefas" : "as tarefas do escritório para {n} esperam", { n: m.display_name }))}</span></div>`;
  return `<article class="panel vw-person ${online ? "on" : "off"}">
    <header><a class="vw-pid" href="#/agentes/${esc(u)}">${m.doing ? `<span class="dl-ring">${ui.avatar(m.display_name, "lg")}</span>` : ui.avatar(m.display_name, "lg")}
      <div><b>${esc(m.display_name)}${isMe(u) ? `<small>${t("Tu")}</small>` : ""}</b>${presence}</div></a>${plan}</header>
    ${doing}
    <section class="vw-part"><h5>${t("Claude")}<em>${live ? t(live === 1 ? "1 janela aberta" : "{n} janelas abertas", { n: live }) : wins.length ? t("hoje") : ""}</em></h5>
      ${wins.length ? wins.slice(0, 3).map((s) => winRow(s)).join("") + (wins.length > 3 ? `<a class="vw-more" href="#/escritorio">${t("Mais {n} no Escritório", { n: wins.length - 3 })}</a>` : "")
        : `<p class="vw-none">${t("Sem janelas do Claude hoje.")}</p>`}</section>
    <section class="vw-part"><h5>${t("Agente automático")}</h5>${agent}</section>
    <footer class="vw-today"><button type="button" data-tasks-of="${esc(u)}" title="${esc(t("Ver as tarefas de {n}", { n: m.display_name }))}"><b>${open}</b><span>${t(open === 1 ? "aberta" : "abertas")}</span></button>
      <span><b>${did}</b><span>${t(did === 1 ? "feita hoje" : "feitas hoje")}</span></span>
      <span><b>${commits ?? "—"}</b><span>${t("commits hoje")}</span></span>
      <span><b>${tok(today) || "0"}</b><span>${t("tokens hoje")}</span></span></footer></article>`;
}
async function teamData() {
  const [team, agents, office, limits, tasks, rank] = await Promise.all([api("/api/team"), api("/api/agents"), api("/api/office").catch(() => null),
    planLimits(), api("/api/tasks").catch(() => []), api("/api/analytics/ranking").catch(() => null)]);
  return { team, agents, office, limits, tasks: tasks.filter((x) => !x.trashed_at), rank };
}
// the heart of Equipa: who carried the week (tasks done per person, from the Hub) beside the Claude of each one this week
function teamHeart(d, online, busy) {
  const done = d.tasks.filter((x) => x.stage === "done");
  const per = d.team.map((m) => ({ label: m.display_name, value: series.inPeriod(done.filter((x) => x.assignee === m.user), (x) => x.completed_at, 0, 7) }));
  const total = per.reduce((n, p) => n + p.value, 0);
  const rank = d.rank?.week || [];
  return `<div class="pn-split" style="margin-top:14px">
    <div class="panel pad"><div class="pn-card-h">${t("Equipa ao trabalho")}<small>${t("agora")}</small></div>
      ${ui.gauge(busy.size, d.team.length || 1, { text: `${busy.size}/${d.team.length}`, of: t("a trabalhar · {n} online", { n: online.length }) })}</div>
    <div class="panel pad"><div class="pn-card-h">${total || !rank.some((p) => p.commits) ? t("Tarefas feitas por pessoa") : t("Commits por pessoa")}<small>${total || !rank.some((p) => p.commits) ? t("{n} nos últimos 7 dias", { n: total }) : t("esta semana")}</small></div>
      ${total ? ui.bars(per, { hi: per.reduce((b, p, i) => (p.value > per[b].value ? i : b), 0), fmtV: (v) => t(v === 1 ? "1 tarefa" : "{n} tarefas", { n: v }) })
        : rank.some((p) => p.commits) ? ui.bars(rank.map((p) => ({ label: p.name, value: p.commits })), { hi: 0, fmtV: (v) => t(v === 1 ? "1 commit" : "{n} commits", { n: v }) })
        : ui.empty("tick", "Ninguém fechou tarefas esta semana")}</div></div>`;
}
async function loadTeamPage() {
  if (!$("team-grid")) return;
  await mount($("team-grid"), async () => {
    const d = await teamData();
    if (!d.team.length) return `<div class="panel">${ui.empty("users", "Ainda não há ninguém na equipa", "Junta as pessoas da equipa: cada uma entra no Hub e tem o seu agente.",
      leadOnly(`<button class="btn sm" data-add-user>${t("Adicionar pessoa")}</button>`))}</div>`;
    const wins = d.office?.sessions || [];
    const online = d.team.filter((m) => m.status !== "OFFLINE");
    const busy = new Set(d.team.filter((m) => m.doing || m.status === "WORKING" || wins.some((s) => s.user === m.user && s.state === "working")).map((m) => m.user));
    const open = wins.filter((s) => s.state !== "ended");
    const did = d.tasks.filter((x) => x.stage === "done" && sameDay(x.completed_at)).length;
    const commits = d.rank ? d.rank.today.reduce((n, p) => n + p.commits, 0) : null;
    const order = [...d.team].sort((a, b) => (a.status === "OFFLINE") - (b.status === "OFFLINE") || busy.has(b.user) - busy.has(a.user)
      || isMe(b.user) - isMe(a.user) || a.display_name.localeCompare(b.display_name));
    return kpiRow([
        kpi("Online agora", `${online.length}/${d.team.length}`, { sub: online.map((m) => m.display_name).join(", ") || t("ninguém"),
          viz: ui.ring(d.team.length ? (online.length / d.team.length) * 100 : null) }),
        kpi("A trabalhar", busy.size, { sub: t("numa tarefa ou com o Claude"), viz: ui.ring(d.team.length ? (busy.size / d.team.length) * 100 : null) }),
        kpi("Janelas do Claude", d.office ? open.length : null, { sub: t("{n} a trabalhar", { n: open.filter((s) => s.state === "working").length }), href: "#/escritorio",
          viz: d.office ? ui.cols(series.byDay(wins, (s) => s.started_at || s.updated_at, 7).map((x) => x.value)) : "" }),
        kpi("Feito hoje", did, { sub: commits == null ? t("tarefas concluídas") : t("tarefas · {n} commits", { n: commits }), href: "#/historico",
          delta: ui.delta(did, d.tasks.filter((x) => x.stage === "done" && x.completed_at && sameDay(new Date(new Date(x.completed_at).getTime() + 864e5))).length, { label: t("contra ontem") }),
          viz: ui.spark(series.byDay(d.tasks.filter((x) => x.stage === "done"), (x) => x.completed_at, 14).map((x) => x.value)) })])
      + teamHeart(d, online, busy)
      + ui.sec("Pessoas") + `<div class="vw-people">${order.map((m) => personCard(m, d)).join("")}</div>`;
  }, 6);
}
HUB_VIEWS.equipa = async function () {
  await pagesCss();
  page(`${ui.head("Equipa", t("Equipa"), t("Quem está cá, no que está cada um e o que o Claude de cada um está a fazer."),
    leadOnly(ui.btn("Adicionar pessoa", "data-add-user", "", "plus")))}<div id="team-grid"></div>`);
  $("view").onclick = (e) => {
    if (e.target.closest("[data-add-user]")) return addUser();
    const tasksOf = e.target.closest("[data-tasks-of]");
    if (tasksOf) { taskFilter = tasksOf.dataset.tasksOf; location.hash = "#/tarefas"; }
  };
  await loadTeamPage();
};
onLive(["presence", "task", "tick"], loadTeamPage);
onLive(["office"], calm(loadTeamPage));
function addUser() {
  formModal("Adicionar pessoa", field("Nome", '<input name="display_name" required placeholder="ex: David">')
    + field("Utilizador", '<input name="username" required pattern="[a-zA-Z0-9_]{2,30}" placeholder="ex: david">')
    + field("Palavra-passe (mín. 8)", '<input name="password" type="password" minlength="8" required>')
    + field("Papel", `<select name="role">${options([["member", t("Membro")], ["owner", "Owner"]], "member")}</select>`),
  async (v) => { await api("/api/users", { method: "POST", body: v }); flash(t("Pessoa criada. Já pode entrar.")); loadTeamPage(); }, { submit: "Criar" });
}

/* ================================================================ live and history */
// Comings and goings (entrou no Hub, ficou online, saiu, ligou o agente) are folded: between two real events, one line per
// person, «Marco entrou no Hub 9×, ficou online 3× · 09:45–10:51», that opens to show each one (21 Oct: fifteen of them in
// a row hid the commits and the tasks). «Tudo» shows every line as it was.
const PRESENCE_KINDS = ["login", "hub_online", "hub_offline", "agent_online", "agent_offline"];
const PRESENCE_SAY = { login: "entrou no Hub", hub_online: "ficou online", hub_offline: "saiu", agent_online: "ligou o agente", agent_offline: "desligou o agente" };
const KIND_LABEL = { tasks: "Tarefa", approvals: "Aprovação", ai: "Agente", code: "Código", companies: "Empresa", claude: "Claude" };
let feedMode = (() => { try { return localStorage.getItem("hub.feedMode") || "resumo"; } catch { return "resumo"; } })();
const presenceOpen = new Set();   // the folded lines opened by hand stay open when the feed redraws
const feedItem = (a, fresh = false) => ({ ...activityItem(a, fresh), id: a.id, kind: a.company ? "companies" : activityKind(a.kind),
  cats: [activityKind(a.kind), ...(a.company ? ["companies"] : [])], presence: PRESENCE_KINDS.includes(a.kind) ? { user: a.user, name: a.name, kind: a.kind } : null });
const commitItem = (c) => ({ at: c.date, who: c.author, text: t("commit em {r}: {m}", { r: c.repo, m: c.message }), tone: "", kind: "code", cats: ["code"] });
const lineHtml = (i) => `<div class="fd ${i.tone || ""} ${i.fresh ? "new" : ""}"><time>${fmt.hhmm(i.at)}</time><i class="dot"></i>
  <p>${KIND_LABEL[i.kind] ? `<em class="vw-kind">${t(KIND_LABEL[i.kind])}</em>` : ""}${i.who ? `<b>${esc(i.who)}</b> ` : ""}${esc(i.text)}</p></div>`;
function foldPresence(items, split) {   // items newest first
  const out = [];
  let run = new Map(), day = "";
  const flush = () => {
    [...run.values()].sort((a, b) => new Date(b.items[0].at) - new Date(a.items[0].at)).forEach((g) => out.push(g.items.length > 1 ? { fold: g } : g.items[0]));
    run = new Map();
  };
  for (const i of items) {
    if (split) { const d = new Date(i.at).toDateString(); if (d !== day) { flush(); day = d; } }
    if (!i.presence) { flush(); out.push(i); continue; }
    if (!run.has(i.presence.user)) run.set(i.presence.user, { user: i.presence.user, name: i.presence.name, items: [] });
    run.get(i.presence.user).items.push(i);
  }
  flush();
  return out;
}
function foldLine(g) {
  const counts = {};
  for (const i of g.items) counts[i.presence.kind] = (counts[i.presence.kind] || 0) + 1;
  const said = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${t(PRESENCE_SAY[k] || k)}${n > 1 ? ` ${n}×` : ""}`).join(", ");
  const newest = g.items[0].at, oldest = g.items[g.items.length - 1].at, key = `${g.user}|${oldest}`, open = presenceOpen.has(key);
  const span = fmt.hhmm(oldest) === fmt.hhmm(newest) ? fmt.hhmm(newest) : `${fmt.hhmm(oldest)}–${fmt.hhmm(newest)}`;
  return `<div class="fd vw-pres ${open ? "open" : ""}"><time>${fmt.hhmm(newest)}</time><i class="dot"></i>
    <p><button type="button" class="vw-fold" data-fold="${esc(key)}" aria-expanded="${open}"><span><b>${esc(g.name)}</b> ${esc(said)}</span><em>${span}</em>${icon("chevron")}</button></p></div>
    ${open ? `<div class="vw-pres-list">${g.items.map(lineHtml).join("")}</div>` : ""}`;
}
function timelineHtml(items, days = false) {
  const rows = feedMode === "tudo" ? items : foldPresence(items, days);
  let day = "";
  return rows.map((r) => {
    const at = r.fold ? r.fold.items[0].at : r.at, label = days ? fmt.day(at) : "";
    const head = days && label !== day ? `<div class="dayh">${esc(label)}</div>` : "";
    day = label;
    return head + (r.fold ? foldLine(r.fold) : lineHtml(r));
  }).join("");
}
const modeSeg = () => `<div class="segx" id="feed-mode" title="${esc(t("Resumido junta as entradas e saídas de cada pessoa numa linha"))}">${[["resumo", "Resumido"], ["tudo", "Tudo"]]
  .map(([v, l]) => `<button data-mode="${v}" class="${v === feedMode ? "on" : ""}">${t(l)}</button>`).join("")}</div>`;
// The clicks both timelines share: Resumido / Tudo, and a folded line opened or closed. `draw` paints the feed again.
function feedClicks(e, draw) {
  const mode = e.target.closest("#feed-mode [data-mode]");
  if (mode) {
    feedMode = mode.dataset.mode;
    try { localStorage.setItem("hub.feedMode", feedMode); } catch { /* private window: not remembered */ }
    $("feed-mode").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === mode));
    draw();
    return true;
  }
  const fold = e.target.closest("[data-fold]");
  if (fold) { presenceOpen.has(fold.dataset.fold) ? presenceOpen.delete(fold.dataset.fold) : presenceOpen.add(fold.dataset.fold); draw(); return true; }
  return false;
}

const seenActivity = new Set();
let liveFirst = true, liveData = null;
/* The Painel's figures over Ao vivo and Histórico (27 Oct): the lines of the timeline counted, the presence comings and
   goings left out. live = today against yesterday; otherwise the last 7 days against the 7 before, day by day. */
// today hour by hour, from the first hour with something to now (Ao vivo only has today)
function hourly(list) {
  const hours = list.map((i) => new Date(i.at).getHours()), from = Math.min(new Date().getHours(), ...hours), to = new Date().getHours();
  return Array.from({ length: to - from + 1 }, (_, k) => hours.filter((h) => h === from + k).length).slice(-12);
}
function feedKpis(items, live) {
  const work = items.filter((i) => !i.presence), of = (cat) => work.filter((i) => i.cats?.includes(cat)), at = (i) => i.at;
  const card = (label, list, sub) => live
    ? kpi(label, list.filter((i) => sameDay(i.at)).length, { sub, viz: ui.cols(hourly(list.filter((i) => sameDay(i.at)))) })
    : kpi(label, series.inPeriod(list, at, 0, 7), { sub, delta: ui.delta(series.inPeriod(list, at, 0, 7), series.inPeriod(list, at, 7, 14), { label: t("contra a semana antes") }),
      viz: ui.spark(series.byDay(list, at, 14).map((d) => d.value)) });
  return kpiRow([card(live ? "Hoje" : "Registos · 7 dias", work, live ? t("hora a hora") : t("tarefas, código, IA e aprovações")), card("Commits", of("code"), t("do git")),
    card("Tarefas", of("tasks"), t("criadas, mexidas e feitas")), card("IA", of("ai"), t("o que os agentes fizeram"))]);
}
function liveHtml() {
  const items = liveData.items;
  if (!items.length) return ui.empty("pulse", "Sem atividade hoje", "O que as pessoas e os agentes fizerem aparece aqui no momento em que acontece: tarefas, commits, janelas do Claude, aprovações.",
    `<a class="btn sm" href="#/historico">${t("Ver o histórico")}</a>`);
  const real = items.some((i) => !i.presence);
  return `${real ? "" : `<p class="vw-note in">${t("Hoje ainda só houve entradas e saídas. O trabalho (tarefas, commits, janelas do Claude) aparece aqui quando começar.")}</p>`}
    <div class="tl vw-tl">${timelineHtml(items)}</div>`;
}
function liveSide(d) {
  const wins = d.office?.sessions || [];
  const order = [...d.team].sort((a, b) => (a.status === "OFFLINE") - (b.status === "OFFLINE") || isMe(b.user) - isMe(a.user) || a.display_name.localeCompare(b.display_name));
  const now = (m) => {
    const a = d.agents.find((x) => x.user === m.user), w = wins.filter((s) => s.user === m.user && (s.state === "working" || s.state === "waiting")).sort(byWork)[0];
    if (m.doing) return [`${t("A fazer")}: ${m.doing.title}`, `#/tarefas/${m.doing.id}`];
    if (a?.status === "WORKING" && a.task) return [`${t("Agente")}: ${a.task}`, `#/agentes/${m.user}`];
    if (w) return [`${t("Claude")}: ${w.topic || w.prompt || w.action}`, "#/escritorio"];
    return [m.status === "OFFLINE" ? t("visto {q}", { q: fmt.ago(m.last_seen) }) : t("sem nada em curso"), `#/agentes/${m.user}`];
  };
  const people = order.map((m) => {
    const [line, href] = now(m), online = m.status !== "OFFLINE";
    return `<a class="rw vw-nowrow ${online ? "" : "off"}" href="${href}">${m.doing ? `<span class="dl-ring">${ui.avatar(m.display_name, "sm")}</span>` : ui.avatar(m.display_name, "sm")}
      <div class="rw-main"><b>${esc(m.display_name)}</b><span>${esc(line)}</span></div><span class="st ${online ? "ok" : "off"}"><i></i></span></a>`;
  }).join("");
  const items = liveData?.items || [];
  const n = (f) => items.filter(f).length;
  const mini = (label, value, href) => `<a class="vw-mini" href="${href}"><b>${value}</b><span>${t(label)}</span></a>`;
  return `${ui.sec("Agora")}<div class="panel rows">${people || ui.empty("users", "Ninguém na equipa")}</div>
    ${ui.sec("Hoje")}<div class="panel vw-minis">
      ${mini("tarefas concluídas", n((i) => i.kind === "tasks" && /^concluiu/.test(i.text)), "#/tarefas")}
      ${mini("commits", n((i) => i.kind === "code"), "#/codigo")}
      ${mini("janelas do Claude", wins.filter((s) => sameDay(s.updated_at) && winTokens(s)).length, "#/escritorio")}
      ${mini("aprovações pedidas", n((i) => i.kind === "approvals" && !/aprovou|recusou/.test(i.text)), "#/aprovacoes")}</div>`;
}
async function loadLive() {
  const el = $("live-feed");
  if (!el) return;
  let side = null;
  await mount(el, async () => {
    const [feed, commits, office, team, agents] = await Promise.all([api("/api/analytics/feed?limit=80").catch(() => null), api("/api/commits?limit=40").catch(() => []),
      api("/api/office").catch(() => null), api("/api/team"), api("/api/agents").catch(() => [])]);
    const rows = feed ? [...feed.items, ...feed.presence] : await api("/api/history?limit=150");
    const acts = rows.filter((a) => sameDay(a.created_at));
    const film = (office?.film || []).filter((f) => sameDay(f.at) && f.text && (f.kind === "window_open" || f.kind === "agent_start"));
    liveData = { items: [...acts.map((a) => feedItem(a, !liveFirst && !seenActivity.has(a.id))), ...commits.filter((c) => sameDay(c.date)).map(commitItem),
      ...film.map((f) => ({ at: f.at, who: f.who, kind: "claude", tone: "",
        text: f.kind === "window_open" ? t("abriu o Claude em {p}: {x}", { p: f.project, x: f.text }) : t("lançou um subagente ({k}): {x}", { k: f.agent, x: f.text }) }))]
      .sort((a, b) => new Date(b.at) - new Date(a.at)) };
    acts.forEach((a) => seenActivity.add(a.id));
    liveFirst = false;
    side = { team, agents, office };
    return liveHtml();
  }, 8);
  if (side && $("live-side")) paint($("live-side"), liveSide(side));
  if (liveData && $("live-kpis")) paint($("live-kpis"), feedKpis(liveData.items, true));
}
HUB_VIEWS.aovivo = async function () {
  liveFirst = true;
  await pagesCss();
  page(`${ui.head("Equipa", t("Ao vivo"), t("O que está a acontecer hoje, à medida que acontece."), `${modeSeg()}<span class="st busy"><i></i>${t("Em direto")}</span>`)}
    <div id="live-kpis" class="vw-feedkpis"></div><div class="detail vw-live"><div class="panel" id="live-feed"></div><aside class="stack" id="live-side"></aside></div>`);
  $("view").onclick = (e) => feedClicks(e, () => liveData && paint($("live-feed"), liveHtml()));
  await loadLive();
};
onLive(["activity", "task", "approval", "presence", "session", "tick"], loadLive);
onLive(["office"], calm(loadLive, 15000));

let historyCat = "all", historyData = null, historyOlder = [], historyMore = false;
const HISTORY_CATS = [["all", "Tudo"], ["people", "Pessoas"], ["ai", "IA"], ["tasks", "Tarefas"], ["code", "Código"], ["approvals", "Aprovações"], ["companies", "Empresas"]];
function historyHtml() {
  const items = historyData.filter((i) => historyCat === "all" || i.cats.includes(historyCat));
  if (!items.length) return ui.empty("history", "Nada aqui", historyCat === "all" ? "Ainda não há registos." : "Não há registos deste tipo. Escolhe «Tudo» para ver a linha do tempo inteira.",
    historyCat === "all" ? "" : `<button class="btn sm" data-c="all">${t("Ver tudo")}</button>`);
  return `<div class="tl vw-tl">${timelineHtml(items, true)}</div>${historyMore ? `<div class="vw-older"><button class="btn sm" data-older>${t("Ver mais antigos")}</button></div>` : ""}`;
}
async function loadHistoryPage() {
  const el = $("history-feed");
  if (!el) return;
  paint($("history-cats"), HISTORY_CATS.map(([id, label]) => `<button class="chp ${id === historyCat ? "on" : ""}" data-c="${id}">${t(label)}</button>`).join(""));
  await mount(el, async () => {
    const [feed, commits] = await Promise.all([api("/api/analytics/feed?limit=200").catch(() => null), api("/api/commits?limit=100").catch(() => [])]);
    let rows;
    if (feed) {
      rows = [...feed.items, ...feed.presence, ...historyOlder.flatMap((p) => [...p.items, ...p.presence])];
      historyMore = historyOlder.length ? historyOlder[historyOlder.length - 1].more : feed.more;
    } else { rows = await api("/api/history?limit=300"); historyMore = false; }   // a Hub from before /api/analytics/feed
    const byId = new Map(rows.map((a) => [a.id, a]));
    historyData = [...[...byId.values()].map((a) => feedItem(a)), ...commits.map(commitItem)].sort((a, b) => new Date(b.at) - new Date(a.at));
    paint($("history-kpis"), feedKpis(historyData, false));
    return historyHtml();
  }, 8);
}
async function loadOlderHistory(button) {
  const oldest = historyData.filter((i) => i.id && !i.presence).at(-1);
  if (!oldest) return;
  button.disabled = true;
  try { historyOlder.push(await request_(`/api/analytics/feed?limit=200&before=${oldest.id}`)); } catch (err) { flash(err.message); button.disabled = false; return; }
  $("history-feed")._html = null;
  await loadHistoryPage();
}
HUB_VIEWS.historico = async function () {
  historyOlder = [];
  await pagesCss();
  page(`${ui.head("Equipa", t("Histórico"), t("Uma só linha do tempo: pessoas, IA, tarefas, código e aprovações."), modeSeg())}
    <div id="history-kpis" class="vw-feedkpis"></div><div class="chipbar" id="history-cats"></div><div class="panel" id="history-feed"></div>`);
  const draw = () => historyData && paint($("history-feed"), historyHtml());
  $("view").onclick = (e) => {
    if (feedClicks(e, draw)) return;
    const cat = e.target.closest("[data-c]");
    if (cat) { historyCat = cat.dataset.c; paint($("history-cats"), HISTORY_CATS.map(([id, label]) => `<button class="chp ${id === historyCat ? "on" : ""}" data-c="${id}">${t(label)}</button>`).join("")); return draw(); }
    const older = e.target.closest("[data-older]");
    if (older) loadOlderHistory(older);
  };
  await loadHistoryPage();
};
onLive(["activity", "tick"], loadHistoryPage);

/* ================================================================ projects */
const PROJECT_ST = { active: ["ok", "Ativo"], maintenance: ["wait", "Manutenção"], paused: ["off", "Em pausa"], done: ["off", "Terminado"] };
const projectSt = (p) => { const [tone, label] = PROJECT_ST[p.status] || ["off", p.status]; return `<span class="st ${tone}"><i></i>${t(label)}</span>`; };
const projectFields = (p = {}) => field("Nome", `<input name="name" required value="${esc(p.name || "")}">`, true)
  + field("Estado", `<select name="status">${options(Object.entries(PROJECT_ST).map(([k, v]) => [k, t(v[1])]), p.status || "active")}</select>`)
  + field("Empresa", `<select name="company">${options([["", t("Sem empresa")], ...companies.map((c) => [c.id, c.name])], p.company)}</select>`)
  + field("Repositório", `<input name="repo" value="${esc(p.repo || "")}" placeholder="${t("nome em library/repos.json")}">`, true)
  + field("Descrição", `<textarea name="description">${esc(p.description || "")}</textarea>`, true);
const projectBody = (v) => ({ ...v, company: v.company || null });
function projectCard(p) {
  const co = companies.find((c) => c.id === p.company)?.name, total = p.open_tasks + p.done_tasks;
  return `<a class="panel hover vw-project" href="#/projetos/${p.id}">
    <header><b>${esc(p.name)}</b>${projectSt(p)}</header>
    <p>${esc(p.description || t("Sem descrição."))}</p>
    ${co || p.repo ? `<div class="vw-ptags">${co ? ui.tag(co) : ""}${p.repo ? `<span>${icon("code")}${esc(p.repo)}</span>` : ""}</div>` : ""}
    <div class="vw-pnums"><div><b>${p.open_tasks}</b><span>${t(p.open_tasks === 1 ? "aberta" : "abertas")}</span></div><div><b>${p.done_tasks}</b><span>${t(p.done_tasks === 1 ? "concluída" : "concluídas")}</span></div>
      <div><b>${p.active_sessions}</b><span>${t(p.active_sessions === 1 ? "agente ativo" : "agentes ativos")}</span></div></div>
    <footer>${total ? `${ui.progress((p.done_tasks / total) * 100)}<em>${Math.round((p.done_tasks / total) * 100)}%</em>` : `<span>${t("Ainda sem tarefas: abre-o e cria a primeira.")}</span>`}
      ${p.people.length ? `<span class="vw-faces">${p.people.map((u) => ui.avatar(nameOf(u), "sm")).join("")}</span>` : ""}</footer></a>`;
}
async function loadProjects() {
  if (!$("projects-grid")) return;
  await mount($("projects-grid"), async () => {
    const projects = await api("/api/projects");
    if (!projects.length) return `<div class="panel">${ui.empty("folder", "Sem projetos", "Um projeto junta as tarefas, os agentes e o custo de uma coisa grande (um site, uma app) num só sítio.",
      leadOnly(`<button class="btn sm" data-new-project>${t("Criar o primeiro projeto")}</button>`))}</div>`;
    const sum = (k) => projects.reduce((n, p) => n + (p[k] || 0), 0);
    const active = projects.filter((p) => p.status === "active").length;
    const open = sum("open_tasks"), done = sum("done_tasks");
    const byProject = projects.filter((p) => p.open_tasks + p.done_tasks).sort((a, b) => (b.open_tasks + b.done_tasks) - (a.open_tasks + a.done_tasks)).slice(0, 10);
    return kpiRow([kpi("Projetos ativos", active, { sub: t(projects.length === 1 ? "de 1 projeto" : "de {n} projetos", { n: projects.length }), viz: ui.ring((active / projects.length) * 100) }),
        kpi("Tarefas abertas", open, { sub: t("nos projetos"), href: "#/tarefas" }), kpi("Concluídas", done, { sub: t("nos projetos"), viz: ui.ring(open + done ? (done / (open + done)) * 100 : null) }),
        kpi("A trabalhar", sum("active_sessions"), { sub: t("agentes numa tarefa de um projeto"), href: "#/agentes" })])
      + (open + done ? `<div class="pn-split" style="margin-top:14px">
          <div class="panel pad"><div class="pn-card-h">${t("Feito nos projetos")}<small>${t("todas as tarefas")}</small></div>
            ${ui.gauge(Math.round((done / (open + done)) * 100), 100, { text: `${Math.round((done / (open + done)) * 100)}%`, of: t("{a} de {b} tarefas", { a: done, b: open + done }) })}</div>
          <div class="panel pad"><div class="pn-card-h">${t("Tarefas por projeto")}<small>${t("abertas e concluídas")}</small></div>
            ${ui.bars(byProject.map((p) => ({ label: p.name.length > 12 ? `${p.name.slice(0, 11)}…` : p.name, value: p.open_tasks + p.done_tasks,
              tip: t("{a} abertas · {b} concluídas", { a: p.open_tasks, b: p.done_tasks }) })), { hi: 0 })}</div></div>` : "")
      + ui.sec("Todos os projetos", `<span class="faint">${projects.length}</span>`)
      + `<div class="vw-projects">${projects.map(projectCard).join("")}${leadOnly(`<button type="button" class="vw-add" data-new-project>${icon("plus")}<b>${t("Novo projeto")}</b>
        <span>${t("Junta tarefas, agentes e custo de uma coisa grande num só sítio.")}</span></button>`)}</div>`;
  }, 4);
}
const newProject = () => formModal("Novo projeto", projectFields(), async (v) => { await api("/api/projects", { method: "POST", body: projectBody(v) }); loadProjects(); }, { submit: "Criar projeto" });
HUB_VIEWS.projetos = async function (r) {
  await pagesCss();
  if (r.company) return viewProject(Number(r.company));
  page(`${ui.head("Trabalho", t("Projetos"), t("Cada projeto com as suas tarefas, os seus agentes e o seu custo."), leadOnly(ui.btn("Novo projeto", "data-new-project", "primary", "plus")))}
    <div id="projects-grid"></div>`);
  $("view").onclick = (e) => { if (e.target.closest("[data-new-project]")) newProject(); };
  await loadProjects();
};
async function viewProject(id) {
  page(`<p class="vw-back"><a href="#/projetos">${icon("chevron")}${t("Projetos")}</a></p><div id="project-detail"></div>`);
  await mount($("project-detail"), async () => {
    const p = await request_(`/api/projects/${id}`);
    const co = companies.find((c) => c.id === p.company)?.name;
    return `${ui.head("Projeto", p.name, p.description || [co, p.repo].filter(Boolean).join(" · "), `${projectSt(p)}
      ${leadOnly(ui.btn("Editar", "data-edit-project", "quiet"))}${ui.btn("Nova tarefa", "data-new-task", "primary", "plus")}`)}
    ${kpiRow([kpi("Tarefas abertas", p.open_tasks), kpi("Concluídas", p.done_tasks), kpi("Agentes ativos", p.active_sessions),
      kpi("Custo de IA", p.ai_cost_usd == null ? null : fmt.usd(p.ai_cost_usd), { src: p.ai_cost_usd == null ? "" : "estimated", sub: p.ai_cost_usd == null ? t("o agente ainda não correu aqui") : "" })])}
    ${ui.sec("Tarefas")}
    ${p.task_list.length ? `<div class="panel rows">${p.task_list.map((x) => `<a class="rw" href="#/tarefas/${x.id}">${ui.avatar(nameOf(x.assignee), "sm")}
      <div class="rw-main"><b>${esc(x.title)}</b><span>${esc(nameOf(x.assignee))}</span></div>${ui.tag(t(STAGE_LABEL[x.stage]), STAGE_TONE[x.stage])}</a>`).join("")}</div>`
      : `<div class="panel">${ui.empty("tasks", "Sem tarefas", "Este projeto ainda não tem tarefas. Cria a primeira: fica contigo ou vai direta para o escritório.",
        `<button class="btn sm" data-new-task>${t("Nova tarefa")}</button>`)}</div>`}`;
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
  ${ui.progress(total ? (r.cost_usd / total) * 100 : 0)}<span>${fmt.usd(r.cost_usd)}</span></div>`).join("")}</div>` : `<p class="vw-none">${t("Sem dados")}</p>`);
const statCard = (label, value, source) => kpi(label, value, { src: source });
// Who did most, today and this week: commits and lines from git, tasks completed and AI sessions from the Hub.
async function loadRanking() {
  if (!$("ranking")) return;
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
onLive(["activity", "task"], loadRanking);

// "Quem fez o quê": a card per person, the period in a sentence and in bars against the busiest of the team.
function whoCard(p, all, claudeDays) {
  const top = (k) => Math.max(1, ...all.map((x) => x[k] || 0));
  const parts = [p.commits ? t(p.commits === 1 ? "1 commit" : "{n} commits", { n: p.commits }) : "", p.tasks_done ? t(p.tasks_done === 1 ? "1 tarefa feita" : "{n} tarefas feitas", { n: p.tasks_done }) : "",
    p.claude_tokens ? t("{n} tokens do Claude", { n: tok(p.claude_tokens) }) : "", p.agent_sessions ? t(p.agent_sessions === 1 ? "1 sessão do agente" : "{n} sessões do agente", { n: p.agent_sessions }) : ""].filter(Boolean);
  const said = parts.length ? parts.length > 1 ? `${parts.slice(0, -1).join(", ")} ${t("e")} ${parts.at(-1)}` : parts[0] : t("Sem registos neste período.");
  const row = (label, value, pct, note = "") => `<div class="vw-wrow"><span>${t(label)}</span>${bar(pct)}<b>${value}</b><em>${note}</em></div>`;
  return `<article class="panel vw-whoc ${parts.length ? "" : "quiet"}"><header>${ui.avatar(p.name, "lg")}<div><b>${esc(p.name)}</b><span>${esc(said.charAt(0).toUpperCase() + said.slice(1))}</span></div></header>
    ${row("Commits", p.commits, (p.commits / top("commits")) * 100, p.commits ? `+${fmt.int(p.added)} −${fmt.int(p.deleted)}` : "")}
    ${row("Tarefas feitas", p.tasks_done, (p.tasks_done / top("tasks_done")) * 100, p.tasks_created ? t("{n} criadas", { n: p.tasks_created }) : "")}
    ${row("Claude", tok(p.claude_tokens) || "0", (p.claude_tokens / top("claude_tokens")) * 100, p.claude_windows ? t(p.claude_windows === 1 ? "1 janela" : "{n} janelas", { n: p.claude_windows }) : "")}
    ${row("Agente", p.agent_sessions, (p.agent_sessions / top("agent_sessions")) * 100, p.approvals ? t("{n} aprovações", { n: p.approvals }) : "")}</article>`;
}
async function loadAnalytics() {
  if (!$("analytics")) return;
  let a = null;
  await mount($("analytics"), async () => {
    const n = analyticsDays;
    let tasks, commits, claudeUse;
    [a, tasks, commits, claudeUse] = await Promise.all([api(`/api/analytics?days=${n}`), api("/api/tasks").catch(() => []), api("/api/commits?limit=100").catch(() => null),
      api(`/api/analytics/claude?days=${Math.min(n, 7)}`).catch(() => null)]);
    const people = a.people?.list || [], cd = a.people?.claude_days;
    const claude = a.people ? people.reduce((k, p) => k + p.claude_tokens, 0) : null;
    const live = a.code.source === "live";
    // day by day and the period before, from the records themselves (the last 100 commits: the period before only when they reach back that far)
    const doneAt = (x) => (x.status === "COMPLETED" ? x.completed_at : null);
    const doneDays = series.byDay(tasks, doneAt, n), commitDays = series.byDay(commits, (c) => c.date, n);
    const commitsReach = commits?.length && commits.length < 100 || (commits?.length && new Date(commits[commits.length - 1].date) < Date.now() - 2 * n * 864e5);
    const tokDays = claudeUse ? claudeUse.dates.map((d) => claudeUse.people.reduce((k, p) => k + (p.by_day[d] || 0), 0)) : null;
    const share = a.team.tasks_completed + a.team.tasks_open ? Math.round((a.team.tasks_completed / (a.team.tasks_completed + a.team.tasks_open)) * 100) : null;
    const top = kpiRow([
        kpi("Commits", live ? a.code.commits : null, { sub: live ? t("+{a} −{d} linhas", { a: fmt.int(a.code.added), d: fmt.int(a.code.deleted) }) : "", src: live ? "" : a.code.source, href: "#/codigo",
          delta: live && commitsReach ? ui.delta(a.code.commits, series.inPeriod(commits, (c) => c.date, n, 2 * n), { label: t("contra os {n} dias antes", { n }) }) : "",
          viz: live ? ui.cols(commitDays.slice(-12).map((d) => d.value)) : "" }),
        kpi("Concluídas", a.team.tasks_completed, { sub: t("tarefas · {n} criadas", { n: a.team.tasks_created }), href: "#/tarefas",
          delta: ui.delta(a.team.tasks_completed, series.inPeriod(tasks, doneAt, n, 2 * n), { label: t("contra os {n} dias antes", { n }) }),
          viz: ui.spark(doneDays.map((d) => d.value)) }),
        kpi("Tokens do Claude", claude == null ? null : tok(claude) || "0", { sub: cd && cd < n ? t("só os últimos {n} dias", { n: cd }) : t("janelas do Claude Code"), href: "#/uso",
          viz: tokDays ? ui.spark(tokDays) : "" }),
        kpi("Pessoas online", `${a.team.active_users}/${a.team.people}`, { sub: t("{n} tarefas abertas", { n: a.team.tasks_open }), href: "#/equipa",
          viz: ui.ring(a.team.people ? (a.team.active_users / a.team.people) * 100 : null) })]);
    // the heart of the page, as in theirs: how far the team got (gauge) beside what it did day by day (columns)
    const heart = `<div class="pn-split" style="margin-top:14px">
        <div class="panel pad"><div class="pn-card-h">${t("Ritmo da equipa")}<small>${t("últimos {n} dias", { n })}</small></div>
          ${share == null ? ui.empty("tick", "Sem tarefas neste período") : ui.gauge(share, 100, { text: `${share}%`, of: t("das tarefas fechadas") })}
          <p class="faint" style="margin:6px 0 0;text-align:center;font-size:12.5px">${share == null ? "" : t("{a} concluídas e {b} ainda abertas.", { a: a.team.tasks_completed, b: a.team.tasks_open })}</p></div>
        <div class="panel pad"><div class="pn-card-h">${live ? t("Commits por dia") : t("Tarefas concluídas por dia")}
          <small>${live ? t("{n} no período", { n: a.code.commits }) : t("{n} no período", { n: a.team.tasks_completed })}</small></div>
          ${ui.bars((live ? commitDays : doneDays).slice(-14), { fmtV: (v) => (live ? t(v === 1 ? "1 commit" : "{n} commits", { n: v }) : t(v === 1 ? "1 tarefa" : "{n} tarefas", { n: v })) })}</div></div>`;
    return top + heart
      + (people.length ? ui.sec(t(analyticsDays === 7 ? "Quem fez o quê · últimos 7 dias" : "Quem fez o quê · últimos {n} dias", { n: analyticsDays }),
        cd && cd < analyticsDays ? `<span class="faint vw-secnote">${t("O Claude só guarda {n} dias", { n: cd })}</span>` : "") + `<div class="vw-who">${people.map((p) => whoCard(p, people, cd)).join("")}</div>` : "");
  }, 6);
  if (!a || !$("analytics-more")) return;
  const hours = a.ai.ai_seconds ? (a.ai.ai_seconds / 3600).toFixed(1).replace(".", ",") + " h" : null;
  paint($("analytics-more"), `${ui.sec("Equipa", ui.src(a.team.source))}${kpiRow([statCard("Sessões ativas", a.team.active_sessions), statCard("Tarefas criadas", a.team.tasks_created),
      statCard("Tarefas abertas", a.team.tasks_open), statCard("Aprovações pedidas", a.team.approvals)])}
    ${a.ai.sessions || a.ai.runs ? `${ui.sec("Agente automático", ui.src(a.ai.source))}${kpiRow([statCard("Sessões", a.ai.sessions || null),
      statCard("Tokens de entrada", a.ai.runs ? fmt.tokens(a.ai.tokens.input) : null), statCard("Tokens de saída", a.ai.runs ? fmt.tokens(a.ai.tokens.output) : null),
      statCard("Subagentes", a.ai.sessions ? a.ai.subagents : null), statCard("Ferramentas usadas", a.ai.sessions ? a.ai.tool_uses : null), statCard("Tempo da IA", hours)])}
      ${a.ai.models.length ? `<div class="panel" style="margin-top:12px"><table class="tbl"><tr><th>${t("Modelo")}</th><th class="r">${t("Sessões")}</th><th class="r">Tokens</th></tr>
        ${a.ai.models.map((m) => `<tr><td>${esc(m.model)}</td><td class="r">${m.sessions}</td><td class="r mono">${fmt.tokens(m.tokens)}</td></tr>`).join("")}</table></div>` : ""}` : ""}
    ${a.cost.total_usd != null ? `${ui.sec("Custo do agente", ui.src(a.cost.source))}
      <div class="vw-two"><div class="panel pad"><small class="vw-label">${t("Por pessoa")}</small>${barRows(a.cost.per_user, a.cost.total_usd)}</div>
        <div class="panel pad"><small class="vw-label">${t("Por tarefa")}</small>${barRows(a.cost.per_task, a.cost.total_usd)}</div>
        <div class="panel pad"><small class="vw-label">${t("Por projeto")}</small>${barRows(a.cost.per_project, a.cost.total_usd)}</div>
        ${statCard("Custo total de IA", fmt.usd(a.cost.total_usd), "estimated")}</div>` : ""}
    ${ui.sec("Código", ui.src(a.code.source))}${a.code.source === "live" ? `<div class="panel pad vw-repos"><span>${t("Repositórios com commits neste período")}</span>
      <div>${a.code.repos.length ? a.code.repos.map((x) => ui.tag(x)).join("") : `<em class="faint">${t("nenhum")}</em>`}</div></div>`
      : `<div class="panel">${ui.empty("code", "Sem ligação ao git", "Não consegui ler os repositórios agora. Confirma-os em library/repos.json.")}</div>`}
    ${a.value.cost_per_task.usd != null || a.value.cost_per_commit.usd != null ? `${ui.sec("Valor")}${kpiRow([
      statCard("Custo por tarefa", a.value.cost_per_task.usd == null ? null : fmt.usd(a.value.cost_per_task.usd), a.value.cost_per_task.source),
      statCard("Custo por commit", a.value.cost_per_commit.usd == null ? null : fmt.usd(a.value.cost_per_commit.usd), a.value.cost_per_commit.source)])}` : ""}
    <p class="vw-note">${t("Commits e linhas: do git. Tarefas e sessões: registos do Hub. Tokens do Claude: as janelas do Claude Code de cada um (o Escritório guarda uma semana). O custo é a estimativa do SDK do agente; não é uma fatura.")}</p>`);
}
HUB_VIEWS.analise = async function () {
  await pagesCss();
  page(`${ui.head("Análise", t("Análise"), t("Quem fez o quê: commits, tarefas, Claude e o agente de cada um."),
    `<div class="segx" id="days">${[7, 30, 90].map((d) => `<button data-d="${d}" class="${d === analyticsDays ? "on" : ""}">${d} ${t("dias")}</button>`).join("")}</div>`)}
    <div id="analytics"></div><div id="ranking"></div><div id="analytics-more"></div>`);
  loadRanking();
  $("days").onclick = (e) => {
    if (!e.target.dataset.d) return;
    analyticsDays = Number(e.target.dataset.d);
    $("days").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === e.target));
    $("analytics")._html = null; loadAnalytics();
  };
  await loadAnalytics();
};

/* Uso de IA: how much Claude the team used, from the two sources there are: every Claude Code window on the team's PCs
   (the Escritório's, tokens read from each transcript) and the runs of each person's automatic agent (with the SDK's cost
   estimate). Until 21 Oct the page read only the agent's runs and said «Sem dados» while the Escritório showed 524k tokens
   today. Then the plan's limits (5 h and week, as each PC last read them) and Higgsfield (set by hand). */
const GREYS = ["#eef1f4", "#9ea6b0", "#5d646d", "#3b4047", "#262a30"];
const WEEKDAY = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const shortDay = (iso) => WEEKDAY[new Date(`${iso}T12:00:00`).getDay()];
function daysChart(c) {
  const totals = c.dates.map((d) => c.people.reduce((n, p) => n + (p.by_day[d] || 0), 0)), max = Math.max(1, ...totals);
  return `<div class="panel pad vw-chart"><div class="vw-cols">${c.dates.map((d, i) => `<div class="vw-col ${i === c.dates.length - 1 ? "today" : ""}"
      title="${esc(`${fmt.date(d)}: ${c.people.filter((p) => p.by_day[d]).map((p) => `${p.name} ${tok(p.by_day[d])}`).join(", ") || t("nada")}`)}">
      <em>${totals[i] ? tok(totals[i]) : ""}</em><div class="vw-track"><div class="vw-stack" style="height:${((totals[i] / max) * 100).toFixed(1)}%">
        ${c.people.map((p, k) => (p.by_day[d] ? `<i style="flex:${p.by_day[d]};background:${GREYS[k % GREYS.length]}"></i>` : "")).join("")}</div></div>
      <span>${esc(i === c.dates.length - 1 ? t("Hoje") : shortDay(d))}<b>${Number(d.slice(8))}</b></span></div>`).join("")}</div>
    <div class="vw-legend">${c.people.map((p, k) => `<span><i style="background:${GREYS[k % GREYS.length]}"></i>${esc(p.name)} · ${tok(p.tokens) || "0"}</span>`).join("")}</div></div>`;
}
function planRow(m, l) {
  const when = (ts, week) => {
    if (!ts) return "";
    const d = new Date(ts * 1000);
    return week ? `${d.toLocaleDateString("pt-PT", { weekday: "long" })} ${fmt.hhmm(d.toISOString())}` : fmt.hhmm(d.toISOString());
  };
  const old = l && (Date.now() - new Date(l.seen) > 864e5);
  const cell = (label, pct, note) => `<div class="vw-plan-c ${limitTone(pct)}"><div><em>${t(label)}</em><b>${pct == null ? "—" : `${pct}%`}</b></div>${bar(pct, limitTone(pct))}<span>${esc(note)}</span></div>`;
  return `<div class="vw-plan ${old ? "old" : ""}">${ui.avatar(m.display_name)}<div class="vw-plan-who"><b>${esc(m.display_name)}${isMe(m.user) ? `<small>${t("Tu")}</small>` : ""}</b>
      <span>${l ? t("lido {q}", { q: fmt.ago(l.seen) }) : t("ainda sem leitura")}</span></div>
    ${cell("5 horas", l?.five, l?.five_reset ? t("renova às {h}", { h: when(l.five_reset) }) : "")}
    ${cell("Semana", l?.week, l?.week_reset ? t("renova {d}", { d: when(l.week_reset, true) }) : "")}
    ${cell("Higgsfield", m.higgsfield_pct, m.higgsfield_pct == null ? t("por indicar") : t("indicado à mão"))}</div>`;
}
function usageRow(p, max, dates) {
  return `<div class="vw-urow">${ui.avatar(p.name)}<div class="vw-uwho"><b>${esc(p.name)}</b><span>${esc([t(p.windows === 1 ? "1 janela" : "{n} janelas", { n: p.windows }),
      p.subagents ? t(p.subagents === 1 ? "1 subagente" : "{n} subagentes", { n: p.subagents }) : "", p.working ? t("{n} aberta agora", { n: p.working }) : "",
      p.models[0] ? p.models[0].replace(/^claude-/, "") : ""].filter(Boolean).join(" · "))}</span></div>
    <span class="vw-spark" aria-hidden="true">${dates.map((d) => `<i class="${d === dates[dates.length - 1] ? "today" : ""}" style="height:${p.by_day[d] ? Math.max(6, (p.by_day[d] / max) * 100).toFixed(1) : 0}%"></i>`).join("")}</span>
    <div class="vw-unum"><b>${tok(p.tokens) || "0"}</b><span>${t("hoje")} ${tok(p.today) || "0"}</span></div>
    <div class="vw-unum"><b>${p.agent_sessions}</b><span>${t(p.agent_sessions === 1 ? "sessão do agente" : "sessões do agente")}${p.agent_cost_usd != null ? ` · ${fmt.usd(p.agent_cost_usd)}` : ""}</span></div></div>`;
}
const shareRows = (rows, total) => (rows.length ? rows.map((r) => `<div class="vw-share"><span class="ell" title="${esc(r.name)}">${esc(r.name.replace(/^claude-/, ""))}</span>${bar((r.tokens / Math.max(1, total)) * 100)}
  <b>${tok(r.tokens)}</b></div>`).join("") : `<p class="vw-none">${t("Sem dados")}</p>`);
async function loadUsagePage() {
  if (!$("usage-page")) return;
  await mount($("usage-page"), async () => {
    const [c, users, sessions, limits, team] = await Promise.all([api("/api/analytics/claude?days=7").catch(() => null), api("/api/usage"), api("/api/sessions?limit=25"),
      planLimits(), api("/api/team").catch(() => [])]);
    const old = c ? null : await api("/api/usage/summary");   // a Hub from before /api/analytics/claude: only the agent's runs
    const w = c?.windows, ag = c?.agent;
    const agentTokens = ag ? ag.input_tokens + ag.output_tokens : old?.runs ? old.input_tokens + old.output_tokens : 0;
    const cost = ag ? ag.cost_usd : old?.cost_usd, costSrc = ag ? ag.cost_source : old?.cost_source;
    const maxDay = c ? Math.max(1, ...c.people.flatMap((p) => Object.values(p.by_day))) : 1;
    const people = c ? c.people.filter((p) => p.windows || p.agent_sessions) : [];
    // tokens of every window, day by day (the Escritório keeps a week): the line in the figures and yesterday for the chip
    const perDay = c ? c.dates.map((d) => c.people.reduce((n, p) => n + (p.by_day[d] || 0), 0)) : null;
    return kpiRow([
        kpi("Tokens hoje", w ? tok(w.today) || "0" : null, { sub: t("janelas do Claude Code"), src: w ? "live" : "not_connected", href: "#/escritorio",
          delta: perDay && perDay.length > 1 ? ui.delta(w.today, perDay[perDay.length - 2], { label: t("contra ontem") }) : "",
          viz: perDay ? ui.cols(perDay) : "" }),
        kpi("Tokens · 7 dias", w || agentTokens ? tok((w?.tokens || 0) + agentTokens) : null, { sub: w ? t("{a} janelas · {b} sessões do agente", { a: w.count, b: ag.sessions }) : "", src: w ? w.source : old?.source,
          viz: perDay ? ui.spark(perDay) : "" }),
        kpi("Janelas abertas", w ? w.working : null, { sub: w ? t("{n} subagentes esta semana", { n: w.subagents }) : "", href: "#/agentes" }),
        kpi("Custo do agente", cost == null ? null : fmt.usd(cost), { sub: t("7 dias · o Claude Code vai no plano"), src: costSrc })])
      + ui.sec("Limites do plano", `<span class="faint vw-secnote">${t("como cada PC os leu da última vez")}</span>`)
      + `<div class="panel vw-plans">${team.map((m) => planRow(m, limits[m.user])).join("") || ui.empty("users", "Sem equipa")}</div>`
      + (c ? ui.sec("Dia a dia · tokens do Claude Code", ui.src(c.windows.source)) + daysChart(c)
        + ui.sec("Por pessoa · 7 dias") + (people.length ? `<div class="panel vw-urows">${people.map((p) => usageRow(p, maxDay, c.dates)).join("")}</div>`
          : `<div class="panel">${ui.empty("token", "Ninguém usou o Claude esta semana", "As janelas do Claude Code de cada PC aparecem aqui com os tokens que gastaram, e o agente automático com as suas sessões.",
            `<a class="btn sm" href="#/escritorio">${t("Abrir o Escritório")}</a>`)}</div>`)
        + (c.top.length ? ui.sec("As janelas que mais gastaram") + `<div class="panel rows">${c.top.map((x) => `<div class="rw">${ui.avatar(x.name, "sm")}
            <div class="rw-main"><b>${esc(x.topic || t("Janela sem pedido"))}</b><span>${esc([x.name, x.project, (x.model || "").replace(/^claude-/, ""), `${fmt.day(x.updated_at)} ${fmt.hhmm(x.updated_at)}`].filter(Boolean).join(" · "))}</span></div>
            <span class="mono vw-tok">${tok(x.tokens)}</span></div>`).join("")}</div>` : "")
        + (c.models.length ? `<div class="vw-two"><div>${ui.sec("Por modelo")}<div class="panel pad">${shareRows(c.models, c.windows.tokens)}</div></div>
            <div>${ui.sec("Por projeto")}<div class="panel pad">${shareRows(c.projects, c.windows.tokens)}</div></div></div>` : "") : "")
      + ui.sec("Agente automático", ui.src(costSrc || "no_data"))
      + (sessions.length ? `<div class="panel rows">${sessions.map(sessionRow).join("")}</div>`
        : `<div class="panel">${ui.empty("bot", "O agente ainda não correu", "Quando o agente automático de alguém fizer uma tarefa do escritório, a sessão aparece aqui com os tokens e o custo estimado.",
          `<a class="btn sm" href="#/agentes">${t("Ver os agentes")}</a>`)}</div>`)
      + (users.length ? `${ui.sec("Agente automático · desde sempre")}<div class="panel rows">${users.map((u) => {
          const m = team.find((x) => x.user === u.user);
          return `<div class="rw">${ui.avatar(nameOf(u.user), "sm")}<div class="rw-main"><b>${esc(nameOf(u.user))}</b><span>${t(u.runs === 1 ? "1 sessão" : "{n} sessões", { n: u.runs })} · ${t("entrada")} ${fmt.tokens(u.input_tokens)} · ${t("saída")} ${fmt.tokens(u.output_tokens)}${m ? ` · ${t("esta semana {a} de {b}", { a: fmt.usd(m.week_cost_usd), b: fmt.usd(m.week_budget_usd) })}` : ""}</span></div>
            <span class="mono vw-tok">${fmt.usd(u.cost_usd)}</span></div>`;
        }).join("")}</div>` : "")
      + `<p class="vw-note">${t("Janelas do Claude Code: os tokens que cada janela gastou, lidos do histórico dela no PC de cada um (o Escritório guarda uma semana); vão no plano do Claude, sem custo à parte. Agente automático: o que cada sessão reportou, e o custo é a estimativa do SDK, não uma fatura. Higgsfield: indicado à mão por cada pessoa nas Definições.")}</p>`;
  }, 8);
}
HUB_VIEWS.uso = async function () {
  await pagesCss();
  page(`${ui.head("Análise", t("Uso de IA"), t("Quanto Claude a equipa gastou: as janelas do Claude Code de cada um e o agente automático."),
    `<a class="btn" href="#/escritorio">${icon("monitor")}${t("Ver no Escritório")}</a>`)}<div id="usage-page"></div>`);
  await loadUsagePage();
};
onLive(["usage", "session"], loadUsagePage);
onLive(["office"], calm(loadUsagePage, 30000));

const EXPENSE_CATS = { ai: "IA", software: "Software", ads: "Anúncios", infrastructure: "Infraestrutura", other: "Outros" };
const EXPENSE_HINT = { ai: "Claude, Higgsfield e outras IAs", software: "Assinaturas e licenças", ads: "Meta, Google, TikTok", infrastructure: "Domínios, alojamento, servidores", other: "O resto" };
const EXPENSE_ICON = { ai: "spark", software: "grid", ads: "trend", infrastructure: "monitor", other: "wallet" };
const moneyOf = (list) => { const by = {}; for (const x of list) by[x.currency] = (by[x.currency] || 0) + x.amount; return by; };
const moneyText = (by) => Object.entries(by).map(([cur, v]) => fmt.money(v, cur)).join(" + ");
async function loadExpenses() {
  if (!$("expenses")) return;
  await mount($("expenses"), async () => {
    const e = await api("/api/expenses");
    const month = e.items.filter((x) => String(x.spent_on).startsWith(e.month));
    const monthName = new Date(`${e.month}-15T12:00:00`).toLocaleDateString("pt-PT", { month: "long" });
    const ai = e.ai_cost;
    const register = leadOnly(`<button class="btn sm" data-new-expense>${t("Registar despesa")}</button>`);
    // month by month in the currency most used (sums of different currencies are not added up), the last 6 months
    const cur = Object.entries(e.items.reduce((m, x) => ({ ...m, [x.currency]: (m[x.currency] || 0) + 1 }), {})).sort((a, b) => b[1] - a[1])[0]?.[0];
    const months = Array.from({ length: 6 }, (_, i) => { const d = new Date(`${e.month}-15T12:00:00`); d.setMonth(d.getMonth() - 5 + i); return d.toISOString().slice(0, 7); });
    const perMonth = months.map((m) => e.items.filter((x) => x.currency === cur && String(x.spent_on).startsWith(m)).reduce((n, x) => n + x.amount, 0));
    const oneCur = cur && month.every((x) => x.currency === cur);
    const top = kpiRow([kpi(`${t("Registado em")} ${monthName}`, month.length ? moneyText(moneyOf(month)) : null, { sub: t(month.length === 1 ? "1 movimento" : "{n} movimentos", { n: month.length }),
        delta: oneCur && perMonth[4] ? ui.delta(perMonth[5], perMonth[4], { badUp: true, label: t("contra o mês antes") }) : "",
        viz: cur && perMonth.some(Boolean) ? ui.cols(perMonth) : "" }),
      kpi("Desde sempre", e.items.length ? moneyText(moneyOf(e.items)) : null, { sub: t(e.items.length === 1 ? "1 movimento" : "{n} movimentos", { n: e.items.length }) }),
      kpi("Custo do agente", ai.total_usd == null ? null : fmt.usd(ai.total_usd), { src: ai.source, sub: t("7 dias · estimativa do SDK"), href: "#/uso" })]);
    const aiBlock = ui.sec("Custo de IA · 7 dias", ui.src(ai.source)) + (ai.people.length
      ? `<div class="panel rows">${ai.people.map((p) => `<div class="rw">${ui.avatar(p.name, "sm")}<div class="rw-main"><b>${esc(p.name)}</b><span>${t(p.runs === 1 ? "1 sessão do agente" : "{n} sessões do agente", { n: p.runs })}</span></div>
          <span class="mono vw-tok">${fmt.usd(p.cost_usd)}</span></div>`).join("")}</div>`
      : `<div class="panel vw-hintrow">${icon("spark")}<p>${t("O agente automático não correu esta semana, por isso não há custo estimado. As janelas do Claude Code vão no plano: os tokens de cada um estão em Uso de IA.")}</p><a class="btn sm" href="#/uso">${t("Uso de IA")}</a></div>`);
    if (!e.items.length) return top + ui.sec("Movimentos") + `<div class="panel">${ui.empty("wallet", "Ainda sem despesas registadas",
      "Regista o que a equipa paga: o plano do Claude, o Higgsfield, domínios, anúncios. Cada despesa fica com a data, a categoria e quem a registou. Não há ligação a bancos.", register)}</div>` + aiBlock;
    const sums = Object.keys(EXPENSE_CATS).map((cat) => [cat, month.filter((x) => x.category === cat)]);
    const heart = cur && perMonth.some(Boolean) ? `<div class="panel pad" style="margin-top:14px"><div class="pn-card-h">${t("Mês a mês")}<small>${t("em {c}, os últimos 6 meses", { c: cur })}</small></div>
      ${ui.bars(months.map((m, i) => ({ label: new Date(`${m}-15T12:00:00`).toLocaleDateString("pt-PT", { month: "short" }).replace(".", ""), value: perMonth[i], tip: fmt.money(perMonth[i], cur) })))}</div>` : "";
    const most = Math.max(1, ...sums.map(([, l]) => l.reduce((n, x) => n + x.amount, 0)));
    return top + heart + ui.sec(`${t("Por categoria")} · ${monthName}`) + `<div class="panel vw-cats">${sums.map(([cat, list]) => `<div class="vw-cat ${list.length ? "" : "none"}">
        <span class="vw-cat-ic">${icon(EXPENSE_ICON[cat])}</span><div><b>${t(EXPENSE_CATS[cat])}</b><span>${t(EXPENSE_HINT[cat])}</span></div>
        ${bar((list.reduce((n, x) => n + x.amount, 0) / most) * 100)}<em>${list.length ? esc(moneyText(moneyOf(list))) : "—"}</em></div>`).join("")}</div>`
      + ui.sec("Movimentos", `<span class="faint">${e.items.length}</span>`)
      + `<div class="panel rows">${e.items.map((x) => `<div class="rw vw-exp"><span class="vw-cat-ic">${icon(EXPENSE_ICON[x.category] || "wallet")}</span>
          <div class="rw-main"><b>${esc(x.title)}</b><span>${esc([fmt.date(x.spent_on), t(EXPENSE_CATS[x.category] || x.category), x.by, companies.find((c) => c.id === x.company)?.name].filter(Boolean).join(" · "))}</span></div>
          <span class="mono vw-tok">${fmt.money(x.amount, x.currency)}</span>${leadOnly(`<button class="btn quiet sm" data-del-expense="${x.id}" title="${t("Apagar")}" aria-label="${t("Apagar")}">${icon("x")}</button>`)}</div>`).join("")}</div>`
      + aiBlock;
  }, 6);
}
HUB_VIEWS.despesas = async function () {
  await pagesCss();
  page(`${ui.head("Análise", t("Despesas"), t("O que a equipa paga, registado à mão, e o que a IA custou (estimado)."), leadOnly(ui.btn("Registar despesa", "data-new-expense", "primary", "plus")))}<div id="expenses"></div>`);
  $("view").onclick = async (e) => {
    const del = e.target.closest("[data-del-expense]");
    if (del) { await api(`/api/expenses/${del.dataset.delExpense}`, { method: "DELETE" }).catch((err) => flash(err.message)); $("expenses")._html = null; return loadExpenses(); }
    if (!e.target.closest("[data-new-expense]")) return;
    formModal("Registar despesa", field("O quê", '<input name="title" required placeholder="ex: Plano do Claude · outubro">', true)
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
// The Memória has dozens of notes written by several Claudes: newest first by default, grouped by day with the
// time on each note, so what a session just saved is at the top; "Por tema" groups them by category instead.
let memoryView = "recent", memoryCat = "all", memoryQuery = "", memoryAll = [], memoryNames = {};
const MEM_TOPICS = ["REGRAS", "EMPRESA", "HUB", "WIDGET", "TELEMÓVEL", "DESIGN"];   // the usual ones, in this order; others follow
const memCat = (m) => (m.category || "").trim().toUpperCase() || t("GERAL");
const memFold = (text) => String(text || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const memAge = (iso) => Date.now() - new Date(iso).getTime();
function memRow(m) {
  const place = m.scope === "team" ? "" : `${t(MEMORY_SCOPES.find(([s]) => s === m.scope)?.[1] || m.scope)}${m.scope_id ? ` · ${memoryNames[`${m.scope}:${m.scope_id}`] || m.scope_id}` : ""}`;
  const when = memoryView === "recent" ? fmt.hhmm(m.updated_at) : `${fmt.day(m.updated_at)} ${fmt.hhmm(m.updated_at)}`;
  return `<div class="mem-row ${memoryOpen.has(m.id) ? "open" : ""}" data-memory="${m.id}">
    <button class="mem-head" data-toggle-memory>${memAge(m.updated_at) < 108e5 ? '<i class="mem-new" title="Guardada nas últimas 3 horas"></i>' : ""}
      ${memoryView === "recent" || memoryCat === "all" ? ui.tag(memCat(m)) : ""}<b class="mem-title">${esc(m.title.trim())}</b>
      <span class="mem-peek">${esc(memPeek(m.content))}</span>${place ? `<span class="mem-place">${esc(place)}</span>` : ""}
      <time class="mem-when">${esc(when)}</time><span class="mem-chev">${icon("chevron")}</span></button>
    <div class="mem-body">${m.content ? `<p>${memText(m.content.trim())}</p>` : `<p class="faint">${t("Sem texto.")}</p>`}
      <div class="mem-foot"><span class="faint">${t("Atualizada")} ${fmt.day(m.updated_at)} ${fmt.hhmm(m.updated_at)}</span><button class="btn quiet sm" data-edit-memory>${t("Editar")}</button></div></div></div>`;
}
function renderMemory() {
  const cats = [...new Set(memoryAll.map(memCat))].sort((a, b) => ((MEM_TOPICS.indexOf(a) + 1 || 99) - (MEM_TOPICS.indexOf(b) + 1 || 99)) || a.localeCompare(b));
  const n = (c) => memoryAll.filter((m) => memCat(m) === c).length;
  paint($("memory-cats"), [["all", t("Tudo"), memoryAll.length], ...cats.map((c) => [c, c.charAt(0) + c.slice(1).toLowerCase(), n(c)])]
    .map(([id, label, k]) => `<button class="chp ${id === memoryCat ? "on" : ""}" data-cat="${esc(id)}">${esc(label)} <span class="mem-n">${k}</span></button>`).join(""));
  for (const b of document.querySelectorAll("#memory-view [data-view]")) b.classList.toggle("on", b.dataset.view === memoryView);
  const words = memFold(memoryQuery).split(/\s+/).filter(Boolean);
  const items = memoryAll.filter((m) => (memoryCat === "all" || memCat(m) === memoryCat)
    && words.every((w) => memFold(`${m.title} ${m.content} ${m.category}`).includes(w)))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const box = $("memory");
  if (!memoryAll.length) { box.innerHTML = `<div class="panel">${ui.empty("layers", "Memória vazia", "O que escreveres aqui é dado ao agente antes de ele começar uma tarefa deste âmbito.",
    `<button class="btn sm primary" data-new-memory>${t("Adicionar à memória")}</button>`)}</div>`; return; }
  if (!items.length) { box.innerHTML = `<div class="panel">${ui.empty("search", "Nada encontrado", "Nenhuma nota tem estas palavras nesta categoria.")}</div>`; return; }
  const groups = new Map();
  for (const m of items) {
    const key = memoryView === "recent" ? fmt.day(m.updated_at) : memCat(m);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }
  const order = memoryView === "recent" ? [...groups] : [...groups].sort(([a], [b]) => cats.indexOf(a) - cats.indexOf(b));
  box.innerHTML = order.map(([key, list]) => `<section class="mem-group"><div class="sec"><span>${esc(key)}</span><span class="faint">${list.length}</span></div>
    <div class="panel mem-list">${list.map(memRow).join("")}</div></section>`).join("");
}
async function loadMemory() {
  await mount($("memory"), async () => {
    memoryAll = await api("/api/memory");
    memoryNames = {};
    for (const scope of new Set(memoryAll.filter((m) => m.scope_id).map((m) => m.scope))) for (const [id, name] of await memoryTargets(scope).catch(() => [])) memoryNames[`${scope}:${id}`] = name;
    return "";
  }, 5);
  if (!$("memory")?.querySelector(".err")) { renderMemory(); paintMemoryKpis(); }   // a failed load keeps its error and Tentar outra vez
}
// the Painel over the notes (27 Oct): how many there are, what changed this week, and the themes they fall in
function paintMemoryKpis() {
  if (!$("memory-kpis") || !memoryAll.length) return paint($("memory-kpis"), "");
  const at = (m) => m.updated_at, week = series.inPeriod(memoryAll, at, 0, 7);
  const cats = Object.entries(memoryAll.reduce((o, m) => ({ ...o, [memCat(m)]: (o[memCat(m)] || 0) + 1 }), {})).sort((a, b) => b[1] - a[1]);
  const nice = (c) => c.charAt(0) + c.slice(1).toLowerCase();
  const tasks = memoryAll.filter((m) => memCat(m) === "TAREFAS").length;
  paint($("memory-kpis"), kpiRow([
    kpi("Notas", memoryAll.length, { sub: t("o que a IA lê antes de cada tarefa"), viz: ui.spark(series.byDay(memoryAll, at, 14).map((d) => d.value)) }),
    kpi("Mexidas · 7 dias", week, { sub: t("escritas ou reescritas"), delta: ui.delta(week, series.inPeriod(memoryAll, at, 7, 14), { label: t("contra a semana antes") }),
      viz: ui.cols(series.byDay(memoryAll, at, 7).map((d) => d.value)) }),
    kpi("Temas", cats.length, { sub: cats.slice(0, 3).map(([c, n]) => `${nice(c)} ${n}`).join(" · ") }),
    kpi("Tarefas lembradas", tasks, { sub: t("notas TAREFAS dos agentes"), viz: ui.ring((tasks / memoryAll.length) * 100) })])
    + `<div class="panel pad" style="margin:14px 0 18px"><div class="pn-card-h">${t("Notas por tema")}<small>${t("{n} temas", { n: cats.length })}</small></div>
      ${ui.bars(cats.slice(0, 12).map(([c, n]) => ({ label: nice(c).slice(0, 10), value: n, tip: t("{n} notas", { n }) })), { hi: 0 })}</div>`);
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
    loadMemory();
  }, existing ? { danger: { label: "Apagar", run: async () => { await api(`/api/memory/${existing.id}`, { method: "DELETE" }); loadMemory(); } } } : {});
}
HUB_VIEWS.memoria = async function () {
  memoryScope = "team";   // where a new note goes by default
  pagesCss();
  page(`${ui.head("Sistema", t("Memória"), t("O que a IA deve saber antes de começar. As mais recentes em cima; clica numa nota para a abrir."), ui.btn("Adicionar à memória", "data-new-memory", "primary", "plus"))}
    <div id="memory-kpis" class="mem-kpis"></div><div class="mem-bar"><div class="mem-seg" id="memory-view"><button class="chp" data-view="recent">${t("Mais recentes")}</button><button class="chp" data-view="topic">${t("Por tema")}</button></div>
      <label class="mem-search">${icon("search")}<input id="memory-q" type="search" placeholder="${esc(t("Procurar na memória"))}" value="${esc(memoryQuery)}"></label></div>
    <div class="chipbar" id="memory-cats"></div><div class="mem" id="memory"></div>`);
  $("memory-q").oninput = (e) => { memoryQuery = e.target.value; renderMemory(); };
  $("view").onclick = async (e) => {
    if (e.target.closest("a.mem-link")) return;   // the link opens; the note stays as it is
    const view = e.target.closest("#memory-view [data-view]"), cat = e.target.closest("#memory-cats [data-cat]"), row = e.target.closest("[data-memory]");
    if (view) { memoryView = view.dataset.view; return renderMemory(); }
    if (cat) { memoryCat = cat.dataset.cat; return renderMemory(); }
    if (e.target.closest("[data-new-memory]")) return editMemory();
    if (!row) return;
    const id = Number(row.dataset.memory);
    if (e.target.closest("[data-edit-memory]")) return editMemory(memoryAll.find((m) => m.id === id));
    if (e.target.closest("[data-toggle-memory]")) { row.classList.toggle("open"); memoryOpen[row.classList.contains("open") ? "add" : "delete"](id); }
  };
  await loadMemory();
};

/* ================================================================ week, code, companies: the older pages, extended */
HUB_VIEWS.semana = async function () {
  await tqLoad();
  return tqWeek();
};

HUB_VIEWS.codigo = async function () {
  await pagesCss();
  const done = viewCode(); // the older page (app.js): the work not yet committed and the commit feed
  const head = $("view").querySelector(".page-head");
  if (head) head.outerHTML = `${ui.head("Trabalho", t("Código"), t("Quem mexeu, onde e quanto, em cada commit. Atualiza sozinho."))}<div id="code-status"></div>`;
  mount($("code-status"), async () => {
    const [commits, tasks] = await Promise.all([api("/api/commits?limit=100").catch(() => null), api("/api/tasks")]);
    const repos = {};
    for (const c of commits || []) (repos[c.repo] ||= { name: c.repo, commits: 0, last: c }).commits++;
    const today = (commits || []).filter((c) => sameDay(c.date));
    const branches = tasks.filter((x) => x.git_branch && x.stage !== "done");
    const src = commits ? "live" : "not_connected";
    const days = commits ? series.byDay(commits, (c) => c.date, 14) : null;
    const authors = commits ? Object.entries(commits.reduce((o, c) => ({ ...o, [c.author]: (o[c.author] || 0) + 1 }), {})).sort((a, b) => b[1] - a[1]) : [];
    const repoList = Object.values(repos).sort((a, b) => b.commits - a.commits);
    return kpiRow([kpi("Repositórios", commits ? Object.keys(repos).length : null, { src, sub: commits ? Object.keys(repos).slice(0, 3).join(", ") : "" }),
        kpi("Commits recentes", commits ? commits.length : null, { src, sub: commits?.length ? t("o último {q}", { q: fmt.ago(commits[0].date) }) : "", viz: days ? ui.spark(days.map((d) => d.value)) : "" }),
        kpi("Commits hoje", commits ? today.length : null, { sub: today.length ? [...new Set(today.map((c) => c.author))].join(", ") : t("ainda nenhum"),
          delta: days ? ui.delta(today.length, days[days.length - 2].value, { label: t("contra ontem") }) : "", viz: days ? ui.cols(days.slice(-7).map((d) => d.value)) : "" }),
        kpi("Branches abertos", branches.length, { sub: t("tarefas com um branch de git"), href: "#/tarefas" })])
      + (commits?.length ? `<div class="pn-split" style="margin-top:14px">
          <div class="panel pad"><div class="pn-card-h">${t("Quem e onde")}<small>${t("os últimos {n} commits", { n: commits.length })}</small></div>
            ${authors.length > 1 ? ui.share({ label: authors[0][0], value: authors[0][1] }, { label: authors.length > 2 ? t("os outros") : authors[1][0], value: commits.length - authors[0][1] }) : ""}
            <div style="margin-top:14px">${ui.bars(repoList.slice(0, 8).map((r) => ({ label: r.name.length > 11 ? `${r.name.slice(0, 10)}…` : r.name, value: r.commits, tip: `${r.name}: ${r.commits}` })), { hi: 0 })}</div></div>
          <div class="panel pad"><div class="pn-card-h">${t("Commits por dia")}<small>${t("últimas 2 semanas")}</small></div>
            ${ui.bars(days, { fmtV: (v) => t(v === 1 ? "1 commit" : "{n} commits", { n: v }) })}</div></div>` : "")
      + (branches.length ? `${ui.sec("Branches com trabalho")}<div class="panel rows">${branches.map((x) => `<a class="rw" href="#/tarefas/${x.id}"><span class="mono vw-branch">${esc(x.git_branch)}</span>
        <div class="rw-main"><b>${esc(x.title)}</b><span>${x.agent_role ? "Claude / " : ""}${esc(nameOf(x.assignee))}</span></div>${ui.tag(t(STAGE_LABEL[x.stage]), STAGE_TONE[x.stage])}</a>`).join("")}</div>` : "");
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
      const home = c.main ? "#/tenfold" : c.id === "baredesk" ? "#/baredesk" : `#/empresas/${c.id}`; // the main company has its own page
      return `<article class="wf ${c.main ? "tf-folder" : ""}">
        <a class="wf-head" href="${home}"><span class="wf-logo">${esc(c.short || c.name.slice(0, 3))}</span>
          <div>${c.main ? `<small class="tf-tag">${t("O trabalho principal")}</small>` : ""}<b>${esc(c.name)}</b><span>${esc(c.tagline || "")}</span></div>${icon("chevron")}</a>
        <div class="wf-facts"><span class="wf-fact"><b>${open}</b> ${t(open === 1 ? "tarefa aberta" : "tarefas abertas")}</span><span class="wf-fact"><b>${done}</b> ${t("feitas")}</span>${shop}
          ${top ? `<span class="wf-fact">${t("Mais ativo")}: ${esc(top.name)}</span>` : ""}</div>
        <div class="wf-lib">${c.sections.map((x) => `<a href="${c.main ? `#/tenfold/${x.id}` : c.id === "baredesk" ? `#/baredesk/${x.id}` : `#/empresas/${c.id}/${x.id}`}">${icon(x.id)}<span>${esc(t(x.label))}</span>${x.count != null ? `<i>${x.count}</i>` : ""}</a>`).join("")}</div></article>`;
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
        ${general("#/kit", "bolt", "Kit do Claude", t("os mesmos plugins e skills em todos os PCs"), `<div id="wg-kit">${ui.skeleton(2)}</div>`)}
      </div>`;
  }, 6);
  // the Kit do Claude card after the rest: it asks the other PCs, and a PC that is off makes it wait a couple of seconds
  const kit = await api("/api/kit").catch(() => null);
  if (!$("wg-kit")) return;
  const ST = { on: ["ok", "Ligado"], off: ["warn", "Desligado"], down: ["off", "PC desligado"] };
  const pcs = kit ? [{ who: kit.here.who, state: kit.here.on ? "on" : "off", here: true }, ...kit.peers] : [];
  paint($("wg-kit"), pcs.length ? pcs.map((p) => `<div class="wg-row"><span class="wg-dot ${ST[p.state]?.[0] || ""}"></span><div><b>${esc(nameOf(p.who))}${p.here ? ` · ${t("este PC")}` : ""}</b><span>${t(ST[p.state]?.[1] || "PC desligado")}</span></div></div>`).join("")
    : `<p class="wg-none">${t("Não consegui ver os PCs agora.")}</p>`);
}

HUB_VIEWS.empresas = async function (r) {
  if (!r.company) return workOverview();
  if (companies.find((c) => c.id === r.company)?.main) { location.replace(`#/tenfold${r.section ? `/${r.section}` : ""}`); return; } // old links
  const done = viewCompanies(r); // the older page: the company's library (theme, skills, videos, photos, docs)
  const company = companies.find((c) => c.id === r.company) || companies[0];
  const anchor = $("work");
  if (company && anchor) {
    anchor.insertAdjacentHTML("beforebegin", `<div id="co-over"></div>`);
    mount($("co-over"), async () => {
      const o = await api(`/api/companies/${company.id}/overview`);
      // the Painel's row (27 Oct): what the Hub knows of the company; the shop's figures are said once as not connected
      return kpiRow([kpi("Tarefas abertas", o.open_tasks, { href: "#/tarefas", go: "Ver" }), kpi("Projetos", o.projects, { href: "#/projetos", go: "Ver" }),
          kpi("Memória", o.memory, { sub: t("notas desta empresa"), href: "#/memoria", go: "Ver" }),
          kpi("Custo de IA", o.ai_cost_usd == null ? null : fmt.usd(o.ai_cost_usd), { src: o.ai_cost_usd == null ? "" : "estimated" }),
          kpi("Anúncios", o.ad_spend.length ? o.ad_spend.map((s) => fmt.money(s.amount, s.currency)).join(" + ") : null, { sub: t("registado à mão") })])
        + `<p class="faint" style="margin:10px 2px 18px;font-size:12px">${ui.src("not_connected")} ${t("Receita, encomendas, tráfego e conversão: a loja desta empresa ainda não está ligada ao Hub.")}</p>`;
    }, 2);
  }
  await done;
};

/* Ten Fold, the main work (Marco, 27 Oct: «vai ser o trabalho principal… não é nada semelhante, é mesmo uma empresa»): the
   agency has its own entry, first in Negócios, and its own colours (obsidian and gold, from its site), so it never reads like
   one more shop. The hero, the production lines (one per section of the library, with what it holds), the numbers of the
   work, then the library as every company has it, with the agency's own site first. */
const TF_LINE = { sites: "no portefólio", marcas: "peças de marca", instagram: "prontas a publicar", videos: "reels", docs: "notas" };
HUB_VIEWS.tenfold = async function (r) {
  const c = companies.find((x) => x.main) || companies.find((x) => x.id === "tenfold");
  if (!c) return page(ui.empty("building", "A Ten Fold não está neste PC", t("Faz git pull no team-agent.")));
  if (r.company === "chat") { location.replace("#/mensagens/team"); return; }   // the old address of the team's chat
  const done = viewCompanies({ company: c.id, section: r.company, base: "#/tenfold" });
  const shown = (r.company && c.sections.find((s) => s.id === r.company)) || c.sections[0];
  const made = c.sections.filter((s) => s.id !== "docs").reduce((n, s) => n + (s.count || 0), 0);
  $("view").innerHTML = `<div class="tf">
    <section class="tf-hero">
      <span class="tf-mark">${esc(c.short || "TF")}</span>
      <div class="tf-id"><small>03 · ${t("Negócios")} · ${t("O trabalho principal")}</small><h1>${esc(c.name)}</h1><p>${esc(c.tagline || "")}</p></div>
      <div class="tf-act"><a class="tf-btn gold" href="#/tenfold/sites">${icon("eye")}${t("Ver o site")}</a><button class="tf-btn" id="tf-task">${icon("plus")}${t("Nova tarefa")}</button>
        <a class="tf-app" href="#/mensagens/team" title="${esc(t("Abrir o Chat da equipa"))}"><i>${icon("chat")}<em id="tf-unread" hidden></em></i><span>${esc(t("Chat"))}</span></a>
        <a class="tf-app" href="#/fotos" title="${esc(t("Abrir as Fotos da agência"))}"><i>${icon("fotos")}<em id="tf-photos" hidden></em></i><span>${esc(t("Fotos"))}</span></a></div>
    </section>
    <nav class="tf-lines">${c.sections.map((s) => `<a class="tf-line ${s.id === shown.id ? "on" : ""}" href="#/tenfold/${esc(s.id)}">
      <span>${icon(s.id)}${esc(t(s.label))}</span><b>${s.count ?? "—"}</b><small>${t(TF_LINE[s.id] || "")}</small></a>`).join("")}</nav>
    <div id="tf-nums"></div>
    ${$("view").innerHTML}</div>`;
  $("tf-task").onclick = () => newTask({ company: c.id });
  mount($("tf-nums"), async () => {
    const o = await api(`/api/companies/${c.id}/overview`);
    return kpiRow([kpi("Em produção", o.open_tasks, { sub: t("tarefas abertas"), href: "#/tarefas", go: "Ver" }),
      kpi("Entregues", o.done_tasks, { sub: t("tarefas feitas") }),
      kpi("Portefólio", made, { sub: t("sites, marcas, posts e vídeos") }),
      kpi("Custo de IA", o.ai_cost_usd == null ? null : fmt.usd(o.ai_cost_usd), { src: o.ai_cost_usd == null ? "" : "estimated" })]);
  }, 1);
  // the Chat is the agency's app (30 Oct, Marco: «o chat de equipa é uma aplicação»): an app icon here, with what is unread
  api("/api/photos").then((p) => { const el = $("tf-photos"); if (el && p.items.length) { el.textContent = p.items.length; el.classList.add("n"); el.hidden = false; } }).catch(() => {});
  api("/api/messages").then((m) => { const el = $("tf-unread"); if (el && m.unread) { el.textContent = m.unread > 99 ? "99+" : m.unread; el.hidden = false; } }).catch(() => {});
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
  await pagesCss();
  page(`${ui.head("Trabalho", t("Entregas"), t("O que mudou em cada push: fotos, design, textos e código, cada coisa no seu sítio."))}
    <div id="push-kpis" class="push-kpis"></div><div class="vw-filters"><div class="chipbar" id="push-who"></div><div class="chipbar" id="push-kind"></div></div>
    <div class="push-list" id="push-list">${ui.skeleton(6)}</div>`);
  let all;
  try { all = await api("/api/commits?limit=60"); }
  catch (e) {
    if (e.message === "unauthorized" || !$("push-list")) return;
    $("push-list").innerHTML = `<div class="panel">${ui.error(e.message)}</div>`;
    $("push-list").querySelector("[data-retry]").onclick = () => HUB_VIEWS.entregas();
    return;
  }
  // the Painel's figures (27 Oct): pushes day by day and what kind of thing they brought
  if (all.length && $("push-kpis")) {
    const n = (k) => all.filter((c) => c.kinds?.[k]).length, days = series.byDay(all, (c) => c.date, 14);
    paint($("push-kpis"), kpiRow([
      kpi("Pushes", all.length, { sub: t("o último {q}", { q: fmt.ago(all[0].date) }), viz: ui.spark(days.map((d) => d.value)) }),
      kpi("Esta semana", series.inPeriod(all, (c) => c.date, 0, 7), { delta: ui.delta(series.inPeriod(all, (c) => c.date, 0, 7), series.inPeriod(all, (c) => c.date, 7, 14), { label: t("contra a semana antes") }),
        sub: t("{n} hoje", { n: days[days.length - 1].value }), viz: ui.cols(days.slice(-7).map((d) => d.value)) }),
      ...PUSH_KINDS.slice(0, 2).map(([k, label]) => kpi(`${t("Com")} ${t(label).toLowerCase()}`, n(k), { sub: t("dos últimos {n}", { n: all.length }), viz: ui.ring((n(k) / all.length) * 100) }))]));
  }
  const draw = () => {
    if (!$("push-list")) return;
    const authors = [...new Set(all.map((c) => c.author))];
    $("push-who").innerHTML = `<span class="vw-chip-label">${t("Quem")}</span>` + ["", ...authors].map((a) =>
      `<button class="chp ${a === pushWho ? "on" : ""}" data-a="${esc(a)}">${a ? esc(a) : t("Todos")}</button>`).join("");
    $("push-kind").innerHTML = `<span class="vw-chip-label">${t("O quê")}</span>` + [["", "Tudo"], ...PUSH_KINDS].map(([k, label]) =>
      `<button class="chp ${k === pushKind ? "on" : ""}" data-k="${k}">${t(label)}</button>`).join("");
    const items = all.filter((c) => (!pushWho || c.author === pushWho) && (!pushKind || c.kinds?.[pushKind]));
    $("push-list").innerHTML = items.length ? items.map(pushHtml).join("") : `<div class="panel">${!all.length
      ? ui.empty("layers", "Ainda sem entregas", "Cada push para o GitHub aparece aqui, com as fotos, o design, os textos e o código que mudaram. Confirma os repositórios em library/repos.json.", `<a class="btn sm" href="#/codigo">${t("Ver o código")}</a>`)
      : ui.empty("search", "Nenhum push com isto", "Muda o filtro de cima para ver os outros.", `<button class="btn sm" data-a="" data-k="">${t("Ver tudo")}</button>`)}</div>`;
    for (const img of $("push-list").querySelectorAll("img[data-blob]")) { // a picture needs the sign-in, so it cannot be a plain src
      fetch(img.dataset.blob, { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => (r.ok ? r.blob() : Promise.reject()))
        .then((b) => { img.src = img.parentNode.href = URL.createObjectURL(b); })
        .catch(() => img.closest("figure").classList.add("gone"));
    }
  };
  $("view").onclick = (e) => {
    const b = e.target.closest("[data-a], [data-k]");
    if (!b) return;
    if (b.dataset.a !== undefined) pushWho = b.dataset.a;
    if (b.dataset.k !== undefined) pushKind = b.dataset.k;
    draw();
  };
  draw();
};
