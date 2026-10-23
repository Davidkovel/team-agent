// Tarefas: the command centre of the work (Marco, 23 out 2026: «quero mandar uma tarefa logo, sempre com personalizações…
// um dashboard do trabalho… tudo tunado, estilo iOS»). Loaded the first time Tarefas, Aprovações, Semana or «Nova tarefa»
// is opened (tqLoad in pages.js). Everything here is prefixed tq/TQ: this file shares the page's global scope.
//
// What is in it:
//   - the composer, always on top of Tarefas: write, Enter sends; under it the choices (for whom, which department of the
//     office, for when, priority, company or project, ask for approval), each remembered for next time, and the templates;
//   - the dashboard: the real numbers and the views (Hoje, Próximas, Por pessoa, Por departamento, Quadro, Feitas);
//   - newTask(): the same composer as a sheet, opened from anywhere in the Hub (Ctrl+K, Início, projects, Escritório);
//   - the phone's Tarefas screen, and Aprovações and Semana in the same look.

/* ---------------------------------------------------------------- the office's departments (brief, 23 out) */
// The ids are the crew's keys in the database (crew.py); what is shown is the department, its code and what it does.
const TQ_DEPTS = [
  ["batman", "Desenvolvimento", "DEV", "Escreve e corrige código: erros, funcionalidades novas, scripts e automações."],
  ["lucius", "Engenharia", "ENG", "Mapeia o código, explica como as peças encaixam e constrói as ferramentas da equipa."],
  ["riddler", "Pesquisa", "PES", "Procura factos na web e em documentos, confirma duas vezes e dá as fontes."],
  ["catwoman", "Design", "DSG", "Desenha páginas e ecrãs no acabamento AMG e entrega HTML e CSS a funcionar."],
  ["joker", "Marketing", "MKT", "Textos, anúncios e campanhas; tudo fica em rascunho até tu aprovares."],
  ["alfred", "Revisão", "REV", "Revê cada mudança antes de ir para todos: erros, riscos e o que falta."],
  ["robin", "Testes", "QA", "Corre os testes, tenta os casos difíceis e diz exatamente o que falhou."],
  ["gordon", "Operações", "OPS", "Organiza, planeia, faz pequenas correções e fecha pontas soltas."],
  ["penguin", "Macro", "MAC", "Sala de Trading: calendário económico, bancos centrais, dólar, juros e manchetes."],
  ["twoface", "Análise técnica", "TEC", "Sala de Trading: liquidez, FVG, order blocks, estrutura; dá sempre os dois lados."],
].map(([id, name, code, what], i) => ({ id, name, code, what, n: String(i + 1).padStart(2, "0") }));
const TQ_OFFICE = TQ_DEPTS.slice(0, 8);   // the ones a task is sent to; the last two work in the Sala de Trading
const tqDept = (id) => TQ_DEPTS.find((d) => d.id === id) || null;
const tqMono = (id, live = false, cls = "") => {
  const d = tqDept(id);
  return d ? `<span class="tq-mono ${live ? "live" : ""} ${cls}" title="${esc(d.name)}">${d.code}</span>` : "";
};
// tasks the automatic agent holds (crew.py WITH_AGENT): in its queue, running, paused, waiting for a person
const TQ_WITH_AGENT = ["ASSIGNED", "IN_PROGRESS", "WAITING_APPROVAL", "PAUSED", "NEEDS_HELP"];
const tqRunning = (x) => ["IN_PROGRESS", "WAITING_APPROVAL", "PAUSED", "NEEDS_HELP"].includes(x.status);
const tqWithAgent = (x) => TQ_WITH_AGENT.includes(x.status);
const TQ_AGENT_ON = ["WORKING", "IDLE", "WAITING", "PAUSED", "ERROR"];

/* ---------------------------------------------------------------- remembered choices (this browser only) */
const tqRead = (key, fallback) => { try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; } };
const tqWrite = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private window: it just is not remembered */ } };
// who: "ai" (the office) or a login, or "all"; pc: whose automatic agent runs it ("" = mine); dept: "" = the Hub chooses;
// due: today | tomorrow | friday | week | none | at:<local date-time>; place: "" | co:<company> | pr:<project id>
const TQ_START = { who: "ai", pc: "", dept: "", due: "today", prio: "normal", place: "", approve: false };
function tqLastChoice() {
  const last = { ...TQ_START, ...tqRead("hub.tq.last", {}) };
  if (String(last.due).startsWith("at:") && new Date(last.due.slice(3)) < new Date()) last.due = "today";   // a date that already went by
  return last;
}

/* The templates: one press fills the department, the priority and the start of the text. The first ones come made; any
   task can be kept as one («Guardar como modelo»). They live in this browser. */
const TQ_MODELS = [
  { id: "erro", name: "Corrigir erro no Hub", who: "ai", dept: "batman", prio: "high", title: "Corrigir no Hub: ",
    desc: "O que acontece:\nOnde (página ou ecrã):\nO que devia acontecer:" },
  { id: "concorrencia", name: "Pesquisa de concorrência", who: "ai", dept: "riddler", title: "Pesquisa de concorrência: ",
    desc: "Quem são, quanto cobram, o que fazem melhor do que nós e o que podemos aproveitar. Com as fontes." },
  { id: "instagram", name: "Post para Instagram", who: "ai", dept: "joker", approve: true, title: "Post para Instagram: ",
    desc: "O texto do post, as hashtags e a ideia para a imagem. Fica em rascunho até eu aprovar." },
  { id: "pagina", name: "Desenhar uma página", who: "ai", dept: "catwoman", title: "Desenhar: ",
    desc: "Para quem é, o que tem de mostrar e um exemplo de que gosto." },
  { id: "rever", name: "Rever antes de publicar", who: "ai", dept: "alfred", title: "Rever: ",
    desc: "O que mudou e onde. Diz o que está mal, os riscos e o que falta." },
  { id: "testar", name: "Testar uma funcionalidade", who: "ai", dept: "robin", title: "Testar: ",
    desc: "O que testar e como se usa. Diz exatamente o que falhou." },
];
const tqModels = () => tqRead("hub.tq.models", null) || TQ_MODELS;
const APPROVE_LINE = "Antes de aplicar, publicar ou enviar o resultado, pede aprovação e espera pela resposta.";

/* ---------------------------------------------------------------- dates */
const tqDayDiff = (iso) => {   // > 0: that many days ago; 0: today; < 0: in that many days
  const d = new Date(iso), n = new Date();
  return Math.round((new Date(n.getFullYear(), n.getMonth(), n.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5);
};
const tqLocal = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const TQ_WEEKDAY = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const tqToFriday = () => (5 - new Date().getDay() + 7) % 7;
function tqDueDate(due) {
  const at = (days, hour = 18) => { const x = new Date(); x.setDate(x.getDate() + days); x.setHours(hour, 0, 0, 0); return x; };
  if (due === "today") { const x = at(0); if (Date.now() > x - 3600e3) x.setHours(23, 30, 0, 0); return x; }   // late in the day: by tonight
  if (due === "tomorrow") return at(1);
  if (due === "friday") return at(tqToFriday() || 7);
  if (due === "week") return at(7);
  if (String(due).startsWith("at:")) return new Date(due.slice(3));
  return null;
}
function tqDueLabel(due) {
  if (due === "today") return t("Hoje");
  if (due === "tomorrow") return t("Amanhã");
  if (due === "friday") return t("Sexta-feira");
  if (due === "week") return t("Daqui a 1 semana");
  if (due === "none") return t("Sem prazo");
  const d = tqDueDate(due);
  return d ? `${fmt.date(d.toISOString())}, ${fmt.hhmm(d.toISOString())}` : t("Sem prazo");
}
const tqLate = (x) => !!x.deadline && x.stage !== "done" && new Date(x.deadline) < new Date();
const tqToday = (x) => !!x.deadline && x.stage !== "done" && !tqLate(x) && tqDayDiff(x.deadline) === 0;
// the deadline as a row says it: late in red, today in amber, the rest plainly
function tqDueText(x) {
  if (!x.deadline || x.stage === "done") return "";
  const n = tqDayDiff(x.deadline), when = fmt.hhmm(x.deadline);
  if (tqLate(x)) return `<span class="tq-due late">${n <= 0 ? `${t("Hoje")} ${when}` : n === 1 ? t("Ontem") : t("Há {n} dias", { n })}</span>`;
  if (n === 0) return `<span class="tq-due today">${t("Hoje")} ${when}</span>`;
  if (n === -1) return `<span class="tq-due">${t("Amanhã")}</span>`;
  if (n >= -6) return `<span class="tq-due">${t(TQ_WEEKDAY[new Date(x.deadline).getDay()])}</span>`;
  return `<span class="tq-due">${fmt.date(x.deadline)}</span>`;
}
const tqRank = (x) => (x.priority === "urgent" ? 0 : x.priority === "high" ? 1 : x.priority === "low" ? 3 : 2);
const tqOrder = (a, b) => tqRank(a) - tqRank(b) || String(a.deadline || "9").localeCompare(String(b.deadline || "9")) || b.id - a.id;
const tqDoneAt = (x) => new Date(x.completed_at || x.updated_at || x.created_at);
const tqMonday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d; };

/* ---------------------------------------------------------------- the menu: a popover on the computer, a sheet on the phone */
// groups: [{ label, items: [[value, label, sub, lead]] }]; an item with value "date" is a date-time field.
// Resolves with the value chosen, or null.
let tqMenuOpen = null;
function tqMenu(anchor, title, groups, current) {
  tqMenuClose();
  const isPhone = document.documentElement.classList.contains("is-phone");
  const el = document.createElement("div");
  el.className = `tq-menu ${isPhone ? "sheet" : ""}`;
  el.setAttribute("role", "menu");
  const row = ([value, label, sub = "", lead = ""]) => value === "date"
    ? `<label class="tq-mi date"><span class="tq-mi-lead">${icon("calendar")}</span><span class="tq-mi-t"><b>${esc(label)}</b>
        <input type="datetime-local" value="${esc(String(current).startsWith("at:") ? current.slice(3) : tqLocal(tqDueDate("tomorrow")))}"></span>
        <button type="button" class="tq-mi-use" data-date>${t("Usar")}</button></label>`
    : `<button type="button" class="tq-mi ${String(value) === String(current) ? "on" : ""}" data-v="${esc(value)}" role="menuitemradio" aria-checked="${String(value) === String(current)}">
        ${lead ? `<span class="tq-mi-lead">${lead}</span>` : ""}<span class="tq-mi-t"><b>${esc(label)}</b>${sub ? `<small>${esc(sub)}</small>` : ""}</span>
        <span class="tq-mi-tick">${icon("tick")}</span></button>`;
  el.innerHTML = `${isPhone ? `<div class="tq-menu-bg"></div>` : ""}<div class="tq-menu-box">${isPhone ? `<i class="tq-grab"></i>` : ""}
    ${title ? `<p class="tq-menu-t">${esc(title)}</p>` : ""}
    ${groups.filter((g) => g.items.length).map((g) => `<div class="tq-mg">${g.label ? `<small>${esc(g.label)}</small>` : ""}<div class="tq-mg-list">${g.items.map(row).join("")}</div></div>`).join("")}
    ${isPhone ? `<button type="button" class="tq-menu-x" data-v="__cancel">${t("Cancelar")}</button>` : ""}</div>`;
  document.body.append(el);
  if (!isPhone) {   // under the chip, kept inside the window
    const r = anchor.getBoundingClientRect(), box = el.firstElementChild, w = box.offsetWidth, h = box.offsetHeight;
    const left = Math.max(8, Math.min(r.left, innerWidth - w - 8));
    const top = r.bottom + 6 + h > innerHeight - 8 ? Math.max(8, r.top - 6 - h) : r.bottom + 6;
    Object.assign(box.style, { left: `${left}px`, top: `${top}px` });
  }
  requestAnimationFrame(() => el.classList.add("in"));
  return new Promise((done) => {
    const finish = (value) => {
      if (tqMenuOpen !== api_) return;
      tqMenuOpen = null;
      el.classList.remove("in");
      setTimeout(() => el.remove(), isPhone ? 240 : 120);
      document.removeEventListener("pointerdown", outside, true);
      done(value);
    };
    const outside = (e) => { if (!el.querySelector(".tq-menu-box").contains(e.target) && !anchor.contains(e.target)) finish(null); };
    const api_ = { finish };
    tqMenuOpen = api_;
    setTimeout(() => document.addEventListener("pointerdown", outside, true), 0);
    el.onclick = (e) => {
      if (e.target.closest(".tq-menu-bg")) return finish(null);
      if (e.target.closest("[data-date]")) {
        const v = el.querySelector('input[type="datetime-local"]').value;
        return v ? finish(`at:${v}`) : null;
      }
      const b = e.target.closest("[data-v]");
      if (b) finish(b.dataset.v === "__cancel" ? null : b.dataset.v);
    };
    el.onkeydown = (e) => { if (e.key === "Enter" && e.target.matches('input[type="datetime-local"]')) { e.preventDefault(); el.querySelector("[data-date]").click(); } };
    (el.querySelector(".tq-mi.on") || el.querySelector(".tq-mi"))?.focus({ preventScroll: true });
  });
}
function tqMenuClose() { if (tqMenuOpen) tqMenuOpen.finish(null); }
// Escape closes the menu before it closes the window under it
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && tqMenuOpen) { e.stopImmediatePropagation(); tqMenuClose(); } }, true);

