// The company's agents as departments (23 out, Marco: «acaba com a criançada toda… uma pessoa que está aqui dentro da
// empresa olha para isto, só vê ali a brincar, nem sabe a funcionalidade… quero isto profissional»). The Batcave, the
// pixel characters and the cars are gone from the interface: each agent is a department with a code, a number and one
// sentence of what it does (docs/batcave-redesenho.md). The ids stay (batman, lucius… are keys in the database, the
// agent and library/skills/agentes.json); what is shown is the department.
//
// Two pages run on this engine:
// - Empresa AMG (#/empresa): the company's structure. The partners who send work, then the departments by area, each
//   with what it does, when to ask it, the skills it masters, what it is doing now and its last tasks; a click opens the
//   department's sheet. With ?mini=1 (the widget's mini window, picture-in-picture) the same page is a compact live list.
// - Escritório (#/escritorio): the command centre (crew-board.js), drawn from this engine's state.
// Skills (skills.js) and Equipa › Agentes (pages.js) read the departments from here (window.AMGDepts).
//
// It reads /api/office, /api/tasks, /api/etsy (the factory's steps), /api/team, /api/limits/team and /api/skills, only
// while one of its pages is open, and creates tasks (POST /api/tasks with `crew`). Nothing animates: the pages are
// repainted only when what they show changes.
(function () {
  const MINI = document.documentElement.classList.contains("is-mini");   // ?mini=1 (app.js): the compact list in the mini window
  ICONS.pip = ICONS.pip || '<rect x="3" y="5" width="18" height="14" rx="2"/><rect x="12.5" y="11.5" width="6" height="5" rx="1" fill="currentColor" stroke="none"/>';

  // ================================================================ the departments
  // Numbered 01–10 in this order. group: the area they sit in on the Empresa AMG page. role: the task's agent_role when
  // none is chosen (crew.py does the same). kinds: the Claude Code subagents each stands for. can: three short words of
  // what to ask it (on its row); asks: three real requests (in its sheet, a click starts a task with that title).
  const DEPTS = [
    { id: "batman", code: "DEV", name: "Desenvolvimento", group: "prod", role: "developer", kinds: ["general-purpose"],
      what: "Escreve e corrige código: erros, funcionalidades novas, scripts e automações.",
      can: ["um erro para corrigir", "uma funcionalidade nova", "um script ou automação"],
      asks: ["Corrige o erro que aparece ao abrir as Tarefas no telemóvel", "Faz um script que copia as faturas do mês para a pasta da empresa", "Junta à lista de tarefas um botão para exportar para Excel"] },
    { id: "lucius", code: "ENG", name: "Engenharia", group: "prod", role: "developer", kinds: ["explorador", "Explore"],
      what: "Mapeia o código, explica como as peças encaixam e constrói as ferramentas da equipa.",
      can: ["perceber como algo funciona", "encontrar onde está o código", "uma ferramenta para a equipa"],
      asks: ["Explica-me como o widget fala com o Hub", "Onde está o código que manda as notificações para o telemóvel?", "Faz uma ferramenta para vermos os erros do Hub de todos os PCs"] },
    { id: "riddler", code: "PES", name: "Pesquisa", group: "growth", role: "research", kinds: ["pesquisador", "claude-code-guide"],
      what: "Procura factos na web e em documentos, confirma duas vezes e dá as fontes.",
      can: ["preços e concorrência", "fornecedores", "confirmar um facto"],
      asks: ["Quanto cobram as escolas de condução de Lisboa pela carta B?", "Procura fornecedores de t-shirts na Europa, com preços e prazos", "Confirma se esta notícia é verdadeira e dá as fontes"] },
    { id: "catwoman", code: "DSG", name: "Design", group: "prod", role: "custom", kinds: ["designer-hub"],
      what: "Desenha páginas e ecrãs no acabamento AMG e entrega HTML e CSS a funcionar.",
      can: ["uma página ou ecrã", "um site", "logótipo e cores"],
      asks: ["Desenha a página inicial do site da escola de condução", "Deixa o ecrã das Tarefas mais limpo no telemóvel", "Faz o logótipo e as cores da marca nova"] },
    { id: "joker", code: "MKT", name: "Marketing", group: "growth", role: "marketing", kinds: ["marketing"],
      what: "Textos, anúncios e campanhas; tudo fica em rascunho até tu aprovares.",
      can: ["posts e legendas", "um anúncio", "uma campanha"],
      asks: ["Escreve 5 posts para o Instagram da BareDesk", "Prepara um anúncio de Facebook para a Via Dinâmica", "Faz a campanha de email da promoção de novembro"] },
    { id: "alfred", code: "REV", name: "Revisão", group: "prod", role: "custom", kinds: ["revisor-hub"],
      what: "Revê cada mudança antes de ir para todos: erros, riscos e o que falta.",
      can: ["rever antes de publicar", "riscos e segurança", "o que falta"],
      asks: ["Revê o que mudou hoje no Hub antes de publicarmos", "Vê se esta mudança tem riscos de segurança", "Diz o que falta para o painel FundedNext ficar pronto"] },
    { id: "robin", code: "QA", name: "Testes", group: "prod", role: "testing", kinds: [],
      what: "Corre os testes, tenta os casos difíceis e diz exatamente o que falhou.",
      can: ["correr os testes", "casos difíceis", "dizer o que falhou"],
      asks: ["Corre os testes do Hub e diz o que falha", "Experimenta o login no telemóvel com casos difíceis", "Confirma que o painel FundedNext não parte sem conta ligada"] },
    { id: "gordon", code: "OPS", name: "Operações", group: "ops", role: "custom", kinds: ["Plan"],
      what: "Organiza, planeia, faz pequenas correções e fecha pontas soltas.",
      can: ["organizar e planear", "pequenas correções", "pontas soltas"],
      asks: ["Organiza as tarefas da semana por prioridade", "Planeia o lançamento do site em passos, com datas", "Fecha as pontas soltas do projeto das escolas de condução"] },
    { id: "penguin", code: "MAC", name: "Macro", group: "trading", role: "custom", kinds: [],
      what: "Sala de Trading: calendário económico, bancos centrais, dólar, juros e manchetes.",
      can: ["notícias da semana", "bancos centrais", "dólar e juros"],
      asks: ["Que notícias podem mexer com o ouro esta semana?", "Resume o que a Fed disse hoje e o que muda para o EUR/USD", "Como está o dólar antes do CPI?"] },
    { id: "twoface", code: "TEC", name: "Análise técnica", group: "trading", role: "custom", kinds: [],
      what: "Sala de Trading: liquidez, FVG, order blocks, estrutura; dá sempre os dois lados.",
      can: ["ler um gráfico", "liquidez e zonas", "setups do dia"],
      asks: ["Lê o gráfico do XAUUSD em H1 e M15", "Onde está a liquidez do GER40 hoje?", "Há algum setup A no EUR/USD agora? Dá os dois lados"] },
  ];
  DEPTS.forEach((d, i) => { d.i = i; d.n = String(i + 1).padStart(2, "0"); });
  const GROUPS = [
    ["prod", "Produto & Código", "Constroem, desenham, revêem e testam o que a empresa usa."],
    ["growth", "Crescimento", "Conhecem o mercado e trazem clientes."],
    ["ops", "Operações", "Mantêm o trabalho organizado e sem pontas soltas."],
    ["trading", "Sala de Trading", "Leem o mercado do ouro, EUR/USD, GER40 e GBP/USD."],
  ];
  const deptById = (id) => DEPTS.find((d) => d.id === id) || null;
  const groupOf = (d) => GROUPS.find(([g]) => g === d.group) || GROUPS[0];
  // The monogram: the code in a small graphite tile, like an app icon; lit when the department is working.
  const mono = (d, cls = "") => (d ? `<span class="dm ${cls}" aria-hidden="true">${esc(d.code)}</span>` : `<span class="dm ${cls}" aria-hidden="true">AI</span>`);

  // ================================================================ what there is to do, from the Hub
  // a Claude prompt can be a machine message (<task-notification>…, paths): keep the words a person would read
  function cleanPrompt(text) {
    const raw = String(text || ""), summary = raw.match(/<summary>([\s\S]*?)(<\/summary>|$)/);
    if (summary && summary[1].trim()) return summary[1].trim();
    if (/^\s*</.test(raw)) return "";
    return raw.replace(/<[^>]*>?/g, " ").replace(/[A-Z]:\\[^\s]+|\/[\w./-]{12,}/g, " ").replace(/\b(?=\w*\d)\w{10,}\b/g, " ").replace(/\s+/g, " ").trim();
  }
  const TASK_STATE = { IN_PROGRESS: "work", WAITING_APPROVAL: "wait", NEEDS_HELP: "help", PAUSED: "pause" };
  const FRESH = 30 * 60e3, STILL_WAITING = 20 * 60e3, DAY = 24 * 3600e3;
  let office = { sessions: [] }, tasks = [], memoryNotes = null, firstLoad = true, queue = [];
  const agents = DEPTS.map((d) => ({ ...d, job: null }));   // a department and the job it has now (null: free)

  function taskJob(x, state) {
    return { key: "t" + x.id, type: "task", id: x.id, title: x.title, who: nameOf(x.assignee), state, progress: x.progress || 0, crew: x.crew || "",
      action: x.current_action || "", last: x.last_action || "", next: x.next_action || "", status: x.status, role: x.agent_role || "",
      since: x.started_at || x.created_at, project: x.project_name || x.company || x.project || "", description: x.description || "", href: `#task-${x.id}` };
  }
  function jobsOf() {
    const now = Date.now(), out = [];
    for (const x of tasks) {
      if (x.trashed_at) continue;
      const state = TASK_STATE[x.status] || (x.status === "ASSIGNED" && now - Date.parse(x.created_at) < FRESH ? "start" : null);
      if (state) out.push(taskJob(x, state));
    }
    for (const s of office.sessions || []) {
      if (s.state === "working" || (s.state === "waiting" && now - Date.parse(s.since) < STILL_WAITING)) {
        // what Claude Code told the window by itself (an agent finished, another session wrote) is not what was asked
        const asked = cleanPrompt(s.prompt), said = /^\((aviso|mensagem de outra)/.test(asked) ? "" : asked;
        out.push({ key: "c" + s.id, type: "claude", goal: s.topic || s.title || "", title: said || t("Claude a trabalhar em {p}", { p: s.project }), who: s.name,
          state: s.state === "working" ? "work" : "wait", request: s.request || "", action: s.state === "working" ? s.action || "" : "", since: s.since,
          project: s.project, model: s.model, tokens: s.tokens, subagents: (s.agents || []).map((x) => ({ kind: x.kind, state: x.state, description: x.description })),
          skills: s.skills || [], href: "#/escritorio" });
      }
      for (const ag of s.agents || []) if (ag.state === "working") {
        out.push({ key: "a" + ag.id, type: "sub", parent: "c" + s.id, kind: ag.kind, title: ag.description || ag.kind, who: s.name, state: "work", action: ag.action || "",
          since: ag.started_at, project: s.project, model: ag.model, skills: ag.skills || [], href: "#/escritorio" });
      }
    }
    out.push(...etsyJobs());
    const rank = { work: 0, help: 1, start: 2, wait: 3, pause: 4 };
    return out.sort((p, q) => rank[p.state] - rank[q.state] || String(q.since).localeCompare(String(p.since)));
  }

  // Who takes what, always by the same rule: a task by the department named on it, a subagent by its kind, a request by
  // its words, anything else to Operações. If that department is busy, the most alike free colleague; nobody free, the
  // queue. WORDS and ROLE_CREW are also in backend/app/crew.py (the Hub chooses with them when a task comes with nobody
  // named): change both together.
  const word = (s) => new RegExp(`(?<![\\p{L}\\d])(${s})(?![\\p{L}\\d])`, "iu");
  const WORDS = [
    ["twoface", word("sweep\\p{L}*|liquidez|fvg|order block\\p{L}*|bos|choch|smc|price action|an[áa]lise t[ée]cnica|gr[áa]fico\\p{L}* de velas")],
    ["penguin", word("trading|trade\\p{L}*|trader\\p{L}*|forex|xauusd|eurusd|gbpusd|ger40|dax|nas100|nasdaq|us30|bolsa|a[çc][õo]es|cripto\\p{L}*|bitcoin|calend[áa]rio econ[óo]mico|not[íi]cias do mercado")],
    ["catwoman", word("design\\p{L}*|página\\p{L}*|pagina\\p{L}*|cor|cores|layout|ecrã\\p{L}*|visual|ícone\\p{L}*|logo\\p{L}*|estilo\\p{L}*|css|bonit\\p{L}*|interface\\p{L}*|aba|abas|bot[ãa]o|bot[õo]es")],
    ["riddler", word("pesquis\\p{L}*|preço\\p{L}*|preco\\p{L}*|procur\\p{L}*|concorr\\p{L}*|fornecedor\\p{L}*")],
    ["robin", word("test\\p{L}*")],
    ["alfred", word("rever|revê|revisão|revisao|revis[ae]\\p{L}*|review")],
    ["joker", word("anúncio\\p{L}*|anuncio\\p{L}*|posts?|campanha\\p{L}*|instagram|tiktok|marketing|legenda\\p{L}*")],
    ["batman", word("erro\\p{L}*|bug\\p{L}*|código|codigo|corrig\\p{L}*|implement\\p{L}*|script\\p{L}*|automatiz\\p{L}*|backend|api")],
    ["lucius", word("onde está|onde esta|onde fica|explic\\p{L}*|como funciona")],
  ];
  const ROLE_CREW = { developer: "batman", research: "riddler", marketing: "joker", testing: "robin" };
  const NEAR = { batman: ["lucius", "robin", "alfred"], lucius: ["batman", "riddler", "alfred"], riddler: ["lucius", "joker", "gordon"],
    catwoman: ["joker", "batman", "robin"], joker: ["catwoman", "riddler", "gordon"], alfred: ["robin", "lucius", "batman"],
    robin: ["alfred", "batman", "lucius"], gordon: ["alfred", "lucius", "riddler"], penguin: ["twoface", "riddler", "gordon"], twoface: ["penguin", "lucius", "batman"] };
  const byWords = (text) => (WORDS.find(([, re]) => re.test(text)) || [])[0];
  function sectorOf(j) {
    if (j.crew && NEAR[j.crew]) return j.crew;
    const kind = j.kind && DEPTS.find((c) => c.kinds.includes(j.kind));
    if (kind) return kind.id;
    return byWords(`${j.title || ""} ${j.description || ""}`) || ROLE_CREW[j.role] || "gordon";
  }
  const trading = (id) => id === "penguin" || id === "twoface";
  // the department that takes a job now: its own, a free alike colleague, any free one of the same floor, or none (the queue)
  function pick(j) {
    const home = sectorOf(j), free = agents.filter((a) => !a.job);
    if (j.crew) return free.find((a) => a.id === j.crew) || null;   // asked for by name: that one, or the queue
    for (const id of [home, ...NEAR[home]]) { const a = free.find((x) => x.id === id); if (a) return a; }
    return free.find((a) => trading(a.id) === trading(home)) || null;
  }
  // A job keeps the department it had (nobody jumps when a new one arrives). A task given to a department by name is that
  // department's own conversation running, so it comes first: a Claude window it was only mirroring moves to a colleague.
  function reconcile(list) {
    const want = new Map(list.map((j) => [j.key, j]));
    for (const a of agents) a.job = a.job && want.has(a.job.key) ? want.get(a.job.key) : null;
    queue = [];
    const own = (j) => j.type === "task" && j.crew;
    for (const j of [...list.filter(own), ...list.filter((x) => !own(x))]) {
      if (agents.some((a) => a.job && a.job.key === j.key)) continue;
      let a = pick(j);
      const named = own(j) && !a && agents.find((x) => x.id === j.crew);
      if (named && named.job && named.job.type !== "task") { named.job = null; a = named; }
      if (!a) { queue.push(j); continue; }
      a.job = j;
    }
    // a mirror that lost its department to a named task finds another (or waits)
    for (const j of list) if (!agents.some((a) => a.job && a.job.key === j.key) && !queue.includes(j)) { const a = pick(j); if (a) a.job = j; else queue.push(j); }
  }
  const stateOf = (a) => (!a.job ? "idle" : a.job.state);
  const STATE_WORD = { idle: "Livre", work: "A trabalhar", start: "A começar", wait: "À espera", help: "Precisa de ajuda", pause: "Em pausa" };
  const TONE = { work: "ok", start: "ok", wait: "warn", help: "bad", pause: "idle", idle: "idle" };
  const LIGHT = { work: "#5fcf8c", start: "#5fcf8c", wait: "#e2b55c", help: "#ef6f5e", pause: "#7b838d", idle: "#7b838d" };
  const doneBy = (a) => tasks.filter((x) => x.crew === a.id && x.status === "COMPLETED" && !x.trashed_at).sort((p, q) => String(q.completed_at).localeCompare(String(p.completed_at)));
  const waitingFor = (a) => [...queue.filter((j) => sectorOf(j) === a.id), ...tasks.filter((x) => !x.trashed_at && x.crew === a.id && x.status === "TODO")
    .map((x) => ({ key: "q" + x.id, type: "task", id: x.id, title: x.title, who: nameOf(x.assignee), held: true, href: `#task-${x.id}` }))];

  // the partners (the people who send work), each with a quiet colour of their own for the Escritório's columns
  const PARTNERS = [["kovel", "Kovel", "#a99bff"], ["marco", "Marco", "#69b4ff"], ["david", "David", "#f28fb8"]];
  function partnerOf(name) {
    const low = String(name || "").toLowerCase(), p = PARTNERS.find(([k]) => low.includes(k));
    return p ? { id: p[0], name: p[1], color: p[2] } : { id: "", name: name || "", color: "#c9d1dc" };
  }

  // the Fábrica Etsy's batch: the department doing its step works on it while it runs
  let etsy = null, etsyAt = 0;
  async function loadEtsy() {
    if (Date.now() - etsyAt < 10000) return;
    etsyAt = Date.now();
    try { etsy = await api("/api/etsy"); } catch { etsy = null; }
  }
  function etsyJobs() {
    const st = etsy && etsy.stage;
    if (!st || !st.who) return [];
    const who = etsy.cfg && etsy.cfg.owner ? etsy.cfg.owner[0].toUpperCase() + etsy.cfg.owner.slice(1) : "";
    return [{ key: "etsy-" + st.who, type: "etsy", crew: st.who, title: st.what, goal: t("Fábrica Etsy"), action: st.what, who, state: "work",
      since: new Date(st.at * 1000).toISOString(), project: t("Fábrica Etsy"), href: "#/etsy" }];
  }

  // ================================================================ reading the Hub (only while a page of these is open)
  let lastLoad = 0, later = null, skillLib = null, skillsAt = 0, teamInfo = [], teamLimits = {}, teamAt = 0, memoryAt = 0;
  const onPage = () => !!($("cb-root") || $("ea-root"));
  async function load() {
    if (!onPage()) return;
    const wait = 2500 - (Date.now() - lastLoad);
    if (wait > 0) { clearTimeout(later); later = setTimeout(load, wait); return; }
    lastLoad = Date.now();
    try {
      const [o, ts] = await Promise.all([api("/api/office"), api("/api/tasks"), loadEtsy()]);
      office = o; tasks = ts;
    } catch (e) {
      if (e.message !== "unauthorized" && firstLoad && $("ea-groups")) $("ea-groups").innerHTML = ui.error(e.message);
      return;
    }
    if (!onPage()) return;
    reconcile(jobsOf());
    firstLoad = false;
    loadSkills();   // the last answer, kept in the tab, paints at once; the Hub's comes after
    repaint();
    loadTeam(); loadMemory();
  }
  function loadTeam() {
    if (Date.now() - teamAt < 30e3) return;
    teamAt = Date.now();
    Promise.all([api("/api/team"), api("/api/limits/team").catch(() => ({}))])
      .then(([m, lim]) => { teamInfo = m; teamLimits = lim || {}; repaint(); }).catch(() => { teamAt = 0; });
  }
  // the library's skills (library/skills, agentes.json says which department masters each), read now and then
  // (the Hub can take a few seconds to answer when it rereads the plugins' catalogs, so the last answer is kept in the tab)
  function loadSkills() {
    if (Date.now() - skillsAt < 10 * 60e3) return;
    skillsAt = Date.now();
    if (!skillLib) try { skillLib = JSON.parse(sessionStorage.getItem("ea.skills") || "null"); } catch { skillLib = null; }
    api("/api/skills").then((s) => {
      skillLib = (s.skills || []).filter((k) => k.kind === "lib").map((k) => ({ name: k.name, about: k.about || "", crew: k.crew || [] }));
      try { sessionStorage.setItem("ea.skills", JSON.stringify(skillLib)); } catch { /* full or blocked: it is only a shortcut */ }
      repaint();
    }).catch(() => { skillsAt = 0; });
  }
  function loadMemory() {
    if (Date.now() - memoryAt < 5 * 60e3) return;
    memoryAt = Date.now();
    api("/api/memory").then((m) => { memoryNotes = m; }).catch(() => { memoryAt = 0; });
  }
  const skillsOf = (a) => (skillLib || []).filter((k) => (k.crew || []).includes(a.id));
  function repaint() {
    if ($("ea-root")) paintEmpresa();
    if ($("cb-root") && window.CrewBoard) window.CrewBoard.paint();
    if (sheetFor && sheet && !sheet.hidden) paintSheet();
  }

  // ================================================================ numbers the two pages share
  const sameDay = (iso) => !!iso && new Date(iso).toDateString() === new Date().toDateString();
  function counts() {
    const now = Date.now(), weekStart = new Date(); weekStart.setHours(0, 0, 0, 0); weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
    const ai = (x) => x.crew || x.agent_role;
    const doneTasks = tasks.filter((x) => !x.trashed_at && x.status === "COMPLETED" && ai(x) && x.completed_at);
    const doneWins = (office.sessions || []).filter((s) => ["waiting", "ended", "stalled"].includes(s.state) && (s.result || s.title) && s.updated_at && s.wait !== "permission" && s.wait !== "answer");
    const today = doneTasks.filter((x) => sameDay(x.completed_at)).length + doneWins.filter((s) => sameDay(s.updated_at)).length;
    const week = doneTasks.filter((x) => Date.parse(x.completed_at) >= weekStart.getTime()).length + doneWins.filter((s) => Date.parse(s.updated_at) >= weekStart.getTime()).length;
    const busy = agents.filter((a) => a.job), working = busy.filter((a) => ["work", "start"].includes(a.job.state)), waiting = busy.length - working.length;
    const held = tasks.filter((x) => !x.trashed_at && x.crew && x.status === "TODO").length;
    return { busy, working, waiting, queue: queue.length + held, today, week, now };
  }

  // ================================================================ the page Empresa AMG
  const ago = (iso) => (iso ? fmt.ago(iso) : "");
  const sentence = (text, max = 90) => {
    let s = String(text || "").replace(/\s+/g, " ").trim();
    const end = s.search(/[.!?…](\s|$)/);
    if (end > 12) s = s.slice(0, end);
    if (s.length > max) s = s.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
    return s ? s[0].toUpperCase() + s.slice(1) : "";
  };
  const jobGoal = (j) => j.goal || sentence(j.title) || j.title || "";
  const AGENT_ON = ["WORKING", "IDLE", "WAITING", "PAUSED", "ERROR"];

  function numsHtml() {
    const c = counts(), prod = DEPTS.filter((d) => !trading(d.id)).length;
    const tile = (label, value, sub, tone = "") => `<div class="ea-num ${tone}"><small>${esc(t(label))}</small><b>${value}</b><span>${esc(sub)}</span></div>`;
    return tile("Departamentos", DEPTS.length, t("{n} de produto e negócio, {k} de trading", { n: prod, k: DEPTS.length - prod }))
      + tile("A trabalhar agora", c.working.length, c.working.length ? c.working.map((a) => a.code).join(" · ") : t("Todos livres"), c.working.length ? "lit" : "")
      + tile("Na fila", c.queue, c.queue ? t("à espera de vez ou de arrancar") : t("Nada à espera"), c.queue ? "warn" : "")
      + tile("Feitas hoje", c.today, t("{n} esta semana", { n: c.week }));
  }
  // the people who send work: who they are, if they are here and what they have running with the departments
  function partnersHtml() {
    return PARTNERS.map(([id, name]) => {
      const m = teamInfo.find((u) => partnerOf(u.display_name).id === id) || null, on = m && m.status && m.status !== "OFFLINE";
      const mine = agents.filter((a) => a.job && partnerOf(a.job.who).id === id);
      const line = mine.length ? t(mine.length === 1 ? "1 trabalho a correr" : "{n} trabalhos a correr", { n: mine.length }) : t("Nada a correr agora");
      return `<div class="ea-partner"><span class="ea-face">${ui.avatar(name)}<i class="${on ? "on" : ""}"></i></span>
        <div class="ea-pid"><b>${esc(name)}${partnerOf(me.display_name).id === id ? ` <small>${esc(t("tu"))}</small>` : ""}</b>
          <span>${esc(t("Sócio"))} · ${esc(on ? t("online") : m && m.last_seen ? t("visto {q}", { q: ago(m.last_seen) }) : t("offline"))}</span></div>
        <div class="ea-pwork">${mine.length ? `<span class="ea-codes">${mine.map((a) => mono(a, "xs on")).join("")}</span>` : ""}<em class="${mine.length ? "on" : ""}">${esc(line)}</em></div></div>`;
    }).join("");
  }
  // the state of a department, in its own words: what it is doing and for whom, or that it is free
  function stateBlock(a) {
    const st = stateOf(a), j = a.job, wq = waitingFor(a);
    if (!j) {
      const last = doneBy(a)[0];
      return `<em class="ea-st idle"><i></i>${esc(t("Livre"))}</em><p class="ea-goal quiet">${esc(wq.length ? t(wq.length === 1 ? "1 tarefa na fila" : "{n} tarefas na fila", { n: wq.length }) : t("Pronto para a próxima tarefa"))}</p>
        ${last ? `<small>${esc(t("Última: {g}", { g: sentence(last.title, 46) }))} · ${esc(ago(last.completed_at))}</small>` : ""}`;
    }
    const who = partnerOf(j.who);
    return `<em class="ea-st ${TONE[st]}"><i></i>${esc(t(STATE_WORD[st]))}</em><p class="ea-goal">${esc(jobGoal(j))}</p>
      <small>${esc([t("para {n}", { n: who.name || j.who }), j.since ? ago(j.since) : "", wq.length ? t("{n} na fila", { n: wq.length }) : ""].filter(Boolean).join(" · "))}</small>`;
  }
  function skillChips(a, max = 3) {
    const list = skillsOf(a);
    if (!skillLib) return `<span class="ea-chip is-dim">${esc(t("a ler as skills…"))}</span>`;
    if (!list.length) return `<span class="ea-chip is-dim">${esc(t("Ainda sem skills da biblioteca"))}</span>`;
    return list.slice(0, max).map((k) => `<span class="ea-chip">${esc(k.name)}</span>`).join("") + (list.length > max ? `<span class="ea-chip is-more">+${list.length - max}</span>` : "");
  }
  function deptRow(a) {
    const st = stateOf(a);
    return `<article class="ea-row st-${st}" data-dept="${a.id}" role="button" tabindex="0" aria-label="${esc(`${a.n} ${a.name}: ${t(STATE_WORD[st])}`)}">
      ${mono(a, `lg ${a.job ? (TONE[st] === "ok" ? "on" : TONE[st]) : ""}`)}
      <div class="ea-id"><h3><small>${a.n}</small>${esc(a.name)}</h3><p class="ea-what">${esc(t(a.what))}</p>
        <p class="ea-when"><span>${esc(t("Pede-lhe"))}</span>${a.can.map((x) => esc(t(x))).join(" · ")}</p>
        <div class="ea-skills">${skillChips(a)}</div></div>
      <div class="ea-state">${stateBlock(a)}</div>
      <div class="ea-go"><button type="button" class="btn sm" data-ask="${a.id}">${icon("plus")}${esc(t("Pedir tarefa"))}</button>${icon("chevron")}</div></article>`;
  }
  function groupsHtml() {
    return GROUPS.map(([g, name, about]) => {
      const list = agents.filter((a) => a.group === g), busy = list.filter((a) => a.job).length;
      return `<section class="ea-group">${ui.sec(name, `<span class="ea-sec-r">${esc(t(about))}${busy ? ` · <b>${esc(t("{n} a trabalhar", { n: busy }))}</b>` : ""}</span>`)}
        <div class="panel ea-list">${list.map(deptRow).join("")}</div></section>`;
    }).join("");
  }
  // the mini window: the departments in one list, those at work on top
  function miniHtml() {
    const c = counts(), order = [...agents].sort((p, q) => (p.job ? 0 : 1) - (q.job ? 0 : 1) || p.i - q.i);
    paint($("em-count"), esc([c.working.length ? t("{n} a trabalhar", { n: c.working.length }) : t("Ninguém a trabalhar"), c.waiting ? t("{n} à espera", { n: c.waiting }) : "",
      t("{n} livres", { n: DEPTS.length - c.busy.length })].filter(Boolean).join(" · ")));
    return order.map((a) => {
      const st = stateOf(a), j = a.job;
      return `<button type="button" class="em-row st-${st}" data-dept="${a.id}">${mono(a, `sm ${j ? (TONE[st] === "ok" ? "on" : TONE[st]) : ""}`)}
        <span class="em-txt"><b>${esc(a.name)}</b><span>${esc(j ? jobGoal(j) : t("Livre"))}</span></span>
        ${j ? `<small>${esc(partnerOf(j.who).name || j.who)}</small>` : ""}</button>`;
    }).join("");
  }
  function paintEmpresa() {
    if (firstLoad) return;
    if (MINI) { paint($("em-list"), miniHtml()); return; }
    paint($("ea-nums"), numsHtml());
    paint($("ea-partners"), partnersHtml());
    paint($("ea-groups"), groupsHtml());
  }

  // ================================================================ a department's sheet
  // On a computer a drawer on the right; on the phone (and in the mini window) a sheet that comes up from the bottom.
  let sheet = null, sheetFor = null, sheetTask = null;
  function openDept(id) {
    const a = agents.find((x) => x.id === id);
    if (!a) return;
    if (!sheet) {
      sheet = Object.assign(document.createElement("div"), { className: "ds-wrap", hidden: true });
      sheet.onclick = sheetClick;
      document.body.append(sheet);
      document.addEventListener("keydown", (e) => { if (e.key === "Escape" && sheet && !sheet.hidden) closeDept(); });
      window.addEventListener("hashchange", closeDept);
    }
    sheetFor = a; sheetTask = null;
    sheet.hidden = false;
    paintSheet();
    requestAnimationFrame(() => sheet.classList.add("open"));
    sheet.querySelector(".ds")?.focus();
    loadSkills();
    if (a.job && a.job.type === "task") api(`/api/tasks/${a.job.id}`).then((x) => { if (sheetFor === a) { sheetTask = x; paintSheet(); } }).catch(() => {});
  }
  function closeDept() {
    if (!sheet || sheet.hidden) return;
    sheet.classList.remove("open");
    sheetFor = null;
    setTimeout(() => { if (!sheetFor) sheet.hidden = true; }, 220);
  }
  function paintSheet() {
    const a = sheetFor;
    if (!a || !sheet) return;
    const st = stateOf(a), j = a.job, [, groupName] = groupOf(a), skills = skillsOf(a), done = doneBy(a), wq = waitingFor(a);
    const sec = (title, body, right = "") => `<section class="ds-sec"><header><h4>${esc(t(title))}</h4>${right}</header>${body}</section>`;
    let now;
    if (!j) now = `<p class="ds-free">${esc(t(wq.length ? "Livre por agora. Pega na primeira tarefa da fila assim que o agente automático de quem a mandou estiver ligado." : "Livre. Começa a próxima tarefa que lhe mandares."))}</p>`;
    else {
      const tk = sheetTask && sheetTask.id === j.id ? sheetTask : null, who = partnerOf(j.who);
      const status = tk ? tk.status : j.status;
      const ctl = j.type === "task" ? (["IN_PROGRESS", "WAITING_APPROVAL", "NEEDS_HELP"].includes(status) ? [["pause", "Pausar", "pause"], ["stop", "Parar", "stop"]] : status === "PAUSED" ? [["resume", "Retomar", "play"], ["stop", "Parar", "stop"]] : []) : [];
      const text = (tk && tk.description) || j.description || (j.request && j.request !== j.title ? j.request : "") || (j.goal && j.title !== j.goal ? j.title : "");
      const kind = { task: "Tarefa do Hub", claude: "Janela do Claude Code", sub: "Subagente de um Claude", etsy: "Fábrica Etsy" }[j.type];
      const fact = (k, v) => (v ? `<div><dt>${esc(t(k))}</dt><dd>${esc(v)}</dd></div>` : "");
      now = `<div class="ds-job"><p class="ds-kind">${esc(t(kind))}</p><h3>${esc(jobGoal(j))}</h3>${text ? `<p class="ds-ask">${esc(text)}</p>` : ""}
        <p class="ds-now"><span>${esc(t("A fazer"))}</span>${esc((tk && tk.current_action) || j.action || t("a pensar…"))}</p>
        <dl class="ds-facts">${fact("Para", who.name || j.who)}${fact("Onde", j.project)}${fact("Desde", j.since ? ago(j.since) : "")}${fact("Modelo", String(j.model || "").replace(/^claude-/, ""))}${fact("Tokens", j.tokens ? fmt.tokens(j.tokens) : "")}</dl>
        ${(j.subagents || []).filter((x) => x.state === "working").length ? `<p class="ds-subs">${esc(t("Subagentes"))}: ${j.subagents.filter((x) => x.state === "working").map((x) => esc(x.kind)).join(", ")}</p>` : ""}
        ${(j.skills || []).length ? `<div class="ds-chips">${j.skills.map((k) => `<span>${esc(String(k).split(":").pop())}</span>`).join("")}</div>` : ""}
        <div class="ds-acts">${j.href ? `<button type="button" class="btn sm" data-href="${esc(j.href)}">${esc(t(j.type === "task" ? "Abrir a tarefa" : j.type === "etsy" ? "Abrir a Fábrica Etsy" : "Ver no Escritório"))}${icon("chevron")}</button>` : ""}
          ${ctl.map(([act, label, ic]) => `<button type="button" class="btn sm ${act === "stop" ? "danger" : ""}" data-control="${act}">${icon(ic)}${esc(t(label))}</button>`).join("")}</div></div>`;
    }
    const html = `<aside class="ds" tabindex="-1" role="dialog" aria-label="${esc(a.name)}"><i class="ds-grab"></i>
      <header class="ds-head">${mono(a, `xl ${j ? (TONE[st] === "ok" ? "on" : TONE[st]) : ""}`)}<div><small>${a.n} · ${esc(t(groupName))}</small><h2>${esc(a.name)}</h2>
        <em class="ea-st ${TONE[st]}"><i></i>${esc(t(STATE_WORD[st]))}</em></div>
        <button type="button" class="ds-x" data-close aria-label="${esc(t("Fechar"))}">${icon("x")}</button></header>
      <p class="ds-what">${esc(t(a.what))}</p>
      <div class="ds-cta"><button type="button" class="btn primary" data-ask="${a.id}">${icon("plus")}${esc(t("Pedir tarefa"))}</button></div>
      <div class="ds-body">
        ${sec("Agora", now)}
        ${wq.length ? sec("Na fila", wq.map((x) => `<button type="button" class="ds-line" data-href="${esc(x.href || "#/tarefas")}"><i class="q"></i><span><b>${esc(x.title)}</b><small>${esc(t(x.held ? "Em espera: arranca quando a mandares" : "À espera de vez"))} · ${esc(partnerOf(x.who).name || x.who)}</small></span></button>`).join(""), `<span class="ds-n">${wq.length}</span>`) : ""}
        ${sec("Pede-lhe quando…", `<div class="ds-asks">${a.asks.map((x) => `<button type="button" data-ask="${a.id}" data-title="${esc(t(x))}"><span>«${esc(t(x))}»</span>${icon("arrow")}</button>`).join("")}</div>
          <p class="ds-note">${esc(t("Um toque abre a tarefa já escrita para este departamento; mudas o que quiseres antes de mandar."))}</p>`)}
        ${sec("Skills que domina", !skillLib ? ui.skeleton(2) : skills.length ? `<div class="ds-skills">${skills.map((k) => `<button type="button" data-skill="${esc(k.name)}"><b>${esc(k.name)}</b><span>${esc(k.about || "")}</span></button>`).join("")}</div>`
          : `<p class="ds-free">${esc(t("Ainda nenhuma skill da biblioteca lhe está entregue. Em Skills, abre uma e escolhe este departamento."))}</p>`, skills.length ? `<span class="ds-n">${skills.length}</span>` : "")}
        ${a.kinds.length ? sec("Subagentes do Claude que representa", `<div class="ds-chips">${a.kinds.map((k) => `<span>${esc(k)}</span>`).join("")}</div><p class="ds-note">${esc(t("Quando uma janela do Claude lança um subagente destes, aparece no Escritório a trabalhar por este departamento."))}</p>`) : ""}
        ${sec("Últimas tarefas feitas", done.length ? done.slice(0, 5).map((x) => `<button type="button" class="ds-line" data-href="#task-${x.id}"><i class="ok"></i><span><b>${esc(x.title)}</b><small>${esc([x.result ? sentence(x.result, 110) : t("Concluída"), ago(x.completed_at)].filter(Boolean).join(" · "))}</small></span></button>`).join("")
          : `<p class="ds-free">${esc(t("Ainda nenhuma tarefa acabada por este departamento. A primeira fica aqui e na Memória da equipa."))}</p>`, done.length ? `<span class="ds-n">${done.length}</span>` : "")}
      </div></aside>`;
    const scroll = sheet.querySelector(".ds-body")?.scrollTop || 0;
    paint(sheet, html);
    const body = sheet.querySelector(".ds-body");
    if (body) body.scrollTop = scroll;
  }
  async function sheetClick(e) {
    if (e.target === sheet || e.target.closest("[data-close]")) { closeDept(); return; }
    const at = (sel) => e.target.closest(sel);
    let b;
    if ((b = at("[data-ask]"))) { const id = b.dataset.ask, title = b.dataset.title || ""; closeDept(); ask(id, title); }
    else if ((b = at("[data-skill]"))) { sessionStorage.setItem("sk.open", b.dataset.skill); location.hash = "#/skills"; }
    else if ((b = at("[data-href]"))) location.hash = b.dataset.href;
    else if ((b = at("[data-control]")) && sheetFor && sheetFor.job) {
      const act = b.dataset.control;
      if (act === "stop" && !window.confirm(t("Parar esta tarefa? O agente deixa-a onde está."))) return;
      b.disabled = true;
      try { await api(`/api/tasks/${sheetFor.job.id}/control`, { method: "POST", body: { action: act } }); flash(t({ pause: "Tarefa em pausa.", resume: "Tarefa retomada.", stop: "Tarefa parada." }[act])); }
      catch (err) { flash(err.message); }
      b.disabled = false; lastLoad = 0; load();
    }
  }
  // «Pedir tarefa»: the Hub's own task composer (pages.js newTask), already for this department
  function ask(id, title = "") {
    if (typeof newTask === "function") newTask({ for_ai: true, crew: id || "", title });
    else location.hash = "#/tarefas";
  }

  // ================================================================ sending from the Escritório's composer
  async function sendTask(title, crewId, button, description = "", hold = false) {
    const who = $("cr-who") ? $("cr-who").value : me.username;
    if (button) button.disabled = true;
    try {
      const task = await api("/api/tasks", { method: "POST", body: { title, description, assignee: who, crew: crewId || (hold ? sectorOf({ title, description }) : ""), for_ai: !hold } });
      tasks = [task, ...tasks.filter((x) => x.id !== task.id)];
      reconcile(jobsOf());
      repaint();
      const a = agents.find((x) => x.job && x.job.key === `t${task.id}`), named = deptById(task.crew);
      flash(hold ? t("Na fila de espera: arranca quando a mandares.") : a ? t("{n} já está a tratar disto.", { n: a.name }) : named ? t("Mandada: fica na fila de {n}.", { n: named.name }) : t("Mandada."));
      return true;
    } catch (err) {
      flash(err.message);
      return false;
    } finally {
      if (button) button.disabled = false;
    }
  }
  // a task that waits in the queue is handed to the office: the department it was kept for takes it
  async function startQueued(id, button) {
    const x = tasks.find((y) => y.id === id);
    if (button) button.disabled = true;
    try {
      const given = await api(`/api/tasks/${id}/assign-ai`, { method: "POST", body: { crew: (x && x.crew) || "" } });
      flash(t("A arrancar: {n}.", { n: given.crew_name }));
      lastLoad = 0; await load();
    } catch (err) {
      flash(err.message);
      if (button) button.disabled = false;
    }
  }
  // the meeting: a real task for Operações (it costs like any other) to read the Memória, join the ideas and propose
  // what to do next; crew.remember_task keeps the result as a note
  async function meet(button) {
    if (!window.confirm(t("Reunião: Operações lê a Memória toda, liga as ideias e propõe o que fazer a seguir. É uma tarefa a sério e gasta como qualquer outra. Avançar?"))) return;
    await sendTask(t("Reunião da equipa: ligar as ideias da Memória e propor o que fazer a seguir"), "gordon", button,
      t("Lê a Memória da equipa toda (está no teu briefing) e as tarefas abertas e acabadas. Liga as ideias: o que se repete, o que se contradiz, o que ficou a meio. Propõe as 3 a 5 coisas mais importantes a fazer a seguir, cada uma com o porquê e com que departamento a deve fazer. Não mudes código nem publiques nada: é uma reunião, o resultado é a proposta."));
  }
  async function send(e, hold) {
    e.preventDefault();
    const input = $("cr-title"), title = input.value.trim();
    if (!title) { input.focus(); return; }
    if (await sendTask(title, $("cr-does").value, hold ? $("cr-hold") : $("cr-go"), "", hold)) { input.value = ""; routeHint(); }
    input.focus();
  }
  // «Automático»: whose the request is, said while it is being written. The Hub chooses the same way when the task
  // arrives with nobody named (crew.sector_of), so what is said here is what happens.
  function routeHint() {
    const el = $("cr-route"), title = $("cr-title") ? $("cr-title").value.trim() : "", chosen = $("cr-does") ? $("cr-does").value : "";
    if (!el) return;
    if (!title || chosen) { el.textContent = ""; el.hidden = true; return; }
    const home = agents.find((a) => a.id === sectorOf({ title })), busy = home.job && home.job.type === "task";
    el.hidden = false;
    el.innerHTML = `${mono(home, "xs")}<span>${esc(t(busy ? "Vai para {n}, que tem outra tarefa: fica na fila." : "Vai para {n}.", { n: `${home.n} · ${home.name}` }))}</span>`;
  }
  // the line to send a task, at the top of the command centre's missions
  function composer(users) {
    return `<form class="cr-send" id="cr-send" autocomplete="off">
        <label class="cr-in">${icon("bolt")}<input id="cr-title" maxlength="200" placeholder="${esc(t("O que é preciso fazer?"))}" aria-label="${esc(t("Tarefa"))}"></label>
        <div class="cr-opts"><label class="cr-pick" title="${esc(t("Que departamento faz. Automático: vai para o departamento do pedido."))}"><span>${esc(t("Departamento"))}</span><select id="cr-does">
          ${options([["", t("Automático")], ...agents.map((a) => [a.id, `${a.code} · ${a.name}`])], "")}</select></label>
        ${users.length ? `<label class="cr-pick" title="${esc(t("No agente automático de quem"))}"><span>${esc(t("Corre no PC de"))}</span><select id="cr-who">${options(users.map((u) => [u.username, u.display_name]), me.username)}</select></label>` : ""}</div>
        <p class="cr-route" id="cr-route" aria-live="polite" hidden></p>
        <div class="cr-btns"><button type="button" class="btn" id="cr-hold" title="${esc(t("Fica na fila de espera, já com o departamento certo, e só arranca quando a mandares"))}">${esc(t("Pôr na fila"))}</button>
        <button class="btn primary" id="cr-go">${esc(t("Mandar"))}${icon("arrow")}</button></div>
      </form>`;
  }

  // ================================================================ the mini window
  // In the widget a window of its own (amg.openMini, widget/team_widget/ui/mini.py), always on top; in Chrome or Edge a
  // picture-in-picture window; anywhere else a small browser window. It opens the page with ?mini=1: the list alone.
  async function openMini() {
    const url = `${location.origin}/?mini=1#login=${encodeURIComponent(token || "")}&to=/empresa`;
    if (typeof amgNative !== "undefined" && amgNative && amgNative.openMini) { amgNative.openMini(url); return; }
    if (window.documentPictureInPicture) {
      try {
        const pip = await documentPictureInPicture.requestWindow({ width: 380, height: 460 });
        pip.document.title = "Empresa AMG";
        pip.document.body.style.cssText = "margin:0;background:#07080a;overflow:hidden";
        pip.document.body.innerHTML = `<iframe src="${esc(url)}" style="border:0;width:100vw;height:100vh;display:block"></iframe>`;
        return;
      } catch { /* refused (no click behind it, or not allowed here): a small window instead */ }
    }
    window.open(url, "amg-mini", "popup,width=380,height=460");
  }

  // ================================================================ what the command centre and the other pages ask of the engine
  const boardHost = {
    state: () => ({ agents, office, tasks, memory: memoryNotes, team: teamInfo, limits: teamLimits, queue }),
    partners: PARTNERS, partnerOf, clean: cleanPrompt, stateOf, doneBy, waitingFor, mono, sectorOf,
    ready: () => !firstLoad, openMini, counts,
    light: (st) => LIGHT[st] || LIGHT.idle, tone: (st) => TONE[st] || "idle", word: (st) => STATE_WORD[st] || st,
    openAgent: (i) => openDept(agents[i] && agents[i].id), openDept, ask, meet, release: startQueued,
  };
  window.AMGDepts = { list: DEPTS, groups: GROUPS, byId: deptById, mono, open: openDept, ask };

  HUB_VIEWS.escritorio = async function () {
    await Promise.all([lazyFile("hub/crew-board.js"), lazyFile("hub/crew-board.css").catch(() => {})]);
    const users = me.lead ? await api("/api/users").catch(() => []) : [];
    page(`<div class="cb" id="cb-root"></div>`);
    window.CrewBoard.mount($("cb-root"), boardHost, composer(users));
    $("cr-send").onsubmit = (e) => send(e, false);
    $("cr-hold").onclick = (e) => send(e, true);
    $("cr-title").oninput = routeHint;
    $("cr-send").onchange = routeHint;
    lastLoad = 0;
    await load();
  };
  HUB_VIEWS.empresa = async function (r) {
    if (MINI) {
      page(`<div class="em" id="ea-root"><header class="em-top"><span class="em-live"><i></i>${esc(t("Ao vivo"))}</span><b>${esc(t("Empresa AMG"))}</b><span id="em-count"></span></header>
        <div class="em-list" id="em-list">${ui.skeleton(6)}</div></div>`);
    } else {
      page(`${ui.head("", t("Empresa AMG"), t("Os departamentos de agentes: o que cada um faz, no que está agora e como lhe pedir trabalho."),
          `<button type="button" class="btn quiet" data-mini title="${esc(t("A lista dos departamentos numa janela pequena, por cima do que estiveres a fazer"))}">${icon("pip")}${esc(t("Mini janela"))}</button>
           <a class="btn" href="#/escritorio">${icon("bot")}${esc(t("Escritório ao vivo"))}</a>
           <button type="button" class="btn primary" data-ask="">${icon("plus")}${esc(t("Pedir tarefa"))}</button>`)}
        <div class="ea" id="ea-root">
          <div class="ea-nums" id="ea-nums">${ui.skeleton(1)}</div>
          ${ui.sec("Quem manda trabalho", `<span class="ea-sec-r">${esc(t("Os sócios pedem; os departamentos fazem."))}</span>`)}
          <div class="panel ea-partners" id="ea-partners">${ui.skeleton(2)}</div>
          <div id="ea-groups">${ui.skeleton(8)}</div>
        </div>`);
    }
    $("view").onclick = (e) => {
      const at = (sel) => e.target.closest(sel);
      let b;
      if ((b = at("[data-ask]"))) { e.stopPropagation(); ask(b.dataset.ask, ""); }
      else if (at("[data-mini]")) openMini();
      else if ((b = at("[data-dept]"))) {
        const a = agents.find((x) => x.id === b.dataset.dept);
        if (MINI && a && a.job && a.job.href && a.job.type === "task") location.hash = a.job.href;
        else openDept(b.dataset.dept);
      }
    };
    $("view").onkeydown = (e) => { if ((e.key === "Enter" || e.key === " ") && e.target.matches(".ea-row")) { e.preventDefault(); openDept(e.target.dataset.dept); } };
    if (!firstLoad) paintEmpresa();
    lastLoad = 0;
    await load();
    if (r && r.company && deptById(r.company)) openDept(r.company);   // #/empresa/<id>: that department's sheet open
  };
  onLive(["task", "office", "tick"], () => load());
})();
