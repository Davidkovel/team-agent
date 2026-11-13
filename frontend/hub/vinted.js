// Vinted Radar (#/vinted, 03 · Negócios; backend/app/routers/vinted.py). Pedido do David a 11 nov: escolher as categorias e
// ligar o coletor Selenium daqui. Ao lado do título, o estado do coletor neste PC e o único botão (Ligar/Desligar); por baixo os
// números, as categorias (ligar/desligar cada uma, juntar uma nova), os limites da regra e as oportunidades encontradas.
// Tudo vem do radar.db do vinted-radar deste PC: o que falta aparece como «Sem dados». A compra é sempre à mão.
// 12 nov (Marco): abas por tema (Roupa, Tecnologia...) que arrumam as categorias e as oportunidades; «Contínuo 24 h» (a guarda do
// Hub volta a ligar o coletor se ele parar, e diz o que fez); «Procurar agora»; ligar/desligar um tema inteiro; esconder o que já se viu.
(function () {
  let V = null, timer = 0, ordem = localStorage.getItem("vt-ordem") || "desconto", cat = "", grupo = localStorage.getItem("vt-grupo") || "";
  // 13 nov (Marco: «nem dá para ver as fotos ou as páginas dos produtos... uma espécie de cérebro... um CRM mas em produtos»):
  // a página passa a ter cinco partes. Painel (o estado e as oportunidades), Produtos (todos os anúncios que o radar guardou,
  // com foto, filtros e a ficha de cada um), Pipeline (Na mira, A negociar, Comprado, À venda, Vendido), Mercado (o cérebro:
  // preços do meio por categoria e marca, ritmo de anúncios) e Definições (categorias, limites).
  const ABAS = [["painel", "Painel", "grid"], ["produtos", "Produtos", "bag"], ["pipeline", "Pipeline", "flag"], ["mercado", "Mercado", "chart"], ["definicoes", "Definições", "sliders"]];
  let aba = localStorage.getItem("vt-aba") || "painel", P = null, PL = null, MK = null, ficha = null;
  const F = { q: "", nicho: "", marca: "", estado: "", so: "", etapa: "", ordem: localStorage.getItem("vt-p-ordem") || "recente", pmin: "", pmax: "", n: 60 };
  const ETAPA = { mira: ["Na mira", "eye"], negociar: ["A negociar", "chat"], comprado: ["Comprado", "tick"], venda: ["À venda", "bag"], vendido: ["Vendido", "trend"], descartado: ["Descartado", "x"] };
  const etapaChip = (e) => (e && ETAPA[e] ? `<span class="vt-et et-${e}">${icon(ETAPA[e][1])}${esc(t(ETAPA[e][0]))}</span>` : "");
  const desc = (a) => (a.mediana ? 1 - a.preco / a.mediana : 0);
  const ORDENS = { desconto: ["Maior desconto", (a, b) => desc(b) - desc(a)], lucro: ["Maior lucro", (a, b) => (b.lucro || 0) - (a.lucro || 0)],
    barato: ["Mais barato", (a, b) => a.preco - b.preco], novo: ["Mais recentes", (a, b) => String(b.alertado_em || b.visto_em).localeCompare(String(a.alertado_em || a.visto_em))] };
  const eur = (n, d = 0) => (n == null ? "—" : `${Number(n).toLocaleString("pt-PT", { maximumFractionDigits: d })} €`);
  // 13 nov (Marco: «mete um ícone... destacar... isto vai passar por vários olhos»): cada tema tem o seu ícone, que aparece na aba,
  // nas categorias e nos grupos de oportunidades; a melhor oportunidade fica em destaque no topo; o que é dinheiro está a verde.
  const TEMA_ICO = { "": "grid", Roupa: "bag", Tecnologia: "monitor", Casa: "home", Outros: "layers" };
  const ico = (g) => icon(TEMA_ICO[g] || "layers");
  const chip = (name, cls = "") => `<span class="vt-ico ${cls}">${icon(name)}</span>`;
  const head = (name, title, aside = "") => `<div class="vt-h">${chip(name)}<h3>${esc(t(title))}</h3>${aside ? `<div class="vt-h-a">${aside}</div>` : ""}</div>`;
  const pctOf = (a) => (a.mediana ? Math.round((1 - a.preco / a.mediana) * 100) : null);
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
    if (falta.length) return `<div class="panel vt-guard bad"><b>${icon("alert")}${esc(t("O radar não consegue correr neste computador"))}</b>
      <span>${esc(t("Falta instalar: {x}.", { x: falta.join(t(" e ")) }))}</span></div>`;
    if (!V.continuo) return V.ultimo_erro && !V.ligado ? `<div class="panel vt-guard bad"><b>${icon("alert")}${esc(t("O radar parou sozinho"))}</b><span>${esc(V.ultimo_erro)}</span></div>` : "";
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
      <span class="vt-ico">${ico(n.grupo)}</span>
      <span class="vt-cat-in"><b>${esc(n.nome)}</b><small>«${esc(n.pesquisa)}»</small>
        <em>${n.anuncios ? `${n.anuncios} ${esc(t("anúncios"))}${n.hoje ? ` · <u>+${n.hoje} ${esc(t("hoje"))}</u>` : ""}` : esc(t("Sem dados"))}</em></span>
      <span class="vt-tog" aria-hidden="true"><i></i></span>
      <select class="vt-mv" data-mover="${esc(n.nome)}" title="${esc(t("Mudar de tema"))}">${V.grupos_possiveis.map((g) => `<option ${g === n.grupo ? "selected" : ""}>${esc(g)}</option>`).join("")}</select>
      <button type="button" class="vt-x" data-tirar="${esc(n.nome)}" title="${esc(t("Tirar categoria"))}">${icon("x")}</button>
    </label>`;
  }

  // Quem vende: estrelas e avaliações (o coletor lê-as quando o artigo vira oportunidade). Poucas avaliações ou menos de 4,5 = aviso.
  function vendedor(a) {
    if (a.estrelas == null && a.vendedor) return `<span class="vt-sel warn" title="${esc(t("Este vendedor ainda não tem avaliações: confirma antes de comprar."))}">★ ${esc(t("sem avaliações"))} · ${esc(a.vendedor)}</span>`;
    if (a.estrelas == null) return `<span class="vt-sel none">${icon("users")}${esc(t("Vendedor: sem dados"))}</span>`;
    const fraco = a.estrelas < 4.5 || (a.avaliacoes != null && a.avaliacoes < 5);
    return `<span class="vt-sel ${fraco ? "warn" : "ok"}" title="${esc(fraco ? t("Vendedor com poucas avaliações ou nota baixa: confirma antes de comprar.") : t("Vendedor bem avaliado."))}">★ ${String(a.estrelas).replace(".", ",")}${a.avaliacoes != null ? ` · ${a.avaliacoes} ${esc(t("avaliações"))}` : ""}${a.vendedor ? ` · ${esc(a.vendedor)}` : ""}</span>`;
  }
  const selo = (a) => (a.cabe == null ? "" : a.no_plano ? `<span class="vt-tag ok">${esc(t("No plano de compra"))}</span>` : a.cabe ? `<span class="vt-tag">${esc(t("Cabe no orçamento"))}</span>` : `<span class="vt-tag bad">${esc(t("Fora do orçamento"))}</span>`);

  // O orçamento: quanto há, quanto está em artigos por vender, quanto sobra, e o que o radar comprava com isso.
  function orcamento() {
    const o = V.orcamento, p = V.plano, n = (v) => (v == null ? `<b class="none">${esc(t("Sem dados"))}</b>` : `<b>${eur(v, 2)}</b>`);
    const campo = (k, label, sub) => `<label class="vt-lim"><span>${esc(t(label))}</span><input type="number" min="0" step="10" data-orc="${k}" value="${o[k] || ""}" placeholder="0"><small>${esc(t(sub))}</small></label>`;
    const form = `<div class="vt-orc-f">${campo("total", "Orçamento total", "€ que a empresa põe no Vinted")}${campo("por_artigo", "Máximo por artigo", "€, com taxa e portes · 0 = sem limite")}
      ${campo("por_noite", "Máximo por dia", "€ gastos num dia · 0 = sem limite")}<button type="button" class="btn ${o.total ? "quiet" : "primary"}" data-orc-save>${esc(t("Guardar orçamento"))}</button></div>`;
    if (!o.total) return `<div class="panel vt-orc">${ui.empty("wallet", "Ainda sem orçamento", "Diz quanto dinheiro a empresa pode usar. O radar passa a mostrar o que cabe nele e o que comprava primeiro.")}${form}</div>`;
    const usado = Math.max(0, Math.min(100, (o.investido / o.total) * 100));
    const doPlano = V.alertas.filter((a) => a.no_plano).sort((a, b) => (b.lucro || 0) - (a.lucro || 0));
    const linhas = doPlano.map((a, i) => `<div class="vt-pl"><em>${i + 1}</em><div><b>${esc(a.titulo)}</b><small>${esc(a.nicho)} · ${vendedor(a)}</small></div>
      <span><i>${esc(t("Custo"))}</i>${eur(a.custo, 2)}</span><span class="up"><i>${esc(t("Lucro"))}</i>+${eur(a.lucro)}</span>
      <a class="btn quiet" href="${esc(a.link)}" target="_blank" rel="noopener">${esc(t("Ver"))}${icon("arrow")}</a>
      <button type="button" class="btn quiet" data-comprei="${a.id}">${icon("tick")}${esc(t("Comprei"))}</button></div>`).join("");
    return `<div class="panel vt-orc">
      <div class="vt-orc-n"><div><i>${esc(t("Orçamento"))}</i>${n(o.total)}</div><div><i>${esc(t("Investido"))}</i>${n(o.investido)}<small>${esc(t("{n} artigo(s) por vender", { n: o.em_stock }))}</small></div>
        <div class="${o.disponivel <= 0 ? "bad" : "up"}"><i>${esc(t("Disponível"))}</i>${n(o.disponivel)}<small>${esc(o.por_noite ? t("hoje já saíram {v}", { v: eur(o.gasto_hoje, 2) }) : "")}</small></div>
        <div class="${o.lucro_real > 0 ? "up" : o.lucro_real < 0 ? "bad" : ""}"><i>${esc(t("Lucro real"))}</i>${n(o.lucro_real)}<small>${esc(t("{n} vendido(s) · previsto em stock +{v}", { n: o.vendidas, v: eur(o.lucro_previsto) }))}</small></div></div>
      <div class="vt-bar" title="${esc(t("Parte do orçamento que está em artigos por vender"))}"><i style="width:${usado.toFixed(1)}%"></i></div>
      <div class="vt-plan"><div class="vt-plan-h"><span class="vt-eyebrow">${icon("target")}${esc(t("Plano de compra"))}</span>
        <p>${doPlano.length ? esc(t("Com {t} para gastar agora cabem {n} oportunidade(s): custo {c}, lucro previsto +{l}.", { t: eur(p.teto, 2), n: doPlano.length, c: eur(p.custo, 2), l: eur(p.lucro) }))
          : esc(V.alertas.length ? t("Nenhuma das oportunidades de agora cabe em {t}.", { t: eur(p.teto, 2) }) : t("Sem oportunidades agora. Quando aparecerem, as que cabem no orçamento ficam aqui por ordem de lucro."))}</p></div>${linhas}</div>
      <details class="vt-orc-d"><summary>${esc(t("Mudar o orçamento"))}</summary>${form}</details></div>`;
  }

  function compras() {
    if (!V.compras.length) return "";
    return `${head("wallet", "Compras", `<span class="vt-aside">${esc(t("Marca por quanto vendeste para ver o lucro real"))}</span>`)}
      <div class="panel vt-buys">${V.compras.map((c) => { const real = c.vendido != null ? c.vendido - c.custo : null;
        return `<div class="vt-buy"><div><b>${esc(c.titulo)}</b><small>${esc(c.nicho)} · ${esc(ago(c.quando))}</small></div>
          <span><i>${esc(t("Custou"))}</i>${eur(c.custo, 2)}</span><span><i>${esc(t("Previsto"))}</i>${c.lucro_previsto != null ? "+" + eur(c.lucro_previsto) : "—"}</span>
          ${real != null ? `<span class="${real >= 0 ? "up" : "bad"}"><i>${esc(t("Lucro real"))}</i>${real >= 0 ? "+" : "−"}${eur(Math.abs(real), 2)}</span>
              <button type="button" class="btn quiet" data-desvendi="${c.id}">${esc(t("Ainda não vendi"))}</button>`
            : `<span class="vt-sold"><input type="number" min="0" step="1" placeholder="${esc(t("Vendi por €"))}" data-vendi-v="${c.id}" id="vt-v-${c.id}"><button type="button" class="btn quiet" data-vendi="${c.id}">${esc(t("Vendido"))}</button></span>`}
          <a class="vt-linkb" href="${esc(c.link)}" target="_blank" rel="noopener">${esc(t("Anúncio"))}</a>
          <button type="button" class="vt-x2" data-compra-tirar="${c.id}" title="${esc(t("Tirar das compras"))}">${icon("x")}</button></div>`; }).join("")}</div>`;
  }

  // A melhor oportunidade do que está à vista, em grande: é o que um olhar de fora tem de ver primeiro.
  function destaque(lista) {
    const a = [...lista].sort((x, y) => (y.lucro || 0) - (x.lucro || 0))[0];
    if (!a) return "";
    const pct = pctOf(a);
    return `<div class="panel vt-best">
      <div class="vt-best-ph">${a.foto ? `<img src="${esc(a.foto)}" alt="">` : ico(a.grupo)}</div>
      <div class="vt-best-in"><span class="vt-eyebrow">${icon("target")}${esc(t("Melhor oportunidade agora"))}</span>
        <b>${esc(a.titulo)}</b><small>${esc([a.marca, a.nicho, a.tamanho, a.estado].filter(Boolean).join(" · "))} · ${esc(ago(a.alertado_em || a.visto_em))}</small>
        <div class="vt-meta">${vendedor(a)}${selo(a)}</div>
        <div class="vt-best-n"><span><i>${esc(t("Preço"))}</i>${eur(a.preco, 2)}</span><span><i>${esc(t("Mercado"))}</i>${eur(a.mediana)}</span>
          ${pct != null ? `<span class="up"><i>${esc(t("Desconto"))}</i>−${pct}%</span>` : ""}</div></div>
      <div class="vt-best-l"><i>${esc(t("Lucro"))}</i>${a.lucro != null ? "+" + eur(a.lucro) : "—"}</div>
      <div class="vt-best-a"><a class="btn primary" href="${esc(a.link)}" target="_blank" rel="noopener">${esc(t("Ver no Vinted"))}${icon("arrow")}</a>
        <button type="button" class="btn quiet" data-comprei="${a.id}">${icon("tick")}${esc(t("Comprei"))}</button>
        <button type="button" class="btn quiet" data-ficha="${a.id}">${icon("doc")}${esc(t("Ficha"))}</button>
        <button type="button" class="btn quiet" data-esconder="${a.id}">${esc(t("Já vi"))}</button></div></div>`;
  }

  function alerta(a, i) {
    const pct = pctOf(a);
    return `<a class="vt-deal panel ${i < 3 && ordem !== "novo" ? "top" : ""}" href="${esc(a.link)}" target="_blank" rel="noopener">
      <button type="button" class="vt-hide" data-esconder="${a.id}" title="${esc(t("Já vi: tirar da lista"))}">${icon("x")}</button>
      <div class="vt-ph">${a.foto ? `<img src="${esc(a.foto)}" alt="" loading="lazy">` : `<span class="vt-noph">${ico(a.grupo)}</span>`}${pct != null ? `<span>−${pct}%</span>` : ""}${i < 3 && ordem !== "novo" ? `<em>#${i + 1}</em>` : ""}</div>
      <div class="vt-dt">
        <small>${esc(a.marca || "")} · ${esc(a.nicho)}</small>
        <b>${esc(a.titulo)}</b>
        <div class="vt-nums"><span><i>${esc(t("Preço"))}</i>${eur(a.preco, 2)}</span><span><i>${esc(t("Mercado"))}</i>${eur(a.mediana)}</span>
          <span class="up"><i>${esc(t("Lucro"))}</i>${a.lucro != null ? "+" + eur(a.lucro) : "—"}</span></div>
        <div class="vt-meta">${vendedor(a)}${selo(a)}</div>
        <span class="vt-go">${esc(t("Ver no Vinted"))}${icon("arrow")}<button type="button" class="vt-buyb" data-ficha="${a.id}">${icon("doc")}${esc(t("Ficha"))}</button><button type="button" class="vt-buyb" data-comprei="${a.id}">${icon("tick")}${esc(t("Comprei"))}</button></span>
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
    const kpis = `<div class="vt-kpis">${ui.kpis([
      ui.kpi({ label: "Oportunidades hoje", value: V.alertas_hoje, sub: t("{n} no total", { n: V.alertas.length }), cls: "hi", viz: chip("target") }),
      ui.kpi({ label: "Anúncios guardados", value: V.total || t("Sem dados"), sub: t("base de preços de mercado"), viz: chip("layers") }),
      ui.kpi({ label: "Categorias ligadas", value: `${ativos}/${V.nichos.length}`, sub: V.grupos.map((g) => `${g} ${V.nichos.filter((n) => n.grupo === g && n.ativo).length}`).join(" · "), viz: chip("tick", ativos ? "ok" : "") }),
      ui.kpi({ label: "Último ciclo", value: V.ligado ? ago(st.ultimo_ciclo) : "—", sub: V.ligado ? (st.erro || st.fase || "") : t("coletor parado"), cls: st.erro ? "warn" : "", viz: chip("clock", V.ligado && !st.erro ? "ok" : "") }),
    ])}</div>`;
    const tg = V.telegram ? "" : `<p class="vt-note">${esc(t("Sem Telegram: os alertas ficam só aqui. Põe TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID no .env do vinted-radar."))}</p>`;
    // as abas: um tema de cada vez arruma as categorias e as oportunidades por ele
    const conta = (g) => V.nichos.filter((n) => !g || n.grupo === g);
    const aba = (g, nome) => { const ns = conta(g), deals = V.alertas.filter((a) => !g || a.grupo === g).length;
      return `<button type="button" data-grupo="${esc(g)}" class="${g === grupo ? "on" : ""}" role="tab" aria-selected="${g === grupo}"><span class="vt-ico">${ico(g)}</span>
        <span class="vt-tab-t"><b>${esc(t(nome))}</b><small>${ns.filter((n) => n.ativo).length}/${ns.length} ${esc(t("ligadas"))}</small></span>
        ${deals ? `<em title="${esc(t("Oportunidades"))}">${deals}</em>` : ""}</button>`; };
    const abas = `<div class="vt-tabs" role="tablist">${aba("", "Tudo")}${V.grupos.map((g) => aba(g, g)).join("")}</div>`;
    const todasOn = nichos.length && nichos.every((n) => n.ativo), algumaOn = nichos.some((n) => n.ativo);
    const massa = `<div class="vt-bulk"><span class="vt-aside">${esc(t("Ligadas = procuradas de {m} em {m} min", { m: V.limites.intervalo_min }))}</span>
      <button type="button" class="btn quiet" data-massa="1" ${todasOn ? "disabled" : ""}>${esc(grupo ? t("Ligar {g}", { g: grupo }) : t("Ligar todas"))}</button>
      <button type="button" class="btn quiet" data-massa="0" ${algumaOn ? "" : "disabled"}>${esc(grupo ? t("Desligar {g}", { g: grupo }) : t("Desligar todas"))}</button></div>`;
    // as oportunidades arrumadas: em «Tudo» por tema, dentro de um tema por categoria; com uma categoria escolhida, lista só
    const chave = cat ? null : grupo ? "nicho" : "grupo";
    const blocos = chave ? [...new Set(lista.map((a) => a[chave]))].map((k) => [k, lista.filter((a) => a[chave] === k).sort(ORDENS[ordem][1])]) : [["", lista.sort(ORDENS[ordem][1])]];
    const deals = blocos.map(([k, as]) => `${k && blocos.length > 1 ? `<h4 class="vt-grp"><span class="vt-ico sm">${ico(as[0].grupo)}</span>${esc(k)}<small>${as.length}</small><i>${esc(t("até +{v} de lucro", { v: eur(Math.max(...as.map((a) => a.lucro || 0))) }))}</i></h4>` : ""}<div class="vt-deals">${as.map(alerta).join("")}</div>`).join("");
    paintNav();
    if (aba !== "painel" && aba !== "definicoes") { schedule(); return; }
    const defs = `${head("layers", grupo ? t("Categorias de {g}", { g: grupo }) : "Categorias", massa)}
      <div class="vt-cats">${nichos.map(nicho).join("")}
        <form class="vt-cat vt-new" data-new><input name="pesquisa" placeholder="${esc(grupo === "Tecnologia" ? t("Nova: ex. airpods pro") : t("Nova: ex. barbour jacket"))}" maxlength="80">
          <button class="btn quiet" type="submit">${icon("plus")}${esc(t("Juntar"))}</button></form></div>
      ${tg}
      ${head("sliders", "Limites da regra", `<span class="vt-aside">${esc(t("O que conta como oportunidade"))}</span>`)}${limites()}
      <p class="vt-foot">${esc(t("O coletor abre a pesquisa pública do Vinted num Chrome sem janela, devagar e sem contornar bloqueios. A compra é sempre tua."))}</p>`;
    if (aba === "definicoes") { paint($("vt-body"), `${guarda()}${abas}${defs}`); schedule(); return; }
    paint($("vt-body"), `${guarda()}${kpis}${destaque(doGrupo)}
      ${head("wallet", "Orçamento", `<span class="vt-aside">${esc(t("O dinheiro que a empresa pode usar no Vinted, neste computador"))}</span>`)}${orcamento()}
      ${abas}
      ${head("target", grupo ? t("Oportunidades de {g}", { g: grupo }) : "Oportunidades", `<div class="vt-seg">${Object.entries(ORDENS).map(([k, [l]]) => `<button type="button" data-ordem="${k}" class="${k === ordem ? "on" : ""}">${esc(t(l))}</button>`).join("")}</div>`)}
      ${cats.length > 1 ? `<div class="vt-seg vt-fcat"><button type="button" data-fcat="" class="${cat ? "" : "on"}">${esc(t("Todas"))}</button>${cats.map((c) => `<button type="button" data-fcat="${esc(c)}" class="${c === cat ? "on" : ""}">${esc(c)}</button>`).join("")}</div>` : ""}
      ${lista.length ? deals
        : `<div class="panel">${ui.empty("bag", grupo ? t("Ainda sem oportunidades em {g}", { g: grupo }) : "Ainda sem oportunidades", V.ligado ? "O radar está a procurar. Aparecem aqui quando um artigo sair bem abaixo do mercado." : "Escolhe as categorias e carrega em «Ligar o radar».")}</div>`}
      ${V.escondidos ? `<p class="vt-note">${esc(t("{n} oportunidade(s) escondida(s).", { n: V.escondidos }))} <button type="button" class="vt-linkb" data-repor>${esc(t("Mostrar outra vez"))}</button></p>` : ""}
      ${compras()}`);
    schedule();
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => $("vt-body") && load(), V.ligado ? 15000 : 30000);
  }

  // ---------------------------------------------------------------- as cinco partes
  function paintNav() {
    const n = { produtos: V.total || 0, pipeline: null, painel: V.alertas.length || null };
    paint($("vt-nav"), ABAS.map(([k, l, ic]) => `<button type="button" role="tab" data-aba="${k}" class="${k === aba ? "on" : ""}" aria-selected="${k === aba}">${icon(ic)}<span>${esc(t(l))}</span>${n[k] ? `<em>${fmt.int(n[k])}</em>` : ""}</button>`).join(""));
  }

  function irPara(k) {
    aba = k;
    localStorage.setItem("vt-aba", k);
    $("view").scrollIntoView?.({ block: "start" });
    if (k === "painel" || k === "definicoes") return draw();
    paintNav();
    paint($("vt-body"), ui.skeleton(6));
    if (k === "produtos") loadProdutos();
    else if (k === "pipeline") loadPipeline();
    else if (k === "mercado") loadMercado();
  }

  // Produtos: todos os anúncios, com foto. Um clique abre a ficha; o Vinted abre no browser.
  const qs = () => new URLSearchParams(Object.entries({ q: F.q, nicho: F.nicho, marca: F.marca, estado: F.estado, so: F.so, etapa: F.etapa,
    ordem: F.ordem, pmin: F.pmin, pmax: F.pmax, grupo, limit: F.n }).filter(([, v]) => v !== "" && v != null)).toString();
  async function loadProdutos() {
    try {
      P = await api(`/api/vinted/produtos?${qs()}`);
      if (aba === "produtos") drawProdutos();
    } catch (e) { if ($("vt-body")) $("vt-body").innerHTML = ui.error(e.message); }
  }
  const refTxt = (a) => (a.ref ? t(a.ref_base === "marca" ? "mediana de {n} da marca" : a.ref_base === "radar" ? "mediana do radar ({n})" : "mediana de {n} da categoria", { n: a.ref_n }) : t("sem parecidos suficientes"));
  function card(a) {
    const pct = a.desconto != null ? Math.round(a.desconto * 100) : null;
    const forte = pct != null && pct >= 30;
    return `<article class="vt-pc ${a.alertado ? "hot" : ""}" data-ficha="${a.id}" tabindex="0">
      <div class="vt-pc-ph">${a.foto ? `<img src="${esc(a.foto)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="vt-noph">${ico(a.grupo)}</span>`}
        ${pct != null && pct > 0 ? `<span class="vt-off ${forte ? "up" : ""}">−${pct}%</span>` : ""}${a.alertado ? `<em class="vt-hot">${icon("target")}${esc(t("Oportunidade"))}</em>` : ""}
        <div class="vt-pc-q">
          <button type="button" class="${a.etapa === "mira" ? "on" : ""}" data-et="${a.id}" data-v="${a.etapa === "mira" ? "" : "mira"}" title="${esc(t(a.etapa === "mira" ? "Tirar da mira" : "Pôr na mira"))}">${icon("eye")}</button>
          <a href="${esc(a.link)}" target="_blank" rel="noopener" title="${esc(t("Abrir no Vinted"))}">${icon("arrow")}</a></div></div>
      <div class="vt-pc-in">
        <div class="vt-pc-p"><b>${eur(a.preco, 2)}</b>${a.ref ? `<s title="${esc(refTxt(a))}">${eur(a.ref)}</s>` : ""}${a.lucro_est != null && a.lucro_est > 0 ? `<i class="up">+${eur(a.lucro_est)}</i>` : ""}</div>
        <span class="vt-pc-t">${esc(a.titulo)}</span>
        <small>${esc([a.marca, a.tamanho, a.estado].filter(Boolean).join(" · "))}</small>
        <div class="vt-pc-f">${etapaChip(a.etapa)}<span>${esc(ago(a.visto_em))}</span></div></div></article>`;
  }
  const temas = () => (V.grupos.length > 1 ? `<div class="vt-seg vt-temas">${["", ...V.grupos].map((g) => `<button type="button" data-grupo="${esc(g)}" class="${g === grupo ? "on" : ""}">${ico(g)}${esc(t(g || "Tudo"))}</button>`).join("")}</div>` : "");
  function drawProdutos() {
    if (!P || !$("vt-body")) return;
    const sel = (k, label, opts) => `<label class="vt-f"><span>${esc(t(label))}</span><select data-f="${k}"><option value="">${esc(t("Todas"))}</option>${opts.map(([v, n]) => `<option value="${esc(v)}" ${String(F[k]) === String(v) ? "selected" : ""}>${esc(v)}${n != null ? ` (${n})` : ""}</option>`).join("")}</select></label>`;
    const chipF = (k, v, l, n) => `<button type="button" data-fs="${k}" data-v="${v}" class="${F[k] === v ? "on" : ""}">${esc(t(l))}${n != null ? ` <i>${fmt.int(n)}</i>` : ""}</button>`;
    const ords = { recente: "Mais recentes", desconto: "Maior desconto", lucro: "Maior lucro", barato: "Mais barato", caro: "Mais caro" };
    const bar = `<div class="panel vt-pbar">
      <div class="vt-pbar-1"><label class="vt-q">${icon("search")}<input type="search" data-fq value="${esc(F.q)}" placeholder="${esc(t("Procurar: marca, modelo, tamanho…"))}"></label>
        <div class="vt-seg">${chipF("so", "", "Todos", P.todos)}${chipF("so", "abaixo", "Abaixo do mercado", P.abaixo)}${chipF("so", "oport", "Oportunidades", null)}${chipF("etapa", "crm", "No CRM", null)}</div></div>
      <div class="vt-pbar-2">${sel("nicho", "Categoria", P.nichos)}${sel("marca", "Marca", P.marcas)}
        <label class="vt-f"><span>${esc(t("Estado"))}</span><select data-f="estado"><option value="">${esc(t("Todos"))}</option><option value="novo" ${F.estado === "novo" ? "selected" : ""}>${esc(t("Novo"))}</option><option value="usado" ${F.estado === "usado" ? "selected" : ""}>${esc(t("Usado"))}</option></select></label>
        <label class="vt-f sm"><span>${esc(t("De €"))}</span><input type="number" min="0" data-f="pmin" value="${esc(F.pmin)}"></label>
        <label class="vt-f sm"><span>${esc(t("Até €"))}</span><input type="number" min="0" data-f="pmax" value="${esc(F.pmax)}"></label>
        <label class="vt-f"><span>${esc(t("Ordem"))}</span><select data-f="ordem">${Object.entries(ords).map(([k, l]) => `<option value="${k}" ${F.ordem === k ? "selected" : ""}>${esc(t(l))}</option>`).join("")}</select></label>
        ${F.q || F.nicho || F.marca || F.estado || F.pmin || F.pmax || F.so || F.etapa ? `<button type="button" class="btn quiet" data-limpar>${icon("x")}${esc(t("Limpar"))}</button>` : ""}</div></div>`;
    const lista = P.itens.length ? `<div class="vt-grid">${P.itens.map(card).join("")}</div>
      ${P.total > P.itens.length ? `<div class="vt-more"><button type="button" class="btn quiet" data-mais>${esc(t("Mostrar mais ({n} de {t})", { n: P.itens.length, t: P.total }))}</button></div>` : ""}`
      : `<div class="panel">${ui.empty("bag", P.todos ? "Nenhum produto com estes filtros" : "Ainda sem produtos", P.todos ? "Tira um filtro ou procura outra coisa." : "Liga o radar: cada volta guarda aqui os anúncios das categorias ligadas, com foto e link.")}</div>`;
    paint($("vt-body"), `${temas()}${bar}<div class="vt-count">${esc(t("{n} produto(s)", { n: fmt.int(P.total) }))}${grupo ? ` · ${esc(grupo)}` : ""}<span>${esc(t("Clica num produto para ver a ficha; a seta abre a página no Vinted."))}</span></div>${lista}`);
  }

  // A ficha de um produto (por cima da página): foto, preços, onde fica no mercado, quem vende, a etapa e as notas.
  async function abrirFicha(id) {
    try {
      ficha = await api(`/api/vinted/produto/${id}`);
      pintarFicha();
    } catch (e) { flash(e.message); }
  }
  function faixa(d) {
    const ps = d.precos, a = d.item;
    if (ps.length < 3) return "";
    const lo = ps[0], hi = ps[ps.length - 1], x = (v) => (hi > lo ? ((v - lo) / (hi - lo)) * 100 : 50);
    return `<div class="vt-fx"><div class="vt-fx-l">${ps.map((p) => `<i style="left:${x(p).toFixed(1)}%"></i>`).join("")}
        ${a.ref ? `<u style="left:${x(a.ref).toFixed(1)}%" title="${esc(t("Mediana"))}"></u>` : ""}<b style="left:${x(a.preco).toFixed(1)}%"></b></div>
      <div class="vt-fx-n"><span>${eur(lo)}</span><span>${esc(d.posicao != null ? t("mais barato que {p}% dos parecidos", { p: Math.round((1 - d.posicao) * 100) }) : "")}</span><span>${eur(hi)}</span></div></div>`;
  }
  function pintarFicha() {
    const d = ficha, a = d.item, c = a.compra, pct = a.desconto != null ? Math.round(a.desconto * 100) : null;
    const passo = (k, extra = "") => { const [l, ic] = ETAPA[k], on = a.etapa === k;
      return `<button type="button" class="vt-step ${on ? "on" : ""}" data-passo="${k}" ${extra}>${icon(ic)}${esc(t(l))}</button>`; };
    const acoes = c ? `<div class="vt-steps">${passo("comprado")}${passo("venda")}${passo("vendido")}</div>
        <div class="vt-fi-row">${c.vendido == null ? `<label class="vt-f"><span>${esc(t("À venda por €"))}</span><input type="number" min="0" id="vt-av" value="${c.a_venda || ""}"></label><button type="button" class="btn quiet" data-avenda>${esc(t("Guardar"))}</button>
          <label class="vt-f"><span>${esc(t("Vendi por €"))}</span><input type="number" min="0" id="vt-vd"></label><button type="button" class="btn primary" data-vendeu>${esc(t("Vendido"))}</button>`
          : `<span class="vt-fi-ok">${esc(t("Vendido por {v} · lucro real {l}", { v: eur(c.vendido, 2), l: (c.vendido - c.custo >= 0 ? "+" : "−") + eur(Math.abs(c.vendido - c.custo), 2) }))}</span><button type="button" class="btn quiet" data-desvendi="${a.id}">${esc(t("Ainda não vendi"))}</button>`}</div>
        <p class="vt-fi-s">${esc(t("Comprado {d} por {v} (com taxa e portes).", { d: ago(c.quando), v: eur(c.custo, 2) }))} <button type="button" class="vt-linkb" data-compra-tirar="${a.id}">${esc(t("Desfazer compra"))}</button></p>`
      : `<div class="vt-steps">${passo("mira")}${passo("negociar")}<button type="button" class="vt-step" data-comprei="${a.id}">${icon("tick")}${esc(t("Comprei"))}</button>${passo("descartado")}</div>
        <div class="vt-fi-row"><label class="vt-f"><span>${esc(t("Oferta feita €"))}</span><input type="number" min="0" id="vt-of" value="${a.oferta || ""}"></label><button type="button" class="btn quiet" data-oferta>${esc(t("Guardar oferta"))}</button></div>`;
    const par = d.parecidos.length ? `<h4 class="vt-fi-h">${esc(t("Parecidos que dão o preço"))}<small>${esc(refTxt(a))}</small></h4>
      <div class="vt-mini">${d.parecidos.map((b) => `<button type="button" class="vt-mi" data-ficha="${b.id}">${b.foto ? `<img src="${esc(b.foto)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ""}<b>${eur(b.preco, 2)}</b><small>${esc(b.titulo)}</small></button>`).join("")}</div>` : "";
    const hist = d.historia.length ? `<ul class="vt-hist">${d.historia.slice().reverse().map((h) => `<li><b>${esc(h.o)}</b><span>${esc(h.quem)} · ${esc(ago(h.em))}</span></li>`).join("")}</ul>` : "";
    openModal(`<div class="vt-fi">
      <button type="button" class="vt-fi-x" data-close aria-label="${esc(t("Fechar"))}">${icon("x")}</button>
      <a class="vt-fi-ph" href="${esc(a.link)}" target="_blank" rel="noopener">${a.foto ? `<img src="${esc(a.foto)}" alt="" referrerpolicy="no-referrer">` : ico(a.grupo)}<span>${esc(t("Abrir no Vinted"))}${icon("arrow")}</span></a>
      <div class="vt-fi-in">
        <span class="vt-eyebrow">${ico(a.grupo)}${esc(a.nicho)}${a.alertado ? ` · ${esc(t("Oportunidade do radar"))}` : ""}</span>
        <h3>${esc(a.titulo)}</h3>
        <p class="vt-fi-s">${esc([a.marca, a.tamanho, a.estado].filter(Boolean).join(" · "))} · ${esc(t("visto {d}", { d: ago(a.visto_em) }))}</p>
        <div class="vt-fi-n"><span><i>${esc(t("Preço"))}</i>${eur(a.preco, 2)}</span><span><i>${esc(t("Custo real"))}</i>${eur(a.custo, 2)}</span>
          <span><i>${esc(t("Mercado"))}</i>${a.ref ? eur(a.ref) : `<em>${esc(t("Sem dados"))}</em>`}</span>
          <span class="${pct > 0 ? "up" : ""}"><i>${esc(t("Desconto"))}</i>${pct != null ? (pct > 0 ? "−" : "+") + Math.abs(pct) + "%" : "—"}</span>
          <span class="${a.lucro_est > 0 ? "up" : a.lucro_est < 0 ? "bad" : ""}"><i>${esc(t("Lucro estimado"))}</i>${a.lucro_est != null ? (a.lucro_est >= 0 ? "+" : "−") + eur(Math.abs(a.lucro_est)) : "—"}</span></div>
        ${faixa(d)}
        <div class="vt-meta">${vendedor(a)}${etapaChip(a.etapa)}</div>
        ${acoes}
        <label class="vt-f vt-nota"><span>${esc(t("Notas da equipa"))}</span><textarea id="vt-nota" rows="3" placeholder="${esc(t("Ex.: pedir fotos da etiqueta; vendedor responde rápido"))}">${esc(a.nota || "")}</textarea></label>
        <div class="vt-fi-row"><button type="button" class="btn quiet" data-nota>${esc(t("Guardar nota"))}</button>
          <a class="btn primary" href="${esc(a.link)}" target="_blank" rel="noopener">${esc(t("Ver no Vinted"))}${icon("arrow")}</a></div>
        ${hist}${par}
      </div></div>`);
    const box = $("modal-box");
    box.className = "modal-box vt-modal";
    box.onclick = onFicha;
  }
  async function crm(body, msg) {
    try {
      ficha = await api("/api/vinted/produto", { method: "POST", body: { id: ficha.item.id, ...body } });
      pintarFicha();
      refrescar();
      if (msg) flash(t(msg));
    } catch (e) { flash(e.message); }
  }
  async function compraF(body, msg) {
    try {
      V = await api("/api/vinted/compra", { method: "POST", body });
      await abrirFicha(ficha.item.id);
      refrescar();
      if (msg) flash(t(msg));
    } catch (e) { flash(e.message); }
  }
  function refrescar() {
    if (aba === "produtos") loadProdutos(); else if (aba === "pipeline") loadPipeline(); else if (aba === "painel") draw();
  }
  function onFicha(e) {
    if (!$("modal-box").classList.contains("vt-modal")) return;   // outra janela do Hub usa a mesma caixa
    const a = ficha && ficha.item, num = (id) => { const i = $(id); return i && i.value !== "" ? Number(i.value) : null; };
    const go = e.target.closest("[data-ficha]"), p = e.target.closest("[data-passo]");
    if (go) return abrirFicha(Number(go.dataset.ficha));
    if (p) { const k = p.dataset.passo;
      if (k === "mira" || k === "negociar" || k === "descartado") return crm({ etapa: a.etapa === k ? "" : k }, a.etapa === k ? "Tirado do CRM." : `${ETAPA[k][0]}.`);
      return; }
    if (e.target.closest("[data-comprei]")) return compraF({ id: a.id }, "Compra registada: saiu do orçamento disponível.");
    if (e.target.closest("[data-oferta]")) return crm({ oferta: num("vt-of"), etapa: "negociar" }, "Oferta guardada.");
    if (e.target.closest("[data-nota]")) return crm({ nota: $("vt-nota").value }, "Nota guardada.");
    if (e.target.closest("[data-avenda]")) return compraF({ a_venda: { id: a.id, valor: num("vt-av") } }, "Posto à venda.");
    if (e.target.closest("[data-vendeu]")) { const v = num("vt-vd"); if (v == null) { flash(t("Escreve por quanto vendeste.")); return $("vt-vd").focus(); }
      return compraF({ vendido: { id: a.id, valor: v } }, "Venda registada."); }
    if (e.target.closest("[data-desvendi]")) return compraF({ vendido: { id: a.id, valor: null } });
    if (e.target.closest("[data-compra-tirar]")) return compraF({ tirar: a.id }, "Compra desfeita.");
  }

  // Pipeline: o caminho de cada produto, da mira à venda, com o dinheiro de cada coluna.
  async function loadPipeline() {
    try { PL = await api("/api/vinted/pipeline"); if (aba === "pipeline") drawPipeline(); }
    catch (e) { if ($("vt-body")) $("vt-body").innerHTML = ui.error(e.message); }
  }
  function drawPipeline() {
    const C = PL.colunas, o = PL.orcamento;
    const soma = (xs, f) => xs.reduce((s, x) => s + (f(x) || 0), 0);
    const cols = [["mira", soma(C.mira, (x) => x.preco), "em preço"], ["negociar", soma(C.negociar, (x) => x.oferta || x.preco), "em ofertas"],
      ["comprado", soma(C.comprado, (x) => x.compra.custo), "investido"], ["venda", soma(C.venda, (x) => x.compra.a_venda), "pedido"],
      ["vendido", soma(C.vendido, (x) => x.compra.vendido - x.compra.custo), "lucro real"]];
    const total = Object.values(C).reduce((s, x) => s + x.length, 0);
    const kc = (x) => `<button type="button" class="vt-kc" data-ficha="${x.id}">${x.foto ? `<img src="${esc(x.foto)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="vt-noph">${ico(x.grupo)}</span>`}
      <span><b>${esc(x.titulo)}</b><small>${eur(x.preco, 2)}${x.oferta ? ` · ${esc(t("oferta"))} ${eur(x.oferta, 2)}` : ""}${x.compra && x.compra.a_venda ? ` · ${esc(t("pede"))} ${eur(x.compra.a_venda)}` : ""}${x.compra && x.compra.vendido != null ? ` · ${esc(t("vendido"))} ${eur(x.compra.vendido)}` : ""}</small>
      ${x.lucro_est != null && !(x.compra && x.compra.vendido != null) ? `<i class="${x.lucro_est > 0 ? "up" : ""}">${x.lucro_est > 0 ? "+" : ""}${eur(x.lucro_est)} ${esc(t("previsto"))}</i>` : ""}${x.nota ? `<em>${icon("note")}${esc(x.nota)}</em>` : ""}</span></button>`;
    paint($("vt-body"), `<div class="vt-kpis">${ui.kpis([
        ui.kpi({ label: "No pipeline", value: total, sub: t("{a} na mira · {b} a negociar", { a: C.mira.length, b: C.negociar.length }), cls: "hi", viz: chip("flag") }),
        ui.kpi({ label: "Em stock", value: C.comprado.length + C.venda.length, sub: t("{v} investido", { v: eur(o.investido, 2) }), viz: chip("bag") }),
        ui.kpi({ label: "Disponível", value: o.total ? eur(o.disponivel) : t("Sem dados"), sub: o.total ? t("de {v}", { v: eur(o.total) }) : t("põe o orçamento no Painel"), viz: chip("wallet") }),
        ui.kpi({ label: "Lucro real", value: o.lucro_real != null ? eur(o.lucro_real, 2) : t("Sem dados"), sub: t("{n} vendido(s)", { n: o.vendidas }), cls: o.lucro_real > 0 ? "up" : "", viz: chip("trend", o.lucro_real > 0 ? "ok" : "") })])}</div>
      ${total ? "" : `<div class="panel vt-tip">${ui.empty("flag", "O pipeline está vazio", "Em Produtos, carrega no olho de um produto para o pôr na mira, ou abre a ficha e muda a etapa. Cada produto anda por aqui até ser vendido.", `<button type="button" class="btn primary" data-aba="produtos">${esc(t("Ver produtos"))}</button>`)}</div>`}
      <div class="vt-board">${cols.map(([k, v, l]) => `<section class="vt-col col-${k}"><header>${icon(ETAPA[k][1])}<b>${esc(t(ETAPA[k][0]))}</b><em>${C[k].length}</em>
          <small>${C[k].length ? `${k === "vendido" && v >= 0 ? "+" : ""}${eur(v)} ${esc(t(l))}` : ""}</small></header>
        <div class="vt-col-in">${C[k].map(kc).join("") || `<p class="vt-col-0">${esc(t("Nada aqui"))}</p>`}</div></section>`).join("")}</div>`);
  }

  // Mercado: o cérebro. O preço normal de cada categoria e marca, a partir de tudo o que o radar já viu.
  async function loadMercado() {
    try { MK = await api("/api/vinted/mercado"); if (aba === "mercado") drawMercado(); }
    catch (e) { if ($("vt-body")) $("vt-body").innerHTML = ui.error(e.message); }
  }
  function drawMercado() {
    const cats = MK.categorias.filter((c) => !grupo || c.grupo === grupo);
    const dias = MK.dias.map((d) => ({ label: new Date(d.dia + "T12:00").toLocaleDateString("pt-PT", { day: "2-digit", month: "short" }), value: d.n, tip: t("{n} anúncios novos", { n: d.n }) }));
    const catP = (c) => { const x = (v) => (c.max > c.min ? ((v - c.min) / (c.max - c.min)) * 100 : 50);
      return `<div class="panel vt-mk">
        <div class="vt-mk-h"><span class="vt-ico">${ico(c.grupo)}</span><div><b>${esc(c.nicho)}</b><small>${esc(t("{n} anúncios vistos", { n: fmt.int(c.n) }))}</small></div>
          <button type="button" class="btn quiet" data-vercat="${esc(c.nicho)}">${esc(t("Ver produtos"))}${icon("chevron")}</button></div>
        <div class="vt-fi-n"><span><i>${esc(t("Preço do meio"))}</i>${eur(c.mediana)}</span><span><i>${esc(t("Normal"))}</i>${eur(c.p25)}–${eur(c.p75)}</span><span><i>${esc(t("Mais barato"))}</i>${eur(c.min, 2)}</span><span><i>${esc(t("Mais caro"))}</i>${eur(c.max)}</span></div>
        <div class="vt-rng"><i style="left:${x(c.p25).toFixed(1)}%;width:${(x(c.p75) - x(c.p25)).toFixed(1)}%"></i><b style="left:${x(c.mediana).toFixed(1)}%"></b></div>
        <table class="vt-tb"><thead><tr><th>${esc(t("Marca"))}</th><th>${esc(t("Anúncios"))}</th><th>${esc(t("Preço do meio"))}</th><th>${esc(t("Mais barato"))}</th><th></th></tr></thead>
          <tbody>${c.marcas.map((m) => `<tr data-vermarca="${esc(m.marca)}" data-mcat="${esc(c.nicho)}"><td><b>${esc(m.marca)}</b></td><td>${m.n}</td><td>${eur(m.mediana)}</td><td>${eur(m.min, 2)}</td><td>${icon("chevron")}</td></tr>`).join("")}</tbody></table></div>`; };
    paint($("vt-body"), `<div class="vt-kpis">${ui.kpis([
        ui.kpi({ label: "Anúncios vistos", value: fmt.int(MK.total), sub: t("a base do cérebro"), cls: "hi", viz: chip("layers") }),
        ui.kpi({ label: "Com preço de mercado", value: MK.total ? `${Math.round((MK.com_ref / MK.total) * 100)}%` : t("Sem dados"), sub: t("têm parecidos suficientes"), viz: chip("chart") }),
        ui.kpi({ label: "Abaixo do mercado", value: fmt.int(MK.abaixo), sub: t("30% ou mais abaixo do preço do meio"), viz: chip("target", MK.abaixo ? "ok" : "") }),
        ui.kpi({ label: "Categorias", value: cats.length || t("Sem dados"), sub: grupo || t("todos os temas"), viz: chip("grid") })])}</div>
      ${temas()}${head("pulse", "Anúncios novos por dia", `<span class="vt-aside">${esc(t("últimos 14 dias"))}</span>`)}<div class="panel vt-days">${ui.bars(dias)}</div>
      ${head("chart", "Preços por categoria e marca", `<span class="vt-aside">${esc(t("Clica numa marca para ver os produtos dela"))}</span>`)}
      ${cats.length ? cats.map(catP).join("") : `<div class="panel">${ui.empty("chart", "Ainda sem mercado", "Liga o radar: o preço normal de cada categoria e marca aparece aqui à medida que ele vê anúncios.")}</div>`}`);
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
      <nav class="vt-nav" id="vt-nav" role="tablist"></nav>
      <div id="vt-body">${ui.skeleton(6)}</div>`);
    const v = $("view");
    v.onclick = (e) => {
      const b = e.target.closest("[data-vt]"), x = e.target.closest("[data-tirar]"), s = e.target.closest("[data-save]");
      const c = e.target.closest("[data-cont]"), h = e.target.closest("[data-esconder]"), m = e.target.closest("[data-massa]"), g = e.target.closest("[data-grupo]");
      const k = e.target.closest("[data-comprei]"), vd = e.target.closest("[data-vendi]");
      const ab = e.target.closest("[data-aba]"), fi = e.target.closest("[data-ficha]"), et = e.target.closest("[data-et]");
      if (ab) return irPara(ab.dataset.aba);
      if (et) { e.preventDefault(); e.stopPropagation();
        return api("/api/vinted/produto", { method: "POST", body: { id: Number(et.dataset.et), etapa: et.dataset.v } })
          .then(() => { flash(t(et.dataset.v ? "Na mira: está no Pipeline." : "Tirado da mira.")); loadProdutos(); }).catch((x) => flash(x.message)); }
      if (e.target.closest(".vt-pc-q a")) return;
      if (fi) { e.preventDefault(); return abrirFicha(Number(fi.dataset.ficha)); }
      const fs = e.target.closest("[data-fs]");
      if (fs) { const k2 = fs.dataset.fs, v2 = fs.dataset.v; if (k2 === "so") { F.so = v2; F.etapa = ""; } else { F.etapa = F.etapa === v2 ? "" : v2; F.so = ""; } F.n = 60; return loadProdutos(); }
      if (e.target.closest("[data-limpar]")) { Object.assign(F, { q: "", nicho: "", marca: "", estado: "", so: "", etapa: "", pmin: "", pmax: "", n: 60 }); return loadProdutos(); }
      if (e.target.closest("[data-mais]")) { F.n += 60; return loadProdutos(); }
      const vc = e.target.closest("[data-vercat]"), vm = e.target.closest("[data-vermarca]");
      if (vc || vm) { Object.assign(F, { q: "", estado: "", so: "", etapa: "", pmin: "", pmax: "", n: 60, nicho: vc ? vc.dataset.vercat : vm.dataset.mcat, marca: vm ? vm.dataset.vermarca : "" }); return irPara("produtos"); }
      if (k) { e.preventDefault(); k.disabled = true; send("/api/vinted/compra", { id: Number(k.dataset.comprei) }, "Compra registada: saiu do orçamento disponível."); }
      else if (vd) { const i = $("vt-v-" + vd.dataset.vendi), val = i && i.value !== "" ? Number(i.value) : null;
        if (val == null) { flash(t("Escreve por quanto vendeste.")); i && i.focus(); } else send("/api/vinted/compra", { vendido: { id: Number(vd.dataset.vendi), valor: val } }, "Venda registada."); }
      else if (e.target.closest("[data-desvendi]")) send("/api/vinted/compra", { vendido: { id: Number(e.target.closest("[data-desvendi]").dataset.desvendi), valor: null } });
      else if (e.target.closest("[data-compra-tirar]")) send("/api/vinted/compra", { tirar: Number(e.target.closest("[data-compra-tirar]").dataset.compraTirar) }, "Compra tirada.");
      else if (e.target.closest("[data-orc-save]")) { const o = {};
        v.querySelectorAll("[data-orc]").forEach((i) => { o[i.dataset.orc] = i.value === "" ? 0 : Number(i.value); });
        send("/api/vinted/orcamento", o, "Orçamento guardado."); }
      else if (c) { c.disabled = true; send("/api/vinted/ligar", { continuo: c.dataset.cont === "1" }, c.dataset.cont === "1" ? "Contínuo ligado: o Hub mantém o radar a procurar, dia e noite." : "Contínuo desligado: o radar fica como está, sem guarda."); }
      else if (e.target.closest("[data-agora]")) { e.target.closest("[data-agora]").disabled = true; send("/api/vinted/agora", {}, "A procurar agora em todas as categorias ligadas."); }
      else if (h) { e.preventDefault(); send("/api/vinted/esconder", { id: Number(h.dataset.esconder) }); }
      else if (e.target.closest("[data-repor]")) send("/api/vinted/esconder", { repor: true });
      else if (m) {
        const on = m.dataset.massa === "1";
        const ativos = V.nichos.filter((n) => (!grupo || n.grupo === grupo) ? on : n.ativo).map((n) => n.nome);
        send("/api/vinted/config", { ativos }, on ? "Categorias ligadas." : "Categorias desligadas.");
      } else if (g) { grupo = g.dataset.grupo; cat = ""; localStorage.setItem("vt-grupo", grupo); F.nicho = ""; F.marca = ""; irPara(aba); }
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
    let qT = 0;
    v.oninput = (e) => {
      if (!e.target.matches("[data-fq]")) return;
      clearTimeout(qT);
      qT = setTimeout(() => { F.q = e.target.value.trim(); F.n = 60; loadProdutos().then(() => { const i = v.querySelector("[data-fq]"); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }); }, 300);
    };
    v.onkeydown = (e) => { const c = e.target.closest("[data-ficha]"); if (c && (e.key === "Enter" || e.key === " ") && e.target === c) { e.preventDefault(); abrirFicha(Number(c.dataset.ficha)); } };
    v.onchange = (e) => {
      if (e.target.matches("[data-f]")) { F[e.target.dataset.f] = e.target.value; F.n = 60; if (e.target.dataset.f === "ordem") localStorage.setItem("vt-p-ordem", F.ordem); return loadProdutos(); }
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
    if (aba !== "painel" && aba !== "definicoes") irPara(aba);
  };
})();