/* ---------------------------------------------------------------- the composer (top of Tarefas, the sheet, the phone) */
let tqPeople = [], tqProjects = [];
async function tqLoadRefs() {
  [tqPeople, tqProjects] = await Promise.all([api("/api/users").catch(() => tqPeople), api("/api/projects").catch(() => tqProjects)]);
}
const tqFirst = (login) => (isMe(login) ? t("Eu") : nameOf(login));
// The words on each choice. `s` is the composer's state.
const TQ_OPTS = {
  who: (s) => (s.who === "ai" ? [t("Quem faz"), s.pc && !isMe(s.pc) ? t("IA · PC de {n}", { n: nameOf(s.pc) }) : t("Agente automático")]
    : s.who === "all" ? [t("Para"), t("Todos")] : [t("Para"), tqFirst(s.who)]),
  dept: (s) => [t("Departamento"), s.dept ? `${tqDept(s.dept)?.name || s.dept}` : t("Automático")],
  due: (s) => [t("Prazo"), tqDueLabel(s.due)],
  prio: (s) => [t("Prioridade"), t(PRIORITY[s.prio] || "Normal")],
  place: (s) => {
    if (s.place.startsWith("co:")) return [t("Empresa"), companies.find((c) => `co:${c.id}` === s.place)?.name || t("Empresa")];
    if (s.place.startsWith("pr:")) return [t("Projeto"), tqProjects.find((p) => `pr:${p.id}` === s.place)?.name || t("Projeto")];
    return [t("Empresa"), t("Nenhuma")];
  },
  approve: (s) => [t("Aprovação"), s.approve ? t("Pede antes de aplicar") : t("Não precisa")],
};
const TQ_OPT_ICON = { who: "users", dept: "bot", due: "calendar", prio: "flag", place: "building", approve: "check" };
const tqShows = (s, key) => (key === "dept" || key === "approve" ? s.who === "ai" : true);
function tqOptsHtml(s, style = "chips") {
  return Object.keys(TQ_OPTS).filter((k) => tqShows(s, k)).map((k) => {
    const [label, value] = TQ_OPTS[k](s);
    const on = (k === "prio" && s.prio !== "normal") || (k === "approve" && s.approve) || (k === "place" && s.place) || (k === "dept" && s.dept);
    const tone = k === "prio" ? (s.prio === "urgent" ? "bad" : s.prio === "high" ? "warn" : "") : k === "due" && s.due === "today" ? "" : "";
    if (style === "rows") return `<button type="button" class="tq-orow" data-opt="${k}"><span class="tq-oic">${icon(TQ_OPT_ICON[k])}</span><span class="tq-ol">${esc(label)}</span>
      <span class="tq-ov ${tone}">${k === "dept" && s.dept ? tqMono(s.dept, false, "sm") : ""}${esc(value)}</span>${icon("chevron")}</button>`;
    return `<button type="button" class="tq-opt ${on ? "set" : ""} ${tone}" data-opt="${k}"><small>${esc(label)}</small><b>${k === "dept" && s.dept ? tqMono(s.dept, false, "xs") : ""}${esc(value)}</b><span class="tq-car"></span></button>`;
  }).join("");
}
// The choices of each menu, from what the Hub really has.
function tqMenuOf(key, s) {
  const lead = me.lead;
  if (key === "who") {
    const others = tqPeople.filter((u) => !isMe(u.username));
    return [t("Quem faz"), [
      { label: t("A IA faz sozinha, já"), items: [["ai:", t("Agente automático"), t("No teu PC, com o Claude"), icon("bot")],
        ...(lead ? others.map((u) => [`ai:${u.username}`, t("IA no PC de {n}", { n: u.display_name }), t("Corre no agente automático dele"), icon("bot")]) : [])] },
      { label: t("Uma pessoa faz"), items: [[me.username, t("Eu"), t("Fica em «Por fazer» para ti"), ui.avatar(me.display_name, "sm")],
        ...(lead ? others.map((u) => [u.username, u.display_name, t("Recebe um aviso no Hub e no telemóvel"), ui.avatar(u.display_name, "sm")]) : []),
        ...(lead && others.length ? [["all", t("Todos"), t("Cada um recebe a sua"), icon("users")]] : [])] }],
      s.who === "ai" ? `ai:${s.pc}` : s.who];
  }
  if (key === "dept") return [t("Que departamento faz"), [
    { label: "", items: [["", t("Automático"), t("O Hub escolhe pelas palavras da tarefa"), `<span class="tq-mono auto">${icon("bolt")}</span>`]] },
    { label: t("Departamentos"), items: TQ_OFFICE.map((d) => [d.id, d.name, d.what, tqMono(d.id)]) }], s.dept];
  if (key === "due") {
    const fri = tqToFriday();
    return [t("Para quando"), [{ label: "", items: [["today", t("Hoje"), fmt.hhmm(tqDueDate("today").toISOString())],
      ["tomorrow", t("Amanhã"), "18:00"], ...(fri > 1 ? [["friday", t("Sexta-feira"), "18:00"]] : []), ["week", t("Daqui a 1 semana"), fmt.date(tqDueDate("week").toISOString())],
      ["none", t("Sem prazo"), t("Fica em «Sem prazo» até alguém lhe dar uma data")]] }, { label: t("Outra data"), items: [["date", t("Escolher dia e hora")]] }], s.due];
  }
  if (key === "prio") return [t("Prioridade"), [{ label: "", items: [["urgent", t("Urgente"), t("Passa à frente de tudo")], ["high", t("Alta")], ["normal", t("Normal")], ["low", t("Baixa"), t("Quando houver tempo")]] }], s.prio];
  if (key === "place") return [t("Empresa ou projeto"), [{ label: "", items: [["", t("Nenhuma")]] },
    { label: t("Empresas"), items: companies.map((c) => [`co:${c.id}`, c.name, c.tagline || ""]) },
    { label: t("Projetos"), items: tqProjects.map((p) => [`pr:${p.id}`, p.name, companies.find((c) => c.id === p.company)?.name || ""]) }], s.place];
  if (key === "approve") return [t("Aprovação"), [{ label: "", items: [["0", t("Não precisa"), t("O agente faz e entrega")],
    ["1", t("Pede antes de aplicar"), t("Antes de publicar, enviar ou aplicar, o agente pede-te e espera")]] }], s.approve ? "1" : "0"];
  return ["", [], ""];
}
function tqSetOpt(s, key, value) {
  if (key === "who") { if (value.startsWith("ai:")) { s.who = "ai"; s.pc = value.slice(3); } else { s.who = value; } }
  else if (key === "approve") s.approve = value === "1";
  else s[key] = value;
}

/* The composer's behaviour, the same in its three homes. `root` holds [data-f=title], [data-f=desc], [data-opts],
   [data-models], [data-route] and a form. `keep` says which choices are remembered when sent (a preset from a project
   page is not the person's own choice). */
