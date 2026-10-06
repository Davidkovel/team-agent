// O Escritório, the visão de Deus (docs/empresa-amg.md): every Claude window on the three PCs, the subagents each one
// launched, and what each of them is doing now, from /api/office (backend/app/routers/office.py), which the Claude Code
// hooks of every PC feed (scripts/claude_hook.py).
// Its own file, fetched the first time the page opens (lazyView in ui.js). Light by rule: it is drawn only when an
// "office" event or the slow tick says something changed, nothing loops forever, and a desk lights up once when its
// line changes. The phone gets the same page in the iOS look (office.css, under html.is-phone).
(function () {
  const DEPTS = [["Pesquisa", "search"], ["Código", "code"], ["Design", "layers"], ["Marketing", "spark"], ["Revisão", "check"],
    ["Empresas", "building"], ["Planeamento", "target"], ["Geral", "bot"]];
  const DEPT_OF = { pesquisador: "Pesquisa", "claude-code-guide": "Pesquisa", explorador: "Código", Explore: "Código", Plan: "Planeamento",
    "revisor-hub": "Revisão", "designer-hub": "Design", marketing: "Marketing", "general-purpose": "Geral" };
  const deptOf = (kind) => DEPT_OF[kind] || (String(kind).startsWith("empresa-") ? "Empresas" : "Geral");
  const deptIcon = (dept) => (DEPTS.find(([d]) => d === dept) || DEPTS[DEPTS.length - 1])[1];
  const STATE = { working: ["A trabalhar", "work"], waiting: ["À tua espera", "wait"], stalled: ["Sem notícias", "stall"], idle: ["Aberto", "idle"], ended: ["Fechado", "off"] };
  const ORDER = { working: 0, waiting: 1, stalled: 2, idle: 3, ended: 4 };
  // "claude-opus-5-5" -> "Opus 5.5", "haiku" -> "Haiku"
  const model = (m) => {
    const name = String(m || "").replace(/^claude-/, "").replace(/-\d{8}$/, "").replace(/-(\d+)-(\d+)$/, " $1.$2").replace(/-(\d+)$/, " $1");
    return name ? name[0].toUpperCase() + name.slice(1) : "";
  };
  const tokens = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k tokens` : n ? `${n} tokens` : "");
  const seen = {}; // desk id -> its line last time, so only a desk that changed lights up

  function agentRow(a) {
    const dept = deptOf(a.kind), working = a.state === "working";
    const end = a.state === "done" ? `${icon("check")}${fmt.span(a.started_at, a.finished_at)}` : a.state === "failed" ? t("falhou") : a.state === "lost" ? t("sem notícias") : t("a trabalhar");
    return `<div class="of-agent ag-${esc(a.state)}">
      <span class="of-ag-ic" title="${esc(t(dept))}">${icon(deptIcon(dept))}</span>
      <div class="of-ag-t"><b>${esc(a.kind)}</b><span class="of-tag">${esc(t(dept))}</span>${a.model ? `<span class="of-model">${esc(model(a.model))}</span>` : ""}
        ${a.description ? `<p>${esc(a.description)}</p>` : ""}
        ${working ? (a.action ? `<span class="of-ag-now">${esc(a.action)}</span>` : "") : a.result ? `<span class="of-ag-res">${esc(a.result)}</span>` : ""}</div>
      <em>${end}${a.tokens ? `<small>${esc(tokens(a.tokens))}</small>` : ""}</em></div>`;
  }

  // ---- the agents' own board. Under each desk they are small lines; here they are the subject: who is running now,
  // for whom and on what, the team's agents and whether each is free, who used what today, and what already finished.
  const ROSTER = [["pesquisador", "Procura informação na web e nos documentos."], ["explorador", "Lê o código e encontra onde está cada coisa."],
    ["revisor-hub", "Revê as mudanças antes de irem para todos."], ["designer-hub", "Desenha as páginas do Hub."], ["marketing", "Textos e ideias para a BareDesk e as escolas."]];
  const owned = (sessions) => sessions.flatMap((s) => s.agents.map((a) => ({ ...a, who: s.name, project: s.project })));
  const byNewest = (a, b) => String(b.finished_at || b.started_at).localeCompare(String(a.finished_at || a.started_at));

  function runCard(a) {
    const dept = deptOf(a.kind);
    return `<article class="of-run"><header><span class="of-run-ic">${icon(deptIcon(dept))}<i></i></span>
        <div><b>${esc(a.kind)}</b><span>${esc(t(dept))}${a.model ? ` · ${esc(model(a.model))}` : ""}</span></div><em>${t("a trabalhar")}</em></header>
      ${a.description ? `<p class="of-run-ask"><small>${t("Pedido")}</small>${esc(a.description)}</p>` : ""}
      <p class="of-run-now"><small>${t("Agora")}</small><span>${esc(a.action || t("a começar…"))}</span></p>
      <footer>${ui.avatar(a.who, "sm")}<span>${t("para")} <b>${esc(a.who)}</b> · ${esc(a.project)}</span><time title="${esc(fmt.hhmm(a.started_at))}">${esc(fmt.ago(a.started_at))}</time></footer></article>`;
  }

  function rosterTile([kind, what], all) {
    const mine = all.filter((a) => a.kind === kind), busy = mine.filter((a) => a.state === "working"), last = [...mine].sort(byNewest)[0];
    const dept = deptOf(kind);
    return `<div class="of-rt ${busy.length ? "busy" : mine.length ? "used" : ""}"><span class="of-rt-ic">${icon(deptIcon(dept))}</span>
      <div><b>${esc(kind)}</b><span>${esc(t(what))}</span>
        <em>${busy.length ? `${t("A trabalhar para")} ${esc([...new Set(busy.map((a) => a.who))].join(", "))}` : t("Livre")}${mine.length
          ? ` · ${t(mine.length === 1 ? "usado 1 vez hoje" : "usado {n} vezes hoje", { n: mine.length })}${last && !busy.length ? ` · ${esc(last.who)} ${esc(fmt.ago(last.finished_at || last.started_at))}` : ""}` : ` · ${t("ainda não usado hoje")}`}</em></div></div>`;
  }

  function doneRow(a) {
    const dept = deptOf(a.kind), bad = a.state === "failed" || a.state === "lost";
    return `<div class="of-dn ${bad ? "bad" : ""}"><span class="of-ag-ic" title="${esc(t(dept))}">${icon(deptIcon(dept))}</span>
      <div><b>${esc(a.kind)}</b>${a.description ? `<span>${esc(a.description)}</span>` : ""}${a.result ? `<p>${esc(a.result)}</p>` : ""}</div>
      <em>${ui.avatar(a.who, "sm")}<small>${esc(a.who)}</small><small>${bad ? t(a.state === "failed" ? "falhou" : "sem notícias") : esc(fmt.span(a.started_at, a.finished_at))}${a.tokens ? ` · ${esc(tokens(a.tokens))}` : ""}</small></em></div>`;
  }

  function boardHtml(sessions) {
    const all = owned(sessions), running = all.filter((a) => a.state === "working").sort(byNewest), over = all.filter((a) => a.state !== "working").sort(byNewest);
    const roster = [...ROSTER, ...[...new Set(all.map((a) => a.kind))].filter((k) => !ROSTER.some(([r]) => r === k)).map((k) => [k, "Agente do Claude Code."])];
    const people = [...new Set(all.map((a) => a.who))].map((who) => {
      const mine = all.filter((a) => a.who === who), kinds = [...new Set(mine.map((a) => a.kind))].map((k) => [k, mine.filter((a) => a.kind === k).length]).sort((x, y) => y[1] - x[1]);
      return `<div class="of-use">${ui.avatar(who)}<div><b>${esc(who)}</b><span>${t(mine.length === 1 ? "1 agente lançado" : "{n} agentes lançados", { n: mine.length })}${mine.some((a) => a.state === "working")
        ? ` · ${mine.filter((a) => a.state === "working").length} ${t("a trabalhar")}` : ""}${mine.reduce((n, a) => n + (a.tokens || 0), 0) ? ` · ${esc(tokens(mine.reduce((n, a) => n + (a.tokens || 0), 0)))}` : ""}</span>
        <p>${kinds.map(([k, n]) => `<i title="${esc(t(deptOf(k)))}">${icon(deptIcon(deptOf(k)))}${esc(k)}<b>${n}</b></i>`).join("")}</p></div></div>`;
    });
    return `<header class="of-bh">${icon("bot")}<b>${t("Agentes")}</b><span>${running.length ? `${running.length} ${t("a trabalhar")}` : t("nenhum a trabalhar agora")}${over.length ? ` · ${over.length} ${t(over.length === 1 ? "acabou hoje" : "acabaram hoje")}` : ""}</span></header>
      ${running.length ? `<div class="of-runs">${running.map(runCard).join("")}</div>`
        : `<p class="of-quiet">${t("Nenhum agente a trabalhar neste momento. Quando um Claude lançar um, aparece aqui em grande: qual é, para quem, o que lhe foi pedido e o que está a fazer.")}</p>`}
      <div class="of-sub">${t("A equipa de agentes")}</div><div class="of-roster">${roster.map((r) => rosterTile(r, all)).join("")}</div>
      ${people.length ? `<div class="of-sub">${t("Quem usou o quê hoje")}</div><div class="of-uses">${people.join("")}</div>` : ""}
      ${over.length ? `<details class="of-over" ${over.length <= 4 ? "open" : ""}><summary>${t(over.length === 1 ? "1 agente acabou hoje" : "{n} agentes acabaram hoje", { n: over.length })}</summary>
        <div class="of-dns">${over.slice(0, 12).map(doneRow).join("")}</div></details>` : ""}`;
  }

  function desk(s) {
    const [label, cls] = STATE[s.state] || STATE.idle;
    const line = `${s.state}|${s.action}|${s.agents.map((a) => a.state + a.action).join()}`;
    const fresh = seen[s.id] !== undefined && seen[s.id] !== line;
    seen[s.id] = line;
    return `<article class="of-desk st-${cls} ${fresh ? "fresh" : ""}">
      <header><span class="of-who">${ui.avatar(s.name)}<i></i></span>
        <div class="of-id"><b>${esc(s.name)}</b><span>${esc(s.project)}${s.model ? ` · ${esc(model(s.model))}` : ""}${s.tokens ? ` · ${esc(tokens(s.tokens))}` : ""}</span></div>
        <em class="of-state">${t(label)}</em></header>
      ${s.prompt ? `<p class="of-ask">“${esc(s.prompt)}”</p>` : ""}
      <div class="of-now">${icon(s.state === "waiting" ? "bell" : s.state === "ended" ? "check" : "bolt")}<span>${esc(s.action && s.action !== "aberto" ? s.action : s.state === "idle" ? t("aberto, à espera de um pedido") : s.action || "—")}</span>
        <time title="${esc(fmt.hhmm(s.since))}">${esc(fmt.ago(s.since))}</time></div>
      ${s.agents.length ? `<div class="of-agents">${s.agents.map(agentRow).join("")}</div>` : ""}</article>`;
  }

  function filmRow(f) {
    const text = f.kind === "agent_start" ? `${f.who} ${t("lançou")} <b>${esc(f.agent)}</b>${f.text ? `: ${esc(f.text)}` : ""}`
      : f.kind === "agent_done" ? `<b>${esc(f.agent)}</b> ${t("acabou")}${f.text ? `: ${esc(f.text)}` : ""}`
      : `${f.who} ${t("abriu um Claude em")} <b>${esc(f.project)}</b>`;
    return `<div class="of-f ${esc(f.kind)}"><time>${esc(fmt.hhmm(f.at))}</time>${ui.avatar(f.who, "sm")}<span>${text}</span></div>`;
  }

  // At most one redraw every 3 s, however many steps the Claudes take: the last one always lands.
  let lastLoad = 0, later = null;
  async function loadOffice() {
    if (!$("of-desks")) return;
    const wait = 3000 - (Date.now() - lastLoad);
    if (wait > 0) { clearTimeout(later); later = setTimeout(loadOffice, wait); return; }
    lastLoad = Date.now();
    const el = $("of-desks");
    const d = await api("/api/office");
    if (!$("of-desks")) return;
    const live = d.sessions.filter((s) => s.state !== "ended").sort((a, b) => ORDER[a.state] - ORDER[b.state] || String(b.updated_at).localeCompare(String(a.updated_at)));
    const closed = d.sessions.filter((s) => s.state === "ended");
    const agents = d.sessions.flatMap((s) => s.agents);
    const count = (state) => live.filter((s) => s.state === state).length;
    const stat = (n, label, cls, ic) => `<div class="of-stat ${n ? `lit ${cls}` : ""}"><span>${icon(ic)}</span><b>${n}</b><small>${t(label)}</small></div>`;
    paint($("of-stats"), stat(count("working"), "Claudes a trabalhar", "work", "bolt") + stat(count("waiting"), "À tua espera", "wait", "bell")
      + stat(agents.filter((a) => a.state === "working").length, "Agentes a trabalhar", "work", "bot") + stat(agents.filter((a) => a.state === "done").length, "Agentes que acabaram hoje", "", "check"));
    paint($("of-depts"), DEPTS.map(([dept, ic]) => {
      const here = agents.filter((a) => deptOf(a.kind) === dept), busy = here.filter((a) => a.state === "working").length;
      return `<div class="of-dept ${busy ? "busy" : here.length ? "used" : ""}" title="${esc(t(dept))}">${icon(ic)}<b>${esc(t(dept))}</b><i>${busy || here.length || ""}</i></div>`;
    }).join(""));
    paint($("of-board"), boardHtml(d.sessions));
    paint(el, live.length ? live.map(desk).join("")
      : ui.empty("bot", "Ninguém a trabalhar agora", "Quando um Claude abrir num dos três PCs, aparece aqui com o que está a fazer e os agentes que lançar."));
    paint($("of-closed"), closed.length ? `<details><summary>${t(closed.length === 1 ? "1 janela fechada hoje" : "{n} janelas fechadas hoje", { n: closed.length })}</summary>
      <div class="of-desks small">${closed.map(desk).join("")}</div></details>` : "");
    paint($("of-film"), d.film.length ? d.film.map(filmRow).join("") : `<p class="faint">${t("O dia ainda não tem filme.")}</p>`);
  }

  HUB_VIEWS.escritorio = async function () {
    page(`${ui.head("Visão de Deus", t("Escritório"), t("Todos os Claudes dos três PCs, os agentes que eles lançaram e o que cada um está a fazer, ao vivo."))}
      <div class="of-stats" id="of-stats"></div>
      <div class="of-depts" id="of-depts"></div>
      <section class="of-board" id="of-board"></section>
      <div class="of-sub of-sub-top">${t("Janelas do Claude")}</div>
      <div class="of-grid">
        <section><div class="of-desks" id="of-desks">${ui.skeleton(5)}</div><div id="of-closed"></div></section>
        <aside class="of-film"><header>${icon("clock")}<b>${t("Filme do dia")}</b></header><div id="of-film"></div></aside>
      </div>`);
    lastLoad = 0;
    await loadOffice();
  };
  onLive(["office", "tick"], () => loadOffice());
})();
