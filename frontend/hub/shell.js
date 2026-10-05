// Team AI Hub: what is on every page. The sidebar's tools, notifications, the command palette (Ctrl+K) and the Team AI.

/* ---------- notifications: kept by the server, per person; the counter survives a reload ---------- */
window.hubBell = true;
let lastNotification = null; // newest id already seen in this window: only later ones raise a toast
async function hubNews() {
  const inbox = await request("/api/notifications?limit=100");
  $("bell-n").textContent = inbox.unread;
  $("bell-n").hidden = !inbox.unread;
  const newest = inbox.items[0]?.id || 0;
  if (lastNotification !== null) {
    for (const n of inbox.items.filter((x) => x.id > lastNotification && !x.read).reverse()) {
      notify(n.title, n.href);
      if (document.hidden && window.Notification?.permission === "granted") new Notification("Agente AMG", { body: n.title, icon: "logo.png" });
    }
  }
  lastNotification = newest;
  if (!$("notif-panel").hidden) drawNotifications(inbox);
  return inbox;
}
/* The list of notifications, the same on the computer's bell and on the phone's Avisos: by day, each with what kind of thing
   it is written out, unread ones lit. «Escolher» turns on ticks to pick which ones to delete; the × deletes one at once. */
const NOTIF_KIND = {
  task_new: ["tasks", "Tarefa nova"], task: ["tasks", "Tarefa"], task_completed: ["check", "Tarefa concluída"],
  approval_required: ["alert", "Pede aprovação"], approval_decided: ["check", "Aprovação decidida"],
  agent_failed: ["alert", "Agente falhou"], agent_waiting: ["clock", "Agente à espera"],
};
const NOTIF_DAYS = ["Hoje", "Ontem", "Esta semana", "Mais antigas"];
function notifDay(iso) {
  const d = new Date(iso), now = new Date();
  const days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5);
  return days <= 0 ? "Hoje" : days === 1 ? "Ontem" : days < 7 ? "Esta semana" : "Mais antigas";
}
const notifSel = { on: false, picked: new Set(), confirm: false };  // the choosing mode, shared by the bell and Avisos

function notifToolbar(inbox) {
  const n = notifSel.picked.size;
  if (!notifSel.on) {
    return `<div class="nl-bar">${inbox.unread ? `<button class="btn quiet sm" data-nl="read-all">${t("Marcar tudo como lido")}</button>` : ""}
      ${inbox.items.length ? `<button class="btn sm" data-nl="pick">${icon("check")}${t("Escolher para apagar")}</button>` : ""}</div>`;
  }
  if (notifSel.confirm) {
    return `<div class="nl-bar nl-confirm"><b>${t(n === 1 ? "Apagar 1 notificação de vez?" : "Apagar {n} notificações de vez?", { n })}</b>
      <span><button class="btn sm nl-danger" data-nl="yes">${t("Sim, apagar")}</button> <button class="btn quiet sm" data-nl="no">${t("Não")}</button></span></div>`;
  }
  const all = inbox.items.length && n === inbox.items.length;
  return `<div class="nl-bar nl-picking"><span class="nl-count">${n ? t(n === 1 ? "1 escolhida" : "{n} escolhidas", { n }) : t("Toca nas que queres apagar")}</span>
    <span><button class="btn quiet sm" data-nl="all">${t(all ? "Nenhuma" : "Todas")}</button>
    <button class="btn quiet sm" data-nl="read">${t("Só as lidas")}</button>
    <button class="btn sm nl-danger" data-nl="delete" ${n ? "" : "disabled"}>${t("Apagar")}${n ? ` (${n})` : ""}</button>
    <button class="btn quiet sm" data-nl="cancel">${t("Cancelar")}</button></span></div>`;
}

