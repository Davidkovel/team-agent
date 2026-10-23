// O Escritório: the company's command centre, the page #/escritorio (crew.js is the engine and Empresa AMG).
// What Marco asked of it over time: one screen, clean like an app other companies would use (8-9 Oct); «quero saber quem
// está a trabalhar com quem, o Kovel com o Batman e a prompt» (14 Oct); and on 23 Oct «acaba com a criançada toda»: the
// pixel cameras are gone. On a computer:
// - the head (ui.head) with the day in one sentence, and the two views: Equipa and Departamentos;
// - a strip with the ten departments, the ones at work lit and wider, with what they are doing;
// - Equipa: a column per partner, each job a card that says which department works with them, on what, what was asked in
//   full and what is being done now, with its tokens and how fast they grow;
// - Departamentos: the ten departments as a live grid, the ones at work first;
// - on the right the missions: send one, the queue, what got done today.
// It draws what crew.js hands it (host.state()) and only touches the page where what it shows has changed (paint).
// Nothing animates. On the phone (and in a narrow window) the same page is an app with four tabs (Agora · Departamentos ·
// Sócios · Missões), one partner at a time; a department's sheet comes up from the bottom (crew.js openDept).
window.CrewBoard = (function () {
  let host = null, root = null;
  const open = new Set(), more = new Set();   // what the person opened: a request, a result, the rest of a list
  let mtab = sessionStorage.getItem("cb.mtab") || "";   // the missions' half shown on a computer; until chosen, the queue when it has something
  let view = sessionStorage.getItem("cb.view") === "depts" ? "depts" : "team";   // a computer's view: the partners' columns or the departments
  const TABS = [["now", "Agora"], ["depts", "Departamentos"], ["people", "Sócios"], ["queue", "Missões"]];
  const SHOW_DONE = 8, DAY = 24 * 3600e3;

  const ago = (iso) => (iso ? fmt.ago(iso) : "");
  const model = (m) => { const x = String(m || "").match(/opus|sonnet|haiku|fable/i); return x ? x[0][0].toUpperCase() + x[0].slice(1).toLowerCase() : ""; };
  const tok = (n) => (n > 0 ? (n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(".", ",")}M` : `${Math.max(1, Math.round(n / 1e3))}k`) + " tokens" : "");
  const flip = (set, id) => (set.has(id) ? set.delete(id) : set.add(id));
  // The tokens each one is spending (Marco, 14 Oct): a window's tokens with its subagents', and how fast they grow, from
  // what this page saw of them in the last three minutes (the Hub reads them every ten seconds while the window works).
  const seen = new Map();   // window id -> [[ms, tokens], ...]
  const tokensOf = (s) => (s.tokens || 0) + (s.agents || []).reduce((n, a) => n + (a.tokens || 0), 0);
  function burn(id, n) {
    const now = Date.now(), h = seen.get(id) || [];
    if (!h.length || h[h.length - 1][1] !== n) h.push([now, n]);
    while (h.length > 2 && now - h[1][0] > 180e3) h.shift();
    seen.set(id, h);
    const [t0, n0] = h[0];
    return now - t0 >= 30e3 && n > n0 ? Math.round((n - n0) / ((now - t0) / 60e3)) : 0;   // tokens a minute, once there is half a minute to go by
  }
  const perMin = (r) => (r > 0 ? `+${tok(r).replace(" tokens", "")}/min` : "");
  const sameDay = (iso) => !!iso && new Date(iso).toDateString() === new Date().toDateString();
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
  // The goal of a window, in a few words: the topic the Hub gives it, the first sentence of the person's latest request
  // (Claude Code's own title of the conversation never follows a change of subject); then that title, then the prompt.
  const goalOf = (s) => s.topic || s.title || sentence(asked(s)) || t("Claude em {p}", { p: s.project });
  const jobGoal = (j) => j.goal || sentence(j.title, 90) || j.title || "";
  // The automatic agent's heartbeat sets these; ONLINE is only the widget or a page open. Another PC's agent is not seen
  // from here (presence does not travel by sync), so of the others nothing is said unless their agent shows up.
  const AGENT_ON = ["WORKING", "IDLE", "WAITING", "PAUSED", "ERROR"];
  const agentOn = (m) => !!m && AGENT_ON.includes(m.status);
  const lit = (a) => { const tone = host.tone(host.stateOf(a)); return a.job ? (tone === "ok" ? "on" : tone) : ""; };
  const KIND = { task: "Tarefa do Hub", claude: "Janela do Claude Code", sub: "Subagente de um Claude", etsy: "Fábrica Etsy" };

  // ---------------------------------------------------------------- what there is to say, partner by partner
  function build(s) {
    const now = Date.now(), mine = host.partnerOf(me.display_name).id;
    const onJob = (key) => s.agents.find((a) => a.job && a.job.key === key) || null;
    const dept = (id) => s.agents.find((a) => a.id === id) || null;
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
        const it = { kind: "task", id: "t" + x.id, x, agent: onJob("t" + x.id) || dept(x.crew), goal: x.title, at: x.started_at || x.created_at, p };
        if (x.status === "IN_PROGRESS") p.working.push(it);
        else if (["WAITING_APPROVAL", "NEEDS_HELP", "PAUSED"].includes(x.status)) p.needs.push(it);
        else if (x.status === "ASSIGNED" || (x.status === "TODO" && x.crew)) p.queue.push({ ...it, held: x.status === "TODO", at: x.created_at });
        else if (x.crew && x.status === "COMPLETED" && x.completed_at && now - Date.parse(x.completed_at) < DAY) p.done.push({ ...it, at: x.completed_at });
        else if (x.crew && ["FAILED", "STOPPED"].includes(x.status) && now - Date.parse(x.started_at || x.created_at) < DAY) p.done.push({ ...it, bad: true });
      }
      const newest = (a, b) => String(b.at).localeCompare(String(a.at));
      p.working.sort(newest); p.needs.sort(newest); p.done.sort(newest);
      p.tokens = 0; p.burn = 0;
      for (const x of s.office.sessions || []) {
        if (host.partnerOf(x.name).id !== id) continue;
        const n = tokensOf(x), r = burn("c" + x.id, n);
        if (sameDay(x.updated_at)) p.tokens += n;
        if (x.state === "working") p.burn += r;
      }
      p.queue.sort((a, b) => (a.held ? 1 : 0) - (b.held ? 1 : 0) || String(a.at).localeCompare(String(b.at)));   // those already given first, oldest first
      return p;
    });
  }

  // ---------------------------------------------------------------- pieces
  // which department works with the partner on this job, at the top of its card (a click opens its sheet), or, for a
  // Claude window no department stands for, the window itself; then the state and how long it has been going
  function pair(it, word, tone) {
    const a = it.agent, when = `${word ? `<em class="cb-st ${tone}"><i></i>${esc(word)}</em>` : ""}<time>${esc(ago(it.at))}</time>`;
    const kind = t(it.kind === "task" ? KIND.task : it.agent && it.agent.job && it.agent.job.type === "sub" ? KIND.sub : KIND.claude);
    if (!a) return `<div class="cb-pair">${host.mono(null, "sm")}<div><b>Claude</b><span>${esc(kind)}</span></div>${when}</div>`;
    return `<div class="cb-pair"><button type="button" class="cb-pair-a" data-dept="${a.id}" title="${esc(t("Abrir {n}", { n: a.name }))}">${host.mono(a, `sm ${lit(a) || (it.kind === "task" ? "" : "")}`)}</button>
      <div><b>${esc(a.name)}</b><span>${esc(kind)}</span></div>${when}</div>`;
  }
  function chips(skills, subs) {
    const all = [...(skills || []).map((k) => `<span class="cb-chip" title="/${esc(k)}">${esc(skill(k))}</span>`), ...(subs || []).map((k) => `<span class="cb-chip is-sub">${esc(k)}</span>`)];
    return all.length ? `<div class="cb-chips">${all.join("")}</div>` : "";
  }
  // The request behind a goal, in full sentences (Marco, 14 Oct: "nem completas umas frases"): its first lines on the
  // card, all of it with a click. Nothing when the goal already says all of it.
  function askLine(it) {
    const s = it.s, whole = s.request || asked(s);
    if (!whole) return "";
    const flat = whole.replace(/\s+/g, " ").trim(), goal = it.goal.replace(/…$/, "");
    if (flat.length <= goal.length + 3 && same(flat, goal)) return "";
    const isOpen = open.has(it.id);
    return `<button type="button" class="cb-ask ${isOpen ? "open" : ""}" data-toggle="${it.id}" title="${esc(t(isOpen ? "Mostrar menos" : "Ver o pedido inteiro"))}"><small>${esc(t("Pediu"))}</small><span>${esc(whole)}</span></button>`;
  }
  function spent(it) {
    const n = tokensOf(it.s), r = burn(it.id, n);
    return n ? `<span class="cb-burn ${r ? "on" : ""}" title="${esc(t("Tokens desta janela do Claude e dos subagentes dela"))}">${esc(tok(n))}${r ? `<i>${esc(perMin(r))}</i>` : ""}</span>` : "";
  }
  function workCard(it) {
    if (it.kind === "task") {
      const x = it.x;
      return `<article class="cb-card is-work">${pair(it, "", "ok")}<h4>${esc(x.title)}</h4>
        ${x.current_action ? `<p class="cb-doing"><small>${esc(t("Agora"))}</small>${esc(x.current_action)}</p>` : ""}
        ${x.progress > 0 ? `<span class="cb-bar"><i style="width:${Math.min(100, x.progress)}%"></i></span>` : ""}
        <div class="cb-foot"><small>${esc(x.progress > 0 ? t("{n}% feito", { n: Math.min(100, x.progress) }) : "")}</small><button type="button" class="cb-link" data-href="#task-${x.id}">${esc(t("Abrir"))}${icon("chevron")}</button></div></article>`;
    }
    const s = it.s, subs = (s.agents || []).filter((x) => x.state === "working").map((x) => x.kind);
    return `<article class="cb-card is-work">${pair(it, "", "ok")}<h4>${esc(it.goal)}</h4>
      ${askLine(it)}${s.action ? `<p class="cb-doing"><small>${esc(t("Agora"))}</small>${esc(s.action)}</p>` : ""}${chips(s.skills, subs)}
      <div class="cb-foot"><small>${esc([s.project, model(s.model)].filter(Boolean).join(" · "))}</small>${spent(it)}</div></article>`;
  }
  function needCard(it, p) {
    if (it.kind === "task") {
      const x = it.x, tone = x.status === "NEEDS_HELP" ? "bad" : x.status === "PAUSED" ? "idle" : "warn";
      const why = x.status === "WAITING_APPROVAL" ? t("À espera de aprovação") : x.status === "NEEDS_HELP" ? t("Precisa de ajuda") : t("Em pausa");
      return `<article class="cb-card is-need tone-${tone}">${pair(it, why, tone)}
        <h4>${esc(x.title)}</h4>${x.blocked_reason ? `<p class="cb-why">${esc(x.blocked_reason)}</p>` : ""}
        <div class="cb-foot"><small></small><button type="button" class="cb-link" data-href="${x.status === "WAITING_APPROVAL" ? "#/aprovacoes" : `#task-${x.id}`}">${esc(t(x.status === "WAITING_APPROVAL" ? "Aprovar" : "Abrir"))}${icon("chevron")}</button></div></article>`;
    }
    const s = it.s;
    const why = s.wait === "permission" ? (p.me ? t("Precisa da tua autorização para continuar") : t("Precisa da autorização do {n} para continuar", { n: p.name }))
      : (p.me ? t("Fez-te uma pergunta e espera a resposta") : t("Fez uma pergunta ao {n} e espera a resposta", { n: p.name }));
    return `<article class="cb-card is-need tone-warn">${pair(it, t(s.wait === "permission" ? "Autorização" : "Pergunta"), "warn")}
      <h4>${esc(it.goal)}</h4><p class="cb-why">${esc(why)}</p>${askLine(it)}
      <div class="cb-foot"><small>${esc([s.project, model(s.model)].filter(Boolean).join(" · "))}</small></div></article>`;
  }
  function doneRow(it) {
    const isOpen = open.has(it.id);
    let text, extra = "";
    if (it.kind === "task") {
      const x = it.x;
      text = x.result || t(it.bad ? "Parou sem acabar." : "Concluída.");
      if (isOpen) extra = `<span class="cb-x">${it.agent ? `${esc(it.agent.name)} · ` : ""}<u data-href="#task-${x.id}">${esc(t("abrir a tarefa"))}</u></span>`;
    } else {
      const s = it.s, whole = s.request || asked(s);
      text = s.result || t(it.quiet ? "Parou sem dizer que acabou." : s.state === "ended" ? "Janela fechada." : "Acabou.");
      if (isOpen) extra = `${whole ? `<span class="cb-x"><i>${esc(t("Pediu"))}</i> ${esc(whole)}</span>` : ""}<span class="cb-x">${esc([s.project, model(s.model), tok(s.tokens),
        (s.agents || []).length ? t((s.agents || []).length === 1 ? "1 subagente" : "{n} subagentes", { n: s.agents.length }) : "", ...(s.skills || []).map(skill)].filter(Boolean).join(" · "))}</span>`;
    }
    return `<div class="cb-done ${isOpen ? "open" : ""} ${it.bad ? "bad" : ""}" data-toggle="${it.id}" role="button" tabindex="0"><i class="cb-tick">${icon(it.bad ? "x" : "tick")}</i>
      <div><b>${esc(it.goal)}</b><p>${esc(text)}</p>${extra}</div><span class="cb-done-r"><em>${esc(it.p.name)}</em><time>${esc(ago(it.at))}</time>${carryOn(it)}</span></div>`;
  }
  // «Continuar» (Marco, 14 Oct: «quando digo continuar a fazer o que estavas a fazer, tu já devias ir ver no widget aquilo
  // que foi feito... uma opção de prompt»): on your own windows, a prompt for a new Claude window that points it at
  // scripts/continuar.py, which reads that window's transcript on this PC and says what was asked, done and left halfway
  const carryOn = (it) => (it.kind === "claude" && it.p.me && it.s.key ? `<button type="button" class="cb-cont" data-continue="${it.s.id}" title="${esc(t("Copia um prompt para uma janela nova do Claude continuar este trabalho sozinha"))}">${icon("play")}${esc(t("Continuar"))}</button>` : "");
  function carryPrompt(s) {
    const when = s.updated_at ? new Date(s.updated_at).toLocaleString("pt-PT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
    return `Continua o trabalho da janela do Claude «${goalOf(s)}» (${[s.project, when].filter(Boolean).join(", ")}). `
      + `Antes de mais nada corre \`python scripts/continuar.py ${s.key.slice(0, 8)}\` na pasta Desktop\\team-agent: diz o que pedi, `
      + "o que ficou feito e o que ficou a meio. Depois acaba o que faltar, sem me perguntar, e publica como de costume.";
  }
  function copyText(text) {
    const box = document.createElement("textarea");   // the widget's page and plain http have no clipboard.writeText
    box.value = text; box.readOnly = true; box.style.cssText = "position:fixed;top:0;left:0;opacity:0";
    document.body.appendChild(box); box.select();
    const ok = document.execCommand("copy"); box.remove();
    return ok;
  }
  function queueRow(it, i, p, s) {
    const x = it.x, a = it.agent, m = (s.team || []).find((u) => u.user === x.assignee), on = agentOn(m);
    const why = it.held ? t("Em espera: arranca quando a mandares")
      : !on && p.me ? t("À espera do teu agente automático, que está desligado")
      : !on ? t("À espera do agente automático do {n}", { n: p.name })
      : x.current_action ? x.current_action : i ? t("À espera de vez") : t("É a seguinte");
    return `<div class="cb-q ${it.held ? "held" : ""}"><span class="cb-pos">${i + 1}</span>${a ? host.mono(a, "xs") : ""}
      <div><b data-href="#task-${x.id}">${esc(x.title)}</b><small>${a ? `${esc(a.name)} · ` : ""}${esc(why)}</small></div>
      ${it.held ? `<button type="button" class="btn sm" data-release="${x.id}">${esc(t("Arrancar"))}</button>` : ""}</div>`;
  }
  // a partner: who, where they are and how much Claude they have left (the top of their column)
  function personHead(p) {
    const m = p.m || {}, on = m.status && m.status !== "OFFLINE", where = m.where || [];
    const place = !on ? (m.last_seen ? t("offline · visto {q}", { q: ago(m.last_seen) }) : t("offline"))
      : where.includes("phone") && !where.includes("pc") ? t("online no telemóvel") : t("online no computador");
    const bar = (label, pct) => (pct == null ? "" : `<div class="cx-lim"><span>${esc(t(label))}</span><i><b class="${pct >= 90 ? "bad" : pct >= 70 ? "warn" : ""}" style="width:${Math.min(100, pct)}%"></b></i><em>${Math.round(pct)}%</em></div>`);
    const lim = p.limits ? bar("Claude 5 h", p.limits.five) + bar("Semana", p.limits.week) : "";
    const n = p.working.length, head = n ? t(n === 1 ? "1 a trabalhar" : "{n} a trabalhar", { n }) : p.needs.length ? t(p.me ? "à tua espera" : "à espera dele") : t("nada a correr");
    const spend = p.tokens ? `<div class="cx-spend ${p.burn ? "on" : ""}"><span>${esc(t("Hoje"))}</span><b>${esc(tok(p.tokens))}</b>${p.burn ? `<em>${esc(t("a gastar {r}", { r: perMin(p.burn) }))}</em>` : ""}</div>` : "";
    const who = `<span class="cx-face">${ui.avatar(p.name)}<i class="${on ? "on" : ""}"></i></span><div><b>${esc(p.name)}${p.me ? ` <small>${esc(t("tu"))}</small>` : ""}</b><span>${esc(place)}</span></div>`;
    return `<header>${who}${n || p.needs.length ? `<em class="${n ? "on" : ""}">${esc(head)}</em>` : ""}</header>${lim || spend ? `<div class="cx-lims">${lim}${spend}</div>` : ""}`;
  }
  const lastLine = (p) => `<p class="cb-quiet">${p.done[0] ? esc(t("Acabou «{g}» {q}.", { g: p.done[0].goal, q: ago(p.done[0].at) })) : esc(t("Nada a correr agora."))}</p>`;
  function personCard(p) {
    const live = p.working.map(workCard).join("") + p.needs.map((it) => needCard(it, p)).join("");
    const facts = [p.done.length ? t(p.done.length === 1 ? "1 feita hoje" : "{n} feitas hoje", { n: p.done.length }) : "",
      p.queue.length ? t(p.queue.length === 1 ? "1 na fila" : "{n} na fila", { n: p.queue.length }) : "",
      agentOn(p.m) ? t("agente automático ligado") : p.me ? t("agente automático desligado") : ""].filter(Boolean);
    return `${personHead(p)}<div class="cb-col-body">${live || lastLine(p)}
      ${p.idle ? `<p class="cb-idle">${esc(t(p.idle === 1 ? "1 janela do Claude aberta, sem pedido" : "{n} janelas do Claude abertas, sem pedido", { n: p.idle }))}</p>` : ""}</div>
      ${facts.length ? `<footer>${facts.map((f) => `<span>${esc(f)}</span>`).join("")}</footer>` : ""}`;
  }
  // the company in one sentence
  function summary(people) {
    const n = (k) => people.reduce((sum, p) => sum + p[k].length, 0), working = people.filter((p) => p.working.length).map((p) => p.name);
    const lead = working.length ? t(n("working") === 1 ? "1 trabalho a correr para {a}" : "{n} trabalhos a correr para {a}", { n: n("working"), a: (working.length === 1 ? "o " : "") + working.join(working.length === 2 ? " e o " : ", ") })
      : t("Ninguém a trabalhar agora");
    return [lead, n("needs") ? t(n("needs") === 1 ? "1 à espera de alguém" : "{n} à espera de alguém", { n: n("needs") }) : "",
      n("queue") ? t("{n} na fila", { n: n("queue") }) : "", t(n("done") === 1 ? "1 feita hoje" : "{n} feitas hoje", { n: n("done") })].filter(Boolean).join(" · ") + ".";
  }
  function nums(people) {
    const n = (k) => people.reduce((sum, p) => sum + p[k].length, 0);
    const tile = (num, label, tone) => `<div class="cb-num ${num ? `tone-${tone}` : ""}"><b>${num}</b><span>${esc(t(label))}</span></div>`;
    return tile(n("working"), "a trabalhar", "ok") + tile(n("needs"), "à espera", "warn") + tile(n("queue"), "na fila", "lit") + tile(n("done"), "feitas hoje", "lit");
  }
  // the day in one line per partner (the phone's first tab)
  function sayList(people) {
    return people.map((p) => {
      let line;
      if (p.working.length) {
        const w = p.working[0], a = w.agent;
        line = `${esc(t("está com"))} <q>${esc(w.goal)}</q>${a ? ` <em>${esc(a.name)}</em>` : ""}${p.working.length > 1 ? ` ${esc(t("e mais {n}", { n: p.working.length - 1 }))}` : ""}`;
      } else if (p.needs.length) line = `${esc(t("tem"))} <q>${esc(p.needs[0].goal)}</q> ${esc(t(p.me ? "à tua espera" : "à espera dele"))}`;
      else if (p.done.length) line = `${esc(t("acabou"))} <q>${esc(p.done[0].goal)}</q> <em>${esc(ago(p.done[0].at))}</em>`;
      else line = esc(t("sem nada a correr"));
      return `<li>${ui.avatar(p.name)}<span><b>${esc(p.name)}</b> ${line}</span></li>`;
    }).join("");
  }
  function queuePane(people, s) {
    if (!people.some((p) => p.queue.length)) return `<p class="cb-quiet">${esc(t("Nada na fila. «Pôr na fila» guarda uma tarefa já com o departamento certo, até a mandares arrancar."))}</p>`;
    return people.filter((p) => p.queue.length).map((p) => `<div class="cb-grp"><small class="cb-k">${esc(p.name)}</small>${p.queue.map((it, i) => queueRow(it, i, p, s)).join("")}</div>`).join("");
  }
  function donePane(people) {
    const all = people.flatMap((p) => p.done).sort((a, b) => String(b.at).localeCompare(String(a.at)));
    if (!all.length) return `<p class="cb-quiet">${esc(t("Ainda nada acabado hoje."))}</p>`;
    const every = more.has("done"), shown = every ? all : all.slice(0, SHOW_DONE);
    return shown.map(doneRow).join("") + (all.length > SHOW_DONE ? `<button type="button" class="cb-more" data-more="done">${esc(every ? t("Mostrar menos") : t("Mais {n}", { n: all.length - SHOW_DONE }))}</button>` : "");
  }

  // ---------------------------------------------------------------- the departments
  // the strip: the ten in a row (two on a laptop), the ones at work lit and wider, with their goal in one line
  function strip(s) {
    return s.agents.map((a) => {
      const st = host.stateOf(a), j = a.job, wq = host.waitingFor(a).length;
      const line = j ? jobGoal(j) : wq ? t(wq === 1 ? "1 na fila" : "{n} na fila", { n: wq }) : t("Livre");
      return `<button type="button" class="cb-dep st-${st} ${j ? "busy" : ""}" data-dept="${a.id}" title="${esc(`${a.n} · ${a.name}: ${t(a.what)}`)}">${host.mono(a, `sm ${lit(a)}`)}
        <span class="cb-dep-t"><b>${esc(a.name)}</b><span>${esc(line)}</span></span>${j ? `<em>${esc(host.partnerOf(j.who).name || j.who)}</em>` : ""}</button>`;
    }).join("");
  }
  // the grid: every department as a tile, those at work first, with what they do now and for whom
  function deptGrid(s) {
    const order = [...s.agents].sort((p, q) => (p.job ? 0 : 1) - (q.job ? 0 : 1) || p.i - q.i);
    return order.map((a) => {
      const st = host.stateOf(a), j = a.job, tone = host.tone(st);
      const head = `<header>${host.mono(a, `md ${lit(a)}`)}<div><b>${esc(a.name)}</b><small>${a.n} · <em class="cb-st ${tone}"><i></i>${esc(t(host.word(st)))}</em></small></div></header>`;
      if (!j) {
        const last = host.doneBy(a)[0], wq = host.waitingFor(a).length;
        return `<article class="cb-tile free" data-dept="${a.id}" role="button" tabindex="0">${head}<p class="cb-tile-what">${esc(t(a.what))}</p>
          <footer><small>${esc(wq ? t(wq === 1 ? "1 tarefa na fila" : "{n} tarefas na fila", { n: wq }) : last ? t("Última {q}", { q: ago(last.completed_at) }) : t("Pronto para trabalhar"))}</small>
          <button type="button" class="cb-link" data-ask="${a.id}">${esc(t("Pedir tarefa"))}${icon("chevron")}</button></footer></article>`;
      }
      const who = host.partnerOf(j.who);
      return `<article class="cb-tile tone-${tone}" data-dept="${a.id}" role="button" tabindex="0">${head}<h4>${esc(jobGoal(j))}</h4>
        <p class="cb-doing"><small>${esc(t("Agora"))}</small>${esc(j.action || t("a pensar…"))}</p>
        <footer><small>${esc([t(KIND[j.type] || ""), j.project].filter(Boolean).join(" · "))}</small><span class="cb-for">${ui.avatar(who.name || j.who)}${esc([who.name || j.who, j.since ? ago(j.since) : "", j.tokens ? tok(j.tokens) : ""].filter(Boolean).join(" · "))}</span></footer></article>`;
    }).join("");
  }
  // the quiet ways out at the bottom of the missions
  function doors(s) {
    const link = (attr, ic, label) => `<button type="button" class="cb-door" ${attr}>${icon(ic)}<span>${esc(t(label))}</span></button>`;
    return link('data-href="#/empresa"', "grid", "Empresa AMG") + link('data-href="#/skills"', "layers", "Skills")
      + link('data-href="#/memoria"', "note", s.memory ? t("Memória · {n}", { n: s.memory.length }) : "Memória") + link("data-meet", "spark", "Reunião");
  }
  // the next US release and how gold reacted to it, from the trading room (one request a minute, only while the office is open)
  let news = null, newsAt = 0;
  function newsLine() {
    if (Date.now() - newsAt > 60000) {
      newsAt = Date.now();
      api("/api/trading-room/reaction").then((x) => { const had = JSON.stringify(news); news = x; if (JSON.stringify(x) !== had) draw(); }).catch(() => {});
    }
    if (!news || !news.key) return "";
    const g = (news.table || {}).BELOW && news.table.BELOW.GOLD, d = news.t && new Date(news.t);
    const when = !d ? t("sem data esta semana") : d <= new Date() ? t("já saiu") : d.toLocaleDateString("pt-PT", { weekday: "short" }) + " " + d.toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });
    const short = { cpi: "CPI", nfp: "NFP", ppi: "PPI", retail: "Vendas EUA", pce: "PCE", fomc: "Fed" }[news.key] || news.name;
    return `<button type="button" class="cb-news" data-href="#/trading">${icon("calendar")}<span><b>${esc(short)}</b> ${esc(when)}${g ? ` · ${esc(t("se sair abaixo, ouro {p}", { p: `${g.avg >= 0 ? "+" : ""}${String(g.avg.toFixed(2)).replace(".", ",")}%` }))}` : ""}</span></button>`;
  }

  // ---------------------------------------------------------------- the page
  function draw() {
    if (!root || !root.isConnected) return;
    const s = host.state();
    paint($("cb-strip"), strip(s));
    paint($("cb-depts"), deptGrid(s));
    paint($("cb-doors"), doors(s) + newsLine());
    if (!host.ready()) return;   // before the Hub has answered there is nothing true to say: the page waits
    const people = build(s);
    paint($("cx-sum"), esc(summary(people)));
    paint($("cb-nums"), nums(people));
    paint($("cb-say"), sayList(people));
    for (const p of people) paint($(`cb-col-${p.id}`), personCard(p));
    paint($("cb-queue"), queuePane(people, s));
    paint($("cb-done"), donePane(people));
    const waiting = people.reduce((n, p) => n + p.queue.length, 0), done = people.reduce((n, p) => n + p.done.length, 0), seg = root.querySelector('.cb-seg [data-tab="queue"]');
    if (seg) seg.textContent = waiting ? `${t("Missões")} · ${waiting}` : t("Missões");
    paint($("cb-nq"), waiting ? String(waiting) : "");
    paint($("cb-nd"), done ? String(done) : "");
    $("cb-side").dataset.m = mtab || (waiting ? "queue" : "done");
    root.querySelectorAll(".cx-mtabs [data-mtab]").forEach((b) => b.classList.toggle("on", b.dataset.mtab === $("cb-side").dataset.m));
  }
  // On a computer the command centre takes exactly the height of the window: no long page, each column scrolls inside.
  function fit() {
    if (!root || !root.isConnected) return;
    const desk = !document.documentElement.classList.contains("is-phone") && root.clientWidth >= 760;
    root.classList.toggle("desk", desk);
    root.classList.toggle("tabbed", !desk);   // a narrow window gets the phone's four tabs: one thing at a time instead of everything squeezed
    const pad = (parseFloat(getComputedStyle($("view")).paddingBottom) || 0) + 6;
    root.style.height = desk ? `${Math.max(480, window.innerHeight - root.getBoundingClientRect().top - pad)}px` : "";   // the widget's window can be 480 high
  }
  function showTab(id) {
    if (!TABS.some(([k]) => k === id)) id = "now";
    root.dataset.tab = id; sessionStorage.setItem("cb.tab", id);
    root.querySelectorAll(".cb-seg [data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === id));
  }
  // a computer's two views: the partners' columns (who works with whom) or the departments
  function showView(id) {
    view = id === "depts" ? "depts" : "team";
    root.dataset.view = view; sessionStorage.setItem("cb.view", view);
    root.querySelectorAll(".cx-view [data-view]").forEach((b) => { b.classList.toggle("on", b.dataset.view === view); b.setAttribute("aria-pressed", String(b.dataset.view === view)); });
  }
  function showWho(id) {
    $("cb-cols").dataset.who = id; sessionStorage.setItem("cb.who", id);
    root.querySelectorAll(".cb-who [data-who]").forEach((b) => b.classList.toggle("on", b.dataset.who === id));
  }
  function click(e) {
    const at = (sel) => e.target.closest(sel);
    let b;
    if ((b = at(".cb-seg [data-tab]"))) { showTab(b.dataset.tab); window.scrollTo({ top: 0 }); }
    else if ((b = at(".cb-who [data-who]"))) showWho(b.dataset.who);
    else if ((b = at(".cx-view [data-view]"))) showView(b.dataset.view);
    else if ((b = at("[data-continue]"))) {
      e.stopPropagation();
      const s = (host.state().office.sessions || []).find((x) => String(x.id) === b.dataset.continue);
      const ok = s && copyText(carryPrompt(s));
      if (typeof flash === "function") flash(t(ok ? "Prompt copiado: abre uma janela nova do Claude e cola (Ctrl+V)." : "Não deu para copiar o prompt."));
    }
    else if ((b = at("[data-release]"))) host.release(Number(b.dataset.release), b);
    else if ((b = at("[data-mini]"))) host.openMini();
    else if ((b = at("[data-ask]"))) host.ask(b.dataset.ask);
    else if ((b = at("[data-href]"))) location.hash = b.dataset.href;
    else if ((b = at("[data-meet]"))) host.meet(b);
    else if ((b = at("[data-mtab]"))) { mtab = b.dataset.mtab; sessionStorage.setItem("cb.mtab", mtab); draw(); }
    else if ((b = at("[data-more]"))) { flip(more, b.dataset.more); draw(); }
    else if ((b = at("[data-toggle]"))) { flip(open, b.dataset.toggle); draw(); }
    else if ((b = at("[data-dept]"))) host.openDept(b.dataset.dept);
  }
  // composer: the form to send a task (crew.js writes it and binds it): the top of the missions' column
  function mount(el, h, composer = "") {
    host = h; root = el;
    const mine = host.partnerOf(me.display_name).id || host.partners[0][0];
    root.innerHTML = `<nav class="cb-seg" aria-label="${esc(t("Escritório"))}">${TABS.map(([id, label]) => `<button type="button" data-tab="${id}">${esc(t(label))}</button>`).join("")}</nav>
      <div class="cb-head" data-pane="now">${ui.head("", t("Escritório"), t("A ler o que a empresa está a fazer…"),
        `<nav class="cx-view" aria-label="${esc(t("Vista"))}"><button type="button" data-view="team">${icon("users")}${esc(t("Equipa"))}</button><button type="button" data-view="depts">${icon("grid")}${esc(t("Departamentos"))}</button></nav>
         <button type="button" class="btn quiet" data-mini title="${esc(t("A lista dos departamentos numa janela pequena, por cima do que estiveres a fazer"))}">${icon("pip")}${esc(t("Mini janela"))}</button>`)}</div>
      <div class="cb-nums" id="cb-nums" data-pane="now"></div>
      <ul class="cb-say" id="cb-say" data-pane="now"></ul>
      <section class="cb-strip" id="cb-strip" data-pane="now" aria-label="${esc(t("Departamentos"))}"></section>
      <section class="cx-people" data-pane="people">
        <nav class="cb-who">${host.partners.map(([id, name]) => `<button type="button" data-who="${id}">${esc(name)}</button>`).join("")}</nav>
        <div class="cb-cols" id="cb-cols">${host.partners.map(([id]) => `<section class="cb-col" id="cb-col-${id}">${ui.skeleton(3)}</section>`).join("")}</div></section>
      <section class="cb-depts" id="cb-depts" data-pane="depts" aria-label="${esc(t("Departamentos ao vivo"))}"></section>
      <aside class="cx-side" id="cb-side" data-pane="queue"><h2 class="cx-k">${esc(t("Missões"))}</h2>
        ${composer}
        <nav class="cx-mtabs"><button type="button" data-mtab="queue">${esc(t("Na fila"))}<b id="cb-nq"></b></button><button type="button" data-mtab="done">${esc(t("Feito hoje"))}<b id="cb-nd"></b></button></nav>
        <div class="cx-box" data-m="queue"><small class="cb-k">${esc(t("Na fila"))}</small><div id="cb-queue"></div></div>
        <div class="cx-box" data-m="done"><small class="cb-k">${esc(t("Feito hoje"))}</small><div id="cb-done"></div></div>
        <div class="cb-doors" id="cb-doors"></div>
      </aside>`;
    const sum = root.querySelector(".cb-head .ph p");
    if (sum) sum.id = "cx-sum";
    showTab(sessionStorage.getItem("cb.tab") || "now");
    showView(view);
    showWho(sessionStorage.getItem("cb.who") || mine);
    root.onclick = click;
    root.onkeydown = (e) => { if ((e.key === "Enter" || e.key === " ") && e.target.matches(".cb-tile, .cb-done")) { e.preventDefault(); e.target.click(); } };
    draw();
    fit();
    if (sized) sized.disconnect();
    sized = new ResizeObserver(() => fit());   // the sidebar folding changes the room without the window changing
    sized.observe($("view"));
  }
  let sized = null;
  window.addEventListener("resize", fit);
  return { mount, paint: draw, fit };
})();