function tqComposer(root, { state, style = "chips", keep = true, onSent = null, preset = {} }) {
  const s = state, title = root.querySelector('[data-f="title"]'), desc = root.querySelector('[data-f="desc"]');
  const opts = root.querySelector("[data-opts]"), line = root.querySelector("[data-route]"), models = root.querySelector("[data-models]");
  const form = root.querySelector("form") || root;
  let timer = 0, turn = 0, team = null;
  const drawOpts = () => { if (opts) opts.innerHTML = tqOptsHtml(s, style); };
  const drawModels = () => {
    if (!models) return;
    models.innerHTML = `${tqModels().map((m) => `<span class="tq-model"><button type="button" data-model="${esc(m.id)}" title="${esc(tqDept(m.dept)?.name || "")}">${m.dept ? tqMono(m.dept, false, "xs") : ""}${esc(m.name)}</button>
      <button type="button" class="tq-model-x" data-model-x="${esc(m.id)}" aria-label="${esc(t("Tirar o modelo {n}", { n: m.name }))}">${icon("x")}</button></span>`).join("")}
      <button type="button" class="tq-model-add" data-model-save title="${esc(t("Guarda o texto e as escolhas para usar outra vez"))}">${icon("plus")}${t("Guardar como modelo")}</button>`;
  };
  // the line that says where it goes, asked of the Hub while the task is written (the same answer it gets when sent)
  const say = async () => {
    if (!line) return;
    const my = ++turn, text = title.value.trim();
    if (s.who !== "ai") {
      const d = tqDueDate(s.due);
      line.className = "tq-route person";
      line.innerHTML = `${s.who === "all" ? icon("users") : ui.avatar(nameOf(s.who), "sm")}<span>${s.who === "all" ? t("Cada pessoa da equipa recebe a sua.") : isMe(s.who)
        ? t("Fica contigo em «Por fazer».") : t("Vai para {n}, que recebe um aviso.", { n: nameOf(s.who) })}${d ? ` <em>${esc(t("Prazo"))}: ${esc(tqDueLabel(s.due))}</em>` : ""}</span>`;
      return;
    }
    if (!text && !s.dept) {
      line.className = "tq-route idle";
      line.innerHTML = `${icon("bolt")}<span>${t("Escreve a tarefa e o Hub diz logo quem a faz.")}</span>`;
      return;
    }
    try {
      const pc = s.pc || me.username;
      const [r, people] = await Promise.all([api("/api/tasks/route", { method: "POST", body: { title: text, description: desc?.value || "", crew: s.dept, assignee: pc } }),
        team || api("/api/team").catch(() => [])]);
      team = people;
      if (my !== turn || !line.isConnected) return;
      const d = tqDept(r.crew), on = TQ_AGENT_ON.includes((people.find((m) => m.user === pc) || {}).status);
      line.className = "tq-route";
      line.innerHTML = `${tqMono(r.crew)}<span>${t("Vai para")} <b>${esc(d?.name || r.name)}</b>${s.dept ? "" : ` <em>${t("escolhido pelo Hub")}</em>`} · ${esc(r.ahead
        ? t(r.ahead === 1 ? "1 tarefa à frente" : "{n} tarefas à frente", { n: r.ahead }) : t("nada à frente"))}${on ? "" : ` · <em class="warn">${esc((isMe(pc) ? t("o teu agente automático está desligado: começa quando o ligares") : t("o agente automático de {p} está desligado: começa quando ligar", { p: nameOf(pc) })))}</em>`}</span>`;
    } catch { if (my === turn) { line.className = "tq-route idle"; line.innerHTML = `${icon("bolt")}<span>${t("O Hub escolhe o departamento pelas palavras da tarefa.")}</span>`; } }
  };
  const watch = (now = false) => { clearTimeout(timer); timer = setTimeout(say, now ? 0 : 260); };
  const sync = () => { drawOpts(); root.dataset.who = s.who === "ai" ? "ai" : "person"; watch(true); syncSend(); };
  const syncSend = () => {
    const go = root.querySelector("[data-send]");
    if (go) go.disabled = !title.value.trim();
  };
  title.addEventListener("input", () => { watch(); syncSend(); });
  desc?.addEventListener("input", () => { watch(); growDesc(); });
  const growDesc = () => { if (desc) { desc.style.height = "auto"; desc.style.height = `${Math.min(desc.scrollHeight + 2, Math.round(innerHeight * 0.4))}px`; } };
  root.addEventListener("click", async (e) => {
    const opt = e.target.closest("[data-opt]");
    if (opt) {
      const [label, groups, current] = tqMenuOf(opt.dataset.opt, s);
      opt.classList.add("open");
      const v = await tqMenu(opt, label, groups, current);
      opt.classList.remove("open");
      if (v === null) return;
      tqSetOpt(s, opt.dataset.opt, v);
      sync();
      if (style === "chips") title.focus({ preventScroll: true });
      return;
    }
    const x = e.target.closest("[data-model-x]");
    if (x) { tqWrite("hub.tq.models", tqModels().filter((m) => m.id !== x.dataset.modelX)); drawModels(); return; }
    if (e.target.closest("[data-model-save]")) {
      const text = title.value.trim();
      if (!text) { flash(t("Escreve primeiro a tarefa que queres guardar como modelo.")); title.focus(); return; }
      const m = { id: `m${Date.now()}`, name: text.replace(/[:\s]+$/, "").slice(0, 34), who: s.who === "ai" ? "ai" : s.who, dept: s.who === "ai" ? s.dept : "",
        prio: s.prio, approve: s.approve, place: s.place, title: text, desc: desc?.value || "" };
      tqWrite("hub.tq.models", [...tqModels(), m]);
      drawModels();
      flash(t("Modelo guardado: {n}.", { n: m.name }));
      return;
    }
    const model = e.target.closest("[data-model]");
    if (model) {
      const m = tqModels().find((y) => y.id === model.dataset.model);
      if (!m) return;
      if (m.who) { if (m.who === "ai") { s.who = "ai"; } else s.who = m.who; }
      s.dept = m.dept || ""; s.prio = m.prio || "normal"; s.approve = !!m.approve;
      if (m.place !== undefined) s.place = m.place || s.place;
      title.value = m.title || "";
      if (desc) { desc.value = m.desc || ""; root.classList.toggle("has-desc", !!m.desc); desc.hidden = false; growDesc(); }
      sync();
      title.focus();
      title.setSelectionRange(title.value.length, title.value.length);
      return;
    }
    if (e.target.closest("[data-desc-toggle]") && desc) {
      desc.hidden = false; root.classList.add("has-desc"); growDesc(); desc.focus();
    }
  });
  title.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.isComposing) return;
    e.preventDefault();
    if (e.shiftKey && desc) { desc.hidden = false; root.classList.add("has-desc"); desc.focus(); return; }
    send();
  });
  desc?.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } });
  form.addEventListener("submit", (e) => { e.preventDefault(); send(); });
  let sending = false;
  async function send() {
    const text = title.value.trim();
    if (!text) { title.focus(); title.classList.add("shake"); setTimeout(() => title.classList.remove("shake"), 400); return; }
    if (sending) return;
    sending = true;
    const go = root.querySelector("[data-send]");
    if (go) go.disabled = true;
    const ai = s.who === "ai", deadline = tqDueDate(s.due);
    const project = s.place.startsWith("pr:") ? tqProjects.find((p) => `pr:${p.id}` === s.place) : null;
    const body = {
      title: text, description: desc?.value.trim() || "", assignee: ai ? s.pc || me.username : s.who, priority: s.prio,
      deadline: deadline ? deadline.toISOString() : null, for_ai: ai, crew: ai ? s.dept : "",
      company: s.place.startsWith("co:") ? s.place.slice(3) : project?.company || null, project_id: project ? project.id : null,
      requirements: ai && s.approve ? [t(APPROVE_LINE)] : [], git_branch: root.querySelector('[data-f="branch"]')?.value.trim() || "",
    };
    try {
      const made = await api("/api/tasks", { method: "POST", body });
      if (keep) tqWrite("hub.tq.last", { who: s.who, pc: s.pc, dept: s.dept, due: s.due, prio: s.prio, place: s.place, approve: s.approve });
      else tqWrite("hub.tq.last", { ...tqLastChoice(), ...Object.fromEntries(Object.entries({ who: s.who, pc: s.pc, dept: s.dept, due: s.due, prio: s.prio, approve: s.approve })
        .filter(([k]) => !(k in (preset._fixed || {})))) });
      const d = tqDept(made.crew);
      flash(ai ? t("Mandada para {d}. O agente começa sozinho.", { d: d?.name || made.crew_name || t("o escritório") })
        : body.assignee === "all" ? t("Tarefa enviada a todos.") : isMe(body.assignee) ? t("Tarefa criada para ti.") : t("Tarefa enviada a {n}.", { n: nameOf(body.assignee) }));
      title.value = ""; if (desc) { desc.value = ""; desc.hidden = true; root.classList.remove("has-desc"); }
      const branch = root.querySelector('[data-f="branch"]'); if (branch) branch.value = "";
      tqFresh.add(made.id);
      watch(true);
      onSent?.(made);
      loadBoard();
    } catch (err) { flash(err.message); }
    finally { sending = false; syncSend(); }
  }
  drawModels();
  sync();
  return { send, sync, focus: () => title.focus() };
}
const tqFresh = new Set();   // tasks just sent from here: their row lights up once

/* ---------------------------------------------------------------- the sheet (newTask, from anywhere in the Hub) */
async function tqNewTask(preset = {}) {
  await tqLoadRefs();
  const s = tqLastChoice();
  // what the caller asks for wins over what was remembered (and is not remembered as the person's own choice)
  const fixed = {};
  if (preset.for_ai || preset.crew) { s.who = "ai"; fixed.who = 1; }
  if (typeof preset.for_ai === "string" && !preset.crew) {   // an old kind of agent (developer, research…): its department
    s.dept = { developer: "batman", research: "riddler", marketing: "joker", testing: "robin" }[preset.for_ai] || ""; fixed.dept = 1;
  }
  if (preset.crew) { s.dept = preset.crew; fixed.dept = 1; }
  if (preset.assignee) { s.who = preset.assignee; fixed.who = 1; }
  if (preset.priority) { s.prio = preset.priority; fixed.prio = 1; }
  if (preset.project_id) { s.place = `pr:${preset.project_id}`; fixed.place = 1; }
  else if (preset.company) { s.place = `co:${preset.company}`; fixed.place = 1; }
  if (!me.lead && s.who !== "ai") s.who = me.username;
  openModal(`<form class="tq-sheet" id="tq-sheet" autocomplete="off" data-who="${s.who === "ai" ? "ai" : "person"}">
    <header class="tq-sheet-head"><button type="button" class="tq-sheet-cancel" data-close>${t("Cancelar")}</button><b>${t("Nova tarefa")}</b>
      <button class="tq-sheet-go" data-send disabled>${t("Mandar")}</button></header>
    <div class="tq-sheet-what">
      <input data-f="title" maxlength="200" placeholder="${esc(t("O que é preciso fazer?"))}" value="${esc(preset.title || "")}" aria-label="${esc(t("Título"))}" enterkeyhint="send">
      <textarea data-f="desc" rows="3" placeholder="${esc(t("Pormenores, links, o que tem de ficar feito (opcional)"))}" aria-label="${esc(t("Descrição"))}">${esc(preset.description || "")}</textarea>
    </div>
    <p class="tq-route idle" data-route aria-live="polite"></p>
    <div class="tq-group" data-opts></div>
    <details class="tq-group tq-more"><summary>${icon("sliders")}<span>${t("Branch de git")}</span>${icon("chevron")}</summary>
      <input data-f="branch" placeholder="${esc(t("ex: checkout-fix (opcional)"))}" aria-label="${esc(t("Branch de git"))}"></details>
    <div class="tq-sheet-models"><small>${t("Modelos")}</small><div class="tq-models" data-models></div></div>
    <p class="tq-sheet-key">${t("Enter manda · Shift + Enter escreve pormenores")}</p></form>`);
  $("modal-box").classList.add("tq-box");
  const root = $("tq-sheet");
  tqComposer(root, { state: s, style: "rows", keep: !Object.keys(fixed).length, preset: { _fixed: fixed }, onSent: () => closeModal() });
  const title = root.querySelector('[data-f="title"]');
  title.focus();
  title.setSelectionRange(title.value.length, title.value.length);
}

