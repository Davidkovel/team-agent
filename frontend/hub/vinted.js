// Vinted Radar (#/vinted, 03 · Negócios; backend/app/routers/vinted.py). Pedido do David a 11 nov: escolher as categorias e
// ligar o coletor Selenium daqui. Ao lado do título, o estado do coletor neste PC e o único botão (Ligar/Desligar); por baixo os
// números, as categorias (ligar/desligar cada uma, juntar uma nova), os limites da regra e as oportunidades encontradas.
// Tudo vem do radar.db do vinted-radar deste PC: o que falta aparece como «Sem dados». A compra é sempre à mão.
// 12 nov (Marco): abas por tema (Roupa, Tecnologia...) que arrumam as categorias e as oportunidades; «Contínuo 24 h» (a guarda do
// Hub volta a ligar o coletor se ele parar, e diz o que fez); «Procurar agora»; ligar/desligar um tema inteiro; esconder o que já se viu.
(function () {
  let V = null, timer = 0, ordem = localStorage.getItem("vt-ordem") || "desconto", cat = "", grupo = localStorage.getItem("vt-grupo") || "";
  const desc = (a) => (a.mediana ? 1 - a.preco / a.mediana : 0);
  const ORDENS = { desconto: ["Maior desconto", (a, b) => desc(b) - desc(a)], lucro: ["Maior lucro", (a, b) => (b.lucro || 0) - (a.lucro || 0)],
    barato: ["Mais barato", (a, b) => a.preco - b.preco], novo: ["Mais recentes", (a, b) => String(b.alertado_em || b.visto_em).localeCompare(String(a.alertado_em || a.visto_em))] };
  const eur = (n, d = 0) => (n == null ? "—" : `${Number(n).toLocaleString("pt-PT", { maximumFractionDigits: d })} €`);
  const ago = (s) => (s ? fmt.ago(new Date(s.replace(" ", "T")).toISOString()) : t("nunca"));

  function paintCtl() {
    const on = V.ligado, err = (V.estado && V.estado.erro) || (!on && V.continuo && V.guarda.erro);
    const chip = `<span class="vt-state st ${err ? "bad" : on ? "ok" : "wait"}"><i></i>${esc(t(err ? "Com erro" : on ? (V.continuo ? "A procurar 24 h" : "A procurar") : "Parado"))}</span>`;
    const cont = `<button type="button" class="vt-sw ${V.continuo ? "on" : ""}" data-cont="${V.continuo ? 0 : 1}" role="switch" aria-checked="${V.continuo ? "true" : "false"}"
      title="${esc(t("Com isto ligado, o Hub volta a ligar o radar sozinho se ele parar, de dia e de noite."))}"><i></i>${esc(t("Contínuo 24 h"))}</button>`;
    const now = on ? `<button type="button" class="btn quiet" data-agora>${icon("search")}${esc(t("Procurar agora"))}</button>` : "";
    const btn = on ? `<button type="button" class="btn quiet" data-vt="off">${icon("stop")}${esc(t("Desligar"))}</button>`
      : `<button type="button" class="btn primary" data-vt="on">${icon("play")}${esc(t("Ligar o radar"))}</button>`;
    paint($("vt-ctl"), chip + cont + now + btn);
  }

  // A guarda: o que o modo contínuo está a fazer, ou o que falta neste computador para o radar correr.
  function guarda() {
    const g = V.guarda, falta = [];
    if (!V.pronto.selenium) falta.push(t("o Selenium (pip install selenium no Python do Hub)"));
    if (!V.pronto.chrome) falta.push(t("o Google Chrome"));
    if (falta.length) return `<div class="panel vt-guard bad"><b>${esc(t("O radar não consegue correr neste computador"))}</b>
      <span>${esc(t("Falta instalar: {x}.", { x: falta.join(t(" e ")) }))}</span></div>`;
    if (!V.continuo) return V.ultimo_erro && !V.ligado ? `<div class="panel vt-guard bad"><b>${esc(t("O radar parou sozinho"))}</b><span>${esc(V.ultimo_erro)}</span></div>` : "";
    const linhas = [];
    if (g.erro) linhas.push(`${esc(g.erro)}. ${esc(t("Volta a tentar em {m} min.", { m: Math.max(1, Math.ceil(g.espera_s / 60)) }))}`);
    else linhas.push(esc(V.ligado ? t("De guarda desde {d}: olha de minuto a minuto e volta a ligar o radar se ele parar ou ficar preso.", { d: ago(g.desde) })
      : t("A ligar o radar outra vez…")));
    if (g.reinicios) linhas.push(esc(t("Já o voltou a ligar {n} vez(es); a última {d} ({m}).", { n: g.reinicios, d: ago(g.ultimo_reinicio), m: t(g.motivo || "tinha parado") })));
    return `<div class="panel vt-guard ${g.erro ? "bad" : "ok"}"><b>${icon("eye")}${esc(t("Guarda 24 h"))}</b><span>${linhas.join("<br>")}</span></div>`;
  }

  function nicho(n) {
    return `<label class="vt-cat ${n.ativo ? "on" : ""}">
      <input type="checkbox" data-cat="${esc(n.nome)}" ${n.ativo ? "checked" : ""}>
      <span class="vt-cat-in"><b>${esc(n.nome)}</b><small>«${esc(n.pesquisa)}»</small>
        <em>${n.anuncios ? `${n.anuncios} ${esc(t("anúncios"))} · +${n.hoje} ${esc(t("hoje"))}` : esc(t("Sem dados"))}</em></span>
      <select class="vt-mv" data-mover="${esc(n.nome)}" title="${esc(t("Mudar de tema"))}">${V.grupos_possiveis.map((g) => `<option ${g === n.grupo ? "selected" : ""}>${esc(g)}</option>`).join("")}</select>
      <button type="button" class="vt-x" data-tirar="${esc(n.nome)}" title="${esc(t("Tirar categoria"))}">${icon("x")}</button>
    </label>`;
  }

  function alerta(a, i) {
    const pct = a.mediana ? Math.round((1 - a.preco / a.mediana) * 100) : null;
    return `<a class="vt-deal panel ${i < 3 && ordem !== "novo" ? "top" : ""}" href="${esc(a.link)}" target="_blank" rel="noopener">
      <button type="button" class="vt-hide" data-esconder="${a.id}" title="${esc(t("Já vi: tirar da lista"))}">${icon("x")}</button>
      <div class="vt-ph">${a.foto ? `<img src="${esc(a.foto)}" alt="" loading="lazy">` : ""}${pct != null ? `<span>−${pct}%</span>` : ""}${i < 3 && ordem !== "novo" ? `<em>#${i + 1}</em>` : ""}</div>
      <div class="vt-dt">
        <small>${esc(a.marca || "")} · ${esc(a.nicho)}</small>
        <b>${esc(a.titulo)}</b>
        <div class="vt-nums"><span><i>${esc(t("Preço"))}</i>${eur(a.preco, 2)}</span><span><i>${esc(t("Mercado"))}</i>${eur(a.mediana)}</span>
          <span class="up"><i>${esc(t("Lucro"))}</i>${a.lucro != null ? "+" + eur(a.lucro) : "—"}</span></div>
        <p>${esc([a.tamanho, a.estado].filter(Boolean).join(" · "))}${a.comparaveis ? ` · ${esc(t("mediana de {n} anúncios", { n: a.comparaveis }))}` : ""} · ${esc(ago(a.alertado_em || a.visto_em))}</p>
      </div></a>`;
  }

  function limites() {
    const L = V.limites, f = (k, label, step, sub, pct) => `<label class="vt-lim"><span>${esc(t(label))}</span>
      <input type="number" min="0" step="${step}" data-lim="${k}" data-pct="${pct ? 1 : ""}" value="${pct ? Math.round((L[k] || 0) * 100) : L[k] ?? ""}"><small>${esc(t(sub))}</small></label>`;
    return `<div class="panel vt-lims">
      ${f("margem_min_eur", "Lucro mínimo", 1, "€ depois de taxa e portes")}
      ${f("max_pct_do_mercado", "Preço máximo", 1, "% da mediana do mercado", true)}
      ${f("percentil_max", "Entre os mais baratos", 1, "% dos comparáveis", true)}
      ${f("preco_max", "Preço até", 5, "€ por artigo")}
      ${f("intervalo_min", "De quantos em quantos", 1, "minutos")}
      <button type="button" class="btn quiet" data-save>${esc(t("Guardar limites"))}</button></div>`;
  }

  function draw() {
    if (!$("vt-body")) return;
    if (!V.instalado) {
      paint($("vt-ctl"), "");
      paint($("vt-body"), `<div class="panel">${ui.empty("bag", "O vinted-radar não está neste PC", `Falta a pasta ${V.pasta}. Clona o repositório lá ou põe VINTED_RADAR_DIR no backend/.env.`)}</div>`);
      return;
    }
    paintCtl();
    if (grupo && !V.grupos.includes(grupo)) grupo = "";
    const nichos = V.nichos.filter((n) => !grupo || n.grupo === grupo);
    const doGrupo = V.alertas.filter((a) => !grupo || a.grupo === grupo);
    const cats = [...new Set(doGrupo.map((a) => a.nicho))];
    if (cat && !cats.includes(cat)) cat = "";
    const lista = doGrupo.filter((a) => !cat || a.nicho === cat);
    const st = V.estado || {}, ativos = V.nichos.filter((n) => n.ativo).length;
    const kpis = ui.kpis([
      ui.kpi({ label: "Oportunidades hoje", value: V.alertas_hoje, sub: t("{n} no total", { n: V.alertas.length }), cls: "hi" }),
      ui.kpi({ label: "Anúncios guardados", value: V.total || t("Sem dados"), sub: t("base de preços de mercado") }),
      ui.kpi({ label: "Categorias ligadas", value: `${ativos}/${V.nichos.length}` }),
      ui.kpi({ label: "Último ciclo", value: V.ligado ? ago(st.ultimo_ciclo) : "—", sub: V.ligado ? (st.erro || st.fase || "") : t("coletor parado"), cls: st.erro ? "warn" : "" }),
    ]);
    const tg = V.telegram ? "" : `<p class="vt-note">${esc(t("Sem Telegram: os alertas ficam só aqui. Põe TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID no .env do vinted-radar."))}</p>`;
    // as abas: um tema de cada vez arruma as categorias e as oportunidades por ele
    const conta = (g) => V.nichos.filter((n) => !g || n.grupo === g);
    const aba = (g, nome) => { const ns = conta(g), deals = V.alertas.filter((a) => !g || a.grupo === g).length;
      return `<button type="button" data-grupo="${esc(g)}" class="${g === grupo ? "on" : ""}"><b>${esc(t(nome))}</b><small>${ns.filter((n) => n.ativo).length}/${ns.length} ${esc(t("ligadas"))}${deals ? ` · ${deals}` : ""}</small></button>`; };
    const abas = `<div class="vt-tabs" role="tablist">${aba("", "Tudo")}${V.grupos.map((g) => aba(g, g)).join("")}</div>`;
    const todasOn = nichos.length && nichos.every((n) => n.ativo), algumaOn = nichos.some((n) => n.ativo);
    const massa = `<div class="vt-bulk"><span class="vt-aside">${esc(t("Ligadas = procuradas de {m} em {m} min", { m: V.limites.intervalo_min }))}</span>
      <button type="button" class="btn quiet" data-massa="1" ${todasOn ? "disabled" : ""}>${esc(grupo ? t("Ligar {g}", { g: grupo }) : t("Ligar todas"))}</button>
      <button type="button" class="btn quiet" data-massa="0" ${algumaOn ? "" : "disabled"}>${esc(grupo ? t("Desligar {g}", { g: grupo }) : t("Desligar todas"))}</button></div>`;
    // as oportunidades arrumadas: em «Tudo» por tema, dentro de um tema por categoria; com uma categoria escolhida, lista só
    const chave = cat ? null : grupo ? "nicho" : "grupo";
    const blocos = chave ? [...new Set(lista.map((a) => a[chave]))].map((k) => [k, lista.filter((a) => a[chave] === k).sort(ORDENS[ordem][1])]) : [["", lista.sort(ORDENS[ordem][1])]];
    const deals = blocos.map(([k, as]) => `${k && blocos.length > 1 ? `<h4 class="vt-grp">${esc(k)}<small>${as.length}</small></h4>` : ""}<div class="vt-deals">${as.map(alerta).join("")}</div>`).join("");
    paint($("vt-body"), `${guarda()}${kpis}${abas}
      ${ui.sec(grupo ? t("Categorias de {g}", { g: grupo }) : "Categorias", massa)}
      <div class="vt-cats">${nichos.map(nicho).join("")}
        <form class="vt-cat vt-new" data-new><input name="pesquisa" placeholder="${esc(grupo === "Tecnologia" ? t("Nova: ex. airpods pro") : t("Nova: ex. barbour jacket"))}" maxlength="80">
          <button class="btn quiet" type="submit">${icon("plus")}${esc(t("Juntar"))}</button></form></div>
      ${ui.sec(grupo ? t("Oportunidades de {g}", { g: grupo }) : "Oportunidades", `<div class="vt-seg">${Object.entries(ORDENS).map(([k, [l]]) => `<button type="button" data-ordem="${k}" class="${k === ordem ? "on" : ""}">${esc(t(l))}</button>`).join("")}</div>`)}
      ${cats.length > 1 ? `<div class="vt-seg vt-fcat"><button type="button" data-fcat="" class="${cat ? "" : "on"}">${esc(t("Todas"))}</button>${cats.map((c) => `<button type="button" data-fcat="${esc(c)}" class="${c === cat ? "on" : ""}">${esc(c)}</button>`).join("")}</div>` : ""}
      ${lista.length ? deals
        : `<div class="panel">${ui.empty("bag", grupo ? t("Ainda sem oportunidades em {g}", { g: grupo }) : "Ainda sem oportunidades", V.ligado ? "O radar está a procurar. Aparecem aqui quando um artigo sair bem abaixo do mercado." : "Escolhe as categorias e carrega em «Ligar o radar».")}</div>`}
      ${V.escondidos ? `<p class="vt-note">${esc(t("{n} oportunidade(s) escondida(s).", { n: V.escondidos }))} <button type="button" class="vt-linkb" data-repor>${esc(t("Mostrar outra vez"))}</button></p>` : ""}
      ${tg}
      ${ui.sec("Limites da regra")}${limites()}
      <p class="vt-foot">${esc(t("O coletor abre a pesquisa pública do Vinted num Chrome sem janela, devagar e sem contornar bloqueios. A compra é sempre tua."))}</p>`);
    clearTimeout(timer);
    timer = setTimeout(() => $("vt-body") && load(), V.ligado ? 10000 : 30000);
  }

  async function load() {
    try {
      V = await api("/api/vinted");
      draw();
    } catch (e) {
      if (e.message !== "unauthorized" && $("vt-body")) $("vt-body").innerHTML = ui.error(e.message);
    }
  }

  async function send(path, body, msg) {
    try {
      V = await api(path, { method: "POST", body });
      if (msg) flash(t(msg));
      draw();
    } catch (e) {
      flash(e.message);
      load();
    }
  }

  HUB_VIEWS.vinted = async function () {
    page(`${ui.head("Negócios", t("Vinted Radar"), t("Anúncios novos do Vinted bem abaixo do preço de mercado, minutos depois de aparecerem."),
      `<div class="vt-ctl" id="vt-ctl"></div>`)}
      <div id="vt-body">${ui.skeleton(6)}</div>`);
    const v = $("view");
    v.onclick = (e) => {
      const b = e.target.closest("[data-vt]"), x = e.target.closest("[data-tirar]"), s = e.target.closest("[data-save]");
      const c = e.target.closest("[data-cont]"), h = e.target.closest("[data-esconder]"), m = e.target.closest("[data-massa]"), g = e.target.closest("[data-grupo]");
      if (c) { c.disabled = true; send("/api/vinted/ligar", { continuo: c.dataset.cont === "1" }, c.dataset.cont === "1" ? "Contínuo ligado: o Hub mantém o radar a procurar, dia e noite." : "Contínuo desligado: o radar fica como está, sem guarda."); }
      else if (e.target.closest("[data-agora]")) { e.target.closest("[data-agora]").disabled = true; send("/api/vinted/agora", {}, "A procurar agora em todas as categorias ligadas."); }
      else if (h) { e.preventDefault(); send("/api/vinted/esconder", { id: Number(h.dataset.esconder) }); }
      else if (e.target.closest("[data-repor]")) send("/api/vinted/esconder", { repor: true });
      else if (m) {
        const on = m.dataset.massa === "1";
        const ativos = V.nichos.filter((n) => (!grupo || n.grupo === grupo) ? on : n.ativo).map((n) => n.nome);
        send("/api/vinted/config", { ativos }, on ? "Categorias ligadas." : "Categorias desligadas.");
      } else if (g) { grupo = g.dataset.grupo; cat = ""; localStorage.setItem("vt-grupo", grupo); draw(); }
      else if (e.target.closest(".vt-mv")) e.preventDefault();
      else if (b) { b.disabled = true; send("/api/vinted/ligar", { on: b.dataset.vt === "on" }, b.dataset.vt === "on" ? "Radar ligado: a primeira volta junta os preços de mercado." : "Radar desligado."); }
      else if (x) { e.preventDefault(); send("/api/vinted/config", { tirar: x.dataset.tirar }, "Categoria tirada."); }
      else if (s) {
        const limites = {};
        v.querySelectorAll("[data-lim]").forEach((i) => { if (i.value !== "") limites[i.dataset.lim] = i.dataset.pct ? Number(i.value) / 100 : Number(i.value); });
        send("/api/vinted/config", { limites }, "Limites guardados.");
      } else if (e.target.closest("[data-ordem]")) { ordem = e.target.closest("[data-ordem]").dataset.ordem; localStorage.setItem("vt-ordem", ordem); draw(); }
      else if (e.target.closest("[data-fcat]")) { cat = e.target.closest("[data-fcat]").dataset.fcat; draw(); }
      else if (e.target.closest("[data-retry]")) load();
    };
    v.onchange = (e) => {
      if (e.target.matches("[data-mover]")) return send("/api/vinted/config", { mover: { nome: e.target.dataset.mover, grupo: e.target.value } }, "Categoria mudada de tema.");
      if (!e.target.matches("[data-cat]")) return;
      // as categorias de outros temas não estão no ecrã: ficam como estavam
      const visto = new Set([...v.querySelectorAll("[data-cat]")].map((i) => i.dataset.cat));
      const marcados = new Set([...v.querySelectorAll("[data-cat]:checked")].map((i) => i.dataset.cat));
      const ativos = V.nichos.filter((n) => (visto.has(n.nome) ? marcados.has(n.nome) : n.ativo)).map((n) => n.nome);
      send("/api/vinted/config", { ativos });
    };
    v.onsubmit = (e) => {
      if (!e.target.matches("[data-new]")) return;
      e.preventDefault();
      const q = e.target.pesquisa.value.trim();
      if (q) send("/api/vinted/config", { novo: { pesquisa: q, grupo } }, "Categoria juntada.");
    };
    await load();
  };
})();
