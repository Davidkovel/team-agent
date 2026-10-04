// The phone shell: an iOS-style bar on top, tabs at the bottom and a "Mais" sheet, built from NAV (app.js).
// mobile.css shows all of it only under html.is-phone, which is set on a small touch screen (or with ?phone=1 to try it on a
// computer). On a computer the page is exactly what it was: these elements stay hidden and nothing else changes.
(function () {
  const small = matchMedia("(max-width: 900px)"), touch = matchMedia("(pointer: coarse)"), tryIt = /[?&]phone=1\b/.test(location.search);
  const apply = () => document.documentElement.classList.toggle("is-phone", small.matches && (touch.matches || tryIt));
  apply();
  small.addEventListener("change", apply);
  touch.addEventListener("change", apply);

  Object.assign(ICONS, HUB_ICONS); // the Hub adds these after sign-in; the bar is built before
  ICONS.more = '<circle cx="5" cy="12" r="1.7" fill="currentColor"/><circle cx="12" cy="12" r="1.7" fill="currentColor"/><circle cx="19" cy="12" r="1.7" fill="currentColor"/>';
  const PRIMARY = ["Início", "Tarefas", "Equipa", "Trabalho"]; // the other sections live under "Mais"
  const primary = NAV.filter(([label]) => PRIMARY.includes(label));

  document.body.insertAdjacentHTML("beforeend", `
    <header id="m-bar">
      <div class="m-left"><a href="#/home" aria-label="Início"><img class="m-star" src="assets/icon-192.png" alt=""></a></div>
      <div class="m-title" id="m-title"></div>
      <div class="m-right">
        <button class="m-btn" id="m-search" aria-label="Procurar">${icon("search")}</button>
        <button class="m-btn" id="m-bell" aria-label="Notificações">${icon("bell")}<i class="m-count" id="m-bell-n" hidden></i></button>
      </div>
    </header>
    <nav id="m-tabs">${primary.map(([label, ic, pages]) => `<a href="#/${pages[0][0]}" data-sec="${label}">${icon(ic)}<span>${t(label)}</span>${badgeHtml(pages[0][0])}</a>`).join("")}
      <button data-more aria-label="Mais">${icon("more")}<span>${t("Mais")}</span></button></nav>
    <div id="m-sheet" hidden><div class="m-bg"></div><div class="m-box"></div></div>`);

  const tabs = $("m-tabs"), sheet = $("m-sheet");

  // title and highlighted tab follow the page
  const sync = () => {
    let r;
    try { r = route(); } catch { return; }
    const section = NAV.find(([, , pages]) => pages.some(([id]) => id === r.tab));
    const label = section ? section[0] : "Início";
    $("m-title").textContent = t(label);
    tabs.querySelectorAll("[data-sec]").forEach((a) => a.classList.toggle("on", a.dataset.sec === label));
    tabs.querySelector("[data-more]").classList.toggle("on", !PRIMARY.includes(label));
  };
  window.addEventListener("hashchange", () => { sheet.hidden = true; sync(); });
  new MutationObserver(sync).observe($("view"), { childList: true });
  sync();

  // the bell's counter is kept by the Hub on the sidebar's bell: mirror it
  const mirror = () => { const n = $("bell-n"); $("m-bell-n").textContent = n.textContent; $("m-bell-n").hidden = n.hidden || !n.textContent; };
  new MutationObserver(mirror).observe($("bell-n"), { attributes: true, childList: true, characterData: true, subtree: true });
  mirror();

  // a click that is not inside the panel closes it (shell.js), so these stop at the button
  $("m-bell").onclick = (e) => { e.stopPropagation(); sheet.hidden = true; toggleNotifications(); };
  $("m-search").onclick = (e) => { e.stopPropagation(); sheet.hidden = true; $("open-palette").click(); };

  function openMore() {
    const rows = [["chart", "Análise", "#/analise"], ["layers", "Memória", "#/memoria"], ["gear", "Definições", "#/definicoes"]];
    sheet.querySelector(".m-box").innerHTML = `<i class="m-grab"></i><h3>${t("Mais")}</h3><div class="m-list">
      ${rows.map(([ic, label, href]) => `<a class="m-row" href="${href}">${icon(ic)}${t(label)}</a>`).join("")}
      <button class="m-row" data-act="phone">${icon("bell")}${t("Notificações no telemóvel")}</button>
      <button class="m-row" data-act="ai">${icon("spark")}${t("Team AI")}</button></div>`;
    sheet.hidden = false;
  }
  tabs.querySelector("[data-more]").onclick = (e) => { e.stopPropagation(); sheet.hidden ? openMore() : (sheet.hidden = true); };
  sheet.onclick = (e) => {
    e.stopPropagation();
    const act = e.target.closest("[data-act]");
    if (act) {
      sheet.hidden = true;
      if (act.dataset.act === "phone") { $("notif-panel").hidden = false; drawPhone(); } else toggleAI(true);
    } else if (e.target.closest(".m-bg, a")) sheet.hidden = true;
  };
})();