/* ---------------------------------------------------------------- the list's rows */
let tqView = tqRead("hub.tq.view", "hoje"), tqWho = tqRead("hub.tq.who", ""), tqCo = "", tqShowOld = false;
const tqCompany = (x) => companies.find((c) => c.id === x.company)?.name || "";
// what a task is doing, in a few words, when it is not simply waiting
function tqState(x) {
  if (x.stage === "done") return x.completed_by ? `<span class="tq-st ok">${esc(doneBy(x))}</span>` : "";
  if (x.status === "IN_PROGRESS") return `<span class="tq-st live">${esc(x.current_action || t("A trabalhar"))}</span>`;
  if (x.status === "WAITING_APPROVAL") return `<span class="tq-st warn">${t("À espera da tua aprovação")}</span>`;
  if (x.status === "PAUSED") return `<span class="tq-st">${t("Em pausa")}</span>`;
  if (x.status === "NEEDS_HELP") return `<span class="tq-st warn">${t("Precisa de ajuda")}</span>`;
  if (x.status === "ASSIGNED") return `<span class="tq-st">${t("Na fila do agente")}</span>`;
  if (x.status === "FAILED") return `<span class="tq-st bad">${t("Falhou")}</span>`;
  if (x.stage === "blocked") return `<span class="tq-st bad">${esc(x.blocked_reason ? `${t("Bloqueada")}: ${x.blocked_reason}` : t("Bloqueada"))}</span>`;
  if (x.stage === "review") return `<span class="tq-st warn">${t("Em revisão")}</span>`;
  const doer = doingOf(x);
  if (doer) return `<span class="tq-st live">${esc(t("{n} está a fazer", { n: isMe(doer.assignee) ? t("Tu") : nameOf(doer.assignee) }).replace("Tu está", "Estás"))}</span>`;
  return "";
}
// who has it: the department's monogram (lit while it works), or the person's face, or the faces of a task for everybody
function tqWhoHtml(x, inCol = false) {
  if (x.group) return whoFaces(x.group);
  if (x.crew) return tqMono(x.crew, x.status === "IN_PROGRESS");
  if (inCol) return "";
  return `<span class="tq-face" title="${esc(nameOf(x.assignee))}">${ui.avatar(nameOf(x.stage === "done" && x.completed_by ? x.completed_by : x.assignee), "sm")}</span>`;
}
function tqRow(x, inCol = false) {
  const own = x.group ? x.group.find((y) => isMe(y.assignee)) || x : x;
  const done = x.stage === "done", live = x.status === "IN_PROGRESS" || (!!doingOf(x) && !done);
  const meta = [tqState(x), x.crew && !inCol ? `<span>${esc(tqDept(x.crew)?.name || x.crew_name)}</span>` : "",
    !x.crew && !x.group && !inCol && !done ? `<span>${esc(isMe(x.assignee) ? t("Tu") : nameOf(x.assignee))}</span>` : "",
    x.group ? `<span>${esc(whoLeft(x.group))}</span>` : "", tqCompany(x) ? `<span class="tq-co">${esc(tqCompany(x))}</span>` : "",
    x.project_name ? `<span>${esc(x.project_name)}</span>` : "", done && x.completed_at ? `<span>${fmt.day(x.completed_at)} ${fmt.hhmm(x.completed_at)}</span>` : ""].filter(Boolean);
  const canTick = !done && !heldByAgent(own) && own.stage !== "done";
  const check = done ? `<span class="tq-check done">${icon("tick")}</span>`
    : canTick ? `<button class="tq-check" data-done="${own.id}" aria-label="${esc(t("Concluir"))}" title="${esc(t("Concluir"))}"></button>`
    : `<span class="tq-check held" title="${esc(t("Está com o agente"))}"></span>`;
  const acts = done ? `<button data-row-act="open" title="${t("Abrir")}">${icon("chevron")}</button>`
    : `${!x.group && canGiveToAI(own) ? `<button data-row-act="ai" title="${t("Mandar para a IA: o Hub escolhe o departamento")}">${icon("bot")}</button>` : ""}
      ${!x.group ? `<button data-row-act="later" title="${t("Adiar")}">${icon("clock")}</button>` : ""}
      ${canTrash(own) && !x.group ? `<button data-row-act="trash" title="${t("Apagar")}">${icon("trash")}</button>` : ""}
      <button data-row-act="open" title="${t("Abrir")}">${icon("chevron")}</button>`;
  const prio = !done && x.priority === "urgent" ? `<i class="tq-bang">!!</i>` : !done && x.priority === "high" ? `<i class="tq-bang high">!</i>` : "";
  return `<div class="tq-row ${done ? "done" : ""} ${tqLate(x) ? "late" : ""} ${live ? "live" : ""} ${tqFresh.has(x.id) ? "fresh" : ""}" data-id="${own.id}" data-title="${esc(x.title)}">
    ${check}<div class="tq-main"><b>${prio}${esc(x.title)}</b>${meta.length ? `<span class="tq-meta">${meta.join("")}</span>` : ""}
      ${x.status === "IN_PROGRESS" && x.progress > 0 ? `<i class="tq-prog"><u style="width:${Math.min(100, x.progress)}%"></u></i>` : ""}</div>
    ${tqDueText(x)}${tqWhoHtml(x, inCol)}<div class="tq-acts">${acts}</div></div>`;
}
const tqGroup = (title, list, { tone = "", sort = true, inCol = false, more = "" } = {}) => (list.length
  ? `<section class="tq-grp ${tone}"><h3><span>${esc(t(title))}</span><i>${list.length}</i></h3>
    <div class="tq-list">${(sort ? [...list].sort(tqOrder) : list).map((x) => tqRow(x, inCol)).join("")}</div>${more}</section>` : "");

