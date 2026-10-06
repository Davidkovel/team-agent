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
const importance = (x) => (x.priority === "urgent" ? 0 : x.priority === "high" ? 1 : 2);
const isFresh = (x) => x.stage !== "done" && Date.now() - new Date(x.created_at) < 15 * 60000;

function taskCard(x) {
  const late = x.deadline && x.stage !== "done" && new Date(x.deadline) < new Date();
  const mineOf = x.group && x.group.find((y) => y.assignee === me.username);
  const stack = x.group ? `<span class="av-stack">${x.group.map((y) => ui.avatar(nameOf(y.assignee), "sm")).join("")}</span>` : ui.avatar(nameOf(x.assignee), "sm");
  const top = [x.priority === "urgent" ? ui.tag(t("Urgente"), "bad") : x.priority === "high" ? ui.tag(t("Alta"), "warn") : "", x.group ? ui.tag(t("Para todos"), "ai") : "", isFresh(x) ? ui.tag(t("Nova"), "ok") : ""].join("");
  return `<article class="tk ${x.priority === "urgent" ? "urgent" : x.priority === "high" ? "high" : ""} ${isFresh(x) ? "fresh" : ""}" draggable="${x.group ? "false" : "true"}" data-id="${(mineOf || x).id}">
    ${top ? `<div class="tk-top">${top}</div>` : ""}
    <b>${esc(x.title)}</b>
    ${x.stage === "in_progress" || (x.progress > 0 && x.stage !== "done") ? ui.progress(x.progress, "ai") : ""}
    <div class="tk-foot">${stack}<span class="grow ell">${esc(x.project_name || x.project || "")}</span>
      ${x.agent_role ? ui.tag("IA", "ai") : ""}${x.priority === "low" ? ui.tag(t(PRIORITY[x.priority]), x.priority) : ""}
      ${x.deadline ? ui.tag(fmt.date(x.deadline), late ? "bad" : "") : ""}</div></article>`;
}

// What is finished takes little room: one short line each, only today's, and the older ones behind a button.
let showOlderDone = false;
const doneAt = (x) => new Date(x.completed_at || x.updated_at || x.created_at);
const doneCard = (x) => `<article class="tk tk-done" draggable="${x.group ? "false" : "true"}" data-id="${((x.group && x.group.find((y) => y.assignee === me.username)) || x).id}">
  <span class="tk-tick">${icon("check")}</span><b>${esc(x.title)}</b>${x.group ? `<i>${t("Todos")}</i>` : ui.avatar(nameOf(x.assignee), "sm")}</article>`;
function doneColumn(list, label) {
  const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
  const sorted = [...list].sort((a, b) => doneAt(b) - doneAt(a));
  const today = sorted.filter((x) => doneAt(x) >= midnight), older = sorted.filter((x) => doneAt(x) < midnight);
  return `<section class="col col-done" data-stage="done"><div class="col-head"><span>${t(label)}</span><i>${list.length}</i></div>
    ${today.length ? today.map(doneCard).join("") : `<p class="faint" style="margin:6px 2px;font-size:12px">${t("Nada concluído hoje")}</p>`}
    ${older.length ? `<button class="done-older" data-older-done>${t(showOlderDone ? "Esconder as anteriores" : "Ver as anteriores ({n})", { n: older.length })}</button>
      ${showOlderDone ? older.slice(0, 20).map(doneCard).join("") : ""}` : ""}</section>`;
}

