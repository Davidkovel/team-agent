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

  /* Início: short, a few numbers and what is next. Everything else has its own screen. */
  const desktopHome = HUB_VIEWS.home;
  HUB_VIEWS.home = (r) => (phone() ? phoneHome() : desktopHome(r));
  async function phoneHome() {
    const hour = new Date().getHours(), greeting = hour < 6 ? "Boa noite" : hour < 13 ? "Bom dia" : hour < 20 ? "Boa tarde" : "Boa noite";
    const date = new Date().toLocaleDateString("pt-PT", { weekday: "long", day: "numeric", month: "long" });
    page(`<div class="m-screen" id="m-home">
      <header class="m-large"><span>${esc(date[0].toUpperCase() + date.slice(1))}</span><h1>${esc(t(greeting))}, <em>${esc(me.display_name)}</em></h1></header>
      <div class="m-tiles" id="m-tiles">${ui.skeleton(2)}</div><div id="m-todo"></div><div id="m-last"></div>
      <div class="m-banner" aria-hidden="true"><img src="assets/amg-front-1200.webp" alt=""></div></div>`);
    const load = async () => {
      const [tasks, team, inbox] = await Promise.all([api("/api/tasks"), api("/api/team"), request("/api/notifications?limit=6")]);
      if (!$("m-home")) return;
      const mine = tasks.filter((x) => x.assignee === me.username && x.stage !== "done" && !x.trashed_at);
      const online = team.filter((m) => m.status !== "OFFLINE").length;
      const dueNow = mine.filter((x) => { const n = daysLate(x); return n !== null && n >= 0; }), urgent = mine.filter((x) => rank(x) < 2);
      const tile = (href, ic, n, label, hot = false, tab = "") => `<a class="m-tile ${hot ? "hot" : ""}" href="${href}" ${tab ? `data-goto="${tab}"` : ""}>${icon(ic)}<b>${n}</b><span>${t(label)}</span></a>`;
      paint($("m-tiles"), tile("#/tarefas", "calendar", dueNow.length, "Para hoje", dueNow.length > 0, "hoje") + tile("#/tarefas", "flag", urgent.length, "Urgentes", urgent.length > 0, "urgentes")
        + tile("#/avisos", "bell", inbox.unread, "Avisos por ler", inbox.unread > 0) + tile("#/equipa", "users", `${online}/${team.length}`, "Equipa online"));
      paint($("m-todo"), `<section class="m-sec"><header><b>${t("Para fazer")}</b><a href="#/tarefas">${t("Ver todas")}</a></header>${mine.length
        ? `<div class="m-list">${[...mine].sort((a, b) => rank(a) - rank(b) || String(a.deadline || "9").localeCompare(String(b.deadline || "9")) || b.id - a.id).slice(0, 4).map((x) => `<a class="m-row2" href="#/tarefas/${x.id}"><i class="m-dot ${rank(x) < 2 ? "hot" : ""}"></i>
            <div><b>${esc(x.title)}</b><span>${[esc(x.project_name || x.company || x.project || t("Sem projeto")), deadlineLabel(x)].filter(Boolean).join(" · ")}</span></div>${icon("chev")}</a>`).join("")}</div>`
        : `<div class="m-empty">${t("Nada por fazer. Bom trabalho.")}</div>`}</section>`);
      paint($("m-last"), `<section class="m-sec"><header><b>${t("Últimos avisos")}</b><a href="#/avisos">${t("Ver todos")}</a></header>${inbox.items.length
        ? `<div class="m-list">${inbox.items.slice(0, 3).map(nrow).join("")}</div>` : `<div class="m-empty">${t("Sem notificações.")}</div>`}</section>`);
    };
    reload = load;
    $("view").onclick = (e) => {
      const go = e.target.closest("[data-goto]"); if (go) taskTab = go.dataset.goto; // the tile opens Tarefas on its own tab
      const row = e.target.closest("[data-n]"); if (row) api("/api/notifications/read", { method: "POST", body: { ids: [Number(row.dataset.n)] } }).then(() => hubNews()).catch(() => {}); };
    await load().catch((e) => { if (e.message !== "unauthorized") $("m-tiles").innerHTML = ui.error(e.message); });
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

  /* Tarefas: not the computer's board but a list with a tab for what matters. Hoje (due today or late), Urgentes (high or urgent),
     Todas and Feitas. A task shows how important it is and how late; the circle finishes it, a tap opens it. */
  const desktopTarefas = HUB_VIEWS.tarefas;
  HUB_VIEWS.tarefas = (r) => (phone() ? phoneTarefas(r) : desktopTarefas(r));
  let taskTab = null, taskScope = "mine";
  const OPEN_ORDER = ["in_progress", "todo", "review", "approval", "blocked"];
  const rank = (x) => (x.priority === "urgent" ? 0 : x.priority === "high" ? 1 : 2);
  const daysLate = (x) => {
    if (!x.deadline) return null;
    const d = new Date(x.deadline), now = new Date();
    return Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5);
  };
  const deadlineLabel = (x) => {
    const n = daysLate(x);
    if (n === null) return "";
    if (n > 0) return `<span class="late">${t(n === 1 ? "Atrasada há 1 dia" : "Atrasada há {n} dias", { n })}</span>`;
    return n === 0 ? `<span class="today">${t("Hoje")}</span>` : n === -1 ? t("Amanhã") : fmt.date(x.deadline);
  };
  const taskRow = (x, team) => `<div class="m-task ${x.priority === "urgent" ? "urgent" : x.priority === "high" ? "high" : ""} ${x.stage === "done" ? "done" : ""}" data-id="${x.id}">
    <button class="m-check" data-done="${x.id}" aria-label="${t("Concluir")}">${x.stage === "done" ? icon("check") : ""}</button>
    <div><b>${esc(x.title)}</b><span class="sub">${[x.project_name || x.company || x.project, team ? nameOf(x.assignee) : "", deadlineLabel(x)].filter(Boolean).join(" · ")}</span></div>
    ${x.priority === "urgent" || x.priority === "high" ? `<em class="m-pill ${x.priority}">${t(PRIORITY[x.priority])}</em>` : x.stage === "in_progress" ? `<em class="m-pill ai">${t("Em curso")}</em>` : x.stage === "blocked" ? `<em class="m-pill urgent">${t("Bloqueada")}</em>` : ""}</div>`;

  async function phoneTarefas(r) {
    page(`<div class="m-screen" id="m-tasks">
      <header class="m-headrow"><div class="m-large"><span id="m-t-sub">&nbsp;</span><h1>${t("Tarefas")}</h1></div><button class="m-plus" data-new aria-label="${t("Nova tarefa")}">${icon("plus")}</button></header>
      <div id="m-t-body">${ui.skeleton(5)}</div></div>`);
    const load = async () => {
      const all = (await api("/api/tasks")).filter((x) => !x.trashed_at);
      if (!$("m-tasks")) return;
      const team = all.some((x) => x.assignee !== me.username);
      const scope = team && taskScope === "team" ? all : all.filter((x) => x.assignee === me.username);
      const open = scope.filter((x) => x.stage !== "done");
      const late = (x) => { const n = daysLate(x); return n !== null && n >= 0; }; // today or already late
      const sets = {
        hoje: open.filter(late),
        urgentes: open.filter((x) => rank(x) < 2),
        todas: open,
        feitas: scope.filter((x) => x.stage === "done").sort((a, b) => String(b.completed_at || "").localeCompare(String(a.completed_at || ""))).slice(0, 30),
      };
      if (!taskTab) taskTab = sets.hoje.length ? "hoje" : sets.urgentes.length ? "urgentes" : "todas";
      const overdue = open.filter((x) => (daysLate(x) ?? -1) > 0).length;
      $("m-t-sub").textContent = `${open.length} ${t("por fazer")}${sets.hoje.length ? ` · ${sets.hoje.length} ${t("para hoje")}` : ""}${overdue ? ` · ${overdue} ${t(overdue === 1 ? "atrasada" : "atrasadas")}` : ""}`;
      const seg = [["hoje", "Hoje"], ["urgentes", "Urgentes"], ["todas", "Todas"], ["feitas", "Feitas"]]
        .map(([id, label]) => `<button data-tab="${id}" class="${id === taskTab ? "on" : ""} ${(id === "hoje" || id === "urgentes") && sets[id].length ? "hot" : ""}">${t(label)}${id !== "feitas" ? `<i>${sets[id].length}</i>` : ""}</button>`).join("");
      const sort = (list) => [...list].sort((a, b) => rank(a) - rank(b) || String(a.deadline || "9").localeCompare(String(b.deadline || "9")) || b.id - a.id);
      const group = (title, list, tone = "") => (list.length ? `<section class="m-sec"><h3 class="m-grp ${tone}">${t(title)} · ${list.length}</h3><div class="m-list">${sort(list).map((x) => taskRow(x, taskScope === "team")).join("")}</div></section>` : "");
      const cur = sets[taskTab];
      let body;
      if (taskTab === "hoje") body = group("Atrasadas", cur.filter((x) => daysLate(x) > 0), "late") + group("Para hoje", cur.filter((x) => daysLate(x) === 0), "today");
      else if (taskTab === "urgentes") body = group("Urgentes", cur.filter((x) => x.priority === "urgent"), "late") + group("Prioridade alta", cur.filter((x) => x.priority === "high"), "today");
      else if (taskTab === "todas") body = OPEN_ORDER.map((st) => group(STAGE_LABEL[st], cur.filter((x) => x.stage === st))).join("");
      else body = cur.length ? `<div class="m-list">${cur.map((x) => taskRow(x, taskScope === "team")).join("")}</div>` : "";
      const empty = { hoje: ["calendar", "Nada para hoje", "Dá um prazo a uma tarefa e ela aparece aqui no dia."], urgentes: ["flag", "Nada urgente", "As tarefas de prioridade alta ou urgente aparecem aqui."],
        todas: ["tasks", "Sem tarefas", "Cria a primeira com o botão +."], feitas: ["check", "Ainda nada concluído", "O que concluíres aparece aqui."] }[taskTab];
      paint($("m-t-body"), `<div class="m-seg">${seg}</div>${team ? `<div class="m-seg small"><button data-scope="mine" class="${taskScope === "mine" ? "on" : ""}">${t("Minhas")}</button><button data-scope="team" class="${taskScope === "team" ? "on" : ""}">${t("Equipa")}</button></div>` : ""}
        ${body || ui.empty(empty[0], empty[1], empty[2])}`);
    };
    reload = load;
    $("view").onclick = async (e) => {
      if (e.target.closest("[data-new]")) return newTask();
      const done = e.target.closest("[data-done]");
      if (done) {
        done.disabled = true;
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
