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
function taskCard(x) {
  const late = x.deadline && x.stage !== "done" && new Date(x.deadline) < new Date();
  const mineOf = x.group && x.group.find((y) => y.assignee === me.username);
  const doer = doingOf(x);
  const stack = doer ? doingBadge(doer) : x.group ? allPlate(x.group) : whoPlate(x.assignee);
  const top = [x.priority === "urgent" ? ui.tag(t("Urgente"), "bad") : x.priority === "high" ? ui.tag(t("Alta"), "warn") : "", x.group ? ui.tag(groupLabel(x.group), "ai") : "", isFresh(x) ? ui.tag(t("Nova"), "ok") : ""].join("");
  return `<article class="tk ${x.priority === "urgent" ? "urgent" : x.priority === "high" ? "high" : ""} ${isFresh(x) ? "fresh" : ""} ${doer ? "doing" : ""} ${x.group ? "for-all" : isMe(x.assignee) ? "mine" : ""}"
    style="${x.group ? "" : whoVar(x.assignee)}" draggable="${x.group ? "false" : "true"}" data-id="${(mineOf || x).id}">
    ${top ? `<div class="tk-top">${top}</div>` : ""}
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
    x.stage === "in_progress" ? `<em class="ai">${t("Em curso")}</em>` : x.stage === "blocked" ? `<em class="late">${t("Bloqueada")}</em>` : ""].filter(Boolean);
  const check = done ? `<span class="tl-check">${icon("tick")}</span>`
    : own && own.stage !== "done" && !heldByAgent(own) ? `<button class="tl-check" data-done="${own.id}" title="${t("Concluir")}"></button>`
    : `<span class="tl-check ${own && own.stage === "done" ? "part" : "held"}">${own && own.stage === "done" ? icon("tick") : ""}</span>`;
  return `<div class="tl-row ${tone} ${x.group && !inCol ? "for-all" : isMe(inCol ? x.assignee : who) ? "mine" : ""}" style="${x.group && !inCol ? "" : whoVar(inCol ? x.assignee : who)}" data-id="${(own || x).id}">${check}
    <div class="tl-t"><b>${tone === "urgent" ? '<i class="bang">!!</i>' : tone === "high" ? '<i class="bang high">!</i>' : ""}${esc(x.title)}</b>${meta.length ? `<span>${meta.join(" · ")}</span>` : ""}</div>
    ${side}</div>`;
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

async function loadBoard() {
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
const crewPicker = (crew, chosen = "") => `<div class="cmp-crew" role="radiogroup" aria-label="${esc(t("Quem do escritório"))}">
    <label class="cmp-ag auto"><input type="radio" name="crew" value="" ${chosen ? "" : "checked"}><span>${icon("bolt")}<b>${t("Automático")}</b><em>${t("O escritório escolhe")}</em></span></label>
    ${crew.map((c) => `<label class="cmp-ag" data-crew="${esc(c.id)}"><input type="radio" name="crew" value="${esc(c.id)}" ${chosen === c.id ? "checked" : ""}><span>${icon(CREW_ICON[c.id] || "bot")}<b>${esc(c.name)}</b><em>${esc(t(c.what))}</em></span></label>`).join("")}</div>
  <p class="cmp-route idle" data-route aria-live="polite"></p>`;
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

async function newTask(preset = {}) {
  const [users, projects, crew] = await Promise.all([api("/api/users"), api("/api/projects"), loadCrew()]);
  let kept = "";
  try { kept = localStorage.getItem("hub.taskMode") || ""; } catch { /* private window: it starts on "Pessoa" */ }
  const mode = preset.for_ai || preset.crew ? "office" : preset.assignee ? "person" : kept === "office" ? "office" : "person";
  const pick = (name, value, label, on) => `<label class="who-opt"><input type="radio" name="${name}" value="${esc(value)}" ${on ? "checked" : ""}><span>${esc(label)}</span></label>`;
  openModal(`<form class="cmp" id="cmp" autocomplete="off" data-mode="${mode}">
    ${cmpHead("plus", "Nova tarefa")}
    <input class="cmp-title" name="title" maxlength="200" placeholder="${esc(t("O que é preciso fazer?"))}" value="${esc(preset.title || "")}" aria-label="${esc(t("Título"))}">
    <textarea class="cmp-desc" name="description" rows="2" placeholder="${esc(t("Pormenores, links, o que tem de ficar feito (opcional)"))}" aria-label="${esc(t("Descrição"))}">${esc(preset.description || "")}</textarea>
    <section class="cmp-sec"><h4>${t("Quem faz")}</h4>
      <div class="cmp-mode" role="radiogroup" aria-label="${esc(t("Quem faz"))}">
        <label><input type="radio" name="mode" value="office" ${mode === "office" ? "checked" : ""}><span><i>${icon("bot")}</i><b>${t("Escritório")}</b><em>${t("Os agentes fazem sozinhos, já")}</em></span></label>
        <label><input type="radio" name="mode" value="person" ${mode === "person" ? "checked" : ""}><span><i>${icon("users")}</i><b>${t("Pessoa")}</b><em>${t("Fica em «Por fazer» até alguém a fazer")}</em></span></label></div>
      <div class="cmp-pane" data-pane="office">${crewPicker(crew, preset.crew || "")}
        ${me.lead && users.length > 1 ? `<div class="cmp-line"><span>${t("No computador de")}</span><div class="who">${users.map((u) => pick("pc", u.username, u.display_name, u.username === me.username)).join("")}</div></div>` : ""}</div>
      <div class="cmp-pane" data-pane="person">${whoPicker(users, preset.assignee || me.username)}${me.lead ? "" : `<p class="cmp-note">${t("Fica contigo, em «Por fazer».")}</p>`}</div>
    </section>
    <section class="cmp-sec cmp-two">${duePicker()}
      <div class="field"><span>${t("Prioridade")}</span><div class="who">${Object.entries(PRIORITY).map(([k, v]) => pick("priority", k, t(v), k === (preset.priority || "normal"))).join("")}</div></div>
    </section>
    <details class="cmp-more" ${preset.project_id || preset.company ? "open" : ""}><summary>${icon("sliders")}${t("Projeto, empresa e branch")}</summary><div class="form-grid">
      ${field("Projeto", `<select name="project_id">${options([["", t("Sem projeto")], ...projects.map((p) => [p.id, p.name])], preset.project_id)}</select>`)}
      ${field("Empresa", `<select name="company">${options([["", t("Sem empresa")], ...companies.map((c) => [c.id, c.name])], preset.company)}</select>`)}
      ${field("Branch de git", `<input name="git_branch" placeholder="ex: checkout-fix">`, true)}</div></details>
    <p class="error" id="cmp-error"></p>
    <footer class="cmp-foot"><span class="cmp-key">${t("Ctrl + Enter envia")}</span><button type="button" class="btn quiet" data-close>${t("Cancelar")}</button><button class="btn primary" id="cmp-go"></button></footer></form>`);
  const form = $("cmp"), go = $("cmp-go"), fail = $("cmp-error");
  $("modal-box").classList.add("cmp-box");
  const read = () => Object.fromEntries(new FormData(form).entries());
  const watch = routeWatch(form, () => { const v = read(); return { title: v.title.trim(), description: v.description, crew: v.crew || "", assignee: v.pc || me.username }; });
  const sync = (now) => {
    const v = read();
    form.dataset.mode = v.mode;
    go.innerHTML = v.mode === "office" ? `${esc(t("Mandar para o escritório"))}${icon("arrow")}` : `${icon("plus")}${esc(t("Criar tarefa"))}`;
    if (v.mode === "office") watch(now === true);
  };
  form.addEventListener("input", sync);
  form.elements.title.onkeydown = (e) => { if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) { e.preventDefault(); form.elements.description.focus(); } };
  form.onkeydown = (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); form.requestSubmit(); } };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const v = read(), office = v.mode === "office";
    fail.textContent = "";
    try {
      if (!v.title.trim()) { form.elements.title.focus(); throw new Error(t("Escreve o que é preciso fazer.")); }
      if (!office && !v.assignee) throw new Error(t("Escolhe pelo menos uma pessoa."));
      if (!office && !v.due_pick) throw new Error(t("Diz para quando é a tarefa (ou escolhe «Sem prazo»)."));
      if (v.due_pick === "data" && !v.deadline) throw new Error(t("Escolhe a data do prazo."));
      go.disabled = true;
      const assignee = office ? v.pc || me.username : v.assignee;
      const made = await api("/api/tasks", { method: "POST", body: { ...taskBody({ ...v, assignee }), for_ai: office, crew: office ? v.crew || "" : "" } });
      try { localStorage.setItem("hub.taskMode", v.mode); } catch { /* private window: it just is not remembered */ }
      flash(office ? t("Mandada para o escritório: {n} · {s}.", { n: made.crew_name, s: t(made.crew_what) })
        : assignee === "all" ? t("Tarefa enviada a todos.") : assignee.includes(",") ? t("Tarefa enviada a {n} pessoas.", { n: assignee.split(",").length }) : t("Tarefa criada."));
      closeModal();
      loadBoard();
    } catch (err) { fail.textContent = err.message; go.disabled = false; }
  };
  sync(true);
  form.elements.title.focus();
}

// A task that exists, handed to the office: the same picker, with the task's own words deciding when nobody is named.
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
  const buttons = `${canGiveToAI(x) ? ui.btn("Entregar ao escritório", "data-act=ai", "", "bot") : ""}
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
    if (act === "due" || act === "nodue") {
      const value = act === "due" ? $("task-due").value : "";
      if (act === "due" && !value) return flash(t("Escolhe o dia e a hora do prazo."));
      try {
        await api(`/api/tasks/${x.id}`, { method: "PATCH", body: { deadline: value ? new Date(value).toISOString() : null } });
        flash(t(value ? "Prazo guardado." : "Prazo tirado.")); loadBoard(); openTaskModal(x.id);
      } catch (err) { flash(err.message); }
      return;
    }
    if (act === "ai") return assignToAI(x);
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
  page(`${ui.head("Centro de comando", t("Tarefas"), t("Cada sócio tem a sua cor, e as tuas dizem TU. Carrega numa pessoa para ver só as dela."),
    `<div class="segx" id="task-view">${[["pessoas", "Por pessoa"], ["lista", "Por prazo"], ["quadro", "Quadro"]].map(([v, l]) => `<button data-view="${v}" class="${v === taskView ? "on" : ""}">${t(l)}</button>`).join("")}</div>
    ${ui.btn("Nova tarefa", "data-new-task", "primary", "plus")}`)}
    <div class="pstrip" id="task-people"></div><div class="chipbar" id="task-filter"></div><div class="board" id="board"></div><div class="bin" id="bin"></div>`);
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
  // whoever said "Estou a fazer" on a task: their photo in the turning ring and the task, first thing on their card
  await mount($("team-grid"), async () => (await api("/api/agents"))
    .sort((a, b) => !!b.doing - !!a.doing || (a.status === "OFFLINE") - (b.status === "OFFLINE")).map((a) => `<a class="panel hover agent-card ${a.doing ? "doing" : ""}" href="${a.doing ? `#/tarefas/${a.doing.id}` : `#/agentes/${esc(a.id)}`}">
    <div class="rowx">${a.doing ? `<span class="dl-ring">${ui.avatar(a.display_name, "lg")}</span>` : ui.avatar(a.display_name, "lg")}<div class="grow"><b style="font-size:15px">${esc(a.display_name)}</b>
      <div>${ui.status(a.status === "OFFLINE" ? "OFFLINE" : "ONLINE")}</div></div></div>
    ${a.doing ? `<div class="ag-doing"><small>${t("A fazer agora")} · ${t("desde")} ${sinceOf(a.doing.since)}</small><b>${esc(a.doing.title)}</b></div>` : ""}
    <dl class="kv" style="margin:0"><dt>${t("A trabalhar em")}</dt><dd>${esc(a.task || (a.doing ? a.doing.title : "") || "—")}</dd>
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

async function loadAnalytics() {
  await mount($("analytics"), async () => {
    const a = await api(`/api/analytics?days=${analyticsDays}`);
    const hours = a.ai.ai_seconds ? (a.ai.ai_seconds / 3600).toFixed(1) + " h" : null;
    return `${ui.sec("Equipa", ui.src(a.team.source))}<div class="stats">
        ${statCard("Pessoas online", `${a.team.active_users}/${a.team.people}`)}${statCard("Sessões de IA ativas", a.team.active_sessions)}
        ${statCard("Tarefas criadas", a.team.tasks_created)}${statCard("Tarefas concluídas", a.team.tasks_completed)}
        ${statCard("Tarefas abertas", a.team.tasks_open)}${statCard("Pedidos de aprovação", a.team.approvals)}</div>
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
      ${ui.sec("Código", ui.src(a.code.source))}<div class="stats">
        ${statCard("Commits", a.code.source === "live" ? a.code.commits : null)}
</div>
      ${a.value.cost_per_task.usd != null || a.value.cost_per_commit.usd != null ? `${ui.sec("Valor")}<div class="stats">
        ${statCard("Custo por tarefa concluída", a.value.cost_per_task.usd == null ? null : fmt.usd(a.value.cost_per_task.usd), a.value.cost_per_task.source)}
        ${statCard("Custo por commit", a.value.cost_per_commit.usd == null ? null : fmt.usd(a.value.cost_per_commit.usd), a.value.cost_per_commit.source)}</div>
      <p class="faint" style="margin-top:14px">${t("O custo é a estimativa que o SDK do Claude dá em cada sessão; não é uma fatura.")}</p>` : ""}`;
  }, 8);
}
HUB_VIEWS.analise = async function () {
  page(`${ui.head("Análise", t("Análise"), t("Quem fez o quê, a equipa e o código."),
    `<div class="segx" id="days">${[7, 30, 90].map((d) => `<button data-d="${d}" class="${d === analyticsDays ? "on" : ""}">${d} ${t("dias")}</button>`).join("")}</div>`)}
    <div id="ranking"></div><div id="analytics"></div>`);
  loadRanking();
  $("days").onclick = (e) => {
    if (!e.target.dataset.d) return;
    analyticsDays = Number(e.target.dataset.d);
    $("days").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === e.target));
    $("analytics")._html = null; loadAnalytics();
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
  if (!$("memory")?.querySelector(".err")) renderMemory();   // a failed load keeps its error and Tentar outra vez
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
  page(`${ui.head("Sistema", t("Memória"), t("O que a IA deve saber antes de começar. As mais recentes em cima; clica numa nota para a abrir."), ui.btn("Adicionar à memória", "data-new-memory", "primary", "plus"))}
    <div class="mem-bar"><div class="mem-seg" id="memory-view"><button class="chp" data-view="recent">${t("Mais recentes")}</button><button class="chp" data-view="topic">${t("Por tema")}</button></div>
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
