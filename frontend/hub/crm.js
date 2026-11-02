// CRM (#/crm, 03 · Negócios, separador do Radar): o Radar encontra a empresa, o CRM leva-a até ao negócio (2 nov 2026, pedido
// do David a partir da conversa do Marco com o GPT: «o Radar e o CRM deixam de ser ferramentas separadas»). Os mesmos dados do
// seguimento do Radar (backend/app/crm.py): o que se marca num aparece no outro. Quadro Novo lead → Contactado → Respondeu →
// Reunião → Proposta → Ganho (arrastar um cartão muda a fase), «Do Radar» com as quentes que ainda não entraram, a atividade
// de todos e a ficha de cada lead ao lado, com os três departamentos: Pesquisa investiga, Marketing escreve a mensagem (fica por
// aprovar: quem envia é uma pessoa) e Operações marca a próxima ação. A página segue docs/hub-paginas.md; classes cm-.
(function () {
  let D = null, sel = "", timer = 0, drag = "";
  const eur = (v) => `${Math.round(v).toLocaleString("pt-PT")} €`;
  const now = () => Date.now() / 1000;
  const day = (ts) => new Date(ts * 1000).toLocaleDateString("pt-PT", { day: "2-digit", month: "short" });
  const when = (ts) => {
    const d = new Date(ts * 1000), n = new Date();
    const dd = Math.round((new Date(d.toDateString()) - new Date(n.toDateString())) / 864e5);
    const h = d.toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });
    return dd === 0 ? t("Hoje, {h}", { h }) : dd === 1 ? t("Amanhã, {h}", { h }) : dd === -1 ? t("Ontem") : day(ts);
  };
  const town = (x) => (x.morada || "").replace(/^.*\d+[A-Za-z]?\s+/, "").split(",").pop().trim() || (x.local || "").split(",").pop().trim();
  const ago = (ts) => { const s = now() - ts; return s < 90 ? t("agora") : s < 3600 ? `${Math.round(s / 60)} min` : s < 86400 ? `${Math.round(s / 3600)} h` : day(ts); };
  const VALE = { sim: ["ok", "Quente"], talvez: ["wait", "Morno"], nao: ["off", "Frio"] };
  const TONE = { novo: "ai", contactado: "wait", respondeu: "busy", reuniao: "busy", proposta: "wait", fechou: "ok", nao: "bad" };
  const MONO = { PES: "PES", MKT: "MKT", OPS: "OPS" };
  const svg = (d) => `<svg class="i" viewBox="0 0 24 24">${d}</svg>`;
  const I = {
    tel: svg('<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>'),
    mail: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>'),
    wa: svg('<path d="M4 20l1.3-3.9A8 8 0 1 1 8 19z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.5-2-1-1 .8a4 4 0 0 1-2-2l.8-1-1-2z"/>'),
    web: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'),
    x: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  };

  HUB_VIEWS.crm = async function () {
    sel = "";
    page(`<div class="cm" id="cm">
      ${ui.head("Negócios", t("CRM"), t("Da oportunidade ao negócio: o Radar encontra, os departamentos preparam, vocês fecham."),
        `<a class="btn" href="#/radar">${esc(t("Abrir o Radar"))}</a>`)}
      <div id="cm-body">${ui.skeleton(6)}</div>
      <div class="cm-scrim" id="cm-scrim" hidden></div>
      <aside class="cm-dr" id="cm-dr" hidden aria-label="${esc(t("Ficha do lead"))}"></aside>
    </div>`);
    const root = $("cm");
    root.onclick = click;
    root.ondragstart = (e) => { const c = e.target.closest?.("[data-card]"); if (c) { drag = c.dataset.card; e.dataTransfer.effectAllowed = "move"; c.classList.add("drag"); } };
    root.ondragend = () => { drag = ""; root.querySelectorAll(".drag,.over").forEach((x) => x.classList.remove("drag", "over")); };
    root.ondragover = (e) => { const col = e.target.closest?.("[data-col]"); if (col && drag) { e.preventDefault(); root.querySelectorAll(".over").forEach((x) => x !== col && x.classList.remove("over")); col.classList.add("over"); } };
    root.ondrop = (e) => { const col = e.target.closest?.("[data-col]"); if (col && drag) { e.preventDefault(); const k = drag; drag = ""; move(k, col.dataset.col); } };
    root.onchange = (e) => {
      const f = e.target.dataset.f;
      if (f === "valor") save({ valor: e.target.value === "" ? null : Number(e.target.value) });
      if (f === "nota") save({ nota: e.target.value });
      if (f === "motivo") save({ motivo: e.target.value });
    };
    await load().catch((e) => paint($("cm-body"), ui.error(e.message)));
    clearInterval(timer);
    timer = setInterval(() => { if (!$("cm")) return clearInterval(timer); if (!document.hidden && !drag) load(true).catch(() => {}); }, 30000);
  };

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && $("cm-dr") && !$("cm-dr").hidden && !/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) closeDr();
  });

  async function load(quiet) {
    D = await api("/api/crm");
    paintBody();
    if (sel) { if (lead(sel)) { if (!quiet) paintDr(); } else closeDr(); }
  }
  const lead = (k) => (D?.leads || []).find((l) => l.key === k);

  /* ---------- a página ---------- */
  function paintBody() {
    const r = D.resumo, L = D.leads;
    const byStage = Object.fromEntries(D.stages.map(([k]) => [k, L.filter((l) => l.stage === k)]));
    const perdidos = L.filter((l) => l.stage === "nao");
    const novos7 = L.filter((l) => l.criado && now() - l.criado < 7 * 86400).length;
    const kpis = ui.kpis([
      ui.kpi({ label: "Leads em aberto", cls: r.atrasados ? "warn" : "", value: fmt.int(r.abertos), sub: r.atrasados ? t("{n} ações atrasadas", { n: r.atrasados }) : r.hoje ? t("{n} para fazer hoje", { n: r.hoje }) : t("{n} entraram esta semana", { n: novos7 }),
        viz: ui.cols(D.stages.slice(0, 5).map(([k]) => byStage[k].length)) }),
      ui.kpi({ label: "Quentes no Radar", value: fmt.int(r.quentes), sub: r.quentes ? t("valem a pena e ainda não estão aqui") : t("nenhuma por trazer"), go: r.quentes ? "Ver" : "", href: r.quentes ? "#cm-radar" : "" }),
      ui.kpi({ label: "Valor em aberto", value: r.valor_aberto == null ? null : eur(r.valor_aberto),
        sub: r.valor_aberto == null ? t("põe o valor de cada negócio na ficha") : t("{n} de {t} com valor", { n: r.com_valor, t: r.abertos }) }),
      ui.kpi({ label: "Ganhos", value: fmt.int(r.ganhos), viz: r.taxa == null ? "" : ui.ring(r.taxa),
        sub: r.taxa == null ? t("ainda nenhum fechado") : t("{p}% dos fechados · {v}", { p: r.taxa, v: r.valor_ganho == null ? t("sem valor") : eur(r.valor_ganho) }) }),
    ]);
    const col = ([k, label]) => {
      const list = byStage[k], soma = list.reduce((s, l) => s + (l.valor || 0), 0);
      return `<section class="cm-col" data-col="${k}">
        <header><span class="st ${TONE[k]}"><i></i>${esc(t(label))}</span><b>${list.length}</b>${soma ? `<em>${eur(soma)}</em>` : ""}</header>
        <div class="cm-cards">${list.map(cardHtml).join("") || `<p class="cm-none">${esc(t(k === "novo" ? "Traz uma do Radar" : "Arrasta para aqui"))}</p>`}</div>
      </section>`;
    };
    const board = L.length ? `<div class="cm-board">${D.stages.map(col).join("")}</div>
      <details class="cm-lost" data-col="nao"${perdidos.length ? "" : " hidden"}><summary><span class="st bad"><i></i>${esc(t("Perdidos"))}</span><b>${perdidos.length}</b><em>${esc(t("ficam registados com o motivo"))}</em></summary>
        <div class="cm-cards row">${perdidos.map(cardHtml).join("")}</div></details>`
      : `<div class="panel pad">${ui.empty("target", t("Ainda não há leads"), t("Faz uma pesquisa no Radar e carrega em «Adicionar ao CRM» nas empresas que valem a pena. Elas entram aqui com tudo o que o Radar já sabe."),
        `<a class="btn primary" href="#/radar">${esc(t("Ir ao Radar"))}</a>`)}</div>`;
    paint($("cm-body"), `${kpis}
      ${ui.sec("Pipeline", L.length ? `<span class="cm-hint">${esc(t("Arrasta um cartão para mudar de fase"))}</span>` : "")}
      ${board}
      <div class="cm-split">
        <section class="panel pad" id="cm-radar">
          <div class="pn-card-h"><b>${esc(t("Do Radar para o CRM"))}</b><small>${esc(t("as que valem a pena e ainda não estão no quadro"))}</small></div>
          ${radarHtml()}
        </section>
        <section class="panel pad">
          <div class="pn-card-h"><b>${esc(t("Atividade"))}</b><small>${esc(t("o que vocês e os departamentos fizeram"))}</small></div>
          ${feedHtml()}
        </section>
      </div>`);
  }

  function cardHtml(l) {
    const v = l.vale ? VALE[l.vale.v] : null, p = l.proxima;
    const late = p && p.quando < now() - 3600;
    return `<article class="cm-card${sel === l.key ? " on" : ""}" draggable="true" data-card="${esc(l.key)}" data-open="${esc(l.key)}">
      <div class="cm-card-t"><b>${esc(l.nome)}</b>${v ? `<span class="st ${v[0]}" title="${esc(l.vale.titulo)}"><i></i>${l.vale.pontos}</span>` : ""}</div>
      <small>${esc([l.ramo_nome, town(l)].filter(Boolean).join(" · "))}</small>
      ${l.valor != null ? `<div class="cm-val">${eur(l.valor)}</div>` : ""}
      ${p ? `<div class="cm-next${late ? " late" : ""}">${esc(p.texto)} · ${esc(late ? t("atrasado") : when(p.quando))}</div>` : ""}
      ${l.rascunho?.estado === "por aprovar" ? `<div class="cm-flag">${esc(t("Mensagem por aprovar"))}</div>` : ""}
    </article>`;
  }

  function radarHtml() {
    if (!D.radar.length) return `<p class="cm-none">${esc(t("Nada por trazer: as quentes das últimas pesquisas já estão no quadro. Faz uma pesquisa nova no Radar para encontrar mais."))}</p>`;
    return `<div class="cm-list">${D.radar.map((n) => `<div class="cm-rd">
        <div><b>${esc(n.nome)}</b><small>${esc([n.ramo_nome, town({ morada: n.local })].filter(Boolean).join(" · "))}</small>
          <p>${esc(n.porque.join(" · "))}</p></div>
        <span class="st ok"><i></i>${n.pontos}</span>
        <button class="btn sm" data-add="${n.sid}:${esc(n.nid)}">${esc(t("Adicionar"))}</button>
      </div>`).join("")}</div>${D.resumo.quentes > D.radar.length ? `<p class="cm-none">${esc(t("E mais {n} no Radar.", { n: D.resumo.quentes - D.radar.length }))}</p>` : ""}`;
  }

  function who(a) { return MONO[a.por] ? `<span class="cm-mono">${a.por}</span>` : ui.avatar(a.por || "?"); }
  function feedHtml() {
    const all = D.leads.flatMap((l) => (l.atividades || []).map((a) => ({ ...a, nome: l.nome, key: l.key }))).sort((a, b) => b.at - a.at).slice(0, 12);
    if (!all.length) return `<p class="cm-none">${esc(t("Ainda nada. Quando alguém liga, manda uma mensagem ou um departamento trabalha um lead, fica aqui."))}</p>`;
    return `<ol class="cm-feed">${all.map((a) => `<li data-open="${esc(a.key)}">${who(a)}<div><b>${esc(a.nome)}</b><p>${esc(a.texto)}</p></div><time>${esc(ago(a.at))}</time></li>`).join("")}</ol>`;
  }

  /* ---------- a ficha do lead ---------- */
  function openDr(k) { sel = k; $("cm-scrim").hidden = false; $("cm-dr").hidden = false; paintDr(); document.querySelectorAll(".cm-card").forEach((c) => c.classList.toggle("on", c.dataset.card === k)); }
  function closeDr() { sel = ""; if ($("cm-dr")) { $("cm-dr").hidden = true; $("cm-scrim").hidden = true; } document.querySelectorAll(".cm-card.on").forEach((c) => c.classList.remove("on")); }

  function wa(l, text) {
    const pt = l.telefones.map((x) => x.replace(/\D/g, "").replace(/^(00)?351/, "")).find((x) => /^9\d{8}$/.test(x));
    const intl = l.telefones.find((x) => /^(\+|00)\d/.test(x) && !/^(\+|00)351/.test(x));
    const n = pt ? `351${pt}` : intl ? intl.replace(/\D/g, "").replace(/^00/, "") : "";
    return n ? `https://wa.me/${n}${text ? `?text=${encodeURIComponent(text)}` : ""}` : "";
  }
  const mailto = (to, r) => `mailto:${to}${r ? `?subject=${encodeURIComponent(r.assunto)}&body=${encodeURIComponent(r.texto)}` : ""}`;
  const local = (ts) => { const d = new Date(ts * 1000); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

  function paintDr() {
    const l = lead(sel); if (!l) return closeDr();
    const v = l.vale, r = l.rascunho, p = l.proxima;
    const draft = r && r.estado === "por aprovar" ? r : null;
    const w = wa(l, draft?.texto), mail = l.emails[0];
    const acts = [
      l.telefones[0] && `<a class="cm-act" href="tel:${esc(l.telefones[0].replace(/\s/g, ""))}" data-did="chamada">${I.tel}<span>${esc(t("Ligar"))}</span></a>`,
      w && `<a class="cm-act" href="${esc(w)}" target="_blank" rel="noopener" data-did="whatsapp">${I.wa}<span>WhatsApp</span></a>`,
      mail && `<a class="cm-act" href="${esc(mailto(mail, draft))}" data-did="email">${I.mail}<span>${esc(t("Email"))}</span></a>`,
      l.site && `<a class="cm-act" href="${esc(/^https?:/.test(l.site) ? l.site : "https://" + l.site)}" target="_blank" rel="noopener">${I.web}<span>${esc(t("Site"))}</span></a>`,
    ].filter(Boolean).join("");
    const timeline = [...(l.atividades || [])].sort((a, b) => b.at - a.at);
    paint($("cm-dr"), `<div class="cm-dr-bar"><a class="btn quiet sm" href="#/radar" data-radar="${esc(l.sid || "")}">${esc(t("Ver no Radar"))}</a><span></span><button class="btn quiet sm" data-close aria-label="${esc(t("Fechar"))}">${I.x}</button></div>
      <div class="cm-dr-in">
        <div class="cm-dr-head"><div><h3>${esc(l.nome)}</h3><p>${esc([l.ramo_nome, l.morada || l.local].filter(Boolean).join(" · "))}</p></div>
          ${v ? `<span class="st ${VALE[v.v][0]}"><i></i>${esc(t(VALE[v.v][1]))} · ${v.pontos}/100</span>` : ""}</div>
        <div class="cm-stages">${D.stages.concat([["nao", "Perdido"]]).map(([k, lab]) => `<button type="button" class="cm-pill ${l.stage === k ? "on " + TONE[k] : ""}" data-move="${k}">${esc(t(lab))}</button>`).join("")}</div>
        ${l.stage === "nao" ? `<label class="cm-f"><span>${esc(t("Porque não quis"))}</span><input data-f="motivo" value="${esc(l.motivo || "")}" placeholder="${esc(t("Ex.: já tem agência, sem orçamento agora"))}"></label>` : ""}
        ${acts ? `<div class="cm-acts">${acts}</div>` : `<p class="cm-none">${esc(t("Sem telefone nem email públicos: vê o Facebook ou vai lá."))}</p>`}
        <div class="cm-grid">
          <label class="cm-f"><span>${esc(t("Valor do negócio (€)"))}</span><input type="number" min="0" step="50" data-f="valor" value="${l.valor ?? ""}" placeholder="${esc(t("Ex.: 1200"))}"></label>
          <div class="cm-f"><span>${esc(t("Próxima ação"))}</span>
            <form class="cm-nextf" data-form="proxima"><input name="texto" value="${esc(p?.texto || "")}" placeholder="${esc(t("Ex.: Ligar ao dono"))}"><input type="datetime-local" name="quando" value="${p ? local(p.quando) : ""}"><button class="btn sm">${esc(t("Guardar"))}</button></form>
            ${p ? `<small class="${p.quando < now() - 3600 ? "late" : ""}">${esc(when(p.quando))}${p.por ? ` · ${esc(p.por)}` : ""}</small>` : ""}</div>
        </div>
        <section><h4 class="cm-h">${esc(t("Departamentos"))}</h4>
          <div class="cm-agents">
            <button type="button" data-agent="pesquisa"><span class="cm-mono">PES</span><b>${esc(t("Pesquisa"))}</b><small>${esc(t("Investiga: marca, redes, Google, dinheiro"))}</small></button>
            <button type="button" data-agent="marketing"><span class="cm-mono">MKT</span><b>${esc(t("Marketing"))}</b><small>${esc(t("Escreve a primeira mensagem"))}</small></button>
            <button type="button" data-agent="operacoes"><span class="cm-mono">OPS</span><b>${esc(t("Operações"))}</b><small>${esc(t("Marca a próxima ação da fase"))}</small></button>
          </div></section>
        ${draft ? `<section class="cm-draft"><h4 class="cm-h">${esc(t("Mensagem do Marketing · por aprovar"))}</h4><pre>${esc(draft.texto)}</pre>
          <div class="cm-draft-a">${w ? `<a class="btn primary sm" href="${esc(w)}" target="_blank" rel="noopener" data-approve="WhatsApp">${esc(t("Aprovar e abrir no WhatsApp"))}</a>` : ""}
          ${mail ? `<a class="btn sm" href="${esc(mailto(mail, draft))}" data-approve="email">${esc(t("Aprovar e abrir o email"))}</a>` : ""}
          <button class="btn quiet sm" data-copy>${esc(t("Copiar"))}</button><button class="btn quiet sm" data-drop>${esc(t("Apagar"))}</button></div></section>` : ""}
        ${l.problemas?.length ? `<section><h4 class="cm-h">${esc(t("O que lhe vender"))}</h4><ul class="cm-probs">${l.problemas.map((x) => `<li><b>${esc(x.problema)}</b><span>${esc(x.solucao || "")}</span></li>`).join("")}</ul></section>` : ""}
        <section><h4 class="cm-h">${esc(t("Registar"))}</h4>
          <form class="cm-log" data-form="atividade"><select name="tipo">${Object.entries(D.tipos).map(([k, lab]) => `<option value="${k}">${esc(t(lab))}</option>`).join("")}</select>
            <input name="texto" placeholder="${esc(t("O que aconteceu? Ex.: falei com o dono, quer orçamento"))}"><button class="btn sm">${esc(t("Registar"))}</button></form></section>
        <label class="cm-f"><span>${esc(t("Notas"))}</span><textarea data-f="nota" rows="3" placeholder="${esc(t("O que a equipa deve saber"))}">${esc(l.nota || "")}</textarea></label>
        <section><h4 class="cm-h">${esc(t("Histórico"))}</h4>
          ${timeline.length ? `<ol class="cm-feed">${timeline.map((a) => `<li>${who(a)}<div><p>${esc(a.texto)}</p></div><time>${esc(day(a.at))}</time></li>`).join("")}</ol>` : `<p class="cm-none">${esc(t("Ainda nada registado."))}</p>`}
        </section>
      </div>`);
    $("cm-dr").querySelectorAll("form[data-form]").forEach((f) => (f.onsubmit = (e) => { e.preventDefault(); submit(f); }));
  }

  /* ---------- ações ---------- */
  async function save(body, k = sel) {
    try { await api("/api/crm/lead", { method: "POST", body: { key: k, ...body } }); await load(); } catch (e) { toast(e.message); }
  }
  const move = (k, stage) => { const l = lead(k); if (l && l.stage !== stage) save({ estado: stage }, k); };
  function submit(f) {
    const d = Object.fromEntries(new FormData(f));
    if (f.dataset.form === "proxima") save({ proxima: d.texto ? { texto: d.texto, quando: d.quando ? new Date(d.quando).getTime() / 1000 : now() } : null });
    else save({ atividade: { tipo: d.tipo, texto: d.texto } });
  }
  function toast(m) { if (window.ui?.toast) ui.toast(m); else console.warn(m); }

  async function click(e) {
    const el = (s) => e.target.closest(s);
    if (el("#cm-scrim") || el("[data-close]")) return closeDr();
    const add = el("[data-add]");
    if (add) {
      add.disabled = true;
      const [sid, nid] = add.dataset.add.split(":");
      try { const l = await api("/api/crm/add", { method: "POST", body: { sid, nid } }); await load(); if (l?.nome) { const n = D.leads.find((x) => x.nome === l.nome); if (n) openDr(n.key); } }
      catch (err) { add.disabled = false; toast(err.message); }
      return;
    }
    const mv = el("[data-move]"); if (mv) return move(sel, mv.dataset.move);
    const ag = el("[data-agent]");
    if (ag) {
      ag.classList.add("busy");
      try { await api("/api/crm/agente", { method: "POST", body: { key: sel, agente: ag.dataset.agent } }); await load(); } catch (err) { toast(err.message); }
      return;
    }
    const ap = el("[data-approve]");
    if (ap) { const l = lead(sel); setTimeout(() => save({ rascunho: "aprovado", canal: ap.dataset.approve, ...(l.stage === "novo" ? { estado: "contactado" } : {}) }), 50); return; }
    if (el("[data-drop]")) return save({ rascunho: "apagar" });
    if (el("[data-copy]")) { const l = lead(sel); navigator.clipboard?.writeText(l?.rascunho?.texto || ""); el("[data-copy]").textContent = t("Copiado"); return; }
    const did = el("[data-did]");
    if (did) { const l = lead(sel); setTimeout(() => save({ atividade: { tipo: did.dataset.did, texto: "" }, ...(l.stage === "novo" ? { estado: "contactado" } : {}) }), 50); return; }
    const rd = el("[data-radar]"); if (rd && rd.dataset.radar) { try { localStorage.setItem("radar.cur", rd.dataset.radar); } catch {} return; }
    const op = el("[data-open]"); if (op && !el(".cm-dr")) return openDr(op.dataset.open);
  }
})();