/* ---------------------------------------------------------------- the numbers and the views */
// All the tasks the page shows, already filtered by company and person; "for everybody" is one card (asOne)
function tqCards(all) {
  const inCo = (x) => !tqCo || (tqCo === "none" ? !x.company : x.company === tqCo);
  if (tqWho) return groupAll(all).filter((g) => (g.group ? g.group.some((y) => y.assignee === tqWho) : g.assignee === tqWho))
    .map((g) => (g.group ? { ...g.group.find((y) => y.assignee === tqWho), group: g.group } : g)).filter(inCo);
  return asOne(all.filter(inCo));
}
function tqNumbers(cards) {
  const open = cards.filter((x) => x.stage !== "done"), monday = tqMonday();
  return { open, late: open.filter(tqLate), today: open.filter(tqToday), agents: open.filter(tqWithAgent),
    week: cards.filter((x) => x.stage === "done" && tqDoneAt(x) >= monday) };
}
function tqStatsHtml(n) {
  const cell = (key, value, label, sub, tone = "") => `<button class="tq-stat ${tone} ${tqView === key ? "on" : ""}" data-view="${key}"><b>${value}</b><span>${esc(t(label))}</span>${sub ? `<small>${esc(sub)}</small>` : ""}</button>`;
  const running = n.agents.filter(tqRunning).length;
  return cell("hoje", n.open.length, "Abertas", n.open.filter((x) => x.priority === "urgent").length ? t("{n} urgentes", { n: n.open.filter((x) => x.priority === "urgent").length }) : t("por fazer"))
    + cell("hoje", n.today.length, "Para hoje", n.today.length ? t("até às {h}", { h: fmt.hhmm([...n.today].sort((a, b) => String(a.deadline).localeCompare(String(b.deadline)))[0].deadline) }) : t("nada marcado"))
    + cell("hoje", n.late.length, "Atrasadas", n.late.length ? t("passou o prazo") : t("tudo a tempo"), n.late.length ? "bad" : "")
    + cell("departamentos", n.agents.length, "Com os agentes", running ? t("{n} a trabalhar agora", { n: running }) : n.agents.length ? t("na fila") : t("nenhuma agora"), running ? "live" : "")
    + cell("feitas", n.week.length, "Feitas esta semana", n.week.length ? t("desde segunda") : t("ainda nenhuma"), "");
}
const TQ_VIEWS = [["hoje", "Hoje"], ["proximas", "Próximas"], ["pessoas", "Por pessoa"], ["departamentos", "Por departamento"], ["quadro", "Quadro"], ["feitas", "Feitas"]];
function tqHoje(cards) {
  const open = cards.filter((x) => x.stage !== "done"), used = new Set();
  const take = (fn) => open.filter((x) => !used.has(x) && fn(x)).map((x) => (used.add(x), x));
  const now = take((x) => tqWithAgent(x) || !!doingOf(x)), late = take(tqLate), urgent = take((x) => x.priority === "urgent"), today = take(tqToday), undated = take((x) => !x.deadline);
  const busy = now.some((x) => tqRunning(x) || !!doingOf(x));
  const body = tqGroup(busy ? "A decorrer agora" : "Na fila dos agentes", now.sort((a, b) => tqRunning(b) - tqRunning(a) || tqOrder(a, b)), { tone: busy ? "live" : "", sort: false })
    + tqGroup("Atrasadas", late, { tone: "bad" }) + tqGroup("Urgentes", urgent, { tone: "bad" }) + tqGroup("Para hoje", today, { tone: "warn" }) + tqGroup("Sem prazo", undated);
  const later = open.length - used.size;
  return body ? body + (later ? `<button class="tq-next" data-view="proximas">${t(later === 1 ? "Mais 1 tarefa com prazo nos próximos dias" : "Mais {n} tarefas com prazo nos próximos dias", { n: later })}${icon("chevron")}</button>` : "")
    : tqEmpty("check", "Nada para hoje", later ? t("Há {n} com prazo nos próximos dias.", { n: later }) : "Escreve em cima e carrega Enter: a tarefa sai logo.", later ? ["proximas", "Ver as próximas"] : null);
}
function tqProximas(cards) {
  const later = cards.filter((x) => x.stage !== "done" && x.deadline && !tqLate(x) && tqDayDiff(x.deadline) < 0);
  const days = new Map();
  for (const x of [...later].sort((a, b) => String(a.deadline).localeCompare(String(b.deadline)))) {
    const n = tqDayDiff(x.deadline), key = n < -7 ? "later" : String(n);
    (days.get(key) || days.set(key, []).get(key)).push(x);
  }
  const name = (key, x) => {
    if (key === "later") return t("Mais tarde");
    const d = new Date(x.deadline);
    return key === "-1" ? `${t("Amanhã")} · ${fmt.date(x.deadline)}` : `${t(TQ_WEEKDAY[d.getDay()])} · ${fmt.date(x.deadline)}`;
  };
  return [...days].map(([key, list]) => tqGroup(name(key, list[0]), list, { sort: false })).join("")
    || tqEmpty("calendar", "Nada marcado para os próximos dias", "As tarefas com prazo depois de hoje aparecem aqui, dia a dia.");
}
function tqPessoas(cards, all) {
  const logins = peopleOrder([...Object.keys(teamNames), ...all.map((x) => x.assignee)]).filter((u) => !tqWho || u === tqWho);
  const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
  const col = (u) => {
    const mine = cards.filter((x) => (x.group ? x.group.some((y) => y.assignee === u) : x.assignee === u))
      .map((x) => (x.group ? { ...x.group.find((y) => y.assignee === u), group: x.group } : x));
    const open = mine.filter((x) => x.stage !== "done").sort((a, b) => tqLate(b) - tqLate(a) || tqOrder(a, b));
    const did = mine.filter((x) => x.stage === "done" && tqDoneAt(x) >= midnight), late = open.filter(tqLate).length;
    const now = open.find((x) => x.doing_since || x.status === "IN_PROGRESS");
    return `<section class="tq-col"><header>${ui.avatar(nameOf(u))}<div><b>${esc(nameOf(u))}${isMe(u) ? ` <small>${t("tu")}</small>` : ""}</b>
      <span>${esc([t(open.length === 1 ? "1 aberta" : "{n} abertas", { n: open.length }), late ? t(late === 1 ? "1 atrasada" : "{n} atrasadas", { n: late }) : "",
        did.length ? t(did.length === 1 ? "1 feita hoje" : "{n} feitas hoje", { n: did.length }) : ""].filter(Boolean).join(" · "))}</span></div>
      <button class="tq-col-add" data-send-to="${esc(u)}" title="${esc(t("Mandar uma tarefa a {n}", { n: nameOf(u) }))}">${icon("plus")}</button></header>
      ${now ? `<p class="tq-col-now"><i></i>${esc(now.title)}</p>` : ""}
      ${open.length ? `<div class="tq-list">${open.map((x) => tqRow(x, true)).join("")}</div>` : `<p class="tq-col-none">${t(isMe(u) ? "Não tens nada por fazer." : "Nada por fazer.")}</p>`}</section>`;
  };
  return `<div class="tq-cols">${logins.map(col).join("")}</div>`;
}
function tqDepartamentos(cards) {
  const open = cards.filter((x) => x.stage !== "done"), week = cards.filter((x) => x.stage === "done" && tqDoneAt(x) >= tqMonday());
  const card = (d) => {
    const mine = open.filter((x) => x.crew === d.id).sort((a, b) => tqRunning(b) - tqRunning(a) || tqOrder(a, b)), did = week.filter((x) => x.crew === d.id).length;
    const live = mine.some((x) => x.status === "IN_PROGRESS");
    return `<section class="tq-dept ${live ? "live" : ""} ${mine.length ? "" : "idle"}"><header>${tqMono(d.id, live, "lg")}<div><b>${esc(d.name)}</b><span>${esc(d.what)}</span></div>
      <button class="tq-col-add" data-send-dept="${d.id}" title="${esc(t("Mandar uma tarefa a {n}", { n: d.name }))}">${icon("plus")}</button></header>
      ${mine.length ? `<div class="tq-list">${mine.map((x) => tqRow(x, true)).join("")}</div>` : ""}
      <footer>${esc([mine.length ? t(mine.length === 1 ? "1 aberta" : "{n} abertas", { n: mine.length }) : t("Sem trabalho agora"), did ? t(did === 1 ? "1 feita esta semana" : "{n} feitas esta semana", { n: did }) : ""].filter(Boolean).join(" · "))}</footer></section>`;
  };
  const used = TQ_DEPTS.filter((d) => TQ_OFFICE.includes(d) || open.some((x) => x.crew === d.id));
  const people = open.filter((x) => !x.crew);
  return `<div class="tq-depts">${used.map(card).join("")}</div>${tqGroup("Com pessoas, sem agente", people)}`;
}
const TQ_LANES = [["todo", "Por fazer", (x) => x.status === "TODO" && !x.doing_since], ["agent", "Com o agente", (x) => ["ASSIGNED", "IN_PROGRESS", "PAUSED"].includes(x.status) || (!!x.doing_since && x.stage !== "done")],
  ["stuck", "Parada", (x) => ["BLOCKED", "NEEDS_HELP", "FAILED", "WAITING_APPROVAL"].includes(x.status)], ["review", "Em revisão", (x) => x.status === "REVIEW"],
  ["done", "Feita hoje", (x) => x.stage === "done" && tqDayDiff(x.completed_at || x.updated_at) === 0]];
function tqQuadro(cards) {
  return `<div class="tq-board">${TQ_LANES.map(([key, label, fits]) => {
    const list = cards.filter(fits).sort(tqOrder);
    return `<section class="tq-lane" data-lane="${key}"><header><span>${t(label)}</span><i>${list.length}</i></header>
      <div class="tq-lane-in">${list.map((x) => `<article class="tq-card ${tqLate(x) ? "late" : ""} ${x.status === "IN_PROGRESS" ? "live" : ""}" draggable="${x.group ? "false" : "true"}" data-id="${(x.group ? x.group.find((y) => isMe(y.assignee)) || x : x).id}">
        <b>${x.priority === "urgent" && x.stage !== "done" ? `<i class="tq-bang">!!</i>` : x.priority === "high" && x.stage !== "done" ? `<i class="tq-bang high">!</i>` : ""}${esc(x.title)}</b>
        ${x.status === "IN_PROGRESS" && x.progress > 0 ? `<i class="tq-prog"><u style="width:${Math.min(100, x.progress)}%"></u></i>` : ""}
        <footer>${tqWhoHtml(x)}<span class="tq-card-meta">${esc(tqCompany(x) || x.project_name || "")}</span>${tqDueText(x)}</footer></article>`).join("")
        || `<p class="tq-lane-none">${t(key === "done" ? "Nada concluído hoje" : "Vazio")}</p>`}</div></section>`;
  }).join("")}</div>`;
}
function tqFeitas(cards) {
  const done = cards.filter((x) => x.stage === "done").sort((a, b) => tqDoneAt(b) - tqDoneAt(a));
  const on = (x) => tqDayDiff(x.completed_at || x.updated_at || x.created_at), monday = tqMonday();
  const older = done.filter((x) => on(x) > 1 && tqDoneAt(x) < monday);
  return tqGroup("Hoje", done.filter((x) => on(x) <= 0), { tone: "ok", sort: false }) + tqGroup("Ontem", done.filter((x) => on(x) === 1), { sort: false })
    + tqGroup("Esta semana", done.filter((x) => on(x) > 1 && tqDoneAt(x) >= monday), { sort: false })
    + (older.length ? tqGroup("Mais antigas", tqShowOld ? older.slice(0, 60) : older.slice(0, 8), { sort: false,
      more: older.length > 8 ? `<button class="tq-next" data-old>${t(tqShowOld ? "Mostrar menos" : "Ver mais {n}", { n: Math.min(older.length, 60) - 8 })}</button>` : "" }) : "")
    || tqEmpty("check", "Ainda nada concluído", "O que a equipa e os agentes concluírem aparece aqui, o mais recente primeiro.");
}
function tqEmpty(ic, title, text, action = null) {
  return `<div class="tq-empty">${icon(ic)}<b>${esc(t(title))}</b><p>${esc(t(text))}</p>${action ? `<button class="btn sm" data-view="${action[0]}">${esc(t(action[1]))}</button>` : ""}</div>`;
}

