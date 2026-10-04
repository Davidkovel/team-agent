// Team AI Hub: what is on every page. The sidebar's tools, notifications, the command palette (Ctrl+K) and the Team AI.

/* ---------- notifications: kept by the server, per person; the counter survives a reload ---------- */
window.hubBell = true;
let lastNotification = null; // newest id already seen in this window: only later ones raise a toast
async function hubNews() {
  const inbox = await request("/api/notifications?limit=30");
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
function drawNotifications(inbox) {
  $("notif-panel").innerHTML = `<div class="pop-head"><b>${t("Notificações")}</b>
      <span>${inbox.unread ? `<button class="btn quiet sm" id="read-all">${t("Marcar tudo como lido")}</button>` : ""}
      <button class="btn quiet sm" id="phone-open">${t("Telemóvel")}</button></span></div>
    <div class="pop-body">${inbox.items.length ? inbox.items.map((n) => `<a class="ntf ${n.read ? "" : "unread"}" href="${esc(n.href || "#/home")}" data-n="${n.id}"><i></i>
      <div class="grow"><b>${esc(n.title)}</b>${n.body ? `<span class="ell">${esc(n.body)}</span>` : ""}<span>${fmt.ago(n.created_at)}</span></div></a>`).join("")
      : ui.empty("bell", "Sem notificações", "Só aparece aqui o que precisa de ti: aprovações, agentes parados, tarefas concluídas.")}</div>`;
}
/* The same notifications on the phone, through the ntfy app: the Hub only shows which topic to follow. */
async function drawPhone(note = "") {
  const p = await api("/api/phone", { method: "POST", body: {} });
  $("notif-panel").innerHTML = `<div class="pop-head"><b>${t("Notificações no telemóvel")}</b>
      <button class="btn quiet sm" id="phone-back">${t("Voltar")}</button></div>
    <div class="pop-body" style="padding:12px 14px;display:grid;gap:10px">
      <span>${t("1. Instala a app «ntfy» no telemóvel (Play Store ou App Store).")}</span>
      <span>${t("2. Na app: «+» → cola este tópico. É só teu: não o partilhes.")}</span>
      <code style="user-select:all;word-break:break-all">${esc(p.topic)}</code>
      <span>${t("Ou abre este endereço no telemóvel:")} <a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.url)}</a></span>
      <span><button class="btn sm" id="phone-test">${t("Enviar um teste")}</button>
        <button class="btn quiet sm" id="phone-off">${t("Desligar o telemóvel")}</button></span>
      ${note ? `<b>${esc(t(note))}</b>` : ""}</div>`;
}
async function toggleNotifications(open = $("notif-panel").hidden) {
  $("notif-panel").hidden = !open;
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
    if (e.target.closest("#phone-off")) { await api("/api/phone", { method: "DELETE" }); $("notif-panel").hidden = true; return; }
    if (e.target.closest(".phone-setup, code") || e.target.closest("a[target]")) return;
    if (e.target.closest("#read-all")) await api("/api/notifications/read", { method: "POST", body: {} });
    else if (item) { await api("/api/notifications/read", { method: "POST", body: { ids: [Number(item.dataset.n)] } }); $("notif-panel").hidden = true; }
    hubNews();
  };
  document.addEventListener("click", (e) => { if (!$("notif-panel").hidden && !e.target.closest("#notif-panel, #bell")) $("notif-panel").hidden = true; });
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); togglePalette(); }
    else if (e.key === "Escape") { togglePalette(false); $("notif-panel").hidden = true; }
  });
}

// When this PC's Hub has pulled a new version (selfupdate.py), the page reloads itself - but never in the middle of
// typing or with a window open.
let hubVersion = null;
setInterval(async () => {
  try {
    const { head } = await (await fetch("/api/version", { cache: "no-store" })).json();
    if (hubVersion && head && head !== hubVersion && $("modal").hidden && !document.activeElement?.matches("input, textarea, select")) location.reload();
    hubVersion = head || hubVersion;
  } catch { /* the Hub is restarting: ask again next minute */ }
}, 60000);