function notifListHtml(inbox) {
  if (!inbox.items.length) return ui.empty("bell", "Sem notificações", "Só aparece aqui o que precisa de ti: tarefas novas, aprovações, agentes parados.");
  const groups = {};
  for (const n of [...inbox.items].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))) (groups[notifDay(n.created_at)] ||= []).push(n);
  const row = (n) => {
    const [ic, kind] = NOTIF_KIND[n.kind] || ["bell", "Aviso"], picked = notifSel.picked.has(n.id);
    return `<div class="nl-row ${n.read ? "" : "unread"} ${picked ? "picked" : ""} ${notifSel.on ? "picking" : ""}" data-n="${n.id}">
      ${notifSel.on ? `<span class="nl-tick" aria-hidden="true">${picked ? icon("check") : ""}</span>` : ""}
      <span class="nl-ico ${n.severity === "high" || n.kind.endsWith("failed") || n.kind === "approval_required" ? "hot" : ""}">${icon(ic)}</span>
      <a class="nl-main" href="${esc(n.href || "#/home")}" data-open="${n.id}">
        <span class="nl-kind">${t(kind)}${n.read ? "" : ` · <em>${t("por ler")}</em>`}</span>
        <b>${esc(n.title)}</b>${n.body ? `<span class="nl-body">${esc(n.body)}</span>` : ""}</a>
      <time title="${esc(fmt.date ? fmt.date(n.created_at) : n.created_at)}">${fmt.ago(n.created_at)}</time>
      ${notifSel.on ? "" : `<button class="nl-x" data-del="${n.id}" title="${t("Apagar esta notificação")}" aria-label="${t("Apagar esta notificação")}">×</button>`}</div>`;
  };
  return NOTIF_DAYS.filter((g) => groups[g]).map((g) => `<section class="nl-group"><h4>${t(g)} <i>${groups[g].length}</i></h4>${groups[g].map(row).join("")}</section>`).join("");
}

// One click handler for both places. Returns true when it handled the click; `redraw` paints the list again.
async function notifClick(e, inbox, redraw) {
  const act = e.target.closest("[data-nl]")?.dataset.nl, del = e.target.closest("[data-del]"), row = e.target.closest("[data-n]");
  const remove = async (body) => {
    try { const r = await api("/api/notifications/delete", { method: "POST", body }); flash(t(r.deleted === 1 ? "1 notificação apagada." : "{n} notificações apagadas.", { n: r.deleted })); }
    catch (err) { flash(err.message); }
    Object.assign(notifSel, { on: false, confirm: false }); notifSel.picked.clear();
    await hubNews(); await redraw();
  };
  if (act) {
    e.preventDefault();
    if (act === "read-all") { await api("/api/notifications/read", { method: "POST", body: {} }); await hubNews(); return redraw(), true; }
    if (act === "pick") { notifSel.on = true; notifSel.picked.clear(); }
    else if (act === "cancel") { notifSel.on = false; notifSel.confirm = false; notifSel.picked.clear(); }
    else if (act === "all") { const every = notifSel.picked.size === inbox.items.length; notifSel.picked.clear(); if (!every) inbox.items.forEach((n) => notifSel.picked.add(n.id)); }
    else if (act === "read") { notifSel.picked.clear(); inbox.items.filter((n) => n.read).forEach((n) => notifSel.picked.add(n.id)); if (!notifSel.picked.size) flash(t("Não há notificações lidas.")); }
    else if (act === "delete") notifSel.confirm = notifSel.picked.size > 0;
    else if (act === "no") notifSel.confirm = false;
    else if (act === "yes") { await remove({ ids: [...notifSel.picked] }); return true; }
    redraw(true);
    return true;
  }
  if (del) { e.preventDefault(); await remove({ ids: [Number(del.dataset.del)] }); return true; }
  if (row && notifSel.on) {   // choosing: a tap ticks it instead of opening it
    e.preventDefault();
    const id = Number(row.dataset.n);
    notifSel.picked.has(id) ? notifSel.picked.delete(id) : notifSel.picked.add(id);
    redraw(true);
    return true;
  }
  if (row) { api("/api/notifications/read", { method: "POST", body: { ids: [Number(row.dataset.n)] } }).then(() => hubNews()).catch(() => {}); return false; }
  return false;
}