/* ---------------------------------------------------------------- the page (computer) */
let tqAll = [];
async function tqDesktop(r) {
  await tqLoadRefs();
  const s = tqLastChoice();
  if (!me.lead && s.who !== "ai") s.who = me.username;
  page(`${ui.head("Comando", t("Tarefas"), t("Escreve e carrega Enter: a tarefa sai logo. Por baixo, tudo o que está aberto, com quem e para quando."),
    `<button class="btn quiet" id="tq-bin">${icon("trash")}${t("Lixo")}<i class="tq-bin-n" id="tq-bin-n"></i></button>`)}
    <section class="tq-cmp" id="tq-cmp">
      <form class="tq-cmp-row" autocomplete="off">
        <span class="tq-cmp-ic">${icon("plus")}</span>
        <input data-f="title" maxlength="200" placeholder="${esc(t("Escreve uma tarefa e carrega Enter…"))}" aria-label="${esc(t("Nova tarefa"))}" enterkeyhint="send">
        <button type="button" class="tq-cmp-desc" data-desc-toggle title="${esc(t("Pormenores (Shift + Enter)"))}">${icon("note")}</button>
        <button type="button" class="tq-cmp-full" data-full title="${esc(t("Abrir a folha completa"))}">${icon("sliders")}</button>
        <button class="tq-send" data-send disabled>${t("Mandar")}${icon("arrow")}</button>
      </form>
      <textarea data-f="desc" hidden rows="2" placeholder="${esc(t("Pormenores, links, o que tem de ficar feito. Ctrl + Enter manda."))}"></textarea>
      <div class="tq-opts" data-opts></div>
      <div class="tq-cmp-foot"><p class="tq-route idle" data-route aria-live="polite"></p></div>
      <div class="tq-models-row"><small>${t("Modelos")}</small><div class="tq-models" data-models></div></div>
    </section>
    <div class="tq-stats" id="tq-stats"></div>
    <div id="tq-wait"></div>
    <div class="tq-bar"><nav class="tq-seg" id="tq-seg" aria-label="${esc(t("Vistas"))}">${TQ_VIEWS.map(([v, l]) => `<button data-view="${v}" class="${v === tqView ? "on" : ""}">${t(l)}</button>`).join("")}</nav>
      <div class="tq-filters" id="tq-filters"></div></div>
    <div class="tq-body" id="tq"></div>`);
  const cmp = tqComposer($("tq-cmp"), { state: s });
  $("tq-cmp").querySelector("[data-full]").onclick = () => {
    const box = $("tq-cmp"), v = (f) => box.querySelector(`[data-f="${f}"]`).value;
    tqNewTask({ title: v("title"), description: v("desc") });
  };
  const view = $("view");
  view.onclick = async (e) => {
    if (e.target.closest("#tq-cmp")) return;   // the composer has its own
    if (e.target.closest("#tq-bin")) return openBin();
    const v = e.target.closest("[data-view]");
    if (v) { tqView = v.dataset.view; tqWrite("hub.tq.view", tqView); return tqRefresh(); }
    const who = e.target.closest("[data-who-f]");
    if (who) { tqWho = who.dataset.whoF; tqWrite("hub.tq.who", tqWho); return tqRefresh(); }
    const co = e.target.closest("[data-co]");
    if (co) { tqCo = co.dataset.co; return tqRefresh(); }
    if (e.target.closest("[data-old]")) { tqShowOld = !tqShowOld; return tqRefresh(); }
    const to = e.target.closest("[data-send-to]"), dept = e.target.closest("[data-send-dept]");
    if (to || dept) {   // «+» on a person or a department: the composer is set to them
      if (to) { s.who = to.dataset.sendTo; } else { s.who = "ai"; s.dept = dept.dataset.sendDept; }
      cmp.sync(); $("tq-cmp").scrollIntoView({ block: "nearest", behavior: "smooth" }); cmp.focus();
      return;
    }
    const tick = e.target.closest("[data-done]");
    if (tick) return tqFinish(tick);
    const row = e.target.closest(".tq-row, .tq-card");
    const act = e.target.closest("[data-row-act]")?.dataset.rowAct;
    if (row && act) return tqRowAct(row, act, e.target.closest("[data-row-act]"));
    if (row) return openTaskModal(Number(row.dataset.id));
  };
  tqDrag(view);
  // «N» anywhere on the page (not while typing) goes to the composer
  const keys = (e) => {
    if (!$("tq-cmp")) return removeEventListener("keydown", keys);
    if (e.key.toLowerCase() === "n" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.target.closest("input, textarea, select, [contenteditable]") && $("modal").hidden) { e.preventDefault(); cmp.focus(); }
  };
  addEventListener("keydown", keys);
  await tqRefresh();
  const linked = Number(r.company) || openTask;
  if (linked) { openTask = null; openTaskModal(linked); }
}
async function tqRefresh() {
  if ($("tq")) return tqPaintDesktop();
  if ($("m-tasks") && window.tqPhoneLoad) return window.tqPhoneLoad();
  if ($("tq-week")) return tqPaintWeek();
}
async function tqPaintDesktop() {
  await mount($("tq"), async () => {
    const [list, approvals, bin] = await Promise.all([api("/api/tasks"), api("/api/approvals").catch(() => []), api("/api/tasks/trash").catch(() => null)]);
    tqAll = list.filter((x) => !x.trashed_at);
    const withCo = companies.filter((c) => tqAll.some((x) => x.company === c.id));
    if (tqCo && tqCo !== "none" && !withCo.some((c) => c.id === tqCo)) tqCo = "";
    if (tqWho && !teamNames[tqWho] && !tqAll.some((x) => x.assignee === tqWho)) tqWho = "";
    const cards = tqCards(tqAll), n = tqNumbers(cards);
    paint($("tq-stats"), tqStatsHtml(n));
    if ($("tq-bin-n")) $("tq-bin-n").textContent = bin && bin.length ? bin.length : "";
    const waiting = approvals.filter((a) => a.status === "PENDING");
    paint($("tq-wait"), waiting.length ? `<a class="tq-wait" href="#/aprovacoes">${icon("alert")}<span><b>${t(waiting.length === 1 ? "1 pedido de um agente à espera de ti" : "{n} pedidos de agentes à espera de ti", { n: waiting.length })}</b>
      <em>${esc(waiting[0].action)}</em></span>${icon("chevron")}</a>` : "");
    const people = peopleOrder([...Object.keys(teamNames)]);
    paint($("tq-filters"), `<div class="tq-chips">${[["", t("Equipa")], ...people.map((u) => [u, isMe(u) ? t("Minhas") : nameOf(u)])]
      .map(([u, label]) => `<button class="tq-chip ${u === tqWho ? "on" : ""}" data-who-f="${esc(u)}">${u ? ui.avatar(nameOf(u), "sm") : icon("users")}${esc(label)}</button>`).join("")}</div>
      ${withCo.length ? `<div class="tq-chips">${[["", t("Todas as empresas")], ...withCo.map((c) => [c.id, c.name]), ["none", t("Sem empresa")]]
        .map(([id, label]) => `<button class="tq-chip ${id === tqCo ? "on" : ""}" data-co="${esc(id)}">${esc(label)}</button>`).join("")}</div>` : ""}`);
    $("tq-seg")?.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.view === tqView));
    $("tq").dataset.mode = tqView;
    if (!tqAll.length) return tqEmpty("tasks", "Ainda não há tarefas", "Escreve a primeira em cima e carrega Enter. Vai para um agente ou para uma pessoa, como escolheres.");
    return { hoje: () => tqHoje(cards), proximas: () => tqProximas(cards), pessoas: () => tqPessoas(cards, tqAll), departamentos: () => tqDepartamentos(cards),
      quadro: () => tqQuadro(cards), feitas: () => tqFeitas(cards) }[tqView]?.() || tqHoje(cards);
  }, 6);
  setTimeout(() => tqFresh.clear(), 2400);
}

/* the row's quick actions: finish, put off, give to the AI, delete, open */
async function tqFinish(tick) {
  tick.disabled = true;
  tick.closest(".tq-row, .m-task")?.classList.add("finishing");
  navigator.vibrate?.(12);
  try { await api(`/api/tasks/${tick.dataset.done}`, { method: "PATCH", body: { status: "COMPLETED" } }); flash(t("Tarefa concluída.")); }
  catch (err) { flash(err.message); }
  setTimeout(loadBoard, 320);
}
async function tqRowAct(row, act, button) {
  const id = Number(row.dataset.id), title = row.dataset.title || "";
  if (act === "open") return openTaskModal(id);
  if (act === "trash") { row.classList.add("finishing"); return trashTaskUndo(id, title, "mistake"); }
  if (act === "ai") {
    button.disabled = true;
    try {
      const given = await api(`/api/tasks/${id}/assign-ai`, { method: "POST", body: { crew: "" } });
      flash(t("Mandada para {d}. O agente começa sozinho.", { d: tqDept(given.crew)?.name || given.crew_name }));
    } catch (err) { flash(err.message); }
    return loadBoard();
  }
  if (act === "later") {
    const fri = tqToFriday();
    const v = await tqMenu(button, t("Adiar para"), [{ label: "", items: [["tomorrow", t("Amanhã"), "18:00"], ...(fri > 1 ? [["friday", t("Sexta-feira"), "18:00"]] : []),
      ["week", t("Daqui a 1 semana"), fmt.date(tqDueDate("week").toISOString())], ["none", t("Sem prazo")]] }, { label: t("Outra data"), items: [["date", t("Escolher dia e hora")]] }], "");
    if (v === null) return;
    const d = tqDueDate(v);
    try { await api(`/api/tasks/${id}`, { method: "PATCH", body: { deadline: d ? d.toISOString() : null } }); flash(d ? t("Adiada para {d}.", { d: tqDueLabel(v) }) : t("Prazo tirado.")); }
    catch (err) { flash(err.message); }
    return loadBoard();
  }
}
// Quadro: drag a card to another column. «Com o agente» hands it to the office; the others are what a person may set.
function tqDrag(view) {
  let dragged = null;
  view.addEventListener("dragstart", (e) => { dragged = e.target.closest?.(".tq-card"); dragged?.classList.add("dragging"); });
  view.addEventListener("dragend", () => { dragged?.classList.remove("dragging"); dragged = null; view.querySelectorAll(".tq-lane.over").forEach((l) => l.classList.remove("over")); });
  view.addEventListener("dragover", (e) => {
    const lane = e.target.closest?.(".tq-lane");
    if (!dragged || !lane) return;
    e.preventDefault();
    view.querySelectorAll(".tq-lane.over").forEach((l) => l !== lane && l.classList.remove("over"));
    lane.classList.add("over");
  });
  view.addEventListener("drop", async (e) => {
    const lane = e.target.closest?.(".tq-lane");
    if (!dragged || !lane) return;
    e.preventDefault();
    const id = dragged.dataset.id, to = lane.dataset.lane;
    try {
      if (to === "agent") await api(`/api/tasks/${id}/assign-ai`, { method: "POST", body: { crew: "" } });
      else await api(`/api/tasks/${id}`, { method: "PATCH", body: { status: { todo: "TODO", stuck: "BLOCKED", review: "REVIEW", done: "COMPLETED" }[to] } });
    } catch (err) { flash(err.message); }
    loadBoard();
  });
}

