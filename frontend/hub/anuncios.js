// Anúncios em alta (#/anuncios, 03 · Negócios; backend/app/routers/anuncios.py, motor ads-radar/adsradar.py). Pedido do David a
// 25 nov: «em cada país, encontrar a publicidade que começou há pouco e aguenta mais de 2 dias: quer dizer que o produto está a
// vender». O coletor lê a Biblioteca de Anúncios da Meta (Uzbequistão, Portugal, Ucrânia; mais países nas Pesquisas) e o Hub
// junta os anúncios por anunciante + site, com nota 0-100 (dias no ar, cópias do criativo, lugar nas impressões, quantos
// anúncios), categoria (finanças, loja, cursos...) e risco (burla / zona cinzenta à parte, com o porquê).
(function () {
  let D = null, pais = localStorage.getItem("an-pais") || "", janela = localStorage.getItem("an-jan") || "2-14",
    risco = localStorage.getItem("an-risco") || "limpo", cat = "", aberto = "", vista = "alta", busca = "";
  const JANELAS = { "2-14": ["Começou há 2–14 dias", 2, 14], "7-30": ["Aguenta 7+ dias", 7, 30], "0-2": ["Acabou de sair", 0, 2], "2-90": ["Tudo ativo", 2, 90] };
  const RISCO = { limpo: "Limpos", todos: "Todos", burla: "Só suspeitos" };
  const NIVEL = { limpo: ["Limpo", "ok"], atencao: ["Atenção", "warn"], burla: ["Provável burla", "bad"] };
  const CURTO = { apostas: "Apostas", cripto: "Cripto", credito: "Banca", cursos: "Cursos", apps: "Apps", beleza: "Beleza", imobiliario: "Casas",
    auto: "Auto", viagens: "Viagem", comida: "Comida", emprego: "Renda", loja: "Loja", servicos: "Serviço", outros: "Outros" };
  const BAND = { UZ: "🇺🇿", PT: "🇵🇹", UA: "🇺🇦" };
  const band = (p) => BAND[p] || (p && p.length === 2 ? String.fromCodePoint(...[...p].map((c) => 127397 + c.charCodeAt(0))) : "");
  const n = (v) => (v == null ? "—" : Number(v).toLocaleString("pt-PT"));
  const kfmt = (v) => (v == null ? "" : v >= 1e6 ? `${(v / 1e6).toFixed(1)} M` : v >= 1e3 ? `${Math.round(v / 1e3)} mil` : String(v));
  const metaLink = (id) => `https://www.facebook.com/ads/library/?id=${encodeURIComponent(id)}`;
  const data = (s) => new Date(s * 1000).toLocaleDateString("pt-PT", { day: "2-digit", month: "short" });
  const catNome = (k) => (D && D.categorias[k]) || k;

  HUB_VIEWS.anuncios = async function () {
    page(`<div class="an" id="an">
      ${ui.head("Negócios", t("Anúncios em alta"), t("O que começou há pouco na Meta e continua no ar: alguém paga por ele, por isso vende. Por país, categoria e risco."),
        `<div class="an-ctl" id="an-ctl"></div>`)}
      <div class="an-msg" id="an-msg" hidden></div>
      <div id="an-body">${ui.skeleton(4)}</div>
    </div>`);
    $("an").addEventListener("click", onClick);
    $("an").addEventListener("input", (e) => { if (e.target.id === "an-q") { busca = e.target.value.toLowerCase(); drawLista(); } });
    await load();
    schedule();
  };

  function schedule() {
    clearTimeout(schedule.t);
    schedule.t = setTimeout(async () => { if (!$("an")) return; if (D && (D.a_correr || D.ligado)) await load(true); schedule(); }, 30000);
  }

  async function load(quiet = false) {
    const [, a, b] = JANELAS[janela] || JANELAS["2-14"];
    try {
      D = await api(`/api/anuncios?pais=${encodeURIComponent(pais)}&min_dias=${a}&max_dias=${b}`);
      draw();
    } catch (e) { if (!quiet) paint($("an-body"), ui.error(e.message)); }
  }

  function msg(text) {
    const el = $("an-msg"); if (!el) return;
    el.hidden = false; el.textContent = text; clearTimeout(msg.t); msg.t = setTimeout(() => { el.hidden = true; }, 7000);
  }

  function paintCtl() {
    const st = D.estado || {}, err = st.erro;
    const corre = D.a_correr && st.fase && st.fase !== "parado";
    const chip = `<span class="an-state ${err ? "bad" : corre ? "ok" : D.ligado ? "wait" : ""}"><i></i>${esc(err ? t("Com erro") : corre ? t("A ler · {f}", { f: st.fase }) : D.ligado ? t("Ligado · a cada {h} h", { h: D.intervalo_h }) : t("Desligado"))}</span>`;
    const agora = `<button type="button" class="btn quiet" data-act="agora" ${corre ? "disabled" : ""}>${icon("search")}${esc(t("Ler agora"))}</button>`;
    const btn = D.ligado ? `<button type="button" class="btn quiet" data-act="off">${icon("stop")}${esc(t("Desligar"))}</button>`
      : `<button type="button" class="btn primary" data-act="on">${icon("play")}${esc(t("Ligar o radar"))}</button>`;
    paint($("an-ctl"), chip + agora + btn);
  }

  function filtrados() {
    return D.grupos.filter((g) => (risco === "todos" || (risco === "limpo" ? g.nivel !== "burla" : g.nivel !== "limpo"))
      && (!cat || g.categoria === cat)
      && (!busca || `${g.pagina} ${g.dominio} ${g.exemplo.texto} ${g.exemplo.titulo}`.toLowerCase().includes(busca)));
  }

  function draw() {
    paintCtl();
    if (D.vazio) return paint($("an-body"), ui.empty("target", t("Ainda não há anúncios lidos"),
      t("Liga o radar: um Chrome sem janela lê a Biblioteca de Anúncios da Meta em {p}, de {h} em {h} horas. A 1.ª volta demora ~15 min.",
        { p: Object.values(D.paises).map((x) => x.nome).join(", "), h: D.intervalo_h }),
      `<button type="button" class="btn primary" data-act="on">${icon("play")}${esc(t("Ligar o radar"))}</button>`));
    const G = D.grupos, F = filtrados();
    const semana = G.filter((g) => g.dias >= 7 && g.nivel !== "burla").length;
    const sus = G.filter((g) => g.nivel === "burla").length;
    const lidos = Object.values(D.por_pais).reduce((s, x) => s + x.total, 0);
    const porCat = {};
    G.filter((g) => g.nivel !== "burla").forEach((g) => { porCat[g.categoria] = (porCat[g.categoria] || 0) + 1; });
    const cats = Object.entries(porCat).sort((a, b) => b[1] - a[1]);
    const melhor = F[0];
    paint($("an-body"), `
      <div class="an-filtros">
        <div class="segx">${[["", "Todos"], ...Object.entries(D.paises).map(([k, v]) => [k, v.nome])].map(([k, l]) => `<button type="button" data-pais="${k}" class="${k === pais ? "on" : ""}">${k ? band(k) + " " : ""}${esc(t(l))}</button>`).join("")}</div>
        <div class="segx">${Object.entries(JANELAS).map(([k, v]) => `<button type="button" data-jan="${k}" class="${k === janela ? "on" : ""}">${esc(t(v[0]))}</button>`).join("")}</div>
        <div class="segx">${Object.entries(RISCO).map(([k, v]) => `<button type="button" data-risco="${k}" class="${k === risco ? "on" : ""}">${esc(t(v))}</button>`).join("")}</div>
      </div>
      ${ui.kpis([
        ui.kpi({ label: t("Em alta"), value: n(G.filter((g) => g.nivel !== "burla").length), sub: t("anunciantes com anúncios a aguentar"), viz: ui.cols(D.por_dia) , hint: t("Anúncios novos por dia de arranque, últimos 21 dias") }),
        ui.kpi({ label: t("Aguentam 7+ dias"), value: n(semana), sub: t("procura confirmada") }),
        ui.kpi({ label: t("Prováveis burlas"), value: n(sus), sub: t("à parte, com o porquê"), cls: sus ? "pn-plain" : "" }),
        ui.kpi({ label: t("Anúncios lidos"), value: n(lidos), sub: D.estado.ultima_volta ? t("última volta {d}", { d: fmt.ago(new Date(D.estado.ultima_volta.replace(" ", "T")).toISOString()) }) : t("ainda nenhuma volta inteira") }),
      ])}
      <div class="pn-split">
        <div class="panel pad"><div class="pn-card-h"><b>${esc(t("O que está a vender"))}</b><small>${esc(t("anunciantes em alta por categoria"))}</small></div>
          ${cats.length ? ui.bars(cats.slice(0, 7).map(([k, v]) => ({ label: t(CURTO[k] || k), value: v, tip: `${catNome(k)}: ${v}` })), { hi: 0 }) : ui.num(null)}</div>
        <div class="panel pad"><div class="pn-card-h"><b>${esc(t("Mais forte agora"))}</b><small>${esc(t("nota mais alta com os filtros"))}</small></div>
          ${melhor ? destaque(melhor) : `<p class="an-dim">${esc(t("Nada com estes filtros."))}</p>`}</div>
      </div>
      ${porPais()}
      ${ui.sec("Em alta agora", `<input id="an-q" class="an-q" placeholder="${esc(t("Procurar marca, site, texto…"))}" value="${esc(busca)}">`)}
      <div class="an-cats"><button type="button" data-cat="" class="${!cat ? "on" : ""}">${esc(t("Todas"))}</button>${cats.map(([k, v]) => `<button type="button" data-cat="${k}" class="${k === cat ? "on" : ""}">${esc(t(catNome(k)))} <i>${v}</i></button>`).join("")}</div>
      <div id="an-lista"></div>
      ${ui.sec("Pesquisas")}
      ${pesquisas()}
      ${ui.sec("Últimas leituras")}
      ${voltas()}`);
    drawLista();
  }

  function destaque(g) {
    return `<div class="an-hero" data-abrir="${esc(chave(g))}">
      ${g.exemplo.imagem ? `<img src="${esc(g.exemplo.imagem)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ""}
      <div><b>${band(g.pais)} ${esc(g.pagina || g.dominio)}</b><span class="an-dim">${esc(t(catNome(g.categoria)))} · ${esc(g.dominio || "")}</span>
      <p>${esc(t("{d} dias no ar · {c} cópias · {a} anúncios", { d: Math.floor(g.dias), c: g.copias, a: g.anuncios }))}</p></div>
      <div class="an-nota big">${g.nota}</div></div>`;
  }

  function porPais() {
    const ps = Object.keys(D.paises).filter((p) => !pais || p === pais);
    const cols = ps.map((p) => {
      const gs = D.grupos.filter((g) => g.pais === p && g.nivel !== "burla");
      const sc = {};
      gs.forEach((g) => { sc[g.categoria] = (sc[g.categoria] || 0) + g.nota; });
      const top = Object.entries(sc).sort((a, b) => b[1] - a[1]).slice(0, 4);
      const pp = D.por_pais[p] || {};
      return `<div class="panel pad an-pais"><div class="pn-card-h"><b>${band(p)} ${esc(t(D.paises[p].nome))}</b><small>${esc(t("{n} lidos · {a} ativos", { n: n(pp.total), a: n(pp.ativos) }))}</small></div>
        ${top.length ? `<ol>${top.map(([k]) => { const g = gs.filter((x) => x.categoria === k)[0];
          return `<li data-abrir="${esc(chave(g))}"><span>${esc(t(catNome(k)))}</span><small>${esc(g.pagina || g.dominio)}</small></li>`; }).join("")}</ol>` : `<p class="an-dim">${esc(t("Sem dados"))}</p>`}</div>`;
    });
    return `${ui.sec("A tendência em cada país")}<div class="an-paises">${cols.join("")}</div>`;
  }

  const chave = (g) => `${g.pais}|${g.pagina_id || ""}|${g.dominio || ""}`;

  function cartao(g) {
    const [nv, cls] = NIVEL[g.nivel], e = g.exemplo, k = chave(g);
    return `<article class="panel an-card ${aberto === k ? "open" : ""}" data-k="${esc(k)}">
      <div class="an-img">${e.imagem ? `<img src="${esc(e.imagem)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span>${icon("doc")}</span>`}</div>
      <div class="an-main">
        <div class="an-top"><b>${band(g.pais)} ${esc(g.pagina || "—")}</b>${g.gostos != null ? `<small>${esc(kfmt(g.gostos))} ${esc(t("gostos"))}</small>` : ""}
          ${ui.tag(t(catNome(g.categoria)))}${ui.tag(t(nv), cls)}</div>
        <div class="an-facts"><span>${icon("clock")}${esc(t("{d} dias no ar (desde {s})", { d: Math.floor(g.dias), s: data(g.inicio) }))}</span>
          <span>${icon("layers")}${esc(t("{c} cópias · {a} anúncios", { c: g.copias, a: g.anuncios }))}</span>
          <span>${icon("trend")}${esc(t("#{p} nas impressões", { p: g.melhor_pos }))}</span></div>
        ${e.titulo ? `<h4>${esc(e.titulo)}</h4>` : ""}
        <p class="an-txt">${esc((e.texto || "").slice(0, aberto === k ? 1500 : 220))}</p>
        ${g.risco_porque.length ? `<ul class="an-why">${g.risco_porque.map((x) => `<li>${icon("alert")}${esc(t(x))}</li>`).join("")}</ul>` : ""}
        <div class="an-acts">
          <a class="btn sm" href="${metaLink(e.id)}" target="_blank" rel="noopener">${icon("link")}${esc(t("Ver na Meta"))}</a>
          ${g.link ? `<a class="btn sm quiet" href="${esc(g.link)}" target="_blank" rel="noopener noreferrer">${esc(g.dominio || t("Site"))}</a>` : ""}
          <button type="button" class="btn sm quiet" data-abrir="${esc(k)}">${esc(t(aberto === k ? "Fechar" : "Todos os anúncios"))}</button>
          ${e.cta ? `<span class="an-dim">${esc(e.cta)}</span>` : ""}
        </div>
        ${aberto === k ? `<div class="an-grupo" id="an-grupo">${ui.skeleton(1)}</div>` : ""}
      </div>
      <div class="an-nota" title="${esc(t("Nota 0-100: dias no ar, cópias do criativo, lugar nas impressões, quantos anúncios"))}">${g.nota}</div>
    </article>`;
  }

  function drawLista() {
    const el = $("an-lista"); if (!el) return;
    const F = filtrados();
    paint(el, F.length ? `<div class="an-list">${F.slice(0, 120).map(cartao).join("")}</div>${F.length > 120 ? `<p class="an-dim">${esc(t("+{n} com nota mais baixa", { n: F.length - 120 }))}</p>` : ""}`
      : ui.empty("search", t("Nada com estes filtros"), t("Experimenta outra janela de dias, outro país ou «Todos» no risco.")));
    if (aberto) abrirGrupo(aberto);
  }

  async function abrirGrupo(k) {
    const [p, pid, dom] = k.split("|");
    try {
      const r = await api(`/api/anuncios/grupo?pais=${p}&pagina_id=${encodeURIComponent(pid)}&dominio=${encodeURIComponent(dom)}`);
      const el = $("an-grupo"); if (!el) return;
      paint(el, `<div class="an-mini">${r.anuncios.map((a) => `<a href="${metaLink(a.id)}" target="_blank" rel="noopener" class="${a.ativo ? "" : "off"}">
        ${a.imagem ? `<img src="${esc(a.imagem)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span>${icon("doc")}</span>`}
        <small>${esc(data(a.inicio))} · ${esc(a.ativo ? t("ativo") : t("parou"))}${a.copias > 1 ? ` · x${a.copias}` : ""}</small></a>`).join("")}</div>`);
    } catch (e) { const el = $("an-grupo"); if (el) paint(el, ui.error(e.message)); }
  }

  function pesquisas() {
    return `<div class="an-pq">${Object.entries(D.paises).map(([k, v]) => `<div class="panel pad" data-pq="${k}">
        <div class="pn-card-h"><b>${band(k)} ${esc(t(v.nome))}</b>
          <button type="button" class="an-sw ${v.ligado ? "on" : ""}" data-ligpais="${k}" role="switch" aria-checked="${v.ligado}"><i></i>${esc(t(v.ligado ? "Ligado" : "Desligado"))}</button></div>
        <textarea rows="4" spellcheck="false">${esc(v.pesquisas.map((x) => x || "(todos)").join("\n"))}</textarea>
        <div class="an-acts"><button type="button" class="btn sm" data-guardar="${k}">${esc(t("Guardar"))}</button>
          <button type="button" class="btn sm quiet" data-agora="${k}">${esc(t("Ler só este país"))}</button></div></div>`).join("")}
      <div class="panel pad"><div class="pn-card-h"><b>${esc(t("Juntar um país"))}</b><small>${esc(t("código de 2 letras: ES, PL, KZ…"))}</small></div>
        <div class="an-novo"><input id="an-np" maxlength="2" placeholder="KZ"><input id="an-nn" placeholder="${esc(t("Nome"))}"><button type="button" class="btn sm" data-act="novo">${esc(t("Juntar"))}</button></div>
        <p class="an-dim">${esc(t("Uma pesquisa por linha; «(todos)» = os anúncios mais vistos do país. Sem login a Meta só dá a 1.ª página (~30) de cada pesquisa: mais palavras = mais anúncios."))}</p></div></div>`;
  }

  function voltas() {
    const v = (D.voltas || []).slice(0, 14);
    if (!v.length) return `<p class="an-dim">${esc(t("Sem dados"))}</p>`;
    return `<section class="panel an-tw"><table class="an-t"><tbody>${v.map((x) => `<tr><td>${esc(x.em.slice(5, 16))}</td><td>${band(x.pais)} ${esc(x.pais)}</td><td>${esc(x.pesquisa)}</td>
      <td class="r">${x.n}</td><td class="r">${x.novos ? `+${x.novos}` : ""}</td><td>${x.erro ? ui.tag(x.erro.slice(0, 60), "bad") : ""}</td></tr>`).join("")}</tbody></table></section>`;
  }

  async function onClick(e) {
    const b = e.target.closest("button, [data-abrir]");
    if (!b) return;
    const ds = b.dataset;
    if (ds.pais != null) { pais = ds.pais; localStorage.setItem("an-pais", pais); cat = ""; return load(); }
    if (ds.jan) { janela = ds.jan; localStorage.setItem("an-jan", janela); return load(); }
    if (ds.risco) { risco = ds.risco; localStorage.setItem("an-risco", risco); return draw(); }
    if (ds.cat != null) { cat = ds.cat; $("an").querySelectorAll(".an-cats button").forEach((x) => x.classList.toggle("on", x.dataset.cat === cat)); return drawLista(); }
    if (ds.abrir) {
      if (!b.matches("button")) { cat = ""; risco = "todos"; }
      aberto = aberto === ds.abrir && b.matches("button") ? "" : ds.abrir;
      if (!b.matches("button")) { draw(); const c = $("an").querySelector(`.an-card[data-k="${CSS.escape(aberto)}"]`); if (c) c.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
      return drawLista();
    }
    try {
      if (ds.act === "on" || ds.act === "off") { b.disabled = true; await api("/api/anuncios/ligar", { method: "POST", body: { on: ds.act === "on" } }); msg(t(ds.act === "on" ? "Ligado: a 1.ª volta começou (~15 min para os três países)." : "Desligado.")); return load(); }
      if (ds.act === "agora" || ds.agora) { b.disabled = true; await api("/api/anuncios/agora", { method: "POST", body: { pais: ds.agora || "" } }); msg(t("A ler agora. A página atualiza sozinha.")); return load(); }
      if (ds.ligpais) { await api("/api/anuncios/pesquisas", { method: "POST", body: { pais: ds.ligpais, ligado: !D.paises[ds.ligpais].ligado } }); return load(); }
      if (ds.guardar) {
        const lista = $("an").querySelector(`[data-pq="${ds.guardar}"] textarea`).value.split("\n").map((x) => x.trim()).filter(Boolean).map((x) => (x === "(todos)" ? "" : x));
        await api("/api/anuncios/pesquisas", { method: "POST", body: { pais: ds.guardar, pesquisas: lista } }); msg(t("Guardado: conta na próxima volta.")); return load();
      }
      if (ds.act === "novo") {
        const p = $("an-np").value.trim().toUpperCase();
        await api("/api/anuncios/pesquisas", { method: "POST", body: { pais: p, nome: $("an-nn").value.trim() || p } }); msg(t("País juntado.")); return load();
      }
    } catch (err) { msg(err.message); b.disabled = false; }
  }
})();
