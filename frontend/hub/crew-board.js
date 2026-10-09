// O Escritório: the company's command centre, the page #/escritorio. The cave itself is the page Empresa AMG (crew.js).
// Asked for by Marco on 8-9 Oct: "o escritório tem de ser uma central de comando mesmo crazy", on one screen and with no
// long scroll, clean like an app other companies would use. On the left the real people (Kovel, Marco, David): where
// they are, how much Claude they have left, what each of their Claudes is doing and what waits for them. In the middle
// the cameras of the agents. On the right the missions: send one, the queue, what got done today.
// It draws what crew.js hands it (host.state()) and only touches the page where what it shows has changed (paint). The
// cameras are canvases the cave's engine films into (cams(), crew.js camFrame), like security cameras.
// On the phone the same page is an app with four tabs (Agora · Câmaras · Sócios · Missões), one partner at a time, and an
// agent's card comes up from the bottom as a sheet (crew-board.css, the last part).
window.CrewBoard = (function () {
  let host = null, root = null, tip = null, tipFor = null, sheet = null;
  const open = new Set(), more = new Set();   // what the person opened: a request, a result, the rest of a list
  const TABS = [["now", "Agora"], ["cams", "Câmaras"], ["people", "Sócios"], ["queue", "Missões"]];
  const SHOW_DONE = 8, DAY = 24 * 3600e3;
  const GREEN = "#4dff9a", AMBER = "#ffbf3c", RED = "#ff2d4f", GREY = "#8b95a1", COLD = "#dfe8f2";

  const ago = (iso) => (iso ? fmt.ago(iso) : "");
  const model = (m) => { const x = String(m || "").match(/opus|sonnet|haiku|fable/i); return x ? x[0][0].toUpperCase() + x[0].slice(1).toLowerCase() : ""; };
  const tok = (n) => (n > 0 ? (n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(".", ",")}M` : `${Math.max(1, Math.round(n / 1e3))}k`) + " tokens" : "");
  const flip = (set, id) => (set.has(id) ? set.delete(id) : set.add(id));
  const skill = (k) => String(k).split(":").pop();   // "superpowers:brainstorming" is read as "brainstorming"
  const same = (a, b) => a.toLowerCase().slice(0, 40) === b.toLowerCase().slice(0, 40);
  // the first sentence of a text, short enough to be read at a glance
  function sentence(text, max = 84) {
    let s = String(text || "").replace(/\s+/g, " ").trim();
    const end = s.search(/[.!?…](\s|$)/);
    if (end > 12) s = s.slice(0, end);
    if (s.length > max) s = s.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
    return s ? s[0].toUpperCase() + s.slice(1) : "";
  }
  // what the person asked a window (not what Claude Code told it by itself: an agent finished, another session wrote)
  const MACHINE = /^\((aviso|mensagem de outra)/;
  const asked = (s) => { const p = host.clean(s.prompt); return MACHINE.test(p) ? "" : p; };
  // The goal of a window, in a few words: the title Claude itself gives the conversation (the Hub keeps it); without
  // one, the first sentence of what was asked.
  const goalOf = (s) => s.title || sentence(asked(s)) || t("Claude em {p}", { p: s.project });
  const jobGoal = (j) => j.goal || sentence(j.title, 90) || j.title || "";
  const inUse = (j) => ({ skills: j.skills || [], subs: [...(j.subagents || []).filter((x) => x.state === "working").map((x) => x.kind), ...(j.type === "sub" ? [j.kind] : [])] });

  // what each agent does, in a few words, and the sector a skill belongs to (by its name)
  const CAN = {
    batman: ["corrigir erros", "implementar", "scripts e automações", "backend e API"],
    lucius: ["explicar o código", "encontrar onde está cada coisa", "ferramentas da equipa"],
    riddler: ["pesquisar na web", "preços e concorrência", "fornecedores", "confirmar factos"],
    catwoman: ["páginas e ecrãs", "cores e estilo", "logótipos e ícones", "HTML e CSS"],
    joker: ["anúncios", "posts e legendas", "campanhas"],
    alfred: ["rever antes do push", "riscos e erros", "o que falta"],
    robin: ["correr os testes", "casos difíceis", "dizer o que falhou"],
    gordon: ["organizar e planear", "pontas soltas", "reuniões da equipa"],
  };
  const SECTOR_SKILLS = [
    ["catwoman", /design|front-?end|figma|canva|artifact|dataviz|css|adobe|motion|reel|higgsfield|image|photo|video|font|slides|pptx/i],
    ["riddler", /research|pesquis|search|explor/i],
    ["robin", /test|tdd|verif|debug/i],
    ["alfred", /review|revis|security|simplify|audit/i],
    ["joker", /marketing|social|campaign|activecampaign|shopify|content|seo|email|deliverab|audience|deals|reporting|digest/i],
    ["gordon", /plan|brainstorm|schedule|loop|dispatch|executing|finishing|worktree|memory|morning|xlsx|pdf|notion|calendar|docs?$/i],
    ["lucius", /claude-api|plugin|mcp|skill|keybind|permission|browser|chrome|computer|config|init|setup/i],
  ];
  const sectorOfSkill = (name) => (SECTOR_SKILLS.find(([, re]) => re.test(name)) || ["batman"])[0];
  const STATE_WORD = { idle: "Livre", work: "A trabalhar", start: "A começar", go: "A caminho do posto", wait: "À espera", help: "Precisa de ajuda",
    pause: "Em pausa", done: "Acabou agora", fail: "Falhou" };

  // ---------------------------------------------------------------- what there is to say, partner by partner
  function build(s) {
    const now = Date.now(), mine = host.partnerOf(me.display_name).id;
    const onJob = (key) => s.agents.find((a) => a.job && a.mode !== "done" && a.job.key === key) || null;
    const crew = (id) => s.agents.find((a) => a.id === id) || null;
    return host.partners.map(([id, name, color]) => {
      const m = (s.team || []).find((u) => host.partnerOf(u.display_name).id === id) || null;
      const p = { id, name, color, me: id === mine, m, limits: m && s.limits ? s.limits[m.user] || null : null, working: [], needs: [], done: [], queue: [], idle: 0 };
      for (const x of s.office.sessions || []) {
        if (host.partnerOf(x.name).id !== id) continue;
        const it = { kind: "claude", id: "c" + x.id, s: x, agent: onJob("c" + x.id), goal: goalOf(x), at: x.since, p };
        if (x.state === "working") p.working.push(it);
        else if (x.state === "waiting" && x.wait !== "done") p.needs.push(it);
        else if (["waiting", "ended", "stalled"].includes(x.state) && (x.result || x.title || asked(x))) p.done.push({ ...it, quiet: x.state === "stalled", at: x.updated_at || x.since });
        else p.idle += x.state === "ended" ? 0 : 1;
      }
      for (const x of s.tasks) {
        if (x.trashed_at || host.partnerOf(nameOf(x.assignee)).id !== id) continue;
        const it = { kind: "task", id: "t" + x.id, x, agent: onJob("t" + x.id) || crew(x.crew), goal: x.title, at: x.started_at || x.created_at, p };
        if (x.status === "IN_PROGRESS") p.working.push(it);
        else if (["WAITING_APPROVAL", "NEEDS_HELP", "PAUSED"].includes(x.status)) p.needs.push(it);
        else if (x.status === "ASSIGNED" || (x.status === "TODO" && x.crew)) p.queue.push({ ...it, held: x.status === "TODO", at: x.created_at });
        else if (x.crew && x.status === "COMPLETED" && x.completed_at && now - Date.parse(x.completed_at) < DAY) p.done.push({ ...it, at: x.completed_at });
        else if (x.crew && ["FAILED", "STOPPED"].includes(x.status) && now - Date.parse(x.started_at || x.created_at) < DAY) p.done.push({ ...it, bad: true });
      }
      const newest = (a, b) => String(b.at).localeCompare(String(a.at));
      p.working.sort(newest); p.needs.sort(newest); p.done.sort(newest);
      p.queue.sort((a, b) => (a.held ? 1 : 0) - (b.held ? 1 : 0) || String(a.at).localeCompare(String(b.at)));   // those with the agent first, oldest first
      return p;
    });
  }

  // ---------------------------------------------------------------- pieces
  const agentChip = (a) => (a ? `<button type="button" class="cb-agent" data-agent="${a.i}" title="${esc(t("Abrir o posto de {n}", { n: a.name }))}"><img class="cr-px" src="${a.portrait}" alt=""><b>${esc(a.name)}</b><span>${esc(t(a.what))}</span></button>` : "");
  function chips(skills, subs) {
    const all = [...(skills || []).map((k) => `<span class="cb-chip" title="/${esc(k)}">/${esc(skill(k))}</span>`), ...(subs || []).map((k) => `<span class="cb-chip sub">${esc(k)}</span>`)];
    return all.length ? `<div class="cb-chips">${all.join("")}</div>` : "";
  }
  // the request behind a goal: its first sentence, and the whole of it with a click
  function askLine(it) {
    const s = it.s, whole = s.request || asked(s), short = sentence(asked(s), 150);
    if (!whole) return "";
    if (open.has(it.id)) return `<button type="button" class="cb-ask open" data-toggle="${it.id}"><small>${esc(t("O pedido"))}</small><span>${esc(whole)}</span></button>`;
    if (short && !same(short, it.goal)) return `<button type="button" class="cb-ask" data-toggle="${it.id}" title="${esc(t("Ver o pedido inteiro"))}"><small>${esc(t("Pediu"))}</small><span>${esc(short)}</span></button>`;
    return whole.length > it.goal.length + 12 ? `<button type="button" class="cb-ask link" data-toggle="${it.id}">${esc(t("Ver o pedido inteiro"))}</button>` : "";
  }
  function workCard(it) {
    const head = (tag = "") => `<div class="cb-card-h"><em class="cb-st" style="--c:${GREEN}">${esc(t("A trabalhar"))}</em>${tag}<time>${esc(ago(it.at))}</time></div>`;
    if (it.kind === "task") {
      const x = it.x;
      return `<article class="cb-card work">${head(`<span class="cb-tag">${esc(t("missão"))}</span>`)}<h4>${esc(x.title)}</h4>
        ${x.current_action ? `<p class="cb-doing">${esc(x.current_action)}</p>` : ""}
        ${x.progress > 0 ? `<span class="cb-bar"><i style="width:${Math.min(100, x.progress)}%"></i></span>` : ""}
        <div class="cb-foot">${agentChip(it.agent)}<button type="button" class="cb-link" data-href="#task-${x.id}">${esc(t("Abrir"))}${icon("chevron")}</button></div></article>`;
    }
    const s = it.s, subs = (s.agents || []).filter((x) => x.state === "working").map((x) => x.kind);
    return `<article class="cb-card work">${head()}<h4>${esc(it.goal)}</h4>
      ${s.action ? `<p class="cb-doing">${esc(s.action)}</p>` : ""}${askLine(it)}${chips(s.skills, subs)}
      <div class="cb-foot">${agentChip(it.agent)}<small>${esc([s.project, model(s.model), tok(s.tokens)].filter(Boolean).join(" · "))}</small></div></article>`;
  }
  function needCard(it, p) {
    if (it.kind === "task") {
      const x = it.x, c = x.status === "NEEDS_HELP" ? RED : x.status === "PAUSED" ? GREY : AMBER;
      const why = x.status === "WAITING_APPROVAL" ? t("À espera de aprovação") : x.status === "NEEDS_HELP" ? t("Precisa de ajuda") : t("Em pausa");
      return `<article class="cb-card need" style="--c:${c}"><div class="cb-card-h"><em class="cb-st" style="--c:${c}">${esc(why)}</em><span class="cb-tag">${esc(t("missão"))}</span><time>${esc(ago(it.at))}</time></div>
        <h4>${esc(x.title)}</h4>${x.blocked_reason ? `<p class="cb-why">${esc(x.blocked_reason)}</p>` : ""}
        <div class="cb-foot">${agentChip(it.agent)}<button type="button" class="cb-link" data-href="${x.status === "WAITING_APPROVAL" ? "#/aprovacoes" : `#task-${x.id}`}">${esc(t(x.status === "WAITING_APPROVAL" ? "Aprovar" : "Abrir"))}${icon("chevron")}</button></div></article>`;
    }
    const s = it.s;
    const why = s.wait === "permission" ? (p.me ? t("Precisa da tua autorização para continuar") : t("Precisa da autorização do {n} para continuar", { n: p.name }))
      : (p.me ? t("Fez-te uma pergunta e espera a resposta") : t("Fez uma pergunta ao {n} e espera a resposta", { n: p.name }));
    return `<article class="cb-card need" style="--c:${AMBER}"><div class="cb-card-h"><em class="cb-st" style="--c:${AMBER}">${esc(t(s.wait === "permission" ? "Autorização" : "Pergunta"))}</em><time>${esc(ago(it.at))}</time></div>
      <h4>${esc(it.goal)}</h4><p class="cb-why">${esc(why)}</p>${askLine(it)}
      <div class="cb-foot">${agentChip(it.agent)}<small>${esc([s.project, model(s.model)].filter(Boolean).join(" · "))}</small></div></article>`;
  }
  function doneRow(it) {
    const isOpen = open.has(it.id);
    let text, extra = "";
    if (it.kind === "task") {
      const x = it.x;
      text = x.result || t(it.bad ? "Parou sem acabar." : "Concluída.");
      if (isOpen) extra = `<span class="cb-x">${it.agent ? `${esc(it.agent.name)} · ${esc(t(it.agent.what))} · ` : ""}<u data-href="#task-${x.id}">${esc(t("abrir a tarefa"))}</u></span>`;
    } else {
      const s = it.s, whole = s.request || asked(s);
      text = s.result || t(it.quiet ? "Parou sem dizer que acabou." : s.state === "ended" ? "Janela fechada." : "Acabou.");
      if (isOpen) extra = `${whole ? `<span class="cb-x"><i>${esc(t("Pediu"))}</i> ${esc(whole)}</span>` : ""}<span class="cb-x">${esc([s.project, model(s.model), tok(s.tokens),
        (s.agents || []).length ? t((s.agents || []).length === 1 ? "1 subagente" : "{n} subagentes", { n: s.agents.length }) : "", ...(s.skills || []).map((k) => "/" + skill(k))].filter(Boolean).join(" · "))}</span>`;
    }
    return `<button type="button" class="cb-done ${isOpen ? "open" : ""} ${it.bad ? "bad" : ""}" data-toggle="${it.id}" style="--p:${it.p.color}"><i class="cb-tick">${icon(it.bad ? "x" : "tick")}</i>
      <div><b>${esc(it.goal)}</b><p>${esc(text)}</p>${extra}</div><span class="cb-done-r"><em><i></i>${esc(it.p.name)}</em><time>${esc(ago(it.at))}</time></span></button>`;
  }
  function queueRow(it, i, p, s) {
    const x = it.x, a = it.agent, m = (s.team || []).find((u) => u.user === x.assignee), on = !!(m && m.agent);
    const why = it.held ? t("Em espera: arranca quando a mandares")
      : !on ? (p.me ? t("À espera do teu agente automático, que está desligado") : t("À espera do agente automático do {n}, que está desligado", { n: p.name }))
      : i ? t("À espera de vez") : t("É a seguinte");
    return `<div class="cb-q ${it.held ? "held" : ""}"><span class="cb-pos">${i + 1}</span>
      <div><b data-href="#task-${x.id}">${esc(x.title)}</b><small>${a ? `${esc(a.name)} · ${esc(t(a.what))} — ` : ""}${esc(why)}</small></div>
      ${it.held ? `<button type="button" class="btn cb-go" data-release="${x.id}">${esc(t("Arrancar"))}</button>` : ""}</div>`;
  }
  // a partner: where they are, how much Claude they have left, what their Claudes are doing and what waits for them
  function personCard(p) {
    const m = p.m || {}, on = m.status && m.status !== "OFFLINE", where = m.where || [];
    const place = !on ? (m.last_seen ? t("offline · visto {q}", { q: ago(m.last_seen) }) : t("offline"))
      : where.includes("phone") && !where.includes("pc") ? t("online no telemóvel") : t("online no computador");
    const bar = (label, pct) => (pct == null ? "" : `<div class="cx-lim"><span>${esc(t(label))}</span><i><b style="width:${Math.min(100, pct)}%;--c:${pct >= 90 ? RED : pct >= 70 ? AMBER : COLD}"></b></i><em>${Math.round(pct)}%</em></div>`);
    const lim = p.limits ? bar("Claude 5 h", p.limits.five) + bar("Semana", p.limits.week) : "";
    const n = p.working.length, head = n ? t(n === 1 ? "1 a trabalhar" : "{n} a trabalhar", { n }) : p.needs.length ? t(p.me ? "à tua espera" : "à espera dele") : t("nada a correr");
    const live = p.working.map(workCard).join("") + p.needs.map((it) => needCard(it, p)).join("");
    const last = p.done[0];
    const facts = [p.done.length ? t(p.done.length === 1 ? "1 feita hoje" : "{n} feitas hoje", { n: p.done.length }) : "",
      p.queue.length ? t(p.queue.length === 1 ? "1 na fila" : "{n} na fila", { n: p.queue.length }) : "",
      m.agent ? t("agente automático ligado") : t("agente automático desligado")].filter(Boolean);
    return `<header><span class="cx-face">${ui.avatar(p.name)}<i class="${on ? "on" : ""}"></i></span><div><b>${esc(p.name)}${p.me ? ` <small>${esc(t("tu"))}</small>` : ""}</b><span>${esc(place)}</span></div><em>${esc(head)}</em></header>
      ${lim ? `<div class="cx-lims">${lim}</div>` : ""}
      ${live || `<p class="cb-quiet">${last ? esc(t("Acabou «{g}» {q}.", { g: last.goal, q: ago(last.at) })) : esc(t("Nada a correr agora."))}</p>`}
      ${p.idle ? `<p class="cb-idle">${esc(t(p.idle === 1 ? "1 janela do Claude aberta, sem pedido" : "{n} janelas do Claude abertas, sem pedido", { n: p.idle }))}</p>` : ""}
      <footer>${facts.map((f) => `<span>${esc(f)}</span>`).join("")}</footer>`;
  }
  // the company in one sentence, and four numbers
  function summary(people) {
    const n = (k) => people.reduce((sum, p) => sum + p[k].length, 0), working = people.filter((p) => p.working.length).map((p) => p.name);
    const lead = working.length ? t(working.length === 1 ? "{n} agentes a trabalhar para o {a}" : "{n} agentes a trabalhar para {a}", { n: n("working"), a: working.join(working.length === 2 ? " e o " : ", ") })
      : t("Ninguém a trabalhar agora");
    return [lead, n("needs") ? t(n("needs") === 1 ? "1 à espera de alguém" : "{n} à espera de alguém", { n: n("needs") }) : "",
      n("queue") ? t("{n} na fila", { n: n("queue") }) : "", t(n("done") === 1 ? "1 feita hoje" : "{n} feitas hoje", { n: n("done") })].filter(Boolean).join(" · ");
  }
  function nums(people) {
    const n = (k) => people.reduce((sum, p) => sum + p[k].length, 0);
    const tile = (num, label, c) => `<div class="cb-num ${num ? "lit" : ""}" style="--c:${c}"><b>${num}</b><span>${esc(t(label))}</span></div>`;
    return tile(n("working"), "a trabalhar", GREEN) + tile(n("needs"), "à espera", AMBER) + tile(n("queue"), "na fila", COLD) + tile(n("done"), "feitas hoje", GREY);
  }
  // the day in one line per partner (the phone's first tab)
  function sayList(people) {
    return people.map((p) => {
      let line;
      if (p.working.length) {
        const w = p.working[0], a = w.agent;
        line = `${esc(t("está com"))} <q>${esc(w.goal)}</q>${a ? ` <em>${esc(a.name)} · ${esc(t(a.what))}</em>` : ""}${p.working.length > 1 ? ` ${esc(t("e mais {n}", { n: p.working.length - 1 }))}` : ""}`;
      } else if (p.needs.length) line = `${esc(t("tem"))} <q>${esc(p.needs[0].goal)}</q> ${esc(t(p.me ? "à tua espera" : "à espera dele"))}`;
      else if (p.done.length) line = `${esc(t("acabou"))} <q>${esc(p.done[0].goal)}</q> <em>${esc(ago(p.done[0].at))}</em>`;
      else line = esc(t("sem nada a correr"));
      return `<li style="--p:${p.color}"><i></i><span><b>${esc(p.name)}</b> ${line}</span></li>`;
    }).join("");
  }
  function queuePane(people, s) {
    if (!people.some((p) => p.queue.length)) return `<p class="cb-quiet">${esc(t("Nada na fila. «Pôr na fila» guarda uma missão já com o agente certo, até a mandares arrancar."))}</p>`;
    return people.filter((p) => p.queue.length).map((p) => `<div class="cb-grp queue" style="--p:${p.color}"><small class="cb-k"><i></i>${esc(p.name)}</small>${p.queue.map((it, i) => queueRow(it, i, p, s)).join("")}</div>`).join("");
  }
  function donePane(people) {
    const all = people.flatMap((p) => p.done).sort((a, b) => String(b.at).localeCompare(String(a.at)));
    if (!all.length) return `<p class="cb-quiet">${esc(t("Ainda nada acabado hoje."))}</p>`;
    const every = more.has("done"), shown = every ? all : all.slice(0, SHOW_DONE);
    return shown.map(doneRow).join("") + (all.length > SHOW_DONE ? `<button type="button" class="cb-more" data-more="done">${esc(every ? t("Mostrar menos") : t("Mais {n}", { n: all.length - SHOW_DONE }))}</button>` : "");
  }
  function doors(s) {
    const gold = s.tasks.filter((x) => x.status === "COMPLETED").length;
    const door = (attr, ic, title, sub) => `<button type="button" class="cb-door" ${attr} title="${esc(sub)}">${icon(ic)}<div><b>${esc(t(title))}</b><span>${esc(sub)}</span></div></button>`;
    return door('data-href="#/empresa"', "play", "A cave", t("Os oito agentes ao vivo"))
      + door('data-panel="memory"', "note", "Memória", s.memory ? t("{n} notas", { n: s.memory.length }) : t("O que os agentes sabem"))
      + door('data-panel="arsenal"', "layers", "Skills", t("{n} no arsenal", { n: (s.arsenal || []).length }))
      + door('data-panel="vault"', "bag", "Cofre", t("{n} missões feitas", { n: gold }))
      + door("data-meet", "spark", "Reunião", t("O Gordon liga as ideias"));
  }

  // ---------------------------------------------------------------- an agent's card, read at a glance (the pointer on a camera, here and in the cave)
  function ficha(a) {
    const s = host.state(), st = host.stateOf(a), j = a.job, c = host.light(st), use = j ? inUse(j) : { skills: [], subs: [] };
    const sector = (s.arsenal || []).filter((k) => sectorOfSkill(k.name) === a.id && !use.skills.includes(k.name)), done = host.doneBy(a);
    const who = j ? host.partnerOf(j.who) : null;
    const row = (k, v) => (v ? `<div><dt>${esc(t(k))}</dt><dd>${v}</dd></div>` : "");
    const grp = (label, body) => (body ? `<div class="cf-grp"><b>${esc(t(label))}</b><div class="cf-chips">${body}</div></div>` : "");
    return `<div class="cf"><header><img class="cr-px" src="${a.figure}" alt=""><div><small>${esc(t("Posto"))} · ${esc(t(a.what))}</small><h3>${esc(a.name)}</h3>
        <em style="--c:${c}"><i></i>${esc(t(STATE_WORD[st] || st))}</em></div></header>
      ${j ? `<section><small class="cf-k">${esc(t("O que está a fazer"))}</small><dl>
          ${row("Pediu", `<i class="cf-p" style="--p:${who.color}"></i>${esc(who.name || j.who)}${j.project ? ` · ${esc(j.project)}` : ""}`)}
          ${row("Meta", esc(jobGoal(j)))}${row("Agora", esc(j.action || t("a pensar…")))}
          ${row("Desde", esc([j.since ? ago(j.since) : "", model(j.model), tok(j.tokens)].filter(Boolean).join(" · ")))}</dl></section>`
        : `<section><small class="cf-k">${esc(t("Quem é"))}</small><p class="cf-bio">${esc(t(a.bio))}</p></section>`}
      <section><small class="cf-k">${esc(t("Skills"))}</small>
        ${grp("Em uso agora", [...use.skills.map((k) => `<span class="on">/${esc(skill(k))}</span>`), ...use.subs.map((k) => `<span class="on sub">${esc(k)}</span>`)].join(""))}
        ${grp("Do setor", sector.slice(0, 8).map((k) => `<span>/${esc(skill(k.name))}${k.uses ? `<i>${k.uses}×</i>` : ""}</span>`).join(""))}
        ${grp("Sabe fazer", `<span class="plain">${esc(CAN[a.id].map((x) => t(x)).join(" · "))}</span>`)}
        ${grp("Subagentes do Claude que faz", (a.kinds || []).map((k) => `<span class="sub">${esc(k)}</span>`).join(""))}</section>
      ${done.length ? `<section><small class="cf-k">${esc(t(done.length === 1 ? "1 missão feita" : "{n} missões feitas", { n: done.length }))}</small>${done.slice(0, 2).map((x) => `<p class="cf-done"><i></i>${esc(x.title)}</p>`).join("")}</section>` : ""}</div>`;
  }
  // the whole team in a column: what the cave's side shows while the pointer is on nobody
  function roster() {
    const s = host.state();
    return `<div class="cf-roster"><small class="cf-k">${esc(t("A equipa agora"))}</small>${s.agents.map((a) => {
      const st = host.stateOf(a), j = a.job;
      return `<button type="button" class="cf-row" data-agent="${a.i}"><img class="cr-px" src="${a.portrait}" alt=""><div><b>${esc(a.name)}<span>${esc(t(a.what))}</span></b>
        <p style="--c:${host.light(st)}"><i></i>${esc(j ? jobGoal(j) : t("Livre"))}</p></div></button>`;
    }).join("")}<p class="cf-hint">${esc(t("Passa o rato por um agente para ver o que está a fazer e as skills dele. Clica para abrir a missão."))}</p></div>`;
  }

  // ---------------------------------------------------------------- the cameras
  // One per agent, following them; the main monitor shows one of them large, with who asked, the goal and what is being
  // done under the picture. Left alone it goes to whoever started working last; a click pins a camera.
  let camSel = 0, camPin = false;
  const camNo = (i) => String(i + 1).padStart(2, "0");
  function autoCam(s) {
    const busy = s.agents.filter((a) => a.job && a.mode !== "done");
    const pick = busy.filter((a) => a.job.state === "work").sort((p, q) => String(q.job.since).localeCompare(String(p.job.since)))[0] || busy[0];
    return pick ? pick.i : camSel;
  }
  function camInfo(a) {
    const st = host.stateOf(a), j = a.job, c = host.light(st);
    const head = `<div class="cc-who"><img class="cr-px" src="${a.portrait}" alt=""><div><b>${esc(a.name)}</b><small>${esc(t(a.what))}</small></div><em style="--c:${c}"><i></i>${esc(t(STATE_WORD[st] || st))}</em></div>`;
    const line = (k, v, cls = "") => (v ? `<div class="cc-line ${cls}"><small>${esc(t(k))}</small><span>${v}</span></div>` : "");
    if (!j) return `${head}${line("Sabe fazer", esc(CAN[a.id].map((x) => t(x)).join(" · ")))}
      <div class="cc-act"><button type="button" class="cb-link cc-skills" data-ficha="${a.i}">${esc(t("Skills"))}${icon("chevron")}</button><small>${esc(t("Sem missão: está com os outros, à espera de trabalho."))}</small><button type="button" class="cb-link" data-agent="${a.i}">${esc(t("Dar-lhe uma missão"))}${icon("chevron")}</button></div>`;
    const who = host.partnerOf(j.who), use = inUse(j), goal = jobGoal(j), ask = sentence(j.title, 130);
    return `${head}${line("Para", `<i class="cf-p" style="--p:${who.color}"></i>${esc(who.name || j.who)}${j.project ? ` · ${esc(j.project)}` : ""}${j.since ? ` · ${esc(ago(j.since))}` : ""}`)}
      ${line("Meta", esc(goal), "big")}${ask && !same(ask, goal) ? line("Pediu", esc(ask), "ask") : ""}${line("Agora", esc(j.action || t("a pensar…")), "mono")}${chips(use.skills, use.subs)}
      <div class="cc-act"><button type="button" class="cb-link cc-skills" data-ficha="${a.i}">${esc(t("Skills"))}${icon("chevron")}</button><small>${esc([model(j.model), tok(j.tokens)].filter(Boolean).join(" · "))}</small><button type="button" class="cb-link" data-agent="${a.i}">${esc(t("Abrir a missão"))}${icon("chevron")}</button></div>`;
  }
  // What the cave's engine films: the main monitor and the eight small ones, each a canvas the size it is shown at.
  // w: how much of the cave the picture should take in; the engine rounds it so that each pixel of the cave is a whole
  // number of pixels on the screen (uneven pixels were what made the cameras look broken).
  function cams() {
    if (!root || !root.isConnected) return [];
    const dpr = Math.min(2, window.devicePixelRatio || 1), out = [];
    const fit = (c) => { const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr); if (w && h && (c.width !== w || c.height !== h)) { c.width = w; c.height = h; } return w && h; };
    const main = $("cc-main-cv");
    if (main && fit(main)) out.push({ el: main, i: camSel, w: 150, main: true });
    for (const a of host.state().agents) { const c = $(`cc-cv-${a.i}`); if (c && fit(c)) out.push({ el: c, i: a.i, w: 78 }); }
    const clock = $("cc-clock");
    if (clock) clock.textContent = new Date().toLocaleTimeString("pt-PT");
    return out;
  }

  // ---------------------------------------------------------------- the page
  function draw() {
    if (!root || !root.isConnected) return;
    const s = host.state(), people = build(s);
    if (host.ready()) {   // before the Hub has answered there is nothing true to say: the page waits
      paint($("cx-sum"), esc(summary(people)));
      paint($("cb-nums"), nums(people));
      paint($("cb-say"), sayList(people));
      for (const p of people) paint($(`cb-col-${p.id}`), personCard(p));
      paint($("cb-queue"), queuePane(people, s));
      paint($("cb-done"), donePane(people));
      const waiting = people.reduce((n, p) => n + p.queue.length, 0), seg = root.querySelector('.cb-seg [data-tab="queue"]');
      if (seg) seg.textContent = waiting ? `${t("Missões")} · ${waiting}` : t("Missões");
    }
    if (!camPin) camSel = autoCam(s);
    const sel = s.agents[camSel] || s.agents[0];
    paint($("cc-head"), `<span>CAM ${camNo(sel.i)}</span><b>${esc(t(sel.what))}</b>`);
    paint($("cc-low"), camInfo(sel));
    $("cc-auto").classList.toggle("on", !camPin);
    for (const a of s.agents) {
      const el = $(`cc-cam-${a.i}`), who = a.job ? host.partnerOf(a.job.who) : null;
      if (!el) continue;
      paint($(`cc-l-${a.i}`), `<span><i></i>${camNo(a.i)} · ${esc(t(a.what))}</span><b>${esc(a.name)}</b>${who ? `<em style="--p:${who.color}">${esc(who.name || a.job.who)}</em>` : ""}`);
      el.className = `cc-cam ${a.i === sel.i ? "sel" : ""} ${a.job ? "busy" : ""}`; el.style.setProperty("--c", host.light(host.stateOf(a)));
    }
    paint($("cb-doors"), doors(s));
    if (tip && !tip.hidden && tipFor) paint(tip, ficha(tipFor));
  }
  // On a computer the command centre takes exactly the height of the window: no long page, each column scrolls inside.
  function fit() {
    if (!root || !root.isConnected) return;
    const desk = !document.documentElement.classList.contains("is-phone") && root.clientWidth >= 760;
    root.classList.toggle("desk", desk);
    root.classList.toggle("wide", desk && root.clientWidth >= 1180);
    const pad = (parseFloat(getComputedStyle($("view")).paddingBottom) || 0) + 6;
    root.style.height = desk ? `${Math.max(560, window.innerHeight - root.getBoundingClientRect().top - pad)}px` : "";
  }
  function hideTip() { if (tip) tip.hidden = true; tipFor = null; }
  function showTip(a, card) {
    if (window.matchMedia("(hover: none)").matches) return;
    if (!tip) { tip = document.createElement("div"); tip.className = "cb-tip"; document.body.append(tip); }
    tipFor = a; tip.hidden = false; paint(tip, ficha(a));
    const r = card.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
    let x = r.right + 12;
    if (x + w > vw - 8) x = r.left - w - 12;
    if (x < 8) x = Math.max(8, Math.min(vw - w - 8, r.left));
    tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(Math.max(8, Math.min(r.top, vh - h - 8)))}px)`;
  }
  // the phone: an agent's card comes up from the bottom
  function openSheet(html) {
    if (!sheet) {
      sheet = Object.assign(document.createElement("div"), { className: "cb-sheet" });
      sheet.onclick = (e) => { if (e.target === sheet || e.target.closest("[data-close]")) sheet.hidden = true; };
      document.body.append(sheet);
    }
    sheet.innerHTML = `<div class="cb-sheet-box"><i class="cb-grab"></i><button type="button" class="cb-sheet-x" data-close aria-label="${esc(t("Fechar"))}">${icon("x")}</button>${html}</div>`;
    sheet.hidden = false;
  }
  function showTab(id) {
    if (!TABS.some(([k]) => k === id)) id = "now";
    root.dataset.tab = id; sessionStorage.setItem("cb.tab", id);
    root.querySelectorAll(".cb-seg [data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === id));
    host.film();
  }
  function showWho(id) {
    $("cb-cols").dataset.who = id; sessionStorage.setItem("cb.who", id);
    root.querySelectorAll(".cb-who [data-who]").forEach((b) => b.classList.toggle("on", b.dataset.who === id));
  }
  // a partner's screen clicked in the cave: their card here, lit for a moment
  function flashPerson(id) {
    const col = $(`cb-col-${id}`);
    if (!col) return;
    showWho(id);
    if (document.documentElement.classList.contains("is-phone")) showTab("people");
    col.scrollIntoView({ behavior: "smooth", block: "nearest" });
    col.classList.remove("flash"); void col.offsetWidth; col.classList.add("flash");
  }
  function click(e) {
    const at = (sel) => e.target.closest(sel);
    let b;
    if ((b = at(".cb-seg [data-tab]"))) { showTab(b.dataset.tab); window.scrollTo({ top: 0 }); }
    else if ((b = at(".cb-who [data-who]"))) showWho(b.dataset.who);
    else if ((b = at("[data-ficha]"))) openSheet(ficha(host.state().agents[Number(b.dataset.ficha)]));
    else if ((b = at("[data-release]"))) host.release(Number(b.dataset.release), b);
    else if ((b = at("[data-mini]"))) host.openMini();
    else if ((b = at("[data-href]"))) location.hash = b.dataset.href;
    else if ((b = at("[data-agent]"))) { hideTip(); host.openAgent(Number(b.dataset.agent)); }
    else if ((b = at("[data-panel]"))) host.openPanel(b.dataset.panel);
    else if ((b = at("[data-meet]"))) host.meet(b);
    else if ((b = at("[data-cam-auto]"))) { camPin = false; draw(); host.film(); }
    else if ((b = at("[data-cam]"))) { camSel = Number(b.dataset.cam); camPin = true; draw(); host.film(); }
    else if ((b = at("[data-more]"))) { flip(more, b.dataset.more); draw(); }
    else if ((b = at("[data-toggle]"))) { flip(open, b.dataset.toggle); draw(); }
  }
  // composer: the line to send a mission (crew.js writes it and binds it): the top of the missions' column
  function mount(el, h, composer = "") {
    host = h; root = el;
    const mine = host.partnerOf(me.display_name).id || host.partners[0][0];
    root.innerHTML = `<nav class="cb-seg">${TABS.map(([id, label]) => `<button type="button" data-tab="${id}">${esc(t(label))}</button>`).join("")}</nav>
      <header class="cx-top" data-pane="now">
        <div class="cx-id"><small>${esc(t("Agente AMG · central de comando"))}</small><h1>${esc(t("Escritório"))}</h1><p id="cx-sum">${esc(t("A ler o que a empresa está a fazer…"))}</p></div>
        <div class="cb-nums" id="cb-nums"></div>
        <div class="cx-acts"><a class="btn cx-cave" href="#/empresa">${icon("play")}${esc(t("A cave"))}</a><button type="button" class="btn cx-mini" data-mini title="${esc(t("A cave numa janela pequena, por cima do que estiveres a fazer"))}">${icon("pip")}${esc(t("Mini janela"))}</button></div>
        <ul class="cb-say" id="cb-say"></ul>
      </header>
      <section class="cx-people" data-pane="people"><small class="cx-k">${esc(t("Os sócios"))}</small>
        <nav class="cb-who">${host.partners.map(([id, name, color]) => `<button type="button" data-who="${id}" style="--p:${color}"><i></i>${esc(name)}</button>`).join("")}</nav>
        <div class="cb-cols" id="cb-cols">${host.partners.map(([id, , color]) => `<section class="cb-col" id="cb-col-${id}" style="--p:${color}">${ui.skeleton(2)}</section>`).join("")}</div></section>
      <section class="cc" id="cb-cams" data-pane="cams">
        <div class="cc-main"><div class="cc-feed"><canvas id="cc-main-cv"></canvas><i class="cc-scan"></i>
            <div class="cc-top"><div class="cc-id" id="cc-head"></div><span class="cc-rec"><i></i>REC</span><time id="cc-clock"></time>
              <button type="button" class="cc-auto on" id="cc-auto" data-cam-auto title="${esc(t("Automático: o monitor vai para quem começou a trabalhar por último. Clicar numa câmara fixa-a."))}">AUTO</button></div></div>
          <div class="cc-low" id="cc-low"></div></div>
        <div class="cc-grid">${host.state().agents.map((a) => `<button type="button" class="cc-cam" id="cc-cam-${a.i}" data-cam="${a.i}"><span class="cc-feed"><canvas id="cc-cv-${a.i}"></canvas><i class="cc-scan"></i></span><span class="cc-l" id="cc-l-${a.i}"></span></button>`).join("")}</div>
      </section>
      <aside class="cx-side" data-pane="queue"><small class="cx-k">${esc(t("Missões"))}</small>
        ${composer}
        <div class="cx-box"><small class="cb-k">${esc(t("Na fila"))}</small><div id="cb-queue"></div></div>
        <div class="cx-box"><small class="cb-k">${esc(t("Feito hoje"))}</small><div id="cb-done"></div></div>
      </aside>
      <div class="cb-doors" id="cb-doors" data-pane="now"></div>`;
    showTab(sessionStorage.getItem("cb.tab") || "now");
    showWho(sessionStorage.getItem("cb.who") || mine);
    root.onclick = click;
    root.ondblclick = (e) => { const b = e.target.closest("[data-cam]"); if (b) { hideTip(); host.openAgent(Number(b.dataset.cam)); } };
    root.onmouseover = (e) => { const card = e.target.closest(".cc-cam"); if (!card) hideTip(); else if (tipFor !== host.state().agents[Number(card.dataset.cam)]) showTip(host.state().agents[Number(card.dataset.cam)], card); };
    root.onmouseleave = hideTip;
    fit();
    draw();
    const flashId = sessionStorage.getItem("cb.flash");
    if (flashId) { sessionStorage.removeItem("cb.flash"); setTimeout(() => flashPerson(flashId), 400); }
  }
  window.addEventListener("hashchange", () => { hideTip(); if (sheet) sheet.hidden = true; });
  window.addEventListener("scroll", hideTip, true);
  window.addEventListener("resize", fit);
  return { mount, paint: draw, ficha, roster, hideTip, cams, fit };
})();