/* ---------------------------------------------------------------- the phone: like Reminders and Things */
let tqPhoneTab = "hoje";
async function tqPhone(r, setReload) {
  await tqLoadRefs();
  const s = tqLastChoice();
  if (!me.lead && s.who !== "ai") s.who = me.username;
  if (tqRead("hub.tq.phoneWho", null) === null) tqWho = me.lead ? "" : me.username; else tqWho = tqRead("hub.tq.phoneWho", "");
  page(`<div class="m-screen tq-m" id="m-tasks">
    <header class="m-headrow"><div class="m-large"><span id="tq-m-sub">&nbsp;</span><h1>${t("Tarefas")}</h1></div>
      <div class="m-head-act"><span class="m-scope" id="tq-m-scope"></span></div></header>
    <section class="tq-mcmp" id="tq-mcmp">
      <form class="tq-mcmp-row" autocomplete="off">
        <input data-f="title" maxlength="200" placeholder="${esc(t("Nova tarefa…"))}" aria-label="${esc(t("Nova tarefa"))}" enterkeyhint="send">
        <button type="button" class="tq-mcmp-full" data-full aria-label="${esc(t("Personalizar"))}">${icon("sliders")}</button>
        <button class="tq-mcmp-go" data-send disabled aria-label="${esc(t("Mandar"))}">${icon("arrow")}</button>
      </form>
      <div class="tq-opts tq-mopts" data-opts></div>
      <p class="tq-route idle" data-route aria-live="polite"></p>
      <div class="tq-models tq-mmodels" data-models></div>
    </section>
    <div class="tq-mstats" id="tq-mstats"></div>
    <div id="tq-m-body">${ui.skeleton(5)}</div></div>`);
  const cmp = tqComposer($("tq-mcmp"), { state: s });
  $("tq-mcmp").querySelector("[data-full]").onclick = () => tqNewTask({ title: $("tq-mcmp").querySelector('[data-f="title"]').value });
  const load = async () => {
    const [list, approvals] = await Promise.all([api("/api/tasks"), api("/api/approvals").catch(() => [])]);
    if (!$("m-tasks")) return;
    tqAll = list.filter((x) => !x.trashed_at);
    const withCo = companies.filter((c) => tqAll.some((x) => x.company === c.id));
    if (tqCo && tqCo !== "none" && !withCo.some((c) => c.id === tqCo)) tqCo = "";
    const hasTeam = tqAll.some((x) => !isMe(x.assignee)) || Object.keys(teamNames).length > 1;
    const cards = tqCards(tqAll), n = tqNumbers(cards);
    $("tq-m-sub").textContent = `${t(n.open.length === 1 ? "1 aberta" : "{n} abertas", { n: n.open.length })}${n.late.length ? ` · ${t(n.late.length === 1 ? "1 atrasada" : "{n} atrasadas", { n: n.late.length })}` : ""}`;
    $("tq-m-scope").innerHTML = hasTeam ? `<button data-who-f="${esc(me.username)}" class="${tqWho ? "on" : ""}">${t("Minhas")}</button><button data-who-f="" class="${tqWho ? "" : "on"}">${t("Equipa")}</button>` : "";
    const running = n.agents.filter(tqRunning).length;
    paint($("tq-mstats"), [["hoje", n.today.length, "Hoje", ""], ["hoje", n.late.length, "Atrasadas", n.late.length ? "bad" : ""],
      ["agentes", n.agents.length, "Agentes", running ? "live" : ""], ["feitas", n.week.length, "Semana", ""]]
      .map(([v, k, label, tone]) => `<button class="tq-mstat ${tone}" data-tab="${v}"><b>${k}</b><span>${t(label)}</span></button>`).join(""));
    const seg = [["hoje", "Hoje"], ["proximas", "Próximas"], ["agentes", "Agentes"], ["feitas", "Feitas"]]
      .map(([id, label]) => `<button data-tab="${id}" class="${id === tqPhoneTab ? "on" : ""}">${t(label)}</button>`).join("");
    const coBar = withCo.length ? `<div class="m-filter">${[["", "Todas"], ...withCo.map((c) => [c.id, c.name]), ["none", "Sem empresa"]]
      .map(([id, label]) => `<button data-co="${esc(id)}" class="${id === tqCo ? "on" : ""}">${esc(t(label))}</button>`).join("")}</div>` : "";
    const waiting = approvals.filter((a) => a.status === "PENDING").length;
    const wait = waiting ? `<a class="m-approve" href="#/aprovacoes">${icon("alert")}<span>${t(waiting === 1 ? "1 aprovação à espera" : "{n} aprovações à espera", { n: waiting })}</span>${icon("chevron")}</a>` : "";
    const body = { hoje: () => tqMHoje(cards), proximas: () => tqMProximas(cards), agentes: () => tqMAgentes(cards), feitas: () => tqMFeitas(cards) }[tqPhoneTab]();
    const week = `<div class="m-list"><a class="m-row2" href="#/semana"><span class="m-ico">${icon("calendar")}</span><div><b>${t("Resumo da semana")}</b><span>${t("O que a equipa fez e o que vem a seguir")}</span></div>${icon("chevron")}</a></div>`;
    paint($("tq-m-body"), `${wait}<div class="m-seg">${seg}</div>${coBar}${body}${week}`);
  };
  window.tqPhoneLoad = load;
  setReload(load);
  $("view").onclick = async (e) => {
    if (e.target.closest("#tq-mcmp")) return;
    const tick = e.target.closest("[data-done]");
    if (tick) return tqFinish(tick);
    const tab = e.target.closest("[data-tab]"), who = e.target.closest("[data-who-f]"), co = e.target.closest("[data-co]");
    if (tab) { tqPhoneTab = tab.dataset.tab; return load(); }
    if (co) { tqCo = co.dataset.co; return load(); }
    if (who) { tqWho = who.dataset.whoF; tqWrite("hub.tq.phoneWho", tqWho); return load(); }
    const dept = e.target.closest("[data-send-dept]");
    if (dept) { s.who = "ai"; s.dept = dept.dataset.sendDept; cmp.sync(); window.scrollTo({ top: 0, behavior: "smooth" }); $("view").scrollTo?.({ top: 0, behavior: "smooth" }); cmp.focus(); return; }
    const row = e.target.closest(".m-task");
    if (row) openTaskModal(Number(row.dataset.id));
  };
  const linked = Number(r.company) || openTask;
  if (linked) { openTask = null; openTaskModal(linked); }
  await load().catch((e) => { if (e.message !== "unauthorized") $("tq-m-body").innerHTML = ui.error(e.message); });
}
// a phone row: the circle, the title, one line of facts, who has it on the right (swipe left deletes: mobile.js)
function tqMRow(x) {
  const own = x.group ? x.group.find((y) => isMe(y.assignee)) || x : x, done = x.stage === "done";
  const meta = [tqState(x), x.crew ? "" : x.group ? esc(whoLeft(x.group)) : !done && !isMe(x.assignee) ? esc(nameOf(x.assignee)) : "",
    tqCompany(x) ? `<span class="tq-co">${esc(tqCompany(x))}</span>` : "", tqDueText(x)].filter(Boolean);
  const canTick = !done && !heldByAgent(own);
  return `<div class="m-task tq-mrow ${done ? "done" : ""} ${tqLate(x) ? "late" : ""} ${x.status === "IN_PROGRESS" ? "live" : ""} ${tqFresh.has(x.id) ? "fresh" : ""}" data-id="${own.id}">
    ${done ? `<span class="m-check tq-check done">${icon("tick")}</span>` : canTick ? `<button class="m-check tq-check" data-done="${own.id}" aria-label="${esc(t("Concluir"))}"></button>` : `<span class="m-check tq-check held"></span>`}
    <div><b>${!done && x.priority === "urgent" ? `<i class="tq-bang">!!</i>` : !done && x.priority === "high" ? `<i class="tq-bang high">!</i>` : ""}${esc(x.title)}</b>
      ${meta.length ? `<span class="sub">${meta.join(" · ")}</span>` : ""}${x.status === "IN_PROGRESS" && x.progress > 0 ? `<i class="tq-prog"><u style="width:${Math.min(100, x.progress)}%"></u></i>` : ""}</div>
    ${x.group ? whoFaces(x.group) : x.crew ? tqMono(x.crew, x.status === "IN_PROGRESS") : done || isMe(x.assignee) ? "" : ui.avatar(nameOf(x.assignee), "sm")}</div>`;
}
const tqMBlock = (title, list, tone = "", sort = true) => (list.length ? `<section class="m-sec tq-msec"><h3 class="m-grp ${tone}"><i></i>${esc(t(title))}<span>${list.length}</span></h3>
  <div class="m-list">${(sort ? [...list].sort(tqOrder) : list).map(tqMRow).join("")}</div></section>` : "");
const tqMEmpty = (ic, title, text) => `<div class="m-empty big">${icon(ic)}<b>${esc(t(title))}</b><span>${esc(t(text))}</span></div>`;
function tqMHoje(cards) {
  const open = cards.filter((x) => x.stage !== "done"), used = new Set();
  const take = (fn) => open.filter((x) => !used.has(x) && fn(x)).map((x) => (used.add(x), x));
  const now = take((x) => tqWithAgent(x) || !!doingOf(x)), late = take(tqLate), urgent = take((x) => x.priority === "urgent"), today = take(tqToday), undated = take((x) => !x.deadline);
  const busy = now.some((x) => tqRunning(x) || !!doingOf(x));
  return (tqMBlock(busy ? "A decorrer" : "Na fila dos agentes", now, busy ? "ok" : "") + tqMBlock("Atrasadas", late, "late") + tqMBlock("Urgentes", urgent, "late") + tqMBlock("Para hoje", today, "today") + tqMBlock("Sem prazo", undated))
    || tqMEmpty("check", "Nada para hoje", "Escreve em cima e a tarefa sai logo.");
}
function tqMProximas(cards) {
  const later = cards.filter((x) => x.stage !== "done" && x.deadline && !tqLate(x) && tqDayDiff(x.deadline) < 0);
  return (tqMBlock("Amanhã", later.filter((x) => tqDayDiff(x.deadline) === -1)) + tqMBlock("Esta semana", later.filter((x) => tqDayDiff(x.deadline) < -1 && tqDayDiff(x.deadline) >= -7))
    + tqMBlock("Mais tarde", later.filter((x) => tqDayDiff(x.deadline) < -7))) || tqMEmpty("calendar", "Nada marcado", "As tarefas com prazo para os próximos dias aparecem aqui.");
}
function tqMAgentes(cards) {
  const open = cards.filter((x) => x.stage !== "done");
  const rows = TQ_DEPTS.filter((d) => TQ_OFFICE.includes(d) || open.some((x) => x.crew === d.id)).map((d) => {
    const mine = open.filter((x) => x.crew === d.id), live = mine.some((x) => x.status === "IN_PROGRESS");
    const now = mine.find((x) => x.status === "IN_PROGRESS") || mine[0];
    return `<button class="m-row2 tq-mdept ${live ? "live" : ""}" data-send-dept="${d.id}">${tqMono(d.id, live, "lg")}<div><b>${esc(d.name)}</b>
      <span>${esc(now ? now.title : d.what)}</span></div>${mine.length ? `<i class="tq-mdept-n">${mine.length}</i>` : icon("plus")}</button>`;
  }).join("");
  const withAgent = open.filter((x) => x.crew);
  return `${tqMBlock("Com os agentes", withAgent, "now")}<section class="m-sec tq-msec"><h3 class="m-grp"><i></i>${t("Departamentos")}</h3><div class="m-list">${rows}</div></section>`;
}
function tqMFeitas(cards) {
  const done = cards.filter((x) => x.stage === "done").sort((a, b) => tqDoneAt(b) - tqDoneAt(a)).slice(0, 40);
  const on = (x) => tqDayDiff(x.completed_at || x.updated_at || x.created_at);
  return (tqMBlock("Hoje", done.filter((x) => on(x) <= 0), "ok", false) + tqMBlock("Ontem", done.filter((x) => on(x) === 1), "", false)
    + tqMBlock("Mais antigas", done.filter((x) => on(x) > 1), "", false)) || tqMEmpty("check", "Ainda nada concluído", "O que concluíres aparece aqui.");
}

