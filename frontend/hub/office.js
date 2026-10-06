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
      <div class="of-grid">
        <section><div class="of-desks" id="of-desks">${ui.skeleton(5)}</div><div id="of-closed"></div></section>
        <aside class="of-film"><header>${icon("clock")}<b>${t("Filme do dia")}</b></header><div id="of-film"></div></aside>
      </div>`);
    lastLoad = 0;
    await loadOffice();
  };
  onLive(["office", "tick"], () => loadOffice());
})();
