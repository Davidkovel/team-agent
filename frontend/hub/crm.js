// CRM (#/crm, 03 · Negócios, separador do Radar): o Radar encontra a empresa, o CRM leva-a até ao negócio. Os mesmos dados do
// seguimento do Radar (backend/app/crm.py): o que se marca num aparece no outro. Refeito a 2 nov 2026 («melhora completamente o
// CRM»), com a disciplina do Pipedrive: cada negócio aberto tem próxima ação, um negócio sem atividade fica «parado», e a previsão
// é valor × probabilidade da fase (estimativa, dita como tal). Quatro vistas sobre a mesma pesquisa e os mesmos filtros:
// Quadro (arrastar muda a fase; zoom em − + ou ⌘ + roda, guardado por pessoa), Lista (ordenável), Agenda (o que fazer hoje) e Funil
// (o que aconteceu mesmo). A ficha ao lado: Negócio, Reunião (link Zoom, calendário, convite), Atividade e os três departamentos
// (Pesquisa investiga, Marketing escreve e fica por aprovar, Operações marca a próxima ação). Segue docs/hub-paginas.md; classes cm-.
(function () {
  let D = null, sel = "", timer = 0, drag = "", raw = "", tab = "negocio", modal = null, wheel = 0;
  let view = "quadro", q = "", fT = "", fE = "", fR = "", zoomI = 2, sortK = "ult", sortD = -1;
  const VIEWS = [["quadro", "Quadro"], ["lista", "Lista"], ["agenda", "Agenda"], ["funil", "Funil"]];
  const ZOOMS = [70, 85, 100, 115, 130];
  const pref = {
    get(k, d) { try { return localStorage.getItem(`crm.${k}`) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(`crm.${k}`, v); } catch {} },
  };
  const eur = (v) => `${Math.round(v).toLocaleString("pt-PT")} €`;
  const now = () => Date.now() / 1000;
  const day = (ts) => new Date(ts * 1000).toLocaleDateString("pt-PT", { day: "2-digit", month: "short" });
  const hm = (ts) => new Date(ts * 1000).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });
  const dayDiff = (ts) => Math.round((new Date(new Date(ts * 1000).toDateString()) - new Date(new Date().toDateString())) / 864e5);
  const when = (ts) => {
    const dd = dayDiff(ts), h = hm(ts);
    return dd === 0 ? t("Hoje, {h}", { h }) : dd === 1 ? t("Amanhã, {h}", { h }) : dd === -1 ? t("Ontem") : day(ts);
  };
  const town = (x) => (x.morada || "").replace(/^.*\d+[A-Za-z]?\s+/, "").split(",").pop().trim() || (x.local || "").split(",").pop().trim();
  const ago = (ts) => { const s = now() - ts; return s < 90 ? t("agora") : s < 3600 ? `${Math.round(s / 60)} min` : s < 86400 ? `${Math.round(s / 3600)} h` : day(ts); };
  const dias = (n) => (n === 1 ? t("1 dia") : t("{n} dias", { n }));
  const conta = (n, um, muitos) => (n === 1 ? t(um) : t(muitos, { n }));
  const isLate = (p) => p && p.quando < now() - 3600;
  const isOpen = (l) => l.stage !== "fechou" && l.stage !== "nao";
  const isZoom = (u) => /zoom\.(us|com)/i.test(u || "");
  const VALE = { sim: ["ok", "Quente"], talvez: ["wait", "Morno"], nao: ["off", "Frio"] };
  // nada de «busy» aqui: pulsa sem parar e custa 19% de um núcleo, e uma fase é um estado, não um trabalho a correr
  const TONE = { novo: "off", contactado: "ai", respondeu: "ai", reuniao: "ai", proposta: "ai", fechou: "ok", nao: "bad" };
  const MONO = { PES: "PES", MKT: "MKT", OPS: "OPS" };
  const svg = (d) => `<svg class="i" viewBox="0 0 24 24">${d}</svg>`;
  const I = {
    tel: svg('<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>'),
    mail: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>'),
    wa: svg('<path d="M4 20l1.3-3.9A8 8 0 1 1 8 19z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.5-2-1-1 .8a4 4 0 0 1-2-2l.8-1-1-2z"/>'),
    web: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'),
    x: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
    cam: svg('<rect x="3" y="6" width="13" height="12" rx="2.5"/><path d="m16 10.5 5-3v9l-5-3"/>'),
    ok: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
    clock: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
    warn: svg('<path d="M12 4 2.8 20h18.4z"/><path d="M12 10v4.5M12 17.4v.1"/>'),
    search: svg('<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>'),
    minus: svg('<path d="M6 12h12"/>'),
    plus: svg('<path d="M6 12h12M12 6v12"/>'),
    cal: svg('<rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M4 10h16M8.5 3v4M15.5 3v4"/>'),
  };

  HUB_VIEWS.crm = async function () {
    sel = ""; raw = ""; tab = "negocio"; q = ""; fT = ""; fE = ""; fR = "";
    view = pref.get("view", "quadro"); if (!VIEWS.some(([k]) => k === view)) view = "quadro";
    zoomI = Math.max(0, Math.min(ZOOMS.length - 1, Number(pref.get("zoom", 2)) || 0));
    const [sk, sd] = pref.get("sort", "ult:-1").split(":"); sortK = sk; sortD = Number(sd) || -1;
    page(`<div class="cm" id="cm">
      ${ui.head("Negócios", t("CRM"), t("Da oportunidade ao negócio: o Radar encontra, os departamentos preparam, vocês fecham."),
        `<a class="btn" href="#/radar">${esc(t("Abrir o Radar"))}</a><button type="button" class="btn primary" data-new>${esc(t("Novo lead"))}</button>`)}
      <div id="cm-kpis">${ui.skeleton(4)}</div>
      <div class="cm-bar" id="cm-bar" hidden>
        <div class="cm-bar-r"><div class="segx cm-views">${VIEWS.map(([k, l], i) => `<button type="button" data-view="${k}" title="${esc(t(l))} (${i + 1})">${esc(t(l))}</button>`).join("")}</div>
          <span class="cm-grow"></span>
          <button type="button" class="btn quiet sm" id="cm-fromradar" data-goradar hidden></button>
          <a class="btn quiet sm" id="cm-csv" target="_blank" rel="noopener" title="${esc(t("Abre no Excel"))}">${esc(t("Exportar"))}</a>
        <div class="cm-zoom" id="cm-zoom" role="group" aria-label="${esc(t("Zoom do quadro"))}">
          <button type="button" data-z="-1" aria-label="${esc(t("Afastar"))}" title="${esc(t("Afastar"))} (−)">${I.minus}</button>
          <button type="button" data-z="0" id="cm-zv" title="${esc(t("Repor o tamanho"))}">100%</button>
          <button type="button" data-z="1" aria-label="${esc(t("Aproximar"))}" title="${esc(t("Aproximar"))} (+)">${I.plus}</button>
        </div>
        </div>
        <div class="cm-bar-r"><label class="cm-search">${I.search}<input id="cm-q" type="search" placeholder="${esc(t("Pesquisar empresa, pessoa, telefone"))}" aria-label="${esc(t("Pesquisar"))}"></label>
        <select id="cm-ft" aria-label="${esc(t("Temperatura"))}"><option value="">${esc(t("Temperatura"))}</option><option value="sim">${esc(t("Quente"))}</option><option value="talvez">${esc(t("Morno"))}</option><option value="nao">${esc(t("Frio"))}</option></select>
        <select id="cm-fe" aria-label="${esc(t("Estado"))}"><option value="">${esc(t("Estado"))}</option><option value="late">${esc(t("Atrasados"))}</option><option value="hoje">${esc(t("Para hoje"))}</option><option value="parado">${esc(t("Parados"))}</option><option value="sem">${esc(t("Sem próxima ação"))}</option></select>
        <select id="cm-fr" aria-label="${esc(t("Ramo"))}"></select>
          <button type="button" class="btn quiet sm" id="cm-clear" data-clear hidden>${esc(t("Limpar"))}</button>
        </div>
      </div>
      <div id="cm-view"></div>
      <div id="cm-extra"></div>
      <div class="cm-scrim" id="cm-scrim" hidden></div>
      <aside class="cm-dr" id="cm-dr" hidden aria-label="${esc(t("Ficha do lead"))}"></aside>
      <div class="cm-modal" id="cm-modal" hidden></div>
      <div class="cm-toast" id="cm-toast" role="status" hidden></div>
    </div>`);
    const root = $("cm");
    root.onclick = click;
    root.ondragstart = (e) => { const c = e.target.closest?.("[data-card]"); if (c) { drag = c.dataset.card; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", c.querySelector("b")?.textContent || ""); c.classList.add("drag"); root.classList.add("dragging"); } };
    root.ondragend = () => { drag = ""; root.classList.remove("dragging"); root.querySelectorAll(".drag,.over").forEach((x) => x.classList.remove("drag", "over")); };
    root.ondragover = (e) => {
      const col = e.target.closest?.("[data-col]"); if (!drag) return;
      const b = root.querySelector(".cm-board");
      if (b) { const r = b.getBoundingClientRect(); if (e.clientX < r.left + 50) b.scrollLeft -= 14; else if (e.clientX > r.right - 50) b.scrollLeft += 14; }
      if (col) { e.preventDefault(); root.querySelectorAll(".over").forEach((x) => x !== col && x.classList.remove("over")); col.classList.add("over"); }
    };
    root.ondrop = (e) => { const col = e.target.closest?.("[data-col]"); if (col && drag) { e.preventDefault(); const k = drag; drag = ""; root.classList.remove("dragging"); move(k, col.dataset.col); } };
    root.onchange = (e) => {
      const el = e.target, f = el.dataset.f;
      if (el.id === "cm-ft") { fT = el.value; return paintView(); }
      if (el.id === "cm-fe") { fE = el.value; return paintView(); }
      if (el.id === "cm-fr") { fR = el.value; return paintView(); }
      if (!f) return;
      if (f === "valor") save({ valor: el.value === "" ? null : Number(el.value) });
      else if (f === "fecho") save({ fecho: el.value ? new Date(`${el.value}T12:00`).getTime() / 1000 : null });
      else if (f.startsWith("c.")) save({ contacto: { [f.slice(2)]: el.value } });
      else save({ [f]: el.value });
    };
    root.oninput = (e) => { if (e.target.id === "cm-q") { q = e.target.value; paintView(); } };
    // ⌘ + roda (ou o gesto de pinça do trackpad) aproxima o quadro, como num mapa
    root.addEventListener("wheel", (e) => {
      if (!(e.ctrlKey || e.metaKey) || !e.target.closest?.(".cm-board")) return;
      e.preventDefault(); wheel += e.deltaY;
      if (Math.abs(wheel) > 40) { setZoom(zoomI + (wheel < 0 ? 1 : -1)); wheel = 0; }
    }, { passive: false });
    await load().catch((e) => paint($("cm-kpis"), ui.error(e.message)));
    clearInterval(timer);
    timer = setInterval(() => { if (!$("cm")) return clearInterval(timer); if (!document.hidden && !drag) load(true).catch(() => {}); }, 30000);
  };

  document.addEventListener("keydown", (e) => {
    if (!$("cm")) return;
    if (e.key === "Escape") {
      if (modal) return closeModal();
      if (!$("cm-dr").hidden && !/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return closeDr();
      return;
    }
    if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.metaKey || e.ctrlKey || e.altKey || modal) return;
    if (e.key === "/") { e.preventDefault(); $("cm-q")?.focus(); }
    else if (e.key === "n" || e.key === "N") { e.preventDefault(); newLead(); }
    else if (/^[1-4]$/.test(e.key) && $("cm-dr").hidden) setView(VIEWS[Number(e.key) - 1][0]);
    else if ((e.key === "+" || e.key === "=") && view === "quadro") setZoom(zoomI + 1);
    else if (e.key === "-" && view === "quadro") setZoom(zoomI - 1);
  });

  async function load(quiet) {
    const d = await api("/api/crm"), s = JSON.stringify(d);
    if (quiet && s === raw) return;   // nada mudou: não mexe na página (o scroll e o que se está a ver ficam)
    raw = s; D = d;
    paintAll();
    if (sel) { if (lead(sel)) { if (!quiet) paintDr(); } else closeDr(); }
  }
  const lead = (k) => (D?.leads || []).find((l) => l.key === k);

  /* ---------- a página ---------- */
  function vis() {
    const n = q.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    return D.leads.filter((l) => {
      if (fT && l.vale?.v !== fT) return false;
      if (fR && (l.ramo_nome || "") !== fR) return false;
      if (fE) {
        const p = l.proxima;
        if (!isOpen(l)) return false;
        if (fE === "late" && !isLate(p)) return false;
        if (fE === "hoje" && !(p && !isLate(p) && dayDiff(p.quando) === 0)) return false;
        if (fE === "parado" && !l.parado) return false;
        if (fE === "sem" && p) return false;
      }
      if (!n) return true;
      const hay = [l.nome, l.ramo_nome, l.local, l.morada, l.contacto?.nome, l.nota, ...(l.telefones || []), ...(l.emails || [])].join(" ").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
      return hay.includes(n) || (/\d/.test(n) && hay.replace(/\s/g, "").includes(n.replace(/\s/g, "")));
    });
  }

  function paintAll() {
    paintKpis();
    const bar = $("cm-bar");
    bar.hidden = !D.leads.length;
    $("cm-csv").href = `/api/crm/folha.csv?token=${encodeURIComponent(token)}`;
    const ramos = [...new Set(D.leads.map((l) => l.ramo_nome).filter(Boolean))].sort();
    if (fR && !ramos.includes(fR)) fR = "";
    paint($("cm-fr"), `<option value="">${esc(t("Ramo"))}</option>${ramos.map((r) => `<option${r === fR ? " selected" : ""}>${esc(r)}</option>`).join("")}`);
    paintView();
    paintExtra();
  }

  function paintKpis() {
    const r = D.resumo, L = D.leads, abertos = L.filter(isOpen);
    const porFazer = r.atrasados + r.hoje + r.sem_proxima;
    const partes = [r.atrasados && conta(r.atrasados, "1 atrasada", "{n} atrasadas"), r.hoje && t("{n} para hoje", { n: r.hoje }), r.sem_proxima && t("{n} sem ação", { n: r.sem_proxima })].filter(Boolean);
    paint($("cm-kpis"), ui.kpis([
      ui.kpi({ label: "Negócios em aberto", value: fmt.int(r.abertos), sub: r.parados ? conta(r.parados, "1 parado, sem atividade", "{n} parados, sem atividade") : r.reunioes ? conta(r.reunioes, "1 reunião marcada", "{n} reuniões marcadas") : L.length ? t("{n} no quadro, com os fechados", { n: L.length }) : t("cria o primeiro ou traz do Radar"),
        viz: ui.cols(D.stages.slice(0, 5).map(([k]) => abertos.filter((l) => l.stage === k).length)) }),
      ui.kpi({ label: "Previsão", value: r.previsao == null ? null : eur(r.previsao), hint: t("Valor de cada negócio × a probabilidade estimada da fase em que está."),
        sub: r.previsao == null ? t("põe o valor de cada negócio na ficha") : r.com_valor < r.abertos ? t("de {v} · {n} sem valor", { v: eur(r.valor_aberto), n: r.abertos - r.com_valor }) : t("de {v} em aberto", { v: eur(r.valor_aberto) }) }),
      ui.kpi({ label: "Por fazer", cls: r.atrasados ? "warn" : "", value: fmt.int(porFazer), sub: partes.join(" · ") || t("está tudo em dia") }),
      ui.kpi({ label: "Ganhos", value: fmt.int(r.ganhos), viz: r.taxa == null ? "" : ui.ring(r.taxa),
        sub: r.taxa == null ? t("ainda nenhum fechado") : r.valor_ganho == null ? t("sem valor registado") : t("{v} fechados", { v: eur(r.valor_ganho) }) }),
    ]));
    const cards = $("cm-kpis").querySelectorAll(".pn-kpis > *");
    if (cards[2]) { cards[2].dataset.view = "agenda"; cards[2].classList.add("cm-kpi-go"); }
  }

  function paintBar() {
    $("cm-bar").querySelectorAll("[data-view]").forEach((b) => b.classList.toggle("on", b.dataset.view === view));
    $("cm-zoom").hidden = view !== "quadro";
    const fr = $("cm-fromradar"), qn = D?.resumo?.quentes || 0;
    fr.hidden = view !== "quadro" || !qn; fr.textContent = t("Do Radar: {n}", { n: qn });
    $("cm-zv").textContent = `${ZOOMS[zoomI]}%`;
    $("cm-clear").hidden = !(q || fT || fE || fR);
    $("cm-ft").value = fT; $("cm-fe").value = fE; $("cm-fr").value = fR;
    if ($("cm-q").value !== q) $("cm-q").value = q;
  }

  function paintView() {
    paintBar();
    const box = $("cm-view"), keep = box.querySelector(".cm-board")?.scrollLeft || 0;
    if (!D.leads.length) {
      paint(box, `<div class="panel pad">${ui.empty("target", t("Ainda não há leads"), t("Traz as empresas que valem a pena do Radar, ou cria um lead à mão: uma indicação, alguém que ligou."),
        `<a class="btn" href="#/radar">${esc(t("Ir ao Radar"))}</a>`)}</div>`);
      return;
    }
    const L = vis();
    const filtered = L.length !== D.leads.length;
    const head = filtered ? `<p class="cm-count">${esc(t("{n} de {t} leads", { n: L.length, t: D.leads.length }))}</p>` : "";
    const html = view === "lista" ? listaHtml(L) : view === "agenda" ? agendaHtml(L) : view === "funil" ? funilHtml() : quadroHtml(L);
    paint(box, (view === "funil" ? "" : head) + html);
    const b = box.querySelector(".cm-board"); if (b && keep) b.scrollLeft = keep;
    $("cm-extra").hidden = view !== "quadro";
  }
  function setView(v) { view = v; pref.set("view", v); paintView(); }
  function setZoom(i) {
    zoomI = Math.max(0, Math.min(ZOOMS.length - 1, i)); pref.set("zoom", zoomI);
    const b = $("cm-view").querySelector(".cm-board-in");
    if (b) { b.style.setProperty("--cm-z", ZOOMS[zoomI] / 100); b.classList.toggle("compact", ZOOMS[zoomI] < 85); $("cm-view")._html = null; }
    $("cm-zv").textContent = `${ZOOMS[zoomI]}%`;
  }

  /* ----- quadro ----- */
  function quadroHtml(L) {
    const col = ([k, label]) => {
      const list = L.filter((l) => l.stage === k), soma = list.reduce((s, l) => s + (l.valor || 0), 0), prob = D.prob[k];
      return `<section class="cm-col" data-col="${k}">
        <header><div class="cm-col-t"><span class="st ${TONE[k]}"><i></i>${esc(t(label))}</span><b>${list.length}</b></div>
          <div class="cm-col-s"><span>${soma ? eur(soma) : "&nbsp;"}</span>${prob ? `<em title="${esc(t("Probabilidade estimada de fechar a partir desta fase"))}">${prob}%</em>` : ""}</div></header>
        <div class="cm-cards">${list.map(cardHtml).join("") || `<p class="cm-none">${esc(t(k === "novo" ? "Traz uma do Radar" : "Arrasta para aqui"))}</p>`}</div>
      </section>`;
    };
    const perdidos = L.filter((l) => l.stage === "nao");
    return `<div class="cm-board"><div class="cm-board-in${ZOOMS[zoomI] < 85 ? " compact" : ""}" style="--cm-z:${ZOOMS[zoomI] / 100}">${D.stages.map(col).join("")}</div></div>
      <details class="cm-lost${perdidos.length ? "" : " empty"}" data-col="nao"><summary><span class="st bad"><i></i>${esc(t("Perdidos"))}</span><b>${perdidos.length}</b><em>${esc(t(perdidos.length ? "ficam registados com o motivo" : "larga aqui um negócio perdido"))}</em></summary>
        <div class="cm-cards row">${perdidos.map(cardHtml).join("")}</div></details>`;
  }

  function nextLine(l) {
    if (!isOpen(l)) return "";
    const p = l.proxima;
    if (!p) return `<div class="cm-next none">${I.warn}<span>${esc(t("Sem próxima ação"))}</span></div>`;
    const late = isLate(p), hoje = !late && dayDiff(p.quando) === 0;
    return `<div class="cm-next${late ? " late" : hoje ? " today" : ""}" title="${esc(p.texto)}">${p.reuniao ? I.cam : I.clock}<span>${esc(p.texto)}</span><time>${esc(late ? t("Atrasada desde {d}", { d: day(p.quando) }) : when(p.quando))}</time></div>`;
  }

  function cardHtml(l) {
    const v = l.vale ? VALE[l.vale.v] : null, w = wa(l), tel = l.telefones?.[0];
    const quick = isOpen(l) ? [
      tel && `<a href="tel:${esc(tel.replace(/\s/g, ""))}" data-did="chamada" title="${esc(t("Ligar"))}" aria-label="${esc(t("Ligar"))}">${I.tel}</a>`,
      w && `<a href="${esc(w)}" target="_blank" rel="noopener" data-did="whatsapp" title="WhatsApp" aria-label="WhatsApp">${I.wa}</a>`,
      l.proxima && `<button type="button" data-done="${esc(l.key)}" title="${esc(t("Próxima ação feita"))}" aria-label="${esc(t("Próxima ação feita"))}">${I.ok}</button>`,
    ].filter(Boolean).join("") : "";
    return `<article class="cm-card${sel === l.key ? " on" : ""}${l.parado ? " rot" : ""}" draggable="true" data-card="${esc(l.key)}" data-open="${esc(l.key)}">
      <div class="cm-card-t"><b>${esc(l.nome)}</b>${v ? `<span class="st ${v[0]}" title="${esc(l.vale.titulo)}"><i></i>${l.vale.pontos}</span>` : ""}</div>
      <small class="cm-sub">${esc([l.contacto?.nome, l.ramo_nome, town(l)].filter(Boolean).join(" · "))}</small>
      ${l.valor != null ? `<div class="cm-val">${eur(l.valor)}</div>` : ""}
      ${nextLine(l)}
      ${l.reuniao && !l.proxima?.reuniao && isOpen(l) ? `<div class="cm-meetline">${I.cam}<span>${esc(t("Reunião"))}: ${esc(when(l.reuniao.quando))}</span></div>` : ""}
      ${l.parado ? `<div class="cm-rot">${esc(t("Parado há {d}", { d: dias(l.parado) }))}</div>` : ""}
      ${l.rascunho?.estado === "por aprovar" ? `<div class="cm-flag">${esc(t("Mensagem por aprovar"))}</div>` : ""}
      ${l.stage === "nao" && l.motivo ? `<small class="cm-sub">${esc(l.motivo)}</small>` : ""}
      ${quick ? `<div class="cm-quick">${quick}</div>` : ""}
    </article>`;
  }

  /* ----- lista ----- */
  const SORT = {
    nome: (l) => l.nome.toLowerCase(), stage: (l) => [...D.stages.map(([k]) => k), "nao"].indexOf(l.stage), valor: (l) => l.valor ?? -1,
    vale: (l) => l.vale?.pontos ?? -1, prox: (l) => l.proxima?.quando ?? (isOpen(l) ? 0 : 9e12), ult: (l) => l.ult || 0,
  };
  const stageName = (k) => t(k === "nao" ? "Perdido" : (D.stages.find(([s]) => s === k) || [k, k])[1]);
  function listaHtml(L) {
    if (!L.length) return noResults();
    const sorted = [...L].sort((a, b) => { const x = SORT[sortK](a), y = SORT[sortK](b); return (x < y ? -1 : x > y ? 1 : 0) * sortD; });
    const th = (k, lab, cls = "") => `<th class="${cls}"><button type="button" data-sort="${k}" class="${sortK === k ? "on" : ""}">${esc(t(lab))}${sortK === k ? `<i>${sortD > 0 ? "↑" : "↓"}</i>` : ""}</button></th>`;
    return `<div class="panel cm-tw"><table class="cm-t"><thead><tr>${th("nome", "Empresa")}${th("stage", "Fase")}${th("valor", "Valor", "cm-n")}${th("vale", "Radar", "cm-hide")}${th("prox", "Próxima ação")}${th("ult", "Última atividade", "cm-hide")}</tr></thead><tbody>
      ${sorted.map((l) => {
        const p = l.proxima, v = l.vale ? VALE[l.vale.v] : null;
        return `<tr data-open="${esc(l.key)}" class="${sel === l.key ? "on" : ""}">
          <td><b>${esc(l.nome)}</b><small>${esc([l.contacto?.nome, l.ramo_nome, town(l)].filter(Boolean).join(" · "))}</small></td>
          <td><span class="st ${TONE[l.stage]}"><i></i>${esc(stageName(l.stage))}</span></td>
          <td class="cm-n">${l.valor != null ? eur(l.valor) : `<span class="cm-dim">${esc(t("Sem valor"))}</span>`}</td>
          <td class="cm-hide">${v ? `<span class="st ${v[0]}"><i></i>${l.vale.pontos}</span>` : `<span class="cm-dim">${esc(t("Sem dados"))}</span>`}</td>
          <td>${isOpen(l) ? (p ? `<span class="cm-tn${isLate(p) ? " late" : ""}">${esc(p.texto)}<small>${esc(isLate(p) ? t("atrasado") : when(p.quando))}</small></span>` : `<span class="cm-tn none">${esc(t("Sem próxima ação"))}</span>`) : `<span class="cm-dim">${esc(l.motivo || t("Fechado"))}</span>`}</td>
          <td class="cm-hide"><span class="${l.parado ? "cm-tn late" : "cm-dim"}">${esc(l.parado ? t("Parado há {d}", { d: dias(l.parado) }) : l.ult ? ago(l.ult) : t("Sem dados"))}</span></td>
        </tr>`;
      }).join("")}</tbody></table></div>`;
  }
  const noResults = () => `<div class="panel pad">${ui.empty("search", t("Nenhum lead com estes filtros"), t("Muda a pesquisa ou limpa os filtros."), `<button type="button" class="btn" data-clear>${esc(t("Limpar filtros"))}</button>`)}</div>`;

  /* ----- agenda ----- */
  function agendaHtml(L) {
    const items = [];
    L.filter(isOpen).forEach((l) => {
      const p = l.proxima, m = l.reuniao;
      if (p) items.push({ l, at: p.quando, txt: p.texto, meet: p.reuniao ? m : null });
      if (m && !p?.reuniao) items.push({ l, at: m.quando, txt: t("Reunião com {n}", { n: l.nome }), meet: m });
      if (!p) items.push({ l, none: true });
    });
    const B = [["late", "Atrasadas"], ["hoje", "Hoje"], ["amanha", "Amanhã"], ["semana", "Próximos 7 dias"], ["depois", "Mais tarde"], ["none", "Sem próxima ação"]];
    const bucket = (it) => {
      if (it.none) return "none";
      if (it.at < now() - 3600) return "late";
      const d = dayDiff(it.at);
      return d <= 0 ? "hoje" : d === 1 ? "amanha" : d <= 7 ? "semana" : "depois";
    };
    if (!items.length) return `<div class="panel pad">${ui.empty("check", t("Nada por fazer"), t("Nenhum negócio aberto tem ações marcadas com estes filtros."))}</div>`;
    return `<div class="cm-agenda">${B.map(([k, lab]) => {
      const list = items.filter((i) => bucket(i) === k).sort((a, b) => (a.at || 0) - (b.at || 0));
      if (!list.length) return "";
      return `<section class="panel cm-ag ${k}"><h3 class="cm-ag-h"><span>${esc(t(lab))}</span><b>${list.length}</b></h3>${list.map((it) => agRow(it, k)).join("")}</section>`;
    }).join("")}</div>`;
  }
  function agRow(it, k) {
    const l = it.l, tel = l.telefones?.[0], link = it.meet?.link;
    const right = it.none
      ? `<button type="button" class="btn sm" data-open="${esc(l.key)}">${esc(t("Marcar"))}</button>`
      : `${link ? `<a class="btn sm" href="${esc(link)}" target="_blank" rel="noopener">${isZoom(link) ? esc(t("Entrar no Zoom")) : esc(t("Entrar"))}</a>` : ""}
         ${tel && !it.meet ? `<a class="cm-ico" href="tel:${esc(tel.replace(/\s/g, ""))}" data-did="chamada" data-key="${esc(l.key)}" title="${esc(t("Ligar"))}" aria-label="${esc(t("Ligar"))}">${I.tel}</a>` : ""}`;
    return `<div class="cm-ag-r" data-open="${esc(l.key)}">
      ${it.none ? `<span class="cm-ag-c none">${I.warn}</span>` : it.meet ? `<span class="cm-ag-c">${I.cam}</span>` : `<button type="button" class="cm-ag-c check" data-done="${esc(l.key)}" title="${esc(t("Marcar como feita"))}" aria-label="${esc(t("Marcar como feita"))}">${I.ok}</button>`}
      <div class="cm-ag-t"><b>${esc(it.none ? l.nome : it.txt)}</b><small>${esc(it.none ? t("Um negócio sem próximo passo esquece-se") : [l.nome, l.valor != null && eur(l.valor)].filter(Boolean).join(" · "))}</small></div>
      ${it.none ? "" : `<time class="${k === "late" ? "late" : ""}">${esc(k === "late" ? day(it.at) : k === "hoje" || k === "amanha" ? hm(it.at) : `${day(it.at)}, ${hm(it.at)}`)}</time>`}
      <div class="cm-ag-a">${right}</div>
    </div>`;
  }

  /* ----- funil ----- */
  function funilHtml() {
    const F = D.funil, max = Math.max(1, F.fases[0]?.n || 0, ...F.fases.map((x) => x.n));
    const name = (k) => t((D.stages.find(([s]) => s === k) || [k, k])[1]);
    const abertos = D.leads.filter(isOpen);
    const rows = D.stages.slice(0, 5).map(([k]) => {
      const list = abertos.filter((l) => l.stage === k), soma = list.reduce((s, l) => s + (l.valor || 0), 0);
      return { k, n: list.length, soma, pond: soma * (D.prob[k] / 100) };
    });
    const tot = rows.reduce((s, r) => s + r.pond, 0), totV = rows.reduce((s, r) => s + r.soma, 0);
    const per = F.motivos.reduce((s, [, n]) => s + n, 0);
    return `<div class="cm-fn">
      <section class="panel pad cm-fn-main">
        <div class="pn-card-h"><b>${esc(t("Funil"))}</b><small>${esc(t("quantos chegaram a cada fase e quanto tempo lá ficaram, do histórico real"))}</small></div>
        <div class="cm-fn-rows">${F.fases.map((x, i) => {
          const prev = i ? F.fases[i - 1].n : 0, conv = i && prev ? Math.round(100 * x.n / prev) : null;
          return `<div class="cm-fn-r"><span class="cm-fn-l">${esc(name(x.k))}</span>
            <div class="cm-fn-b"><i style="width:${x.n ? Math.max(2, 100 * x.n / max) : 0}%"></i></div><b>${x.n}</b>
            <span class="cm-fn-c">${conv == null ? "&nbsp;" : `${conv}%`}</span>
            <span class="cm-fn-d">${x.dias == null ? esc(t("Sem dados")) : esc(t("{d} dias", { d: String(x.dias).replace(".", ",") }))}</span></div>`;
        }).join("")}</div>
        <div class="cm-fn-leg"><span>${esc(t("% = passaram da fase anterior"))}</span><span>${esc(t("dias = tempo médio na fase"))}</span></div>
      </section>
      <section class="panel pad">
        <div class="pn-card-h"><b>${esc(t("Previsão por fase"))}</b><small>${esc(t("valor × probabilidade estimada, não é um número garantido"))}</small></div>
        <table class="cm-t cm-t-s"><thead><tr><th>${esc(t("Fase"))}</th><th class="cm-n">${esc(t("Valor"))}</th><th class="cm-n">%</th><th class="cm-n">${esc(t("Previsão"))}</th></tr></thead>
          <tbody>${rows.map((r) => `<tr><td>${esc(name(r.k))} <span class="cm-dim">${r.n}</span></td><td class="cm-n">${r.soma ? eur(r.soma) : `<span class="cm-dim">−</span>`}</td><td class="cm-n cm-dim">${D.prob[r.k]}%</td><td class="cm-n">${r.soma ? eur(r.pond) : `<span class="cm-dim">−</span>`}</td></tr>`).join("")}</tbody>
          <tfoot><tr><td>${esc(t("Total"))}</td><td class="cm-n">${totV ? eur(totV) : "−"}</td><td></td><td class="cm-n">${totV ? eur(tot) : "−"}</td></tr></tfoot></table>
      </section>
      <section class="panel pad">
        <div class="pn-card-h"><b>${esc(t("Porque se perdem"))}</b><small>${esc(t("os motivos registados"))}</small></div>
        ${F.motivos.length ? `<div class="cm-mot">${F.motivos.map(([m, n]) => `<div><span>${esc(m)}</span><b>${n}</b><i style="width:${100 * n / per}%"></i></div>`).join("")}</div>` : `<p class="cm-none">${esc(t("Ainda nenhum perdido."))}</p>`}
        <div class="cm-orig"><span>${esc(t("Do Radar"))} <b>${F.origem.radar}</b></span><span>${esc(t("Criados à mão"))} <b>${F.origem.manual}</b></span></div>
      </section>
    </div>`;
  }

  /* ----- Do Radar + Atividade ----- */
  function paintExtra() {
    paint($("cm-extra"), `<div class="cm-split">
        <section class="panel pad" id="cm-radar">
          <div class="pn-card-h"><b>${esc(t("Do Radar para o CRM"))}${D.resumo.quentes ? ` <span class="cm-badge">${D.resumo.quentes}</span>` : ""}</b><small>${esc(t("as que valem a pena e ainda não estão no quadro"))}</small></div>
          ${radarHtml()}
        </section>
        <section class="panel pad">
          <div class="pn-card-h"><b>${esc(t("Atividade"))}</b><small>${esc(t("o que vocês e os departamentos fizeram"))}</small></div>
          ${feedHtml()}
        </section>
      </div>`);
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
    const all = D.leads.flatMap((l) => (l.atividades || []).map((a) => ({ ...a, nome: l.nome, key: l.key }))).sort((a, b) => b.at - a.at).slice(0, 10);
    if (!all.length) return `<p class="cm-none">${esc(t("Ainda nada. Quando alguém liga, manda uma mensagem ou um departamento trabalha um lead, fica aqui."))}</p>`;
    return `<ol class="cm-feed">${all.map((a) => `<li data-open="${esc(a.key)}">${who(a)}<div><b>${esc(a.nome)}</b><p>${esc(a.texto)}</p></div><time>${esc(ago(a.at))}</time></li>`).join("")}</ol>`;
  }

  /* ---------- a ficha do lead ---------- */
  function openDr(k, aba) { sel = k; tab = aba || "negocio"; $("cm-scrim").hidden = false; $("cm-dr").hidden = false; paintDr(true); document.querySelectorAll("[data-open]").forEach((c) => c.classList.toggle("on", c.dataset.open === k && !c.closest(".cm-feed"))); }
  function closeDr() { sel = ""; if ($("cm-dr")) { $("cm-dr").hidden = true; $("cm-scrim").hidden = true; } document.querySelectorAll("#cm-view .on[data-open]").forEach((c) => c.classList.remove("on")); }

  function wa(l, text) {
    const tel = l.telefones || [];
    const pt = tel.map((x) => x.replace(/\D/g, "").replace(/^(00)?351/, "")).find((x) => /^9\d{8}$/.test(x));
    const intl = tel.find((x) => /^(\+|00)\d/.test(x) && !/^(\+|00)351/.test(x));
    const n = pt ? `351${pt}` : intl ? intl.replace(/\D/g, "").replace(/^00/, "") : "";
    return n ? `https://wa.me/${n}${text ? `?text=${encodeURIComponent(text)}` : ""}` : "";
  }
  const mailto = (to, r) => `mailto:${to}${r ? `?subject=${encodeURIComponent(r.assunto)}&body=${encodeURIComponent(r.texto)}` : ""}`;
  const local = (ts) => { const d = new Date(ts * 1000); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
  const inDays = (n, h) => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(h ?? 10, 0, 0, 0); return d.getTime() / 1000; };

  function paintDr(fresh) {
    const box = $("cm-dr"), l = lead(sel); if (!l) return closeDr();
    const scroll = fresh ? 0 : box.querySelector(".cm-dr-in")?.scrollTop || 0;
    const af = document.activeElement?.closest?.("#cm-dr") ? document.activeElement.dataset.f : "";
    const v = l.vale, r = l.rascunho, draft = r && r.estado === "por aprovar" ? r : null;
    const w = wa(l, draft?.texto), mail = l.emails[0], m = l.reuniao;
    const acts = [
      l.telefones[0] && `<a class="cm-act" href="tel:${esc(l.telefones[0].replace(/\s/g, ""))}" data-did="chamada">${I.tel}<span>${esc(t("Ligar"))}</span></a>`,
      w && `<a class="cm-act" href="${esc(w)}" target="_blank" rel="noopener" data-did="whatsapp">${I.wa}<span>WhatsApp</span></a>`,
      mail && `<a class="cm-act" href="${esc(mailto(mail, draft))}" data-did="email">${I.mail}<span>${esc(t("Email"))}</span></a>`,
      m?.link ? `<a class="cm-act" href="${esc(m.link)}" target="_blank" rel="noopener">${I.cam}<span>${isZoom(m.link) ? "Zoom" : esc(t("Reunião"))}</span></a>` : `<button type="button" class="cm-act" data-tab="reuniao">${I.cam}<span>${esc(t("Reunião"))}</span></button>`,
      l.site && `<a class="cm-act" href="${esc(/^https?:/.test(l.site) ? l.site : "https://" + l.site)}" target="_blank" rel="noopener">${I.web}<span>${esc(t("Site"))}</span></a>`,
    ].filter(Boolean);
    const idx = [...D.stages.map(([k]) => k)].indexOf(l.stage);
    const tabs = [["negocio", "Negócio", ""], ["reuniao", "Reunião", m ? "●" : ""], ["atividade", "Atividade", String((l.atividades || []).length || "")], ["agentes", "Departamentos", draft ? "●" : ""]];
    const body = tab === "reuniao" ? tabReuniao(l) : tab === "atividade" ? tabAtividade(l) : tab === "agentes" ? tabAgentes(l, draft, w, mail) : tabNegocio(l);
    paint(box, `<div class="cm-dr-bar">${l.manual ? `<span class="cm-tag">${esc(t("Criado à mão"))}</span>` : `<a class="btn quiet sm" href="#/radar" data-radar="${esc(l.sid || "")}">${esc(t("Ver no Radar"))}</a>`}<span></span><button class="btn quiet sm" data-close aria-label="${esc(t("Fechar"))}">${I.x}</button></div>
      <div class="cm-dr-in">
        <div class="cm-dr-head"><div><h3>${esc(l.nome)}</h3><p>${esc([l.contacto?.nome, l.ramo_nome, l.morada || l.local].filter(Boolean).join(" · "))}</p></div>
          ${v ? `<span class="st ${VALE[v.v][0]}"><i></i>${esc(t(VALE[v.v][1]))} · ${v.pontos}/100</span>` : ""}</div>
        <div class="cm-steps" role="group" aria-label="${esc(t("Fase"))}">${D.stages.map(([k, lab], i) => `<button type="button" class="${l.stage === k ? "on" : idx > i ? "done" : ""}" data-move="${k}">${esc(t(lab))}</button>`).join("")}</div>
        ${l.stage === "nao" ? `<label class="cm-f"><span>${esc(t("Porque não quis"))}</span><input data-f="motivo" value="${esc(l.motivo || "")}" placeholder="${esc(t("Ex.: já tem agência, sem orçamento agora"))}"></label>` : ""}
        ${l.parado ? `<div class="cm-alert">${I.warn}<span>${esc(t("Parado há {d}: ninguém fez nada neste negócio. Regista um contacto ou marca o passo seguinte.", { d: dias(l.parado) }))}</span></div>` : ""}
        <div class="cm-acts" style="grid-template-columns:repeat(${Math.max(acts.length, 1)},1fr)">${acts.join("")}</div>
        ${nextBlock(l)}
        <div class="cm-tabs" role="tablist">${tabs.map(([k, lab, n]) => `<button type="button" role="tab" aria-selected="${tab === k}" class="${tab === k ? "on" : ""}" data-tab="${k}">${esc(t(lab))}${n ? `<em>${n}</em>` : ""}</button>`).join("")}</div>
        <div class="cm-pane">${body}</div>
      </div>`);
    box._html = null; // os formulários mudam sem passar por aqui: pintar outra vez tem mesmo de os repor
    box.querySelectorAll("form[data-form]").forEach((f) => (f.onsubmit = (e) => { e.preventDefault(); submit(f); }));
    const inner = box.querySelector(".cm-dr-in"); if (inner) inner.scrollTop = scroll;
    if (af) box.querySelector(`[data-f="${af}"]`)?.focus();
  }

  function nextBlock(l) {
    if (!isOpen(l)) return "";
    const p = l.proxima, late = isLate(p);
    const chips = [["Hoje", () => now() + 3600], ["Amanhã", () => inDays(1)], ["3 dias", () => inDays(3)], ["1 semana", () => inDays(7)]];
    return `<section class="cm-nx${!p ? " none" : late ? " late" : ""}">
      <div class="cm-nx-h"><h4 class="cm-h">${esc(t("Próxima ação"))}</h4>
        ${p ? `<small>${esc(late ? t("Atrasada desde {d}", { d: day(p.quando) }) : when(p.quando))}${p.por ? ` · ${esc(p.por)}` : ""}</small>` : `<small>${esc(t("Falta marcar: um negócio sem próximo passo esquece-se"))}</small>`}</div>
      <form class="cm-nextf" data-form="proxima"><input name="texto" value="${esc(p?.texto || "")}" placeholder="${esc(t("Ex.: Ligar ao dono"))}" aria-label="${esc(t("O que fazer"))}"><input type="datetime-local" name="quando" value="${p ? local(p.quando) : local(inDays(1))}" aria-label="${esc(t("Quando"))}"><button class="btn sm">${esc(t("Guardar"))}</button></form>
      <div class="cm-nx-a">${chips.map(([lab], i) => `<button type="button" class="cm-chip" data-when="${i}">${esc(t(lab))}</button>`).join("")}<span class="cm-grow"></span>
        ${p ? `<button type="button" class="btn sm" data-done="${esc(l.key)}">${I.ok}${esc(t("Feita"))}</button>` : ""}</div>
    </section>`;
  }

  function tabNegocio(l) {
    const c = l.contacto || {}, pond = l.valor != null && l.prob ? l.valor * l.prob / 100 : null;
    const fecho = l.fecho ? local(l.fecho).slice(0, 10) : "";
    return `<div class="cm-grid2">
        <label class="cm-f"><span>${esc(t("Valor do negócio (€)"))}</span><input type="number" min="0" step="50" data-f="valor" value="${l.valor ?? ""}" placeholder="${esc(t("Ex.: 1200"))}">
          ${pond != null ? `<small>${esc(t("Previsão {v}: {p}% estimados nesta fase", { v: eur(pond), p: l.prob }))}</small>` : ""}</label>
        <label class="cm-f"><span>${esc(t("Fecho previsto"))}</span><input type="date" data-f="fecho" value="${fecho}"></label>
      </div>
      <section><h4 class="cm-h">${esc(t("Contacto"))}</h4><div class="cm-grid2">
        ${l.manual ? `<label class="cm-f"><span>${esc(t("Empresa"))}</span><input data-f="nome" value="${esc(l.nome)}"></label>` : ""}
        <label class="cm-f"><span>${esc(t("Pessoa"))}</span><input data-f="c.nome" value="${esc(c.nome || "")}" placeholder="${esc(t("Quem decide"))}"></label>
        <label class="cm-f"><span>${esc(t("Cargo"))}</span><input data-f="c.cargo" value="${esc(c.cargo || "")}" placeholder="${esc(t("Ex.: Dono"))}"></label>
        <label class="cm-f"><span>${esc(t("Telefone"))}</span><input type="tel" data-f="c.telefone" value="${esc(c.telefone || "")}" placeholder="${esc(l.telefones[0] || t("Sem dados"))}"></label>
        <label class="cm-f"><span>${esc(t("Email"))}</span><input type="email" data-f="c.email" value="${esc(c.email || "")}" placeholder="${esc(l.emails[0] || t("Sem dados"))}"></label>
        ${l.manual ? `<label class="cm-f"><span>${esc(t("Site"))}</span><input data-f="site" value="${esc(l.site || "")}" placeholder="exemplo.pt"></label>
        <label class="cm-f"><span>${esc(t("Localidade"))}</span><input data-f="local" value="${esc(l.local || "")}"></label>
        <label class="cm-f"><span>${esc(t("Ramo"))}</span><input data-f="segmento" value="${esc(l.ramo_nome || "")}"></label>` : ""}
      </div></section>
      <label class="cm-f"><span>${esc(t("Notas"))}</span><textarea data-f="nota" rows="3" placeholder="${esc(t("O que a equipa deve saber"))}">${esc(l.nota || "")}</textarea></label>
      ${l.problemas?.length ? `<section><h4 class="cm-h">${esc(t("O que lhe vender"))}</h4><ul class="cm-probs">${l.problemas.map((x) => `<li><b>${esc(x.problema)}</b><span>${esc(x.solucao || "")}</span></li>`).join("")}</ul></section>` : ""}
      <div class="cm-danger">${l.stage === "nao" ? `<button type="button" class="btn quiet sm" data-move="novo">${esc(t("Reabrir"))}</button>` : `<button type="button" class="btn quiet sm" data-move="nao">${esc(t("Marcar como perdido"))}</button>`}
        <span class="cm-grow"></span><button type="button" class="btn quiet sm" data-remove="0">${esc(t("Tirar do CRM"))}</button></div>`;
  }

  function invite(l, m) {
    const d = new Date(m.quando * 1000), q1 = d.toLocaleDateString("pt-PT", { weekday: "long", day: "numeric", month: "long" }), who1 = l.contacto?.nome?.split(" ")[0];
    return `Olá${who1 ? ` ${who1}` : ""}, boa tarde.\n\nConfirmo a nossa conversa: ${q1}, às ${hm(m.quando)} (${m.duracao} minutos).${m.link ? `\n\nPara entrar:\n${m.link}` : ""}\n\nAté lá.`;
  }
  const gcal = (l, m) => {
    const f = (ts) => new Date(ts * 1000).toISOString().replace(/[-:]|\.\d{3}/g, "");
    const p = new URLSearchParams({ action: "TEMPLATE", text: t("Reunião com {n}", { n: l.nome }), dates: `${f(m.quando)}/${f(m.quando + m.duracao * 60)}`, details: m.link ? `${t("Para entrar")}: ${m.link}` : "", location: m.link || l.morada || l.local || "" });
    return `https://calendar.google.com/calendar/render?${p}`;
  };

  function tabReuniao(l) {
    const m = l.reuniao, past = m && m.quando + m.duracao * 60 < now();
    const myRoom = pref.get("sala", "");
    const form = (title) => `<form class="cm-meet" data-form="reuniao">
        ${title ? `<h4 class="cm-h">${esc(t(title))}</h4>` : ""}
        <div class="cm-grid2"><label class="cm-f"><span>${esc(t("Dia e hora"))}</span><input type="datetime-local" name="quando" required value="${local(m?.quando || inDays(1, 15))}"></label>
          <label class="cm-f"><span>${esc(t("Duração"))}</span><select name="duracao">${[15, 30, 45, 60, 90].map((d) => `<option value="${d}"${(m?.duracao || 30) === d ? " selected" : ""}>${d} min</option>`).join("")}</select></label></div>
        <label class="cm-f"><span>${esc(t("Link da reunião"))}</span><input type="url" name="link" value="${esc(m?.link || "")}" placeholder="https://zoom.us/j/…"></label>
        <div class="cm-meet-a">
          ${D.zoom_api ? `<button type="button" class="btn sm" data-zoomnew>${I.cam}${esc(t("Criar no Zoom"))}</button>` : `<a class="btn sm" href="https://zoom.us/meeting/schedule" target="_blank" rel="noopener">${I.cam}${esc(t("Agendar no Zoom"))}</a>`}
          ${myRoom ? `<button type="button" class="btn quiet sm" data-room>${esc(t("Usar a minha sala"))}</button>` : ""}
          <span class="cm-grow"></span><button class="btn sm">${esc(t(m ? "Guardar alterações" : "Marcar reunião"))}</button></div>
        ${D.zoom_api ? "" : `<p class="cm-note">${esc(t("Agenda no Zoom, copia o link e cola-o aqui. Fica guardado como a tua sala para a próxima."))}</p>`}
      </form>`;
    if (!m) return form("");
    const inv = invite(l, m), w = wa(l, inv), mail = l.emails[0];
    const mailHref = mail ? mailto(mail, { assunto: t("Reunião com a AMG"), texto: inv }) : "";
    return `<section class="cm-mcard${past ? " past" : ""}">
        <div class="cm-mcard-h"><span class="cm-mcard-ic">${I.cam}</span><div><b>${esc(new Date(m.quando * 1000).toLocaleDateString("pt-PT", { weekday: "long", day: "numeric", month: "long" }))}</b><small>${esc(hm(m.quando))} · ${m.duracao} min${m.link ? (isZoom(m.link) ? " · Zoom" : "") : ` · ${esc(t("sem link"))}`}</small></div>
          ${m.link ? `<a class="btn sm" href="${esc(m.link)}" target="_blank" rel="noopener">${esc(isZoom(m.link) ? t("Entrar no Zoom") : t("Entrar"))}</a>` : ""}</div>
        ${past ? `<form class="cm-meet" data-form="reuniaofim"><label class="cm-f"><span>${esc(t("Como correu?"))}</span><textarea name="texto" rows="2" placeholder="${esc(t("O que ficou combinado"))}"></textarea></label>
            <div class="cm-meet-a"><span class="cm-grow"></span><button class="btn sm">${esc(t("Reunião feita"))}</button></div></form>`
          : `<div class="cm-mcard-a">
            <a class="btn quiet sm" href="${esc(gcal(l, m))}" target="_blank" rel="noopener">${I.cal}Google Calendar</a>
            <a class="btn quiet sm" href="/api/crm/reuniao.ics?key=${encodeURIComponent(l.key)}&token=${encodeURIComponent(token)}" target="_blank" rel="noopener">${I.cal}${esc(t("Apple e Outlook"))}</a>
            ${w ? `<a class="btn quiet sm" href="${esc(w)}" target="_blank" rel="noopener" data-sent="WhatsApp">${I.wa}${esc(t("Convite"))}</a>` : ""}
            ${mailHref ? `<a class="btn quiet sm" href="${esc(mailHref)}" data-sent="email">${I.mail}${esc(t("Convite"))}</a>` : ""}
            <button type="button" class="btn quiet sm" data-copyinv>${esc(t("Copiar convite"))}</button>
          </div>`}
      </section>
      ${past ? "" : form("Mudar a reunião")}
      <div class="cm-danger"><span class="cm-grow"></span><button type="button" class="btn quiet sm" data-cancelm>${esc(t("Cancelar a reunião"))}</button></div>`;
  }

  function tabAtividade(l) {
    const timeline = [...(l.atividades || [])].sort((a, b) => b.at - a.at);
    return `<form class="cm-log" data-form="atividade"><select name="tipo" aria-label="${esc(t("Tipo"))}">${Object.entries(D.tipos).map(([k, lab]) => `<option value="${k}">${esc(t(lab))}</option>`).join("")}</select>
        <input name="texto" placeholder="${esc(t("O que aconteceu? Ex.: falei com o dono, quer orçamento"))}"><button class="btn sm">${esc(t("Registar"))}</button></form>
      ${timeline.length ? `<ol class="cm-feed">${timeline.map((a) => `<li>${who(a)}<div><p>${esc(a.texto)}</p></div><time title="${esc(new Date(a.at * 1000).toLocaleString("pt-PT"))}">${esc(ago(a.at))}</time></li>`).join("")}</ol>` : `<p class="cm-none">${esc(t("Ainda nada registado."))}</p>`}`;
  }

  function tabAgentes(l, draft, w, mail) {
    return `<div class="cm-agents">
        <button type="button" data-agent="pesquisa"><span class="cm-mono">PES</span><b>${esc(t("Pesquisa"))}</b><small>${esc(t("Investiga: marca, redes, Google, dinheiro"))}</small></button>
        <button type="button" data-agent="marketing"><span class="cm-mono">MKT</span><b>${esc(t("Marketing"))}</b><small>${esc(t("Escreve a primeira mensagem"))}</small></button>
        <button type="button" data-agent="operacoes"><span class="cm-mono">OPS</span><b>${esc(t("Operações"))}</b><small>${esc(t("Marca a próxima ação da fase"))}</small></button>
      </div>
      ${draft ? `<section class="cm-draft"><h4 class="cm-h">${esc(t("Mensagem do Marketing · por aprovar"))}</h4><pre>${esc(draft.texto)}</pre>
        <div class="cm-draft-a">${w ? `<a class="btn sm" href="${esc(w)}" target="_blank" rel="noopener" data-approve="WhatsApp">${esc(t("Aprovar e abrir no WhatsApp"))}</a>` : ""}
        ${mail ? `<a class="btn sm" href="${esc(mailto(mail, draft))}" data-approve="email">${esc(t("Aprovar e abrir o email"))}</a>` : ""}
        <button class="btn quiet sm" data-copy>${esc(t("Copiar"))}</button><button class="btn quiet sm" data-drop>${esc(t("Apagar"))}</button></div></section>` : ""}`;
  }

  /* ---------- janelas pequenas: novo lead, perdido, ganho ---------- */
  function openModal(title, html, onsubmit) {
    const box = $("cm-modal");
    box.innerHTML = `<div class="cm-mod-in" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="cm-mod-h"><h3>${esc(title)}</h3><button type="button" class="btn quiet sm" data-modclose aria-label="${esc(t("Fechar"))}">${I.x}</button></div>
      <form id="cm-mf">${html}<p class="cm-err" id="cm-merr" hidden></p></form></div>`;
    box.hidden = false; modal = onsubmit;
    const f = $("cm-mf");
    f.onsubmit = async (e) => {
      e.preventDefault();
      const btn = f.querySelector("button[type=submit]"); if (btn) btn.disabled = true;
      try { await onsubmit(Object.fromEntries(new FormData(f))); closeModal(); }
      catch (err) { const m = $("cm-merr"); m.textContent = err.message; m.hidden = false; if (btn) btn.disabled = false; }
    };
    f.querySelector("input,textarea,select")?.focus();
  }
  function closeModal() { modal = null; const b = $("cm-modal"); if (b) { b.hidden = true; b.innerHTML = ""; } paintView(); }

  function newLead() {
    const ramos = [...new Set(D.leads.map((l) => l.ramo_nome).filter(Boolean))].sort();
    const f = (name, lab, attrs = "") => `<label class="cm-f"><span>${esc(t(lab))}</span><input name="${name}" ${attrs}></label>`;
    openModal(t("Novo lead"), `<div class="cm-grid2">
        <div class="cm-span">${f("nome", "Empresa", 'required minlength="2" maxlength="120"')}</div>
        ${f("pessoa", "Pessoa de contacto")}${f("telefone", "Telefone", 'type="tel"')}
        ${f("email", "Email", 'type="email"')}${f("site", "Site", 'placeholder="exemplo.pt"')}
        ${f("segmento", "Ramo", 'list="cm-ramos"')}${f("local", "Localidade")}
        ${f("valor", "Valor do negócio (€)", 'type="number" min="0" step="50"')}
      </div><datalist id="cm-ramos">${ramos.map((r) => `<option value="${esc(r)}">`).join("")}</datalist>
      <div class="cm-mod-a"><button type="button" class="btn quiet" data-modclose>${esc(t("Cancelar"))}</button><button type="submit" class="btn">${esc(t("Criar lead"))}</button></div>`,
      async (d) => {
        const r = await api("/api/crm/novo", { method: "POST", body: { nome: d.nome, segmento: d.segmento, local: d.local, site: d.site, valor: d.valor, contacto: { nome: d.pessoa, telefone: d.telefone, email: d.email } } });
        await load();
        closeModal(); openDr(r.key);
      });
  }

  function askLost(k) {
    const l = lead(k); if (!l) return;
    const R = ["Sem orçamento", "Já tem fornecedor", "Sem interesse", "Nunca respondeu", "Mau momento"];
    openModal(t("Porque se perdeu {n}?", { n: l.nome }), `<div class="cm-why">${R.map((x) => `<label><input type="radio" name="m" value="${esc(x)}" required><span>${esc(t(x))}</span></label>`).join("")}</div>
      <label class="cm-f"><span>${esc(t("Mais pormenores"))}</span><input name="extra" placeholder="${esc(t("Opcional"))}"></label>
      <div class="cm-mod-a"><button type="button" class="btn quiet" data-modclose>${esc(t("Cancelar"))}</button><button type="submit" class="btn">${esc(t("Marcar como perdido"))}</button></div>`,
      async (d) => { await post({ estado: "nao", motivo: [d.m, d.extra].filter(Boolean).join(": ") }, k); });
  }
  function askWon(k) {
    const l = lead(k); if (!l) return;
    openModal(t("Ganho: {n}", { n: l.nome }), `<label class="cm-f"><span>${esc(t("Quanto vale o negócio (€)"))}</span><input type="number" name="valor" min="0" step="50" value="${l.valor ?? ""}"></label>
      <div class="cm-mod-a"><button type="button" class="btn quiet" data-modclose>${esc(t("Cancelar"))}</button><button type="submit" class="btn">${esc(t("Marcar como ganho"))}</button></div>`,
      async (d) => { await post({ estado: "fechou", ...(d.valor !== "" ? { valor: Number(d.valor) } : {}) }, k); });
  }

  /* ---------- ações ---------- */
  const post = async (body, k = sel) => { await api("/api/crm/lead", { method: "POST", body: { key: k, ...body } }); await load(); };
  async function save(body, k = sel) { try { await post(body, k); } catch (e) { toast(e.message); await load().catch(() => {}); } }
  function move(k, stage) {
    const l = lead(k); if (!l || l.stage === stage) return paintView();
    if (stage === "nao") return askLost(k);
    if (stage === "fechou") return askWon(k);
    l.stage = stage; $("cm-view")._html = null; paintView();   // o cartão muda logo; a resposta confirma
    save({ estado: stage }, k).then(() => { if (stage === "reuniao" && !lead(k)?.reuniao) openDr(k, "reuniao"); });
  }
  function submit(f) {
    const d = Object.fromEntries(new FormData(f)), kind = f.dataset.form;
    if (kind === "proxima") return save({ proxima: d.texto ? { texto: d.texto, quando: d.quando ? new Date(d.quando).getTime() / 1000 : now() } : null });
    if (kind === "reuniao") {
      if (d.link && isZoom(d.link)) pref.set("sala", d.link);
      return save({ reuniao: { quando: new Date(d.quando).getTime() / 1000, duracao: Number(d.duracao), link: d.link.trim() } });
    }
    if (kind === "reuniaofim") return save({ reuniao: null, reuniao_fim: true, atividade: { tipo: "reuniao", texto: d.texto || t("Reunião feita") } });
    return save({ atividade: { tipo: d.tipo, texto: d.texto } });
  }
  let toastT = 0;
  function toast(m) { const b = $("cm-toast"); if (!b) return; b.textContent = m; b.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { if ($("cm-toast")) b.hidden = true; }, 3800); }
  const reachOut = (k, canal) => { const l = lead(k); if (!l) return; setTimeout(() => save({ atividade: { tipo: canal, texto: "" }, ...(l.stage === "novo" ? { estado: "contactado" } : {}) }, k), 50); };

  async function click(e) {
    const el = (s) => e.target.closest(s);
    if (el("[data-goradar]")) return $("cm-radar")?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (el("[data-modclose]") || e.target.id === "cm-modal") return closeModal();
    if (el("#cm-scrim") || el("[data-close]")) return closeDr();
    if (el("[data-new]")) return newLead();
    const vw = el("[data-view]"); if (vw) return setView(vw.dataset.view);
    if (el("[data-clear]")) { q = fT = fE = fR = ""; return paintView(); }
    const z = el("[data-z]"); if (z) return setZoom(z.dataset.z === "0" ? 2 : zoomI + Number(z.dataset.z));
    const so = el("[data-sort]");
    if (so) { const k = so.dataset.sort; if (sortK === k) sortD = -sortD; else { sortK = k; sortD = k === "nome" || k === "stage" || k === "prox" ? 1 : -1; } pref.set("sort", `${sortK}:${sortD}`); return paintView(); }
    const add = el("[data-add]");
    if (add) {
      add.disabled = true;
      const [sid, nid] = add.dataset.add.split(":");
      try { const l = await api("/api/crm/add", { method: "POST", body: { sid, nid } }); await load(); if (l?.nome) { const n = D.leads.find((x) => x.nome === l.nome); if (n) openDr(n.key); } }
      catch (err) { add.disabled = false; toast(err.message); }
      return;
    }
    const tb = el("[data-tab]"); if (tb) { tab = tb.dataset.tab; return paintDr(true); }
    const mv = el("[data-move]"); if (mv) return move(sel, mv.dataset.move);
    const dn = el("[data-done]");
    if (dn) { e.stopPropagation(); await save({ feito: true }, dn.dataset.done); if (dn.closest("#cm-dr")) { paintDr(); $("cm-dr").querySelector('form[data-form="proxima"] input[name=texto]')?.focus(); } else toast(t("Feita. Marca o passo seguinte.")); return; }
    const wh = el("[data-when]");
    if (wh) { const chips = [() => now() + 3600, () => inDays(1), () => inDays(3), () => inDays(7)]; const ts = chips[Number(wh.dataset.when)](); const f = wh.closest(".cm-nx").querySelector("form"); f.elements.quando.value = local(ts); if (f.elements.texto.value.trim()) submit(f); else f.elements.texto.focus(); return; }
    const ag = el("[data-agent]");
    if (ag) {
      ag.classList.add("busy");
      try { await api("/api/crm/agente", { method: "POST", body: { key: sel, agente: ag.dataset.agent } }); await load(); paintDr(); } catch (err) { ag.classList.remove("busy"); toast(err.message); }
      return;
    }
    if (el("[data-zoomnew]")) {
      const f = el("form"), b = el("[data-zoomnew]"); b.disabled = true;
      try { await api("/api/crm/zoom", { method: "POST", body: { key: sel, quando: new Date(f.elements.quando.value).getTime() / 1000, duracao: Number(f.elements.duracao.value) } }); await load(); paintDr(); toast(t("Reunião criada no Zoom.")); }
      catch (err) { b.disabled = false; toast(err.message); }
      return;
    }
    if (el("[data-room]")) { el("form").elements.link.value = pref.get("sala", ""); return; }
    if (el("[data-copyinv]")) { const l = lead(sel); navigator.clipboard?.writeText(invite(l, l.reuniao)); toast(t("Convite copiado.")); return; }
    const sn = el("[data-sent]"); if (sn) { setTimeout(() => save({ atividade: { tipo: sn.dataset.sent === "email" ? "email" : "whatsapp", texto: t("Convite da reunião enviado.") } }), 50); return; }
    if (el("[data-cancelm]")) return save({ reuniao: null });
    const rm = el("[data-remove]");
    if (rm) {
      if (rm.dataset.remove === "0") { rm.dataset.remove = "1"; rm.textContent = t("Carrega outra vez para tirar"); rm.classList.add("danger"); return; }
      try { await api("/api/crm/remover", { method: "POST", body: { key: sel } }); closeDr(); await load(); toast(t("Tirado do CRM.")); } catch (err) { toast(err.message); }
      return;
    }
    const ap = el("[data-approve]");
    if (ap) { const l = lead(sel); setTimeout(() => save({ rascunho: "aprovado", canal: ap.dataset.approve, ...(l.stage === "novo" ? { estado: "contactado" } : {}) }), 50); return; }
    if (el("[data-drop]")) return save({ rascunho: "apagar" });
    if (el("[data-copy]")) { const l = lead(sel); navigator.clipboard?.writeText(l?.rascunho?.texto || ""); toast(t("Copiado.")); return; }
    const did = el("[data-did]");
    if (did) { const k = did.dataset.key || el("[data-card]")?.dataset.card || sel; reachOut(k, did.dataset.did); return; }
    const rd = el("[data-radar]"); if (rd && rd.dataset.radar) { try { localStorage.setItem("radar.cur", rd.dataset.radar); } catch {} return; }
    if (el("a,button,input,select,textarea,label,summary")) return;
    const op = el("[data-open]"); if (op && !el(".cm-dr")) return openDr(op.dataset.open);
  }
})();
