// Radar (#/radar, 03 · Negócios): encontrar clientes de qualquer ramo, em qualquer sítio. Três perguntas (o quê, onde, quantos
// km à volta); o Hub procura no mapa, no Google e na web, abre o site de cada empresa, diz se vale a pena ou não e porquê, e cada
// empresa abre uma ficha ao lado, como a do Google, com tudo para ligar, mandar email ou WhatsApp sem sair do widget
// (backend/app/radar.py). Refeito a 28 out (Marco: «a cabeça da nossa empresa... organizado e funcional, orienta-me»).
// A página segue docs/hub-paginas.md; classes rd-.
(function () {
  let S = null, SC = null, cur = null, sel = "", timer = 0, formOpen = false;
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
    page(`<div class="rd" id="rd">
      ${ui.head("Negócios", t("Radar"), t("Encontra clientes de qualquer ramo, em qualquer sítio: diz-te quem vale a pena, porquê e como lhe chegar."),
        `<div class="rd-ctl" id="rd-ctl"></div>`)}
      <div class="rd-msg" id="rd-msg" hidden></div>
      <section class="panel pad rd-form" id="rd-form"></section>
      <div id="rd-body"></div>
      <div class="rd-scrim" id="rd-scrim" hidden></div>
      <aside class="rd-dr" id="rd-dr" hidden aria-label="${esc(t("Ficha da empresa"))}"></aside>
    </div>`);
    $("rd").onclick = click;
    $("rd").onchange = (e) => {
      if (e.target.id === "rd-pick") pick(e.target.value);
      if (e.target.id === "rd-sort") { F.sort = e.target.value; store("radar.sort", F.sort); paintList(); }
    };
    $("rd").oninput = (e) => {
      if (e.target.id === "rd-q") { F.q = e.target.value; clearTimeout(F.t); F.t = setTimeout(paintList, 120); }
      if (e.target.closest?.("#rd-f")) say();
    };
    await load().catch((e) => paint($("rd-body"), ui.error(e.message)));
  };

  // ←/→ passam de empresa na ficha, Esc fecha
  document.addEventListener("keydown", (e) => {
    const dr = $("rd-dr");
    if (!dr || dr.hidden || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (e.key === "Escape") closeDr();
    else if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); step(1); }
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); step(-1); }
  });

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
    if (sel) paintDr();
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

  // ---------- a pesquisa: três perguntas, como uma pessoa a perguntar ----------
  function paintForm() {
    if ($("rd-f")) return;
    const opts = [...new Set([...Object.values(S.ramos), ...SUGEST])].map((v) => `<option value="${esc(v)}">`).join("");
    paint($("rd-form"), `<button type="button" class="rd-new" data-newf="1">${icon("search")}<span>${esc(t("Nova pesquisa"))}</span><small>${esc(t("qualquer tipo de empresa, em qualquer sítio"))}</small></button>
      <form class="rd-f" id="rd-f" autocomplete="off">
      <div class="rd-q"><span class="rd-qn">1</span><div class="rd-qb"><label for="rd-termo">${esc(t("O que procuras?"))}</label>
        <input class="inp" id="rd-termo" name="termo" list="rd-tipos" placeholder="${esc(t("Qualquer tipo de empresa: ginásios, clínicas, restaurantes de sushi…"))}">
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
    paint($("rd-say"), !termo ? esc(t("Diz o tipo de empresa e a zona. Procuro no mapa, no Google e na web, abro o site de cada uma e digo-te quais valem a pena."))
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
    if (!termo && !lista) { $("rd-termo").focus(); return msg(t("Diz primeiro o que procuras (pergunta 1).")); }
    if (!String(f.get("local") || "").trim() && !lista) { $("rd-local").focus(); return msg(t("Diz onde (pergunta 2).")); }
    try {
      const sc = await api("/api/radar", { method: "POST", body: { ramo: presetOf(termo), termo: termo || "Lista", local: f.get("local"), raio: Number(f.get("raio")), lista } });
      cur = sc.id; sel = ""; formOpen = false; setTab("vale"); store(KEY, cur);
      S = await api("/api/radar"); await loadScan();
      $("rd-body")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) { msg(err.message); }
  }

  function setTab(x) { tab = x; store("radar.tab2", x); }

  // ---------- os resultados ----------
  function paintBody() {
    $("rd-form")?.classList.toggle("min", !!SC && !formOpen);  // com resultados, as perguntas encolhem num botão
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
    const others = S.varreduras.length > 1 ? `<select class="inp rd-pick" id="rd-pick" title="${esc(t("Pesquisas anteriores"))}">${S.varreduras.map((v) =>
      `<option value="${v.id}" ${v.id === cur ? "selected" : ""}>${esc(`${v.ramo_nome} · ${v.local || t("lista")} · ${day(v.at)}`)}</option>`).join("")}</select>` : "";
    let html = `<div class="rd-top"><h2 class="rd-title">${esc(sc.ramo_nome)} <span>· ${esc(where)}</span></h2><div class="rd-tools">${others}
      ${job ? "" : `<a class="btn quiet sm" href="/api/radar/${cur}/csv?token=${encodeURIComponent(token)}" target="_blank" rel="noopener">${esc(t("Excel"))}</a>
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
    const leads = (S.seguimento || []).filter((l) => l.estado !== "por_contactar");
    const cnt = { sim: 0, talvez: 0, nao: 0 };
    negs.forEach((n) => { cnt[vale(n).v]++; });
    const contact = negs.filter((n) => phones(n).length || emails(n).length).length;
    const pctOf = (k) => (negs.length ? (k / negs.length) * 100 : null);
    html += `<div class="rd-sum">${ui.kpis([
      ui.kpi({ label: "Valem a pena", value: cnt.sim, sub: t("{t} talvez · {n} não", { t: cnt.talvez, n: cnt.nao }),
        viz: negs.length ? ui.cols([cnt.nao, cnt.talvez, cnt.sim], { fat: true }) : "", cls: cnt.sim ? "rd-hot" : "" }),
      ui.kpi({ label: "Encontradas", value: negs.length, sub: t("{n} sem site · {b} em baixo", { n: r.sem_site || 0, b: r.em_baixo || 0 }), viz: ui.ring(pctOf(r.sem_site || 0)) }),
      ui.kpi({ label: "Com contacto", value: contact, sub: t("telefone ou email à vista"), viz: ui.ring(pctOf(contact)) }),
      ui.kpi({ label: "Em contacto", value: leads.length, sub: leads.length ? t("{n} responderam", { n: leads.filter((l) => /respondeu|reuniao|fechou/.test(l.estado)).length }) : t("ainda ninguém contactado") }),
    ])}</div>`;
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
    let list = negs.filter((n) => tab === "all" || (tab === "vale" ? vale(n).v === "sim" : tab === "talvez" ? vale(n).v === "talvez" : true));
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
      <span class="rd-name"><b>${esc(n.nome)}</b><small>${esc([n.morada, v.porque[0]].filter(Boolean).join(" · "))}</small></span>
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
    if (!top.length) return `Olá, boa tarde.\n\nEstive a ver o ${n.nome} e gostei do que vi. Trabalhamos com ${String(SC?.ramo_nome || "negócios locais").toLowerCase()} a trazer mais clientes pelo Google, pelas redes e com IA (respostas automáticas e marcações).\n\nPosso mostrar-lhe em 15 minutos o que faríamos no seu caso? Sem compromisso.`;
    const what = n.site ? "Estive a ver o vosso site e reparei em duas coisas que estão a afastar clientes:" : "Procurei o vosso negócio no Google e reparei numa coisa que está a afastar clientes:";
    const lines = top.map((p) => `• ${p.problema}`).join("\n");
    return `Olá, boa tarde.\n\n${what}\n${lines}\n\nTrabalhamos com ${String(SC?.ramo_nome || "negócios locais").toLowerCase()} e resolvemos isto em poucos dias: ${top.map((p) => p.solucao.charAt(0).toLowerCase() + p.solucao.slice(1).replace(/\.$/, "")).join(" e ")}.\n\nPosso mostrar-lhe em 15 minutos como ficaria? Sem compromisso.`;
  }

  async function pick(id) {
    cur = id; closeDr(); store(KEY, cur);
    await loadScan();
  }

  async function click(e) {
    const w = e.target.closest("[data-wa],[data-mail]");
    if (w) {  // abrir a conversa ou o email conta como contactado (volta-se atrás se não foi enviado)
      const n = SC?.negocios.find((x) => x.id === (w.dataset.wa || w.dataset.mail));
      if (n && (!n.lead || n.lead.estado === "por_contactar")) setTimeout(() => saveLead(n.id, "contactado"), 300);
      return;
    }
    if (e.target.closest("a")) return;  // ligar, ver o site: o link faz o seu trabalho
    if (e.target.closest("#rd-scrim")) return closeDr();
    const b = e.target.closest("[data-tab],[data-row],[data-copy],[data-del],[data-retry],[data-lead],[data-seg],[data-fx],[data-termo],[data-km],[data-flt],[data-step],[data-close]");
    if (!b) return;
    if (b.dataset.termo) { $("rd-termo").value = b.dataset.termo; say(); if (!$("rd-local").value) $("rd-local").focus(); return; }
    if (b.dataset.km != null) return setKm(Number(b.dataset.km));
    if (b.dataset.newf) { formOpen = true; $("rd-form").classList.remove("min"); return $("rd-termo").focus(); }
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