/* ---------------------------------------------------------------- Aprovações, in the same look */
const TQ_RULES = [["Ler ficheiros do workspace", "auto"], ["Escrever ficheiros do workspace", "auto"], ["Correr testes e lint", "auto"],
  ["git status, diff, add, commit, branch", "auto"], ["Apagar ficheiros", "ask"], ["Alterar configuração de produção ou segredos", "ask"],
  ["git push e ações remotas", "ask"], ["Deploy, publicar, release, migrações", "ask"], ["Instalar pacotes", "ask"],
  ["Qualquer outro comando", "ask"], ["Gastar dinheiro, publicar, mensagens externas", "ask"],
  ["Ler segredos, sair do workspace, comandos destrutivos", "never"]];
const TQ_RULE = { auto: ["ok", "Faz sozinho"], ask: ["warn", "Pede aprovação"], never: ["bad", "Nunca"] };
const TQ_RISK = { low: ["ok", "Risco baixo"], medium: ["warn", "Risco médio"], high: ["bad", "Risco alto"] };
let tqApprAll = [];
async function tqApprovals() {
  page(`${ui.head("Comando", t("Aprovações"), t("O que os agentes pedem para fazer antes de o fazerem. Enquanto não decides, o agente espera."))}
    <div class="tq-stats three" id="tq-appr-stats"></div>
    <div id="tq-appr"></div>
    <div class="tq-appr-grid"><div>${ui.sec("Decididas nos últimos 30 dias")}<div id="tq-appr-done"></div></div>
      <div>${ui.sec("O que o agente pode fazer")}<div class="tq-rules">${TQ_RULES.map(([what, rule]) => `<div><span>${esc(t(what))}</span><em class="${TQ_RULE[rule][0]}">${esc(t(TQ_RULE[rule][1]))}</em></div>`).join("")}</div></div></div>`);
  $("view").onclick = async (e) => {
    const diff = e.target.closest("[data-diff]"), decide = e.target.closest("[data-decide]");
    if (diff) {
      const a = tqApprAll.find((x) => x.id === Number(diff.dataset.diff));
      openModal(`<h3>${esc(a.action)}</h3>${diffHtml(a.diff)}<div class="form-foot"><button class="btn primary" data-close>${t("Fechar")}</button></div>`);
      $("modal-box").classList.add("wide");
    } else if (decide) {
      decide.closest(".tq-appr-card")?.querySelectorAll("button").forEach((b) => { b.disabled = true; });
      try {
        await api(`/api/approvals/${decide.dataset.decide}/decide`, { method: "POST", body: { approve: decide.dataset.approve === "1" } });
        flash(t(decide.dataset.approve === "1" ? "Aprovado: o agente continua." : "Recusado: o agente não o faz."));
      } catch (err) { flash(err.message); }
      tqPaintApprovals();
    }
  };
  await tqPaintApprovals();
}
async function tqPaintApprovals() {
  if (!$("tq-appr")) return;
  await mount($("tq-appr"), async () => {
    tqApprAll = await api("/api/approvals");
    const pending = tqApprAll.filter((a) => a.status === "PENDING");
    const month = tqApprAll.filter((a) => a.status !== "PENDING" && a.decided_at && Date.now() - new Date(a.decided_at) < 30 * 864e5);
    const cell = (value, label, sub, tone = "") => `<div class="tq-stat ${tone}"><b>${value}</b><span>${esc(t(label))}</span><small>${esc(t(sub))}</small></div>`;
    paint($("tq-appr-stats"), cell(pending.length, "À espera", pending.length ? (me.lead ? "o agente está parado à tua espera" : "à espera do owner") : "nada por decidir", pending.length ? "warn" : "")
      + cell(month.filter((a) => a.status === "APPROVED").length, "Aprovadas", "o agente seguiu") + cell(month.filter((a) => a.status === "REJECTED").length, "Recusadas", "o agente não o fez"));
    paint($("tq-appr-done"), month.length ? `<div class="tq-list">${month.slice(0, 25).map((a) => `<div class="tq-row ${a.status === "APPROVED" ? "" : "late"}">
      <span class="tq-check done ${a.status === "APPROVED" ? "" : "no"}">${icon(a.status === "APPROVED" ? "tick" : "x")}</span>
      <div class="tq-main"><b>${esc(a.action)}</b><span class="tq-meta"><span>${esc(t(a.status === "APPROVED" ? "Aprovado" : "Recusado"))} ${esc(fmt.ago(a.decided_at))}</span><span>${esc(a.user_name)}</span></span></div>
      ${a.task_id ? `<a class="tq-link" href="#/tarefas/${a.task_id}" title="${t("Ver a tarefa")}">${icon("chevron")}</a>` : ""}</div>`).join("")}</div>`
      : tqEmpty("check", "Nada decidido", "Os pedidos aprovados e recusados aparecem aqui."));
    if (!pending.length) return `<div class="tq-empty big">${icon("check")}<b>${t("Nada à espera de ti")}</b><p>${t("Quando um agente quiser fazer algo sensível (um push, apagar ficheiros, publicar), pára e o pedido aparece aqui, no sino e no telemóvel.")}</p>
      <a class="btn sm" href="#/tarefas">${t("Ver as tarefas")}</a></div>`;
    return `<div class="tq-appr-list">${pending.map((a) => `<article class="tq-appr-card">
      <header>${a.task_id ? `<span class="tq-mono">${icon("bot")}</span>` : ""}<div><small>${esc(t("{n} quer", { n: `Claude / ${a.user_name}` }))} · ${esc(fmt.ago(a.created_at))}</small><h3>${esc(a.action)}</h3></div>
        ${a.risk ? `<em class="tq-risk ${TQ_RISK[a.risk]?.[0] || ""}">${esc(t(TQ_RISK[a.risk]?.[1] || a.risk))}</em>` : ""}</header>
      ${a.detail ? `<p>${esc(a.detail)}</p>` : ""}${a.files.length ? `<div class="tq-files">${a.files.map((f) => `<code>${esc(f)}</code>`).join("")}</div>` : ""}
      <footer>${a.diff ? `<button class="btn sm quiet" data-diff="${a.id}">${t("Ver o que muda")}</button>` : ""}${a.task_id ? `<a class="btn sm quiet" href="#/tarefas/${a.task_id}">${t("Ver a tarefa")}</a>` : ""}
        <span class="grow"></span>${me.lead ? `<button class="btn sm danger" data-decide="${a.id}" data-approve="0">${t("Recusar")}</button><button class="btn sm primary" data-decide="${a.id}" data-approve="1">${t("Aprovar")}</button>`
          : `<span class="faint">${t("Só o owner decide")}</span>`}</footer></article>`).join("")}</div>`;
  }, 3);
}

/* ---------------------------------------------------------------- Semana, in the same look */
async function tqWeek() {
  page(`${ui.head("Comando", t("Semana"), t("O que ficou feito, o que está preso e o que vem a seguir."), ui.btn("Gerar relatório semanal", "id=week-report", "", "spark"))}
    <div class="tq-stats four" id="tq-week-stats"></div><div id="week-ai"></div><div class="tq-week" id="tq-week"></div>
    ${ui.sec("Dia a dia")}<div id="week"></div>`);
  const showReport = (r) => {
    if (!r || !$("week-ai")) return;
    $("week-ai").innerHTML = `${ui.sec("Relatório semanal", `<span class="faint">${["PENDING", "RUNNING"].includes(r.status) ? "" : fmt.day(r.created_at) + " " + fmt.hhmm(r.created_at)}</span>`)}<div class="panel pad tq-report">
      ${["PENDING", "RUNNING"].includes(r.status) ? `<p class="msg think" style="margin:0">${t("O teu agente está a escrever o relatório a partir dos dados do Hub")}</p>`
        : r.status === "DONE" ? `<p style="margin:0;white-space:pre-wrap">${md(r.answer)}</p>` : `<p class="msg note" style="margin:0">${esc(aiError(r.error))}</p>`}</div>`;
  };
  $("week-report").onclick = async () => {
    $("week-report").disabled = true;
    showReport({ status: "PENDING" });
    try { showReport(await askAI("", "weekly_report")); } catch (e) { flash(e.message); }
    if ($("week-report")) $("week-report").disabled = false;
  };
  $("view").onclick = (e) => {
    const tick = e.target.closest("[data-done]");
    if (tick) return tqFinish(tick);
    const row = e.target.closest(".tq-row");
    const act = e.target.closest("[data-row-act]")?.dataset.rowAct;
    if (row && act) return tqRowAct(row, act, e.target.closest("[data-row-act]"));
    if (row) openTaskModal(Number(row.dataset.id));
  };
  api("/api/ai/requests?kind=weekly_report&limit=1").then((list) => showReport(list[0])).catch(() => {});
  await Promise.all([tqPaintWeek(), loadWeek()]);
}
async function tqPaintWeek() {
  await mount($("tq-week"), async () => {
    const all = (await api("/api/tasks")).filter((x) => !x.trashed_at), cards = asOne(all), monday = tqMonday();
    const done = cards.filter((x) => x.stage === "done" && tqDoneAt(x) >= monday).sort((a, b) => tqDoneAt(b) - tqDoneAt(a));
    const stuck = cards.filter((x) => x.stage === "blocked" || x.status === "WAITING_APPROVAL");
    const next = cards.filter((x) => x.stage !== "done" && !stuck.includes(x)).sort(tqOrder);
    const agents = done.filter((x) => x.crew).length;
    const cell = (value, label, sub, tone = "") => `<div class="tq-stat ${tone}"><b>${value}</b><span>${esc(t(label))}</span><small>${esc(sub)}</small></div>`;
    paint($("tq-week-stats"), cell(done.length, "Feitas esta semana", done.length ? t("{n} pelos agentes", { n: agents }) : t("ainda nenhuma"))
      + cell(stuck.length, "Paradas", stuck.length ? t("precisam de alguém") : t("nada preso"), stuck.length ? "bad" : "")
      + cell(next.length, "A seguir", next.filter(tqLate).length ? t("{n} atrasadas", { n: next.filter(tqLate).length }) : t("tudo a tempo"))
      + cell(cards.filter((x) => tqWithAgent(x)).length, "Com os agentes", t("agora")));
    const col = (title, list, tone, empty) => `<section class="tq-grp ${tone}"><h3><span>${esc(t(title))}</span><i>${list.length}</i></h3>
      ${list.length ? `<div class="tq-list">${list.slice(0, 8).map((x) => tqRow(x)).join("")}</div>${list.length > 8 ? `<a class="tq-next" href="#/tarefas">${t("Mais {n} em Tarefas", { n: list.length - 8 })}${icon("chevron")}</a>` : ""}`
        : `<p class="tq-col-none">${esc(t(empty))}</p>`}</section>`;
    return col("Feitas esta semana", done, "ok", "Nada concluído esta semana.") + col("Paradas", stuck, "bad", "Nada bloqueado.") + col("A seguir", next, "", "Nada por fazer.");
  }, 4);
}
