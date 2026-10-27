// Radar (#/radar, 03 · Negócios): encontrar clientes. Escolhe-se o ramo e a zona; o Hub encontra os negócios, vê o site de
// cada um e diz a quem ligar primeiro, com a mensagem, o PDF e o seguimento (backend/app/radar.py). Refeito a 23 out para
// quem nunca lhe mexeu (Marco: «está bastante confuso... profissional e simples»): uma pesquisa numa linha, três números,
// separadores e, em cada negócio, primeiro o porquê e logo ao lado o que fazer. A página segue docs/hub-paginas.md; classes rd-.
(function () {
  let S = null, SC = null, cur = null, open = "", timer = 0;
  const FX = {}, fxTimer = {};  // a ficha completa de cada negócio aberto (marca, redes, Google, dinheiro, o que lhe vender)
  const eur = (v) => `${Math.round(v).toLocaleString("pt-PT")} €`;
  const range = (a, b) => a === b ? eur(a) : `${Math.round(a).toLocaleString("pt-PT")}–${eur(b)}`;
  const big = (v) => v >= 10000 ? `${(v / 1000).toLocaleString("pt-PT", { maximumFractionDigits: 1 })} mil` : v.toLocaleString("pt-PT");
  const REDE = { instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok", youtube: "YouTube", linkedin: "LinkedIn" };
  let tab = (() => { try { return localStorage.getItem("radar.tab") || "top"; } catch { return "top"; } })();
  const KEY = "radar.cur";
  const day = (ts) => new Date(ts * 1000).toLocaleDateString("pt-PT", { day: "2-digit", month: "short" });
  const SEG_TONE = { por_contactar: "off", contactado: "wait", respondeu: "ai", reuniao: "busy", fechou: "ok", nao: "bad" };
  const PRIO = { quente: ["bad", "Ligar primeiro"], morna: ["wait", "A seguir"], fria: ["off", "Pouco interesse"] };
  const FASES = ["a procurar", "a ler", "a situar", "a procurar os sites", "a abrir os sites"];

  // o estado do site numa palavra que qualquer pessoa percebe
  function verdict(n) {
    const a = n.audit || {};
    if (!n.site) return n.facebook ? ["bad", "Só tem Facebook"] : ["bad", "Não tem site"];
    if (a.erro) return ["bad", "Site em baixo"];
    if (n.nota_site < 40) return ["bad", `Site fraco · ${n.nota_site}/100`];
    if (n.nota_site < 70) return ["wait", `Site razoável · ${n.nota_site}/100`];
    return ["ok", `Site bom · ${n.nota_site}/100`];
  }

  HUB_VIEWS.radar = async function () {
    cur = cur || (() => { try { return localStorage.getItem(KEY); } catch { return null; } })();
    page(`<div class="rd" id="rd">
      ${ui.head("Negócios", t("Radar"), t("Encontra clientes: escolhe o ramo e a zona, o Radar vê o site de cada negócio e diz-te a quem ligar primeiro."),
        `<div class="rd-ctl" id="rd-ctl"></div>`)}
      <div class="rd-msg" id="rd-msg" hidden></div>
      <section class="panel pad rd-form" id="rd-form"></section>
      <div id="rd-body"></div>
    </div>`);
    $("rd").onclick = click;
    $("rd").onchange = (e) => { if (e.target.id === "rd-pick") pick(e.target.value); };
    await load().catch((e) => paint($("rd-body"), ui.error(e.message)));
  };

  async function load() {
    S = await api("/api/radar");
    paintForm();
    if (cur && !S.varreduras.some((v) => v.id === cur)) cur = null;
    cur = cur || S.varreduras[0]?.id || null;
    await loadScan();
  }

  async function loadScan() {
    if (!cur) { SC = null; paintCtl(); paintBody(); return; }
    SC = await api(`/api/radar/${cur}`);
    paintCtl(); paintBody();
    clearTimeout(timer);
    if (SC.job) timer = setTimeout(() => { if ($("rd") && !document.hidden) loadScan().catch(() => {}); else if ($("rd")) timer = setTimeout(loadScan, 3000); }, 2500);
    else if (S.varreduras.find((v) => v.id === cur)?.job) { S = await api("/api/radar"); paintBody(); }
  }

  function msg(text) {
    const el = $("rd-msg");
    if (!el) return;
    el.hidden = false; el.textContent = text;
    clearTimeout(msg.t); msg.t = setTimeout(() => { el.hidden = true; }, 5000);
  }

  function paintCtl() {
    paint($("rd-ctl"), SC?.job ? `<span class="st busy"><i></i>${esc(t("A procurar…"))}</span>`
      : SC ? `<span class="st ok"><i></i>${esc(t("Pesquisa de {d}", { d: day(SC.fim || SC.at) }))}</span>` : "");
  }

  // a pesquisa numa frase: «Escolas de condução em Leiria, só perto»
  function paintForm() {
    if ($("rd-form")._html) return;
    const ramos = Object.entries(S.ramos).map(([k, v]) => `<option value="${k}">${esc(t(v))}</option>`).join("");
    paint($("rd-form"), `<form class="rd-f" id="rd-f">
      <label class="field"><span>${esc(t("O que procuras"))}</span><select name="ramo">${ramos}</select></label>
      <label class="field rd-zona"><span>${esc(t("Onde"))}</span><input name="local" placeholder="${esc(t("Cidade ou vila, ex.: Leiria"))}" autocomplete="off"></label>
      <label class="field"><span>${esc(t("Até onde"))}</span><select name="raio">
        <option value="10">${esc(t("Só a cidade · 10 km"))}</option>
        <option value="20" selected>${esc(t("Arredores · 20 km"))}</option>
        <option value="40">${esc(t("Região · 40 km"))}</option>
        <option value="0">${esc(t("Distrito inteiro"))}</option></select></label>
      <button class="btn primary rd-go" type="submit">${icon("search")}${esc(t("Procurar"))}</button>
      <details class="rd-lista"><summary>${esc(t("Já tens uma lista de nomes? Cola-a aqui"))}</summary>
        <label class="field"><textarea name="lista" placeholder="${esc(t("Um por linha. Ex.:\nGato Preto\nVia Dinâmica | https://…"))}"></textarea></label></details>
    </form>`);
    const f0 = $("rd-f"), dist = f0.raio.querySelector('[value="0"]');
    f0.ramo.onchange = () => { dist.hidden = f0.ramo.value !== "escolas"; if (dist.hidden && f0.raio.value === "0") f0.raio.value = "20"; };
    f0.ramo.onchange();
    f0.onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      try {
        const sc = await api("/api/radar", { method: "POST", body: { ramo: f.get("ramo"), local: f.get("local"), raio: Number(f.get("raio")), lista: f.get("lista") || "" } });
        cur = sc.id; open = ""; setTab("top");
        try { localStorage.setItem(KEY, cur); } catch {}
        S = await api("/api/radar"); await loadScan();
      } catch (err) { msg(err.message); }
    };
  }

  function setTab(x) { tab = x; try { localStorage.setItem("radar.tab", x); } catch {} }

  function paintBody() {
    if (!SC) {
      paint($("rd-body"), `<div class="rd-how">${[
        ["1", "Escolhe o ramo e a zona", "Por exemplo, escolas de condução em Leiria, ou o distrito inteiro."],
        ["2", "O Radar faz o trabalho", "Encontra todos os negócios, abre o site de cada um e vê o que está mal. Leva 1 a 4 minutos."],
        ["3", "Contactas os melhores", "Para cada um tens a mensagem pronta, o WhatsApp num toque e um PDF para mandar."],
      ].map(([n, h, p]) => `<div class="panel rd-step"><span>${n}</span><b>${esc(t(h))}</b><p>${esc(t(p))}</p></div>`).join("")}</div>`);
      return;
    }
    const sc = SC, r = sc.resumo || {}, negs = sc.negocios || [], job = sc.job;
    const where = !sc.local ? t("lista colada") : sc.raio ? t("{l} e {r} km à volta", { l: sc.local, r: sc.raio }) : t("distrito de {d}", { d: sc.distrito || sc.local });
    const others = S.varreduras.length > 1 ? `<select class="inp rd-pick" id="rd-pick" title="${esc(t("Pesquisas anteriores"))}">${S.varreduras.map((v) =>
      `<option value="${v.id}" ${v.id === cur ? "selected" : ""}>${esc(`${v.ramo_nome} · ${v.local || t("lista")} · ${day(v.at)}`)}</option>`).join("")}</select>` : "";
    let html = `<div class="rd-top"><h2 class="rd-title">${esc(sc.ramo_nome)} <span>· ${esc(where)}</span></h2><div class="rd-tools">${others}
      ${job ? "" : `<a class="btn quiet sm" href="/api/radar/${cur}/csv?token=${encodeURIComponent(token)}" target="_blank" rel="noopener">${esc(t("Excel"))}</a>
      <button type="button" class="btn quiet sm" data-del="${cur}">${esc(t("Apagar"))}</button>`}</div></div>`;
    if (job) {
      const step = Math.max(0, FASES.findIndex((f) => job.fase.startsWith(f)));
      const at = step >= 3 ? step - 2 : 0;
      const pct = job.total ? Math.round(100 * job.feitos / job.total) : 5;
      html += `<section class="panel pad rd-job">${["Encontrar os negócios", "Procurar o site de cada um", "Ver o que está mal em cada site"].map((s, i) =>
        `<div class="rd-js ${i < at ? "done" : i === at ? "now" : ""}"><i>${i < at ? icon("tick") : i + 1}</i><span>${esc(t(s))}</span>${i === at && job.total ? `<small>${job.feitos} / ${job.total}</small>` : ""}</div>`).join("")}
        ${ui.progress(at === 0 ? 8 : at === 1 ? 10 + pct * 0.4 : 50 + pct * 0.5)}
        <p>${esc(t("Podes sair desta página: a pesquisa continua e fica guardada."))}</p></section>`;
      paint($("rd-body"), html);
      return;
    }
    if (sc.erro && !negs.length) { paint($("rd-body"), html + `<div class="rd-msg">${esc(sc.erro)}</div>`); return; }
    const leads = (S.seguimento || []).filter((l) => l.estado !== "por_contactar");
    const todo = negs.filter((n) => n.nivel === "quente" && !(n.lead && n.lead.estado !== "por_contactar"));
    // the Painel's row (hub/painel.css): how many, how many without a site, the median site, who to call first
    const lvl = { quente: 0, morna: 0, fria: 0 };
    negs.forEach((n) => { if (n.nivel in lvl) lvl[n.nivel]++; });
    const pctOf = (k) => (r.total ? (k / r.total) * 100 : null);
    html += `<div class="rd-sum">${ui.kpis([
      ui.kpi({ label: "Encontrados", value: r.total ?? null, sub: t("{q} quentes · {m} mornos · {f} frios", { q: lvl.quente, m: lvl.morna, f: lvl.fria }),
        viz: r.total ? ui.cols([lvl.fria, lvl.morna, lvl.quente], { fat: true }) : "" }),
      ui.kpi({ label: "Sem site", value: r.sem_site ?? null, sub: t("{n} com o site em baixo", { n: r.em_baixo || 0 }), viz: ui.ring(pctOf(r.sem_site || 0)) }),
      ui.kpi({ label: "Nota mediana do site", value: r.nota_mediana == null ? null : `${r.nota_mediana}/100`, sub: t("{n} sites vistos", { n: (r.com_site || 0) - (r.em_baixo || 0) }),
        viz: r.nota_mediana == null ? "" : ui.ring(r.nota_mediana, { text: String(r.nota_mediana) }) }),
      ui.kpi({ label: "Para ligar primeiro", value: todo.length, sub: leads.length ? t("{n} já em contacto", { n: leads.length }) : t("ainda ninguém contactado"),
        viz: r.total ? ui.ring(pctOf(todo.length)) : "", cls: todo.length ? "rd-hot" : "" }),
    ])}</div>`;
    const tabs = [["top", "Para contactar", todo.length], ["all", "Todos", negs.length], ["seg", "Em contacto", leads.length], ["zona", "Concorrência", ""]];
    html += `<div class="rd-tabs" role="tablist">${tabs.map(([k, l, n]) => `<button type="button" role="tab" class="${tab === k ? "on" : ""}" data-tab="${k}">${esc(t(l))}${n !== "" ? ` <small>${n}</small>` : ""}</button>`).join("")}</div>`;
    if (tab === "zona") html += market(sc);
    else if (tab === "seg") html += segList(leads);
    else {
      const list = tab === "top" ? todo : negs;
      html += list.length ? `<section class="panel rd-list">${list.map(row).join("")}</section>`
        : `<section class="panel">${ui.empty("target", tab === "top" ? "Já contactaste todos os mais importantes" : "Nada nesta zona",
          tab === "top" ? "Vê os outros em «Todos» ou faz uma pesquisa noutra zona." : "Não há negócios deste ramo aqui. Tenta uma zona maior.")}</section>`;
      html += `<p class="rd-note">${esc(t("Tudo vem do que o site e o mapa mostram hoje. A ordem junta o estado do site com sinais de que o negócio já paga por publicidade."))}</p>`;
    }
    paint($("rd-body"), html);
  }

  function row(n) {
    const [tone, lbl] = verdict(n), [pt, pl] = PRIO[n.nivel] || PRIO.fria, isOpen = open === n.id;
    const lead = n.lead && n.lead.estado !== "por_contactar";
    return `<div class="rd-row ${isOpen ? "open" : ""}">
      <button type="button" class="rd-line" data-row="${n.id}">
        <span class="rd-name"><b>${esc(n.nome)}</b><small>${esc(n.morada || "")}</small></span>
        <span class="rd-v ${tone}">${esc(t(lbl))}</span>
        ${lead || tab !== "top" ? `<span class="st ${lead ? SEG_TONE[n.lead.estado] : pt}"><i></i>${esc(t(lead ? S.estados[n.lead.estado] : pl))}</span>` : "<span></span>"}
        <span class="rd-chev">${icon("chevron")}</span>
      </button>
      ${isOpen ? detail(n) : ""}
    </div>`;
  }

  // um negócio aberto: à esquerda o porquê, à direita o que fazer
  function detail(n) {
    const a = n.audit || {}, g = n.gasto || {}, probs = n.problemas || [];
    const phones = String(n.telefone || "").split(/[;,/]/).map((x) => x.trim()).filter(Boolean);
    const links = [
      n.site && `<a href="${esc(a.final || n.site)}" target="_blank" rel="noopener">${esc(t("Ver o site"))}</a>`,
      n.facebook && `<a href="${esc(n.facebook)}" target="_blank" rel="noopener">Facebook</a>`,
      n.maps ? `<a href="${esc(n.maps)}" target="_blank" rel="noopener">${esc(t("Mapa"))}</a>`
        : n.lat ? `<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(n.nome)}%20${n.lat},${n.lon}" target="_blank" rel="noopener">${esc(t("Mapa"))}</a>` : "",
      ...(a.emails || (n.email ? [n.email] : [])).map((e) => `<a href="mailto:${esc(e)}">${esc(e)}</a>`),
    ].filter(Boolean).join("");
    return `<div class="rd-det">
      <div class="rd-why">
        <h4 class="rd-h">${esc(t("O que está mal e o que lhe propomos"))}</h4>
        ${probs.length ? `<ol class="rd-probs">${probs.slice(0, 4).map((p) => `<li><p>${esc(p.problema)}</p><span>${icon("tick")}${esc(p.solucao)}</span></li>`).join("")}</ol>
          ${probs.length > 4 ? `<details class="rd-more"><summary>${esc(t("Ver mais {n}", { n: probs.length - 4 }))}</summary><ol class="rd-probs" start="5">${probs.slice(4).map((p) => `<li><p>${esc(p.problema)}</p><span>${icon("tick")}${esc(p.solucao)}</span></li>`).join("")}</ol></details>` : ""}`
          : `<p class="rd-none">${esc(t("O site está bem feito: pouco a propor."))}</p>`}
        ${n.bons?.length ? `<p class="rd-good">${icon("tick")}${esc(t("Já está bem: {b}", { b: n.bons.join(" ").replace(/\.$/, "") }))}</p>` : ""}
        ${n.custo_site ? `<p class="rd-none rd-spend">${esc(t("O site custou-lhes cerca de {v} a fazer (estimativa).", { v: range(n.custo_site.min, n.custo_site.max) }))}</p>` : ""}
        ${g.max ? `<p class="rd-none rd-spend">${esc(t("Gasta cerca de {a}–{b} € por mês com o digital (estimativa pelo que o site mostra).", { a: g.min, b: g.max }))}</p>` : ""}
        ${n.site_achado ? `<p class="rd-none">${esc(t("O site foi encontrado pelo nome: confirma que é o deles antes de falar nele."))}</p>` : ""}
      </div>
      <div class="rd-do">
        <h4 class="rd-h">${esc(t("Contactar"))}</h4>
        <div class="rd-acts">
          ${wa(n) ? `<a class="btn primary" href="${wa(n)}" target="_blank" rel="noopener" data-wa="${n.id}">${icon("chat")}${esc(t("Mandar no WhatsApp"))}</a>` : ""}
          ${phones.map((x) => `<a class="btn ${wa(n) ? "" : "primary"}" href="tel:${esc(x.replace(/\s/g, ""))}">${esc(t("Ligar {n}", { n: x }))}</a>`).join("")}
          <a class="btn" href="/api/radar/${cur}/${n.id}/pdf?token=${encodeURIComponent(token)}" target="_blank" rel="noopener">${icon("doc")}${esc(t("PDF para enviar"))}</a>
          <button type="button" class="btn quiet" data-copy="${n.id}">${esc(t("Copiar a mensagem"))}</button>
        </div>
        ${!phones.length && !wa(n) ? `<p class="rd-none">${esc(t("Sem telefone público: usa o Facebook ou o email."))}</p>` : ""}
        ${links ? `<div class="rd-links">${links}</div>` : ""}
        <h4 class="rd-h">${esc(t("Em que ponto está"))}</h4>
        <div class="rd-seg-st">${Object.entries(S.estados).map(([k, v]) => `<button type="button" class="rd-pill ${(n.lead?.estado || "por_contactar") === k ? "on " + SEG_TONE[k] : ""}" data-lead="${n.id}" data-st="${k}">${esc(t(v))}</button>`).join("")}</div>
        <textarea class="inp rd-nota" data-nota="${n.id}" placeholder="${esc(t("Notas: com quem falaste, o que disse, quando voltar a ligar"))}">${esc(n.lead?.nota || "")}</textarea>
      </div>
      <div class="rd-fx" id="rd-fx-${n.id}">${ficha(n)}</div>
    </div>`;
  }

  // ---------- a ficha completa: abre-se o negócio e o Hub vai ver tudo o que há dele em público ----------
  async function loadFicha(nid, force) {
    clearTimeout(fxTimer[nid]);
    try {
      let r = await api(`/api/radar/${cur}/${nid}/ficha`, force ? { method: "POST" } : undefined);
      if (!r.ficha && !r.fase) r = await api(`/api/radar/${cur}/${nid}/ficha`, { method: "POST" });
      FX[nid] = r;
    } catch (err) { FX[nid] = { erro: err.message }; }
    const box = $(`rd-fx-${nid}`), n = SC?.negocios.find((x) => x.id === nid);
    if (box && n) paint(box, ficha(n));
    if (FX[nid].fase && open === nid) fxTimer[nid] = setTimeout(() => { if ($(`rd-fx-${nid}`) && !document.hidden) loadFicha(nid); }, 2500);
  }

  function ficha(n) {
    const r = FX[n.id];
    if (!r) return `<div class="rd-fx-wait">${esc(t("A preparar a ficha completa…"))}</div>`;
    if (r.erro) return `<div class="rd-fx-wait">${esc(r.erro)}</div>`;
    const f = r.ficha;
    if (!f) return `<div class="rd-fx-wait"><span class="st busy"><i></i>${esc(t(r.fase || "A começar"))}</span>
      <p>${esc(t("A ver o site, as redes sociais, o Google e o registo do domínio. Leva uns 20 segundos; a IA pensa a seguir."))}</p></div>`;
    const busy = r.fase ? `<span class="st busy"><i></i>${esc(t(r.fase))}</span>` : `<span class="rd-fx-at">${esc(t("Visto a {d}", { d: day(f.fim || f.at) }))}</span>`;
    return `<div class="rd-fx-head"><h4 class="rd-h">${esc(t("Ficha completa"))}</h4><div>${busy}
        ${r.fase ? "" : `<button type="button" class="btn quiet sm" data-fx="${n.id}">${esc(t("Atualizar"))}</button>`}</div></div>
      <div class="rd-fx-grid">${fxMarca(n, f)}${fxPresenca(n, f)}${fxAgencia(n, f)}${fxDinheiro(n, f)}</div>
      ${fxGanhar(n, f, r.fase)}`;
  }

  function fxMarca(n, f) {
    const m = f.marca || {}, d = f.dominio || {}, a = n.audit || {};
    if (!n.site) return `<section class="panel pad rd-fx-card"><h5>${esc(t("Marca"))}</h5><p class="rd-none">${esc(t("Sem site: a marca só se vê nas redes e no Google."))}</p>
      ${f.redes?.facebook || f.redes?.instagram ? `<p class="rd-none">${esc(t("Vê o perfil ao lado para o logótipo e as cores."))}</p>` : ""}</section>`;
    const img = m.logo || m.icone;
    const facts = [
      a.plataforma && [t("Feito em"), a.plataforma + (f.funcoes || []).filter((x) => /Elementor|Divi|WPBakery/.test(x)).map((x) => " + " + x).join("")],
      (a.agencia || d.registado_por) && [t("Quem o fez"), a.agencia || d.registado_por],
      d.titular && [t("Em nome de"), d.titular],
      f.desde && [t("Domínio desde"), String(f.desde)],
      f.paginas ? [t("Páginas"), String(f.paginas)] : null,
      (f.linguas || []).length > 1 && [t("Línguas"), f.linguas.join(", ").toUpperCase()],
    ].filter(Boolean);
    return `<section class="panel pad rd-fx-card"><h5>${esc(t("Marca"))}</h5>
      <div class="rd-brand">${img ? `<span class="rd-logo"><img src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.hidden=true"></span>` : ""}
        <div><b>${esc(m.nome || n.nome)}</b>${m.frase ? `<small>«${esc(m.frase)}»</small>` : ""}</div></div>
      ${(m.cores || []).length ? `<div class="rd-sw">${m.cores.map((c) => `<span title="${esc(c.papel)}"><i style="background:${esc(c.hex)}"></i>${esc(c.hex)}</span>`).join("")}</div>`
        : `<p class="rd-none">${esc(t("Sem cores próprias à vista no site."))}</p>`}
      <p class="rd-none">${(m.letras || []).length ? esc(t("Letra: {l}", { l: m.letras.join(", ") })) : esc(t("Letra do sistema, sem fonte própria."))}</p>
      ${facts.length ? `<dl class="rd-dl">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>` : ""}
      ${(f.funcoes || []).filter((x) => !/Elementor|Divi|WPBakery/.test(x)).length ? `<p class="rd-none">${esc(t("O site tem: {l}", { l: f.funcoes.filter((x) => !/Elementor|Divi|WPBakery/.test(x)).join(", ") }))}</p>` : ""}
    </section>`;
  }

  function fxPresenca(n, f) {
    const rd = f.redes || {}, g = f.google || {};
    const stars = g.estrelas != null ? `<b>${String(g.estrelas).replace(".", ",")}</b> ★ · ${esc(t("{n} opiniões", { n: g.opinioes ?? 0 }))}` : "";
    const gRow = `<li><span>Google</span><div>${g.nao_tem ? `<em class="bad">${esc(t("Sem ficha no mapa"))}</em>`
        : stars ? stars + (g.fonte ? ` <em>· ${esc(t("achado pela IA"))}</em>` : "")
        : `<em>${esc(t(!f.ia?.ideias && !f.ia?.erro && f.ia ? "A IA está a procurar…" : "Estrelas não encontradas"))}</em>`}
      <small><a href="${esc(g.mapa || "#")}" target="_blank" rel="noopener">${esc(t("Ver no mapa"))}</a> · <a href="${esc(g.pesquisa || "#")}" target="_blank" rel="noopener">${esc(t("Pesquisa Google"))}</a></small></div></li>`;
    const rows = Object.entries(REDE).map(([k, nome]) => {
      const x = rd[k];
      if (!x) return ["youtube", "linkedin"].includes(k) ? "" : f.redes_falhou && !f.ia?.ideias
        ? `<li><span>${nome}</span><div><em>${esc(t("Por confirmar"))}</em></div></li>`
        : `<li><span>${nome}</span><div><em class="bad">${esc(t("Não encontrado"))}</em></div></li>`;
      const nums = [x.seguidores != null && t("{n} seguidores", { n: big(x.seguidores) }), x.gostos != null && t("{n} gostos", { n: big(x.gostos) }),
        x.publicacoes != null && t("{n} publicações", { n: big(x.publicacoes) })].filter(Boolean).join(" · ");
      const h = x.perfil.startsWith("pages/") || x.perfil.startsWith("profile.php") ? t("página") : (k === "tiktok" || k === "instagram" ? "@" : "") + x.perfil.replace(/^@/, "");
      return `<li><span>${nome}</span><div><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(decodeURIComponent(h))}</a>
        <small>${esc([nums, t({ pesquisa: "achado na pesquisa", "IA (pesquisa web)": "achado pela IA", "diretório": "do diretório" }[x.fonte] || "ligado no site")].filter(Boolean).join(" · "))}</small></div></li>`;
    }).join("");
    const last = (g.ultimas || []).filter((x) => x.texto).slice(0, 2);
    return `<section class="panel pad rd-fx-card"><h5>${esc(t("Redes e Google"))}</h5><ul class="rd-net">${gRow}${rows}</ul>
      ${g.horario?.length ? `<details class="rd-more"><summary>${esc(t("Horário no Google"))}</summary><p class="rd-none">${g.horario.map(esc).join("<br>")}</p></details>` : ""}
      ${last.length ? `<div class="rd-rev">${last.map((x) => `<p>«${esc(x.texto)}»<small>${"★".repeat(x.estrelas || 0)} · ${esc(x.quando)}</small></p>`).join("")}</div>` : ""}
      ${(f.erros || []).length ? `<p class="rd-note">${esc(f.erros.join(" · "))}</p>` : ""}</section>`;
  }

  // quem fez o site: o fornecedor que hoje está no lugar onde queremos estar
  function fxAgencia(n, f) {
    const g = f.agencia, a = n.audit || {};
    if (!n.site) return `<section class="panel pad rd-fx-card"><h5>${esc(t("Quem fez o site"))}</h5><p class="rd-none">${esc(t("Ninguém: não tem site. Não há fornecedor a quem tirar o cliente."))}</p></section>`;
    if (!g || !g.nome) return `<section class="panel pad rd-fx-card"><h5>${esc(t("Quem fez o site"))}</h5>
      <p class="rd-none">${esc(t(a.plataforma && /Wix|Squarespace|Jimdo|Site123|GoDaddy/.test(a.plataforma) ? "Nenhum crédito nem registo: quase de certeza feito pelo próprio dono no {p}." : "O site não diz quem o fez e o registo do domínio não mostra ninguém.", { p: a.plataforma }))}</p></section>`;
    const host = g.site ? g.site.replace(/^https?:\/\/(www\.)?|\/$/g, "") : "";
    const facts = [
      g.site && [t("Site"), `<a href="${esc(g.site)}" target="_blank" rel="noopener">${esc(host)}</a>`],
      g.cidade && [t("Onde"), esc(g.cidade)],
      ...(g.emails || []).map((e) => [t("Email"), `<a href="mailto:${esc(e)}">${esc(e)}</a>`]),
      ...(g.telefones || []).map((x) => [t("Telefone"), `<a href="tel:${esc(x)}">${esc(x)}</a>`]),
      ...Object.entries(g.redes || {}).map(([k, u]) => [REDE[k] || k, `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(decodeURIComponent(u.replace(/^https?:\/\/(www\.)?[^/]+\//, "").replace(/\/$/, "")) || REDE[k])}</a>`]),
      g.plataforma && [t("O site deles"), esc(g.plataforma)],
      g.registou_dominio && [t("Registou o domínio"), esc(g.registou_dominio)],
    ].filter(Boolean);
    const outros = [...new Set([...(g.clientes_na_zona || []), ...(g.clientes || [])])];
    return `<section class="panel pad rd-fx-card"><h5>${esc(t("Quem fez o site"))}</h5>
      <div class="rd-brand"><div><b>${esc(g.nome)}</b>${g.titulo || g.descricao || g.nota ? `<small>${esc(g.nota || g.descricao || g.titulo)}</small>` : ""}</div></div>
      ${facts.length ? `<dl class="rd-dl">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join("")}</dl>` : ""}
      ${outros.length ? `<p class="rd-none">${esc(t("Outros clientes: {l}", { l: outros.join(", ") }))}</p>` : ""}
      <p class="rd-note">${esc(t("Fonte: {f}. É o concorrente direto neste cliente.", { f: [...new Set(g.fontes || [])].join(", ") || "site" }))}</p></section>`;
  }

  function fxDinheiro(n, f) {
    const k = f.custo, g = n.gasto || {};
    const lines = [];
    if (k) lines.push(`<div class="rd-money"><span>${esc(t("Fazer o site"))}</span><b>${esc(range(k.min, k.max))}</b></div>`);
    if (g.max) lines.push(`<div class="rd-money"><span>${esc(t("Por mês com o digital"))}</span><b>${esc(range(g.min, g.max))}</b></div>`);
    if (k?.ate_hoje) lines.push(`<div class="rd-money"><span>${esc(t("Desde {a}, só o site", { a: k.desde }))}</span><b>${esc(range(k.ate_hoje[0], k.ate_hoje[1]))}</b></div>`);
    const why = [...(k?.porque || []), ...(g.porque || [])];
    return `<section class="panel pad rd-fx-card"><h5>${esc(t("Quanto já gastaram"))}</h5>
      ${lines.length ? lines.join("") : `<p class="rd-none">${esc(t(n.site ? "O site não abriu: não dá para estimar." : "Não tem site: ainda não gastaram nada nisto. É o primeiro investimento."))}</p>`}
      ${why.length ? `<ul class="rd-why-list">${why.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
      <p class="rd-note">${esc(t("Estimativa a preços de mercado pelo que se vê em público, nunca a fatura deles. No «desde» só entram o site, o alojamento e o domínio."))}</p></section>`;
  }

  function fxGanhar(n, f, fase) {
    const o = f.ofertas || [], p = f.potencial || {}, ia = f.ia || {};
    const iaHtml = ia.ideias?.length ? `${ia.resumo ? `<p class="rd-ia-sum">${esc(ia.resumo)}</p>` : ""}
        <ol class="rd-ideas">${ia.ideias.map((x) => `<li><div><b>${esc(x.titulo)}</b>${x.preco ? `<span>${esc(x.preco)}</span>` : ""}</div>
          <p>${esc(x.porque)}</p>${x.como ? `<p class="rd-ia-how">${icon("tick")}${esc(x.como)}</p>` : ""}${x.ganho ? `<small>${esc(x.ganho)}</small>` : ""}</li>`).join("")}</ol>
        ${ia.abordagem ? `<div class="rd-open"><span>${esc(t("Para abrir a conversa"))}</span><p>«${esc(ia.abordagem)}»</p></div>` : ""}`
      : ia.erro ? `<p class="rd-none">${esc(t("A IA não respondeu ({e}). Ficam as propostas feitas por regras; carrega em Atualizar para tentar outra vez.", { e: ia.erro }))}</p>`
      : `<div class="rd-fx-wait"><span class="st busy"><i></i>${esc(t("A IA está a pensar no que lhes vender…"))}</span></div>`;
    return `<section class="panel pad rd-fx-earn">
      <div class="rd-earn-head"><h5>${esc(t("Como ganhamos dinheiro com eles"))}</h5>
        ${p.ano ? `<div class="rd-pot"><b>${esc(eur(p.ano))}</b><span>${esc(t("no 1.º ano: {u} de entrada + {m}/mês", { u: eur(p.unico), m: eur(p.mensal) }))}</span></div>` : ""}</div>
      <div class="rd-earn">
        <div><h6>${esc(t("O que lhes falta, com preço"))}</h6>
          <table class="rd-offer">${o.map((x) => `<tr><td><b>${esc(x.servico)}</b><small>${esc(x.porque)}</small></td>
            <td>${[x.unico ? eur(x.unico) : "", x.mensal ? `${eur(x.mensal)}/mês` : ""].filter(Boolean).join(" + ")}</td></tr>`).join("")}</table></div>
        <div><h6>${esc(t("O que a IA propõe"))}</h6>${iaHtml}</div>
      </div></section>`;
  }

  // em contacto: de todas as pesquisas, o mais recente primeiro
  function segList(leads) {
    if (!leads.length) return `<section class="panel">${ui.empty("chat", "Ainda não contactaste ninguém", "Abre um negócio em «Para contactar» e manda a mensagem: aparece aqui.")}</section>`;
    return `<section class="panel rd-list">${leads.map((l) => `<div class="rd-row"><button type="button" class="rd-line" data-seg="${l.sid}/${l.nid}">
      <span class="rd-name"><b>${esc(l.nome)}</b><small>${esc([l.local, day(l.at), l.nota && l.nota.slice(0, 80)].filter(Boolean).join(" · "))}</small></span>
      <span class="rd-v">${esc(l.telefone || "")}</span>
      <span class="st ${SEG_TONE[l.estado]}"><i></i>${esc(t(S.estados[l.estado]))}</span>
      <span class="rd-chev">${icon("chevron")}</span></button></div>`).join("")}</section>`;
  }

  // a concorrência em frases: o que usam, quem lhes faz os sites, quem paga anúncios
  function market(sc) {
    const m = sc.mercado || {}, r = sc.resumo, tot = Math.max(1, r.com_site - r.em_baixo);
    const plats = (m.plataformas || []).map(([p, n]) => `<div class="rd-bar"><span>${esc(t(p))}</span>${ui.progress(100 * n / tot)}<b>${n}</b></div>`).join("");
    const who = [...(m.redes || []).map(([h, ns]) => [h, ns]), ...(m.agencias || [])];
    return `<div class="rd-zone">
      <section class="panel pad"><h4 class="rd-h">${esc(t("Quem já faz os sites nesta zona"))}</h4>
        ${who.length ? `<ul class="rd-ags">${who.map(([a, ns]) => `<li><b>${esc(a)}</b><span>${esc(t("{n} {w}: {l}", { n: ns.length, w: ns.length === 1 ? "negócio" : "negócios", l: ns.join(", ") }))}</span></li>`).join("")}</ul>`
          : `<p class="rd-none">${esc(t("Nenhum site diz quem o fez."))}</p>`}
        <p class="rd-none">${esc(t("São estes os concorrentes diretos na venda de sites aqui."))}</p></section>
      <section class="panel pad"><h4 class="rd-h">${esc(t("Em que estão feitos os sites"))}</h4>${plats || `<p class="rd-none">${esc(t("Nenhum site abriu."))}</p>`}
        <h4 class="rd-h">${esc(t("Quem paga publicidade"))}</h4>
        <p class="rd-none">${esc(t("{n} de {t} têm sinais de anúncios no Google, Facebook ou TikTok. No total a zona gasta cerca de {a}–{b} € por mês com o digital (estimativa).", { n: r.anuncios, t: r.total, a: r.gasto_zona[0], b: r.gasto_zona[1] }))}</p></section>
    </div>`;
  }

  // o WhatsApp só existe nos telemóveis (9x); abre a conversa com a mensagem já escrita, quem envia é a pessoa
  function wa(n) {
    const d = String(n.telefone || "").split(/[;,/]|\s{2,}/).map((x) => x.replace(/\D/g, "").replace(/^(00)?351/, "")).find((x) => /^9\d{8}$/.test(x));
    return d ? `https://wa.me/351${d}?text=${encodeURIComponent(message(n))}` : "";
  }

  // a primeira mensagem: tratamento por «você», sem travessões, só o que se viu (regras do Fábio)
  function message(n) {
    const top = (n.problemas || []).slice(0, 2);
    const what = n.site ? "Estive a ver o vosso site e reparei em duas coisas que estão a afastar clientes:" : "Procurei o vosso negócio no Google e reparei numa coisa que está a afastar clientes:";
    const lines = top.map((p) => `• ${p.problema}`).join("\n");
    return `Olá, boa tarde.\n\n${what}\n${lines}\n\nTrabalhamos só com ${S.ramos[SC?.ramo] ? S.ramos[SC.ramo].toLowerCase() : "negócios locais"} e resolvemos isto em poucos dias: ${top.map((p) => p.solucao.charAt(0).toLowerCase() + p.solucao.slice(1).replace(/\.$/, "")).join(" e ")}.\n\nPosso mostrar-lhe em 15 minutos como ficaria? Sem compromisso.`;
  }

  async function pick(id) {
    cur = id; open = ""; try { localStorage.setItem(KEY, cur); } catch {}
    await loadScan();
  }

  async function click(e) {
    const w = e.target.closest("[data-wa]");
    if (w) {  // abrir a conversa conta como contactado (volta-se atrás se não foi enviada)
      const n = SC?.negocios.find((x) => x.id === w.dataset.wa);
      if (n && (!n.lead || n.lead.estado === "por_contactar")) setTimeout(() => saveLead(n.id, "contactado"), 300);
      return;
    }
    const b = e.target.closest("[data-tab],[data-row],[data-copy],[data-del],[data-retry],[data-lead],[data-seg],[data-fx]");
    if (!b) return;
    if (b.dataset.retry != null) return load().catch(() => {});
    if (b.dataset.tab) { setTab(b.dataset.tab); open = ""; return paintBody(); }
    if (b.dataset.row) {
      open = open === b.dataset.row ? "" : b.dataset.row;
      paintBody();
      if (open) loadFicha(open);
      return;
    }
    if (b.dataset.fx) { FX[b.dataset.fx] = { fase: "a começar", ficha: FX[b.dataset.fx]?.ficha }; paint($(`rd-fx-${b.dataset.fx}`), ficha(SC.negocios.find((x) => x.id === b.dataset.fx))); return loadFicha(b.dataset.fx, true); }
    if (b.dataset.del) {
      if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = t("Apagar esta pesquisa?"); return; }
      try { await api(`/api/radar/${b.dataset.del}`, { method: "DELETE" }); } catch (err) { return msg(err.message); }
      cur = null; try { localStorage.removeItem(KEY); } catch {}
      return load();
    }
    if (b.dataset.lead) return saveLead(b.dataset.lead, b.dataset.st);
    if (b.dataset.seg) {
      const [sid, nid] = b.dataset.seg.split("/");
      cur = sid; open = nid; setTab("all"); try { localStorage.setItem(KEY, cur); } catch {}
      await loadScan();
      loadFicha(nid);
      document.querySelector(".rd-row.open")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (b.dataset.copy) {
      const n = SC?.negocios.find((x) => x.id === b.dataset.copy);
      if (!n) return;
      try { await navigator.clipboard.writeText(message(n)); msg(t("Mensagem copiada: revê antes de enviar.")); } catch { msg(t("O browser não deixou copiar.")); }
    }
  }

  async function saveLead(nid, estado, nota) {
    try {
      await api(`/api/radar/${cur}/${nid}/lead`, { method: "POST", body: nota == null ? { estado } : { estado, nota } });
    } catch (err) { return msg(err.message); }
    S = await api("/api/radar"); await loadScan();
  }

  // as notas guardam-se ao sair da caixa
  document.addEventListener("focusout", (e) => {
    const el = e.target.closest?.("[data-nota]");
    if (!el || !$("rd") || el.value === (el.defaultValue || "")) return;
    const st = document.querySelector(`[data-lead="${el.dataset.nota}"].on`)?.dataset.st || "por_contactar";
    saveLead(el.dataset.nota, st, el.value);
  });
})();
