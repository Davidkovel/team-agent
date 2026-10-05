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
  onLive(["task", "notification", "presence", "approval"], () => { if (reload && ($("m-home") || $("m-av"))) reload(); });

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
      const today = new Date().toDateString();
      const doneToday = tasks.filter((x) => x.assignee === me.username && x.status === "COMPLETED" && x.completed_at && new Date(x.completed_at).toDateString() === today).length;
      const online = team.filter((m) => m.status !== "OFFLINE").length;
      const tile = (href, ic, n, label, hot = false) => `<a class="m-tile ${hot ? "hot" : ""}" href="${href}">${icon(ic)}<b>${n}</b><span>${t(label)}</span></a>`;
      paint($("m-tiles"), tile("#/tarefas", "tasks", mine.length, "Por fazer") + tile("#/avisos", "bell", inbox.unread, "Avisos por ler", inbox.unread > 0)
        + tile("#/equipa", "users", `${online}/${team.length}`, "Equipa online") + tile("#/tarefas", "check", doneToday, "Feitas hoje"));
      paint($("m-todo"), `<section class="m-sec"><header><b>${t("Para fazer")}</b><a href="#/tarefas">${t("Ver todas")}</a></header>${mine.length
        ? `<div class="m-list">${mine.slice(0, 4).map((x) => `<a class="m-row2" href="#/tarefas/${x.id}"><i class="m-dot ${x.priority === "high" ? "hot" : ""}"></i>
            <div><b>${esc(x.title)}</b><span>${esc(x.project_name || x.company || x.project || t("Sem projeto"))}${x.deadline ? " · " + fmt.date(x.deadline) : ""}</span></div>${icon("chev")}</a>`).join("")}</div>`
        : `<div class="m-empty">${t("Nada por fazer. Bom trabalho.")}</div>`}</section>`);
      paint($("m-last"), `<section class="m-sec"><header><b>${t("Últimos avisos")}</b><a href="#/avisos">${t("Ver todos")}</a></header>${inbox.items.length
        ? `<div class="m-list">${inbox.items.slice(0, 3).map(nrow).join("")}</div>` : `<div class="m-empty">${t("Sem notificações.")}</div>`}</section>`);
    };
    reload = load;
    $("view").onclick = (e) => { const row = e.target.closest("[data-n]"); if (row) api("/api/notifications/read", { method: "POST", body: { ids: [Number(row.dataset.n)] } }).then(() => hubNews()).catch(() => {}); };
    await load().catch((e) => { if (e.message !== "unauthorized") $("m-tiles").innerHTML = ui.error(e.message); });
  }

  /* Avisos: the notifications as an inbox, by day, unread first in bold. A tap marks it read and opens it. */
  HUB_VIEWS.avisos = async function () {
    page(`<div class="m-screen" id="m-av"><header class="m-large"><span id="m-av-sub"></span><h1>${t("Notificações")}</h1></header><div id="m-av-list">${ui.skeleton(5)}</div></div>`);
    const load = async () => {
      const inbox = await request("/api/notifications?limit=60");
      if (!$("m-av")) return;
      $("m-av-sub").textContent = inbox.unread ? t("{n} por ler", { n: inbox.unread }) : t("Tudo lido");
      const groups = {};
      for (const n of inbox.items) (groups[when(n.created_at)] ||= []).push(n);
      paint($("m-av-list"), `${inbox.unread ? `<button class="m-link" data-read-all>${t("Marcar tudo como lido")}</button>` : ""}${inbox.items.length
        ? ["Hoje", "Ontem", "Esta semana", "Mais antigas"].filter((g) => groups[g]).map((g) => `<section class="m-sec"><h3 class="m-grp">${t(g)}</h3><div class="m-list">${groups[g].map(nrow).join("")}</div></section>`).join("")
        : ui.empty("bell", "Sem notificações", "Aparece aqui o que precisa de ti: tarefas novas, aprovações, agentes parados.")}
        <section class="m-sec"><h3 class="m-grp">${t("No telemóvel")}</h3><div class="m-list"><button class="m-row2" data-phone>${icon("bell")}<div><b>${t("Receber as notificações no telemóvel")}</b>
          <span>${t("Para o aviso chegar ao ecrã de bloqueio")}</span></div>${icon("chev")}</button></div></section>`);
    };
    reload = load;
    $("view").onclick = async (e) => {
      const row = e.target.closest("[data-n]");
      if (row) api("/api/notifications/read", { method: "POST", body: { ids: [Number(row.dataset.n)] } }).then(() => hubNews()).catch(() => {});
      if (e.target.closest("[data-read-all]")) { await api("/api/notifications/read", { method: "POST", body: {} }); hubNews(); load(); }
      if (e.target.closest("[data-phone]")) { e.stopPropagation(); phoneSetup(); }
    };
    await load().catch((e) => { if (e.message !== "unauthorized") $("m-av-list").innerHTML = ui.error(e.message); });
  };
})();
