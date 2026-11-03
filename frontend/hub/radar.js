// Radar (#/radar, 03 · Negócios): encontrar clientes de qualquer ramo, em qualquer sítio. Três perguntas (o quê, onde, quantos
// km à volta); o Hub procura no mapa, no Google e na web, abre o site de cada empresa, diz se vale a pena ou não e porquê, e cada
// empresa abre uma ficha ao lado, como a do Google, com tudo para ligar, mandar email ou WhatsApp sem sair do widget
// (backend/app/radar.py). Refeito a 28 out (Marco: «a cabeça da nossa empresa... organizado e funcional, orienta-me»).
// A página segue docs/hub-paginas.md; classes rd-.
(function () {
  let S = null, SC = null, cur = null, sel = "", timer = 0;
  const FX = {}, fxTimer = {};  // a ficha completa de cada empresa aberta (marca, redes, Google, dinheiro, o que lhe vender)
  const eur = (v) => `${Math.round(v).toLocaleString("pt-PT")} €`;
  const range = (a, b) => a === b ? eur(a) : `${Math.round(a).toLocaleString("pt-PT")}–${eur(b)}`;
  const big = (v) => v >= 10000 ? `${(v / 1000).toLocaleString("pt-PT", { maximumFractionDigits: 1 })} mil` : v.toLocaleString("pt-PT");
  const REDE = { instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok", youtube: "YouTube", linkedin: "LinkedIn" };
  const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { return null; } };
  let tab = store("radar.tab2") || "vale";
  const F = { q: "", tel: false, mail: false, nosite: false, sort: store("radar.sort") || "best" };
  const KEY = "radar.cur";
  const day = (ts) => new Date(ts * 1000).toLocaleDateString("pt-PT", { day: "2-digit", month: "short" });
  const SEG_TONE = { por_contactar: "off", contactado: "wait", respondeu: "ai", reuniao: "busy", fechou: "ok", nao: "bad" };
  const VALE = { sim: ["ok", "Vale a pena"], talvez: ["wait", "Talvez"], nao: ["bad", "Não vale a pena"] };
  const FASES = ["a procurar", "a ler", "a situar", "a procurar os sites", "a abrir os sites"];
  // o que mais se procura: um toque escreve na pergunta 1 (qualquer outra coisa também serve)
  const SUGEST = ["Escolas de condução", "Ginásios", "Restaurantes", "Clínicas dentárias", "Cabeleireiros e barbearias", "Imobiliárias", "Oficinas",
    "Hotéis e alojamento", "Advogados", "Contabilistas", "Construtoras", "Lojas de roupa", "Estética e unhas", "Fisioterapia", "Cafés e pastelarias",
    "Floristas", "Veterinários", "Stands de carros", "Empresas de software", "Agências de marketing"];
  const KM = [5, 10, 20, 40, 80, 100];
  const svg = (d) => `<svg class="i" viewBox="0 0 24 24">${d}</svg>`;
  const I = {
    tel: svg('<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>'),
    mail: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>'),
    web: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'),
    pin: svg('<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>'),
    g: svg('<path d="M20 12.2c0-.6 0-1.2-.2-1.7H12v3.3h4.5a4 4 0 0 1-1.7 2.6M4.3 8.2A9 9 0 0 1 18 5.6M4.3 15.8A9 9 0 0 0 18 18.4"/>'),
    left: svg('<path d="m15 5-7 7 7 7"/>'),
    right: svg('<path d="m9 5 7 7-7 7"/>'),
  };

  // o estado do site numa palavra que qualquer pessoa percebe
  function siteState(n) {
    const a = n.audit || {};
    if (!n.site) return n.facebook ? ["bad", "Só tem Facebook"] : ["bad", "Sem site"];
    if (a.erro) return ["bad", "Site em baixo"];
    if (n.nota_site < 40) return ["bad", `Site fraco · ${n.nota_site}`];
    if (n.nota_site < 70) return ["wait", `Site razoável · ${n.nota_site}`];
    return ["ok", `Site bom · ${n.nota_site}`];
  }
  const vale = (n) => n.vale || { v: "talvez", titulo: "Talvez", porque: [], passo: "Ver a ficha", pontos: n.oportunidade || 0 };
  const emails = (n) => [...new Set([...(n.email ? [n.email] : []), ...((n.audit || {}).emails || [])])];
  const phones = (n) => [...new Set([...String(n.telefone || "").split(/[;,/]/).map((x) => x.trim()), ...((n.audit || {}).telefones || [])].filter(Boolean))];
  const town = (n) => (n.morada || "").replace(/^.*\d+[A-Za-z]?\s+/, "") || SC?.local || "";
  const gq = (n) => encodeURIComponent(`${n.nome} ${town(n)}`.trim());
  const gSearch = (n) => `https://www.google.com/search?q=${gq(n)}`;
  const gMaps = (n) => n.maps || (n.lat ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(n.nome)}%20${n.lat},${n.lon}` : `https://www.google.com/maps/search/?api=1&query=${gq(n)}`);
  const host = (u) => String(u || "").replace(/^https?:\/\/(www\.)?/, "").replace(/\/.*$/, "");
  const ext = (href, label, cls = "") => `<a class="${cls}" href="${esc(href)}" target="_blank" rel="noopener">${label}</a>`;

  HUB_VIEWS.radar = async function () {
    cur = cur || store(KEY);
    sel = "";
    focus = ""; fitted = ""; cardTab = "resumo";
    page(`<div class="rd rd-dash" id="rd">
      <div class="rd-one">
        <header class="rdh" id="rdh"></header>
        <div class="rd-msg" id="rd-msg" hidden></div>
        <div class="rd-grid">
          <section class="rdx rdm" id="rdm" aria-label="${esc(t("Mapa do Radar"))}"></section>
          <section class="rdx rdc" id="rdc" aria-label="${esc(t("Empresa escolhida"))}"></section>
          <section class="rdx rdp" id="rdp" aria-label="${esc(t("Pipeline de CRM"))}"></section>
          <section class="rdx rda" id="rda" aria-label="${esc(t("Atividade recente"))}"></section>
          <section class="rdx rdg" id="rdg" aria-label="${esc(t("Agentes ativos"))}"></section>
        </div>
        <div class="rdb" id="rdb"></div>
      </div>
      <div id="rd-body" class="rd-below"></div>
      <div class="rd-modal" id="rd-modal" hidden><section class="panel pad rd-form" id="rd-form"></section></div>
      <div class="rd-scrim" id="rd-scrim" hidden></div>
      <aside class="rd-dr" id="rd-dr" hidden aria-label="${esc(t("Ficha da empresa"))}"></aside>
    </div>`);
    mapInit();
    $("rd").onclick = click;
    $("rd").onchange = (e) => {
      if (e.target.id === "rd-pick") pick(e.target.value);
      if (e.target.id === "rd-sort") { F.sort = e.target.value; store("radar.sort", F.sort); paintList(); }
      if (e.target.id === "rd-raio") setRaio(e.target.value);
      if (e.target.id === "rdm-lockm" && M.preview) { M.preview.km = Number(e.target.value); previewFit(); }
      if (e.target.id === "rd-pipef") { pipeF = e.target.value; paintPipe(); }
    };
    $("rd").oninput = (e) => {
      if (e.target.id === "rdm-locq") return locSoon();
      if (e.target.id === "rd-q") { F.q = e.target.value; clearTimeout(F.t); F.t = setTimeout(paintList, 120); }
      if (e.target.closest?.("#rd-f")) say();
    };
    await load().catch((e) => paint($("rd-body"), ui.error(e.message)));
  };

  // ←/→ passam de empresa na ficha, Esc fecha
  document.addEventListener("keydown", (e) => {
    const dr = $("rd-dr");
    if (e.key === "Escape" && $("rd-modal") && !$("rd-modal").hidden && (!dr || dr.hidden)) return closeForm();
    if (!dr || dr.hidden || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (e.key === "Escape") closeDr();
    else if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); step(1); }
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); step(-1); }
  });

  async function load() {
    const [radar, crm, team, lim, tasks] = await Promise.all([api("/api/radar"), api("/api/crm").catch(() => null), api("/api/team").catch(() => null),
      api("/api/limits/team").catch(() => null), api("/api/tasks").catch(() => null)]);
    S = radar; D = crm; TEAM = team; LIM = lim; TASKS = tasks;
    paintForm();
    if (cur && !S.varreduras.some((v) => v.id === cur)) cur = null;
    cur = cur || S.varreduras[0]?.id || null;
    await loadScan();
  }

  async function loadScan() {
    if (!cur) { SC = null; paintAll(); paintBody(); return; }
    SC = await api(`/api/radar/${cur}`);
    paintAll(); paintBody();
    if (sel) paintDr();
    clearTimeout(timer);
    if (SC.job) timer = setTimeout(() => { if ($("rd") && !document.hidden) loadScan().catch(() => {}); else if ($("rd")) timer = setTimeout(loadScan, 3000); }, 2500);
    else if (S.varreduras.find((v) => v.id === cur)?.job) { S = await api("/api/radar"); D = await api("/api/crm").catch(() => D); paintAll(); paintBody(); }
  }

  function msg(text) {
    const el = $("rd-msg");
    if (!el) return;
    el.hidden = false; el.textContent = text;
    clearTimeout(msg.t); msg.t = setTimeout(() => { el.hidden = true; }, 5000);
  }

  // ---------- a pesquisa: três perguntas, como uma pessoa a perguntar ----------
  function paintForm() {
    if ($("rd-f")) return;
    const opts = [...new Set([...Object.values(S.ramos), ...SUGEST])].map((v) => `<option value="${esc(v)}">`).join("");
    paint($("rd-form"), `<div class="rd-form-h"><h2>${esc(t("Nova pesquisa"))}</h2><button type="button" class="btn quiet sm" data-closeq="1" title="${esc(t("Fechar (Esc)"))}">${icon("x")}</button></div>
      <form class="rd-f" id="rd-f" autocomplete="off">
      <div class="rd-q"><span class="rd-qn">1</span><div class="rd-qb"><label for="rd-termo">${esc(t("O que procuras?"))}</label>
        <input class="inp" id="rd-termo" name="termo" list="rd-tipos" placeholder="${esc(t("Qualquer tipo de empresa, ou vazio para ver todas as da zona"))}">
        <datalist id="rd-tipos">${opts}</datalist>
        <div class="rd-chips">${SUGEST.slice(0, 12).map((v) => `<button type="button" class="rd-chip" data-termo="${esc(v)}">${esc(t(v))}</button>`).join("")}</div></div></div>
      <div class="rd-q"><span class="rd-qn">2</span><div class="rd-qb"><label for="rd-local">${esc(t("Onde?"))}</label>
        <input class="inp" id="rd-local" name="local" placeholder="${esc(t("Cidade, região ou país, em qualquer sítio do mundo (ex.: Leiria, Porto, Madrid)"))}"></div></div>
      <div class="rd-q"><span class="rd-qn">3</span><div class="rd-qb"><label>${esc(t("Quantos km à volta?"))}</label>
        <div class="rd-chips">${KM.map((k) => `<button type="button" class="rd-chip ${k === 20 ? "on" : ""}" data-km="${k}">${k} km</button>`).join("")}<button type="button" class="rd-chip" data-km="0" id="rd-dist" hidden>${esc(t("Distrito inteiro"))}</button></div>
        <input type="hidden" name="raio" value="20"></div></div>
      <div class="rd-send"><p class="rd-say" id="rd-say"></p><button class="btn primary rd-go" type="submit">${icon("search")}${esc(t("Procurar tudo"))}</button></div>
      <details class="rd-lista"><summary>${esc(t("Já tens uma lista de nomes ou sites? Cola-a aqui"))}</summary>
        <label class="field"><textarea name="lista" placeholder="${esc(t("Um por linha. Ex.:\nGato Preto\nVia Dinâmica | https://…"))}"></textarea></label></details>
    </form>`);
    $("rd-f").onsubmit = submit;
    say();
  }

  const presetOf = (termo) => Object.entries(S.ramos).find(([, v]) => v.toLowerCase() === termo.trim().toLowerCase())?.[0] || "";

  // a frase de baixo diz o que vai acontecer, antes de carregar
  function say() {
    const f = $("rd-f");
    if (!f) return;
    const termo = f.termo.value.trim(), local = f.local.value.trim(), km = Number(f.raio.value);
    const escolas = presetOf(termo) === "escolas";
    $("rd-dist").hidden = !escolas;
    if (!escolas && km === 0) return setKm(20);
    f.termo.parentNode.querySelectorAll("[data-termo]").forEach((b) => b.classList.toggle("on", b.dataset.termo.toLowerCase() === termo.toLowerCase()));
    paint($("rd-say"), !termo && local ? `${esc(t("Sem tipo de empresa: vejo"))} <b>${esc(t("todas as empresas"))}</b> ${esc(t("em"))} <b>${esc(local)}</b> ${esc(t("e {k} km à volta, separadas por nicho, e digo-te quais valem a pena.", { k: Math.min(km || 5, 25) }))}`
      : !termo ? esc(t("Diz o tipo de empresa e a zona, ou só a zona para ver todas as empresas de lá. Abro o site de cada uma e digo-te quais valem a pena."))
      : `${esc(t("Vou procurar"))} <b>${esc(termo.toLowerCase())}</b> ${local ? `${esc(t("em"))} <b>${esc(local)}</b> ${esc(km ? t("e {k} km à volta", { k: km }) : t("(o distrito inteiro)"))}` : esc(t("(falta dizer onde)"))}${esc(t(", abro o site de cada uma e digo-te quais valem a pena."))}`);
  }

  function setKm(k) {
    const f = $("rd-f");
    f.raio.value = String(k);
    f.querySelectorAll("[data-km]").forEach((b) => b.classList.toggle("on", b.dataset.km === String(k)));
    say();
  }

  async function submit(e) {
    e.preventDefault();
    const f = new FormData(e.target), termo = String(f.get("termo") || "").trim(), lista = String(f.get("lista") || "").trim();
    if (!String(f.get("local") || "").trim() && !lista) { $("rd-local").focus(); return msg(t("Diz onde (pergunta 2).")); }
    const tudo = !termo && !lista;  // só a zona: todas as empresas de lá, por nicho
    try {
      const sc = await api("/api/radar", { method: "POST", body: tudo ? { ramo: "tudo", local: f.get("local"), raio: Math.min(Number(f.get("raio")) || 5, 25) }
        : { ramo: presetOf(termo), termo: termo || "Lista", local: f.get("local"), raio: Number(f.get("raio")), lista } });
      cur = sc.id; sel = ""; focus = ""; raioF = ""; M.preview = null; hideN.clear(); setTab(tudo ? "all" : "vale"); store(KEY, cur); closeForm();
      S = await api("/api/radar"); await loadScan();
    } catch (err) { msg(err.message); }
  }

  function setTab(x) { tab = x; store("radar.tab2", x); }

  // ---------- os resultados ----------
  function paintBody() {
    if (!SC) {
      paint($("rd-body"), `<div class="rd-how">${[
        ["1", "Responde às três perguntas", "O tipo de empresa (qualquer um), onde e quantos km à volta. Funciona em qualquer país."],
        ["2", "O Radar faz o trabalho", "Encontra as empresas no mapa e na web, abre o site de cada uma e vê o que está mal. Leva 1 a 5 minutos."],
        ["3", "Dizemos-te quem vale a pena", "Cada empresa vem com «vale a pena» ou «não vale» e o porquê. Clica numa para ver a ficha e ligar ou mandar email."],
      ].map(([n, h, p]) => `<div class="panel rd-step"><span>${n}</span><b>${esc(t(h))}</b><p>${esc(t(p))}</p></div>`).join("")}</div>`);
      return;
    }
    const sc = SC, r = sc.resumo || {}, negs = sc.negocios || [], job = sc.job;
    const where = !sc.local ? t("lista colada") : sc.raio ? t("{l} e {r} km à volta", { l: sc.local, r: sc.raio }) : t("distrito de {d}", { d: sc.distrito || sc.local });
    let html = `<div class="rd-top"><h2 class="rd-title">${esc(sc.ramo_nome)} <span>· ${esc(where)}</span></h2><div class="rd-tools">
      ${job ? "" : `<a class="btn sm" href="#/emails" onclick="window.__emailsSid='${esc(cur)}'">${esc(t("Enviar e-mails"))}</a><a class="btn quiet sm" href="/api/radar/${cur}/csv?token=${encodeURIComponent(token)}" target="_blank" rel="noopener">${esc(t("Excel"))}</a>
      <button type="button" class="btn quiet sm" data-del="${cur}">${esc(t("Apagar"))}</button>`}</div></div>`;
    if (job) {
      const stepN = Math.max(0, FASES.findIndex((f) => job.fase.startsWith(f)));
      const at = stepN >= 3 ? stepN - 2 : 0;
      const pct = job.total ? Math.round(100 * job.feitos / job.total) : 5;
      html += `<section class="panel pad rd-job">${["Encontrar as empresas", "Procurar o site de cada uma", "Ver o site e decidir quem vale a pena"].map((s, i) =>
        `<div class="rd-js ${i < at ? "done" : i === at ? "now" : ""}"><i>${i < at ? icon("tick") : i + 1}</i><span>${esc(t(s))}</span>${i === at && job.total ? `<small>${job.feitos} / ${job.total}</small>` : ""}</div>`).join("")}
        ${ui.progress(at === 0 ? 8 : at === 1 ? 10 + pct * 0.4 : 50 + pct * 0.5)}
        <p>${esc(t("Podes sair desta página: a pesquisa continua e fica guardada."))}</p></section>`;
      paint($("rd-body"), html);
      return;
    }
    if (sc.erro && !negs.length) { paint($("rd-body"), html + `<div class="rd-msg">${esc(sc.erro)}</div>`); return; }
    const leads = (S.seguimento || []).filter((l) => l.estado !== "por_contactar" && l.sid); // os criados à mão no CRM não têm pesquisa para abrir
    const cnt = { sim: 0, talvez: 0, nao: 0 };
    negs.forEach((n) => { cnt[vale(n).v]++; });
    const contact = negs.filter((n) => phones(n).length || emails(n).length).length;
    html += `<p class="rd-facts">${esc(t("{a} encontradas · {b} sem site · {c} em baixo · {d} com telefone ou email · {e} em contacto", { a: negs.length, b: r.sem_site || 0, c: r.em_baixo || 0, d: contact, e: leads.length }))}</p>`;
    const tabs = [["vale", "Valem a pena", cnt.sim], ["talvez", "Talvez", cnt.talvez], ["all", "Todas", negs.length], ["seg", "Em contacto", leads.length], ["zona", "Concorrência", ""]];
    html += `<div class="rd-tabs" role="tablist">${tabs.map(([k, l, n]) => `<button type="button" role="tab" class="${tab === k ? "on" : ""}" data-tab="${k}">${esc(t(l))}${n !== "" ? ` <small>${n}</small>` : ""}</button>`).join("")}</div>`;
    if (tab === "zona") html += market(sc);
    else if (tab === "seg") html += segList(leads);
    else {
      html += `<div class="rd-bar-f">
        <label class="rd-find">${icon("search")}<input class="inp" id="rd-q" value="${esc(F.q)}" placeholder="${esc(t("Procurar pelo nome ou localidade"))}"></label>
        ${[["tel", "Com telefone"], ["mail", "Com email"], ["nosite", "Sem site"]].map(([k, l]) => `<button type="button" class="rd-chip ${F[k] ? "on" : ""}" data-flt="${k}">${esc(t(l))}</button>`).join("")}
        <select class="inp rd-sort" id="rd-sort">${[["best", "Melhores primeiro"], ["site", "Pior site primeiro"], ["name", "Por nome"]].map(([k, l]) => `<option value="${k}" ${F.sort === k ? "selected" : ""}>${esc(t(l))}</option>`).join("")}</select>
      </div><div id="rd-list"></div>
      <p class="rd-note">${esc(t("Tudo vem do que o mapa, a web e o site de cada empresa mostram hoje. «Vale a pena» junta o que lhe falta no digital, sinais de que já paga por isso e se há como lhe chegar."))}</p>`;
    }
    paint($("rd-body"), html);
    if ($("rd-list")) paintList();
  }

  // a lista que se vê: o separador, a pesquisa pelo nome, os filtros e a ordem
  function shown() {
    const negs = SC?.negocios || [], q = F.q.trim().toLowerCase();
    let list = negs.filter(inScope).filter((n) => tab === "all" || (tab === "vale" ? vale(n).v === "sim" : tab === "talvez" ? vale(n).v === "talvez" : true));
    if (q) list = list.filter((n) => `${n.nome} ${n.morada || ""}`.toLowerCase().includes(q));
    if (F.tel) list = list.filter((n) => phones(n).length);
    if (F.mail) list = list.filter((n) => emails(n).length);
    if (F.nosite) list = list.filter((n) => !n.site);
    const by = { best: (a, b) => vale(b).pontos - vale(a).pontos, site: (a, b) => (a.nota_site ?? 0) - (b.nota_site ?? 0), name: (a, b) => a.nome.localeCompare(b.nome, "pt") };
    return list.slice().sort(by[F.sort] || by.best);
  }

  function paintList() {
    const box = $("rd-list");
    if (!box) return;
    const list = shown();
    paint(box, list.length ? `<section class="panel rd-list">${list.map(row).join("")}</section>`
      : `<section class="panel">${ui.empty("target", tab === "vale" && !F.q ? "Nenhuma vale mesmo a pena aqui" : "Nada com estes filtros",
        tab === "vale" && !F.q ? "Vê as do separador «Talvez» ou faz a pesquisa noutra zona ou com mais km." : "Tira um filtro ou procura outro nome.")}</section>`);
  }

  function row(n) {
    const [st, sl] = siteState(n), v = vale(n), [vt] = VALE[v.v];
    const lead = n.lead && n.lead.estado !== "por_contactar";
    const tel = phones(n)[0], mail = emails(n)[0];
    return `<div class="rd-row ${sel === n.id ? "open" : ""}" data-row="${n.id}" role="button" tabindex="0">
      <span class="rd-vale ${vt}"><i></i>${esc(t(v.titulo))}</span>
      <span class="rd-name"><b>${esc(n.nome)}</b><small>${esc([SC?.ramo === "tudo" ? n.nicho : "", n.morada, v.porque[0]].filter(Boolean).join(" · "))}</small></span>
      <span class="rd-v ${st}">${esc(t(sl))}</span>
      <span class="rd-has">${lead ? `<span class="st ${SEG_TONE[n.lead.estado]}"><i></i>${esc(t(S.estados[n.lead.estado]))}</span>`
        : `${tel ? `<a class="rd-ic" href="tel:${esc(tel.replace(/\s/g, ""))}" title="${esc(t("Ligar {n}", { n: tel }))}">${I.tel}</a>` : `<span class="rd-ic off">${I.tel}</span>`}
           ${mail ? `<a class="rd-ic" href="${esc(mailto(n, mail))}" data-mail="${n.id}" title="${esc(t("Email para {e}", { e: mail }))}">${I.mail}</a>` : `<span class="rd-ic off">${I.mail}</span>`}
           ${n.site ? `<a class="rd-ic" href="${esc((n.audit || {}).final || n.site)}" target="_blank" rel="noopener" title="${esc(host(n.site))}">${I.web}</a>` : `<span class="rd-ic off">${I.web}</span>`}`}</span>
      <span class="rd-chev">${icon("chevron")}</span>
    </div>`;
  }

  // ---------- a ficha ao lado, como a do Google: tudo de uma empresa sem sair do widget ----------
  function openDr(nid) {
    sel = nid;
    paintDr();
    document.querySelectorAll(".rd-row.open").forEach((x) => x.classList.remove("open"));
    document.querySelector(`.rd-row[data-row="${nid}"]`)?.classList.add("open");
    loadFicha(nid);
  }

  function closeDr() {
    sel = "";
    if ($("rd-dr")) { $("rd-dr").hidden = true; $("rd-scrim").hidden = true; }
    document.querySelectorAll(".rd-row.open").forEach((x) => x.classList.remove("open"));
  }

  function step(d) {
    const list = shown(), i = list.findIndex((n) => n.id === sel);
    const nx = list[i + d];
    if (nx) { openDr(nx.id); document.querySelector(`.rd-row[data-row="${nx.id}"]`)?.scrollIntoView({ block: "nearest" }); }
  }

  function paintDr() {
    const n = SC?.negocios.find((x) => x.id === sel), dr = $("rd-dr");
    if (!n || !dr) return closeDr();
    const list = shown(), i = list.findIndex((x) => x.id === n.id);
    const f = FX[n.id]?.ficha || {}, g = f.google || {}, m = f.marca || {}, a = n.audit || {};
    const v = vale(n), [vt] = VALE[v.v], tel = phones(n), mails = emails(n);
    const logo = m.logo || m.icone || (n.site ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host(n.site))}&sz=128` : "");
    const stars = g.estrelas != null ? g.estrelas : n.nota, opin = g.opinioes ?? n.opinioes;
    const scroll = dr.querySelector(".rd-dr-in")?.scrollTop || 0, same = dr.dataset.n === n.id;
    const acts = [
      tel[0] && `<a class="rd-act" href="tel:${esc(tel[0].replace(/\s/g, ""))}">${I.tel}<span>${esc(t("Ligar"))}</span></a>`,
      wa(n) && `<a class="rd-act" href="${esc(wa(n))}" target="_blank" rel="noopener" data-wa="${n.id}">${icon("chat")}<span>WhatsApp</span></a>`,
      mails[0] && `<a class="rd-act" href="${esc(mailto(n, mails[0]))}" data-mail="${n.id}">${I.mail}<span>${esc(t("Email"))}</span></a>`,
      n.site && `<a class="rd-act" href="${esc(a.final || n.site)}" target="_blank" rel="noopener">${I.web}<span>${esc(t("Site"))}</span></a>`,
      `<a class="rd-act" href="${esc(gSearch(n))}" target="_blank" rel="noopener">${I.g}<span>Google</span></a>`,
      `<a class="rd-act" href="${esc(g.mapa || gMaps(n))}" target="_blank" rel="noopener">${I.pin}<span>${esc(t("Mapa"))}</span></a>`,
    ].filter(Boolean).join("");
    const info = [
      [I.pin, n.morada || town(n) ? esc(n.morada || town(n)) : ""],
      ...tel.map((x) => [I.tel, `<a href="tel:${esc(x.replace(/\s/g, ""))}">${esc(x)}</a>`]),
      ...mails.map((e) => [I.mail, `<a href="${esc(mailto(n, e))}" data-mail="${n.id}">${esc(e)}</a>`]),
      [I.web, n.site ? `${ext(a.final || n.site, esc(host(n.site)))}${n.site_achado ? ` <em>${esc(t("· achado pelo nome, confirma"))}</em>` : ""}` : `<em class="bad">${esc(t("Não tem site"))}</em>`],
      ...Object.entries(REDE).map(([k, nome]) => { const x = (f.redes || {})[k] || (k === "facebook" && n.facebook ? { url: n.facebook } : null);
        return x ? [`<b class="rd-ab">${nome.slice(0, 2)}</b>`, `${ext(x.url, esc(nome))}${x.seguidores != null ? ` <em>· ${esc(t("{n} seguidores", { n: big(x.seguidores) }))}</em>` : ""}`] : null; }).filter(Boolean),
      g.horario?.length ? [icon("clock"), `<details><summary>${esc(g.aberto === false ? t("Fechado (Google)") : t("Horário"))}</summary>${g.horario.map(esc).join("<br>")}</details>`] : null,
    ].filter((x) => x && x[1]);
    const probs = n.problemas || [];
    dr.dataset.n = n.id;
    paint(dr, `<div class="rd-dr-bar">
        <button type="button" class="btn quiet sm" data-step="-1" ${i <= 0 ? "disabled" : ""} title="${esc(t("Anterior (←)"))}">${I.left}</button>
        <span>${i >= 0 ? esc(t("{a} de {b}", { a: i + 1, b: list.length })) : ""}</span>
        <button type="button" class="btn quiet sm" data-step="1" ${i < 0 || i >= list.length - 1 ? "disabled" : ""} title="${esc(t("Seguinte (→)"))}">${I.right}</button>
        <button type="button" class="btn quiet sm rd-x" data-close="1" title="${esc(t("Fechar (Esc)"))}">${icon("x")}</button>
      </div>
      <div class="rd-dr-in">
        <header class="rd-dr-head">
          ${logo ? `<span class="rd-logo"><img src="${esc(logo)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.hidden=true"></span>` : ""}
          <div><h3>${esc(n.nome)}</h3>
            <p>${esc([g.tipo || SC.ramo_nome, town(n)].filter(Boolean).join(" · "))}</p>
            ${stars != null ? `<p class="rd-stars"><b>${String(stars).replace(".", ",")}</b> <span>${"★".repeat(Math.round(stars))}${"☆".repeat(5 - Math.round(stars))}</span> ${opin != null ? esc(t("{n} opiniões no Google", { n: opin })) : ""}</p>` : ""}</div>
        </header>
        <div class="rd-acts">${acts}</div>
        <section class="rd-verd ${vt}">
          <div class="rd-verd-h"><b>${esc(t(v.titulo))}</b><span>${esc(t("Primeiro passo: {p}", { p: t(v.passo) }))}</span></div>
          ${v.porque.length ? `<ul>${v.porque.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
        </section>
        <dl class="rd-info">${info.map(([ic, h]) => `<dt>${ic}</dt><dd>${h}</dd>`).join("")}</dl>
        ${n.lat ? `<div class="rd-map"><iframe title="${esc(t("Mapa"))}" loading="lazy" referrerpolicy="no-referrer"
          src="https://www.openstreetmap.org/export/embed.html?bbox=${n.lon - 0.006},${n.lat - 0.0035},${n.lon + 0.006},${n.lat + 0.0035}&layer=mapnik&marker=${n.lat},${n.lon}"></iframe></div>` : ""}
        <section class="rd-blk"><h4 class="rd-h">${esc(t("Em que ponto está"))}</h4>
          <div class="rd-seg-st">${Object.entries(S.estados).map(([k, l]) => `<button type="button" class="rd-pill ${(n.lead?.estado || "por_contactar") === k ? "on " + SEG_TONE[k] : ""}" data-lead="${n.id}" data-st="${k}">${esc(t(l))}</button>`).join("")}</div>
          <textarea class="inp rd-nota" data-nota="${n.id}" placeholder="${esc(t("Notas: com quem falaste, o que disse, quando voltar a ligar"))}">${esc(n.lead?.nota || "")}</textarea>
          <div class="rd-mini">
            <button type="button" class="btn sm" data-copy="${n.id}">${esc(t("Copiar a mensagem"))}</button>
            <a class="btn sm" href="/api/radar/${cur}/${n.id}/pdf?token=${encodeURIComponent(token)}" target="_blank" rel="noopener">${icon("doc")}${esc(t("PDF para enviar"))}</a>
          </div></section>
        <section class="rd-blk"><h4 class="rd-h">${esc(t("O que está mal e o que lhe propomos"))}</h4>
          ${probs.length ? `<ol class="rd-probs">${probs.map((p) => `<li><p>${esc(p.problema)}</p><span>${icon("tick")}${esc(p.solucao)}</span></li>`).join("")}</ol>`
            : `<p class="rd-none">${esc(t("O site está bem feito: pouco a propor no site."))}</p>`}
          ${n.bons?.length ? `<p class="rd-good">${icon("tick")}${esc(t("Já está bem: {b}", { b: n.bons.join(" ").replace(/\.$/, "") }))}</p>` : ""}
          ${n.gasto?.max ? `<p class="rd-none rd-spend">${esc(t("Gasta cerca de {a}–{b} € por mês com o digital (estimativa pelo que o site mostra).", { a: n.gasto.min, b: n.gasto.max }))}</p>` : ""}
        </section>
        <div class="rd-fx" id="rd-fx-${n.id}">${ficha(n)}</div>
      </div>`);
    dr.hidden = false; $("rd-scrim").hidden = false;
    if (same) dr.querySelector(".rd-dr-in").scrollTop = scroll;
  }

  // ---------- a ficha completa: abre-se a empresa e o Hub vai ver tudo o que há dela em público ----------
  async function loadFicha(nid, force) {
    clearTimeout(fxTimer[nid]);
    const before = FX[nid]?.ficha?.fim;
    try {
      let r = await api(`/api/radar/${cur}/${nid}/ficha`, force ? { method: "POST" } : undefined);
      if (!r.ficha && !r.fase) r = await api(`/api/radar/${cur}/${nid}/ficha`, { method: "POST" });
      FX[nid] = r;
    } catch (err) { FX[nid] = { erro: err.message }; }
    if (sel !== nid) return;
    const typing = document.activeElement?.closest?.("#rd-dr textarea");
    // a ficha acabou (ou chegou já feita): o logótipo, as estrelas e as redes sobem para o topo; a meio só muda o bloco de baixo
    if (FX[nid].ficha?.fim && FX[nid].ficha.fim !== before && !typing) paintDr();
    else { const box = $(`rd-fx-${nid}`), n = SC?.negocios.find((x) => x.id === nid); if (box && n) paint(box, ficha(n)); }
    if (FX[nid].fase) fxTimer[nid] = setTimeout(() => { if (sel === nid && $(`rd-fx-${nid}`) && !document.hidden) loadFicha(nid); }, 2500);
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

  // o WhatsApp: telemóveis portugueses (9x) ou qualquer número com o indicativo do país; abre a conversa com a mensagem escrita
  function wa(n) {
    const parts = phones(n);
    const pt = parts.map((x) => x.replace(/\D/g, "").replace(/^(00)?351/, "")).find((x) => /^9\d{8}$/.test(x));
    if (pt) return `https://wa.me/351${pt}?text=${encodeURIComponent(message(n))}`;
    const intl = parts.find((x) => /^(\+|00)\d/.test(x) && !/^(\+|00)351/.test(x));
    return intl ? `https://wa.me/${intl.replace(/\D/g, "").replace(/^00/, "")}?text=${encodeURIComponent(message(n))}` : "";
  }

  // o email já escrito: assunto e texto, quem envia é a pessoa (abre o programa de email do PC)
  function mailto(n, to) {
    return `mailto:${to}?subject=${encodeURIComponent(`${n.nome}: uma ideia para ganhar mais clientes`)}&body=${encodeURIComponent(message(n))}`;
  }

  // a primeira mensagem: tratamento por «você», sem travessões, só o que se viu (regras do Fábio)
  function message(n) {
    const top = (n.problemas || []).slice(0, 2);
    if (!top.length) return `Olá, boa tarde.\n\nEstive a ver o ${n.nome} e gostei do que vi. Trabalhamos com ${String((SC?.ramo === "tudo" ? n.nicho : SC?.ramo_nome) || "negócios locais").toLowerCase()} a trazer mais clientes pelo Google, pelas redes e com IA (respostas automáticas e marcações).\n\nPosso mostrar-lhe em 15 minutos o que faríamos no seu caso? Sem compromisso.`;
    const what = n.site ? "Estive a ver o vosso site e reparei em duas coisas que estão a afastar clientes:" : "Procurei o vosso negócio no Google e reparei numa coisa que está a afastar clientes:";
    const lines = top.map((p) => `• ${p.problema}`).join("\n");
    return `Olá, boa tarde.\n\n${what}\n${lines}\n\nTrabalhamos com ${String((SC?.ramo === "tudo" ? n.nicho : SC?.ramo_nome) || "negócios locais").toLowerCase()} e resolvemos isto em poucos dias: ${top.map((p) => p.solucao.charAt(0).toLowerCase() + p.solucao.slice(1).replace(/\.$/, "")).join(" e ")}.\n\nPosso mostrar-lhe em 15 minutos como ficaria? Sem compromisso.`;
  }

  async function pick(id) {
    cur = id; closeDr(); store(KEY, cur); hideN.clear(); M.preview = null;
    await loadScan();
  }

  async function click(e) {
    const w = e.target.closest("[data-wa],[data-mail]");
    if (w) {  // abrir a conversa ou o email conta como contactado (volta-se atrás se não foi enviado)
      const n = SC?.negocios.find((x) => x.id === (w.dataset.wa || w.dataset.mail));
      if (n && (!n.lead || n.lead.estado === "por_contactar")) setTimeout(() => saveLead(n.id, "contactado"), 300);
      return;
    }
    if (await dashClick(e)) return;
    if (e.target.closest("a")) return;  // ligar, ver o site: o link faz o seu trabalho
    if (e.target.closest("#rd-scrim")) return closeDr();
    const b = e.target.closest("[data-tab],[data-row],[data-copy],[data-del],[data-retry],[data-lead],[data-seg],[data-fx],[data-termo],[data-km],[data-flt],[data-step],[data-close]");
    if (!b) return;
    if (b.dataset.termo) { $("rd-termo").value = b.dataset.termo; say(); if (!$("rd-local").value) $("rd-local").focus(); return; }
    if (b.dataset.km != null) return setKm(Number(b.dataset.km));
    if (b.dataset.flt) { F[b.dataset.flt] = !F[b.dataset.flt]; b.classList.toggle("on", F[b.dataset.flt]); return paintList(); }
    if (b.dataset.step) return step(Number(b.dataset.step));
    if (b.dataset.close) return closeDr();
    if (b.dataset.retry != null) return load().catch(() => {});
    if (b.dataset.tab) { setTab(b.dataset.tab); return paintBody(); }
    if (b.dataset.row) return sel === b.dataset.row ? closeDr() : openDr(b.dataset.row);
    if (b.dataset.fx) { FX[b.dataset.fx] = { fase: "a começar", ficha: FX[b.dataset.fx]?.ficha }; paint($(`rd-fx-${b.dataset.fx}`), ficha(SC.negocios.find((x) => x.id === b.dataset.fx))); return loadFicha(b.dataset.fx, true); }
    if (b.dataset.del) {
      if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = t("Apagar esta pesquisa?"); return; }
      try { await api(`/api/radar/${b.dataset.del}`, { method: "DELETE" }); } catch (err) { return msg(err.message); }
      cur = null; closeDr(); try { localStorage.removeItem(KEY); } catch {}
      return load();
    }
    if (b.dataset.lead) return saveLead(b.dataset.lead, b.dataset.st);
    if (b.dataset.seg) {
      const [sid, nid] = b.dataset.seg.split("/");
      cur = sid; setTab("all"); store(KEY, cur);
      await loadScan();
      return openDr(nid);
    }
    if (b.dataset.copy) {
      const n = SC?.negocios.find((x) => x.id === b.dataset.copy);
      if (!n) return;
      try { await navigator.clipboard.writeText(message(n)); msg(t("Mensagem copiada: revê antes de enviar.")); } catch { msg(t("O browser não deixou copiar.")); }
    }
  }

  // Enter numa linha da lista abre a ficha, como o clique
  document.addEventListener("keydown", (e) => {
    const r = e.key === "Enter" && e.target.closest?.(".rd-row[data-row]");
    if (r && $("rd")) openDr(r.dataset.row);
  });

  async function saveLead(nid, estado, nota) {
    try {
      await api(`/api/radar/${cur}/${nid}/lead`, { method: "POST", body: nota == null ? { estado } : { estado, nota } });
    } catch (err) { return msg(err.message); }
    S = await api("/api/radar"); D = await api("/api/crm").catch(() => D); await loadScan();
  }

  // as notas guardam-se ao sair da caixa
  document.addEventListener("focusout", (e) => {
    const el = e.target.closest?.("[data-nota]");
    if (!el || !$("rd") || el.value === (el.defaultValue || "")) return;
    const st = document.querySelector(`[data-lead="${el.dataset.nota}"].on`)?.dataset.st || SC?.negocios.find((x) => x.id === el.dataset.nota)?.lead?.estado || "por_contactar";
    saveLead(el.dataset.nota, st, el.value);
  });

  // ---------- o painel de cima (Radar Empresarial): mapa, empresa, pipeline, atividade, agentes e a barra de baixo ----------
  // Só dados reais: o que falta diz «Sem dados». A temperatura é o «nivel» do scan (quente, morna, fria); o resto do Radar não muda.
  const TEMP = { quente: ["hot", "Quente"], morna: ["warm", "Morna"], fria: ["cold", "Fria"] };
  const nivel = (n) => TEMP[n?.nivel] ? n.nivel : "morna";
  const num = (x) => { const v = parseFloat(x); return Number.isFinite(v) ? v : null; };
  const placed = (n) => num(n?.lat) != null && num(n?.lon) != null;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const relS = (ts) => {  // a mesma hora em curto, para as colunas estreitas do Pipeline
    if (!ts) return "";
    const m = Math.max(0, Date.now() / 1000 - ts) / 60;
    return m < 1.5 ? t("já") : m < 60 ? `${Math.round(m)}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
  };
  const rel = (ts) => {
    if (!ts) return "";
    const s = Math.max(0, Date.now() / 1000 - ts);
    if (s < 90) return t("agora");
    if (s < 3600) return t("há {n} min", { n: Math.round(s / 60) });
    if (s < 86400) return t("há {n}h", { n: Math.round(s / 3600) });
    const d = Math.round(s / 86400);
    return d === 1 ? t("há 1 dia") : d < 60 ? t("há {n} dias", { n: d }) : day(ts);
  };
  const money = (v) => (v == null ? "" : `€${v >= 1000 ? `${(v / 1000).toLocaleString("pt-PT", { maximumFractionDigits: 1 })}k` : Math.round(v).toLocaleString("pt-PT")}`);
  const line = (d, extra = "") => `<svg class="i" viewBox="0 0 24 24" ${extra}>${d}</svg>`;
  const IC = {
    globe: I.web,
    flame: line('<path d="M12 22c4.4 0 7-2.9 7-6.7 0-3-1.8-5-3.2-6.8-.5 1.7-1.3 2.7-2.5 3.3.3-3.4-1-6.8-4.1-9.3.2 3.3-1.2 5-2.5 6.800C5.5 10.2 5 12.5 5 15.3 5 19.1 7.6 22 12 22z"/>'),
    diamond: line('<path d="m12 3 8 9-8 9-8-9z"/>'),
    snow: line('<path d="M12 2v20M4 7l16 10M20 7 4 17M9 4l3 3 3-3M9 20l3-3 3 3"/>'),
    bldg: line('<path d="M4 21V8l8-5 8 5v13"/><path d="M9 21v-5h6v5M8.5 11h.01M12 11h.01M15.5 11h.01"/>'),
    aim: line('<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>'),
    plus: line('<path d="M12 5v14M5 12h14"/>'),
    minus: line('<path d="M5 12h14"/>'),
    full: line('<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>'),
    out: line('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
    star: line('<path d="m12 3 2.7 5.8 6.3.8-4.6 4.3 1.2 6.200L12 17l-5.6 3.1 1.2-6.200L3 9.600l6.3-.8z"/>', 'data-fill="1"'),
    clock: line('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>'),
    up: line('<path d="M12 19V5M6 11l6-6 6 6"/>'),
    down: line('<path d="M12 5v14M6 13l6 6 6-6"/>'),
    arrow: line('<path d="M5 12h14M13 6l6 6-6 6"/>'),
    chev: line('<path d="m9 5 7 7-7 7"/>'),
    tick: line('<path d="m5 12 5 5 9-10"/>'),
    task: line('<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8.5 12 2.5 2.5 4.5-5"/>'),
    bars: line('<path d="M5 20v-6M12 20V6M19 20v-10"/>'),
    feed: line('<path d="M4 6h16v10H9l-5 4z"/><path d="M8 11l2-2 2 2 3-3"/>'),
    bot: line('<rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01"/>'),
    user: line('<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4.5 4-6.5 8-6.500s7 2 8 6.5"/>'),
    inf: line('<path d="M7.5 8.500a3.5 3.5 0 1 0 0 7c3.5 0 5.5-7 9-7a3.5 3.5 0 1 1 0 7c-3.5 0-5.5-7-9-7z"/>'),
    list: line('<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>'),
    gauge: line('<circle cx="12" cy="13" r="8"/><path d="M12 13l3-3M9 2h6"/>'),
    raio: line('<circle cx="12" cy="12" r="9"/><path d="M12 12 18 6M12 12V7"/>'),
    search: line('<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>'),
    rd: `<svg viewBox="0 0 48 48" class="rdh-rad" aria-hidden="true"><circle cx="24" cy="24" r="21" fill="none" stroke="currentColor" stroke-opacity=".35"/><circle cx="24" cy="24" r="14" fill="none" stroke="currentColor" stroke-opacity=".55"/><circle cx="24" cy="24" r="7.5" fill="none" stroke="currentColor" stroke-opacity=".8"/><path d="M24 24 40 11a21 21 0 0 1 5 13z" fill="currentColor" fill-opacity=".24"/><path d="M24 24 40 11" stroke="currentColor" stroke-width="1.4"/><circle cx="24" cy="24" r="2.4" fill="currentColor"/></svg>`,
  };

  // os três departamentos da equipa, com os nomes do desenho: capacetes feitos à mão, uma cor para cada um
  function helmet(id, hi, mid, lo, glow) {
    return `<svg viewBox="0 0 64 64" class="rdg-h" aria-hidden="true"><defs>
      <linearGradient id="hs${id}" x1=".2" y1="0" x2=".8" y2="1"><stop offset="0" stop-color="${hi}"/><stop offset=".45" stop-color="${mid}"/><stop offset="1" stop-color="${lo}"/></linearGradient>
      <linearGradient id="hv${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#05070a"/><stop offset=".55" stop-color="#0c1218"/><stop offset="1" stop-color="${glow}" stop-opacity=".55"/></linearGradient>
      <radialGradient id="hg${id}"><stop offset="0" stop-color="${glow}" stop-opacity=".42"/><stop offset="1" stop-color="${glow}" stop-opacity="0"/></radialGradient></defs>
      <circle cx="32" cy="32" r="31" fill="url(#hg${id})"/>
      <path d="M9 36C8 19 20 7 36 7c12.5 0 21 9.5 21 22 0 5-.8 9.5-2.3 13.5-1.5 4.5-4.7 8.5-9.7 10.5-4.5 1.8-13 2.5-20 1.500C17 53 10 47 9 36z" fill="url(#hs${id})"/>
      <path d="M14 24C18 14 27 10 37 10c-9 2.5-15 7.5-18.5 15z" fill="#fff" fill-opacity=".42"/>
      <path d="M22 26.500c8-4 22-5.5 34.3-2.5.8 6 .1 11.5-1.6 16-10.5 2.7-22 2-30.2-2-3.5-2-5-9.5-2.5-11.500z" fill="url(#hv${id})" stroke="#000" stroke-opacity=".75"/>
      <path d="M25.5 29c7-2.8 17-3.8 26-2.5-5 .3-17 1.2-24.5 5.500z" fill="#fff" fill-opacity=".2"/>
      <path d="M21 45.500c7 3 18 3.7 28.5 1.500M24 50.500c6 1.7 14 2 21 .7" fill="none" stroke="#000" stroke-opacity=".5" stroke-width="1.4" stroke-linecap="round"/>
      <circle cx="17.5" cy="34" r="2.5" fill="#000" fill-opacity=".45"/><circle cx="17.5" cy="34" r="1.1" fill="${glow}"/></svg>`;
  }
  const AGENTS = [
    { k: "pesquisa", tag: "PES", nome: "AMG Research Agent", papel: "Investiga marca, redes, Google e dinheiro", svg: () => helmet("r", "#5aa9f2", "#123f78", "#040e1c", "#4aa8ff") },
    { k: "marketing", tag: "MKT", nome: "AMG Sales Agent", papel: "Escreve a primeira mensagem", svg: () => helmet("s", "#ffd27a", "#8a5c12", "#1c1103", "#ffb73f") },
    { k: "operacoes", tag: "OPS", nome: "AMG Follow-up Agent", papel: "Marca a próxima ação de cada lead", svg: () => helmet("f", "#f2f5f7", "#7d858d", "#16191d", "#dfe9f2") },
  ];

  const hideN = new Set();  // nichos escondidos no mapa e na lista (pesquisa «Todas as empresas»)
  let niFold = store("radar.nifold") ? store("radar.nifold") === "1" : document.documentElement.classList.contains("is-phone");
  let temp = store("radar.temp") || "all", raioF = "",focus = "", cardTab = "resumo", pipeF = "", D = null, TEAM = null, LIM = null, TASKS = null, fitted = "", lastScroll = 0;
  if (!["all", ...Object.keys(TEMP)].includes(temp)) temp = "all";
  const asked = new Set();

  function centre() {
    if (M.preview) return M.preview;  // a localidade que se está a escrever: o mapa vai logo para lá
    const g = SC?.geo;
    if (num(g?.lat) != null && num(g?.lon) != null) return { lat: num(g.lat), lon: num(g.lon) };
    const pts = (SC?.negocios || []).filter(placed);
    if (pts.length) return { lat: pts.reduce((a, n) => a + num(n.lat), 0) / pts.length, lon: pts.reduce((a, n) => a + num(n.lon), 0) / pts.length };
    return { lat: 39.6, lon: -8.1 };  // Portugal, antes da primeira pesquisa
  }
  function kmOf(n) {
    if (!placed(n)) return null;
    const c = centre(), rad = Math.PI / 180, a = num(n.lat) * rad, b = c.lat * rad;
    const h = Math.sin((a - b) / 2) ** 2 + Math.cos(a) * Math.cos(b) * Math.sin((num(n.lon) - c.lon) * rad / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(h));
  }
  const kmText = (k) => (k == null ? "" : `${k < 10 ? k.toFixed(1).replace(".", ",") : Math.round(k)} km`);
  // o filtro de cima (temperatura e raio) vale para o mapa e para a lista; quem não tem posição não sai pelo raio
  function inScope(n) {
    if (temp !== "all" && nivel(n) !== temp) return false;
    if (hideN.size && hideN.has(n.nicho || "Outros")) return false;
    if (raioF && placed(n) && kmOf(n) > Number(raioF)) return false;
    return true;
  }
  const scoped = () => (SC?.negocios || []).filter(inScope);
  const onScreen = (n) => placed(n) && Math.abs(wx(num(n.lon), M.z) - M.cx) < M.w / 2 - 30 && Math.abs(wy(num(n.lat), M.z) - M.cy) < M.h / 2 - 30;
  // a terra e pouco mais: a morada termina em «..., 2450-100 Nazaré»
  const place = (n) => {
    const last = String(n.morada || "").split(",").pop().replace(/\d{4}-\d{3}/, "").replace(/\bPortugal\b/i, "").trim();
    return last && !/\d/.test(last) ? last : SC?.local ? SC.local[0].toUpperCase() + SC.local.slice(1) : "";
  };
  const byScore = (a, b) => vale(b).pontos - vale(a).pontos;
  const leadOf = (n) => (D?.leads || []).find((l) => l.sid === cur && l.nid === n?.id);

  function paintAll() {
    if (!$("rd")) return;
    const list = scoped();
    paintHead(); pinsBuild(); paintNichos();
    if (!list.some((n) => n.id === focus)) {  // começa na melhor que se vê no mapa
      const sorted = list.slice().sort((x, y) => byScore(x, y) || (kmOf(x) ?? 1e9) - (kmOf(y) ?? 1e9)), best = sorted.find(onScreen) || sorted.find(placed) || sorted[0];
      focus = best?.id || "";
      M.pins.forEach((p) => p.el.classList.toggle("on", p.id === focus));
      tipDraw();
    }
    paintCard(); paintPipe(); paintFeed(); paintAgents(); paintStrip();
  }

  // ---------- o cabeçalho ----------
  function paintHead() {
    const negs = SC?.negocios || [], c = { quente: 0, morna: 0, fria: 0 };
    negs.forEach((n) => { c[nivel(n)]++; });
    const pills = [["all", "Todas", IC.globe, "", negs.length], ["quente", "Quentes", IC.diamond, IC.flame, c.quente], ["morna", "Mornas", IC.diamond, "", c.morna], ["fria", "Frios", IC.snow, "", c.fria]];
    const base = SC ? (SC.raio ? t("Raio: {k} km", { k: SC.raio }) : t("Raio: {l}", { l: !SC.local ? t("lista") : SC.distrito ? t("distrito") : t("zona") })) : t("Raio");
    const opts = [["", base], ...[5, 10, 25, 50, 100].filter((k) => k !== SC?.raio).map((k) => [String(k), SC?.raio && k > SC.raio ? t("Raio: {k} km · nova pesquisa", { k }) : t("Raio: {k} km", { k })])];
    const job = SC?.job;
    paint($("rdh"), `<span class="rdh-ic">${IC.rd}</span>
      <div class="rdh-t"><h1>${esc(t("Radar Empresarial"))}</h1><p>${esc(t("Descobre, analisa e converte oportunidades em negócios."))}</p></div>
      <div class="rdh-f" role="group" aria-label="${esc(t("Filtrar por temperatura"))}">${pills.map(([k, l, a, b, n]) =>
        `<button type="button" class="rdh-pill ${k} ${temp === k ? "on" : ""}" data-temp="${k}" title="${esc(t("{n} empresas", { n }))}">${a}<span>${esc(t(l))}</span>${b}</button>`).join("")}</div>
      <label class="rdh-raio" title="${esc(t("Quantos km à volta do centro da pesquisa"))}">${IC.raio}<select id="rd-raio" aria-label="${esc(t("Raio"))}">${opts.map(([v, l]) => `<option value="${v}" ${raioF === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>
      <span class="rdh-at ${job ? "busy" : ""}"><i></i>${esc(job ? t("A procurar…") : SC ? t("Atualizado: {w}", { w: rel(SC.fim || SC.at) }) : t("Sem pesquisas"))}</span>
      <button type="button" class="rdh-fs" data-fs="1" title="${esc(t("Ecrã inteiro"))}" aria-label="${esc(t("Ecrã inteiro"))}">${IC.full}</button>`);
  }

  function setRaio(v) {
    if (v && SC?.raio && Number(v) > SC.raio) {  // a pesquisa só foi até ao raio dela: para ver mais é preciso procurar outra vez
      paintHead();
      return openForm({ termo: SC.ramo_nome, local: SC.local, km: KM.find((k) => k >= Number(v)) || KM[KM.length - 1] });
    }
    raioF = v; fitted = ""; closeDr();
    paintAll(); paintList(); sweep();
  }

  function openForm(pre) {
    const m = $("rd-modal");
    if (!m) return;
    m.hidden = false;
    if (pre) {
      $("rd-termo").value = pre.termo || ""; $("rd-local").value = pre.local || "";
      if (pre.km) { if (!KM.includes(pre.km) && $("rd-f")) $("rd-f").raio.value = String(pre.km); setKm(pre.km); }
    }
    say(); $("rd-termo").focus();
  }
  function closeForm() { if ($("rd-modal")) $("rd-modal").hidden = true; }

  // ---------- o mapa: fotografia de satélite (Esri, sem chave) escurecida, anéis em km verdadeiros à volta do centro da pesquisa ----------
  const TS = 256, MINZ = 3, MAXZ = 18;
  const wx = (lon, z) => (lon + 180) / 360 * TS * 2 ** z;
  const wy = (lat, z) => { const s = Math.sin(lat * Math.PI / 180); return (.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TS * 2 ** z; };
  const tile = (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
  const M = { w: 0, h: 0, z: 8, cx: 0, cy: 0, imgs: new Map(), tiles: null, back: null, raf: 0, ringKey: "", hover: "", pins: [], ro: null, moved: false };

  function mapInit() {
    const box = $("rdm");
    M.ro?.disconnect();
    paint(box, `<div class="rdm-ts" id="rdm-ts"><div class="rdm-l"></div></div>
      <div class="rdm-tint"></div>
      <svg class="rdm-r" id="rdm-r" aria-hidden="true"><g id="rdm-rg"></g></svg>
      <div class="rdm-sw" id="rdm-sw"><i></i></div>
      <div class="rdm-pins" id="rdm-pins"></div>
      <div class="rdm-c" id="rdm-c"><i></i><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 20 20 12 16 4 20z"/></svg></div>
      <div class="rdm-tip" id="rdm-tip" hidden></div>
      <div class="rdm-top"><form class="rdm-loc" id="rdm-loc" autocomplete="off" title="${esc(t("Escreve só a localidade: o radar vê todas as empresas à volta, por nicho"))}">${IC.search}
          <input id="rdm-locq" placeholder="${esc(t("Localidade (ex.: Benedita)"))}" aria-label="${esc(t("Localidade"))}" maxlength="80">
          <select id="rdm-lockm" aria-label="${esc(t("Quantos km à volta"))}">${[2, 5, 10, 15, 25].map((k) => `<option value="${k}" ${k === 5 ? "selected" : ""}>${k} km</option>`).join("")}</select>
          <button type="submit">${IC.raio}<span>${esc(t("Radar"))}</span></button></form>
        <div class="rdm-scan" id="rdm-scan"></div></div>
      <div class="rdm-ni" id="rdm-ni" hidden></div>
      <ul class="rdm-leg"><li class="hot"><i></i>${esc(t("Quente"))}</li><li class="warm"><i></i>${esc(t("Morna"))}</li><li class="cold"><i></i>${esc(t("Fria"))}</li></ul>
      <div class="rdm-z"><div><button type="button" data-zoom="1" aria-label="${esc(t("Aproximar"))}">${IC.plus}</button><button type="button" data-zoom="-1" aria-label="${esc(t("Afastar"))}">${IC.minus}</button></div>
        <button type="button" data-recenter="1" title="${esc(t("Voltar ao centro"))}" aria-label="${esc(t("Voltar ao centro"))}">${IC.aim}</button></div>
      <div class="rdm-note" id="rdm-note"></div>
      <div class="rdm-attr">Imagens © Esri, Maxar, Earthstar Geographics</div>
      <div class="rdm-over" id="rdm-over" hidden></div>`);
    $("rdm-loc").onsubmit = locGo;
    M.preview = null;
    M.tiles = box.querySelector(".rdm-l"); M.imgs = new Map(); M.back = null; M.ringKey = ""; M.pins = []; M.moved = false;
    const rect = box.getBoundingClientRect();
    M.w = rect.width; M.h = rect.height;
    let drag = null;
    box.onpointerdown = (e) => {
      if (e.button || e.target.closest("button,select,a,.rdm-tip")) return;
      drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
      box.classList.add("drag");
      box.setPointerCapture?.(e.pointerId);
    };
    box.onpointermove = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      M.cx -= e.clientX - drag.x; M.cy -= e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY; M.moved = true;
      mapSoon();
    };
    box.onpointerup = box.onpointercancel = () => { drag = null; box.classList.remove("drag"); };
    box.ondblclick = (e) => {
      if (e.target.closest("button,select,a")) return;
      const r = box.getBoundingClientRect();
      mapZoom(1, e.clientX - r.left, e.clientY - r.top);
    };
    // a roda aproxima, mas quem vinha a descer a página continua a descer em vez de ficar preso no mapa
    let wheelAt = 0;
    box.addEventListener("wheel", (e) => {
      if (Date.now() - lastScroll < 450) return;
      e.preventDefault();
      if (Date.now() - wheelAt < 220 || !e.deltaY) return;
      wheelAt = Date.now();
      const r = box.getBoundingClientRect();
      mapZoom(e.deltaY < 0 ? 1 : -1, e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    const pinsEl = $("rdm-pins");
    pinsEl.onmouseover = (e) => { const p = e.target.closest("[data-pin]"); if (p) { M.hover = p.dataset.pin; tipDraw(); } };
    pinsEl.onmouseout = (e) => { if (e.target.closest("[data-pin]")) { M.hover = ""; tipDraw(); } };
    if (window.ResizeObserver) {
      M.ro = new ResizeObserver(() => {
        if (!$("rd")) return M.ro?.disconnect();
        const r = box.getBoundingClientRect();
        if (!r.width || (Math.abs(r.width - M.w) < 1 && Math.abs(r.height - M.h) < 1)) return;
        M.w = r.width; M.h = r.height; M.ringKey = "";
        if (M.moved) mapDraw(); else mapFit();
      });
      M.ro.observe(box);
    }
  }
  addEventListener("scroll", () => { lastScroll = Date.now(); }, { capture: true, passive: true });

  const mapSoon = () => { if (!M.raf) M.raf = requestAnimationFrame(() => { M.raf = 0; mapDraw(); }); };

  function mapDraw() {
    if (!M.tiles || !M.w || !$("rdm")) return;
    const { w, h, z } = M, n = 2 ** z, world = TS * n;
    M.cy = clamp(M.cy, 0, world);
    const left = M.cx - w / 2, top = M.cy - h / 2;
    const seen = new Set();
    for (let x = Math.floor(left / TS); x <= Math.floor((left + w) / TS); x++) {
      for (let y = Math.max(0, Math.floor(top / TS)); y <= Math.min(n - 1, Math.floor((top + h) / TS)); y++) {
        const key = `${z}/${x}/${y}`;
        seen.add(key);
        let im = M.imgs.get(key);
        if (!im) {
          im = new Image();
          im.alt = ""; im.draggable = false; im.decoding = "async"; im.referrerPolicy = "no-referrer";
          im.onload = () => im.classList.add("on");
          im.onerror = () => im.remove();
          im.src = tile(z, ((x % n) + n) % n, y);
          M.tiles.appendChild(im); M.imgs.set(key, im);
        }
        im.style.transform = `translate(${Math.round(x * TS - left)}px, ${Math.round(y * TS - top)}px)`;
      }
    }
    for (const [k, im] of M.imgs) if (!seen.has(k)) { im.remove(); M.imgs.delete(k); }
    const c = centre(), sx = Math.round(wx(c.lon, z) - left), sy = Math.round(wy(c.lat, z) - top);
    ringsDraw(c, sx, sy);
    $("rdm-c").style.transform = `translate(${sx}px, ${sy}px)`;
    $("rdm-sw").style.transform = `translate(${sx}px, ${sy}px)`;
    pinsRelax();
    noteDraw();
    for (const p of M.pins) p.el.style.transform = `translate(${Math.round(wx(p.lon, z) - left + p.dx)}px, ${Math.round(wy(p.lat, z) - top + p.dy)}px)`;
    tipDraw();
  }

  function noteDraw() {
    const el = $("rdm-note");
    if (!el) return;
    const off = M.pins.filter((p) => Math.abs(wx(p.lon, M.z) - M.cx) > M.w / 2 || Math.abs(wy(p.lat, M.z) - M.cy) > M.h / 2).length;
    const text = SC?.job ? "" : [M.none ? t("{n} sem posição no mapa", { n: M.none }) : "", off ? t("{n} fora da vista", { n: off }) : ""].filter(Boolean).join(" · ");
    if (el.textContent !== text) el.textContent = text;
  }

  // pontos colados na mesma rua afastam-se uns pixels para se poder clicar em cada um; ao aproximar voltam ao sítio exato
  function pinsRelax() {
    const key = `${M.z}|${$("rdm-pins")?.dataset.k}`;
    if (M.relaxKey === key) return;
    M.relaxKey = key;
    const c = centre(), cx = wx(c.lon, M.z), cy = wy(c.lat, M.z);
    const it = M.pins.map((p) => ({ p, x: wx(p.lon, M.z), y: wy(p.lat, M.z), x0: wx(p.lon, M.z), y0: wy(p.lat, M.z), r: p.el.classList.contains("big") ? 25 : p.el.classList.contains("bld") ? 16 : 10 }));
    for (let pass = 0; pass < 24; pass++) {
      for (let i = 0; i < it.length; i++) {
        const a = it[i];
        for (let j = i + 1; j < it.length; j++) {
          const b = it[j], dx = b.x - a.x || (i + 1) * .3, dy = b.y - a.y || (j + 1) * .3, d = Math.hypot(dx, dy), need = a.r + b.r + 3;
          if (d < need) { const k = (need - d) / d / 2; a.x -= dx * k; a.y -= dy * k; b.x += dx * k; b.y += dy * k; }
        }
        const dx = a.x - cx || .5, dy = a.y - cy || .5, d = Math.hypot(dx, dy), need = a.r + 24;  // e deixam a seta do centro à vista
        if (d < need) { a.x += dx / d * (need - d); a.y += dy / d * (need - d); }
      }
    }
    for (const a of it) { a.p.dx = a.x - a.x0; a.p.dy = a.y - a.y0; }
  }

  // anéis a distâncias redondas (2, 5, 10 km...), para o que se vê ser verdade; o raio escolhido fica mais forte
  function ringsDraw(c, sx, sy) {
    const lim = M.preview ? M.preview.km : raioF;
    const svgEl = $("rdm-r"), g = $("rdm-rg"), key = `${M.z}|${M.w}|${M.h}|${lim}|${c.lat}`;
    if (M.ringKey !== key) {
      M.ringKey = key;
      svgEl.setAttribute("width", M.w); svgEl.setAttribute("height", M.h);
      const m = 156543.03392 * Math.cos(c.lat * Math.PI / 180) / 2 ** M.z / 1000;  // km por pixel
      const step = [.05, .1, .2, .5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000].find((k) => k / m >= 30) || 2000;
      const reach = Math.hypot(M.w, M.h) * 1.3;
      let html = "";
      for (let a = 0; a < 180; a += 30) { const r = reach, x = Math.cos(a * Math.PI / 180) * r, y = Math.sin(a * Math.PI / 180) * r; html += `<line x1="${-x}" y1="${-y}" x2="${x}" y2="${y}" class="sp"/>`; }
      for (let i = 1, r = step / m; r < reach && i < 40; i++, r = i * step / m) {
        const major = i % 2 === 0;
        html += `<circle r="${r.toFixed(1)}" class="${major ? "ma" : "mi"}"/>`;
        if (major && i <= 12) html += `<text x="${(r + 4).toFixed(1)}" y="-4">${esc(kmText(i * step).replace(",0", ""))}</text>`;
      }
      for (const [i, a, b] of [[4, -38, 52], [7, 148, 226], [10, -100, -28], [14, 20, 70]]) {  // uns arcos mais vivos, como num ecrã de radar
        const r = i * step / m, p = (d) => `${(Math.cos(d * Math.PI / 180) * r).toFixed(1)} ${(Math.sin(d * Math.PI / 180) * r).toFixed(1)}`;
        html += `<path class="arc" d="M${p(a)} A${r.toFixed(1)} ${r.toFixed(1)} 0 0 1 ${p(b)}"/>`;
      }
      if (lim) html += `<circle r="${(Number(lim) / m).toFixed(1)}" class="lim"/>`;
      g.innerHTML = html;
    }
    g.setAttribute("transform", `translate(${sx} ${sy})`);
  }

  function mapFit() {
    const box = $("rdm");
    if (!box) return;
    const r = box.getBoundingClientRect();
    M.w = r.width; M.h = r.height;
    if (!M.w) return;
    const c = centre(), pts = (raioF ? scoped() : SC?.negocios || []).filter(placed);
    let z = pts.length ? 15 : SC ? 11 : 6;
    const fits = (zz) => {
      const ox = wx(c.lon, zz), oy = wy(c.lat, zz);
      if (raioF && Number(raioF) / (156543.03392 * Math.cos(c.lat * Math.PI / 180) / 2 ** zz / 1000) > Math.min(M.w, M.h) / 2 - 18) return false;
      // dois em três chegam: um ponto longe não pode encolher os outros todos (a nota diz quantos ficam fora e o «−» mostra-os)
      const out = pts.filter((p) => !(Math.abs(wx(num(p.lon), zz) - ox) < M.w / 2 - 44 && Math.abs(wy(num(p.lat), zz) - oy) < M.h / 2 - 34)).length;
      return out <= (raioF ? 0 : Math.floor(pts.length / 3));
    };
    while (z > MINZ && !fits(z)) z--;
    if (raioF) { while (z < MAXZ && fits(z + 1)) z++; }
    resetTiles(z);
    M.cx = wx(c.lon, z); M.cy = wy(c.lat, z); M.moved = false;
    mapDraw();
  }

  function resetTiles(z) {
    if (z === M.z && M.tiles) return;
    M.z = z; M.ringKey = "";
    M.imgs.forEach((im) => im.remove()); M.imgs.clear();
  }

  function mapZoom(dz, ax = M.w / 2, ay = M.h / 2) {
    const z2 = clamp(M.z + dz, MINZ, MAXZ);
    if (z2 === M.z || !M.tiles) return;
    const k = 2 ** (z2 - M.z), px = M.cx + ax - M.w / 2, py = M.cy + ay - M.h / 2;
    M.cx = px * k - (ax - M.w / 2); M.cy = py * k - (ay - M.h / 2); M.z = z2; M.moved = true;
    M.back?.remove();
    const old = M.tiles;
    old.style.transformOrigin = `${ax}px ${ay}px`;
    requestAnimationFrame(() => { old.style.transform = `scale(${k})`; });
    M.back = old;
    M.tiles = document.createElement("div"); M.tiles.className = "rdm-l";
    old.after(M.tiles);
    M.imgs = new Map();
    const pl = $("rdm-pins"); pl.classList.add("zoom"); setTimeout(() => pl.classList.remove("zoom"), 260);
    mapDraw();
    setTimeout(() => { if (M.back === old) { old.remove(); M.back = null; } }, 1100);
  }

  function mapShow(n) {
    if (!placed(n)) return;
    const x = wx(num(n.lon), M.z), y = wy(num(n.lat), M.z);
    if (Math.abs(x - M.cx) > M.w / 2 - 70 || Math.abs(y - M.cy) > M.h / 2 - 50) { M.cx = x; M.cy = y; M.moved = true; mapDraw(); }
  }

  // os pontos: os três com mais pontos são grandes e com o prédio, como no desenho; os frios com site têm um prédio pequeno
  function pinsBuild() {
    const box = $("rdm-pins");
    if (!box || !S || (!SC && cur)) return;  // sem isto pedia o mapa de Portugal inteiro antes de a pesquisa chegar
    const list = scoped().filter(placed).sort(byScore), bigs = new Set(), rad = Math.PI / 180;
    const apart = (a, b) => Math.hypot((num(a.lat) - num(b.lat)) * 111, (num(a.lon) - num(b.lon)) * 111 * Math.cos(num(a.lat) * rad));
    const chosen = [];  // as três melhores, mas não todas na mesma rua
    for (const n of list) { if (chosen.length < 3 && nivel(n) !== "fria" && chosen.every((x) => apart(x, n) > 4)) chosen.push(n); }
    chosen.forEach((n) => bigs.add(n.id));
    const c = centre();
    const delay = (n) => {
      const a = (Math.atan2(num(n.lat) - c.lat, num(n.lon) - c.lon) * 180 / Math.PI + 360 + 90) % 360;
      return (a / 360 * 2.2).toFixed(2);
    };
    const paintKey = list.map((n) => `${n.id}${bigs.has(n.id) ? "b" : ""}`).join();
    if (box.dataset.k !== paintKey) {
      box.dataset.k = paintKey;
      box.innerHTML = list.slice().reverse().map((n) => {
        const [cls, label] = TEMP[nivel(n)], big = bigs.has(n.id), bld = !big && nivel(n) === "fria" && n.site;
        return `<button type="button" class="rd-pin ${cls} ${big ? "big" : bld ? "bld" : ""}" data-pin="${n.id}" aria-label="${esc(`${n.nome}, ${t(label)}, ${kmText(kmOf(n))}`)}" style="--d:${delay(n)}s"><span class="rd-pi">${big || bld ? IC.bldg : ""}</span></button>`;
      }).join("");
    }
    M.pins = [...box.children].map((el) => { const n = list.find((x) => x.id === el.dataset.pin); return { el, id: n.id, lat: num(n.lat), lon: num(n.lon), dx: 0, dy: 0 }; });
    M.relaxKey = "";
    M.pins.forEach((p) => p.el.classList.toggle("on", p.id === focus));
    paintScanBar();
    const pinCount = list.length;
    const key = `${cur}|${raioF}|${pinCount ? 1 : 0}`;
    if (fitted !== key) { const fresh = !fitted.startsWith(`${cur}|`); fitted = key; mapFit(); if (fresh) sweep(); }
    else mapDraw();
    $("rdm").classList.toggle("spin", !!SC?.job);
  }

  function paintScanBar() {
    const job = SC?.job, none = scoped().filter((n) => !placed(n)).length;
    const scans = S?.varreduras || [];
    paint($("rdm-scan"), `${scans.length ? `<label class="rdm-pick">${IC.search}<select id="rd-pick" title="${esc(t("Pesquisas anteriores"))}">${scans.map((v) =>
      `<option value="${v.id}" ${v.id === cur ? "selected" : ""}>${esc(`${v.ramo_nome} · ${v.local || t("lista")} · ${day(v.at)}`)}</option>`).join("")}</select></label>` : ""}
      <button type="button" class="rdm-new" data-newf="1">${IC.plus}<span>${esc(t("Nova pesquisa"))}</span></button>`);
    M.none = none; noteDraw();
    const over = $("rdm-over");
    if (job) {
      const pct = job.total ? Math.round(100 * job.feitos / job.total) : 0;
      over.hidden = false; over.className = "rdm-over job";
      paint(over, `<b>${esc(t(job.fase || "A procurar…"))}</b>${job.total ? `<small>${job.feitos} / ${job.total}</small>` : ""}<span><i style="width:${job.total ? pct : 8}%"></i></span>`);
    } else if (!SC) {
      over.hidden = false; over.className = "rdm-over cta";
      paint(over, `<b>${esc(t("Ainda sem pesquisas"))}</b><p>${esc(t("Diz que empresas procuras e onde: o Radar marca-as aqui."))}</p><button type="button" class="btn primary" data-newf="1">${icon("search")}${esc(t("Fazer a primeira pesquisa"))}</button>`);
    } else if (!scoped().filter(placed).length) {
      over.hidden = false; over.className = "rdm-over cta small";
      paint(over, `<b>${esc(t(!SC.negocios?.length ? "Esta pesquisa não encontrou empresas" : scoped().length ? "Nenhuma destas tem posição no mapa" : "Nada no mapa com este filtro"))}</b>`);
    } else over.hidden = true;
  }

  function tipDraw() {
    const tip = $("rdm-tip");
    if (!tip) return;
    const id = M.hover || focus, p = M.pins.find((x) => x.id === id), n = SC?.negocios.find((x) => x.id === id);
    if (!p || !n) { tip.hidden = true; return; }
    const x = wx(p.lon, M.z) - M.cx + M.w / 2 + (p.dx || 0), y = wy(p.lat, M.z) - M.cy + M.h / 2 + (p.dy || 0);
    if (x < -20 || y < -20 || x > M.w + 20 || y > M.h + 20) { tip.hidden = true; return; }
    if (tip.dataset.id !== id) {
      tip.dataset.id = id;
      const lv = nivel(n), [cls, label] = TEMP[lv];
      paint(tip, `<b><i class="${cls}"></i>${esc(n.nome)}</b><small class="${cls}">${lv === "quente" ? IC.flame : ""}${esc(t(label))}${SC?.ramo === "tudo" && n.nicho ? ` <em>· ${esc(t(n.nicho))}</em>` : ""}${kmOf(n) != null ? ` <em>· ${esc(kmText(kmOf(n)))}</em>` : ""}</small>`);
    }
    tip.hidden = false;
    const big = p.el.classList.contains("big") ? 26 : 16, key = `${id}/${M.z}`;
    if (tip.dataset.key !== key) {
      tip.dataset.key = key;
      const w = tip.offsetWidth, h = tip.offsetHeight, others = M.pins.filter((o) => o !== p).map((o) => [wx(o.lon, M.z) - M.cx + M.w / 2 + (o.dx || 0), wy(o.lat, M.z) - M.cy + M.h / 2 + (o.dy || 0), o.el.classList.contains("big") ? 3 : 1]);
      const ce = $("rdm-c")?.style.transform.match(/-?[\d.]+/g); if (ce) others.push([+ce[0], +ce[1], 2]);
      let best = 1e9;
      [[1, -1], [-1, -1], [1, 1], [-1, 1]].forEach(([sx, sy], i) => {
        const l = sx > 0 ? x + big : x - big - w, u = sy > 0 ? y + 10 : y - 10 - h;
        const out = l < 6 || u < 50 || l + w > M.w - 6 || u + h > M.h - 6 ? 100 : 0;
        const cost = out + others.reduce((sum, [a, c, wt]) => sum + (a > l - 12 && a < l + w + 12 && c > u - 12 && c < u + h + 12 ? wt : 0), 0) + i / 10;
        if (cost < best) { best = cost; tip.dataset.side = `${sx},${sy}`; }
      });
    }
    const [sx, sy] = (tip.dataset.side || "1,-1").split(",").map(Number);
    tip.style.transform = `translate(${Math.round(x + sx * big)}px, ${Math.round(y + sy * 10)}px) translate(${sx < 0 ? "-100%" : "0"}, ${sy > 0 ? "0" : "-100%"})`;
  }

  // ---------- só a localidade (3 nov, Marco: «meto Benedita e o mapa atualiza logo, tipo um radar, com todos os nichos») ----------
  function locSoon() {
    clearTimeout(locSoon.t);
    const q = $("rdm-locq")?.value.trim() || "";
    if (q.length < 3) return;
    locSoon.t = setTimeout(async () => {
      try {
        const g = await api(`/api/radar/geo?q=${encodeURIComponent(q)}`);
        if (($("rdm-locq")?.value.trim() || "") !== q) return;  // já se escreveu outra coisa
        M.preview = { lat: g.lat, lon: g.lon, nome: g.nome, km: Number($("rdm-lockm")?.value) || 5 };
        previewFit();
      } catch { /* ainda não é um sítio: espera pela próxima letra */ }
    }, 650);
  }

  function previewFit() {
    if (!M.preview || !M.w) return;
    const p = M.preview, half = Math.min(M.w, M.h) / 2 - 26;
    let z = MAXZ;
    while (z > MINZ && p.km / (156543.03392 * Math.cos(p.lat * Math.PI / 180) / 2 ** z / 1000) > half) z--;
    resetTiles(z);
    M.cx = wx(p.lon, z); M.cy = wy(p.lat, z); M.moved = true; M.ringKey = "";
    mapDraw(); sweep();
  }

  async function locGo(e) {
    e.preventDefault();
    const local = $("rdm-locq").value.trim(), km = Number($("rdm-lockm").value) || 5;
    if (!local) { $("rdm-locq").focus(); return msg(t("Escreve a localidade (ex.: Benedita).")); }
    const b = e.target.querySelector("button");
    b.disabled = true;
    try {
      const sc = await api("/api/radar", { method: "POST", body: { ramo: "tudo", local, raio: km } });
      cur = sc.id; sel = ""; focus = ""; raioF = ""; fitted = ""; M.preview = null; hideN.clear(); setTab("all"); store(KEY, cur);
      $("rdm-locq").value = ""; closeDr();
      S = await api("/api/radar"); await loadScan();
    } catch (err) { msg(err.message); }
    b.disabled = false;
  }

  // os nichos da pesquisa «Todas as empresas»: os que valem mais a pena primeiro, cada um liga e desliga no mapa e na lista
  function paintNichos() {
    const box = $("rdm-ni");
    if (!box) return;
    const negs = SC?.negocios || [];
    if (SC?.ramo !== "tudo" || SC.job || !negs.length) { box.hidden = true; return; }
    const by = {};
    negs.forEach((n) => { const k = n.nicho || "Outros", x = by[k] = by[k] || { k, tot: 0, sim: 0, quente: 0 }; x.tot++; if (vale(n).v === "sim") x.sim++; if (nivel(n) === "quente") x.quente++; });
    const list = Object.values(by).sort((a, b) => b.sim - a.sim || b.quente - a.quente || b.tot - a.tot || a.k.localeCompare(b.k, "pt"));
    const on = list.filter((x) => !hideN.has(x.k)).length;
    box.hidden = false;
    box.classList.toggle("fold", niFold);
    paint(box, `<div class="rdm-ni-h"><button type="button" class="rdm-ni-t" data-nifold="1" aria-expanded="${!niFold}">${IC.bars}<b>${esc(t("Nichos"))}</b><small>${on}/${list.length}</small>${IC.chev}</button>
        ${niFold ? "" : `<span class="rdm-ni-all"><button type="button" data-niall="1">${esc(t("Todos"))}</button><button type="button" data-niall="0">${esc(t("Nenhum"))}</button></span>`}</div>
      ${niFold ? "" : `<div class="rdm-ni-l">${list.map((x) => `<div class="rdm-ni-r ${hideN.has(x.k) ? "off" : ""}">
        <button type="button" class="rdm-ni-b" data-ni="${esc(x.k)}" aria-pressed="${!hideN.has(x.k)}" title="${esc(t("Mostrar ou esconder {n}", { n: t(x.k) }))}"><i></i><span>${esc(t(x.k))}</span>
          ${x.sim ? `<em title="${esc(t("Valem a pena"))}">${x.sim}</em>` : ""}<b>${x.tot}</b></button>
        <button type="button" class="rdm-ni-o" data-nionly="${esc(x.k)}" title="${esc(t("Só este nicho"))}">${esc(t("só"))}</button></div>`).join("")}</div>
        <p class="rdm-ni-n">${esc(t("Verde = valem a pena"))}</p>`}`);
  }

  function nichoSet(fn) {
    fn(); closeDr(); focus = "";
    paintAll(); paintList(); sweep();
  }

  function sweep() {
    const s = $("rdm-sw"), box = $("rdm-pins"), rd = $("rdm");
    if (!s || rd.classList.contains("spin")) return;
    s.classList.remove("go"); box.classList.remove("reveal");
    void s.offsetWidth;
    s.classList.add("go"); box.classList.add("reveal");
    clearTimeout(sweep.t); sweep.t = setTimeout(() => { s.classList.remove("go"); box.classList.remove("reveal"); }, 3000);
  }

  // ---------- imagens pequenas: o sítio visto de cima (é mesmo aquele sítio), o ícone do site ou as iniciais ----------
  function satTiles(lat, lon, z, w, h) {
    const left = wx(lon, z) - w / 2, top = wy(lat, z) - h / 2, im = [], pos = [];
    for (let x = Math.floor(left / TS); x <= Math.floor((left + w) / TS); x++) for (let y = Math.floor(top / TS); y <= Math.floor((top + h) / TS); y++) {
      im.push(`url(${tile(z, x, y)})`); pos.push(`${Math.round(x * TS - left)}px ${Math.round(y * TS - top)}px`);
    }
    return `width:${w}px;height:${h}px;background-image:${im.join(",")};background-position:${pos.join(",")}`;
  }
  const initials = (s) => String(s || "?").replace(/[^\p{L}\p{N} ]/gu, "").split(/\s+/).filter((w) => w.length > 2 || /^\d/.test(w)).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || String(s || "?")[0].toUpperCase();
  function thumb(x) {
    if (placed(x)) return `<span class="rd-th"><span class="rd-th-i" style="${satTiles(num(x.lat), num(x.lon), 17, 46, 36)}"></span></span>`;
    if (x.site) return `<span class="rd-th fav"><img src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(host(x.site))}&sz=64" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()"><em>${esc(initials(x.nome))}</em></span>`;
    return `<span class="rd-th mono"><em>${esc(initials(x.nome))}</em></span>`;
  }

  // ---------- a empresa escolhida ----------
  function paintCard() {
    const box = $("rdc");
    if (!box) return;
    const n = SC?.negocios?.find((x) => x.id === focus);
    if (!n) {
      paint(box, `<div class="rdc-none">${ui.empty("target", SC?.job ? "O Radar está a trabalhar" : SC && !SC.negocios?.length ? "Sem resultados" : SC ? "Nada com este filtro" : "Escolhe uma empresa no mapa", SC?.job ? "As empresas aparecem aqui à medida que são vistas." : SC && !SC.negocios?.length ? "Experimenta outra zona ou outro tipo de empresa." : SC ? "Tira o filtro ou aumenta o raio." : "Faz uma pesquisa e clica num ponto para ver tudo sobre essa empresa.")}</div>`);
      return;
    }
    if (!asked.has(n.id)) {  // só para mostrar o logótipo se a ficha já existir; abrir a ficha é que a faz
      asked.add(n.id);
      api(`/api/radar/${cur}/${n.id}/ficha`).then((r) => { if (r?.ficha) { FX[n.id] = FX[n.id] || r; if (focus === n.id) paintCard(); } }).catch(() => {});
    }
    const lv = nivel(n), [cls, label] = TEMP[lv], v = vale(n), tel = phones(n)[0], mail = emails(n)[0], lead = leadOf(n), m = FX[n.id]?.ficha?.marca || {};
    const pts = (SC.negocios || []).map((x) => vale(x).pontos), avg = pts.reduce((a, b) => a + b, 0) / (pts.length || 1), diff = Math.round(v.pontos - avg);
    const when = lead?.at || n.lead?.at || SC.fim || SC.at, km = kmOf(n), logo = m.logo || m.icone;
    const out = (n.audit || {}).final || n.site || gMaps(n);
    const tabs = [["resumo", "Resumo"], ["hist", "Histórico"], ["opor", "Oportunidades"], ["notas", "Notas"]];
    const hist = [...(lead?.atividades || []).slice().reverse().slice(0, 4).map((a) => [a.at, a.texto, a.por]), [SC.fim || SC.at, t("Encontrada pelo Radar em {l}.", { l: SC.ramo_nome }), "Radar"]];
    const pane = cardTab === "hist" ? `<ul class="rdc-hist">${hist.map(([at, x, p]) => `<li><span>${esc(rel(at))}</span><p>${esc(x)}</p><em>${esc(p || "")}</em></li>`).join("")}</ul>`
      : cardTab === "opor" ? ((n.problemas || []).length ? `<ul class="rdc-opor">${n.problemas.slice(0, 3).map((p) => `<li><p>${esc(p.problema)}</p></li>`).join("")}</ul>` : `<p>${esc(t("O site está bem feito: pouco a propor no site."))}</p>`)
      : cardTab === "notas" ? `<textarea class="inp rdc-nota" data-nota="${n.id}" placeholder="${esc(t("Com quem falaste, o que disse, quando voltar a ligar"))}">${esc(n.lead?.nota || "")}</textarea>`
      : `<p>${esc([...v.porque.slice(0, 2)].join(". ").replace(/\.\./g, ".")) || esc(t("Sem dados"))}</p>${v.passo ? `<p class="rdc-next">${esc(t("Primeiro passo: {p}", { p: t(v.passo) }))}</p>` : ""}`;
    paint(box, `<div class="rdc-top">
        <a class="rdc-hero ${placed(n) ? "" : "mono"}" href="${esc(gMaps(n))}" target="_blank" rel="noopener" title="${esc(t("Ver no mapa"))}">
          ${placed(n) ? `<span class="rdc-sat" style="${satTiles(num(n.lat), num(n.lon), 18, 320, 200)}"></span><i class="rdc-mark"></i>` : `<em>${esc(initials(n.nome))}</em>`}
          ${logo ? `<span class="rdc-logo"><img src="${esc(logo)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.remove()"></span>` : ""}
        </a>
        <div class="rdc-id">
          <div class="rdc-name"><h2 title="${esc(n.nome)}">${esc(n.nome)}</h2><span class="rdc-tag ${cls}">${lv === "quente" ? IC.flame : ""}${esc(t(label))}</span>
            <a class="rdc-out" href="${esc(out)}" target="_blank" rel="noopener" title="${esc(n.site ? host(n.site) : t("Ver no mapa"))}">${IC.out}</a></div>
          <p class="rdc-kind">${esc((SC.ramo === "tudo" ? n.nicho : "") || SC.ramo_nome || "")}</p>
          <p class="rdc-where">${I.pin}<span>${esc(place(n) || t("Sem morada"))}${km != null ? ` <em>· ${esc(kmText(km))}</em>` : ""}</span></p>
        </div>
      </div>
      <div class="rdc-stats">
        <div><span class="rdc-ic star">${IC.star}</span><div><small>${esc(t("Potencial"))}</small><b>${v.pontos}<u>/100</u>${diff ? `<span class="rdc-delta ${diff > 0 ? "up" : "dn"}" title="${esc(t("Em relação à média desta pesquisa"))}">${diff > 0 ? IC.up : IC.down}${diff > 0 ? "+" : ""}${diff}</span>` : ""}</b></div></div>
        <div><span class="rdc-ic">${IC.clock}</span><div><small>${esc(t("Última atividade"))}</small><b class="tx">${esc(rel(when))}</b></div></div>
      </div>
      <div class="rdc-acts">
        <button type="button" class="rdc-b main" data-open="${n.id}">${IC.diamond}${esc(t("Ver Detalhes"))}</button>
        ${tel ? `<a class="rdc-b" href="tel:${esc(tel.replace(/\s/g, ""))}" title="${esc(tel)}">${I.tel}${esc(t("Ligar"))}</a>` : `<span class="rdc-b off" title="${esc(t("Sem telefone à vista"))}">${I.tel}${esc(t("Ligar"))}</span>`}
        ${mail ? `<a class="rdc-b" href="${esc(mailto(n, mail))}" data-mail="${n.id}" title="${esc(mail)}">${I.mail}${esc(t("Email"))}</a>` : `<span class="rdc-b off" title="${esc(t("Sem email à vista"))}">${I.mail}${esc(t("Email"))}</span>`}
        ${lead ? `<a class="rdc-b done" href="#/crm">${IC.tick}${esc(t("Já no CRM"))}</a>` : `<button type="button" class="rdc-b" data-addcrm="${cur}/${n.id}">${IC.plus}${esc(t("Adicionar ao CRM"))}</button>`}
      </div>
      <div class="rdc-tabs" role="tablist">${tabs.map(([k, l]) => `<button type="button" role="tab" class="${cardTab === k ? "on" : ""}" data-ctab="${k}">${esc(t(l))}</button>`).join("")}</div>
      <div class="rdc-pane">${pane}</div>
      <div class="rdc-src">${esc(t("Fonte: Radar AMG"))}${IC.raio}</div>`);
  }

  // ---------- o pipeline: as fases do CRM juntas nas quatro colunas ----------
  const COLS = [["blue", "Novos Leads", ["novo"], "Sem leads novos"], ["navy", "Em Contacto", ["contactado", "respondeu"], "Ninguém em contacto"],
    ["amber", "Negociação", ["reuniao", "proposta"], "Nada em negociação"], ["green", "Fechados", ["fechou"], "Nada fechado ainda"]];

  function paintPipe() {
    const box = $("rdp");
    if (!box) return;
    if (!D) { paint(box, `<div class="rdx-h"><span class="rdx-ic">${IC.bars}</span><div><h3>${esc(t("Pipeline de CRM"))}</h3></div></div><p class="rd-none">${esc(t("Sem dados"))}</p>`); return; }
    const leads = D.leads.filter((l) => !pipeF || l.nivel === pipeF);
    const mini = (l) => {
      const [cls, label] = TEMP[l.nivel] || [], won = l.stage === "fechou";
      return `<button type="button" class="rdp-m" data-lf="${esc(`${l.sid}/${l.nid}`)}">${thumb(l)}<span class="rdp-t"><b title="${esc(l.nome)}">${esc(l.nome)}</b><span class="rdp-2">
        ${won ? `<small class="won">${IC.tick}${esc(t("Ganho"))}${l.valor != null ? ` · ${esc(money(l.valor))}` : ""}</small>`
          : `<small class="${cls || ""}">${cls ? `<i></i>${esc(t(label))}` : ""}${l.vale ? ` · ${l.vale.pontos}%` : ""}</small><em title="${esc(rel(l.at))}">${esc(relS(l.at))}</em>`}</span></span></button>`;
    };
    const cols = COLS.map(([tone, name, stages, none], i) => {
      const inCol = leads.filter((l) => stages.includes(l.stage));
      const hints = i === 0 && !inCol.length ? (D.radar || []).filter((x) => !pipeF || x.nivel === pipeF).slice(0, 3) : [];
      const body = inCol.length ? inCol.slice(0, 3).map(mini).join("")
        : hints.length ? `<p class="rdp-hint">${esc(t("Sugestões do Radar"))}</p>${hints.map((x) => { const [c, l] = TEMP[x.nivel] || []; return `<div class="rdp-m sug"><button type="button" class="rdp-go" data-lf="${esc(`${x.sid}/${x.nid}`)}">${thumb(x)}<span class="rdp-t"><b title="${esc(x.nome)}">${esc(x.nome)}</b><span class="rdp-2"><small class="${c || ""}">${c ? `<i></i>${esc(t(l))} · ` : ""}${x.pontos}%</small></span></span></button>
            <button type="button" class="rdp-add" data-addcrm="${esc(`${x.sid}/${x.nid}`)}" title="${esc(t("Adicionar ao CRM"))}" aria-label="${esc(t("Adicionar {n} ao CRM", { n: x.nome }))}">${IC.plus}</button></div>`; }).join("")}`
        : `<p class="rdp-none">${esc(t(none))}</p>`;
      return `<div class="rdp-c ${tone}"><a class="rdp-h" href="#/crm"><b>${esc(t(name))}</b><span>${inCol.length}</span>${IC.chev}</a><div class="rdp-l">${body}</div><a class="rdp-more" href="#/crm">${esc(t("Ver todos"))}${IC.arrow}</a></div>`;
    }).join("");
    paint(box, `<div class="rdx-h"><span class="rdx-ic green">${IC.bars}</span><div><h3>${esc(t("Pipeline de CRM"))}</h3><p>${esc(t("Negócios em curso"))}</p></div>
        <label class="rdx-sel"><select id="rd-pipef" aria-label="${esc(t("Filtrar o pipeline"))}">${[["", "Todos"], ["quente", "Quentes"], ["morna", "Mornas"], ["fria", "Frias"]].map(([k, l]) => `<option value="${k}" ${pipeF === k ? "selected" : ""}>${esc(t(l))}</option>`).join("")}</select></label></div>
      <div class="rdp-cs">${cols}</div>`);
  }

  // ---------- a atividade: o que aconteceu mesmo, do Radar e do CRM ----------
  function feed() {
    const out = [];
    const negs = (SC?.negocios || []).slice().sort(byScore);
    if (SC && !SC.job && negs[0]) out.push({ at: SC.fim || SC.at, tone: "hot", ic: "<i></i>", tit: "Nova oportunidade detetada pelo Radar", sub: [negs[0].nome, kmText(kmOf(negs[0]))].filter(Boolean).join(" · "), lf: `${cur}/${negs[0].id}` });
    (S?.varreduras || []).slice(0, 4).forEach((v) => {
      if (v.job || !v.resumo?.total) return;
      out.push({ at: (v.fim || v.at) - .5, tone: "blue", ic: IC.tick, tit: "Radar concluiu a análise", sub: t("{n} empresas · {r}", { n: v.resumo.total, r: [v.ramo_nome, v.local].filter(Boolean).join(", ") }), scan: v.id });
    });
    (D?.leads || []).forEach((l) => {
      (l.atividades || []).forEach((a) => {
        const k = `${l.sid}/${l.nid}`;
        if (a.por === "PES") out.push({ at: a.at, tone: "blue", ic: IC.tick, tit: "Agente de Pesquisa concluiu análise", sub: l.nome, lf: k });
        else if (a.por === "MKT") out.push({ at: a.at, tone: "gold", ic: IC.feed, tit: "Mensagem escrita pelo Marketing", sub: l.nome, lf: k });
        else if (a.por === "OPS") out.push({ at: a.at, tone: "white", ic: IC.task, tit: "Nova tarefa atribuída", sub: `${String(a.texto || "").replace(/^Operações: próxima ação «(.*)» para.*$/, "$1")} · ${l.nome}`, lf: k });
        else out.push({ at: a.at, tone: "white", ic: IC.feed, tit: (D.tipos || {})[a.tipo] || "Atividade", sub: `${l.nome}${a.texto ? ` · ${a.texto}` : ""}`, lf: k });
      });
      if (l.stage === "fechou") out.push({ at: l.at, tone: "green", ic: IC.tick, tit: "Negócio fechado", sub: [l.nome, money(l.valor)].filter(Boolean).join(" · "), lf: `${l.sid}/${l.nid}` });
    });
    return out.sort((a, b) => b.at - a.at).slice(0, 4);
  }

  function paintFeed() {
    const box = $("rda");
    if (!box) return;
    const ev = feed();
    paint(box, `<div class="rdx-h"><span class="rdx-ic green">${IC.feed}</span><div><h3>${esc(t("Atividade Recente"))}</h3></div><a class="rdx-more" href="#/crm">${esc(t("Ver tudo"))}${IC.arrow}</a></div>
      ${ev.length ? `<ol class="rda-l">${ev.map((e) => `<li class="${e.tone}"><span class="rda-ic">${e.ic}</span><button type="button" ${e.lf ? `data-lf="${esc(e.lf)}"` : e.scan ? `data-scan="${esc(e.scan)}"` : ""}><span class="rda-tt"><b>${esc(t(e.tit))}</b><em>${esc(rel(e.at))}</em></span><small title="${esc(e.sub)}">${esc(e.sub)}</small></button></li>`).join("")}</ol>`
        : `<p class="rd-none">${esc(t("Sem atividade ainda: faz uma pesquisa."))}</p>`}`);
  }

  // ---------- os agentes: os três departamentos, com o último trabalho real de cada um ----------
  function paintAgents() {
    const box = $("rdg");
    if (!box) return;
    const last = {};
    (D?.leads || []).forEach((l) => (l.atividades || []).forEach((a) => { if (!last[a.por] || a.at > last[a.por].at) last[a.por] = { at: a.at, nome: l.nome }; }));
    paint(box, `<div class="rdx-h"><span class="rdx-ic">${IC.bot}</span><div><h3>${esc(t("Agentes Ativos"))}</h3></div><a class="rdx-more" href="#/empresa">${esc(t("Ver todos"))}${IC.arrow}</a></div>
      <div class="rdg-l">${AGENTS.map((a) => { const l = last[a.tag]; return `<button type="button" class="rdg-a" data-run="${a.k}" title="${esc(t("Pôr este agente a trabalhar na empresa escolhida"))}">${a.svg()}
        <span class="rdg-t"><span class="rdg-n"><b>${esc(a.nome)}</b><span class="rdg-on">${esc(t("Online"))}</span></span><small>${esc(l ? `${l.nome} · ${rel(l.at)}` : t(a.papel))}</small></span></button>`; }).join("")}</div>`);
  }

  // ---------- a barra de baixo ----------
  function series() {
    const days = 30, now = Math.floor(Date.now() / 86400000), raw = new Array(days).fill(0);
    const add = (ts, v = 1) => { const i = days - 1 - (now - Math.floor(ts * 1000 / 86400000)); if (ts && i >= 0 && i < days) raw[i] += v; };
    (S?.varreduras || []).forEach((v) => add(v.fim || v.at, v.resumo?.total || 0));
    (D?.leads || []).forEach((l) => (l.atividades || []).forEach((a) => add(a.at)));
    const soft = raw.map((_, i) => [-2, -1, 0, 1, 2].reduce((s, d, j) => s + (raw[i + d] || 0) * [1, 3, 5, 3, 1][j], 0) / 13);
    return { raw, soft, total: raw.reduce((a, b) => a + b, 0) };
  }
  function spark() {
    const { soft, total } = series(), W = 600, H = 44, max = Math.max(...soft), top = max || 1;
    const X = (i) => i / (soft.length - 1) * W, Y = (v) => H - 3 - v / top * (H - 10);
    const pts = soft.map((v, i) => [X(i), Y(v)]);
    let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) { const mx = (pts[i - 1][0] + pts[i][0]) / 2; d += ` C${mx.toFixed(1)} ${pts[i - 1][1].toFixed(1)} ${mx.toFixed(1)} ${pts[i][1].toFixed(1)} ${pts[i][0].toFixed(1)} ${pts[i][1].toFixed(1)}`; }
    const pk = soft.indexOf(max);
    return `<div class="rdb-sp" title="${esc(t("Empresas encontradas e atividade no CRM, últimos 30 dias: {n}", { n: total }))}"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="rdb-f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3fe6a0" stop-opacity=".26"/><stop offset="1" stop-color="#3fe6a0" stop-opacity="0"/></linearGradient></defs>
      <path d="${d} L${W} ${H} L0 ${H}Z" fill="url(#rdb-f)"/><path d="${d}" class="ln"/></svg>${total ? `<i style="left:${(pk / (soft.length - 1) * 100).toFixed(2)}%;top:${(Y(max) / H * 100).toFixed(1)}%"></i>` : ""}</div>`;
  }
  function paintStrip() {
    const box = $("rdb");
    if (!box) return;
    const on = TEAM ? TEAM.filter((m) => m.status !== "OFFLINE").length : null;
    const five = LIM && me ? LIM[me.username]?.five : null;
    const open = TASKS ? TASKS.filter((x) => !x.trashed_at && !["COMPLETED", "CANCELLED"].includes(x.status)).length : null;
    const taxa = D?.resumo?.taxa;
    const none = `<b class="no">${esc(t("Sem dados"))}</b>`;
    paint(box, `<a class="rdb-c" href="#/equipa"><span class="rdb-ic blue">${IC.user}</span><span><small>${esc(t("Equipa AMG"))}</small>${on == null ? none : `<b class="ok"><i></i>${esc(t("{n} Online", { n: on }))}</b>`}</span></a>
      <a class="rdb-c" href="#/uso" title="${esc(t("O que resta da janela de 5 horas do Claude"))}"><span class="rdb-ic">${IC.inf}</span><span><small>${esc(t("Tokens"))}</small>${five == null ? none : `<b class="${five >= 85 ? "bad" : five >= 60 ? "warn" : "ok"}">${Math.max(0, 100 - Math.round(five))}% <u>${esc(t("livres · 5 h"))}</u></b>`}</span></a>
      <a class="rdb-c" href="#/tarefas"><span class="rdb-ic">${IC.list}</span><span><small>${esc(t("Tarefas Ativas"))}</small>${open == null ? none : `<b>${open}</b>`}</span></a>
      <a class="rdb-c wide" href="#/crm" title="${esc(t("Ganhos sobre os negócios já decididos (ganhos e perdidos) no CRM"))}"><span class="rdb-ic">${IC.gauge}</span><span><small>${esc(t("Taxa de Sucesso"))}</small>${taxa == null ? none : `<b class="ok">${IC.up}${taxa}%</b>`}</span>${spark()}</a>`);
  }

  // os cliques do painel; devolve true quando o clique era dele
  async function dashClick(e) {
    const b = e.target.closest("[data-temp],[data-pin],[data-open],[data-addcrm],[data-ctab],[data-zoom],[data-recenter],[data-fs],[data-newf],[data-closeq],[data-lf],[data-scan],[data-run],[data-ni],[data-nionly],[data-niall],[data-nifold]");
    if (e.target === $("rd-modal")) { closeForm(); return true; }
    if (!b) return false;
    const d = b.dataset;
    const nichos = () => [...new Set((SC?.negocios || []).map((n) => n.nicho || "Outros"))];
    if (d.ni) nichoSet(() => { if (hideN.has(d.ni)) hideN.delete(d.ni); else hideN.add(d.ni); });
    else if (d.nionly) nichoSet(() => { hideN.clear(); nichos().forEach((k) => { if (k !== d.nionly) hideN.add(k); }); });
    else if (d.niall) nichoSet(() => { hideN.clear(); if (d.niall === "0") nichos().forEach((k) => hideN.add(k)); });
    else if (d.nifold) { niFold = !niFold; store("radar.nifold", niFold ? "1" : "0"); paintNichos(); }
    else if (d.temp) {
      temp = d.temp; store("radar.temp", temp); closeDr();
      paintAll(); paintList(); sweep();
    } else if (d.pin) {
      focus = d.pin; cardTab = "resumo"; M.hover = "";
      M.pins.forEach((p) => p.el.classList.toggle("on", p.id === focus));
      paintCard(); tipDraw();
    } else if (d.open) openDr(d.open);
    else if (d.addcrm) {
      const [sid, nid] = d.addcrm.split("/");
      b.disabled = true;
      try {
        await api("/api/crm/add", { method: "POST", body: { sid, nid } });
        D = await api("/api/crm"); S = await api("/api/radar");
        if (sid === cur) SC = await api(`/api/radar/${cur}`);
        msg(t("Adicionada ao CRM como novo lead."));
        paintAll();
      } catch (err) { b.disabled = false; msg(err.message); }
    } else if (d.ctab) { cardTab = d.ctab; paintCard(); }
    else if (d.zoom) mapZoom(Number(d.zoom));
    else if (d.recenter) mapFit();
    else if (d.fs) {
      try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch { msg(t("O browser não deixou abrir em ecrã inteiro.")); }
    } else if (d.newf) openForm();
    else if (d.closeq) closeForm();
    else if (d.lf) {
      const [sid, nid] = d.lf.split("/");
      if (!sid) { location.hash = "#/crm"; return; } // lead criado à mão no CRM: não está em nenhuma pesquisa
      if (sid && sid !== cur) { cur = sid; store(KEY, cur); raioF = ""; await loadScan(); }
      let n = SC?.negocios.find((x) => x.id === nid);
      if (n && !inScope(n)) { temp = "all"; raioF = ""; store("radar.temp", temp); paintAll(); paintList(); n = SC.negocios.find((x) => x.id === nid); }
      if (n) { focus = nid; cardTab = "resumo"; M.pins.forEach((p) => p.el.classList.toggle("on", p.id === focus)); paintCard(); mapShow(n); tipDraw(); }
    } else if (d.scan) { if (d.scan !== cur) { raioF = ""; await pick(d.scan); } }
    else if (d.run) {
      const n = SC?.negocios.find((x) => x.id === focus), lead = leadOf(n);
      if (!n) msg(t("Escolhe primeiro uma empresa no mapa."));
      else if (!lead) msg(t("Adiciona primeiro {n} ao CRM: os agentes trabalham nos leads do CRM.", { n: n.nome }));
      else {
        b.classList.add("busy");
        try {
          await api("/api/crm/agente", { method: "POST", body: { key: lead.key, agente: d.run } });
          D = await api("/api/crm"); msg(t("Feito em {n}: vê o resultado no CRM.", { n: n.nome })); paintAll();
        } catch (err) { msg(err.message); }
        b.classList.remove("busy");
      }
    }
    return true;
  }
})();
