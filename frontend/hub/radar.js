// Radar (#/radar, 03 · Negócios): a máquina de prospeção. Um ramo e uma zona: o Hub encontra os negócios (mapa, e o Google
// se houver chave), procura o site de cada um, audita-o, estima o que gasta com o digital pelo que o site mostra e ordena
// tudo por oportunidade, cada problema com a solução que vendemos (backend/app/radar.py). As peças por fazer estão à vista
// em «A máquina». A página segue docs/hub-paginas.md; classes rd-.
(function () {
  let S = null, cur = null, open = "", timer = 0;
  const KEY = "radar.cur";
  const eur = (v) => `${Number(v).toLocaleString("pt-PT")} €`;
  const day = (ts) => new Date(ts * 1000).toLocaleDateString("pt-PT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  const host = (u) => { try { return new URL(u).host.replace(/^www\./, ""); } catch { return u; } };
  const SEG_TONE = { por_contactar: "off", contactado: "wait", respondeu: "ai", reuniao: "busy", fechou: "ok", nao: "bad" };
  const NIVEL = { quente: ["bad", "Quente"], morna: ["wait", "Morna"], fria: ["off", "Fria"] };

  // as peças da máquina: o que já trabalha e o que vem a seguir
  const PECAS = [
    ["Encontrar", "Todos os negócios do ramo na zona, pelo mapa (e pelo Google com chave).", "ok"],
    ["Achar o site", "Procura o site de cada um pelo nome, fora de diretórios e redes.", "ok"],
    ["Auditar", "Telemóvel, velocidade, cadeado, WhatsApp, inscrição, SEO, opiniões, redes, medição.", "ok"],
    ["Gasto estimado", "Plataforma, agência e tags de anúncios a preços de mercado.", "ok"],
    ["Concorrência", "Que plataformas e que agências servem a zona.", "ok"],
    ["Mensagem", "Uma mensagem curta por negócio com os problemas dele, pronta a copiar.", "ok"],
    ["Nota no Google", "Estrelas e opiniões de cada um: precisa de GOOGLE_PLACES_KEY.", "wait"],
    ["Diagnóstico em PDF", "Uma ou duas páginas por negócio, para mandar com a mensagem.", "ok"],
    ["Seguimento", "Quem foi contactado, quem respondeu, quem fechou, com notas.", "ok"],
    ["Dossiê com amostras", "O site e o Instagram refeitos em imagens para os quentes (skill dossie-crescimento).", "off"],
  ];

  HUB_VIEWS.radar = async function () {
    cur = cur || (() => { try { return localStorage.getItem(KEY); } catch { return null; } })();
    page(`<div class="rd" id="rd">
      ${ui.head("Negócios", t("Radar"), t("Encontra os negócios de uma zona, abre o site de cada um, vê o que está mal e quanto gastam, e diz-te por onde começar."),
        `<div class="rd-ctl" id="rd-ctl"></div>`)}
      <div class="rd-msg" id="rd-msg" hidden></div>
      <section class="panel pad rd-form" id="rd-form"></section>
      <div id="rd-seg"></div>
      <div id="rd-scan"></div>
      ${ui.sec("A máquina", `<small class="rd-sr">${esc(t("o que já trabalha e o que vem a seguir"))}</small>`)}
      <div class="rd-pecas">${PECAS.map(([n, d, st], i) => `<div class="panel rd-peca ${st}"><span class="rd-pn">${String(i + 1).padStart(2, "0")}</span>
        <b>${esc(t(n))}</b><p>${esc(t(d))}</p><span class="st ${st}"><i></i>${esc(t(st === "ok" ? "A trabalhar" : st === "wait" ? "Falta a chave" : "A seguir"))}</span></div>`).join("")}</div>
      <div id="rd-hist"></div>
    </div>`);
    $("rd").onclick = click;
    await load().catch((e) => paint($("rd-scan"), ui.error(e.message)));
  };

  async function load() {
    S = await api("/api/radar");
    paintForm(); paintHist(); paintSeg();
    if (cur && !S.varreduras.some((v) => v.id === cur)) cur = null;
    cur = cur || S.varreduras[0]?.id || null;
    await loadScan();
  }

  async function loadScan() {
    if (!cur) { paintCtl(null); paint($("rd-scan"), ""); return; }
    const sc = await api(`/api/radar/${cur}`);
    paintCtl(sc); paintScan(sc);
    clearTimeout(timer);
    if (sc.job) timer = setTimeout(() => { if ($("rd") && !document.hidden) loadScan().catch(() => {}); else if ($("rd")) timer = setTimeout(loadScan, 3000); }, 2500);
    else if (S.varreduras.find((v) => v.id === cur)?.job) { S = await api("/api/radar"); paintHist(); }
  }

  function msg(text) {
    const el = $("rd-msg");
    if (!el) return;
    el.hidden = false; el.textContent = text;
    clearTimeout(msg.t); msg.t = setTimeout(() => { el.hidden = true; }, 5000);
  }

  function paintCtl(sc) {
    const chip = sc?.job ? `<span class="st busy"><i></i>${esc(t("A varrer · {f}", { f: t(sc.job.fase) }))}</span>`
      : sc ? `<span class="st ok"><i></i>${esc(t("Última: {d}", { d: day(sc.fim || sc.at) }))}</span>` : `<span class="st off"><i></i>${esc(t("Ainda sem varreduras"))}</span>`;
    paint($("rd-ctl"), `${chip}<button type="button" class="btn primary" data-act="focus">${icon("search")}${esc(t("Nova varredura"))}</button>`);
  }

  function paintForm() {
    if ($("rd-form")._html) return;
    const ramos = Object.entries(S.ramos).map(([k, v]) => `<option value="${k}">${esc(t(v))}</option>`).join("");
    paint($("rd-form"), `<form class="rd-f" id="rd-f">
      <label class="field"><span>${esc(t("Ramo"))}</span><select name="ramo">${ramos}</select></label>
      <label class="field rd-zona"><span>${esc(t("Zona"))}</span><input name="local" placeholder="${esc(t("Ex.: Leiria, Rio Maior, Lisboa"))}" autocomplete="off"></label>
      <label class="field"><span>${esc(t("Raio"))}</span><select name="raio">${[5, 10, 20, 30, 50].map((r) => `<option value="${r}" ${r === 20 ? "selected" : ""}>${r} km</option>`).join("")}<option value="0">${esc(t("Distrito inteiro"))}</option></select></label>
      <button class="btn primary rd-go" type="submit">${icon("search")}${esc(t("Varrer a zona"))}</button>
      <details class="rd-lista"><summary>${esc(t("Ou colar uma lista (nome | site, uma por linha)"))}</summary>
        <label class="field"><textarea name="lista" placeholder="Gato Preto | \nVia Dinâmica | https://…"></textarea></label></details>
    </form>`);
    const f0 = $("rd-f"), dist = f0.raio.querySelector('[value="0"]');
    f0.ramo.onchange = () => { dist.hidden = f0.ramo.value !== "escolas"; if (dist.hidden && f0.raio.value === "0") f0.raio.value = "20"; };
    f0.ramo.onchange();
    $("rd-f").onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      try {
        const sc = await api("/api/radar", { method: "POST", body: { ramo: f.get("ramo"), local: f.get("local"), raio: Number(f.get("raio")), lista: f.get("lista") || "" } });
        cur = sc.id; try { localStorage.setItem(KEY, cur); } catch {}
        open = "";
        S = await api("/api/radar"); paintHist(); await loadScan();
      } catch (err) { msg(err.message); }
    };
  }

  function paintScan(sc) {
    const r = sc.resumo || {}, job = sc.job, negs = sc.negocios || [];
    const where = `${sc.ramo_nome} · ${sc.local || t("lista colada")}${sc.local ? ` · ${sc.raio ? `${sc.raio} km` : t("distrito de {d}", { d: sc.distrito || sc.local })}` : ""}`;
    const kpi = (l, v, sub = "") => `<div class="panel bd-kpi"><span class="bd-l">${esc(t(l))}</span>${ui.num(v)}${sub ? `<small class="faint">${esc(sub)}</small>` : ""}</div>`;
    const done = !job && r.total != null;
    let html = ui.sec(where, `<small class="rd-sr">${esc((sc.fontes || []).join(" · "))}</small>`);
    if (job) {
      const pct = job.total ? Math.round(100 * job.feitos / job.total) : 4;
      html += `<section class="panel pad rd-job"><b>${esc(t(job.fase))}</b><span>${job.total ? `${job.feitos} / ${job.total}` : ""}</span>${ui.progress(pct)}
        <p>${esc(t("Os sites abrem-se um a um com calma, para ninguém nos bloquear. Uma zona leva 1 a 4 minutos."))}</p></section>`;
    }
    if (sc.erro) html += `<div class="rd-msg">${esc(sc.erro)}</div>`;
    html += `<div class="bd-kpis rd-kpis">
      ${kpi("Negócios", done ? String(r.total) : null)}
      ${kpi("Sem site", done ? String(r.sem_site) : null, done && r.total ? t("{p}% da zona", { p: Math.round(100 * r.sem_site / r.total) }) : "")}
      ${kpi("Quentes", done ? String(r.quentes) : null, done ? t("por onde começar") : "")}
      ${kpi("Nota mediana dos sites", done && r.nota_mediana != null ? `${r.nota_mediana}<small>/100</small>` : null)}
      ${kpi("Gasto da zona", done ? `${eur(r.gasto_zona[0])}–${eur(r.gasto_zona[1])}` : null, done ? t("por mês, estimado") : "")}
    </div>`;
    if (done && negs.length) html += market(sc) + ranking(negs);
    else if (done) html += `<section class="panel">${ui.empty("search", "Nada nesta zona", "O mapa não tem negócios deste ramo aqui. Alarga o raio ou cola uma lista.")}</section>`;
    paint($("rd-scan"), html);
  }

  function market(sc) {
    const m = sc.mercado || {}, r = sc.resumo, tot = Math.max(1, r.com_site - r.em_baixo);
    const plats = (m.plataformas || []).map(([p, n]) => `<div class="rd-bar"><span>${esc(t(p))}</span>${ui.progress(100 * n / tot)}<b>${n}</b></div>`).join("")
      || `<p class="rd-none">${esc(t("Nenhum site aberto."))}</p>`;
    const ags = (m.agencias || []).map(([a, ns]) => `<li><b>${esc(a)}</b><span>${esc(ns.join(", "))}</span></li>`).join("");
    return `${ui.sec("A zona")}<div class="rd-zone">
      <section class="panel pad"><h4 class="rd-h">${esc(t("Em que estão feitos os sites"))}</h4>${plats}</section>
      <section class="panel pad"><h4 class="rd-h">${esc(t("Quem faz os sites aqui"))}</h4>${ags ? `<ul class="rd-ags">${ags}</ul>` : `<p class="rd-none">${esc(t("Nenhum site assina a agência no rodapé."))}</p>`}
        ${(m.redes || []).length ? `<h4 class="rd-h">${esc(t("Redes e fornecedores"))}</h4><ul class="rd-ags">${m.redes.map(([h, ns]) => `<li><b>${esc(h)}</b><span>${esc(t("{n} negócios: {l}", { n: ns.length, l: ns.join(", ") }))}</span></li>`).join("")}</ul>` : ""}
        <h4 class="rd-h">${esc(t("Anúncios"))}</h4><p class="rd-none">${esc(t("{n} de {t} têm tags de anúncios no site (Google, Meta ou TikTok).", { n: r.anuncios, t: r.total }))}</p></section>
    </div>`;
  }

  function ranking(negs) {
    return `${ui.sec("Por oportunidade", `<small class="rd-sr">${esc(t("site fraco + já gasta + boa reputação = cliente"))}</small>`)}
      <section class="panel rd-list">${negs.map((n, i) => row(n, i)).join("")}</section>
      <p class="rd-note">${esc(t("Como chegámos a isto: só o que o site público mostra hoje. O gasto é uma estimativa a preços de mercado pelo que se vê (plataforma, crédito de agência, tags de anúncios), não a fatura deles."))}</p>`;
  }

  function row(n, i) {
    const a = n.audit || {}, [tone, lbl] = NIVEL[n.nivel] || NIVEL.fria, g = n.gasto || {};
    const site = n.site ? (a.erro ? `<span class="rd-bad">${esc(t("site em baixo"))}</span>` : `<span>${esc(host(a.final || n.site))}</span>`)
      : `<span class="rd-bad">${esc(n.facebook ? t("só Facebook") : t("sem site"))}</span>`;
    const isOpen = open === n.id;
    return `<div class="rd-row ${isOpen ? "open" : ""}">
      <button type="button" class="rd-line" data-row="${n.id}">
        <span class="rd-rank">${i + 1}</span>
        <span class="rd-name"><b>${esc(n.nome)}</b><small>${site}${a.plataforma ? ` · ${esc(a.plataforma)}` : ""}${n.morada ? ` · ${esc(n.morada)}` : ""}</small></span>
        <span class="rd-score" title="${esc(t("Nota do site"))}">${ui.progress(n.nota_site, n.nota_site < 40 ? "bad" : n.nota_site < 70 ? "warn" : "ok")}<small>${n.nota_site}</small></span>
        <span class="rd-eur">${g.max ? `${g.min}–${g.max} €` : "—"}</span>
        ${n.lead && n.lead.estado !== "por_contactar" ? `<span class="st ${SEG_TONE[n.lead.estado]}"><i></i>${esc(t(S.estados[n.lead.estado]))}</span>`
          : `<span class="st ${tone}"><i></i>${esc(t(lbl))} · ${n.oportunidade}</span>`}
      </button>
      ${isOpen ? detail(n) : ""}
    </div>`;
  }

  function detail(n) {
    const a = n.audit || {}, g = n.gasto || {};
    const probs = (n.problemas || []).map((p) => `<li><p>${esc(p.problema)}</p><span>${icon("tick")}${esc(p.solucao)}</span></li>`).join("");
    const contact = [
      n.telefone && `<a class="btn sm" href="tel:${esc(n.telefone.replace(/\s/g, ""))}">${esc(n.telefone)}</a>`,
      ...(a.emails || (n.email ? [n.email] : [])).map((e) => `<a class="btn sm" href="mailto:${esc(e)}">${esc(e)}</a>`),
      n.site && `<a class="btn sm" href="${esc(a.final || n.site)}" target="_blank" rel="noopener">${icon("link")}${esc(t("Site"))}</a>`,
      n.facebook && `<a class="btn sm" href="${esc(n.facebook)}" target="_blank" rel="noopener">Facebook</a>`,
      n.maps ? `<a class="btn sm" href="${esc(n.maps)}" target="_blank" rel="noopener">Google Maps</a>`
        : n.lat ? `<a class="btn sm" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(n.nome)}%20${n.lat},${n.lon}" target="_blank" rel="noopener">${esc(t("Mapa"))}</a>` : "",
    ].filter(Boolean).join("");
    return `<div class="rd-det">
      <div class="rd-col">
        <h4 class="rd-h">${esc(t("O que está mal e o que fazemos"))}</h4>
        ${probs ? `<ol class="rd-probs">${probs}</ol>` : `<p class="rd-none">${esc(t("Nada de grave: o site está bem feito."))}</p>`}
        ${n.bons?.length ? `<h4 class="rd-h">${esc(t("O que já está bem"))}</h4><ul class="rd-bons">${n.bons.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>` : ""}
      </div>
      <div class="rd-col">
        <h4 class="rd-h">${esc(t("Gasto estimado"))} ${ui.src("estimated")}</h4>
        <p class="rd-big">${g.max ? `${g.min}–${g.max} <small>€/mês</small>` : `<small>${esc(t("Nada pago à vista"))}</small>`}</p>
        ${(g.porque || []).length ? `<ul class="rd-why">${g.porque.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
        ${a.segundos != null ? `<p class="rd-none">${esc(t("Abriu em {s} s · {kb} kB · {h}", { s: a.segundos, kb: a.kb, h: a.https ? "https" : "sem https" }))}${a.copyright ? ` · © ${a.copyright}` : ""}</p>` : ""}
        ${n.site_achado ? `<p class="rd-none">${esc(t("Site achado pela pesquisa do nome: confirma antes de usar."))}</p>` : ""}
        <h4 class="rd-h">${esc(t("Contacto"))}</h4>
        <div class="rd-contact">${contact || `<span class="rd-none">${esc(t("Sem contacto no mapa nem no site."))}</span>`}</div>
        <div class="rd-acts">
          <button type="button" class="btn primary" data-copy="${n.id}">${icon("doc")}${esc(t("Copiar mensagem"))}</button>
          <a class="btn" href="/api/radar/${cur}/${n.id}/pdf?token=${encodeURIComponent(token)}" target="_blank" rel="noopener">${icon("doc")}${esc(t("Diagnóstico em PDF"))}</a>
        </div>
        <h4 class="rd-h">${esc(t("Seguimento"))}</h4>
        <div class="rd-seg-st">${Object.entries(S.estados).map(([k, v]) => `<button type="button" class="rd-pill ${(n.lead?.estado || "por_contactar") === k ? "on " + SEG_TONE[k] : ""}" data-lead="${n.id}" data-st="${k}">${esc(t(v))}</button>`).join("")}</div>
        <textarea class="inp rd-nota" data-nota="${n.id}" placeholder="${esc(t("Notas: com quem falaste, o que disse, quando voltar a ligar"))}">${esc(n.lead?.nota || "")}</textarea>
        ${n.lead?.por ? `<p class="rd-none">${esc(t("Mudado por {p} · {d}", { p: n.lead.por, d: day(n.lead.at) }))}</p>` : ""}
      </div>
    </div>`;
  }

  // a primeira mensagem: tratamento por «você», sem travessões, só o que se viu (regras do Fábio)
  function message(n) {
    const top = (n.problemas || []).slice(0, 2);
    const what = n.site ? "Estive a ver o vosso site e reparei em duas coisas que estão a afastar clientes:" : "Procurei a vossa escola no Google e reparei numa coisa que está a afastar clientes:";
    const lines = top.map((p) => `• ${p.problema}`).join("\n");
    return `Olá, boa tarde.\n\n${what}\n${lines}\n\nTrabalhamos só com ${S.ramos[n.__ramo] ? S.ramos[n.__ramo].toLowerCase() : "negócios locais"} e resolvemos isto em poucos dias: ${top.map((p) => p.solucao.charAt(0).toLowerCase() + p.solucao.slice(1).replace(/\.$/, "")).join(" e ")}.\n\nPosso mostrar-lhe em 15 minutos como ficaria? Sem compromisso.`;
  }

  async function click(e) {
    const b = e.target.closest("[data-act],[data-row],[data-copy],[data-scan],[data-del],[data-retry],[data-lead],[data-seg]");
    if (!b) return;
    if (b.dataset.retry != null) return load().catch(() => {});
    if (b.dataset.act === "focus") { $("rd-f").local.focus(); $("rd-form").scrollIntoView({ behavior: "smooth", block: "center" }); return; }
    if (b.dataset.row) { open = open === b.dataset.row ? "" : b.dataset.row; return loadScan(); }
    if (b.dataset.scan) { cur = b.dataset.scan; open = ""; try { localStorage.setItem(KEY, cur); } catch {} await loadScan(); paintHist(); $("rd-scan").scrollIntoView({ behavior: "smooth" }); return; }
    if (b.dataset.del) {
      if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = t("Apagar?"); return; }
      try { await api(`/api/radar/${b.dataset.del}`, { method: "DELETE" }); } catch (err) { return msg(err.message); }
      if (cur === b.dataset.del) cur = null;
      return load();
    }
    if (b.dataset.lead) return saveLead(b.dataset.lead, b.dataset.st);
    if (b.dataset.seg) { const [sid, nid] = b.dataset.seg.split("/"); cur = sid; open = nid; try { localStorage.setItem(KEY, cur); } catch {} await loadScan(); paintHist(); document.querySelector(".rd-row.open")?.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
    if (b.dataset.copy) {
      const sc = await api(`/api/radar/${cur}`);
      const n = sc.negocios.find((x) => x.id === b.dataset.copy);
      if (!n) return;
      n.__ramo = sc.ramo;
      try { await navigator.clipboard.writeText(message(n)); msg(t("Mensagem copiada: revê antes de enviar.")); } catch { msg(t("O browser não deixou copiar.")); }
    }
  }

  function paintHist() {
    const vs = S.varreduras || [];
    if (!vs.length) { paint($("rd-hist"), ""); return; }
    paint($("rd-hist"), `${ui.sec("Varreduras")}<section class="panel rd-hist">${vs.map((v) => `<div class="rd-h-row ${v.id === cur ? "on" : ""}">
      <button type="button" class="rd-h-open" data-scan="${v.id}"><b>${esc(v.ramo_nome)} · ${esc(v.local || t("lista"))}</b>
        <small>${esc(day(v.at))}${v.job ? ` · ${esc(t("a correr"))}` : v.resumo?.total != null ? ` · ${t("{n} negócios, {q} quentes", { n: v.resumo.total, q: v.resumo.quentes })}` : ""}</small></button>
      ${v.job ? "" : `<button type="button" class="btn quiet sm" data-del="${v.id}">${esc(t("Apagar"))}</button>`}</div>`).join("")}</section>`);
  }

  async function saveLead(nid, estado, nota) {
    try {
      await api(`/api/radar/${cur}/${nid}/lead`, { method: "POST", body: nota == null ? { estado } : { estado, nota } });
    } catch (err) { return msg(err.message); }
    S = await api("/api/radar"); paintSeg(); await loadScan();
  }

  // as notas guardam-se ao sair da caixa
  document.addEventListener("focusout", (e) => {
    const el = e.target.closest?.("[data-nota]");
    if (!el || !$("rd")) return;
    const st = document.querySelector(`[data-lead="${el.dataset.nota}"].on`)?.dataset.st || "por_contactar";
    saveLead(el.dataset.nota, st, el.value);
  });

  // o seguimento de todas as varreduras: quantos em cada passo e os que estão em jogo
  function paintSeg() {
    const ls = S.seguimento || [];
    if (!ls.length) { paint($("rd-seg"), ""); return; }
    const count = (k) => ls.filter((l) => l.estado === k).length;
    const live = ls.filter((l) => ["contactado", "respondeu", "reuniao"].includes(l.estado));
    paint($("rd-seg"), `${ui.sec("Seguimento", `<small class="rd-sr">${esc(t("de todas as varreduras"))}</small>`)}
      <div class="bd-kpis rd-kpis rd-segk">${["contactado", "respondeu", "reuniao", "fechou", "nao"].map((k) =>
        `<div class="panel bd-kpi"><span class="bd-l">${esc(t(S.estados[k]))}</span>${ui.num(String(count(k)))}</div>`).join("")}</div>
      ${live.length ? `<section class="panel rd-hist">${live.map((l) => `<div class="rd-h-row"><button type="button" class="rd-h-open" data-seg="${l.sid}/${l.nid}">
        <b>${esc(l.nome)}</b><small>${esc(t(S.estados[l.estado]))} · ${esc(day(l.at))}${l.telefone ? ` · ${esc(l.telefone)}` : ""}${l.nota ? ` · ${esc(l.nota.slice(0, 90))}` : ""}</small></button>
        <span class="st ${SEG_TONE[l.estado]}"><i></i>${esc(l.local || "")}</span></div>`).join("")}</section>` : ""}`);
  }
})();
