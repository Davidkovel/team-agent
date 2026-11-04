// Claude (#/claude; 4 Nov, David: «trabalhar no meu telemóvel como se fosse no computador»): a conversation with Claude from the
// phone. It runs in the cloud with the computer closed, or on the computer in the project's real folder when that is chosen and
// the computer is on. What it needs approved shows inside the conversation. backend/app/routers/conversas.py.
(function () {
  const $ = (id) => document.getElementById(id);
  let timer = null, sending = false, shown = "";
  const UP = '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M6 11l6-6 6 6"/></svg>';
  const text = (s) => esc(s).replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)»"']/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`).replace(/\n/g, "<br>");
  const ago = (at) => (at ? fmt.day(at) : "");
  const whereName = (w) => (w === "pc" ? "No computador" : "Na nuvem");
  const grow = (t) => { t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 140) + "px"; };
  const stopTimer = () => { clearTimeout(timer); timer = null; };

  async function send(button, work) {
    if (sending) return;
    sending = true; button.disabled = true;
    try { await work(); } catch (e) { const err = $("cl-err"); if (err) { err.textContent = e.message; err.hidden = false; } }
    sending = false; button.disabled = false;
  }

  // ---------------------------------------------------------------- the list, and a new conversation
  async function list(root) {
    stopTimer();
    const S = await api("/api/conversas");
    const projects = S.projetos.map((p) => `<option value="${esc(p.name)}">${esc(p.name)}</option>`).join("");
    root.innerHTML = `<div class="cl">
      <form class="cl-new" id="cl-new">
        <textarea id="cl-text" rows="3" placeholder="O que queres fazer? Podes continuar algo de ontem."></textarea>
        <div class="cl-row">
          <div class="cl-seg" role="radiogroup" aria-label="Onde corre">
            <label><input type="radio" name="cl-w" value="nuvem" checked><span>Na nuvem</span></label>
            <label><input type="radio" name="cl-w" value="pc" ${S.pc_online ? "" : "disabled"}><span>No computador</span></label>
          </div>
          <select id="cl-project" aria-label="Projeto"><option value="">Sem projeto</option>${projects}</select>
        </div>
        <p class="cl-state"><i class="${S.pc_online ? "on" : ""}"></i>${S.pc_online ? "O computador está ligado" : "O computador está desligado: a nuvem trabalha com o que está no git"}</p>
        <p class="cl-err" id="cl-err" hidden></p>
        <button class="cl-go" id="cl-go" type="submit">Começar</button>
      </form>
      <div class="cl-list">${S.conversas.length ? S.conversas.map((c) => `
        <a class="cl-item" href="#/claude/${c.id}">
          <b>${esc(c.title)}</b>
          <span>${esc(c.snippet || c.action || "")}</span>
          <small>${c.busy ? '<i class="on"></i>A trabalhar · ' : ""}${whereName(c.where)}${c.project ? " · " + esc(c.project) : ""} · ${esc(ago(c.updated_at))}</small>
        </a>`).join("") : '<p class="cl-none">Ainda não há conversas.</p>'}</div>
    </div>`;
    const area = $("cl-text");
    area.oninput = () => grow(area);
    $("cl-new").onsubmit = (e) => {
      e.preventDefault();
      const value = area.value.trim();
      if (!value) return area.focus();
      send($("cl-go"), async () => {
        const where = root.querySelector('input[name="cl-w"]:checked').value;
        const c = await api("/api/conversas", { method: "POST", body: { text: value, where, project: $("cl-project").value } });
        location.hash = `#/claude/${c.id}`;
      });
    };
  }

  // ---------------------------------------------------------------- one conversation
  function bubble(m) {
    const cls = m.kind === "message" ? "me" : m.kind === "error" ? "err" : "them";
    return `<div class="cl-b ${cls}">${text(m.text)}</div>`;
  }

  async function draw(root, id) {
    const c = await api(`/api/conversas/${id}`);
    if (location.hash.split("/")[2] !== String(id) || !$("cl-thread")) return;
    const key = JSON.stringify([c.messages.length, c.approvals, c.status, c.action, c.pc_online]);
    if (key !== shown) {
      shown = key;
      const box = $("cl-msgs"), atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
      const waiting = c.where === "pc" && !c.pc_online && c.busy;
      box.innerHTML = c.messages.map(bubble).join("")
        + c.approvals.map((a) => `<div class="cl-ask">
            <b>Precisa da tua aprovação</b><p>${text(a.action)}</p>${a.detail ? `<pre>${esc(a.detail)}</pre>` : ""}
            <div><button data-no="${a.id}">Recusar</button><button class="yes" data-yes="${a.id}">Aprovar</button></div>
          </div>`).join("")
        + (waiting ? '<p class="cl-busy">À espera que o computador ligue.</p>'
          : c.busy && !c.approvals.length ? `<p class="cl-busy"><i class="on"></i>${esc(c.action || "A pensar")}</p>` : "");
      if (atEnd) box.scrollTop = box.scrollHeight;
      $("cl-stop").hidden = !c.busy;
    }
    stopTimer();
    timer = setTimeout(() => draw(root, id).catch(() => {}), c.busy ? 2500 : 8000);
  }

  async function thread(root, id) {
    stopTimer();
    shown = "";
    root.innerHTML = `<div class="cl cl-thread" id="cl-thread">
      <div class="cl-msgs" id="cl-msgs"></div>
      <p class="cl-err" id="cl-err" hidden></p>
      <form class="cl-send" id="cl-send">
        <button type="button" class="cl-stop" id="cl-stop" hidden>Parar</button>
        <textarea id="cl-in" rows="1" placeholder="Escreve ao Claude"></textarea>
        <button class="cl-up" id="cl-up" type="submit" aria-label="Enviar">${UP}</button>
      </form>
    </div>`;
    const area = $("cl-in");
    area.oninput = () => grow(area);
    $("cl-send").onsubmit = (e) => {
      e.preventDefault();
      const value = area.value.trim();
      if (!value) return;
      send($("cl-up"), async () => {
        await api(`/api/conversas/${id}`, { method: "POST", body: { text: value } });
        area.value = ""; grow(area);
        $("cl-err").hidden = true;
        await draw(root, id);
        const box = $("cl-msgs"); box.scrollTop = box.scrollHeight;
      });
    };
    $("cl-stop").onclick = (e) => send(e.currentTarget, () => api(`/api/conversas/${id}/parar`, { method: "POST" }));
    $("cl-msgs").onclick = (e) => {
      const b = e.target.closest("[data-yes],[data-no]");
      if (!b) return;
      send(b, async () => {
        await api(`/api/approvals/${b.dataset.yes || b.dataset.no}/decide`, { method: "POST", body: { approve: !!b.dataset.yes } });
        await draw(root, id);
      });
    };
    await draw(root, id);
    const box = $("cl-msgs"); box.scrollTop = box.scrollHeight;
  }

  HUB_VIEWS.claude = async function (r) {
    const root = $("view");
    return r.company ? thread(root, r.company) : list(root);
  };
})();
