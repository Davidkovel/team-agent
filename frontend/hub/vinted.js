// Vinted Radar (#/vinted, 03 · Negócios; backend/app/routers/vinted.py). Pedido do David a 11 nov: escolher as categorias e
// ligar o coletor Selenium daqui. Ao lado do título, o estado do coletor neste PC e o único botão (Ligar/Desligar); por baixo os
// números, as categorias (ligar/desligar cada uma, juntar uma nova), os limites da regra e as oportunidades encontradas.
// Tudo vem do radar.db do vinted-radar deste PC: o que falta aparece como «Sem dados». A compra é sempre à mão.
(function () {
  let V = null, timer = 0, ordem = localStorage.getItem("vt-ordem") || "desconto", cat = "";
  const desc = (a) => (a.mediana ? 1 - a.preco / a.mediana : 0);
  const ORDENS = { desconto: ["Maior desconto", (a, b) => desc(b) - desc(a)], lucro: ["Maior lucro", (a, b) => (b.lucro || 0) - (a.lucro || 0)],
    barato: ["Mais barato", (a, b) => a.preco - b.preco], novo: ["Mais recentes", (a, b) => String(b.alertado_em || b.visto_em).localeCompare(String(a.alertado_em || a.visto_em))] };
  const eur = (n, d = 0) => (n == null ? "—" : `${Number(n).toLocaleString("pt-PT", { maximumFractionDigits: d })} €`);
  const ago = (s) => (s ? fmt.ago(new Date(s.replace(" ", "T")).toISOString()) : t("nunca"));

  function paintCtl() {
    const on = V.ligado, err = V.estado && V.estado.erro;
    const chip = `<span class="vt-state st ${err ? "bad" : on ? "ok" : "wait"}"><i></i>${esc(t(err ? "Com erro" : on ? "A procurar" : "Parado"))}</span>`;
    const btn = on ? `<button type="button" class="btn quiet" data-vt="off">${icon("stop")}${esc(t("Desligar"))}</button>`
      : `<button type="button" class="btn primary" data-vt="on">${icon("play")}${esc(t("Ligar o radar"))}</button>`;
    paint($("vt-ctl"), chip + btn);
  }

  function nicho(n) {
    return `<label class="vt-cat ${n.ativo ? "on" : ""}">
      <input type="checkbox" data-cat="${esc(n.nome)}" ${n.ativo ? "checked" : ""}>
      <span class="vt-cat-in"><b>${esc(n.nome)}</b><small>«${esc(n.pesquisa)}»</small>
        <em>${n.anuncios ? `${n.anuncios} ${esc(t("anúncios"))} · +${n.hoje} ${esc(t("hoje"))}` : esc(t("Sem dados"))}</em></span>
      <button type="button" class="vt-x" data-tirar="${esc(n.nome)}" title="${esc(t("Tirar categoria"))}">${icon("x")}</button>
    </label>`;
  }

  function alerta(a, i) {
    const pct = a.mediana ? Math.round((1 - a.preco / a.mediana) * 100) : null;
    return `<a class="vt-deal panel ${i < 3 && ordem !== "novo" ? "top" : ""}" href="${esc(a.link)}" target="_blank" rel="noopener">
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
    const cats = [...new Set(V.alertas.map((a) => a.nicho))];
    if (cat && !cats.includes(cat)) cat = "";
    const lista = V.alertas.filter((a) => !cat || a.nicho === cat).sort(ORDENS[ordem][1]);
    const st = V.estado || {}, ativos = V.nichos.filter((n) => n.ativo).length;
    const kpis = ui.kpis([
      ui.kpi({ label: "Oportunidades hoje", value: V.alertas_hoje, sub: t("{n} no total", { n: V.alertas.length }), cls: "hi" }),
      ui.kpi({ label: "Anúncios guardados", value: V.total || t("Sem dados"), sub: t("base de preços de mercado") }),
      ui.kpi({ label: "Categorias ligadas", value: `${ativos}/${V.nichos.length}` }),
      ui.kpi({ label: "Último ciclo", value: V.ligado ? ago(st.ultimo_ciclo) : "—", sub: V.ligado ? (st.erro || st.fase || "") : t("coletor parado"), cls: st.erro ? "warn" : "" }),
    ]);
    const tg = V.telegram ? "" : `<p class="vt-note">${esc(t("Sem Telegram: os alertas ficam só aqui. Põe TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID no .env do vinted-radar."))}</p>`;
    paint($("vt-body"), `${kpis}
      ${ui.sec("Categorias", `<span class="vt-aside">${esc(t("Ligadas = procuradas de {m} em {m} min", { m: V.limites.intervalo_min }))}</span>`)}
      <div class="vt-cats">${V.nichos.map(nicho).join("")}
        <form class="vt-cat vt-new" data-new><input name="pesquisa" placeholder="${esc(t("Nova: ex. barbour jacket"))}" maxlength="80">
          <button class="btn quiet" type="submit">${icon("plus")}${esc(t("Juntar"))}</button></form></div>
      ${ui.sec("Oportunidades", `<div class="vt-seg">${Object.entries(ORDENS).map(([k, [l]]) => `<button type="button" data-ordem="${k}" class="${k === ordem ? "on" : ""}">${esc(t(l))}</button>`).join("")}</div>`)}
      ${cats.length > 1 ? `<div class="vt-seg vt-fcat"><button type="button" data-fcat="" class="${cat ? "" : "on"}">${esc(t("Todas"))}</button>${cats.map((c) => `<button type="button" data-fcat="${esc(c)}" class="${c === cat ? "on" : ""}">${esc(c)}</button>`).join("")}</div>` : ""}
      ${lista.length ? `<div class="vt-deals">${lista.map(alerta).join("")}</div>`
        : `<div class="panel">${ui.empty("bag", "Ainda sem oportunidades", V.ligado ? "O radar está a procurar. Aparecem aqui quando um artigo sair bem abaixo do mercado." : "Escolhe as categorias e carrega em «Ligar o radar».")}</div>`}
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
      if (b) { b.disabled = true; send("/api/vinted/ligar", { on: b.dataset.vt === "on" }, b.dataset.vt === "on" ? "Radar ligado: a primeira volta junta os preços de mercado." : "Radar desligado."); }
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
      if (!e.target.matches("[data-cat]")) return;
      const ativos = [...v.querySelectorAll("[data-cat]:checked")].map((i) => i.dataset.cat);
      send("/api/vinted/config", { ativos });
    };
    v.onsubmit = (e) => {
      if (!e.target.matches("[data-new]")) return;
      e.preventDefault();
      const q = e.target.pesquisa.value.trim();
      if (q) send("/api/vinted/config", { novo: { pesquisa: q } }, "Categoria juntada.");
    };
    await load();
  };
})();
