// E-mails (#/emails, 03 · Negócios, separador do Radar): a linha toda, Radar > e-mail > resposta > CRM > agentes (backend/app/mail.py).
// Sete listas sobre as mesmas conversas; ao lado, a conversa aberta e, se a empresa respondeu, a decisão: PDF, condições ou ignorar.
// Nada sai sem um clique de uma pessoa. «Visto» é visto por nós: saber se o cliente abriu exigia um píxel escondido, e não usamos.
// Segue docs/hub-paginas.md; classes em-.
(function () {
  let D = null, raw = "", tab = "", sel = 0, conv = null, timer = 0, compose = null, modal = "", camp = null, arm = "", busy = false;
  const TABS = [
    ["aprovar", "Por aprovar", (x) => x.pending && x.pending.status === "draft"],
    ["enviados", "Enviados", (x) => x.sent > 0],
    ["recebidos", "Recebidos", (x) => x.recebidos > 0],
    ["porver", "Por ver", (x) => x.por_ver > 0],
    ["vistos", "Vistos", (x) => x.recebidos > 0 && !x.por_ver],
    ["repetir", "Enviar outra vez", (x) => x.repetir],
    ["falhou", "Falharam", (x) => x.status === "falhou"],
  ];
  const STATE = {
    rascunho: ["off", "Por aprovar"], fila: ["wait", "Na fila"], enviado: ["off", "Enviado"], respondeu: ["ok", "Respondeu"],
    falhou: ["bad", "Falhou"], removido: ["bad", "Não quer e-mails"], ignorado: ["off", "Ignorado"], outro: ["off", "Recebido"],
  };
  const $ = (id) => document.getElementById(id);
  const when = (s) => {
    if (!s) return "";
    const d = new Date(s), n = new Date();
    if (d.toDateString() === n.toDateString()) return d.toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });
    return d.toLocaleDateString("pt-PT", { day: "2-digit", month: "short" });
  };
  const list = (k) => (D ? D.threads.filter(TABS.find((x) => x[0] === k)[2]) : []);
  const post = (url, body) => api(url, { method: "POST", body });
  const chip = (x) => {
    const st = x.por_ver ? ["wait", "Por ver"] : x.status === "enviado" && x.repetir ? ["wait", "Sem resposta"] : STATE[x.status] || STATE.outro;
    return `<span class="em-chip ${st[0]}">${esc(t(st[1]))}</span>`;
  };

  HUB_VIEWS.emails = async function () {
    D = null; raw = ""; tab = ""; sel = 0; conv = null; compose = null; modal = ""; camp = null; arm = "";
    page(`<div class="em" id="em">
      ${ui.head("Negócios", t("E-mails"), t("O Radar encontra, os e-mails saem com o teu sim e cada resposta chega aqui para decidires."),
        `<button type="button" class="btn" data-open="conta">${esc(t("Definições"))}</button><button type="button" class="btn primary" data-open="campanha">${esc(t("Nova campanha"))}</button>`)}
      <div id="em-note"></div>
      <div id="em-kpis">${ui.skeleton(4)}</div>
      <div class="segx em-tabs" id="em-tabs"></div>
      <div class="em-main" id="em-main"><section class="panel em-list" id="em-list"></section><section class="panel em-conv" id="em-conv"></section></div>
      <div class="em-modal" id="em-modal" hidden></div>
    </div>`);
    const root = $("em");
    root.addEventListener("click", click);
    root.addEventListener("submit", submit);
    root.addEventListener("change", changed);
    const wanted = window.__emailsSid;
    window.__emailsSid = "";
    await load();
    if (wanted) openCampaign(wanted);
    clearInterval(timer);
    timer = setInterval(() => {
      if (!$("em")) { clearInterval(timer); return; }
      if (!document.hidden) load().catch(() => {});
    }, 15000);
  };

  async function load() {
    const d = await api("/api/mail"), s = JSON.stringify(d);
    if (s === raw) return;
    raw = s; D = d;
    if (!tab) tab = list("porver").length ? "porver" : list("aprovar").length ? "aprovar" : list("repetir").length ? "repetir" : "enviados";
    draw();
    if (sel) await openThread(sel, true);
  }

  function draw() {
    const c = D.conta, sent = list("enviados"), got = list("recebidos");
    let note = "";
    if (!c.address) note = `<div class="panel pad em-connect"><div><b>${esc(t("Falta ligar o e-mail da empresa"))}</b><p>${esc(t("Podes preparar tudo já: os rascunhos ficam à espera. Assim que ligares a conta, sai o que aprovares e as respostas começam a chegar aqui."))}</p></div><button type="button" class="btn primary" data-open="conta">${esc(t("Ligar o e-mail"))}</button></div>`;
    else if (c.paused) note = `<div class="panel pad em-connect bad"><div><b>${esc(t("Os envios estão parados"))}</b><p>${esc(c.pause_reason || t("Paraste os envios nas definições."))}</p></div><button type="button" class="btn" data-resume>${esc(t("Retomar"))}</button></div>`;
    else if (c.last_error) note = `<div class="panel pad em-connect bad"><div><b>${esc(t("Problema na conta"))}</b><p>${esc(c.last_error)}</p></div><button type="button" class="btn" data-open="conta">${esc(t("Ver a conta"))}</button></div>`;
    paint($("em-note"), note);
    const queue = D.threads.filter((x) => x.pending && x.pending.status === "approved").length;
    paint($("em-kpis"), ui.kpis([
      ui.kpi({ label: "Por ver", value: fmt.int(list("porver").length), sub: t("respostas que ninguém leu") }),
      ui.kpi({ label: "Enviados", value: fmt.int(sent.length), sub: queue ? t("{n} na fila", { n: queue }) : t("{n} hoje", { n: c.hoje }), cls: "pn-plain" }),
      ui.kpi({ label: "Responderam", value: fmt.int(got.filter((x) => x.status !== "outro").length), sub: sent.length ? t("{n}% dos enviados", { n: Math.round((D.threads.filter((x) => x.sent > 0 && x.recebidos > 0).length / sent.length) * 100) }) : t("ainda nada enviado"), cls: "pn-plain" }),
      ui.kpi({ label: "Enviar outra vez", value: fmt.int(list("repetir").length), sub: t("sem resposta há {n} dias ou mais", { n: D.followup_dias }), cls: "pn-plain" }),
    ]));
    paint($("em-tabs"), TABS.map(([k, l]) => {
      const n = list(k).length;
      return `<button type="button" data-tab="${k}" class="${tab === k ? "on" : ""}">${esc(t(l))}${n ? ` <i>${n}</i>` : ""}</button>`;
    }).join(""));
    drawList();
    if (!sel) drawConv();
  }

  function drawList() {
    const pred = TABS.find((x) => x[0] === tab)[2];
    const items = D.threads.filter((x) => pred(x) || x.id === sel); // a conversa aberta não foge da lista por ter passado a vista
    const n = list(tab).length;
    const bulk = !D.can_send || !n ? "" : tab === "aprovar"
      ? `<button type="button" class="btn sm ${arm === "approve" ? "primary" : ""}" data-bulk="approve">${esc(arm === "approve" ? t("Confirmar: aprovar {n}", { n }) : t("Aprovar todos ({n})", { n }))}</button>`
      : tab === "repetir"
        ? `<button type="button" class="btn sm ${arm === "again" ? "primary" : ""}" data-bulk="again">${esc(arm === "again" ? t("Confirmar: enviar {n}", { n }) : t("Enviar a todos ({n})", { n }))}</button>`
        : "";
    const hint = { aprovar: "Lê, muda o que quiseres e aprova. Saem um de cada vez, em dias úteis, das 9h às 18h.", vistos: "Respostas que já foram abertas aqui no Hub.", enviados: "Não dá para saber se o cliente abriu sem um píxel escondido, que não usamos.", repetir: "Empresas que não responderam. Cada uma recebe no máximo duas insistências." }[tab];
    const body = items.length ? items.map((x) => `<button type="button" class="em-row ${x.id === sel ? "on" : ""} ${x.por_ver ? "new" : ""}" data-id="${x.id}">
        <span class="em-row-t"><b>${esc(x.nome || x.email)}</b><time>${esc(when(x.at))}</time></span>
        <span class="em-row-m">${esc(x.snippet || x.subject || x.email)}</span>
        <span class="em-row-b">${chip(x)}<small>${esc(x.email)}</small></span></button>`).join("")
      : ui.empty("inbox", { aprovar: "Nada por aprovar", enviados: "Ainda nada enviado", recebidos: "Ainda sem respostas", porver: "Está tudo visto", vistos: "Nenhuma resposta vista", repetir: "Ninguém para insistir", falhou: "Nada falhou" }[tab],
        tab === "aprovar" || tab === "enviados" ? "Escolhe uma pesquisa do Radar e cria os rascunhos." : "",
        tab === "aprovar" || tab === "enviados" ? `<button type="button" class="btn primary sm" data-open="campanha">${esc(t("Nova campanha"))}</button>` : "");
    paint($("em-list"), `${hint || bulk ? `<div class="em-list-h"><p>${esc(t(hint || ""))}</p>${bulk}</div>` : ""}<div class="em-rows">${body}</div>`);
  }

  async function openThread(id, quiet) {
    const box = $("em-conv");
    if ((box && box.contains(document.activeElement) && document.activeElement.tagName === "TEXTAREA") && quiet) return;
    const c = await api(`/api/mail/thread/${id}`);
    if (sel !== id && quiet) return;
    sel = id; conv = c;
    drawConv();
    if (!quiet) {
      $("em").classList.add("reading");
      const before = D.threads.find((x) => x.id === id);
      if (before && before.por_ver) { before.por_ver = 0; draw(); } else drawList();
    }
  }

  function drawConv() {
    const box = $("em-conv");
    if (!sel || !conv) {
      paint(box, ui.empty("inbox", "Escolhe uma conversa", "Aqui vês o que foi enviado, o que responderam e o que fazer a seguir."));
      return;
    }
    const x = conv, can = D.can_send, p = x.pending;
    const msgs = x.messages.filter((m) => m.status !== "draft").map((m) => `<article class="em-msg ${m.direction}">
        <header><b>${esc(m.direction === "in" ? x.nome || x.email : t("Nós"))}</b><span>${esc(when(m.at))}${m.direction === "out" ? ` · ${esc(t({ approved: "na fila", sending: "a sair", sent: "enviado", failed: "falhou" }[m.status] || ""))}` : m.kind === "auto" ? ` · ${esc(t("resposta automática"))}` : m.kind === "bounce" ? ` · ${esc(t("devolvido"))}` : ""}</span></header>
        ${m.subject ? `<h4>${esc(m.subject)}</h4>` : ""}<p>${esc(m.body)}</p>
        ${m.attachments.length ? `<small>${esc(t("Anexo"))}: ${m.attachments.map(esc).join(", ")}</small>` : ""}${m.error ? `<small class="err">${esc(m.error)}</small>` : ""}</article>`).join("");
    let act = "";
    if (can && p && p.status === "draft") {
      act = `<form class="em-edit" data-form="draft" data-mid="${p.id}"><label>${esc(t("Assunto"))}<input class="inp" name="subject" maxlength="280" value="${esc(p.subject)}"></label>
        <label>${esc(t("Texto"))}<textarea class="inp" name="body" rows="10">${esc(p.body)}</textarea></label>
        <p class="em-hint">${esc(t("No fim do e-mail juntamos quem somos e como recusar."))}</p>
        <div class="em-btns"><button class="btn primary" name="go" value="approve">${esc(t("Aprovar e enviar"))}</button><button class="btn" name="go" value="save">${esc(t("Guardar"))}</button><button type="button" class="btn quiet" data-discard>${esc(t("Deitar fora"))}</button></div></form>`;
    } else if (can && p && p.status === "approved") {
      act = `<div class="em-ask"><p>${esc(t("Está na fila. Sai na sua vez, em dias úteis, das 9h às 18h."))}</p><div class="em-btns"><button type="button" class="btn" data-discard>${esc(t("Tirar da fila"))}</button></div></div>`;
    } else if (can && compose) {
      act = `<form class="em-edit" data-form="reply"><label>${esc(compose.title)}<textarea class="inp" name="body" rows="9">${esc(compose.text)}</textarea></label>
        <div class="em-btns"><button class="btn primary">${esc(t("Enviar agora"))}</button><button type="button" class="btn quiet" data-cancel>${esc(t("Cancelar"))}</button></div></form>`;
    } else if (can && x.status === "respondeu" && !x.action) {
      act = `<div class="em-ask hot"><b>${esc(t("{n} respondeu. O que fazemos?", { n: x.nome || x.email }))}</b>
        <div class="em-btns"><button type="button" class="btn primary" data-do="pdf">${esc(t("Fazer o PDF"))}</button><button type="button" class="btn" data-do="condicoes">${esc(t("Enviar as nossas condições"))}</button><button type="button" class="btn" data-do="escrever">${esc(t("Escrever eu"))}</button><button type="button" class="btn quiet" data-do="ignorar">${esc(t("Ignorar"))}</button><button type="button" class="btn quiet" data-unseen>${esc(t("Marcar como por ver"))}</button></div></div>`;
    } else if (can) {
      const said = x.action === "pdf" ? t("O PDF foi pedido ao Design. Vê o trabalho no Escritório; antes de sair, pede-te aprovação.") : x.action === "condicoes" ? t("As condições foram enviadas.") : "";
      act = `<div class="em-ask">${said ? `<p>${esc(said)}</p>` : ""}<div class="em-btns">
        ${x.pode_repetir ? `<button type="button" class="btn" data-again>${esc(t("Enviar outra vez"))}</button>` : ""}
        ${x.status !== "removido" && x.recebidos ? `<button type="button" class="btn" data-do="escrever">${esc(t("Responder"))}</button>` : ""}
        ${x.recebidos ? `<button type="button" class="btn quiet" data-unseen>${esc(t("Marcar como por ver"))}</button>` : ""}</div></div>`;
    }
    paint(box, `<header class="em-conv-h"><button type="button" class="btn quiet sm em-back" data-back>${esc(t("Voltar"))}</button>
        <div><h3>${esc(x.nome || x.email)}</h3><p>${esc([x.email, x.local, x.ramo].filter(Boolean).join(" · "))}</p></div>${chip(x)}</header>
      ${x.error ? `<p class="em-err">${esc(x.error)}</p>` : ""}
      <div class="em-links">${x.site ? `<a href="${esc(x.site)}" target="_blank" rel="noopener">${esc(t("Abrir o site"))}</a>` : ""}${x.lead ? `<a href="#/crm">${esc(t("Ver no CRM"))}</a>` : ""}${x.task_id ? `<a href="#/escritorio">${esc(t("Ver no Escritório"))}</a>` : ""}</div>
      ${x.facts.length ? `<details class="em-facts"><summary>${esc(t("O que o Radar viu"))}</summary><ul>${x.facts.map((f) => `<li>${esc(f)}</li>`).join("")}</ul></details>` : ""}
      <div class="em-msgs">${msgs}</div>${act}`);
  }

  // ---------------------------------------------------------------- janelas: conta e campanha

  function drawModal() {
    const m = $("em-modal");
    m.hidden = !modal;
    if (!modal) { m.innerHTML = ""; return; }
    const close = `<button type="button" class="btn quiet sm" data-close>${esc(t("Fechar"))}</button>`;
    if (modal === "conta") {
      const c = D.conta;
      m.innerHTML = `<div class="em-mod"><div class="em-mod-h"><h3>${esc(t("Definições do e-mail"))}</h3>${close}</div>
        <form data-form="account" autocomplete="off" class="em-edit"><h4>${esc(c.address ? t("Conta ligada: {a}", { a: c.address }) : t("Ligar a conta da empresa"))}</h4>
          ${c.address ? `<p class="em-hint">${esc(t("Última verificação: {w}. Para trocar de conta, preenche de novo.", { w: when(c.last_check_at) || t("ainda não") }))}</p>` : `<p class="em-hint">${esc(t("No Gmail: liga a verificação em dois passos e cria uma palavra-passe de aplicação em myaccount.google.com/apppasswords. Fica guardada só na nuvem e nunca volta a aparecer."))}</p>`}
          <label>${esc(t("Endereço"))}<input class="inp" name="address" type="email" autocomplete="off" placeholder="geral@empresa.pt"></label>
          <label>${esc(t("Palavra-passe de aplicação"))}<input class="inp" name="password" type="password" autocomplete="new-password"></label>
          <details><summary>${esc(t("Outro fornecedor (não Gmail nem Outlook)"))}</summary><div class="em-two">
            <label>${esc(t("Servidor de envio"))}<input class="inp" name="smtp_host" placeholder="mail.empresa.pt"></label><label>${esc(t("Porta"))}<input class="inp" name="smtp_port" inputmode="numeric" placeholder="465"></label>
            <label>${esc(t("Servidor de leitura"))}<input class="inp" name="imap_host" placeholder="mail.empresa.pt"></label><label>${esc(t("Porta"))}<input class="inp" name="imap_port" inputmode="numeric" placeholder="993"></label></div></details>
          <p class="em-err" id="em-acc-err" hidden></p>
          <div class="em-btns"><button class="btn primary">${esc(t("Experimentar e ligar"))}</button></div></form>
        <form data-form="settings" class="em-edit"><h4>${esc(t("O que vai em cada e-mail"))}</h4>
          <label>${esc(t("Nome de quem envia"))}<input class="inp" name="from_name" value="${esc(c.from_name)}" placeholder="AMG"></label>
          <label>${esc(t("Quem somos (no fim de cada e-mail: empresa, NIF, site)"))}<textarea class="inp" name="footer" rows="3">${esc(c.footer)}</textarea></label>
          <label>${esc(t("As nossas condições (o texto do botão «Enviar as nossas condições»)"))}<textarea class="inp" name="conditions" rows="7" placeholder="${esc(t("Preços, o que inclui, prazos, como começamos."))}">${esc(c.conditions)}</textarea></label>
          <label>${esc(t("Máximo de e-mails novos por dia"))}<input class="inp" name="daily_cap" inputmode="numeric" value="${c.daily_cap}"></label>
          <p class="em-hint">${esc(t("Uma conta nova deve começar devagar: 30 por dia é um bom início."))}</p>
          <div class="em-btns"><button class="btn primary">${esc(t("Guardar"))}</button><button type="button" class="btn" data-pause>${esc(c.paused ? t("Retomar os envios") : t("Parar os envios"))}</button></div></form></div>`;
      return;
    }
    const s = camp;
    if (!s.sid) {
      m.innerHTML = `<div class="em-mod"><div class="em-mod-h"><h3>${esc(t("Nova campanha"))}</h3>${close}</div>
        <p class="em-hint">${esc(t("Escolhe uma pesquisa do Radar."))}</p>
        ${s.scans.length ? `<div class="em-scans">${s.scans.map((c) => `<button type="button" class="em-scan" data-scan="${esc(c.id)}"><b>${esc(c.ramo_nome || c.ramo)}</b><span>${esc(c.local || t("lista"))}</span></button>`).join("")}</div>`
          : ui.empty("search", "Ainda não há pesquisas", "Faz uma pesquisa no Radar e volta aqui.", `<a class="btn primary sm" href="#/radar">${esc(t("Abrir o Radar"))}</a>`)}</div>`;
      return;
    }
    const usable = s.items.filter((n) => n.email && !n.contactado), missing = s.items.filter((n) => !n.email && n.site);
    const nothing = s.items.filter((n) => !n.email && !n.site).length;
    m.innerHTML = `<div class="em-mod wide"><div class="em-mod-h"><h3>${esc(s.title)}</h3>${close}</div>
      <p class="em-hint">${esc(t("{a} com e-mail, {b} com site por procurar, {c} sem contacto.", { a: usable.length, b: missing.length, c: nothing }))}</p>
      ${missing.length ? `<div class="em-btns"><button type="button" class="btn" data-find ${s.finding ? "disabled" : ""}>${esc(s.finding ? t("A procurar nos sites...") : t("Procurar e-mails nos sites ({n})", { n: missing.length }))}</button></div>` : ""}
      <div class="em-pick">${s.items.filter((n) => n.email).map((n) => `<label class="${n.contactado ? "off" : ""}"><input type="checkbox" data-nid="${esc(n.id)}" ${s.on.has(n.id) ? "checked" : ""} ${n.contactado ? "disabled" : ""}>
        <span><b>${esc(n.nome)}</b><small>${esc(n.email)}${n.contactado ? ` · ${esc(t("já nesta lista"))}` : n.problema ? ` · ${esc(n.problema)}` : ""}</small></span></label>`).join("") || `<p class="em-hint">${esc(t("Nenhuma destas empresas tem e-mail à vista."))}</p>`}</div>
      <div class="em-btns"><button type="button" class="btn primary" data-create ${s.on.size ? "" : "disabled"}>${esc(t("Criar rascunhos ({n})", { n: s.on.size }))}</button></div>
      <p class="em-hint">${esc(t("Nada é enviado aqui: ficam em «Por aprovar» para os leres, e entram no CRM."))}</p></div>`;
  }

  async function openCampaign(sid) {
    modal = "campanha";
    if (!sid) {
      const r = await api("/api/radar");
      camp = { sid: "", scans: (r.varreduras || []).filter((x) => x.fim) };
      drawModal();
      return;
    }
    const r = await api(`/api/mail/radar/${sid}`);
    camp = { sid, title: `${r.ramo_nome || ""}${r.local ? " · " + r.local : ""}`, items: r.negocios, on: new Set(r.negocios.filter((n) => n.email && !n.contactado).map((n) => n.id)), finding: false };
    drawModal();
  }

  // ---------------------------------------------------------------- ações

  async function act(fn) {
    if (busy) return;
    busy = true;
    try { await fn(); raw = ""; await load(); }
    catch (e) { flash(e.message); }
    finally { busy = false; }
  }

  async function click(e) {
    const b = e.target.closest("button, a");
    if (!b) return;
    const d = b.dataset;
    if (d.tab) { tab = d.tab; arm = ""; drawList(); paint($("em-tabs"), TABS.map(([k, l]) => { const n = list(k).length; return `<button type="button" data-tab="${k}" class="${tab === k ? "on" : ""}">${esc(t(l))}${n ? ` <i>${n}</i>` : ""}</button>`; }).join("")); return; }
    if (d.id) { compose = null; await openThread(Number(d.id)); return; }
    if ("back" in d) { sel = 0; conv = null; $("em").classList.remove("reading"); drawList(); drawConv(); return; }
    if (d.open === "conta") { modal = "conta"; drawModal(); return; }
    if (d.open === "campanha") { try { await openCampaign(""); } catch (err) { flash(err.message); } return; }
    if ("close" in d) { modal = ""; drawModal(); return; }
    if (d.scan) { try { await openCampaign(d.scan); } catch (err) { flash(err.message); } return; }
    if ("find" in d) {
      camp.finding = true; drawModal();
      try {
        const r = await post(`/api/mail/radar/${camp.sid}/find`, {});
        flash(t("Encontrei {a} e-mails em {b} sites.", { a: r.encontrados, b: r.procurados }));
        await openCampaign(camp.sid);
      } catch (err) { flash(err.message); camp.finding = false; drawModal(); }
      return;
    }
    if ("create" in d) {
      return act(async () => {
        const r = await post("/api/mail/campaign", { sid: camp.sid, nids: [...camp.on] });
        flash(t("Rascunhos prontos para leres: {n}.", { n: r.queued }));
        modal = ""; drawModal(); tab = "aprovar";
      });
    }
    if (d.bulk) {
      if (arm !== d.bulk) { arm = d.bulk; drawList(); return; }
      arm = "";
      const ids = list(tab).map((x) => x.id);
      return act(() => post(d.bulk === "approve" ? "/api/mail/approve" : "/api/mail/again", { ids }));
    }
    if ("discard" in d) { const id = sel; sel = 0; conv = null; $("em").classList.remove("reading"); return act(() => post("/api/mail/discard", { ids: [id] })); }
    if ("again" in d) return act(() => post("/api/mail/again", { ids: [sel] }));
    if ("unseen" in d) { const id = sel; sel = 0; conv = null; $("em").classList.remove("reading"); return act(() => post("/api/mail/unseen", { id })); }
    if ("cancel" in d) { compose = null; drawConv(); return; }
    if ("resume" in d || "pause" in d) { const paused = "pause" in d ? !D.conta.paused : false; return act(async () => { await post("/api/mail/settings", { paused }); modal = ""; drawModal(); }); }
    if (d.do === "ignorar" || d.do === "pdf") return act(async () => { await post("/api/mail/action", { id: sel, action: d.do }); if (d.do === "pdf") flash(t("Pedido ao Design. Vais vê-lo a trabalhar no Escritório.")); });
    if (d.do === "condicoes") {
      if (!D.conta.conditions) { flash(t("Escreve primeiro as nossas condições nas definições.")); modal = "conta"; drawModal(); return; }
      compose = { title: t("As nossas condições: lê e envia"), text: D.conta.conditions, action: "condicoes" }; drawConv(); return;
    }
    if (d.do === "escrever") { compose = { title: t("A tua resposta"), text: "", action: "manual" }; drawConv(); }
  }

  function changed(e) {
    const c = e.target.closest("[data-nid]");
    if (!c) return;
    if (c.checked) camp.on.add(c.dataset.nid); else camp.on.delete(c.dataset.nid);
    const b = $("em-modal").querySelector("[data-create]");
    b.disabled = !camp.on.size;
    b.textContent = t("Criar rascunhos ({n})", { n: camp.on.size });
  }

  async function submit(e) {
    const f = e.target.closest("form[data-form]");
    if (!f) return;
    e.preventDefault();
    const v = Object.fromEntries(new FormData(f));
    const kind = f.dataset.form;
    if (kind === "draft") {
      const approve = e.submitter && e.submitter.value === "approve";
      return act(async () => {
        await post("/api/mail/draft", { id: Number(f.dataset.mid), subject: v.subject, body: v.body });
        if (approve) await post("/api/mail/approve", { ids: [sel] });
        flash(t(approve ? "Aprovado: sai na sua vez." : "Guardado."));
      });
    }
    if (kind === "reply") {
      const action = compose.action;
      return act(async () => { await post("/api/mail/reply", { id: sel, body: v.body, action }); compose = null; flash(t("Vai sair agora.")); });
    }
    if (kind === "settings") return act(async () => { await post("/api/mail/settings", v); modal = ""; drawModal(); flash(t("Guardado.")); });
    if (kind === "account") {
      const err = $("em-acc-err"), btn = f.querySelector("button.primary");
      err.hidden = true; btn.disabled = true; btn.textContent = t("A experimentar...");
      try {
        const r = await post("/api/mail/account", v);
        modal = ""; drawModal(); flash(t("{a} ligado. A partir de agora as respostas chegam aqui.", { a: r.address }));
        setTimeout(() => load().catch(() => {}), 6000);
      } catch (x) {
        err.textContent = x.message; err.hidden = false; btn.disabled = false; btn.textContent = t("Experimentar e ligar");
      }
    }
  }
})();