async function loadBoard() {
  const board = $("board");
  if (!board) return;
  await mount(board, async () => {
    const all = (await api("/api/tasks")).filter((x) => !x.trashed_at); // what went into the bin as finished stays in the numbers, not on the board
    const people = [...new Set(all.map((x) => x.assignee))];
    paint($("task-filter"), [["", t("Todas")], ...people.map((u) => [u, nameOf(u)])]
      .map(([u, label]) => `<button class="chp ${u === taskFilter ? "on" : ""}" data-u="${esc(u)}">${esc(label)}</button>`).join(""));
    const tasks = taskFilter ? all.filter((x) => x.assignee === taskFilter) : all;
    if (!all.length) return `<div style="grid-column:1/-1">${ui.empty("tasks", "Sem tarefas", "Cria a primeira tarefa: fica contigo ou vai direta para um agente.",
      `<button class="btn sm primary" data-new-task>${t("Nova tarefa")}</button>`)}</div>`;
    return STAGES.map(([stage, label]) => {
      const mine = groupAll(tasks.filter((x) => x.stage === stage)).sort((a, b) => importance(a) - importance(b)); // urgent first, then as before
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

// "Para quem?": one button for each person and one for everybody ("all": a task for each of them). Someone who cannot direct
// work only sends to themselves, so there is nothing to choose.
function whoPicker(users, selected) {
  if (!me.lead) return `<input type="hidden" name="assignee" value="${esc(me.username)}">`;
  return `<div class="field wide"><span>${t("Para quem?")}</span><div class="who">${[...users.map((u) => [u.username, u.display_name]), ["all", t("Todos")]]
    .map(([value, label]) => `<label class="who-opt"><input type="radio" name="assignee" value="${esc(value)}" ${value === selected ? "checked" : ""}><span>${esc(label)}</span></label>`).join("")}</div></div>`;
}

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
    const created = await api("/api/tasks", { method: "POST", body: { ...taskBody(v), for_ai: !!v.for_ai, agent_role: v.for_ai || "" } });
    flash(t(v.assignee === "all" ? "Tarefa enviada a todos." : "Tarefa criada."));
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
  let x;
  try { x = await request_(`/api/tasks/${id}`); } catch (e) { flash(e.message); return; }
  const held = heldByAgent(x), running = ["IN_PROGRESS", "WAITING_APPROVAL"].includes(x.status);
  const kv = [["Responsável", esc(nameOf(x.assignee))], ["Projeto", esc(x.project_name || x.project || "—")],
    ["Empresa", esc(companies.find((c) => c.id === x.company)?.name || "—")], ["Prioridade", t(PRIORITY[x.priority])],
    ["Prazo", x.deadline ? `${fmt.date(x.deadline)} ${fmt.hhmm(x.deadline)}` : "—"], ["Agente", x.agent_role ? esc(t(ROLES[x.agent_role])) : "—"],
    ["Branch", x.git_branch ? `<span class="mono">${esc(x.git_branch)}</span>` : "—"],
    ["Custo de IA", x.ai_cost_usd == null ? `<span class="faint">${t("Sem dados")}</span>` : `${fmt.usd(x.ai_cost_usd)} ${ui.src("estimated")}`]];
  openModal(`<div class="rowx" style="margin-bottom:12px"><h3 style="margin:0" class="grow">${esc(x.title)}</h3>
      ${ui.tag(t(STAGE_LABEL[x.stage]), STAGE_TONE[x.stage])}<button class="btn quiet sm" data-close>${icon("x")}</button></div>
    ${x.progress > 0 && x.stage !== "done" ? `<div class="rowx" style="margin-bottom:12px"><div class="grow">${ui.progress(x.progress, "ai")}</div><span class="mono">${x.progress}%</span></div>` : ""}
    ${x.current_action && running ? `<div class="now" style="margin-bottom:12px">${esc(x.current_action)}</div>` : ""}
    ${x.blocked_reason ? `<p class="msg note" style="margin:0 0 12px">${esc(x.blocked_reason)}</p>` : ""}
    <div class="detail"><div class="stack">
      ${x.description ? `<p style="margin:0;white-space:pre-wrap">${esc(x.description)}</p>` : ""}
      ${x.goal ? `<p style="margin:0" class="dim"><b>${t("Objetivo")}:</b> ${esc(x.goal)}</p>` : ""}
      ${x.requirements?.length ? `<ul style="margin:0;padding-left:18px" class="dim">${x.requirements.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : ""}
      ${x.result ? `<div class="panel pad"><div class="ph-eyebrow">${t("Resultado")}</div><p style="margin:0;white-space:pre-wrap">${esc(x.result)}</p></div>` : ""}
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
  page(`${ui.head("Centro de comando", t("Tarefas"), t("O trabalho das pessoas e dos agentes, por estado. Arrasta um cartão para lhe mudar o estado."),
    ui.btn("Nova tarefa", "data-new-task", "primary", "plus"))}
    <div class="chipbar" id="task-filter"></div><div class="board" id="board"></div><div class="bin" id="bin"></div>`);
  const view = $("view");
  view.onclick = (e) => {
    if (e.target.closest("[data-new-task]")) return newTask();
    if (e.target.closest("[data-bin-open]")) return openBin();
    const chip = e.target.closest("#task-filter [data-u]");
    if (chip) { taskFilter = chip.dataset.u; $("board")._html = null; return loadBoard(); }
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
        ${statCard("Commits", a.code.source === "live" ? a.code.commits : null)}${statCard("Linhas adicionadas", a.code.source === "live" ? fmt.int(a.code.added) : null)}
        ${statCard("Linhas removidas", a.code.source === "live" ? fmt.int(a.code.deleted) : null)}
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
let memoryScope = "team";
async function memoryTargets(scope) {
  if (scope === "company") return companies.map((c) => [c.id, c.name]);
  if (scope === "project") return (await api("/api/projects")).map((p) => [String(p.id), p.name]);
  if (scope === "agent") return (await api("/api/users")).map((u) => [u.username, `Claude / ${u.display_name}`]);
  if (scope === "task") return (await api("/api/tasks")).slice(0, 60).map((x) => [String(x.id), `#${x.id} ${x.title}`]);
  return [];
}
async function loadMemory() {
  paint($("memory-scopes"), MEMORY_SCOPES.map(([id, label]) => `<button class="chp ${id === memoryScope ? "on" : ""}" data-s="${id}">${t(label)}</button>`).join(""));
  await mount($("memory"), async () => {
    const [items, targets] = await Promise.all([api(`/api/memory?scope=${memoryScope}`), memoryTargets(memoryScope)]);
    if (!items.length) return `<div class="panel" style="grid-column:1/-1">${ui.empty("layers", "Memória vazia", "O que escreveres aqui é dado ao agente antes de ele começar uma tarefa deste âmbito.",
      `<button class="btn sm primary" data-new-memory>${t("Adicionar à memória")}</button>`)}</div>`;
    const groups = {};
    for (const m of items) ((groups[m.scope_id] ||= {})[m.category || t("Geral")] ||= []).push(m);
    return Object.entries(groups).map(([target, cats]) => `${target ? `<div class="sec" style="grid-column:1/-1;margin:6px 0 0">${esc(targets.find(([id]) => id === target)?.[1] || target)}</div>` : ""}
      ${Object.entries(cats).map(([cat, list]) => `<div class="panel"><h4>${esc(cat)}</h4>${list.map((m) => `<div class="mem-item" data-memory="${m.id}"><b>${esc(m.title)}</b>
        ${m.content ? `<p>${esc(m.content)}</p>` : ""}</div>`).join("")}</div>`).join("")}`).join("");
  }, 5);
}
async function editMemory(existing) {
  const targets = await memoryTargets(memoryScope);
  if (!existing && ["company", "project", "agent", "task"].includes(memoryScope) && !targets.length) return flash(t("Ainda não há nada deste âmbito a que juntar memória."));
  formModal(existing ? "Editar memória" : "Adicionar à memória",
    (existing || !targets.length ? "" : field("De quem", `<select name="scope_id">${options(targets, "")}</select>`, true))
    + field("Categoria", `<input name="category" value="${esc(existing?.category || "")}" placeholder="ex: NEGÓCIO, DESIGN, TECH, DECISÕES">`)
    + field("Título", `<input name="title" required value="${esc(existing?.title || "")}">`)
    + field("Conteúdo", `<textarea name="content">${esc(existing?.content || "")}</textarea>`, true),
  async (v) => {
    if (existing) await api(`/api/memory/${existing.id}`, { method: "PUT", body: { category: v.category.toUpperCase(), title: v.title, content: v.content } });
    else await api("/api/memory", { method: "POST", body: { scope: memoryScope, scope_id: v.scope_id || "", category: v.category.toUpperCase(), title: v.title, content: v.content } });
    $("memory")._html = null; loadMemory();
  }, existing ? { danger: { label: "Apagar", run: async () => { await api(`/api/memory/${existing.id}`, { method: "DELETE" }); $("memory")._html = null; loadMemory(); } } } : {});
}
HUB_VIEWS.memoria = async function () {
  page(`${ui.head("Sistema", t("Memória"), t("O que a IA deve saber antes de começar: factos e decisões, por âmbito."), ui.btn("Adicionar à memória", "data-new-memory", "primary", "plus"))}
    <div class="chipbar" id="memory-scopes"></div><div class="mem" id="memory"></div>`);
  $("view").onclick = async (e) => {
    const scope = e.target.closest("#memory-scopes [data-s]"), item = e.target.closest("[data-memory]");
    if (scope) { memoryScope = scope.dataset.s; $("memory")._html = null; return loadMemory(); }
    if (e.target.closest("[data-new-memory]")) return editMemory();
    if (item) editMemory((await api(`/api/memory?scope=${memoryScope}`)).find((m) => m.id === Number(item.dataset.memory)));
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

HUB_VIEWS.empresas = async function (r) {
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
