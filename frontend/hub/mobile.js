// The phone: the Hub as an iOS app. A bar on top, tabs at the bottom (Início, Tarefas, Empresa, Avisos, Trabalho, Mais) and a screen for each,
// instead of the computer's single long page. mobile.css shows all of it only under html.is-phone, which is set on a small touch screen
// (or with ?phone=1 to try it on a computer). On a computer nothing changes: the phone's Início and Avisos are only used when
// html.is-phone is set, and the computer keeps its own Início (home.js).
(function () {
  const small = matchMedia("(max-width: 900px)"), touch = matchMedia("(pointer: coarse)"), tryIt = /[?&]phone=1\b/.test(location.search);
  const phone = () => document.documentElement.classList.contains("is-phone");
  const apply = () => document.documentElement.classList.toggle("is-phone", small.matches && (touch.matches || tryIt));
  apply();
  small.addEventListener("change", apply);
  touch.addEventListener("change", apply);

  Object.assign(ICONS, HUB_ICONS); // the Hub adds these after sign-in; the bar is built before
  ICONS.more = '<circle cx="5" cy="12" r="1.7" fill="currentColor"/><circle cx="12" cy="12" r="1.7" fill="currentColor"/><circle cx="19" cy="12" r="1.7" fill="currentColor"/>';
  ICONS.chev = '<path d="M9 5l7 7-7 7"/>';
  ICONS.phone = '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>';
  ICONS.monitor = '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>';

  /* ---------- the tabs: [id, label, icon, the pages that belong to it] ---------- */
  const TABS = [
    ["home", "Início", "home", ["home"]],
    ["tarefas", "Tarefas", "tasks", ["tarefas", "aprovacoes", "semana"]],
    ["empresa", "Empresa", "bot", ["empresa"]],   // the agents' control room, one touch away (Marco, 9 out); it has its own tabs (crew-board.js)
    ["avisos", "Avisos", "bell", ["avisos"]],
    ["empresas", "Trabalho", "building", ["empresas", "projetos", "codigo", "entregas", "baredesk"]],
  ];

  // #/avisos only exists on the phone: on a computer the address falls back to Início, as any unknown one does
  const baseRoute = route;
  route = function () {
    if (phone() && /^#\/avisos/.test(location.hash)) return { tab: "avisos" };
    return baseRoute();
  };

  document.body.insertAdjacentHTML("beforeend", `
    <header id="m-bar">
      <div class="m-left"><a href="#/home" class="m-home" aria-label="Início"><img class="m-star" src="assets/icon-192.png" alt=""></a>
        <a class="m-back" id="m-back" href="#/home" hidden>${icon("chev")}<span id="m-back-t"></span></a></div>
      <div class="m-title" id="m-title"></div>
      <div class="m-right">
        <button class="m-btn" id="m-search" aria-label="Procurar">${icon("search")}</button>
        <button class="m-btn" id="m-bell" aria-label="Notificações">${icon("bell")}<i class="m-count" id="m-bell-n" hidden></i></button>
      </div>
    </header>
    <nav id="m-tabs">${TABS.map(([id, label, ic]) => `<a href="#/${id}" data-tab="${id}">${icon(ic)}<span>${t(label)}</span>${
      id === "avisos" ? '<i class="badge" id="m-av-n" hidden></i>' : id === "tarefas" ? badgeHtml("tarefas") : ""}</a>`).join("")}
      <button data-tab="more" aria-label="Mais">${icon("more")}<span>${t("Mais")}</span></button></nav>
    <div id="m-sheet" hidden><div class="m-bg"></div><div class="m-box"></div></div>`);

  const tabs = $("m-tabs"), sheet = $("m-sheet");

  // title and highlighted tab follow the page
  // Where "back" goes from each page: Trabalho and Tarefas are drill-downs on the phone, not rows of tabs.
  const coName = (id) => companies.find((c) => c.id === id)?.name || t("Empresa");
  const backOf = (r) => {
    if (r.tab === "baredesk") return r.company ? ["#/baredesk", "BareDesk"] : ["#/empresas", "Trabalho"];
    if (r.tab === "empresas" && r.company) return r.section ? [`#/empresas/${r.company}`, coName(r.company)] : ["#/empresas", "Trabalho"];
    if (r.tab === "projetos") return r.company ? ["#/projetos", "Projetos"] : ["#/empresas", "Trabalho"];
    if (r.tab === "codigo" || r.tab === "entregas") return ["#/empresas", "Trabalho"];
    if (r.tab === "aprovacoes" || r.tab === "semana") return ["#/tarefas", "Tarefas"];
    if (r.tab === "agentes" && r.company) return ["#/equipa", "Equipa"];
    if (MORE_PAGES.includes(r.tab)) return ["#more", "Mais"]; // "Mais" opens the sheet again, where the page came from
    return null;
  };
  const MORE_PAGES = ["novidades", "escritorio", "equipa", "aovivo", "agentes", "historico", "analise", "uso", "despesas", "memoria", "saude", "definicoes"];
  const titleOf = (r, fallback) => {
    if (r.tab === "baredesk") return r.company ? companies.find((c) => c.id === "baredesk")?.sections.find((x) => x.id === r.company)?.label || (r.company === "loja" ? "Loja" : "BareDesk") : "BareDesk";
    if (r.tab === "empresas" && r.company) return r.section ? companies.find((c) => c.id === r.company)?.sections.find((x) => x.id === r.section)?.label || coName(r.company) : coName(r.company);
    const page = TABS_ALL.find(([id]) => id === r.tab);
    return (backOf(r) || MORE_PAGES.includes(r.tab)) && page ? page[1] : fallback; // the page's own name, never its section's ("Sistema")
  };
  const TABS_ALL = NAV.flatMap(([, , pages]) => pages);
  const sync = () => {
    let r;
    try { r = route(); } catch { return; }
    const tab = TABS.find(([, , , pages]) => pages.includes(r.tab));
    const section = NAV.find(([, , pages]) => pages.some(([id]) => id === r.tab));
    $("m-title").textContent = t(titleOf(r, r.tab === "avisos" ? "Notificações" : tab ? tab[1] : section ? section[0] : "Mais"));
    const back = backOf(r);
    $("m-back").hidden = !back;
    document.documentElement.classList.toggle("m-deep", !!back);
    if (back) { $("m-back").href = back[0]; $("m-back-t").textContent = t(back[1]); }
    tabs.querySelectorAll("[data-tab]").forEach((a) => a.classList.toggle("on", a.dataset.tab === (tab ? tab[0] : "more")));
    document.documentElement.dataset.page = r.tab;
  };
  window.addEventListener("hashchange", () => { sheet.hidden = true; sync(); });
  $("m-back").addEventListener("click", (e) => {
    if ($("m-back").getAttribute("href") !== "#more") return;
    e.preventDefault(); e.stopPropagation(); openMore();
  });
  new MutationObserver(sync).observe($("view"), { childList: true });
  sync();

  // the unread counter is kept by the Hub on the sidebar's bell: mirror it on the bar and on the Avisos tab
  const mirror = () => {
    const n = $("bell-n"), shown = !n.hidden && n.textContent;
    for (const id of ["m-bell-n", "m-av-n"]) { $(id).textContent = n.textContent; $(id).hidden = !shown; }
  };
  new MutationObserver(mirror).observe($("bell-n"), { attributes: true, childList: true, characterData: true, subtree: true });
  mirror();

  // a click that is not inside a sheet closes it (shell.js), so these stop at the button
  $("m-bell").onclick = (e) => { e.stopPropagation(); sheet.hidden = true; location.hash = "#/avisos"; };
  $("m-search").onclick = (e) => { e.stopPropagation(); sheet.hidden = true; $("open-palette").click(); };

  // "Mais": who you are on top, the rest of the Hub as a grid of chrome keys, then the phone's own settings
  function openMore() {
    const keys = [["spark", "Novidades", "#/novidades"], ["bot", "Escritório", "#/escritorio"], ["users", "Equipa", "#/equipa"], ["chart", "Análise", "#/analise"],
      ["layers", "Memória", "#/memoria"], ["pulse", "Saúde", "#/saude"], ["gear", "Definições", "#/definicoes"]];
    const here = location.hash;
    sheet.querySelector(".m-box").innerHTML = `<i class="m-grab"></i>
      <div class="m-me">${ui.avatar(me.display_name, "lg")}<div><b>${esc(me.display_name)}</b><span>${esc(me.username)} · ${t(me.lead ? "Dirige a equipa" : "Equipa")}</span></div>
        <img class="m-me-star" src="assets/icon-192.png" alt=""></div>
      <h3>${t("Agente AMG")}</h3>
      <div class="m-keys">${keys.map(([ic, label, href]) => `<a class="m-key ${here.startsWith(href) ? "on" : ""}" href="${href}"><span>${icon(ic)}</span>${t(label)}</a>`).join("")}</div>
      <h3>${t("Neste telemóvel")}</h3>
      <div class="m-list"><button class="m-row" data-act="phone">${icon("bell")}<span>${t("Receber as notificações no telemóvel")}</span>${icon("chev")}</button></div>`;
    sheet.hidden = false;
  }
  tabs.querySelector('[data-tab="more"]').onclick = (e) => { e.stopPropagation(); sheet.hidden ? openMore() : (sheet.hidden = true); };
  const phoneSetup = () => { $("notif-panel").hidden = false; drawPhone(); };
  sheet.onclick = (e) => {
    e.stopPropagation();
    const act = e.target.closest("[data-act]");
    if (act) {
      sheet.hidden = true;
      if (act.dataset.act === "phone") phoneSetup();
    } else if (e.target.closest(".m-bg, a")) sheet.hidden = true;
  };

  /* ---------- the screens ---------- */
  let reload = null; // reloads the screen on view
  const busy = () => !sheet.hidden || !$("modal").hidden || document.activeElement?.matches("input, textarea, select");
  onLive(["task", "notification", "presence", "approval", "activity", "tick"], async () => {
    if (reload && !busy() && ($("m-home") || $("m-av") || $("m-tasks"))) reload().catch(() => {});
  });
  // "Fazer" / "A fazer" on a row: says to the team that you are on it (or not any more), without opening the task.
  // It sinks under the finger, the phone ticks, and the new button arrives with a pop, so the click feels done.
  const doingBtn = (id, on, pop = "") => (on
    ? `<button class="m-doing on ${pop}" data-doing="0" data-tid="${id}" title="${t("Parar")}"><span class="dl-ring">${ui.avatar(me.display_name, "sm")}</span>${t("A fazer")}</button>`
    : `<button class="m-doing ${pop}" data-doing="1" data-tid="${id}">${icon("play")}${t("Fazer")}</button>`);
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-doing]");
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    if (b.disabled) return;
    b.disabled = true; b.classList.add("press"); navigator.vibrate?.(14);
    const on = b.dataset.doing === "1", id = Number(b.dataset.tid), row = b.closest(".m-task");
    // the row changes at once (dark button, your photo, the green glow); the list is drawn again from the Hub afterwards
    setTimeout(() => {
      if (!b.isConnected) return;
      b.outerHTML = doingBtn(id, on, "popin");
      row?.classList.toggle("doing", on);
    }, 110);
    try { await api(`/api/tasks/${id}`, { method: "PATCH", body: { doing: on } }); flash(t(on ? "A equipa já vê que estás a fazer isto." : "Paraste esta tarefa.")); }
    catch (err) { flash(err.message); }
    if (reload) await reload().catch(() => {});
  }, true);
  // a task's window closed (done, edited, started): the screen under it shows what changed
  const phoneScreen = () => $("m-home") || $("m-av") || $("m-tasks") || $("m-work") || $("m-co");
  new MutationObserver(() => { if ($("modal").hidden && reload && sheet.hidden && phoneScreen()) reload().catch(() => {}); })
    .observe($("modal"), { attributes: true, attributeFilter: ["hidden"] });

  const KIND_ICON = { task_new: "tasks", task: "check", approval_required: "alert", approval_decided: "check", agent_failed: "alert", agent_waiting: "clock" };
  // a notice on Início: the face of who sent it, what it is, the task, the time (the same reading as Avisos)
  const nrow = (n) => {
    const p = notifParts(n);
    return `<a class="m-nrow ${n.read ? "" : "unread"}" href="${esc(n.href || "#/home")}" data-n="${n.id}">${p.who ? ui.avatar(p.who) : `<span class="m-ico">${icon(KIND_ICON[n.kind] || "bell")}</span>`}
    <div><span class="m-ntop"><b>${esc(p.who || p.what)}</b>${p.who ? `<em>${esc(p.what)}</em>` : ""}<time>${fmt.ago(n.created_at)}</time></span><span class="m-ntitle">${esc(p.title)}</span></div></a>`;
  };
  const when = (iso) => {
    const d = new Date(iso), now = new Date(), days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5);
    return days <= 0 ? "Hoje" : days === 1 ? "Ontem" : days < 7 ? "Esta semana" : "Mais antigas";
  };

  /* ---------- the tasks, as the phone sorts them ---------- */
  // Hoje is everything to do now: the urgent ones whatever their date, the late ones, today's, and those with no date.
  // Próximas holds what has a date after today, by day. Feitas is what was finished, newest first.
  const rank = (x) => (x.priority === "urgent" ? 0 : x.priority === "high" ? 1 : 2);
  const dayDiff = (iso) => {
    const d = new Date(iso), now = new Date();
    return Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5);
  };
  const daysLate = (x) => (x.deadline ? dayDiff(x.deadline) : null);
  const byImportance = (a, b) => rank(a) - rank(b) || String(a.deadline || "9").localeCompare(String(b.deadline || "9")) || b.id - a.id;
  // A task sent to everybody is one task; in "mine" it stands for my own copy (its circle finishes mine).
  function scopeOf(all, scope) {
    const grouped = groupAll(all.filter((x) => !x.trashed_at));
    if (scope === "team") return asOne(all.filter((x) => !x.trashed_at));
    return grouped.filter((x) => (x.group ? x.group.some((y) => y.assignee === me.username) : x.assignee === me.username))
      .map((x) => (x.group ? { ...x.group.find((y) => y.assignee === me.username), group: x.group } : x));
  }
  function plan(list) {
    const open = list.filter((x) => x.stage !== "done"), rest = open.filter((x) => x.priority !== "urgent");
    const n = (x) => daysLate(x);
    const hoje = { urgent: open.filter((x) => x.priority === "urgent"), late: rest.filter((x) => n(x) > 0), today: rest.filter((x) => n(x) === 0), undated: rest.filter((x) => n(x) === null) };
    const later = rest.filter((x) => n(x) !== null && n(x) < 0);
    const proximas = { tomorrow: later.filter((x) => n(x) === -1), week: later.filter((x) => n(x) < -1 && n(x) >= -7), after: later.filter((x) => n(x) < -7) };
    const done = list.filter((x) => x.stage === "done").sort((a, b) => String(b.completed_at || "").localeCompare(String(a.completed_at || ""))).slice(0, 40);
    const doneOn = (x) => dayDiff(x.completed_at || x.updated_at || x.created_at);
    const feitas = { today: done.filter((x) => doneOn(x) <= 0), yesterday: done.filter((x) => doneOn(x) === 1), older: done.filter((x) => doneOn(x) > 1) };
    const count = (sets) => Object.values(sets).reduce((k, l) => k + l.length, 0);
    return { open, hoje, proximas, feitas, nHoje: count(hoje), nProximas: count(proximas), nLate: hoje.late.length, nHot: open.filter((x) => rank(x) < 2).length };
  }
  const deadlineLabel = (x) => {
    const n = daysLate(x);
    if (n === null) return "";
    if (n > 0) return `<span class="late">${t(n === 1 ? "Atrasada há 1 dia" : "Atrasada há {n} dias", { n })}</span>`;
    if (n === 0) return `<span class="today">${t("Hoje")} ${fmt.hhmm(x.deadline)}</span>`;
    return n === -1 ? t("Amanhã") : fmt.date(x.deadline);
  };
  const taskRow = (x, team) => {
    const tone = x.stage === "done" ? "done" : x.priority === "urgent" ? "urgent" : x.priority === "high" ? "high" : "";
    const coLabel = companies.find((c) => c.id === x.company)?.name;
    const meta = [coLabel ? `<span class="m-co-tag">${esc(coLabel)}</span>` : "", x.group ? `<span class="all">${esc(whoLeft(x.group))}</span>` : x.stage === "done" && x.completed_by ? `<span class="${x.completed_by !== x.assignee ? "other" : ""}">${esc(doneBy(x))}</span>` : "",
      esc(x.project_name || ""), x.stage === "done" ? "" : deadlineLabel(x),
      x.stage === "in_progress" ? `<span class="ai">${t("Em curso")}</span>` : x.stage === "blocked" ? `<span class="late">${t("Bloqueada")}</span>` : ""].filter(Boolean);
    const open = x.stage !== "done" && !["IN_PROGRESS", "WAITING_APPROVAL"].includes(x.status);
    const doer = open && doingOf(x), mine = open && x.assignee === me.username;
    // yours: "Fazer" (chrome) turns into a dark "A fazer" with your photo in the ring; somebody else's: their photo and name, for all
    // to see. In a task for everybody your own button stays, and who else is on their part is said in the line under the title.
    const doing = mine ? doingBtn(x.id, !!x.doing_since) : doer ? doingBadge(doer) : "";
    if (mine && doer && doer.assignee !== me.username && !x.doing_since) meta.unshift(`<span class="doing-txt">${esc(nameOf(doer.assignee))} ${t("a fazer")}</span>`);
    // whose it is, as on the computer: a stripe of their colour, and in the team's list their plate (yours says TU)
    const who = x.stage === "done" && x.completed_by ? x.completed_by : x.assignee;
    return `<div class="m-task ${tone} ${doer ? "doing" : ""} ${!x.group && isMe(who) ? "mine" : ""}" style="${x.group ? "" : whoVar(who)}" data-id="${x.id}">
      <button class="m-check" data-done="${x.id}" aria-label="${t("Concluir")}">${x.stage === "done" ? icon("tick") : ""}</button>
      <div><b>${tone === "urgent" ? '<i class="m-bang">!!</i>' : tone === "high" ? '<i class="m-bang high">!</i>' : ""}${esc(x.title)}</b>${meta.length ? `<span class="sub">${meta.join(" · ")}</span>` : ""}</div>
      ${doing || (x.group ? whoFaces(x.group) : team ? whoPlate(who) : "")}</div>`;
  };
  const block = (title, list, tone, team, sort = true) => (list.length ? `<section class="m-sec"><h3 class="m-grp ${tone}"><i></i>${t(title)}<span>${list.length}</span></h3>
    <div class="m-list">${(sort ? [...list].sort(byImportance) : list).map((x) => taskRow(x, team)).join("")}</div></section>` : "");

  /* ---------- Início: who is where, three numbers, what is next, the latest notices ---------- */
  const desktopHome = HUB_VIEWS.home;
  HUB_VIEWS.home = (r) => (phone() ? phoneHome() : desktopHome(r));
  const PLACE = { pc: ["monitor", "No computador"], phone: ["phone", "No telemóvel"] };
  // One person, side by side with the others like the people row of iOS: the face in a ring (green online, blue working),
  // where they are on a badge, and one short line.
  function mateTile(m) {
    if (m.doing) m = { ...m, status: "WORKING", task: m.doing.title }; // "Estou a fazer" on a task
    const on = m.status !== "OFFLINE", where = (m.where || []).filter((w) => PLACE[w]);
    const working = m.status === "WORKING" && m.task;
    const state = working ? "work" : m.status === "WAITING" || m.status === "PAUSED" ? "wait" : m.status === "ERROR" ? "bad" : on ? "on" : "off";
    const both = where.includes("pc") && where.includes("phone");
    const badge = on ? icon(working ? "bolt" : where.includes("phone") && !where.includes("pc") ? "phone" : "monitor") : "";
    const line = working ? t("A trabalhar") : !on ? (m.last_seen ? fmt.ago(m.last_seen) : t("Offline"))
      : both ? t("PC e telemóvel") : where.includes("phone") ? t("No telemóvel") : t("No computador");
    return `<a class="m-person ${state}" href="${m.doing ? `#/tarefas/${m.doing.id}` : "#/equipa"}" title="${esc(working ? `${t("A trabalhar")}: ${m.task}` : line)}">
      <span class="m-ring">${ui.avatar(m.display_name)}${on ? `<i class="m-place">${badge}</i>` : ""}</span>
      <b>${esc(m.user === me.username ? t("Tu") : m.display_name)}</b><span>${esc(line)}</span>${working ? `<em>${esc(m.task)}</em>` : ""}</a>`;
  }
  // What is urgent goes first, above everything, in red: you cannot miss it.
  function urgentCard(list) {
    if (!list.length) return "";
    const row = (x) => `<div class="m-urow" data-open="${x.id}"><button class="m-check" data-done="${x.id}" aria-label="${t("Concluir")}"></button>
      <div><b>${esc(x.title)}</b><span>${[x.group ? whoLeft(x.group) : "", deadlineLabel(x) || t("Sem prazo")].filter(Boolean).join(" · ")}</span></div>${icon("chev")}</div>`;
    return `<section class="m-urgent"><header><i class="m-pulse"></i><b>${t(list.length === 1 ? "Urgente" : "Urgentes")}</b><span>${list.length}</span></header>
      ${[...list].sort(byImportance).slice(0, 3).map(row).join("")}${list.length > 3 ? `<a class="m-umore" href="#/tarefas" data-goto="hoje">${t("Ver as {n} urgentes", { n: list.length })}</a>` : ""}</section>`;
  }
  async function phoneHome() {
    const hour = new Date().getHours(), greeting = hour < 6 ? "Boa noite" : hour < 13 ? "Bom dia" : hour < 20 ? "Boa tarde" : "Boa noite";
    const date = new Date().toLocaleDateString("pt-PT", { weekday: "long", day: "numeric", month: "long" });
    page(`<div class="m-screen" id="m-home">
      <header class="m-large m-amg"><span class="m-eyebrow">${t("Centro de comando")}</span><h1>${esc(t(greeting))}, <em>${esc(me.display_name)}</em></h1>
        <span>${esc(date[0].toUpperCase() + date.slice(1))}</span><div class="m-amg-car" aria-hidden="true"><img src="assets/amg-front-1200.webp" alt="" decoding="async"></div></header>
      <div id="m-new"></div><div id="m-alert"></div><div class="m-stats" id="m-stats">${ui.skeleton(1)}</div><div id="m-now"></div><div id="m-todo"></div><div id="m-team"></div><div id="m-last"></div></div>`);
    const load = async () => {
      const [tasks, team, inbox] = await Promise.all([api("/api/tasks"), api("/api/team"), request("/api/notifications?limit=100")]);
      if (!$("m-home")) return;
      // a task somebody sent you comes first, big, the same card as on the computer (home.js), until you open it
      const fresh = newTasksOf(tasks, inbox), freshIds = new Set(fresh.map((f) => f.x.id));
      paint($("m-new"), newTaskCard(fresh));
      const teamView = scopeNow() === "team"; // the same tasks as Tarefas (and as the computer, for whoever directs the work)
      const p = plan(scopeOf(tasks, teamView ? "team" : "mine"));
      paint($("m-alert"), urgentCard(p.hoje.urgent.filter((x) => !freshIds.has(x.id))));
      const stat = (tab, n, label, tone, ic) => `<a class="m-stat ${n ? `${tone} lit` : ""}" href="${tab ? "#/tarefas" : "#/avisos"}" ${tab ? `data-goto="${tab}"` : ""}>
        <span class="m-stat-ic">${icon(ic)}</span><b>${n}</b><span>${t(label)}</span></a>`;
      paint($("m-stats"), stat("hoje", p.nHoje, "Para hoje", "today", "calendar") + stat("hoje", p.nHot, "Urgentes", "hot", "flag") + stat("", inbox.unread, "Por ler", "blue", "bell"));
      const busy = team.filter((m) => m.doing);
      paint($("m-now"), busy.length ? `<section class="m-sec in-doing"><header><b>${t("A fazer agora")}</b></header><div class="in-doing-list">${busy.map((m) => `<a class="in-doing-card" href="#/tarefas/${m.doing.id}">
        <span class="in-doing-task">${esc(m.doing.title)}</span>${doingCard(m.display_name, m.doing.since, m.user === me.username)}</a>`).join("")}</div></section>` : "");   // the task window's own card
      const online = team.filter((m) => m.status !== "OFFLINE").length;
      const order = [...team].sort((a, b) => (a.status === "OFFLINE") - (b.status === "OFFLINE") || (b.user === me.username) - (a.user === me.username));
      paint($("m-team"), `<section class="m-sec"><header><b>${t("Equipa")}</b><span class="m-online"><i></i>${online} ${t("de")} ${team.length} ${t("online")}</span></header>
        <div class="m-people">${order.map(mateTile).join("")}</div></section>`);
      const rest = [...p.hoje.late, ...p.hoje.today, ...p.hoje.undated].sort(byImportance), next = rest.slice(0, 5); // the urgent ones are already on top
      paint($("m-todo"), `<section class="m-sec"><header><b>${t("A seguir")}</b><a href="#/tarefas" data-goto="hoje">${rest.length > 5 ? t("Ver as {n}", { n: rest.length }) : t("Ver todas")}</a></header>${next.length
        ? `<div class="m-list">${next.map((x) => taskRow(x, teamView)).join("")}</div>`
        : `<div class="m-empty">${icon("check")}<span>${t(p.hoje.urgent.length ? "Fora as urgentes, mais nada para hoje." : "Nada por fazer hoje. Bom trabalho.")}</span></div>`}</section>`);
      paint($("m-last"), `<section class="m-sec"><header><b>${t("Últimos avisos")}</b><a href="#/avisos">${t("Ver todos")}</a></header>${inbox.items.length
        ? `<div class="m-list">${inbox.items.slice(0, 3).map(nrow).join("")}</div>` : `<div class="m-empty">${icon("bell")}<span>${t("Sem avisos novos.")}</span></div>`}</section>`);
    };
    reload = load;
    $("view").onclick = async (e) => {
      if (await newTaskClick(e)) return load();
      const done = e.target.closest("[data-done]");
      if (done) {
        e.preventDefault(); done.disabled = true;
        done.closest(".m-task")?.classList.add("finishing");
        try { await api(`/api/tasks/${done.dataset.done}`, { method: "PATCH", body: { status: "COMPLETED" } }); flash(t("Tarefa concluída.")); } catch (err) { flash(err.message); }
        return load();
      }
      const task = e.target.closest(".m-task, [data-open]"); if (task) return openTaskModal(Number(task.dataset.id || task.dataset.open));
      const go = e.target.closest("[data-goto]"); if (go) taskTab = go.dataset.goto; // the numbers open Tarefas on the right tab
      const row = e.target.closest("[data-n]"); if (row) api("/api/notifications/read", { method: "POST", body: { ids: [Number(row.dataset.n)] } }).then(() => hubNews()).catch(() => {});
    };
    await load().catch((e) => { if (e.message !== "unauthorized") $("m-stats").innerHTML = ui.error(e.message); });
  }

  /* Avisos: the notifications as an inbox, by day, unread first in bold. A tap marks it read and opens it. */
  HUB_VIEWS.avisos = async function () {
    notifSel.on = notifSel.confirm = false; notifSel.picked.clear();
    page(`<div class="m-screen" id="m-av"><header class="m-large"><span id="m-av-sub"></span><h1>${t("Notificações")}</h1></header><div id="m-av-list">${ui.skeleton(5)}</div></div>`);
    let inbox = { unread: 0, items: [] };
    const draw = () => {
      if (!$("m-av")) return;
      $("m-av-sub").textContent = inbox.unread ? t("{n} por ler", { n: inbox.unread }) : t("Tudo lido");
      $("m-av-list").innerHTML = `${notifToolbar(inbox)}<div class="nl-list">${notifListHtml(inbox)}</div>
        <section class="m-sec"><h3 class="m-grp">${t("No telemóvel")}</h3><div class="m-list"><button class="m-row2" data-phone>${icon("bell")}<div><b>${t("Receber as notificações no telemóvel")}</b>
          <span>${t("Para o aviso chegar ao ecrã de bloqueio")}</span></div>${icon("chev")}</button></div></section>`;
    };
    const load = async () => {
      if (notifSel.on) return;   // never repaint under a finger that is choosing
      inbox = await request("/api/notifications?limit=100");
      for (const id of [...notifSel.picked]) if (!inbox.items.some((n) => n.id === id)) notifSel.picked.delete(id);
      draw();
    };
    reload = load;
    $("view").onclick = async (e) => {
      if (e.target.closest("[data-phone]")) { e.stopPropagation(); return phoneSetup(); }
      await notifClick(e, inbox, (local) => (local ? draw() : load()));
    };
    await load().catch((e) => { if (e.message !== "unauthorized") $("m-av-list").innerHTML = ui.error(e.message); });
  };

  /* ---------- Trabalho: a way in, like Files. The companies as folders, the rest of the work as a list; inside a company,
     its shop, its tasks, its library and who worked there. The computer keeps its own pages. ---------- */
  const coHref = (c) => (c.id === "baredesk" ? "#/baredesk" : `#/empresas/${c.id}`);
  const secHref = (c, sec) => (c.id === "baredesk" ? `#/baredesk/${sec}` : `#/empresas/${c.id}/${sec}`);
  const shopLive = (store) => store && (store.shopify?.source === "live" || store.meta?.source === "live");
  const desktopEmpresas = HUB_VIEWS.empresas, desktopBaredesk = HUB_VIEWS.baredesk;
  HUB_VIEWS.empresas = (r) => (!phone() || r.section ? desktopEmpresas(r) : r.company ? phoneCompany(r.company) : phoneWork());
  HUB_VIEWS.baredesk = async (r) => {
    if (!phone()) return desktopBaredesk(r);
    if (!r.company) return phoneCompany("baredesk");
    await desktopBaredesk(r); // one part of the company, full screen; the bar above says which and goes back
    const sec = companies.find((c) => c.id === "baredesk")?.sections.find((x) => x.id === r.company);
    const h = $("view").querySelector(".ph h1");
    if (h) h.textContent = t(sec ? sec.label : r.company === "loja" ? "Loja" : "BareDesk");
  };

  async function phoneWork() {
    page(`<div class="m-screen" id="m-work"><header class="m-large"><span>${t("Empresas e projetos")}</span><h1>${t("Trabalho")}</h1></header>
      <div id="m-w-body">${ui.skeleton(4)}</div></div>`);
    const load = async () => {
      const [tasks, projects, commits, store] = await Promise.all([api("/api/tasks"), api("/api/projects").catch(() => []),
        api("/api/commits?limit=20").catch(() => []), companies.some((c) => c.id === "baredesk") ? api("/api/store/summary").catch(() => null) : null]);
      const works = await Promise.all(companies.map((c) => api(`/api/work/${c.id}`).catch(() => null)));
      if (!$("m-work")) return;
      const open = asOne(tasks.filter((x) => !x.trashed_at)).filter((x) => x.stage !== "done");
      const card = (c, i) => {
        const n = open.filter((x) => x.company === c.id).length, top = works[i]?.people?.[0];
        const shop = c.id === "baredesk" ? (shopLive(store) ? `<span class="ok">● ${t("Loja ao vivo")}</span>` : `<span class="warn">${t("Loja por ligar")}</span>`) : "";
        return `<a class="m-co" href="${coHref(c)}"><span class="m-co-logo">${esc(c.short || c.name.slice(0, 3))}</span>
          <div class="m-co-t"><b>${esc(c.name)}</b><span>${esc(c.tagline || "")}</span></div>${icon("chev")}
          <div class="m-co-facts"><span><b>${n}</b> ${t(n === 1 ? "tarefa aberta" : "tarefas abertas")}</span>${shop}
            ${top ? `<span>${t("Mais ativo")}: ${esc(top.name)}</span>` : ""}</div></a>`;
      };
      const last = commits[0];
      const row = (href, ic, title, sub, tone = "") => `<a class="m-row2" href="${href}"><span class="m-ico ${tone}">${icon(ic)}</span>
        <div><b>${t(title)}</b><span>${sub}</span></div>${icon("chev")}</a>`;
      paint($("m-w-body"), `<section class="m-sec"><header><b>${t("Empresas")}</b></header>
          ${companies.length ? `<div class="m-cos">${companies.map(card).join("")}</div>` : `<div class="m-empty">${icon("building")}<span>${t("Ainda não há empresas.")}</span></div>`}</section>
        <section class="m-sec"><header><b>${t("Geral")}</b></header><div class="m-list">
          ${row("#/projetos", "folder", "Projetos", projects.length ? esc(t(projects.length === 1 ? "1 projeto" : "{n} projetos", { n: projects.length })) : esc(t("Ainda sem projetos")), "blue")}
          ${row("#/codigo", "code", "Código", last ? `${esc(fmt.ago(last.date))} · ${esc(last.author)}` : esc(t("Sem commits")), "green")}
          ${row("#/entregas", "layers", "Entregas", last ? esc(last.message) : esc(t("Ainda sem entregas")), "orange")}</div></section>`);
    };
    reload = load;
    $("view").onclick = null;
    await load().catch((e) => { if (e.message !== "unauthorized") $("m-w-body").innerHTML = ui.error(e.message); });
  }

  async function phoneCompany(id) {
    const c = companies.find((x) => x.id === id);
    if (!c) { page(ui.empty("building", "Empresa não encontrada", "")); return; }
    page(`<div class="m-screen" id="m-co"><header class="m-large"><span>${esc(c.tagline || "")}</span><h1>${esc(c.name)}</h1></header>
      <div id="m-co-body">${ui.skeleton(5)}</div></div>`);
    const load = async () => {
      const [tasks, work, store] = await Promise.all([api("/api/tasks"), api(`/api/work/${id}`).catch(() => null),
        id === "baredesk" ? api("/api/store/summary").catch(() => null) : null]);
      if (!$("m-co")) return;
      const open = asOne(tasks.filter((x) => !x.trashed_at)).filter((x) => x.stage !== "done" && x.company === id)
        .map((x) => (x.group && x.group.some((y) => y.assignee === me.username) ? { ...x.group.find((y) => y.assignee === me.username), group: x.group } : x)).sort(byImportance);
      const shop = id !== "baredesk" ? "" : `<section class="m-sec"><header><b>${t("Loja")}</b></header><div class="m-list">${shopLive(store)
        ? `<a class="m-row2" href="#/baredesk/loja"><span class="m-ico green">${icon("bag")}</span><div><b>${t("Loja ao vivo")}</b><span>${t("Faturação, vendas e anúncios")}</span></div>${icon("chev")}</a>`
        : `<div class="m-row2 m-off"><span class="m-ico orange">${icon("alert")}</span><div><b>${t("Shopify e Meta por ligar")}</b><span>${t("Os números da loja aparecem quando a loja estiver ligada.")}</span></div></div>`}</div></section>`;
      const people = work?.people?.length ? `<div class="m-chips">${work.people.slice(0, 6).map((p) => `<span class="m-chip">${ui.avatar(p.name, "sm")}${esc(p.name)}<i>${p.count}</i></span>`).join("")}</div>`
        : `<div class="m-empty">${icon("users")}<span>${t("Ainda ninguém trabalhou aqui.")}</span></div>`;
      paint($("m-co-body"), `${shop}
        <section class="m-sec"><header><b>${t("Tarefas")}</b><a href="#/tarefas" data-co="${esc(id)}">${t("Ver todas")}</a></header>${open.length
          ? `<div class="m-list">${open.slice(0, 5).map((x) => taskRow(x, true)).join("")}</div>` : `<div class="m-empty">${icon("check")}<span>${t("Sem tarefas abertas.")}</span></div>`}</section>
        <section class="m-sec"><header><b>${t("Biblioteca")}</b></header><div class="m-list">${c.sections.map((x) => `<a class="m-row2" href="${secHref(c, x.id)}">
          <span class="m-ico">${icon(x.id)}</span><div><b>${esc(t(x.label))}</b><span>${esc(x.description || "")}</span></div>${x.count != null ? `<em class="m-count2">${x.count}</em>` : ""}${icon("chev")}</a>`).join("")}</div></section>
        <section class="m-sec"><header><b>${t("Quem trabalhou")}</b></header>${people}</section>`);
    };
    reload = load;
    $("view").onclick = async (e) => {
      const co = e.target.closest("[data-co]"); if (co) taskCo = co.dataset.co;
      const done = e.target.closest("[data-done]");
      if (done) {
        e.preventDefault(); done.disabled = true; done.closest(".m-task")?.classList.add("finishing");
        try { await api(`/api/tasks/${done.dataset.done}`, { method: "PATCH", body: { status: "COMPLETED" } }); flash(t("Tarefa concluída.")); } catch (err) { flash(err.message); }
        return load();
      }
      const task = e.target.closest(".m-task"); if (task) openTaskModal(Number(task.dataset.id));
    };
    await load().catch((e) => { if (e.message !== "unauthorized") $("m-co-body").innerHTML = ui.error(e.message); });
  }

  /* Tarefas: like Reminders. Hoje, Próximas and Feitas, each in blocks; the circle finishes a task, a tap opens it. */
  const desktopTarefas = HUB_VIEWS.tarefas;
  HUB_VIEWS.tarefas = (r) => (phone() ? phoneTarefas(r) : desktopTarefas(r));
  let taskTab = "hoje", taskCo = "";
  // Minhas or Equipa: whoever directs the work sees the team's tasks, as on the computer, until they choose otherwise (remembered).
  let taskScope = (() => { try { return localStorage.getItem("hub.taskScope"); } catch { return null; } })();
  const scopeNow = () => taskScope || (me?.lead ? "team" : "mine");

  async function phoneTarefas(r) {
    page(`<div class="m-screen" id="m-tasks">
      <header class="m-headrow"><div class="m-large"><span id="m-t-sub">&nbsp;</span><h1>${t("Tarefas")}</h1></div>
        <div class="m-head-act"><span id="m-t-scope"></span><button class="m-plus" data-new aria-label="${t("Nova tarefa")}">${icon("plus")}</button></div></header>
      <div id="m-t-body">${ui.skeleton(5)}</div></div>`);
    const load = async () => {
      const [list, approvals] = await Promise.all([api("/api/tasks"), api("/api/approvals").catch(() => [])]);
      if (!$("m-tasks")) return;
      const withCo = companies.filter((c) => list.some((x) => !x.trashed_at && x.company === c.id));
      if (taskCo && taskCo !== "none" && !withCo.some((c) => c.id === taskCo)) taskCo = "";
      const all = list.filter((x) => !x.trashed_at && (!taskCo || (taskCo === "none" ? !x.company : x.company === taskCo)));
      const waiting = approvals.filter((a) => a.status === "PENDING").length;
      const hasTeam = all.some((x) => x.assignee !== me.username), team = hasTeam && scopeNow() === "team";
      const p = plan(scopeOf(all, team ? "team" : "mine"));
      $("m-t-sub").textContent = `${p.open.length} ${t("por fazer")}${p.nLate ? ` · ${p.nLate} ${t(p.nLate === 1 ? "atrasada" : "atrasadas")}` : ""}`;
      $("m-t-scope").innerHTML = hasTeam ? `<span class="m-scope"><button data-scope="mine" class="${team ? "" : "on"}">${t("Minhas")}</button><button data-scope="team" class="${team ? "on" : ""}">${t("Equipa")}</button></span>` : "";
      const seg = [["hoje", "Hoje", p.nHoje], ["proximas", "Próximas", p.nProximas], ["feitas", "Feitas", null]]
        .map(([id, label, n]) => `<button data-tab="${id}" class="${id === taskTab ? "on" : ""}">${t(label)}${n ? `<i class="${id === "hoje" && (p.hoje.urgent.length || p.nLate) ? "hot" : ""}">${n}</i>` : ""}</button>`).join("");
      let body = "";
      if (taskTab === "hoje") body = block("Urgentes", p.hoje.urgent, "late", team) + block("Atrasadas", p.hoje.late, "late", team)
        + block("Para hoje", p.hoje.today, "today", team) + block("Sem prazo", p.hoje.undated, "", team);
      else if (taskTab === "proximas") body = block("Amanhã", p.proximas.tomorrow, "", team) + block("Esta semana", p.proximas.week, "", team) + block("Mais tarde", p.proximas.after, "", team);
      else body = block("Hoje", p.feitas.today, "ok", team, false) + block("Ontem", p.feitas.yesterday, "ok", team, false) + block("Mais antigas", p.feitas.older, "ok", team, false);
      const empty = { hoje: ["check", "Tudo feito por hoje", "Quando houver algo para fazer, aparece aqui."], proximas: ["calendar", "Nada marcado", "As tarefas com prazo para os próximos dias aparecem aqui."],
        feitas: ["check", "Ainda nada concluído", "O que concluíres aparece aqui."] }[taskTab];
      const coBar = withCo.length ? `<div class="m-filter">${[["", "Todas"], ...withCo.map((c) => [c.id, c.name]), ["none", "Sem empresa"]]
        .map(([id, label]) => `<button data-co="${esc(id)}" class="${id === taskCo ? "on" : ""}">${esc(t(label))}</button>`).join("")}</div>` : "";
      const wait = waiting ? `<a class="m-approve" href="#/aprovacoes">${icon("alert")}<span>${t(waiting === 1 ? "1 aprovação à espera" : "{n} aprovações à espera", { n: waiting })}</span>${icon("chev")}</a>` : "";
      const week = `<div class="m-list"><a class="m-row2" href="#/semana"><span class="m-ico">${icon("calendar")}</span><div><b>${t("Resumo da semana")}</b><span>${t("O que a equipa fez e o que vem a seguir")}</span></div>${icon("chev")}</a></div>`;
      paint($("m-t-body"), `${wait}<div class="m-seg">${seg}</div>${coBar}${body || `<div class="m-empty big">${icon(empty[0])}<b>${t(empty[1])}</b><span>${t(empty[2])}</span></div>`}${week}`);
    };
    reload = load;
    $("view").onclick = async (e) => {
      if (e.target.closest("[data-new]")) return newTask();
      const done = e.target.closest("[data-done]");
      if (done) {
        done.disabled = true;
        done.closest(".m-task")?.classList.add("finishing");
        try { await api(`/api/tasks/${done.dataset.done}`, { method: "PATCH", body: { status: "COMPLETED" } }); flash(t("Tarefa concluída.")); } catch (err) { flash(err.message); }
        return load();
      }
      const tab = e.target.closest("[data-tab]"), scope = e.target.closest("[data-scope]"), co = e.target.closest("[data-co]");
      if (tab) { taskTab = tab.dataset.tab; return load(); }
      if (co) { taskCo = co.dataset.co; return load(); }
      if (scope) { taskScope = scope.dataset.scope; try { localStorage.setItem("hub.taskScope", taskScope); } catch { /* private window */ } return load(); }
      const row = e.target.closest(".m-task");
      if (row) openTaskModal(Number(row.dataset.id));
    };
    const linked = Number(r.company) || openTask; // #/tarefas/12 and the widget's "Open Task" open that task
    if (linked) { openTask = null; openTaskModal(linked); }
    await load().catch((e) => { if (e.message !== "unauthorized") $("m-t-body").innerHTML = ui.error(e.message); });
  }

  /* ---------- a task, the iOS way: a screen pushed over the tab you are on, not the computer's window ----------
     It slides in from the right with "‹ Notificações" (or wherever you came from) on top; back, a swipe from the left
     edge or the phone's own back all take you to the same place, scrolled where you were. The address does not change,
     so closing it never leaves you in another tab and a reload never opens it again. What the computer has in its
     window is here as rows to tap, a bar at the bottom with the one thing to do next, and "⋯" for the rest. */
  document.body.insertAdjacentHTML("beforeend", `<div id="m-tv" hidden></div><div id="m-as" hidden></div><div id="m-undo" hidden></div>`);
  const tv = $("m-tv");
  let tvId = null;

  // the action sheet: a list that rises from the bottom, "Cancelar" apart, like iOS. Resolves with the key picked, or null.
  function actionSheet(title, items) {
    const as = $("m-as");
    as.innerHTML = `<div class="m-as-bg"></div><div class="m-as-box"><div class="m-as-group">${title ? `<p class="m-as-t">${esc(title)}</p>` : ""}${
      items.map(([key, label, tone = ""]) => `<button data-as="${esc(key)}" class="${tone}">${esc(t(label))}</button>`).join("")}</div>
      <div class="m-as-group"><button data-as="" class="m-as-cancel">${t("Cancelar")}</button></div></div>`;
    as.hidden = false;
    requestAnimationFrame(() => as.classList.add("in"));
    return new Promise((done) => {
      as.onclick = (e) => {
        e.stopPropagation();
        const b = e.target.closest("[data-as]");
        if (!b && !e.target.closest(".m-as-bg")) return;
        as.classList.remove("in");
        setTimeout(() => { as.hidden = true; as.innerHTML = ""; }, 260);
        done(b?.dataset.as || null);
      };
    });
  }

  // "Apagada · Desfazer" above the tabs for a few seconds; the task waits in the Lixo, so undoing is just restoring it
  let undoTimer = null;
  function undoBar(text, undo) {
    const bar = $("m-undo");
    bar.innerHTML = `<span>${esc(text)}</span><button>${t("Desfazer")}</button>`;
    bar.hidden = false; bar.classList.remove("in"); void bar.offsetWidth; bar.classList.add("in");
    clearTimeout(undoTimer);
    const hide = () => { bar.classList.remove("in"); setTimeout(() => { if (!bar.classList.contains("in")) bar.hidden = true; }, 250); };
    undoTimer = setTimeout(hide, 6000);
    bar.querySelector("button").onclick = async (e) => { e.stopPropagation(); clearTimeout(undoTimer); hide(); await undo(); };
  }

  async function trashTaskPhone(id, title) {
    try { await api(`/api/tasks/${id}/trash`, { method: "POST", body: { reason: "mistake" } }); }
    catch (err) { flash(err.message); if (reload) reload().catch(() => {}); return false; }
    navigator.vibrate?.(18);
    if (reload) reload().catch(() => {});
    undoBar(t("Tarefa apagada"), async () => {
      try { await api(`/api/tasks/${id}/restore`, { method: "POST" }); flash(t("A tarefa voltou: {t}", { t: title })); } catch (err) { flash(err.message); }
      if (reload) reload().catch(() => {});
    });
    return true;
  }

  const tvBack = () => {
    const here = $("m-title").textContent.trim();
    return here ? here[0].toUpperCase() + here.slice(1).toLowerCase() : t("Voltar");
  };
  function closeTask(fromHistory = false) {
    if (tv.hidden || (tvId === null && !tv.classList.contains("in"))) return;   // already on its way out (back → popstate)
    tvId = null;
    tv.classList.remove("in"); tv.style.transform = "";
    setTimeout(() => { if (tvId === null) { tv.hidden = true; tv.innerHTML = ""; } }, 320);
    if (!fromHistory && history.state?.mtask) history.back();
    if (reload) reload().catch(() => {});
  }
  window.addEventListener("popstate", () => { if (!tv.hidden) closeTask(true); });
  window.addEventListener("hashchange", () => { if (!tv.hidden) { tvId = null; tv.hidden = true; tv.innerHTML = ""; tv.classList.remove("in"); } });

  async function phoneTask(id) {
    // #/tarefas/12 (a push notification, a link) becomes #/tarefas: the task opens on top and does not come back on reload
    if (/^#(\/tarefas\/\d+|task-\d+)$/.test(location.hash)) history.replaceState(history.state, "", "#/tarefas");
    const fresh = tv.hidden || tvId !== id;
    tvId = id;
    if (tv.hidden) {
      tv.innerHTML = `<header class="m-tv-bar"><button class="m-tv-back" data-tv="close">${icon("chev")}<span>${esc(tvBack())}</span></button><b class="m-tv-t"></b>
        <button class="m-tv-more" data-tv="more" aria-label="${t("Mais ações")}">${icon("more")}</button></header><div class="m-tv-body">${ui.skeleton(4)}</div><footer class="m-tv-foot"></footer>`;
      tv.hidden = false;
      requestAnimationFrame(() => requestAnimationFrame(() => tv.classList.add("in")));
      if (!history.state?.mtask) history.pushState({ mtask: true }, "", location.href);
    }
    let x, all;
    try { [x, all] = await Promise.all([request_(`/api/tasks/${id}`), request_("/api/tasks")]); }
    catch (e) { if (tvId === id) tv.querySelector(".m-tv-body").innerHTML = ui.error(e.message); return; }
    if (tvId !== id) return;
    if (fresh) markTaskSeen(x);
    const body = tv.querySelector(".m-tv-body"), keep = fresh ? 0 : body.scrollTop;
    const group = groupAll(all.filter((y) => !y.trashed_at)).find((g) => g.group && g.group.some((y) => y.id === x.id))?.group;
    const held = heldByAgent(x), running = ["IN_PROGRESS", "WAITING_APPROVAL"].includes(x.status), done = x.stage === "done";
    const late = !done && x.deadline && new Date(x.deadline) < new Date();
    const company = companies.find((c) => c.id === x.company)?.name;
    const row = (ic, label, value, { cls = "", act = "" } = {}) => `<${act ? `button data-tv="${act}"` : "div"} class="m-tv-row ${cls}"><span class="m-tv-ic">${ic}</span><em>${t(label)}</em><b>${value}</b>${act ? icon("chev") : ""}</${act ? "button" : "div"}>`;
    // who sent it and to whom is said on top ("KOVEL › TU"), so the details below keep only the rest, small
    const facts = [
      done ? "" : row(icon("calendar"), late ? "Atrasada desde" : "Prazo", x.deadline ? `${fmt.day(x.deadline)} ${fmt.hhmm(x.deadline)}` : t("Sem prazo"), { cls: late ? "bad" : x.deadline ? "" : "dim", act: "due" }),
      row(icon("flag"), "Prioridade", t(PRIORITY[x.priority || "normal"]), { cls: x.priority === "urgent" ? "bad" : x.priority === "high" ? "warn" : "dim" }),
      x.project_name || x.project ? row(icon("folder"), "Projeto", esc(x.project_name || x.project)) : "",
      company ? row(icon("building"), "Empresa", esc(company)) : "",
      x.crew_name ? row(icon(CREW_ICON[x.crew] || "bot"), "Agente", esc(x.crew_name)) : x.agent_role ? row(icon("bot"), "Agente", esc(t(ROLES[x.agent_role]))) : "",
      x.created_at ? row(icon("clock"), "Criada", `${fmt.day(x.created_at)} ${fmt.hhmm(x.created_at)}`, { cls: "dim" }) : "",
      done && !group && x.completed_by ? row(icon("check"), "Concluída por", `${esc(nameOf(x.completed_by))}${x.completed_at ? ` · ${fmt.day(x.completed_at)}` : ""}`, { cls: "ok" }) : "",
    ].filter(Boolean).join("");
    const stage = x.doing_since && !done ? ["A fazer", "ok"] : [STAGE_LABEL[x.stage], STAGE_TONE[x.stage]];
    // the task itself first and big, read like a letter: who sent it to whom, the title, the text; the details after it
    const part = (label, html, cls = "") => `<section class="tv-part ${cls}"><small>${t(label)}</small><div class="tread">${html}</div></section>`;
    const sender = x.created_by && (group || x.created_by !== x.assignee) ? x.created_by : "";
    tv.querySelector(".m-tv-t").textContent = t("Tarefa");
    body.innerHTML = `<div class="m-tv-head m-tv-letter" style="${group ? "" : whoVar(x.assignee)}">
        <div class="m-tv-route">${sender ? `<span class="tv-sender" style="${whoVar(sender)}">${ui.avatar(nameOf(sender), "sm")}<b>${esc(isMe(sender) ? t("Tu") : nameOf(sender))}</b></span><i class="tv-arrow">${icon("chevron")}</i>` : ""}${group ? allPlate(group) : whoPlate(x.assignee)}
          <span class="m-tv-stage ${stage[1] || ""}">${t(stage[0])}</span></div>
        <h1>${x.priority === "urgent" ? '<i class="m-bang">!!</i>' : x.priority === "high" ? '<i class="m-bang high">!</i>' : ""}${esc(x.title)}</h1>
        <div class="m-tv-msg">${x.description ? `<div class="tread">${richText(x.description)}</div>` : `<p class="tv-none">${t("Sem descrição: o título diz tudo.")}</p>`}
          ${x.goal ? part("Objetivo", richText(x.goal)) : ""}
          ${x.requirements?.length ? part("O que tem de ficar feito", `<ul>${x.requirements.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>`) : ""}
          ${x.result ? part("Resultado", richText(x.result), "ok") : ""}</div></div>
      ${x.progress > 0 && !done ? `<div class="m-tv-prog"><div>${ui.progress(x.progress, "ai")}</div><span>${x.progress}%</span></div>` : ""}
      ${x.current_action && running ? `<p class="m-tv-now">${esc(x.current_action)}</p>` : ""}
      ${x.blocked_reason ? `<p class="m-tv-block">${icon("alert")}<span>${esc(x.blocked_reason)}</span></p>` : ""}
      ${doingBanner(x, held)}
      <section class="m-tv-sec m-tv-details"><h3>${t("Pormenores")}${group ? ` · ${esc(whoLeft(group))}` : ""}</h3><div class="m-list m-tv-facts">${facts}</div></section>
      ${group ? `<section class="m-tv-sec"><h3>${t("Quem já fez")}</h3><div class="m-list">${group.map((y) => `<div class="m-tv-row"><span class="m-tv-ic">${ui.avatar(nameOf(y.assignee), "sm")}</span>
        <em>${esc(nameOf(y.assignee))}${y.assignee === me.username ? ` (${t("tu")})` : ""}</em><b class="${y.stage === "done" ? "ok" : ""}">${y.stage === "done" ? t("Feito") : y.doing_since ? t("A fazer agora") : t(STAGE_LABEL[y.stage])}</b></div>`).join("")}</div></section>` : ""}
      ${(x.log || []).length ? `<section class="m-tv-sec"><h3>${t("Histórico")}</h3><div class="m-list m-tv-log">${x.log.slice(-12).reverse().map((e) => `<div class="m-tv-logrow">${ui.avatar(e.name, "sm")}
        <div><span><b>${esc(e.name)}</b> ${esc(group && e.kind === "task_created" ? t("criou a tarefa para todos") : e.message)}</span><time>${fmt.day(e.at)} ${fmt.hhmm(e.at)}</time></div></div>`).join("")}</div></section>` : ""}
      <div class="m-list m-tv-danger"><button class="m-tv-row" data-tv="trash"><span class="m-tv-ic">${icon("trash")}</span><em>${t("Apagar tarefa")}</em></button></div>`;
    body.scrollTop = keep;
    // the bar at the bottom: the one thing to do next, big enough for a thumb
    const foot = running ? `<button class="m-tv-btn" data-tv="pause">${icon("pause")}${t("Pausar")}</button><button class="m-tv-btn bad" data-tv="stop">${icon("stop")}${t("Parar")}</button>`
      : x.status === "PAUSED" || x.status === "NEEDS_HELP" ? `<button class="m-tv-btn" data-tv="resume">${icon("play")}${t("Retomar")}</button><button class="m-tv-btn bad" data-tv="stop">${icon("stop")}${t("Parar")}</button>`
      : done ? `<button class="m-tv-btn" data-tv="reopen">${t("Reabrir")}</button>`
      : `<button class="m-tv-btn main" data-tv="done">${icon("check")}${t("Concluir")}</button>`;
    tv.querySelector(".m-tv-foot").innerHTML = foot;

    const again = () => phoneTask(id);
    const patch = async (bodyIn, ok) => {
      try { await api(`/api/tasks/${x.id}`, { method: "PATCH", body: bodyIn }); if (ok) flash(t(ok)); } catch (err) { flash(err.message); }
      return again();
    };
    const setDue = async () => {
      const friday = (5 - new Date().getDay() + 7) % 7;
      const pick = await actionSheet(t("Prazo"), [["0", "Hoje 18:00"], ["1", "Amanhã 18:00"], ...(friday > 1 ? [[String(friday), "Sexta 18:00"]] : []), ["7", "Daqui a 1 semana"],
        ["pick", "Escolher dia e hora…"], ...(x.deadline ? [["none", "Tirar prazo", "bad"]] : [])]);
      if (pick === null) return;
      if (pick === "none") return patch({ deadline: null }, "Prazo tirado.");
      if (pick === "pick") return formModal("Prazo", field("Dia e hora", `<input type="datetime-local" name="due" required value="${x.deadline ? new Date(new Date(x.deadline).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : dueAt(0)}">`, true),
        async (v) => { await api(`/api/tasks/${x.id}`, { method: "PATCH", body: { deadline: new Date(v.due).toISOString() } }); flash(t("Prazo guardado.")); again(); });
      return patch({ deadline: new Date(dueAt(Number(pick))).toISOString() }, "Prazo guardado.");
    };
    const setState = async () => {
      const pick = await actionSheet(t("Mudar o estado"), [["TODO", "Por fazer"], ["BLOCKED", "Bloqueada"], ["REVIEW", "Em revisão"], ["COMPLETED", "Concluída"]].filter(([s]) => s !== x.status));
      if (!pick) return;
      if (pick === "BLOCKED") return formModal("Marcar como bloqueada", field("O que está a bloquear?", '<textarea name="blocked_reason"></textarea>', true),
        async (v) => { await api(`/api/tasks/${x.id}`, { method: "PATCH", body: { status: "BLOCKED", blocked_reason: v.blocked_reason } }); again(); }, { submit: "Bloquear" });
      return patch({ status: pick }, pick === "COMPLETED" ? "Tarefa concluída." : "");
    };
    const edit = async () => {
      const [users, projects] = await Promise.all([api("/api/users"), api("/api/projects")]);
      formModal("Editar tarefa", taskFields(x, users, projects), async (v) => {
        const b = taskBody(v);
        if (held) delete b.assignee;   // while the agent has it, the task stays where it is
        await api(`/api/tasks/${x.id}`, { method: "PATCH", body: b });
        again();
      }, { wide: true });
    };
    const trash = async () => {
      if (held) return flash(t("O agente está a trabalhar nesta tarefa: pausa-a ou pára-a primeiro."));
      const pick = await actionSheet(t("Apagar «{t}»?", { t: x.title }), [["mistake", "Apagar tarefa", "bad"]]);
      if (pick && (await trashTaskPhone(x.id, x.title))) closeTask();
    };
    tv.onclick = async (e) => {
      e.stopPropagation();   // shell.js closes sheets on a click outside them; this screen is not one of those
      const el = e.target.closest("[data-tv], [data-act]");
      if (!el) return;
      const act = el.dataset.tv || el.dataset.act;
      if (act === "close") return closeTask();
      if (act === "due") return setDue();
      if (act === "trash") return trash();
      if (act === "done") { el.disabled = true; navigator.vibrate?.(14); return patch({ status: "COMPLETED" }, "Tarefa concluída."); }
      if (act === "reopen") return patch({ status: "TODO" }, "Tarefa reaberta.");
      if (act === "doing" || act === "notdoing") { navigator.vibrate?.(14); return patch({ doing: act === "doing" }, act === "doing" ? "A equipa já vê que estás a fazer isto." : "Paraste esta tarefa."); }
      if (act === "pause" || act === "stop" || act === "resume") {
        if (act === "stop" && (await actionSheet(t("Parar o agente nesta tarefa?"), [["stop", "Parar", "bad"]])) !== "stop") return;
        try { await api(`/api/tasks/${x.id}/control`, { method: "POST", body: { action: act } }); flash(t("Pedido enviado ao agente.")); } catch (err) { flash(err.message); }
        return again();
      }
      if (act === "more") {
        const pick = await actionSheet(x.title, [["edit", "Editar"], ...(done ? [] : [["due", x.deadline ? "Mudar o prazo" : "Dar um prazo"]]),
          ...(held ? [] : [["state", "Mudar o estado"]]), ...(canGiveToAI(x) ? [["ai", "Entregar ao escritório"]] : []),
          ...(!done && !held && x.assignee === me.username ? [[x.doing_since ? "notdoing" : "doing", x.doing_since ? "Já não estou a fazer isto" : "Estou a fazer isto"]] : []),
          ["trash", "Apagar tarefa", "bad"]]);
        if (pick === "edit") return edit();
        if (pick === "due") return setDue();
        if (pick === "state") return setState();
        if (pick === "ai") return assignToAI(x);
        if (pick === "doing" || pick === "notdoing") return patch({ doing: pick === "doing" }, pick === "doing" ? "A equipa já vê que estás a fazer isto." : "Paraste esta tarefa.");
        if (pick === "trash") return trash();
      }
    };
  }
  const desktopTask = openTaskModal;
  openTaskModal = (id) => (phone() ? phoneTask(id) : desktopTask(id));

  // a link to a task (a notification, "A fazer agora") opens it over the tab you are on, instead of moving you to Tarefas
  document.addEventListener("click", (e) => {
    if (!phone() || e.defaultPrevented) return;
    const a = e.target.closest('a[href^="#/tarefas/"]'), m = a && a.getAttribute("href").match(/^#\/tarefas\/(\d+)$/);
    if (!m || a.closest(".modal")) return;
    e.preventDefault();
    phoneTask(Number(m[1]));
  });

  // swipe back from the left edge, as on any iOS screen that was pushed
  let edge = null;
  tv.addEventListener("touchstart", (e) => { const p = e.touches[0]; edge = p.clientX < 28 ? { x: p.clientX, dx: 0 } : null; }, { passive: true });
  tv.addEventListener("touchmove", (e) => {
    if (!edge) return;
    edge.dx = Math.max(0, e.touches[0].clientX - edge.x);
    tv.style.transition = "none"; tv.style.transform = `translateX(${edge.dx}px)`;
  }, { passive: true });
  tv.addEventListener("touchend", () => {
    if (!edge) return;
    tv.style.transition = ""; tv.style.transform = "";
    if (edge.dx > window.innerWidth * 0.3) closeTask();
    edge = null;
  });

  /* ---------- swipe a task row to the left: "Apagar" in red behind it, as in Mail or Reminders ----------
     A short swipe leaves the button showing; a long one deletes at once. Either way "Desfazer" brings it back. */
  const SW = 88;
  let sw = null, swiped = 0;
  const shut = (except) => document.querySelectorAll(".m-task.sw-open").forEach((r) => { if (r !== except) { r.classList.remove("sw-open"); r.style.setProperty("--sw", "0px"); } });
  document.addEventListener("touchstart", (e) => {
    if (!phone()) return;
    const row = e.target.closest(".m-task[data-id]");
    if (!e.target.closest(".m-sw-del")) shut(row);
    if (!row || row.closest("#m-tv") || e.target.closest(".m-check, .m-doing, .m-sw-del")) { sw = null; return; }
    const p = e.touches[0];
    sw = { row, x: p.clientX, y: p.clientY, base: row.classList.contains("sw-open") ? -SW : 0, dx: 0, dir: null };
  }, { passive: true });
  document.addEventListener("touchmove", (e) => {
    if (!sw) return;
    const p = e.touches[0], dx = p.clientX - sw.x, dy = p.clientY - sw.y;
    if (!sw.dir) { if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) sw.dir = "x"; else if (Math.abs(dy) > 8) { sw = null; return; } else return; }
    e.preventDefault();
    const row = sw.row;
    if (!row.querySelector(".m-sw-del")) row.insertAdjacentHTML("beforeend", `<button class="m-sw-del" data-sw-del="${row.dataset.id}">${icon("trash")}<span>${t("Apagar")}</span></button>`);
    sw.dx = Math.min(0, sw.base + dx);
    row.classList.add("sw-drag"); row.classList.toggle("sw-far", sw.dx < -row.offsetWidth * 0.55);
    row.style.setProperty("--sw", `${sw.dx}px`);
  }, { passive: false });
  document.addEventListener("touchend", () => {
    if (!sw) return;
    const { row, dx, dir } = sw; sw = null;
    if (dir !== "x") return;
    swiped = Date.now();
    row.classList.remove("sw-drag");
    if (dx < -row.offsetWidth * 0.55) return swipeDelete(row);
    const open = dx < -SW / 2;
    row.classList.toggle("sw-open", open); row.style.setProperty("--sw", open ? `${-SW}px` : "0px");
  });
  async function swipeDelete(row) {
    const id = Number(row.dataset.id), title = row.querySelector("b")?.textContent || "";
    row.classList.add("sw-gone"); row.style.setProperty("--sw", `${-row.offsetWidth}px`);
    if (!(await trashTaskPhone(id, title))) { row.classList.remove("sw-gone", "sw-open"); row.style.setProperty("--sw", "0px"); }
  }
  // a tap right after a swipe is the end of the swipe, not a tap; a tap on an open row closes it; the red button deletes
  document.addEventListener("click", (e) => {
    if (!phone()) return;
    const del = e.target.closest("[data-sw-del]");
    if (del) { e.preventDefault(); e.stopPropagation(); return swipeDelete(del.closest(".m-task")); }
    const open = e.target.closest(".m-task.sw-open");
    if (Date.now() - swiped < 400 || open) { e.preventDefault(); e.stopPropagation(); if (open) shut(); }
  }, true);

  // signing in with #login= draws the first page before this file has said it is a phone: draw it again as one
  if (phone() && $("view").children.length) render();
})();
