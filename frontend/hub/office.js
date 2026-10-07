// O Escritório, the visão de Deus (docs/empresa-amg.md), drawn as the plan of an office: the Direção on top (a desk per
// person, a screen per Claude window that person has open on their PC), the department rooms below (each subagent sits
// in the room of its department, with the face of whoever sent it), then the agents' own board (the team of agents and
// whether each is free, who used what today, what already finished) and the day's film.
//
// The page first builds the SCENE (officeScene: rooms, desks, screens, occupants, as plain data) and only then draws it.
// The 3D office will draw the very same scene (window.amgOfficeScene), so the 2D and the 3D never disagree.
//
// Data: /api/office (backend/app/routers/office.py, fed by every PC's Claude Code hooks) and /api/team (who is online).
// Light by rule: its own file, loaded when the page opens (lazyView in ui.js); at most one redraw every 3 s; nothing
// loops; a screen or a room lights up once when it changes. The phone gets the same plan in the iOS look (office.css).
(function () {
  const ROOMS = [["pesquisa", "Pesquisa", "search"], ["codigo", "Código", "code"], ["design", "Design", "layers"], ["marketing", "Marketing", "spark"],
    ["revisao", "Revisão", "check"], ["empresas", "Empresas", "building"], ["planeamento", "Planeamento", "target"], ["geral", "Geral", "bot"]];
  const ROOM_OF = { pesquisador: "pesquisa", "claude-code-guide": "pesquisa", explorador: "codigo", Explore: "codigo", Plan: "planeamento",
    "revisor-hub": "revisao", "designer-hub": "design", marketing: "marketing", "general-purpose": "geral" };
  const roomOf = (kind) => ROOM_OF[kind] || (String(kind).startsWith("empresa-") ? "empresas" : "geral");
  const deptOf = (kind) => ROOMS.find(([id]) => id === roomOf(kind))[1];
  const deptIcon = (dept) => (ROOMS.find(([, name]) => name === dept) || ROOMS[ROOMS.length - 1])[2];
  const STATE = { working: ["A trabalhar", "work"], waiting: ["À tua espera", "wait"], stalled: ["Sem notícias", "stall"], idle: ["Aberto", "idle"], ended: ["Fechado", "off"] };
  const ORDER = { working: 0, waiting: 1, stalled: 2, idle: 3, ended: 4 };
  const SHOWN_DONE = 3; // per room: everyone working, and the last few who finished today
  // "claude-opus-5-5" -> "Opus 5.5", "haiku" -> "Haiku"
  const model = (m) => {
    const name = String(m || "").replace(/^claude-/, "").replace(/-\d{8}$/, "").replace(/-(\d+)-(\d+)$/, " $1.$2").replace(/-(\d+)$/, " $1");
    return name ? name[0].toUpperCase() + name.slice(1) : "";
  };
  const tokens = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(".", ",")}M tokens` : n >= 1000 ? `${Math.round(n / 1000)}k tokens` : n ? `${n} tokens` : "");

  /* ---------- the scene: what is where, with no drawing in it ---------- */
  function officeScene(office, team) {
    const desks = team.map((m) => {
      const mine = office.sessions.filter((s) => s.user === m.user);
      return {
        user: m.user, name: m.display_name, online: m.status !== "OFFLINE", where: m.where || [],
        screens: mine.filter((s) => s.state !== "ended").sort((a, b) => ORDER[a.state] - ORDER[b.state] || String(b.updated_at).localeCompare(String(a.updated_at))),
        closed: mine.filter((s) => s.state === "ended"),
      };
    });
    const rooms = ROOMS.map(([id, name, ic]) => ({ id, name, icon: ic, occupants: [] }));
    for (const s of office.sessions) {
      for (const a of s.agents) {
        rooms.find((r) => r.id === roomOf(a.kind)).occupants.push({ ...a, director: s.name, directorUser: s.user, project: s.project, screen: s.id });
      }
    }
    for (const room of rooms) {
      const working = room.occupants.filter((o) => o.state === "working");
      const rest = room.occupants.filter((o) => o.state !== "working").sort((a, b) => String(b.finished_at || b.started_at).localeCompare(String(a.finished_at || a.started_at)));
      room.working = working.length;
      room.today = room.occupants.length;
      room.occupants = [...working, ...rest.slice(0, SHOWN_DONE)];
      room.more = rest.length - Math.min(rest.length, SHOWN_DONE);
    }
    return { desks, rooms, film: office.film };
  }
  window.amgOfficeScene = officeScene;

  /* ---------- drawing the scene ---------- */
  const lit = {}; // what each screen and room said last time: only what changed lights up
  const changed = (key, now) => { const was = lit[key]; lit[key] = now; return was !== undefined && was !== now; };

  function screen(s) {
    const [label, cls] = STATE[s.state] || STATE.idle;
    const now = s.action && s.action !== "aberto" ? s.action : s.state === "idle" ? t("aberto, à espera de um pedido") : s.action || "—";
    const fresh = changed(`s${s.id}`, `${s.state}|${now}`);
    return `<article class="of-screen st-${cls} ${fresh ? "fresh" : ""}">
      <header><b>${esc(s.project)}</b><em>${t(label)}</em></header>
      ${s.prompt ? `<p class="of-ask">“${esc(s.prompt)}”</p>` : ""}
      <div class="of-now">${icon(s.state === "waiting" ? "bell" : "bolt")}<span>${esc(now)}</span><time title="${esc(fmt.hhmm(s.since))}">${esc(fmt.ago(s.since))}</time></div>
      <footer>${[model(s.model), tokens(s.tokens), s.agents.length ? t(s.agents.length === 1 ? "1 agente" : "{n} agentes", { n: s.agents.length }) : ""].filter(Boolean).map(esc).join(" · ")}</footer>
    </article>`;
  }

  function desk(d) {
    const place = d.online ? (d.where.includes("phone") && !d.where.includes("pc") ? t("no telemóvel") : d.where.includes("phone") ? t("no PC e no telemóvel") : t("no computador")) : t("offline");
    return `<section class="of-desk ${d.online ? "on" : "off"} ${d.screens.some((s) => s.state === "working") ? "busy" : ""}">
      <header><span class="of-face">${ui.avatar(d.name)}<i></i></span><div><b>${esc(d.name)}</b><span>${esc(place)}</span></div>
        <em>${d.screens.length ? t(d.screens.length === 1 ? "1 Claude aberto" : "{n} Claudes abertos", { n: d.screens.length }) : t("nenhum Claude aberto")}</em></header>
      <div class="of-screens">${d.screens.map(screen).join("") || `<p class="of-quiet">${t(d.online ? "Secretária livre: quando abrir um Claude, aparece aqui." : "Fora do escritório.")}</p>`}</div>
      ${d.closed.length ? `<p class="of-closed">${t(d.closed.length === 1 ? "1 janela fechada hoje" : "{n} janelas fechadas hoje", { n: d.closed.length })}</p>` : ""}
    </section>`;
  }

  function occupant(o, room) {
    const working = o.state === "working";
    const line = working ? o.action || o.description : o.result || o.description;
    const end = o.state === "done" ? `${icon("check")}${esc(fmt.span(o.started_at, o.finished_at))}` : o.state === "failed" ? t("falhou") : o.state === "lost" ? t("sem notícias") : t("a trabalhar");
    return `<div class="of-occ ag-${esc(o.state)}">
      <span class="of-occ-av">${icon(room.icon)}<i title="${esc(t("Mandado por {quem}", { quem: o.director }))}">${ui.avatar(o.director, "sm")}</i></span>
      <div class="of-occ-t"><b>${esc(o.kind)}</b><span>${esc([o.director, model(o.model), tokens(o.tokens)].filter(Boolean).join(" · "))}</span>
        ${line ? `<p>${esc(line)}</p>` : ""}</div>
      <em>${end}</em></div>`;
  }

  function room(r) {
    const fresh = changed(`r${r.id}`, r.occupants.map((o) => o.id + o.state + o.action).join());
    return `<section class="of-room ${r.working ? "busy" : r.today ? "used" : "empty"} ${fresh ? "fresh" : ""}">
      <header>${icon(r.icon)}<b>${esc(t(r.name))}</b><i>${r.working ? t("{n} a trabalhar", { n: r.working }) : r.today ? t("{n} hoje", { n: r.today }) : ""}</i></header>
      <div class="of-floor">${r.occupants.map((o) => occupant(o, r)).join("") || `<span class="of-empty">${t("sala vazia")}</span>`}
        ${r.more > 0 ? `<span class="of-more">${t("+{n} acabaram hoje", { n: r.more })}</span>` : ""}</div>
    </section>`;
  }

  /* ---------- the agents' own board (Kovel, 6 out): the team of agents and whether each is free, who used what today,
     and what finished. Who is working right now is already in the rooms above, so it is not repeated here. ---------- */
  const ROSTER = [["pesquisador", "Procura informação na web e nos documentos."], ["explorador", "Lê o código e encontra onde está cada coisa."],
    ["revisor-hub", "Revê as mudanças antes de irem para todos."], ["designer-hub", "Desenha as páginas do Hub."], ["marketing", "Textos e ideias para a BareDesk e as escolas."]];
  const owned = (sessions) => sessions.flatMap((s) => s.agents.map((a) => ({ ...a, who: s.name, project: s.project })));
  const byNewest = (a, b) => String(b.finished_at || b.started_at).localeCompare(String(a.finished_at || a.started_at));

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
    const all = owned(sessions), running = all.filter((a) => a.state === "working"), over = all.filter((a) => a.state !== "working").sort(byNewest);
    const roster = [...ROSTER, ...[...new Set(all.map((a) => a.kind))].filter((k) => !ROSTER.some(([r]) => r === k)).map((k) => [k, "Agente do Claude Code."])];
    const people = [...new Set(all.map((a) => a.who))].map((who) => {
      const mine = all.filter((a) => a.who === who), kinds = [...new Set(mine.map((a) => a.kind))].map((k) => [k, mine.filter((a) => a.kind === k).length]).sort((x, y) => y[1] - x[1]);
      return `<div class="of-use">${ui.avatar(who)}<div><b>${esc(who)}</b><span>${t(mine.length === 1 ? "1 agente lançado" : "{n} agentes lançados", { n: mine.length })}${mine.some((a) => a.state === "working")
        ? ` · ${mine.filter((a) => a.state === "working").length} ${t("a trabalhar")}` : ""}${mine.reduce((n, a) => n + (a.tokens || 0), 0) ? ` · ${esc(tokens(mine.reduce((n, a) => n + (a.tokens || 0), 0)))}` : ""}</span>
        <p>${kinds.map(([k, n]) => `<i title="${esc(t(deptOf(k)))}">${icon(deptIcon(deptOf(k)))}${esc(k)}<b>${n}</b></i>`).join("")}</p></div></div>`;
    });
    return `<header class="of-bh">${icon("bot")}<b>${t("Agentes")}</b><span>${running.length ? `${running.length} ${t("a trabalhar, nas salas acima")}` : t("nenhum a trabalhar agora")}${over.length ? ` · ${over.length} ${t(over.length === 1 ? "acabou hoje" : "acabaram hoje")}` : ""}</span></header>
      <div class="of-sub">${t("A equipa de agentes")}</div><div class="of-roster">${roster.map((r) => rosterTile(r, all)).join("")}</div>
      ${people.length ? `<div class="of-sub">${t("Quem usou o quê hoje")}</div><div class="of-uses">${people.join("")}</div>` : ""}
      ${over.length ? `<details class="of-over" ${over.length <= 4 ? "open" : ""}><summary>${t(over.length === 1 ? "1 agente acabou hoje" : "{n} agentes acabaram hoje", { n: over.length })}</summary>
        <div class="of-dns">${over.slice(0, 12).map(doneRow).join("")}</div></details>` : ""}`;
  }

  function filmRow(f) {
    const text = f.kind === "agent_start" ? `${esc(f.who)} ${t("mandou")} <b>${esc(f.agent)}</b> ${t("trabalhar")}${f.text ? `: ${esc(f.text)}` : ""}`
      : f.kind === "agent_done" ? `<b>${esc(f.agent)}</b> ${t("acabou")}${f.text ? `: ${esc(f.text)}` : ""}`
      : `${esc(f.who)} ${t("abriu um Claude em")} <b>${esc(f.project)}</b>`;
    return `<div class="of-f ${esc(f.kind)}"><time>${esc(fmt.hhmm(f.at))}</time>${ui.avatar(f.who, "sm")}<span>${text}</span></div>`;
  }

  // At most one redraw every 3 s, however many steps the Claudes take: the last one always lands.
  let lastLoad = 0, later = null;
  async function loadOffice() {
    if (!$("of-plan")) return;
    const wait = 3000 - (Date.now() - lastLoad);
    if (wait > 0) { clearTimeout(later); later = setTimeout(loadOffice, wait); return; }
    lastLoad = Date.now();
    const [office, team] = await Promise.all([api("/api/office"), api("/api/team")]);
    if (!$("of-plan")) return;
    const scene = officeScene(office, team);
    const screens = scene.desks.flatMap((d) => d.screens), working = scene.rooms.reduce((n, r) => n + r.working, 0);
    const stat = (n, label, cls, ic) => `<div class="of-stat ${n ? `lit ${cls}` : ""}"><span>${icon(ic)}</span><b>${n}</b><small>${t(label)}</small></div>`;
    paint($("of-stats"), stat(screens.filter((s) => s.state === "working").length, "Claudes a trabalhar", "work", "bolt")
      + stat(screens.filter((s) => s.state === "waiting").length, "À tua espera", "wait", "bell")
      + stat(working, "Agentes a trabalhar", "work", "bot") + stat(scene.rooms.reduce((n, r) => n + r.today, 0), "Agentes hoje", "", "users"));
    paint($("of-direction"), scene.desks.map(desk).join(""));
    paint($("of-rooms"), scene.rooms.map(room).join(""));
    paint($("of-board"), boardHtml(office.sessions));
    paint($("of-film"), scene.film.length ? scene.film.slice(0, 14).map(filmRow).join("") : `<p class="faint">${t("O dia ainda não tem filme.")}</p>`);
  }

  HUB_VIEWS.escritorio = async function () {
    page(`${ui.head("Visão de Deus", t("Escritório"), t("A planta da empresa: em cima a Direção, com um ecrã por cada Claude aberto nos três PCs; em baixo as salas, com cada agente a trabalhar no seu departamento."))}
      <div class="of-stats" id="of-stats"></div>
      <div class="of-plan" id="of-plan">
        <div class="of-zone"><span>${t("Direção")}</span></div>
        <div class="of-direction" id="of-direction">${ui.skeleton(3)}</div>
        <div class="of-zone"><span>${t("Departamentos")}</span></div>
        <div class="of-rooms" id="of-rooms"></div>
      </div>
      <section class="of-board" id="of-board"></section>
      <section class="of-film"><header>${icon("clock")}<b>${t("Filme do dia")}</b></header><div id="of-film"></div></section>`);
    lastLoad = 0;
    await loadOffice();
  };
  onLive(["office", "presence", "tick"], () => loadOffice());
})();