let bellInbox = { unread: 0, items: [] };
function drawNotifications(inbox) {
  bellInbox = inbox;
  for (const id of [...notifSel.picked]) if (!inbox.items.some((n) => n.id === id)) notifSel.picked.delete(id);
  $("notif-panel").innerHTML = `<div class="pop-head"><b>${t("Notificações")}${inbox.unread ? ` <i class="nl-badge">${inbox.unread}</i>` : ""}</b>
      <button class="btn quiet sm" id="phone-open">${t("Telemóvel")}</button></div>
    ${notifToolbar(inbox)}<div class="pop-body nl-list">${notifListHtml(inbox)}</div>`;
}
/* The same notifications on the phone, through the ntfy app: the Hub only shows which topic to follow. */
// The AMG app's own notifications (webpush.py): only on the phone, and only when the app is opened over https from the home screen.
function appPushHtml(wp) {
  if (!document.documentElement.classList.contains("is-phone") || !wp.available) return "";
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  let body;
  if (!window.isSecureContext) body = `<span>${t("A app AMG pode mostrar ela própria as notificações, com o nome e o ícone da estrela. Para isso tem de ser aberta por https, e agora está em http.")}</span>`;
  else if (!standalone) body = `<span>${t("Adiciona a app ao ecrã principal (Partilhar, Adicionar ao ecrã principal) e abre-a por lá para ligar as notificações.")}</span>`;
  else if (wp.subscribed) body = `<span>${t("Ligadas: a app AMG recebe as notificações neste telemóvel.")}</span>
    <span><button class="btn sm" id="wp-test">${t("Enviar um teste da app")}</button> <button class="btn quiet sm" id="wp-off">${t("Desligar")}</button></span>`;
  else body = `<button class="btn primary" id="wp-enable">${t("Ativar as notificações da app")}</button>`;
  return `<div style="display:grid;gap:10px;padding-bottom:14px;border-bottom:.5px solid rgba(255,255,255,.12)"><b>${t("Notificações da app AMG")}</b>${body}</div><b>${t("Ou com a app ntfy")}</b>`;
}
async function enableAppPush() {
  try {
    const reg = await navigator.serviceWorker.register("sw.js");
    await navigator.serviceWorker.ready;
    if ((await Notification.requestPermission()) !== "granted") return drawPhone("As notificações estão recusadas: ativa-as em Definições, Notificações, AMG.");
    const { key } = await api("/api/webpush/key");
    const raw = atob((key + "=".repeat((4 - (key.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
    const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: Uint8Array.from(raw, (c) => c.charCodeAt(0)) }));
    await api("/api/webpush/subscribe", { method: "POST", body: sub.toJSON() });
    return drawPhone("Ligado: a app AMG já recebe as notificações. Podes desligar o ntfy aqui em baixo para não receberes duas.");
  } catch (err) { return drawPhone("Não deu para ligar: " + err.message); }
}
async function drawPhone(note = "") {
  const wp = await api("/api/webpush/key").catch(() => ({ available: false }));
  const p = await api("/api/phone", { method: "POST", body: {} });
  $("notif-panel").innerHTML = `<div class="pop-head"><b>${t("Notificações no telemóvel")}</b>
      <button class="btn quiet sm" id="phone-back">${t("Voltar")}</button></div>
    <div class="pop-body" style="padding:12px 14px;display:grid;gap:12px">
      ${appPushHtml(wp)}
      <span>${t("1. Instala a app «ntfy» no telemóvel (Play Store ou App Store).")}</span>
      <span>${t("2. Copia o teu código. É só teu: não o partilhes.")}</span>
      <code id="phone-topic" style="user-select:all;word-break:break-all">${esc(p.topic)}</code>
      <button class="btn primary" id="phone-copy">${t("Copiar o código")}</button>
      <span>${t("3. Abre o ntfy, toca em «+», cola o código e toca em «Subscribe». Aceita as notificações quando o telemóvel perguntar.")}</span>
      <span>${t("4. Volta aqui e toca em «Enviar um teste»: tem de aparecer a notificação «Agente AMG».")}</span>
      <span><button class="btn sm" id="phone-test">${t("Enviar um teste")}</button>
        <button class="btn quiet sm" id="phone-off">${t("Desligar o telemóvel")}</button></span>
      ${note ? `<b>${esc(t(note))}</b>` : ""}</div>`;
}
async function toggleNotifications(open = $("notif-panel").hidden) {
  $("notif-panel").hidden = !open;
  if (!open) { notifSel.on = notifSel.confirm = false; notifSel.picked.clear(); }
  if (open) drawNotifications(await hubNews());
}
onLive(["notification"], hubNews);

/* ---------- command palette ---------- */
const COMMANDS = [
  ["Criar tarefa", "plus", () => newTask()],
  ["Entregar tarefa à IA", "bot", () => newTask({ for_ai: "developer" })],
  ["Perguntar à Team AI", "spark", () => toggleAI(true)],
  ["Ver agentes", "bot", "#/agentes"], ["Ver aprovações", "check", "#/aprovacoes"], ["Ao vivo", "pulse", "#/aovivo"],
  ["Tarefas", "tasks", "#/tarefas"], ["Projetos", "folder", "#/projetos"], ["Empresas", "building", "#/empresas"], ["Código", "code", "#/codigo"],
  ["Histórico", "history", "#/historico"], ["Semana", "calendar", "#/semana"], ["Equipa", "users", "#/equipa"], ["Análise", "chart", "#/analise"],
  ["Uso de IA", "token", "#/uso"], ["Despesas", "wallet", "#/despesas"], ["Memória", "layers", "#/memoria"], ["Definições", "gear", "#/definicoes"],
  ["Início", "home", "#/home"],
  ["BareDesk", "bag", "#/baredesk"],
];
const RESULT_ICON = { person: "users", task: "tasks", project: "folder", company: "building", memory: "layers", approval: "check", activity: "history", code: "code" };
const RESULT_LABEL = { person: "Pessoa", task: "Tarefa", project: "Projeto", company: "Empresa", memory: "Memória", approval: "Aprovação", activity: "Atividade", code: "Código" };
let palItems = [], palIndex = 0, palTimer = null, palQuery = 0;

function drawPalette(results = []) {
  const q = $("pal-q").value.trim().toLowerCase();
  const commands = COMMANDS.filter(([label]) => !q || t(label).toLowerCase().includes(q)).map(([label, ic, run]) => ({ label: t(label), ic, run, hint: typeof run === "string" ? "" : t("ação") }));
  const found = results.map((r) => ({ label: r.title, ic: RESULT_ICON[r.type] || "doc", run: r.href, hint: `${t(RESULT_LABEL[r.type] || r.type)}${r.detail && r.detail !== RESULT_LABEL[r.type] ? " · " + r.detail : ""}` }));
  palItems = [...found, ...commands];
  palIndex = Math.min(palIndex, Math.max(0, palItems.length - 1));
  const row = (item, i) => `<div class="pal-item ${i === palIndex ? "on" : ""}" data-i="${i}">${icon(item.ic)}<span class="ell">${esc(item.label)}</span><small>${esc(item.hint)}</small></div>`;
  $("pal-list").innerHTML = (found.length ? `<div class="pal-group">${t("Resultados")}</div>${found.map(row).join("")}` : "")
    + (commands.length ? `<div class="pal-group">${t("Comandos")}</div>${commands.map((c, i) => row(c, i + found.length)).join("")}` : "")
    || `<div class="empty-state"><p>${t("Nada encontrado.")}</p></div>`;
  $("pal-list").querySelector(".on")?.scrollIntoView({ block: "nearest" });
}
function runPalette(i) {
  const item = palItems[i];
  if (!item) return;
  togglePalette(false);
  if (typeof item.run === "string") location.hash = item.run; else item.run();
}
function togglePalette(open = $("palette").hidden) {
  $("palette").hidden = !open;
  if (!open) return;
  $("palette").innerHTML = `<div class="pal-box"><div class="pal-in">${icon("search")}<input id="pal-q" placeholder="${t("Procurar ou executar um comando…")}" autocomplete="off"><kbd>Esc</kbd></div>
    <div class="pal-list" id="pal-list"></div></div>`;
  palIndex = 0;
  drawPalette();
  const input = $("pal-q");
  input.focus();
  input.oninput = () => {
    palIndex = 0;
    drawPalette();
    clearTimeout(palTimer);
    const q = input.value.trim(), mine = ++palQuery;
    if (q.length < 2) return;
    palTimer = setTimeout(async () => {
      const results = await request("/api/search?q=" + encodeURIComponent(q)).catch(() => []);
      if (mine === palQuery && !$("palette").hidden) drawPalette(results.slice(0, 12)); // an older, slower answer never replaces a newer one
    }, 180);
  };
  input.onkeydown = (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      palIndex = (palIndex + (e.key === "ArrowDown" ? 1 : -1) + palItems.length) % Math.max(1, palItems.length);
      $("pal-list").querySelectorAll(".pal-item").forEach((el) => el.classList.toggle("on", Number(el.dataset.i) === palIndex));
      $("pal-list").querySelector(".on")?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") { e.preventDefault(); runPalette(palIndex); }
  };
  $("pal-list").onclick = (e) => { const el = e.target.closest(".pal-item"); if (el) runPalette(Number(el.dataset.i)); };
}

/* ---------- Team AI: questions answered by the person's own agent, from the Hub's real data ---------- */
const AI_SUGGESTIONS = ["Em que está cada um a trabalhar?", "O que precisa da minha atenção?", "Que tarefas foram concluídas hoje?",
  "Quanto gastámos em IA esta semana?", "Porque é que o Claude está à espera?"];
const chatLog = []; // {who: "me" | "ai" | "note", text}
function drawChat(thinking = false) {
  $("ai-panel").innerHTML = `<div class="pop-head"><b>Team AI</b><button class="btn quiet sm" id="ai-close">${icon("x")}</button></div>
    <div class="pop-body"><div class="chat" id="chat">
      ${chatLog.length ? chatLog.map((m) => `<div class="msg ${m.who}">${m.who === "ai" ? md(m.text) : esc(m.text)}</div>`).join("")
        : `<p class="dim" style="margin:0">${t("Pergunta sobre a equipa, as tarefas, os agentes ou o custo. Responde o teu agente, só com os dados reais do Hub.")}</p>
          <div class="sugg">${AI_SUGGESTIONS.map((s) => `<button data-q="${esc(t(s))}">${esc(t(s))}</button>`).join("")}</div>`}
      ${thinking ? `<div class="msg ai think">${t("O teu agente está a ler os dados do Hub")}</div>` : ""}</div></div>
    <form class="chat-in" id="chat-form"><input class="inp" id="chat-q" placeholder="${t("Pergunta alguma coisa…")}" autocomplete="off" ${thinking ? "disabled" : ""}>
      <button class="btn primary" ${thinking ? "disabled" : ""}>${t("Enviar")}</button></form>`;
  $("chat").parentElement.scrollTop = 1e6;
  $("ai-close").onclick = () => toggleAI(false);
  $("chat-form").onsubmit = (e) => { e.preventDefault(); sendQuestion($("chat-q").value); };
  $("chat").onclick = (e) => { if (e.target.dataset.q) sendQuestion(e.target.dataset.q); };
  if (!thinking) $("chat-q").focus();
}
async function sendQuestion(question) {
  question = question.trim();
  if (!question) return;
  chatLog.push({ who: "me", text: question });
  drawChat(true);
  try {
    const answer = await askAI(question);
    chatLog.push(answer.status === "DONE" ? { who: "ai", text: answer.answer } : { who: "note", text: aiError(answer.error) });
  } catch (e) { chatLog.push({ who: "note", text: e.message }); }
  if (!$("ai-panel").hidden) drawChat();
}
function toggleAI(open = $("ai-panel").hidden) {
  $("ai-panel").hidden = !open;
  if (open) drawChat();
}

/* ---------- start: called once by app.js when the person is signed in ---------- */
function hubStart() {
  Object.assign(ICONS, HUB_ICONS);
  document.documentElement.dataset.density = localStorage.getItem("hub.density") || "normal";
  $("me-av").innerHTML = esc((me.display_name || "?")[0].toUpperCase()) + githubPhoto(me.display_name);
  $("bell").insertAdjacentHTML("afterbegin", icon("bell"));
  $("collapse").innerHTML = icon("sidebar");
  $("open-palette").innerHTML = `${icon("search")}<span>${t("Procurar ou executar…")}</span><kbd>Ctrl K</kbd>`;
  $("ai-fab").innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${HUB_ICONS.spark}</svg>`;
  $("ai-fab").hidden = false;
  $("app").classList.toggle("collapsed", localStorage.getItem("hub.side") === "collapsed");

  $("bell").onclick = (e) => { e.stopPropagation(); toggleNotifications(); };
  $("collapse").onclick = () => localStorage.setItem("hub.side", $("app").classList.toggle("collapsed") ? "collapsed" : "open");
  $("open-palette").onclick = () => togglePalette(true);
  $("ai-fab").onclick = () => toggleAI();
  $("palette").onclick = (e) => { if (e.target === $("palette")) togglePalette(false); };
  $("notif-panel").onclick = async (e) => {
    const item = e.target.closest("[data-n]");
    if (e.target.closest("#phone-open")) return drawPhone();
    if (e.target.closest("#phone-test")) {
      const sent = (await api("/api/phone/test", { method: "POST", body: {} })).sent;
      return drawPhone(sent ? "Enviado: vê o telemóvel." : "Não saiu: este computador está sem internet?");
    }
    if (e.target.closest("#wp-enable")) return enableAppPush();
    if (e.target.closest("#wp-test")) {
      try { return drawPhone((await api("/api/webpush/test", { method: "POST", body: {} })).sent ? "Enviado: olha para o telemóvel." : "Não saiu: tenta ligar outra vez."); } catch (err) { return drawPhone(err.message); }
    }
    if (e.target.closest("#wp-off")) {
      await api("/api/webpush/subscribe", { method: "DELETE" });
      try { await (await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription())?.unsubscribe(); } catch { /* it was already gone */ }
      return drawPhone("Desligadas.");
    }
    if (e.target.closest("#phone-copy")) {
      const box = document.createElement("textarea"); // a field the phone can copy from (clipboard.writeText needs https)
      box.value = $("phone-topic").textContent; box.readOnly = true; box.style.cssText = "position:fixed;top:0;left:0;opacity:0";
      document.body.appendChild(box); box.select(); box.setSelectionRange(0, box.value.length);
      const ok = document.execCommand("copy"); box.remove();
      flash(t(ok ? "Código copiado. Cola-o no ntfy." : "Não deu para copiar: mantém o dedo no código para o copiares."));
      return;
    }
    if (e.target.closest("#phone-off")) { await api("/api/phone", { method: "DELETE" }); $("notif-panel").hidden = true; return; }
    if (e.target.closest(".phone-setup, code") || e.target.closest("a[target]")) return;
    if (await notifClick(e, bellInbox, (local) => (local ? drawNotifications(bellInbox) : null))) return;
    if (item) $("notif-panel").hidden = true;   // opening one: it was marked read on the way
  };
  document.addEventListener("click", (e) => {
    if (!$("notif-panel").hidden && !e.composedPath().some((el) => el.id === "notif-panel" || el.id === "bell")) $("notif-panel").hidden = true;
  });
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); togglePalette(); }
    else if (e.key === "Escape") { togglePalette(false); $("notif-panel").hidden = true; }
  });
}

// When this PC's Hub has pulled a new version (selfupdate.py), the page reloads itself - but never in the middle of
// typing or with a window open.
let hubVersion = null;
window.hubCheckVersion = async () => {
  try {
    const { head } = await (await fetch("/api/version", { cache: "no-store" })).json();
    if (hubVersion && head && head !== hubVersion && $("modal").hidden && !document.activeElement?.matches("input, textarea, select")) location.reload();
    hubVersion = head || hubVersion;
  } catch { /* the Hub is restarting: ask again next minute */ }
};
hubCheckVersion();
setInterval(hubCheckVersion, 60000);