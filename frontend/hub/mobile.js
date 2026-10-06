// The phone: the Hub as an iOS app. A bar on top, tabs at the bottom (Início, Tarefas, Avisos, Trabalho, Mais) and a screen for each,
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
    ["avisos", "Avisos", "bell", ["avisos"]],
    ["empresas", "Trabalho", "building", ["empresas", "projetos", "codigo", "baredesk"]],
  ];

  // #/avisos only exists on the phone: on a computer the address falls back to Início, as any unknown one does
  const baseRoute = route;
  route = function () {
    if (phone() && /^#\/avisos/.test(location.hash)) return { tab: "avisos" };
    return baseRoute();
  };

  document.body.insertAdjacentHTML("beforeend", `
    <header id="m-bar">
      <div class="m-left"><a href="#/home" aria-label="Início"><img class="m-star" src="assets/icon-192.png" alt=""></a></div>
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
  const sync = () => {
    let r;
    try { r = route(); } catch { return; }
    const tab = TABS.find(([, , , pages]) => pages.includes(r.tab));
    const section = NAV.find(([, , pages]) => pages.some(([id]) => id === r.tab));
    $("m-title").textContent = t(r.tab === "avisos" ? "Notificações" : tab ? tab[1] : section ? section[0] : "Mais");
    tabs.querySelectorAll("[data-tab]").forEach((a) => a.classList.toggle("on", a.dataset.tab === (tab ? tab[0] : "more")));
    document.documentElement.dataset.page = r.tab;
  };
  window.addEventListener("hashchange", () => { sheet.hidden = true; sync(); });
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

  function openMore() {
    const rows = [["users", "Equipa", "#/equipa"], ["chart", "Análise", "#/analise"], ["layers", "Memória", "#/memoria"], ["gear", "Definições", "#/definicoes"]];
    sheet.querySelector(".m-box").innerHTML = `<i class="m-grab"></i><h3>${t("Mais")}</h3><div class="m-list">
      ${rows.map(([ic, label, href]) => `<a class="m-row" href="${href}">${icon(ic)}${t(label)}</a>`).join("")}
      <button class="m-row" data-act="phone">${icon("bell")}${t("Receber as notificações no telemóvel")}</button>
      <button class="m-row" data-act="ai">${icon("spark")}${t("Team AI")}</button></div>`;
    sheet.hidden = false;
  }
  tabs.querySelector('[data-tab="more"]').onclick = (e) => { e.stopPropagation(); sheet.hidden ? openMore() : (sheet.hidden = true); };
  const phoneSetup = () => { $("notif-panel").hidden = false; drawPhone(); };
  sheet.onclick = (e) => {
    e.stopPropagation();
    const act = e.target.closest("[data-act]");
    if (act) {
      sheet.hidden = true;
      if (act.dataset.act === "phone") phoneSetup(); else toggleAI(true);
    } else if (e.target.closest(".m-bg, a")) sheet.hidden = true;
  };

  /* ---------- the screens ---------- */
  let reload = null; // reloads the screen on view
  const busy = () => !sheet.hidden || !$("modal").hidden || document.activeElement?.matches("input, textarea, select");
  onLive(["task", "notification", "presence", "approval", "activity", "tick"], () => {
    if (reload && !busy() && ($("m-home") || $("m-av") || $("m-tasks"))) reload().catch(() => {});
  });

  const KIND_ICON = { task_new: "tasks", task: "check", approval_required: "alert", approval_decided: "check", agent_failed: "alert", agent_waiting: "clock" };
  const nrow = (n) => `<a class="m-nrow ${n.read ? "" : "unread"}" href="${esc(n.href || "#/home")}" data-n="${n.id}"><span class="m-ico">${icon(KIND_ICON[n.kind] || "bell")}</span>
    <div><b>${esc(n.title)}</b>${n.body ? `<span>${esc(n.body)}</span>` : ""}</div><time>${fmt.ago(n.created_at)}</time></a>`;
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
    if (scope === "team") return grouped;
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
  const faces = (list) => `<span class="m-faces">${list.slice(0, 3).map((y) => ui.avatar(nameOf(y.assignee), "sm")).join("")}</span>`;
  const taskRow = (x, team) => {
    const tone = x.stage === "done" ? "done" : x.priority === "urgent" ? "urgent" : x.priority === "high" ? "high" : "";
    const meta = [x.group ? t("Para todos") : "", esc(x.project_name || companies.find((c) => c.id === x.company)?.name || ""), x.stage === "done" ? "" : deadlineLabel(x),
      x.stage === "in_progress" ? `<span class="ai">${t("Em curso")}</span>` : x.stage === "blocked" ? `<span class="late">${t("Bloqueada")}</span>` : ""].filter(Boolean);
    return `<div class="m-task ${tone}" data-id="${x.id}">
      <button class="m-check" data-done="${x.id}" aria-label="${t("Concluir")}">${x.stage === "done" ? icon("tick") : ""}</button>
      <div><b>${tone === "urgent" ? '<i class="m-bang">!!</i>' : tone === "high" ? '<i class="m-bang high">!</i>' : ""}${esc(x.title)}</b>${meta.length ? `<span class="sub">${meta.join(" · ")}</span>` : ""}</div>
      ${x.group ? faces(x.group) : team ? faces([x]) : ""}</div>`;
  };
  const block = (title, list, tone, team, sort = true) => (list.length ? `<section class="m-sec"><h3 class="m-grp ${tone}"><i></i>${t(title)}<span>${list.length}</span></h3>
    <div class="m-list">${(sort ? [...list].sort(byImportance) : list).map((x) => taskRow(x, team)).join("")}</div></section>` : "");

  /* ---------- Início: who is where, three numbers, what is next, the latest notices ---------- */
  const desktopHome = HUB_VIEWS.home;
  HUB_VIEWS.home = (r) => (phone() ? phoneHome() : desktopHome(r));
  const PLACE = { pc: ["monitor", "No computador"], phone: ["phone", "No telemóvel"] };
  function mateRow(m) {
    const on = m.status !== "OFFLINE", where = (m.where || []).filter((w) => PLACE[w]);
    const working = m.status === "WORKING" && m.task;
    const line = working ? `${icon("bolt")}<span>${esc(t("A trabalhar"))}: ${esc(m.task)}</span>`
      : on ? (where.length ? where : ["pc"]).map((w) => `${icon(PLACE[w][0])}<span>${t(PLACE[w][1])}</span>`).join('<i class="m-sep"></i>')
      : `<span>${m.last_seen ? t("Visto {quando}", { quando: fmt.ago(m.last_seen) }) : t("Offline")}</span>`;
    const state = working ? "work" : m.status === "WAITING" || m.status === "PAUSED" ? "wait" : m.status === "ERROR" ? "bad" : on ? "on" : "off";
    const badge = on ? icon(where.includes("phone") && !where.includes("pc") ? "phone" : "monitor") : "";
    return `<a class="m-mate ${state}" href="#/equipa"><span class="m-face">${ui.avatar(m.display_name)}${on ? `<i class="m-place">${badge}</i>` : ""}</span>
      <div><b>${esc(m.display_name)}${m.user === me.username ? ` <small>${t("tu")}</small>` : ""}</b><span class="m-where">${line}</span></div>
      <em class="m-state">${t(working ? "Ocupado" : on ? "Online" : "Offline")}</em></a>`;
  }
  async function phoneHome() {
    const hour = new Date().getHours(), greeting = hour < 6 ? "Boa noite" : hour < 13 ? "Bom dia" : hour < 20 ? "Boa tarde" : "Boa noite";
    const date = new Date().toLocaleDateString("pt-PT", { weekday: "long", day: "numeric", month: "long" });
    page(`<div class="m-screen" id="m-home">
      <header class="m-large"><span>${esc(date[0].toUpperCase() + date.slice(1))}</span><h1>${esc(t(greeting))}, <em>${esc(me.display_name)}</em></h1></header>
      <div class="m-stats" id="m-stats">${ui.skeleton(1)}</div><div id="m-team"></div><div id="m-todo"></div><div id="m-last"></div></div>`);
    const load = async () => {
      const [tasks, team, inbox] = await Promise.all([api("/api/tasks"), api("/api/team"), request("/api/notifications?limit=6")]);
      if (!$("m-home")) return;
      const p = plan(scopeOf(tasks, "mine"));
      const stat = (tab, n, label, tone) => `<a class="m-stat ${n ? tone : ""}" href="${tab ? "#/tarefas" : "#/avisos"}" ${tab ? `data-goto="${tab}"` : ""}><b>${n}</b><span>${t(label)}</span></a>`;
      paint($("m-stats"), stat("hoje", p.nHoje, "Para hoje", "today") + stat("hoje", p.nHot, "Urgentes", "hot") + stat("", inbox.unread, "Por ler", "blue"));
      const online = team.filter((m) => m.status !== "OFFLINE").length;
      const order = [...team].sort((a, b) => (a.status === "OFFLINE") - (b.status === "OFFLINE") || (b.user === me.username) - (a.user === me.username));
      paint($("m-team"), `<section class="m-sec"><header><b>${t("Equipa")}</b><span class="m-online"><i></i>${online} ${t("de")} ${team.length} ${t("online")}</span></header>
        <div class="m-list">${order.map(mateRow).join("")}</div></section>`);
      const next = [...p.hoje.urgent, ...p.hoje.late, ...p.hoje.today, ...p.hoje.undated].sort(byImportance).slice(0, 4);
      paint($("m-todo"), `<section class="m-sec"><header><b>${t("A seguir")}</b><a href="#/tarefas" data-goto="hoje">${t("Ver todas")}</a></header>${next.length
        ? `<div class="m-list">${next.map((x) => taskRow(x, false)).join("")}</div>`
        : `<div class="m-empty">${icon("check")}<span>${t("Nada por fazer hoje. Bom trabalho.")}</span></div>`}</section>`);
      paint($("m-last"), `<section class="m-sec"><header><b>${t("Últimos avisos")}</b><a href="#/avisos">${t("Ver todos")}</a></header>${inbox.items.length
        ? `<div class="m-list">${inbox.items.slice(0, 3).map(nrow).join("")}</div>` : `<div class="m-empty">${icon("bell")}<span>${t("Sem avisos novos.")}</span></div>`}</section>`);
    };
    reload = load;
    $("view").onclick = async (e) => {
      const done = e.target.closest("[data-done]");
      if (done) {
        e.preventDefault(); done.disabled = true;
        done.closest(".m-task")?.classList.add("finishing");
        try { await api(`/api/tasks/${done.dataset.done}`, { method: "PATCH", body: { status: "COMPLETED" } }); flash(t("Tarefa concluída.")); } catch (err) { flash(err.message); }
        return load();
      }
      const task = e.target.closest(".m-task"); if (task) return openTaskModal(Number(task.dataset.id));
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

  /* Tarefas: like Reminders. Hoje, Próximas and Feitas, each in blocks; the circle finishes a task, a tap opens it. */
  const desktopTarefas = HUB_VIEWS.tarefas;
  HUB_VIEWS.tarefas = (r) => (phone() ? phoneTarefas(r) : desktopTarefas(r));
  let taskTab = "hoje", taskScope = "mine";

  async function phoneTarefas(r) {
    page(`<div class="m-screen" id="m-tasks">
      <header class="m-headrow"><div class="m-large"><span id="m-t-sub">&nbsp;</span><h1>${t("Tarefas")}</h1></div>
        <div class="m-head-act"><span id="m-t-scope"></span><button class="m-plus" data-new aria-label="${t("Nova tarefa")}">${icon("plus")}</button></div></header>
      <div id="m-t-body">${ui.skeleton(5)}</div></div>`);
    const load = async () => {
      const all = (await api("/api/tasks")).filter((x) => !x.trashed_at);
      if (!$("m-tasks")) return;
      const hasTeam = all.some((x) => x.assignee !== me.username), team = hasTeam && taskScope === "team";
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
      paint($("m-t-body"), `<div class="m-seg">${seg}</div>${body || `<div class="m-empty big">${icon(empty[0])}<b>${t(empty[1])}</b><span>${t(empty[2])}</span></div>`}`);
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
      const tab = e.target.closest("[data-tab]"), scope = e.target.closest("[data-scope]");
      if (tab) { taskTab = tab.dataset.tab; return load(); }
      if (scope) { taskScope = scope.dataset.scope; return load(); }
      const row = e.target.closest(".m-task");
      if (row) openTaskModal(Number(row.dataset.id));
    };
    const linked = Number(r.company) || openTask; // #/tarefas/12 and the widget's "Open Task" open that task
    if (linked) { openTask = null; openTaskModal(linked); }
    await load().catch((e) => { if (e.message !== "unauthorized") $("m-t-body").innerHTML = ui.error(e.message); });
  }
})();
