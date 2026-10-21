// Mensagens (#/mensagens, 01 · Comando): the team writes to each other inside the Hub (21 Oct, Marco: «quando quiser passar
// contas, comandos e tal, o pop-up abre; consigo mandar como se fossem mensagens lá no widget»). backend/app/routers/messages.py.
// The conversations on the left (the whole team, then each person), the open one on the right; on the phone one at a time.
// What is written between ``` is a block with its own «Copiar» (a command, an account), `like this` is code inside a line,
// and every message copies whole. A message that arrives shows a card on any page (shell.js, msgNews) and in the widget.
(function () {
  let S = null, peer = null, msgs = [], timer = null, sending = false, asking = null;
  const phone = () => document.documentElement.classList.contains("is-phone");
  const conv = (id) => (S ? S.conversations.find((c) => c.peer === id) : null);
  const short = (text, n = 70) => { const s = String(text || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };

  // ---------------------------------------------------------------- a message's text: code blocks, `code`, links, lines
  function rich(text) {
    return String(text).split(/```/).map((part, i) => {
      if (i % 2) {
        const code = part.replace(/^[a-z0-9_-]*\n/i, "").replace(/\n$/, "");   // ```bash ... ``` : the language is not shown
        return `<div class="ms-code"><pre>${esc(code)}</pre><button type="button" class="ms-copy" data-copy="${esc(code)}">${icon("doc")}${esc(t("Copiar"))}</button></div>`;
      }
      return esc(part.replace(/^\n|\n$/g, ""))
        .replace(/`([^`\n]+)`/g, '<code>$1</code>')
        .replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)»"']/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`)
        .replace(/\n/g, "<br>");
    }).filter((x) => x !== "").join("");
  }
  async function copy(text, btn) {
    try { await navigator.clipboard.writeText(text); }
    catch {   // the widget's window may not give the clipboard to a page: the old way still works there
      const area = Object.assign(document.createElement("textarea"), { value: text });
      document.body.append(area); area.select(); document.execCommand("copy"); area.remove();
    }
    if (btn) { const was = btn.innerHTML; btn.innerHTML = `${icon("tick")}${esc(t("Copiado"))}`; setTimeout(() => { btn.innerHTML = was; }, 1400); }
  }

  // ---------------------------------------------------------------- the list of conversations
  function face(c, cls = "") {
    return c.peer === "team" ? `<span class="av ms-team ${cls}">${icon("users")}</span>` : ui.avatar(c.name, cls);
  }
  function listHtml() {
    return `<div class="ms-list-h">${esc(t("Conversas"))}</div>` + S.conversations.map((c) => {
      const last = c.last ? `${c.last.from === S.me ? t("Tu: ") : c.peer === "team" ? `${c.last.from_name}: ` : ""}${short(c.last.body)}` : t("Ainda sem mensagens");
      return `<a class="ms-conv ${c.peer === peer ? "on" : ""} ${c.unread ? "unread" : ""}" href="#/mensagens/${c.peer}">
        ${face(c)}<span class="ms-conv-m"><b>${esc(t(c.name))}</b><small>${esc(last)}</small></span>
        <span class="ms-conv-r">${c.last ? `<time>${esc(fmt.ago(c.last.at))}</time>` : ""}${c.unread ? `<i>${c.unread}</i>` : ""}</span></a>`;
    }).join("");
  }

  // ---------------------------------------------------------------- the open conversation
  function bubble(m, prev) {
    const mine = m.from === S.me, joined = prev && prev.from === m.from && new Date(m.at) - new Date(prev.at) < 5 * 60000;
    const who = !mine && peer === "team" && !joined ? `<b class="ms-who">${esc(m.from_name)}</b>` : "";
    return `<div class="ms-msg ${mine ? "mine" : ""} ${joined ? "joined" : ""}" data-id="${m.id}">
      ${!mine && !joined ? ui.avatar(m.from_name, "sm") : '<span class="ms-gap"></span>'}
      <div class="ms-bub">${who}<div class="ms-text">${rich(m.body)}</div>
        <div class="ms-meta"><time>${esc(fmt.hhmm(m.at))}</time>
          <button type="button" class="ms-act" data-copy-msg="${m.id}" title="${esc(t("Copiar a mensagem"))}">${icon("doc")}</button>
          ${mine ? `<button type="button" class="ms-act ${asking === m.id ? "ask" : ""}" data-del="${m.id}" title="${esc(t("Apagar"))}">${asking === m.id ? esc(t("Apagar?")) : icon("trash")}</button>` : ""}</div></div></div>`;
  }
  function threadHtml() {
    const c = conv(peer);
    if (!c) return ui.empty("chat", "Escolhe uma conversa", "Fala com a equipa toda ou com uma pessoa.");
    const others = S.conversations.filter((x) => x.peer !== "team").map((x) => x.name);
    let day = "", prev = null;
    const body = msgs.length ? msgs.map((m) => {
      const d = fmt.day(m.at), head = d !== day ? `<div class="ms-day"><span>${esc(d)}</span></div>` : "";
      if (head) prev = null;
      day = d;
      const html = head + bubble(m, prev);
      prev = m;
      return html;
    }).join("") : `<div class="ms-first">${face(c, "lg")}<b>${esc(t(c.name))}</b><p>${esc(c.peer === "team"
      ? t("O que escreveres aqui chega a {p}. Cada um vê um aviso no Hub, no widget e no telemóvel.", { p: others.join(" e ") })
      : t("Só tu e {p} veem esta conversa. A mensagem chega num aviso no Hub, no widget e no telemóvel.", { p: c.name }))}</p></div>`;
    return `<header class="ms-head">${phone() ? "" : face(c)}<div><b>${esc(t(c.name))}</b><small>${esc(c.peer === "team" ? others.concat(t("tu")).join(" · ") : t("Conversa só entre vocês os dois"))}</small></div></header>
      <div class="ms-body" id="ms-body">${body}</div>
      <form class="ms-send" id="ms-send" autocomplete="off">
        <textarea id="ms-in" rows="1" placeholder="${esc(t(c.peer === "team" ? "Escreve à equipa…" : "Escreve a {p}…", { p: c.name }))}"></textarea>
        <button class="btn primary" id="ms-go" ${sending ? "disabled" : ""}>${icon("arrow")}${esc(t("Enviar"))}</button>
        <small class="ms-hint">${esc(t("Enter envia · Shift+Enter muda de linha · entre ``` fica um bloco com botão Copiar"))}</small>
      </form>`;
  }

  // ---------------------------------------------------------------- drawing and loading
  function drawList() { if ($("ms-list")) paint($("ms-list"), listHtml()); }
  function drawThread(keepInput = true) {
    const box = $("ms-thread");
    if (!box) return;
    const typed = keepInput && $("ms-in") ? $("ms-in").value : "";
    const body = $("ms-body"), atEnd = !body || body.scrollHeight - body.scrollTop - body.clientHeight < 80;
    box.innerHTML = threadHtml();
    const input = $("ms-in");
    if (input) { input.value = typed; grow(input); }
    if (atEnd && $("ms-body")) $("ms-body").scrollTop = $("ms-body").scrollHeight;
  }
  function grow(input) { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 200) + "px"; }
  async function loadList() {
    S = await api("/api/messages");
    drawList();
  }
  async function loadThread(quiet = false) {
    if (!peer) return;
    const want = peer, d = await api(`/api/messages/${encodeURIComponent(peer)}`);
    if (want !== peer || !$("ms-thread")) return;
    const changed = JSON.stringify(d.messages.map((m) => m.id)) !== JSON.stringify(msgs.map((m) => m.id));
    msgs = d.messages;
    if (changed || !quiet) drawThread();
    if (changed) loadList().catch(() => {});
  }
  async function refresh() {
    if (!$("ms") || document.hidden || sending) return;
    await loadList();
    await loadThread(true);
  }
  async function send(e) {
    e.preventDefault();
    const input = $("ms-in"), text = input.value;
    if (!text.trim() || sending) return;
    sending = true; $("ms-go").disabled = true;
    try {
      const m = await api(`/api/messages/${encodeURIComponent(peer)}`, { method: "POST", body: ({ body: text }) });
      input.value = ""; grow(input);
      msgs.push(m);
      sending = false;
      drawThread(false);
      $("ms-in").focus();
      loadList().catch(() => {});
    } catch (err) { flash(err.message); sending = false; if ($("ms-go")) $("ms-go").disabled = false; }
  }
  async function remove(id, btn) {
    if (asking !== id) { asking = id; drawThread(); return; }   // the first touch asks, the second takes it back
    asking = null;
    btn.disabled = true;
    try {
      await api(`/api/messages/msg/${id}`, { method: "DELETE" });
      msgs = msgs.filter((m) => m.id !== id);
      drawThread();
      loadList().catch(() => {});
    } catch (err) { flash(err.message); }
  }
  function click(e) {
    let b;
    if ((b = e.target.closest("[data-copy]"))) copy(b.dataset.copy, b);
    else if ((b = e.target.closest("[data-copy-msg]"))) { const m = msgs.find((x) => x.id === Number(b.dataset.copyMsg)); if (m) copy(m.body.replace(/```[a-z0-9_-]*\n?/gi, ""), null), flash(t("Mensagem copiada")); }
    else if ((b = e.target.closest("[data-del]"))) remove(Number(b.dataset.del), b);
    else if (asking !== null && !e.target.closest(".ms-act")) { asking = null; drawThread(); }
  }

  onLive(["notification", "tick"], () => ($("ms") ? refresh().catch(() => {}) : Promise.resolve()));

  HUB_VIEWS.mensagens = async function (r) {
    clearInterval(timer);
    S = S || null; msgs = []; asking = null;
    peer = r.company || null;
    page(`${ui.head("", t("Mensagens"), t("Fala com a equipa: contas, comandos, o que for. Quem recebe vê logo um aviso no Hub, no widget e no telemóvel."))}
      <div class="ms ${peer ? "has-peer" : ""}" id="ms"><nav class="ms-list" id="ms-list">${ui.skeleton(4)}</nav><section class="ms-thread" id="ms-thread"></section></div>`);
    $("view").onclick = click;
    $("ms-thread").addEventListener("submit", send);
    $("ms-thread").addEventListener("keydown", (e) => {
      if (e.target.id === "ms-in" && e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $("ms-send").requestSubmit(); }
    });
    $("ms-thread").addEventListener("input", (e) => { if (e.target.id === "ms-in") grow(e.target); });
    await loadList();
    if (!peer && !phone()) {   // on the computer a conversation is always open: the newest, else the team's
      const newest = [...S.conversations].filter((c) => c.last).sort((a, b) => String(b.last.at).localeCompare(String(a.last.at)))[0];
      peer = (newest || S.conversations[0]).peer;
      history.replaceState(null, "", `#/mensagens/${peer}`);
      $("ms").classList.add("has-peer");
      drawList();
    }
    if (peer && !conv(peer)) { peer = null; }
    drawThread(false);
    if (peer) { await loadThread(); if ($("ms-in") && !phone()) $("ms-in").focus(); }
    // the other PCs' messages come by sync, which tells no page: look every 4 s while this one is open and seen
    timer = setInterval(() => { if (!$("ms")) clearInterval(timer); else refresh().catch(() => {}); }, 4000);
  };
})();
