// Mensagens (#/mensagens, 01 · Comando): the team writes to each other inside the Hub (21 Oct, Marco: «quando quiser passar
// contas, comandos e tal, o pop-up abre; consigo mandar como se fossem mensagens lá no widget»). backend/app/routers/messages.py.
// 30 Oct, Marco: «mete estilo WhatsApp, mas iOS... tem que ficar bonito», with photos, and «os chats nem atualizam»: it reads
// like the iPhone's Messages now (my bubbles blue, the others' graphite, a tail on the last of each run), a photo goes with
// the + (or pasted, or dropped on the conversation), and a message from another PC shows at once (the Hub's live event
// `message`, which sync rings too), with the 4 s look kept as a safety net.
// What is written between ``` is a block with its own «Copiar» (a command, an account), `like this` is code inside a line,
// and every message copies whole. A message that arrives shows a card on any page (shell.js, msgNews) and in the widget.
(function () {
  let S = null, peer = null, msgs = [], timer = null, sending = false, asking = null, photo = null, tab = "chat", find = "";
  const phone = () => document.documentElement.classList.contains("is-phone");
  const conv = (id) => (S ? S.conversations.find((c) => c.peer === id) : null);
  const short = (text, n = 70) => { const s = String(text || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
  // the iPhone's arrow up in a round button, and the save of the photo viewer (not in HUB_ICONS)
  const UP = '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5.5 11.5L12 5l6.5 6.5"/></svg>';
  const SAVE = '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/></svg>';
  const imgUrl = (id) => `/api/messages/img/${id}?token=${encodeURIComponent(token)}`;
  const run = (a, b) => a && b && a.from === b.from && Math.abs(new Date(b.at) - new Date(a.at)) < 5 * 60000 && fmt.day(a.at) === fmt.day(b.at);

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
  const lastText = (m) => short(String(m.body || "").replace(/```[a-z0-9_-]*/gi, " ")) || (m.image ? "📷 " + t("Foto") : "");
  function listHtml() {
    const q = find.trim().toLowerCase();
    const shown = S.conversations.filter((c) => !q || t(c.name).toLowerCase().includes(q) || (c.last && String(c.last.body || "").toLowerCase().includes(q)));
    return (shown.map((c) => {
      const last = c.last ? `${c.last.from === S.me ? t("Tu: ") : c.peer === "team" ? `${c.last.from_name}: ` : ""}${lastText(c.last)}` : t("Ainda sem mensagens");
      return `<a class="ms-conv ${c.peer === peer ? "on" : ""} ${c.unread ? "unread" : ""}" href="#/mensagens/${c.peer}">
        ${face(c)}<span class="ms-conv-m"><span class="ms-conv-t"><b>${esc(t(c.name))}</b>${c.last ? `<time>${esc(fmt.ago(c.last.at))}</time>` : ""}</span>
        <span class="ms-conv-b"><small>${esc(last)}</small>${c.unread ? `<i>${c.unread}</i>` : ""}</span></span></a>`;
    }).join("") || `<p class="ms-none">${esc(t("Nada com «{q}».", { q: find.trim() }))}</p>`);
  }
  // the app's own top: the agency's seal, its name, the search (30 Oct, Marco: «o chat de equipa é uma aplicação... da
  // agência»: not a tile inside the Ten Fold page, an app of its own)
  const railTop = () => `<header class="ms-rail-h"><span class="ms-seal">TF</span><div><b>${esc(t("Chat"))}</b><small>Ten Fold</small></div></header>
    <label class="ms-find">${icon("search")}<input id="ms-find" type="search" placeholder="${esc(t("Procurar"))}" value="${esc(find)}" autocomplete="off"></label>`;

  // ---------------------------------------------------------------- the open conversation
  function bubble(m, prev, next) {
    const mine = m.from === S.me, first = !run(prev, m), tail = !run(m, next);
    const who = !mine && peer === "team" && first ? `<b class="ms-who">${esc(m.from_name)}</b>` : "";
    const pic = m.image ? `<button type="button" class="ms-pic" data-photo="${m.id}"><img src="${imgUrl(m.id)}" alt="" loading="lazy"></button>` : "";
    const text = m.body ? `<div class="ms-text">${rich(m.body)}</div>` : "";
    return `<div class="ms-msg ${mine ? "mine" : ""} ${first ? "first" : ""} ${tail ? "tail" : ""} ${m.image && !m.body ? "only-pic" : ""}" data-id="${m.id}">
      ${!mine ? (tail ? ui.avatar(m.from_name, "sm") : '<span class="ms-gap"></span>') : ""}
      <div class="ms-col">${who}<div class="ms-bub">${pic}${text}</div>
        <div class="ms-meta"><time>${esc(fmt.hhmm(m.at))}</time>
          <button type="button" class="ms-act" data-copy-msg="${m.id}" title="${esc(t("Copiar a mensagem"))}">${icon("doc")}</button>
          ${mine ? `<button type="button" class="ms-act ${asking === m.id ? "ask" : ""}" data-del="${m.id}" title="${esc(t("Apagar"))}">${asking === m.id ? esc(t("Apagar?")) : icon("trash")}</button>` : ""}</div></div></div>`;
  }
  function threadHtml() {
    const c = conv(peer);
    if (!c) return ui.empty("chat", "Escolhe uma conversa", "Fala com a equipa toda ou com uma pessoa.");
    const others = S.conversations.filter((x) => x.peer !== "team").map((x) => x.name);
    let day = "";
    const body = msgs.length ? msgs.map((m, i) => {
      const d = fmt.day(m.at), head = d !== day ? `<div class="ms-day"><span>${esc(d)}</span></div>` : "";
      day = d;
      return head + bubble(m, msgs[i - 1], msgs[i + 1]);
    }).join("") + (msgs[msgs.length - 1].from === S.me ? `<div class="ms-sent">${esc(t("Entregue"))}</div>` : "")
      : `<div class="ms-first">${face(c, "lg")}<b>${esc(t(c.name))}</b><p>${esc(c.peer === "team"
        ? t("O que escreveres aqui chega a {p}. Cada um vê um aviso no Hub, no widget e no telemóvel.", { p: others.join(" e ") })
        : t("Só tu e {p} veem esta conversa. A mensagem chega num aviso no Hub, no widget e no telemóvel.", { p: c.name }))}</p></div>`;
    const pics = msgs.filter((m) => m.image), links = linksOf(msgs);
    const tabs = [["chat", "Conversa", 0], ["fotos", "Fotos", pics.length], ["links", "Links", links.length]];
    return `<header class="ms-head">${face(c)}<div class="ms-who-h"><b>${esc(t(c.name))}</b><small>${esc(c.peer === "team" ? others.concat(t("tu")).join(", ") : t("Só vocês os dois"))}</small></div>
        <nav class="ms-tabs">${tabs.map(([k, l, n]) => `<button type="button" class="${tab === k ? "on" : ""}" data-tab="${k}">${esc(t(l))}${n ? `<i>${n}</i>` : ""}</button>`).join("")}</nav></header>
      <div class="ms-body ${tab !== "chat" ? "ms-shelf" : ""}" id="ms-body">${tab === "fotos" ? photosHtml(pics) : tab === "links" ? linksHtml(links) : body}</div>
      <form class="ms-send" id="ms-send" autocomplete="off">
        <div class="ms-preview" id="ms-preview">${photoHtml()}</div>
        <div class="ms-bar">
          <button type="button" class="ms-plus" id="ms-plus" title="${esc(t("Mandar uma foto"))}">${icon("plus")}</button>
          <input type="file" id="ms-file" accept="image/*" hidden>
          <div class="ms-field"><textarea id="ms-in" rows="1" placeholder="${esc(t("Mensagem"))}"></textarea>
            <button class="ms-go" id="ms-go" title="${esc(t("Enviar"))}" ${sending ? "disabled" : ""}>${UP}</button></div>
        </div>
      </form>`;
  }
  // what was shared in the conversation, to find an idea again: the photos in a grid, the links with who sent them
  function linksOf(list) {
    const out = [];
    for (const m of list) for (const u of String(m.body || "").match(/https?:\/\/[^\s<]+[^\s<.,;:!?)»"']/g) || []) out.push({ u, m });
    return out.reverse();
  }
  const photosHtml = (pics) => (pics.length ? `<div class="ms-grid">${[...pics].reverse().map((m) => `<button type="button" class="ms-tile" data-photo="${m.id}" title="${esc(`${m.from === S.me ? t("Tu") : m.from_name}, ${fmt.day(m.at)}`)}"><img src="${imgUrl(m.id)}" alt="" loading="lazy"></button>`).join("")}</div>`
    : `<p class="ms-none">${esc(t("Ainda ninguém mandou fotos aqui. Usa o + em baixo, cola uma imagem ou larga-a na conversa."))}</p>`);
  const linksHtml = (links) => (links.length ? `<ul class="ms-links">${links.map(({ u, m }) => { let host = u; try { host = new URL(u).hostname.replace(/^www\./, ""); } catch {}
      return `<li><a href="${esc(u)}" target="_blank" rel="noopener"><b>${esc(host)}</b><span>${esc(u)}</span></a><small>${esc(m.from === S.me ? t("Tu") : m.from_name)}, ${esc(fmt.ago(m.at))}</small></li>`; }).join("")}</ul>`
    : `<p class="ms-none">${esc(t("Os links que mandarem ficam aqui, para encontrar uma ideia depois."))}</p>`);
  const photoHtml = () => (photo ? `<span class="ms-thumb"><img src="${photo}" alt=""><button type="button" id="ms-unpic" title="${esc(t("Tirar a foto"))}">${icon("x")}</button></span>` : "");
  function ready() {   // the send arrow lights up when there is something to send, as on the iPhone
    const go = $("ms-go");
    if (go) go.classList.toggle("on", !!(photo || ($("ms-in") && $("ms-in").value.trim())));
  }

  // ---------------------------------------------------------------- a photo: made small here, so it travels light
  function shrink(file) {
    return new Promise((ok, fail) => {
      if (!file || !file.type.startsWith("image/")) return fail(new Error(t("Isso não é uma foto.")));
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        const k = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement("canvas");
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        const g = c.getContext("2d");
        g.fillStyle = "#000"; g.fillRect(0, 0, c.width, c.height);   // a transparent PNG would turn black-on-black otherwise
        g.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        ok(c.toDataURL("image/jpeg", 0.82));
      };
      img.onerror = () => { URL.revokeObjectURL(url); fail(new Error(t("Não consegui abrir essa foto."))); };
      img.src = url;
    });
  }
  async function pick(file) {
    try { photo = await shrink(file); } catch (err) { flash(err.message); return; }
    if ($("ms-preview")) paint($("ms-preview"), photoHtml());
    ready();
    if ($("ms-in")) $("ms-in").focus();
  }
  function viewer(id) {   // a photo opened big, on black; a click or Esc closes it
    const box = Object.assign(document.createElement("div"), { className: "ms-view" });
    box.innerHTML = `<img src="${imgUrl(id)}" alt=""><a class="ms-view-dl" href="${imgUrl(id)}" download="foto-${id}.jpg" title="${esc(t("Guardar"))}">${SAVE}</a>`;
    const close = (e) => { if (e.type === "keydown" && e.key !== "Escape") return; if (e.target.closest && e.target.closest(".ms-view-dl")) return; box.remove(); document.removeEventListener("keydown", close); };
    box.addEventListener("click", close);
    document.addEventListener("keydown", close);
    document.body.append(box);
  }

  // ---------------------------------------------------------------- drawing and loading
  function drawList() { if ($("ms-conv-list")) paint($("ms-conv-list"), listHtml()); }
  function drawThread(keepInput = true) {
    const box = $("ms-thread");
    if (!box) return;
    const typed = keepInput && $("ms-in") ? $("ms-in").value : "", focused = document.activeElement && document.activeElement.id === "ms-in";
    const body = $("ms-body"), atEnd = !body || body.scrollHeight - body.scrollTop - body.clientHeight < 80;
    box.innerHTML = threadHtml();
    const input = $("ms-in");
    if (input) { input.value = typed; grow(input); if (focused) input.focus(); }
    ready();
    const nb = $("ms-body");
    if (atEnd && nb) {
      nb.scrollTop = nb.scrollHeight;
      nb.querySelectorAll("img").forEach((im) => { if (!im.complete) im.addEventListener("load", () => { nb.scrollTop = nb.scrollHeight; }, { once: true }); });
    }
  }
  function grow(input) { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 160) + "px"; }
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
    if (!$("ms") || sending) return;
    await loadList();
    await loadThread(true);
  }
  async function send(e) {
    e.preventDefault();
    const input = $("ms-in"), text = input.value;
    if ((!text.trim() && !photo) || sending) return;
    sending = true; $("ms-go").disabled = true;
    try {
      const m = await api(`/api/messages/${encodeURIComponent(peer)}`, { method: "POST", body: { body: text, image: photo } });
      input.value = ""; photo = null; grow(input);
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
    else if ((b = e.target.closest("[data-photo]"))) viewer(Number(b.dataset.photo));
    else if ((b = e.target.closest("[data-tab]"))) { tab = b.dataset.tab; drawThread(); }
    else if (e.target.closest("#ms-plus")) $("ms-file").click();
    else if (e.target.closest("#ms-unpic")) { photo = null; paint($("ms-preview"), ""); ready(); }
    else if (asking !== null && !e.target.closest(".ms-act")) { asking = null; drawThread(); }
  }

  onLive(["notification", "message", "tick"], () => ($("ms") ? refresh().catch(() => {}) : Promise.resolve()));

  HUB_VIEWS.mensagens = async function (r) {
    if (peer !== (r.company || null)) tab = "chat";   // another conversation opens on its messages
    page(`<div class="ms ${r.company ? "has-peer" : ""}" id="ms"><nav class="ms-list" id="ms-list">${railTop()}<div class="ms-convs" id="ms-conv-list">${ui.skeleton(4)}</div></nav><section class="ms-thread" id="ms-thread"></section></div>`);
    $("ms-find").addEventListener("input", (e) => { find = e.target.value; drawList(); });
    await mount(r.company || null);
  };

  async function mount(start) {
    clearInterval(timer);
    msgs = []; asking = null; photo = null;
    peer = start;
    $("ms").onclick = click;
    const th = $("ms-thread");
    th.addEventListener("submit", send);
    th.addEventListener("keydown", (e) => {
      if (e.target.id === "ms-in" && e.key === "Enter" && !e.shiftKey && !e.isComposing && !phone()) { e.preventDefault(); $("ms-send").requestSubmit(); }
    });
    th.addEventListener("input", (e) => { if (e.target.id === "ms-in") { grow(e.target); ready(); } });
    th.addEventListener("change", (e) => { if (e.target.id === "ms-file" && e.target.files[0]) { pick(e.target.files[0]); e.target.value = ""; } });
    th.addEventListener("paste", (e) => {   // a screenshot pasted into the box goes as a photo
      const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith("image/"));
      if (f) { e.preventDefault(); pick(f); }
    });
    th.addEventListener("dragover", (e) => { if ([...(e.dataTransfer?.items || [])].some((x) => x.kind === "file")) { e.preventDefault(); th.classList.add("drop"); } });
    th.addEventListener("dragleave", (e) => { if (!th.contains(e.relatedTarget)) th.classList.remove("drop"); });
    th.addEventListener("drop", (e) => {
      th.classList.remove("drop");
      const f = [...(e.dataTransfer?.files || [])].find((x) => x.type.startsWith("image/"));
      if (f) { e.preventDefault(); pick(f); }
    });
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
    if (peer) { await loadThread(); if ($("ms-in") && !phone()) $("ms-in").focus({ preventScroll: true }); }
    // the live event comes first (sync rings it for what other PCs send); this look every 4 s is the safety net, and it
    // also runs with the page behind another window (the widget's Hub is often not the window in front)
    timer = setInterval(() => { if (!$("ms")) clearInterval(timer); else refresh().catch(() => {}); }, 4000);
  }
})();
